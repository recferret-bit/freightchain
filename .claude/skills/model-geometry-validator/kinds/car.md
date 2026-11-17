# Cars, Trucks, Buses & Emergency Rigs (`kinds/car.md`)

Road vehicles (`sedan`, `police`, `truck`, `medic`, `fire`, `bus`, `freighter`). Subtypes, wheel/axle counts, and forbidden parts live in `rules.json`.

## 1. Spec Gate & Numeric 3D Audit

Before building or editing from a prompt that names counts or parts:

```sh
node .claude/skills/model-geometry-validator/validate.mjs "the user's sentence"
```

Exit 1 means stop and quote `errors` (e.g. a 2-wheeled car or 4-wheeled semi). After authoring or editing the entity:

```sh
node --test frontend/client/test/entity.test.mjs
node .claude/skills/model-geometry-validator/audit-entities.mjs <id> --strict
```

Both must pass with **0 errors and 0 warnings**.

## 2. Sculpted Highway Coachwork Rules (No Cube Cars!)

- **Frame & Bounds:** Origin at footprint centre on the ground (`minY = 0`), forward `-z`, right `+x`. Every non-wheel part (`tag` not in `tyre | rim | hub`) MUST stay within `VEHICLES[id]` (`±(w/2 + 0.10)`, `±(len/2 + 0.10)`, `<= h + 0.10`).
- **Ban Raw Cube Hulls:** Build bodies with `rbox` (chamfered hull/cabin/cargo/bumpers), `wedge` (sloped hood, sloped windshield, sloped backlight, aerodynamic roof fairing), and `cyl16` (chrome exhaust stacks, diesel saddle tanks, axle shafts, ladder rungs). Keep sharp `box` for crisp window pillars, trim strips, license plates, and mudflaps.
- **4-Layer Vehicle Anatomy (`>= 24` meshes total):**
  1. **Running Gear & Chassis:** `veh-wheels` (`wheel20` `tyre` + silver `rim` + `hub` + cross `axle` shaft; exact 4 `tyre` tags, 6 on `freighter`) + dark `rbox` chassis pan/frame rails. Keep hull width ~`w * 0.94..0.96` and wheel `xo = w / 2 + 0.06` so tyres and fender brows read proud on flanks.
  2. **Coachwork & Greenhouse:** Sculpted lower body (`rbox`), sloped hood (`wedge`), recessed `GLASS` cabin (`rbox` + `wedge` windshield) divided by dark pillars, painted roof cap (`rbox`).
  3. **Highway Greebles:** Front & rear `rbox` bumpers, chrome-framed radiator `grille` (`ΔE >= 10` even on black paint!), license plates, wing mirrors on stalks (kept inside `w / 2 + 0.08`), plus class-specific details (interceptor push-bar & aerial; box-truck roof deflector & ribs; ambulance alcove, crosses & rear glass; fire pumper panel, suction hoses & twin-rail runged ladder; coach AC pods & bay pillars; Class-8 sleeper, twin stacks, saddle tanks, reefer & barn-door lock rods).
  4. **Self-Lit Optics & Roles:** `veh-lights` (`ind.l`, `ind.r`, `brake`, bezel-framed `HEAD`/`TAIL`/`REV` with `lamp: true` + glows + road beams). Only `police`, `medic`, and `fire` may include `veh-siren` (`flash.0` / `flash.1` mounted on roof pylons + bridge).

## 3. 4-View Visual QA (`shot.mjs`)

Run `node .claude/skills/model-geometry-validator/shot.mjs <id>` and inspect all 4 PNGs:
- `right`: Tyres sit on `y = 0` outside the painted hull; sloped hood/windshield/fairing silhouette reads immediately; zero floating mirrors or sirens.
- `front`: Symmetric headlamps, framed grille, bumper, license plate, and mirrors.
- `top`: Clean footprint proportion, roof details (AC pods, ladder rungs, fairing, lightbar), zero clipping.
- `threeq`: Overall 60/30/10 colour balance and chamfered form-shade highlights. Shoot every listed `sedan#<paint>` variant when changing `veh-car-body`.
