# Контракт бэкенда — манифест и план тестирования

> Каждый HTTP-маршрут: схема входа и ответа, доступ, позитив и негатив. Решения бэкенда 1–10 (приняты 17.10.2026). Полный план — приложение A (бывший `backend_test_plan.md` (superseded, merged into docs/spec), текст без изменений): инвентарь 151 маршрута, карта покрытия, подход, каталог негативов.

## Часть 1. Манифест
### 1.1 Сейчас в коде (`origin/main`)
- 151 маршрут на `origin/main` после мержа PR #3: к прежним 149 добавлены `POST /api/auth/guest` и `GET /api/prize/board`. `auth/pair` (3) и `referrals` (3) с main сохранены.
- Вход проверяется zod (`ZodBody/ZodParams/ZodQuery`), схем ответов **нет** (0 / 151).
- 58 / 96 защищённых маршрутов без теста «нет доступа».
- Только polling, без WebSocket/SSE. Один webhook (`POST /api/chain/webhook`).

### 1.2 Правила
- **API-M-01** MUST: схемы — в zod, рядом с DTO. `openapi.json` — производный артефакт (решение 1).
- **API-M-02** MUST: у каждого маршрута есть `@ZodResponse`. Нарушение схемы ответа: test/dev → 500 и падение теста; production → warn (`RESPONSE_SCHEMA_CHECK=off|warn|strict`, решение 2).
- **API-M-03** MUST (детали для admin/editor — [`admin_security.md`](admin_security.md) ADM-M-09; в `origin/main` `.strict()` нет нигде, находка F06): лишние поля во входе — `.strict()` (400) для admin, editor и денежных маршрутов (`tickets`, `rides`, `promo`, `referrals`, `pledges`, `donations`, `chain/*`). Для `telemetry` и `client-error` — молча отбрасывать (решение 3).
- **API-M-04** MUST: gate — ≥ 1 позитив и ≥ 2 негатива на маршрут (хотя бы один бизнесовый). Для денежных и admin — ≥ 4 негатива и ≥ 1 тест на гонку или повтор. Первые 2 недели gate только отчитывается (решение 4). Для admin/editor-маршрутов gate закрывает матрица [`admin_security.md`](admin_security.md) 2.1 (`npm run test:admin-security`, `test:admin-security:integration`).
- **API-M-05** MUST: реестр `test/contract/routes.manifest.ts` совпадает с настоящими маршрутами (`DiscoveryService`). Класс доступа совпадает с guard'ами (приложение A §4.2).
- **API-M-06** MUST: ответ об ошибке — `ProblemDetails` с `code ∈ errorCodes` маршрута, никакого 5xx на неверный вход.
- **API-M-07** MUST: **чужой ресурс — везде `404`**, не `403`, без разницы в тексте ответа (решение 9). Это касается и реплеев: скрытая поездка → `404` ([`replays_streams.md`](replays_streams.md)).
- **API-M-08** MUST: гео без `CF-IPCountry` — fail-closed (ranked отказ). Для разработки — флаг `PRIZE_DEV_DEFAULT_COUNTRY` (решение 7).
- **API-M-09** MUST: у `set_pool_rules` есть админский HTTP-маршрут (решение 8).
- **API-M-10** MUST: schemathesis — ночью и вручную. fast-check — сразу, для денег и окон (решение 5).
- **API-M-11** MUST: тесты живут в `server/test/contract` и `server/test/scenarios`, docker-smoke и блок 2 — в `e2e/` PR #5 (решение 6). Отдельного порога покрытия строк сверх `test:census` нет (решение 10).
- **API-M-12** MUST: побочные эффекты проверяются `expectDbDelta`, инварианты леджера — после каждого сценария (приложение A §4.6).
- **API-M-13** MUST: новые маршруты из спецификаций входят в реестр с первого коммита (привилегированные — ещё и в реестр [`admin_security.md`](admin_security.md) 1.2 с матрицей ADM-T-01…12, ADM-M-21):
  - `GET /api/me/donations` (RPL-M-18);
  - `GET /api/pools/:id/results` (RID-M-19);
  - `POST /api/admin/chat/:eventId/hide` (RPL-M-27);
  - admin `set_pool_rules` (POOL-M-12).
  
  Удаляемые маршруты (`effects/:eventId/applied`, `watch/:id/honk/time`, `/honk/weather`) удаляются из реестра, тест на `404` остаётся. Маршруты пледжей остаются в реестре, но на devnet-запуске отвечают `403 pledges_disabled` (RPL-M-33, решение 51).

## Часть 2. План тестирования
Тесты — по приложению A: §4.3 (контрактная проверка существующих), §4.4 (матрица A — генерируемые негативы по доступу, CSRF/CORS, телу, params/query), §4.5 и §5 (бизнес-негативы), §4.7 (fuzz/property). Сводные id:
| id | Правило | Что |
|---|---|---|
| API-T-01 | M-01 | `openapi.json` генерируется из zod, diff в CI пустой |
| API-T-02 | M-02 | `checkedAgent()`: все ≈ 358 существующих HTTP-кейсов проходят схему ответа |
| API-T-03 | M-03 | лишнее поле на денежном маршруте → 400; на `telemetry` → 200 без поля |
| API-T-04 | M-04 | `route-manifest.spec.ts`: пороги кейсов на маршрут |
| API-T-05 | M-05 | маршрут без записи / guard не совпадает → падение |
| API-T-06 | M-06 | `negative-matrix.spec.ts`: никакого 5xx, problem+json |
| API-T-07 | M-07 | матрица B: чужой ресурс → 404 на всех маршрутах с `:id` (включая 106–117, 120, 130, 144–145) |
| API-T-08 | M-08 | ranked без `CF-IPCountry` → отказ; с флагом → страна по умолчанию |
| API-T-09 | M-09 | = POOL-T-14 |
| API-T-10 | M-10 | ночной job schemathesis; fast-check-спеки денег и окон |
| API-T-11 | M-11 | `test:census` |
| API-T-12 | M-12 | `expectDbDelta` в сценариях денег |
| API-T-13 | M-13 | реестр содержит новые маршруты; удалённые → 404 |

### Трассируемость
API-M-01…13 → запланированные id API-T-01…13. 13 MUST. Id — не написанный тест и не сотни уже сгенерированных кейсов. Исполняемая планка — [`../testing/COVERAGE_CONTRACT.md`](../testing/COVERAGE_CONTRACT.md).

---

## Приложение A. План тестирования бэкенда (бывший backend_test_plan.md, §0–6)
> Перенесено без изменений из `backend_test_plan.md` (superseded, merged into docs/spec) (17.10.2026); уровни заголовков сдвинуты на один. Нормативна Часть 1 этого файла; при расхождении прав манифест.

## План тестирования бэкенда FreightChain: каждый маршрут, валидация ответа, позитив и негатив

Дата: 17.10.2026. Анализ только чтением кода: тесты не запускались, в git ничего не отправлялось.
Ветки на 17.10.2026: `origin/main` (`3ab33d8`), PR #3 `cursor/ten4-tokenomics-6271` (`794fed8`). **PR #3 смержен в main** (`4e53f247`, текущий main `e8f338ad`). Строки ниже про «не смержен» и «нет в ветке PR #3» — снимок до мержа; маршруты `auth/pair`, `referrals`, `auth/guest` и `prize/board` сейчас все на main.

### 0. Коротко

| Показатель | Значение |
|---|---|
| HTTP-маршрутов в контроллерах (main) | **149** в 31 контроллере |
| Маршруты, пришедшие с PR #3 | **2**: `POST /api/auth/guest`, `GET /api/prize/board` (оба на main) |
| Изменённых в PR #3 | 3: `POST /api/rides`, `POST /api/rides/:id/start` (`ranked`, geo, `409 ranked_*`), `GET /api/me` (geo) |
| `auth/pair` ×3 и `referrals` ×3 | были только на main, пока PR #3 не влит. После мержа сохранены |
| Итого на main | **151** маршрут + 4 эндпоинта вне контроллеров (см. 1.3) |
| WebSocket / SSE | **нет**: live-режим полностью на опросе (polling). Исходящая WS-подписка `onLogs` к Solana есть, но это не наш эндпоинт |
| Webhook | 1: `POST /api/chain/webhook` (общий секрет в `x-webhook-secret` или `Authorization`, сравнение за постоянное время; без секрета маршрута нет, 404) |
| Маршрутов, которые вызывает хоть один HTTP-тест | **135 / 151** (16 не вызывает ни один) |
| …с проверенным 2xx | **126 / 151** |
| …хотя бы с одним негативным кодом (4xx/5xx) | **90 / 151** |
| …с ≥ 2 разными негативными кодами | **50 / 151** |
| …где тело ответа проверено хоть как-то (`toMatchObject`, поля) | 127 / 151, но только **частично** |
| …где ответ проверен **по схеме** | **0 / 151**: схем ответов в коде нет |
| Защищённых маршрутов без отдельного теста «нет доступа» (401 или 404) | **58 / 96** |
| Тесты уровня HTTP сейчас | ≈ 358 кейсов `it()` в `test/scenarios`, `test/http`, `test/integration` (сценарии идут дважды: in-memory и Postgres) + 24 скрипта `server/scripts/e2e-*.mjs` |
| PR #5 по API | 20 маршрутов, все уже покрыты сценариями. PR #5 в основном про страницы и UI |

**Как считали.** Маршруты брал из декораторов `@Controller/@Get/@Post/@Put` (local script `routes.py`, not in the repo). Покрытие считал по литералам путей в тестах и кодам рядом с ними: `.expect(NNN)`, `status === NNN` (local script `cov.py`, not in the repo). Это эвристика с погрешностью в несколько маршрутов: пути, собранные через `+`, переменные и клики в браузере она не видит. Точный инвентарь даст реестр маршрутов из метаданных Nest (п. 4.2). В репозитории уже есть похожий счётчик, `.claude/skills/test-census` (`npm run test:census -- features`), но позитивы и негативы он не различает.

### 1. Что есть в бэкенде с точки зрения тестов

#### 1.1 Конвейер запроса
`solanaPayCors` → `actionHeaders` → `browserCors` (точный список origin) → `compression` → `requestId` → `requestLog` → `legacySession` → **`jsonOnly`** (POST в form или text/plain даёт 415, кроме beacon `/api/rides/:id/end`) → `beaconBody` → JSON-парсер (100 KB, у `/api/editor` 256 KB, больше даёт 413) → `ridePage` (`/r/:id`) → глобальные guard'ы **`ThrottlerGuard`** (10 бакетов) и **`OriginGuard`** (CSRF: `403 bad_origin`; на storybook-хосте всё, кроме `/api/entities|editor`, даёт 404) → guard маршрута → `ZodValidationPipe` → CQRS-хендлер → `ProblemDetailsFilter`.

#### 1.2 Уровни доступа

| Класс | Guard | Отказ |
|---|---|---|
| публичный | — | — |
| гость/сессия (опц.) | `OptionalSessionGuard` | — |
| кошелёк | `PlayerAuthGuard` (cookie `fc_session`) | 401 `not signed in` / `session expired` |
| admin | `AdminGuard`: admin-хост, cookie `fc_admin`, кошелёк в `ADMIN_WALLETS`, на изменениях `X-FC-Admin: 1` | **404** на всё, 403 без заголовка |
| подписанное admin-действие | пара `…/challenge` → подпись → действие | 401 / 400 при неверной, старой или чужой подписи |
| editor | `EditorGuard`: storybook-хост, IP из allowlist, `fc_editor`, `EDITOR_WALLETS`, `X-FC-Editor` | 404 / 403 |
| MCP job | `McpJobGuard`: `x-fc-job`, задача `running`, без `X-Forwarded-For` | 404 |
| webhook | `WebhookSecretGuard` | 404 (секрет не задан) / 401 |
| CORS-public | `@CrossOriginPublic` (blinks, Solana Pay, webhook) | Origin не проверяется |

Ошибки отдаются в формате RFC 9457 `application/problem+json`: `{type, title, status, code, detail, requestId, instance, errors?}`. Коды: 400 `validation_error` / `malformed_json`, 401, 403, 404, 409 (доменные коды), 413, 415, 422, 429 `rate_limited`, 503. **Кода 428 в сервере нет.** В PR #3 18+ и гео дают 409 (`agreements_required`, `ranked_ineligible`).

Бакеты лимитов: `default` (на кошелёк или IP), `auth` + `auth-rps`, `promo`, `entities` + `entities-rps`, `editor` + `editor-rps`, `mcp` + `mcp-rps`. Хранилище в памяти или Redis.

#### 1.3 Эндпоинты вне контроллеров
- `GET /r/:id`: страница поездки с OG/Twitter-карточкой (middleware).
- `GET /.well-known/actions.json`: алиас `/actions.json` для blinks.
- `OPTIONS` preflight: Solana Pay, Actions, CORS-allowlist.
- Статика: лендинг и `client/` через `ServeStatic`, кроме `/api/*`.

#### 1.4 Схемы
- **Вход проверяется полностью:** у 116 из 149 маршрутов zod-схемы на body, query или params. Остальные 33 входа не принимают: GET без параметров и 4 POST (`logout` ×3, `auth/pair`). Схемы лежат рядом с контроллерами (`presentation/*/dto/*.dto.ts`).
- Лишние поля во входе **молча отбрасываются**: `.strict()` стоит только у `garage.loadout`.
- **Выход ничем не проверяется:** ответы описаны TS-интерфейсами (`Promise<XxxDto>`, ≈ 87 интерфейсов `*Dto` в `domain/`). Во время работы их никто не сверяет, OpenAPI нет. В [`docs/tech/backend-architecture.md`](../tech/backend-architecture.md) прямо записано, что «OpenAPI/Yaak generators… deliberately not adopted».
- Для каждого класса Nest обязателен unit-спек (`test/architecture/test-pyramid.spec.ts`): у всех 31 контроллера есть `*.http.controller.spec.ts`.


### 2. Инвентарь маршрутов (151 = 149 из main + 2 из PR #3)

«Вход» — zod-схемы из декораторов `@ZodBody/@ZodQuery/@ZodParams`. «Ответ» — заявленный TS-тип: схемы для него пока нет. POST без пометки отвечает 200 (`@HttpCode(200)`).

| # | Метод | Путь | Доступ | Вход (zod) | Ответ (TS-тип) | Примечание |
|---|---|---|---|---|---|---|
| 1 | GET | `/actions.json` | публичный · CORS-public | — | `ActionsJson` |  |
| 2 | GET | `/api/actions/hello` | публичный · CORS-public | — | `ActionCard` |  |
| 3 | POST | `/api/actions/hello` | публичный · CORS-public | Body:actionAccountBody | `ActionPost` |  |
| 4 | GET | `/api/actions/shift` | публичный · CORS-public | — | `ActionCard` |  |
| 5 | GET | `/api/actions/shift/:tier` | публичный · CORS-public | Params:actionTierParams | `ActionCard` |  |
| 6 | POST | `/api/actions/shift` | публичный · CORS-public | Query:actionTierQuery, Body:actionAccountBody | `ActionTx` |  |
| 7 | POST | `/api/actions/shift/:tier` | публичный · CORS-public | Params:actionTierParams, Body:actionAccountBody | `ActionTx` |  |
| 8 | POST | `/api/actions/go/:to` | публичный · CORS-public | Params:actionSiteParams, Body:actionAccountBody | `ActionLink` |  |
| 9 | GET | `/api/actions/ride/:id` | публичный · CORS-public | Params:rideIdParams | `ActionCard` |  |
| 10 | POST | `/api/actions/ride/:id` | публичный · CORS-public | Params:rideIdParams, Body:actionAccountBody | `ActionLink` |  |
| 11 | POST | `/api/actions/ride/:id/watch` | публичный · CORS-public | Params:rideIdParams, Body:actionAccountBody | `ActionLink` |  |
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
| 32 | POST | `/api/admin/auth/nonce` | admin-host, публичный вход (X-FC-Admin) | Body:challengeBody | `ChallengeDto` |  |
| 33 | POST | `/api/admin/auth/verify` | admin-host, публичный вход (X-FC-Admin) | Body:verifyBody | `AdminSignInResultDto` |  |
| 34 | POST | `/api/admin/auth/logout` | admin-host, публичный вход (X-FC-Admin) | — | `LogoutResultDto` |  |
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
| 45 | POST | `/api/auth/nonce` | публичный | Body:requestChallengeBody | `ChallengeDto` |  |
| 46 | POST | `/api/auth/pair` | публичный | — | `OpenPhonePairDto` | на main (сохранены при мерже PR #3) |
| 47 | GET | `/api/auth/pair/:id` | публичный | Params:pairParams | `PollPhonePairDto` | на main (сохранены при мерже PR #3) |
| 48 | POST | `/api/auth/pair/:id/claim` | кошелёк (fc_session) | Params:pairParams | `(inline)` | на main (сохранены при мерже PR #3) |
| 49 | POST | `/api/auth/verify` | публичный | Body:verifyBody | `SignInResultDto` |  |
| 50 | POST | `/api/auth/logout` | публичный | — | `LogoutResultDto` |  |
| 51 | GET | `/api/me` | кошелёк (fc_session) | — | `MeDto` | PR3: + geo |
| 52 | POST | `/api/chain/webhook` | webhook secret · CORS-public | Body:chainWebhookBody | `ChainWebhookResultDto` |  |
| 53 | GET | `/api/chain/fees` | публичный | Query:chainFeesQuery | `ChainFeesDto` |  |
| 54 | GET | `/api/tiers` | публичный | — | `TiersDto` |  |
| 55 | GET | `/api/pool` | публичный | — | `PoolDto` |  |
| 56 | GET | `/api/leaderboard` | гость/сессия (опц.) | Query:leaderboardQuery | `LeaderboardDto` |  |
| 57 | GET | `/api/garage` | кошелёк (fc_session) | — | `GarageDto` |  |
| 58 | POST | `/api/garage/loadout` | кошелёк (fc_session) | Body:saveGarageBody | `GarageDto` |  |
| 59 | POST | `/api/pledges` | кошелёк (fc_session) | Body:createPledgeBody | `CreatedPledgeDto` |  |
| 60 | GET | `/api/rides/:id/pledges` | публичный | Params:pledgeRideIdParams | `PledgeDto[]` |  |
| 61 | POST | `/api/pledges/:id/confirm` | кошелёк (fc_session) | Params:pledgeIdParams, Body:confirmPledgeBody | `PledgeDto` |  |
| 62 | GET | `/api/pledges/:id` | публичный | Params:pledgeIdParams | `PledgeDto` |  |
| 63 | GET | `/api/pools` | публичный | — | `PoolListDto` |  |
| 64 | GET | `/api/pools/:id` | публичный | Params:poolIdParams | `PrizePoolDetailDto` |  |
| 65 | GET | `/api/pools/:id/standings` | публичный | Params:poolIdParams | `PoolStandingsDto` |  |
| 66 | POST | `/api/promo/redeem` | кошелёк (fc_session) | Body:redeemPromoBody | `PromoRedeemedDto` |  |
| 67 | GET | `/api/pools/:id/refund` | кошелёк (fc_session) | Params:poolIdParams | `RefundTransactionDto` |  |
| 68 | GET | `/api/pools/:id/payout` | кошелёк (fc_session) | Params:poolIdParams | `PayoutTransactionsDto` |  |
| 69 | POST | `/api/chain/settle` | кошелёк (fc_session) | Body:confirmTicketOrderBody | `SettledSignatureDto` |  |
| 70 | GET | `/api/promo/mine` | кошелёк (fc_session) | — | `MyPromosDto` |  |
| 71 | GET | `/api/wardrobe` | кошелёк (fc_session) | — | `WardrobeDto` |  |
| 72 | POST | `/api/wardrobe/equip` | кошелёк (fc_session) | Body:equipCosmeticBody | `WardrobeDto` |  |
| 73 | POST | `/api/tickets` | кошелёк (fc_session) | Body:createTicketOrderBody | `TicketOrderDto` |  |
| 74 | GET | `/api/tickets/pending` | кошелёк (fc_session) | — | `PendingTicketOrderDto` |  |
| 75 | GET | `/api/tickets/orders/:id` | кошелёк (fc_session) | Params:orderIdParams | `TicketOrderDto` |  |
| 76 | GET | `/api/tickets/orders/:id/payment` | кошелёк (fc_session) | Params:orderIdParams | `TicketPaymentDto` |  |
| 77 | POST | `/api/tickets/orders/:id/confirm` | кошелёк (fc_session) | Params:orderIdParams, Body:confirmTicketOrderBody | `ConfirmTicketOrderResultDto` |  |
| 78 | POST | `/api/tickets/orders/:id/reconcile` | кошелёк (fc_session) | Params:orderIdParams | `ReconcileTicketOrderResultDto` |  |
| 79 | POST | `/api/editor/auth/nonce` | editor-host+IP, публичный вход (X-FC-Editor) | Body:requestChallengeBody | `ChallengeDto` |  |
| 80 | POST | `/api/editor/auth/verify` | editor-host+IP, публичный вход (X-FC-Editor) | Body:verifyBody | `EditorSignInResultDto` |  |
| 81 | POST | `/api/editor/auth/logout` | editor-host+IP, публичный вход (X-FC-Editor) | — | `LogoutResultDto` |  |
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
| 96 | GET | `/api/editor/mcp/entities` | MCP job (x-fc-job), без XFF | — | `EntityRowDto[]` |  |
| 97 | GET | `/api/editor/mcp/entities/:id` | MCP job (x-fc-job), без XFF | Params:entityIdParams | `EntityHeadDto` |  |
| 98 | GET | `/api/editor/mcp/configs` | MCP job (x-fc-job), без XFF | — | `McpConfigsDto` |  |
| 99 | POST | `/api/editor/mcp/entities/:id/drafts` | MCP job (x-fc-job), без XFF | Params:entityIdParams, Body:mcpDraftBody | `RevisionDto` |  |
| 100 | GET | `/api/entities/bundle` | публичный | — | `EntityBundleDto` |  |
| 101 | GET | `/api/health/live` | публичный | — | `LivenessDto` |  |
| 102 | GET | `/api/health/ready` | публичный | — | `ReadinessDto` |  |
| 103 | GET | `/api/honk` | кошелёк (fc_session) | — | `HonkAccountDto` |  |
| 104 | GET | `/api/honk/catalog` | публичный | — | `HonkCatalogEntry[]` |  |
| 105 | POST | `/api/honk/visuals` | кошелёк (fc_session) | Body:honkVisualBody | `HonkVisualResult` |  |
| 106 | POST | `/api/watch/:id/honk` | кошелёк (fc_session) | Params:rideIdParams, Body:honkBurnBody | `HonkBurnResult` |  |
| 107 | POST | `/api/watch/:id/honk/time` | кошелёк (fc_session) | Params:rideIdParams, Body:honkTimeBody | `HonkTimeBurnResult` |  |
| 108 | POST | `/api/watch/:id/honk/weather` | кошелёк (fc_session) | Params:rideIdParams, Body:honkWeatherBody | `HonkWeatherBurnResult` |  |
| 109 | GET | `/api/watch/:id` | публичный | Params:rideIdParams, Query:watchQuery | `WatchDto` |  |
| 110 | GET | `/api/watch/:id/road` | публичный | Params:rideIdParams, Query:roadPlanQuery | `RoadPlanDto` |  |
| 111 | POST | `/api/watch/:id/messages` | кошелёк (fc_session) | Params:rideIdParams, Body:messageBody | `RideEventDto` |  |
| 112 | POST | `/api/watch/:id/donations` | кошелёк (fc_session) | Params:rideIdParams, Body:donationBody | `RideEventDto` |  |
| 113 | POST | `/api/watch/:id/donation-orders` | кошелёк (fc_session) | Params:rideIdParams, Body:donationBody | `DonationOrderDto` |  |
| 114 | POST | `/api/watch/:id/donation-orders/:orderId/confirm` | кошелёк (fc_session) | Params:orderParams, Body:confirmDonationBody | `ConfirmDonationResultDto` |  |
| 115 | POST | `/api/watch/:id/donation-orders/:orderId/reconcile` | кошелёк (fc_session) | Params:orderParams | `ReconcileDonationResultDto` |  |
| 116 | GET | `/api/rides/:id/inbox` | кошелёк (fc_session) | Params:rideIdParams, Query:inboxQuery | `InboxDto` |  |
| 117 | POST | `/api/rides/:id/mutes` | кошелёк (fc_session) | Params:rideIdParams, Body:muteBody | `MuteDto` |  |
| 118 | POST | `/api/rides/:id/effects/:eventId/applied` | кошелёк (fc_session) | Params:effectParams, Body:appliedBody | `RideEventDto` |  |
| 119 | GET | `/api/live` | гость/сессия (опц.) | Query:liveQuery | `LiveFeedDto` |  |
| 120 | GET | `/api/replays` | публичный | Query:replaysQuery | `ReplaysDto` |  |
| 121 | GET | `/api/profile` | кошелёк (fc_session) | — | `ProfileDto` |  |
| 122 | PUT | `/api/profile/agreements` | кошелёк (fc_session) | Body:agreementsBody | `AgreementsDto` |  |
| 123 | GET | `/api/referrals` | кошелёк (fc_session) | — | `ReferralView` | на main (сохранены при мерже PR #3) |
| 124 | POST | `/api/referrals/bind` | кошелёк (fc_session) | Body:bindReferralBody | `ReferralView` | на main (сохранены при мерже PR #3) |
| 125 | POST | `/api/referrals/gift` | кошелёк (fc_session) | Body:giftReferralBody | `ReferralView` | на main (сохранены при мерже PR #3) |
| 126 | GET | `/api/rides/:id/public` | публичный | Params:rideIdParams | `PublicRideDto` |  |
| 127 | POST | `/api/rides` | кошелёк (fc_session) | Body:createRideBody | `RideDto` | PR3: + geo-заголовки |
| 128 | GET | `/api/rides/pending` | кошелёк (fc_session) | — | `PendingRideDto` |  |
| 129 | GET | `/api/rides/:id` | кошелёк (fc_session) | Params:rideIdParams | `RideDto` |  |
| 130 | GET | `/api/rides/:id/replays` | кошелёк (fc_session) | Params:rideIdParams | `RideReplaysDto` |  |
| 131 | GET | `/api/rides/:id/payment` | кошелёк (fc_session) | Params:rideIdParams | `PaymentInstructionsDto` |  |
| 132 | POST | `/api/rides/:id/confirm` | кошелёк (fc_session) | Params:rideIdParams, Body:confirmPaymentBody | `ConfirmPaymentResultDto` |  |
| 133 | POST | `/api/rides/:id/reconcile` | кошелёк (fc_session) | Params:rideIdParams | `ReconcilePaymentResultDto` |  |
| 134 | POST | `/api/rides/:id/start` | кошелёк (fc_session) | Params:rideIdParams, Body:startRideBody | `RideDto` | PR3: + `ranked`, geo, 409 ranked_* |
| 135 | POST | `/api/rides/:id/heartbeat` | кошелёк (fc_session) | Params:rideIdParams, Body:heartbeatBody | `RideDto` |  |
| 136 | POST | `/api/rides/:id/batches` | кошелёк (fc_session) | Params:rideIdParams, Body:batchBody | `BatchReceiptDto` |  |
| 137 | POST | `/api/rides/:id/end` | кошелёк (fc_session) | Params:rideIdParams, Body:endRideBody | `RideDto` |  |
| 138 | GET | `/api/sns/reverse` | публичный | Query:snsReverseQuery | `SnsReverseDto` |  |
| 139 | GET | `/api/sns/resolve` | публичный | Query:snsResolveQuery | `SnsResolutionDto` |  |
| 140 | GET | `/api/solana-pay/rides/:id` | публичный · CORS-public | Params:solanaPayIdParams | `SolanaPayLinkDto` |  |
| 141 | POST | `/api/solana-pay/rides/:id` | публичный · CORS-public | Params:solanaPayIdParams, Body:solanaPayAccount | `SolanaPayTransactionDto` |  |
| 142 | GET | `/api/solana-pay/orders/:id` | публичный · CORS-public | Params:solanaPayIdParams | `SolanaPayLinkDto` |  |
| 143 | POST | `/api/solana-pay/orders/:id` | публичный · CORS-public | Params:solanaPayIdParams, Body:solanaPayAccount | `SolanaPayTransactionDto` |  |
| 144 | GET | `/api/solana-pay/donations/:id` | публичный · CORS-public | Params:solanaPayIdParams | `SolanaPayLinkDto` |  |
| 145 | POST | `/api/solana-pay/donations/:id` | публичный · CORS-public | Params:solanaPayIdParams, Body:solanaPayAccount | `SolanaPayTransactionDto` |  |
| 146 | GET | `/api/stats` | публичный | — | `GlobalStatsDto` |  |
| 147 | GET | `/api/stats/daily` | публичный | — | `DailyStatsDto[]` |  |
| 148 | POST | `/api/telemetry` | гость/сессия (опц.) | Body:telemetryBody | `TelemetryAckDto` |  |
| 149 | POST | `/api/client-error` | гость/сессия (опц.) | Body:clientErrorBody | `ClientErrorAckDto` |  |
| 150 | POST | `/api/auth/guest` | публичный | — | `SignInResultDto` | на main (пришли с PR #3) |
| 151 | GET | `/api/prize/board` | публичный | Query:prizeBoardQuery | `PrizeBoardDto` | на main (пришли с PR #3) |
### 3. Карта покрытия

Источники: `scenario` — `server/test/scenarios/*` (запуск через `test/http/flows.spec.ts` на in-memory и через `test/integration/flows.integration.spec.ts` на Postgres); `http` — `server/test/http/*.spec.ts`; `integration` — `server/test/integration/*.spec.ts`, включая `concurrency`; `e2e-script` — `server/scripts/e2e-*.mjs`; `pr5` — `e2e/` из PR #5; `support` — хелперы `test/support`. Негативные коды собраны со всех источников.

| # | Метод | Путь | Позитив | Негатив (коды) | Тело | Где | Пробел |
|---|---|---|---|---|---|---|---|
| 1 | GET | `/actions.json` | ✅ | ❌ | — | e2e-script | <2 негативов |
| 2 | GET | `/api/actions/hello` | ✅ | ❌ | частично | scenario | <2 негативов |
| 3 | POST | `/api/actions/hello` | ✅ | ❌ | частично | scenario | <2 негативов |
| 4 | GET | `/api/actions/shift` | ✅ | ❌ | частично | scenario | <2 негативов |
| 5 | GET | `/api/actions/shift/:tier` | ❌ | 400 | — | e2e-script | нет 2xx, <2 негативов |
| 6 | POST | `/api/actions/shift` | ✅ | ❌ | частично | scenario | <2 негативов |
| 7 | POST | `/api/actions/shift/:tier` | ❌ | 400, 409, 503 | частично | e2e-script, scenario | нет 2xx |
| 8 | POST | `/api/actions/go/:to` | ❌ | 400 | частично | e2e-script, scenario | нет 2xx, <2 негативов |
| 9 | GET | `/api/actions/ride/:id` | ✅ | 404 | частично | e2e-script, scenario | <2 негативов |
| 10 | POST | `/api/actions/ride/:id` | ❌ | ❌ | — | e2e-script | нет 2xx, <2 негативов |
| 11 | POST | `/api/actions/ride/:id/watch` | ✅ | ❌ | частично | scenario | <2 негативов |
| 12 | GET | `/api/admin/queue/count` | ✅ | ❌ | частично | scenario | <2 негативов, нет 404 без доступа |
| 13 | GET | `/api/admin/players` | ✅ | 400 | частично | scenario | <2 негативов, нет 404 без доступа |
| 14 | GET | `/api/admin/players/:wallet` | ✅ | 400 | частично | scenario | <2 негативов, нет 404 без доступа |
| 15 | GET | `/api/admin/pools` | ✅ | ❌ | частично | scenario | <2 негативов, нет 404 без доступа |
| 16 | GET | `/api/admin/pools/:id` | ❌ | 400, 404 | частично | scenario | нет 2xx |
| 17 | GET | `/api/admin/stats` | ✅ | 400 | частично | scenario | <2 негативов, нет 404 без доступа |
| 18 | GET | `/api/admin/sessions` | ✅ | 400 | частично | scenario | <2 негативов, нет 404 без доступа |
| 19 | GET | `/api/admin/pool-payouts` | ✅ | ❌ | частично | e2e-script, scenario | <2 негативов, нет 404 без доступа |
| 20 | POST | `/api/admin/pools/:id/hold/challenge` | ✅ | ❌ | — | scenario | <2 негативов, нет 404 без доступа |
| 21 | POST | `/api/admin/pools/:id/hold` | ✅ | 401 | частично | scenario | <2 негативов, нет 404 без доступа |
| 22 | GET | `/api/admin/promos` | ✅ | 400, 401, 404 | частично | e2e-script, scenario | — |
| 23 | GET | `/api/admin/promos/redemptions` | ✅ | 400, 404 | частично | scenario | — |
| 24 | POST | `/api/admin/promos/challenge` | ✅ | 400, 404, 409 | частично | scenario | — |
| 25 | POST | `/api/admin/promos` | ✅ | 400, 401, 403, 404 | частично | scenario | — |
| 26 | POST | `/api/admin/promos/:code/disable` | ✅ | 401, 404 | частично | scenario | — |
| 27 | GET | `/api/admin/settings` | ✅ | 404 | частично | integration, scenario | <2 негативов |
| 28 | POST | `/api/admin/settings/challenge` | ✅ | 400, 404 | частично | integration, scenario | — |
| 29 | POST | `/api/admin/settings` | ✅ | 400, 401, 403, 404 | частично | integration, scenario | — |
| 30 | POST | `/api/admin/players/free-rides/challenge` | ✅ | 404 | — | integration, scenario | <2 негативов |
| 31 | POST | `/api/admin/players/free-rides` | ✅ | 400, 401, 404 | частично | integration, scenario | — |
| 32 | POST | `/api/admin/auth/nonce` | ✅ | 403, 404 | частично | http, integration, scenario, support | — |
| 33 | POST | `/api/admin/auth/verify` | ✅ | 401 | частично | http, integration, scenario, support | <2 негативов |
| 34 | POST | `/api/admin/auth/logout` | ✅ | ❌ | — | scenario | <2 негативов |
| 35 | GET | `/api/admin/overview` | ✅ | 403, 404 | частично | e2e-script, http, scenario | — |
| 36 | GET | `/api/admin/rides` | ✅ | 400, 404 | частично | e2e-script, http, scenario | — |
| 37 | GET | `/api/admin/replays` | ✅ | ❌ | частично | scenario | <2 негативов, нет 404 без доступа |
| 38 | GET | `/api/admin/rides/:id` | ✅ | ❌ | частично | scenario | <2 негативов, нет 404 без доступа |
| 39 | POST | `/api/admin/rides/:id/challenge` | ✅ | ❌ | частично | integration, scenario | <2 негативов, нет 404 без доступа |
| 40 | POST | `/api/admin/rides/:id/verdict` | ✅ | 400, 401, 403, 404 | частично | integration, scenario | — |
| 41 | POST | `/api/admin/rides/:id/rejudge` | ✅ | 400, 403 | частично | scenario | нет 404 без доступа |
| 42 | GET | `/api/admin/signins` | ✅ | 400 | частично | http, scenario | <2 негативов, нет 404 без доступа |
| 43 | GET | `/api/admin/actions` | ✅ | ❌ | частично | e2e-script, scenario | <2 негативов, нет 404 без доступа |
| 44 | GET | `/api/admin/logs` | ✅ | ❌ | частично | scenario | <2 негативов, нет 404 без доступа |
| 45 | POST | `/api/auth/nonce` | ✅ | 400, 404, 413, 429 | частично | e2e-script, http, integration, scenario, support | — |
| 46 | POST | `/api/auth/pair` | ✅ | ❌ | частично | scenario | <2 негативов |
| 47 | GET | `/api/auth/pair/:id` | ✅ | 404 | частично | scenario | <2 негативов |
| 48 | POST | `/api/auth/pair/:id/claim` | ✅ | ❌ | частично | scenario | <2 негативов, нет 401 без доступа |
| 49 | POST | `/api/auth/verify` | ✅ | 400, 401 | частично | e2e-script, http, integration, scenario, support | — |
| 50 | POST | `/api/auth/logout` | ✅ | ❌ | частично | scenario | <2 негативов |
| 51 | GET | `/api/me` | ✅ | 400, 401, 409, 429, 500 | частично | e2e-script, http, integration, scenario | — |
| 52 | POST | `/api/chain/webhook` | ✅ | 401, 404 | частично | scenario | — |
| 53 | GET | `/api/chain/fees` | ✅ | 400, 503 | частично | scenario | — |
| 54 | GET | `/api/tiers` | ✅ | 429 | частично | e2e-script, http, scenario | <2 негативов |
| 55 | GET | `/api/pool` | ✅ | ❌ | частично | e2e-script, integration, scenario | <2 негативов |
| 56 | GET | `/api/leaderboard` | ✅ | 400 | частично | e2e-script, scenario | <2 негативов |
| 57 | GET | `/api/garage` | ✅ | 400, 401 | частично | e2e-script, scenario | — |
| 58 | POST | `/api/garage/loadout` | ✅ | 400, 401, 409 | частично | scenario | — |
| 59 | POST | `/api/pledges` | ✅ | 400, 401 | частично | integration, scenario | — |
| 60 | GET | `/api/rides/:id/pledges` | ✅ | ❌ | частично | scenario | <2 негативов |
| 61 | POST | `/api/pledges/:id/confirm` | ✅ | 403 | частично | integration, scenario | <2 негативов, нет 401 без доступа |
| 62 | GET | `/api/pledges/:id` | ✅ | ❌ | частично | scenario | <2 негативов |
| 63 | GET | `/api/pools` | ✅ | ❌ | частично | e2e-script, scenario | <2 негативов |
| 64 | GET | `/api/pools/:id` | ✅ | 400, 401, 404 | частично | scenario | — |
| 65 | GET | `/api/pools/:id/standings` | ✅ | 400, 404 | частично | scenario | — |
| 66 | POST | `/api/promo/redeem` | ✅ | 400, 401, 404, 409, 415, 429 | частично | http, integration, scenario | — |
| 67 | GET | `/api/pools/:id/refund` | ✅ | 409 | частично | scenario | <2 негативов, нет 401 без доступа |
| 68 | GET | `/api/pools/:id/payout` | ❌ | 403 | — | scenario | нет 2xx, <2 негативов, нет 401 без доступа |
| 69 | POST | `/api/chain/settle` | ✅ | ❌ | частично | scenario | <2 негативов, нет 401 без доступа |
| 70 | GET | `/api/promo/mine` | ✅ | 401 | частично | e2e-script, http, scenario | <2 негативов |
| 71 | GET | `/api/wardrobe` | ✅ | 401 | частично | e2e-script, scenario | <2 негативов |
| 72 | POST | `/api/wardrobe/equip` | ✅ | 400, 401 | частично | scenario | — |
| 73 | POST | `/api/tickets` | ✅ | 400, 401, 404, 409, 503 | частично | scenario | — |
| 74 | GET | `/api/tickets/pending` | ✅ | ❌ | частично | scenario | <2 негативов, нет 401 без доступа |
| 75 | GET | `/api/tickets/orders/:id` | ✅ | 400, 403, 404 | частично | scenario | нет 401 без доступа |
| 76 | GET | `/api/tickets/orders/:id/payment` | ✅ | ❌ | частично | scenario | <2 негативов, нет 401 без доступа |
| 77 | POST | `/api/tickets/orders/:id/confirm` | ✅ | ❌ | частично | scenario | <2 негативов, нет 401 без доступа |
| 78 | POST | `/api/tickets/orders/:id/reconcile` | ❌ | ❌ | — | — | нет 2xx, <2 негативов, нет 401 без доступа |
| 79 | POST | `/api/editor/auth/nonce` | ✅ | 404 | частично | http, integration, scenario | <2 негативов |
| 80 | POST | `/api/editor/auth/verify` | ✅ | ❌ | частично | http, integration, scenario | <2 негативов |
| 81 | POST | `/api/editor/auth/logout` | ❌ | 403 | — | http | нет 2xx, <2 негативов |
| 82 | GET | `/api/editor/me` | ✅ | 404 | частично | http, integration, scenario | <2 негативов |
| 83 | GET | `/api/editor/entities` | ✅ | 404 | частично | integration, scenario | <2 негативов |
| 84 | GET | `/api/editor/entities/:id` | ✅ | ❌ | частично | scenario | <2 негативов, нет 404 без доступа |
| 85 | GET | `/api/editor/entities/:id/revisions` | ✅ | ❌ | частично | scenario | <2 негативов, нет 404 без доступа |
| 86 | GET | `/api/editor/revisions/:revId` | ❌ | 404 | частично | scenario | нет 2xx, <2 негативов |
| 87 | POST | `/api/editor/entities/:id/drafts` | ✅ | 403, 413, 422 | частично | http, integration, scenario | нет 404 без доступа |
| 88 | POST | `/api/editor/entities/:id/restore` | ✅ | ❌ | частично | scenario | <2 негативов, нет 404 без доступа |
| 89 | POST | `/api/editor/entities/:id/publish/challenge` | ✅ | ❌ | частично | integration, scenario | <2 негативов, нет 404 без доступа |
| 90 | POST | `/api/editor/entities/:id/publish` | ✅ | 401 | частично | integration, scenario | <2 негативов, нет 404 без доступа |
| 91 | POST | `/api/editor/jobs` | ❌ | 403, 503 | частично | http, scenario | нет 2xx, нет 404 без доступа |
| 92 | GET | `/api/editor/jobs` | ✅ | 429 | частично | integration, scenario | <2 негативов, нет 404 без доступа |
| 93 | GET | `/api/editor/jobs/:id` | ✅ | 404 | частично | scenario | <2 негативов |
| 94 | GET | `/api/editor/jobs/:id/events` | ✅ | 404 | частично | scenario | <2 негативов |
| 95 | POST | `/api/editor/jobs/:id/cancel` | ✅ | ❌ | частично | scenario | <2 негативов, нет 404 без доступа |
| 96 | GET | `/api/editor/mcp/entities` | ✅ | 404 | частично | scenario | <2 негативов |
| 97 | GET | `/api/editor/mcp/entities/:id` | ❌ | ❌ | — | — | нет 2xx, <2 негативов, нет 404 без доступа |
| 98 | GET | `/api/editor/mcp/configs` | ✅ | 404 | частично | scenario | <2 негативов |
| 99 | POST | `/api/editor/mcp/entities/:id/drafts` | ✅ | 403, 404, 409 | частично | scenario | — |
| 100 | GET | `/api/entities/bundle` | ✅ | ❌ | частично | http, integration, scenario | <2 негативов |
| 101 | GET | `/api/health/live` | ✅ | ❌ | частично | http, scenario | <2 негативов |
| 102 | GET | `/api/health/ready` | ✅ | ❌ | частично | scenario | <2 негативов |
| 103 | GET | `/api/honk` | ✅ | ❌ | частично | e2e-script, scenario | <2 негативов, нет 401 без доступа |
| 104 | GET | `/api/honk/catalog` | ❌ | ❌ | — | — | нет 2xx, <2 негативов |
| 105 | POST | `/api/honk/visuals` | ✅ | 409 | частично | scenario | <2 негативов, нет 401 без доступа |
| 106 | POST | `/api/watch/:id/honk` | ❌ | ❌ | — | — | нет 2xx, <2 негативов, нет 401 без доступа |
| 107 | POST | `/api/watch/:id/honk/time` | ❌ | ❌ | — | — | нет 2xx, <2 негативов, нет 401 без доступа |
| 108 | POST | `/api/watch/:id/honk/weather` | ❌ | ❌ | — | — | нет 2xx, <2 негативов, нет 401 без доступа |
| 109 | GET | `/api/watch/:id` | ✅ | 400, 403, 404 | частично | e2e-script, scenario | — |
| 110 | GET | `/api/watch/:id/road` | ✅ | 400, 404 | частично | e2e-script, scenario | — |
| 111 | POST | `/api/watch/:id/messages` | ✅ | 400, 401, 403, 409 | частично | e2e-script, integration, scenario | — |
| 112 | POST | `/api/watch/:id/donations` | ✅ | 400, 403, 429 | частично | e2e-script, integration, scenario | нет 401 без доступа |
| 113 | POST | `/api/watch/:id/donation-orders` | ✅ | ❌ | частично | integration, scenario | <2 негативов, нет 401 без доступа |
| 114 | POST | `/api/watch/:id/donation-orders/:orderId/confirm` | ✅ | 400, 409 | частично | integration, scenario | нет 401 без доступа |
| 115 | POST | `/api/watch/:id/donation-orders/:orderId/reconcile` | ❌ | ❌ | — | — | нет 2xx, <2 негативов, нет 401 без доступа |
| 116 | GET | `/api/rides/:id/inbox` | ✅ | 401, 404 | частично | scenario | — |
| 117 | POST | `/api/rides/:id/mutes` | ✅ | 400, 404 | частично | integration, scenario | нет 401 без доступа |
| 118 | POST | `/api/rides/:id/effects/:eventId/applied` | ✅ | 400, 404, 409 | частично | integration, scenario | нет 401 без доступа |
| 119 | GET | `/api/live` | ✅ | 403 | частично | e2e-script, scenario | <2 негативов |
| 120 | GET | `/api/replays` | ✅ | 400 | частично | scenario | <2 негативов |
| 121 | GET | `/api/profile` | ✅ | 401 | частично | integration, scenario | <2 негативов |
| 122 | PUT | `/api/profile/agreements` | ✅ | 400 | частично | integration, scenario, support | <2 негативов, нет 401 без доступа |
| 123 | GET | `/api/referrals` | ✅ | 401 | частично | integration, scenario | <2 негативов |
| 124 | POST | `/api/referrals/bind` | ✅ | 400, 409 | частично | integration, scenario | нет 401 без доступа |
| 125 | POST | `/api/referrals/gift` | ✅ | 400 | частично | scenario | <2 негативов, нет 401 без доступа |
| 126 | GET | `/api/rides/:id/public` | ❌ | ❌ | — | — | нет 2xx, <2 негативов |
| 127 | POST | `/api/rides` | ✅ | 400, 403, 404, 409, 415 | частично | e2e-script, http, integration, scenario | нет 401 без доступа |
| 128 | GET | `/api/rides/pending` | ✅ | ❌ | частично | e2e-script, scenario | <2 негативов, нет 401 без доступа |
| 129 | GET | `/api/rides/:id` | ✅ | 401, 403, 404, 409 | частично | e2e-script, integration, scenario | — |
| 130 | GET | `/api/rides/:id/replays` | ✅ | ❌ | частично | scenario | <2 негативов, нет 401 без доступа |
| 131 | GET | `/api/rides/:id/payment` | ✅ | 404, 409 | частично | scenario | нет 401 без доступа |
| 132 | POST | `/api/rides/:id/confirm` | ✅ | 400, 404, 409 | частично | integration, scenario | нет 401 без доступа |
| 133 | POST | `/api/rides/:id/reconcile` | ✅ | 404 | частично | integration, scenario | <2 негативов, нет 401 без доступа |
| 134 | POST | `/api/rides/:id/start` | ✅ | 400, 409 | частично | e2e-script, http, integration, scenario | нет 401 без доступа |
| 135 | POST | `/api/rides/:id/heartbeat` | ✅ | 400, 404, 409, 500 | частично | e2e-script, integration, scenario | нет 401 без доступа |
| 136 | POST | `/api/rides/:id/batches` | ✅ | 400, 401, 404, 409, 429 | частично | e2e-script, integration, scenario, support | — |
| 137 | POST | `/api/rides/:id/end` | ✅ | 401, 409, 500 | частично | e2e-script, http, integration, scenario | — |
| 138 | GET | `/api/sns/reverse` | ❌ | ❌ | — | — | нет 2xx, <2 негативов |
| 139 | GET | `/api/sns/resolve` | ❌ | ❌ | — | — | нет 2xx, <2 негативов |
| 140 | GET | `/api/solana-pay/rides/:id` | ✅ | ❌ | частично | http, scenario | <2 негативов |
| 141 | POST | `/api/solana-pay/rides/:id` | ✅ | 404 | частично | scenario | <2 негативов |
| 142 | GET | `/api/solana-pay/orders/:id` | ❌ | ❌ | — | — | нет 2xx, <2 негативов |
| 143 | POST | `/api/solana-pay/orders/:id` | ❌ | ❌ | — | — | нет 2xx, <2 негативов |
| 144 | GET | `/api/solana-pay/donations/:id` | ❌ | ❌ | — | — | нет 2xx, <2 негативов |
| 145 | POST | `/api/solana-pay/donations/:id` | ❌ | ❌ | — | — | нет 2xx, <2 негативов |
| 146 | GET | `/api/stats` | ✅ | ❌ | частично | integration, scenario | <2 негативов |
| 147 | GET | `/api/stats/daily` | ✅ | ❌ | частично | scenario | <2 негативов |
| 148 | POST | `/api/telemetry` | ✅ | ❌ | частично | scenario | <2 негативов |
| 149 | POST | `/api/client-error` | ✅ | 400, 403 | частично | http, scenario | — |
| 150 | POST | `/api/auth/guest` | ❌ | ❌ | — | только unit-спек контроллера | нет 2xx, <2 негативов |
| 151 | GET | `/api/prize/board` | ❌ | ❌ | — | только unit-спек контроллера | нет 2xx, <2 негативов |
#### 3.1 Главные пробелы

1. **Ответы не проверяются по схеме ни на одном маршруте.** Сценарии сверяют отдельные поля (`toMatchObject`). Новое или лишнее поле, утечку (например, IP в sign-ins или чужой кошелёк) и смену типа (`balance` как строка, а не число) они не заметят.
2. **16 маршрутов не вызывает ни один HTTP-тест**, и половина из них связана с деньгами или цепочкой:
   - сжигание HONK/TEN4: `POST /api/watch/:id/honk`, `/honk/time`, `/honk/weather`;
   - Solana Pay для заказов и донатов: `GET|POST /api/solana-pay/orders/:id`, `GET|POST /api/solana-pay/donations/:id` (проверены только `rides`);
   - `POST /api/tickets/orders/:id/reconcile` (PR #5 уже отмечал, что в stub его нет) и `POST /api/watch/:id/donation-orders/:orderId/reconcile`;
   - `GET /api/rides/:id/public` (квитанция), `GET /api/honk/catalog`, `GET /api/sns/reverse`, `GET /api/sns/resolve`, `GET /api/editor/mcp/entities/:id`;
   - `POST /api/auth/guest` и `GET /api/prize/board` в `server/test` по-прежнему только unit-спеки. В этом PR их вызывает `e2e/block1-offchain/free/merged.test.mjs`, когда поднят `E2E_BASE`.
3. **Правила ranked / guest / weekly** в `server/test` по-прежнему в основном unit: `409 ranked_window`, `ranked_paid_cap`, `ranked_promo_cap`, `ranked_training`, `ranked_ineligible`, гео по `CF-IPCountry`. `guest_easy_only` и выдача недельного 1h проверяются e2e при `E2E_BASE`. `weekly_ticket_spent` зафиксирован в исходнике обработчика: открытый грант повторный `POST /api/rides` возвращает, а не списывает второй раз.
4. **У 25 маршрутов нет проверенного 2xx**, есть только отказы: `POST /api/editor/jobs` (только 403/503), `GET /api/admin/pools/:id`, `GET /api/pools/:id/payout`, `GET /api/editor/revisions/:revId`, blinks `shift/:tier`, `go/:to`, `ride/:id` и маршруты из п. 2.
5. **У 61 маршрута нет ни одного негатива, у 101 — меньше двух.** Без негативов остались, например, `POST /api/chain/settle`, `POST /api/tickets/orders/:id/confirm`, `GET /api/tickets/orders/:id/payment`, `POST /api/watch/:id/donation-orders`, `POST /api/admin/pools/:id/hold/challenge`, `POST /api/admin/rides/:id/challenge`, `POST /api/editor/entities/:id/restore`, `POST /api/telemetry`, `GET /api/pools`, `GET /api/pool`.
6. **Матрица доступа неполная:** у 58 из 96 защищённых маршрутов нет своего теста «без сессии», «чужая роль» или «нет X-FC-Admin». Guard'ы проверены unit-тестами и несколькими HTTP-кейсами (`admin-host.spec`, `editor-host.spec`), но если на новом маршруте забыть `@UseGuards`, это ничто не поймает.
7. **Лимиты проверены частично.** В `test/http/rate-limit.spec.ts` есть бакеты `default`, `auth` и `promo`, и `redis-throttler.integration`. Бакеты `entities`, `editor`, `mcp` и все `*-rps` на уровне HTTP не проверяются.
8. **Лишние поля во входе молча отбрасываются.** Тестов на это нет, и само правило не зафиксировано (см. решение 3).
9. **`set_pool_rules` (pool v5) нельзя вызвать через HTTP**, есть только CLI `pool-admin.mjs`. Его проверка относится к блоку 2 (CLI + валидатор), и решить, нужен ли admin-маршрут, нужно заранее.
10. Сильные стороны, которые надо сохранить: гонки (≈ 50 кейсов в `concurrency.integration.spec.ts`: двойной redeem, двойной confirm, webhook против poll, hold против claim), промо-абьюз (`promos-abuse.scenarios.ts`), контракт problem+json (`http-contract.scenarios.ts`), один и тот же сценарий на in-memory и на Postgres.

### 4. Подход

#### 4.1 Один источник правды для схем: zod → (OpenAPI)
- Добавить **zod-схемы ответов** рядом с DTO (`presentation/<area>/dto/<area>.response.ts`), а TS-интерфейсы `*Dto` получать через `z.infer`, чтобы тип и схема не расходились.
- Сделать декоратор `@ZodResponse(schema, { status })` на каждый метод контроллера. Глобальный `ResponseSchemaInterceptor` в тестах и dev запускает `schema.strict().parse(body)` и при ошибке падает с 500 `response_schema_violation`. В production только пишет предупреждение в лог (или выключен), чтобы не ломать игроков.
- Сделать общую схему `ProblemDetails` и **перечень допустимых `code` на каждый маршрут** (`errors: ['ride_rechosen','ranked_window',…]`). Тест падает, если маршрут вернул код, которого нет в перечне.
- OpenAPI **генерировать** из этих же схем (`@asteasolutions/zod-to-openapi`, совместимо с zod 3.25) и реестра маршрутов, а не писать руками. Файл `openapi.json` собирается как артефакт CI. Нужен он для schemathesis и как документация. Это не противоречит решению «не тащить генераторы»: источник правды остаётся в zod рядом с контроллером.

#### 4.2 Реестр маршрутов и gate покрытия
- `test/contract/routes.manifest.ts`: на каждый маршрут `{ method, path, access, requestSchemas, responseSchema, errorCodes, block: 1|2, flags[], positive: [caseId…], negative: [caseId…] }`.
- `test/architecture/route-manifest.spec.ts` поднимает приложение и строит **настоящий** список маршрутов через `DiscoveryService`/`MetadataScanner` (метод, путь, guard'ы, `@AdminPublic/@EditorPublic/@CrossOriginPublic`, zod-пайпы). Тест падает, если:
  - есть маршрут без записи в манифесте (или наоборот);
  - у маршрута нет `@ZodResponse`;
  - класс доступа в манифесте не совпадает с guard'ами (так ловится забытый `@UseGuards`);
  - на маршрут меньше **1 позитивного и 2 негативных** кейсов (порог см. в решении 4);
  - id кейса не найден в тестах. Кейсы помечаются тегом в названии `it('[RIDES-START-N03] …')` или хелпером `covers('POST /api/rides/:id/start', 'N03')`.
- Счётчик фактических вызовов: обёртка над supertest записывает `METHOD route status` в `coverage/routes.jsonl`. Отчёт строит `test:census` (расширить `.claude/skills/test-census`), без новой утилиты.

#### 4.3 Контрактная проверка всех существующих тестов «бесплатно»
- `checkedAgent()` в `test/support/client.ts`: каждый ответ проверяется автоматически. 2xx — по `responseSchema` маршрута (strict), 4xx/5xx — по `ProblemDetails` и `code ∈ errorCodes`, плюс заголовки (`X-Request-Id`, `content-type`, `Cache-Control` там, где он задан).
- Тогда все ≈ 358 существующих HTTP-кейсов и PR #5 `harness/api.mjs` (тот же валидатор через общий модуль) начнут проверять схему у 135 маршрутов без переписывания тестов.

#### 4.4 Генерируемая негативная матрица
Файл `test/contract/negative-matrix.spec.ts` проходит по манифесту и **генерирует** кейсы для каждого маршрута по его классу доступа и схемам:

| Класс | Генерируемые кейсы |
|---|---|
| доступ | нет cookie (401 или 404); cookie игрока на admin/editor (404); просроченная или подделанная cookie (401); admin-сессия кошелька, удалённого из `ADMIN_WALLETS` (404); нет `X-FC-Admin` или `X-FC-Editor` на изменении (403); не тот Host (404); editor с IP вне allowlist (404); MCP с `X-Forwarded-For` (404); webhook без секрета или с неверным (401) |
| CSRF/CORS | `Origin: null` или чужой origin на POST (403 `bad_origin`); `text/plain` и form (415); preflight с чужого origin не получает ACAO |
| тело | битый JSON (400 `malformed_json`); пустое тело; `null` или массив вместо объекта; каждое обязательное поле по очереди убрано; неверный тип (строка ↔ число, `"1"`, `1.5`, `NaN`, `-0`); строка пустая, длиннее max, unicode/RTL/NUL; число на min−1, min, max, max+1; enum вне списка; лишнее поле (по решению 3: 400 или игнор с проверкой, что эффекта нет); prototype pollution (`__proto__`, `constructor`); > 100 KB или > 256 KB для editor (413) |
| params/query | не UUID или не base58; несуществующий id (404); чужой ресурс (403 или 404, без разницы в тексте ответа, чтобы его нельзя было зондировать); повтор query-параметра; `limit` и `cursor` вне границ |

Значения на границах генерируются из zod-схемы (`zod-fast-check` или свой обход `_def`). Ожидание у всех кейсов одно: правильный 4xx, problem+json, **никакого 5xx** и **никаких изменений в БД** (см. 4.6).

#### 4.5 Бизнес-негативы (ручной каталог, раздел 5)
Повтор и идемпотентность, гонки, временные окна, флаги, гео и 18+, лимиты, чужие подписи. Эти кейсы пишутся руками в сценариях. Генератор их не придумает.

#### 4.6 Состояние БД и побочные эффекты
- Хелпер `expectDbDelta(fn, { player: {freeRides: -1}, rideTicket: +0, honkLedger: [...], adminAction: +1, chainEvent: +0, analytics: ['ride_created'] })`: снимок до и после на in-memory и на Postgres.
- Инварианты после каждого сценария (глобальный `afterEach` в integration): сумма HONK/TEN4-леджера равна балансам; `freeRides` в пределах `[0, ceiling]`; у билета ровно одно из «потрачен», «аннулирован», «возвращён»; у пула сумма долей = 10 000 bps; каждое admin-изменение записано в `AdminAction` с подписью.
- Для отказов: «ничего не записано», кроме `ClientError` или `SignIn` там, где запись положена.
- Блок 2: сверка с цепочкой (баланс escrow PDA, счета USDC/SOL, события `onLogs` → `ChainEvent`), а также webhook и poll на одной транзакции.

#### 4.7 Fuzz и property-тесты
- **schemathesis** против docker-стека из PR #5 (`docker-compose.e2e.yml`) по сгенерированному `openapi.json`. Режимы: stateless (все маршруты, проверки `not_a_server_error`, `response_schema_conformance`, `status_code_conformance`, `content_type_conformance`) и stateful (связи create → get → confirm). Авторизация через хук: keypair → nonce → verify → cookie, для admin dev-ключ из `e2e/harness/api.mjs`. Запуск ночью и вручную, в обязательный CI PR не входит: он долгий и находит недетерминированные вещи.
- **fast-check** в vitest для доменных функций: деление пула, `bps`, потолок < 50 %, промокоды (нормализация написания), очки «чистой дистанции», окна недели и сезона на `FakeClock`.

#### 4.8 Как это ложится на PR #5
- **Блок 1 (без блокчейна)** = in-process vitest + supertest на in-memory и Postgres (основная масса: контракт, негативная матрица, бизнес-негативы) + **smoke по каждому маршруту** через `e2e/harness/api.mjs` против docker (один позитив и один негатив, с проверкой схемы). Это 120+ маршрутов: auth, lobby, rides free, промо, рефералка, admin, editor, live без оплаты, stats, sns (на stub).
- **Блок 2 (локальный валидатор)**: маршруты, которым нужна настоящая цепочка: `rides/:id/payment|confirm|reconcile` (платные), `tickets/*`, `pools/:id/refund|payout`, `chain/settle`, `chain/webhook` (с настоящими подписями транзакций), `solana-pay/*`, `watch/:id/donation-orders/*`, `pledges/*`, сжигание HONK при `HONK_PROGRAM_ID`, `actions/*` POST (транзакции blinks), `admin/pools/:id/hold`, плюс CLI `set_pool_rules` (pool v5). Негативы: чужая транзакция, не та сумма или mint, повтор подписи, транзакция не финализирована, пул закрыт.
- В `e2e/catalog.mjs` добавить раздел `API-*`, который **генерируется из манифеста**, чтобы чек-лист PR #5 и gate не расходились.

### 5. Каталог негативных сценариев по категориям

| Категория | Что проверяем | Примеры маршрутов и кодов |
|---|---|---|
| A. Доступ | нет сессии, чужая роль, сессия истекла, кошелёк удалён из allowlist, не тот хост или IP, нет CSRF-заголовка | все `PlayerAuthGuard` → 401; admin/editor/mcp → 404; без `X-FC-Admin` → 403 |
| B. Владение | чужая поездка, заказ, донат, залог, поездка водителя для зрителя | `GET /api/rides/:id` чужой → 403/404; `pledges/:id/confirm` → 403; `tickets/orders/:id` → 403 |
| C. Валидация входа | схема, типы, границы, enum, лишние поля, размер, кодировка | 400 `validation_error` с `errors[].path`; 413; 415 |
| D. Состояние / FSM | действие не в том статусе | `start` у неоплаченной поездки → 409; `end` дважды; `confirm` у закрытого заказа → 409 `order_closed`; `ride_rechosen`; `pool_closed`, `rides_closed`, `road_not_sealed` |
| E. Идемпотентность и повтор | повтор той же подписи, батча, промокода, admin-подписи | `signature_reused`; повторный `seq` батча — no-op 200; admin-подпись к другому действию → 401; nonce одноразовый |
| F. Гонки | N параллельных запросов | двойной redeem, двойной confirm, webhook против poll, hold против claim, последний слот приглашения, двойной start (уже есть, расширить на `auth/guest`, `prize/board` и ranked-старт PR #3) |
| G. Лимиты | каждый из 10 бакетов, ключ (кошелёк или IP), сброс окна, Redis | 429 `rate_limited` problem+json; другие маршруты не задеты; `/API/AUTH/` и `/` в конце в тот же бакет |
| H. Время | окна недели и сезона, начало и конец промокода, play-window, удержание 48 h, вестинг | `ranked_window`, `too_early`, `waiting_review`, `held`; на `FakeClock` ровно на границе и ±1 с |
| I. Флаги и env | функция выключена | `live_feature_off`, `ranked_effects_off`, `payment_not_needed`, `tier_not_on_sale`, `not_sellable`; Pre-season: платные билеты выключены, одна попытка после аирдропа; `WEBHOOK_SECRET` не задан → 404; `HONK_PROGRAM_ID` → подпись обязательна |
| J. Гео и 18+ | страна или штат заблокированы, санкции, нет 18+ | `POST /api/rides/:id/start {ranked:true}` с `CF-IPCountry` из списка → 409 `ranked_ineligible`; платная смена без соглашений → 409 `agreements_required`; без заголовка → fail-closed (решение 7: отказ ranked; в dev/test — `PRIZE_DEV_DEFAULT_COUNTRY`) |
| K. Деньги и леджер | баланс не уходит в минус, потолки, доли | `honk_balance`, `free_rides_ceiling/floor`, `ticket_cap`, `ranked_paid_cap`, `ranked_promo_cap`; потолок доли билетов < 50 % |
| L. Цепочка (блок 2) | транзакция не та или не финальна | `transaction_invalid`, `transaction_mismatch`, `pledge_tx_invalid`, `bad_donation_payment`, `wrong_account`, `retry` / `pending` |
| M. Внешние зависимости | RPC, Redis, AI-провайдер или SNS недоступны | 503 с `checks` в `/api/health/ready`; `editor/jobs` → 503; `chain/fees` → 503; никакого 500 |
| N. Утечки | ответ не содержит лишнего | strict-схема ответа; чужой кошелёк и IP не видны игроку; одинаковый 404 у admin на «нет маршрута» и «нет доступа» |
| O. Транспорт | заголовки и формат | `X-Request-Id` (свой или новый), `problem+json`, cookie `httpOnly`/`SameSite`/`Secure`, CORS, `Cache-Control` у `entities/bundle`, gzip |

### 6. План внедрения

| Шаг | Что | Где | Оценка |
|---|---|---|---|
| 0 | Сделано: PR #3 влит в main, `auth/pair*` и `referrals*` сохранены | — | — |
| 1 | `route-manifest.spec.ts` через DiscoveryService и сгенерированный черновик манифеста на 151 маршрут (по таблицам выше); gate в режиме **отчёта**, без падения | `server/test/contract` | 1 д |
| 2 | Zod-схемы ответов + `@ZodResponse` + `ResponseSchemaInterceptor` (strict в test/dev); `checkedAgent` в `test/support/client.ts` и общий валидатор для `e2e/harness/api.mjs`. Начать с денег: rides, tickets, pools, promo, referrals, prize, admin | `server/src/presentation/*/dto`, `test/support` | 3–4 д |
| 3 | Генерируемая негативная матрица (классы A, C, O) по манифесту | `server/test/contract` | 2 д |
| 4 | Закрыть 16 невызываемых маршрутов и 25 без 2xx; HTTP-сценарии PR #3: guest, prize board, ranked-старт, гео, лимиты недели | `server/test/scenarios` | 2–3 д |
| 5 | Ручной каталог D–N, `expectDbDelta` и инварианты в `afterEach` integration | сценарии + integration | 3 д |
| 6 | Smoke по каждому маршруту против docker (блок 1) и chain-маршруты на валидаторе (блок 2) в PR #5 `e2e/`; `catalog.mjs` генерирует раздел `API-*` из манифеста | PR #5 | 2 д |
| 7 | Генерация `openapi.json` + schemathesis (ночью) + fast-check для домена | `server/scripts`, CI | 1–2 д |
| 8 | Gate в **жёсткий** режим: ≥ 1 позитив и ≥ 2 негатива на маршрут, 100 % маршрутов со схемой ответа, 0 маршрутов вне манифеста | CI | 0,5 д |


> §7 «Решения владельца» перенесён в [`DECISIONS.md`](DECISIONS.md).
