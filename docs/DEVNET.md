# Devnet: a complete, public version of the product

The fork proves the product against the real chain. Devnet makes it reachable: anyone with a wallet can open the app,
take test funds and trade, with no local processes. This is the runbook and the honesty list.

## The one thing devnet cannot have

xStocks, Tessera and PreStocks tokens exist on mainnet only. A devnet deployment has nothing real to escrow, so every
market here trades a **replica mint** created by `pnpm devnet:mints`. A replica reproduces what the program has to
handle, not the issuer's branding:

| Replica | Reproduces |
| --- | --- |
| NVDAx, TSLAx, SPYx, AAPLx, MSFTx, GOOGLx | Token-2022, 8 decimals, ScaledUiAmountConfig at the issuer's live multiplier, PausableConfig, DefaultAccountState, PermanentDelegate, a transfer-hook slot with an all-zero program id |
| tKalshi | Token-2022, 9 decimals, TransferFeeConfig at 20 bps, so the First Print fee path is the same code |
| Quote mint | Plain SPL Token, 6 decimals, as USDC is |

Every escrow, exercise, settle and close path is therefore the same code on devnet as on mainnet, and the wrapper
rights the app prints for a replica are the rights the real mint carries. The app says "devnet replica" wherever a
market is named, and the cluster label is in the header on every screen.

**The marks are real.** A replica is priced from its mainnet counterpart through the same routed price and issuer
quote the fork uses, so the strikes, premiums and break-evens on screen are the market's numbers.

## Prices without a Pyth subscription

Checked 2026-09-19: Hermes answers `401 unauthorized` with no key on both `hermes.pyth.network` and
`pyth.dourolabs.app`, and no sponsored on-chain price-feed account exists for the feeds we use (the receiver PDAs for
`Crypto.NVDAX/USD`, `Equity.US.NVDA` and even `Crypto.SOL/USD` are absent on mainnet). So without a paid grant there
is no Pyth read at all, on any cluster.

What the product uses instead, all keyless:

| Need | Source | Effect of not having Pyth |
| --- | --- | --- |
| Mark per market | Jupiter routed price of the mainnet mint, then the xStocks issuer quote | none for the product; the mark is a real traded price rather than an aggregate with a confidence interval |
| Realised volatility for the quoter | the marks the services record every tick, per mint, in the indexer | the first hours after a fresh start use the published floor, and the app says so |
| Share reference for the basis | the issuer's own quote | the token-versus-share basis is a wrapper-versus-issuer number, not token-versus-exchange; the app labels it |
| In-the-money check for `auto_exercise` | **nothing** | auto-exercise stays off on devnet. The program requires a verifiable on-chain price update and will not act without one. Contracts are American, so every holder can still exercise at any time; only the convenience is missing, and the Manage screen says so per position |

The later path to restore auto-exercise without a subscription is a Switchboard On-Demand feed built on the issuer
quote: you pay transaction fees, not a plan. That is a program change (a second accepted update format) and is not in
the devnet build.

## Funding

One wallet holds every role on devnet (deployer, treasury, keeper, quoter). On mainnet these must be separate, and
the upgrade authority must be a multisig; devnet is deliberately simpler.

    deployer / treasury / keeper / quoter: AuLvFjWWU2EVcoRC9oCVDZL3H2wkqVLdVsyKMhDF7EqD

About 8 SOL covers the program (roughly 5 SOL of rent for a 716 KB program), the replica mints, the market and series
accounts, and transaction fees. The public RPC faucet refuses airdrops to this address today
(`requestAirdrop` → internal error), so fund it from `faucet.solana.com` or another devnet faucet.

## Order of operations

    pnpm anchor:build
    DEPLOY_CLUSTER=https://api.devnet.solana.com pnpm anchor:deploy
    pnpm devnet:mints          # replicas and the quote mint, idempotent
    pnpm registry --devnet     # inspects each replica on chain, writes the devnet registry
    pnpm list-markets --devnet # creates the markets and the first grid
    pnpm services              # quoter, keeper, indexer, REST, against devnet

The app reads the services; `NEXT_PUBLIC_CLUSTER=devnet` puts the label in the header and points the wallet at devnet.
