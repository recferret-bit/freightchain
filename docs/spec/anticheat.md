# Античит — манифест и план тестирования

> Телеметрия v2.1, серверный пересчёт 30 Гц, целостность мира, механический ввод, вердикты. Решения 1–16, 18, 24–27, 31, 33, 35. Полный текст плана (бывшие §1–12, §14–18 `anticheat_test_plan.md` (superseded, merged into docs/spec)) — приложение A, без изменений. Мини-игры — [`minigames.md`](minigames.md), поездки и рейтинг — [`rides.md`](rides.md), пул — [`pool.md`](pool.md).

## Часть 1. Манифест
### 1.1 Сейчас в коде (`origin/main`)
- v1-конвейер (приложение A §1):
  - heartbeat (`applyReport`, `ride.entity.ts`);
  - батчи телеметрии 10 Гц с SHA-256 **без ключа**;
  - `verdict-rules.ts` (`RULES_VERSION = 7`);
  - `world-checks.ts:73` `checkWorld`, `world-facts.ts:67`, `batch-summary.ts:70`;
  - `replay-engine.ts` — сверка сэмплов клиента, не полная физика.
- Уже есть проверка «клиент убрал ямы, на сервере они есть»: `obstacle-ignored` → `REJECTED` (`e2e-road-check.mjs` B, строка 113).
- Красный свет правилами не проверяется (#32). Slow-mo не ограничен для free (#11).

### 1.2 Правила
- **ACH-M-01** MUST: источник правды — сервер. Итог поездки считается **пересчётом из сырого ввода** с фиксированным шагом **30 Гц** (решение 12; запасной вариант 20 Гц). Цель — побитовое совпадение. Допуски остаются только для поз v1 (решение 5).
- **ACH-M-02** MUST: протокол телеметрии v2.1:
  - `sessionKey` на поездку и HMAC каждого батча;
  - потоки `inp` / `clk` / `chk` (с `worldDigest32`) / `mg` / `env`;
  - батч = 60 шагов / 2 с, deflate, ≈ 0,5 МБ/ч.
  
  Батч без верного MAC → `batch-mac-invalid` (reject). Клиент v1 на поездке v2.1 → `409 client_outdated`.
- **ACH-M-03** MUST: целостность мира. Расхождение мира клиента и сервера → `world-digest-mismatch`. Проезд сквозь серверное препятствие без урона → `world-collision-ignored` / `obstacle-ignored` (reject). Также `noclip-path`, `lateral-teleport`, `toll-barrier-breach`.
- **ACH-M-04** MUST: время. Игровое время / wall ≥ 0,9 вне паузы. Пауз ≤ N за поездку и ≤ M секунд суммарно (решение 6). Нарушение → `time-dilation`. Ускорение → отказ бюджета или `speed-hack`.
- **ACH-M-05** MUST: съезд с дороги > `OFFROAD_FAIL_SECONDS` (20 с) — ошибка (решение 7).
- **ACH-M-06** MUST: механический ввод — признаки F1–F10 → `humannessScore`. Reject — только по пяти «физически невозможным» условиям (§16.4 а–д, решение 27). Остальное — review. Человекоподобный бот — чит (решение 3), ловится оценкой человечности, мини-играми и ручной проверкой топ‑20.
- **ACH-M-07** MUST: `isTrusted=false` → flag и ручная проверка, не reject (решение 26).
- **ACH-M-08** MUST: цели ложных срабатываний: ≤ 2 % flag, ≤ 0,1 % reject на честных (решение 15).
- **ACH-M-09** MUST: уровни вердикта — `verified` / `review` / `rejected`. Топ‑20 пула проверяется вручную. Ручное переопределение — с `overriddenBy`, `note`.
- **ACH-M-10** MUST: `RULES_VERSION` у каждой поездки. `verdict:rejudge` судит старую поездку её правилами. Коды подаренных ям (`donated-obstacle-ignored`, `event-unapplied`) живут только для старых поездок (AC-W18, решение 33).
- **ACH-M-11** MUST: трафик в пуле — общий `roadSeed` + личный `trafficSalt` с commit–reveal (решение 13). `holeSalt` на попытку — только если зачётных попыток больше одной (решение 35).
- **ACH-M-12** MUST: бюджет пересчёта — 1h ≈ 2–7 с CPU. Пересчёт инкрементальный по батчам + фоновый финальный вердикт (решение 8). Полная перепроверка пула укладывается в окно проверки ([`pool.md`](pool.md)).
- **ACH-M-13** MUST: приватность: трассы ввода 90 дней, кластеризация между кошельками только для топ‑20 (решения 16, 31).
- **ACH-M-14** MUST NOT: зрители не могут ничего добавить в мир поездки. Эффекты донатов удалены, сервер не принимает `effects/:eventId/applied` (решение 33, AC-W16/17).
- **ACH-M-15** MUST NOT: реплей не раскрывает сырые события ввода и их тайминг (решение 18; [`replays_streams.md`](replays_streams.md) RPL-M-07).
- **ACH-M-16** MUST: CI — тесты in-process с фиктивными часами и golden. Ночью — длинные поездки в реальном темпе и конкурентность (решение 4). В harness по умолчанию `TRAFFIC_PROOF_REQUIRED=true` (решение 9). Golden пересобирается только с бампом `RULES_VERSION` (решение 10).

## Часть 2. План тестирования
Тесты определены в приложении A, их id сохранены:
- **AC-P1…P12** — позитив (§4);
- **AC-T1…T16** — тайминг ботов (§10, §17.4);
- **AC-H1…H3** — базовые люди;
- **AC-W1…W18** — целостность и протокол (§17.2);
- каталог читов **#1…#58** (§5, §9.11, §17.3).

Новые тесты (закрывают пробелы):
| id | Правило | Сценарий | Ожидание |
|---|---|---|---|
| ACH-T-01 | M-05 | съезд 19 с и 21 с | 19 с — нет ошибки, 21 с — ошибка (`OFFROAD_FAIL_SECONDS = 20`) |
| ACH-T-02 | M-09 | ручное `verified` у flagged-поездки, затем `verdict:rejudge` | переопределение сохраняется (`overriddenBy`), топ‑20 попадает в `pool:attention` |
| ACH-T-03 | M-11 | reveal `trafficSalt` после вердикта | совпадает с commit на старте |
| ACH-T-04 | M-13 | трассы старше 90 дней; кластеризация | трассы удалены; кластеризация не запускается для мест > 20 |

### Трассируемость
| Правило | Тесты |
|---|---|
| ACH-M-01 | AC-P6, AC-P7, AC-W5 (`resim-mismatch`) |
| ACH-M-02 | AC-W9, AC-W10, AC-W11, AC-W12, AC-W15 |
| ACH-M-03 | AC-W1, AC-W2, AC-W3, AC-W4 |
| ACH-M-04 | AC-W6, AC-W7, AC-T10, AC-T11 |
| ACH-M-05 | ACH-T-01 |
| ACH-M-06 | AC-T1…T9, AC-T12, AC-H1, AC-H2 |
| ACH-M-07 | каталог #57 (`untrusted-input`) |
| ACH-M-08 | AC-P10, AC-H1 (метрика FP) |
| ACH-M-09 | ACH-T-02 |
| ACH-M-10 | AC-W18 |
| ACH-M-11 | AC-F7, AC-T5, ACH-T-03 |
| ACH-M-12 | AC-P8, AC-P9 |
| ACH-M-13 | ACH-T-04 |
| ACH-M-14 | AC-W16, AC-W17, RPL-T-85 |
| ACH-M-15 | RPL-T-13 |
| ACH-M-16 | AC-P7 (golden), инфраструктура CI (приложение A §7) |

Итого: 16 MUST, 4 новых теста (ACH-T-01…04) + 49 из приложения (AC-P1…P12, AC-T1…T16, AC-H1…H3, AC-W1…W18) и каталог #1…#58. Без теста — 0. До правки 4 правила (M-05, M-09, M-11, M-13) были без теста.

---

## Приложение A. План античита (бывшие шапка, §1–7, §9–11, §14–16, §17 (вводная, 17.2–17.4), §18)
> Перенесено без изменений из `anticheat_test_plan.md` (superseded, merged into docs/spec) (17.10.2026); уровни заголовков сдвинуты на один. Нормативна Часть 1 этого файла; при расхождении прав манифест.

## Блок 3: античит и боты-водители — план тестов

Статус: **план** (решения 1–10 приняты владельцем 17.10.2026 с изменениями, см. §8). Только план: без реализации, без тестов, без git.
**База — только `origin/main` @ `3ab33d8`.** От PR #3 план не зависит. Всё, что относится к PR #3 (HARD 30 мин `free-3c`, ranked, `cleanMetres`, TEN4), помечено «позже (PR #3)» и добавляется отдельным шагом после его мержа.
Справочно: PR #3 `cursor/ten4-tokenomics-6271` @ `794fed8`, PR #5 `cursor/local-e2e-suite-b044` @ `3757ce7`.
**Сверка с кодом (17.10.2026, §13–19):** read-only checkout of this repository, локальный `main` @ `75ed4a06`. Все файлы, на которые ссылаются §13–19, побайтно совпадают с `origin/main` @ `3ab33d8` (diff между ними только в `client/shared/entity/plan.js`). В коде сейчас `RULES_VERSION = 7` (`server/src/domain/verdict/verdict-rules.ts:9`), `trafficVersion` 0/1 (v1 ставит `start-ride`), `CHALLENGE_KINDS = []` (`server/src/domain/rides/ride-challenge.ts:17`), heartbeat раз в 10 с (`client/js/online.js`).

Содержание: §1–7 — текущая система, тесты и блок ботов (v1); §8 — решения 1–10; **§9 — Усиление античита v2**; §10 — тесты ботов на тайминг ввода; §11 — ответ про 8h; §12 — решения 11–18 (**ответы владельца 17.10**: 13, 15, 16 приняты; 11, 12, 14, 17, 18 изменены); **§13 — мини-игры-капчи (только 1h)**; **§14 — протокол телеметрии v2.1**; **§15 — серверная проверка и целостность мира**; **§16 — детекция механического ввода**; **§17 — тесты ботов для мини-игр и целостности**; **§18 — оценка: Pre-season (тень) и Season 1**; **§19 — решения 19–32**.

---

### 1. Как сейчас проверяется поездка (pipeline)

#### 1.1 Путь поездки
1. `POST /api/rides` — сервер создаёт поездку и сам выбирает `seed` и `trip`. Сид бывает трёх видов: у бесплатной поездки свой (`entropy.seed31()`), у билетной поездки сид пула (`Pool.rideSeed`, общий для всех в пуле), у pay‑per‑ride дневной сид тарифа (`DailySeedRepositoryPort`, общий на сутки). В PR #3 у недельного билета и промо-поездки сид свой.
2. `POST /api/rides/:id/start` — сервер ставит `trafficVersion = 1`, если `TRAFFIC_PROOF_REQUIRED=true` (по умолчанию). Клиент не может понизить версию: `{trafficVersion:0}` в теле игнорируется, это проверено в сценарии `downgrade`.
3. Heartbeat (`applyReport`, `ride.entity.ts`): `s`, `t`, `hull`, `crashesVehicle/Building`. Проверки: `|Δs| ≤ MAX_SPEED·dt·slack`, `s ≤ 28 м/с·wall`, игровое время ≤ wall. Тишина дольше `HB_TIMEOUT_MS` (150 с) → `failed: heartbeat lost`. Heartbeat'ы чаще `HB_MIN_INTERVAL_MS` (1 с) игнорируются. В PR #3 у ranked-поездки `cleanMetres` фиксируется в `lastS` на первой ошибке (hull < 100 или вырос счётчик аварий).
4. `POST /api/rides/:id/batches` (`UploadBatchHandler`): батч каждые 2 игровые секунды или 500 кадров, строго по порядку (иначе `429 batch_out_of_order`). Сервер считает свой SHA‑256 от канонического JSON. Бюджеты от wall-времени: game‑t ≤ wall·1,05+30 с, seq ≤ wall/0,2+10, байты ≤ 65 536/с. Батчи принимаются ещё 60 с после `/end`. Сводка батча (`batch-summary.ts`, `world-facts.ts`) считается при приёме по серверной дороге из сида.
5. `POST /api/rides/:id/end` → `completed` при `lastS ≥ completeDist`, иначе `abandoned`. Потом `VerdictService.judge` или очередь `ReplayQueuePort` → `ReplayEngine.verify` + `RideVerdict.judge` → `RideVerdict` и `RideReplay` в БД, начисление HONK/TEN4 только при `verified`.

#### 1.2 Формат телеметрии
- **Sample** (10 Гц игрового времени): `[t, s, d, psi, v, rpm, gear, hull, gas, brake, steer, clutch, clock, flags, inputBits, fork]`. Вердикт читает первые 12 колонок, из остальных только бит газа, флаги и fork.
- **inputs**: `[ms, code, down]`. Сырые события зрителям не отдаются, телефонные (`phone:`) не считаются вводом водителя.
- **trafficProof** (v1, `client/shared/traffic-proof.js`): base64 от Float64 LE, кадр `[dt, clock, s, d, psi, trailerYaw, v, vel, hull, rev, branch, postHull]`, dt ≤ 50 мс. Входит в хешируемый канонический текст.
- **traffic**: дорожка машин только для отображения, не хешируется и не судится.

#### 1.3 Цепочка хешей
`prevHash` батча 0 равен `rideId`, у каждого следующего — хешу предыдущего (или `unhashed-<seq>`). Ошибки: `missing-batches`, `chain-broken`, `hash-mismatch` (reject); `unhashed-batch` (только flag). Важно: SHA‑256 без ключа. Модифицированный клиент пересчитает его сам, цепочка подтверждает целостность и порядок, но не происхождение. Это прямо написано в README. Корень RFC 6962 строится в `telemetry-merkle.ts`.

#### 1.4 Серверная симуляция (`ReplayEngine.verify`, 10 Гц, 2 подшага)
- `unsafeSamples`: границы ресурсов, `bad-sample`.
- `checkChain`, `checkSamples` (`over-governor` > 28·1,05 м/с, `teleport` по `Δs`), `checkAgreement` (`recording-mismatch`, `recording-incomplete` < 50 %, `recording-gaps` < 90 %), `checkMotion` (`sample-gap` > 1 с, `speed-mismatch`: Σ Δs − Σ v·Δt), `checkInputsPresent` (`no-inputs`, `no-throttle-input`), `checkInputsAgree` (`inputs-mismatch`, flag), `checkHumanTiming` (`uniform-holds`, `repeated-timings`, `instant-presses`, все flag), `checkChallenges` (таблица `CHALLENGE_KINDS` пустая, то есть фактически выключено).
- Дорога из сида (`roadPlanFor(seed, trip)`): ямы (`obstacle-ignored` при ≥ 2 → reject, `obstacle-no-impact` при 1 → flag; урон должен быть ≥ 25 % ожидаемого), съезд с дороги (`offroad-ignored`), разгон без газа (`accel-without-gas`), подаренные ямы (`donated-obstacle-ignored`; **удаляются решением 33**), события дня и ночи.
- Продольная физика (`client/shared/physics.js` → `stepTruckPhysics`, `ReplayPhysics`): `physics-speed-mismatch` (reject, если разгон > 1,8× возможного на ≥ 3 шагах), `physics-coasting-mismatch` (flag).
- **Трафик v1** (`traffic-proof.ts` + `TrafficSimulator` = общее ядро `client/shared/traffic-simulation.js`): сервер сам спаунит трафик из `seed ^ TRAFFIC_SEED_XOR`. Каждый кадр подаётся в `stepPose` с **позой от клиента**, сервер шагает свои машины, считает swept‑контакт и урон. Ошибки: `traffic-proof-missing` (нет proof или кадры не покрывают `driveSeconds`), `traffic-proof-invalid` (границы, непрерывность времени, hull растёт, postHull ниже серверного), `traffic-collision-ignored` (фатальный контакт, а поездка «завершена»), `traffic-damage-ignored`, `traffic-proof-mismatch` (sample не совпадает ни с одним post‑кадром).
- **Ограничение:** сервер не прогоняет грузовик заново из сырых нажатий. Позы (s, d, psi, v) берутся у клиента, а сервер проверяет их границы, продольную физику и согласованность с трафиком. Поперечной кинематики (d, psi против руля и сцепления) нет.

#### 1.5 Вердикт и связанное
- Статус: любой reject → `rejected`, иначе любой flag → `flagged`, иначе `verified`. `RULES_VERSION = 7`. К призам допускается только `verified` (`VERDICT_ENFORCE`).
- Отметки по пулу (`pool-attention.ts`, CLI `pool:attention` и перед выплатой): `pool-duplicate-recording` (копия чужой записи на том же сиде, допуск 0,1 м на 90 % из ≥ 40 точек по 25 м), `pool-shared-ip`, `pool-new-wallet-top3`, `pool-distance-outlier`. Все только flag.
- Повторная проверка: `rejudge` (админ, с подписью), `rejudgeQuietly` / CLI `verdict:rejudge` (после смены правил), удалённые чисткой записи → 409 или пропуск.
- **PR #3 (cleanMetres и ranked):** `canJudgeRide` судит и ranked abandoned/failed с дистанцией. `cleanMetres` = min(`firstDamageS` из сводки, первый пробой ямы, `atMetre` первого флага obstacle/traffic из sim), а `clean-mismatch` ловит, если heartbeat заявил больше. Счёт на доске — `cleanBps = cleanMetres·10000/completeMetres`.
- **timeScale:** у демо-кошельков `minSeconds = tier.seconds / DEMO_SCALE` (по умолчанию 60). Так платный 1h можно законно укоротить для тестов. Длина бесплатных уровней = `FREE_RIDE_SECONDS` (180) × multiple.

#### 1.6 Трипы (длины при `FREE_RIDE_SECONDS=180`)
| trip | уровень | длина | ветка |
|---|---|---|---|
| `free-1c` | EASY | 3 мин, K 0,3, 2 перекрёстка | main |
| `free-2c` | MEDIUM | 5 мин, 3 перекрёстка + развилка | main |
| `free-3b` | HARD | 15 мин, 6 перекрёстков, 2 развилки, без assist | main (в PR #3 заморожен как legacy) |
| `free-3c` | HARD | 30 мин (×10) | PR #3 |
| `1h` / `4h` / `8h` | платные | 1/4/8 ч (у демо-кошелька ÷ DEMO_SCALE) | main. **Решение 17 (17.10): 4h и 8h пока убраны, остаются только 1h и бесплатные** |

#### 1.7 Ключевые файлы
- Сервер, домен: `server/src/domain/verdict/{replay-engine,traffic-proof,traffic-sim,replay-physics,recording-checks,human-checks,challenge-checks,world-checks,verdict-rules,ride-verdict.entity,ride-replay.entity,pool-attention}.ts`, `server/src/domain/telemetry/{telemetry-rules,batch-summary,world-facts,sample-safety,ride-batch.entity,telemetry-merkle}.ts`, `server/src/domain/rides/{ride.entity,ride-trip,ride-challenge}.ts`, `server/src/domain/road/*`.
- Сервер, приложение: `application/services/verdict.service.ts`, `use-cases/telemetry/upload-batch`, `use-cases/verdict/process-replay-queue`, `use-cases/admin/{rejudge-ride,rejudge-rides,override-verdict}`, `use-cases/rides/{start-ride,end-ride,heartbeat}`, `infrastructure/verdict/*-replay-queue.adapter.ts`, `infrastructure/scheduling/replay-verification.scheduler.ts`.
- Общее ядро: `client/shared/{physics,traffic-simulation,traffic,road-network,road,simulation-config,traffic-proof,prng}.js`.
- Клиент: `client/js/telemetry.js`, `client/js/sim/{physics,damage,traffic}.js`, `client/js/trips.js`.

---

### 2. Что уже покрыто тестами

| Где | Что покрывает | Длительность |
|---|---|---|
| `server/test/unit/domain/verdict.spec.ts` (33), `verdict-motion.spec.ts` (14), `world-checks.spec.ts` (13), `replay-engine.spec.ts` (9), `replay-physics.spec.ts` (6), `traffic-sim.spec.ts` (5), `traffic-proof.spec.ts` (4), `telemetry-merkle.spec.ts` (8), `sample-safety` (2), `replay-inputs` (3), `ride-audit` (2) | Чистые функции проверок, коды причин | синтетика, секунды |
| `unit/.../upload-batch.handler.spec.ts` (10), `rejudge-ride*.spec.ts` (8), `verdict.service.spec.ts` (9; в PR #3 +147 строк по ranked и cleanMetres) | Порядок батчей, повторная проверка, сервис | — |
| `integration/.../ride-best-verified*.adversarial` (8) | Лучшая проверенная поездка при атаках на запросы | БД |
| `scenarios/verdict.scenarios.ts` (18) | HTTP: verified, правила v4, beacon, нет записи, скриптовый тайминг → flag, рассогласование 600 м, поздний батч, ямы с сервера, хеш (unhashed / mismatch), бюджет байт, очередь replay | `FREE_RIDE_SECONDS` маленький, **`TRAFFIC_PROOF_REQUIRED=false`** в harness |
| `scenarios/telemetry.scenarios.ts` (4) | Небезопасные сэмплы, повторная отправка, окно 60 с, 401/404/400 | — |
| `scenarios/traffic-proof.scenarios.ts` (1×5) | v1: honest / downgrade / malformed / unbound / rehash-without-proof. **Honest-запись собрана в Node серверным `TrafficSimulator` и получает VERIFIED** | 6 с игры |
| `server/scripts/e2e-verified-play.mjs` | Человек и metronome-бот в Chrome; API-боты: нет ввода, телепорт, выше губернатора, правка после хеша, unhashed, неверная ссылка, переполнение | `FREE_RIDE_SECONDS=40` |
| `server/scripts/e2e-verified-deep.mjs` | 20+ кейсов записи и тайминга, протокол загрузки, видимость, админ, retention, bulk rejudge | `FREE_RIDE_SECONDS=30` |
| `server/scripts/e2e-traffic-proof.mjs` (`e2e.sh traffic`) | Chrome, 9 режимов: honest, honest-finish, honest-slow, honest-collision + пять атак модифицированного клиента: `no-cars`, `no-cars-no-columns`, `ignore-damage`, `strip-proof`, `malformed-proof` | 7 с, контактные 25 с |
| `server/scripts/sim-rides.mjs`, `e2e-replay.mjs`, `e2e-honk-verdict.mjs` | Нагрузочные «водители» через API (honest), просмотр replay, HONK после вердикта | по `FREE_RIDE_SECONDS` |
| `client/test/traffic-proof.test.mjs` (2), `server/test/fixtures/simulation/traffic-browser.json` | Кодек proof, паритет ядра браузер↔сервер на 5 маршрутах × 3 трипа | — |
| `.claude/skills/level-check/check.mjs` | **Готовый автопилот:** настоящий бандл игры в Node (esbuild + stub three + fake DOM), «человеческий» водитель (реакция ~1 с, повороты, красный, развилки), 15 мин HARD на многих сидах | 15 мин игры, **на сервер не отправляет** |
| `client/tools/cdp.mjs` `driveHook` | Chrome-водитель: фиксирует `v` и `d` каждые 40 мс | — |
| PR #5 `e2e/` | Блоки 1–2: страницы, API, цепь; античит не трогает | — |

**Вывод:** проверки поездки покрыты широко, но только короткими записями (6–40 с). Ни один тест не проводит 15‑минутную поездку через сервер с v1-proof. Большинство API-сценариев работают в режиме v0 (`TRAFFIC_PROOF_REQUIRED=false` в `test/support/harness.ts`). Атаки на proof v1 есть только в Chrome и в одном коротком сценарии. Производительность replay длинной поездки не измерялась.

---

### 3. Бот-водитель

#### 3.1 Архитектура (`e2e/block3-anticheat/bot/`)
Два движка, один интерфейс `drive({seed, trip, route, durationS, variant, seedNoise}) → {batches[], heartbeats[], endReport, truth}`:

1. **`engine: game`** (основной): настоящий клиент в Node, собранный как в `level-check/check.mjs` (esbuild `client/js/main.js`, stub three, fake DOM, детерминированные `Math.random` и `performance.now`). Бот нажимает клавиши через события `keydown/keyup`, то есть ровно то, что делает человек. Телеметрию, хеши и proof пишет **сам игровой `telemetry.js`**, а бот только перехватывает `fetch` и решает, когда отправить. Так проверяется настоящий клиент, без копии его формата.
2. **`engine: kernel`** (быстрый и для атак): минимальный водитель поверх `client/shared/*` + `TrafficSimulator`, как в `traffic-proof.scenarios.ts`. Запись собирается вручную. Нужен для точных атак (подмена одного кадра, сдвиг d и т. п.) и для `in-process`.

Логика водителя переиспользует `makeDriver`/`wheelFor` из `level-check` (вынести в `e2e/block3-anticheat/bot/driver.mjs` и импортировать из skill, чтобы не дублировать): держать полосу, дистанцию до машины, стоп на красный, ожидание окна на выезде, выбор дороги на развилке (`takeOther`), реакция на знак ямы.

#### 3.2 Варианты бота
| variant | Поведение | Ожидание |
|---|---|---|
| `honest-clean` | Аккуратно, без урона | `completed` + `verified`, `cleanMetres = completeDist` |
| `honest-mistake:crash@N` | Нарочно бьётся о машину на минуте N | ranked: `cleanMetres ≈ s(N)` ± допуск; если авария фатальная → `failed` |
| `honest-mistake:hole@N` | Въезжает в яму на минуте N (hull падает) | `verified`, `cleanMetres = s до ямы` |
| `honest-mistake:offroad@N` | Съезд на k с < лимита | `verified`; съезд не ошибка (проверить правило, решение 7) |
| `human-noise` | Лог-нормальные удержания (CV 0,3–0,8), джиттер реакции, микрокоррекции руля | `verified`, ни одного timing-flag (контроль ложных срабатываний) |
| `metronome` | Одинаковые удержания и интервалы | `flagged` (`uniform-holds`/`repeated-timings`) |
| `cheat:<id>` | см. каталог §5 | код из каталога |

Длина: `--duration 900` (15 мин, по умолчанию, `free-3b` в main), `1800` (30 мин, `free-3c` после PR #3), `1h` через демо-кошелёк с `DEMO_SCALE=4` (= 15 мин) или полный 3600 с ночью. Сиды: фиксированный набор `SEEDS=[11, 87122, 39608, …]` и `--random-seeds N` для ночного прогона.

#### 3.3 Где запускается
- **in-process** (`server/test/anticheat/*.spec.ts`, jest с harness): Nest + Postgres из harness, `TRAFFIC_PROOF_REQUIRED=true`, **фиктивные часы** (`sec(n)` в `bindClient`). 15 игровых минут проходят за секунды wall, бюджеты сервера (game‑t ≤ wall·1,05) соблюдены, потому что сдвигается и серверное время. Сюда идут детерминизм, каталог атак и регрессия.
- **docker** (стек PR #5: `docker-compose.e2e.yml`, `node dist/main.js`): часы настоящие, поэтому бот идёт **в реальном темпе**: игровое время не может опережать wall больше чем на 5 % + 30 с, heartbeat раз в 1–10 с. 15 мин = 15 мин wall. Это ночной прогон и проверка конкурентности.
- Бот только Node, без браузера. Puppeteer-версия позже, как ты и хотел.

---

### 4. Позитивные проверки

| ID | Проверка | Критерий |
|---|---|---|
| AC-P1 | 15 мин `honest-clean` на `free-3b`, 6 сидов | `completed`, `verified`, `reasons=[]`, `RideReplay.status=verified`, `rulesVersion ≥ 7` |
| AC-P2 | `simulatedDistance` против `recordedDistance` | разница ≤ `tolerance.distanceShare` (предлагаю 1 % + 30 м, как `AGREE_*`) |
| AC-P3 | `simulatedHull` против `recordedHull`, `trafficContacts` против `truth` бота | hull ± 1 %, контакты совпадают по id машины |
| AC-P4 | **позже (PR #3)** ranked: `cleanMetres` против `truth.firstMistakeS` бота | ± `tolerance.cleanMetres` (предлагаю 30 м = `AGREE_METRES`); `cleanBps` на доске = формула |
| AC-P5 | HONK (main): начисление ровно один раз; TEN4 и 8h-hold 48 ч — позже (PR #3) | ledger, повторный judge не начисляет |
| AC-P6 | **Детерминизм:** тот же seed + те же нажатия → байт-в-байт те же батчи (engine game с фиксированными часами), тот же вердикт, те же `scores`; `rejudge` и `verdict:rejudge` дают тот же статус | равенство JSON |
| AC-P7 | Golden-фикстуры: записанная 15‑мин поездка из `fixtures/anticheat/*.json.gz` → тот же вердикт при каждом прогоне. Изменение ядра без бампа `RULES_VERSION` ломает тест | snapshot `scores` |
| AC-P8 | **Бюджет производительности** replay 15 мин: CPU, пик RSS, время `/end` | предлагаю ≤ 3 с CPU, ≤ 300 МБ RSS на одну поездку (уточнить первым замером); 30 мин и 1h — линейно |
| AC-P9 | **Конкурентность:** N = 4/16/32 бота одновременно (docker), очередь replay с `concurrency=4` | все `verified`, нет `failed` в `processQueue`, нет дедлоков на player lock, p95 `/batches` < 200 мс |
| AC-P10 | `human-noise` на 30 сидах | 0 ложных флагов: метрика false-positive rate |
| AC-P11 | Развилки и перекрёстки: бот берёт другую дорогу на каждой второй развилке | нет `teleport` и `traffic-proof-mismatch` на переключении (`FORK_SWITCH_SLACK`) |
| AC-P12 | Поздняя загрузка: последний батч после `/end` (≤ 60 с) | перепроверка, статус не ухудшился |

---

### 5. Каталог читов

Обозначения статуса: **C** = ловится (reject или поездка `failed`), **F** = ловится только флагом (нужен человек), **N** = не ловится, **U** = частично или неизвестно, нужен тест. «Есть тест» = существующий тест, «новый» = писать в блоке 3. Все новые прогоняются на 15‑мин записи (in-process, kernel или game).

#### A. Скорость и движение
| # | Чит | Как бот его делает | Ожидание сервера | Какая проверка | Статус | Тест |
|---|---|---|---|---|---|---|
| 1 | Скорость выше губернатора | v = 32 м/с в sample/proof | `rejected over-governor`; heartbeat → `failed implausible`; proof v>29 → `traffic-proof-invalid` | `checkSamples`, `applyReport`, `verifyTrafficProof` | C | есть (verified-play C, v0); новый v1 15 мин |
| 2 | «Круиз»: v зафиксирована в пределах губернатора, без потерь на поворотах и подъёмах | engine game, `st.v=22` каждый кадр (как `driveHook`) | сейчас `verified` | — | **N** | новый (зафиксировать как known-gap) |
| 3 | Мощность двигателя ×1,5 | ускорение в 1,5 раза выше | `verified` (порог 1,8× на ≥ 3 шагах) | `physics-speed-mismatch` | U | новый: ×1,5 / ×2 / ×3 |
| 4 | Тормоза ×2 | замедление сильнее `TRUCK_BRAKE` | `verified` | замедление не ограничено | **N** | новый |
| 5 | Сцепление и руль: проходить повороты быстрее, чем позволяет grip | psi и d меняются быстрее модели | `verified` | поперечной модели нет | **N** | новый |
| 6 | Продольный телепорт | Δs = 80 м за 0,1 с | `rejected teleport`, `traffic-proof-invalid` | `checkSamples`, proof Δs | C | есть (v0); новый v1 |
| 7 | Поперечный телепорт (прыжок на другую полосу за кадр, чтобы уйти от машины) | d: 2,4 → −2,4 за 50 мс | вероятно `verified` | границы d только `|d|≤100` и offroad; swept-контакт интерполирует | **N** | новый |
| 8 | s опережает спидометр | v/2 при том же Δs | `rejected speed-mismatch` | `checkMotion` | C | есть (deep) |
| 9 | Разгон без газа | dv>0 при gas=0 | `accel-without-gas` (reject при ≥ 2 м/с или 5 шагах) | world-checks + replay | C | есть (unit); новый 15 мин |

#### B. Время
| # | Чит | Как | Ожидание | Проверка | Статус | Тест |
|---|---|---|---|---|---|---|
| 10 | Ускорение времени (игровые часы быстрее wall) | бот шлёт 15 мин за 5 мин wall (docker) | `400` на батче сверх `maxGameSeconds`, heartbeat кредит ≤ wall, цепочка рвётся → `missing-batches` | `recordingAllowance`, `applyReport` | C | новый (docker) |
| 11 | Slow‑mo (игра идёт ×0,5, время и движение согласованы) | `performance.now` ×0,5 | `verified` | только верхняя граница game≤wall | **N** | новый, решение 6 |
| 12 | Сдвиг меток времени, sample вне батча, назад | t−1 с у одного sample | `rejected sample-out-of-order` | `batch-summary` | C | есть (deep) |
| 13 | Дыра в heartbeat > 150 с | пауза отправки | `failed heartbeat lost` | `applyReport`, sweeper | C | есть (unit); новый docker |
| 14 | Подделка дистанции в heartbeat | `s` + 500 м | `failed implausible progress` | `applyReport` | C | есть (unit) |

#### C. Целостность записи
| # | Чит | Как | Ожидание | Проверка | Статус | Тест |
|---|---|---|---|---|---|---|
| 15 | Выброшены кадры или sample | удалить 2 с внутри батча | `sample-gap` / `traffic-proof-invalid` (непрерывность clock) | `checkMotion`, proof | C | есть (v0); новый v1 |
| 16 | Дубли кадров | повтор строки | `sample-out-of-order` / proof clock | summary, proof | C | новый v1 |
| 17 | Перестановка кадров | swap двух строк | то же | то же | C | новый v1 |
| 18 | Пропущенный батч | не слать seq 100 | `429`, затем `missing-batches` | `UploadBatchHandler`, `checkChain` | C | есть (deep) |
| 19 | Разрыв цепочки | неверный `prevHash` | `chain-broken` | `checkChain` | C | есть |
| 20 | Правка без пересчёта хеша | правка после хеша | `hash-mismatch` | `checkChain` | C | есть |
| 21 | Утаить последние батчи (спрятать аварию в конце) | не слать последние 20 с | v1: `traffic-proof-missing` (кадры не покрывают `driveSeconds`); v0: только coverage | proof coverage | C (v1) | новый |
| 22 | Загрузка после окна 60 с | батч через 61 с после `/end` | `409` | `acceptsRecording` | C | есть |
| 23 | Понизить протокол до v0 | `{trafficVersion:0}`, без proof | `traffic-proof-missing` | серверная метка | C | есть (scenario) |
| 24 | Битый или удалённый proof | `AAA=` / delete | `traffic-proof-invalid` / `-missing` | proof | C | есть (Chrome, scenario) |

#### D. Трафик, урон, аварии
| # | Чит | Как | Ожидание | Проверка | Статус | Тест |
|---|---|---|---|---|---|---|
| 25 | «Призрак»: клиент без машин | engine game, `g.traffic.length=0` | `traffic-collision-ignored` | серверный трафик | C | есть (Chrome 25 с); новый 15 мин |
| 26 | hull зафиксирован на 100 | `ignore-damage` | `traffic-damage-ignored` / `obstacle-ignored` | proof hull, ямы | C | есть (Chrome) |
| 27 | Ремонт: hull растёт | +10 % между кадрами | `traffic-proof-invalid` | `hull > lastHull` | C | новый |
| 28 | Скрытый счётчик аварий | `crashesVehicle` не растёт | ловится через proof (v1) | proof | C | есть частично (honest-collision); новый |
| 29 | Аварии со зданиями и обочиной | — | `simulatedCrashesBuilding = 0`, не моделируется | — | U | новый (определить, что это вообще) |
| 30 | Урон от ям уменьшен до 30 % | `damage.js` ×0,3 | `verified` (порог `PASS_DAMAGE_SHARE` = 25 %) | world-checks | **N** | новый |
| 31 | Одна яма без урона | одна яма пропущена | `flagged obstacle-no-impact` | world-checks | F | есть (unit) |
| 32 | Проезд на красный без столкновения | бот игнорирует светофор | правилами не проверяется, ловится только при контакте | — | U | новый, решение 7 |
| 33 | Подаренная яма проигнорирована | не применять live-событие | `donated-obstacle-ignored` / `event-unapplied` | replay | C | есть (unit). **Решение 33: механика удаляется целиком, позиция выбывает из каталога** (проверки остаются только для перепроверки старых поездок, §20.1) |

#### E. Чужие и повторные записи
| # | Чит | Как | Ожидание | Проверка | Статус | Тест |
|---|---|---|---|---|---|---|
| 34 | Своя старая запись на новом сиде | перехешировать под новый rideId | reject, только если новая дорога даст контакт или яму; без контакта sample совпадает со своим же кадром | ямы, трафик | U (вероятностно) | новый: доля пойманных на 30 сидах |
| 35 | Точная копия чужой поездки на том же сиде (пул, дневной сид; `GET /api/watch/:id` отдаёт все sample) | rehash под свой rideId, загрузка в реальном темпе | `flagged pool-duplicate-recording`, только у пулов и только после `pool:attention` | pool-attention | F | новый |
| 36 | Та же копия со сдвигом d на 0,15 м и шумом v | — | `verified` (порог 0,1 м) | — | **N** | новый |
| 37 | Сибилы: один человек, N кошельков, похожие записи | N ботов с одного IP | `pool-shared-ip` (flag), только топ‑20 пула | pool-attention | U | новый (связать с `anti_sybil_wallet_checks.md` (superseded, merged into docs/spec)) |

#### F. Боты
| # | Чит | Как | Ожидание | Проверка | Статус | Тест |
|---|---|---|---|---|---|---|
| 38 | Наивный бот (metronome) | variant `metronome` | `flagged` | `human-checks` | F | есть (Chrome bot); новый 15 мин |
| 39 | «Человекоподобный» бот через настоящий клиент | variant `human-noise` | `verified` | только timing-статистика, challenges выключены | **N** | новый (AC-P10 = тот же прогон) |
| 40 | Синтетическая запись без клиента (ядро + `TrafficSimulator`) | engine kernel | `verified` (сценарий `traffic-proof honest` это и показывает) | — | **N** | новый |
| 41 | TAS: заранее просчитанный идеальный проезд по известному сиду (сид пула общий, трафик детерминирован) | оффлайн-оптимизация, потом `human-noise` | `verified` | — | **N** | новый (только демонстрация) |

#### G. Ranked и подача
| # | Чит | Как | Ожидание | Проверка | Статус | Тест |
|---|---|---|---|---|---|---|
| 42 | Завысить `cleanMetres` в heartbeat | hull=100 в heartbeat при уроне в записи | clamp до `firstDamageS`, `clean-mismatch` | PR #3 `verdict.service` | C | unit в PR #3; новый 15 мин |
| 43 | Ranked-заезд вне окна или сверх попыток | старт после окна / 2-я попытка | `409` (ranked_*) | PR #3 `ranked-entry.service` | C | unit в PR #3; HTTP новый |
| 44 | Спам батчей, seq или байт сверх бюджета | 10 батчей/с | `400`, троттлинг `429` | allowance, throttler | C | есть (байты); новый seq |
| 45 | Исчерпание ресурсов длинным replay (после решения 17 — только 1h ≈ 1 800 батчей; было: 8h ≈ 14 400 батчей, proof ≈ 7–8 КБ/с base64, всё грузится в память в одной транзакции под player lock) | 1h/8h демо-поездка | неизвестно | — | U | новый (AC-P8) |

**Итого: 45 позиций.** Ловятся 29 (26 reject или `failed` + 3 только флагом), не ловятся 10 (#2, 4, 5, 7, 11, 30, 36, 39, 40, 41), неизвестно или частично 6 (#3, 29, 32, 34, 37, 45). Существующий тест есть примерно у 24 позиций, но все они длятся 6–40 с, а v1 покрыт только в Chrome и в одном сценарии.

---

### 6. Главные дыры (не исправлять в этом блоке, только зафиксировать тестами `known-gap`)
1. **Бот проходит.** Сервер проверяет позы, а не руки. Человекоподобный бот на настоящем клиенте или синтетика на общем ядре получает `verified` (#39–41). Challenges выключены (`CHALLENGE_KINDS = []`), timing-проверки дают только флаг. README это признаёт: «a bot using the real game can still pass».
2. **Нет поперечной кинематики и проверки торможения** (#4, 5, 7): d, psi и замедление не сверяются с рулём, grip и `TRUCK_BRAKE`. Прыжок по полосе, чтобы уйти от машины, не ловится.
3. **«Круиз» и модифицированная мощность ниже 1,8×** проходят (#2, 3). Chrome-тест `honest` сам фиксирует `v=22`, `d`, `psi=0` и ждёт `verified`, то есть такое поведение закреплено как «честное».
4. **Урон от ям можно срезать до 25 %** (#30).
5. **Копия чужой записи на общем сиде** ловится только флагом, только у пулов, только после `pool:attention`, а сдвиг на 0,15 м обходит детектор (#35–36). Публичный `/api/watch/:id` отдаёт все sample.
6. **TAS по известному сиду** (#41): сид пула общий и известен до старта, трафик детерминирован.
7. **Slow‑mo** не ограничен (#11). Для конкурса на скилл это преимущество в реакции.
8. **Производительность длинного replay неизвестна** (#45). Весь replay идёт синхронно в транзакции под блокировкой игрока. 8h-поездка могла упереться в память (4h/8h убраны решением 17; для 1h риск меньше, но замер нужен).
9. Тестовый harness по умолчанию `TRAFFIC_PROOF_REQUIRED=false`, поэтому большинство HTTP-сценариев проверяют не тот протокол, что в production.

---

### 7. Как встроить

#### 7.1 Структура
Предлагаю **блок 3 в PR #5**, но отдельными коммитами (или отдельный PR от main после мержа PR #3, см. решение 1):
```
e2e/block3-anticheat/
  bot/driver.mjs          # makeDriver/wheelFor (вынести из level-check, skill импортирует отсюда)
  bot/engine-game.mjs     # бандл клиента в Node, перехват fetch, детерминированные часы
  bot/engine-kernel.mjs   # синтетика на client/shared + TrafficSimulator
  bot/variants.mjs        # honest-clean, mistake@N, human-noise, metronome
  bot/cheats.mjs          # 45 модификаторов из каталога, по id
  positive.test.mjs       # AC-P1..P12 (docker, реальный темп)
  cheats.test.mjs         # каталог против docker
  perf.test.mjs           # AC-P8/P9
  tolerance.json
  catalog.mjs             # таблица §5 → проверка, что у каждого id есть тест и ожидаемый код
server/test/anticheat/
  long-ride.spec.ts       # in-process, фиктивные часы: P1–P7, P11, P12
  cheats.spec.ts          # каталог in-process (быстро)
server/test/fixtures/anticheat/
  free-3b-<seed>-honest.json.gz, …-mistake.json.gz, free-3c-…, 1h-demo-…   # golden-записи
```

#### 7.2 npm-скрипты
- `test:e2e:block3` → `bash e2e/scripts/run.sh 3`: стек блока 1 + `TRAFFIC_PROOF_REQUIRED=true`, `CHALLENGE_INTERVAL_SECONDS=0`, `FREE_RIDE_SECONDS=180`, `DEMO_WALLETS=<бот>`, `DEMO_SCALE=4`.
- `test:anticheat` (server, jest, in-process): каталог + детерминизм + golden, ~1–3 мин.
- `test:anticheat:long` (docker, реальный темп): 6 сидов × 15 мин параллельно ≈ 20 мин wall; `--duration 1800` и `1h` только ночью.
- `anticheat:record-golden` — пересобрать фикстуры (только руками и с бампом `RULES_VERSION`).

#### 7.3 CI против ночного прогона
- **CI на каждый PR:** `test:anticheat` in-process (15 мин игрового времени на фиктивных часах = секунды), golden-фикстуры, `catalog.mjs` (у каждого чита есть тест и код). Плюс один короткий docker-смоук на 3 мин.
- **Ночью:** `test:anticheat:long` (15 мин × 6 сидов, 30 мин HARD × 2, 1h-демо × 1), конкурентность 16/32 бота, `human-noise` на 30 случайных сидах (false-positive rate), perf-отчёт с трендом.
- `known-gap`-тесты (статус N) ждут текущее поведение (`verified`) и помечены `KNOWN_GAP`. Когда дыру закроют, тест падает, и его переводят в обычный.

#### 7.4 Допуски (`tolerance.json`)
```json
{ "distanceMetres": 30, "distanceShare": 0.01, "hullPct": 1.0, "cleanMetres": 30,
  "perf15min": { "cpuMs": 3000, "rssMb": 300, "endP95Ms": 5000 },
  "concurrency": { "bots": 16, "batchesP95Ms": 200 },
  "falsePositiveMax": 0.0 }
```
Значения стартовые: после первого ночного прогона подогнать по замеру и зафиксировать.

#### 7.5 Ручные и mock-проверки (в [`docs/testing/MANUAL_TESTS.md`](../testing/MANUAL_TESTS.md))
- Chrome-матрица `e2e.sh traffic` остаётся как есть, это браузерная половина.
- Сравнить 15‑мин запись живого человека с записью `human-noise` (метрики human-checks): решение 3.
- Engine game может упереться в fake DOM и сетевой код онлайн-поездки. Если так, первая итерация идёт на engine kernel, а game добавляется вторым шагом. **Это риск, его надо проверить первым.**

---

### 9. Усиление античита v2 (план)

Цель: сервер **сам пересчитывает поездку из сырого ввода и seed** на общем ядре и сам определяет, человек за рулём или бот. Позы клиента остаются подсказкой для показа и поиска места расхождения, судить по ним сервер перестаёт.

#### 9.1 Что есть в main и чего не хватает
- Сырые события уже пишутся: `recordInput(code, down, e.timeStamp)` → `[ms от старта по wall, code, down]` с точностью 0,1 мс (`client/js/telemetry.js`, `ui/input.js`). Ввод только клавиатура (`KeyW/ArrowUp` и т. д.) и кнопки приборной панели `btn:*`, мобильные заблокированы, геймпада и аналоговых осей нет.
- Не хватает двух вещей:
  1. **Привязки события к шагу симуляции.** Событие записано по wall-времени, а игра читает `input` раз в кадр с переменным `dt` (rAF, `dt ≤ 0,05`, `main.js`).
  2. **Модели грузовика в общем ядре.** Поперечная динамика, руль, коробка, урон от ям и пропсов, климат (температура двигателя влияет на мощность) и батарея лежат в `client/js/sim/{physics,damage,climate,battery}.js`, а не в `client/shared`. На сервере есть только продольная оценка (`stepTruckPhysics`).

#### 9.2 Протокол v2 (`trafficVersion = 2`, `RULES_VERSION = 8`)
> **Пересмотрено 17.10 → §14 (v2.1).** Ниже базовый v2. Поверх него §14 добавляет: сессионный ключ и HMAC каждого батча вместо цепочки SHA-256 без ключа, `seq`/ack, синхронизацию часов, высокочастотные трассы указателя и клавиш в мини-играх, `isTrusted`/`pointerType`, бинарный кодек со сжатием и бюджет на 1h. Если они расходятся, верным считается §14.

- **Фиксированный шаг симуляции** **30 Гц** (решение 12, изменено 17.10; было 60 Гц; запасной вариант 20 Гц), аккумулятор, рендер интерполирует между шагами. Шаг `n` = игровое время `n/30`. Переменный `dt` из протокола исчезает. 1h = **108 000 шагов** (при 20 Гц — 72 000).
- **События ввода** (бинарно, base64, внутри хешируемого текста): `[stepIndex u32, wallMs f64, codeId u8, down u8]`. `wallMs` берётся из `performance.now()`/`e.timeStamp` в высоком разрешении и нужен для анализа тайминга, `stepIndex` — первый шаг, на котором событие действует, и нужен для пересчёта. Неизвестные коды (кроме телефона) отбрасываются. Телефон `phone:*` остаётся отдельным потоком.
- **Часы шагов:** каждые 3 шага (10 Гц) пара `[stepIndex, wallMs]`, чтобы связать шаги с реальным временем. Это нужно для времени реакции и для нижней границы slow‑mo.
- **Контрольные точки** 1 Гц: `[step, s, d, psi, v, hull, stateHash64]`. Только чтобы быстро найти место расхождения, сервер им не доверяет.
- **Убираем из обязательного:** 10‑Гц sample и покадровый trafficProof. Сэмплы для зрителей сервер строит сам из пересчёта (`/api/watch` отдаёт серверные позы, решение 18).
- **Размер** (оценка, замерить в Ф0):

| | v1 сейчас | v2 |
|---|---|---|
| Позы / proof | ~96 Б × ~60 кадров/с ≈ 5,8 КБ/с (base64 ≈ 7,7 КБ/с) + sample ≈ 1,2 КБ/с | контрольные точки ≈ 0,05 КБ/с |
| Ввод | ≈ 0,1 КБ/с (JSON) | события ≈ 0,06–0,1 КБ/с + часы шагов ≈ 0,1 КБ/с |
| Итого | **≈ 9 КБ/с** ≈ 8 МБ на 15 мин, ≈ 32 МБ на 1h | **≈ 0,3–0,4 КБ/с** ≈ 0,3 МБ на 15 мин, ≈ 1,3 МБ на 1h (в v2.1 со сжатием ≈ 0,5 МБ, §14.6) |

- Цепочка хешей, порядок батчей и бюджеты по wall-времени остаются. Батч раз в 2 с игры или 60 шагов. `recordingAllowance` для v2 сильно ужимаем (байт/с ≈ 2 КБ вместо 65 КБ).

#### 9.3 Авторитетный пересчёт и детерминизм
> **Дополнено 17.10 → §15.** Целостность мира: все объекты (ямы, трафик, опасности, конусы, станции мини-игр, шлагбаумы) существуют только в серверном пересчёте, и столкновения считаются там же. Сюда же коды причин и разбор существующей проверки «удалил препятствия на клиенте».

- Сервер: `seed` → дорога, ямы, трафик → `TruckSim` (новый, общий) → шаги по событиям ввода. Все судебные факты сервер получает из **своего** пересчёта: s, скорость, hull, контакты, съезды, финиш, `completeDist`. Клиентские `s`/`hull` в heartbeat и `/end` становятся подсказкой (для live-ленты). Финиш (`completed`) решается по пересчёту.
- **Шаг 30 Гц (решение 12):** dt = 33,3 мс укладывается в нынешний предел клиента (`dt ≤ 0,05` в `main.js`, кадры proof v1 ≤ 50 мс), но столкновения нужно считать **swept** (как уже делает `TrafficSimulator`), а не по точкам: за шаг на губернаторе грузовик проходит ≈ 0,93 м. Яма и шлагбаум тоньше этого не пропускаются. Подшаги только внутри ядра и детерминированные (например, 2 подшага для шин прицепа). Цена на сервере: при оценке шага грузовика 1–3 мкс и трафика 20–60 мкс → **≈ 0,6–1,9 мс CPU на игровую секунду**, 1h ≈ **2–7 с CPU** на ядро (с накладными до ~10 с), то есть ×400–1500 быстрее реального времени. При 20 Гц ≈ 1,5–5 с. Замер в Ф0. Если 30 Гц ухудшит управляемость в `level-check`, запасной вариант — 20 Гц (тот же протокол, другой `stepHz` в заголовке поездки), а не возврат к 60.
- **Требования к детерминизму:**
  1. Вся игровая физика в `client/shared`: грузовик (руль, продольная, коробка, сцепление, стоянка, зажигание), урон (ямы, машины, пропсы), климат и батарея (если влияют на мощность), ветер. Рендерно-косметическое (`Math.random` у «мошек», осколки) остаётся вне ядра.
  2. В ядре нет `Math.random`, только PRNG от seed (`client/shared/prng.js`).
  3. **Своя детерминированная математика:** `sin/cos/exp/pow/atan2/tanh` реализовать в ядре (порт fdlibm или полиномы). V8 (Chrome, Node) совпадает, но SpiderMonkey и JavaScriptCore могут отличаться на 1 ulp, и за 8 часов это разойдётся. Только float64, без Float32, порядок операций фиксирован, обход машин в детерминированном порядке.
  4. Состояние сериализуемо: JSON сохраняет float64 точно. Нужен `snapshot()`/`restore()` у `TrafficSimulation` и `TruckSim`.
  5. **Паритет:** golden-трассы (seed + события) → хеш состояния каждую секунду, побитово одинаковый в Node, Chrome, Firefox, Safari. В CI Node и Chrome (headless), Firefox и WebKit ночью (Playwright позже, как решено).
- **Если побитово не выйдет** (запасной вариант, решение 12): сравнение с допуском без «подтягивания» к позам клиента. Расхождение больше порога → `resim-divergence` (flag), а не принятие клиентской позы.
- **Slow‑mo (#11):** для платных поездок game/wall по часам шагов ≥ 0,9 вне паузы, паузы ≤ N за поездку и ≤ M секунд суммарно. Нарушение → `time-dilation` (reject при устойчивом отклонении, flag при коротком).
- **Согласованность ввода:** клиентские контрольные точки против пересчёта (`resim-mismatch` при расхождении → reject; это значит модифицированная физика), события против бита газа (уже есть).

#### 9.4 Оценка человечности (human-likelihood score)
> **Расширено 17.10 → §16 (обязательный блок).** Добавлены признаки по трассам мыши и клавиатуры из мини-игр (закон Фиттса, профиль скорости, dwell/flight), квантование по кадрам, сходство между аккаунтами, уровни вердикта и инструменты ручной проверки. Таблица ниже остаётся как подмножество.

Признаки считаются на сервере из событий v2 и стимулов, известных из пересчёта (момент, когда стимул стал виден водителю):
| Признак | Что меряет | Признак бота |
|---|---|---|
| Время реакции на стимулы: машина впереди тормозит, яма (знак за `HOLE_WARN`), светофор меняется, развилка, серверная опасность (§9.5) | распределение RT от момента видимости до первого уместного ввода | RT < 120 мс; почти постоянное; гауссово без правого хвоста (у людей ex‑Gaussian или лог-нормальное) |
| Межклавишные интервалы и удержания | CV удержаний, энтропия интервалов, выравнивание по сетке таймера | CV < 0,08; энтропия ниже базовой; события ровно на границах шагов |
| Периодичность | автокорреляция и пики спектра по нажатиям руля и газа | острые пики (скрипт с периодом) |
| Микрокоррекции | короткие нажатия руля на прямой на км, дисперсия положения в полосе | ноль коррекций при идеальной полосе (дисперсия d слишком мала) |
| Дрейф усталости | тренд RT и дисперсии d по окнам 5 мин на длинной поездке | нет тренда за 30+ мин (на 15 мин признак слабый) |
| Невозможная точность | торможение ровно до ямы, проезд ровно по центру между пятнами, «идеальная» линия | доля «идеальных» решений выше базовой |
| Сходство с другими поездками | совпадение последовательностей интервалов и событий с поездками других кошельков | повтор человеческого ввода (#49) |

- **Модель:** этап 1 — прозрачная: z‑оценки признаков против **базы реальных игроков** (verified-поездки, собираются в теневом режиме во время Pre-season) → сумма логарифмов отношения правдоподобия → `humanScore 0..1` плюс список «почему». Этап 2 (после ≥ 1–2 тыс. поездок) — классификатор (градиентный бустинг) на тех же признаках, с прозрачным объяснением для админки.
- **Пороги** (стартовые, калибруются на базе): `score ≥ T_ok` → verified; `T_review ≤ score < T_ok` → `flag human-review` (ручная проверка); `score < T_review` → flag. **Reject только при физически невозможном:** медиана RT < 100 мс на ≥ 10 неожиданных стимулах, или удержания с нулевой дисперсией, или ввод, привязанный к шагам точнее, чем способен браузер.
- **Политика ложных срабатываний:** 2 недели теневого режима (считаем, не влияем). Цель: ложный flag ≤ 2 %, ложный reject ≤ 0,1 % на базе. Тайминг сам по себе никогда не даёт reject, кроме невозможного. Игрок видит код причины (без порогов). Апелляция через ручную проверку. Каждый flag от модели разбирается человеком до выплаты. Пороги версионируются вместе с `RULES_VERSION`.

#### 9.5 Серверные challenges (`CHALLENGE_KINDS` сейчас `[]`)
> **Решение 14 изменено владельцем 17.10: для 1h дорожные challenges как отдельный класс НЕ делаем, их заменяют мини-игры (§13).** Судьба пунктов ниже: `fork-instruction` перенесён в мини-игру `dispatch-radio` (вариант `exit`, §13.9.8); `surprise-hazard`, `lane-closure`, `signal-retime` как challenges не делаются (сохранены здесь как запас на будущее); `crosswind-gust` может остаться частью физики ядра (сигнал F3), но без статуса challenge. Что теряем и чем закрываем: поздних событий на дороге против TAS (#41) и подглядывания (#48) больше нет, теперь это закрывают личный `trafficSalt` (решение 13 принято) и поздние мини-игры с commit–reveal (§13.4). Канал выдачи (`Ride.issueChallenge`, heartbeat, `prompt.js`) используется мини-играми.
>
> **Дополнено 17.10 → §13.** Для 1h-поездок к этим дорожным challenges добавляется второй класс — мини-игры-капчи: телефон, АЗС, весы, платная дорога и др. Канал доставки тот же (ответ heartbeat, `Ride.issueChallenge`, `client/js/prompt.js`), но расписание берётся из личного `mgSalt`, а ответ — это задача, а не одна клавиша.

Каждый challenge — событие, которое сервер выдаёт поздно, его не знает заранее ни бот, ни предрасчёт. Событие входит в пересчёт (раньше так работали подаренные зрителями ямы с `applied`; по решению 33 они удаляются).
1. `surprise-hazard`: обломки, животное или заглохшая машина в полосе водителя. Позиция `s_now + 150–250 м`, тип и полоса из серверного HMAC. Ожидание: торможение или объезд с человеческим RT. Предрасчитанный проезд в него врезается.
2. `fork-instruction`: диспетчер по рации «на следующей развилке налево» за 20–40 с. Не та дорога → штраф или flag. Предрасчёт не знает, какую выбрать.
3. `lane-closure`: «дорожные работы» с конусами, закрыта одна полоса на 200–400 м, нужно перестроиться.
4. `signal-retime`: смена фазы светофора на ближайшем перекрёстке, проверяет реакцию на красный (по решению 7).
5. `crosswind-gust`: порыв ветра (детерминированный в ядре), нужна коррекция руля, это проверка микрокоррекций.
- Частота: 1 раз в 2–3 мин игры для платных и призовых поездок (`CHALLENGE_INTERVAL_SECONDS=240` уже есть, интервал случайный 0,6–1,4×). Для бесплатных — по флагу.
- Доставка: в ответе heartbeat (уже есть канал `openChallenge`) **за 0,5–1,5 с до видимости**, не раньше. Иначе бот получит фору (#48). Клиент обязан применить событие, неприменение → `challenge-unapplied` (reject при ≥ 50 % пропусков, как `CHALLENGE_IGNORED_*`).
- Ответ оценивается и как вождение (пересчёт видит, объехал или врезался), и как RT (оценка человечности).

#### 9.6 Поздний seed и разные трафики для игроков
- Делим seed на **`roadSeed`** (общий для пула: дорога, ямы, перекрёстки, развилки — честная одинаковая трудность) и **`trafficSalt`** = HMAC(`serverSecret`, `poolId ‖ wallet ‖ rideId`). Трафик и challenges у каждого игрока свои, статистически равные. Копия чужой записи или чужого ввода врезается (#35/36/49), предрасчёт по известному seed бесполезен (#41).
- **Commit–reveal:** при создании пула публикуется `H(serverSecret_pool)`, после закрытия пула — сам секрет. Любой может проверить, что трафик игрока посчитан честно (это аудит честности, а не античит).
- Альтернатива для одинаковой трудности: общий трафик пула, но раскрытый **по сегментам** во время езды. Слабее: первая публичная поездка раскрывает сегменты остальным. См. решение 13.

#### 9.7 Инкрементальный пересчёт и фоновый вердикт
- На каждом батче (2 с) сервер продолжает пересчёт с сохранённого снимка (`ride_sim_state`: Redis с TTL + БД раз в N батчей, ~5–10 КБ), пишет частичные факты (контакты, ямы, съезды, стимулы и RT) и обновляет снимок. Реальная поездка игрока не ускоряется (см. §11).
- `/end` больше не судит синхронно в транзакции: ставит `RideReplay pending`, финальный вердикт (сводка частичных фактов + оценка человечности + отметки по пулу) считает воркер очереди (`ReplayQueuePort` уже есть). Ответ `/end` — `verdict: pending` и поллинг `GET /api/rides/:id`.
- Под блокировкой игрока только запись результата, не сам пересчёт.

#### 9.8 Совместимость и версии
- `RULES_VERSION 7 → 8`, `trafficVersion 2` ставит сервер при старте (флаг `INPUT_REPLAY_REQUIRED`, по умолчанию false до этапа enforce). Поездки v0 и v1 судятся своими правилами, модули правил версионируются, `verdict:rejudge` выбирает правила по версии поездки.
- **Теневой режим:** v2 пишется и считается рядом с v1, вердикт v1 действует, расхождения логируются в `RideReplay`. Потом enforce.
- Клиент v1 при `trafficVersion=2` получает `409 client_outdated` с просьбой обновить страницу.

#### 9.9 Приватность ([`docs/legal/PRIVACY.md`](../legal/PRIVACY.md), правила Pre-season)
- Тайминг нажатий — **поведенческие данные** (keystroke dynamics, в ряде юрисдикций близко к биометрии). В PRIVACY.md добавить: цель — только защита от мошенничества и честность конкурса; не используется для идентификации личности или рекламы; не отдаётся зрителям и третьим лицам (сырые события уже скрыты); срок хранения — `TELEMETRY_RETENTION_DAYS` (90), для поездок топ‑20 и спорных — до выплаты + срок апелляции; база реальных игроков хранится только агрегированно (распределения, без кошельков); правовое основание — законный интерес (защита от мошенничества); право на ручную проверку решения (автоматическое решение не окончательно).
- Сравнение ритма ввода между кошельками (сибилы) — только для топ‑20 и только если раскрыто в PRIVACY.md (решение 16).

#### 9.10 Честные пределы
- ML-бот, обученный на человеческом вводе, с человеческим RT и усталостью, полностью не исключается. v2 делает такого бота дорогим (нужно реально управлять физикой в реальном времени и реагировать на поздние события), но не невозможным.
- Человек с ассистентом (бот подруливает только на опасностях) даёт смешанную картину, и score ловит его вероятностно.
- Модифицированный браузер, который сам жмёт клавиши по экрану (компьютерное зрение), неотличим от человека, кроме статистики.
- Поэтому остаются: **ручная проверка топ‑20** перед выплатой, анти-сибил (IP-кластеры, ≤ 1 приз на кластер, соцсети, `anti_sybil_wallet_checks.md` (superseded, merged into docs/spec)), повтор поездки по запросу организатора, право организатора дисквалифицировать (правила Pre-season).

#### 9.11 Каталог после v2
| # | Чит | До v2 | После v2 | Чем ловится в v2 |
|---|---|---|---|---|
| 2 | «Круиз» | N | C | скорость считает пересчёт из педалей; поза клиента не учитывается, контрольные точки расходятся → `resim-mismatch` |
| 3 | Мощность ×1,5 | U | C | то же |
| 4 | Тормоза ×2 | N | C | то же |
| 5 | Сцепление и руль | N | C | поперечная модель в ядре |
| 7 | Поперечный телепорт | N | C | d считает сервер |
| 11 | Slow‑mo | N | C | game/wall по часам шагов, `time-dilation` |
| 29 | Аварии со зданиями | U | U | только если пропсы и обочина войдут в ядро (Ф1, по объёму) |
| 30 | Урон от ям 30 % | N | C | урон считает сервер |
| 31 | Одна яма без урона | F | C | урон считает сервер |
| 32 | Красный без столкновения | U | U→C | видно в пересчёте; станет C, когда правило утвердят (решение 7) |
| 34 | Старая запись на новом seed | U | C | ввод на чужой дороге и трафике разваливается |
| 35 | Точная копия чужой поездки | F | C | `trafficSalt` + сходство ввода |
| 36 | Копия со сдвигом | N | C | то же, позы не важны |
| 37 | Сибилы | U | U | организационно: топ‑20, IP, соцсети |
| 38 | Metronome | F | C | невозможная периодичность (reject) |
| 39 | Человекоподобный бот | N | U | score + challenges + ручная проверка; ML-имитатор не исключён |
| 40 | Синтетика без клиента | N | U | без настоящего ввода не пройти пересчёт, т. е. это сводится к #39 |
| 41 | TAS по известному seed | N | C | `trafficSalt` + поздние challenges |
| 45 | Ресурсы длинной поездки (после решения 17 — 1h) | U | C | v2 в ~25 раз меньше + инкрементальный replay (после замера Ф0) |
| 46 | **новое:** маска шагов и события не сходятся | — | C | сервер строит маску сам из событий |
| 47 | **новое:** эксплуатация допуска рассинхрона | — | U | C при побитовом детерминизме (решение 12) |
| 48 | **новое:** подглядывание за challenge в ответе heartbeat | — | U | поздняя выдача за 0,5–1,5 с до видимости, RT от момента видимости |
| 49 | **новое:** повтор чужого человеческого ввода | — | C | `trafficSalt` + сходство последовательностей |

> Новые позиции #50–58 (мини-игры, noclip, удаление станций, подмена MAC и nonce, синтетические события) — в §17.3.

Остальные 26 позиций (C) остаются C. **Итого:** до v2 — 45 позиций: C 26 + F 3 = 29 ловятся, N 10, U 6. После v2 — 49 позиций: **C 42, F 0, N 0, U 7** (#29, #32 до утверждения правила, #37, #39, #40, #47, #48).

#### 9.12 Фазы и оценка (человеко-дни, план без реализации)
| Фаза | Содержание | Оценка |
|---|---|---|
| Ф0 | Замеры: скорость replay v1 (15 мин, 1h; 8h убран решением 17), память; размер v1 и v2 на реальных поездках; включить теневой сбор базы тайминга (уже пишется v1) | 3–4 |
| Ф1 | Детерминированное ядро: физика, урон, климат грузовика в `client/shared`, фиксированный шаг 30 Гц в клиенте (решение 12; запасной 20 Гц), своя математика, snapshot/restore, паритет Node/Chrome (+ Firefox/WebKit ночью), перепроверка `level-check` (управляемость могла измениться) | 8–12 |
| Ф2 | Протокол v2: события со `stepIndex`, часы шагов, контрольные точки, кодек, бюджеты, `RULES_VERSION 8`, `trafficVersion 2`, теневой режим, `409 client_outdated` | 4–6 |
| Ф3 | Сервер: авторитетный пересчёт, инкрементальный по батчам, снимки, фоновый вердикт, асинхронный `/end`, `/api/watch` из серверных поз | 6–8 |
| Ф4 | Challenges 1–5, доставка в heartbeat, применение в клиенте и ядре; `roadSeed`/`trafficSalt`, commit–reveal | 5–7 |
| Ф5 | Оценка человечности: признаки, база, пороги, админка («почему»), политика FP, апелляции | 6–8 |
| Ф6 | Блок ботов (§3–7) + варианты для тайминга (§10) + golden v2 + ночные прогоны | 6–8 |
| Ф7 | PRIVACY.md, правила, whitepaper, README, [`docs/agents/verified-play.md`](../agents/verified-play.md) | 1–2 |
| **Итого** | | **39–55** (≈ 8–11 недель одного разработчика) |

Сроки: ~~Рекомендация (решение 11): Pre-season на v1 + теневой сбор базы, v2 к Season 1.~~ **Решение 11 (17.10): рекомендация отклонена — «делаем сразу как надо, я все успею».** Владелец берёт полный объём v2 + мини-игры без промежуточного этапа «Pre-season на v1 в тени». Оценка не меняется: 70–105 человеко-дней (§18), а при одобрении всего расширенного каталога §13.9 — больше. Риск по срокам записан в §9.13 и §18 и не оспаривается.

#### 9.13 Риски
1. **Детерминизм между браузерами** (особенно Safari) — главный риск Ф1. Запасной вариант — допуск без подтягивания (решение 12).
2. **Фиксированный шаг меняет ощущение управления** — нужна перенастройка и `level-check`, `gameplay-balance`.
3. **Маленькая база** (≈ 73 реальных входа на сегодня): пороги ненадёжны, поэтому теневой режим, и reject только при невозможном.
4. **Ложные срабатывания по честным игрокам** — репутационный риск. Отсюда флаг, ручная проверка и апелляция.
5. Приватность и право: поведенческие данные (§9.9). Консультация юриста отложена, риск принят.
6. CPU сервера на пересчёт: по оценке дёшево (§11), но нужен замер Ф0.
7. Объём (39–55 дней по v2, 70–105 вместе с мини-играми) против других задач. По решению 11 владелец берёт его целиком; риск остаётся, и его видно по фазам §18.
8. Разные трафики для игроков (`trafficSalt`) меняют «одна дорога на конкурс» на «одна дорога, свой трафик». Это нужно объяснить в правилах (решение 13).

### 10. Тесты ботов на тайминг ввода (дополнение к §3–5, после Ф2/Ф5)
Все боты v2 идут через настоящий клиент (engine game) или ядро с сырыми событиями. Ожидания даны для стартовых порогов и уточняются на базе.

| ID | Вариант бота | Как устроен | Ожидание |
|---|---|---|---|
| AC-T1 | `metronome` | одинаковые удержания и интервалы | `rejected` (невозможная периодичность) |
| AC-T2 | `perfect-reaction` | реагирует ровно через k шагов после видимости стимула, RT = 50–100 мс постоянно | `rejected` (медиана RT < 100 мс на ≥ 10 неожиданных стимулах) |
| AC-T3 | `gaussian-noise` | RT ~ N(400 мс, 50), удержания ~ N(μ, σ), без хвоста и усталости | `flagged human-review` (форма распределения, нет дрейфа) |
| AC-T4 | `replayed-human` | записанный ввод реального человека, проигранный на другой поездке (тот же `roadSeed`) | `rejected` (разваливается на `trafficSalt` и challenges) + `flag input-similarity` |
| AC-T5 | `replayed-human-same-ride` | тот же ввод под другим кошельком в том же пуле | `flag input-similarity` (для обоих, позже — ручное решение) |
| AC-T6 | `ml-mimic` | ex‑Gaussian RT из базы, лог-нормальные удержания, микрокоррекции, дрейф усталости, реакция на challenges | `verified` или `flagged` — **честный предел**; тест фиксирует долю, которая проходит, это метрика силы детектора |
| AC-T7 | `assisted-human` | человеческий ввод (golden), а бот подменяет реакцию только на неожиданных стимулах (тормозящая машина, яма) и в мини-играх (surprise-hazard убран решением 14) | `flagged` по сдвигу RT на опасностях (вероятностно) |
| AC-T8 | `precomputed-tas` | идеальный проезд, оптимизированный по `roadSeed`, без знания `trafficSalt` и challenges | `rejected` (контакт или пропуск challenge) |
| AC-T9 | `late-challenge-peek` | бот реагирует в момент выдачи challenge в heartbeat, а не в момент видимости | `flagged` (RT от видимости отрицательный или слишком малый) |
| AC-T10 | `slow-mo` | шаги идут ×0,7 от wall | `rejected time-dilation` |
| AC-T11 | `fast-forward` | шаги быстрее wall | `400` бюджета / `rejected` (как #10) |
| AC-T12 | `mask-mismatch` | маска шагов не совпадает с событиями | `rejected` |
| AC-H1 | **базовые люди** | golden-записи реальных игроков (с согласия, обезличенные) | `verified`, ложные flag ≤ 2 %, reject = 0 |
| AC-H2 | `human-noise` (§3.2) | человекоподобный бот из блока v1 | контроль: доля прошедших = та же метрика, что AC-T6 |

Длины: 15 мин (`free-3b`) в CI in-process, 30 мин и 1h-демо ночью (усталость видна только на длинных). Метрики в отчёт: TPR по каждому боту, FPR на базе, распределение score.

### 11. Ускорение времени — только как техника тестов 1h (решение 17, 17.10)
- **4h и 8h пока убраны** (решение 17), остаются 1h и бесплатные. Продуктового вопроса «ускорить 8h для игрока» больше нет. Реальная поездка игрока всегда идёт в реальном темпе.
- **Тесты ускоряем:**
  - in-process пересчёт с фиксированным шагом (30 Гц, решение 12) не зависит от wall-часов: бот генерирует 1h игрового времени (108 000 шагов) за секунды CPU, серверные часы (`ClockPort`) фиктивные (`sec(n)` в harness);
  - в docker 1h законно укорачивается через `DEMO_WALLETS` + `DEMO_SCALE` (`minSeconds = tier.seconds / DEMO_SCALE`), например `DEMO_SCALE=4` → 15 мин wall для CI-смоука, `DEMO_SCALE=1` — полный час ночью.
- **Серверная проверка и так быстрее реального времени:** оценка §9.3 — 1h ≈ 2–7 с CPU при 30 Гц. v2.1 (≈ 0,5 МБ/ч, §14.6) и инкрементальный пересчёт по батчам (§9.7) раскладывают нагрузку на всю поездку.
- Если 4h или 8h вернутся, вопрос об ускорении для игрока открывается заново отдельным решением.

### 14. Протокол телеметрии v2.1 (улучшение §9.2)

#### 14.1 Что сейчас (v1, по коду)
- Батч (`client/js/telemetry.js` `cut()`): `{seq, prevHash, t0, t1, samples, inputs, trafficProof?}` → канонический `JSON.stringify` → `sha256(text)` (WebCrypto; без secure context `null` → `unhashed-<seq>`). `traffic` лежит рядом и не хешируется. Цикл нарезки — 2 с игры при v1, 500 кадров максимум; отправка строго по порядку, при 4xx запись останавливается (`rec.refused`); после `/end` повторы ещё 55 с (`GRACE_MS`) при серверном окне 60 с.
- Ввод: `[ms от wall0 с точностью 0,1 мс, code ≤ 32 символов, down]`, время берётся из `e.timeStamp`. Шага симуляции нет. Мышь записывается только как `btn:*` в момент `pointerdown`.
- Сервер: `UploadBatchHandler`, лимиты `telemetry-rules.ts` (`BATCH_MAX_BYTES = 98_304`, `BATCH_MAX_INPUTS = 2000`, `GAME_TIME_FACTOR = 1.05` + 30 с, `RECORDING_BYTES_PER_SECOND = 4096`, а при v1 `65_536` — `ride.entity.ts:206`).
- **Главная слабость:** SHA-256 без ключа. Его может пересчитать кто угодно, поэтому цепочка доказывает порядок и целостность, но не происхождение. Батч, сделанный вне сессии (оффлайн-генератор, чужая поездка), неотличим.

#### 14.2 Потоки в батче v2.1
Один батч — 2 с игры (60 шагов по 30 Гц, решение 12), бинарный кадр, формат ниже.

| Поток | Содержимое | Частота | Зачем |
|---|---|---|---|
| `inp` | `[Δstep varint, ΔtUs varint (µs от wall0), codeId u8, kind u8 (down/up/axis), value i16, flags u8 (isTrusted, repeat)]` | по событию | пересчёт (шаг) + тайминг (µs) |
| `clk` | `[step, perfNowUs]` каждые 3 шага + события `visibilitychange`, `blur/focus`, гистограмма длительностей кадров rAF за батч (8 корзин) | 10 Гц | связь шагов и wall, slow‑mo/ускорение, троттлинг вкладки |
| `chk` | `[step, s, d, psi, v, hull, stateHash64, worldDigest32]` | 1 Гц | быстрый поиск расхождения; `worldDigest` — хеш id объектов мира, которые клиент заспаунил в окне ±300 м (§15.3) |
| `mg` | на событие мини-игры: `shownAtStep/µs`, `pointermove` через `getCoalescedEvents()` (x, y нормированы к канвасу, µs, до 240 Гц), `pointerdown/up` (позиция внутри кнопки), клавиши с dwell и flight, смены фокуса, попытки, итог | только во время мини-игры | признаки F6–F7 (§16) |
| `env` | один раз и при смене: `pointerType`, devicePixelRatio, размер канваса, оценка разрешения таймера (проба `performance.now()`), видимость, режим доступности | редко | нормировка признаков, отдельные базы |

- `phone:*` из `recordPhone` переезжают в `mg`, если идёт мини-игра; вне её остаются как сейчас и не судятся.
- `isTrusted` пишется у каждого события. Синтетические `dispatchEvent` из JS страницы дают `false`. Модифицированный клиент может соврать, поэтому это сигнал, а не доказательство (решение 26).
- 10‑Гц `samples` и `trafficProof` в v2.1 не обязательны (как в §9.2). В тени v1 и v2.1 пишутся параллельно.

#### 14.3 Сессионный ключ и HMAC вместо SHA-256 без ключа
- `POST /api/rides/:id/start` → `{sessionKey (32 байта, base64), keyId, protocol: 2, mgCommit, serverEpochMs}`. На сервере ключ хранится зашифрованным (KMS/env-ключ), привязан к поездке, после вердикта удаляется.
- `mac_n = HMAC-SHA256(sessionKey, "fc-batch:v2" ‖ rideId ‖ seq_n ‖ mac_{n-1} ‖ bytes_n)`, где `mac_{-1} = HMAC(sessionKey, rideId)`. Ответы мини-игр и heartbeat v2.1 тоже подписываются (`"fc-mg:v2"`, `"fc-hb:v2"`).
- Сервер: `batch-mac-invalid` → `400` (батч отвергнут, запись стоп, как сейчас при 4xx) и `reject` поездки. `batch-mac-missing` на v2.1 → `400`. Старый `hash-mismatch`/`chain-broken` остаются для v0/v1.
- **Честно:** ключ живёт в браузере, и модифицированный клиент его прочитает. HMAC закрывает **оффлайн-генерацию и подделку вне сессии**, склейку батчей из чужой поездки, повтор чужих батчей, вмешательство посредника, батчи «из прошлого». От честности клиента защищает только пересчёт (§15).
- Ротация: новый ключ на каждую поездку; `keyId` для версионирования; утечка одного ключа касается одной поездки.

#### 14.4 Порядок, подтверждения, синхронизация часов
- `seq` строго по порядку (как сейчас, `429 batch_out_of_order`). Ответ `200` возвращает `{ack: seq, nextSeq, serverMs}`.
- **Синхронизация часов:** каждый heartbeat несёт `clientPerfUs` и получает `serverMs`. Сервер по NTP-схеме оценивает смещение и дрейф (наклон `perfNow` к серверным часам). Дрейф часов шагов к серверу > 2 % устойчиво 60 с → `time-dilation` (§9.3). Короткие всплески — flag. Скачки `perfNow` назад или вперёд при видимой вкладке → `clock-jump` (flag).
- Тайминг мини-игр считается по обоим часам (§13.5 п. 2).

#### 14.5 Оффлайн и переподключение
- Клиент хранит неподтверждённые батчи в памяти (до 120 с, ~0,5 МБ), повторяет отправку с backoff. Поездка продолжается, heartbeat-таймаут сервера остаётся `HB_TIMEOUT_MS` (150 с).
- Ответ мини-игры в оффлайне ставится в очередь с клиентскими таймингами. Серверный тайминг тогда недоступен → `mg-answer-late-network` (info, не flag), судится по клиентской трассе плюс правдоподобие задержки (по истории RTT).
- Разрыв > 150 с → `failed: heartbeat lost`, как сейчас. Перезагрузка вкладки во время 1h — новый `sessionKey` не выдаётся, поездка в v2.1 не возобновляется (решение по продукту, как сейчас).

#### 14.6 Кодек, сжатие, размер, версии
- Кадр батча: `magic "FC2" ‖ ver u8 ‖ seq u32 ‖ t0Step u32 ‖ t1Step u32 ‖ потоки (тип u8, длина varint, данные)` → `deflate-raw` (`CompressionStream` в браузере, `zlib` на сервере) → тело `application/octet-stream`. MAC считается по несжатым байтам.
- **Бюджет на 1h** (оценка, замер в Ф0):

| Поток | Сырые | После deflate | На 1h |
|---|---|---|---|
| `inp` | ~0,08 КБ/с | ~0,04 | ~0,15 МБ |
| `clk` | ~0,1 КБ/с | ~0,03 | ~0,1 МБ |
| `chk` | ~0,05 КБ/с | ~0,04 | ~0,15 МБ |
| `mg` | 4 события × ~15 с × 240 Гц × ~10 Б ≈ 150 КБ | ~60 КБ | ~0,06 МБ |
| **Итого** | | | **≈ 0,5 МБ/ч** (v1 сейчас ≈ 9 КБ/с ≈ 32 МБ/ч) |

- `recordingAllowance` для v2.1: ≈ 1 КБ/с вместо 65 КБ/с; отдельный бюджет 64 КБ на одно событие `mg`.
- Версии: `protocol = 2` (поле `trafficVersion` в БД продолжает хранить версию), `RULES_VERSION 7 → 8` (v2 + мини-игры за флагом `MINIGAMES=shadow|enforce|off`), модуль правил мини-игр `mg:1`. Клиент v1 на поездке v2.1 → `409 client_outdated` (§9.8).

---

### 15. Серверная проверка: пересчёт и целостность мира

#### 15.1 Существующая проверка «убрал препятствия — не прошёл» (как в коде сейчас)
1. **Мир принадлежит серверу.** План ям строится из сида на сервере: `roadPlanFor(seed, trip)` (`server/src/domain/road/road-plan.ts:86`) общей функцией `rollChunkHole` (`@freightchain/shared`). Клиент получает тот же план через `GET /api/watch/:id/road?from&to` (`server/src/presentation/live/live.http.controller.ts:44`) → `client/js/road-plan.js` (`followRoadPlan`, `updateRoadPlan`, окна по 6000 м за 3000 м вперёд) → `net/obstacles.js` `installPlan`. Ямы, по которым едет водитель, — серверные.
2. **Замер при приёме батча:** `batch-summary.ts:70` → `measureWorld(samples, plan, prefix)` (`server/src/domain/telemetry/world-facts.ts:67`). Для каждого прохода оси над ямой пишется `HolePass {key '<hole>:<pit>:<axle>', t, s, dir, miss, v0, hull0, v1, hull1}` вместе с хвостом предыдущего батча.
3. **Решение при вердикте:** `checkWorld` (`server/src/domain/verdict/world-checks.ts:73`, вызов `ride-verdict.entity.ts:56`). `classifyPass`: ожидаемый урон `holeDamage(T, v0, axle)`; `got ≥ expected·PASS_DAMAGE_SHARE (0,25)` → `hit`, иначе `ignored`. Порог у кромки — `PASS_CLEAR_METRES = 0,4`, не судится при `PASS_MIN_DAMAGE < 1 %`. Итог: ≥ `OBSTACLE_IGNORED_REJECT = 2` проигнорированных ям → **reject `obstacle-ignored`**, одна → flag `obstacle-no-impact`, ≥ 2 неизмеренных → flag `obstacle-unmeasured`. Рядом `offroad-ignored` (дольше `OFFROAD_FAIL_SECONDS·1,25 + 2` с) и `accel-without-gas` (`verdict-rules.ts:75–100`).
4. **Тот же мир в replay:** `ReplayEngine.verify` (`replay-engine.ts:74`, план на `:104`, `checkHolePass` на `:371`) повторяет проверку ям (`obstacle-ignored`/`-no-impact`, `:258`), подаренные зрителями ямы (`donated-obstacle-ignored`, reject, `:277`; `event-unapplied`, `:144`) — **по решению 33 удаляются**, в v2.1 их нет (§20.1).
5. **Трафик:** `TrafficSimulator` (`server/src/domain/verdict/traffic-sim.ts:76`) спаунит машины из `seed ^ TRAFFIC_SEED_XOR` (`0x9e3779b9`, `client/shared/traffic.js:3`) общим ядром `client/shared/traffic-simulation.js`. При v1 `verifyTrafficProof` (`traffic-proof.ts`) шагает серверные машины по позе клиента и ловит **`traffic-collision-ignored`** (фатальный контакт, а поездка «завершена») и **`traffic-damage-ignored`** (hull выше серверного) — оба reject. При v0 те же коды только flag (`replay-engine.ts:291/298`).
6. **Тесты атаки:** `server/scripts/e2e-road-check.mjs` (`e2e.sh road`): B — «читер в Chrome, ямы вынуты из игры (план-фолловер остановлен, `CFG.HOLES` выкл., кеш очищен)» → ожидается `COMPLETED · REJECTED obstacle-ignored` (строка 113), плюс C — реплей зрителя рисует серверные ямы с красными метками, D — `scripts/ride-audit.mjs` даёт `NOT OK`. `server/scripts/e2e-traffic-proof.mjs` (`e2e.sh traffic`): `no-cars`, `no-cars-no-columns` (машины удаляются со сцены, строка 103) и `ignore-damage` → `traffic-collision-ignored`.
7. **Предел, прямо записанный в коде** (`world-checks.ts`, шапка): «модифицированная игра, которая проезжает ямы И подделывает потерю hull, — это игра, которая попала в ямы». Проверяется **согласованность записи с серверной дорогой, а не честность клиента**. Позы (s, d, psi, v) — от клиента, поэтому поперечный «прыжок» мимо ямы или машины (#7) проходит.

#### 15.2 Что меняется в v2.1: мир целиком серверный, позы считает сервер
- Сервер строит мир сам: `roadSeed` → дорога и ямы; `trafficSalt` → трафик (§9.6); `mgSalt` → станции, шлагбаумы, карманы, сценарии мини-игр (§13.4); (дорожные challenges с опасностями и конусами убраны решением 14). Подаренных зрителями ям и эффектов больше нет (решение 33): **ни деньги, ни действия зрителей не меняют мир поездки**. **Клиент ничего не сообщает о мире, только ввод.**
- Пересчёт `TruckSim` + `TrafficSimulation` из событий `inp` по шагам (§9.3). Каждое столкновение (яма, машина, конус, обломки, шлагбаум, борт станции, пропсы и здания, если они войдут в ядро — #29) **считается на сервере**. Урон, `completed`, метрика заезда берутся из пересчёта.
- Клиентские контрольные точки `chk` сравниваются с пересчётом. Расхождение означает, что клиент живёт в другом мире или с другой физикой: это сигнал взлома, а не повод верить клиенту.

#### 15.3 Коды причин целостности (новые и уточнённые)
| Код | Когда | Severity |
|---|---|---|
| `world-collision-ignored` | пересчёт видит контакт с серверным объектом (яма/машина/конус/шлагбаум/станция), а `chk` клиента — нет (hull и поза без контакта) | reject |
| `world-digest-mismatch` | `worldDigest32` клиента ≠ серверного (у клиента нет объектов из серверного мира: удалены машины, ямы, станция) при ≥ 3 точках подряд. Даже без контакта это признак модифицированного клиента | reject при ≥ 10 с, иначе flag |
| `resim-mismatch` | поза или скорость клиента в `chk` расходится с пересчётом больше допуска (модифицированная физика: мощность, тормоза, сцепление, «круиз») | reject (при побитовом детерминизме — с первой точки; иначе по порогу решения 12) |
| `resim-divergence` | расхождение ниже порога reject, но растёт (вероятно, недетерминизм браузера) | flag |
| `noclip-path` | траектория из пересчёта упирается в объект, а клиентская `chk` идёт «сквозь» него (wallhack-подобный проход через барьер, борт, машину) | reject |
| `teleport` / `lateral-teleport` | скачок позы между соседними `chk`, невозможный для `TruckSim` (продольный уже есть; поперечный новый, #7) | reject |
| `speed-hack` | шаги идут быстрее wall (часы шагов против сервера, §14.4), бюджет `maxGameSeconds` | `400` бюджета + reject |
| `time-dilation` | slow‑mo: game/wall < 0,9 устойчиво вне пауз (§9.3) | reject / flag |
| `physics-constants-mismatch` | хеш констант ядра (`client/shared` + `CFG.TRUCK`) из `env` ≠ манифесту сборки. Слабый сигнал: модифицированный клиент соврёт, главная проверка — `resim-mismatch` | flag |
| `mg-station-skipped` | станция в серверном мире есть, а у клиента нет ни показа, ни остановки (клиент её не отрисовал) | штраф пропуска + flag; при `world-digest-mismatch` — reject |
| `toll-barrier-breach` | пересчёт видит проезд закрытого шлагбаума | урон по ядру (как контакт), при «завершено без урона» — `world-collision-ignored` |
| `mg-timer-tamper` | клиентские µs мини-игры расходятся с серверным временем (с поправкой на RTT) больше 300 мс или идут назад | flag; ответ раньше раскрытия — `mg-answer-before-reveal` (reject) |
| `batch-mac-invalid` / `batch-mac-missing` | §14.3 | `400` + reject |
| `untrusted-input` | доля событий с `isTrusted=false` > 0 в вождении или в мини-игре | flag (решение 26) |

- **Совместимость:** `obstacle-ignored`, `traffic-collision-ignored` и прочие коды v1 остаются для поездок v0/v1. В v2.1 ямы судятся пересчётом: игрок, «удаливший» яму, в пересчёте всё равно в неё въезжает → `world-collision-ignored` (или просто реальный урон, если клиент честно не знал). `e2e-road-check.mjs` B и `e2e-traffic-proof.mjs no-cars*` переводятся в регрессию v2.1 с ожиданием нового кода.

---

### 16. Детекция механического ввода (обязательно)

#### 16.1 Что есть сейчас
`checkHumanTiming` (`server/src/domain/verdict/human-checks.ts`) работает только с клавишами вождения и **только флагами**: `uniform-holds` (CV удержаний < `HOLD_CV_MIN = 0,08`), `repeated-timings` (топ‑N интервалов > `REPEAT_SHARE_MAX = 0,6`), `instant-presses` (удержание < `INSTANT_HOLD_MS = 10` мс у доли > `INSTANT_SHARE_MAX = 0,3`). Грубые таймеры браузера учтены через `timerStepMs`/`TIMER_STEPS_MS`. От `HUMAN_MIN_PRESSES = 8`. Плюс `challenge-reflex` в `challenge-checks.ts`. Мышь, стимулы, сходство между поездками и усталость не анализируются.

#### 16.2 Признаки (на сервере, из `inp`, `clk`, `mg` и стимулов из пересчёта)
| # | Признак | Как считаем | Признак механики |
|---|---|---|---|
| F1 | Межсобытийные интервалы | CV, энтропия Шеннона по лог-корзинам, подгонка ex‑Gaussian (μ, σ, τ), автокорреляция и пики спектра | CV < 0,1; τ ≈ 0 (нет правого хвоста); энтропия ниже 1-го перцентиля базы; острые пики |
| F2 | Реакция на стимул | RT от **момента видимости** (по пересчёту: знак ямы, стоп-сигнал машины, смена света, показ мини-игры) до первого уместного ввода | медиана < 100 мс на ≥ 10 неожиданных стимулах; доля упреждений (RT < 0); RT не зависит от «заметности» стимула (расстояние, ночь) |
| F3 | Дрожание и микрокоррекции | короткие нажатия руля на прямой на км, дисперсия d в полосе, коррекции после порыва ветра | ноль коррекций при идеальной полосе |
| F4 | Повторяемость между поездками | DTW-расстояние последовательностей ввода одного игрока на одинаковых участках `roadSeed`; точные совпадения интервалов (≤ 1 мс) | почти одинаковые поездки → реплей или TAS |
| F5 | Квантование | доля меток на сетке k·16,667 мс или целых мс; фаза по модулю периода кадра (тест Рэлея), с учётом разрешения таймера из `env` и `timerStepMs` | фазы стоят ровно на кадре при «тонком» таймере; мкс-часть одинакова |
| F6 | Кинематика указателя (мини-игры) | эффективность пути (прямая/фактическая: у людей 0,8–0,95), кривизна, колоколообразный профиль скорости (минимальный рывок), перелёт и корректирующие подшаги, **закон Фиттса** MT = a + b·log₂(D/W + 1) по всем целям поездки, точка клика внутри кнопки (у людей — гауссово рассеяние вокруг центра) | путь = 1,0 или «телепорт» курсора; постоянная скорость; нет перелётов; MT не зависит от ID; клики ровно в центр или равномерно |
| F7 | Динамика клавиш (мини-игры) | dwell и flight по символам, пауза на чтение перед набором ∝ длине кода, разбиение на группы, исправления (`Backspace`) | одинаковые dwell и flight; набор без паузы на чтение; ноль ошибок за все поездки |
| F8 | Дрейф усталости за час | тренд RT, дисперсии d и времени мини-игр по окнам 10 мин | нет тренда за 60 мин (слабый признак, только в сумме) |
| F9 | Сходство между аккаунтами | вектор признаков поездки → кластеризация (HDBSCAN) + MinHash n-грамм интервалов | плотный кластер разных кошельков → ферма ботов или сибилы (только топ‑20 и с раскрытием, решение 16) |
| F10 | Окружение | `isTrusted`, `pointerType`, частота `pointermove`, видимость и фокус во время мини-игры | синтетические события; мини-игра решена при скрытой вкладке |

#### 16.3 Модель и пороги
- **Этап 1 (devnet-запуск, тень):** у каждого признака — логарифм отношения правдоподобия против базы людей (с отсечкой, чтобы один признак не решал всё) → сумма по группам `driving`, `minigame`, `cross-ride` → логистика → `humanScore 0..1` плюс топ‑3 «почему». Базы раздельные по `pointerType`, режиму доступности и классу таймера.
- **Этап 2 (после ≥ 1–2 тыс. поездок 1h):** градиентный бустинг на тех же признаках, объяснение через вклад признаков (SHAP) в админке. Пороги версионируются с `RULES_VERSION`.
- **База:** только реальные люди: поездки devnet-запуска в тени, команда и приглашённые тестеры с согласием. Синтетика в базу людей не идёт, она нужна только для TPR. ≈ 73 реальных входа сегодня — мало, отсюда тень и ручная проверка.
- **Цели ложных срабатываний** (как решение 15): ложный flag ≤ 2 %, ложный reject ≤ 0,1 % на базе. `T_ok` и `T_review` подбираются так, чтобы на базе это выполнялось с запасом (доверительный интервал). Тень — минимум вся неделя devnet-запуска плюс последующие тестовые поездки, в сумме ≥ 2 недели.

#### 16.4 Уровни вердикта
| Уровень | Условие | Что видит игрок |
|---|---|---|
| **verified** | `humanScore ≥ T_ok`, нет reject и flag по целостности | обычный результат |
| **review** (`flag human-review`) | `T_review ≤ score < T_ok`, или `mg-mechanical`, `mg-too-fast`, `untrusted-input`, F9-кластер | «на проверке», выплата ждёт ручного решения |
| **rejected** | целостность (§15.3) **или физически невозможное** (решение 27): (а) медиана RT < 100 мс на ≥ 10 неожиданных стимулах; (б) удержания с CV < 0,02 на ≥ 50 нажатиях при тонком таймере; (в) ≥ 90 % меток на точной сетке кадра без мкс-шума при тонком таймере; (г) совпадение ≥ 50 подряд интервалов с другой поездкой с точностью ≤ 1 мс; (д) курсор без промежуточных точек (телепорт к цели) в ≥ 3 мини-играх | код причины без порогов, апелляция |

Отдельно `score < T_review` без «невозможного» — это **review с высоким приоритетом**, а не reject.

#### 16.5 Тень → enforce
1. Тень (devnet-запуск): всё считается и пишется в `RideReplay`/`RideMiniGame`, на вердикт и выплаты не влияет. Еженедельный отчёт: распределения, FP на базе, TPR на ботах §17.
2. Калибровка порогов → бамп `RULES_VERSION`, `verdict:rejudge` по тени (уже есть CLI), сравнение «как было бы».
3. Enforce — позже, после тени и калибровки: review блокирует выплату до решения, reject — только по §16.4.

#### 16.6 Инструменты ручной проверки (топ‑20 и review)
- Админ-страница поездки (поверх существующих `ride-review.mjs`, `ride-audit.mjs`, `override-verdict`, `rejudge-ride` с подписью): таймлайн стимулов и RT против перцентилей базы; **проигрывание трасс мини-игр** (курсор поверх скриншота раскладки, скорость ×0,25–×2); графики dwell/flight; вклад признаков («почему»); соседи по кластеру F9; реплей из серверных поз.
- Решения: `approve` / `reject` / `request re-ride` (повторная поездка под наблюдением, по правилам devnet-запуска), всё подписывается и пишется в аудит.
- Регламент: два ревьюера на reject топ‑3; срок 48 ч (`reviewHours: 48` у тарифа 1h).

---

### 17. Тесты блока ботов: мини-игры, целостность, механика

Запуск: in-process (`server/test/anticheat/*.spec.ts`, фиктивные часы) на engine kernel, который генерирует события `inp`/`mg` синтетически; docker в реальном темпе — 1h-демо (`DEMO_SCALE=4` → 15 мин) ночью. UI мини-игр в fake DOM (`level-check`) может не собраться — тогда трассы на kernel, а Puppeteer позже (как решено). Флаг `MINIGAMES=shadow` в тестах проверяет и тень (вердикт не меняется, признаки пишутся), и `enforce`.

#### 17.2 Целостность и протокол
| ID | Атака | Ожидание |
|---|---|---|
| AC-W1 | **Удаление ям на клиенте** (как `e2e-road-check.mjs` B) | v1: `rejected obstacle-ignored` (регрессия сохраняется); v2.1: `world-collision-ignored` или реальный урон из пересчёта + `world-digest-mismatch` |
| AC-W2 | **Удаление машин** (`no-cars`, `no-cars-no-columns` из `e2e-traffic-proof.mjs`) | v1: `traffic-collision-ignored`; v2.1: `world-collision-ignored`/`world-digest-mismatch` |
| AC-W3 | Удаление станции или шлагбаума со сцены | `mg-station-skipped` + `world-digest-mismatch` → rejected; при проезде — `toll-barrier-breach` |
| AC-W4 | Noclip: отключены столкновения с барьером, бортом, машиной | `noclip-path` → rejected |
| AC-W5 | Константы физики ×1,3 мощность / ×2 тормоза / grip ×1,5 | `resim-mismatch` → rejected (закрывает #3, #4, #5) |
| AC-W6 | Ускорение игры ×1,2 (speed hack) | `400` бюджета или `speed-hack` → rejected |
| AC-W7 | Slow‑mo ×0,7 | `time-dilation` → rejected |
| AC-W8 | Ответ мини-игры с шагом раньше раскрытия / клиентские µs подкручены | `mg-answer-before-reveal` → rejected; `mg-timer-tamper` → review |
| AC-W9 | Правка батча после MAC; пересчёт SHA без ключа | `batch-mac-invalid` → `400` + rejected |
| AC-W10 | Склейка: батч из поездки A в поездку B | `batch-mac-invalid` (другой ключ и `rideId` в MAC) |
| AC-W11 | Повтор nonce / чужой nonce / ответ после `expiresAt` | `409` + `mg-nonce-replay` (flag); `400` + `mg-nonce-foreign` (reject); `410` |
| AC-W12 | Подмена ответов синхронизации часов (фальшивый `clientPerfUs`) | дрейф против часов шагов → `time-dilation` или `clock-jump` |
| AC-W13 | Оффлайн 60 с посреди мини-игры (честный) | `verified`, `mg-answer-late-network` только info — контроль FP |
| AC-W14 | Честный игрок в режиме доступности ×2 | `verified`, без `mg-too-fast`/`mechanical` — контроль FP |
| AC-W15 | Клиент v1 на поездке v2.1 | `409 client_outdated` |
| AC-W16 | Зритель пытается подарить яму или эффект (`POST watch/:id/donations` с `potholes`/`trench`/`sinkhole`/`night`/`day`, платный `donation-orders`) на текущую поездку | `404`/`410` (эндпоинт или эффект удалён, поездка не видна — решения 18, 33); мир поездки не меняется, вердикт не меняется |
| AC-W17 | Клиент сам «применяет» эффект (`effects/:eventId/applied`) или шлёт `event-*` в ввод | эндпоинт удалён → `404`; события в потоке отбрасываются; пересчёт их не видит |
| AC-W18 | Перепроверка (`verdict:rejudge`) старой поездки v0/v1 с подаренными ямами | судится своими правилами (`RULES_VERSION` поездки), коды `donated-obstacle-ignored` сохраняются только там |

#### 17.3 Новые позиции каталога (продолжение §5/§9.11)
| # | Чит | До | После §13–16 |
|---|---|---|---|
| 50 | Noclip через объекты | U | C (`noclip-path`) |
| 51 | Удаление станций и шлагбаумов | — | C (`world-digest-mismatch`, `mg-station-skipped`) |
| 52 | OCR- или LLM-бот мини-игр | — | U (review + ручная проверка; честный предел) |
| 53 | Повтор и подмена nonce | — | C |
| 54 | Склейка и подделка батчей вне сессии | N (SHA без ключа) | C (HMAC) |
| 55 | Подмена таймеров мини-игры | — | C/F (`mg-answer-before-reveal` / `mg-timer-tamper`) |
| 56 | Модифицированные константы физики | U/N (#3–5) | C (`resim-mismatch`) |
| 57 | Синтетические события из JS | N | F (`untrusted-input`) |
| 58 | Ферма ботов на разных кошельках | U | F (F9-кластер, топ‑20) |

> Тесты статистики рейтинга (AC-R1–R8) — §21.5, тесты точки финиша и калибровки (AC-F1–F11) — §22.6.

#### 17.4 Механика ввода на длинной поездке (дополнение к §10)
- AC-T13 `fatigue-free` — бот с идеальной стабильностью 60 мин → `review` (F8 + F1).
- AC-T14 `frame-locked` — события ровно на кадрах при тонком таймере → `rejected` (§16.4 в).
- AC-T15 `coarse-timer-human` — честный игрок с `privacy.resistFingerprinting` (таймер 16,7/100 мс) → `verified`, контроль FP для F5.
- AC-T16 `cluster-farm` — 10 кошельков, один и тот же бот с разными сидами шума → F9-кластер → `review` у всех.
- AC-H3 база людей 1h (с мини-играми) → ложный flag ≤ 2 %, reject = 0.

---

### 18. Оценка (человеко-дни) и что когда

> **Решение 11 (17.10) меняет фазы:** этапа «devnet-запуск в тени на v1» как отдельного объёма нет. Владелец делает v2 + мини-игры сразу в полном объёме («я все успею»). Поэтому §18.1 — это **порядок работ** (что первым), а «минимум» (решение 30) и урезание (32б) заменены. Оценка не меняется:
> - v2 + базовые мини-игры: **70–105 человеко-дней**;
> - со всем расширенным каталогом §13.9 (если всё одобрят): **103–151**;
> - снятие 4h/8h (решение 17) экономит ≈ 1–2 дня (замеры и перф 8h);
> - 30 Гц (решение 12) объём почти не меняет, но снижает риск по CPU сервера.
>
> Для справки: до devnet-запуска (09–15.11) ≈ 16 рабочих дней. **Сезоны пока не планируются** (решение владельца 17.10): всё, что не входит в devnet-запуск, — «позже», без дат. Риск записан и не оспаривается. Если к devnet-запуску v2 не готов к enforce, судить будет текущий v1 (он в main), а v2 включится, когда готов (`INPUT_REPLAY_REQUIRED`, §9.8).

Сегодня 17.10. До devnet-запуска ≈ 3 недели (регистрация 02.11, неделя 09–15.11). Дальше — «позже», сезоны пока не планируются.

#### 18.1 Первая очередь (devnet-запуск; по решению 11 — начало полного объёма)
| Шаг | Содержание | Оценка |
|---|---|---|
| P1 | Сессионный ключ на `/start` + HMAC батча **рядом** с SHA-цепочкой (v1 не ломаем) + `ack`/`serverMs` + пинги синхронизации в heartbeat | 2–3 |
| P2 | Доп. телеметрия внутри хешируемого текста v1 (новое необязательное поле `aux`): `isTrusted`, `pointerType`, `env`, `clk`, кодек | 2 |
| P3 | Каркас мини-игр: `mgSalt`, `mgCommit`, расписание и слоты, выдача в heartbeat, `POST …/answer`, `RideMiniGame`, штрафы выключены (`MINIGAMES=shadow`) | 4–5 |
| P4 | `phone-sms` на существующем телефоне (`phone.js`, `ui/map.js`): иконки, SMS, клавиатура, значение-картинка в кабине, трасса `mg` | 3–4 |
| P5 | Признаки F1, F2 (по ямам и машинам v1), F5–F7 офлайн-скриптом по записям тени + недельный отчёт | 3–4 |
| P6 | Тесты: AC-M1–M4, M8, W8–W11, W13, 1h-демо прогон; регрессия AC-W1/W2 на текущем коде | 3 |
| **Итого полный набор** | | **17–21** |
| ~~**Минимум (решение 30)**~~ — заменено решением 11 | P1 + P2 + P4 с упрощённым P3 (только `phone-sms`, без станций) + P5 офлайн | **11–14** |

#### 18.2 Вторая очередь (позже — enforce)
| Шаг | Содержание | Оценка |
|---|---|---|
| В1 | Станции как объекты мира в ядре (`client/shared`): АЗС, весы, платный участок со шлагбаумом, карман для стоянки; вставка в слоты по `mgSalt`; рендер; столкновения | 8–12 |
| В2 | UI и логика `fuel-station`, `weigh-station`, `toll-gate` (+ `cargo-seal`) | 5–7 |
| В3 | Протокол v2.1 полностью (бинарный кодек, deflate, `chk` с `worldDigest`, отказ от обязательных `samples`/`trafficProof`) — сверх Ф2 §9.12 | 3–4 |
| В4 | Коды целостности §15.3 в пересчёте (поверх Ф3 §9.12) | 3–4 |
| В5 | Полная модель §16 (F3, F4, F8, F9, F10), отдельные базы, пороги, enforce | 5–7 |
| В6 | Инструменты ревью §16.6 (трассы мини-игр, «почему», кластеры) | 3–4 |
| В7 | Доступность §13.7 + тексты правил, PRIVACY.md (трассы мыши и клавиш) | 2–3 |
| В8 | Тесты §17 полностью + ночные 1h-прогоны + golden v2.1 | 4–5 |
| **Итого сверх §9.12** | | **33–46** |

> **Расширенный каталог §13.9:** если все 11 кандидатов одобрены — **+33–46 человеко-дней** сверх этой таблицы (вместе с крипто-UI-китом 2–3). Решение 32(б) заменено решением 11, поэтому это не урезание, а **порядок**: первая волна `sign-or-reject` + `address-check` + `buy-shitcoin` + кит ≈ +9–12. Итого при всём одобренном: **103–151 человеко-дней**.

- Пересечение с §9.12 (Ф0/Ф2 протокол, Ф5 оценка человечности, Ф6 тесты) ≈ 10–14 дней, поэтому **v2 + этот слой вместе ≈ 70–105 человеко-дней** (минимум первой очереди 11–14 + §9.12 39–55 + §18.2 33–46 − пересечение 10–14). **Для одного разработчика к 11.01 это нереально** (≈ 12 недель ≈ 55–60 рабочих дней, а за вычетом других задач ещё меньше). Нужен второй разработчик или урезание (решение 32): например, `weigh-station` и `cargo-seal` — позже, ML этап 2 — позже.

---

