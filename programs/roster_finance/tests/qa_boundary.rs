//! Adversarial QA (boundary / integer-math lens, 2026-09-17), kept as the regression for feedback finding F1: after
//! a 1000-lot pool is exercised down to one unit `p` sits on `P_FLOOR`; a later 5000-lot writer must still settle,
//! the settlement vault must never pay out more than the exercises put in, and the series must close.

mod common;

use {common::*, roster_finance::state::*, solana_signer::Signer};

const K180: u64 = 180 * USDC;

#[test]
fn qa_p_at_floor_every_writer_settles_and_the_series_closes() {
    let mut env = Env::new();
    let payer = env.authority.insecure_clone();
    let series = env.create_series(&payer, Side::Call, K180, env.expiries[0]).unwrap();
    let a = env.wallet(1_000, 0);
    let b = env.wallet(5_000, 0);
    let h = env.wallet(0, 1_000_000);

    // A sells 1000 lots; the holder exercises all but one unit: p = 1e18 * 1 / 1e9 = P_FLOOR.
    env.quote(&a, &series, 1_000 * LOT, 1_000 * LOT, 1_000).unwrap();
    env.buy(&h, &series, 1_000 * LOT, 1_000).unwrap();
    env.exercise(&h, &series, 1_000 * LOT - 1).unwrap();
    assert_eq!(load_series(&env.svm, &series).p(), P_FLOOR);

    // B sells 5000 lots at p = P_FLOOR; one more unit is exercised.
    env.quote(&b, &series, 5_000 * LOT, 5_000 * LOT, 1_000).unwrap();
    env.buy(&h, &series, 5_000 * LOT, 1_000).unwrap();
    env.exercise(&h, &series, 1).unwrap();

    let s = load_series(&env.svm, &series);
    let settlement_before = balance(&env.svm, &s.settlement_vault);
    assert_eq!(settlement_before, (1_000 * LOT - 1) * 180 + 180, "vault holds exactly the strike paid");

    warp_to(&mut env.svm, env.expiries[0]);
    env.settle_writer(&a.pubkey(), &series).unwrap();
    env.settle_writer(&b.pubkey(), &series).unwrap();
    // The two writers' assignments add up to the exercises, less at most one unit of dust each, and the settlement
    // vault paid out exactly the strike on those assignments: never more than the exercises put in.
    let sa = load_series(&env.svm, &series);
    let assigned: u64 = sa.writers.iter().map(|w| w.assigned_lots6).sum();
    assert!(assigned <= sa.total_exercised_lots6 && sa.total_exercised_lots6 - assigned <= 2, "assigned {assigned} vs exercised {}", sa.total_exercised_lots6);
    let paid_out = settlement_before - balance(&env.svm, &s.settlement_vault);
    assert_eq!(paid_out, assigned * 180, "settlement vault paid the strike on the assigned units");
    assert!(paid_out <= settlement_before);
    warp_to(&mut env.svm, env.expiries[0] + 3600);
    env.close_series(&series).unwrap();
}
