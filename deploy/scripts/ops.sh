#!/usr/bin/env bash
# READ-ONLY look at production (logs, nginx, database, containers). Changes nothing on the server – never deploys, never writes to the database.
#   npm run ops -- logs  [--service app|worker|postgres|redis] [--lines N] [--since 30m] [--grep REGEX] [--errors]
#   npm run ops -- nginx [--error] [--lines N] [--grep REGEX]
#   npm run ops -- sql   "SELECT …"            (or SQL on stdin; runs in a read-only transaction, 15 s statement timeout)
#   npm run ops -- query <name> [arg]          (canned queries, see deploy/scripts/ops-queries.sql: `npm run ops -- query list`)
#   npm run ops -- ps                          (containers, restarts, disk)
# Needs deploy/.env (DEPLOY_HOST / DEPLOY_USER). From a git worktree it falls back to the main checkout's deploy/.env; or set DEPLOY_ENV_FILE.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
if [ -z "${DEPLOY_ENV_FILE:-}" ] && [ ! -f "$HERE/../.env" ]; then
  main="$(cd "$HERE" && git rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)"
  [ -n "$main" ] && [ -f "$main/../deploy/.env" ] && export DEPLOY_ENV_FILE="$main/../deploy/.env"
fi
. "$HERE/lib.sh"
need_cmd ssh; need_cmd base64
load_env
CMD="${1:-}"; shift || true
REMOTE="$DEPLOY_DIR/scripts/remote/ops.sh"
args=()

b64() { base64 | tr -d '\n'; }
run_sql() { rscript "$REMOTE" sql "SQL_B64=$(printf '%s' "$1" | b64)"; }

case "$CMD" in
  logs)
    while [ $# -gt 0 ]; do case "$1" in
      --service) args+=("SERVICE=$2"); shift ;; --lines) args+=("LINES=$2"); shift ;; --since) args+=("SINCE=$2"); shift ;;
      --grep) args+=("GREP=$2"); shift ;; --errors) args+=("ERRORS=1") ;; *) die "unknown option $1" ;; esac; shift; done
    rscript "$REMOTE" logs ${args[@]+"${args[@]}"} ;;
  nginx)
    while [ $# -gt 0 ]; do case "$1" in
      --error) args+=("WHICH=error") ;; --lines) args+=("LINES=$2"); shift ;; --grep) args+=("GREP=$2"); shift ;; *) die "unknown option $1" ;; esac; shift; done
    rscript "$REMOTE" nginx ${args[@]+"${args[@]}"} ;;
  sql)
    sql="${1:-}"; [ -n "$sql" ] || sql="$(cat)"
    [ -n "$sql" ] || die "no SQL given"
    run_sql "$sql" ;;
  query)
    name="${1:-list}"; arg="${2:-}"
    file="$HERE/ops-queries.sql"
    if [ "$name" = "list" ]; then grep -E '^-- @' "$file" | sed 's/^-- @/  /'; exit 0; fi
    sql="$(awk -v n="$name" '/^-- @/{on = ($2 == "@" n)} on && !/^-- @/' "$file")"
    [ -n "$sql" ] || die "no query named '$name' (npm run ops -- query list)"
    case "$sql" in *:arg*) [ -n "$arg" ] || die "query '$name' needs an argument"; esac
    case "$arg" in *"'"*) die "the argument must not contain a quote" ;; esac
    run_sql "${sql//:arg/$arg}" ;;
  ps) rscript "$REMOTE" ps ;;
  ""|-h|--help) sed -n '2,8p' "$0" | sed 's/^# \{0,1\}//' ;;
  *) die "unknown command '$CMD' (logs | nginx | sql | query | ps)" ;;
esac
