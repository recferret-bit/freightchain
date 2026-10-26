# Readiness handoff — 26 October 2026

**Paused at the owner's request to change agents and save credits. Do not restart automatically.** This is the continuation entry point for replacement agents. It supersedes the historical wave ordering in `EXECUTION_ORCHESTRATOR.md` for the remaining readiness work; it does not replace the product specifications.

## Outcome and current status

Goal: make all implemented app features work locally across browser, API, PostgreSQL and Solana, then commit/push a reviewable release candidate for an explicitly authorized devnet deployment and physical-device pilot.

**Not ready to declare complete.** Substantial fixes and local acceptance exist, but the final combined gate and successful full-duration paid ride are still open. Explicit versioned consent is partly implemented in separate, unmerged working trees. Nothing was deployed to production during this work.

- Main checkout: `/Users/ferretrec/work/freightchain`, branch `main`, HEAD `cf8d503d`.
- Local `origin/main` is `652e72bd`; main is **46 commits ahead** at handoff. This is the local tracking reference, not a freshly fetched remote assertion.
- Main also has **36 modified tracked script/fixture files and two new consent helper files**, not committed. Inspect `git status --short` before any merge.
- User-owned untracked `tests/e2e/.keys/` is unrelated: **do not read key contents, stage, remove or overwrite it**.
- Plan 2 currently records **50/53 done**. `SPC-05.5`, `SPC-08.4`, `SPC-08.5` remain in progress. Counts are not proof of full launch readiness.
- Preserve the worktrees below: two contain substantial **uncommitted source**. They are not recoverable from main or a cherry-pick alone.
- All three prior agents are stopped. The owned HARD driver was terminated and `fc-normal-free-levels-acceptance` PostgreSQL container removed; paid-run resources were already cleaned up. No replacement agents were started. Shared PostgreSQL and the user validator were left alone.

## Completed work already integrated into main

| Area | Implemented / demonstrated locally | Remaining boundary |
|---|---|---|
| Pool contracts | Current v6 artifacts, lifecycle and refusal coverage; legacy pledge settlement/refunds retained while new pledges are disabled | Final merged acceptance, then separately authorized devnet program/operator steps |
| TEN4 | Real local mint/burn/swap, short verified ride reward, Convoy settlement/retry/cap protection, distribution and historical vesting/expiry fixtures | Full normal paid ride through final reward settlement; historical fixtures are not elapsed-time campaign proof |
| NFTs | Real Bubblegum/MPL Core mint, inclusion/ownership, frozen-transfer refusal with unfrozen control, delayed/rejected/retry behavior | 13 remaining metadata URI publications and real wallet/DAS acceptance |
| Campaign / Convoy | Task UI, single event attempt, configurable Convoy progression and qualification, signed admin controls | Real Telegram/X/Turnstile accounts and provider acceptance; separate $500 event settlement work |
| Identity / privacy | One-time SGT claim verification, keyed subnet hashes instead of stored raw sign-in IP/UA, retention; optional bounded network/funding evidence | Physical Seeker/provider checks where enabled; final consent implementation below |
| Browser flows | Phone pairing, garage loadout, executed Blink buys, manual ticket reconciliation with watcher disabled, replay controls/tips, phone apps and successive toll UI | Physical wallet extension/mobile prompts, camera and sensor experience |
| Runtime reliability | Scheduled-job dependency failures contained; browser stops when server ends its ride; recording refusal is not falsely acknowledged | Full combined regression after latest changes |
| Production rehearsal | Scoped log retention, API/RPC recovery, 45-second DB outage without API restart, real local payment/refund checks | Actual host setup, backup/restore and live service acceptance after authorized deployment |
| Correctness fixes | Started paid rides counted accurately; selling-pool count; stale pending-order banner; PIKE second-booth state; stats cache assertion corrected | New integrated verification |

See [local readiness](../testing/LOCAL_READINESS.md) for detailed historical evidence and [owner tasks](OWNER_TASKS.md) for account/publication obligations.

## Exact unfinished sources

| Owner for restart | Worktree / branch | State and ownership |
|---|---|---|
| Backend consent | `/private/tmp/fc-explicit-consent` · `readiness/explicit-consent` · base `cf8d503d` | Uncommitted API, guard, player model, repository, append-only audit migration `20261122000000_explicit_terms_acceptance`, OpenAPI/routes, unit/HTTP/PG fixtures. Own `backend/server/src/`, `prisma/`, `test/`, `openapi.json` for this feature. |
| Frontend consent | `/private/tmp/fc-identity-acceptance` · `readiness/identity-acceptance` · base `4ab6517b` | Uncommitted consent modal, EN/RU text, legal pages, wallet/phone fixture updates; `backend/server/scripts/e2e-i18n-legal.mjs`; lobby child invocation in `.claude/skills/run-tests/e2e.sh`; map updates. Own these files. |
| Driving acceptance | `/private/tmp/fc-normal-free-levels` · `readiness/normal-free-levels` · commit `a53c89b4` | Committed, **not merged**: EASY/MEDIUM/HARD selection, full-course guards and helper tests; edits normal-drive script and shell runner. Combine with driver work below, preserving main's consent helper. |
| Driving acceptance | `/private/tmp/fc-normal-resilient` · `readiness/normal-resilient` · `c7ad4235` | Clean. Harness isolation/restart/watchdog/TCP startup fixes already integrated into main (`33122ec3`, `66e4cfe3`, `cf8d503d`). **Prospective-lane driver fix was not implemented.** |
| Integration coordinator | Main checkout | Uncommitted explicit-acceptance fixtures across 30+ local browser/chain scripts, `sim-rides.mjs`, `seed-landing.mjs`, `stub-api.mjs`, `tests/e2e/harness/{api,fixtures}.mjs`, and `infra/deploy/scripts/local-production-rpc-scenario.mjs`. New `backend/server/scripts/local-test-terms{,.test}.mjs`. Do not overwrite these with older worktree versions. |

The older campaign/production/controls worktrees contain historical commits already integrated; do not blindly merge them again. Use `git log`/patch comparison to establish what is new.

### Consent contract to preserve

- `GET /api/profile/terms` → `{ required, termsVersion, privacyVersion, acceptedTermsVersion, acceptedPrivacyVersion }`.
- `POST /api/profile/terms` strictly accepts `{ termsVersion, privacyVersion, age18: true, accepted: true }` for the signed-in wallet.
- Existing automatic version stamps must not count as informed consent. Migration resets them; minimal append-only audit records wallet/version pair/time, no IP/UA/fingerprint.
- New paid starts/purchases and reward actions require current consent (`428`). Training, identity, ongoing ride recording/end and reconciliation of already-sent funds remain usable.
- Explicit consent sets `age18At`; the separate paid-loss agreement remains required. Legacy `profile/agreements` must never silently grant version consent.
- Do not broaden this into withholding already-earned automatic payouts/outbox fulfillment without an accepted product requirement.
- Frontend shows review on sign-in/428; **never automatically retries a payment** after acceptance.
- Legal pages must preserve repo text verbatim, including draft/template labels and placeholders. Owner publication approval/final text remains necessary.
- Root's `acceptLocalTestTerms` helper is for generated **loopback test wallets only**. Real remote/devnet wallet scripts were intentionally not made to auto-accept.

## Tests: passed versus incomplete

| Run / evidence | Actual outcome |
|---|---|
| `/private/tmp/fc-final-merged-gate-v3.log`, source `ebe3faf9` | Root checks: 2,721 server tests; PostgreSQL: 664; security, all three code-E2E blocks, 204 Rust tests, production/RPC, pool lifecycle, TEN4/distribution and real cNFT checks passed. Chrome tail **29/31 passed**, not an aggregate pass. |
| Two v3 Chrome failures | Stats assumed an absent Redis key despite legitimate polling; corrected and focused Chrome passed. Referral lost its API connection; cause unknown because old logs were overwritten. Fresh referral reproduction passed 26 checks. Runner now retains full per-suite API logs. |
| `/private/tmp/fc-final-merged-gate-v4.log`, source `4ab6517b` | Stopped early: three release-unit fixture failures because fake releases lacked new logging script. Fixed in `29e907ef`; focused release lifecycle **5 passed**. No full rerun after fix. |
| Backend consent `/private/tmp/fc-consent-server.log` | Last completed full run: **8 failed, 2,733 passed**. Fixture/OpenAPI/migration expectations were being corrected; rerun latest source. Focused typecheck and 19 tests passed earlier. |
| Backend consent `/private/tmp/fc-consent-pg-focused.log` | **3 passed, 1 failed**, 344 deliberately filtered/skipped. Append-only repository/concurrency passed; training HTTP fixture supplied an invalid abort payload. Subsequent edit is not a pass until rerun. |
| Frontend `/private/tmp/fc-consent-client.log` | Client full check passed before last small footer correction. Landing lint/build passed. Actual-dist budget tests failed (JS/CSS totals and pitch-deck nine bytes over 22 KiB); investigate per-page budgets without blanket increases. Legal/consent Chrome test **never run**. |
| Main local test helper | Four Node tests passed, 36 modified `.mjs` syntax checks passed, `git diff --check` passed. This is not end-to-end consent evidence. |
| Normal MEDIUM | Full normal physics 3,360.29 m / 362.30 s, hull 100%, 180 uploaded batches, verified, no browser/upload errors. `/private/tmp/fc-normal-harness-medium-accepted.log`. |
| Normal EASY | Passed; `/private/tmp/fc-normal-easy.log`. |
| Normal HARD | Incomplete; stopped at owner request. `/private/tmp/fc-normal-hard.log`. Must rerun from scratch, not count partial distance. |
| Full paid latest | **Failed normally**, real rear-end collision at 8,685 m / 839.5 s; 417 uploaded batches, no upload errors, rewards withheld. `/private/tmp/fc-normal-paid-resilient-v2.log`; artifacts `/var/folders/zr/b6ccvm1n2yn1xhgjr2dfgb340000gn/T/fc-normal-paid-YXwazm`. |

Earlier paid attempts were invalidated by a scheduler crash and a separate Docker-wide PostgreSQL interruption. No ride state was altered to salvage them. The latest failed driver braked for its current lane but ignored a truck in the target lane while merging from lateral position 7.2 to 2.4 at about 21 m/s. Fix the **test driver's anticipation**, not gameplay, collision rules or verification strictness.

## Parallel restart plan — coordinator plus three workers

**Do not spawn replacements until the owner resumes and chooses the execution environment.** Existing agents are stopped; their names need not be reused. This plan works with three independent sessions plus one integration coordinator, with at most four simultaneous agents. Start from preserved work, not a new audit of everything.

| Lane | Independent work | Done means |
|---|---|---|
| A — backend consent | Continue existing backend tree; fix remaining test expectations and inspect migration/transaction/guard semantics. Do not touch frontend or root-owned scripts. | Typecheck, unit/contract and real HTTP/PG acceptance pass, including refusal, training exemption, current-version reacceptance, concurrency and immutable audit. Commit exact sources and report evidence. |
| B — frontend consent | Continue frontend tree; correct landing budget accounting, complete CLAUDE/PRODUCT/map updates and modal/legal behavior. Static work can proceed while A works. | After A integration, actual Chrome covers fresh refusal, training, explicit accept, stale versions, EN/RU, legal text, wallet/phone/split hosts; inspect screenshots. Final client and landing checks pass. |
| C — full driving proof | Own both normal-driving trees. Integrate `a53c89b4` with current harness; add prospective-lane braking/hold and regression checks for dangerous merges. Preserve gameplay and normal clock/course. | Complete HARD and full paid browser ride, verified frame-level traffic, correct on-chain reward/outbox/ledger/receipt once, duplicate/retry checks and screenshot inspection. Failed/aborted runs remain failures. |
| Coordinator — integration | Preserve/commit main's fixture changes, merge A, then B and C in order; resolve shared shell/normal-drive edits. Refresh main Prisma client only when no dependent process is using generated files. Own consolidated readiness/status/wiki. | Final stable-source aggregate passes, evidence/version recorded, remaining owner-only items explicit; then commit/push. No production deployment. |

Order and barriers:

1. Claim one lane and inspect its worktree status. Record starting HEAD and ownership. Keep new agents' prompts limited to this handoff and relevant topic files.
2. A and B run cheap focused checks; C fixes driver and runs short refusal/merge tests. Do not rerun the expensive aggregate per agent.
3. Integrate A and root fixture helper first. B's live consent Chrome acceptance depends on this. C's **final** long proof should include this integration so consent is tested in the complete flow; preparatory driver work is independent.
4. Resolve `.claude/skills/run-tests/e2e.sh` centrally: preserve retained API logs, normal-course support and B's consent Chrome child. Resolve `e2e-normal-drive.mjs` centrally: preserve root explicit acceptance and C's course/driver changes.
5. Freeze sources for long proofs. Never modify a shell script while it is executing. Use isolated test databases/ports/validators and private build outputs. Do not restart Docker/shared services during long rides.
6. Coordinator runs one final `npm run test:ci:full` on integrated stable sources. Fix failures and rerun the affected checks; a final complete pass is still required. Update [LOCAL_READINESS](../testing/LOCAL_READINESS.md), [soft launch](DEVNET_SOFT_LAUNCH.md), Plan 2 and `docs/tech/escrow-open-items.md` honestly.
7. Regenerate wiki **from main only** (`node docs/build-wiki.mjs` → `docs/wiki-catalog.js`), review changes/secrets, commit and push under existing authorization. Stop for owner deployment/device acceptance.

### Commands and resource precautions

- Root fixture check: `node --test backend/server/scripts/local-test-terms.test.mjs`.
- Backend: `npm --prefix backend/server run typecheck`, `npm run server:test`; integration requires a dedicated `TEST_DATABASE_URL` ending in `_test`, never the development DB.
- The consent scratch DB `freightchain_explicit_consent_test` remains on port 15433. Migration quoting was corrected after its first application: use a fresh `freightchain_explicit_consent_v2_test` for acceptance instead of reusing that database or editing an already-applied migration record. Inspect public Solana Actions consent coverage as part of Lane A's remaining guard review.
- Free proof after C integration: `NORMAL_DRIVE_LEVEL=HARD bash .claude/skills/run-tests/e2e.sh normal-drive` (select an owned isolated PostgreSQL container via documented `E2E_POSTGRES_CONTAINER`/`E2E_POSTGRES_PORT`).
- Paid proof entry: `node backend/server/scripts/normal-drive-localnet.mjs`; read its prerequisite/header and `docs/agents/ten4-localnet.md` first. It owns scratch DB/validator/wallets and snapshots sources.
- Existing aggregate helper `/private/tmp/fc-final-merged-gate.sh` sets toolchain PATH, official Chrome, isolated Redis and artifact directory, unsets a global `TEST_DATABASE_URL`, then runs `npm run test:ci:full`. Inspect before reuse; log next attempt separately, e.g. `fc-final-merged-gate-v5.log`.
- Browser override: `CHROME='/private/tmp/fc-chrome-testing/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'`. Normal physics uses Metal. Do not alter/re-sign the user's installed Chrome.
- User validator PID `28050`, RPC `8899`, ledger `tests/e2e/.ledger`: **leave untouched**. Never global Solana config/key changes. Native suites use isolated dynamic ports.
- Worktree `node_modules` may be symlinked to main. Prisma generation is a shared mutation unless the lane uses private copied dependencies. Backend consent currently has private dependencies.
- No broad `docker stop`, `compose down`, pruning, `pkill`, worktree removal or user key cleanup. Stop only owned resources. Never print env secret values.

## What still needs the owner or a later milestone

After the engineering barriers, the owner boundary is final legal identity/contact/text, actual provider accounts/configuration, 13 metadata publications, physical wallet/phone/optional Seeker checks, and an **explicit current-message deployment request**. Existing key presence does not prove valid credentials; do not recreate keys blindly.

The separately scheduled **$500 event's fixed-table standings/review/payout acceptance is still implementation work**, not solved by credentials alone. Keep it tracked separately and complete it before that event opens. Future TGE allocation weights/claim UI are a later milestone. Optional disabled integrations and accepted disabled features must not be silently switched on to claim coverage.

No new agents, deployments, real-provider messages, program deployments or pool creation are authorized by this handoff itself. Existing authorized local implementation/testing and commit/push can resume when the owner resumes the work.
