# TEN4 spec

The owner replaced the locked HONK numbers on 2026-10-16. Agents follow these numbers. HONK stays the in-game verb (the chat line, the watch button). The coin is TEN4.

The ticker TEN4 was checked against CoinGecko, DexScreener, and Jupiter on 2026-10-16. HONK is already a live Solana token (`3ag1Mj9AKz9FAkCQ6gAEhpLSX8B2pUbPdkb9iBsDLZNB`). A later rename changes `TOKEN_NAME` / `TOKEN_SYMBOL` in the program constants, `server/src/domain/honk/tokenomics.ts`, and `client/js/config.js`, plus the Metaplex metadata at launch.

## What it is

TEN4 is a capped coin. SOL still buys a ticket and pays a pool. TEN4 is reserved only when a paid ride's verdict is `verified`, at distance checkpoints. Free rides mint nothing. A ride granted by a promo code mints nothing, ranked or not. Starting a ride mints nothing. A crash that never reached a checkpoint mints nothing.

Until TGE the PostgreSQL ledger is the source of truth. The UI calls the balance points, not a live coin. `HONK_PROGRAM_ID` unset means ledger-only: burns need no signature. When it is set, the wallet signs first and the server confirms that transaction before the ledger debit. Do not claim the coin or the visual is live on devnet. Do not deploy.

## Supply

| Bucket | TEN4 | Notes |
|---|---:|---|
| Max | 100,000,000 | 6 decimals |
| Liquidity | 15,000,000 | paired with 50 SOL in the local pool |
| Ride emission | 55,000,000 | pre-minted to the emission vault |
| Airdrop | 8,000,000 | pre-minted to the airdrop vault (`set_airdrop_root`, `claim_airdrop`, `burn_unclaimed` after 90 days; Season 1 = 2M, max 2,000 per wallet) |
| Referral (Convoy) | 4,000,000 | pre-minted to the referral vault (`pay_referral` with eras 2M/1M/…, `>> max(era_ref, era_ride)`, 30k/mo first 3m then 60k/mo, 1,000/mo per wallet; `burn_referral_tail` after era 8) |
| Treasury | 10,000,000 | 36 months linear, cliff 0 |
| Team | 8,000,000 | 12-month cliff, then 24 months linear (`team_enabled = true`, `team_linear_months = 24`) |

`team_enabled` must be `true` (else `TeamDisabled`) with a non-default recipient (else `BadAuthority`) and `team_linear_months = 24` (else `BadVest`) at `initialize`. The 8,000,000 sit in the team vault (`claim_team`, PDA `[b"team"]`, `TEAM_CLIFF_MONTHS = 12`, `TEAM_LINEAR_MONTHS = 24`). Vesting is in the program (non-cancelable, recipient immutable). A month is 30 days.

Mint authority is set to none in `initialize`. Freeze authority on the fungible mint is omitted. There is no Metaplex account in this program (LiteSVM has no metadata program). Config stores the name and symbol bytes. At TGE the Metaplex metadata must copy those bytes with `is_mutable = false` and the update authority cleared.

Emitter, treasury, and the upgrade authority are intended to be a Squads multisig. The program stores the emitter and treasury pubkeys passed at initialize. The upgrade authority is the BPF loader's deploy authority; transfer it to Squads after a deploy. This change does not deploy and does not create a Squads.

## Emission

Eras are 27,500,000, then 13,750,000, then 6,875,000, and so on (`ERA_SIZE = EMISSION_CAP / 2`). The era of a payment is the era of `emitted` before that payment. A ride that crosses the boundary is paid at the current era rate and clipped to the era remaining. Dust after the halving floor stays in the vault.

Era-1 finishes: 1h 100, 4h 500, 8h 1,200 (the old ×20 finish of 2,000 is cut to ×12). Later eras shift those base units right by the era index, so a late era can pay a fraction of one TEN4. Bands stay 15 / 25 / 60 of that era's finish.

| Tier | 20% | Through 50% | Finish | TEN4 per ticket dollar |
|---|---:|---:|---:|---:|
| 1h ($5) | 15 | 40 | 100 | 20 |
| 4h ($15) | 75 | 200 | 500 | 500/15 |
| 8h ($50) | 180 | 480 | 1,200 | 24 |

A band is reached when `distance + 1 >= completeDist * pct / 100`. Free, unknown tier, or `completeDist <= 0` pays 0.

Era-1 pure finishes that fill 27,500,000: 275,000 of 1h, 55,000 of 4h, or 22,916 full 8h finishes plus one clipped to 800. Later eras repeat a similar ride count at half pay. The old whole-cap counts (980,000 / 196,000 / 49,000 and the 390,000 mix) were for a 98,000,000 emission at the old 8h rate. They are obsolete.

Daily caps, unix day (`timestamp / 86400`, and the caller must pass that day or the program returns `BadDay`):

- Global, era 1: 75,000 TEN4. It halves each era (`75_000 >> era`), so era 1 lasts at least about a year (27,500,000 / 75,000 ≈ 366.7 days).
- Wallet: 2,000 TEN4. It does not halve.

A payout is clipped to the tightest of the emission cap, the era remaining, the global day, and the wallet day. No room returns emission, then daily, then wallet, in that order. Pending 8h rows count toward the day they were reserved.

## When it mints

Inside the verdict transaction, under the player row lock, after the verdict is saved:

- Status `verified`, no mint row: quote at the current era, clip, insert the row, add the amount to the emission counter.
- 1h and 4h: `released` immediately, credit the wallet, then (after commit) the chain mint if a program id is set. Not clawed back later.
- 8h: `released` false, `releaseAt` = now + 48 hours. The wallet is not credited and the chain is not called. The row still counts toward that day's caps.
- Any other status: if an unreleased row exists, delete it and subtract the reservation. A released row stays.
- Idempotent on `rideId`.

`ReleaseHonk` runs on a 60s timer. One transaction per wallet, under that player's row lock. It credits only rows whose `releaseAt` has passed, then calls the chain. A missing player is skipped. Badges count only `released` rows, so an 8h badge lands on a later profile read, not at the end of the ride.

## What the rider sees

`RideDto.honk` states: `none` | `preview` | `pending` | `minted` | `withheld`.

- Preview before a verdict. `pays` is "0".
- Verified 8h that is not yet released: `pending`. `pays` is "0". `get-ride` passes the mint's `released` flag. `/end` does not, so a fresh 8h finish is pending.
- Verified and released (or 1h/4h): `minted`. `pays` is the unclipped quote. The ledger may have clipped it.
- Flagged or rejected: `withheld`.
- Free: `none`.

The ride card quotes era 1 (it does not read the emission counter). The ledger applies the current era at credit time.

## Burns

`POST /api/watch/:rideId/honk` burns 1 TEN4 and posts the chat line `HONK`. Once per wallet per ride per 10 seconds. No effect on the truck. Spectator burns do not affect the verdict or prize rank.

`POST /api/watch/:rideId/honk/time` burns 10 TEN4. Event text `Burned 10 TEN4`. It moves the driver's clock between day and night.

`POST /api/watch/:rideId/honk/weather` burns 25 TEN4. Event text `Burned 25 TEN4`. Snow or clear. Not a donation.

An 8h finish of 1,200 funds 1,200 honks: 3 h 20 min at the 10s cap, about 41.7% of a nominal 8h of mashing (2,880).

Cab parts: 65, or 260 if gold. Full garage 4,485. Era-1 covers: four 8h finishes are 4,800; three 8h plus two 4h are 4,600; nine 4h and forty-five 1h still cover. The first five slots are 2,405: two 8h finishes are 2,400 (short by 5); two 8h plus a 1h 20% band (15) are 2,415; five 4h or twenty-five 1h are 2,500. Promo `kind: 'cosmetic'` stays refused (`visuals_are_honk`). The sentence says TEN4.

Sinks written here only, not built: Billboard 500, Bug Splat 5, Depot Goal 1,000, CB handle 100, seasonal garage (+1% per sale).

## Achievements

Ids stay `honk-haul`, `honk-haul-2`, `honk-haul-3`. Do not retune targets. The family key stays `honk`. The display name is TEN4. The first description is "A verified paid ride mints TEN4." `honkMints` and `honkFinishes` count released rows only.

## Ledger

Table names stay `Honk*`. Routes stay `/api/honk`. Env stays `HONK_PROGRAM_ID`. `HonkMint` gains `releaseAt` and `released` (existing rows default released, because they were already credited). Migration `20261031000000_honk_tokenomics`.

## Local program

`freightchain_honk`, id `GctCYSHbCnHN8sE1LjUL9cmSpFd5mcVdfaumRcaVWZZx`. Not deployed. `initialize` pre-mints the 6 buckets (15M liquidity, 55M emission, 8M airdrop, 4M referral, 10M treasury, 8M team = 100M TEN4), burns the LP (`isqrt(liquidity * 50 SOL)`), and revokes both mint authorities. Swap fee is 25 bps; the fee stays in the pool (output uses the net input, the reserve adds the full input). There is no `release_lp` and no `withdraw_lp`. `mint_ride` derives the amount from tier and band bits and transfers it from the emission vault. `pay_referral` pays milestone 1 (100 TEN4) or milestone 2 (50 TEN4) shifted by `max(era_ref, era_ride)` from the referral vault under global/wallet monthly caps, and `burn_referral_tail` burns remaining referral vault dust once `era_ref >= 8`. `set_airdrop_root`, `claim_airdrop`, and `burn_unclaimed` manage 90-day merkle airdrop campaigns (max 2,000 TEN4 per wallet across campaigns). The real launch pool should be a standard Raydium CPMM (or Meteora DAMM v2) at 0.25–1% with the LP burned. The in-program AMM is the local mirror. A Meteora DBC fair launch is deferred and unverified.

## Deferred

Server-side airdrop campaign snapshot + merkle tree generator (`G27`). Weigh Station / Dune. Anti-sybil beyond the existing verified-paid verdict (`G15`/`G26`). Legal review. Devnet rehearsal. Audit and a verified build. Raydium or Meteora pool. Metaplex CPI. Squads creation. A 1.8B "18 wheels" supply. A charity convoy (needs Desert Bus permission). The new sinks above, as code.

## Not a promise

Points until TGE. Not a prize. No yield. The 50 SOL opening deposit is not a dollar price. A review figure of about $104 per SOL is unverified and is not a FDV.
