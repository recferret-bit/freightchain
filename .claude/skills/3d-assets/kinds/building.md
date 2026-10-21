# Buildings

Roadside landmarks. The collider kind is `building`. Aliases, the wheel ban, and the roof and wall exceptions live in `rules.json`. `house` and `garage` are not catalogue ids; the words still classify as this kind. `barn` is not a kind.

A subordinate parked car or "two cruisers" does not give the building wheels and does not change the kind. Only a wheel count, `wheels`, `wheeled`, or `on wheels` does. Cruisers in `police-checkpoint`, `police-speedtrap`, and `police-station` are the `cruiser` part (`seed/part/cruiser.js`), placed with `ref`.

## Before a mesh or a generated model

```sh
node .claude/skills/3d-assets/validate.mjs "the user's sentence"
```

Exit 1: stop. Quote `errors`. Do not edit an entity. A passing run prints `expect`. Wheels stay 0. Roof and walls follow `expect` (`required` or `optional`). A stated storey count must meet `minStoreys`. Footprint `hl` and `hd` are positive half-extents.

The speed trap alias is the optional case: a billboard, a radar, and a cruiser, not a roofed booth. Every other landmark spec keeps its roof and its walls.

## Edit

`client/shared/entity/seed/landmark/<id>.js` (`anchor: 'base'`: `at.y` is the bottom of a box). A new implementation = a new entity + a row `{ id, hl, hd }` at the END of its type in `ROSTER.landmark` (`client/shared/entity/roster.js`). Shared pieces are `part` entities (`cruiser`, `lm-pump`, `lm-cones`).

Frame: origin on the ground at the footprint centre, y up, front faces −x, the road runs along z. Parts stay inside the footprint: nothing past local x = −hd, or it stands in the lane.

## Apron

The tarmac between the road and the building is not a part of the entity. `createLandmarks` `model()` adds one slab. It has to cross the shoulder (the grass or dirt strip in the road ribbon, `SHOULDER` in `client/shared/road.js`) and tuck 0.5 m under the asphalt. It is drawn at polygon offset −3, over the road surface (−2) and under the lane marks (−4). If grass shows in that join, extend this slab. Do not add a ground box in the entity to hide it.

## Review

Shoot `right`, `front`, and `threeq`. Read the sign notes already in `police-station.js` and `roadhouse-porch.js` before moving a board: a `sign` part's `at.y` is the bottom of the board, a `disk`'s is the centre, and a board must not float above the eave or run through the roof slab. Roof meshes sit on the walls. The front face stays −x.
