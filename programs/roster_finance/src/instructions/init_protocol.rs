use anchor_lang::prelude::*;
use anchor_spl::token_interface::Mint;

use crate::{error::RosterError, state::Protocol};

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct InitProtocolParams {
    pub pause_authority: Pubkey,
    pub treasury: Pubkey,
    pub fee_bps: u16,
    pub integrator_share_bps: u16,
    pub keeper_fee_usdc: u64,
    pub grace_secs: i64,
}

#[derive(Accounts)]
pub struct InitProtocol<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(init, payer = authority, space = 8 + Protocol::INIT_SPACE, seeds = [Protocol::SEED], bump)]
    pub protocol: Account<'info, Protocol>,
    pub quote_mint: InterfaceAccount<'info, Mint>,
    pub system_program: Program<'info, System>,
}

pub fn handle(ctx: Context<InitProtocol>, params: InitProtocolParams) -> Result<()> {
    require!(params.fee_bps <= 1_000 && params.integrator_share_bps <= 10_000, RosterError::FeeOutOfRange);
    let p = &mut ctx.accounts.protocol;
    p.bump = ctx.bumps.protocol;
    p.authority = ctx.accounts.authority.key();
    p.pause_authority = params.pause_authority;
    p.treasury = params.treasury;
    p.quote_mint = ctx.accounts.quote_mint.key();
    p.fee_bps = params.fee_bps;
    p.integrator_share_bps = params.integrator_share_bps;
    p.keeper_fee_usdc = params.keeper_fee_usdc;
    p.grace_secs = params.grace_secs;
    p.paused_all = false;
    Ok(())
}
