# Weekly prize contest — spec

**Draft. Needs legal review.** Not legal advice. The owner chose variant B of the 2026-10-16 prize-pool research. Variant B is a skill contest. It is not an equal-chance free method of entry, and copy must not call the free rides one.

This contest is not the on-chain ticket vault (`programs/freightchain-pools`). That program still sells tickets and pays its own winners root. This contest is funded by the operator: a published base plus a capped share of the previous week's ticket revenue, paid in USDC after KYC. The program was not changed. TEN4 is never a prize, an entry, or a score boost.

The rules live in `server/src/domain/prize/`. Pool maths and eligibility are pure functions. A ranked start is now stored on the ride. USDC is still not sent.

## Week

Monday 19:00 UTC through the next Monday 19:00 UTC (`prizeWeek`). The legacy pay-per-ride round stays Monday 00:00 UTC and is a different ledger.

Three boards, one shared weekly route (the same seed for every ranked start of that tier). Shares of the week's distributable cents:

| Board | Tier | Share |
|---|---|---:|
| Sprint | 1h | 25% |
| Haul | 4h | 30% |
| Long Haul | 8h | 45% |

A leftover cent from the floor goes to the 8h board.

## Ranked starts

A wallet may buy as many tickets as it wants. A start counts only when it is declared ranked before it starts. Per wallet per week the counted starts are the first 2 free declarations and the first 5 paid declarations, in start order. A missing or late declaration does not use a slot. Anything past those caps is unranked. An unranked paid ride still earns TEN4, donations, and cosmetics. The board uses the best single counted attempt on that tier, not the best ride the wallet bought.

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

The country is read at ranked start from edge headers: `CF-IPCountry` and `CF-Region-Code`, then `X-FC-Country` and `X-FC-Region` (`HeaderGeoAdapter`). No paid geo API. `XX` and anything that is not two letters is unknown and fails closed. The edge must set these headers and strip a client-supplied copy, or a caller can invent `X-FC-Country`. The 18+ attestation is the wallet's existing `age18At`. A free ranked start does not also require the loss stamp. Paid rides still do, because every paid start does. The country and region are stored on the ride. KYC is not stored, so a board row's `payout` is false and a settlement would roll those cents.

- 18+ attestation (`age18`). Unknown age fails closed.
- Sanctioned-country draft: CU, IR, KP, SY. This is not an OFAC determination. Regions that are not a country code are not listed.
- UK (`GB`) and the 27 EU members are blocked from prize eligibility by default.
- US states SC, AZ, LA, AR, DE (Delaware), MT, TN. Germany is the country `DE`, and is blocked as EU. A US state is read only when the country is US.
- Unknown country fails closed.
- Ranked entry does not require KYC. A payout does. A ranked winner without KYC stays on the board and the cents roll.

## Season

Eight weeks. The final field on each board is the top 8 by the sum of weekly places (`seasonQualifiers`). A missed week scores 1000, which is worse than any real place, so skipping a week cannot help. The final itself (one seed, no spectator road effects) is not built.

## Wired

- `POST /api/rides/:id/start` body `{ ranked?: boolean }`. The game's start screen has a RANKED checkbox. A refusal is `409` (`ranked_ineligible`, `ranked_free_cap`, `ranked_paid_cap`) and the ride stays ready, so the driver can start it unranked.
- Caps run inside the player-row lock: ranked starts whose `startedAt` is in the current prize week, 2 free and 5 paid.
- `GET /api/prize/board?tier=1h|4h|8h&at=` returns `bestByWallet` of ended ranked rides of that tier. Free ranked starts count against the cap and are not on these three boards.
- Spectator road effects on a ranked ride are refused, as above.

## Not built

- One weekly seed per tier. Ranked rides still use the ride's own seed.
- A sanctions vendor, a KYC vendor, and the USDC send. Payout on the board stays false until KYC exists.
- An admin editor for the geo lists and the base step. The lists are env overrides.
- Corrections as a tie-break. The column is not measured.
- Sponsored routes, charity weeks, and the grand-final broadcast.
