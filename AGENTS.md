# Freight Chain – "Desert Run"

Browser game inspired by *Desert Bus* (1995): a 2D truck cockpit drawn over a 3D desert road. The product idea is a crypto
"hype" game where each ride **costs money and takes a minimum real time** (`RIDE_MIN_SECONDS`, 30 min in production). The road **never ends**: it is generated
endlessly from road patterns (crossroads with traffic lights, 1–3 lanes per direction…) and the ride starts at a depot.
Vanilla ES modules + three.js r160 from a CDN. No build step, no framework, no bundler.

## Repo layout (client / server)

```
client/    the game (everything below up to "Not implemented" is relative to client/) + site pages: index.html (landing, placeholder), lobby.html + site/lobby.js|css (tabs: new ride · live · leaderboard · profile; vanilla DOM, server text only via textContent), play.html (the game), viewer.html, site/wallet.js (sign-in) + pay.js (buy a ride)
server/    NestJS 12 + TypeScript (ESM) + Prisma 6 + PostgreSQL, Clean Architecture: src/{app,cli,domain,application,infrastructure,presentation} + main.ts, prisma/ (multi-file schema, one PG schema per context, reviewed SQL migrations), test/ – see docs/backend-architecture.md
docs/      hackathon-plan.md (day-by-day plan with progress ticks) · backend-architecture.md (the server's layers, rules, race-safety table, test pyramid)
deploy/    semi-automatic deploy to /srv/freightchain on a server (`npm run deploy`, docker + host nginx + certbot; `deploy/.env` real + gitignored, `deploy/.env.example` dummy + tracked) – read deploy/README.md before touching it; ships `git archive HEAD`, so commit first
docker-compose.yml   local PostgreSQL for the server (project "freightchain", 127.0.0.1:15433)
```
- **Split hosts in production**: landing + lobby on the apex, the game on `ride.<apex>`, the API on `api.<apex>` (nginx on the box, `deploy/`). All client API calls go through `client/js/hosts.js` (`API_BASE` / `GAME_BASE` / `SITE_BASE`, `''` on localhost / IP / `file://`) with `credentials: 'include'`; the server needs `COOKIE_DOMAIN` + `CORS_ORIGINS` (derived by the deploy). New fetches/links to the game or lobby must use those bases, never a bare `/api/…` or `/play.html`.
- `npm run server:dev` (root) starts Nest on :3000, which also serves `client/` – the page and `/api` share an origin, so the session cookie needs no CORS. `client/serve.sh` still serves the game alone (offline mode).
- **Online mode is opt-in**: `play.html?ride=<id>` (`js/online.js`) takes the seed + shift length from the server and heartbeats it; without `?ride` the game is the offline prototype (headless test, e2e, viewer and the `file://` build rely on that).
- **Server rules (docs/backend-architecture.md, enforced by `server/test/architecture`)**:
  - Layers point inward: `domain` is pure (entity classes `Ride`/`Player`/`Round`/`Payment`… – rules live in their methods), `application` = abstract-class ports + CQRS handlers + services, `infrastructure` implements the ports, `presentation` = thin controllers. Prisma rows ⇄ entities only in `infrastructure/prisma/mappers`.
  - HTTP: every request part through `@ZodBody/@ZodQuery/@ZodParams`; every route returns a typed, non-empty DTO **produced through the bus** (`commandBus`/`queryBus.execute`); no Nest `HttpException` – throw `DomainError`s, the one `ProblemDetailsFilter` renders RFC 9457 problem+json; every response has `X-Request-Id`.
  - Every timestamp from `ClockPort` (rows, JWTs, cookies – only `infrastructure/time/system.clock.ts` reads the wall clock); `process.env` only in `infrastructure/config/` (`EnvService`); files ≤ 500 lines.
  - **Race-safety is part of the design**: anything a wallet does to its rides / credits / payments runs in a transaction under `findByWalletForUpdate` (the player row lock); rounds are locked when paid into or closed; aggregates use optimistic versions. A new critical section needs a test in `test/integration/concurrency.integration.spec.ts`.
  - **A Prisma schema change needs a migration in the same change** (forward-only SQL; `test/integration/migrations.integration.spec.ts` fails on drift).
  - **The test pyramid is mandatory** (`test/architecture/test-pyramid.spec.ts`, no allow-list): every new controller, CQRS handler, service, guard, interceptor, filter or adapter ships with its own unit spec (`test/unit/**/<file>.spec.ts`), every class that talks to PostgreSQL with its own integration spec (`test/integration/**/<file>.integration.spec.ts`); new behaviour also gets an HTTP scenario in `test/scenarios/` (runs on in-memory AND PostgreSQL).
  - Rate limits (`THROTTLE_LIMIT` per signed-in wallet or IP, `THROTTLE_AUTH_LIMIT` on `/api/auth/*`) count per IP correctly only with `TRUST_PROXY` set – production requires it, with `JWT_SECRET` and `TREASURY_PUBKEY`.
- Money: one global weekly round (UTC Mon→Mon); every paid entry (whatever the ride's outcome) is a `Payment` row; shares are floored integer lamports, remainder to fees; the grand prize shown is what has *accrued* – no draw/settlement/payout code yet. Demo wallets (`DEMO_WALLETS`) get paid shifts ÷`DEMO_SCALE` (`timeScale` on the ride; the speed bound is not scaled).
- Server checks: `npm run server:test` (Docker-free: controller / handler / service / domain / infrastructure unit specs, architecture + pyramid audits, migration SQL, the whole HTTP surface on in-memory repositories) and `npm run server:integration` (Docker: repository specs, the same HTTP scenarios on real PostgreSQL, concurrency, schema drift – in its own `freightchain_test` database). The server mirrors `MAX_SPEED` / `COMPLETE_DIST_K` / the route ids in `server/src/domain/rides/ride-rules.ts` – keep them equal to `client/js/config.js` and `client/js/themes`.

## Run it

```sh
# from client/
./serve.sh                       # python http server on :8765 + opens the browser (or: python3 -m http.server 8765)
node tools/build-standalone.mjs  # optional: one self-contained dist/freightchain.html that works when double-clicked
```

- The multi-file version **must be served over http**. Opening `play.html` via `file://` is blocked by CORS (blank page; after 2 s a "COULD NOT START" panel explains why).
  `dist/freightchain.html` (built by `tools/build-standalone.mjs`, needs `npx esbuild`) inlines everything and does work from `file://` – rebuild it after code changes; it is not committed/updated automatically.
- It needs internet: three.js is loaded from jsdelivr (version pinned in the `importmap` in `play.html`).
- Debug handle in the console: `window.__game` (`holes`, `st`, `disp`, `CFG`, `Wallet`, `input`, `startRide`, `tryShift`, `ignition`, `curv`, `selectTheme(id)`, `THEMES`, plus traffic's `spawn`/`traffic`).

## Layout

```
play.html             the game page: markup + importmap + <script type="module" src="js/main.js">
css/style.css         HUD, toast, menu overlay
js/main.js            entry: wires modules, runs the frame loop
js/config.js          CFG – every tunable constant (ride length, fare, shake strengths…)
js/util.js            clamp, approach, rnd (hash noise), mulberry32 (the seeded PRNG), `store` (localStorage that never throws – use it, not raw localStorage), fmt (mm:ss), MONO font
js/state.js           `st` (truck/ride state; `rideStart()` = the per-ride fields and their start values, shared with `resetRide`), `input`, `disp` (sprung gauge values), drivetrain constants, `clock`
js/road.js            road centre-line ("spine"): curvature → heading → x/z table, ENDLESS (grows on demand, Float64), s < 0 extrapolated; roadAt(s); `setRoadProfile(fn)` (installed by net/network.js)
js/net/patterns.js    road PATTERNS (country / highway / arterial / town: lanes, bends, junction spacing, signal odds) – see "Road network"
js/net/network.js     `net` = RoadNetwork: seeded lazy layout (segments, junctions, start), cross-section `xs(s)`, lanes, `onRoad`, `keepOut`, `roadside`, signals, main-road / side-road frames
js/net/orchestrator.js `roads` = RoadOrchestrator: newTrip / setTheme / per-frame update (signal clock, generation, chunk streaming, signal lenses, red-light check) / HUD status
js/hosts.js           `API_BASE` / `GAME_BASE` / `SITE_BASE`: where the API, the game and the lobby live (`api.`/`ride.`/apex on a real domain, '' = same origin elsewhere) – see "Split hosts"
js/wallet.js          MOCK wallet (localStorage)
js/world/scene.js     renderer, scene, camera, canvasTex() (nothing route-specific any more)
js/world/environment.js  `env` = the applied route's sky / terrain / mountains / road material / props / furniture; applyTheme()
js/world/daynight.js  day/night: exposure + night sky/fog fade (`dn.k`, re-applied every frame so route switches keep it), headlight pool decal; js/world/glow.js = lamp glow sprites
js/world/theme-manager.js  selectTheme(id): applies a route + its road curvature + trailer livery, rebuilds chunks, remembers the choice
js/world/props.js     shared geometry, mk(), KINDS (destructible-prop table: hp/r/dmg/slow per kind), `destroyed` set
js/world/pool.js      object pools (`ObjectPool`, `mesh()`, `group()`, `releaseTree()`) – leaf module, see "Object pools"
js/world/chunks.js    `RoadObjectManager` (`roadObjects`): 32 m road chunks streamed around the truck (road strips + junctions + depot + the route's props/furniture), built from / recycled into the pools
js/world/roadmesh.js  pooled rewritable strip meshes (`stripPool`): spine surface, markings (atlas), side roads; `buildSpine`, `markLines`, `strip`, `bar`
js/world/junctions.js junction aprons, side roads, stop lines, traffic-light masts (`heads`, `updateSignals`), STOP signs, the main road behind the depot turn
js/world/depot.js     the start: yard, warehouse + docks, parked trailers, exit / speed-limit signs (chunk 0)
js/world/trailer.js   the trailer (only visible in mirrors)
js/world/holes.js     road holes + warning signs: HOLES table (5 types), `holeAt(ci)` (pure, deterministic), `holesNear(s0,s1)`, meshes; see "Road holes"
js/world/vehicles.js  traffic vehicle types (VEHICLES table: size/mass/speed/allowed presets) + mesh builders; `vehicleMats` feed FLIP_MATS
js/sim/traffic.js     traffic: main road + crossroads side roads, spawn zones, AI PRESETS (IDM car-following + lanes + signals), truck contact (aligned: scratch / bump / direct hit; at an angle: closing speed)
js/world/render.js    per-frame 3D render, camera shake, trailer hitch, mirror passes, resize()
js/sim/physics.js     drivetrain (clutch/gears/stall/ignition), steering, ride end conditions
js/sim/damage.js      collisions, prop destruction, debris, windscreen cracks, hull damage
js/sim/climate.js     ambient °C (`ambientC()`), engine heat balance → `st.temp` (°C), cab heater (`toggleHeater`), cold-engine wear; see "Climate"
js/sim/shake.js       rpm / engine shake helpers (strength comes from CFG.SHAKE_*)
js/ui/tuning.js       F2 panel: sliders for every `CFG.TRUCK` handling constant (mass, brake, steering lag, body sway…), saved in localStorage['freightchain.truck']
js/sim/radio.js       cab radio: 5 stations of procedurally generated songs (seeded PRNG + wall-clock "broadcast", Web Audio scheduler); `STATIONS`, `radio`; dash panel = `radioPanel()` in cockpit/common.js
js/sim/audio.js       synthesized engine/starter/crash sound (Web Audio, no assets)
js/cockpit/canvas.js  2D cockpit canvas, `view` {W,H,DPR}, `cockpitState.style`, mirrorRects()
js/cockpit/common.js  gauges, lamps, LED bars, clickable dash buttons (uiButton/uiBtns)
js/cockpit/rig.js     DEFAULT cockpit: conventional long-hood semi (hood, stacks, mirrors, air gauges, CB…)
js/cockpit/windscreen.js  dust, washer water, wipers, cracks, hood smoke, exhaust-stack smoke
js/cockpit/index.js   drawCockpit(): picks the style + red impact flash
js/ui/game.js         ride flow: menu / start / end / pause / resetRide
js/ui/routes.js       route picker cards in the menu (live-previews the route behind the menu)
js/themes/_shared/theme.js  defineTheme(): assembles a route from its folder's modules + plain data (see "Themes")
js/themes/_shared/landmarks/  roadside buildings (motel, hotel, restaurant, gas, police): TYPES → interchangeable implementations; see "Landmarks"
js/themes/            ONE FOLDER PER ROUTE – see "Themes (routes)" below
js/ui/input.js        keyboard + dash-button mouse input
js/ui/toast.js        transient messages
tools/                e2e-chrome.mjs (real headless Chrome), cdp.mjs (the Chrome/DevTools harness both e2e scripts share), trace.sh (save / diff the headless trace), headless-test.mjs + stub-three.mjs (Node, no browser), build-standalone.mjs
serve.sh              local server launcher
package.json          npm scripts only, no dependencies: `npm run check` (lint + bundle + headless), `trace:save` / `trace:diff`, `test:e2e`, `test:viewer`, `build`
eslint.config.mjs     flat lint config (no-undef, no-unused-vars) for js/ and tools/
dist/                 generated standalone build (git-ignore / regenerate; not source)
technical_design_document.html   product/architecture spec for the Web3 version (Russian) – see "Prototype vs. the design doc"
```

Dependency rule: modules are **acyclic** (checked with esbuild's metafile). `ui/game.js` sits above `sim/*` and `world/*`;
`sim/*` must not import from `cockpit/*`. Keep it that way, or top-level `const`s start hitting TDZ errors.

## Themes (routes)

Five selectable routes, each a folder under `js/themes/` with its **own** version of every scenery object – `sky.js` (sky + its sun), `road.js` (curvature profile + road texture), `terrain.js`,
`mountains.js`, `props.js` (trees/rocks/…), assembled by `index.js` through `defineTheme(meta, { road, sky, terrain, mountains, props })` (`_shared/theme.js`; `furniture` / `landmarks` are plain option objects there) – plus shared builders in `js/themes/_shared/`. The menu lists them; clicking a card applies it live behind the menu.

| id | route | look | road |
|---|---|---|---|
| `route66` | Route 66 · USA | sand, saguaros, telephone poles, tan buttes | gentle bends (★★) |
| `stuart` | Stuart Highway · Australia | red earth, ghost gums, termite mounds, mesas, red dust | almost straight (★) |
| `siberia` | Trans-Siberian · Russia | snow, spruce/birch, overcast + mist (fog 60–700 m), slush on the glass | medium (★★★) |
| `brenner` | Brenner Pass · Austria/Italy | meadow, spruce, snow-capped Alps, guardrails, clouds | tight serpentines (★★★★★) |
| `panamerican` | Pan-American · Chile (Atacama) | salt flats, cardón cacti, cairns, volcanoes, thin bright air | long sweepers (★★) |

**Theme object** (what `index.js` exports; see `themes/route66/index.js` for a complete one):
`id, name, country, route, blurb, difficulty (1-5, curves), swatches [sky, ground, road] (menu card), fog {color,near,far}, grime 'r,g,b' (windscreen dust), finishText (gantry banner),
livery {body, stripe, accent, text, sub} (trailer), curv(s) (curvature, + = right), createRoadMaterial(), createSky(), createTerrain(), createMountains(), createProps(), createFurniture()`.
- `createSky()` → `{ mesh }` (use `_shared/sky-dome.js`; sun + clouds are shader parameters, the sun is a const in the same `sky.js`). Keep the sky `HORIZON` colour equal to `fog.color`.
- `createTerrain()` → `{ mesh, update(px, pz) }` (use `_shared/ground.js`), `createMountains()` → Group (use `_shared/mountains.js` rings; moved with the camera).
- `createProps()` → `{ slots, density, near, span, pick(r, r2) }`; `pick` returns a Group whose `userData = { kind, size, debris }` (use `_shared/props-basic.js`). `kind` must exist in `KINDS` (world/props.js); `debris` = material(s) of the smash particles.
- `createFurniture()` (built by `defineTheme` from the `furniture` options) → `{ build({ ci, s0, place, reg, destroyed }), lampAt(ci) }` (use `_shared/furniture.js`: delineator posts, poles, guardrails, lamp posts – all destructible). Also `daylight: {rise,set,tw,peak,warm,stars}` on the theme (see Day / night).
- **Add a route**: copy a folder, edit, add it to `THEMES` in `themes/index.js`. **Add a prop kind**: builder in `props-basic.js` + an entry in `KINDS`.

## Road network (`js/net/`)

The road is **endless** and generated lazily ahead of the truck from a seeded PRNG (`roads.seed`, new per ride), so the whole layout is a pure function of the seed + route.
It is still ONE centre-line (the "spine", `s`/`d`); everything else is a feature on it. `net` (network.js) is the low-level data/query object everybody reads; `roads` (orchestrator.js) runs it.
- **Start**: s 0..`sA` (`CFG.START_ACCESS`) = the depot's unmarked access road (truck at s 0, d 2.4, engine off, trailer just off the dock), `sA..Sm` = a 90° right turn (`CFG.START_TURN_R`) onto the **main road**,
  which is the spine from `Sm` on and a straight line behind the turn (`net.mainAt(m)` for m < Sm) – traffic always drives on the main road, so it streams past the depot exit both ways. STOP line + sign, a big paved apron.
- **Segments** (`net.segs`): consecutive stretches of a PATTERN (patterns.js) with a lane layout `nR+nL` (1–3 per direction); a change is a `TAPER` (120 m) transition. Lane i of a direction is centred at
  `±(2.4 + 4.2·i)` (inner lane unchanged from the old two-lane road; extra lanes are added outward), edge line at `edgeOf(n) = 4.5 + 4.2·(n−1)`. `net.xs(s)` = cross-section, `net.lanes(m, dir)`.
- **Junctions** (array `net.js`; `net.near(lo, hi)`, `net.nextJunction`): `cross` / `tee`, side road lanes `sl`, optional traffic lights (`cyc`: main green / amber / all-red / cross green, `CFG.SIGNAL_*`, random phase); `net.signal(j, 'main'|'cross')`
  is a pure function of `net.clock` (advanced while driving). The spine is straight ±(mouth + 50 m) around each junction (`calm`), side roads are straight lines (`lineOf(j)`, ±`SIDE_LEN`).
- **Roadside**: things laid out for the old 12 m road are pushed outward with the road edge (`net.roadside`) and dropped where they would stand on a junction, side road, the depot yard or the main road at the start (`net.keepOut`); no landmarks near junctions (`net.busy`), no holes there (`net.plain`).
- **Add a pattern**: a row in `PATTERNS` + a weight in the themes' `roads.weights`. Debug: `__game.net`, `__game.roads` (`status()`), e.g. `__game.st.s = __game.net.nextJunction(__game.st.s, 1, 5000, j => j.signal).s - 80`.

## Landmarks (roadside buildings)

`themes/_shared/landmarks/`: `TYPES = { motel, hotel, restaurant, gas, police }`, each an array of **implementations** `{ id, hl, hd, make(g, c) }` (`lodging.js`, `food.js`, `fuel.js`, `police.js`; shared blocks in `parts.js`).
A theme only gives a look: `createLandmarks: () => createLandmarks({ chance, near, weights, names, pal })` (see any `themes/*/index.js`; the key is optional – no key, no buildings).
- At most one per 32 m chunk (`site(ci)`, deterministic by `rnd`), set back `near` m from the road on a tarmac apron; `chunks.js` keeps ordinary props out of its footprint. Solid: `KINDS.building` (hp 3000, `rf/rl` = footprint from the implementation).
- Model frame: front faces **-x**, road runs along **z**, origin on the ground at the footprint centre; the factory rotates it 180° for left-hand sites. `c.sign(style, w, h, x, y, z[, text])` makes a lettered sign (canvas texture, cached per theme).
- **Add an implementation**: push a row to a type's array. **Add a type**: new array, entry in `TYPES` + `NAMES`, weight in the theme configs. All of them show up in `viewer.html` under "Landmarks · <route>".

Theme caveats:
- **Create materials only inside the `create*()` functions, via `basic()` / `trackMat()` from `_shared/mats.js`.** Selecting a route disposes the tracked materials; module-level materials would be disposed/forgotten, and untracked ones are missing from the mirror-flip list (inside-out in the mirrors).
- Geometry the theme creates (sky sphere, ground plane, mountain cones) is disposed on switch; `GEO` in `world/props.js` is shared and never disposed.
- Gameplay differences are limited to the road's curvature profile (`curv`) and what is on the roadside (collision kinds). Physics, fog distance and prop density change the *feel* (Siberia: short visibility; Stuart: nothing to hit).
- All routes share the road network (net/): a theme only gives the **bend style** (`curv`, scaled per pattern and zeroed around junctions) and optional `roads: { weights: { country, highway, arterial, town } }`.
  `createRoadMaterial()` returns `{ surface, pad, marks, edge, centre }` (themes/_shared/road-texture.js – markings are a separate atlas now, not painted into the surface). No elevation/hills – the road is flat in every theme.
  `finishText` is only used by the model viewer's gantry (there is no finish any more).
- Routes are chosen with `selectTheme()` (menu) and the last choice is kept in `localStorage['freightchain.route']`. Switching mid-ride is only done by the test tools.
- Texture drawing uses `Math.random()` (not seeded per route), fine for visuals but part of why the headless trace changes when you add or reorder theme drawing code.

## Climate (cold, snow, engine temperature, heater)
Each theme has `weather: { ambient °C (day), snow 0..1 }` (route66 26/0, stuart 34/0, siberia −22/1, brenner 3/.25, panamerican 12/0); `selectTheme()` copies it into the `weather` object in `state.js` (so `sim/` never imports the scene; debug: `__game.weather`). Night = `CFG.NIGHT_CHILL` colder (`ambientC()`).
- **Engine temperature** `st.temp` is in **°C** (`sim/climate.js updateClimate`, called every drive frame from `physics.js`). Start = ambient (cold engine). Heat in = `ENGINE_HEAT_IDLE + ENGINE_HEAT_LOAD·(rpm/redline)^1.5·(0.3+0.7·throttle)`; heat out = `(T−ambient)·ENGINE_COOL·(1 + airspeed + snow)`, ×steeply more above `THERMOSTAT` (so it plateaus ≈85-95 °C); engine off = slow cooling to ambient (the old "temp frozen" rule is gone; **air** is still frozen). The TEMP dial shows `tempGauge(T)` (−30…130 °C → 0..1, red from 0.8 ≈ 98 °C); `disp.oil` reads a bit higher when cold.
- **Cold engine** (`coldK()` in state.js: 1 at ≤`ENGINE_COLD` → 0 at ≥`ENGINE_WARM`): power × `(1 − COLD_POWER·coldK)`; revs above `COLD_WEAR_RPM` cost hull `COLD_WEAR·coldK²·…` %/s (toast once; if it kills the ride the reason says so); blue COLD lamp (both cockpits). Idle alone does not warm a −22 °C engine; driving gently does. **Rates are tuned for the 30 s test ride – production (30 min) wants them several times slower.**
- **Heater** (`st.heater`, key **H** / HEAT button in both cockpits): `st.heatEff` 0..1 follows the engine temperature (`HEATER_MIN`…`HEATER_FULL`), is 0 with the key off, and draws `HEATER_DRAIN` °C/s out of the engine. The button shows the air warmth as a bar.
- **Windscreen** (`cockpit/windscreen.js`): frost = 48×24 grid grown from the edges below freezing (wind chill, snow), melted by `heatEff·FROST_MELT` from the defrost vents (bottom centre) outwards; wipers/washer do **not** clear it; drawn via an offscreen canvas (crystal texture, darkened at night). Snowflakes = camera-space points streaking from the vanishing point (`CFG.SNOW_FLAKES`·snow), snow also sticks as white specks on the grime canvas (wipers clear those). The glass starts partly frosted when it is below freezing.
- **Max-rev strain** (`updateClimate`): `st.strain` 0..1 charges while rpm ≥ `STRAIN_RPM`·REDLINE (`STRAIN_TIME` s to full, drains `STRAIN_RECOVER`× faster); STRAIN lamp next to COLD (amber from .15, red + blinking from .6), toast at .4, full = `st.blown` → hull 0 → ride ends. `STRAIN_TIME` is a test value.
- Not done: no overheating damage, snow/ice on the road (grip is unchanged), snow in the mirrors, breath fog.

## Day / night
`dn` in `state.js` (`t` clock hour 0..24, `scale`, `run`, `phase` day|dusk|night|dawn, `night`, `k` fade 0..1, `head`, `cab`); `updateDayNight(dt)` (`world/daynight.js`, every frame from `main.js`).
- **Clock**: `dn.t` advances `dt × dn.scale / 3600` h while driving (not in menu/pause). **F2 panel → TIME OF DAY**: log time-scale slider x1 (1 s = 1 s) … x600 (1 s = 10 min), clock slider, "clock runs" checkbox (`freightchain.daycycle`; default x60). Clock itself in `freightchain.time`. Menu has 4 cards (Day/Dusk/Night/Dawn = `setPhase()`, jumps to that phase of the CURRENT route); N / NIGHT button = `setNight()` (day ⇄ night).
- **Per-route sun**: `theme.daylight = { rise, set, tw, peak, warm, stars }` (hours, twilight length h, noon sun height 0..1, dusk/dawn horizon colour, star brightness; defaults `DEFAULT_DAY`). Siberia: 9.5–15.5, low sun, long twilight, few stars; Brenner 6–20; Atacama bright stars. `dn.k` follows `nightTarget(t, d)` with a `NIGHT_FADE` smoothing, so jumps (clock, route switch) still fade. Sun direction moves along its arc; the sky shader (`night`, `tw`, `twCol`, `stars` uniforms) and `scene.fog` use ONE horizon colour (day fog → `NIGHT_HORIZON` → warm twilight) – keep them in step.
- **Darkness = per-fragment light map** (`world/nightlight.js`): `MeshBasicMaterial.prototype.onBeforeCompile` multiplies every ordinary material by `mix(1, ambient + headlight cone + 12 nearest lamp pools, dn.k)` from its WORLD position (exposure is no longer lowered). Ambient `CFG.NIGHT_AMBIENT` is LINEAR (sRGB stretches it: 0.012 is clearly visible, 0.002 ≈ black) → with no lights the world is black, with headlights (L) the cone lights road, markings, props and traffic. Materials with **`toneMapped:false` are exempt (self-lit)**: lamps, glow sprites, the beam decal, gantry banner. New emissive things must set it. Needs `Vector4` in `tools/stub-three.mjs`.
- Truck headlights = the cone above + a faint additive halo decal (`updateBeam`, `CFG.HEADLIGHT_*`). Traffic lamps: `lampMat()` in `vehicles.js` + `glow()` sprites (opacity follows `dn.k`; brake glows live in the `userData.brake` group); vehicles' own road pools via `beam()` (`glow.js`).
- **Lamp posts** (`themes/_shared/furniture.js` `lamp: { color, light, every, side, h?, arm? }`, per route in `themes/*/index.js`): mast + arm over the road edge + self-lit bulb + glow sprite, `KINDS.lamp` (destructible; its glow is hidden when smashed). `furniture.lampAt(ci)` is pure, so `daynight.js` lights the nearest 12 (`CFG.LAMP_RADIUS/GAIN`, light colour from the furniture) without chunks being built.
- Dazzle: `updateGlare()` in `daynight.js` → `dn.blind`, drawn by `blindEffect()` in `cockpit/index.js` (`CFG.GLARE_*`).
- Daylight: the headlight cone/halo and lamp pools scale with `dn.k`, so by day headlights show only as the HEAD button (the old green LIGHTS lamp is now the BAT lamp) (real low beams don't light a sunlit road); the cab lamp shows as the glowing dome lens (the overhead console is just that lamp: 16u lens in a 19.2u housing, centred) + `CFG.CAB_DAY` of its warm wash (`cabGlow()`).
- Cockpit: `nightGrade()` in `cockpit/index.js` darkens only opaque cockpit pixels (`source-atop`; glass/mirror holes stay clear), brighter around the gauges; cab light (C) warms it. New single-sided materials still need the mirror flip list.

## Controls

W/↑ gas · S/↓ brake · A D/←→ steer · **Shift/Space = clutch (hold)** · E/Q gear up/down (clutch must be in; 1–7 / 0 select gear/neutral; **Q from neutral or G = reverse**, stop first) ·
**B parking brake** (ON at the start of every ride – release it before moving; also the red PARK octagon on the dash; spring brake, `CFG.PARK_BRAKE` 9 m/s², works with the engine off and holds against thrust – the service brake pedal does NOTHING with the engine off/stalled). **Driving against a held brake** (`st.fight`: gear in, clutch out, gas on, truck pinned by the parking brake or pedal) heats the brakes (`FIGHT_HEAT`, BRAKES lamp; hot brakes fade, the parking brake too) and charges the STRAIN lamp over `FIGHT_TIME` s – full = the drivetrain gives out, ride over (`st.blownWhy = 'brakes'`). With the pedal the engine simply stalls (the slip hold rpm is cut by braking) · **I start engine** (also after a stall; **O** or click the key = engine off) · **H cab heater (HEAT button)** · **N night/day (jump) · L headlights · C cab light** (or the HEAD / NIGHT dash buttons; the cab light's switch is the dome lamp in the overhead console and it only works with the engine running or starting (`cabAllowed()` in sim/battery.js; it goes out when the engine stops); day/night also in the menu) · R wipers off/slow/fast · hold X washer spray (or click WIPER/WASH on the dash) · **T radio on/off · , . station · − = volume** (or the ‹ PWR › dash buttons; needs key ON) · P pause (→ END SHIFT) · M mute.

## Caveats – read before changing things

### Money / anti-cheat (the part that matters for the product)
- **The wallet is a mock** (`js/wallet.js`, localStorage key `freightchain.wallet.v1`). Never trust client-side balances.
  Swap `Wallet` for a real backend; it is deliberately a tiny `balance/charge/credit` interface.
- **`CFG.RIDE_MIN_SECONDS` is a TEST value (300). Production = 1800.** The road never ends; a shift is **complete** (`st.complete`, toast) after `RIDE_MIN_SECONDS` of driving
  AND `COMPLETE_DIST = COMPLETE_DIST_K × MAX_SPEED × RIDE_MIN_SECONDS` metres. Speed is governed at `MAX_SPEED` (28 m/s), so idling/backgrounding can't bank it.
  The ride then goes on until the driver ends it (P → END SHIFT: paid if complete, otherwise "abandoned") or it fails. **That is not security**: a modified client can complete instantly.
  Real enforcement (signed ride start, server-side timing/telemetry, payout only after validation) must live on a server.
- Frame `dt` is clamped to 0.05 s and the game pauses when the tab is hidden, so on a slow machine (<20 fps) game time runs slower than wall time.
- The fare is charged when the ride starts and is not refunded on failure. `CFG.REWARD` is a 0 placeholder.
- At 1800 s the road is ~50 km (3 Float32 tables of ~50k entries – fine; chunks stream). Dust, fuel, etc. were only ever tuned for the 30 s test ride.

### Prototype vs. the design doc (`technical_design_document.html`, in Russian)
The spec describes the production target: a Telegram Mini App ("Desert Bus 3.0", TON/USDT stakes, escrow split 50 % jackpot / 20 % next-pool seed /
20 % platform / 10 % consolation), an **8-hour** ride, a hostile-browser anti-cheat stack (Rust/WASM + obfuscation, an HMAC-SHA256 "input ratchet" over every frame,
touch/motion entropy, proof-of-render) and a **deterministic server-side replay**: the server re-runs the 7-byte-per-tick input log (`steering i16, throttle u8, brake u8, flags u8, mac u24`, 60 Hz)
with **fixed-point Q32.32 math and no floats**, hashing state every 300 ticks. This prototype does **not** meet that yet – don't assume it can be replayed or validated:
- The sim uses floats (`Math.sin/cos`), a **variable `dt`** (clamped to 0.05 s) and **`Math.random()`** inside gameplay (steering-pull side, bug splats, dust, debris).
  A server-replayable core needs a fixed 60 Hz tick, seeded PRNG, fixed-point math, and the inputs as a recorded tick stream. `sim/physics.js` + `road.js` are the part to port (WASM core + JS/three.js renderer is the doc's recommended split).
- Gameplay differs from the spec on purpose: this build has a pause key, a manual gearbox/clutch/stall model, 5 s of off-road tolerance (spec: any off-road = instant crash), a hull/damage system, and a 30 s test ride (spec: 8 h with 3 mandatory 5-min pit stops).
- Spec items not built: Wake Lock, FPS lock at 60 (the prototype is uncapped, DPR clamped to 2 not 1.5), stream-spectator sabotage (fog/wind/potholes), checkpoint payouts (25/50/75 %), TonConnect/escrow, input ratchet, proof-of-render.
- `CFG.COMPLETE_DIST`, the speed governor and the road generator (net/network.js + the theme's `curv`) would all need to be identical in the server sim. The layout IS a pure function of
  the ride seed (`roads.seed`, own mulberry32), but the centre-line is integrated in floats.

### User-tuned values – don't change without asking
`CFG.SHAKE_START = 0.5` (engine start-up/idle/shut-off), `SHAKE_MOVING = 0.1` (speed shake), `SHAKE_RPM = 0.35` (rpm shake).
`START_ENGINE_OFF = true` (ride begins with the engine off; press I). Numeric tuning requests are relative to the *current* value
(e.g. "lower it twice" = halve it).

### Conventions
- Heading θ: forward = (sinθ, 0, −cosθ), right = (cosθ, 0, sinθ); three camera `rotation.y = −θ`. Curvature + = right turn.
- Truck state is in road coordinates: `s` distance along the spine, `d` lateral offset (+ right), `psi` heading error; `ds/dt = v·cosψ/(1 − k·d)`. Off road = `!net.onRoad(s, d)` → `st.off`
  (lanes + .5 m, junction aprons, side roads, the depot yard). Steering authority rises at walking pace (`steerGain()`: `STEER_GAIN` → `STEER_GAIN_LOW` below `STEER_LOW_V`) so the depot turn is possible.
- Units: metres, seconds, m/s (speedometer shows ×3.6). Gauge/cockpit drawing uses **`u = min(H/100, W/150)`** px units, not pixels.
- Cockpit code reads the canvas size from the shared `view` object (`const { W, H } = view`) – there are no `W/H` globals.
- Tunables go in `config.js`; derived constants next to the code that owns them.

### Rendering gotchas
- Everything is `MeshBasicMaterial` (no lights) + fog. Canvas textures are sRGB. The sky `ShaderMaterial` writes raw colours (no colour-space conversion) – don't "fix" that.
- `Object3D.position` is read-only: use `.position.set(...)`, never `Object.assign(mesh, { position })` (throws in strict mode).
- **Mirrors are a second render pass** with the projection x-flipped, so culling is inverted. The flip list (`flipMats()` in `world/render.js`) = the route's tracked materials (`themes/_shared/mats.js`) + `MAT` + trailer + `vehicleMats`; **every shared single-sided
  material** in the scene must be in one of those or it renders inside-out in the mirrors. `DoubleSide` materials are skipped.
  The cockpit canvas punches see-through holes at `mirrorRects()` (`destination-out`); the GL viewport is padded by 0.5u so cab vibration never shows a gap.
  Keep `mirrorRects()` as the single source of truth for both.
- `camera.setViewOffset(…, H*0.14, …)` lifts the horizon so more road is visible through the windscreen; the cockpit windshield geometry is tuned to it.
- Chunks keep **280 m behind** the truck (`BEHIND`) purely so the mirrors have road to show.
- The canvas cockpit is redrawn every frame; shake is applied by translating the context, so dash-button hit rectangles (`uiBtns`, rebuilt each frame) ignore vibration.

### Object pools (`world/pool.js`, `CFG.POOL_*`)
Props are **not** pooled as wholes (sizes are continuous and baked into child scales); the primitives they are made of are: `mk()` returns a pooled Mesh, builders use `group()` instead of `new THREE.Group()`, and the road ribbon geometry is reused (vertex data rewritten in place).
`roadObjects` (chunks.js): `startTrip()` (called by `roads.newTrip()` from `resetRide`) recycles everything, pre-warms the pools and builds the initial window at the depot; `update(s)` (every frame) builds chunks entering range and recycles the ones that fell out; `clear()` on a route switch. `clearChunks`/`updateChunks` remain as thin wrappers. Traffic vehicles hand their `mk()` parts back in `removeVehicle`. Stats: `__game.roadObjects.stats` (`created` plateaus, `active`/`free` cycle).
- Pooled objects are fully reset on release (transform, rotation – toppled props –, name, userData, geometry/material = null so no theme material outlives a route switch). **Do not keep references to a prop/mesh after its chunk is released**; if you do (like `falls` in damage.js), register a `releaseHooks` callback (chunks.js).
- `releaseTree` only recycles what a pool created; anything else (landmark sign meshes, glow sprites) is just detached. Things that own GPU resources set `userData.disposable` (the gantry banner) and are disposed on release.
- New builders: use `mk()`/`group()` (or plain `new THREE.*` – works, just not recycled). Don't draw canvases or call `Math.random()` in pool create/reset (keeps the headless trace stable).

### Gameplay systems
- **Road holes** (`world/holes.js`, `CFG.HOLES / HOLE_CHANCE / HOLE_FIRST / HOLE_WARN`): five types in the `HOLES` table (pothole, deep, cluster of 3, trench = lane-wide, sinkhole = lane-wide + cones); each is a list of ellipses `{ds, dl, a, b}` (road coords) + `dmg / slow / jolt / kick / crawl`.
  Placement is a pure function of the chunk index (`holeAt(ci)`: ≤ 1 per chunk, hash `rnd`) so traffic can see holes in chunks that aren't built; `chunks.js` calls `buildHoles()` which draws the decals and a yellow warning sign (pictogram per type, `HOLE_WARN` m before the hole, lat 7.6, a destructible `KINDS.sign`).
  **Not colliders**: `hitHoles()` (`sim/damage.js`) tests each wheel (±1 m) of three axles (front / drive / trailer) against the ellipses once per ride → jolt, hull ∝ (v/28)², speed loss, steering pull; so a small pothole can be straddled. AI: `dodge()` in `sim/traffic.js` (stateless each step): shift inside the lane → other lane if `laneFree()` → crawl at `crawl` m/s; no weaving near holes. Add a type: a `HOLES` row (+ a `dips` entry for its sign pictogram in `signMat`, + mesh case in `makeHole` if it needs a custom look). Debug: `__game.holes`.
- **Traffic** (`sim/traffic.js`, `CFG.TRAFFIC*`, `CFG.CROSS_*`): vehicles are records in the coords of their `road` (`MAIN` or a crossroads' `net.lineOf(j)`): `s`, `lat`, `lane`; `dir` -1 = oncoming; lane i at `laneLat(dir, i)` (inner lanes ±2.4).
  Lights: red / amber-that-can-stop = an obstacle at the stop line; green waits while the box is occupied. Lane ends ahead → merge left or wait. Overtaking: next lane left on multi-lane roads, the oncoming lane on 1+1 (never towards a junction). Type = `VEHICLES` (sedan, truck, bus, freighter, police, medic, fire),
  behaviour = `PRESETS` (cruise, slow, tailgate, overtake, weave, emergency). Add a type: a `STYLES` builder + `VEHICLES` row in `world/vehicles.js`; add a behaviour: a `PRESETS` row (+ the type's `presets` weights).
  Contact (`contact()`): nose engaged ≥ `CRASH_OVERLAP` of the width and closing ≥ `CRASH_CLOSING` = **direct hit → ride over** (reason string returned to `physics.js`, which calls `endRide` before the hull check);
  slower nose contact or a hit on the trailer = bump (hull damage); alongside / corner clip = scratch (`SCRATCH_DMG`). The truck's box is cab + trailer in road axes (trailer articulation and `psi` ignored). Vehicle–vehicle contact is avoided by the AI, not simulated.
  Debug: `__game.spawn(type, preset, zone 'ahead'|'behind'|'oncoming', dist, lat)`, `__game.traffic`. Own seeded PRNG per ride (`resetTraffic(seed)`), but still floats + variable `dt` – not replayable. `TRAFFIC:false` leaves the headless trace identical to pre-traffic.
- **Reverse** (`st.gear = -1`, `REV_RATIO`, `CFG.REVERSE_MAX` 6 m/s): `st.v` stays the speed (≥ 0); `st.rev` = moving backwards, `st.vel` = signed velocity (use it where direction matters: position, heading, traffic closing speed). Forward↔reverse needs `v < .8` (else GRIND). Reversing swings the trailer out (`tyaw` clamped ±1.2 rad), beeps (`audio.beep`), lights the trailer's white reverse lamps. **Gaps**: reversing ignores roadside props (`collide()` returns early; the trailer has no scenery collision), and `s` is clamped at the start line.
- **Ignition key** (OFF/ON/START zones on the dash, `ignitionPanel()` in `cockpit/common.js`; `keySwitch/ignition(true)/releaseKey/engineOff` in `sim/physics.js`): `powered()` (state.js) = engine on or `st.keyOn` or cranking; with the key OFF all gauges (`updateDisp`), lamps, gear display, trip LCD and LED bars are dead; turning to ON runs a 1 s self-test sweep (`st.test`). Engine off: air is frozen; engine temp cools slowly towards ambient (see "Climate"). START is hold-to-crank (~1 s) with the mouse; `I` is a one-tap auto start.
- **Gearbox** (`RATIOS` in state.js, torque curve `CFG.TORQUE_*`, `GEAR_EXP` in the F2 panel): 7 gears, geometric ×1.42, ratio 6.15 → 0.75 (8.2:1). Useful range at 1000–2500 rpm, km/h: 1st 5–14 · 2nd 7–20 · 3rd 10–28 · 4th 14–40 · 5th 20–57 · 6th 28–80 · 7th 40–100. Thrust ∝ (ratio/1st)^`GEAR_EXP` (.4; 1st gear's thrust is fixed, a bigger exponent only weakens taller gears) × torque(rpm); engine braking ∝ ratio^.4; torque is a parabola peaking at `TORQUE_PEAK` 2000 rpm (width `TORQUE_LOW_W` 800 below, `TORQUE_HIGH_W` 1500 above) and ~0 around 1200 – so 30 km/h in 5th–7th lugs or barely pulls, 4th is the gear for it, so a tall gear at a crawl lugs and stalls instead of pulling (standing starts: 1st/2nd fine, 3rd/4th can't move off, 5th+ stalls). Holding the redline in a low gear charges max-rev strain – shift up. The headless test's scripted driver upshifts at 2300 rpm for the same reason.
- **Battery** (`sim/battery.js`, `CFG.BATT`, `st.batt` 0..1, BAT lamp + VOLT gauge): drained per second by the headlights (.0025), cab lamp, heater blower, radio, key-on instruments (engine off) and the starter (.06 while cranking ≈ −.085 per start); refilled by the alternator only while the engine runs (`CHARGE_MIN` at idle … `+CHARGE_RPM` at redline, tapering above ~75 %). BAT lamp amber below `LOW` .3, red + blinking below .15; below `DEAD` .01 the lights, radio and heater are forced off (`st.battDead`) until it recovers, and `ignition()` refuses below `START_MIN`. All rates are test-scale (5 min ride): everything on with the engine off flattens it in ≈ 2.5 min.
- **Engine**: `st.ign` is the start sequence (0–1 s key-on gauge sweep + bulb check, 1–2.3 s cranking, then the engine catches with a rev flare and rumble).
  Stall = gear engaged, clutch mostly out (>0.55 engagement) and rpm < 450 for 0.12 s. **Clutch slip** (`st.slip`, armed by clutch in / neutral): until the wheels catch up with the engine (lock-up), rpm isn't dragged down to wheel speed but held at `360 + TRUCK.LAUNCH_RPM·gas` (× power factor, less in 3rd+, 0 while braking) – without it the 0.6 s clutch release stalls every launch at `MASS 2.5`. After lock-up rpm = wheel speed again (stopping in gear stalls). Launch checks at the end of `tools/headless-test.mjs`. Gauges read the sprung `disp.*` values, not `st` directly.
- **Damage**: props are registered as colliders in `chunk.userData.colliders` (`KINDS` table: `hp` is a speed² budget, `dmg` = hull % lost in a 28 m/s hit,
  `slow` = speed fraction lost when it breaks). Unbroken props bounce the truck. Smashed props are remembered in `destroyed` so a rebuilt chunk doesn't resurrect
  them; `resetRide()` clears that set and all chunks. Hull < 100 % cuts engine power (down to 40 %) and adds a steering pull (random side per ride); 0 % ends the ride.
  Colliders may be long and thin (`rf` along / `rl` across the road in `KINDS`, e.g. guardrails, which fall outward when broken). Not colliding: the trailer, the mountains, the road.
- **Windscreen**: dust lives on a 512×256 offscreen "grime" canvas stretched over the top 65 % of the screen. Wiper blades erase the swept triangle; dry blades only
  clear ~25 % per pass. While the glass is wet (washer), every pass also clears ~45 % of the whole screen (`washAll`). Wipers only reach the left/centre of the glass.
- The washer tank (`st.wash`) drains while spraying and refills slowly; a small H2O gauge shows it (semi cockpit only).
- Exhaust smoke (`drawExhaust`) only exists in the semi cockpit.

## Verifying changes

**Server / full stack** (from the repo root): `npm run check` = client check + `nest build` + typecheck + the server's Docker-free tests; **`npm run server:integration`** (starts the compose PostgreSQL, then – in its OWN `freightchain_test` database, created and migrated by the suite, never the dev one – runs the repository specs, the same HTTP scenarios on real Prisma repositories, the concurrency tests and the migration-drift check) must also be green before a server change is done. Test layout and what each level proves: `docs/backend-architecture.md` → "Tests – the pyramid". Real-Chrome runs against a LIVE server (PostgreSQL up + migrated – `npm run db:up && npm run db:migrate`): `cd server && npm run build && FREE_RIDE_SECONDS=3 SOL_USD=118 TREASURY_PUBKEY=<any address> PORT=3111 node dist/main.js` (other terminal), then `BASE=http://localhost:3111 node scripts/e2e-browser.mjs` (the game: a keypair stands in for the wallet; ends the ride before the first heartbeat on purpose) and `BASE=http://localhost:3111 node scripts/e2e-lobby.mjs` (the whole lobby click-through, 3 Chromes, 26 checks, screenshots of every tab at desktop + phone width – LOOK at them). The database persists between runs (`npm run db:reset` after `build` wipes it). Headless Chrome runs the game clock at ~0.4× wall time, so wait on `__game.st` rather than sleeping.

Quick path (npm scripts, no installs – tools run through `npx`): **`npm run check`** = eslint (`eslint.config.mjs`: undefined names, unused vars) + esbuild bundle + the headless test.
Refactor gate: `npm run trace:save` before, `npm run trace:diff` after – "trace identical" = behaviour unchanged. `npm run test:e2e` / `test:viewer` = real Chrome (shared harness: `tools/cdp.mjs`; `PORT=…` if 9333/9334 are taken).

Checks, from most to least realistic (run from the project root):

```sh
# 1. REAL Chrome, headless (software WebGL): boots, starts a ride, engine, gears, washer, off-road, depot / depot exit / crossroads / multi-lane (net-*.png); fails on any exception
#    (also inside its own evaluate calls). Saves screenshots – LOOK at them. A headless Chrome left on port 9333 by an aborted run gets reused (stale localStorage) – kill it.
./serve.sh &   # or any http server on :8765
node tools/e2e-chrome.mjs                      # also: node tools/e2e-chrome.mjs file:///…/dist/freightchain.html
# 2. static: undefined names, then imports/exports + bundle
npm run lint     # eslint.config.mjs (flat config; the old --no-eslintrc flags no longer work on eslint ≥ 9)
npx esbuild js/main.js --bundle --external:three --format=esm --outfile=/tmp/fc.js
# 3. Node-only deterministic playthrough with stubbed three.js + fake DOM (diff-able trace)
npx esbuild js/main.js --bundle --format=esm --alias:three=./tools/stub-three.mjs --outfile=/tmp/fc-test.js
node tools/headless-test.mjs /tmp/fc-test.js
```

- (1) found the page healthy over http and from the standalone file, and is how the `file://` failure was reproduced. It does **not** judge feel (shake, smoke, wiper angles, layout) – a human still has to look.
  If the Claude-in-Chrome extension isn't connected, (1) is the way to see the game; headless Chrome works with `--use-angle=swiftshader --enable-unsafe-swiftshader`.
- (3) is deterministic (seeded `Math.random`, simulated clock): save its output before a refactor and `diff` after – identical means behaviour unchanged. Logic only; the 2D context and three.js are stubs.
  It also runs named checks (depot start, the right turn onto the main road, signal cycle, cross traffic, same seed → same layout, 60 km out) and exits 1 if one fails.

## Not implemented / known gaps
Everything in the design doc's anti-cheat/backend/economy sections · Trailer–scenery collisions · repair/refuel · traffic sound (horn/siren), vehicle–vehicle crashes, traffic on the shoulder / stalled vehicles · touch controls · server-side ride validation · real wallet/crypto integration ·
the player can't turn into side roads (junctions are features of the one spine) · no turning traffic at junctions, no cross traffic at T-junctions / unsignalled crossroads (they have STOP signs) ·
no props/furniture along side roads and the main road behind the depot · no floating origin: Float32 road vertices start to jitter past ~100 km.

## Style
Dense, mostly one-statement-per-line code; comments say *why* or give units, not *what*. Match the surrounding file. No dependencies beyond three.js.
