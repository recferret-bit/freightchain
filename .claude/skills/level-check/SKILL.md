---
name: level-check
description: >
  Check that each FREE LEVEL of Freight Chain (EASY / CROSSROADS / HARD – client/js/trips.js free-1 / free-2 / free-3) is what its name promises
  and passable by a human: the road each level's shift covers (junctions, forks, lanes, the sharpest bend, sinkholes and whether a driver who reacts
  to the warning sign can still stop or steer round them), then a human-paced driver on the REAL truck handling with ASSIST off drives every level on
  many seeds × all five routes (reacts after ~1 s, takes bends gently, stops for red, waits for a gap at the depot exit, gives way when a fork's
  other road branches across the oncoming lane, takes the other road at every second fork) – finish rate, hull lost, vehicles hit, off-road time,
  each against the level's limits; exit 1 when a level breaks its promise. Use after changing a level's trip, the road generator, forks, holes,
  traffic or the truck's handling, when asked "is HARD too hard / is EASY easy", "can a person finish the free levels", or /level-check.
---

# Level check

The free ride is three **levels** (the lobby's picker; `client/js/trips.js` `free-1b` / `free-2b` / `free-3b`, the server's `server/src/domain/rides/ride-trip.ts`
`FREE_LEVELS`). Each one promises something – EASY is a first-timer's three minutes with exactly one crossroads, CROSSROADS has its four crossroads and a fork, HARD is fifteen minutes (six crossroads, two forks) with no assist
that a careful person still finishes. This skill checks those promises with the game's own modules, in Node (no browser, ~4 min for the default run).

```sh
node .claude/skills/level-check/check.mjs                       # all three levels × 6 seeds, each on ITS OWN country (ROAD + DRIVE), exit 1 on a broken promise
node .claude/skills/level-check/check.mjs --levels free-3b --verbose   # one level, every drive and every tight sinkhole listed
node .claude/skills/level-check/check.mjs --no-drive               # the road only (seconds)
TRACE=1 node .claude/skills/level-check/check.mjs --levels free-3b --no-road --seeds 11 --only brenner:87122   # replay ONE drive (--seeds ≥ the seed's k) (each drive is deterministic), a line per second
TRACE=2 …                                                          # …plus the cars within 80 m and the holes ahead every step
```
Options: `--seeds N` (6), `--routes level|all|route66,brenner` (default `level`: each level's own country – Stuart / Route 66 / Brenner), `--react 1.0` (the driver's reaction in s), `--care .8` (× the 2.2 m/s² lateral grip it takes bends at).

## What it checks – `LIMITS` at the top of `check.mjs`

| level | ROAD (on every seed × route, over the finish line × 1.4 + 200 m) | DRIVE (over all seeds × routes, ASSIST off) |
|---|---|---|
| `free-1b` EASY 3 min / 1260 m | exactly 1 crossroads, no fork, no sinkhole, ≥ 2 lanes each way, no bend under R 220 m | every drive finishes, median hull lost ≤ 10 %, no vehicle hit |
| `free-2b` CROSSROADS 6 min / 4.0 km | exactly 4 crossroads and ≥ 1 fork, no bend under R 90 m, no sinkhole TRAP | ≥ 90 % finish, median hull lost ≤ 35 %, the median drive hits no vehicle, a drive took the other road at a fork |
| `free-3b` HARD 15 min / 10.1 km | exactly 6 crossroads and ≥ 2 forks, no bend under R 55 m, no sinkhole TRAP | ≥ 75 % finish, median hull lost ≤ 60 %, the median drive hits ≤ 1 vehicle, a drive took the other road |

- **A sinkhole TRAP**: in the driver's own lane, on a one-lane-each-way stretch, and a driver who reacts `--react` s after its warning sign (`CFG.HOLE_WARN`
  m before it) cannot stop to a crawl at FULL pedal (`CFG.TRUCK.BRAKE`) from the speed the road allows there. It is only a trap when the oncoming lane is
  busy too – the driver can swerve round a lane-wide sinkhole into a free oncoming lane – so a trap fails the check, and **tight** (< 15 m to spare) is listed
  with `--verbose` but passes.
- The shift lengths are the OFFLINE ones (`trips.js` `seconds` / `k` = the server's at `FREE_RIDE_SECONDS` 180).
- "Finished" = the game's own `st.complete` (time AND distance); a drive that has not finished after 3 × its shift + 2 min is a `timeout`.

## Reading a failure

Run the failing level with `--verbose`, then replay one drive with `TRACE=2 … --only <route>:<seed>` and look at what happened in the last seconds.
Decide whether it is the ROAD (fix the trip / generator – `trip-design`, or the truck / traffic – `gameplay-balance`) or the DRIVER (this script's
`makeDriver` / `wheelFor`; it is a careful person, not a perfect one – don't tune it until a level passes, tune it until it drives like a person would).

What the driver does NOT model: traffic AI faults it cannot avoid (an oncoming car overtaking into its lane, an emergency vehicle squeezing past), so a few
HARD drives end in a pile of vehicle contacts – that is why the crash limit is on the MEDIAN drive. Known as of 2026-10-10 (6 seeds × 5 routes): EASY 30/30,
CROSSROADS 29/30, HARD 26/30; every lane-wide sinkhole on HARD / CROSSROADS stops only ~3 m short at full pedal from the governor (HOLE_WARN 90 m) – tight
for a 1 s reaction.

## After a change

A change to a level's trip, `PATTERNS`, `FORK`, the hole roll, `CFG.HOLE_WARN`, the traffic or `CFG.TRUCK` → run this skill (and `trip-design`'s
`measure.mjs` for the numbers per trip). Changing `LIMITS` = changing what a level promises: say so in the commit, and keep the lobby / whitepaper wording true.
