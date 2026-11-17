# Roadside Buildings & Landmarks (`kinds/building.md`)

Roadside landmarks (`motel-*`, `hotel-*`, `diner-chrome`, `roadhouse-porch`, `fastfood-drive`, `gas-*`, `gulp-bay`, `police-*`). Collider kind is `building`.

## 1. Spec Gate & Numeric 3D Audit

Before building from a prompt that states storeys, roofs, walls, or wheels:

```sh
node .claude/skills/model-geometry-validator/validate.mjs "the user's sentence"
```

Wheels are always `0` (parked `cruiser` sub-entities placed via `ref` do not make a building wheeled). Roof and walls are required except for the open `police-speedtrap` billboard/radar site. After editing:

```sh
node --test frontend/client/test/entity.test.mjs
node .claude/skills/model-geometry-validator/audit-entities.mjs <id> --strict
```

## 2. Architectural Massing & Lot Rules (No Shoebox Cubes!)

- **Frame & Footprint:** `anchor: 'base'`, `y` up (`minY = 0`), front (entrance/road side) faces **`-x`**, highway runs along **`z`**. Footprint `(hl, hd)` and order live in `ROSTER.landmark` (`roster.js`). Keep all parts inside `x >= -(hd + 2.6)` so pylons and canopies stand on the tarmac apron and never intrude into the lane.
- **Tarmac Apron:** `createLandmarks` automatically generates the polygonOffset `-3` asphalt apron linking the lot across `SHOULDER` to tuck `0.5 m` under the highway. Never add a giant ground box inside the entity to fake an apron.
- **4-Layer Architectural Kitbashing (`>= 14` meshes):**
  1. **Foundation & Islands (`y = 0`):** Dark masonry `plinth` under walls, raised walkway slabs, curbed `lot` pump islands, `oct` column pedestals, and `cyl16` safety bollards.
  2. **Primary Mass & Roofline:** Chamfered `rbox` walls or mullioned `{ facade: [cols, rows] }` blocks, overhanging `rbox` parapet roofs, `pyr` hip roofs, `gable` pitched crowns, or `barrel` diner vaults—topped with `metal` HVAC units, vents, cupolas, or stone chimneys.
  3. **Framed Openings & Canopies (Zero Z-Fighting!):** Doors (`door`) with frames/porticos/awnings (`wedge`/`rbox`), windows (`glass`) with `trim` sills and proud `mullion` dividers, wall AC units, solid overlapping stair stringers, and columned forecourt canopies (`lm-pump`, `lm-cones`, `cruiser`). Never leave two different-material `box`/`rbox` faces sharing the exact same coordinate (`>= 5 mm` proud offset).
  4. **Signage & Night Lighting:** `sign` (`at.y` = bottom of board) or `disk` (`at.y` = centre) mounted cleanly on `cyl16`/`rbox` pylons or roof mounts without slicing through eaves, plus under-canopy `lamp: true` fixtures and `glow`s where appropriate.

## 3. 4-View Visual QA (`shot.mjs`)

Shoot `<route>/<id>` with `shot.mjs` and inspect `right`, `front`, `top`, and `threeq`: verify `minY = 0`, readable unclipped signs, grounded cones/cruisers/stairs, and clear separation between wall, plinth, roof, glass, and neon/accent trim.
