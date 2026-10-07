#!/usr/bin/env bash
# npm run deploy:init [-- --domain play.example.com --email you@example.com]
# Creates deploy/.env (gitignored) from deploy/.env.example with generated secrets + a local treasury keypair.
. "$(dirname "$0")/lib.sh"
need_cmd node "Node >= 22"
[ -d "$REPO_ROOT/server/node_modules/tweetnacl" ] || die "server dependencies are missing – run: npm install --prefix server"
node "$DEPLOY_DIR/scripts/init-env.mjs" "$@"
