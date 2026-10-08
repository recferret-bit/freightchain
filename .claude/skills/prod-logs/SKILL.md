---
name: prod-logs
description: Read the PRODUCTION logs of Freight Chain (freightchain.fun) – the app container (NestJS), the postgres container, and the host's nginx access / error logs – read-only over ssh. Use when asked what happened on the live site, why a request failed, to find errors, a request id, a wallet's or a ride's activity, sign-ins, or after a deploy to check it is healthy.
---

# Production logs (read-only)

Everything goes through `npm run ops -- …` (`deploy/scripts/ops.sh` → `deploy/scripts/remote/ops.sh` over ssh). It reads `deploy/.env` for the host
(from a git worktree it falls back to the main checkout's `deploy/.env`). **It changes nothing on the server.**

Never run `npm run deploy`, `deploy:rollback`, `deploy:backup` or `deploy:smoke` (the smoke test creates a player) from this skill – they are the user's call.

## Commands (run from the repo root)

| what | command |
|---|---|
| containers, health, restarts, disk | `npm run --silent ops -- ps` |
| last N app lines | `npm run --silent ops -- logs --lines 200` |
| a time window | `npm run --silent ops -- logs --since 30m` (or `--since 2026-10-08T10:00:00`) |
| warnings / errors only | `npm run --silent ops -- logs --since 24h --errors` |
| one request | `npm run --silent ops -- logs --since 24h --grep '<request-id>'` (every response carries `X-Request-Id`; problem+json errors carry `requestId`) |
| one wallet / ride | `npm run --silent ops -- logs --since 24h --grep '<wallet or ride id>'` |
| sign-ins | `npm run --silent ops -- logs --since 24h --grep '"event":"signin"'` |
| admin sign-ins / admin decisions | `npm run --silent ops -- logs --since 24h --grep '"event":"admin-signin"'` · `--grep '"event":"admin"'` (also in the audit: `npm run ops -- query admin`) |
| refused recording batches | `npm run --silent ops -- logs --since 24h --grep '"event":"batch-refused"'` (the reason a ride's chain broke) |
| the database container | `npm run --silent ops -- logs --service postgres --lines 100` |
| nginx (all sites on the box share these files) | `npm run --silent ops -- nginx --lines 100` · `npm run --silent ops -- nginx --error --lines 50` · `--grep '/api/rides'` |

## Reading the app log

Since the structured-logging change the app writes **one JSON object per line**:
`{"time","level","context","msg", …}` and for every HTTP request `{"event":"request","method","path","status","ms","requestId","wallet?","ip"}`.
`level` is `log|warn|error|debug|verbose`; 5xx answers are logged at `error`, 4xx at `warn`. Older releases print Nest's coloured text instead.

Pipe through `jq` locally when it helps, e.g.:
`npm run --silent ops -- logs --since 1h | jq -c 'select(.event=="request" and .status>=500)'`

## Interpreting

- `connect() failed (111: Connection refused)` / `recv() failed (104…)` in the nginx error log at the same minute as a release = the app container being swapped (normal, a few seconds). At any other time = the app crashed or is restarting: check `ops -- ps` (restarts) and the app's `--errors`.
- `heartbeat lost` reasons, `implausible progress`, verdict `reasons` codes: see `AGENTS.md` (Verified play) and `server/src/domain/verdict/`.
- For database facts (rides, verdicts, payments) use the **prod-db** skill; for one wallet or ride end to end use **ride-investigate**.

Report what you found with the exact lines (trimmed) and the time range you looked at; say plainly if nothing matched.
