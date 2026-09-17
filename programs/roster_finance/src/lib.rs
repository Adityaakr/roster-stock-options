#![deny(warnings)]
#![allow(unexpected_cfgs)]
//! Roster Finance: fully collateralized, American-exercise, physically settled contracts on
//! tokenized stocks, pooled per series with fungible position tokens. Settlement never reads an
//! oracle; the only multiplier read is the auto-exercise comparison.

pub mod error;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;

pub use instructions::*;
pub use state::*;

declare_id!("FJUdsdmxAp3zAwZBg3ai34xzeCBDobnH1XDarvVa7uFV");

#[program]
pub mod roster_finance {
    use super::*;

    /// One-time protocol account: authorities, fee schedule, the canonical quote mint.
    pub fn init_protocol(ctx: Context<InitProtocol>, params: InitProtocolParams) -> Result<()> {
        instructions::init_protocol::handle(ctx, params)
    }
}
