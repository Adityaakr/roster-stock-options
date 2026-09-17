use anchor_lang::prelude::*;
use anchor_spl::token_interface::{get_mint_extension_data, spl_token_2022, Mint};
use spl_token_2022::extension::{pausable::PausableConfig, permanent_delegate::PermanentDelegate, transfer_fee::TransferFeeConfig, transfer_hook::TransferHook};

use crate::{error::RosterError, events::MarketCreated, state::{MarketConfig, Protocol}};

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct CreateMarketParams {
    pub token_feed_id: [u8; 32],
    pub equity_feed_id: [u8; 32],
    pub allowed_expiries: [i64; 4],
    pub strike_step: u64,
    pub min_strike: u64,
    pub max_strike: u64,
    pub max_live_series: u16,
    pub min_lots6: u64,
    pub max_lots6: u64,
    pub max_writer_lots6: u64,
    pub tier: u8,
    pub max_price_age_secs: u32,
    pub max_conf_bps: u16,
    pub symbol: [u8; 8],
    pub feed_prices_ui_share: bool,
}

#[derive(Accounts)]
pub struct CreateMarket<'info> {
    #[account(mut, address = protocol.authority @ RosterError::Unauthorized)]
    pub authority: Signer<'info>,
    #[account(seeds = [Protocol::SEED], bump = protocol.bump)]
    pub protocol: Account<'info, Protocol>,
    #[account(init, payer = authority, space = 8 + MarketConfig::INIT_SPACE, seeds = [MarketConfig::SEED, mint.key().as_ref()], bump)]
    pub market: Account<'info, MarketConfig>,
    pub mint: InterfaceAccount<'info, Mint>,
    pub system_program: Program<'info, System>,
}

pub fn handle_create_market(ctx: Context<CreateMarket>, params: CreateMarketParams) -> Result<()> {
    let mint_info = ctx.accounts.mint.to_account_info();
    let decimals = ctx.accounts.mint.decimals;
    require!(decimals >= 6, RosterError::TooFewDecimals);
    require!(params.strike_step > 0 && params.min_strike <= params.max_strike, RosterError::StrikeOffGrid);
    require!(params.min_lots6 > 0 && params.min_lots6 <= params.max_lots6, RosterError::SizeOutOfRange);

    // Extension flags are derived from the mint account, never from the registry entry (adversary finding 8b).
    let is_2022 = *mint_info.owner == spl_token_2022::ID;
    let has_transfer_fee = is_2022 && get_mint_extension_data::<TransferFeeConfig>(&mint_info).is_ok();
    let has_permanent_delegate = is_2022 && get_mint_extension_data::<PermanentDelegate>(&mint_info).is_ok();
    let pausable = is_2022 && get_mint_extension_data::<PausableConfig>(&mint_info).is_ok();
    let hook_program = if is_2022 {
        match get_mint_extension_data::<TransferHook>(&mint_info) {
            Ok(h) => Option::<Pubkey>::from(h.program_id).unwrap_or_default(),
            Err(_) => Pubkey::default(),
        }
    } else {
        Pubkey::default()
    };

    let m = &mut ctx.accounts.market;
    m.bump = ctx.bumps.market;
    m.mint = ctx.accounts.mint.key();
    m.quote_mint = ctx.accounts.protocol.quote_mint;
    m.token_program = *mint_info.owner;
    m.decimals = decimals;
    m.has_transfer_fee = has_transfer_fee;
    m.has_permanent_delegate = has_permanent_delegate;
    m.pausable = pausable;
    m.hook_program = hook_program;
    m.token_feed_id = params.token_feed_id;
    m.equity_feed_id = params.equity_feed_id;
    m.allowed_expiries = params.allowed_expiries;
    m.strike_step = params.strike_step;
    m.min_strike = params.min_strike;
    m.max_strike = params.max_strike;
    m.max_live_series = params.max_live_series;
    m.live_series = 0;
    m.min_lots6 = params.min_lots6;
    m.max_lots6 = params.max_lots6;
    m.max_writer_lots6 = params.max_writer_lots6;
    m.tier = params.tier;
    // A mint with a live transfer hook is listed only once the hook path exists (P8); until then it is registry-only.
    m.listed = hook_program == Pubkey::default();
    m.paused = false;
    m.issuer_paused_at = 0;
    m.max_price_age_secs = params.max_price_age_secs;
    m.max_conf_bps = params.max_conf_bps;
    m.symbol = params.symbol;
    m.feed_prices_ui_share = params.feed_prices_ui_share;

    emit!(MarketCreated { market: m.key(), mint: m.mint, tier: m.tier });
    Ok(())
}
