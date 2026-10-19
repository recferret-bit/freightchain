# Security of admin and privileged endpoints — spec and test plan

> Owner decision 17.10.2026: "add a check and protection of the admin endpoints to the test". The source of truth for `/api/admin/*`, `/api/editor/*` (the storybook 3D editor), MCP callbacks, the chain webhook, health, administrator CLI commands, and the future moderation endpoints (decision 53) and `set_pool_rules` (backend decision B8).
>
> The code was checked after the merge of PR #3 (`origin/main` `e8f338ad`). The merge did not add HTTP for `set_pool_rules` and did not add a TEN4 admin, so registry 1.2 did not change. Any later privileged route must enter registry 1.2 and the matrix ADM-T-01…12 from the first commit (ADM-M-21). Decisions 59–66 were accepted by the owner on 17.10.2026 ([`DECISIONS.md`](DECISIONS.md)); the rules below are the final norms, and "Role (target)" in 1.2 is the required role. Related rules: [`backend_contract.md`](backend_contract.md) API-M-03/04/07/13, [`replays_streams.md`](replays_streams.md) RPL-M-16/17/27, [`legal.md`](legal.md) LEG-M-04.

## Part 1. Spec
### 1.1 How it is protected now (`origin/main`)
**Admin** (`/api/admin/*`, `AdminGuard`, `server/src/infrastructure/http/guards/admin.guard.ts:35-45`), checks in order:
1. **Host:** on a split deployment the request must arrive at `admin.<COOKIE_DOMAIN>` (`admin.guard.ts:38`, `env.service.ts:149`). `Host` is taken (nginx sets it), not `X-Forwarded-Host`. Otherwise — `404`.
2. **Session:** the cookie `fc_admin` is an HS256 JWT with a separate `audience`/`issuer` (`jose.admin-token-signer.ts:41`) and the key `ADMIN_JWT_SECRET`. If the key is not set, it is derived from `JWT_SECRET` (`env.service.ts:36`). The wallet from the token is checked against `ADMIN_WALLETS` **on every request** (`admin.guard.ts:41`). No session, a foreign session, or the game session of the same wallet → `404`.
3. **CSRF:** mutating methods need the header `X-FC-Admin: 1` (`admin.guard.ts:42`), otherwise `403`. Cookie: `httpOnly`, `SameSite=Strict`, `Path=/api/admin`, no `Domain`, `Secure` in production (`admin-cookie.interceptor.ts:21`).
4. **Sign-in:** an SIWS message with the `domain`/`origin` of the admin host, a nonce of 16 bytes, TTL 5 min (`rules-config.adapter.ts:7`). Single-use: `DELETE … RETURNING` (`challenge.prisma.repository.ts:25`), consumed on the first attempt, successful or not. The allowlist is checked both on issue (`request-admin-challenge.handler.ts:73`) and on verification (`verify-admin-signin.handler.ts:33`). The session lasts `ADMIN_SESSION_TTL_MINUTES` (default 120, maximum 1440; `env.schema.ts:107`); there is no renewal.
5. **Every change is signed separately:** `…/challenge` issues the text of exactly this change (`AdminProofService.issue`, `admin-proof.service.ts:28-33`). One pending signature per admin, TTL 5 min. `prove` consumes it and checks the expiry, the intent match, and the signature (`admin-proof.service.ts:35-41`). Otherwise — `401`, and the change does not happen.
6. **Audit:** `admin.AdminAction` (`server/prisma/admin/admin.prisma:2-13`: wallet, action, target, detail JSON, requestId, at). Written for `auth.signin`, `verdict.override`, `verdict.rejudge`, `verdict.rejudge-bulk`, `pool.hold`/`pool.release`, `promo.create`/`promo.disable`, `setting.update`, `free_rides.adjust`, `entity.publish`, `editor.signin`. "Append-only" is promised only by a comment on the port (`admin-action.repository.port.ts:4`).
7. **Network:** the nginx site `admin.<apex>` is closed by HTTP basic auth (`deploy/nginx/admin.conf.template:14,26`). The application listens only on loopback (`deploy/docker-compose.prod.yml:176`). Production checks at startup (`env.schema.ts:163-176`): `COOKIE_DOMAIN` when `ADMIN_WALLETS`/`EDITOR_WALLETS` are non-empty, `JWT_SECRET`, `TRUST_PROXY`, a ban on `EDITOR_FAKE_LLM`.
8. **Limits:** the global `ThrottlerGuard` — a `default` budget of 600/min per player wallet or IP, per route (`throttling.ts:59`). Separate `auth` budgets (30/min + 5/s) — only for `/api/auth/*` and `/api/editor/auth/*` (`throttling.ts:16,22,60-61`).
9. **Origin:** the global `OriginGuard`. On the admin and storybook hosts a mutating request with `Origin` is accepted only same-origin (`origin.guard.ts:146`). A request without `Origin` passes (`origin.guard.ts:140`). CORS headers are not set for the admin host (`configure-app.ts:57`).

**Editor** (`/api/editor/*`, `EditorGuard`, `editor.guard.ts:84-95`): the same, with its own host `storybook.<apex>`, `EDITOR_IP_ALLOWLIST` (optional), the cookie `fc_editor`/`__Host-fc_editor`, the header `X-FC-Editor`, and `EDITOR_WALLETS`. Publication is signed separately (surface `editor`, its own domain in the text).
**MCP callbacks** (`/api/editor/mcp/*`, `McpJobGuard`, `mcp-job.guard.ts:26-37`): the job token `x-fc-job`, the job in status `running` and not older than the timeout, the wallet in `EDITOR_WALLETS`. A request through nginx (`X-Forwarded-For`/`X-Real-IP` is present) → `404`.
**Chain webhook** (`WebhookSecretGuard`, `webhook-secret.guard.ts:56-63`): the secret is not set → `404`. A wrong secret → `401`. Constant-time comparison over sha256.
**Roles:** three independent allowlists — `ADMIN_WALLETS`, `EDITOR_WALLETS`, and MCP jobs. There are no roles inside the admin: any admin can do everything.

### 1.2 Registry of privileged routes
Legend. **Guard:** `AG` = `AdminGuard` on the controller class, `EG` = `EditorGuard`, `MG` = `McpJobGuard`, `WG` = `WebhookSecretGuard`, `pub` = `@AdminPublic()`/`@EditorPublic()` (host/IP/header — yes, session — no). **Signed** — a signed action (1.1 item 5). **Strict** — `.strict()` in the zod input schema: in `origin/main` it is **nowhere** (zod drops extra fields by default). **Role (target)** — the required role per decision 59.

#### Admin — `admin.http.controller.ts` (class `AG` :37)
| # | Method and path | Line | Input | Effect | Money | Audit | Role (target) |
|---|---|---|---|---|---|---|---|
| A01 | POST `/api/admin/auth/nonce` (pub) | :45 | `challengeBodySchema` | sign-in text | — | no | all roles |
| A02 | POST `/api/admin/auth/verify` (pub) | :51 | `verifyBodySchema` | cookie `fc_admin` | — | `auth.signin` (success); a failure — a warn log only | all roles |
| A03 | POST `/api/admin/auth/logout` (pub) | :57 | — | clears the cookie (the token lives until the TTL) | — | no | all roles |
| A04 | GET `/api/admin/overview` | :62 | — | read | — | no | admin, moderator |
| A05 | GET `/api/admin/rides` | :68 | `adminRidesQuerySchema` | review queue | — | no | admin, moderator |
| A06 | GET `/api/admin/replays` | :73 | `adminReplaysQuerySchema` | replays, including training ones and `rejected` | — | no | admin, moderator |
| A07 | GET `/api/admin/rides/:id` | :78 | `rideIdParamsSchema` | detail with input (RPL-M-07) | — | no | admin, moderator |
| A08 | POST `/api/admin/rides/:id/challenge` | :84 | `actionChallengeBodySchema` | signature text | — | no | admin |
| A09 | POST `/api/admin/rides/:id/verdict` (signed) | :91 | `overrideBodySchema` | manual verdict | **yes** (prize eligibility) | `verdict.override` from/to | admin |
| A10 | POST `/api/admin/rides/:id/rejudge` (signed) | :99 | `rejudgeBodySchema` | rejudge | **yes** | `verdict.rejudge` from/to | admin |
| A11 | GET `/api/admin/signins` | :104 | `signInsQuerySchema` | IPs and browsers (personal data) | — | no | admin |
| A12 | GET `/api/admin/actions` | :109 | `actionsQuerySchema` | audit log | — | no | admin |
| A13 | GET `/api/admin/logs` | :115 | `logsQuerySchema` | 5000 log lines (wallet, IP, paths) | — | no | admin |

#### Directory — `admin-directory.http.controller.ts` (class `AG` :20)
| # | Method and path | Line | Input | Effect | Money | Audit | Role (target) |
|---|---|---|---|---|---|---|---|
| A14 | GET `/api/admin/queue/count` | :25 | — | read | — | no | admin, moderator |
| A15 | GET `/api/admin/players` | :30 | `playersQuerySchema` | read | — | no | admin, moderator |
| A16 | GET `/api/admin/players/:wallet` | :35 | `walletParamsSchema` | player profile (personal data) | — | no | admin |
| A17 | GET `/api/admin/pools` | :40 | `poolsQuerySchema` | read | — | no | admin |
| A18 | GET `/api/admin/pools/:id` | :45 | `poolIdParamsSchema` | read | — | no | admin |
| A19 | GET `/api/admin/stats` | :50 | `adminStatsQuerySchema` | read | — | no | admin |
| A20 | GET `/api/admin/sessions` | :55 | `sessionsQuerySchema` | sessions (personal data) | — | no | admin |

#### Pool payouts — `admin-pools.http.controller.ts` (class `AG` :18)
| # | Method and path | Line | Input | Effect | Money | Audit | Role (target) |
|---|---|---|---|---|---|---|---|
| A21 | GET `/api/admin/pool-payouts` | :25 | — | pool winners | — | no | admin |
| A22 | POST `/api/admin/pools/:id/hold/challenge` | :30 | `poolHoldChallengeBodySchema` | signature text | — | no | admin |
| A23 | POST `/api/admin/pools/:id/hold` (signed) | :35 | `poolHoldBodySchema` | stop or release the autopayout | **yes** | `pool.hold`/`pool.release` (without a "before" state) | admin (+ a second, decision 60) |

#### Promo codes — `admin-promos.http.controller.ts` (class `AG` :22, prefix `api/admin/promos`)
| # | Method and path | Line | Input | Effect | Money | Audit | Role (target) |
|---|---|---|---|---|---|---|---|
| A24 | GET `/api/admin/promos` | :30 | `promosQuerySchema` | read | — | no | admin |
| A25 | GET `/api/admin/promos/redemptions` | :36 | `promoRedemptionsQuerySchema` | who redeemed (personal data) | — | no | admin |
| A26 | POST `/api/admin/promos/challenge` | :42 | `promoChallengeBodySchema` | signature text | — | no | admin |
| A27 | POST `/api/admin/promos` (signed) | :49 | `createPromoBodySchema` | a new code: `tickets` (tickets into a paid pool), `free_rides`, `cosmetic` | **yes** (`tickets`) | `promo.create` | admin (+ a second for `tickets`, decision 60) |
| A28 | POST `/api/admin/promos/:code/disable` (signed) | :54 | `disablePromoBodySchema` | disable the code | indirectly | `promo.disable` (without "before") | admin |

#### Settings and free rides — `admin-settings.http.controller.ts` (class `AG` :20)
| # | Method and path | Line | Input | Effect | Money | Audit | Role (target) |
|---|---|---|---|---|---|---|---|
| A29 | GET `/api/admin/settings` | :27 | — | read | — | no | admin |
| A30 | POST `/api/admin/settings/challenge` | :32 | `settingChallengeBodySchema` (key = `z.string()`, value = `z.number().int()`; the domain checks `SETTING_KEYS`/`SETTING_BOUNDS`) | signature text | — | no | admin |
| A31 | POST `/api/admin/settings` (signed) | :37 | `updateSettingBodySchema` | changes `GameSettings`, including the money keys `referral_referrer_part_bps`, `referral_ride_cap_lamports`, `referral_donation_share_bps` (0…10,000), `referral_donation_cap_lamports` (`game-settings.ts:4-9,53-56`) | **yes** | `setting.update` | admin (+ a second for money keys, decision 60) |
| A32 | POST `/api/admin/players/free-rides/challenge` | :42 | `freeRidesChallengeBodySchema` | signature text | — | no | admin |
| A33 | POST `/api/admin/players/free-rides` (signed) | :47 | `adjustFreeRidesBodySchema` | ± free rides | — | `free_rides.adjust` | admin |

In total the admin has **33 routes** in five controllers. Chat moderation (decision 53) and `set_pool_rules` (B8) are absent from `origin/main` — those are rows P01–P04 below.

#### 3D editor (storybook) — classes `EG`
| # | Method and path | File:line | Input | Effect | Money | Audit | Role |
|---|---|---|---|---|---|---|---|
| E01 | POST `/api/editor/auth/nonce` (pub) | `editor-auth.http.controller.ts:26` | auth DTO | sign-in text | — | no | editor |
| E02 | POST `/api/editor/auth/verify` (pub) | `editor-auth…:31` | auth DTO | editor cookie | — | `editor.signin` | editor |
| E03 | POST `/api/editor/auth/logout` (pub) | `editor-auth…:36` | — | clears the cookie | — | no | editor |
| E04 | GET `/api/editor/me` | `editor-auth…:41` | — | read | — | no | editor |
| E05 | GET `/api/editor/entities` | `editor-entities.http.controller.ts:32` | — | read | — | no | editor |
| E06 | GET `/api/editor/entities/:id` | `editor-entities…:37` | `entityIdParamsSchema` | read | — | no | editor |
| E07 | GET `/api/editor/entities/:id/revisions` | `editor-entities…:42` | the same | read | — | no | editor |
| E08 | GET `/api/editor/revisions/:revId` | `editor-entities…:47` | `revisionIdParamsSchema` | read | — | no | editor |
| E09 | POST `/api/editor/entities/:id/drafts` | `editor-entities…:52` | `draftBodySchema` (≤ 64 KB) | draft | — | a revision with an author, no AdminAction | editor |
| E10 | POST `/api/editor/entities/:id/restore` | `editor-entities…:57` | `restoreBodySchema` | a draft from a revision | — | the same | editor |
| E11 | POST `/api/editor/entities/:id/publish/challenge` | `editor-entities…:62` | `publishChallengeBodySchema` | signature text | — | no | editor |
| E12 | POST `/api/editor/entities/:id/publish` (signed) | `editor-entities…:67` | `publishBodySchema` | publication into the bundle **for all clients** | — | `entity.publish` with `previous` | editor (+ review, decision 59) |
| E13 | POST `/api/editor/jobs` | `editor-jobs.http.controller.ts:28` | `createJobBodySchema` | an AI job (LLM-key spend) | **yes** (USD at the provider) | no | editor |
| E14 | GET `/api/editor/jobs` | `editor-jobs…:33` | `jobsQuerySchema` | read | — | no | editor |
| E15 | GET `/api/editor/jobs/:id` | `editor-jobs…:38` | `jobIdParamsSchema` | read | — | no | editor |
| E16 | GET `/api/editor/jobs/:id/events` | `editor-jobs…:43` | `jobEventsQuerySchema` | read | — | no | editor |
| E17 | POST `/api/editor/jobs/:id/cancel` | `editor-jobs…:48` | `jobIdParamsSchema` | cancel | — | no | editor |

#### MCP callbacks — `editor-mcp.http.controller.ts` (class `MG` :16, internal network only)
| # | Method and path | Line | Input | Effect | Audit |
|---|---|---|---|---|---|
| M01 | GET `/api/editor/mcp/entities` | :23 | — | read | no |
| M02 | GET `/api/editor/mcp/entities/:id` | :28 | id | read | no |
| M03 | GET `/api/editor/mcp/configs` | :33 | — | read | no |
| M04 | POST `/api/editor/mcp/entities/:id/drafts` | :38 | `mcpDraftBodySchema` | a draft on behalf of the job | a revision |

#### Service
| # | Method and path | File:line | Guard | Effect | Note |
|---|---|---|---|---|---|
| S01 | POST `/api/chain/webhook` | `chain-webhook.http.controller.ts:16` | `WG` | checks signatures against the chain | the body is not trusted; only signatures are taken |
| S02 | GET `/api/health/live` | `health.http.controller.ts:11` | none (public) | — | no details |
| S03 | GET `/api/health/ready` | `health.http.controller.ts:17` | none (public) | — | `database up/down` + `latencyMs` |

There are no metrics (`/metrics`) and no dev/debug routes in `origin/main`. Stream-effect flags (`LIVE_CHAT`, `LIVE_DONATIONS`, `LIVE_FREE_DONATIONS`, `LIVE_EFFECTS`, `env.schema.ts:142-145`) are switched only via env; there is no HTTP endpoint. Game endpoints with "power" over someone else's — `POST /api/rides/:id/mutes` (the driver, `live.http.controller.ts:84`) and `POST /api/chain/settle` (no privileges, idempotent, `pools.http.controller.ts:59`) — are covered by [`backend_contract.md`](backend_contract.md), and are not included here.

#### Privileged CLI commands (not HTTP; a shell on the server is required) — `server/src/cli/admin-commands.ts:90-146`
`promo:create|list|disable`, `tickets:grant`, `pool:seed` (refused in production, `:106`), `pool:register`, `pool:crank`, `pool:payout`, `pool:pledges`, `achievement:mint`, `verdict:rejudge` (audit `verdict.rejudge-bulk`), `replay:verify`, `replay:worker`, `pool:attention`, `stats:reconcile`, `retention:sweep`. `tickets:grant` writes a log "audit line" (`grant-tickets.handler.ts:13`), not an `AdminAction` row. The other money CLI commands do not write `AdminAction` rows.

#### Planned (enter with a guard and the matrix from the first commit, ADM-M-21)
| # | Method and path | Source | Role | Money |
|---|---|---|---|---|
| P01 | POST `/api/admin/chat/:eventId/hide` | decision 53, RPL-M-27 | moderator, admin | — |
| P02 | POST `/api/admin/players/:wallet/chat-ban` (to lift — the same path with `{ban:false}`) | decision 53, RPL-M-27 | moderator, admin | — |
| P03 | POST `/api/admin/pools/rules/challenge` + POST `/api/admin/pools/rules` (`set_pool_rules`) | B8, POOL-M-12 | admin + a second (decision 60) | **yes** (chain) |
| P04 | POST `/api/admin/config/challenge` + POST `/api/admin/config` (`set_config` of the program, `pool-program.idl.ts:33`), if it appears over HTTP | IDL v5 | Squads only (decision 60) | **yes** (chain) |

### 1.3 Findings (`origin/main`)
Unguarded routes under `/api/admin/*` and `/api/editor/*` were **not found**: all five admin controllers and all four editor controllers have the guard on the class. A bypass of the action-signature check was also not found.
| id | Severity | Finding | Where | Rule |
|---|---|---|---|---|
| F01 | **High** | An admin, with one signature, sets `referral_donation_share_bps` up to 10,000 — up to 100% of every donation goes to the referrer. Contradicts decision 50 and TERMS 14.3 | `game-settings.ts:55`, A31 | ADM-M-09, RPL-M-16 |
| F02 | **High** | `DEMO_WALLETS` is not checked in production and is passed through from `.env` (`docker-compose.prod.yml:102`). `*` = everyone: paid shifts are shortened for everyone (`demo.ts:4`, `pool-tickets.service.ts:33`), and this affects the ranking and the prizes | `env.schema.ts:58`, `rules-config.adapter.ts:20` | ADM-M-13 |
| F03 | Medium | All startup and protection checks turn on only when `NODE_ENV === 'production'`, strictly (`env.service.ts:22`, `env.schema.ts:163`). On `staging`/`prod`, `localSignIn` turns on (`rules-config.adapter.ts:21`), the admin-host wall comes down (no `COOKIE_DOMAIN`), the cookie has no `Secure`, and `EDITOR_FAKE_LLM` is allowed | same place | ADM-M-13 |
| F04 | Medium | `ADMIN_JWT_SECRET` and `EDITOR_JWT_SECRET` are optional and are derived from `JWT_SECRET` (`env.service.ts:36`). A leak of the game secret = a forged admin session for any allowlist wallet: reading personal data and logs. Changes are still closed by the action signature | `env.schema.ts:105,111` | ADM-M-05 |
| F05 | Medium | There is no global default-deny: the guard is set on the class by hand. A new controller under `api/admin` without `@UseGuards` will be open. There is no guard-coverage meta-test (there are `admin.guard.spec.ts` and `admin-host.spec.ts`, but no enumeration of routes) | all controllers, `app.module.ts:48` | ADM-M-02 |
| F06 | Medium | There is no `.strict()` in the admin and editor schemas: extra fields are dropped silently. Contradicts B3 / API-M-03. The setting key is a free string | `presentation/admin/dto/*.ts`, `admin-settings.dto.ts:6-7` | ADM-M-09 |
| F07 | Medium | There is no role split inside the admin: anyone in `ADMIN_WALLETS` both changes money and sees IPs. There is no moderator role for decision 53 | `admin.guard.ts:41` | ADM-M-03 |
| F08 | Medium | Money and chain actions (A09/A10 on a paid ride, A23, A27 `tickets`, A31 money keys) — one signature of one admin, with no second confirmation and no delay | 1.2 | ADM-M-07 |
| F09 | Medium | Audit: "append-only" is only in words (no trigger and no revocation of `UPDATE`/`DELETE` for the DB role). There is no "before" state for `pool.hold`/`promo.disable`. Failed sign-ins are only in the log. Not audited: logout, E13 (LLM spend), E17, money CLI commands | `admin.prisma:2-13`, `verify-admin-signin.handler.ts:37-39` | ADM-M-11, ADM-M-19 |
| F10 | Medium | There are no alerts on an admin sign-in or on changes | — | ADM-M-12 |
| F11 | Medium | An editor's publication, with one signature, goes into the bundle of all clients (supply chain). A check of the source for dangerous constructs was not reconciled within this task | E12, `publish-revision.handler.ts:16` | ADM-M-20 |
| F12 | Low | `/api/admin/auth/*` does not fall into the `auth` budget: only `default` 600/min per IP (`throttling.ts:16`). The admin nginx site has no `limit_req` (storybook has one) | `throttling.ts:16`, `admin.conf.template` | ADM-M-10 |
| F13 | Low | `auth/nonce` answers 200 for an admin wallet and 404 for the rest — enumeration can learn who is an admin. Each call replaces the pending nonce, so an admin's sign-in can be disrupted (mitigated by basic auth) | `request-admin-challenge.handler.ts:73,77` | ADM-M-04, ADM-M-10 |
| F14 | Low | Logout only clears the cookie; the token stays valid until the end of the TTL (default 120 min, maximum 1440). Revocation is only by removing the wallet from the allowlist | `admin-cookie.interceptor.ts:37`, `env.schema.ts:107` | ADM-M-05 |
| F15 | Low | `GET /api/admin/logs` returns raw log lines (wallet, IP) with no redaction policy and no role | A13, `log-ring.ts` | ADM-M-16 |
| F16 | Low | `LIVE_EFFECTS` defaults to `all` (`env.schema.ts:145`). The production compose sets `free` (`:139`), but there is no startup check. Per RPL-M-17 the effects are removed | `env.schema.ts:145` | ADM-M-13 |
| F17 | Info | `OriginGuard` lets a mutating request without `Origin` through (`origin.guard.ts:140`). For the admin, protection rests on `SameSite=Strict` + `X-FC-Admin` | — | ADM-M-15 |
| F18 | Info | Good: 404 on every refusal (B9), a host wall by `Host`, a signature on every action (domain, TTL, single use by an atomic `DELETE … RETURNING`), a repeated allowlist check on every request, loopback, basic auth, a webhook secret compared in constant time | 1.1 | — |

### 1.4 Rules
- **ADM-M-01** MUST: every privileged route has a row in registry 1.2 and in the route registry of [`backend_contract.md`](backend_contract.md) §4.2 (surface, role, guard, input schema, effect, money, audit). A route without a row fails CI (ADM-T-40).
- **ADM-M-02** MUST (decision 61): **default-deny by prefix**. The global `APP_GUARD` `PrivilegedSurfaceGuard` requires an admin session for `/api/admin/*`, an editor session for `/api/editor/*` (except `mcp/`), and a job token for `/api/editor/mcp/*`. The guard on the class remains the second lock. There are exactly 6 public exceptions: A01–A03 and E01–E03, by an explicit list. A route under the prefix without a guard → the application does not start.
- **ADM-M-03** MUST (decision 59): **least-privilege roles** — `admin`, `moderator`, `editor` (allowlists `ADMIN_WALLETS`, `MODERATOR_WALLETS`, `EDITOR_WALLETS`; one wallet may be in several). The role for a route is the "Role (target)" column in 1.2; on the route, an `@Roles()` decorator:
  - `moderator`: A01–A07, A14, A15, and chat moderation P01/P02 (decision 53). In A15 and A07, personal data (IP, browser, sessions) is hidden;
  - `admin`: everything in `/api/admin/*`;
  - `editor`: only `/api/editor/*`.
  
  The `editor` role does not open the admin, and `admin` and `moderator` do not open the editor.
- **ADM-M-04** MUST: sign-in is an SIWS message with the `domain` and `URI` of its own surface, a nonce of ≥ 16 bytes, and a TTL of ≤ 5 min. The nonce is single-use and is consumed atomically on the first attempt. The allowlist is checked on issue, on verification, and on every request. The `auth/nonce` response does not distinguish an admin wallet from a foreign one: always `200`; for a foreign one the nonce is a dummy and verification returns `401` (decision 65). Pending nonces are stored by the key (wallet, client), so a foreign request does not consume the admin's sign-in.
- **ADM-M-05** MUST (decisions 62, 63): the session is a separate cookie of the surface (`httpOnly`, `SameSite=Strict`, `Secure`, `Path` of the surface, no `Domain`). `ADMIN_JWT_SECRET` and `EDITOR_JWT_SECRET` are required in production and are equal neither to `JWT_SECRET` nor to each other. The session TTL is ≤ 60 min, with no renewal. The token has a `jti`; logout and removal from the allowlist revoke it on the server (a revocation list).
- **ADM-M-06** MUST: **every change is signed separately:**
  - `…/challenge` issues text that describes exactly this change (the action, the target, the new values, the surface domain, a nonce, an expiry);
  - one pending signature per admin;
  - the signature is consumed on the first attempt;
  - expiry, a repeat, another wallet's signature, text about a different change, or a signature from another surface → `401`, and there is no change.
- **ADM-M-07** MUST (decision 60): **money and the chain — two steps.** The mode is set by `ADMIN_APPROVAL_MODE=single|dual`: in strict mode, when `PAYMENT_MODE=program` with paid pools, or on mainnet, only `dual` is allowed. The action is marked `money` in 1.2 (A09/A10 on a paid ride, A23, A27 `tickets`, A31 with a money key, P03, P04). On the devnet launch — one admin's signature plus an alert (ADM-M-12). For paid pools and mainnet — a second admin confirms their signature over the same text within 30 min (`pending_approval` → `applied`). One cannot confirm one's own request. `set_config` and `set_pool_rules` on the chain are Squads multisig only (`team_recipient`, [`OPEN.md`](OPEN.md)).
- **ADM-M-08** MUST: **idempotency and races.** A change is applied at most once: a repeat of the same signature → `401` with no effect; parallel changes of one target → one is applied, the other is `409 conflict` (per B4, API-M-04). The `requestId` and the signature in the audit are unique.
- **ADM-M-09** MUST: **strict input** (B3, API-M-03): every admin and editor schema is `.strict()` (an extra field → `400`). A setting `key` is `z.enum(SETTING_KEYS)`. Texts (note, message) have a length limit. The key `referral_donation_share_bps` is removed (decision 50, RPL-M-16). For money keys the bounds are tightened, and ADM-M-07 applies.
- **ADM-M-10** MUST (decision 65): **limits:**
  - `/api/admin/auth/*` — the `auth` budget (30/min + 5/s per IP);
  - changes — ≤ 30/min per admin;
  - reads — `default`;
  - nginx `limit_req` on the admin site, as on storybook.
  
  Exceeding → `429` with `Retry-After`.
- **ADM-M-11** MUST (decision 64): **audit.** An `AdminAction` row for:
  - every change: who, the action, the target, **before**, **after**, the signature, requestId, IP, time;
  - every sign-in (successful and failed) and logout;
  - personal-data reads: A11, A13, A16, A20, A25 (`read.*`, without the response body).
  
  The table is append-only at the DB level: the application role has no `UPDATE`/`DELETE`, plus a deny trigger. Retention is ≥ 2 years. Sent and unsent alerts (ADM-M-12) live in the same schema, table `admin.AlertOutbox`.
- **ADM-M-12** MUST (decision 64): **alerts to Telegram.**
  - **Channel:** the Telegram Bot API `sendMessage` into the owner's chat. Secrets only via env: `ADMIN_ALERT_TELEGRAM_BOT_TOKEN` and `ADMIN_ALERT_TELEGRAM_CHAT_ID` (in `deploy/.env` on the server; empty in `deploy/.env.example`). The token is absent from the repository, the logs, the API responses, and the send itself (except the request URL to `api.telegram.org`).
  - **Events:**
    - a sign-in and a failed sign-in of an admin, a moderator, or an editor;
    - 5 failed sign-ins in 10 min from one IP or against one wallet;
    - any change (A09/A10/A23/A27/A28/A31/A33, E12, P01–P04, CLI per ADM-M-19); with `money` — marked `💰 MONEY`;
    - `pending_approval` and its outcome;
    - session revocation.
  - **Text:** the environment (`devnet`/`mainnet`), the action, the target, a short wallet (`Abcd…wxyz`), "before → after" for settings, `requestId`, the time in UTC. No full IP (only /24), no signatures, tokens, cookies, or player notes longer than 80 characters.
  - **Delivery:** first a row in `admin.AlertOutbox` in the same transaction as the audit; then a send with a timeout of 5 s.
  - **Fallback if Telegram is unavailable** (a network error, `5xx`, `429` with `retry_after`, a bad token):
    - the change is **not blocked**;
    - the row stays `pending` and is retried with an exponential pause (30 s → 30 min) for up to 24 h, then marked `undelivered`;
    - every failure is an `error` log `admin-alert.undelivered` (without the token); it is visible in `npm run ops -- logs` and in A13;
    - the admin page shows the banner "N alerts undelivered" (a new field `undeliveredAlerts` in A04 `overview`);
    - for `pending_approval` (ADM-M-07), confirmation stays possible even without delivery.
  - **Startup:** in strict mode, with non-empty `ADMIN_WALLETS`/`MODERATOR_WALLETS`/`EDITOR_WALLETS`, startup fails without both variables (ADM-M-13).
- **ADM-M-13** MUST NOT (decision 62): **no dev bypasses in production.** Strict mode turns on for any `NODE_ENV` other than `development` and `test`. Startup fails if:
  - `DEMO_WALLETS` is non-empty;
  - `EDITOR_FAKE_LLM=1`;
  - `LIVE_FREE_DONATIONS=on`;
  - `LIVE_EFFECTS≠off` (RPL-M-17);
  - there is no `COOKIE_DOMAIN` when the allowlists are non-empty;
  - there is no `ADMIN_JWT_SECRET`/`EDITOR_JWT_SECRET`, or they match `JWT_SECRET`;
  - there is no `TRUST_PROXY`;
  - there is no `ADMIN_ALERT_TELEGRAM_BOT_TOKEN`/`ADMIN_ALERT_TELEGRAM_CHAT_ID` when the allowlists are non-empty (ADM-M-12);
  - `ADMIN_SESSION_TTL_MINUTES` > 60 (decision 63);
  - `ADMIN_APPROVAL_MODE=single` with paid pools (ADM-M-07);
  - on mainnet there is no `ADMIN_IP_ALLOWLIST` (ADM-M-17).
  
  `localSignIn` is always off in strict mode.
- **ADM-M-14** MUST: **refusal codes** (aligned with B9 / API-M-07):
  - no session, a foreign host, a game session, a wallet outside the allowlist, an expired or forged token → `404` with an identical body;
  - a surface session exists, but the role is wrong → `403 forbidden_role`;
  - no `X-FC-Admin`/`X-FC-Editor`, or a foreign `Origin` → `403`;
  - the action signature is wrong, expired, or repeated → `401`;
  - the body does not match the schema → `400`;
  - a race → `409`;
  - a limit → `429`.
- **ADM-M-15** MUST: **CORS/CSRF.** On the admin and storybook hosts there is no `Access-Control-Allow-*` for any foreign Origin. A change requires the surface header. `Origin: null` → `403`. A foreign `Origin` → `403`. A request without `Origin` passes only with the surface header and a `SameSite=Strict` cookie.
- **ADM-M-16** MUST NOT: **leaks:**
  - responses never contain secrets, tokens, keys, or a stack trace;
  - a `500` is a generic `problem+json` with `requestId`;
  - the log does not write a cookie, `Authorization`, `x-fc-job`, `x-webhook-secret`, signatures, or `ADMIN_ALERT_TELEGRAM_BOT_TOKEN` (including in Telegram HTTP-client error URLs);
  - `GET /api/admin/logs` masks the IP to /24 (IPv6 /48) — except the `admin` role with an explicit `?full=1`, which is audited.
- **ADM-M-17** MUST (decision 66): **network.** The admin is reachable only through `admin.<apex>` behind nginx basic auth. The application listens on loopback. A direct request to the application with `Host: admin.<apex>` from a non-loopback address → `404`. On mainnet, `ADMIN_IP_ALLOWLIST` (IP/CIDR, like `EDITOR_IP_ALLOWLIST`) is required: without it startup fails; an IP outside the list → `404`. On devnet it is optional.
- **ADM-M-18** MUST: **machine routes:**
  - webhook: a secret of ≥ 16 characters, constant-time comparison; no secret → `404`, a wrong one → `401`;
  - MCP: internal network only, the job is `running`, the wallet is in `EDITOR_WALLETS`; otherwise `404`;
  - health returns only the status and the latency, with no versions, hosts, or error text.
- **ADM-M-19** MUST: **CLI.** A mutating or money CLI command writes an `AdminAction` with `wallet = cli:<OS user>` and the arguments. Dev commands (`pool:seed`, `db:reset`) refuse in strict mode. Money CLI commands (`pool:payout`, `tickets:grant`) follow ADM-M-07 on mainnet.
- **ADM-M-20** MUST (decision 59): **editor.** Publication is signed separately and is audited with `previous`. On devnet — one editor signature plus an alert. Before mainnet a review is required: the publication moves to `pending_review` and is applied after a second editor's or an admin's signature; one cannot confirm one's own publication. Creating and cancelling an AI job are audited; the job is limited by the settings `editor_jobs_per_day`/`editor_jobs_parallel`. An editor session does not open the admin, and vice versa (ADM-T-04).
- **ADM-M-21** MUST: **new privileged routes** (P01–P04 and everything that arrives with PR #3 and later) enter with a guard, a role, a registry row, and the ADM-T-01…12 matrix in the same PR. The gate of [`backend_contract.md`](backend_contract.md) API-M-04 for them: ≥ 4 negatives + ≥ 1 race or repeat test.

## Part 2. Test plan
Levels: **U** — unit (vitest), **H** — HTTP via `supertest` on the built application (`server/test/http`), **I** — integration with Postgres/Redis (`server/test/integration`), **M** — manual. Files (plan): `server/test/security/admin/*.spec.ts`, `server/test/security/admin/*.integration.spec.ts`.
**npm scripts (plan, `server/package.json`):** `test:admin-security` = `vitest run test/security/admin` (U + H); `test:admin-security:integration` = `vitest run --config vitest.integration.config.ts test/security/admin` (I: races, DB audit). In CI — an `admin-security` job on every PR, required.

### 2.1 Matrix for every registry route (generated from 1.2)
The test generator takes the route list from `route-manifest` (API-T, [`backend_contract.md`](backend_contract.md) §4.2) with the fields `surface`, `role`, `mutating`, `signed`, `money`. For each row A01–A33, E01–E17, M01–M04, and S01, and then for P01–P04 after they appear, the applicable checks are run:
| id | Level | Check | Expectation |
|---|---|---|---|
| ADM-T-01 | H | no cookie | `404`, a body identical to a nonexistent route |
| ADM-T-02 | H | a regular player's game session; the game session of an **admin wallet** | `404` |
| ADM-T-03 | H | a valid admin session, but `Host: api.<apex>`; a forged `X-Forwarded-Host: admin.<apex>` | `404` |
| ADM-T-04 | H | a surface session with a role not in the "Role" column (moderator → A31; editor → A04; admin → E05) | `403 forbidden_role` on its own surface; on a foreign one — `404` |
| ADM-T-05 | H | an expired token; a token signed with the player's `JWT_SECRET` or with `EDITOR_JWT_SECRET`; a token with a foreign `aud`; a revoked `jti` | `404` |
| ADM-T-06 | H | a mutating route without `X-FC-Admin`/`X-FC-Editor` | `403` |
| ADM-T-07 | H | a valid session of the required role | `2xx`, the body passes the response zod schema (B2, API-M-02) |
| ADM-T-08 | H | an extra field in the body/query (`{…, "isAdmin": true}`) | `400 validation_error` |
| ADM-T-09 | H | `Origin: https://evil.example`; `Origin: null`; a neighboring `https://<apex>` | `403 bad_origin`; a response without `Access-Control-Allow-*` |
| ADM-T-10 | H | a mutating route, signature success and refusal | exactly one `AdminAction` row with `before`/`after`/`requestId`/`ip` (success); no row, and `auth.fail` or `action.denied` is present (refusal) |
| ADM-T-11 | H | exceeding the route limit (ADM-M-10) | `429` + `Retry-After` |
| ADM-T-12 | H | a signed route: the signature is expired, repeated, from another wallet, or the text is about another value | `401`, the target's state did not change |

### 2.2 Sign-in and session
| id | Rule | Level | Check | Expectation |
|---|---|---|---|---|
| ADM-T-20 | M-04 | U, H | `auth/nonce` for an admin and for a foreign wallet | both `200`, messages of one shape; the foreign `verify` → `401` |
| ADM-T-21 | M-04 | U | the sign-in message | `domain` = the admin host, `URI` = the admin origin, nonce 32 hex, `Expiration Time` ≤ 5 min |
| ADM-T-22 | M-04 | I | two `verify` calls with one signature in parallel | one `200`, the second `401` (`DELETE … RETURNING`) |
| ADM-T-23 | M-04 | H | a foreign client requests a nonce for the admin wallet between the admin's steps | the admin's sign-in succeeds (nonce keyed by wallet + client) |
| ADM-T-24 | M-04, M-05 | H | the wallet is removed from `ADMIN_WALLETS` between the steps and after sign-in | `404` on `verify` and on the next request |
| ADM-T-25 | M-05 | H | logout, then the old cookie | `404` (`jti` revoked) |
| ADM-T-26 | M-05 | U | cookie attributes | `httpOnly`, `SameSite=Strict`, `Secure`, `Path=/api/admin`, no `Domain`; lifetime ≤ 60 min |
| ADM-T-27 | M-05 | U | `ADMIN_SESSION_TTL_MINUTES=61` in strict mode | startup fails |
| ADM-T-28 | M-11 | H | a failed sign-in and logout | rows `auth.fail` (IP, reason) and `auth.logout` |

### 2.3 Signed actions, money, idempotency
| id | Rule | Level | Check | Expectation |
|---|---|---|---|---|
| ADM-T-30 | M-06 | U | the signature text of A08/A22/A26/A30/A32/E11 | contains the action, the target, the new values, the surface domain, a nonce, and an expiry |
| ADM-T-31 | M-06 | H | an `editor`-surface signature for an admin action, and the reverse | `401` |
| ADM-T-32 | M-06 | H | a new `challenge` before the old one is signed | the old signature → `401` |
| ADM-T-33 | M-07 | H | A31 with a money key, mainnet profile: the first admin's signature | `202 pending_approval`, the value did not change; an alert was sent |
| ADM-T-34 | M-07 | H | confirmation by the same admin; by another after 31 min; by another in time | `403`; `401 expired`; `200 applied`, both wallets in the audit |
| ADM-T-39 | M-07 | U | `ADMIN_APPROVAL_MODE` × profile (devnet without paid / paid pools / mainnet) | `single` is allowed only on devnet without paid pools |
| ADM-T-35 | M-07 | H | the devnet profile | one signature → `200` + a `money` alert |
| ADM-T-36 | M-09 | H | `POST /api/admin/settings` with `referral_donation_share_bps` | `400 bad_setting`; the key is absent from `GET /api/admin/settings` (link to RPL-T-100) |
| ADM-T-37 | M-09 | U | a setting `key` outside `SETTING_KEYS` | `400` at the schema level, before the signature is issued |
| ADM-T-38 | M-08 | I | the same A09 signature twice in parallel | one `200`, the second `401`; one audit row |

### 2.4 Meta-tests
| id | Rule | Level | Check | Expectation |
|---|---|---|---|---|
| ADM-T-40 | M-01, M-02 | U | **guard coverage:** on application load, `DiscoveryService` enumerates every route; every path `^/api/(admin|editor)(/|$)` must have the required guard (class metadata or the global `PrivilegedSurfaceGuard`) and a registry row; `@AdminPublic`/`@EditorPublic` — only on the 6 allowed | the test fails on any mismatch; the message names the route |
| ADM-T-41 | M-02 | H | a test module adds a controller `api/admin/__probe` **without** `@UseGuards` | the global guard → `404` for everyone; startup in strict mode fails (ADM-M-02) |
| ADM-T-42 | M-01 | U | registry 1.2 ↔ `route-manifest` | the same sets (the document generator) |
| ADM-T-43 | M-03 | U | the role table ↔ `@Roles()` metadata | they match |
| ADM-T-44 | M-03 | H | `moderator`: A04–A07, A14, A15, P01/P02 → `2xx`; A07/A15 have no IP, browser, or sessions; A11/A13/A16/A20/A23/A27/A31 → `403 forbidden_role` | as in the table |

### 2.5 Production configuration
| id | Rule | Level | Check | Expectation |
|---|---|---|---|---|
| ADM-T-50 | M-13 | U | `validateEnv` in strict mode, one bad flag at a time: `DEMO_WALLETS=*`, `DEMO_WALLETS=<wallet>`, `EDITOR_FAKE_LLM=1`, `LIVE_FREE_DONATIONS=on`, `LIVE_EFFECTS=free`, no `COOKIE_DOMAIN`, a missing or equal `ADMIN_JWT_SECRET`, the same for `EDITOR_JWT_SECRET`, no `TRUST_PROXY`, no Telegram variables, `ADMIN_SESSION_TTL_MINUTES=61`, `ADMIN_APPROVAL_MODE=single` with paid pools, mainnet without `ADMIN_IP_ALLOWLIST` | for each — a startup error naming the key |
| ADM-T-51 | M-13 | U | `NODE_ENV=staging`, `prod`, `Production` | strict mode is on (as `production`) |
| ADM-T-52 | M-13 | U | strict mode | `rules.localSignIn=false`, cookie `Secure` |
| ADM-T-53 | M-13 | U | `deploy/docker-compose.prod.yml` + `deploy/.env.example` | none of the dev flags from ADM-T-50 by default (a grep test) |

### 2.6 Races (B4, API-M-04)
| id | Rule | Level | Check | Expectation |
|---|---|---|---|---|
| ADM-T-60 | M-08 | I | two admins at once: override and rejudge of one ride | one is applied, the second is `409`; the verdict agrees with the audit |
| ADM-T-61 | M-08 | I | hold and release of one pool in parallel; a hold while `pool-payout.scheduler` is running | the outcome is deterministic; there is no payout under `hold` |
| ADM-T-62 | M-08 | I | two `settings` of one key in parallel | the last by the audit equals the value in the DB; the second's `before` = the first's `after` |
| ADM-T-63 | M-08 | I | two `promos` with one code in parallel | one `200`, the second `409` |
| ADM-T-64 | M-08 | I | `free-rides` +3 and −2 in parallel | the outcome is +1, two audit rows |
| ADM-T-65 | M-07, M-08 | I | two confirmations of one `pending_approval` | one `applied`, the second `409` |

### 2.7 Audit, alerts, leaks, network
| id | Rule | Level | Check | Expectation |
|---|---|---|---|---|
| ADM-T-70 | M-11 | I | `UPDATE`/`DELETE` on `admin."AdminAction"` by the application role | a permissions / trigger error |
| ADM-T-71 | M-11 | H | reads of A11, A13, A16, A20, A25 | a `read.*` row without the response body |
| ADM-T-72 | M-12 | H | fake Telegram (`nock` on `api.telegram.org`): a sign-in, a failed sign-in, an A31 change of a money key, 5 failed sign-ins, `pending_approval` | one `sendMessage` each to `ADMIN_ALERT_TELEGRAM_CHAT_ID`; the money one has `💰 MONEY` and "before → after" |
| ADM-T-73 | M-16 | H | run matrix 2.1 and collect every response body | not one secret value from the test env, no `stack`, no tokens |
| ADM-T-74 | M-16 | U | `requestLogMiddleware` and `JsonLogger` on a request with a cookie, `Authorization`, `x-fc-job`, `x-webhook-secret`, and a signature | they are absent from the log line |
| ADM-T-75 | M-16 | H | `GET /api/admin/logs` and `?full=1` | the IP is masked; `full` — admin only, and with an audit |
| ADM-T-76 | M-15 | H | a preflight `OPTIONS` from a foreign Origin to the admin host | no `Access-Control-Allow-Origin` |
| ADM-T-77 | M-17 | H | a direct request to the application (not loopback) with `Host: admin.<apex>` | `404` |
| ADM-T-78 | M-17 | H | `ADMIN_IP_ALLOWLIST` is set, and the IP is outside the list | `404` |
| ADM-T-88 | M-12 | H, I | Telegram answers `500`, then a timeout, `429 retry_after=7`, `401` (a bad token) | the change is `200`; the `AlertOutbox` row goes `pending` → a scheduled retry (taking `retry_after` into account) → `sent`; after 24 h — `undelivered`; a log `admin-alert.undelivered` without the token; `overview.undeliveredAlerts` = N, the banner is visible |
| ADM-T-89 | M-12, M-16 | U | the alert text and every log of the ADM-T-72/88 run | no bot token, no signatures, no cookies, no full IP; the wallet is shortened |
| ADM-T-90 | M-12, M-13 | U | strict mode, the allowlist is non-empty, there is no `ADMIN_ALERT_TELEGRAM_BOT_TOKEN` or `…_CHAT_ID`; `deploy/.env.example` | startup fails naming the key; the values in `.env.example` are empty; there are no tokens in the repository (grep `\d{8,10}:[A-Za-z0-9_-]{35}`) |
| ADM-T-91 | M-12, M-11 | I | the audit and the outbox in one transaction: the change is rolled back | there is neither an audit row nor an alert |
| ADM-T-79 | M-10 | H | 31 `auth/nonce` in a minute from one IP; 31 changes in a minute by one admin | `429` on the 31st |

### 2.8 Machine routes, CLI, editor
| id | Rule | Level | Check | Expectation |
|---|---|---|---|---|
| ADM-T-80 | M-18 | U, H | webhook: the secret is unset / wrong / correct in `x-webhook-secret` / `Bearer` | `404` / `401` / `200` / `200` |
| ADM-T-81 | M-18 | H | MCP: with `X-Forwarded-For`; the job is not `running`; the job is older than the timeout; the wallet is removed from `EDITOR_WALLETS` | `404` |
| ADM-T-82 | M-18 | H | `GET /api/health/ready` when the DB is down | `503`, the body contains only `database: down` |
| ADM-T-83 | M-19 | U | `tickets:grant`, `promo:create`, `pool:payout`, `verdict:rejudge` from the CLI | an `AdminAction` row with `cli:<user>` and the arguments |
| ADM-T-84 | M-19 | U | `pool:seed`, `db:reset` in strict mode | code 1, the DB is untouched |
| ADM-T-85 | M-20 | H | `POST /api/editor/jobs` and `…/cancel` | audit rows `editor.job.create`/`cancel`; a job past `editor_jobs_per_day` → `429` |
| ADM-T-86 | M-20 | H | a publication with a repeated signature; without a signature | `401`; an `entity.publish` audit with `previous` on the successful one |
| ADM-T-92 | M-20 | H | mainnet profile: editor A's publication → `pending_review`; confirmation by A themselves; by editor B; by an admin | `403`; `200 applied`; `200 applied`; the bundle changes only after confirmation; an alert on both steps |
| ADM-T-87 | M-21 | U | a new `api/admin/*` route with no registry row or no matrix | ADM-T-40 / ADM-T-42 fail |

### 2.9 Manual
| id | What | Steps | Expectation |
|---|---|---|---|
| M-ADM-01 | A pentest checklist on staging | `curl` to the server IP with `Host: admin.<apex>` on 80/443 (the nginx default_server); basic auth wrong / correct; `X-Forwarded-Host`; a session from the api host | nginx `401` without a password; the application answers only through `admin.<apex>` |
| M-ADM-02 | Squads for `set_config` / `set_pool_rules` (P03/P04) | a proposal in Squads, 2 signatures, execution | without 2 signatures nothing on the chain changes |

### Traceability
| Rule | Tests | Gap in the code (`origin/main`) |
|---|---|---|
| ADM-M-01 | T-40, T-42 | no `route-manifest` (the API-T plan, [`backend_contract.md`](backend_contract.md) §4.2) |
| ADM-M-02 | T-40, T-41, T-01 | no global guard (F05) |
| ADM-M-03 | T-04, T-43, T-44 | there are no roles (F07) |
| ADM-M-04 | T-20 … T-24 | the nonce distinguishes wallets and is replaced by anyone (F13) |
| ADM-M-05 | T-05, T-24 … T-27 | secrets are derived (F04), no `jti`/revocation (F14), TTL 120 |
| ADM-M-06 | T-12, T-30 … T-32 | — (present) |
| ADM-M-07 | T-33 … T-35, T-39, T-65, M-ADM-02 | there is no second confirmation (F08) |
| ADM-M-08 | T-38, T-60 … T-65 | check `409` on races |
| ADM-M-09 | T-08, T-36, T-37 | no `.strict()` (F06), the donation-share key exists (F01) |
| ADM-M-10 | T-11, T-79 | no `auth` budget for the admin, no `limit_req` (F12) |
| ADM-M-11 | T-10, T-28, T-70, T-71, T-91 | no "before", no refused sign-ins, no reads, no DB protection (F09) |
| ADM-M-12 | T-72, T-88 … T-91 | there are no alerts (F10); the owner sets up the Telegram bot and chat |
| ADM-M-13 | T-50 … T-53, T-90 | `DEMO_WALLETS` (F02), `NODE_ENV` (F03), `LIVE_EFFECTS` (F16) |
| ADM-M-14 | T-01 … T-06, T-12 | `403 forbidden_role` is new |
| ADM-M-15 | T-09, T-76 | — (present) |
| ADM-M-16 | T-73 … T-75, T-89 | there is no log masking (F15) |
| ADM-M-17 | T-77, T-78, M-ADM-01 | no `ADMIN_IP_ALLOWLIST` |
| ADM-M-18 | T-80 … T-82 | — (present) |
| ADM-M-19 | T-83, T-84 | CLI without `AdminAction` (F09) |
| ADM-M-20 | T-85, T-86, T-92, T-04 | no audit of jobs and no publication review (F09, F11) |
| ADM-M-21 | T-87, matrix T-01 … T-12 | P01–P04 are not there yet |

In total: 21 rules (20 MUST, 1 MUST NOT); decisions 59–66 are the target until [`PRODUCT.md`](PRODUCT.md) writes them as shipped. Planned ids: ADM-T-01…12, 20…28, 30…39, 40…44, 50…53, 60…65, 70…79, 80…92, and 2 manual M-ADM-01/02. An id is not a written test. Matrix 2.1 is a plan of checks, not the current run. The executable bar is [`../testing/COVERAGE_CONTRACT.md`](../testing/COVERAGE_CONTRACT.md).
