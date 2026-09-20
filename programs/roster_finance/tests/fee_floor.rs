//! A Floor on a transfer-fee mint (the PreStocks shape, 50 bps): the holder delivers gross so exactly the raw amount
//! reaches the settlement vault, three writers at prime sizes are assigned pro rata, and every one of them is paid
//! the raw they are owed less only the mint's own fee on the way out. Nothing is stranded beyond the addendum E dust.

mod common;

use {
    common::*,
    roster_finance::state::*,
    solana_signer::Signer,
};

const K180: u64 = 180 * USDC;
const FEE_BPS: u64 = 50;

fn fee_on(raw: u64) -> u64 {
    (raw * FEE_BPS).div_ceil(10_000)
}
/// What must be sent so that `raw` arrives: the crate's inverse fee, `ceil(raw x 10000 / (10000 - bps))`.
fn gross_of(raw: u64) -> u64 {
    (raw as u128 * 10_000).div_ceil(10_000 - FEE_BPS as u128) as u64
}

#[test]
fn floor_on_a_fee_mint_delivers_gross_and_settles_every_writer_to_the_unit() {
    let mut env = Env::with_fee(FEE_BPS as u16);
    assert!(load_market(&env.svm, &env.market).has_transfer_fee);
    let expiry = env.expiries[0];
    // The guard is gone: a Put series on a fee mint is created like any other.
    let series = env.create_series(&env.authority.insecure_clone(), Side::Put, K180, expiry).unwrap();

    // Three writers lock USDC at prime sizes; puts are USDC-collateralised, so no fee on this leg.
    let sizes = [7u64, 11, 13];
    let writers: Vec<_> = sizes.iter().map(|_| env.wallet(0, 20_000)).collect();
    for (w, n) in writers.iter().zip(sizes) {
        env.quote(w, &series, n * LOT, n * LOT, 2 * USDC).unwrap();
    }

    // A holder buys all 31 lots and exercises 17 of them: delivers 17 lots of tokens, receives 17 x 180 USDC.
    let holder = env.wallet(40, 1_000);
    env.buy(&holder, &series, 31 * LOT, 3 * USDC).unwrap();
    let tokens_before = balance(&env.svm, &env.nv(&holder.pubkey()));
    let usdc_before = balance(&env.svm, &env.us(&holder.pubkey()));
    env.exercise(&holder, &series, 17 * LOT).unwrap();
    let raw = 17 * LOT * RAW_PER_LOT6;
    let sent = tokens_before - balance(&env.svm, &env.nv(&holder.pubkey()));
    assert_eq!(sent, gross_of(raw), "the holder delivers gross so that exactly raw arrives");
    assert_eq!(balance(&env.svm, &env.us(&holder.pubkey())) - usdc_before, 17 * K180, "and is paid the full strike");
    let s = load_series(&env.svm, &series);
    assert_eq!(balance(&env.svm, &s.settlement_vault), raw, "exactly the raw amount reached the settlement vault");
    assert_eq!(s.total_exercised_lots6, 17 * LOT);

    // Expiry; everyone settles. Each writer receives their assigned raw less the mint's fee on that transfer, and
    // the unassigned strike USDC back; the last settler is not shorted.
    warp_to(&mut env.svm, expiry + 1);
    let mut raw_paid_gross = 0u64;
    for w in &writers {
        let t0 = balance(&env.svm, &env.nv(&w.pubkey()));
        env.settle_writer(&w.pubkey(), &series).unwrap();
        let got = balance(&env.svm, &env.nv(&w.pubkey())) - t0;
        let s = load_series(&env.svm, &series);
        let slot = s.writer_slot(&w.pubkey()).unwrap();
        let mut f = s.writers[slot];
        roster_finance::math::fold(&s, &mut f);
        let owed = f.assigned_lots6 * RAW_PER_LOT6;
        assert_eq!(got, owed - fee_on(owed), "writer {} receives its raw less the mint's fee on the way out", slot);
        raw_paid_gross += owed;
    }
    let s = load_series(&env.svm, &series);
    assert!(s.writers.iter().filter(|w| !w.is_empty()).all(|w| w.is_settled()));
    // What the writers were charged sums to what was exercised, within addendum E dust; the vault holds the rest.
    assert!(raw <= raw_paid_gross + 3 * RAW_PER_LOT6 && raw_paid_gross <= raw, "assigned {raw_paid_gross} vs exercised {raw}");
    assert!(balance(&env.svm, &s.settlement_vault) <= 3 * RAW_PER_LOT6, "settlement dust {}", balance(&env.svm, &s.settlement_vault));
    assert_eq!(balance(&env.svm, &s.collateral_vault), 0, "every lot of strike USDC went to a holder or a writer");
}
