# The game (client/) – run, layout, conventions, caveats

Agent reference, moved verbatim out of `AGENTS.md` (which keeps only the map and the hard rules and is loaded into every agent session); an "In short" block, where there is one, is a summary. Read the file for a topic before changing it; keep it current like AGENTS.md ("Maps stay current"). Paths are relative to `client/` unless they start with `server/`, `landing/` or `media/`.

## Run it

```sh
# from client/
./serve.sh                       # python http server on :8765 + opens the browser (or: python3 -m http.server 8765)
node tools/build-standalone.mjs  # optional: one self-contained dist/freightchain.html that works when double-clicked
```

- The multi-file version **must be served over http**. Opening `play.html` via `file://` is blocked by CORS (blank page; after 2 s a "COULD NOT START" panel explains why).
  `dist/freightchain.html` (built by `tools/build-standalone.mjs`, needs `npx esbuild`) inlines everything and does work from `file://` – rebuild it after code changes; it is not committed/updated automatically.
- It needs internet: three.js is loaded from jsdelivr (version pinned in the `importmap` in `play.html`).
- Debug handle in the console: `window.__game` (`devRun(tripId)` = the plain sim for tools – classic road, no helpers – `holes`, `st`, `disp`, `CFG`, `Wallet`, `input`, `startRide`, `tryShift`, `ignition`, `curv`, `selectTheme(id)`, `THEMES`, plus traffic's `spawn`/`traffic`, the phone map's `toggleMap` / `phone`, `forkRules` = `FORK`).

## Layout

```
play.html             the game page: markup + importmap + <script type="module" src="js/main.js">
css/style.css         HUD, toast, menu overlay
js/main.js            entry: wires modules, runs the frame loop
js/config.js          CFG – every tunable constant (ride length, shake strengths…)
js/util.js            clamp, approach, rnd (hash noise), mulberry32 (the seeded PRNG), `store` (localStorage that never throws – use it, not raw localStorage), fmt (mm:ss), MONO font
js/state.js           `st` (truck/ride state; `rideStart()` = the per-ride fields and their start values, shared with `resetRide`), `input`, `disp` (sprung gauge values), drivetrain constants, `clock`
js/road.js            road centre-line ("spine"): curvature → heading → x/z table, ENDLESS (grows on demand, Float64), s < 0 extrapolated; roadAt(s); `setRoadProfile(fn)` (installed by net/network.js)
js/net/patterns.js    road PATTERNS (country / highway / arterial / town, + `dual` (four lanes, no junctions), `fork`, and the free levels' 500 m blocks `xroad` / `xroad4` (exactly one crossroads) / `open` (none) – weight 0 except on the trips that ask for them: lanes, bends, junction spacing, signal odds), `FORK` (len 1200, bulge .55, commit 205, corridor 15) – see "Road network"
js/net/network.js     `net` = RoadNetwork: seeded lazy layout (segments, junctions, start), cross-section `xs(s)`, lanes, `onRoad`, `keepOut`, `roadside`, signals, main-road / side-road frames, forks (`forks`, `forkAt` / `forksNear`, `altAt` = the other road, `sep`, `apron`, `setChoice`)
js/net/obstacles.js   road holes as DATA (no three.js): HOLES table, `rollHole(ci)` (the local roll), the server's plan (`plan`, `installPlan`, `planCovers`), `holesIn` / `holeAt` / `holesNear`, `placeHole` / `obstacleSpot` (paid holes, beside a chunk's own), `flagHole` (a replay's red ring) – ported to server/src/domain/road
js/road-plan.js       online rides + replays: fetches the ride's obstacle plan from the server (GET /api/watch/:id/road, 6 km windows 3 km ahead, backoff) and installs it
js/net/orchestrator.js `roads` = RoadOrchestrator: newTrip / setTheme / per-frame update (signal clock, generation, the road taken at a fork – `forkCommit` –, chunk streaming, signal lenses, red-light check) / `setBranch` (a replay's fork road) / HUD status
js/hosts.js           `API_BASE` / `GAME_BASE` / `SITE_BASE` / `STORYBOOK_BASE`: where the API, the game and the lobby live (`api.`/`ride.`/`storybook.`/apex on a real domain, '' = same origin elsewhere) – see "Split hosts"
js/fingerprint.js     browser fingerprint (SHA-256 of UA, screen…) – a LEAF; no longer used (the guest run sends nothing)
js/offline-ride.js    the guest run's flags (`offlineRide.on` / `.dev`, `offlineWanted()` = not a ride, not a replay) + the connect-wallet link – imports hosts.js only
js/mobile.js          mobile device detection (`isMobileDevice`), toast notification (`showMobileToast`), and desktop-only driving blocker (`showMobileBlocker`) – a LEAF
js/cosmetics.js       promo cosmetics: the catalog (mirrors the server's), `LOOKS`, the worn `loadout` / `setLoadout` / `look(slot)` – a LEAF module, read by cockpit/rig.js, set by online.js from GET /api/wardrobe
js/trips.js           TRIPS: the road per ride tier (the free levels free-1c / free-2c / free-3b + the guest run free-g, 1h / 4h / 8h, the frozen classic / free / free-1 / free-2 / free-3 / free-1b / free-2b – bends, traffic, cross traffic, calm presets, roadside density, `finish` = the free run ends itself as a win, `start` = 'depot' (STOP line + right turn) or 'straight', `level` / `assist` = the free levels, `holesFrom` + `road` (first patterns, weights, × hole chance) = JUDGED, mirrored by the server's `road-rules.ts`); `FREE_LEVELS`; multipliers on CFG, '1h' = all 1 = the old road; set from the trip id the server stamped on the ride (`tripOf`) before the road is built, `?trip=` offline (a free trip's own shift, e.g. `?trip=free-2` = 180 s / 1512 m) – a LEAF; skill `trip-design`
js/world/scene.js     renderer, scene, camera, canvasTex() (nothing route-specific any more)
js/world/environment.js  `env` = the applied route's sky / terrain / mountains / road material / props / furniture; applyTheme()
js/world/daynight.js  day/night: exposure + night sky/fog fade (`dn.k`, re-applied every frame so route switches keep it), headlight pool decal; js/world/glow.js = lamp glow sprites
js/world/theme-manager.js  selectTheme(id): applies a route + its road curvature + trailer livery, rebuilds chunks, remembers the choice
js/world/props.js     shared geometry, mk(), KINDS (destructible-prop table: hp/r/dmg/slow per kind), `destroyed` set
js/world/pool.js      object pools (`ObjectPool`, `mesh()`, `group()`, `releaseTree()`) – leaf module, see "Object pools"
js/world/spacing.js   the roadside spacing rule (leaf, no three.js): footprints, ranks (building > furniture > hole-warning sign > scenery), GAP 1.2 m, `insideChunk` – chunks.js places in rank order and DROPS what would stand inside / too close to something else; unit-tested (`client/test/spacing.test.mjs`, `npm run test:unit`) and re-checked on every route x layout by the headless test ("road content …")
js/world/chunks.js    `RoadObjectManager` (`roadObjects`): 32 m road chunks streamed around the truck (road strips + junctions + depot + the route's props/furniture), built from / recycled into the pools
js/world/roadmesh.js  pooled rewritable strip meshes (`stripPool`): spine surface, markings (atlas), side roads; `buildSpine`, `markLines`, `strip`, `bar`
js/world/junctions.js junction aprons, side roads, stop lines, traffic-light masts (`heads`, `updateSignals`), STOP signs, the main road behind the depot turn
js/world/depot.js     the start: yard, warehouse + docks, parked trailers, exit / speed-limit signs (chunk 0)
js/world/trailer.js   the trailer (only visible in mirrors)
js/world/holes.js     road holes + warning signs: the meshes (+ the red ring of a replay's NO IMPACT hole); re-exports net/obstacles.js; see "Road holes"
js/world/vehicles.js  traffic vehicle types (VEHICLES table: size/mass/speed/allowed presets) + mesh builders; `vehicleMats` feed FLIP_MATS
js/viewer.js          model viewer catalogue (`viewer.html`, storybook): the same builders — skill `3d-assets`
js/sim/traffic.js     traffic: main road + crossroads side roads, spawn zones, AI PRESETS (IDM car-following + lanes + signals), truck contact (aligned: scratch / bump / direct hit; at an angle: closing speed)
js/world/render.js    per-frame 3D render, camera shake, trailer hitch, mirror passes, resize()
js/sim/physics.js     drivetrain (clutch/gears/stall/ignition), steering, ride end conditions
js/sim/damage.js      collisions, prop destruction, debris, windscreen cracks, hull damage
js/sim/climate.js     ambient °C (`ambientC()`), engine heat balance → `st.temp` (°C), cab heater (`toggleHeater`) and cooler (`toggleCooler`, `fogDrive`), cold-engine wear; see "Climate"
js/sim/shake.js       rpm / engine shake helpers (strength comes from CFG.SHAKE_*)
js/ui/tuning.js       F2 panel: sliders for every `CFG.TRUCK` handling constant (mass, brake, steering lag, body sway…), saved in localStorage['freightchain.truck']
js/sim/radio.js       cab radio: 11 instrumental stations (country, honky-tonk, heavy metal, classic metal, synthwave, rock, desert blues, pop, jazz, lo-fi, chiptune) of procedurally generated songs (seeded PRNG + wall-clock "broadcast", Web Audio scheduler, no voices); `STATIONS`, `radio`; dash panel = `radioPanel()` in cockpit/common.js
js/sim/audio.js       the sound: the engine bed + reverse beeper are synthesized live; every other effect is a SAMPLE – `audio.play(id, vol, rate)` plays a tiny mp3 from `audio/sfx/` (24 sounds, ~73 kB: shift, grind, key, engine-off, park brake, switches, wiper, washer, radio, bump / crash / smash / scrape / pothole / glass, warn / alarm, stall, complete, game-over…). They are built by `npm run media:game-sfx` (recipes `media/audio/game-sfx.mjs`, mono 32 kHz mp3, file name = content hash → immutable, `audio/sfx/manifest.json` lists them) and downloaded ASYNC: `startRide` calls `audio.start()` before the online await (that call also resumes the context); `load()` then fetches the manifest and decodes one sample at a time, low priority, `start` and the first-minute ones first. A failed manifest is retried on the next `start` or `play`. The newest `play` before its buffer arrives is kept for 2 s. crash / stall fall back to the synth only while that sample is missing. Mute sets the sample bus to 0, so a sound already playing stops. A new sound = a recipe + `audio.play('id')` where it happens + `npm run media:game-sfx` (media tests fail on drift / an unknown id)
js/cockpit/canvas.js  2D cockpit canvas, `view` {W,H,DPR}, `cockpitState.style`, mirrorRects()
js/cockpit/common.js  gauges, lamps, LED bars, clickable dash buttons (uiButton/uiBtns)
js/cockpit/rig.js     DEFAULT cockpit: conventional long-hood semi (hood, stacks, mirrors, air gauges, CB…, the phone on its dash mount right of the bonnet – `drawPhoneMount`, the live map on its screen, "MAP · N")
js/cockpit/windscreen.js  dust, washer water, wipers, frost, warm-route fog, cracks, hood smoke, exhaust-stack smoke
js/cockpit/index.js   drawCockpit(): picks the style + red impact flash
js/cockpit/inputs.js  a replay's input display: flashing yellow borders on the dash controls the driver used (pointer + ring for a click), key caps for the keys
js/ui/game.js         ride flow: menu / start / end / pause / resetRide, and the walk-off (top right while driving, and on the pause screen): I MISS THE YARD is the lobby, I'M DONE is the landing — each names where it goes, and asks YES / I'M STAYING first
js/themes/_shared/theme.js  defineTheme(): assembles a route from its folder's modules + plain data (see "Themes")
js/themes/_shared/landmarks/  roadside buildings (motel, hotel, restaurant, gas, police): TYPES → interchangeable implementations; see "Landmarks"
js/themes/            ONE FOLDER PER ROUTE – see "Themes (routes)" below
js/ui/input.js        keyboard + dash-button mouse input
js/ui/toast.js        transient messages
js/watch.js           live streams, the SPECTATOR (play.html?watch=<id>): polls GET /api/watch/:id and replays the recording into `st` (`st.watch` = no sim, no input; traffic off)
js/ui/watch-panel.js  the watch page's panel: status, timeline (live edge / replay speeds), the ride's feed, chat box + mock donation buttons, wallet sign-in (site/wallet.js)
js/ui/live-feed.js    live streams, the DRIVER (online rides): polls its inbox, CB panel in the cab, applies paid effects (night / day / a hole ahead) and stamps them back
js/ui/cab-chain.js    TICKET rides only (`ride.poolId`): the cab's ON CHAIN strip – pool + road seal (re-hashed, then the pool account read from the cluster's PUBLIC RPC – `site/pools.js` `POOL_PROGRAM` / `publicRpc`, the one place the game talks to Solana directly – and compared byte for byte: ✓ on chain, or amber "server copy" when the RPC is down / the account closed), prizes / riders / leader / your verified rank (GET /api/pools/:id + /standings, `CFG.CHAIN_POOL_POLL_MS`), the ride's pledges with a toast per new lock and the ≈ payout at the km driven (`CHAIN_PLEDGE_POLL_MS`); the seal row on the START / end panel
js/seal.js            pure: `checkSeal(ride)` re-hashes the program v3 road seal in the browser (SHA-256(pool ‖ slot hash ‖ slot) = commitment, its first 4 bytes = the seed), `poolAccountSeal` / `chainSealMismatch` (the Pool account's seal at bytes 200–272), `pledgeEstimate` (settles on the driver's BEST verified ride of the pool, flagged = 0) – test/seal.test.mjs (incl. the program's recorded fixture); e2e-chrome.mjs drives the strip with the API + RPC stubbed
js/input-bits.js      the replay's input column (sample column 14): control ⇄ bit table (frozen; `map` = 1 << 26 and `cold` = 1 << 27, both skip bit 25 = MOUSE), key / dash-button code → bits, the spectator's input lights; LEAF (telemetry.js writes, watch.js reads, cockpit/inputs.js draws)
js/phone.js           the cab's PHONE (`open`, `thumb`) – a LEAF: cockpit/rig.js imports it instead of ui/map.js, so cockpit/ stays free of the road network (the landing's dash cards bundle it)
js/ui/map.js          the PHONE MAP (N, or a click on the dash phone; EXIT / Escape closes): a phone-maps-style navigation map drawn into a canvas from the ride's own road – heading-up (compass = north-up), zoom ± / wheel, drag to pan (◎ or 15 s idle = back to the truck; `CFG.PHONE.FREE_MAX` / `FREE_IDLE`); off the road the blue route stays ON the road and a dotted blue line leads back to it; the phone is OFF at the start of a ride, boots with the engine (`CFG.PHONE.BOOT` 3 s: the Freight Chain mark – our own three bars in the Solana colours, NOT the Solana logo – which goes dark; then a home screen with app icons for `HOME` 2.5 s, Maps is pressed (at `LAUNCH_AT` 2 s – all in `CFG.PHONE`) and grows from the centre of the screen into the map – no cross-fade; the controls slide in; `phone.power` 0 off · 1 boot · 2 home · 3 on; a tap on the Maps icon opens it at once, the other icons only bounce) and goes dark when the engine stops (`phone:power-off`; the next start boots it again); every tap / pan / zoom / place / open / power / route-lost event is recorded as a `phone:<what>` input (`telemetry.js recordPhone`), the truck as a blue arrow, the route to the finish in blue, a fork's other road in grey ("OTHER ROAD · SAME DISTANCE"), junction side roads, live traffic-light colours, town blocks, the depot, the roadside landmarks the world builds (hotels / motels, gas stations, police, food – badges from `env.landmarks.site(ci)`, same rule as chunks.js; tap one for its distance), the finish pin (on both roads inside a fork), a next-step card, a sheet with the ETA to the finish line, time driven (`st.t`) and distance / shift distance (`st.s`, `CFG.COMPLETE_DIST`) with a bar, the trip (no road-name label rides along with the truck); night palette. READ-ONLY (game, recording and judge unchanged); spectators can open it in a replay; ASSIST tips it before a fork
js/live-effects.js    the effect table shared by both sides (mirrors server/src/domain/live/live-rules.ts) + the feed cursor rule
tools/                e2e-chrome.mjs (real headless Chrome), cdp.mjs (the Chrome/DevTools harness both e2e scripts share), trace.sh (save / diff the headless trace), headless-test.mjs + stub-three.mjs (Node, no browser), build-standalone.mjs
serve.sh              local server launcher
package.json          npm scripts only, no dependencies: `npm run check` (lint + bundle + headless), `trace:save` / `trace:diff`, `test:e2e`, `test:viewer`, `build`
eslint.config.mjs     flat lint config (no-undef, no-unused-vars) for js/ and tools/
dist/                 generated standalone build (git-ignore / regenerate; not source)
```

Dependency rule: modules are **acyclic** (checked with esbuild's metafile). `ui/game.js` sits above `sim/*` and `world/*`;
`sim/*` must not import from `cockpit/*`. Keep it that way, or top-level `const`s start hitting TDZ errors.


## Caveats – read before changing things

### Money / anti-cheat (the part that matters for the product)
- **There is no in-game currency any more** (the old mock FRT wallet, its fare, "+100 test FRT" and payout row are gone): a lobby ride is paid with a free ride or a ticket, the guest free run starts for free. Never trust client-side state for money.
- **`CFG.RIDE_MIN_SECONDS` is a TEST value (300). Production = 1800.** The road never ends; a shift is **complete** (`st.complete`, toast) after `RIDE_MIN_SECONDS` of driving
  AND `COMPLETE_DIST = COMPLETE_DIST_K × MAX_SPEED × RIDE_MIN_SECONDS` metres. Speed is governed at `MAX_SPEED` (28 m/s), so idling/backgrounding can't bank it.
  The ride then goes on until the driver leaves (top right, or P: I MISS THE YARD is the lobby, I'M DONE is the landing — each asks YES / I'M STAYING; paid if complete, otherwise "abandoned") or it fails. **That is not security**: a modified client can complete instantly.
  Real enforcement (signed ride start, server-side timing/telemetry, payout only after validation) must live on a server.
- Frame `dt` is clamped to 0.05 s and the game pauses when the tab is hidden, so on a slow machine (<20 fps) game time runs slower than wall time.
- At 1800 s the road is ~50 km (3 Float32 tables of ~50k entries – fine; chunks stream). Dust, fuel, etc. were only ever tuned for the 30 s test ride.

### The sim is not replayable
Don't assume a ride can be replayed or validated by re-running the sim:
- The sim uses floats (`Math.sin/cos`), a **variable `dt`** (clamped to 0.05 s) and **`Math.random()`** inside gameplay (steering-pull side, bug splats, dust, debris).
  A server-replayable core needs a fixed 60 Hz tick, seeded PRNG, fixed-point math, and the inputs as a recorded tick stream. The force law, road geometry/network, route curvature and traffic AI now live in renderer-independent `client/shared/` factories; the browser wrappers retain the driving behavior. Sharing code alone does not recover omitted frame state: historical traffic/coasting reconstruction only flags for review. New online rides record hashed lossless traffic frames for strict server validation without changing the variable frame clock or offline simulation.
- `CFG.COMPLETE_DIST`, the speed governor and the road generator (net/network.js + the theme's `curv`) would all need to be identical in the server sim. The layout IS a pure function of
  the ride seed (`roads.seed`, own mulberry32), but the centre-line is integrated in floats.

### User-tuned values – don't change without asking
`CFG.SHAKE_START = 0.45` (engine start-up/idle/shut-off), `SHAKE_MOVING = 0.09` (speed shake), `SHAKE_RPM = 0.315` (rpm shake).
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
- Everything is `MeshBasicMaterial` (no scene lights) + fog. `CFG.FORM_SHADE` (F8) adds a daytime sun shade from the world normal and a 2 cm edge on boxes (`world/nightlight.js`); upward faces stay at the flat colour, and the term fades out at night. Canvas textures are sRGB. The sky `ShaderMaterial` writes raw colours (no colour-space conversion) – don't "fix" that.
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

### Mobile support & spectating
- **Driving is blocked on mobile**: `isMobileDevice()` detects mobile UAs and touchscreen devices. Driving attempts from the landing page or lobby trigger a toast notification (`showMobileToast()`) directing players to live streams and replays. Opening `play.html` directly in driving mode halts the frame loop and physics, rendering a desktop requirement modal (`showMobileBlocker()`).
- **Spectating streams and replays is supported on mobile**: `play.html?watch=<id>` permits mobile devices; the `#watch` panel adapts responsively as a bottom sheet (portrait) or right-docked side sheet (landscape) with touch-friendly targets.

## Not implemented / known gaps
Fixed-tick server replay · Trailer–scenery collisions · repair/refuel · traffic sound (horn/siren), vehicle–vehicle crashes, traffic on the shoulder / stalled vehicles · touch controls · server-side ride validation · the escrow program is not deployed yet (devnet next, not audited) · on-chain session keys ·
the player can't turn into side roads (junctions are features of the one spine; a FORK is the one real choice of road, and both of its roads are the same road in (s, d)) · no turning traffic at junctions, no cross traffic at T-junctions / unsignalled crossroads (they have STOP signs) ·
no props/furniture along side roads and the main road behind the depot · no floating origin: Float32 road vertices start to jitter past ~100 km.
