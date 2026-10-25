#!/usr/bin/env bash
# Full money e2e on a LOCAL chain: solana-test-validator with the escrow program (the verifiable .so, upgradeable) + the real server in PAYMENT_MODE=program
# on a THROWAWAY database + scripted wallets (Node keypairs and a fake Phantom in headless Chrome that signs real transactions).
#   bash .claude/skills/localnet-e2e/run.sh            (~16 min, paced by the pools' deadlines; see server/scripts/e2e-localnet*.mjs)
# Env: SO=<path to the .so> (default target/deploy, should be the pinned verifiable build), KEEP=1 keeps the scratch dir (keys, ledger, logs),
#      PREP_A / PLAY_A / PREP_B = pool deadlines in seconds from creation (defaults in e2e-localnet.mjs).
# Never touches devnet, the global Solana config or ~/.config/solana/id.json: every key is generated into the scratch dir, every call has an explicit URL.
# TARGET=devnet (= `bash server/scripts/devnet.sh rehearse`): the SAME scenario against the program on DEVNET – no validator, no baked pools; the RPC and the
#   program id from server/.env.devnet, the role keys from deploy/secrets/devnet/ (players funded by `funder`, swept back at the end), small prices, its own
#   server on a throwaway database with the crank schedule off (the scenario runs `pool:crank`). Needs the program deployed + initialized (Phase 1).
# SCENARIO=chaos: the server's view of the chain made flaky (scripts/localnet-fault-proxy.mjs) + several servers / crankers on one pool at once
#   (scripts/e2e-localnet-chaos.mjs) – local only, no coverage gate (it adds no new instructions).
# SCENARIO=all (default) | money (e2e-localnet.mjs only) | payout (e2e-localnet-payout.mjs only: ten riders, one pool, the payout job, the next seed, the
#   remaining program paths) | day (e2e-localnet-day.mjs only: THE AUTONOMOUS DAY of program v2 – phase 3, a fresh validator with the 1h series phase 1
#   wrote, its own server + database: the crank opens the pools on their slots, the payout key pays the verified ranks after the review window, no admin
#   signature on chain). `all` ends with the coverage gate (scripts/localnet-coverage.mjs): every instruction and event on the validator, every error
#   code asserted on the validator or in the LiteSVM tests – else the run fails. Coverage: $TMP/coverage.json (KEEP=1).
# Needs: the compose PostgreSQL (npm run db:up), server/ dependencies, Chrome, solana-test-validator (Agave 4.1.2), internet once (web3.js + three.js CDNs).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
SERVER="$ROOT/backend/server"
export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$HOME/.avm/bin:$PATH"
SO="${SO:-$ROOT/backend/programs/target/deploy/freightchain_pools.so}"
PIN="$ROOT/backend/programs/verifiable-build.hash"
PROGRAM_ID="$(node -p 'require(process.argv[1]).address' "$ROOT/backend/programs/idl/freightchain_pools.json")"
TMP="$(mktemp -d -t fc-localnet-XXXXXX)"
DB="freightchain_localnet_$$"; DB_DAY="freightchain_localnet_$$_day"
URL="postgresql://freight:freight_dev_password@localhost:15433/$DB"; URL_DAY="postgresql://freight:freight_dev_password@localhost:15433/$DB_DAY"
VAL_PID=""; SRV_PID=""; BASE=""
SCENARIO="${SCENARIO:-$([ "${TARGET:-localnet}" = devnet ] || [ "${LIKE_DEVNET:-0}" = 1 ] && echo money || echo all)}"   # the devnet paths run the money scenario
case "$SCENARIO" in all|money|payout|chaos|day) ;; *) echo "✗ SCENARIO must be all, money, payout, day or chaos"; exit 2 ;; esac
PHASE2=1; [ "$SCENARIO" = day ] && PHASE2=0
PHASE3=0; { [ "$SCENARIO" = all ] || [ "$SCENARIO" = day ]; } && [ "${TARGET:-localnet}" != devnet ] && [ "${LIKE_DEVNET:-0}" != 1 ] && PHASE3=1
COV="$TMP/coverage.json"
fail() { echo "✗ $*"; exit 1; }
# GET / is the landing build. A checkout without frontend/landing/dist/index.html answers 404 and the deploy smoke fails.
if [ ! -f "$ROOT/frontend/landing/dist/index.html" ]; then
  echo "▸ landing build (smoke requires GET /)"
  (cd "$ROOT/frontend/landing" && npm run build) || fail "landing build"
fi
free_port() { node -e 'const s=require("net").createServer();s.listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})'; }
free_pair() { for _ in $(seq 1 40); do local p; p=$(( 20000 + RANDOM % 30000 )); nc -z 127.0.0.1 "$p" 2>/dev/null || nc -z 127.0.0.1 $((p + 1)) 2>/dev/null || { echo "$p"; return; }; done; fail "no free port pair"; }
psql_admin() { docker exec freightchain-postgres psql -U freight -d postgres -v ON_ERROR_STOP=1 -tAc "$1"; }
cleanup() {
  local code=$?
  [ -n "$SRV_PID" ] && { kill "$SRV_PID" 2>/dev/null || true; wait "$SRV_PID" 2>/dev/null || true; }
  [ -n "$VAL_PID" ] && { kill "$VAL_PID" 2>/dev/null || true; wait "$VAL_PID" 2>/dev/null || true; }
  psql_admin "DROP DATABASE IF EXISTS \"$DB\" WITH (FORCE)" >/dev/null 2>&1 || true
  psql_admin "DROP DATABASE IF EXISTS \"$DB_DAY\" WITH (FORCE)" >/dev/null 2>&1 || true
  if [ "${KEEP:-0}" = 1 ] || [ "$code" != 0 ]; then echo "scratch kept: $TMP (validator.log, server.log, keys/)"; else rm -rf "$TMP"; fi
  exit "$code"
}
trap cleanup EXIT

TARGET="${TARGET:-localnet}"
if [ "$TARGET" = devnet ]; then
  ENVF="$SERVER/.env.devnet"; [ -f "$ENVF" ] || fail "no backend/server/.env.devnet – bash backend/server/scripts/devnet.sh env"
  envkey() { grep -E "^$1=" "$ENVF" | head -1 | cut -d= -f2- | sed 's/[[:space:]]*#.*$//'; }   # by key name, never printed
  MAIN="$(cd "$(dirname "$(git -C "$ROOT" rev-parse --path-format=absolute --git-common-dir)")" && pwd)"; DKEYS="${KEYS_DIR:-$MAIN/infra/deploy/secrets/devnet}"
  RPC="$(envkey SOLANA_RPC)"; WS="$(envkey SOLANA_WS)"; DEV_PROGRAM="$(envkey TICKET_PROGRAM_ID)"
  [ -n "$RPC" ] && [ -n "$DEV_PROGRAM" ] || fail "SOLANA_RPC and TICKET_PROGRAM_ID must be set in backend/server/.env.devnet (Phase 1: deploy + devnet.sh env)"
  [ "$DEV_PROGRAM" = "$PROGRAM_ID" ] || fail "the code is built for $PROGRAM_ID but .env.devnet says $DEV_PROGRAM – run anchor keys sync + rebuild (program-deploy.md step 1–3)"
  genesis="$(curl -sS -X POST -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"getGenesisHash"}' "$RPC" | node -pe 'JSON.parse(require("fs").readFileSync(0)).result')"
  [ "$genesis" = EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG ] || fail "SOLANA_RPC is not devnet (genesis $genesis) – refusing"
  mkdir -p "$TMP/keys"; for r in admin crank fee seed plat; do cp "$DKEYS/$r.json" "$TMP/keys/$r.json"; done; cp "$DKEYS/funder.json" "$TMP/keys/mint.json"
  pub() { solana-keygen pubkey "$TMP/keys/$1.json"; }
  echo "▸ devnet: program $PROGRAM_ID (RPC from backend/server/.env.devnet), keys from $DKEYS"
  (cd "$SERVER" && npm run --silent build >/dev/null)
  (cd "$SERVER" && node scripts/pool-admin.mjs show --url "$RPC" | node -e 'const j=JSON.parse(require("fs").readFileSync(0)); if (!j.config) { console.error("the program is not initialized on devnet (Phase 1)"); process.exit(1) } if (j.config.authority !== process.argv[1]) { console.error("Config.authority is not the devnet admin key"); process.exit(1) }' "$(pub admin)") || fail "devnet program not ready"
  FIXTURES=""
else
command -v solana-test-validator >/dev/null || fail "solana-test-validator missing (Agave CLI, see docs/spec/pool.md)"
[ -f "$SO" ] || fail "$SO missing – build the verifiable binary first: npm run program:verify"
if command -v solana-verify >/dev/null; then
  got="$(solana-verify get-executable-hash "$SO" 2>/dev/null | tail -1 || true)"
  [ "$got" = "$(cut -c1-64 "$PIN")" ] && echo "✓ program = the pinned verifiable build (${got:0:12}…)" || echo "! $SO is not the pinned verifiable build (${got:0:12}…) – testing other bytes than a deploy would ship"
fi
[ -d "$SERVER/node_modules" ] || fail "backend/server/node_modules missing – npm ci --prefix backend/server"

echo "▸ keys (scratch, throwaway)"
mkdir -p "$TMP/keys"
for k in mint upgrader admin crank fee seed plat payout; do solana-keygen new -s --no-bip39-passphrase -o "$TMP/keys/$k.json" >/dev/null; done
pub() { solana-keygen pubkey "$TMP/keys/$1.json"; }

RPC_PORT="$(free_pair)"; FAUCET_PORT="$(free_port)"; GOSSIP_PORT="$(free_port)"; DYN=$(( RPC_PORT < 40000 ? RPC_PORT + 2000 : RPC_PORT - 2000 ))
RPC="http://127.0.0.1:$RPC_PORT"; WS="ws://127.0.0.1:$((RPC_PORT + 1))"
# start_validator <ledger> [extra args…]: the program as an UPGRADEABLE program (real ProgramData, upgrade authority = upgrader), waits for health
# --limit-ledger-size: the test validator keeps only 10 000 shreds by default – a phase-2 ledger of ~12 minutes outgrew it and the coverage scan
# (getSignaturesForAddress) lost the money scenario's transactions
start_validator() {
  local ledger="$1"; shift
  solana-test-validator --ledger "$ledger" --reset --quiet --bind-address 127.0.0.1 --rpc-port "$RPC_PORT" --faucet-port "$FAUCET_PORT" \
    --gossip-port "$GOSSIP_PORT" --dynamic-port-range "$DYN-$((DYN + 30))" --mint "$(pub mint)" --limit-ledger-size 2000000 \
    --upgradeable-program "$PROGRAM_ID" "$SO" "$(pub upgrader)" "$@" > "$ledger.log" 2>&1 &
  VAL_PID=$!
  for _ in $(seq 1 90); do curl -sf -X POST -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' "$RPC" 2>/dev/null | grep -q '"ok"' && break; kill -0 "$VAL_PID" 2>/dev/null || { tail -20 "$ledger.log"; fail "validator exited"; }; sleep 1; done
  curl -sf -X POST -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' "$RPC" | grep -q '"ok"' || fail "validator not healthy after 90 s"
  for k in upgrader admin crank fee seed plat payout; do solana airdrop --url "$RPC" -k "$TMP/keys/mint.json" 100 "$(pub "$k")" >/dev/null; done
}
stop_validator() { kill "$VAL_PID" 2>/dev/null || true; wait "$VAL_PID" 2>/dev/null || true; VAL_PID=""; }

echo "▸ build the server (the scripts encode through its codec)"
(cd "$SERVER" && npm run --silent build >/dev/null)

echo "▸ phase 1 – fixtures: the real program makes two pools, then their deadlines are moved 16 days back (validator $RPC)"
start_validator "$TMP/fixtures-ledger"
(cd "$SERVER" && RPC="$RPC" KEYS="$TMP/keys" OUT="$TMP/accounts" COVERAGE="$COV" node scripts/localnet-fixtures.mjs) || fail "fixtures"
stop_validator
ACCOUNTS=(); for f in "$TMP"/accounts/*.json; do [ "$(basename "$f")" = fixtures.json ] && continue; ACCOUNTS+=(--account "$(node -p 'require(process.argv[1]).pubkey' "$f")" "$f"); done

if [ "$PHASE2" = 1 ]; then
echo "▸ phase 2 – a fresh ledger with the program + the baked Config, pools, vaults and tickets (${#ACCOUNTS[@]} args)"
start_validator "$TMP/ledger" "${ACCOUNTS[@]}"
echo "  rpc $RPC"
echo "▸ phase 2 – the baked Config is in the v3 layout: migrate_config_v4 by the admin (refusals first), then the floors back to 0"
(cd "$SERVER" && MIGRATE=1 RPC="$RPC" KEYS="$TMP/keys" OUT="$TMP/accounts" COVERAGE="$COV" node scripts/localnet-fixtures.mjs) || fail "config migration (phase 2)"
fi
FIXTURES="$TMP/accounts/fixtures.json"
fi

nc -z localhost 15433 || (cd "$ROOT" && npm run --silent db:up)
# start_server <database> <log> [VAR=value …]: a throwaway database (created + migrated) and dist/main.js on a free port; sets SRV_PID and BASE
start_server() {
  local db="$1" log="$2"; shift 2
  echo "▸ throwaway database $db"
  psql_admin "CREATE DATABASE \"$db\"" >/dev/null
  (cd "$SERVER" && DATABASE_URL="postgresql://freight:freight_dev_password@localhost:15433/$db" ./node_modules/.bin/prisma migrate deploy >/dev/null)
  local port; port="$(free_port)"; BASE="http://localhost:$port"
  (cd "$SERVER" && exec env DATABASE_URL="postgresql://freight:freight_dev_password@localhost:15433/$db" PORT="$port" "$@" node dist/main.js > "$log" 2>&1) &
  SRV_PID=$!
  for _ in $(seq 1 60); do curl -sf "$BASE/api/health/live" >/dev/null && break; kill -0 "$SRV_PID" 2>/dev/null || { tail -30 "$log"; fail "server exited"; }; sleep 0.5; done
  curl -sf "$BASE/api/health/live" >/dev/null || { tail -30 "$log"; fail "server did not start"; }
  echo "  server $BASE (log: $log)"
}
stop_server() { [ -n "$SRV_PID" ] && { kill "$SRV_PID" 2>/dev/null || true; wait "$SRV_PID" 2>/dev/null || true; }; SRV_PID=""; }

# Every key the server reads is set here, so a stray server/.env (dotenv never overrides) cannot point it at devnet or the dev database.
export DATABASE_URL="$URL" PAYMENT_MODE=program TICKET_PROGRAM_ID="$PROGRAM_ID" SOLANA_RPC="$RPC" SOLANA_WS="$WS" SOLANA_RPC_FALLBACKS="$([ "$TARGET" = devnet ] && echo https://api.devnet.solana.com)" SOLANA_COMMITMENT=confirmed \
  CRANK_SECRET="$(cat "$TMP/keys/crank.json")" CRANK_INTERVAL_MS=0 TREASURY_PUBKEY="$(pub admin)" FEE_TREASURY="$(pub fee)" SEED_TREASURY="$(pub seed)" \
  WEBHOOK_SECRET="$(node -e 'console.log(require("crypto").randomBytes(24).toString("base64url"))')" WATCH_INTERVAL_MS="$([ "$SCENARIO" = chaos ] && echo 0 || { [ "$TARGET" = devnet ] && echo 5000 || echo 2000; })" SOL_USD=118 DEMO_WALLETS='*' DEMO_SCALE=1200 FREE_RIDE_SECONDS=3 VERDICT_ENFORCE=true POSTHOG_ENABLED=0 PRIORITY_FEE_MAX_MICROLAMPORTS="$([ "$TARGET" = devnet ] && echo 50000 || echo 0)" \
  ADMIN_WALLETS="$(pub admin)" NODE_ENV=development PAYOUT_INTERVAL_MS=0 \
  PRIZE_DEV_DEFAULT_COUNTRY=KP \
  THROTTLE_LIMIT=10000 THROTTLE_AUTH_LIMIT=10000 THROTTLE_AUTH_RPS=1000   # the scenarios sign in a handful of wallets in one second; the default 5/s refuses the rest
export PAYOUT_SECRET=   # phase 2 has no payout key (empty = unset for the schema, and a stray server/.env cannot fill it): the admin pays (devnet-payout.mjs); phase 3 sets one
if [ "$PHASE2" = 1 ]; then
start_server "$DB" "$TMP/server.log"

echo "▸ scenario"
# LIKE_DEVNET=1: the devnet settings on the local validator (funder + sweep, small prices, no baked pools) – tests the devnet code path offline
[ "${LIKE_DEVNET:-0}" = 1 ] && FIXTURES=""
DEVNET_ENV=(); { [ "$TARGET" = devnet ] || [ "${LIKE_DEVNET:-0}" = 1 ]; } && DEVNET_ENV=(FUND_FROM="$TMP/keys/mint.json" FUND_LAMPORTS="${FUND_LAMPORTS:-60000000}" SWEEP=1 PRICE_A="${PRICE_A:-2000000}" PRICE_B="${PRICE_B:-1000000}" \
  SPONSOR_A="${SPONSOR_A:-1000000}" SPONSOR_C="${SPONSOR_C:-1000000}" PLAY_A="${PLAY_A:-240}" PREP_B="${PREP_B:-70}" PREP_C="${PREP_C:-80}")
if [ "$SCENARIO" = all ] || [ "$SCENARIO" = money ]; then
(cd "$SERVER" && env ${DEVNET_ENV[@]+"${DEVNET_ENV[@]}"} DATABASE_URL="$URL" BASE="$BASE" RPC="$RPC" KEYS="$TMP/keys" FIXTURES="$FIXTURES" COVERAGE="$COV" CHROME_PORT="$(free_port)" node scripts/e2e-localnet.mjs) || { echo "--- server log (tail) ---"; tail -40 "$TMP/server.log"; exit 1; }
if [ "$TARGET" = localnet ] && [ -n "$FIXTURES" ]; then
  (cd "$SERVER" && CLOSE_LEGACY=1 RPC="$RPC" KEYS="$TMP/keys" OUT="$TMP/accounts" node scripts/localnet-fixtures.mjs) || fail "legacy attestation rent recovery"
fi
fi
if [ "$SCENARIO" = all ] || [ "$SCENARIO" = payout ]; then
  [ "$TARGET" = devnet ] && fail "the payout scenario is local only (it pauses the program and hands its authority around)"
  echo "▸ scenario – ten riders, one pool: buys, rides, the cron, the payout job, ticket rents, the next seed, the rest of the program"
  (cd "$SERVER" && DATABASE_URL="$URL" BASE="$BASE" RPC="$RPC" KEYS="$TMP/keys" FIXTURES="$FIXTURES" COVERAGE="$COV" CHROME_PORT="$(free_port)" node scripts/e2e-localnet-payout.mjs) || { echo "--- server log (tail) ---"; tail -40 "$TMP/server.log"; exit 1; }
fi
if [ "$SCENARIO" = chaos ]; then
  echo "▸ scenario – chaos: two servers on one database behind a fault-injecting RPC proxy, several crankers at once (the server started above is inert: no watcher)"
  [ "$TARGET" = devnet ] && fail "the chaos scenario is local only (it spawns its own servers and pauses nothing, but its proxy sits in front of the validator)"
  (cd "$SERVER" && RPC="$RPC" KEYS="$TMP/keys" node scripts/e2e-localnet-chaos.mjs) || { echo "--- server logs (tail) ---"; tail -20 "$TMP"/chaos-s*.log 2>/dev/null; exit 1; }
elif [ "$TARGET" != devnet ]; then
  (cd "$SERVER" && node scripts/localnet-coverage.mjs scan "$COV" "$RPC" "phase 2 (scenario validator)") || fail "coverage scan of phase 2"
fi

echo "▸ deploy smoke (infra/deploy/scripts/smoke.mjs) against this program-mode server – its escrow checks"
node "$ROOT/infra/deploy/scripts/smoke.mjs" "$BASE" --no-signin || fail "smoke"
fi   # PHASE2

if [ "$PHASE3" = 1 ]; then
  # THE AUTONOMOUS DAY: a fresh validator with only the program + the 1h series phase 1 wrote (sale window shortened in its dump), initialized here by
  # the upgrade authority; its own database and server with the payout key (PAYOUT_SECRET) and the crank on a schedule – nobody runs the crank by hand
  stop_server; [ -n "$VAL_PID" ] && stop_validator
  echo "▸ phase 3 – the autonomous day: a fresh ledger with the program + the 1h series (next slot in ${DAY_LEAD:-75} s)"
  (cd "$SERVER" && RETIME=1 OUT="$TMP/accounts" LEAD="${DAY_LEAD:-75}" node scripts/localnet-fixtures.mjs) || fail "series retime"
  SER="$TMP/accounts/day/series-1h.json"
  start_validator "$TMP/day-ledger" --account "$(node -p 'require(process.argv[1]).pubkey' "$SER")" "$SER"
  echo "  rpc $RPC"
  (cd "$SERVER" && node scripts/pool-admin.mjs initialize --url "$RPC" -k "$TMP/keys/upgrader.json" --admin "$(pub admin)" --platform-treasury "$(pub plat)" --platform-fee-bps 500 >/dev/null) || fail "initialize (phase 3)"
  # v4: initialize sets the floors (1 h review, 3 h to finish) – the day's grid is seconds wide, and every pool snapshots Config.min_review_secs when it opens,
  # so they go to 0 BEFORE the crank can open slot 1 (the series itself was written in phase 1 under floors of 0)
  (cd "$SERVER" && node scripts/pool-admin.mjs set-config --url "$RPC" -k "$TMP/keys/admin.json" --min-review-secs 0 --min-finish-secs 0 >/dev/null) || fail "set-config floors (phase 3)"
  DAY_ENV=(PAYOUT_SECRET="$(cat "$TMP/keys/payout.json")" PAYOUT_INTERVAL_MS=0 TRUST_PROXY=1 PLEDGES_ENABLED=0)   # the server AND the scenario's CLI passes (pool:payout) – same database, same keys. New pledges stay off in the acceptance run as in the shipped default.
  start_server "$DB_DAY" "$TMP/server-day.log" "${DAY_ENV[@]}" CRANK_INTERVAL_MS="${DAY_CRANK_MS:-2000}" DEMO_SCALE=48   # the day's rides are all over the API: a 1 050 m line, so every winner has the whole km the payout key attests (v4: on the ride's own attestation)
  echo "▸ scenario – the autonomous day: the crank opens the 1h pools on their slots, riders buy and ride, the review window, the payout key pays"
  (cd "$SERVER" && env "${DAY_ENV[@]}" DATABASE_URL="$URL_DAY" BASE="$BASE" RPC="$RPC" KEYS="$TMP/keys" COVERAGE="$COV" DAY="$TMP/accounts/day/day.json" CHROME_PORT="$(free_port)" node scripts/e2e-localnet-day.mjs) || { echo "--- server log (tail) ---"; tail -40 "$TMP/server-day.log"; exit 1; }
  (cd "$SERVER" && node scripts/localnet-coverage.mjs scan "$COV" "$RPC" "phase 3 (the autonomous day)") || fail "coverage scan of phase 3"
  if [ "$PHASE2" = 0 ]; then echo "▸ deploy smoke against the day's server"; node "$ROOT/infra/deploy/scripts/smoke.mjs" "$BASE" --no-signin || fail "smoke"; fi
fi

if [ "$SCENARIO" != chaos ] && [ "$TARGET" != devnet ]; then
  echo "▸ coverage – every program transaction on the validators + the refusals + the LiteSVM tests"
  (cd "$SERVER" && node scripts/localnet-coverage.mjs report "$COV") > "$TMP/coverage.txt" 2>&1 && cov_ok=1 || cov_ok=0
  cat "$TMP/coverage.txt"
  [ "$SCENARIO" = all ] && [ "${LIKE_DEVNET:-0}" != 1 ] && [ "$cov_ok" = 0 ] && fail "coverage incomplete"
  [ "$SCENARIO" != all ] && [ "$cov_ok" = 0 ] && echo "(SCENARIO=$SCENARIO: only part of the program ran – the gate applies to SCENARIO=all)"
fi
true
