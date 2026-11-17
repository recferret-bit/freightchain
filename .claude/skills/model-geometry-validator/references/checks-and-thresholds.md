# Numeric Checks, Thresholds & Algorithm Notes (`audit-entities.mjs`)

All lengths are in metres. Source of truth: `.claude/skills/model-geometry-validator/audit-entities.mjs` + `frontend/client/shared/entity/schema.js`.

## 1. Geometry, Connectivity & Anti-Cube Checks

| Code | Severity | Threshold | What it catches & how to fix |
| :--- | :--- | :--- | :--- |
| `SCHEMA_INVALID` | error | `validateEntity()` across all min/max corners | Malformed expressions, NaN/Infinity, missing roster params/slots/roles, wrong `tyre` or `trunk` tag counts, or vehicle parts exceeding `VEHICLES` box by `> 10 cm`. |
| `GROUND_CONTACT` | error | `trueMinY > 0.02 m` or `trueMinY < -0.12 m` across param corners | Hovering vehicles, floating cones/props, or deeply sunk stones. Snap tyres, trunks, and plinths to `y = 0`. |
| `HAIRLINE_GAP` | error | `0.005 m < shapeDist <= 0.08 m`, or cargo-to-chassis gap `> 0.02 m` | A part stops short of a curved/sloped surface (e.g. mirror off chamfered `rbox`, spotlight off `wedge` pillar, or cargo hovering above chassis rails). Overlap into support by `>= 1 cm`. |
| `FLOATING_PART` | error / warn | `shapeDist > 0.08 m` from ground-rooted convex-shape BFS, `brace`/`strut` with `< 2` anchors, or wide (`>= 4 m`) rooftop `sign` wings hovering `> 0.25 m` | Disconnected parts hovering in mid-air, one-ended gusset braces, or wide rooftop signs balanced on a gable ridge with unsupported wings. Add posts, brackets, or rooftop legs. |
| `PIERCING_PART` | error / warn | Grounded `pole` piercing through `roof`/`canopy`, or `sign` intersecting `> 15%` of volume into `wall`/`penthouse`/`hvac` | Catches freestanding pylon masts punching straight through overhanging motel/diner eaves and rooftop signs colliding into mechanical penthouses. |
| `COPLANAR_Z_FIGHT` | error | `|planeA - planeB| <= 1.8 mm`, overlap `> 0.04 m²` across all param corners | Two same-facing planar faces (`box`, `rbox`, `wedge`, `gable`, `oct` — including thin flush plates and rotated/sloped parts) with different materials share an outer plane and flicker in the depth buffer. Offset insets, stripes, mullions, and doors `>= 5 mm` proud. |
| `BURIED_PART` | warn | 3D extremal probes enclosed inside opaque host (`>= 1.4 cm` margin) | A part completely hidden inside a larger wall, rotated hull, sloped wedge, or boulder. Pull proud of the outer face or remove. |
| `AXLE_SPAN` | error | Missing distinct axle station, overhang `> 30%`, inter-axle gap `> 66–70%`, or `freighter` drive axle `z > 0` | Catches bunched rear wheels or semi-tractors missing a fifth-wheel drive axle. Distribute steer, tractor drive, and trailer axles proportionally. |
| `FEW_PARTS` | error / warn | `vehicle >= 24`, `landmark >= 14`, `gantry >= 12`, `furniture >= 4`, `prop >= 3`; vehicle coachwork `>= 10` | Rejects primitive 1-cone bushes, 2-box gantries, and 3-cube vehicles/buildings. Assemble layered kitbash models (`roadside-kitbash-3d`). |
| `RAW_CUBE_HULL` | warn | Vehicle, cruiser, or landmark uses 0 sculpted primitives | Bans vehicles and buildings built solely from raw sharp `box` primitives. Use `rbox`, `wedge`, `gable`, `oct`, `barrel`, `pyr`, and `cyl16`. |
| `FOOTPRINT_BOUNDS` | error | Landmark `minX < -(hd + 2.6)` | Prevents roadside buildings, canopies, or pylons from protruding past the tarmac lot apron toward the active highway lane. |

## 2. Appearance, Palette & Role Detail Checks

| Code | Severity | Threshold | What it catches & how to fix |
| :--- | :--- | :--- | :--- |
| `PALETTE_FLAT` | warn | `< 3` materials or single material `> 80%` surface area | Catches monochrome blobs on vehicles and landmarks. Enforce the **60 / 30 / 10 Highway Hierarchy** (primary paint/wall, dark chassis/plinth/roof, glass + chrome + self-lit lamps). |
| `FLAT_SURFACE` | warn | Large solid `cargo`/`body` (`>= 6.5 m²`) or road-facing `-x` `wall` (`>= 24 m²`) lacking mounted features or upper-wall ribs | Patterned after TerraAgent's `FLAT_SURFACE`: breaks up large blank van/trailer slabs and walls with exterior vertical stiffener ribs, rub-rails, shutters, windows, or signage. |
| `LOW_CONTRAST_INSET` | warn | CIE $\Delta E_{76} < 10$ across all `pick` variants & all 5 route × 3 wall palettes | Catches dark grilles/spoilers on dark paint (`sedan#5`, `police`) and grey doors on slate walls (`siberia`). Frame dark openings with chrome/trim or use contrasting slots. |
| `ROLE_DETAIL` | warn | Wheel = `tyre` + `rim` + `hub` ($\Delta E_{76} \ge 20$); lamps `lamp: true` | Ensures wheels read as dark rubber + bright rim + hub, and optical lenses (`headlamp`, `taillamp`, `brakelamp`, `beacon`) stay self-lit at night (`toneMapped: false`). |
| `WHEEL_CLEARANCE` | warn | Outer tyre X `< w / 2 - 0.04 m` | Ensures tyres sit flush/proud at the outer flanks (`xo = w / 2 + 0.06`) so they read clearly in the `right` profile shot instead of hiding inside the body. |

## 3. CLI Commands

```sh
# 1. Self-test (134 NLP spec-gate cases + 19 synthetic 3D geometry/appearance fixtures = 153 checks)
node .claude/skills/model-geometry-validator/validate.mjs --self-test

# 2. Spec gate on a user generation prompt
node .claude/skills/model-geometry-validator/validate.mjs "generate a semi truck with 6 wheels"

# 3. Full numeric 3D geometry + appearance audit across all 47 seed entities (0 errors, 0 warnings required)
node .claude/skills/model-geometry-validator/audit-entities.mjs --all --strict
node .claude/skills/model-geometry-validator/validate.mjs --category vehicle --strict

# 4. 4-view real-Chrome visual QA (`right`, `front`, `top`, `threeq`)
node .claude/skills/model-geometry-validator/shot.mjs sedan freighter route66/diner-chrome
```
