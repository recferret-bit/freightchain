# Weekly prize contest — spec

**Draft. Needs legal review.** Not legal advice. The owner chose variant B of the 2026-10-16 prize-pool research. Variant B is a skill contest. Training rides are not an entry. The free path onto a board is a granted paid ticket on each enabled tier (AMOE; default one 1h ticket every 7 days), plus a separate promo-code slot. Flag for counsel: 18+ is a checkbox, country comes from edge headers, and a wallet is free, so this is closer to an equal-chance entry than a promo code and it is not a finished one-person method of entry.

This contest is not the on-chain ticket vault (`programs/freightchain_pools`). That program still sells tickets and pays its own winners root. This contest is funded by the operator: a published base plus a capped share of the previous week's ticket revenue, paid in USDC after KYC. The program was not changed. TEN4 is never a prize, an entry, or a score boost.

The rules live in `server/src/domain/prize/`. Pool maths and eligibility are pure functions. A ranked start is now stored on the ride. USDC is still not sent.

## Week

Ranked play is Monday 00:00 UTC through Sunday 12:00 UTC (`prizeWeek`). Verification is Sunday 12:00 UTC through Monday 12:00 UTC. Appeals run until Tuesday 12:00 UTC, and payouts begin then, on Tuesday. The next ranked week opens Monday 00:00, so verification and appeals of the closing week overlap it (`openSettlement`). The legacy pay-per-ride round is a different ledger.

Three boards, one shared weekly route (the same seed for every ranked start of that tier). Shares of the week's distributable cents:

| Board | Tier | Share |
|---|---|---:|
| Sprint | 1h | 25% |
| Haul | 4h | 30% |
| Long Haul | 8h | 45% |

A leftover cent from the floor goes to the 8h board.

## Ranked starts

A wallet may buy as many tickets as it wants. A start counts only when it is declared ranked before it starts, and only when the tier's nominal length would finish by Sunday 12:00 UTC. An 8h ranked start has to begin by Sunday 04:00 UTC. A 4h start by Sunday 08:00. A 1h start by Sunday 11:00. Ending exactly at Sunday 12:00 is allowed. A start that would run past the close is `409 ranked_window` and the ride stays ready, so it can still start unranked. A training ride (`tier` free, not a promo) is `409 ranked_training`. It is not an entry.

Per wallet per week the counted starts are the first 5 paid declarations and the first 1 promo declaration, in start order. The weekly granted ticket is a paid tier, so it uses one of those five paid slots. A sixth slot was not added: five purchased starts plus the grant plus the promo would be seven ranked starts. A ride promo is not a purchase. It uses the promo slot. A missing or late declaration does not use a slot. Anything past those caps is unranked. An unranked purchased ride still earns TEN4, donations, and cosmetics. A promo ride does not mint TEN4. The granted ticket does not mint TEN4 either (see below). The board uses the best single counted attempt on that tier. A granted or promo 1h, 4h, or 8h ride is on that tier's board.

### Weekly granted ticket (AMOE)

Each enabled tier has its own row in `player.WeeklyTicket`. The row is granted, not purchased. Six `GameSetting` keys, two per tier:

| Key | Default | Meaning |
|---|---:|---|
| `weekly_ticket_1h_enabled` | 1 | 0 off, 1 on |
| `weekly_ticket_1h_days` | 7 | days between 1h grants |
| `weekly_ticket_4h_enabled` | 0 | 0 off, 1 on |
| `weekly_ticket_4h_days` | 7 | days between 4h grants, stored even while the flag is off |
| `weekly_ticket_8h_enabled` | 0 | 0 off, 1 on |
| `weekly_ticket_8h_days` | 7 | days between 8h grants, stored even while the flag is off |

An enabled flag is only 0 or 1. An interval is an integer of at least 1 day. The old key `weekly_ticket_tier` is gone and is not mapped onto a tier. A missing row uses the code default.

Slots are calendar intervals of that many UTC days, anchored at `SEASON_EPOCH` (Monday 2026-10-12). An interval of 7 therefore starts on a prize-week Monday. The primary key is `(wallet, tier, periodStart)`. A second insert in the same slot does nothing.

**Expiry.** An unused grant expires at the start of the next slot of that tier, or at Sunday 12:00 UTC (`week.end`), whichever is earlier. That is the ranked close, not a rolling timer from the moment the wallet asked. Nothing is issued between Sunday 12:00 and Monday 00:00. One unspent grant per tier: a still-live grant is not replaced, so shortening the interval does not stack a second ticket on top of it. Turning a flag off stops the next grant of that tier. A grant already issued stays until it expires. A spent or expired row for the current slot blocks another until the next slot. 1h and 4h can both be live when both flags are on. They do not stack with each other; each is its own tier.

Issued lazily on `GET /api/me` and when ordering a paid tier, only when all of these hold: the wallet is not a guest, `age18At` is set, and `prizeAccess.ranked` is true from the edge geo headers. Unknown country fails closed. The loss stamp is not required. A guest never receives one. `/api/me` returns `weeklyTickets`: `{ tier, expiresAt, rideId }[]`.

Ordering that tier spends it (`Ride.weeklyGrant`, price 0, status created). It can be watched, because it is not a free ride. Declaring it ranked uses one of the five paid slots and re-checks 18+ and geo. The ranked-start deadlines still apply: an 8h start by Sunday 04:00 UTC, a 4h start by 08:00, a 1h start by 11:00. The grant is preferred over a purchased pool ticket so it is not left to expire.

**TEN4: no.** Wallets are free, 18+ is a checkbox, and a client can spoof geo if the edge does not strip those headers. An automatic weekly mint would be an emission faucet. Purchased rides and admin ticket-promo rides still mint TEN4. Ride-promo codes do not. The USDC board is the free prize path.

Anti-sybil, as built: one unspent grant per wallet per tier per interval, not cumulative, guests excluded, 18+ and prize geo required to receive it and to start it ranked. A person can still open many wallets and enter the USDC board once per wallet per tier per interval. The layered plan (fingerprint, telemetry clusters, on-chain funding, proof of personhood on the grant, KYC only before payout) is `docs/roadmap/anti-sybil.md`. It is not built. Board attention marks, the 10-participant floor, and KYC before a payout stay. Counsel should say whether the grant is an acceptable free method of entry until that plan exists.

## Score

Percent of route distance before the first mistake, in basis points (`cleanBps`, `rankedAttemptScore`). On a ranked ride the server freezes `cleanMetres` at the previous heartbeat when hull falls below 100 or a crash counter rises. Until that happens the clean distance is the reported distance. A failed or abandoned ranked ride still scores that prefix. Corrections are not measured yet, so the tie-break below a clean finish is submission time, then wallet.

Order: higher clean share, then at a clean finish fewer corrections, then the earlier submission, then the wallet. Corrections are not a tie-break below a clean finish.

On a ranked run, spectator obstacles, weather, and day/night must not change the road (`rankedRoadEffects`). The server **refuses** them (`409 ranked_effects_off`) before TEN4 or SOL is spent: TEN4 day/night burns, TEN4 weather burns, and donation obstacles or donation day/night. A chat HONK still burns 1 TEN4 and posts the line. A tip that does not touch the road is still allowed. If a paid donation was already sent, it is delivered as a tip so the money is not lost and the road still does not change. Unranked rides keep today's effects.

## Money

Integer cents. Currency USDC.

- Base starts at $300. Steps are $300, $750, $1,500, $3,000. The base moves up one step when each of the last four weeks took in more than four times the current base.
- Bonus is 40% of the previous week's ticket revenue, capped at $2,500. Because it uses the previous week, it can be announced before this week opens.
- 10% of the capped bonus is reserved for the season final. The other 90% of the bonus, plus the whole base, is split across the three boards.
- A board with fewer than 10 unique wallets pays its base share only. Its bonus share rolls one week. Last week's roll is not rolled again: it goes to the season final.
- Unpaid place shares, an unused finisher pool, a payout under $5, and a winner who is not cleared for payout also roll one week. The next thin week sends that roll to the season final. Rolls do not compound into a jackpot.
- TEN4 is not part of the pool.

## Payout curve

Of each board's payable cents, 80% is places and 20% is the finisher pool.

The top-10 shares are 25 / 15 / 10 / 7.5 / 7.5 / 3 / 3 / 3 / 3 / 3. Ranks 6–10 are 3% each. A tail of 5% each would total 90% and would not leave 20% for finishers, so that parenthetical was not used.

Above 100 participants the board pays the top 10% (`ceil(n / 10)` places) from the same 80%, on linear weights. The research did not publish that curve. This one is a draft stand-in.

The finisher pool is split equally across clean finishes, including a rider who also won a place. Each finisher share is capped at the 10th-place amount. The cap excess rolls. A combined payout under $5 is not sent; the cents roll.

## Eligibility

`prizeAccess`. Lists are the defaults in `prize-rules.ts`. `PRIZE_SANCTIONED_COUNTRIES`, `PRIZE_BLOCKED_COUNTRIES`, and `PRIZE_BLOCKED_US_STATES` replace a list when set (empty keeps the default). There is no admin screen.

The country is read at ranked start, and when the weekly ticket is granted, from edge headers: `CF-IPCountry` and `CF-Region-Code`, then `X-FC-Country` and `X-FC-Region` (`HeaderGeoAdapter`). No paid geo API. `XX` and anything that is not two letters is unknown and fails closed. The edge must set these headers and strip a client-supplied copy, or a caller can invent `X-FC-Country`. The 18+ attestation is the wallet's existing `age18At`. It is required to receive the weekly ticket and to start any ride ranked. The loss stamp is required for a purchased paid start. It is not required for the weekly grant or a promo ride. The country and region are stored on the ride. KYC is not stored, so a board row's `payout` is false and a settlement would roll those cents.

- 18+ attestation (`age18`). Unknown age fails closed.
- Sanctioned-country draft: CU, IR, KP, SY. This is not an OFAC determination. Regions that are not a country code are not listed.
- UK (`GB`) and the 27 EU members are blocked from prize eligibility by default.
- US states SC, AZ, LA, AR, DE (Delaware), MT, TN. Germany is the country `DE`, and is blocked as EU. A US state is read only when the country is US.
- Unknown country fails closed.
- Ranked entry does not require KYC. A payout does. A ranked winner without KYC stays on the board and the cents roll.

## Season

Eight weeks from `SEASON_EPOCH` (`2026-10-12`). Week 8 is the live final (`seasonOf`). The final field on each board is the top 8 by the sum of weekly places (`seasonQualifiers`). A missed week scores 1000, which is worse than any real place, so skipping a week cannot help. The final is one route, watchable, with spectator road effects off. The final ride itself is not built. The same Monday–Sunday window applies to it.

## Wired

- `POST /api/rides/:id/start` body `{ ranked?: boolean }`. The game's start screen has a RANKED checkbox. A refusal is `409` (`ranked_ineligible`, `ranked_training`, `guest_easy_only`, `ranked_window`, `ranked_promo_cap`, `ranked_paid_cap`) and the ride stays ready, so the driver can start it unranked.
- Caps run inside the player-row lock: ranked starts whose `startedAt` is in the current prize week, 5 paid (the weekly grant counts as paid) and 1 promo. A training ride is refused before geo. A start that cannot finish by Sunday 12:00 UTC is `ranked_window`.
- `GET /api/prize/board?tier=1h|4h|8h&at=` returns `bestByWallet` of ended ranked rides of that tier. Training rides are not on these boards. A granted ticket of that tier is.
- `POST /api/auth/guest` opens an anonymous EASY session. That wallet cannot be ranked and does not receive the weekly ticket. Its achievements do not merge.
- Spectator road effects on a ranked ride are refused, as above.

## Not built

- One weekly seed per tier. Ranked rides still use the ride's own seed.
- A sanctions vendor, a KYC vendor, and the USDC send. Payout on the board stays false until KYC exists. The planned checks are `docs/roadmap/anti-sybil.md`.
- Proof of personhood on the weekly granted ticket, browser fingerprinting, cross-wallet telemetry clusters, and on-chain funding clusters. Not built.
- An admin editor for the geo lists and the base step. The lists are env overrides.
- Corrections as a tie-break. The column is not measured.
- Sponsored routes, charity weeks, and the grand-final broadcast.
