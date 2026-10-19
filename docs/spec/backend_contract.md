# Backend contract — spec and test plan

> Every HTTP route: request and response schema, access, a positive and a negative. Backend decisions 1–10 (accepted 17.10.2026). The full plan is Appendix A (the former `backend_test_plan.md` (superseded, merged into docs/spec), text unchanged): an inventory of 151 routes, a coverage map, the approach, and a catalog of negatives.

## Part 1. Spec
### 1.1 Currently in the code (`origin/main`)
- 151 routes on `origin/main` after the PR #3 merge: `POST /api/auth/guest` and `GET /api/prize/board` were added to the previous 149. `auth/pair` (3) and `referrals` (3) from main are kept.
- Input is checked with zod (`ZodBody/ZodParams/ZodQuery`); response schemas are **absent** (0 / 151).
- 58 / 96 protected routes have no "no access" test.
- Polling only, no WebSocket/SSE. One webhook (`POST /api/chain/webhook`).

### 1.2 Rules
- **API-M-01** MUST: schemas — in zod, next to the DTO. `openapi.json` — a derived artifact (decision 1).
- **API-M-02** MUST: every route has `@ZodResponse`. A response-schema violation: test/dev → 500 and the test fails; production → warn (`RESPONSE_SCHEMA_CHECK=off|warn|strict`, decision 2).
- **API-M-03** MUST (detail for admin/editor — [`admin_security.md`](admin_security.md) ADM-M-09; on `origin/main` `.strict()` is nowhere, finding F06): extra input fields — `.strict()` (400) for admin, editor, and money routes (`tickets`, `rides`, `promo`, `referrals`, `pledges`, `donations`, `chain/*`). For `telemetry` and `client-error` — drop them silently (decision 3).
- **API-M-04** MUST: the gate — ≥ 1 positive and ≥ 2 negatives per route (at least one business negative). For money routes and admin — ≥ 4 negatives and ≥ 1 race or repeat test. For the first 2 weeks the gate only reports (decision 4). For admin/editor routes the gate is closed by the [`admin_security.md`](admin_security.md) 2.1 matrix (`npm run test:admin-security`, `test:admin-security:integration`).
- **API-M-05** MUST: the registry `test/contract/routes.manifest.ts` matches the real routes (`DiscoveryService`). The access class matches the guards (Appendix A §4.2).
- **API-M-06** MUST: an error response — `ProblemDetails` with `code ∈ errorCodes` of the route, and no 5xx on invalid input.
- **API-M-07** MUST: **someone else's resource — `404` everywhere**, not `403`, with no difference in the response text (decision 9). This covers replays too: a hidden ride → `404` ([`replays_streams.md`](replays_streams.md)).
- **API-M-08** MUST: geo with no `CF-IPCountry` — fail-closed (ranked refusal). For development — the `PRIZE_DEV_DEFAULT_COUNTRY` flag (decision 7).
- **API-M-09** MUST: `set_pool_rules` has an admin HTTP route (decision 8).
- **API-M-10** MUST: schemathesis — nightly and by hand. fast-check — immediately, for money and windows (decision 5).
- **API-M-11** MUST: tests live in `server/test/contract` and `server/test/scenarios`; docker-smoke and block 2 — in `e2e/` of PR #5 (decision 6). There is no separate line-coverage threshold beyond `test:census` (decision 10).
- **API-M-12** MUST: side effects are checked with `expectDbDelta`; ledger invariants — after every scenario (Appendix A §4.6).
- **API-M-13** MUST: new routes from the specifications enter the registry on the first commit (privileged ones also enter the [`admin_security.md`](admin_security.md) 1.2 registry, with the ADM-T-01…12, ADM-M-21 matrix):
  - `GET /api/me/donations` (RPL-M-18);
  - `GET /api/pools/:id/results` (RID-M-19);
  - `POST /api/admin/chat/:eventId/hide` (RPL-M-27);
  - admin `set_pool_rules` (POOL-M-12).
  
  Routes being removed (`effects/:eventId/applied`, `watch/:id/honk/time`, `/honk/weather`) are removed from the registry; the `404` test stays. Pledge routes stay in the registry, but on a devnet launch they respond `403 pledges_disabled` (RPL-M-33, decision 51).

## Part 2. Test plan
Tests follow Appendix A: §4.3 (a contract check of the existing tests), §4.4 (matrix A — generated negatives for access, CSRF/CORS, the body, params/query), §4.5 and §5 (business negatives), §4.7 (fuzz/property). Summary ids:
| id | Rule | What |
|---|---|---|
| API-T-01 | M-01 | `openapi.json` is generated from zod; the CI diff is empty |
| API-T-02 | M-02 | `checkedAgent()`: all ≈ 358 existing HTTP cases pass the response schema |
| API-T-03 | M-03 | an extra field on a money route → 400; on `telemetry` → 200 without the field |
| API-T-04 | M-04 | `route-manifest.spec.ts`: per-route case thresholds |
| API-T-05 | M-05 | a route with no entry, or a guard that does not match → failure |
| API-T-06 | M-06 | `negative-matrix.spec.ts`: no 5xx, problem+json |
| API-T-07 | M-07 | matrix B: someone else's resource → 404 on every route with `:id` (including 106–117, 120, 130, 144–145) |
| API-T-08 | M-08 | ranked with no `CF-IPCountry` → refusal; with the flag → the default country |
| API-T-09 | M-09 | = POOL-T-14 |
| API-T-10 | M-10 | a nightly schemathesis job; fast-check specs for money and windows |
| API-T-11 | M-11 | `test:census` |
| API-T-12 | M-12 | `expectDbDelta` in the money scenarios |
| API-T-13 | M-13 | the registry contains the new routes; removed ones → 404 |

### Traceability
API-M-01…13 → planned ids API-T-01…13. 13 MUST. An id is not a written test, and not the hundreds of cases already generated. The executable bar is [`../testing/COVERAGE_CONTRACT.md`](../testing/COVERAGE_CONTRACT.md).

---

## Appendix A. Backend test plan (former backend_test_plan.md, §0–6)
> Moved unchanged from `backend_test_plan.md` (superseded, merged into docs/spec) (17.10.2026); heading levels shifted by one. Part 1 of this file is normative; on a conflict the spec wins.

## FreightChain backend test plan: every route, response validation, positive and negative

Date: 17.10.2026. Analysis by reading the code only: tests were not run, and nothing was pushed to git.
Branches on 17.10.2026: `origin/main` (`3ab33d8`), PR #3 `cursor/ten4-tokenomics-6271` (`794fed8`). **PR #3 is merged into main** (`4e53f247`, current main `e8f338ad`). The lines below about "not merged" and "not in the PR #3 branch" are a pre-merge snapshot; the routes `auth/pair`, `referrals`, `auth/guest`, and `prize/board` are all on main now.

### 0. In short

| Metric | Value |
|---|---|
| HTTP routes in controllers (main) | **149** in 31 controllers |
| Routes that arrived with PR #3 | **2**: `POST /api/auth/guest`, `GET /api/prize/board` (both on main) |
| Changed in PR #3 | 3: `POST /api/rides`, `POST /api/rides/:id/start` (`ranked`, geo, `409 ranked_*`), `GET /api/me` (geo) |
| `auth/pair` ×3 and `referrals` ×3 | were on main only until PR #3 was merged. Kept after the merge |
| Total on main | **151** routes + 4 endpoints outside controllers (see 1.3) |
| WebSocket / SSE | **none**: live mode is entirely polling. There is an outbound WS subscription `onLogs` to Solana, but that is not our endpoint |
| Webhook | 1: `POST /api/chain/webhook` (a shared secret in `x-webhook-secret` or `Authorization`, compared in constant time; with no secret the route does not exist, 404) |
| Routes that at least one HTTP test calls | **135 / 151** (16 are called by none) |
| …with a checked 2xx | **126 / 151** |
| …with at least one negative code (4xx/5xx) | **90 / 151** |
| …with ≥ 2 distinct negative codes | **50 / 151** |
| …where the response body is checked at all (`toMatchObject`, fields) | 127 / 151, but only **partially** |
| …where the response is checked **against a schema** | **0 / 151**: there are no response schemas in the code |
| Protected routes with no separate "no access" test (401 or 404) | **58 / 96** |
| HTTP-level tests now | ≈ 358 `it()` cases in `test/scenarios`, `test/http`, `test/integration` (scenarios run twice: in-memory and Postgres) + 24 `server/scripts/e2e-*.mjs` scripts |
| PR #5 for the API | 20 routes, all already covered by scenarios. PR #5 is mostly about pages and UI |

**How it was counted.** Routes were taken from the `@Controller/@Get/@Post/@Put` decorators (local script `routes.py`, not in the repo). Coverage was counted from path literals in the tests and the status codes next to them: `.expect(NNN)`, `status === NNN` (local script `cov.py`, not in the repo). It is a heuristic off by a few routes: it does not see paths built with `+`, variables, or clicks in the browser. The exact inventory will come from a route registry built from Nest metadata (§ 4.2). The repo already has a similar counter, `.claude/skills/test-census` (`npm run test:census -- features`), but it does not separate positives from negatives.

### 1. What the backend has, from the tests' point of view

#### 1.1 Request pipeline
`solanaPayCors` → `actionHeaders` → `browserCors` (exact origin list) → `compression` → `requestId` → `requestLog` → `legacySession` → **`jsonOnly`** (a POST as form or text/plain returns 415, except the beacon `/api/rides/:id/end`) → `beaconBody` → JSON parser (100 KB, 256 KB for `/api/editor`, more returns 413) → `ridePage` (`/r/:id`) → global guards **`ThrottlerGuard`** (10 buckets) and **`OriginGuard`** (CSRF: `403 bad_origin`; on the storybook host everything except `/api/entities|editor` returns 404) → route guard → `ZodValidationPipe` → CQRS handler → `ProblemDetailsFilter`.

#### 1.2 Access levels

| Class | Guard | Refusal |
|---|---|---|
| public | — | — |
| guest/session (opt.) | `OptionalSessionGuard` | — |
| wallet | `PlayerAuthGuard` (cookie `fc_session`) | 401 `not signed in` / `session expired` |
| admin | `AdminGuard`: admin host, cookie `fc_admin`, wallet in `ADMIN_WALLETS`, `X-FC-Admin: 1` on changes | **404** for everything, 403 without the header |
| signed admin action | the `…/challenge` → signature → action pair | 401 / 400 on a wrong, stale, or someone else's signature |
| editor | `EditorGuard`: storybook host, IP from the allowlist, `fc_editor`, `EDITOR_WALLETS`, `X-FC-Editor` | 404 / 403 |
| MCP job | `McpJobGuard`: `x-fc-job`, job `running`, no `X-Forwarded-For` | 404 |
| webhook | `WebhookSecretGuard` | 404 (secret not set) / 401 |
| CORS-public | `@CrossOriginPublic` (blinks, Solana Pay, webhook) | Origin is not checked |

Errors are returned as RFC 9457 `application/problem+json`: `{type, title, status, code, detail, requestId, instance, errors?}`. Codes: 400 `validation_error` / `malformed_json`, 401, 403, 404, 409 (domain codes), 413, 415, 422, 429 `rate_limited`, 503. **There is no 428 code in the server.** In PR #3, 18+ and geo return 409 (`agreements_required`, `ranked_ineligible`).

Limit buckets: `default` (per wallet or IP), `auth` + `auth-rps`, `promo`, `entities` + `entities-rps`, `editor` + `editor-rps`, `mcp` + `mcp-rps`. Storage is in memory or Redis.

#### 1.3 Endpoints outside controllers
- `GET /r/:id`: the ride page, with an OG/Twitter card (middleware).
- `GET /.well-known/actions.json`: an alias of `/actions.json` for blinks.
- `OPTIONS` preflight: Solana Pay, Actions, CORS-allowlist.
- Static files: the landing and `client/` via `ServeStatic`, except `/api/*`.

#### 1.4 Schemas
- **Input is fully checked:** 116 of 149 routes have zod schemas on the body, query, or params. The other 33 take no input: GETs with no parameters and 4 POSTs (`logout` ×3, `auth/pair`). Schemas sit next to the controllers (`presentation/*/dto/*.dto.ts`).
- Extra input fields are **dropped silently**: `.strict()` is set only on `garage.loadout`.
- **Output is not checked at all:** responses are described by TS interfaces (`Promise<XxxDto>`, ≈ 87 `*Dto` interfaces in `domain/`). Nothing checks them at runtime, and there is no OpenAPI. [`docs/tech/backend-architecture.md`](../tech/backend-architecture.md) states outright that "OpenAPI/Yaak generators… deliberately not adopted".
- Every Nest class requires a unit spec (`test/architecture/test-pyramid.spec.ts`): all 31 controllers have `*.http.controller.spec.ts`.


### 2. Route inventory (151 = 149 from main + 2 from PR #3)

"Input" — zod schemas from the `@ZodBody/@ZodQuery/@ZodParams` decorators. "Response" — the declared TS type: there is no schema for it yet. A POST with no note returns 200 (`@HttpCode(200)`).

| # | Method | Path | Access | Input (zod) | Response (TS type) | Note |
|---|---|---|---|---|---|---|
| 1 | GET | `/actions.json` | public · CORS-public | — | `ActionsJson` |  |
| 2 | GET | `/api/actions/hello` | public · CORS-public | — | `ActionCard` |  |
| 3 | POST | `/api/actions/hello` | public · CORS-public | Body:actionAccountBody | `ActionPost` |  |
| 4 | GET | `/api/actions/shift` | public · CORS-public | — | `ActionCard` |  |
| 5 | GET | `/api/actions/shift/:tier` | public · CORS-public | Params:actionTierParams | `ActionCard` |  |
| 6 | POST | `/api/actions/shift` | public · CORS-public | Query:actionTierQuery, Body:actionAccountBody | `ActionTx` |  |
| 7 | POST | `/api/actions/shift/:tier` | public · CORS-public | Params:actionTierParams, Body:actionAccountBody | `ActionTx` |  |
| 8 | POST | `/api/actions/go/:to` | public · CORS-public | Params:actionSiteParams, Body:actionAccountBody | `ActionLink` |  |
| 9 | GET | `/api/actions/ride/:id` | public · CORS-public | Params:rideIdParams | `ActionCard` |  |
| 10 | POST | `/api/actions/ride/:id` | public · CORS-public | Params:rideIdParams, Body:actionAccountBody | `ActionLink` |  |
| 11 | POST | `/api/actions/ride/:id/watch` | public · CORS-public | Params:rideIdParams, Body:actionAccountBody | `ActionLink` |  |
| 12 | GET | `/api/admin/queue/count` | admin (fc_admin) | — | `(inline)` |  |
| 13 | GET | `/api/admin/players` | admin (fc_admin) | Query:playersQuery | `AdminListDto<AdminPlayerRowDto>` |  |
| 14 | GET | `/api/admin/players/:wallet` | admin (fc_admin) | Params:walletParams | `AdminPlayerDetailDto` |  |
| 15 | GET | `/api/admin/pools` | admin (fc_admin) | Query:poolsQuery | `AdminListDto<AdminPoolRowDto>` |  |
| 16 | GET | `/api/admin/pools/:id` | admin (fc_admin) | Params:poolIdParams | `AdminPoolDetailDto` |  |
| 17 | GET | `/api/admin/stats` | admin (fc_admin) | Query:adminStatsQuery | `AdminStatsDto` |  |
| 18 | GET | `/api/admin/sessions` | admin (fc_admin) | Query:sessionsQuery | `AdminSessionsDto` |  |
| 19 | GET | `/api/admin/pool-payouts` | admin (fc_admin) | — | `PoolPayoutsDto` |  |
| 20 | POST | `/api/admin/pools/:id/hold/challenge` | admin (fc_admin) + X-FC-Admin | Params:poolHoldParams, Body:poolHoldChallengeBody | `ChallengeDto` |  |
| 21 | POST | `/api/admin/pools/:id/hold` | admin (fc_admin) + X-FC-Admin | Params:poolHoldParams, Body:poolHoldBody | `PoolHoldDto` |  |
| 22 | GET | `/api/admin/promos` | admin (fc_admin) | Query:promosQuery | `PromoListDto` |  |
| 23 | GET | `/api/admin/promos/redemptions` | admin (fc_admin) | Query:promoRedemptionsQuery | `PromoRedemptionListDto` |  |
| 24 | POST | `/api/admin/promos/challenge` | admin (fc_admin) + X-FC-Admin | Body:promoChallengeBody | `ChallengeDto` |  |
| 25 | POST | `/api/admin/promos` | admin (fc_admin) + X-FC-Admin | Body:createPromoBody | `PromoDto` |  |
| 26 | POST | `/api/admin/promos/:code/disable` | admin (fc_admin) + X-FC-Admin | Params:promoCodeParams, Body:disablePromoBody | `PromoDto` |  |
| 27 | GET | `/api/admin/settings` | admin (fc_admin) | — | `GameSettingsDto` |  |
| 28 | POST | `/api/admin/settings/challenge` | admin (fc_admin) + X-FC-Admin | Body:settingChallengeBody | `ChallengeDto` |  |
| 29 | POST | `/api/admin/settings` | admin (fc_admin) + X-FC-Admin | Body:updateSettingBody | `SettingUpdatedDto` |  |
| 30 | POST | `/api/admin/players/free-rides/challenge` | admin (fc_admin) + X-FC-Admin | Body:freeRidesChallengeBody | `ChallengeDto` |  |
| 31 | POST | `/api/admin/players/free-rides` | admin (fc_admin) + X-FC-Admin | Body:adjustFreeRidesBody | `FreeRidesAdjustedDto` |  |
| 32 | POST | `/api/admin/auth/nonce` | admin-host, public sign-in (X-FC-Admin) | Body:challengeBody | `ChallengeDto` |  |
| 33 | POST | `/api/admin/auth/verify` | admin-host, public sign-in (X-FC-Admin) | Body:verifyBody | `AdminSignInResultDto` |  |
| 34 | POST | `/api/admin/auth/logout` | admin-host, public sign-in (X-FC-Admin) | — | `LogoutResultDto` |  |
| 35 | GET | `/api/admin/overview` | admin (fc_admin) | — | `AdminOverviewDto` |  |
| 36 | GET | `/api/admin/rides` | admin (fc_admin) | Query:adminRidesQuery | `AdminListDto<AdminRideRowDto>` |  |
| 37 | GET | `/api/admin/replays` | admin (fc_admin) | Query:adminReplaysQuery | `AdminReplaysDto` |  |
| 38 | GET | `/api/admin/rides/:id` | admin (fc_admin) | Params:rideIdParams | `AdminRideDetailDto` |  |
| 39 | POST | `/api/admin/rides/:id/challenge` | admin (fc_admin) + X-FC-Admin | Params:rideIdParams, Body:actionChallengeBody | `ChallengeDto` |  |
| 40 | POST | `/api/admin/rides/:id/verdict` | admin (fc_admin) + X-FC-Admin | Params:rideIdParams, Body:overrideBody | `VerdictDto` |  |
| 41 | POST | `/api/admin/rides/:id/rejudge` | admin (fc_admin) + X-FC-Admin | Params:rideIdParams, Body:rejudgeBody | `VerdictDto` |  |
| 42 | GET | `/api/admin/signins` | admin (fc_admin) | Query:signInsQuery | `AdminListDto<SignInRowDto>` |  |
| 43 | GET | `/api/admin/actions` | admin (fc_admin) | Query:actionsQuery | `AdminListDto<AdminActionDto>` |  |
| 44 | GET | `/api/admin/logs` | admin (fc_admin) | Query:logsQuery | `AdminLogsDto` |  |
| 45 | POST | `/api/auth/nonce` | public | Body:requestChallengeBody | `ChallengeDto` |  |
| 46 | POST | `/api/auth/pair` | public | — | `OpenPhonePairDto` | on main (kept in the PR #3 merge) |
| 47 | GET | `/api/auth/pair/:id` | public | Params:pairParams | `PollPhonePairDto` | on main (kept in the PR #3 merge) |
| 48 | POST | `/api/auth/pair/:id/claim` | wallet (fc_session) | Params:pairParams | `(inline)` | on main (kept in the PR #3 merge) |
| 49 | POST | `/api/auth/verify` | public | Body:verifyBody | `SignInResultDto` |  |
| 50 | POST | `/api/auth/logout` | public | — | `LogoutResultDto` |  |
| 51 | GET | `/api/me` | wallet (fc_session) | — | `MeDto` | PR3: + geo |
| 52 | POST | `/api/chain/webhook` | webhook secret · CORS-public | Body:chainWebhookBody | `ChainWebhookResultDto` |  |
| 53 | GET | `/api/chain/fees` | public | Query:chainFeesQuery | `ChainFeesDto` |  |
| 54 | GET | `/api/tiers` | public | — | `TiersDto` |  |
| 55 | GET | `/api/pool` | public | — | `PoolDto` |  |
| 56 | GET | `/api/leaderboard` | guest/session (opt.) | Query:leaderboardQuery | `LeaderboardDto` |  |
| 57 | GET | `/api/garage` | wallet (fc_session) | — | `GarageDto` |  |
| 58 | POST | `/api/garage/loadout` | wallet (fc_session) | Body:saveGarageBody | `GarageDto` |  |
| 59 | POST | `/api/pledges` | wallet (fc_session) | Body:createPledgeBody | `CreatedPledgeDto` |  |
| 60 | GET | `/api/rides/:id/pledges` | public | Params:pledgeRideIdParams | `PledgeDto[]` |  |
| 61 | POST | `/api/pledges/:id/confirm` | wallet (fc_session) | Params:pledgeIdParams, Body:confirmPledgeBody | `PledgeDto` |  |
| 62 | GET | `/api/pledges/:id` | public | Params:pledgeIdParams | `PledgeDto` |  |
| 63 | GET | `/api/pools` | public | — | `PoolListDto` |  |
| 64 | GET | `/api/pools/:id` | public | Params:poolIdParams | `PrizePoolDetailDto` |  |
| 65 | GET | `/api/pools/:id/standings` | public | Params:poolIdParams | `PoolStandingsDto` |  |
| 66 | POST | `/api/promo/redeem` | wallet (fc_session) | Body:redeemPromoBody | `PromoRedeemedDto` |  |
| 67 | GET | `/api/pools/:id/refund` | wallet (fc_session) | Params:poolIdParams | `RefundTransactionDto` |  |
| 68 | GET | `/api/pools/:id/payout` | wallet (fc_session) | Params:poolIdParams | `PayoutTransactionsDto` |  |
| 69 | POST | `/api/chain/settle` | wallet (fc_session) | Body:confirmTicketOrderBody | `SettledSignatureDto` |  |
| 70 | GET | `/api/promo/mine` | wallet (fc_session) | — | `MyPromosDto` |  |
| 71 | GET | `/api/wardrobe` | wallet (fc_session) | — | `WardrobeDto` |  |
| 72 | POST | `/api/wardrobe/equip` | wallet (fc_session) | Body:equipCosmeticBody | `WardrobeDto` |  |
| 73 | POST | `/api/tickets` | wallet (fc_session) | Body:createTicketOrderBody | `TicketOrderDto` |  |
| 74 | GET | `/api/tickets/pending` | wallet (fc_session) | — | `PendingTicketOrderDto` |  |
| 75 | GET | `/api/tickets/orders/:id` | wallet (fc_session) | Params:orderIdParams | `TicketOrderDto` |  |
| 76 | GET | `/api/tickets/orders/:id/payment` | wallet (fc_session) | Params:orderIdParams | `TicketPaymentDto` |  |
| 77 | POST | `/api/tickets/orders/:id/confirm` | wallet (fc_session) | Params:orderIdParams, Body:confirmTicketOrderBody | `ConfirmTicketOrderResultDto` |  |
| 78 | POST | `/api/tickets/orders/:id/reconcile` | wallet (fc_session) | Params:orderIdParams | `ReconcileTicketOrderResultDto` |  |
| 79 | POST | `/api/editor/auth/nonce` | editor-host+IP, public sign-in (X-FC-Editor) | Body:requestChallengeBody | `ChallengeDto` |  |
| 80 | POST | `/api/editor/auth/verify` | editor-host+IP, public sign-in (X-FC-Editor) | Body:verifyBody | `EditorSignInResultDto` |  |
| 81 | POST | `/api/editor/auth/logout` | editor-host+IP, public sign-in (X-FC-Editor) | — | `LogoutResultDto` |  |
| 82 | GET | `/api/editor/me` | editor (fc_editor) | — | `EditorMeDto` |  |
| 83 | GET | `/api/editor/entities` | editor (fc_editor) | — | `EntityRowDto[]` |  |
| 84 | GET | `/api/editor/entities/:id` | editor (fc_editor) | Params:entityIdParams | `EntityHeadDto` |  |
| 85 | GET | `/api/editor/entities/:id/revisions` | editor (fc_editor) | Params:entityIdParams | `RevisionDto[]` |  |
| 86 | GET | `/api/editor/revisions/:revId` | editor (fc_editor) | Params:revisionIdParams | `RevisionDto` |  |
| 87 | POST | `/api/editor/entities/:id/drafts` | editor (fc_editor) + X-FC-Editor | Params:entityIdParams, Body:draftBody | `RevisionDto` |  |
| 88 | POST | `/api/editor/entities/:id/restore` | editor (fc_editor) + X-FC-Editor | Params:entityIdParams, Body:restoreBody | `RevisionDto` |  |
| 89 | POST | `/api/editor/entities/:id/publish/challenge` | editor (fc_editor) + X-FC-Editor | Params:entityIdParams, Body:publishChallengeBody | `ChallengeDto` |  |
| 90 | POST | `/api/editor/entities/:id/publish` | editor (fc_editor) + X-FC-Editor | Params:entityIdParams, Body:publishBody | `PublishedDto` |  |
| 91 | POST | `/api/editor/jobs` | editor (fc_editor) + X-FC-Editor | Body:createJobBody | `JobCreatedDto` | 202 |
| 92 | GET | `/api/editor/jobs` | editor (fc_editor) | Query:jobsQuery | `EditorJobDto[]` |  |
| 93 | GET | `/api/editor/jobs/:id` | editor (fc_editor) | Params:jobIdParams | `EditorJobDto` |  |
| 94 | GET | `/api/editor/jobs/:id/events` | editor (fc_editor) | Params:jobIdParams, Query:jobEventsQuery | `JobEventsDto` |  |
| 95 | POST | `/api/editor/jobs/:id/cancel` | editor (fc_editor) + X-FC-Editor | Params:jobIdParams | `LogoutResultDto` |  |
| 96 | GET | `/api/editor/mcp/entities` | MCP job (x-fc-job), no XFF | — | `EntityRowDto[]` |  |
| 97 | GET | `/api/editor/mcp/entities/:id` | MCP job (x-fc-job), no XFF | Params:entityIdParams | `EntityHeadDto` |  |
| 98 | GET | `/api/editor/mcp/configs` | MCP job (x-fc-job), no XFF | — | `McpConfigsDto` |  |
| 99 | POST | `/api/editor/mcp/entities/:id/drafts` | MCP job (x-fc-job), no XFF | Params:entityIdParams, Body:mcpDraftBody | `RevisionDto` |  |
| 100 | GET | `/api/entities/bundle` | public | — | `EntityBundleDto` |  |
| 101 | GET | `/api/health/live` | public | — | `LivenessDto` |  |
| 102 | GET | `/api/health/ready` | public | — | `ReadinessDto` |  |
| 103 | GET | `/api/honk` | wallet (fc_session) | — | `HonkAccountDto` |  |
| 104 | GET | `/api/honk/catalog` | public | — | `HonkCatalogEntry[]` |  |
| 105 | POST | `/api/honk/visuals` | wallet (fc_session) | Body:honkVisualBody | `HonkVisualResult` |  |
| 106 | POST | `/api/watch/:id/honk` | wallet (fc_session) | Params:rideIdParams, Body:honkBurnBody | `HonkBurnResult` |  |
| 107 | POST | `/api/watch/:id/honk/time` | wallet (fc_session) | Params:rideIdParams, Body:honkTimeBody | `HonkTimeBurnResult` |  |
| 108 | POST | `/api/watch/:id/honk/weather` | wallet (fc_session) | Params:rideIdParams, Body:honkWeatherBody | `HonkWeatherBurnResult` |  |
| 109 | GET | `/api/watch/:id` | public | Params:rideIdParams, Query:watchQuery | `WatchDto` |  |
| 110 | GET | `/api/watch/:id/road` | public | Params:rideIdParams, Query:roadPlanQuery | `RoadPlanDto` |  |
| 111 | POST | `/api/watch/:id/messages` | wallet (fc_session) | Params:rideIdParams, Body:messageBody | `RideEventDto` |  |
| 112 | POST | `/api/watch/:id/donations` | wallet (fc_session) | Params:rideIdParams, Body:donationBody | `RideEventDto` |  |
| 113 | POST | `/api/watch/:id/donation-orders` | wallet (fc_session) | Params:rideIdParams, Body:donationBody | `DonationOrderDto` |  |
| 114 | POST | `/api/watch/:id/donation-orders/:orderId/confirm` | wallet (fc_session) | Params:orderParams, Body:confirmDonationBody | `ConfirmDonationResultDto` |  |
| 115 | POST | `/api/watch/:id/donation-orders/:orderId/reconcile` | wallet (fc_session) | Params:orderParams | `ReconcileDonationResultDto` |  |
| 116 | GET | `/api/rides/:id/inbox` | wallet (fc_session) | Params:rideIdParams, Query:inboxQuery | `InboxDto` |  |
| 117 | POST | `/api/rides/:id/mutes` | wallet (fc_session) | Params:rideIdParams, Body:muteBody | `MuteDto` |  |
| 118 | POST | `/api/rides/:id/effects/:eventId/applied` | wallet (fc_session) | Params:effectParams, Body:appliedBody | `RideEventDto` |  |
| 119 | GET | `/api/live` | guest/session (opt.) | Query:liveQuery | `LiveFeedDto` |  |
| 120 | GET | `/api/replays` | public | Query:replaysQuery | `ReplaysDto` |  |
| 121 | GET | `/api/profile` | wallet (fc_session) | — | `ProfileDto` |  |
| 122 | PUT | `/api/profile/agreements` | wallet (fc_session) | Body:agreementsBody | `AgreementsDto` |  |
| 123 | GET | `/api/referrals` | wallet (fc_session) | — | `ReferralView` | on main (kept in the PR #3 merge) |
| 124 | POST | `/api/referrals/bind` | wallet (fc_session) | Body:bindReferralBody | `ReferralView` | on main (kept in the PR #3 merge) |
| 125 | POST | `/api/referrals/gift` | wallet (fc_session) | Body:giftReferralBody | `ReferralView` | on main (kept in the PR #3 merge) |
| 126 | GET | `/api/rides/:id/public` | public | Params:rideIdParams | `PublicRideDto` |  |
| 127 | POST | `/api/rides` | wallet (fc_session) | Body:createRideBody | `RideDto` | PR3: + geo headers |
| 128 | GET | `/api/rides/pending` | wallet (fc_session) | — | `PendingRideDto` |  |
| 129 | GET | `/api/rides/:id` | wallet (fc_session) | Params:rideIdParams | `RideDto` |  |
| 130 | GET | `/api/rides/:id/replays` | wallet (fc_session) | Params:rideIdParams | `RideReplaysDto` |  |
| 131 | GET | `/api/rides/:id/payment` | wallet (fc_session) | Params:rideIdParams | `PaymentInstructionsDto` |  |
| 132 | POST | `/api/rides/:id/confirm` | wallet (fc_session) | Params:rideIdParams, Body:confirmPaymentBody | `ConfirmPaymentResultDto` |  |
| 133 | POST | `/api/rides/:id/reconcile` | wallet (fc_session) | Params:rideIdParams | `ReconcilePaymentResultDto` |  |
| 134 | POST | `/api/rides/:id/start` | wallet (fc_session) | Params:rideIdParams, Body:startRideBody | `RideDto` | PR3: + `ranked`, geo, 409 ranked_* |
| 135 | POST | `/api/rides/:id/heartbeat` | wallet (fc_session) | Params:rideIdParams, Body:heartbeatBody | `RideDto` |  |
| 136 | POST | `/api/rides/:id/batches` | wallet (fc_session) | Params:rideIdParams, Body:batchBody | `BatchReceiptDto` |  |
| 137 | POST | `/api/rides/:id/end` | wallet (fc_session) | Params:rideIdParams, Body:endRideBody | `RideDto` |  |
| 138 | GET | `/api/sns/reverse` | public | Query:snsReverseQuery | `SnsReverseDto` |  |
| 139 | GET | `/api/sns/resolve` | public | Query:snsResolveQuery | `SnsResolutionDto` |  |
| 140 | GET | `/api/solana-pay/rides/:id` | public · CORS-public | Params:solanaPayIdParams | `SolanaPayLinkDto` |  |
| 141 | POST | `/api/solana-pay/rides/:id` | public · CORS-public | Params:solanaPayIdParams, Body:solanaPayAccount | `SolanaPayTransactionDto` |  |
| 142 | GET | `/api/solana-pay/orders/:id` | public · CORS-public | Params:solanaPayIdParams | `SolanaPayLinkDto` |  |
| 143 | POST | `/api/solana-pay/orders/:id` | public · CORS-public | Params:solanaPayIdParams, Body:solanaPayAccount | `SolanaPayTransactionDto` |  |
| 144 | GET | `/api/solana-pay/donations/:id` | public · CORS-public | Params:solanaPayIdParams | `SolanaPayLinkDto` |  |
| 145 | POST | `/api/solana-pay/donations/:id` | public · CORS-public | Params:solanaPayIdParams, Body:solanaPayAccount | `SolanaPayTransactionDto` |  |
| 146 | GET | `/api/stats` | public | — | `GlobalStatsDto` |  |
| 147 | GET | `/api/stats/daily` | public | — | `DailyStatsDto[]` |  |
| 148 | POST | `/api/telemetry` | guest/session (opt.) | Body:telemetryBody | `TelemetryAckDto` |  |
| 149 | POST | `/api/client-error` | guest/session (opt.) | Body:clientErrorBody | `ClientErrorAckDto` |  |
| 150 | POST | `/api/auth/guest` | public | — | `SignInResultDto` | on main (arrived with PR #3) |
| 151 | GET | `/api/prize/board` | public | Query:prizeBoardQuery | `PrizeBoardDto` | on main (arrived with PR #3) |
### 3. Coverage map

Sources: `scenario` — `server/test/scenarios/*` (run through `test/http/flows.spec.ts` on in-memory and through `test/integration/flows.integration.spec.ts` on Postgres); `http` — `server/test/http/*.spec.ts`; `integration` — `server/test/integration/*.spec.ts`, including `concurrency`; `e2e-script` — `server/scripts/e2e-*.mjs`; `pr5` — `e2e/` from PR #5; `support` — `test/support` helpers. Negative codes are gathered from every source.

| # | Method | Path | Positive | Negative (codes) | Body | Where | Gap |
|---|---|---|---|---|---|---|---|
| 1 | GET | `/actions.json` | ✅ | ❌ | — | e2e-script | <2 negatives |
| 2 | GET | `/api/actions/hello` | ✅ | ❌ | partial | scenario | <2 negatives |
| 3 | POST | `/api/actions/hello` | ✅ | ❌ | partial | scenario | <2 negatives |
| 4 | GET | `/api/actions/shift` | ✅ | ❌ | partial | scenario | <2 negatives |
| 5 | GET | `/api/actions/shift/:tier` | ❌ | 400 | — | e2e-script | no 2xx, <2 negatives |
| 6 | POST | `/api/actions/shift` | ✅ | ❌ | partial | scenario | <2 negatives |
| 7 | POST | `/api/actions/shift/:tier` | ❌ | 400, 409, 503 | partial | e2e-script, scenario | no 2xx |
| 8 | POST | `/api/actions/go/:to` | ❌ | 400 | partial | e2e-script, scenario | no 2xx, <2 negatives |
| 9 | GET | `/api/actions/ride/:id` | ✅ | 404 | partial | e2e-script, scenario | <2 negatives |
| 10 | POST | `/api/actions/ride/:id` | ❌ | ❌ | — | e2e-script | no 2xx, <2 negatives |
| 11 | POST | `/api/actions/ride/:id/watch` | ✅ | ❌ | partial | scenario | <2 negatives |
| 12 | GET | `/api/admin/queue/count` | ✅ | ❌ | partial | scenario | <2 negatives, no 404 without access |
| 13 | GET | `/api/admin/players` | ✅ | 400 | partial | scenario | <2 negatives, no 404 without access |
| 14 | GET | `/api/admin/players/:wallet` | ✅ | 400 | partial | scenario | <2 negatives, no 404 without access |
| 15 | GET | `/api/admin/pools` | ✅ | ❌ | partial | scenario | <2 negatives, no 404 without access |
| 16 | GET | `/api/admin/pools/:id` | ❌ | 400, 404 | partial | scenario | no 2xx |
| 17 | GET | `/api/admin/stats` | ✅ | 400 | partial | scenario | <2 negatives, no 404 without access |
| 18 | GET | `/api/admin/sessions` | ✅ | 400 | partial | scenario | <2 negatives, no 404 without access |
| 19 | GET | `/api/admin/pool-payouts` | ✅ | ❌ | partial | e2e-script, scenario | <2 negatives, no 404 without access |
| 20 | POST | `/api/admin/pools/:id/hold/challenge` | ✅ | ❌ | — | scenario | <2 negatives, no 404 without access |
| 21 | POST | `/api/admin/pools/:id/hold` | ✅ | 401 | partial | scenario | <2 negatives, no 404 without access |
| 22 | GET | `/api/admin/promos` | ✅ | 400, 401, 404 | partial | e2e-script, scenario | — |
| 23 | GET | `/api/admin/promos/redemptions` | ✅ | 400, 404 | partial | scenario | — |
| 24 | POST | `/api/admin/promos/challenge` | ✅ | 400, 404, 409 | partial | scenario | — |
| 25 | POST | `/api/admin/promos` | ✅ | 400, 401, 403, 404 | partial | scenario | — |
| 26 | POST | `/api/admin/promos/:code/disable` | ✅ | 401, 404 | partial | scenario | — |
| 27 | GET | `/api/admin/settings` | ✅ | 404 | partial | integration, scenario | <2 negatives |
| 28 | POST | `/api/admin/settings/challenge` | ✅ | 400, 404 | partial | integration, scenario | — |
| 29 | POST | `/api/admin/settings` | ✅ | 400, 401, 403, 404 | partial | integration, scenario | — |
| 30 | POST | `/api/admin/players/free-rides/challenge` | ✅ | 404 | — | integration, scenario | <2 negatives |
| 31 | POST | `/api/admin/players/free-rides` | ✅ | 400, 401, 404 | partial | integration, scenario | — |
| 32 | POST | `/api/admin/auth/nonce` | ✅ | 403, 404 | partial | http, integration, scenario, support | — |
| 33 | POST | `/api/admin/auth/verify` | ✅ | 401 | partial | http, integration, scenario, support | <2 negatives |
| 34 | POST | `/api/admin/auth/logout` | ✅ | ❌ | — | scenario | <2 negatives |
| 35 | GET | `/api/admin/overview` | ✅ | 403, 404 | partial | e2e-script, http, scenario | — |
| 36 | GET | `/api/admin/rides` | ✅ | 400, 404 | partial | e2e-script, http, scenario | — |
| 37 | GET | `/api/admin/replays` | ✅ | ❌ | partial | scenario | <2 negatives, no 404 without access |
| 38 | GET | `/api/admin/rides/:id` | ✅ | ❌ | partial | scenario | <2 negatives, no 404 without access |
| 39 | POST | `/api/admin/rides/:id/challenge` | ✅ | ❌ | partial | integration, scenario | <2 negatives, no 404 without access |
| 40 | POST | `/api/admin/rides/:id/verdict` | ✅ | 400, 401, 403, 404 | partial | integration, scenario | — |
| 41 | POST | `/api/admin/rides/:id/rejudge` | ✅ | 400, 403 | partial | scenario | no 404 without access |
| 42 | GET | `/api/admin/signins` | ✅ | 400 | partial | http, scenario | <2 negatives, no 404 without access |
| 43 | GET | `/api/admin/actions` | ✅ | ❌ | partial | e2e-script, scenario | <2 negatives, no 404 without access |
| 44 | GET | `/api/admin/logs` | ✅ | ❌ | partial | scenario | <2 negatives, no 404 without access |
| 45 | POST | `/api/auth/nonce` | ✅ | 400, 404, 413, 429 | partial | e2e-script, http, integration, scenario, support | — |
| 46 | POST | `/api/auth/pair` | ✅ | ❌ | partial | scenario | <2 negatives |
| 47 | GET | `/api/auth/pair/:id` | ✅ | 404 | partial | scenario | <2 negatives |
| 48 | POST | `/api/auth/pair/:id/claim` | ✅ | ❌ | partial | scenario | <2 negatives, no 401 without access |
| 49 | POST | `/api/auth/verify` | ✅ | 400, 401 | partial | e2e-script, http, integration, scenario, support | — |
| 50 | POST | `/api/auth/logout` | ✅ | ❌ | partial | scenario | <2 negatives |
| 51 | GET | `/api/me` | ✅ | 400, 401, 409, 429, 500 | partial | e2e-script, http, integration, scenario | — |
| 52 | POST | `/api/chain/webhook` | ✅ | 401, 404 | partial | scenario | — |
| 53 | GET | `/api/chain/fees` | ✅ | 400, 503 | partial | scenario | — |
| 54 | GET | `/api/tiers` | ✅ | 429 | partial | e2e-script, http, scenario | <2 negatives |
| 55 | GET | `/api/pool` | ✅ | ❌ | partial | e2e-script, integration, scenario | <2 negatives |
| 56 | GET | `/api/leaderboard` | ✅ | 400 | partial | e2e-script, scenario | <2 negatives |
| 57 | GET | `/api/garage` | ✅ | 400, 401 | partial | e2e-script, scenario | — |
| 58 | POST | `/api/garage/loadout` | ✅ | 400, 401, 409 | partial | scenario | — |
| 59 | POST | `/api/pledges` | ✅ | 400, 401 | partial | integration, scenario | — |
| 60 | GET | `/api/rides/:id/pledges` | ✅ | ❌ | partial | scenario | <2 negatives |
| 61 | POST | `/api/pledges/:id/confirm` | ✅ | 403 | partial | integration, scenario | <2 negatives, no 401 without access |
| 62 | GET | `/api/pledges/:id` | ✅ | ❌ | partial | scenario | <2 negatives |
| 63 | GET | `/api/pools` | ✅ | ❌ | partial | e2e-script, scenario | <2 negatives |
| 64 | GET | `/api/pools/:id` | ✅ | 400, 401, 404 | partial | scenario | — |
| 65 | GET | `/api/pools/:id/standings` | ✅ | 400, 404 | partial | scenario | — |
| 66 | POST | `/api/promo/redeem` | ✅ | 400, 401, 404, 409, 415, 429 | partial | http, integration, scenario | — |
| 67 | GET | `/api/pools/:id/refund` | ✅ | 409 | partial | scenario | <2 negatives, no 401 without access |
| 68 | GET | `/api/pools/:id/payout` | ❌ | 403 | — | scenario | no 2xx, <2 negatives, no 401 without access |
| 69 | POST | `/api/chain/settle` | ✅ | ❌ | partial | scenario | <2 negatives, no 401 without access |
| 70 | GET | `/api/promo/mine` | ✅ | 401 | partial | e2e-script, http, scenario | <2 negatives |
| 71 | GET | `/api/wardrobe` | ✅ | 401 | partial | e2e-script, scenario | <2 negatives |
| 72 | POST | `/api/wardrobe/equip` | ✅ | 400, 401 | partial | scenario | — |
| 73 | POST | `/api/tickets` | ✅ | 400, 401, 404, 409, 503 | partial | scenario | — |
| 74 | GET | `/api/tickets/pending` | ✅ | ❌ | partial | scenario | <2 negatives, no 401 without access |
| 75 | GET | `/api/tickets/orders/:id` | ✅ | 400, 403, 404 | partial | scenario | no 401 without access |
| 76 | GET | `/api/tickets/orders/:id/payment` | ✅ | ❌ | partial | scenario | <2 negatives, no 401 without access |
| 77 | POST | `/api/tickets/orders/:id/confirm` | ✅ | ❌ | partial | scenario | <2 negatives, no 401 without access |
| 78 | POST | `/api/tickets/orders/:id/reconcile` | ❌ | ❌ | — | — | no 2xx, <2 negatives, no 401 without access |
| 79 | POST | `/api/editor/auth/nonce` | ✅ | 404 | partial | http, integration, scenario | <2 negatives |
| 80 | POST | `/api/editor/auth/verify` | ✅ | ❌ | partial | http, integration, scenario | <2 negatives |
| 81 | POST | `/api/editor/auth/logout` | ❌ | 403 | — | http | no 2xx, <2 negatives |
| 82 | GET | `/api/editor/me` | ✅ | 404 | partial | http, integration, scenario | <2 negatives |
| 83 | GET | `/api/editor/entities` | ✅ | 404 | partial | integration, scenario | <2 negatives |
| 84 | GET | `/api/editor/entities/:id` | ✅ | ❌ | partial | scenario | <2 negatives, no 404 without access |
| 85 | GET | `/api/editor/entities/:id/revisions` | ✅ | ❌ | partial | scenario | <2 negatives, no 404 without access |
| 86 | GET | `/api/editor/revisions/:revId` | ❌ | 404 | partial | scenario | no 2xx, <2 negatives |
| 87 | POST | `/api/editor/entities/:id/drafts` | ✅ | 403, 413, 422 | partial | http, integration, scenario | no 404 without access |
| 88 | POST | `/api/editor/entities/:id/restore` | ✅ | ❌ | partial | scenario | <2 negatives, no 404 without access |
| 89 | POST | `/api/editor/entities/:id/publish/challenge` | ✅ | ❌ | partial | integration, scenario | <2 negatives, no 404 without access |
| 90 | POST | `/api/editor/entities/:id/publish` | ✅ | 401 | partial | integration, scenario | <2 negatives, no 404 without access |
| 91 | POST | `/api/editor/jobs` | ❌ | 403, 503 | partial | http, scenario | no 2xx, no 404 without access |
| 92 | GET | `/api/editor/jobs` | ✅ | 429 | partial | integration, scenario | <2 negatives, no 404 without access |
| 93 | GET | `/api/editor/jobs/:id` | ✅ | 404 | partial | scenario | <2 negatives |
| 94 | GET | `/api/editor/jobs/:id/events` | ✅ | 404 | partial | scenario | <2 negatives |
| 95 | POST | `/api/editor/jobs/:id/cancel` | ✅ | ❌ | partial | scenario | <2 negatives, no 404 without access |
| 96 | GET | `/api/editor/mcp/entities` | ✅ | 404 | partial | scenario | <2 negatives |
| 97 | GET | `/api/editor/mcp/entities/:id` | ❌ | ❌ | — | — | no 2xx, <2 negatives, no 404 without access |
| 98 | GET | `/api/editor/mcp/configs` | ✅ | 404 | partial | scenario | <2 negatives |
| 99 | POST | `/api/editor/mcp/entities/:id/drafts` | ✅ | 403, 404, 409 | partial | scenario | — |
| 100 | GET | `/api/entities/bundle` | ✅ | ❌ | partial | http, integration, scenario | <2 negatives |
| 101 | GET | `/api/health/live` | ✅ | ❌ | partial | http, scenario | <2 negatives |
| 102 | GET | `/api/health/ready` | ✅ | ❌ | partial | scenario | <2 negatives |
| 103 | GET | `/api/honk` | ✅ | ❌ | partial | e2e-script, scenario | <2 negatives, no 401 without access |
| 104 | GET | `/api/honk/catalog` | ❌ | ❌ | — | — | no 2xx, <2 negatives |
| 105 | POST | `/api/honk/visuals` | ✅ | 409 | partial | scenario | <2 negatives, no 401 without access |
| 106 | POST | `/api/watch/:id/honk` | ❌ | ❌ | — | — | no 2xx, <2 negatives, no 401 without access |
| 107 | POST | `/api/watch/:id/honk/time` | ❌ | ❌ | — | — | no 2xx, <2 negatives, no 401 without access |
| 108 | POST | `/api/watch/:id/honk/weather` | ❌ | ❌ | — | — | no 2xx, <2 negatives, no 401 without access |
| 109 | GET | `/api/watch/:id` | ✅ | 400, 403, 404 | partial | e2e-script, scenario | — |
| 110 | GET | `/api/watch/:id/road` | ✅ | 400, 404 | partial | e2e-script, scenario | — |
| 111 | POST | `/api/watch/:id/messages` | ✅ | 400, 401, 403, 409 | partial | e2e-script, integration, scenario | — |
| 112 | POST | `/api/watch/:id/donations` | ✅ | 400, 403, 429 | partial | e2e-script, integration, scenario | no 401 without access |
| 113 | POST | `/api/watch/:id/donation-orders` | ✅ | ❌ | partial | integration, scenario | <2 negatives, no 401 without access |
| 114 | POST | `/api/watch/:id/donation-orders/:orderId/confirm` | ✅ | 400, 409 | partial | integration, scenario | no 401 without access |
| 115 | POST | `/api/watch/:id/donation-orders/:orderId/reconcile` | ❌ | ❌ | — | — | no 2xx, <2 negatives, no 401 without access |
| 116 | GET | `/api/rides/:id/inbox` | ✅ | 401, 404 | partial | scenario | — |
| 117 | POST | `/api/rides/:id/mutes` | ✅ | 400, 404 | partial | integration, scenario | no 401 without access |
| 118 | POST | `/api/rides/:id/effects/:eventId/applied` | ✅ | 400, 404, 409 | partial | integration, scenario | no 401 without access |
| 119 | GET | `/api/live` | ✅ | 403 | partial | e2e-script, scenario | <2 negatives |
| 120 | GET | `/api/replays` | ✅ | 400 | partial | scenario | <2 negatives |
| 121 | GET | `/api/profile` | ✅ | 401 | partial | integration, scenario | <2 negatives |
| 122 | PUT | `/api/profile/agreements` | ✅ | 400 | partial | integration, scenario, support | <2 negatives, no 401 without access |
| 123 | GET | `/api/referrals` | ✅ | 401 | partial | integration, scenario | <2 negatives |
| 124 | POST | `/api/referrals/bind` | ✅ | 400, 409 | partial | integration, scenario | no 401 without access |
| 125 | POST | `/api/referrals/gift` | ✅ | 400 | partial | scenario | <2 negatives, no 401 without access |
| 126 | GET | `/api/rides/:id/public` | ❌ | ❌ | — | — | no 2xx, <2 negatives |
| 127 | POST | `/api/rides` | ✅ | 400, 403, 404, 409, 415 | partial | e2e-script, http, integration, scenario | no 401 without access |
| 128 | GET | `/api/rides/pending` | ✅ | ❌ | partial | e2e-script, scenario | <2 negatives, no 401 without access |
| 129 | GET | `/api/rides/:id` | ✅ | 401, 403, 404, 409 | partial | e2e-script, integration, scenario | — |
| 130 | GET | `/api/rides/:id/replays` | ✅ | ❌ | partial | scenario | <2 negatives, no 401 without access |
| 131 | GET | `/api/rides/:id/payment` | ✅ | 404, 409 | partial | scenario | no 401 without access |
| 132 | POST | `/api/rides/:id/confirm` | ✅ | 400, 404, 409 | partial | integration, scenario | no 401 without access |
| 133 | POST | `/api/rides/:id/reconcile` | ✅ | 404 | partial | integration, scenario | <2 negatives, no 401 without access |
| 134 | POST | `/api/rides/:id/start` | ✅ | 400, 409 | partial | e2e-script, http, integration, scenario | no 401 without access |
| 135 | POST | `/api/rides/:id/heartbeat` | ✅ | 400, 404, 409, 500 | partial | e2e-script, integration, scenario | no 401 without access |
| 136 | POST | `/api/rides/:id/batches` | ✅ | 400, 401, 404, 409, 429 | partial | e2e-script, integration, scenario, support | — |
| 137 | POST | `/api/rides/:id/end` | ✅ | 401, 409, 500 | partial | e2e-script, http, integration, scenario | — |
| 138 | GET | `/api/sns/reverse` | ❌ | ❌ | — | — | no 2xx, <2 negatives |
| 139 | GET | `/api/sns/resolve` | ❌ | ❌ | — | — | no 2xx, <2 negatives |
| 140 | GET | `/api/solana-pay/rides/:id` | ✅ | ❌ | partial | http, scenario | <2 negatives |
| 141 | POST | `/api/solana-pay/rides/:id` | ✅ | 404 | partial | scenario | <2 negatives |
| 142 | GET | `/api/solana-pay/orders/:id` | ❌ | ❌ | — | — | no 2xx, <2 negatives |
| 143 | POST | `/api/solana-pay/orders/:id` | ❌ | ❌ | — | — | no 2xx, <2 negatives |
| 144 | GET | `/api/solana-pay/donations/:id` | ❌ | ❌ | — | — | no 2xx, <2 negatives |
| 145 | POST | `/api/solana-pay/donations/:id` | ❌ | ❌ | — | — | no 2xx, <2 negatives |
| 146 | GET | `/api/stats` | ✅ | ❌ | partial | integration, scenario | <2 negatives |
| 147 | GET | `/api/stats/daily` | ✅ | ❌ | partial | scenario | <2 negatives |
| 148 | POST | `/api/telemetry` | ✅ | ❌ | partial | scenario | <2 negatives |
| 149 | POST | `/api/client-error` | ✅ | 400, 403 | partial | http, scenario | — |
| 150 | POST | `/api/auth/guest` | ❌ | ❌ | — | controller unit spec only | no 2xx, <2 negatives |
| 151 | GET | `/api/prize/board` | ❌ | ❌ | — | controller unit spec only | no 2xx, <2 negatives |
#### 3.1 Main gaps

1. **Responses are not checked against a schema on any route.** Scenarios check individual fields (`toMatchObject`). They will not notice a new or extra field, a leak (for example an IP in sign-ins, or someone else's wallet), or a type change (`balance` as a string rather than a number).
2. **No HTTP test calls 16 routes**, and half of them are about money or the chain:
   - HONK/TEN4 burns: `POST /api/watch/:id/honk`, `/honk/time`, `/honk/weather`;
   - Solana Pay for orders and donations: `GET|POST /api/solana-pay/orders/:id`, `GET|POST /api/solana-pay/donations/:id` (only `rides` are checked);
   - `POST /api/tickets/orders/:id/reconcile` (PR #5 already noted that the stub does not have it) and `POST /api/watch/:id/donation-orders/:orderId/reconcile`;
   - `GET /api/rides/:id/public` (the receipt), `GET /api/honk/catalog`, `GET /api/sns/reverse`, `GET /api/sns/resolve`, `GET /api/editor/mcp/entities/:id`;
   - `POST /api/auth/guest` and `GET /api/prize/board` are still unit specs only in `server/test`. This PR calls them from `e2e/block1-offchain/free/merged.test.mjs` when `E2E_BASE` is up.
3. **The ranked / guest / weekly rules** in `server/test` are still mostly unit tests: `409 ranked_window`, `ranked_paid_cap`, `ranked_promo_cap`, `ranked_training`, `ranked_ineligible`, and geo via `CF-IPCountry`. `guest_easy_only` and granting the weekly 1h are checked by e2e when `E2E_BASE` is set. `weekly_ticket_spent` is recorded in the handler source: an open grant is returned by a repeat `POST /api/rides`, rather than debited a second time.
4. **25 routes have no checked 2xx**, only refusals: `POST /api/editor/jobs` (only 403/503), `GET /api/admin/pools/:id`, `GET /api/pools/:id/payout`, `GET /api/editor/revisions/:revId`, the blinks `shift/:tier`, `go/:to`, `ride/:id`, and the routes from item 2.
5. **61 routes have no negative at all, and 101 have fewer than two.** Left with no negatives are, for example, `POST /api/chain/settle`, `POST /api/tickets/orders/:id/confirm`, `GET /api/tickets/orders/:id/payment`, `POST /api/watch/:id/donation-orders`, `POST /api/admin/pools/:id/hold/challenge`, `POST /api/admin/rides/:id/challenge`, `POST /api/editor/entities/:id/restore`, `POST /api/telemetry`, `GET /api/pools`, `GET /api/pool`.
6. **The access matrix is incomplete:** 58 of 96 protected routes have no test of their own for "no session", "the wrong role", or "no X-FC-Admin". The guards are covered by unit tests and a few HTTP cases (`admin-host.spec`, `editor-host.spec`), but nothing catches a new route that forgets `@UseGuards`.
7. **Limits are only partly checked.** `test/http/rate-limit.spec.ts` has the `default`, `auth`, and `promo` buckets, and `redis-throttler.integration`. The `entities`, `editor`, and `mcp` buckets, and every `*-rps`, are not checked at the HTTP level.
8. **Extra input fields are dropped silently.** There is no test for that, and the rule itself is not recorded (see decision 3).
9. **`set_pool_rules` (pool v5) cannot be called over HTTP**; there is only the CLI `pool-admin.mjs`. Checking it belongs to block 2 (CLI + a validator), and whether an admin route is needed has to be decided ahead of time.
10. Strengths to keep: races (≈ 50 cases in `concurrency.integration.spec.ts`: double redeem, double confirm, webhook versus poll, hold versus claim), promo abuse (`promos-abuse.scenarios.ts`), the problem+json contract (`http-contract.scenarios.ts`), and the same scenario on in-memory and on Postgres.

### 4. Approach

#### 4.1 One source of truth for schemas: zod → (OpenAPI)
- Add **zod response schemas** next to the DTOs (`presentation/<area>/dto/<area>.response.ts`), and derive the `*Dto` TS interfaces through `z.infer`, so the type and the schema do not diverge.
- Put an `@ZodResponse(schema, { status })` decorator on every controller method. In tests and dev the global `ResponseSchemaInterceptor` runs `schema.strict().parse(body)` and, on a schema error, fails with 500 `response_schema_violation`. In production it only writes a warning to the log (or is off), so it does not break players.
- Make a shared `ProblemDetails` schema and **the list of allowed `code` values per route** (`errors: ['ride_rechosen','ranked_window',…]`). The test fails if a route returns a code that is not in the list.
- **Generate** OpenAPI from these same schemas (`@asteasolutions/zod-to-openapi`, compatible with zod 3.25) and the route registry, rather than writing it by hand. The file `openapi.json` is built as a CI artifact. It is needed for schemathesis and as documentation. This does not contradict the decision "do not pull in generators": the source of truth stays in zod next to the controller.

#### 4.2 Route registry and coverage gate
- `test/contract/routes.manifest.ts`: for every route `{ method, path, access, requestSchemas, responseSchema, errorCodes, block: 1|2, flags[], positive: [caseId…], negative: [caseId…] }`.
- `test/architecture/route-manifest.spec.ts` starts the app and builds the **real** route list through `DiscoveryService`/`MetadataScanner` (method, path, guards, `@AdminPublic/@EditorPublic/@CrossOriginPublic`, zod pipes). The test fails if:
  - there is a route with no entry in the spec (or the reverse);
  - the route has no `@ZodResponse`;
  - the access class in the spec does not match the guards (this catches a forgotten `@UseGuards`);
  - a route has fewer than **1 positive and 2 negative** cases (for the threshold see decision 4);
  - a case id is not found in the tests. Cases are tagged in the `it('[RIDES-START-N03] …')` name, or with the helper `covers('POST /api/rides/:id/start', 'N03')`.
- A counter of actual calls: a wrapper over supertest writes `METHOD route status` to `coverage/routes.jsonl`. The report is built by `test:census` (extend `.claude/skills/test-census`), with no new utility.

#### 4.3 Contract check of every existing test "for free"
- `checkedAgent()` in `test/support/client.ts`: every response is checked automatically. 2xx — against the route's `responseSchema` (strict); 4xx/5xx — against `ProblemDetails` and `code ∈ errorCodes`, plus headers (`X-Request-Id`, `content-type`, `Cache-Control` where it is set).
- Then all ≈ 358 existing HTTP cases, and PR #5 `harness/api.mjs` (the same validator, through a shared module), start checking the schema on 135 routes without the tests being rewritten.

#### 4.4 Generated negative matrix
The file `test/contract/negative-matrix.spec.ts` walks the spec and **generates** cases for every route from its access class and its schemas:

| Class | Generated cases |
|---|---|
| access | no cookie (401 or 404); a player's cookie on admin/editor (404); an expired or forged cookie (401); an admin session for a wallet removed from `ADMIN_WALLETS` (404); no `X-FC-Admin` or `X-FC-Editor` on a change (403); the wrong Host (404); an editor with an IP outside the allowlist (404); MCP with `X-Forwarded-For` (404); a webhook with no secret or the wrong one (401) |
| CSRF/CORS | `Origin: null` or a foreign origin on POST (403 `bad_origin`); `text/plain` and form (415); a preflight from a foreign origin does not get ACAO |
| body | broken JSON (400 `malformed_json`); an empty body; `null` or an array instead of an object; each required field removed in turn; a wrong type (string ↔ number, `"1"`, `1.5`, `NaN`, `-0`); a string that is empty, longer than max, or unicode/RTL/NUL; a number at min−1, min, max, max+1; an enum value outside the list; an extra field (per decision 3: 400, or ignore, with a check that there is no effect); prototype pollution (`__proto__`, `constructor`); > 100 KB, or > 256 KB for the editor (413) |
| params/query | not a UUID or not base58; a nonexistent id (404); someone else's resource (403 or 404, with no difference in the response text, so it cannot be probed); a repeated query parameter; `limit` and `cursor` out of bounds |

Boundary values are generated from the zod schema (`zod-fast-check`, or a custom walk of `_def`). Every case expects the same thing: the right 4xx, problem+json, **no 5xx**, and **no database changes** (see 4.6).

#### 4.5 Business negatives (manual catalog, section 5)
Repeats and idempotency, races, time windows, flags, geo and 18+, limits, someone else's signatures. These cases are written by hand in the scenarios. The generator will not invent them.

#### 4.6 Database state and side effects
- Helper `expectDbDelta(fn, { player: {freeRides: -1}, rideTicket: +0, honkLedger: [...], adminAction: +1, chainEvent: +0, analytics: ['ride_created'] })`: a snapshot before and after, on in-memory and on Postgres.
- Invariants after every scenario (a global `afterEach` in integration): the HONK/TEN4 ledger sum equals the balances; `freeRides` is within `[0, ceiling]`; a ticket is exactly one of "spent", "voided", "refunded"; a pool's shares sum to 10 000 bps; every admin change is recorded in `AdminAction` with a signature.
- For refusals: "nothing was written", except `ClientError` or `SignIn` where a write is required.
- Block 2: reconcile against the chain (escrow PDA balance, USDC/SOL accounts, `onLogs` events → `ChainEvent`), and webhook and poll on the same transaction.

#### 4.7 Fuzz and property tests
- **schemathesis** against the docker stack from PR #5 (`docker-compose.e2e.yml`), on the generated `openapi.json`. Modes: stateless (every route; checks `not_a_server_error`, `response_schema_conformance`, `status_code_conformance`, `content_type_conformance`) and stateful (create → get → confirm links). Authorization through a hook: keypair → nonce → verify → cookie; for admin, the dev key from `e2e/harness/api.mjs`. It runs nightly and by hand, and is not part of required PR CI: it is long-running and finds nondeterministic things.
- **fast-check** in vitest for domain functions: dividing a pool, `bps`, a ceiling < 50 %, promo codes (spelling normalization), "clean distance" points, and the week and season windows on `FakeClock`.

#### 4.8 How this fits on PR #5
- **Block 1 (no blockchain)** = in-process vitest + supertest on in-memory and Postgres (the bulk: the contract, the negative matrix, business negatives) + **smoke of every route** through `e2e/harness/api.mjs` against docker (one positive and one negative, with a schema check). That is 120+ routes: auth, lobby, rides free, promos, referrals, admin, editor, live without payment, stats, sns (on the stub).
- **Block 2 (local validator)**: routes that need a real chain: `rides/:id/payment|confirm|reconcile` (paid), `tickets/*`, `pools/:id/refund|payout`, `chain/settle`, `chain/webhook` (with real transaction signatures), `solana-pay/*`, `watch/:id/donation-orders/*`, `pledges/*`, an HONK burn when `HONK_PROGRAM_ID` is set, `actions/*` POST (blink transactions), `admin/pools/:id/hold`, plus the CLI `set_pool_rules` (pool v5). Negatives: someone else's transaction, the wrong amount or mint, a repeated signature, a transaction that is not finalized, a closed pool.
- In `e2e/catalog.mjs`, add an `API-*` section that is **generated from the spec**, so the PR #5 checklist and the gate do not diverge.

### 5. Catalog of negative scenarios by category

| Category | What we check | Example routes and codes |
|---|---|---|
| A. Access | no session, the wrong role, an expired session, a wallet removed from the allowlist, the wrong host or IP, no CSRF header | every `PlayerAuthGuard` → 401; admin/editor/mcp → 404; without `X-FC-Admin` → 403 |
| B. Ownership | someone else's ride, order, donation, or pledge; a driver's ride for a spectator | `GET /api/rides/:id` for someone else → 403/404; `pledges/:id/confirm` → 403; `tickets/orders/:id` → 403 |
| C. Input validation | schema, types, bounds, enum, extra fields, size, encoding | 400 `validation_error` with `errors[].path`; 413; 415 |
| D. State / FSM | an action in the wrong status | `start` on an unpaid ride → 409; `end` twice; `confirm` on a closed order → 409 `order_closed`; `ride_rechosen`; `pool_closed`, `rides_closed`, `road_not_sealed` |
| E. Idempotency and repeat | repeating the same signature, batch, promo code, or admin signature | `signature_reused`; a repeated batch `seq` is a no-op 200; an admin signature for a different action → 401; the nonce is single-use |
| F. Races | N parallel requests | double redeem, double confirm, webhook versus poll, hold versus claim, the last invite slot, double start (already present; extend it to `auth/guest`, `prize/board`, and the PR #3 ranked start) |
| G. Limits | each of the 10 buckets, the key (wallet or IP), window reset, Redis | 429 `rate_limited` problem+json; other routes are not affected; `/API/AUTH/` and a trailing `/` fall into the same bucket |
| H. Time | week and season windows, promo-code start and end, play-window, a 48 h hold, vesting | `ranked_window`, `too_early`, `waiting_review`, `held`; on `FakeClock`, exactly on the boundary and ±1 s |
| I. Flags and env | the feature is off | `live_feature_off`, `ranked_effects_off`, `payment_not_needed`, `tier_not_on_sale`, `not_sellable`; Pre-season: paid tickets are off, one attempt after the airdrop; `WEBHOOK_SECRET` is not set → 404; `HONK_PROGRAM_ID` → a signature is required |
| J. Geo and 18+ | a country or a state is blocked, sanctions, not 18+ | `POST /api/rides/:id/start {ranked:true}` with a `CF-IPCountry` from the list → 409 `ranked_ineligible`; a paid shift with no agreements → 409 `agreements_required`; with no header → fail-closed (decision 7: ranked refusal; in dev/test — `PRIZE_DEV_DEFAULT_COUNTRY`) |
| K. Money and the ledger | the balance does not go negative, ceilings, shares | `honk_balance`, `free_rides_ceiling/floor`, `ticket_cap`, `ranked_paid_cap`, `ranked_promo_cap`; the ticket-share ceiling < 50 % |
| L. Chain (block 2) | the transaction is the wrong one or is not final | `transaction_invalid`, `transaction_mismatch`, `pledge_tx_invalid`, `bad_donation_payment`, `wrong_account`, `retry` / `pending` |
| M. External dependencies | RPC, Redis, the AI provider, or SNS is unavailable | 503 with `checks` on `/api/health/ready`; `editor/jobs` → 503; `chain/fees` → 503; no 500 |
| N. Leaks | the response contains nothing extra | a strict response schema; someone else's wallet and IP are not visible to the player; the same admin 404 for "no route" and for "no access" |
| O. Transport | headers and format | `X-Request-Id` (the caller's own or a new one), `problem+json`, cookie `httpOnly`/`SameSite`/`Secure`, CORS, `Cache-Control` on `entities/bundle`, gzip |

### 6. Implementation plan

| Step | What | Where | Estimate |
|---|---|---|---|
| 0 | Done: PR #3 is merged into main; `auth/pair*` and `referrals*` are kept | — | — |
| 1 | `route-manifest.spec.ts` via DiscoveryService, and a generated draft spec of 151 routes (from the tables above); the gate in **report** mode, without failing | `server/test/contract` | 1 day |
| 2 | Zod response schemas + `@ZodResponse` + `ResponseSchemaInterceptor` (strict in test/dev); `checkedAgent` in `test/support/client.ts` and a shared validator for `e2e/harness/api.mjs`. Start with money: rides, tickets, pools, promo, referrals, prize, admin | `server/src/presentation/*/dto`, `test/support` | 3–4 days |
| 3 | The generated negative matrix (classes A, C, O) from the spec | `server/test/contract` | 2 days |
| 4 | Close the 16 routes no test calls and the 25 with no 2xx; PR #3 HTTP scenarios: guest, prize board, ranked start, geo, the weekly limits | `server/test/scenarios` | 2–3 days |
| 5 | The manual catalog D–N, `expectDbDelta`, and invariants in the integration `afterEach` | scenarios + integration | 3 days |
| 6 | Smoke of every route against docker (block 1) and chain routes on the validator (block 2) in PR #5 `e2e/`; `catalog.mjs` generates the `API-*` section from the spec | PR #5 | 2 days |
| 7 | Generation of `openapi.json` + schemathesis (nightly) + fast-check for the domain | `server/scripts`, CI | 1–2 days |
| 8 | The gate in **strict** mode: ≥ 1 positive and ≥ 2 negatives per route, 100 % of routes with a response schema, 0 routes outside the spec | CI | 0.5 day |


> §7 "Owner decisions" was moved to [`DECISIONS.md`](DECISIONS.md).
