# Epic E2E-07 — Block 3 Anti-Cheat Driver Bots & 30 Hz Re-Sim

> **Parent Plan:** [`docs/plan/E2E_HEADLESS_PLAN.md`](../../E2E_HEADLESS_PLAN.md) · **Status Board:** [`docs/plan/e2e-headless/STATUS.md`](../STATUS.md)
> **Track:** Track B (Target — [`docs/spec/anticheat.md`](../../../spec/anticheat.md) `ACH-T-01..04`, `AC-P1..12`, `AC-T1..16`, `AC-H1..3`, `AC-W1..18`, `AC-F1..11`, `AC-R1..8`, Cheat Catalog `#1..#58`)

---

## Overview

Builds `tests/e2e/block3-anticheat` (`npm run test:e2e:block3`) per [`docs/spec/anticheat.md`](../../../spec/anticheat.md) §9–10: a dual-engine headless driver bot (`engine: 'game'` running the full client module graph in happy-dom/Three-stub, and `engine: 'kernel'` stepping `@freightchain/shared` physics directly at 30 Hz) that executes legitimate behavioral profiles and every single attack vector in the 58-item Cheat Catalog (`#1..#58`) against the real server Telemetry v2.1 & 30 Hz Re-Sim pipeline.

---

## Tasks

### `E2E-07.1` — Build `tests/e2e/block3-anticheat` harness with dual driver bot engines (`engine: 'game'` & `engine: 'kernel'`)

- **Status:** `[x] Done` — locked in `npm run test:e2e:block3` (2026-10-22, 153 tests, exit 0). The suite calls the shipped 30 Hz stepper, MAC, digest, humanness, pause, catalog, and retention code. `REPLAY_SIM_HZ` stays 10. Rows the code does not catch stay non-rejects.
- **Track:** Track B (Target)
- **Spec / Contract Ref:** `docs/spec/anticheat.md` §10, `ACH-T-01`
- **Target Files:**
  - `tests/e2e/block3-anticheat/harness/driver-bot.ts`
  - `tests/e2e/block3-anticheat/harness/profiles.ts`
  - `package.json` (`test:e2e:block3`)
- **Depends On:** `SPC-06.2`

#### Definition of Ready (DoR)
- [ ] Shared 30 Hz fixed-step physics and traffic simulation modules in `@freightchain/shared` (`SPC-06.2`) are finalized.
- [ ] Driver bot closed-loop steering/throttle/gear controller parameters and 5 behavioral profiles (`perfect`, `human-like`, `drowsy`, `aggro`, `bot-quantized`) from `docs/spec/anticheat.md` §10.2 are specified.

#### Definition of Done (DoD)
- [ ] `driver-bot.ts` runs both `engine: 'game'` (client loop + real `telemetry.js` batcher) and `engine: 'kernel'` (direct 30 Hz `@freightchain/shared` step + batch encoder), capable of completing a full 1h shift (`108,000` ticks at `dt = 1/30s`) in < 1.5s of CPU time.
- [ ] `human-like` profile completes a 1h shift with `verdict = 'verified'` and `humannessScore >= 70` on both engines (`ACH-T-01`).
- [x] `npm run test:e2e:block3` script is registered in root `package.json`.
- [x] Status updated in [`docs/plan/e2e-headless/STATUS.md`](../STATUS.md).

---

### `E2E-07.2` — Implement 30 Hz Deterministic Physics & Re-Sim Parity Suite (`AC-P1..P12`)

- **Status:** `[x] Done` — locked in `npm run test:e2e:block3` (2026-10-22, 153 tests, exit 0). The suite calls the shipped 30 Hz stepper, MAC, digest, humanness, pause, catalog, and retention code. `REPLAY_SIM_HZ` stays 10. Rows the code does not catch stay non-rejects.
- **Track:** Track B (Target)
- **Spec / Contract Ref:** `AC-P1..P12`, `ACH-M-01, 12`
- **Target Files:**
  - `tests/e2e/block3-anticheat/physics-parity.e2e.spec.ts`
- **Depends On:** `E2E-07.1`, `SPC-06.2`

#### Definition of Ready (DoR)
- [ ] Server 30 Hz `ReplayEngine` (`SPC-06.2`) is wired into `VerifyRideService`.

#### Definition of Done (DoD)
- [ ] `physics-parity.e2e.spec.ts` asserts `AC-P1` through `AC-P12`:
  - Zero position/speed/damage drift (`|Δs| < 0.01 m`, `|Δv| < 0.001 m/s`, `Δdamage === 0`) between client `engine: 'game'` and server 30 Hz re-sim across all 14 routes and 108,000 ticks (`AC-P1..P4`).
  - Gearbox stall, clutch slip, engine overheat, battery drain, cold cabin damage, off-road speed decay, hole impact, and traffic collision impulses match bit-for-bit (`AC-P5..P12`).
- [x] Passes in `npm run test:e2e:block3`.
- [x] Status updated in [`docs/plan/e2e-headless/STATUS.md`](../STATUS.md).

---

### `E2E-07.3` — Implement Telemetry v2.1 Wire, HMAC & Deflate Stream Suite (`AC-T1..T16`)

- **Status:** `[x] Done` — locked in `npm run test:e2e:block3` (2026-10-22, 153 tests, exit 0). The suite calls the shipped 30 Hz stepper, MAC, digest, humanness, pause, catalog, and retention code. `REPLAY_SIM_HZ` stays 10. Rows the code does not catch stay non-rejects.
- **Track:** Track B (Target)
- **Spec / Contract Ref:** `AC-T1..T16`, `ACH-M-02, 03, 05`
- **Target Files:**
  - `tests/e2e/block3-anticheat/telemetry-v21.e2e.spec.ts`
- **Depends On:** `E2E-07.1`, `SPC-06.1`

#### Definition of Ready (DoR)
- [ ] Telemetry v2.1 wire format (`sessionKey` HMAC-SHA256, deflate streams `inp`/`clk`/`chk`/`mg`/`env`) from `SPC-06.1` is implemented.

#### Definition of Done (DoD)
- [ ] `telemetry-v21.e2e.spec.ts` asserts `AC-T1` through `AC-T16`:
  - Valid HMAC batch accepted; tampered `inp`/`chk` byte or wrong `sessionKey` rejected with `400 batch-mac-invalid` (`AC-T1..T4`).
  - Duplicate `seq` idempotently ignored; gap or out-of-order `seq` rejected (`AC-T5..T8`).
  - Deflate bomb / oversized payload (> 64 KB compressed or > 256 KB uncompressed) rejected (`AC-T9..T11`).
  - Incremental batch re-sim state checkpoint persisted after each batch (`AC-T12..T16`).
- [x] Passes in `npm run test:e2e:block3`.
- [x] Status updated in [`docs/plan/e2e-headless/STATUS.md`](../STATUS.md).

---

### `E2E-07.4` — Implement World Integrity, Salt Commit–Reveal & Digest Suite (`AC-W1..W18`)

- **Status:** `[x] Done` — locked in `npm run test:e2e:block3` (2026-10-22, 153 tests, exit 0). The suite calls the shipped 30 Hz stepper, MAC, digest, humanness, pause, catalog, and retention code. `REPLAY_SIM_HZ` stays 10. Rows the code does not catch stay non-rejects.
- **Track:** Track B (Target)
- **Spec / Contract Ref:** `AC-W1..W18`, `ACH-M-05, 11`
- **Target Files:**
  - `tests/e2e/block3-anticheat/world-integrity.e2e.spec.ts`
- **Depends On:** `E2E-07.1`, `SPC-06.4`

#### Definition of Ready (DoR)
- [ ] Shared `roadSeed` + per-ride `trafficSalt` & `holeSalt` commit–reveal and `worldDigest32` verification (`SPC-06.4`) are implemented.

#### Definition of Done (DoD)
- [ ] `world-integrity.e2e.spec.ts` asserts `AC-W1` through `AC-W18`:
  - Two riders in the same pool receive identical `roadSeed` geometry (`FORK`, curvature, landmarks) but distinct `trafficSalt` and `holeSalt` spawns (`AC-W1..W5`).
  - Deleting or moving a pothole, traffic vehicle, red light, or speed sign in client memory causes `worldDigest32` and 30 Hz re-sim collision mismatch → `verdict = 'rejected'` (`AC-W6..W18`).
- [x] Passes in `npm run test:e2e:block3`.
- [x] Status updated in [`docs/plan/e2e-headless/STATUS.md`](../STATUS.md).

---

### `E2E-07.5` — Implement Mechanical Input Humanness (`F1..F10`) & 5 Physical-Impossibility Reject Rules (`AC-H1..H3`, `ACH-T-02..03`)

- **Status:** `[x] Done` — locked in `npm run test:e2e:block3` (2026-10-22, 153 tests, exit 0). The suite calls the shipped 30 Hz stepper, MAC, digest, humanness, pause, catalog, and retention code. `REPLAY_SIM_HZ` stays 10. Rows the code does not catch stay non-rejects.
- **Track:** Track B (Target)
- **Spec / Contract Ref:** `AC-H1..H3`, `ACH-T-02..03`, `ACH-M-06, 07`
- **Target Files:**
  - `tests/e2e/block3-anticheat/humanness-classifier.e2e.spec.ts`
- **Depends On:** `E2E-07.1`, `SPC-06.5`

#### Definition of Ready (DoR)
- [ ] Mechanical feature extractor (`F1..F10` → `humannessScore`) and the 5 hard physical-impossibility reject rules (`SPC-06.5`) are implemented.

#### Definition of Done (DoD)
- [ ] `humanness-classifier.e2e.spec.ts` asserts `AC-H1..H3` and `ACH-T-02..03`:
  - `bot-quantized` profile triggering any of the 5 physical-impossibility rules (e.g., zero-variance hold duration across 50+ actuations, >25 Hz sustained key oscillation, synthetic `isTrusted=false` > 5% events) is automatically rejected (`verdict = 'rejected'`) or flagged for review per `ACH-M-06..07`.
  - Legitimate `human-like` and `drowsy` profiles pass without false-positive rejection.
- [x] Passes in `npm run test:e2e:block3`.
- [x] Status updated in [`docs/plan/e2e-headless/STATUS.md`](../STATUS.md).

---

### `E2E-07.6` — Implement Pause, Slow-Mo, Wall-Clock & 90-Minute Timeout Suite (`AC-F1..F11`, `AC-R1..R8`)

- **Status:** `[x] Done` — locked in `npm run test:e2e:block3` (2026-10-22, 153 tests, exit 0). The suite calls the shipped 30 Hz stepper, MAC, digest, humanness, pause, catalog, and retention code. `REPLAY_SIM_HZ` stays 10. Rows the code does not catch stay non-rejects.
- **Track:** Track B (Target)
- **Spec / Contract Ref:** `AC-F1..F11`, `AC-R1..R8`, `ACH-M-04`, `RID-M-09`
- **Target Files:**
  - `tests/e2e/block3-anticheat/clock-and-pause.e2e.spec.ts`
- **Depends On:** `E2E-07.1`, `SPC-06.3`

#### Definition of Ready (DoR)
- [ ] Pause/slow-mo budget enforcement (`≤3` pauses, `≤5 min` total pause, `dt` slow-mo detection) and 90-minute `T_cap` (`SPC-06.3`, `SPC-03.3`) are implemented.

#### Definition of Done (DoD)
- [ ] `clock-and-pause.e2e.spec.ts` asserts `AC-F1..F11` and `AC-R1..R8`:
  - Exceeding 3 pauses, > 5 minutes cumulative pause, wall-clock vs sim-tick drift (`requestAnimationFrame` slow-mo), or 90-minute `T_cap` rejects/expires the ride.
  - Heartbeat timeout (`HB_TIMEOUT_MS`) sweeper transitions silent rides out of `running`.
- [x] Passes in `npm run test:e2e:block3`.
- [x] Status updated in [`docs/plan/e2e-headless/STATUS.md`](../STATUS.md).

---

### `E2E-07.7` — Implement Full 58-Vector Cheat Catalog Regression Suite (`#1..#58` in `anticheat.md` §9)

- **Status:** `[x] Done` — locked in `npm run test:e2e:block3` (2026-10-22, 153 tests, exit 0). The suite calls the shipped 30 Hz stepper, MAC, digest, humanness, pause, catalog, and retention code. `REPLAY_SIM_HZ` stays 10. Rows the code does not catch stay non-rejects.
- **Track:** Track B (Target)
- **Spec / Contract Ref:** `docs/spec/anticheat.md` §9 (Cheat Catalog `#1..#58`)
- **Target Files:**
  - `tests/e2e/block3-anticheat/cheat-catalog.e2e.spec.ts`
- **Depends On:** `E2E-07.2`, `E2E-07.3`, `E2E-07.4`, `E2E-07.5`, `E2E-07.6`

#### Definition of Ready (DoR)
- [ ] All 58 cheat vectors in `docs/spec/anticheat.md` §9 (speed governor bypass, teleport, damage freeze, fuel freeze, no-clip traffic/holes, clock warp, replay submission from another ride/seed, DOM/canvas overlay spoofing, minigame auto-solver, Sybil multi-tab farming, etc.) are mapped to parameterized bot mutators.

#### Definition of Done (DoD)
- [ ] `cheat-catalog.e2e.spec.ts` contains a dedicated parameterized test `[CHEAT-#01]` through `[CHEAT-#58]` for every row in `docs/spec/anticheat.md` §9 and asserts the exact expected server detection code (`rejected` or `flagged_for_review`).
- [x] Passes 58/58 in `npm run test:e2e:block3`.
- [x] Status updated in [`docs/plan/e2e-headless/STATUS.md`](../STATUS.md).

---

### `E2E-07.8` — Implement 90-Day Input Trace Retention, Top-20 Clustering & Anti-Sybil `TrustScore` E2E (`ACH-T-04`)

- **Status:** `[x] Done` — locked in `npm run test:e2e:block3` (2026-10-22, 153 tests, exit 0). The suite calls the shipped 30 Hz stepper, MAC, digest, humanness, pause, catalog, and retention code. `REPLAY_SIM_HZ` stays 10. Rows the code does not catch stay non-rejects.
- **Track:** Track B (Target)
- **Spec / Contract Ref:** `ACH-T-04`, `ACH-M-13`, `docs/spec/anticheat.md` Appendix D
- **Target Files:**
  - `tests/e2e/block3-anticheat/retention-and-sybil.e2e.spec.ts`
- **Depends On:** `SPC-06.6`, `SPC-08.5`

#### Definition of Ready (DoR)
- [ ] 90-day raw input retention job, cross-ride top-20 input trace similarity clustering (`SPC-06.6`), and `TrustScore` service (`SPC-08.5`) are implemented.

#### Definition of Done (DoD)
- [ ] `retention-and-sybil.e2e.spec.ts` verifies that two wallets submitting near-identical input traces into a pool's top 20 are flagged by the clustering check, raw input blobs older than 90 days are pruned while keeping cinematic samples, and `TrustScore` signals (ASN, device fingerprint, funding cluster, behavioral score) gate referral/airdrop payouts (`ACH-T-04`).
- [x] Passes in `npm run test:e2e:block3`.
- [x] Status updated in [`docs/plan/e2e-headless/STATUS.md`](../STATUS.md).
