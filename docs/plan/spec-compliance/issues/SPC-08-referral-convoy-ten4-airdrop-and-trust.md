# Epic SPC-08 — Referral Convoy, TEN4 Airdrop, `TrustScore` & `TermsGuard`

> **Parent Plan:** [`docs/plan/SPEC_COMPLIANCE_PLAN.md`](../../SPEC_COMPLIANCE_PLAN.md) · **Status Board:** [`docs/plan/spec-compliance/STATUS.md`](../STATUS.md)
> **Spec Docs:** [`docs/spec/referral.md`](../../../spec/referral.md) (`REF-M-01..15`), [`docs/spec/ten4.md`](../../../spec/ten4.md) (`TEN-M-01..11`), [`docs/spec/promocodes.md`](../../../spec/promocodes.md) (`PRM-M-01..10`), [`docs/spec/web3_solana.md`](../../../spec/web3_solana.md) (`SOL-M-01..12`), [`docs/spec/platform_services.md`](../../../spec/platform_services.md) (`PLT-M-01..12`), [`docs/spec/legal.md`](../../../spec/legal.md) (`LEG-M-01..11`)

---

## Overview

Implements the Target Convoy Referral rework ([`docs/spec/referral.md`](../../../spec/referral.md) §2), the Pre-Season TEN4 Airdrop campaign engine ([`docs/spec/ten4.md`](../../../spec/ten4.md) §4.2 & [`docs/plan/DEVNET_PRESEASON.md`](../../DEVNET_PRESEASON.md)), the multi-signal Anti-Sybil `TrustScore` service ([`docs/spec/anticheat.md`](../../../spec/anticheat.md) Appendix D), and `TermsGuard` + gambling vocabulary compliance ([`docs/spec/legal.md`](../../../spec/legal.md)).

---

## Tasks

**25 October rule correction:** the older DoR bullets below misstate the authoritative `docs/spec/referral.md` §2.3–2.4. MEDIUM/HARD training activates an invite; milestone weeks require verified ranked paid-tier rides, excluding promos and gating weekly grants at trust 100 plus the runtime setting. M1/M2 require campaign tasks, not a training ride by the referrer. `A` means friends with counted activity in the last 30 days. Hidden referrers are omitted, and board ties use milestones then earliest achievement. These rules, the public Convoy replacement, Profile UI, saved operator policies and local-chain settlement/recovery are implemented and locally accepted. The statuses below separate local task completion from live provider checks and the still-pending final merged gate.

### `SPC-08.1` — Implement Convoy Referral state machine (`pending` 72h expiry delete → `active` 60d window on first verified MEDIUM/HARD ride → `qualified` / `expired`) & dynamic pending slot cap `min(100, 5 + 2*A)`

- **Status:** `[x] Done` — local implementation accepted on 26 October. PostgreSQL lifecycle, expiry/rebind behavior, activity-based capacity, rollback and concurrent caps pass. Public bind/Profile now use Convoy; new legacy +2/+3 gifts are retired while historical ownership, balances, unlocks and badge progress are preserved. Chrome covers activation, pending state and privacy. Final merged/devnet acceptance remains separate.
- **Spec Rules:** `REF-M-01`, `REF-M-02`, `REF-M-03`, `REF-M-04`, `REF-M-05`, `REF-M-06`, `REF-M-07`, `REF-M-15` (`docs/spec/referral.md` §2)
- **Paired Plan 1 Task:** `E2E-05.7`
- **Target Files:**
  - `backend/server/prisma/player/convoy.prisma` (`ConvoyInvite`, `ConvoyRide`, `ConvoyLedger`, saved activation policy)
  - `backend/server/prisma/migrations/<timestamp>_convoy_referral_rework/migration.sql`
  - `backend/server/src/application/referral/convoy.service.ts`
  - `backend/server/src/application/referral/referral-expiry.scheduler.ts`
- **Depends On:** None

#### Definition of Ready (DoR)
- [x] Convoy state machine in `docs/spec/referral.md` §2 is reviewed:
  - Invitee binding creates a `pending` row; if the invitee does not complete a verified `MEDIUM` or `HARD` training ride within `72 hours`, the `pending` row is **deleted** (freeing the referrer's pending slot and allowing the invitee to re-bind later).
  - Dynamic pending slot cap per referrer: `maxPending = min(100, 5 + 2 * recentlyActiveFriends)`.
  - Completing a verified `MEDIUM` or `HARD` ride within 72h transitions the row to `active` with a `60-day` qualification window (`activatedAt + 60d`).

#### Definition of Done (DoD)
- [x] Forward-only Prisma migrations persist the Convoy lifecycle and saved promises in dedicated Convoy tables; historical `player.Referral` records remain intact.
- [x] `ConvoyService` enforces `maxPending = min(100, 5 + 2 * A)`, deletes expired `pending` rows after 72h via `ClockPort`, transitions to `active` on first verified `MEDIUM`/`HARD` ride, and transitions uncompleted `active` rows past 60 days to `expired`.
- [x] `docs/spec/PRODUCT.md` updated; status marked `[x] Done` in [`docs/plan/spec-compliance/STATUS.md`](../STATUS.md).

---

### `SPC-08.2` — Implement Convoy invitee 1h promo ride gift on activation (`3/day`, `10/week`, `500/week` global caps) + M1 (`100 TEN4` @ 2 ISO weeks) & M2 (`50 TEN4` @ 5 ISO weeks) rewards

- **Status:** `[x] Done` — local implementation accepted on 26 October. Activation issues one usable 1h PromoRideGrant under atomic caps. M1/M2 task/week gates, saved runtime promises, 48h hold/rechecks, confirmed local-chain payment, lost-response recovery and competing workers pass. Chrome renders held/capped/paid states; long-duration milestone rows are explicit fixtures, not elapsed weeks of manual play.
- **Spec Rules:** `REF-M-08`, `REF-M-09`, `REF-M-10`, `REF-M-11`, `REF-M-12`, `REF-M-15` (`docs/spec/referral.md` §2.3–2.5)
- **Paired Plan 1 Task:** `E2E-05.7`
- **Target Files:**
  - `backend/server/src/application/referral/convoy.service.ts`
  - `backend/server/src/application/referral/release-convoy.handler.ts`
- **Depends On:** `SPC-08.1`

#### Definition of Ready (DoR)
- [x] Reward and cap rules in `docs/spec/referral.md` §2.3–2.5 are reviewed:
  - On `pending → active`, invitee receives one usable 1h `PromoRideGrant` (unranked by default; no legacy free-ride balance increment), capped at `<= 3/day` and `<= 10/ISO week` per referrer and `<= 500/ISO week` globally (referrer receives `0` free ride gifts; `referrerRideGift = 0`).
  - **Milestone M1 (`100 TEN4` to referrer):** invitee completes a verified ranked paid-tier ride in each of 2 distinct ISO weeks within the qualification window, with required campaign tasks complete. Promos are excluded; weekly grants count only with the runtime opt-in and invitee trust 100. The referrer needs trust ≥50; the accepted rules do not require a training ride by the referrer.
  - **Milestone M2 (`+50 TEN4` to referrer):** the same eligible ride/task rules reach 5 distinct ISO weeks within the qualification window (`qualified`). Reward amounts/weeks and deadlines use saved operator policies; 100/50 TEN4 and 2/5 weeks are defaults.

#### Definition of Done (DoD)
- [x] Activation promo credit caps (`3/d`, `10/wk`, `500/wk`) and M1 (`100 TEN4`) / M2 (`50 TEN4`) milestone outbox grants execute atomically under `findByWalletForUpdate`.
- [x] `docs/spec/PRODUCT.md` updated; status marked `[x] Done` in [`docs/plan/spec-compliance/STATUS.md`](../STATUS.md).

---

### `SPC-08.3` — Implement 25-row Convoy leaderboard (`GET /api/referrals/leaderboard`) & `convoyHidden` privacy toggle (`PATCH /api/me/privacy`)

- **Status:** `[x] Done` — local API/PostgreSQL and Chrome acceptance covers capacity, milestone progress, the 25-row leaderboard and the privacy toggle. Hidden referrers are omitted from the public board. Profile/public-flow replacement is complete; migration alone was not the completion evidence.
- **Spec Rules:** `REF-M-13`, `REF-M-14`, `REF-M-15` (`docs/spec/referral.md` §2.6–2.7)
- **Paired Plan 1 Task:** `E2E-05.7`
- **Target Files:**
  - `backend/server/prisma/schema.prisma` (`convoyHidden` on `player.Player`)
  - `backend/server/src/presentation/referral/referral.controller.ts` (`GET /api/referrals/leaderboard`)
  - `backend/server/src/presentation/player/me.controller.ts` (`PATCH /api/me/privacy`)
  - `frontend/client/index.html`, `frontend/client/site/` (Convoy tab & leaderboard UI)
- **Depends On:** `SPC-08.2`

#### Definition of Ready (DoR)
- [x] Convoy leaderboard ranking (top 25, ordered by qualified count, milestone count and earliest achievement) and `convoyHidden` privacy rule (hidden referrers are omitted from the public leaderboard) in `docs/spec/referral.md` §2.6–2.7 are reviewed.

#### Definition of Done (DoD)
- [x] `GET /api/referrals/leaderboard` returns top 25 Convoy leaders with `@ZodResponse` validation and respects `convoyHidden`.
- [x] `PATCH /api/me/privacy` toggles `convoyHidden` under `findByWalletForUpdate`.
- [x] Profile Convoy section renders capacity (`used / maxPending`), M1/M2 progress and settlement states, and the 25-row leaderboard.
- [x] `docs/spec/PRODUCT.md` updated; status marked `[x] Done` in [`docs/plan/spec-compliance/STATUS.md`](../STATUS.md).

---

### `SPC-08.4` — Implement Pre-Season TEN4 Airdrop campaign engine (MEDIUM/HARD ride gate, Telegram check, X verification via `twitterapi.io`, Turnstile, unique social ID binding)

- **Status:** `[~] In Progress` — local campaign UI and event-attempt integration are complete: EN/RU tasks, Telegram channel/group ownership and authenticated activity, X proof/cache/budget reservations, Turnstile, current agreements, explicit consent and exactly one event 1h grant. HTTP/PostgreSQL concurrency and real-Chrome fixture checks pass. Remaining: owner provider/widget/webhook acceptance, event configuration and economic point weights before a future allocation. The event attempt is not a TEN4 payout; the separate legacy claim remains ledger-only and future TGE snapshot/distribution wiring is not current-event issuance.
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
- [x] Airdrop endpoints (`GET /api/airdrop/status`, `POST /api/airdrop/verify-telegram`, `POST /api/airdrop/verify-x`, `POST /api/airdrop/claim`, plus `/telegram/webhook` and `/preseason/claim-attempt`) and adapters are implemented behind clean ports (with deterministic mock adapters for tests).
- [x] Attempting to reuse a `telegramUserId` or `xUserId` across a second wallet returns `409 social_account_already_bound`.
- [x] `docs/spec/PRODUCT.md` records the implemented behavior.
- [ ] Close the remaining live-acceptance/policy items before marking the entire task done.

---

### `SPC-08.5` — Implement Anti-Sybil `TrustScore` and review evidence (subnet privacy, SGT, optional ASN/funding evidence, `<50` payout block, 48h reward hold queue)

- **Status:** `[~] In Progress` — local persisted finish/social limits, paid-ticket trust 100, one-time canonical SGT ownership shortcut, Convoy 48h hold/release and retry safety pass. Wallet/guest sign-ins retain subnet HMACs with at most 90-day retention. Optional ASN/funding adapters default off and expose sanitized facts, mobile/exchange exclusions and unavailable/incomplete states; they do not change scores. Live provider/physical Seeker checks and automatic cluster/second-signal policy remain open. Discord is optional and disabled. Browser fingerprinting is rejected; repeated login never awards trust.
- **Spec Rules:** `docs/spec/anticheat.md` Appendix D, `REF-M-15`, `docs/plan/MASTER_PLAN.md` §8
- **Paired Plan 1 Tasks:** `E2E-05.7`, `E2E-05.8`, `E2E-07.8`
- **Target Files:**
  - `backend/server/prisma/schema.prisma` (`trustScore`, `trustSignals` on `player.Player`; `holdUntil` on reward outbox)
  - `backend/server/src/domain/anticheat/trust-score.ts`
  - `backend/server/src/application/anticheat/trust-score.service.ts`
- **Depends On:** `SPC-06.5`

#### Definition of Ready (DoR)
- [x] Accepted local trust rules are reviewed: score 0..100 initially 60; persisted verified-finish/social awards and paid/SGT shortcuts; Convoy release checks and 48h hold. No login points or browser fingerprint.
- [ ] Specify automatic cluster thresholds and independent corroboration policy before implementing any ASN/funding penalty. Current provider evidence remains review-only; future airdrop snapshot/allocation is separate.

#### Definition of Done (DoD)
- [x] Trust changes occur on eligible verified ride days, first social binding, confirmed paid acquisition and one-time SGT proof; authentication alone cannot raise or overwrite trust.
- [x] Convoy M1/M2 release respects the 48h hold, saved trust requirements, rejected-ride checks and confirmed on-chain recovery. The separate ledger-only campaign claim has hold checks; it is not proof of future TGE payout wiring.
- [ ] Complete authorized live-provider/physical-device acceptance and resolve the future automatic policy/allocation decisions before closing the broad trust epic.
- [x] `docs/spec/PRODUCT.md` records the implemented behavior.
- [ ] Close the remaining live-acceptance/policy items before marking the entire task done.

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

25 October settlement update: newly earned Convoy milestones now use a durable signed-submission queue and real `pay_referral` receipts after the 48h hold. PG concurrent-worker/rollback tests and local-validator payment/recovery/wallet-cap checks pass. Legacy ledger rows are excluded pending review. Convoy UI/legacy replacement is now locally complete. Current event-attempt issuance is also complete; live provider acceptance, future economic point allocation/TGE wiring and undecided automatic trust policy remain separate open work.

**Privacy boundary:** `player.SignIn` stores no raw IP or User-Agent. Ordinary request/access logs are a separate security surface allowed raw IP for 30 days by the accepted privacy policy; production log-retention verification is separate from sign-in storage acceptance.
