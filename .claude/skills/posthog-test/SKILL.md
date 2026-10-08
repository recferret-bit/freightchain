---
name: posthog-test
description: >
  Smoke-test Freight Chain product analytics locally. Boots this checkout against a throwaway
  database, loads the landing in headless Chrome, and checks the relay plus one EU PostHog batch.
  Use when asked to test PostHog, test analytics, test the telemetry relay, or /posthog-test.
  Production is posthog-prod.
---

# PostHog smoke (local)

```sh
bash .claude/skills/posthog-test/smoke.sh
```

The script uses `FREIGHTCHAIN_POSTHOG_ROOT` when that tree has the adapter, otherwise this checkout, otherwise the `plan/posthog-integration` worktree. It creates `freightchain_ph_<pid>` in the local Postgres, migrates that database, builds that checkout's landing and server, and listens on a free port. Local `server/.env` pins `POSTHOG_ENABLED=0`, and the local compose file does not run the API, so a normal `npm run server:dev` sends nothing. The script exports `POSTHOG_ENABLED=1` for that process only (shell wins over `.env`). It does not edit `deploy/.env` and does not talk to production. `POSTHOG_DISABLED=1` still wins. Chrome loads `/`. The landing posts `landing_viewed`. Pass means the boot line is `analytics enabled host=https://eu.i.posthog.com`, `POST /api/telemetry` of `ride_completed` returns `dropped: 1`, and the outbound `POST /batch/` to `eu.i.posthog.com` returns 200. Screenshot: `/tmp/fc-posthog-landing.png`. Look at it.

The database is dropped on exit, including on failure. The dev database `freightchain` is not migrated and not queried. The script redacts `phc_` / `phx_` if a log line contains one. Do not print the token. Do not deploy.

Production ingest is `posthog-prod` (`bash .claude/skills/posthog-prod/check.sh`). Dashboard https://eu.posthog.com/project/297915/dashboard/1006663 stays empty until someone adds tiles. A 200 from ingest is the local check. `$create_alias` is not part of this smoke.

Needs the compose Postgres (`npm run db:up`), `server/` and `landing/` dependencies, and Chrome. If a worktree's `server/node_modules` is a symlink into this repo, `prisma generate` writes that client over this one; the script generates this checkout's client again before it exits.
