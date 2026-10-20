# Epic E2E-01 — Fix Red Gates & Wire Coverage Census

> **Parent Plan:** [`docs/plan/E2E_HEADLESS_PLAN.md`](../../E2E_HEADLESS_PLAN.md) · **Status Board:** [`docs/plan/e2e-headless/STATUS.md`](../STATUS.md)
> **Track:** Track A (As-Built — [`docs/spec/PRODUCT.md`](../../../spec/PRODUCT.md) & [`docs/testing/COVERAGE_CONTRACT.md`](../../../testing/COVERAGE_CONTRACT.md) §2.5, §4)

---

## Overview

Before expanding HTTP scenario matrices or headless Chrome scripts, the three existing red gates identified in [`docs/testing/IMPLEMENTATION_PLAN.md`](../../../testing/IMPLEMENTATION_PLAN.md) Phase 1 must be fixed and wired into root `npm run check` so regressions cannot re-enter `main`.

---

## Tasks

### `E2E-01.1` — Fix `veh|medic` 21-mesh parity drift in `npm run test:parity`

- **Status:** `[x] Done`
- **Track:** Track A (As-Built)
- **Spec / Contract Ref:** `docs/testing/COVERAGE_CONTRACT.md` §2.5, `docs/testing/IMPLEMENTATION_PLAN.md` §Phase 1.1
- **Target Files:**
  - `frontend/client/tools/test-parity.mjs`
  - `frontend/client/shared/entity/` (ambulance / `veh|medic` entity definition and snapshot baseline)
- **Depends On:** None

#### Definition of Ready (DoR)
- [ ] `npm run test:parity` failure output in `frontend/client/` is reproduced and the 21 extra meshes on `veh|medic` (ambulance revision) are inspected against `frontend/client/shared/entity/`.
- [ ] Confirmed whether the 21 meshes are intentional ambulance detail additions or unintended builder duplication.

#### Definition of Done (DoD)
- [ ] `veh|medic` entity/snapshot parity is aligned so all entity builders produce identical mesh counts, bounding boxes, and material keys.
- [ ] Running `npm --prefix frontend/client run test:parity` exits `0` with `0` mesh diffs.
- [ ] Running `npm --prefix frontend/client run trace:diff` passes without scene drift.
- [ ] Status updated in [`docs/plan/e2e-headless/STATUS.md`](../STATUS.md).

---

### `E2E-01.2` — Fix `npm run test:tickets-stub` (`18/20` → `20/20`)

- **Status:** `[x] Done`
- **Track:** Track A (As-Built)
- **Spec / Contract Ref:** `docs/testing/COVERAGE_CONTRACT.md` §2.5, `docs/testing/IMPLEMENTATION_PLAN.md` §Phase 1.2
- **Target Files:**
  - `frontend/client/tools/test-tickets-stub.mjs`
  - `frontend/client/js/net/` (stub handlers for `POST /api/tickets/orders/:id/reconcile` and `GET /api/referrals`)
- **Depends On:** None

#### Definition of Ready (DoR)
- [ ] `npm --prefix frontend/client run test:tickets-stub` is executed and the 2 failing assertions (`POST /api/tickets/orders/:id/reconcile` and `GET /api/referrals`) are isolated.
- [ ] As-built response shapes for both routes are verified in `docs/spec/PRODUCT.md` and `backend/server/src/presentation/`.

#### Definition of Done (DoD)
- [ ] `test-tickets-stub.mjs` mocks and asserts the exact shipped response contracts for `POST /api/tickets/orders/:id/reconcile` and `GET /api/referrals`.
- [ ] Running `npm --prefix frontend/client run test:tickets-stub` exits `0` (`20/20` passing).
- [ ] Status updated in [`docs/plan/e2e-headless/STATUS.md`](../STATUS.md).

---

### `E2E-01.3` — Map all 57 unmapped routes & 147 test files in `census.mjs` (`--self-test` green)

- **Status:** `[x] Done`
- **Track:** Track A (As-Built)
- **Spec / Contract Ref:** `docs/testing/COVERAGE_CONTRACT.md` §4.1, `docs/testing/IMPLEMENTATION_PLAN.md` §Phase 1.3
- **Target Files:**
  - `.claude/skills/test-census/census.mjs`
- **Depends On:** None

#### Definition of Ready (DoR)
- [ ] `node .claude/skills/test-census/census.mjs --self-test` output is captured, listing the 57 unmapped NestJS controller routes and 147 unmapped spec/e2e files.
- [ ] Controller decorators (`@Get`, `@Post`, `@Put`, `@Patch`, `@Delete`) across `backend/server/src/presentation/` are inventoried (`151` total routes).

#### Definition of Done (DoD)
- [ ] Every NestJS route (`151/151`) and every `.spec.ts` / `e2e-*.mjs` file in `backend/server/`, `frontend/client/`, and `tests/e2e/` is mapped in `.claude/skills/test-census/census.mjs`.
- [ ] Running `node .claude/skills/test-census/census.mjs --self-test` exits `0` with `0` unmapped routes and `0` unmapped test files.
- [ ] Status updated in [`docs/plan/e2e-headless/STATUS.md`](../STATUS.md).

---

### `E2E-01.4` — Wire `census.mjs --self-test`, `test:parity`, and `test:tickets-stub` into root `npm run check`

- **Status:** `[x] Done`
- **Track:** Track A (As-Built)
- **Spec / Contract Ref:** `docs/testing/COVERAGE_CONTRACT.md` §4
- **Target Files:**
  - `package.json`
  - `frontend/client/package.json`
- **Depends On:** `E2E-01.1`, `E2E-01.2`, `E2E-01.3`

#### Definition of Ready (DoR)
- [ ] Tasks `E2E-01.1`, `E2E-01.2`, and `E2E-01.3` are green individually.

#### Definition of Done (DoD)
- [ ] Root `npm run check` invokes `test:parity`, `test:tickets-stub`, and `node .claude/skills/test-census/census.mjs --self-test`.
- [ ] Running `npm run check` from repository root exits `0`.
- [ ] Status updated in [`docs/plan/e2e-headless/STATUS.md`](../STATUS.md).
