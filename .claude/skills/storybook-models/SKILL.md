---
name: storybook-models
description: >
  Review and fix Freight Chain meshes in the storybook model viewer
  (client/viewer.html, production storybook.<apex>), and use the same
  procedure to add or update any 3D object the game draws (traffic vehicle,
  roadside prop, landmark, furniture, gantry, road hole). Use when the user
  reports a visual bug of a roadside object, pastes screenshots or a
  spreadsheet of models, mentions wheels, a sign, a floating part, a beacon,
  the storybook, the model viewer, or viewer.html, or asks to create, add,
  change, or update a 3D object, mesh, vehicle, prop, or building in the game.
  Use when the user runs /storybook-models.
---

# Storybook models

The viewer (`client/viewer.html`) builds its catalogue by calling the game's builders (`client/js/viewer.js`). Edit that builder. Do not add a mesh that only the viewer draws, and do not register a catalogue row by hand.

Frames, materials, mirrors and pools stay in AGENTS.md ("Landmarks", "Themes (routes)", "Rendering gotchas", "Object pools"). Before a mount, a yaw, a wheel axis, or a collider that must match a mesh, read the `threejs-frame-conventions` skill. Pin the sign with a number `shot.mjs` prints.

## Which job

| ask | done when |
|---|---|
| review / fix a visual report | every note is a catalogue id with a before/after shot, or a moving behaviour checked outside the viewer |
| add a 3D object | the builder below owns it, the list prints its id, and the three shots show it |
| change an existing object | that same builder, shots of the ids you touched, no other mesh retuned |

Match a note to an id from the list. The wording may not be the viewer's label. The picture decides. When the note is about a body or its wheels, shoot every listed paint of that vehicle.

## Where to edit

| object | file |
|---|---|
| traffic vehicle | `client/js/world/vehicles.js` — `STYLES` is the mesh, `VEHICLES` is size / mass / speed / presets. Id shape `veh-<type>-<pick>` |
| prop | `client/js/themes/_shared/props-basic.js`, or that route's `props.js`. A new collision kind is a `KINDS` row in `client/js/world/props.js` (AGENTS.md "Themes") |
| furniture | `client/js/themes/_shared/furniture.js`, switched on by the theme's `furniture` options |
| landmark | `client/js/themes/_shared/landmarks/` (AGENTS.md "Landmarks", including `c.sign`) |
| finish gantry | `client/js/world/gantry.js`, banner from the theme's `finishText` |
| road hole | `client/js/world/holes.js`. Not in the catalogue |
| depot, junctions, road surface, player trailer | `client/js/world/depot.js`, `junctions.js`, `roadmesh.js`, `trailer.js`. Not in the catalogue. The cab is 2D (`client/js/cockpit/`) |

`mk(geo, mat, sx, sy, sz, x, y, z)` in `world/props.js` scales, then positions. Elsewhere set position with `.position.set`.

If the list has no id, the viewer never builds that object. Screenshot it from `client/` with `node tools/e2e-chrome.mjs`. Do not clone it into the viewer to get a shot.

## Not a still picture

A blinker, a collision, a spawn, or damage only exists while the sim runs. Say so. Indicators and contact are `client/js/sim/traffic.js`. Check them with the headless playthrough in AGENTS.md "Verifying changes". A collision fix may push the other vehicle. It must not write `st.s` on a fatal hit: the server flags a teleport (AGENTS.md "Verified play").

## Serve

`shot.mjs` uses the first of `http://127.0.0.1:8765` and `:3000` that serves `/viewer.html`, unless `BASE` is set. `file://` cannot load the modules. `client/serve.sh` is IPv4 and opens `/`, not `/viewer.html`. Browsers often resolve `localhost` to `::1` first: before you give the user a URL, confirm `127.0.0.1` and `[::1]` both answer, or bind `::` with `IPV6_V6ONLY=0` so they do. Do not kill a server that is already serving this `client/`, and do not start a second one on the same port.

## Look

From the repo root (the script finds the repo from its own path):

```sh
node .claude/skills/storybook-models/shot.mjs
node .claude/skills/storybook-models/shot.mjs veh-sedan-0 route66-cactus1
```

No arguments prints the catalogue and exits. Each id argument is measured and saved as `right`, `front`, and `threeq` PNGs. `PORT` is the Chrome debug port (default `9336`; `9333` and `9334` are the other e2e scripts). `SHOTS` is the directory.

Read the script's legend line, then read every PNG. `right` is the camera on +x: the view that shows a wheel inside the hull, and a board that is edge-on from the road. A 3/4 shot hides both. `pastWidestBox` is not "past the painted hull", and a `gaps` line is a candidate, not a verdict — the legend says what each number is, and the PNG decides.

## After the edit

Re-run `shot.mjs` on the same ids. Quote the before/after number and the PNG that shows it. From `client/`: eslint on the files you touched, then `npm run check`. `npm run test:viewer` only when `viewer.js` or `viewer.html` changed. Leave user-tuned shake constants alone, and do not deploy (AGENTS.md).

## Report

One line per object: id, what was wrong, the number that moved, which PNG shows it. Name anything you did not open. Say what a person should still eyeball.
