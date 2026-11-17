---
name: shader-texture-tuning
description: >
  Pillar 3 — Shader & Material Surface Tuning. Tune Freight Chain's single-pass
  MeshBasicMaterial nightlight + daytime formShade shader (hemisphere lift,
  beveled rbox/wedge highlights, ground-contact AO, box-edge darkening),
  emissive toneMapped=false lamps, sky/fog horizon sync, and 2D cab grading.
  Use when running /shader-texture-tuning.
---

# Shader & Material Surface Tuning (Pillar 3)

Freight Chain's 3D road uses `THREE.MeshBasicMaterial` compiled once with `onBeforeCompile` in `frontend/client/js/world/nightlight.js`. There are **no** `THREE.Light` instances, no PBR roughness/metalness maps, no shadow maps, and no post-processing passes (`THREE.Light` does nothing on `MeshBasicMaterial` and triggers shader recompiles).

---

## 1. Where Every Surface Property Lives

| Surface | File & Mechanism |
|---|---|
| Daytime 3D form shading + night headlight/lamp lighting | `frontend/client/js/world/nightlight.js` (`onBeforeCompile` on `MeshBasicMaterial.prototype`) |
| Sun/clock curve, fog, & 12 nearest street-lamp uniforms | `frontend/client/js/world/daynight.js` (`NL` uniform block) |
| Sky dome & horizon sync | `frontend/client/js/themes/_shared/sky-dome.js` (shares `scene.fog.color`) |
| Theme material lifecycle & mirror winding | `frontend/client/js/themes/_shared/mats.js` (`basic`, `trackMat`, `colorMat`) + `world/render.js` (`flipMats`) |
| Procedural asphalt, marks, facades, signs, trailer livery | `road-texture-synthesis` (`themes/_shared/road-texture.js`, `landmarks/index.js`, `trailer.js`) |
| 2D truck cockpit night & dome-lamp grading | `frontend/client/js/cockpit/effects.js` (`nightGrade`, `cabGlow`, `blindEffect`) |

---

## 2. How `nightlight.js` Shades Sculpted Highway Meshes

Every `MeshBasicMaterial` with `toneMapped !== false` receives two unified stages in `nightlight.js`:

1. **Daytime Sculpted Form Shading (`formK = CFG.FORM_SHADE * (1 - dn.k)`, viewer toggle `F8`)**:
   - **Flat upward lock (`smoothstep(0.94, 0.995, n.y)`)**: Road ribbons (`roadmesh.js` writes `+Y` normals, `n.y = 1.0`) and flat horizontal roofs keep `1.0` multiplier so road brightness never shifts with heading or sun angle, while `rbox` top bevels, sloped hoods, and `gable`/`barrel` roofs (`n.y <= 0.94`) receive directional 3D sun shading.
   - **Directional half-Lambert + sky-hemisphere lift**: Angled bevels (`rbox`), sloped hoods/windshields/fairings (`wedge`, `gable`), and vertical panels receive directional sun wrap plus subtle sky-hemisphere lift (`clamp(n.y, -0.3, 0.85)`), separating `rbox` chamfers from vertical sides cleanly.
   - **Subtle ground-contact AO (`nlP.y` in `0..0.9 m`)**: Non-upward faces near `y = 0` (`tyres`, chassis sills, building plinths, tree bases) receive gentle contact grounding (`~6%` max) without darkening the flat road plane.
   - **Crisp box-edge crease (`boxHalf` attribute from `props.js` `markBox`)**: Darkens the outer `2 cm` of rectilinear `box` faces slightly so stacked panels read cleanly even without wireframe lines.
2. **Night Lighting (`nlDark = dn.k`)**:
   - Fades daytime `formK` out smoothly as `dn.k -> 1` and multiplies surface colour by `NIGHT_AMBIENT` + player truck dual headlight cone (`nlBeam*`) + up to **12** nearest roadside street-lamp pools (`LAMPS`).

### Self-Lit / Emissive Bypass (`toneMapped: false`)

Any material with `toneMapped: false` (`colorMat(hex, true)` or `lampMat(hex)`) returns **before** `nightlight.js` patches it, staying 100% self-lit day and night:
- Vehicle headlamps, tail/brake/reverse lenses, amber blinkers, emergency lightbars (`vehicles.js`)
- Additive headlight/tail/siren `glow` sprites and ground `beam` pools (`world/glow.js`)
- Overhead finish `gantry` banner (`world/gantry.js`)

---

## 3. Hard Material & Mirror Rules

- **Create theme materials ONLY inside `create*()`** via `basic()` or `trackMat()`. Module-top-level single-sided materials either leak across routes or render **inside-out** in the cab's left/right mirrors (`world/render.js` flips `FrontSide` ↔ `BackSide` across `flipMats()` during mirror rendering).
- If a world module outside `themes/` creates a persistent single-sided `MeshBasicMaterial` (e.g. `world/depot.js`, `world/junctions.js`, `world/toll.js`, `world/holes.js`), export its material array and register it in `flipMats()` in `frontend/client/js/world/render.js`.
- `cockpit/*` is pure 2D Canvas and must **never** import `three` or `world/*` (`frontend/landing/src/dash-live.js` and `wp-scenes.js` run cockpit drawing standalone on the landing page).
- Leave `SHAKE_START`, `SHAKE_MOVING`, `SHAKE_RPM`, and `START_ENGINE_OFF` untouched unless explicitly requested.

---

## 4. Verification

```sh
npm --prefix frontend/client run check
PORT=9333 node frontend/client/tools/e2e-chrome.mjs
```

Check both daytime form shading (`viewer.html` + `02-driving.png`) and mirror winding (`e2e-chrome.mjs` mirror views — verify buildings, toll booths, and trailers are never inside-out in mirrors).
