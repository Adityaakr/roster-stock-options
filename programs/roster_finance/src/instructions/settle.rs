use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_2022::Token2022,
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

pub fn handle_settle_writer(ctx: Context<SettleWriter>) -> Result<()> {
    let clock = Clock::get()?;
    let series_key = ctx.accounts.series.key();
    let series_info = ctx.accounts.series.to_account_info();
    let series = ctx.accounts.series.load()?;
    require!(clock.unix_timestamp >= series.expiry_ts, RosterError::NotExpired);
    require!(ctx.accounts.underlying_token_program.key() == ctx.accounts.market.token_program, RosterError::WrongTokenProgram);
    let writer = ctx.accounts.writer.key();
    let slot = series.writer_slot(&writer).ok_or(RosterError::NoWriterSlot)?;
    require!(!series.writers[slot].is_settled(), RosterError::AlreadySettled);

    let mut w = series.writers[slot];
    fold(&series, &mut w);
    let free = w.deposited_lots6.saturating_sub(w.withdrawn_lots6).saturating_sub(w.sold_lots6);
    let unassigned = w.open_lots6;
    let assigned = w.assigned_lots6;
    let premium = w.premium_claimable;

    let market = &ctx.accounts.market;
    let strike = series.strike_usdc_per_lot;
    let raw_per_lot6 = market.raw_per_lot6();
    let seeds = SeriesSeeds::of(&series);
    let side = series.side();
    drop(series);
    let (collateral_out, settlement_out) = match side {
        Side::Call => {
            let raw = raw_for_lots6(free + unassigned, raw_per_lot6).ok_or(RosterError::Overflow)?;
            let usdc = usdc_paid_floor(assigned, strike).ok_or(RosterError::Overflow)?;
            vault_out(&series_info, &seeds, &ctx.accounts.underlying_token_program, &ctx.accounts.collateral_vault, &ctx.accounts.underlying_mint, &ctx.accounts.writer_underlying_ata, raw)?;
            vault_out(&series_info, &seeds, &ctx.accounts.quote_token_program, &ctx.accounts.settlement_vault, &ctx.accounts.quote_mint, &ctx.accounts.writer_quote_ata, usdc)?;
            (raw, usdc)
        }
        Side::Put => {
            let usdc = usdc_paid_floor(free + unassigned, strike).ok_or(RosterError::Overflow)?;
            let raw = raw_for_lots6(assigned, raw_per_lot6).ok_or(RosterError::Overflow)?;
            vault_out(&series_info, &seeds, &ctx.accounts.quote_token_program, &ctx.accounts.collateral_vault, &ctx.accounts.quote_mint, &ctx.accounts.writer_quote_ata, usdc)?;
            vault_out(&series_info, &seeds, &ctx.accounts.underlying_token_program, &ctx.accounts.settlement_vault, &ctx.accounts.underlying_mint, &ctx.accounts.writer_underlying_ata, raw)?;
            (usdc, raw)
        }
    };
    vault_out(&series_info, &seeds, &ctx.accounts.quote_token_program, &ctx.accounts.quote_vault, &ctx.accounts.quote_mint, &ctx.accounts.writer_quote_ata, premium)?;

    w.settled = 1;
    w.withdrawn_lots6 = w.deposited_lots6;
    w.open_lots6 = 0;
    w.premium_claimable = 0;
    ctx.accounts.series.load_mut()?.writers[slot] = w;
    emit!(WriterSettled { series: series_key, writer, free_lots6: free, unassigned_lots6: unassigned, assigned_lots6: assigned, collateral_out, settlement_out, premium_out: premium });
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
    #[account(address = market.mint @ RosterError::WrongAccount)]
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
    require!(clock.unix_timestamp >= s.expiry_ts.saturating_add(ctx.accounts.protocol.grace_secs), RosterError::GraceNotElapsed);
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
