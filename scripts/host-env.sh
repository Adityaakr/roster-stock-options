#!/usr/bin/env bash
# Prints the environment for each host, filled from .env and .keys, ready to paste into Railway (services) and
# Vercel (web). Run it locally; it prints secrets, so never commit or share its output.
set -euo pipefail
cd "$(dirname "$0")/.."
get() { grep -E "^$1=" .env 2>/dev/null | head -1 | cut -d= -f2- | sed 's/^"//; s/"$//'; }
key() { tr -d ' \n' < ".keys/$1.json"; }
RPC="$(get DEVNET_RPC_URL)"; [ -n "$RPC" ] || RPC="$(get RPC_URL)"
echo "===== Railway: the services (one service, Dockerfile.services) ====="
echo "RPC_URL=$RPC"
echo "NEXT_PUBLIC_CLUSTER=devnet"
echo "DEPLOYER_SECRET_KEY=$(key deployer)"
echo "QUOTER_SECRET_KEY=$(key quoter)"
echo "KEEPER_SECRET_KEY=$(key keeper)"
echo "TOKENS_XYZ_API_KEY=$(get TOKENS_XYZ_API_KEY)"
echo "PYTH_CORE_API_KEY=$(get PYTH_CORE_API_KEY)"
echo "INDEXER_DB=/data/indexer.sqlite"
echo "SERVICES_TICK_MS=10000"
echo
echo "===== Vercel: the web app (root directory apps/web) ====="
echo "SERVICES_URL=<the Railway public URL, https://...up.railway.app, no trailing slash>"
echo "RPC_URL=$RPC"
echo "NEXT_PUBLIC_CLUSTER=devnet"
echo "DEPLOYER_SECRET_KEY=$(key deployer)"
echo "OPENROUTER_API_KEY=$(get OPENROUTER_API_KEY)"
echo "NEXT_PUBLIC_PRIVY_APP_ID=$(get NEXT_PUBLIC_PRIVY_APP_ID)"
echo "DEVNET_MINTS_JSON=$(tr -d '\n' < fixtures/devnet-mints.json)"
echo "GEO_BLOCKED_COUNTRIES=$(get GEO_BLOCKED_COUNTRIES)"
