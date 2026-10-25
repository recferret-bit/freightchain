# Escrow program – what is not done, open questions, todo

Current state of `programs/freightchain_pools` and its server/ops integration. Keep this file current: tick items off here, move answers into the docs they belong to ([`program-deploy.md`](program-deploy.md), [`../spec/pool.md`](../spec/pool.md)), and delete what no longer applies.

Related: [deploy + operate](program-deploy.md) · [escrow spec](../spec/pool.md) · [contract reference](pool-program/index.html) · [localnet e2e](localnet-e2e/index.html) · [Oct 2026 audit fix plan](../insights/reviews/audit-2026-10/fix-plan.md).

25 October local checkpoint: the reproducible v6 build and its complete local-validator lifecycle passed on the matching pinned artifact. New on-chain pledge creation is now refused; the updated validator recovery and autonomous-day checks passed; deployment acceptance remains separate. `SPC-05.5` has been reopened. These local results do not verify or change the deployment records below. Evidence: [local readiness](../testing/LOCAL_READINESS.md).

## 1. Where things are

| What | State |
|---|---|
| **Devnet / production deployment (v3)** | **Live on Solana devnet since Oct 12** (`8No42h2QXb9opgp3pJfNXL2o77o288SsF8o7CwJGCA1p`, in-place upgrade tx `2qJNYBef…`, deployed bytes = v3 pin `47a630e8…`). Production server runs in `PAYMENT_MODE=program` against devnet with `CRANK_SECRET` and `PAYOUT_SECRET` set. |
| **Program v4 (Oct 14, WP5)** | **Built & merged into `main`** ([fix plan → WP5](../insights/reviews/audit-2026-10/fix-plan.md)): Merkle winners root + permissionless `pay_prize` (`H5`/`M6`), per-ride attestations for pledges (`H4`, `L5`, `L6`), sponsor receipts and refunds (`M8`), `seal_road` (`L4`), `Config` schedule floors (`min_review_secs` 3600 / `min_finish_secs` 10800), pool lock/cut snapshots (`L8`), attestation closes (`L7`), `migrate_config_v4`. |
| **Program v5 (Oct 17, `0.5.0`)** | **Built & merged into `main`, not deployed yet** ([`../spec/pool.md`](../spec/pool.md)): drops the on-chain referral leg, sets default split `8500 / 500 / 1000` (85% prize / 5% rollover / 10% fee), adds `set_pool_rules`, `max_player_share_bps < 5000` (default `4740`), and `paid_tickets_enabled`. Account sizes changed (`Config 167`, `Series 132`, `Pool 362`), so v5 requires a **fresh program id** on devnet when the owner asks ([`program-deploy.md`](program-deploy.md)). 163 LiteSVM tests + localnet suite green. |
| **Weekly skill contest (`server/src/domain/prize/`)** | **Built in repo** ([`../spec/pool.md`](../spec/pool.md) Appendix C, [`../spec/PRODUCT.md`](../spec/PRODUCT.md)): `GET /api/prize/board`, 1h weekly granted ticket (`weekly_ticket_1h_enabled = 1`), tie-splitting without wallet tie-breaker, 30% free-ticket prize cap (`settleBoard`), dynamic `N`-finalist table (`settleSeasonFinal`). Off-chain USDC payout, KYC (Didit), and sanctions (Chainalysis) for Pre-season / Season 1 are tracked in [`../plan/DEVNET_PRESEASON.md`](../plan/DEVNET_PRESEASON.md) and [`../plan/MASTER_PLAN.md`](../plan/MASTER_PLAN.md) §12. |

---

## 2. Not done yet (open engineering & ops items)

### 2.1 Devnet v5 cutover (waiting on owner command)
- **Deploy v5 under a fresh program id on devnet** ([`program-deploy.md`](program-deploy.md) → "Deploying v5"): generate/select the v5 program keypair, `anchor keys sync`, regenerate `verifiable-build.hash` (`npm run program:verify`), settle/close remaining v3 pools on devnet, deploy v5, initialize `Config` + `Series`, and update `TICKET_PROGRAM_ID` in `deploy/.env`.
- **Admin UI for committed Merkle root / sponsor refunds / `set_pool_rules`:**
  - The admin page shows each pool's winners and the signed HOLD, but does not yet display the v4/v5 committed Merkle root, `pay-from` countdown, or sponsor refund status (`WP7`).
  - `set_pool_rules`, `create_pool`, `set_config`, `set_series`, `cancel_pool`, and authority handover remain CLI-only (`server/scripts/pool-admin.mjs` with cold keypair files; see [`../spec/PRODUCT.md`](../spec/PRODUCT.md) Conflicts row 6).

### 2.2 Crank & server operations
- **Reclaiming `Ticket` rents on settled pools:** `close_ticket` (permissionless, returns ~0.0015 SOL rent to the buyer) is in the program and tested in `test:localnet`, but `CrankPoolsHandler` does not yet sweep `close_ticket` automatically after a pool settles (refunded pools already close their tickets on `refund`).
- **Automated seed rollover:** "seeds the next pool" is currently an operator CLI step (`pool-admin.mjs sponsor -k seed.json`), not an automatic crank transfer from `seed_treasury`.
- **Alerting on crank / payout errors:** `[chain] crank failed`, `payout-grace`, `payoutState = error`, and low balances on `CRANK_SECRET` / `PAYOUT_SECRET` are logged and shown on the admin POOLS / PAYOUTS tabs, but have no push/Telegram alert yet.
- **Re-planning after a post-plan ranking change (`M7`):** a pool whose verified ranking changes after its payout plan stops in `error` until acknowledged or until the 14-day grace expires.
- **Unregistered pool pledges:** `SyncPledgesHandler` only refunds pledges for pools present in the server mirror (use `pool:register` if a pool was opened outside the watcher).

### 2.3 Security & before-mainnet gates
- **External third-party audit:** internal 12-agent review (`WP1–WP6`, [`../insights/reviews/audit-2026-10/fix-plan.md`](../insights/reviews/audit-2026-10/fix-plan.md)) and Trail of Bits checklist (`program-check`) are done; an independent external audit is required before mainnet.
- **Mainnet Squads v4 multisigs:** move upgrade authority, cold `admin`, `fee_treasury`, and `seed_treasury` to Squads multisigs before mainnet ([`../plan/OWNER_TASKS.md`](../plan/OWNER_TASKS.md) §4.1).
- **No staking (decided Oct 12):** idle vault lamports are never staked; `record_yield` was removed in v3 and migration `20261026000000_drop_staking_yield_columns` dropped the unused columns.
- **Known v4/v5 design notes & v6 contract alignment (`SPC-05.5`):**
  - **Operator-funded activation vs. legacy `min_tickets` / `fail_pool`:** In `freightchain_pools` v5 (`create_pool.rs`, `buy_ticket.rs`, `lifecycle.rs`), `Pool` still starts in `STATUS_OPEN` with `min_tickets >= 1` and only transitions to `STATUS_ACTIVE` when `buy_ticket` reaches `min_tickets` (and `fail_pool` allows a refund if `tickets_sold < min_tickets` at `prep_deadline`). Under the updated skill-contest legal model ([`../legal/TERMS.md`](../legal/TERMS.md) §7.5/§8, [`../spec/pool.md`](../spec/pool.md) `POOL-M-05`), we and sponsors fund the major pool (`> 50%`), optional paid tickets (`< 50%`) buy extra attempts, there is **no minimum-ticket-sale threshold and no refund for low ticket sales**, and bought tickets burn if unused by `last_start_at`. In v6 (`SPC-05.5`), pools open directly as `STATUS_ACTIVE` (`min_tickets = 0`) with `fail_pool` removed for low ticket sales (retaining only admin `cancel_pool` and 14-day unsettled `expire_pool`), and peer-to-peer `create_pledge` is disabled (`Decision 51`).
  - A single cranker could delay `seal_road` and re-roll a road about once per 512 slots (~3 min) when no ticket is bought after `prep_deadline`.
  - A `RideAttestation`'s driver is immutable once recorded; a wrong first record makes that ride's pledges refund-only.
  - A committed rank whose destination wallet is below the system rent-exempt minimum cannot receive lamports until topped up.

### 2.4 Small known gaps
- Lobby "N pools on sale" badge counts `active` pools whose sale/play window has already closed.
- An unfinished ticket order has no manual `CANCEL` button (it expires after `ORDER_TTL_MINUTES = 60`).
- `profile.stats.paidRides` stays `0` for ticket rides; `pool:seed` cannot seed a `refunding` pool directly.
- Achievement cNFTs ([`../spec/web3_solana.md`](../spec/web3_solana.md)): code, outbox, Bubblegum v2 adapter, and tests are shipped; devnet Merkle tree setup (`setup-tree.mjs`), Irys art upload (`upload-irys.mjs`), and `ACHIEVEMENT_*` production env keys are still pending owner execution.

---

## 3. Resolved owner questions (summary)

Full decision log: [`../spec/README.md`](../spec/README.md) and [`../spec/DECISIONS.md`](../spec/DECISIONS.md). Open legal/tax questions: [`../spec/OPEN.md`](../spec/OPEN.md).

- **Q-A / Q-B / Q-F / Q-H / Q-K / Q10 / Q15:** `localnet-e2e` merged; devnet keys in `deploy/secrets/devnet/`; QuickNode devnet RPC with public RPC read fallbacks (`SOLANA_RPC_FALLBACKS`); pools opened on schedule by the crank from `Series` (1h tier: 24 h sale, 3 h finish window, 48 h review); payout job closes paid pools automatically with `PAYOUT_SECRET`; production switched to devnet program mode on Oct 11 (`PAYMENT_MODE=program`).
- **Q14 (One road per pool):** every ticket ride of a pool drives the pool's committed `seed_commitment` (v3+) / `rideSeed`; target rules for ocultar/reveal and `holeSalt` when attempts > 1 are in [`../spec/anticheat.md`](../spec/anticheat.md) `ACH-M-11` and [`../spec/replays_streams.md`](../spec/replays_streams.md) `RPL-M-04`.



### Local v6 checkpoint, 25 October 2026

Schedule/activation code is implemented with six dedicated LiteSVM scenarios and regenerated IDL/transaction fixtures. Server codec/schedule checks pass (235 tests). The reproducible Docker build and 203 Rust tests passed. The complete purchase/payout/autonomous-day validator gate passed on pin `bc9d2a2dcf6d0dea0a3240e53c347983eb1d425ded3ab1ce7ca254b38683f1d7`: 29/30 successful instructions plus the refusing `fail_pool` tombstone, 26/28 events plus two documented exemptions, and all 50 errors with LiteSVM. Evidence: `/private/tmp/fc-v6-acceptance.log`. No remote deployment is authorized by this result. v6 uses 386-byte Pool and up-to-156-byte Series accounts; existing accounts need a separate migration or, as planned, a fresh program. Follow-up: Decision 51 now refuses new on-chain pledge creation (`PledgesDisabled`) while retaining legacy settlement/refund. The updated Docker pin is `c32477bcef6f31d489b6aefc08e50e23c481eceffd64ea2dc8ad4bbd11ae41f4`; 204 Rust tests, clippy and the RustSec gate passed, as did 104 server codec/IDL tests. Historical pledge genesis fixtures exercise recovery separately from the current autonomous day. The updated artifact passed money/payout/historical recovery, followed by a successful autonomous-day rerun after fixing a test-only missing rent helper. Combined same-pin coverage: 28/30 successful instructions plus two refusing tombstones, 25/28 events plus three documented historical exemptions, and all 51 errors with LiteSVM. Evidence: `/private/tmp/fc-pledge-localnet.log`, `/private/tmp/fc-pledge-day.log`, `/private/tmp/fc-pledge-combined-coverage.txt`. These are resumed phases, not a single uninterrupted full run; final merged acceptance remains open.

The late SlotHashes scan measured 58,512 CU at 442 slots on the validator. The crank seal budget is now 80,000 CU (previously 40,000), with a regression assertion and the validator measurement retained. Schedule RPC outages propagate as unavailable instead of inventing drift from legacy derived timestamps.
