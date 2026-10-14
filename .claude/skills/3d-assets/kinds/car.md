# Cars

Road vehicles. The head noun picks the subtype. Subtypes, counts, and forbidden parts live in `rules.json`. `validate.mjs` is the check.

`vehicle` on its own is rejected. A tree or a building that merely contains a parked car is not this kind.

## Before a mesh or a generated model

From the repo root:

```sh
node .claude/skills/3d-assets/validate.mjs "the user's sentence"
```

Exit 1: stop. Quote `errors`. Do not edit `vehicles.js`, and do not call `image_gen` or `three_d.py`. A passing run prints `expect`. Build that wheel count and that axle count. Read `wheels()`: one left and one right tyre at each axle z.

## Edit

`client/js/world/vehicles.js`. `STYLES` is the mesh. `VEHICLES` is size, mass, speed, presets. Catalogue id `veh-<type>-<pick>`.

Frame: origin at the footprint centre on the ground, forward −z, right +x. Read the `wheels()` comment for how far the tyre sits outside the hull, and match it.

## Review

`node .claude/skills/3d-assets/shot.mjs <id>` then read the PNGs.

- `right` (camera on +x): near-side tyres equal the axle count in `expect`. Each tyre sits outside the painted hull. A tyre inside the hull fails this shot. A 3/4 shot does not show that.
- `front`: one left and one right wheel, symmetric about x = 0, and a head-lamp pair on the −z face. Far axles are hidden here.
- `threeq`: body style only (cabin, stripe, cargo box, glass band, trailer). Not the clearance verdict.

Shoot every listed paint when the note is about the body or the wheels.
