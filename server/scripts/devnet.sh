#!/usr/bin/env bash
# The LOCAL DEVNET profile (docs/escrow-open-items.md Phases 1–2): keys, the RPC check, the local database and this machine's server against the program
# on Solana DEVNET. Never touches production, the global Solana config or ~/.config/solana/id.json; never prints a secret.
#   bash server/scripts/devnet.sh keys                generate the devnet keypairs (once) into deploy/secrets/devnet/ of the MAIN checkout, print their addresses
#   bash server/scripts/devnet.sh balances            their devnet balances (needs server/.env.devnet or RPC=…)
#   RPC=<https url> WS=<wss url> bash server/scripts/devnet.sh env    write server/.env.devnet from the keys (+ a fresh WEBHOOK_SECRET); TICKET_PROGRAM_ID once deployed
#   bash server/scripts/devnet.sh check-rpc           the endpoint is devnet, answers getProgramAccounts (the crank), the fee calls; the websocket URL is set
#   bash server/scripts/devnet.sh db                  create + migrate the local database freightchain_devnet
#   bash server/scripts/devnet.sh server              build and run the server with ENV_FILE=.env.devnet (http://localhost:3000)
#   bash server/scripts/devnet.sh cli pool:crank      the server CLI with the devnet profile (pool:register, pool:crank, …)
#   bash server/scripts/devnet.sh admin show          scripts/pool-admin.mjs with --url from .env.devnet (pass -k "$KEYS/admin.json" etc.)
#   bash server/scripts/devnet.sh payout <poolId> [--yes]   pay a pool's ranked prizes + close it with the admin key (the server must be running)
#   bash server/scripts/devnet.sh rehearse            the localnet money scenario against DEVNET (own server on a throwaway DB, players funded by `funder`)
#   bash server/scripts/devnet.sh airdrop <role> [SOL] try the public devnet faucet for one key (rate-limited; faucet.solana.com is the fallback)
#   bash server/scripts/devnet.sh distribute          fund the deploy wallet only (~9 SOL); this tops up every other key from it to its target
#   bash server/scripts/devnet.sh deploy              the guarded program deploy: pinned hash check → solana program deploy → initialize → on-chain hash = pin
set -euo pipefail
SERVER="$(cd "$(dirname "$0")/.." && pwd)"
MAIN="$(cd "$(dirname "$(git -C "$SERVER" rev-parse --path-format=absolute --git-common-dir)")" && pwd)"   # the main checkout, also from a worktree
KEYS="${KEYS:-$MAIN/deploy/secrets/devnet}"
ENVF="$SERVER/.env.devnet"
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
ROLES=(program-id deploy admin sponsor crank fee seed plat funder)
fail() { echo "✗ $*" >&2; exit 1; }
envkey() { [ -f "$ENVF" ] && grep -E "^$1=" "$ENVF" | head -1 | cut -d= -f2- | sed 's/[[:space:]]*#.*$//' || true; }   # by key name; never echoed by this script
rpc() { local u="${RPC:-$(envkey SOLANA_RPC)}"; [ -n "$u" ] || fail "no RPC: set RPC=… or write server/.env.devnet (devnet.sh env)"; echo "$u"; }
pub() { solana-keygen pubkey "$KEYS/$1.json"; }
call() { curl -sS -X POST -H 'content-type: application/json' -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"$1\",\"params\":${2:-[]}}" "$(rpc)"; }

case "${1:-help}" in
  keys)
    mkdir -p "$KEYS"; chmod 700 "$KEYS"
    for r in "${ROLES[@]}"; do [ -f "$KEYS/$r.json" ] || solana-keygen new -s --no-bip39-passphrase -o "$KEYS/$r.json" >/dev/null; chmod 600 "$KEYS/$r.json"; done
    echo "keys in $KEYS (gitignored – back them up; the program-id and deploy keys can't be recreated):"
    printf '  %-11s %s  %s\n' program-id "$(pub program-id)" 'the program address (no SOL)' deploy "$(pub deploy)" 'upgrade authority + pays the deploy: ~5 SOL' \
      admin "$(pub admin)" 'Config.authority = TREASURY_PUBKEY, import into Phantom: ~0.5 SOL' sponsor "$(pub sponsor)" 'gas sponsor: ~1 SOL' \
      crank "$(pub crank)" 'crank fees: ~0.3 SOL' fee "$(pub fee)" 'fee treasury: 0.01 SOL (rent-exempt)' seed "$(pub seed)" 'seed treasury: 0.01 SOL' \
      plat "$(pub plat)" 'platform treasury: 0.01 SOL' funder "$(pub funder)" 'funds the rehearsal players: ~1 SOL'
    ;;
  balances)
    for r in "${ROLES[@]}"; do [ -f "$KEYS/$r.json" ] || continue; l=$(call getBalance "[\"$(pub "$r")\"]" | node -pe 'JSON.parse(require("fs").readFileSync(0)).result?.value ?? "?"'); printf '  %-11s %-44s %s SOL\n' "$r" "$(pub "$r")" "$(node -pe "($l/1e9).toFixed(4)" 2>/dev/null || echo "$l")"; done
    ;;
  env)
    [ -n "${RPC:-}" ] || fail "RPC=<your QuickNode devnet https URL> (and WS=<wss URL>) – read from the environment, written only into server/.env.devnet"
    for r in admin sponsor crank fee seed; do [ -f "$KEYS/$r.json" ] || fail "no $r key – run: devnet.sh keys"; done
    PROGRAM="${TICKET_PROGRAM_ID:-$(envkey TICKET_PROGRAM_ID)}"
    WEBHOOK="$(envkey WEBHOOK_SECRET)"; [ -n "$WEBHOOK" ] || WEBHOOK="$(node -e 'console.log(require("crypto").randomBytes(24).toString("base64url"))')"
    umask 077
    # values travel through the environment into node (no shell quoting / sed escaping of URLs and keys); nothing is printed
    V_RPC="$RPC" V_WS="${WS:-}" V_PROGRAM="$PROGRAM" V_ADMIN="$(pub admin)" V_FEE="$(pub fee)" V_SEED="$(pub seed)" V_WEBHOOK="$WEBHOOK" \
    V_SPONSOR="$(tr -d ' \n' < "$KEYS/sponsor.json")" V_CRANK="$(tr -d ' \n' < "$KEYS/crank.json")" node -e '
      const fs = require("fs"), e = process.env, set = { SOLANA_RPC: e.V_RPC, SOLANA_WS: e.V_WS, TICKET_PROGRAM_ID: e.V_PROGRAM, TREASURY_PUBKEY: e.V_ADMIN,
        FEE_TREASURY: e.V_FEE, SEED_TREASURY: e.V_SEED, FEE_PAYER_SECRET: e.V_SPONSOR, CRANK_SECRET: e.V_CRANK, WEBHOOK_SECRET: e.V_WEBHOOK };
      const out = fs.readFileSync(process.argv[1], "utf8").split("\n").map(l => { const k = l.split("=")[0]; return k in set ? `${k}=${set[k]}` : l; }).join("\n");
      fs.writeFileSync(process.argv[2], out, { mode: 0o600 });' "$SERVER/.env.devnet.example" "$ENVF"
    echo "✓ wrote server/.env.devnet (gitignored, mode 600)$([ -z "$PROGRAM" ] && echo ' – TICKET_PROGRAM_ID empty until the program is deployed (then rerun with TICKET_PROGRAM_ID=…)')"
    ;;
  check-rpc)
    g=$(call getGenesisHash | node -pe 'JSON.parse(require("fs").readFileSync(0)).result ?? "error"')
    [ "$g" = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG" ] && echo "✓ devnet (genesis $g)" || fail "not devnet: genesis $g"
    gpa=$(call getProgramAccounts '["Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo",{"encoding":"base64","dataSize":1}]' | node -pe 'const j=JSON.parse(require("fs").readFileSync(0)); j.error ? "error " + j.error.code + " " + j.error.message : "ok (" + j.result.length + " accounts)"')
    [[ "$gpa" == ok* ]] && echo "✓ getProgramAccounts $gpa – the crank can list tickets" || echo "✗ getProgramAccounts: $gpa – the crank needs it (enable it on the endpoint, or another provider)"
    pf=$(call getRecentPrioritizationFees | node -pe 'const j=JSON.parse(require("fs").readFileSync(0)); j.error ? "error " + j.error.message : "ok"')
    echo "$([ "$pf" = ok ] && echo ✓ || echo ✗) getRecentPrioritizationFees $pf"
    qn=$(call qn_estimatePriorityFees '{"last_n_blocks":100,"api_version":2}' | node -pe 'const j=JSON.parse(require("fs").readFileSync(0)); j.error ? "not enabled (" + j.error.message + ") – optional, the server falls back" : "ok"')
    echo "• Priority Fee API add-on: $qn"
    [ -n "$(envkey SOLANA_WS)" ] && echo "✓ SOLANA_WS set (the watcher subscribes to the program's logs)" || echo "• SOLANA_WS not set – the watcher only polls (WATCH_INTERVAL_MS)"
    ;;
  db)
    nc -z localhost 15433 || (cd "$SERVER/.." && npm run --silent db:up)
    docker exec freightchain-postgres psql -U freight -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='freightchain_devnet'" | grep -q 1 \
      || docker exec freightchain-postgres psql -U freight -d postgres -c 'CREATE DATABASE "freightchain_devnet"' >/dev/null
    (cd "$SERVER" && DATABASE_URL="postgresql://freight:freight_dev_password@localhost:15433/freightchain_devnet" ./node_modules/.bin/prisma migrate deploy >/dev/null)
    echo "✓ freightchain_devnet migrated"
    ;;
  server)
    [ -f "$ENVF" ] || fail "no server/.env.devnet – devnet.sh env"
    [ -n "$(envkey TICKET_PROGRAM_ID)" ] || echo "! TICKET_PROGRAM_ID is empty – the server runs in transfer mode until the program is deployed"
    (cd "$SERVER" && npm run --silent build >/dev/null) && cd "$SERVER" && ENV_FILE=.env.devnet exec node dist/main.js
    ;;
  cli)
    shift; cd "$SERVER" && ENV_FILE=.env.devnet exec node dist/cli/index.js "$@"
    ;;
  admin)
    shift; cd "$SERVER" && exec node scripts/pool-admin.mjs "$@" --url "$(rpc)"
    ;;
  payout)
    shift; cd "$SERVER" && BASE="http://localhost:$(envkey PORT)" RPC="$(rpc)" ADMIN="$KEYS/admin.json" exec node scripts/devnet-payout.mjs "$@"
    ;;
  rehearse)
    cd "$SERVER/.." && TARGET=devnet KEYS_DIR="$KEYS" exec bash .claude/skills/localnet-e2e/run.sh
    ;;
  airdrop)
    r="${2:?role, e.g. deploy}"; amt="${3:-1}"
    solana airdrop --url https://api.devnet.solana.com "$amt" "$(pub "$r")" || echo "faucet refused (rate limit) – use https://faucet.solana.com for $(pub "$r")"
    ;;
  distribute)
    # target balances in lamports; only the missing part is sent, from the deploy wallet (which keeps the rest for the program deploy)
    for pair in admin:500000000 sponsor:1000000000 crank:300000000 funder:1000000000 fee:10000000 seed:10000000 plat:10000000; do
      r="${pair%%:*}"; want="${pair##*:}"
      have=$(call getBalance "[\"$(pub "$r")\"]" | node -pe 'JSON.parse(require("fs").readFileSync(0)).result.value')
      [ "$have" -ge "$want" ] && { echo "  $r has enough"; continue; }
      amt=$(node -pe "(($want - $have) / 1e9).toFixed(9)")
      solana transfer --url "$(rpc)" -k "$KEYS/deploy.json" --allow-unfunded-recipient --fee-payer "$KEYS/deploy.json" "$(pub "$r")" "$amt" >/dev/null && echo "  $r +$amt SOL" || fail "transfer to $r failed (is the deploy wallet funded?)"
    done
    ;;
  deploy)
    SO="$SERVER/../programs/freightchain-pools/target/deploy/freightchain_pools.so"; PIN="$SERVER/../programs/freightchain-pools/verifiable-build.hash"
    export PATH="$HOME/.cargo/bin:$PATH"
    [ -f "$SO" ] || fail "no $SO – npm run program:verify"
    [ "$(solana-verify get-executable-hash "$SO" | tail -1)" = "$(cut -c1-64 "$PIN")" ] || fail "the .so is not the pinned verifiable build – npm run program:verify (never deploy an anchor build)"
    [ "$(node -p 'require(process.argv[1]).address' "$SERVER/../programs/freightchain-pools/idl/freightchain_pools.json")" = "$(pub program-id)" ] || fail "the code is not built for $(pub program-id) – anchor keys sync + rebuild"
    echo "▸ deploy (or upgrade) $(pub program-id) – the deploy wallet pays the rent and is the upgrade authority"
    solana program deploy --url "$(rpc)" --keypair "$KEYS/deploy.json" --upgrade-authority "$KEYS/deploy.json" --program-id "$KEYS/program-id.json" "$SO"
    cd "$SERVER" && npm run --silent build >/dev/null
    if node scripts/pool-admin.mjs show --url "$(rpc)" | node -e 'process.exit(JSON.parse(require("fs").readFileSync(0)).config ? 0 : 1)'; then echo "• Config exists already (initialize skipped)"
    else
      echo "▸ initialize: the upgrade authority names the admin, platform cut 0"
      node scripts/pool-admin.mjs initialize --url "$(rpc)" -k "$KEYS/deploy.json" --admin "$(pub admin)" --platform-treasury "$(pub plat)" --platform-fee-bps 0 >/dev/null
    fi
    node scripts/pool-admin.mjs show --url "$(rpc)" | node -e 'const c=JSON.parse(require("fs").readFileSync(0)).config; if (c.authority !== process.argv[1]) { console.error("✗ Config.authority is NOT the devnet admin – someone else initialized: redeploy under a new id"); process.exit(1) } console.log("✓ Config.authority = the admin key, platform cut " + c.platformFeeBps + " bps")' "$(pub admin)"
    PROGRAM_ID="$(pub program-id)" RPC_URL="$(rpc)" bash "$SERVER/../.claude/skills/program-check/check.sh" onchain
    ;;
  *)
    sed -n '2,18p' "$0"; exit 1 ;;
esac
