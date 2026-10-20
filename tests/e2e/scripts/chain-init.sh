#!/usr/bin/env bash
# Deploy the local pool and TEN4 programs when their .so files already exist.
# A missing build is a message, not a compile: `npm run program:build` is the owner's step.
# The TEN4 crate is still freightchain_honk. Anchor writes both .so files under programs/target/deploy.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
RPC="${E2E_SOLANA_RPC:-http://127.0.0.1:8899}"
POOL_SO="$ROOT/backend/programs/target/deploy/freightchain_pools.so"
HONK_SO="$ROOT/backend/programs/target/deploy/freightchain_honk.so"
POOL_ID="8No42h2QXb9opgp3pJfNXL2o77o288SsF8o7CwJGCA1p"
HONK_ID="GctCYSHbCnHN8sE1LjUL9cmSpFd5mcVdfaumRcaVWZZx"
if ! command -v solana >/dev/null; then
  echo "solana CLI missing; skip deploy" >&2
  exit 0
fi
# Explicit payer. Never the global solana CLI id.
KEYS="${E2E_LEDGER:-$ROOT/tests/e2e/.ledger}/keys"
mkdir -p "$KEYS"
PAYER="$KEYS/payer.json"
if [ ! -f "$PAYER" ]; then
  solana-keygen new -s --no-bip39-passphrase -o "$PAYER" >/dev/null
fi
PAYER_PUB="$(solana-keygen pubkey "$PAYER")"
solana airdrop --url "$RPC" --keypair "$PAYER" 50 "$PAYER_PUB" >/dev/null || true
MAIN="$(cd "$(dirname "$(git -C "$ROOT" rev-parse --path-format=absolute --git-common-dir)")" && pwd)"
POOL_KEY="$MAIN/infra/deploy/secrets/devnet/program-id.json"
deploy_one() {
  local so="$1" id="$2" name="$3" key="$4"
  if [ ! -f "$so" ]; then
    echo "$name .so missing ($so). Run npm run program:build, then re-run chain-init." >&2
    return 0
  fi
  if [ ! -f "$key" ]; then
    echo "$name program keypair missing; not deployed." >&2
    return 0
  fi
  solana program deploy --url "$RPC" --keypair "$PAYER" --program-id "$key" "$so"
}
deploy_one "$POOL_SO" "$POOL_ID" "pool" "$POOL_KEY"
# The TEN4 program id keypair is not in this checkout. Skip rather than deploy under another id.
if [ -f "$KEYS/honk-keypair.json" ]; then
  deploy_one "$HONK_SO" "$HONK_ID" "honk" "$KEYS/honk-keypair.json"
else
  echo "honk program keypair not in the ledger keys; TEN4 stays undeployed on this validator." >&2
fi
echo "chain-init done. payer $PAYER_PUB"
