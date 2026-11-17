---
name: storybook-viewport
description: >
  Pillar 4 — Storybook Viewport & Visual QA Auditor. Capture and audit 4-angle
  orthographic/3-quarter renders (right, front, top, threeq) in viewer.html
  plus live highway/mirror frames via e2e-chrome.mjs. Use when inspecting
  models, verifying visual quality, or running /storybook-viewport.
---

# Storybook Viewport & Visual QA Auditor (Pillar 4)

Numeric bounding-box checks catch structural bugs, but **visual inspection of rendered PNGs is mandatory** before declaring any 3D model or texture upgrade finished.

Freight Chain's live model stage is `frontend/client/viewer.html` (production `storybook.<apex>`), backed by `frontend/client/js/viewer.js` (`PerspectiveCamera`, `fov = 45`, `near = 0.05`, `far = 600` — keep `fov = 45`) and `frontend/client/js/catalogue.js`.

---

## 1. Automated 4-View Capture (`shot.mjs`)

Use `model-geometry-validator/shot.mjs` (never create duplicate Puppeteer/Playwright screenshot harnesses):

```sh
# Print all catalogue IDs (<vehicle>, sedan#<paint>, <route>/<entity>, <route>/<entity>~<n>)
node .claude/skills/model-geometry-validator/shot.mjs

# Measure and capture 4 views (<slug>-{right,front,top,threeq}.png)
node .claude/skills/model-geometry-validator/shot.mjs freighter bus fire police route66/diner-chrome route66/gas-canopy
```

- `shot.mjs` auto-detects `http://127.0.0.1:8765` or `:3000` (or `BASE=http://127.0.0.1:<port>`), hides UI chrome and black wireframe edge helpers so true `formShade` bevels and material contrasts are visible, keeps the `1 m` ground grid (`y = 0`), and exits `1` on any page/console error.
- **Orientation-Aware Camera Angles**:
  - **Vehicles / Props / Furniture** (forward = `-z`):
    - `right` (`yaw = +π/2`): side profile, axle spacing, wheel protrusion past body.
    - `front` (`yaw = π`): `-z` front grille, headlamp symmetry, windshield rake, roof height.
    - `top` (`pitch = 1.48`): roof equipment (AC pods, ladders, exhaust stacks, fairing taper).
    - `threeq` (`yaw = π - 0.6, pitch = 0.35`): **front-right 3/4 hero view**.
  - **Gantry** (`gantry` / `*/gantry`, banner faces approaching player along **`+z`**):
    - `front` (`yaw = 0`): straight at the `+z` guide sign so typography reads left-to-right unobstructed by rear chords.
    - `threeq` (`yaw = 0.55, pitch = 0.35`): **front-right 3/4 approach view**.
  - **Landmarks** (`group` starts with `'Landmarks'`, front faces **`-x`** toward the road):
    - `front` (`yaw = -π/2`): straight into the `-x` storefront, pumps, colonnade, and entry doors.
    - `right` (`yaw = 0`): `+z` lot side profile & apron join.
    - `top` (`yaw = -π/2, pitch = 1.48`): lot layout, island spacing, roof mechanicals.
    - `threeq` (`yaw = -π/2 + 0.55, pitch = 0.35`): **front-right 3/4 road-approach view**.
- Interactive `viewer.html` uses the same orientation-aware `frame()`, displays `meshes / tris` and `ground minY` in `#info`, and binds keys `1` (`threeq`), `2` (`front`), `3` (`right`), and `4` (`top`).

---

## 2. Visual Audit Rubric (Read Every Captured PNG)

Open the saved PNGs with `read_file` and verify every item on this checklist:

1. **Silhouette & Anti-Cube Check (`threeq` + `right`)**:
   - Does the model immediately read as its real-world highway archetype (sleeper semi, motorcoach, fire pumper, chrome diner, truckstop canopy, saguaro cactus) rather than a plain rectangular box?
   - Do `rbox` chamfers, `wedge` windshields/hoods, and `gable`/`barrel` roofs catch distinct shading steps under `F8` `formShade`?
2. **Ground Seating & Support Continuity (`right` + `front`)**:
   - `minY` sits cleanly on the `y = 0` grid (no floating tyres, hovering posts, or sunken wheels).
   - No disconnected lightbars, floating mirrors, unbraced signs, or hovering roof details.
3. **Wheel & Axle Readability (`right` + `front`)**:
   - Tyres (`TYRE`) and stepped silver rims (`RIM`) protrude visibly outside the painted fender line and sit inside proper dark wheel-arch housings.
4. **Contrast & Livery Legibility (`front` + `threeq`)**:
   - Grilles, windows, doors, and trim separate crisply from body/wall colours — especially on black/dark vehicles (`police`, dark `sedan` variants).
   - `sign`, `disk`, and `gantry` `banner` typography is un-clipped, right-side-up, and framed by clean bezels.

---

## 3. Non-Catalogue & Full-Corridor Verification

Models built directly on the highway scene (`world/trailer.js`, `depot.js`, `junctions.js`, `toll.js`, `holes.js`, `road-texture.js`, and 2D `cockpit/*`) are **not** in `viewer.html`. Verify them in real Chrome:

```sh
PORT=9333 node frontend/client/tools/e2e-chrome.mjs
PORT=9334 node frontend/client/tools/e2e-viewer.mjs http://127.0.0.1:8765/viewer.html?editor=off
```

Read the resulting gameplay screenshots (check asphalt wear/markings, oncoming traffic, depot/toll/junction geometry, and the player trailer in the left/right mirrors).
