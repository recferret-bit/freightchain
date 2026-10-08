---
name: prod-db
description: Query the PRODUCTION PostgreSQL of Freight Chain read-only (players, sign-ins, rides, verdicts, recording batches, payments, rounds, admin actions) – canned queries or ad-hoc SQL inside a read-only transaction. Use for any question about live data – counts, a wallet, a ride, the review queue, which verdict checks fire, the pool – or to tune the verdict thresholds from real rides.
---

# Production database (read-only)

`npm run --silent ops -- query <name> [arg]` or `npm run --silent ops -- sql "<SQL>"` (repo root). The SQL runs through `docker exec` in the
postgres container with `default_transaction_read_only=on` and a 15 s statement timeout: **a write is refused by PostgreSQL itself** (verified:
`cannot execute CREATE TABLE in a read-only transaction`). Never try to work around that; data changes go through the app (admin page) or the user.

## Canned queries (`deploy/scripts/ops-queries.sql`)

`npm run --silent ops -- query list` prints them. The useful ones:

| name | what |
|---|---|
| `overview` | counts: players, rides by status, verdicts by status, payments, telemetry size, the open round |
| `players` · `signins` | newest players · newest sign-ins (wallet, time, IP, browser) |
| `wallet <address>` | one wallet: player, last 20 rides with verdicts, payments |
| `ride <id>` | one ride: the row, verdict reasons + scores, its batches (`!` after a seq = the server's hash did not match) |
| `running` · `recent` | rides on the road now · last 30 ended rides with verdicts |
| `flagged` | the review queue |
| `reasons` · `scores` | which checks fire · the human-timing scores – **the data for tuning `server/src/domain/verdict/verdict-rules.ts`** |
| `pool` · `admin` · `migrations` · `size` | rounds and entries · admin audit · applied migrations · table sizes |

Add a query: a `-- @name  description` block in `ops-queries.sql`; `:arg` is replaced by the argument (quotes are refused).

## Schema cheat sheet (Prisma: `server/prisma/<context>/*.prisma`)

Quote every identifier – Prisma keeps camelCase: `ride."Ride"."lastS"`.

- `player."Player"` (wallet PK, freeRides, freeRidesMax, freeDay, createdAt) · `player."SignIn"` (wallet, at, ip, userAgent) · `player."AuthChallenge"` (pending nonces)
- `ride."Ride"` (id, wallet, tier free|1h|4h|8h, seed, status created|awaiting_payment|running|completed|abandoned|failed|expired|cancelled, minSeconds, completeDist, timeScale, lastS (m), driveSeconds, hull, route, reason, startedAt, endedAt, lastHbAt, roundId, paidAt)
- `telemetry."RideBatch"` (rideId+seq PK, prevHash, hash, hashOk, t0/t1 game s, samples, inputs, bytes, payload gzip JSON)
- `verdict."RideVerdict"` (rideId PK, status pending|verified|flagged|rejected, reasons jsonb `[{code,detail,severity}]`, scores jsonb `{recording,human}`, rulesVersion, judgedAt, overriddenBy, overriddenAt, note)
- `economy."Round"` (weekly, carry lamports, open|closed) · `economy."Payment"` (signature PK, rideId, wallet, lamports, roundId)
- `achievement."AchievementUnlock"` · `admin."AdminAction"` (wallet, action `auth.signin` / `verdict.override` / `verdict.rejudge`, target = the wallet / the ride id, detail jsonb – for decisions `signed: {message, signature}`, the text the admin wallet signed, at)

Lamports: divide by 1e9 for SOL. Times are UTC.

Before a query against a table added by a newer migration, check `query migrations` – production may not have it yet. Answer with the numbers and
the query you ran; for anything about one wallet or ride, the **ride-investigate** skill also pulls the matching log lines.
