@AGENTS.md

# Notes for Claude Code

`AGENTS.md` (imported above) is the map and holds the rules; the detail it points to is in `docs/agents/<topic>.md` – read that file before changing its topic. Don't restate AGENTS.md here: this file and AGENTS.md are loaded together and share a 150k-character budget, so a new rule goes into AGENTS.md as one short bullet and its detail into `docs/agents/`. The ones that bite most often:

- **Maps stay current** (AGENTS.md): a key change updates `README.md`, `AGENTS.md`, and `CLAUDE.md` in the same change – edit only the sentences the change made wrong. A new skill = one row in `README.md` → "Skills" (description from its frontmatter, the command it tells you to run).
- **Repo is split**: `client/` = the game + site pages (AGENTS.md "Layout" is relative to it; run client commands from `client/`), `server/` = NestJS + Prisma + PostgreSQL (`docs/backend-architecture.md`), `landing/`, `programs/`, `media/`, `deploy/`. The server needs `npm run db:up` (Docker) for its integration suite and `npm run server:dev`.
- **Server changes follow the test pyramid – the audit fails otherwise** (AGENTS.md "Server rules"): copy the shape of a neighbour spec (`test/support/unit-context.ts` wires the application layer on in-memory ports). `npm run server:integration` uses its own `freightchain_test` database – never point tests at the dev one; on a branch with other migrations set `TEST_DATABASE_URL=…/freightchain_<branch>_test` (the `run-tests` skill).
- **Serve over http** (`client/serve.sh`, or `npm run server:dev` on :3000); `file://` can't load the ES modules (`node tools/build-standalone.mjs` in `client/` → `client/dist/freightchain.html`, rebuild it after changes).
- **A real browser without the Chrome extension**: `node tools/e2e-chrome.mjs` (in `client/`; `PORT=<free port>` if another session may be running it – they share :9333) drives headless Chrome and saves screenshots – read them with the Read tool after visual / gameplay changes. Say plainly what was and wasn't verified: it can't judge "feel" (shake, smoke density…), so tell the user what to eyeball.
- **Split hosts** (AGENTS.md): client code reaches the API and the other pages only through `client/js/hosts.js` with `credentials: 'include'`. A new page on a new subdomain = its own nginx template + `deploy/scripts/remote/setup.sh` + a smoke check, and `hosts.js` must strip the new prefix.
- **Nothing reaches production unless the user asks for a deploy in their CURRENT message** (AGENTS.md "Deploying to production") – not after "commit", "merge", "fix it" or a finished feature, and an earlier "deploy" does not cover later changes. Read-only is always fine (`npm run deploy -- --dry-run`, `deploy:status`, `npm run ops`, the `prod-*` skills).
- **Secrets**: read env files by key name only, never print values; never commit `deploy/.env` / `deploy/secrets/`; `*.example` files hold dummies. A new server env key touches four places (AGENTS.md "Configuration"); runtime knobs are `player.GameSetting` rows, not env.
- **Numeric tuning requests are relative to the current value** ("lower it twice" = halve it, "25% more" = ×1.25) – say which constant you changed; the work is the `gameplay-balance` skill. The user-tuned shake values and `START_ENGINE_OFF = true` stay unless asked.
- **The road, its holes and the trips are judged by the server** (AGENTS.md "Verified play", "Road network", "The free run"): change the server's port in the same commit; a frozen trip id is retuned with a new id.
- **The sim is not deterministic or server-replayable** (AGENTS.md "Prototype vs. the design doc") – don't add more `Math.random()` to gameplay logic without noting it.
- **3D objects**: the `storybook-models` skill. Theme materials only inside `create*()` via `basic()` / `trackMat()`; single-sided materials tracked or in `flipMats()`; modules acyclic; `mesh.position.set()`.

## Workflow

1. Make the change in the relevant module (see the layout in AGENTS.md); put new tunables in `js/config.js`. If it is a key change (AGENTS.md "Maps stay current"), update `README.md`, `AGENTS.md`, and `CLAUDE.md` in the same change.
2. Run the verification commands in AGENTS.md ("Verifying changes"): e2e-chrome first, then eslint/esbuild. For behaviour-preserving refactors, `diff` the headless trace before/after.
   Server: `npm run check` (root) AND `npm run server:integration`; after API or flow changes also `server/scripts/e2e-browser.mjs` + `e2e-lobby.mjs` against a running server; after live-stream / replay changes the `replay-test` skill.
3. If you touched visuals, look at the e2e screenshots, then tell the user what to eyeball.
4. Keep answers short: what changed, which constant to tune, what is untested.
5. Stop at the commit (and the merge into `main`, if asked). Do NOT deploy: say the change is ready and that `npm run deploy` would ship it (a `--dry-run` may show the plan). Only when the user asks for the deploy itself, follow AGENTS.md "Deploying to production" step by step and report the release id and the smoke result.
