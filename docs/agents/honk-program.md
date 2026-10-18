# TEN4 program (`freightchain_honk`, local)

A second Anchor program in `programs/`, crate `freightchain_honk`. It is not the prize-pool program and it is not deployed. Devnet and mainnet stay untouched. The game ledger is still the ride mint and the cab entitlement. This program is the coin: one mint, one pool, burns, and a soulbound part.

Program id: `GctCYSHbCnHN8sE1LjUL9cmSpFd5mcVdfaumRcaVWZZx` (`programs/freightchain_honk/program-keypair.json`). Do not print that file. Do not use `~/.config/solana/id.json`.

Numbers, from `server/src/domain/honk/tokenomics.ts` and `programs/freightchain_honk/src/constants.rs`. The coin is TEN4. HONK is only the in-game verb.

- decimals 6, `UNIT = 1_000_000`, name and symbol `TEN4` copied onto Config at initialize
- supply 100,000,000 TEN4. Liquidity 15,000,000, ride emission 55,000,000, airdrop 8,000,000, referral 4,000,000, treasury 10,000,000, team 8,000,000 (`team_enabled = true`, 12-month cliff, then 24 months linear). All pre-minted. Mint authority is then none. Freeze authority stays omitted
- ordinary part `65 * UNIT`, gold part `260 * UNIT`
- opening deposit exactly 50 SOL. Swap fee 25 bps. The fee stays in the pool
- era-1 finishes 100 / 500 / 1,200. Global day 75,000 in era 1, halving. Wallet day 2,000, not halved
- referral eras halve from 2,000,000 (`REFERRAL_ERA_SIZE = 2_000_000 * UNIT`); quote shifts right by `max(era_ref, era_ride)` (M1 = 100, M2 = 50 in era 1); monthly global cap 30,000 for months 0–2 after `opened_at`, then 60,000; monthly wallet cap 1,000; tail burns after era 8

Error codes, in order: `ZeroAmount` 6000, `ZeroOut` 6001, `TooEarly` 6002, `AlreadyBought` 6003, `Slippage` 6004, `NotForSale` 6005, `EmissionCap` 6006, `DailyCap` 6007, `WalletCap` 6008, `BadTier` 6009, `BadAuthority` 6010, `BadVest` 6011, `TeamDisabled` 6012, `BadDay` 6013, `BadMonth` 6014, `BadMerkleProof` 6015, `AirdropClosed` 6016.

## Instructions

Build with `anchor build --arch v0 -p freightchain_honk` from `programs/` (LiteSVM 0.10 needs SBF v0). Do not change `freightchain_pools`.

PDA seeds: `config`, `authority`, `honk-mint`, `vault`, `pool`, `lp-mint`, `lp-locker`, `locker`, `emission`, `airdrop`, `referral`, `treasury`, `team`, `wallet-day` + rider + day, `wallet-month` + referrer + month, `referral-mint` + reward_id, `airdrop` + campaign, `airdrop` + campaign + wallet, `wallet-airdrop` + wallet, `part` + buyer + slot + item, and `ride-mint` + ride id. The seeds keep the word honk. The token name on Config is TEN4.

`initialize(sol_in, emitter, treasury, team_recipient, team_enabled, team_linear_months)`

- Pre-mints liquidity, emission, airdrop, referral, treasury, and team into their vaults. Then sets the TEN4 mint authority to none. Freeze authority stays omitted. There is no Metaplex CPI.
- Mints LP `isqrt(liquidity * sol_in)` into the locker, burns it, and sets the LP mint authority to none. No `release_lp`. No `withdraw_lp`.
- Accepts only `sol_in == 50_000_000_000`. Anything else fails with `ZeroAmount`. `payer` must be the program's upgrade authority (`program_data.upgrade_authority_address`; an immutable program or non-upgrade-authority signer fails with `BadAuthority`). Requires `team_enabled == true` (else `TeamDisabled`), `team_recipient != Pubkey::default()` (else `BadAuthority`), and `team_linear_months == 24` (else `BadVest`).
- Accounts, in order: payer, program, program_data, config, honk_mint, authority, vault, pool, lp_mint, lp_locker, locker, emission_vault, airdrop_vault, referral_vault, treasury_vault, team_vault, token_program, system_program.

`swap_sol_for_honk(sol_in: u64, min_out: u64)`

- Fee 25 bps. `net = sol_in * 9975 / 10000`. `out = honk_reserve * net / (sol_reserve + net)`. The reserve adds the full input, so the fee stays in the pool. `sol_in == 0` fails with `ZeroAmount`. `out == 0` fails with `ZeroOut`.
- `out < min_out` fails with `Slippage` (6004) and moves nothing. `min_out == 0` is allowed and means any positive out. `out == min_out` lands.
- Moves SOL onto the pool and TEN4 out of the vault to the user's ATA.
- Accounts: user (signer, writable), pool, honk_mint, vault, user_honk (init if needed), token_program, system_program, associated_token_program.

`swap_honk_for_sol(honk_in: u64, min_sol_out: u64)`

- The other side, same fee: `net = honk_in * 9975 / 10000`, `sol_out = sol_reserve * net / (honk_reserve + net)`. `honk_in == 0` is `ZeroAmount`. `sol_out == 0` is `ZeroOut`. `sol_out < min_sol_out` is `Slippage` and moves nothing.
- TEN4 moves into the vault. SOL moves off the pool account by debiting its lamports. The pool account is not a system account, so this is not a system transfer. Rent stays on the pool.
- Accounts: user (signer, writable), pool, honk_mint, vault, user_honk, token_program.

`burn(amount: u64)`

- The user burns `amount` of their own TEN4. `amount == 0` fails. Supply falls. The pool reserves do not move.
- Accounts: user (signer, writable), honk_mint, user_honk, token_program.

`mint_ride(ride_id: [u8; 16], tier: u8, bands: u8, day_index: i64)`

- Only `config.emitter` may call it. Tier is 1, 4, or 8. Bands are bit 0 = 20%, bit 1 = 50%, bit 2 = 100%. The amount is the era schedule, clipped to the emission cap, the era left, the global day, and the wallet day. It is transferred from the emission vault. Supply does not rise. The same ride id cannot pay twice. `day_index` must be the clock's unix day.
- Accounts: emitter, config, honk_mint, authority, emission_vault, rider, rider_honk, ride_mint, wallet_day, token_program, system_program, associated_token_program.

`pay_referral(reward_id: [u8; 16], base_amount: u64, month_index: i64)`

- Only `config.emitter` may call it. `base_amount` must be `100 * UNIT` (milestone 1) or `50 * UNIT` (milestone 2) or it fails with `BadTier`. The era quote shifts `base_amount` right by `max(era_ref, era_ride)` (`quote == 0` fails with `ZeroOut`). `month_index` must equal `(clock.unix_timestamp - config.opened_at) / (30 * 86_400)` or it fails with `BadMonth`. Clipped to referral vault cap (`EmissionCap`), referral era remaining, monthly global cap (30,000 for months 0–2, then 60,000; `DailyCap`), and monthly wallet cap (1,000; `WalletCap`). One `ReferralMint` PDA `[b"referral-mint", reward_id]` per `reward_id`.
- Accounts: emitter, config, honk_mint, authority, referral_vault, referrer, referrer_honk, referral_mint, wallet_month, token_program, system_program, associated_token_program.

`burn_referral_tail()`

- Permissionless (`payer` signer) once `referral_era_index(config.referral_emitted) >= 8` (else `TooEarly`) and `referral_vault.amount > 0` (else `ZeroAmount`). Burns any remaining tokens in `referral_vault` and sets `config.referral_emitted = REFERRAL`.
- Accounts: payer, config, honk_mint, authority, referral_vault, token_program.

`set_airdrop_root(campaign: u8, merkle_root: [u8; 32], allocation: u64)`

- Only `config.emitter` may call it. Requires `allocation > 0 && merkle_root != [0u8; 32]` (`ZeroAmount`) and `config.airdrop_allocated + allocation <= AIRDROP` (`EmissionCap`). Creates `campaign_account` PDA `[b"airdrop", &[campaign]]` with `opened_at = clock.unix_timestamp` and `expires_at = opened_at + 90 days`.
- Accounts: emitter, config, campaign_account, system_program.

`claim_airdrop(campaign: u8, amount: u64, proof: Vec<[u8; 32]>)`

- Signed by `recipient`. Verifies `sha256(b"fc:airdrop:v1" || [campaign] || wallet || amount_le)` against `campaign_account.merkle_root` before `expires_at` (`AirdropClosed` if expired or burned, `BadMerkleProof` on mismatch), enforces campaign allocation (`EmissionCap`) and per-wallet lifetime airdrop cap (`2,000 * UNIT`, `WalletCap`), records `receipt` PDA `[b"airdrop", &[campaign], wallet]` and `wallet_airdrop` PDA `[b"wallet-airdrop", wallet]`, and transfers `amount` from `airdrop_vault`.
- Accounts: recipient, config, campaign_account, honk_mint, authority, airdrop_vault, recipient_honk, receipt, wallet_airdrop, token_program, system_program, associated_token_program.

`burn_unclaimed(campaign: u8)`

- Permissionless (`payer` signer) once `clock.unix_timestamp >= campaign_account.expires_at` (`TooEarly` before expiry, `AirdropClosed` if already burned). Burns `campaign_account.allocation - campaign_account.claimed` (`ZeroAmount` if 0) from `airdrop_vault` and marks `burned = true`.
- Accounts: payer, config, campaign_account, honk_mint, authority, airdrop_vault, token_program.

`claim_treasury` / `claim_team` pay the vested delta to the recipient stored at initialize. Nothing vested is `TooEarly`. Team off is `TeamDisabled`. There is no cancel and no change of recipient.

`buy_part(slot: [u8; 16], item: [u8; 16])`

- The program looks the pair up. The buyer does not pass a gold flag or a price.
- Unknown pairs and the free defaults fail with `NotForSale` (6005) and burn nothing. Defaults: `wheel/classic`, `truck_color/red`, `gearbox/stick`, `dice/white`, `needle/orange`, `ornament/spear`, `dash/stock`, `indicator/amber`, `phone/black`.
- Gold pairs burn `260 * UNIT`: `wheel/gold`, `gearbox/gold`, `dice/gold`, `needle/gold`, `ornament/gold`, `dash/gold`, `indicator/gold`, `phone/gold`. `truck_color` has no gold.
- Every other known pair burns `65 * UNIT`. Truck paint for sale is `blue`, `green`, `black`, `yellow`, `white`. The other ordinary ids are the rest of `docs/agents/honk-cab-slots.md` and the five older slots in `server/src/domain/honk/parts-catalog.ts`.
- Mints a new classic SPL token, decimals 0, supply 1, to the buyer. Freeze authority is `authority`. The mint authority is cleared. The buyer's token account is frozen. There is no thaw instruction, so a transfer fails.
- A second buy of the same buyer, slot, and item fails (`AlreadyBought`, 6003). `part.gold` is set from the catalog.
- Accounts: buyer (signer, writable), honk_mint, buyer_honk, authority, nft_mint (signer, writable), nft_ata, part, token_program, system_program, associated_token_program.

## What a passing run shows

LiteSVM (`cargo test -p freightchain_honk`) and the validator suite (`bash .claude/skills/honk-localnet/run.sh`):

- supply is 100,000,000 TEN4 across the six vaults (15M pool, 55M emission, 8M airdrop, 4M referral, 10M treasury, 8M team). Mint authority and freeze authority are none. LP supply is 0
- initialize accepts the 50 SOL opening deposit and refuses any other lamport count, and requires `team_enabled = true` with `team_linear_months = 24`
- a swap pays the constant product on the net input (25 bps). The fee stays in the pool
- a burn lowers the user's balance and the supply. The pool vault does not move
- `buy_part` burns 65 or 260 TEN4. The new token is frozen, supply 1, decimals 0
- `mint_ride` pays the schedule from the emission vault. Supply does not rise. A wallet stops at 2,000 a day
- `pay_referral` pays M1 (100) and M2 (50) under the soft-start (30k/mo) and regular (60k/mo) monthly caps and 1,000/mo wallet cap; `burn_referral_tail` burns remaining dust after era 8
- `set_airdrop_root`, `claim_airdrop`, and `burn_unclaimed` verify merkle proofs, enforce the 2,000 TEN4 wallet cap and 90-day window, and burn unclaimed tokens after expiry
- treasury pays nothing at open and half after 18 months. The team pays nothing before the 12-month cliff and vests linearly over 24 months
- the ride session still posts the chat word HONK for a 1 TEN4 burn, and burns 25 TEN4 for snow and clear

No devnet deploy. No AMM outside this program. No change to the prize-pool program.
