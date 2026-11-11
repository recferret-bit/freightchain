---
name: ai-mesh-pipeline
description: >
  Build a Freight Chain car, tree, building, or prop as entity source
  the interpreter compiles. A generated image or a .glb is a reference
  for the parts, not an asset the game loads. Trigger words: generate
  a model, glb, concept art. A failed spec gate means do not draw.
  Use when the user runs /ai-mesh-pipeline.
---

# AI mesh pipeline

The game does not load `.glb` files. The deliverable is an entity source. `frontend/client/shared/entity/plan.js` compiles it. `frontend/client/js/world/entity-build.js` builds the mesh. A generated image or a GLB is a reference, not an asset you drop in `public/`.

## Spec gate

Before any generated mesh or image of a car, tree, or building:

```sh
node .claude/skills/model-geometry-validator/validate.mjs "the user's sentence"
```

Exit 1: stop. Quote `errors`. Do not draw. Exit 0: build the `expect` counts. `"skipped": true`: it is some other prop. Follow the prop row in that skill.

## Concept image

Make one only when a picture helps. It is a reference for the entity parts, not a texture to project.

- Isolated object. Orthographic, or a clear 3/4.
- Flat light. No cast shadow baked into the paint. Plain background.
- Chunky forms. A thin aerial vanishes.
- A different colour for cab, body, tyre, lamp, and glass.

Reject a one-colour blob before building the entity.

## No imported mesh

Do not add an Image-to-3D provider, a sanitize-glb script, or a three.js `GLTFLoader` step. If the user already has a GLB, measure it by eye and rebuild the silhouette as entity geos (`box`, `cyl`, `cone`, `wheel20` / `wheel48`, …) inside the `VEHICLES` box or the landmark footprint. Triangle decimation and WebP PBR clamps are not this pipeline.

## Order

Register nothing by hand in the catalogue.

1. Spec gate, above.
2. The entity: `roadside-kitbash-3d`, and `traffic-vehicle-3d` or `road-scene-3d`.
3. `node --test frontend/client/test/entity.test.mjs`
4. `node .claude/skills/model-geometry-validator/shot.mjs <id>`, then read the PNGs (`storybook-viewport`).
5. Only then a texture: `road-texture-synthesis` / `shader-texture-tuning`.

## Cards

Hero cards (landing dash cards, chain cards) are 2D. A card illustration is cockpit or page art, not a GLB. Say which surface you are making.
