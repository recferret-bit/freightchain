---
name: verified-play-test
description: Test Freight Chain's anti-bot / anti-cheat (verified play) end to end, positive AND negative – a person and a metronome bot driving in real headless Chrome (dispatch prompts answered / ignored), API-level bots with hand-built recordings for EVERY verdict code (no inputs, instant prompt answers, a teleport, a speed over the governor, a batch edited after hashing, an unhashed batch, a broken chain link, a hole in the seqs, a recording that does not match / cover the ride, steering without gas, malformed samples, scripted timing, a coarse timer, batches sent after /end), the upload protocol (401 / 404 / 409 / 400), who may see a verdict, the admin's signed decisions on a flagged ride, the lobby profile in Chrome, and the retention sweep + the CLI's bulk re-judge on the database – against a freshly built server on a throwaway database. Use after touching client/js/telemetry.js, prompt.js, online.js, the server's verdict / telemetry / rides domain, the heartbeat, the batch upload, verdict-rules.ts, the retention sweeps, or when asked to "test the anti-cheat", "test verified play", "test the prompts", or /verified-play-test.
---

# Verified play – the anti-cheat, positive and negative

What it covers (how the checks work: `docs/verified-play/index.html`; the thresholds: `server/src/domain/verdict/verdict-rules.ts`; the status page: `docs/verified-play-next-steps.md`):
the recording (hash-chained batches, the server's own hashes, bounds, agreement with the ride, coverage, the per-ride time / batch / byte budgets),
the human-timing statistics (flags only), the **dispatch prompts** – the server asks for a key through the heartbeat ("FLASH YOUR HEADLIGHTS · PRESS L"),
the recording must show it pressed within 20 s; most prompts ignored rejects, instant answers flag – the admin's hand on the review queue, the retention sweep, and the CLI that re-judges old rides after a rules change.

## Run it

```sh
bash .claude/skills/verified-play-test/run.sh              # ≈ 9 min: e2e.sh verified verified-deep browser close
bash .claude/skills/run-tests/e2e.sh verified             # prompts (≈ 3 min)
bash .claude/skills/run-tests/e2e.sh verified-deep        # every verdict code, protocol, admin, profile, retention (≈ 2.5 min)
```

`e2e.sh` builds the server and the landing into private copies, creates a throwaway database (dropped at the end, also on failure), starts the server (a
fresh one per suite) and runs the script. Headless Chrome runs the game at ~0.4× wall time, so the API drivers keep their own clock (a 30 / 40 s shift in wall time).

### `verified` – the dispatch prompts (`server/scripts/e2e-verified-play.mjs`)
Server: `FREE_RIDE_SECONDS=40 CHALLENGE_INTERVAL_SECONDS=8` – a prompt about every other heartbeat (the interval is capped at a quarter of the shift). Four groups AT ONCE:
- **A. a person in Chrome** – real CDP key events with jittered holds and gaps; `answerPrompts` (`client/tools/cdp.mjs`) presses the prompt's key 0.4–1.2 s after the banner shows → `COMPLETED · VERIFIED`. Screenshot `human-prompt.png`.
- **B. a bot in Chrome** – the same hold and gap every time, never reads the banner → `REJECTED` + `challenges-ignored` + the timing flags; the end panel says so.
- **C. API bots** – `clean` verified · `no-inputs` · `instant-answers` (8 ms) → flagged `challenge-reflex` only · `teleport` · `over-governor` · `tampered` · `unhashed` (flag only) · `wrong-link` · the byte budget (400 `bad_batch`).
- **D. the CLI** – `verdict:rejudge --dry-run` / real / `--status flagged`, `retention:sweep`.

### `verified-deep` – everything else (`server/scripts/e2e-verified-deep.mjs`)
Server: `FREE_RIDE_SECONDS=30 CHALLENGE_INTERVAL_SECONDS=0 ADMIN_WALLETS=<a generated admin>` – prompts OFF so each check is judged alone; the reason codes are compared as a SET, so "nothing else wrong" is part of every case.
- **A. 16 shifts at once** (`drive()` builds the recording by hand, in the game's own batch shape + hash chain):

| case | verdict | reason codes |
|---|---|---|
| clean · clean + a garbage traffic track (dropped, never refused) · batches sent only after `/end` (re-judged on arrival) | verified | – |
| a coarse 100 ms timer (the two checks it would break are skipped; `timerStepMs` 100) · five presses (below `HUMAN_MIN_PRESSES`) | verified | – |
| no recording at all | rejected | `no-recording` |
| a hole in the seqs | rejected | `missing-batches` |
| recording ends 400 m from the ride | rejected | `recording-mismatch` |
| recording covers 45 % of the time | rejected | `recording-incomplete` |
| steering only, no gas | rejected | `no-throttle-input` |
| a sample row with 5 values · a sample outside its batch | rejected | `bad-sample` · `sample-out-of-order` |
| recording covers 75 % (a slow clock) | flagged | `recording-gaps` |
| metronome holds · three fixed gaps · down+up in one tick | flagged | `uniform-holds` · `repeated-timings` · `instant-presses` |

  (the teleport / over-governor / tampered / unhashed / wrong-link cases live in `verified`).
- **B. the upload protocol** – before the start 409 · no session 401 · another wallet / unknown ride 404 · negative seq and a bad body 400 · ends-before-start, more driving than time, too many batches, too many samples → `bad_batch` · a good batch stored · a duplicate seq `stored:false` · a wrong hash stored with `hashOk:false` · garbage traffic 200.
- **C. who sees a verdict** – the owner yes, another wallet 404, the public `/api/watch/:id` never (no reasons, no input events), the free board ranks completed free rides whatever their verdict.
- **D. the admin** (a real ed25519 wallet signs every change) – the queue lists exactly the flagged rides · the ride detail's scores (clean: ≥ 3 batches, coverage ≥ 0.9, nothing unhashed; coarse timer detected; five presses; slow clock ≈ 0.75) · a decision signed over the wrong text 401 · ACCEPT → verified + override + note, reasons kept, leaves the queue · RE-JUDGE replaces it · REJECT on any ride · a player session reaches nothing (404).
- **E. the lobby profile in Chrome** – FLAGGED for one wallet, VERIFIED for another (`profile-flagged.png`, `profile-verified.png`), no page errors.
- **F. retention + bulk re-judge on the database** – rides aged 120 days by SQL: `retention:sweep` deletes verified + rejected recordings, keeps flagged ones and a completed shift that has no verdict, is idempotent, keeps ride rows + verdicts; a swept ride's watch page opens without batches; the admin's RE-JUDGE on it is 409 `recording_deleted`; `verdict:rejudge` skips exactly the swept ones, changes a verdict edited back to "old rules" (verified → flagged), judges the one with no verdict (null → verified); `--status flagged` narrows.

## What to look at

- `$TMPDIR/fc-verified-shots/human-prompt.png` – the amber DISPATCH banner on the windscreen with the key and the time bar: readable at a glance? `human-done.png` / `bot-done.png`: the end panel's verdict line.
- `$TMPDIR/fc-verified-deep-shots/profile-*.png` – the lobby profile's verdict chips.
- The server log (`/tmp/fc-e2e-<db>.log`): one `verdict` line per ride with its reason codes; `batch-refused` for refused uploads.

## When a check fails

1. Read the `FAIL` line: it prints the status, the reason codes and the receipts. A cascade in D / F after a failing A case is usually the same root cause (the flagged ride is used downstream).
2. Reproduce one case: `drive({ name, ...options })` in `e2e-verified-deep.mjs` is one shift; add a case to `SCENARIOS` = `[name, options, status, codes]`.
3. If the harness is right and the rules changed on purpose: update `verdict-rules.ts` AND this table AND `docs/verified-play/index.html`, bump `RULES_VERSION`.
Sensitivity was proved by mutation: loosening `HOLD_CV_MIN` to 0 and `COVERAGE_REJECT` to 0.4 turns exactly the metronome and 45 %-coverage cases red (plus what depends on them). Do that again after adding a check.

## Tuning the thresholds

`verdict-rules.ts` → bump `RULES_VERSION`, run `npm run server:test`, then re-judge what is already judged: `node dist/cli/index.js verdict:rejudge --dry-run`
(production: `docker compose exec app node dist/cli/index.js verdict:rejudge --status flagged` from `/srv/freightchain` – only after the user asks).
`prod-db` has the queries (`reasons`, `scores`) to see which checks fire on real rides. Dispatch prompts: `CHALLENGE_INTERVAL_SECONDS` (240 s;
0 = off), window 20 s, reject when ≥ 50 % of ≥ 3 prompts are ignored, flag when the median reaction is under 80 ms.

## Related skills

`run-tests` (the whole pyramid; `e2e.sh` hosts both suites) · `replay-test` (the watch page and replays of the same recordings) · `prod-db` / `ride-investigate` (verdicts of real rides) · `test-census` (counts these suites, grades the verified-play feature).

## Report

Say which checks passed (`ok`) and failed (`FAIL`, with the server log path), that the harness drives its own clock (headless Chrome runs the game at ~0.4×),
and what still needs a person: real Phantom on `ride.*`, real rides for the threshold tuning, the paid boards (they need paid tickets – only the free board is checked here),
and whether the banner is noticeable while actually driving.
