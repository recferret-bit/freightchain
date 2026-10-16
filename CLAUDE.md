@AGENTS.md

# Notes for Claude Code

- Before changing an area, read its `docs/agents/<topic>.md` (table in AGENTS.md) and use the matching skill from `README.md` → "Skills" (e.g. `gameplay-balance` for tuning, `3d-assets` for 3D objects, `run-tests` for the full suite).
- Pentest: `pentest run` orchestrates a one-shot Docker sandbox + MCP stdio bridge (`docker-agent-orchestrator.mjs`, `docker-mcp-bridge.mjs`) for `claude`, `codex`, `grok` and `agy` (`--blocked` for offline blocked records); selected-file profiles follow `pentest/docs/live-model.md` (Claude, `codex-native`, `grok-native`, `grok-docker`). `grok-docker setup/login` builds a Linux broker and obtains its own login in a dedicated Docker volume, never imports host credentials. Keep both skills identical.
- After visual / gameplay changes run `node tools/e2e-chrome.mjs` (in `client/`) and read the screenshots with the Read tool. Say plainly what was and wasn't verified – it can't judge "feel" (shake, smoke…), so tell the user what to eyeball.
- HONK on a local validator: `bash .claude/skills/honk-localnet/run.sh` (`SCENARIO=chain` is the token half). Full coin suite: `bash .claude/skills/honk-suite/run.sh`.

- Entity editor security: `docs/agents/editor.md`; production rate limits require Redis and a restricted MCP counter user; PostgreSQL owns the shared AI job queue; generation runs only in the dedicated process (`npm run editor:worker`).

## Workflow

1. Change the relevant module; new tunables go in `js/config.js`; a key change updates the maps (AGENTS.md "Maps stay current").
2. Verify (AGENTS.md "Verify"); for behaviour-preserving refactors diff the headless trace. Traffic/road kernels live in `client/shared/` with browser-reference fixtures in `server/test/fixtures/simulation/`; new rides require hashed traffic frames; historical sampled replay remains diagnostic. Full browser validation: `bash .claude/skills/run-tests/e2e.sh traffic`.
3. Keep answers short: what changed, which constant to tune, what is untested.
4. Stop at the commit (and the merge into `main`, if asked). Do NOT deploy: say it is ready and that `npm run deploy` would ship it. Only on an explicit deploy request follow `docs/agents/deploy.md` and report the release id and the smoke result.
