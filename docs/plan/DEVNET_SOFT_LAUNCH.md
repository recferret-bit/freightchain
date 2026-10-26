# Devnet soft launch readiness

Updated 25 October 2026. First milestone: verify **every app feature locally across frontend, backend and blockchain**, following the accepted rules. Devnet readiness follows only after that local gate passes.

**Status: the complete local gate and integrated devnet readiness remain open.** The boards previously reported 117/117 tasks done. The 24 October audit reopened six implementation tasks: Plan 2 now has 47/53 marked done. Current test evidence and gaps are recorded below; task checkboxes and the green census do not establish complete feature readiness.

Current execution record and feature matrix: [local readiness](../testing/LOCAL_READINESS.md).

The existing [Pre-season plan](DEVNET_PRESEASON.md) describes an event with many chain features disabled. This checklist prepares the broader technical soft launch; the $500 promotional event remains a separate milestone. [Product behavior](../spec/PRODUCT.md), [accepted decisions](../spec/DECISIONS.md) and the [coverage contract](../testing/COVERAGE_CONTRACT.md) govern implementation.

## What is needed from the owner

**Nothing is needed to start the local inventory, tests and fixes.** Use isolated test databases, local Redis, scratch wallets and `solana-test-validator`; no real funds or devnet deployment are required.

Owner input is needed only for a specific unresolved product decision, unavailable external-service credentials for a real integration check, or wallet/phone interactions the harness cannot automate. Check existing configuration by key presence before requesting credentials; never put secret values into this checklist. Local provider fixtures prove application behavior, not real Telegram/X/Turnstile, AI-provider or analytics delivery. Record those live checks separately and keep them open until verified. Devnet deployment remains a later explicit request.

## Every feature means

Build the acceptance matrix from the actual pages, controls, routes, workers, program instructions and accepted rules, using this minimum inventory. Every row needs applicable positive, refusal and recovery checks; a missing test is open, not passed.

| Feature group | Local coverage required |
|---|---|
| Entry and identity | Landing, wallet sign-in/logout, guest, SNS, phone pairing, profile, agreements, geo and EN/RU |
| Driving | EASY/MEDIUM/HARD, tutorial/assist, paid ride, controls, gearbox/engine, road/forks, traffic, damage, weather, finish and timeout |
| Ride verification | Telemetry, traffic proof, honest/tampered rides, verdicts, disconnect/sweeper, rejudge and appeals |
| Economy | Weekly grants, promo codes, ticket orders, Solana Pay, Blinks, confirmation/reconciliation, expiry and duplicate protection |
| Pools | Local program lifecycle, sponsor funding, schedule, ranking, review, payouts, cancel/refund and operator commands |
| TEN4 and garage | Rewards, supply/buckets, swap, burn, claims/vesting, frozen part NFTs, ownership and rendered loadout |
| Achievements | All 44 earnable badges, metadata, delayed cNFT mint, ownership, transfer refusal and retry/exclusion |
| Viewing and social | Live board, permitted replays, receipts, playback controls, mobile viewing, chat/moderation, tips and donation history |
| Referrals and campaign | Legacy/Convoy rules, gifts, reward holds, privacy, social binding, claim uniqueness and persistence |
| Admin and editor | Every admin tab/action, roles, signatures, revocation, audit/alerts; model viewer, revisions, AI queue/worker, MCP and publish |
| Platform | Statistics, analytics opt-in, error reporting, landing/whitepaper/pitch deck, host routing, startup, migrations and recovery |
| Optional and retired paths | Test supported feature modes in isolated configurations and their off-state refusals, including pledges and phone-sms; retired behavior stays refused |

Use real Chrome against the real API and PostgreSQL/Redis. Chain flows must sign and execute on a local validator, including the dependencies needed for cNFTs; mocked mint success does not close that row. Keep production defaults unchanged while exercising optional modes locally. Record unavailable dependencies and manual checks explicitly.

## Remaining gaps

| Area | What remains |
|---|---|
| Contracts | Local v6 activation, explicit schedule and cadence are implemented; the reproducible pinned build and full validator lifecycle passed. New on-chain pledges are now refused and historical recovery passed; final merged acceptance remains open. Deployment records still describe devnet v3; fresh-program cutover and live verification require a separate authorized deployment. |
| TEN4 | Local token tests exist; prove the app's ledger, on-chain rewards, burns and garage purchases work together on devnet. |
| NFTs | Metadata covers 31/44 earnable achievement badges. All 44 assets now validate offline; publish the other 13 URIs and verify the remote collection/tree and wallet receipts. Real local Bubblegum/PostgreSQL mint-worker acceptance now passes. |
| Referrals and campaign | Convoy/airdrop now persist in PostgreSQL with concurrency and HTTP coverage. Convoy milestone chain settlement and recovery now pass on a local validator. Real X, Telegram and Turnstile verification, campaign payouts/UI remain open. Convoy profile, public bind replacement, conservative historical transition and effective signed operator controls with activation snapshots are implemented; monthly token caps remain immutable program limits. See the 26 October local-readiness entries. |
| Validation and viewing | The accepted judge is 10 Hz. Production compose defaults to shadow verdict enforcement. Running rides are intentionally unavailable to spectators; replays are the accepted viewing surface. |
| Deployment | Strict Compose defaults, alert-variable forwarding and new-env session keys are fixed; the production Docker/RPC rehearsal passed 22 checks, including real signed purchases/refunds and outage recovery. Real alert/provider delivery and production env preparation remain open. |

Evidence: [contract task](spec-compliance/issues/SPC-05-pool-schedule-appeals-and-program-v6.md), [repository wiring](../../backend/server/src/infrastructure/infrastructure.module.ts), [social adapters](../../backend/server/src/infrastructure/social/), [NFT metadata](../../backend/server/src/domain/achievements/nft-metadata-uris.ts), [compose](../../infra/deploy/docker-compose.prod.yml), [startup checks](../../backend/server/src/infrastructure/config/env.schema.ts).

## Ordered checklist

- [x] **1. Inventory and baseline every feature.** Completed 24 October: [56-area matrix and execution record](../testing/LOCAL_READINESS.md), failures/skips documented, discovered app/test defects fixed and six implementation tasks reopened. The aggregate full run is not accepted as green; corrected road and controls runs passed separately. Missing feature coverage and implementation remain work for steps 3–7. Preserve Decisions 69/70: 10 Hz judge, telemetry v2.1/minigames off by default, pool rules through CLI. Any change to live spectating or these defaults needs its own decision.
- [ ] **2. Fix deployment configuration.** Align compose, env schema and examples; pass required alert credentials; use `LIVE_EFFECTS=off`. Prove API and workers boot locally in production mode. Check migrations, Redis, RPC, alerts and backup/restore with test resources.
  Local strict startup, migrations, real backup/restore, cache/database outages and process restarts passed on 25 October (`npm run test:production:local`). The RPC-enabled extension passed on 26 October, including wallet signatures, exact settlement/refunds and API/RPC recovery. Real alert delivery remains open; real deployment env files were not changed.
- [ ] **3. Complete contract rules.** Implement accepted pool activation, schedule, ticket expiry and payout rules across program and server. Pass LiteSVM, IDL/build checks and the local-validator lifecycle, including cancellation, appeals and duplicate payout protection. Keep the escrow open-items document current.
- [ ] **4. Complete durable referrals and campaign integration.** Replace memory repositories with PostgreSQL adapters and transactional uniqueness. Wire real social verification and configured Turnstile. Verify restart persistence, concurrent claims, reward holds and accepted campaign-to-attempt rules. Track live provider checks separately from local fixtures.
  PostgreSQL adapters, transaction rollback, social uniqueness, concurrent caps and usable 1h Convoy gifts passed on 25 October. Real provider verification and the remaining target integration are still open.
- [ ] **5. Complete token and NFT integration.** Prove verified paid rewards reach the correct wallet once; rejected/ineligible rides earn nothing. Verify burns and frozen garage parts, reconcile chain and ledger balances, supply all 44 badge URIs, and exercise cNFT delay, retry and rejected-ride exclusion.
  Real local cNFT minting, proof, frozen-transfer refusal, unfrozen control, delay, rejected-ride exclusion, receipt recovery and duplicate protection passed on 25 October (`npm run test:nft:localnet`). Metadata publication and the complete token/browser journey remain open.
- [ ] **6. Prove ride enforcement and replay behavior.** Use the accepted 10 Hz pipeline. Test explicit `VERDICT_ENFORCE=true` locally, including its effect on ranking, rewards and badges. Exercise honest and tampered rides, missing traffic proof, disconnects, timeout, appeals, replay access, chat and signed tips. Keep known non-rejects explicit.
  Eligible replay playback, phone controls/chat and signed local-validator tips passed on 25 October; both are now in the default Chrome runner. Full-length enforced driving remains open.
- [ ] **7. Pass the complete local gate.** Fix failures and missing coverage across every inventory group, including features beyond the gaps listed above. Run `npm run test:ci:full` plus every required check it does not execute. Complete at least one full-length, normal-speed ride in real Chrome. Finish wallet extension/phone checks or explicitly report them open. Record commit, configuration, commands, screenshots, database effects and local-chain transactions. No skipped, mock-only or untested applicable row may be called fully working.
- [ ] **8. Deploy and verify on devnet when explicitly requested.** Prepare program hashes/IDs, migration and old-pool settlement steps, configuration and recovery instructions first. After authorization, deploy and repeat the integrated journey with real test wallets; record ride IDs, transactions and received assets.
- [ ] **9. Run an invited pilot.** Have a small group complete the same journeys. Check false rejections, queue recovery, RPC failures and operator alerts. Expand access only when every in-scope acceptance row has evidence and no launch blocker remains.

**Local gate first:** every inventory row passes its applicable checks, plus the integrated journey: wallet sign-in → local-chain ticket → full ride → enforced verdict → ranking/review → pool payout → TEN4 reward/burn → garage NFT and achievement cNFT → eligible replay/chat/tip. Devnet preparation begins after this gate; steps 8–9 repeat the release checks remotely. Live provider checks remain a separate requirement before claiming those integrations work end to end.

Deployment and pool creation require an explicit owner request. This checklist does not authorize either, change flags, or override accepted product decisions.
