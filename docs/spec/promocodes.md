# Promo Codes & Wardrobe Specification

This document is the authoritative functional and technical specification for Freight Chain's promo code and cosmetic wardrobe subsystem (`PRM-M-*` rules and `PRM-T-*` test requirements). It covers code normalization, reward kinds (`ride` and `tickets`), retired/refused legacy kinds (`free_rides` and `cosmetic`), the `PromoCode` state machine, redemption concurrency, player wardrobe endpoints, and wallet-signed admin promo management.

Related specs: [Rides](./rides.md) · [Pool & Escrow](./pool.md) · [TEN4 Token & Garage](./ten4.md) · [Referral Program](./referral.md) · [Admin & Security](./admin_security.md) · [Product & As-Built Behavior](./PRODUCT.md).

---

## 1. Domain Model & Effect Kinds (`promo-code.entity.ts` & `promo.types.ts`)

### 1.1 Code Normalization & Bounds (`PromoCode`)
- **Normalization (`PromoCode.normalize`)**: `code.replace(/\s+/g, '').toUpperCase()` — strips all leading, trailing, and inner whitespace and converts to uppercase.
- **Format (`CODE_RE`)**: Must match `/^[A-Z0-9_-]{3,32}$/` (`3..32` uppercase letters, digits, `'-'`, or `'_'`). Invalid codes throw `BadRequestError('bad_promo_code')` (`400`).
- **Text Bounds**:
  - `description`: Trimmed; `null` if empty; at most `MAX_DESCRIPTION = 200` characters (`400 bad_promo_code`).
  - `note`: Private admin note; trimmed; `null` if empty; at most `MAX_NOTE = 500` characters (`400 bad_promo_code`).
- **Usage & Time Window Bounds**:
  - `perWallet`: Integer `>= 1` (`400 bad_promo_code`). Forced to `perWallet === 1` when `effect.kind === 'ride'`.
  - `maxRedemptions`: `null` (unlimited) or integer `>= 1` (`400 bad_promo_code`).
  - `startsAt`: Defaults to `now` when `null` on creation.
  - `expiresAt`: `null` (never expires) or a `Date` strictly in the future (`expiresAt > now` and `expiresAt > startsAt`, else `400 bad_promo_code`).
  - **Immutability**: Once created, a `PromoCode` row's `effect` and parameters are immutable except for `redeemed` increments and `disabledAt` (`POST /api/admin/promos/:code/disable`), guaranteeing the redemption audit trail always matches the granted effect.

**Convoy system grant:** `SYSTEM-CONVOY-1H` is reserved from public/admin code creation and is disabled for public redemption. Capped Convoy activation issues its 1h `PromoRideGrant` directly inside the same transaction; ordering consumes it through the normal promo path.

### 1.2 The Four `PromoEffect` Kinds (`PROMO_KINDS`)
1. **Free Paid-Tier Shift (`{ kind: 'ride', tier: '1h' | '4h' | '8h' }`) — Active**:
   - Grants one free shift of `tier` (`player.PromoRideGrant` row for `(wallet, code, tier)`), redeemable once per wallet (`perWallet === 1`).
   - When the player orders a ride of `tier` (`POST /api/rides`), an unspent promo ride grant is claimed before the weekly free ticket grant, leaving the weekly grant unspent.
   - A promo ride does **not** mint TEN4 (`pays: '0'`). If started as `{ ranked: true }`, it uses the weekly promo ranked slot (`+1` per week).
2. **Sponsored Pool Tickets (`{ kind: 'tickets', tier: '1h' | '4h' | '8h', poolId: number | null, credits: number }`) — Active**:
   - Grants `credits` (`>= 1` integer) off-chain paid-ride ticket credits into a pool of `tier`:
     - If `poolId !== null` (`>= 0` integer), pinned to that specific pool (validated at creation time to be an existing pool of `tier`).
     - If `poolId === null`, resolves at redemption time to the currently selling live pool of `tier` (`409` if no pool of `tier` is currently selling).
   - Sponsored promo tickets do **not** count toward the on-chain pool's `min_tickets` threshold, but rides started from them are paid starts and **can** earn TEN4.
3. **Extra Free Rides (`{ kind: 'free_rides', count: number }`) — Retired**:
   - Creating or redeeming a `free_rides` code throws `ConflictError('promo_retired')` (`409`).
   - `PromoCode.restore` and `assertEffect` (`1 <= count <= MAX_FREE_RIDES_PER_CODE = 20`) remain so historical redemption rows still deserialize cleanly.
4. **Cab Cosmetic (`{ kind: 'cosmetic', slot: CosmeticSlot, item: string }`) — Refused**:
   - Cab visuals are minted exclusively by burning TEN4 (or earned via the 3 referral paints).
   - Creating or redeeming a `cosmetic` promo code throws `ConflictError('visuals_are_honk')` (`409`).
   - Existing cosmetics unlocked by historical promo codes remain stored in `player.CosmeticUnlock` and stay wearable via `/api/wardrobe` and `/api/garage`.

---

## 2. State Machine (`PromoCode.stateAt` & `whyNotRedeemable`)

`promo.stateAt(now)` evaluates in strict priority order:
1. `'disabled'` — `disabledAt !== null`
2. `'ended'` — `expiresAt !== null && expiresAt.getTime() <= now.getTime()`
3. `'scheduled'` — `startsAt.getTime() > now.getTime()`
4. `'exhausted'` — `maxRedemptions !== null && redeemed >= maxRedemptions`
5. `'active'` — otherwise

`promo.whyNotRedeemable(now, walletRedemptions)` returns:
- `'this promo code is no longer valid'` when `'disabled'`
- `'this promo code has expired'` when `'ended'`
- `'this promo code is not active yet'` when `'scheduled'`
- `'this promo code has been fully redeemed'` when `'exhausted'`
- `'you have already redeemed this promo code'` when `walletRedemptions >= perWallet`
- `null` when redeemable

---

## 3. HTTP Endpoints, Concurrency & Admin Signing

### 3.1 Player Promo & Wardrobe Endpoints
- **`POST /api/promo/redeem`** (`PoolsHttpController`, `@UseGuards(PlayerAuthGuard)`):
  - Dedicated per-IP throttle budget (`THROTTLE_PROMO_LIMIT`) separate from general read endpoints.
  - Normalizes `body.code` (`400 bad_promo_code` if invalid). A promo link (`?promo=CODE` or `#promo`) in the lobby (`client/site/lobby-promo.js`) only pre-fills the input — the player still clicks `REDEEM`.
  - Guest wallets are rejected (`409 guest_easy_only` / `401`).
  - Runs inside a single database transaction locking the player row (`findByWalletForUpdate`) and the promo row (`FOR UPDATE`):
    - Rejects missing codes (`404 promo_not_found`), retired `'free_rides'` (`409 promo_retired`), refused `'cosmetic'` (`409 visuals_are_honk`), and non-redeemable states (`409 promo_not_redeemable` / state conflict).
    - Increments `PromoCode.redeemed`, inserts `PromoRedemption`, and creates the `PromoRideGrant` (`kind: 'ride'`) or pool ticket credits (`kind: 'tickets'`).
  - Promo analytics events never carry free text (`description`, `note`).
- **`GET /api/promo/mine`** (`PromosHttpController`, `@UseGuards(PlayerAuthGuard)`):
  - Returns `MyPromosDto`: the wallet's past promo redemptions and unspent promo ride grants.
- **`GET /api/wardrobe` & `POST /api/wardrobe/equip`** (`PromosHttpController`, `@UseGuards(PlayerAuthGuard)`):
  - `GET /api/wardrobe`: Returns `WardrobeDto` (owned cosmetics + currently equipped `Loadout` across all 9 `COSMETIC_SLOTS`).
  - `POST /api/wardrobe/equip` (body `{ slot, item }`): Equips a single `(slot, item)` if valid (`400` if unknown slot/item) and owned (`409` if not owned).

### 3.2 Signed Admin Promo Endpoints (`AdminPromosHttpController` at `/api/admin/promos`)
Guarded by `@UseGuards(AdminGuard)` (enforces `admin.<COOKIE_DOMAIN>` host, `fc_admin` session cookie, and `X-FC-Admin` header on mutations):
- **`GET /api/admin/promos?state=active|scheduled|ended|exhausted|disabled`**: Lists promo codes filtered by computed `stateAt(now)` (or all codes when `state` is omitted).
- **`GET /api/admin/promos/redemptions?code=&wallet=&limit=`**: Lists promo redemptions newest-first, filterable by `code` and `wallet`.
- **`POST /api/admin/promos/challenge`**: Issues a single-use wallet-signing challenge (`RequestActionChallengeCommand`) covering either `{ action: 'promo_create', promo }` (every promo field is serialized in `promoJson` inside the signed challenge text) or `{ action: 'promo_disable', code }`.
- **`POST /api/admin/promos`**: Verifies the admin's Ed25519 `signature` against the `promo_create` challenge (`401` if signature does not cover the exact payload), validates `PromoCode.create`, checks uniqueness (`409` if code exists), persists the code, and writes an `AdminAuditLog` entry.
- **`POST /api/admin/promos/:code/disable`**: Verifies the admin's Ed25519 `signature` against the `promo_disable` challenge for `:code`, sets `disabledAt = now`, and writes an `AdminAuditLog` entry.

---

## 4. Rules (`PRM-M-*`)

| Rule ID | Rule | Enforced By | Test ID |
|---|---|---|---|
| **PRM-M-01** | `PromoCode.normalize` strips all whitespace and uppercases; valid codes match `/^[A-Z0-9_-]{3,32}$/` (`400 bad_promo_code` otherwise). | `PromoCode.normalize`, `PromoCode.isValidCode` | `PRM-T-01` |
| **PRM-M-02** | Creating a code with `effect.kind === 'cosmetic'` throws `409 visuals_are_honk`; creating `effect.kind === 'free_rides'` throws `409 promo_retired`. Only `kind: 'ride'` and `kind: 'tickets'` can be created. | `PromoCode.create` | `PRM-T-02` |
| **PRM-M-03** | `PromoCode.assertEffect` requires `tier in ('1h', '4h', '8h')` for `'ride'` and `'tickets'`, integer `credits >= 1`, and `poolId === null` or integer `poolId >= 0` (`400 bad_promo_code`). For `'ride'`, `perWallet` must equal `1`. | `PromoCode.assertEffect`, `PromoCode.create` | `PRM-T-03`, `PRM-T-04` |
| **PRM-M-04** | `PromoCode.create` enforces `perWallet >= 1`, `maxRedemptions === null \|\| maxRedemptions >= 1`, `description <= 200` chars, `note <= 500` chars, and `expiresAt > now && expiresAt > startsAt` (`400 bad_promo_code`). | `PromoCode.create` | `PRM-T-05` |
| **PRM-M-05** | `PromoCode.stateAt(now)` evaluates in strict priority order: `'disabled'` (`disabledAt !== null`) → `'ended'` (`expiresAt <= now`) → `'scheduled'` (`startsAt > now`) → `'exhausted'` (`redeemed >= maxRedemptions`) → `'active'`. | `PromoCode.stateAt`, `PromoCode.whyNotRedeemable` | `PRM-T-06` |
| **PRM-M-06** | Redeeming (`POST /api/promo/redeem`) locks the player row (`findByWalletForUpdate`) and promo row in one transaction, rejecting missing codes (`404`), retired `free_rides` (`409 promo_retired`), refused `cosmetic` (`409 visuals_are_honk`), non-active codes (`409`), and wallets at `walletRedemptions >= perWallet` (`409`). | `RedeemPromoHandler` | `PRM-T-07`, `PRM-T-08`, `PRM-T-14` |
| **PRM-M-07** | Redeeming `kind: 'ride'` creates an unspent `PromoRideGrant` for `(wallet, code, tier)`. When ordering a ride of `tier`, an unspent promo ride grant is consumed before the weekly free ticket grant, and the resulting ride does not mint TEN4. | `RedeemPromoHandler`, `OrderRideHandler` | `PRM-T-09` |
| **PRM-M-08** | Redeeming `kind: 'tickets'` grants `credits` paid-ride ticket credits in `poolId` (or the live selling pool of `tier` when `poolId === null`; `409` if no selling pool exists). Sponsored promo tickets do not count toward `min_tickets`, and rides started from them can earn TEN4. | `RedeemPromoHandler` | `PRM-T-10` |
| **PRM-M-09** | `GET /api/wardrobe` returns all 9 `COSMETIC_SLOTS` with owned items and current `Loadout`; `POST /api/wardrobe/equip` equips a single `(slot, item)` (including legacy promo-unlocked cosmetics) and rejects unknown (`400`) or unowned (`409`) items. | `PromosHttpController`, `GetWardrobeHandler`, `EquipCosmeticHandler` | `PRM-T-11` |
| **PRM-M-10** | Admin promo creation (`POST /api/admin/promos`) and disabling (`POST /api/admin/promos/:code/disable`) require `AdminGuard` plus a single-use Ed25519 signature over the exact `promo_create` or `promo_disable` challenge (`POST /api/admin/promos/challenge`) and write an `AdminAuditLog` row. | `AdminPromosHttpController`, `CreateAdminPromoHandler`, `DisableAdminPromoHandler` | `PRM-T-12`, `PRM-T-13` |

---

## 5. Verification & Test Suite Plan (`PRM-T-*`)

### 5.1 Unit Tests (`server/src/domain/economy/promo-code.entity.spec.ts` & handler specs)
- **`PRM-T-01`**: `PromoCode.normalize` and `isValidCode` strip spaces, uppercase, accept 3..32 char `[A-Z0-9_-]`, and reject `<3`, `>32`, or symbols with `400 bad_promo_code`.
- **`PRM-T-02`**: `PromoCode.create` throws `ConflictError('visuals_are_honk')` (409) for `kind: 'cosmetic'` and `ConflictError('promo_retired')` (409) for `kind: 'free_rides'`.
- **`PRM-T-03`**: `PromoCode.assertEffect` validates `tier in ('1h', '4h', '8h')`, `credits >= 1`, and `poolId === null || poolId >= 0`, while `PromoCode.restore` still loads historical `free_rides` and `cosmetic` rows.
- **`PRM-T-04`**: `PromoCode.create` rejects `kind: 'ride'` when `perWallet !== 1` (`400 bad_promo_code`).
- **`PRM-T-05`**: `PromoCode.create` enforces `perWallet >= 1`, `maxRedemptions >= 1 | null`, `MAX_DESCRIPTION = 200`, `MAX_NOTE = 500`, and `expiresAt > startsAt && expiresAt > now`.
- **`PRM-T-06`**: `stateAt(now)` and `whyNotRedeemable(now, walletRedemptions)` return the exact state and refusal message across all 5 states and `walletRedemptions >= perWallet`.
- **`PRM-T-07`**: `RedeemPromoHandler` rejects unknown codes (`404`), disabled/ended/scheduled/exhausted codes (`409`), and repeat wallet redemptions (`409`).
- **`PRM-T-08`**: `RedeemPromoHandler` refuses pre-existing DB rows of `kind: 'free_rides'` (`409 promo_retired`) and `kind: 'cosmetic'` (`409 visuals_are_honk`).
- **`PRM-T-09`**: Redeeming `kind: 'ride'` grants a shift that is claimed before the weekly 1h grant on `POST /api/rides`, leaves the weekly grant unspent, and yields `honkQuote.state === 'none'` (`0 TEN4`).
- **`PRM-T-10`**: Redeeming `kind: 'tickets'` credits `credits` tickets on the pinned or active selling pool (`409` if no active pool exists when `poolId === null`).
- **`PRM-T-11`**: `GET /api/wardrobe` and `POST /api/wardrobe/equip` equip default and unlocked items, reject unknown slot/item (`400`), and reject unowned items (`409`).
- **`PRM-T-12`**: `CreateAdminPromoHandler` and `DisableAdminPromoHandler` reject missing/mismatched Ed25519 challenge signatures (`401`) and duplicate codes (`409`).

### 5.2 Integration, Concurrency & E2E Tests (`server/test/` & `e2e/`)
- **`PRM-T-13`**: Admin HTTP scenario (`server/test/http/` & `e2e/catalog.mjs` `B1-PROMO-*` / `B1-ADMIN-*`, plus Chrome E2E `bash .claude/skills/run-tests/e2e.sh promo`, `lobby`, `admin`, `wallet`, `wallet-split`): requests `POST /api/admin/promos/challenge`, signs with admin keypair, creates `ride` and `tickets` promos via `POST /api/admin/promos`, lists via `GET /api/admin/promos` and `/redemptions`, and disables via `POST /api/admin/promos/:code/disable`.
- **`PRM-T-14`**: PostgreSQL concurrency spec: parallel `POST /api/promo/redeem` calls for a code with `maxRedemptions: 1` or `perWallet: 1` serialize under row locks so `redeemed` never exceeds `maxRedemptions` and a wallet never exceeds `perWallet`.
