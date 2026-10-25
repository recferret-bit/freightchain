# Epic SPC-08 — Referral Convoy, TEN4 Airdrop, `TrustScore` & `TermsGuard`

> **Parent Plan:** [`docs/plan/SPEC_COMPLIANCE_PLAN.md`](../../SPEC_COMPLIANCE_PLAN.md) · **Status Board:** [`docs/plan/spec-compliance/STATUS.md`](../STATUS.md)
> **Spec Docs:** [`docs/spec/referral.md`](../../../spec/referral.md) (`REF-M-01..15`), [`docs/spec/ten4.md`](../../../spec/ten4.md) (`TEN-M-01..11`), [`docs/spec/promocodes.md`](../../../spec/promocodes.md) (`PRM-M-01..10`), [`docs/spec/web3_solana.md`](../../../spec/web3_solana.md) (`SOL-M-01..12`), [`docs/spec/platform_services.md`](../../../spec/platform_services.md) (`PLT-M-01..12`), [`docs/spec/legal.md`](../../../spec/legal.md) (`LEG-M-01..11`)

---

## Overview

Implements the Target Convoy Referral rework ([`docs/spec/referral.md`](../../../spec/referral.md) §2), the Pre-Season TEN4 Airdrop campaign engine ([`docs/spec/ten4.md`](../../../spec/ten4.md) §4.2 & [`docs/plan/DEVNET_PRESEASON.md`](../../DEVNET_PRESEASON.md)), the multi-signal Anti-Sybil `TrustScore` service ([`docs/spec/anticheat.md`](../../../spec/anticheat.md) Appendix D), and `TermsGuard` + gambling vocabulary compliance ([`docs/spec/legal.md`](../../../spec/legal.md)).

---

## Tasks

### `SPC-08.1` — Implement Convoy Referral state machine (`pending` 72h expiry delete → `active` 60d window on first verified MEDIUM/HARD ride → `qualified` / `expired`) & dynamic pending slot cap `min(100, 5 + 2*A)`

- **Status:** `[~] In Progress` — reopened on 24 October. Follow-up on 25 October: production DI now binds PostgreSQL; second-connection persistence, rollback, concurrent caps and HTTP activation passed. Full target UI/legacy replacement remains open. The verified Chrome referral journey still gives the legacy +2/+3 gifts. See the [local readiness audit](../../../testing/LOCAL_READINESS.md).
- **Spec Rules:** `REF-M-01`, `REF-M-02`, `REF-M-03`, `REF-M-04`, `REF-M-05`, `REF-M-06`, `REF-M-07`, `REF-M-15` (`docs/spec/referral.md` §2)
- **Paired Plan 1 Task:** `E2E-05.7`
- **Target Files:**
  - `backend/server/prisma/schema.prisma` (`status`, `activatedAt`, `expiresAt`, `m1QualifiedAt`, `m2QualifiedAt` on `player.Referral`)
  - `backend/server/prisma/migrations/<timestamp>_convoy_referral_rework/migration.sql`
  - `backend/server/src/application/referral/referral.service.ts`
  - `backend/server/src/application/referral/referral-expiry.scheduler.ts`
- **Depends On:** None

#### Definition of Ready (DoR)
- [ ] Convoy state machine in `docs/spec/referral.md` §2 is reviewed:
  - Invitee binding creates a `pending` row; if the invitee does not complete a verified `MEDIUM` or `HARD` 1h ride within `72 hours`, the `pending` row is **deleted** (freeing the referrer's pending slot and allowing the invitee to re-bind later).
  - Dynamic pending slot cap per referrer: `maxPending = min(100, 5 + 2 * activeOrQualifiedCount)`.
  - Completing a verified `MEDIUM` or `HARD` ride within 72h transitions the row to `active` with a `60-day` qualification window (`activatedAt + 60d`).

#### Definition of Done (DoD)
- [ ] Forward-only Prisma migration updates `player.Referral` for the Convoy lifecycle.
- [ ] `ReferralService` enforces `maxPending = min(100, 5 + 2 * A)`, deletes expired `pending` rows after 72h via `ClockPort`, transitions to `active` on first verified `MEDIUM`/`HARD` ride, and transitions uncompleted `active` rows past 60 days to `expired`.
- [ ] `docs/spec/PRODUCT.md` updated; status marked `[x] Done` in [`docs/plan/spec-compliance/STATUS.md`](../STATUS.md).

---

### `SPC-08.2` — Implement Convoy invitee 1h promo ride gift on activation (`3/day`, `10/week`, `500/week` global caps) + M1 (`100 TEN4` @ 2 ISO weeks) & M2 (`50 TEN4` @ 5 ISO weeks) rewards

- **Status:** `[~] In Progress` — reopened on 24 October. Follow-up on 25 October: durable invitations/ledger/ride evidence and atomic caps passed PostgreSQL tests; activation issues a usable 1h PromoRideGrant. Automatic held-reward release and the required on-chain reward journey remain open.
- **Spec Rules:** `REF-M-08`, `REF-M-09`, `REF-M-10`, `REF-M-11`, `REF-M-12`, `REF-M-15` (`docs/spec/referral.md` §2.3–2.5)
- **Paired Plan 1 Task:** `E2E-05.7`
- **Target Files:**
  - `backend/server/src/application/referral/referral.service.ts`
  - `backend/server/src/application/honk/honk-reward.service.ts`
- **Depends On:** `SPC-08.1`

#### Definition of Ready (DoR)
- [ ] Reward and cap rules in `docs/spec/referral.md` §2.3–2.5 are reviewed:
  - On `pending → active`, invitee receives `1` 1h promo ride credit (`freeRideCredits += 1`), capped at `<= 3/day` and `<= 10/ISO week` per referrer and `<= 500/ISO week` globally (referrer receives `0` free ride gifts; `referrerRideGift = 0`).
  - **Milestone M1 (`100 TEN4` to referrer):** invitee completes ≥1 verified `MEDIUM`/`HARD` 1h ride in `2` distinct ISO weeks within 60 days of activation, and referrer himself has ≥1 verified `MEDIUM`/`HARD` ride.
  - **Milestone M2 (`+50 TEN4` to referrer):** invitee completes ≥1 verified `MEDIUM`/`HARD` 1h ride in `5` distinct ISO weeks within 60 days of activation (`qualified`).

#### Definition of Done (DoD)
- [ ] Activation promo credit caps (`3/d`, `10/wk`, `500/wk`) and M1 (`100 TEN4`) / M2 (`50 TEN4`) milestone outbox grants execute atomically under `findByWalletForUpdate`.
- [ ] `docs/spec/PRODUCT.md` updated; status marked `[x] Done` in [`docs/plan/spec-compliance/STATUS.md`](../STATUS.md).

---

### `SPC-08.3` — Implement 25-row Convoy leaderboard (`GET /api/referrals/leaderboard`) & `convoyHidden` privacy toggle (`PATCH /api/me/privacy`)

- **Status:** `[~] In Progress` — reopened on 24 October. API routes now use durable PostgreSQL Convoy data, with privacy and usable-promo HTTP checks. The required lobby slot meter, milestone progress and leaderboard journey need completion and browser evidence. Applying the schema migration alone does not finish this task.
- **Spec Rules:** `REF-M-13`, `REF-M-14`, `REF-M-15` (`docs/spec/referral.md` §2.6–2.7)
- **Paired Plan 1 Task:** `E2E-05.7`
- **Target Files:**
  - `backend/server/prisma/schema.prisma` (`convoyHidden` on `player.Player`)
  - `backend/server/src/presentation/referral/referral.controller.ts` (`GET /api/referrals/leaderboard`)
  - `backend/server/src/presentation/player/me.controller.ts` (`PATCH /api/me/privacy`)
  - `frontend/client/index.html`, `frontend/client/site/` (Convoy tab & leaderboard UI)
- **Depends On:** `SPC-08.2`

#### Definition of Ready (DoR)
- [ ] Convoy leaderboard ranking (top 25 referrers by `qualified` count, then `active` count) and `convoyHidden` anonymization rule (masks wallet/SNS name as `'Anonymous Dispatcher'` on public Convoy leaderboard and referrer badge) in `docs/spec/referral.md` §2.6–2.7 are reviewed.

#### Definition of Done (DoD)
- [ ] `GET /api/referrals/leaderboard` returns top 25 Convoy leaders with `@ZodResponse` validation and respects `convoyHidden`.
- [ ] `PATCH /api/me/privacy` toggles `convoyHidden` under `findByWalletForUpdate`.
- [ ] Lobby Convoy tab renders slot meter (`used / maxPending`), M1/M2 progress bars, and the 25-row leaderboard.
- [ ] `docs/spec/PRODUCT.md` updated; status marked `[x] Done` in [`docs/plan/spec-compliance/STATUS.md`](../STATUS.md).

---

### `SPC-08.4` — Implement Pre-Season TEN4 Airdrop campaign engine (MEDIUM/HARD ride gate, Telegram check, X verification via `twitterapi.io`, Turnstile, unique social ID binding)

- **Status:** `[~] In Progress` — reopened on 24 October. Durable social uniqueness and real provider adapters now pass unit and HTTP checks: Telegram signed ownership/membership, wallet-bound X proof and site/action-bound Turnstile. Live provider setup/acceptance, campaign UI/attempt wiring and chain settlement remain open. Claim settlement is currently `ledger`.
- **Spec Rules:** `TEN-M-01..11` (`docs/spec/ten4.md` §4.2, [`docs/plan/DEVNET_PRESEASON.md`](../../DEVNET_PRESEASON.md))
- **Paired Plan 1 Task:** `E2E-05.8`
- **Target Files:**
  - `backend/server/prisma/schema.prisma` (`player.AirdropClaim`, social binding unique constraints)
  - `backend/server/prisma/migrations/<timestamp>_preseason_airdrop/migration.sql`
  - `backend/server/src/application/airdrop/airdrop.service.ts`
  - `backend/server/src/infrastructure/social/twitterapi-io.adapter.ts`
  - `backend/server/src/infrastructure/social/telegram-bot.adapter.ts`
  - `backend/server/src/infrastructure/config/env.schema.ts` (`TWITTERAPI_IO_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHANNEL_ID`, `TURNSTILE_SECRET_KEY`)
  - `backend/server/.env.example`, `infra/deploy/.env.example`, `infra/deploy/docker-compose.prod.yml`
- **Depends On:** `SPC-08.1`

#### Definition of Ready (DoR)
- [ ] Pre-Season Airdrop rules in `docs/spec/ten4.md` §4.2 and `docs/plan/DEVNET_PRESEASON.md` (mandatory verified `MEDIUM` or `HARD` ride before social tasks unlock; Telegram membership via Bot API `getChatMember`; X account age `>= 90 days`, followers `>= 10`, and quote/tweet verification via `twitterapi.io`; Cloudflare Turnstile check; 1:1 immutable `(telegramUserId, xUserId) ↔ wallet` binding) are reviewed.

#### Definition of Done (DoD)
- [ ] Airdrop endpoints (`GET /api/airdrop/status`, `POST /api/airdrop/verify-telegram`, `POST /api/airdrop/verify-x`, `POST /api/airdrop/claim`) and adapters are implemented behind clean ports (with deterministic mock adapters for tests).
- [ ] Attempting to reuse a `telegramUserId` or `xUserId` across a second wallet returns `409 social_account_already_bound`.
- [ ] `docs/spec/PRODUCT.md` updated; status marked `[x] Done` in [`docs/plan/spec-compliance/STATUS.md`](../STATUS.md).

---

### `SPC-08.5` — Implement Anti-Sybil `TrustScore` service (ASN, device fingerprint, funding cluster, humanness score, `<50` payout block, 48h reward hold queue)

- **Status:** `[~] In Progress` — reopened on 24 October. `trustScore` starts at 60 and the 48-hour ledger hold checks both wallets remain at least 50 with no rejected rides. Appendix D's accepted score updates, ASN/funding signals and on-chain release evidence are missing. Browser fingerprinting remains rejected; reopening does not authorize adding it.
- **Spec Rules:** `docs/spec/anticheat.md` Appendix D, `REF-M-15`, `docs/plan/MASTER_PLAN.md` §8
- **Paired Plan 1 Tasks:** `E2E-05.7`, `E2E-05.8`, `E2E-07.8`
- **Target Files:**
  - `backend/server/prisma/schema.prisma` (`trustScore`, `trustSignals` on `player.Player`; `holdUntil` on reward outbox)
  - `backend/server/src/domain/anticheat/trust-score.ts`
  - `backend/server/src/application/anticheat/trust-score.service.ts`
- **Depends On:** `SPC-06.5`

#### Definition of Ready (DoR)
- [ ] `TrustScore` (`0..100`, initialized at `60`) signal weights in `docs/spec/anticheat.md` Appendix D (datacenter ASN penalty, shared browser/WebGL device hash cluster penalty, common SOL funding parent wallet cluster penalty, mechanical `humannessScore` bonus/penalty, verified ride history bonus) and the `< 50` block + `48h` hold window on Convoy M1/M2 and Airdrop TEN4 payouts are reviewed.

#### Definition of Done (DoD)
- [ ] `TrustScoreService` updates `player.trustScore` on login, ride verification, and social binding.
- [ ] Convoy M1/M2 and Airdrop TEN4 grants enter a `48-hour` hold (`holdUntil = clock.now() + 48h`) and are only minted on-chain if both referrer and invitee maintain `trustScore >= 50` and zero rejected rides at release time.
- [ ] `docs/spec/PRODUCT.md` updated; status marked `[x] Done` in [`docs/plan/spec-compliance/STATUS.md`](../STATUS.md).

---

### `SPC-08.6` — Implement `TermsGuard` (`CURRENT_TERMS_VERSION` re-consent enforcement on all write routes) & scrub banned gambling terms across `frontend/`

- **Status:** `[x] Done` — TermsGuard: a player write whose terms or privacy version is missing or older is `403 terms_acceptance_required`. UI copy has no `bet`, `wager`, `gamble`, `jackpot`, `casino`, `lottery`, or `raffle`. The only hit is `frontend/landing/test/pools.test.js`, which forbids those words. No separate scrub pass.
- **Spec Rules:** `LEG-M-01..11` (`docs/spec/legal.md`)
- **Paired Plan 1 Task:** `E2E-06.3`
- **Target Files:**
  - `backend/server/src/presentation/common/guards/terms.guard.ts`
  - `frontend/client/`, `frontend/landing/` (copy scrub for banned gambling vocabulary)
- **Depends On:** `SPC-01.5`

#### Definition of Ready (DoR)
- [ ] `LEG-M-01..11` in `docs/spec/legal.md` (`TermsGuard` enforcing `player.termsVersion === CURRENT_TERMS_VERSION` and `player.privacyVersion === CURRENT_PRIVACY_VERSION` on all authenticated state-mutating routes, returning `403 terms_acceptance_required` when outdated; skill-based competition framing with zero occurrences of `bet`, `wager`, `gamble`, `jackpot`, `casino`, `lottery`, `raffle` in UI copy) are reviewed.

#### Definition of Done (DoD)
- [ ] `TermsGuard` blocks authenticated player write endpoints with `403 terms_acceptance_required` whenever `termsVersion` or `privacyVersion` is missing or older than `CURRENT_TERMS_VERSION` / `CURRENT_PRIVACY_VERSION`.
- [ ] Static copy check across `frontend/client/` and `frontend/landing/` passes with `0` banned gambling words (`LEG-T-01..11`).
- [ ] `docs/spec/PRODUCT.md` updated; status marked `[x] Done` in [`docs/plan/spec-compliance/STATUS.md`](../STATUS.md).
