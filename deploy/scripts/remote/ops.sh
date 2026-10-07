#!/usr/bin/env bash
# Runs ON THE SERVER: READ-ONLY observation (piped over ssh by deploy/scripts/ops.sh). Nothing here changes the server.
#   $1 = logs | nginx | sql | ps
#   logs   SERVICE=app|postgres LINES=200 SINCE=<docker --since, e.g. 30m / 2026-10-08T10:00:00> GREP=<extended regex> ERRORS=1 (level warn/error only)
#   nginx  WHICH=access|error LINES=200 GREP=<regex>
#   sql    SQL_B64=<base64 SQL>  – runs in a READ-ONLY transaction (default_transaction_read_only=on): a write fails, nothing is committed
#   ps     the stack's containers, their health, restarts and the volume / disk use
set -euo pipefail
CMD="$1"; shift
for kv in "$@"; do export "$kv"; done
PROJECT=freightchain-prod
cid() { docker ps -q -f "label=com.docker.compose.project=$PROJECT" -f "label=com.docker.compose.service=$1" | head -n 1; }
need() { local id; id="$(cid "$1")"; [ -n "$id" ] || { echo "no running '$1' container of $PROJECT" >&2; exit 1; }; printf '%s' "$id"; }

case "$CMD" in
  logs)
    id="$(need "${SERVICE:-app}")"
    args=(--tail "${LINES:-200}"); [ -n "${SINCE:-}" ] && args=(--since "$SINCE")
    out="$(docker logs "${args[@]}" "$id" 2>&1)"
    [ -n "${GREP:-}" ] && out="$(printf '%s\n' "$out" | grep -E -- "$GREP" || true)"
    [ "${ERRORS:-}" = "1" ] && out="$(printf '%s\n' "$out" | grep -E -i -- '"level":"(warn|error|fatal)"|\b(WARN|ERROR)\b' || true)"
    printf '%s\n' "$out"
    ;;
  nginx)
    f="/var/log/nginx/${WHICH:-access}.log"
    [ -r "$f" ] || { echo "$f not readable" >&2; exit 1; }
    if [ -n "${GREP:-}" ]; then grep -E -- "$GREP" "$f" | tail -n "${LINES:-200}" || true; else tail -n "${LINES:-200}" "$f"; fi
    ;;
  sql)
    : "${SQL_B64:?SQL_B64 is required}"
    id="$(need postgres)"
    printf '%s' "$SQL_B64" | base64 -d | docker exec -i "$id" sh -c 'PGOPTIONS="-c default_transaction_read_only=on -c statement_timeout=15000" psql -X -q -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -P pager=off'
    ;;
  ps)
    docker ps -a -f "label=com.docker.compose.project=$PROJECT" --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}\t{{.RunningFor}}'
    for s in app postgres; do id="$(cid "$s")"; [ -n "$id" ] && echo "$s restarts: $(docker inspect -f '{{.RestartCount}}' "$id")"; done
    docker system df --format 'table {{.Type}}\t{{.Size}}\t{{.Reclaimable}}' 2>/dev/null || true
    df -h / | awk 'NR==2{print "disk /: "$4" free ("$5" used)"}'
    ;;
  *) echo "unknown command $CMD (logs | nginx | sql | ps)" >&2; exit 2 ;;
esac
