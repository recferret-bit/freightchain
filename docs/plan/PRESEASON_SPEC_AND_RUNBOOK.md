# Pre-season Technical Specification & Operational Runbook

> **Scope:** Closes all non-external product, engineering, and operational gaps in `docs/plan/GAPS.md` (`G2`, `G6`, `G7`, `G8`, `G9`, `G10`, `G11`, `G13`, `G14`, `G16`) and `docs/plan/DEVNET_PRESEASON.md` (`Q4`, `Q6`, `Q7`, `Q9`, `Q11`, `Q12`) using the recommended (`⭐`) rules.

---

## 1. Common Weekly Event Seed (`G2`)

### Problem
In `main`, each ride currently derives its PRNG seed per-ride (or per-pool on-chain seal), whereas `PRESEASON_RULES.md` §7 and `DEVNET_PRESEASON.md` §3.4 require **all** ranked attempts in an Event / Prize Week to drive the **exact same route, obstacles, holes, start hour, and weather** so the contest is a pure skill comparison under identical conditions.

### Specification
1. **Runtime Setting / Pool Seed Override:**
   - Add `event_seed_override` (`string`, nullable, e.g. `"2026-W46-PRESEASON-1H"`) and `event_trip_id` (`string`, default `"event_1h_preseason"`) to `player.GameSetting`.
   - For Season 1+ weekly boards (`1h`, `4h`, `8h`), derive a deterministic board seed from the canonical week identifier and tier: `sha256("fc-board-seed:" + seasonId + ":" + weekNumber + ":" + tier)` → 32-bit unsigned integer seed passed to `mulberry32`, with a固定 `startHour` (`event_start_hour`, default `14` = 14:00 local road time) and fixed trip definition (`tripId`).
2. **Server & Client Road Parity:**
   - When `StartRideHandler` starts a ride with `mode = 'event'` (Pre-season) or `mode = 'ranked'` (Season 1), the server assigns:
     - `ride.seed = BoardSeedService.getSeedForBoard(eventIdOrWeek, tier)`
     - `ride.tripId = BoardSeedService.getTripIdForBoard(eventIdOrWeek, tier)`
     - `ride.startHour = BoardSeedService.getStartHourForBoard(eventIdOrWeek, tier)`
   - Both client (`js/net/network.js`, `js/net/obstacles.js`, `client/shared/traffic-simulation.js`) and server (`server/src/domain/road/`, `ReplayEngine`) already consume `(seed, tripId, startHour)` deterministically via `@freightchain/shared`. No change to physics or `ReplayEngine` math is required.
3. **Training Isolation:**
   - Free training rides (`mode = 'free'` / `'training'`) continue to use random per-ride seeds so players cannot memorize the exact obstacle coordinates of the active Prize Week seed before starting their ranked attempt, OR (if `event_seed_ reveal_at_open = 1`) use the common route geometry with per-ride traffic seed in training while the ranked attempt uses the locked weekly `(roadSeed, trafficSeed)`. Recommended (`⭐`): **training uses random seeds; ranked attempts all share the locked weekly `(roadSeed, trafficSeed, startHour)`**.

---

## 2. Pre-season Event Mode & Attempt Grant (`G7`, `Q4`, `Q7`, `Q9` / `G6`)

### Runtime Configuration Keys (`player.GameSetting`)
All Pre-season parameters are runtime-configurable via the signed admin API so the event can be repeated (e.g. an optional December devnet event, `Q7`) without code changes:

| `GameSetting` Key | Pre-season Value | Description |
|---|---|---|
| `event_id` | `"preseason_2026_11"` | Unique identifier of the active event |
| `event_mode_enabled` | `1` | Enables the Pre-season Event page, task checklist, and 1h Event board |
| `event_tasks_open_at` | `"2026-11-02T00:00:00Z"` | Tasks & registration open timestamp |
| `event_starts_at` | `"2026-11-09T00:00:00Z"` | Ranked attempts open timestamp |
| `event_last_start_at` | `"2026-11-15T11:00:00Z"` | Last timestamp to start a 1h ranked attempt |
| `event_ends_at` | `"2026-11-15T12:00:00Z"` | Hard cutoff by which ranked attempts must finish |
| `event_review_ends_at` | `"2026-11-16T12:00:00Z"` | End of 24h manual anti-cheat review window |
| `event_appeals_ends_at` | `"2026-11-17T12:00:00Z"` | End of 24h appeal window |
| `event_max_attempts_per_wallet` | `1` | Strictly 1 ranked attempt per wallet |
| `event_tier` | `"1h"` | Board tier for the event |
| `event_seed_override` | `"preseason-2026-w46-v1"` | Deterministic seed shared by all ranked attempts |
| `paid_tickets_enabled` | `0` | Disables all paid ticket purchases during Pre-season |
| `referral_referee_promo_enabled` | `0` | Disables extra free 1h promo ride for referred friends during Pre-season (`Q9`/`G6`) |
| `referral_ten4_enabled` | `0` | Disables TEN4 referral payouts during Pre-season (`Q9`/`G6`) |

### Single Ranked Attempt Grant (`PromoRideGrant(source = 'event')`)
1. **Checklist Completion Gate:**
   A wallet unlocks its single Pre-season ranked attempt when **all 4 mandatory tasks** are verified:
   - `testRideVerified === true` (at least one verified `MEDIUM` or `HARD` free ride completed);
   - `telegramVerified === true` (`SocialAccount(provider='telegram')` linked AND `channelMember === true` AND `groupMember === true`);
   - `xFollowVerified === true` (`@FreightChainSol` follow verified via `twitterapi.io`);
   - `xPostVerified === true` (public X post or quote post containing the player's personal code `FC-<shortCode>` verified via `twitterapi.io`).
2. **Idempotent Grant:**
   - When the 4th mandatory task transitions to verified, `EventTaskService` runs inside the player row lock (`findByWalletForUpdate`) and inserts at most one `PromoRideGrant` row with `(wallet, eventId, source = 'event', tier = '1h', maxUses = 1, usedCount = 0)` (unique constraint on `(wallet, eventId, source)`).
   - Starting the ranked ride increments `usedCount = 1` and links `rideId`.
   - **Pre-start Membership Re-check:** Immediately before starting the ranked ride (`POST /api/rides/start` with `source = 'event'`) and again during post-event review, the server re-verifies Telegram channel/chat membership via `getChatMember`. If the user left the channel or chat, the start is blocked with error code `EVENT_TG_MEMBERSHIP_REQUIRED` (or the attempt is voided at review).
3. **Airdrop Points Carry-Over (`Q4` ✅):**
   - All Pre-season task completions (`test_ride` 100 pts, `x_follow` 50 pts, `x_quote` 100 pts, `tg_channel` 50 pts, `tg_group` 50 pts, optional `discord_member` 50 pts + `discord_role` 50 pts, and completing the ranked Event ride) are stored in `airdrop.TaskCompletion` and **count toward the Season 1 airdrop** (2,000,000 TEN4 pool, 2,000 TEN4 cap per wallet, claimed on mainnet after TGE).
4. **Convoy in Pre-season (`Q9` / `G6` ✅):**
   - The `?ref=` invite link, wallet binding (`player.Referral`), and public Convoy invite counter/leaderboard work in Pre-season using existing `main` referral binding, with **all SOL/USDC/TEN4 rewards and referee free-ride gifts disabled** (`referral_referee_promo_enabled = 0`, `referral_ten4_enabled = 0`). Qualified Pre-season referrals remain bound for Season 1 Convoy milestones.

---

## 3. Telegram Verification Flow (`G8`)

### Architecture
1. **Bot Setup:**
   - Official Telegram Bot (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`) is added as an **Administrator** (with only `Read Members` / basic admin permission) in both the official announcement channel (`TELEGRAM_CHANNEL_ID`, e.g. `-100...`) and the community chat group (`TELEGRAM_GROUP_ID`, e.g. `-100...`).
2. **Linking (`POST /api/social/telegram/link`):**
   - Frontend renders the official **Telegram Login Widget** (or deep-link bot `/start <oneTimeToken>` fallback for mobile/in-app browsers).
   - Server verifies the widget payload HMAC-SHA256 using `SHA256(TELEGRAM_BOT_TOKEN)`, checks `auth_date` freshness (`≤ 300s`), and acquires `findByWalletForUpdate(wallet)`.
   - Uniqueness check: if `telegramUserId` is already linked to another wallet, reject with `SOCIAL_ALREADY_LINKED`.
   - Upserts `SocialAccount(wallet, provider = 'telegram', providerUserId = telegramUserId, handle = username)`.
3. **Membership Check (`POST /api/social/telegram/verify` & Pre-Ride / Pre-Payout Check):**
   - Server calls Telegram Bot API `getChatMember(chat_id = TELEGRAM_CHANNEL_ID, user_id = telegramUserId)` and `getChatMember(chat_id = TELEGRAM_GROUP_ID, user_id = telegramUserId)`.
   - Valid `status` values: `'member'`, `'administrator'`, `'creator'`, or `'restricted'` with `is_member === true`.
   - Statuses `'left'` or `'kicked'` fail verification (`TELEGRAM_NOT_MEMBER`).
   - Rate limit: cached for 30 seconds per wallet on manual "Check" clicks; re-checked live at ranked ride start and in the Monday batch review job.

---

## 4. Bilingual RU / EN Localization Scope (`G9`, `Q6`)

### Scope Decision (`Q6` ✅)
- Pre-season launches with **Russian (`ru`) and English (`en`)** only. Ukrainian (`uk`) is deferred until after Pre-season based on regional traffic share.
- Language auto-detects from `navigator.language` (`ru*`, `be*`, `kk*`, `uk*`, `uz*`, `ky*` default to `ru`; all others default to `en`) with a persistent header toggle (`RU | EN`) stored in `store('lang')`.

### Files & Screens Covered by `client/site/i18n.js`
1. **Shared Dictionary (`client/site/i18n.js`):**
   - Exports `t(key, vars)`, `getLang()`, `setLang(lang)`, and `applyI18n(root)`.
   - Uses `data-i18n="key"` for text content and `data-i18n-placeholder` / `data-i18n-title` for attributes.
2. **Screens Required for Pre-season (`~140` keys):**
   - **Landing / Lobby (`client/index.html`, `client/site/lobby.js`):** Hero banner, "Play Free Training", "Pre-season $500 USDC Event", countdown timer (to Nov 2 / Nov 9 / Nov 15), wallet connect button, 18+ & Rules acceptance modal (with links to `PRESEASON_RULES.md` EN and `PRESEASON_RULES_RU.md` RU).
   - **Event & Tasks Panel:** Task checklist cards (1. Verified MEDIUM/HARD Test Ride, 2. Telegram Link + Channel + Chat, 3. Follow `@FreightChainSol` on X, 4. Public X Post with Personal Code `FC-...` + URL input, 5. Optional Discord Link), status badges (`Not started`, `Pending`, `Verified`, `Attempt Unlocked`), and the "Start My 1 Ranked Attempt (1h)" button + confirmation modal ("You have only 1 ranked attempt. Make sure your connection is stable and VPN is off.").
   - **Leaderboard & Standings:** Rank, Driver, Progress %, Corrections, Status (`Verified`, `Under Review`, `Disqualified`), Prize column (`$100` … `$12`), and Replay button.
   - **In-Game HUD Prompts (`client/play.html`):** Engine start hint (`Press E to start engine`), gear/speed/damage labels, finish-line banner, and post-ride verdict summary.
   - **Server Error Code Mapping (`ERROR_I18N`):**
     - `GEO_BLOCKED_REGION` → EN: *"FreightChain is not available in your region."* / RU: *«Сервис недоступен в вашем регионе.»*
     - `GEO_PRIZE_RESTRICTED_RU_BY` → EN: *"Players in Russia and Belarus may play training and leaderboard rides, but are not eligible for cash prizes under the Event Rules."* / RU: *«Резиденты РФ и РБ могут участвовать в тренировках и таблице лидеров, но не могут получать денежные призы согласно Правилам События.»*
     - `VPN_DETECTED` → EN: *"VPN, proxy, or hosting connection detected. Please disable VPN to start your ranked attempt."* / RU: *«Обнаружено подключение через VPN, прокси или хостинг. Отключите VPN для запуска зачётной попытки.»*
     - `SOCIAL_ALREADY_LINKED` → EN: *"This social account is already linked to another wallet."* / RU: *«Этот аккаунт соцсети уже привязан к другому кошельку.»*
     - `X_POST_CODE_NOT_FOUND` → EN: *"We couldn't find your personal code in that X post. Make sure the post is public and includes your code."* / RU: *«Персональный код не найден в указанном посте X. Убедитесь, что пост публичный и содержит ваш код.»*
     - `TELEGRAM_NOT_MEMBER` → EN: *"Please join both the official Telegram channel and chat before starting."* / RU: *«Пожалуйста, вступите в официальный Telegram-канал и чат перед стартом.»*
     - `EVENT_ATTEMPT_ALREADY_USED` → EN: *"You have already used your single ranked attempt for this Event."* / RU: *«Вы уже использовали свою единственную зачётную попытку в этом Событии.»*

---

## 5. Top-20 Review, Disqualification Shift & Appeals Checklist (`G11`, `Q11`)

### Disqualification & Unused Places Rule (`Q11` ✅)
- If any player in the provisional Top-20 is disqualified (multi-accounting, telemetry/replay anomaly, bot/macro, VPN, prohibited jurisdiction, or unlinked/deleted X post or left Telegram channel/chat) or fails winner verification within 14 days, **that entry is removed and eligible verified finishers from 21st place downward move up**.
- If fewer than 20 eligible finishers remain after review, **unawarded places are not paid out and stay with the Organizer**.

### Step-by-Step Monday Review Checklist (`15.11.2026 12:00 UTC` – `16.11.2026 12:00 UTC`)
Run this checklist for the **Top 30 verified finishers** (so replacements 21–30 are pre-vetted if any Top-20 entry is disqualified):
1. **Automated 10 Hz Replay & Telemetry Verdict:**
   - Confirm `ride.verdict === 'verified'`, valid frame-level traffic proof hash, zero speed-governor violations, and zero uncounted off-road/collision gaps.
   - Watch the visual 3D replay (`r.html?id=<rideId>`) at 4× speed for Places 1–10 (and any flagged ride in 11–30) to confirm natural human steering inputs.
2. **Sybil & Cluster Check:**
   - Inspect `IpSignal` prefix hash (`/24` IPv4 / `/48` IPv6): check if any two wallets in the Event share the same IP prefix hash or overlapping sign-in/ride timestamps.
   - Inspect Solana wallet funding history (via Helius / Solscan): check whether two participating wallets were funded from the same source wallet or CEX deposit address Pattern.
   - **Rule (`PRESEASON_RULES.md` §6):** If two or more entries belong to the same person or sybil cluster, **disqualify ALL entries in that cluster** (do not leave one wallet active).
3. **Social Task Persistence Check:**
   - Run the batch re-verification script:
     - Telegram `getChatMember` for both channel and group === member.
     - X post URL still live, public, contains the wallet's `FC-<code>`, and account still follows `@FreightChainSol`.
     - Check X account creation date and post history for obvious disposable bot rings.
4. **Geo & Network Eligibility Check:**
   - Confirm `CF-IPCountry` during registration and ranked ride is not in blocked jurisdictions (`UK`, `EU/EEA`, `CU`, `IR`, `KP`, `SY`, occupied regions, 7 restricted US states) and not `RU` / `BY` for prize eligibility.
   - Confirm `ipinfo` flags (`vpn: false`, `proxy: false`, `tor: false`, `hosting: false`) on the ranked ride session.
5. **Publish Provisional Standings (`16.11.2026 12:00 UTC`):**
   - Publish the provisional Top-20 list in the Event page and Telegram channel, opening the **24-hour Appeal Window** (`16.11 12:00 UTC` – `17.11 12:00 UTC`).
   - Any disqualified player sees the reason code (`MULTI_ACCOUNT_CLUSTER`, `SOCIAL_TASK_REMOVED`, `VPN_OR_GEO_INELIGIBLE`, `TELEMETRY_REJECTED`) and appeal contact.

---

## 6. $500 USDC Mainnet Payout & Sanctions Runbook (`G10`, `Q12`)

### Prize Schedule (`$500 USDC` Total)
- **Place 1:** `$100 USDC`
- **Place 2:** `$70 USDC`
- **Place 3:** `$50 USDC`
- **Places 4–5:** `$30 USDC` each (`$60`)
- **Places 6–10:** `$20 USDC` each (`$100`)
- **Places 11–20:** `$12 USDC` each (`$120`)
- **Total:** `$500.00 USDC` (Solana Mainnet USDC mint: `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`).

### Execution Steps (`17.11.2026 12:00 UTC`)
1. **Winner Self-Confirmation & Sanctions Screening:**
   - Each confirmed Top-20 winner clicks "Claim Prize" (or confirms via signed wallet message / linked Telegram) confirming age 18+ and eligible country of residence (not RU/BY/UK/EU/restricted).
   - Run **Chainalysis** free sanctions API screening (`GET https://public.chainalysis.com/api/v1/address/<wallet>`) on all 20 winner wallet addresses and record the clean timestamped JSON response (`identifications: []`) in the audit log.
2. **Funding the Dedicated Prize Wallet:**
   - Use a dedicated clean Solana mainnet wallet (announced publicly before Nov 9 in `PRESEASON_RULES.md` §11) funded with **`500.00 USDC` + `~0.15 SOL`** (to cover SPL Associated Token Account creation rent `~0.00204 SOL` per recipient who does not yet have a mainnet USDC ATA).
3. **Executing Transfers:**
   - Send exact USDC amounts (`6` decimals: `100_000_000` for `$100`, etc.) to each winner's participating Solana wallet address using standard SPL Token `transferChecked` (with `--allow-unfunded-recipient` / ATA creation enabled).
   - Record every mainnet transaction signature (`txSig`) against the winner's row.
4. **Public Payout Report (`Q12` ✅):**
   - Immediately after payout completion on **17 November 2026**, publish the **Public Payout Report** on the Event page, Telegram channel, and X (`@FreightChainSol`) listing for each place `1–20`:
     - Rank & Final Score (+ link to 3D Ride Replay)
     - Shortened Wallet Address / Public Handle
     - Prize Amount (`USDC`)
     - Direct Solscan Mainnet Transaction Link (`https://solscan.io/tx/<signature>`)

---

## 7. Infrastructure, Monitoring, Backups & Load Targets (`G13`, `G14`)

### Load & Capacity Targets for Pre-season (`G14`)
- **Expected Funnel:** `300–500` connected wallets → `150–300` completed test rides → `100–250` unlocked ranked attempts across the 6.5-day window (`09.11` – `15.11`), with peak concurrency at Monday open and Sunday `08:00–12:00 UTC` deadline (`~30–60` concurrent active rides, `~600` telemetry samples/sec at 10 Hz, `~5–10` replay worker verifications/min).
- **Pre-Launch Load Test (`before 02.11.2026`):**
  - Run a synthetic benchmark simulating **50 concurrent 10 Hz telemetry streams** + **20 concurrent `ReplayEngine` verifications** on the production VPS specs.
  - Ensure `replay:worker` queue lag stays `< 60 seconds` and PostgreSQL connection pool (`connection_limit = 25`) stays `< 70%` utilization.

### Monitoring, Alerts & Backups (`G13`)
1. **Uptime & Health Alerts:**
   - Configure an external uptime monitor (Cloudflare Health Check / UptimeRobot / BetterStack) polling `https://api.<domain>/api/health` every **60 seconds** with instant Telegram alert to the Organizer if HTTP status `!= 200` for 2 consecutive checks or if `replay:worker` heartbeat is stale.
   - Configure disk/memory alert at `80%` threshold.
2. **Daily Off-Server PostgreSQL Backups:**
   - Enable a daily cron (`03:00 UTC`) + pre-cutoff snapshot (`15.11.2026 12:05 UTC`) running `pg_dump -Fc` compressed and encrypted to off-server object storage (Cloudflare R2 / Backblaze B2 / S3), retained for 30 days.
3. **30-Minute Outage Rule (`PRESEASON_RULES.md` §13):**
   - If a verified server-side outage lasting **more than 30 minutes** interrupts an active `mode = 'event'` ranked attempt (ride ended by `HB_TIMEOUT_MS` during a confirmed server outage window), the Organizer resets `PromoRideGrant.usedCount = 0` for the affected wallet via the signed admin API and logs the restoration reason in the audit log. If an outage occurs during the final 3 hours before `15.11 12:00 UTC`, the deadline is extended by `2×` the outage duration and announced in the Telegram channel.

---

## 8. Communications Calendar & KPIs (`G16`, `Q7`)

### Pre-season Communications Schedule (`26.10.2026` – `24.11.2026`)

| Date (UTC) | Channel | Milestone / Post |
|---|---|---|
| **Mon 26 Oct – Fri 30 Oct** | Telegram, X | Teaser clip (15s gameplay + cockpit), announcement of **$500 USDC Devnet Pre-season**, rules preview (`PRESEASON_RULES.md` EN + `PRESEASON_RULES_RU.md` RU), prize wallet address published |
| **Mon 2 Nov 00:00** | Site, Telegram, X | **Registration & Tasks Open:** Players connect wallet, drive MEDIUM/HARD test ride, link Telegram (channel + chat), follow `@FreightChainSol` & post personal code on X to unlock their 1 ranked attempt; training rides open |
| **Wed 4 Nov – Sat 7 Nov** | Telegram, X, CIS Communities | 3–5 seeded posts in CIS gaming/Solana Telegram communities (`$0` or micro-collab budget) + daily training tips & common mistakes clip |
| **Sun 8 Nov 18:00** | Telegram, X | **24h Countdown to Prize Week:** Reminder that the 1h Event Board opens Monday 00:00 UTC on a single shared route seed |
| **Mon 9 Nov 00:00** | Site, Telegram, X | **Prize Week LIVE (`09.11 00:00` – `15.11 12:00 UTC`):** 1h Event Board open; post first verified finishers & live replay highlights |
| **Thu 12 Nov** | Telegram, X | Mid-week leaderboard snapshot (Top-20 cutoff score to beat) |
| **Sat 14 Nov 12:00** | Telegram, X | **Final 24 Hours Warning:** Remind players that ranked attempts must **start by Sunday 11:00 UTC** to finish before the `12:00 UTC` close |
| **Sun 15 Nov 12:00** | Site, Telegram | **Board Closed:** Automated & manual Top-20 review begins (`24h`) |
| **Mon 16 Nov 12:00** | Site, Telegram, X | **Provisional Standings Published:** 24h Appeal Window opens (`until Tue 17 Nov 12:00 UTC`); Top-20 winners prompted to complete self-confirmation |
| **Tue 17 Nov 12:00+** | Mainnet, Telegram, X | **Final Standings & $500 USDC Mainnet Payouts:** Chainalysis check → USDC transfers → Public Payout Report with Solscan tx links & winning replays |
| **Tue 24 Nov** | Internal | **Post-Mortem & Go/No-Go Review (`Q7`):** Evaluate KPIs below; decide whether to run an optional 2nd devnet event in December or proceed directly to Season 1 Mainnet (`11.01.2027`) |

### Success KPIs (Evaluated 24 Nov 2026)
1. **Funnel & Retention:**
   - `≥ 200` wallets connected on the Event page;
   - `≥ 100` wallets completed the mandatory task checklist (test ride + TG + X);
   - `≥ 60` wallets started and `≥ 30` wallets cleanly finished their 1h ranked attempt.
2. **Technical & Anti-Cheat Integrity:**
   - `100%` of Top-20 replays verified cleanly by `ReplayEngine` at 10 Hz with zero unresolved physics/traffic drift;
   - `0` undetected multi-account clusters paid in the final Top-20;
   - Unplanned server downtime `< 30 minutes` across the entire prize week.
3. **Conversion to Season 1:**
   - `≥ 150` verified members retained in the Telegram channel/chat after payouts;
   - Post-event player survey / feedback collected in Telegram to tune Season 1 ticket pricing (`$2/$5/$10`) and route difficulty.
