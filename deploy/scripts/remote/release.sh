#!/usr/bin/env bash
# Runs ON THE SERVER (piped over ssh by deploy/scripts/deploy.sh) after the release's code and /srv/freightchain/.env are uploaded.
#   build the image → dump the database → migrate (new image, one-off) → swap the app container → health-check → (on failure) roll back.
# The old version keeps serving until the swap; a failed build / backup / migration aborts BEFORE it.
set -euo pipefail
for kv in "$@"; do export "$kv"; done
: "${DEPLOY_PATH:?}" "${RELEASE:?}" "${APP_PORT:?}" "${KEEP_RELEASES:?}" "${KEEP_BACKUPS:?}"
ROOT="$DEPLOY_PATH"; ENVF="$ROOT/.env"; STATE="$ROOT/state"
say() { printf '  [server] %s\n' "$*"; }
cc() { local tag="$1"; shift; RELEASE="$tag" APP_PORT="$APP_PORT" docker compose --env-file "$ENVF" -f "$ROOT/releases/$tag/deploy/docker-compose.prod.yml" "$@" </dev/null; }   # </dev/null: the script itself arrives on stdin (ssh) – a compose command must not swallow the rest of it
wait_healthy() {
  local i; for i in $(seq 1 30); do
    curl -fsS -m 5 "http://127.0.0.1:$APP_PORT/api/health/ready" >/dev/null 2>&1 && return 0; sleep 2
  done; return 1
}

[ -f "$STATE/setup-done" ] || { echo "run the first-time setup first: npm run deploy:setup" >&2; exit 1; }
[ -f "$ROOT/releases/$RELEASE/deploy/docker-compose.prod.yml" ] || { echo "release $RELEASE was not uploaded" >&2; exit 1; }
PREVIOUS="$(cat "$STATE/current" 2>/dev/null || true)"
say "release $RELEASE (currently serving: ${PREVIOUS:-nothing})"

say "building the image (the running version keeps serving)"
cc "$RELEASE" build --quiet app >/dev/null   # errors still print; the build log is noise

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
cc "$RELEASE" up -d --wait postgres

say "migrating (new image, one-off)"
cc "$RELEASE" run --rm --no-deps app node dist/cli/index.js migrate || { echo "migration FAILED – the previous version is still serving, nothing swapped" >&2; exit 1; }

say "swapping the app container"
cc "$RELEASE" up -d --no-build app
if ! wait_healthy; then
  echo "release $RELEASE is NOT healthy – last logs:" >&2
  cc "$RELEASE" logs --tail 40 app >&2 || true
  if [ -n "$PREVIOUS" ] && [ -f "$ROOT/releases/$PREVIOUS/deploy/docker-compose.prod.yml" ]; then
    echo "rolling back to $PREVIOUS" >&2
    cc "$PREVIOUS" up -d --no-build app
    if wait_healthy; then
      echo "rolled back: $PREVIOUS is serving again (the database stays migrated – migrations are forward-only)" >&2
      rm -rf "$ROOT/releases/$RELEASE"; docker rmi "freightchain-server:$RELEASE" >/dev/null 2>&1 || true   # a failed release must not take a slot
    else
      echo "ROLLBACK FAILED too – check: docker compose logs" >&2
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
for tag in $(docker images freightchain-server --format '{{.Tag}}'); do case " $KEEP " in *" $tag "*) ;; *) docker rmi "freightchain-server:$tag" >/dev/null 2>&1 && say "removed image $tag" || true ;; esac; done
docker image prune -f >/dev/null 2>&1 || true
say "done"
