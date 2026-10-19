#!/usr/bin/env bash
# Host solana-test-validator for block 2. Does not pull an image and does not touch devnet.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
RPC_PORT="${E2E_RPC_PORT:-8899}"
LEDGER="${E2E_LEDGER:-$ROOT/e2e/.ledger}"
if ! command -v solana-test-validator >/dev/null; then
  echo "solana-test-validator is not on PATH (Agave, same as docs/spec/pool.md)." >&2
  echo "Block 2 chain checks will skip until it is installed. Postgres and the API still start." >&2
  exit 2
fi
if curl -sf -X POST -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' "http://127.0.0.1:${RPC_PORT}" | grep -q '"ok"'; then
  echo "validator already healthy on :${RPC_PORT}"
  exit 0
fi
mkdir -p "$LEDGER"
solana-test-validator --ledger "$LEDGER" --reset --quiet --bind-address 127.0.0.1 \
  --rpc-port "$RPC_PORT" --faucet-port "$((RPC_PORT + 1))" > "$LEDGER/validator.log" 2>&1 &
echo $! > "$LEDGER/validator.pid"
for _ in $(seq 1 60); do
  curl -sf -X POST -H 'content-type: application/json' \
    -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' "http://127.0.0.1:${RPC_PORT}" | grep -q '"ok"' && exit 0
  sleep 1
done
echo "validator did not become healthy; see $LEDGER/validator.log" >&2
exit 1
