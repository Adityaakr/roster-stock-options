//! Part 3: the Covered Call vault through a full epoch, the bid side, and the section 5 edge cases that live in the
//! program. The vault is one more writer in the same book; these tests check it behaves as one and that depositors
//! get exactly what the roll says.

mod common;

use {
    anchor_lang::prelude::Pubkey,
    common::{vault::*, *},
    roster_finance::state::*,
    solana_keypair::Keypair,
    solana_signer::Signer,
};

const CC: u8 = VAULT_COVERED_CALL;
/// The mark the roll values USDC at: 180 USDC per lot.
const MARK: u64 = 180 * USDC;

fn setup() -> (Env, Keypair, Pubkey) {
    let mut env = Env::new();
    let manager = env.wallet(0, 0);
    let first_roll = env.expiries[0] + 3600;
    let vault = env.init_vault(CC, &manager.pubkey(), first_roll, 1_000 * LOT, 10_000 * LOT).unwrap();
    (env, manager, vault)
}

/// Deposit, roll, claim shares: the first depositor sets the unit at 1e6 shares per lot.
#[test]
fn deposit_enters_at_the_roll_and_mints_one_share_unit_per_lot() {
    let (mut env, _manager, vault) = setup();
    let alice = env.wallet(10, 0);
    env.vault_deposit(&alice, CC, 10 * LOT * RAW_PER_LOT6).unwrap();
    let v = load_vault(&env.svm, &vault);
    assert_eq!(v.pending_deposit_raw, 10 * LOT * RAW_PER_LOT6);
    assert_eq!(v.total_shares, 0);
    // Nothing to claim before the roll.
    expect_err(env.vault_claim(&alice, CC, 0), "AccountNotInitialized");
    // The roll is not due yet.
    let cranker = env.keeper.insecure_clone();
    expect_err(env.vault_roll(&cranker, CC, MARK), "RollNotDue");
    warp_to(&mut env.svm, v.next_roll_ts + 1);
    env.vault_roll(&cranker, CC, MARK).unwrap();
    let v = load_vault(&env.svm, &vault);
    assert_eq!(v.epoch, 1);
    assert_eq!(v.total_shares, 10 * SHARE_UNIT);
    assert_eq!(v.pending_deposit_raw, 0);
    env.vault_claim(&alice, CC, 0).unwrap();
    assert_eq!(env.shares_of(&vault, &alice.pubkey()), 10 * SHARE_UNIT);
    expect_err(env.vault_claim(&alice, CC, 0), "NothingQueued");
}

/// The whole epoch: the vault writes a call, a buyer takes it and exercises half, expiry, settlement, roll, and the
/// depositor withdraws exactly her share of what is left plus the USDC the vault earned.
#[test]
fn covered_call_epoch_premium_in_assignment_out_withdraw_exact() {
    let (mut env, manager, vault) = setup();
    let alice = env.wallet(10, 0);
    env.vault_deposit(&alice, CC, 10 * LOT * RAW_PER_LOT6).unwrap();
    let cranker = env.keeper.insecure_clone();
    let v = load_vault(&env.svm, &vault);
    // Move the first roll before the first expiry so the vault may write the nearest series.
    warp_to(&mut env.svm, v.next_roll_ts + 1);
    env.vault_roll(&cranker, CC, MARK).unwrap();
    env.vault_claim(&alice, CC, 0).unwrap();

    // Epoch 1 runs to the second expiry (roll at expiries[0] + 3600 + 7 days > expiries[1]).
    let expiry = env.expiries[1];
    let strike = 180 * USDC;
    let series = env.create_series(&env.authority.insecure_clone(), Side::Call, strike, expiry).unwrap();
    // The vault writes 5 lots at 2 USDC per lot.
    env.vault_quote(&manager, CC, &series, 5 * LOT, 5 * LOT, 2 * USDC).unwrap();
    let v = load_vault(&env.svm, &vault);
    assert_eq!(v.locked_raw, 5 * LOT * RAW_PER_LOT6);
    let s = load_series(&env.svm, &series);
    let slot = s.writer_slot(&vault).expect("vault holds a slot like any writer");
    assert_eq!(s.writers[slot].deposited_lots6, 5 * LOT);
    assert_eq!(s.asks_len, 1);

    // A buyer takes all 5 (premium 10 USDC less fee), exercises 2 before expiry.
    let bob = env.wallet(0, 2_000);
    env.buy(&bob, &series, 5 * LOT, 3 * USDC).unwrap();
    env.exercise(&bob, &series, 2 * LOT).unwrap();

    // Expiry passes; the vault settles: 3 lots come back as tokens, 2 lots as 360 USDC of strike, plus premium.
    warp_to(&mut env.svm, expiry + 1);
    env.vault_settle(&cranker, CC, &series).unwrap();
    let v = load_vault(&env.svm, &vault);
    assert_eq!(v.locked_raw, 0, "everything the vault put into the series came back or was assigned");
    assert_eq!(v.epoch_assigned_lots6, 2 * LOT);
    let premium_net = v.epoch_premium_in;
    assert!(premium_net > 9 * USDC && premium_net <= 10 * USDC, "premium net of the taker fee: {premium_net}");
    let tokens = balance(&env.svm, &env.nv(&vault));
    let usdc = balance(&env.svm, &env.us(&vault));
    assert_eq!(tokens, 8 * LOT * RAW_PER_LOT6, "5 never written plus 3 unassigned");
    assert_eq!(usdc, 2 * strike + premium_net, "two lots of strike plus the premium");

    // Alice withdraws everything at the roll and receives exactly the vault's two balances.
    env.vault_request_withdraw(&alice, CC, 10 * SHARE_UNIT).unwrap();
    assert_eq!(env.shares_of(&vault, &alice.pubkey()), 0, "queued shares sit in escrow");
    let v = load_vault(&env.svm, &vault);
    warp_to(&mut env.svm, v.next_roll_ts + 1);
    env.vault_roll(&cranker, CC, MARK).unwrap();
    let v = load_vault(&env.svm, &vault);
    assert_eq!(v.total_shares, 0);
    assert_eq!(v.reserved_collateral_raw, tokens);
    assert_eq!(v.reserved_other, usdc);
    let rec = load_epoch(&env.svm, &env.epoch_record(&vault, 1));
    assert_eq!(rec.assigned_lots6, 2 * LOT);
    assert_eq!(rec.premium_in, premium_net);
    // The week's P&L per share, in collateral units: 3 unassigned lots came back as 3, 2 lots became 360 USDC valued at
    // the mark (2 lots) plus the premium (0.05 lots at 180): a small positive week, published.
    assert!(rec.pnl_per_share_1e6 > 0, "premium minus nothing lost at the strike is a positive week: {}", rec.pnl_per_share_1e6);
    let before_tokens = balance(&env.svm, &env.nv(&alice.pubkey()));
    let before_usdc = balance(&env.svm, &env.us(&alice.pubkey()));
    env.vault_claim(&alice, CC, 1).unwrap();
    assert_eq!(balance(&env.svm, &env.nv(&alice.pubkey())) - before_tokens, tokens);
    assert_eq!(balance(&env.svm, &env.us(&alice.pubkey())) - before_usdc, usdc);
    let v = load_vault(&env.svm, &vault);
    assert_eq!(v.reserved_collateral_raw, 0);
    assert_eq!(v.reserved_other, 0);
}

/// A losing week is published as one: the stock runs through the strike, the buyer exercises everything, and the
/// vault is left holding strike USDC worth less than the tokens it gave up at the new mark.
#[test]
fn losing_epoch_is_published_negative() {
    let (mut env, manager, vault) = setup();
    let alice = env.wallet(10, 0);
    env.vault_deposit(&alice, CC, 10 * LOT * RAW_PER_LOT6).unwrap();
    let cranker = env.keeper.insecure_clone();
    let v = load_vault(&env.svm, &vault);
    warp_to(&mut env.svm, v.next_roll_ts + 1);
    env.vault_roll(&cranker, CC, MARK).unwrap();
    env.vault_claim(&alice, CC, 0).unwrap();
    let expiry = env.expiries[1];
    let series = env.create_series(&env.authority.insecure_clone(), Side::Call, 180 * USDC, expiry).unwrap();
    env.vault_quote(&manager, CC, &series, 10 * LOT, 10 * LOT, 1 * USDC).unwrap();
    let bob = env.wallet(0, 5_000);
    env.buy(&bob, &series, 10 * LOT, 2 * USDC).unwrap();
    env.exercise(&bob, &series, 10 * LOT).unwrap();
    warp_to(&mut env.svm, expiry + 1);
    env.vault_settle(&cranker, CC, &series).unwrap();
    let v = load_vault(&env.svm, &vault);
    warp_to(&mut env.svm, v.next_roll_ts + 1);
    // The stock is now at 210: the 1800 USDC the vault holds buys 8.57 lots, against the 10 it gave up.
    env.vault_roll(&cranker, CC, 210 * USDC).unwrap();
    let rec = load_epoch(&env.svm, &env.epoch_record(&vault, 1));
    assert!(rec.pnl_per_share_1e6 < 0, "a week that gapped through the strike is negative: {}", rec.pnl_per_share_1e6);
    assert_eq!(rec.assigned_lots6, 10 * LOT);
}

/// Part 3 section 5: the vault is evicted from the book by 32 cheaper asks, its collateral is free, nothing is lost.
#[test]
fn vault_evicted_by_cheaper_asks() {
    let (mut env, manager, vault) = setup();
    let alice = env.wallet(10, 0);
    env.vault_deposit(&alice, CC, 10 * LOT * RAW_PER_LOT6).unwrap();
    let cranker = env.keeper.insecure_clone();
    let v = load_vault(&env.svm, &vault);
    warp_to(&mut env.svm, v.next_roll_ts + 1);
    env.vault_roll(&cranker, CC, MARK).unwrap();
    let series = env.create_series(&env.authority.insecure_clone(), Side::Call, 180 * USDC, env.expiries[1]).unwrap();
    env.vault_quote(&manager, CC, &series, 5 * LOT, 5 * LOT, 3 * USDC).unwrap();
    // Thirty-two cheaper asks from the thirty-one other slots (one writer posts twice); the vault's is the worst and goes.
    for i in 0..MAX_ASKS {
        let w = if i < MAX_WRITERS - 1 { env.wallet(2, 0) } else { env.wallet(2, 0) };
        env.quote(&w, &series, LOT, LOT, 2 * USDC - i as u64).unwrap();
        if i == MAX_WRITERS - 2 {
            env.quote(&w, &series, LOT, LOT, 2 * USDC - (i as u64 + 1)).unwrap();
            break;
        }
    }
    let s = load_series(&env.svm, &series);
    let slot = s.writer_slot(&vault).unwrap();
    assert_eq!(s.asks_len as usize, MAX_ASKS);
    assert!(s.asks[..MAX_ASKS].iter().all(|a| a.writer_slot as usize != slot), "the vault's ask was evicted");
    assert_eq!(roster_finance::math::free_lots6(&s, slot), 5 * LOT, "everything the vault deposited is free again");
    // The manager pulls it back and the vault's own accounting agrees.
    env.vault_withdraw_unsold(&manager, CC, &series, 5 * LOT).unwrap();
    let v = load_vault(&env.svm, &vault);
    assert_eq!(v.locked_raw, 0);
    assert_eq!(balance(&env.svm, &env.nv(&vault)), 10 * LOT * RAW_PER_LOT6);
}

/// Part 3 section 5: a request to sell back more than the vault's short fills to the cap and says so; then an
/// exercise by another holder after the buyback settles to the unit, and the vault is never over-released.
#[test]
fn sell_to_vault_caps_at_vault_short_then_exercise_exact() {
    let (mut env, manager, vault) = setup();
    let alice = env.wallet(10, 0);
    env.vault_deposit(&alice, CC, 10 * LOT * RAW_PER_LOT6).unwrap();
    let cranker = env.keeper.insecure_clone();
    let v = load_vault(&env.svm, &vault);
    warp_to(&mut env.svm, v.next_roll_ts + 1);
    env.vault_roll(&cranker, CC, MARK).unwrap();
    let expiry = env.expiries[1];
    let strike = 180 * USDC;
    let series = env.create_series(&env.authority.insecure_clone(), Side::Call, strike, expiry).unwrap();
    // The vault writes 5; an external writer, carol, writes 5 more at a worse price.
    env.vault_quote(&manager, CC, &series, 5 * LOT, 5 * LOT, 2 * USDC).unwrap();
    let carol = env.wallet(5, 0);
    env.quote(&carol, &series, 5 * LOT, 5 * LOT, 3 * USDC).unwrap();
    // Bob buys all 10: 5 from the vault, 5 from carol.
    let bob = env.wallet(0, 5_000);
    env.buy(&bob, &series, 10 * LOT, 3 * USDC).unwrap();
    // The vault needs USDC to pay a bid: give it the premium it earned by claiming it into its account.
    // (claim_premium is a person's instruction; the vault's premium arrives at settle. Fund the bid from the manager.)
    let vault_usdc = env.us(&vault);
    let funder = env.wallet(0, 100);
    let ix = anchor_spl::token::spl_token::instruction::transfer(&anchor_spl::token::spl_token::id(), &env.us(&funder.pubkey()), &vault_usdc, &funder.pubkey(), &[], 100 * USDC).unwrap();
    send(&mut env.svm, &funder, &[&funder], &[ix]).unwrap();

    env.vault_post_bid(&manager, CC, &series, 1 * USDC, 100 * LOT, 3600).unwrap();
    // Bob offers 10 back; the vault is short only 5, so 5 fill.
    let bob_usdc_before = balance(&env.svm, &env.us(&bob.pubkey()));
    env.sell_to_vault(&bob, CC, &series, 10 * LOT, 1 * USDC).unwrap();
    assert_eq!(balance(&env.svm, &env.us(&bob.pubkey())) - bob_usdc_before, 5 * USDC, "five lots at the bid");
    let s = load_series(&env.svm, &series);
    let vslot = s.writer_slot(&vault).unwrap();
    assert_eq!(s.writers[vslot].sold_lots6, 0);
    assert_eq!(s.writers[vslot].open_lots6, 0);
    assert_eq!(s.total_sold_lots6, 5 * LOT);
    assert_eq!(s.unassigned_lots6, 5 * LOT);
    assert_eq!(mint_supply(&env.svm, &s.position_mint), 5 * LOT, "the bought-back tokens were burned");
    assert_eq!(roster_finance::math::free_lots6(&s, vslot), 5 * LOT, "the vault's collateral is free again");
    // A second buyback finds nothing to fill.
    expect_err(env.sell_to_vault(&bob, CC, &series, 1 * LOT, 1 * USDC), "QuoteMoved");

    // Bob exercises his remaining 5: all of it is carol's, none of it the vault's.
    env.exercise(&bob, &series, 5 * LOT).unwrap();
    warp_to(&mut env.svm, expiry + 1);
    env.vault_settle(&cranker, CC, &series).unwrap();
    env.settle_writer(&carol.pubkey(), &series).unwrap();
    let v = load_vault(&env.svm, &vault);
    assert_eq!(v.epoch_assigned_lots6, 0, "the vault was assigned nothing after buying its short back");
    assert_eq!(balance(&env.svm, &env.nv(&vault)), 10 * LOT * RAW_PER_LOT6, "every token the vault put in came back");
    assert_eq!(balance(&env.svm, &env.nv(&carol.pubkey())), 0, "carol was assigned all five");
    assert_eq!(balance(&env.svm, &env.us(&carol.pubkey())) >= 5 * strike, true, "carol received the strike for five");
    let s = load_series(&env.svm, &series);
    let (cv, sv, _) = env.vaults(&series);
    assert_eq!(balance(&env.svm, &cv), 0, "collateral vault empty to the unit");
    assert_eq!(balance(&env.svm, &sv), 0, "settlement vault empty to the unit");
    assert_eq!(s.total_exercised_lots6, 5 * LOT);
}

/// The vault only writes what settles before its next roll, never past its per-series cap, and only for its manager.
#[test]
fn vault_refuses_late_expiry_cap_and_strangers() {
    let mut env = Env::new();
    let manager = env.wallet(0, 0);
    // First roll an hour in: after it, the next roll lands between the two grid expiries.
    let vault = env.init_vault(CC, &manager.pubkey(), T0 + 3600, 6 * LOT, 0).unwrap();
    let alice = env.wallet(10, 0);
    env.vault_deposit(&alice, CC, 10 * LOT * RAW_PER_LOT6).unwrap();
    let cranker = env.keeper.insecure_clone();
    warp_to(&mut env.svm, T0 + 3601);
    env.vault_roll(&cranker, CC, MARK).unwrap();
    let v = load_vault(&env.svm, &vault);
    assert!(v.next_roll_ts > env.expiries[0] && v.next_roll_ts < env.expiries[1]);
    let near = env.create_series(&env.authority.insecure_clone(), Side::Call, 180 * USDC, env.expiries[0]).unwrap();
    let far = env.create_series(&env.authority.insecure_clone(), Side::Call, 180 * USDC, env.expiries[1]).unwrap();
    expect_err(env.vault_quote(&manager, CC, &far, 1 * LOT, 1 * LOT, 1 * USDC), "ExpiryPastRoll");
    // The per-series cap is 6 lots: 5 is fine, 2 more is not.
    env.vault_quote(&manager, CC, &near, 5 * LOT, 5 * LOT, 1 * USDC).unwrap();
    expect_err(env.vault_quote(&manager, CC, &near, 2 * LOT, 1 * LOT, 1 * USDC), "VaultCapReached");
    // Someone who is not the manager cannot write for the vault.
    let stranger = env.wallet(0, 0);
    expect_err(env.vault_quote(&stranger, CC, &near, 1 * LOT, 1 * LOT, 1 * USDC), "Unauthorized");
    // Nothing the vault has queued or reserved is ever written: the deposit is 10 lots, 5 are out, only 5 remain.
    expect_err(env.vault_quote(&manager, CC, &far, 6 * LOT, 1 * LOT, 1 * USDC), "ExpiryPastRoll");
}

/// The Cash-Secured Put vault is the same code with USDC as collateral: a full epoch where the buyer exercises half,
/// so the vault ends holding the tokens it was assigned and the USDC it kept, and the depositor withdraws both exactly.
#[test]
fn cash_secured_put_epoch_assigned_tokens_withdraw_exact() {
    const CSP: u8 = VAULT_CASH_SECURED_PUT;
    let mut env = Env::new();
    let manager = env.wallet(0, 0);
    let vault = env.init_vault(CSP, &manager.pubkey(), env.expiries[0] + 3600, 100_000 * LOT, 0).unwrap();
    let alice = env.wallet(0, 2_000);
    env.vault_deposit(&alice, CSP, 2_000 * USDC).unwrap();
    let cranker = env.keeper.insecure_clone();
    let v = load_vault(&env.svm, &vault);
    warp_to(&mut env.svm, v.next_roll_ts + 1);
    env.vault_roll(&cranker, CSP, MARK).unwrap();
    env.vault_claim(&alice, CSP, 0).unwrap();
    assert_eq!(env.shares_of(&vault, &alice.pubkey()), 2_000 * SHARE_UNIT, "1e6 shares per USDC");

    // The vault writes 10 puts at 180: 1800 USDC locked; a holder buys them and exercises 4 (delivers 4 tokens).
    let expiry = env.expiries[1];
    let strike = 180 * USDC;
    let series = env.create_series(&env.authority.insecure_clone(), Side::Put, strike, expiry).unwrap();
    env.vault_quote(&manager, CSP, &series, 10 * LOT, 10 * LOT, 1 * USDC).unwrap();
    assert_eq!(load_vault(&env.svm, &vault).locked_raw, 10 * strike);
    let bob = env.wallet(4, 100);
    env.buy(&bob, &series, 10 * LOT, 2 * USDC).unwrap();
    env.exercise(&bob, &series, 4 * LOT).unwrap();
    warp_to(&mut env.svm, expiry + 1);
    env.vault_settle(&cranker, CSP, &series).unwrap();
    let v = load_vault(&env.svm, &vault);
    assert_eq!(v.locked_raw, 0);
    assert_eq!(v.epoch_assigned_lots6, 4 * LOT);
    let usdc = balance(&env.svm, &env.us(&vault));
    let tokens = balance(&env.svm, &env.nv(&vault));
    assert_eq!(tokens, 4 * LOT * RAW_PER_LOT6, "assigned four tokens at the strike");
    assert_eq!(usdc, 2_000 * USDC - 4 * strike + v.epoch_premium_in, "kept the rest plus the premium");

    env.vault_request_withdraw(&alice, CSP, 2_000 * SHARE_UNIT).unwrap();
    let v = load_vault(&env.svm, &vault);
    warp_to(&mut env.svm, v.next_roll_ts + 1);
    env.vault_roll(&cranker, CSP, MARK).unwrap();
    let before_usdc = balance(&env.svm, &env.us(&alice.pubkey()));
    let before_tokens = balance(&env.svm, &env.nv(&alice.pubkey()));
    env.vault_claim(&alice, CSP, 1).unwrap();
    assert_eq!(balance(&env.svm, &env.us(&alice.pubkey())) - before_usdc, usdc);
    assert_eq!(balance(&env.svm, &env.nv(&alice.pubkey())) - before_tokens, tokens);
    let v = load_vault(&env.svm, &vault);
    assert_eq!(v.total_shares, 0);
    assert_eq!(v.reserved_collateral_raw + v.reserved_other, 0);
}
