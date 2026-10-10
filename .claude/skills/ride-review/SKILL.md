---
name: ride-review
description: Say which Freight Chain PAID rides need an admin's eyes before prizes are paid – every completed paid ride that is UNDER REVIEW (flagged, rejected by the machine checks, or not judged, with no admin decision), per pool, with its rank and distance in the pool, its verdict reasons including the pool-level attention marks (pool-distance-outlier, pool-shared-ip, pool-new-wallet-top3) and the marks `pool:attention` would add now, each ride audited from scratch by the ride-audit tool (OK / NOT OK) – local database by default, PRODUCTION read-only with --prod. Never changes a verdict; it says what to look at and how to decide on the admin page. Use when asked "which rides need review", "what is in the review queue", "is pool N ready to pay", "can we pay pool N", "review the paid rides", or /ride-review.
---

# Ride review – what needs an admin's eyes?

```sh
bash .claude/skills/ride-review/run.sh                      # every pool, local database (DATABASE_URL, else server/.env)
bash .claude/skills/ride-review/run.sh --pool 3             # one pool – "is pool 3 ready to pay?"
bash .claude/skills/ride-review/run.sh --pool 3 --prod      # the same on PRODUCTION (read-only, through npm run ops -- sql)
… --no-audit (list only) · --limit N (audit at most N rides, default 50) · --json · --db <url> · ENV_FILE=.env.devnet (devnet profile)
```

`run.sh` builds a private copy of the server once (`server/.review-build-<pid>`, removed afterwards) and runs `server/scripts/ride-review.mjs`, which
reads the rows with the same read-only access as `ride-audit` (production: `deploy/scripts/ops.sh sql` = `docker exec … psql` in a read-only
transaction with a 15 s timeout – PostgreSQL refuses any write; locally a `SET TRANSACTION READ ONLY` transaction) and audits every listed ride with
`server/scripts/ride-audit.mjs --json` on that same build. Exit **0** = nothing waits for an admin (the pool is ready as far as review goes), **1** =
rides are under review (or would be after `pool:attention`), **2** = usage / loading error. About 20 s for the build, then a second or two per ride.

## What "under review" means (server/src/domain/verdict/ride-review.ts)

Every completed PAID ride is reviewed before it can win money; the review is derived from the verdict, nothing extra is stored:

| verdict | admin decided? | review (what the rider sees) |
|---|---|---|
| verified | – or ACCEPT | **ACCEPTED** |
| flagged · pending · not judged | no | **UNDER REVIEW** |
| rejected by the machine checks | no | **UNDER REVIEW** – a machine reject is not final for the player |
| rejected | REJECT | **REJECTED** |

Free rides and paid rides that did not complete have no review. The admin page's REVIEW QUEUE (`GET /api/admin/rides?review=under_review[&pool=N]`)
lists exactly these paid rides first, then the flagged free rides.

## Pool-level attention marks (server/src/domain/verdict/pool-attention.ts)

Not verdict rules – they look across one pool's top 20 and append `flag` reasons to every completed ride of the marked wallet in that pool:
`pool-distance-outlier` (total > 1.5 × the top-20 median, ≥ 4 wallets), `pool-shared-ip` (two ranked wallets signed in from one IP),
`pool-new-wallet-top3` (a top-3 wallet first seen < 24 h before its first ride in the pool). They are WRITTEN only by
`PoolAttentionService.markPool` – the CLI `cd server && node dist/cli/index.js pool:attention --pool N` and the payout job before it pays; an admin's
decision is never touched and a second run changes nothing. This skill only previews them (`pool:attention would add: …`); running the CLI on
production WRITES and needs the user's explicit go.

## Reading the report

```
POOL 3
  #1   9b2c…  7xQp…  1h  41.20 km   3600 s  UNDER REVIEW
        verdict flagged – ◆ pool-distance-outlier
          · pool-distance-outlier: drove 41.2 km in pool 3 – more than 1.5× the median of its top 20 (22.0 km)
        audit   OK – judged now: verified
        details: bash .claude/skills/ride-audit/run.sh 9b2c… · admin page #ride/9b2c…
```

- `audit OK` + only flag reasons (gaps, timing, ◆ pool marks): watch the replay (`play.html?watch=<id>`), check the sign-ins; ACCEPT when a person drove.
- `audit NOT OK` with reject reasons (no-recording, obstacle-ignored, hash-mismatch, teleport…): REJECT.
- `◆ pool-shared-ip`: compare the two wallets on the admin page → sign-ins; a household or a café is fine, one person's wallets in one pool are not.
- `NOT JUDGED`: open the ride on the admin page and press JUDGE NOW first.
- `ACCEPTED now – pool:attention would put it UNDER REVIEW`: run `pool:attention` (locally, or on production with the user's go) before paying.

## Deciding

Only on the admin page (`admin.<apex>` → REVIEW QUEUE, filter by pool → the ride → **ACCEPT · VERIFIED** or **REJECT**, signed by an admin wallet,
audited). This skill never decides and never writes. A ride's whole story (log lines, payments): `ride-investigate`; one ride in full: `ride-audit`.
