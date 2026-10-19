# FreightChain — specification (source of truth)

Created 17.10.2026 by the owner's decision: "redo it all so that there is both a test plan and a spec of how it must work, so that this is the source of truth". Plan only: the repository code was not changed, git was not touched, tests were not run. The code was checked against this repository after the merge of PR #3 into `origin/main` (`e8f338ad`; PR #5 `cursor/local-e2e-suite-b044`). The decision log 1–66 below was not changed. Identifiers stay in English. Legal texts stay in the language of each file.

**2026-10-18, decisions 67 and 68.** How the process works: [`PROCESS.md`](PROCESS.md). What the code does now: [`PRODUCT.md`](PRODUCT.md). The test bar (real headless Chrome, positive and negative, the backend, a local validator): [`../testing/COVERAGE_CONTRACT.md`](../testing/COVERAGE_CONTRACT.md). The step-by-step plan: [`../testing/IMPLEMENTATION_PLAN.md`](../testing/IMPLEMENTATION_PLAN.md). A MUST rule that is not in the code is a target, not current behavior. The identifiers `RID-T-*` / `RPL-T-*` / `API-T-*` and the neighboring ones are a catalog of tests that still have to be written. "No test — 0" means "every MUST has a planned id", not "the test is written and green".

## Precedence rule
0. **Decisions 67 and 68 outrank E2E-M-01 and E2E-M-06.** Tests today lock [`PRODUCT.md`](PRODUCT.md). A target from decisions 1–66 changes the code only in a separate change that updates `PRODUCT.md` and the tests in the same commit. Details — [`PROCESS.md`](PROCESS.md).
1. **`docs/spec/` outranks every old plan file.** If an old file contradicts `docs/spec/`, `docs/spec/` is right.
2. Inside `docs/spec/`, a MUST rule in the "Spec" outranks an appendix. Appendices are the text of the old plans carried over unchanged: history and the details of the algorithms.
3. The owner's decisions (the log below; full texts — [`DECISIONS.md`](DECISIONS.md)) outrank the spec. If they diverge, the spec must be corrected.
4. Old files are consolidated into `docs/spec/…`:
   - `anticheat_test_plan.md` (merged into `docs/spec/`), `backend_test_plan.md` (merged into `docs/spec/`), `OPEN_QUESTIONS.md` (merged into [`OPEN.md`](OPEN.md)) — in full;
   - [`MASTER_PLAN.md`](../plan/MASTER_PLAN.md) — only §3 (pools and ranking), §5 (tickets and rides) and §14 (open questions → [`OPEN.md`](OPEN.md)), the rest stays in force.
   
   New edits are made only in `docs/spec/`.

## Contents
| File | Area | Prefixes |
|---|---|---|
| [`rides.md`](rides.md) | ride types, the road-generation algorithm (`@freightchain/shared` ⇄ server), 1h for ranking, training, a dynamic finish, `RideResult` statistics, the ranking formula | `RID-M-*`, `RID-T-*`, `AC-R*`, `AC-F*` |
| [`anticheat.md`](anticheat.md) | telemetry v2.1, a 30 Hz re-sim, world integrity, mechanical input, verdicts, a cheat catalog, sybil defense (Appendix D) | `ACH-M-*`, `ACH-T-*`, `AC-P/T/H/W*` |
| [`minigames.md`](minigames.md) | minigames: rules, a catalog of 15 ids with statuses, bot tests | `MGM-M-*`, `MGM-T-*`, `AC-M*` |
| [`pool.md`](pool.md) | the weekly pool, schedule parameters, tickets, last start, burn, validation, appeals, the v5/v6 contract, the prize board `prize-rules.ts` | `POOL-M-*`, `POOL-T-*` |
| [`referral.md`](referral.md) | the referral program (as-built on `main` + the target Convoy rework per decision 50): codes, slots, qualification, gifts, the donation and pool split, TEN4 emission | `REF-M-*`, `REF-T-*` |
| [`promocodes.md`](promocodes.md) | promo codes and the wardrobe: normalization, kinds `ride` / `tickets`, closed `free_rides` / `cosmetic`, a state machine, signed admin actions | `PRM-M-*`, `PRM-T-*` |
| [`ten4.md`](ten4.md) | the TEN4 token (`$TEN4`), 6 emission pools, checkpoints 20/50/100%, halving eras, burn, a garage of 9 slots (57 items), the program `freightchain_honk` | `TEN-M-*`, `TEN-T-*` |
| [`web3_solana.md`](web3_solana.md) | Web3 and Solana: SIWS, guest sign-in, phone QR pairing, SNS (`.sol`), Solana Actions / Blinks, Solana Pay, pool escrow, soulbound achievement cNFTs | `SOL-M-*`, `SOL-T-*` |
| [`platform_services.md`](platform_services.md) | platform services: statistics (`StatsService`), the 3D entity engine and the AI editor (`storybook`, `mcp/`), PostHog analytics and crash reports, 7 public hosts | `PLT-M-*`, `PLT-T-*` |
| [`replays_streams.md`](replays_streams.md) | **new:** replays, the player (all elements), stream = replay + chat + donations, a mock blockchain, the lobby | `RPL-M-*`, `RPL-T-*`, `M-RPL-*` |
| [`admin_security.md`](admin_security.md) | **new:** a registry of every admin and privileged handler (33 admin + 17 editor + 4 MCP + 3 service + CLI), findings F01–F18, protection, and a test matrix for every route | `ADM-M-*`, `ADM-T-*`, `M-ADM-*` |
| [`backend_contract.md`](backend_contract.md) | the contract of every HTTP route, backend decisions 1–10 | `API-M-*`, `API-T-*` |
| [`e2e.md`](e2e.md) | the PR #5 summary (blocks 1/2), new catalog sections, npm scripts | `E2E-M-*`, `E2E-T-*` |
| [`PROCESS.md`](PROCESS.md) | how to change the product from the specification (decision 67) | — |
| [`PRODUCT.md`](PRODUCT.md) | what is already built, and where decisions 1–66 diverge from the code | — |
| [`legal.md`](legal.md) | touchpoints with TERMS / PRIVACY / PRESEASON_RULES | `LEG-M-*`, `LEG-T-*` |
| [`DECISIONS.md`](DECISIONS.md) | full texts of decisions 1–68 and of backend 1–10 (1–44 and B1–B10 carried over unchanged; 45–66 accepted 17.10.2026; 67–68 — 18.10.2026) | — |
| [`OPEN.md`](OPEN.md) | all open questions (carried over from the old files) | — |

Area-file format: **Part 1 "Spec"** (a short snapshot of the code, then the target: MUST / MUST NOT rules). A rule that is not in [`PRODUCT.md`](PRODUCT.md) as shipped is a target, not current behavior. **Part 2** and the traceability line count planned ids. "No test — 0" in the old files means "the rule has an id", not "a test is written". Executable tests — [`../testing/COVERAGE_CONTRACT.md`](../testing/COVERAGE_CONTRACT.md).

**Traceability, total (18.10.2026, with full coverage of every business unit in `docs/spec/`):** 211 rules (`149` base + `RID-M-21` + `61` in `referral.md`, `promocodes.md`, `ten4.md`, `web3_solana.md`, `platform_services.md`), each has a planned test id (`RID-T-*`, `REF-T-*`, `PRM-T-*`, `TEN-T-*`, `SOL-T-*`, `PLT-T-*`, `RPL-T-*`, `ADM-T-*`, `API-T-*`, `POOL-T-*`, `ACH-T-*`, `MGM-T-*`, `LEG-T-*`, `E2E-T-*`) + 8 manual (`M-RPL-01…06`, `M-ADM-01/02`). "Rules with no id — 0" does not mean the tests are written or were run. The executable bar — [`../testing/COVERAGE_CONTRACT.md`](../testing/COVERAGE_CONTRACT.md).

## Owner decision log
Statuses: ✅ accepted · ✏️ accepted with a change · ⛔ replaced · ⏳ pending a decision. Decisions 1–66 — 17.10.2026. Decisions 67–68 — 18.10.2026.
| № | Point | Status | Where |
|---|---|---|---|
| 1 | Block 3 in PR #5, main only (HARD = `free-3b` 15 min) | ✏️ | anticheat |
| 2 | Engine: the game client in Node + kernel; the bot emits raw events | ✏️ | anticheat |
| 3 | A human-like bot = a cheat (v2: humanness + minigames + top-20) | ✏️ | anticheat ACH-M-06 |
| 4 | CI in-process + a fake clock + golden; long ones at night | ✅ | anticheat ACH-M-16 |
| 5 | Tolerances 30 m + 1 %, hull ± 1 %; v2 — bitwise | ✏️ | ACH-M-01 |
| 6 | Slow-mo and pauses are limited | ✅ | ACH-M-04 |
| 7 | Off-road > X s — an error; a red light — in the re-sim | ✅ | ACH-M-05, RID-M-14 |
| 8 | Replay budget, incremental re-sim | ✏️ | ACH-M-12 |
| 9 | `TRAFFIC_PROOF_REQUIRED=true` in the harness | ✅ | ACH-M-16 |
| 10 | Golden gzip/LFS, rebuild with `RULES_VERSION` | ✏️ | ACH-M-16 |
| 11 | Full v2 scope + minigames at once ("I'll get it all done") | ✏️ | replaces 30, 32 |
| 12 | Fixed 30 Hz step | ✏️ | ACH-M-01 |
| 13 | A shared `roadSeed` + a personal `trafficSalt` | ✅ | ACH-M-11 |
| 14 | Road challenges replaced by minigames | ✏️ | minigames |
| 15 | Thresholds and FP | ✅ | ACH-M-08 |
| 16 | Privacy | ✅ | ACH-M-13 |
| 17 | 4h and 8h removed; speedup — a test technique only | ✏️ | RID-M-01 |
| 18 | Publicly — only a replay of a finished ride, never the current one | ✏️ | RPL-M-01/03 |
| 19 | Minigames only in 1h | ✅ | MGM-M-01 |
| 20 | 2–4 minigames, intervals | ✅ | MGM-M-02 |
| 21 | Base catalog | ✅ (clarified by 14) | MGM-M-04 |
| 22 | The phone — only at a stop | ✅ | MGM-M-05 |
| 23 | Penalties +20/+45 s in separate fields, weight — the owner's formula | ✅ (clarified) | RID-M-16 |
| 24 | Values as an image | ✅ | MGM-M-07 |
| 25 | HMAC with the session key | ✅ | ACH-M-02 |
| 26 | `isTrusted=false` → flag | ✅ | ACH-M-07 |
| 27 | Reject for mechanics — only 5 conditions | ✅ | ACH-M-06 |
| 28 | "More time" mode | ✅ | MGM-M-08 |
| 29 | Publish `mgSalt` after the verdict | ✅ | MGM-M-03 |
| 30 | First-launch scope | ⛔ replaced by 11 | — |
| 31 | Minigame-trace privacy | ✅ | MGM-M-10 |
| 32 | Resources | ⛔ replaced by 11 | — |
| 33 | Money and spectators never affect a ride | ✅ | RPL-M-17 |
| 34 | The pool's replay and road plan — after validation | ✅ | RPL-M-04 |
| 35 | A shared route; `holeSalt` if attempts > 1 | ✅ | ACH-M-11 |
| 36 | Last start = close − 1 h 15 min | ✅ | POOL-M-04 |
| 37 | Contract: `min_finish_secs ≤ 7200` now, v6 fields later | ✅ | POOL-M-10 |
| 38 | 65 km/h — speed on a clear straight | ✅ | RID-M-03 |
| 39 | The finish does not depend on personal salts | ✅ | RID-M-04 |
| 40 | Map boundary: a `finishS` check | ✅ | RID-M-07 |
| 41 | An early finish is a good time; `null` for the unmeasurable | ✅ | RID-M-10/15 |
| 42 | The ranking formula is published before opening, immutable | ✅ | RID-M-17 |
| 43 | 90 min limit | ✅ | RID-M-09 |
| 44 | The finish line in 1h | ✅ | RID-M-11 |
| — | Weekly pool (Tue → Sun, −2 h sales, 1.5 days of validation, burn) | ✅ | POOL-M-01/05 |
| — | Pool time — configurable fields, the backend checks against the chain | ✅ | POOL-M-01/02 |
| — | Seasons are not planned: devnet launch / later | ✅ | all |
| — | Appeals — after the validation window | ✅ | POOL-M-08 |
| — | Ranking: the main thing is that you finished; components separately; the owner's formula | ✅ | RID-M-12/17 |
| — | Dynamic finish ≈ 1 h at 65 km/h | ✅ | RID-M-03 |
| — | Donations and replay chat are on for the test at the devnet launch | ✅ | RPL-M-22 |
| — | Only replays of non-training rides can be watched, training is marked in the lobby; check every player button; a mock blockchain for donations and chat; the specification as the source of truth | ✅ | replays_streams, README |
| B1 | Schemas in zod, OpenAPI from them | ✅ | API-M-01 |
| B2 | A response-schema violation: strict in test, warn in prod | ✅ | API-M-02 |
| B3 | `.strict()` for admin/editor/money | ✅ | API-M-03 |
| B4 | Gate threshold | ✅ | API-M-04 |
| B5 | schemathesis at night, fast-check immediately | ✅ | API-M-10 |
| B6 | Where tests live; implementation — a new PR after the PR #3 merge | ✅ | API-M-11 |
| B7 | Geo without `CF-IPCountry` — fail-closed | ✅ | API-M-08 |
| B8 | Admin HTTP for `set_pool_rules` | ✅ | API-M-09, POOL-M-12 |
| B9 | Someone else's resource — `404` everywhere | ✅ | API-M-07 |
| B10 | No separate line-coverage threshold | ✅ | API-M-11 |
| 45 | A donation only on a replay, directly to the driver; the driver sees it after the ride | ✅ 17.10.2026 | RPL-M-14/15/18 |
| 46 | LIVE — only the "N on the road" counter; "watching now" on the replay | ✅ 17.10.2026 | RPL-M-11, RPL-M-32 |
| 47 | All new player elements; the first batch — steps, events, `&t=`, 0.5×/2× | ✅ 17.10.2026 | RPL-M-13, C3–C19, C36 |
| 48 | Input highlight and `SAMPLE_INPUT_COL` — admin only | ✅ 17.10.2026 | RPL-M-07 |
| 49 | HONK in chat — cosmetic; delete HONK time/weather | ✅ 17.10.2026 | RPL-M-34, RPL-M-17 |
| 50 | The referrer's share of donations = 0, the `also` branch is removed | ✅ 17.10.2026 | RPL-M-16, LEG-M-02 |
| 51 | Pledges are off at the devnet launch; later — a separate decision | ✅ 17.10.2026 | RPL-M-33 |
| 52 | Tips 0.01/0.05/0.1; min 0.001, max 1 SOL; an order expires in 15 min; ≤ 3 unclosed | ✅ 17.10.2026 | RPL-M-19/20/21 |
| 53 | Chat filter: no links, an EN/RU word list, an admin hides and bans | ✅ 17.10.2026 | RPL-M-27 |
| 54 | Chat is bound to `replayT` | ✅ 17.10.2026 | RPL-M-29 |
| 55 | Finished = completed/abandoned/failed, the verdict is not `rejected` | ✅ 17.10.2026 | RPL-M-01 |
| 56 | Training = free (all levels) + offline guest + tutorial/assist | ✅ 17.10.2026 | RPL-M-02, RID-M-02 |
| 57 | The driver sees their own pool replay until `payout_at` | ✅ 17.10.2026 | RPL-M-05 |
| 58 | Lobby texts in EN and RU from day one | ✅ 17.10.2026 | RPL-M-10/10a, LEG-M-11 |
| 59 | Roles admin / moderator / editor by least privilege | ✅ 17.10.2026 | admin_security |
| 60 | Money and the chain: devnet — 1 signature + a notice; paid pools / mainnet — a second admin; `set_config`/`set_pool_rules` — Squads | ✅ 17.10.2026 | admin_security |
| 61 | A global default-deny guard by prefix + a meta-test | ✅ 17.10.2026 | admin_security |
| 62 | Strict mode at any `NODE_ENV` except development/test; dev flags and `DEMO_WALLETS` fail startup; own JWT secrets | ✅ 17.10.2026 | admin_security |
| 63 | Admin session ≤ 60 min, `jti`, revocation on logout | ✅ 17.10.2026 | admin_security |
| 64 | Audit is append-only at the DB level, "before/after", reads of personal data; notices to Telegram (env, an outbox when unavailable) | ✅ 17.10.2026 | admin_security |
| 65 | Admin sign-in limits; `auth/nonce` does not reveal admins | ✅ 17.10.2026 | admin_security |
| 66 | `ADMIN_IP_ALLOWLIST` for mainnet | ✅ 17.10.2026 | admin_security |
| 67 | Development from the specification: as-built in `PRODUCT.md`, the target separately, a test is not deleted because a target is not done yet | ✅ 18.10.2026 | PROCESS.md |
| 68 | Coverage: headless Chrome + HTTP positive/negative + Postgres + LiteSVM and a local validator. happy-dom does not replace Chrome. E2E-M-01 and E2E-M-06 do not apply | ✅ 18.10.2026 | COVERAGE_CONTRACT.md |

## Glossary
- **1h** — an hour-long ride, the only one for ranking and for a pool.
- **Training ride (training)** — `tier = free` (levels EASY/MEDIUM/HARD: `free-1c`, `free-2c`, `free-3c`; frozen HARD `free-3b` and the old `free-*`), guest offline `free-g` and `POST /api/auth/guest`, any with `tutorial` / `assist`. No ranking, TEN4, minigames, or replays.
- **Devnet launch** — the first launch (Pre-season on devnet, with no paid tickets). **Later** — everything else.
- **Re-sim** — a server simulation of the ride from raw input at a 30 Hz step. The source of truth for the result.
- **v1 / v2 / v2.1** — the current pipeline (client samples) / the new one (re-sim) / telemetry protocol v2.1 (HMAC, streams).
- **`roadSeed`, `trafficSalt`, `holeSalt`, `mgSalt`** — the road seed (shared for the pool), personal salts for traffic, the hole layout (if attempts > 1), and minigames; commit–reveal.
- **`finishS`** — the finish point in meters, `Ride.completeDist`.
- **Verdict** — `verified` / `review` (in the schema now `flagged`) / `rejected`.
- **`RideResult`** — the ride statistics row in the `stats` schema.
- **Pool windows** — `opens_at`, `sales_close_at = prep_deadline`, `last_start_at`, `play_close_at = play_deadline`, `validation_until = payout_at`.
- **Replay** — watching a finished ride. **Stream** — a replay + chat + donations to the driver. **Live** — watching the current ride, forbidden (decision 18).
- **Donation / tip** — a spectator's SOL transfer to the driver, with no effect on the game. **Effect** — a former donation that changed the ride (removed).
- **TEN4** — the coin ticker (on main after the PR #3 merge). Route names, tables, and `HONK_PROGRAM_ID` stay HONK. **HONK** as a verb — a chat line; a burn into chat is cosmetic.
- **Pledge** — a spectator's SOL "per km" on a ticket ride (program `pledge.rs`).
- **Mock RPC** — the `mock-rpc` service in the e2e compose, replacing Solana JSON-RPC.
- **Block 1 / block 2** — PR #5 e2e with no chain / with a local validator. **E1M** — block 1 with mock RPC.
- **MUST / MUST NOT / SHOULD / MAY** — required / forbidden / recommended / permitted.
