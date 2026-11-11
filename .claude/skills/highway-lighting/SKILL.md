---
name: highway-lighting
description: >
  Day, night, and glare on the Freight Chain road. The clock, headlights,
  the twelve lamp-post pools, the cab lamp, and paid NIGHT / DAY donations.
  Trigger words: headlight, night, lamp, lightning, glare. Lightning is not
  in the game; this is how a strike would be built from the frame that
  already runs, with no new light. Use when the user runs /highway-lighting.
---

# Highway lighting

The scene is `MeshBasicMaterial`. There is no light pool, no `PointLight`, no `SpotLight`, no bloom pass, and no second shadow map. Night is one shader patch plus a few self-lit meshes. The patch rules are [shader-texture-tuning](../shader-texture-tuning/SKILL.md). Do not copy the shader into this skill or into a new file.

## Clock

`dn` in `frontend/client/js/state.js`: `t` hour 0..24, `phase` `day|dusk|night|dawn`, `k` fade 0..1, `head`, `cab`. `updateDayNight` in `frontend/client/js/world/daynight.js` runs every frame from `main.js`. A ride starts at the server's `Ride.startHour` (dawn 6.5, noon 12, dusk 18.5, night 22) via `setClock(..., assigned)`. `dn.scale` is 20. There is no night key (N is the phone map). Headlights are L. The cab lamp is C.

A paid NIGHT or DAY donation may move the clock. The catalogue is `frontend/client/js/live-effects.js`. `frontend/client/js/ui/live-feed.js` calls `setNight(on, false, true)`. `assigned` is the only way past `lockClock()`. That pair is the light's weather. There is no sandstorm, blizzard, or radiation state.

## Sun

Each route sets `theme.daylight` `{ rise, set, tw, peak, warm, stars }` in `frontend/client/js/themes/<id>/index.js`. Siberia is a short low day (`rise` 9.5, `set` 15.5, `peak` 0.22). Stuart is a harsh sun (`peak` 0.95, short `tw`). The sky shader and `scene.fog` share one horizon colour inside `updateDayNight`. Do not give the fog its own dusk.

## What lights the road

Darkness is `frontend/client/js/world/nightlight.js`. Headlights off leaves `CFG.NIGHT_AMBIENT` (0.002): the world reads black. The headlight cone is that patch (`nlBeam*`). It scales with `dn.k`, so it does not light a sunlit road. The additive halo is `updateBeam` (`CFG.HEADLIGHT_*`, `toneMapped: false`).

Traffic lamps: `lampMat()` in `frontend/client/js/world/vehicles.js`, plus `glow()` sprites in `frontend/client/js/world/glow.js`. Sprite opacity follows `dn.k`. Brake glows live in the `userData.brake` group; siren halves are `userData.flash`. Vehicles' road pools are `beam()`. Those groups belong to [vehicle-animation-3d](../vehicle-animation-3d/SKILL.md). Do not retune them here.

Lamp posts: `lamp: { color, light, every, side, h?, arm? }` in `frontend/client/js/themes/_shared/furniture.js`, set per route in `themes/*/index.js`. `KINDS.lamp` is destructible; `damage.js` hides `userData.glow` when the post is smashed. `furniture.lampAt(ci)` is pure, so `daynight.js` fills the nearest 12 (`LAMPS`, `CFG.LAMP_RADIUS`, `CFG.LAMP_GAIN`) without the chunk being built. The pool is fixed at 12. Do not allocate lights. Do not grow the array.

A bulb, glow, beam, or banner that must stay bright sets `toneMapped: false`. Leaving tone mapping on drops that material into the night multiply, so the lamp vanishes. A new `THREE.PointLight`, `SpotLight`, or any other light constructor is a bug: those lights do not light `MeshBasicMaterial`, and creating one recompiles shaders.

## Cab

`updateGlare()` writes `dn.blind` (and `dn.bx` / `dn.by`). `blindEffect()` in `frontend/client/js/cockpit/effects.js` draws it (`CFG.GLARE_*`), called from `frontend/client/js/cockpit/index.js`. The cab lamp is the glowing dome lens in `frontend/client/js/cockpit/overhead.js` plus `cabGlow()` at `CFG.CAB_DAY` of the night wash by day. `nightGrade()` darkens opaque cab pixels only (`source-atop`). Glass and mirror holes stay clear.

## Lightning is not in the game

No strike, no storm flash, no `LightningStrikeSystem`. Say that before adding one. Build a single flash from pieces that already update every frame. One strike, one flash.

- A short pulse of the sky/fog horizon `updateDayNight` already writes (the shared horizon colour).
- A short pulse of `dn.blind`, or of the cab grade, so `blindEffect` / `nightGrade` draw it. Do not add a pass.
- One pooled bolt: `mesh()` from `frontend/client/js/world/pool.js`, a jagged tube or a few boxes, `toneMapped: false`, life under a quarter second, then `meshPool.release`. A ground ring, if any, is a decal in that same pool, just above the road. Its polygon offset must be less aggressive than the lane marks (marks are −4 in `frontend/client/js/themes/_shared/road-texture.js`) so the marks stay on top.

Do not spawn `THREE.PointLight` or `SpotLight`. Do not add a shadow map. Do not add a module, a preset, or a uniform block in `nightlight.js`. Files a strike would touch: `world/daynight.js` (horizon pulse and the bolt step), `js/state.js` only if the flash rides `dn.blind`, `cockpit/effects.js` only if the grade itself must change, and `world/pool.js` only as the existing `mesh` / `release`.

## Review

Headlights off is a black world. A lamp with `toneMapped` left on is invisible at night. A new light constructor is a bug. Do not deploy.
