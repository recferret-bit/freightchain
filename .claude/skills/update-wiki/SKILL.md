---
name: update-wiki
description: >
  Rebuild the Freight Chain docs wiki catalog (docs/wiki-catalog.js) from the
  docs tree. Use when the user says update wiki, rebuild wiki, rebuild the
  docs, or rebuild with no other target, or runs /update-wiki. A rebuild of
  the server, client, landing, or program is not this skill.
---

# Update wiki

From the repo root:

```sh
node docs/build-wiki.mjs
```

That command is the whole job. It walks `docs/`, checks `docs/wiki-render.js`, and writes `docs/wiki-catalog.js`. Do not edit the catalog by hand. Do not change the markdown, HTML, or CSS unless the user also asked for an edit.

If the user named a different rebuild (server, client, landing, program, media), do that work instead.

The script's self-test must pass. If it fails, fix the cause in `docs/wiki-render.js` or `docs/build-wiki.mjs` and run the command again.

Reply with the script's summary line (sections, pages, size). Do not commit. Do not deploy. Open `docs/wiki.html` only when the user asks to see the page.
