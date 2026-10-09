# Statistics

The game's core numbers – **rides, time driven, distance, crashes, donations during streams** – kept as running totals, per rider and for the whole game, so the
landing, the lobby and `GET /api/stats` never scan the rides table. Shown on the landing hero (DRIVEN, ALL TIME), the lobby profile (DRIVING RECORD) and the public API.

## What counts

| Number | Rule |
|---|---|
| `rides` | every **started** ride that **ended** – completed, abandoned or failed (a ride that never started – a refunded free credit, an unpaid order – counts nothing; a running ride counts when it ends) |
| `ridesFree` / `ridesPaid` | the same rides split by tier: **free** (`tier = free` – the daily credits and promo rides) and **paid** (a ticket ride); `rides = ridesFree + ridesPaid`, per rider and for the game |
| `ridesCompleted` | … of which complete shifts (the landing's old "shifts") |
| `seconds` / `metres` | what was really driven: the ride's `driveSeconds` and `lastS`. A failed shift counts – the old landing counted only completed shifts and showed `0.00 km` while rides had driven |
| `crashesVehicle` | truck ⇄ car / truck / bus contacts, bumps included (the game's `st.crashV`) |
| `crashesBuilding` | truck ⇄ roadside building (always fatal) (`st.crashB`) |
| `donations` | donations that landed on the **driver's** stream – paid and mock tips; chat lines are not donations |
| `donationLamports` | lamports of the **paid** ones only (a real transfer – money that moved); mock tips add no lamports |

Crashes are **client-reported**: every heartbeat and the final `/end` carry the game's running counts (`crashesVehicle`, `crashesBuilding`); the server only ever raises
a ride's counters, as whole numbers, capped by the ride's driven time (`crashCap`: 3 + one per 3 driven seconds, never above 200 – a client can't report ten crashes a second), and ignores garbage – it is a statistic, not a verdict, and is never judged.
A ride that ends without a final report (tab lost, swept) keeps the counts of its last heartbeat.

## Where it lives

- Tables: `stats."PlayerStats"` (wallet PK, FK → player, cascade) and `stats."GlobalStats"` (the single row `id = 1`) – `server/prisma/stats/stats.prisma`; `ride."Ride"` gained the
  two crash counters. Migration `20261014000000_statistics` **backfills** both tables from the existing rides and donations (the same rule `stats:reconcile` applies).
- Writes: `StatsService` (`recordRide`, `recordDonation`) → `StatsRepositoryPort.add` = **two atomic upserts** (`SET x = x + n`, never read-modify-write): the rider's row **first**,
  the global row second (the same order everywhere – the hot global row can't deadlock). A ride that ends adds itself **inside the transaction that saves it**, from every
  path that ends a ride: `/end`, a heartbeat the server fails, the stale-ride sweeper, a new ride clearing a stale one (create / start). `test/architecture/stats-hooks.spec.ts` fails
  when an application file calls `failHeartbeatLost` / `finish` / `applyReport` or creates a donation without recording it. **Lock order**: the player row first (the statistics insert checks that row – taking it later deadlocked with the sweep; the concurrency spec found it).
- Reads: `GET /api/stats` (public, no cookie) → `GlobalStatsDto { …, crashes, drivers, updatedAt }`; `GET /api/live` `totals { shifts, rides, ridesFree, ridesPaid, metres, seconds, drivers, crashes, donations }` (what the landing reads);
  `GET /api/profile` `career` (the rider's own numbers). All read through `StatsService` and the **cache**.

## The cache (Redis)

`CachePort` – `RedisCacheAdapter` when `REDIS_URL` is set, else `MemoryCacheAdapter` (in process: dev, tests). Keys `fc:stats:global`, `fc:stats:player:<wallet>`, TTL 15 s; every write drops them after it commits
(`StatsService.invalidate`). A Redis that is down is a **miss**, never an error – the API answers from PostgreSQL and logs one warning per outage (tested: the e2e stops the Redis container mid-run). Nothing else uses the cache yet.

**Production Redis is locked down** (`deploy/docker-compose.prod.yml`): a **password** (`REDIS_PASSWORD` in `deploy/.env`, hex ≥ 32 chars – `npm run deploy:init` generates it; on an existing `.env`: `echo "REDIS_PASSWORD=$(openssl rand -hex 24)" >> deploy/.env`; the deploy refuses to run without it), **no published port**,
and it sits only on the `cache` network – `internal: true` (no route to or from the internet) and shared with the app alone, PostgreSQL cannot see it. It runs as the unprivileged `redis` user on a read-only filesystem, 64 MB, LRU, no persistence (it is only a cache).
The app's `REDIS_URL` is built by the compose file from the password. Local dev: `docker compose up -d --wait redis` (loopback port 16380, password `freight_dev_redis`), `REDIS_URL=redis://:freight_dev_redis@127.0.0.1:16380` in `server/.env`; without it the server caches in process.

## Reconciliation

**After the first deploy of this feature run it once** (`stats:reconcile`, then `--fix` if it reports drift): the migration's backfill runs while the old image still serves, so rides that end between the backfill and the container swap (or under the old release after a rollback) are not in the totals yet.

Running totals can drift (a crash between statements, a hand-edited row). `node dist/cli/index.js stats:reconcile [--wallet A] [--fix]` recomputes every rider from the rides and feed events, reports
the drift (`drifted[]`, `global`) and with `--fix` rewrites the rows (a rider with nothing behind it loses the row; the global row = the sum of all riders). Skill: **`stats-reconcile`**
(`bash .claude/skills/stats-reconcile/run.sh [--fix]`; `--prod` = a read-only SQL comparison on production). Never fix production without the user asking.

## Tests

Unit: `domain/stats.spec`, `stats.service.spec`, the get / reconcile handlers, the cache adapters, the controller, the ride entity counters, the hooks in every ending path (end / heartbeat / sweep / create / start) and
both donation handlers, `architecture/stats-hooks.spec`. Integration (PostgreSQL): `stats.prisma.repository.integration.spec` (increments, rollback, recompute ⇄ entity, replace) and three concurrency
tests (parallel endings on the hot row, sweep ⇄ heartbeat ⇄ `/end`, parallel donations). Scenarios (memory + PostgreSQL): `test/scenarios/stats.scenarios.ts`. Client: the headless check "a contact with a vehicle is counted".
End to end in real Chrome: `bash .claude/skills/run-tests/e2e.sh stats` (`server/scripts/e2e-stats.mjs`, against a throwaway password-protected Redis – keys written / dropped, then the Redis is stopped to prove the API survives): a real game driving into a car → the totals, the landing tiles fit at five widths, the profile's record on desktop + phone, API bots for every other
ending and a donation, `stats:reconcile` clean → broken row found → fixed.

## Status and open questions (2026-10-09)

**Now.** Built, reviewed and committed on `main` (`4d2256f`); unit, PostgreSQL integration and the real-Chrome `stats` + `lobby` e2e suites pass. **Not deployed yet** – the deploy command was blocked by the
auto-mode permission classifier in the session that built this, so production still serves release `20261009-141736-09b989a` (no stats tables, `0.00 km`). `deploy -- --dry-run` is clean (env valid incl. the new `REDIS_PASSWORD`, ssh fine,
no nginx / TLS change). What the owner runs, in order: `npm run deploy` (ships HEAD – it also carries the other session's commits on `main`), then `npm run deploy:stats` (report), `npm run deploy:stats -- --fix` if it shows drift, then
`npm run deploy:smoke` and `npm run ops -- logs --since 10m --errors`; on the box `docker ps` shows `redis` healthy with no published port.

**Open questions.**
- **Deploy approval** – the permission rule for `npm run deploy` (and `deploy:stats -- --fix`) must be allowed, or the owner runs them (`! npm run deploy`).
- **Crashes are client-reported** – capped by driven time, not verified. Server-side proof would need the recording's collision facts (the sample row has no crash column; adding one = a new APPENDED column + rules version).
- **Crash definition** – every vehicle contact counts (bumps, not scratches); building crashes are always fatal. Count scratches too? Count only fatal crashes?
- **Mock vs paid donations** – both count as donations, only paid ones add lamports. Production has no free donations, so there it is paid only; keep the mock ones counted in dev?
- **Per-rider history** – only running totals exist (no per-day series, no per-route / per-tier split beyond free / paid); a daily rollup table would be the next step for charts.
- **Leaderboards from the totals** – `PlayerStats.metres` could back an all-time board without scanning rides (the old `metres` index was dropped as unused).
- **Redis** – only the statistics use it today; sessions, rate limits and the live board's presence are still per process (one app container). A second app instance would need those moved first.
- **Rollback** – a rollback keeps the new tables (forward-only); the old image ignores them, and rides it ends are not counted until the next `stats:reconcile`.
