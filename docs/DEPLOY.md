# Deploying Roster Finance

Two processes, because they are two different shapes. The **web app** is stateless and belongs on Vercel or anything
that runs Next. The **services** hold a tick loop, a keypair and a SQLite file, so they need one always-on host
(Railway, Fly, Render, a VM). The app reads the services over `SERVICES_URL`; nothing else connects them.

Nothing below needs a file on the host: every key travels as an environment variable.

## 1. The services

Deploy `Dockerfile.services`, or run `pnpm tsx packages/services/src/main.ts` under a process manager. It listens on
`$PORT` (`0.0.0.0` when the host sets one) and answers `/v1/health`.

| Variable | Value |
| --- | --- |
| `RPC_URL` | the cluster's RPC, with the provider key. Never published to a page |
| `NEXT_PUBLIC_CLUSTER` | `devnet` or `mainnet`; the services label every response with it |
| `DEPLOYER_SECRET_KEY` | the 64 byte array `solana-keygen` writes. On devnet this one wallet quotes and cranks |
| `QUOTER_SECRET_KEY`, `KEEPER_SECRET_KEY` | separate keys on mainnet, where the quoter holds only what may be quoted |
| `TOKENS_XYZ_API_KEY` | the mark, 24 hour change and holder count per market |
| `PYTH_CORE_API_KEY` | optional. With a grant covering the feeds, the quoter prices off Pyth instead of the routed price |
| `INDEXER_DB` | a path on a persistent volume. A fresh file is rebuilt from the chain's events, so losing it costs a minute, not data |
| `SERVICES_TICK_MS` | `10000` is comfortable; every tick prices, quotes and cranks every market |

## 2. The web app

`pnpm build` at the repo root; the project root for the host is `apps/web`.

| Variable | Value |
| --- | --- |
| `SERVICES_URL` | the services' public URL. The app calls it from the server only |
| `RPC_URL` | the same RPC as the services. Used to build and relay transactions, and by `/api/rpc` |
| `RPC_FALLBACK_URLS` | comma-separated keyed endpoints tried when `RPC_URL` refuses. **Set at least one on both services.** The public cluster endpoint is the last resort and throttles account reads by hanging, so it cannot carry the app alone. `HELIUS_API_KEY` is added to the chain automatically when set. An endpoint that refuses for a spent quota, billing or a bad key is skipped for ten minutes |
| `NEXT_PUBLIC_CLUSTER` | `devnet` or `mainnet`. On devnet it also offers the faucet |
| `NEXT_PUBLIC_PRIVY_APP_ID` | the Privy app id. Email login and Solana wallets (Phantom, Solflare, Backpack, detected wallets, WalletConnect) through Privy's modal. In the Privy dashboard enable Email and Wallet, Solana, and add the site's domain |
| `NEXT_PUBLIC_BURNER_WALLET` | leave unset. `1` adds a throwaway burner wallet for the browser journeys on a test cluster |
| `NEXT_PUBLIC_RPC_URL` | **leave empty.** Set it only for a public endpoint with no key in it; empty means the browser reads through `/api/rpc` and the provider key stays on the server |
| `DEPLOYER_SECRET_KEY` | devnet only, for the faucet's mint authority. Never set it on a mainnet deployment |
| `DEVNET_MINTS_JSON` | devnet only, the contents of `fixtures/devnet-mints.json`, if the deployment does not ship the file |
| `GEO_BLOCKED_COUNTRIES` | `US,GB,CA,AU` at minimum. **The gate only works behind an edge that sets a country header** (`x-vercel-ip-country` or `cf-ipcountry`); with no header nothing is blocked. **The current deployment serves the web app from Railway, which sets no such header: put Cloudflare in front, or the gate is inert** |

## 3. After the first deploy

- `GET /v1/health` on the services: `ok`, the cluster, the program id, and `lastTick` moving.
- `GET /api/cluster` on the app: the same cluster and `programDeployed: true`.
- Open the app, connect a wallet, take the faucet, buy the cheapest Gap. That is the whole product in one minute.
- Watch `[indexer] pull … ms` in the services log: a pull slower than two seconds is the lag signal to alert on.

## 4. What must be true before mainnet

The upgrade authority is a Squads multisig, the quoter and keeper hold separate keys, the treasury size is approved in
`docs/SEEDING.md`, and the geo gate sits behind an edge that sets the header. None of that is code; all of it is
`docs/OPERATOR.md`.
