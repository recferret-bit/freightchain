@AGENTS.md

# Notes for Claude Code

- Before changing an area, read its `docs/agents/<topic>.md` or `docs/spec/<topic>.md` (table in AGENTS.md) and use the matching skill from `README.md` → "Skills" (e.g. `gameplay-balance` for tuning, `3d-assets` for 3D objects, `run-tests` for the full suite).
- Audit: `audit run` orchestrates a one-shot Docker sandbox + MCP stdio bridge (`docker-agent-orchestrator.mjs`, `agent-session.mjs`, `docker-mcp-bridge.mjs`) for `claude`, `codex`, `grok` and `agy` in parallel (one assignment per provider; shared test runs serialized) (`--blocked` for offline blocked records); Source security review permits inspection and catalogued existing tests only (`--test-artifacts <cargo-target-dir>` supplies hash-checked `deploy/*.so` with unverified build provenance; `--restart-failed` requests new full reviews for local session failures, never provider refusals), with no arbitrary execution, PoCs or deployed probes; persistent ACP sessions bind workflow/source/model/assignment, and failed exits/missing verdicts remain incomplete with log diagnostics. `setup-agents` installs locked ACP adapters; `check-agents` checks availability, `check-agents --live` qualifies inert read/resume/submission. Selected-file profiles follow `tests/audit/docs/live-model.md` (Claude, `codex-native`, `grok-native`, `grok-docker`). `grok-docker setup/login` builds a Linux broker and obtains its own login in a dedicated Docker volume, never imports host credentials. Keep both skills identical.
- After visual / gameplay changes run `node tools/e2e-chrome.mjs` (in `frontend/client/`) and read the screenshots with the Read tool. Say plainly what was and wasn't verified – it can't judge "feel" (shake, smoke…), so tell the user what to eyeball.
- TEN4 on a local validator: `bash .claude/skills/honk-localnet/run.sh` (`SCENARIO=chain` is the token half). Full coin suite (verified ride, durable emission recovery, Convoy settlement, distribution, vesting and allocation burns): `bash .claude/skills/honk-suite/run.sh`.

- Entity editor security: `docs/spec/platform_services.md`; production rate limits require Redis and a restricted MCP counter user; PostgreSQL owns the shared AI job queue; generation runs only in the dedicated process (`npm run editor:worker`).

- Referrals: `docs/spec/referral.md` (invites, free-ride gifts, and spectator-tip sharing; Pool v5 removes the on-chain 5% pool leg).

## Workflow

Integrated devnet release checklist: `docs/plan/DEVNET_SOFT_LAUNCH.md`; local feature evidence: `docs/testing/LOCAL_READINESS.md`. Deployment still requires an explicit owner request.

The full Chrome runner includes `guest`, `weekly`, `referral`, `viewer`, `sim` controls, eligible replay controls/chat, and signed local-chain replay tips (30 suites); `test:ci:full` also runs both Rust programs' tests and `test:production:local` for isolated Docker startup/RPC/recovery. Details in `docs/agents/verifying.md`.

1. Change the relevant module; new tunables go in `js/config.js`; a key change updates the maps (AGENTS.md "Maps stay current").
2. Verify (AGENTS.md "Verify"); happy-dom is `npm run test:e2e:block1` and `npm run test:e2e:block2` (disposable host validator; `docs/testing/E2E_PLAN.md`) and does not replace Chrome. `npm run test:e2e:block3` is the anticheat vitest suite and does not replace Chrome either. The bar is `docs/testing/COVERAGE_CONTRACT.md`. For behaviour-preserving refactors diff the headless trace. Traffic/road kernels live in `frontend/client/shared/` with browser-reference fixtures in `backend/server/test/fixtures/simulation/`; new rides require hashed traffic frames; historical sampled replay remains diagnostic. Full browser validation: `bash .claude/skills/run-tests/e2e.sh traffic`.
3. Keep answers short: what changed, which constant to tune, what is untested.
4. Stop at the commit (and the merge into `main`, if asked). Do NOT deploy: say it is ready and that `npm run deploy` would ship it. Only on an explicit deploy request follow `docs/agents/deploy.md` and report the release id and the smoke result.


Local achievement cNFTs: `npm run test:nft:localnet` runs pinned Bubblegum/MPL-Core programs, the real mint adapter/worker and PostgreSQL; first use downloads public program bytes from devnet read-only. It is included in `test:ci:full`. See `docs/spec/web3_solana.md`.

Pool v6 is local-only: explicit opens/last-start, independent series cadence, zero-sale activation and admin/expiry refunds. CLI defaults and fresh-program cutover are in `backend/programs/README.md`; do not upgrade live v3 accounts in place.
