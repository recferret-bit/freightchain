---
name: 3d-assets
description: >
  Review and fix Freight Chain meshes in the storybook model viewer
  (client/viewer.html, production storybook.<apex>), and use the same
  procedure to add or update any 3D object the game draws (traffic vehicle,
  roadside prop, landmark, furniture, gantry, road hole). Use when the user
  reports a visual bug of a roadside object, pastes screenshots or a
  spreadsheet of models, mentions wheels, a sign, a floating part, a beacon,
  the storybook, the model viewer, or viewer.html, or asks to create, add,
  change, update, or generate a 3D object, mesh, vehicle, car, tree, or
  building. A car, tree, or building spec is checked with validate.mjs
  before any mesh or generated model (a car with 2 wheels fails).
  Use when the user runs /3d-assets.
---

# 3D assets

Every model is an ENTITY: a data-only module `export default { … }` in `client/shared/entity/seed/<kind>/<id>.js` (no functions; numbers can be expression strings like `'h * 0.45'`), built by one interpreter (`client/shared/entity/plan.js` → `client/js/world/entity-build.js`). The viewer (`client/viewer.html`, catalogue in `client/js/catalogue.js`) builds the same entities the game does. Edit the entity. Do not add a mesh that only the viewer draws, and do not register a catalogue row by hand.

The format (parts, loops, materials, `use` / `ref`, roles) is in `docs/agents/world.md` ("Entities"). What an entity may NOT change is gameplay, in `client/shared/entity/roster.js`: collision kind and size, landmark footprints and order, which vehicles have a siren; vehicle sizes are `VEHICLES` in `client/shared/traffic.js`. Frames, materials, mirrors and pools stay in `docs/agents/world.md` and `docs/agents/client.md` ("Rendering gotchas", "Object pools"). Pin a sign or an axis with a number `shot.mjs` prints.

## Kind

Cars, trees, and buildings are different objects. Read one kind file. Counts live in `rules.json`, not in the kind file.

| kind | read |
|---|---|
| car, truck, bus, freighter | `kinds/car.md` |
| tree | `kinds/tree.md` |
| building, landmark | `kinds/building.md` |

Before generating a mesh, an image, or a `.glb` of one of these, run:

```sh
node .claude/skills/3d-assets/validate.mjs "the user's sentence"
```

Exit 1: stop. Quote `errors`. Do not edit an entity. Use `expect` from an exit-0 run as the spec. Exit 0 with `"skipped": true` is a rock, cactus, bush, or other prop: use the prop row below, not a kind file. A review of an existing catalogue id skips the validator unless the change states a count or a part (wheels, axles, trunk, canopy, roof, walls, storeys).

## Which job

| ask | done when |
|---|---|
| review / fix a visual report | every note is a catalogue id with a before/after shot, or a moving behaviour checked outside the viewer |
| add a 3D object | a new entity file (+ a roster row and a call site if the game places it), the list prints its id, and the three shots show it |
| change an existing object | that entity, shots of the ids you touched, no other mesh retuned |

Match a note to an id from the list. The wording may not be the viewer's label. The picture decides. When the note is about a body or its wheels, shoot every listed paint of that vehicle.

## Where to edit

| object | file |
|---|---|
| traffic vehicle | `seed/vehicle/<type>.js` + the shared parts `seed/part/veh-*.js` (wheels, lights, siren, bodies). Size / mass / speed / presets are `VEHICLES` (`client/shared/traffic.js`), never the entity. Id shape `<type>`, `sedan#<paint>` |
| prop | `seed/prop/<id>.js`; which prop a route places with which params and materials is that route's `client/js/themes/<route>/props.js`. A new collision kind is a `KINDS` row in `client/js/world/props.js` + a roster row. Id shape `<route>/<id>` |
| furniture | `seed/furniture/{post,lamp,pole,guard}.js`; spacing and sides stay in `client/js/themes/_shared/furniture.js` |
| landmark | `seed/landmark/<id>.js` (+ the parts `cruiser`, `lm-pump`, `lm-cones`); footprint and order are `ROSTER.landmark`; signs and facades are painters in `client/js/themes/_shared/landmarks/index.js` |
| finish gantry | `seed/gantry/gantry.js`, banner painter in `client/js/world/gantry.js` |

(`seed/` = `client/shared/entity/seed/`; after adding or removing a file run `node client/tools/entity-seed-index.mjs`.) Check an edited entity with `node --test client/test/entity.test.mjs` – it validates every seed (shape, expressions, the roster contract, finite numbers at every param's min and max).
| road hole | `client/js/world/holes.js`. Not in the catalogue |
| depot, junctions, road surface, player trailer | `client/js/world/depot.js`, `junctions.js`, `roadmesh.js`, `trailer.js`. Not in the catalogue. The cab is 2D (`client/js/cockpit/`) |

A `geo` part is `mk(geo, mat, sx, sy, sz, x, y, z)` (scale, then position); `anchor: 'base'` puts its bottom on `at.y` (landmarks). A `sign` part's `at.y` is the bottom of the board, a `disk`'s is its centre.

If the list has no id, the viewer never builds that object. Screenshot it from `client/` with `node tools/e2e-chrome.mjs`. Do not clone it into the viewer to get a shot.

## Not a still picture

A blinker, a collision, a spawn, or damage only exists while the sim runs. Say so. Indicators and contact are `client/js/sim/traffic.js`. Check them with the headless playthrough in `docs/agents/verifying.md`. A collision fix may push the other vehicle. It must not write `st.s` on a fatal hit: the server flags a teleport (`docs/spec/anticheat.md`).

## Serve

`shot.mjs` uses the first of `http://127.0.0.1:8765` and `:3000` that serves `/viewer.html`, unless `BASE` is set. `file://` cannot load the modules. `client/serve.sh` is IPv4 and opens `/`, not `/viewer.html`. Browsers often resolve `localhost` to `::1` first: before you give the user a URL, confirm `127.0.0.1` and `[::1]` both answer, or bind `::` with `IPV6_V6ONLY=0` so they do. Do not kill a server that is already serving this `client/`, and do not start a second one on the same port.

## Look

From the repo root (the script finds the repo from its own path):

```sh
node .claude/skills/3d-assets/shot.mjs
node .claude/skills/3d-assets/shot.mjs sedan route66/cactus
```

No arguments prints the catalogue and exits. Each id argument is measured and saved as `right`, `front`, and `threeq` PNGs. `PORT` is the Chrome debug port (default `9336`; `9333` and `9334` are the other e2e scripts). `SHOTS` is the directory.

Read the script's legend line, then read every PNG. `right` is the camera on +x: the view that shows a wheel inside the hull, and a board that is edge-on from the road. A 3/4 shot hides both. `pastWidestBox` is not "past the painted hull", and a `gaps` line is a candidate, not a verdict — the legend says what each number is, and the PNG decides.

## After the edit

Re-run `shot.mjs` on the same ids. Quote the before/after number and the PNG that shows it. From `client/`: eslint on the files you touched, then `npm run check`. `npm run test:viewer` only when `viewer.js` or `viewer.html` changed. Leave user-tuned shake constants alone, and do not deploy (AGENTS.md).

## Report

One line per object: id, what was wrong, the number that moved, which PNG shows it. Name anything you did not open. Say what a person should still eyeball.
