# Безопасность админских и привилегированных ручек — манифест и план тестирования

> Решение владельца 17.10.2026: «добавь в тест проверку и защиту админских ручек». Источник правды по `/api/admin/*`, `/api/editor/*` (3D-редактор storybook), колбэкам MCP, webhook цепи, health, CLI-командам администратора и будущим ручкам модерации (решение 53) и `set_pool_rules` (решение бэкенда Б8).
>
> Код сверен после мержа PR #3 (`origin/main` `e8f338ad`). Мерж не добавил HTTP для `set_pool_rules` и не добавил админку TEN4, поэтому реестр 1.2 не менялся. Любой следующий привилегированный маршрут обязан войти в реестр 1.2 и в матрицу ADM-T-01…12 с первого коммита (ADM-M-21). Решения 59–66 приняты владельцем 17.10.2026 ([`DECISIONS.md`](DECISIONS.md)); правила ниже — окончательные нормы, «Роль (цель)» в 1.2 — обязательная роль. Связанные правила: [`backend_contract.md`](backend_contract.md) API-M-03/04/07/13, [`replays_streams.md`](replays_streams.md) RPL-M-16/17/27, [`legal.md`](legal.md) LEG-M-04.

## Часть 1. Манифест
### 1.1 Как защищено сейчас (`origin/main`)
**Админка** (`/api/admin/*`, `AdminGuard`, `server/src/infrastructure/http/guards/admin.guard.ts:35-45`), проверки по порядку:
1. **Хост:** при split-деплое запрос должен прийти на `admin.<COOKIE_DOMAIN>` (`admin.guard.ts:38`, `env.service.ts:149`). Берётся `Host` (его ставит nginx), а не `X-Forwarded-Host`. Иначе — `404`.
2. **Сессия:** cookie `fc_admin` — HS256 JWT с отдельным `audience`/`issuer` (`jose.admin-token-signer.ts:41`) и ключом `ADMIN_JWT_SECRET`. Если ключ не задан, он выводится из `JWT_SECRET` (`env.service.ts:36`). Кошелёк из токена **на каждом запросе** сверяется с `ADMIN_WALLETS` (`admin.guard.ts:41`). Нет сессии, чужая сессия или игровая сессия того же кошелька → `404`.
3. **CSRF:** на изменяющих методах нужен заголовок `X-FC-Admin: 1` (`admin.guard.ts:42`), иначе `403`. Cookie: `httpOnly`, `SameSite=Strict`, `Path=/api/admin`, без `Domain`, `Secure` в production (`admin-cookie.interceptor.ts:21`).
4. **Вход:** SIWS-сообщение с `domain`/`origin` админ-хоста, nonce 16 байт, TTL 5 мин (`rules-config.adapter.ts:7`). Одноразовое: `DELETE … RETURNING` (`challenge.prisma.repository.ts:25`), гасится при первой попытке, удачной или нет. Allowlist проверяется и на выдаче (`request-admin-challenge.handler.ts:73`), и на проверке (`verify-admin-signin.handler.ts:33`). Сессия длится `ADMIN_SESSION_TTL_MINUTES` (по умолчанию 120, максимум 1440; `env.schema.ts:107`), продления нет.
5. **Каждое изменение подписывается отдельно:** `…/challenge` выдаёт текст ровно этого изменения (`AdminProofService.issue`, `admin-proof.service.ts:28-33`). Одна ожидающая подпись на админа, TTL 5 мин. `prove` гасит её и проверяет срок, совпадение намерения и подпись (`admin-proof.service.ts:35-41`). Иначе — `401`, изменение не происходит.
6. **Аудит:** `admin.AdminAction` (`server/prisma/admin/admin.prisma:2-13`: wallet, action, target, detail JSON, requestId, at). Пишется для `auth.signin`, `verdict.override`, `verdict.rejudge`, `verdict.rejudge-bulk`, `pool.hold`/`pool.release`, `promo.create`/`promo.disable`, `setting.update`, `free_rides.adjust`, `entity.publish`, `editor.signin`. «Только добавление» обещано лишь комментарием порта (`admin-action.repository.port.ts:4`).
7. **Сеть:** nginx-сайт `admin.<apex>` закрыт HTTP basic auth (`deploy/nginx/admin.conf.template:14,26`). Приложение слушает только loopback (`deploy/docker-compose.prod.yml:176`). Production-проверки при старте (`env.schema.ts:163-176`): `COOKIE_DOMAIN` при непустых `ADMIN_WALLETS`/`EDITOR_WALLETS`, `JWT_SECRET`, `TRUST_PROXY`, запрет `EDITOR_FAKE_LLM`.
8. **Лимиты:** глобальный `ThrottlerGuard` — бюджет `default` 600/мин на кошелёк игрока или IP, на каждый маршрут (`throttling.ts:59`). Отдельные бюджеты `auth` (30/мин + 5/с) — только для `/api/auth/*` и `/api/editor/auth/*` (`throttling.ts:16,22,60-61`).
9. **Origin:** глобальный `OriginGuard`. На админ- и storybook-хостах изменяющий запрос с `Origin` принимается только same-origin (`origin.guard.ts:146`). Запрос без `Origin` проходит (`origin.guard.ts:140`). Для админ-хоста CORS-заголовки не ставятся (`configure-app.ts:57`).

**Редактор** (`/api/editor/*`, `EditorGuard`, `editor.guard.ts:84-95`): то же самое со своим хостом `storybook.<apex>`, `EDITOR_IP_ALLOWLIST` (необязательный), cookie `fc_editor`/`__Host-fc_editor`, заголовком `X-FC-Editor` и `EDITOR_WALLETS`. Публикация подписывается отдельно (surface `editor`, свой домен в тексте).
**MCP-колбэки** (`/api/editor/mcp/*`, `McpJobGuard`, `mcp-job.guard.ts:26-37`): токен задания `x-fc-job`, задание в статусе `running` и не старше таймаута, кошелёк в `EDITOR_WALLETS`. Запрос через nginx (есть `X-Forwarded-For`/`X-Real-IP`) → `404`.
**Webhook цепи** (`WebhookSecretGuard`, `webhook-secret.guard.ts:56-63`): секрет не задан → `404`. Неверный секрет → `401`. Сравнение в постоянное время по sha256.
**Роли:** три независимых allowlist — `ADMIN_WALLETS`, `EDITOR_WALLETS` и задания MCP. Внутри админки ролей нет: любой админ может всё.

### 1.2 Реестр привилегированных маршрутов
Обозначения. **Guard:** `AG` = `AdminGuard` на классе контроллера, `EG` = `EditorGuard`, `MG` = `McpJobGuard`, `WG` = `WebhookSecretGuard`, `pub` = `@AdminPublic()`/`@EditorPublic()` (хост/IP/заголовок — да, сессия — нет). **Подп.** — подписанное действие (1.1 п. 5). **Strict** — `.strict()` в zod-схеме входа: в `origin/main` **нигде нет** (zod по умолчанию отбрасывает лишние поля). **Роль (цель)** — обязательная роль по решению 59.

#### Админка — `admin.http.controller.ts` (класс `AG` :37)
| № | Метод и путь | Строка | Вход | Эффект | Деньги | Аудит | Роль (цель) |
|---|---|---|---|---|---|---|---|
| A01 | POST `/api/admin/auth/nonce` (pub) | :45 | `challengeBodySchema` | текст входа | — | нет | все роли |
| A02 | POST `/api/admin/auth/verify` (pub) | :51 | `verifyBodySchema` | cookie `fc_admin` | — | `auth.signin` (удачный); неудачный — только warn-лог | все роли |
| A03 | POST `/api/admin/auth/logout` (pub) | :57 | — | стирает cookie (токен живёт до TTL) | — | нет | все роли |
| A04 | GET `/api/admin/overview` | :62 | — | чтение | — | нет | admin, moderator |
| A05 | GET `/api/admin/rides` | :68 | `adminRidesQuerySchema` | очередь проверки | — | нет | admin, moderator |
| A06 | GET `/api/admin/replays` | :73 | `adminReplaysQuerySchema` | реплеи, в т. ч. тренировочные и `rejected` | — | нет | admin, moderator |
| A07 | GET `/api/admin/rides/:id` | :78 | `rideIdParamsSchema` | деталь с вводом (RPL-M-07) | — | нет | admin, moderator |
| A08 | POST `/api/admin/rides/:id/challenge` | :84 | `actionChallengeBodySchema` | текст подписи | — | нет | admin |
| A09 | POST `/api/admin/rides/:id/verdict` (подп.) | :91 | `overrideBodySchema` | ручной вердикт | **да** (допуск к призу) | `verdict.override` from/to | admin |
| A10 | POST `/api/admin/rides/:id/rejudge` (подп.) | :99 | `rejudgeBodySchema` | пересудить | **да** | `verdict.rejudge` from/to | admin |
| A11 | GET `/api/admin/signins` | :104 | `signInsQuerySchema` | IP и браузеры (ПДн) | — | нет | admin |
| A12 | GET `/api/admin/actions` | :109 | `actionsQuerySchema` | журнал аудита | — | нет | admin |
| A13 | GET `/api/admin/logs` | :115 | `logsQuerySchema` | 5000 строк лога (wallet, IP, пути) | — | нет | admin |

#### Справочник — `admin-directory.http.controller.ts` (класс `AG` :20)
| № | Метод и путь | Строка | Вход | Эффект | Деньги | Аудит | Роль (цель) |
|---|---|---|---|---|---|---|---|
| A14 | GET `/api/admin/queue/count` | :25 | — | чтение | — | нет | admin, moderator |
| A15 | GET `/api/admin/players` | :30 | `playersQuerySchema` | чтение | — | нет | admin, moderator |
| A16 | GET `/api/admin/players/:wallet` | :35 | `walletParamsSchema` | профиль игрока (ПДн) | — | нет | admin |
| A17 | GET `/api/admin/pools` | :40 | `poolsQuerySchema` | чтение | — | нет | admin |
| A18 | GET `/api/admin/pools/:id` | :45 | `poolIdParamsSchema` | чтение | — | нет | admin |
| A19 | GET `/api/admin/stats` | :50 | `adminStatsQuerySchema` | чтение | — | нет | admin |
| A20 | GET `/api/admin/sessions` | :55 | `sessionsQuerySchema` | сессии (ПДн) | — | нет | admin |

#### Выплаты пула — `admin-pools.http.controller.ts` (класс `AG` :18)
| № | Метод и путь | Строка | Вход | Эффект | Деньги | Аудит | Роль (цель) |
|---|---|---|---|---|---|---|---|
| A21 | GET `/api/admin/pool-payouts` | :25 | — | победители пулов | — | нет | admin |
| A22 | POST `/api/admin/pools/:id/hold/challenge` | :30 | `poolHoldChallengeBodySchema` | текст подписи | — | нет | admin |
| A23 | POST `/api/admin/pools/:id/hold` (подп.) | :35 | `poolHoldBodySchema` | остановить или отпустить автовыплату | **да** | `pool.hold`/`pool.release` (без состояния «до») | admin (+ второй, решение 60) |

#### Промокоды — `admin-promos.http.controller.ts` (класс `AG` :22, префикс `api/admin/promos`)
| № | Метод и путь | Строка | Вход | Эффект | Деньги | Аудит | Роль (цель) |
|---|---|---|---|---|---|---|---|
| A24 | GET `/api/admin/promos` | :30 | `promosQuerySchema` | чтение | — | нет | admin |
| A25 | GET `/api/admin/promos/redemptions` | :36 | `promoRedemptionsQuerySchema` | кто погасил (ПДн) | — | нет | admin |
| A26 | POST `/api/admin/promos/challenge` | :42 | `promoChallengeBodySchema` | текст подписи | — | нет | admin |
| A27 | POST `/api/admin/promos` (подп.) | :49 | `createPromoBodySchema` | новый код: `tickets` (билеты в платный пул), `free_rides`, `cosmetic` | **да** (`tickets`) | `promo.create` | admin (+ второй для `tickets`, решение 60) |
| A28 | POST `/api/admin/promos/:code/disable` (подп.) | :54 | `disablePromoBodySchema` | выключить код | косвенно | `promo.disable` (без «до») | admin |

#### Настройки и бесплатные поездки — `admin-settings.http.controller.ts` (класс `AG` :20)
| № | Метод и путь | Строка | Вход | Эффект | Деньги | Аудит | Роль (цель) |
|---|---|---|---|---|---|---|---|
| A29 | GET `/api/admin/settings` | :27 | — | чтение | — | нет | admin |
| A30 | POST `/api/admin/settings/challenge` | :32 | `settingChallengeBodySchema` (key = `z.string()`, value = `z.number().int()`; домен проверяет `SETTING_KEYS`/`SETTING_BOUNDS`) | текст подписи | — | нет | admin |
| A31 | POST `/api/admin/settings` (подп.) | :37 | `updateSettingBodySchema` | меняет `GameSettings`, в т. ч. денежные ключи `referral_referrer_part_bps`, `referral_ride_cap_lamports`, `referral_donation_share_bps` (0…10 000), `referral_donation_cap_lamports` (`game-settings.ts:4-9,53-56`) | **да** | `setting.update` | admin (+ второй для денежных ключей, решение 60) |
| A32 | POST `/api/admin/players/free-rides/challenge` | :42 | `freeRidesChallengeBodySchema` | текст подписи | — | нет | admin |
| A33 | POST `/api/admin/players/free-rides` (подп.) | :47 | `adjustFreeRidesBodySchema` | ± бесплатные поездки | — | `free_rides.adjust` | admin |

Итого в админке **33 маршрута** в пяти контроллерах. Модерации чата (решение 53) и `set_pool_rules` (Б8) в `origin/main` нет — это строки P01–P04 ниже.

#### Редактор 3D (storybook) — классы `EG`
| № | Метод и путь | Файл:строка | Вход | Эффект | Деньги | Аудит | Роль |
|---|---|---|---|---|---|---|---|
| E01 | POST `/api/editor/auth/nonce` (pub) | `editor-auth.http.controller.ts:26` | auth DTO | текст входа | — | нет | editor |
| E02 | POST `/api/editor/auth/verify` (pub) | `editor-auth…:31` | auth DTO | cookie редактора | — | `editor.signin` | editor |
| E03 | POST `/api/editor/auth/logout` (pub) | `editor-auth…:36` | — | стирает cookie | — | нет | editor |
| E04 | GET `/api/editor/me` | `editor-auth…:41` | — | чтение | — | нет | editor |
| E05 | GET `/api/editor/entities` | `editor-entities.http.controller.ts:32` | — | чтение | — | нет | editor |
| E06 | GET `/api/editor/entities/:id` | `editor-entities…:37` | `entityIdParamsSchema` | чтение | — | нет | editor |
| E07 | GET `/api/editor/entities/:id/revisions` | `editor-entities…:42` | то же | чтение | — | нет | editor |
| E08 | GET `/api/editor/revisions/:revId` | `editor-entities…:47` | `revisionIdParamsSchema` | чтение | — | нет | editor |
| E09 | POST `/api/editor/entities/:id/drafts` | `editor-entities…:52` | `draftBodySchema` (≤ 64 KB) | черновик | — | ревизия с автором, без AdminAction | editor |
| E10 | POST `/api/editor/entities/:id/restore` | `editor-entities…:57` | `restoreBodySchema` | черновик из ревизии | — | то же | editor |
| E11 | POST `/api/editor/entities/:id/publish/challenge` | `editor-entities…:62` | `publishChallengeBodySchema` | текст подписи | — | нет | editor |
| E12 | POST `/api/editor/entities/:id/publish` (подп.) | `editor-entities…:67` | `publishBodySchema` | публикация в бандл **для всех клиентов** | — | `entity.publish` с `previous` | editor (+ ревью, решение 59) |
| E13 | POST `/api/editor/jobs` | `editor-jobs.http.controller.ts:28` | `createJobBodySchema` | AI-задание (расход LLM-ключей) | **да** (USD у провайдера) | нет | editor |
| E14 | GET `/api/editor/jobs` | `editor-jobs…:33` | `jobsQuerySchema` | чтение | — | нет | editor |
| E15 | GET `/api/editor/jobs/:id` | `editor-jobs…:38` | `jobIdParamsSchema` | чтение | — | нет | editor |
| E16 | GET `/api/editor/jobs/:id/events` | `editor-jobs…:43` | `jobEventsQuerySchema` | чтение | — | нет | editor |
| E17 | POST `/api/editor/jobs/:id/cancel` | `editor-jobs…:48` | `jobIdParamsSchema` | отмена | — | нет | editor |

#### MCP-колбэки — `editor-mcp.http.controller.ts` (класс `MG` :16, только внутренняя сеть)
| № | Метод и путь | Строка | Вход | Эффект | Аудит |
|---|---|---|---|---|---|
| M01 | GET `/api/editor/mcp/entities` | :23 | — | чтение | нет |
| M02 | GET `/api/editor/mcp/entities/:id` | :28 | id | чтение | нет |
| M03 | GET `/api/editor/mcp/configs` | :33 | — | чтение | нет |
| M04 | POST `/api/editor/mcp/entities/:id/drafts` | :38 | `mcpDraftBodySchema` | черновик от имени задания | ревизия |

#### Служебные
| № | Метод и путь | Файл:строка | Guard | Эффект | Замечание |
|---|---|---|---|---|---|
| S01 | POST `/api/chain/webhook` | `chain-webhook.http.controller.ts:16` | `WG` | сверка подписей с цепью | тело не доверяется, берутся только подписи |
| S02 | GET `/api/health/live` | `health.http.controller.ts:11` | нет (публичный) | — | без деталей |
| S03 | GET `/api/health/ready` | `health.http.controller.ts:17` | нет (публичный) | — | `database up/down` + `latencyMs` |

Метрик (`/metrics`) и dev/debug-маршрутов в `origin/main` нет. Флаги эффектов стрима (`LIVE_CHAT`, `LIVE_DONATIONS`, `LIVE_FREE_DONATIONS`, `LIVE_EFFECTS`, `env.schema.ts:142-145`) переключаются только через env, HTTP-ручки нет. Игровые ручки с «властью» над чужим — `POST /api/rides/:id/mutes` (водитель, `live.http.controller.ts:84`) и `POST /api/chain/settle` (без прав, идемпотентно, `pools.http.controller.ts:59`) — покрываются [`backend_contract.md`](backend_contract.md), сюда не входят.

#### Привилегированные CLI-команды (не HTTP, нужен shell на сервере) — `server/src/cli/admin-commands.ts:90-146`
`promo:create|list|disable`, `tickets:grant`, `pool:seed` (в production отказ, `:106`), `pool:register`, `pool:crank`, `pool:payout`, `pool:pledges`, `achievement:mint`, `verdict:rejudge` (аудит `verdict.rejudge-bulk`), `replay:verify`, `replay:worker`, `pool:attention`, `stats:reconcile`, `retention:sweep`. `tickets:grant` пишет «audit line» лога (`grant-tickets.handler.ts:13`), а не строку `AdminAction`. Остальные денежные CLI-команды строк `AdminAction` не пишут.

#### Планируемые (войти с guard и матрицей с первого коммита, ADM-M-21)
| № | Метод и путь | Источник | Роль | Деньги |
|---|---|---|---|---|
| P01 | POST `/api/admin/chat/:eventId/hide` | решение 53, RPL-M-27 | moderator, admin | — |
| P02 | POST `/api/admin/players/:wallet/chat-ban` (снять — тот же путь с `{ban:false}`) | решение 53, RPL-M-27 | moderator, admin | — |
| P03 | POST `/api/admin/pools/rules/challenge` + POST `/api/admin/pools/rules` (`set_pool_rules`) | Б8, POOL-M-12 | admin + второй (решение 60) | **да** (цепь) |
| P04 | POST `/api/admin/config/challenge` + POST `/api/admin/config` (`set_config` программы, `pool-program.idl.ts:33`), если появится в HTTP | IDL v5 | только Squads (решение 60) | **да** (цепь) |

### 1.3 Находки (`origin/main`)
Unguarded-маршрутов под `/api/admin/*` и `/api/editor/*` **не найдено**: у всех пяти админских и четырёх редакторских контроллеров guard стоит на классе. Обход проверки подписи действий тоже не найден.
| id | Серьёзность | Находка | Где | Правило |
|---|---|---|---|---|
| F01 | **High** | Админ одной подписью ставит `referral_donation_share_bps` до 10 000 — до 100 % каждого доната уходит рефералу. Противоречит решению 50 и TERMS 14.3 | `game-settings.ts:55`, A31 | ADM-M-09, RPL-M-16 |
| F02 | **High** | `DEMO_WALLETS` не проверяется в production и пробрасывается из `.env` (`docker-compose.prod.yml:102`). `*` = все: платные смены укорачиваются для всех (`demo.ts:4`, `pool-tickets.service.ts:33`), а это влияет на рейтинг и призы | `env.schema.ts:58`, `rules-config.adapter.ts:20` | ADM-M-13 |
| F03 | Medium | Все проверки старта и защиты включаются только при `NODE_ENV === 'production'` строго (`env.service.ts:22`, `env.schema.ts:163`). На `staging`/`prod` включается `localSignIn` (`rules-config.adapter.ts:21`), стена админ-хоста снимается (без `COOKIE_DOMAIN`), cookie без `Secure`, разрешён `EDITOR_FAKE_LLM` | там же | ADM-M-13 |
| F04 | Medium | `ADMIN_JWT_SECRET` и `EDITOR_JWT_SECRET` необязательны и выводятся из `JWT_SECRET` (`env.service.ts:36`). Утечка игрового секрета = поддельная админ-сессия на любой кошелёк из allowlist: чтение ПДн и логов. Изменения ещё закрыты подписью действий | `env.schema.ts:105,111` | ADM-M-05 |
| F05 | Medium | Нет глобального default-deny: guard ставится на класс вручную. Новый контроллер под `api/admin` без `@UseGuards` будет открыт. Мета-теста покрытия guard нет (есть `admin.guard.spec.ts`, `admin-host.spec.ts`, но не перечисление маршрутов) | все контроллеры, `app.module.ts:48` | ADM-M-02 |
| F06 | Medium | Нет `.strict()` в схемах админки и редактора: лишние поля молча отбрасываются. Противоречит Б3 / API-M-03. Ключ настройки — свободная строка | `presentation/admin/dto/*.ts`, `admin-settings.dto.ts:6-7` | ADM-M-09 |
| F07 | Medium | Нет разделения ролей внутри админки: любой из `ADMIN_WALLETS` и меняет деньги, и видит IP. Роли модератора для решения 53 нет | `admin.guard.ts:41` | ADM-M-03 |
| F08 | Medium | Денежные и цепные действия (A09/A10 по платной поездке, A23, A27 `tickets`, A31 денежные ключи) — одной подписью одного админа, без второго подтверждения и задержки | 1.2 | ADM-M-07 |
| F09 | Medium | Аудит: «только добавление» — лишь на словах (нет триггера и отзыва `UPDATE`/`DELETE` у роли БД). Нет состояния «до» у `pool.hold`/`promo.disable`. Неудачные входы — только в лог. Не аудируются: logout, E13 (расход LLM), E17, денежные CLI-команды | `admin.prisma:2-13`, `verify-admin-signin.handler.ts:37-39` | ADM-M-11, ADM-M-19 |
| F10 | Medium | Нет оповещений о входе админа и об изменениях | — | ADM-M-12 |
| F11 | Medium | Публикация сущности редактором одной подписью уходит в бандл всех клиентов (цепочка поставки). Проверку исходника на опасные конструкции в рамках этой задачи не сверял | E12, `publish-revision.handler.ts:16` | ADM-M-20 |
| F12 | Low | `/api/admin/auth/*` не попадает в бюджет `auth`: только `default` 600/мин на IP (`throttling.ts:16`). У nginx-сайта админки нет `limit_req` (у storybook есть) | `throttling.ts:16`, `admin.conf.template` | ADM-M-10 |
| F13 | Low | `auth/nonce` отвечает 200 для админ-кошелька и 404 для прочих — можно перебором узнать, кто админ. Каждый вызов заменяет ожидающий nonce, так что можно сорвать вход админа (смягчено basic auth) | `request-admin-challenge.handler.ts:73,77` | ADM-M-04, ADM-M-10 |
| F14 | Low | Logout только стирает cookie, токен действует до конца TTL (по умолчанию 120 мин, максимум 1440). Отзыв — только удалением кошелька из allowlist | `admin-cookie.interceptor.ts:37`, `env.schema.ts:107` | ADM-M-05 |
| F15 | Low | `GET /api/admin/logs` отдаёт сырые строки лога (wallet, IP) без политики редактирования и без роли | A13, `log-ring.ts` | ADM-M-16 |
| F16 | Low | `LIVE_EFFECTS` по умолчанию `all` (`env.schema.ts:145`). Production-compose ставит `free` (`:139`), но проверки старта нет. По RPL-M-17 эффекты удаляются | `env.schema.ts:145` | ADM-M-13 |
| F17 | Info | `OriginGuard` пропускает изменяющий запрос без `Origin` (`origin.guard.ts:140`). Для админки защита держится на `SameSite=Strict` + `X-FC-Admin` | — | ADM-M-15 |
| F18 | Info | Хорошо: 404 на все отказы (Б9), стена хоста по `Host`, подпись каждого действия (домен, TTL, одноразовость атомарным `DELETE … RETURNING`), повторная проверка allowlist на каждом запросе, loopback, basic auth, webhook-секрет в постоянное время | 1.1 | — |

### 1.4 Правила
- **ADM-M-01** MUST: у каждого привилегированного маршрута есть строка в реестре 1.2 и в реестре маршрутов [`backend_contract.md`](backend_contract.md) §4.2 (поверхность, роль, guard, схема входа, эффект, деньги, аудит). Маршрут без строки валит CI (ADM-T-40).
- **ADM-M-02** MUST (решение 61): **default-deny по префиксу**. Глобальный `APP_GUARD` `PrivilegedSurfaceGuard` требует для `/api/admin/*` админ-сессию, для `/api/editor/*` (кроме `mcp/`) — сессию редактора, для `/api/editor/mcp/*` — токен задания. Guard на классе остаётся вторым замком. Публичных исключений ровно 6: A01–A03 и E01–E03, по явному списку. Маршрут под префиксом без guard → приложение не стартует.
- **ADM-M-03** MUST (решение 59): **роли по минимуму прав** — `admin`, `moderator`, `editor` (allowlist `ADMIN_WALLETS`, `MODERATOR_WALLETS`, `EDITOR_WALLETS`; один кошелёк может быть в нескольких). Роль для маршрута — колонка «Роль (цель)» в 1.2, на маршруте — декоратор `@Roles()`:
  - `moderator`: A01–A07, A14, A15 и модерация чата P01/P02 (решение 53). В A15 и A07 ПДн (IP, браузер, сессии) скрыты;
  - `admin`: всё в `/api/admin/*`;
  - `editor`: только `/api/editor/*`.
  
  Роль `editor` не открывает админку, а `admin` и `moderator` не открывают редактор.
- **ADM-M-04** MUST: вход — SIWS-сообщение с `domain` и `URI` своей поверхности, nonce ≥ 16 байт, TTL ≤ 5 мин. Nonce одноразовый и гасится атомарно при первой попытке. Allowlist проверяется на выдаче, на проверке и на каждом запросе. Ответ `auth/nonce` не отличает админ-кошелёк от чужого: всегда `200`; для чужого nonce фиктивный и проверка вернёт `401` (решение 65). Ожидающие nonce хранятся по ключу (кошелёк, клиент), чтобы чужой запрос не гасил вход админа.
- **ADM-M-05** MUST (решения 62, 63): сессия — отдельная cookie поверхности (`httpOnly`, `SameSite=Strict`, `Secure`, `Path` поверхности, без `Domain`). `ADMIN_JWT_SECRET` и `EDITOR_JWT_SECRET` обязательны в production и не равны `JWT_SECRET` и друг другу. TTL сессии ≤ 60 мин, без продления. У токена есть `jti`; logout и удаление из allowlist отзывают его на сервере (список отзыва).
- **ADM-M-06** MUST: **каждое изменение подписано отдельно:**
  - `…/challenge` выдаёт текст, который описывает ровно это изменение (действие, цель, новые значения, домен поверхности, nonce, срок);
  - одна ожидающая подпись на админа;
  - подпись гасится при первой попытке;
  - просрочка, повтор, подпись другого кошелька, текст про другое изменение или подпись с другой поверхности → `401`, изменения нет.
- **ADM-M-07** MUST (решение 60): **деньги и цепь — два шага.** Режим задаётся `ADMIN_APPROVAL_MODE=single|dual`: в строгом режиме при `PAYMENT_MODE=program` с платными пулами или на mainnet допускается только `dual`. Действие помечено `money` в 1.2 (A09/A10 по платной поездке, A23, A27 `tickets`, A31 с денежным ключом, P03, P04). На devnet-запуске — подпись одного админа плюс оповещение (ADM-M-12). Для платных пулов и mainnet — второй админ подтверждает свою подпись над тем же текстом в течение 30 мин (`pending_approval` → `applied`). Свой запрос подтвердить нельзя. `set_config` и `set_pool_rules` в цепи — только через Squads multisig (`team_recipient`, [`OPEN.md`](OPEN.md)).
- **ADM-M-08** MUST: **идемпотентность и гонки.** Изменение применяется не более одного раза: повтор той же подписи → `401` без эффекта; параллельные изменения одной цели → одно применяется, другое `409 conflict` (по Б4, API-M-04). `requestId` и подпись в аудите уникальны.
- **ADM-M-09** MUST: **строгий вход** (Б3, API-M-03): все схемы админки и редактора — `.strict()` (лишнее поле → `400`). `key` настройки — `z.enum(SETTING_KEYS)`. У текстов (note, message) — лимит длины. Ключ `referral_donation_share_bps` удалён (решение 50, RPL-M-16). Для денежных ключей границы ужесточены и действует ADM-M-07.
- **ADM-M-10** MUST (решение 65): **лимиты:**
  - `/api/admin/auth/*` — бюджет `auth` (30/мин + 5/с на IP);
  - изменения — ≤ 30/мин на админа;
  - чтения — `default`;
  - nginx `limit_req` на сайте админки, как на storybook.
  
  Превышение → `429` с `Retry-After`.
- **ADM-M-11** MUST (решение 64): **аудит.** Строка `AdminAction` для:
  - каждого изменения: кто, действие, цель, **до**, **после**, подпись, requestId, IP, время;
  - каждого входа (удачного и неудачного) и logout;
  - чтения ПДн: A11, A13, A16, A20, A25 (`read.*`, без тела ответа).
  
  Таблица только для добавления на уровне БД: роль приложения без `UPDATE`/`DELETE`, плюс триггер-запрет. Хранение ≥ 2 лет. Отправленные и неотправленные оповещения (ADM-M-12) — в той же схеме, таблица `admin.AlertOutbox`.
- **ADM-M-12** MUST (решение 64): **оповещения в Telegram.**
  - **Канал:** Telegram Bot API `sendMessage` в чат владельца. Секреты только через env: `ADMIN_ALERT_TELEGRAM_BOT_TOKEN` и `ADMIN_ALERT_TELEGRAM_CHAT_ID` (в `deploy/.env` на сервере, в `deploy/.env.example` — пустые). В репозитории, логах, ответах API и в самой отправке (кроме URL запроса к `api.telegram.org`) токена нет.
  - **События:**
    - вход и неудачный вход админа, модератора или редактора;
    - 5 неудачных входов за 10 мин с одного IP или на один кошелёк;
    - любое изменение (A09/A10/A23/A27/A28/A31/A33, E12, P01–P04, CLI по ADM-M-19); с `money` — с пометкой `💰 MONEY`;
    - `pending_approval` и его исход;
    - отзыв сессии.
  - **Текст:** окружение (`devnet`/`mainnet`), действие, цель, короткий кошелёк (`Abcd…wxyz`), «до → после» для настроек, `requestId`, время UTC. Без IP целиком (только /24), без подписей, токенов, cookie и заметок игроков длиннее 80 символов.
  - **Доставка:** сначала строка в `admin.AlertOutbox` в той же транзакции, что и аудит; затем отправка с таймаутом 5 с.
  - **Резерв, если Telegram недоступен** (ошибка сети, `5xx`, `429` с `retry_after`, неверный токен):
    - изменение **не блокируется**;
    - строка остаётся `pending` и отправляется повторно с экспоненциальной паузой (30 с → 30 мин) до 24 ч, затем помечается `undelivered`;
    - каждый провал — `error`-лог `admin-alert.undelivered` (без токена), он виден в `npm run ops -- logs` и в A13;
    - страница админки показывает баннер «N alerts undelivered» (новое поле `undeliveredAlerts` в A04 `overview`);
    - для `pending_approval` (ADM-M-07) подтверждение остаётся возможным и без доставки.
  - **Старт:** в строгом режиме при непустых `ADMIN_WALLETS`/`MODERATOR_WALLETS`/`EDITOR_WALLETS` без обеих переменных старт падает (ADM-M-13).
- **ADM-M-13** MUST NOT (решение 62): **нет dev-обходов в production.** Строгий режим включается при любом `NODE_ENV`, кроме `development` и `test`. Старт падает, если:
  - `DEMO_WALLETS` не пуст;
  - `EDITOR_FAKE_LLM=1`;
  - `LIVE_FREE_DONATIONS=on`;
  - `LIVE_EFFECTS≠off` (RPL-M-17);
  - нет `COOKIE_DOMAIN` при непустых allowlist;
  - нет `ADMIN_JWT_SECRET`/`EDITOR_JWT_SECRET` или они совпадают с `JWT_SECRET`;
  - нет `TRUST_PROXY`;
  - нет `ADMIN_ALERT_TELEGRAM_BOT_TOKEN`/`ADMIN_ALERT_TELEGRAM_CHAT_ID` при непустых allowlist (ADM-M-12);
  - `ADMIN_SESSION_TTL_MINUTES` > 60 (решение 63);
  - `ADMIN_APPROVAL_MODE=single` при платных пулах (ADM-M-07);
  - на mainnet нет `ADMIN_IP_ALLOWLIST` (ADM-M-17).
  
  `localSignIn` в строгом режиме выключен всегда.
- **ADM-M-14** MUST: **коды отказа** (согласовано с Б9 / API-M-07):
  - нет сессии, чужой хост, игровая сессия, кошелёк вне allowlist, просроченный или поддельный токен → `404` с одинаковым телом;
  - есть сессия поверхности, но не та роль → `403 forbidden_role`;
  - нет `X-FC-Admin`/`X-FC-Editor` или чужой `Origin` → `403`;
  - подпись действия неверна, просрочена или повторена → `401`;
  - тело не по схеме → `400`;
  - гонка → `409`;
  - лимит → `429`.
- **ADM-M-15** MUST: **CORS/CSRF.** На админ- и storybook-хостах нет `Access-Control-Allow-*` ни для какого чужого Origin. Изменение требует заголовка поверхности. `Origin: null` → `403`. Чужой `Origin` → `403`. Запрос без `Origin` проходит только с заголовком поверхности и cookie `SameSite=Strict`.
- **ADM-M-16** MUST NOT: **утечки:**
  - ответы никогда не содержат секретов, токенов, ключей, stack trace;
  - `500` — общий `problem+json` с `requestId`;
  - лог не пишет cookie, `Authorization`, `x-fc-job`, `x-webhook-secret`, подписи и `ADMIN_ALERT_TELEGRAM_BOT_TOKEN` (в том числе в URL ошибок HTTP-клиента Telegram);
  - `GET /api/admin/logs` маскирует IP до /24 (IPv6 /48) — кроме роли `admin` с явным `?full=1`, которое аудируется.
- **ADM-M-17** MUST (решение 66): **сеть.** Админка доступна только через `admin.<apex>` за nginx basic auth. Приложение слушает loopback. На прямой запрос к приложению с `Host: admin.<apex>` с не-loopback адреса → `404`. На mainnet `ADMIN_IP_ALLOWLIST` (IP/CIDR, как `EDITOR_IP_ALLOWLIST`) обязателен: без него старт падает, IP вне списка → `404`. На devnet он необязателен.
- **ADM-M-18** MUST: **машинные маршруты:**
  - webhook: секрет ≥ 16 символов, сравнение в постоянное время; без секрета → `404`, неверный → `401`;
  - MCP: только внутренняя сеть, задание `running`, кошелёк в `EDITOR_WALLETS`; иначе `404`;
  - health отдаёт только статус и задержку, без версий, хостов и текста ошибок.
- **ADM-M-19** MUST: **CLI.** Изменяющая или денежная CLI-команда пишет `AdminAction` с `wallet = cli:<пользователь ОС>` и аргументами. Dev-команды (`pool:seed`, `db:reset`) в строгом режиме отказывают. Денежные CLI-команды (`pool:payout`, `tickets:grant`) подчиняются ADM-M-07 на mainnet.
- **ADM-M-20** MUST (решение 59): **редактор.** Публикация подписывается отдельно и аудируется с `previous`. На devnet — одна подпись редактора + оповещение. До mainnet обязателен просмотр: публикация переходит в `pending_review`, применяется после подписи второго редактора или админа; свою публикацию подтвердить нельзя. Создание и отмена AI-задания аудируются, задание ограничено настройками `editor_jobs_per_day`/`editor_jobs_parallel`. Сессия редактора не открывает админку и наоборот (ADM-T-04).
- **ADM-M-21** MUST: **новые привилегированные маршруты** (P01–P04 и всё, что придёт с PR #3 и позже) входят с guard, ролью, строкой реестра и матрицей ADM-T-01…12 в том же PR. Gate [`backend_contract.md`](backend_contract.md) API-M-04 для них: ≥ 4 негатива + ≥ 1 тест гонки или повтора.

## Часть 2. План тестирования
Уровни: **U** — unit (vitest), **H** — HTTP через `supertest` на собранном приложении (`server/test/http`), **I** — integration с Postgres/Redis (`server/test/integration`), **M** — ручной. Файлы (план): `server/test/security/admin/*.spec.ts`, `server/test/security/admin/*.integration.spec.ts`.
**Скрипты npm (план, `server/package.json`):** `test:admin-security` = `vitest run test/security/admin` (U + H); `test:admin-security:integration` = `vitest run --config vitest.integration.config.ts test/security/admin` (I: гонки, БД-аудит). В CI — job `admin-security` на каждый PR, обязательный.

### 2.1 Матрица на каждый маршрут реестра (генерируется из 1.2)
Тест-генератор берёт список маршрутов из `route-manifest` (API-T, [`backend_contract.md`](backend_contract.md) §4.2) с полями `surface`, `role`, `mutating`, `signed`, `money`. Для каждой строки A01–A33, E01–E17, M01–M04 и S01, а затем P01–P04 после их появления выполняются применимые проверки:
| id | Уровень | Проверка | Ожидание |
|---|---|---|---|
| ADM-T-01 | H | без cookie | `404`, тело одинаковое с несуществующим маршрутом |
| ADM-T-02 | H | игровая сессия обычного игрока; игровая сессия **админ-кошелька** | `404` |
| ADM-T-03 | H | валидная админ-сессия, но `Host: api.<apex>`; подделанный `X-Forwarded-Host: admin.<apex>` | `404` |
| ADM-T-04 | H | сессия поверхности с ролью не из колонки «Роль» (moderator → A31; editor → A04; admin → E05) | `403 forbidden_role` на своей поверхности; на чужой — `404` |
| ADM-T-05 | H | просроченный токен; токен, подписанный `JWT_SECRET` игрока или `EDITOR_JWT_SECRET`; токен с чужим `aud`; отозванный `jti` | `404` |
| ADM-T-06 | H | изменяющий маршрут без `X-FC-Admin`/`X-FC-Editor` | `403` |
| ADM-T-07 | H | валидная сессия нужной роли | `2xx`, тело проходит zod-схему ответа (Б2, API-M-02) |
| ADM-T-08 | H | лишнее поле в body/query (`{…, "isAdmin": true}`) | `400 validation_error` |
| ADM-T-09 | H | `Origin: https://evil.example`; `Origin: null`; соседний `https://<apex>` | `403 bad_origin`; ответ без `Access-Control-Allow-*` |
| ADM-T-10 | H | изменяющий маршрут, успех и отказ подписи | ровно одна строка `AdminAction` с `before`/`after`/`requestId`/`ip` (успех); строки нет, а `auth.fail` или `action.denied` есть (отказ) |
| ADM-T-11 | H | превышение лимита маршрута (ADM-M-10) | `429` + `Retry-After` |
| ADM-T-12 | H | подписанный маршрут: подпись просрочена, повторена, от другого кошелька, текст про другое значение | `401`, состояние цели не изменилось |

### 2.2 Вход и сессия
| id | Правило | Уровень | Проверка | Ожидание |
|---|---|---|---|---|
| ADM-T-20 | M-04 | U, H | `auth/nonce` для админа и для чужого кошелька | оба `200`, сообщения одной формы; у чужого `verify` → `401` |
| ADM-T-21 | M-04 | U | сообщение входа | `domain` = admin-хост, `URI` = admin-origin, nonce 32 hex, `Expiration Time` ≤ 5 мин |
| ADM-T-22 | M-04 | I | два `verify` одной подписью параллельно | один `200`, второй `401` (`DELETE … RETURNING`) |
| ADM-T-23 | M-04 | H | чужой клиент запрашивает nonce для админ-кошелька между шагами админа | вход админа проходит (nonce по ключу кошелёк + клиент) |
| ADM-T-24 | M-04, M-05 | H | кошелёк удалён из `ADMIN_WALLETS` между шагами и после входа | `404` на `verify` и на следующий запрос |
| ADM-T-25 | M-05 | H | logout, затем старая cookie | `404` (`jti` отозван) |
| ADM-T-26 | M-05 | U | атрибуты cookie | `httpOnly`, `SameSite=Strict`, `Secure`, `Path=/api/admin`, без `Domain`; срок ≤ 60 мин |
| ADM-T-27 | M-05 | U | `ADMIN_SESSION_TTL_MINUTES=61` в строгом режиме | старт падает |
| ADM-T-28 | M-11 | H | неудачный вход и logout | строки `auth.fail` (IP, причина) и `auth.logout` |

### 2.3 Подписанные действия, деньги, идемпотентность
| id | Правило | Уровень | Проверка | Ожидание |
|---|---|---|---|---|
| ADM-T-30 | M-06 | U | текст подписи A08/A22/A26/A30/A32/E11 | содержит действие, цель, новые значения, домен поверхности, nonce, срок |
| ADM-T-31 | M-06 | H | подпись поверхности `editor` для действия админки и наоборот | `401` |
| ADM-T-32 | M-06 | H | новый `challenge` до подписи старого | старая подпись → `401` |
| ADM-T-33 | M-07 | H | A31 с денежным ключом, профиль mainnet: подпись первого админа | `202 pending_approval`, значение не изменилось; оповещение отправлено |
| ADM-T-34 | M-07 | H | подтверждение тем же админом; другим через 31 мин; другим вовремя | `403`; `401 expired`; `200 applied`, в аудите оба кошелька |
| ADM-T-39 | M-07 | U | `ADMIN_APPROVAL_MODE` × профиль (devnet без платных / платные пулы / mainnet) | `single` разрешён только на devnet без платных пулов |
| ADM-T-35 | M-07 | H | профиль devnet | одна подпись → `200` + оповещение `money` |
| ADM-T-36 | M-09 | H | `POST /api/admin/settings` с `referral_donation_share_bps` | `400 bad_setting`; ключа нет в `GET /api/admin/settings` (связь с RPL-T-100) |
| ADM-T-37 | M-09 | U | `key` настройки вне `SETTING_KEYS` | `400` на уровне схемы, до выдачи подписи |
| ADM-T-38 | M-08 | I | одна и та же подпись A09 дважды параллельно | один `200`, второй `401`; одна строка аудита |

### 2.4 Мета-тесты
| id | Правило | Уровень | Проверка | Ожидание |
|---|---|---|---|---|
| ADM-T-40 | M-01, M-02 | U | **покрытие guard:** при загрузке приложения `DiscoveryService` перечисляет все маршруты; у каждого пути `^/api/(admin|editor)(/|$)` должен быть нужный guard (метаданные класса или глобальный `PrivilegedSurfaceGuard`) и строка в реестре; `@AdminPublic`/`@EditorPublic` — только у 6 разрешённых | тест падает на любом расхождении, сообщение называет маршрут |
| ADM-T-41 | M-02 | H | тестовый модуль добавляет контроллер `api/admin/__probe` **без** `@UseGuards` | глобальный guard → `404` для всех; старт в строгом режиме падает (ADM-M-02) |
| ADM-T-42 | M-01 | U | реестр 1.2 ↔ `route-manifest` | одинаковые множества (генератор документа) |
| ADM-T-43 | M-03 | U | таблица ролей ↔ метаданные `@Roles()` | совпадают |
| ADM-T-44 | M-03 | H | `moderator`: A04–A07, A14, A15, P01/P02 → `2xx`; в A07/A15 нет IP, браузера, сессий; A11/A13/A16/A20/A23/A27/A31 → `403 forbidden_role` | как в таблице |

### 2.5 Конфигурация production
| id | Правило | Уровень | Проверка | Ожидание |
|---|---|---|---|---|
| ADM-T-50 | M-13 | U | `validateEnv` в строгом режиме по одному плохому флагу: `DEMO_WALLETS=*`, `DEMO_WALLETS=<wallet>`, `EDITOR_FAKE_LLM=1`, `LIVE_FREE_DONATIONS=on`, `LIVE_EFFECTS=free`, без `COOKIE_DOMAIN`, без или равный `ADMIN_JWT_SECRET`, то же для `EDITOR_JWT_SECRET`, без `TRUST_PROXY`, без Telegram-переменных, `ADMIN_SESSION_TTL_MINUTES=61`, `ADMIN_APPROVAL_MODE=single` при платных пулах, mainnet без `ADMIN_IP_ALLOWLIST` | на каждый — ошибка старта с именем ключа |
| ADM-T-51 | M-13 | U | `NODE_ENV=staging`, `prod`, `Production` | строгий режим включён (как `production`) |
| ADM-T-52 | M-13 | U | строгий режим | `rules.localSignIn=false`, cookie `Secure` |
| ADM-T-53 | M-13 | U | `deploy/docker-compose.prod.yml` + `deploy/.env.example` | ни одного dev-флага из ADM-T-50 по умолчанию (grep-тест) |

### 2.6 Гонки (Б4, API-M-04)
| id | Правило | Уровень | Проверка | Ожидание |
|---|---|---|---|---|
| ADM-T-60 | M-08 | I | два админа одновременно: override и rejudge одной поездки | одно применено, второе `409`; вердикт согласован с аудитом |
| ADM-T-61 | M-08 | I | hold и release одного пула параллельно; hold во время работы `pool-payout.scheduler` | итог детерминирован; выплаты при `hold` нет |
| ADM-T-62 | M-08 | I | два `settings` одного ключа параллельно | последнее по аудиту равно значению в БД; `before` второго = `after` первого |
| ADM-T-63 | M-08 | I | два `promos` с одним кодом параллельно | один `200`, второй `409` |
| ADM-T-64 | M-08 | I | `free-rides` +3 и −2 параллельно | итог +1, две строки аудита |
| ADM-T-65 | M-07, M-08 | I | два подтверждения одного `pending_approval` | одно `applied`, второе `409` |

### 2.7 Аудит, оповещения, утечки, сеть
| id | Правило | Уровень | Проверка | Ожидание |
|---|---|---|---|---|
| ADM-T-70 | M-11 | I | `UPDATE`/`DELETE` на `admin."AdminAction"` ролью приложения | ошибка прав / триггера |
| ADM-T-71 | M-11 | H | чтение A11, A13, A16, A20, A25 | строка `read.*` без тела ответа |
| ADM-T-72 | M-12 | H | fake Telegram (`nock` на `api.telegram.org`): вход, неудачный вход, изменение A31 денежного ключа, 5 неудачных входов, `pending_approval` | по одному `sendMessage` в `ADMIN_ALERT_TELEGRAM_CHAT_ID`; у денежного — `💰 MONEY`, «до → после» |
| ADM-T-73 | M-16 | H | прогнать матрицу 2.1 и собрать все тела ответов | ни одного значения секретов из env теста, ни `stack`, ни токенов |
| ADM-T-74 | M-16 | U | `requestLogMiddleware` и `JsonLogger` на запросе с cookie, `Authorization`, `x-fc-job`, `x-webhook-secret`, подписью | в строке лога их нет |
| ADM-T-75 | M-16 | H | `GET /api/admin/logs` и `?full=1` | IP маскирован; `full` — только admin и с аудитом |
| ADM-T-76 | M-15 | H | preflight `OPTIONS` с чужого Origin на админ-хост | нет `Access-Control-Allow-Origin` |
| ADM-T-77 | M-17 | H | прямой запрос к приложению (не loopback) с `Host: admin.<apex>` | `404` |
| ADM-T-78 | M-17 | H | `ADMIN_IP_ALLOWLIST` задан, IP вне списка | `404` |
| ADM-T-88 | M-12 | H, I | Telegram отвечает `500`, затем таймаут, `429 retry_after=7`, `401` (неверный токен) | изменение `200`; строка `AlertOutbox` `pending` → повтор по расписанию (с учётом `retry_after`) → `sent`; после 24 ч — `undelivered`; лог `admin-alert.undelivered` без токена; `overview.undeliveredAlerts` = N, баннер виден |
| ADM-T-89 | M-12, M-16 | U | текст оповещения и все логи прогона ADM-T-72/88 | нет токена бота, подписей, cookie, полного IP; кошелёк сокращён |
| ADM-T-90 | M-12, M-13 | U | строгий режим, allowlist не пуст, нет `ADMIN_ALERT_TELEGRAM_BOT_TOKEN` или `…_CHAT_ID`; `deploy/.env.example` | старт падает с именем ключа; в `.env.example` значения пустые, в репозитории токенов нет (grep `\d{8,10}:[A-Za-z0-9_-]{35}`) |
| ADM-T-91 | M-12, M-11 | I | аудит и outbox в одной транзакции: откат изменения | нет ни строки аудита, ни оповещения |
| ADM-T-79 | M-10 | H | 31 `auth/nonce` за минуту с одного IP; 31 изменение за минуту одним админом | `429` на 31-м |

### 2.8 Машинные маршруты, CLI, редактор
| id | Правило | Уровень | Проверка | Ожидание |
|---|---|---|---|---|
| ADM-T-80 | M-18 | U, H | webhook: секрет не задан / неверный / верный в `x-webhook-secret` / `Bearer` | `404` / `401` / `200` / `200` |
| ADM-T-81 | M-18 | H | MCP: с `X-Forwarded-For`; задание не `running`; задание старше таймаута; кошелёк убран из `EDITOR_WALLETS` | `404` |
| ADM-T-82 | M-18 | H | `GET /api/health/ready` при упавшей БД | `503`, в теле только `database: down` |
| ADM-T-83 | M-19 | U | `tickets:grant`, `promo:create`, `pool:payout`, `verdict:rejudge` из CLI | строка `AdminAction` с `cli:<user>` и аргументами |
| ADM-T-84 | M-19 | U | `pool:seed`, `db:reset` в строгом режиме | код 1, БД не тронута |
| ADM-T-85 | M-20 | H | `POST /api/editor/jobs` и `…/cancel` | строки аудита `editor.job.create`/`cancel`; задание сверх `editor_jobs_per_day` → `429` |
| ADM-T-86 | M-20 | H | публикация с повтором подписи; без подписи | `401`; аудит `entity.publish` с `previous` у успешной |
| ADM-T-92 | M-20 | H | профиль mainnet: публикация редактора A → `pending_review`; подтверждение A сам; редактором B; админом | `403`; `200 applied`; `200 applied`; бандл меняется только после подтверждения; оповещение на оба шага |
| ADM-T-87 | M-21 | U | новый маршрут `api/admin/*` без строки реестра или без матрицы | ADM-T-40 / ADM-T-42 падают |

### 2.9 Ручные
| id | Что | Шаги | Ожидание |
|---|---|---|---|
| M-ADM-01 | Пентест-чек-лист на staging | `curl` к IP сервера с `Host: admin.<apex>` по 80/443 (default_server nginx); basic auth неверный / верный; `X-Forwarded-Host`; сессия с api-хоста | `401` nginx без пароля; приложение отвечает только через `admin.<apex>` |
| M-ADM-02 | Squads для `set_config` / `set_pool_rules` (P03/P04) | предложение в Squads, 2 подписи, исполнение | без 2 подписей в цепи ничего не меняется |

### Трассируемость
| Правило | Тесты | Пробел в коде (`origin/main`) |
|---|---|---|
| ADM-M-01 | T-40, T-42 | нет `route-manifest` (план API-T, [`backend_contract.md`](backend_contract.md) §4.2) |
| ADM-M-02 | T-40, T-41, T-01 | нет глобального guard (F05) |
| ADM-M-03 | T-04, T-43, T-44 | ролей нет (F07) |
| ADM-M-04 | T-20 … T-24 | nonce различает кошельки и заменяется кем угодно (F13) |
| ADM-M-05 | T-05, T-24 … T-27 | секреты выводятся (F04), нет `jti`/отзыва (F14), TTL 120 |
| ADM-M-06 | T-12, T-30 … T-32 | — (есть) |
| ADM-M-07 | T-33 … T-35, T-39, T-65, M-ADM-02 | второго подтверждения нет (F08) |
| ADM-M-08 | T-38, T-60 … T-65 | проверить `409` на гонках |
| ADM-M-09 | T-08, T-36, T-37 | нет `.strict()` (F06), ключ доли доната есть (F01) |
| ADM-M-10 | T-11, T-79 | нет бюджета `auth` для админки, нет `limit_req` (F12) |
| ADM-M-11 | T-10, T-28, T-70, T-71, T-91 | нет «до», входов-отказов, чтений, БД-защиты (F09) |
| ADM-M-12 | T-72, T-88 … T-91 | оповещений нет (F10); бот и чат Telegram заводит владелец |
| ADM-M-13 | T-50 … T-53, T-90 | `DEMO_WALLETS` (F02), `NODE_ENV` (F03), `LIVE_EFFECTS` (F16) |
| ADM-M-14 | T-01 … T-06, T-12 | `403 forbidden_role` новое |
| ADM-M-15 | T-09, T-76 | — (есть) |
| ADM-M-16 | T-73 … T-75, T-89 | маскирования логов нет (F15) |
| ADM-M-17 | T-77, T-78, M-ADM-01 | нет `ADMIN_IP_ALLOWLIST` |
| ADM-M-18 | T-80 … T-82 | — (есть) |
| ADM-M-19 | T-83, T-84 | CLI без `AdminAction` (F09) |
| ADM-M-20 | T-85, T-86, T-92, T-04 | аудита заданий и просмотра публикаций нет (F09, F11) |
| ADM-M-21 | T-87, матрица T-01 … T-12 | P01–P04 ещё нет |

Итого: 21 правило (20 MUST, 1 MUST NOT), решения 59–66 — цель, пока [`PRODUCT.md`](PRODUCT.md) не пишет их как shipped. Запланированные id: ADM-T-01…12, 20…28, 30…39, 40…44, 50…53, 60…65, 70…79, 80…92 и 2 ручных M-ADM-01/02. Id — не написанный тест. Матрица 2.1 — план проверок, не текущий прогон. Исполняемая планка — [`../testing/COVERAGE_CONTRACT.md`](../testing/COVERAGE_CONTRACT.md).
