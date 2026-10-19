# FreightChain — consolidated plan (review)

Version 17.10.2026, round 19 (Pre-season on devnet, Season 1 moved to 11.01.2027, Pool v5 implemented in code). This is a summary of the owner's decisions. Details are in the files `docs/plan/*` and `docs/legal/*` (see `docs/plan/README.md`).

**Contents:** 0 Status · 1 Timeline · 2 Tokenomics · 3 Pools and prizes · 4 Seasons · 5 Tickets and rides · 6 Referral program (Convoy) · 7 Airdrop · 8 Anti-sybil and trust · 9 KYC and taxes · 10 Privacy, data, legal texts · 11 Infrastructure · 12 Code change plan · 13 Documents in the repository · 14 Open questions · 15 Audit log

---

## 0. Status and constraints

| What | State |
|---|---|
| `main` | PR #3 (`cursor/ten4-tokenomics-6271`) merged into `main` together with Pool Program v5 (`programs/freightchain_pools`), `programs/freightchain_honk`, the weekly skill contest (`server/src/domain/prize/`), promo rides, EASY, `docs/plan/`, `docs/legal/` |
| PR #3 | ✅ Merged into `main` (`SEASON_WEEKS = 7`, `LIVE_FINAL_WEEK = 7`, an equal split of ties, and ties on the top-8 boundary, are aligned in `server/src/domain/prize/`) |
| Pool Program v5 | **Implemented and covered by tests in the repo** (`Config 167`, `Series 132`, `Pool 362`, `set_pool_rules`, `8500/500/1000`, `max_player_share_bps <= 4999`, `paid_tickets_enabled`; 163 Rust tests + server unit/integration tests) |
| Deploy | Devnet cleanup and the v5 deploy — only on the owner's command |
| Publications and mailings | Only after the owner's approval |
| Documents in the repo | Plans in `docs/plan/`, legal templates in `docs/legal/` |

## 1. Timeline

| Date | Event |
|---|---|
| ✅ done | Merge of PR #3 into `main` (steps 1 and 4; the remaining Season 1 steps — per [`DEVNET_PRESEASON.md`](DEVNET_PRESEASON.md) §7 and §12 below) |
| on the owner's command (recommended after Pre-season, see §12 G17) | Devnet cleanup and deploy of pool v5 with a new program id (the v5 code is already in the repo; not required for Pre-season) |
| Mon 02.11.2026 | **Pre-season (devnet):** registration, mandatory campaign steps (a test ride + Telegram + X: a follow and a post with the code) |
| Mon 09.11 – Sun 15.11 12:00 | Pre-season: prize week, one 1h board, 1 qualifying attempt, fund $500 |
| until Mon 16.11 12:00 / until Tue 17.11 12:00 | Pre-season: review / appeals |
| from Tue 17.11 | Pre-season: USDC payouts on mainnet in person from the owner-organizer, from the event wallet (manual review of the top 20 with no documents, Chainalysis sanctions, a 72 h hold; no tax forms) |
| by 01.12 / by 20.12.2026 | Choice and registration of the operator legal entity (required for Season 1: paid tickets, TGE, full Terms) |
| Mon 11.01.2027 00:00 UTC | **Mainnet and the Season 1 start** (7 weeks; was 02.11.2026) |
| 22.02 – Sun 28.02.2027 12:00 | Week 7: regular boards + the final |
| from Tue 02.03.2027 | Payouts for week 7 and the final |
| 01.03 – 14.03.2027 | Break (2 weeks, decided) |
| Mon 15.03.2027 | Season 2 (8 weeks by default) |
| after 28.02.2027 and the snapshot (not before March 2027) | TEN4 TGE and the airdrop claim (merkle, a 90-day window) |

## 2. TEN4 v2 tokenomics

Specification: [`../spec/ten4.md`](../spec/ten4.md) · public page: [`../tech/ten4/index.html`](../tech/ten4/index.html).

| Bucket | TEN4 | Mechanics |
|---|---:|---|
| Liquidity | 15,000,000 | LP is burned in `initialize` |
| Ride rewards | 55,000,000 | Eras 27.5M → 13.75M → …; 75,000/day `>> era`; 2,000/day per wallet |
| Airdrop | 8,000,000 | Season 1 = 2M, cap 2,000 per wallet; a merkle claim at TGE, 90 days, then a burn |
| Referrals | 4,000,000 | Its own eras 2M/1M/…; payout `>> max(era_ref, era_ride)`; 60,000/month globally, 30,000/month for the first 3 months after `tge_at`; `burn_referral_tail` after era 8 |
| Treasury | 10,000,000 | Linear over 36 months, no cliff (`claim_treasury`) |
| Team | 8,000,000 | **Enabled**: a 12-month cliff + 24 months linear |
| **Total** | **100,000,000** | Mint authority is revoked in `initialize` |

- **Team vesting:** built into `freightchain_honk` (`claim_team`, PDA `[b"team"]`, `TEAM_CLIFF_MONTHS = 12`, a month = 30 days, from `config.opened_at`, the recipient is immutable, there is no cancellation). Call `initialize(team_enabled = true, team_linear_months = 24, team_recipient = the team Squads multisig)`. Streamflow and Squads Vesting are not needed.
- Rename "Convoy goal 1,000" → **Depot Goal 1,000**.
- TEN4 for a friend's purchases and Grant onboarding are abolished (round 9).

## 3. Pools and prizes

> The target weekly pool format (Tue evening → Sun evening + 1.5 days of review), the cancellation of donation effects, and the dynamic rating of the 1h ride are recorded in [`../spec/pool.md`](../spec/pool.md), [`../spec/rides.md`](../spec/rides.md), and [`../spec/replays_streams.md`](../spec/replays_streams.md). The current prize-board implementation on `main` (`server/src/domain/prize/prize-rules.ts`) is described in [`../spec/pool.md`](../spec/pool.md) Appendix C.

| Parameter | Value |
|---|---|
| Formula | `F = B + S`; `P = min(0.40·R, $2,500, 0.90·F)`; `T = F + P + C` |
| Base `B` | Tiers $300 / $750 / $1,500 / $3,000; a tier does not reset between seasons |
| Split of `T` | 85% boards / 5% rollover / 10% final |
| Boards | 1h 25% / 4h 30% / 8h 45%; within a board 80% places, 20% finisher pool |
| Ties | Decided: no tie-break by wallet address; equal results split the sum of the occupied places equally — on all boards (Pre-season, Season 1+, final) |
| Rollover | Cap `C ≤ 25% F`, the surplus goes to the final; no jackpots |
| Player share | ≤ 47.4% in any pool (checked in code) |
| Final | Σ10% of the weeks + `B_final = $1,000` + sponsor; top 8 of each board; on a tie at the boundary everyone with the same place-sum gets through (decided; there may be > 8 finalists) |
| Final week | Regular boards + the final; its 10% goes into the same week's final; its 5% and the unpaid part of the final go into week 1 of the next season (cap 25% F) |
| Free tickets | Prizes ≤ 30% of the board's money (`free_prize_board_cap_bps = 3000`); the surplus goes to the next player with a purchased ticket, otherwise into rollover |
| Model | Skill contest (option B), not a lottery: no drawings, training does not participate |
| Treasury | A Squads multisig for now; USDC escrow (pool v6) — Season 2–3 |
| Ticket sales | **Solana Pay** into the treasury (`economy.TicketOrder`); the program as a "cash desk" is rejected |
| Donations | 100% to the driver; the referral program does not apply to them |

## 4. Seasons

Specification: [`../spec/pool.md`](../spec/pool.md) · Pre-season plan: [`DEVNET_PRESEASON.md`](DEVNET_PRESEASON.md).

- **Pre-season (devnet):** registration from 02.11.2026, the week of 09–15.11, payouts from 17.11; the season is `weeks = 1` with no final (or `event_*` keys); fund $500, top 20 (100 / 70 / 50 / 2×30 / 5×20 / 10×12), ties are split equally. The plan and the runbook are [`DEVNET_PRESEASON.md`](DEVNET_PRESEASON.md).
- Season 1 (mainnet): start **11.01.2027**, `weeks = 7`, `finalWeek = 7` (22–28.02.2027), payouts from 02.03, `breakUntil = 2027-03-15` (break 01–14.03 — decided); Season 2 — 15.03.2027 (decided).
- Week: Mon 00:00 – Sun 12:00 UTC (the target schedule is Tue–Sun — see [`../spec/pool.md`](../spec/pool.md) `POOL-M-01`); review until Mon 12:00, appeals until Tue 12:00, then payouts.
- Admin: CRUD of the `prize.Season` entity + `prize.SeasonRulesVersion` (a log and a signature); `SeasonService` replaces `SEASON_EPOCH = '2026-10-12'`; a ranked start outside a season → 409.
- Money parameters (B, caps, shares) are stored in Season.

## 5. Tickets and rides

> Target rules for ride and ticket types (only 1h is in the ranking) — [`../spec/rides.md`](../spec/rides.md) and [`../spec/promocodes.md`](../spec/promocodes.md). Implemented on `main`:

| Decision | Keys / where |
|---|---|
| Weekly paid ticket by tariff | `weekly_ticket_1h_enabled = 1`, `weekly_ticket_1h_days = 7`; `weekly_ticket_4h_enabled = 0`, `_4h_days = 7`; `weekly_ticket_8h_enabled = 0`, `_8h_days = 7`. An unused one burns at the start of the next interval or at Sun 12:00 UTC (whichever is earlier). Commit `a486c350` |
| Promo codes | One effect per code: a free 1h / 4h / 8h shift (`PromoRideGrant`, see [`../spec/promocodes.md`](../spec/promocodes.md)) |
| Training | Unlimited; not ranked, no TEN4, no stream |
| Offline mode | Replaced by a real EASY ride (`play.html` → `easy-entry.js`, a guest session) |
| Paid tickets | Solana Pay into the treasury (section 3) |

## 6. Referral program (Convoy)

Specification: [`../spec/referral.md`](../spec/referral.md) §2.

| Element | Decision |
|---|---|
| Statuses | `pending` for 72 h (it is deleted) → `active` (test: verified MEDIUM/HARD, not EASY) for 60 days → `qualified` (M1) → `expired` |
| Gift to a friend | A 1h promo ride after the test ride; limits of 3/day and 10/week per referrer, 500/week globally; once per wallet; not ranked |
| TEN4 milestones for the referrer | M1 = 100 (all mandatory steps of the airdrop campaign + qualifying rides in 2 different ISO weeks within 60 days); M2 = 50 (5 different weeks); 150 maximum from one friend |
| Qualifying ride | A paid 1h/4h/8h tariff, verified, ranked; a weekly ticket counts when the friend's trust is ≥ 100 |
| Referrer | trust ≥ 50; 1,000 TEN4/month; at the limit — a message, with no accrual and no queue; a 48 h hold |
| Slots | `min(100, 5 + 2·A)`, A — friends with ≥ 1 qualifying ride in 30 days |
| Convoy ranking | An address or an SNS name, 25 rows, "your place", hiding via `convoyHidden` |
| Restrictions | One level; no money and no shares of prizes or donations; there is no streamer program |
| Between campaigns | The last campaign's tasks are the "Convoy steps" |

## 7. Airdrop

Specification: [`../spec/ten4.md`](../spec/ten4.md) §4.2 · Pre-season tasks: [`DEVNET_PRESEASON.md`](DEVNET_PRESEASON.md) §11.

- Season 1: 2M of 8M, a cap of 2,000 TEN4 per wallet, a claim at TGE (merkle, receipt `[b"airdrop", campaign, wallet]`, `burn_unclaimed` after 90 days). The snapshot is after the end of Season 1 (28.02.2027); TGE is not before March 2027.
- **The set of mandatory steps is defined per campaign** (`requiredTasks`). Pre-season (round 19): a test ride + Telegram (channel and chat) + X (a follow of @FreightChainSol + a participation post with a personal code) are mandatory; Discord is optional; Pre-season points count toward Season 1 (a question for the owner — confirm). Convoy milestones M1/M2 require the current campaign's mandatory set.
- Tasks: a mandatory test ride (MEDIUM/HARD), X (a follow; likes and reposts are not checked), Telegram, Discord.
- X via **twitterapi.io**, with no OAuth: binding by a quote post with a personal code; budget `airdrop_twitterapi_budget_usd = 100` per campaign; if an X task fails it is "pending", and the snapshot is postponed.
- Threshold `airdrop_min_trust = 50`; 1 wallet per IP cluster only on a second signal; Turnstile on binding (behind a flag).

## 8. Anti-sybil and trust

Specification: [`../spec/anticheat.md`](../spec/anticheat.md) (Appendix D) · Pre-season top-20 review: [`DEVNET_PRESEASON.md`](DEVNET_PRESEASON.md) §14.

| Block | Decision |
|---|---|
| A | By play: +15 for a day with a finish, at most 2 days a week, cap 100 |
| B | Fast paths: a ticket purchase, Seeker (SGT) = +100; World ID — Season 2; Human Passport — no |
| C | Prizes on free tickets ≤ 30% of the board |
| D | Didit KYC: a free ticket — any prize; a purchased ticket — from $50 per season; a 72 h hold; Chainalysis sanctions (fail-closed) |
| E | Helius Developer $49/month (`funded-by`); a 404 — no penalty, its own check |
| F | Shown to the player as a checklist (`trust_display_mode = checklist`) |
| G | IP cluster: ipinfo Core, mobile ASNs are excluded, a penalty only with a second signal |
| H | Referrer trust ≥ 50; airdrop trust ≥ 50 |
| I | A global cap on free starts for low trust — the key exists and is off |
| Socials | X +20, Discord +15, Telegram +5, cap 30 |
| Telemetry | Starting thresholds, shadow mode for 2 weeks, calibration after launch |
| IP | HMAC-SHA256(`IP_HASH_SECRET`, a /24 or /48 prefix), kept for 90 days |
| Browser fingerprint | Rejected ([`../spec/anticheat.md`](../spec/anticheat.md) Appendix D) |

## 9. KYC and taxes

Research and calculations: [`research/tax_thresholds.md`](research/tax_thresholds.md) · specification: [`../spec/legal.md`](../spec/legal.md).

| Decision | Key |
|---|---|
| W-9 / W-8BEN on the first payout, in one flow with Didit | `tax_form_required_on_first_payout = 1` |
| Annual accounting by calendar year, including TEN4 at FMV | `tax_year_basis = calendar`, `tax_include_ten4_fmv = 1` |
| 1099-MISC from $2,000 (2026) | `tax_1099_threshold_usd = 2000` |
| Amount — gross | `tax_amount_basis = gross` |
| Nonresident withholding is off until a consultation | `nra_withholding_enabled = 0` |
| KYC and payouts | `payout_kyc_free_any = 1`, `payout_kyc_paid_season_cents = 5000`, `payout_hold_hours = 72`, `payout_sanctions_check = 1` |

## 10. Privacy, data, legal texts

Specification: [`../spec/legal.md`](../spec/legal.md) · live texts: [`../legal/PRIVACY.md`](../legal/PRIVACY.md), [`../legal/TERMS.md`](../legal/TERMS.md), [`../legal/OFFICIAL_RULES.md`](../legal/OFFICIAL_RULES.md), [`../legal/PRESEASON_RULES.md`](../legal/PRESEASON_RULES.md).

| Topic | Decision |
|---|---|
| `player.SignIn` | Only `ipHash`, for 90 days; no raw IP and no user-agent |
| API and nginx logs | 30 days |
| PostHog | Stays; opt-out; 12 months; a DPA; `$ip` is not sent |
| Live chat | 90 days; donation text is wiped, payment records stay |
| AI editor | No player data (an allowlist, `redactOutbound()`) |
| Streams | There is no Twitch integration; PRIVACY cl. 13 records this |
| Age | 18+ (or the age of majority in the participant's jurisdiction, if it is higher) |
| Audience and language | English-speaking; for Pre-season the CIS and Russian are added (RU/EN: the landing, the lobby, the airdrop, the event page; the game HUD — EN) |
| Cookies | A notice with no consent banner (no advertising cookies; EU/UK are blocked) |
| Terms | **Draft ready**: [`../legal/TERMS.md`](../legal/TERMS.md) (EN, a template, 28 sections, 15 `[LAWYER]` items, a checklist, sources) — for a lawyer's review |
| Consent | An 18+ and Accept modal on the first connection; `termsVersion` per wallet + a `player.TermsAcceptance` log; on a version change, consent is required again, and until then 428 `terms_required` applies to anything paid, to prizes, rewards, and payouts; training and EASY need no consent |
| Pages | `/terms`, `/privacy`, `/rules` on the apex (Vite landing pages), with links in the footer, on the wallet screen, and in KYC and the airdrop |
| Pre-season, entry | Decided: the prize qualifying attempt is **only** for the mandatory airdrop tasks, and there is no other free entry. Risk: mandatory actions on social networks may count as non-monetary consideration — a question for a Serbian lawyer. "Repost" = a quote with a personal code; the mandatory set (round 19) is a test + Telegram (channel and chat) + an X follow + a participation post with the code; Discord is optional |
| Pre-season | The organizer is the owner as a natural person (no legal entity); the short rules and the data notice are [`../legal/PRESEASON_RULES.md`](../legal/PRESEASON_RULES.md); full Terms/Privacy come with Season 1 |
| Official Rules | ✅ The Season 1 template is ready in [`../legal/OFFICIAL_RULES.md`](../legal/OFFICIAL_RULES.md) (checked against `server/src/domain/prize/` and [`../spec/pool.md`](../spec/pool.md)) — for a lawyer's review |
| Processors in the policy | Cloudflare, twitterapi.io, Didit, Helius, ipinfo, Chainalysis, PostHog |

## 11. Infrastructure

Specification: [`../spec/admin_security.md`](../spec/admin_security.md), [`../spec/legal.md`](../spec/legal.md) (`LEG-M-01..03`), [`../tech/configuration.md`](../tech/configuration.md).

| Topic | Decision |
|---|---|
| Cloudflare | Free, proxy, Full (strict) + Origin CA (instead of Let's Encrypt) |
| Origin | The firewall allows only Cloudflare IPs (no Tunnel) |
| Real IP | nginx `real_ip` from `CF-Connecting-IP`; nginx sets `X-FC-Country` / `X-FC-Region` |
| Geo, edge | The WAF blocks countries: sanctioned (`CU, IR, KP, SY`) + `GB`, EU-27, `IS, LI, NO` |
| Geo, Pre-season | Prizes: KZ, UZ, KG, AM, AZ, GE, MD, UA (without UA-43/14/09) and the other admitted ones; RU/BY — play with no prizes until a lawyer |
| Geo, server | 451 for regions `UA-43`, `UA-14`, `UA-09` and states SC, AZ, LA, AR, DE, MT, TN (scope — cl. 14); `GEO_SOURCE = edge \| ipinfo` |
| Turnstile | Only on referral and airdrop bindings; `turnstile_enabled = 0` by default |
| Bot Fight Mode | Off until a test on staging |
| Services | Helius Developer $49/month, ipinfo Core, Chainalysis free API, Didit, twitterapi.io |

## 12. Code change plan and gap status (G1–G21)

| Step | Content |
|---|---|
| 1 | ✅ Merge PR #3 into `main`, keep the decisions from section 5, and align `SEASON_WEEKS = 7` + an equal split of ties in `server/src/domain/prize/` |
| 2 | Rework of the referral program ([`../spec/referral.md`](../spec/referral.md) §2) |
| 3 | ✅ The TEN4 bucket is an 8M airdrop + 4M referrals in `freightchain_honk` (`pay_referral`, `burn_referral_tail`, `set_airdrop_root`, `claim_airdrop`, `burn_unclaimed`); the team is enabled (`initialize` with `team_enabled = true`, 24 months; 40 Rust tests + `tokenomics.spec.ts` unit tests) |
| 4 | ✅ Pool v5 = v4 without referrals (+ audit `d5678764`, `abd24db7`), a unified pool model (`unifiedWeekPool`, `capRolloverCents`, a 30% cap on free tickets in `settleBoard`, a dynamic final `settleSeasonFinal` for `N` finalists — **implemented and tested in `programs/freightchain_pools` and `server/src/domain/prize/`**); Solana Pay (`G26`) |
| 4b–4g | Convoy ranking; seasons; airdrop; trust; privacy and geo; Cloudflare |
| 5 | Texts and documentation |
| 6 | Tests — the local and browser circuit ([`../testing/COVERAGE_CONTRACT.md`](../testing/COVERAGE_CONTRACT.md), [`../testing/IMPLEMENTATION_PLAN.md`](../testing/IMPLEMENTATION_PLAN.md)) |
| 7 | ✅ PR #3 is merged into `main` |

**Planned DB migrations (Season 1 / rework):** `20261104000000_referral_rework`, `20261104100000_referral_reward`, `20261104200000_seasons`, `20261105000000_prize_sponsor`, `20261105100000_ticket_orders`, `20261105200000_trust`, `20261105300000_tax`, `20261105400000_privacy` (+ `player.TermsAcceptance`), `20261107000000_airdrop`.

**Summary of the new `player.GameSetting` keys (details in §§5–11 and [`../tech/configuration.md`](../tech/configuration.md)):**

| Group | Keys and values |
|---|---|
| Weekly ticket (§5) | `weekly_ticket_{1h,4h,8h}_enabled` 1/0/0, `_days` 7/7/7 |
| Referral program (§6) | `referral_pending_ttl_hours` 72, `referral_qualify_window_days` 60, `referral_pending_base/_per_active/_max` 5/2/100, `referral_active_window_days` 30, `referral_ten4_m1_amount/_weeks` 100/2, `_m2_` 50/5, `referral_ten4_referrer_monthly` 1000, `referral_ten4_global_monthly` 60000, `referral_ten4_soft_start_monthly/_months` 30000/3, `referral_min_trust_referrer` 50, `referral_referee_promo_per_referrer_day/_week/_global_week` 3/10/500, `referral_referee_promo_ranked` 0, `referral_count_weekly_grant` 1 |
| Trust and Anti-sybil (§8) | `trust_threshold` 100, `trust_finish_points/_cap` 15/100, `trust_finish_days_per_week` 2, `trust_fast_paths` `paid,sgt`, `trust_social_cap` 30, `trust_ip_cluster_penalty` 50, `trust_display_mode` `checklist`, `antisybil_ip_retention_days` 90, `antisybil_ip_penalty_requires_second_signal` 1, `antisybil_ip_exclude_mobile_asn` 1, `antisybil_telemetry_shadow` 1 |
| Prizes, payouts, and the airdrop (§3, §7, §9) | `free_prize_board_cap_bps` 3000, `payout_hold_hours` 72, `payout_kyc_paid_season_cents` 5000, `airdrop_min_trust` 50, `airdrop_twitterapi_budget_usd` 100 |
| Geo and privacy (§10, §11) | `geo_block_countries`, `geo_block_regions`, `geo_block_us_states_paid`, `turnstile_enabled` 0, `SIGNIN_RETENTION_DAYS=90`, `LOG_RETENTION_DAYS=30`, `LIVE_CHAT_RETENTION_DAYS=90`, `analytics_default_enabled` 1 |

### Launch gap summary (G1–G21)

#### P0 — Pre-season launch blockers (registration 02.11, prize week 09–15.11.2026)

| # | Where | Status / What is needed | Who |
|---|---|---|---|
| **G1** | Infra: `deploy/nginx/`, `server/src/main.ts` | **Enable the Cloudflare proxy (orange cloud)**, `set_real_ip_from` for the Cloudflare ranges only, `real_ip_header CF-Connecting-IP`, and pass `X-FC-Country: $http_cf_ipcountry` (otherwise the client can forge `X-FC-Country`) | Code + Owner (DNS, [`OWNER_TASKS.md`](OWNER_TASKS.md) §1.2) |
| **G2–G3, G6–G11, G13–G14, G16** | Event mode, RU/EN rules, Telegram+X, the top-20 runbook, an RU/EN glossary, geo status, 18+/Terms, USDC payouts, the devnet faucet | ✅ **Specified** in [`DEVNET_PRESEASON.md`](DEVNET_PRESEASON.md) Part II (§10–16), [`../legal/PRESEASON_RULES.md`](../legal/PRESEASON_RULES.md), [`../legal/PRESEASON_RULES_RU.md`](../legal/PRESEASON_RULES_RU.md). Code implementation — tasks C2–C8 in [`DEVNET_PRESEASON.md`](DEVNET_PRESEASON.md) §7; external keys — [`OWNER_TASKS.md`](OWNER_TASKS.md) §1–3 | Code (C2–C8) + Owner |
| **G4 / G4a** | Organizer and legal entity | ✅ The owner runs Pre-season as a natural-person organizer (accepted risk, [`research/operator_entity_options.md`](research/operator_entity_options.md) §6–7). For Season 1: choose the legal entity by **01.12.2026**, register it by **20.12.2026** | Owner ([`OWNER_TASKS.md`](OWNER_TASKS.md) §4.1) |
| **G5** | Legal review | ⏸ Deferred by the owner until Season 1 (accepted risk). The list of questions for the lawyer and the tax adviser is in [`../spec/OPEN.md`](../spec/OPEN.md) §2 | Owner → lawyer by S1 |
| **G12** | Devnet RPC and the event wallet | A dedicated Helius devnet RPC (by 02.11) and a separate event wallet on Solana mainnet with `$500 USDC + ~0.15 SOL` (by 09.11) | Owner ([`OWNER_TASKS.md`](OWNER_TASKS.md) §1.3, §2.1) |

#### P1 / P2 — Tasks for Season 1 (mainnet 11.01.2027) and documentation alignment

| # | Where | Status / What is needed |
|---|---|---|
| **G15** | Team tokenomics in the DB | ✅ The `freightchain_honk` contract is ready (`team_enabled = true`, 24 months); when the mainnet indexer is connected, add the `team` bucket to `tokenomics.ts` |
| **G17** | Deploy of `freightchain_pools` v5 to devnet | ✅ The v5 code and 163 tests are ready in the repo; the devnet deploy with a new program id is on the owner's command ([`../tech/program-deploy.md`](../tech/program-deploy.md)) |
| **G18** | Week schedule (Tue–Sun vs Mon–Sun) | In [`../spec/pool.md`](../spec/pool.md) `POOL-M-01` the target format is Tue evening → Sun evening + 1.5 days of review; before Season 1, sync the pool parameters and the text of [`../legal/OFFICIAL_RULES.md`](../legal/OFFICIAL_RULES.md) |
| **G19–G20** | The 44 vs 34 cNFT badge count, and the dates in the pitch deck | Before Season 1, sync the number of SVG badges in `landing/src/pitchdeck/data.js` (`ACH`) and on the landing |
| **G21** | Secret validation when flags are on | In `env.schema.ts`, require the secrets (`TURNSTILE_SECRET_KEY`, `TELEGRAM_BOT_TOKEN`, `TWITTERAPI_KEY`, `CHAINALYSIS_API_KEY`) when the corresponding flag is on |

## 13. Documents in the repository

| Area | Current file in the repo |
|---|---|
| TEN4 tokenomics and the garage | [`docs/spec/ten4.md`](../spec/ten4.md), [`docs/tech/ten4/index.html`](../tech/ten4/index.html) |
| Pools, prizes, and the escrow contract | [`docs/spec/pool.md`](../spec/pool.md), [`docs/tech/pool-program/index.html`](../tech/pool-program/index.html), [`docs/tech/program-deploy.md`](../tech/program-deploy.md) |
| Referral program (Convoy) | [`docs/spec/referral.md`](../spec/referral.md) |
| Anti-cheat, telemetry, and sybil protection / TrustScore | [`docs/spec/anticheat.md`](../spec/anticheat.md) (incl. Appendix D), [`docs/tech/anti-cheat/index.html`](../tech/anti-cheat/index.html) |
| Pre-season plan, specification, and runbook | [`docs/plan/DEVNET_PRESEASON.md`](DEVNET_PRESEASON.md) (Parts I and II) |
| The owner's external tasks | [`docs/plan/OWNER_TASKS.md`](OWNER_TASKS.md) |
| Legal documents and the spec | [`docs/spec/legal.md`](../spec/legal.md), [`docs/legal/PRIVACY.md`](../legal/PRIVACY.md), [`docs/legal/TERMS.md`](../legal/TERMS.md), [`docs/legal/OFFICIAL_RULES.md`](../legal/OFFICIAL_RULES.md), [`docs/legal/PRESEASON_RULES.md`](../legal/PRESEASON_RULES.md), [`docs/legal/PRESEASON_RULES_RU.md`](../legal/PRESEASON_RULES_RU.md) |

## 14. Open questions and the owner's tasks

- **A single registry of open questions (lawyer, taxes, calibration after launch):** [`docs/spec/OPEN.md`](../spec/OPEN.md) (replaces the former duplicate list in this section and the deleted `OPEN_QUESTIONS.md`).
- **A single checklist of the owner's external tasks by deadline:** [`docs/plan/OWNER_TASKS.md`](OWNER_TASKS.md).

## 15. Audit log of the plans (rounds 12–19)

- **Round 12:** in the `freightchain_honk` tokenomics, a 100M supply and the team bucket are fixed (a 12-month cliff + 24 months linear, `claim_team`); `PRIVACY.md` records that there are no third-party streaming integrations; Season 1's final week = week 7; Solana Pay was chosen instead of a cash desk.
- **Round 13:** a draft of [`docs/legal/TERMS.md`](../legal/TERMS.md) was added and checked against `PRIVACY.md` (geo, socials, anti-cheat, a 90-day chat, no browser fingerprint) and against the pool and referral rules.
- **Round 14:** Pre-season on devnet was adopted ([`DEVNET_PRESEASON.md`](DEVNET_PRESEASON.md) D1–D12); the Season 1 mainnet start was moved to **11.01–28.02.2027** (payouts from 02.03, a break until 14.03, Season 2 from 15.03.2027); TGE is not before March 2027.
- **Rounds 15–16:** ties on all boards and in the final are split equally, with no tie-break by wallet address; when the place-sum is equal at the final-selection boundary, everyone gets through (`settleSeasonFinal` for `N` finalists).
- **Round 17:** the owner runs Pre-season as a natural-person organizer (a tax resident of Serbia, see [`research/operator_entity_options.md`](research/operator_entity_options.md) §6–7) and pays the prizes in person from a dedicated event wallet; US tax forms are not collected in Pre-season; a Chainalysis sanctions check is mandatory; the legal entity for Season 1 is chosen by 01.12.2026.
- **Rounds 18–19:** the Pre-season prize qualifying attempt is issued only for the campaign's mandatory task set (a MEDIUM/HARD test ride + the Telegram channel and chat + an X follow and a post with the code); there is no legal entity, no lawyer, and no Didit before Pre-season (a risk the owner accepted); the top-20 review is strict anti-sybil plus a manual review against the runbook in [`DEVNET_PRESEASON.md`](DEVNET_PRESEASON.md) §14.

