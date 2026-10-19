#!/usr/bin/env bash
# Validate the four surfaces with the existing suites, then write the event map.
#   bash .claude/skills/posthog-map/run.sh
# Does not read the PostHog personal key and does not send an event.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
OUT="$ROOT/docs/insights/analytics/generated"
mkdir -p "$OUT"
redact() { sed -E 's/phc_[A-Za-z0-9]+/phc_REDACTED/g; s/phx_[A-Za-z0-9]+/phx_REDACTED/g'; }

landing_log="$OUT/landing-test.log"
e2e_log="$OUT/e2e.log"
echo "▸ landing tests (whitepaper + landing page)"
(cd "$ROOT/landing" && npm test) >"$landing_log" 2>&1 && landing_ok=1 || landing_ok=0
redact <"$landing_log" | tail -20
echo "▸ existing e2e: game (browser), lobby, landing sign-in (wallet)"
bash "$ROOT/.claude/skills/run-tests/e2e.sh" browser lobby wallet >"$e2e_log" 2>&1 && e2e_ok=1 || e2e_ok=0
redact <"$e2e_log" | tail -40

node -e '
const fs = require("fs");
const [landing, e2e, out] = process.argv.slice(1);
fs.writeFileSync(out, JSON.stringify([
  { name: "landing + whitepaper (npm test)", ok: landing === "1" },
  { name: "game + lobby + landing sign-in (e2e browser lobby wallet)", ok: e2e === "1" },
], null, 2));
' "$landing_ok" "$e2e_ok" "$OUT/checks.json"

node "$ROOT/.claude/skills/posthog-map/graph.mjs"
echo "map: docs/insights/analytics/generated/map.html"
[ "$landing_ok" = 1 ] && [ "$e2e_ok" = 1 ]
