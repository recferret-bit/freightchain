#!/usr/bin/env bash
# Fast gate: every suite `npm run check` runs, then integration, block 1, and the security suite.
# The three after check use separate databases and can overlap once PostgreSQL is healthy.
# check finishes its server build before block 1 reads dist. A failing suite fails this script.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "=== npm run check ==="
npm run check

# Security's global setup creates and migrates its own database; the container must be ready first.
npm run db:up

echo "=== npm run server:integration ==="
echo "=== npm run test:e2e:block1 ==="
echo "=== npm run test:ci:security ==="
pids=()
names=()
start() {
  local name="$1"
  shift
  ("$@") &
  pids+=("$!")
  names+=("$name")
}
start server:integration npm run server:integration
start test:e2e:block1 npm run test:e2e:block1
start test:ci:security npm run test:ci:security

fail=0
for i in "${!pids[@]}"; do
  if wait "${pids[$i]}"; then
    echo "=== ok ${names[$i]} ==="
  else
    echo "=== FAIL ${names[$i]} ==="
    fail=1
  fi
done
exit "$fail"
