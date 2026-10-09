#!/usr/bin/env bash
# Verified play (anti-bot / anti-cheat) end to end on a THROWAWAY database, local, headless Chrome – everything in two harnesses, then the game + close suites:
#   verified       server/scripts/e2e-verified-play.mjs   dispatch prompts: a person and a bot in Chrome, API bots answering instantly, the byte budget, the CLI
#   verified-deep  server/scripts/e2e-verified-deep.mjs    every verdict code one by one (prompts off), the upload protocol, who sees a verdict, the admin's signed
#                                                          decisions, the lobby profile in Chrome, retention + the bulk re-judge on the database
#   road           server/scripts/e2e-road-check.mjs       the server's road: an honest driver and one with the holes taken out (Chrome), the replay, the ride-audit tool
#   browser, close the game e2e (answers prompts) and a complete shift closed by its tab
#   bash .claude/skills/verified-play-test/run.sh          (~15 min; needs Docker for the compose PostgreSQL, server/ + landing/ deps, Chrome)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
exec bash "$ROOT/.claude/skills/run-tests/e2e.sh" verified verified-deep road browser close
