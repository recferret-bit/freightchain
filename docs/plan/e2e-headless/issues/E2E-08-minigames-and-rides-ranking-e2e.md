# Epic E2E-08 — Dynamic Finish, `RideResult`, Minigames & Pool Appeals

> **Parent Plan:** [`docs/plan/E2E_HEADLESS_PLAN.md`](../../E2E_HEADLESS_PLAN.md) · **Status Board:** [`docs/plan/e2e-headless/STATUS.md`](../STATUS.md)
> **Track:** Track B (Target — [`docs/spec/rides.md`](../../../spec/rides.md) `RID-T-01..12`, [`docs/spec/minigames.md`](../../../spec/minigames.md) `MGM-T-01..09` & `AC-M1..20`, [`docs/spec/pool.md`](../../../spec/pool.md) `POOL-T-01..16`, [`docs/spec/platform_services.md`](../../../spec/platform_services.md) `PLT-T-01..14`)

---

## Overview

Verifies the target gameplay and pool rules: 1h-only shifts with dynamic `finishFor(roadSeed, trip, FINISH_RULES_VERSION)` distance at `V_BASE = 65 km/h` (`RID-T-01..07`), `stats.RideResult` persistence and versioned pool ranking (`RID-T-08..12`), the phone `phone-sms` minigame from [`docs/spec/minigames.md`](../../../spec/minigames.md) Part 1 (`MGM-T-01..12`), configurable weekly pool schedule with `last_start_at` and appeals window (`POOL-T-01..16`), and platform services (`PLT-T-01..14`). Checklists under `E2E-08.3` and `E2E-08.4` that mention parking pockets, noisy PNGs, or a `+45` s skip are retired. Part 1 wins.

---

## Tasks

### `E2E-08.1` — Implement Dynamic 65 km/h Finish & Curvature Factors E2E (`RID-T-01..07`)

- **Status:** `[x] Done`
- **Track:** Track B (Target)
- **Spec / Contract Ref:** `RID-T-01..07`, `RID-M-01..11`
- **Target Files:**
  - `tests/e2e/block1-offchain/rides-dynamic-finish.e2e.spec.ts`
- **Depends On:** `SPC-03.1`, `SPC-03.2`, `SPC-03.3`

#### Definition of Ready (DoR)
- [ ] Removal of 4h/8h ride tiers (`SPC-03.1`), `finishFor(roadSeed, trip, FINISH_RULES_VERSION)` at `V_BASE = 65 km/h` with `(RX, RZ, RT)` curvature & `snapSafe` (`SPC-03.2`), and 1h finish line rendering (`SPC-03.3`) are implemented.

#### Definition of Done (DoD)
- [ ] `rides-dynamic-finish.e2e.spec.ts` asserts `RID-T-01` through `RID-T-07`:
  - `tier='4h'` and `tier='8h'` ride creation requests return `400` (`RID-T-01`).
  - `finishFor` is deterministic for `(roadSeed, trip, FINISH_RULES_VERSION)` across all 14 trips, falls within `[48_000, 65_000]` meters, and never lands inside a fork/intersection (`snapSafe`, `RID-T-02..05`).
  - All riders in the same pool receive the exact same `completeDist` (`RID-T-06`).
  - 1h rides render the physical finish line banner at `completeDist` (`finish: true`, `RID-T-07`).
- [ ] Passes in `npm run test:e2e:block1`.
- [ ] Status updated in [`docs/plan/e2e-headless/STATUS.md`](../STATUS.md).

---

### `E2E-08.2` — Implement `stats.RideResult` Breakdown & Pool Ranking Formula E2E (`RID-T-08..12`)

- **Status:** `[x] Done`
- **Track:** Track B (Target)
- **Spec / Contract Ref:** `RID-T-08..12`, `RID-M-12..21`
- **Target Files:**
  - `tests/e2e/block1-offchain/ride-result-ranking.e2e.spec.ts`
- **Depends On:** `SPC-03.4`, `SPC-03.5`, `SPC-03.6`

#### Definition of Ready (DoR)
- [ ] Damage-by-source tracking (`holes`, `vehicles`, `props`, `cold`, `other`), server red-light counting (`stopLine(j, +1)`), `stats.RideResult` Prisma model, and versioned pool ranking (`scoreFormulaVersion`, `GET /api/pools/:id/results`) from `SPC-03.4..6` are implemented.

#### Definition of Done (DoD)
- [ ] `ride-result-ranking.e2e.spec.ts` asserts `RID-T-08` through `RID-T-12`:
  - Verified ride populates `stats.RideResult` with exact `damageHoles`, `damageVehicles`, `damageProps`, `damageCold`, `redLights`, `mgWrong`, `mgMissed`, `mgPenaltySeconds`, `effectiveDurationMs`, and `scoreFormulaVersion` (`RID-T-08..09`).
  - Pool ranking orders verified rides by `effectiveDurationMs = durationMs + mgPenaltySeconds * 1000` + violation/damage penalties and breaks ties deterministically (`RID-T-10..11`).
  - `GET /api/pools/:id/results` hides detailed breakdown before `payout_at` and reveals full `RideResult` rows after `payout_at` (`RID-T-12`).
- [ ] Passes in `npm run test:e2e:block1`.
- [ ] Status updated in [`docs/plan/e2e-headless/STATUS.md`](../STATUS.md).

---

### `E2E-08.3` — Phone-sms schedule, cancel, and salt reveal E2E (`MGM-T-01..05`)

- **Status:** `[x] Done` — `minigames-schedule.e2e.spec.ts` covers `MGM-T-01..05` in `npm run test:e2e:block3`. Part 1 of `docs/spec/minigames.md`. No parking pocket.
- **Track:** Track B (Target)
- **Spec / Contract Ref:** `MGM-T-01..05`, `AC-M1..M10`, `MGM-M-01..06`
- **Target Files:**
  - `tests/e2e/block3-anticheat/minigames-schedule.e2e.spec.ts`
- **Depends On:** `SPC-07.1`, `SPC-07.2`

#### Definition of Ready (DoR)
- [ ] Minigame `mgSalt = HMAC(MG_SECRET, rideId‖wallet)` commit–reveal, schedule generator (2–4 events on 1h rides, 0 on `tier='free'`, ≥8 min gap, ≥300m hazard clearance, parking pocket fallback) from `SPC-07.1..2` are implemented.

#### Definition of Done (DoD)
- [ ] `minigames-schedule.e2e.spec.ts` asserts `MGM-T-01..05` and `AC-M1..M10`:
  - `tier='free'` rides spawn `0` minigames (`MGM-T-01`).
  - `tier='1h'` rides spawn `2..4` minigames with `>= 480s` spacing and `>= 300m` clearance from forks/construction/tunnels (`MGM-T-02..03`).
  - Two riders on the same `roadSeed` get different minigame types/values/positions (`mgSalt` per ride/wallet, `MGM-T-04`, `AC-M1..M4`).
  - Stopping inside the roadside parking pocket (`speed < 0.5 m/s`) is required to open the minigame UI; driving past without stopping records `missed` (`MGM-T-05`, `AC-M5..M10`).
- [x] Passes in `npm run test:e2e:block3`.
- [x] Status updated in [`docs/plan/e2e-headless/STATUS.md`](../STATUS.md).

---

### `E2E-08.4` — Phone-sms SVG, scoring, and rate-limit E2E (`MGM-T-06..12`)

- **Status:** `[x] Done` — `minigames-challenges.e2e.spec.ts` covers `MGM-T-06..12` in `npm run test:e2e:block3`. SVG slips, `+20` on the third wrong try, no `+45`, rate limit `mg_rate_limited`.
- **Track:** Track B (Target)
- **Spec / Contract Ref:** `MGM-T-06..09`, `AC-M11..M20`, `MGM-M-07..12`
- **Target Files:**
  - `tests/e2e/block3-anticheat/minigames-challenges.e2e.spec.ts`
- **Depends On:** `SPC-07.3`, `SPC-07.4`, `SPC-07.5`

#### Definition of Ready (DoR)
- [ ] Server noisy PNG renderer (`SPC-07.3`), `POST /api/rides/:id/minigames/:eventId/answer` + base catalog (`SPC-07.4`), and penalties / `×2` accessibility mode (`SPC-07.5`) are implemented.

#### Definition of Done (DoD)
- [ ] `minigames-challenges.e2e.spec.ts` asserts `MGM-T-06..09` and `AC-M11..M20`:
  - Challenge payload contains a noisy PNG image (`image/png` with geometric distortion + noise lines) and **zero** plaintext target digits/codes in JSON (`MGM-T-06`, `AC-M11..M13`).
  - Correct answer within time window adds `0s` penalty; wrong answer adds `+20s` (`mgWrong++`); timeout/missed adds `+45s` (`mgMissed++`); >2 missed minigames marks ride `flagged_for_review` (`MGM-T-07..08`, `AC-M14..M18`).
  - Accessibility "more time" mode (`×2` timer) doubles the allowed response window and records `extendedTimerUsed = true` (`MGM-T-09`).
  - No minigame ever invokes `window.solana.signTransaction` or `signMessage` (`AC-M19..M20`).
- [x] Passes in `npm run test:e2e:block3`.
- [x] Status updated in [`docs/plan/e2e-headless/STATUS.md`](../STATUS.md).

---

### `E2E-08.5` — Implement Pool Schedule, `last_start_at` Cutoff, Ticket Burn UI & Appeals E2E (`POOL-T-01..16`)

- **Status:** `[x] Done` — `pool-schedule-appeals.e2e.spec.ts` passed in the lane. Block 2 on that worktree exited 0 (46 pass). Not re-run on the merged tree.
- **Track:** Track B (Target)
- **Spec / Contract Ref:** `POOL-T-01..16`, `POOL-M-01..14`
- **Target Files:**
  - `tests/e2e/block2-chain/pool-schedule-appeals.e2e.spec.ts`
- **Depends On:** `SPC-05.1`, `SPC-05.2`, `SPC-05.3`, `SPC-05.4`, `SPC-05.5`

#### Definition of Ready (DoR)
- [ ] Configurable weekly pool schedule (`opens_at`, `sales_close_at`, `last_start_at`, `play_close_at`, `validation_until`), `409 pool_schedule_mismatch`, `409 pool_last_start_passed`, ticket burn UI warning, and appeals workflow (`SPC-05.1..5`) are implemented.

#### Definition of Done (DoD)
- [ ] `pool-schedule-appeals.e2e.spec.ts` asserts `POOL-T-01` through `POOL-T-16`:
  - Starting a pool ride after `last_start_at` (`play_close_at - 1h15m`) returns `409 pool_last_start_passed` (`POOL-T-01..04`).
  - Ticket purchase or ride start when DB schedule diverges from on-chain PDA timestamps returns `409 pool_schedule_mismatch` (`POOL-T-05..06`).
  - Unused ticket after `last_start_at` is burned into the pool pot; lobby modal requires explicit burn-warning checkbox before purchase (`POOL-T-07..09`).
  - Rejected/flagged rider can submit an appeal during `[play_close_at, validation_until]`; `commit_winners_root` is blocked while open appeals exist or before `validation_until` (`POOL-T-10..16`).
- [ ] Passes in `npm run test:e2e:block2`.
- [ ] Status updated in [`docs/plan/e2e-headless/STATUS.md`](../STATUS.md).

---

### `E2E-08.6` — Implement Platform Services E2E (`PLT-T-01..14`)

- **Status:** `[x] Done`
- **Track:** Track A + B
- **Spec / Contract Ref:** `PLT-T-01..14`, `PLT-M-01..12`
- **Target Files:**
  - `tests/e2e/block1-offchain/platform-services.e2e.spec.ts`
- **Depends On:** `E2E-03.2`

#### Definition of Ready (DoR)
- [ ] All 14 test cases in `docs/spec/platform_services.md` (`PLT-T-01..14`: global/player stats aggregation under `findByWalletForUpdate`, 3D entity revision CRUD + signed publish + ETag bundle, Redis fail-closed AI rate limiter, PostgreSQL shared AI job queue processed only by `editor:worker`, PostHog opt-in `POSTHOG_ENABLED=1` without `$create_alias` or key leak) are mapped.

#### Definition of Done (DoD)
- [ ] `platform-services.e2e.spec.ts` asserts `PLT-T-01` through `PLT-T-14` against real PostgreSQL and Redis (including simulated Redis disconnect → `503` fail-closed on AI generation routes).
- [ ] Passes in `npm run test:e2e:block1`.
- [ ] Status updated in [`docs/plan/e2e-headless/STATUS.md`](../STATUS.md).
