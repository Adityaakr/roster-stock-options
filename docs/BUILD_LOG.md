# Build log

One entry per phase (CLAUDE.md 0): what was built, what was verified against which source, what was cut, open risks.

## 2026-09-17 · Design port (pre-P0): landing page and product screens

**Built.** `apps/web`: Next 16.3.5, React 19.2.8, Tailwind v4, `motion` 13.2.0, `lenis` 1.3.26, on the Lookthrough / Aoutive design system copied verbatim (`docs/DESIGN.md`, `tokens.css`).
- Landing `/`: every section of CLAUDE.md 6 in order, with the live Discover table (nearest expiry) as the hero's primary element under the pixel-mask reveal and the disclosure line beneath it.
- App screens from CLAUDE.md 5: Discover `/trade`, Act `/trade/[term]` (payoff slider with max loss pinned, quote at size, escrow list, disclosure), Manage `/positions` (countdown, mark and basis, ITM, exercise words, auto-exercise rule, exercise with confirmation and partial size), Commit `/underwrite` (lock, premium, effective price, three adverse prices), Roster `/roster` (quotes at three sizes, reserves with accounts, capacity, exercise history with failures), Protected Buy `/buy`, First Print `/pre-ipo`.
- Data: `lib/model.ts` (types, session clock, next Fridays, payoff arithmetic), `lib/roster-data.ts` (server, fixture cluster), `/api/roster`, `/api/cluster`. The shape is what P2's indexer and executable-protection endpoint return.
- Screenshots at 1280 and 390 for all eight pages in `apps/web/e2e/screenshots` (`pnpm shots` against a running dev server), and the four product frames the landing page swaps through in `apps/web/public/frames`.

**Verified.**
- `pnpm typecheck` and `pnpm lint` green; 16 Playwright runs green: one `h1` per page, no console errors, no em-dash in rendered HTML.
- Session logic checked against Pyth market hours (regular 09:30 to 16:00, pre 04:00, post to 20:00, overnight Sun to Thu 20:00 to 04:00, New York): `https://docs.pyth.network/price-feeds/market-hours`. NYSE holidays are not modelled; the keeper must read feed status.
- Worked examples hold arithmetically against the fixture premiums: Gap 10 x $5.40 = $54, +$126 at $198; Floor 20 x $3.00 = $60 backed by $3,600; Commit lock $3,600 collect $60.
- Difference table, First Print figures (marks, holders, mints, 0.2% fee, 19% discount) and the hours arithmetic (168, 32.5, 75, 63%, $376.3B vs $7.5B) are exactly CLAUDE.md 2 and 6; nothing was added.
- Motion values reproduced from the reference source, not from memory: `apps/web/src/components/motion.tsx` is the reference file plus `PixelMask`.

**Cut or deferred.**
- No program, quoter, keeper or indexer: the cluster badge reads `Fixture`, every instrument prints the fixture line, buy / quote / exercise buttons are disabled with a `role=alert` explaining that the program is not deployed. No signature, mint, feed id or escrow account is invented anywhere: such fields render as `linked at deploy` or `no signature on this cluster`.
- Mark ($182.30), premiums, reserves, positions and the two exercise events are fixtures chosen so the brief's worked examples hold. Expiries and the session badge follow the real clock.
- Article URLs for CoinGecko, Decentralised.co, The Block, Pantera and Alpaca were not in the brief and are `null` in `components/landing/sources.ts`; the sources card shows "link pending verification" until they are filled in.
- Product-card illustrations are the Aoutive template art carried over from the reference; replace when brand art exists.
- The landing page owns `/`; the app's Discover screen lives at `/trade`. CLAUDE.md 5 names Discover as `/`; the hero table is that screen, so both hold.

**Open risks.**
- Wallet adapter is wired (`Providers`) but no transaction is built yet; CLAUDE.md 4.4 (app builds, `signTransaction` only, app RPC) is a P3 task.
- `sessionAt()` ignores NYSE holidays and the Pyth Pro session feeds; P0 records which feeds are readable.
- `nextFridays()` walks hours to find 16:00 New York; cheap and DST-safe, but a Friday NYSE holiday would still be listed as an expiry. The grid config in `Market` decides in P1.
- The reference's `.crosshair` / `.fullimg` classes have no CSS (inherited quirk, harmless).

## 2026-09-17 · Landing page content and placement pass

**Changed.**
- Order now follows CLAUDE.md 6 with the extra sections slotted where they read: hero, built-on strip, the weekend (problem), the hours (counters + strip), the three worked examples, the five products, how it works, how it is different, the roster, what this is not, First Print, said out loud, risk, CTA. Nav: The problem · What you can do · How it is different · The roster · What this is not.
- Product cards: the Aoutive template art (with its "Customer Support" labels) is replaced by payoff sketches drawn per product in the page's hairline SVG style (`components/landing/sketches.tsx`), the ink line drawn on view.
- Difference: short headline ("Perps take the position. Roster caps the loss."), the full line in the body, equal-width columns with the venue examples as sub-labels, Roster column no longer wraps.
- Hours strip: short segment labels with a legend; nothing truncates.
- Said out loud: six sources (Tessera's terms live in First Print), CTA under the roster ledgers centred.
- First Print: column heads equalised, bullets no longer duplicated across tOpenAI and tKalshi.
- Risk: "what is live" carries a phase badge per line instead of an inline note.
- Workflow frames: captured at 2x from the main content area with `devIndicators: false`, so the Next dev badge is gone and the screens are legible (`e2e/frames.spec.ts`, its own Playwright project).

**Verified.** typecheck, lint, 20 Playwright runs green (4 frames + 8 pages x 2 viewports).

## 2026-09-17 · P0 foundation

**Built.** Anchor 1.2.0 workspace (`Anchor.toml`, `Cargo.toml`, `rust-toolchain.toml`), `programs/roster_finance` with `init_protocol` and the `Protocol` account; `packages/core` (lots, strike per lot, multiplier rule, session clock) with unit tests; `scripts/{fork,anchor-test,idl-sync,anchor-deploy}.sh`, `scripts/fork-lib.ts` (cheatcodes, mint resolution from the xStocks API, extension-preserving token funding), `scripts/seed-fork.ts`; `tests/e2e/p0-foundation.test.ts`; `docs/PLAN.md`, `docs/MINT.md`, `docs/FEEDS.md`, `docs/01-architecture.md`, `docs/02-roadmap.md`, `docs/DECISIONS.md`, `docs/RECONCILIATION.md`, `docs/OPERATOR.md`.

**Verified.**
- `anchor build --arch v0` green with `event-cpi` and `token_2022_extensions` (81 s cold).
- `pnpm test` (core): 8 passed. `pnpm test:fork` against surfpool 1.0.0 forked from public mainnet: 5 passed: wallet funded with NVDAx (179-byte ATA, extensions intact) and USDC; multiplier from the mint equals the xStocks API `currentMultiplier` (1.001701196801074); `transfer_checked` of 5 NVDAx between two seeded wallets succeeds; time travel to a Saturday reports the equity session closed; Hermes price read skipped with the named warning (no key).
- NVDAx mint extensions read from chain and recorded (`docs/MINT.md`); feed ids from Hermes (`docs/FEEDS.md`); USDC mint resolved from Jupiter's verified list and read on-chain (6 decimals, SPL Token) after a from-memory address failed `WrongSize`, which is the guardrail working.
- `surfnet_timeTravel` behaves as documented (forward only, milliseconds). `surfnet_setTokenAccount` works with the Token-2022 program id but strips account extensions; replaced by `surfnet_setAccount` on the real bytes.

**Cut.** Nothing. Hermes price assertions run only when `PYTH_CORE_API_KEY` exists.

**Open risks.** The Pyth key blocks P2 pricing (`docs/OPERATOR.md`). Public mainnet RPC as the fork datasource rate-limits `getProgramAccounts`; nothing here uses it.

## 2026-09-17 · M1 · P1a program core

**Built.** `programs/roster_finance`: `Protocol`, `MarketConfig`, zero-copy `Series` (bounded 32-ask list, 32 in-account writer slots, stability-pool assignment product `P` with scale and epoch), instructions `init_protocol` (with the fee vault), `create_market` (extension flags derived from the mint), `update_market` (pause key can only pause), `create_series` (Token-2022 position mint with MetadataPointer + on-mint TokenMetadata + MintCloseAuthority, three pooled vaults, permissionless on the grid), `quote`, `cancel_ask`, `withdraw_unsold`, `claim_premium`, `buy` (8-ask walk, fee once, premiums accrued, fixed account set), `exercise` (burn, no oracle, never pausable), `settle_writer` (permissionless, derived destinations), `close_series` (dust swept, rent reclaimed, mint closed only at supply zero). `math.rs` holds the assignment arithmetic with 7 host unit tests replaying every skeptic counterexample.

**Verified.** `anchor build --arch v0` clean (no stack-frame warnings after moving `Series` to `AccountLoader`); `cargo test --lib` 7 passed; litesvm suite `tests/program.rs` **13 passed**: position mint with metadata; off-grid strike and expiry rejected; three-ask walk with fee accounting, partial fill and `QuoteMoved`; exercise on day one, mid-window, one second before expiry, after expiry rejected, oversize rejected; pro-rata settlement of three writers after a partial exercise with vaults at zero, close after grace reclaims rent and leaves the mint with 90 lots outstanding; late writer gets none of earlier proceeds (adversary 1, epoch roll); equal writers equal payouts (addendum F); prime-sized writers with an awkward partial exercise leave only dust (addendum E); five griefing rounds then a new writer (skeptic A(c)); multiplier change mid-life leaves the contract untouched; ask-list eviction, rejection and the per-writer cap; put round-trip; issuer pause fails escrow transfers cleanly and resumes.

**Lessons banked.** Anchor 1.x `CpiContext::new` takes the program `Pubkey`; a zero-copy borrow must be dropped before any CPI that passes the series as signer (`AccountBorrowFailed` otherwise); litesvm `warp_to_slot` leaves `unix_timestamp` untouched, so `set_sysvar::<Clock>` is the clock.

**Cut.** Nothing from the M1 list. Fees, auto-exercise, halt rule, property test and the fork lifecycle are M2.

**Open risks.** CU per instruction not yet measured (`docs/COMPUTE.md` in M2). The `Fill` events use `emit!`; an 8-fill buy is within the log budget on litesvm but `#[event_cpi]` is the fallback if the indexer ever sees truncation.

## 2026-09-17 · M2 · P1b: fees, auto-exercise, halt rule, invariants, fork lifecycle

**Built.** `update_protocol` / `withdraw_fees` (authority only; the pause key can only pause), `enable_auto_exercise` / `disable_auto_exercise` (program PDA delegate on the position and the paying account), `auto_exercise` (window `[expiry − grace, expiry)`, `PriceUpdateV2` from `pyth-solana-receiver-sdk` 2.0.0 `pro-compatible` checked for age, feed id, full verification and confidence; the only multiplier read in the program; keeper fee from the fee vault), `observe_halt` and the 24 h settlement grace after an issuer pause or vault freeze, `fold` skipping lossless snapshots (removes per-fill dust). `packages/sdk`: `@anchor-lang/core` client with PDAs, decoders for the zero-copy series, and unsigned-transaction builders for every instruction. `tests/e2e/p1-fork-lifecycle.test.ts`. `docs/COMPUTE.md`.

**Verified.**
- `cargo test --release -p roster_finance`: 7 unit + 13 core + 4 P1b + sizes + compute, all green. P1b covers: fees to the treasury only, pause-key privilege limits, exercise never pausable; auto-exercise declines when not opted in, outside the window, out of the money, stale, wrong feed, partially verified or wide-confidence, and fires when fresh and in the money with the keeper paid from the fee vault; the halt rule; a 160-step seeded random walk over quote/buy/exercise/withdraw holding supply = sold − exercised, Σ sold = total, open ≤ unassigned, assigned ≤ exercised, vault ≥ (unassigned + free) × unit, followed by settlement of every writer with only dust left.
- Fork (surfpool 1.0.0 forked from public mainnet, program deployed at `FJUdsdmxAp3zAwZBg3ai34xzeCBDobnH1XDarvVa7uFV`): 5 passed on the **real NVDAx mint** `Xsc9qvGR…` and real USDC: extension flags derived on-chain match `docs/MINT.md`; series created; 100 lots of NVDAx quoted; 20 bought; 5 exercised (USDC in, NVDAx out); expiry reached with `surfnet_timeTravel`; writer settled 95 lots back plus 5 × 180 USDC; series closed after grace.
- CU: `create_series` 76k, `quote` 17k, `buy` walking 8 asks 74k, `exercise` 46k.

**Cut.** `#[event_cpi]` (plain `emit!` fits the log budget); the on-chain Pyth `post_update_atomic` is composed by the keeper in M3 (needs `PYTH_CORE_API_KEY`).

**Open risks.** Auto-exercise approves the delegate for the balance at opt-in time; positions bought later need a re-enable (Manage shows this). The independent skeptic review of the program is running; its findings become fix milestones before M3 lands.

## 2026-09-17 · M2.1 · Program skeptic fix pass

**Findings and fixes.** CRITICAL: `auto_exercise` let a keeper drain the fee vault by cranking repeatedly against a holder's balance; now `lots6` must equal `min(holder balance, unassigned)`, the keeper fee is `min(keeper_fee_usdc, fee vault balance)`, and the opt-in is per holder per series (`[b"autoex", holder, series]`). HIGH: an issuer pause could leave a series settleable by the clock while holders could not exercise; `observe_halt` records `halted_at`, resume sets `resumed_at`, and `effective_expiry = max(expiry, resumed_at | halted_at + 24 h)` while halted gates `exercise`, `settle_writer` and `auto_exercise`. HIGH: the assignment product `P` could reach zero and brick later writers; it now rolls the epoch (`p = P_ONE`, `scale = 0`) with a unit test. MEDIUM: `create_series` refuses puts on transfer-fee mints until First Print; `symbol` and `feed_prices_ui_share` moved into `MarketConfig` so nothing user-supplied names a series. LOW: `update_protocol` rejects negative grace; `close_series` requires the series to be open.

**Verified.** `cargo test --release -p roster_finance`: 8 unit + 13 core + 4 P1b + sizes + compute, all green (P1b's halt test now calls `observe_halt` after resume and the 220-step random walk bounds dust by steps). Fork, fresh surfpool with the program redeployed: `pnpm test:fork` 13 passed (P0 5, P1 5, P2 3).

**Lessons banked.** The fork keeps the old account layout across a program upgrade, so a `MarketConfig` layout change means a fresh fork (`kill` surfpool, `pnpm fork`, `pnpm anchor:deploy`). Vitest runs e2e files in parallel by default; on one shared fork with time travel they must run in order (`test:fork` now runs P0, P1, P2 as three invocations). Port 8790 was held by another tool on this machine and the health poll silently hit it; the services bind `127.0.0.1` on a high port in tests and the poll checks the `program` field. `@anchor-lang/core`'s `EventParser` returns camelCase names although the IDL is PascalCase; the indexer normalises. surfpool rejects `getSignaturesForAddress` with `until`, and after a time travel lists a newer transaction under a lower slot than an older one, so the indexer dedupes by signature instead of a cursor. A `setInterval` tick must not overlap itself or the keeper and quoter race their own transactions.

## 2026-09-17 · M3 · P2 services on the fork

**Built.** `packages/oracle` (Hermes with a bounded fetch, Benchmarks realised vol, xStocks multiplier watcher, session clock), `packages/indexer` (`node:sqlite`, markets, series, events, prices, basis, signature dedupe), `packages/quoter` (grid population under the live cap, Black-Scholes ask with closed-session and activation-window spreads, cancel-and-repost past a tolerance, every decision logged with its inputs), `packages/keeper` (grid roll, halt observation, settle and close after the protocol's own grace, auto-exercise candidates), `packages/services` (one process, REST on `/v1/health /v1/roster /v1/protection/:series /v1/positions/:wallet /v1/events /v1/basis`). Fork-only `REFERENCE_PRICE_<SYMBOL>` stands in for the token feed without a Pyth key and is refused off the fork.

**Verified.** `tests/e2e/p2-services.test.ts` on a fresh fork: the services quote every one of the 12 grid series of the Tier 1 market; survive four 6-hour time travels through a closed session while keeping asks; settle every writer and close the nearest expiry after grace, proven from the indexed `WriterSettled` and `SeriesClosed` events rather than the process log; `/v1/protection/:series` answers three notionals with vault addresses and balances. Unit suites 18 passed.

**Cut.** Auto-exercise at expiry on the fork needs a posted Pyth update and therefore `PYTH_CORE_API_KEY`; the test names the skip. Tier 2 markets and the registry beyond NVDAx are M5.

**Open risks.** The quoter's realised vol falls back to the floor (`VOL_FLOOR`, 0.35) without a Pyth key, so every fork ask is priced off the floor. `REFERENCE_PRICE_<SYMBOL>` is a test device and must never be set on a real cluster (the services refuse it by genesis hash).

## 2026-09-17 · M4 · P3: the app on live data, wallet flow, compliance

**Built.** `apps/web` reads the services process (`SERVICES_URL`) and falls back to the fixture cluster, saying so. Multi-market model: market list by executable depth with search and tier filter, term ids keyed on the per-lot strike, per-share strikes shown at the live multiplier. Transactions: `/api/tx/build` assembles with a read-only wallet, the browser wallet signs, `/api/tx/send` submits through the app's RPC and confirms (CLAUDE.md 4.4); a failure taxonomy maps program errors to what happened and the next action. Act with the exact on-chain cost (asks walked as `buy` does, fee rounded up), escrow accounts, split count, referrer disclosure; Manage with positions across markets, partial exercise, the auto-exercise delegate with revoke, and every receipt from the program's own events; Commit with deposit-and-quote in one transaction, the writer's slot (cancel, claim, withdraw, settle); Roster protocol-wide and per market. `proxy.ts` geo gate with a plain page and HTTP 451; `/risk /fees /terms /privacy`. Landing per addendum H: hero market list, "Every stock, honestly tiered", the coverage row, the fragmentation answer; the copy FIX list applied. Fork-only burner wallet so the flow can be driven without an extension.

**Verified.** `apps/web/e2e/flow.spec.ts` on the fork against the running services: connect the burner wallet, fund it through the cheatcodes, buy a Gap (2 NVDAx), buy a Floor, write a Floor (3 NVDAx at 1.00, the slot shows the resident ask), exercise 1 NVDAx with the exchange restated, time-travel past the written term's expiry and see the release receipt from the `WriterSettled` event: 1 passed (30 s). Screenshots at 1280 and 390 for every screen, no console errors: 20 passed. Geo gate: `x-vercel-ip-country: US` on `/trade` and `/api/tx/build` gives 451 with the message; `/risk` stays 200.

**Lessons banked.** `@anchor-lang/core`'s ESM build references `exports`; it must be a `serverExternalPackages` entry, not bundled. The burner wallet lives in the page, so a flow test refreshes in place and never reloads. Playwright compiles specs as CommonJS under `apps/web`, so shared helpers resolve the repo root by walking up to `pnpm-workspace.yaml` rather than `import.meta`. Events are pulled on their own 3-second loop because a repricing tick can take a minute and a receipt should not wait for it. `getSignaturesForAddress` block times on surfpool are not unix seconds.

**Cut.** Watchlists, CSV and PDF export, the pooled vault option, Blinks and the widget (Part 2 section 6, after the cut line). Treasury P&L on the roster waits for the accounting rows in M5.

**Open risks.** With no country header from an edge, nothing is geo-blocked (docs/OPERATOR.md). The reference price on the fork prices every ask off the volatility floor.

## 2026-09-17 · M5 · P7-lite: registry and launch set on the fork

**Built.** `packages/registry`: xStocks Assets API (assets, Solana mint, issuer quote), Hermes feed listing (exact-symbol matches only), on-chain mint inspection (token program, every extension, delegate, hook and whether it is live, fee, pausable, scaled UI amount, decimals) and the verdict rule. `scripts/eligibility.ts` writes `fixtures/registry/registry.json` and `docs/ELIGIBILITY.md`; `scripts/list-markets.ts` creates each eligible market on the fork with its tier's grid and caps and proves the escrow (a series, one lot quoted into the vault, withdrawn) before the registry counts it. The services run every proven market; the quoter applies the tier rule (Tier 1 both expiries, Tier 2 the nearest, Tier 3 no treasury quotes); without a Pyth key the issuer quote stands in on the fork and is a display mark elsewhere. `pnpm seed` funds every registry mint.

**Verified.** 11 of 11 candidates (Tier 1 NVDAx, TSLAx, SPYx; Tier 2 AAPLx, MSFTx, GOOGLx, AMZNx, METAx, CRCLx, MSTRx, QQQx) read as plain Token-2022 mints with a permanent delegate, pausable config, freeze authority and a transfer-hook slot with no program; all have a `Crypto.<SYMBOL>/USD` and an `Equity.US.<UNDERLYING>/USD` feed (the three Tier 1 ids equal the P0 probe); all 11 escrow proofs landed. Services: 11 markets quoted from the right tier (Tier 1: 12 series, Tier 2: 6). Browser flow on the fork with 11 markets: 1 passed. Backpack entitlements held: no issuer source for a Solana mint.

**Lessons banked.** A fork shares mainnet's genesis hash; "fork-only" behaviour is keyed on a loopback RPC. surfpool cannot page `getSignaturesForAddress` with `before`; the indexer asks for 1,000 at once and keeps the first page if paging fails. The app's nav carries `?m=` so a screen change keeps the market.

**Cut.** tokens.xyz tiers and the full 400-name walk (`--all` exists; verdicts for the long tail wait for `TOKENS_XYZ_API_KEY` and a session with the public RPC's rate limits). Treasury P&L rows.

**Open risks.** The NVDAx market carries series from the earlier runs at its cap until they expire and close. Tier 2 caps are the roadmap's defaults, not sized to the treasury.
