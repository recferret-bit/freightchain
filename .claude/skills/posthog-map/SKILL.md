---
name: posthog-map
description: >
  Play Freight Chain's existing landing, lobby, whitepaper, and game checks,
  then write a visual map of every analytics event by surface. Use when asked
  for the event graph, /posthog-map, or which screen sends which event. Does
  not call PostHog and does not send an event.
---

# Event map

```sh
bash .claude/skills/posthog-map/run.sh
```

The script is the check. Order:

1. `npm test` in `landing/` (the whitepaper number checks and the landing page checks).
2. `bash .claude/skills/run-tests/e2e.sh browser lobby wallet` — the game ride, the lobby click-through, and the landing sign-in. There is no separate whitepaper Chrome suite; the lobby suite checks the whitepaper link, and the landing tests check the whitepaper page.
3. `node .claude/skills/posthog-map/graph.mjs`, which reads the allowlists, every `track()` call, and `.claude/skills/posthog-audit/spec.mjs`.

The map is `docs/analytics/generated/map.html`. Open it. Client nodes are the browser. Server nodes fire only after the database commit. The chains at the bottom are the spec, not the live PostHog project. Pass/fail chips for the two suites are on that page. Exit 1 when a suite failed. The map is still written.

Does not read `deploy/secrets/posthog-personal.key`. Does not set `POSTHOG_ENABLED`. Does not deploy. Comparing the map to the live board is `posthog-audit`.
