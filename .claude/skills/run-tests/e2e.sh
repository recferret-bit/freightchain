#!/usr/bin/env bash
# Real-Chrome end-to-end runs against a freshly built server on a THROWAWAY database (dropped at the end, also on failure).
#   bash .claude/skills/run-tests/e2e.sh [browser|lobby|admin|watch|replay|flags ...]   (default: all six)
# Needs: the compose PostgreSQL (npm run db:up), server/ and landing/ dependencies installed, Chrome.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
SERVER="$ROOT/server"
SUITES=("$@"); [ ${#SUITES[@]} -gt 0 ] || SUITES=(browser lobby admin watch replay flags)
DB="freightchain_e2e_$$"
URL="postgresql://freight:freight_dev_password@localhost:15433/$DB"
TREASURY=GseaEsNWMLScZ5RH8yQ4xmoCP97H86HjLSA9xkyFCqbn   # any valid address: paid clicks never reach the chain here
ADMIN_KP="$(mktemp -t fc-admin-XXXXXX).json"
PID=""
free_port() { node -e 'const s=require("net").createServer();s.listen(0,()=>{console.log(s.address().port);s.close()})'; }
psql_admin() { docker exec freightchain-postgres psql -U freight -d postgres -v ON_ERROR_STOP=1 -tAc "$1"; }
stop() { if [ -n "$PID" ]; then kill "$PID" 2>/dev/null || true; wait "$PID" 2>/dev/null || true; fi; PID=""; }   # wait returns 143 for a killed server – not a failure
cleanup() { stop; psql_admin "DROP DATABASE IF EXISTS \"$DB\" WITH (FORCE)" >/dev/null 2>&1 || true; rm -f "$ADMIN_KP"; }
trap cleanup EXIT

nc -z localhost 15433 || (cd "$ROOT" && npm run --silent db:up)
psql_admin "CREATE DATABASE \"$DB\"" >/dev/null
(cd "$SERVER" && DATABASE_URL="$URL" ./node_modules/.bin/prisma migrate deploy >/dev/null)
echo "▸ building the landing and the server"
(cd "$ROOT" && npm run --silent landing:build >/dev/null) && (cd "$SERVER" && npm run --silent build >/dev/null)

# start the server: $1 = FREE_RIDE_SECONDS, $2 = ADMIN_WALLETS, $EXTRA_ENV = more server env
start() {
  PORT="$(free_port)"
  (cd "$SERVER" && exec env ${EXTRA_ENV:-} DATABASE_URL="$URL" FREE_RIDE_SECONDS="$1" ADMIN_WALLETS="${2:-}" SOL_USD=118 TREASURY_PUBKEY="$TREASURY" PORT="$PORT" node dist/main.js > "/tmp/fc-e2e-$DB.log" 2>&1) &   # exec: $! is the server itself, so stop() really stops it; EXTRA_ENV="K=V …" = more server env (the live flags suite)
  PID=$!
  for _ in $(seq 1 60); do curl -sf "http://localhost:$PORT/api/health/live" >/dev/null && return 0; sleep 0.5; done
  echo "server did not start:"; tail -30 "/tmp/fc-e2e-$DB.log"; exit 1
}

fails=0
for suite in "${SUITES[@]}"; do
  echo "▸ e2e $suite"
  case "$suite" in
    browser) start 20; (cd "$SERVER" && BASE="http://localhost:$PORT" CHROME_PORT="$(free_port)" FREE_RIDE_SECONDS=20 node scripts/e2e-browser.mjs) || fails=$((fails + 1)) ;;
    lobby)   start 3;  (cd "$SERVER" && BASE="http://localhost:$PORT" SEED=1 DATABASE_URL="$URL" node scripts/e2e-lobby.mjs) || fails=$((fails + 1)) ;;   # SEED=1: the dev pool seeds it expects (throwaway database)
    admin)
      wallet="$(cd "$SERVER" && node -e 'const n=require("tweetnacl"),b=require("bs58").default??require("bs58"),k=n.sign.keyPair();require("fs").writeFileSync(process.argv[1],JSON.stringify([...k.secretKey]));console.log(b.encode(k.publicKey))' "$ADMIN_KP")"
      start 3 "$wallet"; (cd "$SERVER" && BASE="http://localhost:$PORT" ADMIN_KEYPAIR="$ADMIN_KP" CHROME_PORT="$(free_port)" node scripts/e2e-admin.mjs) || fails=$((fails + 1)) ;;
    watch)   start 300; (cd "$SERVER" && BASE="http://localhost:$PORT" CHROME_PORT="$(free_port)" node scripts/e2e-watch.mjs) || fails=$((fails + 1)) ;;
    replay)  start 300; (cd "$SERVER" && BASE="http://localhost:$PORT" CHROME_PORT="$(free_port)" node scripts/e2e-replay.mjs) || fails=$((fails + 1)) ;;
    flags)   # the LIVE_* flags in a real browser: production's (paid donations, effects on free rides only), then chat + donations off
      EXTRA_ENV="LIVE_FREE_DONATIONS=off LIVE_EFFECTS=free" start 300; (cd "$SERVER" && BASE="http://localhost:$PORT" CHROME_PORT="$(free_port)" MODE=paid node scripts/e2e-live-flags.mjs) || fails=$((fails + 1)); stop
      EXTRA_ENV="LIVE_CHAT=off LIVE_DONATIONS=off" start 300; (cd "$SERVER" && BASE="http://localhost:$PORT" CHROME_PORT="$(free_port)" MODE=off node scripts/e2e-live-flags.mjs) || fails=$((fails + 1)); EXTRA_ENV="" ;;
    *) echo "unknown suite $suite (browser | lobby | admin | watch | replay | flags)"; fails=$((fails + 1)) ;;
  esac
  stop
done
[ "$fails" -eq 0 ] && echo "✔ e2e: all green (${SUITES[*]})" || { echo "✘ e2e: $fails suite(s) failed – server log: /tmp/fc-e2e-$DB.log"; exit 1; }
