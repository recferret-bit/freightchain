---
name: roadside-kitbash-3d
description: >
  Assemble any Freight Chain catalogue model from entity parts. Trucks, cars,
  buses, landmarks, trees, props, and other roadside meshes for the storybook
  viewer. Ground contact, then the body, then the one feature that names it,
  then lamps and signs. Use when the user runs /roadside-kitbash-3d.
---

# Assemble a catalogue model

Every catalogue model is a data-only entity: `frontend/client/shared/entity/seed/<kind>/<id>.js`. `export default { … }`. No functions. A number may be an expression string (`'h * 0.45'`).

| kind | what it is |
|---|---|
| vehicle, prop, furniture, landmark, gantry, part | the mesh only |

Part keys: `geo` (`box`, `cyl`, `cone`, `rock`, `pyr`, `wheel20`, `wheel48`, `barrel`), `glow`, `beam`, `sign`, `disk`, `banner`, `group`, `for` loops, `when`, `use`, `ref`. No rounded box, no mesh merge, no vertex-colour zones.

Gameplay is not in the entity. Collision and size: `frontend/client/shared/entity/roster.js`. Vehicle size, mass, and speed: `VEHICLES` in `frontend/client/shared/traffic.js`. The body stays inside that box.

Materials are `MeshBasicMaterial`. A theme creates them only inside `create*()` via `basic()` / `trackMat()` in `frontend/client/js/themes/_shared/mats.js`. An entity colour is a slot name or `{ color, lamp? }`. `lamp: true` is self-lit at night (`toneMapped: false`). Vehicle caches live in `frontend/client/js/world/vehicles.js`: `TYRE` `0x151515`, `RIM` `0xc4c8ce`, `GLASS` `0x1d2a36`, lamps `HEAD` / `TAIL` / `BRAKE` / `RED` / `BLUE` / `AMBER`.

## Order

Bottom to top. Stop when the object reads.

1. Ground. Vehicle origin: footprint centre, on the ground, forward −z, right +x. Landmark: `anchor: 'base'`, y up, front faces −x, the road runs along z. A tree trunk's base meets y = 0.
2. Body. The largest painted mass.
3. The one feature that says what it is (cargo box, canopy, pump, porch, a lean).
4. Lamps and signs last. A lamp is a lens. A sign is a `sign` or `disk` part. A window is glass.

One breaker is enough: a lamp arm, a sign, a lean on a gum tree. Not a radar dish.

## Shared part or a new file

`use` inlines a part and passes `with`. It has no `at`. `ref` places a whole entity and may take `at` / `rot`.

| piece | file |
|---|---|
| wheels, lamps, indicators | `seed/part/veh-wheels.js`, `veh-lights.js`, `veh-indicator.js` |
| passenger hull, box hull | `veh-car-body.js`, `veh-box-body.js` |
| light bar | `veh-siren.js` — police, medic, fire only |
| cruiser, pump, cones | `cruiser.js`, `lm-pump.js`, `lm-cones.js` via `ref` |

Two entities that share a piece get a `part` file. A one-off stays in the entity. After a new or removed seed file, run `node frontend/client/tools/entity-seed-index.mjs`.

## Which family

| ask | read |
|---|---|
| sedan, truck, bus, freighter, police, medic, fire | [traffic-vehicle-3d](../traffic-vehicle-3d/SKILL.md) |
| landmark, tree, prop, furniture, the corridor | [road-scene-3d](../road-scene-3d/SKILL.md) |
| counts and shots | [model-geometry-validator](../model-geometry-validator/SKILL.md) |

Run that skill's `validate.mjs` before a mesh. Shoot with that skill's `shot.mjs`. Do not restate its wheel, axle, trunk, or storey rules. Shaders and textures are `shader-texture-tuning`, and only after the shape is shot.

## Look

Chunky. Readable from the driver's seat and from the storybook camera (fov 45). A part that has a job shows it: wheel = tyre + rim, lamp = lens, sign = a sign part, window = glass. Colour is a guide, not a quota. Most of the surface is body paint. The dark share is tyre, chassis, and undercarriage. The small share is glass, a stripe, and self-lit lamps.

Not in the catalogue. Do not clone them into the viewer: road holes (`frontend/client/js/world/holes.js`), depot (`depot.js`), junctions (`junctions.js`), the road surface (`roadmesh.js`), the player trailer (`trailer.js`). The player's cab is 2D canvas (`frontend/client/js/cockpit/`).

## After an edit

Shoot the ids. Read the PNGs. From `frontend/client/`: eslint on the files you touched, then `npm run check`. A changed seed also runs `node --test frontend/client/test/entity.test.mjs`. Leave the shake constants alone. Do not deploy.
