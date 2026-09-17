use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};

use crate::{error::RosterError, events::{FeesWithdrawn, PauseToggled}, state::Protocol};

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct UpdateProtocolParams {
    pub authority: Option<Pubkey>,
    pub pause_authority: Option<Pubkey>,
    pub treasury: Option<Pubkey>,
    pub fee_bps: Option<u16>,
    pub integrator_share_bps: Option<u16>,
    pub keeper_fee_usdc: Option<u64>,
    pub grace_secs: Option<i64>,
    pub paused_all: Option<bool>,
    pub series_creator: Option<Pubkey>,
}

#[derive(Accounts)]
pub struct UpdateProtocol<'info> {
    pub signer: Signer<'info>,
    #[account(mut, seeds = [Protocol::SEED], bump = protocol.bump)]
    pub protocol: Account<'info, Protocol>,
}

/// The authority may change anything. The pause key may only set `paused_all = true`.
pub fn handle_update_protocol(ctx: Context<UpdateProtocol>, p: UpdateProtocolParams) -> Result<()> {
    let signer = ctx.accounts.signer.key();
    let pr = &mut ctx.accounts.protocol;
    if signer != pr.authority {
        require!(signer == pr.pause_authority, RosterError::Unauthorized);
        let only_pause = p.authority.is_none() && p.pause_authority.is_none() && p.treasury.is_none() && p.fee_bps.is_none() && p.integrator_share_bps.is_none() && p.series_creator.is_none() && p.keeper_fee_usdc.is_none() && p.grace_secs.is_none();
        require!(only_pause && p.paused_all == Some(true), RosterError::Unauthorized);
    }
    if let Some(v) = p.authority { pr.authority = v; }
    if let Some(v) = p.pause_authority { pr.pause_authority = v; }
    if let Some(v) = p.treasury { pr.treasury = v; }
    if let Some(v) = p.fee_bps { require!(v <= 1_000, RosterError::FeeOutOfRange); pr.fee_bps = v; }
    if let Some(v) = p.integrator_share_bps { require!(v <= 10_000, RosterError::FeeOutOfRange); pr.integrator_share_bps = v; }
    if let Some(v) = p.keeper_fee_usdc { pr.keeper_fee_usdc = v; }
    if let Some(v) = p.grace_secs { require!(v >= 0, RosterError::FeeOutOfRange); pr.grace_secs = v; }
    if let Some(v) = p.series_creator { pr.series_creator = v; }
    if let Some(v) = p.paused_all {
        pr.paused_all = v;
        emit!(PauseToggled { market: None, paused: v });
    }
    Ok(())
}

/// Fees only ever leave the fee vault for the treasury's own associated token account.
#[derive(Accounts)]
pub struct WithdrawFees<'info> {
    #[account(address = protocol.authority @ RosterError::Unauthorized)]
    pub authority: Signer<'info>,
    #[account(seeds = [Protocol::SEED], bump = protocol.bump)]
    pub protocol: Account<'info, Protocol>,
    #[account(address = protocol.quote_mint @ RosterError::WrongQuoteMint)]
    pub quote_mint: InterfaceAccount<'info, Mint>,
    #[account(mut, associated_token::mint = quote_mint, associated_token::authority = protocol, associated_token::token_program = quote_token_program)]
    pub fee_vault: InterfaceAccount<'info, TokenAccount>,
    /// CHECK: the treasury recorded on the protocol account.
    #[account(address = protocol.treasury @ RosterError::WrongAccount)]
    pub treasury: UncheckedAccount<'info>,
    #[account(mut, associated_token::mint = quote_mint, associated_token::authority = treasury, associated_token::token_program = quote_token_program)]
    pub treasury_quote_ata: InterfaceAccount<'info, TokenAccount>,
    pub quote_token_program: Interface<'info, TokenInterface>,
}

pub fn handle_withdraw_fees(ctx: Context<WithdrawFees>, amount: u64) -> Result<()> {
    let amount = if amount == 0 { ctx.accounts.fee_vault.amount } else { amount };
    let bump = [ctx.accounts.protocol.bump];
    let seeds: [&[u8]; 2] = [Protocol::SEED, &bump];
    let signer: &[&[&[u8]]] = &[&seeds];
    token_interface::transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.quote_token_program.key(),
            TransferChecked { from: ctx.accounts.fee_vault.to_account_info(), mint: ctx.accounts.quote_mint.to_account_info(), to: ctx.accounts.treasury_quote_ata.to_account_info(), authority: ctx.accounts.protocol.to_account_info() },
            signer,
        ),
        amount,
        ctx.accounts.quote_mint.decimals,
    )?;
    emit!(FeesWithdrawn { amount, to: ctx.accounts.treasury.key() });
    Ok(())
}
