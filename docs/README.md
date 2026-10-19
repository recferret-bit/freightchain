# Freight Chain — Documentation Index

Read the same tree as a book: [Docs wiki](./wiki.html). It opens every folder and page, and keeps the headings, tables, and section breaks.

This directory is organized into seven top-level categories:

| Category | Directory | Purpose |
|---|---|---|
| **Product Specification** | [`spec/`](./spec/README.md) | Canonical as-built product specs, target decisions, domain specs, and consolidated open product/legal questions (`OPEN.md`). |
| **Launch & Preseason Planning** | [`plan/`](./plan/README.md) | Master launch roadmap (`MASTER_PLAN.md`, including the `G1–G21` gap status matrix), Devnet Preseason product spec & ops runbook (`DEVNET_PRESEASON.md`), owner checklist (`OWNER_TASKS.md`), and jurisdiction/tax research (`research/`). |
| **Technical Architecture & Visual Explainers** | [`tech/`](./tech/) | Server Clean Architecture (`backend-architecture.md`), environment & runtime settings (`configuration.md`), Solana program deploy & v5 cutover (`program-deploy.md`, `escrow-open-items.md`), and interactive HTML explainers (`anti-cheat/`, `verified-play/`, `pool-program/`, `localnet-e2e/`, `replay-and-donations/`, `ten4/`). |
| **Testing & Coverage** | [`testing/`](./testing/) | Coverage contract (`COVERAGE_CONTRACT.md`), E2E test plan (`E2E_PLAN.md`), manual Chrome/Phantom test suite (`MANUAL_TESTS.md`), implementation plan (`IMPLEMENTATION_PLAN.md`), and automated test census (`test-coverage.md`, `test-coverage/index.html`). |
| **Legal Texts** | [`legal/`](./legal/) | Live markdown sources rendered on `/terms`, `/privacy`, `/rules`, and `/preseason` (`TERMS.md`, `PRIVACY.md`, `OFFICIAL_RULES.md`, `PRESEASON_RULES.md`, `PRESEASON_RULES_RU.md`). Target legal requirements live in [`spec/legal.md`](./spec/legal.md). |
| **Product Insights, Analytics & Audits** | [`insights/`](./insights/) | PostHog funnel & event reference (`analytics/index.html`, `analytics/updates/`), live traction snapshots (`traction/latest.json`), and security reviews (`reviews/audit-2026-10/fix-plan.md`, `reviews/entity-editor-security.md`). |
| **Agent Operational Guides** | [`agents/`](./agents/) | Concise subsystem maps and hard rules for coding agents (`repo.md`, `client.md`, `world.md`, `gameplay.md`, `server.md`, `admin-ops.md`, `ten4-localnet.md`, `media.md`, `landing.md`, `verifying.md`, `deploy.md`). Entry point: [`../AGENTS.md`](../AGENTS.md). |

---

## Quick Navigation by Topic

### 1. Product & Domain Specs (`spec/`)
- [Index & Reading Order](./spec/README.md) · [Spec Process](./spec/PROCESS.md)
- [As-Built Product Baseline (`PRODUCT.md`)](./spec/PRODUCT.md)
- [Target Decisions (`DECISIONS.md`)](./spec/DECISIONS.md) · [Open Questions (`OPEN.md`)](./spec/OPEN.md)
- Domain Specs: [Rides](./spec/rides.md) · [Pool & Escrow](./spec/pool.md) · [TEN4 Token & Garage](./spec/ten4.md) · [Promo Codes](./spec/promocodes.md) · [Referral](./spec/referral.md) · [Replays, Streams & Donations](./spec/replays_streams.md) · [Anti-Cheat](./spec/anticheat.md) · [Web3 & Solana](./spec/web3_solana.md) · [Platform Services](./spec/platform_services.md) · [Admin & Security](./spec/admin_security.md) · [Minigames](./spec/minigames.md) · [Backend Contract](./spec/backend_contract.md) · [E2E Spec](./spec/e2e.md) · [Legal & Compliance Spec](./spec/legal.md)

### 2. Launch Plans & Legal (`plan/`, `legal/`)
- [Plan Index](./plan/README.md) · [Master Launch Plan & Gap Status (`MASTER_PLAN.md`)](./plan/MASTER_PLAN.md)
- [Devnet Preseason Plan, Spec & Runbook (`DEVNET_PRESEASON.md`)](./plan/DEVNET_PRESEASON.md)
- [Owner Action Checklist (`OWNER_TASKS.md`)](./plan/OWNER_TASKS.md)
- Research: [Operator Entity Options](./plan/research/operator_entity_options.md) · [Tax Thresholds](./plan/research/tax_thresholds.md)
- Live Legal Pages: [Terms of Use](./legal/TERMS.md) · [Privacy Policy](./legal/PRIVACY.md) · [Official Rules](./legal/OFFICIAL_RULES.md) · [Preseason Official Rules (EN)](./legal/PRESEASON_RULES.md) · [Preseason Official Rules (RU)](./legal/PRESEASON_RULES_RU.md)

### 3. Architecture, Operations & Visual Explainers (`tech/`)
- [Backend Clean Architecture (`backend-architecture.md`)](./tech/backend-architecture.md)
- [Configuration & Runtime Settings (`configuration.md`)](./tech/configuration.md)
- [Solana Program Deploy Runbook (`program-deploy.md`)](./tech/program-deploy.md) · [Escrow Open Items & v5 Cutover (`escrow-open-items.md`)](./tech/escrow-open-items.md)
- Visual Explainers (HTML):
  - [Anti-Cheat Architecture](./tech/anti-cheat/index.html)
  - [Verified Play & 10 Hz Replay Engine](./tech/verified-play/index.html)
  - [Pool Escrow Program](./tech/pool-program/index.html)
  - [Localnet E2E Harness](./tech/localnet-e2e/index.html)
  - [Replays, Live Streams & Donations](./tech/replay-and-donations/index.html)
  - [TEN4 Tokenomics](./tech/ten4/index.html) · [TEN4 Design Stress-Test (`grill.html`)](./tech/ten4/grill.html)

### 4. Testing, Analytics & Security Reviews (`testing/`, `insights/`)
- [Coverage Contract (`COVERAGE_CONTRACT.md`)](./testing/COVERAGE_CONTRACT.md) · [Test Census (`test-coverage.md`)](./testing/test-coverage.md) ([HTML](./testing/test-coverage/index.html))
- [E2E Test Plan (`E2E_PLAN.md`)](./testing/E2E_PLAN.md) · [Manual Test Plan (`MANUAL_TESTS.md`)](./testing/MANUAL_TESTS.md) · [Implementation Plan (`IMPLEMENTATION_PLAN.md`)](./testing/IMPLEMENTATION_PLAN.md)
- [Analytics Reference (`analytics/index.html`)](./insights/analytics/index.html) · [Traction Snapshot (`traction/latest.json`)](./insights/traction/latest.json)
- [Oct 2026 Security Audit Fix Plan](./insights/reviews/audit-2026-10/fix-plan.md) · [3D Entity Editor Security Review](./insights/reviews/entity-editor-security.md)
