# Coverage contract

Decision 68 (2026-10-18). This is the bar for "tested." A line-coverage percentage is not the bar. [`docs/spec/e2e.md`](../spec/e2e.md) E2E-M-01 (no browser) and E2E-M-06 (delete the live-watch Chrome scripts) do not apply. The phased work is [`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md).

The audit behind the gap list is the 2026-10-18 page [`docs/testing/test-coverage/index.html`](./test-coverage/index.html) (and `test-coverage.css`) in the main checkout. That page is a snapshot. This file is the rule. Numbers below are from that snapshot plus the suites the repo already runs.

## What 100% means

A product surface in [`docs/spec/PRODUCT.md`](../spec/PRODUCT.md) is covered only when every row below that applies to it is green. Missing a row is a gap, including when a unit test exists.

| Layer | Applies to | Pass condition |
|---|---|---|
| Unit | A domain rule, a handler, a guard, a pure client module | Both outcomes of a branch that changes what the user or the chain sees. A mock that only asserts a call does not count. |
| PostgreSQL | Any write, lock, or unique key | The real repository, on `freightchain_test` or a branch database. A new critical section has a concurrency test. Lock order stays player → pool → tickets / pledges. |
| HTTP scenario | Every controller route | One positive response, and the negatives that apply: no session, wrong role, invalid body, someone else's id (404, not 403), and the business conflict (the `409` code). The same scenarios run in memory and on PostgreSQL. |
| Headless Chrome | Every control a person uses | Real Chrome, real server, the click or the key. One positive. One negative the screen must show (disabled control, error sentence, or the `409`). happy-dom does not fill this cell. Driving stays desktop. Spectating is also checked at a phone width. |
| Program | Every instruction that moves SOL or TEN4, and every account check | LiteSVM on the built `.so`. A second run on `solana-test-validator` with the server in program mode and a wallet that signs, for buy, refund, settle, payout, pledge, and TEN4 mint / burn. No devnet. No mainnet. |

happy-dom (`e2e/`, `npm run test:e2e:pages`) may stay as a fast import check. A green happy-dom run does not mark the Chrome cell.

Planned ids in the Russian spec (`RID-T-*` and the rest) do not mark any cell. A cell is marked only by a command that fails when the behavior changes.

## Suites that already count

These are real Chrome or a real validator. Keep them. Do not replace them with the happy-dom catalog.

| Surface | Command |
|---|---|
| Game boot and drive | `node client/tools/e2e-chrome.mjs` |
| Model viewer | `npm --prefix client run test:viewer` |
| Lobby, garage, promo, tickets | `bash .claude/skills/run-tests/e2e.sh lobby` and the `promo` / `wallet` suites |
| Live board, close, watch, replay, flags | `e2e.sh board`, `close`, `watch` / `replay-test`, `flags` |
| Admin | `e2e.sh admin` |
| Verified play, traffic proof | `verified-play-test`, `e2e.sh traffic` |
| Stats | `e2e.sh stats` |
| Blinks | `e2e.sh blinks` |
| Editor and worker | `e2e.sh editor` |
| Pools on a local validator | `npm run test:localnet` |
| TEN4 on a local validator | `bash .claude/skills/honk-suite/run.sh` |
| Server pyramid | `npm run check` and `npm run server:integration` |
| Pools and TEN4 programs | `npm run program:test` |

`npm run test:e2e:block1` and `test:e2e:block2` are the extra happy-dom layer. Block 2's pending buy / settle / Merkle rows are already owned by `test:localnet`, not by a future happy-dom test.

## Gaps that keep the bar red

From the 2026-10-18 audit, except the three commands below. Those three were green in the 2026-10-23 local `npm run test:ci:full` log. Close the holes that remain before calling the app covered. The order is [`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md).

**Gates green on 2026-10-23**

- `npm --prefix frontend/client run test:parity` — 11668 objects compared against golden.txt: identical.
- `npm --prefix frontend/client run test:tickets-stub` — 20/20.
- `node .claude/skills/test-census/census.mjs --self-test` — zero-scenario routes: 0, single-scenario routes: 0, http routes on both flow runners: 178/178, then self-test ok.

The 2026-10-23 census self-test reported 0 zero-scenario routes and 0 single-scenario routes. The routes that the 2026-10-18 audit listed as uncovered now have an HTTP scenario in `backend/server/test/scenarios/http-gaps-public.scenarios.ts`, `http-gaps-live.scenarios.ts`, `http-gaps-economy.scenarios.ts`, or `http-gaps-editor.scenarios.ts`. Do not list them as a zero-scenario gap. A Chrome run is still a separate cell where the holes below say so.

`GET` and `POST /api/solana-pay/rides/:id` already have a scenario in `server/test/scenarios/payments.scenarios.ts`, including the wrong-account 404. They still have no Chrome run.

Phone pairing (`POST /api/auth/pair`, `GET /api/auth/pair/:id`, `POST /api/auth/pair/:id/claim`) already has an HTTP scenario in `server/test/scenarios/flow.scenarios.ts`, including a poll without the secret cookie → 404. The extension popup and the phone QR stay manual. They are not an HTTP gap.

**Chrome and chain holes on shipped behavior**

- Whitepaper has no Chrome harness.
- Guest EASY, the weekly 1h grant, and "training does not spend `freeRides`" are source or happy-dom checks, not a Chrome session against the server.
- Referral qualify (a verified MEDIUM finish grants the referrer's free rides) is pending even in the happy-dom catalog.
- Solana Pay GET/POST and SNS resolve/reverse have an HTTP scenario and no Chrome run. The phone QR and the extension popup stay manual until a harness signs.
- `program-check` pins IDL and the verifiable hash for `freightchain_pools` only. `freightchain_honk` has LiteSVM tests and no IDL drift pin.
- `editor-worker.ts` has no unit test. The Chrome editor suite drives the queue over HTTP. It does not cover that entrypoint. The entrypoint still needs a unit test that the process refuses to boot without `JWT_SECRET` and `EDITOR_MCP_TOKEN`.
- `nft-metadata-uris.ts` has no test that every achievement id has a URI.
- No GitHub Actions workflow. Local commands remain the gate until phase 6 of the plan.

**Do not treat as coverage**

- A `MUST` with a planned id and no file.
- A page test that only checks a CSS class or an `href`.
- `MemoryTransaction` as proof of a rollback or a row lock. PostgreSQL is the proof.
- A production or devnet request. Coverage runs on localhost and a local validator.

## Positive and negative, per surface

The negatives are the ones a person can hit, not a fuzz list. Add a row when a new error code ships.

| Surface | Positive | Negative |
|---|---|---|
| Guest and free levels | Bare `play.html` starts EASY `free-1c`. MEDIUM `free-2c`. HARD `free-3c`. | Guest on MEDIUM, HARD, a promo, or a paid tier → `409 guest_easy_only`. HARD with assist or tutorial → `409`. `free-g` is never stamped. `?sim=1` stays the tool sim. |
| Weekly ticket | Inside the ranked week, with no 1h promo, the first 1h POST spends the grant and creates an unranked ride. A second POST while it is `created` returns that ride. | An unspent 1h promo is claimed instead, and the grant stays unspent. 4h and 8h grants stay off. After the ride ends, another 1h with no pool and no promo is `409 tier_not_on_sale`. `409 weekly_ticket_spent` is the lost-claim race. The grant does not mint TEN4. Ranked is opt-in at start. |
| Ride life | Order, start, heartbeat, batches, end at the line. A closed tab ends the ride. A silent ride is swept. | Late start after the pool window → `409 rides_closed`. A re-chosen free ride → `409 ride_rechosen`. |
| Tickets and Solana Pay | Buy, confirm, reconcile, refund when the pool fails, payout after review. Ride, order, and donation Solana Pay GET/POST have an HTTP scenario. | Wrong wallet → 404. Reconcile of an unpaid order does not credit a ticket. |
| Pools program | The localnet day: open, buy, seal, ride, commit, pay, close. | `PaidTicketsDisabled`. Buy after `prep_deadline`. Veto of the winners root. |
| TEN4 | Verified paid ride reserves the ledger amount. Local mint, swap, burn, frozen part. | Training, guest, and the weekly grant do not mint. A rejected rejudge before release deletes the row. |
| Referrals | Bind, gift. The first verified finish qualifies and unlocks the paint. That finish grants the 2 and 3 free rides only when it is MEDIUM, inside 7 days, under the weekly cap. | Own code, second referrer, unknown code, no slots, bind after a started ride. A later MEDIUM does not grant the free rides. |
| Live and replay | Replay a finished 1h ride. Chat, mute, paid tip. | A running ride, and a finished free ride, are `404 replay_not_available` on watch and `/road`. A donation whose effect is not `tip` is `400 donation_effect` before any road change. A post on a free ride is `403 free_ride_no_stream`. A mute cannot post. |
| Promo | Admin signs a ride code. The player redeems one shift. | Unknown code. Second redeem. `kind: cosmetic` → `409 visuals_are_honk`. Retired `free_rides`. |
| Garage | Apply a loadout. The cab draws it. | A partial loadout does not equip. A TEN4 part the wallet has not burned does not equip. |
| Achievements | A finished ride unlocks the badge the facts earned. The lobby card shows progress. | A rejected ride does not mint. A guest wallet is skipped. An id is never retuned. |
| Prize board | `GET /api/prize/board` ranks ended ranked rides. | A ride that did not start ranked is absent. No USDC is sent. |
| Verified play | An honest Chrome ride can verify. Traffic proof matches the shared kernel. | Missing proof, ignored collision, ignored damage, a broken hash, a teleport, no inputs. |
| Admin | Sign in on `admin.<domain>`, open every tab, sign a change. | A normal session gets 404. A change without the wallet signature is refused. The host is checked. |
| Editor | Sign in, edit, the worker runs the job, publish is signed. | Logout revokes the session. MCP is refused off the internal network. Redis down fails closed on protected routes. |
| Landing, pitch, whitepaper | Real Chrome loads each page, the play control opens bare `play.html`, the deck advances. | The play control is not `?offline=1`. A missing pool does not throw `paintHero`. |
| SNS | Resolve and reverse return the linked name or wallet. | An unknown name is a clean empty result, not a 500. |
| Blinks | `e2e.sh blinks` posts every button. | CORS stays `*` only on those paths. A second program-mode ticket is refused. |
| Stats | An ended ride and a donation move the public totals. | A path that ends a ride and skips `StatsService` fails the architecture spec. |
| Analytics | The relay accepts an allowlisted batch and drops a server event name. | `POSTHOG_ENABLED` unset sends nothing. The client cannot mint `ride_completed`. |

## Current score, so the bar is not claimed early

The 2026-10-18 audit ran the pyramid and recorded about 82.5% lines and 83.1% branches across 940 JS/TS files, 197 Rust tests, and a large Chrome harness. That is not this contract.

A route is open until memory and PostgreSQL both assert the positive and each applicable negative. The 2026-10-23 census self-test reported 0 zero-scenario routes and 0 single-scenario routes. That does not fill the Chrome cell.

Three calls exist and do not fill the Chrome cell:

- `e2e-blinks.mjs` GETs `/api/actions/shift/2h` and expects 400. `GET /api/actions/shift/1h` has an HTTP scenario that expects the card. That run is not Chrome.
- The happy-dom block-1 file, when `E2E_BASE` is set, POSTs `/api/auth/guest` and GETs `/api/prize/board`. That run is not Chrome and it skips without `E2E_BASE`.
- `POST /api/editor/auth/logout` has a same-origin `200` in `http-gaps-editor.scenarios.ts`. The happy-dom block-1 file still only shows a cross-origin 403, and that run is not Chrome.

The Chrome cell is empty for the rows in "Chrome and chain holes." The app is not fully covered.
