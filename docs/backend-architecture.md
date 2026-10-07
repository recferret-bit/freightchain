# Backend architecture (`server/`)

NestJS 12 · TypeScript (strict, native ESM) · Prisma 6 · PostgreSQL · Zod · CQRS (`@nestjs/cqrs`) · `jose` JWT · `@nestjs/throttler`.
The layout and the rules follow the reference backend `infection-strike/apps/game-backend`; what differs is listed at the end.

## Layers (`server/src/`)

```
main.ts            the only file directly in src/
app/               composition root: AppModule, configureApp() (request id, problem+json filter, trust proxy) – shared by main.ts and the tests
cli/               node dist/cli/index.js migrate | db:reset
domain/            pure TypeScript – entities, value rules, DTO shapes, errors.   imports: domain + bs58 only
application/       ports (abstract classes) · CQRS use-cases (command/query + handler) · services.   imports: domain, @nestjs/common, @nestjs/cqrs
infrastructure/    adapters that implement the ports: Prisma repositories + mappers, Solana (web3.js, price feeds), JWT (jose), tweetnacl, env, clock, HTTP plumbing
presentation/      thin controllers + Zod DTO schemas – dispatch a command or query, nothing else
```

Dependencies point inward: `presentation → application → domain` and `infrastructure → application/domain`. `presentation` reaches `infrastructure` only through `infrastructure/http` (decorators, guards, interceptors). Persistence / chain / JWT libraries never leave `infrastructure`.
`test/architecture/layer-architecture.spec.ts` enforces all of this from the source text.

### Bounded contexts

| context | domain | use-cases |
|---|---|---|
| auth / players | `Player` (free-ride credits, daily grant), `AuthChallenge` (Sign-In With Solana), wallet address | request-challenge, verify-signin, get-me, logout |
| rides | `Ride` (lifecycle + progress rules), tiers, report | create-ride, get-ride, get-pending-ride, start-ride, heartbeat-ride, end-ride |
| economy | `Round` (weekly pool), `Payment`, prize split, payment verification | get-payment-instructions, confirm-payment, reconcile-payment, get-tiers, get-pool, get-leaderboard |
| telemetry | `RideBatch` (one ~15 s recording batch: inputs + 10 Hz samples, hash-chained; `HasherPort` recomputes the SHA-256) | upload-batch (`POST /api/rides/:id/batches`) |
| verdict | `RideVerdict` + pure checks (`recording-checks.ts`: chain, bounds, agreement with the ride, coverage, inputs present · `human-checks.ts`: hold variation, repeated intervals, instant presses) – **no re-simulation**; `VerdictService` | judged by end-ride and by a batch landing after the end; read by get-ride, the paid leaderboards (verified only) and the profile |
| achievements | catalogue + rules, `AchievementUnlock` | (evaluated by end-ride / get-profile) |
| lobby | DTOs for the live feed and the profile | get-live, get-profile |
| health | – | get-readiness |

### Entity classes

Aggregates are classes with behaviour and private state, built through named constructors (`Ride.createFree`, `Ride.createPaidOrder`, `Player.register`, `Round.open`) or `restore(props)` for rows. State changes are methods that enforce the rules (`ride.start(now)`, `ride.applyReport(report, now, rules)`, `ride.finish(outcome, reason, now)`, `player.spendFreeRide()`); an illegal change throws a `DomainError`. `snapshot()` hands the data to a mapper.
Prisma rows ⇄ entities happens only in `infrastructure/prisma/mappers/*` (BigInt lamports ⇄ number, enums, Dates). Handlers and controllers never see a Prisma type.

### Ports and adapters

Every dependency of the application layer is an `abstract class …Port` (a Nest DI token). `infrastructure/infrastructure.module.ts` binds each to its adapter – and `test/architecture/api-contract-audit.spec.ts` fails if a port has no binding.
Time and randomness are ports too (`ClockPort`, `EntropyPort`): **every timestamp the server makes comes from `ClockPort`** – rows, JWT issue/expiry, cookie expiry; the database's `now()` is never used and only `infrastructure/time/system.clock.ts` may read the wall clock (audited). That is what lets the tests drive time. Likewise only `infrastructure/config/` reads `process.env` (audited, no exceptions – the CLI goes through `EnvService` too).

## HTTP contract rules (enforced by `api-contract-audit.spec.ts`)

1. Every request part goes through `@ZodBody / @ZodQuery / @ZodParams` – never a raw `@Body()` or an unvalidated type.
2. Every route returns a typed, non-empty DTO produced by its CQRS handler – never `void`/`unknown`/204; handlers are never `ICommandHandler<C, void>`.
3. Controllers never touch `@Res()` / `@Req()`. (The session cookie is set by `SetSessionCookieInterceptor`, which also unwraps the handler's `{ profile, session }` to the profile.)
4. Nothing throws a Nest `HttpException`; a validation error's `detail` is the field's own message (several: `path: message; …`); code throws `DomainError`s (`NotFoundError`, `ConflictError`, …) or lets Zod fail. The single global `ProblemDetailsFilter` renders **every** error as RFC 9457 `application/problem+json` (`type, title, status, detail, code, requestId, instance`, `errors[]` for validation), and every response carries `X-Request-Id`.
5. Every route produces its DTO **through the bus** (`this.commandBus/queryBus.execute`) – no controller answers by itself, health included.
6. Files stay ≤ 500 lines (`line-count-audit.spec.ts`).

**Split hosts (CORS + cookie domain)** – in production the pages and the API are different origins (`freightchain.fun` / `ride.*` → `api.*`, siblings = the same *site*). `configureApp` enables CORS only when `CORS_ORIGINS` is set: an exact-origin allowlist (no wildcard), `credentials: true`, `X-Request-Id` exposed. The session cookie stays `HttpOnly` + `SameSite=Lax` (+ `Secure` in production) and gets `Domain=COOKIE_DOMAIN` when set; `ClearSessionCookieInterceptor` must repeat the same Domain or the browser keeps the cookie. `APP_DOMAIN` / `APP_ORIGIN` are the page the rider signs in on (the apex). Tests: `test/http/cors.spec.ts` (preflight, stranger origin, cookie domain), `session-cookie.interceptor.spec.ts`, `env.*.spec.ts`.

**Rate limits** (`infrastructure/http/throttling.ts`, `@nestjs/throttler`, budgets per minute, counted per route and per tracker): `default` (`THROTTLE_LIMIT`) everywhere but `/api/health/*` – tracked per **signed-in wallet** when the session cookie verifies, else per IP (a forged cookie gains nothing); `auth` (`THROTTLE_AUTH_LIMIT`) on `/api/auth/*` per IP. Per-IP limits are only right if Express knows the real client IP: production **requires** `TRUST_PROXY` (number of proxy hops; 0 = none).

Wire format: paths stay under `/api/…`; timestamps are epoch milliseconds. The two intentional changes vs. the pre-refactor server: errors are problem+json (`detail` instead of `message`), and `POST /rides/:id/confirm` answers `200 {status:'pending'}` instead of `202`.

## Database

PostgreSQL, one PostgreSQL schema per context (`player`, `ride`, `economy`, `achievement`, `telemetry`, `verdict`), a multi-file Prisma schema (`prisma/schema.prisma` + `prisma/<context>/*.prisma`), migrations as reviewed SQL in `prisma/migrations/` (forward-only: no DROP / RENAME – `test/migrations`). A schema change **requires** a migration in the same change; `test/integration/migrations.integration.spec.ts` fails when the migrated database differs from the schema files.

Race-safety, because Prisma is async (every `await` lets other requests run):

| critical section | mechanism |
|---|---|
| one ride in hand per wallet; free-credit spend / refund; cancel-and-buy | `SELECT … FOR UPDATE` on the `Player` row inside one transaction (`findByWalletForUpdate`) |
| a LATE payment on a lapsed order (the wallet already holds a newer ride) | settlement runs under the same player lock: an unstarted free ride is cancelled (credit refunded), another unpaid order lapses. Two **paid** rides may coexist (both are owed) |
| at most one RUNNING ride per wallet | `StartRideHandler` under the player lock refuses while another ride runs (a stale one – tab gone – is failed first) |
| daily grant (lazy, on sight) | optimistic `version` on `Player` + retry (`PlayerSessionService`) |
| daily grant (midnight job) | ONE `UPDATE … WHERE freeDay < today` (idempotent, cap per row, bumps `version` so a concurrent optimistic save loses and re-reads); refunds clamp at `freeRidesMax` |
| sign-in challenge is single-use | `DELETE … RETURNING` (one atomic statement) |
| first request of a week | opening runs in one transaction; unique `Round.startsAt`; the loser rolls back and re-reads the winner's round |
| a payment settling across the week turn | settlement and round-opening both `SELECT … FOR UPDATE` the old round: the payment commits first (and is in the new round's 20 % carry) or finds the round closed and settles into the new one |
| a transaction pays one ride | `Payment.signature` primary key + unique `Payment.rideId`; settle runs in one transaction; the loser of a confirm/reconcile race answers `paid` (idempotent), never "already used" |
| heartbeat vs end | optimistic `Ride.version`; `end` retries so it always lands; the unlock evaluation after it is best-effort (never turns the saved verdict into a 500) |
| a recording batch re-sent / uploaded twice | primary key `(rideId, seq)` + `createMany … skipDuplicates` (one `ON CONFLICT DO NOTHING`): exactly one stores, every caller gets 200 |
| /end judging racing the late final batch | `VerdictService` judges under the player row lock and reads the batches only once it holds it: the judgement that saves last has seen every batch – a stale verdict never overwrites a fresher one |
| a pool exhausted by queued lock-waiters | transactions wait up to 8 s for a connection; Prisma's P2028 → 503 and P2034 (write conflict / deadlock) → 409 – both retryable, never a 500 |
| ties between equal timestamps | `Ride.seq` (BIGSERIAL, insertion order) as the tie-breaker |

## Tests (`server/test/`) – the pyramid

| level | where | what it proves | needs |
|---|---|---|---|
| **controller** | `test/unit/presentation/<ctx>.http.controller.spec.ts` | each route dispatches exactly the right command / query with the right arguments and returns its result; the Zod DTO schemas | nothing |
| **CQRS handler** | `test/unit/application/use-cases/<ctx>/<name>.handler.spec.ts` | every use-case on in-memory ports + real services (`test/support/unit-context.ts`): rules, errors, edge cases | nothing |
| **service** | `test/unit/application/services/<name>.service.spec.ts` | shared orchestration incl. the paths HTTP can't reach (lost locks, the round-race loser, the week turning mid-settle) | nothing |
| **repository** | `test/integration/repositories/<name>.integration.spec.ts` | every Prisma repository (and the transaction adapter, health probe, PrismaService) against real PostgreSQL: mapping, orderings, unique keys, **row locks really block** | Docker |
| domain · infrastructure units | `test/unit/domain`, `test/unit/infrastructure` | entity rules; adapters, guard, interceptors, filter, middleware, env, throttling | nothing |
| HTTP scenarios | `test/scenarios/*.scenarios.ts`, run by `test/http/flows.spec.ts` (in-memory) **and** `test/integration/flows.integration.spec.ts` (PostgreSQL) | the whole API through the real app (pipes, guard, filter, cookies, rate limits) – the same scenarios on both backends, so an in-memory twin that drifts from Prisma shows up | – / Docker |
| concurrency | `test/integration/concurrency.integration.spec.ts` | parallel `Promise.all` requests with exact counts for every race in the table above | Docker |
| audits | `test/architecture/*`, `test/migrations/*` | layer boundaries, HTTP contract, ≤ 500 lines, wiring, **pyramid completeness**, migration SQL; `test/integration/migrations.integration.spec.ts`: no drift between migrations and schema | – / Docker |

`test/architecture/test-pyramid.spec.ts` fails when a controller, handler, service, guard, interceptor, filter or adapter has no unit spec of its own, or a class that talks to PostgreSQL has no integration spec of its own – there is no allow-list.

`npm test` = everything that needs no database. `npm run test:integration:stack` = `db:up` + everything on PostgreSQL. The integration suite has a database of its **own**: `freightchain_test` in the same container (override: `TEST_DATABASE_URL`), created and migrated by its `globalSetup`; `truncateAllTables` asks the connected database for its own name (`current_database()`) and refuses anything not named `*_test` unless forced (only `db:reset` forces it, and the CLI refuses in production); the harness ignores the shell's `DATABASE_URL`. The developer's `freightchain` database is never touched (only `npm run db:reset`, explicitly, wipes it).
The fake clock starts in 2036: JWTs and cookies are dated by it, and the HTTP client's cookie jar compares cookie expiry with the REAL time.

## Differences from the reference backend

- **Reference things deliberately not adopted:** NATS / Redis, the IAP stack, admin users + API keys, the OpenAPI/Yaak generators, the plan-tracking / evidence meta-audits, the "one spec per handler" completeness audits (the handlers are covered through the HTTP scenarios), the `@infection-strike/contracts` package (the Zod schemas live next to the controllers; the client is vanilla JS).
- **Adopted:** layers + the layer audit, ports/adapters, CQRS, Zod decorators, problem+json filter, request ids, throttling, Prisma multi-file/multi-schema + hand-written additive migrations, `jose`, the unit / integration pyramid, line-count and API-contract audits.
- **Different on purpose:** the session is an httpOnly cookie (not a bearer token); the repo is ESM (`.js` import suffixes); `EnvService` validates `process.env` itself when the app is created (instead of `@nestjs/config`, whose `ConfigModule.forRoot` validates once at import time – which made per-app environments in tests stale). `.env` is loaded by `dotenv-bootstrap.ts`, imported FIRST in `main.ts` and `cli/index.ts` (ESM evaluates every static import before the importing file's body, so loading it from `main()` would be too late for modules that read the environment on import, e.g. the auth rate limit). Without `JWT_SECRET` (development only – production requires it) the server uses a random secret per boot, never a constant in the repo.
