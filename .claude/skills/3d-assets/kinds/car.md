# Cars

Road vehicles. The head noun picks the subtype. Subtypes, counts, and forbidden parts live in `rules.json`. `validate.mjs` is the check.

`vehicle` on its own is rejected. A tree or a building that merely contains a parked car is not this kind.

## Before a mesh or a generated model

From the repo root:

```sh
node .claude/skills/3d-assets/validate.mjs "the user's sentence"
```

Exit 1: stop. Quote `errors`. Do not edit the entity. A passing run prints `expect`. Build that wheel count and that axle count. Read `seed/part/veh-wheels.js`: one left and one right tyre at each axle z (`zs`); every tyre part is tagged `tyre` (the validator counts them).

## Edit

`client/shared/entity/seed/vehicle/<type>.js` is the mesh (shared parts in `seed/part/veh-*.js`). `VEHICLES` (`client/shared/traffic.js`) is size, mass, speed, presets – the body must stay inside that box. Catalogue id `<type>`, `sedan#<paint>`.

Frame: origin at the footprint centre on the ground, forward −z, right +x. Read the `wheels()` comment for how far the tyre sits outside the hull, and match it.

## Review

`node .claude/skills/3d-assets/shot.mjs <id>` then read the PNGs.

- `right` (camera on +x): near-side tyres equal the axle count in `expect`. Each tyre sits outside the painted hull. A tyre inside the hull fails this shot. A 3/4 shot does not show that.
- `front`: one left and one right wheel, symmetric about x = 0, and a head-lamp pair on the −z face. Far axles are hidden here.
- `threeq`: body style only (cabin, stripe, cargo box, glass band, trailer). Not the clearance verdict.

Shoot every listed paint when the note is about the body or the wheels.
