---
name: run-tests
description: Run the WHOLE Freight Chain test suite locally, in order – lint/bundle/headless game check, landing tests, server unit + architecture audits, the PostgreSQL integration suite, then the real-Chrome end-to-end runs (game + lobby, and admin) against a freshly built server on a throwaway database – and report pass/fail with the failing output. Use before a commit, before a deploy, when asked to "run the tests", "check everything", or to verify a change end to end. This is the project's test automation (there is no CI).
---

# Run every test (local, no CI)

Run from the repo root. Stop at the first red stage, show its output, fix or report. Never point a test at the dev database (`freightchain`) or production.

## 1. Fast checks (no Docker, ~2 min)

```sh
npm run check            # client lint + bundle + headless game test · landing lint/build/tests · server build + typecheck + unit tests + architecture/pyramid audits
cd client && npm run trace:diff   # only if a baseline was saved before a client change (npm run trace:save); "trace identical" = offline game behaviour unchanged
```

First time in a fresh checkout / worktree: `npm ci --prefix server && npm ci --prefix landing`.

## 2. PostgreSQL integration (~1 min)

```sh
npm run server:integration   # starts the compose PostgreSQL (127.0.0.1:15433), uses ITS OWN database freightchain_test
```

If it fails with `P3009 … failed migrations` on `freightchain_test`: that database is disposable – mark it rolled back
(`DATABASE_URL=postgresql://freight:freight_dev_password@localhost:15433/freightchain_test server/node_modules/.bin/prisma migrate resolve --rolled-back <name>` from `server/`) and rerun.

## 3. Real Chrome end to end (~5 min)

`.claude/skills/run-tests/e2e.sh` does all of it: creates a throwaway database `freightchain_e2e_<pid>` in the same container, migrates it,
builds the landing + server, starts the server on a free port, runs `server/scripts/e2e-browser.mjs` (20 s ride, asserts COMPLETED · VERIFIED),
`server/scripts/e2e-lobby.mjs` (3 s rides, 33 checks, screenshots) and `server/scripts/e2e-admin.mjs` (admin page: allowlist, queue, override, audit),
then stops the server and drops the database – also on failure.

```sh
bash .claude/skills/run-tests/e2e.sh            # all three
bash .claude/skills/run-tests/e2e.sh browser    # one of: browser | lobby | admin
```

Then **look at the screenshots** it prints (`fc-online-shots`, `fc-lobby-shots`, `fc-admin-shots` in the OS temp dir) with the Read tool – the scripts
cannot judge layout. Say plainly what passed, what failed (with output), and what still needs a human eye.

## Reporting

One line per stage: ✓/✗, test counts, duration. On red: the failing test names and the assertion output, nothing else.
