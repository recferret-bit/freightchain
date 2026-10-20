# Epic E2E-02 — HTTP Contract, `@ZodResponse` & Negative Matrix

> **Parent Plan:** [`docs/plan/E2E_HEADLESS_PLAN.md`](../../E2E_HEADLESS_PLAN.md) · **Status Board:** [`docs/plan/e2e-headless/STATUS.md`](../STATUS.md)
> **Track:** Track A + Track B ([`docs/spec/backend_contract.md`](../../../spec/backend_contract.md) `API-T-01..13`, [`docs/testing/COVERAGE_CONTRACT.md`](../../../testing/COVERAGE_CONTRACT.md) §2.1–2.2)

---

## Overview

Establishes the automated HTTP contract harness across all 151+ backend endpoints: a single source-of-truth route manifest, strict runtime response schema validation (`@ZodResponse` with `RESPONSE_SCHEMA_CHECK=strict`), database row-delta assertions (`expectDbDelta`), table-driven negative testing (`negative-matrix.spec.ts` Matrix A and Matrix B), and property/OpenAPI fuzzing.

---

## Tasks

### `E2E-02.1` — Build `routes.manifest.ts` + meta-test asserting 100% NestJS controller route registration

- **Status:** `[x] Done`
- **Track:** Track A + B
- **Spec / Contract Ref:** `API-T-01`, `API-M-01`, `COVERAGE_CONTRACT` §2.1
- **Target Files:**
  - `backend/server/test/contract/routes.manifest.ts`
  - `backend/server/test/contract/routes-manifest.spec.ts`
- **Depends On:** `E2E-01.3`

#### Definition of Ready (DoR)
- [ ] All 151 routes in `docs/spec/backend_contract.md` §2 (`R001..R151`) are cataloged with method, path, auth guard, host constraint, request Zod schemas, and expected status codes.
- [ ] NestJS `DiscoveryService` / metadata scanner pattern for enumerating all registered `@Controller` + HTTP method decorators is selected.

#### Definition of Done (DoD)
- [ ] `routes.manifest.ts` exports a typed descriptor for every route in the NestJS application.
- [ ] `routes-manifest.spec.ts` boots the NestJS metadata graph and fails if any controller endpoint is missing from `routes.manifest.ts` or lacks `@ZodBody`/`@ZodQuery`/`@ZodParams` where input parameters exist (`API-T-01`).
- [ ] `npm run server:unit` runs `routes-manifest.spec.ts` and exits `0`.
- [ ] Status updated in [`docs/plan/e2e-headless/STATUS.md`](../STATUS.md).

---

### `E2E-02.2` — Enforce `@ZodResponse` schema validation (`RESPONSE_SCHEMA_CHECK=strict`) across all 151+ routes

- **Status:** `[x] Done`
- **Track:** Track A + B
- **Spec / Contract Ref:** `API-T-02`, `API-T-03`, `API-T-04`, `API-T-05`, `API-M-02`
- **Target Files:**
  - `backend/server/test/contract/zod-response.spec.ts`
  - `backend/server/test/flows.spec.ts`
  - `backend/server/test/flows.integration.spec.ts`
- **Depends On:** `SPC-01.1`, `E2E-02.1`

#### Definition of Ready (DoR)
- [ ] `@ZodResponse(schema)` decorator and response validation interceptor from `SPC-01.1` are implemented.
- [ ] Response Zod schemas are attached to all 151+ routes in `backend/server/src/presentation/`.

#### Definition of Done (DoD)
- [ ] `RESPONSE_SCHEMA_CHECK=strict` is enabled by default in `flows.spec.ts`, `flows.integration.spec.ts`, and all E2E test harnesses (`API-T-02`).
- [ ] Unit test `zod-response.spec.ts` verifies that:
  - Missing `@ZodResponse` on any non-redirect/non-binary route fails startup meta-check (`API-T-03`).
  - Returning an undeclared field or wrong type throws `500 response_schema_violation` in `strict` mode (`API-T-04`) and logs a structured warning in `warn` mode (`API-T-05`).
- [ ] Both `npm run server:unit` and `npm run server:integration` pass with `RESPONSE_SCHEMA_CHECK=strict`.
- [ ] Status updated in [`docs/plan/e2e-headless/STATUS.md`](../STATUS.md).

---

### `E2E-02.3` — Implement `expectDbDelta(prisma, tables, fn)` helper and instrument mutating route tests

- **Status:** `[x] Done`
- **Track:** Track A
- **Spec / Contract Ref:** `COVERAGE_CONTRACT` §2.2, `IMPLEMENTATION_PLAN.md` §Phase 2.3
- **Target Files:**
  - `backend/server/test/helpers/expect-db-delta.ts`
  - `backend/server/test/flows.integration.spec.ts`
- **Depends On:** `E2E-02.1`

#### Definition of Ready (DoR)
- [ ] All 28 Prisma models across `player`, `pool`, `ride`, `telemetry`, `live`, `stats`, `admin`, and `entity` schemas are mapped to their mutating routes.

#### Definition of Done (DoD)
- [ ] `expectDbDelta(prisma, expectedDeltas, fn)` snapshots table counts before and after `fn()`, asserting exact row creation/deletion deltas and verifying zero unintended writes on error paths (`4xx`).
- [ ] Integrated into `flows.integration.spec.ts` across all mutating endpoints (rides, tickets, pools, promo codes, referrals, TEN4, editor, admin).
- [ ] `npm run server:integration` exits `0`.
- [ ] Status updated in [`docs/plan/e2e-headless/STATUS.md`](../STATUS.md).

---

### `E2E-02.4` — Build table-driven `negative-matrix.spec.ts` — Matrix A (Auth, Host, Validation & `.strict()`)

- **Status:** `[x] Done`
- **Track:** Track A + B
- **Spec / Contract Ref:** `API-T-06`, `API-T-07`, `API-T-08`, `API-T-09`, `API-M-04`
- **Target Files:**
  - `backend/server/test/contract/negative-matrix.spec.ts`
- **Depends On:** `SPC-01.3`, `E2E-02.1`

#### Definition of Ready (DoR)
- [ ] `routes.manifest.ts` (`E2E-02.1`) and `.strict()` DTO schemas (`SPC-01.3`) are in place.
- [ ] Every route in `routes.manifest.ts` declares its auth requirement (`none`, `player`, `editor`, `moderator`, `admin`), host requirement (`any`, `admin.<domain>`, `editor.<domain>`), and sample invalid payload.

#### Definition of Done (DoD)
- [ ] `negative-matrix.spec.ts` automatically iterates over `routes.manifest.ts` and asserts:
  1. Missing session cookie on protected routes → `401` (`API-T-06`).
  2. Wrong role or wrong `Host` header on privileged routes → `403` (`API-T-07`).
  3. Invalid field types / missing required fields → `400` with `{ code, message }` (`API-T-08`).
  4. Extra unknown JSON property (`{ __unexpectedField: 1 }`) on `.strict()` DTO routes → `400` (`API-T-09`).
- [ ] Runs in both `npm run server:unit` (memory) and `npm run server:integration` (PostgreSQL).
- [ ] Status updated in [`docs/plan/e2e-headless/STATUS.md`](../STATUS.md).

---

### `E2E-02.5` — Build table-driven `negative-matrix.spec.ts` — Matrix B (Foreign Resource `:id` → `404`)

- **Status:** `[x] Done`
- **Track:** Track A + B
- **Spec / Contract Ref:** `API-T-10`, `API-M-05`
- **Target Files:**
  - `backend/server/test/contract/negative-matrix.spec.ts`
- **Depends On:** `SPC-01.4`, `E2E-02.4`

#### Definition of Ready (DoR)
- [ ] Foreign-resource `404` standardization (`SPC-01.4`) is implemented so non-existent and another-player's `:id` return identical `404` responses (preventing resource enumeration).
- [ ] Two distinct authenticated player sessions (`walletA`, `walletB`) with seeded rides, ticket orders, TEN4 orders, and pledges are configured in the test fixture.

#### Definition of Done (DoD)
- [ ] Matrix B iterates over every player-scoped `:id` route (`/api/rides/:id/*`, `/api/tickets/orders/:id/*`, `/api/honk/orders/:id/*`, `/api/live/orders/:id/*`, etc.) and asserts that `walletB` accessing `walletA`'s resource receives `404` with the exact same error code as a random non-existent UUID (`API-T-10`) and zero DB mutations (`expectDbDelta`).
- [ ] Passes in both `npm run server:unit` and `npm run server:integration`.
- [ ] Status updated in [`docs/plan/e2e-headless/STATUS.md`](../STATUS.md).

---

### `E2E-02.6` — Add `fast-check` DTO property fuzzing & OpenAPI `schemathesis` contract test

- **Status:** `[x] Done`
- **Track:** Track B
- **Spec / Contract Ref:** `API-T-11`, `API-T-12`, `API-T-13`, `API-M-03`
- **Target Files:**
  - `backend/server/test/contract/dto-fuzz.spec.ts`
  - `backend/server/test/contract/openapi-contract.spec.ts`
- **Depends On:** `SPC-01.2`, `E2E-02.2`

#### Definition of Ready (DoR)
- [ ] OpenAPI generator script (`SPC-01.2`) produces `openapi.json` from `@ZodBody`/`@ZodQuery`/`@ZodParams`/`@ZodResponse` metadata.
- [ ] `fast-check` is available in `backend/server/package.json`.

#### Definition of Done (DoD)
- [ ] `dto-fuzz.spec.ts` runs `fast-check` arbitrary payloads (100 runs per route) against all write endpoints and asserts zero unhandled `500` responses (`API-T-11`).
- [ ] `openapi-contract.spec.ts` verifies that generated `openapi.json` matches `routes.manifest.ts` 1:1 with zero undocumented routes or parameters (`API-T-12`, `API-T-13`).
- [ ] Passes in `npm run server:unit`.
- [ ] Status updated in [`docs/plan/e2e-headless/STATUS.md`](../STATUS.md).
