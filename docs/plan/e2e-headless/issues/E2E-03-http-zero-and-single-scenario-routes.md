# Epic E2E-03 — Close 17 Zero-Scenario & 47 Single-Scenario HTTP Routes

> **Parent Plan:** [`docs/plan/E2E_HEADLESS_PLAN.md`](../../E2E_HEADLESS_PLAN.md) · **Status Board:** [`docs/plan/e2e-headless/STATUS.md`](../STATUS.md)
> **Track:** Track A (As-Built — [`docs/testing/COVERAGE_CONTRACT.md`](../../../testing/COVERAGE_CONTRACT.md) §2.1, [`docs/testing/IMPLEMENTATION_PLAN.md`](../../../testing/IMPLEMENTATION_PLAN.md) Phase 2)

---

## Overview

Brings all 151 HTTP routes up to the mandatory coverage bar in [`docs/testing/COVERAGE_CONTRACT.md`](../../../testing/COVERAGE_CONTRACT.md) §2.1: **at least 1 positive scenario and at least 2 negative scenarios per route**, running identically against both the in-memory adapters (`flows.spec.ts`) and real PostgreSQL (`flows.integration.spec.ts`).

---

## Tasks

### `E2E-03.1` — Add positive + ≥2 negative scenarios for 5 zero-scenario Admin routes

- **Status:** `[x] Done`
- **Track:** Track A (As-Built)
- **Spec / Contract Ref:** `COVERAGE_CONTRACT` §2.1, `IMPLEMENTATION_PLAN.md` §Phase 2.1
- **Target Files:**
  - `backend/server/test/flows.spec.ts`
  - `backend/server/test/flows.integration.spec.ts`
- **Routes Covered:**
  1. `POST /api/admin/rides/:id/re-verify`
  2. `GET /api/admin/audit-log`
  3. `GET /api/admin/rides/:id/samples`
  4. `PUT /api/admin/settings`
  5. `GET /api/admin/wallets/:wallet` (wallet lookup / overview details)
- **Depends On:** `E2E-02.3`

#### Definition of Ready (DoR)
- [ ] As-built controller and handler signatures for the 5 admin routes are reviewed in `backend/server/src/presentation/admin/`.
- [ ] Admin session cookie (`fc_admin`), `Host: admin.freightchain.localhost`, and Ed25519 `adminSig` signing helpers in `flows.spec.ts` are verified.

#### Definition of Done (DoD)
- [ ] Each of the 5 routes has ≥1 positive test asserting response body + `AdminAction` audit row creation (`expectDbDelta`) and ≥2 negative tests (missing `fc_admin` → `401`, wrong host → `403`, invalid signature/body → `400/401`, non-existent `:id` → `404`).
- [ ] Passes in both `npm run server:unit` and `npm run server:integration`.
- [ ] Status updated in [`docs/plan/e2e-headless/STATUS.md`](../STATUS.md).

---

### `E2E-03.2` — Add positive + ≥2 negative scenarios for 8 zero-scenario Editor & Entity routes

- **Status:** `[x] Done`
- **Track:** Track A (As-Built)
- **Spec / Contract Ref:** `PLT-T-01..08`, `COVERAGE_CONTRACT` §2.1, `IMPLEMENTATION_PLAN.md` §Phase 2.1
- **Target Files:**
  - `backend/server/test/flows.spec.ts`
  - `backend/server/test/flows.integration.spec.ts`
- **Routes Covered:**
  1. `POST /api/editor/auth/logout`
  2. `GET /api/editor/entities/:key/revisions`
  3. `GET /api/editor/entities/:key/revisions/:rev`
  4. `POST /api/editor/entities/:key/revert`
  5. `DELETE /api/editor/entities/:key`
  6. `GET /api/editor/jobs/:id`
  7. `POST /api/editor/jobs/:id/cancel`
  8. `GET /api/entities/bundle` (ETag / `If-None-Match` `304` + published bundle)
- **Depends On:** `E2E-02.3`

#### Definition of Ready (DoR)
- [ ] Editor session (`fc_editor`) and signed publish/revert helpers in `flows.spec.ts` are verified.
- [ ] Entity revision and AI job queue repositories are wired in both memory and PostgreSQL test modules.

#### Definition of Done (DoD)
- [ ] All 8 routes have ≥1 positive scenario + ≥2 negative scenarios (unauthenticated `401`, non-existent entity/revision/job `404`, bad signature/payload `400`, rate-limit/Redis failure `429/503`).
- [ ] Passes in both `npm run server:unit` and `npm run server:integration`.
- [ ] Status updated in [`docs/plan/e2e-headless/STATUS.md`](../STATUS.md).

---

### `E2E-03.3` — Add positive + ≥2 negative scenarios for 4 zero-scenario Player, Auth, Live & Dev routes

- **Status:** `[x] Done`
- **Track:** Track A (As-Built)
- **Spec / Contract Ref:** `COVERAGE_CONTRACT` §2.1, `IMPLEMENTATION_PLAN.md` §Phase 2.1
- **Target Files:**
  - `backend/server/test/flows.spec.ts`
  - `backend/server/test/flows.integration.spec.ts`
- **Routes Covered:**
  1. `POST /api/auth/logout`
  2. `GET /api/tickets/orders/:id`
  3. `POST /api/live/rides/:id/effects/:eventId/applied` (As-Built Track A; later replaced by `404/410` in Track B `E2E-06.7`)
  4. `GET /api/stats/summary` (and any remaining zero-scenario public/player read route in `census.mjs`)
- **Depends On:** `E2E-02.3`

#### Definition of Ready (DoR)
- [ ] Zero-scenario route list from `node .claude/skills/test-census/census.mjs` is confirmed down to the exact remaining 4 routes.

#### Definition of Done (DoD)
- [ ] All 4 routes have ≥1 positive scenario + ≥2 negative scenarios in `flows.spec.ts` and `flows.integration.spec.ts`.
- [ ] `node .claude/skills/test-census/census.mjs` reports `0` zero-scenario routes.
- [ ] Status updated in [`docs/plan/e2e-headless/STATUS.md`](../STATUS.md).

---

### `E2E-03.4` — Add negative scenarios (`≥2` per route) for single-scenario Auth, Profile, Legal & Referral routes

- **Status:** `[x] Done`
- **Track:** Track A (As-Built)
- **Spec / Contract Ref:** `LEG-T-01..09`, `REF-T-01..06`, `COVERAGE_CONTRACT` §2.1
- **Target Files:**
  - `backend/server/test/flows.spec.ts`
  - `backend/server/test/flows.integration.spec.ts`
- **Depends On:** `E2E-02.3`

#### Definition of Ready (DoR)
- [ ] Single-scenario routes in `/api/auth/*`, `/api/me/*`, `/api/profile/*`, `/api/legal/*`, and `/api/referrals/*` are listed from `census.mjs`.

#### Definition of Done (DoD)
- [ ] Every route in this group has ≥1 positive and ≥2 negative scenarios (expired/replayed SIWS nonce, invalid signature, bad `.sol` domain, self-referral `400`, duplicate referral claim `409`, geo-blocked eligibility).
- [ ] Passes in `npm run server:unit` and `npm run server:integration`.
- [ ] Status updated in [`docs/plan/e2e-headless/STATUS.md`](../STATUS.md).

---

### `E2E-03.5` — Add negative scenarios (`≥2` per route) for single-scenario Rides, Telemetry, Tickets & Promo routes

- **Status:** `[x] Done`
- **Track:** Track A (As-Built)
- **Spec / Contract Ref:** `RID-T-01..04`, `PRM-T-01..08`, `COVERAGE_CONTRACT` §2.1
- **Target Files:**
  - `backend/server/test/flows.spec.ts`
  - `backend/server/test/flows.integration.spec.ts`
- **Depends On:** `E2E-02.3`

#### Definition of Ready (DoR)
- [ ] Single-scenario routes in `/api/rides/*`, `/api/tickets/*`, and `/api/promo/*` are listed from `census.mjs`.

#### Definition of Done (DoD)
- [ ] Every route in this group has ≥1 positive and ≥2 negative scenarios (concurrent running ride `409`, out-of-order telemetry seq, heartbeat after finish `409`, expired/exhausted promo code `400/409`, duplicate ticket order reconcile).
- [ ] Passes in `npm run server:unit` and `npm run server:integration`.
- [ ] Status updated in [`docs/plan/e2e-headless/STATUS.md`](../STATUS.md).

---

### `E2E-03.6` — Add negative scenarios (`≥2` per route) for single-scenario Pools, Replays, Watch, TEN4 & Blinks routes

- **Status:** `[x] Done`
- **Track:** Track A (As-Built)
- **Spec / Contract Ref:** `POOL-T-01..06`, `TEN-T-01..08`, `COVERAGE_CONTRACT` §2.1
- **Target Files:**
  - `backend/server/test/flows.spec.ts`
  - `backend/server/test/flows.integration.spec.ts`
- **Depends On:** `E2E-02.3`

#### Definition of Ready (DoR)
- [ ] Single-scenario routes in `/api/pools/*`, `/api/replays/*`, `/api/watch/*`, `/api/honk/*`, and `/api/actions/*` are listed from `census.mjs`.

#### Definition of Done (DoD)
- [ ] Every route in this group has ≥1 positive and ≥2 negative scenarios (closed pool pledge/ticket `409`, non-existent watch/replay `404`, insufficient TEN4 balance `400`, already owned soulbound cab item `409`, Blink missing profile stamps `400` with `{message}` shape and `Access-Control-Allow-Origin: *`).
- [ ] Passes in `npm run server:unit` and `npm run server:integration`.
- [ ] Status updated in [`docs/plan/e2e-headless/STATUS.md`](../STATUS.md).

---

### `E2E-03.7` — Mirror 100% of `flows.spec.ts` scenarios into `flows.integration.spec.ts` (Real PostgreSQL Parity Gate)

- **Status:** `[x] Done`
- **Track:** Track A (As-Built)
- **Spec / Contract Ref:** `COVERAGE_CONTRACT` §2.1–2.2, `IMPLEMENTATION_PLAN.md` §Phase 2.3
- **Target Files:**
  - `backend/server/test/flows.integration.spec.ts`
  - `.claude/skills/test-census/census.mjs`
- **Depends On:** `E2E-03.1`, `E2E-03.2`, `E2E-03.3`, `E2E-03.4`, `E2E-03.5`, `E2E-03.6`

#### Definition of Ready (DoR)
- [ ] All 151 routes have ≥1 positive and ≥2 negative scenarios in `flows.spec.ts`.
- [ ] Local test database `freightchain_test` on `:15433` is running and migrated.

#### Definition of Done (DoD)
- [ ] `flows.integration.spec.ts` executes the full scenario suite against real PostgreSQL with `expectDbDelta` assertions and concurrency lock checks (`findByWalletForUpdate`).
- [ ] `node .claude/skills/test-census/census.mjs` reports `0` zero-scenario routes and `0` single-scenario routes across both memory and PostgreSQL suites.
- [ ] `npm run server:integration` exits `0`.
- [ ] Status updated in [`docs/plan/e2e-headless/STATUS.md`](../STATUS.md).
