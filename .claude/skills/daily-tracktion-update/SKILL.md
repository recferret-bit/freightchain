---
name: daily-tracktion-update
description: >
  Refresh the README Traction block for hackathon review. Runs posthog-audit
  for the insight definitions, reads the public stats API, and writes only
  figures that survived a second pass. Use for a daily traction update, the
  judge scoreboard, or /daily-tracktion-update. Does not deploy and does not
  apply PostHog fixes. Does not read X or YouTube.
---

# Daily traction update

From the repo root:

```sh
node .claude/skills/daily-tracktion-update/update.mjs
node .claude/skills/daily-tracktion-update/update.mjs --self-test
```

The command rewrites the block between `<!-- traction:start -->` and `<!-- traction:end -->` in `README.md`, and writes `docs/insights/traction/latest.json`. The `## Traction` heading is placed on the line after the game banner (`landing/public/media/day.webp`). The headline has two rows: the public stats, then PostHog (landing people, whitepaper readers, real sign-ins, real starts, finishes split demo and real). The judge window and the through-today window both stay in the table under Analytics. X and YouTube are not read and are not written.

Sources, in this order of what a headline is allowed to claim:

1. `node .claude/skills/posthog-audit/audit.mjs` for whether the saved EU insights still match the spec. Exit 1 is recorded. This command does not run `apply.mjs`.
2. One HogQL read of project 297915, twice, for the judge window (8–12 Oct 2026, the range `posthog-audit` pins) and for 8 Oct through today. `surface=prod-check` is dropped. Ride totals are `source=server`, split by `is_demo`. Client `ride_completed` is not queried.
3. `https://freightchain.fun/api/stats`, twice. The shifts line is this response. When PostHog's finished-shift count disagrees, both numbers are shown and the headline stays on this endpoint.

A stats body whose free and paid do not add up, or whose timestamp is in the future, is dropped. Two HogQL reads that disagree are dropped. The script still writes the block, with a dash where a source failed.
