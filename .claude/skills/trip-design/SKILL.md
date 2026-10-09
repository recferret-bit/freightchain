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
so `'1h'` (all 1, `finish: false`) is the road as it was before trips existed – offline `play.html`, the headless trace, the e2e runs and the promo clips use it.

How a ride gets its trip: `main.js` calls `setTrip(online.ride.tier)` (a lobby ride), `setTrip(watch.ride.tier)` (a replay / live view) or
`setTrip(?trip=…)` (offline, for tuning) – always BEFORE the road is reset (the curvature is integrated into `road.js` tables on `net.reset`).
Console: `__game.trip`, `__game.setTrip('8h')` then `__game.startRide()`.

## The knobs (client only – the server never sees them)

| knob | reads it | what it does |
|---|---|---|
| `bends` | `net/network.js` `curv()` | × the route's curvature. Geometry only – the judge works in road coordinates (s, d) |
| `traffic` | `sim/traffic.js` | × `CFG.TRAFFIC_MAX` on the main road, ÷ `CFG.TRAFFIC_GAP`; below 1 also fewer cars waiting at the depot exit |
| `cross` | `sim/traffic.js` | × `CFG.CROSS_MAX` on a signalled crossroads' side roads (0 = empty side roads) |
| `calm` | `sim/traffic.js` `pickType` | only `cruise` / `slow` behaviours spawn: no tailgaters, weavers, overtakers, sirens (nothing comes from behind) |
| `props` | `world/chunks.js` | × the route's roadside scenery density (`props.js` `density`) |
| `start` | `net/network.js` (`net.straight`), `world/junctions.js`, `world/roadmesh.js`, `world/depot.js`, `sim/traffic.js` | `'depot'`: the depot road meets the main road at a STOP line and the truck turns right (traffic both ways past the exit). `'straight'`: no turn – the depot road runs straight on into the main road, no junction drawn, no main road behind the exit, no traffic coming down the depot road. Road coordinates (`sA`, `Sm`, the start junction in the data, holes from `Sm + HOLE_FIRST`) stay the server's; it does not judge the start area (`road-layout.ts` `knownFrom`) |
| `finish` | `sim/physics.js` (the `st.complete` line) | the shift ends by itself as a WIN (green `winFx` stamp, `ui/fail-fx.js`) the moment it is complete; otherwise the road goes on until P → END SHIFT |

The shift **length** and **finish line** are the server's, stored on the ride when it is created: `FREE_RIDE_SECONDS` (env, default 60 – four places, see
`docs/configuration.md`; production's `deploy/.env` sets it too), the paid lengths in `server/src/domain/rides/ride-tier.ts`, the distance in
`server/src/domain/rides/ride-rules.ts` (`completeDist` = K × 28 m/s × seconds; `COMPLETE_DIST_K` 0.5 for paid, `FREE_COMPLETE_DIST_K` for the free run).
`client/js/online.js` copies both onto `CFG`; offline `?trip=` keeps `CFG.RIDE_MIN_SECONDS`.

## Out of bounds – the server judges these

The server rebuilds the layout and the sinkholes from the seed alone and measures every recording against them (`server/src/domain/road`,
`verdict/world-checks.ts`, AGENTS.md "Verified play"). So these are NOT trip knobs: pattern weights / junction spacing / signals (`net/patterns.js`),
`HOLE_CHANCE` / `HOLE_FIRST` / the hole roll / `HOLES` damage, the depot (`START_ACCESS`), `OFFROAD_FAIL_SECONDS`, `MAX_SPEED`, prompt timing. A
client that drew fewer holes than the server's plan would be judged as driving through holes without damage. Making one of them per tier means: the
value in the trip AND in `road-rules.ts`, `roadPlanFor(seed, trip)` at its call sites (`get-road-plan`, `upload-batch`, `ride-audit`), the drift spec
per trip, and the trip STORED on the ride (a migration; old rides must keep the road they were judged on). Say that to the user instead of doing it quietly.

## Workflow

1. Read `client/js/trips.js` and the ask. Words like "twice" and "25 % more" apply to the current multiplier.
2. Measure before (repo root):
   ```sh
   node .claude/skills/trip-design/measure.mjs                                   # every trip: ROAD on all routes + a 60 s DRIVE on route66
   node .claude/skills/trip-design/measure.mjs --trips free --k 0.25 --seeds 9  # the free run at its real finish line
   node .claude/skills/trip-design/measure.mjs --trips 1h,4h,8h --seconds 300 --drive-route brenner --no-road
   ```
   ROAD = per trip × route over `--km` (6) of road and `--seeds` (5): how far the road runs straight from the depot (`straight m` – the depot turn counts), the sharpest bend (min radius), % of road tighter than 150 m, mean |curvature|, and
   junctions / signals / holes per km – those three are the seed's, the same for every trip (context only). DRIVE = a scripted driver from the depot to
   COMPLETE (`--seconds`, `--k` = the distance factor): game seconds, metres, hull lost, vehicle / building hits, off-road seconds, failures. It is an
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
     lane lines on it where the asphalt should be is headless Chrome's software GL z-fighting the road against the ground (AGENTS.md "Promo videos"), not
     the trip: hide the ground plane to confirm, and have a person look on a real GPU.
   - Server touched (length / finish line): `npm run check` (root) and `npm run server:integration`; the whitepaper's tier table (`landing/whitepaper.html`
     "THE FOUR KINDS OF SHIFT", pinned by `landing/test/whitepaper.test.js`).
   - The free run's `finish` changes e2e flows: scripts that drive past completion set `__game.trip.finish = false` (`e2e-close.mjs`, `e2e-road-check.mjs`).
     After changing it run `bash .claude/skills/run-tests/e2e.sh browser close road verified`.
5. Report: trip, knob, old → new, the measure before → after, what the screenshots show, and what only a person can judge (does the free run feel
   gentle, is 8 h hard but fair). Stop at the commit – no deploy.
