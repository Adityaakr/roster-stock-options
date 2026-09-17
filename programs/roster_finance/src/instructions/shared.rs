//! Helpers shared by the instructions: series signer seeds, vault transfers with the series PDA as authority, and the
//! reload-and-assert idiom that measures what actually arrived after a Token-2022 CPI (transfer fees, hooks).

use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};

use crate::{error::RosterError, state::Series};

/// Signer seeds for a series PDA, as owned arrays so the borrow outlives the CPI.
pub struct SeriesSeeds {
    market: Pubkey,
    side: [u8; 1],
    strike: [u8; 8],
    expiry: [u8; 8],
    bump: [u8; 1],
}

impl SeriesSeeds {
    pub fn of(series: &Series) -> Self {
        Self { market: series.market, side: series.side_byte(), strike: series.strike_usdc_per_lot.to_le_bytes(), expiry: series.expiry_ts.to_le_bytes(), bump: [series.bump] }
    }
    pub fn seeds(&self) -> [&[u8]; 6] {
        [Series::SEED, self.market.as_ref(), &self.side, &self.strike, &self.expiry, &self.bump]
    }
}

/// Transfer `amount` out of a series vault to `to`, signed by the series PDA. Returns the amount that arrived.
pub fn vault_out<'info>(
    series_info: &AccountInfo<'info>,
    seeds: &SeriesSeeds,
    token_program: &Interface<'info, TokenInterface>,
    vault: &InterfaceAccount<'info, TokenAccount>,
    mint: &InterfaceAccount<'info, Mint>,
    to: &InterfaceAccount<'info, TokenAccount>,
    amount: u64,
) -> Result<u64> {
    if amount == 0 {
        return Ok(0);
    }
    let before = to.amount;
    let s = seeds.seeds();
    let signer: &[&[&[u8]]] = &[&s];
    token_interface::transfer_checked(
        CpiContext::new_with_signer(token_program.key(),
            TransferChecked { from: vault.to_account_info(), mint: mint.to_account_info(), to: to.to_account_info(), authority: series_info.clone() },
            signer,
        ),
        amount,
        mint.decimals,
    )?;
    let mut to_ref = to.clone();
    to_ref.reload()?;
    Ok(to_ref.amount.saturating_sub(before))
}

/// Transfer `amount` from a user account into a series vault, signed by the user. Returns the amount that arrived.
pub fn vault_in<'info>(
    token_program: &Interface<'info, TokenInterface>,
    from: &InterfaceAccount<'info, TokenAccount>,
    mint: &InterfaceAccount<'info, Mint>,
    vault: &mut InterfaceAccount<'info, TokenAccount>,
    authority: &Signer<'info>,
    amount: u64,
) -> Result<u64> {
    if amount == 0 {
        return Ok(0);
    }
    let before = vault.amount;
    token_interface::transfer_checked(
        CpiContext::new(token_program.key(),
            TransferChecked { from: from.to_account_info(), mint: mint.to_account_info(), to: vault.to_account_info(), authority: authority.to_account_info() },
        ),
        amount,
        mint.decimals,
    )?;
    vault.reload()?;
    let arrived = vault.amount.checked_sub(before).ok_or(RosterError::Overflow)?;
    Ok(arrived)
}

pub fn now(clock: &Clock) -> i64 {
    clock.unix_timestamp
}

/// The halt rule (docs/01-architecture.md section 4): an issuer pause on the mint or a freeze on a vault, observed by
/// any instruction, marks the series halted; `settle_writer` refuses until 24 hours after the last observation so a
/// pause spanning expiry cannot move intrinsic value from holders to writers. Exercise is never gated by it.
/// Returns true when the series is halted right now.
pub fn observe_halt(series: &mut Series, mint_info: &AccountInfo, vault: &InterfaceAccount<TokenAccount>, now: i64) -> bool {
    use anchor_spl::token_interface::{get_mint_extension_data, spl_token_2022};
    use spl_token_2022::extension::pausable::PausableConfig;
    let paused = match get_mint_extension_data::<PausableConfig>(mint_info) {
        Ok(cfg) => bool::from(cfg.paused),
        Err(_) => false,
    };
    let frozen = vault.state == spl_token_2022::state::AccountState::Frozen;
    if paused || frozen {
        series.state = crate::state::SERIES_HALTED;
        series.halted_at = now;
        series.resumed_at = 0;
        return true;
    }
    if series.state == crate::state::SERIES_HALTED {
        // First observation after the issuer resumed: start the 24 h clock here, not at the pause.
        if series.resumed_at == 0 {
            series.resumed_at = now;
            return true;
        }
        if now >= series.resumed_at.saturating_add(HALT_GRACE_SECS) {
            series.state = crate::state::SERIES_OPEN;
            return false;
        }
        return true;
    }
    false
}

pub const HALT_GRACE_SECS: i64 = 24 * 3600;
