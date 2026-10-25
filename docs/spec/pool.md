# Pool — spec and test plan

> A weekly pool, schedule parameters, tickets, the last start, ticket burn, a 1.5-day review, appeals, and the v5/v6 contract. Decisions 34–37, and the owner's decisions of 17.10.2026 (round 22). The detail is Appendix A (the former §20 of `anticheat_test_plan.md` (superseded, merged into docs/spec), unchanged) and Appendix B (an extract from [`MASTER_PLAN.md`](../plan/MASTER_PLAN.md) §3 and §5).

## Part 1. Spec
### 1.1 In the code now
The pool program v5 (`origin/main`, `programs/freightchain_pools`):
- `Pool.prep_deadline` / `play_deadline` / `payout_at`, and a snapshot of `min_review_secs`;
- `buy_ticket.rs:50` `PaidTicketsDisabled`, `:52` `require!(now < pool.prep_deadline, TooLate)`;
- `DEFAULT_MIN_FINISH_SECS = 10_800`;
- on a series, `sale_secs` is both the window and the cadence.

The backend is `pool-registry.service.ts`, `Pool.fromChain`. `set_pool_rules` has no HTTP route (decision 70, 24.10.2026). The admin signs `pool-admin.mjs set-pool-rules`.

### 1.2 Rules
- **POOL-M-01** MUST: for now, one pool per week. The schedule is **configurable fields**, not constants:
  - `opens_at` (Tue evening by default);
  - `sales_close_at = prep_deadline` (close − 2 h);
  - `last_start_at` (close − 1 h 15 min, decision 36; play close when that instant is before the pool opened, so a window shorter than the lead can still be entered);
  - `play_close_at = play_deadline` (Sun evening);
  - `validation_until = payout_at` (close + 1.5 days).
- **POOL-M-02** MUST: the backend config (`POOL_SCHEDULE_*`) is used only when **creating** a pool. For a live pool, the source of truth is the on-chain account. A mismatch → the pool is not served, `409 pool_schedule_mismatch` + an alert in the admin.
- **POOL-M-03** MUST: after `sales_close_at` a ticket is not sold (the program: `TooLate`; the UI: no button).
- **POOL-M-04** MUST: a start after `last_start_at` → `409 pool_last_start_passed`. A ride started on time keeps being recorded until `play_close_at` + 60 s. One not finished by that moment is `abandoned` (decision 36; the limit → RID-M-09).
- **POOL-M-05** MUST: the operator and sponsors fund the major pool (`> 50%`), and optional paid tickets (`< 50%` cap) buy extra ranked attempts. There is **no minimum ticket-sale threshold (`min_tickets`) for a pool to open or run, and no refund if few or no tickets are sold**. Once a paid ticket is bought, it is immediately final and non-refundable; a ticket not started before `last_start_at` **burns with no refund**. The only exceptions are a verified server-side outage (`> 30 min`) or administrative pool cancellation (`cancel_pool` / 14-day unsettled `expire_pool` safety net). The purchase UI shows the close time and the last start in local time, a warning, and a checkbox.
- **POOL-M-06** MUST: the devnet launch has no paid tickets (`PaidTicketsDisabled`). An attempt is for airdrop tasks ([`PRESEASON_RULES.md`](../legal/PRESEASON_RULES.md) §2), one per person (§6). An attempt not started before `last_start_at` is lost.
- **POOL-M-07** MUST: a 1.5-day review: the final verdict → `pool:attention` → a manual check of the top 20 → `commit_winners` no later than `payout_at` → payouts.
- **POOL-M-08** MUST: results are published at `payout_at`, then an **appeals** window (the length is a schedule parameter). Payout for disputed places waits for the decision; payout for undisputed places does not.
- **POOL-M-09** MUST: replays and the road plan of pool rides are public after `payout_at` (decision 34 → [`replays_streams.md`](replays_streams.md) RPL-M-04).
- **POOL-M-10** MUST: for now, `Config.min_finish_secs ≤ 7 200` via `set_config`. In v6 — `opens_at`, `last_start_at` (or `start_buffer_secs`), and `period_secs` on the series. Existing fields are not renamed (decision 37).
- **POOL-M-11** MUST: the rules of a paid pool (later) state explicitly where the money of unplayed tickets goes: Solana Pay → revenue `R`; on-chain `buy_ticket` → the pool bank (open, [`OPEN.md`](OPEN.md)).
- **POOL-M-12** MUST: `set_pool_rules` has no admin HTTP route (decision 70, 24.10.2026, which withdraws backend decision 8 for this route). The command is `pool-admin.mjs set-pool-rules`. On mainnet the instruction goes through Squads (decision 60).
- **POOL-M-13** MUST: the pool's ranking formula is published before `opens_at` and does not change until `play_close_at` (decision 42 → RID-M-17).
- **POOL-M-14** MUST: donations are not an entry into the pool and give no advantage (TERMS 14.5).

## Part 2. Test plan
| id | Rule | Scenario | Expected |
|---|---|---|---|
| POOL-T-01 | M-01 | creating a pool with the default config | fields = Tue/Sun/−2 h/−1 h 15 min/+1.5 days from the given point; the time zone comes from the config |
| POOL-T-02 | M-02 | on-chain `play_deadline` ≠ the backend | `409 pool_schedule_mismatch`, an alert |
| POOL-T-03 | M-03 | `buy_ticket` 1 s before and 1 s after `prep_deadline` (LiteSVM) | success / `TooLate` |
| POOL-T-04 | M-04 | a start at `last_start_at − 1 s` and at `+1 s` | 200 / `409 pool_last_start_passed` |
| POOL-T-05 | M-04 | a ride is still going at `play_close_at + 61 s` | `abandoned`, distance covered is counted |
| POOL-T-06 | M-05 | a ticket was not started | after `last_start_at` the status is "burned"; there is no refund |
| POOL-T-07 | M-05 | pool funded by operator/sponsor with 0 or few paid tickets sold | pool runs (`Active`) and settles normally with no `min_tickets` failure or low-sales refund; only admin `cancel_pool` or 14-day unsettled `expire_pool` refunds |
| POOL-T-08 | M-06 | devnet: `buy_ticket` | `PaidTicketsDisabled`; one attempt from the tasks |
| POOL-T-09 | M-07 | 2,000 rides in the queue at close (= AC-P9, a variant) | review < 2 h; `commit_winners` ≤ `payout_at` |
| POOL-T-10 | M-08 | an appeal on 3rd place | 1st and 2nd are paid; 3rd waits |
| POOL-T-11 | M-09 | a replay before/after `payout_at` | = RPL-T-09 |
| POOL-T-12 | M-10 | `create_pool` with a 2 h window at `min_finish_secs = 10 800` / 7,200 | `WindowTooShort` / success |
| POOL-T-13 | M-11 | the text of the paid-pool rules | the money mode is named (a document check, [`legal.md`](legal.md)) |
| POOL-T-14 | M-12 | No `POST /api/admin/pools/:id/rules`. `pool-admin.mjs set-pool-rules` is the signed CLI (decision 70). | The route is absent. |
| POOL-T-15 | M-13 | changing the formula after `opens_at` | = RID-T-06 |
| POOL-T-16 | M-14 | a donation during the pool | no ticket, no change to the ranking (= RPL-T-84) |

### Traceability
Each rule POOL-M-01…14 maps to a planned id POOL-T-01…16 (M-04 and M-05 have 2 ids each). 14 MUST. An id is not a written test. The executable bar is [`../testing/COVERAGE_CONTRACT.md`](../testing/COVERAGE_CONTRACT.md).

---

## Appendix A. The weekly pool format (former §20)
> Carried over unchanged from `anticheat_test_plan.md §20` (superseded, merged into docs/spec) (17.10.2026); heading levels shifted by one. Part 1 of this file is normative; where they differ, the spec wins.

### 20. The weekly pool format (owner decision of 17.10.2026) and the consequences

**The format (one pool for now):** the pool opens on Tuesday evening and closes on Sunday evening. Then 1.5 days of review (verdicts, a manual check of the top 20), then the results and the payout. Ticket sales close **2 h before the pool closes**. Bought a ticket but did not play before close — **the ticket burns, with no refund**.

**Time is a parameter, not a constant** (the owner's clarification). The exact hours and the time zone are not fixed in the documents. They are configurable fields of the pool schedule: in the **on-chain pool account** and in the **backend config**. The defaults are Tue evening → Sun evening, a sales cutoff of 2 h, and a review of 1.5 days. The backend keeps them in sync and **checks them against on-chain** (§20.3).

#### 20.1 Decision 33 — what to delete in the code (later, not in this plan)
- Server:
  - `server/src/domain/live/live-rules.ts`: `EFFECT_IDS = ['tip','night','day','potholes','trench','sinkhole']` → remove the gameplay effects; remove `night`/`day` too (they change visibility, so they affect the ride). Only cosmetics remain.
  - `server/src/presentation/live/live.http.controller.ts`: `POST watch/:id/donations` (`:55`), `donation-orders*` (`:61–73`) for current rides, `effects/:eventId/applied` (`:89`).
  - `server/src/presentation/live/dto/live.dto.ts` (`donationBodySchema`).
  - `server/src/domain/verdict/replay-engine.ts`: `donatedObstacles`, `donated-obstacle-ignored` (`:277`), `event-unapplied` (`:144`), `event-clock-mismatch`; `ride-replay.entity.ts` (the gifted-hole fields) — **keep only for rechecking old rides** (the rules of the ride's `RULES_VERSION`, AC-W18).
  - `TrafficSimulator(…, donatedObstacles, …)` (`replay-engine.ts:187`).
- Client: `client/js/live-effects.js`, `ui/live-feed.js`, `ui/watch-panel.js`, `ui/watch-pledges.js`, `watch.js` (effects on the ride).
- Config: **a temporary measure until the code is deleted is `LIVE_EFFECTS=off`** (`env.schema.ts:150`; the default now is `all`: "donations that change the ride … every ride"). `LIVE_FREE_DONATIONS` (`:144`) follows the decision on donations on a replay.
- Texts:
  - [`docs/legal/TERMS.md`](../legal/TERMS.md) used to say "Viewers may send donations to a driver during a live ride … Donation effects shown in the ride are cosmetic" — that did not match the code (gifted holes deal damage) or decisions 18/33. ✅ **The clauses marked on 17.10 are now in `docs/legal/*`** (TERMS §14.1–14.5, PRIVACY, PRESEASON_RULES 16a; the summary is in [`legal.md`](legal.md) §1.1): donations only on a replay and only as cosmetics; there is no live. The code still does not match the text — that is a separate code change.
  - [`MASTER_PLAN.md`](../plan/MASTER_PLAN.md) §3 ("Donations: 100% to the driver") — unchanged as to the money.
- Tips (`tip`) that do not affect the game, on the replay of the previous ride, do not contradict decision 33. Whether to keep them is a product question, not anti-cheat.

#### 20.2 Consequences for fairness and anti-cheat
- **A road leak:** the window is ≈ 5 days with a shared `roadSeed` (decision 13). A replay, or the road plan of a completed ride, would reveal the pool's road to people who start several days later. So replays and `GET /api/watch/:id/road` for pool rides stay closed until the pool closes, and by default until `payout_at` (decision 34).
- **Training on one's own qualifying road:** with several attempts, the player sees their past replay and learns the holes. On the devnet launch there is one attempt ([`PRESEASON_RULES.md`](../legal/PRESEASON_RULES.md) §5 item 3, §6), so a shared `roadSeed` is enough. If there come to be more attempts, use a personal hole layout `holeSalt` (**decision 35, accepted**).
- **The last start:** → **decision 36**.
- **Burned tickets and an incentive to rush:** a player who "has to make it" starts in the last hours. That is server load on Sunday evening (AC-P9 concurrency — run the "peak of the last 2 hours").

#### 20.3 The pool contract v5 (in main) — what is there and what is missing
Checked against `programs/freightchain_pools/src` (`origin/main` after PR #3 merges, v5; the program catalog is flattened):
- **Deadlines already exist in the pool account** (`state.rs`, `Pool`): `prep_deadline`, `play_deadline`, `payout_at` ("end of the review window: no prize is paid … before it"), plus a snapshot of `min_review_secs`. `buy_ticket.rs:52`: `require!(now < pool.prep_deadline, PoolError::TooLate)` — **this is the sales cutoff**, and `buy_ticket.rs:50` is `PaidTicketsDisabled` (v5). The mapping:

| Format field | In v5 now | Default |
|---|---|---|
| `opens_at` (sales and play open) | absent; the pool is open from `create_pool` / `open_next_pool` (a series slot) | Tue evening |
| `sales_close_at` | **`prep_deadline`** | `play_close_at − 2 h` |
| `last_start_at` | absent (backend) | `play_close_at − 3600 s − 15 min` (decision 36); play close when that lead is before the pool opened |
| `play_close_at` | **`play_deadline`** | Sun evening |
| `validation_until` | **`payout_at`** | `play_close_at + 1.5 days` (129,600 s ≥ `min_review_secs`, default 3,600) |

- **Conflict 1 — the window floor:** `check_windows` (`create_pool.rs`) requires `play_deadline − prep_deadline ≥ Config.min_finish_secs`, and `DEFAULT_MIN_FINISH_SECS = 10_800` (3 h, `constants.rs:50`). A 2 h window is rejected (`WindowTooShort`). An admin changes the floor through `set_config(min_finish_secs)` (`admin.rs`) → set it to ≤ 7,200 (decision 37 a). The comment in the program ("the last call: no sale, no new ride – the shifts on the road finish") implies that there are no new rides after `prep_deadline`; the owner allows a ride to start until `last_start_at`. The start check is on the backend; the program does not see starts.
- **Conflict 2 — series cadence:** `series.rs`: `sale_secs` is "sale window AND cadence: the next pool opens when this one stops selling". So a series cannot do "sales ≈ 5 days, the next pool in 7 days": the next pool opens as soon as sales end. While there is one pool, open it by hand with `create_pool` and explicit deadlines. In v6, a separate `period_secs` (decision 37 b).
- **Conflict 3 — legacy `STATUS_OPEN` / `min_tickets` / `fail_pool` vs. operator-funded pools:** In `programs/freightchain_pools` v5 (`create_pool.rs:59`, `buy_ticket.rs:84`, `lifecycle.rs:19`), a pool still starts in `STATUS_OPEN (0)` with `min_tickets >= 1` and only transitions to `STATUS_ACTIVE (1)` inside `buy_ticket` when `tickets_sold >= min_tickets` (and `fail_pool` transitions an `Open` pool below `min_tickets` to `STATUS_REFUNDING`). Under the operator-funded skill-contest model (`> 50%` operator/sponsor base, `< 50%` optional player paid attempts, no safe refund for low ticket sales), pools do **not** require a minimum number of player tickets to activate and never fail/refund because too few tickets were sold. In v6 (`SPC-05.5`), pools open directly as `STATUS_ACTIVE` (or allow `min_tickets = 0`) and remove `fail_pool` for low ticket sales (retaining only admin `cancel_pool` and the 14-day unsettled `expire_pool` safety net).
- **Proposed v6 fields (plan only):** `opens_at: i64` (`buy_ticket` requires `now ≥ opens_at`), `last_start_at: i64` (or `start_buffer_secs`), `period_secs` on the series, and opening pools directly in `STATUS_ACTIVE` without a `min_tickets` player-sale gate or low-sales `fail_pool`. Backend names: `sales_close_at = prep_deadline`, `play_close_at = play_deadline`, `validation_until = payout_at`; do not rename existing fields (the IDL and the account layout, `POOL_STATUS_OFFSET`).
- **Sync with the backend:**
  - the backend config (`POOL_SCHEDULE_*`: the offsets and the defaults) is used only to **create** a pool;
  - for a live pool, the source of truth is the on-chain account (`pool-registry.service.ts`, `Pool.fromChain`);
  - on every update the backend checks the deadlines. A mismatch → the pool is not served (`409 pool_schedule_mismatch`) + an alert in the admin;
  - the backend computes `last_start_at` from `play_deadline` and the margin until v6 has the field.
- **Unplayed tickets — where the money goes** (two modes, stated plainly):
  1. **An on-chain sale (v5 `buy_ticket`, `paid_tickets_enabled`):** the program has no notion of "played". `tickets_sold × price` enters the pool bank in full. The split `prize_bps / seed_bps / fee_bps` (default 8500 / 500 / 1000) is taken from `counted_pot = min(tickets_lamports, ticket_room(sponsored, max_player_share_bps)) + sponsored` (`state.rs`). The excess above `max_player_share_bps` (≤ 47.4%) goes to the seed treasury (`PoolClosed.ticket_excess`). So **the money of unplayed tickets stays in the pool**, as does the money of played ones, with the same split and the same cap.
  2. **Solana Pay into the treasury ([`MASTER_PLAN.md`](../plan/MASTER_PLAN.md) §3):** a ticket is the operator's revenue, not escrow. Unplayed tickets enter `R` and, through `P = min(0,40·R, $2 500, 0,90·F)`, partly land in **next** week's prizes. They do not go directly into "this pool".

  → for a paid pool (later), the rules must state which mode applies. Under the current plan that mode is Solana Pay, so the wording "they stay in the prize pool" is **wrong** for it.

#### 20.4 The ticket-burn rule — texts and UI
- **What it applies to:** the devnet launch has no paid tickets: "No purchase necessary"; an attempt is only for airdrop tasks ([`PRESEASON_RULES.md`](../legal/PRESEASON_RULES.md) §2, [`MASTER_PLAN.md`](../plan/MASTER_PLAN.md) §5 / round 18). An analogue applies there: an attempt not started before the last start (decision 36) is lost. **The rule "bought — did not play — burned" applies to a paid pool (later).** Seasons are not planned yet, so the format "Tue evening – Sun evening + 1.5 days" is the default schedule for a pool of any launch. Deadlines in the devnet-launch rules are set by the pool fields.
- **TERMS** is updated in [`docs/legal/TERMS.md`](../legal/TERMS.md) §7.5, §8, and §9 (and [`docs/legal/OFFICIAL_RULES.md`](../legal/OFFICIAL_RULES.md) §1.2, §5.4):
  - we and sponsors fund the major pool (`> 50%`), and optional paid tickets (`< 50%` cap) buy extra ranked attempts;
  - there is **no minimum ticket-sale threshold** and **no refund if few tickets are sold**;
  - once bought, a paid ticket is immediately final and non-refundable, is valid only in the pool it was bought for, and burns with no refund if not started before `last_start_at` (exceptions: a verified server outage `> 30 min`, administrative `cancel_pool`, or 14-day unsettled `expire_pool`).
- **Purchase UI:** the pool's close time and the **last start**, in the player's local time; a warning "if you do not play by … the ticket burns with no refund"; confirmation with a checkbox. After `sales_close_at` there is no buy button.
- **Consumer law (no legal conclusions):** in many countries a consumer has a right to withdraw from a distance purchase, and there are exceptions for leisure on a specific date and for digital content. Whether that applies to a pool ticket must be confirmed with a lawyer (the owner postponed the consultation; it is an accepted risk, [`OPEN.md`](OPEN.md) round 19). This is not legal advice.

#### 20.5 1.5 days of review — whether the compute is enough
- Under §9.7 the recompute runs **incrementally during the ride**, so at close what remains is the final verdict (fractions of a second per ride) and the manual check.
- The worst case is a full recheck after a rules change: N rides × 2–7 s of CPU (30 Hz, §9.3). Example: 1,000 players × 7 attempts = 7,000 rides × 7 s ≈ 13.6 h of CPU → on 4 queue workers (`ReplayQueuePort`, concurrency 4) ≈ 3.4 h. That is ≪ 36 h. There is margin even for 10,000 rides (≈ 5 h on 8 workers).
- The bottleneck is **people:** a manual check of the top 20 (≈ 20–30 min per ride, with minigame traces, and two reviewers on the top 3) is ≈ 8–12 h of work, which fits in 1.5 days. **Appeals come after the review window (owner decision of 17.10):** results are published at `payout_at`, then an appeals window (the length is a pool-schedule parameter). Payout for disputed places waits for the appeal decision; payout for undisputed places does not wait (as in the rules: moving up after a disqualification).
- The order: the final verdict → `pool:attention` → the manual check → `commit_winners` (the on-chain winners root) no later than `payout_at` → payouts from `pay_from`. Test: AC-P9 in the variant "pool close: 2,000 rides in the queue, review < 2 h".

---

## Appendix B. Season, pool, and ticket parameters in `MASTER_PLAN.md`

- The full summary of the decisions on the week's bank formula (`F = B + S`, `P = min(0.40·R, $2,500, 0.90·F)`, `T = F + P + C`, `85% / 5% / 10%`, the cap `free_prize_board_cap_bps = 3000`, an equal split of ties, selection into the season final) and on weekly tickets (`weekly_ticket_1h_enabled`) is in [`../plan/MASTER_PLAN.md`](../plan/MASTER_PLAN.md) **§3 and §5** (so the tables are not duplicated across files).
- Target decisions 33–37 (the move to one 1h pool with a Tue–Sun schedule plus 1.5 days of review, and the removal of donation gameplay effects) take priority over the Mon–Sun schedule in `MASTER_PLAN.md` §4 (see **Part 1** and **Appendix A** above, and also [`rides.md`](rides.md) Appendices A–B).

---

## Appendix C. The current prize-board implementation on `main` (`server/src/domain/prize/prize-rules.ts`)

> A description of the behavior assembled in `server/src/domain/prize/prize-rules.ts` and `GET /api/prize/board` (see also [`PRODUCT.md`](PRODUCT.md)):

- **Currency and status**: computed amounts are in `USDC` (cents `BASE_STEPS_CENTS = [30_000, 75_000, 150_000, 300_000]` — `$300 / $750 / $1,500 / $3,000`), `TOKEN_IS_PRIZE = false` (TEN4 is never a contest prize). It is a draft now: real USDC transfers are not sent automatically.
- **Week windows (`PRIZE_WEEK_OPEN_HOUR_UTC = 0`)**:
  - Qualifying play (`ranked`): Mon `00:00 UTC` → Sun `12:00 UTC` (`RANKED_CLOSE_MS = 156 h`).
  - Review (`verify`): Sun `12:00 UTC` → Mon `12:00 UTC` (`VERIFY_END_MS = 180 h`).
  - Appeals (`appeals`): Mon `12:00 UTC` → Tue `12:00 UTC` (`APPEALS_END_MS = 204 h`).
  - Payouts (`payout`): until the end of Tuesday (`PAYOUT_END_MS = 216 h`).
- **Limits on qualifying starts per week per wallet (`ranked: true` on `POST /api/rides/:id/start`)**:
  - `PAID_RANKED_STARTS = 5` paid starts (including the weekly issued free 1h ticket — `weekly_ticket_1h_enabled = 1`, AMOE).
  - `PROMO_RANKED_STARTS = 1` promo start (`kind: 'ride'`).
  - Training (`tier = free`) never counts as qualifying.
- **Prize-pool formula and distribution (`prize-rules.ts`)**:
  - `F = B + S` (step base + sponsor), the ticket contribution `P = min(0.40 * R, $2,500, 0.90 * F)`, the week's total bank `T = F + P + C` (where `C ≤ 0.25 * F` is the rollover).
  - The split of `T`: `85%` to the week's boards (`1h: 25%`, `4h: 30%`, `8h: 45%`), `5%` into the rollover `C`, `10%` into the season final (`SEASON_WEEKS = 7`, `LIVE_FINAL_WEEK = 7`, `SEASON_QUALIFIERS = 8` best by the sum of places, with `MISSED_WEEK_PLACE = 1000`).
  - Inside each board (`MIN_BOARD_PARTICIPANTS = 10`): `80%` is the top places (`TOP_PLACES = 10`, or the top 10% when there are `> 100` participants), `20%` is split equally among everyone who finished (`completer pool`). On a tie in points, they split the sum of the places taken, equally.
- **Geo limits and age (`GeoLocatorPort`, `MeDto`)**:
  - Age `18+` (or `19+`/`21+` by jurisdiction), and absence from the sanctions list (`CU, IR, KP, SY`, `UA-43, UA-14, UA-09`) and from the list of US states excluded from paid contests (`SC, AZ, LA, AR, DE, MT, TN`).

---

## Appendix D. Escrow-program architecture (`programs/freightchain_pools` v4/v5), road seeds, workers, and the toolchain

- **The non-custodial principle and two server keys**:
  - All funds from tickets, rollovers (`rollover`), and sponsor pledges are held on the program PDA `programs/freightchain_pools`; each wallet signs and sends its own transactions, and the server only indexes events (`PoolSyncService` / `sync-pools.command.ts`) and credits tickets.
  - The server holds two hot keys:
    1. **Crank (`CRANK_SECRET`, `PoolCrankScheduler` / CLI `npm run pool:crank`)**: it runs the permissionless lifecycle steps (`open_next_pool` from the admin `Series`, `seal_road`, `fail_pool`, `expire_pool`, `refund`, `refund_sponsor`, `close_pool` via `nextCrankStep`).
    2. **Payout (`PAYOUT_SECRET`, `PoolPayoutScheduler` / CLI `npm run pool:payout`)**: when every ride in the pool has a final verdict (`!poolUnreviewed`), it records on-chain attestations of rides that have pledges (`record_ride_attestation` via `AttestationService.attestRide`), publishes the winners' Merkle-tree root (`commit_winners` / `winners-merkle.ts`), and closes paid-out pools (`close_pool`). The cold admin key (`admin`) may veto the root (`veto_winners`) during the review window `min_review_secs` (`3600 s`).
- **One road per pool, and sealing the seed (`seal_road`, `provable-seed.ts`)**:
  - In program mode, `Pool.rideSeed` is derived deterministically from the slot hash (`projectRoadSeed` in `server/src/domain/road/provable-seed.ts`) by the `seal_road` instruction at a slot `>= open_slot + 8`. Before `seal_road` is called, starting a ride in the pool returns `409 road_not_sealed`.
  - The truck cab (`client/js/seal.js`, `client/js/ui/cab-chain.js`) shows the cryptographic binding of the road seed to the Solana slot. (For the legacy `transfer` mode with no pool, the daily seed is issued through `DailySeedRepositoryPort.claim`.)
- **Program rules v4 / v5 (`programs/freightchain_pools`)**:
  - **v4**: a winners Merkle tree (`commit_winners`, `veto_winners`, `pay_prize`), on-chain ride attestations (`RideAttestation`), sponsor pledges per kilometer (`Pledge`: `create_pledge`, `settle_pledge`, `refund_pledge`, sync `SyncPledgesHandler`), a refund of sponsor contributions when a pool is cancelled (`SponsorReceipt` / `refund_sponsor`), and the minimum `Config` thresholds (`min_review_secs = 3600`, `min_finish_secs = 10800`).
  - **v5**: the default split `8500 / 500 / 1000` (85% to the winners / 5% rollover / 10% fee, with no on-chain referral leg), the `set_pool_rules` instruction, a cap on one player's share `max_player_share_bps < 5000` (default `4740` = 47.4%), and the `paid_tickets_enabled` switch. Open deploy questions are tracked in [`docs/tech/escrow-open-items.md`](../tech/escrow-open-items.md) and [`docs/tech/program-deploy.md`](../tech/program-deploy.md).
- **Start windows, ticket indexing, Priority Fees / RPC, and holding a payout (`Pool.hold`)**:
  - Ordering and starting a ride in the pool are allowed until `Pool.startBy` / `last_start_at` (`canFinishBy`; after the deadline, `409 rides_closed` / `409 pool_last_start_passed`). Under the operator-funded pool model (`> 50%` operator/sponsor base, `< 50%` optional player paid attempts), pools do not fail for low ticket sales and bought tickets are non-refundable (burning at `last_start_at` if unused; legacy `min_tickets` / `fail_pool` remains in the v3/v5 code until v6 `SPC-05.5` removes the player-sale activation gate).
  - Confirmation of a ticket purchase (`TicketSettlementService`) takes the fast path through `confirm`, the background `program-watcher.ts`, and the webhook `/api/chain/webhook`.
  - Priority fees and RPC overload: `fee-estimator.ts` estimates the compute unit price dynamically (`getRecentPrioritizationFees`), and `solana-rpc.ts` switches transparently over the `SOLANA_RPC_FALLBACKS` list on errors or when the primary RPC is overloaded.
  - Before the winners root is committed, `PoolAttentionService.markPool` checks the pool's top 20; if attention flags have fired, or `Pool.hold` is set (`saveHold`), `claimSentUnlessHeld` blocks the automatic send of `commit_winners` until an administrator's manual check.
- **The toolchain and the development commands**:
  - Build and IDL: `anchor build --arch v0`, `npm run program:idl` (`server/scripts/vendor-idl.mjs` updates `server/test/fixtures/chain/pool-program.json`), and a reproducible build `npm run program:verify` (`verifiable-build.hash`).
  - Tests: `npm run program:test` (LiteSVM: 163 tests of `freightchain_pools` + 40 tests of `freightchain_honk`), `npm run test:e2e:block2`.
  - Devnet utilities (never touch the global `~/.config/solana/id.json`; always pass an explicit `--url devnet`; deploy only on a direct request from the user): `server/scripts/devnet.sh`, `node server/scripts/pool-admin.mjs`.


### Local v6 implementation (25 October 2026)

The local program now stores Pool `opens_at`/`last_start_at` and Series `period_secs`/`start_buffer_secs`. New pools activate with zero sales and require `min_tickets = 0`; low-sales `fail_pool` always refuses. Admin cancellation before any prize and 14-day unpaid expiry remain refund exits. The default and maximum finish floor is 7200 seconds. The server mirrors the explicit schedule, checks it before entry, skips series sale gaps and stops road-sealing attempts after last start. `pool-admin.mjs create-pool --opens … --last-start …` sets explicit times; `set-series --period-secs … --start-buffer-secs …` separates cadence and sale duration. The 1h CLI default is 118h sales + 2h finish + 36h review, weekly cadence, 75-minute last-start buffer.

This is local source behavior, not a deployment record. Pool and Series sizes changed; use the planned fresh-program cutover. Pledge instructions remain implemented for optional/test paths; Decision 51 keeps them disabled at the launch API. The older plan's request to remove the on-chain creation path is not marked complete by this schedule change.
