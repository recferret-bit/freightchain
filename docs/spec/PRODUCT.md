# Product — as built

This file describes the code in this checkout. Agent how-to stays in `docs/agents/`. Target rules stay in the other `docs/spec/` files and in [`DECISIONS.md`](DECISIONS.md). If this file and the code disagree, this file is wrong.

Status words: **shipped** (in the code), **local** (built, not deployed to devnet), **target** (a decision, not in the code).

## How to read a conflict

The Conflicts table is the list the owner still has to pick. A row that says Closed is decided. Tests lock the shipped column. Do not implement the target column as a drive-by.

## Conflicts (shipped behavior vs decisions 1–66)

| Topic | Shipped | Target decision | Do not |
|---|---|---|---|
| Live watch | A running ride is `404 replay_not_available` on watch and `/road`, including for the driver. Finished free rides stay in replays. | 18, 46, 55: no live watch of a ride in progress. Training rides are not in replays (56). | Delete `e2e-watch.mjs`, `e2e-live-board.mjs`, or the live board. Decision 68 keeps those tests. |
| Spectator effects | A non-tip donation effect is `400` with code `donation_effect`. Night, day, and holes are that `400`, not a `404`. Production compose is `LIVE_EFFECTS=free`. `POST watch/:id/honk/time` and `POST watch/:id/honk/weather` throw `NotFoundError` (`404` `not_found`) before any TEN4 debit. The burn under that throw does not run. A paid tip that misses the window is still a tip. | 33, 45, 49: donations and tips never change a ride, a result, or a prize. Remove HONK time and weather effects. | Strip the burn path until that decision is its own change. |
| Referral donation share | Qualified invite: `referral_donation_share_bps` 1000 (10%) to the referrer, cap 0.5 SOL. Below rent, the whole tip goes to the driver. | 50: the share is 0 and the `also` branch is removed. | Zero the setting inside a test PR. |
| Paid tiers | New creates accept only `free` and `1h`. `POST` of `4h` or `8h` is `400 tier_retired`. 1h with no pool, promo, or grant is `409 tier_not_on_sale`. 4h and 8h grants default off. | 17 | Do not restore `tier_not_on_sale` for 4h/8h, and do not emit both codes. |
| Finish line | A new full-length 1h ride stores `completeDist = finishFor(roadSeed, trip, 1)` at 65 km/h, clamped to 48–65 km and snapped off junctions, forks, and holes. Shorter 1h rides and free rides keep `K × MAX_SPEED × nominal seconds`. The server completes the ride when stored `lastS` reaches that distance. A 1h ride still running 5400 s after `startedAt` ends `failed` / `timeout`. New ride creation accepts only `free` and `1h`. `4h` and `8h` are `400 tier_retired`. Historical rows stay. | 38–44, RID-M-03. | Swap the finish formula in place. A retune is a new trip id. Do not bump `SUMMARY_VERSION` or `WORLD_FACTS_VERSION`. |
| Replay rate | Closed by decision 69 (24.10.2026). `ReplayEngine` stays 10 Hz with two substeps. `stepAt30Hz` is not the live judge. | 12 is not adopted for the live pipeline. | Present 30 Hz as the current pipeline, or retune `REPLAY_SIM_HZ`. |
| Pool calendar | Only the 1h tier has `saleHours` 24 / `playHours` 3 / `reviewHours` 48. The legacy transfer round is UTC Monday to Monday. v5 can store a split and deadlines. It does not open "Tuesday evening to Sunday evening" by itself. | Pool manifesto: one pool a week, sales stop 2 hours before close, last start is close minus 1 h 15 min, then 1.5 days of review. | Pretend the Tuesday clock is what the crank does today. |
| `set_pool_rules` | Closed by decision 70 (24.10.2026). No admin HTTP route. `pool-admin.mjs set-pool-rules` sends it. On mainnet, Squads. | Backend decision 8 and the old `POOL-M-12` HTTP route are withdrawn. | Add `POST /api/admin/pools/:id/rules`. |
| Minigames | In this checkout, default `MINIGAMES=off` (null commit, nothing issued). When the mode is not off, only `phone-sms` is issued. GULP and PIKE are local cab tasks. | 14, 19–22 and Appendix A of `minigames.md`: a 15-id catalog, parking pockets, noisy PNGs, +45 s skips. | Build Appendix A, or turn the default on without saying so. |
| `RideResult` | Statistics are running totals (`PlayerStats`, `GlobalStats`, `DailyStats`). A judged ride writes a `stats.RideResult` row. | RID-M-12 and RID-M-17. | State a public score formula in this file. |
| Lobby language | EN and RU copy is in `frontend/client/site/i18n.js`. English is the fallback. | 58: English and Russian from the first public day. | Machine-translate the lobby as part of coverage. |
| Admin power | Three allowlists: `ADMIN_WALLETS`, `MODERATOR_WALLETS`, `EDITOR_WALLETS`. `ADMIN_SESSION_TTL_MINUTES` defaults to 60 and `EnvService.adminSessionTtlMinutes` caps it at 60. `JoseAdminTokenSigner` caps the token at 3600 seconds. Logout writes `revoked:jti:<jti>`. | 59–66: Telegram alerts, default-deny, IP allowlist on mainnet. | Treat the security manifesto as the current guard. |
| Pledges | Routes exist: create, confirm, attest, settle, refund, watch UI. `PLEDGES_ENABLED` defaults to `0`. `PledgeService` throws `ForbiddenError` `pledges_disabled` when pledges are not enabled, so create and confirm return `403 pledges_disabled`. | 51's later rule: a pledge only before the start, settlement after the pool review. Not this default. | Delete the routes, or say the feature was removed. |
| Program deploy | Pools v5 is built (`8500/500/1000`, `paid_tickets_enabled`, no on-chain referral leg; still contains legacy `STATUS_OPEN` / `min_tickets >= 1` / `fail_pool`). Devnet still runs pools v3. TEN4's program is local only. The PostgreSQL ledger is the TEN4 balance. | Operator-funded pools (> 50% base `F = B + S`, optional < 50% paid extra attempts) run without a minimum-ticket sale gate, and paid tickets are final and non-refundable once bought (v6 opens pools in `STATUS_ACTIVE` without `fail_pool`). | Deploy, or tell a player that devnet is v5. |

## Surfaces

### Sign-in, guest, SNS, phone

**Shipped.** `POST /api/auth/nonce` and `POST /api/auth/verify` open `fc_session`. `POST /api/auth/guest` opens a throwaway wallet that may play EASY only (`409 guest_easy_only` for MEDIUM, HARD, a promo, or a paid tier). Progress does not merge into a later wallet. SNS: `GET /api/sns/resolve` and `GET /api/sns/reverse`. Phone session pairing is shipped: the desktop `POST /api/auth/pair` opens a code, the phone `POST /api/auth/pair/:id/claim` after it has signed in, and the desktop `GET /api/auth/pair/:id` adopts that session. The QR and the extension popup are still manual (`docs/testing/MANUAL_TESTS.md`). WalletConnect is not used.

Gap: guest and both SNS routes have no HTTP scenario. Phone-pair HTTP is already in `flow.scenarios.ts`. A real Chrome guest session is still open. See [`../testing/COVERAGE_CONTRACT.md`](../testing/COVERAGE_CONTRACT.md).

### Free levels, tutorial, assist

**Shipped.** [`docs/spec/rides.md`](rides.md).

- EASY level 1, trip `free-1c`, nominal 3 min, Stuart Highway.
- MEDIUM level 2, trip `free-2c`, nominal 5 min, Route 66.
- HARD level 3, trip `free-3c`, nominal 30 min, Brenner. Assist and tutorial are refused (`409`).
- Frozen trips (`free`, `free-1`, `free-2`, `free-3`, `free-1b`, `free-2b`, `free-3b`) still replay. They rank on no board.
- `free-g` is the `?sim=1` tool sim. It is never stamped on a ride. `?offline=1` is retired. Bare `play.html` orders EASY.
- Training does not spend `freeRides`. The stored counter and the settings `free_on_signup` (10) and `free_rides_daily_max` (5) remain. The daily grant scheduler is not registered.
- Tutorial and assist are EASY and MEDIUM only. HARD returns `409 tutorial_not_allowed` or `409 assist_not_allowed`. A paid tier refuses both.
- A free ride ends itself at the line. One free leaderboard per level.

### Weekly granted ticket and the prize board

**Shipped, with a draft contest.** 4h and 8h grants default off (`weekly_ticket_4h_enabled` and `weekly_ticket_8h_enabled` are 0).

A live 1h grant is issued only inside the ranked week (Monday 00:00 UTC through Sunday 12:00 UTC) to a non-guest who is 18+ and in an allowed country. A missing, `XX`, or `T1` country is `409 ranked_ineligible` unless `NODE_ENV` is `development` or `test`, where `PRIZE_DEV_DEFAULT_COUNTRY` (default `US`) fills it in. A real country code is never replaced. The server unit and integration suites set that default to `KP` so a missing header stays ineligible. It expires at the next interval or Sunday 12:00 UTC, whichever is earlier. An unspent 1h ride promo is claimed first: that POST creates a promo ride and leaves the grant unspent. With no promo, the first `POST /api/rides { tier: '1h' }` creates an unranked ride and spends the grant. A second `POST` while that ride is still `created` returns the same ride. `409 weekly_ticket_spent` is the lost-claim race, not the ordinary second order. After the grant ride has ended, another 1h with no pool and no promo is `409 tier_not_on_sale`. The grant does not mint TEN4. It can be watched. It consumes one of the five paid ranked slots only when `POST /api/rides/:id/start` sends `{ ranked: true }`.

`GET /api/prize/board` ranks ended rides that started ranked. The USDC contest in `docs/spec/pool.md` (Appendix C) is a draft. No USDC is sent. Spectator road effects are refused on ranked rides. Both profile stamps (`age18` and the loss acknowledgement) are required before a bought paid ride or a blink shift buy (`409 agreements_required`). A promo and a weekly grant skip that check.

### Paid rides, tickets, Solana Pay, blinks

**Shipped for transfer mode. Program mode is built and not what devnet runs.**

- `PAYMENT_MODE=transfer`: a payment row per paid entry. No draw and no on-chain payout on that path.
- `PAYMENT_MODE=program`: a paid tier needs a live pool. The wallet signs and sends. The server credits tickets from program events (confirm, watcher, webhook).
- Solana Pay: `GET` and `POST /api/solana-pay/{rides|orders|donations}/:id`. CORS `*` on that prefix only. The lobby QR is a `solana:` URL. Reconcile uses the reference key.
- Blinks: `/actions.json` (and `/.well-known/actions.json`, rewritten onto it) and `/api/actions/*` are public, with CORS `*` on those paths only. The shift buy is one program-mode ticket and needs both profile stamps. Hello, site links, and ride links do not.
- A ticket ride uses the pool's road seed. One pool, one road.

### Escrow program

**Local v5, devnet v3.** [`docs/spec/pool.md`](pool.md). A pool exposes `opensAt`, `salesCloseAt`, `lastStartAt` (play close minus 75 minutes, or play close when that instant is before the pool opened), `playCloseAt`, and `validationUntil` on `GET /api/pools/current` and `GET /api/pools/:id`. A buy or a start after `lastStartAt` is `409 pool_last_start_passed`, and an unused ticket burns. The lobby purchase requires `burnWarningAccepted: true`. `POST /api/rides/:id/appeal` is open until `validationUntil`. Paying winners waits for that instant, no running rides, and zero open appeals. `set_pool_rules` stays the admin CLI. The on-disk program layout is unchanged. Default split for a new v5 pool is 85% / 5% / 10% (`8500/500/1000`). `max_player_share_bps` default 4740, program ceiling 4999. `paid_tickets_enabled` can be off. No on-chain referral leg. `seal_road`, winners root, per-ride attestations, sponsor refunds, and pledges are in the built program. `PLEDGES_ENABLED` defaults to `0`. Pledge create and confirm then return `403 pledges_disabled`. The HTTP harness sets it to `1`. With pledges on, `POST /api/pledges/:id/confirm` for a wallet that is not the sponsor returns the same `404` `not_found` as a missing pledge. The crank and the payout key are the server's only two keys. The cold admin can veto a root. Admin, moderator, and editor are three allowlists. A privileged route without its session is refused. An admin session lasts at most 60 minutes. `ADMIN_APPROVAL_MODE` defaults to `single`. Money stays in the program.

### TEN4

**Ledger shipped. Program local.** [`docs/spec/ten4.md`](ten4.md), [`docs/agents/ten4-localnet.md`](../agents/ten4-localnet.md).

Ticker TEN4. Routes, tables, the crate, and `HONK_PROGRAM_ID` stay HONK. HONK is the chat verb. Supply 100,000,000. SOL still prices the ticket. TEN4 is reserved when a paid ride's verdict is verified. Until TGE the balance is PostgreSQL and the UI says points. New rides are `free` or `1h`. Era-1 finishes that already exist: 1h 100, 4h 500, 8h 1,200. An 8h mint waits 48 hours. Burns: 1 chat HONK, 10 day/night, 25 snow or clear. Cab parts 65 / 260. The local program is not deployed. There is no AMM on devnet.

`GET /api/honk` can return `chain: null` when `HONK_PROGRAM_ID` is unset. That is the block-1 configuration, not a broken route.

### Garage and promo

**Shipped.** [`docs/spec/ten4.md`](ten4.md), [`docs/spec/promocodes.md`](promocodes.md). Nine slots, 48 non-default parts: 45 TEN4 parts and three referral gift paints. Apply is `POST /api/garage/loadout`, all or nothing.

A promo code is one ride shift (1h, 4h, or 8h, once per wallet, no TEN4) or pool tickets. `kind: 'free_rides'` is retired. `kind: 'cosmetic'` is `409 visuals_are_honk`. Old cosmetic unlocks still equip. Admin create and disable are wallet-signed and audited.

### Referrals

**Shipped.** [`docs/spec/referral.md`](referral.md).

One code and one referrer per wallet, bound before any ride has `startedAt`. Codes are 8 characters. Gifts: `convoy`, `signal`, `amber`. Capacity is `min(30, 3 + 3 × floor(verified paid shifts / 5))`. A pending invite lasts 14 days. The first verified completion of any ride, including EASY, qualifies the invite and unlocks the gift paint. The 2 and 3 free rides are granted only when that first completion is a verified MEDIUM (`free-2c`), within 7 days of the bind, and the referrer is under the weekly cap of 10. A later MEDIUM does not grant them. Convoy badges are 1 / 5 / 20 / 100 (a paid shift, or HARD with assist off). v5 has no on-chain pot leg. Donation share, when the driver's invite is qualified: 1000 bps (10%) to the referrer, lifetime cap 0.5 SOL for the pair. The whole tip goes to the driver when the share is below rent (890_880 lamports), the driver would receive nothing, or the spectator is the referrer. That is the shipped rule, not decision 50.

A second convoy machine sits beside that gift and does not replace it. `POST /api/referrals/convoy/bind` starts a pending row for 72 hours. A verified MEDIUM or HARD ride (`free-2c` / `free-3c`) activates it for 60 days and can credit the invitee one promo ride, under caps of 3 per UTC day, 10 per ISO week, and 500 per ISO week. M1 is 100 TEN4 on the ledger after 2 ISO weeks. M2 is 50 TEN4 after 5. Neither is a chain mint. `GET /api/referrals/leaderboard` returns 25 rows. `PATCH /api/me/privacy` takes `{ convoyHidden }`. The column is not on the player row until the Wave 4 migration, and until then the answer is `column: 'missing'`. Pre-season airdrop routes are `GET /api/airdrop/status`, `POST /api/airdrop/verify-telegram`, `POST /api/airdrop/verify-x`, and `POST /api/airdrop/claim`. A verified MEDIUM or HARD ride opens the social steps. The X adapter does not call the network. Turnstile stays off unless a secret is set. Claim settlement is `ledger`. Convoy and airdrop rows are process-local until that migration is applied. A saved verdict calls both machines after the legacy gift.

44 earnable badges plus legacy `top-20` in [`docs/spec/web3_solana.md`](web3_solana.md).

### Achievements

**Shipped, mint off unless the three env keys and the URI map are set.** 44 badges plus legacy `top-20` (never earned, never minted). Ids are frozen. Unlocks are append-only. The cNFT mint is a separate outbox, its own key, after a delay, and it skips a rejected ride and a guest wallet. A weekly grant counts as a paid shift and does not count as a TEN4 mint. `nft-metadata-uris.ts` is not covered by a unit test that walks every id.

### Ride lifecycle

**Shipped.** Order, start, heartbeat, batches, end. A ride silent for `HB_TIMEOUT_MS` (150 s) is ended by the sweeper. Closing the game tab beacons `/end`. Closing a site page sends `leave=1`. Finish is the distance line. `RIDE_MIN_SECONDS` is the nominal length (test 300, production 1800). Route and start hour are the server's. Trip ids are frozen once rides carry them.

### Verified play

**Shipped, production in shadow mode.** [`docs/spec/anticheat.md`](anticheat.md).

10 Hz samples, hash-chained batches, rules v7, traffic-frame proof required for new starts. The server rebuilds the road and the holes. Verdicts are `verified`, `flagged`, `rejected`. `VERDICT_ENFORCE=false` is the production default: judged and shown, boards and badges ignore a reject. The code default for tests is `true`. Machine-rejected paid rides stay under review until an admin decides. The live replay stays 10 Hz and rules v7 (decision 69, 24.10.2026). `TELEMETRY_V21` defaults to `off` and also accepts `shadow` and `enforce`. `shadow` issues a per-ride session key on start and checks an HMAC when a batch says `protocol: 2`. The v1 hash chain still accepts a batch with no protocol. `enforce` requires the named deflate streams `inp`, `clk`, `chk`, `mg`, and `env`, checks `HMAC-SHA256(sessionKey, rideId ‖ seq ‖ startTick ‖ endTick ‖ sha256(inp) ‖ sha256(chk))` before inflate, steps that input at `dt = 1/30`, and returns the re-derivable traffic and hole salts on start. A bad MAC is `400 batch-mac-invalid`. Enforce compares the client's `worldDigest32` with `worldDigest32` of the holes, junctions, and traffic spawned within ±300 m. A mismatch that lasts at least 10 seconds after three points in a row rejects; a shorter mismatch flags. `pauseVerdict` and `slowMotionVerdict`: mode `off` adds no reasons; `shadow` flags; `enforce` rejects. Humanness features F1–F10 score 0–100. The five physical-impossibility cases reject in that classifier; a borderline score or `isTrusted=false` is `flagged_for_review`. The top 20 verified rides by distance, while that pool's validation window is still open, are compared. A similar pair raises a `trace-cluster` alert and those rides are flagged for admin review. A copied trace of 50 or more intervals rejects the ride. Raw `inp` older than 90 days is eligible for deletion only after that pool's payout is finalized. `trustScore` starts at 60 and moves on login, a verified ride, a rejected ride, and a social bind. It does not store a browser fingerprint. Convoy M1/M2 and airdrop TEN4 ledger credits wait 48 hours and release only when both wallets are still at least 50 with no rejected rides. A player write whose terms or privacy version is missing or older is `403 terms_acceptance_required`. The key is not on GET or heartbeat. It is stored on the ride row in the clear. Heartbeats count pauses. In `shadow`, a fourth pause, more than five minutes paused, or a sustained game/wall ratio below 0.9 adds a flag (`pause-limit`, `pause-time`, `time-dilation`) and does not reject the ride. The same start stores salt commitments the road rebuild does not read. A `protocol: 2` batch may carry deflate streams; the MAC is checked first, and a bad or oversized stream is refused. `stepAt30Hz` is not the live replay rate. Phone minigames are in the server and the cab, and stay off unless `MINIGAMES` is `shadow` or `enforce` ([`minigames.md`](minigames.md) Part 1). `trustScore` is not a device fingerprint and it does not implement the Appendix D point table ([`docs/spec/anticheat.md`](anticheat.md)).

### Statistics

**Shipped.** [`docs/spec/platform_services.md`](platform_services.md). Running totals, written by `StatsService` on every end path and every donation, player lock first. Crash counts are client-reported and not judged. Reads are cached. A judged ride writes a `stats.RideResult` row (`VerdictService` calls `rideResults.upsert`).

### Live board, watch, chat, donations, replays

**Shipped.** [`docs/spec/replays_streams.md`](replays_streams.md).

`GET /api/live` is heartbeats plus soft online counts and returns no running rides. `GET /api/replays` lists finished 1h rides. Training rides (free, guest, assist, tutorial) stay off public replays, watch, receipts, and blinks. A running ride is `404 replay_not_available` on watch and `/road`. A pool ride stays locked until `payoutAt`, except the owner on watch. `GET /api/rides/:id/replays` for another wallet returns the same `404` `not_found` as a missing ride. Watch polls. There is no WebSocket. Public watch samples zero the input column. Donations are replay-only SOL tips, `kind: 'tip'`, from 0.001 to 1 SOL, default 0.01, expiring in 15 minutes, at most 3 open orders, split 95/5 to the driver and the treasury. A tip on your own ride is `400 own_ride`. A non-tip donation effect is `400` with code `donation_effect`. Night, day, and holes are that `400`, not a `404`. `POST watch/:id/honk/time` and `POST watch/:id/honk/weather` throw `NotFoundError` (`404` `not_found`) before any TEN4 debit. The burn under that throw does not run. `GET /api/me/donations` lists sent and received tips. Replay draws the recording. It does not run the sim. Sample columns are append-only. Input bits are frozen.

The replay panel plays and pauses, runs at 0.5×, 1×, 2×, and 4×, scrubs, jumps ±10 seconds, and switches cabin, chase, and hood. It has fullscreen, damage, honk, and minigame marks, volume and mute, a `?t=` share link, and a speed and damage chart. Tip buttons are 0.01, 0.05, and 0.1 SOL. Chat on a finished replay stores `replayT` in the existing applied columns. A line is at most 200 characters. Links and banned words are rejected. The cap is 5 messages per 60 seconds. A moderator can hide a line. A banned wallet gets `403 chat_banned`. Messages older than 90 days are deleted. Tips stay. EN and RU copy is in `frontend/client/site/i18n.js`. The language is `?lang`, then `fc_lang`, then `freightchain.lang`, then the browser, then English.

The watch and donation sentences above are the shipped cells of the live-watch and spectator-effects rows.

### Lobby, landing, whitepaper, pitch deck

**Shipped.** A null current pool, `{ pool: null }`, or an empty pool with no `split` or `usd` paints the unpaid hero fallback and does not throw.

Every JSON route has a `@ZodResponse` schema of the body the client receives. `RESPONSE_SCHEMA_CHECK` is `strict` in test and development (a mismatch is `500 response_schema_violation`) and `warn` in production. Admin, editor, auth, and money request objects reject unknown fields with `400 validation_error`. Telemetry and client-error still drop unknown fields. `npm run openapi:generate` writes `backend/server/openapi.json`.

- Lobby: new ride, live, replays, leaderboard, achievements, profile, garage, referral block, promo redeem, age agreement, receipt.
- Landing: Vite page, play control is bare `play.html`, pool and live boards, wallet connect, pitch-deck band, whitepaper link.
- Whitepaper and pitch deck are their own hosts. The deck's phone motion prompt tilts spawned SOL. Driving the game is desktop-only. Spectating works on a phone.
- `paintHero` throws if `split` or `totals` is missing. That is a known bug, not the intended empty state.

### Admin

**Shipped.** Three allowlists: `ADMIN_WALLETS`, `MODERATOR_WALLETS`, `EDITOR_WALLETS`. Session cookie `fc_admin`, only on `admin.<cookie domain>`, changes are wallet-signed and audited. `ADMIN_SESSION_TTL_MINUTES` defaults to 60 and `EnvService.adminSessionTtlMinutes` caps it at 60. `JoseAdminTokenSigner` caps the token at 3600 seconds. Logout writes `revoked:jti:<jti>`. Tabs cover overview, review, rides, replays, players, pools, payouts, stats, sessions, promos, settings, sign-ins, logs, and the audit log. Telegram alerts and the mainnet IP allowlist stay targets (59–66).

### Entity editor

**Shipped.** [`docs/spec/platform_services.md`](platform_services.md). Entities are data. Gameplay numbers stay in `roster.js` and `VEHICLES`. Revisions, a signed publish, a bundle, editor sign-in, MCP on the internal network, a PostgreSQL job queue, and a dedicated worker. Protected routes fail closed when Redis is down. Rate limits need Redis and a counter-only MCP user. `POST /api/editor/auth/logout` has no successful HTTP scenario.

### Analytics

**Shipped, opt-in.** [`docs/spec/platform_services.md`](platform_services.md). `POSTHOG_ENABLED=1` sends to EU PostHog. The browser posts an allowlist to `POST /api/telemetry`. The server emits after commit. The client cannot mint server event names. Do not flip `$create_alias`. Never print `POSTHOG_KEY`. Session replay is off.

### Game client

**Shipped.** Vanilla ES modules, three.js r160 from a CDN, no build step. The sim is not a replay. Seeded `mulberry32` only. Tunables in `client/js/config.js`. Shake constants and `START_ENGINE_OFF` stay unless someone asks. Theme materials are created inside `create*()`. Every 3D model is an entity. Collision and vehicle size are not.

The headless playthrough (`client/tools/headless-test.mjs`) drives the sim with three.js stubbed. `e2e-chrome.mjs` is the real Chrome boot. The 2026-10-23 parity run compared 11668 objects with the golden file and they matched.

### Legal

**Shipped texts, lawyer review still open.** `docs/legal/TERMS.md`, `PRIVACY.md`, `PRESEASON_RULES.md`, `PRESEASON_RULES_RU.md`, `OFFICIAL_RULES.md`. The 2026-10-17 donation and replay edits are marked in those files. They describe the target in several clauses (no live watch, donation share). Where a clause and the Conflicts table disagree, the clause is the target text, not a statement that the code already matches. Placeholders and `[LAWYER]` items in [`OPEN.md`](OPEN.md) stay open.

### Other shipped pieces

These are real and easy to miss. They are not separate games.

- Receipt page `r.html` reads `GET /api/rides/:id/public`. That route is in the zero-scenario list.
- `POST /api/client-error` is the crash beacon on every page, including the pitch deck and the model viewer. Caps: 3 per page, 10 per IP per minute, 2,000 per UTC day.
- `POST /api/telemetry` is the analytics relay. It is not the ride recording.
- Promo video and the chiptune synth live in `media/`. They are a toolchain. A clip is not a player flow, so the coverage contract does not ask for a Chrome test per clip. Byte checks stay in the media package tests.
- The `audit/` suite tests the audit tool. It is not a Freight Chain player surface. It stays out of the product Chrome matrix. Its own unit tests are part of making the census honest (phase 1).

## Spec Area Coverage

Target & as-built area files in `docs/spec/`:
- [`rides.md`](rides.md): rides, road generation algorithm (`@freightchain/shared` ⇄ `server/src/domain/road`), dynamic finish, `RideResult` scoring.
- [`anticheat.md`](anticheat.md): telemetry v2.1, 30 Hz re-sim, world integrity, humanness, and anti-sybil layers.
- [`minigames.md`](minigames.md): phone-sms rules from the `phone-minigames` branch. Appendix A is a retired catalog.
- [`pool.md`](pool.md): weekly pool lifecycle, v5/v6 escrow, and the prize board (`prize-rules.ts`).
- [`referral.md`](referral.md): referral program (as-built on `main` + target Convoy rework).
- [`promocodes.md`](promocodes.md): promo codes (`ride` and `tickets`, retired `free_rides` and `cosmetic`) and wardrobe.
- [`ten4.md`](ten4.md): TEN4 tokenomics, checkpoints, halving eras, burns, 9-slot Cab Garage, and `freightchain_honk`.
- [`web3_solana.md`](web3_solana.md): SIWS auth, guest sessions, phone pairing, SNS, Solana Actions/Blinks, Solana Pay, escrow pools, and soulbound achievement cNFTs.
- [`platform_services.md`](platform_services.md): statistics (`StatsService`), 3D entity engine & AI model editor (`storybook`, `mcp/`), PostHog analytics, crash reporting, and the 7 public hosts.
- [`replays_streams.md`](replays_streams.md), [`admin_security.md`](admin_security.md), [`backend_contract.md`](backend_contract.md), [`legal.md`](legal.md), [`e2e.md`](e2e.md).

The happy-dom catalog (`docs/testing/E2E_PLAN.md`, 159 checks) walks pages with fetch mocked and calls a real API only when `E2E_BASE` is set. It does not replace the Chrome column in the coverage contract.
