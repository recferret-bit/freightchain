---
name: replay-test
description: Test Freight Chain's live streams and replays end to end in real headless Chrome – a driver and a spectator browser against a freshly built server on a throwaway database. Checks the live watch page (replay of the recording ~25 s behind, CB chat, mock NIGHT / SINKHOLE donations applied by the driver's game and seen in the replay, the effect window, the viewer count) and the replay of a finished ride (the landing ticker's link, REPLAY mode from the start, 1× vs 16×, timeline seeks, night from the clock column, the paid hole placed from history, the end of the ride, an unknown ride, the phone layout). Use after touching client/js/watch.js, ui/watch-panel.js, ui/live-feed.js, live-effects.js, telemetry.js, world/holes.js, the server's live module, or when asked to "test replays", "test live streams / donations", "check the watch page", or /replay-test.
---

# Replays and live streams – end to end

Everything this feature does is described in `docs/replay-and-donations/index.html` (read it first if the feature is new to you). This skill proves it works in a real browser.

## Run

From the repo root:

```sh
bash .claude/skills/replay-test/run.sh            # both suites, ~7 min
bash .claude/skills/replay-test/run.sh watch      # only the live stream (~3 min)
bash .claude/skills/replay-test/run.sh replay     # only the replay of a finished ride (~4 min)
```

It goes through `.claude/skills/run-tests/e2e.sh`: a throwaway database `freightchain_e2e_<pid>` in the compose PostgreSQL (started if down), migrated, the landing + server built, the server started on a free port with `FREE_RIDE_SECONDS=300` (a shift long enough to stay live while the test drives), then dropped again – also on failure. It never touches the dev database, the shared `freightchain_test`, or production. Chrome DevTools ports are picked free, so it can run next to another session.

Both scripts drive a headless driver: it can't really steer, so it presses keys like a person and grows the distance with the game clock at 20 m/s (under the governor). Headless Chrome runs the game clock at ~0.4× wall time – the scripts wait on `__game` state, never on fixed sleeps, except the 21 s effect window.

## What each suite checks

**watch** – `server/scripts/e2e-watch.mjs`, two Chromes on one LIVE ride:
- the spectator opens `play.html?watch=<id>` signed out: watch mode on the driver's seed + route, no menu, CONNECT WALLET offered, the replay has 14-column samples, the truck moves, the driver's CB shows "1 watching";
- signed in: chat box + 6 donation buttons; a typed line reaches the driver's CB panel;
- NIGHT → the driver's day turns to night and the effect is stamped; a second effect right after is refused with the wait (or a NOTE if the clicks straddled a window boundary); 21 s later SINKHOLE → placed ≥ 500 m ahead, the same hole (type, place, lane) on the driver's road AND in the replay; the spectator's own feed shows "✓ on the road" (the `since` stamps);
- a seek into an unloaded part holds its target and plays from there; seeking to the night shows night;
- the driver ends: the page becomes a read-only REPLAY; the feed totals are kept; no page errors on either side.

**replay** – `server/scripts/e2e-replay.mjs`, a FINISHED ride:
- records ~45 game s with NIGHT and SINKHOLE paid through the API (both applied + stamped), a chat line, then ends the shift and checks the recording is kept;
- a signed-out visitor finds the ride in the LANDING's ticker and follows its link: REPLAY mode, starts at t ≈ 0, speeds shown / LIVE hidden, timeline = the recording, read-only feed with both stamps;
- 16× plays > 4× faster than 1×; the paid sinkhole is on the road from the start where the driver's game put it; a seek before the night shows day, after it night (the clock column); playing to the end holds the last frame and says "end of the ride"; a recorded hit's red flash fades; no traffic (it is not recorded);
- an unknown ride id shows NOTHING TO WATCH; phone layout screenshot; no page errors.

## Then look

The scripts cannot judge looks. Read the screenshots with the Read tool:
- `$TMPDIR/fc-watch-shots/`: `watch-signed-out`, `watch-desktop`, `watch-night`, `watch-phone`, `driver-cb`;
- `$TMPDIR/fc-replay-shots/`: `replay-start`, `replay-night`, `replay-end`, `replay-phone`, `replay-missing`.

Eyeball: the panel doesn't cover the road on desktop and is a bottom sheet on a phone; the CB panel clears the left mirror and the centre toast; no permanent red tint or shake in a replay; the night really is dark (it fades in over ~3 s); the sinkhole's cones and warning sign show ahead in `replay-end` / `watch` shots when the truck is near; feed lines are readable and mark "✓ on the road".

## Report

Say plainly: which checks passed (the `ok` lines), which failed (the `FAIL` lines with their detail, and the server log the runner names), any `NOTE`, and what still needs a human: the feel of the replay (smoothness, trailer swing, cab sway), the ~25 s lag as a viewer, a real Phantom signing in on the `ride.*` host (the message names it – only checked with a fake wallet and `curl`), and real traffic (a replay shows none, by design).

## When it fails

- `Chrome did not open a debugging port` – a headless Chrome from an aborted run is still alive: `pkill -f fc-prof-` and rerun.
- `server did not start` – read the log path it prints; usually PostgreSQL is down (`npm run db:up`) or a migration failed.
- The driver never uploads its first batch – the game didn't boot or START failed: look at the driver's page errors in the output.
- A seek / night check flakes – headless frame rates vary; rerun once before digging. Real failures repeat.
- Fixing the feature: the code map is at the end of `docs/replay-and-donations/index.html`; server unit / integration specs for it live under `server/test/**/live*`.
