# Replays and streams — spec and test plan

> Source of truth for replays, "streams" (watching a replay with chat and donations), donations, chat, and the lobby (REPLAYS / LIVE). Decisions: 18, 33, 34, 45–58 (all ✅ 17.10.2026), 9 (backend), the owner's decision of 17.10.2026 "replays of non-training rides only". Code checked after the merge of PR #3 (`origin/main` `e8f338ad`). The ticker is TEN4; HONK in the text below is the chat verb and the old route names. Decisions are unchanged.
> The term **"stream"** = watching a **replay** of an already finished ride, with chat and donations to the driver. There is no live broadcast of the current ride (decision 18). A donation is not made during the current ride: a donation only while watching a replay, the money goes straight to the driver's wallet, and the driver sees it after the ride (decision 45, ✅ 17.10.2026).

## Part 1. Spec (how it must work)

### 1.1 What is in the code now (`origin/main`)
| What | Where | Now |
|---|---|---|
| Watching a ride | `GET /api/watch/:id` (`server/src/presentation/live/live.http.controller.ts:37`, `watch-ride.handler.ts`) | **PUBLIC**: any started ride, including a **current** one ("live, or a replay of a finished one"). A free **current** one → `403 free_ride_no_stream`. A free **finished** one opens as a replay |
| Road plan | `GET /api/watch/:id/road` (`:44`, `get-road-plan.handler.ts`) | **PUBLIC**, including during the ride |
| Replay list | `GET /api/replays` (`get-replays.handler.ts`), lobby `client/site/lobby-replays.js` | all finished rides (`completed / abandoned / failed`), **including `tier = free` (training)**, EVERYONE/MINE filters and an outcome filter, `LOAD MORE` |
| LIVE in the lobby | `client/site/lobby-live.js`, `/api/live` | "TRUCKS ON THE ROAD" cards with `▶ WATCH`, `▶ WATCH A RANDOM ONE`, sorting and a route filter; free ones are hidden |
| Chat | `POST /api/watch/:id/messages` (`:49`) | a **current** ride only (`live-access.service.ts`: `ride_not_live`), not one's own, not free, not muted. `cleanText`, ≤ 140 characters (`live-rules.ts` `MESSAGE_MAX_LENGTH`), 1 line / 3 s per wallet (`LINE_WINDOW_MS`) |
| Donations (mock) | `POST /api/watch/:id/donations` (`:55`) | `LIVE_FREE_DONATIONS=on` → nothing is charged; effects `tip, night, day, potholes, trench, sinkhole` (`live-rules.ts:8`) **change the ride** |
| Donations (chain) | `POST …/donation-orders` (`:61`), `…/confirm` (`:67`), `…/reconcile` (`:73`) | an unsigned SOL transfer from the viewer → the **driver's wallet** (`ride.wallet`), memo `fc-donation:<id>`, a reference key; an on-chain check; reusing the signature → `409 signature_reused`; the wrong transaction → `400 bad_donation_payment`; not yet visible → `{status:'pending'}` |
| Referral share | `create-donation-order.handler.ts:74`, `game-settings.ts:31` `referral_donation_share_bps: 1000` | **10% of the donation goes to the driver's referrer** (a second transfer in the same transaction) — contradicts "100% to the driver" (TERMS 14.3, [`MASTER_PLAN.md`](../plan/MASTER_PLAN.md) §3) |
| Burning TEN4 (the `/honk` route, the HONK chat verb) | `server/src/presentation/honk/honk.http.controller.ts:48/54/60` (`watch/:id/honk`, `/honk/time`, `/honk/weather`) | burn 1 TEN4 — a line in chat; 10 TEN4 — **day/night for the driver**; 25 TEN4 — **snow/clear** (they change the ride) |
| Pledges | `client/js/ui/watch-pledges.js`, `pledges.http.controller.ts`, program `pledge.rs` | the viewer locks SOL "per km" on a ticketed ride; after the pool review the driver receives stake × verified km |
| Driver inbox | `GET /api/rides/:id/inbox` (`:78`), `client/js/ui/live-feed.js` (CB radio) | **during the ride** the driver sees chat and donations, applies effects (`effects/:eventId/applied`, `:89`), a `mute` button (`POST rides/:id/mutes`, `:84`) |
| Replay — what is shown | `client/js/watch.js` | a **client recording** (10 Hz samples, batches ≈ 15 s) + the input column `SAMPLE_INPUT_COL` (which controls are pressed every 100 ms, a flashing frame, `input-bits.js`) + 2 Hz traffic + ROAD CHECK against the server hole plan. Nothing is simulated |
| Storage | `TELEMETRY_RETENTION_DAYS = 90` (`env.schema.ts:140`) | the recording is kept for 90 days. There is **no** deletion of chat (`live.RideEvent`) after 90 days in the code |
| Flags | `env.schema.ts:144–150` | `LIVE_CHAT` all/free/off, `LIVE_DONATIONS` on/off, `LIVE_FREE_DONATIONS` on/off, `LIVE_EFFECTS` all/free/off (code defaults `all / on / on / all`; in the prod compose `all / on / off / free`) |
| Links | `/r/:id` (`configure-app.ts:43`, OG card), blink `POST /api/actions/ride/:id/watch` | public |

### 1.1a Operational implementation details on `main` (presence, closing a tab, `watch.js` samples, workers, and E2E)
- **Site presence and viewers (`client/site/presence.js`, `GET /api/live`)**:
  - The landing and the lobby poll `/api/live?visitor=<id>&page=landing|lobby`, and on leaving the page (`pagehide`) `leaveOnClose()` sends a beacon with `&leave=1`, so the presence and viewer counters are released at once, without waiting for the TTL to expire.
- **Closing the game tab and sweeping stuck rides (`online.js`, `StaleRideScheduler`)**:
  - On closing the game tab (`pagehide`) `client/js/online.js` sends `navigator.sendBeacon('/api/rides/:id/end', ...)` (parsed by `beaconBodyMiddleware` on the server), and on return from bfcache (`pageshow` with `e.persisted`) reloads the page, so as not to continue an already finished ride.
  - If the tab vanished without a beacon and stays silent longer than `HB_TIMEOUT_MS = 150 000 ms` (150 s), the background `StaleRideScheduler` (`SweepStaleRidesCommand`) moves the ride from `running` to `failed` (`heartbeat lost`, analytics `ended_by = 'stale_sweep'`) and calls `StatsService.recordRideEnded`. A ride never stays hanging in `running`.
- **Replay sample format and 2 Hz traffic in `client/js/watch.js` (`client/js/replay-end.js`)**:
  - Columns `0..11` of a 10 Hz sample: `[t, s, d, psi, v, rpm, gear, hull, gas, brake, steer, clutch]`.
  - Columns `12..15`:
    - `12`: the in-game hour of the day (`clock`, `0..24`);
    - `13`: a bit mask of cabin states (`FLAGS`: the heater `heater = 32`, cooling `cooling = 2048`, phone open `phone = 4096`);
    - `14`: `SAMPLE_INPUT_COL` (`client/js/input-bits.js`, bits of held keys + `MOUSE = 1 << 25`, phone buttons `map = 1 << 26`, `cold = 1 << 27`, `share = 1 << 28`);
    - `15`: `SAMPLE_FORK_COL` (the chosen fork branch, passed to `roads.setBranch`).
  - Traffic for the replay display (`trafficSnapshot()` in `client/js/sim/traffic.js`): sampled at **2 Hz** for the `<= 16` nearest vehicles within `400 m` of the truck.
  - Replay length (`replayEnd()` in `client/js/watch.js`, the end-of-replay dialog in `client/js/replay-end.js`): the finish-crossing point `+ 3 s` (or the end of the recording).
  - Cabin cosmetics in the replay: `ride.loadout` is applied through `setLoadout()` when `watch.js` loads.
- **Effect-window lock and E2E scripts**:
  - A sliding 20-second interval between effects on one ride is serialized by a transactional `pg_advisory_xact_lock` on `rideId`.
  - Check scripts and skills: `node server/scripts/sim-rides.mjs`, `node server/scripts/e2e-live-board.mjs` (skill `live-board-test`), `node server/scripts/e2e-close.mjs`, `node server/scripts/e2e-watch.mjs`, `node server/scripts/e2e-replay.mjs`, `node server/scripts/e2e-live-flags.mjs` (skill `replay-test`).

### 1.2 What can be watched
- **RPL-M-01** MUST: the public may watch **only a replay of a finished non-training ride**. "Finished" = status `completed`, `abandoned`, or `failed`, a final verdict exists and it is not `rejected` (decision 55). A ride in `review` opens after a manual decision.
- **RPL-M-02** MUST NOT (decision 56): **training** rides do not appear in replays at all. That is `tier = free` (levels `free-1c` / `free-2c` / `free-3c`, the frozen `free-3b`, and the old `free-*`), the guest offline `free-g`, a `POST /api/auth/guest` session, and any ride with `tutorial` or `assist`. For them:
  - `GET /api/replays` does not return them in EVERYONE or in MINE;
  - `GET /api/watch/:id`, `GET /api/watch/:id/road`, `/r/:id`, and blink → `404` (backend decision 9);
  - the recording is kept only for the verdict and for admin (`GET /api/admin/replays`).
- **RPL-M-03** MUST NOT: the **current** ride is visible to nobody except its client. `GET /api/watch/:id` for `running` → `404` to everyone, including other players and the unauthenticated. `GET /api/watch/:id/road` for `running` → `404`. The driver gets the road plan through their own ride route (decision 18).
- **RPL-M-04** MUST: the replay and the road plan of a **pool** ride are public only after `payout_at` (the end of the pool review, decision 34). Before that, to others → `404`.
- **RPL-M-05** MUST (decision 57): the driver sees **their own** replay right after the verdict, including a pool one (only with the ride owner's authorization). RPL-M-04 applies to everyone else.
- **RPL-M-06** MUST: a free **non-training** ride opens after the verdict. This is a devnet-launch attempt for airdrop tasks ([`PRESEASON_RULES.md`](../legal/PRESEASON_RULES.md) §2), a 1h promo ride, and an issued weekly ticket (both on main). If it is a pool ride, RPL-M-04 applies.
- **RPL-M-07** MUST: the replay shows **poses from the server recompute** (v2, 30 Hz, decision 12). Raw input events, their timing, and the input column per 100 ms must not be given out publicly. Remove control highlighting (`input-bits.js`) from the public replay; leave it only in admin (decision 48). The `GET /api/watch/:id` response has no input column.
- **RPL-M-08** MUST: a replay is available while the recording is kept (`TELEMETRY_RETENTION_DAYS`, 90 days by default). After deletion the list row is "no recording", and `GET /api/watch/:id` → `404`.
- **RPL-M-09** MUST: the admin sees every ride (training, `rejected`, before `payout_at`) through `GET /api/admin/replays` and the admin view. Public visibility rules do not apply to admin.

### 1.3 Lobby
- **RPL-M-10** MUST: in the lobby a training ride is clearly marked "not included in replays". The texts below are **in EN and RU from day one** (the devnet launch is also aimed at an RU/CIS audience; decision 58).

| Where | EN | RU |
|---|---|---|
| badge on a free / level card (`lobby-new.js` `freeCard`, `levelPicker`) | `TRAINING · NOT IN REPLAYS` | `TRAINING · DOES NOT APPEAR IN REPLAYS` |
| hint under the START button | `Training rides are private: not ranked, no TEN4, never shown in replays.` | `Training rides are private: no ranking, no TEN4, they do not appear in replays.` |
| tier name (`lobby.js:28` `TIER_NAME.free = 'TEST RIDE'`, `ui.js:17` `'Free ride'`, `watch-panel.js:19`) | `TRAINING` | `TRAINING` |
| training-ride result (`ui/game.js`, online menu) | `Training ride – no replay is published.` | `Training ride — the replay is not published.` |
| footer of the REPLAYS tab (`lobby-replays.js`) | `Replays of finished 1-hour rides. Training rides are never shown. Pool rides appear after the pool's review ends.` | `Replays of finished hour-long rides. There are no training rides here. Pool rides appear after the pool review ends.` |
| empty MINE | `No replays yet. Your training rides are not shown here.` | `No replays yet. Training rides are not shown here.` |
| a pool ride in MINE before `payout_at` | `Public after the review · <date>` | `Becomes public after the review · <date>` |

- **RPL-M-10a** MUST (decision 58): the lobby and the replay panel run in **EN and RU from the devnet launch**:
  - the language follows `navigator.language` (`ru*` → RU, otherwise EN), an EN/RU switch in the lobby header and on the panel, the choice is stored (`freightchain.lang`) and `?lang=ru|en` is supported;
  - every UI string of the lobby, the replay panel, and the result windows comes from `en` / `ru` dictionaries with the same set of keys;
  - server texts (`ProblemDetails.detail`) shown to the player go through an error code and the client dictionary;
  - dates are in the player's locale.

- **RPL-M-11** MUST: the **LIVE** tab does not let anyone watch current rides: remove `▶ WATCH`, `▶ WATCH A RANDOM ONE`, and the text "WATCH replays a ride about 25 s behind…". Only the counter "N on the road" / the Russian for "N on the road" remains, with no cards, progress, or links (decision 46). A replay shows an honest "watching now" counter (RPL-M-32).
- **RPL-M-12** MUST: the REPLAYS tab shows only what RPL-M-01…06 allow. The EVERYONE/MINE and ALL/COMPLETED/ABANDONED/FAILED filters and `LOAD MORE` remain.

### 1.4 Replay player — controls
Inventory from the code (`client/js/ui/watch-panel.js`, `client/js/watch.js`, `client/js/ui/input.js`, `client/js/replay-end.js`). **Present** — on main; **remove** — contradicts decisions 18/33; **build** — not in the code, required to implement (decision 47). First priority: C8 steps ±5/±30, C6/C7 events, C18 `&t=`, C3 0.5× / 2×; the other "build" items follow, before the devnet launch closes.

| # | Element | id / key | Status | Behavior (norm) |
|---|---|---|---|---|
| C1 | Play / Pause | `#w-play` (❚❚ / ▶) | present | toggles `watch.playing`; at the end of the replay ▶ starts from the beginning (plan: it currently stays on the last frame) |
| C2 | Speeds 1× / 4× / 16× | `.spd[data-x]` | present | selects `watch.speed`, starts playback; the active button is highlighted `sel` |
| C3 | Speeds 0.5× / 2× | — | build | add to the speed row |
| C4 | Time slider | `#w-seek` (range, step 1 s, `max = replayEnd()`) | present | `seek(t)` clamped to `0 … replayEnd()`; an unloaded span holds the target ("loading…", `watch.seeking`) |
| C5 | Timeline marks — holes | `#w-marks .w-mark.hit/.ignored` | present | click → `seek(t − 6)` and play; colors: hit — amber, ignored — red ("NO IMPACT") |
| C6 | Event marks: crashes, red light, minigames, finish, start | — | build | from `RideResult` / `RideReplayFlag` (`atSecond`); click → `seek(t − 6)` |
| C7 | Previous / next event | — | build | buttons ⏮ / ⏭ and keys `[` / `]` |
| C8 | Step back / forward | — | build | `←` / `→` ±5 s, `Shift+←/→` ±30 s, buttons ⟲5 / 5⟳ |
| C9 | ● LIVE (catch up to the live broadcast) | `#w-live` | **remove** | there is no live broadcast (RPL-M-03) |
| C10 | Engine sound | `#w-sound` (🔇/🔊), key `M` | present | `audio.start()` on the first press, then mute/unmute |
| C11 | Map (phone) | key `N`, the `map` button on the panel | present | `toggleMap()`; does not fire in the chat input |
| C12 | Form shade | `F8` | present | a view toggle, not recorded |
| C13 | Collapse / expand the panel | `.w-fold` (⇥ / ⇤) | present | the `folded` class on `#watch` |
| C14 | Exit | `#watch-yard` "I MISS THE YARD" → lobby, `#watch-done` "I'M DONE" → landing | present | navigation via `SITE_BASE` |
| C15 | Camera (cab / outside) | `C` (`toggleCab`) — driving mode only | build | allow `C` in the replay |
| C16 | Full screen | — | build | `F` / button ⛶, Fullscreen API |
| C17 | Hide HUD | — | build | `H` / button; the panel and the radio hide, the slider remains on hover |
| C18 | Link with a time mark | — | build | "Share" copies `play.html?watch=<id>&t=<s>`; `&t=` is supported on open (a deep link) |
| C19 | Space = Play/Pause | — | build | not in an input field |
| C20 | Badges and stats | `#w-state`, `#w-viewers`, `#w-time`, `#w-dist`, `#w-hull`, `#w-note`, `#w-route` | present | `REPLAY · <status>`; `#w-viewers` is live-only → for a replay show "watching now" or hide it (decision 46) |
| C21 | ROAD CHECK | `#w-road`, stamp `#w-stamp` "NO IMPACT" | present | a line from the server holes; in v2 it is replaced by recompute marks |
| C22 | Chat and donation feed | `#w-feed` (`aria-live`) | present | lines as text only (`el` / `textContent`), a `paid ↗` link to the explorer, `(mock)`; up to 200 lines |
| C23 | Sign in | `CONNECT WALLET` in `#w-me` | present | `signIn()`; shown only for live now → show it for a replay |
| C24 | Chat field + SEND / Enter | `#w-text` (maxlength 140), SEND button | present (live only) | move it onto the replay (RPL-M-15) |
| C25 | HONK into chat | `#w-honk` (10 s) | present | burn 1 HONK, a line in chat, no effect on the ride — keep it on the replay as cosmetics (decision 49, RPL-M-34) |
| C26 | HONK day / night / snow / clear | `#w-honk-day/night/snow/clear` | **remove** | they change the ride (decision 33) |
| C27 | Donation buttons with effects | `.w-fx` from `EFFECT_INFO` (night, day, potholes, trench, sinkhole) | **remove** | effects on the ride are forbidden (decision 33) |
| C28 | Donation button `tip` | `.w-fx` `tip` | present → replay | a donation to the driver, with no effect |
| C29 | Donation note | `#w-note-in` (maxlength 80) | present | |
| C30 | QR Solana Pay for a phone | `#w-qr` | present | `solanaPayUrl(…, donationPayPath(order.id))`, poll `reconcile` for 90 s |
| C31 | Status line | `#w-msg` | present | server texts |
| C32 | Pledges | `#w-pledges`, `pledgeForm` | present (pool) | **turn off for the devnet launch** (decision 51, RPL-M-33) |
| C33 | Replay-end window | `paintEnd()`: SHIFT COMPLETE / ABANDONED / RIDE FAILED + `#lobby` BACK TO THE LOBBY | present | shown on the last frame (`replayHeld`), hidden on a seek backward |
| C34 | Error | "NOTHING TO WATCH" + link "← trucks on the road" | present | point the link at `#replays` |
| C35 | Driver radio (CB): feed, `mute`, hide | `client/js/ui/live-feed.js` (`.cb-mute`, `freightchain.cb`) | present (live) | during the ride there are no donations and no chat; mute moves to one's own replay page (RPL-M-18) |
| C36 | Cosmetic reactions | — | build | 👍 🔥 🚚 and the like, on the replay only, no money (decision 33) |

- **RPL-M-13** MUST: every element in the table with status "present" or "build" works as described and is covered by a test (Part 2). "Remove" elements are deleted from the UI and the API (an absence test).

### 1.5 Stream = replay + chat + donations
- **RPL-M-14** MUST: a donation sent while watching a replay goes to **the driver of that ride** (`ride.wallet`), by a direct transfer from the viewer's wallet. The server does not hold the money.
- **RPL-M-15** MUST: chat and donations are available **only on the replay** of a public ride (RPL-M-01…06). On the current ride the API returns `404` (the ride is not visible). On a training ride — `404`. On one's own — `403 own_ride`, as now.
- **RPL-M-16** MUST: **100% of the donation — to the driver.** The sender pays the network fee. There is no referral share: `referral_donation_share_bps = 0` and the `also` branch in `create-donation-order` is removed (decision 50). The `referral_donation_share_bps` setting is removed from `game-settings.ts` (or fixed at 0: the admin cannot set > 0 → `400`). The lobby text about the referral share of donations is removed.
- **RPL-M-17** MUST NOT: a donation, a tip, HONK, a reaction, or a message never changes the ride, its verdict, `RideResult`, the ranking, or the prize (decision 33, TERMS 14.1/14.5). Effects `night/day/potholes/trench/sinkhole`, `effects/:eventId/applied`, the `inbox` for effects, and HONK time/weather are removed (`anticheat_test_plan` (superseded, merged into docs/spec) §20.1).
- **RPL-M-18** MUST: the driver sees received donations **after the ride**: a "Donations received" list in the lobby (profile) and a notification. A new route `GET /api/me/donations` (decision 45) — viewer, amount, note, ride, signature. Plus `PlayerStats.donations` / `donationLamports`. The money is also visible in the wallet balance. On their own replay page the driver can mute a viewer (`mute`).
- **RPL-M-19** MUST: payment is an order (`donation-orders`) → an unsigned transfer (memo `fc-donation:<id>`, reference) → the wallet signs and sends → `confirm` (or `reconcile` for the phone):
  - one transfer pays one order, reusing the same signature → `409 signature_reused`, a repeat `confirm` of the same order with the same signature → the same result (idempotent);
  - a transfer to the wrong recipient, for the wrong amount, with no memo, or with someone else's reference → `400 bad_donation_payment`;
  - a transaction with an error (`meta.err`) → `400`, the order stays `pending`;
  - not yet confirmed → `{status:'pending'}`;
  - an expired blockhash, the transfer did not arrive → the order stays `pending`, after **15 min** — `expired` (decision 52; there is no order expiry now).
- **RPL-M-20** MUST (decision 52): tips are the fixed options **0.01 / 0.05 / 0.1 SOL** (now only `tip` 0.01, `live-rules.ts`). Bounds as parameters: minimum **0.001 SOL** (below — `400 donation_too_small`), maximum **1 SOL** per donation (above — `400 donation_too_large`).
- **RPL-M-21** MUST: rate limits: chat — 1 line / 3 s per wallet per ride (`LINE_WINDOW_MS`, `429 live_rate_limited` with `Retry-After`). Donations: no more often than 1 order / 3 s per wallet and no more than **3** unclosed orders per wallet (`429`; decision 52).
- **RPL-M-22** MUST: the payment mode is set by a flag. On the devnet launch, replay donations and chat are **enabled for the test** ([`OPEN.md`](OPEN.md) round 22 item 3), payment is devnet SOL (`LIVE_FREE_DONATIONS=off`) or mock. The mode is visible on the button ("devnet SOL" / "mock SOL – nothing is charged").
- **RPL-M-23** MUST: in the feed a donation shows the sender, the amount, the note, and an explorer link (`paid ↗`) for a paid one, or `(mock)`.

### 1.6 Chat
- **RPL-M-24** MUST: anyone who can see the replay can read its chat. Writing — only after a wallet sign-in (`PlayerAuthGuard`, otherwise `401`).
- **RPL-M-25** MUST: the text is cleaned (`cleanText`: control and bidi characters → a space, spaces collapse), length ≤ 140 after cleaning, empty → `400`. A donation note is ≤ 80. The client renders it only as text and does not interpret HTML (XSS).
- **RPL-M-26** MUST: order is by event `id` (monotonic). The client does not duplicate a line it has already shown itself (`addOwn` + the next poll).
- **RPL-M-27** MUST: moderation:
  - the driver mutes a viewer on their own ride (`POST /api/rides/:id/mutes`): that viewer's lines disappear from every feed, and they can no longer write (`403 muted`);
  - the admin hides a message and blocks the wallet from chat globally (`POST /api/admin/chat/:eventId/hide`, `chat_banned` on the player → `403 chat_banned`);
  - links in chat are forbidden (`400 chat_link_forbidden`), except the explorer link of a paid donation, which the server sets;
  - the EN/RU forbidden-word list is a parameter, a match → `400 chat_word_forbidden` (decision 53).
- **RPL-M-28** MUST: chat messages are deleted after **90 days** (TERMS 16.4, PRIVACY). A scheduler is required that deletes `live.RideEvent` kind=`message` (there is none now). Records of paid donations are kept as payment records.
- **RPL-M-29** MUST (decision 54): a replay message is tied to a moment of the replay (`replayT`, a second of the ride) and is shown when that moment plays. The client sends the current replay second on submit, and the message is also visible in the shared feed.

### 1.7 Related links and counters
- **RPL-M-30** MUST: `/r/:id` (OG card), blink `POST /api/actions/ride/:id/watch`, and `GET /api/solana-pay/donations/:id` follow the same visibility rules. A hidden ride → `404`, with no leak of the status, the seed, or the wallet.
- **RPL-M-31** MUST: `GET /api/watch/:id` does not return the end reason, payments, raw input events, or `featureScores` (as now, plus RPL-M-07).
- **RPL-M-32** MUST: the "watching now" counter is not inflated: no more than 3 viewer id per IP (`VIEWERS_PER_SOURCE`), a 20 s window (`VIEWER_WINDOW_MS`).
- **RPL-M-33** MUST (decision 51): "per km" pledges are off for the devnet launch: no `#w-pledges` and no form, `POST /api/pledges` → `403 pledges_disabled`. Later — a separate decision (a pledge only before the start, the calculation after the review, `[LAWYER]`).
- **RPL-M-34** MUST (decision 49): an HONK burn into chat on a replay is cosmetics only (a line in chat, a 10 s interval). HONK time/weather are removed (→ RPL-M-17).

## Part 2. Test plan

Levels: **U** — unit (vitest), **S** — an HTTP scenario (`server/test/scenarios/live.scenarios.ts` and new ones, `FakeChain`), **C** — the contract registry ([`backend_contract.md`](backend_contract.md)), **E1** — e2e block 1 from PR #5 (happy-dom + a real server on compose), **E1M** — block 1 with a **mock Solana RPC** (§2.4), **E2** — block 2 (a local validator), **M** — a manual test with a real wallet.

### 2.1 Visibility and the lobby
| id | Rule | Level | Scenario | Expected |
|---|---|---|---|---|
| RPL-T-01 | M-01 | S, E1 | a finished verified 1h ride | `GET /api/watch/:id` 200, present in `GET /api/replays` |
| RPL-T-02 | M-01 | S | a `rejected` ride | publicly `404` and not in the list; the admin sees it |
| RPL-T-03 | M-01 | S | a ride in `review`, then a manual "verified" | `404` before the decision, 200 after |
| RPL-T-04 | M-02 | S, E1 | a training `free-1c` is finished | absent from EVERYONE and from MINE; `watch`, `watch/:id/road`, `/r/:id`, blink → `404` |
| RPL-T-05 | M-02 | S | `tutorial=true` / `assist=true` | same as RPL-T-04 |
| RPL-T-06 | M-02 | E1 | offline guest `free-g` | there is no ride on the server; the client has no "replay" button |
| RPL-T-07 | M-03 | S, E1 | someone else's `running` 1h ride | `watch` → `404`, `watch/:id/road` → `404` (both for a guest and for another player) |
| RPL-T-08 | M-03 | S | the owner of their own `running` | the road plan — only through the driver's ride route; `watch` → `404` |
| RPL-T-09 | M-04 | S, E1 | a pool ride, someone else before `payout_at` | `404` (including another pool participant); after `payout_at` (a fake clock) — 200 |
| RPL-T-10 | M-04 | S | `payout_at` changed in the pool config | visibility follows the on-chain `payout_at` ([`pool.md`](pool.md) POOL-M-02) |
| RPL-T-11 | M-05 | S | the driver — their own pool replay before `payout_at` | 200 with their session; without a session — `404` |
| RPL-T-12 | M-06 | S | a free devnet attempt (not training) | 200 after the verdict; if it is a pool ride — per RPL-T-09 |
| RPL-T-13 | M-07 | U, S | the `watch` response | no `inputs`, no `SAMPLE_INPUT_COL` (or it is zeroed), poses from the recompute (`simHz = 30`); no input highlighting in the UI |
| RPL-T-14 | M-08 | S | a recording older than `TELEMETRY_RETENTION_DAYS` | in the list `replay:false` ("no recording"), `watch` → `404` |
| RPL-T-15 | M-09 | S | admin — a training ride and a `rejected` one | `GET /api/admin/replays` shows them, with a type mark |
| RPL-T-16 | M-10 | E1 | the NEW RIDE lobby | the `TRAINING · NOT IN REPLAYS` badge on the free card and on the levels; a hint under START |
| RPL-T-17 | M-10 | E1 | the training-ride result | the text "Training ride – no replay is published." |
| RPL-T-18 | M-10 | E1 | the REPLAYS tab: footer, empty MINE, a pool ride before `payout_at` in MINE | the texts from the RPL-M-10 table in EN and in RU |
| RPL-T-19 | M-10 | U | `TIER_NAME.free` in `lobby.js`, `ui.js`, `watch-panel.js` | `TRAINING` everywhere |
| RPL-T-20 | M-11 | E1 | the LIVE tab | no `▶ WATCH`, no `#live-random`, a counter is present |
| RPL-T-21 | M-12 | E1 | filters EVERYONE/MINE × ALL/COMPLETED/ABANDONED/FAILED, LOAD MORE | the correct requests (`wallet=`, `status=`, `before=`); training is in no combination; a double LOAD MORE — one request |
| RPL-T-22 | M-12 | S | pagination `before=<endedAt>_<seq>` when `endedAt` values are equal | no gaps and no duplicates |
| RPL-T-23 | M-30 | S | `/r/:id`, blink, `solana-pay/donations/:id` for a hidden ride | `404`, with no OG data |
| RPL-T-24 | M-31 | C | the `WatchDto` schema | no `reason`, no payments, no input; `.strict` on the response |
| RPL-T-26 | M-10a | E1 | `navigator.language = 'ru-RU'`, then `en-US`, then `?lang=en` | RU texts; EN texts; the parameter overrides the browser language |
| RPL-T-27 | M-10a | E1 | the EN/RU switch in the lobby and on the replay panel, a reload | the language is kept (`freightchain.lang`), a redraw without a reload |
| RPL-T-28 | M-10a | U | the `en` and `ru` dictionaries | the same set of keys, no empty values; the lobby and panel DOM have no strings outside the dictionary (a `textContent` scan under RU) |
| RPL-T-29 | M-10a | U, E1 | server error `429 live_rate_limited` under RU | the message from the RU dictionary by code, the date in the `ru` locale |
| RPL-T-25 | M-32 | U, S | 10 viewer id from one IP | the counter ≤ 3 |

### 2.2 Replay player (every element)
Environment: E1 (`watch-panel.js` and `watch.js` under happy-dom, `fetch` mocked to a recorded `GET /api/watch/:id` response) + a golden replay from a fixture (a short 3 min one and a full 1h) + M for feel and for full screen.
| id | Element | Positive | Edge | Negative |
|---|---|---|---|---|
| RPL-T-30 | C1 Play/Pause | ▶ → `playing=true`, ❚❚ → false, the icon changes | 20 rapid presses in a row — the state equals the parity of the presses; on the last frame ▶ — from the beginning (decision 47) | an empty replay: the button is unavailable |
| RPL-T-31 | C2 speeds 1/4/16 | `watch.speed` = x, `sel` on the one pressed, playback starts | a speed change during an unloaded seek (`seeking`) — the target is kept, the speed applies after the load; 16× to the end — the end window appears | — |
| RPL-T-32 | C3 0.5× / 2× | same as RPL-T-31 | 0.5× on the last 2 s | — |
| RPL-T-33 | C4 slider | `seek(120)` → `wt = 120`, "loading…" until the batch loads, then the frame | seek past the end → `replayEnd()`; seek < 0 → 0; seek into an unloaded middle of the 1h → a `from=<seq>` request and the target is held; 10 rapid seeks — only the last target | a replay with no recording: the slider `max = 1`, the text "no recording kept" |
| RPL-T-34 | C5 hole marks | a click on `ignored` → `seek(t − 6)` and play; the NO IMPACT stamp in place | a mark in the first 6 s → seek(0) | no holes — no marks, the line "no planned hole reached yet" |
| RPL-T-35 | C6 event marks | crashes, red, minigames, the finish from `RideResult` | two events in one second — two marks, a click — the first | a ride with no events — start/finish only |
| RPL-T-36 | C7 prev./next event | `]` → the next, `[` → the previous | on the last event `]` — nothing | — |
| RPL-T-37 | C8 steps ±5/±30 | `→` +5 s, `Shift+→` +30 s | at the start/end — clamped | focus in the chat field — the keys do not seek |
| RPL-T-38 | C9 LIVE removed | — | — | `#w-live` is not in the DOM for any replay |
| RPL-T-39 | C10 sound | the first press starts `audio`, the second — mute; `M` does the same | `M` does not fire in the chat field | — |
| RPL-T-40 | C11 map | `N` and the `map` button open and close the map | `N` with autorepeat (`e.repeat`) — once | `N` in the chat field — no |
| RPL-T-41 | C12 F8 | toggles the form shade, a toast | — | it is not written to telemetry (a replay writes nothing) |
| RPL-T-42 | C13 fold | the `folded` class, icon ⇤/⇥ | — | — |
| RPL-T-43 | C14 exit | `#watch-yard` → `/lobby.html`, `#watch-done` → `/` | when `SITE_BASE` ≠ origin | — |
| RPL-T-44 | C15 camera | `C` toggles cab / outside view in the replay | during a seek | — |
| RPL-T-45 | C16 full screen | `F` → `requestFullscreen`, Esc exits | — | happy-dom: check the call; the real one — M |
| RPL-T-46 | C17 HUD | `H` hides the panel and the radio | the slider on hover | — |
| RPL-T-47 | C18 link with `&t=` | open `?watch=<id>&t=600` → start at 600 s, with no jump to 0 | `t` > the length → the end; `t=abc` → 0 | a link to a hidden ride → "NOTHING TO WATCH" (`404`) |
| RPL-T-48 | C19 space | Play/Pause | in the chat field — a space is typed | — |
| RPL-T-49 | C20 badges | `REPLAY · COMPLETED` and the like, time `t / length`, km `s / finishS`, hull | a status change after rejudge — a redraw on the next poll | — |
| RPL-T-50 | C21 ROAD CHECK | the hit/avoided/ignored counters match the batches' `road` | — | — |
| RPL-T-51 | C22 feed | chat and donation lines, an explorer link on paid ones, `(mock)` on mock | 250 lines → 200 in the DOM; a new line scrolls down only if the user was at the bottom | the text `<img src=x onerror=…>` is shown literally |
| RPL-T-52 | C23–C24 sign-in and chat | CONNECT → `signIn` (a tweetnacl mock wallet) → the chat field; Enter = SEND | an empty line — no request; 141 characters — `maxlength` cuts it, the server checks on its own | `401` → `refreshMe()` and the CONNECT button |
| RPL-T-53 | C25 HONK into chat | an HONK line, the button inactive for 10 s | a double click — one request | no HONK balance → the server text `409 honk_balance` |
| RPL-T-54 | C26–C27 removed | — | — | no `#w-honk-day/night/snow/clear` and no effect buttons; API `honk/time`, `honk/weather`, `donations` with `effect≠tip` → `404`/`400` |
| RPL-T-55 | C28–C31 tip donation | §2.3 | — | — |
| RPL-T-56 | C32 pledges | — | — | devnet launch: no `#w-pledges`, `POST /api/pledges` → `403 pledges_disabled` (RPL-M-33) |
| RPL-T-57 | C33 end window | on the last frame a window shows the outcome, the time, km, hull; "BACK TO THE LOBBY" | a seek backward hides the window, reaching the end again shows it (`replay-end.test.mjs` already exists) | a failed replay — "RIDE FAILED" |
| RPL-T-58 | C34 error | `404` → "NOTHING TO WATCH", a link to `#replays` | the network dropped after the load — `watch.error`, the frame stays | — |
| RPL-T-59 | C36 reactions | the reaction is visible in the feed, no money | a limit of 1 / 3 s | on a training ride — `404` |
| RPL-T-60 | a short replay and an empty one | a 5 s replay: play → the end → the window | a ride `failed` on the 2nd second | the recording was deleted → "no recording kept for this ride" |

### 2.3 Donations and chat with a mock blockchain
Environment: **E1M** (§2.4), a server with `SOLANA_RPC=http://mock-rpc:8899`, `LIVE_DONATIONS=on`, `LIVE_FREE_DONATIONS=off`, `LIVE_CHAT=all`. Plus S copies on `FakeChain`. Wallets: `viewerA`, `viewerB`, `driverD`, `refR` (D's referrer), `attackerX` — fixed seeds.
| id | Rule | Scenario | Expected |
|---|---|---|---|
| RPL-T-70 | M-14, M-16 | A donates a `tip` on D's replay: order → sign with the mock wallet → `sendTransaction` to the mock RPC → `confirm` | `{status:'paid'}`; D's balance in the mock ledger **+ exactly `order.lamports`**; A − (lamports + a 5 000 fee); `refR` +0; a feed line with `paid ↗` |
| RPL-T-71 | M-18 | after RPL-T-70 | `GET /api/me/donations` for D — a row (A, amount, note, rideId, signature); `PlayerStats.donationLamports` + the amount; a notification in the lobby |
| RPL-T-72 | M-19 | the same `confirm` again | the same `paid` response, no second line in the feed, the stats did not double |
| RPL-T-73 | M-19 | the same signature for a **different** order | `409 signature_reused` |
| RPL-T-74 | M-19 | the mock in mode `pending:3` | the first 3 `confirm` → `pending`, the 4th → `paid` |
| RPL-T-75 | M-19 | mock `fail` (`meta.err`) | `400 bad_donation_payment`, the order `pending`, D has no money |
| RPL-T-76 | M-19 | mock `drop` (the transaction did not arrive), the blockhash expired | `pending`, then `expired` by TTL (decision 52); a new order works |
| RPL-T-77 | M-19 | `inject`: a transfer to `attackerX` with the order's memo | `400`; D did not receive it; the order is not closed |
| RPL-T-78 | M-19 | the amount is 1 lamport short; no memo; someone else's reference | `400` in each case |
| RPL-T-79 | M-19 | `reconcile` (phone): the transfer is found by reference | `paid`; a race of `confirm` from the desktop and `reconcile` from the phone — one line in the feed |
| RPL-T-80 | M-20 | an order for 0.0009 SOL; for 1.0001 SOL; buttons 0.01 / 0.05 / 0.1 | `400 donation_too_small`; `400 donation_too_large`; three options, each passes RPL-T-70 |
| RPL-T-81 | M-21 | 5 orders in 3 s; a 4th unclosed order | `429 live_rate_limited` with `Retry-After` |
| RPL-T-82 | M-15 | a donation on a training ride, on `running`, on a pool ride before `payout_at` | `404` |
| RPL-T-83 | M-15 | a donation on one's own ride | `403 own_ride` |
| RPL-T-84 | M-17 | a donation, a reaction, a message, HONK on D's replay | `RideResult`, `RideVerdict`, the pool ranking (`GET /api/pools/:id/results`) are unchanged byte for byte |
| RPL-T-85 | M-17 | the old effect routes | `effects/:eventId/applied` → `404`; `effect: 'potholes'` → `400` |
| RPL-T-86 | M-16 | D has a referrer `refR` | the order transaction contains **one** transfer (no `also`); `refR` +0 in the mock ledger; `sumShare` does not grow |
| RPL-T-100 | M-16 | the admin sets `referral_donation_share_bps = 1000` | `400` (the setting is absent or fixed at 0); the default is 0 |
| RPL-T-87 | M-22 | `LIVE_FREE_DONATIONS=on` (mock mode) | `POST donations` `tip` → a `(mock)` line, no money; `donation-orders` → `409 payment_not_needed` |
| RPL-T-88 | M-22 | `LIVE_DONATIONS=off` | no buttons; the API → `403 live_feature_off` |
| RPL-T-89 | M-23 | the feed after payment | the sender, the amount, the note, an explorer link to the signature |
| RPL-T-90 | M-24 | chat without signing in | `401`; reading the replay without signing in — 200 |
| RPL-T-91 | M-25 | `\u202Eabc`, `\u0000`, 141 characters after cleaning, spaces only, `<script>` | bidi/control → a space; >140 → `400 bad_message`; empty → `400`; `<script>` is stored and shown as text |
| RPL-T-92 | M-21 | 2 messages in 1 s; at the edge of the 3 s window | the second is `429`; past the edge — both went through (a known behavior "across a bucket edge") |
| RPL-T-93 | M-26 | A and B write 50 lines interleaved | the order by `id` is the same for both viewers; no duplicates of their own lines |
| RPL-T-94 | M-27 | D mutes A on their own replay | A's lines are gone for B; a new line from A → `403 muted`; turning it back on |
| RPL-T-95 | M-27 | the admin hides a line; `chat_banned` | the line is gone everywhere; a ban → `403 chat_banned` |
| RPL-T-101 | M-27 | a message with `https://…`, with `t.me/…`, with a word from the list (EN and RU) | `400 chat_link_forbidden` / `400 chat_word_forbidden`; the donation's explorer link remains |
| RPL-T-102 | M-33, M-34 | HONK into chat on a replay; `honk/time` | a line in chat, `RideResult` did not change; `honk/time` → `404` |
| RPL-T-96 | M-28 | a fake clock +91 days, the scheduler | messages are deleted, paid donations remain |
| RPL-T-97 | M-29 | a message with `replayT = 300` | shown when playback passes 300 s; on a seek past 300 — in the feed |
| RPL-T-98 | M-15 | chat on `running` / a training ride | `404` |
| RPL-T-99 | M-14 | E2: the same donation through `solana-test-validator` (block 2) | a real transfer, D's balance + the amount (smoke, 1 test) |

### 2.4 Mock blockchain (design)
No browser, in Docker, following the PR #5 approach (code + compose, the wallet is a tweetnacl key).
1. **The `mock-rpc` service** in `docker-compose.e2e.yml`, profile `mockchain`: `node:22-alpine`, `e2e/mockchain/rpc.mjs`, port `127.0.0.1:18899`. It answers the JSON-RPC the server uses (`server/src/infrastructure/solana/solana-chain.adapter.ts`):
   - `getLatestBlockhash` — a deterministic blockhash `bs58(sha256(seed ‖ slot))`, `lastValidBlockHeight = slot + 150`;
   - `getParsedTransaction` — a system transfer (jsonParsed), a memo, `accountKeys` with a reference, `meta.err`, `meta.fee = 5000`;
   - `getSignaturesForAddress` — by reference and by wallet, newest first;
   - `sendTransaction` (base64) — parses the message, checks the ed25519 signature and the blockhash, moves lamports in the ledger, `slot++`;
   - `getSignatureStatuses`, `getBalance`, `getAccountInfo` (minimally), `requestAirdrop` (starting balances), `getHealth`.
2. **Signatures are deterministic.** Ed25519 is deterministic in the key and the message, and the keys and the blockhash are fixed, so the signature is the same on every run. Golden files contain the signatures.
3. **Control (test only):**
   - `POST /__mock/reset`;
   - `POST /__mock/fund {wallet, lamports}`;
   - `POST /__mock/mode {next: 'confirm' | 'pending:N' | 'fail' | 'drop' | 'expire'}`;
   - `POST /__mock/inject {payer, to, lamports, memo, reference}` — incorrect transfers;
   - `GET /__mock/ledger` — balances and the list of transactions.
   
   The control port is not published outside the compose network.
4. **The wallet in tests** `e2e/harness/wallet.mjs`: a `Keypair` from a fixed seed (`tweetnacl`, `bs58` — already in `e2e/package.json`; add `@solana/web3.js` to parse a transaction). It does:
   - sign-in: nonce + verify, as in `B1-LAND-11`;
   - `signTransaction(base64)` — signs the order message;
   - `signAndSend` — the signature + `sendTransaction` to the mock;
   - a standard wallet for happy-dom `window.phantom` — like `FAKE` in `server/scripts/e2e-tickets-stub.mjs`, except it signs for real.
5. **The server** — the real `SolanaChainAdapter` with `SOLANA_RPC=http://mock-rpc:8899`, `SOLANA_RPC_FALLBACKS=''`, with no code changes. This also checks parsing of the RPC responses. The S level keeps `FakeChain` (`server/test/support/fake-chain.ts`).
6. **What the mock does not check** (→ M and E2): real Phantom/Solflare, QR Solana Pay on a phone, the devnet explorer, real fees and delays.

### 2.5 Manual tests (a real wallet is required), a continuation of [`docs/testing/MANUAL_TESTS.md`](../testing/MANUAL_TESTS.md) (PR #5)
| id | What | Steps | Expected |
|---|---|---|---|
| M-RPL-01 | A donation from Phantom (devnet) on a replay | open a public replay, CONNECT, `tip`, confirm in Phantom | a `paid ↗` line, the explorer shows a transfer to the driver for the whole amount |
| M-RPL-02 | A donation from a phone by QR | no extension, scan `#w-qr` with a phone wallet | `reconcile` finds the transfer in ≤ 90 s |
| M-RPL-03 | The driver sees the donation | sign in as the driver, profile → Donations received | the row and the wallet balance |
| M-RPL-04 | Full screen and the camera | `F`, `C`, Esc | works in Chrome and Firefox |
| M-RPL-05 | How seeking feels on a 1h replay | seek along the whole length, 16×, event marks | no stalls > 2 s |
| M-RPL-06 | Lobby and player texts RU/EN (decision 58) | NEW RIDE, REPLAYS, the training result | the texts from RPL-M-10 |

### 2.6 Mapping to PR #5 and the backend scenarios
- **Block 1 (PR #5):** `B1-LOBBY-03` (LIVE) and `B1-LOBBY-04/09` (REPLAYS, MINE) **change** to fit RPL-T-20/21. `B1-LOBBY-21` (the watch and share buttons on the receipt) — check that `watch` does not lead to the current ride. `B1-LAND-26` (loading live and replays on the landing) — `dash-live.js` with no links to current rides. New files:
  - `e2e/block1-offchain/watch/player.test.mjs` (RPL-T-30…60);
  - `e2e/block1-offchain/watch/visibility.test.mjs` (RPL-T-01…25);
  - `e2e/block1-offchain/lobby/training-label.test.mjs`;
  - `e2e/block1-offchain/streams/*.test.mjs` (RPL-T-70…98, profile `mockchain`).
- **Block 2:** `e2e/block2-chain/streams/donation.test.mjs` (RPL-T-99).
- **Server scenarios:** `server/test/scenarios/live.scenarios.ts` (rebuild for the replay), `pledges.scenarios.ts`, `promos-abuse`; routes 106–117, 120, 130, 144–145 from the [`backend_contract.md`](backend_contract.md) registry get matrix B cases (someone else → `404`, decision 9).
- **Existing Chrome scripts** (not called by the happy-dom blocks and not deleted): `server/scripts/e2e-watch.mjs`, `e2e-replay.mjs`, `e2e-live-board.mjs`, `e2e-live-flags.mjs`, `client/tools/e2e-viewer.mjs`, skills `.claude/skills/replay-test`, `live-board-test`. They pin the built live view ([`PRODUCT.md`](PRODUCT.md)). Decision 68 cancelled E2E-M-06. Under RPL-M-03/11 they change only together with the code, when the owner separately accepts dropping live watch.
- **npm scripts (plan):**
  - root: `test:e2e:replays` = `bash e2e/scripts/run.sh replays`; `test:e2e:streams` = `bash e2e/scripts/run.sh streams` (brings up `--profile mockchain`);
  - `e2e/package.json`: `test:replays`, `test:streams`, `mockchain` (`node mockchain/rpc.mjs`);
  - server: `test -- live` / `test -- watch` (a vitest filter), `test:integration -- donation`.

## Part 3. Traceability
| Rule | Tests | Gap |
|---|---|---|
| RPL-M-01 | T-01, T-02, T-03 | — |
| RPL-M-02 | T-04, T-05, T-06, T-15, T-21 | — |
| RPL-M-03 | T-07, T-08, T-38 | — |
| RPL-M-04 | T-09, T-10 | — |
| RPL-M-05 | T-11 | — |
| RPL-M-06 | T-12 | — |
| RPL-M-07 | T-13 | depends on the v2 recompute (Ph1) |
| RPL-M-08 | T-14 | — |
| RPL-M-09 | T-15 | — |
| RPL-M-10 | T-16, T-17, T-18, T-19, M-RPL-06 | — |
| RPL-M-10a | T-26, T-27, T-28, T-29 | no lobby localization — new |
| RPL-M-11 | T-20 | — |
| RPL-M-12 | T-21, T-22 | — |
| RPL-M-13 | T-30 … T-60, M-RPL-04/05 | "build" elements — new code (decision 47) |
| RPL-M-14 | T-70, T-99, M-RPL-01 | — |
| RPL-M-15 | T-82, T-83, T-98 | — |
| RPL-M-16 | T-70, T-86, T-100 | remove the share in the code (`create-donation-order.handler.ts:74`, `game-settings.ts:31`) |
| RPL-M-17 | T-84, T-85, T-54 | — |
| RPL-M-18 | T-71, M-RPL-03 | no `GET /api/me/donations` route — new |
| RPL-M-19 | T-72 … T-79 | order expiry — new (decision 52) |
| RPL-M-20 | T-80 | — |
| RPL-M-21 | T-81, T-92 | — |
| RPL-M-22 | T-87, T-88 | — |
| RPL-M-23 | T-89, T-51 | — |
| RPL-M-24 | T-90 | — |
| RPL-M-25 | T-91, T-51 | — |
| RPL-M-26 | T-93 | — |
| RPL-M-27 | T-94, T-95, T-101 | no admin moderation or filter — new |
| RPL-M-28 | T-96 | no deletion — new |
| RPL-M-29 | T-97 | — |
| RPL-M-30 | T-23 | — |
| RPL-M-31 | T-24 | — |
| RPL-M-32 | T-25 | — |
| RPL-M-33 | T-56 | — |
| RPL-M-34 | T-53, T-102 | — |

Total: 35 rules, all MUST / MUST NOT (decisions 45–58 accepted 17.10.2026). Planned ids: RPL-T-01…29, 30…60, 70…102 and 6 manual M-RPL-01…06. An id is not a written test. Some of these rules diverge from the built product ([`PRODUCT.md`](PRODUCT.md), conflicts). The executable bar is [`../testing/COVERAGE_CONTRACT.md`](../testing/COVERAGE_CONTRACT.md).

Replay polling validates the response before replacing its loaded snapshot. A malformed successful response or aborted JSON body keeps the existing recording available; a later valid response clears the transient error. Real-Chrome replay acceptance includes failed-refresh recovery.

The landing ticker applies public replay visibility before its result limit, with no owner exception: hidden/rejected/training rides neither appear nor crowd eligible finishes out.
