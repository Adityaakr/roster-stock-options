# Roster Finance

**Stock leverage without margin liquidation.**

Fully paid contracts on tokenized stocks and pre-IPO tokens, on Solana. Choose an expiry, see the premium and the break-even, and know your maximum loss before you click. No borrowing, no funding payments, no margin calls. Every contract is backed in full from the moment it is sold and settles into your wallet as the token itself.

Program: `FJUdsdmxAp3zAwZBg3ai34xzeCBDobnH1XDarvVa7uFV`

---

## The problem

Tokenized stocks trade 168 hours a week. The shares behind them trade 32.5, about 19% of the week. In the 75 hours between Friday's close and Monday's open the token book is thin, the share has no price, and a leveraged position can be liquidated on a move the market will never confirm. The only ways to lever a stock on Solana today are a perp or a loan loop, and both liquidate.

63% of tokenized-equity spot volume on Solana in 2026 happened outside US exchange hours (Decentralised.co, September 2026). Perpetuals on tokenized equities did $376.3B against $7.5B of spot (CoinGecko, September 2026). The demand is for leverage. The instrument for it is the one that cannot liquidate you.

## What Roster sells

| | Perps | Loops | Listed options | **Roster** |
| --- | --- | --- | --- | --- |
| Max loss | Unbounded, liquidation | Collateral liquidation | Premium | **Premium** |
| Funding or interest | Yes | Yes | No | **No** |
| Open on Saturday | Yes, synthetic mark | Yes | No | **Yes** |
| Settles into your wallet | No | No | No | **Yes, the token itself** |
| Can liquidate you | Yes | Yes | No | **No** |
| Coverage | A few names | A few names | US-listed only | **14 markets, including pre-IPO** |

Underneath, these are fully collateralized, American-exercise, physically settled options. The word appears in the docs and the risk section; the product speaks in outcomes.

- **Gap**: the upside with the loss capped. The right to buy at a strike through an expiry. If it never gets there you lose the premium and nothing else.
- **Floor**: an exit at a known price on a known date. The right to sell at a strike any time through the expiry. The USDC is locked before you buy; no oracle stands between you and the exit.
- **Earn**: get paid to take the other side. Lock USDC to be paid to buy lower, or lock tokens to be paid to sell higher. Paid risk, disclosed as such, never called yield.
- **Vaults**: deposit and let a vault write for you. A Covered Call vault holds the token and sells Gaps above the mark; a Cash-Secured Put vault holds USDC and sells Floors below it. Every epoch's result is published with its sign, losing weeks included.
- **Sell back**: every vault posts a bid on what it has sold, so a winning position can be taken off without paying the strike.
- **Ask**: say what you want in a sentence and get the ticket. The model reads the sentence; the app picks the term and prices it; every number in the wording is checked against the app's own arithmetic.

## Pre-IPO: the PreStocks desk

Eight PreStocks tokens (OpenAI, SpaceX, Anthropic, Anduril, Neuralink, Kalshi, Polymarket, Figure AI) are listed as markets with both sides quoted. Nothing else on Solana gives a pre-IPO token holder a price fixed in advance, upside with the loss capped, or a premium for holding.

- Priced off where the token trades, never the issuer's mark. The spread between the two is shown as a premium or a discount, both of which exist today, never as a one-way "discount".
- Real trade history from each token's most-traded USDC pool: the chart, the day and week changes, liquidity and volume, and the volatility the quoter prices from.
- The mint's transfer fee is the holder's on both sides and is in the price: a Gap delivers the tokens less the fee; a Floor has the holder deliver gross so writers are paid every unit they are owed. Reconciled to the unit in the program's tests and on the real OpenAI mint.
- The issuer's own terms on every ticket: on-chain exit at any time, the post-IPO conversion window, what happens in a deal, and the rights the token does not carry.

## How it works

**The instrument.** Contracts are denominated in raw token units and USDC per unit, so a dividend, split or scaled-UI multiplier change never touches a live contract. Exercise reads no oracle and no price account: a holder burns position tokens, pays or delivers, and receives from the series vault. Nothing can block an exit except the mint itself.

**The book.** One pooled series per strike and expiry with a bounded on-chain ask list (32 asks, an 8-ask walk per fill). Buyers match the cheapest asks first; fills can split across makers. Assignment is pooled: writers are assigned pro rata of what they sold, not by who exercised first, exactly as listed options settle.

**Positions are tokens.** Each series has a Token-2022 position mint with readable metadata. Positions show in any wallet and can be transferred or sold.

**The supply side.** The treasury quotes every term it has capital for, and the vaults quote beside it through the same instruction as any writer. The ask rises with utilisation and stops at the cap. Spreads widen by session: 1.0x regular, 1.4x pre and post, 1.8x overnight, 2.2x closed, 3.0x inside a multiplier activation window; a pre-IPO token, which has no exchange session, takes one constant spread.

**Honesty by construction.** The roster page publishes every quote's collateral by account, every exercise by signature, and every vault epoch with its sign. A venue that publishes whether its promises are funded is a venue that expects to be checked.

## Try it

1. Open the app and connect a wallet, or use the built-in burner if you have no extension.
2. Click your address, then **Get test funds**: 25 of every token, 25,000 USDC and SOL to sign with.
3. **Ask** → type "protect my 20 NVDAx through earnings" → **Review and buy** → sign. That is a fully paid contract in your wallet.
4. **Positions** → **Sell** at the vault's bid, or **Exercise**. Sign.
5. **PreStocks** → OPENAI → buy a Floor. Exercise it and watch the fee delivered on top.
6. **Vaults** → deposit 1 NVDAx. It enters at the next roll, at that roll's published price.

Every step is a real transaction on the Solana cluster the header names, with a signature you can open on Solscan.

## What is live, and how to check it

| Claim | Where | Verify |
| --- | --- | --- |
| The program: pooled series, bounded ask book, pooled assignment, oracle-free exercise, the halt rule, two vaults, `sell_to_vault`, fee-inclusive Floors | `programs/roster_finance` | `cargo test --release -p roster_finance`: 47 tests, including a covered-call vault on a fee mint settling to zero locked and rolling, and a Floor with three prime-sized writers reconciled to the unit |
| Fourteen markets listed and escrow-proven, all eight PreStocks tokens among them | `fixtures/registry/registry.devnet.json` | each entry's `escrowProof` is two signatures: a lot into the series vault and back |
| Six vaults quoting, four of them on PreStocks tokens | `/vaults` in the app, `GET /v1/vaults` | epoch records with P&L per share, signed |
| The whole journey in a browser with no terminal: funds, buy a Gap, buy a Floor, write, exercise, receipt | `apps/web/e2e/devnet.spec.ts` | `pnpm --filter @roster/web exec playwright test --project=devnet` |
| The supply side in a browser: deposit, buy from the vault, sell back to it | `apps/web/e2e/vault.spec.ts` | same command |
| PreStocks in a browser: the desk, OPENAI, buy a Floor, exercise with the fee delivered on top | `apps/web/e2e/prestocks-devnet.spec.ts` | same command |
| Ask: a sentence becomes a ticket, and a question gets an answer from the live figures | `apps/web/e2e/intent-devnet.spec.ts`, `docs/INTENT.md` | same command |
| The same lifecycle on the real NVDAx and OpenAI mints, with expiry, settlement and release by time travel | `tests/e2e/*.test.ts` on a mainnet fork | `pnpm fork` then `pnpm test:fork`: 17 tests |
| Real marks with no Pyth subscription; real trade history for every PreStocks token | `packages/services`, `packages/registry/src/geckoterminal.ts` | every market page names which source priced it and which pool the chart reads |

**Deployment.** The program above is deployed and upgradeable on Solana's public test cluster; the app's header names the cluster on every screen, and each market trades a replica of its mainnet mint with the same Token-2022 extensions, priced from the mainnet token. Mainnet is a documented stop-and-ask step (`docs/DEPLOY.md`, `docs/SEEDING.md`): the code path is identical, the difference is the program rent and the seed capital.

**Not live.** Protected Buy needs a swap route, which a replica does not have; it round-trips on the fork and is marked as such in the app. Auto-exercise needs a verifiable on-chain price and no free Pyth read exists; contracts are American, so holders exercise themselves and the app says so.

## Run it

```
cp .env.example .env                       # docs/OPERATOR.md names every variable
pnpm install
pnpm anchor:build && pnpm anchor:deploy     # the program
pnpm devnet:mints && pnpm devnet:registry  # replica mints and the registry (once)
pnpm list-markets --devnet && pnpm devnet:seed && pnpm devnet:vaults --roll-now --align
pnpm services                              # quoter, keeper, indexer, REST on :8787
pnpm dev                                   # the app on http://localhost:3000
```

For the mainnet fork: `pnpm fork`, `pnpm anchor:deploy`, `pnpm registry && pnpm list-markets && pnpm seed`, then the same two.

## Layout

```
programs/roster_finance   Anchor program: series, book, exercise, settlement, vaults
packages/core             units, multiplier, session clock, bounded fan-out
packages/sdk              TypeScript client for every instruction and account
packages/oracle           marks, realised volatility, the xStocks multiplier watcher
packages/indexer          store fed by program events
packages/quoter           the pricing model (docs/PRICING.md), the treasury's leg and the vault's leg
packages/keeper           grid roll, halt observation, settle, close, the vault's cranks
packages/registry         xStocks, Ondo, PreStocks, Tokens API, GeckoTerminal; mint inspection and verdicts
packages/services         one process: the loops and the REST the app reads
apps/web                  the app: ask, markets, terms, positions, earn, vaults, roster, prestocks
docs/                     architecture, decisions, pricing, intent, deploy, operator, feeds, mints
```

## Prior art, and what this design still carries

PsyOptions built a fully collateralized, physically settled options book on Solana and shut down: not enough on-chain demand. Opyn abandoned its order-book v1. Zeta pivoted to perps. The book was never the failure; the empty book was. The vault model (Ribbon, Friktion, Katana) reliably attracted capital, and Hegic showed a pool that always quotes guarantees a counterparty on day one, at the cost of selling cheap into every volatility spike.

Roster keeps the book and adds vaults that quote into it, with a utilisation skew so the vault stops selling as it fills. What it still carries: the vaults are short volatility with no hedge, because there is no single-name stock perp on Solana to hedge on. They will have losing epochs, and every one is published.

## Risk

Fully collateralized, American exercise, physical settlement. A contract does not protect against chain halts, token freezes, pauses or transfer restrictions on the underlying mint. Dividend reinvestment during a Gap accrues to the escrowed tokens and is captured by the buyer at exercise. xStocks are tracker certificates with no voting rights. PreStocks tokens confer no ownership, voting, dividend or information rights, and after an IPO must be converted within the issuer's window or expire worthless. Non-US wrappers; counsel before expanding.

Contracts can expire worthless. Maximum loss on a purchase is the premium plus fees. Writing is paid risk. Nothing here is an offer of any security. The program is unaudited.
