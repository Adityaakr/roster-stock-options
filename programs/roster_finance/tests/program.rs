//! The P1 test list (CLAUDE.md 4.2, addendum C to F, the skeptic counterexamples) on litesvm against a synthetic
//! NVDAx replica. The same lifecycle on the real mint with surfnet_timeTravel lives in tests/e2e (TypeScript).

mod common;

use {
    anchor_spl::token_2022::spl_token_2022,
    common::*,
    roster_finance::{math::{usdc_owed_ceil, usdc_paid_floor}, state::*},
    solana_signer::Signer,
    spl_token_2022::extension::{BaseStateWithExtensions, StateWithExtensions},
};

const K180: u64 = 180 * USDC;

fn call_series(env: &mut Env) -> anchor_lang::prelude::Pubkey {
    let payer = env.authority.insecure_clone();
    env.create_series(&payer, Side::Call, K180, env.expiries[0]).unwrap()
}

#[test]
fn create_series_mints_a_position_token_with_metadata_and_pooled_vaults() {
    let mut env = Env::new();
    let series = call_series(&mut env);
    let s = load_series(&env.svm, &series);
    assert_eq!(s.strike_usdc_per_lot, K180);
    assert_eq!(s.p(), P_ONE);
    assert!(s.is_open());
    let m = load_market(&env.svm, &env.market);
    assert_eq!(m.live_series, 1);
    assert_eq!(m.decimals, 8);
    assert!(m.pausable && !m.has_transfer_fee && m.hook_program == anchor_lang::prelude::Pubkey::default());
    // Token-2022 mint, 6 decimals, metadata on the mint itself naming the term.
    let data = env.svm.get_account(&s.position_mint).unwrap().data;
    let mint = StateWithExtensions::<spl_token_2022::state::Mint>::unpack(&data).unwrap();
    assert_eq!(mint.base.decimals, 6);
    assert_eq!(mint.base.supply, 0);
    let meta = mint.get_variable_len_extension::<anchor_spl::token_interface::spl_token_metadata_interface::state::TokenMetadata>().unwrap();
    assert!(meta.name.contains("Gap"), "{}", meta.name);
    assert_eq!(meta.symbol, "RC180");
    assert_eq!(balance(&env.svm, &s.collateral_vault), 0);
}

#[test]
fn off_grid_series_are_rejected_and_the_cap_holds() {
    let mut env = Env::new();
    let payer = env.authority.insecure_clone();
    expect_err(env.create_series(&payer, Side::Call, 180 * USDC + 1, env.expiries[0]).map(|_| ()), "StrikeOffGrid");
    expect_err(env.create_series(&payer, Side::Call, K180, env.expiries[0] + 1).map(|_| ()), "ExpiryOffGrid");
    // A put at the same strike and expiry is a different series and counts toward the cap.
    env.create_series(&payer, Side::Put, K180, env.expiries[0]).unwrap();
    assert_eq!(load_market(&env.svm, &env.market).live_series, 1);
}

#[test]
fn quote_buy_walks_three_asks_and_pays_fees_once() {
    let mut env = Env::new();
    let series = call_series(&mut env);
    let a = env.wallet(200, 0);
    let b = env.wallet(200, 0);
    let c = env.wallet(200, 0);
    let h = env.wallet(0, 100_000);
    env.quote(&a, &series, 100 * LOT, 100 * LOT, 5_400_000).unwrap();
    env.quote(&b, &series, 50 * LOT, 50 * LOT, 5_500_000).unwrap();
    env.quote(&c, &series, 30 * LOT, 30 * LOT, 5_600_000).unwrap();
    let s = load_series(&env.svm, &series);
    assert_eq!(s.asks_len, 3);
    assert_eq!(balance(&env.svm, &s.collateral_vault), 180 * LOT * RAW_PER_LOT6);

    // Below the best ask: nothing fills.
    expect_err(env.buy(&h, &series, 10 * LOT, 5_000_000), "QuoteMoved");
    // 120 lots at up to 5.5: A's 100 at 5.4 then 20 of B's at 5.5.
    let usdc_before = balance(&env.svm, &env.us(&h.pubkey()));
    env.buy(&h, &series, 120 * LOT, 5_500_000).unwrap();
    let s = load_series(&env.svm, &series);
    let pm = s.position_mint;
    assert_eq!(balance(&env.svm, &ata(&h.pubkey(), &pm, &spl_token_2022::id())), 120 * LOT);
    assert_eq!(mint_supply(&env.svm, &pm), 120 * LOT);
    assert_eq!(s.total_sold_lots6, 120 * LOT);
    assert_eq!(s.unassigned_lots6, 120 * LOT);
    assert_eq!(s.asks_len, 2);
    assert_eq!(s.asks[0].remaining_lots6, 30 * LOT);
    let premium = 100 * 5_400_000 + 20 * 5_500_000;
    let fee = (premium * 10 + 9_999) / 10_000;
    assert_eq!(usdc_before - balance(&env.svm, &env.us(&h.pubkey())), premium);
    assert_eq!(balance(&env.svm, &env.fee_vault), fee);
    let sa = s.writers[s.writer_slot(&a.pubkey()).unwrap()];
    let sb = s.writers[s.writer_slot(&b.pubkey()).unwrap()];
    assert_eq!(sa.sold_lots6, 100 * LOT);
    assert_eq!(sb.sold_lots6, 20 * LOT);
    let fee_a = (100 * 5_400_000 * 10 + 9_999) / 10_000;
    assert_eq!(sa.premium_claimable, 100 * 5_400_000 - fee_a);
    // Writers pull premium any time.
    env.claim_premium(&a, &series).unwrap();
    assert_eq!(balance(&env.svm, &env.us(&a.pubkey())), 100 * 5_400_000 - fee_a);
    // Partial fill: 500 requested, 60 left on the book.
    env.buy(&h, &series, 500 * LOT, 6_000_000).unwrap();
    let s = load_series(&env.svm, &series);
    assert_eq!(s.total_sold_lots6, 180 * LOT);
    assert_eq!(s.asks_len, 0);
}

#[test]
fn exercise_windows_and_rejections() {
    let mut env = Env::new();
    let series = call_series(&mut env);
    let a = env.wallet(200, 0);
    let h = env.wallet(0, 100_000);
    env.quote(&a, &series, 100 * LOT, 100 * LOT, 5_400_000).unwrap();
    env.buy(&h, &series, 100 * LOT, 5_400_000).unwrap();
    let s = load_series(&env.svm, &series);
    let expiry = s.expiry_ts;

    // Day one: 30 lots. Holder pays ceil(30 x 180) USDC and receives 30 lots of raw.
    let nv_before = balance(&env.svm, &env.nv(&h.pubkey()));
    env.exercise(&h, &series, 30 * LOT).unwrap();
    assert_eq!(balance(&env.svm, &env.nv(&h.pubkey())) - nv_before, 30 * LOT * RAW_PER_LOT6);
    assert_eq!(balance(&env.svm, &s.settlement_vault), usdc_owed_ceil(30 * LOT, K180).unwrap());
    // Mid window.
    warp_to(&mut env.svm, T0 + 3 * DAY);
    env.exercise(&h, &series, 10 * LOT).unwrap();
    // One second before expiry.
    warp_to(&mut env.svm, expiry - 1);
    env.exercise(&h, &series, 10 * LOT).unwrap();
    // More than the pool has open: rejected before any transfer. More than held (a second holder with 10): rejected.
    expect_err(env.exercise(&h, &series, 60 * LOT), "SizeOutOfRange");
    let h2 = env.wallet(0, 100_000);
    let s2 = load_series(&env.svm, &series);
    let pm = s2.position_mint;
    let ix = spl_token_2022::instruction::transfer_checked(&spl_token_2022::id(), &ata(&h.pubkey(), &pm, &spl_token_2022::id()), &pm, &create_ata(&mut env.svm, &h2, &h2.pubkey(), &pm, &spl_token_2022::id()), &h.pubkey(), &[], 10 * LOT, 6).unwrap();
    send(&mut env.svm, &h, &[&h], &[ix]).unwrap();
    env.exercise(&h2, &series, 10 * LOT).unwrap();
    // The same holder cannot exercise the burned tokens twice.
    expect_err(env.exercise(&h2, &series, 1 * LOT), "InsufficientPosition");
    // After expiry: rejected; settle before expiry was rejected too.
    warp_to(&mut env.svm, expiry - 1);
    expect_err(env.settle_writer(&a.pubkey(), &series), "NotExpired");
    warp_to(&mut env.svm, expiry);
    expect_err(env.exercise(&h, &series, 1 * LOT), "Expired");
    let s = load_series(&env.svm, &series);
    assert_eq!(s.total_exercised_lots6, 60 * LOT);
    assert_eq!(s.unassigned_lots6, 40 * LOT);
    assert_eq!(mint_supply(&env.svm, &s.position_mint), 40 * LOT);
}

#[test]
fn settlement_pays_each_writer_pro_rata_of_open_shorts_and_close_reclaims_rent() {
    let mut env = Env::new();
    let series = call_series(&mut env);
    let a = env.wallet(200, 0);
    let b = env.wallet(200, 0);
    let c = env.wallet(200, 0);
    let h = env.wallet(0, 100_000);
    env.quote(&a, &series, 100 * LOT, 100 * LOT, 5_400_000).unwrap();
    env.quote(&b, &series, 50 * LOT, 50 * LOT, 5_500_000).unwrap();
    env.quote(&c, &series, 30 * LOT, 30 * LOT, 5_600_000).unwrap();
    env.buy(&h, &series, 120 * LOT, 5_500_000).unwrap();
    env.exercise(&h, &series, 30 * LOT).unwrap();
    let s = load_series(&env.svm, &series);
    let expiry = s.expiry_ts;
    warp_to(&mut env.svm, expiry);
    // Anyone can crank settlement; destinations are the writers' own ATAs.
    for w in [&a, &b, &c] {
        env.settle_writer(&w.pubkey(), &series).unwrap();
        expect_err(env.settle_writer(&w.pubkey(), &series), "AlreadySettled");
    }
    // A sold 100 of 120 open when 30 were exercised: assigned 25, unassigned 75. B sold 20: assigned 5, unassigned 15, free 30. C free 30.
    let nv = |env: &Env, k: &solana_keypair::Keypair| balance(&env.svm, &env.nv(&k.pubkey()));
    let us = |env: &Env, k: &solana_keypair::Keypair| balance(&env.svm, &env.us(&k.pubkey()));
    assert_eq!(nv(&env, &a), (200 - 100 + 75) * LOT * RAW_PER_LOT6);
    assert_eq!(nv(&env, &b), (200 - 50 + 30 + 15) * LOT * RAW_PER_LOT6);
    assert_eq!(nv(&env, &c), 200 * LOT * RAW_PER_LOT6);
    let fee_a = (100 * 5_400_000 * 10 + 9_999) / 10_000;
    let fee_b = (20 * 5_500_000 * 10 + 9_999) / 10_000;
    assert_eq!(us(&env, &a), usdc_paid_floor(25 * LOT, K180).unwrap() + 100 * 5_400_000 - fee_a);
    assert_eq!(us(&env, &b), usdc_paid_floor(5 * LOT, K180).unwrap() + 20 * 5_500_000 - fee_b);
    assert_eq!(us(&env, &c), 0);
    // Vaults hold only dust after every writer settled (here: exactly zero, the numbers divide).
    let s = load_series(&env.svm, &series);
    assert_eq!(balance(&env.svm, &s.collateral_vault), 0);
    assert_eq!(balance(&env.svm, &s.settlement_vault), 0);
    // Close needs the grace period; then rent returns to the payer and the mint stays because tokens are outstanding.
    expect_err(env.close_series(&series), "GraceNotElapsed");
    warp_to(&mut env.svm, expiry + 3600);
    let rent_before = env.svm.get_account(&env.authority.pubkey()).unwrap().lamports;
    env.close_series(&series).unwrap();
    assert!(env.svm.get_account(&series).map(|a| a.data.is_empty()).unwrap_or(true));
    assert!(env.svm.get_account(&env.authority.pubkey()).unwrap().lamports > rent_before);
    assert_eq!(mint_supply(&env.svm, &s.position_mint), 90 * LOT);
    assert_eq!(load_market(&env.svm, &env.market).live_series, 0);
}

#[test]
fn late_writer_gets_none_of_earlier_proceeds_on_chain() {
    // Adversary finding 1 and the Sonnet skeptic's zero case, end to end.
    let mut env = Env::new();
    let series = call_series(&mut env);
    let a = env.wallet(200, 0);
    let b = env.wallet(200, 0);
    let h = env.wallet(0, 100_000);
    env.quote(&a, &series, 100 * LOT, 100 * LOT, 5_400_000).unwrap();
    env.buy(&h, &series, 100 * LOT, 5_400_000).unwrap();
    env.exercise(&h, &series, 100 * LOT).unwrap(); // everything assigned to A; epoch rolls
    let s = load_series(&env.svm, &series);
    assert_eq!(s.epoch, 1);
    assert_eq!(s.unassigned_lots6, 0);
    env.quote(&b, &series, 100 * LOT, 100 * LOT, 100_000).unwrap();
    env.buy(&h, &series, 100 * LOT, 100_000).unwrap(); // B sells after the exercise
    let expiry = s.expiry_ts;
    warp_to(&mut env.svm, expiry);
    env.settle_writer(&a.pubkey(), &series).unwrap();
    env.settle_writer(&b.pubkey(), &series).unwrap();
    // A: 100 assigned -> 100 x 180 USDC, no tokens back. B: 100 unassigned -> all 100 lots back, no USDC from settlement.
    assert_eq!(balance(&env.svm, &env.nv(&a.pubkey())), 100 * LOT * RAW_PER_LOT6);
    assert_eq!(balance(&env.svm, &env.nv(&b.pubkey())), 200 * LOT * RAW_PER_LOT6);
    let fee_a = (100 * 5_400_000 * 10 + 9_999) / 10_000;
    let fee_b = (100 * 100_000 * 10 + 9_999) / 10_000;
    assert_eq!(balance(&env.svm, &env.us(&a.pubkey())), 100 * K180 + 100 * 5_400_000 - fee_a);
    assert_eq!(balance(&env.svm, &env.us(&b.pubkey())), 100 * 100_000 - fee_b);
}

#[test]
fn equal_writers_equal_payouts_whenever_exercises_happen() {
    // Addendum F.
    let mut env = Env::new();
    let series = call_series(&mut env);
    let a = env.wallet(200, 0);
    let b = env.wallet(200, 0);
    let h = env.wallet(0, 100_000);
    env.quote(&a, &series, 50 * LOT, 50 * LOT, 5_000_000).unwrap();
    env.quote(&b, &series, 50 * LOT, 50 * LOT, 5_000_000).unwrap();
    env.buy(&h, &series, 100 * LOT, 5_000_000).unwrap();
    env.exercise(&h, &series, 10 * LOT).unwrap();
    warp_to(&mut env.svm, T0 + 6 * DAY);
    env.exercise(&h, &series, 30 * LOT).unwrap();
    warp_to(&mut env.svm, env.expiries[0]);
    env.settle_writer(&a.pubkey(), &series).unwrap();
    env.settle_writer(&b.pubkey(), &series).unwrap();
    assert_eq!(balance(&env.svm, &env.nv(&a.pubkey())), balance(&env.svm, &env.nv(&b.pubkey())));
    assert_eq!(balance(&env.svm, &env.us(&a.pubkey())), balance(&env.svm, &env.us(&b.pubkey())));
    assert_eq!(balance(&env.svm, &env.nv(&a.pubkey())), (150 + 30) * LOT * RAW_PER_LOT6);
}

#[test]
fn prime_sized_writers_partial_exercise_leaves_only_dust_and_nobody_overpaid() {
    // Addendum E.
    let mut env = Env::new();
    let series = call_series(&mut env);
    let sizes = [7u64, 11, 13];
    let writers: Vec<_> = sizes.iter().map(|_| env.wallet(100, 0)).collect();
    let h = env.wallet(0, 100_000);
    for (w, n) in writers.iter().zip(sizes) {
        env.quote(w, &series, n * LOT, n * LOT, 5_000_000).unwrap();
    }
    env.buy(&h, &series, 31 * LOT, 5_000_000).unwrap();
    env.exercise(&h, &series, 17 * LOT + 123_457).unwrap();
    warp_to(&mut env.svm, env.expiries[0]);
    for w in &writers {
        env.settle_writer(&w.pubkey(), &series).unwrap();
    }
    let s = load_series(&env.svm, &series);
    let coll_dust = balance(&env.svm, &s.collateral_vault);
    let settle_dust = balance(&env.svm, &s.settlement_vault);
    assert!(coll_dust <= 3 * RAW_PER_LOT6, "collateral dust {coll_dust}");
    assert!(settle_dust <= 3 * K180 / LOT + 3, "settlement dust {settle_dust}");
    // Total paid out never exceeds what was in the vaults.
    let total_tokens: u64 = writers.iter().map(|w| balance(&env.svm, &env.nv(&w.pubkey()))).sum();
    assert!(total_tokens <= 300 * LOT * RAW_PER_LOT6 - (17 * LOT + 123_457) * RAW_PER_LOT6);
    warp_to(&mut env.svm, env.expiries[0] + 3600);
    env.close_series(&series).unwrap();
    assert_eq!(balance(&env.svm, &env.fee_vault) > 0, true);
}

#[test]
fn full_exercise_then_new_writer_and_griefing_rounds_on_chain() {
    let mut env = Env::new();
    let series = call_series(&mut env);
    let h = env.wallet(0, 1_000_000);
    for _ in 0..5 {
        let w = env.wallet(10, 0);
        env.quote(&w, &series, 1 * LOT, 1 * LOT, 1_000).unwrap();
        env.buy(&h, &series, 1 * LOT, 1_000).unwrap();
        let s = load_series(&env.svm, &series);
        env.exercise(&h, &series, s.unassigned_lots6 - 1).unwrap();
    }
    let last = env.wallet(10, 0);
    env.quote(&last, &series, 1 * LOT, 1 * LOT, 1_000).unwrap();
    env.buy(&h, &series, 1 * LOT, 1_000).unwrap();
    let s = load_series(&env.svm, &series);
    assert_eq!(s.unassigned_lots6, 1 * LOT + 1);
    warp_to(&mut env.svm, env.expiries[0]);
    env.settle_writer(&last.pubkey(), &series).unwrap();
    assert_eq!(balance(&env.svm, &env.nv(&last.pubkey())), (10 - 1 + 1) * LOT * RAW_PER_LOT6);
}

#[test]
fn multiplier_change_mid_life_leaves_the_contract_untouched() {
    let mut env = Env::new();
    let series = call_series(&mut env);
    let a = env.wallet(200, 0);
    let h = env.wallet(0, 100_000);
    env.quote(&a, &series, 100 * LOT, 100 * LOT, 5_400_000).unwrap();
    env.buy(&h, &series, 100 * LOT, 5_400_000).unwrap();
    let before = load_series(&env.svm, &series);
    let vault_before = balance(&env.svm, &before.collateral_vault);
    // The issuer activates a 10 percent higher multiplier (a reinvested dividend). Raw balances and the contract do not move.
    env.update_multiplier(MULTIPLIER * 1.1, now(&env.svm));
    let after = load_series(&env.svm, &series);
    assert_eq!(after.strike_usdc_per_lot, before.strike_usdc_per_lot);
    assert_eq!(after.total_sold_lots6, before.total_sold_lots6);
    assert_eq!(balance(&env.svm, &after.collateral_vault), vault_before);
    // Exercise still exchanges exactly 10 lots of raw for ceil(10 x 180) USDC.
    let nv_before = balance(&env.svm, &env.nv(&h.pubkey()));
    let us_before = balance(&env.svm, &env.us(&h.pubkey()));
    env.exercise(&h, &series, 10 * LOT).unwrap();
    assert_eq!(balance(&env.svm, &env.nv(&h.pubkey())) - nv_before, 10 * LOT * RAW_PER_LOT6);
    assert_eq!(us_before - balance(&env.svm, &env.us(&h.pubkey())), usdc_owed_ceil(10 * LOT, K180).unwrap());
}

#[test]
fn ask_list_bounds_eviction_rejection_and_per_writer_cap() {
    let mut env = Env::new();
    let series = call_series(&mut env);
    // 32 asks from 8 writers, 4 each, prices 10.00 down to 6.90 in 0.10 steps.
    let mut writers = vec![];
    for i in 0..8 {
        let w = env.wallet(100, 0);
        for j in 0..4 {
            let price = 10_000_000 - (i * 4 + j) * 100_000;
            env.quote(&w, &series, if j == 0 { 4 * LOT } else { 0 }, 1 * LOT, price).unwrap();
        }
        expect_err(env.quote(&w, &series, 0, 0, 5_000_000), "SizeOutOfRange");
        writers.push(w);
    }
    let s = load_series(&env.svm, &series);
    assert_eq!(s.asks_len as usize, MAX_ASKS);
    assert_eq!(s.asks[0].ask_per_lot, 6_900_000);
    assert_eq!(s.asks[31].ask_per_lot, 10_000_000);
    // A fifth ask from writer 0 is refused even at a good price (per-writer cap).
    expect_err(env.quote(&writers[0], &series, 1 * LOT, 1 * LOT, 1_000_000), "AskRejected");
    // A worse-than-worst ask from a new writer is rejected; a better one evicts the worst in place.
    let z = env.wallet(100, 0);
    expect_err(env.quote(&z, &series, 1 * LOT, 1 * LOT, 11_000_000), "AskRejected");
    env.quote(&z, &series, 1 * LOT, 1 * LOT, 6_000_000).unwrap();
    let s = load_series(&env.svm, &series);
    assert_eq!(s.asks_len as usize, MAX_ASKS);
    assert_eq!(s.asks[0].ask_per_lot, 6_000_000);
    assert_eq!(s.asks[31].ask_per_lot, 9_900_000);
    // The evicted writer's collateral is free again: it can withdraw the lot that was resident.
    let evicted = &writers[0];
    env.withdraw_unsold(evicted, &series, 1 * LOT).unwrap();
    expect_err(env.withdraw_unsold(evicted, &series, 1 * LOT), "InsufficientFreeCollateral");
    // Cancel by seq and withdraw the freed lot.
    let s = load_series(&env.svm, &series);
    let mine = s.asks[..32].iter().find(|a| s.writers[a.writer_slot as usize].writer == evicted.pubkey()).unwrap().seq;
    env.cancel_ask(evicted, &series, mine).unwrap();
    env.withdraw_unsold(evicted, &series, 1 * LOT).unwrap();
}

#[test]
fn put_series_round_trip() {
    let mut env = Env::new();
    let payer = env.authority.insecure_clone();
    let series = env.create_series(&payer, Side::Put, K180, env.expiries[0]).unwrap();
    let w = env.wallet(0, 100_000);
    let h = env.wallet(100, 10_000);
    // Writer locks 20 x 180 USDC and asks 3.00 per lot; holder buys 20 lots for 60 USDC.
    env.quote(&w, &series, 20 * LOT, 20 * LOT, 3_000_000).unwrap();
    let s = load_series(&env.svm, &series);
    assert_eq!(balance(&env.svm, &s.collateral_vault), 20 * K180);
    env.buy(&h, &series, 20 * LOT, 3_000_000).unwrap();
    // Holder delivers 20 lots of NVDAx and receives 3,600 USDC from the collateral vault.
    let us_before = balance(&env.svm, &env.us(&h.pubkey()));
    env.exercise(&h, &series, 20 * LOT).unwrap();
    assert_eq!(balance(&env.svm, &env.us(&h.pubkey())) - us_before, 20 * K180);
    assert_eq!(balance(&env.svm, &s.settlement_vault), 20 * LOT * RAW_PER_LOT6);
    warp_to(&mut env.svm, env.expiries[0]);
    env.settle_writer(&w.pubkey(), &series).unwrap();
    // Writer was assigned on all 20: receives the 20 lots of NVDAx and keeps the premium net of fee.
    assert_eq!(balance(&env.svm, &env.nv(&w.pubkey())), 20 * LOT * RAW_PER_LOT6);
    let fee = (20 * 3_000_000 * 10 + 9_999) / 10_000;
    assert_eq!(balance(&env.svm, &env.us(&w.pubkey())), (100_000 - 3_600) * USDC + 20 * 3_000_000 - fee);
}

#[test]
fn issuer_pause_makes_escrow_transfers_fail_cleanly() {
    let mut env = Env::new();
    let series = call_series(&mut env);
    let a = env.wallet(200, 0);
    let h = env.wallet(0, 100_000);
    env.quote(&a, &series, 100 * LOT, 100 * LOT, 5_400_000).unwrap();
    env.buy(&h, &series, 100 * LOT, 5_400_000).unwrap();
    env.pause_mint(true);
    let r = env.exercise(&h, &series, 10 * LOT);
    assert!(r.is_err(), "exercise must fail while the issuer has paused the mint");
    env.pause_mint(false);
    env.exercise(&h, &series, 10 * LOT).unwrap();
}
