#!/usr/bin/env bash
# Fund the disposable block-2 payer and verify the pool loaded by validator.sh.
# No deployment keys or remote transactions are needed.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
RPC="${E2E_SOLANA_RPC:-http://127.0.0.1:8899}"
node -e 'const u=new URL(process.argv[1]); if(u.protocol!=="http:" || !["127.0.0.1","localhost"].includes(u.hostname) || !u.port || u.username || u.password) throw Error("chain-init requires a loopback validator")' "$RPC"
POOL_ID="8No42h2QXb9opgp3pJfNXL2o77o288SsF8o7CwJGCA1p"
KEYS="${E2E_KEYS_DIR:-$ROOT/tests/e2e/.keys}"
PAYER="$KEYS/payer.json"
PAYER_PUB="$(solana-keygen pubkey "$PAYER")"
solana airdrop --url "$RPC" --keypair "$PAYER" 50 "$PAYER_PUB" >/dev/null
solana program show --url "$RPC" --keypair "$PAYER" "$POOL_ID" >/dev/null
echo "chain-init done: local payer funded and pool loaded"
