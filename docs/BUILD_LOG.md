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
