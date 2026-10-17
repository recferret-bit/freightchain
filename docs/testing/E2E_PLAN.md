# Local code end-to-end plan

> **Source of truth:** [docs/spec](../spec/README.md) is the source of truth for how the product should work and how it is tested. This file is the checklist for the local code suite in this PR. Related sections: [e2e](../spec/e2e.md), [replays and streams](../spec/replays_streams.md).

PR #3 (`cursor/ten4-tokenomics-6271`) was **not merged** when this branch was cut from `origin/main` (`3ab33d80`). Checks that need that branch are status `unmerged`: they assert the symbol is absent on this tree and leave a `test.todo` for the behaviour.

This suite is code and Docker. It does not open Chrome. Page modules run under happy-dom with fetch mocked. API checks call a real server on the e2e compose database and skip unless `E2E_BASE` is set. `npm run test:e2e:block1` and `npm run test:e2e:block2` set `E2E_REQUIRE=1` so a missing server fails the run.

## The three free paths on main

The owner's names (EASY guest / training / weekly granted ticket) do not match this tree.

1. **Offline guest practice.** No wallet and no API. Trip `free-g` (2 min). Entry is `play.html?offline=1`. The menu button is `#go` ("START FREE RUN"). `free-g` is never stamped on a ride.
2. **Online training rides.** Metered by `Player.freeRides`. `POST /api/rides` `{ tier: 'free', level }`. EASY is level 1 trip `free-1c`. MEDIUM is level 2 trip `free-2c`. HARD is level 3 trip `free-3b` and refuses tutorial and assist (409).
3. **Free-ride credits**, not a third mode. Signup `free_on_signup` (default 10) plus a daily UTC +1 capped by `free_rides_daily_max` (default 5) in `GrantDailyFreeRidesHandler`. Tutorial and assist are flags on path 2.

A weekly granted paid ticket, `POST /api/auth/guest`, promo `kind: 'ride'`, `GET /api/prize/board`, HARD `free-3c`, and the TEN4 rename are PR #3 only.

## Counts

| Feature | Block 1 | Block 2 |
| --- | ---: | ---: |
| landing | 32 | 2 |
| pitch | 13 | 1 |
| whitepaper | 6 | 1 |
| lobby | 30 | 8 |
| free | 15 | 2 |
| promo | 5 | 2 |
| referral | 4 | 2 |
| admin | 26 | 10 |
| **total** | **131** | **28** |

Block 1: 131 checks (automated 105, mock 10, manual 9, pending 1, unmerged 6).

Block 2: 28 checks (automated 20, mock 2, manual 1, pending 5, unmerged 0).

All checks: 159. Automated 125, mock 12, manual 10, pending 6, unmerged 6.

Chain-independent controls (nav anchors, FAQ, deck keys, whitepaper contents) are executed in block 1. Block 2 repeats the controls whose payload changes when a pool is on sale.

## (a) Checklist

### Block 1 — chain off

### landing
- `B1-LAND-01` (automated) Brand link href #ride
- `B1-LAND-02` (automated) Nav 01 RIDE → #ride
- `B1-LAND-03` (automated) Nav 02 LOOP → #loop
- `B1-LAND-04` (automated) Nav 03 ECONOMY → #economy
- `B1-LAND-05` (automated) Nav 04 ROADMAP → #roadmap
- `B1-LAND-06` (automated) Nav 05 MARKET → #market
- `B1-LAND-07` (automated) Nav 06 ABOUT → #about
- `B1-LAND-08` (automated) Nav 07 FAQ → #faq
- `B1-LAND-09` (automated) #play-top unsigned → play.html?offline=1
- `B1-LAND-10` (automated) #connect is wired and reads CONNECT WALLET
- `B1-LAND-11` (mock) Mock keypair sign-in posts nonce and verify
- `B1-LAND-12` (automated) #play-free href is the offline run
- `B1-LAND-13` (automated) #demo-btn opens the dialog
- `B1-LAND-14` (automated) #demo-x closes the dialog
- `B1-LAND-15` (automated) Empty invite form asks for a code
- `B1-LAND-16` (automated) Invite CLAIM saves the code until a wallet connects
- `B1-LAND-17` (automated) Pitch deck band link
- `B1-LAND-18` (automated) Whitepaper CTA
- `B1-LAND-19` (automated) Escrow link to the whitepaper chapter
- `B1-LAND-20` (automated) Storybook footer link
- `B1-LAND-21` (automated) Whitepaper footer link
- `B1-LAND-22` (automated) Pitch deck footer link
- `B1-LAND-23` (automated) One FAQ question toggles class on
- `B1-LAND-24` (automated) Social X link
- `B1-LAND-25` (automated) Social YouTube link
- `B1-LAND-26` (automated) Boot GET me, pool, live, replays, tiers, leaderboard and POST nonce
- `B1-LAND-27` (mock) Source of the phone pair claim route
- `B1-LAND-28` (automated) Every FAQ button toggles
- `B1-LAND-29` (automated) Scroll hint → #loop
- `B1-LAND-30` (automated) Footer lobby, practice and blink links
- `M-01` (manual) Phantom or Solflare extension popup on CONNECT
- `M-02` (manual) Phone QR pairing ?pair=

### pitch
- `B1-DECK-01` (automated) First slide is showing
- `B1-DECK-02` (automated) #next advances
- `B1-DECK-03` (automated) #prev goes back
- `B1-DECK-04` (automated) Help-bar next arrow
- `B1-DECK-05` (automated) ArrowRight key
- `B1-DECK-06` (automated) Home key returns to the first slide
- `B1-DECK-07` (mock) #fs shows the fullscreen hint (no requestFullscreen)
- `B1-DECK-08` (automated) #fs-hint click hides the hint
- `B1-DECK-09` (automated) #tilt stays hidden without a phone
- `B1-DECK-10` (automated) #turn-skip click does not throw
- `B1-DECK-11` (automated) Slide controls that exist receive a click
- `M-03` (manual) Real fullscreen on the pitch deck
- `M-04` (manual) Device-motion / tilt permission

### whitepaper
- `B1-PAPER-01` (automated) Landing link rewritten to this origin
- `B1-PAPER-02` (automated) #play-top → offline practice
- `B1-PAPER-03` (automated) Storybook link
- `B1-PAPER-04` (automated) Home link
- `B1-PAPER-05` (automated) Lobby link
- `B1-PAPER-06` (automated) Contents links are in-page anchors

### lobby
- `B1-LOBBY-01` (automated) Wallet chip and SIGN OUT
- `B1-LOBBY-02` (automated) NEW RIDE is the default tab
- `B1-LOBBY-03` (automated) LIVE tab
- `B1-LOBBY-04` (automated) REPLAYS tab
- `B1-LOBBY-05` (automated) LEADERBOARD tab
- `B1-LOBBY-06` (automated) ACHIEVEMENTS tab
- `B1-LOBBY-07` (automated) PROFILE tab
- `B1-LOBBY-08` (automated) LIVE sort and route do not refetch
- `B1-LOBBY-09` (automated) REPLAYS MINE filter requests wallet=
- `B1-LOBBY-10` (automated) Leaderboard GET /api/leaderboard
- `B1-LOBBY-11` (mock) Profile promo form POST /api/promo/redeem
- `B1-LOBBY-12` (automated) Age agreement PUT /api/profile/agreements
- `B1-LOBBY-13` (automated) Referral gift click POST item signal
- `B1-LOBBY-14` (automated) Referral copy button and ref code
- `B1-LOBBY-15` (automated) START FREE RIDE posts level 1 and opens play.html?ride=
- `B1-LOBBY-16` (automated) HARD radio disables assist; EASY restores it
- `B1-LOBBY-17` (automated) GARAGE tab GET /api/garage
- `B1-LOBBY-18` (automated) SIGN OUT posts logout and leaves for /
- `B1-LOBBY-19` (automated) Receipt loads GET /api/rides/:id/public
- `B1-LOBBY-20` (automated) Receipt TAKE THE WHEEL → play.html
- `B1-LOBBY-21` (automated) Receipt share and watch buttons exist
- `B1-LOBBY-22` (mock) Blink SHOW loads /api/actions/hello
- `B1-LOBBY-23` (mock) Blink CONNECT WALLET is present
- `B1-BOARD-01` (unmerged) GET /api/prize/board is absent (PR #3 ranked board)
- `B1-HONK-01` (unmerged) Token symbol on this tree is HONK, not TEN4 (PR #3)
- `M-05` (manual) Solana Pay QR on a ticket buy
- `M-06` (manual) Wallet signAndSendTransaction for buy_ticket
- `M-07` (manual) Blink transaction button with a real wallet
- `M-08` (manual) Real phone viewport (driving blocked, spectate allowed)
- `M-09` (manual) Solana Pay deep link opened from a phone

### free
- `B1-FREE-01` (automated) Offline guest practice is trip free-g, never stamped on a ride
- `B1-FREE-02` (automated) Guest entry is play.html?offline=1 and #go START FREE RUN
- `B1-FREE-03` (automated) Online training EASY is level 1 trip free-1c
- `B1-FREE-04` (automated) Online training MEDIUM is level 2 trip free-2c
- `B1-FREE-05` (automated) Online training HARD is level 3 trip free-3b; tutorial and assist refused
- `B1-FREE-06` (automated) Signup credit free_on_signup default 10
- `B1-FREE-07` (automated) Daily credit GrantDailyFreeRidesHandler, cap free_rides_daily_max 5
- `B1-FREE-10` (unmerged) POST /api/auth/guest is absent (PR #3)
- `B1-FREE-11` (unmerged) Weekly granted ticket settings are absent (PR #3)
- `B1-FREE-13` (unmerged) HARD trip free-3c is absent; free-3b remains (PR #3)
- `B1-API-05` (automated) POST /api/rides level 1
- `B1-API-06` (automated) POST /api/rides level 2
- `B1-API-07` (automated) POST /api/rides level 3
- `B1-API-08` (automated) HARD + assist → 409 assist_not_allowed
- `B1-API-09` (automated) HARD + tutorial → 409 tutorial_not_allowed

### promo
- `B1-PROMO-01` (mock) Admin signs and creates a free_rides code
- `B1-PROMO-02` (automated) Player redeems that code and freeRides increases by 3
- `B1-PROMO-03` (automated) Cosmetic create is 409 visuals_are_honk
- `B1-PROMO-04` (automated) Unknown code does not redeem
- `B1-PROMO-05` (unmerged) Promo kind ride is absent; free_rides remains (PR #3)

### referral
- `B1-REF-01` (mock) Second wallet binds the first Convoy code
- `B1-REF-02` (automated) Gift convoy
- `B1-REF-03` (automated) Gift signal
- `B1-REF-04` (pending) Verified MEDIUM ride grants the referrer free rides

### admin
- `B1-ADMIN-01` (automated) 404 overview shows the sign-in gate
- `B1-ADMIN-02` (automated) REFRESH and SIGN OUT exist on the shell
- `B1-ADMIN-03` (automated) OVERVIEW GET /api/admin/overview
- `B1-ADMIN-04` (automated) REVIEW QUEUE GET /api/admin/rides
- `B1-ADMIN-05` (automated) RIDES GET /api/admin/rides
- `B1-ADMIN-06` (automated) REPLAYS GET /api/admin/replays
- `B1-ADMIN-07` (automated) PLAYERS GET /api/admin/players
- `B1-ADMIN-08` (automated) POOLS GET /api/admin/pools
- `B1-ADMIN-09` (automated) PAYOUTS GET /api/admin/pool-payouts
- `B1-ADMIN-10` (automated) STATS GET /api/admin/stats
- `B1-ADMIN-11` (automated) SESSIONS GET /api/admin/sessions
- `B1-ADMIN-12` (automated) PROMO CODES GET /api/admin/promos
- `B1-ADMIN-13` (automated) SETTINGS GET /api/admin/settings
- `B1-ADMIN-14` (automated) SIGN-INS GET /api/admin/signins
- `B1-ADMIN-15` (automated) LOGS GET /api/admin/logs
- `B1-ADMIN-16` (automated) AUDIT GET /api/admin/actions
- `B1-ADMIN-17` (automated) REFRESH reloads the open tab
- `B1-ADMIN-18` (automated) SIGN OUT posts admin logout
- `B1-API-01` (automated) GET /api/health/live
- `B1-API-02` (automated) GET /api/health/ready
- `B1-API-03` (mock) Keypair nonce + verify sets fc_session
- `B1-API-04` (automated) GET /api/me freeRides is 10
- `B1-API-10` (automated) Transfer mode: paid tiers unavailable, GET /api/honk chain null
- `B1-API-12` (mock) Dev admin keypair opens fc_admin
- `B1-API-13` (automated) GET /api/admin/overview after sign-in
- `B1-API-14` (automated) GET /api/admin/settings

### Block 2 — local chain

### landing
- `B2-LAND-01` (automated) Live pool paints IN ESCROW on the hero
- `B2-LAND-02` (mock) Mock keypair sign-in beside a live pool

### pitch
- `B2-DECK-01` (automated) Deck advances and does not call chain or honk

### whitepaper
- `B2-PAPER-01` (automated) Play control stays the offline guest run

### lobby
- `B2-LOBBY-01` (automated) 1h tier renders a BUY control
- `B2-LOBBY-02` (automated) START FREE RIDE still posts tier free
- `B2-LOBBY-03` (automated) Free card remains next to the paid pool
- `B2-API-05` (automated) Local validator getHealth
- `B2-API-06` (pending) Buy, ride, settle, pay winners
- `B2-API-07` (pending) HONK mint matches the ledger (TEN4 is unmerged)
- `B2-HONK-01` (automated) HONK declare_id matches env.schema
- `B2-HONK-02` (pending) Ledger balance versus chain mint after a local ride

### free
- `B2-FREE-01` (automated) Paid 1h is a separate trip from the three free paths
- `B2-API-04` (automated) Tiers list free, 1h, 4h, 8h

### promo
- `B2-PROMO-01` (automated) Ticket promo effect exists in the admin schema
- `B2-PROMO-02` (pending) Redeem a ticket promo into a local pool

### referral
- `B2-REF-01` (mock) Bind still answers in program mode
- `B2-REF-02` (automated) Program source has set_pool_rules and no pay_referrer

### admin
- `M-10` (manual) set_pool_rules from a human wallet UI
- `B2-ADMIN-01` (automated) POOLS tab GET /api/admin/pools with a signed-in shell
- `B2-ADMIN-02` (automated) set_pool_rules is in the program and absent from admin HTTP
- `B2-ADMIN-03` (automated) CLI set-pool-rules exists
- `B2-ADMIN-04` (pending) Live set_pool_rules against the local validator
- `B2-API-01` (automated) Program-mode server GET /api/health/live
- `B2-API-02` (automated) GET /api/honk chain.programId is the local HONK id
- `B2-API-03` (automated) GET /api/chain/fees
- `B2-POOL-01` (automated) IDL address is the pinned pool program
- `B2-POOL-02` (automated) IDL contains set_pool_rules

## (b) Scenarios

### Fresh player (block 1)

1. Open the landing unsigned. Boot reads `/api/me` (401), pool, live, replays, tiers, leaderboard.
2. PLAY and PLAY FREE RIDE NOW go to `play.html?offline=1` (`free-g`, `#go`).
3. A keypair signs nonce + verify. `GET /api/me` shows `freeRides: 10`.
4. The lobby opens on NEW RIDE. START FREE RIDE posts level 1 (EASY, `free-1c`).
5. Level 2 and level 3 succeed. Level 3 with assist or tutorial is 409.
6. SIGN OUT posts logout and returns to `/`.

### Admin

1. `/admin.html` with no session shows the gate (`#admin-signin`, `#admin-dev`).
2. The dev admin keypair (`freightchain-local-dev-admin-key`) posts nonce and verify with `x-fc-admin: 1` and stores `fc_admin`.
3. Each tab hash loads its GET: overview, rides, replays, players, pools, pool-payouts, stats, sessions, promos, settings, signins, logs, actions.
4. REFRESH repeats the open tab. SIGN OUT posts `/api/admin/auth/logout`.

### Promo

1. The admin signs `promo_create` for a `free_rides` code and posts `/api/admin/promos`.
2. A player posts `/api/promo/redeem`. `freeRides` rises by the count.
3. A cosmetic code is refused `visuals_are_honk` at the challenge.
4. An unknown code does not redeem.

### Referral (Convoy)

1. Wallet A reads `GET /api/referrals` and receives a code. The default gift is convoy.
2. Wallet B posts `/api/referrals/bind`. `referredBy` is A's wallet.
3. Either wallet posts `/api/referrals/gift` with `convoy` or `signal`.
4. The +2 / +3 free rides after a verified MEDIUM finish stay in `referral.service.spec.ts` (`B1-REF-04`, pending here). Pool v5 has no on-chain referral leg.

### Paid season week (block 2)

1. Compose Postgres and Redis, then a host `solana-test-validator` (Agave, same as `localnet-e2e`). Deploy the pool and HONK programs when their `.so` files exist (`e2e/scripts/chain-init.sh`).
2. The server runs `PAYMENT_MODE=program` with both program ids. `GET /api/honk` returns `chain.programId`. `GET /api/chain/fees` answers. Tiers still list free, 1h, 4h, 8h.
3. The landing hero says IN ESCROW when `/api/pool` has vaults. The lobby 1h card shows BUY. START FREE RIDE still posts `tier: 'free'`.
4. Ticket promo shape is in the admin schema. Redeeming one into a deployed pool is pending (`B2-PROMO-02`).
5. `set_pool_rules` is in the program and the IDL. No admin HTTP route calls it. The CLI is `pool-admin.mjs set-pool-rules` (`B2-ADMIN-04` pending, `M-10` if a human wallet UI appears).
6. Buy, ride, settle, and pay winners stay in `server/scripts/e2e-localnet.mjs` and `e2e-localnet-payout.mjs` (Chrome). This suite checks validator health and leaves the Merkle payout as `B2-API-06`. HONK ledger versus chain is `B2-API-07` / `B2-HONK-02`, already covered by `honk-suite` with a browser.

## (c) Coverage matrix

| ID | Existing | New test | Status |
| --- | --- | --- | --- |
| `B1-LAND-01` | landing/test/page.test.js | e2e/block1-offchain/landing/page.test.mjs | automated |
| `B1-LAND-02` | landing/test/page.test.js | e2e/block1-offchain/landing/page.test.mjs | automated |
| `B1-LAND-03` | landing/test/page.test.js | e2e/block1-offchain/landing/page.test.mjs | automated |
| `B1-LAND-04` | landing/test/page.test.js | e2e/block1-offchain/landing/page.test.mjs | automated |
| `B1-LAND-05` | landing/test/page.test.js | e2e/block1-offchain/landing/page.test.mjs | automated |
| `B1-LAND-06` | landing/test/page.test.js | e2e/block1-offchain/landing/page.test.mjs | automated |
| `B1-LAND-07` | landing/test/page.test.js | e2e/block1-offchain/landing/page.test.mjs | automated |
| `B1-LAND-08` | landing/test/page.test.js | e2e/block1-offchain/landing/page.test.mjs | automated |
| `B1-LAND-09` | landing/test/page.test.js | e2e/block1-offchain/landing/page.test.mjs | automated |
| `B1-LAND-10` | landing/tools/e2e-wallet.mjs | e2e/block1-offchain/landing/page.test.mjs | automated |
| `B1-LAND-11` | server/scripts/e2e-browser.mjs | e2e/block1-offchain/landing/page.test.mjs | mock |
| `B1-LAND-12` | landing/test/page.test.js | e2e/block1-offchain/landing/page.test.mjs | automated |
| `B1-LAND-13` | — | e2e/block1-offchain/landing/page.test.mjs | automated |
| `B1-LAND-14` | — | e2e/block1-offchain/landing/page.test.mjs | automated |
| `B1-LAND-15` | landing/test/promos.test.js | e2e/block1-offchain/landing/page.test.mjs | automated |
| `B1-LAND-16` | landing/test/promos.test.js | e2e/block1-offchain/landing/page.test.mjs | automated |
| `B1-LAND-17` | — | e2e/block1-offchain/landing/page.test.mjs | automated |
| `B1-LAND-18` | landing/test/whitepaper.test.js | e2e/block1-offchain/landing/page.test.mjs | automated |
| `B1-LAND-19` | — | e2e/block1-offchain/landing/page.test.mjs | automated |
| `B1-LAND-20` | — | e2e/block1-offchain/landing/page.test.mjs | automated |
| `B1-LAND-21` | — | e2e/block1-offchain/landing/page.test.mjs | automated |
| `B1-LAND-22` | — | e2e/block1-offchain/landing/page.test.mjs | automated |
| `B1-LAND-23` | — | e2e/block1-offchain/landing/page.test.mjs | automated |
| `B1-LAND-24` | — | e2e/block1-offchain/landing/page.test.mjs | automated |
| `B1-LAND-25` | — | e2e/block1-offchain/landing/page.test.mjs | automated |
| `B1-LAND-26` | landing/test/page.test.js | e2e/block1-offchain/landing/page.test.mjs | automated |
| `B1-LAND-27` | — | e2e/block1-offchain/landing/pair.test.mjs | mock |
| `B1-LAND-28` | — | e2e/block1-offchain/landing/page.test.mjs | automated |
| `B1-LAND-29` | — | e2e/block1-offchain/landing/page.test.mjs | automated |
| `B1-LAND-30` | — | e2e/block1-offchain/landing/page.test.mjs | automated |
| `B1-DECK-01` | landing/test/pitchdeck-coins.test.js | e2e/block1-offchain/pitchdeck/page.test.mjs | automated |
| `B1-DECK-02` | — | e2e/block1-offchain/pitchdeck/page.test.mjs | automated |
| `B1-DECK-03` | — | e2e/block1-offchain/pitchdeck/page.test.mjs | automated |
| `B1-DECK-04` | — | e2e/block1-offchain/pitchdeck/page.test.mjs | automated |
| `B1-DECK-05` | — | e2e/block1-offchain/pitchdeck/page.test.mjs | automated |
| `B1-DECK-06` | — | e2e/block1-offchain/pitchdeck/page.test.mjs | automated |
| `B1-DECK-07` | — | e2e/block1-offchain/pitchdeck/page.test.mjs | mock |
| `B1-DECK-08` | — | e2e/block1-offchain/pitchdeck/page.test.mjs | automated |
| `B1-DECK-09` | landing/test/pitchdeck-tilt.test.js | e2e/block1-offchain/pitchdeck/page.test.mjs | automated |
| `B1-DECK-10` | — | e2e/block1-offchain/pitchdeck/page.test.mjs | automated |
| `B1-DECK-11` | — | e2e/block1-offchain/pitchdeck/page.test.mjs | automated |
| `B1-PAPER-01` | landing/test/whitepaper.test.js | e2e/block1-offchain/whitepaper/page.test.mjs | automated |
| `B1-PAPER-02` | landing/test/whitepaper.test.js | e2e/block1-offchain/whitepaper/page.test.mjs | automated |
| `B1-PAPER-03` | — | e2e/block1-offchain/whitepaper/page.test.mjs | automated |
| `B1-PAPER-04` | — | e2e/block1-offchain/whitepaper/page.test.mjs | automated |
| `B1-PAPER-05` | — | e2e/block1-offchain/whitepaper/page.test.mjs | automated |
| `B1-PAPER-06` | — | e2e/block1-offchain/whitepaper/page.test.mjs | automated |
| `B1-LOBBY-01` | server/scripts/e2e-lobby.mjs | e2e/block1-offchain/lobby/page.test.mjs | automated |
| `B1-LOBBY-02` | server/scripts/e2e-lobby.mjs | e2e/block1-offchain/lobby/page.test.mjs | automated |
| `B1-LOBBY-03` | server/scripts/e2e-live-board.mjs | e2e/block1-offchain/lobby/page.test.mjs | automated |
| `B1-LOBBY-04` | server/scripts/e2e-replay.mjs | e2e/block1-offchain/lobby/page.test.mjs | automated |
| `B1-LOBBY-05` | — | e2e/block1-offchain/lobby/page.test.mjs | automated |
| `B1-LOBBY-06` | — | e2e/block1-offchain/lobby/page.test.mjs | automated |
| `B1-LOBBY-07` | — | e2e/block1-offchain/lobby/page.test.mjs | automated |
| `B1-LOBBY-08` | — | e2e/block1-offchain/lobby/page.test.mjs | automated |
| `B1-LOBBY-09` | — | e2e/block1-offchain/lobby/page.test.mjs | automated |
| `B1-LOBBY-10` | server/test/scenarios/lobby.scenarios.ts | e2e/block1-offchain/lobby/page.test.mjs | automated |
| `B1-LOBBY-11` | server/test/scenarios/promos.scenarios.ts | e2e/block1-offchain/lobby/page.test.mjs | mock |
| `B1-LOBBY-12` | server/test/scenarios/agreements.scenarios.ts | e2e/block1-offchain/lobby/page.test.mjs | automated |
| `B1-LOBBY-13` | client/test/referral.test.mjs | e2e/block1-offchain/lobby/page.test.mjs | automated |
| `B1-LOBBY-14` | client/test/referral.test.mjs | e2e/block1-offchain/lobby/page.test.mjs | automated |
| `B1-LOBBY-15` | server/test/scenarios/free-rides.scenarios.ts | e2e/block1-offchain/lobby/leave.test.mjs | automated |
| `B1-LOBBY-16` | server/test/scenarios/free-levels.scenarios.ts | e2e/block1-offchain/lobby/page.test.mjs | automated |
| `B1-LOBBY-17` | — | e2e/block1-offchain/lobby/page.test.mjs | automated |
| `B1-LOBBY-18` | — | e2e/block1-offchain/lobby/signout.test.mjs | automated |
| `B1-LOBBY-19` | — | e2e/block1-offchain/lobby/receipt.test.mjs | automated |
| `B1-LOBBY-20` | — | e2e/block1-offchain/lobby/receipt.test.mjs | automated |
| `B1-LOBBY-21` | server/scripts/e2e-watch.mjs | e2e/block1-offchain/lobby/receipt.test.mjs | automated |
| `B1-LOBBY-22` | server/scripts/e2e-blinks.mjs | e2e/block1-offchain/lobby/blink.test.mjs | mock |
| `B1-LOBBY-23` | — | e2e/block1-offchain/lobby/blink.test.mjs | mock |
| `B1-FREE-01` | docs/agents/free-rides.md | e2e/block1-offchain/free/paths.test.mjs | automated |
| `B1-FREE-02` | client/js/ui/game.js | e2e/block1-offchain/free/paths.test.mjs | automated |
| `B1-FREE-03` | server/test/scenarios/free-levels.scenarios.ts | e2e/block1-offchain/free/paths.test.mjs | automated |
| `B1-FREE-04` | server/test/scenarios/free-levels.scenarios.ts | e2e/block1-offchain/free/paths.test.mjs | automated |
| `B1-FREE-05` | server/test/scenarios/free-levels.scenarios.ts | e2e/block1-offchain/free/paths.test.mjs | automated |
| `B1-FREE-06` | server/test/scenarios/free-rides.scenarios.ts | e2e/block1-offchain/free/paths.test.mjs | automated |
| `B1-FREE-07` | server/test/scenarios/free-rides.scenarios.ts | e2e/block1-offchain/free/paths.test.mjs | automated |
| `B1-FREE-10` | — | e2e/block1-offchain/free/unmerged.test.mjs | unmerged |
| `B1-FREE-11` | — | e2e/block1-offchain/free/unmerged.test.mjs | unmerged |
| `B1-FREE-13` | — | e2e/block1-offchain/free/unmerged.test.mjs | unmerged |
| `B1-API-05` | server/test/scenarios/free-levels.scenarios.ts | e2e/block1-offchain/api/rides.test.mjs | automated |
| `B1-API-06` | server/test/scenarios/free-levels.scenarios.ts | e2e/block1-offchain/api/rides.test.mjs | automated |
| `B1-API-07` | server/test/scenarios/free-levels.scenarios.ts | e2e/block1-offchain/api/rides.test.mjs | automated |
| `B1-API-08` | server/test/scenarios/free-levels.scenarios.ts | e2e/block1-offchain/api/rides.test.mjs | automated |
| `B1-API-09` | server/test/scenarios/free-levels.scenarios.ts | e2e/block1-offchain/api/rides.test.mjs | automated |
| `B1-PROMO-01` | server/test/scenarios/promos.scenarios.ts | e2e/block1-offchain/api/promo.test.mjs | mock |
| `B1-PROMO-02` | server/scripts/e2e-promo.mjs | e2e/block1-offchain/api/promo.test.mjs | automated |
| `B1-PROMO-03` | server/test/scenarios/promos.scenarios.ts | e2e/block1-offchain/api/promo.test.mjs | automated |
| `B1-PROMO-04` | server/test/scenarios/promos-abuse.scenarios.ts | e2e/block1-offchain/api/promo.test.mjs | automated |
| `B1-PROMO-05` | — | e2e/block1-offchain/free/unmerged.test.mjs | unmerged |
| `B1-REF-01` | server/test/scenarios/referrals.scenarios.ts | e2e/block1-offchain/api/referral.test.mjs | mock |
| `B1-REF-02` | server/test/scenarios/referrals.scenarios.ts | e2e/block1-offchain/api/referral.test.mjs | automated |
| `B1-REF-03` | client/test/referral.test.mjs | e2e/block1-offchain/api/referral.test.mjs | automated |
| `B1-REF-04` | server/test/unit/application/services/referral.service.spec.ts | e2e/block1-offchain/api/referral.test.mjs | pending |
| `B1-BOARD-01` | — | e2e/block1-offchain/free/unmerged.test.mjs | unmerged |
| `B1-HONK-01` | — | e2e/block1-offchain/free/unmerged.test.mjs | unmerged |
| `B1-ADMIN-01` | server/scripts/e2e-admin.mjs | e2e/block1-offchain/admin/signin.test.mjs | automated |
| `B1-ADMIN-02` | — | e2e/block1-offchain/admin/signin.test.mjs | automated |
| `B1-ADMIN-03` | server/test/scenarios/admin.scenarios.ts | e2e/block1-offchain/admin/tabs.test.mjs | automated |
| `B1-ADMIN-04` | server/scripts/e2e-admin.mjs | e2e/block1-offchain/admin/tabs.test.mjs | automated |
| `B1-ADMIN-05` | — | e2e/block1-offchain/admin/tabs.test.mjs | automated |
| `B1-ADMIN-06` | — | e2e/block1-offchain/admin/tabs.test.mjs | automated |
| `B1-ADMIN-07` | — | e2e/block1-offchain/admin/tabs.test.mjs | automated |
| `B1-ADMIN-08` | — | e2e/block1-offchain/admin/tabs.test.mjs | automated |
| `B1-ADMIN-09` | — | e2e/block1-offchain/admin/tabs.test.mjs | automated |
| `B1-ADMIN-10` | — | e2e/block1-offchain/admin/tabs.test.mjs | automated |
| `B1-ADMIN-11` | — | e2e/block1-offchain/admin/tabs.test.mjs | automated |
| `B1-ADMIN-12` | server/scripts/e2e-promo.mjs | e2e/block1-offchain/admin/tabs.test.mjs | automated |
| `B1-ADMIN-13` | — | e2e/block1-offchain/admin/tabs.test.mjs | automated |
| `B1-ADMIN-14` | — | e2e/block1-offchain/admin/tabs.test.mjs | automated |
| `B1-ADMIN-15` | — | e2e/block1-offchain/admin/tabs.test.mjs | automated |
| `B1-ADMIN-16` | — | e2e/block1-offchain/admin/tabs.test.mjs | automated |
| `B1-ADMIN-17` | — | e2e/block1-offchain/admin/tabs.test.mjs | automated |
| `B1-ADMIN-18` | — | e2e/block1-offchain/admin/tabs.test.mjs | automated |
| `B1-API-01` | server/test/http/flows.spec.ts | e2e/block1-offchain/api/health-session.test.mjs | automated |
| `B1-API-02` | — | e2e/block1-offchain/api/health-session.test.mjs | automated |
| `B1-API-03` | server/test/scenarios/flow.scenarios.ts | e2e/block1-offchain/api/health-session.test.mjs | mock |
| `B1-API-04` | server/test/scenarios/free-rides.scenarios.ts | e2e/block1-offchain/api/health-session.test.mjs | automated |
| `B1-API-10` | — | e2e/block1-offchain/api/health-session.test.mjs | automated |
| `B1-API-12` | server/scripts/e2e-admin.mjs | e2e/block1-offchain/api/admin.test.mjs | mock |
| `B1-API-13` | server/test/scenarios/admin.scenarios.ts | e2e/block1-offchain/api/admin.test.mjs | automated |
| `B1-API-14` | server/test/integration/admin-settings.integration.spec.ts | e2e/block1-offchain/api/admin.test.mjs | automated |
| `M-01` | — | — | manual |
| `M-02` | — | — | manual |
| `M-03` | — | — | manual |
| `M-04` | — | — | manual |
| `M-05` | — | — | manual |
| `M-06` | — | — | manual |
| `M-07` | — | — | manual |
| `M-08` | — | — | manual |
| `M-09` | — | — | manual |
| `M-10` | — | — | manual |
| `B2-LAND-01` | landing/test/pools.test.js | e2e/block2-chain/landing/page.test.mjs | automated |
| `B2-LAND-02` | — | e2e/block2-chain/landing/page.test.mjs | mock |
| `B2-DECK-01` | — | e2e/block2-chain/pitchdeck/page.test.mjs | automated |
| `B2-PAPER-01` | — | e2e/block2-chain/whitepaper/page.test.mjs | automated |
| `B2-LOBBY-01` | server/scripts/e2e-lobby.mjs | e2e/block2-chain/lobby/page.test.mjs | automated |
| `B2-LOBBY-02` | — | e2e/block2-chain/lobby/leave.test.mjs | automated |
| `B2-LOBBY-03` | — | e2e/block2-chain/lobby/page.test.mjs | automated |
| `B2-FREE-01` | — | e2e/block2-chain/free/paths.test.mjs | automated |
| `B2-PROMO-01` | server/test/scenarios/promos.scenarios.ts | e2e/block2-chain/promo/schema.test.mjs | automated |
| `B2-PROMO-02` | server/scripts/e2e-localnet.mjs | e2e/block2-chain/promo/schema.test.mjs | pending |
| `B2-REF-01` | server/test/scenarios/referrals.scenarios.ts | e2e/block2-chain/referral/rules.test.mjs | mock |
| `B2-REF-02` | programs/freightchain-pools | e2e/block2-chain/referral/rules.test.mjs | automated |
| `B2-ADMIN-01` | — | e2e/block2-chain/admin/pools.test.mjs | automated |
| `B2-ADMIN-02` | — | e2e/block2-chain/admin/pools.test.mjs | automated |
| `B2-ADMIN-03` | server/scripts/pool-admin.mjs | e2e/block2-chain/admin/pools.test.mjs | automated |
| `B2-ADMIN-04` | server/scripts/pool-admin.mjs | e2e/block2-chain/admin/pools.test.mjs | pending |
| `B2-API-01` | — | e2e/block2-chain/api/chain.test.mjs | automated |
| `B2-API-02` | .claude/skills/honk-localnet/run.sh | e2e/block2-chain/api/chain.test.mjs | automated |
| `B2-API-03` | server/test/scenarios/chain.scenarios.ts | e2e/block2-chain/api/chain.test.mjs | automated |
| `B2-API-04` | server/test/scenarios/pools.scenarios.ts | e2e/block2-chain/api/chain.test.mjs | automated |
| `B2-API-05` | .claude/skills/localnet-e2e/run.sh | e2e/block2-chain/api/chain.test.mjs | automated |
| `B2-API-06` | server/scripts/e2e-localnet-payout.mjs | e2e/block2-chain/api/chain.test.mjs | pending |
| `B2-API-07` | .claude/skills/honk-suite/run.sh | e2e/block2-chain/api/chain.test.mjs | pending |
| `B2-POOL-01` | programs/freightchain-pools/idl/freightchain_pools.json | e2e/block2-chain/api/chain.test.mjs | automated |
| `B2-POOL-02` | — | e2e/block2-chain/api/chain.test.mjs | automated |
| `B2-HONK-01` | docs/agents/honk.md | e2e/block2-chain/honk/ledger.test.mjs | automated |
| `B2-HONK-02` | .claude/skills/honk-suite/run.sh | e2e/block2-chain/honk/ledger.test.mjs | pending |

## (d) Gaps in the existing tests

- HTTP referral scenarios stop at bind and gift. They do not assert the free-ride grant after a verified MEDIUM ride. The unit spec does.
- `docs/promocodes.md` still says the feature lives on an undeployed branch. Promo create and redeem are on main.
- `docs/agents/verifying.md` records that `e2e-tickets-stub` RETRY CONFIRM and the stub's missing `/reconcile` route fail on main (2026-10-13).
- `set_pool_rules` has no admin HTTP route. Operators use the CLI.
- The existing compose file has no Solana service. Localnet uses a host `solana-test-validator`. This suite does the same and does not pull a validator image.
- Chrome scripts (`server/scripts/e2e-*.mjs`, `client/tools/e2e-chrome.mjs`, `landing/tools/e2e-wallet.mjs`) are the browser pass. This suite does not call them.
- Ticket rent `close_ticket` and seed-treasury rollover stay manual in the localnet skill.

## Existing tests this suite reuses

Server HTTP scenarios registered from `server/test/http/flows.spec.ts`: `flow`, `http-contract`, `telemetry`, `live`, `verdict`, `traffic-proof`, `admin`, `editor`, `editor-jobs`, `payments`, `lobby`, `stats`, `guide`, `free-levels`, `free-rides`, `pools`, `pledges`, `shared-road`, `promos`, `promos-abuse`, `ticket-orders`, `chain`, `webhook`, `analytics`, `agreements`, `actions`, `referrals` (files in `server/test/scenarios/`).

Other HTTP specs: `server/test/http/editor-host.spec.ts`, `rate-limit.spec.ts`, `admin-host.spec.ts`, `cors.spec.ts`, `editor-ai.spec.ts`.

PostgreSQL integration: 48 specs under `server/test/integration/` (repositories, concurrency, migrations, admin settings, redis throttler, flows).

Chrome / node scripts (not invoked here): `server/scripts/e2e-browser.mjs`, `e2e-lobby.mjs`, `e2e-admin.mjs`, `e2e-promo.mjs`, `e2e-localnet.mjs`, `e2e-localnet-payout.mjs`, `e2e-localnet-day.mjs`, `e2e-localnet-chaos.mjs`, `e2e-honk-chain.mjs`, `e2e-honk-verdict.mjs`, `e2e-tickets-stub.mjs`, `e2e-watch.mjs`, `e2e-replay.mjs`, `e2e-live-board.mjs`, `e2e-live-flags.mjs`, `e2e-blinks.mjs`, `e2e-verified-play.mjs`, `e2e-verified-deep.mjs`, `e2e-editor.mjs`, `e2e-editor-worker.mjs`, `e2e-close.mjs`, `e2e-stats.mjs`, `e2e-road-check.mjs`, `e2e-traffic-proof.mjs`, plus `client/tools/e2e-chrome.mjs`, `client/tools/e2e-viewer.mjs`, `landing/tools/e2e-wallet.mjs`.

Landing unit: `landing/test/*.test.js` (page, pools, promos, whitepaper, pitchdeck-analytics, pitchdeck-coins, pitchdeck-tilt, and the rest of that folder).

Program: `npm run program:test` (LiteSVM / cargo) and `npm run program:verify`. Skills: `localnet-e2e`, `honk-localnet`, `honk-suite`.

## Bugs noticed while reading (not fixed)

1. The three free-path names in the request do not match main. Guest API and the weekly ticket are PR #3.
2. `paintHero` throws if `/api/pool` is 200 without `split` when `pools` is empty. It also throws if live JSON lacks `totals`, `upcoming`, or `recent`.
3. `lobby.js` rewrites every `/play.html` link to `?offline=1`, including while signed in. Online free start is the lobby START button.
4. Cosmetic promo redeem is refused `visuals_are_honk`.
5. With `HONK_PROGRAM_ID` unset, `GET /api/honk` returns `chain: null` (ledger only).
6. `docs/promocodes.md` describes promos as undeployed. The routes are on main.
7. No admin HTTP handler for `set_pool_rules`.
8. Referral HTTP scenarios never assert the qualify grant.
9. `e2e-tickets-stub` RETRY CONFIRM and a missing `/reconcile` route fail on main (already noted in `docs/agents/verifying.md`).
