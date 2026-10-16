# Referrals – detail

Agent reference (see AGENTS.md). Read this before changing invites, the referral pot, or the donation share. The product write-up is `docs/features/referral/README.md`.

## In short

- **One referrer, ever.** `POST /api/referrals/bind` `{code}` before any ride on that wallet has `startedAt` (abandoned counts). An expired invite is a tombstone: the slot returns to the referrer and that wallet cannot bind again. Own code, a second referrer, an unknown code, no slots, or a started ride is 409 (`own_code`, `already_bound`, `unknown_code`, `no_slots`, `ride_started`). A bad code is 400. The same live code again is 200.
- **Codes.** 8 characters from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (no I, O, 0, 1). `GET /api/referrals` mints one on first read. `POST /api/referrals/gift` `{item}` is `convoy` | `signal` | `amber` (default convoy).
- **Capacity.** `min(referral_max, referral_invite_start + referral_invite_step × floor(verified paid shifts / referral_shifts_per_step))`. Defaults 30, 3, 3, 5. Used = qualified rows. Pending = pending and not expired. A verified finish of any kind spends the invite. Rejected or flagged does not.
- **Free rides.** First verified finish that is the MEDIUM free run (`free-2c`) within `referral_free_ride_window_days` (7), under `referral_free_ride_weekly_cap` (10, counted over that same window): `referral_free_rides_referrer` (2) and `referral_free_rides_referee` (3), via `grantFreeRides`, which may pass the daily cap. A 0 on one side grants only the other.
- **Colour.** On that first qualify the referrer's gift `truck_color` unlocks (`CosmeticUnlock.code` `referral`) and is equipped when they still wear default red or nothing. Spectators see it. It does not change handling.
- **Convoy badges.** `convoy` / `convoy-2` / `convoy-3` / `convoy-4`, targets 1 / 5 / 20 / 100. Counted once when the friend's verified ride is a paid shift or the HARD free run with assist off. A MEDIUM-only qualify still spends the invite; a later paid or HARD ride can set `badgeCounted`. The referrer's badge is evaluated on their next profile read or ride end, not inside the friend's end-ride.
- **Pot.** A new pool's split is `6500/2000/1000/500` (prizes / seed / fees / referrals). Fee stays 10% as the remainder. Seed stays 20%. Five points come off the prize pot only. `referral_bps` 0 keeps an old `7000/2000/1000` pool. One winners root. Rider leaves first (prize plus any referral remainder), then one leaf per referrer wallet (`PoolPayout.kind`). Ranks are contiguous. The per-pool cap is `referral_ride_cap_lamports` (1 SOL). The referrer takes `referral_referrer_part_bps` (8000) of that rider's referral slice; the rest of a sponsored slice is split across the other top 20. An unsponsored rider keeps their own slice. A promo ticket (no on-chain `bought`) is not sponsored. Detail of the floors: `domain/referral/referral-split.ts`.
- **Donations are not custody.** When the driver's invite is qualified and the spectator is someone else, the signed transfer splits: the referrer gets `referral_donation_share_bps` (1000) up to `referral_donation_cap_lamports` (0.5 SOL) for that pair. A share below the rent-exempt minimum (890_880), or that would leave the driver nothing, stays one transfer to the driver. The share is reserved under the two player locks and released if the order is not claimed within 15 minutes or verify fails.
- **Knobs** are `player.GameSetting` rows (signed admin settings), not env. Lamport caps stop at 2_000_000_000 because `value` is a signed 32-bit int. `referral_referrer_part_bps` minimum is 5001 so the referrer keeps the bigger part.

## Where

`server/src/domain/referral/` rules and the pot split · `ReferralService` bind / qualify · `ReferralPayoutService` the leaves · `presentation/referrals/` · `player.Referral` + `player.ReferralCode` · migration `20261029000000_referrals`. The lobby block is `client/site/referral.js`. Qualify runs after the verdict transaction commits (`VerdictService.afterVerified`), locking the two wallets in address order in a new transaction.

## Not in this

No second level. No referral token. No share of a promo ticket's SOL. No bind after a ride has started. The program's `referral_bps` is in the v4 source; devnet still runs v3 until a deploy the user asks for.
