# Пул — манифест и план тестирования

> Недельный пул, параметры расписания, билеты, последний старт, сгорание билета, проверка 1,5 дня, апелляции, контракт v5/v6. Решения 34–37, решения владельца 17.10.2026 (раунд 22). Подробности — приложение A (бывший §20 `anticheat_test_plan.md` (superseded, merged into docs/spec), без изменений) и приложение B (выписка из [`MASTER_PLAN.md`](../plan/MASTER_PLAN.md) §3 и §5).

## Часть 1. Манифест
### 1.1 Сейчас в коде
Программа пулов v5 (`origin/main`, `programs/freightchain_pools`):
- `Pool.prep_deadline` / `play_deadline` / `payout_at`, снимок `min_review_secs`;
- `buy_ticket.rs:50` `PaidTicketsDisabled`, `:52` `require!(now < pool.prep_deadline, TooLate)`;
- `DEFAULT_MIN_FINISH_SECS = 10_800`;
- у серии `sale_secs` — это и окно, и каденция.

Бэкенд — `pool-registry.service.ts`, `Pool.fromChain`. `set_pool_rules` без HTTP-маршрута (баг 6 в [`E2E_PLAN.md`](../testing/E2E_PLAN.md)).

### 1.2 Правила
- **POOL-M-01** MUST: пока один пул в неделю. Расписание — **настраиваемые поля**, а не константы:
  - `opens_at` (по умолчанию вт вечер);
  - `sales_close_at = prep_deadline` (закрытие − 2 ч);
  - `last_start_at` (закрытие − 1 ч 15 мин, решение 36);
  - `play_close_at = play_deadline` (вс вечер);
  - `validation_until = payout_at` (закрытие + 1,5 дня).
- **POOL-M-02** MUST: конфиг бэкенда (`POOL_SCHEDULE_*`) используется только при **создании** пула. У живого пула источник правды — аккаунт on-chain. Расхождение → пул не обслуживается, `409 pool_schedule_mismatch` + алерт в админке.
- **POOL-M-03** MUST: после `sales_close_at` билет не продаётся (программа: `TooLate`; UI: кнопки нет).
- **POOL-M-04** MUST: старт после `last_start_at` → `409 pool_last_start_passed`. Поездка, начатая вовремя, дописывается до `play_close_at` + 60 с. Не завершённая к этому моменту — `abandoned` (решение 36; лимит → RID-M-09).
- **POOL-M-05** MUST: билет, не начатый до `last_start_at`, **сгорает без возврата**. Исключение — срыв пула (`min_tickets` не собран, `fail_pool` → Refunding): тогда возврат. В UI покупки — время закрытия и последнего старта в локальном времени, предупреждение и галочка.
- **POOL-M-06** MUST: на devnet-запуске платных билетов нет (`PaidTicketsDisabled`). Попытка — за задания аирдропа ([`PRESEASON_RULES.md`](../legal/PRESEASON_RULES.md) §2), одна на человека (§6). Не начатая до `last_start_at` попытка пропадает.
- **POOL-M-07** MUST: проверка 1,5 дня: финальный вердикт → `pool:attention` → ручная проверка топ‑20 → `commit_winners` не позже `payout_at` → выплаты.
- **POOL-M-08** MUST: результаты публикуются в `payout_at`, затем окно **апелляций** (длительность — параметр расписания). Выплата по спорным местам ждёт решения, по бесспорным — нет.
- **POOL-M-09** MUST: реплеи и план дороги пуловых поездок публичны после `payout_at` (решение 34 → [`replays_streams.md`](replays_streams.md) RPL-M-04).
- **POOL-M-10** MUST: сейчас `Config.min_finish_secs ≤ 7 200` через `set_config`. В v6 — `opens_at`, `last_start_at` (или `start_buffer_secs`), `period_secs` у серии. Существующие поля не переименовываются (решение 37).
- **POOL-M-11** MUST: в правилах платного пула (позже) явно указано, куда идут деньги несыгранных билетов: Solana Pay → выручка `R`; on-chain `buy_ticket` → банк пула (открыто, [`OPEN.md`](OPEN.md)).
- **POOL-M-12** MUST: у `set_pool_rules` есть админский HTTP-маршрут с подписанной парой challenge → действие (решение бэкенда 8).
- **POOL-M-13** MUST: формула рейтинга пула публикуется до `opens_at` и не меняется до `play_close_at` (решение 42 → RID-M-17).
- **POOL-M-14** MUST: донаты не являются входом в пул и не дают преимущества (TERMS 14.5).

## Часть 2. План тестирования
| id | Правило | Сценарий | Ожидание |
|---|---|---|---|
| POOL-T-01 | M-01 | создание пула с конфигом по умолчанию | поля = вт/вс/−2 ч/−1 ч 15 мин/+1,5 дня от заданной точки; часовой пояс из конфига |
| POOL-T-02 | M-02 | on-chain `play_deadline` ≠ бэкенду | `409 pool_schedule_mismatch`, алерт |
| POOL-T-03 | M-03 | `buy_ticket` за 1 с до и через 1 с после `prep_deadline` (LiteSVM) | успех / `TooLate` |
| POOL-T-04 | M-04 | старт в `last_start_at − 1 с` и `+1 с` | 200 / `409 pool_last_start_passed` |
| POOL-T-05 | M-04 | поездка идёт в `play_close_at + 61 с` | `abandoned`, засчитано пройденное |
| POOL-T-06 | M-05 | билет не начат | после `last_start_at` — статус «сгорел», возврата нет |
| POOL-T-07 | M-05 | `fail_pool` | возврат (`claim_refund`) |
| POOL-T-08 | M-06 | devnet: `buy_ticket` | `PaidTicketsDisabled`; попытка из заданий — одна |
| POOL-T-09 | M-07 | 2 000 поездок в очереди при закрытии (= AC-P9, вариант) | проверка < 2 ч; `commit_winners` ≤ `payout_at` |
| POOL-T-10 | M-08 | апелляция по 3-му месту | 1-е и 2-е выплачены, 3-е ждёт |
| POOL-T-11 | M-09 | реплей до/после `payout_at` | = RPL-T-09 |
| POOL-T-12 | M-10 | `create_pool` с окном 2 ч при `min_finish_secs = 10 800` / 7 200 | `WindowTooShort` / успех |
| POOL-T-13 | M-11 | текст правил платного пула | режим денег назван (проверка документа, [`legal.md`](legal.md)) |
| POOL-T-14 | M-12 | `set_pool_rules` по HTTP: подпись верная / чужая / повтор | 200 / `404` / `409` |
| POOL-T-15 | M-13 | смена формулы после `opens_at` | = RID-T-06 |
| POOL-T-16 | M-14 | донат во время пула | нет билета, нет изменения рейтинга (= RPL-T-84) |

### Трассируемость
Каждое правило POOL-M-01…14 → запланированный id POOL-T-01…16 (у M-04 и M-05 по 2 id). 14 MUST. Id — не написанный тест. Исполняемая планка — [`../testing/COVERAGE_CONTRACT.md`](../testing/COVERAGE_CONTRACT.md).

---

## Приложение A. Недельный формат пула (бывший §20)
> Перенесено без изменений из `anticheat_test_plan.md §20` (superseded, merged into docs/spec) (17.10.2026); уровни заголовков сдвинуты на один. Нормативна Часть 1 этого файла; при расхождении прав манифест.

### 20. Недельный формат пула (решение владельца 17.10.2026) и последствия

**Формат (пока один пул):** пул открывается во вторник вечером и закрывается в воскресенье вечером. Потом 1,5 дня проверки (вердикты, ручная проверка топ‑20), затем результаты и выплата. Продажа билетов закрывается **за 2 ч до закрытия пула**. Купил билет, но не сыграл до закрытия — **билет сгорает, без возврата**.

**Время — параметр, а не константа** (уточнение владельца). Точные часы и часовой пояс не фиксируются в документах. Это настраиваемые поля расписания пула: в **аккаунте пула on-chain** и в **конфиге бэкенда**. Значения по умолчанию: вт вечер → вс вечер, отсечка продаж 2 ч, проверка 1,5 дня. Бэкенд держит их синхронно и **сверяет с on-chain** (§20.3).

#### 20.1 Решение 33 — что удалить в коде (позже, не в этом плане)
- Сервер:
  - `server/src/domain/live/live-rules.ts`: `EFFECT_IDS = ['tip','night','day','potholes','trench','sinkhole']` → игровые эффекты убрать, `night`/`day` тоже (они меняют видимость, то есть влияют на поездку). Остаётся только косметика.
  - `server/src/presentation/live/live.http.controller.ts`: `POST watch/:id/donations` (`:55`), `donation-orders*` (`:61–73`) для текущих поездок, `effects/:eventId/applied` (`:89`).
  - `server/src/presentation/live/dto/live.dto.ts` (`donationBodySchema`).
  - `server/src/domain/verdict/replay-engine.ts`: `donatedObstacles`, `donated-obstacle-ignored` (`:277`), `event-unapplied` (`:144`), `event-clock-mismatch`; `ride-replay.entity.ts` (поля подаренных ям) — **оставить только для перепроверки старых поездок** (правила по `RULES_VERSION` поездки, AC-W18).
  - `TrafficSimulator(…, donatedObstacles, …)` (`replay-engine.ts:187`).
- Клиент: `client/js/live-effects.js`, `ui/live-feed.js`, `ui/watch-panel.js`, `ui/watch-pledges.js`, `watch.js` (эффекты на поездке).
- Конфиг: **временная мера до удаления кода — `LIVE_EFFECTS=off`** (`env.schema.ts:150`, сейчас по умолчанию `all`: «donations that change the ride … every ride»). `LIVE_FREE_DONATIONS` (`:144`) — по решению о донатах на реплее.
- Тексты:
  - [`docs/legal/TERMS.md`](../legal/TERMS.md) раньше говорил «Viewers may send donations to a driver during a live ride … Donation effects shown in the ride are cosmetic» — это не совпадало с кодом (подаренные ямы наносят урон) и с решениями 18/33. ✅ **Помеченные клаузы 17.10 внесены в `docs/legal/*`** (TERMS §14.1–14.5, PRIVACY, PRESEASON_RULES 16a; сводка в [`legal.md`](legal.md) §1.1): донаты только на реплее и только косметика, live нет. Код по-прежнему не совпадает с текстом — это отдельное изменение кода.
  - [`MASTER_PLAN.md`](../plan/MASTER_PLAN.md) §3 («Донаты: 100% водителю») — без изменений по деньгам.
- Чаевые (`tip`) без влияния на игру на реплее предыдущей поездки решению 33 не противоречат. Оставлять ли их — продуктовый вопрос, не античит.

#### 20.2 Последствия для честности и античита
- **Утечка дороги:** окно ≈ 5 дней при общем `roadSeed` (решение 13). Реплей или план дороги завершённой поездки раскрыли бы дорогу пула тем, кто стартует через несколько дней. Поэтому реплеи и `GET /api/watch/:id/road` пуловых поездок закрыты до закрытия пула, по умолчанию до `payout_at` (решение 34).
- **Тренировка на своей зачётной дороге:** при нескольких попытках игрок видит свой прошлый реплей и выучивает ямы. На devnet-запуске попытка одна ([`PRESEASON_RULES.md`](../legal/PRESEASON_RULES.md) §5 п. 3, §6), поэтому достаточно общего `roadSeed`. Если попыток станет больше — личная раскладка ям `holeSalt` (**решение 35, принято**).
- **Последний старт:** → **решение 36**.
- **Сгоревшие билеты и мотивация к спешке:** игрок, который «должен успеть», стартует в последние часы. Это нагрузка на сервер в вс вечер (AC-P9 конкурентность — прогнать «пик последних 2 часов»).

#### 20.3 Контракт пулов v5 (в main) — что есть и чего не хватает
Проверено по `programs/freightchain_pools/src` (`origin/main` после мержа PR #3, v5; каталог программ сплющен):
- **Сроки в аккаунте пула уже есть** (`state.rs`, `Pool`): `prep_deadline`, `play_deadline`, `payout_at` («end of the review window: no prize is paid … before it»), плюс снимок `min_review_secs`. `buy_ticket.rs:52`: `require!(now < pool.prep_deadline, PoolError::TooLate)` — **это и есть отсечка продаж**, а `buy_ticket.rs:50` — `PaidTicketsDisabled` (v5). Соответствие:

| Поле формата | Сейчас в v5 | Значение по умолчанию |
|---|---|---|
| `opens_at` (продажи и игра открываются) | нет; пул открыт с `create_pool` / `open_next_pool` (слот серии) | вт вечер |
| `sales_close_at` | **`prep_deadline`** | `play_close_at − 2 ч` |
| `last_start_at` | нет (бэкенд) | `play_close_at − 3600 с − 15 мин` (решение 36) |
| `play_close_at` | **`play_deadline`** | вс вечер |
| `validation_until` | **`payout_at`** | `play_close_at + 1,5 дня` (129 600 с ≥ `min_review_secs`, по умолчанию 3 600) |

- **Конфликт 1 — пол окна:** `check_windows` (`create_pool.rs`) требует `play_deadline − prep_deadline ≥ Config.min_finish_secs`, а `DEFAULT_MIN_FINISH_SECS = 10_800` (3 ч, `constants.rs:50`). Окно 2 ч будет отклонено (`WindowTooShort`). Пол меняется админом через `set_config(min_finish_secs)` (`admin.rs`) → выставить ≤ 7 200 (решение 37 а). Комментарий в программе («the last call: no sale, no new ride – the shifts on the road finish») подразумевает, что после `prep_deadline` новых поездок нет; у владельца поездки можно начинать до `last_start_at`. Проверка старта — на бэкенде, программа старты не видит.
- **Конфликт 2 — каденция серии:** `series.rs`: `sale_secs` — «sale window AND cadence: the next pool opens when this one stops selling». Значит, серия не умеет «продажи ≈ 5 дней, следующий пул через 7 дней»: следующий пул откроется сразу после конца продаж. Пока пул один — открывать вручную `create_pool` с явными сроками. В v6 — отдельный `period_secs` (решение 37 б).
- **Предлагаемые поля v6 (только план):** `opens_at: i64` (`buy_ticket` требует `now ≥ opens_at`), `last_start_at: i64` (или `start_buffer_secs`), у серии `period_secs`. Имена в бэкенде: `sales_close_at = prep_deadline`, `play_close_at = play_deadline`, `validation_until = payout_at`, существующие поля не переименовывать (IDL и раскладка аккаунта, `POOL_STATUS_OFFSET`).
- **Синхронизация с бэкендом:**
  - конфиг бэкенда (`POOL_SCHEDULE_*`: смещения и значения по умолчанию) используется только для **создания** пула;
  - у живого пула источник правды — аккаунт on-chain (`pool-registry.service.ts`, `Pool.fromChain`);
  - бэкенд при каждом обновлении сверяет сроки. Расхождение → пул не обслуживается (`409 pool_schedule_mismatch`) + алерт в админке;
  - `last_start_at` бэкенд вычисляет из `play_deadline` и запаса, пока в v6 его нет.
- **Несыгранные билеты — куда деньги** (два режима, честно):
  1. **On-chain продажа (v5 `buy_ticket`, `paid_tickets_enabled`):** у программы нет понятия «сыграл». `tickets_sold × price` целиком входит в банк пула. Делёж `prize_bps / seed_bps / fee_bps` (по умолчанию 8500 / 500 / 1000) идёт от `counted_pot = min(tickets_lamports, ticket_room(sponsored, max_player_share_bps)) + sponsored` (`state.rs`). Излишек сверх `max_player_share_bps` (≤ 47,4 %) уходит в seed treasury (`PoolClosed.ticket_excess`). То есть **деньги несыгранных билетов остаются в пуле**, как и сыгранных, с тем же делёжом и тем же потолком.
  2. **Solana Pay в казну ([`MASTER_PLAN.md`](../plan/MASTER_PLAN.md) §3):** билет — выручка оператора, а не эскроу. Несыгранные билеты входят в `R` и через `P = min(0,40·R, $2 500, 0,90·F)` частично попадают в призы **следующей** недели. В «этот пул» напрямую они не идут.

  → для платного пула (позже) нужно явно записать в правилах, какой режим действует. По текущему плану это Solana Pay, тогда формулировка «остаются в призовом пуле» для него **неверна**.

#### 20.4 Правило сгорания билета — тексты и UI
- **К чему применяется:** на devnet-запуске платных билетов нет: «No purchase necessary», попытка только за задания аирдропа ([`PRESEASON_RULES.md`](../legal/PRESEASON_RULES.md) §2, [`MASTER_PLAN.md`](../plan/MASTER_PLAN.md) §5 / раунд 18). Там действует аналог: попытка, не начатая до последнего старта (решение 36), пропадает. **Правило «купил — не сыграл — сгорел» относится к платному пулу (позже).** Сезоны пока не планируются, поэтому формат «вт вечер – вс вечер + 1,5 дня» — расписание по умолчанию для пула любого запуска. Сроки в правилах devnet-запуска задаются полями пула.
- **TERMS** уже близко: [`docs/legal/TERMS.md`](../legal/TERMS.md) 7.5 «All Ticket purchases are final and non-refundable, including if you … do not use the Ticket», исключение — сбой с нашей стороны (7.5 a). Добавить явно:
  - «билет действует только в пуле, для которого куплен; не начатый до `last_start_at` сгорает»;
  - срыв пула (не собран `min_tickets`, `fail_pool` → Refunding) — возврат.
- **UI покупки:** время закрытия пула и **последнего старта** в локальном времени игрока, предупреждение «не сыграешь до … — билет сгорит без возврата», подтверждение галочкой. После `sales_close_at` кнопки покупки нет.
- **Потребительское право (без юридических выводов):** во многих странах у потребителя есть право на отказ от дистанционной покупки, и для досуга на конкретную дату и для цифрового контента бывают исключения. Применимость к билету на пул нужно подтвердить у юриста (консультация отложена владельцем, принятый риск, [`OPEN.md`](OPEN.md) раунд 19). Это не юридическая консультация.

#### 20.5 1,5 дня проверки — хватит ли вычислений
- По §9.7 пересчёт идёт **инкрементально во время поездки**, поэтому к закрытию остаётся финальный вердикт (доли секунды на поездку) и ручная проверка.
- Худший случай — полная перепроверка после смены правил: N поездок × 2–7 с CPU (30 Гц, §9.3). Пример: 1 000 игроков × 7 попыток = 7 000 поездок × 7 с ≈ 13,6 ч CPU → на 4 воркерах очереди (`ReplayQueuePort`, concurrency 4) ≈ 3,4 ч. Это ≪ 36 ч. Запас есть и на 10 000 поездок (≈ 5 ч на 8 воркерах).
- Узкое место — **люди:** ручная проверка топ‑20 (≈ 20–30 мин на поездку с трассами мини-игр, два ревьюера на топ‑3) ≈ 8–12 ч работы — укладывается в 1,5 дня. **Апелляции — после окна проверки (решение владельца 17.10):** результаты публикуются в `payout_at`, затем окно апелляций (длительность — параметр расписания пула). Выплата по спорным местам ждёт решения апелляции, по бесспорным — не ждёт (как в правилах: перемещение вверх после дисквалификации).
- Порядок: финальный вердикт → `pool:attention` → ручная проверка → `commit_winners` (корень победителей on-chain) не позже `payout_at` → выплаты с `pay_from`. Тест: AC-P9 в варианте «закрытие пула: 2 000 поездок в очереди, проверка < 2 ч».

---

## Приложение B. Параметры сезонов, пулов и билетов в `MASTER_PLAN.md`

- Полная сводка решений по формуле банка недели (`F = B + S`, `P = min(0.40·R, $2,500, 0.90·F)`, `T = F + P + C`, `85% / 5% / 10%`, потолок `free_prize_board_cap_bps = 3000`, равное деление ничьих, отбор в финал сезона) и недельным билетам (`weekly_ticket_1h_enabled`) находится в [`../plan/MASTER_PLAN.md`](../plan/MASTER_PLAN.md) **§3 и §5** (чтобы не дублировать таблицы между файлами).
- Целевые решения 33–37 (переход к одному пулу 1h со расписанием вт–вс + 1,5 дня проверки и отмена игровых эффектов донатов) имеют приоритет над расписанием пн–вс из `MASTER_PLAN.md` §4 (см. **Часть 1** и **Приложение A** выше, а также [`rides.md`](rides.md) Приложения A–B).

---

## Приложение C. Текущая реализация доски призов на `main` (`server/src/domain/prize/prize-rules.ts`)

> Описание поведения, собранного в `server/src/domain/prize/prize-rules.ts` и `GET /api/prize/board` (см. также [`PRODUCT.md`](PRODUCT.md)):

- **Валюта и статус**: расчётные суммы в `USDC` (центы `BASE_STEPS_CENTS = [30_000, 75_000, 150_000, 300_000]` — `$300 / $750 / $1,500 / $3,000`), `TOKEN_IS_PRIZE = false` (TEN4 никогда не является призом контеста). Сейчас черновик: реальные переводы USDC автоматически не отправляются.
- **Окна недели (`PRIZE_WEEK_OPEN_HOUR_UTC = 0`)**:
  - Зачётная игра (`ranked`): пн `00:00 UTC` → вс `12:00 UTC` (`RANKED_CLOSE_MS = 156 ч`).
  - Проверка (`verify`): вс `12:00 UTC` → пн `12:00 UTC` (`VERIFY_END_MS = 180 ч`).
  - Апелляции (`appeals`): пн `12:00 UTC` → вт `12:00 UTC` (`APPEALS_END_MS = 204 ч`).
  - Выплаты (`payout`): до конца вторника (`PAYOUT_END_MS = 216 ч`).
- **Лимиты зачётных стартов в неделю на кошелёк (`ranked: true` в `POST /api/rides/:id/start`)**:
  - `PAID_RANKED_STARTS = 5` платных стартов (включая еженедельный выданный бесплатный билет 1h — `weekly_ticket_1h_enabled = 1`, AMOE).
  - `PROMO_RANKED_STARTS = 1` промо-старт (`kind: 'ride'`).
  - Тренировки (`tier = free`) никогда не идут в зачёт.
- **Формула призового пула и распределение (`prize-rules.ts`)**:
  - `F = B + S` (база ступени + спонсор), вклад билетов `P = min(0.40 * R, $2,500, 0.90 * F)`, общий банк недели `T = F + P + C` (где `C ≤ 0.25 * F` — перенос).
  - Деление `T`: `85%` на доски недели (`1h: 25%`, `4h: 30%`, `8h: 45%`), `5%` в перенос `C`, `10%` в финал сезона (`SEASON_WEEKS = 7`, `LIVE_FINAL_WEEK = 7`, `SEASON_QUALIFIERS = 8` лучших по сумме мест с `MISSED_WEEK_PLACE = 1000`).
  - Внутри каждой доски (`MIN_BOARD_PARTICIPANTS = 10`): `80%` — топ-места (`TOP_PLACES = 10`, или топ-10% при `> 100` участниках), `20%` — поровну всем финишировавшим (`completer pool`). При равенстве очков делят сумму занятых мест поровну.
- **Гео-ограничения и возраст (`GeoLocatorPort`, `MeDto`)**:
  - Возраст `18+` (или `19+`/`21+` по юрисдикции) и отсутствие в санкционном списке (`CU, IR, KP, SY`, `UA-43, UA-14, UA-09`) и списке исключённых для платных контестов штатов США (`SC, AZ, LA, AR, DE, MT, TN`).

---

## Приложение D. Архитектура эскроу-программы (`programs/freightchain_pools` v4/v5), сиды дороги, воркеры и тулчейн

- **Некастодиальный принцип и два серверных ключа**:
  - Все средства билетов, переносов (`rollover`) и спонсорских пледжей хранятся на PDA программы `programs/freightchain_pools`; каждый кошелёк сам подписывает и отправляет свои транзакции, а сервер только индексирует события (`PoolSyncService` / `sync-pools.command.ts`) и начисляет билеты.
  - Сервер держит два горячих ключа:
    1. **Crank (`CRANK_SECRET`, `PoolCrankScheduler` / CLI `npm run pool:crank`)**: выполняет безразрешительные шаги жизненного цикла (`open_next_pool` из админской `Series`, `seal_road`, `fail_pool`, `expire_pool`, `refund`, `refund_sponsor`, `close_pool` через `nextCrankStep`).
    2. **Payout (`PAYOUT_SECRET`, `PoolPayoutScheduler` / CLI `npm run pool:payout`)**: когда у всех поездок пула вынесен финальный вердикт (`!poolUnreviewed`), записывает ончейн-аттестации заездов с пледжами (`record_ride_attestation` через `AttestationService.attestRide`), публикует корень дерева Меркла победителей (`commit_winners` / `winners-merkle.ts`) и закрывает выплаченные пулы (`close_pool`). Холодный ключ администратора (`admin`) может наложить вето на корень (`veto_winners`) в течение окна проверки `min_review_secs` (`3600 с`).
- **Одна дорога на пул и запечатывание сида (`seal_road`, `provable-seed.ts`)**:
  - В режиме программы `Pool.rideSeed` выводится детерминированно из хеша слота (`projectRoadSeed` в `server/src/domain/road/provable-seed.ts`) инструкцией `seal_road` на слоте `>= open_slot + 8`. До вызова `seal_road` старт поездки в пуле возвращает `409 road_not_sealed`.
  - В кабине грузовика (`client/js/seal.js`, `client/js/ui/cab-chain.js`) отображается криптографическая привязка сида дороги к слоту Solana. (Для legacy `transfer`-режима без пула суточный сид выдаётся через `DailySeedRepositoryPort.claim`.)
- **Правила программы v4 / v5 (`programs/freightchain_pools`)**:
  - **v4**: дерево Меркла победителей (`commit_winners`, `veto_winners`, `pay_prize`), ончейн-аттестации поездок (`RideAttestation`), спонсорские пледжи за километр (`Pledge`: `create_pledge`, `settle_pledge`, `refund_pledge`, синхронизация `SyncPledgesHandler`), возврат спонсорских взносов при отмене пула (`SponsorReceipt` / `refund_sponsor`), минимальные пороги `Config` (`min_review_secs = 3600`, `min_finish_secs = 10800`).
  - **v5**: дефолтный сплит `8500 / 500 / 1000` (85% победителям / 5% перенос / 10% комиссия, без реферальной ноги на цепи), инструкция `set_pool_rules`, потолок доли одного игрока `max_player_share_bps < 5000` (дефолт `4740` = 47.4%), переключатель `paid_tickets_enabled`. Открытые вопросы деплоя отслеживаются в [`docs/tech/escrow-open-items.md`](../tech/escrow-open-items.md) и [`docs/tech/program-deploy.md`](../tech/program-deploy.md).
- **Окна старта, индексация билетов, Priority Fees / RPC и удержание выплаты (`Pool.hold`)**:
  - Заказ и старт поездки в пуле разрешены до `Pool.startBy` (`canFinishBy`; после дедлайна — `409 rides_closed`). Если пул не набрал `min_tickets`, возврат билетов (`refundable`) при необходимости бандлит `fail_pool` в ту же транзакцию.
  - Подтверждение покупки билета (`TicketSettlementService`) идёт по быстрому пути через `confirm`, фоновый `program-watcher.ts` и вебхук `/api/chain/webhook`.
  - Приоритетные комиссии и перегрузка RPC: `fee-estimator.ts` динамически оценивает compute unit price (`getRecentPrioritizationFees`), а `solana-rpc.ts` прозрачно переключается по списку `SOLANA_RPC_FALLBACKS` при ошибках или перегрузке основного RPC.
  - Перед коммитом корня победителей `PoolAttentionService.markPool` проверяет топ-20 пула; если сработали флаги внимания или выставлен `Pool.hold` (`saveHold`), `claimSentUnlessHeld` блокирует автоматическую отправку `commit_winners` до ручной проверки администратором.
- **Тулчейн и команды разработки**:
  - Сборка и IDL: `anchor build --arch v0`, `npm run program:idl` (`server/scripts/vendor-idl.mjs` обновляет `server/test/fixtures/chain/pool-program.json`), воспроизводимая сборка `npm run program:verify` (`verifiable-build.hash`).
  - Тесты: `npm run program:test` (LiteSVM: 163 теста `freightchain_pools` + 40 тестов `freightchain_honk`), `npm run test:e2e:block2`.
  - Devnet-утилиты (никогда не трогать глобальный `~/.config/solana/id.json`; всегда передавать явный `--url devnet`, деплой только по прямому запросу пользователя): `server/scripts/devnet.sh`, `node server/scripts/pool-admin.mjs`.
