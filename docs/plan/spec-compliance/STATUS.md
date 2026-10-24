# Plan 2 Status Board — Make All Code Follow Specs

> **Master Plan:** [`docs/plan/SPEC_COMPLIANCE_PLAN.md`](../SPEC_COMPLIANCE_PLAN.md)
> **Status Legend:** `[ ] Todo` · `[~] In Progress` · `[x] Done` · `[!] Blocked (awaiting owner decision)`

---

## Summary Progress

The 24 October [local readiness audit](../../testing/LOCAL_READINESS.md) reopened six implementation tasks. Other checked entries retain their earlier task status; they are not certification that every feature passed the current runtime gate.

| Epic | Domain | Spec Docs | Total Tasks | Todo | In Progress | Done | Blocked |
|---|---|---|---|---|---|---|---|
| [`SPC-01`](./issues/SPC-01-backend-contract-and-validation.md) | Backend Contract, `@ZodResponse`, `.strict()` & Geo/Hero Fixes | `backend_contract.md`, `legal.md` | 6 | 0 | 0 | 6 | 0 |
| [`SPC-02`](./issues/SPC-02-admin-and-privileged-security.md) | Admin & Privileged Security (`F01..F18`) | `admin_security.md` | 9 | 0 | 0 | 9 | 0 |
| [`SPC-03`](./issues/SPC-03-rides-dynamic-finish-and-ride-result.md) | Rides, Dynamic 65 km/h Finish & `stats.RideResult` | `rides.md` | 6 | 0 | 0 | 6 | 0 |
| [`SPC-04`](./issues/SPC-04-replays-streams-donations-and-i18n.md) | Replays, Tip-Only Donations, Controls `C1..C36`, Chat & EN/RU i18n | `replays_streams.md`, `legal.md` | 9 | 0 | 0 | 9 | 0 |
| [`SPC-05`](./issues/SPC-05-pool-schedule-appeals-and-program-v6.md) | Pool Schedule, `last_start_at`, Appeals & Program v6 | `pool.md` | 6 | 0 | 1 | 5 | 0 |
| [`SPC-06`](./issues/SPC-06-anticheat-v2-and-30hz-resim.md) | Anti-Cheat v2.1, 30 Hz Server Re-Sim & Humanness `F1..F10` | `anticheat.md` | 6 | 0 | 0 | 6 | 0 |
| [`SPC-07`](./issues/SPC-07-minigames-framework-and-catalog.md) | Phone `phone-sms` (ported, default off) | `minigames.md` | 5 | 0 | 0 | 5 | 0 |
| [`SPC-08`](./issues/SPC-08-referral-convoy-ten4-airdrop-and-trust.md) | Referral Convoy, TEN4 Airdrop, `TrustScore` & `TermsGuard` | `referral.md`, `ten4.md`, `promocodes.md`, `web3_solana.md`, `platform_services.md` | 6 | 0 | 5 | 1 | 0 |
| **Total** | | | **53** | **0** | **6** | **47** | **0** |

---

## Task-by-Task Status Tracker

### Epic SPC-01 — Backend Contract, `@ZodResponse`, `.strict()` & Validation ([`issues/SPC-01-backend-contract-and-validation.md`](./issues/SPC-01-backend-contract-and-validation.md))

| Task ID | Title | Spec Rules | Paired Plan 1 Test | Depends On | Status |
|---|---|---|---|---|---|
| `SPC-01.1` | Implement `@ZodResponse(schema)` decorator, `ZodResponseInterceptor` (`RESPONSE_SCHEMA_CHECK`), and attach schemas to all 151+ routes | `API-M-01`, `API-M-02`, `API-M-06..09` | `E2E-02.1`, `E2E-02.2` | — | `[x] Done` |
| `SPC-01.2` | Build OpenAPI 3.1 generator (`npm --prefix backend/server run openapi:generate` → `openapi.json`) from controller + Zod metadata | `API-M-03` | `E2E-02.6` | `SPC-01.1` | `[x] Done` |
| `SPC-01.3` | Enforce `.strict()` on all Admin, Editor, Auth, Ticket, Pool, Promo, and Money request Zod schemas | `API-M-04`, `ADM-M-12` | `E2E-02.4` | — | `[x] Done` |
| `SPC-01.4` | Standardize foreign resource `:id` ownership checks to return `404` across all player-scoped endpoints | `API-M-05`, `API-M-10` | `E2E-02.5` | — | `[x] Done` |
| `SPC-01.5` | Enforce fail-closed geo eligibility when `CF-IPCountry` is absent in production (`PRIZE_DEV_DEFAULT_COUNTRY` dev-only) | `API-M-11`, `LEG-M-04..06` | `E2E-06.3` | — | `[x] Done` |
| `SPC-01.6` | Fix `frontend/landing` `paintHero` null-pool crash when `GET /api/pools/current` returns `null` | `API-M-12`, `API-M-13` | `E2E-04.9` | — | `[x] Done` |

### Epic SPC-02 — Admin & Privileged Security ([`issues/SPC-02-admin-and-privileged-security.md`](./issues/SPC-02-admin-and-privileged-security.md))

| Task ID | Title | Spec Rules | Paired Plan 1 Test | Depends On | Status |
|---|---|---|---|---|---|
| `SPC-02.1` | Implement default-deny `PrivilegedSurfaceGuard` + startup meta-check across `/api/admin/*`, `/api/editor/*`, `/api/dev/*`, `/api/mcp/*` | `ADM-M-01`, `ADM-M-02`, `F01`, `F02` | `E2E-09.1` | `SPC-01.3` | `[x] Done` |
| `SPC-02.2` | Implement 3-role RBAC (`admin`, `moderator`, `editor`) via `@Roles()` and moderation routes `P01..P04` | `ADM-M-03`, `ADM-M-04`, `F06` | `E2E-09.1` | `SPC-02.1` | `[x] Done` |
| `SPC-02.3` | Separate `ADMIN_JWT_SECRET` and `EDITOR_JWT_SECRET` + cryptographic domain separation | `ADM-M-05`, `F04` | `E2E-09.1` | `SPC-02.1` | `[x] Done` |
| `SPC-02.4` | Harden non-dev startup invariant (`NODE_ENV` allowlist `development`/`test` only for `DEMO_WALLETS`, `EDITOR_FAKE_LLM`, `LIVE_FREE_DONATIONS`, `LIVE_EFFECTS`) | `ADM-M-08`, `F03`, `F05` | `E2E-09.2` | — | `[x] Done` |
| `SPC-02.5` | Cap admin/editor session TTL at ≤ 60 min + Redis `jti` revocation list on logout | `ADM-M-09`, `ADM-M-10`, `F07`, `F08` | `E2E-09.1`, `E2E-09.2` | `SPC-02.3` | `[x] Done` |
| `SPC-02.6` | Harden `/api/admin/auth/*` (strict throttle, indistinguishable dummy nonce for non-admins, challenge keyed by `(wallet, clientFingerprint)`) | `ADM-M-11`, `F09`, `F10`, `F11` | `E2E-09.2` | `SPC-02.1` | `[x] Done` |
| `SPC-02.7` | Implement `ADMIN_IP_ALLOWLIST` guard + `/24` IPv4 / `/48` IPv6 log & audit masking | `ADM-M-13`, `ADM-M-14`, `F12`, `F13` | `E2E-09.2` | `SPC-02.1` | `[x] Done` |
| `SPC-02.8` | Enforce DB-level append-only `admin.AdminAction` (`PostgreSQL` trigger + `beforeState`/`afterState` + PII read audit + CLI script audit) | `ADM-M-15..18`, `F14`, `F15` | `E2E-09.3` | `SPC-02.1` | `[x] Done` |
| `SPC-02.9` | Implement `admin.AlertOutbox` + Telegram alert worker + overview alert banner + dual-admin approval (`ADMIN_APPROVAL_MODE=single\|dual`) | `ADM-M-19..21`, `F16..F18` | `E2E-09.3` | `SPC-02.8` | `[x] Done` |

### Epic SPC-03 — Rides, Dynamic 65 km/h Finish & `stats.RideResult` ([`issues/SPC-03-rides-dynamic-finish-and-ride-result.md`](./issues/SPC-03-rides-dynamic-finish-and-ride-result.md))

| Task ID | Title | Spec Rules | Paired Plan 1 Test | Depends On | Status |
|---|---|---|---|---|---|
| `SPC-03.1` | Remove `4h` and `8h` ride creation (restrict valid shifts to `tier='free'` training and `tier='1h'` standard shift) | `RID-M-01`, `RID-M-02` | `E2E-08.1` | — | `[x] Done` |
| `SPC-03.2` | Implement `finishFor(roadSeed, trip, FINISH_RULES_VERSION)` at `V_BASE = 65 km/h` with `(RX, RZ, RT)` curvature factors & `snapSafe` in `@freightchain/shared` and server | `RID-M-03..08`, `RID-M-10` | `E2E-08.1` | `SPC-03.1` | `[x] Done` |
| `SPC-03.3` | Render physical finish line (`finish: true`) on 1h shifts + enforce 90-minute wall-clock `T_cap` (`5400s`) | `RID-M-09`, `RID-M-11` | `E2E-08.1`, `E2E-07.6` | `SPC-03.2` | `[x] Done` |
| `SPC-03.4` | Track damage by source (`holes`, `vehicles`, `props`, `cold`, `other`) & server-side red-light crossings (`stopLine(j, +1)`) | `RID-M-13`, `RID-M-14` | `E2E-08.2` | `SPC-03.2` | `[x] Done` |
| `SPC-03.5` | Add Prisma migration & repository for `stats.RideResult` (`1:1` with `ride.Ride`) and populate on ride verification | `RID-M-12`, `RID-M-15`, `RID-M-16` | `E2E-08.2` | `SPC-03.4` | `[x] Done` |
| `SPC-03.6` | Implement versioned pool ranking formula (`scoreFormulaVersion`) & `GET /api/pools/:id/results` gated by `payout_at` | `RID-M-17..21` | `E2E-08.2` | `SPC-03.5` | `[x] Done` |

### Epic SPC-04 — Replays, Tip-Only Donations, Controls `C1..C36`, Chat & EN/RU i18n ([`issues/SPC-04-replays-streams-donations-and-i18n.md`](./issues/SPC-04-replays-streams-donations-and-i18n.md))

| Task ID | Title | Spec Rules | Paired Plan 1 Test | Depends On | Status |
|---|---|---|---|---|---|
| `SPC-04.1` | Disable live watch of running rides (`GET /api/watch/:id` & `/road` → `404` when `running`; remove active stream polling) | `RPL-M-01`, `RPL-M-02` | `E2E-06.2` | — | `[x] Done` |
| `SPC-04.2` | Hide training rides (`tier='free'`, guest, tutorial/assist) from public replays/watch/receipts/Blinks + gate pool replays until `payout_at` (except owner) | `RPL-M-03..06`, `RPL-M-08, 09, 24` | `E2E-06.2`, `E2E-06.8` | `SPC-04.1` | `[x] Done` |
| `SPC-04.3` | Strip `SAMPLE_INPUT_COL` & raw input bits from public `/api/watch/:id` responses (retain cinematic samples only) | `RPL-M-07` | `E2E-06.2` | `SPC-04.1` | `[x] Done` |
| `SPC-04.4` | Remove gameplay donation effects (`night`, `day`, `potholes`, `trench`, `sinkhole`, `effects/:eventId/applied`) & remove `honk/time` and `honk/weather` | `RPL-M-17`, `RPL-M-34` | `E2E-06.7` | — | `[x] Done` — Donation effects other than tip are `400 donation_effect`. `honk/time` and `honk/weather` throw `NotFoundError` (`404` `not_found`) before any TEN4 debit. They are not a live burn. |
| `SPC-04.5` | Rework donations to replay-only SOL tips (`0.01/0.05/0.1` presets, `[0.001, 1.0]` SOL bounds, 15m expiry, ≤3 open orders, `95/5` split, `0%` referral share, no `also` leg) | `RPL-M-14..16`, `RPL-M-19..23` | `E2E-06.7` | `SPC-04.4` | `[x] Done` |
| `SPC-04.6` | Add `GET /api/me/donations` (`sent`/`received` history) & disable pledges on devnet launch (`PLEDGES_ENABLED=0` → `403 pledges_disabled`) | `RPL-M-18`, `RPL-M-33` | `E2E-06.7`, `E2E-06.8` | `SPC-04.5` | `[x] Done` |
| `SPC-04.7` | Build replay player controls `C3, C6, C7, C8, C15, C16, C17, C18, C19, C36` and remove `C9, C26, C27, C32` in `frontend/client/` | `RPL-M-11..13`, `RPL-M-32` | `E2E-06.4`, `E2E-06.5` | `SPC-04.1` | `[x] Done` |
| `SPC-04.8` | Implement replay chat time-binding (`replayT`), 200-char/link/word filter, moderation endpoints `P01/P02`, and 90-day chat retention job | `RPL-M-25..31` | `E2E-06.6` | `SPC-02.2`, `SPC-04.1` | `[x] Done` |
| `SPC-04.9` | Implement `frontend/client/site/i18n.js` full EN/RU localization across lobby, replay viewer, receipts, and error codes (`?lang=`, `fc_lang`, `Accept-Language`) | `RPL-M-10`, `RPL-M-10a`, `LEG-M-10, 11` | `E2E-06.3` | — | `[x] Done` |

### Epic SPC-05 — Pool Schedule, `last_start_at`, Appeals & Program v6 ([`issues/SPC-05-pool-schedule-appeals-and-program-v6.md`](./issues/SPC-05-pool-schedule-appeals-and-program-v6.md))

| Task ID | Title | Spec Rules | Paired Plan 1 Test | Depends On | Status |
|---|---|---|---|---|---|
| `SPC-05.1` | Implement configurable weekly pool schedule (`opens_at`, `sales_close_at`, `last_start_at = close - 1h15m`, `play_close_at`, `validation_until = payout_at`) | `POOL-M-01..04` | `E2E-08.5` | — | `[x] Done` |
| `SPC-05.2` | Enforce `409 pool_last_start_passed` on ride start & `409 pool_schedule_mismatch` on DB vs on-chain PDA timestamp drift | `POOL-M-05`, `POOL-M-06`, `POOL-M-11` | `E2E-08.5` | `SPC-05.1` | `[x] Done` |
| `SPC-05.3` | Add non-refundable ticket burn rule after `last_start_at` + lobby purchase warning modal & mandatory confirmation checkbox | `POOL-M-07` | `E2E-08.5` | `SPC-05.2` | `[x] Done` |
| `SPC-05.4` | Implement pool validation & appeals workflow (`POST /api/rides/:id/appeal`, admin review queue, block `commit_winners_root` until `validation_until` & 0 open appeals) | `POOL-M-08`, `POOL-M-09` | `E2E-08.5` | `SPC-05.1` | `[x] Done` |
| `SPC-05.5` | Update `freightchain_pools` program: `Config.min_finish_secs <= 7200` + v6 schedule fields (`opens_at`, `last_start_at`, `period_secs`) | `POOL-M-10`, `POOL-M-13, 14` | `E2E-08.5` | `SPC-05.1` | `[~] In Progress` |
| `SPC-05.6` | Resolve `set_pool_rules` governance conflict (`POOL-M-12`/`B8` Admin HTTP vs `ADM-M-07`/Decision 60 Squads multisig-only) | `POOL-M-12` vs `ADM-M-07` | `E2E-08.5`, `E2E-09.1` | Decision 70 | `[x] Done` — Decision 70 (24.10.2026): no admin HTTP route. `pool-admin.mjs set-pool-rules` sends it. On mainnet, Squads. |

### Epic SPC-06 — Anti-Cheat v2.1, 30 Hz Server Re-Sim & Humanness `F1..F10` ([`issues/SPC-06-anticheat-v2-and-30hz-resim.md`](./issues/SPC-06-anticheat-v2-and-30hz-resim.md))

| Task ID | Title | Spec Rules | Paired Plan 1 Test | Depends On | Status |
|---|---|---|---|---|---|
| `SPC-06.1` | Implement Telemetry v2.1 wire protocol (`sessionKey` per-batch HMAC-SHA256, deflate streams `inp`/`clk`/`chk`/`mg`/`env`, `batch-mac-invalid`) | `ACH-M-02`, `ACH-M-03`, `ACH-M-05` | `E2E-07.3` | — | `[x] Done` — Enforce mode has named deflate streams `inp`/`clk`/`chk`/`mg`/`env` and the HMAC-before-inflate. Default `TELEMETRY_V21` stays `off`. `off` and `shadow` do not require the streams. |
| `SPC-06.2` | Upgrade client & server `ReplayEngine` to 30 Hz fixed-step deterministic simulation (`dt = 1/30s`) + incremental per-batch server re-sim & background final verdict | `ACH-M-01`, `ACH-M-08..10`, `ACH-M-12` | `E2E-07.1`, `E2E-07.2` | `SPC-06.1` | `[x] Done` — Decision 69 (24.10.2026): the live `ReplayEngine` stays at 10 Hz. `stepAt30Hz` is not the judge. |
| `SPC-06.3` | Enforce pause (`≤3` pauses, `≤5 min` cumulative) and slow-motion (`dt` / wall-clock drift) anti-cheat bounds | `ACH-M-04` | `E2E-07.6` | `SPC-06.2` | `[x] Done` — A fourth pause, more than five minutes paused, or sustained slow-motion: `off` adds no reasons, `shadow` flags, and `enforce` rejects. `RULES_VERSION` stays 7. |
| `SPC-06.4` | Implement shared pool `roadSeed` + per-ride `trafficSalt` & `holeSalt` commit–reveal (`HMAC-SHA256`) and `worldDigest32` verification | `ACH-M-05`, `ACH-M-11` | `E2E-07.4` | `SPC-06.2` | `[x] Done` — Start stores traffic and hole salt commitments and enforce compares `worldDigest32` of spawned holes, junctions, and traffic. A short mismatch flags; one that lasts at least 10 seconds after three points rejects. The 10 Hz road rebuild does not read the salts. |
| `SPC-06.5` | Implement mechanical input humanness classifier (`F1..F10` → `humannessScore`), 5 physical-impossibility auto-reject rules, and `isTrusted=false` tracking | `ACH-M-06`, `ACH-M-07`, `ACH-M-14..16` | `E2E-07.5`, `E2E-07.7` | `SPC-06.2` | `[x] Done` — F1–F10 score 0–100. The five physical-impossibility cases reject. A borderline score or `isTrusted=false` is `flagged_for_review`. No browser fingerprint. |
| `SPC-06.6` | Implement 90-day raw input trace retention job & pool top-20 cross-ride input trace clustering detector | `ACH-M-13` | `E2E-07.8` | `SPC-06.5` | `[x] Done` — Top-20 verified rides in an open validation window are compared. A similar pair raises `trace-cluster` and those rides are flagged for review. A copied trace of 50 or more intervals rejects. Raw `inp` older than 90 days can be deleted only after that pool's payout is finalized. |

### Epic SPC-07 — Phone `phone-sms` (ported, default off) ([`issues/SPC-07-minigames-framework-and-catalog.md`](./issues/SPC-07-minigames-framework-and-catalog.md))

| Task ID | Title | Spec Rules | Paired Plan 1 Test | Depends On | Status |
|---|---|---|---|---|---|
| `SPC-07.1` | Port `mgSalt` commit–reveal and the `phone-sms` schedule (`2..4` arms, time gaps, null `slotS`) | `MGM-M-01..04` | `E2E-08.3` | `SPC-06.2` | `[x] Done` |
| `SPC-07.2` | Port arm, cancel, and one client deferral. Do not add a parking pocket | `MGM-M-05` | `E2E-08.3` | `SPC-07.1` | `[x] Done` |
| `SPC-07.3` | Port the SVG phone-sms renderer (dispatch mark, one true cab slip, no code in the open JSON) | `MGM-M-07` | `E2E-08.4` | `SPC-07.1` | `[x] Done` |
| `SPC-07.4` | Port `RideMiniGame`, open / answer / SVG routes, and the accepted catalog (`phone-sms` only) | `MGM-M-04`, `MGM-M-09`, `MGM-M-11` | `E2E-08.4` | `SPC-07.2`, `SPC-07.3` | `[x] Done` |
| `SPC-07.5` | Port scoring (`+20` s only after 3 wrong tries), `missed` with no extra seconds, and `more-time` (60 s) | `MGM-M-06`, `MGM-M-08` | `E2E-08.4` | `SPC-07.4` | `[x] Done` |

### Epic SPC-08 — Referral Convoy, TEN4 Airdrop, `TrustScore` & `TermsGuard` ([`issues/SPC-08-referral-convoy-ten4-airdrop-and-trust.md`](./issues/SPC-08-referral-convoy-ten4-airdrop-and-trust.md))

| Task ID | Title | Spec Rules | Paired Plan 1 Test | Depends On | Status |
|---|---|---|---|---|---|
| `SPC-08.1` | Implement Convoy Referral state machine (`pending` 72h expiry delete → `active` 60d window on first verified MEDIUM/HARD ride → `qualified` / `expired`) & dynamic pending slot cap `min(100, 5 + 2*A)` | `REF-M-01..07`, `REF-M-15` | `E2E-05.7` | — | `[~] In Progress` |
| `SPC-08.2` | Implement Convoy invitee 1h promo ride gift on activation with `3/day`, `10/week` per-referrer and `500/week` global caps + M1 (`100 TEN4` @ 2 ISO weeks) & M2 (`50 TEN4` @ 5 ISO weeks) rewards | `REF-M-08..12`, `REF-M-15` | `E2E-05.7` | `SPC-08.1` | `[~] In Progress` |
| `SPC-08.3` | Implement 25-row Convoy leaderboard (`GET /api/referrals/leaderboard`) & `convoyHidden` privacy toggle (`PATCH /api/me/privacy`) | `REF-M-13`, `REF-M-14`, `REF-M-15` | `E2E-05.7` | `SPC-08.2` | `[~] In Progress` |
| `SPC-08.4` | Implement Pre-Season TEN4 Airdrop campaign engine (MEDIUM/HARD ride gate, Telegram check, X verification via `twitterapi.io`, Turnstile, unique social ID binding) | `TEN-M-01..11`, `DEVNET_PRESEASON` | `E2E-05.8` | `SPC-08.1` | `[~] In Progress` |
| `SPC-08.5` | Implement Anti-Sybil `TrustScore` service (ASN, device fingerprint, funding cluster, humanness score, `<50` payout block, 48h reward hold queue) | `anticheat.md` Appendix D, `REF-M-15` | `E2E-05.7`, `E2E-05.8`, `E2E-07.8` | `SPC-06.5` | `[~] In Progress` — 48h ledger hold exists; accepted scoring/ASN/funding signals and chain release remain open. Browser fingerprinting stays rejected. |
| `SPC-08.6` | Implement `TermsGuard` (`CURRENT_TERMS_VERSION` re-consent enforcement on all write routes) & scrub banned gambling terms across `frontend/` | `LEG-M-01..11` | `E2E-06.3` | `SPC-01.5` | `[x] Done` — TermsGuard: a player write whose terms or privacy version is missing or older is `403 terms_acceptance_required`. UI copy has no `bet`, `wager`, `gamble`, `jackpot`, `casino`, `lottery`, or `raffle`. The only hit is a landing test that forbids those words. No separate scrub pass. |
