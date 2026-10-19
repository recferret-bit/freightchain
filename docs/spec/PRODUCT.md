# Product — as built

What the code does today, on `origin/main` (`e8f338ad`) plus the spec files of this branch. Agent how-to stays in `docs/agents/`. Target rules stay in the other `docs/spec/` files and in [`DECISIONS.md`](DECISIONS.md). If this file and the code disagree, this file is wrong.

Status words: **shipped** (in the code), **local** (built, not deployed to devnet), **target** (a decision, not in the code).

## How to read a conflict

The Conflicts table is the list the owner still has to pick. Tests lock the shipped column. Do not implement the target column as a drive-by.

## Conflicts (shipped behavior vs decisions 1–66)

| Topic | Shipped | Target decision | Do not |
|---|---|---|---|
| Live watch | A paid ride can be watched while it runs (`play.html?watch=`, about 25 s behind). Running free rides return `403 free_ride_no_stream`. Finished free rides stay in replays. | 18, 46, 55: no live watch. A replay is public only after the ride ends. Training rides are not in replays (56). | Delete `e2e-watch.mjs`, `e2e-live-board.mjs`, or the live board. Decision 68 keeps those tests. |
| Spectator effects | Donation night, day, and holes change a paid unranked ride only when `LIVE_EFFECTS` is `all`. The value `free` does not turn them on. Production compose is `LIVE_EFFECTS=free`, so those donation effects do not change a ride. A TEN4 burn of day, night, snow, or clear ignores that switch. A paid tip that misses the window is still a tip. | 33, 45, 49: donations and tips never change a ride, a result, or a prize. Remove HONK time and weather effects. | Strip the burn path until that decision is its own change. |
| Referral donation share | Qualified invite: `referral_donation_share_bps` 1000 (10%) to the referrer, cap 0.5 SOL. Below rent, the whole tip goes to the driver. | 50: the share is 0 and the `also` branch is removed. | Zero the setting inside a test PR. |
| Paid tiers | 1h, 4h, and 8h stay in `ride-tier.ts`. All three are `onSale: false`. Only 1h has a series (`saleHours` 24 / `playHours` 3 / `reviewHours` 48). 4h and 8h have `schedule: null`. A `POST` of 4h or 8h is `409 tier_not_on_sale` unless that tier has a live pool, an unspent promo, or an enabled grant. 4h and 8h grants default off. | 17: 4h and 8h are not created at all. | Add a second rejection on top of `tier_not_on_sale`. |
| Finish line | `completeDist = K × MAX_SPEED × nominal seconds`. The server completes the ride when its stored `lastS` (the last accepted report's `s`, after the speed governor) reaches that distance. Saying the shift finished is not enough. The client field named `lastS` is the hole-commit cursor, not this check. There is no minimum time. | 38–44, RID-M-03: the server computes `finishFor` at 65 km/h, independent of personal salts. | Swap the finish formula in place. A retune is a new trip id. Do not bump `SUMMARY_VERSION` or `WORLD_FACTS_VERSION`. |
| Replay rate | `ReplayEngine` is 10 Hz with two substeps. New rides need hashed traffic frames (`trafficVersion` 1). | 12: a fixed 30 Hz re-sim, bitwise. | Present 30 Hz as the current pipeline. |
| Pool calendar | Only the 1h tier has `saleHours` 24 / `playHours` 3 / `reviewHours` 48. The legacy transfer round is UTC Monday to Monday. v5 can store a split and deadlines. It does not open "Tuesday evening to Sunday evening" by itself. | Pool manifesto: one pool a week, sales stop 2 hours before close, last start is close minus 1 h 15 min, then 1.5 days of review. | Pretend the Tuesday clock is what the crank does today. |
| `set_pool_rules` | On-chain instruction. It changes the next pool only. There is no admin HTTP route. The CLI can send it. | Backend decision 8 and POOL-M-12: an admin HTTP route. Decision 60: `set_config` / `set_pool_rules` go through Squads, not an admin HTTP route. | Build either side. The two decisions disagree. |
| Minigames | Not in the game. Dispatch challenge kinds are empty. | 14, 19–22, `minigames.md`: a 15-id catalog on 1h rides only. | Write the catalog as shipped. |
| `RideResult` | Statistics are running totals (`PlayerStats`, `GlobalStats`, `DailyStats`). There is no per-ride `stats.RideResult` row and no published score formula. | RID-M-12 and RID-M-17. | Add the table inside a test-only change. |
| Lobby language | English. | 58: English and Russian from the first public day. | Machine-translate the lobby as part of coverage. |
| Admin power | One `ADMIN_WALLETS` list. Session max is 120 minutes. Logout does not revoke the token. Strict env checks run when `NODE_ENV` is production. | 59–66: three roles, 60 minutes, `jti` revoke, Telegram alerts, default-deny, IP allowlist on mainnet. | Treat the security manifesto as the current guard. |
| Pledges | Built: create, confirm, attest, settle, refund, watch UI. | 51: pledges answer `403 pledges_disabled` on the devnet launch. | Disable them in the current server without that flag being the decision's PR. |
| Program deploy | Pools v5 is built (`8500/500/1000`, `paid_tickets_enabled`, no on-chain referral leg). Devnet still runs pools v3. TEN4's program is local only. The PostgreSQL ledger is the TEN4 balance. | The spec often says "v5" as if it were the live program. | Deploy, or tell a player that devnet is v5. |

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

A live 1h grant is issued only inside the ranked week (Monday 00:00 UTC through Sunday 12:00 UTC) to a non-guest who is 18+ and in an allowed country. It expires at the next interval or Sunday 12:00 UTC, whichever is earlier. An unspent 1h ride promo is claimed first: that POST creates a promo ride and leaves the grant unspent. With no promo, the first `POST /api/rides { tier: '1h' }` creates an unranked ride and spends the grant. A second `POST` while that ride is still `created` returns the same ride. `409 weekly_ticket_spent` is the lost-claim race, not the ordinary second order. After the grant ride has ended, another 1h with no pool and no promo is `409 tier_not_on_sale`. The grant does not mint TEN4. It can be watched. It consumes one of the five paid ranked slots only when `POST /api/rides/:id/start` sends `{ ranked: true }`.

`GET /api/prize/board` ranks ended rides that started ranked. The USDC contest in `docs/spec/pool.md` (Appendix C) is a draft. No USDC is sent. Spectator road effects are refused on ranked rides. Both profile stamps (`age18` and the loss acknowledgement) are required before a bought paid ride or a blink shift buy (`409 agreements_required`). A promo and a weekly grant skip that check.

### Paid rides, tickets, Solana Pay, blinks

**Shipped for transfer mode. Program mode is built and not what devnet runs.**

- `PAYMENT_MODE=transfer`: a payment row per paid entry. No draw and no on-chain payout on that path.
- `PAYMENT_MODE=program`: a paid tier needs a live pool. The wallet signs and sends. The server credits tickets from program events (confirm, watcher, webhook).
- Solana Pay: `GET` and `POST /api/solana-pay/{rides|orders|donations}/:id`. CORS `*` on that prefix only. The lobby QR is a `solana:` URL. Reconcile uses the reference key.
- Blinks: `/actions.json` (and `/.well-known/actions.json`, rewritten onto it) and `/api/actions/*` are public, with CORS `*` on those paths only. The shift buy is one program-mode ticket and needs both profile stamps. Hello, site links, and ride links do not.
- A ticket ride uses the pool's road seed. One pool, one road.

### Escrow program

**Local v5, devnet v3.** [`docs/spec/pool.md`](pool.md). Default split for a new v5 pool is 85% / 5% / 10% (`8500/500/1000`). `max_player_share_bps` default 4740, program ceiling 4999. `paid_tickets_enabled` can be off. No on-chain referral leg. `seal_road`, winners root, per-ride attestations, sponsor refunds, and pledges are in the built program. Pledge routes answer normally today. `403 pledges_disabled` is decision 51, not the current server. The crank and the payout key are the server's only two keys. The cold admin can veto a root. Money stays in the program.

### TEN4

**Ledger shipped. Program local.** [`docs/spec/ten4.md`](ten4.md), [`docs/agents/ten4-localnet.md`](../agents/ten4-localnet.md).

Ticker TEN4. Routes, tables, the crate, and `HONK_PROGRAM_ID` stay HONK. HONK is the chat verb. Supply 100,000,000. SOL still prices the ticket. TEN4 is reserved when a paid ride's verdict is verified. Until TGE the balance is PostgreSQL and the UI says points. Era-1 finishes: 1h 100, 4h 500, 8h 1,200. An 8h mint waits 48 hours. Burns: 1 chat HONK, 10 day/night, 25 snow or clear. Cab parts 65 / 260. The local program is not deployed. There is no AMM on devnet.

`GET /api/honk` can return `chain: null` when `HONK_PROGRAM_ID` is unset. That is the block-1 configuration, not a broken route.

### Garage and promo

**Shipped.** [`docs/spec/ten4.md`](ten4.md), [`docs/spec/promocodes.md`](promocodes.md). Nine slots, 48 non-default parts: 45 TEN4 parts and three referral gift paints. Apply is `POST /api/garage/loadout`, all or nothing.

A promo code is one ride shift (1h, 4h, or 8h, once per wallet, no TEN4) or pool tickets. `kind: 'free_rides'` is retired. `kind: 'cosmetic'` is `409 visuals_are_honk`. Old cosmetic unlocks still equip. Admin create and disable are wallet-signed and audited.

### Referrals

**Shipped.** [`docs/spec/referral.md`](referral.md).

One code and one referrer per wallet, bound before any ride has `startedAt`. Codes are 8 characters. Gifts: `convoy`, `signal`, `amber`. Capacity is `min(30, 3 + 3 × floor(verified paid shifts / 5))`. A pending invite lasts 14 days. The first verified completion of any ride, including EASY, qualifies the invite and unlocks the gift paint. The 2 and 3 free rides are granted only when that first completion is a verified MEDIUM (`free-2c`), within 7 days of the bind, and the referrer is under the weekly cap of 10. A later MEDIUM does not grant them. Convoy badges are 1 / 5 / 20 / 100 (a paid shift, or HARD with assist off). v5 has no on-chain pot leg. Donation share, when the driver's invite is qualified: 1000 bps (10%) to the referrer, lifetime cap 0.5 SOL for the pair. The whole tip goes to the driver when the share is below rent (890_880 lamports), the driver would receive nothing, or the spectator is the referrer. That is the shipped rule, not decision 50.

44 earnable badges plus legacy `top-20` in [`docs/spec/web3_solana.md`](web3_solana.md).

### Achievements

**Shipped, mint off unless the three env keys and the URI map are set.** 44 badges plus legacy `top-20` (never earned, never minted). Ids are frozen. Unlocks are append-only. The cNFT mint is a separate outbox, its own key, after a delay, and it skips a rejected ride and a guest wallet. A weekly grant counts as a paid shift and does not count as a TEN4 mint. `nft-metadata-uris.ts` is not covered by a unit test that walks every id.

### Ride lifecycle

**Shipped.** Order, start, heartbeat, batches, end. A ride silent for `HB_TIMEOUT_MS` (150 s) is ended by the sweeper. Closing the game tab beacons `/end`. Closing a site page sends `leave=1`. Finish is the distance line. `RIDE_MIN_SECONDS` is the nominal length (test 300, production 1800). Route and start hour are the server's. Trip ids are frozen once rides carry them.

### Verified play

**Shipped, production in shadow mode.** [`docs/spec/anticheat.md`](anticheat.md).

10 Hz samples, hash-chained batches, rules v7, traffic-frame proof required for new starts. The server rebuilds the road and the holes. Verdicts are `verified`, `flagged`, `rejected`. `VERDICT_ENFORCE=false` is the production default: judged and shown, boards and badges ignore a reject. The code default for tests is `true`. Machine-rejected paid rides stay under review until an admin decides. There is no 30 Hz re-sim and no minigame. One person with many wallets is not checked ([`docs/spec/anticheat.md`](anticheat.md) Appendix D is the target plan).

### Statistics

**Shipped.** [`docs/spec/platform_services.md`](platform_services.md). Running totals only, written by `StatsService` on every end path and every donation, player lock first. Crash counts are client-reported and not judged. Reads are cached. There is no `RideResult` row.

### Live board, watch, chat, donations, replays

**Shipped.** [`docs/spec/replays_streams.md`](replays_streams.md).

`GET /api/live` is heartbeats plus soft online counts. Running free rides are omitted. `GET /api/replays` is history, including finished free rides. Watch polls. There is no WebSocket. Chat, mutes, mock tips, and paid SOL tips to the driver are shipped. Feature flags: `LIVE_CHAT`, `LIVE_DONATIONS`, `LIVE_FREE_DONATIONS`, `LIVE_EFFECTS`. Code defaults all/on/on/all. Production compose all/on/off/free. With `LIVE_EFFECTS=free`, donation night, day, and holes do not change the ride. Replay draws the recording. It does not run the sim. Sample columns are append-only. Input bits are frozen.

This whole section is the shipped column of the first three conflicts.

### Lobby, landing, whitepaper, pitch deck

**Shipped.**

- Lobby: new ride, live, replays, leaderboard, achievements, profile, garage, referral block, promo redeem, age agreement, receipt.
- Landing: Vite page, play control is bare `play.html`, pool and live boards, wallet connect, pitch-deck band, whitepaper link.
- Whitepaper and pitch deck are their own hosts. The deck's phone motion prompt tilts spawned SOL. Driving the game is desktop-only. Spectating works on a phone.
- `paintHero` throws if `split` or `totals` is missing. That is a known bug, not the intended empty state.

### Admin

**Shipped as one allowlist.** Session cookie `fc_admin`, only on `admin.<cookie domain>`, changes are wallet-signed and audited. Tabs cover overview, review, rides, replays, players, pools, payouts, stats, sessions, promos, settings, sign-ins, logs, and the audit log. The three-role design, the 60-minute session, Telegram, and the IP allowlist are targets (59–66).

### Entity editor

**Shipped.** [`docs/spec/platform_services.md`](platform_services.md). Entities are data. Gameplay numbers stay in `roster.js` and `VEHICLES`. Revisions, a signed publish, a bundle, editor sign-in, MCP on the internal network, a PostgreSQL job queue, and a dedicated worker. Protected routes fail closed when Redis is down. Rate limits need Redis and a counter-only MCP user. `POST /api/editor/auth/logout` has no successful HTTP scenario.

### Analytics

**Shipped, opt-in.** [`docs/spec/platform_services.md`](platform_services.md). `POSTHOG_ENABLED=1` sends to EU PostHog. The browser posts an allowlist to `POST /api/telemetry`. The server emits after commit. The client cannot mint server event names. Do not flip `$create_alias`. Never print `POSTHOG_KEY`. Session replay is off.

### Game client

**Shipped.** Vanilla ES modules, three.js r160 from a CDN, no build step. The sim is not a replay. Seeded `mulberry32` only. Tunables in `client/js/config.js`. Shake constants and `START_ENGINE_OFF` stay unless someone asks. Theme materials are created inside `create*()`. Every 3D model is an entity. Collision and vehicle size are not.

The headless playthrough (`client/tools/headless-test.mjs`) drives the sim with three.js stubbed. `e2e-chrome.mjs` is the real Chrome boot. `test:parity` is red on 21 ambulance meshes (audit 2026-10-18).

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
- [`minigames.md`](minigames.md): 15-id minigame catalog and bot test suite.
- [`pool.md`](pool.md): weekly pool lifecycle, v5/v6 escrow, and the prize board (`prize-rules.ts`).
- [`referral.md`](referral.md): referral program (as-built on `main` + target Convoy rework).
- [`promocodes.md`](promocodes.md): promo codes (`ride` and `tickets`, retired `free_rides` and `cosmetic`) and wardrobe.
- [`ten4.md`](ten4.md): TEN4 tokenomics, checkpoints, halving eras, burns, 9-slot Cab Garage, and `freightchain_honk`.
- [`web3_solana.md`](web3_solana.md): SIWS auth, guest sessions, phone pairing, SNS, Solana Actions/Blinks, Solana Pay, escrow pools, and soulbound achievement cNFTs.
- [`platform_services.md`](platform_services.md): statistics (`StatsService`), 3D entity engine & AI model editor (`storybook`, `mcp/`), PostHog analytics, crash reporting, and the 7 public hosts.
- [`replays_streams.md`](replays_streams.md), [`admin_security.md`](admin_security.md), [`backend_contract.md`](backend_contract.md), [`legal.md`](legal.md), [`e2e.md`](e2e.md).

The happy-dom catalog (`docs/testing/E2E_PLAN.md`, 159 checks) walks pages with fetch mocked and calls a real API only when `E2E_BASE` is set. It does not replace the Chrome column in the coverage contract.
