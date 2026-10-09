# Test coverage by feature

Generated 2026-10-09 12:57 UTC by `npm run test:census -- features --write` (skill `test-census`). Do not edit by hand: the map is `.claude/skills/test-census/features.mjs`.

Static: imports, requested routes, `check()` messages · browser runs: `admin` 2026-10-09, `board` 2026-10-09, `browser` 2026-10-09, `close-split` 2026-10-09, `close` 2026-10-09, `flags` 2026-10-09, `lobby` 2026-10-09, `promo` 2026-10-09, `replay` 2026-10-09, `verified` 2026-10-09, `wallet-split` 2026-10-09, `wallet` 2026-10-09, `watch` 2026-10-09 · lines: server unit + HTTP + PostgreSQL, the headless playthrough, client / landing / media node:test at 2026-10-09 12:57 UTC.

## Features

`strong` = nothing below is missing. `fair` = one thing is. `thin` = two or more, or fewer than a quarter of its files have a test of their own and no headless check stands in. `untested` = no test reaches it.
Checked: half or more of its source files are the subject of a test of their own (waived when the headless playthrough has 5+ checks for it, or for the Rust program, whose tests are black-box);
every API route it owns is requested by at least one HTTP scenario; a browser / API harness or a test skill drives it end to end;
when browser runs are recorded and one of its harnesses is an `e2e.sh` suite, every route it owns was hit by one (localnet and the tickets stub are not recorded); when line coverage is recorded, at least 70 % of its lines and 60 % of its branches ran (over the files a test loaded).

| Feature | Grade | Files with own test | Unit cases | Routes in scenarios | Scenario cases | Race tests | Sim checks | Harnesses | Routes in recorded e2e.sh runs | Lines · branches | Missing |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: | ---: | --- |
| Sign-in + session | **fair** | 14/20 | 47 | 4/4 | 36 | 1 | — | e2e-wallet, e2e-browser, e2e-lobby, e2e-close | 3/4 | 78.8 % · 77 % (19/20 files loaded) | 1 of 4 routes never hit in a recorded browser run |
| Player account: free rides + daily refill | **strong** | 3/3 | 16 | — | — | 5 | — | e2e-lobby | — | 100 % · 83.3 % | — |
| Verified play (recording, verdict, prompts) | **strong** | 12/19 | 62 | 1/1 | 23 | 4 | 1 | e2e-verified-play, e2e-browser | 1/1 | 89.3 % · 87.6 % | — |
| Pay-per-ride (legacy weekly round) | **fair** | 14/18 | 70 | 4/4 | 35 | 5 | — | e2e-lobby | 1/4 | 98.7 % · 87.2 % | 3 of 4 routes never hit in a recorded browser run |
| Ride lifecycle (order, start, heartbeat, end, stale sweep) | **strong** | 14/19 | 99 | 6/6 | 58 | 4 | — | e2e-browser, e2e-close, e2e-lobby | 6/6 | 88.4 % · 87.9 % | — |
| Escrow: pools on sale + ticket purchase | **thin** | 28/33 | 163 | 7/8 | 8 | 4 | — | e2e-lobby, e2e-tickets-stub, e2e-localnet | 1/8 | 85.7 % · 89.5 % (32/33 files loaded) | 1 of 8 routes in no scenario; 7 of 8 routes never hit in a recorded browser run (e2e-tickets-stub, e2e-localnet not recorded) |
| Escrow: settlement (events, watcher, webhook) | **strong** | 10/13 | 46 | 2/2 | 6 | 2 | — | e2e-localnet | — | 98.6 % · 92.2 % | — |
| Escrow: refunds, payouts, crank | **strong** | 7/7 | 26 | 2/2 | 1 | — | — | e2e-localnet, e2e-tickets-stub | — | 99.4 % · 84.3 % | — |
| Escrow program (on-chain, Rust) | **strong** | 0/14 | 50 | — | — | — | — | e2e-localnet | — | — | — |
| Promo codes (admin creates, players redeem) | **strong** | 12/14 | 72 | 7/7 | 38 | 3 | — | e2e-promo, e2e-lobby, e2e-wallet | 7/7 | 74.1 % · 92.9 % | — |
| Garage + cosmetics | **fair** | 6/9 | 30 | 4/4 | 11 | — | 6 | e2e-lobby, e2e-promo, e2e-watch | 3/4 | 87.2 % · 91 % (8/9 files loaded) | 1 of 4 routes never hit in a recorded browser run |
| Live board (online, on the road, history) | **strong** | 3/5 | 10 | 2/2 | 9 | — | — | e2e-live-board, e2e-close | 2/2 | 71.6 % · 91.1 % (4/5 files loaded) | — |
| Live streams: watch + replay | **thin** | 2/5 | 14 | 1/1 | 13 | 1 | — | e2e-watch, e2e-replay | 1/1 | 17.1 % · 87.5 % | 3 of 5 files have no test of their own; 17.1 % of lines ran |
| Live streams: chat, mutes, donations, effects | **fair** | 13/16 | 37 | 7/7 | 7 | 3 | — | e2e-watch, e2e-live-flags, e2e-replay | 7/7 | 65.4 % · 91.1 % | 65.4 % of lines ran |
| Lobby: tiers, pool, leaderboard, profile | **strong** | 7/11 | 32 | 4/4 | 26 | — | — | e2e-lobby | 4/4 | 94.5 % · 91.4 % (10/11 files loaded) | — |
| Admin page (sign-in, review queue, audit) | **strong** | 18/20 | 49 | 12/12 | 13 | — | — | e2e-admin, e2e-promo, e2e-verified-play | 12/12 | 100 % · 85 % (19/20 files loaded) | — |
| Product analytics relay | **fair** | 5/9 | 23 | 1/1 | 5 | — | — | /posthog-test | — | 59 % · 91.6 % | 59 % of lines ran |
| Platform: HTTP contract, health, rate limits, config, logs, CLI | **strong** | 28/56 | 106 | 2/2 | 7 | — | — | e2e-browser | — | 85.7 % · 79.3 % | — |
| Game: driving sim (drivetrain, brakes, battery, climate) | **fair** | 2/10 | 5 | — | — | — | 20 | e2e-chrome, e2e-browser | — | 69.2 % · 77.6 % | 69.2 % of lines ran |
| Game: endless road, junctions, traffic | **strong** | 1/12 | 7 | — | — | — | 9 | e2e-chrome | — | 72.3 % · 93.6 % (11/12 files loaded) | — |
| Game: cockpit, scenery, routes, 3D models | **thin** | 0/71 | 0 | — | — | — | — | e2e-chrome, e2e-viewer | — | 62.5 % · 90.2 % (64/71 files loaded) | 71 of 71 files have no test of their own; 62.5 % of lines ran |
| Landing page | **strong** | 2/4 | 48 | — | — | — | — | e2e-wallet, e2e-replay, e2e-live-board | — | 100 % · 100 % (2/4 files loaded) | — |
| Whitepaper | **fair** | 2/2 | 20 | — | — | — | — | — | — | 100 % · 99 % (1/2 files loaded) | no end-to-end harness |
| Promo clips + sound | **thin** | 2/19 | 25 | — | — | — | — | /gameplay-video, /game-audio | — | 93.4 % · 90.8 % (15/19 files loaded) | 17 of 19 files have no test of their own |

Columns: *files with own test* = source files (logic only: no ports, DTOs, commands / queries, modules) that a test imports as its subject. *Scenario cases* = HTTP scenario / HTTP spec cases that request one of its routes, setup calls included, so sign-in and ride creation are reached by almost every case. *Race tests* = concurrency cases on PostgreSQL. *Sim checks* = headless playthrough `check()` calls. *Routes in recorded e2e.sh runs* = routes the server logged while the recorded `run-tests/e2e.sh` suites ran (— when no harness of the feature runs there; health probes are not logged, so they are left out).

## User flows

| Flow | Route steps | In scenarios | In browser runs | Reached by no test |
| --- | ---: | ---: | ---: | --- |
| First visit → sign in → lobby | 7 | 7/7 | 7/7 | — |
| Free ride, start to leaderboard | 7 | 7/7 | 7/7 | — |
| Closing the game / a page mid-ride | 2 | 2/2 | 2/2 | — |
| Buy tickets → ride a paid tier | 8 | 7/8 | 2/8 | `POST /api/tickets/orders/:id/submit` |
| A pool misses its goal → refund | 3 | 3/3 | 0/3 | — |
| A live pool pays its winners | 2 | 2/2 | 0/2 | — |
| Pay-per-ride (PAYMENT_MODE=transfer) | 6 | 6/6 | 3/6 | — |
| Watch a live ride, chat, donate | 9 | 9/9 | 9/9 | — |
| Replay a finished ride | 2 | 2/2 | 2/2 | — |
| Redeem a promo code → wear it | 6 | 6/6 | 5/6 | — |
| Admin reviews a flagged ride | 11 | 11/11 | 11/11 | — |
| Admin creates / disables a promo code | 5 | 5/5 | 5/5 | — |
| Analytics relay | 1 | 1/1 | 1/1 | — |

<details><summary>First visit → sign in → lobby</summary>

| Step | Scenario cases | Browser runs | Named by |
| --- | ---: | --- | --- |
| `GET /api/live` | 8 | board, close-split, close, lobby, promo, replay, wallet-split, wallet | — |
| `GET /api/pool` | 2 | board, close-split, close, lobby, promo, replay, wallet-split, wallet | e2e-lobby |
| `POST /api/auth/nonce` | 141 | admin, board, browser, close-split, close, flags, lobby, promo, replay, verified, wallet-split, wallet, watch | — |
| `POST /api/auth/verify` | 137 | admin, board, browser, close-split, close, flags, lobby, promo, replay, verified, wallet-split, wallet, watch | e2e-localnet, e2e-verified-play |
| `GET /api/me` | 29 | board, close-split, close, flags, lobby, promo, replay, wallet-split, wallet, watch | e2e-wallet |
| `GET /api/tiers` | 7 | board, close-split, close, lobby, promo, replay, wallet-split, wallet | — |
| `GET /api/profile` | 12 | lobby | — |

</details>

<details><summary>Free ride, start to leaderboard</summary>

| Step | Scenario cases | Browser runs | Named by |
| --- | ---: | --- | --- |
| `POST /api/rides` | 88 | admin, board, browser, close-split, close, flags, lobby, replay, verified, watch | e2e-localnet |
| `POST /api/rides/:id/start` | 67 | admin, board, browser, close-split, close, flags, lobby, replay, verified, watch | — |
| `POST /api/rides/:id/heartbeat` | 29 | board, browser, close-split, close, lobby, replay, verified, watch | — |
| `POST /api/rides/:id/batches` | 23 | admin, board, browser, close-split, close, lobby, replay, verified, watch | — |
| `POST /api/rides/:id/end` | 40 | admin, board, browser, close-split, close, lobby, replay, verified, watch | — |
| *verdict judged at /end* | | | |
| `GET /api/leaderboard` | 7 | board, close-split, close, lobby, promo, replay, wallet-split, wallet | — |
| `GET /api/profile` | 12 | lobby | — |

</details>

<details><summary>Closing the game / a page mid-ride</summary>

| Step | Scenario cases | Browser runs | Named by |
| --- | ---: | --- | --- |
| `POST /api/rides/:id/end` | 40 | admin, board, browser, close-split, close, lobby, replay, verified, watch | — |
| `GET /api/live` | 8 | board, close-split, close, lobby, promo, replay, wallet-split, wallet | — |
| *stale-ride sweeper ends a silent ride* | | | |

</details>

<details><summary>Buy tickets → ride a paid tier</summary>

| Step | Scenario cases | Browser runs | Named by |
| --- | ---: | --- | --- |
| `GET /api/pools` | 1 | lobby | e2e-lobby |
| `POST /api/tickets` | 5 | — | — |
| `GET /api/tickets/orders/:id/payment` | 1 | — | — |
| `POST /api/tickets/orders/:id/submit` | **0** | — | — |
| `POST /api/tickets/orders/:id/confirm` | 1 | — | — |
| `GET /api/tickets/orders/:id` | 5 | — | — |
| `GET /api/tickets/pending` | 1 | — | — |
| *program event credits the tickets* | | | |
| `POST /api/rides` | 88 | admin, board, browser, close-split, close, flags, lobby, replay, verified, watch | e2e-localnet |

</details>

<details><summary>A pool misses its goal → refund</summary>

| Step | Scenario cases | Browser runs | Named by |
| --- | ---: | --- | --- |
| *crank: fail_pool by the chain clock* | | | |
| `GET /api/pools/:id/refund` | 1 | — | — |
| `POST /api/chain/settle` | 1 | — | — |
| `POST /api/chain/webhook` | 5 | — | e2e-localnet |

</details>

<details><summary>A live pool pays its winners</summary>

| Step | Scenario cases | Browser runs | Named by |
| --- | ---: | --- | --- |
| `GET /api/pools/:id/payout` | 1 | — | — |
| `POST /api/chain/settle` | 1 | — | — |
| *close_pool splits the rest* | | | |

</details>

<details><summary>Pay-per-ride (PAYMENT_MODE=transfer)</summary>

| Step | Scenario cases | Browser runs | Named by |
| --- | ---: | --- | --- |
| `POST /api/rides` | 88 | admin, board, browser, close-split, close, flags, lobby, replay, verified, watch | e2e-localnet |
| `GET /api/rides/:id/payment` | 3 | — | — |
| `POST /api/rides/:id/confirm` | 28 | — | — |
| `POST /api/rides/:id/reconcile` | 3 | lobby | — |
| `GET /api/rides/pending` | 2 | board, close-split, close, lobby, promo, wallet-split, wallet | — |
| `GET /api/chain/fees` | 3 | — | — |

</details>

<details><summary>Watch a live ride, chat, donate</summary>

| Step | Scenario cases | Browser runs | Named by |
| --- | ---: | --- | --- |
| `GET /api/live` | 8 | board, close-split, close, lobby, promo, replay, wallet-split, wallet | — |
| `GET /api/watch/:id` | 13 | board, close-split, close, flags, lobby, replay, watch | e2e-watch |
| `POST /api/watch/:id/messages` | 5 | flags, replay, watch | — |
| `POST /api/watch/:id/donations` | 4 | flags, replay, watch | — |
| `POST /api/watch/:id/donation-orders` | 1 | flags | — |
| `POST /api/watch/:id/donation-orders/:orderId/confirm` | 1 | flags | — |
| `GET /api/rides/:id/inbox` | 5 | browser, close-split, close, lobby, replay, verified, watch | — |
| `POST /api/rides/:id/effects/:eventId/applied` | 2 | replay, watch | — |
| `POST /api/rides/:id/mutes` | 1 | watch | — |

</details>

<details><summary>Replay a finished ride</summary>

| Step | Scenario cases | Browser runs | Named by |
| --- | ---: | --- | --- |
| `GET /api/replays` | 1 | board, close-split, close, lobby, promo, replay, wallet-split, wallet | — |
| `GET /api/watch/:id` | 13 | board, close-split, close, flags, lobby, replay, watch | e2e-watch |

</details>

<details><summary>Redeem a promo code → wear it</summary>

| Step | Scenario cases | Browser runs | Named by |
| --- | ---: | --- | --- |
| `POST /api/promo/redeem` | 33 | admin, lobby, promo | — |
| `GET /api/promo/mine` | 6 | lobby, promo, wallet-split, wallet | e2e-wallet |
| `GET /api/wardrobe` | 5 | browser, close-split, close, lobby, promo, replay, verified, watch | e2e-lobby |
| `POST /api/wardrobe/equip` | 2 | — | — |
| `GET /api/garage` | 6 | lobby, promo | e2e-lobby |
| `POST /api/garage/loadout` | 4 | lobby | — |

</details>

<details><summary>Admin reviews a flagged ride</summary>

| Step | Scenario cases | Browser runs | Named by |
| --- | ---: | --- | --- |
| `POST /api/admin/auth/nonce` | 22 | admin, promo | e2e-admin |
| `POST /api/admin/auth/verify` | 22 | admin, promo | e2e-admin |
| `GET /api/admin/overview` | 4 | admin, promo | — |
| `GET /api/admin/rides` | 2 | admin, promo | — |
| `GET /api/admin/rides/:id` | 1 | admin | — |
| `POST /api/admin/rides/:id/challenge` | 3 | admin | — |
| `POST /api/admin/rides/:id/verdict` | 4 | admin | — |
| `POST /api/admin/rides/:id/rejudge` | 1 | admin | — |
| `GET /api/admin/actions` | 8 | admin, promo | — |
| `GET /api/admin/signins` | 1 | admin | — |
| `GET /api/admin/logs` | 1 | admin | — |

</details>

<details><summary>Admin creates / disables a promo code</summary>

| Step | Scenario cases | Browser runs | Named by |
| --- | ---: | --- | --- |
| `POST /api/admin/promos/challenge` | 10 | admin, promo | — |
| `POST /api/admin/promos` | 5 | admin, promo | — |
| `GET /api/admin/promos` | 8 | admin, promo | — |
| `GET /api/admin/promos/redemptions` | 4 | admin, promo | — |
| `POST /api/admin/promos/:code/disable` | 3 | admin, promo | — |

</details>

<details><summary>Analytics relay</summary>

| Step | Scenario cases | Browser runs | Named by |
| --- | ---: | --- | --- |
| `POST /api/telemetry` | 5 | board, browser, close-split, close, lobby, promo, replay, verified, wallet-split, wallet, watch | — |

</details>

## Controllers

| Controller | Routes | Spec cases | Routes the spec dispatches | Handlers with a spec | Routes in scenarios | Routes in browser runs | Lines |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `admin-promos` | 5 | 5 | 5/5 | 5/5 | 5/5 | 5/5 | 100 % |
| `admin` | 12 | 5 | 12/12 | 12/12 | 12/12 | 12/12 | 100 % |
| `auth` | 4 | 4 | 4/4 | 4/4 | 4/4 | 3/4 | 100 % |
| `chain-webhook` | 1 | 2 | 1/1 | 1/1 | 1/1 | 0/1 | 100 % |
| `chain` | 1 | 2 | 1/1 | 1/1 | 1/1 | 0/1 | 100 % |
| `economy` | 3 | 2 | 3/3 | 3/3 | 3/3 | 3/3 | 100 % |
| `garage` | 2 | 2 | 2/2 | 2/2 | 2/2 | 2/2 | 100 % |
| `pools` | 6 | 2 | 6/6 | 6/6 | 6/6 | 2/6 | 100 % |
| `promos` | 3 | 2 | 3/3 | 3/3 | 3/3 | 2/3 | 100 % |
| `tickets` | 6 | 2 | 6/6 | 6/6 | 5/6 | 0/6 | 100 % |
| `health` | 2 | 2 | 2/2 | 2/2 | 2/2 | 0/2 | 100 % |
| `live` | 8 | 1 | 8/8 | 8/8 | 8/8 | 8/8 | 100 % |
| `lobby` | 3 | 1 | 3/3 | 3/3 | 3/3 | 3/3 | 100 % |
| `rides` | 10 | 8 | 10/10 | 10/10 | 10/10 | 8/10 | 100 % |
| `telemetry` | 1 | 2 | 1/1 | 1/1 | 1/1 | 1/1 | 100 % |

## Routes

| Route | Feature | Handler spec cases | Controller spec | Scenario cases | Browser runs | Named by | Handler lines · branches |
| --- | --- | ---: | :---: | ---: | --- | --- | ---: |
| `GET /api/admin/promos` | promo | 2 | yes | 8 | admin, promo | — | 100 % · 75 % |
| `GET /api/admin/promos/redemptions` | promo | 2 | yes | 4 | admin, promo | — | 100 % · 75 % |
| `POST /api/admin/promos/challenge` | promo | 2 | yes | 10 | admin, promo | — | 100 % · 75 % |
| `POST /api/admin/promos` | promo | 4 | yes | 5 | admin, promo | — | 100 % |
| `POST /api/admin/promos/:code/disable` | promo | 4 | yes | 3 | admin, promo | — | 100 % · 100 % |
| `POST /api/admin/auth/nonce` | admin | 2 | yes | 22 | admin, promo | e2e-admin | 100 % · 100 % |
| `POST /api/admin/auth/verify` | admin | 4 | yes | 22 | admin, promo | e2e-admin | 100 % · 100 % |
| `POST /api/admin/auth/logout` | admin | 1 | yes | 1 | admin | — | 100 % |
| `GET /api/admin/overview` | admin | 1 | yes | 4 | admin, promo | — | 100 % |
| `GET /api/admin/rides` | admin | 1 | yes | 2 | admin, promo | — | 100 % · 50 % |
| `GET /api/admin/rides/:id` | admin | 2 | yes | 1 | admin | — | 100 % · 64.3 % |
| `POST /api/admin/rides/:id/challenge` | admin | 2 | yes | 3 | admin | — | 100 % · 75 % |
| `POST /api/admin/rides/:id/verdict` | admin | 4 | yes | 4 | admin | — | 100 % · 50 % |
| `POST /api/admin/rides/:id/rejudge` | admin | 5 | yes | 1 | admin | — | 100 % · 50 % |
| `GET /api/admin/signins` | admin | 1 | yes | 1 | admin | — | 100 % · 50 % |
| `GET /api/admin/actions` | admin | 1 | yes | 8 | admin, promo | — | 100 % · 50 % |
| `GET /api/admin/logs` | admin | 1 | yes | 1 | admin | — | 100 % · 50 % |
| `POST /api/auth/nonce` | auth | 4 | yes | 141 | admin, board, browser, close-split, close, flags, lobby, promo, replay, verified, wallet-split, wallet, watch | — | 100 % · 100 % |
| `POST /api/auth/verify` | auth | 5 | yes | 137 | admin, board, browser, close-split, close, flags, lobby, promo, replay, verified, wallet-split, wallet, watch | e2e-localnet, e2e-verified-play | 100 % · 87.5 % |
| `POST /api/auth/logout` | auth | 1 | yes | 1 | — | — | 100 % |
| `GET /api/me` | auth | 4 | yes | 29 | board, close-split, close, flags, lobby, promo, replay, wallet-split, wallet, watch | e2e-wallet | 100 % |
| `POST /api/chain/webhook` | escrow-settle | 2 | yes | 5 | — | e2e-localnet | 100 % · 83.3 % |
| `GET /api/chain/fees` | legacy-pay | 2 | yes | 3 | — | — | 100 % · 50 % |
| `GET /api/tiers` | lobby | 4 | yes | 7 | board, close-split, close, lobby, promo, replay, wallet-split, wallet | — | 100 % · 100 % |
| `GET /api/pool` | lobby | 3 | yes | 2 | board, close-split, close, lobby, promo, replay, wallet-split, wallet | e2e-lobby | 100 % · 100 % |
| `GET /api/leaderboard` | lobby | 4 | yes | 7 | board, close-split, close, lobby, promo, replay, wallet-split, wallet | — | 100 % · 100 % |
| `GET /api/garage` | garage | 1 | yes | 6 | lobby, promo | e2e-lobby | 100 % · 50 % |
| `POST /api/garage/loadout` | garage | 7 | yes | 4 | lobby | — | 100 % · 100 % |
| `GET /api/pools` | escrow-buy | 2 | yes | 1 | lobby | e2e-lobby | 100 % · 50 % |
| `GET /api/pools/:id` | escrow-buy | 3 | yes | 6 | — | — | 100 % · 75 % |
| `POST /api/promo/redeem` | promo | 14 | yes | 33 | admin, lobby, promo | — | 100 % · 92.9 % |
| `GET /api/pools/:id/refund` | escrow-close | 3 | yes | 1 | — | — | 100 % · 100 % |
| `GET /api/pools/:id/payout` | escrow-close | 3 | yes | 1 | — | — | 100 % · 90 % |
| `POST /api/chain/settle` | escrow-settle | 4 | yes | 1 | — | — | 100 % · 97.1 % |
| `GET /api/promo/mine` | promo | 1 | yes | 6 | lobby, promo, wallet-split, wallet | e2e-wallet | 100 % · 50 % |
| `GET /api/wardrobe` | garage | 2 | yes | 5 | browser, close-split, close, lobby, promo, replay, verified, watch | e2e-lobby | 100 % · 50 % |
| `POST /api/wardrobe/equip` | garage | 3 | yes | 2 | — | — | 100 % · 100 % |
| `POST /api/tickets` | escrow-buy | 3 | yes | 5 | — | — | 100 % · 94.1 % |
| `GET /api/tickets/pending` | escrow-buy | 1 | yes | 1 | — | — | 100 % · 100 % |
| `GET /api/tickets/orders/:id` | escrow-buy | 1 | yes | 5 | — | — | 100 % · 83.3 % |
| `GET /api/tickets/orders/:id/payment` | escrow-buy | 3 | yes | 1 | — | — | 100 % · 90.9 % |
| `POST /api/tickets/orders/:id/confirm` | escrow-buy | 3 | yes | 1 | — | — | 100 % · 94.4 % |
| `POST /api/tickets/orders/:id/submit` | escrow-buy | 3 | yes | **0** | — | — | 100 % · 84.2 % |
| `GET /api/health/live` | platform | 1 | yes | 5 | — | — | 100 % |
| `GET /api/health/ready` | platform | 2 | yes | 1 | — | — | 100 % · 50 % |
| `GET /api/watch/:id` | watch | 9 | yes | 13 | board, close-split, close, flags, lobby, replay, watch | e2e-watch | 100 % · 92.3 % |
| `POST /api/watch/:id/messages` | live-interact | 7 | yes | 5 | flags, replay, watch | — | 100 % · 100 % |
| `POST /api/watch/:id/donations` | live-interact | 7 | yes | 4 | flags, replay, watch | — | 100 % · 100 % |
| `POST /api/watch/:id/donation-orders` | live-interact | 2 | yes | 1 | flags | — | 100 % · 100 % |
| `POST /api/watch/:id/donation-orders/:orderId/confirm` | live-interact | 3 | yes | 1 | flags | — | 95.5 % · 84.9 % |
| `GET /api/rides/:id/inbox` | live-interact | 1 | yes | 5 | browser, close-split, close, lobby, replay, verified, watch | — | 100 % |
| `POST /api/rides/:id/mutes` | live-interact | 1 | yes | 1 | watch | — | 100 % · 100 % |
| `POST /api/rides/:id/effects/:eventId/applied` | live-interact | 3 | yes | 2 | replay, watch | — | 88.9 % · 78.6 % |
| `GET /api/live` | live-board | 7 | yes | 8 | board, close-split, close, lobby, promo, replay, wallet-split, wallet | — | 100 % · 94.1 % |
| `GET /api/replays` | live-board | 1 | yes | 1 | board, close-split, close, lobby, promo, replay, wallet-split, wallet | — | 100 % · 87.5 % |
| `GET /api/profile` | lobby | 3 | yes | 12 | lobby | — | 100 % · 83.3 % |
| `POST /api/rides` | rides | 13 | yes | 88 | admin, board, browser, close-split, close, flags, lobby, replay, verified, watch | e2e-localnet | 100 % · 97.3 % |
| `GET /api/rides/pending` | rides | 3 | yes | 2 | board, close-split, close, lobby, promo, wallet-split, wallet | — | 100 % · 75 % |
| `GET /api/rides/:id` | rides | 1 | yes | 15 | admin, browser, close-split, close, lobby, replay, verified, watch | e2e-browser | 100 % · 75 % |
| `GET /api/rides/:id/payment` | legacy-pay | 2 | yes | 3 | — | — | 100 % · 87.5 % |
| `POST /api/rides/:id/confirm` | legacy-pay | 9 | yes | 28 | — | — | 100 % · 95 % |
| `POST /api/rides/:id/reconcile` | legacy-pay | 5 | yes | 3 | lobby | — | 100 % · 95 % |
| `POST /api/rides/:id/start` | rides | 6 | yes | 67 | admin, board, browser, close-split, close, flags, lobby, replay, verified, watch | — | 100 % · 100 % |
| `POST /api/rides/:id/heartbeat` | rides | 6 | yes | 29 | board, browser, close-split, close, lobby, replay, verified, watch | — | 100 % · 100 % |
| `POST /api/rides/:id/batches` | verified-play | 7 | yes | 23 | admin, board, browser, close-split, close, lobby, replay, verified, watch | — | 100 % · 80 % |
| `POST /api/rides/:id/end` | rides | 6 | yes | 40 | admin, board, browser, close-split, close, lobby, replay, verified, watch | — | 94.7 % · 75 % |
| `POST /api/telemetry` | analytics | 7 | yes | 5 | board, browser, close-split, close, lobby, promo, replay, verified, wallet-split, wallet, watch | — | 100 % · 96.2 % |

## Files with no test of their own, by feature

- **Sign-in + session** (6): `domain/auth/sign-in.ts` (100 % lines), `domain/players/wallet-address.ts` (100 % lines), `client/js/hosts.js` (100 % lines), `client/js/wallet.js` (42.9 % lines), `client/site/dev-wallet.js`, `client/site/wallet.js` (34.2 % lines)
- **Verified play (recording, verdict, prompts)** (7): `domain/verdict/challenge-checks.ts` (100 % lines), `domain/verdict/human-checks.ts` (100 % lines), `domain/verdict/recording-checks.ts` (100 % lines), `domain/verdict/ride-verdict.entity.ts` (96.4 % lines), `domain/verdict/verdict-rules.ts` (100 % lines), `client/js/prompt.js` (45.7 % lines), `client/js/telemetry.js` (57.7 % lines)
- **Pay-per-ride (legacy weekly round)** (4): `domain/economy/payment-verification.ts` (100 % lines), `domain/economy/payment.entity.ts` (100 % lines), `domain/economy/round.entity.ts` (100 % lines), `domain/economy/week.ts` (100 % lines)
- **Ride lifecycle (order, start, heartbeat, end, stale sweep)** (5): `domain/rides/ride-report.ts`, `domain/rides/ride-rules.ts` (100 % lines), `domain/rides/ride-status.ts` (100 % lines), `domain/rides/ride-tier.ts` (100 % lines), `client/js/online.js` (23.2 % lines)
- **Escrow: pools on sale + ticket purchase** (5): `infrastructure/solana/borsh.ts` (95.5 % lines), `infrastructure/solana/pool-program.idl.ts` (100 % lines), `client/site/lobby-pools.js`, `client/site/pay.js` (5.3 % lines), `client/site/tickets-api.js` (94.1 % lines)
- **Escrow: settlement (events, watcher, webhook)** (3): `domain/economy/chain-events.ts` (100 % lines), `domain/economy/chain-transaction.ts`, `domain/economy/transaction-signature.ts` (100 % lines)
- **Escrow program (on-chain, Rust)** (14): `programs/freightchain-pools/programs/freightchain_pools/src/constants.rs`, `programs/freightchain-pools/programs/freightchain_pools/src/error.rs`, `programs/freightchain-pools/programs/freightchain_pools/src/events.rs`, `programs/freightchain-pools/programs/freightchain_pools/src/instructions/admin.rs`, `programs/freightchain-pools/programs/freightchain_pools/src/instructions/buy_ticket.rs`, `programs/freightchain-pools/programs/freightchain_pools/src/instructions/create_pool.rs`, `programs/freightchain-pools/programs/freightchain_pools/src/instructions/lifecycle.rs`, `programs/freightchain-pools/programs/freightchain_pools/src/instructions/refund.rs`, `programs/freightchain-pools/programs/freightchain_pools/src/instructions/settle.rs`, `programs/freightchain-pools/programs/freightchain_pools/src/instructions/sponsor.rs`, `programs/freightchain-pools/programs/freightchain_pools/src/instructions.rs`, `programs/freightchain-pools/programs/freightchain_pools/src/lib.rs`, `programs/freightchain-pools/programs/freightchain_pools/src/state.rs`, `programs/freightchain-pools/programs/freightchain_pools/src/vault.rs`
- **Promo codes (admin creates, players redeem)** (2): `infrastructure/prisma/mappers/promo.mapper.ts` (100 % lines), `client/site/lobby-promo.js` (61.8 % lines)
- **Garage + cosmetics** (3): `client/js/cosmetics.js` (100 % lines), `client/site/garage-cab.js`, `client/site/lobby-garage.js` (45.7 % lines)
- **Live board (online, on the road, history)** (2): `client/site/lobby-replays.js`, `client/site/presence.js` (4.5 % lines)
- **Live streams: watch + replay** (3): `client/js/cockpit/inputs.js` (19.1 % lines), `client/js/ui/watch-panel.js` (1.8 % lines), `client/js/watch.js` (7.9 % lines)
- **Live streams: chat, mutes, donations, effects** (3): `domain/live/live-rules.ts` (100 % lines), `client/js/live-effects.js` (0 % lines), `client/js/ui/live-feed.js` (5.7 % lines)
- **Lobby: tiers, pool, leaderboard, profile** (4): `domain/achievements/achievement-unlock.entity.ts` (100 % lines), `domain/achievements/achievements.ts` (100 % lines), `client/site/dom.js` (20 % lines), `client/site/lobby.js`
- **Admin page (sign-in, review queue, audit)** (2): `application/use-cases/admin/admin-ride-row.ts` (100 % lines), `client/site/admin.js`
- **Product analytics relay** (4): `application/services/analytics-events.ts` (100 % lines), `domain/analytics/server-events.ts` (100 % lines), `infrastructure/analytics/uuid-v5.ts` (100 % lines), `client/js/analytics.js` (31.5 % lines)
- **Platform: HTTP contract, health, rate limits, config, logs, CLI** (28): `application/services/demo.ts` (100 % lines), `cli/admin-commands.ts` (0 % lines), `cli/cli.ts` (0 % lines), `domain/ops/log-entry.ts` (100 % lines), `domain/shared/errors.ts` (100 % lines), `domain/shared/problem-details.ts` (100 % lines), `infrastructure/config/client-dir.ts` (100 % lines), `infrastructure/config/dotenv-bootstrap.ts` (0 % lines), `infrastructure/config/load-dotenv.ts` (0 % lines), `infrastructure/http/decorators/client-info.ts` (100 % lines), `infrastructure/http/decorators/current-player.ts` (100 % lines), `infrastructure/http/decorators/optional-session.ts` (100 % lines), `infrastructure/http/decorators/zod.ts` (100 % lines), `infrastructure/http/types/http-request.ts` (100 % lines), `infrastructure/prisma/mappers/achievement-unlock.mapper.ts` (100 % lines), `infrastructure/prisma/mappers/chain-event.mapper.ts` (90 % lines), `infrastructure/prisma/mappers/payment.mapper.ts` (100 % lines), `infrastructure/prisma/mappers/player.mapper.ts` (100 % lines), `infrastructure/prisma/mappers/pool.mapper.ts` (100 % lines), `infrastructure/prisma/mappers/ride-batch.mapper.ts` (100 % lines), `infrastructure/prisma/mappers/ride-event.mapper.ts` (100 % lines), `infrastructure/prisma/mappers/ride-ticket.mapper.ts` (100 % lines), `infrastructure/prisma/mappers/ride-verdict.mapper.ts` (100 % lines), `infrastructure/prisma/mappers/ride.mapper.ts` (100 % lines), `infrastructure/prisma/mappers/round.mapper.ts` (100 % lines), `infrastructure/prisma/mappers/ticket-order.mapper.ts` (100 % lines), `infrastructure/prisma/prisma-client.ts` (100 % lines), `main.ts` (0 % lines)
- **Game: driving sim (drivetrain, brakes, battery, climate)** (8): `client/js/config.js` (100 % lines), `client/js/sim/climate.js` (83.9 % lines), `client/js/sim/damage.js` (69.5 % lines), `client/js/sim/physics.js` (79.8 % lines), `client/js/sim/radio.js` (19.6 % lines), `client/js/sim/shake.js` (44.4 % lines), `client/js/state.js` (100 % lines), `client/js/util.js` (100 % lines)
- **Game: endless road, junctions, traffic** (11): `client/js/net/network.js` (75.4 % lines), `client/js/net/orchestrator.js` (44.4 % lines), `client/js/net/patterns.js`, `client/js/road.js` (76.9 % lines), `client/js/sim/traffic.js` (75.6 % lines), `client/js/world/chunks.js` (64.1 % lines), `client/js/world/depot.js` (72.4 % lines), `client/js/world/holes.js` (62.7 % lines), `client/js/world/junctions.js` (78.2 % lines), `client/js/world/pool.js` (69.2 % lines), `client/js/world/roadmesh.js` (76.5 % lines)
- **Game: cockpit, scenery, routes, 3D models** (71): `client/js/cockpit/canvas.js` (81.8 % lines), `client/js/cockpit/common.js` (90.5 % lines), `client/js/cockpit/index.js` (68.8 % lines), `client/js/cockpit/rig.js` (25.9 % lines), `client/js/cockpit/windscreen.js` (82.2 % lines), `client/js/main.js` (4.9 % lines), `client/js/themes/_shared/furniture.js` (76.9 % lines), `client/js/themes/_shared/ground.js` (16.7 % lines), `client/js/themes/_shared/landmarks/flags.js` (88.7 % lines), `client/js/themes/_shared/landmarks/food.js` (75.7 % lines), `client/js/themes/_shared/landmarks/fuel.js` (87.1 % lines), `client/js/themes/_shared/landmarks/index.js` (76 % lines), `client/js/themes/_shared/landmarks/lodging.js` (81.8 % lines), `client/js/themes/_shared/landmarks/parts.js` (77.8 % lines), `client/js/themes/_shared/landmarks/police.js` (81.3 % lines), `client/js/themes/_shared/mats.js` (44.4 % lines), `client/js/themes/_shared/mountains.js` (57.1 % lines), `client/js/themes/_shared/profile.js` (50 % lines), `client/js/themes/_shared/props-basic.js` (90.2 % lines), `client/js/themes/_shared/road-texture.js` (72.7 % lines), `client/js/themes/_shared/sky-dome.js` (26.7 % lines), `client/js/themes/_shared/theme.js` (17.6 % lines), `client/js/themes/brenner/index.js`, `client/js/themes/brenner/mountains.js` (85.7 % lines), `client/js/themes/brenner/props.js` (100 % lines), `client/js/themes/brenner/road.js` (66.7 % lines), `client/js/themes/brenner/sky.js` (50 % lines), `client/js/themes/brenner/terrain.js` (90 % lines), `client/js/themes/index.js` (18.2 % lines), `client/js/themes/panamerican/index.js`, `client/js/themes/panamerican/mountains.js` (85.7 % lines), `client/js/themes/panamerican/props.js` (81.8 % lines), `client/js/themes/panamerican/road.js` (66.7 % lines), `client/js/themes/panamerican/sky.js` (50 % lines), `client/js/themes/panamerican/terrain.js` (90.9 % lines), `client/js/themes/route66/index.js`, `client/js/themes/route66/mountains.js` (75 % lines), `client/js/themes/route66/props.js` (81.8 % lines), `client/js/themes/route66/road.js` (66.7 % lines), `client/js/themes/route66/sky.js` (50 % lines), `client/js/themes/route66/terrain.js` (88.9 % lines), `client/js/themes/siberia/index.js`, `client/js/themes/siberia/mountains.js` (85.7 % lines), `client/js/themes/siberia/props.js` (81.8 % lines), `client/js/themes/siberia/road.js` (66.7 % lines), `client/js/themes/siberia/sky.js` (50 % lines), `client/js/themes/siberia/terrain.js` (90 % lines), `client/js/themes/stuart/index.js`, `client/js/themes/stuart/mountains.js` (75 % lines), `client/js/themes/stuart/props.js` (100 % lines), `client/js/themes/stuart/road.js` (66.7 % lines), `client/js/themes/stuart/sky.js` (50 % lines), `client/js/themes/stuart/terrain.js` (90 % lines), `client/js/ui/fail-fx.js` (82.4 % lines), `client/js/ui/game.js` (34.3 % lines), `client/js/ui/input.js` (39.7 % lines), `client/js/ui/routes.js` (63 % lines), `client/js/ui/toast.js` (75 % lines), `client/js/ui/tuning.js` (8.3 % lines), `client/js/viewer.js`, `client/js/world/daynight.js` (69 % lines), `client/js/world/environment.js` (66.7 % lines), `client/js/world/gantry.js`, `client/js/world/glow.js` (77.4 % lines), `client/js/world/nightlight.js` (5.6 % lines), `client/js/world/props.js` (51.7 % lines), `client/js/world/render.js` (67.6 % lines), `client/js/world/scene.js` (62.5 % lines), `client/js/world/theme-manager.js` (52.9 % lines), `client/js/world/trailer.js` (37.1 % lines), `client/js/world/vehicles.js` (73.8 % lines)
- **Landing page** (2): `landing/src/dash-live.js`, `landing/src/main.js`
- **Promo clips + sound** (17): `media/audio/cli.mjs`, `media/audio/cues.mjs` (100 % lines), `media/audio/game-sfx.mjs` (100 % lines), `media/audio/mix.mjs` (100 % lines), `media/audio/music.mjs` (100 % lines), `media/audio/render.mjs` (100 % lines), `media/audio/scores/index.mjs` (100 % lines), `media/audio/scores/road-rush.mjs` (100 % lines), `media/audio/sfx.mjs` (100 % lines), `media/audio/spec.mjs` (100 % lines), `media/audio/synth.mjs` (100 % lines), `media/audio/wav.mjs` (100 % lines), `media/video/capture.mjs`, `media/video/clock.js`, `media/video/encode.mjs` (72.5 % lines), `media/video/render.mjs` (35.3 % lines), `media/video/spec.mjs` (100 % lines)

## Map hygiene

- Source files no feature claims: none.
- Tests attributed to no feature: none.
- Headless checks no feature claims: none.

