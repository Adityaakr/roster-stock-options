//! M2: fees and authorities, auto-exercise with a posted Pyth update, the halt rule, and a random-sequence invariant
//! test over the whole instruction set.

mod common;

use {
    common::*,
    roster_finance::{state::*, UpdateMarketParams, UpdateProtocolParams},
    solana_keypair::Keypair,
    solana_signer::Signer,
};

const K180: u64 = 180 * USDC;

fn call_series(env: &mut Env) -> anchor_lang::prelude::Pubkey {
    let payer = env.authority.insecure_clone();
    env.create_series(&payer, Side::Call, K180, env.expiries[0]).unwrap()
}

fn no_market_change() -> UpdateMarketParams {
    UpdateMarketParams { allowed_expiries: None, strike_step: None, min_strike: None, max_strike: None, max_live_series: None, min_lots6: None, max_lots6: None, max_writer_lots6: None, tier: None, listed: None, paused: None, max_price_age_secs: None, max_conf_bps: None }
}
fn no_protocol_change() -> UpdateProtocolParams {
    UpdateProtocolParams { authority: None, pause_authority: None, treasury: None, fee_bps: None, integrator_share_bps: None, keeper_fee_usdc: None, grace_secs: None, paused_all: None, series_creator: None }
}

#[test]
fn fees_go_to_the_treasury_only_and_the_pause_key_can_only_pause() {
    let mut env = Env::new();
    let series = call_series(&mut env);
    let a = env.wallet(200, 0);
    let h = env.wallet(0, 100_000);
    env.quote(&a, &series, 100 * LOT, 100 * LOT, 5_400_000).unwrap();
    env.buy(&h, &series, 100 * LOT, 5_400_000).unwrap();
    let fee = (100 * 5_400_000 * 10 + 9_999) / 10_000;
    assert_eq!(balance(&env.svm, &env.fee_vault), fee);
    env.withdraw_fees(0).unwrap();
    assert_eq!(balance(&env.svm, &env.fee_vault), 0);
    assert_eq!(balance(&env.svm, &env.us(&env.authority.pubkey())), fee);

    // The pause key pauses the market and the protocol, and nothing else.
    let keeper = env.keeper.insecure_clone();
    env.update_market(&keeper, UpdateMarketParams { paused: Some(true), ..no_market_change() }).unwrap();
    expect_err(env.buy(&h, &series, 1 * LOT, 6_000_000), "Paused");
    expect_err(env.update_market(&keeper, UpdateMarketParams { paused: Some(false), ..no_market_change() }), "Unauthorized");
    expect_err(env.update_market(&keeper, UpdateMarketParams { tier: Some(3), ..no_market_change() }), "Unauthorized");
    // Exercise is never pausable.
    env.exercise(&h, &series, 10 * LOT).unwrap();
    let authority = env.authority.insecure_clone();
    env.update_market(&authority, UpdateMarketParams { paused: Some(false), ..no_market_change() }).unwrap();
    env.update_protocol(&keeper, UpdateProtocolParams { paused_all: Some(true), ..no_protocol_change() }).unwrap();
    expect_err(env.quote(&a, &series, 0, 1 * LOT, 6_000_000), "Paused");
    expect_err(env.update_protocol(&keeper, UpdateProtocolParams { fee_bps: Some(0), ..no_protocol_change() }), "Unauthorized");
    env.update_protocol(&authority, UpdateProtocolParams { paused_all: Some(false), fee_bps: Some(20), ..no_protocol_change() }).unwrap();
    let outsider = env.wallet(0, 0);
    expect_err(env.update_protocol(&outsider, UpdateProtocolParams { paused_all: Some(true), ..no_protocol_change() }), "Unauthorized");
}

#[test]
fn auto_exercise_fires_in_the_money_inside_the_window_and_declines_otherwise() {
    let mut env = Env::new();
    let series = call_series(&mut env);
    let a = env.wallet(200, 0);
    let h = env.wallet(0, 100_000);
    env.quote(&a, &series, 100 * LOT, 100 * LOT, 5_400_000).unwrap();
    env.buy(&h, &series, 100 * LOT, 5_400_000).unwrap();
    let expiry = env.expiries[0];
    // Not opted in: declined.
    let fresh = |env: &mut Env, price: f64| { let t = now(&env.svm); env.price_update(TOKEN_FEED, price, 0.05, t, true) };
    let pu = fresh(&mut env, 200.0);
    expect_err(env.auto_exercise(&h.pubkey(), &series, 100 * LOT, pu), "AccountNotInitialized");
    env.enable_auto_exercise(&h, &series, 0).unwrap();
    // Outside the window: declined.
    let pu = fresh(&mut env, 200.0);
    expect_err(env.auto_exercise(&h.pubkey(), &series, 100 * LOT, pu), "OutsideWindow");
    warp_to(&mut env.svm, expiry - 1800);
    // A chunk smaller than the whole position: declined, so the keeper fee cannot be farmed (skeptic finding 1).
    let pu = fresh(&mut env, 200.0);
    expect_err(env.auto_exercise(&h.pubkey(), &series, 10 * LOT, pu), "SizeOutOfRange");
    // Out of the money, stale, wrong feed, partial verification, wide confidence: all declined.
    let pu = fresh(&mut env, 170.0);
    expect_err(env.auto_exercise(&h.pubkey(), &series, 100 * LOT, pu), "NotInTheMoney");
    let t = now(&env.svm);
    let stale = env.price_update(TOKEN_FEED, 200.0, 0.05, t - 600, true);
    expect_err(env.auto_exercise(&h.pubkey(), &series, 100 * LOT, stale), "BadPriceUpdate");
    let wrong = env.price_update([9; 32], 200.0, 0.05, t, true);
    expect_err(env.auto_exercise(&h.pubkey(), &series, 100 * LOT, wrong), "BadPriceUpdate");
    let partial = env.price_update(TOKEN_FEED, 200.0, 0.05, t, false);
    expect_err(env.auto_exercise(&h.pubkey(), &series, 100 * LOT, partial), "BadPriceUpdate");
    let wide = env.price_update(TOKEN_FEED, 200.0, 5.0, t, true);
    expect_err(env.auto_exercise(&h.pubkey(), &series, 100 * LOT, wide), "BadPriceUpdate");
    // In the money by more than the keeper fee, fresh, verified: fires. Holder pays the strike, receives the tokens,
    // the keeper is paid from the fee vault, never from the holder.
    let us_before = balance(&env.svm, &env.us(&h.pubkey()));
    let nv_before = balance(&env.svm, &env.nv(&h.pubkey()));
    let fee_vault_before = balance(&env.svm, &env.fee_vault);
    let pu = fresh(&mut env, 200.0);
    env.auto_exercise(&h.pubkey(), &series, 100 * LOT, pu).unwrap();
    assert_eq!(us_before - balance(&env.svm, &env.us(&h.pubkey())), 100 * K180);
    assert_eq!(balance(&env.svm, &env.nv(&h.pubkey())) - nv_before, 100 * LOT * RAW_PER_LOT6);
    let keeper_fee = (2 * USDC).min(fee_vault_before);
    assert_eq!(fee_vault_before - balance(&env.svm, &env.fee_vault), keeper_fee);
    assert_eq!(balance(&env.svm, &env.us(&env.keeper.pubkey())), keeper_fee);
    assert_eq!(load_series(&env.svm, &series).total_exercised_lots6, 100 * LOT);
    // A stranger may crank another opted-in holder but is paid nothing: the fee vault cannot be farmed by self-cranking.
    env.quote(&a, &series, 100 * LOT, 100 * LOT, 5_400_000).unwrap();
    let h2 = env.wallet(0, 100_000);
    env.buy(&h2, &series, 100 * LOT, 5_400_000).unwrap();
    env.enable_auto_exercise(&h2, &series, 0).unwrap();
    let stranger = Keypair::new();
    create_ata(&mut env.svm, &env.authority.insecure_clone(), &stranger.pubkey(), &env.usdc, &anchor_spl::token::spl_token::id());
    let vault_before = balance(&env.svm, &env.fee_vault);
    let pu = fresh(&mut env, 200.0);
    env.auto_exercise_as(&stranger, &h2.pubkey(), &series, 100 * LOT, pu).unwrap();
    assert_eq!(balance(&env.svm, &env.fee_vault), vault_before, "a stranger's crank takes nothing from the fee vault");
    assert_eq!(balance(&env.svm, &env.us(&stranger.pubkey())), 0);
    // A second call finds nothing to exercise; opting out revokes and the crank is refused outright.
    let pu = fresh(&mut env, 200.0);
    expect_err(env.auto_exercise(&h.pubkey(), &series, 100 * LOT, pu), "SizeOutOfRange");
    env.disable_auto_exercise(&h, &series).unwrap();
    let pu = fresh(&mut env, 200.0);
    expect_err(env.auto_exercise(&h.pubkey(), &series, 100 * LOT, pu), "AutoExerciseDisabled");
}

#[test]
fn issuer_pause_spanning_expiry_halts_settlement_for_a_day_and_keeps_exercise_open() {
    let mut env = Env::new();
    let series = call_series(&mut env);
    let a = env.wallet(200, 0);
    let h = env.wallet(0, 100_000);
    env.quote(&a, &series, 100 * LOT, 100 * LOT, 5_400_000).unwrap();
    env.buy(&h, &series, 100 * LOT, 5_400_000).unwrap();
    let expiry = env.expiries[0];
    warp_to(&mut env.svm, expiry - 3600);
    env.pause_mint(true);
    // The keeper records the pause; writers cannot quote into a halted series; the token program blocks the exercise.
    env.observe_halt(&series).unwrap();
    assert_eq!(load_series(&env.svm, &series).state, SERIES_HALTED);
    expect_err(env.quote(&a, &series, 0, 1 * LOT, 6_000_000), "Halted");
    assert!(env.exercise(&h, &series, 1 * LOT).is_err());
    // The pause spans expiry. Nobody can settle while it lasts.
    warp_to(&mut env.svm, expiry + 60);
    expect_err(env.settle_writer(&a.pubkey(), &series), "Halted");
    env.pause_mint(false);
    // The first observation after resume starts the 24 h clock (two-phase); a failing settle cannot persist it, so
    // the keeper (or anyone) records it. Settle stays refused, exercise is open again.
    expect_err(env.settle_writer(&a.pubkey(), &series), "Halted");
    env.observe_halt(&series).unwrap();
    expect_err(env.settle_writer(&a.pubkey(), &series), "Halted");
    let s = load_series(&env.svm, &series);
    assert!(s.resumed_at > 0 && s.state == SERIES_HALTED);
    env.exercise(&h, &series, 10 * LOT).unwrap();
    warp_to(&mut env.svm, expiry + 60 + 12 * 3600);
    env.exercise(&h, &series, 10 * LOT).unwrap();
    expect_err(env.settle_writer(&a.pubkey(), &series), "Halted");
    // 24 h after resume: the window closes, the writer settles on the exercised and unexercised remainder.
    warp_to(&mut env.svm, expiry + 60 + 24 * 3600 + 1);
    expect_err(env.exercise(&h, &series, 1 * LOT), "Expired");
    env.observe_halt(&series).unwrap();
    env.settle_writer(&a.pubkey(), &series).unwrap();
    assert_eq!(load_series(&env.svm, &series).state, SERIES_OPEN);
    assert_eq!(balance(&env.svm, &env.nv(&a.pubkey())), (200 - 100 + 80) * LOT * RAW_PER_LOT6);
}

/// Random instruction sequences over three writers and two holders; after every transaction the four invariants
/// from docs/01-architecture.md section 4 hold. Seeded so a failure is reproducible.
#[test]
fn random_sequences_keep_the_invariants() {
    let mut env = Env::new();
    let series = call_series(&mut env);
    let writers: Vec<Keypair> = (0..3).map(|_| env.wallet(500, 0)).collect();
    let holders: Vec<Keypair> = (0..2).map(|_| env.wallet(0, 1_000_000)).collect();
    let mut seed: u64 = 0x9e3779b97f4a7c15;
    let mut rnd = move || { seed ^= seed << 13; seed ^= seed >> 7; seed ^= seed << 17; seed };
    let s0 = load_series(&env.svm, &series);
    let pm = s0.position_mint;
    let mut ok = [0u32; 7];
    for step in 0..220 {
        let r = rnd();
        let kind = (r % 8) as usize;
        let res = match kind {
            0 | 1 => {
                let w = &writers[(r >> 8) as usize % 3];
                let lots = ((r >> 16) % 20 + 1) * LOT;
                let ask = 1_000_000 + ((r >> 24) % 9_000_000);
                env.quote(w, &series, lots, lots, ask)
            }
            2 | 3 => {
                let h = &holders[(r >> 8) as usize % 2];
                let lots = ((r >> 16) % 30 + 1) * LOT;
                env.buy(h, &series, lots, 10_000_000)
            }
            4 => {
                let h = &holders[(r >> 8) as usize % 2];
                let held = balance(&env.svm, &common::ata(&h.pubkey(), &pm, &anchor_spl::token_2022::spl_token_2022::id()));
                // Sometimes exercise nearly everything, to push P toward a rescale.
                let s = load_series(&env.svm, &series);
                let lots = if r & 0x100 != 0 { held.min(s.unassigned_lots6.saturating_sub(1)) } else { ((r >> 16) % held.max(1)).max(1).min(held) };
                if lots > 0 { env.exercise(h, &series, lots) } else { Err(String::from("nothing held")) }
            }
            5 => {
                let w = &writers[(r >> 8) as usize % 3];
                env.withdraw_unsold(w, &series, ((r >> 16) % 5 + 1) * LOT)
            }
            6 => {
                let w = &writers[(r >> 8) as usize % 3];
                let s = load_series(&env.svm, &series);
                match s.writer_slot(&w.pubkey()).and_then(|slot| s.asks[..s.asks_len as usize].iter().find(|a| a.writer_slot as usize == slot).map(|a| a.seq)) {
                    Some(seq) => env.cancel_ask(w, &series, seq),
                    None => Err(String::from("no ask")),
                }
            }
            _ => {
                let w = &writers[(r >> 8) as usize % 3];
                env.claim_premium(w, &series)
            }
        };
        if res.is_ok() { ok[kind.min(6)] += 1; }
        let s = load_series(&env.svm, &series);
        let supply = mint_supply(&env.svm, &pm);
        assert_eq!(supply, s.total_sold_lots6 - s.total_exercised_lots6, "step {step}: supply");
        let sold: u64 = s.writers.iter().map(|w| w.sold_lots6).sum();
        assert_eq!(sold, s.total_sold_lots6, "step {step}: sum sold");
        // Fold every slot to the present and check the collateral covers unassigned plus free, and assigned never exceeds exercised.
        let mut open_sum = 0u64;
        let mut assigned_sum = 0u64;
        let mut free_sum = 0u64;
        for (i, w) in s.writers.iter().enumerate() {
            if w.is_empty() { continue; }
            let mut f = *w;
            roster_finance::math::fold(&s, &mut f);
            open_sum += f.open_lots6;
            assigned_sum += f.assigned_lots6;
            free_sum += roster_finance::math::free_lots6(&s, i) + s.resident_lots6(i);
        }
        // The product rounds toward the vault: writers' unassigned can exceed the pool's by rounding dust (trimmed at
        // settle), and their assigned never exceeds what was exercised, so the settlement vault is never over-drawn.
        assert!(open_sum >= s.unassigned_lots6 && open_sum - s.unassigned_lots6 <= 64, "step {step}: open {open_sum} vs unassigned {}", s.unassigned_lots6);
        assert!(assigned_sum <= s.total_exercised_lots6, "step {step}: assigned {assigned_sum} > exercised");
        let vault = balance(&env.svm, &s.collateral_vault);
        assert!(vault >= (s.unassigned_lots6 + free_sum) * RAW_PER_LOT6, "step {step}: vault {vault} < {}", (s.unassigned_lots6 + free_sum) * RAW_PER_LOT6);
    }
    // Every kind of step succeeded at least a few times, so the walk exercised the whole instruction set.
    assert!(ok.iter().all(|c| *c >= 3), "successes per kind {ok:?}");
    // Settle everyone after expiry and make sure the vaults are never overdrawn.
    warp_to(&mut env.svm, env.expiries[0]);
    for w in &writers {
        let _ = env.settle_writer(&w.pubkey(), &series);
    }
    let s = load_series(&env.svm, &series);
    let settled: Vec<bool> = s.writers.iter().filter(|w| !w.is_empty()).map(|w| w.is_settled()).collect();
    eprintln!("settled {settled:?} collateral_dust {} settlement_dust {} exercised {} sold {} epoch {} scale {}", balance(&env.svm, &s.collateral_vault), balance(&env.svm, &s.settlement_vault), s.total_exercised_lots6, s.total_sold_lots6, s.epoch, s.scale);
    assert!(settled.iter().all(|x| *x), "every writer settles");
    // Independent floors forfeit at most one lot unit (1e-6 lot) per writer per exercise that touched it, and an
    // epoch roll orphans the residual units of that epoch: bounded by the number of steps, in either vault.
    assert!(balance(&env.svm, &s.collateral_vault) <= 220 * 3 * RAW_PER_LOT6, "collateral dust {}", balance(&env.svm, &s.collateral_vault));
    assert!(balance(&env.svm, &s.settlement_vault) < 220 * 3 * K180 / LOT + 3, "settlement dust {}", balance(&env.svm, &s.settlement_vault));
}
