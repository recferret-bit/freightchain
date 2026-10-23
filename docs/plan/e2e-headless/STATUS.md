# Plan 1 Status Board — Full Set of E2E Headless Tests

> **Master Plan:** [`docs/plan/E2E_HEADLESS_PLAN.md`](../E2E_HEADLESS_PLAN.md)
> **Status Legend:** `[ ] Todo` · `[~] In Progress` · `[x] Done` · `[!] Blocked (awaiting owner decision or Plan 2 dependency)`

---

## Summary Progress

| Epic | Domain | Track | Total Tasks | Todo | In Progress | Done | Blocked |
|---|---|---|---|---|---|---|---|
| [`E2E-01`](./issues/E2E-01-gates-and-census.md) | Red Gates & Coverage Census | Track A (As-Built) | 4 | 0 | 0 | 4 | 0 |
| [`E2E-02`](./issues/E2E-02-http-contract-and-zod-schemas.md) | HTTP Contract, `@ZodResponse` & Negative Matrix | Track A + B | 6 | 0 | 0 | 6 | 0 |
| [`E2E-03`](./issues/E2E-03-http-zero-and-single-scenario-routes.md) | 17 Zero-Scenario & 47 Single-Scenario HTTP Routes | Track A (As-Built) | 7 | 0 | 0 | 7 | 0 |
| [`E2E-04`](./issues/E2E-04-headless-chrome-as-built.md) | Headless Chrome As-Built Suite (12 Scripts) | Track A (As-Built) | 12 | 0 | 0 | 12 | 0 |
| [`E2E-05`](./issues/E2E-05-local-validator-and-chain-e2e.md) | Local Validator, Anchor Programs & Block 1/2 E2E | Track A + B | 8 | 0 | 0 | 8 | 0 |
| [`E2E-06`](./issues/E2E-06-mockchain-and-replays-streams-e2e.md) | `mock-rpc`, Replays, Streams, Controls `C1..C36` & i18n | Track B (Target) | 8 | 0 | 0 | 8 | 0 |
| [`E2E-07`](./issues/E2E-07-anticheat-bots-and-resim-e2e.md) | Block 3 Anti-Cheat Driver Bots & 30 Hz Re-Sim | Track B (Target) | 8 | 0 | 0 | 8 | 0 |
| [`E2E-08`](./issues/E2E-08-minigames-and-rides-ranking-e2e.md) | Dynamic Finish, `RideResult`, Minigames & Pool Appeals | Track B (Target) | 6 | 0 | 0 | 6 | 0 |
| [`E2E-09`](./issues/E2E-09-admin-security-matrix-and-ci.md) | Admin Security Matrix (54+ Routes) & CI Pipeline | Track B (Target) | 5 | 0 | 0 | 5 | 0 |
| **Total** | | | **64** | **0** | **0** | **64** | **0** |

---

## Task-by-Task Status Tracker

### Epic E2E-01 — Red Gates & Coverage Census ([`issues/E2E-01-gates-and-census.md`](./issues/E2E-01-gates-and-census.md))

| Task ID | Title | Spec / Contract Ref | Track | Depends On | Status |
|---|---|---|---|---|---|
| `E2E-01.1` | Fix `veh\|medic` 21-mesh parity drift in `npm run test:parity` | `COVERAGE_CONTRACT` §2.5 | Track A | — | `[x] Done` |
| `E2E-01.2` | Fix `npm run test:tickets-stub` (`POST /api/tickets/orders/:id/reconcile` & `GET /api/referrals`) | `COVERAGE_CONTRACT` §2.5 | Track A | — | `[x] Done` |
| `E2E-01.3` | Map all 57 unmapped routes & 147 test files in `census.mjs` (`--self-test` green) | `COVERAGE_CONTRACT` §4.1 | Track A | — | `[x] Done` |
| `E2E-01.4` | Wire `census.mjs --self-test`, `test:parity`, and `test:tickets-stub` into root `npm run check` | `COVERAGE_CONTRACT` §4 | Track A | `E2E-01.1..3` | `[x] Done` |

### Epic E2E-02 — HTTP Contract, `@ZodResponse` & Negative Matrix ([`issues/E2E-02-http-contract-and-zod-schemas.md`](./issues/E2E-02-http-contract-and-zod-schemas.md))

| Task ID | Title | Spec / Contract Ref | Track | Depends On | Status |
|---|---|---|---|---|---|
| `E2E-02.1` | Build `routes.manifest.ts` + meta-test asserting 100% NestJS controller route registration | `API-T-01`, `API-M-01` | Track A + B | `E2E-01.3` | `[x] Done` |
| `E2E-02.2` | Enforce `@ZodResponse` schema validation (`RESPONSE_SCHEMA_CHECK=strict`) across all 151+ routes | `API-T-02..05`, `API-M-02` | Track A + B | `SPC-01.1`, `E2E-02.1` | `[x] Done` |
| `E2E-02.3` | Implement `expectDbDelta(prisma, tables, fn)` helper and instrument mutating route tests | `COVERAGE_CONTRACT` §2.2 | Track A | `E2E-02.1` | `[x] Done` |
| `E2E-02.4` | Build table-driven `negative-matrix.spec.ts` — Matrix A (unauth `401`, forbidden `403`, bad DTO `400`, `.strict()` unknown key `400`) | `API-T-06..09`, `API-M-04` | Track A + B | `SPC-01.3`, `E2E-02.1` | `[x] Done` |
| `E2E-02.5` | Build table-driven `negative-matrix.spec.ts` — Matrix B (foreign resource `:id` returns `404` on all player-owned endpoints) | `API-T-10`, `API-M-05` | Track A + B | `SPC-01.4`, `E2E-02.4` | `[x] Done` |
| `E2E-02.6` | Add `fast-check` DTO property fuzzing & OpenAPI `schemathesis` contract test | `API-T-11..13`, `API-M-03` | Track B | `SPC-01.2`, `E2E-02.2` | `[x] Done` |

### Epic E2E-03 — 17 Zero-Scenario & 47 Single-Scenario HTTP Routes ([`issues/E2E-03-http-zero-and-single-scenario-routes.md`](./issues/E2E-03-http-zero-and-single-scenario-routes.md))

| Task ID | Title | Spec / Contract Ref | Track | Depends On | Status |
|---|---|---|---|---|---|
| `E2E-03.1` | Add positive + ≥2 negative scenarios for 5 zero-scenario Admin routes (`re-verify`, `audit-log`, `rides/:id/samples`, `settings`, `wallet-Lookup`) | `COVERAGE_CONTRACT` §2.1 | Track A | `E2E-02.3` | `[x] Done` |
| `E2E-03.2` | Add positive + ≥2 negative scenarios for 8 zero-scenario Editor & Entity routes | `PLT-T-01..08` | Track A | `E2E-02.3` | `[x] Done` |
| `E2E-03.3` | Add positive + ≥2 negative scenarios for 4 zero-scenario Player, Auth, Live & Dev routes | `COVERAGE_CONTRACT` §2.1 | Track A | `E2E-02.3` | `[x] Done` |
| `E2E-03.4` | Add negative scenarios (`≥2` per route) for single-scenario Auth, Profile, Legal & Referral routes | `LEG-T-01..09`, `REF-T-01..06` | Track A | `E2E-02.3` | `[x] Done` |
| `E2E-03.5` | Add negative scenarios (`≥2` per route) for single-scenario Rides, Telemetry, Tickets & Promo routes | `RID-T-01..04`, `PRM-T-01..08` | Track A | `E2E-02.3` | `[x] Done` |
| `E2E-03.6` | Add negative scenarios (`≥2` per route) for single-scenario Pools, Replays, Watch, TEN4 & Blinks routes | `POOL-T-01..06`, `TEN-T-01..08` | Track A | `E2E-02.3` | `[x] Done` |
| `E2E-03.7` | Mirror 100% of `flows.spec.ts` scenarios into `flows.integration.spec.ts` (real PostgreSQL parity gate) | `COVERAGE_CONTRACT` §2.1–2.2 | Track A | `E2E-03.1..6` | `[x] Done` |

### Epic E2E-04 — Headless Chrome As-Built Suite ([`issues/E2E-04-headless-chrome-as-built.md`](./issues/E2E-04-headless-chrome-as-built.md))

| Task ID | Title | Spec / Contract Ref | Track | Depends On | Status |
|---|---|---|---|---|---|
| `E2E-04.1` | Headless Chrome: Guest ride completion (`tier='free'`) + `409 guest_free_only` & `409 training_tier_free_only` | `COVERAGE_CONTRACT` Phase 3.1 | Track A | `E2E-01.4` | `[x] Done` |
| `E2E-04.2` | Headless Chrome: Weekly 1h free-ride ticket auto-grant (`source='weekly'`) + promo credit precedence | `COVERAGE_CONTRACT` Phase 3.2 | Track A | `E2E-01.4` | `[x] Done` |
| `E2E-04.3` | Headless Chrome: `e2e-tickets.mjs` localnet reconcile (`POST /api/tickets/orders/:id/reconcile`) + foreign order `403/404` | `COVERAGE_CONTRACT` Phase 3.3 | Track A | `E2E-01.2` | `[x] Done` |
| `E2E-04.4` | Headless Chrome: `e2e-solana-pay.mjs` browser-side wallet sign & confirm after QR order | `COVERAGE_CONTRACT` Phase 3.4 | Track A | `E2E-01.4` | `[x] Done` |
| `E2E-04.5` | Headless Chrome: `e2e-live.mjs` negative checks (self-donate `400`, self-pledge `400`, rate-limit `429`) | `COVERAGE_CONTRACT` Phase 3.5 | Track A | `E2E-01.4` | `[x] Done` |
| `E2E-04.6` | Headless Chrome: `e2e-referral.mjs` full invitee MEDIUM ride → `qualifyOnRideVerified` → `referrerRideGift=2` | `COVERAGE_CONTRACT` Phase 3.6 | Track A | `E2E-01.4` | `[x] Done` |
| `E2E-04.7` | Headless Chrome: `e2e-honk-garage.mjs` Prize board tab (`GET /api/pools/:id/leaderboard`) & TEN4 catalog UI | `COVERAGE_CONTRACT` Phase 3.7 | Track A | `E2E-01.4` | `[x] Done` |
| `E2E-04.8` | Headless Chrome: `e2e-whitepaper.mjs` dedicated harness (`whitepaper.html` zero errors, anchors, diagrams) | `COVERAGE_CONTRACT` Phase 3.8 | Track A | `E2E-01.4` | `[x] Done` |
| `E2E-04.9` | Headless Chrome: `e2e-landing.mjs` empty-pool state (`GET /api/pools/current → null`, `paintHero` regression) | `COVERAGE_CONTRACT` Phase 3.9 | Track A | `SPC-01.6` | `[x] Done` |
| `E2E-04.10` | Headless Chrome: `e2e-editor.mjs` `POST /api/editor/auth/logout` → cookie cleared → `401` on next write | `COVERAGE_CONTRACT` Phase 3.10 | Track A | `E2E-01.4` | `[x] Done` |
| `E2E-04.11` | Headless Chrome: `e2e-achievements.mjs` multi-ride progress (`first-shift`, `100-miles`) + rejected ride skip | `COVERAGE_CONTRACT` Phase 3.11 | Track A | `E2E-01.4` | `[x] Done` |
| `E2E-04.12` | Headless Chrome: `e2e-admin.mjs` wrong host `403`, missing `adminSig` `401`, re-verify & sample inspection | `COVERAGE_CONTRACT` Phase 3.12 | Track A | `E2E-01.4` | `[x] Done` |

### Epic E2E-05 — Local Validator, Anchor Programs & Block 1/2 E2E ([`issues/E2E-05-local-validator-and-chain-e2e.md`](./issues/E2E-05-local-validator-and-chain-e2e.md))

| Task ID | Title | Spec / Contract Ref | Track | Depends On | Status |
|---|---|---|---|---|---|
| `E2E-05.1` | Pin `freightchain_honk` IDL drift check in `anchor-idl-drift.spec.ts` (all 7 instructions) | `COVERAGE_CONTRACT` Phase 4.1 | Track A | — | `[x] Done` |
| `E2E-05.2` | Extend `npm run test:localnet` with full SOL pool lifecycle + `pledge_ride` / `settle_pledge` / `refund_pledge` | `POOL-T-01..10`, `SOL-T-01..08` | Track A | `E2E-05.1` | `[x] Done` |
| `E2E-05.3` | Extend `honk-suite` with negative checks (`tier='free'` training ride & weekly grant ride mint `0` TEN4) | `TEN-T-01..15` | Track A | `E2E-05.1` | `[x] Done` |
| `E2E-05.4` | Complete pending Block 1 & Block 2 tests (`B1-REF-04`, `B2-PROMO-02`, `B2-ADMIN-04`, `B2-API-06`, `B2-API-07`, `B2-HONK-02`) | `E2E-T-02..07`, `E2E_PLAN.md` | Track A | `E2E-05.1` | `[x] Done` |
| `E2E-05.5` | Implement `SOL-T-01..16` (SIWS auth, `.sol` SNS resolution, Blink CORS/actions, soulbound cNFT outbox) | `SOL-T-01..16` | Track A + B | `E2E-05.2` | `[x] Done` |
| `E2E-05.6` | Implement `PRM-T-01..14` (Promo code normalization, caps, expiry, batch generation, race conditions) | `PRM-T-01..14` | Track A + B | `E2E-03.5` | `[x] Done` |
| `E2E-05.7` | Implement Target Convoy Referral E2E suite (`REF-T-01..22`: `pending→active→qualified→expired`, M1/M2 TEN4, caps) | `REF-T-01..22`, `REF-M-15` | Track B | `SPC-08.1..3` | `[x] Done` |
| `E2E-05.8` | Implement Target TEN4 Airdrop & Pre-Season E2E suite (Telegram/X tasks, `twitterapi.io` mock, Turnstile, Sybil hold) | `TEN-T-10..15`, `DEVNET_PRESEASON` | Track B | `SPC-08.4..5` | `[x] Done` |

### Epic E2E-06 — `mock-rpc`, Replays, Streams, Controls `C1..C36` & i18n ([`issues/E2E-06-mockchain-and-replays-streams-e2e.md`](./issues/E2E-06-mockchain-and-replays-streams-e2e.md))

| Task ID | Title | Spec / Contract Ref | Track | Depends On | Status |
|---|---|---|---|---|---|
| `E2E-06.1` | Build deterministic `e2e/mockchain/rpc.mjs` (`mock-rpc`) + `e2e/harness/wallet.mjs` (`E1M` runtime) | `RPL-T-95..99`, `replays_streams.md` §7 | Track B | — | `[x] Done` |
| `E2E-06.2` | Implement Replay Lifecycle & Visibility E2E (`RPL-T-01..15`, `M-RPL-01..06`: running=`404`, training hidden, pool gated until `payout_at`, no `SAMPLE_INPUT_COL`) | `RPL-T-01..15`, `M-RPL-01..06` | Track B | `SPC-04.1..3` | `[x] Done` |
| `E2E-06.3` | Implement EN/RU Localization & Legal Copy E2E (`RPL-T-16..29`, `LEG-T-01..11`: `?lang=ru`, `fc_lang`, no English leaks, banned words grep) | `RPL-T-16..29`, `LEG-T-01..11` | Track B | `SPC-04.9`, `SPC-08.6` | `[x] Done` |
| `E2E-06.4` | Implement Replay Player Controls `C1..C19` Headless Chrome E2E (`RPL-T-30..48`: play/pause, speed `0.5x..4x`, scrub, `±10s`, camera `C`, fullscreen `F`, event markers, volume/mute, share `?t=`) | `RPL-T-30..48`, `RPL-M-13` | Track B | `SPC-04.7` | `[x] Done` |
| `E2E-06.5` | Implement Replay HUD, Telemetry & Removal Controls `C20..C36` E2E (`RPL-T-49..60`: `C36` mini-chart, `C9/C26/C27/C32` absent) | `RPL-T-49..60`, `RPL-M-13` | Track B | `SPC-04.7` | `[x] Done` |
| `E2E-06.6` | Implement Replay Chat & Time-Binding E2E (`RPL-T-61..69`: `replayT` sorting, 200-char limit, link/word filter, `P01` hide, `P02` ban, 90d retention) | `RPL-T-61..69`, `RPL-M-25..31` | Track B | `SPC-04.8` | `[x] Done` |
| `E2E-06.7` | Implement Replay Tip-Only Donations & `GET /api/me/donations` E2E via `mock-rpc` (`RPL-T-70..90`: 0.01/0.05/0.1 SOL, min/max, 15m expiry, ≤3 open orders, 0% referral share, effects removed) | `RPL-T-70..90`, `RPL-M-14..23` | Track B | `E2E-06.1`, `SPC-04.4..6` | `[x] Done` |
| `E2E-06.8` | Implement Pledges Disabled & Receipt/Blink E2E (`RPL-T-91..102`: `403 pledges_disabled`, `r.html`, `blink.html`, OG PNG caching) | `RPL-T-91..102`, `RPL-M-24, 33` | Track B | `SPC-04.6` | `[x] Done` |

### Epic E2E-07 — Block 3 Anti-Cheat Driver Bots & 30 Hz Re-Sim ([`issues/E2E-07-anticheat-bots-and-resim-e2e.md`](./issues/E2E-07-anticheat-bots-and-resim-e2e.md))

| Task ID | Title | Spec / Contract Ref | Track | Depends On | Status |
|---|---|---|---|---|---|
| `E2E-07.1` | Build `tests/e2e/block3-anticheat` harness with dual driver bot engines (`engine: 'game'` & `engine: 'kernel'`) + behavioral profiles (`perfect`, `human-like`, ` drowsy`, `aggro`, `bot-quantized`) | `anticheat.md` §10, `ACH-T-01` | Track B | `SPC-06.2` | `[x] Done` |
| `E2E-07.2` | Implement 30 Hz Deterministic Physics & Re-Sim Parity Suite (`AC-P1..P12`: zero drift across 108,000 ticks, gearbox, damage, fuel, cold, off-road) | `AC-P1..P12`, `ACH-M-01, 12` | Track B | `E2E-07.1`, `SPC-06.2` | `[x] Done` |
| `E2E-07.3` | Implement Telemetry v2.1 Wire, HMAC & Deflate Stream Suite (`AC-T1..T16`: `sessionKey` MAC, `inp`/`clk`/`chk`/`mg`/`env`, seq gaps, `batch-mac-invalid`, payload caps) | `AC-T1..T16`, `ACH-M-02, 03, 05` | Track B | `E2E-07.1`, `SPC-06.1` | `[x] Done` |
| `E2E-07.4` | Implement World Integrity, Salt Commit–Reveal & Digest Suite (`AC-W1..W18`: `roadSeed`, `trafficSalt`, `holeSalt`, `worldDigest32` tamper detection) | `AC-W1..W18`, `ACH-M-05, 11` | Track B | `E2E-07.1`, `SPC-06.4` | `[x] Done` |
| `E2E-07.5` | Implement Mechanical Input Humanness (`F1..F10`) & 5 Physical-Impossibility Reject Rules (`AC-H1..H3`, `ACH-T-02..03`) | `AC-H1..H3`, `ACH-M-06, 07` | Track B | `E2E-07.1`, `SPC-06.5` | `[x] Done` |
| `E2E-07.6` | Implement Pause, Slow-Mo, Wall-Clock & 90-Minute Timeout Suite (`AC-F1..F11`, `AC-R1..R8`) | `AC-F1..11`, `AC-R1..8`, `ACH-M-04` | Track B | `E2E-07.1`, `SPC-06.3` | `[x] Done` |
| `E2E-07.7` | Implement Full 58-Vector Cheat Catalog Regression Suite (`#1..#58` in `anticheat.md` §9: speedhack, teleport, no-clip, DOM tamper, replay attack, clock skew, bot macros) | `anticheat.md` §9 (`#1..#58`) | Track B | `E2E-07.2..6` | `[x] Done` |
| `E2E-07.8` | Implement 90-Day Input Trace Retention, Top-20 Clustering & Anti-Sybil `TrustScore` E2E (`ACH-T-04`, `ACH-M-13`) | `ACH-T-04`, `ACH-M-13`, Appendix D | Track B | `SPC-06.6`, `SPC-08.5` | `[x] Done` |

### Epic E2E-08 — Dynamic Finish, `RideResult`, Minigames & Pool Appeals ([`issues/E2E-08-minigames-and-rides-ranking-e2e.md`](./issues/E2E-08-minigames-and-rides-ranking-e2e.md))

| Task ID | Title | Spec / Contract Ref | Track | Depends On | Status |
|---|---|---|---|---|---|
| `E2E-08.1` | Implement Dynamic 65 km/h Finish & Curvature Factors E2E (`RID-T-01..07`: 4h/8h rejected, `finishFor` deterministic within `[48, 65] km`, `snapSafe`, 1h finish line) | `RID-T-01..07`, `RID-M-01..11` | Track B | `SPC-03.1..3` | `[x] Done` |
| `E2E-08.2` | Implement `stats.RideResult` Breakdown & Pool Ranking Formula E2E (`RID-T-08..12`: damage by source, red lights, `scoreFormulaVersion`, `GET /api/pools/:id/results` gated by `payout_at`) | `RID-T-08..12`, `RID-M-12..21` | Track B | `SPC-03.4..6` | `[x] Done` |
| `E2E-08.3` | Phone-sms schedule, cancel, and salt reveal E2E (`MGM-T-01..05`) | `MGM-T-01..05`, `MGM-M-01..05` | Track B | `SPC-07.1..2` | `[x] Done` |
| `E2E-08.4` | Phone-sms SVG, scoring, and rate-limit E2E (`MGM-T-06..12`) | `MGM-T-06..12`, `MGM-M-06..12` | Track B | `SPC-07.3..5` | `[x] Done` |
| `E2E-08.5` | Implement Pool Schedule, `last_start_at` Cutoff, Ticket Burn UI & Appeals E2E (`POOL-T-01..16`: `409 pool_schedule_mismatch`, `409 pool_last_start_passed`, appeals workflow, v6 fields) | `POOL-T-01..16`, `POOL-M-01..14` | Track B | `SPC-05.1..5` | `[x] Done` |
| `E2E-08.6` | Implement Platform Services E2E (`PLT-T-01..14`: PostHog opt-in, Redis fail-closed AI limits, dedicated editor worker, bundle revision signing) | `PLT-T-01..14`, `PLT-M-01..12` | Track A + B | `E2E-03.2` | `[x] Done` |

### Epic E2E-09 — Admin Security Matrix & CI Pipeline ([`issues/E2E-09-admin-security-matrix-and-ci.md`](./issues/E2E-09-admin-security-matrix-and-ci.md))

| Task ID | Title | Spec / Contract Ref | Track | Depends On | Status |
|---|---|---|---|---|---|
| `E2E-09.1` | Build Automated Privileged Surface Matrix Runner (`ADM-T-01..12` across all 54+ routes: `A01..A33`, `E01..E17`, `M01..M04`, `S01..S03`, `P01..P04`) | `ADM-T-01..12`, `ADM-M-01..06` | Track B | `SPC-02.1..3` | `[x] Done` |
| `E2E-09.2` | Implement Admin Security Findings Regression Suite (`ADM-T-20..32`: strict startup env, 60m TTL + `jti` revoke, auth throttle + dummy nonce, IP allowlist, `/24` IP mask) | `ADM-T-20..32`, `F01..F18`, `ADM-M-08..14` | Track B | `SPC-02.4..6` | `[x] Done` |
| `E2E-09.3` | Implement Append-Only `AdminAction` Audit, Dual Approval & Telegram `AlertOutbox` E2E (`ADM-T-33..44`) | `ADM-T-33..44`, `ADM-M-15..21` | Track B | `SPC-02.7..9` | `[x] Done` |
| `E2E-09.4` | Wire PR Fast-Gate (`npm run check`, `server:integration`, `test:e2e:block1`, `negative-matrix`) & Nightly Full-Stack CI (`e2e.sh`, `block2`, `block3`, `mockchain`) | `E2E-T-01..07`, `COVERAGE_CONTRACT` §4 | Track A + B | `E2E-01..08` | `[x] Done` |
| `E2E-09.5` | Final `census.mjs` 100% green audit across all 151+ routes, 28+ tables, 12 HTML pages, 19 Anchor instructions & 211 spec rules | `COVERAGE_CONTRACT` §2–4 | Track A + B | `E2E-09.1..4` | `[x] Done` |
