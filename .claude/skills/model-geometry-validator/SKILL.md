---
name: model-geometry-validator
description: >
  Review, fix, add, or generate Freight Chain 3D entities in the storybook
  viewer: traffic vehicles, roadside props, landmarks, furniture, the gantry.
  Runs the spec gate before a car, tree, or building mesh. Use when the user
  reports a visual bug, a floating part, a wheel, a sign, viewer.html, or
  asks to create or change a 3D object, and when they run
  /model-geometry-validator or /3d-assets.
---

# Model geometry

Every model is an ENTITY: data-only module `export default { … }` in `frontend/client/shared/entity/seed/<kind>/<id>.js` (no functions; numbers can be expression strings), built by `frontend/client/shared/entity/plan.js` → `frontend/client/js/world/entity-build.js`. Viewer `frontend/client/viewer.html` (production `storybook.<apex>`), catalogue `frontend/client/js/catalogue.js`. Edit the entity. Do not add a mesh only the viewer draws. Do not register a catalogue row by hand.

Format lives in `docs/agents/world.md` ("Entities"). Gameplay is NOT in the entity: `frontend/client/shared/entity/roster.js` (collision kind and size, landmark footprints and order, which vehicles have a siren). Vehicle sizes are `VEHICLES` in `frontend/client/shared/traffic.js`. Frames, materials, mirrors, pools: `docs/agents/world.md` and `docs/agents/client.md`. Pin a sign or an axis with a number `shot.mjs` prints. A change to the conversion's output also needs `npm run test:parity` and `npm run trace:diff` from `frontend/client/`.

Siblings, do not restate: [roadside-kitbash-3d](../roadside-kitbash-3d/SKILL.md) (how to assemble parts), [traffic-vehicle-3d](../traffic-vehicle-3d/SKILL.md), [road-scene-3d](../road-scene-3d/SKILL.md), [storybook-viewport](../storybook-viewport/SKILL.md) (how to read the three shots), [shader-texture-tuning](../shader-texture-tuning/SKILL.md) (after the shape is sound).

## Order

Name the parts first (entity part names, and the `tyre` tag on every tyre). Then `validate.mjs` when the request states a count, and before any new car, tree, or building mesh. After an edit, `node --test frontend/client/test/entity.test.mjs`. Then `shot.mjs` and read the PNGs. Only then materials (`shader-texture-tuning`). Do not tune a texture on a shape that fails the spec gate.

What those runs already judge: wheel and axle counts, one trunk, canopy required or forbidden, storeys, roof and walls (`validate.mjs` `expect`); floating parts in the entity summary (`validateEntity` warnings); `minY`, `gaps`, `pastWidestBox` (`shot.mjs`). They do not score colour. From the PNG: body paint, tyre, rim, glass, and a self-lit lamp must separate; a wheel shows a tyre and a rim; a lamp is a lens, not a body-coloured box; a big blank face needs one feature (stripe, vent, sign, lamp), not a scatter of extra parts. The look is chunky `MeshBasic` boxes. A clean script with a wrong picture means look again. A numeric pass is not "looks good".

## Kind

Cars, trees, and buildings are different objects. Read one kind file. Counts live in `rules.json`, not the kind file.

| kind | read |
|---|---|
| car, truck, bus, freighter | `kinds/car.md` |
| tree | `kinds/tree.md` |
| building, landmark | `kinds/building.md` |

Before generating a mesh, an image, or a `.glb` of one of these, run:

```sh
node .claude/skills/model-geometry-validator/validate.mjs "the user's sentence"
```

Exit 1: stop. Quote `errors`. Do not edit an entity. Use `expect` from an exit-0 run as the spec. Exit 0 with `"skipped": true` is a rock, cactus, bush, or other prop: use the prop row, not a kind file. A review of an existing catalogue id skips the validator unless the change states a count or a part (wheels, axles, trunk, canopy, roof, walls, storeys).

## Which job

| ask | done when |
|---|---|
| review / fix a visual report | every note is a catalogue id with a before/after shot, or a moving behaviour checked outside the viewer |
| add a 3D object | a new entity file (+ a roster row and a call site if the game places it), the list prints its id, and the three shots show it |
| change an existing object | that entity, shots of the ids you touched, no other mesh retuned |

Match a note to an id from the list. The wording may not be the viewer's label. A second look is `<route>/<id>~<n>`. The picture decides. When the note is about a body or its wheels, shoot every listed paint of that vehicle.

## Where to edit

| object | file |
|---|---|
| traffic vehicle | `seed/vehicle/<type>.js` + the shared parts `seed/part/veh-*.js` (wheels, lights, siren, bodies). Size / mass / speed / presets are `VEHICLES` (`frontend/client/shared/traffic.js`), never the entity. Id shape `<type>`, `sedan#<paint>` |
| prop | `seed/prop/<id>.js`; which prop a route places with which params and materials is that route's `frontend/client/js/themes/<route>/props.js`. A new collision kind is a `KINDS` row in `frontend/client/js/world/props.js` + a roster row. Id shape `<route>/<id>` |
| furniture | `seed/furniture/{post,lamp,pole,guard}.js`; spacing and sides stay in `frontend/client/js/themes/_shared/furniture.js` |
| landmark | `seed/landmark/<id>.js` (+ the parts `cruiser`, `lm-pump`, `lm-cones`); footprint and order are `ROSTER.landmark`; signs, facades, and the apron that meets the road are in `frontend/client/js/themes/_shared/landmarks/index.js` (the apron is not an entity part — see `kinds/building.md`) |
| finish gantry | `seed/gantry/gantry.js`, banner painter in `frontend/client/js/world/gantry.js` |

(`seed/` = `frontend/client/shared/entity/seed/`. After adding or removing a file: `node frontend/client/tools/entity-seed-index.mjs`.) Check: `node --test frontend/client/test/entity.test.mjs` — it validates every seed (shape, expressions, the roster contract, finite numbers at every param's min and max).

Not in the catalogue: a road hole (`frontend/client/js/world/holes.js`); the depot, junctions, road surface, and player trailer (`depot.js`, `junctions.js`, `roadmesh.js`, `trailer.js` in that same `world/` folder). The cab is 2D (`frontend/client/js/cockpit/`).

A `geo` part is `mk(geo, mat, sx, sy, sz, x, y, z)` (scale, then position); `anchor: 'base'` puts its bottom on `at.y`. A `sign` part's `at.y` is the bottom of the board, a `disk`'s is its centre.

If the list has no id, the viewer never builds that object. Screenshot it from `frontend/client/` with `node tools/e2e-chrome.mjs`. Do not clone it into the viewer.

## Not a still picture

A blinker, a collision, a spawn, or damage only exists while the sim runs. Say so. Indicators and contact are `frontend/client/js/sim/traffic.js`. Check them with the headless playthrough in `docs/agents/verifying.md`. A collision fix may push the other vehicle. It must not write `st.s` on a fatal hit: the server flags a teleport (`docs/spec/anticheat.md`).

## Serve

`shot.mjs` uses the first of `http://127.0.0.1:8765` and `:3000` that serves `/viewer.html`, unless `BASE` is set. `file://` cannot load the modules. `frontend/client/serve.sh` is IPv4 and opens `/`, not `/viewer.html`. Browsers often resolve `localhost` to `::1` first: confirm `127.0.0.1` and `[::1]` both answer, or bind `::` with `IPV6_V6ONLY=0`. Do not kill a server that is already serving this `frontend/client/`, and do not start a second one on the same port.

## Look

From the repo root:

```sh
node .claude/skills/model-geometry-validator/shot.mjs
node .claude/skills/model-geometry-validator/shot.mjs sedan route66/cactus
```

No arguments prints the catalogue and exits. Each id is measured and saved as `right`, `front`, and `threeq` PNGs. `PORT` default `9336` (`9333` and `9334` are the other e2e scripts). `SHOTS` is the directory. Read the script's legend line, then read every PNG. `right` is the camera on +x. `pastWidestBox` is not "past the painted hull". A `gaps` line is a candidate. The PNG decides.

## After the edit

Re-run `shot.mjs` on the same ids. Quote the before/after number and the PNG. From `frontend/client/`: eslint on the files you touched, then `npm run check`. `npm run test:viewer` only when `viewer.js` or `viewer.html` changed. Leave user-tuned shake constants alone. Do not deploy.

## Report

One line per object: id, what was wrong, the number that moved, which PNG shows it. Name anything you did not open. Say what a person should still eyeball.
