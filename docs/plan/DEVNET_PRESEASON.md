# Devnet mini-launch (November 2026): plan, specification, and runbook

Version 17.10.2026, **decisions D1–D13 adopted by the owner (all ⭐)**. **Round 19: the owner proceeds without a legal entity, without a lawyer consultation, and without Didit until Pre-season — an accepted risk ([`../spec/OPEN.md`](../spec/OPEN.md), [`MASTER_PLAN.md`](MASTER_PLAN.md) §12). Prizes for Ukraine (excluding the occupied regions) — as in the plan, an accepted risk.** **Round 17: the owner runs Pre-season as a natural-person organizer (a tax resident of Serbia, with a Serbian residence permit, a citizen of the RF — see [`research/operator_entity_options.md`](research/operator_entity_options.md) §6–7) and pays the prizes personally; a legal entity — before Season 1.** Basis: [`MASTER_PLAN.md`](MASTER_PLAN.md), [`../spec/OPEN.md`](../spec/OPEN.md), [`research/operator_entity_options.md`](research/operator_entity_options.md), `../legal/*`. Mark **[not verified]** — a fact not confirmed by a source or by code. **[LAWYER]** — a lawyer is needed.

**Owner's request:** a mini-launch on devnet in the first week of November 2026, or around it:
- a prize fund of $500 entirely from the owner;
- no paid tickets;
- each person has exactly 1 prize attempt after completing the airdrop steps;
- the audience is the CIS.

---

## 0. What is already in the code (verified against `a486c350`)

| What the mini-launch needs | Present? | Where / what to do |
|---|---|---|
| A weekly skill contest, 1h/4h/8h boards, a `cleanBps` score, review and appeals | Yes | `server/src/domain/prize/prize-rules.ts`, `docs/spec/pool.md` |
| Ranked-start limit: 1 promo + 5 paid per week | Yes | `PROMO_RANKED_STARTS = 1`, `PAID_RANKED_STARTS = 5` |
| A 1h promo ride (effect `ride`, once per wallet, does not mint TEN4) | Yes | `promo.types.ts`, `PromoRideGrant` — the basis for "1 attempt" |
| Paid tiers off by default | Yes | `ride-tier.ts`: `onSale: false` on 1h/4h/8h |
| A weekly issued ticket with flags | Yes | `weekly_ticket_{1h,4h,8h}_enabled` |
| Geo by country and state, 18+, a KYC flag for payout | Partial | `prizeAccess()`: the lists are constants in code, not settings; the CIS is not blocked. RU and BY are not in the lists |
| Airdrop tasks (social networks, steps) | **No** | Designed in [`../spec/ten4.md`](../spec/ten4.md) §4.2 and **§11** below |
| Telegram (bot, Login Widget, subscription check) | **No** | New (**§11.2**) |
| Localization (i18n) | **No** | `<html lang="en">` everywhere, no dictionaries (**§13**) |
| Didit KYC, sanctions screening, tax forms | **No** | In Pre-season, a manual review of the top 20 + Chainalysis (**§14**) |
| A separate "event board" | **No** | The 1h board with event rules (**§10, §12**) |
| Player transaction signing | Only the TEN4 burn and the parts purchase | The ranked ride and the promo are off-chain, no gas is needed (**§16**) |
| Devnet RPC | Public `api.devnet.solana.com` in `.env.example` | Replace with a dedicated Helius devnet RPC |

Conclusion: the boards, the attempt rules, and the promo ride already exist. New work — campaign steps (Telegram + X), the Russian language, the top-20 and sanctions review, event mode (`C2–C8` in **§7** and **Part II** below).

## 1. Relation to Season 1 on mainnet and the mode flags (`D1–D3, D11`)

A full Season 1 launch on mainnet (paid v5 pools, Solana Pay, Didit KYC, a lawyer review) in parallel with the mini-launch, inside two weeks, is not realistic. Decisions are therefore adopted (**the summary table of all A/B/C options — in §9**):
- **D1 (`✅ A`) — place of the mini-launch:** the mini-launch is held **instead of the start** of Season 1, as "Pre-season" on devnet.
- **D2 (`✅ A`) — Pre-season dates:** registration and tasks from **Mon 02.11.2026**; the prize week **Mon 09.11 00:00 – Sun 15.11 12:00 UTC**; review until Mon 16.11 12:00, appeals until Tue 17.11 12:00, payouts from **Tue 17.11**.
- **D3 (`✅ A`) — the new Season 1 date (mainnet):** **Mon 11.01.2027** (7 weeks, the final 22–28.02.2027, a break 01–14.03, Season 2 from 15.03.2027, TGE no earlier than March 2027 — see [`MASTER_PLAN.md`](MASTER_PLAN.md) §1 and §4). Points for Pre-season steps count toward the Season 1 airdrop (`D10`).
- **D11 (`✅`) — feature flags for Pre-season:** paid tickets (`onSale: false`), Solana Pay, the weekly free ticket (`weekly_ticket_1h_enabled = 0`), ride promo codes, a gift to a friend (`referral_referee_promo_enabled = 0`), TEN4 for Convoy milestones (`referral_ten4_enabled = 0`), and v1 referral SOL shares **are off** (so that no one has a second attempt). On: Convoy linking and the Convoy rating, a shadow TrustScore calculation, the mandatory Cloudflare proxy (`G1`), and the 18+/Terms modal (`TermsGuard`). **The full table of `player.GameSetting` keys for Pre-season — in §10.**

## 2. Prize mechanics with one attempt (`D4–D6`)

- **D4 (`✅ A`) — board:** one event board on the **1h** tier (one route of the week, one `seed`, exactly 1 ranked attempt after the mandatory steps are completed; training is unlimited).
- **D5 (`✅ A`) — distribution of $500:** a fixed **top-20** table (`1: $100, 2: $70, 3: $50, 4–5: 2×$30, 6–10: 5×$20, 11–20: 10×$12 = $500`). If there are fewer than 20 qualified participants, unpaid places stay with the owner; there is no carryover between weeks. The 30% cap for free tickets (`free_prize_board_cap_bps`) is off (`0`), because every attempt is free.
- **D6 (`✅ A`) — ties:** equal results split the sum of the occupied places equally, with no tie-break by wallet address (**algorithm and examples — in §12**).
- **Positioning and free entry (rounds 18–19):** there are no purchases at all, the owner pays the fund; spectator effects on the ranked ride are rejected. The prize attempt is issued **only** for completing the mandatory campaign tasks (**§11**). The risk of the mandatory social tasks qualifying as non-monetary consideration is referred to the questions for a Serbian lawyer ([`../spec/OPEN.md`](../spec/OPEN.md) §2.1).
- **`twitterapi.io` budget estimate (round 19, X is mandatory):** a point check of `check_follow_relationship` + a check of the quote post by ID, at attempt issuance and at the top-20 review (with a ×2 margin for repeats), costs ~460 credits ≈ **`$0.005` per participant** (`1,000` participants ≈ `$5`, `5,000` ≈ `$23`, `20,000` ≈ `$92` — fits in `airdrop_twitterapi_budget_usd = 100`).

## 3. Payout of the real $500 and the top-20 review (`D7, D13`)

- **D7 (`✅ A`, round 17) — what to pay with and from where:** **USDC on Solana mainnet**, to the same wallet address the winner played with on devnet, from the owner's personal funds, through a **separate event hot wallet** (funded with `$500 USDC + ~0.15 SOL` for fees; the address and the payout hashes are published in the event report). Tax forms W-9/W-8BEN are not collected in Pre-season (the organizer is not a US person).
- **D13 (`✅`, round 19) — top-20 review without a legal entity:** Didit is not connected before Pre-season (an accepted risk of the owner). Before payout, a strict anti-sybil check and a manual review of each of the top 20 are carried out (Telegram/X 1:1, IP clusters `≤ 1` prize place per cluster, a re-check of the ride and the telemetry, a Chainalysis + OFAC SDN sanctions check, a 72 h hold). **The step-by-step review and payout runbook — in §14 and §15.**

## 4. CIS specifics (`D8, D12`)

### 4.1 Sanctions and law — what the sources confirm

| Regime | What it prohibits | Does it apply to us |
|---|---|---|
| EU, Reg. 833/2014 Art. 5b(2) (the 8th package of 2022 removed the threshold; from the 19th package the wording is expanded) | EU providers — from providing citizens and residents of the RF any crypto services under MiCA, wallet and custody services, payment services, e-money issuance. Exception — citizens and residents of the EU/EEA/Switzerland | The organizer is a natural person, a tax resident of Serbia ([`research/operator_entity_options.md`](research/operator_entity_options.md) §6–7), not an EU person; however, prizes for RU/BY are closed until a lawyer's opinion (`D8`) |
| EU, Reg. 765/2006 Art. 1u (Belarus) | An analogous ban on crypto services for citizens and residents of the RB | The same |
| US, EO 14071 / EO 14024 (SDN) | US persons — consulting/IT services in the RF; a ban on settlements with persons on the SDN lists and with blocked regions | A check of each wallet through Chainalysis + OFAC SDN before payout (**§14.1**); blocked regions (`UA-43`, `UA-14`, `UA-09`) are excluded |
| RF, 259-FZ Art. 14 and the law on lotteries / promotional events | A ban on residents of the RF accepting digital currency as payment for goods/services; requirements for promotional events | RU and BY play for free with no right to monetary prizes (`D8`), until a lawyer gives an opinion ([`../spec/OPEN.md`](../spec/OPEN.md) §2) |
| Ukraine | Occupied regions (`UA-43`, `UA-14`, `UA-09`) are blocked (`451`) | The rest of Ukraine is admitted to prizes (accepted risk of round 19) |

- **D8 (`✅ A`) — country admission:** prizes are available for **KZ, UZ, KG, AM, AZ, GE, MD, UA** (excluding `UA-43/14/09`) and for the other open countries (outside the EU/EEA/UK and the sanctions lists). Players from **RU and BY** may do training and ride on the board, but **with no right to monetary prizes** (stated explicitly in the UI and in [`../legal/PRESEASON_RULES_RU.md`](../legal/PRESEASON_RULES_RU.md)). For the ranked ride the VPN MUST be off.

### 4.2 Localization and channels (`D12`)

- **D12 (`✅ A`) — localization of the UI and the rules:** a lightweight dictionary `client/site/i18n.js` (`RU + EN`, a switcher in the header, auto-detection from `navigator.language`) for the landing, the lobby, the airdrop/event pages, and the 18+/Terms modal; the HUD of the 3D game itself stays in English. The event rules are published in EN ([`../legal/PRESEASON_RULES.md`](../legal/PRESEASON_RULES.md)) and in RU ([`../legal/PRESEASON_RULES_RU.md`](../legal/PRESEASON_RULES_RU.md)). **The full specification of `i18n.js` and the list of translation keys — in §13.**
- **Channels:** Telegram is the main channel (an RU announcements channel + an RU chat with moderators); X is a mandatory step for verification and virality (`@FreightChainSol`).

## 5. Campaign steps and protection against multi-accounts (`D9, D10`)

- **D9 (`✅`, round 19) — mandatory Pre-season campaign steps:** (1) a verified MEDIUM or HARD test ride (`free-2c` / `free-3c`), (2) Telegram linking and joining the official channel and chat (`getChatMember`), (3) a follow of `@FreightChainSol` on X and publication of a quote post with a personal code `FC-XXXX` (a check through `twitterapi.io`). Discord is optional. Completing all three mandatory steps automatically issues exactly 1 `PromoRideGrant` (`source = 'event'`). **The technical specification of the pipeline and the DB — in §11.**
- **D10 (`✅ A`) — anti-sybil:** a 1:1 link `wallet ↔ telegramUserId ↔ xUserId`, Cloudflare Turnstile on linking and on attempt issuance, a limit of `≤ 1` prize place per IP cluster (`/24` IPv4 / `/48` IPv6) on a second signal, annulment of all wallets when one person's multi-account is found, and a manual review of the top 20 (**§14**).

## 6. Devnet specifics

- **No user gas on devnet:** entry is by a message signature (SIWS); the test ride and the ranked 1h ride run off-chain through server telemetry; buttons that require devnet SOL (buying parts for TEN4, burning in the chat, SOL donations) are hidden in the UI when `event_mode_enabled = 1` (**details and the backup faucet — in §16**).
- **A dedicated RPC and storage in the DB:** devnet uses a dedicated Helius endpoint instead of the public `api.devnet.solana.com`; all ride results, campaign steps, and the leaderboard are stored in PostgreSQL and do not depend on devnet resets. A deploy of `freightchain_pools` v5 to devnet does not block running Pre-season.

## 7. Work plan and estimates (today Sat 17.10; registration Mon 02.11; prize week 09–15.11)

| # | Task | Estimate (person-days) | Depends on |
|---|---|---:|---|
| C1 | ✅ The merge of PR #3 into `main` is done (with an equal split of ties in `prize-pool.ts`), v1 referral flags are off | 0 (done) | — |
| C2 | Event mode: `event_*` keys (§10), issuance of 1 attempt (`PromoRideGrant`, source `event`) after the mandatory steps, the "1 scored attempt" rule, ties with a split (§12), top-20 export in admin | 2–3 | C1 |
| C3 | Campaign steps (§11): a "campaign → steps" model, a test ride, Telegram (bot, Login Widget, `getChatMember`), X is mandatory (a follow + a post with a code through twitterapi.io), Turnstile, a tasks page | 4–5 | C1 |
| C4 | RU localization (§13: the `client/site/i18n.js` dictionary, the landing, the lobby, the airdrop, the event, the modals) | 3–4 | C2, C3 (texts) |
| C5 | Geo (§10): lists from settings, RU/BY "no prizes", UA regions, the reason in the UI | 1 | C1 |
| C6 | 18+ and agreement to the Terms by version (`TermsGuard`, [`../spec/legal.md`](../spec/legal.md) `LEG-M-04`) | 1 | C1 |
| C7 | Winners (§14): an identity check per D13 (manual), Chainalysis + SDN, a 72 h hold, review flags; no tax forms | 1–1.5 | C1 |
| C8 | Payouts (§15): manual USDC from the event hot wallet, recording the tx in admin, a public report | 0.5 | C7 |
| I1 | Telegram bot: hosting, a token, the bot — admin of the channel and the chat | 0.5 | Owner |
| I2 | Turnstile + a Cloudflare proxy (4g — **MUST, P0, see [`MASTER_PLAN.md`](MASTER_PLAN.md) §12 G1**) | 1.5–2.5 | Owner (DNS) |
| I3 | Helius devnet RPC, `.env` | 0.2 | — |
| I4 | Devnet cleanup + v5 (on command; the v5 code is already in the repo) | 0.5 | C1 |
| D1 | Event rules RU/EN — ✅ the EN draft ([`../legal/PRESEASON_RULES.md`](../legal/PRESEASON_RULES.md)) and the RU draft ([`../legal/PRESEASON_RULES_RU.md`](../legal/PRESEASON_RULES_RU.md)) are ready; it remains to fill in the owner's external `[PLACEHOLDER]`s ([`OWNER_TASKS.md`](OWNER_TASKS.md) §1.1) | 0 | D-decisions |
| D2 | Terms/Privacy: additions + the Russian summary — ✅ done ([`../legal/PRESEASON_RULES_RU.md`](../legal/PRESEASON_RULES_RU.md) Part C, [`../legal/TERMS.md`](../legal/TERMS.md), [`../legal/PRIVACY.md`](../legal/PRIVACY.md), [`../legal/OFFICIAL_RULES.md`](../legal/OFFICIAL_RULES.md)) | 0 | — |
| M1 | Telegram: an RU channel and chat, moderators, announcements, chat rules; an RU landing | Owner | — |
| O1 | Owner: $500 USDC + SOL on the event wallet, Telegram accounts, Cloudflare (proxy + Turnstile), Helius, twitterapi.io ([`OWNER_TASKS.md`](OWNER_TASKS.md)) | — | — |

**Development total:** ~19–24 person-days. It fits the two-week deadline only with 2 parallel implementers and a reduced scope. The technical specification and the operational runbook are given below in **Part II (§10–17)**.

**Critical path:** C1 → C3 (Telegram + X) → C4 → registration readiness by 02.11. C2 and C7 MUST be ready by 09.11 (the week start) and by 16.11 (the payouts), respectively. This gives one more week of margin on C7 and C8.

**Cuts if we do not make it (⭐ order):**
1. Seasons in admin — replace with `event_*` keys.
2. Convoy — linking only, with no rating.
3. The game HUD — stays in English.
4. X — move it to optional (only by an owner decision; in round 19 X was made mandatory).

**Risks:**

| Risk | Measure |
|---|---|
| The PR #3 merge drags on | Done in `main` |
| Wallet farms | D10, the "one person — one attempt" rule, a manual review of the top 20 (Telegram/X 1:1, IP clusters) — without documents this is an accepted risk |
| The lawyer is not in time on RU/BY | ⭐ D8 A (RU/BY with no prizes) |
| Widespread VPN use in the RF | Clear copy, ranking with no VPN |
| Devnet instability | A dedicated RPC, no critical on-chain steps |
| Peak load on 1h rides on the last day | A limit of "start before Sun 10:45 / 11:00 UTC" (see [`../spec/pool.md`](../spec/pool.md) `POOL-M-04`) |
| RU-chat moderation | 2+ moderators, an anti-spam bot |

## 8. External owner tasks and open questions

- **External owner tasks by deadline (02.11 / 09.11 / 15–17.11 / by Season 1):** [`OWNER_TASKS.md`](OWNER_TASKS.md) (previously duplicated here as Q1, Q3, Q5, Q8, Q13, Q15).
- **Open legal and tax questions:** [`../spec/OPEN.md`](../spec/OPEN.md) (Q2; a consultation with a Serbian lawyer and an international lawyer is deferred by the owner until after Pre-season).
- All Pre-season product questions (Q4, Q6, Q7, Q9, Q10, Q11, Q12, Q14, Q16) are decided and are included in the §9 table and in the Part II technical specification below.

## 9. Decision list — ✅ DECIDED 17.10.2026 (all ⭐ adopted)

| # | Question | Options | ⭐ = decision |
|---|---|---|---|
| D1 | Place of the mini-launch | A instead of the S1 start / B before S1 (02.11) / C in parallel | ✅ A |
| D2 | Dates | A registration 02.11, week 09–15.11 / B week 02–08.11 / C 16–22.11 | ✅ A |
| D3 | Season 1 mainnet | A 11.01.2027 / B 16.11 (5 weeks) / C 30.11 | ✅ A |
| D4 | Board | A one 1h / B 1h+4h+8h / C a new short mode | ✅ A |
| D5 | Distribution of $500 | A a top-20 table / B the PR #3 curve + a finishers' pool / C top 10 at $50 | ✅ A |
| D6 | Ties | A an equal split, with no tie-break by address / B as in PR #3 / C a second metric | ✅ A |
| D7 | Payout | A USDC mainnet from the event wallet / B USDT or a choice / C a bank / D a personal wallet | ✅ A |
| D8 | Countries | A CIS without RU/BY for prizes, RU/BY play with no prizes / B full admission of RU/BY / C a block of RU/BY | ✅ A |
| D9 | Campaign steps | A a test + Telegram are mandatory, X and Discord are optional / B all are mandatory / C the test only | ✅ round 19: a test + Telegram + X (a follow + a post with a code); Discord is optional |
| D10 | Anti-sybil | A Telegram 1:1, Turnstile, an IP cluster ≤ 1 place, a manual review of the top 20 (round 19: no Didit) / B + trust ≥ 50 / C KYC for everyone | ✅ A |
| D11 | Flags | Paid, Solana Pay, the weekly ticket, promo codes, a gift to a friend, TEN4 Convoy, v1 SOL shares — off; Convoy linking on | ✅ see §1 and §10 |
| D12 | Localization | A a RU/EN dictionary without the HUD / B full, including the game / C the landing only | ✅ A (§13) |
| D13 | An identity check without a legal entity | A Didit (if available to a natural person) / B liveness only + anti-sybil / C no KYC + a limit / D a video check | ✅ strict anti-sybil + a manual review (§14; Didit optionally later) |

---

# Part II. Technical specification and operational runbook (C2–C8)

> Closes specifications G2, G6–G11, G13–G14, G16 from [`MASTER_PLAN.md`](MASTER_PLAN.md) §12. Legal texts: [`../legal/PRESEASON_RULES.md`](../legal/PRESEASON_RULES.md) (EN) and [`../legal/PRESEASON_RULES_RU.md`](../legal/PRESEASON_RULES_RU.md) (RU).

## 10. Configuration keys of Pre-season mode (`player.GameSetting`)

All parameters are controlled through the signed Admin Settings API (without hardcoding in the code):

| Key | Value for Pre-season | Description |
|---|---|---|
| `event_mode_enabled` | `1` | Turns on Pre-season event mode (one 1h attempt, a fixed $500 table) |
| `event_id` | `preseason-2026-11` | Identifier of the campaign / event |
| `event_registration_start_utc` | `2026-11-02T00:00:00Z` | Opening of the tasks page and of Telegram / X linking |
| `event_week_start_utc` | `2026-11-09T00:00:00Z` | Opening of the start of the ranked 1h attempt |
| `event_last_start_utc` | `2026-11-15T11:00:00Z` | The last allowed moment to start the 1h attempt (1 h before the window closes; per decision 36 in [`../spec/pool.md`](../spec/pool.md) `POOL-M-04` the target rule is 1 h 15 min before) |
| `event_week_end_utc` | `2026-11-15T12:00:00Z` | Closing of the prize window (the attempt MUST finish before this moment) |
| `event_review_end_utc` | `2026-11-16T12:00:00Z` | Publication of the preliminary top 20 |
| `event_appeals_end_utc` | `2026-11-17T12:00:00Z` | Closing of the appeals window and the start of payouts |
| `event_tier` | `1h` | The only ranked tier of the event |
| `event_prize_table_cents` | `10000,7000,5000,3000,3000,2000,2000,2000,2000,2000,1200,1200,1200,1200,1200,1200,1200,1200,1200,1200` | The prize table for places 1–20 in US cents (the sum = `50000` = $500.00) |
| `weekly_ticket_1h_enabled` | `0` | Turns off the automatic weekly 1h ticket (so that there is no second attempt) |
| `weekly_ticket_4h_enabled` | `0` | Off |
| `weekly_ticket_8h_enabled` | `0` | Off |
| `referral_referee_promo_enabled` | `0` | Turns off the gifted 1h promo ride to a friend (otherwise a second attempt) |
| `referral_ten4_enabled` | `0` | Turns off accrual of Convoy TEN4 milestones for the duration of the devnet event |
| `referral_pool_share_bps` | `0` | Turns off the v1 referral SOL share from pools |
| `referral_donation_share_bps` | `0` | Turns off the v1 referral SOL share from donations (`LEG-M-02`) |
| `turnstile_enabled` | `1` | Turns on Cloudflare Turnstile on social linking and on attempt issuance |
| `geo_prize_play_only_countries` | `RU,BY` | Countries admitted to free play, to the tasks, and to the leaderboard, but **with no right to monetary prizes** |
| `geo_block_countries` | `CU,IR,KP,SY` | A full block |
| `geo_block_regions` | `UA-43,UA-14,UA-09` | A full block (Crimea, DPR, LPR) |
| `geo_block_us_states_paid` | `SC,AZ,LA,AR,DE,MT,TN` | US states not admitted to prizes |

## 11. Specification of issuing the single attempt and of the task campaign (C2, C3 — G2, G6)

**As-built update (2026-10-26):** the local task panel, signed channel/group checks, authenticated group-activity webhook, X durable cache/budget reservation and single-attempt issuance are implemented. Actual routes retain `/api/airdrop/verify-telegram` and `/verify-x`; event claims use `/api/airdrop/preseason/claim-attempt`. Event identity is the reserved promo code `SYSTEM-PRESEASON-2026-11`, and progress/consent lives in `player.AirdropClaim`, rather than introducing a second participant ledger. Event knobs default off; timestamps are integer UTC epoch seconds and the last-start margin is 75 minutes. Points weights and real provider acceptance still need owner input; no future TEN4 is minted. See [`CAMPAIGN_LOCAL.md`](../testing/CAMPAIGN_LOCAL.md).

### 11.1 Mandatory steps of campaign `preseason-2026-11` (round 19)
To receive the single 1h prize attempt, a participant MUST complete all 4 mandatory steps:
1. **Age 18+ and agreement to the rules:** `PUT /api/profile/agreements` (`age18: true`, `termsVersion: '2026-10-17'`, `preseasonRulesAccepted: true`).
2. **Qualifying training:** at least 1 completed online ride with status `verified` at level **MEDIUM (`level = 2`, `free-2c`)** or **HARD (`level = 3`, `free-3c`)**.
3. **Telegram (1:1 linking + a subscription + participation in the chat):**
   - Sign-in through the official Telegram Login Widget (`POST /api/airdrop/telegram/link`), an HMAC-SHA256 check of the widget signature with the `TELEGRAM_BOT_TOKEN` token.
   - A unique constraint in the DB: one `telegramUserId` can be linked to only one wallet for the whole time of the campaign (`UNIQUE (telegram_user_id)`). Unlinking or a transfer to another wallet is forbidden.
   - A check through the Bot API `getChatMember(chat_id, user_id)` in the channel `TELEGRAM_CHANNEL_ID` and in the group `TELEGRAM_GROUP_ID`: the status MUST be `member`, `administrator`, or `creator` (not `left` and not `kicked`).
   - In the group the bot also records at least 1 meaningful message from `telegram_user_id` (`telegram_chat_active = true`).
4. **X (Twitter) — a mandatory step (round 19):**
   - The participant publishes a public post (or a quote of the campaign announcement) with text about participation, a mention of `@FreightChainSol`, and their unique code of the form `FC-XXXX`, and submits the post URL/ID to `POST /api/airdrop/x/verify`.
   - The server fetches the post by ID through `twitterapi.io`, checks that the code `FC-XXXX` is present, links `xUserId` to the wallet (`UNIQUE (x_user_id)`, 1:1), and checks the follow of `@FreightChainSol` by calling `check_follow_relationship`.
   - Caching of the result: a repeat request to `twitterapi.io` is allowed no more than once per 10 minutes per wallet; total spend is limited by the counter `airdrop_twitterapi_budget_usd = 100`.
5. **An optional step (a bonus to Season 1 airdrop points):** Discord linking (OAuth2 `identify`).

### 11.2 Issuance of the attempt and blocking of repeat attempts
- As soon as steps 1–4 are done and the Cloudflare Turnstile token is checked, the call `POST /api/airdrop/preseason/claim-attempt` (under `findByWalletForUpdate`) creates exactly one `PromoRideGrant` record with `source = 'event:preseason-2026-11'`, `tier = '1h'`, `rankedEligible = true`.
- At the same time, points for the campaign steps are credited into the `airdrop.Participant` table (they count toward the Season 1 pool of 2M TEN4, with a ceiling of 2,000 TEN4 per wallet).
- During `event_week_start_utc .. event_last_start_utc`, when `event_mode_enabled = 1`:
  - `POST /api/rides` with `{ tier: '1h', ranked: true }` is allowed **only** when there is an unused grant `source = 'event:preseason-2026-11'` and `rankedStartsThisWeek == 0`.
  - Any promo codes of the `ride` and `tickets` kinds are blocked for a ranked start for the duration of `event_mode_enabled = 1`.
  - Free training (`tier: 'free'`, levels 1–3) stays unlimited and never spends the prize attempt.

## 12. Specification of the prize and tie calculation for the fixed $500 table (C2 — G2, G14)

**As-built update (2026-10-28):** implemented locally in `server/src/domain/prize/event-settlement.ts` (a sibling of `prize-pool.ts`, which is near its line limit) as `settleFixedTableBoard`, with the review/lock/payout-record flow of §14-§15 (signed admin API `/api/admin/event*`, tab `EVENT TOP-20`, public `GET /api/event/board`; migration `20261123000000_event_settlement`; behaviour in [`PRODUCT.md`](../spec/PRODUCT.md)). Deviations from the text below: `event_prize_table_cents` is a list and cannot be a one-integer `GameSetting`, so it lives on `economy.EventConfig` (default = the table above, changed by a signed admin action, frozen by the lock); `event_id` and `event_tier` are code constants; `event_review_end_utc` / `event_appeals_end_utc` are integer epoch-second settings. Sanctions screening is a port with a deterministic local fake (live Chainalysis/OFAC stays owner-gated, SPC-08.4); the payout record is manual (`PAYOUT_SECRET` unused). Not built: an appeal intake for event rides and an automatic VPN/ASN, Telegram/X or funding-source re-check inside the tab (the tab shows Trust, geo, ride id and subnet-HMAC overlaps; the other §14 checks remain manual).

A pure function `settleFixedTableBoard(entries, prizeTableCents)` is added in `server/src/domain/prize/prize-pool.ts`:
1. The input is all verified attempts of the event (`verdict = 'verified'`, `ranked = true`, not disqualified, and from countries admitted to prizes) and a `prizeTableCents` array of 20 values (`[10000, 7000, 5000, 3000, 3000, 2000×5, 1200×10]`).
2. Sort by skill: descending `cleanBps` (`round(cleanMetres * 10000 / completeDist)`).
3. **Tie rule (D6 / round 15):** participants with the same `cleanBps` form a tie group on places `k .. k + m - 1` and split the prize sum of those places equally:
   - `eachCents = Math.floor(sum(prizeTableCents[k .. k + m - 1]) / m)`, the division remainder in cents (< `m` cents) stays unallocated.
   - A tie-break by submission time or by wallet address **is not used**.
4. **Unclaimed places (Q11):** if verified finishers admitted to prizes are `F < 20`, places `F + 1 .. 20` are not paid and stay with the Organizer.
5. **A shift on disqualification (Q11):** if a participant from the top 20 is disqualified or is a resident of `RU/BY`, they are excluded from the prize calculation before places are distributed (or marked `prizeEligible = false`), and admitted participants below shift up.

## 13. Specification of RU/EN localization and of geo status in the UI (C4, C5 — G8, G9, G10)

### 13.1 Dictionary `client/site/i18n.js`
- It exports `getLang()`, `setLang(lang)` (`'ru' | 'en'`, stored in `store('fc_lang')`, the default is taken from `navigator.language`: if it starts with `ru`, `uk`, `be`, `kk`, `uz`, `ky` — `'ru'`, otherwise `'en'`) and a pure function `t(key, vars)`.
- Applied through `data-i18n="key"` and `textContent` (no `innerHTML`; the security test `landing/test/pools.test.js` is complied with).
- The HUD inside `play.html` stays in English (short instrument labels `SPD`, `RPM`, `GEAR`, `HULL`, `COOLANT`).

### 13.2 Display of geo status (`GET /api/me` → `geo`)
`GET /api/me` returns the object `geo: { country, region, access: 'eligible' | 'play_only_no_prizes' | 'blocked', reason }`:
- `'eligible'` (KZ, UZ, KG, AM, AZ, GE, MD, UA except the occupied regions, and others): a green badge `Eligible for Pre-season prizes` (also shipped in the Russian locale).
- `'play_only_no_prizes'` (`RU`, `BY`, and also the 7 US states): a yellow banner on the event page and before the start of the ranked attempt:
  - RU: *"Your region (RU/BY) is admitted to free training, Season 1 airdrop tasks, and the leaderboard, but does not take part in the distribution of USDC monetary prizes (Pre-season Rules, clause 3)"* (also shipped in the Russian locale).
- `'blocked'` (`CU, IR, KP, SY`, `UA-43, UA-14, UA-09`) or `vpnDetected = true`: a red banner; on VPN — *"Turn off VPN/proxy to complete the tasks and start the qualifying attempt"* (also shipped in the Russian locale).

### 13.3 Modal for 18+ and for acceptance of the rules (C6 — G11)
- On the first wallet connection in the lobby, and before the attempt is received, a modal opens with two checkboxes:
  1. `I am 18 (or the age of majority in my country)` (also shipped in the Russian locale).
  2. `I have read and accept the Terms of Use, the Privacy Policy, and the Pre-season Rules` (with links to `/terms`, `/privacy`, `/preseason-rules`, and the Russian summary; also shipped in the Russian locale).
- Submission stores a record in `player.TermsAcceptance` (`wallet`, `termsVersion`, `acceptedAt`, `ipHash`).

## 14. Runbook for the manual review of the top 20 (15.11 12:00 UTC – 16.11 12:00 UTC, task C7 — G7)

Immediately after the prize week closes (Sun 15.11 12:00 UTC), the administrator opens the `EVENT TOP-20` tab in admin (or exports a candidate report with a top-35 margin in case of shifts) and goes through the checklist for each candidate from the top down:

1. **Geo and absence of a VPN:**
   - Check the country on all of the candidate's `SignIn` records and ride starts. If the country is `RU` or `BY` — status `play_only_no_prizes` (stays on the leaderboard with a badge "outside the prize standings", also shipped in the Russian locale; the prize passes to the next one).
   - Check that there are no VPN/datacenter ASN flags on the qualifying ride.
2. **A check of the ride and the telemetry (`ride-audit`):**
   - Run `bash .claude/skills/ride-audit/run.sh <rideId> --prod`. It MUST return `OK` (`verdict = verified`, a match of all batches, of the road, and of the 10 Hz `ReplayEngine`).
   - Open the replay in admin and visually review the key stretches (the start, overtakes, holes, the finish).
3. **A check of the social accounts (Telegram and X 1:1):**
   - Make sure the Telegram account is still in the channel and in the chat (`getChatMember`), has a photo/history, and is not an empty bot created on the same day as a batch of other finalists.
   - Open the link to the qualifying post on X: the post is not deleted, the code `FC-XXXX` matches, the account follows `@FreightChainSol`.
4. **A check of IP clusters and of the link graph (anti-sybil without documents, D13):**
   - Check the candidate's `ipPrefixHmac`: whether there are overlaps with other participants of the top 35 or with their own referrals.
   - Per rule D10: **no more than 1 prize place per IP cluster** when a second signal is present (a similar registration/ride time, a shared wallet-funding source Helius `funded-by`, same-type handles).
   - If it is found that one person controlled several wallets in the event — **all** wallets of that person are disqualified (`PRESEASON_RULES.md` §4, §6), and admitted finishers below shift up.
5. **Sanctions screening of the wallet (Chainalysis):**
   - Run an address check `GET https://public.chainalysis.com/api/v1/address/<wallet>` with the header `X-API-Key: $CHAINALYSIS_API_KEY`. The response MUST have `"identifications": []`. The check log is stored in the DB (`sanctions_checked_at`, `sanctions_clean = true`).
6. **Publication of the preliminary list (Mon 16.11 12:00 UTC):**
   - Publish the preliminary top 20 in the lobby and in the Telegram channel.
   - Take appeals for 24 hours (until Tue 17.11 12:00 UTC) through a ticket/form with a wallet signature.

## 15. Runbook for the $500 USDC payout and the public report (Tue 17.11 from 12:00 UTC, task C8 — G13)

1. After all appeals close (Tue 17.11 12:00 UTC), lock in the final list of winners (places 1–20) and the USDC amounts (per the table in §2, or with an equal split on a tie).
2. Re-confirm that, for every address in the final top 20, `sanctions_clean = true` (the check is not older than 24 h).
3. From the dedicated event wallet on **Solana mainnet** (`<EVENT_PRIZE_WALLET_MAINNET>`, with a balance of exactly `500.00 USDC` + `~0.15 SOL`), send SPL transfers of USDC (`EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`) to each winner, to their Solana play address.
4. For each transaction, record `txSignature` in admin (`POST /api/admin/event/payouts`).
5. Publish the final table on the event page, in the Telegram channel, and on X:
   - Place · Wallet (shortened) · `cleanBps` points · USDC amount · Link `https://solscan.io/tx/<signature>`.

## 16. Built-in devnet SOL faucet (in case it is needed — G16)

Sign-in to the game (SIWS), social linking, issuance of the attempt, and the qualifying 1h ride itself run **fully off-chain** (a message signature, with no transaction and no spend of devnet SOL). The devnet SOL faucet is needed only if a player wants to test optional on-chain functions on devnet:
- While `event_mode_enabled = 1`, the buttons for buying parts with SOL and for burning TEN4 on the spectator panel are hidden by default, or labeled `Devnet test only`.
- A link to the official faucet `https://faucet.solana.com/` is added in the profile, with the player's address filled in automatically.

## 17. Post-mortem plan and the decision on the December devnet event (24.11.2026)

One week after the payouts (Mon 24.11.2026), a review of the Pre-season results is held:
1. Funnel: landing visits → wallet connection → MEDIUM/HARD training → Telegram linking → an X check → receiving the attempt → the 1h finish.
2. The share of drop-off by geo (`RU/BY` with no prizes, refusals because of a VPN) and the spend of `twitterapi.io` credits.
3. The number of anti-sybil rule hits in the top 35, and the number of appeals.
4. On the results, the owner decides whether to run a second devnet round in December (by switching `event_id = 'preseason-2026-12'` and the `event_*` dates) or to put all resources into preparing **Season 1 on mainnet for 11.01.2027**.

---

## Sources (checked 17.10.2026)

- EU, Reg. 833/2014 Art. 5b: https://service.betterregulation.com/document/566141 ; European Commission FAQ on payment services and 5b(2): https://finance.ec.europa.eu/document/download/8b0e76f4-6a5e-4fd3-a85e-04d7ecdfe340_en ; 8th package: https://finance.ec.europa.eu/news/eu-agrees-eighth-package-sanctions-against-russia-2022-10-06_en
- EU, Reg. 765/2006 Art. 1u (Belarus): https://sip.lex.pl/akty-prawne/dzienniki-UE/rozporzadzenie-765-2006-dotyczace-srodkow-ograniczajacych-w-zwiazku-67607987/art-1-u ; 21st package: https://www.mayerbrown.com/en/insights/publications/2026/07/european-union-adopts-21st-package-against-russia-and-parallel-sanctions-on-belarus
- US, EO 14071 — definitions and categories: https://ofac.treasury.gov/faqs/1128 , https://ofac.treasury.gov/faqs/1034 , https://ofac.treasury.gov/system/files/126/determination_05082022_eo14071.pdf
- RF, 259-FZ Art. 14: https://www.consultant.ru/document/cons_doc_LAW_358753/176562423610280f8b2578ab3480887bf7707562/
- Didit: countries and documents — https://didit.me/solutions/countries/ , https://didit.me/solutions/countries/kazakhstan/ , https://docs.didit.me/business-verification/supported-countries
- Telegram `getChatMember`: https://core.telegram.org/bots/api/methods/getchatmember.md ; the registration date is unavailable: https://github.com/python-telegram-bot/python-telegram-bot/issues/3138
- Solana devnet faucet: https://faucet.solana.com/ , https://solana.com/docs/rpc/http/requestairdrop
