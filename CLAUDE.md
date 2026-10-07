@AGENTS.md

# Notes for Claude Code

The full project map and caveats are in `AGENTS.md` (imported above). The ones that bite most often:

- **Repo is split**: `client/` = the game + site pages (everything in AGENTS.md below is relative to it), `server/` = NestJS + Prisma + PostgreSQL API (`docs/backend-architecture.md`: layers, HTTP-contract rules, race-safety, the test pyramid). Run client commands from `client/`; the server needs `npm run db:up` (Docker) for its integration suite and for `npm run server:dev`.
- **Server changes follow the test pyramid – the audit fails otherwise**: a new controller / CQRS handler / service / guard / interceptor / adapter gets its own unit spec (`server/test/unit/**/<file>.spec.ts`), a new Prisma repository its own integration spec (`server/test/integration/**/<file>.integration.spec.ts`), new behaviour an HTTP scenario (`server/test/scenarios/`), a new race a concurrency test. Copy the shape of a neighbour (`test/support/unit-context.ts` wires the application layer on in-memory ports).
- **Server invariants that are easy to break**: everything a wallet does to rides / credits / payments runs in ONE transaction under the player row lock (`findByWalletForUpdate`); time only from `ClockPort`; env only through `EnvService`; controllers only dispatch to the bus; errors are `DomainError`s (never Nest `HttpException`); a schema change needs a migration. `npm run server:integration` uses its own `freightchain_test` database – never point tests at the dev one.
- **Serve over http** (`client/serve.sh` for the game alone, or `npm run server:dev` – Nest serves `client/` and the API on :3000); `file://` can't load the ES modules (use `node tools/build-standalone.mjs` (in `client/`) → `client/dist/freightchain.html` for a double-clickable build, and rebuild it after changes).
- You can test in a **real browser even without the Chrome extension**: `node tools/e2e-chrome.mjs` (use `PORT=<free port>` if another session may be running it – they share :9333) drives headless Chrome and saves screenshots (read them with the Read tool). Use it after visual/gameplay changes.
  Say plainly what was and wasn't verified – it can't judge "feel" (shake, smoke density…), so tell the user what to eyeball.
- **Production is split over three hosts** (apex = landing + lobby, `ride.*` = game, `api.*` = API): client code must reach the API and the other pages through `client/js/hosts.js` (never a bare `/api/…` or `/play.html`) with `credentials: 'include'`; the server's `COOKIE_DOMAIN` / `CORS_ORIGINS` come from the deploy. See AGENTS.md "Split hosts".
- **Deploy lives in `deploy/`** (`npm run deploy`, `deploy:init|status|rollback|…`; docs in `deploy/README.md`). Never run it against the live server unasked; `--dry-run` is safe. Never commit `deploy/.env` / `deploy/secrets/`; keep `deploy/.env.example` dummy.
- **The sim is not deterministic or server-replayable** (floats, variable `dt`, `Math.random`), unlike what `technical_design_document.html` specifies for production – see AGENTS.md "Prototype vs. the design doc". Don't add more `Math.random()` to gameplay logic without noting it.
- **The wallet is a mock and `RIDE_MIN_SECONDS` (300) is a test value (production 1800).** The road never ends; a shift *completes* after that time AND `COMPLETE_DIST`. Client-side checks are not security.
- **User-tuned shake values** (`SHAKE_START 0.5`, `SHAKE_MOVING 0.1`, `SHAKE_RPM 0.35`) and `START_ENGINE_OFF = true` are deliberate – leave them alone unless asked.
- Numeric tuning requests are **relative to the current value** ("lower it twice" = halve it, "make it 25% more intense" = ×1.25). Say which constant you changed.
- **The road is endless and generated** by `js/net/` (patterns → segments/junctions, seeded per ride; `roads` orchestrator runs it). There is no `ROUTE_LENGTH`/finish – see AGENTS.md "Road network".
- **Routes/themes live in `js/themes/<route>/`** (own sun/sky/road/terrain/mountains/props each). Create theme materials only inside `create*()` via `basic()`/`trackMat()` (see AGENTS.md "Themes (routes)"). `node tools/e2e-chrome.mjs` saves a screenshot of every route – look at them after scenery changes.
- Keep modules **acyclic** and use the shared `view` object for canvas size. Single-sided materials must be tracked (`themes/_shared/mats.js`) or listed in `flipMats()` (`js/world/render.js`) or they break in the mirrors.
- `mesh.position` is read-only – use `.position.set()`.

## Workflow

1. Make the change in the relevant module (see the layout in AGENTS.md); put new tunables in `js/config.js`.
2. Run the verification commands in AGENTS.md ("Verifying changes"): e2e-chrome first, then eslint/esbuild. For behaviour-preserving refactors, `diff` the headless trace before/after.
   Server: `npm run check` (root) AND `npm run server:integration`; after API or flow changes also `server/scripts/e2e-browser.mjs` + `e2e-lobby.mjs` against a running server.
3. If you touched visuals, look at the e2e screenshots, then tell the user what to eyeball.
4. Keep answers short: what changed, which constant to tune, what is untested.
