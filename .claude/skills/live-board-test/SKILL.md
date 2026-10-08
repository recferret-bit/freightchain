---
name: live-board-test
description: Test Freight Chain's live board end to end – who is online, which rides are on the road (viewers, paused / weak signal), joining one, abandoned rides being swept, a CLOSED page / game tab leaving at once (one origin and split hosts), and the replayable ride history – on the landing and in the lobby, in headless Chrome, against a fresh server fed by the ride simulator (fake drivers, visitors and watchers over the API). Also how to run that simulator by hand against a dev server. Use after touching GET /api/live, /api/replays, the stale-ride sweeper, presence counting, the lobby's LIVE / REPLAYS tabs, the landing's boards / chip, or when asked to "test online / live rides / replays history", "simulate rides", or /live-board-test.
---

# The live board – online, on the road, replays

What it covers: `GET /api/live` (`online { total, browsing, watching, driving, players }`, each ride's `viewers` and `signal`), the stale-ride sweeper
(a ride whose tab vanished is ended as *failed · heartbeat lost*), `GET /api/replays` (the history, paged, filtered, `replay` = a recording is kept),
the lobby's LIVE tab (sort, route filter, ▶ WATCH / WATCH A RANDOM ONE = join) and REPLAYS tab, the landing's chip, ticker (live rides link to the watch page) and RECENT RIDES board.

## Run the e2e

```sh
bash .claude/skills/live-board-test/run.sh        # ≈ 6 min: e2e.sh board close close-split
```

It goes through `.claude/skills/run-tests/e2e.sh board close close-split`: a throwaway database (dropped at the end, also on failure), the landing + server built, the server
started with `FREE_RIDE_SECONDS=20 TRUST_PROXY=1 HB_TIMEOUT_MS=15000` – TRUST_PROXY so each simulated visitor counts from its own X-Forwarded-For address
(the online counter takes ≤ 3 ids per address), a 15 s heartbeat timeout so the abandoned ride is swept within ~20 s. Then `server/scripts/e2e-live-board.mjs`:

1. starts the simulator: 2 drivers driving (one watched by 2 watchers), 1 that ABANDONS after 12 s, 1 that COMPLETES its 20 s shift, 1 paused; 5 visitors;
2. the API: 5 rides with viewers + signal, `online` = 5 browsing + 2 watching + 5 driving = 12, 5 players; the watched ride shows 👁 2, the paused one `paused`;
3. the landing: the chip `N ONLINE · 5 ON THE ROAD`, this page counted online, the ticker links live rides as watch links (the LIVE NOW card was removed);
4. the lobby (a signed-in player of its own): the header chip, LIVE with 5 rows (👁, WATCH), sort *most watched* puts the watched ride first, PAUSED shows,
   WATCH A RANDOM ONE opens one of them on its watch page (the "join");
5. the sweep: the abandoned ride is ended (failed · heartbeat lost) and leaves the feed; the completer is COMPLETED with a recording;
6. REPLAYS: the abandoned ride as *FAILED · signal lost*, the completed one with ▶ REPLAY, MINE = the player's own ride (*off the road*, no recording),
   the COMPLETED filter; ▶ REPLAY opens it as a replay with its samples;
7. the landing's RECENT RIDES: the finished rides, the recorded one as a ▶ REPLAY link; a phone-width shot;
8. no page errors.

Then **closing pages** – `server/scripts/e2e-close.mjs` (no simulator; a 20 s free shift), once on one origin (`close`) and once on SPLIT HOSTS (`close-split`:
landing + lobby on `app.localhost`, the game + watch page on `ride.app.localhost`, the API on `api.app.localhost`, the session cookie on the apex – what
production does; Chrome resolves `*.localhost`, `--host-resolver-rules` sends port 80 to the server). Each check has a 5–8 s budget (without the close
signal it would take 30 s / 3 min):
1. the landing and the lobby: counted in `online.browsing` while open, gone after `about:blank` (= closing the tab: `pagehide` → the poll with `leave=1`);
2. the watch page: the ride's 👁 and `online.watching` drop to 0 (it waits until the page is fully booted – a close mid-boot, while software WebGL holds the
   main thread, can lose the beacon and falls back to the 30 s window);
3. a game tab closed mid-ride: the ride is ABANDONED at once (the `sendBeacon` to `/end`), off LIVE, one driver less;
4. Back to it: the page comes from the back/forward cache and `pageshow` reloads it (navigation type `reload` – proves the cache path, not a fresh load),
   showing "this ride is abandoned" and no START;
5. a COMPLETE shift whose tab closes right after a batch went up: COMPLETED (no END SHIFT) and VERIFIED – a lost tail only costs coverage (a whole lost
   batch of a short shift is FLAGGED `recording-gaps`, never rejected: `verdict.scenarios.ts`);
6. split hosts only: the game really ran on `ride.<apex>` with `API_BASE = api.<apex>`; no page errors.

Then **look at the screenshots** (`$TMPDIR/fc-board-shots/` – e2e-close has no screenshots worth a look: `landing-boards`, `landing-recent`, `lobby-live`, `lobby-replays`, `lobby-replays-phone`):
the boards are readable (2 × 2 on the landing), filters show which one is on, the badges (PAUSED, FAILED · signal lost, COMPLETED) are clear.

## The simulator by hand

`server/scripts/sim-rides.mjs` is a tool on its own – to fill a dev server with traffic before looking at the pages, or to reproduce a report:

```sh
npm run server:dev                                   # (other terminal) – TRUST_PROXY=1 in server/.env to count visitors per fake address
node server/scripts/sim-rides.mjs --base http://localhost:3000 --drive 3 --abandon 1 --complete 1 --pause 1 --visitors 5 --watchers 2 --seconds 180
```

Flags: `--drive` (keep driving), `--abandon` (stop after `--abandon-after` s, default 12 – the sweeper ends it after HB_TIMEOUT_MS), `--complete` (drive the
free shift, then /end – needs FREE_RIDE_SECONDS on the server), `--pause` (beats with `paused`), `--visitors` (poll /api/live as landing / lobby),
`--watchers` (poll the first driver's watch page), `--seconds` (how long). It prints one JSON line per event (`driver`, `abandoned`, `completed`, `done`).
Every driver is a fresh wallet on the dev database – it uses free rides only, nothing is paid. Never point it at production.

## Report

Say which checks passed (`ok`), which failed (`FAIL` + the server log path), and what a human should still look at: the boards' layout at your screen width,
the numbers being SOFT (in memory, one app process – a deploy resets them), and real users from one office counting as at most 3 per address.
