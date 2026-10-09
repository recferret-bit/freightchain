# freightchain-pools (Anchor 1.2.1 program `freightchain_pools`)

Escrowed prize pools on Solana: an assurance contract for skill prizes. Program id (devnet): `9e7phdJzKMNJX8ZnqR8SdxNzafNJjYXeZNsjQze3BSvx` – its keypair is `deploy/secrets/devnet/program-id.json` of the main checkout (gitignored; copied to `target/deploy/freightchain_pools-keypair.json` for `anchor keys sync`). It appears in `declare_id!`, `Anchor.toml` and the IDL `address`; a new id = `anchor keys sync` + rebuild + a new pin (`docs/program-deploy.md`).

Core instructions only; the phase-2 session / deposit instructions (plan 2.6 / 2.10) are not built.

## Build and test

```sh
export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$HOME/.avm/bin:$PATH"
anchor build --arch v0     # root: npm run program:build
cargo test                 # root: npm run program:test   (51 tests: 49 LiteSVM + 2 unit, no network)
npm run program:idl        # copies target/idl/freightchain_pools.json -> idl/
```

### Verifiable build (what gets deployed)

`npm run program:verify` (= `bash .claude/skills/program-check/check.sh`, the `program-check` skill) runs `solana-verify build --library-name freightchain_pools` (solana-verify 0.5.2, Docker) in the Solana Foundation image for the version in `[workspace.metadata.cli] solana` (`Cargo.toml`, 4.1.2 – without it solana-verify would pick the 3.1.1 image from `Cargo.lock`), from a clean SBF target, and compares its solana-verify executable hash (sha256 of the `.so` without trailing zero padding – not `sha256sum`) with `verifiable-build.hash` (committed). Then the IDL drift check, `cargo test` on that exact `.so`, `cargo clippy --lib -D warnings` and `cargo audit`. `check.sh fast` skips Docker; `PROGRAM_ID=<id> check.sh onchain` compares the deployed program (read-only).

- **Deploy only that `.so`.** `anchor build --arch v0` on the host gives different bytes (a89fa844… vs 055e337c… for the same source on 2026-10-08, before the initialize fix) and would never verify.
- A changed program, `Cargo.lock`, pinned Solana version or program id (`anchor keys sync`) changes the hash: rerun with `UPDATE_PIN=1` and commit the new pin with the change.
- Deploying and operating it (keys, `initialize` by the upgrade authority naming the admin, upgrades, pause, authority rotation): `docs/program-deploy.md`.
- Public verification (`solana-verify verify-from-repo … --mount-path programs/freightchain-pools --library-name freightchain_pools --commit-hash <sha>`) writes a PDA on chain signed by the upgrade authority and needs the repo public – the owner's step, after the deploy.

**`--arch v0` is required.** `anchor build` 1.2.1 defaults to SBPF **v3**, which LiteSVM 0.10 (the newest version that compiles on Rust 1.89) refuses to load (`InvalidAccountData` from `add_program`; the plan's `anchor init` probe fails the same way). The tests assert the ELF flags and say so. v0 is accepted by every cluster; if the final deploy should be v3, build that artifact separately for the deploy only.
`Anchor.toml`: `cluster = "localnet"`, `wallet = "../../deploy/secrets/program-deploy.json"` (gitignored, not needed for build or test). Nothing here talks to a cluster.

## Accounts

| account | PDA seeds | data bytes (+8 discriminator) | notes |
|---|---|---|---|
| `Config` | `["config"]` | 105 (+8 = 113) | `authority` 32, `platform_treasury` 32, `platform_fee_bps` u16, `pool_count` u32, `paused` bool, `bump` u8, `pending_authority` Option<Pubkey> 33 (1 tag byte + 32) |
| `Pool` | `["pool", pool_id u32 LE]` | 184 (+8 = 192) | `pool_id` u32, `authority` 32 (creator record, receives the vault rent minimum at close; admin rights come from `Config.authority`), `tier` u8, `price_lamports` u64, `min_tickets` u32, `max_tickets` u32 (0 = unlimited), `max_per_wallet` u16, `prep_deadline` i64, `play_deadline` i64, `prize_bps` / `seed_bps` / `fee_bps` u16, `fee_treasury` 32, `seed_treasury` 32, `status` u8, `tickets_sold` u32, `buyers` u32, `sponsored` u64, `prizes_paid` u64, `refunded` u64, `created_at` i64, `bump` u8, `vault_bump` u8 |
| `Ticket` | `["ticket", pool pubkey, buyer pubkey]` | 79 (+8 = 87) | `buyer` 32, `rent_payer` 32, `pool_id` u32, `qty` u16, `lamports` u64, `bump` u8. There is no `refunded` flag: a refunded ticket is a **closed** account |
| `vault` | `["vault", pool_id u32 LE]` | 0 | system-owned zero-data PDA; only the program can sign for it |

Status values: Open 0, Active 1, Refunding 2, Settled 3, Cancelled 4 (terminal state of a refunded pool after `close_pool`).
Pool fields other than `status` and the counters are immutable. `tickets_sold` counts tickets (qty), `buyers` counts distinct Ticket accounts created. The vault key is never stored; derive it.

## Instructions

Signers: Anchor accounts marked (S). `system_program` is omitted below. Error numbers are in the table further down.

| instruction (args) | accounts | rules | errors |
|---|---|---|---|
| `initialize(authority, platform_treasury, platform_fee_bps)` | upgrade_authority (S, mut), program, program_data, config (init), platform_treasury_account | once; the signer must be the program's **upgrade authority** (`program_data.upgrade_authority_address`; an immutable program cannot be initialized); `authority` (the admin, e.g. Phantom) not the default key; `platform_fee_bps <= 10000`; treasury must hold >= rent_min | Unauthorized, InvalidParams, AccountMismatch, TreasuryNotRentExempt |
| `propose_authority(new_authority)` | authority (S), config (mut) | current `config.authority`; sets `pending_authority` (proposing again replaces it); emits `AuthorityProposed` | Unauthorized, InvalidParams (default key) |
| `accept_authority()` | new_authority (S), config (mut) | signer must equal `pending_authority`; becomes `authority`, pending cleared; emits `AuthorityChanged` | NoPendingAuthority, Unauthorized |
| `set_config(paused?, platform_treasury?, platform_fee_bps?)` | authority (S), config, new_platform_treasury | authority only; a changed treasury must be rent-exempt (pass any account otherwise) | Unauthorized, InvalidParams, AccountMismatch, TreasuryNotRentExempt |
| `create_pool(params)` | authority (S, mut), config (mut), pool (init), vault (mut), fee_treasury, seed_treasury, platform_treasury | not paused; `price >= rent_min`, `min_tickets >= 1`, `max_tickets == 0 or >= min`, `max_per_wallet >= 1`, `prep_deadline > now`, `play_deadline >= prep_deadline`, `play_deadline <= now + MAX_POOL_SECS` (365 days; a far-future deadline would lock an Active pool's tickets), bps sum 10000; all three treasuries hold >= rent_min; the authority funds the vault with exactly rent_min; id = `config.pool_count` (then incremented) | Paused, Unauthorized, InvalidParams, PriceBelowRentMin, BpsSum, TreasuryNotRentExempt |
| `buy_ticket(pool_id, qty, order_id[16])` | buyer (S, mut), fee_payer (S, mut), config, pool (mut), vault (mut), ticket (init_if_needed) | not paused; status Open/Active; `now < play_deadline`; **an Open pool is closed from `prep_deadline` on**; `tickets_sold + qty <= max_tickets`; `ticket.qty + qty <= max_per_wallet`; buyer pays `price*qty`; fee_payer pays the Ticket rent (`rent_payer`, set on first buy only); Open and `tickets_sold >= min` becomes Active | Paused, InvalidParams (qty 0), PoolNotOpen, TooLate, SoldOut, WalletCap |
| `sponsor(pool_id, lamports)` | sponsor (S, mut), config, pool (mut), vault (mut) | not paused; Open/Active; `now < play_deadline`; **an Open pool rejects it from `prep_deadline` on** (same rule as `buy_ticket`); `lamports > 0`; `pool.sponsored += lamports` | Paused, InvalidParams, PoolNotOpen, TooLate |
| `fail_pool(pool_id)` | caller (S), pool (mut) | permissionless; `Open && now >= prep_deadline && tickets_sold < min` -> Refunding | NotFailable |
| `cancel_pool(pool_id)` | authority (S), config, pool (mut) | `config.authority`; Open only -> Refunding | Unauthorized, PoolNotOpen |
| `expire_pool(pool_id)` | caller (S), pool (mut) | **permissionless**; Active, `now >= play_deadline + SETTLE_GRACE_SECS`, `prizes_paid == 0` -> Refunding (every ticket refunded in full through `refund`); emits `PoolExpired` | PoolNotActive, TooEarly, PrizesAlreadyPaid |
| `refund(pool_id)` | caller (S), pool (mut), vault (mut), ticket (mut), buyer (mut), rent_payer (mut) | permissionless; Refunding; price `ticket.lamports` -> `buyer`, Ticket rent -> `ticket.rent_payer`, Ticket closed | NotRefunding, AlreadyRefunded, AccountMismatch, BelowRentMin |
| `close_ticket(pool_id)` | caller (S), pool, ticket (mut), rent_payer (mut) | permissionless; pool Settled; Ticket rent -> `rent_payer` | NotSettled, AccountMismatch |
| `pay_prize(pool_id, lamports, rank)` | authority (S), config, pool (mut), vault (mut), to (mut) | `config.authority`; Active; `now >= play_deadline`; `lamports > 0`; `prizes_paid + lamports <= prize_share`; `to.lamports + lamports >= rent_min`; vault keeps >= rent_min or 0 | Unauthorized, PoolNotActive, TooEarly, InvalidParams, PrizeExceedsShare, BelowRentMin, AccountMismatch (to == vault) |
| `close_pool(pool_id)` | caller (S), pool_authority (mut, = `pool.authority`, not a signer), config, pool (mut), vault (mut), seed_treasury (mut), fee_treasury (mut), platform_treasury (mut) | Active: `now >= play_deadline`; `config.authority` any time after that; **anyone else** only after `play_deadline + SETTLE_GRACE_SECS` **and only if `prizes_paid > 0`** (else `MustExpire`). Refunding: **anyone**, once every ticket is refunded. Money only goes to the declared treasuries; the vault rent minimum to `pool_authority`; the vault ends at exactly 0 | Unauthorized, MustExpire, PoolNotActive, TooEarly, RefundsPending, AccountMismatch, BelowRentMin |

### Settle grace (no admin needed in the end)

`SETTLE_GRACE_SECS = 14 * 86_400` (constants.rs). An Active pool whose admin key is lost is never locked: after `play_deadline + 14 days`
- **no prize paid** (`prizes_paid == 0`): the only permissionless path is `expire_pool` -> Refunding -> anyone cranks `refund`, every ticket comes back in full, then anyone `close_pool`s the refunded pool (Cancelled). A permissionless `close_pool` is refused with `MustExpire`: it would sweep the whole prize share to the seed treasury as "unclaimed", and the operator controls that treasury, so an absent operator could still take the players' money;
- **some prizes paid**: anyone can `close_pool` it; the rest of the split goes to the treasuries the pool declared at creation (unclaimed prize to the seed treasury), never to the caller. Such a pool cannot be expired (the refund maths assumes nothing left the vault).
`config.authority` may `close_pool` any time after `play_deadline`, with or without prizes paid (the normal settlement). Before the grace ends nobody else can close an Active pool (`Unauthorized`).

### Authority handover

Two steps: `propose_authority(new)` by the current `config.authority`, then `accept_authority()` signed by the proposed key. The admin-gated instructions (`create_pool`, `set_config`, `cancel_pool`, `pay_prize`, the pre-grace `close_pool`, `propose_authority`) all check `config.authority`, so a rotation takes over existing pools at once. `pool.authority` is only the creator record: it still receives that pool's vault rent minimum at close, whoever closes it.

Pausing (`config.paused`) blocks `create_pool`, `buy_ticket` and `sponsor`. It never blocks refunds, prizes, closing or cranks.

Anchor account names are the IDL names (`buyer`, `fee_payer`, `rent_payer`, `seed_treasury`, ...). Instruction discriminators and event discriminators are in the IDL (`idl/freightchain_pools.json`).

### Errors (code = 6000 + index)

Paused 6000 · Unauthorized 6001 · InvalidParams 6002 · BpsSum 6003 · PriceBelowRentMin 6004 · TreasuryNotRentExempt 6005 · PoolNotOpen 6006 · SoldOut 6007 · WalletCap 6008 · TooLate 6009 · TooEarly 6010 · NotFailable 6011 · NotRefunding 6012 · AlreadyRefunded 6013 · PoolNotActive 6014 · NotSettled 6015 · PrizeExceedsShare 6016 · BelowRentMin 6017 · RefundsPending 6018 · AccountMismatch 6019 · MathOverflow 6020 · PrizesAlreadyPaid 6021 · NoPendingAuthority 6022 · MustExpire 6023.
Anchor constraint failures keep Anchor's own codes (for example 2006 seeds mismatch, 3012 account not initialized).

## Events

Emitted with `emit!` (`Program data: <base64>`: 8-byte IDL discriminator + borsh). Field order is the borsh order.

| event | fields |
|---|---|
| `PoolCreated` | pool_id u32, pool, vault, authority, tier u8, price_lamports u64, min_tickets u32, max_tickets u32, max_per_wallet u16, prep_deadline i64, play_deadline i64, prize_bps u16, seed_bps u16, fee_bps u16, fee_treasury, seed_treasury |
| `TicketBought` | pool_id u32, buyer, qty u16, lamports u64, order_id [u8;16], tickets_sold u32 (pool total after), activated bool |
| `PoolActivated` | pool_id u32, tickets_sold u32, at i64 (emitted in the same tx, after `TicketBought`) |
| `Sponsored` | pool_id u32, sponsor, lamports u64, sponsored_total u64 |
| `PoolFailed` | pool_id u32, tickets_sold u32 |
| `PoolCancelled` | pool_id u32, tickets_sold u32 |
| `PoolExpired` | pool_id u32, tickets_sold u32 (admin never settled; refunds follow) |
| `AuthorityProposed` | authority, pending_authority |
| `AuthorityChanged` | old_authority, new_authority |
| `Refunded` | pool_id u32, buyer, rent_payer, qty u16, lamports u64, refunded_total u64 |
| `PrizePaid` | pool_id u32, to, lamports u64, rank u8, prizes_paid_total u64 |
| `PoolClosed` | pool_id u32, prize_paid u64, seed u64, fee u64, platform_fee u64, unclaimed u64, rent_returned u64, cancelled bool |

`TicketBought.lamports` is the cost of this order (`price * qty`), `qty` this order's tickets (not the wallet's total). The tests decode `TicketBought`, `PoolActivated` and `Refunded` from raw logs with the IDL discriminators and check all twelve event discriminators against the IDL (`tests/admin_rent_cu.rs`); that file is the server team's reference.

## The money maths (bps)

All in u128 with checked casts back to u64. `pot = price_lamports * tickets_sold + sponsored` (the price is immutable, so ticket money is derived, not stored).

```
prize_share = floor(pot * prize_bps / 10000)
seed_share  = floor(pot * seed_bps  / 10000)
fee_share   = pot - prize_share - seed_share            (the floor remainders land here)
platform    = floor(fee_share * config.platform_fee_bps / 10000)   (read at close_pool time)
fee_out     = fee_share - platform                      -> fee_treasury
```

Decisions:
- **Sponsorship is split like entries**: it is part of `pot`, so prize / seed / fee shares all grow with it. `pay_prize` is bounded by `prize_share` above (`prizes_paid + lamports <= prize_share`), which includes the prize part of sponsorship. The bound grows when more is sponsored; it never exceeds what the pool took in.
- `platform_fee_bps` is a share **of the fee share** (not of the pool), taken at close with the value in `Config` at that moment, paid to `config.platform_treasury`. 0 for the hackathon.
- **Unclaimed prize** (`prize_share - prizes_paid`) goes to the seed treasury at close.
- `close_pool` pays: `fee_out` -> fee_treasury, `platform` -> platform_treasury, everything else except the rent minimum -> seed_treasury (seed share + unclaimed prize + any lamports someone sent straight to the vault), and the **rent minimum back to the pool's creator** (`pool.authority`, it funded the vault at `create_pool`). So `seed + unclaimed + fee_out + platform + rent_returned == vault balance`, the vault ends at 0, status Settled. The tests assert this for random prices, quantities, sponsorships, bps splits and platform cuts.
- Refunded pools: `close_pool` is allowed once `refunded == price * tickets_sold` (all refunded). Everything left in the vault (sponsorship of the failed pool + stray lamports) goes to the seed treasury, the rent minimum to the authority, status **Cancelled** (4), `PoolClosed.cancelled = true`. (Plan said sponsorship of a failed pool "stays for the authority's sweep"; this does the same without a separate `sweep` instruction and also ends the vault at 0.)

## Rent rules (plan 2.9)

- The vault is a system account with 0 data: `rent_min` = **890 880 lamports** (`Rent::minimum_balance(0)`). `create_pool` moves exactly that from the authority into the vault. From then on **`vault lamports = rent_min + everything held for the pool`**.
- **What `vaultLamports` means for the server**: the money in escrow is `vault_lamports - rent_min` (equal to `tickets_lamports + sponsored - refunded - prizes_paid` plus any stray donations). Never show raw vault lamports as the pot.
- Every outbound transfer from the vault (refund, prize) must leave `>= rent_min` or exactly 0, checked before the CPI (`BelowRentMin`, a readable error instead of a runtime failure). Only `close_pool` zeroes the vault (multi-leg sweep, final balance asserted to be 0).
- `create_pool` requires `fee_treasury`, `seed_treasury` and `platform_treasury` to hold >= rent_min already (`TreasuryNotRentExempt`). `initialize` / `set_config` check the platform treasury the same way.
- `pay_prize` requires the receiver to end >= rent_min (`to.lamports + lamports >= rent_min`).
- **`price_lamports >= rent_min` is required at `create_pool`** (not in the plan): a refund must be able to land in an emptied wallet, and a price below the minimum would make that refund fail and block the whole batch. At today's rent that is a floor of about 0.00089 SOL.
- `Ticket` rent (1 496 400 lamports, ~0.0015 SOL) is paid by `fee_payer` of the buy and recorded as `rent_payer` (set on the first buy only; later buys by the same buyer keep it). It goes back to `rent_payer` on `refund` and `close_ticket`. The buyer's net cost is the price.
- The `Pool` account rent (paid by the authority) is not reclaimed (no `close` of the Pool account; the server and explorer keep reading it after settlement).

## Refund and idempotency (decision)

`refund` closes the Ticket (rent to `rent_payer`): "account closed" is the refunded state (there is no flag). The account is taken as unchecked on purpose: a closed ticket (not program-owned or empty) answers **`AlreadyRefunded`** instead of an Anchor deserialization error. Consequence for the crank: transactions are atomic, so a batch with one already-refunded ticket (another cranker got there first, or the batch landed earlier) fails as a whole with `AlreadyRefunded` and moves nothing. The crank rebuilds the batch from the tickets still present and re-sends. Eight refunds fit one transaction (tested; ~12k CU each, so 8 per tx needs a compute limit of about 100k).

`refund` verifies `buyer` (through the Ticket PDA derived from it) and `rent_payer` (against the Ticket field), so a third-party cranker cannot redirect money.

## Compute units (LiteSVM, release `.so`, SBPF v0)

**The Ticket PDA's bump search** (`buy_ticket`'s `init_if_needed`, `refund`'s `seeds … bump`) costs ~1 600 CU per bump tried, and how many tries a wallet needs is fixed per wallet and pool (k extra tries: probability 2^-k). A buyer with ≥ 10 extra tries measured **36 166 CU to buy, 30 324 to refund** (`an_unlucky_buyers_ticket_bump_search_fits_the_server_limits`) – above the server's old limits (30 000 / 18 000), so such a wallet could never buy / be refunded by a server-built transaction (found on devnet). The server now sets 60 000 / 45 000 (`CU_LIMITS`).

Measured by `compute_units_are_in_budget` (`cargo test -- --nocapture` prints them). The numbers move by ~1-2k between runs because the test keys are random and the PDA bump search costs differ; one run after the review fixes:

| instruction | CU | plan |
|---|---|---|
| `buy_ticket`, first buy (Ticket init), buyer pays own fee | 19 086 | ~35k |
| `buy_ticket`, repeat buy | 16 684 | |
| `buy_ticket`, first buy, separate sponsor as fee payer | 19 279 | |
| `refund` | 13 438 | ~12k |
| `pay_prize` | 12 824 | ~10k |
| `close_pool` | 16 745 | |

Set `setComputeUnitLimit` from the simulation (`unitsConsumed * 1.2`) as planned; the test asserts only loose ceilings (buy < 40k, refund < 30k, pay_prize < 25k).

## Tests (`programs/freightchain_pools/tests/`, 49 LiteSVM incl. the fixture exporter + 2 unit)

`create_and_buy.rs` create_pool validation / authority / unfunded treasury, buy to exactly min activates (events decoded), sponsored buy credits the buyer and records the rent payer, wallet cap, sold out, deadlines.
`refunds.rs` fail_pool conditions, refund exact price + rent to a separate rent payer, wrong receivers, refund when not Refunding, refund twice, batch of 8 + re-sent batch + partial progress, close_pool after refunds, cancel_pool, sponsor.
`settle.rs` pay_prize authority-only / before play_deadline / bounded by the prize share / receiver rent, close_pool exact split for random amounts, close guards, unclaimed prize and stray lamports to the seed, close_ticket rent to rent_payer, `MathOverflow` instead of wrapping (a forged pool: price × tickets, + sponsorship, play_deadline + grace).
`grace_and_authority.rs` sponsor cut-off on Open pools, expire before / after the grace and with prizes paid, refunds after expiry, permissionless close after the grace (refused before, `MustExpire` without paid prizes, outputs sum to the vault with paid prizes, rent receiver must be the creator), unpaid pool after the grace: `MustExpire` -> expire -> refunds -> close, the authority closing an unpaid pool at and after the grace, permissionless close of a refunded pool, propose / accept authority, a rotated key taking over existing pools.
`admin_rent_cu.rs` initialize only by the upgrade authority (a stranger first: `Unauthorized`; an immutable program: `Unauthorized`; names another wallet as admin), pause, set_config, the vault-rent rule, compute units, IDL event discriminators, raw log decoding.
The clock is warped with `svm.set_sysvar::<Clock>()`; no test waits. Together they assert all 24 error codes. On a real validator the localnet e2e covers the rest (`.claude/skills/localnet-e2e`, its coverage gate: 14/14 instructions, 12/12 events, 23/24 errors – `MathOverflow` needs a forged account, so only here).

## Not built / notes

- Session keys, `Balance`, `deposit` / `withdraw`, `buy_ticket_with_session` (phase 2).
- No `refund_sponsor`, no `sweep`, no Pool account close. `Pool.authority` is copied from the signer of `create_pool` and never changes.
- Deploy, `initialize` and pool creation on devnet are not done (task scope).
- Trust in the admin is by design: after `play_deadline` it may close a pool without paying prizes (the prize share goes to the seed treasury), and `pay_prize` pays whatever `to` it signs (capped). The escape hatches protect against an absent admin, not a malicious one. `buy_ticket`'s `dup` markers are documentation only (Anchor 1.2.1 checks duplicates for `Account` types, not signers).
