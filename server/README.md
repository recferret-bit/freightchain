# Freight Chain server (NestJS)

TypeScript / ESM, Node ≥ 22 (uses the built-in `node:sqlite`). Serves the API under `/api` and the `../client` folder (override with `CLIENT_DIR`), so pages and API share one origin.

```sh
npm install
npm run start:dev      # http://localhost:3000
npm run test:e2e       # wallet sign-in + free rides + ride lifecycle (in-memory DB, fake clock)
```

Config: see `.env.example`. `JWT_SECRET` is mandatory with `NODE_ENV=production`.

| Endpoint | |
|---|---|
| `POST /api/auth/nonce {wallet}` | server-built Sign-In-With-Solana message (5 min, single use) |
| `POST /api/auth/verify {wallet, signature(base58)}` | verifies ed25519 over the stored message → httpOnly `fc_session` cookie |
| `GET /api/me` · `POST /api/auth/logout` | profile (free rides left; +1 per UTC day, 5 at signup) |
| `GET /api/tiers` · `GET /api/pool` · `GET /api/leaderboard?board=round\|free` | public: tiers with live lamport prices + treasury · the weekly pool and its 50/20/20/10 split (lamports; `usd` is ≈) · top 20 by distance of completed rides |
| `POST /api/rides {tier:'free'\|'1h'\|'4h'\|'8h'}` | free: spends a credit → a ready ride. Paid: an **order** (`awaiting_payment`) with the locked lamports + a 10 min quote. Returns `{id, seed, minSeconds, completeDist, timeScale, …}` |
| `GET /api/rides/:id/payment` | the unsigned transfer (+ memo = ride id) to sign – built per click (blockhash). 409 once the quote expired |
| `POST /api/rides/:id/confirm {signature}` | 200 `paid` · **202 `pending`** (not on chain yet, poll) · 400 not a matching payment · 409 reused signature. A matching payment is honoured after the quote expired |
| `POST /api/rides/:id/reconcile` · `GET /api/rides/pending` | payment sent but confirm never came → find it in the wallet's recent transactions · the order the wallet is still owed |
| `POST /api/rides/:id/start` · `/heartbeat {s,hull,paused}` · `/end {outcome:'shift'\|'failed', s, hull}` | the server times the ride and decides `completed / abandoned / failed` |

Payments (Plan A): a plain SOL transfer to the treasury, verified on chain (any matching instruction among the transaction's, `meta.err` null, signer = the wallet, memo = ride id, signature unique). `npm run treasury:init` creates a dev treasury; `node scripts/devnet-pay.mjs` runs the whole loop on real devnet (needs a funded devnet wallet).

Not security: this is server-timed telemetry, not a replay of the sim (see ../docs/hackathon-plan.md).
