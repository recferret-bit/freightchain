#!/usr/bin/env bash
# HONK on a LOCAL validator: program GctCYSHbCnHN8sE1LjUL9cmSpFd5mcVdfaumRcaVWZZx (swap, burn, frozen part), then (unless SCENARIO=chain)
# a paid ride on a throwaway database. The pool is that program's, on this validator only. No devnet, no ~/.config/solana/id.json.
#   bash .claude/skills/honk-localnet/run.sh
#   SCENARIO=chain   token half only (no PostgreSQL)
#   SCENARIO=session ride half only – RPC, KEYS, BASE and DATABASE_URL must already be set
#   KEEP=1           leave the scratch dir
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
SERVER="$ROOT/server"
export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$HOME/.avm/bin:$PATH"
SCENARIO="${SCENARIO:-all}"
case "$SCENARIO" in chain|session|all) ;; *) echo "✗ SCENARIO must be chain, session or all"; exit 2 ;; esac
fail() { echo "✗ $*"; exit 1; }
if [ "$SCENARIO" = session ]; then
  [ -n "${RPC:-}" ] && [ -n "${KEYS:-}" ] && [ -n "${BASE:-}" ] && [ -n "${DATABASE_URL:-}" ] || fail "SCENARIO=session needs RPC, KEYS, BASE and DATABASE_URL"
  (cd "$SERVER" && node scripts/e2e-honk-chain.mjs)
  exit $?
fi
command -v solana-test-validator >/dev/null || fail "solana-test-validator missing"
[ -d "$SERVER/node_modules" ] || fail "server/node_modules missing – npm ci --prefix server"
SO="$ROOT/programs/target/deploy/freightchain_honk.so"
[ -f "$SO" ] || fail "missing $SO – from programs run: anchor build --arch v0 -p freightchain_honk"
TMP="$(mktemp -d -t fc-honk-XXXXXX)"
DB="freightchain_honk_local_$$"
URL="postgresql://freight:freight_dev_password@localhost:15433/$DB"
VAL_PID=""; SRV_PID=""; DB_CREATED=0
free_port() { node -e 'const s=require("net").createServer();s.listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})'; }
free_pair() { for _ in $(seq 1 40); do local p; p=$(( 20000 + RANDOM % 30000 )); nc -z 127.0.0.1 "$p" 2>/dev/null || nc -z 127.0.0.1 $((p + 1)) 2>/dev/null || { echo "$p"; return; }; done; fail "no free port pair"; }
psql_admin() { docker exec freightchain-postgres psql -U freight -d postgres -v ON_ERROR_STOP=1 -tAc "$1"; }
cleanup() {
  local code=$?
  [ -n "$SRV_PID" ] && { kill "$SRV_PID" 2>/dev/null || true; wait "$SRV_PID" 2>/dev/null || true; }
  [ -n "$VAL_PID" ] && { kill "$VAL_PID" 2>/dev/null || true; wait "$VAL_PID" 2>/dev/null || true; }
  [ "$DB_CREATED" = 1 ] && psql_admin "DROP DATABASE IF EXISTS \"$DB\" WITH (FORCE)" >/dev/null 2>&1 || true
  if [ "${KEEP:-0}" = 1 ] || [ "$code" != 0 ]; then echo "scratch kept: $TMP"; else rm -rf "$TMP"; fi
  exit "$code"
}
trap cleanup EXIT
mkdir -p "$TMP/keys"
: > "$TMP/empty.env"
for k in payer mint treasury player spectator; do solana-keygen new -s --no-bip39-passphrase -o "$TMP/keys/$k.json" >/dev/null; done
pub() { solana-keygen pubkey "$TMP/keys/$1.json"; }
RPC_PORT="$(free_pair)"; FAUCET_PORT="$(free_port)"; GOSSIP_PORT="$(free_port)"
DYN=$(( RPC_PORT < 40000 ? RPC_PORT + 2000 : RPC_PORT - 2000 ))
RPC="http://127.0.0.1:$RPC_PORT"
# --mint is the payer, not the HONK mint: that account is funded at genesis, so it cannot also be created as the SPL mint.
solana-test-validator --ledger "$TMP/ledger" --reset --quiet --bind-address 127.0.0.1 --rpc-port "$RPC_PORT" --faucet-port "$FAUCET_PORT" \
  --gossip-port "$GOSSIP_PORT" --dynamic-port-range "$DYN-$((DYN + 30))" --mint "$(pub payer)" \
  --upgradeable-program GctCYSHbCnHN8sE1LjUL9cmSpFd5mcVdfaumRcaVWZZx "$SO" "$TMP/keys/payer.json" \
  > "$TMP/validator.log" 2>&1 &
VAL_PID=$!
for _ in $(seq 1 90); do curl -sf -X POST -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' "$RPC" 2>/dev/null | grep -q '"ok"' && break; kill -0 "$VAL_PID" 2>/dev/null || { tail -20 "$TMP/validator.log"; fail "validator exited"; }; sleep 1; done
curl -sf -X POST -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' "$RPC" | grep -q '"ok"' || fail "validator not healthy after 90 s"
for k in payer treasury player spectator; do
  solana airdrop --url "$RPC" -k "$TMP/keys/payer.json" 100 "$(pub "$k")" >/dev/null || fail "airdrop $k"
done
echo "▸ chain ($RPC)"
(cd "$SERVER" && RPC="$RPC" KEYS="$TMP/keys" SCENARIO=chain node scripts/e2e-honk-chain.mjs) || { tail -20 "$TMP/validator.log"; fail "chain"; }
[ "$SCENARIO" = chain ] && exit 0
nc -z localhost 15433 || (cd "$ROOT" && npm run --silent db:up)
echo "▸ throwaway database $DB"
psql_admin "CREATE DATABASE \"$DB\"" >/dev/null
DB_CREATED=1
(cd "$SERVER" && DATABASE_URL="$URL" ./node_modules/.bin/prisma migrate deploy >/dev/null)
(cd "$SERVER" && npm run --silent build >/dev/null)
PORT="$(free_port)"; BASE="http://localhost:$PORT"
MINT="$(tr -d '[:space:]' < "$TMP/keys/mint-address.txt")"
# Donations are `off` (the schema is on|off) so weather is not a donation. No HONK_MINT_SECRET: the server must not mint a second NFT.
(cd "$SERVER" && exec env -i PATH="$PATH" HOME="$HOME" ENV_FILE="$TMP/empty.env" \
  DATABASE_URL="$URL" PORT="$PORT" SOLANA_RPC="$RPC" \
  HONK_PROGRAM_ID="GctCYSHbCnHN8sE1LjUL9cmSpFd5mcVdfaumRcaVWZZx" \
  HONK_EMITTER_SECRET="$(cat "$TMP/keys/payer.json")" \
  HONK_MINT="$MINT" \
  FREE_RIDE_SECONDS=30 SOL_USD=118 TREASURY_PUBKEY="$(pub treasury)" \
  JWT_SECRET="honk-localnet-jwt-secret-not-a-real-key" \
  LIVE_EFFECTS=off LIVE_DONATIONS=off \
  ${HONK_VERDICT:+DEMO_WALLETS='*' DEMO_SCALE=60} \
  node dist/main.js > "$TMP/server.log" 2>&1) &
SRV_PID=$!
for _ in $(seq 1 60); do curl -sf "$BASE/api/health/live" >/dev/null && break; kill -0 "$SRV_PID" 2>/dev/null || { tail -30 "$TMP/server.log"; fail "server exited"; }; sleep 0.5; done
curl -sf "$BASE/api/health/live" >/dev/null || { tail -30 "$TMP/server.log"; fail "server did not start"; }
echo "▸ session ($BASE)"
(cd "$SERVER" && RPC="$RPC" KEYS="$TMP/keys" BASE="$BASE" DATABASE_URL="$URL" ENV_FILE="$TMP/empty.env" CHROME_PORT="$(free_port)" SCENARIO=session node scripts/e2e-honk-chain.mjs) || { echo "--- server log (tail) ---"; tail -40 "$TMP/server.log"; fail "session"; }
if [ "${HONK_VERDICT:-0}" = 1 ]; then
  echo "▸ verified ride ($BASE)"
  (cd "$SERVER" && RPC="$RPC" KEYS="$TMP/keys" BASE="$BASE" DATABASE_URL="$URL" node scripts/e2e-honk-verdict.mjs) || { echo "--- server log (tail) ---"; tail -40 "$TMP/server.log"; fail "verdict"; }
fi
