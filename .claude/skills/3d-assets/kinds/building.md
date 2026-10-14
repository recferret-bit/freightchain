# Buildings

Roadside landmarks. The collider kind is `building`. Aliases, the wheel ban, and the roof and wall exceptions live in `rules.json`. `house` and `garage` are not catalogue ids; the words still classify as this kind. `barn` is not a kind.

A subordinate parked car or "two cruisers" does not give the building wheels and does not change the kind. Only a wheel count, `wheels`, `wheeled`, or `on wheels` does. Cruisers in `police-checkpoint`, `police-speedtrap`, and `police-station` are props drawn by `car()` in `parts.js`.

## Before a mesh or a generated model

```sh
node .claude/skills/3d-assets/validate.mjs "the user's sentence"
```

Exit 1: stop. Quote `errors`. Do not edit a builder, and do not call `image_gen` or `three_d.py`. A passing run prints `expect`. Wheels stay 0. Roof and walls follow `expect` (`required` or `optional`). A stated storey count must meet `minStoreys`. Footprint `hl` and `hd` are positive half-extents.

The speed trap alias is the optional case: a billboard, a radar, and a cruiser, not a roofed booth. Every other landmark spec keeps its roof and its walls.

## Edit

`client/js/themes/_shared/landmarks/`. Which file owns motel, hotel, restaurant, gas, and police is in `docs/agents/world.md` ("Landmarks"). Push `{ id, hl, hd, make }` onto that type's array. Shared `box` / `hip` / `car` stay in `parts.js`.

Frame: origin on the ground at the footprint centre, y up, front faces −x, the road runs along z.

## Review

Shoot `right`, `front`, and `threeq`. Read the sign comments already in `police.js` and `food.js` before moving a board: `c.sign` takes y as the bottom of the board, `c.disk` y is the centre, and a board must not float above the eave or run through the roof slab. Roof meshes sit on the walls. The front face stays −x.
