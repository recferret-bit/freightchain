# Security audit 2026-10-28: fix plan

Source: SolSwarm report `~/work/SolSwarm/reports/2026-10-28-182903-freightchain/` (`findings-and-scores.json`, `verified-safe.json`, `auditors/*.md`).
Audited commit `b500a3a89d09` (current `main` HEAD on 29 Oct). Auditors: Claude (S1 auth, S5 deps), Grok (S2 input, S6 client), AGY/Gemini (S3 logic), Codex (S4 config). The other three cross-checked each finding.

## 1. Summary

- **29 clusters: 2 high, 10 medium, 14 low, 3 info.** They reduce to **19 work items** (SEC-01 … SEC-19). Many clusters are duplicates: the public-ride JSON leak appears 3×, the Solana Pay wallet-prefix oracle 4×, CDN-without-SRI 2× and the promo oracle 2×.
- **Both "high" findings came back PARTIAL from the cross-check.** Reviewers rated them low/medium. The real top risk is **SEC-01 (pool payout misranking)**: verdict changes are not mirrored into `stats.RideResult`, and a top-20 pre-cut by distance can drop the fastest finisher. **SEC-02 (TEN4 burn signature replay)** comes next.
- **No finding was found in either on-chain program.** All 36 Rust files of `freightchain_pools` and `freightchain_honk` were read. Authority split, seal-slot seed, Merkle winners + `paid_mask`, escape hatches, fixed TEN4 supply and PDA caps are recorded as holding in `verified-safe.json`.
- **The report state is `incomplete`.** The sandbox did not see the npm lockfiles that `git` tracks (so `npm install` never ran, `vitest: not found`). The pools LiteSVM tests did not compile because the fixture `backend/server/test/fixtures/chain/vault-split-cases.json` was missing from the snapshot. `solana-verify` was not run. Only the `freightchain_honk` tests passed (9 unit + 32 LiteSVM). The AGY S3 worker exited 1, but its findings were cross-checked. **Every result is a source read, not an executed test.**
- **Production exposure today** (`infra/deploy/.env` sets none of `TELEMETRY_V21`, `MINIGAMES` or `HONK_PROGRAM_ID`, so code defaults apply): SEC-14 is dormant (minigames off) and SEC-02 is dormant (TEN4 chain mode off). SEC-15 is live (telemetry v1). SEC-01/05 go live with the first paid pool payout. The privacy and header items (SEC-04, 07–13) are live now. Note that `VERDICT_ENFORCE=false` is the production default (`PRODUCT.md`): boards and badges ignore a reject, and machine-rejected paid rides stay under review until an admin decides. A *verified* bot (SEC-15) is the case with no human in the loop.

## 2. How many Solana issues

| scope | clusters | deduped items |
|---|---|---|
| **On-chain programs (Rust / Anchor)** | **0** | **0** |
| Server / client code on Solana money flows | 10, 11, 12, 4, 19, 28, 5, 7, 17, 14 (Solana Pay part) | SEC-01, 02, 05, 06, 07, 09 |
| Solana toolchain / keys | 24, 22, 16 | SEC-17 (Anchor part), SEC-18, SEC-19 |
| **Total touching Solana** | **13 of 29** | **9 of 19** |

Two of these can move value wrongly: **SEC-01** (wrong `commit_winners` set) and **SEC-02** (one burn signature reused). SEC-05 and SEC-06 harden the payout pipeline. The rest are privacy, supply-chain or hygiene items.

## 3. Priority order

| # | item | clusters | report → consensus sev. | Solana | live in prod | decided (29 Oct, §4) |
|---|---|---|---|---|---|---|
| 1 | SEC-01 Pool ranking: stale RideResult, top-20 pre-cut | 10 | high → medium/high | yes | first payout | best single ride; formula v2 for new pools |
| 2 | SEC-02 TEN4 burn signature replay + visual desync | 12 | medium → medium | yes | no (chain off) | preflight + balance hold with TTL |
| 3 | SEC-03 Admin approver never signs; request sig opt-in | 1 | medium → medium | – | yes | approvals + moderation sign; Redis fail closed |
| 4 | SEC-04 Public ride JSON bypasses replay gate (+ denial codes, pledge reads) | 15, 25, 14, 8 | medium → medium | – | yes | – |
| 5 | SEC-05 Payout plan written before validation gate | 11 | medium → low/medium | yes | first payout | – |
| 6 | SEC-06 Payout tx builder on the player plane | 4 | low → low | yes | yes | – |
| 7 | SEC-07 web3.js / three.js from jsDelivr without SRI | 19, 28 | medium → low/medium | yes | yes | vendor into repo |
| 8 | SEC-08 No CSP / frame-ancestors / HSTS / Referrer-Policy | 27 | low → low | – | check edge | – |
| 9 | SEC-09 Solana Pay wallet-prefix oracle | 5, 7, 17, 14 | low/info → low | yes | yes | – |
| 10 | SEC-10 Player logout does not revoke the JWT | 3 | low → low | – | yes | Redis fail open + alert |
| 11 | SEC-11 Admin nonce decoy is deterministic | 2 | low → low | – | yes | – |
| 12 | SEC-12 Promo code existence oracle | 18, 29 | low → low | – | yes | – |
| 13 | SEC-13 Live feed returns full wallets | 26 | low → low | – | yes | shorten |
| 14 | SEC-14 Minigame plumbing: unwired results, fake MAC, unlocked sync | 9, 13 | high/medium → low/medium | – | no (off) | fix plumbing now; rules in MG-V2 |
| 15 | SEC-15 Headless rides eligible under default telemetry | 6 | medium → medium (design) | – | yes | telemetry v2 enforce + mandatory minigames (MG-V2) |
| 16 | SEC-16 Container: dev deps in runtime, tag pins, landing install scripts | 20, 21 | low → low | – | yes | – |
| 17 | SEC-17 Unpinned `npx eslint/esbuild`; Anchor CLI unpinned | 23, 24 | low/info → low | Anchor | dev/CI | root workspace pins |
| 18 | SEC-18 RustSec advisories in programs `Cargo.lock` | 22 | info → info | yes | no | – |
| 19 | SEC-19 Dev treasury key in the audit snapshot | 16 | low → low | yes | no | – |
| – | **MG-V2** Mandatory minigames, timers, real fuel (feature, own plan) | 6, 9 | – | – | no | §6 |

**Execution order, lanes and status live in [`SECURITY_MG2_ORCHESTRATOR.md`](SECURITY_MG2_ORCHESTRATOR.md)** (it supersedes the lane sketch below).

Suggested lanes: **A (pool money):** SEC-01 → SEC-05 → SEC-06. **B (TEN4):** SEC-02. **C (auth/privacy):** SEC-03, 04, 09, 10, 11, 12, 13. **D (client/supply chain):** SEC-07 → SEC-08, then 16, 17. **E (anti-bot):** SEC-15 (telemetry v2, devnet soak) → SEC-14 (needs the v2 session key for its HMAC) → MG-V2. SEC-18/19 are bookkeeping.

## 4. Owner decisions (answered 29 Oct)

1. **SEC-01 ranking:** best single verified ride by effective time across **all** eligible wallets of the pool, then the top 20. Finishers rank first; non-finishers follow, ordered by distance. This is `rankRideResults` as written.
2. **SEC-01 rollout (POOL-M-13):** bump `SCORE_FORMULA_VERSION` to 2 and stamp it on pools that open after the release. Pools already open keep v1 until they close. Ship to devnet first, then production. **v2 has no minigame time:** passing every minigame is mandatory, and a failure rejects the ride instead of adding seconds (decision 9).
3. **SEC-02:** a preflight check before the wallet signs `buy_part`, plus a **balance hold with a TTL** (about 10 min) taken under the player lock. The confirmed `buy_part` consumes the hold; an expired hold is released. No clamping.
4. **SEC-03:** the approver signs an intent bound to the proposal id + payload hash. Chat hide/ban, `pools/rules` and `config` also need a proof. Other admin routes stay cookie + header. The nonce/replay set moves to Redis. **If Redis is down, signed admin mutations fail closed with 503**; reads still work, and an emergency pool hold remains possible on-chain with the cold authority.
5. **SEC-07:** vendor `three@0.160.0` and `@solana/web3.js@1.99.0` into `frontend/client/vendor/` with recorded sha384. There is still no build step. Update the AGENTS.md CDN line.
6. **SEC-10:** a player `jti` deny-list in Redis. **If Redis is down, player requests fail open and an alert is logged.**
7. **SEC-13:** shorten the wallets on `/api/live` (plus the SNS name when one exists).
8. **SEC-14:** fix the minigame plumbing in this round (lock race, real HMAC, results reach the verdict). The new rules belong to the separate **MG-V2** project (§6).
9. **SEC-15 / MG-V2 anti-bot rule:**
   - Paid/ranked rides require telemetry v2 (`TELEMETRY_V21=enforce`, protocol 2 + session MAC).
   - **A rider must pass every minigame received during the ride.** Any failure rejects the ride at the end (`mg-failed`, which includes the "none passed" case). Failures are: 3 wrong codes, or the on-screen timer running out. The ride itself continues.
   - Paid rides go to admin review (an admin can override) and can be appealed.
   - The timer starts when the phone buzzes. Each kind has its own window, set as a `GameSetting` row through the signed admin API; the `more-time` mode doubles it.
   - The gas station task is triggered by **real fuel burn** in the shared physics.
10. **SEC-17:** exact `eslint`/`esbuild` versions as **root workspace** devDependencies (root lockfile). The client calls them with `npx --no-install`, so `frontend/client` keeps zero dependencies.

**Grill findings folded into the plan (no decision needed):**
- **Spec conflicts.** `docs/spec/minigames.md` MGM-M-05/06 says "a minigame never fails the ride", a miss adds no time, and an unopened task is cancelled. Decision 9 reverses all three. Record it now as a **target decision** in `minigames.md` + `anticheat.md`; as-built text changes only when MG-V2 ships (Specs rule).
- **Code/spec mismatch.** `pool-ranking.ts` has `MG_MISSED_SECONDS = 45`, while MGM-M-06 says 0. Formula v2 sets both minigame weights to 0. v1 stays frozen for pools still open.
- **Ordering.** A real minigame HMAC needs the per-ride session key, which exists only when `TELEMETRY_V21` ≠ off. So SEC-15 (v2 telemetry) lands before or with SEC-14.
- **Residual risk.** The spec admits that an OCR/multimodal bot can solve phone-SMS. Mandatory minigames stop scripted bots, not vision-model bots. The manual top-20 review (POOL-M-07) stays the last line.
- **Tier coverage.** Minigames apply only to `1h` (MGM-M-01); `4h`/`8h` are `onSale: false`. If those tiers go on sale, MG-V2 must cover them first.
- **Server road coverage.** GULP bays are client landmarks today (`themes/_shared/landmarks`, `site(ci)`). The server cannot judge a gas task until bay placement is ported to the server road (MG-V2).

## 5. Common DoR / DoD (apply to every item)

**DoR (common):** the owner decision above is recorded in the item; the cited lines are re-read on the current `main` (the audit commit is `b500a3a89d09`); the topic doc is read (`docs/agents/<topic>.md` / `docs/spec/<topic>.md`); work happens in its own worktree (other sessions share the checkout).

**DoD (common):**
- `npm run check` is green. Server items also need `npm run server:integration` on `freightchain_test`. Client items need `node tools/e2e-chrome.mjs` (in `frontend/client/`, own URL), with the screenshots read.
- Pyramid: every changed handler, guard, service or adapter has a unit spec. Every PostgreSQL class has an integration spec. New behaviour has an HTTP scenario. A new critical section has a concurrency test. A Prisma change ships with a forward-only migration in the same commit.
- A behaviour change updates `docs/spec/PRODUCT.md` and the topic spec. A path or route change updates the maps (AGENTS.md "Maps stay current").
- The SolSwarm cluster IDs are named in the commit message. No deploy; report "ready, `npm run deploy` would ship it".

---

## SEC-01 — Pool payout ranking: stale `RideResult`, deadline-blind read, top-20 pre-cut
**Clusters:** 10 · **Solana:** yes (feeds `commit_winners` / `pay_prize`) · **Files:** `application/services/verdict.service.ts:312-372`, `application/use-cases/chain/pay-pools/pay-pools.handler.ts:226-232`, `use-cases/pools/get-payout-transactions/get-payout-transactions.handler.ts:53`, `domain/pool/pool-ranking.ts`, `infrastructure/stats/prisma-ride-result.repository.ts:83`

**Analysis.**
- `stats.RideResult` is upserted only by `VerdictService.judge`. `override()` and `addAttention()` change the live verdict but leave `RideResult.verdictTier` stale. `orderWalletsByResults` trusts that stored tier, so an admin-approved ride (flagged→verified) sorts below machine-verified finishers.
- `listByPool` has no `endedAt <= playDeadline` or current-verdict join. The base query does filter both, so a wallet whose only rides are rejected or late is not admitted. A stale or late row can still set the effective time of a wallet that is in the set through another ride.
- `rankedWallets` takes `poolRanking(poolId, TOP20_SIZE)` by `SUM(lastS)` and only then reorders by effective time. With more than 20 verified wallets, a fast single-ride finisher who is outside the distance top 20 is never paid.
- Codex, Claude and Grok all confirm the defect. Grok rates it high.

**Fix steps.**
1. Make the read authoritative. `listByPool` joins `ride.Ride` + `economy.Pool` + `verdict.RideVerdict` and returns only rows with `endedAt <= playDeadline` and current `status = 'verified'`. The tier is read from the live verdict, not from `RideResult.verdictTier`.
2. Also refresh `RideResult.verdictTier` in `override()` and `addAttention()` inside the same `tx`, so stats and boards agree.
3. Remove the pre-cut. Rank all eligible verified wallets of the pool by their best single ride (`rankRideResults`), then `slice(0, TOP20_SIZE)`. Apply the same change in `GetPayoutTransactionsHandler`, ideally through one shared `rankPoolWallets()`.
4. Formula v2 (decision §4.2):
   - `SCORE_FORMULA_VERSION = 2` with both minigame weights at 0.
   - Stamp the version on the pool at creation. If `economy.Pool` has no column for it, add one with a migration; existing pools default to 1.
   - `rankRideResults(rows, pool.scoreFormulaVersion)` keeps v1 for pools opened before the release.
5. Add a one-off reconcile script that rebuilds `verdictTier` for existing rows (dry run by default) and run it against local/devnet.
6. `planDrift` must use the new ranking, so an existing uncommitted plan is re-checked.

**DoR.** Decisions §4.1–4.2 recorded in `docs/spec/pool.md` (POOL-M-13: formula v2 published, effective from pools opened after the release). The `poolRanking` callers are listed (pay-pools, get-payout-transactions, public standings). Read the `docs/spec/pool.md` "Before the winners root is committed" section. Check whether any devnet pool is currently open (it keeps v1).

**DoD.**
- Unit specs for `orderWalletsByResults` / `rankPoolWallets`: an admin-approved former flag ranks by effective time; a late ride and a rejected ride are ignored; 25 wallets where the fastest has the least distance → that wallet is in the top 20.
- Integration spec for `listByPool` (deadline + current verdict) and for `override`/`addAttention` updating `RideResult` in the same tx.
- HTTP scenario: override a verdict → `GET /api/pools/:id/payout` order changes.
- `npm run test:e2e:block2` and the `localnet-e2e` winners-root payout pass with exact prizes.
- `docs/spec/pool.md`, `PRODUCT.md` and `docs/tech/escrow-open-items.md` updated.

## SEC-02 — TEN4: burn signature reusable; visual unlock after an irreversible `buy_part`
**Clusters:** 12 · **Solana:** yes · **Files:** `application/use-cases/honk/honk.handlers.ts:66-127`, `honk-chain.ts:7`, `domain/honk/chain-tx.ts:30`, `prisma/economy/economy.prisma:338` (`HonkBurn`), `:350` (`HonkVisual`)

**Analysis.**
- With `HONK_PROGRAM_ID` set, `requireHonkBurn` checks that the tx is signed by the wallet and burns exactly the amount. The signature is never stored, and `HonkBurn` has no signature column. So one confirmed 1-TEN4 on-chain burn backs many `BurnHonk` calls, limited only by `STREAM_BURN_GAP_MS` per ride.
- Each call still debits the off-chain balance. The gain is keeping on-chain TEN4 that should have been burned, which desyncs the two ledgers. No off-chain funds are created.
- Second half: `MintHonkVisualHandler` verifies an already-confirmed `buy_part` (TEN4 burned, Part NFT frozen) and only then debits the off-chain balance. A wallet with on-chain TEN4 only is refused after its tokens are gone. It can retry later with the same signature, because a failed debit does not store it.
- Dormant in prod: `HONK_PROGRAM_ID` is unset.

**Fix steps.**
1. Add a migration: `HonkBurn.chainSignature String? @unique`, and `@unique` on `HonkVisual.chainSignature` if it is not already unique. `insertBurn` stores the signature. A duplicate becomes a `409 signature_used`, checked inside the same player-locked tx (`findByWalletForUpdate`).
2. Bind the burn to its purpose. The ride id or memo must be in the tx, or `ref` must be checked, so a burn for ride A cannot pay for ride B.
3. Visual (decision §4.3):
   - Add `POST /api/honk/visual/hold`. Under the player lock it checks the off-chain balance and writes a hold (wallet, item, price, `expiresAt` = now + `HONK_HOLD_TTL`) that reduces the spendable balance. A short balance returns 409, so the wallet is never asked to sign.
   - `MintHonkVisualHandler` consumes the matching hold with the confirmed `buy_part` signature.
   - A sweeper releases expired holds. All balance reads subtract live holds.
   - The TTL is a `GameSetting` row (runtime knob), not env.
4. Client (`site/honk-sign.js`): take the hold before building the tx, and show "hold expired, try again" if it lapsed.

**DoR.** Decision §4.3 made. Read `docs/spec/ten4.md` + `docs/agents/ten4-localnet.md`. Confirm no historical rows need a backfill (the column is nullable). List every reader of the TEN4 balance (garage, burn, stream, swap UI), since all of them must subtract holds.

**DoD.**
- Migration in the same commit.
- Integration spec: the same signature twice → the second is refused.
- **Concurrency tests:**
  - two parallel `BurnHonk` calls with one signature → exactly one succeeds;
  - a hold racing a spend in another tab → never a negative balance;
  - two holds on the same balance → the second gets 409.
- Integration spec for the hold sweeper.
- Unit specs for both handlers.
- HTTP scenario for the 409.
- `bash .claude/skills/honk-suite/run.sh` and `honk-localnet` pass.
- `docs/spec/ten4.md` and `PRODUCT.md` updated.

## SEC-03 — Admin: approver never signs; per-request signature is opt-in
**Clusters:** 1 · **Files:** `infrastructure/http/guards/privileged-surface.guard.ts:80-83`, `presentation/admin/admin-moderation.http.controller.ts:26-61`, `use-cases/admin/approve-proposal/approve-admin-proposal.handler.ts:25-30`, `application/services/admin-approval.service.ts:48`

**Analysis.**
- `requireAdminSig` runs only if a sig, nonce or ts header is present. Without them, the `fc_admin` cookie + `X-FC-Admin: 1` pass.
- `POST /api/admin/proposals/:id/approve` checks only that the approver is a different wallet and that the proposal is pending and not expired. So a stolen admin session of a second admin completes four-eyes.
- Chat hide, chat ban, `pools/rules` and `config` need no proof either.
- Money handlers still verify the proposer's stored `AdminProof`. Host, IP allowlist and basic auth still apply.
- The nonce replay set is in-memory, so it is per instance.

**Fix steps.**
1. Add an `AdminProofService` intent `proposal_approve {proposalId, payloadHash}`. `admin.js` asks the approver's wallet to sign it, and `approve()` verifies it.
2. Require an intent-bound proof on chat hide, chat ban, `pools/rules` and `config` (decision §4.4). Other admin routes stay cookie + `X-FC-Admin`.
3. Move the nonce replay set to Redis (`SET NX` + TTL). If Redis is down in production, signed mutations return `503` and read-only routes keep working (decision §4.4).
4. Update `admin.js` to sign these actions and to show the 503 clearly. Run the `admin-coverage` skill.

**DoR.** Decision §4.4. Read `docs/agents/admin-ops.md` + `docs/spec/platform_services.md` (privileged surface). Confirm Redis is wired to the app process in production compose. Write the "Redis down → use the cold authority on-chain for an emergency hold" step into the `admin-ops.md` runbook.

**DoD.**
- `privileged-surface.guard.spec.ts`:
  - no signature on a covered route → 403;
  - a replayed nonce → 403 across two guard instances sharing Redis;
  - Redis down → 503 on a signed mutation and 200 on a GET.
- HTTP scenario: approve without a proof → 403; with the approver's proof → 200 and audited.
- The admin page is checked in Chrome (approve flow with a fake wallet).
- `admin-coverage` is green.
- `docs/agents/admin-ops.md` and `PRODUCT.md` updated.

## SEC-04 — `GET /api/rides/:id/public` bypasses the replay gate (+ denial-code oracle, pledge reads)
**Clusters:** 15, 25, 14 (parts 1–2), 8 · **Files:** `presentation/rides/public-rides.http.controller.ts:27`, `use-cases/rides/get-public-ride/get-public-ride.handler.ts:18-40`, `domain/rides/public-ride.dto.ts:54-75`, `presentation/common/response/wire.ts:75`, `application/live/replay-access.service.ts:22-28`, `domain/live/replay-visibility.ts:26-31`, `presentation/economy/pledges.http.controller.ts:42`

**Analysis.**
- The handler only checks that the ride exists. It returns `seed`, `fullWallet`, `status`, the free-text `reason`, progress and verdict reason codes for any ride: created/running, guest/training, rejected and pre-payout pool rides.
- Watch, road, card, blink and the HTML receipt all apply `replayDenial`. The hole plan is a pure function of the seed (`RoadPlan.forSeed`).
- Mitigations: every ticket holder already gets the shared pool seed with their own ride, and in-progress ids are not listed on `/api/live`.
- Codex shows that `paymentSignature` is normally `null` on this path.
- Cluster 8: the gate itself returns three distinguishable 404 codes (`not_found` / `replay_not_available` / `replay_locked_until_payout`).
- Pledge reads (`GET /api/rides/:id/pledges`, `/api/pledges/:id`) are ungated, but the pledge data is on-chain anyway, so this part is weak.

**Fix steps.**
1. `GetPublicRideHandler` calls `ReplayAccessService.requireWatchable(rideId, caller)`. The caller is the optional session, so the owner exception still works. Hidden rides return the same 404 as missing ones.
2. Minimize the DTO: drop `fullWallet`, `paymentSignature` and the free-text `reason`. Return `seed` only when the gate opens. Update `publicRideResponse` in `wire.ts`.
3. Make all public denials one `not_found` code and message (cluster 8). The driver's "locked until payout" state moves to an authenticated driver route.
4. Pledge reads: return only pledges of watchable rides, or accept them as public on-chain data and record that in `docs/spec/pool.md`.
5. Check the client callers (`r.html`, lobby, viewer) for fields they relied on.

**DoR.** List the consumers of `/api/rides/:id/public` (`grep` client + landing). Read `docs/spec/replays_streams.md` replay visibility.

**DoD.**
- HTTP scenarios: created, running, guest/training, rejected and pre-payout pool rides → uniform 404; post-payout → 200 without `fullWallet`; owner → 200.
- Replace the existing permissive expectations.
- Run the `replay-test` and `live-board-test` skills. The receipt page `r.html` is checked in Chrome.
- `docs/spec/replays_streams.md` and `PRODUCT.md` updated.

## SEC-05 — Payout plan persisted before the validation/appeals gate
**Clusters:** 11 · **Solana:** yes (payout pipeline) · **Files:** `pay-pools.handler.ts:114-146`, `domain/economy/pool-schedule.ts:109`, `ride-query.prisma.repository.ts:156` (`forRejudge`), `get-payout-transactions.handler.ts:45`

**Analysis.**
- After `playDeadline`, `payPool` runs `markPool` once and writes `PoolPayout` rows. Only then does `commitBlockReason` check `validationUntil`, running rides and open appeals.
- Once rows exist, later passes skip `markPool`, `forRejudge` excludes the pool (so batch re-judge is off for the 36 h validation window), and public standings show `final` from `plan.length > 0`.
- Mitigations: `poolUnreviewed` is re-checked every pass, `planDrift` discards a drifted uncommitted plan, nothing is committed before `validationUntil`, and admin `override()` still works.
- The manual builder also lacks the validation/appeal/running gate.
- The audit's step 2 (an upheld appeal auto-overrides the verdict) is a separate product change. It is out of scope unless the owner asks.

**Fix steps.**
1. In `payPool` and `GetPayoutTransactionsHandler`, check `appeals.blockers()` and `commitBlockReason()` **before** `markPool` and before `plan()`.
2. Re-run `markPool` on every pass until commit (it is idempotent: it marks, never clears).
3. Public standings show `final` only after `commit_winners` is confirmed, not when the plan exists.
4. `forRejudge` excludes only pools with a committed root.

**DoR.** SEC-01 merged (same file, same ranking). Read `docs/spec/pool.md` POOL-M-07 and the appeals text.

**DoD.**
- Unit specs for `payPool` gate order: during the validation window → no plan rows; after it → plan + commit.
- Integration spec for `forRejudge`.
- HTTP scenario: standings not `final` before commit.
- `npm run test:e2e:block2` and `localnet-e2e` payout pass.
- `docs/spec/pool.md` and `escrow-open-items.md` updated.

## SEC-06 — Payout transaction builder served on the player plane
**Clusters:** 4 · **Solana:** yes · **Files:** `presentation/economy/pools.http.controller.ts:79-83`, `get-payout-transactions.handler.ts:40,67-88`

**Analysis.**
- `GET /api/pools/:id/payout` sits behind `PlayerAuthGuard` + `TermsGuard` and only checks that the 7-day player session belongs to the treasury wallet. It skips the admin host, IP allowlist, short admin JWT, `jti` revocation and audit.
- No key is returned, and every tx still needs the treasury signature. Pre-commit rank secrecy is overstated: standings are public.
- The risk is an authority function reachable with a leaked player session.

**Fix steps.**
1. Move the route to `/api/admin/pools/:id/payout` with `AdminGuard` + `@Roles('admin')` and audit the read.
2. Update the operator tooling and client that call it (`grep payout` in `site/`, `scripts/`).
3. Return 404 on the old route.

**DoR.** List the callers (admin page, `pool:payout` scripts, runbooks in `docs/plan/DEVNET_PRESEASON.md` Part II).

**DoD.**
- Route spec on the admin plane (host, role); the old route → 404.
- `admin-coverage` is green.
- `localnet-e2e` payout uses the new route.
- Maps updated (route path): `docs/spec/pool.md`, `docs/agents/admin-ops.md`.

## SEC-07 — `@solana/web3.js` and three.js from jsDelivr without integrity
**Clusters:** 19, 28 · **Solana:** yes (the library builds the tx before the wallet signs) · **Files:** `frontend/client/site/pay.js:11-36`, `site/honk-sign.js:6-40`, `play.html:32`, `viewer.html:79`

**Analysis.**
- Versions are pinned in the URL (`web3.js@1.99.0`, `three@0.160.0`), but content is not.
- `honk-sign.js` builds the whole TEN4 tx (PDAs, ATAs, serialize) with the CDN library. `pay.js` re-parses server bytes for legacy injected wallets.
- A substituted script runs on the game origin. It can call credentialed fetch and drive the connected wallet. httpOnly cookies stay unreadable.
- Exploiting this needs a CDN or package compromise.

**Fix steps.**
1. Vendor the `web3.js` 1.99.0 IIFE and the `three` 0.160.0 module files (including any `examples/jsm` addons the import map uses) into `frontend/client/vendor/`, with recorded sha384 in `vendor/HASHES`. Serve them from the game origin and point the import maps and dynamic loaders at them. No build step is needed (decision §4.5).
2. Fetch the files once from the npm tarball, not from jsDelivr, and check them against the npm `integrity` field.
3. Prefer the Wallet Standard path, passing the server-built wire bytes so nothing is rebuilt client-side. Keep the legacy re-parse only as a fallback.
4. Add a check that fails `npm run check` if a vendored file's hash differs from `vendor/HASHES`.
5. Set cache headers for `/vendor/*` (immutable, long max-age) in `static-cache.ts` and nginx.

**DoR.** Decision §4.5. List every page and import map that loads three.js or web3.js (play, viewer, lobby, admin, `r.html`, blink, storybook). AGENTS.md / `docs/agents/client.md` text about "three.js from a CDN" is ready to change.

**DoD.**
- `npm run check` with the hash check.
- `node tools/e2e-chrome.mjs` screenshots look the same.
- `localnet-e2e` lobby ticket buy (fake Phantom) passes, and `honk-localnet` passes.
- Maps updated: README, AGENTS.md, CLAUDE.md lines naming the CDN, `docs/agents/client.md`.

## SEC-08 — No CSP, frame-ancestors, HSTS or Referrer-Policy
**Clusters:** 27 · **Files:** `backend/server/src/app/configure-app.ts:23`, `infrastructure/http/static-cache.ts:17`, `infra/deploy/scripts/remote/setup.sh:39-104`, nginx templates

**Analysis.**
- Neither the app nor the nginx snippets in the tree set these headers. The real edge templates were not in the snapshot, so production may differ.
- No XSS sink was found. The wallet popup limits clickjacking.
- This is defense in depth that becomes worth doing after SEC-07 (`script-src 'self'`).

**Fix steps.**
1. Emit on HTML responses: `Content-Security-Policy` with `script-src 'self'` (plus hashes for inline import maps), `frame-ancestors 'none'` (or the blink host list), and `Referrer-Policy: strict-origin-when-cross-origin`.
2. Set HSTS on the HTTPS vhost in the nginx templates.
3. Start with `Content-Security-Policy-Report-Only` for a week, then enforce.

**DoR.** SEC-07 done. Read the production headers read-only (`curl -I` on the public hosts). List the hosts that frame pages (blinks/Dialect).

**DoD.**
- Unit spec for the header middleware.
- `test:production:local` and all 31 Chrome suites pass (`bash .claude/skills/run-tests/e2e.sh`) with no CSP console errors.
- `docs/agents/deploy.md` and `docs/agents/repo.md` updated.

## SEC-09 — Solana Pay mismatch reveals the owner wallet prefix/suffix
**Clusters:** 5, 7, 17, 14 (part 3) · **Solana:** yes · **Files:** `presentation/solana-pay/solana-pay.http.controller.ts:11-50`, `use-cases/solana-pay/solana-pay.handler.ts:24,37-51`, `infrastructure/http/filters/problem-details.filter.ts:36`

**Analysis.** On an unauthenticated cross-origin POST with a known ride, order or donation UUID and a different account, the response is `wrong_account` with `XXXX…YYYY` of the owner. A missing id gives a plain `not_found`. UUIDs are not enumerable, so this only matters for shared or logged links.

**Fix steps.**
1. Return one `not_found` code and message for missing and for wrong account.
2. Show the "use wallet XXXX…" hint only on the authenticated page that rendered the QR (it already knows the owner).

**DoR.** Check what the Solana Pay wallets display for the error (`message`).

**DoD.**
- Handler unit spec + HTTP scenario: missing and wrong-account bodies are byte-equal.
- `e2e-blinks` / Solana Pay tests updated.
- `docs/agents/server.md` (Solana Actions) updated.

## SEC-10 — Player logout does not revoke the 7-day JWT
**Clusters:** 3 · **Files:** `use-cases/auth/logout/logout.handler.ts:4-9`, `infrastructure/http/guards/player-auth.guard.ts:25`, `infrastructure/auth/jose.token-signer.ts:40`, `use-cases/auth/phone-pair/phone-pair.handler.ts:42`

**Analysis.**
- Logout only clears the cookie. The JWT carries a `jti`, but nothing checks it. Admin and editor logout already write `revoked:jti`.
- Phone pairing hands the same JWT to the desktop, so logging out on one device leaves the copy alive.

**Fix steps.**
1. On logout, write `revoked:jti:<jti>` with TTL = remaining lifetime.
2. `PlayerAuthGuard` / `sessionWallet` checks it. Reuse the admin revocation port.
3. Phone pair mints a fresh token for the desktop.
4. Optionally shorten the TTL and add sliding renewal.

**DoR.** Decision §4.6: Redis down → skip the check, log `error` with a stable tag for alerting, and keep serving. Read `docs/agents/server.md` sessions.

**DoD.**
- Guard unit spec: a revoked jti → 401; Redis down → request passes and the alert log line is emitted.
- HTTP scenario: logout, then reuse the token → 401; a paired device keeps its own token.
- Lobby Chrome sign-in/out passes.

## SEC-11 — Admin nonce decoy is deterministic, so admin wallets can be detected
**Clusters:** 2 · **Files:** `use-cases/admin/request-admin-challenge/request-admin-challenge.handler.ts:31-42`

**Analysis.** Non-admins get `sha256(fc-admin-dummy:wallet:clientId)` (stable across calls). Admins get `entropy.hex(16)`. Two calls tell them apart. The route is reachable only past the admin host, IP allowlist and basic auth.

**Fix steps.** Use `this.entropy.hex(NONCE_BYTES)` for the decoy too. Optionally store a throwaway challenge so timing matches. Fix the stale controller comment ("404 unless admin").

**DoR.** None beyond the common DoR.

**DoD.** Unit spec: a non-admin wallet gets different nonces on two calls, with the same shape as an admin's.

## SEC-12 — Promo redeem reveals code existence and lifecycle
**Clusters:** 18, 29 · **Files:** `use-cases/players/redeem-promo/redeem-promo.handler.ts:47-94`, `domain/economy/promo-code.entity.ts:76-93`

**Analysis.**
- An unknown code returns 404 `no such promo code`. An existing code returns 409 with a state-specific detail (not active yet, expired, disabled, exhausted, already redeemed, retired, cap, no open pool). Codes can be 3 characters, and the throttle is 30/min per IP.
- Signed-in non-guests only. The redemption cap itself is sound.

**Fix steps.**
1. Return one status/code/message for "cannot redeem" (unknown or unavailable).
2. Keep `already redeemed by you` only if the product needs it. It reveals nothing new to the owner.
3. Log the specific reason server-side.
4. Add an admin hint recommending ≥ 8-character random codes for limited grants.

**DoR.** Check the lobby UI copy that maps these codes (EN/RU).

**DoD.**
- Handler spec + HTTP scenario with uniform bodies.
- The promo transactional-cap tests still pass.
- Lobby Chrome promo flow passes.
- `docs/spec/promocodes.md` and `PRODUCT.md` updated.

## SEC-13 — Public live feed returns full wallets
**Clusters:** 26 · **Files:** `use-cases/lobby/get-live/get-live.handler.ts:40-41`, `domain/lobby/lobby.dto.ts:46-63`

**Analysis.** `GET /api/live` returns the full base58 wallet for upcoming paid rides and recent finishes (with ride id). `PublicRideDto` already shortens it. This is a privacy/linkability issue only.

**Fix steps.** Return `shortenWallet()` plus the SNS name if one is known. Update the landing/lobby renderers if they use the full value.

**DoR.** Decision §4.7 (shorten). List the consumers (landing boards, lobby LIVE tab).

**DoD.** Handler spec. Run the `live-board-test` skill. Landing and lobby boards are checked in Chrome.

## SEC-14 — Minigames: outcomes not wired, fake MAC, unlocked `sync` race
**Clusters:** 9, 13 · **Files:** `verdict.service.ts:265`, `domain/verdict/ride-verdict.entity.ts:45`, `application/rides/ride-result-of.ts:16-34`, `minigame-session.service.ts:72-94,116,198`, `domain/minigames/mac.ts:30`, `heartbeat-ride.handler.ts:52`, `ride-minigame.prisma.repository.ts:24-35`

**Analysis.**
- `judge` gets no minigame rows (it defaults to mode `off`). `rideResultOf` hard-codes `mgPenaltySeconds(0,0)`. `assertMac` only checks for 43 base64url characters. `open()` trusts `cmd.safe`.
- An accepted heartbeat runs `minigames.sync()` with no tx and no player lock and saves whole rows, so it can overwrite a concurrent answer.
- `insert()` catches a unique violation and queries the same tx, which PostgreSQL has already aborted.
- The code itself says this is unfinished ("counts stay 0 until that stream exists"). It is dormant while `MINIGAMES=off` (the prod default). The risk is someone turning it on believing it protects.

**Scope (decision §4.8).** This round fixes the plumbing only. The rules (mandatory pass, timers, fuel) are MG-V2 (§6).

**Fix steps.**
1. Run the heartbeat's `accepted` branch (`rides.save` + `minigames.sync`) inside `transactions.run` under `findByWalletForUpdate`.
2. Use `createMany({skipDuplicates: true})` in `insert`.
3. Load `RideMiniGame` rows in `judgeTx` and pass `{mode, events}` to `RideVerdict.judge`. `rideResultOf` stores the real `mgTotal/Passed/Wrong/Missed`. Under formula v2 the time weight is 0, so the counts are kept for review and MG-V2, not for time.
4. Use a real `HMAC-SHA256(sessionKey, rideId ‖ eventId ‖ choice ‖ clientLatencyMs)` with `timingSafeEqual` in `answer`. With no session key (telemetry off), minigames refuse to arm. Env check: `MINIGAMES` ≠ off requires `TELEMETRY_V21` ≠ off.
5. Derive `safe` (speed below the stop threshold for at least 2 s) from the server ride state at the last heartbeat, not from `cmd.safe`.

**DoR.** Decision §4.8. SEC-15 step 1 merged (session key on paid starts). SEC-01 merged (shared `rideResultOf`/ranking). Read `docs/spec/minigames.md` Part 1 + SPC-07.

**DoD.**
- **Concurrency test** (heartbeat ∥ answer → the answer survives).
- Integration spec: a duplicate ordinal inside a tx does not abort it.
- Verdict spec: rows reach `judge` (`mg-unsafe-open` in `enforce`).
- MAC spec: a bad MAC → `400 mg_bad_mac`; a good MAC → 200.
- Env-schema spec for the `MINIGAMES` / `TELEMETRY_V21` pairing (a new rule → `env.schema.ts` + both `.env.example` files).
- `verified-play-test` skill and the E2E-08 minigame suite pass.
- `PRODUCT.md` + `minigames.md` MGM-M-11 updated (the HMAC is now verified).

## SEC-15 — Physics-faithful headless rides stay prize-eligible under default telemetry
**Clusters:** 6 · **Files:** `domain/rides/ride.entity.ts:120,384`, `infrastructure/config/env.schema.ts:169`, `upload-batch.handler.ts:79,99`, `domain/verdict/human-checks.ts:8`, `domain/rides/ride-challenge.ts:17`, `verdict.service.ts:273`

**Analysis.**
- With `TELEMETRY_V21=off` (prod), v1 batches are accepted, `CHALLENGE_KINDS` is empty and humanness is not classified. Human-timing checks only flag.
- A recording that is consistent with the server road, traffic frames and governor, and stays under the flag thresholds, is `verified`. It earns the TEN4 credit and ranks for prizes with no person in the loop.
- All four reviewers agree this is a client-authoritative design limit, not a code bug.
- Partial mitigations: a flagged ride blocks the pool until an admin decides, and pool attention checks catch outliers and Sybils.

**Fix steps (decision §4.9).**
1. For paid/ranked rides, `/start` issues the session key and the ride must upload protocol 2 batches with a valid MAC. A v1 batch on a paid ride → `400`.
2. Roll out `TELEMETRY_V21`: `shadow` on devnet → measure → `enforce` on devnet → production only after a passed devnet soak (devnet-before-production rule).
3. Keep flagged-only rides out of `honk.credit` and the payout ranking until an admin decides.
4. The human check is **mandatory minigames** (MG-V2), not `CHALLENGE_KINDS`. Leave that table empty and retire the old challenge channel in MG-V2's spec.

**DoR.** Decision §4.9. The `enforce` false-positive rate on human rides is measured on devnet (`ride-review` / `ride-audit`) and is acceptable to the owner. The client sends protocol 2 when it holds a key (`telemetry.js:81`, verified).

**DoD.**
- `verified-play-test` (positive + negative) passes in `enforce`.
- Bot fixtures (metronome, API bot) are flagged or rejected.
- A human in Chrome stays verified.
- `normal-drive` acceptance passes.
- `docs/spec/anticheat.md` and `PRODUCT.md` updated.

## SEC-16 — Container hardening: dev deps in the runtime image, tag pins, landing install scripts
**Clusters:** 20, 21 · **Files:** `infra/deploy/Dockerfile:6,19,36,41-46`, `Dockerfile.mcp:7`, `docker-compose.prod.yml:8,35`

**Analysis.**
- The runtime copies the whole `node_modules` so that `prisma migrate deploy` can run. That ships `@irys/upload*`, `@nestjs/cli`, `vitest`, `oxlint` and others.
- `node:24-bookworm-slim`, `postgres:17-alpine` and `redis:7-alpine` are pinned by tag, not digest.
- The landing stage runs `npm ci` without `--ignore-scripts`. The server stage already uses `--ignore-scripts`.

**Fix steps.**
1. Add a `migrate` stage/image (or a one-shot compose service) that holds the Prisma CLI. The runtime does `npm prune --omit=dev` (keeping `@prisma/client` + the generated client).
2. Pin `FROM` and compose images as `name:tag@sha256:…`, with a note on how to refresh them.
3. Use `npm ci --ignore-scripts` in the landing stage, allow-listing any package that needs a hook.

**DoR.** Read `docs/agents/deploy.md` (migration step order). Confirm that runtime code does not `require` a devDependency (`grep` `dist/`).

**DoD.**
- `npm run test:production:local` passes (startup, RPC, recovery, migrations).
- Runtime image size and `npm ls --omit=dev` are recorded in the commit.
- `npm run deploy -- --dry-run` passes.
- `docs/agents/deploy.md` updated. No deploy.

## SEC-17 — Unpinned build tools: `npx eslint/esbuild`; Anchor CLI version
**Clusters:** 23, 24 · **Files:** `frontend/client/package.json:9-10`, `backend/mcp/package.json:10`, root `package.json:18`, `backend/programs/Anchor.toml:3`

**Analysis.**
- `frontend/client` declares no deps and runs `npx esbuild` / `npx eslint`. On a clean machine npx resolves the latest registry version, and that machine holds deploy keys.
- `backend/mcp` lints with an undeclared `eslint`. It does have a lockfile.
- Anchor CLI is unpinned, so IDL output can drift. Deployable `.so` bytes are still gated by `solana-verify` + the pinned hash.

**Fix steps.**
1. Root workspace (decision §4.10): add exact-pinned `esbuild` + `eslint` (and the eslint config packages the client uses) to the root `devDependencies` and commit a root `package-lock.json`. The client scripts become `npx --no-install esbuild …` / `npx --no-install eslint …`. `frontend/client` keeps zero dependencies.
2. MCP: declare `eslint` in its devDependencies (it has its own lockfile).
3. `Anchor.toml [toolchain] anchor_version = "1.2.1"`, `solana_version = "4.1.2"`.
4. `program-check` asserts `anchor --version`.

**DoR.** Decision §4.10. Check whether the root has (or should have) an npm `workspaces` setup; today there is no root lockfile.

**DoD.**
- `npm run check` passes on a clean clone without network after root `npm ci`.
- `npx --no-install` fails loudly when the root deps are missing, instead of downloading.
- The `program-check` skill passes and the IDL diff is empty.
- Maps updated: a root `npm` setup change goes into README, AGENTS.md, CLAUDE.md and `docs/agents/verifying.md` (the first-time `npm ci`).

## SEC-18 — RustSec advisories in `backend/programs/Cargo.lock` (test graph)
**Clusters:** 22 · **Analysis.**
- `crypto-bigint 0.5.5` (RUSTSEC-2026-0387), `libsecp256k1`, `rand 0.7.3` and `ansi_term` arrive through `litesvm` (a dev-dependency) and are not in the deployed program.
- Correction from two reviewers: `bincode 1.3.3` **is** a direct `anchor-lang 1.2.1` dependency, so it is in the program build (unmaintained, not exploitable as shown).

**Fix steps.**
1. Add `backend/programs/audit.toml` with the test-graph ignores and an expiry date.
2. Track `bincode` as a production Anchor dependency in `docs/tech/escrow-open-items.md`.
3. Bump `litesvm`/agave when a fixed `crypto-bigint` lands.

**DoR / DoD.** The `program-check` cargo audit passes with the dated exceptions. `escrow-open-items.md` has an entry for bincode.

## SEC-19 — Dev treasury secret key in the audit snapshot
**Clusters:** 16 · **Analysis.**
- `backend/server/data/treasury.json` is **gitignored** (`.gitignore:80`) and not in git. The SolSwarm snapshot copied the working tree, and the auditors read the file. Checked on 29 Oct by matching only, with nothing printed: the secret key appears in 5 report files (`harness/sandbox-run/crosscheck-claude.log`, `agent-codex-s4-config.log`, `crosscheck-grok.log`, and two Grok session files under `sessions/crosscheck-grok/`). It therefore also went to the Claude, Codex and Grok providers. **Treat the key as disclosed.**
- The server reads only `publicKey`, and only outside production/test. Production uses `infra/deploy/secrets/treasury.json`.

**Fix steps.**
1. Check read-only whether that pubkey ever held funds or authorities on devnet/mainnet. If it did, rotate it (`treasury-init.mjs`) and sweep it.
2. Make SolSwarm's snapshot respect `.gitignore` and exclude `*treasury*.json` / `secretKey` (a SolSwarm-side fix).
3. Scrub the 5 report files listed above, or delete the report folder's `harness/sandbox-run/` and `sessions/` logs, before the report is shared with anyone.

**DoR.** None beyond the common DoR. Do not print the key.

**DoD.** Balance/authority check recorded (pubkey only). SolSwarm exclusion rule added. Report artifacts scrubbed.

---

## 6. MG-V2 — mandatory minigames, timers, real fuel (separate feature plan)

Closes the anti-bot side of clusters 6 and 9 (decision §4.9). **Full plan: [`MINIGAMES_V2_PLAN.md`](MINIGAMES_V2_PLAN.md)** (MG2-00..12), written spec-first. This section is the brief.

**Rules (target decisions, record now in `docs/spec/minigames.md` + `anticheat.md`):**
1. **Mandatory.** Every minigame a paid/ranked ride receives must be passed. A failure (3 wrong codes, or the timer running out) means `mg-failed`, and the ride is **rejected at the end**; zero passed is the same case. The ride keeps going. Paid rides go to admin review (admin override + appeal). This replaces MGM-M-06 "a minigame never fails the ride".
2. **Timer.** The window starts when the phone buzzes, and an on-screen countdown is shown in the cab and on the phone. There is one window per kind, as `GameSetting` rows (e.g. `mg.window.phone-sms`, `mg.window.gas`) changed through the signed admin API. The `more-time` mode doubles it. Retries stay at 3 codes per window.
3. **No unanswerable task.** The scheduler never arms a task whose window can cross the finish line or the end pad. The "cancelled unopened" state (MGM-M-05) goes away, because a timer that ran out is a fail.
4. **Gas station.**
   - Real fuel burn goes into `frontend/client/shared/physics.js` (rate from throttle/rpm/load; tunables in `js/config.js` + the shared module).
   - Low fuel arms a server-issued `gas` task at the next GULP bay. An empty tank stops the engine (the ride can still be finished by refuelling only if a bay is reachable; decide in the spec).
   - The GULP code becomes server-issued, replacing the local `gulp-state.js` digits.
   - GULP bay placement must be computed on the **server road** (port `site(ci)` for `gulp` into `@freightchain/shared`), so that the server can judge the task.
5. **Ranking.** Formula v2 has no minigame time (SEC-01). Passing every task is a precondition of `verified`, not a time bonus.
6. **Scope.** Applies to `1h` only. `4h`/`8h` must be covered before they go on sale.

**DoR.**
- SEC-14 and SEC-15 merged.
- Spec PR merged first: `minigames.md` (rules 1–6 as target), `anticheat.md` (`mg-failed` reason), `gameplay.md` (fuel), `world.md` (GULP placement on the server road).
- Accessibility and false-positive budget agreed: the expected human fail rate per shift is measured in `shadow` on devnet.
- Fuel numbers come from the `gameplay-balance` skill (how many stops a 1h shift needs).
- Decision recorded on what happens when the truck runs dry with no bay in reach.

**DoD.**
- Hard rules for shared physics/road: the change ships with the server port in the same commit; `road-drift.spec.ts`, `replay-engine.spec.ts` and `traffic-sim.spec.ts` are green; `trace:save`/`trace:diff` are reviewed; new rides carry hashed frame proof.
- The `level-check` skill shows EASY/MEDIUM/HARD still pass with fuel. The `gameplay-balance` / `trip-design` numbers are recorded.
- Verdict specs: all passed → verified; one fail → `mg-failed` reject; zero passed → reject; admin override → verified, and SEC-01's `RideResult` refresh applies.
- Concurrency tests: a timer expiry racing an answer.
- `verified-play-test`: a human passes; a metronome bot and an API bot that ignore tasks are rejected.
- Chrome: the `controls` suite drives a stop, a GULP refuel and a phone-SMS within the timer; screenshots of both timers are read. Tell the owner what to eyeball (timer feel, fuel pacing).
- `normal-drive` acceptance passes (a full 1h shift with fuel and tasks).
- `PRODUCT.md`, `minigames.md` (as-built) and the maps are updated. Devnet first; production only on request.

---

## Audit harness gaps (re-run conditions, SolSwarm side)

- The snapshot must include tracked lockfiles (`backend/server`, `backend/mcp`, `frontend/landing`, `tests/e2e` have them) and `backend/server/test/fixtures/chain/vault-split-cases.json`. Otherwise `npm test` and the pools LiteSVM tests cannot run.
- The snapshot must honour `.gitignore` (see SEC-19).
- Re-run the S3 (logic) surface: its worker exited 1.
- Re-run the program surface with `--test-artifacts` (hash-checked `deploy/*.so`), so the "0 on-chain issues" result is backed by executed tests and not only a source read.
