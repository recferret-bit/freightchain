# HONK spec (locked)

Agents implementing this branch follow these numbers. Do not retune them.

## What it is

HONK is a capped meme coin. SOL still buys a ticket and pays a pool. HONK is minted only when a paid ride's verdict is `verified`, at distance checkpoints. Free rides mint nothing. Starting a ride mints nothing. A crash that never reached a checkpoint mints nothing.

The ledger in PostgreSQL is the source of truth in this change. The server holds no mint key. When `HONK_PROGRAM_ID` is unset, burns stay on the ledger and no signature is required. When it is set, the wallet signs first and the server confirms that transaction before the ledger debit. A visual burn writes a soulbound entitlement. The garage equips that entitlement. Do not claim the coin or the visual NFT is live on devnet.

## Supply

| | HONK | base units (6 decimals) |
|---|---:|---:|
| Max supply | 100,000,000 | 100_000_000 × 10^6 |
| Genesis, liquidity pool only | 2,000,000 (2%) | reserved, not ride-minted |
| Ride emission cap | 98,000,000 | the counter stops here |

Decimals: 6. Symbol: HONK. No further mint after the emission cap. Burns do not raise the cap and are not reminted. A ride mint that does not fit the remaining emission mints the remainder (integer base units) and then the cap is closed.

## Checkpoints

Distance bands of that ride's `completeDist`: 20%, 50%, 100%. A band is reached when `distance + 1 >= completeDist * pct / 100` (the +1 metre keeps a finish the game calls complete on the 100% band).

Share of that tier's full mint, paid for each band reached (not cumulative weights — these shares sum to 100%):

| Band | Share |
|---|---:|
| 20% | 15% |
| 50% | 25% |
| 100% | 60% |

The multiplier is not the hour count. A longer shift pays more than its hours. Every band amount below is an integer.

| Tier | Ticket, face | Multiplier | 20% | Through 50% | Finish |
|---|---:|---:|---:|---:|---:|
| 1h | $5 | ×1 | 15 | 40 | 100 |
| 4h | $15 | ×5 | 75 | 200 | 500 |
| 8h | $50 | ×20 | 300 | 800 | 2,000 |

Hour proportion would have been ×1 / ×4 / ×8, a finish of 100 / 400 / 800. Eight verified 1h finishes mint 800. One verified 8h finish mints 2,000. Two verified 4h finishes mint 1,000.

HONK per ticket dollar on a verified finish: 1h 20, 4h 500/15 (33⅓), 8h 40. That ratio is the ticket's face price against the mint. It is not a market price for HONK.

Verified finishes that emit the whole 98,000,000 ride cap: 980,000 of 1h, 196,000 of 4h, or 49,000 of 8h. A 1h ride that stops at 50% (40 HONK) takes 2,450,000 such rides. One mix that also lands on the cap: 10,000 of 8h + 100,000 of 4h + 280,000 of 1h = 390,000 rides. Face-price ticket spend for the three pure finish cases: $4,900,000, $2,940,000, $2,450,000.

Free, unknown tier, or `completeDist <= 0` → 0.

## When it mints

Inside the verdict transaction, under the player row lock, after the verdict is saved:

- Status `verified` and no mint row for that `rideId`: insert the mint, add `amount` to the wallet balance and to the emission counter.
- Any other status: mint nothing.
- Idempotent on `rideId`. A later re-judge that leaves `verified` does not mint again.
- A verified ride that is later rejected is **not** clawed back. Spent coins cannot be pulled back. Say so in the explainer.
- Flagged is not a pass. Rejected is not a pass.

## What the rider sees

`RideDto.honk`:

```ts
{
  state: 'none' | 'preview' | 'minted' | 'withheld',
  pays: string,   // HONK credited, decimal. "0" unless state is minted.
  quote: string,  // HONK a verification pass would pay at this distance.
  full: string,   // HONK if every band of this tier is reached.
  bands: { pct: 20 | 50 | 100, reached: boolean, amount: string }[]
}
```

- Paid ride, verdict not in yet: `preview`. `pays` is "0". `quote` is the checkpoint sum.
- Verdict `verified` and quote > 0: `minted`. `pays` equals the minted amount (the remainder if the cap clipped it; until the mint row exists, `pays` may equal `quote`).
- Verdict `flagged` or `rejected`: `withheld`. `pays` is "0". `quote` still shows what a pass would have paid.
- Free or non-paid: `none`, all zeros, bands empty.

Decimal strings, no scientific notation, trim trailing zeros but keep at least one digit (`100`, `15`, `0`).

## Stream burn

`POST /api/watch/:rideId/honk`. Signed-in session. Body `{ signature? }`. The signature is required only when `HONK_PROGRAM_ID` is set, and then it must be a confirmed burn of exactly 1 HONK by that wallet. A bad signature does not debit.

- Burns 1 HONK. At the 10 second gap one wallet burns at most 6 a minute and 360 an hour. Over a ride that lasts its nominal shift that cap is 360 (1h), 1,440 (4h), or 2,880 (8h). A verified finish of the same tier minted 100, 500, or 2,000, so one wallet mashing the nominal shift burns more than that ride minted.
- The ride must be a running paid ride that can be watched. A free ride is refused (`free_ride_no_stream` already).
- No gameplay effect. No hole, no night, no hull change.
- One burn per wallet per ride per 10 seconds.
- Same transaction, player lock: debit the balance, insert a live chat message whose text is `HONK` (existing message kind, so the feed needs no new column). If the chat window refuses the line, the burn does not land.
- Insufficient balance is a domain error, not a 500.

Response: `{ balance: string, pays: "1" }`.

`POST /api/watch/:rideId/honk/time`. Signed-in session. Body `{ phase: "day" | "night", signature? }`. The signature is required only when `HONK_PROGRAM_ID` is set, and then it must burn exactly 10 HONK. A bad signature does not debit.

- Burns 10 HONK. The 1 HONK line above stays chat-only and does not move the clock.
- Posts a ride event of kind `honk`, effect `day` or `night`, text `Burned 10 HONK`, lamports 0. Same effect window as a NIGHT/DAY donation: 20 seconds, one game effect at a time. If that window refuses the line, the burn does not land (the debit is reversed).
- Not a donation. It does not pay the driver and does not increment donation totals.
- The driver's game moves the clock. The replay shows it about 25 seconds later, in the recorded hour.
- A free ride, the driver's own ride, a mute, or a ride that is not live is refused before any debit. `LIVE_EFFECTS` does not gate this burn. That switch still gates donation obstacles (potholes, trench, sinkhole). Production leaves it at `free`, which turns those off on paid rides. Day and night from HONK stay available on a paid ride that can be watched.
- Insufficient balance is a domain error (`honk_balance`), not a 500.

Response: `{ balance: string, pays: "10", phase }`.

`POST /api/watch/:rideId/honk/weather`. Signed-in session. Body `{ weather: "snow" | "clear", signature? }`. The signature is required only when `HONK_PROGRAM_ID` is set, and then it must burn exactly 25 HONK. A bad signature does not debit. Burns 25 HONK and posts a ride event of kind `honk`, effect `snow` or `clear`, text `Burned 25 HONK`, lamports 0, on the same 20 second effect window as day and night. Not a donation. `LIVE_EFFECTS` does not gate it. A refused window reverses the debit. A free ride, the driver's own ride, a mute, or a ride that is not live is refused before any debit. Response: `{ balance: string, pays: "25", weather }`.

## Visual NFT (replaces promo visuals)

Promo codes no longer grant cab colours. Ticket and extra-free-ride promos stay. Creating or redeeming `kind: 'cosmetic'` is refused with a domain error whose code is `visuals_are_honk`.

`GET /api/honk` (session): `{ balance, minted, burned, visuals: [{ id, slot, item, name }], chain }`. `chain` is `{ programId }` when `HONK_PROGRAM_ID` is set, otherwise null. No RPC URL.

`GET /api/honk/catalog` (public): all 54 cab parts, defaults included, `{ slot, item, name, description, price, isDefault }`. `price` is a HONK decimal string or null. Names, descriptions, and prices are rows in `economy.HonkPart` (migrations `20261028000000_honk_parts` and `20261030000000_honk_cab_slots`). The burn charges that row. A default has a null price and is not for sale. `GET /api/garage` copies the same name, description, and price onto each part.

`POST /api/honk/visuals` body `{ slot, item, signature? }` (Zod). Session. Player lock. `signature` is required only when `HONK_PROGRAM_ID` is set. Unknown or default parts are `bad_visual` before any chain read. A bad signature does not debit. When the program id is set, the confirmed transaction must be signed by the player, burn the catalog price of that slot and item, and mint a frozen supply-1 token to the player. That mint is stored on `chainMint` / `chainSignature`. The response `chain` is null when no program is configured.

- Price, from the `HonkPart` row: 260 HONK if `item === 'gold'`, otherwise 65 HONK. Both are 30% above the first prices (200 / 50). Current catalog, 45 unlockable parts, 8 of them gold: ordinary 37 × 65 = 2,405; golds 8 × 260 = 2,080; full garage = 4,485. Every slot but truck colour is 520; truck colour is 325 (no gold). Defaults are not for sale. Covers, verified finishes: one ordinary part is one 1h finish (100 minted, 35 left); one gold part is three 1h finishes or one 4h finish. The full garage is 4,485. That is the ticket, not a HONK price.
- Burns that price, writes `HonkVisual` (id = first 32 hex chars of sha256 utf8 `wallet|slot|item`), unlocks the cosmetic with `code` `honk:<id>`, metadata JSON at `design/honk/visuals/<slot>-<item>.json`.
- Already owned: conflict, nothing burned.
- The entitlement is soulbound: no transfer route.

Existing promo unlocks stay wearable. The garage copy stops saying a promo code unlocks a part.

## Achievement

New family `honk`, name `HONK`. Three new ids. Do not retune any existing id or target.

| id | tier | name | desc | measure | target |
|---|---:|---|---|---|---:|
| `honk-haul` | 1 | First Mint | A verified paid ride mints HONK. | `honkMints` | 1 |
| `honk-haul-2` | 2 | Checkpoint Hauler | Five verified paid rides mint the finish band. | `honkFinishes` | 5 |
| `honk-haul-3` | 3 | Long Haul Mint | Twenty-five verified paid rides mint the finish band. | `honkFinishes` | 25 |

Names ≤ 32 characters. New facts on `Facts`: `honkMints` (mint rows with amount > 0), `honkFinishes` (those with the 100% band). Both ride-query repositories fill them. A rejected ride never has a mint row, so it cannot earn these.

Generate the badge SVGs (`node design/achievements/generate.mjs --only=honk-haul,honk-haul-2,honk-haul-3 --no-png`) and copy the three earned SVGs to `landing/public/badges/`.

## Ledger tables (schema `economy`)

- `HonkAccount`: wallet pk, balance, minted, burned (BigInt base units), updatedAt.
- `HonkMint`: rideId pk, wallet, tier, amount, band20, band50, band100, createdAt. Index wallet.
- `HonkBurn`: id pk, wallet, amount, kind (`stream` \| `visual` \| `time`), ref, createdAt. Index (wallet, createdAt).
- `HonkVisual`: id pk, wallet, slot, item, amount, createdAt. Unique (wallet, slot, item).
- `HonkSupply`: id Int pk default 1, minted BigInt. One row, created on first mint.

Add the new tables to the integration truncate list. Migration `20261027000000_honk`. Forward only.

## Tests the server change owes

- Unit: the pure quote (bands, multipliers, free, cap clip, withheld vs minted).
- Unit: mint service (verified inserts once, flagged inserts nothing, second verified call does not double, cap clips).
- Unit: burn handlers (stream, visual, insufficient, already owned, cosmetic promo refused).
- Integration: repository, two concurrent mints of one ride produce one row.
- HTTP scenario: end a paid ride that verifies and the ride JSON `honk.state` is `minted`; a rejected ride is `withheld`.

## Out of scope

A local program holds the genesis pool and is not deployed. SOL and HONK swap both ways. LP redeems after 365 days. No SPL mint key. No Raydium transaction. No change to pool prize maths. No gameplay effect from the 1 HONK chat burn. The 10 HONK burn only moves the clock between day and night. No free-ride mint. No ICO.
