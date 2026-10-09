---
name: stats-reconcile
description: Check and repair Freight Chain's statistics (total rides, driven time and distance, crashes, stream donations – per rider and for the whole game) by recomputing them from the rides and donation events and diffing them with the stored totals. Local database with an optional --fix; production read-only. Use when the landing's DRIVEN, ALL TIME or a rider's DRIVING RECORD looks wrong, after a crash or a manual database edit, after changing what counts in the statistics, or when asked to "reconcile / audit the statistics", or /stats-reconcile.
---

# Statistics reconciliation

The statistics tables are **running totals** (`stats."PlayerStats"` per rider, `stats."GlobalStats"` one row), written with atomic increments when a ride ends and
when a donation lands (`StatsService`, docs/statistics.md). Everything they hold can be recomputed from `ride."Ride"` (started rides that ended: metres, driven
seconds, crash counters) and `live."RideEvent"` (donations, on the ride owner; lamports only when a transfer paid them) – that is the ground truth, the same rule
the migration's backfill used.

## Run

```sh
bash .claude/skills/stats-reconcile/run.sh                      # local DB (server/.env): report the drift, change nothing
bash .claude/skills/stats-reconcile/run.sh --wallet <address>   # one rider
bash .claude/skills/stats-reconcile/run.sh --fix                # rewrite the rows (rider rows from the truth, the global row = the sum of all riders)
bash .claude/skills/stats-reconcile/run.sh --prod               # PRODUCTION, read-only: the same comparison as one SQL query (prints only the riders that drift; no rows = clean)
bash .claude/skills/stats-reconcile/run.sh --prod-cli                      # PRODUCTION through the app container's CLI (`npm run deploy:stats`): the same JSON report as locally, read-only
bash .claude/skills/stats-reconcile/run.sh --prod-cli --fix                # PRODUCTION rewrite – only on the user's explicit ask in the CURRENT message; asks to confirm
```

It is the server CLI `node dist/cli/index.js stats:reconcile [--wallet A] [--fix]` (`ReconcileStatsHandler`); the result is JSON: `checked`, `drifted[]` (wallet → field →
`{ stored, truth }`), `days[]` (the per-day history rows that differ), `global` (the game row vs the sum of all riders, null = clean), `fixed`.

## Rules

- **Never `--fix` production on your own.** It rewrites live rows; only when the user asks for it in their CURRENT message. Then `--prod-cli --fix` (= `npm run deploy:stats -- --fix`), and re-run `--prod` to confirm it is clean. **After the first deploy of the statistics release run `--prod-cli` once** (rides that ended between the migration's backfill and the container swap).
- Run `--fix` when the app is quiet: a ride that ends while it runs is counted by the live write and may be overwritten by the older snapshot – run it again and it is clean. Seconds / metres are floats; a difference under 0.01 is rounding, not drift.
- A cache (Redis) holds the public numbers for ≤ 15 s; a CLI fix drops the keys it knows, otherwise they expire by themselves.
- Drift that comes back means a code path that ends a ride or lands a donation does not call `StatsService` – `test/architecture/stats-hooks.spec.ts` guards the application layer; find the new path.
- Not an e2e: the whole loop (real game → server → landing / profile → reconcile) is `bash .claude/skills/run-tests/e2e.sh stats`.
