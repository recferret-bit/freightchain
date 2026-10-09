---
name: verified-play-test
description: Test Freight Chain's anti-bot / anti-cheat (verified play) end to end, positive AND negative – a person and a metronome bot driving in real headless Chrome (dispatch prompts answered / ignored), API-level bots with hand-built recordings (no inputs, instant prompt answers, a teleport, a speed over the governor, a batch edited after hashing, an unhashed batch, a broken chain link, a recording bigger than the time allows), and the CLI's bulk re-judge and retention sweeps – against a freshly built server on a throwaway database. Use after touching client/js/telemetry.js, prompt.js, online.js, the server's verdict / telemetry / rides domain, the heartbeat, the batch upload, verdict-rules.ts, the retention sweeps, or when asked to "test the anti-cheat", "test verified play", "test the prompts", or /verified-play-test.
---

# Verified play – the anti-cheat, positive and negative

What it covers (how the checks work: `docs/verified-play/index.html`; the thresholds: `server/src/domain/verdict/verdict-rules.ts`):
the recording (hash-chained batches, the server's own hashes, bounds, agreement with the ride, coverage, the per-ride time / batch / byte budgets),
the human-timing statistics (flags only), and the **dispatch prompts** – the server asks for a key through the heartbeat ("FLASH YOUR HEADLIGHTS · PRESS L"),
the recording must show it pressed within 20 s; most prompts ignored rejects, instant answers flag. Plus the CLI that re-judges old rides after a rules change.

## Run it

```sh
bash .claude/skills/verified-play-test/run.sh        # ≈ 6 min: e2e.sh verified browser close
bash .claude/skills/run-tests/e2e.sh verified        # only the verified-play harness (≈ 3 min)
```

`e2e.sh` builds the server and the landing into private copies, creates a throwaway database (dropped at the end), and starts the server with
`FREE_RIDE_SECONDS=40 CHALLENGE_INTERVAL_SECONDS=8` – a 40 s free shift with a prompt about every other heartbeat (the interval is capped at a quarter of
the shift, so short test shifts get prompts too). Then `server/scripts/e2e-verified-play.mjs` runs four groups AT ONCE:

- **A. a person in Chrome** – real CDP key events with jittered holds and gaps; `answerPrompts` (`client/tools/cdp.mjs`) presses the prompt's key 0.4–1.2 s
  after the banner shows → `COMPLETED · VERIFIED`, the prompts answered in the verdict's scores, no batch refused, no page errors. Screenshot `human-prompt.png`.
- **B. a bot in Chrome** – the same hold and gap every time, never reads the banner → `REJECTED` with `challenges-ignored`, and the timing flags
  (`uniform-holds` / `repeated-timings`) beside it; the end panel says so.
- **C. API-level bots** (no browser; the batch shape and hash chain of `client/js/telemetry.js`, like `scripts/sim-rides.mjs`), one ride each, in parallel:
  `clean` → verified · `no-inputs` → rejected · `instant-answers` (8 ms after the heartbeat) → flagged `challenge-reflex` only · `teleport` → rejected ·
  `over-governor` → rejected · `tampered` (hash of other content) → rejected `hash-mismatch` · `unhashed` (hash null, the next linked to `unhashed-1`) →
  flagged `unhashed-batch` ONLY · `wrong-link` → rejected `chain-broken` · the **byte budget**: 2 s into a ride, 40 kB batches until a 400 `bad_batch`.
- **D. the CLI** on the same database (`CLI` + `DATABASE_URL`): `verdict:rejudge --dry-run` lists every completed shift and judges none; the real run
  judges them all at the same rules and changes nothing; `--status flagged` narrows; `retention:sweep` runs both sweeps (nothing old enough).

Then `browser` (the game e2e, which now answers prompts) and `close` (a complete shift closed by its tab is still VERIFIED).

## What to look at

- `$TMPDIR/fc-verified-shots/human-prompt.png`: the amber DISPATCH banner on the windscreen with the key and the time bar – readable at a glance?
  `human-done.png` / `bot-done.png`: the end panel's verdict line.
- The server log (`/tmp/fc-e2e-<db>.log`): one `verdict` line per ride with its reason codes; `batch-refused` for the byte-budget ride.

## Tuning the thresholds

`verdict-rules.ts` → bump `RULES_VERSION`, run `npm run server:test`, then re-judge what is already judged: `node dist/cli/index.js verdict:rejudge --dry-run`
(production: `docker compose exec app node dist/cli/index.js verdict:rejudge --status flagged` from `/srv/freightchain` – only after the user asks).
`prod-db` has the queries (`reasons`, `scores`) to see which checks fire on real rides. Dispatch prompts: `CHALLENGE_INTERVAL_SECONDS` (240 s;
0 = off), window 20 s, reject when ≥ 50 % of ≥ 3 prompts are ignored, flag when the median reaction is under 80 ms.

## Report

Say which checks passed (`ok`) and failed (`FAIL`, with the server log path), that the harness drives a fake clock (headless Chrome runs the game at ~0.4×),
and what still needs a person: real Phantom on `ride.*`, real rides for the threshold tuning, and whether the banner is noticeable while actually driving.
