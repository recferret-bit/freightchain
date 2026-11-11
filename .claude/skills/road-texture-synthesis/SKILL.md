---
name: road-texture-synthesis
description: >
  Paint a Freight Chain canvas for asphalt, shoulder, a road marking, a sign,
  a facade, or a flag. Triggers on texture, asphalt, road marking, material,
  shader, pixel, and night shade only to send night work elsewhere. No normal
  map and no PBR set. Use when the user runs /road-texture-synthesis.
---

# Road texture synthesis

Paint a canvas. Height-to-normal and PBR sets (roughness, metalness, triplanar) do not exist. Do not build them. Night shade is `shader-texture-tuning`. A wrong mesh is `model-geometry-validator` first. Debris materials are `road-particles-3d`.

## Shared helper

`canvasTex(w, h, draw, repeat = true)` in `frontend/client/js/world/scene.js` builds a `CanvasTexture`, sets `SRGBColorSpace`, and (when `repeat`) sets wrap S and T to `RepeatWrapping`. These canvases are colours. Do not gamma-correct a data array that is not a colour, and do not push a non-colour buffer through `canvasTex`.

Theme materials go through `trackMat` (`frontend/client/js/themes/_shared/mats.js`) inside `create*()`, so a route switch disposes them and the mirror pass can flip single-sided ones. `mesh.position.set()`; never assign `position`.

## Asphalt and shoulder

`roadMaterial()` in `frontend/client/js/themes/_shared/road-texture.js`. Each route only passes colours from `frontend/client/js/themes/<route>/road.js` `createRoadMaterial()`.

One 256×256 tile. Across **u**:

| u | band |
| --- | --- |
| 0–0.125 | shoulder |
| 0.125–0.875 | asphalt (this band stretches with the lane count) |
| 0.875–1 | shoulder |

`surfCols` in `frontend/client/js/world/roadmesh.js` pins those two asphalt edges. Change the bands in both files or a wide road samples shoulder.

Along the road, **v = s / 9** (`spineStations`, `altStations`). The tile repeats every 9 m. After `canvasTex`, set `wrapS` to `ClampToEdgeWrapping` so the shoulder does not wrap into the lane. Leave `wrapT` as `RepeatWrapping`.

Grain is 1-2 px specks (`fillRect`), already in `roadMaterial` (`speck`, optional `shoulderSpeck`). `Math.random()` while the texture is drawn is allowed for visuals. Reordering theme drawing changes the headless trace. Never use `Math.random()` in gameplay. Do not drop in a photo.

## Mark atlas

Markings are a separate mesh, not pixels in the asphalt. `MARK = { edge: 0, solid: 1, dash: 2, lane: 3, stop: 4 }`, `MARK_COLS = 8`. Atlas is `MARK_COLS * 16` by 64. A quad samples the column centre `(c + 0.5) / MARK_COLS` (`ucol` in `roadmesh.js`). Dash paints the top third of the column; the atlas repeats, so a dash is 3 m painted in every 9 m.

`wrapS` is `ClampToEdgeWrapping`. `generateMipmaps = false` and `minFilter = LinearFilter` so dashes stay crisp. Material is alpha-tested (`alphaTest: 0.5`).

`markLines` places centre, edge, and lane quads by lateral metres (`edgeOf`), about 0.13–0.16 m wide. A line painted at a fixed **u** inside the asphalt band stretches when lanes are added and can slide into the shoulder. A new pattern is a free atlas column plus a branch in `markLines`, not a stripe in `roadMaterial`.

Polygon offsets (factor and units): ground 0, surface −2, apron / junction pad −3, marks −4, hole decals −5 and more negative (`world/holes.js`). At 500 m the depth buffer steps about 5 cm. Offset is what keeps a marking on top. Do not flatten these to 0.

## Sign, facade, flag

Painters live in `frontend/client/js/themes/_shared/landmarks/index.js`, cached in the `Map` inside `createLandmarks`, `canvasTex(..., false)` so they do not tile.

- Sign: `signMat`, 256×128, border and text fitted down. A sign part's `at.y` is the bottom of the board (`frontend/client/shared/entity/plan.js`). Text defaults to the site name.
- Round board: `diskFace`. `at.y` is the centre. The back face is drawn flipped; do not "fix" that or the word is upside down from the road.
- Facade: `facadeMat`, 256×256 window grid. Cols and rows are capped at 32. Lit windows use `rnd`, not `Math.random`.
- Flag: `drawFlag` in `landmarks/flags.js`, 256×160, one material per side (`px` / `nx`).
- Finish banner: `banner()` in `frontend/client/js/world/gantry.js`. `toneMapped: false`, `DoubleSide`. It is self-lit; do not run it through the night patch.

A new pattern is a function next to `roadMaterial`, or a painter beside `signMat` / `banner`, keyed in that cache, `trackMat`'d, shared, and disposed with the theme (`disposeMats`). No image file.

## Check

From `frontend/client/`: eslint on the files you touched, then `npm run check`. If drawing order or the pixels of a shared texture change: `npm run trace:diff`. Do not deploy. Leave the shake constants alone.
