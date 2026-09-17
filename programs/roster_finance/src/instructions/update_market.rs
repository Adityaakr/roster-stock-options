use anchor_lang::prelude::*;

use crate::{error::RosterError, events::MarketUpdated, state::{MarketConfig, Protocol}};

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct UpdateMarketParams {
    pub allowed_expiries: Option<[i64; 4]>,
    pub strike_step: Option<u64>,
    pub min_strike: Option<u64>,
    pub max_strike: Option<u64>,
    pub max_live_series: Option<u16>,
    pub min_lots6: Option<u64>,
    pub max_lots6: Option<u64>,
    pub max_writer_lots6: Option<u64>,
    pub tier: Option<u8>,
    pub listed: Option<bool>,
    pub paused: Option<bool>,
    pub max_price_age_secs: Option<u32>,
    pub max_conf_bps: Option<u16>,
}

#[derive(Accounts)]
pub struct UpdateMarket<'info> {
    pub signer: Signer<'info>,
    #[account(seeds = [Protocol::SEED], bump = protocol.bump)]
    pub protocol: Account<'info, Protocol>,
    #[account(mut, seeds = [MarketConfig::SEED, market.mint.as_ref()], bump = market.bump)]
    pub market: Account<'info, MarketConfig>,
}

/// The authority may change anything. The pause key may only set `paused = true` and nothing else.
pub fn handle_update_market(ctx: Context<UpdateMarket>, p: UpdateMarketParams) -> Result<()> {
    let signer = ctx.accounts.signer.key();
    let is_authority = signer == ctx.accounts.protocol.authority;
    let is_pause_key = signer == ctx.accounts.protocol.pause_authority;
    let m = &mut ctx.accounts.market;
    if !is_authority {
        require!(is_pause_key, RosterError::Unauthorized);
        let only_pause = p.allowed_expiries.is_none() && p.strike_step.is_none() && p.min_strike.is_none() && p.max_strike.is_none() && p.max_live_series.is_none() && p.min_lots6.is_none() && p.max_lots6.is_none() && p.max_writer_lots6.is_none() && p.tier.is_none() && p.listed.is_none() && p.max_price_age_secs.is_none() && p.max_conf_bps.is_none();
        require!(only_pause && p.paused == Some(true), RosterError::Unauthorized);
    }
    if let Some(v) = p.allowed_expiries { m.allowed_expiries = v; }
    if let Some(v) = p.strike_step { require!(v > 0, RosterError::StrikeOffGrid); m.strike_step = v; }
    if let Some(v) = p.min_strike { m.min_strike = v; }
    if let Some(v) = p.max_strike { m.max_strike = v; }
    if let Some(v) = p.max_live_series { m.max_live_series = v; }
    if let Some(v) = p.min_lots6 { m.min_lots6 = v; }
    if let Some(v) = p.max_lots6 { m.max_lots6 = v; }
    if let Some(v) = p.max_writer_lots6 { m.max_writer_lots6 = v; }
    if let Some(v) = p.tier { m.tier = v; }
    if let Some(v) = p.listed { m.listed = v; }
    if let Some(v) = p.paused { m.paused = v; }
    if let Some(v) = p.max_price_age_secs { m.max_price_age_secs = v; }
    if let Some(v) = p.max_conf_bps { m.max_conf_bps = v; }
    require!(m.min_strike <= m.max_strike, RosterError::StrikeOffGrid);
    emit!(MarketUpdated { market: m.key(), paused: m.paused, listed: m.listed });
    Ok(())
}
