# PLAN

The document Part 1's kickoff asks for, written after P0 ran (2026-09-17). Every fact cites a read or a test; design decisions cite `docs/01-architecture.md` and `docs/DECISIONS.md`.

## Repo layout

```
Anchor.toml · Cargo.toml · rust-toolchain.toml     Anchor 1.2.0 workspace, sbpf v0, overflow-checks on
programs/roster_finance/                             the program (src/{lib,state,error,events,math,instructions/*}.rs), litesvm tests in tests/
packages/core                                        units (lots, strike per lot), multiplier rule, session clock, payoff math; zod schemas
packages/sdk                                         @anchor-lang/core client, PDAs, transaction builders (unsigned, for signTransaction-only wallets), synced IDL
packages/oracle                                      Hermes (Bearer key, TTL cache), Benchmarks realised vol, session state, multiplier watcher
packages/quoter · packages/keeper · packages/indexer  the fleet as libraries; indexer on node:sqlite behind a Store interface
packages/services                                    one process on the fork: oracle + quoter + keeper + indexer + REST :8787
apps/web                                             Next 16 app (landing + product screens) reading the services REST
scripts/                                             fork.sh, anchor-test.sh, idl-sync.sh, anchor-deploy.sh, seed-fork.ts, fork-lib.ts, probe-mints.cjs, eligibility.ts
tests/e2e/                                           vitest against the fork: p0-foundation, p1-fork-lifecycle, p2-services
fixtures/probes/                                     raw API and on-chain captures from P0 (mints, feeds, issuer APIs)
docs/                                                DESIGN, BUILD_LOG, RECONCILIATION, OPERATOR, 01-architecture, 02-roadmap, DECISIONS, FEEDS, MINT, PLAN, RENT, COMPUTE, QUOTER, ELIGIBILITY, SEEDING
```

## The NVDAx mint, read from chain (`docs/MINT.md`)

`Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh`, Token-2022, 8 decimals, resolved from `api.xstocks.fi/api/v2/public/assets/NVDAx` and read at slot 447797526. Extensions and what each means for escrow:

| Extension | Present | Escrow consequence |
| --- | --- | --- |
| TransferHook | slot present, `program_id` None, authority `5aMNNLQJ…` | plain `transfer_checked` works; no extra accounts; registry fails closed if a program is ever installed |
| PermanentDelegate | `5aMNNLQJ…` | issuer can move or burn escrowed tokens; contract limitation, disclosed |
| Freeze authority + PausableConfig | `JDq14BWv…`, `paused = false` | vault ATA can be frozen, transfers paused; soft failure with a message; the series halt rule keeps exercise open through `unhalt + 24 h` |
| ScaledUiAmountConfig | multiplier 1.001701196801074 effective since 2026-09-10 00:30 UTC | raw balances never change; the program stores strikes per lot and never reads this field except in `auto_exercise` |
| DefaultAccountState | Initialized | vaults are usable at creation |
| MetadataPointer + TokenMetadata | name `NVIDIA xStock` | display only |
| ConfidentialTransferMint | dormant | none |
| TransferFeeConfig | absent | no fee math on xStocks; Tessera 20 bps and PreStocks 50 bps are handled by `has_transfer_fee` |

Proven on the fork (`tests/e2e/p0-foundation.test.ts`): a `transfer_checked` of 5 NVDAx between two seeded wallets succeeds.

## Pyth feed ids (`docs/FEEDS.md`)

NVDAx token `4244d078…503b7f` (24/7), NVDA equity `b1073854…60a593` (09:30–16:00 NY, NYSE holidays); TSLA and SPY pairs likewise. Source: Hermes `v2/price_feeds`, keyless. Price reads need `PYTH_CORE_API_KEY` (401 without it, tested). Session feeds moved to Pyth Pro on 2026-06-15; session state derives from the published schedule until a Pro key exists. Receiver for the crank: `rec2HHDDnjLfj4kE7VyEtFA1HPGQLK33259532cRyHp` with `pyth-solana-receiver-sdk` 2.0.0 `pro-compatible`.

## Surfpool cheatcodes, confirmed on surfpool 1.0.0

- `surfnet_timeTravel [{absoluteTimestamp: ms}]` advances the Clock sysvar (P0 test: travelled to a Saturday, `unix_timestamp` moved, session reads `closed`); forward only; do not use in `--offline` mode.
- `fundToken` in the brief is an SDK helper over `surfnet_setTokenAccount [owner, mint, {amount}, tokenProgram]`. It works with the Token-2022 program id but rewrites the account as a 165-byte base account, dropping ImmutableOwner, PausableAccount and TransferHookAccount. The build therefore creates the ATA by instruction and patches the amount into the real 179-byte account with `surfnet_setAccount` (`scripts/fork-lib.ts` `fundToken`), and asserts the size is unchanged.
- `surfnet_setAccount`, `surfnet_resetAccount`, `surfnet_streamAccount`, `surfnet_pauseClock` verified.

## Anchor account layout (PDA seeds, sizes)

Sizes are `8 + InitSpace`, confirmed by `anchor build` in P1 and recorded in `docs/RENT.md`; the figures here are the design targets.

| Account | Seeds | Approx. size | Holds |
| --- | --- | --- | --- |
| `Protocol` | `[b"protocol"]` | 8 + 180 | authority, pause_authority, treasury, quote_mint, fee_bps, integrator_share_bps, keeper_fee_usdc, grace_secs, paused_all, reserved 64 |
| `MarketConfig` | `[b"market", mint]` | 8 + ~330 | mint, token_program, decimals, extension flags, feed ids, allowed_expiries[4], strike_step, min/max strike, max_live_series, live_series, caps, tier, listed, paused, issuer_paused_at, reserved 64 |
| `Series` | `[b"series", market, side, strike_usdc_per_lot, expiry_ts]` | 8 + ~6,000 | vaults, position_mint, strike_usdc_per_lot, totals, `P`/scale/epoch, unassigned, dust, state, halted_at, rent_payer, seq, `asks[32]`, `writers[32]`, reserved 64 |
| vaults | `[b"cvault"|b"svault"|b"qvault", series]` | Token-2022 or Token account with required extensions | collateral (underlying for calls, USDC for puts), settlement (the other leg), premiums |
| `position_mint` | `[b"pmint", series]` | Token-2022 mint + MetadataPointer + TokenMetadata + MintCloseAuthority | 6 dp, supply = open lots |
| `AutoExercise` | `[b"autoex", holder]` | 8 + 24 | enabled, min_itm_bps |
| `FeeVault` | ATA of `Protocol` for the quote mint | | taker fees, dust, keeper fees paid from here |

**How `buy` splits across writers.** The Series holds a sorted `asks[32]` (writer slot index, remaining lots, ask per lot, seq). `buy(lots6, max_premium_per_lot, referrer)` walks from the best ask up to 8 entries while `ask ≤ max`; each fill decrements the ask, folds the writer slot's assignment state to the present, adds the filled lots to its `open`, credits `premium_claimable`, and transfers premium net of the taker fee into the quote vault (fee to the FeeVault). Position tokens are minted to the buyer once for the total. A partial fill returns the filled amount; zero fill fails `QuoteMoved`. The account set is fixed regardless of which writers fill (`docs/01-architecture.md` §4, skeptic C3).

**How `exercise` routes to the right escrow.** It does not route to a writer. A call exercise burns position tokens, pulls `ceil(lots6 × strike / 1e6)` USDC from the holder into the settlement vault and sends `lots6 × 10^(decimals−6)` raw from the collateral vault to the holder. A put is the mirror (holder delivers raw, receives floor USDC from the collateral vault, raw lands in the settlement vault). The assignment product `P` is updated so every writer's open share shrinks pro rata at that moment; writers collect at `settle_writer`.

## The exercise path with no oracle

`exercise` reads the Clock and the series only: `now < expiry_ts`, state not Expired, holder balance ≥ lots6. No price account is in its account list, so it cannot be blocked by a stale, missing or wrong feed. `settle_writer` and `close_series` likewise. Pyth appears in exactly one instruction, `auto_exercise`, as a convenience for absent holders, with its own staleness and confidence checks.

## Multiplier invariance, in one paragraph

A contract is `lots6` position tokens against `strike_usdc_per_lot` micro-USDC, and a lot is `10^decimals` raw units. Raw balances never change through a dividend or a split; only the mint's multiplier changes, and the program never reads it at creation, exercise or settlement. So the escrowed raw amount, the USDC exchanged and every writer's share are identical before and after any activation. What changes is the display: strike per share-equivalent is `strike_usdc_per_lot / (1e6 × live multiplier)`, recomputed by the app and the quoter. A reinvested dividend during a call's life therefore raises the share-equivalents behind each lot and the buyer captures it at exercise, because the writer sold total-return exposure (Part 1 §4.1); the P1 test flips the replica mint's multiplier mid-life and asserts the contract's integers and vault balances are untouched while the display recomputes.

## The quoter's volatility model and closed-market behaviour (`docs/QUOTER.md` in P2)

Realised volatility from Benchmarks over 7, 30 and 90 day windows on the token feed (equity feed where no token feed exists), blended 0.5/0.3/0.2 with a floor; the NVDA equity feed as a sanity reference while open; a session multiplier on the spread of 1.0 regular, 1.4 pre and post, 1.8 overnight, 2.2 closed; 3.0 or pause inside the 15 minute multiplier activation window; forward = token price × (new_multiplier / multiplier) only when the xStocks API says the pending activation is a dividend and it precedes expiry; dividend yield zero. Circuit breakers: basis above threshold, Hermes stale, mint paused. Every quote decision logged with its inputs. The weekend test time-travels through Saturday and Sunday in 6 h steps and asserts the quoter is alive with the closed-session multiplier.

## How the Tessera transfer fee changes both legs

The mints carry `TransferFeeConfig` at 20 bps, uncapped. A writer depositing `n` lots delivers `n × (1 − 0.002)` to the vault; the program credits the measured vault delta (`vault.reload()` after the CPI), so the writer's contract count is the net. A holder exercising a put delivers tokens net of fee, and the vault pays USDC for the net. A call exercise sends tokens out of the vault and the holder receives net of a second fee; the ticket shows it. Settlement pays out net of the fee again. Amounts are quoted fee-inclusive on both legs, the fee config is re-read at open and at settle because the authority can change it with a two-epoch delay, and `transfer_checked_with_fee` is used so an unexpected fee change fails loudly.

## The five risks most likely to sink the build, with mitigations

1. **Pooled assignment accounting is wrong in a way the tests do not catch.** Three skeptics broke the first formulation; the replacement is the Liquity pattern with independent floors. Mitigation: every counterexample is a named test; a random-sequence property test checks the four invariants after every instruction; settlement pays from counters, never balances.
2. **`PYTH_CORE_API_KEY` never arrives.** Feed ids are resolved; prices are not. Mitigation: the quoter and keeper read through one oracle package; without the key P2 stops at pricing and the stop message names the key; everything else proceeds.
3. **The Token-2022 position mint with metadata fails to initialise in one instruction under `--arch v0`.** Mitigation: it is the first P1 test; the fallback is a two-instruction `create_series`.
4. **The mainnet timeline.** A Friday expiry cannot settle before Sep 23. Mitigation: deploy Sep 21 evening with a Sep 22 16:00 NY expiry on the grid; cut order in `docs/02-roadmap.md`; P6 is never cut.
5. **The issuer freezes or pauses NVDAx across an expiry, or installs a transfer hook.** Mitigation: the halt rule keeps exercise open through `unhalt + 24 h`; the registry re-reads the hook slot and fails closed; both are disclosed in `/risk`.
