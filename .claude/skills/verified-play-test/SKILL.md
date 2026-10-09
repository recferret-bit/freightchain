---
name: verified-play-test
description: The anti-bot / anti-cheat end to end, positive and negative: a person and a bot in Chrome (verified / flagged on input timing), API-level bots with hand-built recordings (every verdict code), the server's road, the upload protocol, the admin's signed decisions, the profile in Chrome, retention + the CLI's bulk re-judge. Use after touching client/js/telemetry.js, online.js, the server's verdict / telemetry / rides domain, the heartbeat, the batch upload, verdict-rules.ts, the retention sweeps, or when asked to test the anti-cheat, test verified play, or /verified-play-test.
---

# Verified play – the anti-cheat, positive and negative

What it covers (how the checks work: `docs/verified-play/index.html`; the thresholds: `server/src/domain/verdict/verdict-rules.ts`; the status page: `docs/verified-play-next-steps.md`):
the recording (hash-chained batches, the server's own hashes, bounds, agreement with the ride, coverage, the per-ride time / batch / byte budgets),
the human-timing statistics (flags only), the admin's hand on the review queue, the retention sweep, and the CLI that re-judges old rides after a rules change – and **the server's road**: the road and its holes rebuilt from the ride seed
(`server/src/domain/road`), handed to the game as its obstacle plan, every batch measured against it (`obstacle-ignored` / `obstacle-no-impact`, `offroad-ignored`,
`accel-without-gas`), replays drawing the server's holes with the NO IMPACT marks.

## Run it

```sh
bash .claude/skills/verified-play-test/run.sh              # ≈ 15 min: e2e.sh verified verified-deep road browser close
bash .claude/skills/run-tests/e2e.sh verified             # a person and a bot (≈ 3 min)
bash .claude/skills/run-tests/e2e.sh verified-deep        # every verdict code, protocol, admin, profile, retention (≈ 2.5 min)
bash .claude/skills/run-tests/e2e.sh road                 # the server's road: honest vs holes-removed driver, the replay, the audit (≈ 6 min)
```

`e2e.sh` builds the server and the landing into private copies, creates a throwaway database (dropped at the end, also on failure), starts the server (a
fresh one per suite) and runs the script. Headless Chrome runs the game at ~0.4× wall time, so the API drivers keep their own clock (a 30 / 40 s shift in wall time).

### `verified` – a person and a bot (`server/scripts/e2e-verified-play.mjs`)
Server: `FREE_RIDE_SECONDS=40`. Four groups AT ONCE. The free run ends itself at the finish line. Heartbeats carry `challenge: null`.
- **A. a person in Chrome** – real CDP key events with jittered holds and gaps → `COMPLETED · VERIFIED`. Screenshot `human-done.png`.
- **B. a bot in Chrome** – the same hold and gap every time → `FLAGGED` on `uniform-holds` or `repeated-timings`; the end panel says `COMPLETED · FLAGGED`. Screenshot `bot-done.png`.
- **C. API bots** – `clean` verified · `no-inputs` · `teleport` · `over-governor` · `tampered` · `unhashed` (flag only) · `wrong-link` · the byte budget (400 `bad_batch`, does not complete).
- **D. the CLI** – `verdict:rejudge --dry-run` expects `scanned >= 9` (7 API completes + 2 Chrome) / a real run / `--status flagged`, `retention:sweep`.

### `verified-deep` – everything else (`server/scripts/e2e-verified-deep.mjs`)
Server: `FREE_RIDE_SECONDS=30 ADMIN_WALLETS=<a generated admin>`. The reason codes are compared as a SET, so "nothing else wrong" is part of every case. One check asserts no verdict reason code starts with `challenge`.
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

### `road` – the server's road (`server/scripts/e2e-road-check.mjs`)
Server: `FREE_RIDE_SECONDS=30`. Two Chromes drive at once, cruising the right-hand lane at 22 m/s (the test pins speed and lane; real key presses go
down too) until they have driven through the first two planned sinkholes in that lane (from `GET /api/watch/:id/road`):
- **A. honest** – the game loads the server's plan (0 mismatches with its own roll), takes the damage (hull ≈ 62 %) → `COMPLETED · VERIFIED`.
- **B. cheater** – an injected script takes the holes out of its game (the plan follower stopped, `CFG.HOLES` off, the cache cleared): no hole on its screen, hull 100 % → `COMPLETED · REJECTED` `obstacle-ignored` naming both holes.
- **C. a spectator** replays both: the replay's holes are the SERVER's (the cheater's empty road does not leak in), two red timeline marks + `ROAD CHECK … 2 NO IMPACT`, the NO IMPACT stamp + a red ring as it passes one (`replay-no-impact.png`); the honest replay shows two hits and no NO IMPACT.
- **D. the audit** – `scripts/ride-audit.mjs`: honest OK (exit 0), cheater NOT OK (exit 1) with the holes IGNORED, `--latest 5` lists both.
Every other new code (`obstacle-no-impact`, `obstacle-unmeasured`, `offroad-ignored`, `accel-without-gas`, a recording cut into batches right at each pit, reversing, crawling, avoiding) is unit- and scenario-tested
(`test/unit/domain/world-checks.spec.ts`, `test/scenarios/verdict.scenarios.ts` "the server's road"). The API bots of `verified` / `verified-deep` take the
holes' damage like the game (`server/scripts/road-damage.mjs`) – a bot that did not would now be rejected.

## What to look at

- `$TMPDIR/fc-verified-shots/human-done.png` / `bot-done.png`: the end panel's verdict line (`COMPLETED · VERIFIED` / `COMPLETED · FLAGGED`).
- `$TMPDIR/fc-verified-deep-shots/profile-*.png` – the lobby profile's verdict chips.
- `$TMPDIR/fc-road-shots/replay-no-impact.png` – the cheater's replay: the server's sinkhole ringed red on the road, the NO IMPACT stamp, the red ROAD CHECK line and timeline marks; `cheat-driving.png` – the same stretch on the cheater's own screen (no holes); `replay-honest.png`.
- The server log (`/tmp/fc-e2e-<db>.log`): one `verdict` line per ride with its reason codes; `batch-refused` for refused uploads.

## When a check fails

1. Read the `FAIL` line: it prints the status, the reason codes and the receipts. A cascade in D / F after a failing A case is usually the same root cause (the flagged ride is used downstream).
2. Reproduce one case: `drive({ name, ...options })` in `e2e-verified-deep.mjs` is one shift; add a case to `SCENARIOS` = `[name, options, status, codes]`.
3. If the harness is right and the rules changed on purpose: update `verdict-rules.ts` AND this table AND `docs/verified-play/index.html`, bump `RULES_VERSION`.
Sensitivity was proved by mutation: loosening `HOLD_CV_MIN` to 0 and `COVERAGE_REJECT` to 0.4 turns exactly the metronome and 45 %-coverage cases red (plus what depends on them). Do that again after adding a check.

## Tuning the thresholds

`verdict-rules.ts` → bump `RULES_VERSION`, run `npm run server:test`, then re-judge what is already judged: `node dist/cli/index.js verdict:rejudge --dry-run`
(production: `docker compose exec app node dist/cli/index.js verdict:rejudge --status flagged` from `/srv/freightchain` – only after the user asks).
`prod-db` has the queries (`reasons`, `scores`) to see which checks fire on real rides. Thresholds live in `verdict-rules.ts`.

## Related skills

`run-tests` (the whole pyramid; `e2e.sh` hosts both suites) · `replay-test` (the watch page and replays of the same recordings) · `prod-db` / `ride-investigate` (verdicts of real rides) · `test-census` (counts these suites, grades the verified-play feature).

## Report

Say which checks passed (`ok`) and failed (`FAIL`, with the server log path), that the harness drives its own clock (headless Chrome runs the game at ~0.4×),
and what still needs a person: real Phantom on `ride.*`, real rides for the threshold tuning, the paid boards (they need paid tickets – only the free board is checked here).
