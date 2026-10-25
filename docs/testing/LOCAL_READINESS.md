# Local feature readiness

Assessment started 24 October 2026 against `35fe653aa1bc5e4d749d42cd89d337d84220c399` plus the working-tree changes described below. Parent checklist: [devnet soft launch](../plan/DEVNET_SOFT_LAUNCH.md). The acceptance bar is [COVERAGE_CONTRACT.md](COVERAGE_CONTRACT.md). Six implementation tasks were reopened in [Plan 2's status board](../plan/spec-compliance/STATUS.md): `SPC-05.5` and `SPC-08.1..5`; 47/53 retain done status.

**The complete local gate is open.** Existing tests cover substantial behavior, but passing the current suite does not prove every app feature works. Runtime checks, missing implementations and manual/provider checks are tracked separately below. A source assertion, mock or old log does not establish a current browser or chain pass.

## Execution record

Only completed commands with exit 0 count as passes. The baseline uses local PostgreSQL/Redis, Chrome and scratch validator wallets. Application analytics is disabled; the Solana RPC is loopback.

The full invocation used `TARGET=localnet LIKE_DEVNET=0 NODE_ENV=development POSTHOG_ENABLED=0 SOLANA_RPC=http://127.0.0.1:8899 SNS_RPC=http://127.0.0.1:9 npm run test:ci:full`. The blocked SNS endpoint deliberately excludes a real name-provider lookup. Focused Chrome reruns used the same local settings with `bash .claude/skills/run-tests/e2e.sh road` or `sim`.

| Run | Result | Evidence |
|---|---|---|
| Initial `npm run test:ci:full` | **Failed** in the fast gate | `/private/tmp/fc-local-readiness-full-20261024.log` |
| Client checks, parity, tickets stub, landing, server build/typecheck, MCP and media in that run | **Passed** | Client: 177 tests; parity: 11,668 objects identical; tickets: 20/20; server: 455 files, 2,570 tests |
| Initial PostgreSQL integration | **Failed despite 613 assertions passing** | An unhandled admin logout audit write raced with the next scenario's truncate |
| Initial security gate | **Failed** | PostgreSQL was still starting; security had no create/migrate setup |
| Initial block 1 | **Passed** | Root runner recorded exit 0 |
| Fixed security gate | **Passed** | 3 files, 8 tests; `/private/tmp/fc-local-readiness-security-20261024.log` |
| Logout interceptor regressions | **Passed** | 2 files, 9 tests; waits for delayed writes and propagates write errors |
| Saved-token HTTP regressions | **Passed** | Admin and editor: old cookie gets `401 token_revoked` immediately after logout; `/private/tmp/fc-local-readiness-logout-http-20261024.log` |
| Fixed full fast gate | **Passed** | Server: 455 files/2,576 tests; PostgreSQL: 57 files/615 tests; security: 3 files/8 tests; block 1: 166 passed, 1 skipped |
| Block 2 | **Passed** | 46/46 checks; includes signed pool transactions, but its two TEN4 comparison titles overstate their zero-balance assertions |
| Block 3 | **Passed** | 9 files/153 tests; helper/kernel checks, not a full Chrome driving session |
| `npm run program:test` | **Passed** | 197 Rust/LiteSVM tests, 0 failed/ignored; `/private/tmp/fc-local-readiness-program-20261024.log` |
| Added guest/weekly/referral/viewer Chrome suites | **Passed after fixes** | `/private/tmp/fc-local-readiness-extra-chrome-20261024.log`; initial failures preserved in `fc-local-readiness-extra-chrome-initial-20261024.log` |
| Client check after the driver road fix | **Passed** | Lint, 177 tests, bundle and headless simulation; `/private/tmp/fc-local-readiness-client-20261024.log` |
| Pool local-validator lifecycle | **Passed** | 30/30 pool instructions; 27/28 events plus one exempt; 39/50 errors on validator and 50/50 with LiteSVM |
| Dedicated TEN4 local-validator suite | **Passed** | Verified shortened paid ride: ledger +100 TEN4, chain +100,000,000 base units; second end adds nothing; training and weekly grant mint zero; frozen part transfer refused |
| Final `npm run check` | **Passed** | Updated client, server, architecture/HTTP, landing, MCP and media checks; `/private/tmp/fc-local-readiness-check-final-20261024.log` |
| Client checks after controls assertions | **Passed** | Lint, 177 unit tests, bundle and headless checks; `/private/tmp/fc-local-readiness-client-final-20261024.log` |
| MCP with real restricted Redis | **Passed** | 13/13, no skips, against a disposable Redis container; `/private/tmp/fc-local-readiness-mcp-redis-20261024.log` |
| Final census self-test | **Passed as a mapping check** | 178/178 routes, 30/30 instruction mappings, 81 required IDs mapped; `/private/tmp/fc-local-readiness-census-final-20261024.log`. This does not erase runtime skips |
| Browser road check in the full run | **Failed in legacy traffic mode** | Honest ride flagged by reconstructed traffic contact; missing-hole attack rejected. The test had explicitly disabled current frame-level proof |
| Road check with required frame-level proof | **Passed** | Honest driver: 2 hole hits, 69.9% hull, verified; removed-hole client rejected; database audit agrees; `/private/tmp/fc-local-readiness-road-proof-20261024.log` |
| Full baseline after fixes | **Not a clean aggregate pass** | All 28 Chrome scripts reached their result output; legacy `road` failed two checks. An edit to the running shell script disrupted its final summary with a syntax error. Do not count the reported process exit 0 as success; `/private/tmp/fc-local-readiness-verified-20261024.log` |
| Chrome controls with outcome assertions | **Passed** | Engine on, first gear/forward movement, reverse/backward movement, 24 decoded audio samples and chain-display/RPC-down fixtures; clean `all green (sim)` summary; `/private/tmp/fc-local-readiness-controls-20261024.log` |

The focused HTTP run selected two tests and skipped the other 317 by filter; it is evidence for those two scenarios only.

The full block-1 run skipped `RPL-T-70..90`: the runner does not configure its required mock RPC and treasury. Block 2 prints that TEN4 is undeployed on its validator; `ledgerMatchesChain()` only checks a fresh wallet's zero ledger value and may return without a mint. The later HONK suite is the separate paid-mint evidence. The localnet runner warns that the pool `.so` differs from `verifiable-build.hash`; successful tests of those bytes do not establish the pinned release artifact or a fresh source build.

The aggregate's 27 other Chrome scripts reported success, including `sim` with zero captured errors. That original sim run did not assert its initial engine/movement outcomes; its logged engine-off/neutral/zero-speed state is a coverage failure, not proof of working controls. Corrected road and controls runs are recorded separately. A fresh, unchanged `test:ci:full` invocation is still required for the final local gate.

Screenshots inspected from the OS temporary directory: localnet ticket purchase/refund, guest completion, model viewer camera, editor published revision, desktop cockpit and admin phone layout. The initial phone alert banner overflowed horizontally; the follow-up below fixes and verifies it. Inspecting these examples does not close the full visual matrix.

## Fixes made during baseline

1. `ci-fast.sh` now waits for healthy PostgreSQL before launching the integration, block-1 and security lanes. Security runs create/migrate setup on its isolated `freightchain_agent1_test` database and include the append-only audit/alert integration test that the root command previously omitted.
2. Admin logout now awaits token revocation and its audit transaction before returning success. Editor logout awaits revocation too. Delayed writes and failures have unit regressions; saved-cookie replay has shared HTTP scenarios on memory and PostgreSQL. The full PostgreSQL rerun passed without the original unhandled rejection.
3. The Chrome runner now includes the existing `guest`, `weekly`, `referral`, `viewer` and `sim` harnesses in its default 28 suites. The weekly fixture uses the private CLI build, avoiding concurrent `dist/` rebuilds.
4. `test:ci:full` now includes `npm run program:test` for both Rust programs. That stage was executed separately in this baseline because the parent command had already started before the script update.
5. Drivers no longer request the public spectator road endpoint, which the current visibility rules refuse. The same seeded local hole roll remains in use. Guest/referral Chrome checks assert zero spectator-road requests and no page errors. The viewer harness explicitly checks the expected signed-out editor refusal while still failing on unrelated errors.
6. The road browser suite now requires frame-level traffic proof for both new rides. Its previous mode could flag an honest run through legacy reconstruction discrepancies. The dedicated rerun passed: honest verified, hole-removal client rejected, database audit agrees. The live judge remains 10 Hz, and historical review flags are unchanged.
7. The controls harness now starts with the clutch held and asserts engine-on, first-gear forward movement and reverse movement. It waits for boot and fails if the game never appears. This fixes test setup and missing assertions; gameplay tuning is unchanged.

## Production startup follow-up — 25 October 2026

On top of `cd359673`, production Compose now defaults API/replay/editor workers to strict-safe live flags, forwards the required privileged session/alert settings, and uses 60-minute session defaults. Fresh env initialization creates three distinct session keys. Seven configuration/init regressions passed; root `npm run check` passed (456 server files, 2,583 tests) and PostgreSQL integration passed (57 files, 615 tests). Logs: `/private/tmp/fc-production-root-check.log`, `/private/tmp/fc-production-integration.log`.

The real six-service production-mode Docker smoke passed all **14 checks**: migration, API/worker/MCP health, strict flag refusals, real PostgreSQL backup/restore, Redis fail-closed health and recovery, PostgreSQL readiness refusal/recovery, and application-process restarts. All test resources were cleaned up. Evidence: `/var/folders/zr/b6ccvm1n2yn1xhgjr2dfgb340000gn/T/fc-production-smoke-mx069o/result.json`; image IDs `b3f98d569497…` (server), `c3e4fbb9eb18…` (MCP). Initial harness attempts exposed exhausted default Docker subnet pools and insufficient temporary-container capacity; the final harness selects unused internal `/28` subnets.

Repeat with `npm run test:production:local` (builds current images; included in `test:ci:full`). It uses generated credentials, a disposable database and no external runtime network. RPC transactions, real Telegram/AI delivery and the complete final local gate remain separate open checks. Real production env files were not changed.

The corrected whitepaper release-config paragraph passed real Chrome. Its first run exposed a fixed-400-ms lazy-image wait; the harness now scrolls each image into view and waits for actual dimensions. The rerun passed, and the diagram screenshot was inspected. Logs: `/private/tmp/fc-production-whitepaper-chrome.log` (pass), `fc-production-whitepaper-chrome-initial.log` (initial failure).

## Durable social and replay follow-up — 25 October 2026

Convoy and campaign runtime repositories now use PostgreSQL. Tests prove second-connection persistence, transaction rollback, concurrent invite/global promo caps, unique Telegram/X bindings and idempotent 48-hour campaign claims. Convoy activation issues a usable 1h promo grant instead of incrementing the retired free-ride counter. Its reserved code cannot be created or redeemed publicly. Repeat social verification cannot repeatedly increase trust. Real social-provider verification, full target trust rules and chain reward settlement remain open.

The complete PostgreSQL run passed **59 files / 626 tests** (`/private/tmp/fc-launch-integration.log`). Focused final regressions passed **5 files / 42 tests** (`/private/tmp/fc-launch-focused.log`). The first root check exposed a stale migration model inventory; that inventory was corrected. The aggregate rerun passed the root checks, PostgreSQL, security, block 1, block 2, block 3, Rust and production startup stages, and is still running the chain/Chrome stages (`/private/tmp/fc-launch-full.log`). Its first attempt found a block-1 caller bypassing replay database isolation; that caller was fixed. These results do not close the complete local gate.

Real Chrome passed eligible replay playback/control/chat and phone checks (`/private/tmp/fc-launch-replay-controls.log`), the corrected bounded phone admin alert banner (`/private/tmp/fc-launch-admin.log`), and a genuinely signed local-validator replay tip (`/private/tmp/fc-launch-replay-tips.log`). The 0.01 SOL tip credited 9,500,000 lamports to the driver and 500,000 to treasury; duplicate confirmation changed neither balance. The tip fixture is a historical paid replay, not evidence of a completed verified ride. Phone replay/admin and paid-tip screenshots were inspected. Both new replay suites are included in the default **30-suite** Chrome runner.

All 44 earnable badges now have valid 1024×1024 PNGs and metadata templates. Offline `upload-irys.mjs --prepare` confirms 31 published URIs and 13 missing; upload preserves existing URIs and refuses mixed networks. No metadata was published and no remote chain state changed. The new `npm run test:nft:localnet` subsequently passed real Bubblegum/MPL-Core minting and PostgreSQL worker checks, with pinned public program hashes, valid on-chain leaf proof, exact collection-freeze refusal and a successful unfrozen transfer control. It also proves pre-broadcast claim handling, 48h delay, rejected-completion exclusion, durable receipt recovery and duplicate protection. Evidence: `/private/tmp/fc-launch-nft-localnet.log` and the printed `fc-nft-local-*/result.json`. The read-only program download was the only remote chain access; no remote transaction was sent.

## Feature acceptance matrix

**Partial** means existing tests exercise part of the feature but the complete acceptance row is open. **Incomplete** means a required implementation is missing. **Untested** means the required runtime evidence is absent. **Pending** means this baseline has not finished. None of those labels is a complete feature pass.

Commands below are reproducible entrypoints; their presence is not a claim that they have passed this run. `e2e <suite>` means `bash .claude/skills/run-tests/e2e.sh <suite>`. `server` means both `npm run check` and `npm run server:integration`. `block3` means `npm run test:e2e:block3`.

| Feature and applicable rule | Local evidence entrypoint | Status and remaining acceptance |
|---|---|---|
| Landing and empty-pool state | `e2e landing`, `e2e wallet`, landing tests | Passed Chrome checks for real landing, empty/null pool and missing split; transaction UI checks are separate rows |
| Wallet SIWS and sessions | `e2e wallet wallet-split`, server `flow.scenarios.ts` | Partial: real extension popup remains manual |
| Guest EASY and guest restrictions | `e2e guest`, server `http-gaps-public.scenarios.ts` | Passed shortened Chrome completion and guest refusals; no spectator-road requests |
| SNS resolve/reverse | Server name-service unit/HTTP scenarios | Partial: no real-browser integration harness; mainnet name lookup is a provider check |
| Phone session pairing | Server `flow.scenarios.ts`, `MANUAL_TESTS.md` | Partial: two-device QR/wallet handoff remains manual |
| Profile, 18+, terms and eligibility | Server agreements, terms guard, host/geo scenarios | Partial: complete browser modal, re-consent and refusal matrix needed |
| EN/RU | `e2e-i18n-legal.mjs`, block 1 | Partial: verify all required screens, not just dictionary presence |
| EASY/MEDIUM/HARD finish | Client headless checks; `e2e browser`; server free-level scenarios | Partial: normal-duration level checks and assisted/unassisted outcomes need explicit evidence |
| Tutorial and assist | Client headless checks; server guide/free-level scenarios | Partial: browser controls and forbidden HARD/paid combinations need explicit evidence |
| Engine, gearbox, clutch and brakes | `e2e sim`, client unit/headless | Partial: corrected Chrome startup/first-gear forward/reverse assertions passed. Complete braking/gearbox matrix remains open |
| Battery, climate, wipers, lights and cockpit controls | Same standalone Chrome harness and client headless | Partial: screenshot inspection does not prove each control; add missing outcome assertions |
| Routes, forks, traffic, holes and collisions | Client parity/headless; `e2e road traffic` | Partial: required-proof road and all nine traffic scenarios passed; standalone route/control assertions and visual matrix remain open |
| Ride order/start/end and distance finish | `e2e browser close close-split`; server lifecycle scenarios | Partial: shortened Chrome completion, server-owned distance and close-beacon completion verified; full-length program-mode journey remains open |
| Disconnect, heartbeat and stale sweeper | `e2e close close-split board`; server lifecycle scenarios | Partial: Chrome proves abandoned/complete states, back-cache reload and stale sweep on one/split hosts; inspect all terminal-path statistics separately |
| Hash chain, road rebuild and traffic-frame validation | `e2e verified verified-deep road traffic`; server | Partial: strict traffic passed all nine honest/modified clients, including missing/malformed proof and ignored collisions; road rerun passed honest/removed-hole clients. Full-duration enforced journey remains open |
| Full-length 1h ride and enforced result | Normal-speed Chrome ride against local program-mode API | Untested: short/accelerated tests do not prove this journey |
| Optional telemetry v2.1 modes | Server protocol tests and `block3` | Partial: defaults remain off; optional helper checks are not a 30 Hz live judge |
| Humanness, trace retention and clustering | `block3`, server unit/integration | Partial: document accepted non-rejects and actual persisted trace/job behavior |
| TrustScore and anti-sybil | Server trust/Convoy/airdrop tests; anticheat Appendix D | Incomplete: current score starts at 60 with reward holds; ASN/funding detection and the target point table are absent. Browser fingerprinting remains rejected |
| Appeals and admin rejudge | Server appeal/scoring scenarios; `e2e admin verified-deep` | Partial: signed override/rejudge browser checks and server scenarios passed; integrated open-appeal payout hold needs explicit evidence |
| Weekly 1h grant and promo precedence | `e2e weekly`, server weekly-ticket tests | Passed browser grant/spend/promo precedence and database assertions; full interval rollover UI remains separate |
| Promo create/redeem/caps/expiry | `e2e promo wallet wallet-split`; server abuse scenarios | Partial: signed-admin creation/disable and browser redemption passed; full caps/expiry/abuse acceptance remains open |
| Transfer-mode payments | Server payment scenarios; `e2e lobby` | Partial: separate real local-chain payment and browser evidence from injected chain responses |
| Program ticket buy/confirm/reconcile | `npm run test:localnet`; `e2e-tickets.mjs`; block 2 | Partial: local chain purchases, confirm and webhook passed with exact balances; standalone reconcile script is outside full runner |
| Solana Pay ride/order/tip | Server Solana Pay scenarios; `e2e-solana-pay.mjs` | Passed signed local-validator replay-tip Chrome journey, exact 95/5 balances, duplicate confirmation and both histories; included as `e2e replay-tips` |
| Blinks discovery/buttons/wallet transaction | `e2e blinks`; server Actions scenarios | Partial: Dialect discovery/cards/buttons and transaction construction passed; executing that returned transaction in the wallet remains separate |
| Pool lifecycle and all account checks | `npm run program:test`, `npm run test:localnet` | Passed final pinned v6 binary: 29 successful instructions plus one refusing tombstone; all 50 errors with LiteSVM |
| Target operator-funded activation and schedule | `SPC-05.5`, program/server schedule tests | Implemented and locally verified: Active at zero sales, explicit schedule and independent cadence. Optional pledge creation remains open |
| Sponsor funding and refunds | `npm run test:localnet`, Rust tests | Passed signed transactions and balance assertions |
| Root commit/veto/payout/close/authority | `npm run test:localnet`, Rust tests | Passed current lifecycle, authority/refusal, proof, duplicate payout and balance checks |
| Crank, watcher, webhook and payout worker | Localnet autonomous day; server chain scenarios | Partial: autonomous day and signed crank/watcher/payout paths passed; add restart/replay/recovery evidence where absent |
| Ranking, RideResult and prize board | Server scoring/prize scenarios; `e2e honk-garage` | Partial: rule versions, tie/cap handling and browser breakdown need explicit evidence |
| TEN4 initialize/supply/swaps/rewards/burn | `bash .claude/skills/honk-suite/run.sh` | Passed local token operations and a verified shortened paid ride: chain and ledger +100 TEN4 once; training/weekly grant zero |
| TEN4 referral/airdrop/treasury/team instructions | Rust HONK tests; built HONK IDL | Partial: 13 HONK instructions exist; several have no JS transaction encoder or local-validator app journey |
| Garage part purchase, freeze and loadout | HONK suite; `e2e honk-garage lobby`; Rust `buy_part` | Partial: real-chain part mint/freeze and ledger-mode Chrome burn/equip passed separately; one signed-chain browser loadout journey is still required |
| All achievement unlocks and progress | Server achievements tests; `e2e achievements` | Partial: browser suite exercises selected progress, not every tier |
| cNFT metadata, delayed mint, retry and transfer refusal | Server mint tests; achievement scripts | Incomplete: all 44 badge assets validate offline, but 13/44 URIs still need first publication; real local Bubblegum/MPL-Core adapter/worker, proof, frozen refusal and retry/idempotency checks now pass; wallet display/DAS remains a provider check |
| Legacy referral bind/qualification/gifts | Server referral scenarios; `e2e referral` | Passed verified MEDIUM finish, qualification, 2/3 credit gifts and the lobby state |
| Convoy state/limits/leaderboard/privacy | Server Convoy tests and block 1 | Partial: PostgreSQL persistence, rollback, concurrent limits, privacy and usable 1h promo gift now pass; complete UI/reward-chain integration remains open |
| Airdrop/social binding/holds/claim | Server airdrop tests and block 1 | Partial: PostgreSQL persistence, unique social bindings and 48h concurrent claim tests pass; real provider adapters and campaign-attempt wiring remain open |
| Live board and online presence | `e2e board close close-split`; server live scenarios | Partial: visitor counts/leave/sweeper and hidden training rides passed; public eligible replay cards need a positive fixture |
| Replay visibility, public samples and receipts | `e2e watch replay`; server replay/receipt scenarios | Partial: Chrome passed running/training refusals; accepted paid-replay visibility, receipt and payout-lock journey needs explicit evidence |
| Replay playback/camera/HUD/share | `e2e replay`; `e2e-replay-controls.mjs` | Passed eligible paid-replay Chrome fixture: real-time playback, seek, speed/camera/keyboard controls, public input redaction and phone viewport; included as `e2e replay-controls` |
| Replay chat, moderation and retention | Server live/chat scenarios; `e2e flags` | Partial: replay-controls now proves browser chat and persisted replay timestamp; complete moderation/retention acceptance remains open |
| Signed replay tips and donation history | Server donation scenarios; signed Solana Pay script | Passed signed local-validator Chrome tip: exact 95/5 transfer, confirmed signature, duplicate protection and sender/driver API histories; real wallet extension remains manual |
| Pledges on/off and settle/refund | Localnet autonomous day; server pledge scenarios | Partial: signed-chain settle/refund and server scenarios passed; complete optional-mode browser and off-state acceptance separately |
| Phone OS, apps, GULP, PIKE and phone-sms | Client phone tests; server minigames; `block3` | Partial: browser app controls/challenge renderer are not covered by block3 alone |
| Admin roles/host/signatures/revocation | Security gate; `e2e admin`; server scenarios | Partial: security, signed actions, host/allowlist and immediate revocation passed; phone alert overflow fixed and Chrome width/height assertions passed |
| Admin audit/alerts/dual approval | Fixed security gate; server admin services | Partial: append-only/outbox passed; configured delivery and dual workflow need evidence |
| Entity viewer, catalogue and bundle | `e2e viewer`; server entity tests | Passed all 144 model selections, camera interactions and expected signed-out editor refusal |
| Editor edit/revision/publish/AI queue/MCP | `e2e editor`, server and MCP tests | Partial: real MCP, dedicated worker, queue/cancel, revisions, signed publish and refusal paths passed; scripted LLM does not prove real provider delivery |
| Statistics and cache failure | `e2e stats`; server stats/concurrency scenarios | Partial: Chrome crash, API terminal paths, displayed totals and reconcile passed; complete donation/optional-path acceptance remains open |
| Analytics opt-in and crash reports | Server/client unit/HTTP; posthog-test workflow | Partial: local fixtures only; live delivery remains separate |
| Whitepaper and pitch deck | `e2e whitepaper`, landing tests | Partial: whitepaper title/anchors/SVG/images and pitch-deck load passed; deck controls/fullscreen/tilt need runtime/manual evidence |
| Split hosts, startup, migrations and recovery | `e2e wallet-split close-split editor`; `npm run test:production:local`; server config/deploy tests | Partial: strict Compose wiring fixed; all 14 real Docker startup/migration/backup/outage/restart checks passed. RPC-enabled production-mode rehearsal and real provider delivery remain open |
| Promo media/audio and audit tooling | `npm run media:check`; tool-specific suites | Tool checks are separate from app journeys; no claim of whole audit-tool verification |

Route inventory: [178-route manifest](../../backend/server/test/contract/routes.manifest.ts), checked against the booted Nest graph. Existing feature census: [features.mjs](../../.claude/skills/test-census/features.mjs). Its generated grades mix source mappings with old browser/line evidence and are not this run's pass record. Pool instruction inventory: [committed IDL](../../backend/programs/idl/freightchain_pools.json); HONK's 13-name source/encoder contract is in [anchor-idl-drift.spec.ts](../../backend/server/test/architecture/anchor-idl-drift.spec.ts).

## Next work after baseline

1. Continue plan steps 3–5 (contract alignment, persistence and NFT integration), then complete the RPC-enabled production-mode rehearsal/provider checks. Core production startup/recovery and the narrow-screen admin fix passed; remaining controls assertions are open.
2. Execute and repair the remaining omitted Chrome harnesses, then wire them into a repeatable local gate. Guest, weekly, referral, viewer and sim are now wired in. Replace stale running-watch fixtures with permitted finished replays; a refusal test alone does not prove playback/tips/chat work. Configure block 1's skipped signed-tip RPC fixture and replace block 2's zero-balance TEN4 comparison with actual mint evidence.
3. Complete real persistence, contract alignment and the missing token/NFT paths, with the required unit/PostgreSQL/HTTP/validator tests and product-doc updates.
4. Run the normal-duration integrated ride and finish the remaining controls, optional modes, manual checks and provider checks. The local readiness claim remains open while any applicable cell lacks evidence.

## Pinned v6 contract follow-up — 25 October 2026

The reproducible Docker build, IDL comparison, 203 Rust/LiteSVM tests and Clippy passed (`/private/tmp/fc-v6-program-final.log`). The final SHA-256 pin is `bc9d2a2dcf6d0dea0a3240e53c347983eb1d425ded3ab1ce7ca254b38683f1d7`. The complete local validator gate passed on these bytes (`/private/tmp/fc-v6-acceptance.log`): purchases, refunds, payouts and the autonomous day; 29/30 successful instruction paths plus the deliberately refusing `fail_pool`, 26/28 events plus documented `PoolFailed`/`AttestationRecorded` exemptions, and 39/50 errors on validator plus 50/50 with LiteSVM. The measured late seal required raising the crank budget from 40,000 to 80,000 compute units. RPC outages now propagate unavailable instead of being mislabeled schedule drift.

Root checks passed (457 server files / 2,593 tests), PostgreSQL passed (59 files / 626 tests), and the final compute-budget/RPC regressions passed (2 files / 15 tests). Watch and live-board Chrome reruns passed (`/private/tmp/fc-v6-watch-board.log`). This establishes local v6 schedule and activation behavior, not remote deployment, full-duration driving or removal of optional on-chain pledges. The dependency gate documents a test-only `crypto-bigint` advisory exception after checking that it is absent from normal/build dependency paths; no blanket clean dependency claim is made.
