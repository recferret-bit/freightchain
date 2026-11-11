---
name: road-scene-3d
description: >
  An inhabited Freight Chain road corridor: a landmark you could stop at, a
  tree or prop for that route, lamp posts and guardrails. Roadside furniture
  and storybook shots of the shoulder. Not a truck, car, or bus mesh. Use
  when the user runs /road-scene-3d.
---

# Road corridor

A landmark should read as a place you could stop: a porch, a canopy, a pump, a sign you can read, a cruiser parked clear of the lane. Passive. No AI and no economy in these meshes.

Read [kinds/building.md](../model-geometry-validator/kinds/building.md) before a landmark and [kinds/tree.md](../model-geometry-validator/kinds/tree.md) before a tree. Run that skill's `validate.mjs` before a mesh. Shoot with that skill's `shot.mjs`. Do not restate storey, roof, or trunk rules.

## Landmark

`frontend/client/shared/entity/seed/landmark/<id>.js`, `anchor: 'base'`. Footprint and order: `ROSTER.landmark` in `frontend/client/shared/entity/roster.js`. A new row goes at the end of its type.

Frame: origin on the ground at the footprint centre, y up, front faces −x, the road runs along z. Parts stay inside the footprint. Nothing past local x = −hd, or it stands in the lane.

Ids include `motel-strip`, `motel-cabins`, `motel-twostory`, `hotel-tower`, `hotel-resort`, `gas-kiosk`, `gas-canopy`, `gas-truckstop`, `diner-chrome`, `roadhouse-porch`, `police-station`, `police-checkpoint`, `police-speedtrap`, `gulp-bay`, `fastfood-drive`. Place `cruiser`, `lm-pump`, and `lm-cones` with `ref`.

A dark disk on a wall is not a door. The opening needs depth: a recess or a frame, not paint flush with the wall. A sign is a `sign` or `disk` part. On a `sign`, `at.y` is the bottom of the board. On a `disk`, it is the centre.

## Apron

The join to the asphalt is not an entity part. `createLandmarks` adds one slab. It crosses the shoulder and tucks 0.5 m under the asphalt. Do not hide a grass gap with a ground box in the entity.

| layer | polygon offset |
|---|---|
| ground | 0 |
| road surface | -2 |
| apron and junction pad | -3 |
| lane marks | -4 |
| hole decals | -5 |

Not in the catalogue. Do not clone them into the viewer: road holes (`holes.js`), depot (`depot.js`), junctions (`junctions.js`), the road surface (`roadmesh.js`), the player trailer (`trailer.js`). All under `frontend/client/js/world/`.

## Climate and furniture

A route places props in `frontend/client/js/themes/<route>/props.js`.

| route | belongs there |
|---|---|
| route66 | cactus, rock, bush |
| stuart | gum-tree, termite, tuft, rock |
| siberia | spruce, birch, drift, rock |
| brenner | spruce, round-tree, rock, bush |
| panamerican | tuft, rock, cairn, cactus |

Prop seeds: `spruce`, `round-tree`, `gum-tree`, `birch`, `cactus`, `bush`, `rock`, `cairn`, `drift`, `termite`, `tuft`. A gum may lean. The trunk base still meets y = 0. Do not put a birch in the desert or a cactus in the snow.

Furniture seeds: `post`, `lamp`, `pole`, `guard`. Spacing, sides, and the gap at an apron stay in `frontend/client/js/themes/_shared/furniture.js`. Do not space them from the entity.

The finish gantry is `seed/gantry/gantry.js`. Its banner painter is `frontend/client/js/world/gantry.js`.

Part order: [roadside-kitbash-3d](../roadside-kitbash-3d/SKILL.md). Vehicles on the road: [traffic-vehicle-3d](../traffic-vehicle-3d/SKILL.md). Shaders and textures are `shader-texture-tuning`, and only after the shape is shot.

## After an edit

Shoot `right`, `front`, and `threeq`. Read the PNGs. From `frontend/client/`: eslint, then `npm run check`. Leave the shake constants alone. Do not deploy.
