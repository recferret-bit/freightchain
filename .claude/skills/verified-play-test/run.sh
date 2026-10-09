#!/usr/bin/env bash
# Verified play (anti-bot / anti-cheat) end to end on a THROWAWAY database: a person and a bot in real headless Chrome, API-level bots with hand-built
# recordings (every negative case), the byte budget, and the CLI's bulk re-judge – server/scripts/e2e-verified-play.mjs – then the game + close suites
# that also answer dispatch prompts.
#   bash .claude/skills/verified-play-test/run.sh          (~6 min; needs Docker for the compose PostgreSQL, server/ + landing/ deps, Chrome)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
exec bash "$ROOT/.claude/skills/run-tests/e2e.sh" verified browser close
