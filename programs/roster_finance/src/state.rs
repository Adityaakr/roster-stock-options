use anchor_lang::prelude::*;

/// Protocol-wide configuration. `authority` is the Squads vault; `pause_authority` can pause and nothing else.
#[account]
#[derive(InitSpace)]
pub struct Protocol {
    pub bump: u8,
    pub authority: Pubkey,
    pub pause_authority: Pubkey,
    pub treasury: Pubkey,
    pub quote_mint: Pubkey,
    pub fee_bps: u16,
    pub integrator_share_bps: u16,
    pub keeper_fee_usdc: u64,
    pub grace_secs: i64,
    pub paused_all: bool,
    pub _reserved: [u8; 64],
}

impl Protocol {
    pub const SEED: &'static [u8] = b"protocol";
}
