---
name: particle-effect-validator
description: >
  Audit checklist and real-Chrome verification for Freight Chain 3D smash
  debris (`sim/damage.js`) and 2D cockpit weather/wiper/exhaust pools
  (`cockpit/glass-fx.js`, `windscreen.js`). Use for /particle-effect-validator.
---

# Highway Particle & Pool Hygiene Validator

Audit [road-particles-3d](../road-particles-3d/SKILL.md) changes across `frontend/client/js/sim/damage.js`, `frontend/client/js/world/pool.js`, `frontend/client/js/cockpit/glass-fx.js`, and `frontend/client/js/cockpit/windscreen.js`.

---

## 1. 3D Smash Debris Checklist (`sim/damage.js` + `entity/seed/**`)

1. **Entity Slot Binding**: Every breakable prop seed defines `debris` (`schema.js` validates slot existence); `burst()` reads `c.obj.userData.debris` with `MAT.dust` only for the trailing 4 dust cubes and missing-slot fallback. No hard-coded prop hex inside `burst()`.
2. **Majority Material Ratio**: Prop chunks (`8`, `10`, or `6 + round(size * 4)`) outnumber `MAT.dust` (`4`), and dust is never brighter than the prop's chunks.
3. **Zero Pool Leaks**: Every `mesh()` acquired in `burst()` is released via `meshPool.release()` on `life <= 0`, `st.s - d.s > BEHIND`, and `clearDebris()`.
4. **Ground Floor Clamp**: Bounce logic snaps `y = q / 2` and damps `vy *= -0.3`, `vx/vz *= 0.6` so debris never sinks under `y = 0`.
5. **Anticheat Safety**: `hitHoles()` damage/steering math is unchanged, and slender furniture (`post`, `pole`, `lamp`, `sign`, `guard`) uses `falls` topple rather than `burst()`.

---

## 2. 2D Cockpit Overlay Checklist (`cockpit/*`)

1. **Acyclic Layering**: `cockpit/*` has zero imports from `three` or `world/*` (verified by `npm run landing:build` and `npm --prefix frontend/client run check`).
2. **Pool Release**: `resetGlassFX()` and `resetScreen()` return every active item to `flakePool`, `smokePool`, `sprayPool`, and `dropPool`.

---

## 3. Execution & Visual Check

```sh
npm --prefix frontend/client run check
PORT=9333 node frontend/client/tools/e2e-chrome.mjs
```

Read the captured Chrome screenshots and verify `0` console/page errors and intact pool accounting. Never deploy unless asked.
