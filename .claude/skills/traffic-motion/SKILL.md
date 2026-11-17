---
name: traffic-motion
description: >
  Runtime highway behaviour of AI traffic vehicles and destructible roadside
  objects: cruise, braking, lane-change blinkers, 4-way crash hazards, 6 Hz
  siren alternation, prop topple, and debris bursts. Use for /traffic-motion.
---

# Highway Traffic Motion & Impact Presentation

Shared simulation (`frontend/client/shared/traffic-simulation.js`, mirrored by the server's 10 Hz `ReplayEngine`) owns every vehicle position, lane change, and collision verdict. Client presentation (`frontend/client/js/sim/traffic.js` `place()` and `sim/damage.js`) purely reflects simulation flags onto pooled 3D meshes.

---

## 1. Traffic State → Visual Mapping (`sim/traffic.js`)

| Sim State | Trigger | Visual Presentation |
|---|---|---|
| Cruising | `drive`, no decel, on-lane | Sculpted hull + steady `HEAD` / `TAIL` lenses + night headlight `beam`; `brake` and `ind.*` groups hidden. |
| Braking | `a.brake` (`decel < -1.2 m/s²` or limp/yield) | `userData.brake.visible = true` (bright rear brake lenses + high-mount brake bar + red `glow`). |
| Lane change / dodge | Lateral target offset `> 0.4 m` | `ind.l` or `ind.r` blinks at `3 Hz` (`Math.floor(a.t * 3) % 2`) across front, side-repeater, and rear amber lenses. |
| Hazard / incident | `crashed`, `honk`, `back`, `hold` | Both `ind.l` and `ind.r` blink together at `3 Hz`. |
| Emergency response | `userData.flash` (`police`, `medic`, `fire` only) | `flash.0` and `flash.1` alternate at `6 Hz`. (`trafficSnapshot` records presence of `flash`, never civilian vehicles.) |

---

## 2. Roadside Impact: Topple vs Shatter (`sim/damage.js`)

- **Slender Corridor Furniture (`falls`)**:
  - `post`, `pole`, `lamp`, and `sign` pitch forward (`rotation.x`) when struck; smashed `lamp` hides `userData.glow`.
  - `guard` (W-beam guardrail) pitches outward away from the carriageway (`rotation.z`).
- **Brittle / Natural Props (`burst()`)**:
  - Trees, rocks, cacti, bushes, cairns, and drifts shatter into pooled `mesh()` chunks coloured from the entity's `debris` slot (`road-particles-3d`).

---

## 3. Hard Simulation / Anticheat Boundary

- Never change `frontend/client/shared/traffic-simulation.js` or `damage.js` collision thresholds for visual flair without updating server anticheat tests (`traffic-sim.spec.ts`, `replay-engine.spec.ts`).
- Never write `st.s` or mutate recorded 10 Hz telemetry samples from rendering/animation code.
- Verify live traffic motion with headless simulation (`npm --prefix frontend/client run check`) and real Chrome (`node frontend/client/tools/e2e-chrome.mjs`), not static `viewer.html` stills alone.
