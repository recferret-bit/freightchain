# E2E blocks — spec and test plan

> Summary of PR #5 (`cursor/local-e2e-suite-b044`) after the merge of PR #3 into `origin/main` (`e8f338ad`). The checklist — [`docs/testing/E2E_PLAN.md`](../testing/E2E_PLAN.md), manual checks — [`docs/testing/MANUAL_TESTS.md`](../testing/MANUAL_TESTS.md). Decisions 1–66 were not changed.
>
> **2026-10-18.** This file describes the fast happy-dom run. It is not the coverage bar. Decisions 67 and 68 ([`PROCESS.md`](PROCESS.md), [`../testing/COVERAGE_CONTRACT.md`](../testing/COVERAGE_CONTRACT.md)) withdraw **E2E-M-01** (e2e without a browser) and **E2E-M-06** (rewrite or delete the live-viewing Chrome scripts). Those scripts check what is already built, and they stay until a separate change changes the product.

## Part 1. Spec
### 1.1 How PR #5 is structured
- **No browser.** Page modules run under `happy-dom` with a mocked `fetch`. API checks go to a real server on the compose database and are skipped without `E2E_BASE`. `test:e2e:block1/2` set `E2E_REQUIRE=1`, so the run fails without a server.
- **Compose** `docker-compose.e2e.yml`:
  - `postgres:17-alpine` on `127.0.0.1:15434`, `redis:7-alpine` on `16381`;
  - **there is no Solana service**: block 2 uses the host's `solana-test-validator` (Agave), like the `localnet-e2e` skill.
- **Blocks:**
  - block 1 — no chain (131 checks: automated 111, mock 10, manual 9, pending 1);
  - block 2 — a local validator (28: automated 20, mock 2, manual 1, pending 5);
  - 159 in total (automated 131, mock 12, manual 10, pending 6).
  
  Sections: landing, pitch, whitepaper, lobby, free, promo, referral, admin.
- **Harness:**
  - `e2e/harness/{api,dom,fixtures}.mjs`, sessions `e2e/harness/sessions/*.mjs`;
  - id catalog `e2e/catalog.mjs` (`B1-*`, `B2-*`, `M-*`);
  - `e2e/scripts/{run.sh, chain-init.sh, validator.sh, render-plan.mjs}`.
  
  The mock wallet is a `tweetnacl` key (`B1-LAND-11`: nonce + verify).
- **Scripts:**
  - root: `test:e2e:block1` = `bash e2e/scripts/run.sh 1`, `test:e2e:block2` = `… 2`, `test:e2e:pages`;
  - `e2e/package.json`: `test:pages`, `test:block1`, `test:block2`;
  - dependencies: `bs58`, `happy-dom`, `tweetnacl`.
- **Free paths and an issued ticket (PR #3 is already on main):**
  1. `free-g` — the tool sim `?sim=1` only (there is no product link `?offline=1`); a bare `play.html` orders EASY;
  2. online training `free-1c` / `free-2c` / `free-3c` (HARD ×10; `free-3b` is frozen), with no debit of `freeRides`;
  3. `POST /api/auth/guest` — EASY only (`guest_easy_only`);
  4. a weekly issued 1h ticket (a 1h promo is claimed earlier and the grant is not spent; with no promo the first `POST` spends the grant; a repeated `POST`, while the ride is `created`, returns it; `weekly_ticket_spent` — the claim race);
  5. the `free_on_signup` counter / the daily grant is still stored, training does not spend it.
  
  Promo `kind: 'ride'`, `GET /api/prize/board`, and the TEN4 ticker are on main too. The `auth/pair` and `referrals` routes from main are kept. Programs: `programs/freightchain_pools` and `programs/freightchain_honk`.
- **Bugs found (not fixed):**
  1. training does not debit `freeRides`; the signup counter is still stored;
  2. `paintHero` fails without `split` / `totals`;
  3. a cosmetic promo code is rejected with `visuals_are_honk`;
  4. `GET /api/honk` → `chain: null` without `HONK_PROGRAM_ID`;
  5. the promo-code specification was updated and moved to [`docs/spec/promocodes.md`](promocodes.md);
  6. there is no admin HTTP for `set_pool_rules`;
  7. referral scenarios do not check issuance;
  8. `e2e-tickets-stub` RETRY CONFIRM and `/reconcile` fail.
- **Gaps in PR #5:** the Chrome scripts (`server/scripts/e2e-*.mjs`, `client/tools/e2e-chrome.mjs`, `e2e-viewer.mjs`, `landing/tools/e2e-wallet.mjs`) are not called. `close_ticket` and the seed-treasury rollover — manual.
- **Reuses:**
  - scenarios in `server/test/http/flows.spec.ts` (`flow`, `http-contract`, `telemetry`, `live`, `verdict`, `traffic-proof`, `pools`, `pledges`, `shared-road`, `ticket-orders`, `chain`, `webhook`, `referrals`, and others);
  - 48 Postgres integration specs;
  - `program:test` (LiteSVM).

### 1.2 Rules
- **E2E-M-01** WITHDRAWN by decision 68 (2026-10-18). Was: e2e is code and Docker, with no browser. The happy-dom suite may still run. It does not define coverage. Browser coverage is real headless Chrome ([`../testing/COVERAGE_CONTRACT.md`](../testing/COVERAGE_CONTRACT.md)).
- **E2E-M-02** MUST: every MUST rule from `docs/spec/*.md` that has a UI or a cross-service path has an id in `e2e/catalog.mjs`. The catalog generates the checklist (`render-plan.mjs`) from the specification, and they do not diverge.
- **E2E-M-03** MUST: the blockchain in block 1 is a **mock** (`mock-rpc`, compose profile `mockchain`, [`replays_streams.md`](replays_streams.md) §2.4). In block 2 — a real local validator. The server in both blocks uses the real `SolanaChainAdapter` with no code changes.
- **E2E-M-04** MUST: wallets in the tests are deterministic keys (fixed seeds), and signatures are deterministic. Golden files store the signatures.
- **E2E-M-05** MUST: the catalog's `API-*` section is generated from the route registry (backend decision 6, [`backend_contract.md`](backend_contract.md)).
- **E2E-M-06** WITHDRAWN by decision 68 (2026-10-18). Was: rewrite or delete `e2e-watch.mjs`, `e2e-live-board.mjs`, `e2e-live-flags.mjs`, `replay-test`, and `live-board-test`. Those scripts lock shipped live watch. They stay until a decision-18 change updates `PRODUCT.md` and the tests together.
- **E2E-M-07** MUST: anti-cheat tests and long rides (1h) — at night, with a fake clock and time acceleration (decisions 4, 17).

### 1.3 New catalog sections (plan)
| Section | Block | Files | Tests |
|---|---|---|---|
| `B1-WATCH-*` | 1 | `e2e/block1-offchain/watch/{visibility,player}.test.mjs` | RPL-T-01…60 |
| `B1-LOBBY-TRAIN-*` | 1 | `e2e/block1-offchain/lobby/training-label.test.mjs` (each test in two locales: EN and RU) | RPL-T-16…21 |
| `B1-LOBBY-I18N-*` | 1 | `e2e/block1-offchain/lobby/i18n.test.mjs` | RPL-T-26…29 |
| `B1-STREAM-*` | 1 + `mockchain` | `e2e/block1-offchain/streams/{donation,chat,moderation}.test.mjs`, `e2e/mockchain/rpc.mjs`, `e2e/harness/wallet.mjs` | RPL-T-70…98 |
| `B1-LEGAL-*` | 1 | `e2e/block1-offchain/legal/copy.test.mjs` | LEG-T-10 |
| `B1-RIDE-*` | 1 | `e2e/block1-offchain/rides/finish.test.mjs` | RID-T-01, -10 |
| `B2-STREAM-*` | 2 | `e2e/block2-chain/streams/donation.test.mjs` | RPL-T-99 |
| `B2-POOL-*` | 2 | `e2e/block2-chain/pool/schedule.test.mjs` | POOL-T-03, -12, -14 |
| `M-RPL-*` | manual | [`docs/testing/MANUAL_TESTS.md`](../testing/MANUAL_TESTS.md) | M-RPL-01…06 |

**Change existing:** `B1-LOBBY-03` (LIVE without WATCH), `B1-LOBBY-04/09` (REPLAYS without training), `B1-LOBBY-21`, `B1-LAND-26` (`dash-live.js`).

### 1.4 npm scripts (plan)
| Where | Script | Command |
|---|---|---|
| root | `test:e2e:replays` | `bash e2e/scripts/run.sh replays` |
| root | `test:e2e:streams` | `bash e2e/scripts/run.sh streams` (compose `--profile mockchain`) |
| root | `e2e:mockchain:up` | `docker compose -f docker-compose.e2e.yml --profile mockchain up -d` |
| `e2e/package.json` | `test:replays` | `node --test … $(find block1-offchain/watch block1-offchain/lobby -name '*.test.mjs')` |
| `e2e/package.json` | `test:streams` | `node --test … $(find block1-offchain/streams -name '*.test.mjs')` |
| `e2e/package.json` | `mockchain` | `node mockchain/rpc.mjs` |
| `server` | (exists) `test`, `test:integration` | vitest filters `live`, `watch`, `donation` |

## Part 2. Test plan
| id | Rule | Test |
|---|---|---|
| E2E-T-01 | M-01 | WITHDRAWN with M-01. Do not assert that `run.sh` refuses Chrome. |
| E2E-T-02 | M-02 | `catalog.test.mjs`: every id from `docs/spec/*` with a UI mark is in the catalog, and vice versa |
| E2E-T-03 | M-03 | smoke `mock-rpc`: `getHealth`, `getLatestBlockhash`, a transfer → `getParsedTransaction` is parsed by `SolanaChainAdapter` |
| E2E-T-04 | M-04 | two runs of RPL-T-70 → the same signature |
| E2E-T-05 | M-05 | the diff of the `API-*` section against the registry is empty |
| E2E-T-06 | M-06 | WITHDRAWN with M-06. Do not grep `server/scripts` for an absence of live watch. |
| E2E-T-07 | M-07 | night job: AC-F2 (200 seeds, acceleration), AC-P9 |

### Traceability
E2E-M-02…05 and E2E-M-07 still have planned ids E2E-T-02…05 and E2E-T-07. E2E-M-01 and E2E-M-06 are withdrawn. Those ids are not written tests.
