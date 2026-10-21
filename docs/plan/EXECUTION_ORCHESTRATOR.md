# Parallel Execution Orchestrator (Up to 4 Concurrent Agents)

> **How to use this file:** Point your agent (or `/goal` / `/teamwork-preview`) at **`docs/plan/EXECUTION_ORCHESTRATOR.md`**.
> This file is a self-contained multi-agent runbook that coordinates [`docs/plan/E2E_HEADLESS_PLAN.md`](./E2E_HEADLESS_PLAN.md) (**Plan 1: 64 E2E tasks**) and [`docs/plan/SPEC_COMPLIANCE_PLAN.md`](./SPEC_COMPLIANCE_PLAN.md) (**Plan 2: 53 Spec tasks**) across **up to 4 parallel agents (`Lane 1` – `Lane 4`)** in **6 sequential Waves** with zero file-ownership collisions or database races.

---

## 1. Multi-Agent Coordination Protocol (Mandatory for All Agents)

When invoked with `"work on docs/plan/EXECUTION_ORCHESTRATOR.md"`, the lead agent (or each parallel worker) MUST follow these rules:

### 1.1 Wave & Lane Rules
1. **Never cross a Wave Barrier early:** All 4 lanes in **Wave $N$** must reach `[x] Done` (and pass the **Wave $N$ Barrier Gate Command**) before any agent starts **Wave $N+1$**.
2. **Up to 4 Parallel Subagents (`Lane 1` .. `Lane 4`):**
   - If running as a single orchestrator with subagent tools (`invoke_subagent`), spawn up to 4 `self` subagents concurrently — one per active Lane in the current Wave (`Workspace: 'share'` or `'inherit'` per lane isolation rules below).
   - If running as an external parallel session, claim the first `[ ] Todo` Lane in the current active Wave by marking it `[~] In Progress (Agent-N)` before editing code.
3. **Strict File Ownership per Lane:** Each Lane within a Wave has an explicit **Owned Paths** list and **Forbidden Paths** list. An agent in `Lane K` must NEVER edit files owned by another Lane in the same Wave.
4. **Prisma Migration Serialization Rule:** At most **ONE lane** in a Wave may generate a Prisma migration (`backend/server/prisma/schema.prisma`), OR a short **Wave Migration Pre-Step** lands the schema changes before the 4 lanes branch out. Each wave below explicitly isolates schema ownership to a single lane or pre-step.
5. **Isolated Test Databases & Ports per Agent Slot:**
   - `Lane 1`: `TEST_DATABASE_URL="postgresql://freight:freight_dev_password@127.0.0.1:15433/freightchain_agent1_test"` · `PORT=3101`
   - `Lane 2`: `TEST_DATABASE_URL="postgresql://freight:freight_dev_password@127.0.0.1:15433/freightchain_agent2_test"` · `PORT=3102`
   - `Lane 3`: `TEST_DATABASE_URL="postgresql://freight:freight_dev_password@127.0.0.1:15433/freightchain_agent3_test"` · `PORT=3103`
   - `Lane 4`: `TEST_DATABASE_URL="postgresql://freight:freight_dev_password@127.0.0.1:15433/freightchain_agent4_test"` · `PORT=3104`
   - The compose role is `freight` / `freight_dev_password` (`infra/docker-compose.yml`). A name ending in `_test` is created and migrated by the integration harness. Never use `freightchain` or `freightchain_test` from a lane.
   - On-chain validator suites (`test:localnet`, `honk-suite`, `test:e2e:block2`) bind port `:8899` and MUST run only in the designated Chain Lane (`Lane 4` in Wave 1/4) — never in two lanes simultaneously.
6. **Three-Place Status Sync:** Whenever a task finishes and its DoD passes, update its status to `[x] Done` in:
   1. This file (`docs/plan/EXECUTION_ORCHESTRATOR.md`)
   2. The domain issue file (`docs/plan/e2e-headless/issues/*.md` or `docs/plan/spec-compliance/issues/*.md`)
   3. The plan status board ([`docs/plan/e2e-headless/STATUS.md`](./e2e-headless/STATUS.md) or [`docs/plan/spec-compliance/STATUS.md`](./spec-compliance/STATUS.md))
   4. If product behavior changed (`SPC-*`), update [`docs/spec/PRODUCT.md`](../spec/PRODUCT.md) in the same commit.

---

## 2. Master Wave Progress Board

| Wave | Name | Active Lanes | Tasks | Status | Barrier Gate Command |
|---|---|---|---|---|---|
| **Wave 1** | **Red Gates, Contract Foundation & As-Built Lock (Part 1)** | 4 Lanes (`L1`–`L4`) | 18 | `[x] Done` | `npm run check && npm run server:integration` |
| **Wave 2** | **As-Built HTTP Parity (151 Routes) & Headless Chrome Suite** | 4 Lanes (`L1`–`L4`) | 20 | `[~] In Progress` | `npm run check && npm run server:integration && bash .claude/skills/run-tests/e2e.sh` |
| **Wave 3** | **Admin Security (`F01..F18`), Dynamic Finish & Replays Backend** | 4 Lanes (`L1`–`L4`) | 23 | `[x] Done` | `npm run check && npm run server:integration && npm run test:e2e:block1` |
| **Wave 4** | **Replay Controls `C1..C36`, EN/RU i18n, Pool v6 & Convoy/Airdrop** | 4 Lanes (`L1`–`L4`) | 25 | `[x] Done` | `npm run check && npm run server:integration && npm run test:e2e:block1 && npm run test:e2e:block2` |
| **Wave 5** | **Anti-Cheat v2.1 (30 Hz Re-Sim, Salts, `F1..F10`) & Minigames** | 4 Lanes (`L1`–`L4`) | 21 | `[x] Done` | `npm run check && npm run server:integration && npm run test:e2e:block1` |
| **Wave 6** | **Cheat Catalog `#1..#58`, `TrustScore`, CI Gates & Final Census** | 4 Lanes (`L1`–`L4`) | 10 | `[ ] Todo` | `npm run test:ci:full && node .claude/skills/test-census/census.mjs --self-test` |

---

## 3. Detailed Wave & Parallel Lane Schedule

```mermaid
flowchart TD
  W1["Wave 1 (4 Lanes): Red Gates + @ZodResponse/.strict() + Landing/Geo + Chain IDL/Block 1-2"] --> W2["Wave 2 (4 Lanes): 17 Zero & 47 Single HTTP Routes (Mem+PG) + 12 As-Built Chrome Scripts"]
  W2 --> W3["Wave 3 (4 Lanes): Admin Security (SPC-02) + Dynamic Finish (SPC-03) + Replays Backend (SPC-04.1..6) + mock-rpc"]
  W3 --> W4["Wave 4 (4 Lanes): Admin Matrix (E2E-09) + Replay Player/i18n (SPC-04.7..9) + Pool v6/Appeals (SPC-05) + Convoy/Airdrop (SPC-08)"]
  W4 --> W5["Wave 5 (4 Lanes): Telemetry v2.1 & 30 Hz Re-Sim (SPC-06) + Minigames (SPC-07) + Convoy/Replay Chrome E2E"]
  W5 --> W6["Wave 6 (4 Lanes): Block 3 Driver Bots & Cheat #1..#58 (E2E-07) + Minigame E2E (E2E-08) + TrustScore/Terms + Final Census"]
```

---

### WAVE 1 — Red Gates, Contract Foundation & As-Built Chain Lock
**Goal:** Turn all existing red gates green, establish `@ZodResponse`, `.strict()`, `expectDbDelta`, and `routes.manifest.ts`, fix `paintHero` & fail-closed geo, and complete the As-Built localnet/Block 1–2 chain tests.
**Prisma Schema Changes in Wave 1:** None (`0` migrations).

#### Wave 1 — `Lane 1` (Client Gates, Census & Landing/Geo Fixes)
- **Lane Status:** `[x] Done (Lane-1)`
- **Owned Paths:** `frontend/client/tools/test-parity.mjs`, `frontend/client/shared/entity/`, `frontend/client/tools/test-tickets-stub.mjs`, `.claude/skills/test-census/census.mjs`, `frontend/landing/`, `backend/server/src/presentation/common/geo.service.ts`
- **Tasks (in order):**
  - [x] [`E2E-01.1`](./e2e-headless/issues/E2E-01-gates-and-census.md) — Fix `veh|medic` 21-mesh parity drift in `npm run test:parity`
  - [x] [`E2E-01.2`](./e2e-headless/issues/E2E-01-gates-and-census.md) — Fix `npm run test:tickets-stub` (`18/20` → `20/20`)
  - [x] [`E2E-01.3`](./e2e-headless/issues/E2E-01-gates-and-census.md) — Map all 57 unmapped routes & 147 test files in `census.mjs` (`--self-test` green)
  - [x] [`E2E-01.4`](./e2e-headless/issues/E2E-01-gates-and-census.md) — Wire `census.mjs --self-test`, `test:parity`, and `test:tickets-stub` into root `npm run check`
  - [x] [`SPC-01.6`](./spec-compliance/issues/SPC-01-backend-contract-and-validation.md) — Fix `frontend/landing` `paintHero` null-pool crash when `GET /api/pools/current` returns `null`
  - [x] [`SPC-01.5`](./spec-compliance/issues/SPC-01-backend-contract-and-validation.md) — Enforce fail-closed geo eligibility when `CF-IPCountry` is absent in production (`PRIZE_DEV_DEFAULT_COUNTRY`)
- **Lane 1 Verify Command:** `npm run check`

#### Wave 1 — `Lane 2` (Backend `@ZodResponse`, `.strict()` & OpenAPI Generator)
- **Lane Status:** `[x] Done (Lane-2)`
- **Owned Paths:** `backend/server/src/presentation/**/*.controller.ts`, `backend/server/src/presentation/**/*.dto.ts`, `backend/server/src/presentation/common/zod-response*`, `backend/server/scripts/generate-openapi.ts`, `backend/server/openapi.json`
- **Tasks (in order):**
  - [x] [`SPC-01.3`](./spec-compliance/issues/SPC-01-backend-contract-and-validation.md) — Enforce `.strict()` on all Admin, Editor, Auth, Ticket, Pool, Promo, and Money request Zod schemas
  - [x] [`SPC-01.1`](./spec-compliance/issues/SPC-01-backend-contract-and-validation.md) — Implement `@ZodResponse(schema)` decorator, `ZodResponseInterceptor` (`RESPONSE_SCHEMA_CHECK`), and attach schemas to all 151+ routes
  - [x] [`SPC-01.2`](./spec-compliance/issues/SPC-01-backend-contract-and-validation.md) — Build OpenAPI 3.1 generator (`openapi:generate` → `openapi.json`) from controller + Zod metadata
- **Lane 2 Verify Command:** `npm --prefix backend/server run test:unit && npm --prefix backend/server run openapi:generate`

#### Wave 1 — `Lane 3` (Foreign `404` Ownership, `routes.manifest.ts` & `expectDbDelta`)
- **Lane Status:** `[x] Done (Lane-3)`
- **Owned Paths:** `backend/server/src/application/rides/`, `backend/server/src/application/tickets/`, `backend/server/src/application/honk/`, `backend/server/src/application/live/`, `backend/server/test/contract/`, `backend/server/test/helpers/expect-db-delta.ts`
- **Tasks (in order):**
  - [x] [`SPC-01.4`](./spec-compliance/issues/SPC-01-backend-contract-and-validation.md) — Standardize foreign resource `:id` ownership checks to return `404` across all player-scoped endpoints
  - [x] [`E2E-02.1`](./e2e-headless/issues/E2E-02-http-contract-and-zod-schemas.md) — Build `routes.manifest.ts` + meta-test asserting 100% NestJS controller route registration
  - [x] [`E2E-02.3`](./e2e-headless/issues/E2E-02-http-contract-and-zod-schemas.md) — Implement `expectDbDelta(prisma, tables, fn)` helper
- **Lane 3 Verify Command:** `TEST_DATABASE_URL="postgresql://freight:freight_dev_password@127.0.0.1:15433/freightchain_agent3_test" npm run server:integration`

#### Wave 1 — `Lane 4` (On-Chain Local Validator, `freightchain_honk` IDL Pin & Block 1/2 Completion)
- **Lane Status:** `[x] Done (Lane-4)`
- **Owned Paths:** `backend/server/test/architecture/anchor-idl-drift.spec.ts`, `backend/server/scripts/test-localnet.mjs`, `.claude/skills/honk-suite/`, `tests/e2e/block1-offchain/`, `tests/e2e/block2-chain/`
- **Tasks (in order):**
  - [x] [`E2E-05.1`](./e2e-headless/issues/E2E-05-local-validator-and-chain-e2e.md) — Pin `freightchain_honk` IDL drift check in `anchor-idl-drift.spec.ts` (all 7 instructions)
  - [x] [`E2E-05.2`](./e2e-headless/issues/E2E-05-local-validator-and-chain-e2e.md) — Extend `npm run test:localnet` with full SOL pool lifecycle + `pledge_ride` / `settle_pledge` / `refund_pledge`
  - [x] [`E2E-05.3`](./e2e-headless/issues/E2E-05-local-validator-and-chain-e2e.md) — Extend `honk-suite` with negative checks (`tier='free'` training & weekly grant ride mint `0` TEN4)
  - [x] [`E2E-05.4`](./e2e-headless/issues/E2E-05-local-validator-and-chain-e2e.md) — Complete pending Block 1 & Block 2 tests (`B1-REF-04`, `B2-PROMO-02`, `B2-ADMIN-04`, `B2-API-06`, `B2-API-07`, `B2-HONK-02`)
  - [x] [`E2E-05.5`](./e2e-headless/issues/E2E-05-local-validator-and-chain-e2e.md) — Implement `SOL-T-01..16` (SIWS auth, `.sol` SNS resolution, Blink CORS/actions, soulbound cNFT outbox)
  - [x] [`E2E-05.6`](./e2e-headless/issues/E2E-05-local-validator-and-chain-e2e.md) — Implement `PRM-T-01..14` (Promo code normalization, caps, expiry, batch generation, race conditions)
- **Lane 4 Verify Command:** `npm run test:e2e:block1 && npm run test:e2e:block2 && npm run test:localnet`

> **WAVE 1 BARRIER GATE:** All 18 tasks above must be `[x] Done` and `npm run check && npm run server:integration && npm run test:e2e:block1` must exit `0` before starting Wave 2.

---

### WAVE 2 — Full 151-Route HTTP Matrix & 12 As-Built Headless Chrome Scripts
**Goal:** Lock 100% of the As-Built product across all 151 HTTP routes (both In-Memory and PostgreSQL) and all 12 Headless Chrome scripts.
**Prisma Schema Changes in Wave 2:** None (`0` migrations).

#### Wave 2 — `Lane 1` (Contract Matrix A & B, Fuzzing & OpenAPI Contract Specs)
- **Lane Status:** `[x] Done (Lane-1)`
- **Owned Paths:** `backend/server/test/contract/zod-response.spec.ts`, `backend/server/test/contract/negative-matrix.spec.ts`, `backend/server/test/contract/dto-fuzz.spec.ts`, `backend/server/test/contract/openapi-contract.spec.ts`
- **Tasks (in order):**
  - [x] [`E2E-02.2`](./e2e-headless/issues/E2E-02-http-contract-and-zod-schemas.md) — Enforce `@ZodResponse` schema validation (`RESPONSE_SCHEMA_CHECK=strict`) across all 151+ routes
  - [x] [`E2E-02.4`](./e2e-headless/issues/E2E-02-http-contract-and-zod-schemas.md) — Build table-driven `negative-matrix.spec.ts` — Matrix A (unauth `401`, forbidden `403`, bad DTO `400`, `.strict()` `400`)
  - [x] [`E2E-02.5`](./e2e-headless/issues/E2E-02-http-contract-and-zod-schemas.md) — Build table-driven `negative-matrix.spec.ts` — Matrix B (foreign resource `:id` returns `404` on all player-owned endpoints)
  - [x] [`E2E-02.6`](./e2e-headless/issues/E2E-02-http-contract-and-zod-schemas.md) — Add `fast-check` DTO property fuzzing & OpenAPI `schemathesis` contract test
- **Lane 1 Verify Command:** `TEST_DATABASE_URL="postgresql://freight:freight_dev_password@127.0.0.1:15433/freightchain_agent1_test" npx --prefix backend/server jest test/contract`

#### Wave 2 — `Lane 2` (Close All 17 Zero-Scenario & 47 Single-Scenario HTTP Routes in Memory + PG)
- **Lane Status:** `[x] Done (Lane-2)`
- **Owned Paths:** `backend/server/test/flows.spec.ts`, `backend/server/test/flows.integration.spec.ts`, `tests/e2e/block1-offchain/platform-services.e2e.spec.ts`
- **Tasks (in order):**
  - [x] [`E2E-03.1`](./e2e-headless/issues/E2E-03-http-zero-and-single-scenario-routes.md) — Add positive + ≥2 negative scenarios for 5 zero-scenario Admin routes
  - [x] [`E2E-03.2`](./e2e-headless/issues/E2E-03-http-zero-and-single-scenario-routes.md) — Add positive + ≥2 negative scenarios for 8 zero-scenario Editor & Entity routes
  - [x] [`E2E-03.3`](./e2e-headless/issues/E2E-03-http-zero-and-single-scenario-routes.md) — Add positive + ≥2 negative scenarios for 4 zero-scenario Player, Auth, Live & Dev routes
  - [x] [`E2E-03.4`](./e2e-headless/issues/E2E-03-http-zero-and-single-scenario-routes.md) — Add negative scenarios (`≥2` per route) for single-scenario Auth, Profile, Legal & Referral routes
  - [x] [`E2E-03.5`](./e2e-headless/issues/E2E-03-http-zero-and-single-scenario-routes.md) — Add negative scenarios (`≥2` per route) for single-scenario Rides, Telemetry, Tickets & Promo routes
  - [x] [`E2E-03.6`](./e2e-headless/issues/E2E-03-http-zero-and-single-scenario-routes.md) — Add negative scenarios (`≥2` per route) for single-scenario Pools, Replays, Watch, TEN4 & Blinks routes
  - [x] [`E2E-03.7`](./e2e-headless/issues/E2E-03-http-zero-and-single-scenario-routes.md) — Mirror 100% of `flows.spec.ts` scenarios into `flows.integration.spec.ts` (real PostgreSQL parity gate)
  - [x] [`E2E-08.6`](./e2e-headless/issues/E2E-08-minigames-and-rides-ranking-e2e.md) — Implement Platform Services E2E (`PLT-T-01..14`)
- **Lane 2 Verify Command:** `TEST_DATABASE_URL="postgresql://freight:freight_dev_password@127.0.0.1:15433/freightchain_agent2_test" npm run server:integration`

#### Wave 2 — `Lane 3` (Headless Chrome Batch A — Scripts 1 to 6 on `PORT=3103`)
- **Lane Status:** `[x] Done (Lane-3)`
- **Owned Paths:** `backend/server/scripts/e2e-guest-training.mjs`, `backend/server/scripts/e2e-weekly-ticket.mjs`, `backend/server/scripts/e2e-tickets.mjs`, `backend/server/scripts/e2e-solana-pay.mjs`, `backend/server/scripts/e2e-live.mjs`, `backend/server/scripts/e2e-referral.mjs`
- **Tasks (in order):**
  - [x] [`E2E-04.1`](./e2e-headless/issues/E2E-04-headless-chrome-as-built.md) — Headless Chrome: Guest ride completion (`tier='free'`) + `409 guest_free_only` & `409 training_tier_free_only`
  - [x] [`E2E-04.2`](./e2e-headless/issues/E2E-04-headless-chrome-as-built.md) — Headless Chrome: Weekly 1h free-ride ticket auto-grant (`source='weekly'`) + promo credit precedence
  - [x] [`E2E-04.3`](./e2e-headless/issues/E2E-04-headless-chrome-as-built.md) — Headless Chrome: `e2e-tickets.mjs` localnet reconcile + foreign order `403/404`
  - [x] [`E2E-04.4`](./e2e-headless/issues/E2E-04-headless-chrome-as-built.md) — Headless Chrome: `e2e-solana-pay.mjs` browser-side wallet sign & confirm after QR order
  - [x] [`E2E-04.5`](./e2e-headless/issues/E2E-04-headless-chrome-as-built.md) — Headless Chrome: `e2e-live.mjs` negative checks (self-donate `400`, self-pledge `400`, rate-limit `429`)
  - [x] [`E2E-04.6`](./e2e-headless/issues/E2E-04-headless-chrome-as-built.md) — Headless Chrome: `e2e-referral.mjs` full invitee MEDIUM ride → `qualifyOnRideVerified` → `referrerRideGift=2`
- **Lane 3 Verify Command:** `PORT=3103 node backend/server/scripts/e2e-guest-training.mjs && PORT=3103 node backend/server/scripts/e2e-weekly-ticket.mjs`

#### Wave 2 — `Lane 4` (Headless Chrome Batch B — Scripts 7 to 12 on `PORT=3104`)
- **Lane Status:** `[x] Done (Lane-4)`
- **Owned Paths:** `backend/server/scripts/e2e-honk-garage.mjs`, `backend/server/scripts/e2e-whitepaper.mjs`, `backend/server/scripts/e2e-landing.mjs`, `backend/server/scripts/e2e-editor.mjs`, `backend/server/scripts/e2e-achievements.mjs`, `backend/server/scripts/e2e-admin.mjs`, `.claude/skills/run-tests/e2e.sh`
- **Tasks (in order):**
  - [x] [`E2E-04.7`](./e2e-headless/issues/E2E-04-headless-chrome-as-built.md) — Headless Chrome: `e2e-honk-garage.mjs` Prize board tab & TEN4 catalog UI
  - [x] [`E2E-04.8`](./e2e-headless/issues/E2E-04-headless-chrome-as-built.md) — Headless Chrome: `e2e-whitepaper.mjs` dedicated harness (`whitepaper.html` zero errors, anchors, diagrams)
  - [x] [`E2E-04.9`](./e2e-headless/issues/E2E-04-headless-chrome-as-built.md) — Headless Chrome: `e2e-landing.mjs` empty-pool state (`GET /api/pools/current → null`, `paintHero` regression)
  - [x] [`E2E-04.10`](./e2e-headless/issues/E2E-04-headless-chrome-as-built.md) — Headless Chrome: `e2e-editor.mjs` `POST /api/editor/auth/logout` → cookie cleared → `401` on next write
  - [x] [`E2E-04.11`](./e2e-headless/issues/E2E-04-headless-chrome-as-built.md) — Headless Chrome: `e2e-achievements.mjs` multi-ride progress + rejected ride skip
  - [x] [`E2E-04.12`](./e2e-headless/issues/E2E-04-headless-chrome-as-built.md) — Headless Chrome: `e2e-admin.mjs` wrong host `403`, missing `adminSig` `401`, re-verify & sample inspection
- **Lane 4 Verify Command:** `PORT=3104 node backend/server/scripts/e2e-whitepaper.mjs && PORT=3104 node backend/server/scripts/e2e-landing.mjs`

> **WAVE 2 BARRIER GATE:** All 20 tasks above must be `[x] Done` and `node .claude/skills/test-census/census.mjs --self-test` must report `0` zero-scenario routes and `0` single-scenario routes before starting Wave 3.

---

### WAVE 3 — Admin Security (`F01..F18`), Dynamic 65 km/h Finish, Replays Backend & `mock-rpc`
**Goal:** Land the core backend spec compliance changes for Admin Security (`SPC-02`), Rides & `stats.RideResult` (`SPC-03`), Replays & Tip-Only Donations (`SPC-04.1..6`), and the `mock-rpc` (`E2E-06.1`) harness.
**Prisma Schema Serialization:** `Lane 1` executes a 5-minute **Wave 3 Schema Pre-Step** first, adding the new models/columns for Wave 3 (`admin.AdminAction` trigger/cols, `admin.AlertOutbox`, `admin.AdminProposal`, `stats.RideResult`, `ride.Ride.finishRulesVersion`) in a single consolidated migration (`wave3_admin_and_ride_result`) before Lanes 1–3 run in parallel.

#### Wave 3 — `Lane 1` (Admin & Privileged Security `SPC-02.1..9`)
- **Lane Status:** `[x] Done (Lane-1)`
- **Owned Paths:** `backend/server/prisma/` (Wave 3 Pre-Step migration), `backend/server/src/presentation/common/guards/privileged-surface.guard.ts`, `backend/server/src/presentation/admin/`, `backend/server/src/application/admin/`, `backend/server/src/application/editor/editor-auth.service.ts`, `backend/server/src/shared/ip-mask.ts`, `frontend/client/admin.html`
- **Tasks (in order):**
  - [x] [`SPC-02.1`](./spec-compliance/issues/SPC-02-admin-and-privileged-security.md) — Default-deny `PrivilegedSurfaceGuard` + startup meta-check
  - [x] [`SPC-02.2`](./spec-compliance/issues/SPC-02-admin-and-privileged-security.md) — 3-role RBAC (`admin`, `moderator`, `editor`) via `@Roles()` and moderation routes `P01..P04`
  - [x] [`SPC-02.3`](./spec-compliance/issues/SPC-02-admin-and-privileged-security.md) — Separate `ADMIN_JWT_SECRET` and `EDITOR_JWT_SECRET`
  - [x] [`SPC-02.4`](./spec-compliance/issues/SPC-02-admin-and-privileged-security.md) — Harden non-dev startup invariant (`NODE_ENV` allowlist `development`/`test` only)
  - [x] [`SPC-02.5`](./spec-compliance/issues/SPC-02-admin-and-privileged-security.md) — Cap admin/editor session TTL at ≤ 60 min + Redis `jti` revocation list on logout
  - [x] [`SPC-02.6`](./spec-compliance/issues/SPC-02-admin-and-privileged-security.md) — Harden `/api/admin/auth/*` (strict throttle, dummy nonce for non-admins, `(wallet, client)` challenge key)
  - [x] [`SPC-02.7`](./spec-compliance/issues/SPC-02-admin-and-privileged-security.md) — Implement `ADMIN_IP_ALLOWLIST` guard + `/24` IPv4 / `/48` IPv6 log & audit masking
  - [x] [`SPC-02.8`](./spec-compliance/issues/SPC-02-admin-and-privileged-security.md) — Enforce DB-level append-only `admin.AdminAction` (PostgreSQL trigger + `beforeState`/`afterState` + PII read audit)
  - [x] [`SPC-02.9`](./spec-compliance/issues/SPC-02-admin-and-privileged-security.md) — Implement `admin.AlertOutbox` + Telegram worker + overview alert banner + dual-admin approval (`ADMIN_APPROVAL_MODE`)
- **Lane 1 Verify Command:** `TEST_DATABASE_URL="postgresql://freight:freight_dev_password@127.0.0.1:15433/freightchain_agent1_test" npm run server:integration`

#### Wave 3 — `Lane 2` (Rides Dynamic 65 km/h Finish & `stats.RideResult` `SPC-03.1..6` + `E2E-08.1..2`)
- **Lane Status:** `[x] Done (Lane-2)`
- **Owned Paths:** `frontend/client/shared/route-curvature.js`, `frontend/client/shared/road.js`, `frontend/client/js/world/`, `frontend/client/js/sim/damage.js`, `backend/server/src/domain/road/`, `backend/server/src/application/rides/`, `backend/server/src/infrastructure/stats/`, `backend/server/src/domain/pool/pool-ranking.ts`, `tests/e2e/block1-offchain/rides-dynamic-finish.e2e.spec.ts`, `tests/e2e/block1-offchain/ride-result-ranking.e2e.spec.ts`
- **Tasks (in order):**
  - [x] [`SPC-03.1`](./spec-compliance/issues/SPC-03-rides-dynamic-finish-and-ride-result.md) — Remove `4h` and `8h` ride creation (`tier='free' | '1h'` only)
  - [x] [`SPC-03.2`](./spec-compliance/issues/SPC-03-rides-dynamic-finish-and-ride-result.md) — Implement `finishFor(roadSeed, trip, FINISH_RULES_VERSION)` at `V_BASE = 65 km/h` with `(RX, RZ, RT)` & `snapSafe`
  - [x] [`SPC-03.3`](./spec-compliance/issues/SPC-03-rides-dynamic-finish-and-ride-result.md) — Render physical finish line (`finish: true`) on 1h shifts + enforce 90-minute wall-clock `T_cap` (`5400s`)
  - [x] [`SPC-03.4`](./spec-compliance/issues/SPC-03-rides-dynamic-finish-and-ride-result.md) — Track damage by source (`holes`, `vehicles`, `props`, `cold`, `other`) & server red-light crossings (`stopLine(j, +1)`)
  - [x] [`SPC-03.5`](./spec-compliance/issues/SPC-03-rides-dynamic-finish-and-ride-result.md) — Implement `stats.RideResult` repository & populate on ride verification
  - [x] [`SPC-03.6`](./spec-compliance/issues/SPC-03-rides-dynamic-finish-and-ride-result.md) — Implement versioned pool ranking formula (`scoreFormulaVersion`) & `GET /api/pools/:id/results` gated by `payout_at`
  - [x] [`E2E-08.1`](./e2e-headless/issues/E2E-08-minigames-and-rides-ranking-e2e.md) — Dynamic 65 km/h Finish & Curvature Factors E2E (`RID-T-01..07`)
  - [x] [`E2E-08.2`](./e2e-headless/issues/E2E-08-minigames-and-rides-ranking-e2e.md) — `stats.RideResult` Breakdown & Pool Ranking Formula E2E (`RID-T-08..12`)
- **Lane 2 Verify Command:** `TEST_DATABASE_URL="postgresql://freight:freight_dev_password@127.0.0.1:15433/freightchain_agent2_test" npm run test:e2e:block1`

#### Wave 3 — `Lane 3` (Replays Visibility, Strip Inputs, Remove Effects & Tip-Only Donations `SPC-04.1..6`)
- **Lane Status:** `[x] Done (Lane-3)`
- **Owned Paths:** `backend/server/src/application/live/`, `backend/server/src/presentation/live/`, `backend/server/src/presentation/honk/`, `backend/server/src/application/rides/ride-receipt.service.ts`, `backend/server/src/application/actions/ride-action.service.ts`, `backend/server/src/presentation/player/me.controller.ts`
- **Tasks (in order):**
  - [x] [`SPC-04.1`](./spec-compliance/issues/SPC-04-replays-streams-donations-and-i18n.md) — Disable live watch of running rides (`GET /api/watch/:id` & `/road` → `404` when `running`)
  - [x] [`SPC-04.2`](./spec-compliance/issues/SPC-04-replays-streams-donations-and-i18n.md) — Hide training rides from public replays/watch/receipts/Blinks + gate pool replays until `payout_at` (except owner)
  - [x] [`SPC-04.3`](./spec-compliance/issues/SPC-04-replays-streams-donations-and-i18n.md) — Strip `SAMPLE_INPUT_COL` & raw input bits from public `/api/watch/:id` responses
  - [x] [`SPC-04.4`](./spec-compliance/issues/SPC-04-replays-streams-donations-and-i18n.md) — Remove gameplay donation effects (`night`, `day`, `potholes`, `trench`, `sinkhole`) & remove `honk/time` and `honk/weather`
  - [x] [`SPC-04.5`](./spec-compliance/issues/SPC-04-replays-streams-donations-and-i18n.md) — Rework donations to replay-only SOL tips (`0.01/0.05/0.1`, `[0.001, 1.0]` SOL, 15m expiry, ≤3 orders, `95/5` split, `0%` referral share)
  - [x] [`SPC-04.6`](./spec-compliance/issues/SPC-04-replays-streams-donations-and-i18n.md) — Add `GET /api/me/donations` (`sent`/`received`) & disable pledges (`PLEDGES_ENABLED=0` → `403 pledges_disabled`)
- **Lane 3 Verify Command:** `TEST_DATABASE_URL="postgresql://freight:freight_dev_password@127.0.0.1:15433/freightchain_agent3_test" npm run server:integration`

#### Wave 3 — `Lane 4` (Deterministic `mock-rpc` Service & Injected Wallet Harness `E2E-06.1`)
- **Lane Status:** `[x] Done (Lane-4)`
- **Owned Paths:** `tests/e2e/mockchain/rpc.mjs`, `tests/e2e/harness/wallet.mjs`, `infra/docker-compose.e2e.yml`
- **Tasks (in order):**
  - [x] [`E2E-06.1`](./e2e-headless/issues/E2E-06-mockchain-and-replays-streams-e2e.md) — Build deterministic `e2e/mockchain/rpc.mjs` (`mock-rpc`) + `e2e/harness/wallet.mjs` (`E1M` runtime covering `RPL-T-95..99`)
- **Lane 4 Verify Command:** `node tests/e2e/mockchain/rpc.mjs --self-test`

> **WAVE 3 BARRIER GATE:** All 23 tasks above must be `[x] Done` and `npm run check && npm run server:integration && npm run test:e2e:block1` must exit `0` before starting Wave 4.

---

### WAVE 4 — Admin Security Matrix, Replay Controls & i18n, Pool v6 & Convoy/Airdrop
**Goal:** Verify the 54-route Admin Security Matrix (`E2E-09`), complete Replay Player Controls `C1..C36` & EN/RU i18n (`SPC-04.7..9`), implement Pool Schedule & Appeals (`SPC-05`), and implement the Convoy Referral & Pre-Season Airdrop rework (`SPC-08.1..4`).
**Prisma Schema Serialization:** `Lane 3` executes a 5-minute **Wave 4 Schema Pre-Step** first, adding the schema changes for Wave 4 (`live.LiveChat.replayT/hiddenAt/hiddenBy`, `player.Player.chatBannedUntil/convoyHidden`, `pool.Pool` & `Series` schedule columns, `ride.RideAppeal`, `player.Referral` Convoy columns, `player.AirdropClaim`) in a single consolidated migration (`wave4_chat_pool_convoy_airdrop`) before Lanes 1–4 run in parallel.

#### Wave 4 — `Lane 1` (Admin Security Matrix & Findings Regression `E2E-09.1..3`)
- **Lane Status:** `[x] Done (Lane-1)` — Re-run on main 2026-10-20: `vitest.security.config.mjs` 7 tests exit 0, `vitest.security.integration.config.mjs` 1 test exit 0 on `freightchain_agent1_test`. The suite is the as-built subset: anonymous privileged routes are `404 not_found`, not `401`. `npm test` does not collect `test/security/`. `E2E-09.4` and `E2E-09.5` stay open (they are not this lane).
- **Owned Paths:** `backend/server/test/security/admin-surface-matrix.spec.ts`, `backend/server/test/security/admin-findings-regression.spec.ts`, `backend/server/test/security/admin-audit-alerts.integration.spec.ts`
- **Tasks (in order):**
  - [x] [`E2E-09.1`](./e2e-headless/issues/E2E-09-admin-security-matrix-and-ci.md) — Build Automated Privileged Surface Matrix Runner (`ADM-T-01..12` × 54+ routes)
  - [x] [`E2E-09.2`](./e2e-headless/issues/E2E-09-admin-security-matrix-and-ci.md) — Implement Admin Security Findings Regression Suite (`ADM-T-20..32`, Findings `F01..F18`)
  - [x] [`E2E-09.3`](./e2e-headless/issues/E2E-09-admin-security-matrix-and-ci.md) — Implement Append-Only `AdminAction` Audit, Dual Approval & Telegram `AlertOutbox` E2E (`ADM-T-33..44`)
- **Lane 1 Verify Command:** `TEST_DATABASE_URL="postgresql://freight:freight_dev_password@127.0.0.1:15433/freightchain_agent1_test" npx --prefix backend/server vitest run --config test/security/vitest.security.config.mjs && TEST_DATABASE_URL="postgresql://freight:freight_dev_password@127.0.0.1:15433/freightchain_agent1_test" npx --prefix backend/server vitest run --config test/security/vitest.security.integration.config.mjs`

#### Wave 4 — `Lane 2` (Replay Controls `C1..C36`, Replay Chat & EN/RU Localization `SPC-04.7..9` + `E2E-06.2, 6, 7, 8`)
- **Lane Status:** `[x] Done (Lane-2)` — merged 2026-10-20. Client replay test 3 pass. Chat, post-event, moderation, and live-features unit specs 16 pass. `tsc --noEmit` exit 0. The four block1 specs passed in the lane on port 3102 and were not re-run here. `E2E-06.3`–`06.5` stay open.
- **Owned Paths:** `frontend/client/site/replay-player.js`, `frontend/client/site/i18n.js`, `frontend/client/index.html`, `frontend/client/r.html`, `frontend/client/blink.html`, `backend/server/src/application/live/live-chat.service.ts`, `backend/server/src/application/live/chat-retention.scheduler.ts`, `tests/e2e/block1-offchain/replays-visibility.e2e.spec.ts`, `tests/e2e/block1-offchain/replay-chat.e2e.spec.ts`, `tests/e2e/block1-offchain/replay-donations.e2e.spec.ts`, `tests/e2e/block1-offchain/replay-receipts-pledges.e2e.spec.ts`
- **Tasks (in order):**
  - [x] [`SPC-04.7`](./spec-compliance/issues/SPC-04-replays-streams-donations-and-i18n.md) — Build replay player controls `C3, C6, C7, C8, C15, C16, C17, C18, C19, C36` and remove `C9, C26, C27, C32`
  - [x] [`SPC-04.8`](./spec-compliance/issues/SPC-04-replays-streams-donations-and-i18n.md) — Implement replay chat time-binding (`replayT`), 200-char/link/word filter, moderation `P01/P02`, and 90-day retention
  - [x] [`SPC-04.9`](./spec-compliance/issues/SPC-04-replays-streams-donations-and-i18n.md) — Implement `frontend/client/site/i18n.js` full EN/RU localization across lobby, replay viewer, receipts, and error codes
  - [x] [`E2E-06.2`](./e2e-headless/issues/E2E-06-mockchain-and-replays-streams-e2e.md) — Replay Lifecycle & Visibility E2E (`RPL-T-01..15`, `M-RPL-01..06`)
  - [x] [`E2E-06.6`](./e2e-headless/issues/E2E-06-mockchain-and-replays-streams-e2e.md) — Replay Chat & Time-Binding E2E (`RPL-T-61..69`)
  - [x] [`E2E-06.7`](./e2e-headless/issues/E2E-06-mockchain-and-replays-streams-e2e.md) — Replay Tip-Only Donations & `GET /api/me/donations` E2E via `mock-rpc` (`RPL-T-70..90`)
  - [x] [`E2E-06.8`](./e2e-headless/issues/E2E-06-mockchain-and-replays-streams-e2e.md) — Pledges Disabled & Receipt/Blink E2E (`RPL-T-91..102`)
- **Lane 2 Verify Command:** `TEST_DATABASE_URL="postgresql://freight:freight_dev_password@127.0.0.1:15433/freightchain_agent2_test" npm run test:e2e:block1`

#### Wave 4 — `Lane 3` (Pool Schedule, `last_start_at`, Appeals & Program v6 `SPC-05.1..6` + `E2E-08.5`)
- **Lane Status:** `[x] Done (Lane-3)` — merged 2026-10-20. Schedule unit specs and the route manifest passed on main. `tsc --noEmit` exit 0. Block 2 was green in the lane (46 pass) and was not re-run here. `SPC-05.6` stays blocked. The combined Wave 4 barrier was not re-run.
- **Owned Paths:** `backend/server/prisma/` (Wave 4 Pre-Step migration), `backend/programs/freightchain_pools/src/`, `backend/server/src/domain/pool/`, `backend/server/src/application/pools/`, `backend/server/src/presentation/admin/admin-appeals.controller.ts`, `tests/e2e/block2-chain/pool-schedule-appeals.e2e.spec.ts`
- **Tasks (in order):**
  - [x] [`SPC-05.1`](./spec-compliance/issues/SPC-05-pool-schedule-appeals-and-program-v6.md) — Implement configurable weekly pool schedule (`opens_at`, `sales_close_at`, `last_start_at = close - 1h15m`, `play_close_at`, `validation_until`)
  - [x] [`SPC-05.2`](./spec-compliance/issues/SPC-05-pool-schedule-appeals-and-program-v6.md) — Enforce `409 pool_last_start_passed` on ride start & `409 pool_schedule_mismatch` on DB vs on-chain PDA drift
  - [x] [`SPC-05.3`](./spec-compliance/issues/SPC-05-pool-schedule-appeals-and-program-v6.md) — Add non-refundable ticket burn rule after `last_start_at` + lobby purchase warning checkbox
  - [x] [`SPC-05.4`](./spec-compliance/issues/SPC-05-pool-schedule-appeals-and-program-v6.md) — Implement pool validation & appeals workflow (`POST /api/rides/:id/appeal`, block `commit_winners_root` until `validation_until` & 0 open appeals)
  - [x] [`SPC-05.5`](./spec-compliance/issues/SPC-05-pool-schedule-appeals-and-program-v6.md) — Update `freightchain_pools` program: `Config.min_finish_secs <= 7200` + v6 schedule fields (`opens_at`, `last_start_at`, `period_secs`)
  - [!] [`SPC-05.6`](./spec-compliance/issues/SPC-05-pool-schedule-appeals-and-program-v6.md) — Resolve `set_pool_rules` governance conflict (`POOL-M-12`/`B8` vs `ADM-M-07`/Decision 60 — **Owner Decision Gate**; default to `ADM-M-07` Squads CLI-only until owner overrides)
  - [x] [`E2E-08.5`](./e2e-headless/issues/E2E-08-minigames-and-rides-ranking-e2e.md) — Implement Pool Schedule, `last_start_at` Cutoff, Ticket Burn UI & Appeals E2E (`POOL-T-01..16`)
- **Lane 3 Verify Command:** `TEST_DATABASE_URL="postgresql://freight:freight_dev_password@127.0.0.1:15433/freightchain_agent3_test" npm run test:e2e:block2`

#### Wave 4 — `Lane 4` (Referral Convoy Rework & Pre-Season TEN4 Airdrop `SPC-08.1..4`)
- **Lane Status:** `[x] Done (Lane-4)` — merged onto main 2026-10-20. Unit + manifest: 16 files, 40 tests, exit 0. Stores are in-memory until Lane 3's migration is applied. `SPC-08.5` and `SPC-08.6` stay open. `E2E-05.7` and `E2E-05.8` stay open.
- **Owned Paths:** `backend/server/src/application/referral/`, `backend/server/src/presentation/referral/`, `backend/server/src/application/airdrop/`, `backend/server/src/infrastructure/social/`
- **Tasks (in order):**
  - [x] [`SPC-08.1`](./spec-compliance/issues/SPC-08-referral-convoy-ten4-airdrop-and-trust.md) — Convoy Referral state machine (`pending` 72h delete → `active` 60d window → `qualified` / `expired`) & dynamic pending slot cap `min(100, 5 + 2*A)`
  - [x] [`SPC-08.2`](./spec-compliance/issues/SPC-08-referral-convoy-ten4-airdrop-and-trust.md) — Convoy invitee 1h promo ride gift on activation (`3/d`, `10/wk`, `500/wk` caps) + M1 (`100 TEN4` @ 2w) & M2 (`50 TEN4` @ 5w) rewards
  - [x] [`SPC-08.3`](./spec-compliance/issues/SPC-08-referral-convoy-ten4-airdrop-and-trust.md) — 25-row Convoy leaderboard (`GET /api/referrals/leaderboard`) & `convoyHidden` privacy toggle (`PATCH /api/me/privacy`)
  - [x] [`SPC-08.4`](./spec-compliance/issues/SPC-08-referral-convoy-ten4-airdrop-and-trust.md) — Pre-Season TEN4 Airdrop campaign engine (MEDIUM/HARD ride gate, Telegram check, X verification via `twitterapi.io`, Turnstile, unique social ID binding)
- **Lane 4 Verify Command:** `TEST_DATABASE_URL="postgresql://freight:freight_dev_password@127.0.0.1:15433/freightchain_agent4_test" npm run server:integration`

> **WAVE 4 BARRIER GATE:** All 25 tasks above (except owner-gated `SPC-05.6` if still pending) must be `[x] Done` and `npm run check && npm run server:integration && npm run test:e2e:block1 && npm run test:e2e:block2` must exit `0` before starting Wave 5.

---

### WAVE 5 — Anti-Cheat v2.1 (30 Hz Re-Sim, Salts, `F1..F10`), Minigames & Replay Chrome E2E
**Goal:** Land Telemetry v2.1 and 30 Hz fixed-step deterministic simulation (`SPC-06`), build the Minigame Captcha framework (`SPC-07`), and run the Headless Chrome Replay Controls (`C1..C36`) & i18n suites (`E2E-06.3..5`).
**Prisma Schema Serialization:** `ride.RideMiniGame` and the ride salt columns are already in migration `20261108000000_ride_minigames`. Do not create that table again. `ride.Ride.sessionKey` is in `20261109000000_telemetry_v21_session_key`. `pauseCount` and `pauseSeconds` are in `20261110000000_ride_pause_tally`. `trafficSaltCommit` and `holeSaltCommit` are in `20261111000000_ride_salt_commit`. Revealed `trafficSalt`, `holeSalt`, `saltCommit`, `trustScore`, `trustSignals`, the terms versions, and raw `inp` / `inpAt` are in `20261112000000_wave5_enforce_trust`.

#### Wave 5 — `Lane 1` (Telemetry v2.1, 30 Hz Fixed-Step Re-Sim, Pause/Slow-Mo & Salts `SPC-06.1..4`)
- **Lane Status:** `[x] Done (Lane-1)` — `TELEMETRY_V21` default stays `off`. `enforce` adds the named streams, the enforce MAC, salt reveal, the 30 Hz inp step, `worldDigest32` of the spawned ids, and pause/slow-mo rejects. `shadow` still flags and does not reject. `REPLAY_SIM_HZ` stays 10 and `RULES_VERSION` stays 7. The 10 Hz replay does not call `stepAt30Hz`. Migration: `20261112000000_wave5_enforce_trust`.
- **Owned Paths:** `backend/server/prisma/` (Wave 5 Pre-Step migration), `frontend/client/shared/telemetry-codec.js`, `frontend/client/shared/physics.js`, `frontend/client/shared/traffic-simulation.js`, `frontend/client/js/main.js`, `frontend/client/js/net/telemetry.js`, `backend/server/src/domain/road/replay-engine.ts`, `backend/server/src/application/rides/ingest-telemetry.handler.ts`, `backend/server/src/application/rides/verify-ride.service.ts`
- **Tasks (in order):**
  - [x] [`SPC-06.1`](./spec-compliance/issues/SPC-06-anticheat-v2-and-30hz-resim.md) — Implement Telemetry v2.1 wire protocol (`sessionKey` per-batch HMAC-SHA256, deflate streams `inp`/`clk`/`chk`/`mg`/`env`, `batch-mac-invalid`)
  - [x] [`SPC-06.2`](./spec-compliance/issues/SPC-06-anticheat-v2-and-30hz-resim.md) — Upgrade client & server `ReplayEngine` to 30 Hz fixed-step deterministic simulation (`dt = 1/30s`) + incremental per-batch server re-sim
  - [x] [`SPC-06.3`](./spec-compliance/issues/SPC-06-anticheat-v2-and-30hz-resim.md) — Enforce pause (`≤3` pauses, `≤5 min` cumulative) and slow-motion (`dt` / wall-clock drift) anti-cheat bounds
  - [x] [`SPC-06.4`](./spec-compliance/issues/SPC-06-anticheat-v2-and-30hz-resim.md) — Implement shared pool `roadSeed` + per-ride `trafficSalt` & `holeSalt` commit–reveal (`HMAC-SHA256`) and `worldDigest32` verification
- **Lane 1 Verify Command:** `TEST_DATABASE_URL="postgresql://freight:freight_dev_password@127.0.0.1:15433/freightchain_agent1_test" npm run server:integration`

#### Wave 5 — `Lane 2` (Humanness `F1..F10`, 90d Trace Clustering, `TrustScore` & `TermsGuard` `SPC-06.5..6` + `SPC-08.5..6`)
- **Lane Status:** `[x] Done (Lane-2)` — F1–F10, the five §16.4 rejects including a copied trace, top-20 `trace-cluster` flagged for review, 90-day inp prune after payout, `trustScore` from 60 with a 48 h hold, and `TermsGuard`. No browser fingerprint and no live 30 Hz cutover.
- **Owned Paths:** `backend/server/src/domain/anticheat/humanness-classifier.ts`, `frontend/client/js/input.js`, `backend/server/src/application/rides/trace-clustering.service.ts`, `backend/server/src/application/rides/telemetry-retention.scheduler.ts`, `backend/server/src/domain/anticheat/trust-score.ts`, `backend/server/src/application/anticheat/trust-score.service.ts`, `backend/server/src/presentation/common/guards/terms.guard.ts`
- **Tasks (in order):**
  - [x] [`SPC-06.5`](./spec-compliance/issues/SPC-06-anticheat-v2-and-30hz-resim.md) — Implement mechanical input humanness classifier (`F1..F10` → `humannessScore`), 5 physical-impossibility auto-reject rules, and `isTrusted=false` tracking
  - [x] [`SPC-06.6`](./spec-compliance/issues/SPC-06-anticheat-v2-and-30hz-resim.md) — Implement 90-day raw input trace retention job & pool top-20 cross-ride input trace clustering detector
  - [x] [`SPC-08.5`](./spec-compliance/issues/SPC-08-referral-convoy-ten4-airdrop-and-trust.md) — Implement Anti-Sybil `TrustScore` service (ASN, device fingerprint, funding cluster, humanness score, `<50` payout block, 48h reward hold queue)
  - [x] [`SPC-08.6`](./spec-compliance/issues/SPC-08-referral-convoy-ten4-airdrop-and-trust.md) — Implement `TermsGuard` (`CURRENT_TERMS_VERSION` re-consent enforcement on all write routes) & scrub banned gambling terms across `frontend/`
- **Lane 2 Verify Command:** `TEST_DATABASE_URL="postgresql://freight:freight_dev_password@127.0.0.1:15433/freightchain_agent2_test" npm run server:integration`

#### Wave 5 — `Lane 3` (Phone `phone-sms` `SPC-07.1..5`)
- **Lane Status:** `[x] Done (Lane-3)` — ported from the `phone-minigames` worktree on 2026-10-20. `tsc --noEmit` exit 0. Client phone tests 8 pass. Server minigame unit specs 32 pass. `MINIGAMES` defaults to `off`. The PostgreSQL integration suite was not re-run. `E2E-08.3` and `E2E-08.4` stay open.
- **Owned Paths:** `frontend/client/js/phone/`, `frontend/client/js/minigames/`, `frontend/client/shared/minigame-kinds.js`, `backend/server/src/domain/minigames/`, `backend/server/src/application/services/minigame-session.service.ts`
- **Tasks (in order):**
  - [x] [`SPC-07.1`](./spec-compliance/issues/SPC-07-minigames-framework-and-catalog.md) — Port `mgSalt` commit–reveal and the `phone-sms` schedule (`2..4` arms, time gaps, null `slotS`). Source: branch `phone-minigames`. Do not build Appendix A.
  - [x] [`SPC-07.2`](./spec-compliance/issues/SPC-07-minigames-framework-and-catalog.md) — Port arm, cancel, and one client deferral. Do not add a parking pocket.
  - [x] [`SPC-07.3`](./spec-compliance/issues/SPC-07-minigames-framework-and-catalog.md) — Port the SVG phone-sms renderer (dispatch mark, one true cab slip, no code in the open JSON)
  - [x] [`SPC-07.4`](./spec-compliance/issues/SPC-07-minigames-framework-and-catalog.md) — Port `RideMiniGame`, open / answer / SVG routes, and the accepted catalog (`phone-sms` only)
  - [x] [`SPC-07.5`](./spec-compliance/issues/SPC-07-minigames-framework-and-catalog.md) — Port scoring (`+20` s only after 3 wrong tries), `missed` with no extra seconds, and `more-time` (60 s)
- **Lane 3 Verify Command:** `TEST_DATABASE_URL="postgresql://freight:freight_dev_password@127.0.0.1:15433/freightchain_agent3_test" npm run server:integration`

#### Wave 5 — `Lane 4` (Headless Chrome Replay Controls `C1..C36`, EN/RU i18n, Convoy & Airdrop E2E `E2E-06.3..5` + `E2E-05.7..8`)
- **Lane Status:** `[x] Done (Lane-4)` — a recorded 1h ride in Chrome drives the clock, the camera, and seek. Removed C9, C26, C27, and C32 stay absent. EN/RU and the 48 h convoy/airdrop hold are covered.
- **Owned Paths:** `backend/server/scripts/e2e-i18n-legal.mjs`, `backend/server/scripts/e2e-replay-controls.mjs`, `tests/e2e/block1-offchain/wave5-lane4.e2e.spec.ts`
- **Tasks (in order):**
  - [x] [`E2E-06.3`](./e2e-headless/issues/E2E-06-mockchain-and-replays-streams-e2e.md) — EN/RU Localization & Legal Copy E2E (`RPL-T-16..29`, `LEG-T-01..11`)
  - [x] [`E2E-06.4`](./e2e-headless/issues/E2E-06-mockchain-and-replays-streams-e2e.md) — Replay Player Controls `C1..C19` Headless Chrome E2E (`RPL-T-30..48`)
  - [x] [`E2E-06.5`](./e2e-headless/issues/E2E-06-mockchain-and-replays-streams-e2e.md) — Replay HUD, Telemetry & Removal Controls `C20..C36` E2E (`RPL-T-49..60`)
  - [x] [`E2E-05.7`](./e2e-headless/issues/E2E-05-local-validator-and-chain-e2e.md) — Target Convoy Referral E2E suite (`REF-T-01..22`)
  - [x] [`E2E-05.8`](./e2e-headless/issues/E2E-05-local-validator-and-chain-e2e.md) — Target TEN4 Airdrop & Pre-Season E2E suite (`TEN-T-10..15`)
- **Lane 4 Verify Command:** `PORT=3104 node backend/server/scripts/e2e-replay-controls.mjs && PORT=3104 node backend/server/scripts/e2e-i18n-legal.mjs`

> **WAVE 5 BARRIER GATE:** All 21 tasks above must be `[x] Done` and `npm run check && npm run server:integration && npm run test:e2e:block1` must exit `0` before starting Wave 6.

---

### WAVE 6 — Block 3 Anti-Cheat Driver Bots (`#1..#58`), Minigame E2E & Final Census Gate
**Goal:** Execute the full Block 3 Anti-Cheat Driver Bot suite (`engine: 'game'` & `engine: 'kernel'`, Cheat Catalog `#1..#58`, Minigame E2E `MGM-T-01..09`), wire the CI fast/full pipelines, and pass the final 100% green `census.mjs --self-test` audit.
**Prisma Schema Changes in Wave 6:** None (`0` migrations).

#### Wave 6 — `Lane 1` (Block 3 Driver Bot Harness, 30 Hz Physics Parity, Telemetry v2.1 & World Integrity `E2E-07.1..4`)
- **Lane Status:** `[ ] Todo`
- **Owned Paths:** `tests/e2e/block3-anticheat/harness/`, `tests/e2e/block3-anticheat/physics-parity.e2e.spec.ts`, `tests/e2e/block3-anticheat/telemetry-v21.e2e.spec.ts`, `tests/e2e/block3-anticheat/world-integrity.e2e.spec.ts`
- **Tasks (in order):**
  - [ ] [`E2E-07.1`](./e2e-headless/issues/E2E-07-anticheat-bots-and-resim-e2e.md) — Build `tests/e2e/block3-anticheat` harness with dual driver bot engines (`engine: 'game'` & `engine: 'kernel'`) + 5 behavioral profiles
  - [ ] [`E2E-07.2`](./e2e-headless/issues/E2E-07-anticheat-bots-and-resim-e2e.md) — 30 Hz Deterministic Physics & Re-Sim Parity Suite (`AC-P1..P12`)
  - [ ] [`E2E-07.3`](./e2e-headless/issues/E2E-07-anticheat-bots-and-resim-e2e.md) — Telemetry v2.1 Wire, HMAC & Deflate Stream Suite (`AC-T1..T16`)
  - [ ] [`E2E-07.4`](./e2e-headless/issues/E2E-07-anticheat-bots-and-resim-e2e.md) — World Integrity, Salt Commit–Reveal & Digest Suite (`AC-W1..W18`)
- **Lane 1 Verify Command:** `TEST_DATABASE_URL="postgresql://freight:freight_dev_password@127.0.0.1:15433/freightchain_agent1_test" npx jest tests/e2e/block3-anticheat/physics-parity.e2e.spec.ts tests/e2e/block3-anticheat/telemetry-v21.e2e.spec.ts tests/e2e/block3-anticheat/world-integrity.e2e.spec.ts`

#### Wave 6 — `Lane 2` (Humanness `F1..F10`, Clock/Pause, 58-Vector Cheat Catalog & Retention/Sybil E2E `E2E-07.5..8`)
- **Lane Status:** `[ ] Todo`
- **Owned Paths:** `tests/e2e/block3-anticheat/humanness-classifier.e2e.spec.ts`, `tests/e2e/block3-anticheat/clock-and-pause.e2e.spec.ts`, `tests/e2e/block3-anticheat/cheat-catalog.e2e.spec.ts`, `tests/e2e/block3-anticheat/retention-and-sybil.e2e.spec.ts`
- **Tasks (in order):**
  - [ ] [`E2E-07.5`](./e2e-headless/issues/E2E-07-anticheat-bots-and-resim-e2e.md) — Mechanical Input Humanness (`F1..F10`) & 5 Physical-Impossibility Reject Rules (`AC-H1..H3`, `ACH-T-02..03`)
  - [ ] [`E2E-07.6`](./e2e-headless/issues/E2E-07-anticheat-bots-and-resim-e2e.md) — Pause, Slow-Mo, Wall-Clock & 90-Minute Timeout Suite (`AC-F1..F11`, `AC-R1..R8`)
  - [ ] [`E2E-07.7`](./e2e-headless/issues/E2E-07-anticheat-bots-and-resim-e2e.md) — Full 58-Vector Cheat Catalog Regression Suite (`#1..#58` in `anticheat.md` §9)
  - [ ] [`E2E-07.8`](./e2e-headless/issues/E2E-07-anticheat-bots-and-resim-e2e.md) — 90-Day Input Trace Retention, Top-20 Clustering & Anti-Sybil `TrustScore` E2E (`ACH-T-04`)
- **Lane 2 Verify Command:** `TEST_DATABASE_URL="postgresql://freight:freight_dev_password@127.0.0.1:15433/freightchain_agent2_test" npm run test:e2e:block3`

#### Wave 6 — `Lane 3` (Phone-sms E2E `E2E-08.3..4`)
- **Lane Status:** `[~] In Progress` — `test/scenarios/minigames.scenarios.ts` locks a free ride (null commit) and a 1h `phone-sms` (arm, open without a code field, `+20` after three wrong tries) on the in-memory HTTP harness. Salt reveal, cancel, and the rate limit are still open.
- **Owned Paths:** `tests/e2e/block3-anticheat/minigames-schedule.e2e.spec.ts`, `tests/e2e/block3-anticheat/minigames-challenges.e2e.spec.ts`
- **Tasks (in order):**
  - [ ] [`E2E-08.3`](./e2e-headless/issues/E2E-08-minigames-and-rides-ranking-e2e.md) — Phone-sms schedule, cancel, and salt reveal E2E (`MGM-T-01..05`)
  - [ ] [`E2E-08.4`](./e2e-headless/issues/E2E-08-minigames-and-rides-ranking-e2e.md) — Phone-sms SVG, scoring, and rate-limit E2E (`MGM-T-06..12`)
- **Lane 3 Verify Command:** `TEST_DATABASE_URL="postgresql://freight:freight_dev_password@127.0.0.1:15433/freightchain_agent3_test" npx jest tests/e2e/block3-anticheat/minigames-schedule.e2e.spec.ts tests/e2e/block3-anticheat/minigames-challenges.e2e.spec.ts`

#### Wave 6 — `Lane 4` (CI Fast/Full Scripts & Final 100% Green Census Gate `E2E-09.4..5`)
- **Lane Status:** `[ ] Todo` (Wait for Wave 6 Lanes 1–3 before running `E2E-09.5`)
- **Owned Paths:** `package.json`, `.claude/skills/test-census/census.mjs`, `docs/testing/COVERAGE_CONTRACT.md`, `docs/wiki-catalog.js`
- **Tasks (in order):**
  - [ ] [`E2E-09.4`](./e2e-headless/issues/E2E-09-admin-security-matrix-and-ci.md) — Wire PR Fast-Gate (`npm run test:ci:fast`) & Nightly Full-Stack CI (`npm run test:ci:full`)
  - [ ] [`E2E-09.5`](./e2e-headless/issues/E2E-09-admin-security-matrix-and-ci.md) — Final `census.mjs --self-test` 100% green audit across all 151+ routes, 28+ tables, 12 HTML pages, 19 Anchor instructions & 211 spec rules + `node docs/build-wiki.mjs`
- **Lane 4 Verify Command:** `npm run test:ci:fast && node .claude/skills/test-census/census.mjs --self-test && node docs/build-wiki.mjs`
