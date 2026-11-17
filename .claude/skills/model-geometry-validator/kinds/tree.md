# Roadside Trees & Biome Flora (`kinds/tree.md`)

`spruce` (`pine`), `round-tree` (`broadleaf` / `oak`), `gum-tree` (`gum`), and winter `birch`. Counts and forbidden parts live in `rules.json`.

Non-tree props (`cactus`, `bush`, `rock`, `tuft`, `termite`, `cairn`, `drift`) return `skipped: true` on the NLP spec gate, but still undergo full numeric 3D geometry & multi-part checks in `audit-entities.mjs`.

## 1. Spec Gate & Numeric 3D Audit

```sh
node .claude/skills/model-geometry-validator/validate.mjs "the user's sentence"
node .claude/skills/model-geometry-validator/audit-entities.mjs <id> --strict
```

- Exactly **1** mesh is tagged `trunk` (`schema.js` enforces `tags.trunk === 1` on `kind: 'tree'`). Tag basal flares `root` and branches `limb` or `twig`.
- Zero wheels, zero doors/roofs/storeys.
- `spruce`, `round-tree`, and `gum-tree` require a foliage canopy; winter `birch` forbids a leaf canopy (`canopy: "forbidden"`).

## 2. Organic Silhouette Rules (No Lollipop Sticks!)

- **Grounded Base (`minY ≈ 0`):** Pair the `trunk` cylinder with a flared `cone` root collar (`tag: 'root'`) at `y = 0` so trees anchor naturally into the terrain.
- **Species Anatomy:**
  - `spruce`: 5 overlapping `cone` bough tiers tapering upward, rotated alternately around Y (`i * 0.52` rad) so branches interlock organically, plus optional `ifSlot: 'snow'` snow-cap cones.
  - `round-tree`: Trunk + angled woody `limb` forks supporting an asymmetric 4–5 lobe `rock` broadleaf crown.
  - `gum-tree`: Leaning smooth pale `cyl16` trunk + forked pale limbs holding 3–4 wide, flat eucalyptus `rock` foliage pads.
  - `birch`: Slender white `cyl16` trunk, wraparound dark `mark` lenticel rings (`cyl16` slightly wider than the bark, never square boxes!), and 5+ multi-directional angled bare winter twigs whose centres sit outside the bark radius so they never poke through the opposite side.
- **Scenery Props (`>= 3` meshes):** Never build a `bush` from 1 cone or a `rock`/`drift` from 1 dodecahedron. Cluster a primary mass with flanking lobes/talus stones/buttresses (`cactus` with rounded `rock` elbows & caps; `cairn` with 5 balanced stones from `y = 0`; `termite` with central spire + buttress turrets; `tuft` with basal crown + radiating blades).
