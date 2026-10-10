---
name: admin-coverage
description: Check that Freight Chain's admin page shows and uses every admin API – every route of an `api/admin` controller is guarded (AdminGuard / @AdminPublic) and called from client/site/admin*.js, every call the page makes has a route behind it, and admin.html's tabs match the views – and add whatever is missing. Use after adding or changing an admin route or a tab, when asked "is everything in the admin page", "check the admin APIs", or /admin-coverage.
---

# Admin API ⇄ admin page

Static audit, no server needed:

```sh
node .claude/skills/admin-coverage/check.mjs          # report; exit 1 on a problem
node .claude/skills/admin-coverage/check.mjs --json
```

It reads the admin controllers (`server/src/presentation/**` with `@Controller('api/admin…')`) and the page (`client/site/admin*.js`, `client/admin.html`) and reports:

1. **unguarded** – a route with neither `AdminGuard` (class or method) nor `@AdminPublic()` (AGENTS.md: new routes are guarded by default).
2. **not in the admin page** – a route no `api(...)` / `signAt(...)` call reaches (a `…/challenge` route is reached through `signAt`).
3. **dead call** – the page calls a path no route answers.
4. **tabs** – a `data-tab` link without an entry in `TABS`, or a `TABS` entry without a link.
5. info only: routes `server/scripts/e2e-admin.mjs` never names.

## Fix what it finds

- *Not in the admin page*: add a view or control. A read = a table / card in a tab; a change = a form whose button is disabled while it runs and which signs via `signAt('<x>/challenge', intent)` then posts with the signature (pattern: `site/admin-settings.js`, `site/admin-promos.js`). Server text goes in with `textContent` only. A new tab = a `data-tab` link in `admin.html` + `TABS` + the `go()` map in `admin.js`, and the AUDIT tab's target link if the action has a new target kind.
- *Dead call*: the route was renamed or removed – fix the page.
- *Unguarded*: guard the route (the architecture tests expect it).
- Then re-run the check, `cd client && npm run check`, and `server/scripts/e2e-admin.mjs` for a real-Chrome look (`bash .claude/skills/run-tests/e2e.sh admin`).

The check is textual: it understands string and template literals as the first argument of `api(` / `signAt(`. A path built any other way (a variable) is invisible to it – keep paths literal.
