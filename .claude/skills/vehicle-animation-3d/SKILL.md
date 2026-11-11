---
name: vehicle-animation-3d
description: >
  Motions Freight Chain already draws: a blinker, a brake light, a siren
  flash, and the 2D cab (wiper, steering wheel, levers, gauge needles).
  Wheel spin is not one of them. Use when the user asks for a traffic
  animation, a crash pose, or a part that should move, or why a lamp does
  not blink in the model viewer. Use when the user runs /vehicle-animation-3d.
---

# Vehicle animation

Catalogue meshes are data-only entities. A moving part is a group whose role the game shows or hides, or a stroke on the cab canvas. Rigid parts stay rigid. A new motion is never a vertex shader and never a new `THREE.Light`.

## Roles

Declared on the entity, bound in `frontend/client/js/world/entity-build.js` onto `userData`, toggled in `place()` in `frontend/client/js/sim/traffic.js`. The closed set is `ROLES` in `frontend/client/shared/entity/plan.js`.

| role | sim flag |
|---|---|
| `brake` | `userData.brake.visible = a.brake` |
| `ind.l`, `ind.r` | blink from the signal (`Math.floor(a.t * 3) % 2`). Both, while `crashed`, `honk`, `back`, or `hold` |
| `flash.0`, `flash.1` | alternate at 6 Hz (`Math.floor(a.t * 6) % 2`) |
| `glow` | a roadside lamp, not a vehicle. `damage.js` hides it when that lamp is smashed |

Authored in `frontend/client/shared/entity/seed/part/veh-lights.js` (indicators and brake start `visible: false`) and `veh-siren.js`. The roster contract is `frontend/client/shared/entity/roster.js`: only `police`, `medic`, and `fire` list `flash`. `schema.js` rejects it on any other type. The ride snapshot stores that a mesh has `flash` (`trafficSnapshot`). Do not add a siren to a sedan for looks.

## Cab

The player's truck is a 2D cab, not a 3D rig. `frontend/client/js/cockpit/`: `wheel.js`, `shifter.js`, `windscreen.js`, `lamps.js`, `glass-fx.js`, needles in `gauges.js`. `cockpit/*` must never import the scene.

Landing dash cards crop that canvas (`frontend/landing/src/dash-live.js`, `dash-scenes.js`) and keep their own copies of `st`, `wip`, and `lever`. Changing a cockpit draw changes the cards.

## Wheels

Wheels do not spin. They are static geos in `frontend/client/shared/entity/seed/part/veh-wheels.js`, tagged `tyre`. Do not add a per-frame wheel rotator. If asked for wheel spin: the mesh is static. A spinner would be a separate, explicit change, and it must stay out of the physics sample. Do not implement it from this skill.

## A new motion

One of two places:

1. A role group's visibility: the entity, the toggle in `traffic.js` `place()`, and a `roster.js` row when the ride recording stores it.
2. A 2D cab draw under `cockpit/`.

A visual that changes recorded samples or writes `st.s` is an anti-cheat problem (`docs/spec/anticheat.md`). A fatal hit must not write `st.s`.

## Still vs running

`frontend/client/viewer.html` shows the rest pose. It will not show a blink. Indicator and brake groups stay dark there until the sim shows them. Stills: `storybook-viewport`. The entity edit: `model-geometry-validator`. The mesh: `traffic-vehicle-3d`. Headlamps and night: `highway-lighting`.

Spawn, lane change, and crash live in `frontend/client/js/sim/traffic.js` (state in `frontend/client/shared/traffic-simulation.js`). Check those with a running sim, not a storybook still. Headless playthrough: `docs/agents/verifying.md`.

## Review

- Which role, which flag (`a.brake`, the signal or a hazard state, `userData.flash`).
- `flash` on a civilian.
- An indicator that is lit in the still viewer. It should be a group, dark until the sim shows it.
- A draw that writes `st.s` or edits a recorded sample.
- A cab change that forgets the landing card copies.
