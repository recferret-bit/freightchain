---
name: ride-audit
description: Audit a Freight Chain ride stream straight from the database – local, devnet or PRODUCTION (read-only) – and say whether it is honest. Loads the ride and its whole recording, rebuilds the ride's road and its holes from the seed with the server's own code, re-hashes every batch, re-measures every sample and input (each planned hole the truck drove through and the damage it showed, off-road time, speed gained with no gas), judges the ride again at the current rules and compares that with the verdict on record. Use when asked "is this stream / ride / replay OK", "did this driver cheat", "check ride <id>", "audit the latest rides / this wallet", to look into a flagged or rejected ride, or after changing the verdict, the road generator or the obstacle plan.
---

# Ride audit – is this stream honest?

```sh
bash .claude/skills/ride-audit/run.sh <ride id>                        # one ride, the full report (local database: DATABASE_URL, else server/.env)
bash .claude/skills/ride-audit/run.sh <ride id> --prod                 # the same ride on PRODUCTION (read-only, through npm run ops -- sql)
bash .claude/skills/ride-audit/run.sh --latest 20 --prod               # the 20 latest started rides, one line each, then every NOT OK one in full
bash .claude/skills/ride-audit/run.sh --latest 10 --wallet <address> --status completed
… --json (machine-readable) · --all-passes (every axle pass of every hole, not only the bad ones) · --db <url> · ENV_FILE=.env.devnet (devnet profile)
```

`run.sh` builds a private copy of the server (`server/.audit-build-<pid>`, removed afterwards) and runs `server/scripts/ride-audit.mjs`, which calls
`auditRide()` (`server/src/domain/verdict/ride-audit.ts`) – the same functions the live verdict uses, so the two cannot disagree. Exit 0 = every ride OK,
1 = at least one NOT OK, 2 = usage / loading error. About 20 s for the build, then a second or two per ride.

## What it does with a ride

1. **Loads** one row set with a single `SELECT` (the ride, every batch's gzip payload, the stored verdict). Production goes through `deploy/scripts/ops.sh sql`:
   `docker exec … psql` inside a read-only transaction with a 15 s statement timeout – a write is refused by PostgreSQL itself. Locally it opens a
   `SET TRANSACTION READ ONLY` transaction. Nothing is ever written. Production needs no deploy: the audit runs HERE with this checkout's code.
2. **Rebuilds the road** from the ride's seed – `server/src/domain/road` (the layout + the obstacle plan, a port of `client/js/net/` that
   `road-drift.spec.ts` holds to the game). This is the same plan the driver's game was handed (`GET /api/watch/:id/road`) and a replay draws.
3. **Re-hashes** every batch (the stored `hashOk` is not trusted) and **re-measures every sample** – nothing stored is taken on trust:
   - every planned hole the truck reached: per axle (front, drive, trailer) how far the wheel was inside the pit, the speed, the hull before and after,
     and the damage the game takes there (`holeDamage`: hull % ∝ v², rear axles × 0.6, none below 3 m/s). HIT = the hull shows it, AVOIDED = the wheels
     went past, IGNORED = driven through at speed with no damage – **the game never had that hole**;
   - the longest off-road spell (the game ends a ride after 20 s; the server's answer covers everything past the start junction);
   - speed gained while the gas pedal was up and no gas key went down (flat road: only the engine can speed the truck up);
   - the input events: presses, presses on the gas; the dispatch prompts and the human-timing statistics through the verdict.
4. **Judges again** at the current `RULES_VERSION` (`RideVerdict.judge` on the fresh measurements) and prints it next to the verdict on record.

## Reading the report

```
ROAD       the server's plan from seed 462706227: 2 holes on the driven stretch, 2 reached by the truck
    0.61 km  sinkhole lane   2.4  t    27.6 s  ✗ IGNORED  hull −0.0 % (the game takes 19.0 %)
             axle front · wheel 1.01 m inside the pit · v 21.98 → 21.98 m/s · hull 100 → 100 · ignored
VERDICT    judged now (rules v3): REJECTED
  ✗ obstacle-ignored – drove through 2 of the 2 planned holes it reached without a scratch – …
ON RECORD  rejected (rules v3) obstacle-ignored · same as now
RESULT     NOT OK – rejected: obstacle-ignored
```

- `RESULT OK` = verified now: the chain is intact, the recording covers and matches the ride, the truck reacted to every planned hole it drove through,
  the timing looks human, the prompts were answered.
- A batch is measured together with the tail of the batch before it, as on upload, so a client that cuts its batches right at the pits gains nothing; a
  pass that still has no sample before the pit is `unmeasured` (2 such holes flag `obstacle-unmeasured` – batches uploaded out of order).
- `IGNORED` holes are the clearest sign of a modified game (holes taken out of the client). One alone only flags (`obstacle-no-impact`) – look at the
  pass lines: a wheel "0.4 m inside" is close to the edge; two or more reject.
- `ON RECORD … DIFFERS` = the stored verdict was judged at older rules (or before the road was measured: rides recorded before rules v3 have no road facts
  on record, the audit measures them anyway) or an admin decided it by hand (`set by hand by …`). Re-judging in bulk is `verdict:rejudge` (the CLI –
  it WRITES; only with the user's go on production).
- Watch it as a spectator: `play.html?watch=<ride id>` (production `ride.<apex>/play.html?watch=…`) – the replay draws the server's holes, rings each
  ignored one red, marks it on the timeline and stamps NO IMPACT when it gets there.

## What it cannot tell

It checks the recording against the server's road, it does not re-simulate the truck (floats, variable dt – docs/agents/client.md "The sim is not replayable").
A modified game that drives over the holes AND fakes the matching hull loss is a game that hit the holes. Traffic is simulated in the browser and only
recorded for replays (never judged); the holes spectators paid for are placed by the driver's game and are not judged either. Rows from before the input
column (old recordings) skip the gas check.

## Finding rides to audit

- by wallet / status: `--latest N --wallet <address> --status completed|failed|abandoned|running`
- the review queue / one ride's rows: the `prod-db` skill (`npm run --silent ops -- query flagged`, `query ride <id>`), the story of a ride: `ride-investigate`
- end to end (an honest driver, a driver with the holes taken out, a spectator, this tool): `bash .claude/skills/run-tests/e2e.sh road`
