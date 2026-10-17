# freightchain-pools (Anchor 1.2.1 program `freightchain_pools`)

This workspace also contains `freightchain_honk` (local only, not the devnet prize program), tested with `cargo test -p freightchain_honk`.

Escrowed prize pools on Solana: an assurance contract for skill prizes. Program id (devnet): `8No42h2QXb9opgp3pJfNXL2o77o288SsF8o7CwJGCA1p`, the value in `declare_id!`, `Anchor.toml`, and the IDL `address`. Its keypair is `deploy/secrets/devnet/program-id.json` of the main checkout (gitignored; copied to `target/deploy/freightchain_pools-keypair.json` for `anchor keys sync`). A new id means `anchor keys sync`, a rebuild, and a new pin (`docs/program-deploy.md`). The v1 id `9e7phdJzKMNJX8ZnqR8SdxNzafNJjYXeZNsjQze3BSvx` is still on devnet. Its pools are finished, and the site does not sell into it.

**This source is v5** (v4's audit fixes, with the referral leg removed and admin pool rules snapshotted per pool – section "v5" below): built, **not deployed**. It is a fresh program id, not an in-place upgrade of `8No42h…`. Devnet still runs v3. Do not deploy without the owner.

Core instructions only; the phase-2 session / deposit instructions (plan 2.6 / 2.10) are not built.

**v2 (Oct 10): the pool day.** Every pool has a SALE window (ends at `prep_deadline`, for an Open AND an Active pool – under the minimum the pool can only fail and refund), a PLAY window (`play_deadline`: rides count until then) and a REVIEW window (`payout_at`: no prize is paid and the pool is not closed before it – not even by the admin). A per-tier **series** written by the admin (`set_series`) lets anyone (the server's crank) open the next pool on a fixed grid (`open_next_pool`); the 1 h tier opens one a day: 24 h on sale, rides count 2 h more, 48 h of review. A **payout key** named by the admin (`set_payout_authority`) may only `pay_prize` and `close_pool` after `payout_at` (v4 changed its role: "The payout key" below) – the server's payout job holds it; the admin key stays off the server. Config and Pool grew (Config 146, Pool 200 bytes), so v1 accounts do not decode with v2: deploy v2 under a **fresh program id** (all devnet v1 pools are terminal) – `docs/program-deploy.md`.

## Build and test

```sh
export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$HOME/.avm/bin:$PATH"
anchor build --arch v0     # root: npm run program:build
cargo test                 # root: npm run program:test   (LiteSVM incl. the fixture exporter + unit, no network; the owner runs this – not counted here)
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
| `Config` | `["config"]` | 167 (+8 = 175; v4 was 154 + 8) | `authority` 32, `platform_treasury` 32, `platform_fee_bps` u16, `pool_count` u32, `paused` bool, `bump` u8, `pending_authority` Option<Pubkey> 33, `payout_authority` Option<Pubkey> 33, v4 floors `min_review_secs` / `min_finish_secs` i64, v5: `paid_tickets_enabled` bool, `prize_bps` / `seed_bps` / `fee_bps` u16, `max_player_share_bps` u16, `max_tickets` u32 (0 = no extra cap) |
| `Series` | `["series", tier u8]` | 132 (+8 = 140; v4 was 134) | one per tier: `tier` u8, `enabled` bool, `price_lamports` u64, `min_tickets` u32, `max_tickets` u32, `max_per_wallet` u16, `sale_secs` i64, `play_secs` i64, `verify_secs` i64, `prize_bps` / `seed_bps` / `fee_bps` u16 (copied from Config at `set_series`, for inspection), `fee_treasury` 32, `seed_treasury` 32, `next_open_at` i64, `pools_opened` u32, `last_pool_id` Option<u32> 5, `bump` u8. No referral leg. `open_next_pool` snapshots live Config, not these bps. |
| `Pool` | `["pool", pool_id u32 LE]` | 362 (+8 = 370; v4 was 361) | the v4 pool, with `referral_bps` removed and `paid_tickets_enabled` bool + `max_player_share_bps` u16 appended after `min_review_secs`. `status` stays at byte 157. |
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
| `accept_authority()` | new_authority (S), config (mut) | signer must equal `pending_authority`; becomes `authority`, pending cleared; v4: the payout key is cleared too (a key the old admin named does not serve the new one; `PayoutAuthoritySet` with None); emits `AuthorityChanged` | NoPendingAuthority, Unauthorized |
| `set_config(paused?, platform_treasury?, platform_fee_bps?, min_review_secs?, min_finish_secs?)` | authority (S), config, new_platform_treasury | authority only; a changed treasury must be rent-exempt (pass any account otherwise); v4 floors `0..=MAX_POOL_SECS`, bind only NEW pools / series, refused on an unmigrated Config (`FloorsSet`) | Unauthorized, InvalidParams, AccountMismatch, TreasuryNotRentExempt, ConfigNotMigrated |
| `set_payout_authority(payout_authority?)` | authority (S), config (mut) | authority only; names (or clears with None) the payout key – not the default key; emits `PayoutAuthoritySet` | Unauthorized, InvalidParams |
| `set_pool_rules(paid_tickets_enabled, prize_bps, seed_bps, fee_bps, max_player_share_bps, max_tickets)` | authority (S), config (mut) | authority only; migrated Config; the three shares sum to 10000; `max_player_share_bps <= 4999` (0 allowed); `max_tickets` 0 = no extra cap. Writes Config only. The next `create_pool` / `open_next_pool` snapshots it. Emits `PoolRulesSet` | Unauthorized, BpsSum, PlayerShareCeiling, ConfigNotMigrated |
| `set_series(params)` | authority (S, mut), config, series (init_if_needed, `["series", tier]`), fee_treasury, seed_treasury, platform_treasury | authority only; the schedule and price rules of `create_pool` (no bps arguments – the split is Config's, checked and copied onto the series for inspection); `MIN_SALE_SECS (1 h) <= sale_secs <= MAX_SALE_SECS (30 d)`, `play_secs, verify_secs >= 0`, `sale + play + verify <= MAX_POOL_SECS`; v4: `play_secs >= min_finish_secs`, `verify_secs >= min_review_secs` (`WindowTooShort`); treasuries rent-exempt; `start_at` = the first slot (required for a new series, 0 = keep `next_open_at`, at most a year out). Pools already opened keep their own snapshot; emits `SeriesSet` | Unauthorized, InvalidParams, PriceBelowRentMin, BpsSum, TreasuryNotRentExempt, AccountMismatch, WindowTooShort, ConfigNotMigrated |
| `open_next_pool(tier)` | caller (S, mut), config (mut), series (mut), pool (init), vault (mut), fee_treasury (= series), seed_treasury (= series), platform_treasury | **permissionless**; not paused; series enabled; `now >= next_open_at`; opens the pool of the CURRENT slot on the grid `next_open_at + k * sale_secs` (a late caller never shifts the schedule – a missed slot is skipped): `prep_deadline` = slot end, `play_deadline` = + play_secs, `payout_at` = + verify_secs; schedule and treasuries from the series, the split / paid-ticket flag / player cap / ticket ceiling from live Config (snapshotted; a later `set_pool_rules` does not move this pool); the caller pays the Pool rent and the vault rent minimum (it gets the minimum back at close as `pool.authority`); `next_open_at` = this pool's sale end; v4: arms `seal_slot`, snapshots `platform_fee_bps` / `min_review_secs`; emits `PoolCreated` (`from_series`) | Paused, SeriesDisabled, TooEarly, AccountMismatch, PriceBelowRentMin, TreasuryNotRentExempt, InvalidParams, ConfigNotMigrated |
| `create_pool(params)` | authority (S, mut), config (mut), pool (init), vault (mut), fee_treasury, seed_treasury, platform_treasury | not paused; `price >= rent_min`, `min_tickets >= 1`, `max_tickets == 0 or >= min`, `max_per_wallet >= 1`, `prep_deadline > now`, `play_deadline >= prep_deadline`, `payout_at >= play_deadline`, `payout_at <= now + MAX_POOL_SECS` (365 days); v4 windows; the split is not an argument – Config's shares (must already sum to 10000) and the paid-ticket flag, player cap and ticket ceiling are snapshotted; a config max of tickets tightens `max_tickets` (0 on either side is "no cap from that side"; a nonzero tightened max below `min_tickets` is `InvalidParams`); treasuries rent-exempt; the authority funds the vault with exactly rent_min; id = `config.pool_count`; arms `seal_slot` | Paused, Unauthorized, InvalidParams, PriceBelowRentMin, BpsSum, TreasuryNotRentExempt, WindowTooShort, ConfigNotMigrated |
| `buy_ticket(pool_id, qty, order_id[16])` | buyer (S, mut), fee_payer (S, mut), config, pool (mut), vault (mut), ticket (init_if_needed) | not paused; status Open/Active; the pool's snapshotted `paid_tickets_enabled` (sponsor is not gated); **`now < prep_deadline`**; `tickets_sold + qty <= max_tickets`; `ticket.qty + qty <= max_per_wallet`; buyer pays `price*qty`; fee_payer pays the Ticket rent; Open and `tickets_sold >= min` becomes Active | Paused, PaidTicketsDisabled, InvalidParams (qty 0), PoolNotOpen, TooLate, SoldOut, WalletCap |
| `sponsor(pool_id, lamports)` | sponsor (S, mut), config, pool (mut), vault (mut), receipt (init_if_needed, v4) | not paused; Open/Active; `now < prep_deadline` (same rule as `buy_ticket`); `lamports > 0`; `pool.sponsored += lamports`; v4: the sponsor's `SponsorReceipt` grows by it (the sponsor pays its rent) | Paused, InvalidParams, PoolNotOpen, TooLate |
| `fail_pool(pool_id)` | caller (S), pool (mut) | permissionless; `Open && now >= prep_deadline && tickets_sold < min` -> Refunding | NotFailable |
| `cancel_pool(pool_id)` | authority (S), config, pool (mut) | `config.authority`; Open only -> Refunding | Unauthorized, PoolNotOpen |
| `expire_pool(pool_id)` | caller (S), pool (mut) | **permissionless**; Active, `now >= payout_at + SETTLE_GRACE_SECS`, `prizes_paid == 0` -> Refunding (every ticket refunded in full through `refund`); emits `PoolExpired` | PoolNotActive, TooEarly, PrizesAlreadyPaid |
| `refund(pool_id)` | caller (S), pool (mut), vault (mut), ticket (mut), buyer (mut), rent_payer (mut) | permissionless; Refunding; price `ticket.lamports` -> `buyer`, Ticket rent -> `ticket.rent_payer`, Ticket closed | NotRefunding, AlreadyRefunded, AccountMismatch, BelowRentMin |
| `close_ticket(pool_id)` | caller (S), pool, ticket (mut), rent_payer (mut) | permissionless; pool Settled; Ticket rent -> `rent_payer` | NotSettled, AccountMismatch |
| `pay_prize(pool_id, rank, lamports, proof)` (v4) | caller (S), config, pool (mut), vault (mut), to (mut) | **permissionless**: pays exactly a leaf of the committed winners root ("v4"); Active; a root committed; not paused before the grace; `now >= pool.pay_from`; `rank < winners_count`, its `paid_mask` bit unset; the proof leads from `(pool_id, rank, to, lamports)` to the root; `prizes_paid + lamports <= winners_total` and `<= prize_share` of the counted pot (ticket lamports above the player cap are not in it); `to.lamports + lamports >= rent_min`; sets the rank's bit | PoolNotActive, WinnersNotCommitted, Paused, TooEarly, InvalidParams, RankAlreadyPaid, InvalidProof, PrizeExceedsShare, BelowRentMin, AccountMismatch (to == vault) |
| `close_pool(pool_id)` | caller (S), pool_authority (mut, = `pool.authority`, not a signer), config, pool (mut), vault (mut), seed_treasury (mut), fee_treasury (mut), platform_treasury (mut) | Active: `now >= payout_at`; before the grace only `config.authority` or the payout key, not paused, and only once a winners root is committed, its lock (`pay_from`) is over and **every committed rank is paid** (v4); **anyone** after `payout_at + SETTLE_GRACE_SECS` **and only if `prizes_paid > 0`** (else `MustExpire`). Refunding: **anyone**, once every ticket **and (v4) every sponsor** is refunded. Money only goes to the declared treasuries; the vault rent minimum to `pool_authority`; the vault ends at exactly 0 | Unauthorized, Paused, WinnersNotCommitted, PrizesUnpaid, MustExpire, PoolNotActive, TooEarly, RefundsPending, SponsorRefundsPending, AccountMismatch, BelowRentMin |

### Settle grace (no admin needed in the end)

`SETTLE_GRACE_SECS = 14 * 86_400` (constants.rs). An Active pool whose admin and payout keys are lost is never locked: after `payout_at + 14 days`
- **no prize paid** (`prizes_paid == 0`): the only permissionless path is `expire_pool` -> Refunding -> anyone cranks `refund`, every ticket comes back in full, then anyone `close_pool`s the refunded pool (Cancelled). A permissionless `close_pool` is refused with `MustExpire`: it would sweep the whole prize share to the seed treasury as "unclaimed", and the operator controls that treasury, so an absent operator could still take the players' money;
- **some prizes paid**: anyone can `close_pool` it; the rest of the split goes to the treasuries the pool declared at creation (unclaimed prize to the seed treasury), never to the caller. Such a pool cannot be expired (the refund maths assumes nothing left the vault).
Before the grace ends only `config.authority` and the payout key can close an Active pool (`Unauthorized`), and since v4 only once its committed winners root is out of its lock and every committed rank is paid (a root of 0 winners closes at once after its lock – the prize share then goes to the seed treasury). `commit_winners` is refused when its lock would end less than a day before the grace end (`CommitTooLate`), so a committed root can always be paid in time.

### Authority handover

Two steps: `propose_authority(new)` by the current `config.authority`, then `accept_authority()` signed by the proposed key. The admin-gated instructions (`create_pool`, `set_pool_rules`, `set_series`, `set_payout_authority`, `set_config`, `cancel_pool`, `veto_winners`, `commit_winners`, `record_ride_attestation`, the pre-grace `close_pool`, `propose_authority`, `migrate_config_v4`) all check `config.authority` (`commit_winners` / `record_ride_attestation` / `close_pool` also accept the payout key), so a rotation takes over existing pools at once; v4's `accept_authority` clears the payout key (the new admin names its own). `pay_prize` is permissionless since v4. `pool.authority` is only the creator record: it still receives that pool's vault rent minimum at close, whoever closes it.

### The payout key

`set_payout_authority` names one more key. Since v4 it may sign `commit_winners` (a pool's winners root, at or after its play deadline, `total <= prize_share` of the counted pot), `record_ride_attestation` (the verdict on one pledged ride) and the pre-grace `close_pool` (once every committed rank is paid; money only to the treasuries the pool declared) – nothing else: not `pay_prize` (anyone pays a committed rank), not `veto_winners`, `create_pool`, `set_pool_rules`, `set_series`, `set_config`, `cancel_pool`, `propose_authority` or `set_payout_authority` (tested). The server's payout job holds it (`PAYOUT_SECRET`) and commits only VERIFIED rides once every ride of the pool was decided. **Blast radius of a stolen payout key (audit H5-B)**: it can no longer pay itself – whatever root it commits is public (`WinnersCommitted`) for the whole review lock (`pay_from` = max(`payout_at`, `committed_at` + max(`payout_at − play_deadline`, `pool.min_review_secs`))), and the cold admin `veto_winners` it while no rank is paid; a ride attestation it writes is public for the same lock before a pledge settles on it, and may be rewritten until then. What it can still do: commit a list the admin fails to veto in time (up to the prize share), commit 0 winners and close the pool after the lock (the unpaid prize share, plus any ticket excess, to the seed treasury), or keep a pool unsettled until the grace (then anyone expires it into refunds).

Pausing (`config.paused`) blocks `create_pool`, `open_next_pool`, `buy_ticket`, `sponsor`, `create_pledge` and the pre-grace `close_pool` of an Active pool. v4 (audit H5 d): `commit_winners`, `pay_prize`, `record_ride_attestation` and `settle_pledge` are blocked only before the pool's `payout_at + SETTLE_GRACE_SECS` (`paused_before_grace`) – after the grace no admin is needed, so no admin can freeze it. It never blocks `refund`, `refund_sponsor`, `refund_pledge`, `fail_pool`, `expire_pool`, `cancel_pool`, `veto_winners`, `seal_road`, the close of a refunded pool, the post-grace close or the account closes.

Anchor account names are the IDL names (`buyer`, `fee_payer`, `rent_payer`, `seed_treasury`, ...). Instruction discriminators and event discriminators are in the IDL (`idl/freightchain_pools.json`).

### Errors (code = 6000 + index)

Paused 6000 · Unauthorized 6001 · InvalidParams 6002 · BpsSum 6003 · PriceBelowRentMin 6004 · TreasuryNotRentExempt 6005 · PoolNotOpen 6006 · SoldOut 6007 · WalletCap 6008 · TooLate 6009 · TooEarly 6010 · NotFailable 6011 · NotRefunding 6012 · AlreadyRefunded 6013 · PoolNotActive 6014 · NotSettled 6015 · PrizeExceedsShare 6016 · BelowRentMin 6017 · RefundsPending 6018 · AccountMismatch 6019 · MathOverflow 6020 · PrizesAlreadyPaid 6021 · NoPendingAuthority 6022 · MustExpire 6023 · SeriesDisabled 6024.
v5, appended so the earlier codes stay: PaidTicketsDisabled 6048 · PlayerShareCeiling 6049 (ConfigNotMigrated stays 6047).
Anchor constraint failures keep Anchor's own codes (for example 2006 seeds mismatch, 3012 account not initialized).

## Events

Emitted with `emit!` (`Program data: <base64>`: 8-byte IDL discriminator + borsh). Field order is the borsh order.

| event | fields |
|---|---|
| `PoolCreated` | pool_id u32, pool, vault, authority, tier u8, price_lamports u64, min_tickets u32, max_tickets u32, max_per_wallet u16, prep_deadline i64, play_deadline i64, payout_at i64, prize_bps u16, seed_bps u16, fee_bps u16, fee_treasury, seed_treasury, from_series bool, then the v3/v4 seed fields, `paid_tickets_enabled` bool, `max_player_share_bps` u16 |
| `PoolRulesSet` | paid_tickets_enabled bool, prize_bps u16, seed_bps u16, fee_bps u16, max_player_share_bps u16, max_tickets u32 (Config changed; open pools keep their snapshot) |
| `SeriesSet` | tier u8, enabled bool, price_lamports u64, min_tickets u32, max_tickets u32, max_per_wallet u16, sale_secs i64, play_secs i64, verify_secs i64, prize_bps u16, seed_bps u16, fee_bps u16, fee_treasury, seed_treasury, next_open_at i64 |
| `PayoutAuthoritySet` | authority, payout_authority Option<Pubkey> |
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
| `PoolClosed` | pool_id u32, prize_paid u64, seed u64, fee u64, platform_fee u64, unclaimed u64, rent_returned u64, cancelled bool, `ticket_excess` u64 (0 when cancelled) |

`TicketBought.lamports` is the cost of this order (`price * qty`), `qty` this order's tickets (not the wallet's total). The tests decode `TicketBought`, `PoolActivated` and `Refunded` from raw logs with the IDL discriminators and check every event discriminator against the IDL (`tests/admin_rent_cu.rs`); that file is the server team's reference.

## v3 – attestations, pledges, the road seed on chain

An in-place upgrade of the v2 program id: `Config` and `Series` are unchanged, `Pool` grew (a v2 Pool account no longer deserializes – every v2 pool must be settled before the upgrade, see `docs/program-deploy.md` "v3").

| account | PDA seeds | data bytes (+8) | notes |
|---|---|---|---|
| `Pool` (grew) | `["pool", pool_id]` | 264 (+8 = 272) | + `seed_commitment` [u8;32], `seed_slot` u64, `seed_slot_hash` [u8;32] |
| `Attestation` | `["attestation", pool pubkey, driver pubkey]` | 110 (+8 = 118) | `pool`, `driver`, `telemetry_root` [u8;32], `verified_km` u32, `status` u8 (0 unverified · 1 verified · 2 flagged), `recorded_at` i64, `bump` |
| `Pledge` | `["pledge", ride_id [u8;32], sponsor pubkey]` | 174 (+8 = 182) | `ride_id` (the server's ride uuid, 16 bytes zero-padded), `sponsor`, `driver`, `pool`, `max_lamports`, `lamports_per_km`, `target_km` u32, `settled`, `earned_lamports`, `refunded_lamports`, `created_at`, `bump` |

| instruction (args) | accounts | rules | errors |
|---|---|---|---|
| `create_pool` / `open_next_pool` (changed; **v4 moved this to `seal_road`** – the opener could grind the newest slot) | + `slot_hashes` (the SlotHashes sysvar, fixed address) | the program commits the road seed itself: `seed_commitment = SHA-256(pool_id LE u32 ‖ hash ‖ slot LE u64)` over the NEWEST SlotHashes entry, and keeps `seed_slot` / `seed_slot_hash`; no instruction takes a seed (`create_pool`'s params and `open_next_pool`'s args have none) | AccountMismatch (another account as the sysvar) |
| `record_attestation(pool_id, driver, telemetry_root, verified_km, status)` (**removed in v4**: `record_ride_attestation`; old accounts close with `close_attestation`) | authority (S, mut, pays the rent), config, pool, driver_account (= driver), attestation (init_if_needed) | `config.authority` or the payout key; not paused; pool Active; status 0/1/2; VERIFIED needs a non-zero root and km > 0; may be rewritten while the pool is Active; emits `AttestationRecorded` | Paused, Unauthorized, PoolNotActive, InvalidAttestationStatus, InvalidParams, ZeroVerifiedKm |
| `pay_prize` (changed; **replaced in v4** by the winners root) | + `attestation` (`["attestation", pool, to]`) | the account must exist (else Anchor 3012, checked before the handler), belong to the pool and `to`, be VERIFIED with km > 0 | + UnverifiedAttestation, AttestationMismatch, ZeroVerifiedKm |
| `create_pledge(ride_id, driver, max_lamports, lamports_per_km, target_km)` | sponsor (S, mut), driver, config, pool, pledge (init) | not paused; pool Open/Active and `now < play_deadline`; sponsor ≠ driver; all > 0 and `max = rate × target` exactly; the sponsor pays the cap + the account's rent; emits `PledgeCreated` | Paused, PoolNotOpen, TooLate, InvalidParams, AccountMismatch, MathOverflow |
| `settle_pledge(ride_id)` (v4: on the ride's `RideAttestation`, see "v4") | caller (S), driver (mut), sponsor (mut), pool, attestation (pool, driver), pledge (mut, **closed to the sponsor**) | **permissionless**; the attestation is VERIFIED or FLAGGED; earned = `max × min(verified_km, target) / target` (0 when flagged, or when the driver's account would stay under the rent minimum) → driver; the rest + the rent → sponsor; emits `PledgeSettled` | UnverifiedAttestation, AlreadySettled, AccountMismatch |
| `refund_pledge(ride_id)` (v4: the ride's `RideAttestation`) | caller (S), sponsor (mut), pool, attestation (unchecked, `["attestation", pool, pledge.driver]`), pledge (mut, closed to the sponsor) | **permissionless**; the pool is Refunding / Cancelled / Settled, or Active past `payout_at + SETTLE_GRACE_SECS`; the driver has no decided attestation (none, or UNVERIFIED); everything + the rent → sponsor; emits `PledgeRefunded` | PledgeNotRefundable, AttestationExists, AlreadySettled, AccountMismatch |

Errors added (6000 + index, appended so older codes keep their numbers): UnverifiedAttestation 6025 · AttestationMismatch 6026 · InvalidAttestationStatus 6027 · ZeroVerifiedKm 6028 · AlreadySettled 6029 · PledgeNotRefundable 6030 · AttestationExists 6031.

| event | fields |
|---|---|
| `PoolCreated` (grew) | + seed_commitment [u8;32], seed_slot u64, seed_slot_hash [u8;32] |
| `AttestationRecorded` | pool_id u32, pool, driver, telemetry_root [u8;32], verified_km u32, status u8, recorded_at i64 |
| `PledgeCreated` | ride_id [u8;32], sponsor, driver, pool, max_lamports u64, lamports_per_km u64, target_km u32, created_at i64 |
| `PledgeSettled` | ride_id [u8;32], sponsor, driver, pool, verified_km u32, target_km u32, earned_lamports u64, refunded_lamports u64 |
| `PledgeRefunded` | ride_id [u8;32], sponsor, driver, pool, refunded_lamports u64 |

Trust, said plainly: an attestation is the server's verdict that the payout key writes; the program checks the signer, not the drive. The Merkle root ties it to one recording (anyone holding the batches can recompute it). In v3 a pledge settled on the driver's attestation for the pool – the driver's best verified ride in that pool, not necessarily the ride id it was made for (audit H4); v4 settles it on its own ride's `RideAttestation`. Nothing is staked: an earlier v3 draft had a `record_yield` ("JitoSOL yield") that only let the authority deposit SOL; it was removed before deploy.

## v4 – winners root, ride attestations, sponsor receipts, `seal_road`, floors (audit WP5)

An in-place upgrade of the v3 id, **settle-first**: `Pool` grew (a v3 Pool no longer deserializes – every v3 pool terminal before the deploy; `close_ticket` / `close_attestation` read a v3 pool's status from its raw bytes so its rents still come back) and `Config` grew (`migrate_config_v4` once, right after the deploy; until then every step that relies on a floor refuses with `ConfigNotMigrated`). Design: `docs/reviews/audit-2026-10/fix-plan.md` "WP5 design"; runbook: `docs/program-deploy.md` "v4". Sizes below are computed from the structs (`INIT_SPACE`).

| account | PDA seeds | data bytes (+8) | notes |
|---|---|---|---|
| `Config` (grew) | `["config"]` | 154 (+8 = 162) | + `min_review_secs` i64 (default 3600: the review window every new pool keeps after its play deadline, and the floor of every lock), `min_finish_secs` i64 (default 10800: the play window after the sale – the last call, no sale and no new ride after the sale end); set by the cold admin only (`set_config`), localnet sets them tiny |
| `Pool` (grew) | `["pool", pool_id]` | 361 (+8 = 369) | + `seal_slot` u64 (the target slot; 0 once sealed), `platform_fee_bps` u16 (snapshot, L8), `winners_root` [u8;32], `winners_total` u64, `winners_count` u8, `committed_at` i64, `pay_from` i64, `paid_mask` u64 (bit r = rank r paid), `sponsor_refunded` u64 (M8), `open_pledges` u32 (L7), `min_review_secs` i64 (snapshot: a later floor change never moves a running pool's lock), `referral_bps` u16 (v4 only – removed in v5; `POOL_STATUS_OFFSET` stayed 157 because the field was after status) |
| `RideAttestation` | `["ride_attestation", pool pubkey, ride_id [u8;32]]` | 186 (+8 = 194) | `pool`, `ride_id`, `driver`, `telemetry_root` [u8;32], `verified_km` u32, `status` u8 (0 · 1 · 2 as before), `recorded_at` i64, `settle_from` i64, `settled_pledges` u32, `rent_payer`, `bump` – the verdict on ONE ride (H4) |
| `SponsorReceipt` | `["sponsor_receipt", pool pubkey, sponsor pubkey]` | 73 (+8 = 81) | `pool`, `sponsor`, `lamports` u64, `bump` (M8) |
| `Attestation` (v3) | `["attestation", pool, driver]` | 110 (+8 = 118) | no longer written or read by a payment; kept only so `close_attestation` can reclaim old accounts |

**The winners tree** (H5-B / M6): leaf = SHA-256(0x00 ‖ "fc-winner" ‖ pool_id LE u32 ‖ rank u8 ‖ wallet ‖ lamports LE u64), node = SHA-256(0x01 ‖ l ‖ r), an odd last node promoted (not duplicated) – the server's `telemetry-merkle.ts` shape (`domain/economy/winners-merkle.ts` builds the same; `export_fixtures.rs` exports roots and proofs for 1 / 2 / 3 / 20 winners). Rank = leaf index (0-based on chain), at most `MAX_WINNERS` 64; the proof has no direction bits – it is checked against `winners_count`. **The lock**: `pay_from = max(payout_at, committed_at + max(payout_at − play_deadline, pool.min_review_secs))`; the same rule gives a ride attestation its `settle_from`.

| instruction (args) | accounts | rules | errors |
|---|---|---|---|
| `commit_winners(pool_id, root, total, count)` | authority (S), config, pool (mut) | `config.authority` or the payout key; migrated Config; not paused before the grace; Active; `now >= play_deadline`; no root yet; `count <= 64`; `total <= prize_share` (v5; v4 was `prize_share + referral_share`); `count == 0` ⇔ `total == 0` and an all-zero root (= no winner); refused when `pay_from > grace_end − 1 day` (rule f: after the grace anyone may close and sweep what is unpaid); writes the root, `pay_from`, `paid_mask = 0`; emits `WinnersCommitted` | Unauthorized, ConfigNotMigrated, Paused, PoolNotActive, TooEarly, WinnersCommitted, TooManyWinners, PrizeExceedsShare, InvalidParams, CommitTooLate |
| `veto_winners(pool_id)` | authority (S), config, pool (mut) | the cold admin only (never the payout key); Active; a root committed and `paid_mask == 0`; clears it (the server commits again, the lock restarts); works while paused; emits `WinnersVetoed` | Unauthorized, PoolNotActive, WinnersNotCommitted, WinnersPartlyPaid |
| `pay_prize(pool_id, rank, lamports, proof)` | see the table above | permissionless, each committed rank once, from `pay_from`; emits `PrizePaid` (rank 0-based) | see above |
| `record_ride_attestation(pool_id, ride_id, driver, telemetry_root, verified_km, status)` | authority (S, mut, pays the rent), config, pool, ride_attestation (init_if_needed) | `config.authority` or the payout key; migrated Config; not paused before the grace; Active; status 0/1/2 (VERIFIED needs a root and km > 0); `settle_from` = the lock from now, refused past `grace_end − 1 day` (`CommitTooLate`, red-team M2); rewritable (a verdict changed in review – the lock restarts) until a pledge settled on it (`AttestationFinal`); the ride's driver never changes; emits `RideAttestationRecorded` | Unauthorized, ConfigNotMigrated, Paused, PoolNotActive, InvalidAttestationStatus, InvalidParams, ZeroVerifiedKm, CommitTooLate, AttestationFinal, AttestationMismatch |
| `create_pledge` (changed) | pool (mut) | + `open_pledges += 1` | |
| `settle_pledge(ride_id)` (changed) | caller (S), driver (mut), sponsor (mut), config, pool (mut), ride_attestation (mut), pledge (mut) | **permissionless**; on THIS ride's attestation (H4); not paused before the grace; `now >= settle_from` and `>= payout_at` (L5); VERIFIED or FLAGGED; a driver wallet that would stay under the rent minimum waits (`DriverBelowRentMin`) until the grace, then earns 0 and the sponsor gets it all (L6); `settled_pledges += 1` (the attestation is final), `open_pledges −= 1`; emits `PledgeSettled` | + DriverBelowRentMin, TooEarly, Paused |
| `refund_pledge(ride_id)` (changed) | caller (S), sponsor (mut), pool (mut), ride_attestation (unchecked), pledge (mut) | **permissionless**, never paused; the pool Refunding / Cancelled / Settled, or Active past the grace; refused only when THIS ride has a decided attestation naming the pledge's driver; `open_pledges −= 1` | as before |
| `close_ride_attestation(pool_id, ride_id)` | caller (S), pool, ride_attestation (mut, closed), rent_payer (mut) | permissionless; pool Settled / Cancelled and `open_pledges == 0`; rent → its payer (L7); emits `AttestationClosed` | NotSettled, PledgesOpen, AccountMismatch |
| `close_attestation(pool_id, driver)` | caller (S), config, pool (unchecked, v3 layout), attestation (mut, closed), rent_to (mut, = the payout key, else the admin) | permissionless; the v3 pool (status read raw) Settled / Cancelled; emits `AttestationClosed` | NotSettled, AccountMismatch |
| `refund_sponsor(pool_id)` | caller (S), pool (mut), vault (mut), receipt (mut, closed to the sponsor), sponsor (mut) | **permissionless**; Refunding (failed / cancelled / expired); the receipt's lamports + its rent → the sponsor (must end rent-exempt); `sponsor_refunded += lamports`; emits `SponsorRefunded` | NotRefunding, BelowRentMin, AccountMismatch |
| `close_sponsor_receipt(pool_id)` | caller (S), pool, receipt (mut, closed), sponsor (mut) | permissionless; pool Settled (the sponsorship was in the split); rent → the sponsor | NotSettled, AccountMismatch |
| `seal_road(pool_id)` | caller (S), pool (mut), slot_hashes (the sysvar) | **permissionless** (L4); Open / Active, not sealed; `now_slot > seal_slot` (= the opening slot + `SEAL_DELAY_SLOTS` 8); takes the SlotHashes entry of the FIRST slot ≥ `seal_slot` (the same entry whenever it is called – no choice of moment), writes `seed_commitment` / `seed_slot` / `seed_slot_hash`, `seal_slot = 0`; while the target may still appear: `TooEarly`; re-armed (`now_slot + 8`, `SealRearmed`) only once it has left the 512-slot window; emits `RoadSealed`. The server serves no ride of an unsealed pool | RoadAlreadySealed, PoolNotActive, TooEarly, AccountMismatch |
| `migrate_config_v4()` | authority (S, mut, pays the extra rent), config (mut, unchecked), system_program | once; owner + discriminator + the v3 `authority` = the signer; grows the Config, floors at their defaults; emits `ConfigMigrated` | AlreadyMigrated, AccountMismatch, Unauthorized |

`create_pool` / `open_next_pool` no longer read SlotHashes: `PoolCreated` carries an all-zero `seed_commitment` and `seed_slot` = the seal target (`RoadSealed` has the seed). Rents: a `RideAttestation` is paid by the key that recorded it (back at `close_ride_attestation`), a `SponsorReceipt` by the sponsor (back at `refund_sponsor` / `close_sponsor_receipt`).

Errors added: WindowTooShort 6032 · WinnersCommitted 6033 · WinnersNotCommitted 6034 · TooManyWinners 6035 · CommitTooLate 6036 · InvalidProof 6037 · RankAlreadyPaid 6038 · WinnersPartlyPaid 6039 · PrizesUnpaid 6040 · DriverBelowRentMin 6041 · AttestationFinal 6042 · PledgesOpen 6043 · SponsorRefundsPending 6044 · RoadAlreadySealed 6045 · AlreadyMigrated 6046 · ConfigNotMigrated 6047. `record_attestation`'s v3 errors (`UnverifiedAttestation`, …) keep their numbers.

| event | fields |
|---|---|
| `WinnersCommitted` | pool_id u32, root [u8;32], total u64, count u8, committed_at i64, pay_from i64, by |
| `WinnersVetoed` | pool_id u32, root [u8;32] |
| `RideAttestationRecorded` | pool_id u32, pool, ride_id [u8;32], driver, telemetry_root [u8;32], verified_km u32, status u8, recorded_at i64, settle_from i64 |
| `AttestationClosed` | account, rent_to, lamports u64 |
| `SponsorRefunded` | pool_id u32, sponsor, lamports u64, sponsor_refunded_total u64 |
| `RoadSealed` | pool_id u32, seed_slot u64, seed_slot_hash [u8;32], seed_commitment [u8;32] |
| `SealRearmed` | pool_id u32, seal_slot u64 |
| `FloorsSet` | min_review_secs i64, min_finish_secs i64 |
| `ConfigMigrated` | min_review_secs i64, min_finish_secs i64 |

v4 totals: 29 instructions (v3's 21 − `record_attestation` + 9), 27 events (`AttestationRecorded` stays in the IDL for v3 history, no longer emitted), 48 errors.

## The money maths (bps)

All in u128 with checked casts back to u64. `pot = price_lamports * tickets_sold + sponsored` (the price is immutable, so ticket money is derived, not stored).

```
pot             = price × tickets_sold + sponsored                         (the vault, not the prize base)
room            = floor(sponsored × max_player_share_bps / (10000 − bps)) (bps ≤ 4999, so the divisor is at least 5001)
counted_tickets = min(tickets, room)
ticket_excess   = tickets − counted_tickets                               (carried to the seed treasury at close)
counted_pot     = counted_tickets + sponsored
prize_share     = floor(counted_pot × prize_bps / 10000)                  (the commit / pay cap; payout_cap is gone)
seed_share      = floor(counted_pot × seed_bps  / 10000)
fee_share       = counted_pot − prize_share − seed_share                  (the floor remainders land here)
platform        = floor(fee_share × pool.platform_fee_bps / 10000)        (v4: Config's value snapshotted when the pool opened)
fee_out         = fee_share − platform                                    -> fee_treasury
```

Decisions:
- **v5 default** (initialize, overridable by `set_pool_rules`) is prize 8500 / seed 500 / fee 1000. That is the plan's 85% boards / 5% carry / 10% season final, with the fee leg standing in for the final accumulator. `platform_fee_bps` still skims the fee leg. To match "10% final, no skim", set `platform_fee_bps` to 0 and point `fee_treasury` at the final pot. Board shares 25/30/45 stay off chain. The three shares must sum to 10000.
- **Player money stays under half the prize base.** `max_player_share_bps` defaults to 4740 (the plan's 47.4% funding formula) and the program rejects 5000 and above (`PlayerShareCeiling`). The cap is enforced at settle, not at `buy_ticket`: ticket lamports above `room` are not in `counted_pot`, so they do not enlarge `prize_share` or the fee. With no sponsorship the room is 0 and a ticket-only pool pays no prize. The plan does not say where lamports already in the vault and over the cap go; this program carries that excess to the seed treasury (the next pool) at `close_pool`, and reports it as `PoolClosed.ticket_excess`. A cancelled close reports 0 (the tickets were refunded).
- **Sponsorship is in the prize base in full.** It raises the room for tickets. `commit_winners` and `pay_prize` are bounded by `prize_share` alone.
- `platform_fee_bps` is a share **of the fee share** (not of the pool), paid to `config.platform_treasury` at close. v4 (audit L8) takes the value the pool opened with (`Pool.platform_fee_bps`), not `Config`'s at close.
- **Unclaimed prize** (`prize_share − prizes_paid`) goes to the seed treasury at close, together with the seed share, the ticket excess and stray lamports. It is not the excess.
- `close_pool` pays: `fee_out` -> fee_treasury, `platform` -> platform_treasury, everything else except the rent minimum -> seed_treasury, and the **rent minimum back to the pool's creator**. So `seed + fee_out + platform + rent_returned == vault balance`, the vault ends at 0, status Settled.
- Refunded pools: `close_pool` is allowed once `refunded == price * tickets_sold` (all refunded) and, since v4, `sponsor_refunded == sponsored` (every sponsor got its sponsorship back through `refund_sponsor`). Everything left in the vault (stray lamports; before v4 also the sponsorship of the failed pool) goes to the seed treasury, the rent minimum to the authority, status **Cancelled** (4), `PoolClosed.cancelled = true`. (Plan said sponsorship of a failed pool "stays for the authority's sweep"; this does the same without a separate `sweep` instruction and also ends the vault at 0.)

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
| `pay_prize` (v3, attestation) | 12 824 | ~10k |
| `commit_winners` (v4) | ≈ 8 800 | |
| `pay_prize` (v4), 20-winner proof | ≈ 15 200 | |
| `pay_prize` (v4), 64-winner proof | ≈ 15 500 | |
| `refund_sponsor` (v4) | ≈ 13 500 | |
| `sponsor`, creating the receipt (v4) | ≈ 18 100 | |
| `close_pool` | 16 745 | |
| `open_next_pool` | ~24 000 | (fixture run; the server sets 40 000 – two PDA inits) |

Set `setComputeUnitLimit` from the simulation (`unitsConsumed * 1.2`) as planned; the test asserts only loose ceilings (buy < 40k, refund < 30k, refund_sponsor < 30k, sponsor < 40k, commit_winners < 20k, pay_prize < 22k = the server's `CU_LIMITS.pay_prize`, close_pool < 60k).

## Tests (`programs/freightchain_pools/tests/`, 151 LiteSVM incl. the fixture exporter + 3 unit)

`create_and_buy.rs` create_pool validation / authority / unfunded treasury, buy to exactly min activates (events decoded), sponsored buy credits the buyer and records the rent payer, wallet cap, sold out, deadlines.
`refunds.rs` fail_pool conditions, refund exact price + rent to a separate rent payer, wrong receivers, refund when not Refunding, refund twice, batch of 8 + re-sent batch + partial progress, close_pool after refunds, cancel_pool, sponsor.
`settle.rs` commit_winners: the settlers' only, not before the play deadline, written once, total / count / empty root checked, refused too close to the grace; pay_prize: only the committed leaf, bounded by the committed total and the prize share, a rank never twice, a stranger pays and the money goes only to the leaf's wallet (adversarial matrix); only the admin vetoes, only before a rank is paid; close_pool exact split for random amounts, close guards, waits for the root's lock, refused with unpaid ranks, a no-winner root closes after the lock, unclaimed prize and stray lamports to the seed, the pool's platform-cut snapshot; pause stops commit / pay / close only before the grace; anyone closes a partly paid pool after it; close_ticket rent to rent_payer, `MathOverflow` instead of wrapping (a forged pool), the review lock snapshotted at open.
`grace_and_authority.rs` sponsor cut-off on Open / Active pools, expire before / after the grace and with prizes paid, refunds after expiry, permissionless close after the grace (refused before, `MustExpire` without paid prizes, outputs sum to the vault, rent receiver must be the creator), unpaid pool after the grace: `MustExpire` -> expire -> refunds -> close, the admin closes a no-winner pool before the grace only through an empty root, permissionless close of a refunded pool, pause stops settlement before the grace and never after, propose / accept authority (accept clears the payout key), a rotated key taking over existing pools.
`series_and_payout.rs` set_series authority + every rule + the floors (create_pool too), open_next_pool on its slot (deadlines from the series, the caller as creator, one pool per slot, overlapping pools), a late opener never shifts the grid, a series change applies to the next pool only, disabled / paused / foreign treasuries refused, the payout key named / cleared by the admin only and able to do nothing else, nobody pays a prize before the review window ends, a late commit waits a whole lock, the lock = the longer of the review window and `min_review_secs`, the grace counted from `payout_at`, a whole day of the 1 h series; the H5 / M6 PoCs: a stolen payout key cannot pay itself before the admin can veto, pause stops prize payments, no double pay and a paid root is frozen, cross-pool proofs and wallet substitution refused, close / expire guards with a committed root.
`admin_rent_cu.rs` initialize only by the upgrade authority (a stranger first: `Unauthorized`; an immutable program: `Unauthorized`; names another wallet as admin), pause, set_config, the vault-rent rule, compute units, IDL event discriminators, raw log decoding.
`pledge.rs` pledges on v4 ride attestations (H4 / L5 / L6 / L7: per-ride settle, the review lock, a driver below the rent minimum, closing finished attestations, pause before the grace). `vault_split_table.rs` the shared split table the server's `vault-split.ts` is checked against, the platform cut the pool opened with. The v4 suites (commit / veto / pay with a proof, the lock, sponsor receipts, `seal_road`, the floors, `migrate_config_v4`) live in the files above; the audit PoCs are promoted to tests (ids in comments).
The clock is warped with `svm.set_sysvar::<Clock>()`; no test waits. Defensive errors only a forged account reaches are asserted in `pledge.rs` so the coverage gate sees every code. On a real validator the localnet e2e covers the rest (`.claude/skills/localnet-e2e`; its coverage gate was 17/17 instructions, 14/14 events, 24/25 errors on v2 – **the localnet suites have not run on v4 yet** (WP5 D)).

## v5 – no referral leg, admin rules snapshotted per pool

v5 keeps every v4 audit fix (winners root, `seal_road`, ride attestations, sponsor receipts, the floors, `migrate_config_v4`). It is **not** an in-place upgrade: Config, Series and Pool all change size (167 / 132 / 362), `referral_bps` / `referral_share` / `payout_cap` are gone, and the devnet program is still v3. Deploy under a fresh program id, only when the owner asks. IDL `metadata.version` is the string `"5"` (the crate version is `5.0.0`).

`initialize` writes the plan defaults: paid tickets **on** (so the existing buy path works until an admin turns it off), split 8500/500/1000, `max_player_share_bps` 4740, `max_tickets` 0. `set_pool_rules` (authority only) replaces those six fields. `create_pool` and `open_next_pool` copy them onto the pool. A later rule change does not move an open pool. `buy_ticket` checks the pool's flag and fails with `PaidTicketsDisabled` when it is off; `sponsor` is not gated. `Config.max_tickets` is a second ceiling (0 = none): the pool stores the tighter of the requested max and the config max.

`migrate_config_v4` still grows a v3 Config in one step, and the new tail is filled with those same defaults. A v4 pool account does not deserialize as v5.

The shared money table is `server/test/fixtures/chain/vault-split-cases.json` (this program's `tests/vault_split_table.rs` and `server/src/domain/economy/vault-split.ts`). `server/test/fixtures/chain/pool-program.json` is produced by `tests/export_fixtures.rs` and was **not** regenerated here: the owner runs `FC_FIXTURES_OUT=… cargo test --test export_fixtures` after `anchor build --arch v0`. Until that file matches this IDL, the server codec spec's byte compare fails.

## Not built / notes

- Session keys, `Balance`, `deposit` / `withdraw`, `buy_ticket_with_session` (phase 2).
- No `sweep`, no Pool account close (v4 added `refund_sponsor`). `Pool.authority` is copied from the signer of `create_pool` and never changes.
- Trust in the admin is by design: the admin (or the payout key) decides who is in the winners root – the program pays exactly that list, capped, after it was public for the review lock, and may close the pool after a root of 0 winners (the prize share goes to the seed treasury). v4 protects against a stolen payout key (the public lock + the cold admin's veto), not against a malicious admin; the escape hatches protect against an absent one. `buy_ticket`'s `dup` markers are documentation only (Anchor 1.2.1 checks duplicates for `Account` types, not signers).
