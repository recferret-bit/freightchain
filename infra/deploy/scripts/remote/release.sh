#!/usr/bin/env bash
# Runs ON THE SERVER (piped over ssh by deploy/scripts/deploy.sh) after the release's code and /srv/freightchain/.env are uploaded.
#   build the image → dump the database → migrate (new image, one-off) → swap the app container → health-check → (on failure) roll back.
# The old version keeps serving until the swap; a failed build / backup / migration aborts BEFORE it.
set -euo pipefail
for kv in "$@"; do export "$kv"; done
: "${DEPLOY_PATH:?}" "${RELEASE:?}" "${APP_PORT:?}" "${KEEP_RELEASES:?}" "${KEEP_BACKUPS:?}"
ROOT="$DEPLOY_PATH"; ENVF="$ROOT/.env"; STATE="$ROOT/state"
say() { printf '  [server] %s\n' "$*"; }
compose_file() {
  local tag="$1"
  if [ -f "$ROOT/releases/$tag/infra/deploy/docker-compose.prod.yml" ]; then
    printf '%s' "$ROOT/releases/$tag/infra/deploy/docker-compose.prod.yml"
  else
    printf '%s' "$ROOT/releases/$tag/deploy/docker-compose.prod.yml"
  fi
}
cc() { local tag="$1"; shift; RELEASE="$tag" APP_PORT="$APP_PORT" docker compose --env-file "$ENVF" -f "$(compose_file "$tag")" "$@" </dev/null; }   # </dev/null: the script itself arrives on stdin (ssh) – a compose command must not swallow the rest of it
wait_healthy() {
  local i; for i in $(seq 1 30); do
    curl -fsS -m 5 "http://127.0.0.1:$APP_PORT/api/health/ready" >/dev/null 2>&1 && return 0; sleep 2
  done; return 1
}
wait_service() {
  local tag="$1" service="$2" i id; id="$(cc "$tag" ps -q "$service")"
  [ -n "$id" ] || return 1
  for i in $(seq 1 30); do
    [ "$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$id" 2>/dev/null)" = healthy ] && return 0
    sleep 2
  done; return 1
}

[ -f "$STATE/setup-done" ] || { echo "run the first-time setup first: npm run deploy:setup" >&2; exit 1; }
[ -f "$(compose_file "$RELEASE")" ] || { echo "release $RELEASE was not uploaded" >&2; exit 1; }
bash "$ROOT/releases/$RELEASE/infra/deploy/scripts/remote/logging.sh" check
PREVIOUS="$(cat "$STATE/current" 2>/dev/null || true)"
say "release $RELEASE (currently serving: ${PREVIOUS:-nothing})"

say "building the image (the running version keeps serving)"
cc "$RELEASE" build --quiet app >/dev/null   # errors still print; the build log is noise
# the entity MCP for the AI model editor – only when it is switched on (EDITOR_MCP_TOKEN in .env, 24+ chars)
MCP=""; EDITOR=""; if grep -Eq '^EDITOR_MCP_TOKEN=.{24,}' "$ENVF"; then MCP=mcp; EDITOR=editor-worker; say "building the entity MCP image"; cc "$RELEASE" build --quiet mcp >/dev/null; fi

say "database"
if cc "$RELEASE" ps --status running --services 2>/dev/null | grep -qx postgres; then
  mkdir -p "$ROOT/backups"
  DUMP="$ROOT/backups/db-$RELEASE.sql.gz"
  cc "$RELEASE" exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' | gzip > "$DUMP" || { rm -f "$DUMP"; echo "database backup FAILED – nothing changed" >&2; exit 1; }
  say "backup: $DUMP ($(du -h "$DUMP" | cut -f1))"
  ls -1t "$ROOT"/backups/db-*.sql.gz 2>/dev/null | tail -n +$((KEEP_BACKUPS + 1)) | xargs rm -f 2>/dev/null || true
else
  say "first deploy: no database yet – starting it"
fi
cc "$RELEASE" up -d --wait postgres redis

say "migrating (new image, one-off)"
cc "$RELEASE" run --rm --no-deps app node dist/cli/index.js migrate || { echo "migration FAILED – the previous version is still serving, nothing swapped" >&2; exit 1; }

say "swapping the app and worker containers${MCP:+ (and the entity MCP + AI worker)}"
# Drain the old AI process before replacing the API or rolling back to an in-process runner.
cc "$RELEASE" stop editor-worker
if [ -z "$MCP" ]; then cc "$RELEASE" stop mcp; fi
if ! cc "$RELEASE" up -d --no-build app worker $MCP $EDITOR || ! wait_healthy || { [ -n "$MCP" ] && { ! wait_service "$RELEASE" mcp || ! wait_service "$RELEASE" editor-worker; }; }; then
  echo "release $RELEASE is NOT healthy – last logs:" >&2
  journalctl --namespace=freightchain --no-pager -o cat -n 80 >&2 || true
  if [ -n "$PREVIOUS" ] && [ -f "$(compose_file "$PREVIOUS")" ]; then
    echo "rolling back to $PREVIOUS" >&2
    cc "$RELEASE" stop editor-worker
    PREVIOUS_MCP=""; PREVIOUS_EDITOR=""
    if [ -n "$MCP" ] && cc "$PREVIOUS" config --services | grep -qx mcp; then PREVIOUS_MCP=mcp; fi
    if [ -n "$MCP" ] && cc "$PREVIOUS" config --services | grep -qx editor-worker; then PREVIOUS_EDITOR=editor-worker; fi
    if [ -n "$MCP" ] && [ -z "$PREVIOUS_MCP" ]; then cc "$RELEASE" stop mcp; fi
    cc "$PREVIOUS" up -d --no-build app worker $PREVIOUS_MCP $PREVIOUS_EDITOR
    if wait_healthy && { [ -z "$PREVIOUS_MCP" ] || wait_service "$PREVIOUS" mcp; } && { [ -z "$PREVIOUS_EDITOR" ] || wait_service "$PREVIOUS" editor-worker; }; then
      echo "rolled back: $PREVIOUS is serving again (the database stays migrated – migrations are forward-only)" >&2
      rm -rf "$ROOT/releases/$RELEASE"; docker rmi "freightchain-server:$RELEASE" "freightchain-mcp:$RELEASE" >/dev/null 2>&1 || true   # a failed release must not take a slot
    else
      echo "ROLLBACK FAILED too – check: npm run ops -- logs" >&2
    fi
  else
    echo "first release failed: nothing to roll back to (the containers are left running for inspection)" >&2
  fi
  exit 1
fi
say "healthy ✓ (http://127.0.0.1:$APP_PORT/api/health/ready)"

[ -n "$PREVIOUS" ] && [ "$PREVIOUS" != "$RELEASE" ] && echo "$PREVIOUS" > "$STATE/previous"
echo "$RELEASE" > "$STATE/current"
ln -sfn "$ROOT/releases/$RELEASE" "$ROOT/current"
printf '%s  %s\n' "$(date -u +%FT%TZ)" "$RELEASE" >> "$STATE/releases.log"

say "pruning: keeping the last $KEEP_RELEASES releases"
KEEP="$(ls -1t "$ROOT/releases" | head -n "$KEEP_RELEASES" | tr '\n' ' ') $RELEASE $PREVIOUS $(cat "$STATE/previous" 2>/dev/null || true)"
for dir in $(ls -1 "$ROOT/releases"); do case " $KEEP " in *" $dir "*) ;; *) rm -rf "$ROOT/releases/$dir"; say "removed release $dir" ;; esac; done
for img in freightchain-server freightchain-mcp; do
  for tag in $(docker images "$img" --format '{{.Tag}}'); do case " $KEEP " in *" $tag "*) ;; *) docker rmi "$img:$tag" >/dev/null 2>&1 && say "removed image $img:$tag" || true ;; esac; done
done
docker image prune -f >/dev/null 2>&1 || true
say "done"
