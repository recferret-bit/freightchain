# Highway Greeble & Sub-Assembly Catalog

Reusable declarative parts (`frontend/client/shared/entity/seed/part/`) and inline kitbash recipes for Freight Chain's highway vehicles, roadside architecture, and corridor infrastructure.

---

## 1. Shared Seed Parts (`use` vs `ref`)

- **`use: '<part-id>', with: { … }`**: Inlines a parameterized sub-assembly in local coordinates (no `at` / `rot` on the `use` node).
- **`ref: '<entity-id>', at: [x, y, z], rot: [0, yaw, 0]`**: Places a complete sub-entity at a world/lot transform.

| Part ID | Mode | Purpose & Key Sub-Meshes |
|---|---|---|
| `veh-wheels` | `use` | Stepped tyre (`wheel20`, `TYRE`), recessed silver rim (`RIM`), protruding hub cap, plus transverse `cyl` axle (`AXLE`). Tagged `tyre` / `rim` / `hub` so wheels protrude `4–9 cm` past `VEHICLES[id].w` while body stays inside collision bounds. |
| `veh-lights` | `use` | Recessed headlamp bezels + `HEAD` lenses + `glow` + ground `beam`, amber corner markers, `TAIL` lenses + `glow`, `BRAKE` role group (tail + high-mount bar, starts hidden), `REVERSE` back-up lamps, front/rear license plates, and `veh-indicator` groups (`ind.l` / `ind.r`). |
| `veh-indicator` | `use` | Front, side-repeater, and rear amber turn-signal lenses + `glow` bound to `ind.l` or `ind.r` (`visible: false` at rest). |
| `veh-siren` | `use` | Chrome mounting feet, central speaker pod, aerodynamic `rbox` lightbar frame, and `flash.0` / `flash.1` alternating emergency lenses + `glow` (`police`, `medic`, `fire` only). |
| `veh-car-body` | `use` | Sculpted passenger car platform (`sedan`, `police`): chassis + rocker sills, wheel-arch flares, `rbox` lower body, sloped `wedge` hood/windshield/backlight, roof + A/B/C pillars, side glass, mirrors on stalks, adaptive high-contrast grille + chrome surround, bumpers, tailpipe. |
| `veh-box-body` | `use` | Medium commercial cab + chassis platform (`truck`, `medic`, `fire`): step rails, cab `rbox` + sloped `wedge` windshield + sun visor, mirrors on brackets, grille slats, mudflaps, Mansfield rear underride bar. |
| `cruiser` | `ref` | Parked highway-patrol interceptor for `police-station`, `police-checkpoint`, `police-speedtrap` (no `flash` role on landmark props). |
| `lm-pump` | `ref` | Raised fuel dispenser: plinth, lower cabinet, recessed digital meter screen, brand header cap, side nozzle holster, hanging black hose (`cyl`). |
| `lm-cones` | `ref` | Line of orange traffic cones (`cone`) on dark weighted rubber square pads (`rbox`) with white retroreflective collars. |

---

## 2. Signature Highway Greeble Recipes

When adding detail to vehicles, trailers, or roadside buildings, compose from these proven highway micro-assemblies (always protruding `>= 10 mm` from parent surfaces to avoid `COPLANAR_Z_FIGHT`):

### Heavy Commercial & Semi-Freighter Greebles
- **Twin Vertical Chrome Exhaust Stacks**: `cyl16` (`r = 0.07..0.09 m`) behind cab corners + upper heat shield collar + angled tip above cab roof.
- **Saddle Fuel Tanks**: Horizontal `cyl16` (`rot: [0, 0, 'PI / 2']`) slung under cab/frame rails between axles, strapped with two thin `TRIM` rings + cab entry steps.
- **Aerodynamic Roof Fairing**: `wedge` (`s: [cabW * 0.94, 0.75, 1.6]`) bridging cab roof up to trailer/cargo box height.
- **Nose Reefer Unit**: Chamfered `rbox` refrigeration pod mounted high on trailer `-z` nose wall (`y ~ 2.6–3.4 m`) + dark louver grille inset `12 mm` proud.
- **Barn-Door Hardware & Mansfield Bar**: Twin vertical chrome lock-rods (`cyl` or `box`, `x = ±0.32 * w`), side hinge blocks, DOT red/amber corner clearance lamps, and stepped steel rear underride guard (`rbox` bar on two vertical hangers).

### Emergency & Coach Greebles
- **Fire Apparatus**: Twin-rail roof ladder (`2` longitudinal rails + `6–8` transverse rungs on riser brackets — never a solid slab), midship dark pump-control panel with pressure-gauge dials & discharge caps, side-stowed suction hoses (`cyl`), rooftop deck monitor nozzle.
- **Ambulance (`medic`)**: Cab-over fairing module supporting `veh-siren`, four-arm red medical crosses on side/rear panels (`12 mm` proud of white box, horizontal + vertical arms staggered by `4 mm` to avoid self-Z-fight), twin rear-door glass panes, amber/red conspicuity beltline, rooftop AC vent hatch.
- **Motorcoach (`bus`)**: Lower luggage-bay doors divided by vertical seam strips, continuous tinted panoramic passenger glass band split by window pillars, sloped `wedge` front windshield, illuminated amber destination marquee above glass, twin rooftop HVAC pods (`rbox`).

### Roadside Landmark & Corridor Greebles
- **Architectural Openings**: Every entry door has a recessed/framed surround (`rbox` jambs or vestibule) + contrasting door leaf + overhead transom/canopy (`rbox` or `barrel`) — never a flat 2D sticker flush with the wall.
- **Roofline Mechanicals**: Parapet coping overhang (`+0.15..0.25 m` wider than wall) + rooftop `rbox` HVAC condenser + vent stack (`cyl`) to break flat roof silhouettes.
- **Forecourt Safety**: Yellow steel pipe bollards (`cyl`, `r = 0.08 m, h = 0.95 m`) at island ends and bay corners; raised `0.20–0.25 m` concrete islands (`rbox`) under pumps and toll/checkpoint booths.
- **Space-Frame Overhead Gantry**: Twin-chord tubular steel legs (`cyl16`) tied by horizontal ladder rungs on octagonal concrete pedestals (`oct`) with retroreflective hazard strips, spanning a twin-chord truss box with overhead luminaire hoods above the `banner` sign.
