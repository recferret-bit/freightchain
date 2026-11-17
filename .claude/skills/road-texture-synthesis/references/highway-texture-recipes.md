# Highway Procedural Texture Recipes

Reference implementation details for Freight Chain's Canvas2D procedural surface generators. All road/world textures compile into `THREE.CanvasTexture` (`SRGBColorSpace`) with zero external image fetches.

---

## 1. Asphalt & Shoulder Micro-Wear (`themes/_shared/road-texture.js`)

Canvas size: `256 × 256` (`u` clamped across road + shoulders; `v` tiled every `9 m` along `s`).

1. **Base Bands**:
   - `x = 0..32` (`u = 0..0.125`) and `x = 224..256` (`u = 0.875..1.0`): route `shoulder` hex.
   - `x = 32..224` (`u = 0.125..0.875`): route `asphalt` hex.
2. **Wheel-Rut Tyre Polish**:
   - Four subtle longitudinal vertical `linearGradient` bands centered on the left/right wheel tracks of a 2-lane carriageway (`u ~ 0.25, 0.41, 0.59, 0.75`, alpha `<= 0.06` white lift + dark crown centre). Gives highways realistic heavy-truck wear without creating harsh horizontal seams across `v`.
3. **Longitudinal Paver Joint & Edge Drop Lips**:
   - `1–2 px` dark seam at `x = 127..129` (`u = 0.5`) where asphalt mats meet.
   - `2 px` dark lip + `1 px` highlight bevel at `x = 32` and `x = 224` where pavement drops off onto gravel shoulder.
4. **Aggregate Grain & Shoulder Clasts**:
   - Fine `1–2 px` mineral specks across asphalt (`speck` + subtle dark bitumen pits).
   - Larger `2–3 px` gravel clasts + shadow offsets on shoulders (`shoulderSpeck`).
5. **Tar-Sealed Micro-Cracks**:
   - Deterministic `rnd(seed)` walks short meandering longitudinal/transverse strokes (`lineWidth = 1`, low alpha dark bitumen) kept inside `x = 38..218` and `y = 8..248` so `v`-tiling never snaps visibly at `y = 0 / 256`.

---

## 2. Thermoplastic Markings Atlas (`marksMat`)

Canvas size: `128 × 64` (`8` columns × `16 px`, `wrapS = ClampToEdgeWrapping`, `wrapT = RepeatWrapping`, `generateMipmaps = false`, `minFilter = LinearFilter`).

- Columns:
  - `0` (`edge`): continuous white/yellow fog line (`y = 0..64`, `x = 2..14`).
  - `1` (`solid`): continuous centre line (`y = 0..64`, `x = 2..14`).
  - `2` (`dash`): broken centre line (`y = 0..22`, `3 m` painted / `6 m` gap).
  - `3` (`lane`): multi-lane divider dash (`y = 0..20`).
  - `4` (`stop`): wide intersection stop bar (`y = 0..64`, `x = 0..16`).
- Bead grain: `deterministic rnd()` dots (`alpha ~ 0.08`) inside painted regions simulate retroreflective glass beads embedded in highway thermoplastic.

---

## 3. Architectural Window Grid (`facadeMat`, `256 × 256`)

Used on `hotel-tower`, `hotel-resort`, `motel-twostory`, `police-station` via entity `facade` painter:
- **Wall Ground**: Route `wall` fill + horizontal spandrel shadow band per floor + vertical pier/mullion rhythm per column (`cols`, `rows <= 32`).
- **Window Cell**:
  1. Dark outer frame (`rgba(18,22,28,0.65)`) recessed `1 px` larger than glass.
  2. Pane fill chosen via deterministic `rnd(col, row, seed)`:
     - **Unlit** (`~70%`): cool sky-reflective slate gradient + vertical centre mullion bar.
     - **Lit** (`~30%`): two-tone warm tungsten/amber interior gradient (`#ffe39a` → `#e5a94c`) so hotel towers glow naturally at dusk and night.
  3. Projecting lower sill highlight (`1–2 px` light stone lip beneath each frame).

---

## 4. Double-Bezel Highway Signage (`signMat`, `diskFace`)

- **`signMat` (`256 × 128`)**:
  1. Outer dark casing border (`4 px`).
  2. Inset contrasting inner highway border (`3 px`, rounded/chamfered corners).
  3. Subtle top-to-bottom board sheen gradient (`+6%` top, `-6%` bottom).
  4. Bold sans-serif label auto-scaled (`ctx.measureText`) with `2 px` dark drop shadow for legibility at `150 m`.
- **`diskFace` (`256 × 256`)**:
  1. Metallic outer rim circle (`r = 122`), coloured face (`r = 114`), contrasting inner ring (`r = 102`).
  2. Centred bold text; when `flip === true` (back face of double-sided disk), applies `ctx.translate(w, 0); ctx.scale(-1, 1)` before drawing text so approaching drivers on the opposite side read un-mirrored letters.

---

## 5. Semi-Trailer Corrugation & DOT Conspicuity (`world/trailer.js`)

Canvas size: `1024 × 256` (`setLivery`):
- Base trailer colour + subtle vertical aluminum-rib corrugation stripes every `12 px` (`rgba(0,0,0,0.035)` / `rgba(255,255,255,0.035)`).
- Top header rail & bottom rub-rail metallic bands.
- Brand stripe + bold wordmark (`FREIGHT CHAIN` / livery text).
- **DOT-C2 Conspicuity Tape**: Alternating `22 px` crimson (`#d62828`) and `16 px` crisp white (`#f4f6f9`) retroreflective blocks along the lower rub-rail (`y = 236..246`) — instantly recognizable in the cab's convex side mirrors.
