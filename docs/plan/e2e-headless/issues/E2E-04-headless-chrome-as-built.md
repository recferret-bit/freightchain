# Epic E2E-04 — Headless Chrome As-Built Suite (12 Scripts)

> **Parent Plan:** [`docs/plan/E2E_HEADLESS_PLAN.md`](../../E2E_HEADLESS_PLAN.md) · **Status Board:** [`docs/plan/e2e-headless/STATUS.md`](../STATUS.md)
> **Track:** Track A (As-Built — [`docs/testing/COVERAGE_CONTRACT.md`](../../../testing/COVERAGE_CONTRACT.md) §2.3, [`docs/testing/IMPLEMENTATION_PLAN.md`](../../../testing/IMPLEMENTATION_PLAN.md) Phase 3)

---

## Overview

Expands the real Headless Chrome suite (`backend/server/scripts/e2e-*.mjs`, `frontend/client/tools/e2e-chrome.mjs`, and `.claude/skills/run-tests/e2e.sh`) so every HTML page and user journey in `docs/spec/PRODUCT.md` is verified in a real Chromium browser with WebGL rendering, zero `pageerror`/`console.error`, and real PostgreSQL persistence.

---

## Tasks

### `E2E-04.1` — Headless Chrome: Guest ride completion (`tier='free'`) + `409 guest_free_only` & `409 training_tier_free_only`

- **Status:** `[ ] Todo`
- **Track:** Track A (As-Built)
- **Spec / Contract Ref:** `COVERAGE_CONTRACT` §2.3, `IMPLEMENTATION_PLAN.md` §Phase 3.1
- **Target Files:**
  - `backend/server/scripts/e2e-guest-training.mjs`
  - `.claude/skills/run-tests/e2e.sh`
- **Depends On:** `E2E-01.4`

#### Definition of Ready (DoR)
- [ ] Guest cookie (`fc_guest`) flow and `tier='free'` vs `tier='1h'` ride start endpoints in `backend/server/src/application/rides/` are reviewed.

#### Definition of Done (DoD)
- [ ] `e2e-guest-training.mjs` launches Headless Chrome without wallet connection, starts a `tier='free'` ride on `play.html`, drives to finish, and verifies `status='finished'` in DB.
- [ ] Asserts that attempting `tier='1h'` as guest returns `409 guest_free_only` and starting a training route (`tutorial`/`easy`) on `1h` returns `409 training_tier_free_only`.
- [ ] Asserts `pageErrors.length === 0` and `consoleErrors.length === 0`.
- [ ] Added to `.claude/skills/run-tests/e2e.sh` and exits `0`.
- [ ] Status updated in [`docs/plan/e2e-headless/STATUS.md`](../STATUS.md).

---

### `E2E-04.2` — Headless Chrome: Weekly 1h free-ride ticket auto-grant (`source='weekly'`) + promo credit precedence

- **Status:** `[ ] Todo`
- **Track:** Track A (As-Built)
- **Spec / Contract Ref:** `COVERAGE_CONTRACT` §2.3, `IMPLEMENTATION_PLAN.md` §Phase 3.2
- **Target Files:**
  - `backend/server/scripts/e2e-weekly-ticket.mjs`
  - `.claude/skills/run-tests/e2e.sh`
- **Depends On:** `E2E-01.4`

#### Definition of Ready (DoR)
- [ ] As-built weekly ticket grant (`source='weekly'`) and credit consumption order (`promo` freeRideCredits before `weekly` ticket before `paid` ticket) in `PRODUCT.md` are reviewed.

#### Definition of Done (DoD)
- [ ] `e2e-weekly-ticket.mjs` signs in a new wallet in Headless Chrome, verifies automatic `source='weekly'` ticket grant in lobby UI and DB, redeems a promo code for `freeRideCredits=1`, starts two consecutive `1h` rides, and verifies that ride #1 consumes the promo credit and ride #2 consumes the weekly ticket.
- [ ] Zero console/page errors; wired into `e2e.sh`.
- [ ] Status updated in [`docs/plan/e2e-headless/STATUS.md`](../STATUS.md).

---

### `E2E-04.3` — Headless Chrome: `e2e-tickets.mjs` localnet reconcile (`POST /api/tickets/orders/:id/reconcile`) + foreign order `403/404`

- **Status:** `[ ] Todo`
- **Track:** Track A (As-Built)
- **Spec / Contract Ref:** `COVERAGE_CONTRACT` §2.3, `IMPLEMENTATION_PLAN.md` §Phase 3.3
- **Target Files:**
  - `backend/server/scripts/e2e-tickets.mjs`
- **Depends On:** `E2E-01.2`

#### Definition of Ready (DoR)
- [ ] Existing `backend/server/scripts/e2e-tickets.mjs` and localnet `buy_ticket` reconciliation flow are reviewed.

#### Definition of Done (DoD)
- [ ] `e2e-tickets.mjs` exercises `POST /api/tickets/orders/:id/reconcile` after an on-chain `buy_ticket` transaction when the webhook/listener is delayed, confirming ticket credit in UI and DB.
- [ ] Verifies that a second wallet calling reconcile on the first wallet's order is rejected (`403`/`404`).
- [ ] Exits `0` with zero console/page errors.
- [ ] Status updated in [`docs/plan/e2e-headless/STATUS.md`](../STATUS.md).

---

### `E2E-04.4` — Headless Chrome: `e2e-solana-pay.mjs` browser-side wallet sign & confirm after QR order

- **Status:** `[ ] Todo`
- **Track:** Track A (As-Built)
- **Spec / Contract Ref:** `COVERAGE_CONTRACT` §2.3, `IMPLEMENTATION_PLAN.md` §Phase 3.4
- **Target Files:**
  - `backend/server/scripts/e2e-solana-pay.mjs`
- **Depends On:** `E2E-01.4`

#### Definition of Ready (DoR)
- [ ] Existing `e2e-solana-pay.mjs` QR creation flow and injected wallet transaction signing helper are reviewed.

#### Definition of Done (DoD)
- [ ] `e2e-solana-pay.mjs` completes the full browser-side wallet sign + confirm loop in Headless Chrome and verifies the UI transitions from pending QR to confirmed state and DB order status transitions to `confirmed`.
- [ ] Exits `0` with zero console/page errors.
- [ ] Status updated in [`docs/plan/e2e-headless/STATUS.md`](../STATUS.md).

---

### `E2E-04.5` — Headless Chrome: `e2e-live.mjs` negative checks (self-donate `400`, self-pledge `400`, rate-limit `429`)

- **Status:** `[ ] Todo`
- **Track:** Track A (As-Built)
- **Spec / Contract Ref:** `COVERAGE_CONTRACT` §2.3, `IMPLEMENTATION_PLAN.md` §Phase 3.5
- **Target Files:**
  - `backend/server/scripts/e2e-live.mjs`
- **Depends On:** `E2E-01.4`

#### Definition of Ready (DoR)
- [ ] Existing `e2e-live.mjs` script is reviewed for where driver wallet vs spectator wallet contexts are bound.

#### Definition of Done (DoD)
- [ ] `e2e-live.mjs` asserts that the driver wallet attempting to self-donate or self-pledge receives `400`, and rapid chat/order spam triggers `429` with clean UI error handling and zero unhandled page errors.
- [ ] Exits `0`.
- [ ] Status updated in [`docs/plan/e2e-headless/STATUS.md`](../STATUS.md).

---

### `E2E-04.6` — Headless Chrome: `e2e-referral.mjs` full invitee MEDIUM ride → `qualifyOnRideVerified` → `referrerRideGift=2`

- **Status:** `[ ] Todo`
- **Track:** Track A (As-Built)
- **Spec / Contract Ref:** `COVERAGE_CONTRACT` §2.3, `IMPLEMENTATION_PLAN.md` §Phase 3.6
- **Target Files:**
  - `backend/server/scripts/e2e-referral.mjs`
- **Depends On:** `E2E-01.4`

#### Definition of Ready (DoR)
- [ ] Existing `e2e-referral.mjs` and `ReferralService.qualifyOnRideVerified` trigger conditions (`MEDIUM` or `HARD` verified ride) are reviewed.

#### Definition of Done (DoD)
- [ ] `e2e-referral.mjs` drives the invitee through a complete verified `MEDIUM` ride in Headless Chrome, triggers `qualifyOnRideVerified`, and asserts `qualifiedAt !== null` and `referrerRideGift = 2` free rides credited to the referrer in both DB and lobby UI.
- [ ] Exits `0` with zero console/page errors.
- [ ] Status updated in [`docs/plan/e2e-headless/STATUS.md`](../STATUS.md).

---

### `E2E-04.7` — Headless Chrome: `e2e-honk-garage.mjs` Prize board tab (`GET /api/pools/:id/leaderboard`) & TEN4 catalog UI

- **Status:** `[ ] Todo`
- **Track:** Track A (As-Built)
- **Spec / Contract Ref:** `COVERAGE_CONTRACT` §2.3, `IMPLEMENTATION_PLAN.md` §Phase 3.7
- **Target Files:**
  - `backend/server/scripts/e2e-honk-garage.mjs`
- **Depends On:** `E2E-01.4`

#### Definition of Ready (DoR)
- [ ] Lobby Prize board tab and Garage TEN4 catalog DOM selectors in `frontend/client/index.html` and `frontend/client/site/` are reviewed.

#### Definition of Done (DoD)
- [ ] `e2e-honk-garage.mjs` opens the Prize board tab, asserts `GET /api/pools/:id/leaderboard` renders ranked driver rows in DOM, switches to the Garage tab, and verifies all TEN4 catalog items render prices, equip states, and balances accurately.
- [ ] Exits `0` with zero console/page errors.
- [ ] Status updated in [`docs/plan/e2e-headless/STATUS.md`](../STATUS.md).

---

### `E2E-04.8` — Headless Chrome: `e2e-whitepaper.mjs` dedicated harness (`whitepaper.html` zero errors, anchors, diagrams)

- **Status:** `[ ] Todo`
- **Track:** Track A (As-Built)
- **Spec / Contract Ref:** `COVERAGE_CONTRACT` §2.3, `IMPLEMENTATION_PLAN.md` §Phase 3.8
- **Target Files:**
  - `backend/server/scripts/e2e-whitepaper.mjs`
  - `.claude/skills/run-tests/e2e.sh`
- **Depends On:** `E2E-01.4`

#### Definition of Ready (DoR)
- [ ] `frontend/landing/whitepaper.html` build/preview serving path and internal anchor links are inventoried.

#### Definition of Done (DoD)
- [ ] `e2e-whitepaper.mjs` loads `whitepaper.html` in Headless Chrome, verifies every section anchor resolves to a visible element, checks all embedded SVG/diagram assets have `naturalWidth > 0` / non-empty bounding boxes, and asserts `pageErrors.length === 0` and `consoleErrors.length === 0`.
- [ ] Added to `e2e.sh` and exits `0`.
- [ ] Status updated in [`docs/plan/e2e-headless/STATUS.md`](../STATUS.md).

---

### `E2E-04.9` — Headless Chrome: `e2e-landing.mjs` empty-pool state (`GET /api/pools/current → null`, `paintHero` regression)

- **Status:** `[ ] Todo`
- **Track:** Track A (As-Built)
- **Spec / Contract Ref:** `COVERAGE_CONTRACT` §2.3, `IMPLEMENTATION_PLAN.md` §Phase 3.9, `API-M-12`
- **Target Files:**
  - `backend/server/scripts/e2e-landing.mjs`
- **Depends On:** `SPC-01.6`

#### Definition of Ready (DoR)
- [ ] `paintHero` null-pool fix (`SPC-01.6`) in `frontend/landing/` is applied.

#### Definition of Done (DoD)
- [ ] `e2e-landing.mjs` tests both active-pool and empty-pool (`GET /api/pools/current → null`) states in Headless Chrome, asserting fallback hero copy renders cleanly with `0` `TypeError` or console errors.
- [ ] Exits `0`.
- [ ] Status updated in [`docs/plan/e2e-headless/STATUS.md`](../STATUS.md).

---

### `E2E-04.10` — Headless Chrome: `e2e-editor.mjs` `POST /api/editor/auth/logout` → cookie cleared → `401` on next write

- **Status:** `[ ] Todo`
- **Track:** Track A (As-Built)
- **Spec / Contract Ref:** `COVERAGE_CONTRACT` §2.3, `IMPLEMENTATION_PLAN.md` §Phase 3.10
- **Target Files:**
  - `backend/server/scripts/e2e-editor.mjs`
- **Depends On:** `E2E-01.4`

#### Definition of Ready (DoR)
- [ ] `e2e-editor.mjs` sign-in and entity save flow in Headless Chrome is reviewed.

#### Definition of Done (DoD)
- [ ] `e2e-editor.mjs` clicks/calls logout on `editor.html`, verifies `fc_editor` cookie is cleared, and asserts that a subsequent entity write returns `401` and prompts re-authentication in UI.
- [ ] Exits `0` with zero unhandled page errors.
- [ ] Status updated in [`docs/plan/e2e-headless/STATUS.md`](../STATUS.md).

---

### `E2E-04.11` — Headless Chrome: `e2e-achievements.mjs` multi-ride progress (`first-shift`, `100-miles`) + rejected ride skip

- **Status:** `[ ] Todo`
- **Track:** Track A (As-Built)
- **Spec / Contract Ref:** `COVERAGE_CONTRACT` §2.3, `IMPLEMENTATION_PLAN.md` §Phase 3.11, `SOL-T-09..14`
- **Target Files:**
  - `backend/server/scripts/e2e-achievements.mjs`
- **Depends On:** `E2E-01.4`

#### Definition of Ready (DoR)
- [ ] Achievement unlock rules, mint outbox delay, and rejected-ride re-check in `docs/spec/web3_solana.md` are reviewed.

#### Definition of Done (DoD)
- [ ] `e2e-achievements.mjs` verifies multi-ride cumulative progress (`first-shift`, `100-miles`), asserts that a ride later marked `verdict='rejected'` is excluded by the cNFT mint job re-check (`SOL-T-12`), and verifies badge rendering in the lobby profile UI.
- [ ] Exits `0` with zero console/page errors.
- [ ] Status updated in [`docs/plan/e2e-headless/STATUS.md`](../STATUS.md).

---

### `E2E-04.12` — Headless Chrome: `e2e-admin.mjs` wrong host `403`, missing `adminSig` `401`, re-verify & sample inspection

- **Status:** `[ ] Todo`
- **Track:** Track A (As-Built)
- **Spec / Contract Ref:** `COVERAGE_CONTRACT` §2.3, `IMPLEMENTATION_PLAN.md` §Phase 3.12, `ADM-T-01..06`
- **Target Files:**
  - `backend/server/scripts/e2e-admin.mjs`
- **Depends On:** `E2E-01.4`

#### Definition of Ready (DoR)
- [ ] `e2e-admin.mjs` and `frontend/client/admin.html` actions for ride sample inspection and re-verification are reviewed.

#### Definition of Done (DoD)
- [ ] `e2e-admin.mjs` verifies:
  1. Accessing `/api/admin/*` from main host (`freightchain.localhost`) returns `403`.
  2. Mutating admin action without Ed25519 `adminSig` returns `401`.
  3. Inspecting ride telemetry samples (`GET /api/admin/rides/:id/samples`) and triggering `POST /api/admin/rides/:id/re-verify` updates the ride verdict in `admin.html` and writes an `AdminAction` audit entry.
- [ ] Exits `0` with zero console/page errors.
- [ ] Status updated in [`docs/plan/e2e-headless/STATUS.md`](../STATUS.md).
