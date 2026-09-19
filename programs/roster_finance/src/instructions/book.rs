//! The ask book, as pure functions over a loaded `Series`. `quote`, `cancel_ask` and `withdraw_unsold` are thin
//! wrappers that move tokens and then call in here; the vault's instructions call the same functions with the vault
//! PDA as the writer. The book never learns which of its writers is a vault (Part 3 section 2: nothing special-cased).

use anchor_lang::prelude::*;

use crate::{
    error::RosterError,
    events::{AskCancelled, AskPosted},
    math::free_lots6,
    state::{Ask, MarketConfig, Series, Side, MAX_ASKS},
};

/// Resident asks one writer may hold in a series, so a single key cannot occupy the whole list (adversary 5c).
pub const MAX_ASKS_PER_WRITER: usize = 4;

pub fn collateral_mint_for(series: &Series, market: &MarketConfig) -> Pubkey {
    match series.side() {
        Side::Call => market.mint,
        Side::Put => market.quote_mint,
    }
}

/// The writer's slot, claimed if this is the writer's first deposit here. A slot enters at the current product.
pub fn find_or_claim_slot(series: &mut Series, writer: &Pubkey) -> Result<usize> {
    if let Some(i) = series.writer_slot(writer) {
        return Ok(i);
    }
    let i = series.writers.iter().position(|w| w.is_recyclable()).ok_or(RosterError::WriterSlotsFull)?;
    series.writers[i] = Default::default();
    series.writers[i].writer = *writer;
    let p = series.p();
    series.writers[i].set_p_snap(p);
    series.writers[i].scale_snap = series.scale;
    series.writers[i].epoch_snap = series.epoch;
    Ok(i)
}

/// Credit collateral that arrived in the series vault to a slot: raw units for a call, lots for a put.
pub fn credit_deposit(series: &mut Series, market: &MarketConfig, slot: usize, arrived: u64, deposit_lots6: u64, expected: u64) -> Result<()> {
    let credited = match series.side() {
        Side::Call => arrived / market.raw_per_lot6(),
        Side::Put => {
            require!(arrived == expected, RosterError::WrongAccount);
            deposit_lots6
        }
    };
    let w = &mut series.writers[slot];
    w.deposited_lots6 = w.deposited_lots6.checked_add(credited).ok_or(RosterError::Overflow)?;
    require!(w.deposited_lots6 - w.withdrawn_lots6 <= market.max_writer_lots6, RosterError::WriterCapReached);
    Ok(())
}

/// Post an ask from a writer's free collateral: sorted insert by (price, seq); when the list is full the worst ask is
/// evicted in place and its writer's collateral is free again. A new ask no better than the worst is refused.
pub fn post_ask(series: &mut Series, series_key: Pubkey, market: &MarketConfig, slot: usize, ask_lots6: u64, ask_per_lot: u64) -> Result<u64> {
    require!(ask_per_lot > 0 && ask_lots6 >= market.min_lots6 && ask_lots6 <= market.max_lots6, RosterError::SizeOutOfRange);
    require!(free_lots6(series, slot) >= ask_lots6, RosterError::InsufficientFreeCollateral);
    let mine = series.asks[..series.asks_len as usize].iter().filter(|a| a.writer_slot as usize == slot).count();
    require!(mine < MAX_ASKS_PER_WRITER, RosterError::AskRejected);

    let mut len = series.asks_len as usize;
    let mut evicted_seq = 0u64;
    if len == MAX_ASKS {
        let worst = series.asks[len - 1];
        require!(ask_per_lot < worst.ask_per_lot, RosterError::AskRejected);
        evicted_seq = worst.seq;
        len -= 1;
    }
    series.seq += 1;
    let seq = series.seq;
    let new = Ask { writer_slot: slot as u8, remaining_lots6: ask_lots6, ask_per_lot, seq, _pad: [0; 7] };
    let pos = series.asks[..len].iter().position(|a| ask_per_lot < a.ask_per_lot).unwrap_or(len);
    let mut i = len;
    while i > pos {
        series.asks[i] = series.asks[i - 1];
        i -= 1;
    }
    series.asks[pos] = new;
    series.asks_len = (len + 1) as u8;

    emit!(AskPosted { series: series_key, writer: series.writers[slot].writer, lots6: ask_lots6, ask_per_lot, seq, evicted_seq });
    Ok(seq)
}

/// Remove one of a writer's resident asks by sequence number.
pub fn cancel_ask(series: &mut Series, series_key: Pubkey, writer: &Pubkey, seq: u64) -> Result<()> {
    let slot = series.writer_slot(writer).ok_or(RosterError::NoWriterSlot)?;
    let len = series.asks_len as usize;
    let pos = series.asks[..len].iter().position(|a| a.seq == seq && a.writer_slot as usize == slot).ok_or(RosterError::AskNotFound)?;
    for i in pos..len - 1 {
        series.asks[i] = series.asks[i + 1];
    }
    series.asks[len - 1] = Default::default();
    series.asks_len = (len - 1) as u8;
    emit!(AskCancelled { series: series_key, writer: *writer, seq });
    Ok(())
}
