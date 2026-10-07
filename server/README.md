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
| `POST /api/rides {tier:'free'}` | spends a free credit, returns `{id, seed, minSeconds, completeDist}` |
| `POST /api/rides/:id/start` · `/heartbeat {s,hull,paused}` · `/end {outcome:'shift'\|'failed', s, hull}` | the server times the ride and decides `completed / abandoned / failed` |

Not security: this is server-timed telemetry, not a replay of the sim (see ../docs/hackathon-plan.md).
