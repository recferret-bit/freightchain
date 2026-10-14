@AGENTS.md

# Notes for Claude Code

- Before changing an area, read its `docs/agents/<topic>.md` (table in AGENTS.md) and use the matching skill from `README.md` → "Skills" (e.g. `gameplay-balance` for tuning, `3d-assets` for 3D objects, `run-tests` for the full suite).
- Pentest changes follow `pentest/README.md` and `pentest/docs/live-model.md`: no host fallback, exec RPC or credential import. Native adapters stay blocked; terminal results remain unverified. Test using inert responders and keep both skills identical.
- After visual / gameplay changes run `node tools/e2e-chrome.mjs` (in `client/`) and read the screenshots with the Read tool. Say plainly what was and wasn't verified – it can't judge "feel" (shake, smoke…), so tell the user what to eyeball.

## Workflow

1. Change the relevant module; new tunables go in `js/config.js`; a key change updates the maps (AGENTS.md "Maps stay current").
2. Verify (AGENTS.md "Verify"); for behaviour-preserving refactors diff the headless trace.
3. Keep answers short: what changed, which constant to tune, what is untested.
4. Stop at the commit (and the merge into `main`, if asked). Do NOT deploy: say it is ready and that `npm run deploy` would ship it. Only on an explicit deploy request follow `docs/agents/deploy.md` and report the release id and the smoke result.
