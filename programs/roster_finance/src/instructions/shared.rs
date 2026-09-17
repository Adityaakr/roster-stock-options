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
