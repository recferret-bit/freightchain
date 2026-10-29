# Minigames v2: mandatory tasks, timers and real fuel (plan)

Origin: the security audit of 28 Oct, clusters 6 and 9 ([`SECURITY_AUDIT_2026-10-28_FIX_PLAN.md`](SECURITY_AUDIT_2026-10-28_FIX_PLAN.md) §4.9 and §6), plus the owner's decisions of 29 Oct.

**The goal is an anti-bot gate on paid rides.** A ride counts only if the driver passed every task the cab gave them, inside a timer, using the phone, and refuelled at a gas bay when the truck ran low.

This is a plan, not as-built behaviour. As-built stays [`docs/spec/minigames.md`](../spec/minigames.md) Part 1 until MG2-12 ships.

## 0. Where we start (as-built, verified 29 Oct)

| area | today | file |
|---|---|---|
| kinds | only `phone-sms` is issued | `backend/server/src/domain/minigames/kinds.ts`, `frontend/client/shared/minigame-kinds.js` |
| schedule | 2–4 arms by drive-seconds; first at 5 min, 8 min gap, 3 min end pad; scaled by `timeScale` | `domain/minigames/schedule.ts` |
| timer | 30 s (`more-time` 60 s), and it starts at **open**, not at arm | `kinds.ts` `WINDOW_MS`, `close.ts` |
| unopened task | `cancelled` in the end pad, with no score | `close.ts` `heartbeatStatus` |
| scoring | 3 tries; +20 s only after 3 wrong; a miss costs 0 | `score.ts`, spec MGM-M-06 |
| verdict | "minigames never fail a ride"; only `mg-unsafe-open` (flag) in `enforce`; and `judge` never receives the rows (SEC-14) | `domain/minigames/verdict.ts`, `verdict.service.ts:265` |
| ranking | `MG_WRONG_SECONDS 20`, `MG_MISSED_SECONDS 45`, but `rideResultOf` writes 0 | `domain/pool/pool-ranking.ts`, `application/rides/ride-result-of.ts` |
| MAC | shape check only (43 chars) | `domain/minigames/mac.ts` |
| fuel | **cosmetic**: `0.85 − 0.45·s/(2·COMPLETE_DIST) + tankBonus`, no effect on the truck | `frontend/client/js/state.js:47` |
| GULP | client landmark: pinned at chunk 2 (s ≈ 80), elsewhere a weighted random theme roll; the local 4-digit code in Messages is unscored | `js/themes/_shared/landmarks/index.js:63`, `js/phone/gulp-state.js` |
| server road | knows PIKE gates (`shared/toll.js`), **not** GULP bays | `frontend/client/shared/toll.js` |
| replay | the 10 Hz sample row carries `gas`, `gear`, `engineOn`, `v`, input bits; `ReplayPhysics` integrates the shared force law | `domain/verdict/replay-physics.ts`, `replay-engine.ts` |
| runtime knobs | `player.GameSetting` integer rows (`SETTING_KEYS`) changed by the signed admin API | `domain/settings/game-settings.ts` |

## 1. Rules decided by the owner (29 Oct)

1. **Mandatory.** A paid/ranked ride must pass **every** minigame it receives. Each failure is recorded. Failures are three wrong codes, the timer running out, or no stop for a gas task. Any failure, including "passed none", rejects the ride at the end with `mg-failed`. **The ride keeps going.** Paid rides go to admin review (admin override) and can be appealed. A failed task never adds time.
2. **Timer.** Each task has its own window, which **starts when the phone buzzes**. A countdown shows in the cab and on the phone. Windows are runtime `GameSetting` rows set through the signed admin API, and `more-time` multiplies them.
3. **Gas station.** The truck **really burns fuel** in the shared physics. Low fuel triggers the gas task, which is passed at a GULP bay.
4. **Ranking.** Formula v2 (SEC-01) has no minigame time. Passing everything is a precondition of `verified`.
5. **Telemetry.** Paid/ranked rides run `TELEMETRY_V21=enforce`, which provides the session key the minigame HMAC needs (SEC-14/15).
6. **Rollout.** `shadow` on devnet first, then `enforce` on devnet, then production only when the owner explicitly asks for a deploy.

## 2. Decisions D1–D8 (answered 29 Oct; MG2-00 done)

| # | question | decision |
|---|---|---|
| D1 | Where do functional GULP bays sit? | **A pure shared function like `toll.js`** (`shared/fuel-stops.js`: the first bay is pinned at s = 80, then one every `FUEL_STOP_EVERY` m on the driver's side). The client always draws a GULP there, and random themed `gulp` rolls become plain `gas` decor. Every bay apron counts as road on client and server (MG2-06). |
| D2 | The tank runs dry | **The engine dies and cannot restart.** The ride ends `out-of-fuel` (not completed, the same class as a lost hull). Fuel is sized so that a driver who answers the gas task always reaches a bay. |
| D3 | What triggers the gas task | **The real fuel level.** The server derives it from the samples; below `FUEL_RESERVE`, it arms the task for the next bay ahead. |
| D4 | Refuels in a 1 h shift | **Exactly 1** (tank ≈ 0.6 of a 1 h shift at governor speed). Free/tutorial rides start with enough fuel to finish and get no gas task. |
| D5 | Default windows | **phone-SMS 90 s**; **gas = time to the bay at 70 % of governor speed + 60 s**. Both ×2 in `more-time`, and both are `GameSetting` rows. |
| D6 | Timer clock | **Game time (drive-seconds); a pause stops the timer.** The window is stored as `deadlineDriveS` = the drive-second of the heartbeat that first carries the task + the window. The client counts down in game time. The existing pause rules (`pauseVerdict`, 3 pauses / 5 min) still cap pauses. Drive-time is bounded against wall time by `slowMotionVerdict`. While paused, the client hides the phone/task view, and a pause during an open task is listed in the task evidence. An answer is accepted up to `mg_net_grace_s` of wall time late if its MAC-bound `submitStep` is inside the window. |
| D7 | Number of phone-SMS tasks | **Keep 2–4 per 1 h shift** (weights 25/50/25 %, first after 5 min, ≥ 8 min apart), plus the gas task. |
| D8 | Old challenge channel (`CHALLENGE_KINDS`, `prompt.js`) | **Retired in the spec.** The table stays empty; minigames are the only liveness check. The code stays dormant until a cleanup removes it. |

## 3. Issues

Order: **MG2-00 → 01 → (02 prerequisites) → 03 → 04 → 05 ∥ 06 → 07 → 08 → 09 ∥ 10 → 11 → 12.** Waves, lanes, file ownership and status: [`SECURITY_MG2_ORCHESTRATOR.md`](SECURITY_MG2_ORCHESTRATOR.md).

Common DoR (every issue): the decisions above are recorded; topic docs are read (`docs/spec/minigames.md`, `anticheat.md`, `docs/agents/gameplay.md`, `world.md`); the work happens in its own worktree.

Common DoD (every issue):
- `npm run check` is green. Server changes also pass `npm run server:integration`. Client changes pass `node tools/e2e-chrome.mjs`, and its screenshots are read.
- Pyramid: a unit spec per handler/service/guard/adapter, an integration spec per PostgreSQL class, an HTTP scenario per new behaviour, a concurrency test per new critical section, a forward-only migration with every Prisma change.
- Shared road/physics changes ship with the server port in the same commit.
- No deploy.

### MG2-00 — Owner decisions D1–D8 ✅ (29 Oct)
All eight are answered and written into §2.

### MG2-01 — Spec first (target decisions)
**Analysis.** The current spec says the opposite on three points: "a minigame never fails the ride" (MGM-M-06), "a miss adds no time", and "unopened = cancelled" (MGM-M-05). Tests lock as-built until the target's own change, so the target is written as a decision block, not as as-built text.
**Steps.**
1. `docs/spec/minigames.md`: add a "Part 0 — v2 target (decided 29 Oct)" section with §1 rules + §2 decisions and new `MGM-T2-*` test ids. Mark Part 1 as "as-built until MG2-12".
2. `docs/spec/anticheat.md`: reason `mg-failed` (reject, admin-overridable, appealable). `out-of-fuel` ride end. Fuel-derivation checks (MG2-07). Retire the challenge channel (D8).
3. `docs/agents/gameplay.md`: fuel model, tank, refuel, engine death.
4. `docs/agents/world.md`: functional GULP bays from `shared/fuel-stops.js`.
5. `docs/spec/pool.md`: formula v2 has no minigame time; `verified` requires every task passed.
6. `docs/spec/DECISIONS.md`: one entry per §1 rule and §2 decision.

**DoR.** MG2-00 is done.
**DoD.** The spec PR is merged before any code. `PRODUCT.md` is **not** changed yet. Every rule has a test id that later issues cite.

### MG2-02 — Prerequisites from the security plan
**Analysis.**
- MG2 rejects rides on minigame outcomes, so those outcomes must be trustworthy first.
- SEC-15 provides the per-ride session key (telemetry v2 `enforce` on paid starts).
- SEC-14 provides the locked `sync`, the real answer HMAC, and rows that actually reach `judge`.
- SEC-01 provides formula v2 (no minigame time) and the `RideResult` refresh when an admin override happens.

**DoR.** None beyond the common DoR.
**DoD.** SEC-01, SEC-14 and SEC-15 are merged and green on devnet in `shadow`.

### MG2-03 — Window settings and per-ride stamping
**Analysis.** Windows are runtime knobs (AGENTS.md: runtime knobs are `GameSetting` rows, not env). A change mid-ride must not move a running driver's deadline.
**Steps.**
1. `SETTING_KEYS` += `mg_window_phone_sms_s` (default per D5), `mg_window_gas_extra_s`, `mg_more_time_pct` (200), `mg_net_grace_s` (10), each with min/max bounds.
2. On `/start`, stamp the resolved windows onto the ride (a new `Ride.mgWindows` JSON column + migration). Every later read uses the stamp.
3. Admin page: the settings rows appear in the existing signed settings tab. Run the `admin-coverage` skill.

**DoR.** D5 and D6 decided.
**DoD.**
- Settings spec (bounds, fallback to default).
- Integration spec: a stamp survives a settings change mid-ride.
- `admin-coverage` is green.
- The migration is in the same commit.

### MG2-04 — Server: mandatory rule, timer from the buzz, no cancelled state
**Analysis.**
- Today the timer starts at open, and an unopened task is `cancelled` with no consequence. A bot can simply never open anything.
- v2: the window runs in game time from the buzz (`revealedDriveS` = the drive-second of the heartbeat response that first carries the task; a pause stops it, D6). Any task that is `failed` when the ride is judged rejects it. A task still inside its window at an honest finish is `void`.

**Steps.**
1. `RideMiniGame` status model:
   - `armed → revealed` happens on the **first heartbeat response that carries the task**. It stores `revealedDriveS`, and the response sends `deadlineDriveS` (D6: game time, a pause stops it);
   - then `→ passed | failed(wrong) | failed(timeout) | void` (`void` only for an honest completion inside the window, step 6);
   - remove `cancelled`; old rows keep their value, so readers must still accept it.
2. The scheduler fits windows against **distance**, because a shift completes the moment the line is reached (`completeDist`), not on a clock:
   - arm a phone-SMS only while `(completeDist − s) / governor speed` still exceeds the full window (stamped, × `more-time`) plus the end pad;
   - never arm a gas task for a bay at or past the finish line;
   - if a task does not fit, do not arm it, rather than arming and cancelling.
3. `close.ts` / `sync`: expire `revealed` tasks whose heartbeat drive-seconds passed `deadlineDriveS` (plus `mg_net_grace_s` of wall time for the answer in flight) → `failed(timeout)`, under the player lock (SEC-14).
4. `score.ts`: three wrong → `failed(wrong)`, with **no `penaltyS`** (the v2 rules version).
5. `verdict.ts`: `minigameVerdictDelta` in `enforce` returns `mg-failed` (severity `reject`) when any task is `failed`. The evidence lists `{ordinal, kind, outcome}`. `shadow` adds the same reason as `flag`, so false positives can be measured.
6. Ride-end close-out:
   - An honest completion (the line reached) marks a task still **inside its window** as `void`: not counted, not failed. Tasks already past their deadline are `failed(timeout)`.
   - The stale-ride sweeper and an abandoned ride close every open task as `failed(timeout)`.
   - Every path that ends a ride runs this close-out before `judge`.
7. Bump `MG_RULES_VERSION` to `mg:v2`, stamped per ride. A v1 ride is judged by v1 rules.

**DoR.** MG2-01, 02, 03 are done.

**DoD.**
- Unit specs: schedule fit, status machine, scoring with no penalty, verdict for all passed, one wrong-fail, one timeout, none passed, and `shadow` → flag.
- **Concurrency tests:** heartbeat expiry ∥ a correct answer inside the grace; two answers in parallel.
- HTTP scenarios:
  - an answer after the deadline + grace → `410 mg_expired`;
  - completion with a task inside its window → `void`, ride `verified`;
  - an abandoned or swept ride with an open task → `mg-failed`.
- The stale-ride sweeper closes tasks.
- Admin override of an `mg-failed` ride → `verified`, and `RideResult` is refreshed.

### MG2-05 — Client: buzz, countdown, phone-SMS under a timer
**Analysis.** The driver must see the time left at a glance while looking for a place to stop. The cab and the phone show the same deadline.
**Steps.**
1. Heartbeat client (`js/net/…` / `online.js`): read `minigames[].deadlineDriveS` and count down against the game's own drive-time, which freezes on pause. Hide the phone/task view while paused (D6).
2. Phone: on a new task, vibrate + play a sound (the `game-audio` skill for the sfx) and show a countdown badge on the Messages icon and a timer bar in the SMS thread.
3. Cab: a small countdown chip on the binnacle/HUD while any task is open, red under 15 s. Read the canvas size from the `view` object.
4. The answer POST carries the HMAC (SEC-14) and `submitStep`. Show passed / wrong-tries-left / failed in EN and RU.
5. Spectator replay (`watch.js`): show the task chips and outcomes from the recording.

**DoR.** MG2-04's DTO is merged (the `deadlineDriveS` contract).

**DoD.**
- Chrome `controls` suite: a buzz → stop → correct code inside the timer; a timeout → failed chip. The screenshots of both timers are read.
- The `replay-test` skill shows the chips in a replay.
- EN/RU strings are in the i18n files.
- Tell the owner what to eyeball: buzz feel, timer readability while driving.

### MG2-06 — Shared fuel model and functional GULP bays (client)
**Analysis.** Fuel must be physics, not a gauge, so that the server can derive it. `shared/physics.js` is the shared force law, and fuel joins it as a separate pure module so the force law stays untouched.
**Steps.**
1. `frontend/client/shared/fuel.js` (pure, re-exported by `@freightchain/shared`):
   - `burn(state, dt)`: litres from `gas × rpm` plus idle while `engineOn`;
   - `TANK_L`, `FUEL_RESERVE`, `refill(level, choice)`;
   - `FUEL_RULES_VERSION`.
2. `frontend/client/shared/fuel-stops.js` (D1), modelled on `toll.js`: `FUEL_STOP_FIRST = 80`, `FUEL_STOP_EVERY`, `nextFuelStop(s)`, `fuelStopsBetween(s0, s1)`, plus the bay's lateral extent for the "at the bay" test.
   - **Every bay apron is road, on both sides.** Today only the pinned bay is road:
     - client: `shared/road-network.js:181` (`s 57–103, 0 < d ≤ 10.2`);
     - server: the pinned bay is covered only because `s < knownFrom` returns `null`. `backend/server/src/domain/road/road-layout.ts` `onRoad` has no apron rule.
   - Add one `onBay(s, d)` to `fuel-stops.js`, and call it from both `RoadNetwork.onRoad` and `RoadLayout.onRoad` in the same commit (the off-road rule is a port change). Otherwise a 60 s honest refuel is off-road and trips `OFFROAD_FAIL_SECONDS = 20`.
3. Client:
   - `state.js` keeps the real level in `st.fuel`, burning in the sim step;
   - an empty tank sets `engineOn = false`, and the key cannot restart it (D2);
   - the gauge reads `st.fuel`, and `tankBonus` is removed;
   - the landmarks force a GULP at `fuelStopsBetween` and turn random `gulp` rolls into `gas` decor;
   - `chunks.js` keeps props off the bay apron.
4. Tunables in `js/config.js` (mirrored in `shared/simulation-config.js` where the server needs them). Size them with the `gameplay-balance` skill to D4. The `trip-design` skill checks that the free levels need no refuel.

5. Stamp `WORLD_RULES_VERSION` / `FUEL_RULES_VERSION` per ride. Bays at fixed `s` and the demoted random `gulp` rolls change the landmark layout of existing seeds, so a ride started before the release keeps the old layout and rules. Historical replays render with their stamped version.

**DoR.** MG2-01 merged (fuel rules in `gameplay.md`). D1, D2 and D4 decided. Check what the headless trace records (`tools/trace.sh`). If it covers landmarks, the `trace:diff` bar below is "fuel/engine fields plus the expected bay/landmark changes, listed in the commit".

**DoD.**
- `npm run trace:save` before and `trace:diff` after: every difference is explained (fuel/engine fields, plus forced bays if the trace covers landmarks).
- `road-drift.spec.ts`: client and server agree that every bay apron is road.
- `npm run test:parity` passes (landmark builders).
- The `level-check` skill: EASY/MEDIUM/HARD still pass on all routes and seeds, with no refuel needed.
- The `gameplay-balance` numbers are recorded: litres per minute at cruise, the 1 h shift needs exactly one refuel.
- Chrome screenshots of the bay and of an empty-tank engine death.
- The user-tuned constants (`SHAKE_*`, `START_ENGINE_OFF`) are untouched.

### MG2-07 — Server: derive fuel from the recording and verify it
**Analysis.**
- Recorded sample columns are append-only and input bits are frozen, so fuel must be **derived** from the existing columns (`gas`, `engineOn`, `v`, and rpm if recorded, else bounded from gear/speed), not trusted from the client.
- An optional client fuel column may be appended, for cross-checking only.

**Steps.**
1. `domain/verdict/fuel-replay.ts`:
   - integrate `burn` over the 10 Hz rows, using a **lower bound** of burn (so the driver gets the benefit of the doubt);
   - apply refuels only from `passed` gas tasks at their bay `s`.
2. Checks (in `world-checks.ts` or a new module):
   - `fuel-empty-running`: derived fuel ≤ 0 while `engineOn` or `v > 0.5` for ≥ 3 s. **Reject** in `enforce`, flag in `shadow`.
   - `refuel-off-bay`: a refuel claim not at a bay, or not stopped.
3. `ReplayEngine` output gains `fuelMinL` and the refuel points, so admins see them in the review UI.
4. Ride end `out-of-fuel` (D2): the client ends the shift and the server accepts this reason only when derived fuel ≤ reserve.

**DoR.** MG2-06 merged. D2 decided. Read `docs/spec/anticheat.md` replay section.

**DoD.**
- `replay-engine.spec.ts`, `road-drift.spec.ts` and `traffic-sim.spec.ts` are green.
- New fixtures in `backend/server/test/fixtures/simulation/`: an honest refuel, a fake "never refuel", and engine on with an empty tank.
- A fixture that stops for 60 s on a non-pinned bay apron produces **0 off-road seconds**.
- The `ride-audit` skill re-judges the fixtures identically.
- `verified-play-test` gains the "no-refuel bot" negative case.

### MG2-08 — Gas task (server kind + client GULP app)
**Analysis.** The gas task replaces the local GULP digits with a server-issued, MAC-bound task. It can be opened only when the server's last heartbeat puts the truck stopped inside a bay's extent.
**Steps.**
1. Kinds: `gas` joins `MINIGAME_KINDS` + `MINIGAME_ACCEPTED` (shared + server, kept equal).
2. Arming (in `sync`): when the derived or heartbeat-reported fuel is below `FUEL_RESERVE` and the next bay is ahead, arm `gas` for that bay with window = D5. At most one gas task is open at a time.
3. Open: refused unless the last heartbeat has `v < 0.5` for ≥ 2 s and `|s − bayS|` is inside the extent (server state, not `cmd.safe`). The payload is a pump picture with a server code (SVG asset, like phone-SMS) plus a fill choice.
4. Answer: correct code → `passed` + the refuel amount stored on the row (MG2-07 reads it). Wrong ×3 or timeout → `failed`.
5. Client `phone/apps/gulp.js` + `gulp-state.js`: drop the local `mulberry32` code and drive the app from the server task. The pump UI stays.

**DoR.** MG2-04 and MG2-07 merged.

**DoD.**
- Unit specs: arming, open refused off-bay or moving, scoring, refuel amount.
- HTTP scenarios: open while moving → 409; the right code → refuel.
- **Concurrency test:** a gas open ∥ a heartbeat.
- Chrome `controls` suite: low fuel → buzz → stop at the bay → pump code → tank full → drive on.

### MG2-09 — Admin review and appeals
**Analysis.** Mandatory rejects on paid rides go to admin review. Admins need the evidence, and a human who failed by accident needs a path back.
**Steps.**
1. The admin ride view lists each task: kind, buzz time, deadline, stop time, answer attempts, outcome, MAC ok, and the fuel curve (MG2-07).
2. The override path stays the signed verdict override (SEC-03 approver signature in dual mode).
3. Appeals: `mg-failed` rides are appealable through the existing `ride-appeal` flow.
4. The `ride-review` skill lists `mg-failed` with the task table.

**DoR.** MG2-04 and MG2-08 merged.
**DoD.**
- `admin-coverage` is green.
- An HTTP scenario covers override → `verified` + `RideResult` refresh.
- Admin page checked in Chrome.
- `docs/agents/admin-ops.md` updated.

### MG2-10 — Ranking and stored results
**Analysis.** Formula v2 already has zero minigame time (SEC-01). `RideResult` should still store the counts for review and stats.
**Steps.**
1. `rideResultOf` writes `mgTotal/Passed/Wrong(failed)/Missed(timeout)` from the rows. `mgPenaltySeconds` stays 0 under v2.
2. `finished` requires `verified`, which now implies every task passed.

**DoR.** MG2-04 merged.
**DoD.** Unit specs for `rideResultOf` and an integration spec for the stored counts. Pool payout in `localnet-e2e` still produces exact prizes.

### MG2-11 — End-to-end acceptance
**Steps.**
1. `verified-play-test`:
   - a person in Chrome passes every task → `verified`;
   - a metronome bot that ignores tasks → `mg-failed`;
   - an API bot with a valid physics recording and no answers → `mg-failed`;
   - a no-refuel bot → `fuel-empty-running`.
2. The E2E-08 minigame suite is updated to v2 (`MGM-T2-*`).
3. `bash .claude/skills/run-tests/e2e.sh normal-drive`: a full MEDIUM 1 h shift with 2–4 SMS + 1 refuel.
4. `node backend/server/scripts/normal-drive-localnet.mjs` (paid 1 h on a scratch validator) gets the PIKE-style direct handlers for SMS and gas.

**DoR.** MG2-05 … MG2-10 merged.
**DoD.**
- All of the above are green.
- `npm run test:ci:full` is green.
- Tell the owner plainly what was and wasn't verified (feel, timer pressure, fuel pacing need a human drive).

### MG2-12 — Rollout and as-built docs
**Steps.**
0. Operator: generate `MG_SECRET` (≥ 32 bytes) for devnet and production. Today it is unset, and `MINIGAMES` ≠ off refuses to boot without it (`env.schema.ts:217`). Record it by key name only, and add it to `OWNER_TASKS.md`.
1. Devnet `MINIGAMES=shadow` + `TELEMETRY_V21=shadow`. Measure on human rides: the share of `mg-failed` (flag) per shift, timeouts per kind, and median stop-to-answer time. Tune D5 windows through settings.
2. When the owner accepts the false-positive rate, switch devnet to `enforce`.
3. Production only on an explicit owner deploy request (`docs/agents/deploy.md`).
4. Move Part 0 to as-built in `minigames.md`, and update `PRODUCT.md`, `anticheat.md`, `gameplay.md`, `world.md`, README/AGENTS/CLAUDE where commands or paths changed, and `docs/testing/LOCAL_READINESS.md`.

**DoR.** MG2-11 is green.
**DoD.**
- The devnet measurement is recorded with numbers in `LOCAL_READINESS.md`.
- The owner's sign-off on the false-positive rate is recorded.
- The docs are as-built.
- Readiness is stated as "`npm run deploy` would ship it", with no deploy done.

## 4. Risks that stay after v2

- **Vision-model bots** can read the SVG and type the code (spec admission, `minigames.md` §13). v2 stops scripted and headless-replay bots, not a screenshot → model → keypad loop. The manual top-20 review (POOL-M-07) remains the last line.
- **Human false positives.** A mandatory rule turns a typo streak or a missed buzz into a reject. The admin override, appeals and the `shadow` measurement in MG2-12 are the mitigations. Do not skip the measurement.
- **Network loss** during a window becomes a timeout. `mg_net_grace_s` plus the MAC-bound `submitStep` cover short drops, not long outages.
- **Tier coverage.** Only `1h` is eligible (MGM-M-01). `4h`/`8h` must get v2 before going on sale.
