# FreightChain — сводный план (ревью)

Версия 17.10.2026, раунд 19 (Pre-season на devnet, перенос Season 1 на 11.01.2027, Pool v5 реализован в коде). Это сводка решений владельца. Подробности — в файлах `docs/plan/*` и `docs/legal/*` (см. `docs/plan/README.md`).

**Содержание:** 0 Статус · 1 Сроки · 2 Токеномика · 3 Пулы и призы · 4 Сезоны · 5 Билеты и поездки · 6 Рефералка (Convoy) · 7 Аирдроп · 8 Anti-sybil и trust · 9 KYC и налоги · 10 Приватность, данные, юр. тексты · 11 Инфраструктура · 12 План изменений кода · 13 Документы в репозиторий · 14 Открытые вопросы · 15 Журнал аудита

---

## 0. Статус и ограничения

| Что | Состояние |
|---|---|
| `main` | PR #3 (`cursor/ten4-tokenomics-6271`) влит в `main` вместе с Pool Program v5 (`programs/freightchain_pools`), `programs/freightchain_honk`, недельным конкурсом мастерства (`server/src/domain/prize/`), промо-поездками, EASY, `docs/plan/`, `docs/legal/` |
| PR #3 | ✅ Влит в `main` (`SEASON_WEEKS = 7`, `LIVE_FINAL_WEEK = 7`, равное деление ничьих и ничьи на границе топ-8 согласованы в `server/src/domain/prize/`) |
| Pool Program v5 | **Реализован и покрыт тестами в репо** (`Config 167`, `Series 132`, `Pool 362`, `set_pool_rules`, `8500/500/1000`, `max_player_share_bps <= 4999`, `paid_tickets_enabled`; 163 Rust-теста + unit/integration тесты сервера) |
| Деплой | Очистка devnet и деплой v5 — только по команде владельца |
| Публикации и рассылки | Только после одобрения владельца |
| Документы в репо | Планы в `docs/plan/`, юридические шаблоны в `docs/legal/` |

## 1. Сроки

| Дата | Событие |
|---|---|
| ✅ выполнено | Мерж PR #3 в `main` (шаги 1 и 4; остальные шаги Season 1 — по [`DEVNET_PRESEASON.md`](DEVNET_PRESEASON.md) §7 и §12 ниже) |
| по команде владельца (рекомендовано после Pre-season, см. §12 G17) | Очистка devnet и деплой pool v5 с новым program id (код v5 уже в репо; для Pre-season не обязателен) |
| пн 02.11.2026 | **Pre-season (devnet):** регистрация, обязательные шаги кампании (тестовая поездка + Telegram + X: подписка и пост с кодом) |
| пн 09.11 – вс 15.11 12:00 | Pre-season: призовая неделя, одна доска 1h, 1 попытка, фонд $500 |
| до пн 16.11 12:00 / до вт 17.11 12:00 | Pre-season: проверка / апелляции |
| с вт 17.11 | Pre-season: выплаты USDC на mainnet лично от владельца-организатора с кошелька события (ручная проверка топ-20 без документов, санкции Chainalysis, удержание 72 ч; налоговых форм нет) |
| до 01.12 / до 20.12.2026 | Выбор и регистрация юрлица-оператора (нужно для Season 1: платные билеты, TGE, полные Terms) |
| пн 11.01.2027 00:00 UTC | **Mainnet и старт Season 1** (7 недель; было 02.11.2026) |
| 22.02 – вс 28.02.2027 12:00 | Неделя 7: обычные доски + финал |
| с вт 02.03.2027 | Выплаты недели 7 и финала |
| 01.03 – 14.03.2027 | Перерыв (2 недели, решено) |
| пн 15.03.2027 | Season 2 (по умолчанию 8 недель) |
| после 28.02.2027 и снимка (не раньше марта 2027) | TGE TEN4 и клейм аирдропа (merkle, окно 90 дней) |

## 2. Токеномика TEN4 v2

Спецификация: [`../spec/ten4.md`](../spec/ten4.md) · публичная страница: [`../tech/ten4/index.html`](../tech/ten4/index.html).

| Корзина | TEN4 | Механика |
|---|---:|---|
| Ликвидность | 15,000,000 | LP сжигается в `initialize` |
| Награды за поездки | 55,000,000 | Эры 27.5M → 13.75M → …; 75,000/день `>> era`; 2,000/день на кошелёк |
| Аирдроп | 8,000,000 | Season 1 = 2M, потолок 2,000 на кошелёк; merkle-клейм на TGE, 90 дней, затем сжигание |
| Рефералка | 4,000,000 | Свои эры 2M/1M/…; выплата `>> max(era_ref, era_ride)`; 60,000/мес глобально, 30,000/мес первые 3 месяца после `tge_at`; `burn_referral_tail` после эры 8 |
| Казна | 10,000,000 | Линейно 36 месяцев, без клиффа (`claim_treasury`) |
| Команда | 8,000,000 | **Включена**: клифф 12 мес + линейно 24 мес |
| **Итого** | **100,000,000** | Mint authority отзывается в `initialize` |

- **Вестинг команды:** встроенный в `freightchain_honk` (`claim_team`, PDA `[b"team"]`, `TEAM_CLIFF_MONTHS = 12`, месяц = 30 дней, от `config.opened_at`, получатель неизменяемый, отмены нет). Вызов `initialize(team_enabled = true, team_linear_months = 24, team_recipient = мультисиг Squads команды)`. Streamflow и Squads Vesting не нужны.
- Переименование «Convoy goal 1,000» → **Depot Goal 1,000**.
- TEN4 за покупки друга и онбординг Grant упразднены (раунд 9).

## 3. Пулы и призы

> Целевой недельный формат пула (вт вечер → вс вечер + 1,5 дня проверки), отмена эффектов донатов и динамический рейтинг 1h-поездки зафиксированы в [`../spec/pool.md`](../spec/pool.md), [`../spec/rides.md`](../spec/rides.md) и [`../spec/replays_streams.md`](../spec/replays_streams.md). Текущая реализация доски призов на `main` (`server/src/domain/prize/prize-rules.ts`) описана в [`../spec/pool.md`](../spec/pool.md) Приложение C.

| Параметр | Значение |
|---|---|
| Формула | `F = B + S`; `P = min(0.40·R, $2,500, 0.90·F)`; `T = F + P + C` |
| База `B` | Ступени $300 / $750 / $1,500 / $3,000; ступень не сбрасывается между сезонами |
| Деление `T` | 85% доски / 5% перенос / 10% финал |
| Доски | 1h 25% / 4h 30% / 8h 45%; внутри доски 80% места, 20% пул финишёров |
| Ничьи | Решено: без тай-брейка по адресу кошелька; равные результаты делят сумму занятых мест поровну — на всех досках (Pre-season, Season 1+, финал) |
| Перенос | Потолок `C ≤ 25% F`, излишек — в финал; без джекпотов |
| Доля игроков | ≤ 47.4% в любом пуле (проверка в коде) |
| Финал | Σ10% недель + `B_final = $1,000` + спонсор; топ-8 каждой доски, при равенстве на границе проходят все с той же суммой мест (решено; финалистов может быть > 8) |
| Финальная неделя | Обычные доски + финал; её 10% — в финал той же недели; её 5% и невыплаченное финала — в неделю 1 следующего сезона (потолок 25% F) |
| Бесплатные билеты | Призы ≤ 30% денег доски (`free_prize_board_cap_bps = 3000`), излишек следующему с купленным билетом, иначе в перенос |
| Модель | Конкурс мастерства (вариант B), не лотерея: без розыгрышей, тренировки не участвуют |
| Казна | Мультисиг Squads сейчас; эскроу USDC (pool v6) — Season 2–3 |
| Продажа билетов | **Solana Pay** в казну (`economy.TicketOrder`); программа как «касса» отклонена |
| Донаты | 100% водителю, рефералка их не касается |

## 4. Сезоны

Спецификация: [`../spec/pool.md`](../spec/pool.md) · план Pre-season: [`DEVNET_PRESEASON.md`](DEVNET_PRESEASON.md).

- **Pre-season (devnet):** регистрация с 02.11.2026, неделя 09–15.11, выплаты с 17.11; сезон `weeks = 1` без финала (или ключи `event_*`); фонд $500, топ-20 (100 / 70 / 50 / 2×30 / 5×20 / 10×12), ничьи делятся поровну. План и ранбук — [`DEVNET_PRESEASON.md`](DEVNET_PRESEASON.md).
- Season 1 (mainnet): старт **11.01.2027**, `weeks = 7`, `finalWeek = 7` (22–28.02.2027), выплаты с 02.03, `breakUntil = 2027-03-15` (перерыв 01–14.03 — решено); Season 2 — 15.03.2027 (решено).
- Неделя: пн 00:00 – вс 12:00 UTC (целевое расписание вт–вс — см. [`../spec/pool.md`](../spec/pool.md) `POOL-M-01`); проверка до пн 12:00, апелляции до вт 12:00, затем выплаты.
- Админка: CRUD сущности `prize.Season` + `prize.SeasonRulesVersion` (журнал и подпись); `SeasonService` заменяет `SEASON_EPOCH = '2026-10-12'`; рейтинговый старт вне сезона → 409.
- Денежные параметры (B, потолки, доли) хранятся в Season.

## 5. Билеты и поездки

> Целевые правила типов поездок и билетов (только 1h в рейтинге) — [`../spec/rides.md`](../spec/rides.md) и [`../spec/promocodes.md`](../spec/promocodes.md). Реализовано на `main`:

| Решение | Ключи / где |
|---|---|
| Недельный платный билет по тарифам | `weekly_ticket_1h_enabled = 1`, `weekly_ticket_1h_days = 7`; `weekly_ticket_4h_enabled = 0`, `_4h_days = 7`; `weekly_ticket_8h_enabled = 0`, `_8h_days = 7`. Неиспользованный сгорает в начале следующего интервала или в вс 12:00 UTC (что раньше). Коммит `a486c350` |
| Промокоды | Один эффект на код: бесплатная смена 1h / 4h / 8h (`PromoRideGrant`, см. [`../spec/promocodes.md`](../spec/promocodes.md)) |
| Тренировки | Безлимитные; не рейтинговые, без TEN4, без трансляции |
| Офлайн-режим | Заменён настоящей поездкой EASY (`play.html` → `easy-entry.js`, гостевая сессия) |
| Платные билеты | Solana Pay в казну (раздел 3) |

## 6. Рефералка (Convoy)

Спецификация: [`../spec/referral.md`](../spec/referral.md) §2.

| Элемент | Решение |
|---|---|
| Статусы | `pending` 72 ч (удаляется) → `active` (тест: verified MEDIUM/HARD, не EASY) 60 дней → `qualified` (M1) → `expired` |
| Подарок другу | Промо-поездка 1h после тестовой; лимиты 3/день и 10/нед на пригласившего, 500/нед глобально; один раз на кошелёк; не рейтинговая |
| Вехи TEN4 пригласившему | M1 = 100 (все обязательные шаги кампании аирдропа + засчитанные рейсы в 2 разных ISO-неделях за 60 дней); M2 = 50 (5 разных недель); максимум 150 с друга |
| Засчитанный рейс | Платный тариф 1h/4h/8h, verified, рейтинговый; недельный билет засчитывается при trust друга ≥ 100 |
| Пригласивший | trust ≥ 50; 1,000 TEN4/мес; при лимите — сообщение, без начисления и очереди; удержание 48 ч |
| Слоты | `min(100, 5 + 2·A)`, A — друзья с ≥ 1 засчитанным рейсом за 30 дней |
| Рейтинг Convoy | Адрес или имя SNS, 25 строк, «ваше место», скрытие `convoyHidden` |
| Ограничения | Один уровень; без денег и долей с призов/донатов; программы для стримеров нет |
| Между кампаниями | Задания последней кампании — «шаги Convoy» |

## 7. Аирдроп

Спецификация: [`../spec/ten4.md`](../spec/ten4.md) §4.2 · Pre-season задания: [`DEVNET_PRESEASON.md`](DEVNET_PRESEASON.md) §11.

- Season 1: 2M из 8M, потолок 2,000 TEN4 на кошелёк, клейм на TGE (merkle, квитанция `[b"airdrop", campaign, wallet]`, `burn_unclaimed` через 90 дней). Снимок после конца Season 1 (28.02.2027), TGE не раньше марта 2027.
- **Набор обязательных шагов задаётся на кампанию** (`requiredTasks`). Pre-season (раунд 19): обязательны тестовая поездка + Telegram (канал и чат) + X (подписка на @FreightChainSol + пост об участии с личным кодом); Discord по желанию; очки Pre-season засчитываются в Season 1 (вопрос владельцу — подтвердить). Вехи Convoy M1/M2 требуют обязательный набор текущей кампании.
- Задания: обязательная тестовая поездка (MEDIUM/HARD), X (подписка; лайки и репосты не проверяются), Telegram, Discord.
- X через **twitterapi.io**, без OAuth: привязка постом-цитатой с личным кодом; бюджет `airdrop_twitterapi_budget_usd = 100` за кампанию; при сбое задания X «в ожидании», снимок переносится.
- Порог `airdrop_min_trust = 50`; 1 кошелёк на IP-кластер только при втором сигнале; Turnstile на привязке (за флагом).

## 8. Anti-sybil и trust

Спецификация: [`../spec/anticheat.md`](../spec/anticheat.md) (Приложение D) · проверка топ-20 Pre-season: [`DEVNET_PRESEASON.md`](DEVNET_PRESEASON.md) §14.

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
| Отпечаток браузера | Отклонён ([`../spec/anticheat.md`](../spec/anticheat.md) Приложение D) |

## 9. KYC и налоги

Исследование и расчёты: [`research/tax_thresholds.md`](research/tax_thresholds.md) · спецификация: [`../spec/legal.md`](../spec/legal.md).

| Решение | Ключ |
|---|---|
| W-9 / W-8BEN при первой выплате, в одном флоу с Didit | `tax_form_required_on_first_payout = 1` |
| Годовой учёт по календарному году, включая TEN4 по FMV | `tax_year_basis = calendar`, `tax_include_ten4_fmv = 1` |
| 1099-MISC от $2,000 (2026) | `tax_1099_threshold_usd = 2000` |
| Сумма — gross | `tax_amount_basis = gross` |
| Удержание у нерезидентов выключено до консультации | `nra_withholding_enabled = 0` |
| KYC и выплаты | `payout_kyc_free_any = 1`, `payout_kyc_paid_season_cents = 5000`, `payout_hold_hours = 72`, `payout_sanctions_check = 1` |

## 10. Приватность, данные, юридические тексты

Спецификация: [`../spec/legal.md`](../spec/legal.md) · живые тексты: [`../legal/PRIVACY.md`](../legal/PRIVACY.md), [`../legal/TERMS.md`](../legal/TERMS.md), [`../legal/OFFICIAL_RULES.md`](../legal/OFFICIAL_RULES.md), [`../legal/PRESEASON_RULES.md`](../legal/PRESEASON_RULES.md).

| Тема | Решение |
|---|---|
| `player.SignIn` | Только `ipHash`, 90 дней; сырого IP и user-agent нет |
| Логи API и nginx | 30 дней |
| PostHog | Остаётся; опт-аут; 12 месяцев; DPA; `$ip` не передаётся |
| Живой чат | 90 дней; текст донатов обнуляется, платёжные записи остаются |
| ИИ-редактор | Без данных игроков (allowlist, `redactOutbound()`) |
| Стримы | Интеграции с Twitch нет; PRIVACY п. 13 это фиксирует |
| Возраст | 18+ (или возраст совершеннолетия в юрисдикции участника, если выше) |
| Аудитория и язык | Англоязычная; для Pre-season добавлены СНГ и русский (RU/EN: лендинг, лобби, аирдроп, страница события; HUD игры — EN) |
| Cookies | Уведомление без баннера согласия (нет рекламных cookie; ЕС/UK заблокированы) |
| Terms | **Черновик готов**: [`../legal/TERMS.md`](../legal/TERMS.md) (EN, шаблон, 28 разделов, 15 пунктов `[LAWYER]`, чек-лист, источники) — на проверку юристу |
| Согласие | Модалка 18+ и Accept при первом подключении; `termsVersion` по кошельку + журнал `player.TermsAcceptance`; при смене версии — повторное согласие, до него 428 `terms_required` на платное, призы, награды и выплаты; тренировки и EASY без согласия |
| Страницы | `/terms`, `/privacy`, `/rules` на apex (страницы Vite лендинга), ссылки в футере, на экране кошелька, в KYC и аирдропе |
| Pre-season, вход | Решено: призовая попытка — **только** за обязательные задания аирдропа, другого бесплатного входа нет. Риск: обязательные действия в соцсетях могут считаться неденежным consideration — вопрос сербскому юристу. «Репост» = цитата с личным кодом; обязательный набор (раунд 19) — тест + Telegram (канал и чат) + X подписка + пост об участии с кодом; Discord по желанию |
| Pre-season | Организатор — владелец-физлицо (без юрлица); короткие правила и уведомление о данных — [`../legal/PRESEASON_RULES.md`](../legal/PRESEASON_RULES.md); полные Terms/Privacy — с Season 1 |
| Official Rules | ✅ Шаблон Season 1 готов в [`../legal/OFFICIAL_RULES.md`](../legal/OFFICIAL_RULES.md) (сверено с `server/src/domain/prize/` и [`../spec/pool.md`](../spec/pool.md)) — на проверку юристу |
| Обработчики в политике | Cloudflare, twitterapi.io, Didit, Helius, ipinfo, Chainalysis, PostHog |

## 11. Инфраструктура

Спецификация: [`../spec/admin_security.md`](../spec/admin_security.md), [`../spec/legal.md`](../spec/legal.md) (`LEG-M-01..03`), [`../tech/configuration.md`](../tech/configuration.md).

| Тема | Решение |
|---|---|
| Cloudflare | Free, прокси, Full (strict) + Origin CA (вместо Let's Encrypt) |
| Origin | Фаервол пускает только IP Cloudflare (без Tunnel) |
| Реальный IP | nginx `real_ip` из `CF-Connecting-IP`; `X-FC-Country` / `X-FC-Region` ставит nginx |
| Гео, edge | WAF блокирует страны: санкционные (`CU, IR, KP, SY`) + `GB`, ЕС-27, `IS, LI, NO` |
| Гео, Pre-season | Призы: KZ, UZ, KG, AM, AZ, GE, MD, UA (без UA-43/14/09) и прочие допущенные; RU/BY — игра без призов до юриста |
| Гео, сервер | 451 для регионов `UA-43`, `UA-14`, `UA-09` и штатов SC, AZ, LA, AR, DE, MT, TN (объём — п. 14); `GEO_SOURCE = edge \| ipinfo` |
| Turnstile | Только на привязках рефералки и аирдропа; `turnstile_enabled = 0` по умолчанию |
| Bot Fight Mode | Выключен до теста на staging |
| Сервисы | Helius Developer $49/мес, ipinfo Core, Chainalysis free API, Didit, twitterapi.io |

## 12. План изменений кода и статус гэпов (G1–G21)

| Шаг | Содержание |
|---|---|
| 1 | ✅ Влить PR #3 в `main`, сохранить решения из раздела 5 и согласовать `SEASON_WEEKS = 7` + равное деление ничьих в `server/src/domain/prize/` |
| 2 | Переделка рефералки ([`../spec/referral.md`](../spec/referral.md) §2) |
| 3 | ✅ Корзина TEN4 8M аирдроп + 4M рефералка в `freightchain_honk` (`pay_referral`, `burn_referral_tail`, `set_airdrop_root`, `claim_airdrop`, `burn_unclaimed`); команда включена (`initialize` с `team_enabled = true`, 24 мес; 40 Rust-тестов + unit-тесты `tokenomics.spec.ts`) |
| 4 | ✅ Pool v5 = v4 без рефералки (+ аудит `d5678764`, `abd24db7`), единая модель пулов (`unifiedWeekPool`, `capRolloverCents`, потолок 30% бесплатных билетов в `settleBoard`, динамический финал `settleSeasonFinal` на `N` финалистов — **реализовано и протестировано в `programs/freightchain_pools` и `server/src/domain/prize/`**); Solana Pay (`G26`) |
| 4b–4g | Рейтинг Convoy; сезоны; аирдроп; trust; приватность и гео; Cloudflare |
| 5 | Тексты и документация |
| 6 | Тесты — локальный и браузерный контур ([`../testing/COVERAGE_CONTRACT.md`](../testing/COVERAGE_CONTRACT.md), [`../testing/IMPLEMENTATION_PLAN.md`](../testing/IMPLEMENTATION_PLAN.md)) |
| 7 | ✅ PR #3 влит в `main` |

**Запланированные миграции БД (Season 1 / реворк):** `20261104000000_referral_rework`, `20261104100000_referral_reward`, `20261104200000_seasons`, `20261105000000_prize_sponsor`, `20261105100000_ticket_orders`, `20261105200000_trust`, `20261105300000_tax`, `20261105400000_privacy` (+ `player.TermsAcceptance`), `20261107000000_airdrop`.

**Сводка новых ключей `player.GameSetting` (детали в §§5–11 и [`../tech/configuration.md`](../tech/configuration.md)):**

| Группа | Ключи и значения |
|---|---|
| Недельный билет (§5) | `weekly_ticket_{1h,4h,8h}_enabled` 1/0/0, `_days` 7/7/7 |
| Рефералка (§6) | `referral_pending_ttl_hours` 72, `referral_qualify_window_days` 60, `referral_pending_base/_per_active/_max` 5/2/100, `referral_active_window_days` 30, `referral_ten4_m1_amount/_weeks` 100/2, `_m2_` 50/5, `referral_ten4_referrer_monthly` 1000, `referral_ten4_global_monthly` 60000, `referral_ten4_soft_start_monthly/_months` 30000/3, `referral_min_trust_referrer` 50, `referral_referee_promo_per_referrer_day/_week/_global_week` 3/10/500, `referral_referee_promo_ranked` 0, `referral_count_weekly_grant` 1 |
| Trust и Anti-sybil (§8) | `trust_threshold` 100, `trust_finish_points/_cap` 15/100, `trust_finish_days_per_week` 2, `trust_fast_paths` `paid,sgt`, `trust_social_cap` 30, `trust_ip_cluster_penalty` 50, `trust_display_mode` `checklist`, `antisybil_ip_retention_days` 90, `antisybil_ip_penalty_requires_second_signal` 1, `antisybil_ip_exclude_mobile_asn` 1, `antisybil_telemetry_shadow` 1 |
| Призы, выплаты и аирдроп (§3, §7, §9) | `free_prize_board_cap_bps` 3000, `payout_hold_hours` 72, `payout_kyc_paid_season_cents` 5000, `airdrop_min_trust` 50, `airdrop_twitterapi_budget_usd` 100 |
| Гео и приватность (§10, §11) | `geo_block_countries`, `geo_block_regions`, `geo_block_us_states_paid`, `turnstile_enabled` 0, `SIGNIN_RETENTION_DAYS=90`, `LOG_RETENTION_DAYS=30`, `LIVE_CHAT_RETENTION_DAYS=90`, `analytics_default_enabled` 1 |

### Сводка гэпов запуска (G1–G21)

#### P0 — Блокеры запуска Pre-season (регистрация 02.11, призовая неделя 09–15.11.2026)

| # | Где | Статус / Что нужно | Кто |
|---|---|---|---|
| **G1** | Инфра: `deploy/nginx/`, `server/src/main.ts` | **Включить прокси Cloudflare (оранжевое облако)**, `set_real_ip_from` только диапазоны Cloudflare, `real_ip_header CF-Connecting-IP`, передать `X-FC-Country: $http_cf_ipcountry` (иначе клиент может подделать `X-FC-Country`) | Код + Владелец (DNS, [`OWNER_TASKS.md`](OWNER_TASKS.md) §1.2) |
| **G2–G3, G6–G11, G13–G14, G16** | Режим события, правила RU/EN, Telegram+X, ранбук топ-20, словарь RU/EN, гео-статус, 18+/Terms, выплаты USDC, кран devnet | ✅ **Специфицировано** в [`DEVNET_PRESEASON.md`](DEVNET_PRESEASON.md) Часть II (§10–16), [`../legal/PRESEASON_RULES.md`](../legal/PRESEASON_RULES.md), [`../legal/PRESEASON_RULES_RU.md`](../legal/PRESEASON_RULES_RU.md). Реализация кода — задачи C2–C8 в [`DEVNET_PRESEASON.md`](DEVNET_PRESEASON.md) §7; внешние ключи — [`OWNER_TASKS.md`](OWNER_TASKS.md) §1–3 | Код (C2–C8) + Владелец |
| **G4 / G4a** | Организатор и юрлицо | ✅ Pre-season проводит владелец как физлицо-организатор (принятый риск, [`research/operator_entity_options.md`](research/operator_entity_options.md) §6–7). К Season 1: выбор юрлица до **01.12.2026**, регистрация до **20.12.2026** | Владелец ([`OWNER_TASKS.md`](OWNER_TASKS.md) §4.1) |
| **G5** | Юридическая проверка | ⏸ Отложено владельцем до Season 1 (принятый риск). Список вопросов юристу и налоговому консультанту — [`../spec/OPEN.md`](../spec/OPEN.md) §2 | Владелец → юрист к S1 |
| **G12** | Devnet RPC и кошелёк события | Выделенный Helius devnet RPC (до 02.11) и отдельный кошелёк события на Solana mainnet с `$500 USDC + ~0.15 SOL` (до 09.11) | Владелец ([`OWNER_TASKS.md`](OWNER_TASKS.md) §1.3, §2.1) |

#### P1 / P2 — Задачи к Season 1 (mainnet 11.01.2027) и согласование документации

| # | Где | Статус / Что нужно |
|---|---|---|
| **G15** | Токеномика команды в БД | ✅ Контракт `freightchain_honk` готов (`team_enabled = true`, 24 мес); при подключении mainnet-индексатора добавить корзину `team` в `tokenomics.ts` |
| **G17** | Деплой `freightchain_pools` v5 на devnet | ✅ Код v5 и 163 теста готовы в репо; деплой на devnet с новым program id — по команде владельца ([`../tech/program-deploy.md`](../tech/program-deploy.md)) |
| **G18** | Расписание недели (вт–вс vs пн–вс) | В [`../spec/pool.md`](../spec/pool.md) `POOL-M-01` целевой формат — вт вечер → вс вечер + 1,5 дня проверки; перед Season 1 синхронизировать параметры пула и текст [`../legal/OFFICIAL_RULES.md`](../legal/OFFICIAL_RULES.md) |
| **G19–G20** | Счётчик 44 vs 34 значков cNFT и даты в питч-деке | Перед Season 1 синхронизировать число SVG-значков в `landing/src/pitchdeck/data.js` (`ACH`) и лендинге |
| **G21** | Валидация секретов при включённых флагах | В `env.schema.ts` требовать секреты (`TURNSTILE_SECRET_KEY`, `TELEGRAM_BOT_TOKEN`, `TWITTERAPI_KEY`, `CHAINALYSIS_API_KEY`) когда соответствующий флаг включён |

## 13. Документы в репозитории

| Область | Актуальный файл в репо |
|---|---|
| Токеномика TEN4 и гараж | [`docs/spec/ten4.md`](../spec/ten4.md), [`docs/tech/ten4/index.html`](../tech/ten4/index.html) |
| Пулы, призы и контракт эскроу | [`docs/spec/pool.md`](../spec/pool.md), [`docs/tech/pool-program/index.html`](../tech/pool-program/index.html), [`docs/tech/program-deploy.md`](../tech/program-deploy.md) |
| Реферальная программа (Convoy) | [`docs/spec/referral.md`](../spec/referral.md) |
| Античит, телеметрия и защита от сибил / TrustScore | [`docs/spec/anticheat.md`](../spec/anticheat.md) (вкл. Приложение D), [`docs/tech/anti-cheat/index.html`](../tech/anti-cheat/index.html) |
| План, спецификация и ранбук Pre-season | [`docs/plan/DEVNET_PRESEASON.md`](DEVNET_PRESEASON.md) (Части I и II) |
| Внешние задачи владельца | [`docs/plan/OWNER_TASKS.md`](OWNER_TASKS.md) |
| Юридические документы и манифест | [`docs/spec/legal.md`](../spec/legal.md), [`docs/legal/PRIVACY.md`](../legal/PRIVACY.md), [`docs/legal/TERMS.md`](../legal/TERMS.md), [`docs/legal/OFFICIAL_RULES.md`](../legal/OFFICIAL_RULES.md), [`docs/legal/PRESEASON_RULES.md`](../legal/PRESEASON_RULES.md), [`docs/legal/PRESEASON_RULES_RU.md`](../legal/PRESEASON_RULES_RU.md) |

## 14. Открытые вопросы и задачи владельца

- **Единый реестр открытых вопросов (юрист, налоги, калибровка после запуска):** [`docs/spec/OPEN.md`](../spec/OPEN.md) (заменяет прежний дублирующий список в этом разделе и удалённый `OPEN_QUESTIONS.md`).
- **Единый чек-лист внешних задач владельца по дедлайнам:** [`docs/plan/OWNER_TASKS.md`](OWNER_TASKS.md).

## 15. Журнал аудита планов (раунды 12–19)

- **Раунд 12:** в токеномике `freightchain_honk` зафиксированы 100M supply и корзина команды (клифф 12 мес + 24 мес линейно, `claim_team`), в `PRIVACY.md` зафиксировано отсутствие сторонних стриминг-интеграций, финальная неделя Season 1 = неделя 7, выбран Solana Pay вместо кассы.
- **Раунд 13:** добавлен черновик [`docs/legal/TERMS.md`](../legal/TERMS.md), сверен с `PRIVACY.md` (гео, соцсети, античит, чат 90 дней, отсутствие браузерного отпечатка) и правилами пулов/рефералки.
- **Раунд 14:** принят Pre-season на devnet ([`DEVNET_PRESEASON.md`](DEVNET_PRESEASON.md) D1–D12); старт Season 1 на mainnet перенесён на **11.01–28.02.2027** (выплаты с 02.03, перерыв до 14.03, Season 2 с 15.03.2027); TGE не раньше марта 2027.
- **Раунды 15–16:** ничьи на всех досках и в финале делятся поровну без тай-брейка по адресу кошелька; при равенстве суммы мест на границе отбора в финал проходят все (`settleSeasonFinal` на `N` финалистов).
- **Раунд 17:** Pre-season проводит владелец как физлицо-организатор (налоговый резидент Сербии, см. [`research/operator_entity_options.md`](research/operator_entity_options.md) §6–7) с выплатой призов лично с выделенного кошелька события; налоговые формы США в Pre-season не собираются; санкционная проверка Chainalysis обязательна; выбор юрлица для Season 1 — до 01.12.2026.
- **Раунды 18–19:** призовая попытка Pre-season выдаётся только за обязательный набор заданий кампании (тестовая поездка MEDIUM/HARD + Telegram канал/чат + X подписка и пост с кодом); без юрлица, юриста и Didit до Pre-season (принятый риск владельца); проверка топ-20 — строгий анти-сибил + ручная проверка по ранбуку [`DEVNET_PRESEASON.md`](DEVNET_PRESEASON.md) §14.

