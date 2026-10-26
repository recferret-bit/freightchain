#!/usr/bin/env bash
# Reboot ordering for this project only. Never reconfigures/restarts the Docker daemon.
set -euo pipefail
ROOT="${1:?deployment root}"
[ -f "$ROOT/state/current" ] || exit 0
bash "$ROOT/state/logging.sh" check
tag="$(cat "$ROOT/state/current")"
[[ "$tag" =~ ^[A-Za-z0-9._-]+$ ]] || { echo 'invalid current release tag' >&2; exit 1; }
compose="$ROOT/releases/$tag/infra/deploy/docker-compose.prod.yml"
[ -f "$compose" ] || compose="$ROOT/releases/$tag/deploy/docker-compose.prod.yml"
services=(postgres redis app worker)
if grep -Eq '^EDITOR_MCP_TOKEN=.{24,}' "$ROOT/.env"; then services+=(mcp editor-worker); fi
RELEASE="$tag" docker compose --env-file "$ROOT/.env" -f "$compose" up -d --no-build "${services[@]}"
