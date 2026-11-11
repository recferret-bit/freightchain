---
name: road-particles-3d
description: >
  Smash debris, cab snow, exhaust, and the washer. Where each Freight Chain
  effect lives: a pooled 3D burst, or a cockpit canvas that must not import
  the scene. Trigger words: debris, smash, snow, exhaust, wiper. Use when
  the user runs /road-particles-3d.
---

# Road particles

This game has no `ParticlePresetRegistry` and no `npm run validate:particles`. Smash debris is the 3D particle system. Cab overlays are canvas or camera-space points, not instanced meshes. After a change, run [particle-effect-validator](../particle-effect-validator/SKILL.md).

## Where it lives

| effect | where | what it is |
|---|---|---|
| smash chunks | `frontend/client/js/sim/damage.js` `burst()` | pooled boxes, `mesh()` / `meshPool` in `frontend/client/js/world/pool.js` |
| topple | same file, `falls` | `post`, `pole`, `lamp`, `sign`, `guard` only. Not a particle |
| road hole | `hitHoles()` in that file | a jolt, hull loss, a steering pull. Not dust. Do not fork the damage rule to add a puff |
| snow points, bug splats, hood smoke, exhaust | `frontend/client/js/cockpit/glass-fx.js` | camera-space or canvas. Snow count is `CFG.SNOW_FLAKES * weather.snow`. Exhaust follows rpm and throttle |
| washer spray, drops, wiper, snow specks on the grime | `frontend/client/js/cockpit/windscreen.js` | `sprayPool`, `dropPool`, the grime canvas |

`cockpit/*` does not import the scene or three.js. The landing dash cards (`frontend/landing/src/dash-live.js`) replay that cockpit, so a scene import breaks the cards as well as the layering rule.

## The burst

`burst()` reads `c.obj.userData.debris`: the entity's `debris` slot, resolved in `frontend/client/js/world/entity-build.js`. An array picks one material at random. Missing debris falls back to `MAT.dust`. Do not hard-code a colour in `burst()`. A new look is the slot on the entity (`frontend/client/shared/entity/`, checked by `schema.js`), not a hex in the sim.

Counts, unless the user asked to change them: rock `6 + round(size * 4)` chunks, larger (`0.25 + size * 0.2`); tree 10 chunks at `0.35`; anything else 8 at `0.25`. The loop is `n + 4`. The last four (`i >= n`) are `MAT.dust`. Rocks throw more and larger chunks. Trees throw more chunks. Dust is the minority, so a tree does not explode into grey. Dust is not brighter than the chunks. Do not replace the boxes with `THREE.Sprite`. There is no 60/30/10 instance budget and no CIE ΔE check.

Motion: gravity 16 (`vy -= 16 * dt`). On `y < q/2`, snap back to `q/2`, `vy *= -0.3`, horizontal `*= 0.6` (damped every time it hits that floor, so it does not sink under `y = 0`). Shrink in the last 0.5 s. `meshPool.release` when `life` ends or the truck is `BEHIND` the chunk (`st.s - d.s > BEHIND`). `clearDebris()` releases the pool. Chunks are returned, never left in the scene.

## Adding a look

Set the entity `debris` slot. Keep `mesh()` / `meshPool.release`. Do not add a second pool, a preset table, or a billboard path. A cab effect (snow, spray, smoke, exhaust, bugs) stays in `cockpit/` and uses the pool it already has (`flakePool`, `smokePool`, `sprayPool`, `dropPool`).
