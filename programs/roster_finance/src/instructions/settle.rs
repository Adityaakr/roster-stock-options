use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_2022::Token2022,
    token_2022_extensions::transfer_fee::{harvest_withheld_tokens_to_mint, HarvestWithheldTokensToMint},
    token_interface::{self, CloseAccount, Mint, TokenAccount, TokenInterface},
};

use crate::{
    error::RosterError,
    events::{SeriesClosed, WriterSettled},
    instructions::shared::{vault_out, SeriesSeeds},
    math::{fold, raw_for_lots6, usdc_paid_floor},
    state::{MarketConfig, Protocol, Series, Side},
};

/// After expiry, pay one writer everything it is owed: never-sold collateral, its still-unassigned lots from the
/// collateral vault, its assigned lots from the settlement vault, and its premium. Permissionless (a keeper cranks
/// it); every destination is the writer's own associated token account, derived, never passed.
#[derive(Accounts)]
pub struct SettleWriter<'info> {
    #[account(mut)]
    pub cranker: Signer<'info>,
    #[account(seeds = [MarketConfig::SEED, market.mint.as_ref()], bump = market.bump)]
    pub market: Account<'info, MarketConfig>,
    #[account(mut, has_one = market @ RosterError::WrongAccount, has_one = collateral_vault @ RosterError::WrongAccount, has_one = settlement_vault @ RosterError::WrongAccount, has_one = quote_vault @ RosterError::WrongAccount)]
    pub series: AccountLoader<'info, Series>,
    /// CHECK: the writer being settled; must hold a slot in the series. Destinations are its ATAs.
    pub writer: UncheckedAccount<'info>,
    #[account(address = market.mint @ RosterError::WrongAccount)]
    pub underlying_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(address = market.quote_mint @ RosterError::WrongQuoteMint)]
    pub quote_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut)]
    pub collateral_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut)]
    pub settlement_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut)]
    pub quote_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(init_if_needed, payer = cranker, associated_token::mint = underlying_mint, associated_token::authority = writer, associated_token::token_program = underlying_token_program)]
    pub writer_underlying_ata: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(init_if_needed, payer = cranker, associated_token::mint = quote_mint, associated_token::authority = writer, associated_token::token_program = quote_token_program)]
    pub writer_quote_ata: Box<InterfaceAccount<'info, TokenAccount>>,
    pub underlying_token_program: Interface<'info, TokenInterface>,
    pub quote_token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

/// What settling one writer paid out, for the caller's own accounting.
pub struct SettleOutcome {
    pub free_lots6: u64,
    pub unassigned_lots6: u64,
    pub assigned_lots6: u64,
    pub collateral_out: u64,
    pub settlement_out: u64,
    pub premium_out: u64,
}

/// The accounts one settlement touches, borrowed so the same settlement serves a person and a vault.
pub struct SettleAccounts<'a, 'info> {
    pub market: &'a Account<'info, MarketConfig>,
    pub series: &'a AccountLoader<'info, Series>,
    pub writer: Pubkey,
    pub underlying_mint: &'a InterfaceAccount<'info, Mint>,
    pub quote_mint: &'a InterfaceAccount<'info, Mint>,
    pub collateral_vault: &'a InterfaceAccount<'info, TokenAccount>,
    pub settlement_vault: &'a InterfaceAccount<'info, TokenAccount>,
    pub quote_vault: &'a InterfaceAccount<'info, TokenAccount>,
    pub writer_underlying_ata: &'a InterfaceAccount<'info, TokenAccount>,
    pub writer_quote_ata: &'a InterfaceAccount<'info, TokenAccount>,
    pub underlying_token_program: &'a Interface<'info, TokenInterface>,
    pub quote_token_program: &'a Interface<'info, TokenInterface>,
}

/// Settle one writer's slot after expiry: never-sold and unassigned collateral back, assigned lots as the other leg,
/// premium claimable. The pro-rata share comes from `fold` on the assignment product.
pub fn settle_core(a: SettleAccounts) -> Result<SettleOutcome> {
    let clock = Clock::get()?;
    let series_key = a.series.key();
    let series_info = a.series.to_account_info();
    let mut series = a.series.load_mut()?;
    require!(a.underlying_token_program.key() == a.market.token_program, RosterError::WrongTokenProgram);
    let underlying_vault = match series.side() { Side::Call => a.collateral_vault, Side::Put => a.settlement_vault };
    let halted = crate::instructions::shared::observe_halt(&mut series, &a.underlying_mint.to_account_info(), underlying_vault, clock.unix_timestamp);
    require!(!halted, RosterError::Halted);
    require!(clock.unix_timestamp >= series.effective_expiry(crate::instructions::shared::HALT_GRACE_SECS), RosterError::NotExpired);
    let writer = a.writer;
    let slot = series.writer_slot(&writer).ok_or(RosterError::NoWriterSlot)?;
    require!(!series.writers[slot].is_settled(), RosterError::AlreadySettled);

    let mut w = series.writers[slot];
    fold(&series, &mut w);
    let free = w.deposited_lots6.saturating_sub(w.withdrawn_lots6).saturating_sub(w.sold_lots6);
    let unassigned = w.open_lots6;
    let assigned = w.assigned_lots6;
    let premium = w.premium_claimable;

    let strike = series.strike_usdc_per_lot;
    let raw_per_lot6 = a.market.raw_per_lot6();
    let seeds = SeriesSeeds::of(&series);
    let side = series.side();
    drop(series);
    // Each leg pays what the counters say, capped at what the vault holds: the assignment product rounds toward the
    // vault, so the cap only ever trims rounding dust, and the last writer can always settle (feedback finding F1).
    let (collateral_out, settlement_out) = match side {
        Side::Call => {
            let raw = raw_for_lots6(free + unassigned, raw_per_lot6).ok_or(RosterError::Overflow)?.min(a.collateral_vault.amount);
            let usdc = usdc_paid_floor(assigned, strike).ok_or(RosterError::Overflow)?.min(a.settlement_vault.amount);
            vault_out(&series_info, &seeds, a.underlying_token_program, a.collateral_vault, a.underlying_mint, a.writer_underlying_ata, raw)?;
            vault_out(&series_info, &seeds, a.quote_token_program, a.settlement_vault, a.quote_mint, a.writer_quote_ata, usdc)?;
            (raw, usdc)
        }
        Side::Put => {
            let usdc = usdc_paid_floor(free + unassigned, strike).ok_or(RosterError::Overflow)?.min(a.collateral_vault.amount);
            let raw = raw_for_lots6(assigned, raw_per_lot6).ok_or(RosterError::Overflow)?.min(a.settlement_vault.amount);
            vault_out(&series_info, &seeds, a.quote_token_program, a.collateral_vault, a.quote_mint, a.writer_quote_ata, usdc)?;
            vault_out(&series_info, &seeds, a.underlying_token_program, a.settlement_vault, a.underlying_mint, a.writer_underlying_ata, raw)?;
            (usdc, raw)
        }
    };
    vault_out(&series_info, &seeds, a.quote_token_program, a.quote_vault, a.quote_mint, a.writer_quote_ata, premium)?;

    w.settled = 1;
    w.withdrawn_lots6 = w.deposited_lots6;
    w.open_lots6 = 0;
    w.premium_claimable = 0;
    a.series.load_mut()?.writers[slot] = w;
    emit!(WriterSettled { series: series_key, writer, free_lots6: free, unassigned_lots6: unassigned, assigned_lots6: assigned, collateral_out, settlement_out, premium_out: premium });
    Ok(SettleOutcome { free_lots6: free, unassigned_lots6: unassigned, assigned_lots6: assigned, collateral_out, settlement_out, premium_out: premium })
}

pub fn handle_settle_writer(ctx: Context<SettleWriter>) -> Result<()> {
    let a = &ctx.accounts;
    settle_core(SettleAccounts {
        market: &a.market, series: &a.series, writer: a.writer.key(), underlying_mint: &a.underlying_mint, quote_mint: &a.quote_mint,
        collateral_vault: &a.collateral_vault, settlement_vault: &a.settlement_vault, quote_vault: &a.quote_vault,
        writer_underlying_ata: &a.writer_underlying_ata, writer_quote_ata: &a.writer_quote_ata,
        underlying_token_program: &a.underlying_token_program, quote_token_program: &a.quote_token_program,
    })?;
    Ok(())
}

/// After expiry plus grace, once every writer has settled: sweep dust to the fee vault (USDC) or the treasury's
/// underlying account, close the three vaults and the series (rent to whoever paid it), and close the position
/// mint only if its supply is zero. Never waits for supply zero (docs/DECISIONS.md).
#[derive(Accounts)]
pub struct CloseSeries<'info> {
    #[account(mut)]
    pub cranker: Signer<'info>,
    #[account(seeds = [Protocol::SEED], bump = protocol.bump)]
    pub protocol: Account<'info, Protocol>,
    #[account(mut, seeds = [MarketConfig::SEED, market.mint.as_ref()], bump = market.bump)]
    pub market: Account<'info, MarketConfig>,
    #[account(mut, close = rent_receiver, has_one = market @ RosterError::WrongAccount, has_one = collateral_vault @ RosterError::WrongAccount, has_one = settlement_vault @ RosterError::WrongAccount, has_one = quote_vault @ RosterError::WrongAccount, has_one = position_mint @ RosterError::WrongAccount)]
    pub series: AccountLoader<'info, Series>,
    /// CHECK: receives the rent; must be the account that paid it.
    #[account(mut, address = series.load()?.rent_payer @ RosterError::WrongRentReceiver)]
    pub rent_receiver: UncheckedAccount<'info>,
    /// Mutable because a fee mint receives the vault's withheld fees before the vault can be closed.
    #[account(mut, address = market.mint @ RosterError::WrongAccount)]
    pub underlying_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(address = market.quote_mint @ RosterError::WrongQuoteMint)]
    pub quote_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut)]
    pub position_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut)]
    pub collateral_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut)]
    pub settlement_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut)]
    pub quote_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, associated_token::mint = quote_mint, associated_token::authority = protocol, associated_token::token_program = quote_token_program)]
    pub fee_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    /// CHECK: the protocol treasury, destination for underlying dust.
    #[account(address = protocol.treasury @ RosterError::WrongAccount)]
    pub treasury: UncheckedAccount<'info>,
    #[account(init_if_needed, payer = cranker, associated_token::mint = underlying_mint, associated_token::authority = treasury, associated_token::token_program = underlying_token_program)]
    pub treasury_underlying_ata: Box<InterfaceAccount<'info, TokenAccount>>,
    pub underlying_token_program: Interface<'info, TokenInterface>,
    pub quote_token_program: Interface<'info, TokenInterface>,
    pub token_2022_program: Program<'info, Token2022>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handle_close_series(ctx: Context<CloseSeries>) -> Result<()> {
    let clock = Clock::get()?;
    let series_key = ctx.accounts.series.key();
    let series_info = ctx.accounts.series.to_account_info();
    let s = ctx.accounts.series.load()?;
    require!(s.is_open() && clock.unix_timestamp >= s.expiry_ts.saturating_add(ctx.accounts.protocol.grace_secs), RosterError::GraceNotElapsed);
    require!(s.writers.iter().all(|w| w.is_empty() || w.is_settled() || (w.sold_lots6 == 0 && w.deposited_lots6 == w.withdrawn_lots6 && w.premium_claimable == 0)), RosterError::WritersUnsettled);
    require!(ctx.accounts.underlying_token_program.key() == ctx.accounts.market.token_program, RosterError::WrongTokenProgram);

    let seeds = SeriesSeeds::of(&s);
    let side = s.side();
    drop(s);
    let (underlying_vault, usdc_vault) = match side {
        Side::Call => (&ctx.accounts.collateral_vault, &ctx.accounts.settlement_vault),
        Side::Put => (&ctx.accounts.settlement_vault, &ctx.accounts.collateral_vault),
    };
    let dust_underlying = underlying_vault.amount;
    let dust_usdc = usdc_vault.amount + ctx.accounts.quote_vault.amount;
    vault_out(&series_info, &seeds, &ctx.accounts.underlying_token_program, underlying_vault, &ctx.accounts.underlying_mint, &ctx.accounts.treasury_underlying_ata, underlying_vault.amount)?;
    vault_out(&series_info, &seeds, &ctx.accounts.quote_token_program, usdc_vault, &ctx.accounts.quote_mint, &ctx.accounts.fee_vault, usdc_vault.amount)?;
    vault_out(&series_info, &seeds, &ctx.accounts.quote_token_program, &ctx.accounts.quote_vault, &ctx.accounts.quote_mint, &ctx.accounts.fee_vault, ctx.accounts.quote_vault.amount)?;

    // A fee mint withholds part of every transfer in the receiving account, and Token-2022 refuses to close an
    // account that still holds withheld fees. Harvesting them to the mint is permissionless and belongs to the
    // issuer, not to us: without it a First Print series could never give its rent back.
    if ctx.accounts.market.has_transfer_fee {
        harvest_withheld_tokens_to_mint(
            CpiContext::new(
                ctx.accounts.token_2022_program.key(),
                HarvestWithheldTokensToMint {
                    token_program_id: ctx.accounts.token_2022_program.to_account_info(),
                    mint: ctx.accounts.underlying_mint.to_account_info(),
                },
            ),
            vec![underlying_vault.to_account_info()],
        )?;
    }

    let sd = seeds.seeds();
    let signer: &[&[&[u8]]] = &[&sd];
    let (coll_prog, settle_prog) = match side {
        Side::Call => (ctx.accounts.underlying_token_program.key(), ctx.accounts.quote_token_program.key()),
        Side::Put => (ctx.accounts.quote_token_program.key(), ctx.accounts.underlying_token_program.key()),
    };
    let rent_receiver = ctx.accounts.rent_receiver.to_account_info();
    for (program, account) in [
        (coll_prog, ctx.accounts.collateral_vault.to_account_info()),
        (settle_prog, ctx.accounts.settlement_vault.to_account_info()),
        (ctx.accounts.quote_token_program.key(), ctx.accounts.quote_vault.to_account_info()),
    ] {
        token_interface::close_account(CpiContext::new_with_signer(
            program,
            CloseAccount { account, destination: rent_receiver.clone(), authority: series_info.clone() },
            signer,
        ))?;
    }

    let mint_closed = if ctx.accounts.position_mint.supply == 0 {
        token_interface::close_account(CpiContext::new_with_signer(ctx.accounts.token_2022_program.key(),
            CloseAccount { account: ctx.accounts.position_mint.to_account_info(), destination: ctx.accounts.rent_receiver.to_account_info(), authority: series_info.clone() },
            signer,
        ))?;
        true
    } else {
        false
    };

    ctx.accounts.market.live_series = ctx.accounts.market.live_series.saturating_sub(1);
    emit!(SeriesClosed { series: series_key, dust_collateral: dust_underlying, dust_settlement: dust_usdc, mint_closed });
    Ok(())
}

/// Permissionless: record an issuer pause or a frozen vault on the series so the halt grace runs from a persisted
/// observation (a failing instruction cannot persist it). The keeper's pause watcher calls this.
#[derive(Accounts)]
pub struct ObserveHalt<'info> {
    #[account(seeds = [MarketConfig::SEED, market.mint.as_ref()], bump = market.bump)]
    pub market: Account<'info, MarketConfig>,
    #[account(mut, has_one = market @ RosterError::WrongAccount, has_one = collateral_vault @ RosterError::WrongAccount, has_one = settlement_vault @ RosterError::WrongAccount)]
    pub series: AccountLoader<'info, Series>,
    #[account(address = market.mint @ RosterError::WrongAccount)]
    pub underlying_mint: InterfaceAccount<'info, Mint>,
    pub collateral_vault: InterfaceAccount<'info, TokenAccount>,
    pub settlement_vault: InterfaceAccount<'info, TokenAccount>,
}

pub fn handle_observe_halt(ctx: Context<ObserveHalt>) -> Result<()> {
    let clock = Clock::get()?;
    let mut series = ctx.accounts.series.load_mut()?;
    let underlying_vault = match series.side() { Side::Call => &ctx.accounts.collateral_vault, Side::Put => &ctx.accounts.settlement_vault };
    let halted = crate::instructions::shared::observe_halt(&mut series, &ctx.accounts.underlying_mint.to_account_info(), underlying_vault, clock.unix_timestamp);
    msg!("halted={}", halted);
    Ok(())
}
