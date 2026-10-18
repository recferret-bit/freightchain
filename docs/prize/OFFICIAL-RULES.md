# Freight Chain weekly prize contest — official rules

**DRAFT. Needs legal review.** This is not legal advice, not an offer, and not a final set of rules. Do not publish it as the rules of a live contest. The operator has not opened this contest. No prize shown here is currently being paid. See [`docs/legal/OFFICIAL_RULES.md`](../legal/OFFICIAL_RULES.md) for the full Season 1 legal template.

## 1. What the contest is

The contest is a skill contest. The score is how far a driver gets along a fixed weekly route before the first mistake. It is not a raffle and not a sweepstakes.

Training rides are not entries. A wallet that is 18 or older and in an eligible place receives a granted paid ticket on each tier the operator has switched on. The default is one 1 hour ticket every 7 days. The 4 hour and 8 hour grants are off, and each has its own interval (default 7 days) for when it is switched on. A grant is not sold. Declaring one ranked uses one of the five paid ranked starts. A separate promo code can add one more ranked start. An unused grant expires when the next one of that tier is due, or at Sunday 12:00 UTC, whichever is earlier. It does not carry forward and a second unused grant of the same tier is not issued. Ranked starts still have to finish by Sunday 12:00 UTC. Counsel must review this free path. Age is a checkbox. Country is read from the network edge. A person can open more than one wallet. Do not describe training rides as a way to win.

The prize is USDC. The TEN4 token is not a prize, not an entry fee, and not a way to raise a score.

The on-chain ticket pool is a separate product. Buying a ticket does not buy a share of this contest's prize.

## 2. Who may enter

A driver must be 18 or older and must say so before a ranked start, and before the weekly ticket is granted.

The following may not enter a ranked start and may not receive a prize. The lists are a server setting. The draft defaults are:

- Sanctioned countries, draft: Cuba, Iran, North Korea, Syria. A lawyer has to replace this list. It is not an OFAC opinion.
- The United Kingdom and the European Union, by default.
- These US states, by default: South Carolina, Arizona, Louisiana, Arkansas, Delaware, Montana, Tennessee.

A driver whose country is unknown is refused. Ranked entry does not wait for identity checks. A prize is not sent until the winner has passed the operator's identity check and a sanctions check. Those checks are not built.

## 3. The week and the boards

Ranked driving runs from Monday 00:00 UTC to Sunday 12:00 UTC. A ranked start has to be able to finish by Sunday 12:00 UTC. An 8 hour ranked start has to begin by 04:00 UTC that Sunday. Verification runs from Sunday 12:00 UTC to Monday 12:00 UTC. Appeals are open until Tuesday 12:00 UTC. Payouts are sent on Tuesday, after appeals close. The next week of ranked driving opens on Monday at 00:00 UTC while the previous week is still being checked.

There are three boards. Sprint is the 1 hour route and receives 25% of that week's contest pool. Haul is the 4 hour route and receives 30%. Long Haul is the 8 hour route and receives 45%.

Every ranked start on a board in a week is meant to use that week's route. That shared route is not built yet. Spectator weather, day and night changes, and donated obstacles are refused on a ranked run, so they do not change it. A chat honk can still be posted. They may still appear on a run that was not ranked.

## 4. How a start counts

Before the truck moves, the driver chooses ranked or unranked.

Each week, the first five paid starts that were declared ranked, and the first promo start that was declared ranked, are the ones that can score. Each granted ticket is one of those five paid starts when it is declared ranked. The board keeps the best one of those. Later starts, and any start that was not declared in time, do not score. A training ride cannot be declared ranked. A purchased start that does not score can still earn TEN4, take donations, and unlock cosmetics. A promo ride does not earn TEN4. The granted ticket does not earn TEN4: a free wallet must not print the token. Tickets are not limited to five. A promo code is once per wallet and adds at most one ranked start that week, on top of the five paid.

Declaring a start ranked after it has already started does not count and does not use a slot.

## 5. The prize pool

The pool is an operator and sponsor skill-contest prize (`F = B + S`, where `B` is the operator base and `S` is verified sponsor funding).

The base `B` starts at 300 USDC a week. It can step to 750, then 1,500, then 3,000, and only after four weeks in a row in which ticket revenue was more than four times the base then in force. It steps one level at a time and does not reset between seasons.

The performance bonus `P` is 40% of the previous week's ticket revenue `R`, capped at 2,500 USDC and at 90% of `F` (`P = min(0.40 * R, $2,500, 0.90 * F)`). The amount is fixed before the week starts. It does not grow with tickets sold during the week. Incoming rollover `C` from the prior week is capped at 25% of `F` (any excess goes to the season final). Total weekly pool `T = F + P + C` is split 85% across the three weekly boards, 5% to next-week rollover, and 10% to the season final.

TEN4 is not added to the pool.

## 6. How a board is paid

If a board has at least ten drivers, it pays its full board share.

Eighty percent of a board is paid to places. On a board of 100 drivers or fewer the shares are:

| Place | Share of the board |
|---:|---:|
| 1 | 25% |
| 2 | 15% |
| 3 | 10% |
| 4 | 7.5% |
| 5 | 7.5% |
| 6 through 10 | 3% each |

Tied drivers share the same place and split the combined prize of the places they occupy equally (neither submission time nor wallet address breaks a tie across drivers).

Twenty percent is split equally among drivers who finish the route with no mistake. A driver in the top 10 can also take a finisher share. No finisher share is larger than the 10th-place prize. The rest of that 20% is not paid that week.

Prizes won on free tickets (weekly granted tickets or promo rides) are capped at 30% of the board's pool (`free_prize_board_cap_bps = 3000`). Free-ticket winners are funded in rank order (1st place downward; tied free-ticket winners at the cap boundary split the remaining free cap equally) until the 30% cap is reached, and any excess above 30% passes down to the next highest-ranked eligible purchased-ticket finisher(s) outside the paid places (or rolls over if none exist).

If more than 100 drivers score, the places extend to the top 10% of the field. The 80% is then split on a straight declining slope. That slope is a draft. A lawyer and the owner can replace it before the contest opens.

A prize under 5 USDC is not sent.

A board with fewer than ten drivers pays from its base only, and only to the places that exist. Its bonus is held for one week. Money that was already held from the week before goes to the season final instead of being held again. There is no growing jackpot.

## 7. Season

A season is seven weeks (`SEASON_WEEKS = 7`). Week 7 is the live final (`LIVE_FINAL_WEEK = 7`). On each board, the eight drivers with the best record of weekly places from the season go to that final, and all drivers tied at the 8th-place cutoff advance (`N >= 8`). Missing a week counts against that record. Finalists split that tier's Season Final pool by relative weights `30, 20, 14, 10, 8, 7, 6, 5` for places 1–8 and weight `5` for each additional finalist `9..N`, with tied finalists splitting their occupied weights equally. The final is one route, people can watch it, and spectator road effects stay off. The final ride is not built. Ten percent of each week's pool (plus the $1,000 operator final base in Season 1) is what funds it.

## 8. What is not live

No week is open as a paid contest. No USDC prize is being paid. The ranked checkbox, the weekly caps, the header country check, and the refusal of spectator road effects are enforced. Identity checks, a sanctions vendor, the shared weekly route, and the bank transfer are not connected. Until a lawyer signs these rules, this document is a draft for review, not the rules of a contest a driver can enter.
