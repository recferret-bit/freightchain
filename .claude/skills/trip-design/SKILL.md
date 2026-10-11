---
name: trip-design
description: >
  Create and tune Freight Chain's gameplay TRIPS – what a ride's road is like per ride tier (the free run, the 1 h / 4 h / 8 h paid shifts):
  how much the road bends, how much and how aggressive the traffic is, how busy the roadside is, whether the shift ends by itself at the line,
  how long the shift is and how far it must go – measured with the real game modules (sharpest bend, time to complete, hull lost, hits) and
  checked in Chrome. Use when asked to make a ride tier easier / harder / friendlier / smoother, to change the free ride, to add or tune a trip
  or a difficulty ladder, "less curvy roads", "fewer cars", "make the free ride one minute", or /trip-design.
---

# Trip design

A **trip** is the road a ride is driven on, per tier: `client/js/trips.js` (`TRIPS`, `trip`, `setTrip`). The truck, the controls and the physics are the
same on every trip – that is `gameplay-balance`. A trip only shapes the world around the truck. Every knob is a multiplier on the `CFG` value it names,
so `'1h'` (all 1, `finish: false`) is the road as it was before trips existed – `__game.devRun()`, the headless trace, the e2e runs and the promo clips use it.

How a ride gets its trip: the SERVER stamps a trip id on every new ride from its tier (`server/src/domain/rides/ride-trip.ts` `TRIP_OF_TIER`, column
`Ride.trip`, `trip` in the ride and watch payloads; null = a ride from before trips = `'classic'`). A FREE ride's trip is its LEVEL's (`ride-trip.ts`
`FREE_LEVELS`, `level` on `POST /api/rides`, default 1): 1 EASY `free-1c` · 2 MEDIUM `free-2c` · 3 HARD `free-3b` (2026-10-11; the retired `free-1` / `-2` / `-3` / `-1b` / `-2b` and the one-minute `free` are frozen for old rides); the offline guest run is `free-g`. `main.js` calls `setTrip(tripOf(online.ride))` (a lobby
ride), `setTrip(tripOf(watch.ride))` (a replay / live view – it rebuilds the road the driver had) or `__game.devRun(id)` / `setTrip(id)` (the console, for tuning; a row with
`seconds` / `k` – the free trips – also sets the offline shift) – always BEFORE the road is reset (the curvature is integrated into `road.js` tables on `net.reset`).
Console: `__game.trip`, `__game.setTrip('8h')` then `__game.startRide()`.

## The knobs (client only, except `holesFrom` and `road` – the server judges those)

| knob | reads it | what it does |
|---|---|---|
| `bends` | `net/network.js` `curv()` | × the route's curvature. Geometry only – the judge works in road coordinates (s, d) |
| `traffic` | `sim/traffic.js` | × `CFG.TRAFFIC_MAX` on the main road, ÷ `CFG.TRAFFIC_GAP`; below 1 also fewer cars waiting at the depot exit |
| `cross` | `sim/traffic.js` | × `CFG.CROSS_MAX` on a signalled crossroads' side roads (0 = empty side roads) |
| `calm` | `sim/traffic.js` `pickType`, `spawnRandom` | only `cruise` / `slow` behaviours spawn: no tailgaters, weavers, overtakers, sirens; a car that would come up from behind spawns ahead instead (the density stays what `traffic` asks) |
| `props` | `world/chunks.js` | × the route's roadside scenery density (`props.js` `density`) |
| `start` | `net/network.js` (`net.straight`), `world/junctions.js`, `world/roadmesh.js`, `world/depot.js`, `sim/traffic.js` | `'depot'`: the depot road meets the main road at a STOP line and the truck turns right (traffic both ways past the exit). `'straight'`: no turn – the depot road runs straight on into the main road, no junction drawn, no main road behind the exit, no traffic coming down the depot road. Road coordinates (`sA`, `Sm`, the start junction in the data, holes from `Sm + HOLE_FIRST`) stay the server's; it does not judge the start area (`road-layout.ts` `knownFrom`) |
| `seconds`, `k` | `main.js` (guest run only) | a free trip's shift when played as the guest (`free-g` = 2 min; `devRun(id)` sets it for any trip): `RIDE_MIN_SECONDS` and `COMPLETE_DIST = k × 28 × seconds`. Online the server's ride sets both; `ride-trip.spec.ts` pins them to `FREE_RIDE_SECONDS`' default × the level's `multiple` and its `k` (`free`: `FREE_COMPLETE_DIST_K`) |
| `holesFrom` | `net/obstacles.js` `rollHole` + the SERVER's `road-rules.ts` `TRIP_HOLE_FIRST` | metres of main road before the first natural sinkhole (default `CFG.HOLE_FIRST` 150). JUDGED: the server's obstacle plan for a ride uses its trip's number (`roadPlanFor(seed, ride.trip)`), so change both together – `road-drift.spec.ts` compares them seed by seed. `free` / `free-1`: 1200, beyond what a one-minute run can reach; `free-2`: 400; `free-3`: the default |
| `road` | `net/network.js` (layout) + `net/obstacles.js` (hole chance) + the SERVER's `road-rules.ts` `TRIP_ROADS` | the LAYOUT, JUDGED: `first` = the patterns the road opens with (default `['country']`; the first stretch tapers out of the depot's 1+1 road), `weights` = the pattern weights after them (replaces the route's; `dual` = four lanes, no junctions, `fork` = a fork), `holeChance` = × `CFG.HOLE_CHANCE`, `firstLen` = [min, max] m of the first pattern (default [500, 1100]). EXACT crossroads counts: `first` lists fixed 500 m stretches – `xroad` (1+1) / `xroad4` (2+2) hold exactly ONE crossroads, `open` none (net/patterns.js; the free levels' `free-*b` rows, proven per trip in `road-drift.spec.ts`) – and a `weights` with no junction pattern after them keeps the count exact; keep every crossroads before the finish line (K × 28 × seconds). Absent = the default layout (every old trip) |
| `level`, `assist` | `trips.js` `FREE_LEVELS` (drift-tested against the server's `ride-trip.ts` `FREE_LEVELS`; the lobby's picker comes from `GET /api/tiers`), `main.js` (`assist: false` forces ASSIST off) | which free level a trip is, and whether ASSIST may be on – the server's `FREE_LEVELS` decides (HARD: 409 `assist_not_allowed`); `ride-trip.spec.ts` holds both tables together |
| `finish` | `sim/physics.js` (the `st.complete` line) | the shift ends by itself as a WIN (green `winFx` stamp, `ui/fail-fx.js`) the moment it is complete; otherwise the road goes on until P → END SHIFT |

The shift **length** and **finish line** are the server's, stored on the ride when it is created: `FREE_RIDE_SECONDS` (env, default 180 = the EASY level's length – four places, see
`docs/configuration.md`; production's `deploy/.env` sets it too – it MUST read 180 there), the paid lengths in `server/src/domain/rides/ride-tier.ts`, the distance in
`server/src/domain/rides/ride-rules.ts` (`completeDist` = K × 28 m/s × seconds; `COMPLETE_DIST_K` 0.5 for paid, `FREE_COMPLETE_DIST_K` 0.25 for the old free run). A free LEVEL's shift is
`FREE_RIDE_SECONDS` × its `multiple` and its K its own (`ride-trip.ts` `FREE_LEVELS`: EASY × 1 / 0.3 = 180 s · 1512 m, MEDIUM × 5⁄3 / 0.4 = 300 s · 3360 m, HARD × 5 / 0.4 = 900 s · 10 080 m; `freeLevelSeconds` rounds to whole seconds).
`client/js/online.js` copies both onto `CFG`; `devRun(id)` keeps `CFG.RIDE_MIN_SECONDS` for a trip without `seconds`.

**A trip id is frozen once rides carry it** (replays rebuild the road by id): to change a shipped trip, add a new row here and in `ride-trip.ts`
(`TRIP_IDS`, then `TRIP_OF_TIER` → the new id) and leave the old row as it is. `'classic'` is the road before trips – never change it.
`server/test/unit/domain/ride-trip.spec.ts` holds the two lists, and the free trips' `seconds` / `k` / `level` / `assist`, together with the server.

## Out of bounds – and the two knobs the server judges

The server rebuilds the layout and the sinkholes from the seed AND the ride's trip and measures every recording against them (`server/src/domain/road`,
`verdict/world-checks.ts`, docs/agents/verified-play.md "Verified play"). Two trip knobs are therefore JUDGED and live on both sides: `holesFrom` (`road-rules.ts`
`TRIP_HOLE_FIRST`) and `road` (`TRIP_ROADS` / `tripRoadOf`, read by `new RoadLayout(seed, trip)` and `roadPlanFor(seed, trip)` at its call sites –
`get-road-plan`, `upload-batch`, `ride-audit`); `road-drift.spec.ts` runs every trip's layout seed by seed and fails on a difference. Change both sides in
one commit, and only on a NEW trip id – an old ride must keep the road it was judged on. A new pattern is APPENDED to `PATTERNS` on both sides (the
generator walks them in order) with weight 0 everywhere except the trips that ask for it, or the frozen trips' layouts move.
Still NOT trip knobs: junction spacing / signals inside a pattern (`net/patterns.js`), the `HOLES` damage, the depot (`START_ACCESS`), `FORK`'s numbers
(`len`, `commit`, `corridor` – mirrored in `road-rules.ts`; the judge's fork apron), `OFFROAD_FAIL_SECONDS`, `MAX_SPEED`, prompt timing. A client that drew
fewer holes than the server's plan would be judged as driving through holes without damage. Making one of them per tier means the value in the trip AND
in `road-rules.ts`, the drift spec per trip, and a new trip id. Say that to the user instead of doing it quietly.

**Forks** (`fork` in `road.weights` / `road.first`; net/patterns.js `FORK`): the road splits into two MIRROR-IMAGE roads that meet again 1200 m on – one
road in (s, d), so the server never needs to know which one the driver took; the truck commits to the nearer road at 205 m, the recording's column 15
says which, a replay follows it. docs/agents/world.md "Road network" → Forks. The old trips (classic / free / 1h / 4h / 8h) have none; forks on a paid tier = new trip ids.

## Workflow

1. Read `client/js/trips.js` and the ask. Words like "twice" and "25 % more" apply to the current multiplier.
2. Measure before (repo root):
   ```sh
   node .claude/skills/trip-design/measure.mjs                                   # every trip: ROAD on all routes + a DRIVE on route66, each trip its own shift
   node .claude/skills/trip-design/measure.mjs --trips free-g,free-1c,free-2c,free-3b --seeds 9   # the guest run + the free levels (120 s · 840 m, 180 s · 1512 m, 300 s · 3360 m, 900 s · 10 080 m)
   node .claude/skills/trip-design/measure.mjs --trips 1h,4h,8h --seconds 300 --drive-route brenner --no-road
   ```
   ROAD = per trip × route over `--km` (6) of road and `--seeds` (5): how far the road runs straight from the depot (`straight m` – the depot turn counts), the sharpest bend (min radius), % of road tighter than 150 m, mean |curvature|, and
   junctions / signals / holes per km – those three are the seed's and the trip's `road` (the same for every trip without one; the free levels differ on purpose). DRIVE = a scripted driver from the depot to
   COMPLETE – each trip's own shift (a free trip's `seconds` / `k`, else 60 s and `COMPLETE_DIST_K`; `--seconds` / `--k` override every trip): game seconds, metres, hull lost, vehicle / building hits, off-road seconds, failures. It is an
   experienced driver with the headless test's handling (it pops the clutch): a first-timer takes longer. Compare trips with it, never quote it as a player's time.
   `--k 0.001` = how far the driver gets in `--seconds` (the distance a finish line can ask for).
3. Change the trip row (or add one: a `TRIPS` key + where it is chosen; a new tier is also the server's `ride-tier.ts`). A new knob = its reader + a row in
   the table above + the comment in `trips.js`; a multiplier of 1 must leave the code path bit-identical.
4. Check:
   - `cd client && npm run check`, then `npm run trace:diff` against a `trace:save` from before – a change to a non-default trip must say **trace identical**
     (the trace drives `'1h'`); a change to `'1h'` moves it on purpose – say so.
   - Measure again; report before → after.
   - Look at it in real Chrome: `node .claude/skills/trip-design/shots.mjs` (needs the game served: `cd client && ./serve.sh`, or `BASE=`) – each trip
     on two routes from the same seed, the start of each trip (`start-*.png`) + the stamps (`trip-*.png`, `win-stamp.png`, `fail-stamp.png` in the dir it prints). Read the screenshots. Grass with the
     lane lines on it where the asphalt should be is headless Chrome's software GL z-fighting the road against the ground (docs/agents/media.md "Promo videos"), not
     the trip: hide the ground plane to confirm, and have a person look on a real GPU.
   - Server touched (length / finish line): `npm run check` (root) and `npm run server:integration`; the whitepaper's tier table (`landing/whitepaper.html`
     "THE FOUR KINDS OF SHIFT", pinned by `landing/test/whitepaper.test.js`).
   - A free trip's `road` or `holesFrom` changed: `npm run server:test` (`road-drift.spec.ts`) – it is judged; `node tools/e2e-chrome.mjs` (`level-easy.png`, `fork-*.png`).
   - The free run's `finish` changes e2e flows: scripts that drive past completion set `__game.trip.finish = false` (`e2e-close.mjs`, `e2e-road-check.mjs`).
     After changing it run `bash .claude/skills/run-tests/e2e.sh browser close road verified`.
5. Report: trip, knob, old → new, the measure before → after, what the screenshots show, and what only a person can judge (does the free run feel
   gentle, is 8 h hard but fair). Stop at the commit – no deploy.
