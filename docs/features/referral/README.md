# Referrals

One wallet invites another. The friend binds that code before their first ride. A verified finish spends the invite and can pay the inviter in free rides, a cab colour, a Convoy badge, a share of a prize pool, and a share of spectator tips.

Status: built on branch `referral` (`f3876330`). Not deployed. Devnet still runs escrow program v3. The v4 source knows the referral leg; it reaches devnet only when a deploy is asked for. There is no referral token.

The code map is `docs/agents/referral.md`. This page is the product: rules, rewards, knobs, limits, and what a player sees.

## People

| | |
|---|---|
| Inviter | The wallet that owns the code. One code, minted the first time they open Referrals. |
| Friend | The wallet that binds that code. One inviter for the life of the wallet. |
| Spectator | Someone tipping a live driver. If that driver's invite is already qualified, part of the tip can go to the driver's inviter. |

A wallet cannot bind its own code. A second inviter is refused. An expired invite stays on the wallet as a tombstone: that friend can never bind anyone else, and the inviter's slot comes back.

## How a player uses it

1. Sign in and open the lobby. The profile has a **REFERRALS** block, next to promo codes.
2. The block shows an 8-character code and a link, `/?ref=CODE` on the site origin. **COPY LINK** puts that URL on the clipboard.
3. The friend opens the link. The code is stored in the browser (`freightchain.ref`) and removed from the address bar. Nothing is bound yet.
4. The friend signs in. The lobby then binds the stored code. A success, or a refusal the server will not change its mind about, clears the stored code. A network failure keeps it, and the next signed-in visit tries once more.
5. The friend must bind **before any ride on that wallet has started**, including a ride they abandoned.
6. They drive. The invite stays open for 14 days from the bind. The instant 14 days is up, it is still open. The next moment, it expires if they have not qualified.
7. The first **verified** finish, free or paid, qualifies them. A rejected or flagged ride does not. A verified ride after the window has closed expires the invite and does not qualify.

The inviter picks the gift colour at any time. The colour that is selected when the friend first qualifies is the one that unlocks.

## What the lobby shows

The block is titled **REFERRALS**.

- The code, in full, and the share URL under it.
- **COPY LINK**. Success says "Link copied." If the clipboard refuses, it says to select the link and copy it.
- **Used** is qualified friends over current capacity, such as `1 / 3`. **Open** is invites still available.
- **Invited by** and a shortened wallet, when this wallet itself has a live inviter. An expired row shows nothing here.
- Three gift paints: **Convoy**, **Signal**, **Amber**. The selected one is pressed. Choosing another says "{name} is the gift colour now."
- The line under the paints says the colour is for a friend who qualifies, and that it is worn when the red truck is still on. The rule is narrower than that sentence: the colour unlocks for the **inviter**, and it is put on only when they still wear the default red or have nothing equipped. If they already wear another paint, it is unlocked in the garage and left unworn. Spectators see whatever is worn. The paint does not change handling.
- **INVITES** lists each friend as a shortened wallet, a status (`pending`, `qualified`, `expired`), and the local date of the qualify, or of the bind if they have not qualified. Empty state: "No invites yet."
- While the profile is loading, the block says "Loading…". If the request fails, it says it could not load referrals.

Driving is desktop-only. The block itself is the lobby profile, which is where the link is copied and the gift is chosen.

## Rules

**Code.** Eight characters from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`. I, O, 0, and 1 are not minted, so a code is readable aloud. The client accepts any 8 letters or digits and lets the server refuse a bad one.

**Capacity.**

`min(invite cap, invites at the start + invites each step × floor(verified paid shifts / paid shifts per step))`

With the defaults that is `min(30, 3 + 3 × floor(paid shifts / 5))`.

| Verified paid shifts | Capacity |
|---|---|
| 0–4 | 3 |
| 5–9 | 6 |
| 10–14 | 9 |
| … | +3 each five shifts |
| 45 and above | 30 |

Used = qualified friends. Pending = pending and not yet expired. Open = capacity − used − pending, and never below zero. Due invites are expired before the count, so a returned slot is open immediately.

**Qualify.** After the ride is judged verified, a follow-up step locks the friend and the inviter and applies the rewards. It can run again safely. If that step fails, the verdict still stands and the qualify is logged to be retried. The same step runs when an admin review or a later check flips the ride to verified.

**Free-ride bonus.** On the first qualify, if that ride is the MEDIUM free run (`free-2c`) and it finishes inside the bonus window (default 7 days from the bind), the inviter receives 2 free rides and the friend receives 3. These are added on top of the daily grant and may pass the daily cap. A new account starts with 10 free rides, so one such bonus leaves the inviter at 12 and the friend at 13. If either side is set to 0, only the other side is granted. Each referral grants this once.

The inviter can receive this bonus for at most 10 friends inside that same bonus window. It is not a separate calendar week. Friends past the cap still qualify, spend the invite, and unlock the colour. They do not grant the free rides.

**Colour.** Unlocked once, on the first qualify, whatever kind of ride it was. Unlock code `referral`. Default gift is Convoy.

| Paint | Look |
|---|---|
| Convoy | orange, `#ff8a1e` over `#8a3a08` |
| Signal | yellow, `#f2f20a` over `#6e6e04` |
| Amber | gold, `#ffb000` over `#8a5a00` |

The garage collectible total is 28. Truck paint is 9 parts, 8 of them collectible. The other slots stay 6 parts, 5 collectible. Default red is unchanged.

**Convoy badges.** A new ladder. Existing achievement ids are not retuned.

| Id | Name | Friends |
|---|---|---|
| `convoy` | Convoy | 1 |
| `convoy-2` | Road Crew | 5 |
| `convoy-3` | Fleet | 20 |
| `convoy-4` | Haulmaster | 100 |

A friend counts when a verified ride of theirs is a **paid** shift, or the **HARD** free run (`free-3b`) with assist off. A MEDIUM-only qualify still spends the invite and does not count. A later paid or HARD ride by that same friend can count them. The count is applied on the inviter's next profile read or ride end, not at the moment the friend finishes. The art exists in the repo. It is not uploaded, and these four badges are not minted on devnet yet. The merged catalogue has 38 badges across 10 ladders, including HONK and Convoy; the four Convoy badges await metadata upload.

**Pot share.** Only when an invited rider places in the top 20 and their best verified ride in that pool was an on-chain ticket (the ride has a pool, the tier is paid, and at least one ticket for that pool was bought). A promo ticket adds a driver and no SOL, and does not pay an inviter. A wallet that holds both a bought ticket and a promo ticket is treated as on-chain. The inviter must be qualified, or still pending when this ride is the one that qualifies them. They must not be the rider themselves. An expired invite pays nothing.

The referral pot is divided with the same weights as the prize pot: 25 / 15 / 10 for the first three, plus 20 shared across the top 20 (70 parts in all). Amounts are rounded down. Dust left in the vault becomes seed when the pool closes.

Of a sponsored rider's slice, the inviter takes 80%. The other 20%, and anything over the inviter's cap, is split across the **other** top 20, with those same weights scaled to whoever is in that group. Dust of that split goes to the best finish in the group. If the sponsored rider is the only one in the top 20, that leftover comes back to them and is added to their prize. An unsponsored rider's whole slice is added to their own prize.

One inviter can take at most 1 SOL from one pool, filled from their best-placed friend first. Payments are one winners list: each finisher, then one payment per inviter. An inviter who also finished top 20 is paid twice, once as a finisher and once as an inviter. Ranks stay contiguous. A zero payment is dropped.

**New pools** are 65% prizes, 5% referrals, 20% seeding the next pool, 10% fees. The five points come off the prize share only. Fees stay 10% because they are whatever is left after the other three legs are rounded down. Seed stays 20%. A pool created with the old three-number split (`7000/2000/1000`) has no referral leg. Pools already open are not rewritten.

**Donation share.** Tips are not held by the server. The spectator signs a transfer, and the prices are unchanged: tip 0.01 SOL, night / day / potholes 0.02, trench 0.03, sinkhole 0.05.

When the driver's invite is qualified, the spectator is not the inviter, and the inviter's piece is at least the rent needed to open an empty account (890,880 lamports) while the driver still receives something, the transaction is two transfers: the tip minus the share to the driver, and the share to the inviter. Otherwise the whole tip goes to the driver. A pending invite pays the inviter nothing.

The default share is 10%. A 0.01 SOL tip then sends 0.001 SOL to the inviter. The pair (inviter, driver) has a lifetime cap of 0.5 SOL, counting shares that are held or already paid. The hold lasts 15 minutes. An unclaimed or failed tip releases the hold, and that amount does not count toward the cap. A tip that lands as a split after the hold has already been released is not accepted.

## Config

Every number below is a `player.GameSetting` row. An admin changes it with the signed settings API. It is not an environment variable. A missing or out-of-range value falls back to the default. Lamport values stop at 2,000,000,000 because the stored value is a signed 32-bit integer.

The admin page lists each knob with the label in this table.

| Key | Label | Default | Allowed |
|---|---|---|---|
| `referral_max` | Invite cap | 30 | 1–1000 |
| `referral_invite_start` | Invites at the start | 3 | 0–1000 |
| `referral_invite_step` | Invites each step | 3 | 0–1000 |
| `referral_shifts_per_step` | Paid shifts per step | 5 | 1–1000 |
| `referral_invite_ttl_days` | Invite window, days | 14 | 1–90 |
| `referral_free_ride_window_days` | Free-ride bonus window, days | 7 | 1–90 |
| `referral_free_rides_referrer` | Free rides for the inviter | 2 | 0–20 |
| `referral_free_rides_referee` | Free rides for the friend | 3 | 0–20 |
| `referral_free_ride_weekly_cap` | Free-ride bonuses a window | 10 | 0–1000 |
| `referral_referrer_part_bps` | Inviter's part of a slice | 8000 (80%) | 5001–10000 |
| `referral_ride_cap_lamports` | Inviter cap per pool | 1,000,000,000 (1 SOL) | 0–2,000,000,000 |
| `referral_donation_share_bps` | Donation share to the inviter | 1000 (10%) | 0–10000 |
| `referral_donation_cap_lamports` | Donation cap per friend | 500,000,000 (0.5 SOL) | 0–2,000,000,000 |

The inviter's part cannot be set to half or less, so they stay the larger share of a sponsored slice. The weekly-cap hint on the admin page names the bonus window, not a fixed seven days.

The pool split is chosen when the pool is created, not by these rows. `pool-admin` may offer `6500/2000/1000/500` (prizes / seed / fees / referrals). Leaving off the fourth number means 0.

## Refusals a player can hit

| Situation | What they are told |
|---|---|
| Their own code | that is your own code |
| Already bound to someone | this wallet already has a referrer |
| The same code, still live | Accepted again. No second invite is spent. |
| Same code after it expired | that invite expired |
| Unknown code | unknown referral code |
| Inviter has no open slots | that wallet has no invites left |
| A ride already started on this wallet | a ride has already started on this wallet |
| I, O, 0, 1, or any other bad shape | Rejected as a bad code before those cases |

## Public copy

The landing and the pitch deck say the split is 65 / 5 / 20 / 10. The whitepaper's split sentence says the same, and it still says there is no referral token. The whitepaper diagram and the $26 example still draw a 70% prize share, on purpose, until a content pass fits the new figures into the page budget. The four Convoy cards are not on the whitepaper. The landing may still say eight ladders and 31 badges.

## Limits, on purpose

- No second level of invites. No referral token. No retroactive bind after a ride has started.
- No SOL from a promo ticket. The prize pot is not cut further than the 5% leg.
- A friend who never verifies returns the slot and can never be invited by anyone.
- Donation tips are not custody. The server does not hold the spectator's SOL.
- Convoy badges are in the catalogue and not minted yet.
- Nothing here is on production, and the devnet program does not pay the referral leg until v4 is deployed.
