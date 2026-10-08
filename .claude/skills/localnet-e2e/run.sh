#!/usr/bin/env bash
# Full money e2e on a LOCAL chain: solana-test-validator with the escrow program (the verifiable .so, upgradeable) + the real server in PAYMENT_MODE=program
# on a THROWAWAY database + scripted wallets (Node keypairs and a fake Phantom in headless Chrome that signs real transactions).
#   bash .claude/skills/localnet-e2e/run.sh            (~3 min, paced by the pools' deadlines; see server/scripts/e2e-localnet.mjs)
# Env: SO=<path to the .so> (default target/deploy, should be the pinned verifiable build), KEEP=1 keeps the scratch dir (keys, ledger, logs),
#      PREP_A / PLAY_A / PREP_B = pool deadlines in seconds from creation (defaults in e2e-localnet.mjs).
# Never touches devnet, the global Solana config or ~/.config/solana/id.json: every key is generated into the scratch dir, every call has an explicit URL.
# Needs: the compose PostgreSQL (npm run db:up), server/ dependencies, Chrome, solana-test-validator (Agave 4.1.2), internet once (web3.js + three.js CDNs).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
SERVER="$ROOT/server"
export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$HOME/.avm/bin:$PATH"
SO="${SO:-$ROOT/programs/freightchain-pools/target/deploy/freightchain_pools.so}"
PIN="$ROOT/programs/freightchain-pools/verifiable-build.hash"
PROGRAM_ID="$(node -p 'require(process.argv[1]).address' "$ROOT/programs/freightchain-pools/idl/freightchain_pools.json")"
TMP="$(mktemp -d -t fc-localnet-XXXXXX)"
DB="freightchain_localnet_$$"
URL="postgresql://freight:freight_dev_password@localhost:15433/$DB"
VAL_PID=""; SRV_PID=""
fail() { echo "✗ $*"; exit 1; }
free_port() { node -e 'const s=require("net").createServer();s.listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})'; }
free_pair() { for _ in $(seq 1 40); do local p; p=$(( 20000 + RANDOM % 30000 )); nc -z 127.0.0.1 "$p" 2>/dev/null || nc -z 127.0.0.1 $((p + 1)) 2>/dev/null || { echo "$p"; return; }; done; fail "no free port pair"; }
psql_admin() { docker exec freightchain-postgres psql -U freight -d postgres -v ON_ERROR_STOP=1 -tAc "$1"; }
cleanup() {
  local code=$?
  [ -n "$SRV_PID" ] && { kill "$SRV_PID" 2>/dev/null || true; wait "$SRV_PID" 2>/dev/null || true; }
  [ -n "$VAL_PID" ] && { kill "$VAL_PID" 2>/dev/null || true; wait "$VAL_PID" 2>/dev/null || true; }
  psql_admin "DROP DATABASE IF EXISTS \"$DB\" WITH (FORCE)" >/dev/null 2>&1 || true
  if [ "${KEEP:-0}" = 1 ] || [ "$code" != 0 ]; then echo "scratch kept: $TMP (validator.log, server.log, keys/)"; else rm -rf "$TMP"; fi
  exit "$code"
}
trap cleanup EXIT

command -v solana-test-validator >/dev/null || fail "solana-test-validator missing (Agave CLI, see AGENTS.md 'Escrowed pools')"
[ -f "$SO" ] || fail "$SO missing – build the verifiable binary first: npm run program:verify"
if command -v solana-verify >/dev/null; then
  got="$(solana-verify get-executable-hash "$SO" 2>/dev/null | tail -1 || true)"
  [ "$got" = "$(cut -c1-64 "$PIN")" ] && echo "✓ program = the pinned verifiable build (${got:0:12}…)" || echo "! $SO is not the pinned verifiable build (${got:0:12}…) – testing other bytes than a deploy would ship"
fi
[ -d "$SERVER/node_modules" ] || fail "server/node_modules missing – npm ci --prefix server"

echo "▸ keys (scratch, throwaway)"
mkdir -p "$TMP/keys"
for k in mint upgrader admin sponsor crank fee seed plat; do solana-keygen new -s --no-bip39-passphrase -o "$TMP/keys/$k.json" >/dev/null; done
pub() { solana-keygen pubkey "$TMP/keys/$1.json"; }

RPC_PORT="$(free_pair)"; FAUCET_PORT="$(free_port)"; GOSSIP_PORT="$(free_port)"; DYN=$(( RPC_PORT < 40000 ? RPC_PORT + 2000 : RPC_PORT - 2000 ))
RPC="http://127.0.0.1:$RPC_PORT"; WS="ws://127.0.0.1:$((RPC_PORT + 1))"
# start_validator <ledger> [extra args…]: the program as an UPGRADEABLE program (real ProgramData, upgrade authority = upgrader), waits for health
start_validator() {
  local ledger="$1"; shift
  solana-test-validator --ledger "$ledger" --reset --quiet --bind-address 127.0.0.1 --rpc-port "$RPC_PORT" --faucet-port "$FAUCET_PORT" \
    --gossip-port "$GOSSIP_PORT" --dynamic-port-range "$DYN-$((DYN + 30))" --mint "$(pub mint)" \
    --upgradeable-program "$PROGRAM_ID" "$SO" "$(pub upgrader)" "$@" > "$ledger.log" 2>&1 &
  VAL_PID=$!
  for _ in $(seq 1 90); do curl -sf -X POST -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' "$RPC" 2>/dev/null | grep -q '"ok"' && break; kill -0 "$VAL_PID" 2>/dev/null || { tail -20 "$ledger.log"; fail "validator exited"; }; sleep 1; done
  curl -sf -X POST -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' "$RPC" | grep -q '"ok"' || fail "validator not healthy after 90 s"
  for k in upgrader admin sponsor crank fee seed plat; do solana airdrop --url "$RPC" -k "$TMP/keys/mint.json" 100 "$(pub "$k")" >/dev/null; done
}
stop_validator() { kill "$VAL_PID" 2>/dev/null || true; wait "$VAL_PID" 2>/dev/null || true; VAL_PID=""; }

echo "▸ build the server (the scripts encode through its codec)"
(cd "$SERVER" && npm run --silent build >/dev/null)

echo "▸ phase 1 – fixtures: the real program makes two pools, then their deadlines are moved 16 days back (validator $RPC)"
start_validator "$TMP/fixtures-ledger"
(cd "$SERVER" && RPC="$RPC" KEYS="$TMP/keys" OUT="$TMP/accounts" node scripts/localnet-fixtures.mjs) || fail "fixtures"
stop_validator
ACCOUNTS=(); for f in "$TMP"/accounts/*.json; do [ "$(basename "$f")" = fixtures.json ] && continue; ACCOUNTS+=(--account "$(node -p 'require(process.argv[1]).pubkey' "$f")" "$f"); done

echo "▸ phase 2 – a fresh ledger with the program + the baked Config, pools, vaults and tickets (${#ACCOUNTS[@]} args)"
start_validator "$TMP/ledger" "${ACCOUNTS[@]}"
echo "  rpc $RPC"

echo "▸ throwaway database $DB"
nc -z localhost 15433 || (cd "$ROOT" && npm run --silent db:up)
psql_admin "CREATE DATABASE \"$DB\"" >/dev/null
(cd "$SERVER" && DATABASE_URL="$URL" ./node_modules/.bin/prisma migrate deploy >/dev/null)

# Every key the server reads is set here, so a stray server/.env (dotenv never overrides) cannot point it at devnet or the dev database.
export DATABASE_URL="$URL" PAYMENT_MODE=program TICKET_PROGRAM_ID="$PROGRAM_ID" SOLANA_RPC="$RPC" SOLANA_WS="$WS" SOLANA_RPC_FALLBACKS= SOLANA_COMMITMENT=confirmed \
  FEE_PAYER_SECRET="$(cat "$TMP/keys/sponsor.json")" CRANK_SECRET="$(cat "$TMP/keys/crank.json")" CRANK_INTERVAL_MS=0 TREASURY_PUBKEY="$(pub admin)" FEE_TREASURY="$(pub fee)" SEED_TREASURY="$(pub seed)" \
  WATCH_INTERVAL_MS=2000 SOL_USD=118 DEMO_WALLETS='*' DEMO_SCALE=1200 FREE_RIDE_SECONDS=3 VERDICT_ENFORCE=true POSTHOG_ENABLED=0 PRIORITY_FEE_MAX_MICROLAMPORTS=0 \
  ADMIN_WALLETS= NODE_ENV=development
PORT="$(free_port)"; BASE="http://localhost:$PORT"
(cd "$SERVER" && PORT="$PORT" exec node dist/main.js > "$TMP/server.log" 2>&1) &
SRV_PID=$!
for _ in $(seq 1 60); do curl -sf "$BASE/api/health/live" >/dev/null && break; kill -0 "$SRV_PID" 2>/dev/null || { tail -30 "$TMP/server.log"; fail "server exited"; }; sleep 0.5; done
curl -sf "$BASE/api/health/live" >/dev/null || { tail -30 "$TMP/server.log"; fail "server did not start"; }
echo "  server $BASE (log: $TMP/server.log)"

echo "▸ scenario"
(cd "$SERVER" && BASE="$BASE" RPC="$RPC" KEYS="$TMP/keys" FIXTURES="$TMP/accounts/fixtures.json" CHROME_PORT="$(free_port)" node scripts/e2e-localnet.mjs) || { echo "--- server log (tail) ---"; tail -40 "$TMP/server.log"; exit 1; }
