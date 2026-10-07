# Freight Chain server

NestJS 12 · TypeScript (ESM) · Prisma 6 · **PostgreSQL** · Zod · CQRS. Layers, rules and the test pyramid: [`../docs/backend-architecture.md`](../docs/backend-architecture.md).
The server also serves `../client` (the site and the game) from the same origin in development, so the session cookie needs no CORS. In production (`deploy/`) the site is split over `freightchain.fun` (landing + lobby), `ride.*` (game) and `api.*` (API): then `COOKIE_DOMAIN` (the cookie is shared by the subdomains) and `CORS_ORIGINS` (exact origins, credentials) are set – both are derived by the deploy.

## Run it

```sh
cp .env.example .env            # DATABASE_URL points at the compose Postgres below
npm install                     # also runs `prisma generate`
npm run db:up                   # PostgreSQL 17 in Docker on 127.0.0.1:15433 (project "freightchain")
npm run prisma:deploy           # apply the migrations
npm run treasury:init           # dev treasury key → data/treasury.json (without a treasury the paid tiers are disabled)
npm run start:dev               # http://localhost:3000   (from the repo root: npm run server:dev)
```

Production: `npm run build && npm run prisma:deploy && node dist/main.js` with `NODE_ENV=production`, **`JWT_SECRET`** (≥ 32 chars) and **`TREASURY_PUBKEY`** set (both are required then), a PostgreSQL `DATABASE_URL`, `APP_DOMAIN` / `APP_ORIGIN` = the public host, and `COOKIE_DOMAIN` / `CORS_ORIGINS` when the pages and the API live on different (sibling) hosts, and `TRUST_PROXY=<hops>` behind a reverse proxy (otherwise every rider shares one rate-limit bucket). `node dist/cli/index.js migrate` = `prisma migrate deploy`.

## Test it

```sh
npm test                        # the pyramid without a database: controller / CQRS handler / service / domain / infrastructure unit specs, audits (layers, HTTP contract, pyramid completeness), migration SQL, the HTTP surface on in-memory repositories
npm run test:integration:stack  # (from a git worktree whose migrations differ from main: TEST_DATABASE_URL=…/freightchain_<branch>_test first) db:up, then repository specs, the same HTTP scenarios on real PostgreSQL, concurrency and schema-drift checks – in its OWN database (freightchain_test, created + migrated automatically); your dev database is never touched
npm run typecheck && npm run lint
```

## API (all under `/api`; errors are RFC 9457 `application/problem+json`, every response has `X-Request-Id`)

| | |
|---|---|
| `POST auth/nonce {wallet}` | server-built Sign-In-With-Solana message (5 min, single use) |
| `POST auth/verify {wallet, signature(base58)}` | verifies ed25519 over the stored message → httpOnly `fc_session` cookie; body = the profile |
| `GET me` · `POST auth/logout` | profile (free rides left: 5 at signup, +1 per UTC day) · clears the cookie |
| `POST rides {tier:'free'\|'1h'\|'4h'\|'8h'}` | free: spends a credit → a ready ride. Paid: an **order** (`awaiting_payment`) with the locked lamports + a 10 min quote |
| `GET rides/pending` · `GET rides/:id` | the paid order the wallet is still owed · one ride (private to its owner) |
| `GET rides/:id/payment` | the unsigned SOL transfer (+ memo = ride id), built per click; 409 once the quote expired |
| `POST rides/:id/confirm {signature}` | `{status:'paid', ride}` or `{status:'pending'}` (not on chain yet – ask again) · 400 not a matching payment · 409 reused |
| `POST rides/:id/reconcile` | payment sent but confirm never came → find it in the wallet's recent transactions |
| `POST rides/:id/start` · `heartbeat {s,t,hull,paused,route,night}` · `end {outcome:'shift'\|'failed', …}` | the server times the ride and decides `completed / abandoned / failed`; a completed shift's answer carries its `verdict` |
| `POST rides/:id/batches {seq, prevHash, t0, t1, samples, inputs, hash}` | one ~15 s recording batch (verified play); taken while the ride runs and 60 s after it ended; a re-sent seq is a no-op `{stored:false}` |
| `GET tiers` · `GET pool` · `GET leaderboard?board=round\|all\|free` | public: tiers with live lamport prices + treasury · the weekly pool and its 50/20/20/10 split · top 20 by distance (paid boards: verified shifts only unless `VERDICT_ENFORCE=false`; `verifiedOnly` says which) |
| `GET live` · `GET profile` | public feed of rides on the road · the signed-in wallet's stats, last rides and achievements |
| `GET health/live` · `GET health/ready` | liveness · readiness (database ping; 503 problem+json when down) |
| `GET admin/overview` · `admin/rides?wallet&status&verdict` · `admin/rides/:id` · `admin/signins?wallet` · `admin/actions` · `admin/logs?level&q` | the admin page – **only for `ADMIN_WALLETS`, a 404 for everyone else** |
| `POST admin/rides/:id/verdict {decision:'verified'\|'rejected', note?}` · `POST admin/rides/:id/rejudge` | an admin's decision on a ride (a late batch keeps it) · run the checks again at the current rules (replaces a decision; also judges a completed shift that was never judged). Both need the `X-FC-Admin: 1` header and are audited |

Verified play: the verdict validates the recording (hash chain, governor, no teleports, ends where the ride ended, covers the driven time, gas pressed) and scores the input timing (flag-only) – `src/domain/verdict/`, thresholds in `verdict-rules.ts`. Settings: `VERDICT_ENFORCE` (false = shadow mode), `TELEMETRY_RETENTION_DAYS` (recordings swept daily at 00:30 UTC, flagged ones kept), `ADMIN_WALLETS`.
Logs: one JSON object per line in production (`{time, level, context, msg, …}`, a line per API request with status, ms, requestId, wallet); the newest 5000 are also served to the admin page.

Payments (Plan A): a plain SOL transfer to the treasury, verified on chain (any matching instruction among the transaction's, `meta.err` null, signer = the wallet, memo = ride id, signature unique). Completion is **server-timed telemetry, not a replay** – see `../docs/hackathon-plan-v2.md`.

## Scripts (`scripts/`)

`e2e-browser.mjs` (the game against a running server, real Chrome; drives with real key events and asserts COMPLETED · VERIFIED) · `e2e-lobby.mjs` (the whole lobby click-through, 3 Chromes + screenshots) · `e2e-admin.mjs` (the admin page: allowlist, queue, override, audit) – all three via `bash ../.claude/skills/run-tests/e2e.sh` on a throwaway database · `devnet-pay.mjs` (the paid loop on real devnet, needs a funded wallet) · `check-rpc-shape.mjs` (real devnet transactions through the payment verification, needs no SOL) · `treasury-init.mjs`.
