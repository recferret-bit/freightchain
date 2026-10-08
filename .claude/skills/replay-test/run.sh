#!/usr/bin/env bash
# Live streams + replays end to end in real headless Chrome, on a THROWAWAY database (created, migrated and dropped by run-tests/e2e.sh – never the dev one):
#   bash .claude/skills/replay-test/run.sh            # both: watch (the live stream, 2 Chromes) + replay (a finished ride from the landing's ticker)
#   bash .claude/skills/replay-test/run.sh replay     # one of them
# Needs: Docker (the compose PostgreSQL – started if down), server/ + landing/ dependencies, Chrome. Builds the landing + server first. ~7 min for both.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
SUITES=("$@"); [ ${#SUITES[@]} -gt 0 ] || SUITES=(watch replay)
for s in "${SUITES[@]}"; do case "$s" in watch|replay) ;; *) echo "unknown suite $s (watch | replay)"; exit 2 ;; esac; done
exec bash "$ROOT/.claude/skills/run-tests/e2e.sh" "${SUITES[@]}"
