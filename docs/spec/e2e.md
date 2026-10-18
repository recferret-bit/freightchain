# E2E-блоки — манифест и план тестирования

> Сводка PR #5 (`cursor/local-e2e-suite-b044`) после мержа PR #3 в `origin/main` (`e8f338ad`). Чек-лист — [`docs/testing/E2E_PLAN.md`](../testing/E2E_PLAN.md), ручные проверки — [`docs/testing/MANUAL_TESTS.md`](../testing/MANUAL_TESTS.md). Решения 1–66 не менялись.
>
> **2026-10-18.** Этот файл описывает быстрый прогон happy-dom. Он не является планкой покрытия. Решения 67 и 68 ([`PROCESS.md`](PROCESS.md), [`../testing/COVERAGE_CONTRACT.md`](../testing/COVERAGE_CONTRACT.md)) отменяют **E2E-M-01** (e2e без браузера) и **E2E-M-06** (переписать или удалить Chrome-скрипты живого просмотра). Те скрипты проверяют то, что уже собрано, и остаются, пока отдельное изменение не поменяет продукт.

## Часть 1. Манифест
### 1.1 Как устроено в PR #5
- **Без браузера.** Модули страниц запускаются под `happy-dom` с замоканным `fetch`. API-проверки ходят в настоящий сервер на compose-базе и пропускаются без `E2E_BASE`. `test:e2e:block1/2` ставят `E2E_REQUIRE=1`, поэтому без сервера прогон падает.
- **Compose** `docker-compose.e2e.yml`:
  - `postgres:17-alpine` на `127.0.0.1:15434`, `redis:7-alpine` на `16381`;
  - **сервиса Solana нет**: блок 2 использует `solana-test-validator` хоста (Agave), как навык `localnet-e2e`.
- **Блоки:**
  - блок 1 — без цепочки (131 проверка: automated 111, mock 10, manual 9, pending 1);
  - блок 2 — локальный валидатор (28: automated 20, mock 2, manual 1, pending 5);
  - всего 159 (automated 131, mock 12, manual 10, pending 6).
  
  Разделы: landing, pitch, whitepaper, lobby, free, promo, referral, admin.
- **Harness:**
  - `e2e/harness/{api,dom,fixtures}.mjs`, сессии `e2e/harness/sessions/*.mjs`;
  - каталог id `e2e/catalog.mjs` (`B1-*`, `B2-*`, `M-*`);
  - `e2e/scripts/{run.sh, chain-init.sh, validator.sh, render-plan.mjs}`.
  
  Мок-кошелёк — ключ `tweetnacl` (`B1-LAND-11`: nonce + verify).
- **Скрипты:**
  - корень: `test:e2e:block1` = `bash e2e/scripts/run.sh 1`, `test:e2e:block2` = `… 2`, `test:e2e:pages`;
  - `e2e/package.json`: `test:pages`, `test:block1`, `test:block2`;
  - зависимости: `bs58`, `happy-dom`, `tweetnacl`.
- **Бесплатные пути и выданный билет (PR #3 уже в main):**
  1. `free-g` — только тул-сим `?sim=1` (продуктовой ссылки `?offline=1` нет); голый `play.html` заказывает EASY;
  2. онлайн-тренировки `free-1c` / `free-2c` / `free-3c` (HARD ×10; `free-3b` заморожен), без списания `freeRides`;
  3. `POST /api/auth/guest` — только EASY (`guest_easy_only`);
  4. недельный выданный билет 1h (повторный `POST`, пока грант ещё `created`, возвращает ту же поездку; `weekly_ticket_spent` — гонка claim);
  5. счётчик `free_on_signup` / дневной грант по-прежнему хранится, тренировки его не тратят.
  
  Промо `kind: 'ride'`, `GET /api/prize/board` и тикер TEN4 тоже на main. Маршруты `auth/pair` и `referrals` с main сохранены. Программы: `programs/freightchain_pools` и `programs/freightchain_honk`.
- **Найденные баги (не исправлены):**
  1. тренировки не списывают `freeRides`; счётчик регистрации всё ещё хранится;
  2. `paintHero` падает без `split` / `totals`;
  3. косметический промо-код отклоняется `visuals_are_honk`;
  4. `GET /api/honk` → `chain: null` без `HONK_PROGRAM_ID`;
  5. [`docs/promocodes.md`](../promocodes.md) устарел;
  6. нет админского HTTP для `set_pool_rules`;
  7. реферальные сценарии не проверяют выдачу;
  8. `e2e-tickets-stub` RETRY CONFIRM и `/reconcile` падают.
- **Пробелы PR #5:** Chrome-скрипты (`server/scripts/e2e-*.mjs`, `client/tools/e2e-chrome.mjs`, `e2e-viewer.mjs`, `landing/tools/e2e-wallet.mjs`) не вызываются. `close_ticket` и ролловер seed-treasury — вручную.
- **Переиспользует:**
  - сценарии `server/test/http/flows.spec.ts` (`flow`, `http-contract`, `telemetry`, `live`, `verdict`, `traffic-proof`, `pools`, `pledges`, `shared-road`, `ticket-orders`, `chain`, `webhook`, `referrals` и др.);
  - 48 интеграционных спек Postgres;
  - `program:test` (LiteSVM).

### 1.2 Правила
- **E2E-M-01** WITHDRAWN by decision 68 (2026-10-18). Was: e2e is code and Docker, with no browser. The happy-dom suite may still run. It does not define coverage. Browser coverage is real headless Chrome ([`../testing/COVERAGE_CONTRACT.md`](../testing/COVERAGE_CONTRACT.md)).
- **E2E-M-02** MUST: каждое правило-MUST из `docs/spec/*.md`, у которого есть UI или межсервисный путь, имеет id в `e2e/catalog.mjs`. Каталог генерирует чек-лист (`render-plan.mjs`) из спецификации, и они не расходятся.
- **E2E-M-03** MUST: блокчейн в блоке 1 — **mock** (`mock-rpc`, профиль compose `mockchain`, [`replays_streams.md`](replays_streams.md) §2.4). В блоке 2 — настоящий локальный валидатор. Сервер в обоих блоках использует реальный `SolanaChainAdapter` без изменений кода.
- **E2E-M-04** MUST: кошельки в тестах — детерминированные ключи (фиксированные сиды), подписи детерминированы. Golden-файлы хранят подписи.
- **E2E-M-05** MUST: раздел `API-*` каталога генерируется из реестра маршрутов (решение бэкенда 6, [`backend_contract.md`](backend_contract.md)).
- **E2E-M-06** WITHDRAWN by decision 68 (2026-10-18). Was: rewrite or delete `e2e-watch.mjs`, `e2e-live-board.mjs`, `e2e-live-flags.mjs`, `replay-test`, and `live-board-test`. Those scripts lock shipped live watch. They stay until a decision-18 change updates `PRODUCT.md` and the tests together.
- **E2E-M-07** MUST: тесты античита и длинные поездки (1h) — ночью, с фиктивными часами и ускорением времени (решения 4, 17).

### 1.3 Новые разделы каталога (план)
| Раздел | Блок | Файлы | Тесты |
|---|---|---|---|
| `B1-WATCH-*` | 1 | `e2e/block1-offchain/watch/{visibility,player}.test.mjs` | RPL-T-01…60 |
| `B1-LOBBY-TRAIN-*` | 1 | `e2e/block1-offchain/lobby/training-label.test.mjs` (каждый тест в двух локалях: EN и RU) | RPL-T-16…21 |
| `B1-LOBBY-I18N-*` | 1 | `e2e/block1-offchain/lobby/i18n.test.mjs` | RPL-T-26…29 |
| `B1-STREAM-*` | 1 + `mockchain` | `e2e/block1-offchain/streams/{donation,chat,moderation}.test.mjs`, `e2e/mockchain/rpc.mjs`, `e2e/harness/wallet.mjs` | RPL-T-70…98 |
| `B1-LEGAL-*` | 1 | `e2e/block1-offchain/legal/copy.test.mjs` | LEG-T-10 |
| `B1-RIDE-*` | 1 | `e2e/block1-offchain/rides/finish.test.mjs` | RID-T-01, -10 |
| `B2-STREAM-*` | 2 | `e2e/block2-chain/streams/donation.test.mjs` | RPL-T-99 |
| `B2-POOL-*` | 2 | `e2e/block2-chain/pool/schedule.test.mjs` | POOL-T-03, -12, -14 |
| `M-RPL-*` | ручные | [`docs/testing/MANUAL_TESTS.md`](../testing/MANUAL_TESTS.md) | M-RPL-01…06 |

**Изменить существующие:** `B1-LOBBY-03` (LIVE без WATCH), `B1-LOBBY-04/09` (REPLAYS без training), `B1-LOBBY-21`, `B1-LAND-26` (`dash-live.js`).

### 1.4 Скрипты npm (план)
| Где | Скрипт | Команда |
|---|---|---|
| корень | `test:e2e:replays` | `bash e2e/scripts/run.sh replays` |
| корень | `test:e2e:streams` | `bash e2e/scripts/run.sh streams` (compose `--profile mockchain`) |
| корень | `e2e:mockchain:up` | `docker compose -f docker-compose.e2e.yml --profile mockchain up -d` |
| `e2e/package.json` | `test:replays` | `node --test … $(find block1-offchain/watch block1-offchain/lobby -name '*.test.mjs')` |
| `e2e/package.json` | `test:streams` | `node --test … $(find block1-offchain/streams -name '*.test.mjs')` |
| `e2e/package.json` | `mockchain` | `node mockchain/rpc.mjs` |
| `server` | (есть) `test`, `test:integration` | vitest-фильтры `live`, `watch`, `donation` |

## Часть 2. План тестирования
| id | Правило | Тест |
|---|---|---|
| E2E-T-01 | M-01 | WITHDRAWN with M-01. Do not assert that `run.sh` refuses Chrome. |
| E2E-T-02 | M-02 | `catalog.test.mjs`: каждый id из `docs/spec/*` с пометкой UI есть в каталоге, и наоборот |
| E2E-T-03 | M-03 | смоук `mock-rpc`: `getHealth`, `getLatestBlockhash`, перевод → `getParsedTransaction` разбирается `SolanaChainAdapter` |
| E2E-T-04 | M-04 | два прогона RPL-T-70 → одинаковая подпись |
| E2E-T-05 | M-05 | diff раздела `API-*` с реестром пуст |
| E2E-T-06 | M-06 | WITHDRAWN with M-06. Do not grep `server/scripts` for an absence of live watch. |
| E2E-T-07 | M-07 | ночной job: AC-F2 (200 сидов, ускорение), AC-P9 |

### Трассируемость
E2E-M-02…05 and E2E-M-07 still have planned ids E2E-T-02…05 and E2E-T-07. E2E-M-01 and E2E-M-06 are withdrawn. Those ids are not written tests.
