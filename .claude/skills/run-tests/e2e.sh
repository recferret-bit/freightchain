#!/usr/bin/env bash
# Real-Chrome end-to-end runs against a freshly built server on a THROWAWAY database (dropped at the end, also on failure).
#   bash .claude/skills/run-tests/e2e.sh [browser|lobby|admin|promo|watch|replay|replay-controls|replay-tips|flags|wallet|wallet-split|board|close|close-split|verified|verified-deep|road|stats|blinks|traffic|editor|honk-garage|whitepaper|landing|achievements|guest|weekly|referral|viewer|sim|controls ...]   (default: all thirty-one)
# Needs: compose PostgreSQL (npm run db:up), server/landing dependencies, Chrome; blinks also native Solana, solana-verify and the pinned pool artifact.
# Opt-in normal-drive selects a full EASY/MEDIUM/HARD course (default MEDIUM); it is outside the default 31-suite list.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
SERVER="$ROOT/backend/server"
SUITES=("$@"); [ ${#SUITES[@]} -gt 0 ] || SUITES=(browser lobby admin promo watch replay replay-controls replay-tips flags wallet wallet-split board close close-split verified verified-deep road stats blinks traffic editor honk-garage whitepaper landing achievements guest weekly referral viewer sim controls)
DB="freightchain_e2e_$$"
PG_CONTAINER="${E2E_POSTGRES_CONTAINER:-freightchain-postgres}"
PG_PORT="${E2E_POSTGRES_PORT:-15433}"
URL="postgresql://freight:freight_dev_password@localhost:$PG_PORT/$DB"
TREASURY=GseaEsNWMLScZ5RH8yQ4xmoCP97H86HjLSA9xkyFCqbn   # any valid address: paid clicks never reach the chain here
ADMIN_KP="$(mktemp -t fc-admin-XXXXXX).json"
# A PRIVATE build of the server and the landing: other checkouts / sessions build into server/dist + landing/dist while this runs (nest's deleteOutDir
# empties dist/ mid-run – "Cannot find module dist/main.js"). Same depth as dist/, so the server's ../../../../frontend/client still finds the repo; a dot
# directory, so the server's own tsc (no include list) never type-checks it.
BUILD=".e2e-build-$$"; TSCONFIG=".e2e-tsconfig-$$.json"; LANDING_OUT="$(mktemp -d "${TMPDIR:-/tmp}/fc-landing-XXXXXX")"
CLIENT_OUT="$(mktemp -d "${TMPDIR:-/tmp}/fc-client-XXXXXX")"
SERVER_LOG_DIR="$(mktemp -d "${TMPDIR:-/tmp}/fc-e2e-server-logs-XXXXXX")"
echo "server logs retained: $SERVER_LOG_DIR"
cp -R "$ROOT/frontend/client/." "$CLIENT_OUT/"
PID=""; EDITOR_WORKER_PID=""; MCP_PID=""; VAL_PID=""; VAL_DIR=""
free_port() { node -e 'const s=require("net").createServer();s.listen(0,()=>{console.log(s.address().port);s.close()})'; }
psql_admin() { docker exec "$PG_CONTAINER" psql -U freight -d postgres -v ON_ERROR_STOP=1 -tAc "$1"; }
# Later suites share this database. Statistics asserts a game that has not been driven yet, so that suite starts from an empty one.
reset_db() {
  stop
  psql_admin "DROP DATABASE IF EXISTS \"$DB\" WITH (FORCE)" >/dev/null
  psql_admin "CREATE DATABASE \"$DB\"" >/dev/null
  (cd "$SERVER" && DATABASE_URL="$URL" ./node_modules/.bin/prisma migrate deploy >/dev/null)
}
SUITE=""
# E2E_LOG_DIR (set by `npm run test:census -- run e2e…`): the server's request lines per suite, so the census can tell which routes each suite hit
keep_log() {
  if [ -n "$SUITE" ] && [ -f "/tmp/fc-e2e-$DB.log" ]; then
    cp "/tmp/fc-e2e-$DB.log" "$SERVER_LOG_DIR/$SUITE-$PORT.log"   # preserve crashes before the next suite overwrites the working log
    if [ -n "${E2E_LOG_DIR:-}" ]; then grep -F '"event":"request"' "/tmp/fc-e2e-$DB.log" >> "$E2E_LOG_DIR/$SUITE.log" || true; fi
  fi
}
stop() { if [ -n "$PID" ]; then kill "$PID" 2>/dev/null || true; wait "$PID" 2>/dev/null || true; keep_log; fi; PID=""; }   # wait returns 143 for a killed server – not a failure
stop_editor() {
  for child in "$EDITOR_WORKER_PID" "$MCP_PID"; do if [ -n "$child" ]; then kill "$child" 2>/dev/null || true; wait "$child" 2>/dev/null || true; fi; done
  EDITOR_WORKER_PID=""; MCP_PID=""
}
stop_validator() { if [ -n "$VAL_PID" ]; then kill "$VAL_PID" 2>/dev/null || true; wait "$VAL_PID" 2>/dev/null || true; fi; VAL_PID=""; if [ -n "$VAL_DIR" ]; then rm -rf "$VAL_DIR"; fi; VAL_DIR=""; }
cleanup() { stop_editor; stop; stop_validator; psql_admin "DROP DATABASE IF EXISTS \"$DB\" WITH (FORCE)" >/dev/null 2>&1 || true; rm -rf "$ADMIN_KP" "$SERVER/$BUILD" "$SERVER/$TSCONFIG" "$LANDING_OUT" "$CLIENT_OUT"; }
trap cleanup EXIT

if ! nc -z localhost "$PG_PORT"; then
  if [ "$PG_CONTAINER" = freightchain-postgres ] && [ "$PG_PORT" = 15433 ]; then (cd "$ROOT" && npm run --silent db:up)
  else echo "test PostgreSQL is not listening on $PG_PORT ($PG_CONTAINER)"; exit 1; fi
fi
psql_admin "CREATE DATABASE \"$DB\"" >/dev/null
(cd "$SERVER" && DATABASE_URL="$URL" ./node_modules/.bin/prisma migrate deploy >/dev/null)
echo "▸ building the landing and the server (private copies: $LANDING_OUT, server/$BUILD)"
(cd "$ROOT/frontend/landing" && ./node_modules/.bin/vite build --outDir "$LANDING_OUT" --emptyOutDir >/dev/null)
printf '{ "extends": "./tsconfig.build.json", "compilerOptions": { "outDir": "./%s" } }\n' "$BUILD" > "$SERVER/$TSCONFIG"
(cd "$SERVER" && ./node_modules/.bin/nest build -p "$TSCONFIG" >/dev/null)

# start the server: $1 = FREE_RIDE_SECONDS, $2 = ADMIN_WALLETS, $EXTRA_ENV = more server env
start() {
  PORT="${FIXED_PORT:-$(free_port)}"   # FIXED_PORT: a suite that must put the port into the env too (APP_ORIGIN)
  # Auth bursts (verified play signs in many wallets at once) need a harness ceiling. The shipped defaults stay in env.schema.ts.
  (cd "$SERVER" && exec env ${EXTRA_ENV:-} DATABASE_URL="$URL" FREE_RIDE_SECONDS="$1" ADMIN_WALLETS="${2:-}" SOL_USD=118 TREASURY_PUBKEY="$TREASURY" PORT="$PORT" CLIENT_DIR="$CLIENT_OUT" LANDING_DIR="$LANDING_OUT" THROTTLE_AUTH_RPS=100 THROTTLE_AUTH_LIMIT=10000 THROTTLE_LIMIT=10000 node ${SERVER_ENTRY:-"$BUILD/main.js"} > "/tmp/fc-e2e-$DB.log" 2>&1) &   # exec: $! is the server itself, so stop() really stops it; EXTRA_ENV="K=V …" = more server env (the live flags suite)
  PID=$!
  for _ in $(seq 1 60); do curl -sf "http://localhost:$PORT/api/health/live" >/dev/null && return 0; sleep 0.5; done
  echo "server did not start:"; tail -30 "/tmp/fc-e2e-$DB.log"; exit 1
}

fails=0
for suite in "${SUITES[@]}"; do
  echo "▸ e2e $suite"; SUITE="$suite"
  case "$suite" in
    browser) start 20; (cd "$SERVER" && BASE="http://localhost:$PORT" CHROME_PORT="$(free_port)" FREE_RIDE_SECONDS=20 node scripts/e2e-browser.mjs) || fails=$((fails + 1)) ;;
    lobby)   start 3;  (cd "$SERVER" && BASE="http://localhost:$PORT" SEED=1 DATABASE_URL="$URL" CLI="$BUILD/cli/index.js" node scripts/e2e-lobby.mjs && BASE="http://localhost:$PORT" DATABASE_URL="$URL" CHROME_PORT="$(free_port)" node scripts/e2e-i18n-legal.mjs) || fails=$((fails + 1)) ;;   # SEED=1: the dev pool seeds it expects (throwaway database)
    admin)
      wallet="$(cd "$SERVER" && node -e 'const n=require("tweetnacl"),b=require("bs58").default??require("bs58"),k=n.sign.keyPair();require("fs").writeFileSync(process.argv[1],JSON.stringify([...k.secretKey]));console.log(b.encode(k.publicKey))' "$ADMIN_KP")"
      EXTRA_ENV="EDITOR_WALLETS=$wallet TRAFFIC_PROOF_REQUIRED=true" start 3 "$wallet"; (cd "$SERVER" && BASE="http://localhost:$PORT" ADMIN_KEYPAIR="$ADMIN_KP" CHROME_PORT="$(free_port)" SEED=1 DATABASE_URL="$URL" CLI="$BUILD/cli/index.js" node scripts/e2e-admin.mjs) || fails=$((fails + 1)); EXTRA_ENV="" ;;   # the admin wallet is an editor too (the owner's setup)
    promo)   # the whole promo loop: admin page (signs) → lobby + landing players → admin sees the uses; expiry, start, used up, disabled, abuse. Own limit: a hundred players behind one IP
      wallet="$(cd "$SERVER" && node -e 'const n=require("tweetnacl"),b=require("bs58").default??require("bs58"),k=n.sign.keyPair();require("fs").writeFileSync(process.argv[1],JSON.stringify([...k.secretKey]));console.log(b.encode(k.publicKey))' "$ADMIN_KP")"
      EXTRA_ENV="THROTTLE_PROMO_LIMIT=100000" start 3 "$wallet"; (cd "$SERVER" && BASE="http://localhost:$PORT" ADMIN_KEYPAIR="$ADMIN_KP" SEED=1 DATABASE_URL="$URL" CHROME_PORT="$(free_port)" node scripts/e2e-promo.mjs) || fails=$((fails + 1)) ;;
    watch)   start 300; (cd "$SERVER" && BASE="http://localhost:$PORT" CHROME_PORT="$(free_port)" node scripts/e2e-watch.mjs) || fails=$((fails + 1)) ;;
    replay)  start 300; (cd "$SERVER" && BASE="http://localhost:$PORT" CHROME_PORT="$(free_port)" node scripts/e2e-replay.mjs) || fails=$((fails + 1)) ;;
    replay-controls) EXTRA_ENV="LIVE_CHAT=all LIVE_DONATIONS=on LIVE_FREE_DONATIONS=off LIVE_EFFECTS=off" start 300; (cd "$SERVER" && BASE="http://localhost:$PORT" DATABASE_URL="$URL" CHROME_PORT="$(free_port)" node scripts/e2e-replay-controls.mjs) || fails=$((fails + 1)); EXTRA_ENV="" ;;
    replay-tips)
      command -v solana-test-validator >/dev/null || { echo "replay-tips requires solana-test-validator"; exit 1; }
      VAL_DIR="$(mktemp -d "${TMPDIR:-/tmp}/fc-replay-tips-XXXXXX")"
      RPC_PORT=""
      for _ in $(seq 1 40); do candidate=$((20000 + RANDOM % 30000)); if ! nc -z 127.0.0.1 "$candidate" && ! nc -z 127.0.0.1 $((candidate + 1)); then RPC_PORT="$candidate"; break; fi; done
      [ -n "$RPC_PORT" ] || { echo "no free validator port pair"; exit 1; }
      DYN=$((RPC_PORT < 40000 ? RPC_PORT + 2000 : RPC_PORT - 2000))
      RPC="http://127.0.0.1:$RPC_PORT"
      solana-test-validator --ledger "$VAL_DIR/ledger" --quiet --bind-address 127.0.0.1 --rpc-port "$RPC_PORT" --faucet-port "$(free_port)" --gossip-port "$(free_port)" --dynamic-port-range "$DYN-$((DYN + 30))" > "$VAL_DIR/validator.log" 2>&1 &
      VAL_PID=$!
      for _ in $(seq 1 60); do curl -sf -X POST -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' "$RPC" | grep -q '"ok"' && break; kill -0 "$VAL_PID" 2>/dev/null || { tail -20 "$VAL_DIR/validator.log"; exit 1; }; sleep 1; done
      curl -sf -X POST -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' "$RPC" | grep -q '"ok"' || { echo "validator not ready"; exit 1; }
      EXTRA_ENV="SOLANA_RPC=$RPC LIVE_CHAT=all LIVE_DONATIONS=on LIVE_FREE_DONATIONS=off LIVE_EFFECTS=off" start 300
      (cd "$SERVER" && BASE="http://localhost:$PORT" RPC="$RPC" TREASURY_PUBKEY="$TREASURY" DATABASE_URL="$URL" CHROME_PORT="$(free_port)" node scripts/e2e-solana-pay.mjs) || fails=$((fails + 1))
      stop; stop_validator; EXTRA_ENV="" ;;
    board)   EXTRA_ENV="TRUST_PROXY=1 HB_TIMEOUT_MS=15000" start 20; (cd "$SERVER" && BASE="http://localhost:$PORT" CHROME_PORT="$(free_port)" ROAD_PLAN_BUILD="$BUILD" node scripts/e2e-live-board.mjs) || fails=$((fails + 1)); EXTRA_ENV="" ;;   # sim-rides rebuilds holes from the server build; a running ride's public /road is 404
    flags)   # the LIVE_* flags in a real browser: production's (paid donations, effects on free rides only), then chat + donations off
      EXTRA_ENV="LIVE_FREE_DONATIONS=off LIVE_EFFECTS=free" start 300; (cd "$SERVER" && BASE="http://localhost:$PORT" CHROME_PORT="$(free_port)" MODE=paid node scripts/e2e-live-flags.mjs) || fails=$((fails + 1)); stop
      EXTRA_ENV="LIVE_CHAT=off LIVE_DONATIONS=off" start 300; (cd "$SERVER" && BASE="http://localhost:$PORT" CHROME_PORT="$(free_port)" MODE=off node scripts/e2e-live-flags.mjs) || fails=$((fails + 1)); EXTRA_ENV="" ;;
    wallet)  start 3;  (cd "$ROOT" && BASE="http://localhost:$PORT" PORT="$(free_port)" node frontend/landing/tools/e2e-wallet.mjs) || fails=$((fails + 1)) ;;   # the landing's sign-in + the promo invite, one origin
    wallet-split)   # the same on split hosts: landing on app.localhost, API on api.app.localhost, one cookie on the apex (Chrome resolves *.localhost, see the script's header)
      APP_DOMAIN=app.localhost COOKIE_DOMAIN=app.localhost CORS_ORIGINS=http://app.localhost,http://ride.app.localhost start 3
      (cd "$ROOT" && RESOLVE="MAP app.localhost 127.0.0.1:$PORT, MAP api.app.localhost 127.0.0.1:$PORT" BASE=http://app.localhost API=http://api.app.localhost PORT="$(free_port)" node frontend/landing/tools/e2e-wallet.mjs) || fails=$((fails + 1)) ;;
    close)   EXTRA_ENV="TRAFFIC_PROOF_REQUIRED=false" start 20; (cd "$SERVER" && BASE="http://localhost:$PORT" CHROME_PORT="$(free_port)" node scripts/e2e-close.mjs) || fails=$((fails + 1)); EXTRA_ENV="" ;;   # a closed landing / lobby / watch page / game tab leaves the board at once. Traffic proof is the traffic suite.
    close-split)   # the same on split hosts (the cookie on the apex, the beacons cross-subdomain to api.*) – what production does
      EXTRA_ENV="TRAFFIC_PROOF_REQUIRED=false"
      APP_DOMAIN=app.localhost COOKIE_DOMAIN=app.localhost CORS_ORIGINS=http://app.localhost,http://ride.app.localhost start 20
      (cd "$SERVER" && SERVER="http://localhost:$PORT" BASE=http://app.localhost RESOLVE="MAP app.localhost 127.0.0.1:$PORT, MAP *.app.localhost 127.0.0.1:$PORT" CHROME_PORT="$(free_port)" node scripts/e2e-close.mjs) || fails=$((fails + 1)); EXTRA_ENV="" ;;
    traffic) EXTRA_ENV="TRAFFIC_PROOF_REQUIRED=true VERDICT_ENFORCE=true CHALLENGE_INTERVAL_SECONDS=0" start 5; (cd "$SERVER" && BASE="http://localhost:$PORT" CHROME_PORT="$(free_port)" node scripts/e2e-traffic-proof.mjs) || fails=$((fails + 1)); EXTRA_ENV="" ;;
    verified)   # verified play, positive + negative: a person and a bot in Chrome, API-level bots, the CLI's bulk re-judge – a 40 s free shift with a dispatch prompt about every other heartbeat
      EXTRA_ENV="TRAFFIC_PROOF_REQUIRED=false CHALLENGE_INTERVAL_SECONDS=8 ROAD_PLAN_BUILD=$BUILD" start 40; (cd "$SERVER" && BASE="http://localhost:$PORT" CHROME_PORT="$(free_port)" CHROME_PORT2="$(free_port)" CLI="$BUILD/cli/index.js" DATABASE_URL="$URL" FREE_RIDE_SECONDS=40 ROAD_PLAN_BUILD="$BUILD" node scripts/e2e-verified-play.mjs) || fails=$((fails + 1)); EXTRA_ENV="" ;;
    verified-deep)   # verified play, the DEEP pass: every verdict code, the upload protocol, who sees a verdict, the admin's hand, the profile in Chrome, retention + bulk re-judge – prompts OFF, a 30 s shift
      wallet="$(cd "$SERVER" && node -e 'const n=require("tweetnacl"),b=require("bs58").default??require("bs58"),k=n.sign.keyPair();require("fs").writeFileSync(process.argv[1],JSON.stringify([...k.secretKey]));console.log(b.encode(k.publicKey))' "$ADMIN_KP")"
      EXTRA_ENV="TRAFFIC_PROOF_REQUIRED=false CHALLENGE_INTERVAL_SECONDS=0 ROAD_PLAN_BUILD=$BUILD" start 30 "$wallet"; (cd "$SERVER" && BASE="http://localhost:$PORT" ADMIN_KEYPAIR="$ADMIN_KP" CHROME_PORT="$(free_port)" CLI="$BUILD/cli/index.js" DATABASE_URL="$URL" FREE_RIDE_SECONDS=30 ROAD_PLAN_BUILD="$BUILD" node scripts/e2e-verified-deep.mjs) || fails=$((fails + 1)); EXTRA_ENV="" ;;
    road)   # the SERVER's road: honest/removed-hole drivers with frame proof (Chrome), training replay refusal, database ride-audit
      EXTRA_ENV="TRAFFIC_PROOF_REQUIRED=true CHALLENGE_INTERVAL_SECONDS=0" start 30; (cd "$SERVER" && BASE="http://localhost:$PORT" CHROME_PORT="$(free_port)" AUDIT_BUILD="$BUILD" DATABASE_URL="$URL" node scripts/e2e-road-check.mjs) || fails=$((fails + 1)); EXTRA_ENV="" ;;
    stats)   # statistics end to end: a real game crashing into a car, API bots for the other ways a ride ends, the landing's tiles + the lobby's DRIVING RECORD, `stats:reconcile` on the live database
      reset_db   # earlier suites in this process left rides in $DB; this suite's "starts at zero" is that empty database
      (cd "$SERVER" && DATABASE_URL="$URL" node "$BUILD/cli/index.js" pool:seed --id 1 --tier 1h --status active --min 2 >/dev/null) || true   # a live pool, so the hero is not the long empty-pot label
      # a REAL Redis with a password (throwaway container, loopback port): the cache is exercised for real, and the suite stops it to prove the API survives a dead cache
      RPORT="$(free_port)"; RPW="$(node -e 'console.log(require("crypto").randomBytes(16).toString("hex"))')"
      REDIS_CT="$(docker run -d --rm -p "127.0.0.1:$RPORT:6379" -e REDISCLI_AUTH="$RPW" redis:7-alpine redis-server --requirepass "$RPW" --save "")"; trap 'docker rm -f "$REDIS_CT" >/dev/null 2>&1; cleanup' EXIT
      EXTRA_ENV="TRUST_PROXY=1 HB_TIMEOUT_MS=15000 CHALLENGE_INTERVAL_SECONDS=0 REDIS_URL=redis://:$RPW@127.0.0.1:$RPORT" start 300
      (cd "$SERVER" && BASE="http://localhost:$PORT" CHROME_PORT="$(free_port)" CLI="$BUILD/cli/index.js" DATABASE_URL="$URL" REDIS_CONTAINER="$REDIS_CT" node scripts/e2e-stats.mjs) || fails=$((fails + 1))
      EXTRA_ENV=""; docker rm -f "$REDIS_CT" >/dev/null 2>&1 || true; trap cleanup EXIT ;;
    blinks)  # Real returned transaction: scratch validator/pool, browser signer and watcher credit.
      (cd "$SERVER" && DATABASE_URL="$URL" SERVER_BUILD="$BUILD" CLIENT_DIR="$CLIENT_OUT" LANDING_DIR="$LANDING_OUT" node scripts/blinks-localnet.mjs) || fails=$((fails + 1)) ;;
    editor)  # the model editor (storybook viewer): the REAL entity MCP (mcp/src/http.js) + the server's scripted model (EDITOR_FAKE_LLM=1) – no AI key needed
      wallet="$(cd "$SERVER" && node -e 'const n=require("tweetnacl"),b=require("bs58").default??require("bs58"),k=n.sign.keyPair();require("fs").writeFileSync(process.argv[1],JSON.stringify([...k.secretKey]));console.log(b.encode(k.publicKey))' "$ADMIN_KP")"
      FIXED_PORT="$(free_port)"; MCP_PORT="$(free_port)"; MCP_TOKEN="e2e-mcp-$$-$(node -e 'console.log(require("crypto").randomBytes(16).toString("hex"))')"
      (cd "$ROOT/backend/mcp" && EDITOR_MCP_PORT="$MCP_PORT" EDITOR_MCP_TOKEN="$MCP_TOKEN" FC_APP_URL="http://localhost:$FIXED_PORT" exec node src/http.js > "/tmp/fc-e2e-mcp-$DB.log" 2>&1) & MCP_PID=$!
      EDITOR_TEST_JWT="e2e-editor-jwt-$$-shared-between-processes"
      FAKE_ONLY="EDITOR_FAKE_LLM=1 EDITOR_DEFAULT_PROVIDER=fake ANTHROPIC_API_KEY= OPENAI_API_KEY= GEMINI_API_KEY= ZAI_API_KEY= XAI_API_KEY="
      EXTRA_ENV="JWT_SECRET=$EDITOR_TEST_JWT EDITOR_WALLETS=$wallet $FAKE_ONLY EDITOR_MCP_URL=http://127.0.0.1:$MCP_PORT EDITOR_MCP_TOKEN=$MCP_TOKEN" start 3 "$wallet"   # the editor is the ADMIN wallet too (the owner's setup)
      (cd "$SERVER" && BASE="http://localhost:$PORT" EDITOR_KEYPAIR="$ADMIN_KP" node scripts/e2e-editor-worker.mjs queue "$BUILD/editor-worker-job.txt")
      (cd "$SERVER" && exec env DATABASE_URL="$URL" JWT_SECRET="$EDITOR_TEST_JWT" EDITOR_WALLETS="$wallet" $FAKE_ONLY EDITOR_MCP_URL="http://127.0.0.1:$MCP_PORT" EDITOR_MCP_TOKEN="$MCP_TOKEN" node "$BUILD/app/editor-worker.js" > "/tmp/fc-e2e-editor-worker-$DB.log" 2>&1) & EDITOR_WORKER_PID=$!
      (cd "$SERVER" && BASE="http://localhost:$PORT" EDITOR_KEYPAIR="$ADMIN_KP" node scripts/e2e-editor-worker.mjs wait "$BUILD/editor-worker-job.txt" "$EDITOR_WORKER_PID")
      (cd "$SERVER" && BASE="http://localhost:$PORT" EDITOR_KEYPAIR="$ADMIN_KP" CHROME_PORT="$(free_port)" node scripts/e2e-editor.mjs) || { fails=$((fails + 1)); tail -20 "/tmp/fc-e2e-mcp-$DB.log"; }
      stop_editor; stop; FIXED_PORT=""; EXTRA_ENV="" ;;
    honk-garage) start 3; (cd "$SERVER" && BASE="http://localhost:$PORT" CHROME_PORT="$(free_port)" DATABASE_URL="$URL" node scripts/e2e-honk-garage.mjs) || fails=$((fails + 1)) ;;
    whitepaper) start 3; (cd "$SERVER" && BASE="http://localhost:$PORT" CHROME_PORT="$(free_port)" node scripts/e2e-whitepaper.mjs) || fails=$((fails + 1)) ;;
    landing) start 3; (cd "$SERVER" && BASE="http://localhost:$PORT" CHROME_PORT="$(free_port)" node scripts/e2e-landing.mjs) || fails=$((fails + 1)) ;;
    achievements) EXTRA_ENV="TRAFFIC_PROOF_REQUIRED=false CHALLENGE_INTERVAL_SECONDS=0" start 3; (cd "$SERVER" && BASE="http://localhost:$PORT" CHROME_PORT="$(free_port)" DATABASE_URL="$URL" node scripts/e2e-achievements.mjs) || fails=$((fails + 1)); EXTRA_ENV="" ;;
    guest) EXTRA_ENV="PRIZE_DEV_DEFAULT_COUNTRY=KP" start 6; (cd "$SERVER" && BASE="http://localhost:$PORT" CHROME_PORT="$(free_port)" DATABASE_URL="$URL" node scripts/e2e-guest-training.mjs) || fails=$((fails + 1)); EXTRA_ENV="" ;;
    weekly) SERVER_ENTRY="scripts/e2e-weekly-server.mjs $BUILD" EXTRA_ENV="PRIZE_DEV_DEFAULT_COUNTRY=KP" start 6; (cd "$SERVER" && BASE="http://localhost:$PORT" CHROME_PORT="$(free_port)" DATABASE_URL="$URL" CLI="$BUILD/cli/index.js" node scripts/e2e-weekly-ticket.mjs) || fails=$((fails + 1)); EXTRA_ENV="" ;;
    referral) SGT_FIXTURE_PORT="$(free_port)"; SERVER_ENTRY="scripts/e2e-sgt-server.mjs $BUILD" EXTRA_ENV="SGT_FIXTURE_PORT=$SGT_FIXTURE_PORT PRIZE_DEV_DEFAULT_COUNTRY=KP CHALLENGE_INTERVAL_SECONDS=0" start 6; (cd "$SERVER" && BASE="http://localhost:$PORT" CHROME_PORT="$(free_port)" DATABASE_URL="$URL" SGT_FIXTURE_PORT="$SGT_FIXTURE_PORT" node scripts/e2e-referral.mjs) || fails=$((fails + 1)); EXTRA_ENV="" ;;
    viewer) start 3; (cd "$ROOT/frontend/client" && PORT="$(free_port)" node tools/e2e-viewer.mjs "http://localhost:$PORT/viewer.html") || fails=$((fails + 1)) ;;
    normal-drive) (cd "$SERVER" && node --test scripts/normal-drive-support.test.mjs scripts/normal-drive-course.test.mjs scripts/lane-merge-safety.test.mjs); EXTRA_ENV="TRAFFIC_PROOF_REQUIRED=true VERDICT_ENFORCE=true" start 180; (cd "$SERVER" && BASE="http://localhost:$PORT" NORMAL_PAID_KEY= CHROME_PORT="$(free_port)" node scripts/e2e-normal-drive.mjs) || fails=$((fails + 1)); EXTRA_ENV="" ;;
    controls) start 3; (cd "$ROOT/frontend/client" && BASE="http://localhost:$PORT" CHROME_PORT="$(free_port)" node tools/e2e-controls.mjs) || fails=$((fails + 1)) ;;
    sim) start 3; (cd "$ROOT/frontend/client" && PORT="$(free_port)" node tools/e2e-chrome.mjs "http://localhost:$PORT/play.html?sim=1") || fails=$((fails + 1)) ;;
    *) echo "unknown suite $suite (browser | lobby | admin | promo | watch | replay | replay-controls | replay-tips | flags | wallet | wallet-split | board | close | close-split | verified | verified-deep | road | stats | blinks | traffic | editor | honk-garage | whitepaper | landing | achievements | guest | weekly | referral | viewer | sim | controls | normal-drive)"; fails=$((fails + 1)) ;;
  esac
  stop
done
[ "$fails" -eq 0 ] && echo "✔ e2e: all green (${SUITES[*]})" || { echo "✘ e2e: $fails suite(s) failed – server log: /tmp/fc-e2e-$DB.log"; exit 1; }
