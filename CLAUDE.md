# Roster Finance: autonomous build brief

Save as `CLAUDE.md` in the repo root. Start Claude Code with the kickoff message at the bottom. This is the complete standing context: product, engineering, UX flow, landing content, integrations and the rules for operating without supervision. It supersedes every earlier brief.

---

## 0. How to operate

You are building this end to end with minimal check-ins. The contract:

**Proceed without asking when:** a phase's tests pass; a documented API behaves as documented; a decision is already made in this file; a library choice is between equivalents; a bug has an obvious fix.

**Stop and ask only when:** an action moves real funds on mainnet (P5 and later); a blocker survives two genuine attempts at a fix; a fact in this file turns out to be wrong in a way that changes scope; a third-party API is down for more than an hour; or you are about to delete work.

**Every phase ends with** a `docs/BUILD_LOG.md` entry (what was built, what was verified against which source, what was cut, open risks), the test suite green, and a screenshot at `1280px` and `390px` if the phase touched the UI. Then start the next phase. Do not wait for approval between phases unless a stop condition fires.

**Verification discipline.** Before using any SDK function, open its type definition in `node_modules` or the linked doc. Never invent a feed id, program id, mint address, API field or cheatcode name; every one in this file was verified on the date noted, and you re-verify anything you touch. Real data only outside test fixtures.

**Design system.** The UI is already designed. `docs/DESIGN.md` and `tokens.css` are the visual authority; this brief covers flow, state and content, not appearance. If a screen this brief specifies has no design, build it from the existing components and log it.

---

## 1. What we are building

**Roster Finance: stock leverage without margin liquidation.**

Trade Nvidia's upside on Solana with a fully paid contract. Choose your expiry, see your premium and break-even, and know your maximum loss before you buy. No borrowing, no funding payments, no margin calls.

Underneath, the contracts are fully collateralized American-style options on NVDAx, physically settled in the token. The word "option" belongs in the docs and the risk section, not on a button.

**The first customer:** an existing Solana trader with USDC who wants to express a bullish view on Nvidia with a fixed upfront risk budget, and who has been liquidated on a weekend wick at least once.

**The second customer:** an NVDAx holder who wants a floor under a position through an earnings print or a weekend.

**The supply side:** anyone with USDC or NVDAx who wants to be paid to take the other side, seeded on day one by Roster's own treasury and a maker bot so every buyer has a counterparty.

**The name.** A roster is the standing list of who is committed. Here it is the list of underwriters with capital locked and quotes live. The roster is the capital standing behind every contract.

**Focus discipline, non-negotiable.** One underlying (NVDAx), two expiries, at most three strikes per side per expiry. Calls ship first because leverage is the demand; puts second. Protected Buy after both work. The pre-IPO desk after that. Nothing else during the hackathon.

---

## 2. Verified facts (September 17, 2026)

Everything here was checked against a primary source on the date above. Re-verify anything you touch; log the result.

### 2.1 xStocks on Solana

- Token-2022 mints with the **scaled UI amount** extension. Raw on-chain balance never changes; a multiplier stored in the mint's extension converts raw to displayed share-equivalents. Source: `https://docs.xstocks.fi/developers/multipliers`.
- Dividends are reinvested (multiplier rises), splits raise the multiplier, reverse splits lower it. Holders never act.
- Multiplier activations happen at `00:30` UTC the day after ex-date. xStocks recommends venues pause interactions for about `15` minutes either side of activation.
- Current and pending multiplier with activation timestamp: `https://api.xstocks.fi/api/v2/public/assets/{SYMBOL}/multiplier?network=Solana`. History: `.../multiplier/history?page=0&pageSize=10&network=Solana`.
- SPYx mint (from their own docs): `XsEH7wWfJJu2ZT3UCFeVfALnVA6CP5ur7Ee11KmzVpL`. Resolve NVDAx and every other mint from the xStocks Assets API (`https://docs.xstocks.fi/apis/openapi/assets`) or the Tokens API, never from memory.
- **Open question you must resolve in P0:** the exact extension set on the NVDAx mint. Read the mint account and list every extension. If a transfer hook is present, every escrow transfer must include the hook's extra accounts (resolve them from the `ExtraAccountMetaList` PDA) or it will fail on-chain, not silently. If a permanent delegate or freeze authority is present, document it as a contract limitation. If a pausable config is present, handle the paused state as a soft failure with a clear message.
- Wrapped xStocks (ERC-4626) are an EVM construct; on Solana you escrow the raw amount directly.

### 2.2 Pyth

- **Pyth Core required an API key from August 18, 2026.** New integrations use the upgraded contract addresses. Hermes is served at `https://pyth.dourolabs.app/hermes/` with a Bearer token. Source: `https://docs.pyth.network/price-feeds/core/how-pyth-works/hermes`. Obtain a key before P0.
- Resolve feed ids with the Pyth MCP server (`https://mcp.pyth.network/mcp`, tool `get_price_feeds`) or the published list at `https://pyth.network/price-feeds`. Record the hex id and source for: the NVDAx token feed (crypto class, `24/7`), the NVDA equity feed (regular session, closed weekends and NYSE holidays), and any session feeds you use.
- Regular US equity feeds follow exchange hours. `.PRE`, `.POST` and `.ON` session feeds moved to Pyth Pro in June 2026; the overnight session runs Sunday to Thursday only. Source: `https://docs.pyth.network/price-feeds/market-hours`. Read Core by default; enable Pro feeds when `PYTH_PRO_API_KEY` is set.
- Historical prices at a timestamp: Benchmarks, `https://benchmarks.pyth.network`. Used for realised-volatility windows in the quoter.
- Public Hermes rate limit is around `30` requests per `10` seconds per IP; cache.

### 2.3 Surfpool (mainnet fork for development and tests)

- Docs: `https://docs.surfpool.run`. SDK for Rust (`surfpool_sdk`) and JS. Cheatcodes run instantly, no fees.
- `fundSol`, `fundToken` (creates the ATA and sets a balance; takes a token program parameter, so confirm it works for Token-2022 mints on the NVDAx mint in P0), `setAccount` (raw bytes), `setTokenAccount` (delegate, state, close authority), `resetAccount` (revert to upstream), `streamAccount` (mirror a live mainnet account continuously; use it for the Pyth price accounts you read), and **`surfnet_timeTravel`**, which is how you test expiries and weekends without waiting.
- Start with a mainnet remote RPC so real NVDAx, USDC and Pyth accounts are available.

### 2.4 Tessera (pre-IPO desk)

- API: `https://rest-api.tessera.pe/v1/public/token-details`. Live on the date above:
  - tOpenAI, mint `oPAiAikWTaFj9RYoRFD35ccfwhnMcB3ThgBZRHSkjTZ`, mark `$812.79`, `8,259` holders
  - tKalshi, mint `TKLSidmLVt3cqGaaodG8tyRzoANfQwoh67AccjmubeZ`, mark `$413.80`, `2,605` holders
  - tSpaceX, mint `TSPXcLV76s6V2zDiZQ18kBfcbnjaE2ZzNT3ga2Pd99v`, mark `$423`, `1,274` holders
- T-tokens are loan participation rights, not securities. A `0.2%` transfer fee applies on every transfer. Redemption needs a liquidity event, lock-up expiry, Tessera receiving proceeds and an announced start date, with no time bound; unclaimed proceeds are forfeited after the window and redemption is not automatic. Source: `https://docs.tessera.pe/features/redemption`.
- Read the mint for the transfer fee config and any other extensions before writing escrow math.

### 2.5 PreStocks (pre-IPO desk)

- API: `https://prestocks.com/api/prestocks`. Fields include `symbol`, `contract_address`, `markPrice`, `tokenPrice`, `impliedValuation`, `supply`. Eight tokens live; OPENAI mint `PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF`, SPACEX mint `PreANxuXjsy2pvisWWMNB6YaJNzr7681wJJr2rHsfTh`.
- Note the spread between `markPrice` and `tokenPrice`: SPACEX marked `$151.17` against a token price of `$122.52`, a discount near `19%`. That spread is the price of having no exit, and it is a product surface for First Print.
- Tokens are backed by SPV exposure and confer no ownership, voting or dividend rights.

### 2.6 Tokens API (asset registry, prices)

- Base `https://api.tokens.xyz/v1`, header `x-api-key`. `GET /assets/resolve?mint=` maps a mint to a canonical asset; `GET /assets/:id/variants?kind=tokenized_equity` returns wrappers with `stockVariantTier`; `POST /assets/market-snapshots` batches prices. Use it for the registry and for displaying the wrapper tier on every ticket.

---

## 3. Product thinking

### The three jobs of a trading app

Every screen serves one of these, and the third is where most derivatives projects fail.

**Discover.** Show the trades that exist on NVDAx right now: expiry, cost, break-even, a simple payoff picture, and the move the buyer needs for the trade to work. Nothing abstract; the buyer should understand the bet before they understand the instrument.

**Act.** Buy from an executable, collateral-backed quote. The full cost, the maximum loss and the exact escrow account backing the contract are visible before signing. One transaction.

**Manage.** After the purchase: what you own, what it is worth right now, how long until expiry, exactly what exercising requires (for a call, paying the strike in USDC and receiving tokens), and every action available. If you can be auto-exercised, say when and by what rule. Never leave a holder wondering what happens next.

### What we sell, by product

**Gap** (calls, first): leveraged upside with the loss capped at the premium. The screen is a payoff slider.
**Floor** (puts, second): a funded exit at a price the holder chooses, exercisable any time until expiry.
**Commit** (the write side): get paid to buy Nvidia cheaper (puts) or to sell it higher (calls). Disclosed as paid risk, never as passive yield.
**Protected Buy** (after Gap and Floor): buy NVDAx, or buy NVDAx with a floor through a date, in one transaction.
**First Print** (last): funded exits on Tessera and PreStocks tokens, the assets with no exit at all.

### Copy rules that carry the positioning

Lead with the benefit grounded in mechanics: no liquidation, no funding, known max loss. Never claim to have invented a derivative. Never call Commit yield. Always show the disclosure next to the promise: contracts can expire worthless; maximum loss is the premium plus fees; exercising a call requires paying the strike.

---

## 4. Engineering spec

### 4.1 Denomination, the decision that makes everything else simple

Every contract stores two integers: **`raw_qty`**, the raw on-chain token amount escrowed or deliverable, and **`total_strike`**, the total USDC (6 decimals) exchanged at exercise. Nothing else is needed to settle.

Why: the raw amount never changes through a dividend or a split, so a contract for `raw_qty` tokens against `total_strike` USDC is invariant to every corporate action, with no oracle read and no multiplier read at exercise. The multiplier is used only to *display* the contract in share terms (`shares = raw_qty × multiplier`, `strike per share = total_strike / shares`) and to *price* it in the quoter against Pyth's per-share feeds.

Consequence to disclose: if a dividend is reinvested during a call's life, the escrowed tokens grow in share-equivalents and the call buyer captures that on exercise, because the writer sold total-return exposure. Document it in the risk section; it is correct, not a bug.

### 4.2 Program: `roster_finance`

Anchor, one program. Fully collateralized, American exercise, physical settlement, no margin, no netting, no liquidations, no insurance fund.

**Accounts**

- `Market` `[b"market", underlying_mint]`: underlying mint, quote mint (USDC), token program of the underlying, term grid config, fee bps, treasury, authority, paused.
- `Term` `[b"term", market, side, strike_per_share_1e6, expiry_ts]`: side (Call | Put), the display strike, expiry, aggregate open size, aggregate reserved collateral. The term is a grouping key for matching; economic truth lives in commitments.
- `Commitment` `[b"commit", term, underwriter, nonce]`: underwriter, `raw_qty`, `total_strike`, `raw_qty_filled`, ask per unit, premium received, state (Quoted | PartFilled | Filled | Exercised | Expired | Cancelled), escrow vault (underlying for calls, USDC for puts).
- `Position` `[b"pos", commitment, holder]`: holder, `raw_qty`, `raw_qty_exercised`, premium paid, expiry.

**Instructions**

`init_market`, `set_params`, `pause`, `unpause`.
`create_term(side, strike_per_share, expiry)` — permissionless, grid-enforced.
`quote(term, raw_qty, ask)` — for a call, escrows `raw_qty` underlying; for a put, escrows `total_strike` USDC computed from the term's strike and the current multiplier at quote time, then frozen into the commitment. Publishes the ask.
`cancel_quote(commitment, raw_qty)` — unfilled size only.
`buy(term, raw_qty, max_premium)` — matches the cheapest asks at the term in order, can split across commitments, transfers premium to each underwriter, creates one `Position` per fill.
`exercise(position, raw_qty)` — any time before expiry. Call: holder pays the proportional `total_strike` in USDC to the underwriter, receives `raw_qty` underlying from escrow. Put: holder delivers `raw_qty` underlying to the underwriter, receives the proportional `total_strike` from escrow. No oracle involved.
`auto_exercise(position, raw_qty)` — permissionless crank after `expiry_ts - grace` when the keeper's Pyth read says the position is in the money by more than the keeper fee; acts for the holder; fee from proceeds. This is a convenience and is the only place Pyth touches settlement.
`release(commitment)` — after expiry, returns unexercised escrow to the underwriter.
`protected_buy(...)` — a Jupiter swap into NVDAx and a `buy` of a put in one transaction.
First Print variants of `quote`, `buy`, `exercise`, `release` for transfer-fee mints, with fee-inclusive amounts on both legs.

**Token program handling.** The underlying is Token-2022. Use `transfer_checked` through the Token-2022 interface. If the mint has a transfer hook, resolve and pass the extra accounts on every transfer. If it has a transfer fee (Tessera), compute the received amount net of fee and quote fee-inclusive.

**Multiplier activation guard.** Read the pending activation timestamp from the xStocks API in the keeper and expose it to the app. The program does not need it, because raw-amount denomination is invariant, but the app shows a banner for `15` minutes either side of activation and the quoter widens or pauses, per xStocks' guidance.

**Tests that must pass before mainnet.** Every instruction's happy path. Exercise on day one, mid-window and one second before expiry (use `surfnet_timeTravel`). Exercise after expiry rejected. Partial exercise then release of the remainder. A buy split across three commitments, each exercised independently. Cancel on a partly filled quote. Double exercise rejected. Release before expiry rejected. Auto-exercise for an absent holder, and auto-exercise correctly declining when out of the money. **A multiplier change mid-contract with `raw_qty` and `total_strike` unchanged and the display recomputed.** A transfer-fee mint round trip reconciled to the last unit. Grid enforcement rejecting an off-grid term. Every test that touches settlement also runs with the Pyth accounts stale or missing, and passes.

### 4.3 Off-chain services

**Quoter (maker bot).** Prices every live term from realised volatility computed off the NVDAx token feed via Benchmarks over `7` and `30` day windows, blended, with a floor. Uses the NVDA equity feed as a sanity reference when open. Widens spreads by a configured multiple when the equity feed is closed and by more inside the multiplier activation window. Posts and refreshes quotes through `quote` and `cancel_quote` from the treasury wallet. Publishes its model parameters to `docs/QUOTER.md`. Survives a full simulated weekend unattended (time-travel test).

**Keeper.** Runs `auto_exercise` near expiry using Hermes reads; runs `release` after expiry; polls the xStocks multiplier endpoint and emits the activation banner state.

**Indexer.** Reads program accounts into a small Postgres or SQLite store for the app: live terms, commitments, positions, fills, exercises, releases, with signatures. The app never scans the chain directly.

**Executable-protection endpoint.** Computes, per term: quotes at three sizes, USDC and tokens currently reserved with the escrow accounts, remaining capacity, and the exercise history including failures. This feeds the roster page and the landing page.

### 4.4 Wallet and transactions

Build every transaction in the app, request `signTransaction` only, submit through the app's RPC. The wallet's own network setting must never matter. The active cluster is shown in the header on every screen.

---

## 5. UX flow (state and transitions, not visuals)

### Discover, `/`
State: live terms for NVDAx grouped by expiry, each with side, strike per share, premium per share, break-even, max loss for a default size, and the move needed. Session badge (regular, pre, post, overnight, closed) and the token-versus-share basis in basis points. Wallet not required.
Transitions: select a term → Act. Toggle side (Gap or Floor). Change default size and see cost update.

### Act, `/trade/[term]`
State: the payoff slider (drag the expected price; profit, break-even and max loss update; max loss pinned), the executable quote at the chosen size (premium, fee, total), the escrow accounts that will back the fill, and the disclosure line. If the quote is split across underwriters, show how many.
Transitions: connect wallet if absent → sign → confirmation with signature → Manage. Failure states: quote moved (re-quote in place), insufficient USDC, hook or pause failure (explain, link out).

### Manage, `/positions`
State per position: side, shares and strike in display terms, expiry countdown, current mark from Pyth with the basis, in-the-money or not, what exercising requires in plain words ("pay `$3,600` USDC, receive `20` NVDAx"), and auto-exercise rule and timing. Actions: exercise now (with a confirmation that restates the exchange), partial exercise, nothing else until expiry. After expiry: released or exercised, with signature.
Transitions: exercise → confirmation → receipt line appended to the position.

### Commit, `/underwrite`
State: choose side and term, enter size, see USDC or NVDAx to lock, premium to receive at the current ask, effective acquisition or sale price, and loss scenarios at three adverse prices. Disclosure: capital is locked until expiry or exercise; this is paid risk.
Transitions: quote → live on the roster → fills arrive → premium received → release or assignment at expiry.

### Roster, `/roster`
State: the executable-protection page. Quotes at sizes, reserved capital with accounts, capacity, exercise history, and which underwriters are live.

### Protected Buy, `/buy` (after Gap and Floor ship)
State: two buttons on NVDAx. Buy, or buy with a floor through a chosen expiry. The second shows purchase cost, premium and protected proceeds together.
Transitions: one transaction, then Manage.

### First Print, `/pre-ipo` (last)
State: registry of Tessera and PreStocks tokens with rights profile, mark versus token price and the implied discount, and funded-exit terms. Redemption-cliff explainer on every Tessera ticket.

### Global states
Multiplier activation banner. Paused market. Cluster label. Every failure message names what happened and the next action.

---

## 6. Landing page content

Sections in order. Copy is final unless a measured figure needs refreshing. Figures in mono. Sentence case. No em-dashes. No "demo".

### Hero
**Stock leverage without margin liquidation.**
Trade Nvidia's upside on Solana with a fully paid contract. Choose your expiry, see your premium and break-even, and know your maximum loss before you buy. No borrowing, no funding payments, no margin calls.
Primary element: the live Discover table for NVDAx, filtered to the nearest expiry.
Disclosure line beneath: contracts can expire worthless. Maximum loss is the premium plus fees. Exercising a call requires paying the strike.

### The problem, told plainly
**A perp can take your whole position on a wick you never saw.**
Tokenized stocks trade `168` hours a week. The shares behind them trade `32.5`, about `19%` of the week. In the `75` hours between Friday's close and Monday's open, the token book is thin, the share has no price, and a leveraged position can be liquidated on a move the market will never confirm. Today on Solana the only ways to lever a stock are a perp or a loan loop, and both liquidate.
Sub-line with attribution: `63%` of tokenized-equity spot volume on Solana in 2026 happened outside US exchange hours (Decentralised.co, September 2026). Perpetuals on tokenized equities did `$376.3B` against `$7.5B` of spot (CoinGecko, September 2026). The demand is for leverage; the instrument for it is the one that can't liquidate you.

### What you can do here
Three worked examples, each with real numbers from the live quoter and a payoff sketch.
**Gap.** Buy the upside. Pay `$X` for the right to buy `10` NVDAx at `$180` through Friday. If it opens at `$198`, you're up `$Y`. If it doesn't, you lost `$X` and nothing else.
**Floor.** Buy an exit. Pay `$X` for the right to sell `20` NVDAx at `$180` any time through Friday, backed by `$3,600` already locked. Nothing else on earth sells a Saturday exit on Nvidia.
**Commit.** Get paid to take the other side. Lock `$3,600`, collect `$60`, and either keep it or buy Nvidia at `$180`. Paid risk, disclosed as such.

### How it is different
Table:

| | Perps (Hyperliquid, CEX stock perps, Wasabi) | Loops (Kamino, Loopscale) | Listed options (CBOE) | Roster Finance |
| --- | --- | --- | --- | --- |
| Max loss | Unbounded, liquidation | Collateral liquidation | Premium | Premium |
| Funding or interest | Yes | Yes | No | No |
| Open on Saturday | Yes, synthetic mark | Yes | No | Yes |
| Settles into your wallet | No | No | No | Yes, the token itself |
| Can liquidate you | Yes | Yes | No | No |

Line: perps take your position on the wick. Roster caps your loss at the premium and delivers the stock.

### Proof of executable protection
The live roster: quotes at three sizes, USDC and NVDAx reserved with the accounts linked, capacity, and exercise history. Line: a venue that publishes whether its promises are funded is a venue that expects to be checked.

### What this is not
**"This is an options protocol."** Mechanically these are fully collateralized American options, and the docs say so. What we sell is one benefit: leverage or an exit with a known worst case, priced and funded before you click. No chain of strikes, no greeks, one underlying.
**"Options venues on Solana die of fragmentation."** They listed dozens of assets across dozens of strikes and expiries and split every maker across hundreds of thin books. We run one name, two expiries, three strikes a side, and several underwriters compete for the same term.
**"Why not a perp?"** A perp is the right tool for funding-rate exposure. It is the wrong tool for a position you want to leave on over a weekend on an asset whose market is closed. We point at perps for the first case.
**"Why not a limit order?"** A limit order controls the price of a fill but can sit unfilled through the exact hours you needed it. A funded exit is a counterparty who has already locked the cash.
**"Nothing will fill."** The sell side is seeded by our own capital and a maker bot from day one, and the roster page shows exactly what is fillable at what size.

### First Print
**The assets with no exit at all.**
Pre-IPO tokens are stocks whose market has never opened. Tessera's redemption needs a liquidity event, lock-up expiry, receipt of proceeds and an announced start date, with no time bound, and unclaimed proceeds are forfeited after the window. The alternative is a DEX where liquidity depends on finding a buyer, with a `0.2%` fee on every move. PreStocks' SPACEX token trades about `19%` below its mark for the same reason. A funded exit is the only way to hold a known price on a known date. About `10,900` wallets hold tOpenAI and tKalshi today.

### Said out loud
Ruled list, one line each, dated, linked: CoinGecko September 2026 on perps versus spot and concentration; Decentralised.co September 2026 on off-hours volume and on concentrating options liquidity on one asset (their recommendation concerned SOL; applying it to NVDAx is our interpretation); The Block May 2026 on hedging a `$200M` pre-IPO position against `$3M` of open interest; Pantera June 2026 on equity-based tokenized startups out-trading perps; Pyth February 2026 on synthetic overnight pricing producing liquidations at untradeable prices; Tessera redemption terms; Alpaca on limit orders controlling price but not fill.

### Risk and honesty
Fully collateralized, American exercise, physical settlement. What is live and what is not. What a contract does not protect against: chain halts, token freezes, pauses or transfer restrictions on the underlying mint. Dividend reinvestment during a call accrues to the escrowed tokens and is captured by the buyer at exercise. xStocks are tracker certificates with no voting rights. T-tokens are loan participation rights, not securities. PreStocks tokens confer no ownership, voting or dividend rights. Non-US wrappers, fully collateralized, counsel before expanding.

### Footer
Roster Finance. Stock leverage without margin liquidation, on Solana. Contracts can expire worthless. Nothing here is an offer of any security. Links: app, positions, roster, docs, source, risk.

---

## 7. Phases

**P0 foundation.** Monorepo (`programs/`, `packages/oracle`, `packages/quoter`, `packages/keeper`, `packages/indexer`, `apps/web`, `scripts/`, `docs/`). Anchor workspace. Surfpool fork against mainnet with the NVDAx mint, USDC and the Pyth accounts streamed. Read the NVDAx mint and record every extension in `docs/MINT.md`. Confirm `fundToken` works on the Token-2022 mint. Obtain Pyth Core key; resolve and record feed ids with sources. Confirm `surfnet_timeTravel` advances the clock as expected.
Done when: a script funds a test wallet with NVDAx and USDC on the fork, reads the multiplier from the mint, reads both Pyth feeds, and time-travels to a Saturday and reports the equity feed closed and the token feed live.

**P1 engine.** Program, every instruction, the full test list from 4.2. Calls and puts both, since the code is symmetric.
Done when: all tests green including time-travelled expiries and the multiplier-change invariance test.

**P2 supply and services.** Quoter, keeper, indexer, executable-protection endpoint. Treasury wallet funded on the fork.
Done when: the quoter posts quotes for every grid term, survives a time-travelled weekend, fills are indexed, auto-exercise fires correctly in a time-travelled expiry, and the endpoint returns fillable sizes.

**P3 product.** Discover, Act, Manage, Commit, Roster screens from section 5. Wallet flow per 4.4.
Done when: a person can buy a call, buy a put, write a put, exercise, and see the release, in a browser with no terminal.

**P4 Protected Buy and First Print.** Jupiter swap plus put in one transaction. Tessera and PreStocks registry with rights profiles, mark-versus-token discount, transfer-fee-aware contracts on tOpenAI, tKalshi and OPENAI.
Done when: one Protected Buy round-trips and one Tessera contract round-trips with fees reconciled exactly.

**P5 mainnet (stop and ask before funding).** Deploy. Present the funding plan: treasury size, per-term caps, expected exposure. On approval, seed, post quotes, run real terms through a full weekend, keep the signature tape.
Done when: at least one real expiry has settled and at least one person who is not the author has bought a contract.

**P6 submission.** Video off the mainnet tape following the Discover, Act, Manage sequence. README with section 1, the difference table, what-this-is-not, the citations, the risk section, and a "what is live" table. Bounty forms for Pyth, Tessera and PreStocks.

---

## 8. Bounty mapping

- **Pyth.** Load-bearing in the quoter (realised vol from Benchmarks, live marks from Hermes), the basis display, session-aware terms and the auto-exercise crank; deliberately absent from the exercise path so an exit can never be blocked by a feed. Submission line: Roster Finance prices every contract with Pyth, displays the token-versus-share basis as its core risk surface, and documents exactly where an oracle must not sit.
- **Tessera (`$6,000`).** The only instrument giving tOpenAI and tKalshi holders a known price on a known date, against a redemption with four preconditions, no deadline and a forfeiture cliff. Transfer-fee-aware.
- **PreStocks (`$5,000`).** The same on their tokens, with the mark-versus-token discount shown as the price of illiquidity.
- Skip Meteora DBC and Clawpump.

---

## 9. Guardrails

Never invent an id or address. Never describe contracts as anything but fully collateralized. Never call Commit yield. Never imply a wrapper carries rights it does not. Copy lint every page: no em-dashes, no "demo", sentence case, figures in mono. Secrets server-side. TypeScript strict. Every instruction tested. Before any novelty claim reaches the site, verify it against a primary source and log where.

---

## Kickoff message

> Read `CLAUDE.md` in full. Then, without writing product code, produce `docs/PLAN.md` containing: the repo layout; the NVDAx mint's extension list read from chain with what each one means for escrow; the Pyth feed ids you resolved and their sources; confirmation that `fundToken` and `surfnet_timeTravel` behave as documented on the fork; the Anchor account layout with PDA seeds and byte sizes, including how `buy` splits across commitments and how `exercise` routes to the right escrow; the exercise path with no oracle; the multiplier-invariance argument in one paragraph; the quoter's volatility model and its closed-market behaviour; how the Tessera transfer fee changes both legs; and the five risks most likely to sink the build with mitigations. Then proceed directly into P0 and onward under the operating contract in section 0, stopping only when a stop condition fires.

---

# Roster Finance: follow-up brief, from one market to the complete protocol

Append this to `CLAUDE.md` as Part 2. Part 1 (the existing brief) stays in force for everything it covers. Where this file and Part 1 disagree, this file wins, and each disagreement is called out explicitly below so nothing is ambiguous.

You are mid-build. Read this whole file before writing another line, then reconcile against `docs/PLAN.md` and `docs/BUILD_LOG.md`, and write `docs/RECONCILIATION.md` stating what already-built code is kept, what is refactored, and why. Then continue.

---

## 0. The scope change, stated precisely

Part 1 built one market. The target is the complete protocol: every tokenized stock, ETF and pre-IPO token on Solana that can be safely escrowed, listed from a registry, priced by Pyth where a feed exists, quoted by a maker fleet, tradeable in a product that looks and behaves like it already has a billion users.

**What does not change.** The instrument (fully collateralized, American exercise, physical settlement, raw-amount denomination), the product names and copy, the design system, the operating contract in Part 1 section 0, the guardrails, and the honesty rules.

**What changes.**

1. The program becomes multi-market and registry-driven. Markets are created from a registry entry, not hand-configured.
2. Escrow moves from per-commitment to **pooled per series** with **fungible position tokens**, because per-commitment routing does not scale and positions must be transferable and visible in wallets. Section 3 specifies this. If P1 already shipped per-commitment escrow, refactor now; it is cheaper than after P3.
3. "One name" becomes a **liquidity-seeding policy**, not an architectural limit. The protocol lists everything eligible; the treasury and the maker fleet concentrate capital on a launch set, expand by a published rule, and every listed market shows its executable depth honestly.
4. Services, frontend and operations are specified to production standard in sections 5 to 7.

---

## 1. What I need from you (external inputs the build cannot obtain on its own)

Provide these in `.env` (never committed) and `docs/OPERATOR.md` (committed, no secrets). Each line says what, where to get it, the format, and which phase it blocks. The build proceeds on everything that is not blocked and stops at the first blocked step with a one-line request naming the missing item.

**Keys and accounts**

- `PYTH_CORE_API_KEY`. Pyth Core has required a key since August 18, 2026. Obtain at the Pyth developer portal. Blocks P0.
- `PYTH_PRO_API_KEY`, optional. Unlocks `.PRE`, `.POST`, `.ON` session feeds and the continuous equity benchmarks. Apply now; the Pyth bounty prize is three months of Pro. Not blocking; the code degrades to Core.
- `TOKENS_XYZ_API_KEY`. From the Assets API button at tokens.xyz. Blocks the registry in P7.
- `HELIUS_API_KEY` (or another mainnet RPC provider with archival and websocket support). Blocks P0's fork upstream and everything on mainnet.
- `JUPITER_API_KEY`, if the current Jupiter swap API tier requires one (check `portal.jup.ag`). Blocks Protected Buy in P4.
- Postgres connection string (Neon, Supabase or self-hosted). Blocks the indexer in P2.
- Hosting: a Vercel (or equivalent) project and the DNS for `roster.finance` pointed at it. Blocks P6 and the public launch.
- Observability: Sentry DSN, and a Grafana Cloud or equivalent endpoint for metrics. Blocks P8 hardening; not blocking before.
- Dialect Blinks registration for the domain, so shareable trade links unfurl in wallets. Blocks P9 distribution only.

**Keys (signing)**

- A **deployer keypair** funded with SOL for program deployment and upgrades. Budget roughly `8` to `12` SOL for a program of this size with buffer and rent on the registry accounts; the plan will state the exact figure after `anchor build`. Blocks P5.
- A **Squads v4 multisig** as the upgrade authority and registry authority, with at least two signers you control on separate devices, and a timelock on upgrades. Provide the multisig address; the deploy script transfers authority to it. Blocks P5 mainnet.
- A **treasury wallet** (ideally a Squads vault) holding USDC and the launch-set underlyings for seeding. The plan will propose sizes per market; you approve them. Blocks P5 seeding.
- A **keeper hot wallet** with a small SOL balance for cranks (`auto_exercise`, `release`, multiplier watcher). Blocks P2 on mainnet, not on the fork.
- A **quoter hot wallet** that holds only the capital you are willing to have quoted at any moment, refilled from the treasury by policy. Blocks P5.

**Decisions only you can make**

- Launch set and seed sizes per market (see section 4.3 for the proposed default).
- Fee schedule: taker fee bps, integrator share bps, treasury share. Default proposal: `10` bps taker, of which `30%` to an integrator when a referral is present.
- Geo policy: the list of jurisdictions the front end blocks. The wrappers already exclude US, UK, Canada and Australia persons; mirror that at minimum.
- Legal entity name for the terms and risk disclosures, and a contact address.
- Whether Ondo wrappers are pursued (they use transfer hooks with eligibility allowlists; the escrow PDA would need allowlisting by Ondo). Default: excluded, shown as "restricted wrapper" with the reason.

---

## 2. The market registry (every listable asset)

**Source of truth.** A registry built from the Tokens API curated stock and ETF lists (`GET /assets/curated?list=stocks&groupBy=mint`, and ETFs), each mint resolved to its canonical asset and wrapper tier via `/assets/:id/variants?kind=tokenized_equity`, plus Tessera (`/v1/public/token-details`) and PreStocks (`/api/prestocks`) for pre-IPO tokens. Refreshed by a scheduled job; changes are proposals to the registry authority, never automatic listings.

**Per-mint eligibility check, run before any listing.** Read the mint on mainnet and record: token program; every Token-2022 extension present; freeze authority; permanent delegate; transfer hook program and whether an escrow PDA can hold and transfer the token; transfer fee config; pausable config; scaled UI amount and its multiplier source; decimals. Output a verdict: `eligible`, `eligible_with_fee`, `restricted_wrapper` (with reason), or `ineligible`. Store the verdict in the registry and show it in the app. Never list a mint whose escrow transfer has not been proven on the fork.

**Per-market configuration** (stored on-chain in `MarketConfig`, mirrored in the registry): underlying mint, quote mint, token program, extension flags, price feed ids (token feed, equity reference feed if any, session feeds if any), multiplier source (xStocks API or none), term grid (expiries and strike offsets), per-series and per-underwriter caps, min and max size, fee bps, liquidity tier, listing status.

**Liquidity tiers, published.** `Tier 1`: treasury-seeded, maker fleet quoting continuously, both sides. `Tier 2`: maker quotes on request, treasury caps lower. `Tier 3`: listed and permissionless; anyone may quote, no treasury capital, depth shown as zero until it isn't. Promotion rule: a market moves up a tier when executable depth at the standard size exceeds a published threshold for `7` consecutive days.

**Launch set (proposed, you approve).** Tier 1: NVDAx, TSLAx, SPYx. Tier 2: AAPLx, MSFTx, GOOGLx, AMZNx, METAx, CRCLx, MSTRx, QQQx, plus the Backpack entitlements for the same names once their escrow check passes. Tier 3: every other eligible mint from the registry. Pre-IPO: tOpenAI, tKalshi, OPENAI (PreStocks), SPACEX (PreStocks) at Tier 2.

---

## 3. Program changes: pooled series, fungible positions

This supersedes Part 1 section 4.2's per-commitment escrow.

**Series.** `[b"series", market, side, strike_per_share_1e6, expiry_ts]`. Holds: a pooled collateral vault (underlying for calls, USDC for puts), a settlement vault (USDC received from call exercises, or underlying received from put exercises), `total_sold_raw` (contracts sold), `total_exercised_raw`, `total_collateral_raw`, state, and a **position mint** (Token-2022, `6` decimals, metadata: underlying symbol, side, strike, expiry, protocol name) whose supply equals contracts sold.

**Writer accounts.** `[b"writer", series, writer]`: `collateral_deposited`, `sold_raw`, `withdrawn`. A writer deposits collateral for `n` contracts and posts an ask; only the unsold portion is withdrawable at any time; the sold portion is locked until expiry and participates in assignment pro rata of `sold_raw`.

**Asks.** An on-chain order list per series, price-time priority, holding `(writer, remaining_raw, ask_per_unit)`. `buy` walks the list, pays each writer their premium, increments `sold_raw` on each, and mints position tokens to the buyer. Position tokens are fungible within a series and freely transferable, so they trade on Jupiter and show in every wallet with readable metadata.

**Exercise.** Any holder of position tokens may `exercise(raw_qty)` before expiry: burns the tokens; for a call, transfers `raw_qty × strike_total_per_unit` USDC from the holder into the settlement vault and `raw_qty` underlying from the collateral vault to the holder; for a put, the reverse. No oracle. No per-writer routing.

**Assignment and release.** After expiry, each writer calls `settle_writer`, receiving their pro-rata share of what remains in both vaults: `(sold_raw / total_sold_raw) × (remaining collateral + settlement proceeds)`, plus any unsold collateral. This is how listed options assign, and it removes the routing complexity entirely.

**Denomination stays raw.** `strike_total_per_unit` is fixed per series at creation as USDC per raw unit, computed from the display strike and the multiplier at creation, then never changed. Display converts using the live multiplier. The multiplier-invariance test from Part 1 still applies.

**Additional instructions.** `create_market(registry_entry)` by the registry authority; `update_market_config`; `pause_market`, `pause_all`; `set_fee_schedule`; `withdraw_fees`; `register_integrator(pubkey, share_bps)` and a `referrer` argument on `buy` so wallets embedding the widget earn a share; `auto_exercise` unchanged in spirit but operating on position-token holders (crank reads the holder's token account and acts under a delegate the holder can revoke; default on, revocable in Manage); `protected_buy` unchanged; First Print variants with transfer-fee math.

**Events.** Emit Anchor events for every state change with enough fields for the indexer to reconstruct state without RPC scans: market created or updated, series created, ask posted or cancelled, fill, exercise, writer settled, fees withdrawn, pause toggled.

**Invariants, enforced and tested.** For every series at every instruction boundary: collateral vault balance `≥ (total_sold_raw − total_exercised_raw) × unit_collateral`; position mint supply `= total_sold_raw − total_exercised_raw − burned_at_expiry`; sum of writer `sold_raw` `= total_sold_raw`. Property-test these with random instruction sequences on localnet.

**Upgradeability.** Deployed with the Squads multisig as upgrade authority behind a timelock. Program id fixed in `Anchor.toml` and mirrored in the registry. Document the upgrade runbook.

---

## 4. Pyth, complete requirements

**Feed resolution per market.** For every listed underlying, resolve and store: the token feed id if one exists (the xStock or Ondo feed, crypto class, `24/7`); the equity reference feed id (regular session, closed weekends and NYSE holidays); the session feed ids (`.PRE`, `.POST`, `.ON`) when Pro is enabled. Use the Pyth MCP `get_price_feeds` tool or the published feed list; record source and date for each id in `docs/FEEDS.md`. Markets with no token feed price off the equity feed while it is open and off the maker's own model otherwise, and the app says so.

**Hermes.** Core endpoint with the Bearer key, cached with a short TTL, rate-limit aware. A single price service fans out to the quoter, keeper, indexer and app; nothing else calls Hermes directly.

**Benchmarks.** Realised volatility per underlying over `7`, `30` and `90` day windows from the token feed where it exists, else the equity feed; refreshed hourly; used by the quoter and displayed in the app as "recent volatility".

**On-chain price for the crank.** The `auto_exercise` crank reads Hermes off-chain and then posts a price update through the Pyth Solana receiver program in the same transaction so the decision is verifiable on-chain; the program checks staleness and confidence on that posted update before acting. Exercise itself remains oracle-free.

**Session state.** A session service derives market state (regular, pre, post, overnight, closed, holiday) per underlying from Pyth's published market hours, exposed to the app and used by the quoter to set spread multipliers and by the term grid to place the weekend expiry at the reopening print time.

**Basis.** Token feed versus equity feed in basis points, per underlying, live, on every ticket and in a protocol-wide basis table. Store it in the indexer every minute so it can be charted.

---

## 5. Services at scale

**Quoter fleet.** One process per liquidity tier, each holding only its wallet's capital. Model per underlying: blended realised vol with a floor, a session multiplier (`1.0` regular, `1.4` pre and post, `1.8` overnight, `2.2` closed), a multiplier-activation multiplier (`3.0` inside the `15` minute window or paused per policy), inventory skew, and per-series caps from `MarketConfig`. Every quote decision logged with its inputs. Circuit breakers: stop quoting a market when the basis exceeds a threshold, when Hermes is stale, or when a mint pause is detected.

**Keeper fleet.** Cranks partitioned by market: `auto_exercise` windows, `settle_writer` after expiry (permissionless, so anyone can run it), the multiplier watcher for every xStocks mint with the activation banner state, and a series-creation job that keeps the term grid populated as expiries roll.

**Indexer.** Event-driven from program logs into Postgres, with a REST and GraphQL API: markets, series, asks, fills, positions by wallet, exercises, settlements, fees, basis history, volatility history, executable depth per series. Backfill from a slot; idempotent; resumable. Public read API with rate limits and an API key tier for integrators.

**Executable-protection service.** Per series: fillable size at three standard notionals, reserved collateral with vault addresses, remaining capacity, exercise and settlement history with signatures and any failures. Served to the roster page and to integrators.

**Notifications.** Optional per-wallet alerts (email or Telegram via a bot) for: position near expiry, in the money, auto-exercise executed, settlement available, multiplier activation on a held underlying.

---

## 6. Frontend completeness (flows, states, content; the visual system is already set)

**Global.** Market search with fuzzy match across `400+` names, filters by wrapper tier, sector and liquidity tier, watchlists persisted to the wallet's signature-derived key, cluster label, session badge, multiplier banner, geo gate with a plain message, responsive to `390px`, keyboard navigable, screen-reader labelled, `<200ms` first paint on the market list via server rendering and edge cache.

**Discover.** Market list with executable depth, best ask, volatility and basis per name; market page with the term grid, payoff slider, the roster, and the rights profile of the wrapper.

**Act.** Executable quote with escrow account links, split count, fee and referrer disclosure, one-transaction sign, confirmation with signature, and error taxonomy (quote moved, insufficient balance, hook accounts, mint paused, RPC congestion) each with a next action.

**Manage.** Portfolio across all markets: value, in-the-money status, time to expiry, exercise requirements in plain words, auto-exercise delegate state with revoke, partial exercise, history and receipts, CSV and PDF statement export.

**Commit.** Write side across all markets with the same three-scenario loss display, plus the pooled vault option (deposit into a strategy that writes a policy across a set of series; shares are tokens) with published policy and live performance.

**Roster.** Protocol-wide executable protection: totals, per market, per series, history.

**Protected Buy.** On every Tier 1 and Tier 2 market.

**First Print.** Pre-IPO registry with rights profiles, mark versus token discount, redemption terms per issuer, funded-exit terms.

**Docs site.** How it works, risk, fees, integrator SDK, API reference, program addresses, audit status, runbooks summary, changelog.

**Distribution.** An embeddable widget and a TypeScript SDK (`quote`, `buy`, `exercise`, `positions`) with the `referrer` field; Blinks for every series so a trade can be shared as a link; a public status page.

---

## 7. Production hardening (P8)

Property-based tests on the invariants; fuzzing of instruction sequences; a third-party review or audit booked with the report linked from the docs before Tier 1 caps are raised; bug bounty page; rate limiting and abuse controls on every public endpoint; secrets in a manager, never in env files on servers; RPC failover across two providers; alerting on quoter halt, keeper lag, indexer lag, basis breach, treasury drawdown; incident runbooks for mint pause, oracle outage, RPC outage, program pause; a public changelog; terms, privacy and risk disclosures reviewed by counsel before mainnet caps exceed the initial seed.

---

## 8. Phases appended to Part 1

Part 1 phases P0 to P6 remain, with these amendments: P1 builds the pooled-series program from section 3 (refactor if already started); P0 additionally runs the eligibility check on the full launch set and records verdicts.

- **P7 registry and multi-market.** Registry job, eligibility verdicts for every curated mint, `create_market` from registry entries, term-grid population across the launch set, per-market Pyth resolution. Done when every launch-set market exists on the fork with quotes from the appropriate tier and the eligibility report is in `docs/ELIGIBILITY.md`.
- **P8 hardening.** Section 7 in full. Done when the property tests and fuzzing pass, alerts fire in a drill, and the runbooks have been exercised once on the fork.
- **P9 distribution.** SDK, widget, Blinks, integrator fee share, docs site, status page. Done when a second front end (the widget in a test page) completes a buy with a referrer that receives its share.
- **P10 launch.** Mainnet with the multisig as authority, Tier 1 seeded per approved sizes, Tier 2 and 3 listed, a full weekend of real expiries on the tape, public announcement. Stop-and-ask before every real-funds step, per Part 1 section 0.

---

## 9. Reconciliation with the running build

Write `docs/RECONCILIATION.md` before continuing. It must state: which Part 1 phases are complete; whether P1's escrow is per-commitment or pooled, and the refactor plan if the former; every account and instruction that changes; every test that changes; and the order of work for the next three sessions. Then follow the operating contract: proceed without asking except at the stop conditions.

---

## Kickoff message for the running instance

> A Part 2 has been appended to `CLAUDE.md`. Read it fully. Produce `docs/RECONCILIATION.md` as section 9 requires, and update `docs/OPERATOR.md` with the exact list of external inputs from section 1 that are still missing, each with the phase it blocks. Then continue the build under the operating contract, starting with any refactor the reconciliation identified, and proceed through P7 to P10 in order. Stop only at the stop conditions in Part 1 section 0 or at the first missing external input that blocks the current step, and when you stop, ask for exactly that item in one line.

---


# Roster Finance: Part 2 addendum

Append directly after Part 2 in `CLAUDE.md`. This closes gaps in Part 2 and fixes one broken cross-reference. Where this addendum and Part 2 disagree, this wins.

---

## A. Correction

Part 2 section 1 refers to "section 4.3" for the launch set and seed sizes. There is no section 4.3. The launch set is in **section 2, "Launch set (proposed, you approve)"**. Seed sizes per market are proposed by you in `docs/SEEDING.md` at P5 and approved by the operator before any real funds move.

---

## B. The hackathon cut line (read this before planning any work)

Part 2 describes a protocol that takes months. The Stocklana submission closes **September 25, 2026**. These are two different deliverables and the plan must serve both without confusing them.

**Ship by September 23 (submission build).** P0, P1 (pooled series), P2, P3, P4, P7 restricted to the Tier 1 and Tier 2 launch set, P6. Mainnet deployment with Tier 1 seeded at small size, real expiries on the tape, the video, the README, the bounty forms.

**Explicitly deferred past submission.** P8 hardening beyond the property tests and invariant fuzzing, P9 distribution, P10 full launch, Tier 3 permissionless listing, notifications, GraphQL, PDF statements, the pooled writer vault, the widget and SDK.

**How deferred work appears in the product.** Anything not built is absent from the UI, never stubbed and never faked. The README carries a "what is live" table listing exactly what runs, what is on the fork only, and what is roadmap. A judge reading it should be able to verify every "live" claim in one click.

**If a phase is running late on September 22**, cut scope inside the phase rather than skipping P6. A submission with three markets and a perfect demo beats twelve markets and a broken video.

---

## C. Series creation must be lazy, and rent must be bounded

Part 2's term grid across the full registry would create thousands of series accounts. At `400+` markets times two sides times two expiries times three strikes, that is roughly `4,800` series, each with a series account, a position mint, a collateral vault and a settlement vault. The rent alone makes it impossible, and most would be empty.

**The rule.** Series are created lazily. `create_series` is permissionless within the grid and is called by the first writer to quote that term (or by the quoter fleet for Tier 1 and Tier 2 markets). No series exists until someone commits capital to it. The app shows the full grid as *quotable terms* derived from `MarketConfig`, and marks each as live or not-yet-created; requesting a quote on an uncreated term triggers creation in the same transaction as the first `quote`.

**Rent recovery.** After expiry and once every writer has settled and the position mint supply is zero, `close_series` reclaims rent from the series account, both vaults and the position mint, returning it to whoever paid. The keeper runs this. Budget rent in `docs/RENT.md` with the measured cost per series after `anchor build`.

**Live series cap.** `MarketConfig` carries `max_live_series`. Tier 1 defaults to `12`, Tier 2 to `6`, Tier 3 to `2`. The quoter never creates beyond the cap. This is what keeps a `400`-market protocol from becoming the fragmentation problem Part 1 warns about.

---

## D. The on-chain ask list: bounds, partial fills, and what happens when it is full

Part 2 says "an on-chain order list per series, price-time priority" without bounding it. Unbounded lists exceed account size and compute limits.

**Structure.** A fixed-capacity array in the series account: `max_asks` entries, default `32`, each `(writer, remaining_raw, ask_per_unit, seq)`. Sorted insert on `quote`; the entry with the worst price is evicted when full and its writer's collateral becomes withdrawable immediately (they are simply no longer quoting). A rejected insert (the new ask is worse than every resident ask) returns a clear error the quoter handles by re-pricing.

**Walk bound.** `buy` walks at most `8` asks in one instruction. If the requested size needs more, the instruction fills what it can within the bound and returns the filled amount; the client either accepts the partial or retries. The app's Act screen states this plainly when a fill is partial: "filled `n` of `m`, remaining available at a higher price".

**Partial fill semantics.** `buy(term, raw_qty, max_premium_per_unit)` fills greedily from the best ask while the ask is at or below `max_premium_per_unit` and the walk bound is not exceeded. It never fills above the limit. If zero can be filled, the instruction fails with `QuoteMoved` and the app re-quotes in place rather than throwing the user back to the start.

**Compute.** Measure CU for a full `8`-ask walk on a transfer-hook mint and record it in `docs/COMPUTE.md`. If it exceeds the per-instruction budget, lower the walk bound rather than raising the request.

---

## E. Integer math, dust and rounding

Pro-rata assignment with integer arithmetic creates dust that must go somewhere explicit, or the invariants fail.

**Rules.** All division rounds in the protocol's favour against the party being paid, never against the vault: `settle_writer` rounds a writer's share down; `exercise` rounds the holder's received amount down and the amount they owe up. Residual dust remains in the vault and is swept to the fee account by `close_series`, never to a user. State this in the docs and show it in the settle confirmation when it is non-zero.

**Test.** A series with three writers at prime-numbered `sold_raw` values, partially exercised at an awkward quantity, then all settled: assert every vault balance is zero or dust-only after `close_series`, and assert no user received more than their exact entitlement.

---

## F. Early exercise under pooled assignment

Part 2's design is correct but the consequence must be documented, because a writer will ask.

American exercise plus pooled assignment means a writer's outcome does not depend on *when* an exercise happened, only on their share of `sold_raw` at expiry. Early exercises accumulate in the settlement vault; at expiry every writer receives the same blended mix of remaining collateral and settlement proceeds. This is how listed options assignment averages out across an exchange's writer pool, and it removes any incentive to game timing.

Put it in the Commit screen in one line: you are assigned pro rata of what you sold, not by who exercised first.

**Test.** Two writers with equal `sold_raw`, one exercise at day one and one at day six, both settle after expiry: assert identical payouts.

---

## G. Fees and protocol accounting

Part 2 names a fee schedule but not where fees live or how they are accounted.

**Collection.** The taker fee is deducted from the premium at `buy` and transferred to a `FeeVault` PDA per quote mint. The integrator share, when a `referrer` is present, is transferred in the same instruction to an `IntegratorClaim` PDA the integrator withdraws from. Fees are never taken at exercise or settlement, so a holder's max loss stated at purchase is the true max loss.

**Accounting.** The indexer maintains, per market and protocol-wide: premium volume, fee revenue, integrator share paid, treasury capital deployed, treasury realised P&L (premiums collected minus assignment losses, per series, marked at the settlement price), and open exposure. Publish the protocol-wide figures on the roster page from day one. Publishing treasury P&L honestly, including losing weeks, is the single most credible thing this protocol can do.

**Sustainability note for the docs.** The treasury is a market maker, not a yield product. It can lose money in a week where the market gaps through strikes. Say so in plain words wherever treasury performance is shown.

---

## H. Landing page, amended for multi-market

Part 1 section 6's copy stands, with these changes:

- The hero's live element becomes the **market list**, sorted by executable depth, showing the top Tier 1 markets with best ask, recent volatility and basis, and a search box across every listed name. The headline and disclosure line are unchanged.
- Add a section, **Every stock, honestly tiered**: the three liquidity tiers explained in one line each, with the live count of markets in each and the promotion rule. This turns the long tail from a weakness into a statement of discipline.
- The comparison table gains a row: **coverage**, with Roster showing the live market count and the others showing theirs.
- The "what this is not" answer on fragmentation is updated: we list every eligible market and concentrate capital on a launch set, publish the depth of each, and cap live series per market so the book cannot sprawl.

---

## I. P5 and P10 reconciled

Part 1's P5 and Part 2's P10 both describe going to mainnet. They are one sequence:

- **P5, before submission.** Deploy with the deployer key, transfer upgrade authority to the multisig immediately, seed Tier 1 only at approved small size, run real expiries. Stop and ask before funding.
- **P10, after submission.** Raise caps, list Tier 2 and Tier 3, open permissionless quoting, announce. Stop and ask before every cap increase.

---

## J. What still needs your judgement, restated

Everything in Part 2 section 1 remains. Add two:

- **Approve or amend the cut line in section B.** If you would rather cut a product than a market, say which.
- **Confirm the treasury size for P5.** The build will propose per-market figures in `docs/SEEDING.md`; nothing moves until you approve them in writing in that file.

---

## Kickoff addition

> A Part 2 addendum has been appended to `CLAUDE.md`. Read it with Part 2. In `docs/RECONCILIATION.md`, add a section mapping every phase to either the September 23 submission build or the deferred set per addendum section B, and flag anything already built that the addendum changes (lazy series creation, ask-list bounds, dust policy, fee vaults). Then continue under the operating contract.
