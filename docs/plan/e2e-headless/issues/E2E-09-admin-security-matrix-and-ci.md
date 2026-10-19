# Epic E2E-09 — Admin Security Matrix (54+ Routes) & CI Pipeline

> **Parent Plan:** [`docs/plan/E2E_HEADLESS_PLAN.md`](../../E2E_HEADLESS_PLAN.md) · **Status Board:** [`docs/plan/e2e-headless/STATUS.md`](../STATUS.md)
> **Track:** Track B (Target — [`docs/spec/admin_security.md`](../../../spec/admin_security.md) `ADM-T-01..12` & `ADM-T-20..44+`, [`docs/spec/e2e.md`](../../../spec/e2e.md) `E2E-T-01..07`)

---

## Overview

Implements the exhaustive privileged security matrix (`ADM-T-01..12` executed across all 54+ privileged routes `A01..A33`, `E01..E17`, `M01..M04`, `S01..S03`, `P01..P04`), regression tests for every security finding `F01..F18` (`ADM-T-20..44+`), and the CI/nightly pipeline gates.

---

## Tasks

### `E2E-09.1` — Build Automated Privileged Surface Matrix Runner (`ADM-T-01..12` × 54+ Routes)

- **Status:** `[ ] Todo`
- **Track:** Track B (Target)
- **Spec / Contract Ref:** `ADM-T-01..12`, `ADM-M-01..06`
- **Target Files:**
  - `backend/server/test/security/admin-surface-matrix.spec.ts`
- **Depends On:** `SPC-02.1`, `SPC-02.2`, `SPC-02.3`

#### Definition of Ready (DoR)
- [ ] `PrivilegedSurfaceGuard`, 3-role RBAC (`admin`, `moderator`, `editor`), and separate `ADMIN_JWT_SECRET` / `EDITOR_JWT_SECRET` (`SPC-02.1..3`) are implemented.
- [ ] All 54+ privileged routes (`A01..A33` Admin, `E01..E17` Editor, `M01..M04` MCP, `S01..S03` Dev/Sim, `P01..P04` Moderation) are cataloged with their required host, role, and Ed25519 action-signature policy.

#### Definition of Done (DoD)
- [ ] `admin-surface-matrix.spec.ts` automatically executes all 12 matrix columns (`ADM-T-01..12`) against every privileged route:
  - `ADM-T-01`: Anonymous request → `401`.
  - `ADM-T-02`: Player `fc_session` cookie on privileged route → `401`.
  - `ADM-T-03`: Editor `fc_editor` cookie on `/api/admin/*` → `401` (separate JWT secret).
  - `ADM-T-04`: Admin `fc_admin` cookie on wrong `Host` (`freightchain.localhost`) → `403`.
  - `ADM-T-05`: `X-Forwarded-Host: admin...` spoofing with non-admin `Host` → `403`.
  - `ADM-T-06`: Moderator role on admin-only route (`A01..A33`) → `403`.
  - `ADM-T-07`: Mutating admin route without `adminSig` → `401`.
  - `ADM-T-08`: Replayed `adminSig` nonce → `401`.
  - `ADM-T-09`: Expired `adminSig` timestamp (> 5 min) → `401`.
  - `ADM-T-10`: `adminSig` signed over different payload/path → `401`.
  - `ADM-T-11`: Revoked `jti` session token after logout → `401`.
  - `ADM-T-12`: Valid role + valid host + valid `adminSig` → `200/201` + `AdminAction` audit row created.
- [ ] Meta-test asserts that adding any new route under `/api/admin`, `/api/editor`, `/api/dev`, or `/api/mcp` without an entry in `admin-surface-matrix.spec.ts` fails the build.
- [ ] Passes in `npm run server:unit` and `npm run server:integration`.
- [ ] Status updated in [`docs/plan/e2e-headless/STATUS.md`](../STATUS.md).

---

### `E2E-09.2` — Implement Admin Security Findings Regression Suite (`ADM-T-20..32`, Findings `F01..F18`)

- **Status:** `[ ] Todo`
- **Track:** Track B (Target)
- **Spec / Contract Ref:** `ADM-T-20..32`, `F01..F18`, `ADM-M-08..14`
- **Target Files:**
  - `backend/server/test/security/admin-findings-regression.spec.ts`
- **Depends On:** `SPC-02.4`, `SPC-02.5`, `SPC-02.6`

#### Definition of Ready (DoR)
- [ ] Fixes for `F01..F18` (`SPC-02.4..6`) are implemented.

#### Definition of Done (DoD)
- [ ] `admin-findings-regression.spec.ts` verifies `ADM-T-20` through `ADM-T-32`:
  - `NODE_ENV=staging` or `NODE_ENV=production` refuses startup when `DEMO_WALLETS`, `EDITOR_FAKE_LLM=1`, `LIVE_FREE_DONATIONS=on`, or `LIVE_EFFECTS!=off` is set (`F03`, `ADM-T-20..22`).
  - Admin session TTL is capped at ≤ 60 minutes (`ADM-T-23`).
  - `/api/admin/auth/nonce` and `/api/admin/auth/verify` enforce strict rate-limiting, return indistinguishable dummy nonces for non-admin wallets (no wallet enumeration, `F09`), and key challenges by `(wallet, clientFingerprint)` so one client cannot overwrite another's challenge (`F10`, `ADM-T-24..27`).
  - `ADMIN_IP_ALLOWLIST` blocks non-allowlisted IPs with `403` (`ADM-T-28..29`).
  - Application logs mask client IPv4 addresses to `/24` and IPv6 to `/48` (`ADM-T-30..32`).
- [ ] Passes in `npm run server:unit` and `npm run server:integration`.
- [ ] Status updated in [`docs/plan/e2e-headless/STATUS.md`](../STATUS.md).

---

### `E2E-09.3` — Implement Append-Only `AdminAction` Audit, Dual Approval & Telegram `AlertOutbox` E2E (`ADM-T-33..44`)

- **Status:** `[ ] Todo`
- **Track:** Track B (Target)
- **Spec / Contract Ref:** `ADM-T-33..44`, `ADM-M-15..21`
- **Target Files:**
  - `backend/server/test/security/admin-audit-alerts.integration.spec.ts`
- **Depends On:** `SPC-02.7`, `SPC-02.8`, `SPC-02.9`

#### Definition of Ready (DoR)
- [ ] DB-level append-only trigger on `admin.AdminAction` (`SPC-02.7`), `admin.AlertOutbox` + Telegram worker (`SPC-02.8`), and dual-admin approval (`ADMIN_APPROVAL_MODE=dual`, `SPC-02.9`) are implemented.

#### Definition of Done (DoD)
- [ ] `admin-audit-alerts.integration.spec.ts` verifies `ADM-T-33` through `ADM-T-44` against real PostgreSQL:
  - `prisma.adminAction.update(...)` and `prisma.adminAction.delete(...)` fail at the PostgreSQL trigger/permission level (`ADM-T-33..34`).
  - Every mutating action and PII read (`GET /api/admin/wallets/:wallet`, sample export) records `beforeState`, `afterState`, `role`, `ipSubnet`, and `sigHash` (`ADM-T-35..37`).
  - High-risk actions in `ADMIN_APPROVAL_MODE=dual` create a pending proposal on admin #1's signature, reject self-approval by admin #1 (`403`), execute upon admin #2's signature within 30 minutes, and expire after 30 minutes (`ADM-T-38..41`).
  - Critical events (verdict override, setting change, failed admin login spike, payout root commit) insert into `admin.AlertOutbox`, dispatch to the mocked Telegram Bot API, and surface in the `GET /api/admin/overview` alert banner (`ADM-T-42..44`).
- [ ] Passes in `npm run server:integration`.
- [ ] Status updated in [`docs/plan/e2e-headless/STATUS.md`](../STATUS.md).

---

### `E2E-09.4` — Wire PR Fast-Gate & Nightly Full-Stack CI (`E2E-T-01..07`)

- **Status:** `[ ] Todo`
- **Track:** Track A + B
- **Spec / Contract Ref:** `E2E-T-01..07`, `docs/spec/e2e.md`, `COVERAGE_CONTRACT` §4
- **Target Files:**
  - `package.json`
  - `.claude/skills/run-tests/e2e.sh`
- **Depends On:** `E2E-01` .. `E2E-08`

#### Definition of Ready (DoR)
- [ ] All suites (`npm run check`, `npm run server:integration`, `npm run test:e2e:block1`, `npm run test:e2e:block2`, `npm run test:e2e:block3`, `bash .claude/skills/run-tests/e2e.sh`) are green locally.

#### Definition of Done (DoD)
- [ ] Root `package.json` exposes standardized scripts:
  - `npm run test:ci:fast` (`npm run check` + `npm run server:integration` + `npm run test:e2e:block1` + `negative-matrix` + `admin-surface-matrix`) completing in < 5 minutes.
  - `npm run test:ci:full` (adds `test:e2e:block2`, `test:e2e:block3`, `test:localnet`, `honk-suite`, and `bash .claude/skills/run-tests/e2e.sh`).
- [ ] Both commands exit `0` with deterministic output and zero flaky retries.
- [ ] Status updated in [`docs/plan/e2e-headless/STATUS.md`](../STATUS.md).

---

### `E2E-09.5` — Final `census.mjs` 100% Green Audit

- **Status:** `[ ] Todo`
- **Track:** Track A + B
- **Spec / Contract Ref:** `COVERAGE_CONTRACT` §2–4
- **Target Files:**
  - `.claude/skills/test-census/census.mjs`
  - `docs/testing/COVERAGE_CONTRACT.md`
- **Depends On:** `E2E-09.1`, `E2E-09.2`, `E2E-09.3`, `E2E-09.4`

#### Definition of Ready (DoR)
- [ ] All 63 preceding tasks in `E2E-01` through `E2E-09.4` are `[x] Done`.

#### Definition of Done (DoD)
- [ ] `node .claude/skills/test-census/census.mjs --self-test` reports:
  - `0` zero-scenario HTTP routes
  - `0` single-scenario HTTP routes
  - `100%` of routes covered on both In-Memory and PostgreSQL
  - `100%` of HTML pages covered in Headless Chrome (`e2e.sh`)
  - `100%` of Anchor instructions (`19/19`) covered on local validator
  - `100%` of `*-T-*` and `AC-*` spec test IDs mapped to passing test files.
- [ ] Status updated in [`docs/plan/e2e-headless/STATUS.md`](../STATUS.md).
