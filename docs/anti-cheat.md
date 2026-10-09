# Anti-cheat summary (verified play, rules v2)

As of **Oct 9, 2026** – on `main`, commit `c878865` and later; production still runs rules v1 in shadow mode until the next deploy.
Code: `server/src/domain/verdict/` (the judge), `server/src/domain/rides/ride-challenge.ts` (dispatch prompts), `server/src/domain/telemetry/` (batches, summaries),
`client/js/telemetry.js` + `client/js/prompt.js` (the recorder and the prompt banner). Player-facing explainer: `docs/verified-play/index.html`.
Status, the owner's checklist and the open follow-ups: `docs/verified-play-next-steps.md`. The whitepaper repeats this page in chapter 06.

## What the problem is

A ride pays (or ranks) only if a person drove it for the whole shift. The game runs in the player's browser, so nothing the client says can be
trusted on its own: a modified game can finish instantly, a script can press keys, a bot can play the real game. The server cannot re-simulate the
drive (floats, a variable time step, randomness), so it does the next best thing: it demands a **recording** it can validate, measures how **human**
the hands behind it look, and **asks for things during the ride** that only someone watching the screen can answer.

## The layers, from cheapest to strongest

| Layer | What it catches | Verdict power | Where |
|---|---|---|---|
| **Server-timed shift** – driven seconds come from heartbeats capped by wall time; distance may grow at most 28 m/s × 1.2 between beats; no heartbeat for 150 s ends the ride | an instant finish, a speed hack between beats, a vanished tab | the ride FAILS or is ABANDONED (no verdict needed) | `Ride.applyReport`, the stale-ride sweeper |
| **The recording** – every key / dash-button press and release (wall-clock ms) and a 10 Hz sample of the truck, uploaded every 15 s in SHA-256 hash-chained batches; the server recomputes every hash on arrival | an edited recording (`hash-mismatch`), a missing or re-ordered batch (`missing-batches`, `chain-broken`), one chained to another ride | reject | `telemetry.js`, `RideBatch.accept`, `recording-checks.ts checkChain` |
| **Physics bounds** on the samples – under the governor (28 m/s × 1.05), no step the truck cannot make (× 1.2 + 2 m, also across batch boundaries), in time order, well-formed | speed hacks, teleports, junk rows | reject (`over-governor`, `teleport`, `sample-out-of-order`, `bad-sample`) | `checkSamples` over the batch summaries |
| **Agreement with the ride** – the recording ends where the ride ended (30 m + 1 %, lost tail allowed) and covers the driven time (< 50 % rejects, < 90 % flags); a truck that moved > 50 m has inputs and gas presses | a recording for a different drive, cut-out hours, a car driven with no hands | reject (`recording-mismatch`, `recording-incomplete`, `no-inputs`, `no-throttle-input`), flag (`recording-gaps`) | `checkAgreement`, `checkInputsPresent` |
| **Budgets per ride** – game seconds ≤ wall × 1.05 + 30, batches ≤ wall ÷ 5 + 10, bytes ≤ wall × 4 kB + 256 kB; per batch 96 kB / 400 samples / 2000 events | uploading a made-up recording faster than real time, storage floods | the batch is refused (400) and the chain stops there | `Ride.recordingAllowance`, `UploadBatchHandler` |
| **Human timing** – per key, holds that barely vary (CV < 8 % over 6+ holds); the 3 most common press-to-press gaps (1 ms buckets) covering > 60 %; > 30 % of presses released within 10 ms. No opinion under 8 presses; coarse browser clocks (Firefox privacy mode, Tor) detected and the two checks they break skipped | macros, key-spamming scripts, synthetic events | flag only (`uniform-holds`, `repeated-timings`, `instant-presses`) | `human-checks.ts` |
| **Dispatch prompts** – about every 240 s of driving (≤ 4 per short shift, randomised 0.6–1.4 intervals) the heartbeat response names one cab action: FLASH YOUR HEADLIGHTS (L), RUN THE WIPERS (R), SWITCH THE CAB LIGHT (C), SPRAY THE WASHER (X), key or dash button, 20 s window, an amber banner on the windscreen; the judge looks for that press in the recording | a bot driving the real game without reading the screen (`challenges-ignored`: ≥ 50 % of ≥ 3 prompts missed), a script reading the heartbeat and pressing at once (`challenge-reflex`: median answer < 80 ms) | reject / flag (`challenge-missed` for fewer misses) | `ride-challenge.ts`, `Ride.issueChallenge`, `challenge-checks.ts`, `client/js/prompt.js` |
| **Human review** – flagged rides wait in the admin queue; accept / reject / re-judge are signed by the admin's wallet for that exact ride and audited; a late upload never overturns a decision | everything the statistics only suspect | the final word | `admin.<apex>`, `VerdictService.override` |

Any `reject` → **rejected**; else any `flag` → **flagged** (held off the boards until reviewed); else **verified**. Only verified paid shifts rank
(`VERDICT_ENFORCE`; production is still in shadow mode, where verdicts are shown but ignored by the boards).

## Fairness rules (what keeps honest players safe)

- Timing statistics never reject on their own; a person reviews them.
- A lost final upload only costs coverage: the distance the missing seconds explain is allowed, and the server keeps taking batches for 60 s after the end.
- A batch the browser could not fingerprint is kept and only flagged (`unhashed-batch`) – the server fingerprinted it itself; a *wrong* fingerprint still rejects.
- Prompts: fewer than 3 issued never reject; a prompt still open when the ride ended is not judged; the reaction threshold (80 ms) sits far under the
  ~250 ms a person needs, and the one-way network delay only makes a real reaction read shorter, so a slow link cannot make a person look scripted.
- Coarse browser clocks are detected; empty key codes (OEM / IME keyboards) are accepted.
- Recordings are deleted after 90 days (flagged ones kept until reviewed); the sign-in log (wallet, time, IP, browser) after 180 days.

## Operating it

- **Shadow mode → enforcement**: play real rides, read the reasons with the `prod-db` queries, tune `verdict-rules.ts` (bump `RULES_VERSION`), deploy,
  then `node dist/cli/index.js verdict:rejudge --dry-run` / without, to judge old rides at the new rules (admin decisions are kept, swept recordings skipped,
  one audit row). Then `VERDICT_ENFORCE=true` in `deploy/.env`.
- **Knobs**: `CHALLENGE_INTERVAL_SECONDS` (240; 0 = no prompts), `TELEMETRY_RETENTION_DAYS` (90), `SIGNIN_RETENTION_DAYS` (180), `VERDICT_ENFORCE`.
- **Tests**: `npm run server:test` + `npm run server:integration` (unit, scenarios on memory and PostgreSQL), and the `verified-play-test` skill –
  a person and a metronome bot in real Chrome, nine API-level bots (no inputs, instant answers, teleport, over-governor, tampered hash, unhashed batch,
  broken link, byte budget, clean), the CLI – every case positive and negative.
- **Investigating a ride**: the `ride-investigate` skill; the admin page shows the reasons, the scores (`recording`, `human`, `challenges`) and the batch index.

## Limits, said plainly

- No re-simulation: a careful bot playing the real game with human-like timing AND reading the prompts passes the automatic checks. The prompts raise
  the bar from "feed a plausible recording" to "run the real game and parse the screen or the heartbeat"; the reflex check catches the lazy version of that.
- Thresholds are first guesses, including the prompt ones (interval, window, reject share, 80 ms); none has met real players yet.
- No captcha at ride start (skipped for now) – a wallet farm can take free rides; the five-per-day cap and rate limits are the only brake.
- Reaction time is measured against the server's issue time without a per-ride clock-offset estimate; the next step up if bots on slow links appear.
- The design document's fixed-tick, fixed-point replay core (input ratchet, proof-of-render) remains the long-term target, not the build.
