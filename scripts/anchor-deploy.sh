#!/usr/bin/env bash
# Deploy to the cluster in .env (fork by default). Mainnet deploys are a stop-and-ask step (CLAUDE.md section 0).
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.avm/bin:$HOME/.cargo/bin:$PATH"
# .env fills in only what the caller's environment leaves unset, and is never executed as shell.
if [ -f .env ]; then
  while IFS='=' read -r k v; do
    case "$k" in ''|\#*) continue;; esac
    [ -n "$v" ] && [ -z "${!k:-}" ] && export "$k=$v"
  done < .env
fi
CLUSTER="${DEPLOY_CLUSTER:-http://127.0.0.1:8899}"
WALLET="${DEPLOYER_KEYPAIR:-.keys/deployer.json}"
# Anything that is not the local fork is a real cluster and needs the written approval flag.
case "$CLUSTER" in http://127.0.0.1:*|http://localhost:*) ;; *) echo "refusing to deploy to $CLUSTER without DEPLOY_MAINNET_APPROVED=1 (docs/SEEDING.md)" >&2; [ "${DEPLOY_MAINNET_APPROVED:-0}" = "1" ] || exit 2;; esac
anchor deploy --provider.cluster "$CLUSTER" --provider.wallet "$WALLET"
