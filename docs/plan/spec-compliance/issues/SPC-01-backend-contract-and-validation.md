# Epic SPC-01 — Backend Contract, `@ZodResponse`, `.strict()` & Validation

> **Parent Plan:** [`docs/plan/SPEC_COMPLIANCE_PLAN.md`](../../SPEC_COMPLIANCE_PLAN.md) · **Status Board:** [`docs/plan/spec-compliance/STATUS.md`](../STATUS.md)
> **Spec Docs:** [`docs/spec/backend_contract.md`](../../../spec/backend_contract.md) (`API-M-01..13`), [`docs/spec/legal.md`](../../../spec/legal.md) (`LEG-M-04..06`)

---

## Overview

Brings the NestJS HTTP contract layer into 100% compliance with [`docs/spec/backend_contract.md`](../../../spec/backend_contract.md): runtime response validation via `@ZodResponse`, automated OpenAPI 3.1 generation, `.strict()` request DTOs rejecting undeclared properties, uniform `404` responses on foreign player-scoped resources, fail-closed geo checks when `CF-IPCountry` is absent in production, and the landing page `paintHero` null-pool fix.

---

## Tasks

### `SPC-01.1` — Implement `@ZodResponse(schema)` decorator, `ZodResponseInterceptor` (`RESPONSE_SCHEMA_CHECK`), and attach schemas to all 151+ routes

- **Status:** `[x] Done`
- **Spec Rules:** `API-M-01`, `API-M-02`, `API-M-06..09` (`docs/spec/backend_contract.md`)
- **Paired Plan 1 Tasks:** `E2E-02.1`, `E2E-02.2`
- **Target Files:**
  - `backend/server/src/presentation/common/zod-response.decorator.ts`
  - `backend/server/src/presentation/common/zod-response.interceptor.ts`
  - `backend/server/src/infrastructure/config/env.schema.ts` (`RESPONSE_SCHEMA_CHECK=off|warn|strict`)
  - `backend/server/.env.example`, `infra/deploy/.env.example`, `infra/deploy/docker-compose.prod.yml`
  - `backend/server/src/presentation/**/*.controller.ts` (all 151+ routes)
- **Depends On:** None

#### Definition of Ready (DoR)
- [ ] All 151 routes in `docs/spec/backend_contract.md` §2 (`R001..R151`) and their current return types are inventoried.
- [ ] Exemption list for non-JSON routes (e.g. PNG buffers `/api/rides/:id/card.png`, redirects `/r/:id`, SSE/raw streams) is documented via `@ZodResponseRaw()`.

#### Definition of Done (DoD)
- [ ] `@ZodResponse(schema, statusCode?)` decorator and global `ZodResponseInterceptor` are implemented.
- [ ] `RESPONSE_SCHEMA_CHECK` env key (`off | warn | strict`, default `strict` in `test`/`development` and `warn` in `production`) is added to all 4 env files (`env.schema.ts`, `backend/server/.env.example`, `infra/deploy/.env.example`, `infra/deploy/docker-compose.prod.yml`).
- [ ] Every JSON route in `backend/server/src/presentation/` is decorated with `@ZodResponse(...)` and passes `npm run server:unit` and `npm run server:integration` with `RESPONSE_SCHEMA_CHECK=strict`.
- [ ] `docs/spec/PRODUCT.md` updated; status marked `[x] Done` in [`docs/plan/spec-compliance/STATUS.md`](../STATUS.md).

---

### `SPC-01.2` — Build OpenAPI 3.1 generator (`openapi:generate` → `openapi.json`) from controller + Zod metadata

- **Status:** `[x] Done`
- **Spec Rules:** `API-M-03` (`docs/spec/backend_contract.md`)
- **Paired Plan 1 Task:** `E2E-02.6`
- **Target Files:**
  - `backend/server/scripts/generate-openapi.ts`
  - `backend/server/openapi.json`
  - `backend/server/package.json` (`openapi:generate`)
- **Depends On:** `SPC-01.1`

#### Definition of Ready (DoR)
- [ ] `@ZodBody`, `@ZodQuery`, `@ZodParams`, and `@ZodResponse` metadata keys are standardized across all controllers (`SPC-01.1`).

#### Definition of Done (DoD)
- [ ] `npm --prefix backend/server run openapi:generate` introspects the NestJS controller metadata + Zod schemas and writes a deterministic `backend/server/openapi.json` (OpenAPI 3.1).
- [ ] Contract test (`E2E-02.6`) verifies `openapi.json` is up-to-date and matches `routes.manifest.ts` 1:1.
- [ ] `docs/spec/PRODUCT.md` updated; status marked `[x] Done` in [`docs/plan/spec-compliance/STATUS.md`](../STATUS.md).

---

### `SPC-01.3` — Enforce `.strict()` on all Admin, Editor, Auth, Ticket, Pool, Promo, and Money request Zod schemas

- **Status:** `[x] Done`
- **Spec Rules:** `API-M-04`, `ADM-M-12` (`docs/spec/backend_contract.md`, `docs/spec/admin_security.md`)
- **Paired Plan 1 Task:** `E2E-02.4`
- **Target Files:**
  - `backend/server/src/presentation/**/*.dto.ts` (and inline `z.object(...)` schemas)
- **Depends On:** None

#### Definition of Ready (DoR)
- [ ] All `@ZodBody` and `@ZodQuery` `z.object(...)` definitions in `backend/server/src/presentation/` are audited; telemetry hot-path forward-compatibility exceptions (if any) are explicitly listed.

#### Definition of Done (DoD)
- [ ] Every privileged (`/api/admin/*`, `/api/editor/*`, `/api/mcp/*`), auth (`/api/auth/*`), and financial/state-mutating (`/api/tickets/*`, `/api/pools/*`, `/api/promo/*`, `/api/honk/*`, `/api/referrals/*`, `/api/live/*`) Zod object schema uses `.strict()`.
- [ ] Sending an unknown field (`{ __extra: true }`) returns `400` (`validation_error`).
- [ ] Architecture/contract spec verifies `.strict()` presence on all non-exempt DTOs.
- [ ] `docs/spec/PRODUCT.md` updated; status marked `[x] Done` in [`docs/plan/spec-compliance/STATUS.md`](../STATUS.md).

---

### `SPC-01.4` — Standardize foreign resource `:id` ownership checks to return `404` across all player-scoped endpoints

- **Status:** `[x] Done`
- **Spec Rules:** `API-M-05`, `API-M-10` (`docs/spec/backend_contract.md`)
- **Paired Plan 1 Task:** `E2E-02.5`
- **Target Files:**
  - `backend/server/src/application/rides/`
  - `backend/server/src/application/tickets/`
  - `backend/server/src/application/honk/`
  - `backend/server/src/application/live/`
- **Depends On:** None

#### Definition of Ready (DoR)
- [ ] All player-scoped `:id` handlers that currently return `403 Forbidden` when `resource.wallet !== currentWallet` (leaking resource existence) are identified from `docs/spec/backend_contract.md` §3.

#### Definition of Done (DoD)
- [ ] Accessing another player's ride, ticket order, TEN4 order, or donation/pledge order returns the exact same `404` `DomainError` (`not_found`) as a non-existent `:id`.
- [ ] Matrix B (`E2E-02.5`) passes across all player-owned `:id` routes in both memory and PostgreSQL.
- [ ] `docs/spec/PRODUCT.md` updated; status marked `[x] Done` in [`docs/plan/spec-compliance/STATUS.md`](../STATUS.md).

---

### `SPC-01.5` — Enforce fail-closed geo eligibility when `CF-IPCountry` is absent in production (`PRIZE_DEV_DEFAULT_COUNTRY` dev-only)

- **Status:** `[x] Done`
- **Spec Rules:** `API-M-11`, `LEG-M-04`, `LEG-M-05`, `LEG-M-06` (`docs/spec/backend_contract.md`, `docs/spec/legal.md`)
- **Paired Plan 1 Task:** `E2E-06.3`
- **Target Files:**
  - `backend/server/src/presentation/common/geo.service.ts` (or eligibility handler)
  - `backend/server/src/infrastructure/config/env.schema.ts` (`PRIZE_DEV_DEFAULT_COUNTRY`)
  - `backend/server/.env.example`, `infra/deploy/.env.example`, `infra/deploy/docker-compose.prod.yml`
- **Depends On:** None

#### Definition of Ready (DoR)
- [ ] Current `CF-IPCountry` fallback behavior in `GeoGuard` / `/api/legal/eligibility` is inspected.

#### Definition of Done (DoD)
- [ ] When `NODE_ENV` is not `development`/`test`, a missing or `'XX'`/`'T1'` (Tor) `CF-IPCountry` header fails closed (`eligible: false`, `403 geo_restricted` on paid pool ticket / prize claim routes).
- [ ] In `development`/`test`, `PRIZE_DEV_DEFAULT_COUNTRY` (default `'US'`) provides deterministic local fallback.
- [ ] Unit and E2E tests verify both production fail-closed and blocked-country (`KP, IR, SY, CU, RU, BY`, etc.) behavior.
- [ ] `docs/spec/PRODUCT.md` updated; status marked `[x] Done` in [`docs/plan/spec-compliance/STATUS.md`](../STATUS.md).

---

### `SPC-01.6` — Fix `frontend/landing` `paintHero` null-pool crash when `GET /api/pools/current` returns `null`

- **Status:** `[x] Done`
- **Spec Rules:** `API-M-12`, `API-M-13` (`docs/spec/backend_contract.md`, Bug in `IMPLEMENTATION_PLAN.md` §Phase 3.9)
- **Paired Plan 1 Task:** `E2E-04.9`
- **Target Files:**
  - `frontend/landing/src/main.js` (or hero renderer module)
- **Depends On:** None

#### Definition of Ready (DoR)
- [ ] `paintHero` in `frontend/landing/` is inspected for unguarded property access when `GET /api/pools/current` returns `null` or `{ pool: null }`.

#### Definition of Done (DoD)
- [ ] `paintHero` safely handles `null` / empty current pool, displaying fallback prize/season copy without throwing a `TypeError`.
- [ ] Landing unit check (`npm --prefix frontend/landing run check`) and Headless Chrome `e2e-landing.mjs` (`E2E-04.9`) pass with `0` console errors.
- [ ] `docs/spec/PRODUCT.md` updated; status marked `[x] Done` in [`docs/plan/spec-compliance/STATUS.md`](../STATUS.md).
