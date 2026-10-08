#!/usr/bin/env bash
# Read-only production check of PostHog capture.
#   bash .claude/skills/posthog-prod/check.sh
#   SINCE=2h bash .claude/skills/posthog-prod/check.sh
# Uses npm run ops (read-only ssh) and one public telemetry probe.
# Never prints POSTHOG_KEY. Never edits deploy/.env. Never deploys.
set -euo pipefail
SKILL="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SKILL/../../.." && pwd)"
cd "$ROOT"
SINCE="${SINCE:-15m}"
API="https://api.freightchain.fun/api/telemetry"

redact() { sed -E 's/phc_[A-Za-z0-9]+/phc_REDACTED/g; s/phx_[A-Za-z0-9]+/phx_REDACTED/g'; }
fetch() { npm run --silent ops -- logs --since "$SINCE" --grep 'analytics ' | redact; }
count_landing() {
  printf '%s\n' "$1" | grep 'analytics flush ok' | grep -c 'landing_viewed' || true
}

echo "▸ production logs since $SINCE"
LOGS="$(fetch)"
BOOTS="$(printf '%s\n' "$LOGS" | grep -E 'analytics enabled host=|analytics disabled' || true)"
if [ -z "$BOOTS" ]; then
  echo "no analytics boot line in the last $SINCE. The process may be older. Rerun with SINCE=24h." >&2
  exit 1
fi
LAST="$(printf '%s\n' "$BOOTS" | tail -n 1)"
case "$LAST" in
  *"analytics enabled host=https://eu.i.posthog.com"*) ;;
  *) echo "latest boot is not EU capture:"; printf '%s\n' "$LAST"; exit 1 ;;
esac
echo "  boot: analytics enabled host=https://eu.i.posthog.com"

BEFORE="$(count_landing "$LOGS")"
ANON="anon_$(node -e 'process.stdout.write(crypto.randomUUID())')"
echo "▸ probe landing_viewed"
RAW="$(curl -sS -m 20 -w '\n%{http_code}' -X POST "$API" \
  -H 'content-type: application/json' \
  -d "{\"anon_id\":\"$ANON\",\"events\":[{\"event\":\"landing_viewed\",\"properties\":{\"surface\":\"prod-check\"}}]}")"
CODE="${RAW##*$'\n'}"
BODY="${RAW%$'\n'*}"
if [ "$CODE" != "200" ]; then echo "probe HTTP $CODE: $(printf '%s' "$BODY" | redact)"; exit 1; fi
node -e '
  const body = JSON.parse(process.argv[1]);
  if (body.enabled !== true || body.accepted !== 1 || body.dropped !== 0) {
    console.error("probe rejected: " + JSON.stringify(body));
    process.exit(1);
  }
' "$BODY"
echo "  relay: enabled=true accepted=1 dropped=0"

echo "▸ waiting for analytics flush ok"
FOUND=0
for _ in 1 2 3 4 5 6 7 8; do
  sleep 2
  LOGS="$(fetch)"
  NOW="$(count_landing "$LOGS")"
  if [ "$NOW" -gt "$BEFORE" ]; then FOUND=1; break; fi
done
FAILS="$(printf '%s\n' "$LOGS" | grep 'analytics flush failed' || true)"
if [ -n "$FAILS" ]; then
  echo "analytics flush failed in the last $SINCE:"
  printf '%s\n' "$FAILS"
  exit 1
fi
if [ "$FOUND" != 1 ]; then
  echo "no new analytics flush ok naming landing_viewed within 16s" >&2
  printf '%s\n' "$LOGS" | grep 'analytics flush' || true
  exit 1
fi
echo "✔ production analytics: EU boot, probe accepted, flush ok names landing_viewed"
printf '%s\n' "$LOGS" | grep 'analytics flush ok' | grep 'landing_viewed' | tail -n 1
echo "  activity: https://eu.posthog.com/project/297915/activity/explore"
echo "  board 1006663 stays empty until tiles exist; this check does not open it"
