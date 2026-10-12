# Project: Freight Chain Native SIWS & Solana Name Service (SNS)

## Architecture
- **Clean Architecture Boundaries (`server/`)**:
  - `domain`: Pure business entities and domain rules (`domain/auth`, `domain/sns`). Zero external frameworks or web3 dependencies. Pure TypeScript and `bs58`.
  - `application`: CQRS use cases, command/query handlers, and application ports (`NameServicePort`, `AuthChallengeRepositoryPort`, `SignatureVerifierPort`).
  - `infrastructure`: Adapters and external integrations (`SnsNameServiceAdapter` via `@solana/web3.js`, `NaclSignatureVerifier`, `PrismaAuthChallengeRepository`, `RedisCacheAdapter` / `MemoryCacheAdapter`, `EnvService`).
  - `presentation`: HTTP controllers with `@ZodBody`, `@ZodQuery`, `@ZodParams`, returning typed DTOs and dispatching through NestJS CQRS bus.
- **Client Architecture (`client/`)**:
  - Vanilla ES modules loaded directly in browser. Zero heavy build tools, zero external dependencies beyond three.js.
  - Modular services: `client/site/wallet.js` for wallet connection & SIWS, `client/site/sns.js` for cached driver display resolution and formatting with fallback to `shortAddr`.

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | SIWS Structured Challenge Issuance | `POST /api/auth/nonce` returns structured `SolanaSignInInput` fields (domain, uri, statement, nonce, issuedAt, expirationTime) alongside legacy message | M1 | ORIGINAL_REQUEST §R1 |
| 2 | Anonymous 1-Click Nonce Storage | Store 1-click SIWS challenges in `player.AuthChallenge` keyed by `nonce:${nonce}` without schema migrations | M1 | Survey consensus |
| 3 | Native SIWS Signature Verification | Verify ed25519 signatures over canonical SIWS message bytes | M1 | ORIGINAL_REQUEST §R1 |
| 4 | SIWS Security Validation | Enforce domain binding, single-use nonce consumption, and expiration timestamp checks | M1 | ORIGINAL_REQUEST §R1 |
| 5 | Legacy Auth Backwards Compatibility | Seamlessly verify legacy challenge format and wallet-keyed challenges | M1 | ORIGINAL_REQUEST §R1 |
| 6 | Session Cookie Preservation | Preserve `fc_session` httpOnly cookie issuance via `SetSessionCookieInterceptor` | M1 | ORIGINAL_REQUEST §R3 |
| 7 | Native SNS Reverse Resolution | Resolve driver wallet public keys to primary `.sol` domain names via favorite PDA + reverse registry record | M2 | ORIGINAL_REQUEST §R2 |
| 8 | Native SNS Forward Resolution | Resolve `.sol` domain names to Solana wallet public keys | M2 | ORIGINAL_REQUEST §R2 |
| 9 | Zero-Dependency SNS Adapter | Implement reverse/forward resolution directly in `infrastructure/sns/` using `@solana/web3.js` and PDAs (0 new npm dependencies) | M2 | Survey consensus |
| 10 | Mainnet-Beta RPC Configuration | Dedicated `SNS_RPC` env configuration targeting Mainnet-Beta touching all 4 mandatory locations | M2 | ORIGINAL_REQUEST §R2, AGENTS.md |
| 11 | Multi-Tier SNS Caching | Cache resolved SNS records via `CachePort` (24h positive TTL, 30m negative TTL) and batch requests | M2 | ORIGINAL_REQUEST §R2 |
| 12 | SNS HTTP Endpoints | Provide `GET /api/sns/reverse?wallet=` and `GET /api/sns/resolve?domain=` with typed Zod query validation | M2 | ORIGINAL_REQUEST §R2 |
| 13 | Backend DTO Enrichment | Enrich `LeaderboardRowDto`, `ProfileDto`, `MeDto`, and `PublicRideDto` with `sns` for zero-waterfall initial render | M2 | Survey consensus |
| 14 | Native 1-Click Client Sign-In | Support `solana:signIn` (Wallet Standard) and Phantom `signIn()` 1-click modal in `client/site/wallet.js` | M3 | ORIGINAL_REQUEST §R1 |
| 15 | Automatic Legacy Fallback | Fall back to `connect()` + `signMessage()` when `signIn` is unavailable or rejected | M3 | ORIGINAL_REQUEST §R1 |
| 16 | Dev Wallet SIWS Mock | Extend `client/site/dev-wallet.js` with mock `signIn` support for local testing | M3 | Survey consensus |
| 17 | Driver Name UI Integration | Integrate `formatDriver(wallet, sns)` into leaderboard, profile, receipts, header, and watch panels | M3 | ORIGINAL_REQUEST §R2 |
| 18 | Offline / Graceful Error Fallback | Fall back cleanly to `shortAddr(wallet)` on resolution errors, empty records, or offline | M3 | ORIGINAL_REQUEST §R2 |
| 19 | Comprehensive Test Suite & Audits | Pass `npm run check`, server unit tests, server architecture audits, client tests, and adversarial verification | M4 | ORIGINAL_REQUEST §R4 |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Native SIWS Backend & Verification | `server/src/{domain,application,infrastructure,presentation}/auth/` | none | DONE |
| M2 | SNS Resolution & Caching Backend | `server/src/{domain,application,infrastructure,presentation}/sns/`, env configs, DTO enrichment | none | DONE |
| M3 | Client SIWS & SNS Display Integration | `client/site/{wallet.js,dev-wallet.js,sns.js,lobby*.js,ride.js}`, `client/test/` | M1, M2 | DONE |
| M4 | Comprehensive E2E Verification & Audit | Root checks, architecture audits, edge-case adversarial test suite | M1, M2, M3 | DONE |

## Interface Contracts

### M1: Auth Contracts
- **`POST /api/auth/nonce`**:
  - Request: `{ wallet?: string }` (optional wallet for 1-click SIWS).
  - Response:
    ```typescript
    {
      domain: string;
      statement: string;
      uri: string;
      version: string;
      chainId: string;
      nonce: string;
      issuedAt: string;
      expirationTime: string;
      address?: string;
      message: string;
    }
    ```
- **`POST /api/auth/verify`**:
  - Request:
    ```typescript
    {
      wallet: string;
      signature: string;
      message?: string;
      nonce?: string;
    }
    ```
  - Response: `{ success: true, wallet: string, session: string }` + `Set-Cookie: fc_session=...`.

### M2: SNS Contracts
- **`GET /api/sns/reverse?wallet=<pubkey>`**:
  - Response: `{ wallet: string, domain: string | null }`
- **`GET /api/sns/resolve?domain=<name.sol>`**:
  - Response: `{ domain: string, wallet: string | null }`
- **Enriched DTOs**:
  - `LeaderboardRowDto`: `{ wallet: string, score: number, ..., sns?: string | null }`
  - `ProfileDto`: `{ wallet: string, ..., sns?: string | null }`
  - `PublicRideDto`: `{ id: string, wallet: string, ..., sns?: string | null }`

### M3: Client Contracts
- **`signInOrFallback(provider)`**:
  - Attempts `provider.signIn(signInInput)`.
  - On missing method or rejection, executes `provider.connect()` followed by `provider.signMessage()`.
  - Returns verified session.
- **`formatDriver(wallet, sns)`**:
  - Returns `sns` if present (e.g. `"driver.sol"`), else `shortAddr(wallet)`.

## Code Layout
- `server/src/domain/auth/`: Domain entities and rules for authentication challenges and SIWS message serialization.
- `server/src/domain/sns/`: Domain types and validation for SNS domain names.
- `server/src/application/ports/sns/name-service.port.ts`: Application port for SNS forward and reverse lookups.
- `server/src/application/use-cases/auth/`: CQRS command handlers for challenge creation and sign-in verification.
- `server/src/application/use-cases/sns/`: CQRS query handlers for resolving and reversing SNS domains.
- `server/src/infrastructure/sns/`: `SnsNameServiceAdapter` using `@solana/web3.js` and `CachePort`.
- `server/src/presentation/sns/`: `SnsHttpController` and Zod query DTOs.
- `client/site/wallet.js`: Client wallet adapter handling SIWS and fallback.
- `client/site/sns.js`: Client SNS resolution and formatting module with caching and fallback.
