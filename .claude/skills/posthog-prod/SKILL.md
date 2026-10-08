---
name: posthog-prod
description: >
  Check Freight Chain product analytics on production (freightchain.fun). Read-only: the boot
  line, one public landing_viewed probe, and the success flush log. Use when asked to check
  PostHog on prod, confirm ingest, or /posthog-prod. Local smoke is posthog-test.
---

# PostHog on production (read-only)

```sh
bash .claude/skills/posthog-prod/check.sh
SINCE=2h bash .claude/skills/posthog-prod/check.sh
```

The script is the check. It uses `npm run ops` (read-only ssh) and one `POST` to `https://api.freightchain.fun/api/telemetry`. It does not deploy, does not edit `deploy/.env`, does not print `POSTHOG_KEY`, and does not call the PostHog API.

Pass, inside `SINCE` (default `15m`): the latest boot line is `analytics enabled host=https://eu.i.posthog.com`, nothing logged `analytics flush failed`, the probe returned `enabled: true`, `accepted: 1`, `dropped: 0`, and a new `analytics flush ok` line names `landing_viewed`. A missing boot line means the process started outside the window: rerun with a larger `SINCE`. Do not treat a missing boot line as a pass.

Activity (a person, logged in): https://eu.posthog.com/project/297915/activity/explore
Board https://eu.posthog.com/project/297915/dashboard/1006663 stays empty until tiles exist. This skill does not open it and does not create tiles.

Local smoke is `posthog-test`. General production logs are `prod-logs`. Neither skill deploys. The kill switch is `POSTHOG_DISABLED=1` in `deploy/.env` plus a deploy, and only when a flush storm is already happening and the user asked to deploy.
