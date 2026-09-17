# Operator inputs

The external inputs the build cannot obtain on its own (Part 2 section 1). Secrets go in `.env` at the repo root (git-ignored); this file records what is present, what is missing, and which phase each item blocks. Updated 2026-09-17.

## Status

| Item | Where | Format | Blocks | State |
| --- | --- | --- | --- | --- |
| `PYTH_CORE_API_KEY` | Pyth developer portal | bearer token in `.env` | P0 (feed reads, `docs/FEEDS.md` prices), P2 | **missing** |
| `PYTH_PRO_API_KEY` | Pyth Pro application | bearer token in `.env` | nothing; unlocks `.PRE` `.POST` `.ON` | missing, optional |
| `TOKENS_XYZ_API_KEY` | tokens.xyz Assets API button | `x-api-key` in `.env` | P7 registry (curated lists, variants) | **missing** |
| `HELIUS_API_KEY` or `FORK_DATASOURCE_URL` | Helius or another archival + websocket RPC | URL in `.env` | P0 fork upstream (public mainnet RPC is the fallback and rate-limits `getProgramAccounts`), everything on mainnet | missing; fallback in use |
| `JUPITER_API_KEY` | portal.jup.ag, if the tier requires it | `.env` | P4 Protected Buy | missing; checked at P4 |
| `DATABASE_URL` | Neon, Supabase or local Postgres | connection string in `.env` | P2 indexer (SQLite fallback on the fork) | missing; SQLite fallback |
| Hosting + DNS | Vercel project, `roster.finance` | project id | P6, public launch | missing |
| `SENTRY_DSN`, metrics endpoint | Sentry, Grafana Cloud | `.env` | P8 | missing, not blocking before P8 |
| Dialect Blinks registration | dial.to | domain registration | P9 | missing, not blocking before P9 |
| Deployer keypair, 8 to 12 SOL | `solana-keygen` on the operator's machine | path in `.env` `DEPLOYER_KEYPAIR` | P5 | missing |
| Squads v4 multisig (2+ signers, timelock) | app.squads.so | address in `.env` `MULTISIG` | P5 | missing |
| Treasury wallet (Squads vault) with USDC and launch-set underlyings | Squads | address | P5 seeding | missing |
| Keeper hot wallet, small SOL | `solana-keygen` | path in `.env` `KEEPER_KEYPAIR` | P2 on mainnet only; the fork funds its own | missing |
| Quoter hot wallet | `solana-keygen` | path in `.env` `QUOTER_KEYPAIR` | P5 | missing |

## Decisions only the operator can make

| Decision | Default the build assumes until told otherwise | Recorded where |
| --- | --- | --- |
| Launch set and seed sizes | Part 2 section 2 launch set; seed sizes proposed in `docs/SEEDING.md` at P5, nothing moves until approved in writing there | `docs/SEEDING.md` |
| Fee schedule | 10 bps taker, 30% of it to an integrator when a referrer is present | `set_fee_schedule` at deploy |
| Geo policy | block US, UK, Canada, Australia at minimum (mirrors the wrappers) | `apps/web` geo gate config |
| Legal entity and contact | placeholder text "Roster Finance" and no address until supplied; the terms page says so | `apps/web` docs pages |
| Ondo wrappers | excluded, shown as `restricted_wrapper` with the allowlist reason | registry verdicts |
| Cut line (addendum B) | submission build = P0, P1, P2, P3, P4, P7 (Tier 1 and 2), P6; P5 at small size; everything else deferred and absent from the UI | this file |

## Stop rule

The build proceeds on every step that is not blocked. At the first blocked step it stops with a one-line request naming the missing item, per Part 2 section 1.

## The web app

- `SERVICES_URL` (default `http://127.0.0.1:8787`): the services process the app reads. Unreachable means the fixture cluster, and every screen says so.
- `RPC_URL`: the RPC the app builds and submits transactions through (CLAUDE.md 4.4). The key never reaches the browser.
- `GEO_BLOCKED_COUNTRIES` (default `US`): ISO codes refused by `apps/web/src/proxy.ts` on the app and transaction routes with a plain page and HTTP 451. The country comes from the edge in front of the app (`x-vercel-ip-country` or `cf-ipcountry`); **with no such header nothing is blocked**, so a deployment without an edge that sets one has no geo gate. The marketing, risk, fees, terms and privacy pages are never blocked.
- `NEXT_PUBLIC_CLUSTER=fork` adds a throwaway burner wallet to the wallet list so the flow can be driven without an extension. Never set it on a real cluster.
- `/api/tx/send` relays only a transaction whose message this server built in the last ten minutes (`/api/tx/build` or a Protected Buy build), whose top-level programs are the Roster program and the programs a build emits, and whose block-height bound is near the chain's. The issued-message set is in memory per instance; run one instance, or put it in a shared store before running several.
