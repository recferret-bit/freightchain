# Поездки — манифест и план тестирования

> Типы поездок, 1h как единственная рейтинговая поездка, тренировки, динамический финиш, статистика для рейтинга. Решения: 17, 38–44, 23, 42, 6, 7; решение владельца 17.10.2026 о рейтинге. Подробности алгоритмов — приложения A (бывший §21) и B (бывший §22) ниже, текст без изменений.

## Часть 1. Манифест

### 1.1 Сейчас в коде (`origin/main`)
- Тиры:
  - `ride-tier.ts:26` — 1h `{usd 5, minTickets 20, schedule saleHours 24 / playHours 3 / reviewHours 48}`, есть и 4h/8h;
  - трипы `client/js/trips.js` (`'1h'` `finish:false`, free-уровни `free-1c` / `free-2c` / `free-3c`, замороженный `free-3b`, гость `free-g`).
- Тренировки: `POST /api/rides {tier:'free', level}` без списания `freeRides` (счётчик `free_on_signup` и `GrantDailyFreeRidesHandler` ещё в коде). Гостевой EASY — `POST /api/auth/guest`. Недельный билет 1h — на main.
- Финиш: `completeDist = K × MAX_SPEED × minSeconds`. Для 1h это 50 400 м (`ride-rules.ts:5,52`). Завершение — `lastS ≥ completeDist` **со слов клиента** (`ride.entity.ts:337`).
- Статистики по поездке нет, только агрегаты (`server/prisma/stats/stats.prisma`). Красный свет считает только клиент (`orchestrator.js:49–53`).

### 1.1a Бесплатные уровни, туториал, Assist и недельные билеты (`ride-trip.ts`, `trips.js`, `tutorial.js`, `assist.js`)
- **Таблица бесплатных уровней (`FREE_LEVELS` в `server/src/domain/rides/ride-trip.ts` ⇄ `client/js/trips.js`, страны в `client/js/free-countries.js`)** (при `FREE_RIDE_SECONDS = 180`):
  - **Level 1 — EASY (`free-1c`)**: `180 с` (`×1`), `K = 0.3` → `completeDist = 1 512 м`, маршрут Stuart Highway (`stuart`), старт `'straight'`, `first: ['country']`, `firstLen: [500, 500]`, `holesFrom = 4 000 м` (ямы не появляются на EASY), туториал по умолчанию на первой поездке, Assist доступен.
  - **Level 2 — MEDIUM (`free-2c`)**: `300 с` (`×5/3`), `K = 0.4` → `completeDist = 3 360 м`, маршрут Route 66 (`route66`), `first: ['xroad4', 'fork', 'xroad4']`, `firstLen: [450, 450]`, `holesFrom = 400 м`, Assist доступен.
  - **Level 3 — HARD (`free-3c`)**: `1 800 с` (`×10`, 30 мин), `K = 0.4` → `completeDist = 20 160 м`, маршрут Brenner Pass (`brenner`), `first: ['fork', 'xroad', 'fork', 'arterial', 'xroad']`, `firstLen: [450, 450]`, крутые повороты (`bends: 1.35`), `holesFrom = 150 м` (`HOLE_FIRST`), `tutorial: false` и `assist: false` (`409 tutorial_not_allowed` / `assist_not_allowed`).
  - **Гостевой старт (`play.html` / `client/js/easy-entry.js`) и оффлайн `?sim=1` (`free-g`)**: при открытии чистого `play.html` без `?ride=` создаётся одноразовая гостевая сессия `POST /api/auth/guest` (`guest_<hex>`, `walletSignIn: false`) и заказывается реальная поездка EASY (`free-1c`, с сердцебиениями, реплеем и проверкой) либо оффлайн-фолбэк `free-1c` при недоступности API. ID `free-g` остаётся только для режима `?sim=1`.
  - **Замороженные `trip` ID (`TRIP_ROADS`, `TRIP_HOLE_FIRST`)**: `free`, `free-1`, `free-2`, `free-3`, `free-1b`, `free-2b`, `free-3b` (15 мин HARD), `classic` — **никогда не удалять и не менять параметры**, чтобы старые поездки проходили `verdict:rejudge` и открывались в реплеях; при перенастройке уровня создаётся новый ID (`free-1d` и т. п.). Навыки проверки: `trip-design` и `level-check`.
- **Выбор и смена уровня (`readyFreeRide`) и доска лидеров**:
  - Если у игрока уже есть неначатая (`ordered`) бесплатная поездка, повторный `POST /api/rides { tier: 'free', level }` перевыбирает уровень/маршрут/сид на месте (`readyFreeRide`, пересчитывает `completeDist`); попытка стартовать устаревшую вкладку со старым `level` возвращает `409 ride_rechosen`.
  - Доска бесплатных заездов: `GET /api/leaderboard?board=free&level=1|2|3` (ключи `localStorage`: выбор уровня `freightchain.level`, вкладка доски `freightchain.board-level`, чекбокс Assist `freightchain.assist`).
- **Туториал (`client/js/ui/tutorial.js`) и водительский Assist (`client/js/ui/assist.js`, `client/js/guide.js` → `cockpit/guide.js`)**:
  - Туториал (9 шагов на приборной панели + перехват живых ошибок `trouble()`) включается, если у игрока ещё нет `Player.tutorialPassedAt`; старт поездки с `tutorial: true` проставляет `Player.tutorialPassedAt` в `StartRideHandler` под локом игрока.
  - Водительский Assist (`CFG.ASSIST = 0.5`) вдвое снижает и урон корпусу (`hurt()`, износ от холода), и разряд батареи (`updateBattery`), а также показывает баннер подсказок (`ASSIST_HULL_DAMAGE` при этом остаётся строго выше `PASS_DAMAGE_SHARE = 0.25`, чтобы серверный `checkWorld` засчитывал попадание в яму и не отклонял поездку как `obstacle-ignored`).
  - Достижения по уровням и самостоятельной езде: `free-easy`, `free-crossroads`, `free-hard`, `on-my-own` (прохождение без Assist), `free-medium-3/5/10`, `free-hard-2/3/5`.
- **Безлимитные тренировки и еженедельный бесплатный билет (`weekly_ticket_1h_enabled`)**:
  - Тренировки (`tier: 'free'`) безлимитны (`freeRides` не списывается; исторические поля `freeRides`, `freeDay`, `freeRidesMax` и `GameSetting` ключи `free_on_signup`, `free_rides_daily_max` сохранены для совместимости).
  - Раз в неделю (`weekly_ticket_1h_enabled = 1`, `weekly_ticket_1h_days = 7`) каждому кошельку выдаётся 1 бесплатный зачётный билет на `1h` (`OrderRideHandler`: сначала тратится `PromoRideGrant`, затем недельный билет, затем купленный билет).

### 1.1b Алгоритм генерации дороги (`@freightchain/shared` ⇄ `server/src/domain/road`)
Клиент и сервер строят побитово идентичную бесконечную детерминированную дорогу из `(seed, trip)` через общие модули `client/shared/{prng.js,road.js,road-network.js,road-geometry.js,route-curvature.js}` и их серверный порт `server/src/domain/road/{road-rules.ts,road-layout.ts,road-plan.ts}` (`RID-M-21`, тест `RID-T-12` в `road-drift.spec.ts`). Полная математическая спецификация — **Приложение C (§§C.1–C.7)** ниже: примитивы ГПСЧ (`mulberry32`, `rnd`), координаты хребта `(s, d)` и `RoadLayout.onRoad(s, d)` (`C.1–C.2`), стартовый выезд `sA = 190 м` / `Sm = 225 м` (`C.3`), 9 шаблонов `PATTERNS`, таблица `TRIP_ROAD_SPEC` и цикл `extendTo(targetS)` (`C.4`), фазы светофора и `stopLine` (`C.5`), развилки `FORK`, профили кривизны `ROUTE_CURVATURE` и 2D-интегрирование `(RX, RZ, RT)` (`C.6`), типы ям `HOLES`, чанковый ролл `rollChunkHole` и урон по осям `holeDamage` (`C.7`).

### 1.2 Правила
- **RID-M-01** MUST: типы поездок — **тренировочная** (`tier = free`, уровни, гость офлайн) и **1h**. 1h — единственный тип для рейтинга и пула. 4h и 8h не продаются и не создаются (решение 17; `onSale=false`, `POST /api/rides {tier:'4h'}` → `400`/`409`).
- **RID-M-02** MUST: тренировочная поездка не рейтинговая, без TEN4, без пула, без мини-игр (решение 19), **не попадает в реплеи** и в лобби помечена на EN и RU (→ [`replays_streams.md`](replays_streams.md) RPL-M-02/10/10a). Тренировка (решение 56, ✅ 17.10.2026) = `tier=free` (все уровни) + офлайн-гость + любая поездка с туториалом/assist. Бесплатная попытка devnet-запуска и часовой промо-заезд — **не** тренировка.
- **RID-M-03** MUST: финиш 1h считает **сервер** при создании поездки: `finishFor(roadSeed, trip, FINISH_RULES_VERSION)`, ≈ 3600 с при `V_BASE = 65 км/ч` на свободной прямой, с учётом поворотов, светофоров, развилок и фиксированного запаса на мини-игры (решения 38, 39). Результат записывается в `Ride.completeDist`.
- **RID-M-04** MUST: точка финиша зависит только от `roadSeed`, `trip` и версии правил. От `trafficSalt`, `mgSalt` и `holeSalt` она не зависит, поэтому одна на пул (решение 39).
- **RID-M-05** MUST: у созданной поездки финиш не меняется при смене констант (как `ride-rules.ts:46`).
- **RID-M-06** MUST: финиш снапится в безопасное место (≥ 60 м от перекрёстков и развилок, не в станции, не в яме). Сдвиг ≤ 300 м.
- **RID-M-07** MUST: `finishS ≤ ROAD_PLAN_MAX_S − 5 000`, иначе пул не создаётся (решение 40).
- **RID-M-08** MUST: «доехал» = в серверном пересчёте `s` пересекла `finishS` до лимита, без провала и без reject. `lastS` клиента — только предварительный статус. Расхождение → `finish-not-reached`.
- **RID-M-09** MUST: лимит — 90 мин игрового времени (решение 43). Для позднего старта: `min(90 мин, play_close_at + 60 с − start)`. Не доехал → `timeout`, `finished=false`.
- **RID-M-10** MUST: ранний финиш — хорошее время, минимального времени нет. Регулятор `MAX_SPEED` не меняется. Время меньше p1 людей → review, не reject (решение 41).
- **RID-M-11** MUST: в 1h рисуется линия финиша и оставшиеся км (`finish: true`), ожидаемое время не показывается (решение 44).
- **RID-M-12** MUST: у каждой поездки есть строка `stats.RideResult` с полями из приложения A §21.2. Её пишет воркер вердикта (upsert по `rideId`). В рейтинг идут только серверные поля (S/D/Srv), клиентские (C) только сверяются → `client-stats-mismatch` (flag).
- **RID-M-13** MUST: урон хранится по источникам (ямы, машины, объекты у дороги, холод, прочее), сумма = `damageTotal`.
- **RID-M-14** MUST: проезд на красный считает сервер по одному определению `stopLine(j, +1)` и фазе `signal(j,'main') === 'R'` (решение 7, каталог #32).
- **RID-M-15** MUST: поля без правила (`stopLineViolations`, `speedingSeconds`) — `null`, не 0 (решение 41).
- **RID-M-16** MUST: штрафы мини-игр — отдельные поля (`mgWrong`, `mgMissed`, `mgPenaltySeconds`, `mgDetail`), к времени автоматически не прибавляются. Поездку мини-игры не проваливают (решение 23).
- **RID-M-17** MUST: рейтинг пула. Ворота — `finished && verdictTier = verified`. Не доехавшие стоят ниже всех доехавших (по `distanceM`, затем по урону). Формула владельца с версией (`scoreFormulaVersion`) публикуется до открытия пула и не меняется до закрытия (решение 42). По умолчанию — 30/25/20/25 (приложение A §21.4), это только предложение.
- **RID-M-18** MUST: строки `legacy` (старые поездки) в пуловый рейтинг не идут, неизмеренные поля — `null`.
- **RID-M-19** MUST: публичные результаты пула (`GET /api/pools/:id/results`) — только после `payout_at`. `featureScores` и `humannessScore` видны только админке.
- **RID-M-20** MUST: донаты и действия зрителей не меняют ни одно поле `RideResult` (решение 33).
- **RID-M-21** MUST: побитовая идентичность генерации дороги между клиентом (`@freightchain/shared`: `prng.js`, `road.js`, `road-network.js`, `road-geometry.js`, `route-curvature.js`) и сервером (`server/src/domain/road/{road-rules.ts,road-layout.ts,road-plan.ts}`) — сегменты, полосы, перекрёстки, фазы светофоров, развилки, кривизна `(RX, RZ, RT)`, ролл ям `rollChunkHole` и расчёт урона `holeDamage` обязаны совпадать при любом `(seed, trip)`. Любое изменение генератора обновляет обе стороны в одном коммите.

## Часть 2. План тестирования
Существующие id из приложений: **AC-R1…R8** (статистика), **AC-F1…F11** (финиш). Новые:
| id | Правило | Сценарий | Ожидание |
|---|---|---|---|
| RID-T-01 | M-01 | `POST /api/rides {tier:'4h'}` и `'8h'`; `GET /api/tiers` | отказ; в тирах нет 4h/8h |
| RID-T-02 | M-02 | тренировочная поездка: `free-1c`, `free-2c`, `free-3c` (и замороженный `free-3b`), офлайн-гость, часовая с assist/туториалом; контроль: бесплатная попытка devnet и промо-заезд 1 ч | у тренировочных нет строки в рейтинге пула, нет TEN4, `mgIssued = 0`, нет в реплеях; у контрольных — есть реплей; видимость → RPL-T-04 |
| RID-T-03 | M-03 | создание 1h | `Ride.completeDist = finishFor(seed, '1h')`, `expectedSeconds ∈ [3600; 3600 + ds/v]` (= AC-F1) |
| RID-T-04 | M-17 | формула по умолчанию: 10 golden-поездок | `score` совпадает (= AC-R6); пример владельца = 100 %, пример 70 мин = 73,7 % |
| RID-T-05 | M-17 | равные `score` | порядок по `driveToFinishSeconds + mgPenaltySeconds`, затем урон, `endedAt`, `seq` |
| RID-T-06 | M-17 | смена весов после открытия пула | отказ (`409 score_formula_locked`) |
| RID-T-07 | M-19 | `GET /api/pools/:id/results` до `payout_at` | `404` для чужих; админ видит |
| RID-T-08 | M-20 | донат + чат на реплей | `RideResult` не изменился (= RPL-T-84) |
| RID-T-09 | M-12 | клиент не прислал `reds` | поле S заполнено пересчётом |
| RID-T-10 | M-11 | 1h-поездка в клиенте (E1, `trips.js` / HUD) | линия финиша на `finishS`, оставшиеся км; ожидаемого времени нет |
| RID-T-11 | M-15 | новая строка `RideResult` | `stopLineViolations` и `speedingSeconds` = `null` |
| RID-T-12 | M-21 | паритет генератора дороги клиент ⇄ сервер (`road-drift.spec.ts`, `road-plan.spec.ts`, `replay-engine.spec.ts`) на всех `trip` и десятках `seed` | `segs`, `juncs`, `forks`, `lanesAt(s)`, `roadHalfWidth(s)`, `signal(j)`, `holesNear(s)`, `holeDamage` и 2D-интеграция `(RX, RZ, RT)` совпадают точь-в-точь |

### Трассируемость
| Правило | Тесты |
|---|---|
| M-01 | RID-T-01 |
| M-02 | RID-T-02, RPL-T-04/16 |
| M-03 | RID-T-03, AC-F1, AC-F2 |
| M-04 | AC-F7 |
| M-05 | AC-F11 |
| M-06 | AC-F8 |
| M-07 | AC-F1 (граница) |
| M-08 | AC-F5, AC-F6 |
| M-09 | AC-F9, AC-F10 |
| M-10 | AC-F3, AC-F4 |
| M-11 | RID-T-10 (закрыл пробел) |
| M-12 | AC-R2, AC-R7, RID-T-09 |
| M-13 | AC-R3 |
| M-14 | AC-R1, AC-R4 |
| M-15 | AC-R8, RID-T-11 (закрыл пробел) |
| M-16 | AC-R5 |
| M-17 | AC-R6, RID-T-04/05/06 |
| M-18 | AC-R8 |
| M-19 | RID-T-07 |
| M-20 | RID-T-08 |
| M-21 | RID-T-12 (`road-drift.spec.ts`) |

Итого: 21 MUST, запланированные id RID-T-01…12 и id из приложений (AC-R1…R8, AC-F1…F11). Id — не написанный тест. Исполняемая планка — [`../testing/COVERAGE_CONTRACT.md`](../testing/COVERAGE_CONTRACT.md).

---

## Приложение A. Статистика и рейтинг (бывший §21)
> Перенесено без изменений из `anticheat_test_plan.md §21` (superseded, merged into docs/spec) (17.10.2026); уровни заголовков сдвинуты на один. Нормативна Часть 1 этого файла; при расхождении прав манифест.

### 21. Результат 1h-поездки и рейтинг: статистика по каждой поездке (решение владельца 17.10.2026)

**Принцип (владелец):** главный критерий — **доехал до финиша**. Дальше идут общее время, урон, светофоры (соблюдение правил, проезды на красный) и мини-игры. Пример: доехал, без урона, по правилам, все мини-игры пройдены = 100 %. **Формулу рейтинга строит владелец**, поэтому каждая составляющая хранится **отдельным полем** у каждой поездки. Формула ниже (§21.4) — только предложение.

#### 21.1 Что есть в схеме сейчас (`origin/main`, `server/prisma/*/*.prisma`)
- **Таблицы статистики на поездку нет.** В схеме `stats` только агрегаты: `PlayerStats` / `GlobalStats` / `DailyStats` (`rides`, `ridesCompleted`, `seconds`, `metres`, `crashesVehicle`, `crashesBuilding`, `donations`, `donationLamports`).
- `ride.Ride`:
  - `status` (`completed | abandoned | failed | expired | …`), `reason` (текст; `fail-code.ts` раскладывает его на `heartbeat_lost / implausible_progress / brakes / engine_blown / cold_engine / hull / off_road / crash / other`);
  - `lastS`, `driveSeconds`, `startedAt` / `endedAt`, `hull` (конечный, **со слов клиента**), `crashesVehicle` / `crashesBuilding` (комментарий в схеме: «statistics, not security», счётчик клиента), `nightSeconds`, `paused`;
  - `minSeconds`, `completeDist`, `trip`, `seed`, `challenges` (Json, дорожные challenges, заменяются мини-играми по решению 14).
- `verdict.RideVerdict`: `status` (`pending | verified | flagged | rejected`), `reasons` Json `[{code, detail}]`, `scores` Json, `rulesVersion` (сейчас `RULES_VERSION = 7`), ручное переопределение (`overriddenBy/At`, `note`).
- `verdict.RideReplay`:
  - `simulated*` / `recorded*`: Seconds, Distance, Hull, CrashesVehicle/Building;
  - `eventsExpected/Correlated`, `redFlags`, `scores`, `simHz` (по умолчанию 10).
- `verdict.RideReplayFlag` — коды с `atSecond`/`atMetre`/`evidence`.
- **Финиш сейчас:** `ride.entity.ts:337` — `completed`, если `lastS ≥ completeDist`. `lastS` присылает клиент в heartbeat. Для 1h `completeDist = 0,5 × 28 × 3600 = 50 400 м` (`ride-rules.ts:5,52`). Времени на финиш как поля нет.
- **Урон по источникам не разделён.** На клиенте урон приходит из нескольких мест (`client/js/sim/damage.js`):
  - `hit()` — объекты у дороги (ограждения, камни, деревья);
  - `hurt()` — машины (метка), здание → `hull = 0`;
  - ямы (`holeDamage`, `road-rules.ts`);
  - холод (`sim/climate.js:51`, `COLD_WEAR`).
  
  Сервер v1 (`replay-engine.ts`) сверяет попадания в ямы по плану дороги (`holesNear`) и **сэмплы hull клиента** (10 Гц). Разложения урона по источникам нет.
- **Красный свет:**
  - клиент считает `st.reds` (`client/js/net/orchestrator.js:49–53`: пересечение стоп-линии `j.s − (j.mouth + 1,2)`, пока `net.signal(j,'main') === 'R'`), показывает тост и строку «Red lights run» в итоге (`ui/game.js:194`);
  - **на сервер это не отправляется и правилами не проверяется** (каталог #32, решение 7);
  - фаза светофора детерминирована: `road-network.js:162` `signal(j, app)` от `net.clock + j.off` и цикла `j.cyc` из сида. Пересчёт v2 (§9.6, §15) может считать красный сам.
  
  ⚠️ Расхождение: в клиенте стоп-линия `mouth + 1,2`, а в общем `stopLine()` (`road-network.js:172`) — `mouth + 2`. Для сервера взять одно определение (`stopLine`) и прогнать тест AC-R4.
- **Стоп-линия на перекрёстке без светофора / превышение скорости — понятий нет:**
  - главная дорога без светофора — «give way to nobody» (`ui/map.js:313`), знак `S` только у боковой дороги;
  - ограничений скорости нет, есть только регулятор `MAX_SPEED = 28 м/с`.
  
  Поля оставить в схеме как `null` / «не измеряется», пока правила нет (решение 41).

#### 21.2 Новая таблица `stats.RideResult` (по одной строке на поездку)
Источник: **S** — серверный пересчёт v2 (авторитетно, 30 Гц, решение 12); **D** — выводится сервером из S; **C** — со слов клиента, только для сверки и отладки, в рейтинг не идёт; **Srv** — серверные часы и события сервера.

| Поле | Тип | Источник | Смысл / откуда сейчас |
|---|---|---|---|
| `rideId` (PK, FK `Ride`) | uuid | — | |
| `wallet`, `poolId`, `tier`, `trip`, `roadSeed`, `attemptNo` | — | Srv | копия из `Ride`, для запросов рейтинга без join |
| `rulesVersion`, `finishRulesVersion`, `scoreInputsVersion`, `simHz` | Int | Srv | правила, которыми посчитана строка (`RULES_VERSION`, §22) |
| `finished` | Bool | **S** | пересчитанная `s` пересекла `finishS` до лимита (§22.5), без провала |
| `finishReason` | enum | **S**/D | `finished`, `timeout`, `crash_vehicle`, `crash_building`, `hull`, `off_road`, `engine`, `brakes`, `cold_engine`, `abandoned`, `heartbeat_lost`, `rejected` (из `failCode`, но причину даёт пересчёт) |
| `finishS` | Float | Srv | точка финиша, выданная при создании (`Ride.completeDist`, §22) |
| `distanceM` | Float | **S** | пройдено (сейчас `RideReplay.simulatedDistance`; `Ride.lastS` — C) |
| `driveSeconds` | Float | **S** | шаги пересчёта / 30 (игровое время без пауз) |
| `driveToFinishSeconds` | Float? | **S** | время от старта до пересечения `finishS` (`null`, если не доехал) |
| `wallSeconds` | Float | Srv | `endedAt − startedAt` по часам сервера |
| `pausedSeconds`, `pauseCount` | Float/Int | **S** | по потоку `clk` (решение 6) |
| `avgSpeedKmh`, `maxSpeedKmh` | Float | D/**S** | |
| `hullAtFinish` | Float | **S** | hull пересчёта (сейчас `RideReplay.simulatedHull`; `Ride.hull` — C) |
| `damageTotal` | Float | **S** | `100 − hullAtFinish` (hull в начале 100) |
| `damageHoles`, `damageVehicles`, `damageProps`, `damageCold`, `damageOther` | Float | **S** | урон по источникам: ямы / машины / объекты у дороги / холод / прочее (сумма = `damageTotal`) |
| `holesHit`, `holesHitByType` | Int / Json | **S** | `{pothole, cluster, trench, sinkhole…}` |
| `crashesVehicle`, `crashesBuilding`, `crashesProp` | Int | **S** | контакты в пересчёте (сейчас C в `Ride`, S в `RideReplay` без props) |
| `offroadSeconds`, `offroadEpisodes` | Float/Int | **S** | съезды (`OFFROAD_FAIL_SECONDS = 20`, решение 7) |
| `signalsPassed` | Int | **S** | светофоров на главной, пересечённых по стоп-линии (знаменатель) |
| `redLightViolations` | Int | **S** | пересечение `stopLine(j, +1)`, пока `signal(j,'main') === 'R'` |
| `amberPasses` | Int | **S** | на жёлтый (информативно, не нарушение) |
| `redLightDetail` | Json | **S** | `[{junctionId, s, atSecond, speedKmh}]` |
| `stopLineViolations` | Int? | — | `null`: понятия нет (решение 41) |
| `speedingSeconds` | Float? | — | `null`: ограничений скорости нет (решение 41) |
| `mgIssued`, `mgPassed`, `mgWrong`, `mgMissed` | Int | **S** | из потока `mg` и серверного расписания (`mgSalt`) |
| `mgPenaltySeconds` | Float | D | `20·mgWrong + 45·mgMissed` (решение 23); **отдельно**, к времени не прибавляется |
| `mgMode` | enum | Srv | обычный / «больше времени» (решение 28) |
| `mgDetail` | Json | **S** | `[{id, variant, issuedAtS, issuedAtSec, answeredAtSec, outcome, reactionMs, penaltyS}]` |
| `verdictTier` | enum | **S** | `verified / review / rejected` (§16; в схеме сейчас `verified / flagged / rejected`) |
| `verdictReasons` | Json | **S** | коды (`RideVerdict.reasons`) |
| `humannessScore` | Float 0–1 | **S** | §16, признаки F1–F10 |
| `featureScores` | Json | **S** | значения F1–F10 (только админка) |
| `clientReported` | Json | C | `{lastS, hull, reds, crashesVehicle, crashesBuilding}` — для кода расхождения `client-stats-mismatch` (flag) |
| `score`, `scoreFormulaVersion` | Float? / Int? | D | по формуле владельца (§21.4), можно не хранить и считать запросом |
| `replayId`, `computedAt` | — | Srv | какой пересчёт дал строку |

**Правило:** в рейтинг идут только поля **S/D/Srv**. Поля C только сверяются: расхождение больше допуска → `client-stats-mismatch` (flag).

#### 21.3 Где считается и миграция
- **Считает только воркер вердикта** после пересчёта (инкрементально по батчам, §9.7). Строку пишет **upsert по `rideId`** при каждом вердикте, в том числе при `verdict:rejudge`. История пересчётов остаётся в `RideReplay`.
- **Шаги ядра пересчёта для новых полей (входят в Ф1/Ф3):**
  - урон с меткой источника: у `hurt()` / `hit()` / `holeDamage` / `COLD_WEAR` появляется аргумент `source`;
  - красный свет: перенести `redLight()` из `orchestrator.js` в общее ядро, часы светофоров `net.clock` — от счётчика шагов;
  - событие пересечения `finishS`;
  - `crashesProp`.
- **Миграция** (SQL вручную, как принято в `server/prisma/migrations/`; например `2026xxxx_ride_result`):
  - новая модель `RideResult` в `stats` (`@@schema("stats")`), индексы `(poolId, finished, verdictTier)`, `(poolId, driveToFinishSeconds)`, `(wallet, computedAt)`;
  - `Ride` не меняется; `Ride.completeDist` остаётся точкой финиша (§22);
  - **заполнение для старых поездок:** `finished` из `status = completed`, `distanceM = lastS`, `driveSeconds`, `hull`, crashes из `Ride`, `source = legacy`. Красный, урон по источникам и мини-игры — `null` («не измерялось»). Такие строки в пуловый рейтинг не идут;
  - `PlayerStats` можно позже дополнить суммами `redLights`, `mgPassed`. Не обязательно.
- **API:** `GET /api/pools/:id/results`. Публично — только после `payout_at` (решение 34); `featureScores` и `humannessScore` — только админке. Выгрузка CSV для владельца в админке (вкладка пула).

#### 21.4 Формула рейтинга по умолчанию — **предложение, параметры настраивает владелец**
1. **Ворота:** `finished = true` и `verdictTier = verified`. Поездки в `review` ждут ручной проверки. Не доехавшие ранжируются **ниже всех доехавших**: по `distanceM` (больше — выше), при равенстве — по `damageTotal`.
2. **Для доехавших:** `score = 100 × (w_t·S_time + w_d·S_dmg + w_r·S_rules + w_m·S_mg)`, где Σw = 1. По умолчанию:

| Компонент | Вес | Формула (параметры — настраиваемые) |
|---|---|---|
| `S_time` время | 0,30 | 1, если `driveToFinishSeconds ≤ T_ref` (3600 с); линейно до 0 к `T_cap` (5400 с) |
| `S_dmg` урон | 0,25 | `1 − damageTotal / 100` |
| `S_rules` правила | 0,20 | `max(0, 1 − 0,25 · redLightViolations − 0,05 · offroadEpisodes)` |
| `S_mg` мини-игры | 0,25 | `mgPassed / mgIssued` (если `mgIssued = 0` → 1) |

3. **Равенство score (например, несколько по 100 %):**
   1. меньше `driveToFinishSeconds + mgPenaltySeconds` — быстрый водитель выше;
   2. затем меньше `damageTotal`;
   3. затем раньше `endedAt`, затем `seq`.
4. **Пример владельца:** доехал за ≤ 60 мин, урон 0, красных 0, мини-игры 3/3 → 100 %. Доехал за 70 мин, урон 12, 1 красный, 2/3 → 100·(0,30·0,667 + 0,25·0,88 + 0,20·0,75 + 0,25·0,667) ≈ **73,7 %**.
5. Штрафы мини-игр (+20 / +45 с) по умолчанию учитываются **только в разбиении равенства**: в `S_mg` ошибка уже учтена, второй раз в `S_time` не считается. Вариант владельца: прибавлять штраф к времени и убрать `S_mg`. Поля для обоих вариантов есть.
6. Формула и веса — конфиг с версией (`scoreFormulaVersion`). Публикуется в правилах пула **до открытия** пула и не меняется до его закрытия (решение 42).

#### 21.5 Тесты (блок ботов, дополнение к §17)
| id | Сценарий | Ожидание |
|---|---|---|
| AC-R1 | Бот едет на красный на каждом светофоре без контакта | `redLightViolations = signalsPassed_red`, совпадает с клиентским `st.reds` (C) |
| AC-R2 | Клиент присылает `reds = 0`, `hull = 100`, а в пересчёте 3 красных и урон | в рейтинг идут S; `client-stats-mismatch` flag |
| AC-R3 | Урон по источникам: сценарий яма + машина + ограждение + холод | сумма источников = `damageTotal` ± 0,01 |
| AC-R4 | Пересечение стоп-линии на границе фазы R/G (±1 шаг) | одно определение `stopLine`; одинаково в 3 прогонах (детерминизм) |
| AC-R5 | Пропуск 2 мини-игр, 1 ошибка | `mgMissed = 2`, `mgWrong = 1`, `mgPenaltySeconds = 110`, `finished` не меняется; ≥ 2 пропуска → flag (решение 23) |
| AC-R6 | Golden: 20 поездок с известными компонентами | `score` по формуле v1 совпадает с ожидаемым; смена весов меняет только `score` |
| AC-R7 | Rejudge после смены `RULES_VERSION` | строка `RideResult` перезаписана, `computedAt` и `rulesVersion` новые |
| AC-R8 | Старая поездка (`source = legacy`) | не попадает в пуловый рейтинг, поля `null`, а не 0 |

---


---

## Приложение B. Динамический финиш (бывший §22)
> Перенесено без изменений из `anticheat_test_plan.md §22` (superseded, merged into docs/spec) (17.10.2026); уровни заголовков сдвинуты на один. Нормативна Часть 1 этого файла; при расхождении прав манифест.

### 22. Динамическая точка финиша: маршрут ≈ 1 час при 65 км/ч (решение владельца 17.10.2026)

#### 22.1 Как сейчас (`origin/main`)
- **Дорога не кончается и строится из шаблонов** (`config.js:37`: «the road itself never ends»). Это не граф с выбором поворотов, а «хребет» (`spine`):
  - сегменты шаблонов `country` / `arterial` / `town` / `xroad` (`client/shared/road.js:34–42`) с полосами, изгибами и перекрёстками (`junction.gap`, доля светофоров `signal`: country 0,35, arterial 0,9, town 0,75);
  - развилки (`forkCommit`).
  
  В боковые дороги свернуть нельзя (`road-network.js:14–15`). «Маршрут по графу» здесь = проход по хребту, сгенерированному из `seed`.
- **Финиш — фиксированная дистанция, не время:** `completeDist = K × MAX_SPEED × minSeconds`, для 1h `0,5 × 28 × 3600 = 50 400 м` (`ride-rules.ts:5,52`). Значение хранится в `Ride.completeDist` при создании, у старой поездки не меняется (`ride-rules.ts:46`). Free-уровни: `FREE_RIDE_SECONDS` (env, по умолчанию 180) × `multiple`, `k` 0,25–0,4 (`ride-trip.ts:17–30`, `trips.js`).
- У трипа `'1h'` `finish: false` (`trips.js:58`): **линия финиша не рисуется**. Завершение — `lastS ≥ completeDist` **со слов клиента** (`ride.entity.ts:337`).
- План дороги ограничен `ROAD_PLAN_MAX_S = 1 000 000 м` и окном `ROAD_PLAN_MAX_SPAN = 10 000 м` (`client/shared/road.js:118–120`).
- Комментарий в `road-network.js:119`: «the server's port has no curvature» — **у сервера сейчас нет кривизны**. Для ожидаемой скорости в поворотах она нужна; кривизна входит в общее ядро v2 (Ф1).

#### 22.2 Алгоритм `finishFor(roadSeed, trip, cfg)` (сервер, при создании поездки)
1. Построить сеть `createRoadNetwork({seed: roadSeed, trip})` из общего детерминированного кода (`client/shared/road-network.js`) — тот же, что у клиента и пересчёта.
2. `T = T_start` (разгон с места и выезд из депо, по умолчанию 25 с) `+ T_mg` (фиксированный запас на мини-игры, п. 4).
3. Идти по хребту шагом `ds = 5 м` от старта `Sm`. На каждом шаге:
   - `v_free = V_BASE × f_pattern(seg) × f_lanes(seg) × f_traffic(trip)`, где `V_BASE = 65 км/ч = 18,06 м/с` (решение 38);
   - `v_curve = sqrt(A_LAT / |κ(s)|)`, `A_LAT = 2,0 м/с²`;
   - `v = min(v_free, v_curve, MAX_SPEED)`;
   - `T += ds / v`. Переход скорости между шагами — по разгону `a_acc = 1,0` и торможению `a_dec = 2,5 м/с²` (кинематический профиль: при входе в поворот скорость падает заранее).
4. **Перекрёсток на шаге** (из `net.near`):
   - **со светофором:** `T += p_ng × (W + L_ss)`:
     - `p_ng = (T_cyc − g) / T_cyc` — доля «не зелёного» для главной, из `j.cyc` этого перекрёстка (цикл из сида: `SIGNAL_GREEN 16–26`, `AMBER 3`, `CLEAR 2`, `CROSS 9–14` → `T_cyc ≈ 42,5 с`, `p_ng ≈ 0,5`);
     - `W = (T_cyc − g) / 2` — средний остаток красного;
     - `L_ss = v/2 · (1/a_dec + 1/a_acc)` — потеря на остановку и разгон (≈ 12,6 с при 65 км/ч);
     - итого ≈ 11–12 с на светофор, **математическое ожидание**, а не фаза при ожидаемом приезде: реальный водитель приезжает в другое время;
   - **без светофора:** `T += L_j` (по умолчанию 2 с, главная дорога без уступания);
   - **развилка:** `T += L_fork` (по умолчанию 3 с).
5. **Мини-игры:** `T_mg` — **фиксированный запас, одинаковый для всех** (по умолчанию `3 × (30 с + L_ss) ≈ 130 с`), а не реальные позиции. Расписание мини-игр личное (`mgSalt`) и тайное до reveal (решение 29). Если финиш зависел бы от него, он выдал бы расписание и сделал бы дистанцию разной у игроков (решение 39).
6. Остановиться, когда `T ≥ T_target = 3600 с`, и получить `s*`.
7. **Перенос в безопасное место:** `finishS = snapSafe(s*)` — первая точка `≥ s*`, которая:
   - не ближе 60 м к перекрёстку, стоп-линии или развилке;
   - не внутри зоны станции или шлагбаума;
   - не внутри ямы ±30 м.
8. Проверка: `finishS ≤ ROAD_PLAN_MAX_S − 5 000`, иначе ошибка конфигурации (решение 40).
9. Вернуть `{finishS, expectedSeconds: T, finishRulesVersion}`. `finishS` записывается в `Ride.completeDist` (поле уже есть, миграция не нужна); `expectedSeconds` — в `RideResult` / журнал. Константы `V_BASE`, `A_LAT`, `f_*`, `L_*`, `T_*` — конфиг с версией `FINISH_RULES_VERSION` (входит в `RULES_VERSION`).

**Детерминизм:**
- Входы: только `roadSeed`, `trip` и версия правил. `trafficSalt` и `mgSalt` — **нет**. `holeSalt` (решение 35, если попыток больше одной) — **нет**: ямы учитываются ожиданием на км (`f_traffic` / `L_hole × плотность`), а не своими позициями. Тогда у всех на общем `roadSeed` **одна и та же точка финиша**, и время сравнимо (решение 39).
- Счёт идёт фиксированным шагом. Порядок операций фиксирован. Считается один раз на сервере, и результат хранится, поэтому клиенту повторять его не нужно.
- **Для пула** `finishS` один на пул: считается при `create_pool` / открытии и **кэшируется** в конфиге пула (`roadSeed` у пула общий).

**Оценка до калибровки** (только порядок, проверить тестами AC-F1–F2):
- при чистых 65 км/ч — 65 км;
- светофоров на км: country ≈ 0,5, town ≈ 3;
- изгибы и поворот к депо;
- итого **≈ 50–58 км** (сейчас 50,4 км фиксировано).

#### 22.3 Сервер — источник правды
- Клиент получает `finishS` в ответе на старт (как сейчас `completeDist`) и рисует линию финиша и оставшиеся км. У `'1h'` `finish: true` (решение 44). **Сдвинуть финиш клиент не может:** сервер сравнивает пересчитанную `s`, а не `lastS`.
- `finished = true` ⇔ в пересчёте v2 есть шаг, на котором `s` пересекает `finishS` раньше лимита (§22.5), до провала и без reject-кода. `driveToFinishSeconds` = номер этого шага / 30.
- `ride.entity.ts:337` (`lastS ≥ completeDist`) остаётся предварительным статусом для UI. **Итог и рейтинг — только по пересчёту.** Расхождение (клиент «доехал», пересчёт — нет) → `finish-not-reached` (reject для пула, если пересчёт уверен, иначе review).
- После пересечения финиша поездка завершается сервером (`finish` с причиной `shift complete`). Езда за финишем в результат не идёт.

#### 22.4 Быстрые водители
- Регулятор `MAX_SPEED = 28 м/с` (≈ 100 км/ч) не меняется. Финиш рассчитан на 65 км/ч, поэтому быстрый водитель доедет за ≈ 40–50 мин. **Это хорошее время, а не нарушение** (решение 41): оно выигрывает в `S_time` (до потолка) и в разбиении равенства.
- Минимального времени нет (как сейчас: «no minimum time any more»). Защита от невозможной скорости уже есть: регулятор и `implausible-progress`. В v2 она — в пересчёте.
- Время меньше 1-го перцентиля людей (AC-F3) → review, не reject.

#### 22.5 Лимит времени поездки
- **Жёсткий лимит `T_cap = 90 мин` игрового времени** (`driveSeconds`; паузы — отдельный лимит решения 6). Не доехал к `T_cap` → поездка закрывается сервером, `finishReason = timeout`, `finished = false`, в рейтинге — среди не доехавших по `distanceM`.
- **С последним стартом (решение 36):** старт не позже закрытия − 1 ч 15 мин. Лимит для такой поездки — `min(T_cap, play_close_at + 60 с − start)`, то есть не меньше 75 мин. Это больше ожидаемых 60 мин. Решение 36 не меняется (решение 43).

#### 22.6 Тесты (блок ботов и калибровка)
| id | Сценарий | Ожидание |
|---|---|---|
| AC-F1 | Калибровка: 10 000 `roadSeed`, `finishFor` | `expectedSeconds ∈ [3600; 3600 + ds/v]`; распределение `finishS` (p1/p50/p99) в отчёте; ни одного падения или выхода за `ROAD_PLAN_MAX_S` |
| AC-F2 | Бот «эталонный водитель» (едет как в модели: 65 км/ч, `A_LAT`, стоит на красный, мини-игры по 30 с) на 200 сидах, ускорение времени (§11) | фактическое время 60 ± 3 мин в p10–p90; иначе перекалибровать `f_*` / `L_*` |
| AC-F3 | Распределение человеческого времени: поездки тестеров (≥ 30 человек × 2 сида) | p1, p50, p99 → порог review «слишком быстро» и проверка, что p50 ≈ 55–65 мин. Отчёт по паттернам (town против country) |
| AC-F4 | Бот на регуляторе 28 м/с, игнорирует красный | время ≈ 40–45 мин, `finished = true`, `redLightViolations > 0`; не reject |
| AC-F5 | Модифицированный клиент шлёт `lastS ≥ completeDist` раньше | пересчёт: `finished = false`, `finish-not-reached` |
| AC-F6 | Клиент рисует финиш ближе (подмена `finishS`) | на сервер не влияет; `finished` только по серверному `finishS` |
| AC-F7 | Один `roadSeed`, разные `trafficSalt` / `mgSalt` / `holeSalt` | `finishS` одинаковый |
| AC-F8 | Снап: `s*` внутри перекрёстка, ямы, станции | `finishS` за зоной, сдвиг ≤ 300 м |
| AC-F9 | Медленный бот 40 км/ч | `timeout` на 90 мин, `finished = false`, ранжирование по `distanceM` |
| AC-F10 | Поздний старт ровно в `last_start_at` | лимит = 75 мин + 60 с, закрытие по `play_close_at` |
| AC-F11 | Смена `FINISH_RULES_VERSION` | у уже созданных поездок `completeDist` не меняется (как `ride-rules.ts:46`) |

---

## Приложение C. Детерминированный алгоритм генерации дороги (`@freightchain/shared` ⇄ `server/src/domain/road`)

Это нормативное описание текущей реализации генератора дороги на `main`, общей для клиента (`client/shared/prng.js`, `road.js`, `road-network.js`, `road-geometry.js`, `route-curvature.js`, `client/js/trips.js`) и сервера (`server/src/domain/road/road-rules.ts`, `road-layout.ts`, `road-plan.ts`). Тест паритета — `server/src/domain/road/__tests__/road-drift.spec.ts` (**RID-M-21 / RID-T-12**).

### C.1 ГПСЧ и примитивы (`client/shared/prng.js`, `road.js`)
1. **Позиционный хеш `rnd(n)`** (используется для ролла ям в чанках и выбора стороны развилки, не зависит от порядка обхода):
   - `x = Math.sin(n * 127.1 + 311.7) * 43758.5453`
   - `rnd(n) = x - Math.floor(x)`
2. **Потоковый ГПСЧ `mulberry32(seed)`** (используется для раскладки шаблонов, сегментов, перекрёстков, циклов светофоров и симуляции трафика):
   - Инициализация: `a = seed >>> 0` (при старте поездки `seed = (ride.seed ?? 0xC0FFEE) >>> 0`).
   - На каждый вызов `r()`:
     - `a = (a + 0x6D2B79F5) | 0`
     - `t = Math.imul(a ^ (a >>> 15), 1 | a)`
     - `t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t`
     - возврат `((t ^ (t >>> 14)) >>> 0) / 4294967296`
3. **Математические утилиты (`road.js`)**:
   - `clamp(x, a, b) = Math.max(a, Math.min(b, x))`
   - `smooth(u) = (t = clamp(u, 0, 1), t * t * (3 - 2 * t))`
   - `wPick(r, items)`: взвешенный выбор из массива, где вес элемента — `x[x.length - 1]` (для шаблонов `[patKey, weight]`, для полос `[nR, nL, weight]`).

### C.2 Координатная система хребта, геометрия полос и контроль съезда (`road.js`, `road-layout.ts`, `road-rules.ts`)
- `CHUNK_LEN = 32` м (длина одного чанка дороги).
- `LANE0 = 2.4` м (поперечное смещение центра внутренней полосы `i = 0` от осевой).
- `LW = 4.2` м (ширина полосы). Центр полосы `i` (`0`-индекс от осевой) в направлении `dir ∈ {+1, -1}`:
  - `laneLat(dir, i) = dir * (2.4 + i * 4.2)` (`+2.4, +6.6, +10.8` справа; `-2.4, -6.6, -10.8` слева).
- Полуширина проезжей части для `n` полос в одну сторону:
  - `edgeOf(n) = 4.5 + (n - 1) * 4.2` (`4.5 м` для 1 полосы, `8.7 м` для 2, `12.9 м` для 3).
- `TAPER = 120` м (длина плавного сглаживания `smooth((s - seg.s0) / TAPER)` для `halfWidth(s, dir)` в начале нового сегмента `seg.id > 1`, если в начале сегмента нет развилки).
- `SHOULDER = 1.2` м (ширина обочины за краем асфальта).
- `SIDE_LEN = 450` м (длина боковых рукавов перекрёстков).
- `ROAD_PLAN_MAX_S = 1_000_000` м, `ROAD_PLAN_MAX_SPAN = 10_000` м.
- **Проверка нахождения на асфальте (`RoadLayout.onRoad(s, d)` в `road-layout.ts`)**:
  - При `s > -80 && s < 30 && Math.abs(d) < 34` (территория депо) → `true`.
  - В пределах главной проезжей части `d >= -edgeOf(nL) - 0.5 && d <= edgeOf(nR) + 0.5` → `true`.
  - В зоне развилки `forkApron(s) > 0 && Math.abs(d) <= FORK.corridor + 0.5` (`15.5 м`) → `true`.
  - При `s < knownFrom` (`Sm + 100 = 325 м`, зона манёвра выезда из депо, где `d` образцов в мировых координатах не совпадает с локальной дугой) → `null` (не судится).
  - В пределах `pad` перекрёстка (`da ∈ [pad.a0 - 1, pad.a1 + 1]`, `d ∈ [pad.l0 - 1, pad.l1 + 1]`) или на его боковом рукаве (`|da| < j.sideHalf + 0.5 && j.arms.includes(sign(d)) && |d| < j.len`) → `true`; иначе → `false`.
- **Серверное правило съезда с дороги (`isOffRoad(s, lat, layout)` в `road-rules.ts`)**:
  - Если `layout` передан: съезд засчитывается при `layout.onRoad(s, lat) === false && layout.onRoad(s, lat - Math.sign(lat) * OFFROAD_GRACE) === false` (`OFFROAD_GRACE = 2.5 м`). Непрерывный съезд дольше `OFFROAD_FAIL_SECONDS = 20 с` завершает поездку с причиной `off_road` (в вердикте — `offroad-ignored`, если превышен `OFFROAD_FAIL_SECONDS * 1.25 + 2`).

### C.3 Стартовый выезд (`sA`, `Sm`, `j0`)
- Подъездная дорога депо (`id = 0`, `pat = 'access'`): `s ∈ [0, sA]`, где `sA = 190 м`, полосы `nR = 1, nL = 1`, `bends = 0`, `centre = null`.
- Поворот выезда (`id = 1`, `pat = 'turn'`): радиус `START_TURN_R = 22 м`, длина дуги `L = Math.round((Math.PI / 2) * 22) = 35 м`, конец поворота `Sm = sA + L = 225 м`, полосы `nR = 1, nL = 1`, кривизна `kTurn = 0` при `trip.start === 'straight'`, иначе `(Math.PI / 2) / L`.
- Стартовый узел `j0` (`id = 0`, `s = Sm = 225 м`): `kind = 'start'`, `signal = false`, `arms = []`, `sideLanes = 1`, `sideHalf = edgeOf(1) + 0.3 = 4.8 м`, `mouth = 0`, `len = 0`, `pad = { a0: -(R + 7.5), a1: 4, l0: -(halfL + SHOULDER), l1: R + 2 }` (где `R = 22`, `halfL = 4.5`).
- `genEnd` инициализируется значением `Sm = 225 м`, `nextJ = Infinity`.

### C.4 Шаблоны дороги (`PATTERNS`) и раскладка по `trip`
Девять шаблонов (`client/shared/road.js`, где `lanes` — массив кортежей `[nR, nL, weight]`):
| Шаблон | `len` (м) | `seg` (м) | `lanes` (`[nR, nL, w]`) | `bends` | `centre` | `junction.gap` (м) | `cross` | `signal` | `side` | Особенности |
|---|---|---|---|---|---|---|---|---|---|---|
| `country` | `[900, 2400]` | `[700, 1600]` | `[[1, 1, 1]]` | `1` | `null` | `[420, 950]` | `0.5` | `0.35` | `[1, 1, 2]` | |
| `highway` | `[1600, 3600]` | `[500, 1100]` | `[[2, 2, 3], [3, 3, 1], [3, 2, 1], [2, 3, 1]]` | `0.55` | `'double'` | `null` | — | — | — | без перекрёстков |
| `arterial` | `[800, 1700]` | `[400, 900]` | `[[2, 2, 3], [2, 1, 1], [1, 2, 1], [3, 3, 1]]` | `0.35` | `'double'` | `[260, 520]` | `0.85` | `0.9` | `[1, 2]` | |
| `town` | `[500, 1100]` | `[300, 700]` | `[[1, 1, 2], [2, 2, 1]]` | `0.15` | `null` | `[170, 320]` | `0.7` | `0.75` | `[1]` | |
| `dual` | `[1500, 3200]` | `[700, 1500]` | `[[2, 2, 1]]` | `0.6` | `'double'` | `null` | — | — | — | `2+2` без перекрёстков |
| `fork` | `[1200, 1200]` | `[1200, 1200]` | `[[1, 1, 1]]` | `0` | `null` | `null` | — | — | — | `fork: true` |
| `open` | `[500, 500]` | `[500, 500]` | `[[1, 1, 1]]` | `1` | `null` | `null` | — | — | — | стартовый открытый участок |
| `xroad` | `[500, 500]` | `[500, 500]` | `[[1, 1, 1]]` | `1` | `null` | `[380, 500]` | `1` | `0.5` | `[1, 1, 2]` | стартовый `1+1` с перекрёстком |
| `xroad4` | `[500, 500]` | `[500, 500]` | `[[2, 2, 1]]` | `0.6` | `'double'` | `[380, 500]` | `1` | `0.5` | `[1, 1, 2]` | стартовый `2+2` с перекрёстком |

Раскладка маршрутов по `trip` (`TRIP_ROAD_SPEC` в `road-rules.ts` / `client/js/trips.js`):
| `trip` | `style` | `bends` | `holeChance` | `holeFirst` (м) | `start` | `first` (`firstLen`) | `weights` |
|---|---|---|---|---|---|---|---|
| `'1h'`, `'4h'`, `'8h'`, `'free-3'`, `'free-3b'`, `'free-3c'` (и дефолт) | `'route66'` | `1` | `1` | `Sm + 150 = 375` (`'free-3b'/'3c'`: `320`) | `'depot'` | `['country']` (`[500, 1100]`) | `[['country', 4], ['highway', 3], ['arterial', 3], ['town', 2], ['dual', 2], ['fork', 2]]` |
| `'free-g'` (гостевой EASY) | `'stuart'` | `0.3` | `0.35` | `300` | `'straight'` | `['open', 'xroad', 'country', 'arterial']` (`[420, 550]`) | `[['country', 4], ['arterial', 3], ['dual', 2], ['town', 1]]` |
| `'free-1'` | `'stuart'` | `0.35` | `0` | `Infinity` | `'depot'` | `['country', 'dual', 'highway']` (`[500, 1100]`) | `[['country', 4], ['dual', 4], ['highway', 3]]` |
| `'free-1b'`, `'free-1c'` | `'stuart'` | `0.35` | `0.45` | `380` | `'straight'` (`1c`) / `'depot'` (`1b`) | `['open', 'xroad', 'country', 'arterial']` (`[420, 550]`) | `[['country', 4], ['arterial', 3], ['dual', 2], ['town', 1]]` |
| `'free-2'` | `'route66'` | `0.85` | `0.6` | `Sm + 150 = 375` | `'depot'` | `['country', 'arterial', 'town']` (`[500, 1100]`) | `[['country', 3], ['arterial', 4], ['town', 3], ['dual', 2], ['fork', 1]]` |
| `'free-2b'`, `'free-2c'` | `'route66'` | `0.85` | `0.75` | `320` | `'straight'` (`2c`) / `'depot'` (`2b`) | `['xroad4', 'arterial', 'fork', 'town']` (`[420, 550]`) | `[['arterial', 4], ['town', 3], ['fork', 3], ['country', 2], ['dual', 2]]` |

Алгоритм `extendTo(targetS)` (`road-network.js` / `road-layout.ts`, где `rr([a, b]) = a + r() * (b - a)`):
1. Пока `genEnd < targetS`:
   - Если `patLeft <= 0`:
     - Если в очереди `firstQueue` (`trip.road.first`) есть элементы, берётся `patKey = firstQueue.shift()`, а `patLeft = rr(firstLen)` (по умолчанию `firstLen = [500, 1100]`).
     - Иначе выбирается случайный шаблон `patKey = wPick(r, pool)` из `weights` (исключая текущий `patKey`, если в `weights` ≥ 2 элементов), и `patLeft = rr(PATTERNS[patKey].len)`.
   - Для `P = PATTERNS[patKey]`: длина очередного сегмента `raw = Math.min(rr(P.seg), patLeft)`; если остаток `patLeft - raw < P.seg[0] * 0.6`, то `len = Math.round(patLeft)`, иначе `len = Math.round(raw)`. `patLeft -= len`.
   - Выбирается кортеж полос `[nR, nL] = wPick(r, P.lanes)` и создаётся сегмент `{ id: segs.length, s0: genEnd, s1: genEnd + len, pat: patKey, nR, nL, bends: P.bends, centre: P.centre, fork: !!P.fork }`, `genEnd = seg.s1`.
   - Если `P.fork === true`: создаётся развилка `forks.push({ f0: s0, f1: seg.s1, side: rnd(seed % 9973 + s0 * 0.37) < 0.5 ? -1 : 1, choice: 0 })` и `nextJ = seg.s1 + 200`.
   - Иначе если `!P.junction`: `nextJ = Infinity`.
   - Иначе (`J = P.junction`):
     - Если `!isFinite(nextJ)`: `nextJ = s0 + r() * J.gap[0]`.
     - Пусть `lo = s0 + TAPER + 100`, `hi = seg.s1 - 120`. Пока `nextJ < hi`:
       - Если `nextJ < lo`: `nextJ = lo; continue`.
       - Вызывается `addJunction(Math.round(nextJ), J, seg)` со **строгим порядком вызовов `r()`**:
         1. `kind = r() < J.cross ? 'cross' : 'tee'`
         2. `side = r() < 0.5 ? -1 : 1` (вызывается всегда, даже для `'cross'`, чтобы поток ГПСЧ не сдвигался!)
         3. `signal = r() < J.signal`
         4. `sl = J.side[Math.floor(r() * J.side.length)]`
         5. `g = rr(SIGNAL_GREEN)` (`[16, 26]`), `c = rr(SIGNAL_CROSS)` (`[9, 14]`), `T = g + SIGNAL_AMBER + SIGNAL_ALL_RED + c + SIGNAL_AMBER + SIGNAL_ALL_RED` (`SIGNAL_AMBER = 3`, `SIGNAL_ALL_RED = 2`)
         6. `off = r() * T`
       - Геометрия перекрёстка: `arms = kind === 'cross' ? [-1, 1] : [side]`, `sideHalf = edgeOf(sl) + 0.3`, `mouth = sideHalf + 1.5`, `mainR = edgeOf(seg.nR) + SHOULDER`, `mainL = edgeOf(seg.nL) + SHOULDER`, `pad = { a0: -mouth, a1: mouth, l0: arms.includes(-1) ? -(mainL + 3) : -mainL, l1: arms.includes(1) ? mainR + 3 : mainR }`, `len = SIDE_LEN`.
       - `nextJ += rr(J.gap)`.

### C.5 Фазы светофора и стоп-линия (`signal`, `stopLine`)
- Для перекрёстка `j` с `j.signal === true` в момент времени `clock`:
  - `t = ((clock + j.off) % T + T) % T`, где `{ g, a, r, c, T } = j.cyc`.
  - Для главной дороги (`approach === 'main'`):
    - `t < g` → `'G'` (зелёный)
    - `t < g + a` → `'A'` (жёлтый)
    - иначе → `'R'` (красный)
  - Для боковой дороги (`approach === 'side'`):
    - `t0 = t - g - a - r`
    - `t0 < 0` → `'R'`
    - `t0 < c` → `'G'`
    - `t0 < c + a` → `'A'`
    - иначе → `'R'`
- Стоп-линия (`stopLine(j, dir = 1)` в `road-network.js`): `j.s - dir * (j.mouth + 2)`.

### C.6 Развилки (`FORK`), кривизна и 2D-интегрирование (`road-network.js`, `road-geometry.js`, `route-curvature.js`)
- Константы развилки (`FORK`): `{ len: 1200, bulge: 0.55, commit: 205, corridor: 15, reach: 1.5 }`, `FORK_SWITCH_JUMP = 4`.
- Профиль отклонения ветви на `u = (s - f.f0) / (f.f1 - f.f0) ∈ (0, 1)`:
  - `forkG(u) = Math.sin(2 * Math.PI * u) * Math.sin(Math.PI * u) ** 2`
  - Знак ветви `bulge(f) = f.choice || f.side`.
  - Конечная разность кривизны развилки (`forkCurv(s)` в `road-network.js:116`):
    - `forkCurv(s) = bulge(f) * FORK.bulge * (forkG((s + 1 - f.f0) / L) - forkG((s - f.f0) / L))` (где `L = f.f1 - f.f0 = 1200`).
- Коэффициент успокоения кривизны `calm(s)` (`road-network.js:108`):
  - Произведение по всем перекрёсткам `j`: `c *= smooth(clamp((Math.abs(s - j.s) - ((j.mouth ?? 110) + 50)) / 110, 0, 1))`.
  - Произведение по всем развилкам `f`: `c *= smooth(clamp(Math.max(f.f0 - s, s - f.f1, 0) / 110, 0, 1))`.
- Профили маршрутов `ROUTE_CURVATURE` (`route-curvature.js`, с плавным входом `ramp(s) = clamp((s - 60) / 120, 0, 1)`):
  - `route66(s) = ramp(s) * (0.0045 * sin(s / 310) + 0.0035 * sin(s / 130 + 1.1) + 0.0016 * sin(s / 47 + 2.0))`
  - `stuart(s) = ramp(s) * (0.0012 * sin(s / 700) + 0.0007 * sin(s / 260 + 1))`
  - `siberia(s) = ramp(s) * (0.0030 * sin(s / 420) + 0.0025 * sin(s / 170 + 2) + 0.0010 * sin(s / 60))`
  - `brenner(s) = ramp(s) * (0.0055 * sin(s / 230) + 0.0035 * sin(s / 95 + 0.6) + 0.0018 * sin(s / 40 + 2))`
  - `panamerican(s) = ramp(s) * (0.0035 * sin(s / 900) + 0.0015 * sin(s / 300 + 1))`
- Полная кривизна `curv(s)` (`road-network.js:220`):
  - На `s < sA` (`190 м`): `0`
  - На `sA <= s < Sm` (`190..225 м`): `kTurn` (`0` при `trip.start === 'straight'`, иначе `(Math.PI / 2) / 35`)
  - На `s >= Sm`: `styleFn(s - Sm) * trip.bends * segAt(s).bends * calm(s) + forkCurv(s)`
- Интегрирование мировых координат `(RX[i], RZ[i], RT[i])` с шагом `1 м` (`createSpineGeometry` в `road-geometry.js`, старт `RX[0] = 0, RZ[0] = 0, RT[0] = 0`):
  - Для каждого целого шага `i >= 1`:
    - `t = RT[i - 1]`, `k = profile(i - 1)`, `tm = t + k / 2`
    - `RX[i] = RX[i - 1] + Math.sin(tm)`
    - `RZ[i] = RZ[i - 1] - Math.cos(tm)`
    - `RT[i] = t + k`
  - На интервале `[s0, s0 + 1]` значения `(x, z, t)` интерполируются линейно по дробной части `f = s - s0`, а локальная нормаль вправо равна `(nx, nz) = (Math.cos(t), Math.sin(t))`, так что `worldPos(s, d) = { x: p.x + nx * d, z: p.z + nz * d, t: p.t }`.

### C.7 Типы ям (`HOLES`), ролл ям (`rollChunkHole`) и формула урона (`holeDamage`)
- Пять типов ям в `HOLES` (`client/shared/road.js:81`):
  1. `pothole`: `ells: [[0, 0, 0.55, 0.48, 0.1]]`, `dmg: 4`, `slow: 0.05`, `crawl: 5`
  2. `deep`: `ells: [[0, 0, 0.85, 0.72, -0.15]]`, `dmg: 8`, `slow: 0.12`, `crawl: 4`
  3. `cluster`: `ells: [[-0.55, -0.35, 0.48, 0.4, 0.2], [0.5, 0.25, 0.58, 0.46, -0.3], [0.05, -0.55, 0.4, 0.34, 0.1]]`, `dmg: 7`, `slow: 0.1`, `crawl: 4.5`
  4. `trench`: `ells: [[0, 0, 1.85, 0.48, 0.04]]`, `dmg: 10`, `slow: 0.18`, `crawl: 3.5`, `lane: true`
  5. `sinkhole`: `ells: [[0, 0, 1.35, 1.15, -0.12], [-0.8, 0.4, 0.65, 0.55, 0.25], [0.75, -0.35, 0.6, 0.5, -0.2]]`, `dmg: 14`, `slow: 0.35`, `crawl: 3`, `lane: true`, `cones: true`
  - Натуральные дорожные ямы выбираются из `CONE_HOLE_IDS = Object.keys(HOLES).filter(k => HOLES[k].cones)` (`['sinkhole']`).
- Функция `rollChunkHole(ci, net, holeChance, holeFirst = Sm + 150, maxS = Infinity)` (`road.js:97`):
  - `q(k) = rnd(ci * 97.13 + k * 3.71)`
  - Продольная координата `s = ci * 32 + 4 + q(1) * 24`
  - Если `s < holeFirst || s >= maxS || q(2) >= holeChance || !net.plain(s, 70)` (`plain(s, pad)` проверяет отсутствие перекрёстков ближе `(j.mouth ?? 70) + pad` и развилок ближе `pad`), возвращается `null`.
  - Иначе:
    - `type = CONE_HOLE_IDS[Math.floor(q(3) * CONE_HOLE_IDS.length)]`, `T = HOLES[type]`
    - `r = q(4)`, `j = q(5) - 0.5`
    - `dir = T.lane ? (r < 0.7 ? 1 : -1) : r < 0.6 ? 1 : -1`
    - `lanes = net.lanes(s, dir)`
    - `lane = laneLat(dir, Math.floor(q(6) * lanes))`
    - `lat = T.lane ? lane : r < 0.85 ? lane + j * 1.6 : j * 1.2`
    - возвращается `{ id: 'h' + ci, ci, type, s, lat }`.
- Радиусы ямы и расчёт урона (`holeHalfWidth`, `holeHalfLength`, `holeDamage` в `road.js:92–117`):
  - `holeHalfWidth(T) = max_{e ∈ T.ells}(|e[0]| + max(e[2], e[3]))` (для `sinkhole`: `max(1.35, 0.8 + 0.65, 0.75 + 0.6) = 1.45 м`)
  - `holeHalfLength(T) = max_{e ∈ T.ells}(|e[1]| + max(e[2], e[3]))` (для `sinkhole`: `1.35 м`)
  - Оси грузовика `AXLES = [2.2, -0.4, -11.5]` м (от центра грузовика), полуколия `WHEEL = 1` м (`lat ± 1 м`), `CRAWL_SPEED = 3` м/с, `HOLE_REF_SPEED = 28` м/с, `REAR_AXLE_SHARE = 0.6`, `MIN_HURT = 0.3`.
  - Для каждого колеса, попавшего внутрь эллипсов `T.ells` при проезде оси `axle` (`0` — передняя, `1` или `2` — задние) со скоростью `v`:
    - Если `v < CRAWL_SPEED` (`3 м/с`), урон `0`.
    - `sc = clamp(v / HOLE_REF_SPEED, 0, 1.2) ** 2 * (axle ? REAR_AXLE_SHARE : 1)`
    - `dmg = type.dmg * sc`
    - `holeDamage(type, v, axle) = dmg >= MIN_HURT ? dmg : 0`.

