# Verified play – status, your checklist, next steps

As of **Oct 9, 2026**. Built on branch `worktree-verified-play` (worktree `.claude/worktrees/verified-play`), **merged into `main` Oct 8 (not pushed)**.
**Production** (release `20261009-064010-7bac92d`, Oct 9 – anti-cheat hardening is live: dispatch prompts, batch summaries, the per-ride byte budget, an unhashed batch only flags, sign-in retention, `verdict:rejudge` and `retention:sweep`, rules v2. Migrations `ride_challenges` and `batch_summary` applied. Also everything that was on `main` but not yet live, including the lobby free-ride row (`785d9cc`), the cockpit and battery changes, fatal building hits, the anti-cheat explainer, and the test-census skill. Nginx and the certificate were already in place. Smoke green. The program watcher still logs `the pool program is not configured (TICKET_PROGRAM_ID)` until the escrow program is deployed). Before that (`20261008-234656-785d9cc`, Oct 9 – lobby free-ride row, shorter cards, promo in the header, the tab-switch race, a smaller key). Before that (`20261008-230944-8c01a81`, Oct 8 – roadside meshes: landmark signs readable from the road, police-station flags for the route, round cruiser and traffic wheels, the gas kiosk GAS disc with the pole stopped at the rim, diner and kiosk window gaps, ambulance and fire lights on the roof, the freighter stripe clear of the rear face. Also the two docs commits that were on `main` but not yet live. No new migrations. Nginx and the certificate were already in place. Smoke green). Before that (`20261008-215415-53ed2a5`, Oct 8 – web vitals on the landing, whitepaper, and lobby (`web_vital` through the existing relay; derived `CORS_ORIGINS` now includes `https://whitepaper.freightchain.fun`); also the commits that were on `main` but not yet live: in-game sound effects with the nginx media cache, the road spacing rule and re-rendered clips, and the whitepaper button in the landing header. No new migrations. Nginx setup rewrote the media snippet and reloaded; the certificate already covered all six names. Smoke green). Before that (`20261008-204159-3b8025e`). Before that (`20261008-165220-d6471d5`, Oct 8 – adds the landing's whitepaper invitation (the "what the server checks" cards are gone), the loop block with FIVE ROUTES tiles, the escrow diagram, no LIVE NOW card, and the whitepaper's chapter 05 with the whole escrow explainer (state machine, timeline, claim tiles, role lanes); no migrations, smoke green). Before that (`20261008-161238-cf47525`, Oct 8 – on top of `ecf5451`: the landing's own promo band and reworked dash cards (chapter 03 removed), the admin promo form redesign + the localhost-only dev wallet, the live board's leave-on-close; no new migrations, smoke green). Before that (`20261008-152122-ecf5451`, Oct 8 – adds the live board: online counts, live rides with viewers + signal, the stale-ride sweeper, the replays history / lobby REPLAYS tab / landing RECENT RIDES; also the whitepaper site and promo codes + cosmetics from the other branches; migrations `ride_history_index`, `promo_effects`, `ride_loadout` applied, smoke green). Before that (`b7a0fbb`): verified play in shadow mode, the admin page on `admin.<apex>` (basic auth + its own wallet sign-in + signed decisions), and **live streams** – watch / replay any ride (with the recorded traffic), CB chat with driver mute, donations with the production flags `LIVE_CHAT=all LIVE_DONATIONS=on LIVE_FREE_DONATIONS=off LIVE_EFFECTS=free` (paid devnet SOL to the driver; effects only on free rides). Migrations `live_mutes` + `live_paid_donations` applied, smoke green (incl. the watch API and the game-host sign-in). Still to try by hand: a real Phantom on `ride.freightchain.fun` and one real paid donation (`docs/replay-and-donations/index.html`). Known noise: the program watcher logs `the pool program is not configured (TICKET_PROGRAM_ID)` until the escrow program is deployed.
That hardening is the release above. `SIGNIN_RETENTION_DAYS` and `CHALLENGE_INTERVAL_SECONDS` keep their defaults; nothing was added to `deploy/.env`.
The one-page anti-cheat summary (layers, codes, thresholds, knobs, limits) is the page `docs/anti-cheat/index.html`. How it works is in `AGENTS.md` → "Verified play" / "Admin page" / "Logs" / "Observing production"; the server side in `docs/backend-architecture.md`. For players and non-developers: the explainer page `docs/verified-play/index.html` (diagrams, why it is safe, the players' guarantees, the limits; opens from disk).

## What is built

| piece | where | state |
|---|---|---|
| Recording: every key / dash-button press + a 10 Hz sample of the truck, hash-chained 15 s batches, flushed before `/end` | `client/js/telemetry.js`, `POST /api/rides/:id/batches`, `telemetry."RideBatch"` | tested (unit, PostgreSQL, real Chrome: the browser's WebCrypto hash = the server's) |
| Verdict on every completed shift: `verified` / `flagged` / `rejected` with reasons – recording validation (rejects) + human-timing statistics (flags only); **no re-simulation** | `server/src/domain/verdict/`, thresholds in `verdict-rules.ts` | tested; **thresholds are first guesses, not tuned on real rides** |
| Paid boards rank verified shifts only; `VERDICT_ENFORCE=false` = shadow mode | leaderboard query, `LeaderboardDto.verifiedOnly`, lobby copy | tested |
| Recording retention: daily 00:30 UTC sweep after `TELEMETRY_RETENTION_DAYS` (default 90), flagged rides kept | `SweepTelemetryCommand`, `TelemetryRetentionScheduler` | tested |
| Admin page on `https://admin.<apex>` – three locks: nginx basic auth (`DEPLOY_ADMIN_USER` / `DEPLOY_ADMIN_PASSWORD`), its own admin wallet sign-in (a 2 h `fc_admin` session for `ADMIN_WALLETS` only; the player session grants nothing), and a wallet signature on every change (kept in the audit); the server answers `/api/admin/*` on no other host, 404 for everyone else: overview, review queue → accept / reject / re-judge (audited), rides, sign-ins, live log ring, audit | `client/admin.html`, `client/site/admin.js`, `/api/admin/*` | tested (unit, PostgreSQL, real Chrome) |
| Sign-in log (wallet, time, IP, browser), pruned after `SIGNIN_RETENTION_DAYS` (180) by the 00:30 sweep | `player."SignIn"`, `SweepSignInsCommand` | tested |
| **Dispatch prompts**: about every 240 s of driving (≤ 4 per short shift) the heartbeat carries FLASH YOUR HEADLIGHTS / RUN THE WIPERS / SWITCH THE CAB LIGHT / SPRAY THE WASHER (key or dash button, 20 s window, an amber banner on the windscreen); the verdict finds the press in the recording – ≥ 50 % of ≥ 3 ignored rejects (`challenges-ignored`), fewer flag, a median answer under 80 ms flags `challenge-reflex` | `domain/rides/ride-challenge.ts`, `Ride.issueChallenge`, `client/js/prompt.js`, `domain/verdict/challenge-checks.ts`, `CHALLENGE_INTERVAL_SECONDS` | tested (unit, scenarios on memory + PostgreSQL, real Chrome: a person answers, a bot is rejected); **thresholds are first guesses** |
| Judging reads per-batch summaries (measured at upload, `RideBatch.summary`), never the samples again; rows from before are summarised on the fly; a ride may hold ≤ wall s × 4 kB + 256 kB of recording | `domain/telemetry/batch-summary.ts`, `listFactsByRide`, `totalBytes` | tested |
| An unhashed batch (the browser's digest failed; the next links to `unhashed-<seq>`) only flags; a wrong hash still rejects; the client retries the digest once | `recording-checks.ts checkChain`, `client/js/telemetry.js` | tested |
| Bulk re-judge after a rules change (admin decisions kept, swept recordings skipped, audited) and the sweeps by hand | CLI `verdict:rejudge [--status …] [--since DATE] [--limit N] [--dry-run]`, `retention:sweep` | tested (unit, e2e on the throwaway database) |
| The anti-cheat e2e, positive and negative | `server/scripts/e2e-verified-play.mjs`, skill `verified-play-test` | runs in `e2e.sh verified` |
| JSON logs: one line per event, one per API request (status, ms, request id, wallet), rotated 5 × 50 MB | `JsonLogger`, `requestLogMiddleware`, `docker-compose.prod.yml` | tested; live in production since the Oct 7 deploy |
| Read-only production tooling + Claude skills | `npm run ops -- …`, `deploy/scripts/ops*.{sh,sql}`, `.claude/skills/` | `ps` / `logs` / `nginx` / `sql` / `query` tried on production (read-only); the challenge and summary columns are live as of `20261009-064010-7bac92d` |

Migrations added (forward-only, additive): `20261008000002_verified_play` (schemas `telemetry`, `verdict`), `20261008000003_admin` (schema `admin`, `player."SignIn"`, override columns on `RideVerdict`).

## Your part (only you can do these)

- [ ] Skim the review findings below (two reviews, twenty findings, all fixed; four follow-ups are listed).
- [x] **`deploy/.env`** (on your machine, not in git): `ADMIN_WALLETS` (your wallet), `DEPLOY_ADMIN_USER` / `DEPLOY_ADMIN_PASSWORD` (the basic auth of `admin.*`, generated – read it with `grep DEPLOY_ADMIN deploy/.env`; change it there + deploy to rotate). Nothing for `VERDICT_ENFORCE` yet – production defaults to **shadow mode**; add `VERDICT_ENFORCE=true` only after the tuning week. (Rides from before verified play have no verdict and rank only in shadow mode.)
- [x] Deploy (Oct 7: `e530d13`, then `1c9bda1` with `admin.*`): migrations applied, smoke green, JSON logs live, the certificate covers `admin.freightchain.fun`.
- [x] `main` fast-forwarded to the branch (Oct 8, not pushed).
- [x] **Deploy `main`** (Oct 8, `b7a0fbb`): the admin wallet sign-in + signed decisions, live streams with their flags, paid donations, mute, recorded traffic.
- [ ] After that deploy: open `https://admin.freightchain.fun` (the browser asks for the basic-auth user / password), click **SIGN IN AS ADMIN** (Phantom signs an ADMIN sign-in message); check the overview loads. Every ACCEPT / REJECT / RE-JUDGE then asks Phantom to sign that one change. `deploy/.env` now also holds `ADMIN_JWT_SECRET` (rotate = every admin signed out) and `ADMIN_SESSION_TTL_MINUTES=120`.
- [x] **Deploy `main`** (Oct 9, `20261009-064010-7bac92d`): the anti-cheat hardening, two additive migrations, no env changes. Smoke green.
- [ ] **Play 5–10 real rides** on the live site: a full free ride, a demo paid ride, one on a slow / old machine, one with the tab hidden for a while, one on a phone-tethered laptop – and notice the DISPATCH prompts: is the banner visible enough while driving, is 20 s enough, is one every 4 minutes too many? Then tell me "tune the verdict thresholds" (the prompt rules included).
- [ ] When the tuning week shows no false flags: set `VERDICT_ENFORCE=true` in `deploy/.env` and redeploy.
- [ ] Decide: should the free board also rank verified rides only? (today it ranks every completed free ride)
- [ ] Decide: keep the sign-in log forever, or prune it (e.g. 180 days) – it holds IP addresses (privacy policy / GDPR wording if you go beyond devnet).
- [ ] Before mainnet or real money: get a second pair of eyes on the treasury custody (Squads multisig) and on the gambling / skill-prize wording.

## Next steps (Claude can do these, in this order)

1. **The review follow-ups** below (none blocks a devnet deploy) – the hash-mismatch one first: it can cost an honest player a shift.
2. **Tune the thresholds** from the first real rides: `npm run ops -- query reasons` / `query scores` (prod-db skill) → adjust `server/src/domain/verdict/verdict-rules.ts`, bump `RULES_VERSION`, redeploy. Then RE-JUDGE (admin page) applies the new rules to a ride already judged.
3. ~~Bulk re-judge~~ – done: `node dist/cli/index.js verdict:rejudge --dry-run`, then without (production: `docker compose exec app …` from `/srv/freightchain`, only on your ask).
4. ~~Challenge prompts~~ – done (dispatch prompts, above); left: tune the reject share / min-issued / reaction threshold on real rides, and decide whether a prompt should also be audible in the replay / watch page.
5. **Captcha** (Cloudflare Turnstile) at ride start – needs your Turnstile keys (skipped for now on your call).
6. **Replay viewer** (`replay.html?r=<shareId>` on `ride.*`): plays a recording back on the game's renderer – for the review queue and for winners' rides.
7. **Round close + payouts** (plan Phase 5): prize rows at the week turn, admin builds the payout transactions, you sign them in Phantom, the server verifies them on chain.
8. **CI** (skipped on purpose for now): a GitHub Actions workflow running `npm run check` + the PostgreSQL suite on push, the Chrome e2e nightly – when you want it.
9. Housekeeping: delete the stale `docs/day-1.md`, `package.json#prisma` → `prisma.config.ts` (Prisma 7 deprecation warning).

## Review findings

### First review (Oct 7, `code-review` at high effort over `main...HEAD`)

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

### Second review (Oct 7, `/code-review` over `main...HEAD`)

Ten more; nine real, one partly (the 413 case cannot happen – batches are capped below Express's 100 kB). All **fixed**:

| # | finding | fix |
|---|---|---|
| 1 | a lost LAST batch made the "recording ends elsewhere" check **reject** the ride (the client assumed it only costs coverage) | the distance the missing seconds explain (28 m/s × 1.2 × the seconds after the last sample) is allowed – a lost tail now only flags `recording-gaps` |
| 2 | the 90-day sweep deleted recordings that JUDGE NOW / RE-JUDGE still needed → "no recording" reject | the sweep keeps completed shifts that were never judged; RE-JUDGE refuses (409 `recording_deleted`) once a recording is gone and keeps the verdict |
| 3 | after a refused batch (400) the client kept sending → a broken chain with no explanation | any refusing 4xx stops the recording and keeps the reason in `telemetry.refused`; the server logs `event:'batch-refused'` with the detail (admin page → logs → ride id); NaN samples are sent as 0 instead of `null` |
| 4 | a missing `VERDICT_ENFORCE` in `deploy/.env` meant enforcement, and older paid rides (no verdict) would vanish from the boards | production defaults to shadow mode (`${VERDICT_ENFORCE:-false}` in compose); enforcement only when `deploy/.env` says `true` |
| 5 | input times were taken when a slow frame handled the key → 0 ms holds on slow machines / trackpad taps | the events' own `timeStamp` (same clock as `performance.now()`) |
| 6 | `/end` waited for the final uploads; a player leaving early turned a finished shift into "heartbeat lost" | `/end` waits ≤ 3 s (`FLUSH_WAIT_MS`); uploads keep retrying in the background for 55 s |
| 7 | RE-JUDGE wrote its audit row outside the judging transaction | judged and audited in one transaction under the player lock |
| 8 | one failed hash step stopped the recording for the rest of the ride | each step catches: a failed digest sends the batch unhashed, the chain goes on |
| 9 | the batch's canonical text was built twice per upload (and judging parses everything under the lock) | built once; the judging cost stays a follow-up (below) |
| 10 | two copies of the admin ride-row mapping and of the ride-status list | one mapper (`admin-ride-row.ts`); statuses from the `RideStatus` enum |

**Follow-ups (not blocking a devnet deploy):**
- ~~Judging loads, inflates and parses the whole recording inside the player-lock transaction~~ – done Oct 9: per-batch summaries at upload time, judged from `listFactsByRide`; a per-ride byte budget (wall s × 4 kB + 256 kB).
- ~~`player."SignIn"` has no retention~~ – done Oct 9: `SIGNIN_RETENTION_DAYS` (180), swept at 00:30 with the recordings.
- ~~An unhashed batch rejects the whole ride~~ – done Oct 9: the client retries the digest once, the server only flags `unhashed-batch` (it hashed the batch itself); a WRONG hash still rejects.
- `/api/admin/auth/*` counts against the general `THROTTLE_LIMIT`, not the stricter `THROTTLE_AUTH_LIMIT` – fine behind the basic auth and the allowlist; tighten it if the admin host is ever exposed without them.
- (Oct 9) The prompt's reaction is measured against the server's issue time; the client's clock starts when `/start` answered, so a real reaction reads SHORTER by the one-way delay. 80 ms is therefore conservative; a bot on a slow link could read as a person. The next step up is a per-ride clock offset estimate from the heartbeats.

**Test note:** all checkouts and worktrees share the compose PostgreSQL and its `freightchain_test` database. During this review another branch's migrations (the paid-tickets tables) were in it, and the drift check failed for that reason alone. On a branch: `TEST_DATABASE_URL=postgresql://freight:freight_dev_password@localhost:15433/freightchain_<branch>_test npm run server:integration`.

**Checked after both rounds of fixes:** `npm run check` (413 unit + architecture audits, landing, client lint + headless; the offline game's trace identical), the PostgreSQL suite (147, on this worktree's own test database), real Chrome: game (COMPLETED · VERIFIED, every batch uploaded, none refused), lobby (33 checks), admin (18 checks incl. accept + re-judge).
**Checked after the admin hardening (Oct 8):** `npm run check` (442 unit + audits), the PostgreSQL suite (149), real Chrome admin (24 checks: the player session gets 404, a non-admin wallet is refused, the admin signs in through a fake Phantom, ACCEPT is signed for exactly that ride and decision, the audit holds the signatures, sign-out), the deploy dry run with the new env keys.
