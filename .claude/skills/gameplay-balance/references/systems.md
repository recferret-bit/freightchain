# Systems

Paths are from `client/` unless they start with `server/`, `landing/`, or `media/`. Narrative for each system is `docs/agents/gameplay.md` ("Gameplay systems", "Controls"), `docs/agents/world.md` ("Climate", "Day / night") and `docs/agents/client.md` ("Caveats"). This page is which file to edit, and what else must move.

Frame, from `docs/agents/client.md` "Conventions": heading forward is `(sinθ, 0, −cosθ)`; truck state is `s` along the spine, `d` lateral (+ right), `psi` heading error; `ds/dt = v·cosψ/(1 − k·d)`. `st.v` is speed ≥ 0; `st.vel` is signed (`st.rev` = reverse). `dt` is clamped to 0.05 s. The sim is floats and is not what the server re-simulates.

Debug handle `window.__game`: `st`, `CFG`, `input`, `startRide`, `tryShift`, `ignition`, `net`, `roads`, `holes`, `spawn`, `traffic`, `weather`.

## Shift length and the governor

| feel | owner |
|---|---|
| offline ride length, complete distance | `js/config.js` `RIDE_MIN_SECONDS`, `COMPLETE_DIST_K`. `COMPLETE_DIST` is derived on the next line: `K × MAX_SPEED × RIDE_MIN_SECONDS`. Complete = both time and distance (`sim/physics.js`, the `st.complete` line). The road does not end |
| online ride length | server sends `minSeconds` and `completeDist`; `js/online.js` writes them onto `CFG`. Free length: `FREE_RIDE_SECONDS` (60) × the free level's multiple (EASY 1 · CROSSROADS 3 · HARD 10), its distance the level's K (`ride-trip.ts` `FREE_LEVELS`; `FREE_COMPLETE_DIST_K` 0.25 = EASY and the old `free` trip, in `ride-rules.ts`). Paid: `server/src/domain/rides/ride-tier.ts`. The road per tier is `client/js/trips.js` (skill `trip-design`). Demo wallets shorten wall time via `timeScale`, not these constants |
| top speed | `CFG.MAX_SPEED` (forward), `CFG.REVERSE_MAX`. Applied at the end of the longitudinal step in `sim/physics.js` |
| how far off the asphalt before the ride fails | `CFG.OFFROAD_FAIL_SECONDS` (time off drains 2× once back on the road), `CFG.OFFROAD_DRAG`. Also a hard fail at `\|d\| > 80` in `physics.js` `update` — that `80` is a literal |

## Drivetrain

Owner of the step: `sim/physics.js` `update`. Gearbox constants: `js/state.js` `RATIOS` (index 0 is neutral), `REV_RATIO`, `K_RPM` (`rpm = K_RPM · v · ratio`), `IDLE`, `REDLINE`, `STALL_RPM`.

| feel | where |
|---|---|
| pull in each gear | `CFG.TRUCK.POWER / MASS × torque × (ratio / 1st) ^ GEAR_EXP`. 1st gear's thrust does not change with `GEAR_EXP` (`THRUST_REF` uses a fixed `ENGINE_BRAKE_EXP` of 0.4). A bigger `GEAR_EXP` only weakens taller gears |
| torque curve | `CFG.TORQUE_PEAK`, `TORQUE_LOW_W`, `TORQUE_HIGH_W`, `TORQUE_MIN`. Parabola, floored, and 0 above `REDLINE` |
| engine braking | fixed exponent 0.4 (`ENGINE_BRAKE_EXP` in `physics.js`, not `GEAR_EXP`). Coasting vs throttle uses the 0.85 / 0.15 split. Dead engine drag is the `1.6 / MASS` term |
| launch, stall | clutch slip holds rpm at `STALL_RPM × 0.8 + LAUNCH_RPM × gas × (1 − brake) × power ×` a factor that falls off above 2nd. Slip re-arms when the clutch is in or the box is in neutral. Stall: gear in, clutch engagement > 0.55, rpm < `STALL_RPM` for 0.12 s (`stallT`). `LUG_RPM` (900) is the labour threshold, a literal |
| shift | `tryShift`: clutch < 0.8 grinds; forward↔reverse needs `v < 0.8`; `SHIFT_TIME` holds the clutch in after the select |
| damaged or cold power | `(0.4 + 0.6 × hull/100) × (1 − COLD_POWER × coldK())` |
| useful km/h per gear | comment on `RATIOS` in `state.js`, repeated in `docs/agents/gameplay.md` "Gearbox". Recompute from `K_RPM` and `RATIOS` if either changes; do not hand-edit a remembered table |

Clutch and pedal approach rates (7 / 1.7, gas 3.5 / 5, brake 6) are literals in `update`. Name one in `CFG` only when you are changing it.

## Handling

`CFG.TRUCK`, read live from `sim/physics.js`. F2 (`js/ui/tuning.js`) writes the same object and saves `localStorage` `freightchain.truck`, which overrides the file in that browser.

`MASS` divides thrust, engine braking and `DRAG`. `BRAKE` is service-brake m/s² and is multiplied by 0 when the engine is off (`brakeEff()` fades it when hot). `PARK_BRAKE` is separate and works engine-off. `STEER_GAIN` is rad/m at speed; `STEER_GAIN_LOW` blends in below `STEER_LOW_V`. The comment on `STEER_GAIN` says what Brenner's tightest bend needs — stay above it. `YAW_LAG`, `CENTRIF`, `PITCH_GAIN`, `ROLL_GAIN`, `SWAY_HZ`, `SWAY_DAMP` are the body. `bodySway` uses the actual change of `vel`, so a truck held still by a brake does not dive.

Depot geometry: `CFG.START_ACCESS`, `CFG.START_TURN_R`. The turn is a balance problem (low-speed steer, truck width), not a mesh.

## Brakes, strain, cold, heat, battery

| feel | owner |
|---|---|
| brake heat and fade | `CFG.BRAKE_HEAT`, `BRAKE_COOL`, `BRAKE_COOL_AIR`, `BRAKE_FADE_FROM`, `BRAKE_FADE`. Heat integrates in `sim/climate.js`. `brakeEff()` in `state.js` is the force left |
| holding the brake in gear | `st.fight` in `physics.js`. `CFG.FIGHT_HEAT`, `FIGHT_TIME`. Full strain with `blownWhy = 'brakes'` ends the ride |
| redline abuse | `CFG.STRAIN_RPM` × `REDLINE`, `STRAIN_TIME`, `STRAIN_RECOVER`. Full strain blows the engine (`climate.js`) |
| cold power and cold wear | `coldK()` in `state.js` from `ENGINE_COLD` / `ENGINE_WARM`. Wear in `climate.js`: `COLD_WEAR × coldK² ×` how far rpm is above `COLD_WEAR_RPM`. Idle does not warm a very cold engine |
| warm-up, heater, frost | `ENGINE_HEAT_*`, `ENGINE_COOL*`, `THERMOSTAT`, `THERMO_GAIN`, `HEATER_*`. Ambient is the route's `weather` minus `NIGHT_CHILL × dn.k` (`ambientC()`). Frost draw is `cockpit/windscreen.js` from `FROST_RATE` / `FROST_MELT`; wipers do not clear frost |
| battery | `CFG.BATT` and `sim/battery.js`. Engine off multiplies drains by `OFF_X`. Key off and no loads recovers at `REST` up to `REST_MAX`. Below `DEAD` with the engine off sets `st.battLost` and `physics.js` ends the ride. `START_MIN` refuses a crank. Rates are test-scale; the comments on `BATT` state the resulting times — recompute the comment when you change a rate |
| washer | `CFG.WASH_DRAIN` per second of spray, tank `st.wash` 0..1, no refill |

## Damage, holes, traffic

| feel | owner |
|---|---|
| hitting a prop | `js/world/props.js` `KINDS`: `hp` is a speed² budget, `dmg` is hull % at 28 m/s, `slow` is the speed fraction lost when it breaks. `collide` / `hit` in `sim/damage.js`. `CFG.IMPACT_MASS` multiplies how fast props lose hp; `IMPACT_SLOW`, `IMPACT_BOUNCE`, `IMPACT_GLANCE`, `IMPACT_STALL_GRACE`. Hull % scales with `v² / 784`. A building is fatal. Reversing skips scenery (`collide` returns early) |
| hull consequences | power down to 40 % at 0 hull (the 0.4 + 0.6 factor above). Steering pull `st.pull` grows as hull falls. Hull 0 ends the ride. `GLASS_CRACK_STEP` / `GLASS_SCRATCH_STEP` add glass on top of impact cracks |
| road holes | `js/world/holes.js` `HOLES`: ellipses plus `dmg`, `slow`, `jolt`, `kick`, `crawl`. Only types with `cones` are placed (`IDS`). `CFG.HOLES`, `HOLE_CHANCE`, `HOLE_FIRST`, `HOLE_WARN`. `hitHoles`: each axle once, damage `dmg × (v/28)²` (rear axles × 0.6), no damage below 3 m/s. The `28` is a literal. Small pits can be straddled (`WHEEL = 1`) |
| traffic density | `CFG.TRAFFIC`, `TRAFFIC_MAX`, `TRAFFIC_GAP`, `CROSS_MAX`, `CROSS_GAP` |
| how fast / how heavy other vehicles are | `js/world/vehicles.js` `VEHICLES`: `v` is the cruise range in m/s, `mass`, `presets` weights. Behaviour multipliers: `PRESETS` in `sim/traffic.js` (`speed`, headway `T`, `over`, `weave`) |
| crash vs bump vs scratch | `CFG.CRASH_OVERLAP`, `CRASH_CLOSING`, `SCRATCH_DMG`. `contact` / `alignedContact` in `sim/traffic.js`. A direct hit returns a reason and `physics.js` calls `endRide` before the hull check. Bump damage is `bumpDmg` (mass × closing², capped). Do not write `st.s` on a fatal hit: the server treats a jump in `s` as a teleport |

Signal timing (how long you wait at a light): `CFG.SIGNAL_GREEN`, `SIGNAL_CROSS`, `SIGNAL_AMBER`, `SIGNAL_CLEAR`.

## Day, night, glare

Mostly presentation. Balance knobs if the ask is darkness or dazzle, not a mesh: `NIGHT_AMBIENT` (linear; the comment says what sRGB does to it), `NIGHT_CHILL`, `GLARE_*`, `HEADLIGHT_*`, `LAMP_RADIUS`, `LAMP_GAIN`, `CAB_DARK`, `HOOD_DARK`. Owned by `js/world/nightlight.js` and `js/world/daynight.js`. Per-route sun and `weather` are the theme folder (`js/themes/<route>/`), not `CFG`.

## Mirrors

Update these in the same change when you touch the constant. Re-read the test; it is the list of strings.

| you changed | also update |
|---|---|
| `MAX_SPEED` or `COMPLETE_DIST_K` | `server/src/domain/rides/ride-rules.ts` (same numbers). Verdict reject `over-governor` is `MAX_SPEED × SPEED_TOLERANCE` in `server/src/domain/verdict/verdict-rules.ts`. Heartbeat distance slack is `SPEED_SLACK` in `ride-rules.ts` — it is a judge tolerance, not the governor. Whitepaper sentences that quote the governor and the completion distance, then `npm --prefix landing test` |
| `RATIOS`, `K_RPM`, `IDLE`, `REDLINE`, `REV_RATIO` | `media/video/page.js` (it says it mirrors `state.js`). `KMH_AT_2000` in `landing/src/dash-scenes.js` and `landing/src/wp-scenes.js`. The gearbox sentences in `docs/agents/gameplay.md` "Gearbox" and the whitepaper gear / tach cards. `npm --prefix landing test` |
| a `HOLES` `dmg` / `slow` the whitepaper states for trench, pothole, or sinkhole | that sentence in `landing/whitepaper.html`. Prices stay in `server/src/domain/live/live-rules.ts`; do not change them for a damage tweak |
| a route id | `ROUTE_IDS` in `ride-rules.ts` |
| a comment in `CFG` that states a derived time ("flattens in ≈ N min") | rewrite the comment from the new rate |

`landing/test/whitepaper.test.js` fails when a quoted figure drifts from the source it names. Do not only edit the page.

A fatal traffic or prop change that can move `st.s` also concerns verified play (`docs/agents/verified-play.md` "Verified play"). Keep the truck where the contact happened.
