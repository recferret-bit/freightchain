# Platform Services Specification

This document is the authoritative functional and technical specification for Freight Chain's supporting platform business units (`PLT-M-*` rules and `PLT-T-*` test requirements):
1. **Statistics & Leaderboards** (`StatsService`, `PlayerStats`, `GlobalStats`, `DailyStats`)
2. **3D Entity Engine & AI Model Editor** (`storybook`, `EntityService`, `editor:worker`, `mcp/`)
3. **Product Analytics & Client Crash Telemetry** (`PostHog` EU dual-plane + `/api/client-error`)
4. **Public Web Surfaces & Split-Host Routing** (`client/js/hosts.js`, 7 subdomains, Landing, Whitepaper, Pitch Deck, `/r/:id` receipts)

Related specs: [Rides](./rides.md) · [Admin & Security](./admin_security.md) · [Backend Architecture Contract](./backend_contract.md) · [Replays & Streams](./replays_streams.md).

---

## 1. Statistics & Running Totals (`server/src/application/services/stats.service.ts`)

### 1.1 Read-Model Tables (`server/prisma/stats/stats.prisma`)
All three running-total tables live in the **`stats`** PostgreSQL schema and share the exact same 10 counter columns (`rides`, `ridesFree`, `ridesPaid`, `ridesCompleted`, `seconds`, `metres`, `crashesVehicle`, `crashesBuilding`, `donations`, `donationLamports`, plus `updatedAt`):
- **`stats.PlayerStats` (`@@map("player_stats")`, PK `wallet: String`)**:
  - Per-wallet career totals (FK to `player.Player`, `onDelete: Cascade`).
- **`stats.GlobalStats` (`@@map("global_stats")`, PK `id: Int = 1`)**:
  - Single-row (`GLOBAL_ROW_ID = 1`) platform-wide lifetime totals across all wallets.
- **`stats.DailyStats` (`@@map("daily_stats")`, PK `day: DateTime @db.Date`)**:
  - Per-UTC-day (`00:00:00Z` bucket from `utcDay(now)`) rollup across all wallets.
- *(Target per-ride ranking breakdown table `stats.RideResult` is specified in [Rides Specification](./rides.md) `RID-M-12`–`RID-M-18`.)*

### 1.2 Transactional Update, Lock Order, Caching & Reconciliation
- **Mandatory Hook on Every Ride End & Confirmed Donation**:
  - Every code path that terminates a ride (`FinishRideHandler`, `AbandonRideHandler`, `SweepStaleRidesHandler` expiration, or crash/failure) calls `StatsService.recordRideEnded(ride, now, tx)` and every confirmed spectator donation calls `StatsService.recordDonation(driverWallet, lamports, now, tx)` inside the **same database transaction** after acquiring the player row lock (`players.findByWalletForUpdate`). Enforced by architecture test `server/test/architecture/stats-hooks.spec.ts`.
  - `rideDelta(ride)` (`server/src/domain/stats/stats.rules.ts`): clamps `seconds = max(0, floor(ride.driveSeconds))`, `metres = max(0, floor(ride.lastS))`, `crashesVehicle = max(0, floor(ride.crashesVehicle))`, `crashesBuilding = max(0, floor(ride.crashesBuilding))`, and sets `rides = 1`, `ridesFree = ride.isFree() ? 1 : 0`, `ridesPaid = ride.isFree() ? 0 : 1`, `ridesCompleted = ride.status === 'completed' ? 1 : 0`.
  - Client-reported crash counters (`st.crashV`, `st.crashB`) are capped on the server (`3 + 1 per 3 s`, `<= 200`) and are statistics only (never judged for verdicts).
  - Changing what counts in statistics requires a migration backfill plus coordinated updates to `StatsPrismaRepository.recompute` and `rideDelta` in the same change.
- **Deadlock-Free Upsert Order (`PrismaStatsRepository`)**:
  - Inside the transaction, `PrismaStatsRepository` always executes the three atomic `INSERT ... ON CONFLICT DO UPDATE` statements in strict order: **`PlayerStats` → `GlobalStats` → `DailyStats`**, so concurrent rides finishing on the same UTC day serialize on the singleton/daily row without deadlocking.
- **Redis Read Cache (`CACHE_TTL_SECONDS = 15`)**:
  - Keys: `fc:stats:global`, `fc:stats:player:<wallet>`, and `fc:stats:daily` (`15s` TTL).
  - Invalidated (`cache.del`) immediately after the write transaction commits; degrades gracefully to direct PostgreSQL reads when Redis is unset or unreachable.
- **HTTP Endpoints, Lobby UI & CLI (`StatsHttpController`)**:
  - `GET /api/stats` (`OptionalSessionGuard`, `GetStatsHandler`): Returns `StatsDto` (`{ global: TotalsDto, me: TotalsDto | null }`).
  - `GET /api/stats/daily` (`GetDailyStatsHandler`): Returns `DailyStatsDto` (`{ days: DailyTotalsDto[] }`) for the newest **`90` UTC days** (`DAILY_WINDOW_DAYS = 90`, newest-first).
  - Embedded in `GET /api/live` (`totals: TotalsDto`) and `GET /api/profile` (`career: TotalsDto`, rendered as `DRIVING RECORD` by `client/site/lobby-career.js`).
  - `npm run stats:reconcile -- [--wallet <pubkey>] [--fix]` (`ReconcileStatsHandler` in `server/src/cli/reconcile-stats.ts`, skill `stats-reconcile`): Recomputes `PlayerStats`, `GlobalStats`, and `DailyStats` from terminal `ride.Ride` rows (`completed | failed | abandoned | expired`) and applied `live.RideEvent` donation rows inside a single `REPEATABLE READ` transaction, overwriting any drift when `--fix` is passed and invalidating Redis keys.
  - E2E verification: `bash .claude/skills/run-tests/e2e.sh stats`.

---

## 2. 3D Entity Engine & AI Model Editor (`client/shared/entity/`, `mcp/`, `EditorEntitiesHttpController`, `EditorJobsHttpController`, `EditorMcpHttpController`)

### 2.1 Data-Only 3D Entities & Public Bundle API (`EntitiesHttpController`, `EntityCatalogService`)
- **Data-Only Entities (`client/shared/entity/`)**: Every 3D asset in the world (`prop`, `furniture`, `landmark`, `vehicle`, `gantry`, `part`) is a declarative JS module (`export default { ... }`) built from Three.js primitives, lathes, extrusions, and vertex colors. Gameplay properties (collision boxes, footprints, landmark order, sirens, vehicle sizes/speeds) live in `client/js/roster.js` and `VEHICLES`, never inside an entity.
- **Public Bundle Endpoint (`GET /api/entities/bundle`, `EntitiesHttpController`, `EntityCatalogService`)**:
  - `GET /api/entities/bundle`: Serves published overrides (`{ rev, items }`, where `rev` is a 16-hex SHA-256 of published revision tuples) consumed by `play.html` (`client/js/entity/live.js`) and `viewer.html` (`storybook.<DEPLOY_DOMAIN>`).
  - In-memory bundle cache rechecks `publishedStamp` every `BUNDLE_RECHECK_MS = 10_000 ms` (10s), sets `Cache-Control: public, max-age=60, stale-while-revalidate=600` and weak `ETag: W/"<rev>"`, and returns `304 Not Modified` on matching `If-None-Match`.
  - Rate-limited by `THROTTLE_ENTITIES_LIMIT` (`THROTTLE_ENTITIES_RPS` at nginx `fc_entities` zone with 30s microcache).
  - Exporting published DB revisions back to git source files: `node dist/cli/index.js entities:export` (`server/src/cli/entities-export.ts`).

### 2.2 Database Schema (`server/prisma/asset/asset.prisma`) & Append-Only Revisions
All five editor tables live in the **`asset`** PostgreSQL schema:
- **`asset.Entity` (`@@map("entities")`)**: `id` (`String` PK, e.g. `'semi'`), `kind` (`prop | furniture | landmark | vehicle | gantry | part`), `headRevisionId`, `publishedRevisionId`, `version` (`Int`), `createdAt`, `updatedAt`.
- **`asset.EntityRevision` (`@@map("entity_revisions")`, unique `(entityId, seq)`)**: `id`, `entityId`, `seq`, `parentId`, `source`, `config` (`Json`), `hash` (`SHA-256`), `message`, `authorWallet`, `jobId`, `createdAt`. Strictly **append-only**:
  - `EntityWriteService` parses `config` via a literal-only parser (`parseSource`, no `eval`), validates geometry via `validateEntity` (`@freightchain/shared/entity/validate.mjs`, `422 entity_invalid`), runs `INSERT ... ON CONFLICT DO NOTHING` + `SELECT ... FOR UPDATE` on `asset.Entity`, verifies `baseRevisionId` matches `headRevisionId` (`409 stale_base`), and appends `seq = max + 1`. Restoring an earlier revision appends a new revision rather than mutating history.
- **`asset.EditorJob` (`@@map("editor_jobs")`)**, **`asset.EditorJobEvent` (`@@map("editor_job_events")`)**, and **`asset.EditorMcpCall` (`@@map("editor_mcp_calls")`)**: Shared PostgreSQL job queue (`queued → running → done | failed | cancelled`), ordered event log (`seq`, polled via `?after=seq`), and MCP tool invocation audit trail.

### 2.3 Editor Sign-In, Guards & HTTP Contract (`/api/editor/*`)
- **Authentication & Guards (`EditorGuard`, `OriginGuard`, `McpJobGuard`)**:
  - Sign-in (`EditorAuthHttpController`: `POST /api/editor/auth/challenge`, `POST /api/editor/auth/verify`, `POST /api/editor/auth/logout`, `GET /api/editor/auth/me`) uses message prefix `editor:<wallet>`, signs an `EDITOR_JWT_SECRET` token (`fc_editor` / `__Host-fc_editor` cookie), and checks `EDITOR_WALLETS` (`EDITOR_OPEN=1` is local-only and refuses to boot in production).
  - `EditorGuard` enforces `Host: storybook.<COOKIE_DOMAIN>` in production, checks `EDITOR_IP_ALLOWLIST` when set, requires `X-FC-Editor: 1` on mutations (`403` on missing CSRF header, `404` on non-CSRF guard failures to hide the surface), and `OriginGuard` validates `Origin` on storybook requests.
- **Key Endpoints (`EditorEntitiesHttpController`, `EditorJobsHttpController`, `EditorMcpHttpController`)**:
  - `GET /api/editor/entities`, `GET /api/editor/entities/:id`, `GET /api/editor/entities/:id/revisions`, `GET /api/editor/revisions/:revId`: Inspect entities and revision history.
  - `POST /api/editor/entities/:id/drafts` (`SaveDraftCommand`): Saves a new draft revision via `EntityWriteService` (`baseRevisionId` optimistic concurrency check).
  - `POST /api/editor/entities/:id/restore` (`RestoreRevisionCommand`): Restores an existing revision by appending a new head revision (`baseRevisionId` check).
  - `POST /api/editor/entities/:id/publish/challenge` (`RequestPublishChallengeCommand`) & `POST /api/editor/entities/:id/publish` (`PublishRevisionHandler`): Issues a single-use challenge under `AdminProofService` key `editor-action:<wallet>`, verifies the Ed25519 signature over the revision hash, updates `Entity.publishedRevisionId`, invalidates `EntityCatalogService`, and records `AdminAction` (`entity.publish`).
  - `POST /api/editor/jobs` (`CreateEditorJobHandler`): Enqueues an AI generation job (`202 Accepted`), requiring `EDITOR_MCP_TOKEN`, enforcing `editor_jobs_per_day` (default `40`), and rejecting concurrent jobs on the same entity (`409 job_running`).
  - `GET /api/editor/jobs`, `GET /api/editor/jobs/:id`, `GET /api/editor/jobs/:id/events?after=seq` (ordered polling endpoint), `POST /api/editor/jobs/:id/cancel`.
  - Internal MCP callbacks (`EditorMcpHttpController`, guarded by `McpJobGuard`): `GET /api/editor/mcp/entities`, `GET /api/editor/mcp/entities/:id`, `POST /api/editor/mcp/entities/:id/drafts` (`McpSaveDraftHandler`), `POST /api/editor/mcp/calls`.

### 2.4 Dedicated AI Worker (`editor:worker`), Agent Loop & Isolated MCP Server (`mcp/`)
- **Dedicated Worker (`npm run editor:worker`, `EditorJobRunnerService`, `EditorJobSweepScheduler`)**:
  - Only the dedicated `editor-worker` process claims and executes queued `asset.EditorJob` rows (up to `editor_jobs_parallel = 5` concurrent jobs, `EDITOR_JOB_TIMEOUT_MS = 10 min`, writing health snapshot `/tmp/fc-editor-worker-health-<pid>.json`). The HTTP API server never executes AI generations.
- **Agent Loop & Tool Policy (`EditorAgentService`, `editor-tool-policy.ts`)**:
  - Issues a per-job scoped JWT (`JobTokenPort`, audience `mcp-job`, scoped to target `entityId`), enforces `mayWrite` (`403 job_scope` on cross-entity writes), requires a passing `check_entity` call before `save_draft`, fences untrusted tool output in `<tool_output>` tags, and enforces `editor_max_steps` (`24`), `editor_max_output_tokens` (`100,000`), `editor_max_input_ktokens` (`500`), and a `256 KB` MCP response cap.
  - Supports LLM providers: `anthropic` (`ANTHROPIC_API_KEY`), `openai` (`OPENAI_API_KEY`), `gemini` (`GEMINI_API_KEY`), `xai` (`XAI_API_KEY`), `zai` (`ZAI_API_KEY`), and `fake` (test harness).
- **Entity MCP Server (`mcp/`, `npm run editor:mcp`, `npm run mcp:check`) & Redis ACL**:
  - Runs as an isolated container (`mcp` in `deploy/docker-compose.prod.yml`, or stdio via `claude mcp add fc-entities -- node mcp/src/stdio.js`), exposing 3D asset inspection, geometry validation, and headless screenshot tools (`redactOutbound()` strips secrets/non-asset data).
  - Rate-limiting uses a dedicated counter-only Redis ACL user `fc-mcp` (`fc:mcp-rl:*` keys, `noeviction`), and protected routes **fail closed (`503`)** if Redis is unreachable in production.
  - Verification: `bash .claude/skills/run-tests/e2e.sh editor` and `npm run mcp:check`.

---

## 3. Product Analytics & Client Crash Telemetry (`TelemetryHttpController`)

### 3.1 PostHog EU Dual-Plane Analytics (`client/js/analytics.js`, `PostHogAnalyticsAdapter`)
- **Opt-In Gate & EU Project**: Capture is disabled by default (`POSTHOG_ENABLED=0`, accepts `1|true|0|false`, overridden by `POSTHOG_DISABLED=1`) and active only when `POSTHOG_ENABLED=1` with `POSTHOG_KEY` set (`POST {POSTHOG_HOST}/batch/`, default `https://eu.i.posthog.com`, EU Cloud project `297915`, main dashboard `1006663`; architecture explainer `docs/analytics/index.html`). `POSTHOG_KEY` is never logged or exposed to the client.
- **Two Planes & Event Catalog (`server/src/domain/analytics/{client,server}-events.ts`, `application/services/analytics-events.ts`)**:
  1. **Browser Relay Plane (`client/js/analytics.js` → `POST /api/telemetry`)**: Batches up to `10` client funnel events (`TrackTelemetryHandler`), strips any spoofed server-only event names (`SERVER_EVENTS`), attaches the authenticated wallet if present, and returns `{ enabled, accepted, dropped }`.
     - Pitch deck anonymous events (`pitchdeck_viewed`, `pitchdeck_slide_viewed`, `pitchdeck_slide_time`, `pitchdeck_interaction`, `pitchdeck_link_clicked`) post with `credentials: 'omit'`.
     - Distinguishes `ride_resumed` (recovering an interrupted online ride) from `ride_unpaused` (unpausing in-cab).
  2. **Server Plane (`PostHogAnalyticsAdapter`)**: Emits authoritative backend events (`signin_completed`, `ride_ordered`, `ride_started`, `ride_progressed` at `25% / 50% / 75%`, `ride_ended`, `ride_verified`, `ticket_purchased`, `payment_reconcile_missed` keyed at `utcDayStart`, `payout_claimed`, `donation_received`, `achievement_unlocked`, `achievement_minted`, `achievement_mint_failed`) with deterministic UUID v5 deduplication (`https://freightchain.fun/analytics/` + `dedupe_key`).
- **Identity & `$create_alias` Rule**: Anonymous browser ID `anon_<uuid v4>` lives in `localStorage['freightchain.anon']`. On `signin_completed` and `session_restored` (`request_alias === true`), `PostHogAnalyticsAdapter` emits `$create_alias` with `distinct_id` = anonymous ID and `properties.alias` = wallet (note: PostHog's alias format reverses those fields — open bug, **do not flip `$create_alias`** without explicit user instruction per `AGENTS.md`).
- **Skills**: `posthog-test`, `posthog-prod`, `analytics-review`, `posthog-map`, `posthog-audit`.

### 3.2 Client Crash Telemetry & Web Vitals (`POST /api/client-error`, `ReportClientErrorHandler`)
- **Early Boot & Game Capture**: `client/js/crash-boot.js` (loaded first in `<head>`), `client/site/crash-page.js`, and `client/js/crash.js` capture uncaught browser exceptions (`window.onerror`, `unhandledrejection`, `webglcontextlost`), while `web_vital` reports Core Web Vitals (`TTFB`, `FCP`, `LCP`, `INP`, `CLS`) to the Page Speed Trends insight.
- **Filtering & Scrubbing (`crash-scrubber.ts`)**:
  - Drops unactionable browser noise (`Script error.`, `ResizeObserver loop`, `AbortError`) and stack traces from browser extensions (`chrome-extension://`, `moz-extension://`, `safari-extension://`).
  - Scrubs URL query strings, `userinfo@`, and base58 wallet tokens from messages, filenames, and stack frames.
- **Rate Limits & Caps**:
  - Capped at `3` reports per page load in the browser, `10/min` per IP (`THROTTLE_CLIENT_ERROR_LIMIT`), and `2,000` reports per UTC day server-wide (`DAILY_REPORT_CAP = 2000`), returning `{ accepted: boolean, reason?: string }`.
  - Accepted reports log a structured `JsonLogger.warn` (`event: 'client-error'`) and emit `$exception` + `client_crashed` to PostHog.

---

## 4. Public Web Surfaces & Split-Host Routing (`client/js/hosts.js`)

### 4.1 Seven Public Hosts Derived from `DEPLOY_DOMAIN`
All cross-host links and API calls in `client/` and `landing/` resolve through `client/js/hosts.js` with `credentials: 'include'` (never bare `/api/...` or bare `/play.html`):
1. **`<DEPLOY_DOMAIN>` (`SITE_BASE`, apex; `www.<DEPLOY_DOMAIN>` 301-redirects here)** — Landing page (`landing/index.html` at `/`), Lobby (`client/lobby.html`), shareable ride receipts (`/r/:id` → `client/r.html`), and the Solana Blink client (`client/blink.html`).
2. **`ride.<DEPLOY_DOMAIN>` (`GAME_BASE`)** — The 3D game (`client/play.html`, spectator `play.html?watch=<id>`, model viewer `viewer.html`; nginx 301-redirects bare `ride.<DEPLOY_DOMAIN>/` to the apex).
3. **`api.<DEPLOY_DOMAIN>` (`API_BASE`)** — NestJS HTTP API (`/api/*`), Solana Actions (`/actions.json`, `/.well-known/actions.json`, `/api/actions/*`), and Solana Pay (`/api/solana-pay/*`).
4. **`storybook.<DEPLOY_DOMAIN>` (`STORYBOOK_BASE`)** — 3D Entity Model Viewer & AI Model Editor (`client/viewer.html` mapped to `/`; nginx proxies only `/api/entities/` and `/api/editor/` and returns `404` for all other `/api/` paths).
5. **`whitepaper.<DEPLOY_DOMAIN>` (`WHITEPAPER_BASE`)** — Standalone Whitepaper (`landing/whitepaper.html` mapped to `/`; `/api/` returns `404`, posts web vitals to `API_BASE`; `<apex>/whitepaper.html` 301-redirects here).
6. **`pitchdeck.<DEPLOY_DOMAIN>` (`PITCHDECK_BASE`)** — Standalone Pitch Deck (`landing/pitchdeck.html` mapped to `/`; `noindex`, `/api/` returns `404`, posts anonymous analytics to `API_BASE`; `<apex>/pitchdeck.html` 301-redirects here).
7. **`admin.<DEPLOY_DOMAIN>` (`ADMIN_BASE`)** — Signed Admin & Ops Console (`client/admin.html`, gated by nginx basic auth + `fc_admin` cookie + `AdminGuard` host check; API calls stay same-origin on `ADMIN_BASE`).

`stripKnownSub(host)` in `client/js/hosts.js` strips `www.`, `ride.`, `api.`, `storybook.`, `whitepaper.`, `pitchdeck.`, and `admin.` when deriving the apex domain, and returns `''` (same-origin) on bare `localhost`, loopback IPs (`127.0.0.1`), or `file://`.

---

## 5. Rules (`PLT-M-*`)

| Rule ID | Rule | Enforced By | Test ID |
|---|---|---|---|
| **PLT-M-01** | Every code path that terminates a ride (`completed`, `failed`, `abandoned`, `expired`) and every confirmed donation must invoke `StatsService` inside the same transaction after `players.findByWalletForUpdate`. | `FinishRideHandler`, `AbandonRideHandler`, `SweepStaleRidesHandler`, `StatsService` | `PLT-T-01`, `PLT-T-02` |
| **PLT-M-02** | `PrismaStatsRepository` always executes the three running-total upserts in fixed table order (`stats.PlayerStats` → `stats.GlobalStats` → `stats.DailyStats`) so concurrent ride endings on the same UTC day never deadlock. | `PrismaStatsRepository`, `StatsService` | `PLT-T-03` |
| **PLT-M-03** | `rideDelta` clamps `seconds`, `metres`, `crashesVehicle`, and `crashesBuilding` to non-negative integers (`max(0, floor(x))`) and increments `ridesCompleted` only when `ride.status === 'completed'`. | `rideDelta` (`stats.rules.ts`) | `PLT-T-04` |
| **PLT-M-04** | `GET /api/stats` and `GET /api/stats/daily` (newest 90 UTC days) cache `fc:stats:global`, `fc:stats:player:<wallet>`, and `fc:stats:daily` in Redis for 15 seconds, invalidate on every write, and degrade gracefully to direct PostgreSQL reads if Redis is down. | `StatsService`, `StatsHttpController` | `PLT-T-05` |
| **PLT-M-05** | `npm run stats:reconcile` (`ReconcileStatsHandler`) recomputes `PlayerStats`, `GlobalStats`, and `DailyStats` deterministically from terminal `ride.Ride` and applied `live.RideEvent` rows in a single `REPEATABLE READ` transaction and invalidates Redis keys. | `ReconcileStatsHandler`, `reconcile-stats.ts` | `PLT-T-06` |
| **PLT-M-06** | Every 3D entity in `client/shared/entity/` is data-only geometry; gameplay collision boxes, footprints, speeds, and landmark order live in `client/js/roster.js` / `VEHICLES`. Refactoring entity builders must pass `npm run test:parity` and `npm run trace:diff`. | `client/shared/entity/`, `client/test/` | `PLT-T-07` |
| **PLT-M-07** | `asset.EntityRevision` rows are append-only; `POST /api/editor/entities/:id/publish` and `/restore` require `EditorGuard` (`EDITOR_WALLETS` + `X-FC-Editor: 1`), `publish` verifies a wallet-signed challenge over the revision hash, `EntityWriteService` validates literal-only source + `validateEntity`, appends `seq = max + 1`, updates `ETag` on `GET /api/entities/bundle`, and writes `AdminAction`. | `EditorEntitiesHttpController`, `PublishRevisionHandler`, `RestoreRevisionHandler`, `EntitiesHttpController` | `PLT-T-08` |
| **PLT-M-08** | AI model generation jobs (`asset.EditorJob`) execute only in the dedicated `editor:worker` process (`editor_jobs_parallel = 5`), never in the HTTP API process, and protected AI editor routes fail closed (`503`) in production if Redis rate-limiting (`EditorRateLimitService`) is down. | `EditorJobRunnerService`, `EditorRateLimitService` | `PLT-T-09`, `PLT-T-10` |
| **PLT-M-09** | Analytics capture (`POST /api/telemetry`, `PostHogAnalyticsAdapter`) is strictly opt-in (`POSTHOG_ENABLED=1`), strips spoofed `SERVER_EVENTS` from client batches, never logs `POSTHOG_KEY`, and preserves the existing `$create_alias` behavior until explicitly changed. | `TrackTelemetryHandler`, `PostHogAnalyticsAdapter` | `PLT-T-11` |
| **PLT-M-10** | `POST /api/client-error` (`ReportClientErrorHandler`) drops noise/extension errors, scrubs query strings/userinfo/base58 tokens, enforces `10/min` per IP and `2,000/UTC day` caps, and emits `$exception` + `client_crashed`. | `TelemetryHttpController`, `ReportClientErrorHandler`, `crash-scrubber.ts` | `PLT-T-12` |
| **PLT-M-11** | All client pages (`client/` and `landing/`) reach `/api/*` and sibling subdomains exclusively through `client/js/hosts.js` with `credentials: 'include'`, and `hosts.js` strips all 7 known prefixes (`www.`, `ride.`, `api.`, `storybook.`, `whitepaper.`, `pitchdeck.`, `admin.`). | `client/js/hosts.js`, `client/test/hosts.test.js` | `PLT-T-13` |
| **PLT-M-12** | Public ride receipts (`/r/:id` → `client/r.html` + `GET /api/watch/:id`) render ride verification status, distance, time, and replay link, returning `404` for unknown ride IDs. | `client/site/ride.js`, `LiveHttpController` | `PLT-T-14` |

---

## 6. Verification & Test Suite Plan (`PLT-T-*`)

### 6.1 Unit & Component Tests (`server/src/**/*.spec.ts`, `client/test/`, `mcp/test/`)
- **`PLT-T-01`**: `StatsService` unit spec verifying `recordRideEnded` updates `PlayerStats`, `GlobalStats`, and `DailyStats` and invalidates `fc:stats:*` cache keys.
- **`PLT-T-02`**: `StatsService.recordDonation` unit spec verifying `donations` and `donationLamports` increments and cache invalidation.
- **`PLT-T-03`**: `PrismaStatsRepository` integration spec verifying `PlayerStats → GlobalStats → DailyStats` upsert order and concurrent same-day ride endings.
- **`PLT-T-04`**: `rideDelta` (`stats.rules.spec.ts`) boundary spec across negative/fractional inputs, free vs paid rides, and `completed` vs `failed`/`abandoned`/`expired` statuses.
- **`PLT-T-05`**: `StatsService` & `StatsHttpController` spec verifying Redis cache hit/miss (`15s` TTL), `GET /api/stats/daily` 90-day window, and Redis-down fallback.
- **`PLT-T-07`**: Client entity parity & MCP validation suite (`npm run check` in `client/` + `npm run mcp:check` in `mcp/`).
- **`PLT-T-08`**: `PublishRevisionHandler`, `RestoreRevisionHandler`, `EntityWriteService`, and `EntitiesHttpController` spec: verifies append-only revisions, Ed25519 signature verification over revision hash, `parseSource` + `validateEntity` checks, and `ETag` / `304 Not Modified`.
- **`PLT-T-09`**: `EditorJobRunnerService` & `CreateEditorJobHandler` spec: verifies PostgreSQL job claim, ordered `EditorJobEvent` polling (`?after=seq`), cancellation, and `editor_jobs_parallel = 5` cap.
- **`PLT-T-10`**: `EditorRateLimitService` fail-closed spec: returns `503 editor_rate_limit_unavailable` when Redis throws or is unavailable in production mode.
- **`PLT-T-11`**: `TrackTelemetryHandler` & `PostHogAnalyticsAdapter` spec: verifies `POSTHOG_ENABLED=0` no-op, `SERVER_EVENTS` stripping on `/api/telemetry`, and `$create_alias` contract.
- **`PLT-T-12`**: `ReportClientErrorHandler` & `crash-scrubber.spec.ts`: verifies noise/extension filtering, URL/wallet scrubbing, `DAILY_REPORT_CAP = 2000`, and `$exception` + `client_crashed` emission.
- **`PLT-T-13`**: `client/test/hosts.test.js` verifying `API_BASE`, `GAME_BASE`, `SITE_BASE`, `STORYBOOK_BASE`, `WHITEPAPER_BASE`, `PITCHDECK_BASE`, and `ADMIN_BASE` across `localhost`, `freightchain.localhost`, and all 7 production subdomains.
- **`PLT-T-14`**: Public ride receipt & watch endpoint spec (`GET /api/watch/:id` and `client/site/ride.js`) verifying receipt payload and `404` handling.

### 6.2 Integration & E2E Tests (`server/test/` & `e2e/`)
- **`PLT-T-06`**: PostgreSQL integration & E2E stats reconciliation spec (`server/test/integration/` & `e2e/catalog.mjs` `B1-STATS-*`): runs rides and donations, queries `GET /api/stats` and `GET /api/stats/daily`, mutates a counter, runs `ReconcileStatsHandler`, and verifies exact restoration from raw `ride.Ride` and `live.RideEvent` rows.
