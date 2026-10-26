# Sign-in privacy handoff

Wallet and guest sign-ins retain wallet, timestamp and an optional `ipHash`, produced by HMAC-SHA256 over a canonical IPv4 /24 or IPv6 /48 prefix with a versioned purpose separator. IPv4-mapped IPv6 normalizes to IPv4. Invalid input or a missing local key produces no signal. No raw IP, User-Agent or browser fingerprint reaches player sign-in storage or player sign-in application logs. Admin/editor audit browser context remains separate for privileged incident review; it is not a device identity.

The admin sign-in, player detail and sessions views show a truncated subnet hash with its full hash on hover, or unavailable. Existing shared-network pool review compares hashes; it does not establish that wallets belong to one person. No ASN/funding penalty was added.

Before the next authorized deployment, the owner must set `IP_HASH_SECRET` to independent cryptographically random 32 bytes encoded as 64 hex characters and change any old `SIGNIN_RETENTION_DAYS=180` or 0 to a value 1–90 (default 90). Production refuses startup without the key. The deployment initializer generates it for new installations; it does not overwrite existing env files. Never reuse or print another signing secret. Rotation intentionally stops correlation with old hashes. All production services receive the key; local absence disables only network correlation, not login.

Migration 20261119000000 intentionally and irreversibly drops existing player sign-in raw IP and browser columns. Old rows retain wallet/time with null hash; historical raw values cannot be recovered from the migrated database. Review backup retention separately: schema migration cannot erase older backups. The daily sweep deletes rows older than the configured 1–90 days. It defensively caps legacy invalid runtime values at 90 rather than keeping records forever.

Verification covers canonical/invalid IP forms and key separation, successful and failed wallet auth, guest privacy, admin HTTP response fields, PostgreSQL storage/projections/retention and production env generation/validation. No real provider calls, live credentials or browser fingerprinting are involved.

Local evidence: server unit/HTTP suite 465 files, 2670 tests; PostgreSQL 61 files, 642 tests including schema drift; real Chrome privacy fixture passed with screenshots inspected. The additional campaign refusal cases passed independently on both HTTP backends. `npm run test:census -- self-test` passes after explicit scenario registration.

The root gate passed client, parity, ticket stub, census, landing build/tests, server build/typecheck and server tests. The worktree initially lacked MCP/media dependencies; after linking the already installed local dependencies, the remaining MCP suite passed 12 tests (one existing skip), and media lint plus 35 tests passed.
