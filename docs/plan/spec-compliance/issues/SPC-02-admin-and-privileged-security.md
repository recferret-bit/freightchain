# Epic SPC-02 — Admin & Privileged Security (`ADM-M-01..21`, Findings `F01..F18`)

> **Parent Plan:** [`docs/plan/SPEC_COMPLIANCE_PLAN.md`](../../SPEC_COMPLIANCE_PLAN.md) · **Status Board:** [`docs/plan/spec-compliance/STATUS.md`](../STATUS.md)
> **Spec Docs:** [`docs/spec/admin_security.md`](../../../spec/admin_security.md) (`ADM-M-01..21`, Findings `F01..F18`, Decisions `59–66`)

---

## Overview

Implements all 21 mandatory security controls (`ADM-M-01..21`) and remediates all 18 audit findings (`F01..F18`) in [`docs/spec/admin_security.md`](../../../spec/admin_security.md) across the Admin (`admin.<domain>`), Editor (`editor.<domain>`), Moderator, MCP, and Dev surfaces.

---

## Tasks

### `SPC-02.1` — Implement default-deny `PrivilegedSurfaceGuard` + startup meta-check across `/api/admin/*`, `/api/editor/*`, `/api/dev/*`, `/api/mcp/*`

- **Status:** `[x] Done`
- **Spec Rules:** `ADM-M-01`, `ADM-M-02`, `ADM-M-06`, Findings `F01`, `F02`
- **Paired Plan 1 Task:** `E2E-09.1`
- **Target Files:**
  - `backend/server/src/presentation/common/guards/privileged-surface.guard.ts`
  - `backend/server/src/presentation/admin/`
  - `backend/server/src/presentation/editor/`
  - `backend/server/test/architecture/privileged-routes.spec.ts`
- **Depends On:** `SPC-01.3`

#### Definition of Ready (DoR)
- [ ] All 54+ privileged routes (`A01..A33`, `E01..E17`, `M01..M04`, `S01..S03`, `P01..P04`) in `docs/spec/admin_security.md` §2 are mapped.

#### Definition of Done (DoD)
- [ ] Global `PrivilegedSurfaceGuard` inspects raw `req.headers.host` (never trusting `X-Forwarded-Host`) and enforces default-deny on any `/api/admin/*`, `/api/editor/*`, `/api/dev/*`, or `/api/mcp/*` route unless explicitly decorated with `@PublicAdminAuth()` (only `/api/admin/auth/nonce`, `/api/admin/auth/verify`, `/api/editor/auth/nonce`, `/api/editor/auth/verify`).
- [ ] Every mutating admin route (`POST`/`PUT`/`PATCH`/`DELETE` under `/api/admin/*`, except auth/logout) requires a fresh Ed25519 action signature (`adminSig`) bound to `(domain, wallet, method, path, bodyHash, nonce, timestamp)`.
- [ ] Startup meta-check throws at boot if any privileged controller route lacks an explicit `@Roles(...)` or `@PublicAdminAuth()` decorator.
- [ ] `docs/spec/PRODUCT.md` updated; status marked `[x] Done` in [`docs/plan/spec-compliance/STATUS.md`](../STATUS.md).

---

### `SPC-02.2` — Implement 3-role RBAC (`admin`, `moderator`, `editor`) via `@Roles()` and moderation routes `P01..P04`

- **Status:** `[x] Done`
- **Spec Rules:** `ADM-M-03`, `ADM-M-04`, Finding `F06` (Decision 59)
- **Paired Plan 1 Task:** `E2E-09.1`
- **Target Files:**
  - `backend/server/src/presentation/common/decorators/roles.decorator.ts`
  - `backend/server/src/infrastructure/config/env.schema.ts` (`MODERATOR_WALLETS`)
  - `backend/server/.env.example`, `infra/deploy/.env.example`, `infra/deploy/docker-compose.prod.yml`
  - `backend/server/src/presentation/admin/moderation.controller.ts` (`P01..P04`)
- **Depends On:** `SPC-02.1`

#### Definition of Ready (DoR)
- [ ] Role matrix in `docs/spec/admin_security.md` §3 (`admin` vs `moderator` vs `editor` permissions) and moderation endpoints `P01..P04` (chat hide, wallet chat-ban, ride review queue read, appeal triage) are reviewed.

#### Definition of Done (DoD)
- [ ] `@Roles('admin' | 'moderator' | 'editor')` is enforced by `PrivilegedSurfaceGuard`.
- [ ] `MODERATOR_WALLETS` env key added to all 4 env files.
- [ ] Moderators can access `P01..P04` and read-only review queues, but receive `403 insufficient_role` on `A01..A33` (settings, promo creation, verdict override, pool crank/payout).
- [ ] `docs/spec/PRODUCT.md` updated; status marked `[x] Done` in [`docs/plan/spec-compliance/STATUS.md`](../STATUS.md).

---

### `SPC-02.3` — Separate `ADMIN_JWT_SECRET` and `EDITOR_JWT_SECRET` + cryptographic domain separation

- **Status:** `[x] Done`
- **Spec Rules:** `ADM-M-05`, Finding `F04`
- **Paired Plan 1 Task:** `E2E-09.1`
- **Target Files:**
  - `backend/server/src/infrastructure/config/env.schema.ts` (`ADMIN_JWT_SECRET`, `EDITOR_JWT_SECRET`)
  - `backend/server/.env.example`, `infra/deploy/.env.example`, `infra/deploy/docker-compose.prod.yml`
  - `backend/server/src/infrastructure/auth/`
- **Depends On:** `SPC-02.1`

#### Definition of Ready (DoR)
- [ ] Current JWT / HMAC cookie signing implementation for `fc_admin`, `fc_editor`, and `fc_session` is inspected.

#### Definition of Done (DoD)
- [ ] `fc_admin` tokens are signed exclusively with `ADMIN_JWT_SECRET` (`aud: 'fc:admin'`), `fc_editor` tokens with `EDITOR_JWT_SECRET` (`aud: 'fc:editor'`), and player sessions with `JWT_SECRET` (`aud: 'fc:player'`).
- [ ] Startup validation fails in non-dev if `ADMIN_JWT_SECRET === JWT_SECRET` or `EDITOR_JWT_SECRET === JWT_SECRET` or `ADMIN_JWT_SECRET === EDITOR_JWT_SECRET`.
- [ ] `docs/spec/PRODUCT.md` updated; status marked `[x] Done` in [`docs/plan/spec-compliance/STATUS.md`](../STATUS.md).

---

### `SPC-02.4` — Harden non-dev startup invariant (`NODE_ENV` allowlist `development`/`test` only for dangerous flags)

- **Status:** `[x] Done`
- **Spec Rules:** `ADM-M-08`, Findings `F03`, `F05`
- **Paired Plan 1 Task:** `E2E-09.2`
- **Target Files:**
  - `backend/server/src/infrastructure/config/env.service.ts`
- **Depends On:** None

#### Definition of Ready (DoR)
- [ ] `env.service.ts` startup checks (currently checking `NODE_ENV === 'production'` instead of `NODE_ENV !== 'development' && NODE_ENV !== 'test'`) are inspected (`F03`).

#### Definition of Done (DoD)
- [ ] In any `NODE_ENV` other than `'development'` or `'test'` (including `'staging'`, `'preprod'`, `'production'`, or unset), startup throws a fatal error if `DEMO_WALLETS` is non-empty, `EDITOR_FAKE_LLM=1`, `LIVE_FREE_DONATIONS=on`, `LIVE_EFFECTS !== 'off'`, or `/api/dev/*` simulation routes are enabled.
- [ ] Unit tests in `admin-findings-regression.spec.ts` (`E2E-09.2`) verify startup refusal across `staging` and `production`.
- [ ] `docs/spec/PRODUCT.md` updated; status marked `[x] Done` in [`docs/plan/spec-compliance/STATUS.md`](../STATUS.md).

---

### `SPC-02.5` — Cap admin/editor session TTL at ≤ 60 min + Redis `jti` revocation list on logout

- **Status:** `[x] Done`
- **Spec Rules:** `ADM-M-09`, `ADM-M-10`, Findings `F07`, `F08` (Decision 63)
- **Paired Plan 1 Tasks:** `E2E-09.1`, `E2E-09.2`
- **Target Files:**
  - `backend/server/src/application/admin/admin-auth.service.ts`
  - `backend/server/src/application/editor/editor-auth.service.ts`
- **Depends On:** `SPC-02.3`

#### Definition of Ready (DoR)
- [ ] Current `fc_admin` and `fc_editor` cookie TTLs and logout handlers are inspected.

#### Definition of Done (DoD)
- [ ] Every `fc_admin` and `fc_editor` token embeds a unique `jti` (UUIDv4) and expires in `<= 3600` seconds (60 minutes).
- [ ] `POST /api/admin/auth/logout` and `POST /api/editor/auth/logout` write `revoked:jti:<jti>` to Redis (with in-memory fallback in unit tests) for the remaining TTL and clear the cookie.
- [ ] `PrivilegedSurfaceGuard` rejects any token whose `jti` is revoked (`401 token_revoked`).
- [ ] `docs/spec/PRODUCT.md` updated; status marked `[x] Done` in [`docs/plan/spec-compliance/STATUS.md`](../STATUS.md).

---

### `SPC-02.6` — Harden `/api/admin/auth/*` (strict throttle, indistinguishable dummy nonce for non-admins, challenge keyed by `(wallet, clientFingerprint)`)

- **Status:** `[x] Done`
- **Spec Rules:** `ADM-M-11`, Findings `F09`, `F10`, `F11` (Decision 65)
- **Paired Plan 1 Task:** `E2E-09.2`
- **Target Files:**
  - `backend/server/src/application/admin/admin-auth.service.ts`
  - `backend/server/src/presentation/admin/admin-auth.controller.ts`
- **Depends On:** `SPC-02.1`

#### Definition of Ready (DoR)
- [ ] Findings `F09` (non-admin wallet enumeration on `/nonce`), `F10` (single-slot nonce overwrite DoS per wallet), and `F11` (missing rate limit on `/api/admin/auth/*`) in `docs/spec/admin_security.md` are reviewed.

#### Definition of Done (DoD)
- [ ] `/api/admin/auth/nonce` and `/api/admin/auth/verify` are protected by the strict `auth` rate-limit tier (≤ 10 req / min / IP).
- [ ] Requesting a nonce for a non-admin wallet returns a valid-looking HMAC-derived dummy nonce with identical response shape and timing (`200`), failing only at `/verify` with generic `401 invalid_credentials` (`F09`).
- [ ] Active challenges are keyed by `(wallet, clientId)` (up to 5 concurrent challenges per wallet) so an attacker cannot overwrite an admin's pending login nonce (`F10`).
- [ ] `docs/spec/PRODUCT.md` updated; status marked `[x] Done` in [`docs/plan/spec-compliance/STATUS.md`](../STATUS.md).

---

### `SPC-02.7` — Implement `ADMIN_IP_ALLOWLIST` guard + `/24` IPv4 / `/48` IPv6 log & audit masking

- **Status:** `[x] Done`
- **Spec Rules:** `ADM-M-13`, `ADM-M-14`, Findings `F12`, `F13` (Decision 66)
- **Paired Plan 1 Task:** `E2E-09.2`
- **Target Files:**
  - `backend/server/src/presentation/common/guards/privileged-surface.guard.ts`
  - `backend/server/src/shared/ip-mask.ts`
  - `backend/server/src/infrastructure/config/env.schema.ts` (`ADMIN_IP_ALLOWLIST`)
  - `backend/server/.env.example`, `infra/deploy/.env.example`, `infra/deploy/docker-compose.prod.yml`
- **Depends On:** `SPC-02.1`

#### Definition of Ready (DoR)
- [ ] CIDR matching rules for `ADMIN_IP_ALLOWLIST` (comma-separated IPv4/IPv6 CIDRs, empty = allow all) and `/24` IPv4 / `/48` IPv6 truncation rules (`LEG-M-08`, `ADM-M-14`) are reviewed.

#### Definition of Done (DoD)
- [ ] When `ADMIN_IP_ALLOWLIST` is non-empty, `PrivilegedSurfaceGuard` rejects requests from non-matching client IPs with `403 ip_not_allowlisted`.
- [ ] All logger interceptors and audit log writers pass IP addresses through `maskIpSubnet(ip)` (`198.51.100.42` → `198.51.100.0/24`, `2001:db8:abcd:1234::1` → `2001:db8:abcd::/48`) before persisting or logging.
- [ ] `docs/spec/PRODUCT.md` updated; status marked `[x] Done` in [`docs/plan/spec-compliance/STATUS.md`](../STATUS.md).

---

### `SPC-02.8` — Enforce DB-level append-only `admin.AdminAction` (PostgreSQL trigger + `beforeState`/`afterState` + PII read audit + CLI script audit)

- **Status:** `[x] Done`
- **Spec Rules:** `ADM-M-15`, `ADM-M-16`, `ADM-M-17`, `ADM-M-18`, Findings `F14`, `F15` (Decision 64)
- **Paired Plan 1 Task:** `E2E-09.3`
- **Target Files:**
  - `backend/server/prisma/schema.prisma`
  - `backend/server/prisma/migrations/<timestamp>_admin_action_append_only/migration.sql`
  - `backend/server/src/infrastructure/admin/prisma-admin-action.repository.ts`
- **Depends On:** `SPC-02.1`

#### Definition of Ready (DoR)
- [ ] `admin.AdminAction` Prisma model and all call sites in `backend/server/src/application/admin/` and `backend/server/scripts/` are reviewed.

#### Definition of Done (DoD)
- [ ] Forward-only Prisma migration adds `role`, `beforeState` (Json?), `afterState` (Json?), `ipSubnet`, and `sigHash` columns to `admin.AdminAction` and installs a PostgreSQL `BEFORE UPDATE OR DELETE ON admin."AdminAction"` trigger that raises an exception (`admin_action_append_only`).
- [ ] All mutating admin handlers record `beforeState` and `afterState`; sensitive read handlers (wallet detail lookup, telemetry sample download, audit export) and privileged CLI scripts (`pool:payout`, `admin:*`) write an `AdminAction` audit entry.
- [ ] Integration test (`E2E-09.3`) proves `UPDATE` and `DELETE` on `admin.AdminAction` fail at PostgreSQL level.
- [ ] `docs/spec/PRODUCT.md` updated; status marked `[x] Done` in [`docs/plan/spec-compliance/STATUS.md`](../STATUS.md).

---

### `SPC-02.9` — Implement `admin.AlertOutbox` + Telegram alert worker + overview alert banner + dual-admin approval (`ADMIN_APPROVAL_MODE=single|dual`)

- **Status:** `[x] Done`
- **Spec Rules:** `ADM-M-19`, `ADM-M-20`, `ADM-M-21`, Findings `F16`, `F17`, `F18` (Decisions 61, 62)
- **Paired Plan 1 Task:** `E2E-09.3`
- **Target Files:**
  - `backend/server/prisma/schema.prisma` (`admin.AlertOutbox`, `admin.AdminProposal`)
  - `backend/server/prisma/migrations/<timestamp>_admin_alerts_and_proposals/migration.sql`
  - `backend/server/src/application/admin/admin-alert.service.ts`
  - `backend/server/src/application/admin/admin-approval.service.ts`
  - `backend/server/src/infrastructure/config/env.schema.ts` (`ADMIN_ALERT_TELEGRAM_BOT_TOKEN`, `ADMIN_ALERT_TELEGRAM_CHAT_ID`, `ADMIN_APPROVAL_MODE`)
  - `backend/server/.env.example`, `infra/deploy/.env.example`, `infra/deploy/docker-compose.prod.yml`
  - `frontend/client/admin.html` (active alert banner & pending approval queue)
- **Depends On:** `SPC-02.8`

#### Definition of Ready (DoR)
- [ ] Alert trigger catalog (verdict override, `GameSetting` mutation, repeated failed admin auth, payout root commit, emergency pause) and dual-approval action list (`ADMIN_APPROVAL_MODE=single|dual`, 30-minute expiry window) in `docs/spec/admin_security.md` §5–6 are reviewed.

#### Definition of Done (DoD)
- [ ] Critical security/admin events write to `admin.AlertOutbox` inside the same DB transaction, are dispatched by background worker to Telegram (`ADMIN_ALERT_TELEGRAM_BOT_TOKEN` / `ADMIN_ALERT_TELEGRAM_CHAT_ID` when configured), and are returned in `GET /api/admin/overview` (`activeAlerts`) and rendered as a top banner in `admin.html`.
- [ ] When `ADMIN_APPROVAL_MODE=dual`, high-risk mutations require two distinct admin wallets signing within 30 minutes (`POST /api/admin/proposals/:id/approve`); self-approval by the proposer wallet returns `403 dual_approval_distinct_wallet_required`.
- [ ] `docs/spec/PRODUCT.md` updated; status marked `[x] Done` in [`docs/plan/spec-compliance/STATUS.md`](../STATUS.md).
