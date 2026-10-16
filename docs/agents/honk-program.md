# HONK program (local)

A second Anchor program in `programs/freightchain-pools`, crate `freightchain_honk`. It is not the prize-pool program and it is not deployed. Devnet and mainnet stay untouched. The game ledger is still the ride mint and the cab entitlement. This program is the coin: one mint, one pool, burns, and a soulbound part.

Program id: `GctCYSHbCnHN8sE1LjUL9cmSpFd5mcVdfaumRcaVWZZx` (`programs/freightchain-pools/programs/freightchain_honk/program-keypair.json`). Do not print that file. Do not use `~/.config/solana/id.json`.

Numbers, locked, from `server/src/domain/honk/tokenomics.ts`:

- decimals 6, `UNIT = 1_000_000`
- genesis mint `2_000_000 * UNIT` into the vault. Ride emission is a separate mint, capped at `98_000_000 * UNIT`, and it does not enter the vault
- ordinary part `65 * UNIT`, gold part `260 * UNIT`

`initialize` takes exactly 10 SOL (`10_000_000_000` lamports). That is the opening deposit, not a price in dollars. Any other amount fails with `ZeroAmount`. Fee is 0 so the constant product is exact. That is not a market quote and not a listing.

Error codes, in order: `ZeroAmount` 6000, `ZeroOut` 6001, `TooEarly` 6002, `AlreadyBought` 6003, `Slippage` 6004, `NotForSale` 6005, `EmissionCap` 6006.

## Instructions

Build with `anchor build --arch v0 -p freightchain_honk` from `programs/freightchain-pools` (LiteSVM 0.10 needs SBF v0). Do not change `freightchain_pools`.

PDA seeds: `config`, `authority`, `honk-mint`, `vault`, `pool`, `lp-mint`, `lp-locker`, `locker`, `part` + buyer + slot + item, and `ride-mint` + ride id.

`initialize(sol_in: u64)`

- Creates the HONK mint (6 decimals). Mint authority stays the `authority` PDA so `mint_ride` can pay a verified ride under the cap. Freeze authority is none, so a holder cannot be frozen. Mints exactly the genesis amount into `vault`.
- Creates the LP mint, mints `isqrt(genesis * sol_in)` LP tokens into `lp-locker`, then sets the LP mint authority to none. Its freeze authority is none.
- Accepts only `sol_in == 10_000_000_000`. Any other amount, including zero, fails with `ZeroAmount` and moves nothing. The payer's SOL moves onto the pool account. `pool.sol_reserve = sol_in`, `pool.honk_reserve = genesis`, `pool.unlock_at = now + 365 days`.
- Accounts, in order: payer (signer, writable), config, honk_mint, authority, vault, pool, lp_mint, lp_locker, locker, token_program, system_program.

`swap_sol_for_honk(sol_in: u64, min_out: u64)`

- `out = honk_reserve * sol_in / (sol_reserve + sol_in)` in u128. `sol_in == 0` fails with `ZeroAmount`. `out == 0` fails with `ZeroOut`.
- `out < min_out` fails with `Slippage` (6004) and moves nothing. `min_out == 0` is allowed and means any positive out. `out == min_out` lands.
- Moves SOL onto the pool and HONK out of the vault to the user's ATA.
- Accounts: user (signer, writable), pool, honk_mint, vault, user_honk (init if needed), token_program, system_program, associated_token_program.

`swap_honk_for_sol(honk_in: u64, min_sol_out: u64)`

- The other side of the same product: `sol_out = sol_reserve * honk_in / (honk_reserve + honk_in)`, rounded down. `honk_in == 0` is `ZeroAmount`. `sol_out == 0` is `ZeroOut`. `sol_out < min_sol_out` is `Slippage` and moves nothing.
- HONK moves into the vault. SOL moves off the pool account by debiting its lamports. The pool account is not a system account, so this is not a system transfer. Rent stays on the pool.
- Accounts: user (signer, writable), pool, honk_mint, vault, user_honk, token_program.

`withdraw_lp(lp_in: u64, min_honk: u64, min_sol: u64)`

- Burns the caller's LP and pays that share of both reserves, rounded down. `lp_in == supply` pays the whole reserve. Either share may be zero. Both zero is `ZeroOut`. A share under its minimum is `Slippage`.
- The locker holds the whole supply until `release_lp`, so a holder cannot redeem early. Redeeming does not mint. It returns what the vault and the SOL reserve still hold.
- Accounts: user (signer, writable), pool, honk_mint, vault, user_honk (init if needed), lp_mint, user_lp, token_program, system_program, associated_token_program.

`burn(amount: u64)`

- The user burns `amount` of their own HONK. `amount == 0` fails. Supply falls. The pool reserves do not move.
- Accounts: user (signer, writable), honk_mint, user_honk, token_program.

`mint_ride(ride_id: [u8; 16], amount: u64)`

- Only `config.emitter` (the initialize payer) may call it. Mints `amount` to the rider. The vault does not move. `config.emitted + amount` must fit under `98_000_000 * UNIT` or the call fails with `EmissionCap`. The same ride id cannot mint twice.
- Accounts: emitter (signer, writable), config, honk_mint, authority, rider, rider_honk (init if needed), ride_mint, token_program, system_program, associated_token_program.

`buy_part(slot: [u8; 16], item: [u8; 16])`

- The program looks the pair up. The buyer does not pass a gold flag or a price.
- Unknown pairs and the free defaults fail with `NotForSale` (6005) and burn nothing. Defaults: `wheel/classic`, `truck_color/red`, `gearbox/stick`, `dice/white`, `needle/orange`, `ornament/spear`, `dash/stock`, `indicator/amber`, `phone/black`.
- Gold pairs burn `260 * UNIT`: `wheel/gold`, `gearbox/gold`, `dice/gold`, `needle/gold`, `ornament/gold`, `dash/gold`, `indicator/gold`, `phone/gold`. `truck_color` has no gold.
- Every other known pair burns `65 * UNIT`. Truck paint for sale is `blue`, `green`, `black`, `yellow`, `white`. The other ordinary ids are the rest of `docs/agents/honk-cab-slots.md` and the five older slots in `server/src/domain/honk/parts-catalog.ts`.
- Mints a new classic SPL token, decimals 0, supply 1, to the buyer. Freeze authority is `authority`. The mint authority is cleared. The buyer's token account is frozen. There is no thaw instruction, so a transfer fails.
- A second buy of the same buyer, slot, and item fails (`AlreadyBought`, 6003). `part.gold` is set from the catalog.
- Accounts: buyer (signer, writable), honk_mint, buyer_honk, authority, nft_mint (signer, writable), nft_ata, part, token_program, system_program, associated_token_program.

`release_lp()`

- Before `unlock_at`, fails with `TooEarly` (6002) and moves nothing. The validator suite's clock stays at initialize time, so that run only sees `TooEarly`.
- At `unlock_at` or later, the locker balance moves to the recipient and the locker ends at 0. LiteSVM sets the `Clock` sysvar (`svm.set_sysvar`); it does not wait 365 days.

## What a passing run shows

LiteSVM (`cargo test -p freightchain_honk`) and the validator suite (`bash .claude/skills/honk-localnet/run.sh`):

- genesis supply and the vault are 2,000,000 HONK. The HONK mint authority is the authority PDA. Freeze authority is none. The LP mint authority is none
- initialize accepts the 10 SOL opening deposit. LiteSVM also refuses any other lamport count
- a swap pays the constant-product amount, from the pool, not from a treasury transfer. The validator passes that out as `min_out`. LiteSVM also rejects a higher `min_out` with `Slippage` and accepts `min_out == 0`
- selling the HONK back pays the other side of the product, refills the vault, and leaves the pool's rent. A high `min_sol_out` is `Slippage`
- after the lock, burning the LP returns both reserves. The vault and the SOL reserve end at 0 and the pool account keeps only its rent. Before `release_lp` the holder has no LP to burn
- a burn lowers the user's balance and the supply, and the vault does not move
- `buy_part` looks the pair up and burns 65 or 260 HONK, and the new token is frozen, supply 1, decimals 0. LiteSVM also rejects a default or an unknown pair with `NotForSale`
- `release_lp` is too early on the initialize clock. LiteSVM warps the clock to `unlock_at`: the locker balance moves to the recipient and the locker ends at 0. The validator suite does not warp
- the ride session still burns 1 HONK in chat and 25 HONK for snow and clear on the ledger, and those same amounts are burned through this program by the wallets that swapped

No devnet deploy. No AMM outside this program. No change to the prize-pool program.
