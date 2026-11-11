---
name: shader-texture-tuning
description: >
  Pick the Freight Chain surface that should change: a MeshBasicMaterial, a
  canvas map, the night-shade patch, or a cab pixel. Triggers on material,
  texture, shader, night shade, pixel, cab card, asphalt, and road marking.
  There is no PBR and no scene light. Use when the user runs
  /shader-texture-tuning.
---

# Shader texture tuning

The 3D world is `MeshBasicMaterial`. No scene lights, no roughness or metalness, no environment map, no bloom pass. A `THREE.Light` does not light this scene and can hitch. Do not add a CRT or pixelation pass over the road. Grain, when a texture should feel grainy, is 1-2 px specks on a canvas (`road-texture-synthesis`). The asphalt already does this.

Wrong mesh first: `model-geometry-validator`. Asphalt, shoulders, and markings: `road-texture-synthesis`. Lighting uniform numbers: `highway-lighting`. Debris materials: `road-particles-3d`.

## Where the colour lives

| Slot | Where |
| --- | --- |
| Body colour | `basic` / `trackMat` / `colorMat` in `frontend/client/js/themes/_shared/mats.js`, only inside a `create*()` |
| Road canvas | `frontend/client/js/themes/_shared/road-texture.js` `roadMaterial()` |
| Sky | `frontend/client/js/themes/_shared/sky-dome.js`. One horizon colour shared with `scene.fog`; `daynight.js` keeps them in step. Per-route `theme.daylight`: `rise`, `set`, `tw`, `peak`, `warm`, `stars` |
| Cab pixel | `frontend/client/js/cockpit/` (`nightGrade` in `effects.js`) |
| Card crop | `frontend/landing/src/dash-live.js` copies a crop described in `dash-scenes.js`. Page tilt and flip are `frontend/client/css/card3d.css` and `flip-card.css`, not the road |

## Which change

Night on an ordinary material is already one `onBeforeCompile` on `MeshBasicMaterial.prototype` (`frontend/client/js/world/nightlight.js`). `frontend/client/js/world/daynight.js` writes the shared `NL` uniforms every frame. Do not add a second lighting shader.

The patch multiplies by ambient plus the truck headlight cone plus the nearest 12 lamp pools (`LAMPS`), mixed by `dn.k` (`nlDark`). `toneMapped: false` returns before the patch and stays self-lit: lamps, glow sprites (`world/glow.js`), the beam decal, the gantry banner (`world/gantry.js`). A new emissive thing sets `toneMapped: false`. `colorMat(color, true)` is that flag.

By day the same patch applies a soft half-Lambert (`CFG.FORM_SHADE`, viewer key F8) and darkens the last 2 cm of a box. `frontend/client/js/world/props.js` `markBox` writes `boxHalf`; cylinders and planes are not boxes. Faces that point up stay the flat colour, so the road and roofs do not shift with the sun. `formK` is `FORM_SHADE * (1 - dn.k)`: the shade is gone at night and the headlight cone stays even. Do not darken the road to match the sun. Road ribbons already store an up normal (`world/roadmesh.js`).

A painted surface (asphalt, shoulder, mark atlas, sign, facade, flag) is a canvas, not a shader graph. That work is `road-texture-synthesis`.

Cab night is pixels, not a fullscreen post pass. `nightGrade()` (`cockpit/effects.js`, called from `cockpit/index.js`) darkens with `source-atop`, so only opaque cab pixels change. Glass and mirror holes stay clear. `cabGlow()` warms those same pixels. Gauge units are `u = min(H/100, W/150)`, not raw pixels. `cockpit/*` must not import the scene. Landing dash cards import that cockpit canvas and must keep working: no three.js in the landing cockpit import. A cockpit change that feeds a card is checked on the card, not only in the game. `frontend/landing/src/wp-scenes.js` is the same crop shape for the whitepaper.

## Rules

Create theme materials only inside `create*()` via `basic()`, `trackMat()`, or `colorMat()`. A module-level material is disposed on the next route or missing from `flipMats()` in `world/render.js`, and then looks inside-out in the mirrors. Every single-sided material must be in that list. `DoubleSide` needs no flip. `mesh.position.set()`; never assign `position`.

Leave `SHAKE_START`, `SHAKE_MOVING`, `SHAKE_RPM`, and `START_ENGINE_OFF` alone. Do not deploy.

## Check

From `frontend/client/`: eslint on the files you touched, then `npm run check`. A road or sky change that moves draw order or the pixels of a shared texture: `npm run trace:diff`. Say what was not verified.
