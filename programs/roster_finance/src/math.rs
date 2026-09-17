//! Pooled assignment arithmetic (docs/01-architecture.md section 2.1). Pure functions over the series counters so the
//! host-side unit tests below can replay every skeptic counterexample without a VM.
//!
//! Model: `P` is the product over every exercise of `(U - q) / U` where `U` was the unassigned pool before it. A
//! writer who added `n` open lots when the product was `P_snap` holds `n * P / P_snap` unassigned lots now. When an
//! exercise consumes the whole pool the product would reach zero, so the series moves to a new `epoch` (older slots
//! are fully assigned) and `P` restarts at one. When `P` gets small it is rescaled by `P_SCALE` and `scale` counts
//! the rescales, so it never underflows to zero and never overflows u128.
//!
//! Every payout floors independently: a writer's unassigned and assigned lots are each rounded down, the difference
//! is dust that stays in the vaults (addendum E), and no writer can be paid from another's collateral.

use crate::state::{Series, WriterSlot, LOT6, P_FLOOR, P_ONE, P_SCALE};

/// Ceil of `lots6 * strike / 1e6`: what the party paying USDC owes.
pub fn usdc_owed_ceil(lots6: u64, strike_usdc_per_lot: u64) -> Option<u64> {
    let n = (lots6 as u128).checked_mul(strike_usdc_per_lot as u128)?;
    let v = n.checked_add(LOT6 as u128 - 1)? / LOT6 as u128;
    u64::try_from(v).ok()
}

/// Floor of `lots6 * strike / 1e6`: what the party receiving USDC gets.
pub fn usdc_paid_floor(lots6: u64, strike_usdc_per_lot: u64) -> Option<u64> {
    let n = (lots6 as u128).checked_mul(strike_usdc_per_lot as u128)?;
    u64::try_from(n / LOT6 as u128).ok()
}

/// Raw units for `lots6` of a mint with `raw_per_lot6 = 10^(decimals-6)`. Exact.
pub fn raw_for_lots6(lots6: u64, raw_per_lot6: u64) -> Option<u64> {
    lots6.checked_mul(raw_per_lot6)
}

/// Premium for `lots6` at `ask_per_lot` micro-USDC per lot, floored.
pub fn premium_for(lots6: u64, ask_per_lot: u64) -> Option<u64> {
    usdc_paid_floor(lots6, ask_per_lot)
}

/// Taker fee, rounded up so the vault never pays more than it collected.
pub fn fee_ceil(premium: u64, fee_bps: u16) -> u64 {
    let n = premium as u128 * fee_bps as u128;
    ((n + 9_999) / 10_000) as u64
}

/// Apply an exercise of `q` lots to the series product. Caller has checked `q <= unassigned`.
pub fn apply_exercise(series: &mut Series, q: u64) {
    let u = series.unassigned_lots6;
    if q == 0 {
        return;
    }
    if q == u {
        series.epoch = series.epoch.wrapping_add(1);
        series.set_p(P_ONE);
        series.scale = 0;
        series.unassigned_lots6 = 0;
        return;
    }
    // p * (u - q) / u, with u >= 1 and p <= P_ONE so the product fits in u128 comfortably.
    let mut p = series.p() * (u - q) as u128 / u as u128;
    if p < P_FLOOR {
        p *= P_SCALE;
        series.scale = series.scale.wrapping_add(1);
    }
    if p == 0 {
        // The remaining fraction is below 1e-27 of a unit: everything open is assigned, the residue is dust, new epoch.
        series.epoch = series.epoch.wrapping_add(1);
        p = P_ONE;
        series.scale = 0;
    }
    series.set_p(p);
    series.unassigned_lots6 = u - q;
}

/// Bring a writer slot to the present: split its `open` lots into what is still unassigned and what was assigned
/// since the last fold, each floored, then refresh the snapshots. Idempotent.
pub fn fold(series: &Series, w: &mut WriterSlot) {
    // Nothing has been assigned since the snapshot: folding would only forfeit a rounding unit. Skip it.
    if w.p_snap() == series.p() && w.scale_snap == series.scale && w.epoch_snap == series.epoch {
        return;
    }
    if w.open_lots6 > 0 {
        let (unassigned, assigned) = split(w, series.p(), series.scale, series.epoch);
        w.assigned_lots6 = w.assigned_lots6.saturating_add(assigned);
        w.open_lots6 = unassigned;
    }
    w.set_p_snap(series.p());
    w.scale_snap = series.scale;
    w.epoch_snap = series.epoch;
}

/// (unassigned, assigned) for a slot holding `open` lots since (`p_snap`, `scale_snap`, `epoch_snap`), both floored.
fn split(w: &WriterSlot, p: u128, scale: u8, epoch: u32) -> (u64, u64) {
    let open = w.open_lots6 as u128;
    if w.epoch_snap != epoch {
        return (0, w.open_lots6);
    }
    let diff = scale.wrapping_sub(w.scale_snap);
    if diff >= 2 || w.p_snap() == 0 {
        // Two rescales since the snapshot: the remaining fraction is below 1e-18 of a lot unit, treat as fully assigned.
        return (0, w.open_lots6);
    }
    let denom = if diff == 1 { w.p_snap() * P_SCALE } else { w.p_snap() };
    let unassigned = open * p / denom;
    let assigned = open * (denom - p) / denom;
    (unassigned as u64, assigned as u64)
}

/// Add `n` freshly sold lots to a slot (fold first so the new lots enter at the current product).
pub fn add_open(series: &Series, w: &mut WriterSlot, n: u64) {
    fold(series, w);
    w.open_lots6 = w.open_lots6.saturating_add(n);
    w.sold_lots6 = w.sold_lots6.saturating_add(n);
}

/// Collateral lots a writer can still withdraw or quote against: deposited, less withdrawn, less sold, less resident.
pub fn free_lots6(series: &Series, slot: usize) -> u64 {
    let w = &series.writers[slot];
    w.deposited_lots6
        .saturating_sub(w.withdrawn_lots6)
        .saturating_sub(w.sold_lots6)
        .saturating_sub(series.resident_lots6(slot))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn series() -> Series {
        let mut s: Series = bytemuck::Zeroable::zeroed();
        s.strike_usdc_per_lot = 180_306_215;
        s.set_p(P_ONE);
        s
    }

    fn sell(s: &mut Series, slot: usize, n: u64) {
        let mut w = s.writers[slot];
        add_open(s, &mut w, n);
        s.writers[slot] = w;
        s.total_sold_lots6 += n;
        s.unassigned_lots6 += n;
    }

    fn exercise(s: &mut Series, q: u64) {
        apply_exercise(s, q);
        s.total_exercised_lots6 += q;
    }

    fn settled(s: &Series, slot: usize) -> (u64, u64) {
        let mut w = s.writers[slot];
        fold(s, &mut w);
        (w.open_lots6, w.assigned_lots6)
    }

    #[test]
    fn late_writer_receives_none_of_earlier_proceeds() {
        // Adversary finding 1: A sells 100, all exercised; B sells 100 later; B must not be assigned.
        let mut s = series();
        sell(&mut s, 0, 100 * LOT6);
        exercise(&mut s, 100 * LOT6);
        sell(&mut s, 1, 100 * LOT6);
        assert_eq!(settled(&s, 0), (0, 100 * LOT6));
        assert_eq!(settled(&s, 1), (100 * LOT6, 0));
    }

    #[test]
    fn full_exercise_then_new_writer_does_not_divide_by_zero_or_reopen_the_skim() {
        // Skeptic A(b), B(b), Sonnet: q == U must not brick the series or let A claim B's collateral.
        let mut s = series();
        sell(&mut s, 0, 10 * LOT6);
        exercise(&mut s, 10 * LOT6);
        assert_eq!(s.p(), P_ONE);
        assert_eq!(s.epoch, 1);
        sell(&mut s, 1, 5 * LOT6);
        exercise(&mut s, 1 * LOT6);
        assert_eq!(settled(&s, 0), (0, 10 * LOT6));
        let (b_open, b_assigned) = settled(&s, 1);
        assert_eq!(b_open + b_assigned, 5 * LOT6);
        assert_eq!(b_assigned, 1 * LOT6);
    }

    #[test]
    fn three_round_griefing_does_not_overflow() {
        // Skeptic A(c): fill 1 lot, exercise all but one unit, repeatedly; then a new fill must still work.
        let mut s = series();
        for round in 0..6 {
            sell(&mut s, round, 1 * LOT6);
            let u = s.unassigned_lots6;
            exercise(&mut s, u - 1);
        }
        sell(&mut s, 6, 1 * LOT6);
        let (open, assigned) = settled(&s, 6);
        assert_eq!(open, 1 * LOT6);
        assert_eq!(assigned, 0);
        // Every earlier writer is fully assigned except dust.
        for slot in 0..6 {
            let (open, assigned) = settled(&s, slot);
            assert!(open <= 1, "slot {slot} open {open}");
            assert!(assigned >= LOT6 - 1, "slot {slot} assigned {assigned}");
        }
    }

    #[test]
    fn one_unit_exercise_never_leaves_the_last_settler_short() {
        // Skeptic B(a): two writers of 1e6 units, one exercise of a single unit. Sum of assigned floors <= exercised.
        let mut s = series();
        sell(&mut s, 0, LOT6);
        sell(&mut s, 1, LOT6);
        exercise(&mut s, 1);
        let (a_open, a_assigned) = settled(&s, 0);
        let (b_open, b_assigned) = settled(&s, 1);
        assert!(a_assigned + b_assigned <= s.total_exercised_lots6);
        assert!(a_open + b_open <= s.unassigned_lots6);
        assert!(a_open + a_assigned <= LOT6 && b_open + b_assigned <= LOT6);
    }

    #[test]
    fn equal_writers_get_equal_payouts_regardless_of_exercise_timing() {
        // Addendum F: two writers with equal sold, exercises on day one and day six, identical outcomes.
        let mut s = series();
        sell(&mut s, 0, 50 * LOT6);
        sell(&mut s, 1, 50 * LOT6);
        exercise(&mut s, 10 * LOT6);
        exercise(&mut s, 30 * LOT6);
        assert_eq!(settled(&s, 0), settled(&s, 1));
        let (open, assigned) = settled(&s, 0);
        assert_eq!(open, 30 * LOT6);
        assert_eq!(assigned, 20 * LOT6);
    }

    #[test]
    fn interleaved_fills_and_exercises_match_pro_rata_among_open_shorts() {
        // Skeptic A(a) sequence in lots: A7 ex3 B11 ex5 C13 ex2 A3 ex7.
        let mut s = series();
        sell(&mut s, 0, 7 * LOT6);
        exercise(&mut s, 3 * LOT6);
        sell(&mut s, 1, 11 * LOT6);
        exercise(&mut s, 5 * LOT6);
        sell(&mut s, 2, 13 * LOT6);
        exercise(&mut s, 2 * LOT6);
        sell(&mut s, 0, 3 * LOT6);
        exercise(&mut s, 7 * LOT6);
        let total_open: u64 = (0..3).map(|i| settled(&s, i).0).sum();
        let total_assigned: u64 = (0..3).map(|i| settled(&s, i).1).sum();
        assert!(total_open <= s.unassigned_lots6 && s.unassigned_lots6 - total_open <= 3);
        assert!(total_assigned <= s.total_exercised_lots6 && s.total_exercised_lots6 - total_assigned <= 3);
        // Exact rationals: A ends with 4 * (6/13) * (8/10) ... computed independently below.
        // A: 7 -> after ex3 4 (A alone). Then B 11 -> pool 15, ex5 -> A 4*10/15=2.6667, B 7.3333. C 13 -> pool 23,
        // ex2 -> A 2.4348, B 6.6957, C 11.8696. A +3 -> A 5.4348, pool 24, ex7 -> A 5.4348*17/24=3.8496.
        let (a_open, _) = settled(&s, 0);
        assert!((a_open as i128 - 3_849_638).abs() <= 2, "a_open {a_open}");
    }

    #[test]
    fn p_reaching_zero_rolls_the_epoch_instead_of_bricking_later_writers() {
        // Skeptic finding 3: u = 1e9 units, exercise u - 1, sell 1e9 more, exercise u - 1 again drives p to 0.
        let mut s = series();
        sell(&mut s, 0, 1_000_000_000);
        let u = s.unassigned_lots6;
        exercise(&mut s, u - 1);
        sell(&mut s, 1, 1_000_000_000);
        let u = s.unassigned_lots6;
        exercise(&mut s, u - 1);
        assert!(s.p() > 0, "p must never be zero");
        // A writer joining now folds and settles without a division by zero, and is unassigned on what it sold.
        sell(&mut s, 2, 100 * LOT6);
        exercise(&mut s, 1);
        let (open, assigned) = settled(&s, 2);
        assert!(open + assigned <= 100 * LOT6 && open >= 100 * LOT6 - 2, "open {open} assigned {assigned}");
        for slot in 0..2 {
            let (open, assigned) = settled(&s, slot);
            assert!(open <= 2, "old writer {slot} open {open}");
            assert!(assigned <= 1_000_000_000);
        }
    }

    #[test]
    fn usdc_rounding_directions() {
        assert_eq!(usdc_owed_ceil(500_000, 180_306_215), Some(90_153_108));
        assert_eq!(usdc_paid_floor(500_000, 180_306_215), Some(90_153_107));
        assert_eq!(fee_ceil(54_000_000, 10), 54_000);
        assert_eq!(fee_ceil(1, 10), 1);
    }
}
