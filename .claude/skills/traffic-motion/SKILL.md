---
name: traffic-motion
description: >
  How a vehicle on the Freight Chain road acts: idle lamps, a brake light,
  a blinker, a siren flash, being hit, and a crash that smashes a prop.
  Wheel spin and the cab wiper are not this. The sim owns the position; the
  picture only shows the flag. Use for a traffic animation that a still will
  not show. Use when the user runs /traffic-motion.
---

# Traffic motion

The sim owns positions and damage. The picture only shows the flag. `place()` in `frontend/client/js/sim/traffic.js` puts each mesh where the sim left it. The renderer does not walk them. Indicator, brake, and flash are the motion.

## States

| state | flag | picture |
|---|---|---|
| idle | `drive`, no brake, no lane aim | lamps as authored. Brake and indicator groups stay dark. Headlamps are materials (`highway-lighting`), not a toggle here |
| braking | `a.brake` (deceleration under −1.2 m/s², or a limp state forces it) | `userData.brake.visible` |
| indicating | lane aim or a hole dodge (`dLat` / `target`, gap over 0.4 m) | `ind.l` or `ind.r`, blink `Math.floor(a.t * 3) % 2` |
| hazard | `crashed`, `honk`, `back`, `hold` | both indicators, same blink |
| emergency flash | mesh has `userData.flash` | `flash.0` and `flash.1` alternate at 6 Hz. Only police, medic, fire (`frontend/client/shared/entity/roster.js`). The snapshot stores that bit, not the phase |
| being hit | `contact()` in `frontend/client/shared/traffic-simulation.js` | the other vehicle becomes `crashed` (hazards). No separate hit pose |
| smashing a prop | `destroyProp` in `frontend/client/js/sim/damage.js` | below |

Spawn, lane change, and crash live in `traffic.js` and `traffic-simulation.js`. Check them with a running sim, not a storybook still. Headless playthrough: `docs/agents/verifying.md`.

## Smash and topple

Not a posed character. `frontend/client/js/sim/damage.js`:

- `post`, `pole`, `lamp`, `sign` topple forward (`falls`, rotate about X).
- `guard` falls outward, away from the road (rotate about Z).
- anything else bursts into pooled boxes. The burst is `road-particles-3d`. How to judge it is `particle-effect-validator`.
- a lamp's `glow` hides when that lamp is smashed.

Contact is a collision in `traffic-simulation.js` `contact()` or `damage.js` `collide()`, not a rendered bite. Do not invent a second impact, horn, or smash from the picture. The sim already counts the hit. A fatal vehicle hit returns before any `st.s` write. A visual must not write `st.s` (`docs/spec/anticheat.md`). Wheels stay the static `tyre` geos (`vehicle-animation-3d`).

## Review pairs

- A brake lamp that never toggles. It needs role `brake`. `place()` sets visibility from `a.brake`. A material that is always lit is not a brake light.
- `flash` on a civilian (sedan, truck, bus, freighter). `roster.js` and `schema.js` forbid it. The recording would store a siren that type does not have.
- An indicator that is on in the still viewer (`frontend/client/viewer.html`). It should be a group, authored dark (`visible: false` in `veh-lights.js`), until the sim shows it. The rest pose will not show a blink.

## Where to look

| question | open |
|---|---|
| still of the mesh | `storybook-viewport` |
| entity edit | `model-geometry-validator` |
| vehicle mesh | `traffic-vehicle-3d` |
| headlamps, night | `highway-lighting` |
| which motions exist, the cab, wheels | `vehicle-animation-3d` |
| the burst, and how to judge it | `road-particles-3d`, `particle-effect-validator` |

The player's cab is 2D canvas (`frontend/client/js/cockpit/`). It is not a traffic vehicle and it is not in this table. A wiper is a cab draw, not a road state.
