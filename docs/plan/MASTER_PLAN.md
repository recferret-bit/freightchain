# FreightChain — сводный план (ревью)

Версия 17.10.2026, раунд 13 (добавлен черновик Terms). Это сводка решений владельца. Подробности — в файлах по ссылкам (все пути от `/workspace/freightchain/`). Код не менялся.

**Содержание:** 0 Статус · 1 Сроки · 2 Токеномика · 3 Пулы и призы · 4 Сезоны · 5 Билеты и поездки · 6 Рефералка (Convoy) · 7 Аирдроп · 8 Anti-sybil и trust · 9 KYC и налоги · 10 Приватность, данные, юр. тексты · 11 Инфраструктура · 12 План изменений кода · 13 Документы в репозиторий · 14 Открытые вопросы · 15 Журнал аудита

---

## 0. Статус и ограничения

| Что | Состояние |
|---|---|
| `main` | `75ed4a06` (рефералка v1 влита) |
| PR #3 | `cursor/ten4-tokenomics-6271`, HEAD `a486c350`; слияние с `main` даёт 36 конфликтов |
| Git | **Никаких действий** (коммиты, push, ветки, комментарии в PR) — до команды владельца |
| Тесты и сборки | Запускает владелец локально; агенты не запускают |
| Деплой | Очистка devnet и деплой v5 — только по команде владельца |
| Публикации и рассылки | Только после одобрения владельца |
| Рабочие файлы | Локальные планы в `/workspace/freightchain/`, черновики документов в `docs_drafts/` |

## 1. Сроки

| Дата | Событие |
|---|---|
| после решения владельца | Мерж PR #3 (шаги 1–7, `pr3_update_plan.md`) |
| сразу после мержа, до 26.10.2026 | Очистка devnet и деплой pool v5 с новым program id (по команде) |
| пн 02.11.2026 00:00 UTC | Mainnet и старт Season 1 (7 недель) |
| 14.12 – вс 20.12 12:00 | Неделя 7: обычные доски + финал |
| с вт 22.12 | Выплаты недели 7 и финала |
| до 11.01.2027 | Перерыв |
| пн 11.01.2027 | Season 2 (по умолчанию 8 недель) |
| после конца Season 1 и снимка | TGE TEN4 и клейм аирдропа (merkle, окно 90 дней) |

## 2. Токеномика TEN4 v2

Детали: `ten4_tokenomics_v2.md`, черновик `docs_drafts/tokenomics/TEN4-v2.md`.

| Корзина | TEN4 | Механика |
|---|---:|---|
| Ликвидность | 15,000,000 | LP сжигается в `initialize` |
| Награды за поездки | 55,000,000 | Эры 27.5M → 13.75M → …; 75,000/день `>> era`; 2,000/день на кошелёк |
| Аирдроп | 8,000,000 | Season 1 = 2M, потолок 2,000 на кошелёк; merkle-клейм на TGE, 90 дней, затем сжигание |
| Рефералка | 4,000,000 | Свои эры 2M/1M/…; выплата `>> max(era_ref, era_ride)`; 60,000/мес глобально, 30,000/мес первые 3 месяца после `tge_at`; `burn_referral_tail` после эры 8 |
| Казна | 10,000,000 | Линейно 36 месяцев, без клиффа (`claim_treasury`) |
| Команда | 8,000,000 | **Включена**: клифф 12 мес + линейно 24 мес |
| **Итого** | **100,000,000** | Mint authority отзывается в `initialize` |

- **Вестинг команды:** встроенный в `freightchain_honk` (PR #3: `claim_team`, PDA `[b"team"]`, `TEAM_CLIFF_MONTHS = 12`, месяц = 30 дней, от `config.opened_at`, получатель неизменяемый, отмены нет). Вызов `initialize(team_enabled = true, team_linear_months = 24, team_recipient = мультисиг Squads команды)`. Streamflow и Squads Vesting не нужны.
- Переименование «Convoy goal 1,000» → **Depot Goal 1,000**.
- TEN4 за покупки друга и онбординг Grant упразднены (раунд 9).

## 3. Пулы и призы

Детали: `pool_unified_plan.md`, `docs_drafts/prize/POOLS.md`.

| Параметр | Значение |
|---|---|
| Формула | `F = B + S`; `P = min(0.40·R, $2,500, 0.90·F)`; `T = F + P + C` |
| База `B` | Ступени $300 / $750 / $1,500 / $3,000; ступень не сбрасывается между сезонами |
| Деление `T` | 85% доски / 5% перенос / 10% финал |
| Доски | 1h 25% / 4h 30% / 8h 45%; внутри доски 80% места, 20% пул финишёров |
| Перенос | Потолок `C ≤ 25% F`, излишек — в финал; без джекпотов |
| Доля игроков | ≤ 47.4% в любом пуле (проверка в коде) |
| Финал | Σ10% недель + `B_final = $1,000` + спонсор; топ-8 каждой доски |
| Финальная неделя | Обычные доски + финал; её 10% — в финал той же недели; её 5% и невыплаченное финала — в неделю 1 следующего сезона (потолок 25% F) |
| Бесплатные билеты | Призы ≤ 30% денег доски (`free_prize_board_cap_bps = 3000`), излишек следующему с купленным билетом, иначе в перенос |
| Модель | Конкурс мастерства (вариант B), не лотерея: без розыгрышей, тренировки не участвуют |
| Казна | Мультисиг Squads сейчас; эскроу USDC (pool v6) — Season 2–3 |
| Продажа билетов | **Solana Pay** в казну (`economy.TicketOrder`); программа как «касса» отклонена |
| Донаты | 100% водителю, рефералка их не касается |

## 4. Сезоны

Детали: `docs_drafts/seasons/README.md`.

- Season 1: `weeks = 7`, `finalWeek = 7`, старт 02.11.2026, `breakUntil = 2027-01-11`.
- Неделя: пн 00:00 – вс 12:00 UTC; проверка до пн 12:00, апелляции до вт 12:00, затем выплаты.
- Админка: CRUD сущности `prize.Season` + `prize.SeasonRulesVersion` (журнал и подпись); `SeasonService` заменяет `SEASON_EPOCH = '2026-10-12'`; рейтинговый старт вне сезона → 409.
- Денежные параметры (B, потолки, доли) хранятся в Season.

## 5. Билеты и поездки

Уже сделано в PR #3, сохранить при мерже (`pr3_update_plan.md`, шаг 1):

| Решение | Ключи / где |
|---|---|
| Недельный платный билет по тарифам | `weekly_ticket_1h_enabled = 1`, `weekly_ticket_1h_days = 7`; `weekly_ticket_4h_enabled = 0`, `_4h_days = 7`; `weekly_ticket_8h_enabled = 0`, `_8h_days = 7`. Неиспользованный сгорает в начале следующего интервала или в вс 12:00 UTC (что раньше). Коммит `a486c350` |
| Промокоды | Один эффект на код: бесплатная смена 1h / 4h / 8h (`PromoRideGrant`) |
| Тренировки | Безлимитные; не рейтинговые, без TEN4, без трансляции |
| Офлайн-режим | Заменён настоящей поездкой EASY (`play.html` → `easy-entry.js`, гостевая сессия) |
| Платные билеты | Solana Pay в казну (раздел 3) |

## 6. Рефералка (Convoy)

Детали: `referral_plan.md`, `docs_drafts/referral/README.md`.

| Элемент | Решение |
|---|---|
| Статусы | `pending` 72 ч (удаляется) → `active` (тест: verified MEDIUM/HARD, не EASY) 60 дней → `qualified` (M1) → `expired` |
| Подарок другу | Промо-поездка 1h после тестовой; лимиты 3/день и 10/нед на пригласившего, 500/нед глобально; один раз на кошелёк; не рейтинговая |
| Вехи TEN4 пригласившему | M1 = 100 (все шаги аирдропа + засчитанные рейсы в 2 разных ISO-неделях за 60 дней); M2 = 50 (5 разных недель); максимум 150 с друга |
| Засчитанный рейс | Платный тариф 1h/4h/8h, verified, рейтинговый; недельный билет засчитывается при trust друга ≥ 100 |
| Пригласивший | trust ≥ 50; 1,000 TEN4/мес; при лимите — сообщение, без начисления и очереди; удержание 48 ч |
| Слоты | `min(100, 5 + 2·A)`, A — друзья с ≥ 1 засчитанным рейсом за 30 дней |
| Рейтинг Convoy | Адрес или имя SNS, 25 строк, «ваше место», скрытие `convoyHidden` |
| Ограничения | Один уровень; без денег и долей с призов/донатов; программы для стримеров нет |
| Между кампаниями | Задания последней кампании — «шаги Convoy» |

## 7. Аирдроп

Детали: `docs_drafts/airdrop/README.md`.

- Season 1: 2M из 8M, потолок 2,000 TEN4 на кошелёк, клейм на TGE (merkle, квитанция `[b"airdrop", campaign, wallet]`, `burn_unclaimed` через 90 дней).
- Задания: обязательная тестовая поездка (MEDIUM/HARD), X (подписка; лайки и репосты не проверяются), Telegram, Discord.
- X через **twitterapi.io**, без OAuth: привязка постом-цитатой с личным кодом; бюджет `airdrop_twitterapi_budget_usd = 100` за кампанию; при сбое задания X «в ожидании», снимок переносится.
- Порог `airdrop_min_trust = 50`; 1 кошелёк на IP-кластер только при втором сигнале; Turnstile на привязке (за флагом).

## 8. Anti-sybil и trust

Детали: `decisions_trust.md`, `anti_sybil_wallet_checks.md`, `docs_drafts/referral/MULTI-ACCOUNT.md`.

| Блок | Решение |
|---|---|
| A | Игрой: +15 за день с финишем, максимум 2 дня в неделю, потолок 100 |
| B | Быстрые пути: покупка билета, Seeker (SGT) = +100; World ID — Season 2; Human Passport — нет |
| C | Призы по бесплатным билетам ≤ 30% доски |
| D | KYC Didit: бесплатный билет — любой приз; купленный — от $50 за сезон; удержание 72 ч; санкции Chainalysis (fail-closed) |
| E | Helius Developer $49/мес (`funded-by`); 404 — без штрафа, своя проверка |
| F | Показ игроку чек-листом (`trust_display_mode = checklist`) |
| G | IP-кластер: ipinfo Core, мобильные ASN исключены, штраф только со вторым сигналом |
| H | Пригласивший trust ≥ 50; аирдроп trust ≥ 50 |
| I | Глобальный лимит бесплатных стартов для низкого trust — ключ есть, выключен |
| Соцсети | X +20, Discord +15, Telegram +5, потолок 30 |
| Телеметрия | Стартовые пороги, теневой режим 2 недели, калибровка после запуска |
| IP | HMAC-SHA256(`IP_HASH_SECRET`, префикс /24 или /48), хранение 90 дней |
| Отпечаток браузера | Отклонён (`MULTI-ACCOUNT.md`, строка 7) |

## 9. KYC и налоги

Детали: `tax_thresholds.md`, `decisions_trust.md` D.

| Решение | Ключ |
|---|---|
| W-9 / W-8BEN при первой выплате, в одном флоу с Didit | `tax_form_required_on_first_payout = 1` |
| Годовой учёт по календарному году, включая TEN4 по FMV | `tax_year_basis = calendar`, `tax_include_ten4_fmv = 1` |
| 1099-MISC от $2,000 (2026) | `tax_1099_threshold_usd = 2000` |
| Сумма — gross | `tax_amount_basis = gross` |
| Удержание у нерезидентов выключено до консультации | `nra_withholding_enabled = 0` |
| KYC и выплаты | `payout_kyc_free_any = 1`, `payout_kyc_paid_season_cents = 5000`, `payout_hold_hours = 72`, `payout_sanctions_check = 1` |

## 10. Приватность, данные, юридические тексты

Детали: `docs_drafts/legal/PRIVACY.md`, `pr3_update_plan.md` шаг 4f.

| Тема | Решение |
|---|---|
| `player.SignIn` | Только `ipHash`, 90 дней; сырого IP и user-agent нет |
| Логи API и nginx | 30 дней |
| PostHog | Остаётся; опт-аут; 12 месяцев; DPA; `$ip` не передаётся |
| Живой чат | 90 дней; текст донатов обнуляется, платёжные записи остаются |
| ИИ-редактор | Без данных игроков (allowlist, `redactOutbound()`) |
| Стримы | Интеграции с Twitch нет; PRIVACY п. 13 это фиксирует |
| Возраст | 18+ |
| Cookies | Уведомление без баннера согласия (нет рекламных cookie; ЕС/UK заблокированы) |
| Terms | **Черновик готов**: `docs_drafts/legal/TERMS.md` (EN, шаблон, 28 разделов, 15 пунктов `[LAWYER]`, чек-лист, источники) — на проверку юристу |
| Согласие | Модалка 18+ и Accept при первом подключении; `termsVersion` по кошельку + журнал `player.TermsAcceptance`; при смене версии — повторное согласие, до него 428 `terms_required` на платное, призы, награды и выплаты; тренировки и EASY без согласия |
| Страницы | `/terms`, `/privacy`, `/rules` на apex (страницы Vite лендинга), ссылки в футере, на экране кошелька, в KYC и аирдропе |
| Official Rules | Не написаны под новую модель (в PR #3 старый черновик `docs/prize/OFFICIAL-RULES.md`); предложено следующим шагом |
| Обработчики в политике | Cloudflare, twitterapi.io, Didit, Helius, ipinfo, Chainalysis, PostHog |

## 11. Инфраструктура

Детали: `pr3_update_plan.md` шаг 4g и шаг 4f п. 6.

| Тема | Решение |
|---|---|
| Cloudflare | Free, прокси, Full (strict) + Origin CA (вместо Let's Encrypt) |
| Origin | Фаервол пускает только IP Cloudflare (без Tunnel) |
| Реальный IP | nginx `real_ip` из `CF-Connecting-IP`; `X-FC-Country` / `X-FC-Region` ставит nginx |
| Гео, edge | WAF блокирует страны: санкционные (`CU, IR, KP, SY`) + `GB`, ЕС-27, `IS, LI, NO` |
| Гео, сервер | 451 для регионов `UA-43`, `UA-14`, `UA-09` и штатов SC, AZ, LA, AR, DE, MT, TN (объём — п. 14); `GEO_SOURCE = edge \| ipinfo` |
| Turnstile | Только на привязках рефералки и аирдропа; `turnstile_enabled = 0` по умолчанию |
| Bot Fight Mode | Выключен до теста на staging |
| Сервисы | Helius Developer $49/мес, ipinfo Core, Chainalysis free API, Didit, twitterapi.io |

## 12. План изменений кода

Детали: `pr3_update_plan.md`. Каждый шаг — отдельный коммит (когда владелец разрешит git).

| Шаг | Содержание |
|---|---|
| 1 | Влить `main` → PR #3 (36 конфликтов), сохранить решения из раздела 5 |
| 2 | Переделка рефералки (`referral_plan.md`) |
| 3 | Корзина TEN4 4M в `freightchain_honk`; команда включена (`initialize` с `team_enabled = true`, 24 мес) |
| 4 | Pool v5 = v4 без рефералки (+ аудит `d5678764`, `abd24db7`), единая модель пулов, Solana Pay |
| 4b–4g | Рейтинг Convoy; сезоны; аирдроп; trust; приватность и гео; Cloudflare |
| 5 | Тексты и документация |
| 6 | Тесты — владелец локально |
| 7 | PR #3 → `main` по решению владельца |

**Миграции:** `20261104000000_referral_rework`, `20261104100000_referral_reward`, `20261104200000_seasons`, `20261105000000_prize_sponsor`, `20261105100000_ticket_orders`, `20261105200000_trust`, `20261105300000_tax`, `20261105400000_privacy` (+ `player.TermsAcceptance`), `20261107000000_airdrop`.

**Основные ключи** (полные таблицы — `decisions_trust.md` «Итоговые ключи», `referral_plan.md`):

| Группа | Ключи и значения |
|---|---|
| Недельный билет | `weekly_ticket_{1h,4h,8h}_enabled` 1/0/0, `_days` 7/7/7 |
| Рефералка | `referral_pending_ttl_hours` 72, `referral_qualify_window_days` 60, `referral_pending_base/_per_active/_max` 5/2/100, `referral_active_window_days` 30, `referral_ten4_m1_amount/_weeks` 100/2, `_m2_` 50/5, `referral_ten4_referrer_monthly` 1000, `referral_ten4_global_monthly` 60000, `referral_ten4_soft_start_monthly/_months` 30000/3, `referral_min_trust_referrer` 50, `referral_referee_promo_per_referrer_day/_week/_global_week` 3/10/500, `referral_referee_promo_ranked` 0, `referral_count_weekly_grant` 1 |
| Trust | `trust_threshold` 100, `trust_finish_points/_cap` 15/100, `trust_finish_days_per_week` 2, `trust_fast_paths` `paid,sgt`, `trust_social_cap` 30, `trust_ip_cluster_penalty` 50, `trust_display_mode` `checklist` |
| Anti-sybil | `antisybil_ip_retention_days` 90, `antisybil_ip_penalty_requires_second_signal` 1, `antisybil_ip_exclude_mobile_asn` 1, `antisybil_telemetry_shadow` 1 |
| Призы и выплаты | `free_prize_board_cap_bps` 3000, `payout_hold_hours` 72, `payout_kyc_paid_season_cents` 5000 |
| Аирдроп | `airdrop_min_trust` 50, `airdrop_twitterapi_budget_usd` 100 |
| Гео и edge | `geo_block_countries`, `geo_block_regions`, `geo_block_us_states_paid`, `turnstile_enabled` 0 |
| Приватность | `SIGNIN_RETENTION_DAYS=90`, `LOG_RETENTION_DAYS=30`, `LIVE_CHAT_RETENTION_DAYS=90`, `analytics_default_enabled` 1 |

**Контракты:**
- pool v5: убрать `referral_bps`, `referral_share`, `payout_cap`; `split` из трёх долей; IDL `metadata.version = 5`; новый program id на devnet.
- honk: `AIRDROP = 8M`, `REFERRAL = 4M`, `pay_referral`, `burn_referral_tail`, `set_airdrop_root`, `claim_airdrop`, `burn_unclaimed`; `claim_team` и `claim_treasury` без изменений.

## 13. Документы для репозитория

| Черновик | Куда в репо |
|---|---|
| `docs_drafts/tokenomics/TEN4-v2.md` | `docs/tokenomics/TEN4-v2.md` (+ `docs/honk/SPEC.md`) |
| `docs_drafts/prize/POOLS.md` | `docs/prize/POOLS.md` |
| `docs_drafts/seasons/README.md` | `docs/seasons/README.md` |
| `docs_drafts/referral/README.md` | `docs/referral/README.md` |
| `docs_drafts/referral/MULTI-ACCOUNT.md` | **Отдельно**: внутренний документ по мультиаккаунтам, не публикуется (пороги не раскрываем) |
| `docs_drafts/airdrop/README.md` | `docs/airdrop/README.md` |
| `docs_drafts/legal/PRIVACY.md` | Публичная страница после юриста |
| `docs_drafts/legal/TERMS.md` | `docs/legal/TERMS.md` → страница `/terms` после юриста |
| Official Rules (новые) | `docs/prize/OFFICIAL-RULES.md` → `/rules` — ещё не написаны |

## 14. Открытые вопросы

Полный список — `OPEN_QUESTIONS.md`.

| # | Вопрос | Кто решает |
|---|---|---|
| 1 | Official Rules, промо-механика рефералки, аирдроп, неофициальный API X (twitterapi.io) | Юрист |
| 2 | Финализация PRIVACY и TERMS (плейсхолдеры: юрлицо, адрес, контакты, версия, даты) | Юрист + владелец |
| 2в | TERMS: 15 пунктов `[LAWYER]` — возраст 19/21, исключённые лица, санкции, 7 штатов, возвраты при гео-блоке и закрытии, бесплатный вход и лимит 30%, удержание у нерезидентов, окно получения приза (90 дней?), Convoy, TEN4 как ценная бумага, отмена сезона, потолок ответственности, право и суд, арбитраж и отказ от коллективных исков, twitterapi.io | Юрист |
| 2г | Official Rules под единую модель пулов — написать (предложено) | Владелец даёт команду → агент → юрист |
| 2а | Объём блока в 7 штатах США: только платное и призы или весь вход | Юрист (рекомендация: только платное) |
| 2б | Санкционный список: добавлять ли RU, BY, VE и др. | Юрист |
| 3 | Нерезиденты (30% / 1042-S), gross/net, порог 2027 | Налоговый консультант |
| 4 | Суммы плат World ID (для Season 2) | Владелец, позже ⚠️ |
| 7 | Доля 404 у Helius `funded-by` | Замер после запуска ⚠️ |
| 8 | Калибровка порогов телеметрии после 2 недель тени | Команда после запуска |
| — | Адрес мультисига Squads команды (`team_recipient`) до `initialize` | Владелец |

## 15. Журнал аудита (раунд 12)

| # | Найдено | Исправлено |
|---|---|---|
| 1 | Команда «опционально», ветка supply 92M, «24 или 36 месяцев» | `ten4_tokenomics_v2.md`, `TEN4-v2.md`: включена, 12 + 24, 100M, механизм `claim_team` |
| 2 | Тесты LiteSVM «100M и 92M» | `pr3_update_plan.md` шаг 3, `ten4_tokenomics_v2.md`: только 100M + тест `claim_team`; параметры `initialize` и проверка суммы с `REFERRAL` |
| 3 | `[DECIDE]` о стримах в PRIVACY | П. 13: «интеграции стриминга нет, обновим при появлении»; заметка 12 |
| 4 | В OPEN_QUESTIONS нет решений по команде и Twitch | Раздел «Решено, раунд 12»; строки п. 2 и итогов обновлены |
| 5 | В плане не зафиксированы решения PR #3: недельный билет 1h/4h/8h + дни, конкурс без лотереи, промокоды, безлимитные тренировки, EASY вместо офлайна | Таблица в `pr3_update_plan.md` шаг 1 (сверено с `a486c350`) |
| 6 | `pool_unified_plan.md`: «финал копится до недели 8» (Season 1 — 7) | Неделя N, Season 1 — 7; 10% финальной недели в финал той же недели |
| 7 | `pool_unified_plan.md`: формулировки «если выбран» про кассу и Solana Pay | Отмечено как решено; «касса» отклонена |
| 8 | `anti_sybil_wallet_checks.md`: упоминание библиотеки отпечатка и ложная ссылка на «разделы 1–3» | Заменено ссылкой на `MULTI-ACCOUNT.md`, строка 7 |

Проверено без расхождений: эры и лимиты рефералки, слоты, 72 ч / 60 дней, M1/M2, пулы (0.4R, $2,500, 85/5/10, 25%, $1,000), Season 1 (7 недель, 02.11, финал 14–20.12, перерыв до 11.01), Solana Pay, Squads, Didit / $50 / 72 ч, налоговые ключи, IP HMAC 90 дней, Cloudflare (5 решений), twitterapi.io ($100), 18+, cookies. Слово «fingerprint» осталось только в `MULTI-ACCOUNT.md` строка 7 и в PRIVACY («не собираем»).

**Раунд 13:** добавлен `docs_drafts/legal/TERMS.md`. Сверено с PRIVACY (гео, соцсети, античит, третьи стороны, чат 90 дней, без отпечатка) и с планами (билеты, лимит 30%, KYC $50, удержание 72 ч, 1099 $2,000, Convoy, TEN4 100M, аирдроп 2,000 и 90 дней). В `pr3_update_plan.md` шаг 4f п. 7 добавлены маршруты страниц, `TERMS_VERSION`, журнал согласий, API и `TermsGuard`; в PRIVACY заметка 13 обновлена; в `OPEN_QUESTIONS.md` — п. 2в.
