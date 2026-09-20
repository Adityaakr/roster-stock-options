use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_2022::Token2022,
    token_interface::{self, get_mint_extension_data, spl_token_2022::extension::transfer_fee::TransferFeeConfig, Burn, Mint, TokenAccount, TokenInterface},
};

use crate::{
    error::RosterError,
    events::Exercised,
    instructions::shared::{vault_in, vault_out, SeriesSeeds},
    math::{apply_exercise, raw_for_lots6, usdc_owed_ceil, usdc_paid_floor},
    state::{MarketConfig, Series, Side},
};

/// American exercise by any position-token holder, any time before expiry. Burns the tokens; a call pays the strike
/// in USDC into the settlement vault and takes the underlying from the collateral vault; a put is the mirror. No
/// price account is in this instruction and no pause can block it (docs/DECISIONS.md).
#[derive(Accounts)]
pub struct Exercise<'info> {
    #[account(mut)]
    pub holder: Signer<'info>,
    #[account(seeds = [MarketConfig::SEED, market.mint.as_ref()], bump = market.bump)]
    pub market: Account<'info, MarketConfig>,
    #[account(mut, has_one = market @ RosterError::WrongAccount, has_one = collateral_vault @ RosterError::WrongAccount, has_one = settlement_vault @ RosterError::WrongAccount, has_one = position_mint @ RosterError::WrongAccount)]
    pub series: AccountLoader<'info, Series>,
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
    #[account(init_if_needed, payer = holder, associated_token::mint = underlying_mint, associated_token::authority = holder, associated_token::token_program = underlying_token_program)]
    pub holder_underlying_ata: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(init_if_needed, payer = holder, associated_token::mint = quote_mint, associated_token::authority = holder, associated_token::token_program = quote_token_program)]
    pub holder_quote_ata: Box<InterfaceAccount<'info, TokenAccount>>,
    pub underlying_token_program: Interface<'info, TokenInterface>,
    pub quote_token_program: Interface<'info, TokenInterface>,
    pub token_2022_program: Program<'info, Token2022>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handle_exercise(ctx: Context<Exercise>, lots6: u64) -> Result<()> {
    let clock = Clock::get()?;
    let series_key = ctx.accounts.series.key();
    let series_info = ctx.accounts.series.to_account_info();
    let series = ctx.accounts.series.load()?;
    require!(series.effective_expiry(crate::instructions::shared::HALT_GRACE_SECS) > clock.unix_timestamp, RosterError::Expired);
    require!(lots6 > 0 && lots6 <= series.unassigned_lots6, RosterError::SizeOutOfRange);
    // Too small to move the assignment product: the writers could not be charged for it (feedback round 2).
    require!(crate::math::moves_product(&series, lots6), RosterError::SizeOutOfRange);
    require!(ctx.accounts.holder_position_ata.amount >= lots6, RosterError::InsufficientPosition);
    require!(ctx.accounts.underlying_token_program.key() == ctx.accounts.market.token_program, RosterError::WrongTokenProgram);

    // Burn first: a holder who cannot pay never gets the underlying, and the burn is the holder's signature on the trade.
    token_interface::burn(
        CpiContext::new(ctx.accounts.token_2022_program.key(),
            Burn { mint: ctx.accounts.position_mint.to_account_info(), from: ctx.accounts.holder_position_ata.to_account_info(), authority: ctx.accounts.holder.to_account_info() },
        ),
        lots6,
    )?;

    let market = &ctx.accounts.market;
    let strike = series.strike_usdc_per_lot;
    let raw_per_lot6 = market.raw_per_lot6();
    let seeds = SeriesSeeds::of(&series);
    let side = series.side();
    drop(series);
    let (usdc, raw) = match side {
        Side::Call => {
            // Holder pays the strike (rounded up) and receives the raw underlying (exact).
            let usdc = usdc_owed_ceil(lots6, strike).ok_or(RosterError::Overflow)?;
            let arrived = vault_in(&ctx.accounts.quote_token_program, &ctx.accounts.holder_quote_ata, &ctx.accounts.quote_mint, &mut ctx.accounts.settlement_vault, &ctx.accounts.holder, usdc)?;
            require!(arrived == usdc, RosterError::WrongAccount);
            let raw = raw_for_lots6(lots6, raw_per_lot6).ok_or(RosterError::Overflow)?;
            vault_out(&series_info, &seeds, &ctx.accounts.underlying_token_program, &ctx.accounts.collateral_vault, &ctx.accounts.underlying_mint, &ctx.accounts.holder_underlying_ata, raw)?;
            (usdc, raw)
        }
        Side::Put => {
            // Holder delivers the raw underlying and receives the strike (rounded down) from the collateral vault.
            // On a transfer-fee mint the holder delivers gross so that exactly `raw` arrives: the writers are assigned
            // `lots6` and the settlement vault holds every unit they are owed (Part 2 addendum E, docs/03). The fee is
            // the holder's, and the ticket says so; `calculate_inverse_epoch_fee` rounds up, so `arrived >= raw`.
            let raw = raw_for_lots6(lots6, raw_per_lot6).ok_or(RosterError::Overflow)?;
            let send = if market.has_transfer_fee {
                let cfg = get_mint_extension_data::<TransferFeeConfig>(&ctx.accounts.underlying_mint.to_account_info())?;
                let fee = cfg.calculate_inverse_epoch_fee(clock.epoch, raw).ok_or(RosterError::Overflow)?;
                raw.checked_add(fee).ok_or(RosterError::Overflow)?
            } else { raw };
            let arrived = vault_in(&ctx.accounts.underlying_token_program, &ctx.accounts.holder_underlying_ata, &ctx.accounts.underlying_mint, &mut ctx.accounts.settlement_vault, &ctx.accounts.holder, send)?;
            require!(arrived >= raw, RosterError::WrongAccount);
            let usdc = usdc_paid_floor(lots6, strike).ok_or(RosterError::Overflow)?;
            vault_out(&series_info, &seeds, &ctx.accounts.quote_token_program, &ctx.accounts.collateral_vault, &ctx.accounts.quote_mint, &ctx.accounts.holder_quote_ata, usdc)?;
            (usdc, raw)
        }
    };

    let mut series = ctx.accounts.series.load_mut()?;
    apply_exercise(&mut series, lots6);
    series.total_exercised_lots6 = series.total_exercised_lots6.checked_add(lots6).ok_or(RosterError::Overflow)?;
    emit!(Exercised { series: series_key, holder: ctx.accounts.holder.key(), lots6, usdc, raw, auto: false });
    Ok(())
}
