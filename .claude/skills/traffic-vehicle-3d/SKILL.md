---
name: traffic-vehicle-3d
description: >
  Anatomy, collision-envelope invariants, shared sub-assemblies, and visual
  hierarchy of Freight Chain traffic vehicles: sedan, police, truck, medic,
  fire, bus, and freighter, plus the player trailer. Use when creating,
  regenerating, or reviewing any road vehicle or /traffic-vehicle-3d.
---

# Traffic Vehicle 3D Architecture

Every AI traffic vehicle is a declarative entity in `frontend/client/shared/entity/seed/vehicle/<type>.js` compiled at boot by `frontend/client/js/world/vehicles.js`. Read [kinds/car.md](../model-geometry-validator/kinds/car.md) and [roadside-kitbash-3d](../roadside-kitbash-3d/SKILL.md) alongside this skill.

---

## 1. Coordinate Frame & Collision Envelope Contract

- **Origin**: Footprint centre on the road plane (`minY = 0`), **forward = `-z`**, **right = `+x`**, **up = `+y`**.
- **Authoritative Physics Box**: `VEHICLES[id]` in `frontend/client/shared/traffic.js` defines `{ w, h, len, mass, v, presets }` used by both client and server 10 Hz `ReplayEngine`. Do **not** alter `VEHICLES` dimensions for aesthetics without updating server/shared physics tests.
- **Non-Wheel Envelope Rule (`schema.js`)**: Every mesh whose `tag` is **not** `'tyre'`, `'rim'`, or `'hub'` must stay inside:
  - `|x| <= w / 2 + 0.10 m`
  - `|z| <= len / 2 + 0.10 m`
  - `0 <= y <= h + 0.10 m`
- **Wheel Protrusion Rule**: Keep the painted body hull at `0.88–0.94 × w` and place wheel outer faces (`tag: 'tyre' | 'rim' | 'hub'`) `4–9 cm` proud of the painted body so tyres read clearly in the `right` and `front` orthographic views and in the truck's side mirrors.
- **Exact `tyre` Tag Count**: `freighter` has `6` (`3` axles: steer + drive + trailer tandem visual pair; rear duals use extra untagged/rim detail if needed while keeping exact `tag: 'tyre'` count `6`); every other vehicle has `4`.

---

## 2. Fleet Anatomy (`seed/vehicle/*.js`)

| Vehicle | Base Platform | Signature Silhouette & Highway Greebles |
|---|---|---|
| `sedan` | `use: 'veh-car-body'` | Sculpted 3-box passenger car: `rbox` lower body, wheel-arch flares, sloped `wedge` hood/windshield/rear glass, A/B/C pillars, chrome beltline, side mirrors, chrome-framed grille, contrast-adaptive spoiler, 7-colour `palette` (`sedan`..`sedan#6`). |
| `police` | `use: 'veh-car-body'` | Black-and-white interceptor: white doors & roof contrast panels, front steel push-bar bumper, driver A-pillar spotlight, trunk whip antenna, `use: 'veh-siren'` (`flash.0`/`flash.1`). |
| `truck` | `use: 'veh-box-body'` | Medium box straight-truck: sculpted cab + visor + cab-over wind deflector (`wedge`) + chamfered `rbox` dry-van cargo box with vertical side ribs, rub-rails, and chrome rear barn-door lock rods. |
| `medic` | `use: 'veh-box-body'` | Type-I modular ambulance: white cab + overhead module carrying `use: 'veh-siren'`, chamfered patient box, proud red medical crosses (sides + rear), red/amber reflective beltline, twin rear door windows, roof AC hatch. |
| `fire` | `use: 'veh-box-body'` | Pumper/ladder apparatus: red crew cab + `use: 'veh-siren'`, compartmented body with silver roll-up shutter bays, recessed dark midship pump panel + gauges, side suction hoses, rooftop deck monitor, and twin-rail 8-rung aluminum ladder on brackets. |
| `bus` | Custom coach (`veh-wheels` + `veh-lights`) | Intercity motorcoach: chamfered `rbox` body, lower luggage bay doors, dark panoramic window band split by pillars, sloped `wedge` windshield, cream roof cap with amber destination marquee, coach mirrors, twin rooftop AC pods. |
| `freighter` | Custom semi (`veh-wheels` + `veh-lights`) | Class-8 convention sleeper + dry/reefer semi-trailer: sloped hood, chrome bumper & vertical-slat grille, sun visor with 3 amber clearance lights, aerodynamic sleeper roof fairing (`wedge`), twin chrome vertical exhaust stacks (`cyl16`), chrome saddle fuel tanks (`cyl16`), nose reefer unit, trailer rub-rails, Mansfield bar, barn-door lock rods. |

**Player Trailer (`frontend/client/js/world/trailer.js`)**: Not a catalogue entity (built directly for the player truck's left/right mirrors), styled to match `freighter` with nose reefer pod, corrugated livery canvas + red/white DOT conspicuity tape, `wheel20` tandem bogie + rims + cross-axles, mudflaps, Mansfield bar, and barn-door lock rods.

---

## 3. Material & Role Rules

- **Pre-warmed Material Cache (`frontend/client/js/world/vehicles.js`)**: Vehicle colours (`TYRE` `0x1c1e22`, `RIM` `0xd8dde4`, `GLASS` `0x293d52`, trim/chrome/grille greys, and emissive `lampMat` colours `HEAD`, `TAIL`, `BRAKE`, `REVERSE`, `AMBER`, `RED`, `BLUE`) are pre-warmed in `vehicles.js` so spawns never hitch or dispose shared mats. If you introduce a new static hex on a vehicle part, add it to the pre-warm list in `vehicles.js`.
- **Dark-Paint Contrast**: On black/dark hulls (`police`, dark `sedan#5`), never put a dark grille or spoiler directly on dark paint without a bright chrome surround (`0xdce2e8`) or adaptive gunmetal contrast (`ΔE >= 10`).
- **Role Discipline**:
  - `brake`, `ind.l`, `ind.r` are authored `visible: false` inside `veh-lights` / `veh-indicator` and toggled by `sim/traffic.js`.
  - `flash.0` / `flash.1` (`veh-siren`) are restricted to `police`, `medic`, and `fire` (`roster.js` + `schema.js` + anticheat `trafficSnapshot` enforce this). Never add `flash` to a civilian vehicle.

---

## 4. Mandatory Verification

```sh
node .claude/skills/model-geometry-validator/audit-entities.mjs --category vehicle --strict
node --test frontend/client/test/entity.test.mjs
node .claude/skills/model-geometry-validator/shot.mjs sedan sedan#3 police truck medic fire bus freighter
```

Inspect `right`, `front`, `top`, and `threeq` PNGs (check wheel protrusion on `right`, grille/headlamp symmetry and dark-paint contrast on `front`, roof equipment on `top`, and overall highway silhouette on `threeq`), then run `npm --prefix frontend/client run check`.
