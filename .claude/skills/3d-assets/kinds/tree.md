# Trees

`spruce`, `pine` (the spruce mesh), `broadleaf` / `oak`, `gum` / `gum tree`, `birch`, and a generic `tree`. Counts and forbidden parts live in `rules.json`. A generic tree uses a leafy builder, never the birch.

Not trees: cactus, bush, rock, tuft, termite, cairn, drift. The validator returns `skipped` for those. Do not run these checks on them.

## Before a mesh or a generated model

```sh
node .claude/skills/3d-assets/validate.mjs "the user's sentence"
```

Exit 1: stop. Quote `errors`. Do not edit a builder, and do not call `image_gen` or `three_d.py`. A passing run prints `expect`. One trunk. No wheels. Canopy follows `expect.canopy` (`required` or `forbidden`). Birch is bare: a leaf canopy on a birch is rejected, and a leafless birch is valid.

## Edit

`client/js/themes/_shared/props-basic.js`: `spruce`, `roundTree`, `gumTree`, `birch`. Kind stays `tree` (`KINDS` in `client/js/world/props.js`). Do not add a kind. Origin on the ground, y up. The trunk cylinder is centred at half its height so its base is y = 0.

Viewer labels: spruce, broadleaf tree, gum tree, birch.

## Review

Shoot `right` with `shot.mjs`. The trunk base meets the ground. Spruce, broadleaf, and gum show a leaf canopy that is not the trunk. Birch shows a white trunk, dark marks, bare twigs, and no leaf canopy. Read the birch twig comment: the twig's centre sits out past the bark. A twig that comes out the far side of the trunk fails the shot. Gum may lean; the base still meets the ground.
