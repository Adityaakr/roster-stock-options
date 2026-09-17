//! Auto-exercise for absent holders (Part 1 4.2, Part 2 section 4). The holder opts in once, approving a program PDA
//! as delegate on the position account and on the cash or underlying account; the keeper cranks inside the window
//! before expiry with a Pyth price update posted in the same transaction. The keeper fee is paid from the fee vault,
//! never from the holder (addendum G). Exercise itself never reads a price; this instruction is the only one that does.

use anchor_lang::prelude::*;
use anchor_spl::{
    token_2022::Token2022,
    token_interface::{self, get_mint_extension_data, spl_token_2022, ApproveChecked, Burn, Mint, Revoke, TokenAccount, TokenInterface, TransferChecked},
};
use pyth_solana_receiver_sdk::price_update::PriceUpdateV2;
use spl_token_2022::extension::scaled_ui_amount::ScaledUiAmountConfig;

use crate::{
    error::RosterError,
    events::Exercised,
    instructions::shared::{vault_out, SeriesSeeds},
    math::{apply_exercise, raw_for_lots6, usdc_owed_ceil, usdc_paid_floor},
    state::{AutoExercise, MarketConfig, Protocol, Series, Side},
};

#[derive(Accounts)]
pub struct SetAutoExercise<'info> {
    #[account(mut)]
    pub holder: Signer<'info>,
    #[account(seeds = [MarketConfig::SEED, market.mint.as_ref()], bump = market.bump)]
    pub market: Account<'info, MarketConfig>,
    #[account(has_one = market @ RosterError::WrongAccount, has_one = position_mint @ RosterError::WrongAccount)]
    pub series: AccountLoader<'info, Series>,
    #[account(init_if_needed, payer = holder, space = 8 + AutoExercise::INIT_SPACE, seeds = [AutoExercise::SEED, holder.key().as_ref(), series.key().as_ref()], bump)]
    pub auto_exercise: Account<'info, AutoExercise>,
    /// CHECK: the program's delegate PDA; it can only act through `auto_exercise`.
    #[account(seeds = [AutoExercise::AUTHORITY_SEED], bump)]
    pub delegate: UncheckedAccount<'info>,
    pub position_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut, token::mint = position_mint, token::authority = holder, token::token_program = token_2022_program)]
    pub holder_position_ata: Box<InterfaceAccount<'info, TokenAccount>>,
    /// The account the exercise draws from: USDC for a call, the underlying for a put.
    pub pay_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut, token::mint = pay_mint, token::authority = holder, token::token_program = pay_token_program)]
    pub holder_pay_ata: Box<InterfaceAccount<'info, TokenAccount>>,
    pub pay_token_program: Interface<'info, TokenInterface>,
    pub token_2022_program: Program<'info, Token2022>,
    pub system_program: Program<'info, System>,
}

/// Opt in: approve the delegate on both accounts for the position size and what exercising it requires.
pub fn handle_enable_auto_exercise(ctx: Context<SetAutoExercise>, min_itm_bps: u16) -> Result<()> {
    let series = ctx.accounts.series.load()?;
    let want_pay = match series.side() { Side::Call => ctx.accounts.market.quote_mint, Side::Put => ctx.accounts.market.mint };
    require!(ctx.accounts.pay_mint.key() == want_pay, RosterError::WrongVaultMint);
    let lots6 = ctx.accounts.holder_position_ata.amount;
    let pay_amount = match series.side() {
        Side::Call => usdc_owed_ceil(lots6, series.strike_usdc_per_lot).ok_or(RosterError::Overflow)?,
        Side::Put => raw_for_lots6(lots6, ctx.accounts.market.raw_per_lot6()).ok_or(RosterError::Overflow)?,
    };
    drop(series);
    let a = &mut ctx.accounts.auto_exercise;
    a.bump = ctx.bumps.auto_exercise;
    a.holder = ctx.accounts.holder.key();
    a.series = ctx.accounts.series.key();
    a.enabled = true;
    a.min_itm_bps = min_itm_bps;
    token_interface::approve_checked(
        CpiContext::new(ctx.accounts.token_2022_program.key(), ApproveChecked { to: ctx.accounts.holder_position_ata.to_account_info(), mint: ctx.accounts.position_mint.to_account_info(), delegate: ctx.accounts.delegate.to_account_info(), authority: ctx.accounts.holder.to_account_info() }),
        lots6,
        ctx.accounts.position_mint.decimals,
    )?;
    token_interface::approve_checked(
        CpiContext::new(ctx.accounts.pay_token_program.key(), ApproveChecked { to: ctx.accounts.holder_pay_ata.to_account_info(), mint: ctx.accounts.pay_mint.to_account_info(), delegate: ctx.accounts.delegate.to_account_info(), authority: ctx.accounts.holder.to_account_info() }),
        pay_amount,
        ctx.accounts.pay_mint.decimals,
    )?;
    Ok(())
}

/// Opt out: revoke both delegations. The holder can always do this directly with the token program as well.
pub fn handle_disable_auto_exercise(ctx: Context<SetAutoExercise>) -> Result<()> {
    ctx.accounts.auto_exercise.enabled = false;
    token_interface::revoke(CpiContext::new(ctx.accounts.token_2022_program.key(), Revoke { source: ctx.accounts.holder_position_ata.to_account_info(), authority: ctx.accounts.holder.to_account_info() }))?;
    token_interface::revoke(CpiContext::new(ctx.accounts.pay_token_program.key(), Revoke { source: ctx.accounts.holder_pay_ata.to_account_info(), authority: ctx.accounts.holder.to_account_info() }))?;
    Ok(())
}

#[derive(Accounts)]
pub struct AutoExerciseCrank<'info> {
    #[account(mut)]
    pub keeper: Signer<'info>,
    #[account(seeds = [Protocol::SEED], bump = protocol.bump)]
    pub protocol: Account<'info, Protocol>,
    #[account(seeds = [MarketConfig::SEED, market.mint.as_ref()], bump = market.bump)]
    pub market: Account<'info, MarketConfig>,
    #[account(mut, has_one = market @ RosterError::WrongAccount, has_one = collateral_vault @ RosterError::WrongAccount, has_one = settlement_vault @ RosterError::WrongAccount, has_one = position_mint @ RosterError::WrongAccount)]
    pub series: AccountLoader<'info, Series>,
    /// CHECK: the holder being exercised for; its opt-in account and token accounts are derived from it.
    pub holder: UncheckedAccount<'info>,
    #[account(seeds = [AutoExercise::SEED, holder.key().as_ref(), series.key().as_ref()], bump = auto_exercise.bump, has_one = holder @ RosterError::WrongAccount, has_one = series @ RosterError::WrongAccount)]
    pub auto_exercise: Account<'info, AutoExercise>,
    /// CHECK: the delegate PDA signing on the holder's behalf.
    #[account(seeds = [AutoExercise::AUTHORITY_SEED], bump)]
    pub delegate: UncheckedAccount<'info>,
    #[account(address = market.mint @ RosterError::WrongAccount)]
    pub underlying_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(address = market.quote_mint @ RosterError::WrongQuoteMint)]
    pub quote_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut)]
    pub position_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut, token::mint = position_mint, token::authority = holder, token::token_program = token_2022_program)]
    pub holder_position_ata: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut)]
    pub collateral_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut)]
    pub settlement_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, associated_token::mint = underlying_mint, associated_token::authority = holder, associated_token::token_program = underlying_token_program)]
    pub holder_underlying_ata: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, associated_token::mint = quote_mint, associated_token::authority = holder, associated_token::token_program = quote_token_program)]
    pub holder_quote_ata: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, associated_token::mint = quote_mint, associated_token::authority = protocol, associated_token::token_program = quote_token_program)]
    pub fee_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, token::mint = quote_mint, token::authority = keeper, token::token_program = quote_token_program)]
    pub keeper_quote_ata: Box<InterfaceAccount<'info, TokenAccount>>,
    /// The Pyth price update posted in this transaction; owner-checked by the receiver program id.
    pub price_update: Account<'info, PriceUpdateV2>,
    pub underlying_token_program: Interface<'info, TokenInterface>,
    pub quote_token_program: Interface<'info, TokenInterface>,
    pub token_2022_program: Program<'info, Token2022>,
}

/// Price per lot in micro-USDC from the feed: the feed prices one share-equivalent, one lot is `multiplier` of them.
fn lot_value_usdc(price: &pyth_solana_receiver_sdk::price_update::Price, multiplier: f64) -> Result<u64> {
    require!(price.price > 0, RosterError::BadPriceUpdate);
    let scaled = (price.price as f64) * 10f64.powi(price.exponent) * 1_000_000.0 * multiplier;
    require!(scaled.is_finite() && scaled > 0.0 && scaled < u64::MAX as f64, RosterError::BadPriceUpdate);
    Ok(scaled as u64)
}

pub fn handle_auto_exercise(ctx: Context<AutoExerciseCrank>, lots6: u64) -> Result<()> {
    let clock = Clock::get()?;
    let protocol = &ctx.accounts.protocol;
    let market = &ctx.accounts.market;
    require!(!market.paused && !protocol.paused_all, RosterError::Paused);
    require!(ctx.accounts.auto_exercise.enabled, RosterError::AutoExerciseDisabled);
    require!(ctx.accounts.underlying_token_program.key() == market.token_program, RosterError::WrongTokenProgram);
    let series_info = ctx.accounts.series.to_account_info();
    let series_key = ctx.accounts.series.key();
    let series = ctx.accounts.series.load()?;
    let now = clock.unix_timestamp;
    let deadline = series.effective_expiry(crate::instructions::shared::HALT_GRACE_SECS);
    require!(now >= deadline - protocol.grace_secs && now < deadline, RosterError::OutsideWindow);
    // The crank exercises the whole position in one call, so the keeper fee is paid once per holder and series and
    // cannot be farmed by chunking (skeptic finding 1).
    let whole = ctx.accounts.holder_position_ata.amount.min(series.unassigned_lots6);
    require!(lots6 > 0 && lots6 == whole && lots6 >= market.min_lots6, RosterError::SizeOutOfRange);

    // The only price read in the program: fresh, fully verified, the market's own feed, tight confidence.
    let price = ctx.accounts.price_update.get_price_no_older_than(&clock, u64::from(market.max_price_age_secs), &market.token_feed_id).map_err(|_| RosterError::BadPriceUpdate)?;
    require!((price.conf as u128) * 10_000 <= (price.price.unsigned_abs() as u128) * (market.max_conf_bps as u128), RosterError::BadPriceUpdate);
    let mint_info = ctx.accounts.underlying_mint.to_account_info();
    let multiplier = match get_mint_extension_data::<ScaledUiAmountConfig>(&mint_info) {
        Ok(cfg) => {
            let ts: i64 = cfg.new_multiplier_effective_timestamp.into();
            if ts > 0 && now >= ts { f64::from(cfg.new_multiplier) } else { f64::from(cfg.multiplier) }
        }
        Err(_) => 1.0,
    };
    let lot_value = lot_value_usdc(&price, if market.feed_prices_ui_share { multiplier } else { 1.0 })?;
    let strike = series.strike_usdc_per_lot;
    let intrinsic_per_lot = match series.side() {
        Side::Call => lot_value.saturating_sub(strike),
        Side::Put => strike.saturating_sub(lot_value),
    };
    let intrinsic = usdc_paid_floor(lots6, intrinsic_per_lot).ok_or(RosterError::Overflow)?;
    let floor = protocol.keeper_fee_usdc.max(usdc_paid_floor(lots6, (strike as u128 * ctx.accounts.auto_exercise.min_itm_bps as u128 / 10_000) as u64).unwrap_or(0));
    require!(intrinsic > floor, RosterError::NotInTheMoney);

    let seeds = SeriesSeeds::of(&series);
    let side = series.side();
    let raw_per_lot6 = market.raw_per_lot6();
    drop(series);

    let bump = [ctx.bumps.delegate];
    let dseeds: [&[u8]; 2] = [AutoExercise::AUTHORITY_SEED, &bump];
    let dsigner: &[&[&[u8]]] = &[&dseeds];
    // Burn under the delegate.
    token_interface::burn(
        CpiContext::new_with_signer(ctx.accounts.token_2022_program.key(), Burn { mint: ctx.accounts.position_mint.to_account_info(), from: ctx.accounts.holder_position_ata.to_account_info(), authority: ctx.accounts.delegate.to_account_info() }, dsigner),
        lots6,
    )?;
    let (usdc, raw) = match side {
        Side::Call => {
            let usdc = usdc_owed_ceil(lots6, strike).ok_or(RosterError::Overflow)?;
            token_interface::transfer_checked(
                CpiContext::new_with_signer(ctx.accounts.quote_token_program.key(), TransferChecked { from: ctx.accounts.holder_quote_ata.to_account_info(), mint: ctx.accounts.quote_mint.to_account_info(), to: ctx.accounts.settlement_vault.to_account_info(), authority: ctx.accounts.delegate.to_account_info() }, dsigner),
                usdc,
                ctx.accounts.quote_mint.decimals,
            )?;
            let raw = raw_for_lots6(lots6, raw_per_lot6).ok_or(RosterError::Overflow)?;
            vault_out(&series_info, &seeds, &ctx.accounts.underlying_token_program, &ctx.accounts.collateral_vault, &ctx.accounts.underlying_mint, &ctx.accounts.holder_underlying_ata, raw)?;
            (usdc, raw)
        }
        Side::Put => {
            let raw = raw_for_lots6(lots6, raw_per_lot6).ok_or(RosterError::Overflow)?;
            token_interface::transfer_checked(
                CpiContext::new_with_signer(ctx.accounts.underlying_token_program.key(), TransferChecked { from: ctx.accounts.holder_underlying_ata.to_account_info(), mint: ctx.accounts.underlying_mint.to_account_info(), to: ctx.accounts.settlement_vault.to_account_info(), authority: ctx.accounts.delegate.to_account_info() }, dsigner),
                raw,
                ctx.accounts.underlying_mint.decimals,
            )?;
            let usdc = usdc_paid_floor(lots6, strike).ok_or(RosterError::Overflow)?;
            vault_out(&series_info, &seeds, &ctx.accounts.quote_token_program, &ctx.accounts.collateral_vault, &ctx.accounts.quote_mint, &ctx.accounts.holder_quote_ata, usdc)?;
            (usdc, raw)
        }
    };
    // Keeper fee from the fee vault, never from the holder.
    // Anyone may crank; only the protocol's registered keeper (the pause authority) is paid for it. Otherwise a
    // holder could farm the fee vault with dust positions across wallets and crank itself.
    let fee = if ctx.accounts.keeper.key() == protocol.pause_authority { protocol.keeper_fee_usdc.min(ctx.accounts.fee_vault.amount) } else { 0 };
    if fee > 0 {
        let pbump = [protocol.bump];
        let pseeds: [&[u8]; 2] = [Protocol::SEED, &pbump];
        let psigner: &[&[&[u8]]] = &[&pseeds];
        token_interface::transfer_checked(
            CpiContext::new_with_signer(ctx.accounts.quote_token_program.key(), TransferChecked { from: ctx.accounts.fee_vault.to_account_info(), mint: ctx.accounts.quote_mint.to_account_info(), to: ctx.accounts.keeper_quote_ata.to_account_info(), authority: ctx.accounts.protocol.to_account_info() }, psigner),
            fee,
            ctx.accounts.quote_mint.decimals,
        )?;
    }
    let mut series = ctx.accounts.series.load_mut()?;
    apply_exercise(&mut series, lots6);
    series.total_exercised_lots6 = series.total_exercised_lots6.checked_add(lots6).ok_or(RosterError::Overflow)?;
    emit!(Exercised { series: series_key, holder: ctx.accounts.holder.key(), lots6, usdc, raw, auto: true });
    Ok(())
}
