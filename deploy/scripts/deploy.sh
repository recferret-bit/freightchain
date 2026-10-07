#!/usr/bin/env bash
# npm run deploy [-- -y] [--skip-checks] [--allow-dirty] [--no-smoke] [--dry-run]
# Semi-automatic: checks → shows exactly what will happen → asks → uploads the COMMITTED code (git archive HEAD) → the server builds, backs up, migrates,
# swaps, health-checks and rolls back on failure → a sign-in smoke test against the public URL.
. "$(dirname "$0")/lib.sh"

SKIP_CHECKS=0; ALLOW_DIRTY=0; SMOKE=1; ASSUME_YES=0; DRY_RUN=0
for a in "$@"; do case "$a" in
  -y|--yes) ASSUME_YES=1 ;; --skip-checks) SKIP_CHECKS=1 ;; --allow-dirty) ALLOW_DIRTY=1 ;; --no-smoke) SMOKE=0 ;; --dry-run) DRY_RUN=1 ;;
  -h|--help) sed -n '2,5p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;; *) die "unknown option $a (see --help)" ;; esac; done

need_cmd git; need_cmd ssh; need_cmd node; need_cmd tar
load_env; refuse_placeholders
cd "$REPO_ROOT"

# ---- 1. what exactly is being deployed: a COMMIT, never the working tree
SHA="$(git rev-parse --short HEAD)"; BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  [ "$ALLOW_DIRTY" = "1" ] || die "uncommitted changes to tracked files – commit them first (only the commit is deployed), or pass --allow-dirty"
  warn "uncommitted changes are NOT part of the deploy (only commit $SHA is)"
fi
git fetch -q origin 2>/dev/null && { [ -z "$(git log origin/main..HEAD --oneline 2>/dev/null)" ] || warn "HEAD has commits that are not on origin/main yet"; } || true
RELEASE="$(date -u +%Y%m%d-%H%M%S)-$SHA"

# ---- 2. local checks, then the production environment validated by the server's own schema
if [ "$SKIP_CHECKS" = "1" ]; then warn "skipping npm run check"; else info "npm run check (client + server build + tests)"; npm run --silent check >/dev/null || die "npm run check failed – run it to see why (or --skip-checks)"; ok "checks passed"; fi
info "validating the production environment"; npm --prefix server run --silent build >/dev/null
app_env | node "$DEPLOY_DIR/scripts/validate-env.mjs" || die "deploy/.env is not a valid production environment (see above)"

# ---- 3. the server
info "checking ssh to ${DEPLOY_USER}@${DEPLOY_HOST}"; check_ssh
SETUP_DONE=1; rsh "test -f '$DEPLOY_PATH/state/setup-done' && test -f /etc/nginx/sites-available/freightchain-storybook" 2>/dev/null || SETUP_DONE=0
CURRENT="$(rsh "cat '$DEPLOY_PATH/state/current' 2>/dev/null || true")"

cat <<PLAN

${C_BOLD}Deploy plan${C_OFF}
  commit      $SHA  ($BRANCH)   release $RELEASE
  server      ${DEPLOY_USER}@${DEPLOY_HOST}:${DEPLOY_PATH}
  site        https://${DEPLOY_DOMAIN}  (landing + lobby)  ·  https://ride.${DEPLOY_DOMAIN}  (game)  ·  https://api.${DEPLOY_DOMAIN}  (API)  ·  https://storybook.${DEPLOY_DOMAIN}  (model viewer)
  serving now ${CURRENT:-nothing (first deploy)}
  first-time setup (nginx site + TLS certificate): $([ "$SETUP_DONE" = "1" ] && echo "already done" || echo "WILL RUN")
  steps       upload code + env → build image → backup database → migrate → swap → health check (auto-rollback on failure) → smoke test
PLAN
[ "$DRY_RUN" = "1" ] && { ok "dry run: the checks and the server connection are fine; nothing was changed"; exit 0; }
confirm "Deploy?"

# ---- 4. first-time setup, if needed
[ "$SETUP_DONE" = "1" ] || bash "$DEPLOY_DIR/scripts/setup.sh" --from-deploy

# ---- 5. upload: environment (chmod 600, over stdin – never in a command line) and the committed code
info "uploading the environment"
app_env | rsh "umask 077; mkdir -p '$DEPLOY_PATH' && cat > '$DEPLOY_PATH/.env.new' && mv '$DEPLOY_PATH/.env.new' '$DEPLOY_PATH/.env'"
info "uploading commit $SHA"
rsh "rm -rf '$DEPLOY_PATH/releases/$RELEASE' && mkdir -p '$DEPLOY_PATH/releases/$RELEASE'"
git archive --format=tar HEAD | rsh "tar -x -C '$DEPLOY_PATH/releases/$RELEASE'"

# ---- 6. release on the server
info "releasing $RELEASE on the server"
rscript "$DEPLOY_DIR/scripts/remote/release.sh" "DEPLOY_PATH=$DEPLOY_PATH" "RELEASE=$RELEASE" "APP_PORT=$DEPLOY_APP_PORT" "KEEP_RELEASES=$DEPLOY_KEEP_RELEASES" "KEEP_BACKUPS=$DEPLOY_KEEP_BACKUPS" \
  || die "the release failed on the server (output above). If it said it rolled back, the previous version is serving."

[ "$(rsh "cat '$DEPLOY_PATH/state/current' 2>/dev/null" || true)" = "$RELEASE" ] || die "the server script ended without finishing release $RELEASE (state/current is not it) – nothing is half-promoted; see the output above"

# ---- 7. is it really up, through nginx and TLS, with a working sign-in?
if [ "$SMOKE" = "1" ]; then info "smoke test against https://${DEPLOY_DOMAIN}"; node "$DEPLOY_DIR/scripts/smoke.mjs" "https://${DEPLOY_DOMAIN}" --api "https://api.${DEPLOY_DOMAIN}" --game "https://ride.${DEPLOY_DOMAIN}" --storybook "https://storybook.${DEPLOY_DOMAIN}" --treasury "$TREASURY_PUBKEY" || die "the smoke test failed – the release is up on the server, but the public site is not right (see above). Roll back with: npm run deploy:rollback"; fi
ok "deployed ${RELEASE} → https://${DEPLOY_DOMAIN}"
