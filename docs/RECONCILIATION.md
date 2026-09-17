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
