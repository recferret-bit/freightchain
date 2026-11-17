---
name: ai-mesh-pipeline
description: >
  End-to-end workflow for turning a user prompt, concept image, or reference
  mesh into a validated Freight Chain declarative 3D entity. Enforces the
  pre-build spec gate, 4-layer highway kitbashing, numeric 3D geometry/contrast
  audit, and 4-view visual QA without .glb runtime imports. Use for
  /ai-mesh-pipeline.
---

# Declarative 3D Model Generation Pipeline

Freight Chain deliberately loads **zero** `.glb` / `.gltf` binary assets at runtime (keeping the client buildless, deterministic, pool-recyclable, and editable live in `viewer.html` + `backend/mcp`). Every "generate a 3D model" request produces a declarative seed entity in `frontend/client/shared/entity/seed/<kind>/<id>.js` compiled by `frontend/client/shared/entity/plan.js`.

Concept images or external `.glb` references are **proportion/silhouette references only** — never runtime files dropped into `frontend/client/`.

---

## 1. Six-Step Generation Pipeline

### Step 1 — Pre-Build Spec Gate (Mandatory First Call)
Before writing any car, truck, building, or tree entity from a natural-language prompt, validate the prompt against `rules.json`:

```sh
node .claude/skills/model-geometry-validator/validate.mjs "<user prompt>"
```

- **Exit `1` (`ok: false`)**: Stop immediately and quote `errors` (e.g. impossible wheel count, negative dimensions, zero-storey building). Do not author broken geometry.
- **Exit `0` (`ok: true`)**: Honour `expect` counts (axles, tyres, storeys, trunk) alongside `schema.js` invariants.

### Step 2 — Optional Reference Sheet (Only If Helpful)
If visual proportion reference is needed before kitbashing, generate or inspect a clean 3/4 orthographic concept with flat lighting and distinct colour zones (paint, dark chassis/trim, glass, silver rims, emissive lamps). Reject single-colour blobs.

### Step 3 — Four-Layer Highway Kitbashing
Author `frontend/client/shared/entity/seed/<kind>/<id>.js` following:
- [roadside-kitbash-3d](../roadside-kitbash-3d/SKILL.md) + [highway-greeble-catalog.md](../roadside-kitbash-3d/references/highway-greeble-catalog.md)
- [traffic-vehicle-3d](../traffic-vehicle-3d/SKILL.md) (for vehicles) or [road-scene-3d](../road-scene-3d/SKILL.md) (for landmarks, gantries, furniture, flora)
- Use sculpted `rbox`, `wedge`, `gable`, `oct`, `cyl16`, `wheel20`/`wheel48`, and `barrel` primitives — **never** a single raw `box` cube.
- Literal JS object syntax only (`parseSource` / `printSource` round-trip clean). If adding/removing a seed file, regenerate `seed/index.js` via `node frontend/client/tools/entity-seed-index.mjs`.

### Step 4 — Numeric 3D Geometry, Connectivity & Contrast Gate
Run the strict 3D validator on the entity:

```sh
node .claude/skills/model-geometry-validator/audit-entities.mjs --entity <id> --strict
node --test frontend/client/test/entity.test.mjs
```

Fix every `FLOATING_PART`, `HAIRLINE_GAP`, `COPLANAR_Z_FIGHT`, `RAW_CUBE_HULL`, `FOOTPRINT_BOUNDS`, `WHEEL_CLEARANCE`, or `LOW_CONTRAST_INSET` warning/error before taking screenshots.

### Step 5 — 4-View Storybook Visual QA
Capture `right`, `front`, `top`, and `threeq` PNGs in real Chrome and inspect every PNG (`storybook-viewport`):

```sh
node .claude/skills/model-geometry-validator/shot.mjs <catalogue-id>
```

### Step 6 — Surface & Parity Gate
If procedural canvas details (`road-texture-synthesis`) or shader tweaks (`shader-texture-tuning`) are needed, apply them only after geometry passes. Update `golden.txt` (`node frontend/client/tools/parity/run.mjs --save`) when catalogue meshes intentionally change, and run `npm --prefix frontend/client run check`.
