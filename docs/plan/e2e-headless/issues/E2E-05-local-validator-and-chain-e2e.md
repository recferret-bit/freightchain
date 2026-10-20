# Epic E2E-05 — Local Validator, Anchor Programs & Block 1/2 E2E

> **Parent Plan:** [`docs/plan/E2E_HEADLESS_PLAN.md`](../../E2E_HEADLESS_PLAN.md) · **Status Board:** [`docs/plan/e2e-headless/STATUS.md`](../STATUS.md)
> **Track:** Track A + Track B ([`docs/spec/e2e.md`](../../../spec/e2e.md) `E2E-T-02..07`, [`docs/spec/web3_solana.md`](../../../spec/web3_solana.md) `SOL-T-01..16`, [`docs/spec/ten4.md`](../../../spec/ten4.md) `TEN-T-01..15`, [`docs/spec/promocodes.md`](../../../spec/promocodes.md) `PRM-T-01..14`, [`docs/spec/referral.md`](../../../spec/referral.md) `REF-T-01..22`)

---

## Overview

Completes the on-chain local validator suites (`freightchain_pools` and `freightchain_honk`), finishes the remaining pending tests in `tests/e2e/block1-offchain` and `tests/e2e/block2-chain` (`docs/testing/E2E_PLAN.md`), and adds the target spec E2E tests for Solana/Web3, Promo Codes, Referral Convoy, and TEN4 Airdrop.

---

## Tasks

### `E2E-05.1` — Pin `freightchain_honk` IDL drift check in `anchor-idl-drift.spec.ts` (all 7 instructions)

- **Status:** `[x] Done`
- **Track:** Track A (As-Built)
- **Spec / Contract Ref:** `COVERAGE_CONTRACT` §2.4, `IMPLEMENTATION_PLAN.md` §Phase 4.1
- **Target Files:**
  - `backend/server/test/architecture/anchor-idl-drift.spec.ts`
- **Depends On:** None

#### Definition of Ready (DoR)
- [ ] `backend/programs/freightchain_honk` Rust instruction signatures (`initialize`, `mint_checkpoint`, `swap_sol_for_honk`, `buy_part`, `burn_honk`, `set_authority`, `pause`) and server IDL encoders in `backend/server/src/infrastructure/solana/` are inspected.

#### Definition of Done (DoD)
- [ ] `anchor-idl-drift.spec.ts` pins instruction discriminators, account ordering, and Borsh argument layouts for all 7 `freightchain_honk` instructions alongside the 12 `freightchain_pools` instructions.
- [ ] `npm run server:unit` runs `anchor-idl-drift.spec.ts` and exits `0`.
- [ ] Status updated in [`docs/plan/e2e-headless/STATUS.md`](../STATUS.md).

---

### `E2E-05.2` — Extend `npm run test:localnet` with full SOL pool lifecycle + `pledge_ride` / `settle_pledge` / `refund_pledge`

- **Status:** `[x] Done`
- **Track:** Track A (As-Built)
- **Spec / Contract Ref:** `POOL-T-01..10`, `SOL-T-01..08`, `IMPLEMENTATION_PLAN.md` §Phase 4.2
- **Target Files:**
  - `backend/server/scripts/test-localnet.mjs`
- **Depends On:** `E2E-05.1`

#### Definition of Ready (DoR)
- [ ] Local validator harness in `backend/server/scripts/test-localnet.mjs` and `freightchain_pools` program `.so` artifact are verified.

#### Definition of Done (DoD)
- [ ] `test-localnet.mjs` exercises the full native-SOL pool lifecycle (`create_pool` → `fund_pool` → `buy_ticket` → `seal_road` → `record_ride` → `commit_winners_root` → `claim_prize` → `refund_sponsor` → `close_pool`) and the pledge lifecycle (`pledge_ride` → `settle_pledge` on completed ride + `refund_pledge` on failed ride), asserting exact lamport balances on all PDAs and recipient accounts.
- [ ] `npm run test:localnet` exits `0`.
- [ ] Status updated in [`docs/plan/e2e-headless/STATUS.md`](../STATUS.md).

---

### `E2E-05.3` — Extend `honk-suite` with negative checks (`tier='free'` training ride & weekly grant ride mint `0` TEN4)

- **Status:** `[ ] Todo`
- **Track:** Track A + B
- **Spec / Contract Ref:** `TEN-T-01..09`, `TEN-M-02`, `IMPLEMENTATION_PLAN.md` §Phase 4.3
- **Target Files:**
  - `.claude/skills/honk-suite/run.sh`
  - `backend/server/scripts/e2e-honk-suite.mjs`
- **Depends On:** `E2E-05.1`

#### Definition of Ready (DoR)
- [ ] `TEN-M-02` rule (training `tier='free'` rides and weekly auto-grant rides never mint TEN4 checkpoints; only paid-ticket and eligible promo-code 1h rides mint TEN4) is verified in `docs/spec/ten4.md`.

#### Definition of Done (DoD)
- [ ] `honk-suite` drives a `tier='free'` ride and a `source='weekly'` 1h ride past checkpoint milestones and asserts `0` TEN4 mint outbox rows and `0` on-chain SPL tokens minted, while a paid-ticket 1h ride mints the expected checkpoint TEN4 (`TEN-T-01..09`).
- [ ] `bash .claude/skills/honk-suite/run.sh` exits `0`.
- [ ] Status updated in [`docs/plan/e2e-headless/STATUS.md`](../STATUS.md).

---

### `E2E-05.4` — Complete pending Block 1 & Block 2 tests (`B1-REF-04`, `B2-PROMO-02`, `B2-ADMIN-04`, `B2-API-06`, `B2-API-07`, `B2-HONK-02`)

- **Status:** `[ ] Todo`
- **Track:** Track A (As-Built)
- **Spec / Contract Ref:** `E2E-T-02..07`, `docs/testing/E2E_PLAN.md`
- **Target Files:**
  - `tests/e2e/block1-offchain/`
  - `tests/e2e/block2-chain/`
- **Depends On:** `E2E-05.1`

#### Definition of Ready (DoR)
- [ ] The 6 pending items in `docs/testing/E2E_PLAN.md` (`B1-REF-04` referral donation share split, `B2-PROMO-02` promo ride on-chain pool entry, `B2-ADMIN-04` admin pool crank/veto, `B2-API-06` Blink transaction build & execute on validator, `B2-API-07` Solana Pay reference reconciliation on validator, `B2-HONK-02` TEN4 burn & soulbound garage part on validator) are reviewed.

#### Definition of Done (DoD)
- [ ] All 6 test cases are implemented and passing in `npm run test:e2e:block1` and `npm run test:e2e:block2`.
- [ ] `docs/testing/E2E_PLAN.md` status table is 100% green (`67/67` passing).
- [ ] Status updated in [`docs/plan/e2e-headless/STATUS.md`](../STATUS.md).

---

### `E2E-05.5` — Implement `SOL-T-01..16` (SIWS auth, `.sol` SNS resolution, Blink CORS/actions, soulbound cNFT outbox)

- **Status:** `[ ] Todo`
- **Track:** Track A + B
- **Spec / Contract Ref:** `SOL-T-01..16`, `SOL-M-01..12`
- **Target Files:**
  - `tests/e2e/block2-chain/solana-web3.e2e.spec.ts`
- **Depends On:** `E2E-05.2`

#### Definition of Ready (DoR)
- [ ] All 16 test cases in `docs/spec/web3_solana.md` (`SOL-T-01..16`: SIWS domain/nonce/expiry binding, `.sol` Bonfida SNS lookup + fallback, `/actions.json` & `/api/actions/*` CORS `*` and `{message}` error envelope, achievement tier freeze, append-only unlock rows, delayed cNFT mint outbox skipping rejected rides) are mapped.

#### Definition of Done (DoD)
- [ ] `solana-web3.e2e.spec.ts` asserts `SOL-T-01` through `SOL-T-16` with explicit test titles containing each `[SOL-T-XX]` ID.
- [ ] Passes in `npm run test:e2e:block2`.
- [ ] Status updated in [`docs/plan/e2e-headless/STATUS.md`](../STATUS.md).

---

### `E2E-05.6` — Implement `PRM-T-01..14` (Promo code normalization, caps, expiry, batch generation, race conditions)

- **Status:** `[ ] Todo`
- **Track:** Track A + B
- **Spec / Contract Ref:** `PRM-T-01..14`, `PRM-M-01..10`
- **Target Files:**
  - `tests/e2e/block1-offchain/promocodes.e2e.spec.ts`
- **Depends On:** `E2E-03.5`

#### Definition of Ready (DoR)
- [ ] All 14 test cases in `docs/spec/promocodes.md` (`PRM-T-01..14`: case-insensitive trim normalization, `maxUses` cap under concurrent `Promise.all` redemptions, per-wallet once-per-code lock under `findByWalletForUpdate`, `expiresAt` check, deactivated code `400`, admin signed creation & batch export) are mapped.

#### Definition of Done (DoD)
- [ ] `promocodes.e2e.spec.ts` asserts `PRM-T-01` through `PRM-T-14` against real PostgreSQL with concurrency race tests (`10` parallel requests against `maxUses=1` → exactly `1` `200` and `9` `409`).
- [ ] Passes in `npm run test:e2e:block1`.
- [ ] Status updated in [`docs/plan/e2e-headless/STATUS.md`](../STATUS.md).

---

### `E2E-05.7` — Implement Target Convoy Referral E2E suite (`REF-T-01..22`: `pending→active→qualified→expired`, M1/M2 TEN4, caps)

- **Status:** `[ ] Todo`
- **Track:** Track B (Target)
- **Spec / Contract Ref:** `REF-T-01..22`, `REF-M-01..15`
- **Target Files:**
  - `tests/e2e/block1-offchain/referral-convoy.e2e.spec.ts`
- **Depends On:** `SPC-08.1`, `SPC-08.2`, `SPC-08.3`

#### Definition of Ready (DoR)
- [ ] Target Convoy Referral implementation (`SPC-08.1..3`) is completed in `backend/server/`.
- [ ] All 22 test cases in `docs/spec/referral.md` (`REF-T-01..22`: `pending` 72h expiry deletion freeing slot, `active` transition on first verified MEDIUM/HARD ride, 1h promo ride gift with `3/day`, `10/week`, `500/week` global caps, `qualified` M1=100 TEN4 at 2 ISO weeks & M2=50 TEN4 at 5 ISO weeks, 60-day window expiry, dynamic slot cap `min(100, 5 + 2*A)`, referrer `trustScore >= 50` & 48h hold, 25-row Convoy leaderboard & `convoyHidden` privacy toggle) are mapped.

#### Definition of Done (DoD)
- [ ] `referral-convoy.e2e.spec.ts` implements and passes all `REF-T-01..22` scenarios using deterministic `ClockPort` advances (`+72h`, `+2 ISO weeks`, `+5 ISO weeks`, `+60d`) and real PostgreSQL transactions.
- [ ] Passes in `npm run test:e2e:block1`.
- [ ] Status updated in [`docs/plan/e2e-headless/STATUS.md`](../STATUS.md).

---

### `E2E-05.8` — Implement Target TEN4 Airdrop & Pre-Season E2E suite (Telegram/X tasks, `twitterapi.io` mock, Turnstile, Sybil hold)

- **Status:** `[ ] Todo`
- **Track:** Track B (Target)
- **Spec / Contract Ref:** `TEN-T-10..15`, `docs/spec/ten4.md` §4.2, `docs/plan/DEVNET_PRESEASON.md`
- **Target Files:**
  - `tests/e2e/block1-offchain/ten4-airdrop.e2e.spec.ts`
- **Depends On:** `SPC-08.4`, `SPC-08.5`

#### Definition of Ready (DoR)
- [ ] Pre-season Airdrop task engine and `twitterapi.io` / Telegram verification adapters (`SPC-08.4`) plus Anti-Sybil `TrustScore` (`SPC-08.5`) are implemented.

#### Definition of Done (DoD)
- [ ] `ten4-airdrop.e2e.spec.ts` tests full airdrop qualification (verified MEDIUM/HARD ride gate + Telegram membership + X account age ≥90d & tweet verification via mocked `twitterapi.io` + Turnstile token + unique social ID binding across wallets + 48h hold when `trustScore < 50`).
- [ ] Passes in `npm run test:e2e:block1`.
- [ ] Status updated in [`docs/plan/e2e-headless/STATUS.md`](../STATUS.md).
