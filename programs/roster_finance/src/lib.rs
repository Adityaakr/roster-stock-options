#![deny(warnings)]
#![allow(unexpected_cfgs)]
//! Roster Finance: fully collateralized, American-exercise, physically settled contracts on
//! tokenized stocks, pooled per series with fungible position tokens. Settlement never reads an
//! oracle; the only multiplier read is the auto-exercise comparison.

pub mod error;
pub mod events;
pub mod instructions;
pub mod math;
pub mod state;

use anchor_lang::prelude::*;

pub use instructions::*;
pub use state::*;

declare_id!("FJUdsdmxAp3zAwZBg3ai34xzeCBDobnH1XDarvVa7uFV");

#[program]
pub mod roster_finance {
    use super::*;

    /// One-time protocol account: authorities, fee schedule, the canonical quote mint, the fee vault.
    pub fn init_protocol(ctx: Context<InitProtocol>, params: InitProtocolParams) -> Result<()> {
        instructions::init_protocol::handle_init_protocol(ctx, params)
    }

    /// List an underlying from a registry entry. Token program, decimals and extension flags come from the mint.
    pub fn create_market(ctx: Context<CreateMarket>, params: CreateMarketParams) -> Result<()> {
        instructions::create_market::handle_create_market(ctx, params)
    }

    /// Roll the grid, change caps, list or pause. The pause key may only pause.
    pub fn update_market(ctx: Context<UpdateMarket>, params: UpdateMarketParams) -> Result<()> {
        instructions::update_market::handle_update_market(ctx, params)
    }

    /// Create a series on the grid: pooled vaults and a Token-2022 position mint. Permissionless.
    pub fn create_series(ctx: Context<CreateSeries>, side: Side, strike_usdc_per_lot: u64, expiry_ts: i64) -> Result<()> {
        instructions::create_series::handle_create_series(ctx, side, strike_usdc_per_lot, expiry_ts)
    }

    /// Deposit collateral (optional) and post an ask from free collateral.
    pub fn quote(ctx: Context<WriterCollateral>, deposit_lots6: u64, ask_lots6: u64, ask_per_lot: u64) -> Result<()> {
        instructions::writer::handle_quote(ctx, deposit_lots6, ask_lots6, ask_per_lot)
    }

    pub fn cancel_ask(ctx: Context<WriterOnly>, seq: u64) -> Result<()> {
        instructions::writer::handle_cancel_ask(ctx, seq)
    }

    /// Withdraw never-sold collateral, any time.
    pub fn withdraw_unsold(ctx: Context<WriterCollateral>, lots6: u64) -> Result<()> {
        instructions::writer::handle_withdraw_unsold(ctx, lots6)
    }

    pub fn claim_premium(ctx: Context<ClaimPremium>) -> Result<()> {
        instructions::writer::handle_claim_premium(ctx)
    }

    /// Fill from the best asks at or below the limit; partial fills return the filled amount; zero fill fails.
    pub fn buy(ctx: Context<Buy>, lots6: u64, max_premium_per_lot: u64, referrer: Option<Pubkey>) -> Result<()> {
        instructions::buy::handle_buy(ctx, lots6, max_premium_per_lot, referrer)
    }

    /// Exercise any time before expiry. No oracle, never pausable.
    pub fn exercise(ctx: Context<Exercise>, lots6: u64) -> Result<()> {
        instructions::exercise::handle_exercise(ctx, lots6)
    }

    /// After expiry: pay a writer everything it is owed. Permissionless; destinations are derived.
    pub fn settle_writer(ctx: Context<SettleWriter>) -> Result<()> {
        instructions::settle::handle_settle_writer(ctx)
    }

    /// After expiry plus grace and every writer settled: sweep dust, close vaults and the series, reclaim rent.
    pub fn close_series(ctx: Context<CloseSeries>) -> Result<()> {
        instructions::settle::handle_close_series(ctx)
    }

    /// Record an issuer pause or vault freeze on the series (permissionless; the keeper watches for it).
    pub fn observe_halt(ctx: Context<ObserveHalt>) -> Result<()> {
        instructions::settle::handle_observe_halt(ctx)
    }

    /// Fee schedule, authorities, protocol-wide pause. The pause key may only pause.
    pub fn update_protocol(ctx: Context<UpdateProtocol>, params: UpdateProtocolParams) -> Result<()> {
        instructions::admin::handle_update_protocol(ctx, params)
    }

    /// Move fees from the fee vault to the treasury's token account. Zero means everything.
    pub fn withdraw_fees(ctx: Context<WithdrawFees>, amount: u64) -> Result<()> {
        instructions::admin::handle_withdraw_fees(ctx, amount)
    }

    /// Opt in to auto-exercise: the program's delegate PDA is approved on the position and the paying account.
    pub fn enable_auto_exercise(ctx: Context<SetAutoExercise>, min_itm_bps: u16) -> Result<()> {
        instructions::auto_exercise::handle_enable_auto_exercise(ctx, min_itm_bps)
    }

    pub fn disable_auto_exercise(ctx: Context<SetAutoExercise>) -> Result<()> {
        instructions::auto_exercise::handle_disable_auto_exercise(ctx)
    }

    /// Keeper crank inside the window before expiry, with a Pyth update posted in the same transaction.
    pub fn auto_exercise(ctx: Context<AutoExerciseCrank>, lots6: u64) -> Result<()> {
        instructions::auto_exercise::handle_auto_exercise(ctx, lots6)
    }
}
