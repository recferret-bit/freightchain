---
name: highway-lighting
description: >
  Day/night cycle, route solar curves, dual headlight cone, 12-lamp roadside
  pool, emissive traffic lamps, cab glare/dome wash, and NIGHT/DAY live effects
  on the Freight Chain highway. Use when running /highway-lighting.
---

# Highway Lighting & Day/Night Pipeline

Freight Chain lights an endless 3D highway at 60 fps with **zero** `THREE.Light` objects. All world illumination runs through the single `MeshBasicMaterial` `onBeforeCompile` shader in `frontend/client/js/world/nightlight.js` driven per-frame by `frontend/client/js/world/daynight.js`, paired with `toneMapped: false` self-lit lamp lenses and additive `glow.js` sprites.

For shader math and material tracking rules, see [shader-texture-tuning](../shader-texture-tuning/SKILL.md).

---

## 1. Clock & Route Daylight Curves

- **State (`dn` in `frontend/client/js/state.js`)**: `t` (`0..24` h), `phase` (`day | dusk | night | dawn`), `k` (`0..1` night factor), `head` (headlights `L`), `cab` (cab dome lamp `C`), `blind` (oncoming glare).
- **Server-Assigned Start Hour**: Rides lock `Ride.startHour` (`dawn = 6.5`, `noon = 12`, `dusk = 18.5`, `night = 22`) via `setClock(..., assigned)` (`dn.scale = 20`). Paid live-stream `NIGHT` / `DAY` effects (`live-effects.js` → `ui/live-feed.js`) are the only runtime override past `lockClock()`.
- **Per-Route Solar Envelopes (`themes/<route>/index.js` `daylight`)**: `{ rise, set, tw, peak, warm, stars }`:
  - `siberia`: low sub-arctic sun (`rise: 9.5, set: 15.5, peak: 0.22`).
  - `stuart`: harsh outback noon (`peak: 0.95`, short twilight).
  - `sky-dome.js` and `scene.fog.color` share **one** computed horizon colour in `updateDayNight()` so distant mountains/props dissolve seamlessly into the sky at dusk, dawn, and night.

---

## 2. World Illumination Sources

1. **Ambient Floor (`CFG.NIGHT_AMBIENT = 0.002`)**: With headlights off (`L`) on an unlit desert/taiga stretch, the unlit world drops to near-total darkness (`0.2%`).
2. **Player Truck Headlight Cone (`nlBeam*` uniforms + `updateBeam`)**:
   - Projected forward cone in `nightlight.js` scaled by `dn.k` (invisible at noon, crisp beam throw on asphalt, guardrails, signs, and traffic ahead at night).
   - Paired with `updateBeam` additive halo (`toneMapped: false`).
3. **12-Nearest Roadside Street Lamps (`LAMPS` uniform array)**:
   - `themes/_shared/furniture.js` exposes pure `lampAt(ci)` station lookup.
   - Every frame, `daynight.js` populates the fixed 12-slot `LAMPS` uniform array (`CFG.LAMP_RADIUS`, `CFG.LAMP_GAIN`) around the camera without allocating objects or requiring distant chunks to be built.
   - Smashing a `KINDS.lamp` post in `sim/damage.js` hides its `userData.glow` role and extinguishes that post.
4. **Self-Lit Traffic & Corridor Emissives (`toneMapped: false`)**:
   - Vehicle lenses (`lampMat` in `world/vehicles.js`: `HEAD`, `TAIL`, `BRAKE`, `REVERSE`, `AMBER`, `RED`, `BLUE`), billboard `glow()` sprites (`opacity` tracks `dn.k`), ground `beam()` decals, and the overhead `gantry` banner bypass `nightlight.js` darkening so tail-lights and emergency beacons punch cleanly from `300 m` at midnight.

---

## 3. Cockpit Glare & Interior Wash (`cockpit/effects.js`)

- **Oncoming Glare**: `updateGlare()` computes `dn.blind` (`dn.bx`, `dn.by`) from opposing traffic headlamps; `blindEffect()` renders the windshield bloom wash in 2D Canvas.
- **Interior Night Grade**: `nightGrade()` uses `source-atop` compositing so only opaque dashboard/pillar pixels darken at night while windshield glass and mirror cutouts stay transparent to the 3D WebGL canvas underneath.
- **Cab Dome Lamp (`C`)**: `overhead.js` lens + `cabGlow()` warm tungsten wash (`CFG.CAB_DAY` fraction during daylight).

---

## 4. Anti-Patterns (Never Introduce)

- Never instantiate `THREE.PointLight`, `SpotLight`, `DirectionalLight`, or `HemisphereLight`.
- Never leave `toneMapped: true` (the default) on a lamp bulb, beacon, or emissive banner — `nightlight.js` will multiply it by `0.002` at night and turn it black.
- Never grow `LAMPS` without changing both `daynight.js` and the GLSL array bound in `nightlight.js`.
- If asked for transient weather flashes (e.g., lightning), pulse the existing shared sky/fog horizon + `dn.blind` + a short-lived pooled `mesh()` bolt (`toneMapped: false`) — never add a post-processing pass or scene light.
