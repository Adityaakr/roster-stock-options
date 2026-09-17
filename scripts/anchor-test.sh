#!/usr/bin/env bash
# Program tests: the litesvm suite in Rust (hermetic, no RPC). The fork lifecycle lives in tests/e2e (TypeScript).
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.avm/bin:$HOME/.cargo/bin:$PATH"
if [ ! -f target/deploy/roster_finance.so ]; then
  echo "anchor tests: target/deploy/roster_finance.so missing, run pnpm anchor:build first" >&2
  exit 1
fi
cargo test --release -p roster_finance -- --nocapture 2>&1 | grep -E "^test |test result|panicked|error" || true
cargo test --release -p roster_finance >/dev/null 2>&1
