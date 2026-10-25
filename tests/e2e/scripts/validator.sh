#!/usr/bin/env bash
# Host solana-test-validator for block 2. Does not pull an image and does not touch devnet.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
RPC_PORT="${E2E_RPC_PORT:-8899}"
LEDGER="${E2E_LEDGER:-$ROOT/tests/e2e/.ledger}"
if ! command -v solana-test-validator >/dev/null; then
  echo "solana-test-validator is not on PATH (Agave, same as docs/spec/pool.md)." >&2
  echo "Block 2 requires it and fails when it is unavailable." >&2
  exit 2
fi
if curl -sf -X POST -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' "http://127.0.0.1:${RPC_PORT}" | grep -q '"ok"'; then
  echo "validator already healthy on :${RPC_PORT}"
  exit 0
fi
# Keys live beside the ledger. --reset wipes the ledger directory and would otherwise replace the upgrade authority before initialize.
KEYS="${E2E_KEYS_DIR:-$ROOT/tests/e2e/.keys}"
mkdir -p "$LEDGER" "$KEYS"
PAYER="$KEYS/payer.json"
if [ ! -f "$PAYER" ]; then
  solana-keygen new -s --no-bip39-passphrase -o "$PAYER" >/dev/null
fi
POOL_SO="$ROOT/backend/programs/target/deploy/freightchain_pools.so"
POOL_ID="8No42h2QXb9opgp3pJfNXL2o77o288SsF8o7CwJGCA1p"
# bash 3.2 treats "${empty[@]}" as unbound under set -u. Always start from a non-empty argv.
CMD=(solana-test-validator --ledger "$LEDGER" --reset --quiet --bind-address 127.0.0.1 --rpc-port "$RPC_PORT" --faucet-port "${E2E_FAUCET_PORT:-$((RPC_PORT + 1))}")
if [ -n "${E2E_GOSSIP_PORT:-}" ]; then
  DYN=$(( RPC_PORT < 40000 ? RPC_PORT + 2000 : RPC_PORT - 2000 ))
  CMD+=(--gossip-port "$E2E_GOSSIP_PORT" --dynamic-port-range "$DYN-$((DYN + 30))")
fi
if [ -f "$POOL_SO" ]; then
  # `solana program deploy` rejects this .so (SBPF version). The localnet suite loads it with the validator instead.
  CMD+=(--upgradeable-program "$POOL_ID" "$POOL_SO" "$(solana-keygen pubkey "$PAYER")")
else
  echo "pool program build missing: $POOL_SO" >&2
  exit 1
fi
"${CMD[@]}" > "$LEDGER/validator.log" 2>&1 &
echo $! > "$LEDGER/validator.pid"
for _ in $(seq 1 60); do
  curl -sf -X POST -H 'content-type: application/json' \
    -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' "http://127.0.0.1:${RPC_PORT}" | grep -q '"ok"' && exit 0
  sleep 1
done
echo "validator did not become healthy; see $LEDGER/validator.log" >&2
exit 1
