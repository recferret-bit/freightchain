# Freight Chain

Browser game after *Desert Bus*: a 2D truck cockpit over an endless, seeded 3D road; each ride costs a free ride or an escrowed ticket and is complete at its finish line (distance only – the speed governor sets the fastest possible time). Client = vanilla ES modules + three.js r160 from a CDN (no build step, no framework). Server = NestJS + Prisma + PostgreSQL. Escrow = an Anchor program on Solana devnet.

This file is the map and the hard rules only. The detail lives in **`docs/agents/<topic>.md` – read the topic file before changing that area.** Skills (with their commands): `README.md` → "Skills".

## Repo

`client/` the game (`play.html`, `js/`) + site pages (lobby, admin, viewer, `r.html`, `site/`) · `landing/` the `/` page + whitepaper (Vite) · `server/` the API (Clean Architecture, `prisma/`, `test/`) · `programs/freightchain-pools` the escrow program · `media/` promo clips + sound · `deploy/` production deploy · `design/` icons, banners · `docs/` plans + explainers · `.claude/skills/` project skills · `docker-compose.yml` local PostgreSQL (:15433) + optional Redis.

## Where the detail is (`docs/agents/`)

| topic | file |
|---|---|
| repo map, split hosts, online mode, logs | `repo.md` |
| the game: run it, file layout, conventions, rendering gotchas, object pools, sim is not replayable, known gaps | `client.md` |
| routes / themes, road network + forks, landmarks, model viewer, climate, day / night | `world.md` |
| controls, gameplay systems (holes, traffic, gearbox, battery, engine, damage…) | `gameplay.md` |
| server rules, server checks, configuration | `server.md` |
| verified play (telemetry, verdict, the server's road) | `verified-play.md` |
| statistics | `statistics.md` |
| live board, live streams, replays, donations | `live.md` |
| admin page, observing production | `admin-ops.md` |
| free levels, tutorial + assist, free rides, trips | `free-rides.md` |
| garage, promo codes | `garage-promo.md` |
| money, escrowed pools, the program toolchain | `escrow.md` |
| achievement tiers, the soulbound badge cNFTs, mint job + art | `achievements.md` |
| product analytics (PostHog) | `analytics.md` |
| promo videos + sound | `media.md` |
| landing, whitepaper, app icon | `landing.md` |
| verifying changes (all test commands) | `verifying.md` |
| deploying to production | `deploy.md` |

## Hard rules

**Maps stay current.** A key change (a root directory, a skill added / renamed / new command, a public host, a root `npm` script, a product surface or a path these files name) updates `README.md`, this file, `CLAUDE.md` and the matching `docs/agents/` file in the same change – only the sentences it made wrong. A new skill = one row in `README.md` → "Skills". Keep this file and `CLAUDE.md` small: a rule here is one line, its detail goes into `docs/agents/`.

Server (`docs/backend-architecture.md`, enforced by `server/test/architecture`):
- Layers point inward (`domain` pure, `application` = ports + CQRS handlers, `infrastructure` implements ports, `presentation` thin). Controllers only dispatch to the bus; every request part via `@ZodBody/@ZodQuery/@ZodParams`; errors are `DomainError`s, never Nest `HttpException`. Files ≤ 500 lines.
- Time only from `ClockPort`; `process.env` only through `EnvService`.
- Everything a wallet does to rides / credits / payments / tickets / pledges runs in ONE transaction under the player row lock (`findByWalletForUpdate`). Lock order: player → pool → tickets / pledges. A new critical section needs a concurrency test.
- A Prisma schema change needs a migration in the same change (forward-only).
- Test pyramid is mandatory: every new controller / handler / service / guard / interceptor / filter / adapter gets a unit spec, every PostgreSQL class an integration spec, new behaviour an HTTP scenario. `npm run server:integration` uses its own `freightchain_test` DB – never the dev one; a branch with other migrations sets `TEST_DATABASE_URL=…/freightchain_<branch>_test`.
- A new env key touches four places: `env.schema.ts`, `server/.env.example`, `deploy/.env.example`, the `app.environment` list in `deploy/docker-compose.prod.yml`. Runtime knobs (free rides, caps) are `player.GameSetting` rows changed by the signed admin API, not env. `APP_DOMAIN` / `COOKIE_DOMAIN` / `CORS_ORIGINS` are derived from `DEPLOY_DOMAIN`.
- Every path that ends a ride, and every donation, calls `StatsService` (player row lock first).
- A ride silent for `HB_TIMEOUT_MS` is ended by the stale-ride sweeper – never leave a ride `running`.
- Admin API: only the admin session (`fc_admin`), only on `admin.<COOKIE_DOMAIN>` (read `headers.host`), every change wallet-signed + audited; new routes guarded by default.
- Solana Actions (`/actions.json`, `/api/actions/*`) are public devnet blinks: CORS `*` on those paths only, `{message}` errors, one program-mode ticket, both profile stamps still required. Detail in `docs/agents/server.md`.

Game ⇄ server:
- The server rebuilds the road and judges on it (`server/src/domain/road` ports `js/net/network.js` + `js/net/obstacles.js`). Changing the generator, `PATTERNS`, a trip's `road` / `holesFrom`, `FORK`, `HOLES`, the hole roll, the damage rule in `sim/damage.js` or the off-road rule = change the port in the same commit (`road-drift.spec.ts`).
- Trip ids are FROZEN once rides carry them – retune with a new id. The route and start hour of a ride are the server's.
- Recorded sample columns are append-only; input bits are frozen.
- `RIDE_MIN_SECONDS` 300 is a test value (production 1800); it is only the NOMINAL shift length now (it sets the finish line, `completeDist`) – a shift completes the moment the line is reached, no minimum time. Client-side checks are not security. The sim is not deterministic (floats, variable `dt`, `Math.random`) – don't add `Math.random()` to gameplay logic without noting it.

Client:
- Reach the API and other hosts only through `client/js/hosts.js` with `credentials: 'include'` – never a bare `/api/…` or `/play.html` (landing included). A new subdomain = its own nginx template + `deploy/scripts/remote/setup.sh` + smoke check, and `hosts.js` must strip the prefix.
- Modules are acyclic (`sim/*` never imports `cockpit/*`; `cockpit/*` never imports the scene). Canvas size from the shared `view` object. Tunables in `js/config.js`. Use `store()` not raw `localStorage`.
- Theme materials only inside `create*()` via `basic()` / `trackMat()`; every single-sided material tracked or in `flipMats()` (mirrors). `mesh.position.set()`, never assign `position`.
- User-tuned, leave alone unless asked: `SHAKE_START 0.45`, `SHAKE_MOVING 0.09`, `SHAKE_RPM 0.315`, `START_ENGINE_OFF = true`. Numeric tuning requests are relative to the current value ("lower it twice" = halve it).
- Serve over http (`client/serve.sh` or `npm run server:dev` on :3000); `file://` can't load the modules. Driving is desktop-only; spectating streams/replays works on mobile.

Escrow: the money is in the program; the server only mirrors pools and credits tickets from program events; every wallet signs and sends its own transaction; the server holds two keys – the crank (permissionless steps + opening each day's pool from the admin's `Series`) and the payout key (`PAYOUT_SECRET`: `pay_prize` / `close_pool` only, after a pool's review window, verified winners only once every ride is decided – `pool:payout`). Program v3 (prizes gated on the payout key's on-chain attestation, per-km pledges, the road seed committed on chain) is in `docs/agents/escrow.md`. Never touch the global Solana config or `~/.config/solana/id.json`; always an explicit `--url devnet`; no program deploy or pool creation without the user. Keep `docs/escrow-open-items.md` current.

Achievements: ids are FROZEN (add a tier, never retune one); unlock rows are append-only, the NFT mint is its own outbox; badge cNFTs are minted by their own key (`ACHIEVEMENT_MINT_SECRET`) only after the delay and a re-check that skips rejected rides – detail in `docs/agents/achievements.md`.

Analytics: capture is opt-in (`POSTHOG_ENABLED=1`); never print `POSTHOG_KEY`; don't flip `$create_alias`.

Secrets: read env files by key name only, never print values; never commit `deploy/.env` / `deploy/secrets/`; example files hold dummies.

**Deploy: nothing reaches production unless the user asks for a deploy in their current message** – not after "commit", "merge", "fix it" or a finished feature. Read-only is always fine (`npm run deploy -- --dry-run`, `deploy:status`, `npm run ops`, the `prod-*` skills). Steps: `docs/agents/deploy.md`.

## Verify

- Client (`client/`): `npm run check` (lint + bundle + headless test); refactor gate `npm run trace:save` / `trace:diff`; real Chrome `node tools/e2e-chrome.mjs` (`PORT=` if busy) – look at the screenshots.
- Root: `npm run check` (client + landing + server unit + media) AND `npm run server:integration` for server changes; real-Chrome suites: `bash .claude/skills/run-tests/e2e.sh`.
- Everything else (live server e2e, replays, lobby): `docs/agents/verifying.md`.

## Style

Dense, mostly one-statement-per-line code; comments say *why* or give units, not *what*. Match the surrounding file. No dependencies beyond three.js.
