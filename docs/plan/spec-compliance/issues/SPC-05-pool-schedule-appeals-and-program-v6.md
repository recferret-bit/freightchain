# Epic SPC-05 — Pool Schedule, `last_start_at`, Appeals & Program v6

> **Parent Plan:** [`docs/plan/SPEC_COMPLIANCE_PLAN.md`](../../SPEC_COMPLIANCE_PLAN.md) · **Status Board:** [`docs/plan/spec-compliance/STATUS.md`](../STATUS.md)
> **Spec Docs:** [`docs/spec/pool.md`](../../../spec/pool.md) (`POOL-M-01..14`, Decisions `34–37`, Backend Decision `B8`)

---

## Overview

Updates the escrowed prize pool lifecycle and `freightchain_pools` Anchor program to match [`docs/spec/pool.md`](../../../spec/pool.md): configurable weekly pool schedule (`opens_at`, `sales_close_at`, `last_start_at = play_close_at - 1h15m`, `play_close_at`, `validation_until = payout_at`), on-chain schedule sync guard (`409 pool_schedule_mismatch`), `409 pool_last_start_passed` cutoff, non-refundable ticket burn warning & confirmation checkbox, post-close validation & appeals workflow, and Anchor program v6 schedule fields.

---

## Tasks

### `SPC-05.1` — Implement configurable weekly pool schedule (`opens_at`, `sales_close_at`, `last_start_at = close - 1h15m`, `play_close_at`, `validation_until = payout_at`)

- **Status:** `[x] Done` — server schedule on `GET /api/pools/current` and `GET /api/pools/:id`. Migration `20261107000000_wave4_chat_pool_convoy_airdrop` is in the tree. Unit specs passed on main, 2026-10-20.
- **Spec Rules:** `POOL-M-01`, `POOL-M-02`, `POOL-M-03`, `POOL-M-04` (`docs/spec/pool.md` §2, Decision 35)
- **Paired Plan 1 Task:** `E2E-08.5`
- **Target Files:**
  - `backend/server/prisma/schema.prisma` (`opensAt`, `salesCloseAt`, `lastStartAt`, `playCloseAt`, `validationUntil` on `pool.Pool` and `pool.Series`)
  - `backend/server/prisma/migrations/<timestamp>_pool_schedule_windows/migration.sql`
  - `backend/server/src/domain/pool/`
  - `backend/server/src/application/pools/`
- **Depends On:** None

#### Definition of Ready (DoR)
- [ ] Pool timeline phases in `docs/spec/pool.md` §2 (default 7-day cycle: `opens_at` → `sales_close_at = last_start_at = play_close_at - 75 min` → `play_close_at` → `validation_until = play_close_at + 12h..24h` → `payout_at`) are reviewed.

#### Definition of Done (DoD)
- [ ] Forward-only Prisma migration adds schedule window columns to `pool.Pool` and `pool.Series`.
- [ ] Pool crank and `GET /api/pools/current` / `GET /api/pools/:id` compute and expose all 5 timestamps and current phase (`upcoming | open | finishing | validating | paid | closed`).
- [ ] `docs/spec/PRODUCT.md` updated; status marked `[x] Done` in [`docs/plan/spec-compliance/STATUS.md`](../STATUS.md).

---

### `SPC-05.2` — Enforce `409 pool_last_start_passed` on ride start & `409 pool_schedule_mismatch` on DB vs on-chain PDA timestamp drift

- **Status:** `[x] Done` — buy or start after `lastStartAt` is `409 pool_last_start_passed`. Program-mode drift is `409 pool_schedule_mismatch`.
- **Spec Rules:** `POOL-M-05`, `POOL-M-06`, `POOL-M-11` (`docs/spec/pool.md` §2.3–2.4)
- **Paired Plan 1 Task:** `E2E-08.5`
- **Target Files:**
  - `backend/server/src/application/rides/start-ride.handler.ts`
  - `backend/server/src/application/tickets/create-ticket-order.handler.ts`
  - `backend/server/src/application/pools/pool-sync.service.ts`
- **Depends On:** `SPC-05.1`

#### Definition of Ready (DoR)
- [ ] `last_start_at` cutoff (`play_close_at - 4500s`) and on-chain `Pool` PDA timestamp comparison rules are reviewed.

#### Definition of Done (DoD)
- [ ] Attempting to buy a pool ticket or start a pool ride when `clock.now() > pool.lastStartAt` returns `409 pool_last_start_passed`.
- [ ] Before issuing a ticket order or starting a pool ride in `program` mode, the server verifies that DB `opensAt` / `lastStartAt` / `playCloseAt` match the mirrored on-chain `Pool` PDA; any discrepancy returns `409 pool_schedule_mismatch` and triggers an admin alert (`SPC-02.9`).
- [ ] `docs/spec/PRODUCT.md` updated; status marked `[x] Done` in [`docs/plan/spec-compliance/STATUS.md`](../STATUS.md).

---

### `SPC-05.3` — Add non-refundable ticket burn rule after `last_start_at` + lobby purchase warning modal & mandatory confirmation checkbox

- **Status:** `[x] Done` — unused tickets burn after last start. The lobby checkbox requires `burnWarningAccepted: true`.
- **Spec Rules:** `POOL-M-07` (`docs/spec/pool.md` §3, Decision 36)
- **Paired Plan 1 Task:** `E2E-08.5`
- **Target Files:**
  - `frontend/client/index.html`, `frontend/client/site/` (ticket purchase modal)
  - `backend/server/src/presentation/tickets/tickets.dto.ts` (`burnWarningAccepted: z.literal(true)`)
- **Depends On:** `SPC-05.2`

#### Definition of Ready (DoR)
- [ ] Ticket burn copy (EN & RU) and `burnWarningAccepted` requirement in `docs/spec/pool.md` §3 are reviewed.

#### Definition of Done (DoD)
- [ ] Unused pool tickets after `last_start_at` expire into the pool prize pot (never carry over to the next pool).
- [ ] Lobby ticket purchase modal displays the exact `last_start_at` countdown and requires checking the non-refundable burn acknowledgment checkbox (`burnWarningAccepted: true` enforced by server DTO).
- [ ] `docs/spec/PRODUCT.md` updated; status marked `[x] Done` in [`docs/plan/spec-compliance/STATUS.md`](../STATUS.md).

---

### `SPC-05.4` — Implement pool validation & appeals workflow (`POST /api/rides/:id/appeal`, admin review queue, block `commit_winners_root` until `validation_until` & 0 open appeals)

- **Status:** `[x] Done` — `POST /api/rides/:id/appeal` and `GET/POST /api/admin/appeals`. Payout waits for `validationUntil`, no running rides, and zero open appeals.
- **Spec Rules:** `POOL-M-08`, `POOL-M-09` (`docs/spec/pool.md` §4, Decision 37)
- **Paired Plan 1 Task:** `E2E-08.5`
- **Target Files:**
  - `backend/server/prisma/schema.prisma` (`ride.RideAppeal`)
  - `backend/server/prisma/migrations/<timestamp>_ride_appeals/migration.sql`
  - `backend/server/src/presentation/rides/rides.controller.ts` (`POST /api/rides/:id/appeal`)
  - `backend/server/src/presentation/admin/admin-appeals.controller.ts`
  - `backend/server/src/application/pools/pool-payout.service.ts`
- **Depends On:** `SPC-05.1`

#### Definition of Ready (DoR)
- [ ] Appeals lifecycle (`open → upheld | denied`, one appeal per rejected/flagged pool ride submitted before `validation_until`, resolved by signed admin action) in `docs/spec/pool.md` §4 is reviewed.

#### Definition of Done (DoD)
- [ ] Riders whose pool ride is `rejected` or `flagged_for_review` can submit `POST /api/rides/:id/appeal` (≤ 500 chars reason) before `pool.validationUntil`.
- [ ] `pool:payout` (`commit_winners_root`) refuses to commit a pool's winners Merkle root until `clock.now() >= pool.validationUntil`, all running rides are settled, and `0` appeals remain in `open` status.
- [ ] `docs/spec/PRODUCT.md` updated; status marked `[x] Done` in [`docs/plan/spec-compliance/STATUS.md`](../STATUS.md).

---

### `SPC-05.5` — Update `freightchain_pools` program: `Config.min_finish_secs <= 7200` + v6 schedule fields (`opens_at`, `last_start_at`, `period_secs`) + operator-funded pool activation (no `min_tickets` low-sales refund)

- **Status:** `[~] In Progress` — reopened by the 24 October [local readiness audit](../../../testing/LOCAL_READINESS.md). Server ceiling is 7200 seconds, but Rust edits are comments and the current program still opens with `STATUS_OPEN` / `min_tickets >= 1`; v6 schedule/activation constraints are absent. Rust/LiteSVM and the current binary's local-validator lifecycle passed on 24 October; those tests cover v5 behavior and do not complete this task. The binary also differs from the pinned verifiable-build hash.
- **Paired Plan 1 Task:** `E2E-08.5`
- **Target Files:**
  - `backend/programs/freightchain_pools/src/`
  - `backend/server/src/infrastructure/solana/`
  - `backend/server/test/architecture/anchor-idl-drift.spec.ts`
- **Depends On:** `SPC-05.1`

#### Definition of Ready (DoR)
- [ ] `freightchain_pools` Rust state and instruction constraints for `Config.min_finish_secs <= 7200` (`2h` ceiling), `Pool` / `Series` schedule fields (`opens_at`, `last_start_at`, `period_secs`), and operator-funded pool activation (pools open directly in `STATUS_ACTIVE` without requiring `tickets_sold >= min_tickets`, removing `fail_pool` for low ticket sales and disabling peer-to-peer `create_pledge`) in `docs/spec/pool.md` §20.3 are reviewed.
- [ ] Reminder per `AGENTS.md`: build & test on local validator only; never deploy to devnet without explicit user instruction.

#### Definition of Done (DoD)
- [ ] `freightchain_pools` enforces `min_finish_secs <= 7200`, validates `opens_at < last_start_at < close_at` on-chain (`buy_ticket` and `seal_road` rejected after `last_start_at`), and opens operator-funded pools in `STATUS_ACTIVE` (`min_tickets = 0`, no low-sales `fail_pool` refund; only admin `cancel_pool` or 14-day unsettled `expire_pool` refunds).
- [ ] `anchor-idl-drift.spec.ts` and `npm run test:localnet` pass on local validator.
- [ ] `docs/tech/escrow-open-items.md` and `docs/spec/PRODUCT.md` updated; status marked `[x] Done` in [`docs/plan/spec-compliance/STATUS.md`](../STATUS.md).

---

### `SPC-05.6` — Resolve `set_pool_rules` governance conflict (`POOL-M-12`/`B8` Admin HTTP vs `ADM-M-07`/Decision 60 Squads multisig-only)

- **Status:** `[x] Done` — Decision 70 (24.10.2026): Decision 60 wins. No admin HTTP route. `pool-admin.mjs set-pool-rules` is the signed command. On mainnet, Squads. Backend decision 8's HTTP pair is withdrawn.
- **Spec Rules:** Conflict between `POOL-M-12` (`docs/spec/pool.md` / Backend Decision `B8`: expose `POST /api/admin/pools/:id/rules` to invoke `set_pool_rules`) and `ADM-M-07` (`docs/spec/admin_security.md` / Decision 60: cold-admin instructions like `set_pool_rules` and `veto_winners_root` must NEVER be exposed over Admin HTTP and must execute via Squads multisig CLI only)
- **Paired Plan 1 Tasks:** `E2E-08.5`, `E2E-09.1`
- **Target Files:**
  - `docs/spec/DECISIONS.md`, `docs/spec/PRODUCT.md`, `docs/spec/pool.md`, `docs/spec/admin_security.md`
  - `backend/server/src/presentation/admin/` (or `backend/server/scripts/`)
- **Depends On:** **Owner Decision Gate**

#### Definition of Ready (DoR)
- [ ] **OWNER DECISION GATE:** Owner selects either:
  - **Option A (`ADM-M-07` / Decision 60 wins):** Keep `set_pool_rules` out of HTTP; provide offline/CLI unsigned transaction builder for Squads multisig only, and update `POOL-M-12` in `docs/spec/pool.md`.
  - **Option B (`POOL-M-12` / `B8` wins):** Expose `POST /api/admin/pools/:id/rules` as a client-signed transaction builder (server never holds cold admin key) gated by `ADMIN_APPROVAL_MODE=dual`, and update `ADM-M-07`.

#### Definition of Done (DoD)
- [ ] Selected option is implemented and the conflict row in `docs/spec/PRODUCT.md` is closed.
- [ ] Paired tests in `E2E-08.5` and `E2E-09.1` pass.
- [ ] Status marked `[x] Done` in [`docs/plan/spec-compliance/STATUS.md`](../STATUS.md).
