# Milestone M4 Pass 3: System-Wide Audit & Regression Testing Review Log

**Review Date**: 2026-10-12T02:20:00Z  
**Reviewer**: `teamwork_preview_reviewer` (Reviewer & Adversarial Critic)  
**Target Worktree**: `/Users/ferretrec/work/freightchain-integrity-yield` (branch: `feature/onchain-integrity-yield`)  
**Verdict**: **REQUEST_CHANGES**  
**Overall Risk Assessment**: **MEDIUM**

---

## 1. Executive Summary

Milestone M4 Pass 3 executed an exhaustive, adversarial end-to-end audit and regression verification across the entire Freight Chain codebase in `/Users/ferretrec/work/freightchain-integrity-yield`.

### Key Verification Metrics
- **Clean Architecture Boundary Tests**: **5/5 test files passed** (26 tests). 0 layer violations. All production files ≤ 347 lines (limit: 500).
- **Server Typecheck (`tsc --noEmit`)**: **0 errors**.
- **Server Linter (`oxlint --type-aware`)**: **0 errors** (49 warnings across 913 files).
- **Client Headless Simulation (`client:check`)**: **0 errors** (111,202 collision pairs, physics, routes, all green).
- **Media Engine Check (`media:check`)**: **28/28 tests passed**, ESLint 0 errors.
- **Anchor Program Regression (`cargo test`)**: **81/81 tests passed** (10 test suites covering LiteSVM, pledges, attestations, yield, and rent).
- **Server Unit Regression (`npm test`)**: **271/271 test files passed** (1,580 tests).
- **Server Integration Regression (`npm run server:integration`)**: **40/40 test files passed** (445 tests against PostgreSQL `freightchain_test`).
- **Anchor IDL Parity**: Verified deep equality between `programs/freightchain-pools/idl/freightchain_pools.json` and `server/src/infrastructure/solana/pool-program.idl.ts`.
- **Integrity Violation Audit**: **PASSED (0 violations)**. No hardcoded test stubs, no fake verifications, no bypasses detected. Pure RFC 6962 cryptography and Anchor PDA logic implemented from scratch.

### Blocking Issue
- **Landing Regression Test Failure (`landing:test`)**: `test/whitepaper.test.js:156` failed with `AssertionError: 21 !== 17` (`the page says 17 instructions`). This breaks root `npm run check`. The contract evolved to 21 instructions, 18 events, and 30 errors in v3, but the whitepaper and its assertion test remain on v2 numbers.

---

## 2. Review Findings & Cataloged Gaps

### Finding 1 [Major / Regression]: `landing/test/whitepaper.test.js` Contract Desync Breaks `npm run check`
- **Location**: `landing/test/whitepaper.test.js:156-161`, `landing/whitepaper.html:132`
- **Observation**:
  ```bash
  $ npm run landing:test
  ✖ numbers: the production live flags and the program facts the page states (0.980125ms)
    AssertionError [ERR_ASSERTION]: the page says 17 instructions
    21 !== 17
        at TestContext.<anonymous> (landing/test/whitepaper.test.js:160:10)
  ```
  The upgraded Anchor program v3 (`freightchain_pools.json`) contains:
  - Instructions: **21** (added `create_pledge`, `settle_pledge`, `record_attestation`, `record_yield`)
  - Events: **18** (added `AttestationRecorded`, `PledgeCreated`, `PledgeSettled`, `YieldRecorded`)
  - Error Codes: **30** (added `UnverifiedAttestation`, `AttestationMismatch`, `InvalidAttestationStatus`, `ZeroVerifiedKm`, `AlreadySettled`)
  The test asserts `idl.instructions.length === 17`, `idl.events.length === 14`, and `idl.errors.length === 25`, matching the stale text in `landing/whitepaper.html`.
- **Risk**: Root `npm run check` is broken, violating Acceptance Criteria: *"`npm run check` passes across client, server, and landing (0 linter errors, 0 type errors)"*.
- **Remediation**:
  1. In `landing/whitepaper.html`, update contract summary text to `"21 instructions, 18 events, 30 error codes"`.
  2. In `landing/test/whitepaper.test.js`, update expectations to `21 instructions`, `18 events`, `30 error codes`.

---

### Finding 2 [Minor / Performance Risk]: Whitepaper Production Gzip Size Exceeds 28.00 KB Budget
- **Location**: `landing/dist/whitepaper.html` (via `npm --prefix landing run build`)
- **Observation**:
  `dist/whitepaper.html 87.33 kB | gzip: 28.04 kB`.
  PROJECT.md Feature #15 defines: *"Whitepaper Chapters 05 & 06 | Economy/Escrow & Telemetry/Verification updates respecting `<= 28 KB` gzip budget"*.
- **Risk**: Current build already consumes 28.04 kB gzip before Milestone M5 adds Chapters 05 and 06 copy.
- **Remediation**: In M5, minify whitespace, prune redundant tags, or compress HTML attributes to preserve the `< 28 KB` gzip budget.

---

### Finding 3 [Minor / Edge Case]: Zero-Distance Completed Ride Attestation Rounding
- **Location**: `server/src/application/services/attestation.service.ts:66-67`
- **Observation**:
  ```typescript
  const dist = ride.distance || ride.completeDist;
  const verifiedKm = Math.max(1, Math.floor(dist / 1000));
  ```
  If a ride has `dist == 0` (e.g. abnormal abort or 0 meters traveled before completion event), `verifiedKm` rounds up to `1 km`. On-chain, `verified_km > 0` is required for `ATTESTATION_STATUS_VERIFIED`.
- **Risk**: A zero-meter ride could receive 1 km of verified sponsorship reward.
- **Remediation**: In `AttestationService.executeEnsureAttestation`, if `dist < 1000`, either mark status as `ATTESTATION_STATUS_FLAGGED` or reject with `ZeroVerifiedKm`.

---

### Finding 4 [Minor / Conformance]: Base64 vs Hex Seed Commitment Representation
- **Location**: `server/src/domain/economy/pool.entity.ts:34`, `server/prisma/economy/economy.prisma`
- **Observation**:
  In `Pool.fromChain`:
  `resolvedRideSeed = projectRoadSeed(Buffer.from(state.seedCommitment, 'base64'));`
  whereas in raw RPC transactions and `program-crank.adapter.ts`, `seed_commitment` is passed as a 32-byte `Uint8Array`.
- **Remediation**: Standardize `seedCommitment` internal representation and documentation across domain entities and Prisma schemas.

---

## 3. Detailed Audit Matrix

### A. Clean Architecture & Test Pyramid Audit
- **Layer Enforcement (`server/test/architecture/layer-architecture.spec.ts`)**:
  - `domain`: Pure TypeScript, zero external imports except `bs58`. Verified.
  - `application`: Depends on `domain` only; decorates with `@nestjs/common` and `@nestjs/cqrs`. Verified.
  - `infrastructure`: Implements ports; never depends on `presentation`. Verified.
  - `presentation`: Thin controllers only; Zod validation; dispatches commands/queries. Verified.
  - Clock abstraction: No raw `Date.now()`, `new Date()`, or `Math.random()` outside `SystemClock`. Verified.
  - Config abstraction: No raw `process.env` outside `EnvService`. Verified.
  - ESM compliance: All relative imports have `.js` extension. Verified.
- **Line Counts (`line-count-audit.spec.ts`)**:
  - Top files:
    1. `src/domain/rides/ride.entity.ts`: 347 lines (limit 500)
    2. `src/infrastructure/solana/program-chain.adapter.ts`: 266 lines
    3. `src/domain/economy/pool.entity.ts`: 234 lines
    4. `src/domain/road/road-layout.ts`: 228 lines
    All production files stay well within the 500-line limit.
- **Test Pyramid Completeness (`test-pyramid.spec.ts`)**:
  - Every controller, CQRS handler, service, guard, and adapter has its own unit spec: **0 missing**.
  - Every class talking to PostgreSQL has its own integration spec: **0 missing**.

### B. Linters and Typecheck Execution
- `server:typecheck` (`tsc --noEmit`): PASSED (0 errors).
- `server:lint` (`oxlint --type-aware`): PASSED (0 errors, 49 warnings, 913 files).
- `landing:lint` (`eslint`): PASSED (0 errors).
- `landing:build` (`vite build`): PASSED (dist artifacts generated).
- `client:check` (`headless sim + physics check`): PASSED (0 errors).
- `media:check` (`eslint + node:test`): PASSED (28 tests green).

### C. Anchor Program v3 Regression Suite (`cargo test`)
10 test binaries executed on LiteSVM:
1. `src/lib.rs`: 2 passed (bps math & exact splits)
2. `tests/admin_rent_cu.rs`: 9 passed (CU limits, rent rules, discriminators)
3. `tests/create_and_buy.rs`: 10 passed (wallet cap, sold out, deadlines)
4. `tests/export_fixtures.rs`: 1 passed (fixture export)
5. `tests/grace_and_authority.rs`: 9 passed (two-step authority, grace period)
6. `tests/pledge.rs`: 17 passed (proportional settlement, double settlement defense, flagged refund, fuzzer)
7. `tests/refunds.rs`: 10 passed (batch refunds, rent refunding)
8. `tests/series_and_payout.rs`: 10 passed (series scheduling, review window enforcement)
9. `tests/settle.rs`: 11 passed (pay_prize requires attestation, yield recording, overflow safety)
10. `tests/vault_split_table.rs`: 2 passed (table parity)
**Total Rust tests**: 81 passed, 0 failed.

### D. End-to-End Telemetry Playback & Merkle Attestation Consistency
Traced the complete verification and payout pipeline:
```
1. Telemetry Ingestion:
   Client -> POST /api/telemetry -> RideBatch records persisted in PostgreSQL.
2. Ride Adjudication:
   Ride completed -> VerdictService compares telemetry against deterministic road model -> status = 'verified'.
3. Pool Settlement Window:
   Pool payoutAt reached -> PayPoolsHandler executed.
4. Attestation Service:
   AttestationService.ensureAttestation -> calculates RFC 6962 Merkle root:
   SHA-256(0x00 || batch) for leaves, SHA-256(0x01 || left || right) for branches.
   Submits record_attestation instruction to Solana Anchor program.
5. On-Chain Attestation PDA:
   Seeds: [b"attestation", pool.key(), driver.key()]
   Stores telemetry_root [u8; 32], verified_km u32, status = 1 (Verified).
6. Hardened Prize Payout:
   pay_prize strictly validates matching Attestation PDA:
   - status == ATTESTATION_STATUS_VERIFIED (1)
   - verified_km > 0
   - attestation.pool == pool.key()
   - attestation.driver == to.key()
7. Community Pledge Settlement:
   settle_pledge verifies same Attestation PDA:
   earned = max_lamports * min(verified_km, target_km) / target_km
   refund = max_lamports - earned
   Invariant verified: earned + refund == max_lamports (zero lost lamports).
```

### E. IDL Parity Audit
- Checked `programs/freightchain-pools/idl/freightchain_pools.json` against `server/src/infrastructure/solana/pool-program.idl.ts`.
- Verified deep equality with `server/test/unit/infrastructure/solana/pool-program.codec.spec.ts` line 41:
  - Instructions (21): identical names, args, account seeds.
  - Events (18): identical discriminators and layout.
  - Errors (30): identical codes 6000–6029 and messages.

---

## 4. Adversarial Attack Scenarios & Mitigations

| Attack Scenario | Potential Blast Radius | Tested Defense / Outcome | Status |
|-----------------|------------------------|---------------------------|--------|
| **1. Unverified Driver Prize Theft** | Malicious actor invokes `pay_prize` for unverified or flagged run | Anchor `pay_prize` requires valid `Attestation` PDA with `status == 1`; reverts with `UnverifiedAttestation` (6025) | **DEFENDED** |
| **2. Pledge Lamport Leakage via Rounding** | Odd target km or fractional division leaves unclaimable lamports in pledge PDA | Invariant `earned + refund == total_lamports` enforced by `refund = total.checked_sub(earned)`; fuzzer verified 0 stranded lamports | **DEFENDED** |
| **3. Duplicate Pledge Settlement** | Double claim of driver earnings or double refund | `settled: bool` flag asserted in `handle_settle_pledge`; rejects with `AlreadySettled` (6029) | **DEFENDED** |
| **4. Telemetry Merkle Root Collision** | Prepend/extend attack or odd-node duplication attack | RFC 6962 domain separation prefixes (`0x00` leaf, `0x01` branch) and odd-leaf direct promotion eliminate CVE-2012-2459 style collisions | **DEFENDED** |
| **5. Stale / Forged Road Seed** | Rider fabricates favorable road seed for easy driving | Seed derived on-chain / server from `SHA256(poolId \|\| blockhash \|\| slot)` and masked to 31 bits; verifiable by all clients | **DEFENDED** |
| **6. Staking Yield Invariant Breach** | Yield claimed exceeds deposited vault lamports | `handle_record_yield` executes CPI transfer of `yield_earned` lamports into vault before updating `pool.yield_earned` | **DEFENDED** |

---

## 5. Review Conclusion & Next Steps

The system architecture and cryptographic integrity implementation are exceptional, robust, and free of shortcuts or integrity violations. However, because **Finding 1** causes `landing:test` (and consequently `npm run check`) to fail, the formal verdict is **REQUEST_CHANGES**.

### Required Action Items for Gap Resolution:
1. Update `landing/whitepaper.html` and `landing/test/whitepaper.test.js` to match the 21 instructions, 18 events, and 30 errors in the v3 Anchor IDL.
2. Re-run `npm run check` to achieve 100% green validation across client, server, and landing.
3. Once Finding 1 is resolved, proceed to Milestone M5 (Collateral, Whitepaper Chapters 05/06, and Documentation).
