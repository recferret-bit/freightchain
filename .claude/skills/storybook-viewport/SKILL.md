---
name: storybook-viewport
description: >
  Review Freight Chain models in the storybook viewer: three catalogue
  shots, ground contact, and parts that sit off the body. The page is
  frontend/client/viewer.html (production storybook.<apex>). Trigger words:
  storybook, viewer, screenshot, three views. Leave the camera at
  fov 45. Use when the user runs /storybook-viewport.
---

# Storybook viewport

`frontend/client/viewer.html` is the model viewer. Production host is `storybook.<apex>`. The catalogue is `frontend/client/js/catalogue.js`. It builds the same entities as the game. Ids are `<vehicle>`, `sedan#<paint>`, `<route>/<entity>`, and `<route>/<entity>~<n>`.

The camera is a `PerspectiveCamera`, fov 45, near 0.05, far 600 (`frontend/client/js/viewer.js`). It is not a 28° isometric camera. Do not change the fov to 28.

## Shots

Shots belong to `model-geometry-validator`. Do not add another capture path.

```sh
node .claude/skills/model-geometry-validator/shot.mjs <id>
```

No arguments prints the catalogue. Each id is saved as `right`, `front`, and `threeq`.

- `right` — camera on +x. Wheels sit outside the hull. A sign is edge-on.
- `front` — symmetry and the head-lamp pair.
- `threeq` — body style only. Not the clearance verdict.

Read the script's legend line, then read every PNG. `pastWidestBox` is not "past the painted hull". `gaps` is a candidate. `minY` is the lowest mesh. The grid is y = 0.

`shot.mjs` uses the first of `http://127.0.0.1:8765` and `:3000` that serves `/viewer.html`, or `BASE`. `file://` cannot load modules. Do not kill a server already serving this `frontend/client/`. `PORT` defaults to 9336. Do not start a second server on the same port.

## Not in the viewer

The viewer shows the rest pose. Blinkers, crashes, and spawns are not in it (`traffic-motion`, `road-particles-3d`). A road hole, the depot, the trailer, and the 2D cab are not in the catalogue. From `frontend/client/`, shoot those with `node tools/e2e-chrome.mjs`. Do not clone them into the viewer.

## Form shade

Day form shade in the viewer is F8 (`CFG.FORM_SHADE`), implemented in `frontend/client/js/world/nightlight.js`. It is a review aid. Upward faces stay flat. Open `highway-lighting` and `shader-texture-tuning`. Do not restate the shader.

## Checklist

Read the three PNGs against this list.

- Ground contact: `minY` about 0. A trunk or a tyre is not floating.
- No part hovering off the body. Use the legend's `gaps`, then the PNG.
- Wheels are outside the hull on `right`.
- Lamps are brighter lenses, not body paint.
- A sign is readable and not through the roof.
- A landmark does not stick into the lane.
- One route's materials do not make a prop a black blob.

Then quote the number that moved and the PNG name.

## Cards

`frontend/landing/src/dash-live.js` crops the 2D cockpit. A viewport review of a 3D entity does not verify a card. If the change was cockpit drawing, say the card was or was not opened.

## Viewer page

From `frontend/client/`, `npm run test:viewer` only when `viewer.js` or `viewer.html` changed.
