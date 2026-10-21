# Epic SPC-03 — Rides, Dynamic 65 km/h Finish & `stats.RideResult`

> **Parent Plan:** [`docs/plan/SPEC_COMPLIANCE_PLAN.md`](../../SPEC_COMPLIANCE_PLAN.md) · **Status Board:** [`docs/plan/spec-compliance/STATUS.md`](../STATUS.md)
> **Spec Docs:** [`docs/spec/rides.md`](../../../spec/rides.md) (`RID-M-01..21`, Decisions `17, 23, 38–44`)

---

## Overview

Aligns shift creation, road finish calculation, damage/violation tracking, and pool leaderboard ranking with [`docs/spec/rides.md`](../../../spec/rides.md): removes `4h`/`8h` tiers, implements deterministic server-authoritative `finishFor(roadSeed, trip, FINISH_RULES_VERSION)` at `V_BASE = 65 km/h` with route curvature factors `(RX, RZ, RT)` and `snapSafe`, draws the physical 1h finish line (`finish: true`), enforces the 90-minute wall-clock timeout (`T_cap`), persists `stats.RideResult`, and implements the versioned pool ranking formula (`scoreFormulaVersion`).

---

## Tasks

### `SPC-03.1` — Remove `4h` and `8h` ride creation (restrict valid shifts to `tier='free'` training and `tier='1h'` standard shift)

- **Status:** `[x] Done`
- **Spec Rules:** `RID-M-01`, `RID-M-02` (`docs/spec/rides.md`, Decision 38)
- **Paired Plan 1 Task:** `E2E-08.1`
- **Target Files:**
  - `backend/server/src/presentation/rides/rides.dto.ts`
  - `backend/server/src/application/rides/start-ride.handler.ts`
  - `frontend/client/index.html`, `frontend/client/site/` (lobby tier selector)
- **Depends On:** None

#### Definition of Ready (DoR)
- [ ] All references to `4h` and `8h` tiers in `backend/server/` and `frontend/client/` are inventoried, ensuring historical `4h`/`8h` DB rows remain readable while new ride creation only accepts `tier: 'free' | '1h'`.

#### Definition of Done (DoD)
- [ ] `POST /api/rides` and `POST /api/tickets/orders` reject `tier='4h'` and `tier='8h'` with `400`.
- [ ] Lobby UI offers only Training (`free`) and Standard Shift (`1h`).
- [ ] `docs/spec/PRODUCT.md` updated; status marked `[x] Done` in [`docs/plan/spec-compliance/STATUS.md`](../STATUS.md).

---

### `SPC-03.2` — Implement `finishFor(roadSeed, trip, FINISH_RULES_VERSION)` at `V_BASE = 65 km/h` with `(RX, RZ, RT)` curvature factors & `snapSafe`

- **Status:** `[x] Done`
- **Spec Rules:** `RID-M-03`, `RID-M-04`, `RID-M-05`, `RID-M-06`, `RID-M-07`, `RID-M-08`, `RID-M-10` (Decisions 17, 39, 40)
- **Paired Plan 1 Task:** `E2E-08.1`
- **Target Files:**
  - `frontend/client/shared/route-curvature.js`
  - `frontend/client/shared/road.js`
  - `backend/server/src/domain/road/`
  - `backend/server/src/application/rides/start-ride.handler.ts`
  - `backend/server/prisma/schema.prisma` (`finishRulesVersion` on `ride.Ride`)
- **Depends On:** `SPC-03.1`

#### Definition of Ready (DoR)
- [ ] Exact formula for `finishFor(roadSeed, trip, FINISH_RULES_VERSION)` in `docs/spec/rides.md` §3 (`V_BASE = 65 km/h`, horizontal curvature factor `RX`, vertical grade factor `RZ`, traffic/town density factor `RT`, clamped to `[48_000, 65_000]` m for 1h shifts, and `snapSafe` snapping outside forks/intersections/tunnels) is reviewed.

#### Definition of Done (DoD)
- [ ] `@freightchain/shared` exports `finishFor(roadSeed, trip, finishRulesVersion)` and `snapSafe(...)`, used identically by client and server (`road-drift.spec.ts` green).
- [ ] All riders in the same pool (`roadSeed`) receive the exact same `completeDist` and `finishRulesVersion` stored on `ride.Ride`.
- [ ] `docs/spec/PRODUCT.md` updated; status marked `[x] Done` in [`docs/plan/spec-compliance/STATUS.md`](../STATUS.md).

---

### `SPC-03.3` — Render physical finish line (`finish: true`) on 1h shifts + enforce 90-minute wall-clock `T_cap` (`5400s`)

- **Status:** `[x] Done`
- **Spec Rules:** `RID-M-09`, `RID-M-11` (Decisions 41, 42)
- **Paired Plan 1 Tasks:** `E2E-08.1`, `E2E-07.6`
- **Target Files:**
  - `frontend/client/js/world/` (finish gantry / checkered line placement at `completeDist`)
  - `frontend/client/js/sim/`
  - `backend/server/src/application/rides/` (90-minute `T_cap = 5400s` enforcement in finish & stale-ride sweeper)
- **Depends On:** `SPC-03.2`

#### Definition of Ready (DoR)
- [ ] Existing training finish line entity builder (`finish: true`) in `frontend/client/js/` and server ride duration cap logic are inspected.

#### Definition of Done (DoD)
- [ ] 1h shifts spawn the visible 3D finish line gantry at `completeDist` (`finish: true`).
- [ ] Server rejects/expires any 1h shift whose elapsed wall-clock time (`endedAt - startedAt`) exceeds `T_cap = 5400` seconds (90 minutes) (`RID-M-09`).
- [ ] `docs/spec/PRODUCT.md` updated; status marked `[x] Done` in [`docs/plan/spec-compliance/STATUS.md`](../STATUS.md).

---

### `SPC-03.4` — Track damage by source (`holes`, `vehicles`, `props`, `cold`, `other`) & server-side red-light crossings (`stopLine(j, +1)`)

- **Status:** `[x] Done`
- **Spec Rules:** `RID-M-13`, `RID-M-14` (`docs/spec/rides.md` §4)
- **Paired Plan 1 Task:** `E2E-08.2`
- **Target Files:**
  - `frontend/client/js/sim/damage.js`
  - `frontend/client/shared/physics.js`
  - `backend/server/src/domain/road/replay-engine.ts`
- **Depends On:** `SPC-03.2`

#### Definition of Ready (DoR)
- [ ] All damage application sites in `sim/damage.js` and `@freightchain/shared` (`holes`, `vehicles`, `props`, `cold`, `other`) and intersection traffic-light phase timing (`stopLine(j, +1)`) are reviewed.

#### Definition of Done (DoD)
- [ ] Both client simulation and server `ReplayEngine` accumulate damage into the 5 canonical buckets (`damageHoles`, `damageVehicles`, `damageProps`, `damageCold`, `damageOther`) and count red-light crossings (`redLights`) deterministically from the road network's signal phase at `stopLine(j, +1)`.
- [ ] `replay-engine.spec.ts` verifies 100% parity between client and server bucket totals.
- [ ] `docs/spec/PRODUCT.md` updated; status marked `[x] Done` in [`docs/plan/spec-compliance/STATUS.md`](../STATUS.md).

---

### `SPC-03.5` — Add Prisma migration & repository for `stats.RideResult` (`1:1` with `ride.Ride`) and populate on ride verification

- **Status:** `[x] Done`
- **Spec Rules:** `RID-M-12`, `RID-M-15`, `RID-M-16` (`docs/spec/rides.md` §5, Decision 43)
- **Paired Plan 1 Task:** `E2E-08.2`
- **Target Files:**
  - `backend/server/prisma/schema.prisma` (`stats.RideResult`)
  - `backend/server/prisma/migrations/<timestamp>_add_stats_ride_result/migration.sql`
  - `backend/server/src/infrastructure/stats/prisma-ride-result.repository.ts`
  - `backend/server/src/application/rides/verify-ride.service.ts`
- **Depends On:** `SPC-03.4`

#### Definition of Ready (DoR)
- [ ] `stats.RideResult` schema definition in `docs/spec/rides.md` §5 (`rideId` PK/FK, `poolId`, `wallet`, `finishRulesVersion`, `scoreFormulaVersion`, `durationMs`, `effectiveDurationMs`, `damageTotal`, `damageHoles`, `damageVehicles`, `damageProps`, `damageCold`, `damageOther`, `redLights`, `offRoadSeconds`, `mgTotal`, `mgPassed`, `mgWrong`, `mgMissed`, `mgPenaltySeconds`, `humannessScore`, `compositeScore`) is reviewed.

#### Definition of Done (DoD)
- [ ] Forward-only Prisma migration creates `stats.RideResult` with indexes on `(poolId, compositeScore)` and `(wallet, createdAt)`.
- [ ] Every verified ride upserts its `stats.RideResult` row inside the verification transaction (and `re-verify` updates it idempotently).
- [ ] Integration spec for `PrismaRideResultRepository` passes in `npm run server:integration`.
- [ ] `docs/spec/PRODUCT.md` updated; status marked `[x] Done` in [`docs/plan/spec-compliance/STATUS.md`](../STATUS.md).

---

### `SPC-03.6` — Implement versioned pool ranking formula (`scoreFormulaVersion`) & `GET /api/pools/:id/results` gated by `payout_at`

- **Status:** `[x] Done`
- **Spec Rules:** `RID-M-17`, `RID-M-18`, `RID-M-19`, `RID-M-20`, `RID-M-21` (Decision 44)
- **Paired Plan 1 Task:** `E2E-08.2`
- **Target Files:**
  - `backend/server/src/domain/pool/pool-ranking.ts`
  - `backend/server/src/presentation/pools/pools.controller.ts` (`GET /api/pools/:id/results`)
- **Depends On:** `SPC-03.5`

#### Definition of Ready (DoR)
- [ ] Versioned ranking formula (`scoreFormulaVersion = 1`: `effectiveDurationMs = durationMs + mgPenaltySeconds * 1000 + damagePenaltyMs + redLightPenaltyMs`, tie-breaking by lower `damageTotal`, then earlier `finishedAt`) and pre-`payout_at` vs post-`payout_at` visibility rules in `docs/spec/rides.md` §6 are reviewed.

#### Definition of Done (DoD)
- [ ] Pool winner calculation (`pool:payout`) and `GET /api/pools/:id/results` rank rides using `stats.RideResult` and `pool.scoreFormulaVersion`.
- [ ] Before `pool.payoutAt`, `GET /api/pools/:id/results` returns only summary participant count (or caller's own best result); after `pool.payoutAt`, it returns the full ranked breakdown with damage buckets, red lights, and minigame penalties.
- [ ] `docs/spec/PRODUCT.md` updated; status marked `[x] Done` in [`docs/plan/spec-compliance/STATUS.md`](../STATUS.md).
