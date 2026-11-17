---
name: road-texture-synthesis
description: >
  Pillar 2 — Highway Procedural Texture Synthesis. Author deterministic HTML5
  CanvasTexture maps for Freight Chain asphalt (wheel-rut polish, tar cracks,
  edge lips, coarse shoulders), thermoplastic lane-marking atlases, mullioned
  building facades, double-bezel highway signs, flags, gantry banners, and
  corrugated DOT-taped trailer liveries. Use for /road-texture-synthesis.
---

# Highway Procedural Texture Synthesis (Pillar 2)

Freight Chain uses procedural 2D HTML5 `CanvasTexture` maps (`SRGBColorSpace`) on `MeshBasicMaterial` — zero external PNG/JPG/WebP texture assets on the 3D road, zero normal/roughness/metalness PBR maps. Night lighting and daytime form-shading come from `nightlight.js` (`shader-texture-tuning`).

Detailed pixel recipes and UV contracts: see [references/highway-texture-recipes.md](references/highway-texture-recipes.md).

---

## 1. Shared Canvas & Material Lifecycle Rules

- **`canvasTex(w, h, draw, repeat = true)`** (`frontend/client/js/world/scene.js`): Creates the offscreen `<canvas>`, runs `draw(ctx, w, h)`, sets `SRGBColorSpace`, and sets `RepeatWrapping` when `repeat === true`.
- **Theme Tracking & Mirror Flip**: Every single-sided theme material must be created inside `create*()` via `basic()` / `trackMat()` (`frontend/client/js/themes/_shared/mats.js`) or exported into `flipMats()` (`frontend/client/js/world/render.js`) so route teardown disposes GPU textures cleanly and the truck's mirror pass flips winding without rendering inside-out.
- **PRNG Determinism**: Never consume `Math.random()` inside new procedural texture loops when existing scene/headless RNG call counts matter — use a local deterministic integer hash / `mulberry32`-style helper (like `rnd()` in `road-texture.js` and `landmarks/index.js`) so `headless-test.mjs` and `trace:diff` stay deterministic.

---

## 2. Highway Asphalt & Shoulder (`themes/_shared/road-texture.js`)

`roadMaterial(c)` paints a `256 × 256` tile mapped across road width `u` and repeated every **`9 m`** along station `s` (`v = s / 9`, `wrapS = ClampToEdgeWrapping`, `wrapT = RepeatWrapping`):

| `u` range | Band | Procedural Micro-Surface Layers |
|---|---|---|
| `0.000 – 0.125` | Left shoulder | Base shoulder fill, coarse gravel clasts + shadow specks, soft outer verge transition |
| `0.125 – 0.875` | Travelled asphalt | Base asphalt, fine bitumen aggregate grain (dark + bright mineral specks), subtle **dual wheel-rut tyre polish bands** in both lane halves, faint **centre longitudinal paver joint**, crisp **paved-edge shoulder drop lips** (`u = 0.125` & `0.875`), and meandering **tar-sealed micro-cracks** |
| `0.875 – 1.000` | Right shoulder | Mirrors left shoulder (`surfCols` in `world/roadmesh.js` pins `0.125` and `0.875` to road edges regardless of lane count) |

Each route (`themes/<route>/road.js`) supplies only route palette colours (`asphalt`, `speck`, `shoulder`, `shoulderSpeck`, `crack`) to `roadMaterial()`. Never paint lane stripes into `roadMaterial()` — `u` stretches when lanes split or widen.

---

## 3. Thermoplastic Road-Marking Atlas (`marksMat` / `MARK`)

Markings are separate ribbon quads (`markLines` in `world/roadmesh.js`, `0.13–0.16 m` wide) hovering over the road via `polygonOffset (-4, -4)`:
- **Atlas**: `(MARK_COLS * 16) × 64` (`MARK_COLS = 8`), `MARK = { edge: 0, solid: 1, dash: 2, lane: 3, stop: 4 }`.
- **Crisp Filtering**: `wrapS = ClampToEdgeWrapping`, `generateMipmaps = false`, `minFilter = LinearFilter`, `alphaTest: 0.5`.
- **Thermoplastic Texture**: Painted strips carry subtle glass-bead micro-grain so markings read as thick highway paint rather than flat plastic, while `dash` / `lane` paint the top third (`3 m` stripe per `9 m` cycle).

---

## 4. Architectural, Signage & Trailer Painters

- **`facadeMat` (`themes/_shared/landmarks/index.js`, `256 × 256`)**: Horizontal spandrel shadow bands, vertical pier shading, dark outer window frames, recessed window panes (`rnd()` selects unlit sky-tinted glass vs two-tone warm incandescent rooms with curtain/ceiling falloff), and projecting stone sills.
- **`signMat` (`256 × 128`) & `diskFace` (`256 × 256`)**: Outer casing rim, inset contrasting inner bezel, subtle vertical background gradient, and drop-shadowed bold highway typography auto-fitted to width. Remember: `diskFace(..., flip = true)` mirrors the `-x`/`+x` back face intentionally so text reads left-to-right from both directions — never remove `flip`.
- **`banner` (`world/gantry.js`, `1024 × 192`)**: Overhead highway guide-sign green panel, outer silver/white double border, corner rivets, route subtitle, and drop-shadowed destination legend (`toneMapped: false`, `DoubleSide` — self-lit at night, mounted proud of truss chords at `z = +0.56`).
- **`setLivery` (`world/trailer.js`, `1024 × 256`)**: Vertical aluminum rib corrugation shading, top/bottom rub-rail strips, bold freighter wordmark + accent stripe, and alternating red/white **DOT-C2 retroreflective conspicuity tape** along the lower sill.

---

## 5. Verification

```sh
npm --prefix frontend/client run check
npm --prefix frontend/client run trace:save   # only when updating intentional baseline
PORT=9333 node frontend/client/tools/e2e-chrome.mjs
```

Visually inspect the Chrome gameplay screenshots (`02-driving.png`, `04-mirror-view.png`, etc.) and landmark shots (`shot.mjs`) to confirm crisp mip-free markings, natural asphalt wear without obvious `9 m` tile seams, and readable signs.
