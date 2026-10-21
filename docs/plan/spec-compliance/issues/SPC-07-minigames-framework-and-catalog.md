# Epic SPC-07 — Port the phone `phone-sms` minigame

> **Parent Plan:** [`docs/plan/SPEC_COMPLIANCE_PLAN.md`](../../SPEC_COMPLIANCE_PLAN.md) · **Status Board:** [`docs/plan/spec-compliance/STATUS.md`](../STATUS.md)
> **Spec Docs:** [`docs/spec/minigames.md`](../../../spec/minigames.md) Part 1 (`MGM-M-01..12`)
> **Source tree:** `/Users/ferretrec/work/freightchain-phone-minigames` (branch `phone-minigames`). Do not implement Appendix A.

---

## Overview

Bring the existing phone minigame onto this checkout. The source already schedules `phone-sms` only, stamps `mgCommit`, serves SVG assets, scores 3 tries at `+20` seconds, and leaves GULP and PIKE as local cab tasks. Parking pockets, noisy PNGs, a 15-id catalog, and a `+45` second skip are not in that code and are not this epic. The checklists under each task still quote the retired catalog. Where a checklist and Part 1 disagree, Part 1 wins.

---

## Tasks

### `SPC-07.1` — Port `mgSalt` commit–reveal and the `phone-sms` schedule (`2..4` arms, time gaps, null `slotS`)

- **Status:** `[x] Done` — ported onto this checkout 2026-10-20. `MINIGAMES` defaults to `off`. Unit specs for the domain, session, rate limit, and env adapter passed. `E2E-08.3` and `E2E-08.4` stay open.
- **Spec Rules:** `MGM-M-01`, `MGM-M-02`, `MGM-M-03`, `MGM-M-04` (`docs/spec/minigames.md` §2–3, Decisions 19, 20)
- **Paired Plan 1 Task:** `E2E-08.3`
- **Target Files:**
  - `frontend/client/shared/minigame-schedule.js`
  - `backend/server/src/domain/minigames/minigame-scheduler.ts`
  - `backend/server/src/infrastructure/config/env.schema.ts` (`MG_SECRET`)
  - `backend/server/.env.example`, `infra/deploy/.env.example`, `infra/deploy/docker-compose.prod.yml`
- **Depends On:** `SPC-06.2`

#### Definition of Ready (DoR)
- [ ] Scheduling rules in `docs/spec/minigames.md` §2–3 (`0` minigames on `tier='free'`; `2..4` minigames on `tier='1h'`; minimum `8 minutes` / `~8.5 km` spacing between events; no events in first `5 km` or final `3 km`; `mgSalt = HMAC-SHA256(MG_SECRET, rideId ‖ wallet)`) are reviewed.

#### Definition of Done (DoD)
- [ ] `MG_SECRET` env key added to all 4 env files.
- [ ] `minigame-schedule.js` deterministically computes pocket distances from `(roadSeed, mgSaltCommit)` while keeping actual challenge values hidden on the server until the truck approaches the pocket (`commit–reveal`).
- [ ] `docs/spec/PRODUCT.md` updated; status marked `[x] Done` in [`docs/plan/spec-compliance/STATUS.md`](../STATUS.md).

---

### `SPC-07.2` — Port arm, cancel, and one client deferral. Do not add a parking pocket.

- **Status:** `[x] Done` — ported onto this checkout 2026-10-20. `MINIGAMES` defaults to `off`. Unit specs for the domain, session, rate limit, and env adapter passed. `E2E-08.3` and `E2E-08.4` stay open.
- **Spec Rules:** `MGM-M-05`, `MGM-M-06` (`docs/spec/minigames.md` §3.2, Decisions 21, 22)
- **Paired Plan 1 Task:** `E2E-08.3`
- **Target Files:**
  - `frontend/client/shared/minigame-schedule.js`
  - `frontend/client/js/world/` (roadside pull-off / weigh-station bay 3D entity placement)
  - `frontend/client/js/sim/`
  - `backend/server/src/domain/road/replay-engine.ts`
- **Depends On:** `SPC-07.1`

#### Definition of Ready (DoR)
- [ ] Hazard clearance rules (`>= 300m` from forks, intersections, construction zones, bridges, and tunnels, plus deterministic fallback shoulder bay if a segment is dense) and full-stop trigger (`speed < 0.5 m/s` inside `[pocketStart, pocketEnd]`) in `docs/spec/minigames.md` §3.2 are reviewed.

#### Definition of Done (DoD)
- [ ] Client and server place parking pockets at identical safe coordinates (`>= 300m` hazard clearance).
- [ ] Stopping inside the pocket (`v < 0.5 m/s`) triggers the challenge modal; driving past `pocketEnd` without stopping marks the minigame `missed` (`+45s` penalty).
- [ ] `docs/spec/PRODUCT.md` updated; status marked `[x] Done` in [`docs/plan/spec-compliance/STATUS.md`](../STATUS.md).

---

### `SPC-07.3` — Port the SVG phone-sms renderer (dispatch mark, one true cab slip, no code in the open JSON)

- **Status:** `[x] Done` — ported onto this checkout 2026-10-20. `MINIGAMES` defaults to `off`. Unit specs for the domain, session, rate limit, and env adapter passed. `E2E-08.3` and `E2E-08.4` stay open.
- **Spec Rules:** `MGM-M-07` (`docs/spec/minigames.md` §4, Decision 28)
- **Paired Plan 1 Task:** `E2E-08.4`
- **Target Files:**
  - `backend/server/src/infrastructure/minigames/noisy-png-renderer.ts`
- **Depends On:** `SPC-07.1`

#### Definition of Ready (DoR)
- [ ] Visual distortion parameters in `docs/spec/minigames.md` §4 (per-character rotation `±18°`, baseline wave, stroke width variation, intersecting bezier noise lines, salt-and-pepper grain, output as `image/png` data URI or binary endpoint with zero plaintext target strings in HTTP JSON or headers) are reviewed.

#### Definition of Done (DoD)
- [ ] `NoisyPngRenderer` generates deterministic `image/png` challenge buffers from `(mgSalt, eventIndex)` in < 5ms without external native font dependencies.
- [ ] Challenge JSON response never contains the raw target code/number (`MGM-T-06`).
- [ ] `docs/spec/PRODUCT.md` updated; status marked `[x] Done` in [`docs/plan/spec-compliance/STATUS.md`](../STATUS.md).

---

### `SPC-07.4` — Port `RideMiniGame`, open / answer / SVG routes, and the accepted catalog (`phone-sms` only)

- **Status:** `[x] Done` — ported onto this checkout 2026-10-20. `MINIGAMES` defaults to `off`. Unit specs for the domain, session, rate limit, and env adapter passed. `E2E-08.3` and `E2E-08.4` stay open.
- **Spec Rules:** `MGM-M-08`, `MGM-M-09`, `MGM-M-10` (`docs/spec/minigames.md` §5–6, Decisions 24, 29)
- **Paired Plan 1 Task:** `E2E-08.4`
- **Target Files:**
  - `backend/server/prisma/schema.prisma` (`ride.RideMiniGame`)
  - `backend/server/prisma/migrations/<timestamp>_ride_minigames/migration.sql`
  - `backend/server/src/presentation/rides/ride-minigames.controller.ts`
  - `frontend/client/js/cockpit/minigames.js`
- **Depends On:** `SPC-07.2`, `SPC-07.3`

#### Definition of Ready (DoR)
- [ ] Base accepted catalog in `docs/spec/minigames.md` §5 (`phone-sms`, `fuel-station`, `weigh-station`, `toll-gate`, `cargo-seal`/`trailer-3d`, `dispatch-radio`/`exit`) and crypto-safety education minigame constraints (`MGM-M-10`: never ask player to sign a real wallet transaction or paste a seed phrase; candidate games gated by config flag) are reviewed.

#### Definition of Done (DoD)
- [ ] Forward-only Prisma migration creates `ride.RideMiniGame` (`id`, `rideId`, `eventIndex`, `kind`, `pocketDist`, `status`, `attempts`, `extendedTimerUsed`, `penaltySeconds`, `issuedAt`, `answeredAt`).
- [ ] `GET /api/rides/:id/minigames/:eventId` (called when stopped in pocket) reveals the noisy PNG challenge; `POST /api/rides/:id/minigames/:eventId/answer` validates the answer and records telemetry `mg` event parity.
- [ ] Client cockpit renders the 6 accepted base minigames cleanly without ever invoking `window.solana`.
- [ ] `docs/spec/PRODUCT.md` updated; status marked `[x] Done` in [`docs/plan/spec-compliance/STATUS.md`](../STATUS.md).

---

### `SPC-07.5` — Port scoring (`+20` s only after 3 wrong tries), `missed` with no extra seconds, and `more-time` (60 s)

- **Status:** `[x] Done` — ported onto this checkout 2026-10-20. `MINIGAMES` defaults to `off`. Unit specs for the domain, session, rate limit, and env adapter passed. `E2E-08.3` and `E2E-08.4` stay open.
- **Spec Rules:** `MGM-M-11`, `MGM-M-12` (`docs/spec/minigames.md` §7, Decisions 23, 31)
- **Paired Plan 1 Task:** `E2E-08.4`
- **Target Files:**
  - `backend/server/src/application/rides/verify-ride.service.ts`
  - `backend/server/src/domain/minigames/minigame-scoring.ts`
- **Depends On:** `SPC-07.4`, `SPC-03.5`

#### Definition of Ready (DoR)
- [ ] Penalty rules in `docs/spec/minigames.md` §7 (`0s` on pass, `+20s` per wrong answer, `+45s` per missed/timed-out minigame, folded into `stats.RideResult.mgPenaltySeconds` and `effectiveDurationMs`, `mgMissed > 2` flags ride for review, accessibility `×2` timer option doubles allowed time from `15s..20s` to `30s..40s`) are reviewed.

#### Definition of Done (DoD)
- [ ] Minigame outcomes populate `mgTotal`, `mgPassed`, `mgWrong`, `mgMissed`, and `mgPenaltySeconds` on `stats.RideResult` (`SPC-03.5`).
- [ ] `×2` accessibility timer toggle is supported in player settings and enforced on server answer window validation.
- [ ] `docs/spec/PRODUCT.md` updated; status marked `[x] Done` in [`docs/plan/spec-compliance/STATUS.md`](../STATUS.md).
