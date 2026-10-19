#!/usr/bin/env bash
# Local code e2e. Block 1: Postgres + Redis + API, chain adapters off.
# Block 2: the same plus a host validator when solana-test-validator exists.
# Does not deploy to production and does not start Chrome.
set -euo pipefail
BLOCK="${1:-1}"
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
PORT="${E2E_PORT:-$(node -e 'const s=require("net").createServer();s.listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})')}"
BASE="http://127.0.0.1:${PORT}"
export DATABASE_URL="postgresql://freight:freight_dev_password@127.0.0.1:15434/freightchain_e2e"
export REDIS_URL="redis://:freight_dev_redis@127.0.0.1:16381"
export JWT_SECRET="freightchain-e2e-jwt-secret-32chars-min"
export ADMIN_JWT_SECRET="freightchain-e2e-admin-jwt-secret-32ch"
export ADMIN_WALLETS="64GheTAtcPoz6Re29qwWxzKU2gtZCTF6gC1NBPVgaL2N"
export NODE_ENV=development
export PORT
export APP_DOMAIN="127.0.0.1:${PORT}"
export APP_ORIGIN="$BASE"
export SOL_USD=100
export FREE_RIDE_SECONDS=180
export POSTHOG_ENABLED=0
export WATCH_INTERVAL_MS=0
export CRANK_INTERVAL_MS=0
export PAYOUT_INTERVAL_MS=0
export THROTTLE_LIMIT=10000
export THROTTLE_AUTH_LIMIT=10000
export THROTTLE_AUTH_RPS=1000
export SNS_RPC="http://127.0.0.1:9"
unset HONK_PROGRAM_ID TICKET_PROGRAM_ID
if [ "$BLOCK" = "2" ]; then
  export PAYMENT_MODE=program
  export TICKET_PROGRAM_ID="8No42h2QXb9opgp3pJfNXL2o77o288SsF8o7CwJGCA1p"
  export HONK_PROGRAM_ID="GctCYSHbCnHN8sE1LjUL9cmSpFd5mcVdfaumRcaVWZZx"
  export SOLANA_RPC="${E2E_SOLANA_RPC:-http://127.0.0.1:8899}"
else
  export PAYMENT_MODE=transfer
  export SOLANA_RPC="http://127.0.0.1:9"
  unset E2E_SOLANA_RPC
fi

SERVER_PID=""
stop_server() {
  if [ -n "$SERVER_PID" ]; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
    SERVER_PID=""
  fi
  rm -f "$ROOT/tests/e2e/.server.pid"
}
trap stop_server EXIT

cd "$ROOT"
docker compose -f infra/docker-compose.e2e.yml up -d --wait
if [ ! -f backend/server/dist/main.js ]; then
  npm run server:build
fi
(cd backend/server && npx prisma migrate deploy)

if [ "$BLOCK" = "2" ]; then
  set +e
  bash "$ROOT/tests/e2e/scripts/validator.sh"
  vrc=$?
  set -e
  if [ "$vrc" -eq 0 ]; then
    export E2E_SOLANA_RPC="$SOLANA_RPC" E2E_REQUIRE_CHAIN=1
    bash "$ROOT/tests/e2e/scripts/chain-init.sh" || true
  else
    unset E2E_SOLANA_RPC E2E_REQUIRE_CHAIN
    echo "validator not used (exit $vrc); chain-only checks skip"
  fi
fi

if curl -sf "$BASE/api/health/live" >/dev/null; then
  echo "API already on $BASE"
else
  (cd backend/server && exec node dist/main.js > "$ROOT/tests/e2e/.server.log" 2>&1) &
  SERVER_PID=$!
  echo "$SERVER_PID" > "$ROOT/tests/e2e/.server.pid"
  for _ in $(seq 1 60); do
    curl -sf "$BASE/api/health/live" >/dev/null && break
    sleep 1
  done
  curl -sf "$BASE/api/health/live" >/dev/null || { echo "API did not start; see tests/e2e/.server.log" >&2; exit 1; }
fi

if [ "$BLOCK" = "2" ]; then
  export E2E_BASE="$BASE" E2E_REQUIRE=1
  npm --prefix tests/e2e run test:block2
else
  export E2E_BASE="$BASE" E2E_REQUIRE=1
  npm --prefix tests/e2e run test:block1
fi
