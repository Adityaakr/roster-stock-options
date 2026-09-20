# PreStocks bounty: eligibility and the best use of PreStocks in Roster

Prism PLAN run, 2026-09-20. Six lenses (first principles, bounty-judge adversary with web access, practitioner, escrow and data integrity, UX surfaces, pricing economics), four load-bearing claims grounded by re-opening the cited lines and then attacked by three skeptics (2x Opus, 1x Sonnet). Two-way door: no funds move; every change here is a commit.

## 1. Recommendation

Enter the PreStocks bounty alone and make PreStocks the only pre-IPO issuer in the shipped product. Remove Tessera from every runtime surface (app, services, registry fetcher, landing, devnet market, fixtures, the fee round-trip test), not only the three obvious ones. Then build, in this order: (1) OPENAI and SPACEX as live devnet markets on faithful replicas (50 bps fee plus the real ScaledUiAmount multipliers 1.486 and 5) with Gaps quoted and a Covered Call vault on each; (2) a PreStocks desk at `/pre-ipo` that uses every API field the bounty names and states the token-versus-mark spread as a signed two-way figure, never as a one-way "discount" or "no exit"; (3) three fixes without which the vault and the ask are not honest on these tokens: the vault `locked_raw` residual bug, a pre-IPO vol input (measured from the stored marks, floor 80 to 100 percent until seven days exist), and the transfer fee priced into the ask and shown in epoch P&L; (4) fee-inclusive Floors, attempted on Sep 21 with a hard stop at Sep 22 noon, because the Floor is the one product that is an exit and PreStocks' ecosystem lists no options or covered-call product at all. If the Floor is not green by the stop, Gaps plus the vault bid carry the entry and the copy says so.

## 2. Why

- **The rule is a hard clause and Tessera is not incidental.** `apps/web/src/app/api/preipo/route.ts:12` fetches Tessera on every request, `packages/services/src/main.ts:239` accepts `"tessera"` as a quotable price source, `fixtures/registry/registry.devnet.json` lists tKalshi as the only pre-IPO market on devnet, `README.md:110` claims the Tessera bounty. A PreStocks judge reads the devnet app as "built for Tessera, PreStocks pasted in". Verified.
- **Nothing PreStocks is tradeable anywhere a judge can reach.** Zero PreStocks entries in `registry.devnet.json` and `fixtures/devnet-mints.json`; escrow on the real OPENAI and SPACEX mints was proven only on the mainnet fork (`registry.json` escrowProof, 2026-09-17). Verified.
- **The instrument is genuinely new to their ecosystem.** `prestocks.com/ecosystem` lists spot venues, wallets, analytics, perps and leverage, index products; lending is implied by the FAQ. No options, no funded exit, no covered-call product. Supported (fetched 2026-09-20).
- **Our narrative contradicts their own FAQ.** PreStocks: "You can exit through onchain liquidity, even if the company never goes public"; "holding entities that are directly or indirectly invested in the underlying company"; on IPO, convertible with a 9-month deadline after which tokens "expire worthless". Roster: "the assets with no exit at all", "SPV exposure, backed 1:1" (`packages/registry/src/preipo.ts:44-48`), "the price of no exit" (`pre-ipo/page.tsx:99`). And the spread is two-way: today SPACEX trades 23.5 percent below its mark, OPENAI 16 percent above, NEURALINK 33 percent above. Verified (FAQ chunk fetched; API fetched).
- **The vault cannot roll on a fee mint (live bug).** `vault.rs:519` adds the gross deposit to `locked_raw`; `book.rs:42` credits net; `vault.rs:569` and `:622` subtract net; `vault.rs:342` requires zero. The devnet tKalshi vault, decoded live, holds a 120,181,000 raw residual (its three rolls all predate its first quote), so its roll due 2026-09-20 21:00 UTC will be refused. Verified on chain by two skeptics.
- **Pre-IPO pricing is not defensible today.** `main.ts:119` asks Benchmarks for `Crypto.<SYMBOL>/USD`, which does not exist for PreStocks names, so vol is the 0.35 floor (`benchmarks.ts:66-69`); the fork's stored SPACEX ticks range 8.4 percent in six hours. `main.ts:220` applies the NYSE session multiplier to a token with no session. `decideAsk` (`model.ts:65-78`) has no fee term; the landing line "The 0.2% fee priced into the strike" (`sections.tsx:320`) is false, and the fee is 50 bps on PreStocks. `docs/PRICING.md:16-17` claims a marks-based vol source that does not exist in code. Verified.
- **Floors are the exit and they are off.** `create_series.rs:79-80` refuses Put series on fee mints. The put exercise path (`exercise.rs:88-92`) already pays the holder on what arrived, but `:97-98` assign writers the full `lots6`, so lifting the guard alone would short the last writer to settle (`settle.rs:118` caps at the vault balance). The exact fix is a gross-up: the holder delivers `raw + TransferFeeConfig::calculate_inverse_epoch_fee(epoch, raw)` (`spl-token-2022-interface-2.1.0/src/extension/transfer_fee/mod.rs:160`, ceil division guarantees `arrived >= raw`), `require!(arrived >= raw)`, no other counter changes. Verified by three skeptics against the crate source.

## 3. Steelman of the rejected options

**Keep Tessera and enter both bounties.** Strongest case: Tessera's redemption terms (four preconditions, no deadline, forfeiture) are the purest form of "no exit", the 10,900-holder figure is real, and the Tessera entry is already the more complete one (a live devnet market, a passing fee round-trip test, a dedicated explainer). One repo serving two issuers is also the honest shape of a venue. Why we still pass: the PreStocks clause is written as ineligibility, not a ranking penalty, and Tessera is on every runtime surface, so a lenient reading has nothing to hold onto. You have already said Tessera can go. The thesis survives on PreStocks alone and arguably sharpens: Tessera publishes no token price (`preipo.ts:27`), so a Tessera contract is priced off a mark nobody trades at, while PreStocks gives a traded price, a signed spread you can put a number on, and a Jupiter route to exercise into.

**Skip Floors, ship Gaps and the vault only.** Strongest case: it is a day of program work and a redeploy on a week we cannot afford to lose; a Floor that shorts writers is worse than no Floor; the covered-call vault is the proposition depositors actually accept (CLAUDE.md Part 3 section 1). Why we still attempt it: the Floor is the only Roster product that is an exit, it is what every piece of First Print copy promises, and the fix is small and exact. The hard stop is the hedge.

**List all eight PreStocks tokens.** Strongest case: breadth reads as "best use of PreStocks" and the API makes it cheap. Why not first: only OPENAI and SPACEX have a mainnet inspection and escrow proof (`docs/ELIGIBILITY.md:37-38`); the other six would be listed on inspection of a replica, and eight more markets on a free devnet RPC is an unmeasured load. Do two first; add six only if the Floor is abandoned and the RPC holds.

## 4. Assumptions and falsifiers

- The organisers apply the clause as written. Falsifier: a PreStocks reply saying multi-issuer venues are fine; then keep Tessera on a branch and re-enter it for its own bounty.
- The PreStocks mints' hook slot stays null. `registry.json` shows `transferHook: null` with authority `WV9PJN7X…`; `create_market.rs:84` snapshots the hook at listing and never re-reads. Falsifier: the issuer sets a hook program; every vault transfer then fails at the CPI. Mitigation for the doc: say so in the rights profile.
- `calculate_inverse_epoch_fee` rounds so that `arrived >= raw` on every amount; assert it in the fork test, do not assume it.
- A 15 s API poll of `tokenPrice` is a usable reference. OPENAI moved 1 percent between two polls two minutes apart; the vault's 2,500 bps mark band (`vault.rs:344-348`) can refuse a roll after a real pre-IPO move. Falsifier: a refused roll freezing withdrawals in the demo; widen the band or document the fallback before the video.

## 5. Open questions for you

1. Approve the order: removal, replicas and vault, PreStocks desk, the three honesty fixes, then the Floor attempt with the Sep 22 noon stop.
2. Two markets (OPENAI, SPACEX) or all eight? Recommendation: two, then six if time remains.
3. The devnet tKalshi market cannot be deleted on chain (no `close_market`; `update_market(listed=false)` only). Its Solscan links leave the README; the accounts remain visible to anyone who looks. Acceptable?
4. Devnet SOL: the deployer holds 12.39 SOL; a program upgrade buffer is about 5 SOL (refunded), two markets with grids and vaults about 1 SOL. Top up before listing eight.

## 6. Grounded: the removal set (three skeptics agreed the short list was wrong)

Runtime and product: `packages/registry/src/preipo.ts:5,23-28,38-43`; `apps/web/src/app/api/preipo/route.ts:2,12,16`; `packages/services/src/registry.ts:86-101`, `main.ts:46,56,151,239`; `apps/web/src/app/(app)/pre-ipo/page.tsx:15,20,54,60,94-97,103,115`, `pre-ipo/[symbol]/page.tsx`; `apps/web/src/app/(app)/markets/[symbol]/page.tsx:84,197`; `apps/web/src/app/(app)/ask/page.tsx:21`; `apps/web/src/components/landing/sections.tsx:82,150,319-320,328,402,408`, `sources.ts:11-12`, `site-chrome.tsx:49`; wrapper unions `packages/registry/src/registry.ts:24`, `jupiter.ts:23`, `apps/web/src/lib/services.ts:20`, `model.ts:31`, `roster-data.ts:198`.
Devnet and fixtures: `scripts/devnet-mints.ts:42,50,107-165`, `scripts/devnet-registry.ts:13,37,44,62`, `fixtures/devnet-mints.json`, `fixtures/registry/registry.devnet.json`; on chain, `update_market(listed=false)` on `HzNC1qYMknyDQxb4Yu7QjtwsTrFqCQyBEeWZMhPC3iHj`.
Mainnet registry and docs that describe current state: `fixtures/registry/registry.json:1374-1451`, `scripts/eligibility.ts:50-56`, `docs/ELIGIBILITY.md:35-36`, `docs/DEVNET.md:15,72`, `docs/PRICING.md:6`, `README.md:60,67-68,101,110`.
Tests: `tests/e2e/p4-first-print.test.ts:22,30,132` is rewritten against OPENAI, not deleted; it is the only fee round-trip proof.
History left as history: `docs/BUILD_LOG.md`, `docs/PLAN.md`, `docs/DECISIONS.md`, `docs/RECONCILIATION.md`, `CLAUDE.md`, `fixtures/probes/tessera_*.json`.

## 7. Build plan (submission cut, Sep 21 to 23)

| Step | What | Files | Gate |
| --- | --- | --- | --- |
| A | Tessera out of every runtime surface; tKalshi unlisted on devnet | section 6 | grep for tessera returns history only; `/pre-ipo` renders 8 PreStocks cards |
| B | PreStocks replicas with the xStock extension set plus 50 bps fee and the live multiplier read from mainnet; registry, list, quotes, covered-call vaults on OPENAI and SPACEX | `scripts/devnet-mints.ts`, `devnet-registry.ts`, `devnet-vaults.ts` | a Gap bought and sold back on OPENAI in the browser; `/pre-ipo` shows both listed |
| C | Vault residual fix: credit `locked_raw` with what arrived; fork test on a fee mint rolls twice | `vault.rs:519`, `programs/roster_finance/tests/vault.rs` | tKalshi and OPENAI vaults roll after quoting |
| D | Pricing honesty: pre-IPO vol from stored marks with an 80 to 100 percent interim floor and `volSource` shown; constant wide spread for markets with no session instead of `sessionAt`; fee in `decideAsk` and in epoch P&L; `/v1/basis` carries token-vs-mark in bps labelled as a premium or discount to the issuer mark, never fed to the 300 bps breaker; `docs/PRICING.md` matched to code | `main.ts:119,220,221`, `model.ts:65`, `vault-quoter.ts:63`, `benchmarks.ts` | the OPENAI ticket shows vol source, fee and spread; PRICING.md has no claim the code does not make |
| E | PreStocks desk: 8 cards with logo, description, mark, token price, signed two-way spread, `impliedValuation` vs `markValuation`, `supply`, 50 bps fee, verdict, live term line; PreStocks' own terms on every ticket (onchain exit any time, IPO conversion with a 9-month deadline, M&A resolution, no ownership or voting or dividend rights); landing First Print rewritten with live figures, no hard-coded prices | `preipo.ts:33-34`, `route.ts`, `pre-ipo/*`, `sections.tsx:316-345` | copy lint passes; no "no exit", no "discount" as a one-way word |
| F | Fee-inclusive Floors: gross-up in the Put branch, guard removed, quoter and vault allow puts, Manage shows gross delivery; fork test reconciled to the unit; devnet upgrade | `exercise.rs:85-93`, `create_series.rs:80`, `quoter.ts:101`, `devnet-vaults.ts:42`, tests | green by Sep 22 12:00 UTC or cut, with the copy reverted to Gaps |
| G | README, `docs/ELIGIBILITY.md`, `docs/DEVNET.md`, the "what is live" table naming a PreStocks series; Ask pills that resolve | | a judge verifies every live claim in one click |

## 8. Evidence summary

10 verified, 3 supported, 2 unverified (organisers' reading of the clause; devnet RPC load at eight markets), 0 contradicted.

> Cross-tier verification reduces instance- and tier-level error correlation but not shared-lineage blind spots. Treat cross-tier survival as weaker evidence than grounding.

## Telemetry
- divergence: 0.71 (evidence 0.85, conclusion 0.50) | threshold 0.30 UNCALIBRATED
- grounding: n/a
- models: draft=opus · skeptics=2x-opus+1x-sonnet (cross-tier; version axis unavailable)
- claims: C1-integrated grounded · C1-removal-set contradicted (3/3 skeptics), replaced by section 6 · C2 grounded · C3 grounded (on-chain decode by two skeptics) · C4 grounded · ecosystem-gap supported (web) · FAQ-contradiction grounded (chunk fetched)
- fleet: 6 lenses + 3 skeptics · token-multiple vs single-pass ≈ 9x
