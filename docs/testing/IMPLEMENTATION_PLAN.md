# Implementation plan

How to get from today's suite to the bar in [`COVERAGE_CONTRACT.md`](COVERAGE_CONTRACT.md). One phase is one PR. Do not start the next phase on a red exit check. Do not deploy. Do not implement a row from [`../spec/PRODUCT.md`](../spec/PRODUCT.md) Conflicts inside these PRs.

The happy-dom suite stays. It is not extended to pretend it is Chrome.

## Phase 0 — Specs (this change)

Land [`../spec/PROCESS.md`](../spec/PROCESS.md), [`../spec/PRODUCT.md`](../spec/PRODUCT.md), the coverage contract, and this plan. Point `AGENTS.md` and `docs/agents/verifying.md` at them.

Exit: a reader can tell shipped from target without opening the Russian manifesto. No product code.

## Phase 1 — Make the scoreboard honest

The census and two red gates hide the real gaps.

1. `census.mjs` self-test: expect the current headless `check()` count (87 static). Map the ten areas it skips (editor, entities, MCP, TEN4, pledges, blinks, referrals, Solana Pay, SNS, and the audit harness) and these six routes that stay unmapped until named: `GET /api/auth/pair/:id`, `GET /api/pools/:id/standings`, `PUT /api/profile/agreements`, `GET /api/prize/board`, `GET /api/rides/:id/public`, `POST /api/client-error`. `lineCoverage()` writes under `os.tmpdir()`, not `client/`, and the file count includes `mcp/test` and `audit/scripts`.
2. `coverage.mjs`: attribute `GET /actions.json`, dynamic `open.href` posts, and MCP calls that do not contain the literal `/api/` in the test file.
3. `server/scripts/stub-api.mjs`: implement `GET /api/referrals` (empty view) and `POST /api/tickets/orders/:id/reconcile` so that no reference signature returns `not_found` or `pending`, not a credited ticket. Then `npm --prefix server run test:tickets-stub` is 20/20.
4. Parity: if the ambulance mesh move was intentional, advance `client/tools/parity/BASE` and say so in the PR. If it was not, restore `client/shared/entity/seed/vehicle/medic.js`. Do not weaken the comparison. Add `test:parity` to the client `check` script, and add `census.mjs self-test` to the root check, so a later drift fails `npm run check`.

Exit: `node .claude/skills/test-census/census.mjs self-test`, `test:tickets-stub`, `test:parity`, and `npm run check` pass. The self-test's unmapped-route count is 0.

## Phase 2 — The 17 routes, positive and negative

For each route in the contract's list, add a scenario that runs twice (memory and PostgreSQL):

- the success response
- no session, where the route is not public
- invalid body or query
- someone else's id, when the route has an id → 404
- the business conflict, when one exists (guest on a paid tier, 1h after the grant ride has ended with no pool, cosmetic promo, unpaid reconcile, honk when the flag is off)

Routes: `GET /api/actions/shift/:tier`, `POST /api/auth/guest`, `POST /api/tickets/orders/:id/reconcile`, `POST /api/editor/auth/logout` (a real 200, not only the cross-origin 403), `GET /api/honk/catalog`, `POST /api/watch/:id/honk`, `POST /api/watch/:id/honk/time`, `POST /api/watch/:id/honk/weather`, `POST /api/watch/:id/donation-orders/:orderId/reconcile`, `GET /api/prize/board`, `GET /api/rides/:id/public`, `GET /api/sns/reverse`, `GET /api/sns/resolve`, and the four `/api/solana-pay/...` methods.

Also give `nft-metadata-uris.ts` a unit test: every id in `ACHIEVEMENTS` is either in the map or explicitly not mintable yet.

Match method and path. An existing `POST /api/actions/shift/1h` does not satisfy `GET /api/actions/shift/:tier`. The new cases must be on both flow lists (`server/test/http/flows.spec.ts` and `server/test/integration/flows.integration.spec.ts`). A file that is not imported does not count.

Exit: `npm run server:integration` green, and both flow files request each of the 17 with the positive and the applicable negatives.

### Phase 2b — Routes with a single scenario

About 47 routes have exactly one scenario case. One case is not a positive plus the negatives. After phase 2, walk that list from the census and add the missing negative (no session, invalid body, foreign id → 404, or the business 409) on both flow runners. Ticket-order reconcile and donation-order reconcile get a concurrency case if they credit or claim money. The ride-reconcile race does not stand in for them.

Exit: no controller route is left with only one scenario case, unless the contract names it as public and side-effect free and the one case is the positive. `npm run server:integration` stays green.

## Phase 3 — Headless Chrome against the shipped game

Run suites one Chrome at a time. The audit's last full run lost checks when three or four SwiftShader Chromes shared the machine against 8–35 s pool windows. Keep the short deadline. Do not lengthen it to hide a miss, and do not retry a driving or verdict assertion. `e2e-lobby.mjs` already starts a signed-in HARD `free-3c`. Do not re-list that as missing. `e2e-watch.mjs` already uses a phone-width viewport.

Add or extend scripts. Reuse `server/scripts/e2e-*.mjs` and `client/tools/e2e-chrome.mjs`. Do not put these in `e2e/` happy-dom.

1. **Guest and training.** Unsigned `play.html` becomes a guest EASY ride. MEDIUM, HARD, promo, and 1h from that session show the `409`. HARD with assist shows `409`. A training ride leaves `freeRides` unchanged. `free-g` does not appear on the ride.
2. **Weekly ticket.** Set the clock inside the ranked week so the test cannot return early. With no 1h promo, the first 1h POST spends the grant. An unspent 1h promo is claimed instead and the grant stays unspent. A second POST while that ride is `created` returns the same ride. After it ends, another 1h with no pool and no promo is `tier_not_on_sale`. 4h and 8h are absent from `weeklyTickets`. The ledger does not gain TEN4. Start with `ranked: true` is what consumes a ranked slot.
3. **Tickets.** After phase 1, the stub suite is green. Then one local-validator buy in the existing localnet Chrome flow, including reconcile of a paid order and a reconcile of an unpaid order that must not credit a ticket.
4. **Solana Pay.** Ride `GET`/`POST /api/solana-pay/rides/:id` already has an HTTP scenario. Add the same positive and wrong-account 404 for `orders` and `donations` in phase 2, then one Chrome harness that signs a ride or order transaction. Extension popups stay in `docs/testing/MANUAL_TESTS.md`.
5. **Live, negative.** Keep `e2e-watch.mjs` and `e2e-replay.mjs`. Add: a running free ride returns `403` and is absent from `/api/live` rides; with effects off, a paid tip does not move the road; a muted wallet cannot post.
6. **Referral qualify.** Two wallets. Bind. The first verified finish unlocks the paint. That finish grants the 2 and 3 free rides only when it is MEDIUM, inside 7 days, under the cap. A later MEDIUM does not. Negatives: own code, bind after `startedAt`, unknown code.
7. **Prize board and TEN4 catalog.** The lobby screen shows the board and the catalog. An unranked ride is absent on that screen. A GET of the JSON alone does not pass.
8. **Whitepaper.** A Chrome load of `whitepaper.html`: play control is bare `play.html`, contents anchors resolve, the page does not throw.
9. **Landing empty pool.** `paintHero` renders the empty state when `split` or `totals` is missing. That is a product fix plus a Chrome check, because the audit and the e2e notes already call it a bug.
10. **Editor logout.** The editor Chrome signs out and the next privileged call is refused.
11. **Achievements.** A completed free ride shows the new progress on the lobby card. A rejected paid ride does not gain a mint row.
12. **Admin negative.** A player session on the public host gets 404 for `/api/admin`. An unsigned admin write is refused.

Exit: each new script exits 0 on its own. Then `bash .claude/skills/run-tests/e2e.sh` once, serial, and the report lists any leftover red check with the script name. Do not mark the phase done on a partial run.

## Phase 4 — Chain, still local

1. IDL drift check for `programs/freightchain_honk`, the same shape as pools. A verifiable-build pin waits until someone asks to verify that program. Do not invent a hash.
2. `npm run program:test` stays the instruction bar (LiteSVM on the built `.so`).
3. `npm run test:localnet` stays the SOL bar: buy, fail-and-refund, commit, veto, pay, close, seal. Name `e2e-localnet-payout.mjs` for the Merkle pay and `localnet-legacy-pledges.mjs` for historical pledge settle and refund (`e2e-localnet-day.mjs` refuses new pledges). Leave `B2-ADMIN-04` (`set_pool_rules`) pending until a validator transaction exists. Do not mark a happy-dom row covered by editing `E2E_PLAN.md` alone.
4. `bash .claude/skills/honk-suite/run.sh` stays the TEN4 bar, including one verified ride whose chain mint matches the ledger. Add the negative the suite does not already have: a training finish and a weekly-grant finish mint nothing.
5. Pledge settle and refund run inside `test:localnet` if that script does not already drive them. If it does, cite the check in the contract instead of adding a second one.

Exit: those three commands pass. No `--url devnet`. No program deploy.

## Phase 5 — Target decisions, only when asked

Each row is its own spec-first PR. Update the decision if the owner changes it, then `PRODUCT.md`, then the code, then the tests. Do not batch them.

1. Live watch stays or goes (decisions 18, 46, 55, 56).
2. Road effects stay or go (33, 45, 49), including the honk time and weather routes.
3. Donation share stays at 1000 bps or becomes 0 (50).
4. 4h and 8h stay or leave (17).
5. Finish formula and a 30 Hz re-sim (12, 38–44), only if the owner asks. Do not edit `1h` or `free-3c` in place. A retune is a new trip id. A rules change leaves stored rides on their version, lands `road-drift.spec.ts`, `traffic-sim.spec.ts`, and `replay-engine.spec.ts` in the same commit, and does not bump `SUMMARY_VERSION` or `WORLD_FACTS_VERSION`. Sample columns stay append-only.
6. `set_pool_rules`: Squads only (60) or an admin HTTP route (backend decision 8). Do not delete either `MUST` until the owner picks. `POOL-M-12` stays a planned id. LiteSVM already calls the instruction. The live check stays pending.
7. Weekly Tuesday pool clock, if it replaces the per-tier windows.
8. Minigames. The game to port is `phone-sms` on branch `phone-minigames`. `docs/spec/minigames.md` Part 1 is that build. Appendix A is retired.
9. `stats.RideResult` and the published score formula.
10. English and Russian lobby copy (58).
11. Admin roles, session revoke, Telegram, IP allowlist (59–66).
12. Pledges disabled for the devnet launch (51), as a flag, not a deleted module.

Exit for each: `PRODUCT.md` matches the code, and the old behavior's test is updated in that PR rather than deleted in an earlier phase.

## Phase 6 — CI, after 1–4 are green locally

There is no `.github/workflows/` today. Add one workflow:

- `npm run check`
- `npm run server:integration`

Chrome, the validator, and `program:test` stay as local commands until they are stable enough for a nightly job. Do not make a pull request required-green on SwiftShader. Document the nightly command in `docs/agents/verifying.md` when it exists.

## What this plan will not do

- It will not call the app 100% covered while a contract row is open.
- It will not move money on devnet or mainnet.
- It will not treat the 2026-10-18 line-coverage figure (about 82%) as the goal.
- It will not rewrite the Russian decision text. Conflicts stay visible in `PRODUCT.md`.
