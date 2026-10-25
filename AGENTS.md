# Freight Chain

Browser game after *Desert Bus*: a 2D truck cockpit over an endless, seeded 3D road; each ride costs a free ride or an escrowed ticket and is complete at its finish line (distance only – the speed governor sets the fastest possible time). Client = vanilla ES modules + three.js r160 from a CDN (no build step, no framework). Server = NestJS + Prisma + PostgreSQL. Escrow = an Anchor program on Solana devnet.

This file is the map and the hard rules only. The detail lives in **`docs/agents/<topic>.md` and `docs/spec/<topic>.md` – read the topic file before changing that area.** Skills (with their commands): `README.md` → "Skills".

## Repo

`frontend/` (`client/` the game (`play.html`, `js/`, `shared/`) + site pages (lobby, admin, viewer, `r.html`, `blink.html`, `site/`), `shared/` workspace package (`@freightchain/shared`) re-exporting `frontend/client/shared/`, `landing/` the `/` page + whitepaper + pitch deck (Vite), `design/` icons, banners) · `backend/` (`server/` the API + `replay:worker` + dedicated AI worker (`npm run editor:worker`; Clean Architecture, `prisma/`, `test/`), `programs/` the escrow (`freightchain_pools`) and local TEN4 (`freightchain_honk`) programs, `mcp/` the entity MCP (`npm run editor:mcp`, `npm run mcp:check`)) · `infra/` (`deploy/` production deploy + local edge `npm run infra:local` (`http://freightchain.localhost`), `docker-compose.yml` local PostgreSQL (:15433) + optional Redis & worker, `docker-compose.e2e.yml`) · `tests/` (`e2e/` code-level end-to-end (`npm run test:e2e:block1`, `npm run test:e2e:block2`, `npm run test:e2e:block3`), `audit/` multi-agent security check suite (`--repo <path>` or `--github <url>`)) · `social/` (`media/` promo clips + sound, `outreach/`, `pitchdeck-video/`, `progress-thread/`, `editor-medic/`) · `docs/` architecture + explainers (`plan/SIWS_SNS_PROJECT.md`) · `.claude/skills/` project skills.

## Where the detail is (`docs/agents/` & `docs/spec/`)

| topic | file |
|---|---|
| repo map, split hosts, online mode, logs | `docs/agents/repo.md` |
| the game: run it, file layout, conventions, rendering gotchas, object pools, sim is not replayable, known gaps | `docs/agents/client.md` |
| routes / themes, road network + forks, landmarks, model viewer, climate, day / night | `docs/agents/world.md` |
| controls, gameplay systems (holes, traffic, gearbox, battery, engine, damage…) | `docs/agents/gameplay.md` |
| server rules, server checks, configuration | `docs/agents/server.md` |
| verified play (telemetry, verdict, the server's road, 10 Hz replay verification) | `docs/spec/anticheat.md` |
| statistics | `docs/spec/platform_services.md` |
| live board, live streams, replays, donations | `docs/spec/replays_streams.md` |
| admin page, observing production | `docs/agents/admin-ops.md` |
| 3D model editor: entity storage + revisions, the bundle API, editor sign-in, signed publish | `docs/spec/platform_services.md` |
| free levels, tutorial + assist, free rides, trips | `docs/spec/rides.md` |
| referrals: invites, free-ride gifts, donation share (v5 drops on-chain pot leg) | `docs/spec/referral.md` |
| garage, promo codes | `docs/spec/ten4.md`, `docs/spec/promocodes.md` |
| money, escrowed pools, the program toolchain | `docs/spec/pool.md` |
| achievement tiers, the soulbound badge cNFTs, mint job + art | `docs/spec/web3_solana.md` |
| TEN4 (HONK verb): capped mint, checkpoints, the burn, cab visuals | `docs/spec/ten4.md`, `docs/agents/ten4-localnet.md` |
| product analytics (PostHog) | `docs/spec/platform_services.md` |
| promo videos + sound | `docs/agents/media.md` |
| landing, whitepaper, app icon | `docs/agents/landing.md` |
| verifying changes (all test commands) | `docs/agents/verifying.md` |
| deploying to production | `docs/agents/deploy.md` |
| integrated devnet soft launch readiness | `docs/plan/DEVNET_SOFT_LAUNCH.md` |
| current local feature matrix and test results | `docs/testing/LOCAL_READINESS.md` |
| as-built product, target decisions, coverage bar | `docs/spec/PROCESS.md` |

## Hard rules

**Maps stay current.** A key change (a root directory, a skill added / renamed / new command, a public host, a root `npm` script, a product surface or a path these files name) updates `README.md`, this file, `CLAUDE.md` and the matching `docs/agents/` or `docs/spec/` file in the same change – only the sentences it made wrong. A new skill = one row in `README.md` → "Skills". Keep this file and `CLAUDE.md` small: a rule here is one line, its detail goes into `docs/agents/` or `docs/spec/`.

**Specs.** As-built behavior is `docs/spec/PRODUCT.md`. A target decision is not current behavior. A behavior change updates that file in the same change. Tests lock as-built until the target's own change. The coverage bar is `docs/testing/COVERAGE_CONTRACT.md`. Detail: `docs/spec/PROCESS.md`.

Server (`docs/tech/backend-architecture.md`, enforced by `backend/server/test/architecture`):
- Layers point inward (`domain` pure, `application` = ports + CQRS handlers, `infrastructure` implements ports, `presentation` thin). Controllers only dispatch to the bus; every request part via `@ZodBody/@ZodQuery/@ZodParams`; errors are `DomainError`s, never Nest `HttpException`. Files ≤ 500 lines.
- Time only from `ClockPort`; `process.env` only through `EnvService`.
- Everything a wallet does to rides / credits / payments / tickets / pledges runs in ONE transaction under the player row lock (`findByWalletForUpdate`). Lock order: player → pool → tickets / pledges. A new critical section needs a concurrency test.
- A Prisma schema change needs a migration in the same change (forward-only).
- Test pyramid is mandatory: every new controller / handler / service / guard / interceptor / filter / adapter gets a unit spec, every PostgreSQL class an integration spec, new behaviour an HTTP scenario. `npm run server:integration` uses its own `freightchain_test` DB – never the dev one; a branch with other migrations sets `TEST_DATABASE_URL=…/freightchain_<branch>_test`.
- A new env key touches four places: `env.schema.ts`, `backend/server/.env.example`, `infra/deploy/.env.example`, the `app.environment` list in `infra/deploy/docker-compose.prod.yml`. Runtime knobs (free rides, caps) are `player.GameSetting` rows changed by the signed admin API, not env. `APP_DOMAIN` / `COOKIE_DOMAIN` / `CORS_ORIGINS` are derived from `DEPLOY_DOMAIN`.
- Every path that ends a ride, and every donation, calls `StatsService` (player row lock first).
- A ride silent for `HB_TIMEOUT_MS` is ended by the stale-ride sweeper – never leave a ride `running`.
- Admin API: only the admin session (`fc_admin`), only on `admin.<COOKIE_DOMAIN>` (read `headers.host`), every change wallet-signed + audited; new routes guarded by default.
- Solana Actions (`/actions.json`, `/api/actions/*`) are public devnet blinks: CORS `*` on those paths only, `{message}` errors, one program-mode ticket, both profile stamps still required. Detail in `docs/agents/server.md`.

Game ⇄ server:
- The server rebuilds the road and judges on it (`backend/server/src/domain/road` ports `js/net/network.js` + `js/net/obstacles.js`) and runs a 10 Hz `ReplayEngine` using `@freightchain/shared` (`frontend/client/shared/` → `prng.js`, `road.js`, `road-network.js`, `road-geometry.js`, `route-curvature.js`, `traffic-simulation.js`, `physics.js`). Changing the generator, `PATTERNS`, a trip's `road` / `holesFrom`, `FORK`, `HOLES`, the hole roll, the damage rule in `sim/damage.js`, traffic simulation in `frontend/client/shared/traffic-simulation.js`, physics in `frontend/client/shared/physics.js` or the off-road rule = change the port / shared module in the same commit (`road-drift.spec.ts`, `traffic-sim.spec.ts`, `replay-engine.spec.ts`); new rides require hashed frame-level traffic proof (server-stamped version); missing evidence or ignored collisions reject. Historical 10 Hz traffic and carried coasting discrepancies flag for review.
- Trip ids are FROZEN once rides carry them – retune with a new id. The route and start hour of a ride are the server's.
- Recorded sample columns are append-only; input bits are frozen.
- `RIDE_MIN_SECONDS` 300 is a test value (production 1800); it is only the NOMINAL shift length now (it sets the finish line, `completeDist`) – a shift completes the moment the line is reached, no minimum time. Client-side checks are not security. Don't add `Math.random()` to gameplay logic – use the seeded PRNG (`mulberry32`) in `@freightchain/shared`.

Client:
- Reach the API and other hosts only through `frontend/client/js/hosts.js` with `credentials: 'include'` – never a bare `/api/…` or `/play.html` (landing included). A new subdomain = its own nginx template + `infra/deploy/scripts/remote/setup.sh` + smoke check, and `hosts.js` must strip the prefix.
- Modules are acyclic (`sim/*` never imports `cockpit/*`; `cockpit/*` never imports the scene). Canvas size from the shared `view` object. Tunables in `js/config.js`. Use `store()` not raw `localStorage`.
- Theme materials only inside `create*()` via `basic()` / `trackMat()`; every single-sided material tracked or in `flipMats()` (mirrors). `mesh.position.set()`, never assign `position`.
- Production AI editor rate limits require Redis; MCP uses its own counter-only ACL user, protected routes fail closed on Redis failure, PostgreSQL owns the shared AI job queue, and only the dedicated editor worker executes generations (`docs/spec/platform_services.md`).
- Every 3D model is a data-only entity (`frontend/client/shared/entity/`, world.md "Entities"); gameplay (collision, footprints, landmark order, sirens, vehicle sizes) is `roster.js` / `VEHICLES`, never an entity. A refactor of the builders passes `npm run test:parity` + `trace:diff`.
- User-tuned, leave alone unless asked: `SHAKE_START 0.45`, `SHAKE_MOVING 0.09`, `SHAKE_RPM 0.315`, `START_ENGINE_OFF = true`. Numeric tuning requests are relative to the current value ("lower it twice" = halve it).
- Serve over http (`npm run infra:local` → `http://freightchain.localhost`, or `frontend/client/serve.sh` / `npm run server:dev` on :3000); `file://` can't load the modules. Driving is desktop-only; spectating streams/replays works on mobile.

Escrow: the money is in the program; the server only mirrors pools and credits tickets from program events; every wallet signs and sends its own transaction; the server holds two keys – the crank (permissionless steps + opening each day's pool from the admin's `Series`) and the payout key (`PAYOUT_SECRET`: commits a pool's winners root once every ride is decided, records pledged rides' attestations, closes a paid pool – `pool:payout`; prizes are paid with Merkle proofs after the review lock, the cold admin may veto a root). Program v4/v5/v6 (v6: Active at zero sales, explicit opens/last-start and separate series cadence; winners root, per-ride attestations, sponsor refunds, `seal_road`, the Config floors; v5: `8500/500/1000` split, `set_pool_rules`, `max_player_share_bps < 5000`, `paid_tickets_enabled`, no on-chain referral leg) is in `docs/spec/pool.md`. Never touch the global Solana config or `~/.config/solana/id.json`; always an explicit `--url devnet`; no program deploy or pool creation without the user. Keep `docs/tech/escrow-open-items.md` current.

Achievements: ids are FROZEN (add a tier, never retune one); unlock rows are append-only, the NFT mint is its own outbox; badge cNFTs are minted by their own key (`ACHIEVEMENT_MINT_SECRET`) only after the delay and a re-check that skips rejected rides – detail in `docs/spec/web3_solana.md`.

Analytics: capture is opt-in (`POSTHOG_ENABLED=1`); never print `POSTHOG_KEY`; don't flip `$create_alias`.

Secrets: read env files by key name only, never print values; never commit `infra/deploy/.env` / `infra/deploy/secrets/`; example files hold dummies.
Audit: `audit run` uses a one-shot Docker sandbox (`audit-sandbox:local`) + MCP stdio bridge (`docker-agent-orchestrator.mjs`, `agent-session.mjs`, `docker-mcp-bridge.mjs`) for `claude`, `codex`, `grok` and `agy` in parallel (one assignment per provider; shared test runs serialized) (`setup-agents` installs locked ACP adapters; `check-agents` checks availability, `check-agents --live` qualifies inert read/resume/submission; `--blocked` writes an offline blocked record); Source security review permits inspection and catalogued existing tests only (`--test-artifacts <cargo-target-dir>` supplies hash-checked `deploy/*.so` with unverified build provenance; `--restart-failed` requests new full reviews for local session failures, never provider refusals), with no arbitrary execution, PoCs or deployed probes; persistent ACP sessions bind workflow/source/model/assignment; Grok isolates its configuration and references the original login in place; failed exits and missing verdicts stay incomplete with log diagnostics; selected-file `review-with-cli` has Claude, `codex-native`, `grok-native` and `grok-docker` profiles; `grok-docker setup/login` builds a Linux broker and creates its own Docker-volume login, never imports host credentials; guide: `tests/audit/docs/live-model.md`.

AGY: use Argon (Pro) for heavy reasoning and planning (via `/boost` or subagents); use Gemini Flash 3.8 for implementation and routine code changes.

**Deploy: nothing reaches production unless the user asks for a deploy in their current message** – not after "commit", "merge", "fix it" or a finished feature. Read-only is always fine (`npm run deploy -- --dry-run`, `deploy:status`, `npm run ops`, the `prod-*` skills). Steps: `docs/agents/deploy.md`.

## Verify

- Client (`frontend/client/`): `npm run check` (lint + bundle + headless test); refactor gate `npm run trace:save` / `trace:diff`; real Chrome `node tools/e2e-chrome.mjs` (`PORT=` if busy) – look at the screenshots.
- Root: `npm run check` (client + landing + server unit + media) AND `npm run server:integration` for server changes; 30 real-Chrome suites: `bash .claude/skills/run-tests/e2e.sh` (includes guest, weekly grant, referral, viewer, sim controls, replay controls/chat and signed local-chain replay tips).
- Full local gate: `npm run test:ci:full` includes both programs' Rust tests, `test:production:local` (isolated production-mode Docker startup/recovery), the local validator journeys and the Chrome suites.
- Everything else (live server e2e, replays, lobby): `docs/agents/verifying.md`.
- Local code e2e, no browser: `npm run test:e2e:block1` (chain off), `npm run test:e2e:block2` (host validator), and `npm run test:e2e:block3` (anticheat vitest, no server). Plan: `docs/testing/E2E_PLAN.md`. This layer does not replace the Chrome suites. Bar and phases: `docs/testing/COVERAGE_CONTRACT.md`, `docs/testing/IMPLEMENTATION_PLAN.md`.
- TEN4 on a local validator (mint, swap, burn, soulbound part, paid ride): `bash .claude/skills/honk-localnet/run.sh` (`SCENARIO=chain` is the token half). The full coin suite, including a verified ride: `bash .claude/skills/honk-suite/run.sh`.


Local achievement cNFTs: `npm run test:nft:localnet` runs pinned Bubblegum/MPL-Core programs, the real mint adapter/worker and PostgreSQL; first use downloads public program bytes from devnet read-only. It is included in `test:ci:full`. See `docs/spec/web3_solana.md`.

## Style

Dense, mostly one-statement-per-line code; comments say *why* or give units, not *what*. Match the surrounding file. No dependencies beyond three.js.
