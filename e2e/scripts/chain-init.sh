#!/usr/bin/env bash
# Deploy the local pool and TEN4 programs when their .so files already exist.
# A missing build is a message, not a compile: `npm run program:build` is the owner's step.
# The TEN4 crate is still freightchain_honk. Anchor writes both .so files under programs/target/deploy.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
RPC="${E2E_SOLANA_RPC:-http://127.0.0.1:8899}"
POOL_SO="$ROOT/programs/target/deploy/freightchain_pools.so"
HONK_SO="$ROOT/programs/target/deploy/freightchain_honk.so"
POOL_ID="8No42h2QXb9opgp3pJfNXL2o77o288SsF8o7CwJGCA1p"
HONK_ID="GctCYSHbCnHN8sE1LjUL9cmSpFd5mcVdfaumRcaVWZZx"
if ! command -v solana >/dev/null; then
  echo "solana CLI missing; skip deploy" >&2
  exit 0
fi
deploy_one() {
  local so="$1" id="$2" name="$3"
  if [ ! -f "$so" ]; then
    echo "$name .so missing ($so). Run npm run program:build, then re-run chain-init. Ticket buy stays pending." >&2
    return 0
  fi
  solana program deploy --url "$RPC" --program-id "$id" "$so"
}
deploy_one "$POOL_SO" "$POOL_ID" "pool"
deploy_one "$HONK_SO" "$HONK_ID" "honk"
echo "chain-init done. Initialize Config and a pool with server/scripts/pool-admin.mjs (see B2-ADMIN-04)."
