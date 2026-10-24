# Web3 & Solana Features Specification

This document is the authoritative functional and technical specification for all Web3, wallet authentication, Solana Actions (Blinks), Solana Pay, on-chain programs, and compressed NFT (cNFT) subsystems in Freight Chain (`SOL-M-*` rules and `SOL-T-*` test requirements).

Related specs: [Pool & Escrow](./pool.md) · [TEN4 Token & Garage](./ten4.md) · [Rides](./rides.md) · [Admin & Security](./admin_security.md) · [Decision Log](./DECISIONS.md) (D04, D06, D20, D21, D28, D39, D41, D43).

---

## 1. Wallet Authentication, SIWS, Guest Sessions & Phone Pairing

### 1.1 Wallet Standard & Sign-In With Solana (`AuthHttpController` & `client/site/wallet.js`)
- **Challenge-Response Flow (`THROTTLE_AUTH_LIMIT`)**:
  1. `POST /api/auth/nonce` (body `{ wallet?: string }`):
     - Accepts an optional base58 Ed25519 Solana public key (`wallet` is omitted for 1-click Wallet Standard `solana:signIn` before the wallet reveals its address).
     - Generates a single-use `nonce`, persists the challenge (keyed by `wallet` when provided, or `nonce:${nonce}` for 1-click SIWS) with a 5-minute TTL, and returns `ChallengeDto`: `{ nonce, message, domain, uri, version: '1', chainId, statement, issuedAt, expirationTime }` (`SolanaSignInInput` fields for native SIWS + canonical `message` for `signMessage` fallback).
  2. `POST /api/auth/verify` (body `{ wallet, signature, signedMessage?, accountPublicKey? }`):
     - Verifies the Ed25519 signature (`VerifySignInHandler`) for either standard `signMessage` (against the stored challenge for `wallet`) or Wallet Standard `solana:signIn` (`signedMessage` base64 bytes parsed to extract `Nonce:`, verified against `nonce:${nonce}`, ensuring domain/URI/timestamps match).
     - Consumes the challenge row (single-use), upserts the `player.Player` row, records `player.SignIn` (`ipHash`), creates an authenticated session (`player.Session`), and sets the `HttpOnly`, `SameSite=Lax` cookie via `SetSessionCookieInterceptor` (`fc_session` on `.<COOKIE_DOMAIN>` when `COOKIE_DOMAIN` is set, or `__Host-fc_session` / `fc_session` on host-only deployments).
- **Anonymous Guest Sessions (`POST /api/auth/guest`)**:
  - Generates a throwaway guest wallet (`StartGuestHandler`, `guest_<hex>`) with no stored secret and sets the session cookie.
  - Guests may play EASY (`free-1c` / `free-g`) only (`409 guest_easy_only` for MEDIUM, HARD, promo codes, or paid tiers). Progress does not merge into a later wallet.
- **Session Inspection & Logout**:
  - `GET /api/me` (`@UseGuards(PlayerAuthGuard)`): Returns `MeDto` (rider profile, `wallet`, `snsName`, `guest` flag, `loadout`, `freeRides`, `weeklyTicket`, `agreements`, `geo`).
  - `POST /api/auth/logout`: Invalidates the session and clears the session cookie via `ClearSessionCookieInterceptor`.

### 1.2 Phone-as-Hardware-Wallet QR Pairing (`/api/auth/pair`)
Allows a desktop browser without a wallet extension to adopt a session signed on a phone wallet (Phantom / Solflare mobile browser) via QR code:
1. `POST /api/auth/pair` (desktop, `SetPairCookieInterceptor`): Opens a short-lived pairing session (`OpenPhonePairHandler`, **3-minute** TTL) and sets an `HttpOnly`, `SameSite=Lax` cookie `fc_pair` (`Max-Age=180`, `Path=/api/auth/pair`) containing the pairing secret on the desktop browser (the secret is never exposed in the QR image or URL).
2. `POST /api/auth/pair/:id/claim` (phone, `@UseGuards(PlayerAuthGuard)`): After the phone signs in via `/api/auth/nonce` + `/api/auth/verify` on `lobby.html?pair=:id`, it claims `:id` (`ClaimPhonePairHandler`), minting a fresh session token for the phone's wallet and attaching it to the pairing record.
3. `GET /api/auth/pair/:id` (desktop, `AdoptPairSessionInterceptor`): Desktop polls with its `HttpOnly` `fc_pair` cookie (`PollPhonePairHandler`); once `status === 'claimed'`, `AdoptPairSessionInterceptor` clears `fc_pair` and sets the desktop's `fc_session` cookie to the claimed session token.

### 1.3 Solana Name Service (`.sol`) Resolution (`SnsHttpController` & `SnsNameServiceAdapter`)
- **Zero-Dependency On-Chain PDA Resolver (`server/src/infrastructure/chain/sns-name.service.ts`)**:
  - Derives Bonfida SNS PDAs directly using `@solana/web3.js` (`SHA-256('SPL Name Service' + name)`, `NAME_PROGRAM_ID = namesLPneVptA9Z5rqUDD9tMTWEJwofgaYwp8cawRkX`, `.sol` `ROOT_DOMAIN_ACCOUNT`, `NAME_FAVORITE_ID`, `REVERSE_LOOKUP_CLASS`) against `SNS_RPC` (Solana **Mainnet-Beta** RPC, since `.sol` registrations live on Mainnet even when gameplay runs on devnet).
  - **Reverse Lookup (`reverse(wallet)` & `reverseBatch(wallets)`)**:
    1. Checks the favorite domain PDA (`["favourite_domain", NAME_FAVORITE_ID, wallet]`).
    2. Verifies owner staleness: fetches the domain's NameRegistry header (`bytes 32..64`) and confirms `currentOwner === wallet` (rejecting stale favorites after domain transfers).
    3. Reads the reverse registry account (`REVERSE_LOOKUP_CLASS`) to decode the UTF-8 `<label>.sol` string.
    4. `reverseBatch` batches RPC reads in `100`-account `getMultipleAccountsInfo` chunks (`3` batched round-trips total for an entire leaderboard).
  - **Caching & Deduplication**:
    - Positive cache TTL: **`24 hours`** (`86,400,000 ms`); negative (`null`) cache TTL: **`30 minutes`** (`1,800,000 ms`), bounded to `10,000` entries with in-flight promise deduplication.
    - Degrades gracefully to `null` (client displays truncated base58 `ABCD…WXYZ`) if RPC fails or times out (`SNS_RPC_TIMEOUT_MS = 4,000 ms`).
- **HTTP Endpoints & Automatic DTO Enrichment**:
  - `GET /api/sns/resolve?domain=<name.sol>` → `{ domain, wallet }` (`ResolveSnsHandler`).
  - `GET /api/sns/reverse?wallet=<pubkey>` → `{ wallet, domain }` (`ReverseSnsHandler`).
  - Server automatically enriches `snsName: string | null` on `MeDto` (`/api/me`), `ProfileDto` (`/api/profile`), `LeaderboardRowDto` (`/api/leaderboard`), and `PublicRideDto` (`/api/live`, `/api/replays`, `/api/watch/:id`).

---

## 2. Solana Actions & Blinks (`ActionsHttpController` & `blink.html`)

Public Solana Actions endpoints enable 1-click ticket purchases, ride launches, and streamer donations directly from X/Twitter, Dialect Blinks, and `client/blink.html` (`client/site/blink.js`):

- **Discovery (`GET /actions.json` & `/.well-known/actions.json`)**: Maps `/blink.html`, `/r/*`, and `/api/actions/**` with `Access-Control-Allow-Origin: *` (`@UseInterceptors(ActionsCorsInterceptor)` and `@UseFilters(ActionErrorFilter)`).
- **Action Endpoints (`ActionsHttpController` at `/api/actions/*`)**:
  - `GET /api/actions/hello` & `POST /api/actions/hello`: Informational/welcome blink action.
  - `GET /api/actions/shift`, `GET /api/actions/shift/:tier`, `POST /api/actions/shift/:tier`: Returns metadata and builds a single **program-mode (`PAYMENT_MODE=program`)** ticket purchase transaction for `:tier` (`BuildShiftActionHandler`). Requires both profile compliance stamps on `player.Player` (`age18At !== null && lossAt !== null`; otherwise throws `409 agreements_required` rendered as `{ message }`).
  - `POST /api/actions/go/:to`: Action chaining redirect/navigation helper (`site`, `lobby`, `play`).
  - `GET /api/actions/ride/:id`, `GET /api/actions/ride/:id/watch`, `POST /api/actions/ride/:id`: Ride receipt / spectator watch blink card and spectator SOL donation transaction builder (`BuildDonateActionHandler`).
- **Blink Error Contract (`ActionErrorFilter`)**: All errors on `/api/actions/*` return `{ message: string }` with CORS `*` headers as required by the Solana Actions specification.

---

## 3. Solana Pay QR Flows (`SolanaPayHttpController`)

Supports mobile QR-code (`solana:<https-url>`) payments for ride entries, multi-ticket orders, and live stream donations:
- **Solana Pay Transaction Request Endpoints** (public, CORS `*` via `ActionsCorsInterceptor` and `{ message }` errors via `ActionErrorFilter` on `/api/solana-pay/*` only):
  - `GET /api/solana-pay/rides/:id` & `POST /api/solana-pay/rides/:id` (`GetSolanaPayLinkHandler` / `GetSolanaPayTransactionHandler` for `kind: 'ride'`)
  - `GET /api/solana-pay/orders/:id` & `POST /api/solana-pay/orders/:id` (`kind: 'order'`)
  - `GET /api/solana-pay/donations/:id` & `POST /api/solana-pay/donations/:id` (`kind: 'donation'`)
  - Each intent carries a unique Ed25519 `reference` public key; `GET` returns `{ label: 'Freight Chain', icon }` (`404` if not pending or expired) and `POST` accepts `{ account }`, verifies `account === order.owner` (`404 wrong_account` if mismatched), and returns `{ transaction, message }` with the `reference` key attached as a read-only account on the payment instruction.
- **Authenticated Reconciliation Endpoints (`/reconcile`)**:
  - `POST /api/rides/:id/reconcile` (`ReconcileRideHandler`)
  - `POST /api/tickets/orders/:id/reconcile` (`ReconcileTicketOrderHandler`)
  - `POST /api/watch/:id/donation-orders/:orderId/reconcile` (`ReconcileLiveDonationOrderHandler`)
  - Each handler queries confirmed signatures for the intent's `reference` pubkey via `PaymentVerifierPort.findByReference`, verifies recipient, lamport amount, and account keys, and atomically credits the ride/tickets/donation under the player row lock (`findByWalletForUpdate`).

---

## 4. Escrowed Prize Pools (`programs/freightchain_pools` v5)

Detailed pool rules live in [Pool & Escrow Specification](./pool.md). The Solana program architecture is summarized here:
- **Crate**: `programs/freightchain_pools` (v5 built and tested locally with 163 LiteSVM tests; devnet currently runs v3 until an explicit owner deploy).
- **Non-Custodial PDA Vaults**: All ticket revenue, rollover reserves, and per-km sponsor pledges stay in program-owned PDAs (`Config`, `Series`, `Pool`, `Ticket`, `Pledge`, `Claim`, `RideAttestation`). Every wallet signs and submits its own transactions.
- **Two Hot Server Keys + Cold Admin**:
  1. **Crank Key (`CRANK_SECRET`)**: Executes permissionless lifecycle steps (`open_next_pool`, `fail_pool`, `expire_pool`, `refund`, `refund_sponsor`, `close_pool`) and seals the pool's road seed (`seal_road`).
  2. **Payout Key (`PAYOUT_SECRET`)**: Records per-ride attestations (`record_ride_attestation`), commits the pool's Merkle winners root (`commit_winners`) once every ride is decided, and closes paid pools (`close_pool`).
  3. **Cold Admin Authority**: Controls `initialize`, `set_config`, `set_pool_rules`, `pause`, `create_series`, `update_series`, `pause_series`, and can veto a winners root (`veto_winners`) during the review lock window.
- **v5 Split & Ceilings**: Default split `8500 / 500 / 1000` (85% winners / 5% seed rollover / 10% fee), `max_player_share_bps` default `4740` (program ceiling `< 5000`), `paid_tickets_enabled` switch, and no on-chain referral leg.

---

## 5. Soulbound Achievement cNFTs (`AchievementService` & `MintAchievementsHandler`)

- **44 Earnable Badges + Legacy `top-20` (`server/src/domain/achievements/achievements.ts`, `server/prisma/achievement/achievement.prisma`)**:
  - `achievements.ts` is kept import-free so `design/achievements/generate.mjs` can import it directly to render the 45 SVG/PNG badge artworks (`client/site/img/achievements/<id>.svg` and `client/site/img/achievements/<id>-locked.svg`, `1024×1024` PNGs in `design/achievements/out/png/` and metadata JSON in `design/achievements/out/metadata/` uploaded to Arweave via Irys, URIs stored in `nft-metadata-uris.ts`).
  - **12 Badge Families**: 9 original families (`34` badges: `road` (4: `first-mile`, `first-mile-2`, `first-mile-3`, `first-mile-4`), `shift` (4: `shift-complete`, `shift-complete-2`, `shift-complete-3`, `shift-complete-4`), `night` (4: `night-owl`, `night-owl-2`, `night-owl-3`, `night-owl-4`), `distance` (4: `century`, `century-2`, `century-3`, `century-4`), `clean` (4: `clean-run`, `clean-run-2`, `clean-run-3`, `clean-run-4`), `siberia` (4: `cold-start`, `cold-start-2`, `cold-start-3`, `cold-start-4`), `solo` (4: `on-my-own`, `on-my-own-2`, `on-my-own-3`, `on-my-own-4`), `licence` (3: `free-easy`, `free-crossroads`, `free-hard`), `honk` / display `TEN4` (3: `honk-haul`, `honk-haul-2`, `honk-haul-3`)) + `medium` (3: `free-medium-3`, `free-medium-5`, `free-medium-10`), `hard` (3: `free-hard-2`, `free-hard-3`, `free-hard-5`), and `convoy` (4: `convoy`, `convoy-2`, `convoy-3`, `convoy-4`) = **44 earnable badges** + frozen legacy `top-20` (`podium` family, retired).
  - **Frozen IDs Rule**: Achievement IDs are frozen (`achievement.AchievementUnlock` is append-only, PK `(wallet, achievement)`). Add a new tier instead of retuning an existing ID.
  - **`Shifts` (`shift`) Family & `Facts` Contract**: The `shift` ("Shifts") family reads `paidShifts` (`RideQueryPort.summary` in both Prisma and the in-memory test twin); an old unlock row from when free rides counted is skipped at mint time with `skippedReason = 'no-longer-earned'`.
- **Delayed Outbox & Anti-Cheat Re-Check (`achievement.AchievementMint`)**:
  1. Unlocking a badge inserts an `achievement.AchievementUnlock` row (guest `guest_*` wallets earn unlocks on that throwaway wallet too) and queues a corresponding outbox row in `achievement.AchievementMint` eligible once `now >= unlockedAt + ACHIEVEMENT_MINT_DELAY_MS` (default `3,600,000 ms` = 1 hour; polled every `ACHIEVEMENT_MINT_INTERVAL_MS = 120,000 ms` in batches of `ACHIEVEMENT_MINT_BATCH = 10`).
  2. `MintAchievementsHandler` (invoked by `AchievementMintScheduler` and CLI `node dist/cli/index.js achievement:mint [--retry]`) claims a due row (`claimSent` stores the deterministic tx signature before broadcast to prevent duplicate mints across crashes, up to `MAX_MINT_ATTEMPTS`), skips non-real base58 pubkey wallets (`guest_*` / `demo_*` → `status = 'skipped'`), re-reads the player's rides/stats/referrals/cosmetics **excluding `rejected` rides**, and re-evaluates `evaluateAchievements`:
     - If the badge is no longer earned after excluding rejected rides (or the trigger ride's verdict is still `'pending'`), the row transitions to `status = 'skipped'` (`skippedReason = 'revoked_by_verdict'` or `'no-longer-earned'`).
     - Otherwise it transitions `'planned' → 'sent'`, calls `AchievementNftMinterPort.mintSoulboundCnft`, and records `status = 'minted'`, `txSignature`, `leafIndex`, `assetId`, `mintedAt` (or `status = 'failed'`, `error` on RPC error).
- **On-Chain Soulbound BubblegumV2 + MPL-Core Setup (`BubblegumMinterAdapter`)**:
  - Uses an MPL-Core collection with `BubblegumV2` and `PermanentFreezeDelegate` (`authority: None` = permanently soulbound).
  - Tree capacity guard: logs an error when `treeUsage >= 90%` and halts minting cleanly if the Merkle tree is full.
  - **Env Keys**: `ACHIEVEMENT_MINT_SECRET`, `ACHIEVEMENT_TREE` (`ACHIEVEMENT_MERKLE_TREE`), `ACHIEVEMENT_COLLECTION` (`ACHIEVEMENT_COLLECTION_MINT`), `ACHIEVEMENT_MINT_INTERVAL_MS` (`120000`), `ACHIEVEMENT_MINT_DELAY_MS` (`3600000`), `ACHIEVEMENT_MINT_BATCH` (`10`).
  - **Scripts**: `node design/achievements/generate.mjs` (render SVGs/PNGs), `node server/scripts/achievements/upload-irys.mjs` (upload to Arweave/Irys), `node server/scripts/achievements/setup-tree.mjs` (create MPL-Core collection + BubblegumV2 tree), `node server/scripts/achievements/smoke-mint.mjs` (smoke mint on devnet).
  - **Devnet Deployment (2026-10-11)**: Authority `k5GepWFN9Hj1arH9YBJtPsnypd7RycLgt5by1x74Nkf`, MPL-Core Collection `56ijQ5t2RFpXezbPtEuqECo5gCQiGSek2LBsp7cfMoXC`, Merkle Tree `45NKrZA9rGFcKr62VY5NvM89yarFuBqtBseRK7ZSM336` (`maxDepth = 16` → 65,536 leaves, `maxBufferSize = 64`, `canopyDepth = 10`).
- **Lobby UI & Analytics (`client/site/lobby-achievements.js`)**:
  - Renders 3D flip cards in `lobby.html#profile` using `ProfileDto.badgeChain`, linking minted cNFTs to Solana Explorer, Solscan, Helius Orb, the mint transaction signature, and `Post on X`.
  - Emits analytics events `achievement_unlocked`, `achievement_minted`, `achievement_mint_failed`, and `achievement_nft_clicked`.

---

## 6. Rules (`SOL-M-*`)

| Rule ID | Rule | Enforced By | Test ID |
|---|---|---|---|
| **SOL-M-01** | `POST /api/auth/nonce` (`{ wallet? }`) generates a single-use challenge (keyed by `wallet` or `nonce:${nonce}` for 1-click SIWS); `POST /api/auth/verify` verifies the Ed25519 / SIWS signature, consumes the challenge, and sets the `HttpOnly` `fc_session` (`__Host-fc_session`) cookie. | `AuthHttpController`, `RequestChallengeHandler`, `VerifySignInHandler` | `SOL-T-01`, `SOL-T-02` |
| **SOL-M-02** | `POST /api/auth/guest` opens a throwaway guest wallet allowed to play EASY (`free-1c` / `free-g`) only; MEDIUM, HARD, promo codes, and paid tiers reject guest sessions with `409 guest_easy_only`. | `StartGuestHandler`, Ride/Promo handlers | `SOL-T-03` |
| **SOL-M-03** | Phone QR pairing (`POST /api/auth/pair` → phone `POST /api/auth/pair/:id/claim` → desktop `GET /api/auth/pair/:id`) keeps the pair secret in a 3-minute `HttpOnly` desktop cookie (`fc_pair`, `SetPairCookieInterceptor`) and adopts the phone's authenticated session onto the desktop browser (`AdoptPairSessionInterceptor`). | `AuthHttpController`, `PhonePair` handlers/interceptors | `SOL-T-04` |
| **SOL-M-04** | `GET /api/sns/resolve` and `GET /api/sns/reverse` resolve `.sol` domains forward and reverse on `SNS_RPC` (Mainnet-Beta) using direct PDA derivation, owner-staleness verification, 24h positive / 30m negative caching, and 100-account batched reverse lookups (`reverseBatch`). | `SnsHttpController`, `SnsNameServiceAdapter` | `SOL-T-05` |
| **SOL-M-05** | Solana Actions (`/actions.json`, `/.well-known/actions.json`, `/api/actions/*`) set CORS `*` on those paths only (`ActionsCorsInterceptor`), return `{ message }` errors (`ActionErrorFilter`), and require both profile agreements (`age18At` & `lossAt`, else `409 agreements_required`) before building a program-mode shift ticket transaction. | `ActionsHttpController`, `ActionErrorFilter` | `SOL-T-06`, `SOL-T-07` |
| **SOL-M-06** | Solana Pay routes (`GET/POST /api/solana-pay/{rides\|orders\|donations}/:id`, CORS `*` on that prefix only) assign a unique `reference` key per intent, verify `account === owner` (`404 wrong_account`), and reconcile confirmed transactions idempotently via `/reconcile` under `findByWalletForUpdate`. | `SolanaPayHttpController`, `GetSolanaPayTransactionHandler`, `Reconcile*Handler` | `SOL-T-08`, `SOL-T-09` |
| **SOL-M-07** | In `PAYMENT_MODE=program`, the server never takes custody of pool funds; tickets and pool states are mirrored from verified on-chain `freightchain_pools` transactions/accounts, and `paid_tickets_enabled = false` blocks paid ticket sales immediately. | `PoolProgramAdapter`, `freightchain_pools` | `SOL-T-10`, `SOL-T-11` |
| **SOL-M-08** | Before any pool prize `claim` can succeed on-chain, every ride in the pool must have a final verdict, pledged rides must have an on-chain `RideAttestation`, the `PAYOUT_SECRET` key must commit the Merkle winners root (`commit_winners_root`), and the `review_window_s` dispute window must elapse without a cold-admin `veto_winners_root`. | `PayoutPoolHandler`, `freightchain_pools` | `SOL-T-12` |
| **SOL-M-09** | Achievement unlock rows (`achievement.AchievementUnlock`) are append-only across 44 earnable tiers (`+1` legacy `top-20`), skipping guest wallets, and queue an `achievement.AchievementMint` outbox row after `ACHIEVEMENT_MINT_DELAY_MS` (1 hour). | `AchievementService`, `ACHIEVEMENTS` | `SOL-T-13` |
| **SOL-M-10** | When `MintAchievementsHandler` processes a due `achievement.AchievementMint` row, it re-evaluates the wallet's non-rejected rides; if a rejected ride invalidates the unlock, the mint row transitions to `status = 'skipped'` (`skippedReason = 'revoked_by_verdict'`) instead of minting. | `MintAchievementsHandler` | `SOL-T-14` |
| **SOL-M-11** | Minted achievement badges are soulbound Bubblegum cNFTs signed by `ACHIEVEMENT_MINT_SECRET` (`planned → sent → minted | failed`), with `--retry` recovery for `'failed'` rows. | `BubblegumMinterAdapter`, `MintAchievementsHandler` | `SOL-T-15` |
| **SOL-M-12** | Tooling and tests never mutate `~/.config/solana/id.json` or global Solana CLI config; all RPC/Anchor invocations pass an explicit `--url` or `SOLANA_RPC_URL`. | `AGENTS.md`, `server/src/infrastructure/chain/` | `SOL-T-16` |

---

## 7. Verification & Test Suite Plan (`SOL-T-*`)

### 7.1 Unit & Integration Tests (`server/src/**/*.spec.ts` & `server/test/`)
- **`SOL-T-01`**: `RequestChallengeHandler` & `VerifySignInHandler` spec: accepts valid `signMessage` and 1-click SIWS (`solana:signIn` via `nonce:${nonce}`) signatures and rejects tampered messages, wrong wallets, or expired challenges (`401`).
- **`SOL-T-02`**: Challenge single-use test: replaying the same `{ wallet, signature }` a second time rejects with `401`.
- **`SOL-T-03`**: Guest session test (`StartGuestHandler`): `POST /api/auth/guest` creates a guest session that can start an EASY free ride (`free-1c` / `free-g`) but receives `409 guest_easy_only` on MEDIUM, HARD, promo redemption, referral bind, and paid rides.
- **`SOL-T-04`**: Phone QR pairing lifecycle (`POST /api/auth/pair` → phone `POST /api/auth/pair/:id/claim` → desktop `GET /api/auth/pair/:id`): verifies 3-minute `fc_pair` `HttpOnly` cookie, rejects wrong secret or expired pair (`404`/`401`), and adopts the session cookie onto the desktop browser.
- **`SOL-T-05`**: `SnsNameServiceAdapter` unit spec: verifies PDA derivation, owner staleness check (`currentOwner !== wallet → null`), 24h positive / 30m negative cache TTL, in-flight deduplication, 100-account `reverseBatch` chunking, and graceful `null` fallback on RPC error.
- **`SOL-T-06`**: `ActionsHttpController`, `ActionsCorsInterceptor` & `ActionErrorFilter` spec: verifies `OPTIONS` and `GET/POST /api/actions/*` include `ACTIONS_CORS_HEADERS` (`Access-Control-Allow-Origin: *`) and return `{ message }` JSON on `DomainError`.
- **`SOL-T-07`**: `POST /api/actions/shift/:tier` rejects wallets missing `age18At` or `lossAt` with `409 agreements_required` (`{ message }`) and returns a valid base64 program-mode transaction when both compliance stamps exist.
- **`SOL-T-08`**: `GetSolanaPayLinkHandler` & `GetSolanaPayTransactionHandler` spec: verifies unique base58 `reference` pubkey per ride/order/donation, rejects `account !== owner` with `404 wrong_account`, and embeds `reference` in the serialized transaction returned by `POST /api/solana-pay/{rides|orders|donations}/:id`.
- **`SOL-T-09`**: `ReconcileRideHandler` / `ReconcileTicketOrderHandler` / `ReconcileLiveDonationOrderHandler` spec: verifies signature confirmation via `findByReference`, recipient, lamports, and `reference` inclusion, and is idempotent under concurrent `/reconcile` calls via `findByWalletForUpdate`.
- **`SOL-T-13`**: `AchievementService` catalog & evaluation spec: verifies all 44 earnable badges + legacy `top-20`, guest skip (`guest_*`), append-only `achievement.AchievementUnlock` persistence, and `ACHIEVEMENT_MINT_DELAY_MS` eligibility window.
- **`SOL-T-14`**: `MintAchievementsHandler` re-check spec: when the ride that triggered an unlock is marked `rejected` before minting, processing the outbox marks the `achievement.AchievementMint` row `status = 'skipped'` (`revoked_by_verdict`) and never calls the minter adapter.
- **`SOL-T-15`**: `MintAchievementsHandler` mint & retry spec: successful mint transitions `planned → sent → minted` with `txSignature`, `leafIndex`, and `assetId`; adapter failure records `status = 'failed'` and `error`, and `retry: true` re-attempts failed rows.

### Metadata release preparation

`node backend/server/scripts/achievements/upload-irys.mjs --prepare` is offline: it checks all 44 earnable metadata templates and 1024px PNGs, then lists missing published URIs without reading a key or contacting a provider. All 13 previously missing PNGs are now present. Publishing still requires the documented explicit upload command; existing leaf/collection URIs are frozen and never replaced by a rerun. Another network requires a separate reviewed map. `node frontend/design/achievements/generate.mjs --png-only --only=<ids>` renders existing artwork through Chrome without rewriting SVGs or metadata.

### 7.2 On-Chain Validator & E2E Tests (`programs/`, `e2e/`)
- **`SOL-T-10`**: Anchor LiteSVM & validator suite (`programs/freightchain_pools/tests/` — 163 tests — & `npm run test:e2e:block2`): verifies `initialize`, `set_pool_rules`, `open_pool_from_series`, `buy_ticket`, and `paid_tickets_enabled` kill-switch.
- **`SOL-T-11`**: Pool indexer & reconciliation E2E (`e2e/flows/07-pool-lifecycle-block1.e2e.mjs` & `09-chain-escrow-block2.e2e.mjs`): verifies ticket mirroring from on-chain events and sponsor pledge creation/refund.
- **`SOL-T-12`**: Merkle payout & cold-admin veto E2E: verifies `seal_road`, `attest_ride`, `commit_winners_root`, `veto_winners_root` blocking claims during `review_window_s`, and `claim` succeeding with a valid Merkle proof after the lock window.
- **`SOL-T-16`**: Architecture & repo hygiene check confirming no script or test mutates `~/.config/solana/id.json`.

### Local cNFT acceptance (25 October 2026)

`npm run test:nft:localnet` executes the real Bubblegum mint adapter and PostgreSQL mint worker on a disposable validator with hash-pinned public devnet Bubblegum, MPL Core, MPL compression and Noop programs. It proves the minted owner and Merkle leaf, `CollectionIsFrozen` transfer refusal, a successful unfrozen transfer control, pre-broadcast signature persistence, failed-claim non-broadcast, 48-hour delay, rejected-completion exclusion, recovery from receipt lookup failure and one mint after repeated worker passes. These are chain transactions; the ride facts are explicit database fixtures, not a full verified driving journey.

The devnet `smoke-mint.mjs` now requires published metadata, checks the DAS owner/tree/index and verifies the minted leaf on chain before attempting transfer. Missing DAS, a successful transfer, or an unrelated transfer error fails the command. It was not executed remotely in the local readiness run. Wallet display/DAS indexing and the 13 unpublished metadata URIs remain release checks.
