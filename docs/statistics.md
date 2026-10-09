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
- **History**: `stats.DailyStats` (one row per UTC day: the day a ride ENDED / a donation landed – `ride.endedAt`, the event's `createdAt`), written as the THIRD upsert (rider, game, day) with the same columns, backfilled by the migration, rebuilt by `stats:reconcile` (everyone scope). `GET /api/stats/daily` (public, cached) = the newest 90 days that have any activity, oldest first, `[{ day: 'YYYY-MM-DD', rides, ridesFree, ridesPaid, ridesCompleted, seconds, metres, crashes…, donations, donationLamports }]` – the days add up to the game's totals.
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

## Decisions (these were the open questions)

- **Crash definition – final.** Every contact between the truck and another vehicle that the game treats as a bump or a collision counts (`crashesVehicle`); a sideswipe scratch does not (it is `SCRATCH`, cosmetic damage); every building crash counts (`crashesBuilding`, always fatal). A change here is a change of `st.crashV` in `client/js/sim/traffic.js` only.
- **Crash proof – accepted limit, not built.** The counters are client-reported and bounded by driven time; they are statistics, never judged, and the doc / UI do not present them as verified. Verifying them would need a crash column APPENDED to the 10 Hz sample row (frozen-order rule) plus a rules version bump and a world check – worth it only if crashes ever feed rewards.
- **Donations – final.** Mock tips and paid donations both count as donations; only paid ones add lamports. Production has no mock donations (`LIVE_FREE_DONATIONS=off`), so there the numbers are paid-only.
- **History – built** (`DailyStats`, above). Per-route / per-tier splits beyond free / paid are not kept: they can be recomputed from `ride.Ride` when a chart needs them.
- **Distance leaderboard from the totals – not built, on purpose.** The existing boards rank verified paid / free shifts by their own rules; a second board from raw totals would rank unverified distance next to them and confuse the rules. `PlayerStats.metres` is there if the product decides otherwise.
- **Redis is single-instance and statistics-only – a documented constraint.** Sessions, rate limits and the live board's presence are per process (one app container, `docs/backend-architecture.md`); scaling to a second app instance means moving those to Redis first, a separate piece of work.
- **Rollback – procedure, not a bug.** A rollback keeps the new tables (forward-only); the old image ignores them and rides it ends are not counted. After any rollback (and after the first deploy of this release) run `npm run deploy:stats` – and `-- --fix` if it shows drift – which rebuilds riders, game and history from the rides.

## Status (2026-10-09)

Built, reviewed and committed on `main`; unit, PostgreSQL integration and the real-Chrome `stats` + `lobby` e2e suites pass. **Deployed: no** – the auto-mode permission classifier blocked `npm run deploy` in the session that built this, so production serves release
`20261009-141736-09b989a` (no stats tables, `0.00 km`). `deploy -- --dry-run` is clean (env valid incl. `REDIS_PASSWORD`, ssh fine, no nginx / TLS change). Owner steps, in order: `npm run deploy` (ships HEAD – it also carries the other session's commits on `main`), `npm run deploy:stats`
(report), `npm run deploy:stats -- --fix` if it shows drift, `npm run deploy:smoke`, `npm run ops -- logs --since 10m --errors`; on the box `redis` is healthy with no published port.

**Still the owner's:** allow (or run) `npm run deploy` and `deploy:stats -- --fix`; decide whether crash proof or a distance board is ever wanted; a second app instance (see Redis above).
