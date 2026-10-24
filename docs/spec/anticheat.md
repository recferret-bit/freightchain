# Anti-cheat — spec and test plan

> Telemetry v2.1, a server resimulation at 30 Hz, world integrity, mechanical input, verdicts. Decisions 1–16, 18, 24–27, 31, 33, 35. The full text of the plan (the former §1–12, §14–18 of `anticheat_test_plan.md` (superseded, merged into docs/spec)) is Appendix A, unchanged. Minigames — [`minigames.md`](minigames.md), rides and the ranking — [`rides.md`](rides.md), the pool — [`pool.md`](pool.md).

## Part 1. Spec
### 1.1 In the code now (`origin/main`)
- The v1 pipeline (Appendix A §1):
  - a heartbeat (`applyReport`, `ride.entity.ts`);
  - telemetry batches at 10 Hz with SHA-256 **and no key**;
  - `verdict-rules.ts` (`RULES_VERSION = 7`);
  - `world-checks.ts:73` `checkWorld`, `world-facts.ts:67`, `batch-summary.ts:70`;
  - `replay-engine.ts` — a check of the client's samples, not full physics.
- There is already a check for "the client removed the holes; on the server they are there": `obstacle-ignored` → `REJECTED` (`e2e-road-check.mjs` B, line 113).
- A red light is not checked by the rules (#32). Slow-mo is not limited for free (#11).
- Shadow batch MAC, default off (`TELEMETRY_V21=off|shadow`). `shadow` adds `{sessionKey, keyId: "v2", protocol: 2}` on `POST /start` only, plus `trafficSaltCommit` and `holeSaltCommit` (sha256 of HMAC(sessionKey, `fc-salt:traffic|hole` + ride id)). The salts are not on GET. The 10 Hz road is still `roadPlanFor(seed, trip)`. A batch may carry `protocol: 2`, `mac`, and base64 `streams` (deflate-raw). The MAC is HMAC-SHA256 over `fc-batch:v2\n` + rideId + seq + previous mac + the v1 canonical JSON, and it is checked before inflate. `protocol`, `mac`, and `streams` are not inside that JSON. A missing or wrong MAC is `400 batch-mac-missing` or `400 batch-mac-invalid`. A stream that does not inflate is `400 batch-streams-invalid`. Over 64 KB compressed or 256 KB uncompressed is `400 batch-streams-oversize`. A v1 batch is still accepted. The 10 Hz verdict does not read `streams`. `RULES_VERSION` stays 7. `stepAt30Hz` (`dt = 1/30`) is deterministic and is not called by the replay.
- Heartbeats count `pauseCount` and `pauseSeconds`. With `TELEMETRY_V21=shadow`, more than 3 pauses flags `pause-limit`, more than 5 minutes flags `pause-time`, and a game/wall ratio below 0.9 after 60 s outside pauses flags `time-dilation`. All three are flags. None of them reject the ride.

### 1.2 Rules
- **ACH-M-01** MUST: the source of truth is the server. A ride's outcome is computed by **resimulation from raw input** at a fixed step of **30 Hz** (decision 12; the fallback is 20 Hz). The goal is a bitwise match. Tolerances remain only for v1 poses (decision 5).
- **ACH-M-02** MUST: telemetry protocol v2.1:
  - a `sessionKey` per ride and an HMAC of every batch;
  - streams `inp` / `clk` / `chk` (with `worldDigest32`) / `mg` / `env`;
  - a batch = 60 steps / 2 s, deflate, ≈ 0.5 MB/h.
  
  A batch without a valid MAC → `batch-mac-invalid` (reject). A v1 client on a v2.1 ride → `409 client_outdated`.
- **ACH-M-03** MUST: world integrity. A divergence between the client's world and the server's → `world-digest-mismatch`. Driving through a server obstacle with no damage → `world-collision-ignored` / `obstacle-ignored` (reject). Also `noclip-path`, `lateral-teleport`, `toll-barrier-breach`.
- **ACH-M-04** MUST: time. Game time / wall ≥ 0.9 outside a pause. Pauses ≤ N per ride and ≤ M seconds in total (decision 6). A violation → `time-dilation`. Speeding up → a budget rejection or `speed-hack`.
- **ACH-M-05** MUST: leaving the road for longer than `OFFROAD_FAIL_SECONDS` (20 s) is a failure (decision 7).
- **ACH-M-06** MUST: mechanical input — features F1–F10 → `humannessScore`. A reject only on the five "physically impossible" conditions (§16.4 a–e, decision 27). Everything else is review. A human-like bot is a cheat (decision 3); it is caught by the humanness score, by minigames, and by a manual review of the top-20.
- **ACH-M-07** MUST: `isTrusted=false` → a flag and a manual review, not a reject (decision 26).
- **ACH-M-08** MUST: false-positive targets: ≤ 2% flag, ≤ 0.1% reject on honest players (decision 15).
- **ACH-M-09** MUST: the verdict levels are `verified` / `review` / `rejected`. A pool's top-20 is checked manually. A manual override comes with `overriddenBy` and `note`.
- **ACH-M-10** MUST: every ride has a `RULES_VERSION`. `verdict:rejudge` judges an old ride by its own rules. The donated-hole codes (`donated-obstacle-ignored`, `event-unapplied`) exist only for old rides (AC-W18, decision 33).
- **ACH-M-11** MUST: traffic in a pool is a shared `roadSeed` plus a personal `trafficSalt`, with commit–reveal (decision 13). A `holeSalt` per attempt exists only if there is more than one qualifying attempt (decision 35).
- **ACH-M-12** MUST: the resimulation budget is 1h ≈ 2–7 s of CPU. Resimulation is incremental, per batch, plus a background final verdict (decision 8). A full recheck of a pool fits in the review window ([`pool.md`](pool.md)).
- **ACH-M-13** MUST: privacy: input traces are kept for 90 days; cross-wallet clustering is only for the top-20 (decisions 16, 31).
- **ACH-M-14** MUST NOT: spectators must be unable to add anything to a ride's world. Donation effects are removed; the server does not accept `effects/:eventId/applied` (decision 33, AC-W16/17).
- **ACH-M-15** MUST: a replay does not reveal raw input events or their timing (decision 18; [`replays_streams.md`](replays_streams.md) RPL-M-07).
- **ACH-M-16** MUST: CI is in-process tests with fake clocks and golden fixtures. At night — long rides at real pace, and concurrency (decision 4). The harness defaults to `TRAFFIC_PROOF_REQUIRED=true` (decision 9). A golden fixture is rebuilt only with a `RULES_VERSION` bump (decision 10).

## Part 2. Test plan
Tests are defined in Appendix A; their ids are kept:
- **AC-P1…P12** — positive (§4);
- **AC-T1…T16** — bot timing (§10, §17.4);
- **AC-H1…H3** — baseline humans;
- **AC-W1…W18** — integrity and protocol (§17.2);
- the cheat catalog **#1…#58** (§5, §9.11, §17.3).

New tests (they close the gaps):
| id | Rule | Scenario | Expectation |
|---|---|---|---|
| ACH-T-01 | M-05 | off-road for 19 s and for 21 s | 19 s — no failure, 21 s — a failure (`OFFROAD_FAIL_SECONDS = 20`) |
| ACH-T-02 | M-09 | a manual `verified` on a flagged ride, then `verdict:rejudge` | the override is kept (`overriddenBy`); the top-20 lands in `pool:attention` |
| ACH-T-03 | M-11 | reveal `trafficSalt` after the verdict | it matches the commit at the start |
| ACH-T-04 | M-13 | traces older than 90 days; clustering | the traces are deleted; clustering does not run for places > 20 |

### Traceability
| Rule | Tests |
|---|---|
| ACH-M-01 | AC-P6, AC-P7, AC-W5 (`resim-mismatch`) |
| ACH-M-02 | AC-W9, AC-W10, AC-W11, AC-W12, AC-W15 |
| ACH-M-03 | AC-W1, AC-W2, AC-W3, AC-W4 |
| ACH-M-04 | AC-W6, AC-W7, AC-T10, AC-T11 |
| ACH-M-05 | ACH-T-01 |
| ACH-M-06 | AC-T1…T9, AC-T12, AC-H1, AC-H2 |
| ACH-M-07 | catalog #57 (`untrusted-input`) |
| ACH-M-08 | AC-P10, AC-H1 (the FP metric) |
| ACH-M-09 | ACH-T-02 |
| ACH-M-10 | AC-W18 |
| ACH-M-11 | AC-F7, AC-T5, ACH-T-03 |
| ACH-M-12 | AC-P8, AC-P9 |
| ACH-M-13 | ACH-T-04 |
| ACH-M-14 | AC-W16, AC-W17, RPL-T-85 |
| ACH-M-15 | RPL-T-13 |
| ACH-M-16 | AC-P7 (golden), CI infrastructure (Appendix A §7) |

Total: 16 MUST, the planned ids ACH-T-01…04 plus the ids from the appendix (AC-P1…P12, AC-T1…T16, AC-H1…H3, AC-W1…W18) and catalog #1…#58. Every MUST has an id. An id is not a written test. The executable bar is [`../testing/COVERAGE_CONTRACT.md`](../testing/COVERAGE_CONTRACT.md).

---

## Appendix A. The anti-cheat plan (the former header, §1–7, §9–11, §14–16, §17 (the introduction, 17.2–17.4), §18)
> Moved unchanged from `anticheat_test_plan.md` (superseded, merged into docs/spec) (17.10.2026); heading levels are shifted by one. Part 1 of this file is normative; if they disagree, the spec wins.

## Block 3: anti-cheat and driver bots — test plan

Status: **plan** (decisions 1–10 were accepted by the owner on 17.10.2026 with changes; see §8). Plan only: no implementation, no tests, no git.
**The plan's base on 17.10 is `origin/main` @ `3ab33d8`.** PR #3 has since been merged (`4e53f247`). HARD is now `free-3c` (30 min), `free-3b` is frozen, the ticker is TEN4. The marks "later (PR #3)" in the text below are a snapshot from before the merge; this code is already on main. Decisions 1–66 are unchanged.
For reference: PR #3 `cursor/ten4-tokenomics-6271` @ `794fed8` (merged), PR #5 `cursor/local-e2e-suite-b044`.
**Code check (17.10.2026, §13–19):** read-only checkout of this repository, local `main` @ `75ed4a06`. Every file that §13–19 cite is byte-for-byte identical to `origin/main` @ `3ab33d8` (the diff between them is only in `client/shared/entity/plan.js`). The code now has `RULES_VERSION = 7` (`server/src/domain/verdict/verdict-rules.ts:9`), `trafficVersion` 0/1 (v1 is set by `start-ride`), `CHALLENGE_KINDS = []` (`server/src/domain/rides/ride-challenge.ts:17`), a heartbeat every 10 s (`client/js/online.js`).

Contents: §1–7 — the current system, the tests, and the bot block (v1); §8 — decisions 1–10; **§9 — Anti-cheat hardening v2**; §10 — bot tests for input timing; §11 — the answer about 8h; §12 — decisions 11–18 (**the owner's answers of 17.10**: 13, 15, and 16 accepted; 11, 12, 14, 17, and 18 changed); **§13 — minigame captchas (1h only)**; **§14 — telemetry protocol v2.1**; **§15 — the server check and world integrity**; **§16 — mechanical-input detection**; **§17 — bot tests for minigames and integrity**; **§18 — the estimate: Pre-season (shadow) and Season 1**; **§19 — decisions 19–32**.

---

### 1. How a ride is checked now (pipeline)

#### 1.1 The path of a ride
1. `POST /api/rides` — the server creates the ride and itself chooses `seed` and `trip`. A seed is one of three kinds: a free ride has its own (`entropy.seed31()`), a ticket ride has the pool seed (`Pool.rideSeed`, shared by everyone in the pool), a pay-per-ride has the tariff's daily seed (`DailySeedRepositoryPort`, shared for the day). In PR #3 a weekly ticket and a promo ride have their own seed.
2. `POST /api/rides/:id/start` — the server sets `trafficVersion = 1` if `TRAFFIC_PROOF_REQUIRED=true` (the default). The client cannot lower the version: `{trafficVersion:0}` in the body is ignored; this is checked in the `downgrade` scenario.
3. Heartbeat (`applyReport`, `ride.entity.ts`): `s`, `t`, `hull`, `crashesVehicle/Building`. Checks: `|Δs| ≤ MAX_SPEED·dt·slack`, `s ≤ 28 m/s·wall`, game time ≤ wall. Silence longer than `HB_TIMEOUT_MS` (150 s) → `failed: heartbeat lost`. Heartbeats more often than `HB_MIN_INTERVAL_MS` (1 s) are ignored. In PR #3, on a ranked ride, `cleanMetres` is fixed into `lastS` at the first fault (hull < 100, or the crash counter grew).
4. `POST /api/rides/:id/batches` (`UploadBatchHandler`): a batch every 2 game seconds or 500 frames, strictly in order (otherwise `429 batch_out_of_order`). The server computes its own SHA-256 over the canonical JSON. Budgets from wall time: game-t ≤ wall·1.05+30 s, seq ≤ wall/0.2+10, bytes ≤ 65 536/s. Batches are still accepted for 60 s after `/end`. The batch summary (`batch-summary.ts`, `world-facts.ts`) is computed on intake, on the server road from the seed.
5. `POST /api/rides/:id/end` → `completed` when `lastS ≥ completeDist`, otherwise `abandoned`. Then `VerdictService.judge`, or the `ReplayQueuePort` queue → `ReplayEngine.verify` + `RideVerdict.judge` → `RideVerdict` and `RideReplay` in the DB; HONK/TEN4 is credited only when `verified`.

#### 1.2 Telemetry format
- **Sample** (10 Hz of game time): `[t, s, d, psi, v, rpm, gear, hull, gas, brake, steer, clutch, clock, flags, inputBits, fork]`. The verdict reads the first 12 columns, and from the rest only the gas bit, the flags, and fork.
- **inputs**: `[ms, code, down]`. Raw events are not given to spectators; phone events (`phone:`) do not count as driver input.
- **trafficProof** (v1, `client/shared/traffic-proof.js`): base64 of Float64 LE, a frame `[dt, clock, s, d, psi, trailerYaw, v, vel, hull, rev, branch, postHull]`, dt ≤ 50 ms. It is part of the hashed canonical text.
- **traffic**: the car track is for display only; it is not hashed and it is not judged.

#### 1.3 The hash chain
`prevHash` of batch 0 equals `rideId`; each next one is the hash of the previous (or `unhashed-<seq>`). Errors: `missing-batches`, `chain-broken`, `hash-mismatch` (reject); `unhashed-batch` (flag only). Important: SHA-256 with no key. A modified client recomputes it itself; the chain confirms integrity and order, but not origin. This is stated outright in the README. The RFC 6962 root is built in `telemetry-merkle.ts`.

#### 1.4 Server simulation (`ReplayEngine.verify`, 10 Hz, 2 substeps)
- `unsafeSamples`: resource bounds, `bad-sample`.
- `checkChain`, `checkSamples` (`over-governor` > 28·1.05 m/s, `teleport` by `Δs`), `checkAgreement` (`recording-mismatch`, `recording-incomplete` < 50%, `recording-gaps` < 90%), `checkMotion` (`sample-gap` > 1 s, `speed-mismatch`: Σ Δs − Σ v·Δt), `checkInputsPresent` (`no-inputs`, `no-throttle-input`), `checkInputsAgree` (`inputs-mismatch`, flag), `checkHumanTiming` (`uniform-holds`, `repeated-timings`, `instant-presses`, all of them flags), `checkChallenges` (the `CHALLENGE_KINDS` table is empty, so it is in effect off).
- The road from the seed (`roadPlanFor(seed, trip)`): holes (`obstacle-ignored` at ≥ 2 → reject, `obstacle-no-impact` at 1 → flag; damage must be ≥ 25% of expected), leaving the road (`offroad-ignored`), acceleration without gas (`accel-without-gas`), donated holes (`donated-obstacle-ignored`; **removed by decision 33**), day and night events.
- Longitudinal physics (`client/shared/physics.js` → `stepTruckPhysics`, `ReplayPhysics`): `physics-speed-mismatch` (reject if the acceleration is > 1.8× what is possible on ≥ 3 steps), `physics-coasting-mismatch` (flag).
- **Traffic v1** (`traffic-proof.ts` + `TrafficSimulator` = the shared kernel `client/shared/traffic-simulation.js`): the server itself spawns traffic from `seed ^ TRAFFIC_SEED_XOR`. Every frame is fed to `stepPose` with **the pose from the client**; the server steps its own cars and computes swept contact and damage. Errors: `traffic-proof-missing` (no proof, or the frames do not cover `driveSeconds`), `traffic-proof-invalid` (bounds, time continuity, hull grows, postHull below the server's), `traffic-collision-ignored` (a fatal contact, while the ride is "completed"), `traffic-damage-ignored`, `traffic-proof-mismatch` (the sample matches no post-frame).
- **Limit:** the server does not re-run the truck from the raw presses. Poses (s, d, psi, v) are taken from the client, and the server checks their bounds, the longitudinal physics, and agreement with traffic. There is no lateral kinematics (d and psi against the steering and the grip).

#### 1.5 The verdict and what hangs off it
- Status: any reject → `rejected`, otherwise any flag → `flagged`, otherwise `verified`. `RULES_VERSION = 7`. Only `verified` is admitted to prizes (`VERDICT_ENFORCE`).
- Pool marks (`pool-attention.ts`, the CLI `pool:attention`, and before payout): `pool-duplicate-recording` (a copy of someone else's recording on the same seed, a tolerance of 0.1 m on 90% of ≥ 40 points spaced at 25 m), `pool-shared-ip`, `pool-new-wallet-top3`, `pool-distance-outlier`. All of them flag only.
- A recheck: `rejudge` (an admin, with a signature), `rejudgeQuietly` / the CLI `verdict:rejudge` (after a rules change); recordings removed by cleanup → 409 or a skip.
- **PR #3 (cleanMetres and ranked):** `canJudgeRide` also judges ranked abandoned/failed rides that have a distance. `cleanMetres` = min(`firstDamageS` from the summary, the first hole hit, `atMetre` of the first obstacle/traffic flag from the sim), and `clean-mismatch` catches a heartbeat that claimed more. The score on the board is `cleanBps = cleanMetres·10000/completeMetres`.
- **timeScale:** demo wallets have `minSeconds = tier.seconds / DEMO_SCALE` (the default is 60). A paid 1h can thus be legally shortened for tests. The length of the free levels = `FREE_RIDE_SECONDS` (180) × multiple.

#### 1.6 Trips (lengths at `FREE_RIDE_SECONDS=180`)
| trip | level | length | branch |
|---|---|---|---|
| `free-1c` | EASY | 3 min, K 0.3, 2 intersections | main |
| `free-2c` | MEDIUM | 5 min, 3 intersections + a fork | main |
| `free-3b` | HARD (frozen) | 15 min, 6 intersections, 2 forks, no assist | legacy on main |
| `free-3c` | HARD | 30 min (×10) | the current HARD on main |
| `1h` / `4h` / `8h` | paid | 1/4/8 h (a demo wallet ÷ DEMO_SCALE) | main. **Decision 17 (17.10): 4h and 8h are removed for now; only 1h and the free rides remain** |

#### 1.7 Key files
- Server, domain: `server/src/domain/verdict/{replay-engine,traffic-proof,traffic-sim,replay-physics,recording-checks,human-checks,challenge-checks,world-checks,verdict-rules,ride-verdict.entity,ride-replay.entity,pool-attention}.ts`, `server/src/domain/telemetry/{telemetry-rules,batch-summary,world-facts,sample-safety,ride-batch.entity,telemetry-merkle}.ts`, `server/src/domain/rides/{ride.entity,ride-trip,ride-challenge}.ts`, `server/src/domain/road/*`.
- Server, application: `application/services/verdict.service.ts`, `use-cases/telemetry/upload-batch`, `use-cases/verdict/process-replay-queue`, `use-cases/admin/{rejudge-ride,rejudge-rides,override-verdict}`, `use-cases/rides/{start-ride,end-ride,heartbeat}`, `infrastructure/verdict/*-replay-queue.adapter.ts`, `infrastructure/scheduling/replay-verification.scheduler.ts`.
- Shared kernel: `client/shared/{physics,traffic-simulation,traffic,road-network,road,simulation-config,traffic-proof,prng}.js`.
- Client: `client/js/telemetry.js`, `client/js/sim/{physics,damage,traffic}.js`, `client/js/trips.js`, `server/src/domain/verdict/ride-review.ts` (the public label `UNDER REVIEW` / `ACCEPTED` / `REJECTED`).
- Public tech explainers: [`docs/tech/anti-cheat/index.html`](../tech/anti-cheat/index.html), [`docs/tech/verified-play/index.html`](../tech/verified-play/index.html).

#### 1.8 A summary of the exact thresholds, budgets, and CLI of rules v4 / v5 / v7 (from `verified-play`)
- **Rules v7 (`trafficProof`, `client/shared/traffic-proof.js` ⇄ `server/src/domain/verdict/traffic-proof.ts`)**:
  - A frame is a `Float64Array` (12 LE numbers): `[dt, signalClock, s, d, psi, trailerYaw, v, signedVelocity, hull, reverse, branch, postHull]`, `dt <= 50 ms`.
  - A batch is cut every **2 game seconds** or **500 frames**; a `trafficProof` ceiling of **64 KB**, a batch ceiling of **98 304 B** (HTTP body limit **100 KB**), a byte stream of `<= 65 536 B / s wall`, a batch count of `<= wall / 0.2 + 10`.
  - Rejection codes: `traffic-proof-missing`, `traffic-proof-invalid`, `traffic-collision-ignored`, `traffic-damage-ignored`, `traffic-proof-mismatch`.
  - Chrome E2E (`bash .claude/skills/run-tests/e2e.sh traffic` / `node server/scripts/e2e-traffic-proof.mjs`, filter `TRAFFIC_CASES=<name>`, on macOS it launches Chrome with Metal): 9 scenarios (`honest`, `honest-finish`, `honest-slow`, `honest-collision`, `no-cars`, `no-cars-no-columns`, `ignore-damage`, `strip-proof`, `malformed-proof`).
- **Rules v5 (`sample-safety.ts`) and v4 (`recording-checks.ts`, `verdict-rules.ts`)**:
  - Coarse bounds on sample position (`sample-safety.ts` on `POST /api/rides/:id/telemetry`): distance from the start `|s| <= 1000 + 56 * game_s` (m), the step between samples `|Δs| <= 1000 + 56 * dt` (m), distance covered in one batch `<= 10 km`, otherwise `400 bad_batch` or `bad-sample`; two empty batches in a row are rejected. `recordingAllowance` budgets (v4): `game seconds <= wall * 1.05 + 30`, `seq <= wall / 5 + 10`, `totalBytes <= wall * 4 KB + 256 KB`.
  - Motion and progress bounds: total distance `<= 28 * 1.05 * wall + 50 m`, a step `|Δs| <= 28 * 1.1 * dt + 10 m`, a gap `sample-gap > 1 s`, a speed-integral disagreement `speed-mismatch > 50 m + 1%`, duplicate times `dupT`, a coarse browser timer `timerStepMs`, the phone prefix `PHONE_PREFIX = 'phone:'` (it does not count as control input).
  - The server leaf of a batch's Merkle tree (`RideBatch.serverHash` in `telemetry-merkle.ts`): the prefix `0x02` (RFC 6962).
- **World checks (`world-checks.ts`, `road-damage.mjs`)**:
  - Holes: `>= 2` missed holes with no damage → `obstacle-ignored` (reject), `1` → `obstacle-no-impact` (flag), `>= 2` unmeasured → `obstacle-unmeasured` (flag).
  - The shoulder and forks: driving off the road for `> 27 s` (`OFFROAD_FAIL_SECONDS * 1.25 + 2`) → `offroad-ignored` (reject); the fork apron `RoadLayout.forkApron` gives a corridor of `15 m` over `205 m`.
  - Acceleration without gas: `accel-without-gas` (reject on a gain of `>= 2 m/s` or `>= 5` steps). A manual audit of road damage: `node server/scripts/road-damage.mjs`.
- **The resimulation queue, retention, and the CLI**:
  - The worker and a manual run of the 10 Hz `ReplayEngine`: `npm run replay:worker`, `npm run replay:verify -- --ride <id>`.
  - Rejudging rides and pool marks: `npm run verdict:rejudge`, `npm run pool:attention -- --pool <id>` (`pool-duplicate-recording`: a match of `|Δd| <= 0.1 m` on `>= 90%` of points stepped at `25 m` over a distance of `>= 1 km`).
  - Retention periods (`retention:sweep`): `TELEMETRY_RETENTION_DAYS = 90` days for telemetry batches, `SIGNIN_RETENTION_DAYS = 180` days for sign-in logs.

---

### 2. What tests already cover

| Where | What it covers | Duration |
|---|---|---|
| `server/test/unit/domain/verdict.spec.ts` (33), `verdict-motion.spec.ts` (14), `world-checks.spec.ts` (13), `replay-engine.spec.ts` (9), `replay-physics.spec.ts` (6), `traffic-sim.spec.ts` (5), `traffic-proof.spec.ts` (4), `telemetry-merkle.spec.ts` (8), `sample-safety` (2), `replay-inputs` (3), `ride-audit` (2) | Pure check functions, reason codes | synthetic, seconds |
| `unit/.../upload-batch.handler.spec.ts` (10), `rejudge-ride*.spec.ts` (8), `verdict.service.spec.ts` (9; in PR #3, +147 lines on ranked and cleanMetres) | Batch order, a recheck, the service | — |
| `integration/.../ride-best-verified*.adversarial` (8) | The best verified ride under attacks on queries | DB |
| `scenarios/verdict.scenarios.ts` (18) | HTTP: verified, v4 rules, a beacon, no recording, scripted timing → flag, a 600 m disagreement, a late batch, holes from the server, the hash (unhashed / mismatch), the byte budget, the replay queue | `FREE_RIDE_SECONDS` is small, **`TRAFFIC_PROOF_REQUIRED=false`** in the harness |
| `scenarios/telemetry.scenarios.ts` (4) | Unsafe samples, a resubmit, the 60 s window, 401/404/400 | — |
| `scenarios/traffic-proof.scenarios.ts` (1×5) | v1: honest / downgrade / malformed / unbound / rehash-without-proof. **The honest recording is built in Node by the server `TrafficSimulator` and receives VERIFIED** | 6 s of game |
| `server/scripts/e2e-verified-play.mjs` | A human and a metronome bot in Chrome; API bots: no input, a teleport, over the governor, an edit after the hash, unhashed, a bad link, an overflow | `FREE_RIDE_SECONDS=40` |
| `server/scripts/e2e-verified-deep.mjs` | 20+ recording and timing cases, the upload protocol, visibility, admin, retention, bulk rejudge | `FREE_RIDE_SECONDS=30` |
| `server/scripts/e2e-traffic-proof.mjs` (`e2e.sh traffic`) | Chrome, 9 modes: honest, honest-finish, honest-slow, honest-collision + five attacks by a modified client: `no-cars`, `no-cars-no-columns`, `ignore-damage`, `strip-proof`, `malformed-proof` | 7 s, contact cases 25 s |
| `server/scripts/sim-rides.mjs`, `e2e-replay.mjs`, `e2e-honk-verdict.mjs` | Load-test "drivers" over the API (honest), viewing a replay, HONK after the verdict | by `FREE_RIDE_SECONDS` |
| `client/test/traffic-proof.test.mjs` (2), `server/test/fixtures/simulation/traffic-browser.json` | The proof codec, kernel parity browser↔server on 5 routes × 3 trips | — |
| `.claude/skills/level-check/check.mjs` | **A ready autopilot:** the real game bundle in Node (esbuild + stub three + a fake DOM), a "human" driver (reaction ~1 s, turns, red lights, forks), 15 min of HARD on many seeds | 15 min of game, **does not send to the server** |
| `client/tools/cdp.mjs` `driveHook` | A Chrome driver: it records `v` and `d` every 40 ms | — |
| PR #5 `e2e/` | Blocks 1–2: pages, the API, the chain; it does not touch anti-cheat | — |

**Conclusion:** ride checks are covered broadly, but only by short recordings (6–40 s). No test drives a 15-minute ride through the server with v1 proof. Most API scenarios run in v0 mode (`TRAFFIC_PROOF_REQUIRED=false` in `test/support/harness.ts`). Attacks on v1 proof exist only in Chrome and in one short scenario. The replay performance of a long ride has not been measured.

---

### 3. The driver bot

#### 3.1 Architecture (`e2e/block3-anticheat/bot/`)
Two engines, one interface `drive({seed, trip, route, durationS, variant, seedNoise}) → {batches[], heartbeats[], endReport, truth}`:

1. **`engine: game`** (the primary one): the real client in Node, built as in `level-check/check.mjs` (esbuild of `client/js/main.js`, stub three, a fake DOM, deterministic `Math.random` and `performance.now`). The bot presses keys through `keydown/keyup` events, which is exactly what a human does. Telemetry, hashes, and the proof are written by **the game's own `telemetry.js`**, and the bot only intercepts `fetch` and decides when to send. That checks the real client, with no copy of its format.
2. **`engine: kernel`** (fast, and for attacks): a minimal driver on top of `client/shared/*` + `TrafficSimulator`, as in `traffic-proof.scenarios.ts`. The recording is assembled by hand. It is needed for precise attacks (substituting one frame, shifting d, and so on) and for `in-process`.

Driver logic reuses `makeDriver`/`wheelFor` from `level-check` (move it into `e2e/block3-anticheat/bot/driver.mjs` and import it from the skill, so it is not duplicated): hold the lane, the gap to the car ahead, stop on red, wait for a gap at an exit, choose the road at a fork (`takeOther`), react to a hole sign.

#### 3.2 Bot variants
| variant | Behavior | Expectation |
|---|---|---|
| `honest-clean` | Carefully, with no damage | `completed` + `verified`, `cleanMetres = completeDist` |
| `honest-mistake:crash@N` | It deliberately hits a car at minute N | ranked: `cleanMetres ≈ s(N)` ± a tolerance; if the crash is fatal → `failed` |
| `honest-mistake:hole@N` | It drives into a hole at minute N (hull drops) | `verified`, `cleanMetres = s up to the hole` |
| `honest-mistake:offroad@N` | Off-road for k s < the limit | `verified`; leaving the road is not a failure (check the rule, decision 7) |
| `human-noise` | Log-normal holds (CV 0.3–0.8), reaction jitter, micro-corrections of the steering | `verified`, not a single timing flag (a false-positive control) |
| `metronome` | Identical holds and intervals | `flagged` (`uniform-holds`/`repeated-timings`) |
| `cheat:<id>` | see catalog §5 | the code from the catalog |

Length: `--duration 900` (15 min, the default, `free-3b` on main), `1800` (30 min, `free-3c` after PR #3), `1h` through a demo wallet with `DEMO_SCALE=4` (= 15 min) or a full 3600 s at night. Seeds: a fixed set `SEEDS=[11, 87122, 39608, …]` and `--random-seeds N` for the nightly run.

#### 3.3 Where it runs
- **in-process** (`server/test/anticheat/*.spec.ts`, jest with the harness): Nest + Postgres from the harness, `TRAFFIC_PROOF_REQUIRED=true`, **fake clocks** (`sec(n)` in `bindClient`). 15 game minutes pass in seconds of wall; the server budgets (game-t ≤ wall·1.05) hold, because server time is shifted too. Determinism, the attack catalog, and regression go here.
- **docker** (the PR #5 stack: `docker-compose.e2e.yml`, `node dist/main.js`): the clocks are real, so the bot runs **at real pace**: game time cannot get ahead of wall by more than 5% + 30 s, and the heartbeat is every 1–10 s. 15 min = 15 min of wall. This is the nightly run and the concurrency check.
- The bot is Node only, with no browser. A Puppeteer version comes later, as you wanted.

---

### 4. Positive checks

| ID | Check | Criterion |
|---|---|---|
| AC-P1 | 15 min of `honest-clean` on `free-3b`, 6 seeds | `completed`, `verified`, `reasons=[]`, `RideReplay.status=verified`, `rulesVersion ≥ 7` |
| AC-P2 | `simulatedDistance` against `recordedDistance` | the difference ≤ `tolerance.distanceShare` (I propose 1% + 30 m, like `AGREE_*`) |
| AC-P3 | `simulatedHull` against `recordedHull`, `trafficContacts` against the bot's `truth` | hull ± 1%, contacts match by car id |
| AC-P4 | **later (PR #3)** ranked: `cleanMetres` against the bot's `truth.firstMistakeS` | ± `tolerance.cleanMetres` (I propose 30 m = `AGREE_METRES`); `cleanBps` on the board = the formula |
| AC-P5 | TEN4 on main: credited exactly once; an 8h has a hold of 48 h | the ledger; a repeated judge does not credit again |
| AC-P6 | **Determinism:** the same seed + the same presses → byte-for-byte the same batches (engine game with fixed clocks), the same verdict, the same `scores`; `rejudge` and `verdict:rejudge` give the same status | JSON equality |
| AC-P7 | Golden fixtures: a recorded 15-min ride from `fixtures/anticheat/*.json.gz` → the same verdict on every run. A kernel change without a `RULES_VERSION` bump breaks the test | a `scores` snapshot |
| AC-P8 | **Performance budget** of a 15 min replay: CPU, peak RSS, `/end` time | I propose ≤ 3 s of CPU, ≤ 300 MB RSS per ride (refine it with the first measurement); 30 min and 1h — linear |
| AC-P9 | **Concurrency:** N = 4/16/32 bots at once (docker), a replay queue with `concurrency=4` | all `verified`, no `failed` in `processQueue`, no deadlocks on the player lock, p95 `/batches` < 200 ms |
| AC-P10 | `human-noise` on 30 seeds | 0 false flags: the false-positive rate metric |
| AC-P11 | Forks and intersections: the bot takes the other road at every second fork | no `teleport` and no `traffic-proof-mismatch` on the switch (`FORK_SWITCH_SLACK`) |
| AC-P12 | A late upload: the last batch after `/end` (≤ 60 s) | a recheck; the status did not get worse |

---

### 5. The cheat catalog

Status marks: **C** = caught (a reject, or the ride `failed`), **F** = caught only by a flag (a human is needed), **N** = not caught, **U** = partial or unknown, a test is needed. "Has a test" = an existing test, "new" = to be written in block 3. Every new one runs on a 15-min recording (in-process, kernel or game).

#### A. Speed and motion
| # | Cheat | How the bot does it | What the server expects | Which check | Status | Test |
|---|---|---|---|---|---|---|
| 1 | Speed over the governor | v = 32 m/s in the sample/proof | `rejected over-governor`; heartbeat → `failed implausible`; proof v>29 → `traffic-proof-invalid` | `checkSamples`, `applyReport`, `verifyTrafficProof` | C | exists (verified-play C, v0); new v1, 15 min |
| 2 | "Cruise": v is locked inside the governor, with no losses on turns and climbs | engine game, `st.v=22` every frame (like `driveHook`) | currently `verified` | — | **N** | new (record it as a known-gap) |
| 3 | Engine power ×1.5 | acceleration 1.5× higher | `verified` (the threshold is 1.8× on ≥ 3 steps) | `physics-speed-mismatch` | U | new: ×1.5 / ×2 / ×3 |
| 4 | Brakes ×2 | deceleration stronger than `TRUCK_BRAKE` | `verified` | deceleration is not limited | **N** | new |
| 5 | Grip and steering: take corners faster than grip allows | psi and d change faster than the model | `verified` | there is no lateral model | **N** | new |
| 6 | Longitudinal teleport | Δs = 80 m in 0.1 s | `rejected teleport`, `traffic-proof-invalid` | `checkSamples`, proof Δs | C | exists (v0); new v1 |
| 7 | Lateral teleport (a jump to another lane in one frame, to dodge a car) | d: 2.4 → −2.4 in 50 ms | probably `verified` | the d bounds are only `|d|≤100` and offroad; swept contact interpolates | **N** | new |
| 8 | s runs ahead of the speedometer | v/2 at the same Δs | `rejected speed-mismatch` | `checkMotion` | C | exists (deep) |
| 9 | Acceleration without gas | dv>0 at gas=0 | `accel-without-gas` (reject at ≥ 2 m/s or 5 steps) | world-checks + replay | C | exists (unit); new, 15 min |

#### B. Time
| # | Cheat | How | Expectation | Check | Status | Test |
|---|---|---|---|---|---|---|
| 10 | Time acceleration (the game clock is faster than wall) | the bot sends 15 min in 5 min of wall (docker) | `400` on a batch past `maxGameSeconds`, heartbeat credit ≤ wall, the chain breaks → `missing-batches` | `recordingAllowance`, `applyReport` | C | new (docker) |
| 11 | Slow-mo (the game runs at ×0.5; time and motion agree) | `performance.now` ×0.5 | `verified` | only the upper bound, game≤wall | **N** | new, decision 6 |
| 12 | Shifted timestamps, a sample outside the batch, backwards | t−1 s on one sample | `rejected sample-out-of-order` | `batch-summary` | C | exists (deep) |
| 13 | A heartbeat gap > 150 s | a pause in sending | `failed heartbeat lost` | `applyReport`, the sweeper | C | exists (unit); new docker |
| 14 | A forged distance in the heartbeat | `s` + 500 m | `failed implausible progress` | `applyReport` | C | exists (unit) |

#### C. Recording integrity
| # | Cheat | How | Expectation | Check | Status | Test |
|---|---|---|---|---|---|---|
| 15 | Dropped frames or a sample | delete 2 s inside a batch | `sample-gap` / `traffic-proof-invalid` (clock continuity) | `checkMotion`, proof | C | exists (v0); new v1 |
| 16 | Duplicate frames | repeat a row | `sample-out-of-order` / the proof clock | summary, proof | C | new v1 |
| 17 | Reordered frames | swap two rows | the same | the same | C | new v1 |
| 18 | A skipped batch | do not send seq 100 | `429`, then `missing-batches` | `UploadBatchHandler`, `checkChain` | C | exists (deep) |
| 19 | A broken chain | a wrong `prevHash` | `chain-broken` | `checkChain` | C | exists |
| 20 | An edit without recomputing the hash | an edit after the hash | `hash-mismatch` | `checkChain` | C | exists |
| 21 | Withhold the last batches (hide a crash at the end) | do not send the last 20 s | v1: `traffic-proof-missing` (the frames do not cover `driveSeconds`); v0: coverage only | proof coverage | C (v1) | new |
| 22 | An upload after the 60 s window | a batch 61 s after `/end` | `409` | `acceptsRecording` | C | exists |
| 23 | Downgrade the protocol to v0 | `{trafficVersion:0}`, with no proof | `traffic-proof-missing` | the server stamp | C | exists (scenario) |
| 24 | Broken or deleted proof | `AAA=` / delete | `traffic-proof-invalid` / `-missing` | proof | C | exists (Chrome, scenario) |

#### D. Traffic, damage, crashes
| # | Cheat | How | Expectation | Check | Status | Test |
|---|---|---|---|---|---|---|
| 25 | "Ghost": a client with no cars | engine game, `g.traffic.length=0` | `traffic-collision-ignored` | server traffic | C | exists (Chrome, 25 s); new, 15 min |
| 26 | hull locked at 100 | `ignore-damage` | `traffic-damage-ignored` / `obstacle-ignored` | proof hull, holes | C | exists (Chrome) |
| 27 | A repair: hull grows | +10% between frames | `traffic-proof-invalid` | `hull > lastHull` | C | new |
| 28 | A hidden crash counter | `crashesVehicle` does not grow | caught through the proof (v1) | proof | C | exists in part (honest-collision); new |
| 29 | Crashes into buildings and the shoulder | — | `simulatedCrashesBuilding = 0`, not modeled | — | U | new (decide what this even is) |
| 30 | Hole damage cut to 30% | `damage.js` ×0.3 | `verified` (the threshold `PASS_DAMAGE_SHARE` = 25%) | world-checks | **N** | new |
| 31 | One hole with no damage | one hole is skipped | `flagged obstacle-no-impact` | world-checks | F | exists (unit) |
| 32 | Running a red light with no collision | the bot ignores the signal | not checked by the rules; caught only on contact | — | U | new, decision 7 |
| 33 | A donated hole is ignored | do not apply the live event | `donated-obstacle-ignored` / `event-unapplied` | replay | C | exists (unit). **Decision 33: the mechanic is removed entirely, and the row drops out of the catalog** (the checks remain only for rechecking old rides, §20.1) |

#### E. Someone else's recordings, and repeats
| # | Cheat | How | Expectation | Check | Status | Test |
|---|---|---|---|---|---|---|
| 34 | One's own old recording on a new seed | rehash it under the new rideId | a reject only if the new road produces a contact or a hole; with no contact the sample matches its own frame | holes, traffic | U (probabilistic) | new: the share caught across 30 seeds |
| 35 | An exact copy of someone else's ride on the same seed (a pool, a daily seed; `GET /api/watch/:id` returns every sample) | rehash under one's own rideId, upload at real pace | `flagged pool-duplicate-recording`, only for pools and only after `pool:attention` | pool-attention | F | new |
| 36 | The same copy with d shifted by 0.15 m and noise on v | — | `verified` (the threshold is 0.1 m) | — | **N** | new |
| 37 | Sybils: one person, N wallets, similar recordings | N bots from one IP | `pool-shared-ip` (flag), only the pool's top-20 | pool-attention | U | new (tie it to **Appendix D**) |

#### F. Bots
| # | Cheat | How | Expectation | Check | Status | Test |
|---|---|---|---|---|---|---|
| 38 | A naive bot (metronome) | variant `metronome` | `flagged` | `human-checks` | F | exists (the Chrome bot); new, 15 min |
| 39 | A "human-like" bot through the real client | variant `human-noise` | `verified` | timing statistics only; challenges are off | **N** | new (AC-P10 = the same run) |
| 40 | A synthetic recording with no client (the kernel + `TrafficSimulator`) | engine kernel | `verified` (the `traffic-proof honest` scenario shows exactly this) | — | **N** | new |
| 41 | TAS: a precomputed perfect run on a known seed (the pool seed is shared, traffic is deterministic) | offline optimization, then `human-noise` | `verified` | — | **N** | new (a demonstration only) |

#### G. Ranked and submission
| # | Cheat | How | Expectation | Check | Status | Test |
|---|---|---|---|---|---|---|
| 42 | Inflate `cleanMetres` in the heartbeat | hull=100 in the heartbeat while the recording has damage | clamped to `firstDamageS`, `clean-mismatch` | PR #3 `verdict.service` | C | unit in PR #3; new, 15 min |
| 43 | A ranked ride outside the window, or past the attempt limit | a start after the window / a 2nd attempt | `409` (ranked_*) | PR #3 `ranked-entry.service` | C | unit in PR #3; new HTTP |
| 44 | Batch spam, or seq or bytes over the budget | 10 batches/s | `400`, throttling `429` | allowance, the throttler | C | exists (bytes); new seq |
| 45 | Resource exhaustion by a long replay (after decision 17 — only 1h ≈ 1 800 batches; it was: 8h ≈ 14 400 batches, proof ≈ 7–8 KB/s of base64, all of it loaded into memory in one transaction under the player lock) | a 1h/8h demo ride | unknown | — | U | new (AC-P8) |

**Total: 45 rows.** 29 are caught (26 reject or `failed`, plus 3 flag only), 10 are not caught (#2, 4, 5, 7, 11, 30, 36, 39, 40, 41), and 6 are unknown or partial (#3, 29, 32, 34, 37, 45). An existing test covers about 24 rows, but every one of them lasts 6–40 s, and v1 is covered only in Chrome and in one scenario.

### 5.1 What block 3 locks (accepted non-rejects)

These ids are the block 3 `[CHEAT-#NN]` titles, not the rows in §5, and they do not change the status marks above. A flag which does not reject stays a flag. `RULES_VERSION` stays 7.

- `[CHEAT-#02]` Cruise locked under the governor is not rejected (`maxSpeed` stays ≤ 28 and `checkSamples` returns no reasons). This behavior stays.
- `[CHEAT-#03]` Power ×1.5 does not throw (`stepAt30Hz` still returns a finite `v`). This behavior stays.
- `[CHEAT-#05]` The 30 Hz stepper has no lateral `d`. This behavior stays.
- `[CHEAT-#07]` A lateral jump is not a 30 Hz stepper field. This behavior stays.
- `[CHEAT-#14]` `checkSamples` does not return `pause-limit`. This behavior stays.
- `[CHEAT-#22]` A null client hash flags `unhashed-batch` and does not reject. This behavior stays.
- `[CHEAT-#25]` The 30 Hz stepper has no hull field. This behavior stays.
- `[CHEAT-#26]` `classifyHumanness` does not return `traffic-collision-ignored` (the stepper also has no `traffic` field). This behavior stays.
- `[CHEAT-#27]` The stepper returns longitudinal state only (`brake`, `clutch`, `engineOn`, `gas`, `gear`, `park`, `rev`, `rpm`, `v`). This behavior stays.
- `[CHEAT-#28]` The stepper has no crash counter (`crashesVehicle`). This behavior stays.
- `[CHEAT-#29]` The stepper does not model building crashes (`simulatedCrashesBuilding`). This behavior stays.
- `[CHEAT-#30]` A damage cut is not a humanness reject (a human-like trace stays `verified`, with no damage reason). This behavior stays.
- `[CHEAT-#31]` `classifyHumanness` does not return `obstacle-no-impact` or `obstacle-ignored`. This behavior stays.
- `[CHEAT-#32]` A red light is not a humanness reject. This behavior stays.
- `[CHEAT-#33]` `classifyHumanness` does not return `donated-obstacle-ignored` or `event-unapplied`. This behavior stays.
- `[CHEAT-#47]` One short world-digest mismatch flags and does not reject (`judgeWorldDigest` stays `flag`). This behavior stays.
- `[CHEAT-#52]` Untrusted input without an impossibility is review, not a reject (`flagged_for_review`, reason `untrusted-input` only). This behavior stays.

---

### 6. The main gaps (do not fix them in this block; only lock them in with `known-gap` tests)
1. **A bot gets through.** The server checks poses, not hands. A human-like bot on the real client, or a synthetic on the shared kernel, receives `verified` (#39–41). Challenges are off (`CHALLENGE_KINDS = []`); the timing checks only flag. The README admits it: "a bot using the real game can still pass".
2. **There is no lateral kinematics and no braking check** (#4, 5, 7): d, psi, and deceleration are not checked against the steering, the grip, and `TRUCK_BRAKE`. A lane jump made to dodge a car is not caught.
3. **"Cruise" and modified power below 1.8×** get through (#2, 3). The Chrome test `honest` itself locks `v=22`, `d`, `psi=0` and expects `verified`, so that behavior is pinned as "honest".
4. **Hole damage can be cut down to 25%** (#30).
5. **A copy of someone else's recording on a shared seed** is caught only by a flag, only for pools, only after `pool:attention`, and a shift of 0.15 m bypasses the detector (#35–36). The public `/api/watch/:id` returns every sample.
6. **TAS on a known seed** (#41): the pool seed is shared and known before the start, and traffic is deterministic.
7. **Slow-mo** is not limited (#11). For a skill contest this is an advantage in reaction.
8. **The performance of a long replay is unknown** (#45). The whole replay runs synchronously in a transaction under the player lock. An 8h ride could run into memory (4h/8h were removed by decision 17; for 1h the risk is smaller, but a measurement is needed).
9. The test harness defaults to `TRAFFIC_PROOF_REQUIRED=false`, so most HTTP scenarios check a protocol other than the one in production.

---

### 7. How to fit it in

#### 7.1 Structure
I propose **block 3 in PR #5**, but as separate commits (or a separate PR off main after PR #3 is merged; see decision 1):
```
e2e/block3-anticheat/
  bot/driver.mjs          # makeDriver/wheelFor (move it out of level-check; the skill imports from here)
  bot/engine-game.mjs     # the client bundle in Node, a fetch intercept, deterministic clocks
  bot/engine-kernel.mjs   # a synthetic on client/shared + TrafficSimulator
  bot/variants.mjs        # honest-clean, mistake@N, human-noise, metronome
  bot/cheats.mjs          # the 45 catalog modifiers, by id
  positive.test.mjs       # AC-P1..P12 (docker, real pace)
  cheats.test.mjs         # the catalog against docker
  perf.test.mjs           # AC-P8/P9
  tolerance.json
  catalog.mjs             # the §5 table → a check that every id has a test and an expected code
server/test/anticheat/
  long-ride.spec.ts       # in-process, fake clocks: P1–P7, P11, P12
  cheats.spec.ts          # the catalog in-process (fast)
server/test/fixtures/anticheat/
  free-3b-<seed>-honest.json.gz, …-mistake.json.gz, free-3c-…, 1h-demo-…   # golden recordings
```

#### 7.2 npm scripts
- `test:e2e:block3` → `bash e2e/scripts/run.sh 3`: the block 1 stack + `TRAFFIC_PROOF_REQUIRED=true`, `CHALLENGE_INTERVAL_SECONDS=0`, `FREE_RIDE_SECONDS=180`, `DEMO_WALLETS=<bot>`, `DEMO_SCALE=4`.
- `test:anticheat` (server, jest, in-process): the catalog + determinism + golden, ~1–3 min.
- `test:anticheat:long` (docker, real pace): 6 seeds × 15 min in parallel ≈ 20 min of wall; `--duration 1800` and `1h` only at night.
- `anticheat:record-golden` — rebuild the fixtures (by hand only, and with a `RULES_VERSION` bump).

#### 7.3 CI versus the nightly run
- **CI on every PR:** `test:anticheat` in-process (15 min of game time on fake clocks = seconds), the golden fixtures, `catalog.mjs` (every cheat has a test and a code). Plus one short docker smoke of 3 min.
- **At night:** `test:anticheat:long` (15 min × 6 seeds, 30 min of HARD × 2, one 1h demo), concurrency of 16/32 bots, `human-noise` on 30 random seeds (the false-positive rate), a perf report with a trend.
- `known-gap` tests (status N) expect the current behavior (`verified`) and are marked `KNOWN_GAP`. When the gap is closed, the test fails, and it is turned into an ordinary one.

#### 7.4 Tolerances (`tolerance.json`)
```json
{ "distanceMetres": 30, "distanceShare": 0.01, "hullPct": 1.0, "cleanMetres": 30,
  "perf15min": { "cpuMs": 3000, "rssMb": 300, "endP95Ms": 5000 },
  "concurrency": { "bots": 16, "batchesP95Ms": 200 },
  "falsePositiveMax": 0.0 }
```
The values are a starting point: after the first nightly run, fit them to the measurement and lock them in.

#### 7.5 Manual and mock checks (in [`docs/testing/MANUAL_TESTS.md`](../testing/MANUAL_TESTS.md))
- The Chrome matrix `e2e.sh traffic` stays as it is; it is the browser half.
- Compare a 15-min recording of a live human with a `human-noise` recording (the human-checks metrics): decision 3.
- Engine game may run into the fake DOM and the network code of an online ride. If so, the first iteration runs on engine kernel, and game is added as the second step. **This is a risk, and it has to be checked first.**

---

### 9. Anti-cheat hardening v2 (a plan)

Goal: the server **itself resimulates the ride from the raw input and the seed** on the shared kernel, and itself decides whether a human is at the wheel or a bot. The client's poses remain a hint for display and for finding where they diverge; the server stops judging by them.

#### 9.1 What is on main, and what is missing
- Raw events are already recorded: `recordInput(code, down, e.timeStamp)` → `[ms from the start by wall, code, down]` at a precision of 0.1 ms (`client/js/telemetry.js`, `ui/input.js`). Input is keyboard only (`KeyW/ArrowUp` and so on) and the dashboard buttons `btn:*`; mobile is blocked; there is no gamepad and there are no analog axes.
- Two things are missing:
  1. **Binding an event to a simulation step.** An event is recorded by wall time, while the game reads `input` once per frame with a variable `dt` (rAF, `dt ≤ 0.05`, `main.js`).
  2. **A truck model in the shared kernel.** Lateral dynamics, steering, the gearbox, damage from holes and props, climate (engine temperature affects power), and the battery live in `client/js/sim/{physics,damage,climate,battery}.js`, not in `client/shared`. On the server there is only a longitudinal estimate (`stepTruckPhysics`).

#### 9.2 Protocol v2 (`trafficVersion = 2`, `RULES_VERSION = 8`)
> **Revised on 17.10 → the full normative specification is in §14 (protocol v2.1).** A fixed simulation step of **30 Hz** (decision 12; `1h = 108 000` steps, with a fallback of `20 Hz`), binary streams `inp` / `clk` / `chk` / `mg` / `env` compressed with `deflate-raw` (≈ `0.5 MB/h` instead of `~32 MB/h` in v1), a session key `sessionKey` and an `HMAC-SHA256` of every batch (`batch-mac-invalid`), clock synchronization, and dropping the mandatory 10 Hz `samples` and `trafficProof` (the server itself builds the poses for `/api/watch`, decision 18).

#### 9.3 Authoritative resimulation and determinism
> **Supplemented on 17.10 → §15.** World integrity: every object (holes, traffic, hazards, cones, minigame stations, barriers) exists only in the server resimulation, and collisions are computed there too. The reason codes go here as well, and so does the breakdown of the existing check "the obstacles were removed on the client".

- The server: `seed` → the road, the holes, the traffic → `TruckSim` (new, shared) → steps driven by the input events. The server takes every fact it judges from **its own** resimulation: s, speed, hull, contacts, leaving the road, the finish, `completeDist`. The client's `s`/`hull` in the heartbeat and in `/end` become a hint (for the live feed). The finish (`completed`) is decided by the resimulation.
- **The 30 Hz step (decision 12):** dt = 33.3 ms fits the client's current limit (`dt ≤ 0.05` in `main.js`; v1 proof frames are ≤ 50 ms), but collisions must be computed **swept** (as `TrafficSimulator` already does), not as points: in one step at the governor the truck travels ≈ 0.93 m. A hole or a barrier thinner than that is not let through. Substeps exist only inside the kernel and are deterministic (for example, 2 substeps for the trailer tires). The cost on the server: at an estimate of 1–3 µs for a truck step and 20–60 µs for traffic → **≈ 0.6–1.9 ms of CPU per game second**, so 1h ≈ **2–7 s of CPU** per core (with overhead, up to ~10 s), that is ×400–1500 faster than real time. At 20 Hz ≈ 1.5–5 s. Measure it in F0. If 30 Hz worsens handling in `level-check`, the fallback is 20 Hz (the same protocol, a different `stepHz` in the ride header), not a return to 60.
- **Determinism requirements:**
  1. All game physics lives in `client/shared`: the truck (steering, longitudinal, the gearbox, the clutch, the parking brake, ignition), damage (holes, cars, props), climate and the battery (if they affect power), wind. Render cosmetics (`Math.random` for the "gnats", debris) stay outside the kernel.
  2. There is no `Math.random` in the kernel, only a PRNG from the seed (`client/shared/prng.js`).
  3. **Its own deterministic math:** implement `sin/cos/exp/pow/atan2/tanh` in the kernel (an fdlibm port, or polynomials). V8 (Chrome, Node) agrees, but SpiderMonkey and JavaScriptCore can differ by 1 ulp, and over 8 hours that diverges. float64 only, no Float32, a fixed order of operations, and cars visited in a deterministic order.
  4. State is serializable: JSON keeps float64 exactly. `TrafficSimulation` and `TruckSim` need `snapshot()`/`restore()`.
  5. **Parity:** golden traces (a seed + events) → a hash of the state every second, bitwise identical in Node, Chrome, Firefox, and Safari. In CI, Node and Chrome (headless); Firefox and WebKit at night (Playwright later, as decided).
- **If bitwise does not work out** (the fallback, decision 12): compare with a tolerance, and with no "pulling" toward the client's poses. A divergence past the threshold → `resim-divergence` (flag), rather than accepting the client's pose.
- **Slow-mo (#11):** for paid rides, game/wall by the step clock is ≥ 0.9 outside a pause; pauses are ≤ N per ride and ≤ M seconds in total. A violation → `time-dilation` (a reject on a sustained deviation, a flag on a short one).
- **Input agreement:** the client's checkpoints against the resimulation (`resim-mismatch` on a divergence → reject; that means modified physics), and events against the gas bit (this already exists).

#### 9.4 The humanness score (human-likelihood score)
> **Expanded on 17.10 → the full normative specification is in §16 (features `F1–F10`, a two-stage model, verdict levels `verified / review / rejected`, shadow → enforce, and the tools for a manual review of the top-20).**

#### 9.5 Server challenges (`CHALLENGE_KINDS` is currently `[]`)
> **Decision 14 (17.10):** for 1h, the road challenges (`surprise-hazard`, `lane-closure`, `signal-retime`) are **not built** as a separate class — 15 minigames in [`minigames.md`](minigames.md) replace them (the road `fork-instruction` was moved into the `dispatch-radio` minigame, variant `exit`; `crosswind-gust` stays part of the wind physics in the kernel, for feature `F3`). Protection from TAS (#41) and from peeking (#48) comes from the personal `trafficSalt` (§9.6) and from commit–reveal of the minigame schedule (`mgSalt`, [`minigames.md`](minigames.md) Appendix A §13.4).

#### 9.6 A late seed, and different traffic per player
- Split the seed into **`roadSeed`** (shared by the pool: the road, the holes, the intersections, the forks — the same difficulty, fairly) and **`trafficSalt`** = HMAC(`serverSecret`, `poolId ‖ wallet ‖ rideId`). Each player has their own traffic and challenges, statistically equal. A copy of someone else's recording, or of someone else's input, wrecks (#35/36/49); precomputation from a known seed is useless (#41).
- **Commit–reveal:** when a pool is created, `H(serverSecret_pool)` is published; after the pool closes, the secret itself is published. Anyone can check that a player's traffic was computed fairly (this is a fairness audit, not anti-cheat).
- An alternative for an identical difficulty: traffic shared by the pool, but revealed **by segment** during the drive. Weaker: the first public ride reveals the segments to everyone else. See decision 13.

#### 9.7 Incremental resimulation and a background verdict
- On every batch (2 s) the server continues the resimulation from a saved snapshot (`ride_sim_state`: Redis with a TTL, plus the DB every N batches, ~5–10 KB), writes partial facts (contacts, holes, leaving the road, stimuli, and RT), and updates the snapshot. A real player's ride is not sped up (see §11).
- `/end` no longer judges synchronously inside the transaction: it sets `RideReplay pending`, and the final verdict (a roll-up of the partial facts + the humanness score + the pool marks) is computed by the queue worker (`ReplayQueuePort` already exists). The `/end` response is `verdict: pending`, plus polling of `GET /api/rides/:id`.
- Under the player lock, only the writing of the result happens, not the resimulation itself.

#### 9.8 Compatibility and versions
- `RULES_VERSION 7 → 8`; the server sets `trafficVersion 2` at the start (the flag `INPUT_REPLAY_REQUIRED`, default false until the enforce stage). v0 and v1 rides are judged by their own rules; the rule modules are versioned; `verdict:rejudge` picks the rules by the ride's version.
- **Shadow mode:** v2 is recorded and computed alongside v1, the v1 verdict is what applies, and divergences are logged on `RideReplay`. Then enforce.
- A v1 client at `trafficVersion=2` receives `409 client_outdated`, with a request to refresh the page.

#### 9.9 Privacy ([`docs/legal/PRIVACY.md`](../legal/PRIVACY.md), the Pre-season rules)
- Press timing is **behavioral data** (keystroke dynamics; in a number of jurisdictions, close to biometrics). Add to PRIVACY.md: the purpose is only protection against fraud and fairness of the contest; it is not used to identify a person or for advertising; it is not given to spectators or to third parties (raw events are already hidden); the retention period is `TELEMETRY_RETENTION_DAYS` (90), and for top-20 rides and disputed rides it is until payout plus the appeal period; the base of real players is stored only in aggregate (distributions, with no wallets); the legal basis is legitimate interest (protection against fraud); a right to a manual review of the decision (an automatic decision is not final).
- Comparing input rhythm across wallets (sybils) is only for the top-20, and only if it is disclosed in PRIVACY.md (decision 16).

#### 9.10 Honest limits
- An ML bot trained on human input, with a human RT and with fatigue, is not ruled out completely. v2 makes such a bot expensive (it has to actually drive the physics in real time and react to late events), but not impossible.
- A human with an assistant (the bot only corrects on hazards) produces a mixed picture, and the score catches that only probabilistically.
- A modified browser that presses the keys itself from the screen (computer vision) is indistinguishable from a human, apart from the statistics.
- So what remains is: **a manual review of the top-20** before payout, anti-sybil (IP clusters, ≤ 1 prize per cluster, social networks — see **Appendix D**), a repeat of the ride at the organizer's request, and the organizer's right to disqualify (the Pre-season rules).

#### 9.11 The catalog after v2
| # | Cheat | Before v2 | After v2 | What catches it in v2 |
|---|---|---|---|---|
| 2 | "Cruise" | N | C | speed is computed by resimulation from the pedals; the client's pose is not used, and the checkpoints diverge → `resim-mismatch` |
| 3 | Power ×1.5 | U | C | the same |
| 4 | Brakes ×2 | N | C | the same |
| 5 | Grip and steering | N | C | a lateral model in the kernel |
| 7 | Lateral teleport | N | C | the server computes d |
| 11 | Slow-mo | N | C | game/wall by the step clock, `time-dilation` |
| 29 | Crashes into buildings | U | U | only if props and the shoulder enter the kernel (F1, by scope) |
| 30 | Hole damage at 30% | N | C | the server computes the damage |
| 31 | One hole with no damage | F | C | the server computes the damage |
| 32 | A red light with no collision | U | U→C | it is visible in the resimulation; it becomes C once the rule is approved (decision 7) |
| 34 | An old recording on a new seed | U | C | input on someone else's road and traffic falls apart |
| 35 | An exact copy of someone else's ride | F | C | `trafficSalt` + input similarity |
| 36 | A shifted copy | N | C | the same; the poses do not matter |
| 37 | Sybils | U | U | organizational: the top-20, IP, social networks |
| 38 | Metronome | F | C | an impossible periodicity (reject) |
| 39 | A human-like bot | N | U | the score + challenges + a manual review; an ML imitator is not ruled out |
| 40 | A synthetic with no client | N | U | without real input it cannot pass the resimulation, i.e. this reduces to #39 |
| 41 | TAS on a known seed | N | C | `trafficSalt` + late challenges |
| 45 | The resources of a long ride (after decision 17, 1h) | U | C | v2 is ~25× smaller, plus incremental replay (after the F0 measurement) |
| 46 | **new:** the step mask and the events disagree | — | C | the server builds the mask itself from the events |
| 47 | **new:** exploiting the desync tolerance | — | U | C under bitwise determinism (decision 12) |
| 48 | **new:** peeking at a challenge in the heartbeat response | — | U | late delivery, 0.5–1.5 s before it is visible; RT is measured from the moment of visibility |
| 49 | **new:** replaying someone else's human input | — | C | `trafficSalt` + similarity of the sequences |

> The new rows #50–58 (minigames, noclip, deleting stations, substituting a MAC and a nonce, synthetic events) are in §17.3.

The other 26 rows (C) stay C. **Total:** before v2 — 45 rows: C 26 + F 3 = 29 caught, N 10, U 6. After v2 — 49 rows: **C 42, F 0, N 0, U 7** (#29, #32 until the rule is approved, #37, #39, #40, #47, #48).

#### 9.12 Phases and the estimate (person-days; a plan, with no implementation)
| Phase | Contents | Estimate |
|---|---|---|
| F0 | Measurements: the speed of a v1 replay (15 min, 1h; 8h was removed by decision 17), memory; the size of v1 and of v2 on real rides; turn on shadow collection of the timing base (v1 is already being recorded) | 3–4 |
| F1 | A deterministic kernel: the truck's physics, damage, and climate in `client/shared`, a fixed 30 Hz step in the client (decision 12; a fallback of 20 Hz), its own math, snapshot/restore, Node/Chrome parity (+ Firefox/WebKit at night), a `level-check` recheck (handling may have changed) | 8–12 |
| F2 | Protocol v2: events with a `stepIndex`, the step clock, checkpoints, the codec, budgets, `RULES_VERSION 8`, `trafficVersion 2`, shadow mode, `409 client_outdated` | 4–6 |
| F3 | The server: authoritative resimulation, incremental per batch, snapshots, a background verdict, an asynchronous `/end`, `/api/watch` from the server poses | 6–8 |
| F4 | Challenges 1–5, delivery in the heartbeat, application in the client and in the kernel; `roadSeed`/`trafficSalt`, commit–reveal | 5–7 |
| F5 | The humanness score: features, the base, thresholds, the admin UI ("why"), the FP policy, appeals | 6–8 |
| F6 | The bot block (§3–7) + the timing variants (§10) + golden v2 + the nightly runs | 6–8 |
| F7 | PRIVACY.md, the rules, the whitepaper, the README, [`docs/spec/anticheat.md`](anticheat.md) | 1–2 |
| **Total** | | **39–55** (≈ 8–11 weeks for one developer) |

Schedule: ~~Recommendation (decision 11): Pre-season on v1 plus shadow collection of the base, with v2 by Season 1.~~ **Decision 11 (17.10): the recommendation is rejected — "we do it properly right away; I will get it all done".** The owner takes the full scope of v2 plus the minigames, with no intermediate stage of "Pre-season on v1 in shadow". The estimate does not change: 70–105 person-days (§18), and more if the whole extended catalog of §13.9 is approved. The schedule risk is recorded in §9.13 and §18 and is not disputed.

#### 9.13 Risks
1. **Determinism across browsers** (Safari in particular) is the main risk of F1. The fallback is a tolerance with no pulling (decision 12).
2. **A fixed step changes how the controls feel** — retuning is needed, plus `level-check` and `gameplay-balance`.
3. **A small base** (≈ 73 real entries as of today): the thresholds are unreliable, hence shadow mode, and a reject only when the input is impossible.
4. **False positives on honest players** are a reputation risk. Hence a flag, a manual review, and an appeal.
5. Privacy and the law: behavioral data (§9.9). The lawyer consult is postponed; the risk is accepted.
6. Server CPU for the resimulation: by the estimate it is cheap (§11), but the F0 measurement is needed.
7. The volume (39–55 days for v2, 70–105 together with the minigames) set against the other tasks. By decision 11 the owner takes the whole of it; the risk remains, and the phases of §18 show it.
8. Different traffic per player (`trafficSalt`) changes "one road for the contest" into "one road, your own traffic". This has to be explained in the rules (decision 13).

### 10. Bot tests for input timing (a supplement to §3–5, after F2/F5)
Every v2 bot goes through the real client (engine game) or through the kernel with raw events. The expectations are given for the starting thresholds and are refined on the base.

| ID | Bot variant | How it is built | Expectation |
|---|---|---|---|
| AC-T1 | `metronome` | identical holds and intervals | `rejected` (an impossible periodicity) |
| AC-T2 | `perfect-reaction` | it reacts exactly k steps after the stimulus becomes visible; RT = 50–100 ms, constantly | `rejected` (a median RT < 100 ms on ≥ 10 unexpected stimuli) |
| AC-T3 | `gaussian-noise` | RT ~ N(400 ms, 50), holds ~ N(μ, σ), with no tail and no fatigue | `flagged human-review` (the shape of the distribution; there is no drift) |
| AC-T4 | `replayed-human` | a real human's recorded input, replayed on another ride (the same `roadSeed`) | `rejected` (it falls apart on `trafficSalt` and on the challenges) + `flag input-similarity` |
| AC-T5 | `replayed-human-same-ride` | the same input under another wallet in the same pool | `flag input-similarity` (for both; a manual decision later) |
| AC-T6 | `ml-mimic` | ex-Gaussian RT from the base, log-normal holds, micro-corrections, a fatigue drift, a reaction to the challenges | `verified` or `flagged` — **an honest limit**; the test records the share that gets through, and that is the detector-strength metric |
| AC-T7 | `assisted-human` | human input (golden), while the bot substitutes the reaction only on unexpected stimuli (a braking car, a hole) and in the minigames (surprise-hazard was removed by decision 14) | `flagged` by the RT shift on hazards (probabilistic) |
| AC-T8 | `precomputed-tas` | a perfect run, optimized on `roadSeed`, with no knowledge of `trafficSalt` or of the challenges | `rejected` (a contact, or a missed challenge) |
| AC-T9 | `late-challenge-peek` | the bot reacts at the moment the challenge is delivered in the heartbeat, not at the moment it becomes visible | `flagged` (RT from visibility is negative, or too small) |
| AC-T10 | `slow-mo` | the steps run at ×0.7 of wall | `rejected time-dilation` |
| AC-T11 | `fast-forward` | the steps are faster than wall | a budget `400` / `rejected` (as in #10) |
| AC-T12 | `mask-mismatch` | the step mask does not match the events | `rejected` |
| AC-H1 | **baseline humans** | golden recordings of real players (with consent, de-identified) | `verified`, false flags ≤ 2%, reject = 0 |
| AC-H2 | `human-noise` (§3.2) | the human-like bot from the v1 block | a control: the share that gets through is the same metric as AC-T6 |

Lengths: 15 min (`free-3b`) in CI, in-process; 30 min and a 1h demo at night (fatigue shows only on the long ones). Metrics in the report: TPR per bot, FPR on the base, the distribution of the score.

### 11. Speeding up time — only as a technique for the 1h tests (decision 17, 17.10)
- **4h and 8h are removed for now** (decision 17); 1h and the free rides remain. The product question of "speeding up an 8h for the player" no longer exists. A real player's ride always runs at real pace.
- **The tests are what we speed up:**
  - an in-process resimulation at a fixed step (30 Hz, decision 12) does not depend on the wall clock: the bot generates 1h of game time (108 000 steps) in seconds of CPU, and the server clock (`ClockPort`) is fake (`sec(n)` in the harness);
  - in docker, 1h is legally shortened through `DEMO_WALLETS` + `DEMO_SCALE` (`minSeconds = tier.seconds / DEMO_SCALE`); for example `DEMO_SCALE=4` → 15 min of wall for a CI smoke, and `DEMO_SCALE=1` is a full hour at night.
- **The server check is already faster than real time:** the estimate in §9.3 is 1h ≈ 2–7 s of CPU at 30 Hz. v2.1 (≈ 0.5 MB/h, §14.6) and incremental resimulation per batch (§9.7) spread the load across the whole ride.
- If 4h or 8h come back, the question of speeding them up for the player is opened again by a separate decision.

### 14. Telemetry protocol v2.1 (an improvement on §9.2)

#### 14.1 What exists now (v1, from the code)
- A batch (`client/js/telemetry.js` `cut()`): `{seq, prevHash, t0, t1, samples, inputs, trafficProof?}` → a canonical `JSON.stringify` → `sha256(text)` (WebCrypto; with no secure context, `null` → `unhashed-<seq>`). `traffic` sits beside it and is not hashed. The cut cycle is 2 s of game under v1, 500 frames at most; sending is strictly in order, and on a 4xx recording stops (`rec.refused`); after `/end` there are retries for another 55 s (`GRACE_MS`) against a server window of 60 s.
- Input: `[ms from wall0 at a precision of 0.1 ms, code ≤ 32 characters, down]`; the time is taken from `e.timeStamp`. There is no simulation step. The mouse is recorded only as `btn:*`, at the moment of `pointerdown`.
- The server: `UploadBatchHandler`, the limits in `telemetry-rules.ts` (`BATCH_MAX_BYTES = 98_304`, `BATCH_MAX_INPUTS = 2000`, `GAME_TIME_FACTOR = 1.05` + 30 s, `RECORDING_BYTES_PER_SECOND = 4096`, and under v1 `65_536` — `ride.entity.ts:206`).
- **The main weakness:** SHA-256 with no key. Anyone can recompute it, so the chain proves order and integrity but not origin. A batch made outside the session (an offline generator, someone else's ride) is indistinguishable.

#### 14.2 The streams in a v2.1 batch
One batch is 2 s of game (60 steps at 30 Hz, decision 12), a binary frame; the format is below.

| Stream | Contents | Rate | Why |
|---|---|---|---|
| `inp` | `[Δstep varint, ΔtUs varint (µs from wall0), codeId u8, kind u8 (down/up/axis), value i16, flags u8 (isTrusted, repeat)]` | per event | the resimulation (the step) + the timing (µs) |
| `clk` | `[step, perfNowUs]` every 3 steps, plus `visibilitychange` events, `blur/focus`, and a histogram of rAF frame durations over the batch (8 bins) | 10 Hz | it ties the steps to wall; slow-mo and speeding up; tab throttling |
| `chk` | `[step, s, d, psi, v, hull, stateHash64, worldDigest32]` | 1 Hz | a fast search for a divergence; `worldDigest` is a hash of the ids of the world objects the client spawned inside a window of ±300 m (§15.3) |
| `mg` | per minigame event: `shownAtStep/µs`, `pointermove` through `getCoalescedEvents()` (x, y normalized to the canvas, µs, up to 240 Hz), `pointerdown/up` (the position inside the button), keys with dwell and flight, focus changes, attempts, the outcome | only during a minigame | features F6–F7 (§16) |
| `env` | once, and on a change: `pointerType`, devicePixelRatio, the canvas size, an estimate of the timer resolution (a probe of `performance.now()`), visibility, the accessibility mode | rarely | normalizing the features; separate bases |

- `phone:*` events from `recordPhone` move into `mg` when a minigame is running; outside one they stay as they are now and are not judged.
- `isTrusted` is recorded on every event. A synthetic `dispatchEvent` from the page's JS yields `false`. A modified client can lie, so this is a signal and not proof (decision 26).
- The 10 Hz `samples` and `trafficProof` are not mandatory in v2.1 (as in §9.2). In shadow, v1 and v2.1 are recorded in parallel.

#### 14.3 A session key and HMAC, instead of keyless SHA-256
- `POST /api/rides/:id/start` → `{sessionKey (32 bytes, base64), keyId, protocol: 2, mgCommit, serverEpochMs}`. On the server the key is stored encrypted (a KMS or env key), bound to the ride, and deleted after the verdict.
- `mac_n = HMAC-SHA256(sessionKey, "fc-batch:v2" ‖ rideId ‖ seq_n ‖ mac_{n-1} ‖ bytes_n)`, where `mac_{-1} = HMAC(sessionKey, rideId)`. Minigame answers and the v2.1 heartbeat are signed too (`"fc-mg:v2"`, `"fc-hb:v2"`).
- The server: `batch-mac-invalid` → `400` (the batch is rejected and recording stops, as now on a 4xx) and a `reject` of the ride. `batch-mac-missing` on v2.1 → `400`. The old `hash-mismatch` / `chain-broken` remain for v0/v1.
- **To be plain about it:** the key lives in the browser, and a modified client will read it. HMAC closes off **offline generation and forgery outside the session**, splicing batches in from someone else's ride, replaying someone else's batches, interference by a middleman, and batches "from the past". Only the resimulation protects against a client that is not honest (§15).
- Rotation: a new key on every ride; `keyId` is for versioning; a leak of one key concerns one ride.

#### 14.4 Order, acknowledgements, clock synchronization
- `seq` is strictly in order (as now, `429 batch_out_of_order`). A `200` response returns `{ack: seq, nextSeq, serverMs}`.
- **Clock synchronization:** every heartbeat carries `clientPerfUs` and receives `serverMs`. Using an NTP scheme, the server estimates the offset and the drift (the slope of `perfNow` against the server clock). A drift of the step clock against the server of > 2%, sustained for 60 s → `time-dilation` (§9.3). Short spikes are a flag. Jumps of `perfNow` backward or forward while the tab is visible → `clock-jump` (flag).
- Minigame timing is computed on both clocks (§13.5 item 2).

#### 14.5 Offline, and reconnecting
- The client keeps unacknowledged batches in memory (up to 120 s, ~0.5 MB) and retries with backoff. The ride continues; the server's heartbeat timeout stays `HB_TIMEOUT_MS` (150 s).
- A minigame answer made while offline is queued with the client's timings. The server timing is then unavailable → `mg-answer-late-network` (info, not a flag), and it is judged from the client trace plus how plausible the delay is (from the RTT history).
- A gap of > 150 s → `failed: heartbeat lost`, as now. Reloading the tab during a 1h does not issue a new `sessionKey`; a v2.1 ride is not resumed (a product decision, same as now).

#### 14.6 The codec, compression, size, versions
- The batch frame: `magic "FC2" ‖ ver u8 ‖ seq u32 ‖ t0Step u32 ‖ t1Step u32 ‖ streams (type u8, length varint, data)` → `deflate-raw` (`CompressionStream` in the browser, `zlib` on the server) → an `application/octet-stream` body. The MAC is computed over the uncompressed bytes.
- **The budget for 1h** (an estimate; measured in F0):

| Stream | Raw | After deflate | Per 1h |
|---|---|---|---|
| `inp` | ~0.08 KB/s | ~0.04 | ~0.15 MB |
| `clk` | ~0.1 KB/s | ~0.03 | ~0.1 MB |
| `chk` | ~0.05 KB/s | ~0.04 | ~0.15 MB |
| `mg` | 4 events × ~15 s × 240 Hz × ~10 B ≈ 150 KB | ~60 KB | ~0.06 MB |
| **Total** | | | **≈ 0.5 MB/h** (v1 is now ≈ 9 KB/s ≈ 32 MB/h) |

- `recordingAllowance` for v2.1: ≈ 1 KB/s instead of 65 KB/s; a separate budget of 64 KB for one `mg` event.
- Versions: `protocol = 2` (the `trafficVersion` field in the DB goes on storing the version), `RULES_VERSION 7 → 8` (v2 plus the minigames, behind the flag `MINIGAMES=shadow|enforce|off`), the minigame rules module `mg:1`. A v1 client on a v2.1 ride → `409 client_outdated` (§9.8).

---

### 15. The server check: resimulation and world integrity

#### 15.1 The existing check "removed the obstacles — did not get through" (as in the code now)
1. **The world belongs to the server.** The hole plan is built from the seed on the server: `roadPlanFor(seed, trip)` (`server/src/domain/road/road-plan.ts:86`) by the shared function `rollChunkHole` (`@freightchain/shared`). The client receives the same plan through `GET /api/watch/:id/road?from&to` (`server/src/presentation/live/live.http.controller.ts:44`) → `client/js/road-plan.js` (`followRoadPlan`, `updateRoadPlan`, windows of 6000 m with 3000 m of lookahead) → `net/obstacles.js` `installPlan`. The holes the driver rides over are the server's.
2. **The measurement on batch intake:** `batch-summary.ts:70` → `measureWorld(samples, plan, prefix)` (`server/src/domain/telemetry/world-facts.ts:67`). For every pass of an axle over a hole, a `HolePass {key '<hole>:<pit>:<axle>', t, s, dir, miss, v0, hull0, v1, hull1}` is written, together with the tail of the previous batch.
3. **The decision at the verdict:** `checkWorld` (`server/src/domain/verdict/world-checks.ts:73`, called from `ride-verdict.entity.ts:56`). `classifyPass`: the expected damage is `holeDamage(T, v0, axle)`; `got ≥ expected·PASS_DAMAGE_SHARE (0.25)` → `hit`, otherwise `ignored`. The threshold at the edge is `PASS_CLEAR_METRES = 0.4`; it is not judged when `PASS_MIN_DAMAGE < 1%`. The result: ≥ `OBSTACLE_IGNORED_REJECT = 2` ignored holes → **reject `obstacle-ignored`**, one → flag `obstacle-no-impact`, ≥ 2 unmeasured → flag `obstacle-unmeasured`. Alongside those, `offroad-ignored` (longer than `OFFROAD_FAIL_SECONDS·1.25 + 2` s) and `accel-without-gas` (`verdict-rules.ts:75–100`).
4. **The same world in the replay:** `ReplayEngine.verify` (`replay-engine.ts:74`, the plan at `:104`, `checkHolePass` at `:371`) repeats the hole check (`obstacle-ignored`/`-no-impact`, `:258`), and the holes donated by spectators (`donated-obstacle-ignored`, reject, `:277`; `event-unapplied`, `:144`) — **removed by decision 33**; they do not exist in v2.1 (§20.1).
5. **Traffic:** `TrafficSimulator` (`server/src/domain/verdict/traffic-sim.ts:76`) spawns cars from `seed ^ TRAFFIC_SEED_XOR` (`0x9e3779b9`, `client/shared/traffic.js:3`) using the shared kernel `client/shared/traffic-simulation.js`. Under v1, `verifyTrafficProof` (`traffic-proof.ts`) steps the server's cars along the client's pose and catches **`traffic-collision-ignored`** (a fatal contact, while the ride is "completed") and **`traffic-damage-ignored`** (hull above the server's) — both are a reject. Under v0 the same codes are only a flag (`replay-engine.ts:291/298`).
6. **The attack tests:** `server/scripts/e2e-road-check.mjs` (`e2e.sh road`): B — "a cheater in Chrome; the holes are pulled out of the game (the plan follower is stopped, `CFG.HOLES` is off, the cache is cleared)" → the expectation is `COMPLETED · REJECTED obstacle-ignored` (line 113), plus C — the spectator's replay draws the server holes with red marks, D — `scripts/ride-audit.mjs` yields `NOT OK`. `server/scripts/e2e-traffic-proof.mjs` (`e2e.sh traffic`): `no-cars`, `no-cars-no-columns` (the cars are removed from the scene, line 103), and `ignore-damage` → `traffic-collision-ignored`.
7. **The limit, written outright in the code** (`world-checks.ts`, the header): "a modified game that drives through the holes AND fakes the hull loss is a game that did hit the holes". What is checked is **how far the recording agrees with the server road, not whether the client is honest**. The poses (s, d, psi, v) come from the client, so a lateral "jump" past a hole or a car (#7) gets through.

#### 15.2 What changes in v2.1: the world is entirely the server's, and the server computes the poses
- The server builds the world itself: `roadSeed` → the road and the holes; `trafficSalt` → the traffic (§9.6); `mgSalt` → the stations, the barriers, the lay-bys, the minigame scenarios (§13.4); (the road challenges, with their hazards and cones, were removed by decision 14). There are no more holes or effects donated by spectators (decision 33): **neither money nor a spectator's actions change a ride's world**. **The client reports nothing about the world, only input.**
- A resimulation of `TruckSim` + `TrafficSimulation` from the `inp` events, step by step (§9.3). Every collision (a hole, a car, a cone, debris, a barrier, the side of a station, and props and buildings if they enter the kernel — #29) **is computed on the server**. Damage, `completed`, and the ride's metric are taken from the resimulation.
- The client's `chk` checkpoints are compared with the resimulation. A divergence means the client is living in another world, or under other physics: that is a tamper signal, not a reason to believe the client.

#### 15.3 Integrity reason codes (new, and refined)
| Code | When | Severity |
|---|---|---|
| `world-collision-ignored` | the resimulation sees contact with a server object (a hole, a car, a cone, a barrier, a station) and the client's `chk` does not (hull and pose show no contact) | reject |
| `world-digest-mismatch` | the client's `worldDigest32` ≠ the server's (the client is missing objects from the server world: cars, holes, or a station were removed) at ≥ 3 points in a row. Even with no contact, this is a sign of a modified client | reject when it lasts ≥ 10 s, otherwise flag |
| `resim-mismatch` | the client's pose or speed in `chk` diverges from the resimulation by more than the tolerance (modified physics: power, brakes, grip, "cruise") | reject (under bitwise determinism, from the first point; otherwise by the threshold of decision 12) |
| `resim-divergence` | the divergence is below the reject threshold, but it is growing (probably non-determinism of the browser) | flag |
| `noclip-path` | the trajectory from the resimulation runs into an object, while the client's `chk` goes "through" it (a wallhack-like passage through a barrier, a side, or a car) | reject |
| `teleport` / `lateral-teleport` | a jump in pose between adjacent `chk` points that is impossible for `TruckSim` (the longitudinal one already exists; the lateral one is new, #7) | reject |
| `speed-hack` | the steps run faster than wall (the step clock against the server, §14.4); the `maxGameSeconds` budget | a budget `400` + reject |
| `time-dilation` | slow-mo: game/wall < 0.9, sustained, outside pauses (§9.3) | reject / flag |
| `physics-constants-mismatch` | the hash of the kernel constants (`client/shared` + `CFG.TRUCK`) from `env` ≠ the build manifest. A weak signal: a modified client will lie; the main check is `resim-mismatch` | flag |
| `mg-station-skipped` | the station exists in the server world, and the client has neither a showing of it nor a stop (the client did not draw it) | a skip penalty + a flag; together with `world-digest-mismatch`, a reject |
| `toll-barrier-breach` | the resimulation sees a drive through a closed barrier | damage according to the kernel (like a contact); if the ride is "completed with no damage", then `world-collision-ignored` |
| `mg-timer-tamper` | the client's minigame µs diverge from server time (adjusted for RTT) by more than 300 ms, or they run backward | flag; an answer earlier than the reveal is `mg-answer-before-reveal` (reject) |
| `batch-mac-invalid` / `batch-mac-missing` | §14.3 | `400` + reject |
| `untrusted-input` | the share of events with `isTrusted=false` is > 0, in driving or in a minigame | flag (decision 26) |

- **Compatibility:** `obstacle-ignored`, `traffic-collision-ignored`, and the other v1 codes remain for v0/v1 rides. In v2.1, holes are judged by the resimulation: a player who "deleted" a hole still drives into it in the resimulation → `world-collision-ignored` (or simply the real damage, if the client honestly did not know). `e2e-road-check.mjs` B and `e2e-traffic-proof.mjs no-cars*` are moved into the v2.1 regression, expecting the new code.

---

### 16. Detection of mechanical input (mandatory)

#### 16.1 What exists now
`checkHumanTiming` (`server/src/domain/verdict/human-checks.ts`) works only on the driving keys, and **only as flags**: `uniform-holds` (the CV of the holds < `HOLD_CV_MIN = 0.08`), `repeated-timings` (the top-N intervals > `REPEAT_SHARE_MAX = 0.6`), `instant-presses` (a hold < `INSTANT_HOLD_MS = 10` ms at a share > `INSTANT_SHARE_MAX = 0.3`). Coarse browser timers are taken into account through `timerStepMs` / `TIMER_STEPS_MS`. It starts from `HUMAN_MIN_PRESSES = 8`. Plus `challenge-reflex` in `challenge-checks.ts`. The mouse, the stimuli, similarity between rides, and fatigue are not analyzed.

#### 16.2 Features (on the server, from `inp`, `clk`, `mg`, and the stimuli from the resimulation)
| # | Feature | How it is computed | Sign of a machine |
|---|---|---|---|
| F1 | Inter-event intervals | CV, Shannon entropy over log bins, an ex-Gaussian fit (μ, σ, τ), autocorrelation and spectral peaks | CV < 0.1; τ ≈ 0 (no right-hand tail); entropy below the 1st percentile of the base; sharp peaks |
| F2 | Reaction to a stimulus | RT from **the moment it becomes visible** (by the resimulation: a hole sign, a car's brake lights, a change of the signal, a minigame being shown) to the first appropriate input | a median < 100 ms on ≥ 10 unexpected stimuli; the share of anticipations (RT < 0); RT does not depend on how "noticeable" the stimulus is (distance, night) |
| F3 | Jitter and micro-corrections | short steering presses on a straight, per km; the variance of d inside the lane; corrections after a gust of wind | zero corrections on a perfect lane |
| F4 | Repeatability across rides | the DTW distance between one player's input sequences on identical stretches of `roadSeed`; exact matches of intervals (≤ 1 ms) | nearly identical rides → a replay or a TAS |
| F5 | Quantization | the share of timestamps on a grid of k·16.667 ms or of whole milliseconds; the phase modulo the frame period (a Rayleigh test), taking the timer resolution from `env` and `timerStepMs` into account | the phases sit exactly on a frame under a "fine" timer; the µs part is identical |
| F6 | Pointer kinematics (minigames) | path efficiency (straight over actual: for people, 0.8–0.95), curvature, a bell-shaped speed profile (minimum jerk), overshoot and corrective submovements, **Fitts's law** MT = a + b·log₂(D/W + 1) over every target of the ride, the click point inside the button (for people, a Gaussian scatter around the center) | a path of 1.0, or a cursor "teleport"; a constant speed; no overshoots; MT does not depend on the ID; clicks exactly in the center, or uniform |
| F7 | Key dynamics (minigames) | dwell and flight per character, a pause to read before typing ∝ the length of the code, splitting into groups, corrections (`Backspace`) | identical dwell and flight; typing with no pause to read; zero errors across every ride |
| F8 | Fatigue drift over the hour | the trend of RT, of the variance of d, and of minigame time, over windows of 10 min | no trend over 60 min (a weak feature, and only in combination) |
| F9 | Similarity across accounts | the ride's feature vector → clustering (HDBSCAN) + MinHash of n-grams of the intervals | a tight cluster of different wallets → a bot farm or sybils (the top-20 only, and with disclosure, decision 16) |
| F10 | Surroundings | `isTrusted`, `pointerType`, the `pointermove` rate, visibility and focus during a minigame | synthetic events; a minigame solved while the tab is hidden |

#### 16.3 The model and the thresholds
- **Stage 1 (the devnet launch, shadow):** each feature contributes a log likelihood ratio against the human base (capped, so that one feature cannot decide everything) → a sum over the groups `driving`, `minigame`, `cross-ride` → a logistic → `humanScore 0..1`, plus a top-3 of "why". The bases are separate by `pointerType`, by accessibility mode, and by timer class.
- **Stage 2 (after ≥ 1–2 thousand 1h rides):** gradient boosting on the same features, explained through each feature's contribution (SHAP) in the admin UI. The thresholds are versioned together with `RULES_VERSION`.
- **The base:** real people only: the shadow rides of the devnet launch, the team, and invited testers who consented. Synthetics do not enter the human base; they are needed only for TPR. ≈ 73 real entries today is too few, hence the shadow and the manual review.
- **False-positive targets** (as in decision 15): a false flag ≤ 2%, a false reject ≤ 0.1%, on the base. `T_ok` and `T_review` are chosen so that this holds on the base with margin (a confidence interval). Shadow lasts at least the whole week of the devnet launch plus the test rides after it, ≥ 2 weeks in total.

#### 16.4 Verdict levels
| Level | Condition | What the player sees |
|---|---|---|
| **verified** | `humanScore ≥ T_ok`, and no reject or flag on integrity | the ordinary result |
| **review** (`flag human-review`) | `T_review ≤ score < T_ok`, or `mg-mechanical`, `mg-too-fast`, `untrusted-input`, an F9 cluster | "under review"; the payout waits for a manual decision |
| **rejected** | integrity (§15.3) **or something physically impossible** (decision 27): (a) a median RT < 100 ms on ≥ 10 unexpected stimuli; (b) holds with a CV < 0.02 over ≥ 50 presses, under a fine timer; (c) ≥ 90% of the timestamps lie on the exact frame grid, with no µs noise, under a fine timer; (d) a match of ≥ 50 intervals in a row with another ride, to within ≤ 1 ms; (e) a cursor with no intermediate points (a teleport to the target) in ≥ 3 minigames | the reason code, without the thresholds; an appeal |

Separately, a `score < T_review` without the "impossible" is a **high-priority review**, not a reject.

#### 16.5 Shadow → enforce
1. Shadow (the devnet launch): everything is computed and written to `RideReplay` / `RideMiniGame`, and it does not affect the verdict or the payouts. A weekly report: the distributions, FP on the base, TPR on the bots of §17.
2. Calibrate the thresholds → a `RULES_VERSION` bump, `verdict:rejudge` over the shadow (the CLI already exists), and a comparison of "what it would have been".
3. Enforce comes later, after the shadow and the calibration: review blocks the payout until there is a decision, and a reject happens only under §16.4.

#### 16.6 Tools for the manual review (the top-20, and review)
- The admin page for a ride (on top of the existing `ride-review.mjs`, `ride-audit.mjs`, `override-verdict`, and `rejudge-ride` with a signature): a timeline of the stimuli and of RT against the percentiles of the base; **playback of the minigame traces** (the cursor over a screenshot of the layout, at a speed of ×0.25–×2); dwell/flight charts; the contribution of the features ("why"); the neighbors in the F9 cluster; a replay from the server poses.
- Decisions: `approve` / `reject` / `request re-ride` (a repeat ride under observation, under the rules of the devnet launch); every one of them is signed and written to the audit.
- The procedure: two reviewers for a reject of the top-3; a deadline of 48 h (`reviewHours: 48` on the 1h tariff).

---

### 17. Tests of the bot block: minigames, integrity, mechanics

Run: in-process (`server/test/anticheat/*.spec.ts`, fake clocks) on engine kernel, which generates the `inp` / `mg` events synthetically; docker at real pace is a 1h demo (`DEMO_SCALE=4` → 15 min) at night. The minigame UI may fail to build under the fake DOM (`level-check`) — then the traces run on the kernel, and Puppeteer comes later (as decided). The flag `MINIGAMES=shadow` in the tests checks both the shadow (the verdict does not change, and the features are written) and `enforce`.

#### 17.2 Integrity and the protocol
| ID | Attack | Expectation |
|---|---|---|
| AC-W1 | **Deleting the holes on the client** (as in `e2e-road-check.mjs` B) | v1: `rejected obstacle-ignored` (the regression is kept); v2.1: `world-collision-ignored`, or the real damage from the resimulation, plus `world-digest-mismatch` |
| AC-W2 | **Deleting the cars** (`no-cars`, `no-cars-no-columns` from `e2e-traffic-proof.mjs`) | v1: `traffic-collision-ignored`; v2.1: `world-collision-ignored` / `world-digest-mismatch` |
| AC-W3 | Deleting a station or a barrier from the scene | `mg-station-skipped` + `world-digest-mismatch` → rejected; on a drive-through, `toll-barrier-breach` |
| AC-W4 | Noclip: collisions with a barrier, a side, and a car are turned off | `noclip-path` → rejected |
| AC-W5 | Physics constants at ×1.3 power / ×2 brakes / grip ×1.5 | `resim-mismatch` → rejected (this closes #3, #4, #5) |
| AC-W6 | Speeding the game up by ×1.2 (a speed hack) | a budget `400`, or `speed-hack` → rejected |
| AC-W7 | Slow-mo at ×0.7 | `time-dilation` → rejected |
| AC-W8 | A minigame answer whose step is earlier than the reveal, or client µs that have been tweaked | `mg-answer-before-reveal` → rejected; `mg-timer-tamper` → review |
| AC-W9 | Editing a batch after the MAC; recomputing the keyless SHA | `batch-mac-invalid` → `400` + rejected |
| AC-W10 | A splice: a batch from ride A put into ride B | `batch-mac-invalid` (a different key, and `rideId`, inside the MAC) |
| AC-W11 | Replaying a nonce, someone else's nonce, or an answer after `expiresAt` | `409` + `mg-nonce-replay` (flag); `400` + `mg-nonce-foreign` (reject); `410` |
| AC-W12 | Substituting the clock-synchronization answers (a fake `clientPerfUs`) | drift against the step clock → `time-dilation` or `clock-jump` |
| AC-W13 | 60 s offline in the middle of a minigame (an honest player) | `verified`; `mg-answer-late-network` is info only — an FP control |
| AC-W14 | An honest player in accessibility mode at ×2 | `verified`, with no `mg-too-fast` / `mechanical` — an FP control |
| AC-W15 | A v1 client on a v2.1 ride | `409 client_outdated` |
| AC-W16 | A spectator tries to donate a hole or an effect (`POST watch/:id/donations` with `potholes` / `trench` / `sinkhole` / `night` / `day`, or a paid `donation-orders`) onto the current ride | `404` / `410` (the endpoint or the effect has been removed, and the ride is not visible — decisions 18, 33); the ride's world does not change, and the verdict does not change |
| AC-W17 | The client itself "applies" an effect (`effects/:eventId/applied`), or sends `event-*` in the input | the endpoint has been removed → `404`; events in the stream are dropped; the resimulation does not see them |
| AC-W18 | A recheck (`verdict:rejudge`) of an old v0/v1 ride that has donated holes | it is judged by its own rules (the ride's `RULES_VERSION`); the codes `donated-obstacle-ignored` are kept only there |

#### 17.3 New rows of the catalog (continuing §5 / §9.11)
| # | Cheat | Before | After §13–16 |
|---|---|---|---|
| 50 | Noclip through objects | U | C (`noclip-path`) |
| 51 | Deleting stations and barriers | — | C (`world-digest-mismatch`, `mg-station-skipped`) |
| 52 | An OCR or LLM bot for the minigames | — | U (review + a manual review; an honest limit) |
| 53 | Replaying and substituting a nonce | — | C |
| 54 | Splicing and forging batches outside the session | N (keyless SHA) | C (HMAC) |
| 55 | Substituting the minigame timers | — | C/F (`mg-answer-before-reveal` / `mg-timer-tamper`) |
| 56 | Modified physics constants | U/N (#3–5) | C (`resim-mismatch`) |
| 57 | Synthetic events from JS | N | F (`untrusted-input`) |
| 58 | A bot farm on different wallets | U | F (an F9 cluster, the top-20) |

> Tests of the ranking statistics (AC-R1–R8) are §21.5; tests of the finish point and of calibration (AC-F1–F11) are §22.6.

#### 17.4 Input mechanics on a long ride (a supplement to §10)
- AC-T13 `fatigue-free` — a bot with perfect stability for 60 min → `review` (F8 + F1).
- AC-T14 `frame-locked` — events exactly on the frames, under a fine timer → `rejected` (§16.4 c).
- AC-T15 `coarse-timer-human` — an honest player with `privacy.resistFingerprinting` (a timer of 16.7/100 ms) → `verified`, an FP control for F5.
- AC-T16 `cluster-farm` — 10 wallets, the same bot with different noise seeds → an F9 cluster → `review` for all of them.
- AC-H3, a base of humans on 1h (with minigames) → a false flag ≤ 2%, reject = 0.

---

### 18. The estimate (person-days), and what happens when

> **Decision 11 (17.10) changes the phases:** there is no separate volume for a stage of "a devnet launch in shadow on v1". The owner builds v2 plus the minigames immediately, at full scope ("I will get it all done"). So §18.1 is the **order of the work** (what comes first), and the "minimum" (decision 30) and the cut (32b) are replaced. The estimate does not change:
> - v2 plus the basic minigames: **70–105 person-days**;
> - with the whole extended catalog of §13.9 (if all of it is approved): **103–151**;
> - dropping 4h/8h (decision 17) saves ≈ 1–2 days (the 8h measurements and perf);
> - 30 Hz (decision 12) barely changes the volume, but it lowers the risk on server CPU.
>
> For reference: until the devnet launch (09–15.11) there are ≈ 16 working days. **Seasons are not planned for now** (the owner's decision of 17.10): everything that is not part of the devnet launch is "later", with no dates. The risk is recorded and is not disputed. If by the devnet launch v2 is not ready to enforce, the current v1 is what will judge (it is on main), and v2 is switched on when it is ready (`INPUT_REPLAY_REQUIRED`, §9.8).

Today is 17.10. Until the devnet launch is ≈ 3 weeks (registration on 02.11, the week of 09–15.11). After that it is "later"; seasons are not planned for now.

#### 18.1 The first queue (the devnet launch; by decision 11, the start of the full scope)
| Step | Contents | Estimate |
|---|---|---|
| P1 | A session key on `/start`, plus an HMAC of the batch **alongside** the SHA chain (v1 is not broken), plus `ack` / `serverMs`, plus clock-synchronization pings in the heartbeat | 2–3 |
| P2 | Extra telemetry inside the hashed text of v1 (a new optional field, `aux`): `isTrusted`, `pointerType`, `env`, `clk`, the codec | 2 |
| P3 | The minigame skeleton: `mgSalt`, `mgCommit`, the schedule and the slots, delivery in the heartbeat, `POST …/answer`, `RideMiniGame`, with the penalties off (`MINIGAMES=shadow`) | 4–5 |
| P4 | `phone-sms` on the existing phone (`phone.js`, `ui/map.js`): icons, an SMS, a keyboard, a picture-value in the cab, an `mg` trace | 3–4 |
| P5 | Features F1 and F2 (from the v1 holes and cars) and F5–F7, by an offline script over the shadow recordings, plus a weekly report | 3–4 |
| P6 | Tests: AC-M1–M4, M8, W8–W11, W13, a 1h demo run; a regression of AC-W1/W2 on the current code | 3 |
| **Total for the full set** | | **17–21** |
| ~~**The minimum (decision 30)**~~ — replaced by decision 11 | P1 + P2 + P4, with a simplified P3 (`phone-sms` only, with no stations) + P5 offline | **11–14** |

#### 18.2 The second queue (later — enforce)
| Step | Contents | Estimate |
|---|---|---|
| B1 | Stations as world objects in the kernel (`client/shared`): a fuel station, a weigh station, a toll section with a barrier, a lay-by for parking; inserted into slots by `mgSalt`; rendering; collisions | 8–12 |
| B2 | The UI and the logic of `fuel-station`, `weigh-station`, `toll-gate` (+ `cargo-seal`) | 5–7 |
| B3 | Protocol v2.1 in full (the binary codec, deflate, `chk` with `worldDigest`, dropping the mandatory `samples` / `trafficProof`) — beyond F2 of §9.12 | 3–4 |
| B4 | The integrity codes of §15.3 inside the resimulation (on top of F3 of §9.12) | 3–4 |
| B5 | The full model of §16 (F3, F4, F8, F9, F10), separate bases, thresholds, enforce | 5–7 |
| B6 | The review tools of §16.6 (minigame traces, "why", clusters) | 3–4 |
| B7 | Accessibility of §13.7, plus the text of the rules and of PRIVACY.md (mouse traces and key traces) | 2–3 |
| B8 | The tests of §17 in full, plus nightly 1h runs, plus golden v2.1 | 4–5 |
| **Total beyond §9.12** | | **33–46** |

> **The extended catalog of §13.9:** if all 11 candidates are approved — **+33–46 person-days** beyond this table (together with the crypto UI kit, 2–3). Decision 32(b) is replaced by decision 11, so this is not a cut but an **order**: the first wave is `sign-or-reject` + `address-check` + `buy-shitcoin` + the kit, ≈ +9–12. The total if everything is approved: **103–151 person-days**.

- The overlap with §9.12 (F0/F2, the protocol; F5, the humanness score; F6, the tests) is ≈ 10–14 days, so **v2 plus this layer together are ≈ 70–105 person-days** (the first queue's minimum of 11–14 + §9.12's 39–55 + §18.2's 33–46 − the overlap of 10–14). **For one developer, this is unrealistic by 11.01** (≈ 12 weeks ≈ 55–60 working days, and less still once the other tasks are subtracted). A second developer is needed, or a cut (decision 32): for example, `weigh-station` and `cargo-seal` later, and ML stage 2 later.

---

## Appendix D. Protection against sybils and multi-accounting, and the TrustScore system

> Status in the code ([`PRODUCT.md`](PRODUCT.md)): on `main`, the check "one person, many wallets" is not enabled as an automatic blocker; the layers below set the target layered defense against sybil farms going after pool prizes, free attempts, referrals, and the TEN4 airdrop ([`../plan/MASTER_PLAN.md`](../plan/MASTER_PLAN.md) §8, §10, §12).

### D.1 The layered model (8 layers)
1. **Network signals (`player.SignIn.ipHash`, the ASN — with no `User-Agent` and no browser fingerprint)**:
   - An IP hash of `HMAC-SHA256(IP_HASH_SECRET, a /24 prefix for IPv4 or /48 for IPv6)`, kept for `90 days` (`antisybil_ip_retention_days = 90`; `SIGNIN_RETENTION_DAYS = 90` per [`../legal/PRIVACY.md`](../legal/PRIVACY.md)); `player.SignIn` holds no raw IP and no `User-Agent`, and **a browser fingerprint is rejected** ([`legal.md`](legal.md) `LEG-M-05`).
   - An IP-cluster check through `ipinfo Core`: mobile ASNs are excluded (`antisybil_ip_exclude_mobile_asn = 1`), and the penalty of `-50` (`trust_ip_cluster_penalty = 50`) is applied **only when a second signal is present** (`antisybil_ip_penalty_requires_second_signal = 1`).
2. **The `TrustScore` system (`MASTER_PLAN.md` §8, migration `20261105200000_trust`)**:
   - **By play**: `+15` points for a day with a verified finish (`trust_finish_points = 15`), at most `2` days in a week (`trust_finish_days_per_week = 2`), with a cap of `100` (`trust_finish_cap = 100`, `trust_threshold = 100`).
   - **Fast paths (`trust_fast_paths = 'paid,sgt'`)**: buying a paid ticket, or holding a Solana Seeker Genesis Token (SGT), immediately gives `+100` (`World ID` is Season 2; `Human Passport` is not used).
   - **Social networks (`trust_social_cap = 30`)**: X `+20`, Discord `+15`, Telegram `+5` (no more than `30` in total).
   - **Access thresholds**: the Convoy referrer needs `trust >= 50` (`referral_min_trust_referrer = 50`); an airdrop participant needs `trust >= 50` (`airdrop_min_trust = 50`); a ride on a friend's free weekly ticket counts toward the Convoy M1/M2 milestones when `the friend's trust >= 100` (`referral_count_weekly_grant = 1`). What the player sees is a checklist (`trust_display_mode = 'checklist'`).
3. **Economic and temporal gates (Anti-Farm Gates)**:
   - Training (`tier = free`) gives no TEN4, no tickets, and no prizes (`RID-M-02`).
   - Prize payouts and referral rewards are held (`payout_hold_hours = 72`; the hold on referral TEN4 is `48 h`), so that a farm's results can be cancelled (`veto_winners_root` / `withheld`) before the funds are withdrawn.
   - KYC through `Didit`: when playing on a free ticket, for any cash prize (`payout_kyc_free_any = 1`); when playing on a bought ticket, from `$50` per season (`payout_kyc_paid_season_cents = 5000`); mandatory sanctions screening by `Chainalysis` (`payout_sanctions_check = 1`, fail-closed).
4. **The on-chain funding graph (`Helius funded-by` + clustering)**:
   - A check for a shared sponsor wallet (`funded-by` through the Helius Developer API; a `404` response carries no penalty, and our own check of the transfer graph is used instead), for fan-out distribution of SOL (`fan-out`), and for payouts merging (`fan-in`) onto one withdrawal address.
5. **A behavioral fingerprint of the driving and of the minigames (feature `F9` in §16.2)**:
   - The ride's vector of biometric features (the distribution of steering holds, F1; reaction time, F2; cursor kinematics in the minigames, F6; key dynamics, F7) → `HDBSCAN` clustering and `MinHash` of n-grams of the intervals between different wallets (for the pool's top-20 and for airdrop candidates, decision 16; `antisybil_telemetry_shadow = 1` for the 2 weeks of the launch).
6. **Rate limits in the referral program (Convoy Caps)**:
   - On `main`: `inviteCapacity` (it starts at `3`, with a step of `+3` for every `5` verified paid shifts, up to `30`), an invite TTL of `14` days, and a weekly gift limit of `10`.
   - The target Convoy model (`MASTER_PLAN.md` §6): slots of `min(100, 5 + 2·A)`, a `pending` TTL of `72 h`, a qualification window of `60 days`, a limit on a friend's promo rides of `3/day`, `10/week` per referrer and `500/week` globally, a personal cap of `1,000 TEN4/month` and a global cap of `60,000 TEN4/month` (`30,000/month` for the first 3 months after `tge_at`) (`referral.md`).
7. **One qualifying ticket / a cap on the share of free tickets**:
   - In the board's ranking, only the best verified attempt from one wallet is counted (`one best ride per wallet`), and the prize share of free tickets is capped at `free_prize_board_cap_bps = 3000` (30%).
8. **A mandatory manual review of the top-20 before payout (§16.6)**:
   - Before the results are locked in and paid out, every wallet in the top-20 is checked in the admin UI against the `F9` graph, the stimulus timelines, the minigame traces, the IP clusters, and the `funded-by` graph; if a sybil link is found, the linked accounts are disqualified (`rejected`).
