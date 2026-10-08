---
name: live-board-test
description: Test Freight Chain's live board end to end – who is online, which rides are on the road (viewers, paused / weak signal), joining one, abandoned rides being swept, and the replayable ride history – on the landing and in the lobby, in headless Chrome, against a fresh server fed by the ride simulator (fake drivers, visitors and watchers over the API). Also how to run that simulator by hand against a dev server. Use after touching GET /api/live, /api/replays, the stale-ride sweeper, presence counting, the lobby's LIVE / REPLAYS tabs, the landing's boards / chip, or when asked to "test online / live rides / replays history", "simulate rides", or /live-board-test.
---

# The live board – online, on the road, replays

What it covers: `GET /api/live` (`online { total, browsing, watching, driving, players }`, each ride's `viewers` and `signal`), the stale-ride sweeper
(a ride whose tab vanished is ended as *failed · heartbeat lost*), `GET /api/replays` (the history, paged, filtered, `replay` = a recording is kept),
the lobby's LIVE tab (sort, route filter, ▶ WATCH / WATCH A RANDOM ONE = join) and REPLAYS tab, the landing's chip, LIVE NOW and RECENT RIDES boards.

## Run the e2e

```sh
bash .claude/skills/live-board-test/run.sh        # ≈ 2 min
```

It goes through `.claude/skills/run-tests/e2e.sh board`: a throwaway database (dropped at the end, also on failure), the landing + server built, the server
started with `FREE_RIDE_SECONDS=20 TRUST_PROXY=1 HB_TIMEOUT_MS=15000` – TRUST_PROXY so each simulated visitor counts from its own X-Forwarded-For address
(the online counter takes ≤ 3 ids per address), a 15 s heartbeat timeout so the abandoned ride is swept within ~20 s. Then `server/scripts/e2e-live-board.mjs`:

1. starts the simulator: 2 drivers driving (one watched by 2 watchers), 1 that ABANDONS after 12 s, 1 that COMPLETES its 20 s shift, 1 paused; 5 visitors;
2. the API: 5 rides with viewers + signal, `online` = 5 browsing + 2 watching + 5 driving = 12, 5 players; the watched ride shows 👁 2, the paused one `paused`;
3. the landing: the chip `N ONLINE · 5 ON THE ROAD`, this page counted online, LIVE NOW = the 5 rides as watch links (the watched one with 👁 2);
4. the lobby (a signed-in player of its own): the header chip, LIVE with 5 rows (👁, WATCH), sort *most watched* puts the watched ride first, PAUSED shows,
   WATCH A RANDOM ONE opens one of them on its watch page (the "join");
5. the sweep: the abandoned ride is ended (failed · heartbeat lost) and leaves the feed; the completer is COMPLETED with a recording;
6. REPLAYS: the abandoned ride as *FAILED · signal lost*, the completed one with ▶ REPLAY, MINE = the player's own ride (*off the road*, no recording),
   the COMPLETED filter; ▶ REPLAY opens it as a replay with its samples;
7. the landing's RECENT RIDES: the finished rides, the recorded one as a ▶ REPLAY link; a phone-width shot;
8. closing pages: navigating the lobby away drops it from `online.browsing` within 5 s (the `pagehide` → `leave=1` poll), and closing a real game tab
   mid-ride ends that ride at once as ABANDONED (the `sendBeacon` to `/end`) – off LIVE, one driver less, in REPLAYS; Back to that tab does not drive on
   (a back/forward-cache restore reloads: "this ride is abandoned"); no page errors.

Then **look at the screenshots** (`$TMPDIR/fc-board-shots/`: `landing-boards`, `landing-recent`, `lobby-live`, `lobby-replays`, `lobby-replays-phone`):
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
