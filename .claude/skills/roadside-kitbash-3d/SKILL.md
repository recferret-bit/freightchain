---
name: roadside-kitbash-3d
description: >
  Pillar 1 — Highway Procedural Kitbashing. Assemble sculpted Freight Chain 3D
  models from declarative entity primitives and reusable sub-assemblies: cars,
  trucks, buses, semi-freighters, emergency rigs, roadside landmarks, gantries,
  furniture, and biome flora. Never ship raw single-cube models. Use when
  building, refactoring, or extending any 3D model or /roadside-kitbash-3d.
---

# Highway Procedural Kitbashing (Pillar 1)

Every catalogue model is a declarative, data-only entity in `frontend/client/shared/entity/seed/<kind>/<id>.js` (`export default { … }`, literal JS only — no imports, no functions; expressions are strings like `'h * 0.45'`).

Non-catalogue world structures (`frontend/client/js/world/{trailer,depot,junctions,toll,holes}.js`) use the same `GEO` primitives and `mesh()` pool directly. Gameplay numbers (collision envelopes, mass, speed, landmark order) stay in `frontend/client/shared/entity/roster.js` and `frontend/client/shared/traffic.js` (`VEHICLES`) — never inside an entity.

---

## 1. Geometry Vocabulary (`GEOS` in `plan.js` / `props.js`)

Never build a vehicle hull, roof canopy, or building mass out of a single sharp `box`. Choose sculpted primitives so `nightlight.js` `formShade()` catches distinct bevel and slope highlights:

| `geo` | Unit bounds (`x, y, z`) | Highway use |
|---|---|---|
| `rbox` | `[-0.5..0.5]³` (8.5%-chamfered 108-tri 6-group hull) | Vehicle bodies, cabs, sleepers, cargo boxes, bumpers, fascia canopies, plinths, islands, HVAC units |
| `wedge` | `[-0.5..0.5]³` (sloped `-z` front ramp) | Aerodynamic windshields, sloped hoods, cab roof fairings, wheel-arch flares, ramps |
| `gable` | `[-0.5..0.5]³` (pitched ridge along `Z`) | Cabin roofs, roadhouse/resort gable roofs, triangular truss/pediment caps |
| `oct` | `[-0.5..0.5]³` (8-sided prism) | Mast/gantry/sign foundations, STOP sign plates, faceted fuel tanks, column plinths |
| `cyl16` | `[-1..1, -0.5..0.5, -1..1]` (16-seg smooth cylinder) | Chrome exhaust stacks, tanker/fuel drums, tubular gantry chords, smooth saguaro stems |
| `cyl` | `[-1..1, -0.5..0.5, -1..1]` (7-seg cylinder) | Posts, poles, tree trunks, mirror stalks, axles, hose pipes |
| `wheel20` / `wheel48` | `[-1..1, -0.5..0.5, -1..1]` (20/48-seg cylinder) | Tyres, stepped silver rims, lug hubs, round signal lenses (`rot: [0, 0, 'PI / 2']` for X-axle) |
| `barrel` | `[-1..1, -0.5..0.5, -1..0]` (`-z` half-cylinder arch) | Chrome diner roof vaults (`rot: ['PI / 2', 0, 'PI / 2']`), arched entry canopies |
| `cone` / `pyr` / `rock` | `[-1..1, -0.5..0.5, -1..1]` / `[-0.5..0.5]³` / `[-1..1]³` dodecahedron | Traffic cones, conifer whorls, hipped roofs (`pyr`), boulders, foliage lobes, rounded cactus elbows |
| `box` | `[-0.5..0.5]³` (6 face groups) | Thin structural plates, window panes, mullions, ladder rails/rungs, stripes, mudflaps |

Painter parts: `sign` (`at.y` = board bottom), `disk` (`at.y` = board centre), `banner` (`gantry` overhead canvas), `glow` (billboard sprite), `beam` (headlight ground pool).

---

## 2. Four-Layer Bottom-to-Top Assembly Contract

Every highway model is assembled from the ground up (`y = 0`) in four readable layers:

1. **Ground & Running Gear (`minY = 0`)**:
   - **Vehicles** (`origin` = footprint centre on `y = 0`, forward `-z`, right `+x`): tyres (`wheel20`/`wheel48`) + stepped rims + hub caps + cross-axles + dark chassis rails + wheel-well housings + mudflaps.
   - **Landmarks** (`anchor: 'base'`, front faces `-x`, road runs along `z`): foundation plinth (`rbox`), raised fuel/curb islands, column bases (`oct`), walkways. (Lot-to-road asphalt apron is added automatically by `createLandmarks` at `polygonOffset -3` — never add a fake road-apron slab inside the entity.)
   - **Trees & Furniture**: flared root collar (`cone`) or concrete footing (`oct`) planted cleanly at `y = 0`.
2. **Primary Sculpted Hull (60% Primary Surface)**:
   - Chamfered `rbox` lower/upper body + sloped `wedge` hood/windshield/fairing, or `rbox` building mass with `facade` painter + overhanging `rbox`/`gable`/`barrel` roof.
3. **Secondary Structural Sub-Assemblies (30% Dark/Structural Trim)**:
   - Recessed dark grille (`ΔE >= 8` against body paint!) with chrome surround/slats, front/rear bumpers, rub-rails, wheel arches, side mirrors on stalks, recessed glass windows with frames/mullions, covered colonnades, fuel-island canopies, or truss chords.
4. **Signature Greebles, Signage & Self-Lit Lamps (10% Accent / Emissive)**:
   - The unmistakable feature that names the silhouette at 120 m: sleeper stacks & chrome tanks (`freighter`), twin-rail roof ladder + pump panel + deck monitor (`fire`), medical cross + high-mount ambulance box (`medic`), push-bar + A-pillar spotlight + whip antenna (`police`), coach bay pillars + destination marquee (`bus`), fuel dispensers (`lm-pump`), reflective-collared cones (`lm-cones`), double-bezel pylon `sign`/`disk`, and `{ color, lamp: true }` lenses (`HEAD`, `TAIL`, `BRAKE`, `AMBER`, `RED`, `BLUE`).

Reusable highway sub-assemblies and offsets: see [references/highway-greeble-catalog.md](references/highway-greeble-catalog.md).

---

## 3. Anti-Cube & Spatial Invariants (Enforced by `audit-entities.mjs`)

- **Zero raw-cube hulls**: Vehicles, cruisers, and landmarks must use sculpted primitives (`rbox`, `wedge`, `gable`, `oct`, `cyl16`, `barrel`, `pyr`) rather than raw `box`-only assemblies (`RAW_CUBE_HULL`).
- **Zero floating parts (`<= 5 mm` shape-surface tolerance)**: Every solid part must connect through a true 3D convex shape-surface BFS chain (`CONTACT_TOL = 0.005 m` across param corners) to `y = 0` (`FLOATING_PART`, `HAIRLINE_GAP`), structural `brace`/`strut` parts must anchor at `>= 2` ends, and vehicle cargo boxes must seat onto chassis frame rails (`<= 2 cm` gap).
- **Zero coplanar Z-fighting**: Never place two different materials on the exact same plane (`<= 1.8 mm`) with overlapping area (`COPLANAR_Z_FIGHT`). Offset trim, grilles, stripes, panes, and mullions proud of the wall/hull by `8–25 mm`.
- **Perceptual contrast (`CIE L*a*b* ΔE >= 10`)**: Thin insets (`door`, `window`, `glass`, `stripe`, `decal`, `grille`, `screen`, `wing`) must maintain `ΔE >= 10` against host walls/hulls across all 7 `sedan` paint picks (`0..6`) and all 5 highway route palettes (`route66`, `stuart`, `siberia`, `brenner`, `panamerican`).

---

## 4. Routing & Mandatory Verification Workflow

| Domain | Companion skill |
|---|---|
| Cars, trucks, buses, semi-freighters, emergency rigs | [traffic-vehicle-3d](../traffic-vehicle-3d/SKILL.md) |
| Landmarks, gantries, roadside furniture, biome props | [road-scene-3d](../road-scene-3d/SKILL.md) |
| Geometry/contrast validator & 4-view Chrome capture | [model-geometry-validator](../model-geometry-validator/SKILL.md) |
| Asphalt, lane markings, facades, signs, trailer livery | [road-texture-synthesis](../road-texture-synthesis/SKILL.md) |
| `MeshBasicMaterial` `formShade` & night headlight shader | [shader-texture-tuning](../shader-texture-tuning/SKILL.md) |

After editing any entity or world builder:
1. If seed files were added/removed: `node frontend/client/tools/entity-seed-index.mjs`
2. Numeric 3D audit: `node .claude/skills/model-geometry-validator/audit-entities.mjs --all --strict` (must report `0 errors, 0 warnings`)
3. Round-trip & schema test: `node --test frontend/client/test/entity.test.mjs`
4. Capture 4-view PNGs (`right`, `front`, `top`, `threeq`) via `shot.mjs` and inspect every PNG visually (`storybook-viewport`).
5. Update parity golden if 3D catalogue output intentionally changed (`node frontend/client/tools/parity/run.mjs --save`) and run `npm --prefix frontend/client run check`. Never touch `SHAKE_*` / `START_ENGINE_OFF` or deploy unless asked.
