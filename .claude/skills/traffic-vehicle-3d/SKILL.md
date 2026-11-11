---
name: traffic-vehicle-3d
description: >
  Anatomy of a Freight Chain traffic mesh: truck, car, bus, freighter, police,
  medic, fire. Axles and a painted hull, readable as roadside traffic in the
  storybook. Not a tree, a prop, or a landmark. Use when the user runs
  /traffic-vehicle-3d.
---

# Traffic vehicles

A traffic vehicle is a rigid body with axles, not a creature. Read [kinds/car.md](../model-geometry-validator/kinds/car.md) before a mesh. Counts live in that skill's `rules.json`. Run that skill's `validate.mjs` before a mesh. Shoot with that skill's `shot.mjs`. The `right` shot is the one that shows a tyre outside the painted hull.

Mesh: `frontend/client/shared/entity/seed/vehicle/<type>.js`. Size, mass, speed, and presets: `VEHICLES` in `frontend/client/shared/traffic.js`. The body stays inside that box. Catalogue id is `<type>`. A paint variant is `sedan#<paint>`, not a new entity.

Frame: origin at the footprint centre on the ground, forward −z, right +x. Wheels sit outside the painted hull. The hulls are plain boxes, so a flush tyre hides in the paint. The head-lamp pair is on the −z face, from `veh-lights`. Do not add a second pair.

## Bodies

| type | hull | what names it |
|---|---|---|
| sedan | `use` `veh-car-body` | paint from `pick` |
| truck | `use` `veh-box-body` | cab colour and a cargo box |
| bus | own boxes | long glass band |
| freighter | own boxes | short cab, long trailer |
| police | `veh-car-body` plus a stripe | `use` `veh-siren` |
| medic | `veh-box-body` plus a cross | `use` `veh-siren` |
| fire | `veh-box-body` plus a ladder | `use` `veh-siren` |

Shared parts, all under `seed/part/`: `veh-wheels.js`, `veh-lights.js`, `veh-indicator.js`, `veh-siren.js`, `veh-car-body.js`, `veh-box-body.js`. The two body parts already pull wheels and lights. `bus` and `freighter` call `veh-wheels` and `veh-lights` themselves.

Only police, medic, and fire may have a flash role. That is the siren part (`flash.0` / `flash.1`). A civilian gets no light bar, no beacon, and no flash group.

Lamp colours are the cache in `frontend/client/js/world/vehicles.js`: `HEAD`, `TAIL`, `BRAKE`, `RED`, `BLUE`, `AMBER`, plus `TYRE` `0x151515`, `RIM` `0xc4c8ce`, `GLASS` `0x1d2a36`. A lamp is `{ color, lamp: true }`.

## Look

Most of the surface is body paint. The dark share is tyre, chassis, and undercarriage. The small share is glass, one stripe, and the self-lit lamps. A wheel reads as tyre plus rim. Do not bury the tyre in the hull.

Part order and the entity format: [roadside-kitbash-3d](../roadside-kitbash-3d/SKILL.md). The corridor those vehicles pass: [road-scene-3d](../road-scene-3d/SKILL.md). Shaders and textures are `shader-texture-tuning`, and only after the shape is shot.

A blinker, a brake lamp, or a siren flash exists only while the sim runs (`frontend/client/js/sim/traffic.js`). A still shot cannot show it.

## After an edit

```sh
node .claude/skills/model-geometry-validator/shot.mjs <id>
```

If the note is the body or the wheels, shoot every listed paint. Read the PNGs. From `frontend/client/`: eslint, then `npm run check`. Leave the shake constants alone. Do not deploy.

The player's cab is 2D (`frontend/client/js/cockpit/`). The player's trailer is `frontend/client/js/world/trailer.js`. Neither is a catalogue vehicle. Do not clone them into the viewer.
