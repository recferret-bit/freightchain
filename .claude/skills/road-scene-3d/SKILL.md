---
name: road-scene-3d
description: >
  Build and audit Freight Chain's inhabited highway corridor: 15 roadside
  landmarks, overhead truss gantries, guardrails/lamps/poles/posts, biome trees
  & geological props across 5 routes, plus non-catalogue depot, junctions, toll
  plazas, and road sinkholes. Use when running /road-scene-3d.
---

# Highway Corridor & Roadside Scene Architecture

A highway corridor reads through layered peripheral silhouettes at `28 m/s`: rhythmic shoulder furniture every `32–96 m`, unmistakable biome flora, overhead truss gantries, and roadside stops you could pull into (lit canopies, fuel islands, colonnades, legible double-bezel pylon signs, parked cruisers).

Read [kinds/building.md](../model-geometry-validator/kinds/building.md), [kinds/tree.md](../model-geometry-validator/kinds/tree.md), and [roadside-kitbash-3d](../roadside-kitbash-3d/SKILL.md) alongside this skill.

---

## 1. Landmarks (`seed/landmark/<id>.js`)

- **Frame & Footprint**: `anchor: 'base'`, ground at `y = 0`, **front faces `-x`** (toward the road), road runs along `z`. Footprint `(hl, hd)` and variant order live in `ROSTER.landmark` (`frontend/client/shared/entity/roster.js`).
- **Lane Clearance**: Building mass stays inside `[-hd..hd]` in `X` and `[-hl..hl]` in `Z`; forecourt canopies/signs stay clear of the active travel lane (`x >= -(hd + 2.6)`).
- **Architectural Depth**:
  - Foundations: `rbox` concrete plinth/curb so walls sit cleanly on the lot.
  - Multi-storey walls: `facade` painter (`facadeMat` draws spandrel bands, mullions, recessed sills, and deterministic warm-lit rooms) framed by corner pilasters and overhanging parapet coping (`rbox`).
  - Single-storey fronts: recessed/vestibule entry doors with canopies (`rbox` or `barrel`), framed storefront glazing with proud mullions (`12–20 mm` offset — never coplanar with glass), under-window AC units, colonnade posts, and rooftop HVAC/vent greebles.
  - Forecourts: compose `lm-pump`, `lm-cones`, and `cruiser` via `ref`, plus yellow pipe bollards (`cyl`) and raised pump islands (`rbox`).
  - Signage: `sign` (`at.y` = board bottom) or `disk` (`at.y` = centre) mounted on single/twin steel posts with crossbars — never intersecting roof geometry.
- **15 Seed Landmarks**: `motel-strip`, `motel-cabins`, `motel-twostory`, `hotel-tower`, `hotel-resort`, `diner-chrome`, `roadhouse-porch`, `fastfood-drive`, `gas-kiosk`, `gas-canopy`, `gas-truckstop`, `gulp-bay`, `police-station`, `police-checkpoint`, `police-speedtrap`.

### Ground & Road Polygon-Offset Stack (Do Not Flatten)

`createLandmarks` automatically adds the asphalt lot apron connecting the site across the shoulder and tucking `0.5 m` under the road. Never put a ground-slab apron inside the entity.

| Layer | `polygonOffset` (factor / units) | Owner |
|---|---|---|
| Terrain / ground | `0` | route ground |
| Asphalt & shoulder ribbon | `-2` | `road-texture.js` / `roadmesh.js` |
| Landmark lot apron & junction pad | `-3` | `landmarks/index.js`, `junctions.js` |
| Thermoplastic lane markings | `-4` | `road-texture.js` `marksMat` |
| Sinkhole rim / tar patch / core decals | `-5` .. `-7` | `world/holes.js` |

---

## 2. Biome Props (`seed/prop/<id>.js`) & Route Assignment

Each route places props in `frontend/client/js/themes/<route>/props.js` using theme-tracked materials:

| Route | Climate & Palette | Prop Entities |
|---|---|---|
| `route66` | Mojave desert ochre & sage | `cactus` (1–3 curved saguaro arms on flared collar), `rock` (stratified boulder cluster), `bush` (multi-lobe scrub) |
| `stuart` | Red-centre outback | `gum-tree` (pale leaning ghost-gum trunk, branch forks, flat multi-lobe canopy), `termite` (buttressed cathedral mound + chimneys), `tuft`, `rock` |
| `siberia` | Sub-arctic taiga & snow | `spruce` (5 tiered dark conifer whorls + snow skirts + snow cap), `birch` (white trunk + dark bark bands + airy crown), `drift` (wind-sculpted snow ridge), `rock` |
| `brenner` | Alpine pass | `spruce`, `round-tree` (buttressed trunk + limb forks + 5-lobe crown), `rock`, `bush` |
| `panamerican` | Altiplano high desert | `tuft` (7-blade radiated grass clump), `rock`, `cairn` (5-stone stacked apacheta), `cactus` |

Trees (`spruce`, `round-tree`, `gum-tree`, `birch`, `cactus`) must keep **exact `1` mesh tagged `'trunk'`** (or `cactus`'s tagged stem per `schema.js`) with base rooted at `y = 0`.

---

## 3. Corridor Furniture, Gantry & Non-Catalogue Highway Structures

- **Roadside Furniture (`seed/furniture/`)**:
  - `post`: octagonal base collar, chamfered post, dark band, retroreflective face (`rbox`).
  - `guard`: octagonal post pads, steel posts, offset blockouts, corrugated upper/lower W-beam rails + centre recess.
  - `lamp`: octagonal concrete foundation, tapered column, angled davit arm, luminaire hood, `glow` role bulb + ground pool.
  - `pole`: buttressed utility pole, braced timber crossarms, ceramic insulator pins.
- **Overhead Finish Gantry (`seed/gantry/gantry.js`)**: Twin-chord tubular steel uprights (`cyl16`) with horizontal ladder rungs on octagonal concrete pedestals (`oct`) + red reflectors, spanning a twin-chord space-frame truss bridge with luminaire hoods over the self-lit `banner` canvas (`world/gantry.js`).
- **Non-Catalogue World Builders (`frontend/client/js/world/`)** — built directly on the road scene (verified via `tools/e2e-chrome.mjs`, never cloned into `catalogue.js`):
  - `depot.js`: Origin logistics terminal — concrete plinth, fascia parapet, rooftop HVAC pods, 4 recessed loading bays with dock canopies, yellow bumper seals, bollards, and detailed parked semi-trailers.
  - `junctions.js`: Signalized intersection masts — octagonal base, stepped mast, braced cantilever arm, 3 hooded round signal lenses (`wheel20`), octagonal STOP backing.
  - `toll.js`: PIKE toll plaza — raised concrete island, yellow crash bollard, chamfered glazed booth, overhanging canopy, counterweighted red/white boom barrier (`tollMats` registered in `render.js` `flipMats()`).
  - `holes.js`: Sinkhole hazard decals + weighted rubber-base cones with white retroreflective collars and warning triangle sign.

---

## 4. Mandatory Verification

```sh
node .claude/skills/model-geometry-validator/audit-entities.mjs --all --strict
BASE=http://127.0.0.1:8765 node .claude/skills/model-geometry-validator/shot.mjs route66/diner-chrome route66/gas-canopy route66/motel-strip route66/gulp-bay route66/police-checkpoint route66/gantry route66/cactus siberia/spruce stuart/gum-tree brenner/guard
```

 Note that `shot.mjs` automatically aims `front` (`-Math.PI / 2`) and `threeq` (`-1.02`) at the **`-x` road-facing facade** for `Landmarks` items so storefronts, colonnades, pumps, and signs are directly visible. Inspect the PNGs, and run `node tools/e2e-chrome.mjs` when non-catalogue world builders (`depot`, `junctions`, `toll`, `holes`, `road-texture`) change.
