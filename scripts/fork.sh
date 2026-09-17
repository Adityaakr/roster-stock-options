#!/usr/bin/env bash
# Start a surfpool mainnet fork on 127.0.0.1:8899 (real NVDAx, USDC and Pyth accounts available).
# Datasource: FORK_DATASOURCE_URL if set (Helius etc.), else the public mainnet RPC (rate-limits getProgramAccounts;
# nothing here depends on gPA). Fork state is ephemeral: keep this in its own terminal and re-seed after a restart.
set -euo pipefail
cd "$(dirname "$0")/.."
if [ -f .env ]; then set -a; . ./.env; set +a; fi
PORT="${FORK_PORT:-8899}"
WS_PORT="${FORK_WS_PORT:-8900}"
ARGS=(start --no-tui -y --no-deploy --port "$PORT" --ws-port "$WS_PORT")
if [ -n "${FORK_DATASOURCE_URL:-}" ]; then
  ARGS+=(--rpc-url "$FORK_DATASOURCE_URL")
else
  ARGS+=(--network mainnet)
fi
mkdir -p .keys
for k in deployer keeper quoter alice bob; do
  if [ ! -f ".keys/$k.json" ]; then solana-keygen new -o ".keys/$k.json" --no-bip39-passphrase -s >/dev/null; fi
done
ARGS+=(--airdrop-keypair-path .keys/deployer.json)
exec surfpool "${ARGS[@]}"
