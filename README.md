# Roster Finance

Stock leverage without margin liquidation. Fully collateralized, American-exercise, physically settled contracts on tokenized stocks, on Solana: a **Gap** is the right to buy at a strike through an expiry, a **Floor** the right to sell. Choose an expiry, see the premium and break-even, know the maximum loss before you buy. No borrowing, no funding payments, no margin calls. Every contract is backed by the full collateral in a program-owned vault from the moment it is sold.

The standing brief is `CLAUDE.md` (Part 1, Part 2 and the addendum). The design authority is `docs/DESIGN.md`. Every milestone is logged with what was built, what was verified and what was cut in `docs/BUILD_LOG.md`.

## What is live, and how to check it

Everything below runs on a surfpool **mainnet fork** (real NVDAx, USDC, Pyth and Jupiter accounts) with the program deployed at `FJUdsdmxAp3zAwZBg3ai34xzeCBDobnH1XDarvVa7uFV`. Mainnet deployment is a separate, announced step (`docs/02-roadmap.md` M6) and has not happened.

| Claim | Where | How a judge verifies it |
| --- | --- | --- |
| Pooled-series options program: 18 instructions, zero-copy series with a bounded on-chain ask list, stability-pool assignment, halt rule, auto-exercise with a Pyth receiver check | `programs/roster_finance` | `cargo test --release -p roster_finance` (27 tests: unit, core lifecycle, fees and authorities, random invariant walk, sizes, compute) |
| The lifecycle on the real NVDAx mint: list, series, quote, buy, exercise, settle, close | `tests/e2e/p1-fork-lifecycle.test.ts` | `pnpm fork`, `pnpm anchor:build && pnpm anchor:deploy`, `pnpm test:fork` |
| Services: Pyth Hermes and Benchmarks oracle, indexer, quoter, keeper, REST | `packages/{oracle,indexer,quoter,keeper,services}` | `pnpm test:fork` (P2: 12 grid series quoted, a time-travelled weekend, settle and close at expiry from indexed events) |
| Registry and eligibility: 15 mints read from chain, feeds from Hermes, escrow proven per mint | `packages/registry`, `docs/ELIGIBILITY.md`, `fixtures/registry/registry.json` | `pnpm registry && pnpm list-markets`; every row's proof is a signature on the fork |
| The app on live data: market list by executable depth, Act with the exact on-chain cost, Manage with receipts, Commit, Roster, geo gate | `apps/web` | `pnpm services` then `pnpm dev`; `pnpm shots` captures every screen at 1280 and 390 with no console errors |
| A person buys a Gap, buys a Floor, writes a Floor, exercises and sees the release, in a browser | `apps/web/e2e/flow.spec.ts` | `pnpm test:flow` (burner wallet on the fork, no extension) |
| Protected Buy: a Jupiter swap and a Floor in one transaction | `apps/web/e2e/protected-buy.spec.ts` | `pnpm test:flow` |
| First Print: tKalshi Gap with the 20 bps fee reconciled to the unit on both legs | `tests/e2e/p4-first-print.test.ts` | `pnpm test:fork` |

Not live: mainnet (M6, needs the deployer key, multisig and treasury), fee-inclusive Floors on fee mints, Tier 3 quoting (listed, no treasury capital), watchlists, statements, Blinks, the widget. The Pyth Core key is the one input that blocks real prices; without it the quoter prices off the issuer's quote on the fork only and the app says so under every instrument (`docs/OPERATOR.md`).

## Run

```
cp .env.example .env         # empty values are "not set"; see docs/OPERATOR.md
pnpm install
pnpm fork                    # surfpool mainnet fork on 127.0.0.1:8899 (own terminal)
pnpm anchor:build && pnpm anchor:deploy
pnpm registry && pnpm list-markets && pnpm seed
pnpm services                # oracle, indexer, quoter, keeper, REST on :8787 (own terminal)
pnpm dev                     # apps/web on http://localhost:3000
pnpm verify                  # typecheck, lint, unit, Rust, fork e2e
```

## Layout

```
programs/roster_finance   Anchor 1.2 program (zero-copy Series, 18 instructions)
packages/core             units, multiplier, session clock
packages/sdk              TypeScript client: PDAs, every instruction, prepare/send
packages/oracle           Pyth Hermes, Benchmarks vol, xStocks multiplier watcher
packages/indexer          node:sqlite store of markets, series, events, prices, basis
packages/quoter           Black-Scholes quoter with session and activation spreads, tier rules
packages/keeper           grid roll, halt observation, settle, close, auto-exercise candidates
packages/registry         xStocks, Tessera and PreStocks assets, mint inspection, verdicts
packages/services         one process: the loops and the REST the app reads
apps/web                  Next 16 app: landing, /trade, /positions, /underwrite, /roster, /buy, /pre-ipo, /risk, /fees
scripts/                  fork, deploy, seed, registry, list-markets, probes
tests/e2e                 fork end-to-end (vitest); apps/web/e2e is the browser (Playwright)
docs/                     architecture, roadmap, decisions, build log, feeds, mints, eligibility, operator
```

## Bounties

- **Pyth.** Load-bearing in the quoter (realised vol from Benchmarks, marks from Hermes), the basis display, session-aware terms and the auto-exercise crank (`PriceUpdateV2` through `pyth-solana-receiver-sdk`); deliberately absent from the exercise path so an exit can never be blocked by a feed. `docs/FEEDS.md` records every feed id and where it came from.
- **Tessera.** A known price on a known date for tOpenAI and tKalshi holders, against a redemption with four preconditions and no deadline; transfer-fee aware to the unit (`tests/e2e/p4-first-print.test.ts`).
- **PreStocks.** The same on OPENAI and SPACEX, with the mark-versus-token discount shown as the price of no exit and the ScaledUiAmount multiplier honoured in the strike grid.

Contracts can expire worthless. Nothing here is an offer of any security. The program is unaudited.
