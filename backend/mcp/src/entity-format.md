# Freight Chain entity format (v1)

An entity is ONE data-only JS module: `export default { … };`. It has no functions, no imports and no variables. The file is parsed as data and never executed: only objects, arrays, strings, numbers (hex allowed), `true`, `false` and `null`.

## Top level

```
{ id, kind, v: 1, label?, note?, anchor?, params?, slots?, consts?, vars?, debris?, parts }
```

- **`id`**: `/^[a-z][a-z0-9-]{1,47}$/`. It equals the file name and never changes.
- **`kind`**: `vehicle | prop | furniture | landmark | gantry | part`. A `part` is a reusable sub-assembly that other entities pull in with `use` or `ref`.
- **`anchor`**: `'center'` (default) puts a shape's centre on `at`. `'base'` puts its bottom on `at.y`, which is what landmarks use.
- **`params`**: `{ name: { default, min?, max?, type?: 'num'|'int'|'bool'|'color'|'list', enum?, from?: 'code'|'def', note? } }`. Inputs the game passes in; defaults are used otherwise. The validator builds the entity at every param's min and max, so keep the ranges honest.
- **`slots`**: `{ name: { note?, optional?, default? } }`. Materials the route or landmark supplies. Landmarks have a fixed set: `wall roof trim glass door lot apron metal dark accent accent2 neon leaf trunk cone white red blue`.
- **`consts`**: numbers or lists of numbers. **`vars`**: expressions evaluated in order, after the params.
- **`debris`**: a slot name, or a list of them: the material of the smash particles (props and furniture).

## Numbers are expressions

Any number may be a string expression: `'h * 0.45'`, `'-len / 2 + 1.4'`, `'hi ? 12 : 8'`, `'palette[pick % len(palette)]'`.

- Operators: `+ - * / %`, comparisons, `&& || !`, `?:` and `[i]` on lists.
- Functions: `min max abs sign floor ceil round sqrt sin cos tan atan2 pow clamp len rnd`. Constants: `PI`, `E`.
- Units are metres and radians.
- The model frame: y is up, the origin sits on the ground (`minY ≈ 0`). **Vehicles** face forward along -z, right along +x. **Landmarks** have their front, the door side, facing -x, with the road running along z.

## Parts (`parts: [...]`, drawn in order)

**Common keys**

- `when: 'expr'` skips the part when the expression is false.
- `ifSlot: 'name'` skips it unless that slot was supplied.
- `tag`: a short semantic word such as `body`, `cabin`, `hood`, `glass`, `bumper`, `grille`, `mirror`, `tyre`, `rim`, `hub`, `trunk`, `canopy`, `roof`, `wall`, `door`, `window`, `sign` or `pole`. The validator counts tags: a vehicle has 4 parts tagged `tyre` (a freighter has 6); a tree has exactly 1 tagged `trunk`.
- `note`: free text.

**Mesh**

```
{ geo, s: [sx, sy, sz], at?: [x, y, z], rot?: [rx, ry, rz], order?, mat, anchor? }
```

`geo` is one of these unit shapes:

| `geo` | unit bounds | shape & typical use |
|---|---|---|
| `rbox` | `[-0.5..0.5]³` (`1 × 1 × 1`) | Chamfered/rounded box (8.5% bevels). **Preferred over `box`** for vehicle bodies, cabs, bumpers, roofs, kiosks, booths, HVAC pods & islands so bevels catch 3D form shading. |
| `wedge` | `[-0.5..0.5]³` (`1 × 1 × 1`) | Sloped right-wedge prism rising from `(y=-0.5, z=-0.5)` at front (`-z`) to `(y=+0.5, z=+0.5)` at rear (`+z`). Use for sloped windshields, aerodynamic hoods, semi roof fairings, rear backlights (`rot: [0, 'PI', 0]`), and lean-to awnings (`rot: [0, 'PI / 2', 0]`). |
| `gable` | `[-0.5..0.5]³` (`1 × 1 × 1`) | Symmetric pitched roof prism, ridge along `z` at `(x=0, y=+0.5)`, eaves at `(x=±0.5, y=-0.5)`. Use for gabled roofs, snow ridges, and porticos. |
| `oct` | `[-0.5..0.5]³` (`1 × 1 × 1`) | Regular 8-sided octagonal prism aligned to `±x` and `±z`. Use for concrete column pedestals, bollard bases, planters, and plinths. |
| `box` | `[-0.5..0.5]³` (`1 × 1 × 1`) | Sharp cube (supports up to 6 face materials). Use for crisp architectural trim, mullions, window panes, sills, stripes, license plates, and flags. |
| `cyl16` | `[-1..1, -0.5..0.5, -1..1]` | Smooth 16-sided cylinder, radius 1, height 1. Use for chrome exhaust stacks, diesel saddle tanks, columns, bollards, hoses, and round poles. |
| `cyl` | `[-1..1, -0.5..0.5, -1..1]` | Rough 7-sided cylinder, radius 1, height 1. Use for faceted organic tree trunks and branches. |
| `cone` | `[-1..1, -0.5..0.5, -1..1]` | 6-sided cone, radius 1, height 1. Use for conifer boughs, root flares, traffic cones, and termite spires. |
| `rock` | `[-1..1]³` (radius 1) | Dodecahedron, radius 1. Use for boulders, organic broadleaf/eucalyptus foliage clusters, and saguaro crowns/elbows. |
| `pyr` | `[-0.5..0.5]³` (`1 × 1 × 1`) | Square hipped pyramid, base 1 × 1, height 1. Use for hipped cabin, kiosk, and roadhouse roofs. |
| `wheel20` | `[-1..1, -0.5..0.5, -1..1]` | 20-sided cylinder, radius 1, height 1 (`rot: [0, 0, 'PI / 2']` lays it on X axle). Use for traffic vehicle tyres, rims, and hubs. |
| `wheel48` | `[-1..1, -0.5..0.5, -1..1]` | 48-sided cylinder, radius 1, height 1. Use for close-up cruiser wheels and round sign disks. |
| `barrel` | `[-1..1, -0.5..0.5, -1..0]` | Half-cylinder (`-z` arch; `rot: ['PI / 2', 0, 0]` stands it up as a vault). Use for streamliner diner roofs and arches. |

- `s` scales the shape; `at` positions it.
- With `anchor: 'base'`, `at.y` is shifted by `+sy / 2` (exact bottom for shapes whose local Y spans `-0.5..+0.5`).

**Materials (`mat`)**

- A slot name such as `'m'`, `'trunk'` or `'wall'`.
- `{ color: 0xRRGGBB }`, or `{ color: 0x…, lamp: true }` for a self-lit lamp (`toneMapped: false`).
- `{ global: 'steel' | 'red' | 'dust' }`.
- `{ facade: [cols, rows] }`: a mullioned window-grid wall with spandrels, sills, and warm lit rooms (landmarks only).
- `{ flag: i, side: 0 | 1 }`: the route's national flag (landmarks only).
- `{ if: 'expr', then: mat, else: mat }`.
- A list of up to 6 materials on a `box` or `rbox` in the order `+x -x +y -y +z -z` (up to 3 on `cyl`/`cyl16`/`wheel20`/`wheel48`/`barrel`, up to 2 on `cone`/`pyr`, 1 on `wedge`/`gable`/`oct`, single material only on `rock`).

**Other parts**

| part | what it is |
|---|---|
| `{ glow: { color, size, gain }, at, role? }` | A night glow sprite on a lamp. |
| `{ beam: { color, gain, w, l, z0, back? } }` | A pool of light on the road (vehicles & bays). |
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

## Kitbash Quality Rules (Never Build Simple Cubes!)

1. **Sculpted Primitives Over Raw Cubes:** Use `rbox`, `wedge`, `gable`, `oct`, and `cyl16` for bodies, cabs, windshields, roofs, tanks, and pedestals. Never build a car, truck, bus, or building out of 2–3 plain `box` blocks.
2. **Ground Contact & Connectivity:** Grounded models sit flush on `y = 0` (`minY ≈ 0`). Every part must overlap its supporting neighbour by `>= 1 cm` so zero parts float in mid-air.
3. **Zero Coplanar Z-Fighting:** Never place two different-material `box`/`rbox` faces on the exact same plane. Offset doors, windows, mullions, sills, grilles, and stripes `>= 5 mm` proud of their host wall/hull.
4. **60 / 30 / 10 Highway Material Hierarchy:** ~60% primary paint/wall, ~30% dark chassis/roof/plinth/trim, ~10% tinted glass, chrome accents, and self-lit `lamp: true` optics. Thin insets must contrast clearly with their host surface.

## What an entity may NOT change: gameplay, kept in code

Gameplay lives in code. The validator refuses any change to it.

- **Collision.** The collision kind and size of each placed prop and furniture piece, and the params and slots the game passes, are in the roster. Keep those params and slots.
- **Params the game passes** (`gameplayLock.lock.params` from `get_entity`; for a vehicle `len`, `w`, `h`) get their values from the game, so their `default`, `min` and `max` change nothing in the game or in the viewer's route models. To make a placed model bigger, smaller, taller or thinner, scale the parts' expressions instead.
- **Landmarks.** Their footprints (`hl`, `hd`) and their order are fixed. Keep a building inside its footprint.
- **Vehicles.**
  - A vehicle's size is the `VEHICLES` table, passed in as `len`, `w`, `h`. Every non-wheel part must stay inside `±(w/2 + 0.10)`, `±(len/2 + 0.10)`, and `<= h + 0.10`.
  - Every vehicle needs the roles `ind.l`, `ind.r` and `brake`.
  - ONLY police, medic and fire may have a siren (`flash.0`, `flash.1`).
- **Forbidden keys.** Never add `hp`, `dmg`, `slow`, `rf`, `rl`, `hl`, `hd`, `size`, `mass` or `collider`.
