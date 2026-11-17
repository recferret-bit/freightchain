---
name: model-geometry-validator
description: >
  Validate, review, add, or regenerate Freight Chain 3D entities and highway
  models: prompt spec gate, numeric 3D geometry/connectivity/anti-cube/contrast
  audit, and 4-view real-Chrome storybook inspection. Replaces 3d-assets;
  loaded by the entity MCP. Use when creating, fixing, or auditing any 3D
  vehicle, truck, prop, furniture, gantry, or landmark, or on /model-geometry-validator.
---

# Model Geometry & Appearance Validator (`model-geometry-validator`)

Every catalogue 3D model is a declarative, code-free entity in `frontend/client/shared/entity/seed/<kind>/<id>.js`, compiled by `frontend/client/shared/entity/plan.js` and built into pooled Three.js meshes by `frontend/client/js/world/entity-build.js`. Gameplay properties (collision radii, `VEHICLES` dimensions/mass/speeds, landmark footprints and order, siren roles) live in `roster.js` and `traffic.js`, never in an entity.

This skill enforces **two automated gates** followed by a **4-view visual self-correction loop**:
1. **Prompt Spec Gate (`validate.mjs "<phrase>"`)**: Rejects impossible requests (e.g. a 2-wheeled car, a wheeled building, a leafy winter birch) before any mesh is authored. Used directly by `backend/mcp/`.
2. **Numeric 3D Geometry & Appearance Audit (`audit-entities.mjs` / `validate.mjs --all --strict`)**: Numerically inspects final 3D sub-part world bounds, ground contact (`minY ≈ 0`), 3D support-graph connectivity (`FLOATING_PART`, `HAIRLINE_GAP`), coplanar depth flicker (`COPLANAR_Z_FIGHT`), hidden parts (`BURIED_PART`), anti-cube part richness (`FEW_PARTS`, `RAW_CUBE_HULL`), wheel protrusion (`WHEEL_CLEARANCE`), and CIE $L^*a^*b^*$ contrast (`PALETTE_FLAT`, `LOW_CONTRAST_INSET`, `ROLE_DETAIL`).

Siblings: [roadside-kitbash-3d](../roadside-kitbash-3d/SKILL.md) (4-layer sculpted assembly & greebles), [traffic-vehicle-3d](../traffic-vehicle-3d/SKILL.md), [road-scene-3d](../road-scene-3d/SKILL.md), [storybook-viewport](../storybook-viewport/SKILL.md), [road-texture-synthesis](../road-texture-synthesis/SKILL.md), [shader-texture-tuning](../shader-texture-tuning/SKILL.md).

---

## Mandatory Workflow

### Step 1: Spec Gate & Domain Rules
Read the matching kind guide (`kinds/car.md`, `kinds/building.md`, or `kinds/tree.md`) and [references/checks-and-thresholds.md](./references/checks-and-thresholds.md). When fulfilling a user prompt that names counts or parts, run:

```sh
node .claude/skills/model-geometry-validator/validate.mjs "the user's sentence"
```

If exit code is `1`, stop and quote `errors`.

### Step 2: Author or Regenerate with Sculpted Primitives
Follow [roadside-kitbash-3d](../roadside-kitbash-3d/SKILL.md): use `rbox`, `wedge`, `gable`, `oct`, `cyl16`, `wheel20`, `wheel48`, `barrel`, `pyr`, `cone`, `rock` (never 2–3 raw `box` cubes!). Tag every part meaningfully (`body`, `cabin`, `hood`, `glass`, `bumper`, `grille`, `mirror`, `tyre`, `rim`, `hub`, `trunk`, `roof`, `wall`, `door`, `window`, `mullion`, `sill`). If adding/removing a seed file, run `node frontend/client/tools/entity-seed-index.mjs`.

### Step 3: Run Unit Schema Check + Strict Numeric 3D Audit
```sh
node --test frontend/client/test/entity.test.mjs
node .claude/skills/model-geometry-validator/audit-entities.mjs <id> --strict
# Or audit an entire category / all 47 entities:
node .claude/skills/model-geometry-validator/audit-entities.mjs --all --strict
```
Fix every error and warning in the entity geometry (`>= 1 cm` overlap into supports, `>= 5 mm` proud offset on insets, `minY = 0`, contrasting slots/colours) until `0 errors, 0 warnings`.

### Step 4: 4-View Visual Inspection in Real Chrome (`shot.mjs`)
Ensure `frontend/client/` is served over HTTP (`:8765`, `:3000`, or `BASE=http://127.0.0.1:<port>`), then capture the 4 diagnostic views (`right`, `front`, `top`, `threeq`):

```sh
node .claude/skills/model-geometry-validator/shot.mjs <id> [...]
```

Open and inspect the saved PNGs with `read_file`:
- **`right` (+x side profile):** Tyres sit on `y = 0` proud of hull; sloped hood/windshield/fairing/roofline reads cleanly; zero floating parts.
- **`front` (-z / front face):** Symmetry, bezel headlamps, contrasting grille, mirrors, unclipped signage.
- **`top` (+y overhead):** Footprint containment, roof greebles (HVAC, ladder rungs, lightbar, fairing), zero lateral lane intrusion.
- **`threeq` (3/4 perspective):** 60/30/10 colour hierarchy and chamfered `formShade()` highlights.

### Step 5: Regression & Parity Gate
After editing entities or 3D builders (`world/props.js`, `trailer.js`, `depot.js`, `junctions.js`, `toll.js`, `holes.js`):
1. Update `golden.txt` when intentional 3D model changes were made: `node frontend/client/tools/parity/run.mjs --save`, then verify `npm --prefix frontend/client run test:parity`.
2. Run `npm --prefix frontend/client run check` (eslint + unit + bundle + 60 km headless sim) and `npm run mcp:check`.
3. For non-catalogue highway objects (`trailer.js`, `depot.js`, `junctions.js`, `toll.js`, `holes.js`), run `node frontend/client/tools/e2e-chrome.mjs` and inspect the gameplay screenshots.
