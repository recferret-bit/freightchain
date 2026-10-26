# TEN4 Token & Garage Specification

This document is the authoritative functional and technical specification for the **TEN4 (`$TEN4`)** token economy, checkpoint driving rewards, burn sinks, the 9-slot **Cab Garage**, and the local `freightchain_honk` Anchor program (`TEN-M-*` rules and `TEN-T-*` test requirements). It replaces the legacy `docs/honk/SPEC.md` and `docs/garage.md` documents.

> **Naming Note:** The token's name and ticker are **TEN4 (`TOKEN_NAME = 'TEN4'`, `TOKEN_SYMBOL = 'TEN4'`)**. **HONK** remains the in-game chat-line verb (`POST /api/watch/:id/honk`), and internal code symbols (`server/src/domain/honk/`, `HonkHttpController` at `/api/honk*`, `programs/freightchain_honk`, `HONK_PROGRAM_ID`) retain the `honk` identifier. Both the user-facing ticker and exact code identifiers are documented below.
> **External Token Collision Note:** The live Solana mainnet/devnet `HONK` mint `3ag1Mj9AKz9FAkCQ6gAEhpLSX8B2pUbPdkb9iBsDLZNB` is an unrelated third-party token (verified on CoinGecko, DexScreener, and Jupiter on 2026-10-16), which is why our token ticker is **TEN4**. Public tokenomics restatement: [`docs/tech/ten4/index.html`](../tech/ten4/index.html); historical review snapshot in [`docs/tech/ten4/grill.html`](../tech/ten4/grill.html).

Related specs: [Rides](./rides.md) · [Pool & Escrow](./pool.md) · [Web3 & Solana](./web3_solana.md) · [Referral Program](./referral.md) · [Promo Codes](./promocodes.md) · [Product & As-Built Behavior](./PRODUCT.md) · [Decision Log](./DECISIONS.md) (D49, D50).

---

## 1. Token Supply & Allocation Buckets (`server/src/domain/honk/tokenomics.ts`)

- **Fixed Total Supply**: `100,000,000 TEN4` (`HONK_MAX_SUPPLY = 100_000_000n * UNIT`, `HONK_DECIMALS = 6`, `UNIT = 1_000_000n` base units per TEN4).
- **No Mint Authority After Genesis**: On-chain (`programs/freightchain_honk`), `initialize` mints the fixed 100M supply into program-owned vaults and revokes the mint authority in the same instruction. Until TGE, the PostgreSQL ledger is the source of truth and the UI displays balances as points (`LEG-M-06`).
- **Six Allocation Buckets (`HONK_MAX_SUPPLY`)**:

| Constant | Allocation (TEN4) | Share | Purpose & Vesting / Cap Rules |
|---|---:|---:|---|
| `HONK_EMISSION_CAP` | `55,000,000` | 55% | Verified paid-ride checkpoint emissions (`eraIndex` halving eras: first era `27.5M`, each subsequent era half the previous). |
| `HONK_LIQUIDITY` | `15,000,000` | 15% | DEX liquidity pool reserve (held for TGE; no AMM on devnet). |
| `HONK_TREASURY` | `10,000,000` | 10% | Ecosystem & operations treasury (`HONK_TREASURY_VEST_MONTHS = 36` linear monthly vest). |
| `HONK_AIRDROP` | `8,000,000` | 8% | Pre-season & community airdrop (`HONK_AIRDROP_WALLET_CAP = 2,000 TEN4`, `HONK_AIRDROP_WINDOW_DAYS = 90`). |
| `HONK_TEAM` | `8,000,000` | 8% | Core contributors (`HONK_TEAM_CLIFF_MONTHS = 12` cliff + `HONK_TEAM_LINEAR_MONTHS = 24` linear monthly vest). |
| `HONK_REFERRAL` | `4,000,000` | 4% | Referral / Convoy pool (`HONK_REFERRAL_ERA_SIZE = 2M` halving eras, `30k/mo` soft start for 3 months then `60k/mo` global cap, `1,000 TEN4/mo` per-wallet cap). |

Invariant: `55M + 15M + 10M + 8M + 8M + 4M === 100,000,000 TEN4`.

---

## 2. Driving Emissions, Checkpoints, Halving Eras & Caps (`tokenomics.ts`)

### 2.1 Paid-Ride-Only & Checkpoint Bands (`FINISH`, `BANDS`, `bandAmounts`)
- **Eligible Rides**: Only verified paid rides (`tier in ('1h', '4h', '8h')`, excluding free trainings, weekly free ticket grants, and `kind: 'ride'` promo shifts) mint TEN4.
- **Era-0 Full Finish Rewards (`FINISH`)**:
  - `'1h'` shift: **`100 TEN4`** (`100n * UNIT`)
  - `'4h'` shift: **`500 TEN4`** (`500n * UNIT`)
  - `'8h'` shift: **`1,200 TEN4`** (`1_200n * UNIT`)
  - Note: Under Decision 17 (`RID-M-01`), only `'1h'` shifts are sold/opened on the active schedule, while `'4h'` and `'8h'` remain in `FINISH` for legacy/test coverage.
- **Three Distance Checkpoints (`BANDS`)**:
  - **`20%` distance** (`pct: 20`, `bit: 1`): **`15%`** of full reward (`bps: 1500` → `15 TEN4` on 1h in Era 0)
  - **`50%` distance** (`pct: 50`, `bit: 2`): **`25%`** of full reward (`bps: 2500` → `25 TEN4` on 1h in Era 0)
  - **`100%` finish line** (`pct: 100`, `bit: 4`): **`60%`** of full reward (`bps: 6000` → `60 TEN4` on 1h in Era 0)
  - Sum of bands: `1500 + 2500 + 6000 = 10000 bps` (100%).
  - Band reach check (`bandAmounts`): `distance + 1 >= (completeDist * b.pct) / 100` (`+1 m` tolerance so a ride completed at the finish line always captures the `100%` band).
  - Bitmask encoding (`bandBits`): `(band20 ? 1 : 0) | (band50 ? 2 : 0) | (band100 ? 4 : 0)` (`0..7`).

### 2.2 Supply-Driven Halving Eras (`eraIndex`, `eraRemaining`, `finishUnits`)
- Driving eras are driven by cumulative `emitted` ride TEN4 (not wall-clock years):
  - `HONK_ERA_SIZE = HONK_EMISSION_CAP / 2n = 27,500,000 TEN4`.
  - **Era 0**: `0 <= emitted < 27.5M` (`size = 27.5M`, reward `base >> 0n`).
  - **Era 1**: `27.5M <= emitted < 41.25M` (`size = 13.75M`, reward `base >> 1n` = 50%).
  - **Era `e`**: Each subsequent era is half the size of the previous era and shifts the base reward right by `BigInt(era)` (`base >> BigInt(era)`), up to `era = 63` (`0n` once `emitted >= 55M`).

### 2.3 Daily Global & Per-Wallet Caps (`clipPayout`)
- **Global Daily Cap (`globalDailyCap(era)`)**: `HONK_DAILY_GLOBAL_ERA1 >> BigInt(era)`, where `HONK_DAILY_GLOBAL_ERA1 = 75,000 TEN4 / UTC day`.
- **Per-Wallet Daily Cap (`HONK_DAILY_WALLET`)**: `2,000 TEN4 / UTC day` per wallet (counting all mint rows stamped on that UTC day `dayStart(at)`, including `pending`).
- **Clipping Precedence (`clipPayout(quote, emitted, dayGlobal, dayWallet)`)**:
  1. If `quote <= 0n` or `HONK_EMISSION_CAP - emitted <= 0n` or `eraRemaining(emitted) <= 0n` → `{ amount: 0n, reason: 'emission' }`.
  2. If `globalDailyCap(era) - dayGlobal <= 0n` → `{ amount: 0n, reason: 'daily' }`.
  3. If `HONK_DAILY_WALLET - dayWallet <= 0n` → `{ amount: 0n, reason: 'wallet' }`.
  4. Otherwise `amount = min(quote, roomCap, roomEra, roomDay, roomWallet)` with `reason: 'ok'`.

### 2.4 Verdict Gate & 48-Hour Hold (`honkQuote`, `holdMs`, `ReleaseHonkHandler`)
- **Verdict Gate**:
  - While a ride is unjudged (`verdict === null` or `'pending'`): `state = 'preview'`, `pays = '0'`.
  - If `verdict === 'flagged'` or `'rejected'`: `state = 'withheld'`, `pays = '0'`.
  - If `verdict === 'verified'`:
    - `'1h'` and `'4h'` (`holdMs(tier) === 0`): credit immediately (`state = 'minted'`, `pays = quote`).
    - `'8h'` (`holdMs('8h') = HONK_HOLD_8H_MS = 48h`): writes a `HonkMint` row with `paid = false` and `releaseAt = now + 48h` (`state = 'pending'`, `pays = '0'`).
- **Immediate Cap Reservation & Clawback on Override (`ReleaseHonkHandler`)**:
  - A `pending` 8h `HonkMint` row immediately reserves its `amount` against the `55M` emission cap, the current halving era, the UTC daily global cap, and the wallet's daily cap at verdict time so concurrent finishes cannot over-commit the caps.
  - Once `now >= releaseAt`, `ReleaseHonkHandler` (`honk:release` worker/CLI) re-reads the ride's current verdict under `findByWalletForUpdate`:
    - If still `'verified'`, it sets `paid = true`, increments `Player.honkBalance`, and (when `HONK_PROGRAM_ID` is set) submits `mint_ride` / `pay_ride` on-chain (`state = 'minted'`).
    - If an admin overrode the verdict to `'flagged'` or `'rejected'` during the 48h hold window, the `HonkMint` row is deleted (`state = 'withheld'`) and the reserved emission room returns to the pool.

---

### 2.5 Durable chain delivery (as built locally)

`HonkMint` is also the emission outbox: new rewards created with an enabled emitter set `chainPending`; unreleased reservations cannot be sent. The minute release worker takes a two-minute lease under the player lock, submits outside the database transaction and records `chainSentAt` only after a matching confirmed PDA is verified. Failure or process restart retries the same ride ID. The migration defaults old rewards to unqueued, preserving ledger-only pre-TGE credits.

The local program's optional `expected_amount` argument is mandatory in server submissions. If the current chain caps/era would produce a different payment, `RewardMismatch` (6017) aborts all changes. Such a row remains pending for reconciliation; the retry does not alter its reserved amount or the ledger. The 52-byte RideMint receipt includes its recipient and is checked against amount/tier/bands, owner and discriminator. This is a fresh-program ABI/layout change.

## 3. Burn Sinks & The 9-Slot Cab Garage (`parts-catalog.ts` & `cosmetics.ts`)

### 3.1 Burn Sinks (`visualPrice`, `HONK_STREAM_BURN`, `HONK_TIME_BURN`, `HONK_WEATHER_BURN`)
1. **Cab Visual Part Mint (`POST /api/honk/visuals` & `POST /api/garage/buy`)**:
   - **Ordinary part (`PLAIN`)**: **`65 TEN4`** (`65n * UNIT`) — 37 parts across the 9 slots.
   - **Gold edition part (`GOLD`, `item === 'gold'`)**: **`260 TEN4`** (`260n * UNIT`) — 8 gold parts across the non-paint slots (`wheel`, `gearbox`, `dice`, `needle`, `ornament`, `dash`, `indicator`, `phone`).
   - Burning TEN4 permanently deducts the price from the wallet's balance (and when `HONK_PROGRAM_ID` is active, executes `buy_part` on-chain: burns TEN4 and mints a soulbound SPL part token with `decimals = 0, supply = 1` into the buyer's frozen ATA with mint authority revoked) and unlocks `(slot, item)` in `player.CosmeticUnlock`.
2. **Spectator Chat HONK Burn (`POST /api/watch/:id/honk`)**:
   - Costs **`1 TEN4`** (`HONK_STREAM_BURN = 1n * UNIT`), rate-limited to 1 burn per `STREAM_BURN_GAP_MS = 10,000 ms` (10s) per wallet per ride (`429` if on cooldown or chat window taken; refunded if rejected). Purely cosmetic horn/chat highlight (Decision 49).
3. **Spectator Time & Weather Burns (`POST /api/watch/:id/honk/time` & `/weather`)**:
   - **As-built on `main`**: `POST /api/watch/:id/honk/time` (`phase: 'day' | 'night'`) burns **`10 TEN4`** (`HONK_TIME_BURN`); `POST /api/watch/:id/honk/weather` (`weather: 'snow' | 'clear'`) burns **`25 TEN4`** (`HONK_WEATHER_BURN`).
   - **Target (Decision 49 / `RPL-M-17` / `RPL-M-34`)**: Remove `honk/time` and `honk/weather` gameplay effects so spectator burns are strictly cosmetic chat HONKs (`1 TEN4`).

### 3.2 The 9 Cosmetic Slots & 57 Catalog Items (`COSMETIC_SLOTS`, `COSMETIC_ITEMS`, `HONK_PARTS`)
Defined in `server/src/domain/economy/cosmetics.ts` and `server/src/domain/honk/parts-catalog.ts` (mirrored by `client/js/cosmetics.js`, drift-tested in `npm run check`):

| Slot (`CosmeticSlot`) | Default (`price: null`, free) | `65 TEN4` Unlockables (`PLAIN`) | `260 TEN4` Unlockable (`GOLD`) | Referral-Only (`code: 'referral'`) | Cockpit / Scene Renderer | Total |
|---|---|---|---|---|---|---|
| `wheel` | `'classic'` | `'crimson'`, `'ocean'`, `'moss'`, `'ivory'` (4) | `'gold'` (1) | — | `cockpit/wheel.js` | 6 |
| `truck_color` | `'red'` | `'blue'`, `'green'`, `'black'`, `'yellow'`, `'white'` (5) | — (0) | `'convoy'`, `'signal'`, `'amber'` (3) | `cockpit/cockpit.js` + `entity/vehicles/player_semi.js` (`setPlayerTruckColor`) | 9 |
| `gearbox` | `'stick'` | `'chrome'`, `'wood'`, `'racing'`, `'carbon'` (4) | `'gold'` (1) | — | `cockpit/shifter.js` | 6 |
| `dice` | `'white'` | `'red'`, `'blue'`, `'pink'`, `'black'` (4) | `'gold'` (1) | — | `cockpit/dice.js` | 6 |
| `needle` | `'orange'` | `'red'`, `'lime'`, `'cyan'`, `'white'` (4) | `'gold'` (1) | — | `cockpit/gauges.js` | 6 |
| `ornament` | `'spear'` | `'ball'`, `'star'`, `'bird'`, `'flag'` (4) | `'gold'` (1) | — | `cockpit/cockpit.js` (hood ornament) | 6 |
| `dash` | `'stock'` | `'wood'`, `'carbon'`, `'red'`, `'ivory'` (4) | `'gold'` (1) | — | `cockpit/cockpit.js` (dashboard trim) | 6 |
| `indicator` | `'amber'` | `'red'`, `'green'`, `'ice'`, `'white'` (4) | `'gold'` (1) | — | `cockpit/dashboard.js` (`turnArrow`) + `cockpit/gauges.js` (`drawGearLamp`) | 6 |
| `phone` | `'black'` | `'silver'`, `'red'`, `'blue'`, `'clear'` (4) | `'gold'` (1) | — | `cockpit/phone.js` | 6 |
| **Total** | **9 defaults** | **37 × `65 TEN4`** | **8 × `260 TEN4`** | **3 referral paints** | | **57 items** |

- `HONK_PARTS` has `54` rows (`sort: 0..53`): `9` defaults (`price: null`) + `45` TEN4-burnable parts (`37` at `65 TEN4` + `8` `'gold'` at `260 TEN4`).
  - Ordered item tuples for the 4 newer cab slots (`gold` is at index 3 in each): `ornament: ['spear', 'ball', 'star', 'gold', 'bird', 'flag']` (`cockpit/cockpit.js` `drawOrnament`), `dash: ['stock', 'wood', 'carbon', 'gold', 'red', 'ivory']` (`cockpit/cockpit.js`), `indicator: ['amber', 'red', 'green', 'gold', 'ice', 'white']` (`cockpit/dashboard.js` `turnArrow` + `cockpit/gauges.js` `drawGearLamp`, using `dimHex`), `phone: ['black', 'silver', 'red', 'gold', 'blue', 'clear']` (`cockpit/phone.js`).
- Plus `3` referral gift paints (`'convoy'`, `'signal'`, `'amber'` in `truck_color`) = **`48` non-default unlockable items** (`57` total items in `COSMETIC_ITEMS`).
- **Pixel Parity of Defaults**: The 9 default items (`classic`, `red`, `stick`, `white`, `orange`, `spear`, `stock`, `amber`, `black`) in `LOOKS` (`client/js/cosmetics.js`) must draw the exact same pixels as the original baseline cockpit (enforced by `npm run check` and `trace:diff`).
- **Lobby Garage Preview & All-or-Nothing Save (`client/site/garage-cab.js`, `POST /api/garage/loadout`)**:
  - `lobby.html#garage` mounts the real 2D cockpit canvas (`client/site/garage-cab.js`, screenshots `garage-desktop.png` / `garage-phone.png` in E2E) and stores equipped slots in `player.CosmeticEquip`.
  - `GET /api/garage` returns `GarageDto` (all parts, owned flags, current `Loadout`, and collection progress `owned / 48`).
  - `POST /api/garage/loadout` (body `{ loadout }`) validates all 9 slots; if any picked item is unknown (`400`) or not owned by the wallet (`409 not_owned`), nothing is saved (all-or-nothing).

---

## 4. Local On-Chain Program (`programs/freightchain_honk`) & Airdrop Campaign

### 4.1 Program Architecture, PDAs, Errors & Instructions (`programs/freightchain_honk`)
- **Crate / Program ID**: `programs/freightchain_honk` (`GctCYSHbCnHN8sE1LjUL9cmSpFd5mcVdfaumRcaVWZZx`, keypair `programs/freightchain_honk/program-keypair.json`; build with `anchor build --arch v0 -p freightchain_honk`, tested via LiteSVM `npm run program:test` — 40 Rust tests — and local validator `bash .claude/skills/honk-localnet/run.sh` / `bash .claude/skills/honk-suite/run.sh`, see [`docs/agents/ten4-localnet.md`](../agents/ten4-localnet.md)).
- **Dual Mode**:
  - When `HONK_PROGRAM_ID` is unset (pre-TGE / Block 1 off-chain ledger mode), `GET /api/honk` returns `chain: null` and balances/burns run purely against PostgreSQL under `findByWalletForUpdate`.
  - When `HONK_PROGRAM_ID` is set, mutations verify on-chain transaction signatures (`isTransactionSignature` in `chain-tx.ts`).
- **PDA Seeds**:
  - Core & AMM: `[b"config"]`, `[b"authority"]`, `[b"honk-mint"]` (`decimals = 6`), `[b"vault"]` (SOL vault), `[b"pool"]` (pool TEN4 vault), `[b"lp-mint"]`, `[b"lp-locker"]`, `[b"locker"]`.
  - Allocation vaults: `[b"emission"]` (`55M`), `[b"airdrop"]` (`8M`), `[b"referral"]` (`4M`), `[b"treasury"]` (`10M`), `[b"team"]` (`8M`).
  - Tracking & receipts: `[b"wallet-day", rider, &day.to_le_bytes()]` (`WalletDay`), `[b"ride-mint", &ride_id]` (`RideMint`), `[b"wallet-month", referrer, &month.to_le_bytes()]` (`WalletMonth`), `[b"referral-mint", &reward_id]` (`ReferralMint`), `[b"airdrop", &[campaign]]` (`AirdropCampaign`), `[b"airdrop", &[campaign], wallet]` (`AirdropClaim`), `[b"wallet-airdrop", wallet]` (`WalletAirdrop`), `[b"part", buyer, &slot, &item]` (`PartMint`, 16-byte padded `slot` and `item`).
- **Program Error Codes (`6000..6016`)**:
  - `6000 ZeroAmount`, `6001 ZeroOut`, `6002 TooEarly`, `6003 AlreadyBought`, `6004 Slippage`, `6005 NotForSale`, `6006 EmissionCap`, `6007 DailyCap`, `6008 WalletCap`, `6009 BadTier`, `6010 BadAuthority`, `6011 BadVest`, `6012 TeamDisabled`, `6013 BadDay`, `6014 BadMonth`, `6015 BadMerkleProof`, `6016 AirdropClosed`.
- **Instructions**:
  1. `initialize(sol_in: u64, emitter: Pubkey, treasury: Pubkey, team_recipient: Pubkey, team_enabled: bool, team_linear_months: u8)`: Requires `sol_in == 50_000_000_000` (`50 SOL`), `team_enabled == true`, and `team_linear_months == 24` (`BadVest` `6011`), verifies upgrade authority, creates `[b"config"]` and `[b"honk-mint"]` (`decimals = 6`), mints the fixed `100,000,000 TEN4` across `[b"emission"]` (`55M`), `[b"pool"]` (`15M`), `[b"treasury"]` (`10M`), `[b"airdrop"]` (`8M`), `[b"team"]` (`8M`), and `[b"referral"]` (`4M`), mints `isqrt(liquidity * sol_in)` LP tokens and burns them, and **revokes `MintTokens` and `FreezeAccount` authorities (`None`) on `honk-mint` in the same instruction**.
  2. `swap_sol_for_honk(sol_in: u64, min_honk_out: u64)` & `swap_honk_for_sol(honk_in: u64, min_sol_out: u64)`: Constant-product AMM swaps with `25 bps` fee (`net = in * 9975 / 10000`, `Slippage` `6004` check).
  3. `burn(amount: u64)`: Burns `amount > 0` (`ZeroAmount` `6000`) from the signer's TEN4 token account and increments `config.burned`.
  4. `mint_ride(ride_id: [u8; 16], tier: u8, bands: u8, day: i64)`: Authority-signed (`emitter`) driving payout from `[b"emission"]`; initializes `[b"ride-mint", &ride_id]` (`RideMint`) and updates `[b"wallet-day", rider, &day.to_le_bytes()]`, enforcing `tier` (`BadTier` `6009`), `day` (`BadDay` `6013`), `55M` cap (`EmissionCap` `6006`), era halving, `75,000 >> era` daily global cap (`DailyCap` `6007`), and `2,000 TEN4` daily wallet cap (`WalletCap` `6008`).
  5. `pay_referral(reward_id: [u8; 16], base_amount: u64, month_index: i64)`: Authority-signed (`emitter`) Convoy milestone payout (`base_amount = 100 * UNIT` for M1 or `50 * UNIT` for M2) from `[b"referral"]`; initializes `[b"referral-mint", &reward_id]` and updates `[b"wallet-month", referrer, &month_index.to_le_bytes()]`, enforcing `4M` cap, `>> max(era_ref, era_ride)`, `30k` (first 3 months) / `60k` monthly global cap, and `1,000 TEN4` monthly per-wallet cap.
  6. `burn_referral_tail()`: Permissionless burn of any remaining `[b"referral"]` balance once `era >= 8`.
  7. `set_airdrop_root(campaign: u8, root: [u8; 32], allocation: u64)`: Authority (`emitter`) registers `[b"airdrop", &[campaign]]` with a fixed 90-day claim window (`close_at = now + 90 * 86400`) and reserves `allocation` against `8M`.
  8. `claim_airdrop(campaign: u8, amount: u64, proof: Vec<[u8; 32]>)`: User-signed Merkle claim over `sha256(b"fc:airdrop:v1" || [campaign] || wallet || amount_le)` up to `2,000 TEN4` lifetime per wallet (`[b"wallet-airdrop", wallet]`, `WalletCap` `6008`), initializing `[b"airdrop", &[campaign], wallet]` (`BadMerkleProof` `6015`, `AirdropClosed` `6016`).
  9. `burn_unclaimed(campaign: u8)`: Permissionless burn of `campaign.allocation - campaign.claimed` from `[b"airdrop"]` once `now >= close_at`.
  10. `claim_treasury()`: Permissionless crank releasing vested `10M` `[b"treasury"]` tokens linearly over `36` 30-day months (`elapsed / (36 * 86400 * 30)`) to `treasury`.
  11. `claim_team()`: Permissionless crank releasing `[b"team"]` (`8M`) to `team_recipient` after a `12`-month cliff followed by `team_linear_months` (`24`) linear 30-day months (`TeamDisabled` `6012`, `TooEarly` `6002`).
  12. `buy_part(slot: [u8; 16], item: [u8; 16])`: Validates `(slot, item)` against the 45-part catalog (`NotForSale` `6005`), burns `65` or `260 TEN4` from the buyer's TEN4 ATA, initializes receipt PDA `[b"part", buyer, &slot, &item]` (`PartMint`) and classic SPL mint account `nft_mint` (`decimals = 0`, `freeze_authority = authority`), mints `1` token to the buyer's `nft_ata`, **freezes the buyer's `nft_ata` (`freeze_account`)**, and **revokes mint authority (`set_authority(MintTokens, None)`)** so the part is permanently soulbound and cannot be bought twice (`AlreadyBought` `6003`).

### 4.2 Airdrop Campaign Specification (`MASTER_PLAN.md` §7 & §12, Migration `20261107000000_airdrop`)

**Local implementation:** Profile has an EN/RU campaign task panel. Channel/group ownership and X proofs are durable; the event attempt additionally requires authenticated group activity and explicit event consent. Task evidence carries forward; no task-to-economic-points weights are specified here, so the app reports `completedTasks` separately and does not allocate or mint TEN4. The future TGE distribution remains unchanged. Runtime configuration and local verification are in [`CAMPAIGN_LOCAL.md`](../testing/CAMPAIGN_LOCAL.md).
- **Pool & Caps**:
  - Total Airdrop bucket: `HONK_AIRDROP = 8,000,000 TEN4` (`8%` of supply).
  - Season 1 allocation: **`2,000,000 TEN4`**, per-wallet cap **`HONK_AIRDROP_WALLET_CAP = 2,000 TEN4`**, Merkle claim window **`HONK_AIRDROP_WINDOW_DAYS = 90` days** after TGE (snapshot after Season 1 ends on `2027-02-28`, TGE no earlier than March 2027; unclaimed tokens burned via `burn_unclaimed`).
- **Configurable Campaign Tasks (`requiredTasks`)**:
  - Required tasks are configured per campaign (`requiredTasks`) and also gate Convoy referral milestones M1/M2 (`referral.md` §2.3).
  - **Pre-season & Season 1 Required Set (`MASTER_PLAN.md` §7, Round 19)**:
    1. Verified **MEDIUM or HARD** training ride (`free-2c` or `free-3c`; EASY does not qualify).
    2. **Telegram**: Join official channel and group chat.
    3. **X (Twitter)**: Follow `@FreightChainSol` + publish a quote-post containing the player's personal verification code.
       - Verified via **`twitterapi.io`** (no X OAuth required; campaign budget cap `airdrop_twitterapi_budget_usd = 100` at `~$0.005`/participant; Likes/Retweets are not checked). If `twitterapi.io` is unavailable or over budget, X tasks remain `'pending'` and the snapshot is deferred until resolved.
    4. **Discord**: Optional bonus task (not in `requiredTasks` for Pre-season).
  - Points earned during the devnet Pre-season carry forward into the Season 1 airdrop campaign.
- **Anti-Sybil & Trust Gates**:
  - Minimum trust score to qualify for airdrop snapshot: **`airdrop_min_trust = 50`** (`TrustScore >= 50`, see `anticheat.md` Appendix D).
  - At most **1 wallet per IP cluster** when corroborated by a second anti-sybil signal (`antisybil_ip_penalty_requires_second_signal = 1`).
  - Optional Cloudflare Turnstile challenge on social task binding (`turnstile_enabled = 0` by default).

---

## 5. Rules (`TEN-M-*` & `TEN-T-*`)

| Rule ID | Rule | Enforced By | Test ID |
|---|---|---|---|
| **TEN-M-01** | Total supply is fixed at `100,000,000 TEN4` (`HONK_DECIMALS = 6`, `UNIT = 1_000_000n`) across 6 buckets: `55M` driving emissions, `15M` liquidity, `10M` treasury (36m vest), `8M` airdrop (`2k` wallet cap, 90d window), `8M` team (12m cliff + 24m vest), and `4M` referral. `initialize` revokes mint authority. | `tokenomics.ts`, `freightchain_honk` | `TEN-T-01`, `TEN-T-14` |
| **TEN-M-02** | Only verified paid rides (`tier in ('1h', '4h', '8h')`, excluding free trainings, weekly grants, and `kind: 'ride'` promo shifts) mint driving TEN4. Unjudged rides return `state: 'preview'`, and `flagged`/`rejected` rides return `state: 'withheld'` (`pays: '0'`). | `bandAmounts`, `honkQuote`, `HonkService` | `TEN-T-02`, `TEN-T-03` |
| **TEN-M-03** | Checkpoint bands pay at `20%` distance (`1500 bps` = 15%), `50%` distance (`2500 bps` = 25%), and `100%` finish (`6000 bps` = 60%, with `+1 m` tolerance `distance + 1 >= completeDist * pct / 100`). Era-0 full rewards are `100 TEN4` (`1h`), `500 TEN4` (`4h`), and `1,200 TEN4` (`8h`). | `BANDS`, `FINISH`, `bandAmounts`, `bandBits` | `TEN-T-04`, `TEN-T-05` |
| **TEN-M-04** | Supply-driven halving eras (`eraIndex`): Era 0 spans the first `27.5M` emitted driving TEN4, Era 1 the next `13.75M`, and each subsequent era halves in size and shifts rewards right by `BigInt(era)` (`base >> BigInt(era)`). | `eraIndex`, `eraRemaining`, `finishUnits` | `TEN-T-06` |
| **TEN-M-05** | `clipPayout` enforces in order: total emission cap (`55M`) and current era remaining (`reason: 'emission'`), global daily cap (`75,000 >> era` TEN4/UTC day, `reason: 'daily'`), and per-wallet daily cap (`2,000 TEN4/UTC day`, `reason: 'wallet'`). | `clipPayout`, `globalDailyCap` | `TEN-T-07` |
| **TEN-M-06** | `1h` and `4h` verified rides credit immediately (`holdMs === 0`, `state: 'minted'`), whereas `8h` verified rides write a `pending` `HonkMint` (`releaseAt = now + 48h`) that immediately reserves cap room; `ReleaseHonkHandler` releases after 48h if still `verified` or deletes the row (`withheld`) if overridden. | `holdMs`, `honkQuote`, `ReleaseHonkHandler` | `TEN-T-08` |
| **TEN-M-07** | The cosmetics catalog defines 9 `COSMETIC_SLOTS` (`wheel`, `truck_color`, `gearbox`, `dice`, `needle`, `ornament`, `dash`, `indicator`, `phone`) with 9 free stock defaults, 45 TEN4-burnable parts in `HONK_PARTS` (37 at `65 TEN4`, 8 `'gold'` at `260 TEN4`), and 3 referral paints (`convoy`, `signal`, `amber`) = 57 total items. | `COSMETIC_SLOTS`, `COSMETIC_ITEMS`, `HONK_PARTS`, `visualPrice` | `TEN-T-09` |
| **TEN-M-08** | `POST /api/honk/visuals` permanently burns `65 TEN4` (or `260 TEN4` for `'gold'`) under `findByWalletForUpdate`, unlocks `(slot, item)` for the wallet (on-chain `buy_part` mints 1 `decimals = 0` SPL token into a frozen ATA and revokes mint authority), and rejects default/referral items (`400`), already-owned parts (`409`), or insufficient TEN4 (`409`). | `MintHonkVisualCommand`, `HonkHttpController`, `freightchain_honk` | `TEN-T-10`, `TEN-T-14` |
| **TEN-M-09** | `POST /api/watch/:id/honk` burns `1 TEN4` (`HONK_STREAM_BURN`) for a chat HONK, enforcing a `10s` per-wallet cooldown (`STREAM_BURN_GAP_MS = 10_000`, `429`) and refunding the burn if the chat window is rejected. | `BurnHonkCommand`, `HonkHttpController` | `TEN-T-11` |
| **TEN-M-10** | `GET /api/garage` returns all catalog parts, ownership, progression (`owned / 48`), and current `Loadout`. `POST /api/garage/loadout` saves all 9 slots atomically (all-or-nothing), rejecting unknown items (`400`) or any unowned item (`409 not_owned`). | `GarageHttpController`, `GetGarageQuery`, `SaveGarageCommand` | `TEN-T-12` |
| **TEN-M-11** | When `HONK_PROGRAM_ID` is unset, `GET /api/honk` returns `chain: null` and operates in off-chain PostgreSQL ledger mode; when set, mutations verify on-chain transaction signatures (`isTransactionSignature`) against `freightchain_honk` (including Merkle airdrop claims capped at `2,000 TEN4` with 90d `burn_unclaimed` window). | `HonkHttpController`, `chain-tx.ts`, `freightchain_honk` | `TEN-T-13`, `TEN-T-14` |
| **TEN-T-12 (Target D49)** | Target Decision 49 (`RPL-M-17` / `RPL-M-34`): remove `POST /api/watch/:id/honk/time` (`10 TEN4`) and `POST /api/watch/:id/honk/weather` (`25 TEN4`) so TEN4 stream burns never alter ride time-of-day or weather. | `HonkHttpController`, `live` handlers (target) | `TEN-T-15` |

---

## 6. Verification & Test Suite Plan (`TEN-T-*`)

### 6.1 Unit Tests (`server/src/domain/honk/*.spec.ts` & `client/test/`)
- **`TEN-T-01`**: Verify `HONK_MAX_SUPPLY === 100_000_000n * 1_000_000n` (`55M + 15M + 10M + 8M + 8M + 4M`), `HONK_DECIMALS === 6`, and `formatHonk` decimal formatting.
- **`TEN-T-02`**: Verify `bandAmounts` returns empty bands and `0n` quote for `'free'`, unknown tiers, or `completeDist <= 0`.
- **`TEN-T-03`**: Verify `honkQuote` state transitions across `'preview'` (unjudged), `'withheld'` (`flagged` / `rejected`), `'pending'` (`8h` verified before 48h), and `'minted'` (`1h`/`4h` verified or `8h` paid).
- **`TEN-T-04`**: Verify `bandAmounts` at `19%`, `20%`, `50%`, `99%`, and `completeDist - 1` (`+1 m` tolerance) and confirm Era-0 band sums (`15 + 25 + 60 = 100 TEN4` for `1h`; `75 + 125 + 300 = 500 TEN4` for `4h`; `180 + 300 + 720 = 1,200 TEN4` for `8h`).
- **`TEN-T-05`**: Verify `bandBits` bitmask (`0..7`) for all combinations of `{ band20, band50, band100 }`.
- **`TEN-T-06`**: Verify `eraIndex(emitted)`, `eraRemaining(emitted)`, and `finishUnits(tier, era)` at era boundaries (`0`, `27.5M - 1`, `27.5M`, `41.25M`, `55M`).
- **`TEN-T-07`**: Verify `clipPayout` cap precedence (`'emission'` → `'daily'` → `'wallet'` → `'ok'`) and partial clipping when a quote straddles a cap boundary.
- **`TEN-T-08`**: Verify `holdMs('1h') === 0`, `holdMs('4h') === 0`, `holdMs('8h') === 172_800_000` (48h), and `ReleaseHonkHandler` release vs verdict-override clawback.
- **`TEN-T-09`**: Verify `COSMETIC_SLOTS` (9 slots), `COSMETIC_ITEMS` (57 items), `HONK_PARTS` (54 items: 9 defaults with `price: null`, 37 with `65 TEN4`, 8 `'gold'` with `260 TEN4`), and parity with `client/js/cosmetics.js`.
- **`TEN-T-10`**: Verify `MintHonkVisualCommand` deducts `65` or `260 TEN4`, unlocks `(slot, item)`, and throws `400` on default/referral items and `409` on already-owned or insufficient balance.
- **`TEN-T-11`**: Verify `BurnHonkCommand` deducts `1 TEN4`, enforces `STREAM_BURN_GAP_MS = 10_000` (`429`), and refunds on chat window rejection.
- **`TEN-T-12`**: Verify `GetGarageQuery` and `SaveGarageCommand` (`POST /api/garage/loadout`) atomically save all 9 slots and roll back with `409 not_owned` if even one slot specifies an unowned item.

### 6.2 Integration, Localnet & Stress Tests (`server/test/`, `.claude/skills/`)
- **`TEN-T-13`**: HTTP & PostgreSQL integration spec (`server/test/http/` & `e2e/catalog.mjs` `B1-LOBBY-*` / `B2-*`): verifies `GET /api/honk` (`chain: null` when `HONK_PROGRAM_ID` is unset), `GET /api/honk/catalog`, `POST /api/honk/visuals`, `GET /api/garage`, and `POST /api/garage/loadout`.
- **`TEN-T-14`**: Local validator & LiteSVM suite (`npm run program:test` — 40 Rust tests in `programs/freightchain_honk`, `bash .claude/skills/honk-localnet/run.sh`, `bash .claude/skills/honk-suite/run.sh`): deploys `freightchain_honk`, verifies 100M supply mint + authority revocation, `pay_ride` checkpoints, `pay_referral` + `burn_referral_tail`, `set_airdrop_root` + `claim_airdrop` (`2,000 TEN4` cap) + `burn_unclaimed` (90d), `claim_treasury` (36m), `claim_team` (12m + 24m), swaps, stream burns, and soulbound classic-SPL frozen-ATA part minting (`buy_part`).
- **`TEN-T-15`**: Tokenomics Monte Carlo stress test (`node .claude/skills/coin-grill/grill.mjs --self-test`): validates emission curves, halving boundaries, and burn sinks across simulated player cohorts.
