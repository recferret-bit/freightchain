# Rides — spec and test plan

> Ride types, 1h as the only ranking ride, training, the dynamic finish, statistics for the ranking. Decisions: 17, 38–44, 23, 42, 6, 7; the owner's decision of 17.10.2026 on the ranking. Algorithm details — Appendices A (former §21) and B (former §22) below, text unchanged.

## Part 1. Spec

### 1.1 In the code now (`origin/main`)
- Tiers:
  - `ride-tier.ts:26` — 1h `{usd 5, minTickets 20, schedule saleHours 24 / playHours 3 / reviewHours 48}`, and 4h/8h exist too;
  - trips `client/js/trips.js` (`'1h'` `finish:false`, free levels `free-1c` / `free-2c` / `free-3c`, the frozen `free-3b`, guest `free-g`).
- Training: `POST /api/rides {tier:'free', level}` without debiting `freeRides` (the `free_on_signup` counter and `GrantDailyFreeRidesHandler` are still in the code). Guest EASY — `POST /api/auth/guest`. The weekly 1h ticket is on main.
- Finish: `completeDist = K × MAX_SPEED × minSeconds`. For 1h that is 50 400 m (`ride-rules.ts:5,52`). Completion is `lastS ≥ completeDist` **as reported by the client** (`ride.entity.ts:337`).
- There are no per-ride statistics, only aggregates (`server/prisma/stats/stats.prisma`). Only the client counts a red light (`orchestrator.js:49–53`).

### 1.1a Free levels, the tutorial, Assist, and weekly tickets (`ride-trip.ts`, `trips.js`, `tutorial.js`, `assist.js`)
- **Free-level table (`FREE_LEVELS` in `server/src/domain/rides/ride-trip.ts` ⇄ `client/js/trips.js`, countries in `client/js/free-countries.js`)** (at `FREE_RIDE_SECONDS = 180`):
  - **Level 1 — EASY (`free-1c`)**: `180 s` (`×1`), `K = 0.3` → `completeDist = 1 512 m`, route Stuart Highway (`stuart`), start `'straight'`, `first: ['country']`, `firstLen: [500, 500]`, `holesFrom = 4 000 m` (holes do not appear on EASY), the tutorial is on by default on the first ride, Assist is available.
  - **Level 2 — MEDIUM (`free-2c`)**: `300 s` (`×5/3`), `K = 0.4` → `completeDist = 3 360 m`, route Route 66 (`route66`), `first: ['xroad4', 'fork', 'xroad4']`, `firstLen: [450, 450]`, `holesFrom = 400 m`, Assist is available.
  - **Level 3 — HARD (`free-3c`)**: `1 800 s` (`×10`, 30 min), `K = 0.4` → `completeDist = 20 160 m`, route Brenner Pass (`brenner`), `first: ['fork', 'xroad', 'fork', 'arterial', 'xroad']`, `firstLen: [450, 450]`, sharp bends (`bends: 1.35`), `holesFrom = 150 m` (`HOLE_FIRST`), `tutorial: false` and `assist: false` (`409 tutorial_not_allowed` / `assist_not_allowed`).
  - **Guest start (`play.html` / `client/js/easy-entry.js`) and offline `?sim=1` (`free-g`)**: opening a bare `play.html` with no `?ride=` creates a one-shot guest session `POST /api/auth/guest` (`guest_<hex>`, `walletSignIn: false`) and orders a real EASY ride (`free-1c`, with heartbeats, a replay, and verification), or an offline fallback `free-1c` when the API is unavailable. The id `free-g` remains only for `?sim=1` mode.
  - **Frozen `trip` ids (`TRIP_ROADS`, `TRIP_HOLE_FIRST`)**: `free`, `free-1`, `free-2`, `free-3`, `free-1b`, `free-2b`, `free-3b` (15 min HARD), `classic` — **never delete them and never change their parameters**, so that old rides pass `verdict:rejudge` and open in replays; retuning a level creates a new id (`free-1d` and so on). Check skills: `trip-design` and `level-check`.
- **Level choice and change (`readyFreeRide`), and the leaderboard**:
  - If the player already has an unstarted (`ordered`) free ride, a repeat `POST /api/rides { tier: 'free', level }` re-picks the level/route/seed in place (`readyFreeRide`, recomputes `completeDist`); trying to start a stale tab with the old `level` returns `409 ride_rechosen`.
  - Free-ride board: `GET /api/leaderboard?board=free&level=1|2|3` (`localStorage` keys: level choice `freightchain.level`, board tab `freightchain.board-level`, Assist checkbox `freightchain.assist`).
- **The tutorial (`client/js/ui/tutorial.js`) and driver Assist (`client/js/ui/assist.js`, `client/js/guide.js` → `cockpit/guide.js`)**:
  - The tutorial (9 steps on the dashboard + interception of live faults via `trouble()`) turns on if the player does not yet have `Player.tutorialPassedAt`; starting a ride with `tutorial: true` sets `Player.tutorialPassedAt` in `StartRideHandler` under the player lock.
  - Driver Assist (`CFG.ASSIST = 0.5`) halves both hull damage (`hurt()`, cold wear) and battery drain (`updateBattery`), and also shows a hint banner (`ASSIST_HULL_DAMAGE` stays strictly above `PASS_DAMAGE_SHARE = 0.25`, so that the server `checkWorld` counts a hole hit and does not reject the ride as `obstacle-ignored`).
  - Achievements for levels and for driving on one's own: `free-easy`, `free-crossroads`, `free-hard`, `on-my-own` (a completion without Assist), `free-medium-3/5/10`, `free-hard-2/3/5`.
- **Unlimited training and the weekly free ticket (`weekly_ticket_1h_enabled`)**:
  - Training (`tier: 'free'`) is unlimited (`freeRides` is not debited; the historical fields `freeRides`, `freeDay`, `freeRidesMax` and the `GameSetting` keys `free_on_signup`, `free_rides_daily_max` are kept for compatibility).
  - Once a week (`weekly_ticket_1h_enabled = 1`, `weekly_ticket_1h_days = 7`) each wallet is granted 1 free qualifying ticket for `1h` (`OrderRideHandler`: `PromoRideGrant` is spent first, then the weekly ticket, then a purchased ticket).

### 1.1b The road-generation algorithm (`@freightchain/shared` ⇄ `server/src/domain/road`)
The client and the server build a bit-identical infinite deterministic road from `(seed, trip)` through the shared modules `client/shared/{prng.js,road.js,road-network.js,road-geometry.js,route-curvature.js}` and their server port `server/src/domain/road/{road-rules.ts,road-layout.ts,road-plan.ts}` (`RID-M-21`, test `RID-T-12` in `road-drift.spec.ts`). The full mathematical specification is **Appendix C (§§C.1–C.7)** below: PRNG primitives (`mulberry32`, `rnd`), spine coordinates `(s, d)` and `RoadLayout.onRoad(s, d)` (`C.1–C.2`), the starting exit `sA = 190 m` / `Sm = 225 m` (`C.3`), the 9 `PATTERNS` templates, the `TRIP_ROAD_SPEC` table, and the `extendTo(targetS)` loop (`C.4`), signal phases and `stopLine` (`C.5`), `FORK` forks, `ROUTE_CURVATURE` curvature profiles, and the 2D integration `(RX, RZ, RT)` (`C.6`), hole types `HOLES`, the chunk roll `rollChunkHole`, and per-axle damage `holeDamage` (`C.7`).

### 1.2 Rules
- **RID-M-01** MUST: ride types are **training** (`tier = free`, levels, offline guest) and **1h**. 1h is the only type for the ranking and the pool. 4h and 8h are not sold and are not created (decision 17; `onSale=false`, `POST /api/rides {tier:'4h'}` → `400`/`409`).
- **RID-M-02** MUST: a training ride is not a ranking ride, has no TEN4, no pool, and no minigames (decision 19), **does not enter replays**, and is labeled in the lobby in EN and RU (→ [`replays_streams.md`](replays_streams.md) RPL-M-02/10/10a). Training (decision 56, ✅ 17.10.2026) = `tier=free` (all levels) + the offline guest + any ride with the tutorial/assist. The free devnet-launch attempt and the one-hour promo ride are **not** training.
- **RID-M-03** MUST: the 1h finish is computed by the **server** when the ride is created: `finishFor(roadSeed, trip, FINISH_RULES_VERSION)`, ≈ 3600 s at `V_BASE = 65 km/h` on a clear straight, accounting for bends, signals, forks, and a fixed minigame allowance (decisions 38, 39). The result is written to `Ride.completeDist`.
- **RID-M-04** MUST: the finish point depends only on `roadSeed`, `trip`, and the rules version. It does not depend on `trafficSalt`, `mgSalt`, or `holeSalt`, so there is one per pool (decision 39).
- **RID-M-05** MUST: the finish of a created ride does not change when the constants change (as in `ride-rules.ts:46`).
- **RID-M-06** MUST: the finish snaps to a safe place (≥ 60 m from junctions and forks, not in a station, not in a hole). The shift is ≤ 300 m.
- **RID-M-07** MUST: `finishS ≤ ROAD_PLAN_MAX_S − 5 000`, otherwise the pool is not created (decision 40).
- **RID-M-08** MUST: "reached the finish" = in the server recomputation `s` crossed `finishS` before the limit, with no failure and no reject. The client's `lastS` is only a provisional status. A mismatch → `finish-not-reached`.
- **RID-M-09** MUST: the limit is 90 min of play time (decision 43). For a late start: `min(90 min, play_close_at + 60 s − start)`. Did not reach the finish → `timeout`, `finished=false`.
- **RID-M-10** MUST: an early finish is a good time; there is no minimum time. The `MAX_SPEED` governor does not change. A time below the human p1 → review, not a reject (decision 41).
- **RID-M-11** MUST: in 1h the finish line and the remaining km are drawn (`finish: true`); the expected time is not shown (decision 44).
- **RID-M-12** MUST: every ride has a `stats.RideResult` row with the fields from Appendix A §21.2. The verdict worker writes it (upsert by `rideId`). Only server fields (S/D/Srv) go into the ranking; client fields (C) are only cross-checked → `client-stats-mismatch` (flag).
- **RID-M-13** MUST: damage is stored by source (holes, vehicles, roadside objects, cold, other); the sum = `damageTotal`.
- **RID-M-14** MUST: a red-light run is counted by the server from the single definition `stopLine(j, +1)` and the phase `signal(j,'main') === 'R'` (decision 7, catalog #32).
- **RID-M-15** MUST: fields with no rule (`stopLineViolations`, `speedingSeconds`) are `null`, not 0 (decision 41).
- **RID-M-16** MUST: minigame penalties are separate fields (`mgWrong`, `mgMissed`, `mgPenaltySeconds`, `mgDetail`) and are not added to the time automatically. Minigames do not fail the ride (decision 23).
- **RID-M-17** MUST: the pool ranking. The gate is `finished && verdictTier = verified`. Those who did not reach the finish rank below everyone who did (by `distanceM`, then by damage). The owner's formula, with a version (`scoreFormulaVersion`), is published before the pool opens and does not change until it closes (decision 42). The default is 30/25/20/25 (Appendix A §21.4); that is only a proposal.
- **RID-M-18** MUST: `legacy` rows (old rides) do not enter the pool ranking; unmeasured fields are `null`.
- **RID-M-19** MUST: public pool results (`GET /api/pools/:id/results`) are available only after `payout_at`. `featureScores` and `humannessScore` are visible only in the admin UI.
- **RID-M-20** MUST: donations and spectator actions do not change any field of `RideResult` (decision 33).
- **RID-M-21** MUST: bit-identical road generation between the client (`@freightchain/shared`: `prng.js`, `road.js`, `road-network.js`, `road-geometry.js`, `route-curvature.js`) and the server (`server/src/domain/road/{road-rules.ts,road-layout.ts,road-plan.ts}`) — segments, lanes, junctions, signal phases, forks, curvature `(RX, RZ, RT)`, the hole roll `rollChunkHole`, and the damage calculation `holeDamage` must match for any `(seed, trip)`. Any change to the generator updates both sides in one commit.

## Part 2. Test plan
Existing ids from the appendices: **AC-R1…R8** (statistics), **AC-F1…F11** (finish). New ones:
| id | Rule | Scenario | Expected |
|---|---|---|---|
| RID-T-01 | M-01 | `POST /api/rides {tier:'4h'}` and `'8h'`; `GET /api/tiers` | refused; the tiers have no 4h/8h |
| RID-T-02 | M-02 | a training ride: `free-1c`, `free-2c`, `free-3c` (and the frozen `free-3b`), the offline guest, a one-hour ride with assist/the tutorial; controls: the free devnet attempt and the 1 h promo ride | training rides have no row in the pool ranking, no TEN4, `mgIssued = 0`, and are absent from replays; the controls have a replay; visibility → RPL-T-04 |
| RID-T-03 | M-03 | creating a 1h | `Ride.completeDist = finishFor(seed, '1h')`, `expectedSeconds ∈ [3600; 3600 + ds/v]` (= AC-F1) |
| RID-T-04 | M-17 | the default formula: 10 golden rides | `score` matches (= AC-R6); the owner's example = 100%, the 70 min example = 73.7% |
| RID-T-05 | M-17 | equal `score` | order by `driveToFinishSeconds + mgPenaltySeconds`, then damage, `endedAt`, `seq` |
| RID-T-06 | M-17 | changing the weights after the pool opens | refused (`409 score_formula_locked`) |
| RID-T-07 | M-19 | `GET /api/pools/:id/results` before `payout_at` | `404` for others; the admin sees it |
| RID-T-08 | M-20 | a donation + chat on a replay | `RideResult` is unchanged (= RPL-T-84) |
| RID-T-09 | M-12 | the client did not send `reds` | the S field is filled by the recomputation |
| RID-T-10 | M-11 | a 1h ride in the client (E1, `trips.js` / HUD) | the finish line at `finishS`, the remaining km; no expected time |
| RID-T-11 | M-15 | a new `RideResult` row | `stopLineViolations` and `speedingSeconds` = `null` |
| RID-T-12 | M-21 | road-generator parity, client ⇄ server (`road-drift.spec.ts`, `road-plan.spec.ts`, `replay-engine.spec.ts`), on every `trip` and dozens of `seed`s | `segs`, `juncs`, `forks`, `lanesAt(s)`, `roadHalfWidth(s)`, `signal(j)`, `holesNear(s)`, `holeDamage`, and the 2D integration `(RX, RZ, RT)` match exactly |

### Traceability
| Rule | Tests |
|---|---|
| M-01 | RID-T-01 |
| M-02 | RID-T-02, RPL-T-04/16 |
| M-03 | RID-T-03, AC-F1, AC-F2 |
| M-04 | AC-F7 |
| M-05 | AC-F11 |
| M-06 | AC-F8 |
| M-07 | AC-F1 (boundary) |
| M-08 | AC-F5, AC-F6 |
| M-09 | AC-F9, AC-F10 |
| M-10 | AC-F3, AC-F4 |
| M-11 | RID-T-10 (closed the gap) |
| M-12 | AC-R2, AC-R7, RID-T-09 |
| M-13 | AC-R3 |
| M-14 | AC-R1, AC-R4 |
| M-15 | AC-R8, RID-T-11 (closed the gap) |
| M-16 | AC-R5 |
| M-17 | AC-R6, RID-T-04/05/06 |
| M-18 | AC-R8 |
| M-19 | RID-T-07 |
| M-20 | RID-T-08 |
| M-21 | RID-T-12 (`road-drift.spec.ts`) |

In total: 21 MUST, the planned ids RID-T-01…12, and the ids from the appendices (AC-R1…R8, AC-F1…F11). An id is not a written test. The executable bar is [`../testing/COVERAGE_CONTRACT.md`](../testing/COVERAGE_CONTRACT.md).

---

## Appendix A. Statistics and ranking (former §21)
> Carried over unchanged from `anticheat_test_plan.md §21` (superseded, merged into docs/spec) (17.10.2026); heading levels shifted by one. Part 1 of this file is normative; on a conflict, the spec wins.

### 21. The 1h-ride result and the ranking: per-ride statistics (owner decision of 17.10.2026)

**Principle (owner):** the main criterion is **reached the finish**. Then come total time, damage, signals (obeying the rules, red-light runs), and minigames. Example: reached the finish, no damage, by the rules, every minigame passed = 100%. **The owner builds the ranking formula**, so each component is stored as a **separate field** on every ride. The formula below (§21.4) is only a proposal.

#### 21.1 What the schema has now (`origin/main`, `server/prisma/*/*.prisma`)
- **There is no per-ride statistics table.** The `stats` schema has only aggregates: `PlayerStats` / `GlobalStats` / `DailyStats` (`rides`, `ridesCompleted`, `seconds`, `metres`, `crashesVehicle`, `crashesBuilding`, `donations`, `donationLamports`).
- `ride.Ride`:
  - `status` (`completed | abandoned | failed | expired | …`), `reason` (text; `fail-code.ts` splits it into `heartbeat_lost / implausible_progress / brakes / engine_blown / cold_engine / hull / off_road / crash / other`);
  - `lastS`, `driveSeconds`, `startedAt` / `endedAt`, `hull` (final, **as reported by the client**), `crashesVehicle` / `crashesBuilding` (schema comment: "statistics, not security", a client counter), `nightSeconds`, `paused`;
  - `minSeconds`, `completeDist`, `trip`, `seed`, `challenges` (Json, road challenges, replaced by minigames per decision 14).
- `verdict.RideVerdict`: `status` (`pending | verified | flagged | rejected`), `reasons` Json `[{code, detail}]`, `scores` Json, `rulesVersion` (currently `RULES_VERSION = 7`), manual override (`overriddenBy/At`, `note`).
- `verdict.RideReplay`:
  - `simulated*` / `recorded*`: Seconds, Distance, Hull, CrashesVehicle/Building;
  - `eventsExpected/Correlated`, `redFlags`, `scores`, `simHz` (10 by default).
- `verdict.RideReplayFlag` — codes with `atSecond`/`atMetre`/`evidence`.
- **The finish now:** `ride.entity.ts:337` — `completed` if `lastS ≥ completeDist`. The client sends `lastS` in the heartbeat. For 1h, `completeDist = 0.5 × 28 × 3600 = 50 400 m` (`ride-rules.ts:5,52`). There is no field for the time at the finish.
- **Damage is not split by source.** On the client, damage comes from several places (`client/js/sim/damage.js`):
  - `hit()` — roadside objects (guardrails, rocks, trees);
  - `hurt()` — vehicles (a label), a building → `hull = 0`;
  - holes (`holeDamage`, `road-rules.ts`);
  - cold (`sim/climate.js:51`, `COLD_WEAR`).
  
  Server v1 (`replay-engine.ts`) checks hole hits against the road plan (`holesNear`) and the **client's hull samples** (10 Hz). There is no breakdown of damage by source.
- **Red light:**
  - the client counts `st.reds` (`client/js/net/orchestrator.js:49–53`: crossing the stop line `j.s − (j.mouth + 1.2)` while `net.signal(j,'main') === 'R'`), shows a toast, and shows the line "Red lights run" in the result (`ui/game.js:194`);
  - **this is not sent to the server and is not checked by the rules** (catalog #32, decision 7);
  - the signal phase is deterministic: `road-network.js:162` `signal(j, app)` from `net.clock + j.off` and the cycle `j.cyc` from the seed. The v2 recomputation (§9.6, §15) can count reds itself.
  
  ⚠️ Mismatch: in the client the stop line is `mouth + 1.2`, while the shared `stopLine()` (`road-network.js:172`) is `mouth + 2`. For the server, take the single definition (`stopLine`) and run test AC-R4.
- **A stop line at a junction with no signal / speeding — the concepts do not exist:**
  - a main road with no signal is "give way to nobody" (`ui/map.js:313`); the `S` sign is only on the side road;
  - there are no speed limits, only the governor `MAX_SPEED = 28 m/s`.
  
  Leave the fields in the schema as `null` / "not measured" until a rule exists (decision 41).

#### 21.2 The new table `stats.RideResult` (one row per ride)
Source: **S** — the server v2 recomputation (authoritative, 30 Hz, decision 12); **D** — derived by the server from S; **C** — as reported by the client, for cross-check and debugging only, does not enter the ranking; **Srv** — the server clock and server events.

| Field | Type | Source | Meaning / where it comes from now |
|---|---|---|---|
| `rideId` (PK, FK `Ride`) | uuid | — | |
| `wallet`, `poolId`, `tier`, `trip`, `roadSeed`, `attemptNo` | — | Srv | a copy from `Ride`, for ranking queries without a join |
| `rulesVersion`, `finishRulesVersion`, `scoreInputsVersion`, `simHz` | Int | Srv | the rules the row was computed with (`RULES_VERSION`, §22) |
| `finished` | Bool | **S** | the recomputed `s` crossed `finishS` before the limit (§22.5), with no failure |
| `finishReason` | enum | **S**/D | `finished`, `timeout`, `crash_vehicle`, `crash_building`, `hull`, `off_road`, `engine`, `brakes`, `cold_engine`, `abandoned`, `heartbeat_lost`, `rejected` (from `failCode`, but the reason comes from the recomputation) |
| `finishS` | Float | Srv | the finish point issued at creation (`Ride.completeDist`, §22) |
| `distanceM` | Float | **S** | distance travelled (now `RideReplay.simulatedDistance`; `Ride.lastS` is C) |
| `driveSeconds` | Float | **S** | recomputation steps / 30 (play time with pauses excluded) |
| `driveToFinishSeconds` | Float? | **S** | time from the start until `finishS` is crossed (`null` if the finish was not reached) |
| `wallSeconds` | Float | Srv | `endedAt − startedAt` on the server clock |
| `pausedSeconds`, `pauseCount` | Float/Int | **S** | from the `clk` stream (decision 6) |
| `avgSpeedKmh`, `maxSpeedKmh` | Float | D/**S** | |
| `hullAtFinish` | Float | **S** | recomputed hull (now `RideReplay.simulatedHull`; `Ride.hull` is C) |
| `damageTotal` | Float | **S** | `100 − hullAtFinish` (hull starts at 100) |
| `damageHoles`, `damageVehicles`, `damageProps`, `damageCold`, `damageOther` | Float | **S** | damage by source: holes / vehicles / roadside objects / cold / other (the sum = `damageTotal`) |
| `holesHit`, `holesHitByType` | Int / Json | **S** | `{pothole, cluster, trench, sinkhole…}` |
| `crashesVehicle`, `crashesBuilding`, `crashesProp` | Int | **S** | contacts in the recomputation (now C on `Ride`, S on `RideReplay` without props) |
| `offroadSeconds`, `offroadEpisodes` | Float/Int | **S** | run-offs (`OFFROAD_FAIL_SECONDS = 20`, decision 7) |
| `signalsPassed` | Int | **S** | main-road signals crossed at the stop line (the denominator) |
| `redLightViolations` | Int | **S** | crossing `stopLine(j, +1)` while `signal(j,'main') === 'R'` |
| `amberPasses` | Int | **S** | on amber (informational, not a violation) |
| `redLightDetail` | Json | **S** | `[{junctionId, s, atSecond, speedKmh}]` |
| `stopLineViolations` | Int? | — | `null`: the concept does not exist (decision 41) |
| `speedingSeconds` | Float? | — | `null`: there are no speed limits (decision 41) |
| `mgIssued`, `mgPassed`, `mgWrong`, `mgMissed` | Int | **S** | from the `mg` stream and the server schedule (`mgSalt`) |
| `mgPenaltySeconds` | Float | D | `20·mgWrong + 45·mgMissed` (decision 23); **separate**, not added to the time |
| `mgMode` | enum | Srv | normal / "more time" (decision 28) |
| `mgDetail` | Json | **S** | `[{id, variant, issuedAtS, issuedAtSec, answeredAtSec, outcome, reactionMs, penaltyS}]` |
| `verdictTier` | enum | **S** | `verified / review / rejected` (§16; the schema currently has `verified / flagged / rejected`) |
| `verdictReasons` | Json | **S** | codes (`RideVerdict.reasons`) |
| `humannessScore` | Float 0–1 | **S** | §16, features F1–F10 |
| `featureScores` | Json | **S** | the F1–F10 values (admin UI only) |
| `clientReported` | Json | C | `{lastS, hull, reds, crashesVehicle, crashesBuilding}` — for the mismatch code `client-stats-mismatch` (flag) |
| `score`, `scoreFormulaVersion` | Float? / Int? | D | by the owner's formula (§21.4); may be left unstored and computed by the query |
| `replayId`, `computedAt` | — | Srv | which recomputation produced the row |

**Rule:** only **S/D/Srv** fields go into the ranking. C fields are only cross-checked: a mismatch beyond the tolerance → `client-stats-mismatch` (flag).

#### 21.3 Where it is computed, and the migration
- **Only the verdict worker computes it**, after the recomputation (incrementally, in batches, §9.7). It writes the row by **upsert on `rideId`** at every verdict, including on `verdict:rejudge`. Recomputation history stays in `RideReplay`.
- **Recomputation-core steps for the new fields (part of F1/F3):**
  - damage with a source label: `hurt()` / `hit()` / `holeDamage` / `COLD_WEAR` gain a `source` argument;
  - red light: move `redLight()` from `orchestrator.js` into the shared core; the signal clock `net.clock` comes from the step counter;
  - the event of crossing `finishS`;
  - `crashesProp`.
- **Migration** (manual SQL, as practiced in `server/prisma/migrations/`; for example `2026xxxx_ride_result`):
  - a new `RideResult` model in `stats` (`@@schema("stats")`), indexes `(poolId, finished, verdictTier)`, `(poolId, driveToFinishSeconds)`, `(wallet, computedAt)`;
  - `Ride` does not change; `Ride.completeDist` remains the finish point (§22);
  - **backfill for old rides:** `finished` from `status = completed`, `distanceM = lastS`, `driveSeconds`, `hull`, crashes from `Ride`, `source = legacy`. Reds, damage by source, and minigames are `null` ("was not measured"). Such rows do not enter the pool ranking;
  - `PlayerStats` can later be extended with totals of `redLights` and `mgPassed`. Not required.
- **API:** `GET /api/pools/:id/results`. Publicly — only after `payout_at` (decision 34); `featureScores` and `humannessScore` — admin UI only. A CSV export for the owner in the admin UI (the pool tab).

#### 21.4 The default ranking formula — **a proposal; the owner sets the parameters**
1. **Gate:** `finished = true` and `verdictTier = verified`. Rides in `review` wait for a manual check. Those who did not reach the finish rank **below everyone who did**: by `distanceM` (greater is higher), and on a tie by `damageTotal`.
2. **For those who reached the finish:** `score = 100 × (w_t·S_time + w_d·S_dmg + w_r·S_rules + w_m·S_mg)`, where Σw = 1. By default:

| Component | Weight | Formula (the parameters are configurable) |
|---|---|---|
| `S_time` time | 0.30 | 1 if `driveToFinishSeconds ≤ T_ref` (3600 s); linearly down to 0 at `T_cap` (5400 s) |
| `S_dmg` damage | 0.25 | `1 − damageTotal / 100` |
| `S_rules` rules | 0.20 | `max(0, 1 − 0.25 · redLightViolations − 0.05 · offroadEpisodes)` |
| `S_mg` minigames | 0.25 | `mgPassed / mgIssued` (if `mgIssued = 0` → 1) |

3. **A tied score (for example, several at 100%):**
   1. a smaller `driveToFinishSeconds + mgPenaltySeconds` — the faster driver ranks higher;
   2. then a smaller `damageTotal`;
   3. then an earlier `endedAt`, then `seq`.
4. **The owner's example:** reached the finish in ≤ 60 min, damage 0, reds 0, minigames 3/3 → 100%. Reached the finish in 70 min, damage 12, 1 red, 2/3 → 100·(0.30·0.667 + 0.25·0.88 + 0.20·0.75 + 0.25·0.667) ≈ **73.7%**.
5. Minigame penalties (+20 / +45 s) are by default counted **only in the tie-break**: an error is already counted in `S_mg` and is not counted a second time in `S_time`. The owner's option: add the penalty to the time and drop `S_mg`. The fields for both options exist.
6. The formula and the weights are a versioned config (`scoreFormulaVersion`). It is published in the pool rules **before the pool opens** and does not change until the pool closes (decision 42).

#### 21.5 Tests (the bot block, a supplement to §17)
| id | Scenario | Expected |
|---|---|---|
| AC-R1 | A bot runs the red at every signal, with no contact | `redLightViolations = signalsPassed_red`, matches the client's `st.reds` (C) |
| AC-R2 | The client sends `reds = 0`, `hull = 100`, while the recomputation has 3 reds and damage | S goes into the ranking; a `client-stats-mismatch` flag |
| AC-R3 | Damage by source: a hole + a vehicle + a guardrail + cold | the sum of the sources = `damageTotal` ± 0.01 |
| AC-R4 | Crossing the stop line on the R/G phase boundary (±1 step) | one `stopLine` definition; identical across 3 runs (determinism) |
| AC-R5 | 2 minigames skipped, 1 error | `mgMissed = 2`, `mgWrong = 1`, `mgPenaltySeconds = 110`, `finished` does not change; ≥ 2 skips → flag (decision 23) |
| AC-R6 | Golden: 20 rides with known components | `score` by formula v1 matches the expected value; changing the weights changes only `score` |
| AC-R7 | Rejudge after a `RULES_VERSION` change | the `RideResult` row is overwritten; `computedAt` and `rulesVersion` are new |
| AC-R8 | An old ride (`source = legacy`) | does not enter the pool ranking; the fields are `null`, not 0 |

---


---

## Appendix B. The dynamic finish (former §22)
> Carried over unchanged from `anticheat_test_plan.md §22` (superseded, merged into docs/spec) (17.10.2026); heading levels shifted by one. Part 1 of this file is normative; on a conflict, the spec wins.

### 22. The dynamic finish point: a route of ≈ 1 hour at 65 km/h (owner decision of 17.10.2026)

#### 22.1 As it is now (`origin/main`)
- **The road does not end and is built from templates** (`config.js:37`: "the road itself never ends"). This is not a graph with a choice of turns, but a "spine" (`spine`):
  - template segments `country` / `arterial` / `town` / `xroad` (`client/shared/road.js:34–42`) with lanes, bends, and junctions (`junction.gap`, the signal fraction `signal`: country 0.35, arterial 0.9, town 0.75);
  - forks (`forkCommit`).
  
  You cannot turn onto the side roads (`road-network.js:14–15`). A "route along the graph" here = a pass along the spine generated from `seed`.
- **The finish is a fixed distance, not a time:** `completeDist = K × MAX_SPEED × minSeconds`, for 1h `0.5 × 28 × 3600 = 50 400 m` (`ride-rules.ts:5,52`). The value is stored in `Ride.completeDist` at creation and does not change for an old ride (`ride-rules.ts:46`). Free levels: `FREE_RIDE_SECONDS` (env, 180 by default) × `multiple`, `k` 0.25–0.4 (`ride-trip.ts:17–30`, `trips.js`).
- Trip `'1h'` has `finish: false` (`trips.js:58`): **the finish line is not drawn**. Completion is `lastS ≥ completeDist` **as reported by the client** (`ride.entity.ts:337`).
- The road plan is bounded by `ROAD_PLAN_MAX_S = 1 000 000 m` and the window `ROAD_PLAN_MAX_SPAN = 10 000 m` (`client/shared/road.js:118–120`).
- The comment in `road-network.js:119`: "the server's port has no curvature" — **the server currently has no curvature**. It is needed for the expected speed in bends; curvature is part of the shared v2 core (F1).

#### 22.2 The `finishFor(roadSeed, trip, cfg)` algorithm (the server, when the ride is created)
1. Build the network `createRoadNetwork({seed: roadSeed, trip})` from the shared deterministic code (`client/shared/road-network.js`) — the same code the client and the recomputation use.
2. `T = T_start` (acceleration from a standstill and the exit from the depot, 25 s by default) `+ T_mg` (a fixed minigame allowance, item 4).
3. Walk the spine in steps of `ds = 5 m` from the start `Sm`. On each step:
   - `v_free = V_BASE × f_pattern(seg) × f_lanes(seg) × f_traffic(trip)`, where `V_BASE = 65 km/h = 18.06 m/s` (decision 38);
   - `v_curve = sqrt(A_LAT / |κ(s)|)`, `A_LAT = 2.0 m/s²`;
   - `v = min(v_free, v_curve, MAX_SPEED)`;
   - `T += ds / v`. The speed change between steps follows acceleration `a_acc = 1.0` and braking `a_dec = 2.5 m/s²` (a kinematic profile: on entering a bend the speed drops in advance).
4. **A junction on the step** (from `net.near`):
   - **with a signal:** `T += p_ng × (W + L_ss)`:
     - `p_ng = (T_cyc − g) / T_cyc` — the share of "not green" for the main road, from this junction's `j.cyc` (the cycle from the seed: `SIGNAL_GREEN 16–26`, `AMBER 3`, `CLEAR 2`, `CROSS 9–14` → `T_cyc ≈ 42.5 s`, `p_ng ≈ 0.5`);
     - `W = (T_cyc − g) / 2` — the mean remainder of red;
     - `L_ss = v/2 · (1/a_dec + 1/a_acc)` — the loss for stopping and accelerating (≈ 12.6 s at 65 km/h);
     - in total ≈ 11–12 s per signal, an **expected value**, not the phase at the expected arrival: a real driver arrives at a different time;
   - **with no signal:** `T += L_j` (2 s by default, a main road with no yielding);
   - **a fork:** `T += L_fork` (3 s by default).
5. **Minigames:** `T_mg` is a **fixed allowance, the same for everyone** (by default `3 × (30 s + L_ss) ≈ 130 s`), not the real positions. The minigame schedule is personal (`mgSalt`) and secret until reveal (decision 29). If the finish depended on it, it would give the schedule away and make the distance differ between players (decision 39).
6. Stop when `T ≥ T_target = 3600 s`, and obtain `s*`.
7. **Move to a safe place:** `finishS = snapSafe(s*)` — the first point `≥ s*` that:
   - is no closer than 60 m to a junction, a stop line, or a fork;
   - is not inside a station zone or a boom-barrier zone;
   - is not inside a hole ±30 m.
8. Check: `finishS ≤ ROAD_PLAN_MAX_S − 5 000`, otherwise a configuration error (decision 40).
9. Return `{finishS, expectedSeconds: T, finishRulesVersion}`. `finishS` is written to `Ride.completeDist` (the field already exists; no migration is needed); `expectedSeconds` goes to `RideResult` / the log. The constants `V_BASE`, `A_LAT`, `f_*`, `L_*`, `T_*` are a config versioned by `FINISH_RULES_VERSION` (it is part of `RULES_VERSION`).

**Determinism:**
- Inputs: only `roadSeed`, `trip`, and the rules version. `trafficSalt` and `mgSalt` — **no**. `holeSalt` (decision 35, if there is more than one attempt) — **no**: holes are accounted for by an expectation per km (`f_traffic` / `L_hole × density`), not by their own positions. Then everyone on a shared `roadSeed` has **the same finish point**, and the times are comparable (decision 39).
- The calculation uses a fixed step. The operation order is fixed. It is computed once on the server, and the result is stored, so the client does not need to repeat it.
- **For a pool**, `finishS` is one per pool: it is computed at `create_pool` / opening and **cached** in the pool config (a pool's `roadSeed` is shared).

**An estimate before calibration** (order of magnitude only; check with tests AC-F1–F2):
- at a clean 65 km/h — 65 km;
- signals per km: country ≈ 0.5, town ≈ 3;
- bends, and the turn to the depot;
- in total **≈ 50–58 km** (currently 50.4 km, fixed).

#### 22.3 The server is the source of truth
- The client receives `finishS` in the start response (as it receives `completeDist` now) and draws the finish line and the remaining km. `'1h'` has `finish: true` (decision 44). **The client cannot move the finish:** the server compares the recomputed `s`, not `lastS`.
- `finished = true` ⇔ the v2 recomputation has a step on which `s` crosses `finishS` before the limit (§22.5), before a failure and with no reject code. `driveToFinishSeconds` = that step's number / 30.
- `ride.entity.ts:337` (`lastS ≥ completeDist`) stays a provisional status for the UI. **The outcome and the ranking come only from the recomputation.** A mismatch (the client says "reached the finish", the recomputation says no) → `finish-not-reached` (a reject for the pool if the recomputation is confident, otherwise review).
- After the finish is crossed, the server ends the ride (`finish` with reason `shift complete`). Driving past the finish does not enter the result.

#### 22.4 Fast drivers
- The governor `MAX_SPEED = 28 m/s` (≈ 100 km/h) does not change. The finish is computed for 65 km/h, so a fast driver reaches it in ≈ 40–50 min. **That is a good time, not a violation** (decision 41): it wins on `S_time` (up to the cap) and in the tie-break.
- There is no minimum time (as now: "no minimum time any more"). Protection against an impossible speed already exists: the governor and `implausible-progress`. In v2 it is in the recomputation.
- A time below the 1st percentile of people (AC-F3) → review, not a reject.

#### 22.5 The ride time limit
- **A hard limit of `T_cap = 90 min` of play time** (`driveSeconds`; pauses are a separate limit from decision 6). Did not reach the finish by `T_cap` → the server closes the ride, `finishReason = timeout`, `finished = false`, and in the ranking it sits among those who did not finish, by `distanceM`.
- **With the last start (decision 36):** the start is no later than close − 1 h 15 min. The limit for such a ride is `min(T_cap, play_close_at + 60 s − start)`, that is, no less than 75 min. That is more than the expected 60 min. Decision 36 does not change (decision 43).

#### 22.6 Tests (the bot block and calibration)
| id | Scenario | Expected |
|---|---|---|
| AC-F1 | Calibration: 10 000 `roadSeed` values, `finishFor` | `expectedSeconds ∈ [3600; 3600 + ds/v]`; the `finishS` distribution (p1/p50/p99) is in the report; not a single failure or a result past `ROAD_PLAN_MAX_S` |
| AC-F2 | The "reference driver" bot (drives as in the model: 65 km/h, `A_LAT`, stops on red, minigames of 30 s) on 200 seeds, time acceleration (§11) | the actual time is 60 ± 3 min in p10–p90; otherwise recalibrate `f_*` / `L_*` |
| AC-F3 | The distribution of human time: tester rides (≥ 30 people × 2 seeds) | p1, p50, p99 → the "too fast" review threshold, and a check that p50 ≈ 55–65 min. A report by pattern (town versus country) |
| AC-F4 | A bot on the 28 m/s governor that ignores red | time ≈ 40–45 min, `finished = true`, `redLightViolations > 0`; not a reject |
| AC-F5 | A modified client sends `lastS ≥ completeDist` early | recomputation: `finished = false`, `finish-not-reached` |
| AC-F6 | The client draws the finish closer (a substituted `finishS`) | no effect on the server; `finished` follows only the server `finishS` |
| AC-F7 | One `roadSeed`, different `trafficSalt` / `mgSalt` / `holeSalt` | `finishS` is the same |
| AC-F8 | Snap: `s*` inside a junction, a hole, or a station | `finishS` is past the zone, the shift is ≤ 300 m |
| AC-F9 | A slow bot at 40 km/h | `timeout` at 90 min, `finished = false`, ranking by `distanceM` |
| AC-F10 | A late start exactly at `last_start_at` | the limit = 75 min + 60 s, close follows `play_close_at` |
| AC-F11 | A change of `FINISH_RULES_VERSION` | `completeDist` of rides already created does not change (as in `ride-rules.ts:46`) |

---

## Appendix C. The deterministic road-generation algorithm (`@freightchain/shared` ⇄ `server/src/domain/road`)

This is the normative description of the current road-generator implementation on `main`, shared by the client (`client/shared/prng.js`, `road.js`, `road-network.js`, `road-geometry.js`, `route-curvature.js`, `client/js/trips.js`) and the server (`server/src/domain/road/road-rules.ts`, `road-layout.ts`, `road-plan.ts`). The parity test is `server/src/domain/road/__tests__/road-drift.spec.ts` (**RID-M-21 / RID-T-12**).

### C.1 The PRNG and the primitives (`client/shared/prng.js`, `road.js`)
1. **The positional hash `rnd(n)`** (used for the hole roll in chunks and for choosing a fork's side; it does not depend on traversal order):
   - `x = Math.sin(n * 127.1 + 311.7) * 43758.5453`
   - `rnd(n) = x - Math.floor(x)`
2. **The streaming PRNG `mulberry32(seed)`** (used to lay out templates, segments, junctions, signal cycles, and the traffic simulation):
   - Initialization: `a = seed >>> 0` (at ride start, `seed = (ride.seed ?? 0xC0FFEE) >>> 0`).
   - On each call to `r()`:
     - `a = (a + 0x6D2B79F5) | 0`
     - `t = Math.imul(a ^ (a >>> 15), 1 | a)`
     - `t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t`
     - return `((t ^ (t >>> 14)) >>> 0) / 4294967296`
3. **Math utilities (`road.js`)**:
   - `clamp(x, a, b) = Math.max(a, Math.min(b, x))`
   - `smooth(u) = (t = clamp(u, 0, 1), t * t * (3 - 2 * t))`
   - `wPick(r, items)`: a weighted pick from an array, where an element's weight is `x[x.length - 1]` (for templates `[patKey, weight]`, for lanes `[nR, nL, weight]`).

### C.2 The spine coordinate system, lane geometry, and the off-road check (`road.js`, `road-layout.ts`, `road-rules.ts`)
- `CHUNK_LEN = 32` m (the length of one road chunk).
- `LANE0 = 2.4` m (the lateral offset of the centre of the inner lane `i = 0` from the centre line).
- `LW = 4.2` m (lane width). The centre of lane `i` (a `0`-index from the centre line) in direction `dir ∈ {+1, -1}`:
  - `laneLat(dir, i) = dir * (2.4 + i * 4.2)` (`+2.4, +6.6, +10.8` on the right; `-2.4, -6.6, -10.8` on the left).
- The half-width of the carriageway for `n` lanes in one direction:
  - `edgeOf(n) = 4.5 + (n - 1) * 4.2` (`4.5 m` for 1 lane, `8.7 m` for 2, `12.9 m` for 3).
- `TAPER = 120` m (the length of the smooth blend `smooth((s - seg.s0) / TAPER)` for `halfWidth(s, dir)` at the start of a new segment `seg.id > 1`, if there is no fork at the start of the segment).
- `SHOULDER = 1.2` m (the shoulder width past the edge of the asphalt).
- `SIDE_LEN = 450` m (the length of a junction's side arms).
- `ROAD_PLAN_MAX_S = 1_000_000` m, `ROAD_PLAN_MAX_SPAN = 10_000` m.
- **The on-asphalt check (`RoadLayout.onRoad(s, d)` in `road-layout.ts`)**:
  - When `s > -80 && s < 30 && Math.abs(d) < 34` (the depot grounds) → `true`.
  - Within the main carriageway, `d >= -edgeOf(nL) - 0.5 && d <= edgeOf(nR) + 0.5` → `true`.
  - In a fork zone, `forkApron(s) > 0 && Math.abs(d) <= FORK.corridor + 0.5` (`15.5 m`) → `true`.
  - When `s < knownFrom` (`Sm + 100 = 325 m`, the depot-exit maneuver zone, where sample `d` in world coordinates does not match the local arc) → `null` (not judged).
  - Within a junction's `pad` (`da ∈ [pad.a0 - 1, pad.a1 + 1]`, `d ∈ [pad.l0 - 1, pad.l1 + 1]`) or on its side arm (`|da| < j.sideHalf + 0.5 && j.arms.includes(sign(d)) && |d| < j.len`) → `true`; otherwise → `false`.
- **The server off-road rule (`isOffRoad(s, lat, layout)` in `road-rules.ts`)**:
  - If `layout` is passed: a run-off counts when `layout.onRoad(s, lat) === false && layout.onRoad(s, lat - Math.sign(lat) * OFFROAD_GRACE) === false` (`OFFROAD_GRACE = 2.5 m`). A continuous run-off longer than `OFFROAD_FAIL_SECONDS = 20 s` ends the ride with reason `off_road` (in the verdict — `offroad-ignored`, if `OFFROAD_FAIL_SECONDS * 1.25 + 2` is exceeded).

### C.3 The starting exit (`sA`, `Sm`, `j0`)
- The depot approach road (`id = 0`, `pat = 'access'`): `s ∈ [0, sA]`, where `sA = 190 m`, lanes `nR = 1, nL = 1`, `bends = 0`, `centre = null`.
- The exit turn (`id = 1`, `pat = 'turn'`): radius `START_TURN_R = 22 m`, arc length `L = Math.round((Math.PI / 2) * 22) = 35 m`, end of the turn `Sm = sA + L = 225 m`, lanes `nR = 1, nL = 1`, curvature `kTurn = 0` when `trip.start === 'straight'`, otherwise `(Math.PI / 2) / L`.
- The start node `j0` (`id = 0`, `s = Sm = 225 m`): `kind = 'start'`, `signal = false`, `arms = []`, `sideLanes = 1`, `sideHalf = edgeOf(1) + 0.3 = 4.8 m`, `mouth = 0`, `len = 0`, `pad = { a0: -(R + 7.5), a1: 4, l0: -(halfL + SHOULDER), l1: R + 2 }` (where `R = 22`, `halfL = 4.5`).
- `genEnd` is initialized to `Sm = 225 m`, `nextJ = Infinity`.

### C.4 Road templates (`PATTERNS`) and the layout by `trip`
Nine templates (`client/shared/road.js`, where `lanes` is an array of tuples `[nR, nL, weight]`):
| Template | `len` (m) | `seg` (m) | `lanes` (`[nR, nL, w]`) | `bends` | `centre` | `junction.gap` (m) | `cross` | `signal` | `side` | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| `country` | `[900, 2400]` | `[700, 1600]` | `[[1, 1, 1]]` | `1` | `null` | `[420, 950]` | `0.5` | `0.35` | `[1, 1, 2]` | |
| `highway` | `[1600, 3600]` | `[500, 1100]` | `[[2, 2, 3], [3, 3, 1], [3, 2, 1], [2, 3, 1]]` | `0.55` | `'double'` | `null` | — | — | — | no junctions |
| `arterial` | `[800, 1700]` | `[400, 900]` | `[[2, 2, 3], [2, 1, 1], [1, 2, 1], [3, 3, 1]]` | `0.35` | `'double'` | `[260, 520]` | `0.85` | `0.9` | `[1, 2]` | |
| `town` | `[500, 1100]` | `[300, 700]` | `[[1, 1, 2], [2, 2, 1]]` | `0.15` | `null` | `[170, 320]` | `0.7` | `0.75` | `[1]` | |
| `dual` | `[1500, 3200]` | `[700, 1500]` | `[[2, 2, 1]]` | `0.6` | `'double'` | `null` | — | — | — | `2+2` with no junctions |
| `fork` | `[1200, 1200]` | `[1200, 1200]` | `[[1, 1, 1]]` | `0` | `null` | `null` | — | — | — | `fork: true` |
| `open` | `[500, 500]` | `[500, 500]` | `[[1, 1, 1]]` | `1` | `null` | `null` | — | — | — | the starting open stretch |
| `xroad` | `[500, 500]` | `[500, 500]` | `[[1, 1, 1]]` | `1` | `null` | `[380, 500]` | `1` | `0.5` | `[1, 1, 2]` | a starting `1+1` with a junction |
| `xroad4` | `[500, 500]` | `[500, 500]` | `[[2, 2, 1]]` | `0.6` | `'double'` | `[380, 500]` | `1` | `0.5` | `[1, 1, 2]` | a starting `2+2` with a junction |

Route layout by `trip` (`TRIP_ROAD_SPEC` in `road-rules.ts` / `client/js/trips.js`):
| `trip` | `style` | `bends` | `holeChance` | `holeFirst` (m) | `start` | `first` (`firstLen`) | `weights` |
|---|---|---|---|---|---|---|---|
| `'1h'`, `'4h'`, `'8h'`, `'free-3'`, `'free-3b'`, `'free-3c'` (and the default) | `'route66'` | `1` | `1` | `Sm + 150 = 375` (`'free-3b'/'3c'`: `320`) | `'depot'` | `['country']` (`[500, 1100]`) | `[['country', 4], ['highway', 3], ['arterial', 3], ['town', 2], ['dual', 2], ['fork', 2]]` |
| `'free-g'` (guest EASY) | `'stuart'` | `0.3` | `0.35` | `300` | `'straight'` | `['open', 'xroad', 'country', 'arterial']` (`[420, 550]`) | `[['country', 4], ['arterial', 3], ['dual', 2], ['town', 1]]` |
| `'free-1'` | `'stuart'` | `0.35` | `0` | `Infinity` | `'depot'` | `['country', 'dual', 'highway']` (`[500, 1100]`) | `[['country', 4], ['dual', 4], ['highway', 3]]` |
| `'free-1b'`, `'free-1c'` | `'stuart'` | `0.35` | `0.45` | `380` | `'straight'` (`1c`) / `'depot'` (`1b`) | `['open', 'xroad', 'country', 'arterial']` (`[420, 550]`) | `[['country', 4], ['arterial', 3], ['dual', 2], ['town', 1]]` |
| `'free-2'` | `'route66'` | `0.85` | `0.6` | `Sm + 150 = 375` | `'depot'` | `['country', 'arterial', 'town']` (`[500, 1100]`) | `[['country', 3], ['arterial', 4], ['town', 3], ['dual', 2], ['fork', 1]]` |
| `'free-2b'`, `'free-2c'` | `'route66'` | `0.85` | `0.75` | `320` | `'straight'` (`2c`) / `'depot'` (`2b`) | `['xroad4', 'arterial', 'fork', 'town']` (`[420, 550]`) | `[['arterial', 4], ['town', 3], ['fork', 3], ['country', 2], ['dual', 2]]` |

The `extendTo(targetS)` algorithm (`road-network.js` / `road-layout.ts`, where `rr([a, b]) = a + r() * (b - a)`):
1. While `genEnd < targetS`:
   - If `patLeft <= 0`:
     - If `firstQueue` (`trip.road.first`) has items, take `patKey = firstQueue.shift()`, and `patLeft = rr(firstLen)` (by default `firstLen = [500, 1100]`).
     - Otherwise a random template is chosen, `patKey = wPick(r, pool)`, from `weights` (excluding the current `patKey` if `weights` has ≥ 2 items), and `patLeft = rr(PATTERNS[patKey].len)`.
   - For `P = PATTERNS[patKey]`: the next segment's length is `raw = Math.min(rr(P.seg), patLeft)`; if the remainder `patLeft - raw < P.seg[0] * 0.6`, then `len = Math.round(patLeft)`, otherwise `len = Math.round(raw)`. `patLeft -= len`.
   - A lane tuple `[nR, nL] = wPick(r, P.lanes)` is chosen and a segment is created, `{ id: segs.length, s0: genEnd, s1: genEnd + len, pat: patKey, nR, nL, bends: P.bends, centre: P.centre, fork: !!P.fork }`, `genEnd = seg.s1`.
   - If `P.fork === true`: a fork is created, `forks.push({ f0: s0, f1: seg.s1, side: rnd(seed % 9973 + s0 * 0.37) < 0.5 ? -1 : 1, choice: 0 })`, and `nextJ = seg.s1 + 200`.
   - Otherwise, if `!P.junction`: `nextJ = Infinity`.
   - Otherwise (`J = P.junction`):
     - If `!isFinite(nextJ)`: `nextJ = s0 + r() * J.gap[0]`.
     - Let `lo = s0 + TAPER + 100`, `hi = seg.s1 - 120`. While `nextJ < hi`:
       - If `nextJ < lo`: `nextJ = lo; continue`.
       - `addJunction(Math.round(nextJ), J, seg)` is called with a **strict order of `r()` calls**:
         1. `kind = r() < J.cross ? 'cross' : 'tee'`
         2. `side = r() < 0.5 ? -1 : 1` (called always, even for `'cross'`, so the PRNG stream does not shift!)
         3. `signal = r() < J.signal`
         4. `sl = J.side[Math.floor(r() * J.side.length)]`
         5. `g = rr(SIGNAL_GREEN)` (`[16, 26]`), `c = rr(SIGNAL_CROSS)` (`[9, 14]`), `T = g + SIGNAL_AMBER + SIGNAL_ALL_RED + c + SIGNAL_AMBER + SIGNAL_ALL_RED` (`SIGNAL_AMBER = 3`, `SIGNAL_ALL_RED = 2`)
         6. `off = r() * T`
       - Junction geometry: `arms = kind === 'cross' ? [-1, 1] : [side]`, `sideHalf = edgeOf(sl) + 0.3`, `mouth = sideHalf + 1.5`, `mainR = edgeOf(seg.nR) + SHOULDER`, `mainL = edgeOf(seg.nL) + SHOULDER`, `pad = { a0: -mouth, a1: mouth, l0: arms.includes(-1) ? -(mainL + 3) : -mainL, l1: arms.includes(1) ? mainR + 3 : mainR }`, `len = SIDE_LEN`.
       - `nextJ += rr(J.gap)`.

### C.5 Signal phases and the stop line (`signal`, `stopLine`)
- For a junction `j` with `j.signal === true` at time `clock`:
  - `t = ((clock + j.off) % T + T) % T`, where `{ g, a, r, c, T } = j.cyc`.
  - For the main road (`approach === 'main'`):
    - `t < g` → `'G'` (green)
    - `t < g + a` → `'A'` (amber)
    - otherwise → `'R'` (red)
  - For the side road (`approach === 'side'`):
    - `t0 = t - g - a - r`
    - `t0 < 0` → `'R'`
    - `t0 < c` → `'G'`
    - `t0 < c + a` → `'A'`
    - otherwise → `'R'`
- The stop line (`stopLine(j, dir = 1)` in `road-network.js`): `j.s - dir * (j.mouth + 2)`.

### C.6 Forks (`FORK`), curvature, and 2D integration (`road-network.js`, `road-geometry.js`, `route-curvature.js`)
- Fork constants (`FORK`): `{ len: 1200, bulge: 0.55, commit: 205, corridor: 15, reach: 1.5 }`, `FORK_SWITCH_JUMP = 4`.
- The branch-deflection profile at `u = (s - f.f0) / (f.f1 - f.f0) ∈ (0, 1)`:
  - `forkG(u) = Math.sin(2 * Math.PI * u) * Math.sin(Math.PI * u) ** 2`
  - The branch sign is `bulge(f) = f.choice || f.side`.
  - The finite difference of the fork curvature (`forkCurv(s)` in `road-network.js:116`):
    - `forkCurv(s) = bulge(f) * FORK.bulge * (forkG((s + 1 - f.f0) / L) - forkG((s - f.f0) / L))` (where `L = f.f1 - f.f0 = 1200`).
- The curvature calming factor `calm(s)` (`road-network.js:108`):
  - The product over every junction `j`: `c *= smooth(clamp((Math.abs(s - j.s) - ((j.mouth ?? 110) + 50)) / 110, 0, 1))`.
  - The product over every fork `f`: `c *= smooth(clamp(Math.max(f.f0 - s, s - f.f1, 0) / 110, 0, 1))`.
- Route profiles `ROUTE_CURVATURE` (`route-curvature.js`, with a smooth entry `ramp(s) = clamp((s - 60) / 120, 0, 1)`):
  - `route66(s) = ramp(s) * (0.0045 * sin(s / 310) + 0.0035 * sin(s / 130 + 1.1) + 0.0016 * sin(s / 47 + 2.0))`
  - `stuart(s) = ramp(s) * (0.0012 * sin(s / 700) + 0.0007 * sin(s / 260 + 1))`
  - `siberia(s) = ramp(s) * (0.0030 * sin(s / 420) + 0.0025 * sin(s / 170 + 2) + 0.0010 * sin(s / 60))`
  - `brenner(s) = ramp(s) * (0.0055 * sin(s / 230) + 0.0035 * sin(s / 95 + 0.6) + 0.0018 * sin(s / 40 + 2))`
  - `panamerican(s) = ramp(s) * (0.0035 * sin(s / 900) + 0.0015 * sin(s / 300 + 1))`
- The full curvature `curv(s)` (`road-network.js:220`):
  - On `s < sA` (`190 m`): `0`
  - On `sA <= s < Sm` (`190..225 m`): `kTurn` (`0` when `trip.start === 'straight'`, otherwise `(Math.PI / 2) / 35`)
  - On `s >= Sm`: `styleFn(s - Sm) * trip.bends * segAt(s).bends * calm(s) + forkCurv(s)`
- Integration of the world coordinates `(RX[i], RZ[i], RT[i])` at a step of `1 m` (`createSpineGeometry` in `road-geometry.js`, start `RX[0] = 0, RZ[0] = 0, RT[0] = 0`):
  - For each integer step `i >= 1`:
    - `t = RT[i - 1]`, `k = profile(i - 1)`, `tm = t + k / 2`
    - `RX[i] = RX[i - 1] + Math.sin(tm)`
    - `RZ[i] = RZ[i - 1] - Math.cos(tm)`
    - `RT[i] = t + k`
  - On the interval `[s0, s0 + 1]`, the values `(x, z, t)` are interpolated linearly by the fractional part `f = s - s0`, and the local normal to the right is `(nx, nz) = (Math.cos(t), Math.sin(t))`, so `worldPos(s, d) = { x: p.x + nx * d, z: p.z + nz * d, t: p.t }`.

### C.7 Hole types (`HOLES`), the hole roll (`rollChunkHole`), and the damage formula (`holeDamage`)
- Five hole types in `HOLES` (`client/shared/road.js:81`):
  1. `pothole`: `ells: [[0, 0, 0.55, 0.48, 0.1]]`, `dmg: 4`, `slow: 0.05`, `crawl: 5`
  2. `deep`: `ells: [[0, 0, 0.85, 0.72, -0.15]]`, `dmg: 8`, `slow: 0.12`, `crawl: 4`
  3. `cluster`: `ells: [[-0.55, -0.35, 0.48, 0.4, 0.2], [0.5, 0.25, 0.58, 0.46, -0.3], [0.05, -0.55, 0.4, 0.34, 0.1]]`, `dmg: 7`, `slow: 0.1`, `crawl: 4.5`
  4. `trench`: `ells: [[0, 0, 1.85, 0.48, 0.04]]`, `dmg: 10`, `slow: 0.18`, `crawl: 3.5`, `lane: true`
  5. `sinkhole`: `ells: [[0, 0, 1.35, 1.15, -0.12], [-0.8, 0.4, 0.65, 0.55, 0.25], [0.75, -0.35, 0.6, 0.5, -0.2]]`, `dmg: 14`, `slow: 0.35`, `crawl: 3`, `lane: true`, `cones: true`
  - Natural road holes are chosen from `CONE_HOLE_IDS = Object.keys(HOLES).filter(k => HOLES[k].cones)` (`['sinkhole']`).
- The function `rollChunkHole(ci, net, holeChance, holeFirst = Sm + 150, maxS = Infinity)` (`road.js:97`):
  - `q(k) = rnd(ci * 97.13 + k * 3.71)`
  - The longitudinal coordinate is `s = ci * 32 + 4 + q(1) * 24`
  - If `s < holeFirst || s >= maxS || q(2) >= holeChance || !net.plain(s, 70)` (`plain(s, pad)` checks that there is no junction closer than `(j.mouth ?? 70) + pad` and no fork closer than `pad`), `null` is returned.
  - Otherwise:
    - `type = CONE_HOLE_IDS[Math.floor(q(3) * CONE_HOLE_IDS.length)]`, `T = HOLES[type]`
    - `r = q(4)`, `j = q(5) - 0.5`
    - `dir = T.lane ? (r < 0.7 ? 1 : -1) : r < 0.6 ? 1 : -1`
    - `lanes = net.lanes(s, dir)`
    - `lane = laneLat(dir, Math.floor(q(6) * lanes))`
    - `lat = T.lane ? lane : r < 0.85 ? lane + j * 1.6 : j * 1.2`
    - returns `{ id: 'h' + ci, ci, type, s, lat }`.
- Hole radii and the damage calculation (`holeHalfWidth`, `holeHalfLength`, `holeDamage` in `road.js:92–117`):
  - `holeHalfWidth(T) = max_{e ∈ T.ells}(|e[0]| + max(e[2], e[3]))` (for `sinkhole`: `max(1.35, 0.8 + 0.65, 0.75 + 0.6) = 1.45 m`)
  - `holeHalfLength(T) = max_{e ∈ T.ells}(|e[1]| + max(e[2], e[3]))` (for `sinkhole`: `1.35 m`)
  - The truck's axles are `AXLES = [2.2, -0.4, -11.5]` m (from the truck's centre), half-track `WHEEL = 1` m (`lat ± 1 m`), `CRAWL_SPEED = 3` m/s, `HOLE_REF_SPEED = 28` m/s, `REAR_AXLE_SHARE = 0.6`, `MIN_HURT = 0.3`.
  - For each wheel that falls inside the ellipses `T.ells` as axle `axle` passes (`0` — front, `1` or `2` — rear) at speed `v`:
    - If `v < CRAWL_SPEED` (`3 m/s`), the damage is `0`.
    - `sc = clamp(v / HOLE_REF_SPEED, 0, 1.2) ** 2 * (axle ? REAR_AXLE_SHARE : 1)`
    - `dmg = type.dmg * sc`
    - `holeDamage(type, v, axle) = dmg >= MIN_HURT ? dmg : 0`.

