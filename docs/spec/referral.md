# Referral Program Specification

This document is the authoritative functional and technical specification for Freight Chain's referral system (`REF-M-*` rules and `REF-T-*` test requirements). It covers both the **current as-built implementation on `main`** (`server/src/domain/referral/`, `ReferralService`, `ReferralsHttpController`) and the **target Convoy rework (Decision 50 & `docs/plan/MASTER_PLAN.md` §6)** so an agent can audit, test, or refactor the referral program from a single source of truth.

Related specs: [Rides](./rides.md) · [Pool & Escrow](./pool.md) · [TEN4 Token & Garage](./ten4.md) · [Promo Codes](./promocodes.md) · [Product & As-Built Behavior](./PRODUCT.md) · [Decision Log](./DECISIONS.md) (D50).

---

## 1. Current Implementation on `main` (As-Built)

**25 October readiness fixes:** the separate Convoy machine now uses PostgreSQL (`ConvoyInvite`, `ConvoyRide`, `ConvoyLedger`); campaign gates/holds/social ownership use `AirdropClaim`. They join the caller’s player-locked transaction. The shared promo budget is serialized across referrers, and activation grants one spendable 1h promo (no change to the retired free-ride counter). Privacy uses `Player.convoyHidden`. Social rechecks do not award trust again. Legacy referral behavior remains separate. Configured social providers are implemented and fixture-tested; live acceptance, full target UI and campaign chain reward settlement remain open. Newly earned Convoy milestones now settle through `pay_referral` after the hold; historical ledger rows are excluded from automatic settlement. Convoy now applies §2.3 paid/ranked/weekly-grant eligibility and campaign-task requirements, §2.4 rolling 30-day capacity, milestone/time tie-breaks and public privacy omission. Earlier training-based counted flags are invalidated by migration, with ledger history retained.

### 1.1 Data Model & Storage (`server/prisma/player/player.prisma` & `cosmetics.ts`)
- **`player.ReferralCode` (`@@map("referral_codes")`, `ReferralCodeRecord`)**:
  - `wallet` (`String`, `@id`): Referrer wallet address (1:1 per player, FK to `player.Player`).
  - `code` (`String`, `@unique`): **8-character** uppercase alphanumeric invite code from `REFERRAL_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'` (`REFERRAL_CODE_LENGTH = 8`; omits ambiguous `0`, `O`, `1`, `I`).
  - `gift` (`String`, `@default("convoy")`): Selected gift paint (`GIFT_ITEMS = ['convoy', 'signal', 'amber']`, `DEFAULT_GIFT = 'convoy'`).
  - `createdAt` (`DateTime`, `@default(now())`).
- **`player.ReferralInvite` (`@@map("referral_invites")`, `ReferralRecord`)**:
  - `referee` (`String`, `@id`): Invitee wallet address (each player can be referred at most once; on `main`, an `'expired'` row acts as a permanent tombstone).
  - `referrer` (`String`): Referrer wallet address. Indexed by `(referrer, boundAt)` and by partial index `player_referral_invites_referrer_open_idx ON player.referral_invites(referrer, status) WHERE status IN ('pending', 'qualified')`.
  - `status` (`ReferralStatus`): `'pending' | 'qualified' | 'expired'`.
  - `boundAt` (`DateTime`), `expiresAt` (`DateTime`), `qualifiedAt` (`DateTime?`), `rideId` (`String?`).
  - `freeGranted` (`Boolean`, `@default(false)`): Whether the one-time free-ride bonus was granted on this referral row.
  - `badgeCounted` (`Boolean`, `@default(false)`): Whether this referral counted toward the referrer's Convoy achievement progression (`1 / 5 / 20 / 100`).
- **Referral Exclusive Paints (`server/src/domain/economy/cosmetics.ts` & `client/shared/referral-paints.js`)**:
  - Stored in `slot: 'truck_color'` with `referralOnly: true` (refused by `POST /api/garage/buy` with `409 referral_only`, unlocked with `code: 'referral'`):
    - `'convoy'` — **Convoy Green** (`#2e5e4e`)
    - `'signal'` — **Signal Orange** (`#d85a1a`)
    - `'amber'` — **Night Amber** (`#d89a2b`)
- **Convoy Achievement Ladder (`server/src/domain/achievements/achievements.ts`)**:
  - `convoy` — **Convoy** (`Bronze`, `1` qualified friend with `badgeCounted = true`)
  - `convoy-2` — **Road Crew** (`Silver`, `5` qualified friends with `badgeCounted = true`)
  - `convoy-3` — **Fleet** (`Gold`, `20` qualified friends with `badgeCounted = true`)
  - `convoy-4` — **Haulmaster** (`Platinum`, `100` qualified friends with `badgeCounted = true`)

### 1.2 Runtime Settings & Constants (`referral-rules.ts` & `game-settings.ts`)

| Constant / Setting Key | Default | Bounds | Meaning |
|---|---|---|---|
| `REFERRAL_CODE_ALPHABET` | `'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'` | — | 32 unambiguous uppercase letters/digits |
| `REFERRAL_CODE_LENGTH` | `8` | — | Exact invite code length (`mintCode(entropy.hex(8))`) |
| `GIFT_ITEMS` / `DEFAULT_GIFT` | `['convoy', 'signal', 'amber']` / `'convoy'` | — | Exclusive referral paint items in `slot: 'truck_color'` |
| `DONATION_RENT_MIN` | `890_880` lamports | — | `Rent::minimum_balance(0)`; donation shares below this stay with the driver |
| `DONATION_SHARE_TTL_MS` | `15 * 60 * 1000` (15 min) | — | Reservation hold window for pending donation orders (`sumReferredLamports`) |
| `referral_max` (`referralMax`) | `30` | `1..1000` | Maximum total invite capacity ceiling per referrer |
| `referral_invite_start` (`referralInviteStart`) | `3` | `0..1000` | Base invite slots for a new referrer (`0` verified paid shifts) |
| `referral_invite_step` (`referralInviteStep`) | `3` | `0..1000` | Additional invite slots unlocked per step |
| `referral_shifts_per_step` (`referralShiftsPerStep`) | `5` | `1..1000` | Verified paid shifts required per capacity step: `min(30, 3 + 3 * floor(paidShifts / 5))` |
| `referral_invite_ttl_days` (`referralInviteTtlDays`) | `14` days | `1..90` | Pending invite expiration window (`expiresAt = boundAt + 14d`) |
| `referral_free_ride_window_days` (`referralFreeRideWindowDays`) | `7` days | `1..90` | Window from `boundAt` within which a verified MEDIUM free ride grants free rides |
| `referral_free_rides_referrer` (`referralFreeRidesReferrer`) | `2` | `0..20` | Free rides granted to the referrer on MEDIUM qualification |
| `referral_free_rides_referee` (`referralFreeRidesReferee`) | `3` | `0..20` | Free rides granted to the referee on MEDIUM qualification |
| `referral_free_ride_weekly_cap` (`referralFreeRideWeeklyCap`) | `10` | `0..1000` | Rolling window cap (`referralFreeRideWindowDays`) on free-ride grants per referrer |
| `referral_referrer_part_bps` (`referralReferrerPartBps`) | `8000` (80%) | `5001..10000` | Referrer's share of a sponsored winner's referral-pot slice (legacy v3/v4 pools) |
| `referral_ride_cap_lamports` (`referralRideCapLamports`) | `1_000_000_000` (1 SOL) | `0..2e9` | Per-pool cap on lamports one referrer may take from the referral pot (`GameSetting.value` is a signed 32-bit int, so lamport caps stop at `2_000_000_000`) |
| `referral_donation_share_bps` (`referralDonationShareBps`) | `1000` (10%) | `0..10000` | Share of spectator tips/donations routed to the driver's qualified referrer |
| `referral_donation_cap_lamports` (`referralDonationCapLamports`) | `500_000_000` (0.5 SOL) | `0..2e9` | Lifetime donation-share cap per `(referrer, referee)` pair (`GameSetting.value` 32-bit int ceiling `2_000_000_000`) |

### 1.3 Lifecycle, Endpoints & Qualification Rules (`ReferralsHttpController` & `ReferralService`)

1. **View & Lazy Code Minting (`GET /api/referrals`)**:
   - Guarded by `PlayerAuthGuard` (authenticated wallet required; guest sessions are rejected with `401`/`409`).
   - `ensureCode(wallet)` lazily mints an 8-character `ReferralCodeRecord` (`mintCode(entropy.hex(8))`, `gift: 'convoy'`) under the player row lock (`findByWalletForUpdate`), retrying up to 5 times in fresh transactions on unique code collisions (`409 code_exhausted` if all 5 collide).
   - Sweeps overdue pending invites for `wallet` (`referrals.expireDue(wallet, now)`).
   - Computes `capacity = inviteCapacity(settings, verifiedPaidShifts)`, `used` (`qualified` count), `pending` (`pending` count), `available = max(0, capacity - used - pending)`, and returns `ReferralView`:
     `{ code, capacity, used, pending, available, max, gift, referredBy, invites: [{ wallet, status, at }] }` (up to 30 most recent invites).

2. **Gift Selection (`POST /api/referrals/gift`, body `{ item }`)**:
   - Validates `isGiftItem(item)` (`'convoy' | 'signal' | 'amber'`), rejecting invalid items with `400 bad_gift`.
   - Ensures the caller has a `ReferralCode` row, locks `[wallet]` via `findByWalletForUpdate`, updates `ReferralCode.gift = item`, and returns the updated `ReferralView`.

3. **Binding (`POST /api/referrals/bind`, body `{ code }`)**:
   - Normalizes `code = raw.trim().toUpperCase()` and validates `isReferralCode(code)` (8 chars from `REFERRAL_CODE_ALPHABET`), throwing `400 bad_code` if malformed.
   - Calls `settleExpired(referee, code)` in its own transaction first so overdue `'pending'` rows become `'expired'` tombstones and are not rolled back if `bind` subsequently throws `409`.
   - In the main transaction, locks `[referee, referrer]` in **sorted wallet address order** (`[...new Set(wallets)].sort()`) via `findByWalletForUpdate` to prevent deadlocks.
   - Evaluates `bindRefusal({ known, referee, referrer, existing, available, started })` in strict priority order (with exact `bindRefusalMessage` strings):
     1. `!known || !referrer` → `409 unknown_code` (`'unknown referral code'`)
     2. `referrer === referee` → `409 own_code` (`'cannot use your own referral code'`)
     3. `existing && existing.referrer === referrer && existing.status !== 'expired'` → **idempotent `200` no-op** (decided *before* `no_slots` and `ride_started` so an already-bound friend can safely retry)
     4. `existing?.status === 'expired'` → `409 expired` (`'your referral invite expired'` — permanent tombstone on `main`: wallet can never bind again)
     5. `existing` (bound to another referrer) → `409 already_bound` (`'already referred by another driver'`)
     6. `available <= 0` → `409 no_slots` (`'referrer has no invite slots left'`)
     7. `started` (`referrals.hasStartedRide(referee, tx) === true`, i.e., any ride has `startedAt !== null`; an ordered-but-unstarted ride does not block binding) → `409 ride_started` (`'referral code must be entered before your first ride'`)
   - Inserts `ReferralRecord` with `status: 'pending'`, `boundAt: now`, `expiresAt: now + referralInviteTtlDays * 86_400_000` (14 days), `freeGranted: false`, `badgeCounted: false` (schema migration `20261029000000_referrals`).

4. **Client Capture & Profile UI (`landing/src/main.js`, `client/site/referral.js`, `client/site/lobby.js`, `client/site/lobby-profile.js`)**:
   - **URL Capture (`client/site/referral.js`)**: Visiting `/?ref=CODE` or `lobby.html?ref=CODE` validates `CODE` against `/^[A-HJ-NP-Z2-9]{8}$/i` and stores it in `localStorage['freightchain.ref']`.
   - **Post-Sign-In Auto-Bind**: Immediately after `signInWallet()` succeeds, the client reads `localStorage['freightchain.ref']` and calls `POST /api/referrals/bind`. On `200 OK` or any terminal refusal (`400`/`409`), the stored key is cleared.
   - **Profile UI (`lobby.html#profile`)**:
     - `INVITE A DRIVER` card displays `${SITE_BASE}/?ref=${code}`, `COPY LINK` / `COPY CODE`, slot usage (`${used} qualified · ${pending} pending · ${available} left of ${capacity}`), the 3 paint swatches (`Convoy Green`, `Signal Orange`, `Night Amber`) wired to `POST /api/referrals/gift`, and the invites table.
     - `REFERRED BY` card shows a manual 8-char code input + `APPLY` button when `referredBy === null`, or the shortened referrer wallet once bound.

5. **Qualification After Verified Ride (`VerdictService.afterVerified` → `ReferralService.onVerified(rideId)`)**:
   - Invoked after a ride's verdict commits with `ride.status === 'completed'` and `verdict.status === 'verified'`.
   - Locks `[row.referrer, row.referee]` in sorted wallet order via `findByWalletForUpdate`.
   - If `row.status === 'pending'` and `now > row.expiresAt`, transitions row to `status = 'expired'` and returns.
   - Otherwise evaluates `qualifyDecision(QualifyInput)`:
     - **Status transition (`qualify`)**: On the **first verified completion of any ride** (free EASY/MEDIUM/HARD or paid), `status` transitions from `'pending'` to `'qualified'` (`qualifiedAt = now`, `rideId = ride.id`).
     - **Gift Paint Unlock (`colour: first`)**: On that first qualification (`decision.colour === true`), `paint(referrer, now, tx)` unlocks the referrer's chosen `code.gift` (`'convoy' | 'signal' | 'amber'` in `slot: 'truck_color'`, `code: 'referral'`) for the **referrer** and equips it if the referrer still wears the default `'red'` or nothing.
     - **Free-Ride Grant (`freeRides`)**: Granted **only** when the first qualifying completion is a verified **MEDIUM free run (`level === 2`, `free-2c`, `!paid`)** within `referralFreeRideWindowDays` (7 days) of `boundAt`, `!alreadyFreeGranted`, and the referrer's `weeklyGranted < referralFreeRideWeeklyCap` (10). Grants `referralFreeRidesReferrer` (**2**) free rides to the referrer and `referralFreeRidesReferee` (**3**) free rides to the referee (`freeGranted = true`; `grantFreeRides` may exceed the daily cap, and setting `0` on one side grants only the other). A later MEDIUM run after qualifying on EASY does not grant them.
     - **Convoy Badge Progression (`badge`)**: Set once (`badgeCounted = true`) when the referee completes a **verified paid shift (`paid === true`)** OR a **verified HARD free run (`level === 3`, `free-3c`) with `assist === false`**. Unlike `freeRides`, `badgeCounted` can be set on a subsequent ride if the first qualifying ride was EASY or MEDIUM. Feeds the 4 Convoy achievement tiers (`convoy`, `convoy-2`, `convoy-3`, `convoy-4` at `1 / 5 / 20 / 100`); the referrer's Convoy badge is evaluated on their next profile read or ride end (never inside the friend's `/end` transaction).

6. **Spectator Donation Share (`donationShare` in `referral-rules.ts` & `PrismaLiveDonationOrderRepository`)**:
   - When a spectator tips a driver whose referral is `'qualified'` and `spectator !== referrer`:
     - `already = sumReferredLamports(referrer, driver, holdSince)` sums all `'paid'` donation orders plus `'pending'` donation orders created within `DONATION_SHARE_TTL_MS` (last 15 minutes) so concurrent unpaid checkouts cannot race past the lifetime cap.
     - `room = max(0, cap - max(0, already))` (default lifetime `cap = 500_000_000` lamports = `0.5 SOL` per pair).
     - `share = min(floor(price * bps / 10_000), room)` (default `bps = 1000` = `10%`).
     - If `share < DONATION_RENT_MIN` (`890_880` lamports) or `price - share <= 0`, `share` is `0` (100% goes to the driver).

7. **Pool Referral Pot Split (`ReferralPayoutService` & `allocatePoolShares` in `referral-split.ts`) & TEN4 Referral Emissions (`tokenomics.ts`)**:
   - **On-chain pools v5**: `referralBps = 0` (`8500/500/1000` split; no on-chain referral pot leg, so `ReferralPayoutService` plans rider leaves only and `referralBound` is `0`; promo tickets with no on-chain `bought` are not sponsored). For legacy v3/v4 pools with `referralPot > 0`, `allocatePoolShares` attributes `referralPot` by top-20 rank weight, gives a sponsored winner's referrer `referrerPartBps` (`8000` = 80%) up to `rideCap` (`1 SOL`), and redistributes the remainder across the other top-20 finishers.
   - **TEN4 Referral Bucket (`HONK_REFERRAL = 4,000,000 TEN4`, `4%`)**: Halving eras of `2M → 1M → 500k…` (`referralQuoteUnits` scaled by `>> max(era_ref, era_ride)`), clipped by `clipReferralPayout` against `HONK_REFERRAL`, the monthly global cap (`30,000 TEN4/mo` for the first 3 months after TGE, then `60,000 TEN4/mo`), and the monthly per-wallet cap (`1,000 TEN4/mo`).

---

## 2. Target Convoy Rework Specification (Decision 50 & `docs/plan/MASTER_PLAN.md` §6, §12)

> **Status:** Target specification (`docs/spec/PRODUCT.md` Conflicts row 3, Decision 50, `MASTER_PLAN.md` §6 & §12, migrations `20261104000000_referral_rework` & `20261104100000_referral_reward`). Note that `tokenomics.ts` (`referralQuoteUnits`, `clipReferralPayout`) and `programs/freightchain_honk` (`pay_referral`, `burn_referral_tail`) are **already implemented on `main`**; the database/application rework below replaces the legacy free-ride/donation referral mechanics when Step 2 (`referral_plan.md`) lands.

### 2.1 Target State Machine (`pending → active → qualified → expired`)
1. **`pending` (72-Hour TTL — Deleted on Expiry)**:
   - Created on `POST /api/referrals/bind` with `expiresAt = boundAt + referral_pending_ttl_hours * 3_600_000` (default **72 hours**).
   - If `now > expiresAt` before the referee completes the test ride, the `pending` row is **deleted** (not tombstoned), immediately freeing the referrer's pending slot and allowing the referee to bind again later.
2. **`active` (60-Day Qualification Window)**:
   - Transition `pending → active` occurs when the referee completes a **verified MEDIUM or HARD training ride (`free-2c` or `free-3c`, `verdict.status === 'verified'`; EASY `free-1c` / `free-g` does NOT activate)**.
   - Sets `activatedAt = now` and `qualifyExpiresAt = now + referral_qualify_window_days * 86_400_000` (default **60 days**).
   - Unlocks the referrer's selected gift paint (`'convoy' | 'signal' | 'amber'`) on the referrer's first activated/qualified friend.
3. **`qualified` (Milestone M1 Reached)**:
   - Transition `active → qualified` occurs when the referee completes **Milestone M1** within the 60-day window (`now <= qualifyExpiresAt`).
   - Once `qualified`, the referee remains eligible to complete **Milestone M2** until the same 60-day window (`qualifyExpiresAt`) closes, and increments the referrer's Convoy badge counter (`convoy` / `convoy-2` / `convoy-3` / `convoy-4`).
4. **`expired` (60-Day Window Elapsed Without M1)**:
   - Transition `active → expired` occurs when `now > qualifyExpiresAt` and M1 was not reached. An `expired` row after activation is final (the referee cannot re-bind).

### 2.2 Referee Gift: 1h Promo Ride Grant (`PromoRideGrant`)
- When a referee transitions `pending → active` (verified MEDIUM/HARD test ride), the referee is granted **one free `1h` promo shift (`PromoRideGrant` with `tier: '1h'`)**, at most **once per referee wallet lifetime**:
  - By default **unranked** (`referral_referee_promo_ranked = 0`) and emits **0 TEN4**.
  - Subject to three rate-limit caps (if any cap is reached, activation still succeeds, the slot activates, and the UI informs the player that the promo ride gift cap was reached):
    - Per-referrer daily cap: `referral_referee_promo_per_referrer_day = 3` per UTC day.
    - Per-referrer weekly cap: `referral_referee_promo_per_referrer_week = 10` per ISO week.
    - Global weekly cap: `referral_referee_promo_global_week = 500` per ISO week.

### 2.3 Referrer TEN4 Milestones (M1 = 100 TEN4, M2 = 50 TEN4) & Counted Rides
- **Definition of a Counted Ride**:
  - A ride on a paid tier (`1h`, or `4h`/`8h` when enabled) that finishes (`status === 'completed'`), is **`verdict.status === 'verified'`**, and is **ranked (`ranked === true`)**.
  - A ride started with a purchased ticket or sponsored ticket (`kind: 'tickets'`) always counts.
  - A ride started with the weekly free 1h ticket grant counts **if and only if** `referral_count_weekly_grant = 1` (default `1`) **AND** the referee's `TrustScore >= 100` (`trust_threshold = 100`).
  - A ride started from a `PromoRideGrant` (`kind: 'ride'` or the referee gift ride) never counts as a counted ride.
- **Milestone M1 (`referral_ten4_m1_amount = 100` TEN4 base)**:
  - Requires within the 60-day window (`now <= qualifyExpiresAt`):
    1. Referee has completed all **required tasks of the current airdrop campaign** (`requiredTasks`; between campaigns, the most recent campaign's required tasks act as the "Convoy steps").
    2. Referee has completed `>= 1` counted ride in at least **`referral_ten4_m1_weeks = 2` distinct ISO weeks**.
- **Milestone M2 (`referral_ten4_m2_amount = 50` TEN4 base)**:
  - Requires within the 60-day window (`now <= qualifyExpiresAt`):
    1. M1 is completed.
    2. Referee has completed `>= 1` counted ride in at least **`referral_ten4_m2_weeks = 5` distinct ISO weeks**.
  - Maximum base reward per referred friend: **`100 + 50 = 150 TEN4`**.
- **Referrer Eligibility, Halving, Caps & 48h Hold**:
  - **Referrer Trust Gate**: Referrer must have `TrustScore >= referral_min_trust_referrer` (**`50`**) at the time the milestone is evaluated.
  - **Era Scaling (`referralQuoteUnits`)**: Base milestone units (`100e9` or `50e9`) are right-shifted by `max(era_ref, era_ride)` (`era >= 8 → 0`).
  - **Cap Clipping (`clipReferralPayout`)**: Clipped against remaining `HONK_REFERRAL` (`4,000,000 TEN4`), the global monthly cap (`referral_ten4_soft_start_monthly = 30,000 TEN4/mo` for the first `referral_ten4_soft_start_months = 3` months after `tge_at`, then `referral_ten4_global_monthly = 60,000 TEN4/mo`), and the referrer's personal monthly cap (`referral_ten4_referrer_monthly = 1,000 TEN4/mo`). If a cap is reached, the reward is clipped/skipped with a UI status message — **no backlog queue**.
  - **48-Hour Review Hold & On-Chain Settlement**: Credited milestone rewards are held for **48 hours** before the worker submits `pay_referral(reward_id, base_amount, month_index)` to `programs/freightchain_honk` (which initializes `ReferralMint` PDA `[b"referral-mint", &reward_id]` to prevent double-payment). After Era 8, any unminted tail in `referral_vault` is burned via `burn_referral_tail`.

### 2.4 Dynamic Pending Slots & Convoy Leaderboard
- **Pending Slot Formula**:
  - `pendingCapacity = min(referral_pending_max, referral_pending_base + referral_pending_per_active * A) = min(100, 5 + 2 * A)`
  - Where `A` is the number of the referrer's friends who completed `>= 1` counted ride within the rolling `referral_active_window_days = 30` days.
- **Convoy Leaderboard (`GET /api/referrals/leaderboard` & `POST /api/referrals/visibility`)**:
  - Returns the top **25** referrers ordered by qualified friends count (tie-broken by total M1+M2 milestones, then earliest achievement timestamp), displaying wallet address or resolved `.sol` SNS name, plus the authenticated caller's own row (`me`).
  - Players can toggle `Player.convoyHidden` (`Boolean`, `@default(false)`): when `convoyHidden = true`, the player is omitted from the public top-25 rows.
- **Zero-Cash & Single-Tier Rules**:
  - Strictly **1 level** deep (no multi-level/MLM chains).
  - **0%** of prize pools (`Pool v5` has no referral leg) and **0%** of spectator donations (`referral_donation_share_bps = 0`, Decision 50; the `also` transfer leg in donation orders is removed).
  - No separate streamer referral tier, and no TEN4 commission on a friend's ticket purchases.

### 2.5 Target `GameSetting` Keys Summary (`MASTER_PLAN.md` §12)

| Setting Key | Default | Meaning |
|---|---|---|
| `referral_pending_ttl_hours` | `72` | Hours before an unactivated `pending` bind is deleted |
| `referral_qualify_window_days` | `60` | Days from activation (`pending → active`) to reach M1 and M2 |
| `referral_pending_base` | `5` | Base concurrent `pending` invite slots |
| `referral_pending_per_active` | `2` | Extra `pending` slots per active friend `A` |
| `referral_pending_max` | `100` | Maximum concurrent `pending` slots (`min(100, 5 + 2*A)`) |
| `referral_active_window_days` | `30` | Rolling window (days) defining active friends `A` (`>= 1` counted ride) |
| `referral_ten4_m1_amount` | `100` | Base TEN4 reward for Milestone M1 |
| `referral_ten4_m1_weeks` | `2` | Distinct ISO weeks with `>= 1` counted ride required for M1 |
| `referral_ten4_m2_amount` | `50` | Base TEN4 reward for Milestone M2 |
| `referral_ten4_m2_weeks` | `5` | Distinct ISO weeks with `>= 1` counted ride required for M2 |
| `referral_ten4_referrer_monthly` | `1000` | Monthly TEN4 cap per referrer wallet |
| `referral_ten4_global_monthly` | `60000` | Steady-state global monthly TEN4 referral cap |
| `referral_ten4_soft_start_monthly` | `30000` | Global monthly TEN4 referral cap during soft-start |
| `referral_ten4_soft_start_months` | `3` | Duration (months from `tge_at`) of the `30,000 TEN4/mo` soft-start cap |
| `referral_min_trust_referrer` | `50` | Minimum `TrustScore` required for a referrer to earn M1/M2 TEN4 |
| `referral_referee_promo_per_referrer_day` | `3` | Max 1h promo ride gifts triggered by one referrer per UTC day |
| `referral_referee_promo_per_referrer_week` | `10` | Max 1h promo ride gifts triggered by one referrer per ISO week |
| `referral_referee_promo_global_week` | `500` | Max 1h promo ride gifts across all referrers per ISO week |
| `referral_referee_promo_ranked` | `0` | Whether the referee's gifted 1h promo shift can be ranked (`0` = unranked) |
| `referral_count_weekly_grant` | `1` | Whether a friend's weekly free 1h ticket counts as a counted ride when friend `trust >= 100` |

---

## 3. Rules (`REF-M-*` & `REF-T-*`)

| Rule ID | Rule | Enforced By | Test ID |
|---|---|---|---|
| **REF-M-01** | Every wallet gets at most one 8-char invite code from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (`default gift: 'convoy'`), minted lazily under the player lock (`findByWalletForUpdate`) with up to 5 collision retries in separate transactions (`409 code_exhausted` on exhaustion). | `mintCode`, `isReferralCode`, `ReferralService.ensureCode` | `REF-T-01`, `REF-T-02` |
| **REF-M-02** | Valid gift items are strictly `['convoy', 'signal', 'amber']` (`GIFT_ITEMS` in `slot: 'truck_color'`, `referralOnly: true`, refused in `/api/garage/buy`). `POST /api/referrals/gift` rejects any other value with `400 bad_gift`. | `isGiftItem`, `ReferralService.gift`, `BuyCosmeticHandler` | `REF-T-03` |
| **REF-M-03** | On `main`, invite capacity is `min(referralMax, referralInviteStart + referralInviteStep * floor(verifiedPaidShifts / referralShiftsPerStep))` (default `min(30, 3 + 3 * floor(paidShifts / 5))`), and `available = max(0, capacity - used - pending)`. | `inviteCapacity`, `invitesAvailable` | `REF-T-04` |
| **REF-M-04** | `POST /api/referrals/bind` trims and uppercases `code`, rejects malformed codes with `400 bad_code`, and settles overdue `'pending'` rows before evaluating bind refusal. | `ReferralService.bind`, `ReferralService.settleExpired` | `REF-T-05`, `REF-T-06` |
| **REF-M-05** | Multi-wallet referral transactions always lock wallets in lexicographical address order (`[...new Set(wallets)].sort()`) via `findByWalletForUpdate` so concurrent binds and qualifications never deadlock. | `ReferralService.lock` | `REF-T-07`, `REF-T-18` |
| **REF-M-06** | `bindRefusal` enforces strict precedence: `unknown_code` (409) → `own_code` (409) → idempotent same-referrer re-bind (`200` no-op, even if slots filled or a ride started) → `expired` (409) → `already_bound` to another referrer (409) → `no_slots` (409) → `ride_started` (`startedAt !== null`, 409). | `bindRefusal`, `ReferralService.bind` | `REF-T-08`, `REF-T-09` |
| **REF-M-07** | On `main`, a new bind creates a `'pending'` `ReferralRecord` with `expiresAt = boundAt + referralInviteTtlDays * 86_400_000` (14d), and once `'expired'` it is a permanent tombstone. (In target Convoy §2.1, `pending` TTL is `72h` and expired `pending` rows are deleted.) | `ReferralService.bind`, `bindRefusal` | `REF-T-10`, `REF-T-21` |
| **REF-M-08** | Qualification (`ReferralService.onVerified`) triggers only when `ride.status === 'completed'` and `verdict.status === 'verified'`. Overdue pending rows (`now > expiresAt`) expire without granting rewards. | `ReferralService.onVerified`, `qualifyDecision` | `REF-T-11` |
| **REF-M-09** | On `main`, on the referee's first verified ride completion (any tier/level), `status` becomes `'qualified'` and the referrer unlocks their selected `gift` paint (`slot: 'truck_color'`, `code: 'referral'`), auto-equipping it if the referrer wears default `'red'` or nothing. | `qualifyDecision`, `ReferralService.paint` | `REF-T-12` |
| **REF-M-10** | On `main`, free-ride referral grants (`+2` referrer, `+3` referee by default) fire **only** when the first qualifying completion is a verified MEDIUM free run (`level === 2`, `!paid`) within `referralFreeRideWindowDays` (7d) of `boundAt` and the referrer is under `referralFreeRideWeeklyCap` (10). | `qualifyDecision`, `ReferralService.onVerified` | `REF-T-13` |
| **REF-M-11** | On `main`, `badgeCounted` becomes `true` once when the referee completes a verified paid shift (`paid === true`) or a verified HARD free run (`level === 3`) with `assist === false`, feeding the 4 Convoy achievement tiers (`1 / 5 / 20 / 100`). | `qualifyDecision`, `ReferralService.onVerified` | `REF-T-14` |
| **REF-M-12** | Spectator donation share on `main` (`donationShare`): when the driver has a `'qualified'` referrer and `spectator !== referrer`, `min(floor(price * bps / 10000), cap - already)` goes to the referrer (where `already` includes `'paid'` orders plus `'pending'` orders younger than `15m`), or `0` if `share < 890,880` (`DONATION_RENT_MIN`) or `price - share <= 0`. | `donationShare`, `ReferralService.donationReferrer`, `sumReferredLamports` | `REF-T-15` |
| **REF-M-13** | Legacy pool referral split (`allocatePoolShares`): distributes `referralPot` by top-20 rank weight, caps each referrer at `rideCap`, redistributes unallocated remainder across other top-20 riders, and never exceeds `referralPot` (`referralPaid <= referralPot`). | `allocatePoolShares`, `referralPaid` | `REF-T-16` |
| **REF-M-14** | TEN4 referral emission (`referralQuoteUnits`, `clipReferralPayout`, `programs/freightchain_honk` `pay_referral` & `burn_referral_tail`): scales base grants (`M1 = 100`, `M2 = 50`) by `>> max(era_ref, era_ride)` across `HONK_REFERRAL = 4M TEN4` and clips by remaining cap, era, monthly global cap (`30k` first 3 mo, then `60k`), and monthly wallet cap (`1k`), with PDA `[b"referral", reward_id]` preventing double-payout. | `referralQuoteUnits`, `clipReferralPayout`, `freightchain_honk` | `REF-T-17` |
| **REF-M-15 (Target Convoy)** | Target Convoy rework (§2): `0%` spectator donation share (`referral_donation_share_bps = 0`, no `also` transfer leg); `pending` (72h, deleted on expiry) → `active` (60d window on verified MEDIUM/HARD test ride + 1h promo ride gift capped at `3/day`, `10/week`, `500/week` global) → `qualified` on M1 (`100 TEN4` at 2 ISO weeks + required campaign tasks) and M2 (`50 TEN4` at 5 ISO weeks) with referrer `trust >= 50` and 48h hold; dynamic pending slots `min(100, 5 + 2*A)`; 25-row Convoy leaderboard with `convoyHidden`. | Target Convoy handlers (§2.1–§2.5) | `REF-T-20`, `REF-T-21`, `REF-T-22` |

---

## 4. Verification & Test Suite Plan (`REF-T-*`)

### 4.1 Unit Tests (`server/src/domain/referral/*.spec.ts`, `tokenomics.spec.ts` & `referral.service.spec.ts`)
- **`REF-T-01`**: `mintCode` and `isReferralCode` generate and validate exact 8-character strings from `REFERRAL_CODE_ALPHABET` (`ABCDEFGHJKLMNPQRSTUVWXYZ23456789`), rejecting `<8`, `>8`, lowercase, or ambiguous glyphs (`0`, `O`, `1`, `I`).
- **`REF-T-02`**: `ReferralService.ensureCode` returns an existing code idempotently, retries in a new transaction on `code_taken` collision, and throws `409 code_exhausted` after 5 failed attempts.
- **`REF-T-03`**: `isGiftItem` and `ReferralService.gift` accept `'convoy' | 'signal' | 'amber'` and throw `BadRequestError('bad_gift')` (400) for any other string; `BuyCosmeticHandler` rejects `referralOnly` paints with `409 referral_only`.
- **`REF-T-04`**: `inviteCapacity` and `invitesAvailable` compute `min(30, 3 + 3 * floor(paidShifts / 5))` and `max(0, capacity - used - pending)` across boundary shift counts (`0, 4, 5, 45, 50`).
- **`REF-T-05`**: `ReferralService.bind` normalizes whitespace/case and throws `400 bad_code` for invalid format.
- **`REF-T-06`**: `ReferralService.settleExpired` commits expired pending tombstones in a separate transaction so a subsequent `409 expired` or `409 no_slots` does not roll back the expiration.
- **`REF-T-07`**: `ReferralService.lock` deduplicates and sorts wallet addresses lexicographically before calling `players.findByWalletForUpdate`.
- **`REF-T-08`**: `bindRefusal` and `bindRefusalMessage` return `unknown_code`, `own_code`, `expired`, `already_bound`, `no_slots`, and `ride_started` in exact priority order with exact human messages.
- **`REF-T-09`**: Idempotent re-bind: calling `bind` again with the same referrer's code when `status !== 'expired'` returns `null` (`200 OK`) even when `available === 0` or `started === true`.
- **`REF-T-10`**: Tombstone rule on `main`: once a referee's pending row expires (`status === 'expired'`), attempting to bind the same code or a different referrer's code rejects with `409 expired`.
- **`REF-T-11`**: `qualifyDecision` and `onVerified` ignore unverified/non-completed rides and mark overdue pending rows `'expired'` with no grants.
- **`REF-T-12`**: First verified ride completion (e.g., EASY `free-1c`) transitions `pending → qualified`, sets `colour: true`, unlocks the referrer's chosen gift in `slot: 'truck_color'`, and equips it if the referrer still wears `'red'`.
- **`REF-T-13`**: `qualifyDecision` grants `{ referrer: 2, referee: 3 }` free rides only when the first verified completion is `level === 2` (`!paid`) within 7 days of `boundAt` and `weeklyGranted < 10`; a subsequent MEDIUM ride after qualifying on EASY grants `null`.
- **`REF-T-14`**: `qualifyDecision` sets `badge: true` on a verified paid shift or HARD (`level === 3`, `!assist`), including when the referral was already `'qualified'` on an earlier EASY/MEDIUM run, and never sets `badge: true` a second time (`alreadyBadge === true`).
- **`REF-T-15`**: `donationShare` enforces `bps = 1000`, lifetime `cap = 500_000_000`, `DONATION_RENT_MIN = 890_880`, 15m pending reservation hold, and `spectatorIsReferrer → 0`.
- **`REF-T-16`**: `allocatePoolShares` and `referralPaid` conserve lamports, respect `rideCap`, redistribute excess to other top-20 finishers, and give dust to rank 1.
- **`REF-T-17`**: `referralQuoteUnits`, `clipReferralPayout`, and LiteSVM tests for `programs/freightchain_honk` (`pay_referral`, `burn_referral_tail`) enforce halving eras (`2M → 1M → 500k`), soft-start monthly global cap (`30k` for months `0..2`, `60k` for `>= 3`), `1,000 TEN4` monthly wallet cap, and `[b"referral", reward_id]` double-payout rejection.

### 4.2 Integration, Concurrency, E2E & Target Rework Tests (`server/test/` & `e2e/`)
- **`REF-T-18`**: PostgreSQL concurrency & deadlock test (`server/test/integration/`): concurrent cross-binds (`A → B` and `B → A`) and concurrent `onVerified` calls serialize cleanly via sorted `findByWalletForUpdate` without deadlocking or exceeding `inviteCapacity` / `referralFreeRideWeeklyCap`.
- **`REF-T-19`**: HTTP & E2E referral flow (`server/test/http/flows.spec.ts` `referrals.scenarios.ts` & `e2e/catalog.mjs` `B1-REF-*`): mints code on `GET /api/referrals`, changes gift on `POST /api/referrals/gift`, binds on `POST /api/referrals/bind`, verifies refusal codes (`own_code`, `already_bound`, `ride_started`, `no_slots`), completes qualifying rides, and verifies paint unlock, free-ride grants, Convoy badge progression, and donation split.
- **`REF-T-20 (Target D50)`**: Verify `RPL-T-86` / `RPL-T-100` / `LEG-T-02` once Decision 50 lands: spectator tip sends 100% to driver with `0` referrer share and no `also` transfer leg.
- **`REF-T-21 (Target Convoy Lifecycle & Promo Gift)`**: Verify `pending` 72h expiry deletes the row (allowing re-bind); EASY completion leaves row `pending`; verified MEDIUM/HARD transitions `pending → active` (60d window) and grants 1 unranked 1h `PromoRideGrant` to the referee while enforcing the `3/day`, `10/week`, and `500/week` global caps; dynamic pending slots follow `min(100, 5 + 2*A)`.
- **`REF-T-22 (Target Convoy Milestones M1/M2 & Leaderboard)`**: Verify counted ride rules (paid verified ranked shift, or weekly free 1h ticket when `referral_count_weekly_grant = 1` and referee `trust >= 100`; promo ride never counts), M1 (`100 TEN4` at 2 distinct ISO weeks + campaign `requiredTasks`), M2 (`50 TEN4` at 5 distinct ISO weeks), referrer `trust >= 50` gate, 48h payout hold, and 25-row Convoy leaderboard with `convoyHidden` opt-out.

### Convoy settlement recovery (25 October)

Qualification timestamps record when M1/M2 was earned; a payout hold does not cause an otherwise qualified invite to expire at day 60. The minute scheduler processes up to 50 due rewards, locks both players in wallet order, checks the 48-hour hold/trust/rejection gate and claims a two-minute lease. RPC runs outside the transaction. A signed transaction and its last valid block height are persisted under that lease before broadcast. A replacement worker checks the receipt/signature before any resend; an unknown signature is replaceable only after finalized block-height expiry.

Only the program-owned, correctly sized/discriminated receipt for the reward and recipient credits `HonkAccount`, for its actual clipped amount. Receipt acknowledgement and credit commit together. Confirmed emission/monthly/wallet-cap refusals become terminal `capped` rows without spendable credit or backlog. A low-trust unsent reward remains held; an already submitted payment is still reconciled if trust changes. Configured but invalid emitters fail visibly and remain pending. With emission disabled new rewards remain held. The migration defaults old rows to `legacy` because earlier milestone evidence needs review; it never blindly mints them.

`e2e-convoy-settlement.mjs` runs in the local TEN4 suite after its API stops: real token transfers, PostgreSQL restart after RPC failure, lost-response receipt recovery, competing workers and a terminal 1,000 TEN4 monthly wallet cap. These are seeded milestone facts, not additional driven rides. Provider fixture tests and this local acceptance do not establish live campaign/provider readiness.
