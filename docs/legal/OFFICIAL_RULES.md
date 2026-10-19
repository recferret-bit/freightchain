# FreightChain Official Contest Rules — Season 1 — TEMPLATE

> **DRAFT TEMPLATE — NOT LEGAL ADVICE. Must be reviewed and adapted by a qualified contest/gaming lawyer before Season 1 publication.**
> Repo path: `docs/legal/OFFICIAL_RULES.md` (published at `[PLACEHOLDER: https://freightchain.fun/rules]`).
> Supersedes the legacy fee-split contest rules draft for Season 1+. Governs weekly Prize Weeks (Weeks 1–6) and the Season 1 Final (Week 7) under the **unified operator + sponsor pool model** (`docs/plan/MASTER_PLAN.md` §3, §10, §13, §14).
> Replace every `[PLACEHOLDER: …]` and resolve remaining `[LAWYER: …]` annotations before Season 1 launch (`11.01.2027`).

---

**Rules Version:** `S1-1.0`
**Effective Date:** `[PLACEHOLDER: January 11, 2027]`
**Sponsor / Operator:** `[PLACEHOLDER: Company legal name]`, `[PLACEHOLDER: entity type and jurisdiction]`, `[PLACEHOLDER: registered address]` ("**Sponsor**", "**Operator**", "**FreightChain**", "**we**", "**us**").

**NO PURCHASE OR PAYMENT OF ANY KIND IS NECESSARY TO ENTER OR WIN. A PURCHASE WILL NOT INCREASE YOUR CHANCES OF WINNING UNDER THE FREE ENTRY ROUTE DESCRIBED IN SECTION 5, SUBJECT TO THE FREE-TICKET PRIZE CAP IN SECTION 8.5. VOID WHERE PROHIBITED BY LAW.**

---

## 1. Overview & Nature of Contest

1.1. **Skill Contest.** FreightChain Season 1 Weekly Contests and the Season 1 Final (each, a "**Contest**") are contests of **skill** governed by these Official Contest Rules ("**Official Rules**") and our [Terms of Service](TERMS.md) and [Privacy Policy](PRIVACY.md). If there is a conflict between these Official Rules and the Terms of Service on a Contest matter, these Official Rules control.

1.2. **No Wagering; No Random Draws.** Rankings are determined exclusively by objective in-game driving performance verified by the server at 10 Hz (Section 7). There are no random draws, lotteries, dice rolls or chance-based prize allocations. Ticket purchase revenue is Operator revenue for access to a paid-tier ride and is **never** pooled directly into player stakes.

---

## 2. Contest Schedule — Season 1

2.1. **Season 1 Duration.** Season 1 runs for **seven (7) consecutive weeks** starting Monday, **11 January 2027 at 00:00 UTC** and ending Monday, **1 March 2027 at 12:00 UTC** (followed by a 2-week off-season break):
- **Regular Prize Weeks (Weeks 1–6):** Six (6) weekly contests from Monday `00:00 UTC` to Sunday `12:00 UTC`.
- **Season 1 Final (Week 7):** One (1) championship week from Monday `22 February 2027 00:00 UTC` to Sunday `28 February 2027 12:00 UTC`.

2.2. **Weekly Cycle (UTC).** Every Prize Week follows the same schedule:
- **Board Open:** Monday `00:00 UTC`.
- **Last Start Cut-off:** A ride must be **started** early enough to finish before Sunday `12:00 UTC` (by Sunday `11:00 UTC` for the `1h` board, `08:00 UTC` for the `4h` board, and `04:00 UTC` for the `8h` board).
- **Board Close:** Sunday `12:00 UTC` (rides must finish at or before `12:00 UTC` to count for that week's board).
- **Anti-Cheat & Manual Review Window:** Sunday `12:00 UTC` – Monday `12:00 UTC` (24 hours).
- **Provisional Standings & Appeal Window:** Monday `12:00 UTC` – Tuesday `12:00 UTC` (24 hours).
- **Final Standings & Payout Hold Start:** Tuesday `12:00 UTC` (payouts execute after the 72-hour review/compliance hold and completion of required KYC, sanctions screening and tax forms under Section 10).

---

## 3. Eligibility

3.1. **Age.** Open only to natural persons who are at least **18 years of age** and the legal age of majority in their jurisdiction of residence at the time of entry (for example, 19 in Alabama and Nebraska; 21 in Mississippi `[LAWYER: confirm state age thresholds]`).

3.2. **Geographic Exclusions.**
- **Blocked Everywhere (No Access):** Residents of, or persons located in, the **United Kingdom**, the **European Union / European Economic Area (EU-27, Iceland, Liechtenstein, Norway)**, and comprehensively sanctioned jurisdictions (**Cuba, Iran, North Korea, Syria**, and the **Crimea, so-called Donetsk People's Republic and so-called Luhansk People's Republic** regions of Ukraine `[LAWYER: confirm final sanctions list, including RU/BY/VE status for Season 1]`).
- **Restricted US States (No Paid Tickets, Prizes, Airdrops or Referral Rewards):** Residents of, or persons located in, **Arizona, Arkansas, Delaware, Louisiana, Montana, South Carolina and Tennessee** (`geo_block_us_states_paid`).
- **VPN / Proxy Prohibition:** Accessing ranked rides or prize claims through a VPN, proxy, Tor or hosting/datacenter network is strictly prohibited and blocks paid/prize eligibility.

3.3. **Ineligible Persons.** Officers, directors, employees and contractors of the Operator, its parents and affiliates, any named Prize Week Sponsor (for the weeks they sponsor), and immediate family members (spouse, parents, siblings, children) and household members of each such person are not eligible to win prizes.

3.4. **One Person, One Wallet.** Each natural person may participate with **only one (1) Solana wallet** across all Contests, referrals and airdrops. Multi-accounting disqualifies **all** associated wallets and forfeits all prizes.

---

## 4. Contest Tiers & Weekly Attempt Limits

4.1. **Three Ranked Tiers.** Each regular Prize Week (Weeks 1–6) offers three independent leaderboard tiers based on nominal shift distance:
- **`1h` Tier:** ~1-hour nominal shift distance (`completeDist` at speed governor).
- **`4h` Tier:** ~4-hour nominal shift distance.
- **`8h` Tier:** ~8-hour nominal shift distance.

4.2. **Weekly Ranked Start Cap.** To prevent fatigue-based grinding and promote safe play, each wallet's counted ranked starts per Prize Week are capped at the **first five (5) declared paid starts** (where the weekly granted ticket counts as one of those five paid slots) plus the **first one (1) declared promo start** (`PAID_RANKED_STARTS = 5`, `PROMO_RANKED_STARTS = 1`). Additional purchased rides and unlimited free training rides remain available unranked at all times.

4.3. **Best Verified Score Counts.** If a player completes more than one counted ranked ride on a tier during a Prize Week, only the player's **single best verified ride** on that tier counts for that tier's leaderboard (`one prize place per wallet per board`). A player may compete on more than one tier (`1h`, `4h`, `8h`) in the same week.

---

## 5. How to Enter (Paid & Free Methods of Entry)

5.1. **Paid Ticket Entry.** Eligible players may purchase a `1h`, `4h`, or `8h` Ticket via **Solana Pay** at the published price (`[PLACEHOLDER: e.g. $5 / $15 / $50 in USDC or SOL equivalent]`) and declare a ranked ride before start during the Prize Week.

5.2. **Free Method of Entry (No Purchase Necessary).** Eligible players may enter without purchase by using:
- **(a) Weekly Granted Ticket:** Every eligible wallet receives **one (1) free `1h` Ticket every 7 days** (`weekly_ticket_1h_enabled = 1`, `weekly_ticket_1h_days = 7`). An unused weekly granted ticket expires at the next 7-day grant or at Sunday `12:00 UTC`, whichever is earlier (tickets do not stack). Declaring a weekly granted ticket ranked uses one of the five weekly paid ranked slots and does not mint TEN4. The Operator may also enable periodic free `4h` or `8h` granted tickets (`weekly_ticket_4h_enabled`, `weekly_ticket_8h_enabled`).
- **(b) Promo Code Ticket:** Eligible players may redeem an official single-use promo code granting a `1h`, `4h`, or `8h` ride (`PromoRideGrant`), which uses the separate weekly promo ranked slot (`PROMO_RANKED_STARTS = 1`) and does not mint TEN4.

5.3. **Equal Gameplay Rules.** Free-entry rides and purchased-ticket rides drive on identical road/weather generation rules and are judged by the exact same scoring and anti-cheat verification engine. Spectator road effects (obstacles, weather, day/night) are refused on all ranked rides (`rankedRoadEffects`). Prizes won using a free ticket (`source = 'weekly'` or `'promo'`) are subject to the **Free-Ticket Prize Cap** in Section 8.5 and require Didit KYC regardless of prize amount (Section 10.1).

---

## 6. Unified Prize Pool Funding Model

6.1. **Pool Formula.** Each Prize Week's total pool (`W_total`) is funded by the Operator and announced Sponsors, plus any rollover from the prior week (`Rollover_in`), according to the published formula:
- **Fixed External Funding (`F`):** `F = B + S`, where `B` is the Operator Base Pool (`BASE_STEPS_CENTS`: starts at **$300** and steps through **$300 / $750 / $1,500 / $3,000** after four consecutive weeks in which ticket revenue exceeds `4× B`, without resetting between seasons) and `S` is the announced External Sponsor contribution (`S ≥ $0`).
- **Prior-Week Activity Bonus (`P`):** Calculated strictly from the **previous** week's completed ticket revenue (`R_prev`), never from the current week's purchases:
  `P = min(0.40 × R_prev, $2,500, 0.90 × F)`
  Because `P ≤ 0.90 × F`, the activity bonus never exceeds **47.37%** (`0.90 / 1.90`) of the new weekly pool (`F + P`), ensuring that **more than 52.6% of every new weekly pool comes from fixed Operator and Sponsor funding (`F`)**.
- **Total Weekly Pool (`W_total`):** `W_total = F + P + Rollover_in`.

6.2. **Weekly Allocation Split (`85 / 5 / 10`).** Every regular Prize Week's `W_total` is allocated as follows:
- **85%** → **Current Week Board Prizes** (`W_boards = 0.85 × W_total`).
- **5%** → **Next Week Rollover Seed** (`0.05 × W_total`, subject to the Rollover Cap in Section 8.6).
- **10%** → **Season 1 Final Pool Reserve** (`0.10 × W_total`, accumulated across Weeks 1–6 for the Week 7 Final).

6.3. **Tier Split (`25% / 30% / 45%`).** Current Week Board Prizes (`W_boards`) are divided across the three tiers (`splitBoardCents`, leftover cent to `8h`):
- **`1h` Board (Sprint):** **25%** of `W_boards`
- **`4h` Board (Haul):** **30%** of `W_boards`
- **`8h` Board (Long Haul):** **45%** of `W_boards`

---

## 7. Scoring, Verification & Ties

7.1. **Objective Skill Scoring.** Every ranked ride is re-simulated and verified by the server at 10 Hz (`ReplayEngine`) against the authoritative seeded road, obstacles, holes and traffic proof. Rides are ranked by:
1. **Clean Completion / Fault-Free Distance Share (`cleanBps`, `0..10000`):** The basis-point share of the route completed before the first mistake (hull drop below 100 or collision), or full clean completion (`10000` bps = `100%`) at the finish line (`completeDist`).
2. **Driving Precision (`corrections`):** At a clean finish (`10000` bps), fewer steering corrections rank higher when measured. For a single wallet's own multiple attempts, `bestByWallet` retains the wallet's highest-scoring attempt (or earliest submission `submittedAt` if the wallet ties its own best score).

7.2. **No Timestamp or Wallet-Address Tie-Breaker Across Players.** Neither submission timestamp (`submittedAt`) nor alphabetical/numerical order of wallet addresses is used to break a tie between different wallets on any leaderboard (`ranksAbove`, `settleBoard`, `settleSeasonFinal`, `seasonQualifiers`).

7.3. **Equal Tie-Splitting.** Tied players occupying places `k` through `k + m - 1` share the same competition place `k` and **combine the prize amounts of all occupied places `k … k + m - 1` and divide the combined total equally** (`floor` to whole cents; odd cents roll over).

---

## 8. Board Prize Distribution, Minimums & Caps

8.1. **Minimum Board Participation (`≥ 10`).** A tier board (`1h`, `4h`, or `8h`) pays its full pool (`base + bonus + carry`) when at least **ten (10) unique eligible wallets** score on that board during the Prize Week (`MIN_BOARD_PARTICIPANTS = 10`). On a thin board (`< 10` unique wallets), only the **base share** is payable to the places achieved; the week's bonus share rolls one week, and any prior-week carry (`carryCents`) transfers to the Season Final (`toSeasonCents`) rather than rolling a second time.

8.2. **80% Places / 20% Finisher Pool (Regular Weeks 1–6).** On each board (`1h`, `4h`, `8h`), the board's payable pool (`B_tier`) is split into two parts (`PLACE_POOL_BPS = 8000`, `FINISHER_POOL_BPS = 2000`):
- **80% → Leaderboard Places** (`B_places = 0.80 × B_tier`). On a board of 100 participants or fewer (`TOP_PERCENT_OVER = 100`), the Top-10 shares (`PLACE_BPS`) are:

| Place | Share of Total Board Pool (`B_tier`) | Share of 80% Place Pool (`B_places`) |
|---|---:|---:|
| 1st | 25.0% | 31.250% |
| 2nd | 15.0% | 18.750% |
| 3rd | 10.0% | 12.500% |
| 4th | 7.5% | 9.375% |
| 5th | 7.5% | 9.375% |
| 6th–10th | 3.0% each | 3.750% each |
| **Total Top-10** | **80.0%** | **100.000%** |

  When more than 100 unique wallets score on a board (`participants > 100`), paid places extend to the **top 10%** (`ceil(participants / 10)` places) from the same 80% place pool on linear declining weights.
- **20% → Finisher Pool** (`B_finishers = 0.20 × B_tier`): Divided **equally** among all verified clean finishers (`cleanBps = 10000`, including top-10 finishers), with each finisher share **capped at the 10th-place prize amount**. Any unused Finisher Pool or cap excess rolls over under Section 8.6.

8.3. **Disqualifications & Upward Shift.** If a finisher in the paid places is disqualified during the review/appeal window, eligible verified finishers below move up prior to settlement. A winner who has not completed KYC remains on the leaderboard (`payout: false`) and their unpaid cents roll over under Section 8.6.

8.4. **Minimum Payout (`$5.00`).** Any calculated combined prize (`placeCents + finisherCents`) below **$5.00 USD** (`MIN_PAYOUT_CENTS = 500`) is **not paid out** in USDC and instead rolls over to the next week under Section 8.6.

8.5. **Free-Ticket Prize Cap (`30%`).** On each board (`1h`, `4h`, `8h`), the total prizes paid to entries driven on **free tickets** (weekly granted tickets or promo codes) cannot exceed **30% of that board's total prize pool** (`0.30 × B_tier`, `free_prize_board_cap_bps = 3000`):
- Free-ticket winners are funded in rank order (1st place downward) until the `0.30 × B_tier` cap is reached.
- Any prize amount above the `0.30 × B_tier` cap that would otherwise have gone to a free-ticket entry **passes down** to the next highest-ranked eligible finisher on that board who entered with a **purchased Ticket**, or, if all purchased-ticket finishers have been paid their full rank share, rolls over under Section 8.6.

8.6. **Rollover Cap (`25% of F`).** All unpaid, forfeited, sub-$5, thin-board bonus, and 5%-scheduled rollover amounts accumulate toward the next week's `Rollover_in`, capped at **25% of the next week's fixed external funding (`0.25 × F_next`)**. Any excess above `0.25 × F_next` (and any prior-week carry on a thin board) is transferred first to the **Season 1 Final Pool Reserve**, and if the Final has already concluded, carries to Week 1 of the next Season (subject to the `25% F` cap).

---

## 9. Season 1 Final (Week 7) — Qualification & Dynamic `N`-Finalist Table

9.1. **How to Qualify for the Season Final (`seasonQualifiers`).** Across regular Weeks 1–6, each board (`1h`, `4h`, `8h`) tracks every participant's **sum of weekly places** (`score`), where a missed week counts as `1000` (`MISSED_WEEK_PLACE = 1000`, worse than any real place so skipping a week never helps):
- The **Top 8 eligible players per board** (`SEASON_QUALIFIERS = 8`) with the **lowest sum of weekly places** at the close of Week 6 qualify for the **Season 1 Final**.
- **Ties at 8th Place Included:** If two or more players are tied on their sum of weekly places (`score`) at the 8th-place cutoff after Week 6, **all players tied at the 8th-place cutoff qualify** for the Season 1 Final (`N ≥ 8`, or `N < 8` if fewer than 8 eligible players compete).
- Every qualified finalist receives a **free Season Final Entry** (no purchase required or possible for the Final).

9.2. **Season Final Format & Pool (`Pool_Final`).** Week 7 (`LIVE_FINAL_WEEK = 7`) runs the regular weekly boards plus the Season 1 Final (with spectator road effects off). The Season Final Prize Pool (`Pool_Final`) equals the accumulated 10% weekly reserves from Weeks 1–7, plus the Operator Final Base (`B_final = $1,000`), plus any rollover excess (`toSeasonCents`) and announced Sponsor Final bonus.

9.3. **Dynamic `N`-Finalist Prize Distribution (Closing G21 / 2d).** Every qualified finalist who **completes** a verified championship ride in Week 7 wins a share of their Final board pool. Let `M` be the number of qualified finalists who complete a verified ride in the Final (`1 ≤ M ≤ N`):
- **Base Weights for Places 1 to 8 (`W_1 … W_8`):**
  - Place 1: `30`
  - Place 2: `20`
  - Place 3: `14`
  - Place 4: `10`
  - Place 5: `8`
  - Place 6: `7`
  - Place 7: `6`
  - Place 8: `5`
  *(Sum for `M = 8` is `100`%.)*
- **Case A — Exactly 8 Finishers (`M = 8`):** Places 1–8 receive `30%, 20%, 14%, 10%, 8%, 7%, 6%, 5%` of the Final pool (with equal tie-splitting under Section 7.3).
- **Case B — More than 8 Finishers due to 8th-Place Qualification Ties (`M > 8`):** Places `9 … M` each receive a base weight of `W_j = 5` (equal to 8th place), and **all weights `W_1 … W_M` are normalized proportionally** so that `Share_i = W_i / (100 + 5 × (M - 8)) × Pool_Final`. Every completing finalist is guaranteed at least `5 / (100 + 5 × (M - 8))` of `Pool_Final`.
- **Case C — Fewer than 8 Finishers (`1 ≤ M < 8`):** Places `1 … M` receive their stated percentages (`W_1 … W_M`), and the unclaimed weights for places `M + 1 … 8` roll over to Week 1 of Season 2 (subject to the `25% F` cap, not redistributed to inflate 1st place). If `M = 0`, `100%` rolls over to Season 2.

---

## 10. Winner Verification, KYC, Sanctions Screening & Taxes

10.1. **Identity Verification (Didit KYC).** Before any prize payout is released, the winner must pass identity verification through **Didit** (government ID, selfie liveness check, age 18+ and eligible residence verification):
- **Free-Ticket Winners:** Required for **every prize of any amount (`≥ $5.00`)** won on a weekly granted ticket or promo code (`payout_kyc_free_any = 1`).
- **Purchased-Ticket Winners:** Required once the wallet's cumulative prizes in the Season reach or exceed **$50.00 USD** (`payout_kyc_paid_season_cents = 5000`), or at any amount if flagged by anti-cheat / risk review.

10.2. **Sanctions Screening.** Every prize payout is screened against OFAC SDN and international sanctions lists via **Chainalysis** (wallet screening) and **Didit** (name/document screening). Any positive match or sanctioned funding link results in immediate disqualification and prize forfeiture.

10.3. **Tax Forms (W-9 / W-8BEN) & Reporting.**
- Before receiving a **first prize payout of any amount**, every winner must submit a valid **IRS Form W-9** (US persons) or **Form W-8BEN** (non-US persons) in the payout compliance flow (`tax_form_required_on_first_payout = 1`).
- We maintain a calendar-year prize tally per winner in USD (USDC at `$1.00`; any TEN4 reward at fair market value on the award timestamp). If a US person's cumulative prizes reach **$2,000.00** in a calendar year (`tax_1099_threshold_usd = 2000`), we issue **Form 1099-MISC**.
- All prizes are awarded gross unless withholding is required by law `[LAWYER/TAX: confirm non-US withholding setting]`. **Winners are solely responsible for all federal, state, local and foreign taxes.**

10.4. **72-Hour Hold & Claim Deadline.** All prize payouts are subject to a minimum **72-hour compliance and review hold** after weekly standings close (`payout_hold_hours = 72`). A winner who fails to complete required KYC or tax forms within **ninety (90) days** `[LAWYER: confirm 90-day claim window]` of in-app notification forfeits the prize, which rolls over under Section 8.6.

---

## 11. Anti-Cheat, Appeals & Outages

11.1. **Anti-Cheat Review.** All ranked rides undergo automated 10 Hz replay verification, Trust Score evaluation, wallet-funding cluster checks (Helius) and keyed IP-prefix cluster checks. Flagged rides enter manual review before standings are finalized.

11.2. **Appeals.** Players may appeal a provisional ride rejection, disqualification or board placement during the **24-hour Appeal Window** (Monday `12:00 UTC` to Tuesday `12:00 UTC`) via `[PLACEHOLDER: appeal portal / email]`. Decisions after manual appeal review are final for Contest administration.

11.3. **Server Outages & Contest Cancellation.**
- If a verified server-side outage interrupts a running ranked ride, the player's Ticket (`1h`, `4h`, or `8h`) is automatically restored (or refunded on request for purchased tickets).
- If an extraordinary technical, security or legal event requires cancelling a running Prize Week before Sunday `12:00 UTC`, all purchased Tickets used on that week's boards are restored/refunded and the fixed pool (`F + Rollover_in`) carries forward to the next Prize Week `[LAWYER: confirm cancellation fallback]`.

---

## 12. Convoy Referral Program Summary

The **Convoy** referral program is governed by Section 12 of the [Terms of Service](TERMS.md). Convoy rewards consist solely of single-level **TEN4 utility token milestones** (`100 TEN4` at Milestone 1 + `50 TEN4` at Milestone 2, subject to era halving, referrer Trust Score ≥ 50 (`referral_min_trust_referrer = 50`), 48-hour hold, and monthly caps) earned when directly referred friends complete verification and play ranked rides across separate weeks. Convoy does **not** award cash, SOL, USDC or any share of ticket purchases or prize pools, and does not affect Contest leaderboard rankings.

---

## 13. Publicity & Winner List

By accepting a prize, each winner consents (where permitted by law without additional compensation) to the public display of their shortened wallet address (or `.sol` name / chosen handle), rank, ride replay, score and on-chain payout transaction signature on the FreightChain leaderboards and official channels. For a copy of the official winner list for any Season 1 Prize Week, visit `[PLACEHOLDER: https://freightchain.fun/leaderboard]` or email `[PLACEHOLDER: support email]` within 90 days after the Contest closes.
