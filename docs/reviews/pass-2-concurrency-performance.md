# Review Report: Milestone M4 Pass 2 — Concurrency, Performance & Edge Cases

**Reviewer**: Adversarial Concurrency Reviewer (`teamwork_preview_reviewer`)  
**Date**: 2026-10-12  
**Target Worktree**: `/Users/ferretrec/work/freightchain-integrity-yield`  
**Target Branch**: `feature/onchain-integrity-yield`  
**Authoritative Documents**: `ORIGINAL_REQUEST.md` (R4), `PROJECT.md`  

---

## 1. Executive Summary & Verdict

**Verdict**: **REQUEST_CHANGES**  
**Overall Risk Assessment**: **MEDIUM-HIGH**  
**Integrity Audit**: **PASS** (Zero integrity violations, zero facades, zero hardcoded test shortcuts detected)

### Summary of Assessment
Milestone M4 Pass 2 performed an adversarial examination of concurrency, performance, clock drift, RPC congestion resilience, dropped transaction recovery, race condition mitigation, and PostgreSQL locking protocols across both Anchor v3 program (`programs/freightchain-pools`) and the NestJS backend (`server/src/`).

The core transaction architecture in the server exhibits exceptional adherence to PostgreSQL lock ordering (`player -> pool -> tickets`) and demonstrates robust multi-client concurrency in `server/test/integration/concurrency.integration.spec.ts` (42/42 tests passing). LiteSVM program execution benchmarks show healthy compute-unit headroom against `CU_LIMITS`.

However, adversarial analysis revealed four major operational and concurrency vulnerabilities in the newly introduced Anchor v3 pledge and RPC confirmation subsystems that require remediation before production readiness:
1. **RPC Confirmation Abortion on Transient Network Errors**: In `signed-sender.ts`, `broadcastUntilConfirmed` catches errors on transaction broadcast, but does not catch transient network errors on `getSignatureStatuses` or `getBlockHeight`. A single socket drop or HTTP 504 from the primary RPC immediately aborts the 60-resend (120 s) retry loop with a `ServiceUnavailableError`.
2. **Unvalidated Settle Pledge & Lack of Optimistic Locking**: In `SettlePledgeHandler`, incoming settlement requests are persisted to PostgreSQL without verifying the provided Solana signature or checking on-chain confirmation, and without row locking or version checks, leaving the entity open to last-write-wins races.
3. **Sponsor Authorization Bypass in `PledgesHttpController.create`**: Authenticated callers can specify an arbitrary `body.sponsor` address in the request payload, enabling a malicious player to bind pledges to third-party player accounts.
4. **Orphan Pledges on Free Rides**: `CreatePledgeHandler` permits pledges where `ride.poolId === null`, persisting records with `poolId = 0`. Because free rides have no on-chain pool or attestation PDA, these pledges can never be initialized or settled on Solana.

---

## 2. In-Depth Concurrency & Stress Analysis

### 2.1 Clock Drift: Sysvar Clock vs ClockPort vs Client Timestamps
- **Solana Cluster Sysvar Clock vs Server Clock**:
  - The Anchor v3 program strictly validates time via `Clock::get()?.unix_timestamp` for `pay_prize`, `close_pool`, `buy_ticket`, and `refund`.
  - If the server's local machine clock were used to decide when a pool review window has elapsed (`now >= pool.payoutAt`), any positive clock drift (cluster lagging wall-clock) would trigger `PoolError::TooEarly` (custom error 6000) on-chain.
  - **Verification**: `PayPoolsHandler` and `ProgramCrankAdapter` query `this.payout.chainNow()` / `this.chainNow()`, which reads `SYSVAR_CLOCK_PUBKEY` via RPC (`readBigInt64LE(32) * 1000`). Local `ClockPort` is used exclusively for internal database timestamps (`now`), guaranteeing that on-chain submissions never anticipate cluster slot time.
- **Client Timestamps vs Server Timing Invariants**:
  - In `Ride.applyReport`, client telemetry reports (`report.t`, `report.s`) are evaluated against elapsed server wall-clock time (`dt = (now - lastHbAt) / 1000`).
  - Speed jumps exceeding `MAX_SPEED * dt * SPEED_SLACK + SLACK_METRES` immediately fail the ride with `'implausible progress'`.
  - Drive time credit is strictly bounded by `dt * DRIVE_CREDIT_SLACK + DRIVE_CREDIT_SLACK_SECONDS`, preventing client clock acceleration or speed hacks.
  - Heartbeat gaps exceeding `hbTimeoutMs` trigger `'heartbeat lost'`.

### 2.2 RPC Congestion & Timeout Resilience
- **RPC Retry & Fallback Policies**:
  - `SolanaRpc` implements an exponential backoff reader across `[primary, ...SOLANA_RPC_FALLBACKS]`, waiting `250 ms * 2^(i - 1)` between fallback attempts.
  - Read-heavy queries fail over gracefully across secondary endpoints.
  - Writes and sensitive state reads (`primaryOnly`) are correctly restricted to the primary endpoint to prevent reading stale account states from non-indexed or lagging public nodes.
- **Compute Budget & Priority Fee Allocations**:
  - Dynamic prioritization: `FeeEstimator` queries QuickNode's `qn_estimatePriorityFees` (percentiles) with fallback to standard `getRecentPrioritizationFees` over hot accounts, clamped to `[minMicrolamports, maxMicrolamports]` and cached for 10 s.
  - LiteSVM benchmarks empirically validated compute unit consumption:
    - `pay_prize`: Consumes **15,336 CU** (allocated limit: `CU_LIMITS.pay_prize = 22,000`, ~43% buffer).
    - `close_pool`: Consumes **17,043 CU** (allocated limit: `CU_LIMITS.close_pool = 30,000`, ~76% buffer).
    - `record_attestation`: Allocates `CU_LIMITS.record_attestation = 25,000`, which comfortably accommodates account creation (`init_if_needed`), Borsh serialization, and PDA seed derivations.

### 2.3 Dropped Transaction Handling & Idempotency
- **AttestationService Idempotency**:
  - `AttestationService.ensureAttestation` performs an on-chain `isAttested(poolId, driver)` pre-check prior to loading facts or building transactions.
  - If a transaction dropped or the RPC call timed out, subsequent payout attempts re-check `isAttested`. If the transaction landed in the background, it returns `{ attested: true, signature: null }` without re-submitting.
  - If the transaction truly dropped, a fresh transaction with an updated blockhash is signed and broadcast.
- **PayPoolsHandler Prize Settlement**:
  - Implements the conditional claim pattern: `claimSent(poolId, rank, tx.signature, lastValidBlockHeight)`.
  - If a transaction drops or blockhash expires (`transaction_dropped` / `status === 'expired'`), `payouts.release(...)` resets the rank row from `'sent'` back to `'planned'`.
  - If the transaction landed, `signatureStatus` + event log inspection confirms `PrizePaid` and advances the row to `'paid'`.

### 2.4 Race Conditions & Concurrency
- **Simultaneous Ride Finishes**:
  - Handled via `withVersionRetry` around `this.transactions.run`. The player row is locked first (`findByWalletForUpdate`), and `Ride.applyReport` updates the optimistic lock version. Racing `/end` and `/heartbeat` requests serialize cleanly.
  - Global statistics recording (`StatsService.recordRide`) executes atomic increments on the player stats row first, then the global stats row second. Cross-worker deadlocks are impossible because all code paths acquire the driver stats row before the global stats row.
- **Concurrent Attestation Submissions**:
  - `AttestationService` maintains an in-memory `pendingAttestations: Map<string, Promise<AttestationResult>>`. Simultaneous calls for the same `(poolId, driver)` coalesce onto the same in-flight promise, eliminating duplicate on-chain broadcasts within a single node.
- **Concurrent Pledges on the Same Ride**:
  - Concurrent pledges from distinct sponsors succeed in parallel without blocking each other.
  - Duplicate pledges from the same sponsor serialize on the sponsor's player row lock, and PostgreSQL enforces `@@unique([rideId, sponsor])`.

### 2.5 PostgreSQL Concurrency & Lock Ordering
- **Strict Lock Hierarchy**:
  - Every transaction adheres to `Player (findByWalletForUpdate) -> Pool (findByIdForUpdate) -> Tickets/Pledges`.
  - Verified across `CreateRideHandler`, `StartRideHandler`, `EndRideHandler`, `TicketSettlementService`, `PoolTicketsService`, `FinalityService`, and `SweepStaleRidesHandler`.
- **Timeouts & Deadlock Avoidance**:
  - `TransactionPrismaAdapter` configures `{ timeout: 10_000, maxWait: 8_000 }`.
  - Prisma error codes `P2028` (connection acquisition / transaction expiration) map to retryable `ServiceUnavailableError` (503).
  - Code `P2034` (write conflict / deadlock) maps to `VersionConflictError` (409), which triggers automated retry loops in `withVersionRetry`.

---

## 3. Cataloged Findings & Vulnerabilities

### Finding 1: RPC Confirmation Loop Aborts on Transient Status Check Failures
- **Severity**: **Major**
- **Location**: `/Users/ferretrec/work/freightchain-integrity-yield/server/src/infrastructure/solana/signed-sender.ts`, lines 35–45
- **Description**: In `broadcastUntilConfirmed`:
  ```typescript
  for (let n = 0; n < MAX_RESENDS; n++) {
    await rpc.primaryOnly((x) => x.sendRawTransaction(tx.raw, { skipPreflight: true, maxRetries: 0 })).catch(...);
    await wait(RESEND_MS);
    const s = await rpc.primaryOnly(async (x) => (await x.getSignatureStatuses([tx.signature], { searchTransactionHistory: true })).value[0]);
    ...
    if (!s && (await rpc.primaryOnly((x) => x.getBlockHeight(commitment))) > tx.lastValidBlockHeight) { ... }
  }
  ```
  While `sendRawTransaction` catches errors, `getSignatureStatuses` and `getBlockHeight` call `rpc.primaryOnly` without error handling. When the primary RPC drops an HTTP connection, times out (HTTP 504), or returns HTTP 429 during congestion, `primaryOnly` throws `ServiceUnavailableError('Solana RPC unavailable')`. This unhandled exception breaks the loop on attempt `n=0`, completely defeating the purpose of the 60-resend retry loop.
- **Impact**: Server crashes or aborts payout transactions prematurely during cluster congestion when RPC nodes are slow to respond to status queries.
- **Remediation**: Wrap the status check and block height check in `try/catch` within the loop body, logging a debug message and continuing to the next iteration unless the blockhash is confirmed expired.

---

### Finding 2: Unvalidated Settle Pledge & Lack of Optimistic Locking
- **Severity**: **Major**
- **Location**: `/Users/ferretrec/work/freightchain-integrity-yield/server/src/application/use-cases/pledges/settle-pledge/settle-pledge.handler.ts`, lines 26–46
- **Description**: 
  1. `SettlePledgeHandler` accepts optional `signature` and `slot` from the HTTP request body and immediately marks the pledge as settled in PostgreSQL (`pledge.settle(...)`). It does not verify that the signature actually exists on Solana, that it represents a confirmed `settle_pledge` instruction, or that it matches the pledge's parameters. A caller can submit arbitrary bogus strings or `null` to settle pledges in the database.
  2. The handler executes `this.pledges.findById(c.pledgeId, tx)`, which performs a plain `findUnique` without `FOR UPDATE`. If two concurrent settlement requests arrive, both read `settled == false` and overwrite each other (last-write-wins) without an optimistic version check or locking.
- **Impact**: Database pledge settlement can diverge from on-chain truth; concurrent settle requests can corrupt accounting.
- **Remediation**: 
  1. Add optimistic versioning (`version` column) or `SELECT ... FOR UPDATE` on the pledge row.
  2. If an on-chain transaction signature is provided, verify on-chain status via `PoolChainPort` before marking settled, or restrict manual settlement to authorized admin/crank roles while relying on chain event monitoring for player-initiated settlements.

---

### Finding 3: Missing Sponsor Authorization Guard in `PledgesHttpController.create`
- **Severity**: **Major**
- **Location**: `/Users/ferretrec/work/freightchain-integrity-yield/server/src/presentation/economy/pledges.http.controller.ts`, lines 31–36
- **Description**: 
  ```typescript
  @Post('pledges') @HttpCode(200) @UseGuards(PlayerAuthGuard)
  create(@CurrentPlayer() player: PlayerIdentity, @ZodBody(createPledgeBodySchema) body: CreatePledgeBody): Promise<PledgeDto> {
    const sponsor = body.sponsor ?? player.wallet;
    return this.commandBus.execute<CreatePledgeCommand, PledgeDto>(
      new CreatePledgeCommand(sponsor, body.rideId, body.lamportsPerKm, body.targetKm),
    );
  }
  ```
  `createPledgeBodySchema` allows an optional `sponsor` field in the request body. If provided, `body.sponsor` overrides `player.wallet`. A malicious authenticated user can submit requests on behalf of other player wallets, locking their player row during pledge creation and registering unwanted pledge entities under victim addresses.
- **Impact**: Unauthorized pledge registration under third-party wallets.
- **Remediation**: Remove `body.sponsor` or enforce `if (body.sponsor && body.sponsor !== player.wallet) throw new ForbiddenError(...)`.

---

### Finding 4: Orphan Pledges Allowed on Free Rides (`poolId: 0`)
- **Severity**: **Major**
- **Location**: `/Users/ferretrec/work/freightchain-integrity-yield/server/src/application/use-cases/pledges/create-pledge/create-pledge.handler.ts`, lines 49–72
- **Description**: 
  In `CreatePledgeHandler`:
  ```typescript
  if (ride.poolId !== null) {
    const pool = await this.pools.findById(ride.poolId, tx);
    if (!pool || (!pool.isActive && pool.status !== 'open')) {
      throw new ConflictError('pool is not live');
    }
  }
  ...
  poolId: ride.poolId ?? 0,
  ```
  When a user pledges on a free ride (`ride.tier === 'free'`, where `ride.poolId === null`), the handler permits the pledge and sets `poolId: 0`. However, the on-chain Anchor program requires a valid `Pool` account PDA, and `settle_pledge` requires a matching `Attestation` PDA (`seeds = [b"attestation", pool.key(), driver]`). Free rides never have pools or attestations.
- **Impact**: Database contains orphan pledges that can never be created or settled on Solana.
- **Remediation**: Reject pledges on rides where `ride.poolId === null` with `throw new ConflictError('pledges are supported on escrowed pool rides only', 'pool_required')`.

---

### Finding 5: PostgreSQL BIGINT Signed 64-bit Boundary vs Solana u64
- **Severity**: **Minor / Informational**
- **Location**: `/Users/ferretrec/work/freightchain-integrity-yield/server/src/infrastructure/prisma/repositories/pledge.prisma.repository.ts`
- **Description**: 
  Solana smart contracts support `u64` integers up to `18_446_744_073_709_551_615`. PostgreSQL `BIGINT` is signed (`i64::MAX = 9_223_372_036_854_775_807`). As empirically proven in `pledge-repository.adversarial.integration.spec.ts`, storing values $> i64::MAX$ fails with a PostgreSQL numeric overflow error.
- **Impact**: Theoretical only: $i64::MAX$ lamports exceeds 9.2 billion SOL, far greater than total Solana token supply (~500M SOL).
- **Remediation**: Ensure validation schemas clamp `maxLamports` to `i64::MAX`.

---

### Finding 6: In-Flight Attestation Deduplication is Process-Local
- **Severity**: **Minor**
- **Location**: `/Users/ferretrec/work/freightchain-integrity-yield/server/src/application/services/attestation.service.ts`, line 16
- **Description**: `pendingAttestations` is an in-memory `Map`. In a multi-replica server cluster, two independent instances executing payout cycles concurrently can both broadcast `record_attestation` transactions simultaneously. On-chain `init_if_needed` handles this safely, but incurs duplicate transaction fees.
- **Impact**: Minor redundant transaction fees in clustered deployments.
- **Remediation**: Add a short distributed lock (e.g. Redis key `attestation:lock:${poolId}:${driver}`) or a database status marker.

---

### Finding 7: Transient Attestation Drops Set Pool State to 'error'
- **Severity**: **Minor**
- **Location**: `/Users/ferretrec/work/freightchain-integrity-yield/server/src/application/use-cases/chain/pay-pools/pay-pools.handler.ts`, lines 164–169
- **Description**: When `ensureAttestation` encounters a dropped transaction or blockhash expiry, `payRow` catches the error and returns `{ outcome: 'error' }`, causing `payPool` to transition `pool.payoutState` to `'error'`. In contrast, `payPrize` returns `{ outcome: 'wait' }` during blockhash drops and retries on the next pass.
- **Impact**: Spurious `'error'` states logged in administrative dashboards during transient cluster congestion.
- **Remediation**: If `attestError` has error code `'transaction_dropped'` or `'transaction_unconfirmed'`, return `{ outcome: 'wait', note: ... }` instead of `'error'`.

---

## 4. Test Verification Evidence

The following verification suites were executed independently:
1. **Server Concurrency Integration Suite**:
   ```bash
   npx vitest run --config vitest.integration.config.ts test/integration/concurrency.integration.spec.ts
   ```
   **Result**: 42 passed (42 tests), Duration: 7.07s.
   Verified: Simultaneous free ride requests, agreement PUT races, paid orders, daily seed generation, promo code races, payout claim races, ticket voids, webhook vs poll races, drop finality passes, live donation bursts, stale ride sweep races, and statistics aggregation.

2. **Adversarial Pledge Repository Integration Suite**:
   ```bash
   npx vitest run --config vitest.integration.config.ts test/integration/repositories/pledge-repository.adversarial.integration.spec.ts
   ```
   **Result**: 13 passed (13 tests), Duration: 2.65s.
   Empirically confirmed: PK uniqueness, PDA uniqueness, compound `[rideId, sponsor]` uniqueness, foreign keys, BIGINT boundaries, concurrent inserts, and lack of optimistic locking on updates.

3. **Program LiteSVM Unit & Integration Test Suite**:
   ```bash
   cargo test
   ```
   **Result**: 81 passed across 10 test suites (admin rent CU, create & buy, pledge, refunds, series & payout, settle, vault split).

4. **Compute Unit Measurements**:
   ```bash
   cargo test --test admin_rent_cu -- compute_units_are_in_budget --nocapture
   ```
   **Result**:
   - `buy_ticket(first, Ticket init)`: 17,880 CU (limit: 60,000)
   - `refund`: 12,163 CU (limit: 45,000)
   - `pay_prize`: 15,336 CU (limit: 22,000)
   - `close_pool`: 17,043 CU (limit: 30,000)

---

## 5. Next Steps for Remediation
1. Patch `broadcastUntilConfirmed` in `signed-sender.ts` to swallow transient RPC errors during status polling.
2. In `PledgesHttpController.create`, bind `sponsor` strictly to `player.wallet`.
3. In `CreatePledgeHandler`, require `ride.poolId !== null`.
4. In `SettlePledgeHandler`, add optimistic row locking / verification guards.
5. In `PayPoolsHandler`, handle transient attestation drops as retryable `'wait'` states.
