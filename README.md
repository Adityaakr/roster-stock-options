# Roster Finance

**Stock leverage without margin liquidation.** Fully paid contracts on tokenized stocks, on Solana. Choose an expiry, see the premium and the break-even, know your maximum loss before you click. No borrowing, no funding payments, no margin calls. It settles into your wallet as the token itself.

Underneath, these are fully collateralized, American-exercise, physically settled options: a **Gap** is the right to buy at a strike through an expiry, a **Floor** the right to sell. Every contract is backed by the full collateral in a program-owned vault from the moment it is sold, and the book that sells it is fed by **vaults** that quote both sides, so a buyer has a counterparty on day one and a way out before expiry.

Program on devnet: `FJUdsdmxAp3zAwZBg3ai34xzeCBDobnH1XDarvVa7uFV`. The whole journey runs in a browser against it with no terminal (below).

## The problem

Tokenized stocks trade 168 hours a week. The shares behind them trade 32.5, about 19% of the week. In the 75 hours between Friday's close and Monday's open the token book is thin, the share has no price, and a leveraged position can be liquidated on a move the market will never confirm. Today on Solana the only ways to lever a stock are a perp or a loan loop, and both liquidate. 63% of tokenized-equity spot volume on Solana in 2026 happened outside US exchange hours (Decentralised.co, September 2026); perpetuals on tokenized equities did $376.3B against $7.5B of spot (CoinGecko, September 2026). The demand is for leverage. The instrument for it is the one that cannot liquidate you.

## What this does about it

| | Perps | Loops | Listed options | Roster |
| --- | --- | --- | --- | --- |
| Max loss | Unbounded, liquidation | Collateral liquidation | Premium | **Premium** |
| Funding or interest | Yes | Yes | No | **No** |
| Open on Saturday | Yes, synthetic mark | Yes | No | **Yes** |
| Settles into your wallet | No | No | No | **Yes, the token itself** |
| Can liquidate you | Yes | Yes | No | **No** |

**Discover.** Every listed market by executable depth, then every live term on the one you pick: expiry, premium, break-even, the max loss at your size, the move you need.

**Act.** An executable quote at your size, the escrow accounts that back it, one transaction. The full cost and the maximum loss are on screen before you sign.

**Manage.** What you own, what it is worth now, what exercising requires in plain words ("pay $222 USDC, receive 1 NVDAx"), and a **Sell** button at the vault's live bid: a way to take a winning position off without paying the strike.

**Commit.** Write directly into the book, or deposit into a vault and let it write for you.

**Roster.** Every quote's collateral by account address, every exercise by signature. A venue that publishes whether its promises are funded is a venue that expects to be checked.

## The part nobody else solved: who posts the other side

PsyOptions built a fully collateralized, physically settled options book on Solana, won the first Solana x Serum hackathon, raised $3.5M, and shut down: not enough demand, not enough volume. Opyn abandoned its order-book v1. Zeta launched options and pivoted to perps. **The book was never the failure. The empty book was.** The model that reliably attracted capital was the vault: Ribbon, Friktion, Katana, Thetanuts. "I hold NVDAx, pay me for it" is a proposition depositors accept; "post an ask at the $190 strike for Friday" is not. Hegic proved the other half: a pool that always quotes guarantees a counterparty on day one, but its fixed implied volatility sold options cheap into every spike and hurt its depositors.

So Roster keeps the book and adds a vault that quotes into it:

- **Covered Call vault**: deposit NVDAx, the vault sells calls above the mark, you keep the premium or sell at the strike.
- **Cash-Secured Put vault**: deposit USDC, the vault sells puts below the mark, you keep the premium or buy at the strike.
- **Two-sided**: the vault posts a bid on every series it is short, so a holder can sell back instead of exercising.
- **Utilisation skew**: the more of a series the vault has sold, the higher its ask (`1 + 3u²`), and at the cap it stops. That is the fix for what hurt Hegic.
- **Session pricing**: the underlying is closed 81% of the week and the price says so: spreads widen 1.4× pre and post, 1.8× overnight, 2.2× closed.
- **Weekly epochs** (daily on devnet): deposits enter and withdrawals leave only at a roll, so nobody dilutes a week of carried risk or runs on collateral behind live contracts.
- **Nothing special-cased**: the vault posts through the same instruction as any writer, is evicted by the same rule, settles through the same settlement. If external makers undercut it, the book has price discovery a pool alone never gets.

**What these vaults still carry from their predecessors.** They are short volatility with no hedge available, because there is no single-name stock perp on Solana to hedge on. They will have losing epochs. Every epoch's P&L is published on the vault page and in the API from the first one, losing weeks included; the deposit screen shows three adverse scenarios in real numbers; and nothing here is called yield.

## Try it in two minutes, on devnet

1. Open the app. Header says **Devnet**.
2. **Connect wallet**: any Solana wallet on devnet, or the built-in burner if you have no extension.
3. Click your address → **Get devnet test funds**: 25 of every token, 25,000 USDC, and SOL to sign with.
4. **Markets → NVDAx → Buy a Gap → Buy.** Sign. That is a fully paid contract in your wallet.
5. **Positions → Sell at the vault's bid**, or **Exercise now**. Sign.
6. **Vaults → deposit 1 NVDAx.** It queues for the next roll (the time is on screen), enters at that roll's published price.

Devnet has no xStocks, Tessera or PreStocks tokens, so every market there trades a **replica mint** with the same Token-2022 extensions as the real one (scaled UI amount at the issuer's live multiplier, pausable, permanent delegate, the transfer-fee mint at 20 bps) and takes its price from the mainnet mint it stands in for. Every market page says so and links the real mint. `docs/DEVNET.md` has the whole honesty list.

## What is live, and how to check it

| Claim | Where | How to verify |
| --- | --- | --- |
| The program: pooled series, a bounded on-chain ask book, stability-pool assignment, exercise with no oracle, the halt rule, the two vaults, `sell_to_vault` | `programs/roster_finance` | `cargo test --release -p roster_finance`: 45 tests, including the vault evicted by 32 cheaper asks, a buyback capped at the vault's short then an exercise settled to the unit, a losing epoch published negative |
| Seven markets listed and escrow-proven on devnet | [NVDAx](https://solscan.io/token/BCCWyBT1LosEwSTyA2A2Y45hQjKpUfZ9KweQc7zchYTJ?cluster=devnet), [tKalshi](https://solscan.io/token/78efLmN1D6jbvhzTKZCdT2oPXuRJHCpiqvKwsUv3SRWa?cluster=devnet), and five more in `fixtures/registry/registry.devnet.json` | each entry's `escrowProof` is two signatures on devnet: a lot into the series vault and back |
| Three vaults quoting on devnet | [NVDAx covered call](https://solscan.io/account/D96q3snoZteqZom6SzRTR7eicUPPD3Q5KfPgBjF9WLNx?cluster=devnet), [NVDAx cash-secured put](https://solscan.io/account/6RkabnAiLXHcy1JAD2pCi2cABdrai3U2Xt324g89A72c?cluster=devnet), [tKalshi covered call](https://solscan.io/account/FtKQeVXUz5db66gdTy4jYjCrW72ymh5WcavbyetgEWjQ?cluster=devnet) | `/vaults` in the app, `GET /v1/vaults` on the services: epoch records with P&L per share |
| The journey in a browser with no terminal: faucet, buy a Gap, buy a Floor, write a Floor, exercise, receipt | `apps/web/e2e/devnet.spec.ts` | `pnpm --filter @roster/web exec playwright test --project=devnet` |
| The supply side in a browser: deposit into the vault, buy from it, sell back to it | `apps/web/e2e/vault.spec.ts` | same command |
| The same lifecycle on the real NVDAx mint, with expiry, settlement and release by time travel | `tests/e2e/*.test.ts` on a surfpool mainnet fork | `pnpm fork` then `pnpm test:fork`: 17 tests including the transfer-fee round trip reconciled to the unit |
| Real marks with no Pyth subscription | `packages/services` | every market shows which source priced it: Tokens API, Jupiter, the issuer |

**Not live, and why.** Mainnet: a stop-and-ask step that needs the deployer key, a Squads multisig as upgrade authority and your written seed sizes (`docs/SEEDING.md`); the code is the same. Protected Buy on devnet: a replica has no swap route; it round-trips on the fork. Auto-exercise: needs a verifiable on-chain price and no free Pyth read exists; contracts are American, so holders exercise themselves and the app says so. External resting bids, notifications, statements, the widget and SDK: roadmap.

## Run it yourself

```
cp .env.example .env                       # docs/OPERATOR.md and docs/DEPLOY.md name every variable
pnpm install
pnpm anchor:build                          # the program; scripts/anchor-deploy.sh deploys it
pnpm devnet:mints && pnpm devnet:registry  # replicas and the devnet registry (once)
pnpm list-markets --devnet && pnpm devnet:seed && pnpm devnet:vaults --roll-now --align
pnpm services                              # quoter, keeper, indexer, REST on :8787
pnpm dev                                   # the app on http://localhost:3000
```

For the mainnet fork instead: `pnpm fork`, `pnpm anchor:deploy`, `pnpm registry && pnpm list-markets && pnpm seed`, then the same two.

## Layout

```
programs/roster_finance   Anchor program: series, book, exercise, settlement, vaults
packages/core             units, multiplier, session clock, bounded fan-out, keys
packages/sdk              TypeScript client for every instruction and account
packages/oracle           marks, realised volatility, the xStocks multiplier watcher
packages/indexer          node:sqlite store fed by program events; series learned from SeriesCreated
packages/quoter           the model (docs/PRICING.md), the treasury's leg and the vault's leg
packages/keeper           grid roll, halt observation, settle, close, the vault's cranks
packages/registry         xStocks, Ondo, Tessera, PreStocks, Tokens API; mint inspection and verdicts
packages/services         one process: the loops and the REST the app reads
apps/web                  Next 16: landing, markets, trade, positions, underwrite, vaults, roster, buy, pre-ipo
docs/                     architecture, decisions, build log, pricing, devnet, deploy, operator, feeds, mints
```

## Bounties

- **Pyth.** Feed ids resolved and recorded (`docs/FEEDS.md`); Hermes and Benchmarks wired with per-feed entitlement handling; the auto-exercise crank checks a posted `PriceUpdateV2`; the exercise path is deliberately oracle-free so an exit can never be blocked by a feed. Absent at runtime only because the plan on hand excludes these feeds, and the app says so.
- **Tessera.** A known price on a known date for tOpenAI and tKalshi holders, against a redemption with four preconditions and no deadline; transfer-fee aware to the unit on both legs, including the withheld-fee harvest a fee mint needs before its series can close.
- **PreStocks.** The same on OPENAI and SPACEX, with the mark-versus-token discount shown as the price of no exit.

Contracts can expire worthless. Maximum loss is the premium plus fees. Nothing here is an offer of any security. The program is unaudited.
