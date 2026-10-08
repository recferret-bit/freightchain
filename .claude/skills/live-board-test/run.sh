#!/usr/bin/env bash
# "Who is online / what is on the road / what can be replayed" end to end: a freshly built server on a THROWAWAY database (TRUST_PROXY=1, HB_TIMEOUT_MS=15000),
# fed by the ride simulator (server/scripts/sim-rides.mjs), checked in headless Chrome on the landing and the lobby (server/scripts/e2e-live-board.mjs),
# then closing pages – one origin and split hosts (server/scripts/e2e-close.mjs).
#   bash .claude/skills/live-board-test/run.sh          (~6 min; needs Docker for the compose PostgreSQL, server/ + landing/ deps, Chrome)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
exec bash "$ROOT/.claude/skills/run-tests/e2e.sh" board close close-split
