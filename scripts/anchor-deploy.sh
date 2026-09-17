#!/usr/bin/env bash
# Deploy to the cluster in .env (fork by default). Mainnet deploys are a stop-and-ask step (CLAUDE.md section 0).
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.avm/bin:$HOME/.cargo/bin:$PATH"
if [ -f .env ]; then set -a; . ./.env; set +a; fi
CLUSTER="${DEPLOY_CLUSTER:-http://127.0.0.1:8899}"
WALLET="${DEPLOYER_KEYPAIR:-.keys/deployer.json}"
case "$CLUSTER" in *mainnet*) echo "refusing to deploy to mainnet from this script without DEPLOY_MAINNET_APPROVED=1" >&2; [ "${DEPLOY_MAINNET_APPROVED:-0}" = "1" ] || exit 2;; esac
anchor deploy --provider.cluster "$CLUSTER" --provider.wallet "$WALLET"
