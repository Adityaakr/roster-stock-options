# Reconciliation: Part 1 build against Part 2 and the addendum

Written 2026-09-17 per Part 2 section 9 and the addendum's kickoff. Facts about the repo cite files; nothing here is recalled.

## 1. Which Part 1 phases are complete

| Phase | State | Evidence |
| --- | --- | --- |
| Design port (pre-P0) | complete | `docs/BUILD_LOG.md` entries 1 and 2; `apps/web` renders the landing page and seven product screens on a `fixture` cluster; 20 Playwright runs green |
| P0 foundation | not started | no `programs/`, no `packages/*`, no `.env`, no `docs/PLAN.md`, no `docs/MINT.md`, no `docs/FEEDS.md` |
| P1 engine | not started | no Anchor workspace in this repo (`Anchor.toml` absent) |
| P2 to P6 | not started | |

**P1's escrow is neither per-commitment nor pooled: there is no program.** The only place the Part 1 model exists is the web fixture layer (`apps/web/src/lib/model.ts`: `Term`, `Underwriter`, `Position`, `askAtSize` ladder). No refactor of on-chain code is needed; the program is built pooled from the first line.

## 2. What is kept, what is refactored, why

**Kept as is.**
- The design system and every component under `apps/web/src/components` (Part 2 section 0: "the design system ... does not change").
- Landing copy from Part 1 section 6, with the addendum section H amendments applied in P3/P7 (hero market list, "Every stock, honestly tiered", the coverage row, the fragmentation answer).
- `lib/model.ts` payoff arithmetic (`buyerPnl`, `breakEven`, `moveNeeded`, `maxLoss`, `commitMath`) and the session clock (`sessionAt`, `nextFridays`); both are display-layer and remain correct under pooled series.
- Playwright screenshot harness (`apps/web/e2e`).

**Refactored (web data model, P3).**
- `Term` becomes `Series` keyed `[market, side, strike_per_share_1e6, expiry_ts]`, carrying `strike_total_per_unit`, `total_sold_raw`, `total_exercised_raw`, the position mint, vault addresses, and the bounded ask list (addendum D: `max_asks` 32, walk bound 8).
- `Underwriter` reserves become `WriterAccount` rows per series (`collateral_deposited`, `sold_raw`, `withdrawn`); the roster page's "reserved capital" reads vault balances, not a per-underwriter fixture.
- `Position` becomes the wallet's balance of each series' position mint plus the indexer's fill history; "exercise" burns tokens (Part 2 section 3). The auto-exercise delegate state and its revoke control are added to Manage.
- `RosterData` becomes per-market: `markets[]` from the registry with tier, eligibility verdict, feeds, basis, volatility; the hero and `/trade` show the market list first (addendum H). The Discover table becomes a per-market term grid where uncreated series show as "quotable, not yet created" (addendum C).
- Fee display: taker fee at `buy` only, referrer share line when present, never at exercise (addendum G). The "Fee, 25 bps" fixture becomes the on-chain fee schedule (default proposal 10 bps taker, 30% integrator).
- Commit screen gains the one-line pooled-assignment note (addendum F) and the treasury-P&L honesty line where treasury performance is shown (addendum G).

**Discarded.** `roster-data.ts` fixture terms and the fixture exercise history, once the indexer serves real fork data in P2. The `Fixture` cluster label stays as the honest fallback for a cluster with no program.

## 3. Every account and instruction that changes (Part 1 section 4.2 -> Part 2 section 3 + addendum)

| Part 1 | Part 2 + addendum | Change |
| --- | --- | --- |
| `Market` `[market, mint]` | `MarketConfig` created from a registry entry by the registry authority; adds feeds, multiplier source, term grid, caps, `max_live_series`, tier, listing status, extension flags | replaced |
| `Term` `[term, market, side, strike, expiry]` | `Series` `[series, market, side, strike, expiry]` with two vaults, position mint, `strike_total_per_unit`, bounded `asks[32]`, `total_sold_raw`, `total_exercised_raw`, `total_collateral_raw`, rent payer | replaced |
| `Commitment` `[commit, term, underwriter, nonce]` with its own escrow | `WriterAccount` `[writer, series, writer]`; collateral pooled in the series vault | replaced |
| `Position` `[pos, commitment, holder]` | position-mint token balance (Token-2022, 6 decimals, metadata) | replaced |
| `quote` escrows per commitment | `quote` deposits into the pooled vault and does a sorted insert into `asks`; evicts the worst ask when full; creates the series lazily in the same tx if absent | changed |
| `cancel_quote` | `cancel_ask` + `withdraw_unsold` (unsold collateral withdrawable any time) | changed |
| `buy(term, raw_qty, max_premium)` one Position per fill | `buy(series, raw_qty, max_premium_per_unit, referrer?)` walks at most 8 asks, pays writers, takes the taker fee to `FeeVault`, integrator share to `IntegratorClaim`, mints position tokens; partial fill returns the filled amount; zero fill fails `QuoteMoved` | changed |
| `exercise(position, raw_qty)` routes to one underwriter | `exercise(series, raw_qty)` burns tokens; call: USDC into the settlement vault, underlying out of the collateral vault; put: reverse; rounding against the party paid (addendum E) | changed |
| `release(commitment)` | `settle_writer(series)` pro rata of `sold_raw` over both vaults plus unsold collateral; `close_series` reclaims rent and sweeps dust to the fee account once supply is zero | replaced |
| `auto_exercise(position)` | `auto_exercise` on a position-token holder under a revocable delegate; posts the Pyth update through the receiver in the same tx; program checks staleness and confidence | changed |
| `init_market`, `set_params`, `pause`, `unpause` | `create_market(registry_entry)`, `update_market_config`, `pause_market`, `pause_all`, `set_fee_schedule`, `withdraw_fees`, `register_integrator` | extended |
| `protected_buy`, First Print variants | unchanged in spirit; First Print uses fee-inclusive amounts on both legs | kept |
| (none) | Anchor events for every state change | added |

## 4. Every test that changes

Part 1 section 4.2's list stays and is re-expressed on series:
- exercise day one, mid-window, one second before expiry; after expiry rejected; double exercise rejected; settle before expiry rejected; grid enforcement; Pyth stale or missing never blocks exercise or settle.
- "buy split across three commitments" becomes "buy walks three asks from three writers, each settles pro rata" and adds the addendum F test (two writers, exercises on day one and day six, identical payouts).
- "partial exercise then release" becomes partial exercise then `settle_writer` for every writer then `close_series` with zero or dust-only vaults (addendum E, prime-numbered `sold_raw`).
- multiplier-change invariance test unchanged (`strike_total_per_unit` fixed at creation).
- new: ask-list full eviction and rejected insert; walk bound partial fill and `QuoteMoved`; fee vault and integrator claim balances after a referred buy; position mint supply invariant, collateral invariant and `sum(sold_raw)` invariant checked at every instruction boundary in a property test with random sequences; transfer-hook extra accounts on every vault transfer; transfer-fee round trip on a Tessera mint reconciled to the unit.
- web: the screenshot spec's pages gain the market list and the per-market term grid; the em-dash and one-`h1` checks stay.

## 5. Order of work, next three sessions

**Session 1 (this one).** Architecture decision under the lean fleet (`docs/01-architecture.md`), `docs/PLAN.md` per Part 1's kickoff (repo layout, NVDAx extensions read from chain, feed ids with sources, `fundToken` and `timeTravel` confirmed, account layout with sizes, no-oracle exercise path, multiplier invariance, quoter model, Tessera fee legs, five risks), `docs/OPERATOR.md`, then P0: workspace, fork script, eligibility script on the launch set, `docs/MINT.md`, `docs/FEEDS.md`. P0 stops at the first missing key (Pyth Core).

**Session 2.** P1: the pooled-series program with the full test list above on litesvm/localnet, then on the fork with time travel; `docs/RENT.md`, `docs/COMPUTE.md`. P2: price service, quoter (tier 1 process), keeper, indexer (Postgres or SQLite fallback on the fork), executable-protection endpoint.

**Session 3.** P3 and P7 together: web on real fork data, market list, term grid with lazy series, wallet transactions, registry job and `create_market` for the launch set, addendum H landing changes. Then P4 (Protected Buy, First Print), P6 (README "what is live", bounty forms), P5 stop-and-ask.

## 6. What the addendum changes that was already built

- Lazy series creation: the web term grid must distinguish "quotable" from "live"; the fixture grid assumed every term exists. Refactored in P3.
- Ask-list bounds: the fixture's three-rung ladder is replaced by the real ask list; the Act screen gains the partial-fill line. Refactored in P3.
- Dust policy: no code yet; specified in the program tests above.
- Fee vaults: the fixture `feeBps: 25` and "fee at buy" display stay correct in shape; the value and the integrator line come from `set_fee_schedule`. Refactored in P3.
- Cut line (addendum B): everything in the deferred list is absent from the UI. The current app already has no notifications, GraphQL, PDF export, pooled vault, widget or SDK.

---

# Part 3 reconciliation: the supply side

Written 2026-09-20 against the program as it stands (`programs/roster_finance/src`). Facts cite files.

## Nothing in the ask book is removed

The book stays exactly as built and Part 3 adds to it. What stays, by file:

- `state.rs`: `Series` with its 32-entry `asks` and 32 `writers` slots, the assignment product `p`, `unassigned_lots6`, `total_sold_lots6`, `total_exercised_lots6`.
- `instructions/writer.rs`: `quote` (sorted insert, worst-ask eviction, `MAX_ASKS_PER_WRITER`), `cancel_ask`, `withdraw_unsold`, `claim_premium`.
- `instructions/buy.rs`: the walk over at most `MAX_WALK` (8) asks, never above the limit, `QuoteMoved` when nothing fills.
- `instructions/exercise.rs`: burn first, then the two legs, then `apply_exercise` on the product. No oracle.
- `instructions/settle.rs`: `settle_writer` pro rata of `sold_lots6` through `fold`, `close_series` with the dust sweep and, since M8.5, the withheld-fee harvest.
- `instructions/auto_exercise.rs`: the crank with the posted Pyth update, the only place a price touches settlement.

The vault is **one more writer** in that book. It occupies a writer slot like anyone, posts through the same sorted insert, is evicted by the same rule, settles through the same `settle_writer`. The only new program surface is the account that owns the vault's collateral and the instructions that let its manager act for it, plus `sell_to_vault`.

## Accounts

**`Vault`** `[b"vault", market, kind]`, `kind` = `CoveredCall` (collateral is the underlying, quotes call series) or `CashSecuredPut` (collateral is USDC, quotes put series). Fields: `market`, `kind`, `bump`, `manager` (the key allowed to post and cancel for it: the quoter wallet), `share_mint` (Token-2022, 6 decimals, metadata names the vault), `collateral_ata` (the vault PDA's associated account for its collateral mint), `premium_ata` (its USDC account; for the put vault the same account), `epoch`, `epoch_start_ts`, `next_roll_ts`, `roll_interval_secs` (604800), `total_shares`, `share_price_1e6` (published at each roll), `pending_deposits` (collateral queued for the next epoch), `pending_withdraw_shares` (shares queued for this epoch's end), `cap_per_series_lots6`, `cap_total_lots6`, `spread_bps`, `state` (`Open` | `Rolling` | `Halted`), breaker flags, and per-epoch P&L fields: `epoch_premiums_in`, `epoch_buybacks_out`, `epoch_assigned_lots6`, `epoch_pnl_1e6` (signed, per share).

**`VaultPosition`** `[b"vpos", vault, depositor]`: `queued_collateral` and `queued_epoch` (enters at the next roll), `queued_withdraw_shares` and its epoch (paid at the roll), nothing else; live shares are the Token-2022 balance.

**`VaultBid`** `[b"vbid", vault, series]`: `bid_per_lot`, `max_lots6`, `posted_at`, `expires_at`. The vault's standing bid on one series, written by the manager and read by `sell_to_vault`.

## The vault posts through the existing path, with no special case

`handle_quote` is split into what it already is: a deposit step and a book step. The book step (`find_or_claim_slot`, the free-collateral check, the per-writer ask limit, the sorted insert and eviction, the `AskPosted` event) moves to `instructions/book.rs` as `post_ask(series, writer_key, ask_lots6, ask_per_lot)` and is called by both `quote` and the new `vault_quote`. `cancel_ask` and `withdraw_unsold` get the same treatment. The only difference between a person and the vault is who signs: a person is `Signer`; the vault is a PDA whose transfers into and out of the series vault carry its seeds, authorised by `manager`. The series never learns which of its writers is a vault.

Vault instructions: `init_vault`, `set_vault_params`, `vault_deposit` (queues collateral, mints nothing yet), `vault_request_withdraw` (queues shares), `vault_cancel_queue`, `vault_roll` (permissionless once `next_roll_ts` has passed), `vault_quote`, `vault_cancel_ask`, `vault_withdraw_unsold` (series vault back to the vault), `vault_claim_premium`, `vault_settle_writer` (a thin wrapper: `settle_writer` already pays to the writer's ATA and the vault PDA's ATA is derivable, so this is `settle_writer` with the vault as writer), `vault_post_bid`, `sell_to_vault`.

## `sell_to_vault` and its accounting

`sell_to_vault(series, lots6, min_premium_per_lot)` by a position-token holder:

1. Reads `VaultBid` for the series; refuses when absent, expired, or below `min_premium_per_lot` (`QuoteMoved`).
2. Folds the vault's writer slot to the current product, so `open_lots6` is the vault's *unassigned* short right now.
3. `fill = min(lots6, open_lots6, bid.max_lots6)`. Zero fills is `QuoteMoved`; a partial fill is returned and stated in the event.
4. Burns `fill` position tokens from the holder (the holder's signature on the trade, before any payment, as in `exercise`).
5. `vault_slot.open_lots6 -= fill`, `vault_slot.sold_lots6 -= fill`, `series.unassigned_lots6 -= fill`, `series.total_sold_lots6 -= fill`. The product `p` does not move: the lots leave the pool as if never sold, so every other writer's share of what remains is unchanged. This is the argument that assignment after a buyback stays exact, and the "buyback then assignment" test asserts it to the unit.
6. Pays `fill × bid_per_lot` USDC from the vault's premium account to the holder, rounded down.
7. Emits `BoughtBack { series, holder, lots6: fill, requested: lots6, premium }`.

The released collateral stays in the series vault under the vault's slot as free collateral, exactly as if the ask had never filled; `vault_withdraw_unsold` moves it back when the quoter wants it. A buyback beyond the vault's short is capped at step 3: the vault can never be net long its own contracts.

## Pricing inputs and where each is logged

The quoter's existing model (`packages/quoter`, `docs/QUOTER.md`) gains a vault leg. Inputs, each written on every decision line: mark and source; realised vol with its window and whether the floor bound; session and its multiplier (`1.0`, `1.4`, `1.8`, `2.2`); the vault's own `sold_lots6` against `cap_per_series_lots6` and the resulting utilisation skew; the ask; the bid (ask less spread, widened by the session multiplier, floored at intrinsic) and the bid size (the vault's `open_lots6`); the breaker state (basis, staleness, mint pause, epoch drawdown). Lines carry the vault address and the series. `docs/PRICING.md` documents the model and the 19 percent-of-the-week mismatch.

## Epoch state machine

`Open` → (`next_roll_ts` passed, anyone calls `vault_roll`) → `Rolling` → (every expired series the vault wrote is settled and its free collateral pulled back; premiums claimed) → P&L for the epoch computed and `share_price_1e6` published; queued withdrawals paid at that price, queued deposits minted at that price; `epoch += 1`, `next_roll_ts += roll_interval_secs` → `Open`. `Halted` is entered by a breaker or the pause authority and exits to `Open` by the authority; a halted vault still settles and still honours withdrawals at the roll. Deposits made during `Open` wait for the roll; withdrawals requested during `Open` wait for the roll. Both queues and `next_roll_ts` are on the vault account, so the UI shows them before a person deposits.

## Edge cases mapped to tests

| Edge case (Part 3 section 5) | Test |
| --- | --- |
| Vault evicted from the book | `vault_evicted_by_cheaper_asks` (litesvm): 32 cheaper asks, vault ask gone, its collateral free, `AskPosted.evicted_seq` names it |
| Buyback beyond the vault's short | `sell_to_vault_caps_at_vault_short`: request 10, vault short 5, fill 5 stated |
| Buyback then assignment | `buyback_then_exercise_exact`: buy back 5, another holder exercises 5, every vault balance to the unit, vault never over-released |
| Multiplier activation mid-epoch | `vault_multiplier_change_invariant`: replica multiplier updated, payoffs unchanged, share accounting correct |
| Pin risk | `auto_exercise_declines_one_cent_itm`: moneyness under keeper fee plus buffer declines with the reason |
| Exercise into a thin spot book | `position_cap_from_spot_depth` (services): a size above the measured-depth cap is refused with a message |
| Basis blowout | `breaker_basis_halts_vault_not_book` (services, fork): 500 bp basis, vault quoting halts, external asks and exercises continue |
| Mint freeze or pause | `frozen_mint_exercise_fails_legibly` (fork): freeze on the fork, named error, nothing silent |
| Stale price | `exercise_with_stale_or_absent_pyth` (exists for exercise; extended to assert `sell_to_vault` checks staleness) |
| Auto-exercise delegate | `revoked_delegate_blocks_crank` (exists) |
| Epoch roll with an open assignment | `last_day_exercise_lands_in_this_epoch` |
| Dust | `vault_three_prime_depositors_dust_only` |

## Order of work

1. `book.rs` extraction (no behaviour change; the existing suite must stay green).
2. `Vault`, `VaultPosition`, `init_vault`, `vault_deposit`, `vault_request_withdraw`, `vault_quote`, `vault_cancel_ask`, `vault_withdraw_unsold`, `vault_claim_premium`, with the Covered Call kind first.
3. `vault_roll` with share price and both queues.
4. `VaultBid`, `vault_post_bid`, `sell_to_vault`.
5. Cash-Secured Put kind (the same code with the other collateral mint).
6. Quoter vault leg, breakers, `docs/PRICING.md`.
7. App: vault deposit and withdraw with queue timing, per-epoch P&L, the sell button on every position.
