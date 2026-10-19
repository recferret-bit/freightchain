#!/usr/bin/env bash
# Local browser smoke of the PostHog relay. Throwaway database, then dropped.
#   bash .claude/skills/posthog-test/smoke.sh
# Uses this checkout when it has the adapter. FREIGHTCHAIN_POSTHOG_ROOT overrides.
# Exports POSTHOG_ENABLED=1 for this process only (shell wins over server/.env, which pins 0).
# Never prints POSTHOG_KEY. Never uses the dev database `freightchain`. Never deploys.
# Does not edit deploy/.env and does not talk to production. Production is posthog-prod.
set -euo pipefail
SKILL="$(cd "$(dirname "$0")" && pwd)"
MAIN="$(cd "$SKILL/../../.." && pwd)"
DB="freightchain_ph_$$"
URL="postgresql://freight:freight_dev_password@127.0.0.1:15433/$DB"
LOG="/tmp/fc-posthog-$DB.log"
SHOT="/tmp/fc-posthog-landing.png"
PID=""

redact() { sed -E 's/phc_[A-Za-z0-9]+/phc_REDACTED/g; s/phx_[A-Za-z0-9]+/phx_REDACTED/g'; }
psql_admin() { docker exec freightchain-postgres psql -U freight -d postgres -v ON_ERROR_STOP=1 -tAc "$1"; }
free_port() { node -e 'const s=require("net").createServer();s.listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})'; }

find_src() {
  if [ -n "${FREIGHTCHAIN_POSTHOG_ROOT:-}" ] && [ -f "$FREIGHTCHAIN_POSTHOG_ROOT/backend/server/src/infrastructure/analytics/posthog-analytics.adapter.ts" ]; then
    printf '%s\n' "$FREIGHTCHAIN_POSTHOG_ROOT"; return
  fi
  if [ -f "$MAIN/backend/server/src/infrastructure/analytics/posthog-analytics.adapter.ts" ]; then
    printf '%s\n' "$MAIN"; return
  fi
  local wt
  wt="$(git -C "$MAIN" worktree list --porcelain | awk '
    /^worktree / { p = substr($0, 10) }
    /^branch refs\/heads\/plan\/posthog-integration$/ { print p }
  ')"
  if [ -n "$wt" ] && [ -f "$wt/backend/server/src/infrastructure/analytics/posthog-analytics.adapter.ts" ]; then
    printf '%s\n' "$wt"; return
  fi
  echo "capture code not found. Set FREIGHTCHAIN_POSTHOG_ROOT to a checkout that has the adapter." >&2
  exit 1
}

SRC="$(find_src)"
SERVER="$SRC/backend/server"
stop() { if [ -n "$PID" ]; then kill "$PID" 2>/dev/null || true; wait "$PID" 2>/dev/null || true; fi; PID=""; }
# The plan worktree's server/node_modules is often a symlink into the main checkout, so its
# `prisma generate` writes the branch client over main. Put this checkout's client back.
restore_client() {
  if [ "$SRC" != "$MAIN" ] && [ -x "$MAIN/backend/server/node_modules/.bin/prisma" ]; then
    (cd "$MAIN/backend/server" && ./node_modules/.bin/prisma generate >/dev/null) || true
  fi
}
cleanup() { stop; restore_client; psql_admin "DROP DATABASE IF EXISTS \"$DB\" WITH (FORCE)" >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "▸ source $SRC"
nc -z 127.0.0.1 15433 || (cd "$MAIN" && npm run --silent db:up)
psql_admin "SELECT 1 FROM pg_database WHERE datname = 'freightchain'" >/dev/null
psql_admin "CREATE DATABASE \"$DB\"" >/dev/null
(cd "$SERVER" && DATABASE_URL="$URL" ./node_modules/.bin/prisma migrate deploy)

echo "▸ building landing and server"
(cd "$SRC" && npm run --silent landing:build)
(cd "$SERVER" && npm run --silent build)

PORT="$(free_port)"
CPORT="$(free_port)"
(cd "$SERVER" && DATABASE_URL="$URL" PORT="$PORT" POSTHOG_ENABLED=1 exec node --import "$SKILL/scripts/fetch-probe.mjs" dist/main.js > "$LOG" 2>&1) &
PID=$!
for _ in $(seq 1 60); do curl -sf "http://127.0.0.1:$PORT/api/health/live" >/dev/null && break; sleep 0.5; done
if ! curl -sf "http://127.0.0.1:$PORT/api/health/live" >/dev/null; then
  echo "server did not start:"; redact < "$LOG" | tail -40; exit 1
fi
if ! grep -q 'analytics enabled host=https://eu.i.posthog.com' "$LOG"; then
  echo "analytics did not enable against EU ingest:"; redact < "$LOG" | grep -E 'analytics (enabled|disabled)' || true; exit 1
fi

echo "▸ relay drops a server event name"
DROP="$(curl -sS -X POST "http://127.0.0.1:$PORT/api/telemetry" -H 'content-type: application/json' \
  -d '{"anon_id":"anon_11111111-1111-4111-8111-111111111111","events":[{"event":"ride_completed","properties":{}}]}')"
echo "$DROP" | grep -q '"enabled":true' || { echo "relay not enabled: $DROP"; exit 1; }
echo "$DROP" | grep -q '"dropped":1' || { echo "ride_completed was not dropped: $DROP"; exit 1; }
echo "$DROP" | grep -q '"accepted":0' || { echo "ride_completed was accepted: $DROP"; exit 1; }

echo "▸ chrome loads the landing"
node "$SKILL/scripts/open-landing.mjs" "http://127.0.0.1:$PORT" "$CPORT" "$SHOT"
echo "▸ waiting for the EU batch"
ok=0
for _ in $(seq 1 40); do
  if grep -q 'posthog-probe status=200 host=eu.i.posthog.com path=/batch/' "$LOG"; then ok=1; break; fi
  sleep 0.25
done
if [ "$ok" != 1 ]; then
  echo "EU ingest did not accept the batch:"; redact < "$LOG" | grep -E 'posthog-probe|analytics ' || true; exit 1
fi
echo "✔ posthog smoke: landing telemetry accepted, ride_completed dropped, EU batch status 200"
echo "  screenshot: $SHOT"
echo "  server log: $LOG"
