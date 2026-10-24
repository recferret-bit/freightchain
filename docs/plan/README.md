# docs/plan — Season 1 & Pre-season launch plans

Docs only. Authoritative product specifications and test plans live in [`docs/spec/`](../spec/README.md) (which supersedes `MASTER_PLAN.md` §§3, 5, 14 and the retired `OPEN_QUESTIONS.md`).

| File | Former working name(s) | Purpose |
|---|---|---|
| [`DEVNET_SOFT_LAUNCH.md`](DEVNET_SOFT_LAUNCH.md) | — | **Technical soft launch:** short readiness summary and ordered checklist for integrated devnet contracts, TEN4, NFTs, replays and ride validation |
| [`OWNER_TASKS.md`](OWNER_TASKS.md) | `OWNER_TASKS.md` | **Start here:** Checklist of external accounts, API keys, DNS/Cloudflare, wallets & legal actions required from the owner by phase |
| [`EXECUTION_ORCHESTRATOR.md`](EXECUTION_ORCHESTRATOR.md) | — | **Parallel Execution Orchestrator (Up to 4 Agents):** Single entry point (`work on docs/plan/EXECUTION_ORCHESTRATOR.md`) scheduling all 117 tasks from Plan 1 & Plan 2 across 6 Waves × 4 parallel conflict-free Agent Lanes (`Lane 1..4`) with DB/port isolation and barrier gates |
| [`E2E_HEADLESS_PLAN.md`](E2E_HEADLESS_PLAN.md) | — | **Plan 1 — Full Set of E2E Headless Tests:** Multi-tier headless E2E development plan (Track A As-Built + Track B Target Spec `*-T-*` / `AC-*`), with status board [`e2e-headless/STATUS.md`](e2e-headless/STATUS.md) and 9 domain issue files (`E2E-01`..`E2E-09`) with explicit DoR/DoD |
| [`SPEC_COMPLIANCE_PLAN.md`](SPEC_COMPLIANCE_PLAN.md) | — | **Plan 2 — Make All Code Follow Specs:** Full implementation plan to bring all code into compliance with `docs/spec/*.md` (`211` `*-M-*` rules, Decisions 1–68, B1–B10, Findings F01–F18), with status board [`spec-compliance/STATUS.md`](spec-compliance/STATUS.md) and 8 domain issue files (`SPC-01`..`SPC-08`) with explicit DoR/DoD |
| [`MASTER_PLAN.md`](MASTER_PLAN.md) | `MASTER_PLAN.md`, `GAPS.md` | Consolidated Season 1 & Pre-season plan, owner decisions, and launch gap matrix (`G1–G21` in §12) |
| [`DEVNET_PRESEASON.md`](DEVNET_PRESEASON.md) | `devnet_mini_launch_plan.md`, `PRESEASON_SPEC_AND_RUNBOOK.md` | Devnet Pre-season plan & decisions D1–D13 (Part I) + technical specification (`event_*`, Telegram/X, tie-splitting, RU/EN i18n) & Top-20 / `$500 USDC` payout runbook (Part II, §§10–17) |
| [`research/operator_entity_options.md`](research/operator_entity_options.md) | `operator_entity_options.md` | Operator entity options for Season 1 and individual-organizer analysis (Serbian tax resident / RF citizen) for Pre-season |
| [`research/tax_thresholds.md`](research/tax_thresholds.md) | `tax_thresholds.md` | US prize payout tax thresholds research (Form 1099-MISC `$2,000` threshold, W-9 / W-8BEN, 30% NRA withholding) |

## Issue Trackers (`e2e-headless/` & `spec-compliance/`)

- **Plan 1 (E2E Headless Tests):** [`e2e-headless/STATUS.md`](e2e-headless/STATUS.md) · Issues: [`E2E-01`](e2e-headless/issues/E2E-01-gates-and-census.md) · [`E2E-02`](e2e-headless/issues/E2E-02-http-contract-and-zod-schemas.md) · [`E2E-03`](e2e-headless/issues/E2E-03-http-zero-and-single-scenario-routes.md) · [`E2E-04`](e2e-headless/issues/E2E-04-headless-chrome-as-built.md) · [`E2E-05`](e2e-headless/issues/E2E-05-local-validator-and-chain-e2e.md) · [`E2E-06`](e2e-headless/issues/E2E-06-mockchain-and-replays-streams-e2e.md) · [`E2E-07`](e2e-headless/issues/E2E-07-anticheat-bots-and-resim-e2e.md) · [`E2E-08`](e2e-headless/issues/E2E-08-minigames-and-rides-ranking-e2e.md) · [`E2E-09`](e2e-headless/issues/E2E-09-admin-security-matrix-and-ci.md)
- **Plan 2 (Spec Compliance):** [`spec-compliance/STATUS.md`](spec-compliance/STATUS.md) · Issues: [`SPC-01`](spec-compliance/issues/SPC-01-backend-contract-and-validation.md) · [`SPC-02`](spec-compliance/issues/SPC-02-admin-and-privileged-security.md) · [`SPC-03`](spec-compliance/issues/SPC-03-rides-dynamic-finish-and-ride-result.md) · [`SPC-04`](spec-compliance/issues/SPC-04-replays-streams-donations-and-i18n.md) · [`SPC-05`](spec-compliance/issues/SPC-05-pool-schedule-appeals-and-program-v6.md) · [`SPC-06`](spec-compliance/issues/SPC-06-anticheat-v2-and-30hz-resim.md) · [`SPC-07`](spec-compliance/issues/SPC-07-minigames-framework-and-catalog.md) · [`SPC-08`](spec-compliance/issues/SPC-08-referral-convoy-ten4-airdrop-and-trust.md)

## Cross-references

- **Current local feature matrix and test results:** [`../testing/LOCAL_READINESS.md`](../testing/LOCAL_READINESS.md)
- **Open legal, tax & product questions:** [`../spec/OPEN.md`](../spec/OPEN.md) (replaces `OPEN_QUESTIONS.md`)
- **Authoritative domain specs & decisions:** [`../spec/README.md`](../spec/README.md), [`../spec/PRODUCT.md`](../spec/PRODUCT.md), [`../spec/DECISIONS.md`](../spec/DECISIONS.md)
- **Legal templates (`../legal/`):** [`../spec/legal.md`](../spec/legal.md), [`../legal/TERMS.md`](../legal/TERMS.md), [`../legal/PRIVACY.md`](../legal/PRIVACY.md), [`../legal/OFFICIAL_RULES.md`](../legal/OFFICIAL_RULES.md), [`../legal/PRESEASON_RULES.md`](../legal/PRESEASON_RULES.md), [`../legal/PRESEASON_RULES_RU.md`](../legal/PRESEASON_RULES_RU.md)

