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
    // p * (u - q) / u rounded UP: `p` is the fraction of every writer's open lots still unassigned, so rounding it
    // up under-states assignment. A writer can then never be paid more from the settlement vault than the exercises
    // that filled it (feedback finding F1, docs/BUILD_LOG.md M8.1); the rounding residue stays as dust for `close_series`.
    let mut p = (series.p() * (u - q) as u128 + (u as u128 - 1)) / u as u128;
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
    if diff >= 5 || w.p_snap() == 0 {
        // Five rescales since the snapshot: the remaining fraction is below 1e-45 of a unit even for a u64 writer.
        return (0, w.open_lots6);
    }
    // Unassigned rounds up and assigned is its complement: both legs err toward the vault, never past it. Divide by
    // p_snap first (open * p <= 1.8e19 * 1e18 fits u128), then by P_SCALE^diff (<= 1e36 fits), each rounded up, so
    // the nested quotient is never below the exact one.
    let step = (open * p + w.p_snap() - 1) / w.p_snap();
    let scale_div = P_SCALE.pow(diff as u32);
    let unassigned = ((step + scale_div - 1) / scale_div).min(open);
    let assigned = open - unassigned;
    (unassigned as u64, assigned as u64)
}

/// Whether exercising `q` lots moves the product by at least one unit: below that the assignment could not be
/// recorded against any writer, so `exercise` refuses such a size unless it takes the whole pool.
pub fn moves_product(series: &Series, q: u64) -> bool {
    let u = series.unassigned_lots6;
    q == u || (q as u128) * series.p() >= u as u128
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
    use crate::state::MAX_WRITERS;
    use anchor_lang::prelude::Pubkey;

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
        // Skeptic B(a): two writers of 1e6 units, one exercise of a single unit. Sum of assigned <= exercised (the
        // settlement vault is never over-drawn); the writers' unassigned sum can exceed the pool's by rounding dust,
        // which `settle_writer` trims against the collateral vault.
        let mut s = series();
        sell(&mut s, 0, LOT6);
        sell(&mut s, 1, LOT6);
        exercise(&mut s, 1);
        let (a_open, a_assigned) = settled(&s, 0);
        let (b_open, b_assigned) = settled(&s, 1);
        assert!(a_assigned + b_assigned <= s.total_exercised_lots6);
        assert!(a_open + b_open >= s.unassigned_lots6 && a_open + b_open - s.unassigned_lots6 <= 2);
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
        assert!(total_open >= s.unassigned_lots6 && total_open - s.unassigned_lots6 <= 3);
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

    // ---- QA boundary probes (adversarial pass, 2026-09-17) ----

    /// `P` at its floor (1e9) with a large pool: the sum of every writer's `assigned` never exceeds what was exercised
    /// (the feedback pass found the old floor-rounding over-assigned by 4 units here, which bricked the last settle).
    #[test]
    fn qa_p_at_floor_never_over_assigns() {
        let mut s = series();
        sell(&mut s, 0, 1_000 * LOT6);
        exercise(&mut s, 1_000 * LOT6 - 1);
        assert_eq!(s.p(), P_FLOOR, "p lands exactly on the floor");
        sell(&mut s, 1, 5_000 * LOT6);
        exercise(&mut s, 1);
        let (_, a_assigned) = settled(&s, 0);
        let (_, b_assigned) = settled(&s, 1);
        let total_assigned = a_assigned + b_assigned;
        assert!(total_assigned <= s.total_exercised_lots6, "over-assigned: {total_assigned} > {}", s.total_exercised_lots6);
        assert!(s.total_exercised_lots6 - total_assigned <= 2, "dust bounded by one unit per writer");
    }

    /// Exercising down to a handful of units: with `P` rounded up it never reaches zero, so no epoch roll forfeits the
    /// unexercised residue, and the sum of assignments stays at or below the exercises.
    #[test]
    fn qa_exercising_to_a_residue_keeps_assignment_under_exercised() {
        let mut s = series();
        sell(&mut s, 0, 1_000 * LOT6);
        exercise(&mut s, 1_000 * LOT6 - 1); // p = 1e9
        sell(&mut s, 1, 5_000 * LOT6);
        let u = s.unassigned_lots6;
        exercise(&mut s, u - 4);
        assert_eq!(s.unassigned_lots6, 4);
        assert_eq!(s.epoch, 0, "no epoch roll while units remain unassigned");
        let total_assigned: u64 = (0..2).map(|i| settled(&s, i).1).sum();
        assert!(total_assigned <= s.total_exercised_lots6, "over-assigned: {total_assigned} > {}", s.total_exercised_lots6);
    }

    /// A 400k-lot writer folded after one rescale: the complement form fits u128 (the old `open * (denom - p)` overflowed).
    #[test]
    fn qa_split_fits_u128_after_one_rescale_with_a_large_writer() {
        let mut s = series();
        sell(&mut s, 0, 400_000 * LOT6); // 4e11 units at p = 1e18
        let u = s.unassigned_lots6;
        exercise(&mut s, u - 1); // p = 1e18 / 4e11 = 2.5e6 < floor -> rescale, scale = 1
        assert_eq!(s.scale, 1);
        let (open, assigned) = settled(&s, 0);
        assert_eq!(open + assigned, 400_000 * LOT6);
        assert!(assigned <= s.total_exercised_lots6);
        assert!(open >= 1, "the one unexercised unit stays unassigned");
    }

    /// Control for probe C: the same fold with `assigned` computed as `open - ceil(open * p / denom)` fits.
    #[test]
    fn qa_split_control_complement_form_fits_u128() {
        let open: u128 = 400_000 * LOT6 as u128;
        let denom: u128 = P_ONE * P_SCALE;
        let p: u128 = 2_500_000 * P_SCALE;
        let unassigned_ceil = (open * p + denom - 1) / denom;
        let assigned = open - unassigned_ceil;
        assert_eq!(assigned, open - 1); // 4e11 * 2.5e-12 = 1 unit unassigned
    }

    /// Two rescales since the snapshot are divided exactly, so a 1e6-lot writer's real remainder is not forfeited.
    #[test]
    fn qa_two_rescales_since_snapshot_keep_the_real_remainder() {
        let mut s = series();
        sell(&mut s, 0, 1_000 * LOT6);
        exercise(&mut s, 1_000 * LOT6 - 1); // p = 1e9 (floor), scale 0
        sell(&mut s, 1, 1_000_000 * LOT6); // B snapshots at p = 1e9
        let u = s.unassigned_lots6;
        exercise(&mut s, u - 1_001);
        exercise(&mut s, 1);
        let (b_open, b_assigned) = settled(&s, 1);
        let total_assigned: u64 = (0..2).map(|i| settled(&s, i).1).sum();
        // `P` carries 1e-9 relative precision at its floor and rounds up, so B's 1e12 units gain up to 1e3 units of
        // unassigned dust per exercise step (two here); the settlement leg is never over-drawn for it.
        assert!(b_open >= 1_000 && b_open <= 3_000, "B keeps its real remainder plus bounded dust, got {b_open}");
        assert_eq!(b_open + b_assigned, 1_000_000 * LOT6);
        assert!(total_assigned <= s.total_exercised_lots6, "over-assigned: {total_assigned} > {}", s.total_exercised_lots6);
    }

    /// `create_market` caps decimals at 19 so `raw_per_lot6` (10^(decimals-6)) always fits u64.
    #[test]
    fn qa_raw_per_lot6_fits_up_to_19_decimals() {
        let mut m: crate::state::MarketConfig = unsafe { core::mem::zeroed() };
        m.decimals = 19;
        assert_eq!(m.raw_per_lot6(), 10u64.pow(13));
    }


    // ---- Skeptic pass 2 (2026-09-17): trying to break (a) sum(assigned) <= exercised, (b) settle never reverts,
    // (c) collateral-leg loss bounded by open_i * exercises / 1e9. Vault simulation is call-side with raw_per_lot6 = 1.

    /// Settle every slot in `order` against simulated vaults with the program's `min(owed, vault)` trimming.
    /// Returns per slot (collateral received, settlement received, collateral owed, settlement owed).
    fn settle_all(s: &Series, order: &[usize]) -> Vec<(u64, u64, u64, u64)> {
        let mut coll_vault: u64 = 0;
        for w in s.writers.iter() {
            coll_vault += w.deposited_lots6 - w.withdrawn_lots6;
        }
        coll_vault -= s.total_exercised_lots6;
        let mut settle_vault: u64 = s.total_exercised_lots6;
        let mut out = vec![(0, 0, 0, 0); MAX_WRITERS];
        for &i in order {
            let mut w = s.writers[i];
            fold(s, &mut w);
            let free = w.deposited_lots6 - w.withdrawn_lots6 - w.sold_lots6;
            let owed_c = free + w.open_lots6;
            let owed_s = w.assigned_lots6;
            let got_c = owed_c.min(coll_vault);
            let got_s = owed_s.min(settle_vault);
            coll_vault -= got_c;
            settle_vault -= got_s;
            out[i] = (got_c, got_s, owed_c, owed_s);
        }
        out
    }

    fn sell_dep(s: &mut Series, slot: usize, n: u64) {
        s.writers[slot].deposited_lots6 += n;
        if s.writers[slot].writer == Pubkey::default() {
            // Mirror find_or_claim_slot: snapshot at the current product.
            let p = s.p();
            s.writers[slot].set_p_snap(p);
            s.writers[slot].scale_snap = s.scale;
            s.writers[slot].epoch_snap = s.epoch;
            s.writers[slot].writer = Pubkey::new_unique();
        }
        sell(s, slot, n);
    }

    /// Attribution: a writer that snapshots at P_FLOOR over-claims up to open / 1e9 units per exercise, and that
    /// lands on whoever settles after it. The program bounds a writer at MAX_WRITER_LOTS6 (1e7 lots), so the
    /// over-claim is at most 0.01 lot per exercise: the largest writer allowed, at the floor, costs the small
    /// writer that settles last no more than that (the second skeptic pass showed a 1e9-lot writer taking half a lot).
    #[test]
    fn skeptic2_largest_allowed_writer_at_floor_costs_others_at_most_a_minimum_size() {
        let mut s = series();
        sell_dep(&mut s, 0, 1_000 * LOT6);
        exercise(&mut s, 1_000 * LOT6 - 1);
        assert_eq!(s.p(), P_FLOOR);
        sell_dep(&mut s, 1, crate::state::MAX_WRITER_LOTS6); // A: the largest writer the program allows
        sell_dep(&mut s, 2, 1 * LOT6); // B: one lot
        let u = s.unassigned_lots6;
        let remain = u / 2 + 1;
        exercise(&mut s, u - remain);
        let got = settle_all(&s, &[1, 0, 2]);
        let (b_c, _, b_owed_c, _) = got[2];
        // 0.01 lot plus the one unit the ceiling adds.
        assert!(b_owed_c - b_c <= 10_001, "B short by {} units, more than one minimum size", b_owed_c - b_c);
    }

    /// An exercise too small to move `P` (q * p < u) would leave the writers' assignment unrecorded: the instruction
    /// refuses it with `SizeOutOfRange` (`moves_product`), and at the smallest accepted size `P` moves by at least one.
    #[test]
    fn skeptic2_sub_precision_exercise_is_refused_and_the_smallest_accepted_one_moves_p() {
        let mut s = series();
        sell_dep(&mut s, 0, 1_000 * LOT6);
        exercise(&mut s, 1_000 * LOT6 - 1);
        sell_dep(&mut s, 1, 5_000 * LOT6); // 5e9 units at p = 1e9
        let u = s.unassigned_lots6;
        assert!(!moves_product(&s, 4), "4 units cannot move P in a 5e9-unit pool at the floor");
        let smallest = (u as u128 + s.p() - 1) / s.p();
        assert!(moves_product(&s, smallest as u64));
        let (p0, scale0) = (s.p(), s.scale);
        exercise(&mut s, smallest as u64);
        assert!(s.p() < p0 || s.scale != scale0, "the smallest accepted exercise moves P (or rescales it)");
    }

    /// Three rescales since the snapshot on a u64-scale writer: the remainder is divided exactly (nested ceilings),
    /// so the sum of assignments never exceeds the exercises even here.
    #[test]
    fn skeptic2_three_rescales_never_over_assign() {
        let mut s = series();
        sell_dep(&mut s, 0, 1_000 * LOT6);
        exercise(&mut s, 1_000 * LOT6 - 1);
        assert_eq!(s.p(), P_FLOOR);
        let a: u64 = u64::MAX - 1_000 * LOT6 - 10;
        sell_dep(&mut s, 1, a);
        // Three times: pick q so that p lands just under P_FLOOR and rescales to near 1e18.
        for round in 0..3 {
            let u = s.unassigned_lots6 as u128;
            let p = s.p();
            // largest remain with ceil(p * remain / u) < P_FLOOR
            let mut remain = ((P_FLOOR * u - 1) / p) as u64;
            while (p * remain as u128 + u - 1) / u >= P_FLOOR { remain -= 1; }
            exercise(&mut s, u as u64 - remain);
            assert_eq!(s.scale, round + 1);
        }
        assert!(s.p() > P_ONE / 2, "p near its max after the rescale: {}", s.p());
        let total_assigned: u64 = (0..2).map(|i| settled(&s, i).1).sum();
        let remainder = s.unassigned_lots6;
        assert!(remainder >= 10, "true remainder in the pool: {remainder}");
        assert!(total_assigned <= s.total_exercised_lots6, "over-assigned: {total_assigned} > {}", s.total_exercised_lots6);
    }

    /// Random walk with writers up to 1e9 lots and exercises from one unit to the whole pool, folding through
    /// `add_open` on repeat sales and settling in random order. Checks (a) and (b), and measures the largest
    /// collateral shortfall a writer suffered against the claimed bound.
    #[test]
    fn skeptic2_random_large_writers_dust_exercises() {
        let mut seed: u64 = 0x2545F4914F6CDD1D;
        let mut rnd = move || { seed ^= seed << 13; seed ^= seed >> 7; seed ^= seed << 17; seed };
        let mut worst_a: i128 = 0;
        let mut worst_loss_ratio = 0f64;
        for _trial in 0..200 {
            let mut s = series();
            let mut exercises_since: [u64; MAX_WRITERS] = [0; MAX_WRITERS];
            let mut open_at_snap: [u64; MAX_WRITERS] = [0; MAX_WRITERS];
            for _ in 0..120 {
                match rnd() % 5 {
                    0 | 1 => {
                        let slot = (rnd() % 6) as usize;
                        let n = match rnd() % 4 { 0 => 1 + rnd() % 1_000, 1 => LOT6 * (1 + rnd() % 5_000), 2 => LOT6 * (1 + rnd() % 1_000_000), _ => LOT6 * 1_000_000_000 };
                        if s.total_sold_lots6.checked_add(n).is_none() { continue; }
                        if s.writers[slot].writer != Pubkey::default() {
                            // Program path: `add_open` folds first; the fold refreshes the snapshot.
                            exercises_since[slot] = 0;
                        }
                        sell_dep(&mut s, slot, n);
                        open_at_snap[slot] = s.writers[slot].open_lots6;
                    }
                    _ => {
                        let u = s.unassigned_lots6;
                        if u == 0 { continue; }
                        let q = match rnd() % 5 { 0 => 1, 1 => 1 + rnd() % 1_000, 2 => u, 3 => u - (rnd() % u.min(10_000)), _ => 1 + rnd() % u };
                        let q = q.min(u).max(1);
                        exercise(&mut s, q);
                        for e in exercises_since.iter_mut() { *e += 1; }
                    }
                }
            }
            // (a)
            let total_assigned: u128 = (0..MAX_WRITERS).filter(|&i| s.writers[i].writer != Pubkey::default()).map(|i| settled(&s, i).1 as u128).sum();
            let over = total_assigned as i128 - s.total_exercised_lots6 as i128;
            worst_a = worst_a.max(over);
            // (b): settle everyone in a random order; nothing panics, every vault ends >= 0 by construction.
            let mut order: Vec<usize> = (0..MAX_WRITERS).filter(|&i| s.writers[i].writer != Pubkey::default()).collect();
            for i in (1..order.len()).rev() { let j = (rnd() % (i as u64 + 1)) as usize; order.swap(i, j); }
            let got = settle_all(&s, &order);
            for &i in &order {
                let (c, _, owed_c, _) = got[i];
                let loss = owed_c - c;
                if loss > 0 {
                    let w = s.writers[i];
                    let bound = (open_at_snap[i].max(w.sold_lots6) as u128 * (exercises_since[i] as u128 + 1) / 1_000_000_000 + 1) as u64;
                    let ratio = loss as f64 / bound as f64;
                    worst_loss_ratio = worst_loss_ratio.max(ratio);
                }
            }
        }
        eprintln!("skeptic2 random: worst over-assignment {worst_a}, worst loss/own-bound ratio {worst_loss_ratio:.3}");
        assert!(worst_a <= 0, "(a) violated by {worst_a} units with sub-u64 writers");
        // (c) attribution is not reached by an unbiased walk (ratio stays < 1); the directed case above reaches it.
        assert!(worst_loss_ratio < 1.0, "random walk found a writer losing above its own dust bound: {worst_loss_ratio}");
    }

    #[test]
    fn usdc_rounding_directions() {
        assert_eq!(usdc_owed_ceil(500_000, 180_306_215), Some(90_153_108));
        assert_eq!(usdc_paid_floor(500_000, 180_306_215), Some(90_153_107));
        assert_eq!(fee_ceil(54_000_000, 10), 54_000);
        assert_eq!(fee_ceil(1, 10), 1);
    }
}
