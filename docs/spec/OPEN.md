# Открытые вопросы и решения на рассмотрении

> Единый источник правды по открытым вопросам (заменяет удалённый `docs/plan/OPEN_QUESTIONS.md` и [`MASTER_PLAN.md`](../plan/MASTER_PLAN.md) §14). Принятые решения 1–68 зафиксированы в [`DECISIONS.md`](DECISIONS.md) и [`README.md`](README.md). Внешние операционные задачи владельца с дедлайнами сведены в [`../plan/OWNER_TASKS.md`](../plan/OWNER_TASKS.md).

## 1. Сводная таблица открытых вопросов

| # | Вопрос | Статус / Кто решает | Связанный документ |
|---|---|---|---|
| **1** | Проверка `OFFICIAL_RULES.md`, промо-механики рефералки, аирдропа и рисков неофициального API X (`twitterapi.io`) | ⏳ Юрист к Season 1 | [`OWNER_TASKS.md`](../plan/OWNER_TASKS.md) §4.3 |
| **2** | Финализация [`PRIVACY.md`](../legal/PRIVACY.md), [`TERMS.md`](../legal/TERMS.md), [`OFFICIAL_RULES.md`](../legal/OFFICIAL_RULES.md) (реквизиты юрлица, адрес, контакты, даты, биометрия Didit / BIPA) | ⏳ Юрист + владелец к Season 1 | [`OWNER_TASKS.md`](../plan/OWNER_TASKS.md) §4.1, §4.3 |
| **2а** | Объём гео-блока в 7 штатах США (`SC, AZ, LA, AR, DE, MT, TN`): принят блок только платных билетов, призов, аирдропа и реферальных наград (`geo_block_us_states_paid`) | ✅ Решено (финально подтверждает юрист к S1) | [`TERMS.md`](../legal/TERMS.md) §3 |
| **2б** | Санкционный список стран и регионов к Season 1 (`CU, IR, KP, SY` + `UA-43, UA-14, UA-09`; статус RU, BY, VE и др.) | ⏳ Юрист к Season 1 | [`DEVNET_PRESEASON.md`](../plan/DEVNET_PRESEASON.md) §4.1 |
| **2в** | 15 пунктов `[LAWYER]` в [`TERMS.md`](../legal/TERMS.md) (возраст 19/21, исключённые лица, санкции, 7 штатов, возвраты при гео-блоке, лимит 30%, удержание у нерезидентов, окно приза, Convoy, TEN4, отмена сезона, потолок ответственности, право/суд, арбитраж/class-action waiver, twitterapi.io) | ⏳ Юрист к Season 1 | [`TERMS.md`](../legal/TERMS.md), [`legal.md`](legal.md) |
| **2г** | Черновик Official Rules Season 1 под единую модель пулов и динамическую таблицу финала | ✅ Написан в [`OFFICIAL_RULES.md`](../legal/OFFICIAL_RULES.md) → проверка юристом к S1 | [`pool.md`](pool.md) |
| **3** | Налоговый консультант США (1099-MISC box 3 vs W-2G / §4401, нерезиденты 30% / 1042-S, FTIN vs ITIN, gross vs net, FMV TEN4, FinCEN / VASP) | ⏳ Налоговый консультант к Season 1 | [`tax_thresholds.md`](../plan/research/tax_thresholds.md) §5–6 |
| **4** | Суммы плат World ID (для Season 2) | ⏳ Позже (к Season 2) | [`anticheat.md`](anticheat.md) Приложение D |
| **7** | Доля ответов 404 у Helius `funded-by` на живом трафике | ⏳ Замер после запуска | [`anticheat.md`](anticheat.md) Приложение D |
| **8** | Калибровка порогов телеметрии и анти-сибил после 2 недель в теневом режиме | ⏳ Команда после запуска | [`anticheat.md`](anticheat.md) |
| **9** | Режим денег несыгранных билетов в платном пуле Season 1 (выручка `R` при Solana Pay vs банк пула при on-chain `buy_ticket`) | ⏳ До открытия платных пулов (`POOL-M-11`) | [`pool.md`](pool.md), [`legal.md`](legal.md) `LEG-M-08` |
| **10** | Адреса мультисигов Squads казны и команды (`team_recipient`) до `initialize` на mainnet | ⏳ Владелец до mainnet | [`OWNER_TASKS.md`](../plan/OWNER_TASKS.md) §4.1 |
| **P1** | Организатор Pre-season — владелец-физлицо (решено); выбор юрлица для Season 1 — до **01.12.2026**, регистрация — до 20.12.2026 | ⏳ Владелец | [`operator_entity_options.md`](../plan/research/operator_entity_options.md), [`OWNER_TASKS.md`](../plan/OWNER_TASKS.md) §4.1 |
| **P2 / P9** | Консультация юриста по Pre-season (СНГ и Сербия: обязательные соц-задания как consideration, налоги и ответственность физлица) | ⏸ Отложено владельцем до Season 1 (принятый риск) | Раздел 2 ниже, [`operator_entity_options.md`](../plan/research/operator_entity_options.md) §6–7 |
| **P3** | Кошелёк события Pre-season на Solana mainnet ($500 USDC + ~0.15 SOL, публикация адреса в правилах) | ⏳ Владелец до 09.11.2026 | [`OWNER_TASKS.md`](../plan/OWNER_TASKS.md) §2.1 |
| **P5** | Назначение модераторов и антиспам-бота в RU Telegram-канал и чат, подстановка `[PLACEHOLDER]` в правила | ⏳ Владелец до 02.11.2026 | [`OWNER_TASKS.md`](../plan/OWNER_TASKS.md) §1.1 |

> Закрытые вопросы Pre-season (**P4** — очки шагов в аирдроп S1; **P6** — только RU+EN, второй devnet-ивент опционален после 24.11; **P7** — топ-20 проверяется анти-сибил + вручную + Chainalysis без Didit; **P8** — обязательны тест MEDIUM/HARD + Telegram + X с кодом) зафиксированы в [`DEVNET_PRESEASON.md`](../plan/DEVNET_PRESEASON.md) §9.

## 2. Вопросы юристу и налоговому консультанту к Season 1

### 2.1 Сербский юрист / консультант (по резидентству владельца)
Консультация отложена владельцем на после Pre-season (раунд 19); подробный разбор — [`operator_entity_options.md`](../plan/research/operator_entity_options.md) §6–7:
1. Считаются ли обязательные действия в соцсетях (подписка на Telegram-канал, участие в чате, пост с кодом в X) как единственное условие входа неденежным встречным предоставлением (*consideration*), и меняет ли это квалификацию бесплатного конкурса мастерства с призами по праву Сербии и стран участников (KZ, UZ, KG, AM, AZ, GE, MD, UA).
2. Налоговые и валютные обязательства налогового резидента Сербии (с ВНЖ) при выплате призов физлицам в USDC из собственных средств и при последующем учреждении иностранного юрлица к Season 1.

### 2.2 Международный / американский юрист (Terms, Privacy, Official Rules)
1. **Official Rules, рефералка и аирдроп:** проверка [`OFFICIAL_RULES.md`](../legal/OFFICIAL_RULES.md), промо-механики Convoy (фиксированные награды TEN4 не зависят от покупок друга) и условий TGE/аирдропа.
2. **Неофициальный API X (`twitterapi.io`):** оценка договорного/репутационного риска скрейпинга публичных постов и подписок без официального Enterprise API X, формулировки в [`TERMS.md`](../legal/TERMS.md) и [`PRIVACY.md`](../legal/PRIVACY.md).
3. **15 пунктов `[LAWYER]` в [`TERMS.md`](../legal/TERMS.md) и биометрия в [`PRIVACY.md`](../legal/PRIVACY.md):** подтверждение формулировок BIPA / GDPR по провайдеру KYC Didit, праву на отказ от дистанционной покупки билета (`LEG-M-07`) и арбитражной оговорки.

### 2.3 Налоговый консультант США
Полный перечень — [`tax_thresholds.md`](../plan/research/tax_thresholds.md) §6:
1. Квалификация выплат: призы конкурса мастерства (1099-MISC box 3, порог $2,000 с 2026 г.) vs W-2G и акциз IRC §4401/§4411 (по аналогии с IRS AM 2020-009 по DFS).
2. Призы нерезидентам США (NRA): возникает ли U.S.-source FDAP при иностранном или американском операторе, нужно ли 30% удержание и форма 1042-S, достаточно ли иностранного ИНН (FTIN) в W-8BEN.
3. Считать ли порог $2,000 по gross-выплатам или net (за вычетом стоимости билетов), и как учитывать FMV токенов TEN4 при клейме на TGE.
4. Отсутствие статуса FinCEN money transmitter / VASP при некастодиальном смарт-контракте эскроу и при казначейской модели Solana Pay.

