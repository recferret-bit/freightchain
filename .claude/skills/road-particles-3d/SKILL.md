---
name: road-particles-3d
description: >
  Pooled 3D roadside smash debris (`sim/damage.js` `burst()`) and 2D cockpit
  weather/exhaust/washer particles (`cockpit/glass-fx.js`, `windscreen.js`).
  Zero-allocation object pools and strict scene/cockpit separation. Use when
  running /road-particles-3d.
---

# Highway Debris & Cockpit Particle Systems

Freight Chain runs all particle effects through fixed, zero-GC object pools:
1. **3D World Smash Debris (`frontend/client/js/sim/damage.js` `burst()`)**: Pooled `THREE.Mesh` chunks from `frontend/client/js/world/pool.js` (`mesh()` / `meshPool.release()`).
2. **2D Cockpit Overlays (`frontend/client/js/cockpit/glass-fx.js` & `windscreen.js`)**: Pure 2D Canvas pools (`flakePool`, `smokePool`, `sprayPool`, `dropPool`) with **zero** `three` or `world/*` imports.

After modifying any particle or debris path, verify against [particle-effect-validator](../particle-effect-validator/SKILL.md).

---

## 1. 3D Smash Burst Contract (`sim/damage.js`)

- **Entity-Driven Debris Colour**: `burst()` reads `c.obj.userData.debris` (populated from each seed entity's `debris` slot in `entity-build.js`, falling back to `MAT.dust` only if unset). Never hard-code prop hex colours in `burst()` — assign or update `debris` on the entity in `frontend/client/shared/entity/seed/prop/*.js`.
- **Chunk & Dust Counts**:
  - `rock`: `6 + round(size * 4)` chunks (`0.25 + size * 0.2 m`) + `4` `MAT.dust` pieces.
  - `tree`: `10` chunks (`0.35 m`) + `4` `MAT.dust` pieces.
  - Other breakables: `8` chunks (`0.25 m`) + `4` `MAT.dust` pieces.
  - Dust stays the minority (`4` pieces) and never outshines the prop's primary chunk colour.
- **Ballistics & Pool Hygiene**:
  - Gravity `vy -= 16 * dt`; ground bounce clamps `y` to `q / 2` (`vy *= -0.3`, horizontal `* 0.6`) so chunks never tunnel below `y = 0`.
  - Chunks shrink over their final `0.5 s` and **must** return via `meshPool.release` on `life <= 0`, `st.s - d.s > BEHIND`, and `clearDebris()`.
  - Keep `hitHoles()` (`sim/damage.js`) deterministic and untouched for visuals; `post`, `pole`, `lamp`, `sign`, and `guard` topple (`falls`) rather than bursting.

---

## 2. Cockpit Weather & Exhaust Pools (`cockpit/*`)

- `glass-fx.js`: Snowflakes (`CFG.SNOW_FLAKES * weather.snow`, `flakePool`), diesel exhaust & hood damage smoke (`smokePool`, driven by RPM/throttle/hull), and bug splats.
- `windscreen.js`: Washer jets (`sprayPool`), running droplets (`dropPool`), grime accumulation canvas, and wiper sweep clearing.
- `cockpit/*` is imported directly by `frontend/landing/src/dash-live.js` — never import `three` or `world/*` into `cockpit/*`.
