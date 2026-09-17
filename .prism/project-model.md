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

## Lessons
- `@anchor-lang/core` ESM references `exports`: `serverExternalPackages` in Next; `EventParser` returns camelCase names, `BN.toJSON` is hex.
- surfpool: `getSignaturesForAddress` rejects `until`, cannot page with `before`, and after a time travel lists newer transactions under lower slots; block times are not unix seconds; a program upgrade keeps old account layouts (fresh fork after a layout change).
- vitest runs e2e files in parallel by default; one shared fork needs sequential, ordered runs (`test:fork` runs the files one by one).
- A `setInterval` tick must guard against overlap or the keeper and quoter race their own transactions.
- Port 8790 was held by another tool locally; test servers bind loopback on a high port and health polls check the `program` field.
- A serialized transaction begins with the signature count; the version prefix is the message's first byte.
