# Epic E2E-06 — `mock-rpc`, Replays, Streams, Controls `C1..C36` & i18n

> **Parent Plan:** [`docs/plan/E2E_HEADLESS_PLAN.md`](../../E2E_HEADLESS_PLAN.md) · **Status Board:** [`docs/plan/e2e-headless/STATUS.md`](../STATUS.md)
> **Track:** Track B (Target — [`docs/spec/replays_streams.md`](../../../spec/replays_streams.md) `RPL-T-01..102`, `M-RPL-01..06`, [`docs/spec/legal.md`](../../../spec/legal.md) `LEG-T-01..11`)

---

## Overview

Implements the full target verification suite for [`docs/spec/replays_streams.md`](../../../spec/replays_streams.md) and [`docs/spec/legal.md`](../../../spec/legal.md): the deterministic `mock-rpc` (`E1M`) Solana JSON-RPC simulator, the injected headless wallet harness (`e2e/harness/wallet.mjs`), replay visibility and `payout_at` gating (`RPL-T-01..15`), full EN/RU localization and legal copy checks (`RPL-T-16..29`, `LEG-T-01..11`), all 36 replay player controls (`C1..C36` in `RPL-T-30..60`), time-bound replay chat (`RPL-T-61..69`), tip-only SOL donations without gameplay effects (`RPL-T-70..90`), and disabled pledges (`RPL-T-91..102`).

---

## Tasks

### `E2E-06.1` — Build deterministic `e2e/mockchain/rpc.mjs` (`mock-rpc`) + `e2e/harness/wallet.mjs` (`E1M` runtime)

- **Status:** `[ ] Todo`
- **Track:** Track B (Target)
- **Spec / Contract Ref:** `RPL-T-95..99`, `docs/spec/replays_streams.md` §7
- **Target Files:**
  - `tests/e2e/mockchain/rpc.mjs`
  - `tests/e2e/harness/wallet.mjs`
  - `infra/docker-compose.e2e.yml`
- **Depends On:** None

#### Definition of Ready (DoR)
- [ ] JSON-RPC methods required by server `SolanaPayService` / `LiveDonationService` (`getLatestBlockhash`, `sendTransaction`, `getTransaction`, `getSignaturesForAddress`, `getAccountInfo`, `getBalance`) and admin control endpoints (`POST /__mock/airdrop`, `POST /__mock/fail-next`, `POST /__mock/reset`) in `docs/spec/replays_streams.md` §7 are specified.

#### Definition of Done (DoD)
- [ ] `tests/e2e/mockchain/rpc.mjs` runs as an in-process or standalone HTTP service implementing deterministic blockhashes, Ed25519 signature verification, lamport ledger transfers, memo/reference indexing for `getSignaturesForAddress`, and programmable failure modes (`RPL-T-95..99`).
- [ ] `tests/e2e/harness/wallet.mjs` injects a deterministic `window.solana` provider into Headless Chrome that signs SIWS messages and `SystemProgram.transfer` transactions against `mock-rpc`.
- [ ] Unit/self-test for `mock-rpc` + `wallet.mjs` passes in < 2s.
- [ ] Status updated in [`docs/plan/e2e-headless/STATUS.md`](../STATUS.md).

---

### `E2E-06.2` — Implement Replay Lifecycle & Visibility E2E (`RPL-T-01..15`, `M-RPL-01..06`)

- **Status:** `[ ] Todo`
- **Track:** Track B (Target)
- **Spec / Contract Ref:** `RPL-T-01..15`, `M-RPL-01..06`, `RPL-M-01..09`
- **Target Files:**
  - `tests/e2e/block1-offchain/replays-visibility.e2e.spec.ts`
- **Depends On:** `SPC-04.1`, `SPC-04.2`, `SPC-04.3`

#### Definition of Ready (DoR)
- [ ] Target replay visibility rules (`SPC-04.1..3`) are implemented: running rides return `404` on `/api/watch/:id` and `/api/watch/:id/road`; training rides (`tier='free'`, guest, tutorial/assist) are excluded from `/api/replays`, `/api/watch/:id`, `/r/:id`, and `/api/actions/ride/:id`; pool rides are hidden from public until `pool.payoutAt !== null` (except to the ride owner); `SAMPLE_INPUT_COL` is stripped from public watch responses.

#### Definition of Done (DoD)
- [ ] `replays-visibility.e2e.spec.ts` asserts `RPL-T-01` through `RPL-T-15` and `M-RPL-01..06`:
  - Running ride watch/road returns `404` (`RPL-T-01..03`).
  - Finished training ride (`tier='free'`) is absent from `/api/replays` and returns `404` on watch/receipt/blink (`RPL-T-04..07`).
  - Pool ride before `payout_at` is visible to owner (`200`) and hidden (`404` / omitted) for anonymous and other wallets (`RPL-T-08..11`).
  - Pool ride after `payout_at` becomes publicly visible (`RPL-T-12`).
  - Public watch sample arrays contain only cinematic telemetry columns and zero raw `SAMPLE_INPUT_COL` bits (`RPL-T-13..15`).
- [ ] Passes in `npm run test:e2e:block1`.
- [ ] Status updated in [`docs/plan/e2e-headless/STATUS.md`](../STATUS.md).

---

### `E2E-06.3` — Implement EN/RU Localization & Legal Copy E2E (`RPL-T-16..29`, `LEG-T-01..11`)

- **Status:** `[ ] Todo`
- **Track:** Track B (Target)
- **Spec / Contract Ref:** `RPL-T-16..29`, `LEG-T-01..11`, `RPL-M-10, 10a`, `LEG-M-01..11`
- **Target Files:**
  - `backend/server/scripts/e2e-i18n-legal.mjs`
  - `tests/e2e/block1-offchain/legal-compliance.e2e.spec.ts`
- **Depends On:** `SPC-04.9`, `SPC-08.6`

#### Definition of Ready (DoR)
- [ ] `frontend/client/site/i18n.js` EN/RU dictionary (`SPC-04.9`) and `TermsGuard` / geo fail-closed rules (`SPC-08.6`, `SPC-01.5`) are implemented.

#### Definition of Done (DoD)
- [ ] `e2e-i18n-legal.mjs` runs Headless Chrome across lobby (`index.html`), replay viewer, receipt (`r.html`), and legal modals with `?lang=ru`, `localStorage.fc_lang='ru'`, and `Accept-Language: ru-RU`, asserting `RPL-T-16..29` (switcher persistence, Cyrillic rendering, zero untranslated `[data-i18n]` keys, localized error codes).
- [ ] `legal-compliance.e2e.spec.ts` asserts `LEG-T-01..11`: static grep across `frontend/` for banned gambling vocabulary (`bet`, `wager`, `jackpot`, `casino`, `lottery`, `raffle`), `TermsGuard` `403 terms_acceptance_required` when `CURRENT_TERMS_VERSION` bumps, and fail-closed geo block when `CF-IPCountry` is missing or in the blocked list.
- [ ] Passes in `npm run test:e2e:block1` and `e2e.sh`.
- [ ] Status updated in [`docs/plan/e2e-headless/STATUS.md`](../STATUS.md).

---

### `E2E-06.4` — Implement Replay Player Controls `C1..C19` Headless Chrome E2E (`RPL-T-30..48`)

- **Status:** `[ ] Todo`
- **Track:** Track B (Target)
- **Spec / Contract Ref:** `RPL-T-30..48`, `RPL-M-13` (Controls `C1..C19`)
- **Target Files:**
  - `backend/server/scripts/e2e-replay-controls.mjs`
- **Depends On:** `SPC-04.7`

#### Definition of Ready (DoR)
- [ ] Replay player controls `C1..C19` (`SPC-04.7`) are implemented in `frontend/client/`: Play/Pause (`Space`), Speed selector (`0.5×, 1×, 2×, 4×`), Timeline scrubber + hover time preview (`C3`), `±10s` seek (`←/→`, `C6/C7`), Restart (`C8`), Camera toggle (`C`, `C15`), Fullscreen (`F`, `C16`), Event markers on timeline (`damage`, `honk`, `minigame`, `C17`), Audio volume/mute (`M`, `C18`), Share link with `?t=123` deep-link (`C19`).

#### Definition of Done (DoD)
- [ ] `e2e-replay-controls.mjs` loads a finished verified replay in Headless Chrome and exercises every control `C1..C19` via both DOM clicks and keyboard shortcuts, asserting exact playback clock advances, camera matrix changes, marker seek jumps, and `?t=` deep-link initialization (`RPL-T-30..48`).
- [ ] Zero `pageerror`/`console.error`; wired into `e2e.sh`.
- [ ] Status updated in [`docs/plan/e2e-headless/STATUS.md`](../STATUS.md).

---

### `E2E-06.5` — Implement Replay HUD, Telemetry & Removal Controls `C20..C36` E2E (`RPL-T-49..60`)

- **Status:** `[ ] Todo`
- **Track:** Track B (Target)
- **Spec / Contract Ref:** `RPL-T-49..60`, `RPL-M-13` (Controls `C20..C36`)
- **Target Files:**
  - `backend/server/scripts/e2e-replay-controls.mjs`
- **Depends On:** `SPC-04.7`

#### Definition of Ready (DoR)
- [ ] Replay HUD (`C20..C36`) and control removals (`C9, C26, C27, C32` removed per `SPC-04.7`) are implemented.

#### Definition of Done (DoD)
- [ ] `e2e-replay-controls.mjs` verifies `RPL-T-49..60`:
  - Speedometer, gear, damage bar, route progress, driver badge, and `C36` speed/damage mini-chart render and update in sync with scrub position.
  - Removed controls (`C9` live badge, `C26` effect buttons, `C27` pledge panel, `C32` raw input overlay) are completely absent from the DOM (`querySelector(...) === null`).
- [ ] Exits `0`.
- [ ] Status updated in [`docs/plan/e2e-headless/STATUS.md`](../STATUS.md).

---

### `E2E-06.6` — Implement Replay Chat & Time-Binding E2E (`RPL-T-61..69`)

- **Status:** `[ ] Todo`
- **Track:** Track B (Target)
- **Spec / Contract Ref:** `RPL-T-61..69`, `RPL-M-25..31`
- **Target Files:**
  - `tests/e2e/block1-offchain/replay-chat.e2e.spec.ts`
- **Depends On:** `SPC-04.8`

#### Definition of Ready (DoR)
- [ ] Replay chat time-binding (`replayT`), 200-char limit, link/word filter, admin/moderator hide (`P01`) & wallet ban (`P02`), and 90-day retention (`SPC-04.8`) are implemented.

#### Definition of Done (DoD)
- [ ] `replay-chat.e2e.spec.ts` verifies `RPL-T-61..69`:
  - Posting a chat message binds `replayT` (`0 <= replayT <= durationSec`) and returns messages sorted by `replayT` (`RPL-T-61..62`).
  - Messages > 200 chars, URLs (`http://`, `https://`, `.com`, `t.me/`), or banned words are rejected with `400` (`RPL-T-63..65`).
  - Rate limit > 5 msg / 60s returns `429` (`RPL-T-66`).
  - Moderator calling `POST /api/admin/chat/:id/hide` (`P01`) hides the message immediately; `POST /api/admin/wallets/:wallet/chat-ban` (`P02`) blocks new posts with `403 chat_banned` (`RPL-T-67..68`).
  - 90-day retention job purges chat rows older than 90 days while keeping tip messages (`RPL-T-69`).
- [ ] Passes in `npm run test:e2e:block1`.
- [ ] Status updated in [`docs/plan/e2e-headless/STATUS.md`](../STATUS.md).

---

### `E2E-06.7` — Implement Replay Tip-Only Donations & `GET /api/me/donations` E2E via `mock-rpc` (`RPL-T-70..90`)

- **Status:** `[ ] Todo`
- **Track:** Track B (Target)
- **Spec / Contract Ref:** `RPL-T-70..90`, `RPL-M-14..23, 34`
- **Target Files:**
  - `tests/e2e/block1-offchain/replay-donations.e2e.spec.ts`
  - `backend/server/scripts/e2e-replay-donations.mjs`
- **Depends On:** `E2E-06.1`, `SPC-04.4`, `SPC-04.5`, `SPC-04.6`

#### Definition of Ready (DoR)
- [ ] `mock-rpc` (`E2E-06.1`) and tip-only replay donations (`SPC-04.4..6`) are implemented.

#### Definition of Done (DoD)
- [ ] `replay-donations.e2e.spec.ts` and `e2e-replay-donations.mjs` verify `RPL-T-70..90`:
  - Presets `0.01`, `0.05`, `0.1` SOL and custom amounts within `[0.001, 1.0]` SOL succeed; `< 0.001` or `> 1.0` SOL return `400` (`RPL-T-70..73`).
  - All gameplay effect kinds (`night`, `day`, `potholes`, `trench`, `sinkhole`), `POST /api/live/rides/:id/effects/:eventId/applied`, `POST /api/honk/time`, and `POST /api/honk/weather` are rejected (`400`/`404`/`410`, `RPL-T-74..77`).
  - Fee split is exact `9500 bps` driver / `500 bps` treasury with `0 bps` referral share and no `also` transfer leg (`RPL-T-78..80`).
  - Self-tip returns `400`, > 3 open orders returns `429`, order expires after 15 minutes via `ClockPort` (`RPL-T-81..85`).
  - Confirming transaction on `mock-rpc` highlights the tip message in chat and returns it in `GET /api/me/donations` (`sent` and `received` lists, `RPL-T-86..90`).
- [ ] Passes in `npm run test:e2e:block1` and `e2e.sh`.
- [ ] Status updated in [`docs/plan/e2e-headless/STATUS.md`](../STATUS.md).

---

### `E2E-06.8` — Implement Pledges Disabled & Receipt/Blink E2E (`RPL-T-91..102`)

- **Status:** `[ ] Todo`
- **Track:** Track B (Target)
- **Spec / Contract Ref:** `RPL-T-91..102`, `RPL-M-24, 33`
- **Target Files:**
  - `tests/e2e/block1-offchain/replay-receipts-pledges.e2e.spec.ts`
- **Depends On:** `SPC-04.6`

#### Definition of Ready (DoR)
- [ ] `PLEDGES_ENABLED=0` default guard (`403 pledges_disabled`, `SPC-04.6`) and receipt/Blink visibility rules (`SPC-04.2`) are implemented.

#### Definition of Done (DoD)
- [ ] `replay-receipts-pledges.e2e.spec.ts` verifies `RPL-T-91..102`:
  - `POST /api/live/rides/:id/pledge-intent` returns `403 pledges_disabled` when `PLEDGES_ENABLED=0` (`RPL-T-91..92`).
  - `/r/:id`, `/api/rides/:id/card.png`, and `/api/actions/ride/:id` work for finished verified 1h rides, set `Cache-Control: public, max-age=86400`, and return `404` for training or rejected rides (`RPL-T-93..102`).
- [ ] Passes in `npm run test:e2e:block1`.
- [ ] Status updated in [`docs/plan/e2e-headless/STATUS.md`](../STATUS.md).
