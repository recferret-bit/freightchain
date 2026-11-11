---
name: particle-effect-validator
description: >
  Checklist for Freight Chain debris and cab overlays: material, pool
  release, dust share, and no scene import. Read the code; watch a smash
  or a wiper pass when the change is visible. No particle CLI. Trigger
  words: debris, smash, snow, exhaust, wiper. Use when the user runs
  /particle-effect-validator.
---

# Particle effect validator

No CLI. There is no `npm run validate:particles` and no preset registry. Open the files below, check each row, and say which files you opened. A code read does not replace watching a smash or a wiper pass when the change is visible.

The system you are checking is [road-particles-3d](../road-particles-3d/SKILL.md): `burst()` in `frontend/client/js/sim/damage.js`, pools in `frontend/client/js/world/pool.js`, cab overlays in `frontend/client/js/cockpit/glass-fx.js` and `frontend/client/js/cockpit/windscreen.js`.

## Debris

Read `burst()` and `updateFX()`.

- Material comes from `userData.debris` (the entity debris slot). `MAT.dust` is only the fallback and the last four pieces. A colour hard-coded in `burst()` fails.
- Counts stay in the existing bands unless the user asked to change them: rock `6 + round(size * 4)`, tree 10, other 8, plus 4 dust. Dust stays the minority. A dust colour this change introduces is not brighter than that prop's chunks. A tree must not read as a grey explosion.
- Every box comes from `mesh()` and goes back through `meshPool.release` (end of life, the `BEHIND` cull, and `clearDebris`). A mesh left in the scene fails.
- `life` still counts down. The `BEHIND` cull (`st.s - d.s > BEHIND`) is still there.
- The bounce snaps `y` to `q/2` when it crosses that floor, then damps. It must not tunnel under `y = 0`. It may bounce again, weaker.
- Boxes stay boxes. A `THREE.Sprite` billboard, a second pool, or a preset table fails.
- `hitHoles()` is still a jolt, hull, and a steering pull. Dust added by editing that rule fails. Topple (`post`, `pole`, `lamp`, `sign`, `guard`) is not a particle.

## Cab overlay

Read the cockpit file that changed, and its imports.

- `cockpit/*` does not import `world/scene.js` or three.js. The landing dash cards replay this code (`frontend/landing/src/dash-live.js`).
- Snow still uses `flakePool` and `CFG.SNOW_FLAKES * weather.snow`. Exhaust still follows rpm and throttle and uses `smokePool`. Washer spray uses `sprayPool`, drops use `dropPool`, and both are released. Snow specks stay on the grime canvas in `windscreen.js`.
- `resetGlassFX` / `resetScreen` still return every borrowed object.

## Watch, when it is visible

From `frontend/client/`:

```sh
node tools/e2e-chrome.mjs
```

`PORT` if 9333 is taken. Read the screenshots. Say what they show (chunks on a smash, snow, a wiper pass). Smoke density and other feel is for the user to eyeball. Do not claim you felt it. Do not deploy.
