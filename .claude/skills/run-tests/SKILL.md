---
name: run-tests
description: Run the Freight Chain test suite locally, in order – lint/bundle/headless game check, landing tests, server unit + architecture audits, PostgreSQL integration, then real-Chrome runs against a freshly built server on a throwaway database – and report pass/fail and remaining coverage gaps. Use before a commit, before a deploy, when asked to "run the tests", "check everything", or to verify a change end to end. This is the project's test automation (there is no CI).
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

**From a git worktree** (or any branch whose migrations differ from another checkout's): all checkouts share `freightchain_test`, so another branch's
tables show up as "drift". Give this checkout its own (created + migrated automatically; the name must end in `_test`):

```sh
TEST_DATABASE_URL=postgresql://freight:freight_dev_password@localhost:15433/freightchain_<branch>_test npm run server:integration
```

If it fails with `P3009 … failed migrations` on `freightchain_test`: that database is disposable – mark it rolled back
(`DATABASE_URL=postgresql://freight:freight_dev_password@localhost:15433/freightchain_test server/node_modules/.bin/prisma migrate resolve --rolled-back <name>` from `server/`) and rerun.

## 3. Real Chrome end to end (~5 min)

`.claude/skills/run-tests/e2e.sh` does all of it: creates a throwaway database `freightchain_e2e_<pid>` in the same container, migrates it,
builds the landing + server into PRIVATE copies (`server/.e2e-build-<pid>/`, a temp dir for the landing – another session's `npm run build` /
`npm run check` empties `server/dist` + `landing/dist` mid-run, which once killed a suite with "Cannot find module dist/main.js"), starts the server on a free port, runs `server/scripts/e2e-browser.mjs` (20 s ride, asserts COMPLETED · VERIFIED),
`server/scripts/e2e-lobby.mjs` (3 s rides, the dev pool seeds via `SEED=1`, screenshots), `server/scripts/e2e-admin.mjs` (admin page: allowlist, queue, override, audit)
`server/scripts/e2e-watch.mjs` (running and training replay refusals, driver + spectator)
and `server/scripts/e2e-replay.mjs` (training/unknown replay refusals and removed donation effects) and `server/scripts/e2e-live-flags.mjs` (running free-ride watch/chat/donation refusals with flags on/off – two servers; all three are also the `replay-test` skill). These default fixtures do not establish a positive paid-replay playback/chat/tip journey,
and `landing/tools/e2e-wallet.mjs` twice – `wallet` (one origin) and `wallet-split` (landing on `app.localhost`, API on `api.app.localhost`, one cookie on the apex): the landing's sign-in, the redirect and the promo invite block,
and `server/scripts/e2e-live-board.mjs` (online / on the road / the replays history on the landing and in the lobby, fed by `scripts/sim-rides.mjs`; the `live-board-test` skill),
and `server/scripts/e2e-close.mjs` twice – `close` (one origin) and `close-split` (landing + lobby on `app.localhost`, the game on `ride.app.localhost`, the API on
`api.app.localhost`): a closed landing / lobby / watch page leaves "online" at once, a game tab closed mid-ride ends ABANDONED, Back to it comes from the
back/forward cache and reloads, a COMPLETE shift whose tab closes is COMPLETED + VERIFIED (~2 min each),
and `server/scripts/e2e-verified-play.mjs` (`verified`: the anti-bot checks with dispatch prompts – a person and a bot in Chrome, API-level bots, the CLI; ~3 min)
and `server/scripts/e2e-verified-deep.mjs` (`verified-deep`: every verdict code one by one with the prompts off, the upload protocol, who sees a verdict, the admin's signed hand on a flagged ride, the lobby profile in Chrome, retention + bulk re-judge on the database; ~2.5 min)
and `server/scripts/e2e-road-check.mjs` (`road`: honest/removed-hole drivers in Chrome with required frame proof, training replay refusal and database `ride-audit`; ~6–12 min on software WebGL) – all three are the `verified-play-test` skill,
and `server/scripts/e2e-blinks.mjs` (`blinks`: the Solana Actions through Dialect's own blink client `@dialectlabs/blinks-core` – discovery, CORS + metadata as dial.to needs them, both cards, every button POSTed, the buy's devnet transaction; program mode with a seeded pool, needs the devnet RPC; also `READONLY=1 BASE=https://freightchain.fun` for production),
then stops the server and drops the database – also on failure.

```sh
bash .claude/skills/run-tests/e2e.sh            # all thirty-one, including guest, weekly grant, referral, viewer, sim visuals, normal-physics controls and replay controls/tips
bash .claude/skills/run-tests/e2e.sh guest weekly referral viewer  # these four against a private server build and throwaway database
bash .claude/skills/run-tests/e2e.sh editor     # the model editor on storybook: the REAL entity MCP + the server's scripted model (EDITOR_FAKE_LLM=1) – sign-in, hand edit, history, signed publish, a chat job, the spec gate
bash .claude/skills/run-tests/e2e.sh browser    # one of: browser | lobby | admin | promo | watch | replay | flags | wallet | wallet-split | board | close | close-split | verified | verified-deep | road | stats | blinks | traffic | editor
```

Then **look at the screenshots** it prints (`fc-online-shots`, `fc-lobby-shots`, `fc-admin-shots`, `fc-watch-shots`, `fc-replay-shots`, `fc-flags-shots`, `fc-board-shots`, `fc-close-shots` in the OS temp dir) with the Read tool – the scripts
cannot judge layout. Say plainly what passed, what failed (with output), and what still needs a human eye.

The `traffic` and `road` suites require strict version-1 frame validation with real honest and modified Chrome clients; the legacy API matrices in `verified` and `verified-deep` explicitly run version 0. Historical reconstruction discrepancies remain review flags. Private client snapshots prevent concurrent source changes from altering a running suite. Set `E2E_POSTGRES_CONTAINER` and `E2E_POSTGRES_PORT` to use a separate running test PostgreSQL container (same compose test credentials); only the throwaway database is created/dropped there.

## 4. Optional: the money on a local chain (~4 min)

Not part of the default run (it needs `solana-test-validator` and the verifiable `.so`): `npm run test:localnet` (skill `localnet-e2e`) – real program
transactions against the real server and lobby: purchases, sponsorship, rides, refunds, the crank, expiry, payouts, every lamport. Run it after touching the
program, the chain adapters, the ticket / refund / payout / crank code or `client/site/pay.js`.

## Reporting

One line per stage: ✓/✗, test counts, duration. On red: the failing test names and the assertion output, nothing else.
