# Seeding (P5, mainnet)

Nothing in this file has been executed. It is the proposal the brief asks for (Part 2 addendum I and J): per-market treasury figures and caps for the first mainnet week. **Nothing moves until the figures below are approved in writing here, by the operator, with the deployer key, multisig and treasury named in `.env`.** The build stops at this line.

## What the deploy does, in order

1. `DEPLOY_CLUSTER=<mainnet RPC> DEPLOY_MAINNET_APPROVED=1 pnpm anchor:deploy` with `DEPLOYER_KEYPAIR` (the script refuses mainnet without the flag). Program id stays `FJUdsdmxAp3zAwZBg3ai34xzeCBDobnH1XDarvVa7uFV` (the keypair in `target/deploy/roster_finance-keypair.json` must be the one that generated it; it is not in git).
2. Transfer the upgrade authority to `MULTISIG` immediately: `solana program set-upgrade-authority FJUd… --new-upgrade-authority $MULTISIG --skip-new-upgrade-authority-signer-check` from the deployer. Verify with `solana program show FJUd…` before anything else happens. `docs/UPGRADE.md` is the runbook from then on.
3. `init_protocol` from the deployer with `pause_authority = KEEPER`, `treasury = TREASURY`, `fee_bps = 10`, `integrator_share_bps = 3000`, `keeper_fee_usdc = 2_000_000`, `grace_secs = 3600`. Then `update_protocol` to move `authority` to the multisig (the instruction exists; the SDK builder is `updateProtocol`).
4. `pnpm registry` against the mainnet RPC (read-only), then `pnpm list-markets NVDAx TSLAx SPYx` from the authority: three `create_market` transactions at Tier 1 with the grids below and, per market, the escrow proof (one series, one lot in, one lot out) paid from the deployer's own inventory. Rent per series is in `docs/RENT.md`; the proof's series closes after its expiry.
5. Fund the quoter wallet as below. Start `pnpm services` with `RPC_URL` (Helius), `PYTH_CORE_API_KEY`, `LAUNCH_SYMBOLS=NVDAx,TSLAx,SPYx`. The quoter posts to the two nearest Fridays plus the `EXTRA_EXPIRIES` the operator sets (the brief names a Monday 16:00 NY expiry for the first print).
6. Watch one full expiry: settle and close by the keeper, fee vault reconciled to the sum of `Bought.fee` events, treasury P&L published on the roster.

## Proposed figures (to approve or amend)

| Market | Tier | Quoter inventory (tokens) | Quoter USDC | `max_lots6` per buy | `max_writer_lots6` | `max_live_series` | Strike step | Comment |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| NVDAx | 1 | 150 | 25,000 | 50 lots | 100 lots | 12 | 1 USDC | about 27k USD of Gap collateral at today's mark, Floors to 25k |
| TSLAx | 1 | 60 | 20,000 | 20 lots | 50 lots | 12 | 1 USDC | |
| SPYx | 1 | 30 | 20,000 | 20 lots | 50 lots | 12 | 5 USDC | |
| Tier 2 (8 names) | 2 | 0 | 0 | 5 lots | 10 lots | 6 | per `list-markets` | listed after the first Tier 1 expiry settles cleanly (P10) |
| Pre-IPO (4 names) | 2 | 0 | 0 | 2 lots | 5 lots | 2 | per `list-markets` | listed after Tier 2 |

Quoter ask size per series: 10 lots at Tier 1 (`DEFAULT_QUOTER.lotsPerSeries` is 50 on the fork; set `QUOTER_LOTS_PER_SERIES=10` for the first week). Worst case for the treasury in week one is the sum of Floor collateral (65k USDC) plus the tokens written as Gaps; a market that gaps through every strike assigns all of it at the strike, which is the stated risk of a market maker, not a loss of principal at the mark.

## Keys and accounts the operator must provide

- `DEPLOYER_KEYPAIR`: pays deploy rent (about 5 SOL for a 700 KB program) and the first transactions; holds the quoter's inventory only if `QUOTER_KEYPAIR` is not set separately (set it).
- `MULTISIG`: upgrade authority and protocol authority after step 3.
- `TREASURY`: the USDC account owner `withdraw_fees` pays to; the only destination the program allows.
- `KEEPER_KEYPAIR`: pause authority; pays keeper transaction fees; auto-exercise fees come from the fee vault.
- `QUOTER_KEYPAIR`: holds the inventory in the table.
- `PYTH_CORE_API_KEY`: without it the quoter does not price on mainnet (the services refuse the issuer-quote fallback off the fork).
- `HELIUS_API_KEY` or another RPC with `getProgramAccounts` and `getSignaturesForAddress`.

## Approval

Operator: ____________________  Date: ____________  Figures approved as written / amended above: ______
