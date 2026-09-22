# Roster Finance project model (Prism code-truth layer)

## Architecture
pnpm workspace. `programs/roster_finance` (Anchor 1.2, zero-copy `Series`, 18 instructions). `packages/{core,sdk,oracle,indexer,quoter,keeper,registry,services}`; `packages/services/src/main.ts` is the one process (tick loop + 3 s event pull + REST :8787). `apps/web` (Next 16.3.5) reads the services (`lib/services.ts` -> `lib/roster-data.ts` -> `/api/roster?m=&fresh=`), builds transactions server-side (`lib/tx-server.ts`, `/api/tx/build`), the wallet signs, `/api/tx/send` submits. Geo gate `src/proxy.ts`. Registry file `fixtures/registry/registry.json` written by `scripts/eligibility.ts`, markets listed and escrow-proven by `scripts/list-markets.ts`. Fork: surfpool at 127.0.0.1:8899; program `FJUdsdmxAp3zAwZBg3ai34xzeCBDobnH1XDarvVa7uFV`.

## Invariants (cited)
- One lot is one raw underlying token (1e6 lots6); strikes are USDC per lot; the program never reads a multiplier except in `auto_exercise` behind `feed_prices_ui_share` (`programs/roster_finance/src/state.rs`, `docs/MINT.md`). The app shows per-share strike as per-lot / multiplier (`apps/web/src/lib/roster-data.ts` `liveTerm`).
- No id, address, feed id, signature or URL is invented: registry from the issuers' APIs and the chain; feeds from Hermes' listing with exact symbol matches (`packages/registry/src/feeds.ts`).
- Fee mints: the vault credits what arrived; Floors refused on fee mints (`create_series.rs:76`); the quoter sizes asks under the deposit (`packages/quoter/src/quoter.ts`).
- Fork-only behaviour (issuer quote as price, burner wallet, REFERENCE_PRICE_*) keys on a loopback RPC or `NEXT_PUBLIC_CLUSTER=fork`; a fork shares mainnet's genesis hash.
- The cluster is shown on every product screen; copy lint: no em-dash, no "demo", figures in mono (`apps/web/e2e/shots.spec.ts`).
- Mainnet is a stop: `scripts/anchor-deploy.sh` refuses without `DEPLOY_MAINNET_APPROVED=1`; `docs/SEEDING.md` holds the unexecuted proposal.

## Danger zones
- Part 3 vault on a transfer-fee mint: `vault.rs:519` adds the gross deposit to `locked_raw` while `book.rs:42` credits net and `vault.rs:569,622` subtract net, so the fee residual never clears and `vault.rs:342` refuses every roll after the first quote (the devnet tKalshi vault holds a 120,181,000 raw residual as of 2026-09-20). Fix pending: credit `locked_raw` with `arrived`.
- Pre-IPO pricing: `main.ts:119` asks Benchmarks for `Crypto.<SYMBOL>/USD`, absent for PreStocks, so vol is the 0.35 floor on the fork and devnet; `main.ts:220` applies the NYSE session multiplier to tokens with no session; `decideAsk` has no fee term; `docs/PRICING.md:16-17` claims a marks-based vol source that does not exist.
- Fee-mint Floors: `create_series.rs:79-80` guard; lifting it alone shorts the last put writer (`exercise.rs:97-98` assigns full `lots6` against a net settlement vault, `settle.rs:118` caps). Correct fix is a gross-up via `TransferFeeConfig::calculate_inverse_epoch_fee` (spl-token-2022-interface 2.1.0 `transfer_fee/mod.rs:160`).
- `sessionAt()`/`nextExpiries()` use the New York clock, not NYSE holidays.
- The NVDAx fork market sits at its 12-series cap with series from earlier runs until they expire.
- The fork clock is ~22 days ahead after time travels; oracle-based Jupiter venues fail there and are routed around.
- `packages/sdk` `decodeSeries` drops empty writer slots; slots are dense by construction (first free slot claimed), so ask `writer_slot` indices stay valid.
- Playwright specs under `apps/web` compile as CommonJS: no `import.meta` in shared helpers (`scripts/fork-lib.ts` walks up to `pnpm-workspace.yaml`).

## Decision log
- 2026-09-17 Design port before P0: copy Lookthrough's landing and product design exactly, swap content.
- 2026-09-17 M2.1 skeptic fixes: per-series auto-exercise opt-in, keeper fee bounded by the fee vault, halt rule with effective expiry, P epoch roll at zero.
- 2026-09-17 M3/M4: services as one process; app on live data with server-built, wallet-signed, server-sent transactions; burner wallet on the fork for browser-driven proof.
- 2026-09-17 M5: registry package; tier rules in the quoter; issuer quote as the keyless stand-in on the fork only.
- 2026-09-17 M7: Protected Buy as a v0 transaction (Jupiter swap + `buy`) simulated server-side with venue exclusion on failure; pre-IPO priced off the issuer mark by design (no Pyth feed exists).

## Decision log (continued)
- 2026-09-20 PreStocks bounty (docs/03-prestocks-decision.md): Tessera leaves every runtime surface (the clause is a hard ineligibility); OPENAI and SPACEX become devnet markets on faithful replicas (50 bps fee, live ScaledUiAmount multipliers 1.486 and 5); PreStocks desk states the token-vs-mark spread as a signed two-way figure, never "no exit"; vault residual, pre-IPO vol, fee-in-ask fixed before the vault is shown; fee-inclusive Floors attempted with a hard stop at Sep 22 12:00 UTC.

## Lessons
- `@anchor-lang/core` ESM references `exports`: `serverExternalPackages` in Next; `EventParser` returns camelCase names, `BN.toJSON` is hex.
- surfpool: `getSignaturesForAddress` rejects `until`, cannot page with `before`, and after a time travel lists newer transactions under lower slots; block times are not unix seconds; a program upgrade keeps old account layouts (fresh fork after a layout change).
- vitest runs e2e files in parallel by default; one shared fork needs sequential, ordered runs (`test:fork` runs the files one by one).
- A `setInterval` tick must guard against overlap or the keeper and quoter race their own transactions.
- Port 8790 was held by another tool locally; test servers bind loopback on a high port and health polls check the `program` field.
- A serialized transaction begins with the signature count; the version prefix is the message's first byte.
- 2026-09-22 Ship run (public site on Railway): a fresh indexer store seeds each market's series from a filtered scan on the public cluster RPC and backfills history a page at a time behind a persisted cursor with backoff (`packages/indexer/src/indexer.ts`, `main.ts seedSeriesIndex`); Ask reads weekday/weekend/date horizons from the sentence itself and picks the expiry on that day (`apps/web/src/lib/intent.ts horizonFromText`); devnet quotes 250 lots per series, reposts an ask once under half its size, keeps the next two Fridays on every grid, and the treasury quotes beside the vault (`QUOTER_BESIDE_VAULT`, devnet default on); Privy is the wallet layer (email + Solana wallets) through a wallet-adapter Adapter (`apps/web/src/lib/privy-adapter.ts`), burner only with `NEXT_PUBLIC_BURNER_WALLET=1`; the app never shows fixtures, an unreachable services process renders empty states with one reconnecting line.

## Lessons (continued)
- Railway: no `VOLUME` in a Dockerfile (attach a volume in the UI); the web image needs `scripts/` because the web tsconfig type-checks the e2e specs; `NEXT_PUBLIC_*` are build args, declare them with `ARG` in `Dockerfile.web`.
- Alchemy's free devnet tier refuses `getProgramAccounts` and throttles hard when two processes share the key; the public devnet RPC serves filtered scans but rate-limits connections. Never run a local services process against the same key as the hosted one.
- Framer `whileInView` never fires for an element that starts almost fully outside a clipped row (a 290px slide in a 330px column); on narrow screens the stylesheet pins the transform (`.slidein`).
- The wallet-adapter modal folds every adapter but the first "Installed" one behind "More options"; the browser journeys expand it before picking the burner.
