---
name: posthog-audit
description: >
  Compare Freight Chain's PostHog insights to the spec and write a readable
  report of every misconfiguration. Use when asked to check the dashboards,
  funnels, retention, paths, stickiness, or lifecycle, or /posthog-audit.
  Invites an apply. Does not change PostHog unless the user says to apply.
---

# PostHog audit

```sh
node .claude/skills/posthog-audit/audit.mjs
```

Reads the personal key from `deploy/secrets/posthog-personal.key` (gitignored, mode 600). That file is not `POSTHOG_KEY`. A `phx_` value in `POSTHOG_KEY` turns capture off. The script never prints the key.

It loads dashboard `1006663` and every saved insight on EU project 297915, and compares them to `.claude/skills/posthog-audit/spec.mjs`. The report is `docs/insights/analytics/generated/audit.html`. Exit 1 means at least one fix is waiting.

What it treats as wrong: a missing judge tile, a step whose event is empty ("All events"), a funnel with no conversion window, a missing filter on a funnel or trend series, a math that is missing or wrong (an omitted math is total), a 7 day acquisition, a chart range other than 8–12 Oct 2026, a judge insight not pinned to 1006663, a retention / paths / stickiness / lifecycle / acquisition insight pinned to that board, `$pageview` on the judge board, any other insight pinned there that is not in the spec, and the page-speed OR group. The `$pageview` template dashboard is reported and left alone. Apply does not delete it.

The event map is `posthog-map`. This skill does not run the browser suites and does not send an event.

## Apply, only when the user says so

The report ends by asking. Do not run the writer because the audit exited 1. Run it only after the user says **apply the PostHog fixes**:

```sh
node .claude/skills/posthog-audit/apply.mjs          # dry run
node .claude/skills/posthog-audit/apply.mjs --apply  # create and update
```

`--apply` creates a missing `FC ·` insight and patches a matched one in place, including the broken free-activation funnel whose last step is "All events". It pins only the rows marked pin in the spec. It does not delete the 7 day acquisition or the template insights. Then run `audit.mjs` again.
