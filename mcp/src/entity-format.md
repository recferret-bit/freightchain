# Freight Chain entity format (v1)

An entity is ONE data-only JS module: `export default { … };`. It has no functions, no imports and no variables. The file is parsed as data and never executed: only objects, arrays, strings, numbers (hex allowed), `true`, `false` and `null`.

## Top level

```
{ id, kind, v: 1, label?, note?, anchor?, params?, slots?, consts?, vars?, debris?, parts }
```

- **`id`**: `/^[a-z][a-z0-9-]{1,47}$/`. It equals the file name and never changes.
- **`kind`**: `vehicle | prop | furniture | landmark | gantry | part`. A `part` is a reusable sub-assembly that other entities pull in with `use` or `ref`.
- **`anchor`**: `'center'` (default) puts a box's centre on `at`. `'base'` puts its bottom on `at.y`, which is what landmarks use.
- **`params`**: `{ name: { default, min?, max?, type?: 'num'|'int'|'bool'|'color'|'list', enum?, from?: 'code'|'def', note? } }`. Inputs the game passes in; defaults are used otherwise. The validator builds the entity at every param's min and max, so keep the ranges honest.
- **`slots`**: `{ name: { note?, optional?, default? } }`. Materials the route or landmark supplies. Landmarks have a fixed set: `wall roof trim glass door lot apron metal dark accent accent2 neon leaf trunk cone white red blue`.
- **`consts`**: numbers or lists of numbers. **`vars`**: expressions evaluated in order, after the params.
- **`debris`**: a slot name, or a list of them: the material of the smash particles (props and furniture).

## Numbers are expressions

Any number may be a string expression: `'h * 0.45'`, `'-len / 2 + 1.4'`, `'hi ? 12 : 8'`, `'palette[pick % len(palette)]'`.

- Operators: `+ - * / %`, comparisons, `&& || !`, `?:` and `[i]` on lists.
- Functions: `min max abs sign floor ceil round sqrt sin cos tan atan2 pow clamp len rnd`. Constants: `PI`, `E`.
- Units are metres and radians.
- The model frame: y is up, the origin sits on the ground. **Vehicles** face forward along -z. **Landmarks** have their front, the door side, facing -x, with the road running along z.

## Parts (`parts: [...]`, drawn in order)

**Common keys**

- `when: 'expr'` skips the part when the expression is false.
- `ifSlot: 'name'` skips it unless that slot was supplied.
- `tag`: a short word such as `body`, `tyre`, `trunk`, `roof`, `sign` or `pole`. The validator counts tags: a vehicle has 4 parts tagged `tyre` (a freighter has 6); a tree has exactly 1 tagged `trunk`.
- `note`: free text.

**Mesh**

```
{ geo, s: [sx, sy, sz], at?: [x, y, z], rot?: [rx, ry, rz], order?, mat, anchor? }
```

`geo` is one of these unit shapes:

| `geo` | shape |
|---|---|
| `box` | 1 × 1 × 1 |
| `cyl` | 7-sided cylinder, radius 1, height 1 |
| `cone` | 6-sided cone, radius 1, height 1 |
| `rock` | dodecahedron, radius 1 |
| `pyr` | square pyramid, base 1 × 1, height 1 |
| `wheel20` | round cylinder, 20 sides |
| `wheel48` | round cylinder, 48 sides |
| `barrel` | the -z half of a cylinder |

- `s` scales the shape; `at` positions it.
- A cylinder's axis is y. Lay a wheel on its axle with `rot: [0, 0, 'PI / 2']`.
- With `anchor: 'base'`, the bottom of the shape sits at `at.y`.

**Materials (`mat`)**

- A slot name such as `'m'`, `'trunk'` or `'wall'`.
- `{ color: 0xRRGGBB }`, or `{ color: 0x…, lamp: true }` for a self-lit lamp.
- `{ global: 'steel' | 'red' | 'dust' }`.
- `{ facade: [cols, rows] }`: a window-grid wall (landmarks only).
- `{ flag: i, side: 0 | 1 }`: the route's national flag (landmarks only).
- `{ if: 'expr', then: mat, else: mat }`.
- A list of up to 6 materials, one per face of a box in the order `+x -x +y -y +z -z`.

**Other parts**

| part | what it is |
|---|---|
| `{ glow: { color, size, gain }, at, role? }` | A night glow sprite on a lamp. |
| `{ beam: { color, gain, w, l, z0, back? } }` | A pool of light on the road (vehicles). |
| `{ sign: { style: 'neon'\|'red'\|'blue'\|'cream', w, h, text? }, at }` | A lettered sign board. `at.y` is the BOTTOM of the board; the text defaults to the site's name. Landmarks only. |
| `{ disk: { style, r, text }, at }` | A round sign. `at.y` is its centre. |
| `{ banner: { w, h }, at }` | The gantry's banner. |
| `{ group: { role?, visible? }, at?, rot?, do: [parts] }` | A child group. |
| `{ for: 'i', range: [0, 'n'], let?: { name: 'expr' }, do: [...] }` | Loop over integers, `i` from 0 while below `n`. |
| `{ for: 'x', in: [-1, 1], do: [...] }` | Loop over values. With `for: ['x', 'z']`, each `in` row is `[x, z]`. |
| `{ for: 'z', from: -11.5, step: 4.6, while: 'z <= 11.5', do: [...] }` | Loop with a step. |
| `{ use: 'part-id', with?: { param: 'expr' }, slots?: { slot: mat } }` | Inlines a `part` entity. |
| `{ ref: 'entity-id', with?, slots?, at?, rot? }` | The same entity as its own child group: a prop keeps its collision data, and the group can be placed and turned. |

**Roles** are the handles the game toggles: `brake`, `ind.l`, `ind.r`, `flash.0`, `flash.1` (siren), `glow`.

**Limits:** expressions up to 256 characters; at most 512 parts after loops; at most 64 iterations per loop and 1024 in total; `use`/`ref` nested at most 4 deep; a source of at most 64 KB.

## What an entity may NOT change: gameplay, kept in code

Gameplay lives in code. The validator refuses any change to it.

- **Collision.** The collision kind and size of each placed prop and furniture piece, and the params and slots the game passes, are in the roster. Keep those params and slots.
- **Landmarks.** Their footprints (`hl`, `hd`) and their order are fixed. Keep a building inside its footprint.
- **Vehicles.**
  - A vehicle's size is the `VEHICLES` table, passed in as `len`, `w`, `h`. The body must stay inside that box, ±10 cm.
  - Every vehicle needs the roles `ind.l`, `ind.r` and `brake`.
  - ONLY police, medic and fire may have a siren (`flash.0`, `flash.1`).
- **Forbidden keys.** Never add `hp`, `dmg`, `slow`, `rf`, `rl`, `hl`, `hd`, `size`, `mass` or `collider`.

## Style

- Keep the existing `note`s, `tag`s and part order unless the request is about them.
- Change only what the request asks for.
- Copy existing arithmetic as it is.
- Add a `note` explaining any non-obvious number.
- Colours are `0xRRGGBB`.
