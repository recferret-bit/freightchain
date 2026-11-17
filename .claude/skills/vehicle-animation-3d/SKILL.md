---
name: vehicle-animation-3d
description: >
  Role-driven 3D traffic lamp animations (brake, turn/hazard blinkers, 6 Hz
  emergency flashers, roadside lamp glow) and 2D truck cockpit motion (steering
  wheel, shifter, wipers, gauge needles). Use when running /vehicle-animation-3d.
---

# Vehicle & Cockpit Animation Architecture

Freight Chain separates runtime motion cleanly into two zero-allocation mechanisms:
1. **3D World Entities**: Rigid pooled meshes (`entity-build.js`) with named `role` sub-groups toggled in `frontend/client/js/sim/traffic.js` (`place()`) and `sim/damage.js`.
2. **2D Player Cockpit (`frontend/client/js/cockpit/*`)**: Immediate-mode 2D Canvas kinematics (`wheel.js`, `shifter.js`, `windscreen.js`, `gauges.js`, `lamps.js`, `glass-fx.js`) — strictly acyclic with `world/*` and `three`.

---

## 1. Declarative 3D Role Bindings (`ROLES` in `plan.js`)

| `role` | Authored In | Runtime Toggle & Behaviour |
|---|---|---|
| `brake` | `seed/part/veh-lights.js` (`visible: false`) | `userData.brake.visible = a.brake` (tail brake lenses + high-mount brake bar + additive `glow` sprites). |
| `ind.l`, `ind.r` | `seed/part/veh-indicator.js` (`visible: false`) | Blink at `3 Hz` (`Math.floor(a.t * 3) % 2`) during lane changes / obstacle dodges; **both** blink in unison as 4-way hazards during `crashed`, `honk`, `back`, or `hold`. Front, side-repeater, and rear amber lenses + `glow`. |
| `flash.0`, `flash.1` | `seed/part/veh-siren.js` | Alternate at `6 Hz` (`Math.floor(a.t * 6) % 2`) on **emergency vehicles only** (`police`, `medic`, `fire` — locked by `roster.js`, `schema.js`, and anticheat `trafficSnapshot`). |
| `glow` | `seed/furniture/lamp.js` | Roadside street-lamp bulb + halo; hidden permanently by `sim/damage.js` when a `lamp` post is knocked down. |

- **Static Wheels by Design**: `veh-wheels.js` tyres (`wheel20` / `wheel48`, `tag: 'tyre'`) are static pooled meshes; do not add per-frame wheel rotation loops unless explicitly requested, and never mutate physics/replay samples from visual code.
- **Rest-Pose Viewer (`viewer.html`)**: `brake`, `ind.l`, and `ind.r` stay hidden (`visible: false`) at rest in `viewer.html` unless toggled via viewer controls (`brake` / `siren` checkboxes in `viewer.js`).

---

## 2. Cockpit Canvas & Landing Card Compatibility

- Every player-cab motion (`wheel.js`, `shifter.js`, `windscreen.js` wiper arc, `gauges.js` needles) draws in responsive cockpit units `u = min(H / 100, W / 150)`.
- `frontend/landing/src/dash-live.js` (`dash-scenes.js`) and `wp-scenes.js` import `cockpit/*` directly without Three.js. Never import `world/*` or `three` into `cockpit/*`, and verify landing build/tests (`npm run landing:build && npm run landing:test`) whenever cockpit rendering changes.
- Visual animations must **never** write `st.s` or alter recorded telemetry samples (`docs/spec/anticheat.md`).
