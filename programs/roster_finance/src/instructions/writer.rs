//! The write side: `quote` (deposit and post an ask), `cancel_ask`, `withdraw_unsold`, `claim_premium`. All
//! accounting lives in the writer's slot inside the series; `quote` is the only place collateral is committed, so a
//! resident ask is always backed (skeptic C3).

use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::{
    error::RosterError,
    events::{CollateralWithdrawn, PremiumClaimed},
    instructions::{
        book::{self, collateral_mint_for},
        shared::{vault_in, vault_out, SeriesSeeds},
    },
    math::{free_lots6, raw_for_lots6, usdc_owed_ceil, usdc_paid_floor},
    state::{MarketConfig, Protocol, Series, Side},
};

pub use book::MAX_ASKS_PER_WRITER;

#[derive(Accounts)]
pub struct WriterCollateral<'info> {
    #[account(mut)]
    pub writer: Signer<'info>,
    #[account(seeds = [Protocol::SEED], bump = protocol.bump)]
    pub protocol: Account<'info, Protocol>,
    #[account(seeds = [MarketConfig::SEED, market.mint.as_ref()], bump = market.bump)]
    pub market: Account<'info, MarketConfig>,
    #[account(mut, has_one = market @ RosterError::WrongAccount, has_one = collateral_vault @ RosterError::WrongAccount)]
    pub series: AccountLoader<'info, Series>,
    pub collateral_mint: InterfaceAccount<'info, Mint>,
    #[account(mut)]
    pub collateral_vault: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, token::mint = collateral_mint, token::authority = writer, token::token_program = collateral_token_program)]
    pub writer_collateral_ata: InterfaceAccount<'info, TokenAccount>,
    pub collateral_token_program: Interface<'info, TokenInterface>,
}

/// Collateral units for `lots6`: raw underlying for a call, micro-USDC (ceil) for a put.
fn collateral_amount(series: &Series, market: &MarketConfig, lots6: u64, ceil: bool) -> Result<u64> {
    match series.side() {
        Side::Call => raw_for_lots6(lots6, market.raw_per_lot6()).ok_or(RosterError::Overflow.into()),
        Side::Put => (if ceil { usdc_owed_ceil(lots6, series.strike_usdc_per_lot) } else { usdc_paid_floor(lots6, series.strike_usdc_per_lot) }).ok_or(RosterError::Overflow.into()),
    }
}

/// Deposit `deposit_lots6` of collateral (may be zero) and post an ask for `ask_lots6` at `ask_per_lot` micro-USDC
/// per lot from free collateral. Sorted insert; when the list is full the worst ask is evicted in place.
pub fn handle_quote(ctx: Context<WriterCollateral>, deposit_lots6: u64, ask_lots6: u64, ask_per_lot: u64) -> Result<()> {
    let clock = Clock::get()?;
    let market = &ctx.accounts.market;
    require!(market.listed, RosterError::NotListed);
    require!(!market.paused && !ctx.accounts.protocol.paused_all, RosterError::Paused);
    let series_key = ctx.accounts.series.key();
    let mut series = ctx.accounts.series.load_mut()?;
    require!(ctx.accounts.collateral_mint.key() == collateral_mint_for(&series, market), RosterError::WrongVaultMint);
    require!(series.expiry_ts > clock.unix_timestamp, RosterError::Expired);
    let halted = crate::instructions::shared::observe_halt(&mut series, &ctx.accounts.collateral_mint.to_account_info(), &ctx.accounts.collateral_vault, clock.unix_timestamp);
    require!(!halted, RosterError::Halted);
    require!(ask_per_lot > 0 && ask_lots6 >= market.min_lots6 && ask_lots6 <= market.max_lots6, RosterError::SizeOutOfRange);

    let writer = ctx.accounts.writer.key();
    let slot = book::find_or_claim_slot(&mut series, &writer)?;

    // Deposit, crediting what actually arrived (transfer-fee mints deliver less than sent).
    if deposit_lots6 > 0 {
        let amount = collateral_amount(&series, market, deposit_lots6, true)?;
        let arrived = vault_in(&ctx.accounts.collateral_token_program, &ctx.accounts.writer_collateral_ata, &ctx.accounts.collateral_mint, &mut ctx.accounts.collateral_vault, &ctx.accounts.writer, amount)?;
        book::credit_deposit(&mut series, market, slot, arrived, deposit_lots6, amount)?;
    }

    book::post_ask(&mut series, series_key, market, slot, ask_lots6, ask_per_lot)?;
    Ok(())
}

#[derive(Accounts)]
pub struct WriterOnly<'info> {
    pub writer: Signer<'info>,
    #[account(mut)]
    pub series: AccountLoader<'info, Series>,
}

pub fn handle_cancel_ask(ctx: Context<WriterOnly>, seq: u64) -> Result<()> {
    let writer = ctx.accounts.writer.key();
    let series_key = ctx.accounts.series.key();
    let mut series = ctx.accounts.series.load_mut()?;
    book::cancel_ask(&mut series, series_key, &writer, seq)
}

/// Withdraw never-sold collateral. Bounded by `free`, which is scanned from the ask list on the spot.
pub fn handle_withdraw_unsold(ctx: Context<WriterCollateral>, lots6: u64) -> Result<()> {
    let market = &ctx.accounts.market;
    let series_key = ctx.accounts.series.key();
    let series_info = ctx.accounts.series.to_account_info();
    let series = ctx.accounts.series.load()?;
    require!(ctx.accounts.collateral_mint.key() == collateral_mint_for(&series, market), RosterError::WrongVaultMint);
    let writer = ctx.accounts.writer.key();
    let slot = series.writer_slot(&writer).ok_or(RosterError::NoWriterSlot)?;
    require!(lots6 > 0 && free_lots6(&series, slot) >= lots6, RosterError::InsufficientFreeCollateral);
    let amount = collateral_amount(&series, market, lots6, false)?;
    let seeds = SeriesSeeds::of(&series);
    drop(series);
    vault_out(&series_info, &seeds, &ctx.accounts.collateral_token_program, &ctx.accounts.collateral_vault, &ctx.accounts.collateral_mint, &ctx.accounts.writer_collateral_ata, amount)?;
    let mut series = ctx.accounts.series.load_mut()?;
    let w = &mut series.writers[slot];
    w.withdrawn_lots6 = w.withdrawn_lots6.checked_add(lots6).ok_or(RosterError::Overflow)?;
    emit!(CollateralWithdrawn { series: series_key, writer, lots6 });
    Ok(())
}

#[derive(Accounts)]
pub struct ClaimPremium<'info> {
    pub writer: Signer<'info>,
    #[account(seeds = [MarketConfig::SEED, market.mint.as_ref()], bump = market.bump)]
    pub market: Account<'info, MarketConfig>,
    #[account(mut, has_one = market @ RosterError::WrongAccount, has_one = quote_vault @ RosterError::WrongAccount)]
    pub series: AccountLoader<'info, Series>,
    #[account(address = market.quote_mint @ RosterError::WrongQuoteMint)]
    pub quote_mint: InterfaceAccount<'info, Mint>,
    #[account(mut)]
    pub quote_vault: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, token::mint = quote_mint, token::authority = writer, token::token_program = quote_token_program)]
    pub writer_quote_ata: InterfaceAccount<'info, TokenAccount>,
    pub quote_token_program: Interface<'info, TokenInterface>,
}

pub fn handle_claim_premium(ctx: Context<ClaimPremium>) -> Result<()> {
    let writer = ctx.accounts.writer.key();
    let series_key = ctx.accounts.series.key();
    let series_info = ctx.accounts.series.to_account_info();
    let series = ctx.accounts.series.load()?;
    let slot = series.writer_slot(&writer).ok_or(RosterError::NoWriterSlot)?;
    let amount = series.writers[slot].premium_claimable;
    let seeds = SeriesSeeds::of(&series);
    drop(series);
    if amount > 0 {
        vault_out(&series_info, &seeds, &ctx.accounts.quote_token_program, &ctx.accounts.quote_vault, &ctx.accounts.quote_mint, &ctx.accounts.writer_quote_ata, amount)?;
        ctx.accounts.series.load_mut()?.writers[slot].premium_claimable = 0;
    }
    emit!(PremiumClaimed { series: series_key, writer, amount });
    Ok(())
}
