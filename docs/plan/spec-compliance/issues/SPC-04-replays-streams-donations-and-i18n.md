# Epic SPC-04 — Replays, Tip-Only Donations, Controls `C1..C36`, Chat & EN/RU i18n

> **Parent Plan:** [`docs/plan/SPEC_COMPLIANCE_PLAN.md`](../../SPEC_COMPLIANCE_PLAN.md) · **Status Board:** [`docs/plan/spec-compliance/STATUS.md`](../STATUS.md)
> **Spec Docs:** [`docs/spec/replays_streams.md`](../../../spec/replays_streams.md) (`RPL-M-01..34`, Decisions `18, 33, 34, 45–58`), [`docs/spec/legal.md`](../../../spec/legal.md) (`LEG-M-10, 11`)

---

## Overview

Transforms the live stream & replay subsystem to match [`docs/spec/replays_streams.md`](../../../spec/replays_streams.md): disables live spectating of running rides (protecting pool competition integrity), hides training rides from public surfaces, gates pool replays until `payout_at` (except for the owner), strips raw input bits (`SAMPLE_INPUT_COL`) from public watch responses, removes all gameplay-altering donation and HONK effects, moves chat and tip-only SOL donations onto finished replays with `0%` referral donation share, disables pledges via `PLEDGES_ENABLED=0`, builds replay player controls `C3/C6/C7/C8/C15..19/C36` (and removes `C9/C26/C27/C32`), adds time-bound replay chat with moderation (`P01/P02`) and 90-day retention, and ships full EN/RU localization (`i18n.js`).

---

## Tasks

### `SPC-04.1` — Disable live watch of running rides (`GET /api/watch/:id` & `/road` → `404` when `running`)

- **Status:** `[ ] Todo`
- **Spec Rules:** `RPL-M-01`, `RPL-M-02` (Decision 45)
- **Paired Plan 1 Task:** `E2E-06.2`
- **Target Files:**
  - `backend/server/src/application/live/watch-ride.handler.ts`
  - `backend/server/src/presentation/live/watch.controller.ts`
  - `frontend/client/index.html`, `frontend/client/site/` (remove live-running stream cards)
- **Depends On:** None

#### Definition of Ready (DoR)
- [ ] Current `/api/watch/:id`, `/api/watch/:id/road`, and `/api/live` handlers in `backend/server/src/application/live/` are inspected.

#### Definition of Done (DoD)
- [ ] `GET /api/watch/:id` and `GET /api/watch/:id/road` return `404` (`replay_not_available`) whenever `ride.status === 'running'`.
- [ ] Public boards list only finished verified 1h replays (`RPL-M-01..02`).
- [ ] `docs/spec/PRODUCT.md` updated; status marked `[x] Done` in [`docs/plan/spec-compliance/STATUS.md`](../STATUS.md).

---

### `SPC-04.2` — Hide training rides from public replays/watch/receipts/Blinks + gate pool replays until `payout_at` (except owner)

- **Status:** `[ ] Todo`
- **Spec Rules:** `RPL-M-03`, `RPL-M-04`, `RPL-M-05`, `RPL-M-06`, `RPL-M-08`, `RPL-M-09`, `RPL-M-24` (Decisions 46, 47)
- **Paired Plan 1 Tasks:** `E2E-06.2`, `E2E-06.8`
- **Target Files:**
  - `backend/server/src/application/live/`
  - `backend/server/src/application/rides/ride-receipt.service.ts`
  - `backend/server/src/application/actions/ride-action.service.ts`
- **Depends On:** `SPC-04.1`

#### Definition of Ready (DoR)
- [ ] Visibility matrix in `docs/spec/replays_streams.md` §2 (`M-RPL-01..06`: training `tier='free'`/guest/tutorial/assist rides never public; pool rides hidden from non-owners until `pool.payoutAt !== null`; rejected rides hidden from public boards) is reviewed.

#### Definition of Done (DoD)
- [ ] Training rides (`tier === 'free'`, `guestId !== null`, `assist === true`, or tutorial trip) are excluded from `GET /api/replays` and return `404` on `/api/watch/:id`, `/r/:id`, `/api/rides/:id/card.png`, and `/api/actions/ride/:id`.
- [ ] Pool rides (`poolId !== null`) where `pool.payoutAt === null` return `200` on `/api/watch/:id` only when the authenticated caller is `ride.wallet`, and `404` (`replay_locked_until_payout`) for everyone else.
- [ ] `docs/spec/PRODUCT.md` updated; status marked `[x] Done` in [`docs/plan/spec-compliance/STATUS.md`](../STATUS.md).

---

### `SPC-04.3` — Strip `SAMPLE_INPUT_COL` & raw input bits from public `/api/watch/:id` responses

- **Status:** `[ ] Todo`
- **Spec Rules:** `RPL-M-07` (`docs/spec/replays_streams.md` §2.4, Decision 48)
- **Paired Plan 1 Task:** `E2E-06.2`
- **Target Files:**
  - `backend/server/src/application/live/watch-ride.handler.ts`
- **Depends On:** `SPC-04.1`

#### Definition of Ready (DoR)
- [ ] Telemetry sample column layout in `@freightchain/shared` (`SAMPLE_INPUT_COL`) and `/api/watch/:id` serializer are inspected.

#### Definition of Done (DoD)
- [ ] Public `/api/watch/:id` responses zero or strip `SAMPLE_INPUT_COL` and never return raw 30 Hz input bitstreams ( preventing bot training / route reverse-engineering from top replays), while `/api/admin/rides/:id/samples` retains full columns for admin inspection.
- [ ] `docs/spec/PRODUCT.md` updated; status marked `[x] Done` in [`docs/plan/spec-compliance/STATUS.md`](../STATUS.md).

---

### `SPC-04.4` — Remove gameplay donation effects & remove `honk/time` and `honk/weather`

- **Status:** `[ ] Todo`
- **Spec Rules:** `RPL-M-17`, `RPL-M-34` (Decisions 18, 51)
- **Paired Plan 1 Task:** `E2E-06.7`
- **Target Files:**
  - `backend/server/src/presentation/live/`
  - `backend/server/src/presentation/honk/`
  - `frontend/client/js/net/` (remove live effect polling & application during driving)
- **Depends On:** None

#### Definition of Ready (DoR)
- [ ] All donation effect kinds (`night`, `day`, `potholes`, `trench`, `sinkhole`), `POST /api/live/rides/:id/effects/:eventId/applied`, `POST /api/honk/time`, and `POST /api/honk/weather` call sites in server and client are inventoried.

#### Definition of Done (DoD)
- [ ] Spectators and players can no longer alter weather, time of day, or road obstacles in any ride:
  - Donation orders accept only `kind: 'tip'` (rejecting `night`, `day`, `potholes`, `trench`, `sinkhole` with `400`).
  - `POST /api/live/rides/:id/effects/:eventId/applied`, `POST /api/honk/time`, and `POST /api/honk/weather` are removed / return `404`/`410`.
  - Client `play.html` no longer polls or applies external effects during driving.
- [ ] `docs/spec/PRODUCT.md` updated; status marked `[x] Done` in [`docs/plan/spec-compliance/STATUS.md`](../STATUS.md).

---

### `SPC-04.5` — Rework donations to replay-only SOL tips (`0.01/0.05/0.1` presets, `[0.001, 1.0]` SOL bounds, 15m expiry, ≤3 open orders, `95/5` split, `0%` referral share)

- **Status:** `[ ] Todo`
- **Spec Rules:** `RPL-M-14`, `RPL-M-15`, `RPL-M-16`, `RPL-M-19`, `RPL-M-20`, `RPL-M-21`, `RPL-M-22`, `RPL-M-23` (Decisions 33, 50, 52, 53)
- **Paired Plan 1 Task:** `E2E-06.7`
- **Target Files:**
  - `backend/server/src/application/live/live-donation.service.ts`
  - `frontend/client/site/` (replay tip UI presets `0.01`, `0.05`, `0.1` SOL + custom input)
- **Depends On:** `SPC-04.4`

#### Definition of Ready (DoR)
- [ ] Tip rules in `docs/spec/replays_streams.md` §5 (`min = 1_000_000` lamports `0.001 SOL`, `max = 1_000_000_000` lamports `1.0 SOL`, presets `0.01 / 0.05 / 0.1 SOL`, `9500 bps` driver / `500 bps` treasury, `referral_donation_share_bps = 0` with no `also` third transfer leg, 15-minute order expiry, max 3 open pending orders per donor wallet, only on finished public replays) are reviewed.

#### Definition of Done (DoD)
- [ ] `LiveDonationService` enforces finished-replay-only tipping, `[0.001, 1.0]` SOL bounds, max 3 open orders (`429 too_many_open_orders`), 15-minute expiry via `ClockPort`, and `95/5` driver/treasury split with zero referral leg.
- [ ] Replay viewer UI displays `0.01`, `0.05`, `0.1` SOL quick-tip buttons and custom SOL input.
- [ ] `docs/spec/PRODUCT.md` updated; status marked `[x] Done` in [`docs/plan/spec-compliance/STATUS.md`](../STATUS.md).

---

### `SPC-04.6` — Add `GET /api/me/donations` (`sent`/`received` history) & disable pledges on devnet launch (`PLEDGES_ENABLED=0` → `403 pledges_disabled`)

- **Status:** `[ ] Todo`
- **Spec Rules:** `RPL-M-18`, `RPL-M-33` (Decisions 34, 54)
- **Paired Plan 1 Tasks:** `E2E-06.7`, `E2E-06.8`
- **Target Files:**
  - `backend/server/src/presentation/player/me.controller.ts` (`GET /api/me/donations`)
  - `backend/server/src/application/live/pledge.service.ts`
  - `backend/server/src/infrastructure/config/env.schema.ts` (`PLEDGES_ENABLED`)
  - `backend/server/.env.example`, `infra/deploy/.env.example`, `infra/deploy/docker-compose.prod.yml`
- **Depends On:** `SPC-04.5`

#### Definition of Ready (DoR)
- [ ] Response contract for `GET /api/me/donations` (`{ sent: [...], received: [...], totals: { sentLamports, receivedLamports } }`) and `PLEDGES_ENABLED` flag behavior in `docs/spec/replays_streams.md` §5.5 & §6 are reviewed.

#### Definition of Done (DoD)
- [ ] `GET /api/me/donations` returns authenticated player's confirmed sent and received tips with `@ZodResponse` validation.
- [ ] `PLEDGES_ENABLED` defaults to `0` (`false`); when disabled, `POST /api/live/rides/:id/pledge-intent` and `/pledge-confirm` return `403 pledges_disabled` (while keeping localnet program tests `E2E-05.2` able to opt in with `PLEDGES_ENABLED=1`).
- [ ] `docs/spec/PRODUCT.md` updated; status marked `[x] Done` in [`docs/plan/spec-compliance/STATUS.md`](../STATUS.md).

---

### `SPC-04.7` — Build replay player controls `C3, C6, C7, C8, C15, C16, C17, C18, C19, C36` and remove `C9, C26, C27, C32` in `frontend/client/`

- **Status:** `[ ] Todo`
- **Spec Rules:** `RPL-M-11`, `RPL-M-12`, `RPL-M-13`, `RPL-M-32` (`docs/spec/replays_streams.md` §3, Decision 49)
- **Paired Plan 1 Tasks:** `E2E-06.4`, `E2E-06.5`
- **Target Files:**
  - `frontend/client/index.html`
  - `frontend/client/site/replay-player.js` (and viewer styles/controls)
- **Depends On:** `SPC-04.1`

#### Definition of Ready (DoR)
- [ ] Control table `C1..C36` in `docs/spec/replays_streams.md` §3.2 is reviewed:
  - Build/complete: `C3` hover time tooltip on scrubber, `C6/C7` `±10s` seek buttons & `←/→` keys, `C8` restart button, `C15` camera view toggle (`C` key: cabin / chase / hood), `C16` fullscreen toggle (`F` key), `C17` timeline event markers (damage spikes, honks, minigames), `C18` audio volume slider + mute (`M` key), `C19` copy share link at current timestamp (`?t=123`), `C36` speed & damage mini-chart below timeline.
  - Remove: `C9` live indicator badge, `C26` sabotage effect buttons, `C27` pledge panel, `C32` raw input key overlay.

#### Definition of Done (DoD)
- [ ] All controls `C1..C36` (minus removed `C9, C26, C27, C32`) are implemented in the replay player and pass Headless Chrome verification (`E2E-06.4`, `E2E-06.5`).
- [ ] `docs/spec/PRODUCT.md` updated; status marked `[x] Done` in [`docs/plan/spec-compliance/STATUS.md`](../STATUS.md).

---

### `SPC-04.8` — Implement replay chat time-binding (`replayT`), 200-char/link/word filter, moderation endpoints `P01/P02`, and 90-day chat retention job

- **Status:** `[ ] Todo`
- **Spec Rules:** `RPL-M-25`, `RPL-M-26`, `RPL-M-27`, `RPL-M-28`, `RPL-M-29`, `RPL-M-30`, `RPL-M-31` (Decisions 55–57)
- **Paired Plan 1 Task:** `E2E-06.6`
- **Target Files:**
  - `backend/server/prisma/schema.prisma` (`replayT`, `hiddenAt`, `hiddenBy` on `live.LiveChat`; `chatBannedUntil` on `player.Player`)
  - `backend/server/prisma/migrations/<timestamp>_replay_chat_moderation/migration.sql`
  - `backend/server/src/application/live/live-chat.service.ts`
  - `backend/server/src/application/live/chat-retention.scheduler.ts`
- **Depends On:** `SPC-02.2`, `SPC-04.1`

#### Definition of Ready (DoR)
- [ ] Replay chat rules in `docs/spec/replays_streams.md` §4 (`replayT` integer seconds bound to current playback position, ≤ 200 chars, URL/domain & profanity rejection, rate limit 5 msg / 60s, `P01` hide message, `P02` ban wallet from chat, 90-day retention pruning non-tip chat messages) are reviewed.

#### Definition of Done (DoD)
- [ ] Forward-only migration adds `replayT`, `hiddenAt`, `hiddenBy` to `live.LiveChat` and `chatBannedUntil` to `player.Player`.
- [ ] Chat messages are stored and returned ordered by `replayT`, revealed progressively as the replay scrubber advances, filtered for links/banned words, moderatable via `P01/P02`, and pruned after 90 days (except confirmed tip messages).
- [ ] `docs/spec/PRODUCT.md` updated; status marked `[x] Done` in [`docs/plan/spec-compliance/STATUS.md`](../STATUS.md).

---

### `SPC-04.9` — Implement `frontend/client/site/i18n.js` full EN/RU localization across lobby, replay viewer, receipts, and error codes

- **Status:** `[ ] Todo`
- **Spec Rules:** `RPL-M-10`, `RPL-M-10a`, `LEG-M-10`, `LEG-M-11` (Decision 58)
- **Paired Plan 1 Task:** `E2E-06.3`
- **Target Files:**
  - `frontend/client/site/i18n.js`
  - `frontend/client/index.html`, `frontend/client/r.html`, `frontend/client/blink.html`
- **Depends On:** None

#### Definition of Ready (DoR)
- [ ] EN and RU string catalogs and resolution order (`?lang=ru|en` URL param → `store('fc_lang')` → `navigator.language` → `'en'`) in `docs/spec/replays_streams.md` §2.5 are reviewed.

#### Definition of Done (DoD)
- [ ] `frontend/client/site/i18n.js` provides complete EN and RU dictionaries for all lobby tabs, replay controls, donation/tip modals, Convoy referral UI, legal notices, and backend error codes, with a persistent `EN | RU` header toggle.
- [ ] Headless Chrome i18n suite (`E2E-06.3`) passes with zero untranslated keys or layout overflow.
- [ ] `docs/spec/PRODUCT.md` updated; status marked `[x] Done` in [`docs/plan/spec-compliance/STATUS.md`](../STATUS.md).
