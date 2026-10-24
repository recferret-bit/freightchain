# Epic SPC-06 — Anti-Cheat v2.1, 30 Hz Server Re-Sim & Humanness `F1..F10`

> **Parent Plan:** [`docs/plan/SPEC_COMPLIANCE_PLAN.md`](../../SPEC_COMPLIANCE_PLAN.md) · **Status Board:** [`docs/plan/spec-compliance/STATUS.md`](../STATUS.md)
> **Spec Docs:** [`docs/spec/anticheat.md`](../../../spec/anticheat.md) (`ACH-M-01..16`, Decisions `1–16, 25–27, 31, 35`)

---

## Overview

Upgrades the anti-cheat pipeline from 10 Hz sample inspection to the full [`docs/spec/anticheat.md`](../../../spec/anticheat.md) v2.1 architecture: HMAC-authenticated deflate telemetry batches (`inp`, `clk`, `chk`, `mg`, `env`), 30 Hz fixed-step deterministic physics & traffic re-simulation (`dt = 1/30s`) shared between client and server, incremental per-batch server re-sim + background final verdict, pause/slow-mo bounds, shared pool `roadSeed` + per-ride `trafficSalt` & `holeSalt` commit–reveal, mechanical input humanness features `F1–F10` (`humannessScore` + 5 physical-impossibility auto-reject rules + `isTrusted`), 90-day input trace retention, and top-20 cross-ride trace clustering.

---

## Tasks

### `SPC-06.1` — Implement Telemetry v2.1 wire protocol (`sessionKey` per-batch HMAC-SHA256, deflate streams `inp`/`clk`/`chk`/`mg`/`env`, `batch-mac-invalid`)

- **Status:** `[x] Done` — Enforce mode has named deflate streams `inp`/`clk`/`chk`/`mg`/`env` and the HMAC-before-inflate. Default `TELEMETRY_V21` stays `off`. `off` and `shadow` do not require the streams.
- **Spec Rules:** `ACH-M-02`, `ACH-M-03`, `ACH-M-05` (`docs/spec/anticheat.md` §3–4, Decisions 3, 4, 8)
- **Paired Plan 1 Task:** `E2E-07.3`
- **Target Files:**
  - `frontend/client/shared/telemetry-codec.js`
  - `frontend/client/js/net/telemetry.js`
  - `backend/server/src/application/rides/ingest-telemetry.handler.ts`
  - `backend/server/prisma/schema.prisma` (`sessionKey` on `ride.Ride`, v2.1 batch columns on `telemetry.RideSampleBatch`)
- **Depends On:** None

#### Definition of Ready (DoR)
- [ ] Telemetry v2.1 binary/JSON envelope specification in `docs/spec/anticheat.md` §3–4 (`sessionKey` issued at `POST /api/rides`, per-batch `mac = HMAC-SHA256(sessionKey, rideId ‖ seq ‖ startTick ‖ endTick ‖ sha256(inp) ‖ sha256(chk))`, deflate-compressed streams `inp`, `clk`, `chk`, `mg`, `env`, and `worldDigest32`) is reviewed.

#### Definition of Done (DoD)
- [ ] Client encodes and signs 30 Hz telemetry batches using `sessionKey` and deflate streams; server verifies the HMAC before decompressing and rejects invalid MACs with `400 batch-mac-invalid`.
- [ ] Enforces strict compressed (`<= 64 KB`) and uncompressed (`<= 256 KB`) batch size caps and monotonic `seq` / `startTick` continuity.
- [ ] `docs/spec/PRODUCT.md` updated; status marked `[x] Done` in [`docs/plan/spec-compliance/STATUS.md`](../STATUS.md).

---

### `SPC-06.2` — Upgrade client & server `ReplayEngine` to 30 Hz fixed-step deterministic simulation (`dt = 1/30s`) + incremental per-batch server re-sim

- **Status:** `[x] Done` — Decision 69 (24.10.2026): the live `ReplayEngine` stays at 10 Hz with two substeps. `stepAt30Hz` is not the judge and will not become it. Decision 12's 30 Hz re-sim is not the live pipeline.
- **Spec Rules:** `ACH-M-01`, `ACH-M-08`, `ACH-M-09`, `ACH-M-10`, `ACH-M-12` (`docs/spec/anticheat.md` §2 & §5, Decisions 1, 2, 11, 12)
- **Paired Plan 1 Tasks:** `E2E-07.1`, `E2E-07.2`
- **Target Files:**
  - `frontend/client/shared/physics.js`
  - `frontend/client/shared/traffic-simulation.js`
  - `frontend/client/js/main.js` (fixed 30 Hz physics accumulator decoupled from render FPS)
  - `backend/server/src/domain/road/replay-engine.ts`
  - `backend/server/src/application/rides/verify-ride.service.ts`
- **Depends On:** `SPC-06.1`

#### Definition of Ready (DoR)
- [ ] All floating-point operations, PRNG calls (`mulberry32`), gearbox transitions, fuel/battery/engine curves, hole collisions, and traffic steps in `@freightchain/shared` are audited for 100% deterministic fixed-step (`dt = 1/30s`) execution.

#### Definition of Done (DoD)
- [ ] Client steps physics & traffic at a fixed `30 Hz` tick rate using an accumulator, recording the exact input bitmask per tick (`inp`).
- [ ] Server runs incremental 30 Hz re-simulation from `inp` on each telemetry batch (persisting intermediate sim state checkpoint) and runs final verification in the background worker (`replay:worker`) on ride finish (`ACH-M-08..10`).
- [ ] Zero drift between client and server across a 108,000-tick (1h) shift (`replay-engine.spec.ts` and `E2E-07.2` green).
- [ ] `docs/spec/PRODUCT.md` updated; status marked `[x] Done` in [`docs/plan/spec-compliance/STATUS.md`](../STATUS.md).

---

### `SPC-06.3` — Enforce pause (`≤3` pauses, `≤5 min` cumulative) and slow-motion (`dt` / wall-clock drift) anti-cheat bounds

- **Status:** `[x] Done` — A fourth pause, more than five minutes paused, or sustained slow-motion: `off` adds no reasons, `shadow` flags, and `enforce` rejects. `RULES_VERSION` stays 7.
- **Spec Rules:** `ACH-M-04` (`docs/spec/anticheat.md` §4.3, Decision 7)
- **Paired Plan 1 Task:** `E2E-07.6`
- **Target Files:**
  - `frontend/client/js/main.js`
  - `backend/server/src/domain/road/replay-engine.ts`
- **Depends On:** `SPC-06.2`

#### Definition of Ready (DoR)
- [ ] `clk` stream format (wall-clock `performance.now()` / server arrival deltas and pause events) and thresholds (`maxPauses = 3`, `maxPauseTotalMs = 300_000`, slow-mo ratio threshold) in `docs/spec/anticheat.md` §4.3 are reviewed.

#### Definition of Done (DoD)
- [ ] Server verifies `clk` stream and batch arrival timestamps via `ClockPort`, rejecting rides that exceed 3 pauses, 5 minutes total pause duration, or sustained slow-motion (`simTicks * (1000/30)` vs wall-clock elapsed time outside pause windows).
- [ ] `docs/spec/PRODUCT.md` updated; status marked `[x] Done` in [`docs/plan/spec-compliance/STATUS.md`](../STATUS.md).

---

### `SPC-06.4` — Implement shared pool `roadSeed` + per-ride `trafficSalt` & `holeSalt` commit–reveal (`HMAC-SHA256`) and `worldDigest32` verification

- **Status:** `[x] Done` — Start stores traffic and hole salt commitments and enforce compares `worldDigest32` of spawned holes, junctions, and traffic. A short mismatch flags; one that lasts at least 10 seconds after three points rejects. The 10 Hz road rebuild does not read the salts.
- **Spec Rules:** `ACH-M-05`, `ACH-M-11` (`docs/spec/anticheat.md` §6, Decisions 9, 10)
- **Paired Plan 1 Task:** `E2E-07.4`
- **Target Files:**
  - `frontend/client/shared/road.js`
  - `frontend/client/shared/traffic-simulation.js`
  - `backend/server/src/application/rides/start-ride.handler.ts`
  - `backend/server/prisma/schema.prisma` (`trafficSalt`, `holeSalt`, `saltCommit` on `ride.Ride`)
- **Depends On:** `SPC-06.2`

#### Definition of Ready (DoR)
- [ ] Seed hierarchy in `docs/spec/anticheat.md` §6 (`roadSeed` shared across the pool so geometry/forks/finish are identical; `trafficSalt = HMAC(SALT_SECRET, rideId ‖ 'traffic')` and `holeSalt = HMAC(SALT_SECRET, rideId ‖ 'holes')` unique per ride so obstacle positions cannot be pre-scouted; `worldDigest32` rolling hash over spawned obstacles/traffic) is reviewed.

#### Definition of Done (DoD)
- [ ] `start-ride` derives per-ride `trafficSalt` and `holeSalt` (recording `saltCommit = sha256(trafficSalt ‖ holeSalt)`), passes them to the client, and re-derives them during server 30 Hz re-sim.
- [ ] Every checkpoint compares client `worldDigest32` against server `worldDigest32`, rejecting any ride where obstacles, speed signs, red lights, or traffic were tampered with in client memory.
- [ ] `docs/spec/PRODUCT.md` updated; status marked `[x] Done` in [`docs/plan/spec-compliance/STATUS.md`](../STATUS.md).

---

### `SPC-06.5` — Implement mechanical input humanness classifier (`F1..F10` → `humannessScore`), 5 physical-impossibility auto-reject rules, and `isTrusted=false` tracking

- **Status:** `[x] Done` — F1–F10 score 0–100. The five physical-impossibility cases reject. A borderline score or `isTrusted=false` is `flagged_for_review`. No browser fingerprint.
- **Spec Rules:** `ACH-M-06`, `ACH-M-07`, `ACH-M-14`, `ACH-M-15`, `ACH-M-16` (`docs/spec/anticheat.md` §7, Decisions 13, 15, 16)
- **Paired Plan 1 Tasks:** `E2E-07.5`, `E2E-07.7`
- **Target Files:**
  - `backend/server/src/domain/anticheat/humanness-classifier.ts`
  - `frontend/client/js/input.js` (`event.isTrusted` counter in `env` stream)
- **Depends On:** `SPC-06.2`

#### Definition of Ready (DoR)
- [ ] Mechanical features `F1..F10` (hold-time entropy, inter-key interval jitter, steering micro-corrections, throttle-to-brake transition latency, gear shift cadence variance, reaction delay distribution to obstacles, etc.), the 5 physical-impossibility hard-reject rules, and the `isTrusted=false` flag rule in `docs/spec/anticheat.md` §7 are reviewed.

#### Definition of Done (DoD)
- [ ] `humanness-classifier.ts` computes `F1..F10` and `humannessScore` (`0..100`) from the 30 Hz `inp` stream.
- [ ] Triggering any of the 5 physical-impossibility rules automatically rejects the ride (`verdict = 'rejected'`); borderline `humannessScore` or `isTrusted=false` events mark the ride `flagged_for_review` (`ACH-M-06..07`).
- [ ] `docs/spec/PRODUCT.md` updated; status marked `[x] Done` in [`docs/plan/spec-compliance/STATUS.md`](../STATUS.md).

---

### `SPC-06.6` — Implement 90-day raw input trace retention job & pool top-20 cross-ride input trace clustering detector

- **Status:** `[x] Done` — Top-20 verified rides in an open validation window are compared. A similar pair raises `trace-cluster` and those rides are flagged for review. A copied trace of 50 or more intervals rejects. Raw `inp` older than 90 days can be deleted only after that pool's payout is finalized.
- **Spec Rules:** `ACH-M-13` (`docs/spec/anticheat.md` §8, Decision 27)
- **Paired Plan 1 Task:** `E2E-07.8`
- **Target Files:**
  - `backend/server/src/application/rides/trace-clustering.service.ts`
  - `backend/server/src/application/rides/telemetry-retention.scheduler.ts`
- **Depends On:** `SPC-06.5`

#### Definition of Ready (DoR)
- [ ] Cross-ride input trace similarity metric (windowed cross-correlation / SimHash over 30 Hz steering & throttle traces among a pool's top 20 rides) and 90-day raw input pruning policy in `docs/spec/anticheat.md` §8 are reviewed.

#### Definition of Done (DoD)
- [ ] Before a pool's validation window closes, `TraceClusteringService` compares the top-20 verified rides' 30 Hz input traces and flags rides exceeding the similarity threshold for admin review + alert (`SPC-02.9`).
- [ ] Daily retention scheduler prunes raw 30 Hz `inp` blobs older than 90 days (once pool payout is finalized) while preserving downsampled cinematic replay samples.
- [ ] `docs/spec/PRODUCT.md` updated; status marked `[x] Done` in [`docs/plan/spec-compliance/STATUS.md`](../STATUS.md).
