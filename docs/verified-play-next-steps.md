# Verified play – status, your checklist, next steps

As of **Oct 7, 2026**. Branch `worktree-verified-play` (worktree `.claude/worktrees/verified-play`), rebased on `main`. **Not merged, not pushed, not deployed.**
How it works is in `AGENTS.md` → "Verified play" / "Admin page" / "Logs" / "Observing production"; the server side in `docs/backend-architecture.md`.

## What is built

| piece | where | state |
|---|---|---|
| Recording: every key / dash-button press + a 10 Hz sample of the truck, hash-chained 15 s batches, flushed before `/end` | `client/js/telemetry.js`, `POST /api/rides/:id/batches`, `telemetry."RideBatch"` | tested (unit, PostgreSQL, real Chrome: the browser's WebCrypto hash = the server's) |
| Verdict on every completed shift: `verified` / `flagged` / `rejected` with reasons – recording validation (rejects) + human-timing statistics (flags only); **no re-simulation** | `server/src/domain/verdict/`, thresholds in `verdict-rules.ts` | tested; **thresholds are first guesses, not tuned on real rides** |
| Paid boards rank verified shifts only; `VERDICT_ENFORCE=false` = shadow mode | leaderboard query, `LeaderboardDto.verifiedOnly`, lobby copy | tested |
| Recording retention: daily 00:30 UTC sweep after `TELEMETRY_RETENTION_DAYS` (default 90), flagged rides kept | `SweepTelemetryCommand`, `TelemetryRetentionScheduler` | tested |
| Admin page `/admin.html` (`ADMIN_WALLETS` only, 404 for everyone else): overview, review queue → accept / reject / re-judge (audited), rides, sign-ins, live log ring, audit | `client/admin.html`, `client/site/admin.js`, `/api/admin/*` | tested (unit, PostgreSQL, real Chrome) |
| Sign-in log (wallet, time, IP, browser) | `player."SignIn"` | tested |
| JSON logs: one line per event, one per API request (status, ms, request id, wallet), rotated 5 × 50 MB | `JsonLogger`, `requestLogMiddleware`, `docker-compose.prod.yml` | tested locally; production still runs the old text logs until deployed |
| Read-only production tooling + Claude skills | `npm run ops -- …`, `deploy/scripts/ops*.{sh,sql}`, `.claude/skills/` | `ps` / `logs` / `nginx` / `sql` / `query` tried once on production (read-only); the queries on the new tables need the deploy |

Migrations added (forward-only, additive): `20261008000002_verified_play` (schemas `telemetry`, `verdict`), `20261008000003_admin` (schema `admin`, `player."SignIn"`, override columns on `RideVerdict`).

## Your part (only you can do these)

- [ ] Skim the review findings below (all ten are fixed; three follow-ups are listed).
- [ ] **`deploy/.env`** (on your machine, not in git) – add:
  - [ ] `ADMIN_WALLETS=<your wallet address>` (comma-separated for more)
  - [ ] `VERDICT_ENFORCE=false` – **shadow mode for the tuning week.** Without it the default is `true`: rides that fail the untuned checks drop off the paid boards from the first deploy.
  - [ ] optional: `TELEMETRY_RETENTION_DAYS=90` (the default)
- [ ] **Merge** `worktree-verified-play` into `main` (or tell me to), then **deploy**: `npm run deploy -- --dry-run` (safe), then `npm run deploy`. The deploy ships the committed `main`.
- [ ] After the deploy: open `https://freightchain.fun/admin.html` signed in with your admin wallet; check the overview loads and `npm run ops -- logs --lines 20` shows JSON lines.
- [ ] **Play 5–10 real rides** on the live site: a full free ride, a demo paid ride, one on a slow / old machine, one with the tab hidden for a while, one on a phone-tethered laptop. Then tell me "tune the verdict thresholds".
- [ ] When the tuning week shows no false flags: set `VERDICT_ENFORCE=true` in `deploy/.env` and redeploy.
- [ ] Decide: should the free board also rank verified rides only? (today it ranks every completed free ride)
- [ ] Decide: keep the sign-in log forever, or prune it (e.g. 180 days) – it holds IP addresses (privacy policy / GDPR wording if you go beyond devnet).
- [ ] Before mainnet or real money: get a second pair of eyes on the treasury custody (Squads multisig) and on the gambling / skill-prize wording.

## Next steps (Claude can do these, in this order)

1. **The three review follow-ups** below (none blocks a devnet deploy).
2. **Tune the thresholds** from the first real rides: `npm run ops -- query reasons` / `query scores` (prod-db skill) → adjust `server/src/domain/verdict/verdict-rules.ts`, bump `RULES_VERSION`, redeploy. Then RE-JUDGE (admin page) applies the new rules to a ride already judged.
3. **Bulk re-judge** after a threshold change (today: one ride at a time with RE-JUDGE on the admin page, or `npm run ops -- query unjudged` for the ones that were never judged).
4. **Challenge prompts** (plan Phase 3, Option A): server-issued prompts in the heartbeat response ("flash the headlights now"), answered in the recording, reaction time checked – the strongest human signal without re-simulation.
5. **Captcha** (Cloudflare Turnstile) at ride start – needs your Turnstile keys.
6. **Replay viewer** (`replay.html?r=<shareId>` on `ride.*`): plays a recording back on the game's renderer – for the review queue and for winners' rides.
7. **Round close + payouts** (plan Phase 5): prize rows at the week turn, admin builds the payout transactions, you sign them in Phantom, the server verifies them on chain.
8. **CI** (skipped on purpose for now): a GitHub Actions workflow running `npm run check` + the PostgreSQL suite on push, the Chrome e2e nightly – when you want it.
9. Housekeeping: delete the stale `docs/day-1.md`, `package.json#prisma` → `prisma.config.ts` (Prisma 7 deprecation warning).

## Review findings (Oct 7, `code-review` at high effort over `main...HEAD`)

All ten were confirmed and **fixed** on this branch; each fix has a test.

| # | finding | fix |
|---|---|---|
| 1 | a batch uploaded while `/end` committed could be stored after the judgement and never judged (the handler re-judged from a stale ride status) | the upload runs in one transaction under the player row lock with the ride read inside it, and re-judges after its commit when the ride had ended |
| 2 | a key with an empty `KeyboardEvent.code` (OEM / IME / virtual keyboards) made the batch a 400, the client dropped it, the ride was rejected for a missing batch | client records `Unidentified`; the server accepts an empty code |
| 3 | no cap on batches per ride – a wallet could store huge amounts and make judging load all of it under the lock | `Ride.recordingAllowance`: a batch's game time ≤ wall time since the start × 1.05 + 30 s, seq ≤ wall / 5 s + 10 |
| 4 | if judging failed after `/end`, the shift stayed unjudged forever and the override refused it | override judges first when there is no verdict; new admin RE-JUDGE (`POST /api/admin/rides/:id/rejudge`); `ops -- query unjudged` |
| 5 | the final flush gave up after one retry although the server takes batches for 60 s after the end | the client keeps retrying every 5 s for 55 s; the server re-judges on each |
| 6 | the batch upload ran outside the player row lock (a CLAUDE.md rule) | = fix 1 |
| 7 | `holdsByCode` copied the hold array on every release (O(n²) under the lock) | push in place |
| 8 | the 10 Hz sample timer dropped the remainder (~7.5 Hz at 30 fps) | subtract the period |
| 9 | float noise (`0.30000000000000004`) roughly doubled the batch size | round by decimals (`x / 100`) |
| 10 | coarse browser timers (Firefox resistFingerprinting, Tor: 16.7–100 ms) made real people look scripted | the clock step is detected (`scores.human.timerStepMs`); ≥ 10 ms skips `instant-presses` and `repeated-timings` |

**Follow-ups (not blocking a devnet deploy):**
- Judging loads, inflates and parses the whole recording inside the player-lock transaction: ≈ 2–4 MB of JSON for a 1 h shift, ≈ 15–30 MB for an 8 h one (the 4 h / 8 h tiers make this the first follow-up). Keep per-batch summaries (counts, last sample, input timing stats) at upload time and judge from those.
- The per-ride cap allows ≈ 20 kB/s of recording per running ride at worst (a hostile client); add a per-ride byte budget if storage ever matters.
- `player."SignIn"` has no retention (IP addresses) – prune with the telemetry sweep once you decide the period.

**Test note:** all checkouts and worktrees share the compose PostgreSQL and its `freightchain_test` database. During this review another branch's migrations (the paid-tickets tables) were in it, and the drift check failed for that reason alone. On a branch: `TEST_DATABASE_URL=postgresql://freight:freight_dev_password@localhost:15433/freightchain_<branch>_test npm run server:integration`.

**Checked after the fixes:** `npm run check` (411 unit + architecture audits, client headless trace identical), the PostgreSQL suite (147, on its own test database), real Chrome: game (COMPLETED · VERIFIED), lobby (33 checks), admin (18 checks incl. accept + re-judge).
