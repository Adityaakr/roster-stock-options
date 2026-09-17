#!/usr/bin/env bash
# Copy the built IDL and its TypeScript types into the SDK package. Run after `anchor build`.
set -euo pipefail
cd "$(dirname "$0")/.."
test -f target/idl/roster_finance.json || { echo "target/idl/roster_finance.json missing, run anchor build first" >&2; exit 1; }
# anchor build regenerates target/deploy/<name>-keypair.json when absent; keep it identical to the committed program keypair.
cp programs/roster_finance/roster_finance-keypair.json target/deploy/roster_finance-keypair.json
mkdir -p packages/sdk/src/idl
cp target/idl/roster_finance.json packages/sdk/src/idl/roster_finance.json
cp target/types/roster_finance.ts packages/sdk/src/idl/roster_finance.ts
echo "idl synced: $(python3 -c "import json;print(json.load(open('target/idl/roster_finance.json'))['address'])")"
