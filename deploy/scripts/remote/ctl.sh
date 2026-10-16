#!/usr/bin/env bash
# Runs ON THE SERVER: maintenance commands (piped over ssh by deploy/scripts/ctl.sh).  $1 = status | logs | backup | rollback | stats
set -euo pipefail
CMD="$1"; shift
for kv in "$@"; do export "$kv"; done
: "${DEPLOY_PATH:?}" "${APP_PORT:?}"
ROOT="$DEPLOY_PATH"; ENVF="$ROOT/.env"; STATE="$ROOT/state"
CURRENT="$(cat "$STATE/current" 2>/dev/null || true)"; PREVIOUS="$(cat "$STATE/previous" 2>/dev/null || true)"
cc() { local tag="$1"; shift; RELEASE="$tag" APP_PORT="$APP_PORT" docker compose --env-file "$ENVF" -f "$ROOT/releases/$tag/deploy/docker-compose.prod.yml" "$@" </dev/null; }   # </dev/null: the script itself arrives on stdin (ssh) – a compose command must not swallow the rest of it
healthy() { curl -fsS -m 5 "http://127.0.0.1:$APP_PORT/api/health/ready" >/dev/null 2>&1; }

extras() {
  local tag="$1" service
  grep -Eq '^EDITOR_MCP_TOKEN=.{24,}' "$ENVF" || return 0
  for service in mcp editor-worker; do
    if cc "$tag" config --services | grep -qx "$service"; then printf '%s ' "$service"; fi
  done
}
switch_release() {
  local from="$1" to="$2" services
  if cc "$from" config --services | grep -qx editor-worker; then cc "$from" stop editor-worker || return 1; fi
  services="$(extras "$to")"
  if ! printf '%s\n' "$services" | grep -qw mcp && cc "$from" config --services | grep -qx mcp; then cc "$from" stop mcp || return 1; fi
  cc "$to" up -d --no-build app worker $services
}
extras_healthy() {
  local tag="$1" service id
  for service in $(extras "$tag"); do
    id="$(cc "$tag" ps -q "$service")"
    [ -n "$id" ] && [ "$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$id" 2>/dev/null)" = healthy ] || return 1
  done
}

case "$CMD" in
  status)
    echo "release   current=${CURRENT:-none}  previous=${PREVIOUS:-none}"
    [ -n "$CURRENT" ] && cc "$CURRENT" ps || echo "(nothing deployed yet)"
    healthy && echo "health    ready ✓" || echo "health    NOT ready"
    echo "history   $(tail -n 3 "$STATE/releases.log" 2>/dev/null | tr '\n' ';')"
    echo "backups   $(ls -1t "$ROOT"/backups/db-*.sql.gz 2>/dev/null | head -n 3 | xargs -n1 basename 2>/dev/null | tr '\n' ' ')"
    echo "disk      $(df -h "$ROOT" | awk 'NR==2{print $4" free ("$5" used)"}')"
    command -v nginx >/dev/null && nginx -t 2>&1 | tail -1 || true
    if [ -n "${DOMAIN:-}" ] && command -v certbot >/dev/null; then certbot certificates --cert-name "$DOMAIN" 2>/dev/null | grep -E 'Expiry|Domains' || true; fi
    ;;
  logs)
    [ -n "$CURRENT" ] || { echo "nothing deployed yet" >&2; exit 1; }
    cc "$CURRENT" logs --tail "${LINES:-200}" ${FOLLOW:+-f} "${SERVICE:-app}"
    ;;
  backup)
    [ -n "$CURRENT" ] || { echo "nothing deployed yet" >&2; exit 1; }
    DUMP="$ROOT/backups/db-manual-$(date -u +%Y%m%d-%H%M%S).sql.gz"
    cc "$CURRENT" exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' | gzip > "$DUMP" || { rm -f "$DUMP"; echo "backup FAILED" >&2; exit 1; }
    echo "backup: $DUMP ($(du -h "$DUMP" | cut -f1))"
    ;;
  rollback)
    [ -n "$PREVIOUS" ] || { echo "no previous release to roll back to" >&2; exit 1; }
    [ -f "$ROOT/releases/$PREVIOUS/deploy/docker-compose.prod.yml" ] || { echo "release $PREVIOUS is gone (pruned)" >&2; exit 1; }
    echo "rolling back $CURRENT → $PREVIOUS"
    SWITCHED=true; if ! switch_release "$CURRENT" "$PREVIOUS"; then SWITCHED=false; fi
    for i in $(seq 1 30); do healthy && extras_healthy "$PREVIOUS" && break; sleep 2; done
    if [ "$SWITCHED" = true ] && healthy && extras_healthy "$PREVIOUS"; then
      echo "$CURRENT" > "$STATE/previous"; echo "$PREVIOUS" > "$STATE/current"; ln -sfn "$ROOT/releases/$PREVIOUS" "$ROOT/current"
      printf '%s  ROLLBACK to %s\n' "$(date -u +%FT%TZ)" "$PREVIOUS" >> "$STATE/releases.log"
      echo "now serving $PREVIOUS (the database keeps any newer migrations – they are forward-only)"
    else
      echo "ROLLBACK FAILED – $PREVIOUS is not healthy; putting $CURRENT back" >&2
      switch_release "$PREVIOUS" "$CURRENT"; exit 1
    fi
    ;;
  stats)   # statistics reconcile through the running app container's CLI: a report (read-only), or FIX=1 = rewrite the rows. WALLET=<address> = one rider
    [ -n "$CURRENT" ] || { echo "nothing deployed yet" >&2; exit 1; }
    cc "$CURRENT" exec -T app node dist/cli/index.js stats:reconcile ${WALLET:+--wallet "$WALLET"} ${FIX:+--fix}
    ;;
  *) echo "unknown command $CMD" >&2; exit 2 ;;
esac
