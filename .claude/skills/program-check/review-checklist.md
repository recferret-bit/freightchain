# freightchain_pools – review checklist

Invariants specific to this program (`programs/freightchain_pools/src`). The generic Solana classes (signer, owner, PDA, CPI target)
are the Trail of Bits scanner's job; these are the ones only someone who knows the design can check. For each item: ✓ / ✗ + file:line, and the test that pins it.

## Money conservation
- [ ] Ticket money is derived, never stored: `tickets_lamports() = price_lamports × tickets_sold` (u128, checked cast). `price_lamports` is never written after `create_pool`.
- [ ] `split()` floors prize and seed, the fee takes the remainder: `prize + seed + fee == pot` exactly (`state.rs` unit test + `vault_split_table.rs`).
- [ ] `pay_prize`: `prizes_paid + lamports ≤ prize_share()` – the cap is recomputed from the current pot, so sponsorship can raise it but never above what came in.
- [ ] `close_pool` (Active): `seed_out = (vault − rent_min) − fee_out − platform_out`, the four legs go to the DECLARED treasuries + `pool.authority`, and the vault is asserted to end at exactly 0.
- [ ] `close_pool` (Refunding): only once `refunded == tickets_lamports()` (all tickets back); fee and platform are 0; the rest (sponsorship + stray lamports) to the seed treasury.
- [ ] Arithmetic that can overflow is `checked_*` or u128 with `try_from`; the few plain `-` / `*` (`settle.rs` `fee - platform`, the u128 cost in `buy_ticket.rs`, the bps sum in `create_pool.rs`) are bounded by construction – re-check that bound, don't flag the operator. Release profile keeps `overflow-checks = true` (`Cargo.toml`).

## The vault and rent
- [ ] The vault is a 0-data SYSTEM account at `["vault", pool_id LE]`; only `raw_from_vault` / `pay_from_vault` sign for it, always with the stored `pool.vault_bump`.
- [ ] Every single-leg outflow (refund, prize) leaves the vault at `≥ rent_min` or exactly 0 (`pay_from_vault`); only `close_pool` uses the unchecked multi-leg sweep, and it asserts 0 at the end.
- [ ] `price_lamports ≥ rent_min` at creation (a refund must be able to land in an emptied wallet); `pay_prize` needs `to` to end rent-exempt; treasuries must already be rent-exempt.
- [ ] Nothing reads raw vault lamports as "the pot" (vault = rent_min + escrow + stray donations).

## State machine
- [ ] Transitions only: Open→Active (`buy_ticket` reaching `min_tickets`), Open→Refunding (`fail_pool` past `prep_deadline` below min; `cancel_pool` by the authority), Active→Refunding (`expire_pool`), Active→Settled / Refunding→Cancelled (`close_pool`). No path back.
- [ ] `buy_ticket` / `sponsor` refuse an Open pool from `prep_deadline` on and any pool from `play_deadline` on (a doomed pool cannot take money).
- [ ] `pay_prize` only Active and after `play_deadline`; nothing pays out of an Open or Refunding pool except `refund`.
- [ ] `pause` blocks only money IN (`create_pool`, `buy_ticket`, `sponsor`) – never refunds, prizes, closing or the cranks.

## Tickets and refunds
- [ ] Ticket PDA = `["ticket", pool, buyer]`; `refund` derives it from the passed `buyer`, then checks `ticket.buyer == buyer` and `ticket.rent_payer == rent_payer` – a cranker cannot redirect the price or the rent.
- [ ] "Closed account" IS the refunded state: `refund` zeroes lamports, assigns to the system program and resizes to 0 in one instruction; a second refund answers `AlreadyRefunded` (not a deserialisation error), and `init_if_needed` cannot revive it because `buy_ticket` refuses a Refunding pool.
- [ ] `rent_payer` is set on the FIRST buy only; later buys (possibly another fee payer) do not overwrite it.
- [ ] `max_per_wallet` and `max_tickets` are enforced with checked adds before the transfer.

## Authority and the escape hatches
- [ ] `initialize` is signed by the program's upgrade authority (`program` + `program_data` accounts, `programdata_address()` match, `upgrade_authority_address == Some(signer)`) and names the admin as an argument; an immutable program cannot be initialized (`admin_rent_cu.rs` `initialize_only_by_the_upgrade_authority`). Fixed 2026-10-08 – it used to be first-come.
- [ ] `create_pool` caps `play_deadline` at `now + MAX_POOL_SECS` (365 d), so no Active pool can lock tickets for years.
- [ ] Admin rights come from `config.authority` only (`has_one`); `pool.authority` is just the creator record that gets the vault rent back.
- [ ] Handover is two-step (`propose_authority` → `accept_authority` signed by the new key); a rotation takes over existing pools.
- [ ] After `play_deadline + SETTLE_GRACE_SECS` (14 days) a lost admin cannot lock money: no prize paid → `expire_pool` → full refunds; prizes paid → anyone may `close_pool`, and money still goes only to the declared treasuries. A permissionless close with `prizes_paid == 0` must fail (`MustExpire`), otherwise the prize share would be swept to the operator's seed treasury.
- [ ] No instruction lets the caller choose where money goes except `pay_prize`'s `to` (admin-signed, capped) and `refund`'s `buyer` (bound to the ticket PDA).

## Sealevel classes outside the Trail of Bits six

`coral-xyz/sealevel-attacks` (Anchor's security page points at this set). The scanner's six are signer, owner, arbitrary CPI, bump canonicalisation, sysvar address, and instruction introspection. These six still need a source read. A grep hit is a lead.

- [ ] Account-data matching: a stored key matches the account passed (`has_one` / `constraint`), not only the right type.
- [ ] Type cosplay: account types are separated by discriminator. No shared layout lets one account deserialise as another.
- [ ] Re-initialisation: `init_if_needed` rejects an already-live account, or the instruction cannot reset authority.
- [ ] Duplicate mutable accounts: two `mut` accounts of the same type cannot be the same key (`constraint = a.key() != b.key()`).
- [ ] PDA sharing: seeds include every key that must not share the account. A single global seed is a shared account.
- [ ] Closing accounts: `close` pays a constrained destination, wipes the data, and the same instruction cannot revive it.

## Escrow attacks

The generic map lives in the `security-audit` skill: OWASP Smart Contract Top 10 2026 as it applies on Solana, Sealevel, and Ackee's common attack vectors. The OWASP Solana Programs Top 10 has no published rows. Do not invent S01–S10. These are the escrow questions this vault still has to answer.

- [ ] After any CPI, a balance used for a later decision is read from a reloaded account, not the pre-CPI copy (Ackee account-reloading). `n/a` only when that instruction does no CPI before the read.
- [ ] `invoke_signed` / `new_with_signer` for the vault signs the system program or another fixed program id, never an account the caller passed (Ackee pda-privileges).
- [ ] A pubkey stored on the pool or the ticket that authorises a payment (`buyer`, treasuries, `rent_payer`) is an equality constraint, not assumed because the PDA address matched.
- [ ] A direct lamport write cannot move the vault below `rent_min` except the close path that asserts 0, and it cannot be aimed at an account this program does not own.
- [ ] `slot_hashes` is the SlotHashes sysvar. The seed commitment written at create cannot be replaced later.

## Build provenance
- [ ] `verifiable-build.hash` matches a fresh `solana-verify build` (check.sh stage 1); the deployed program hash (once deployed) matches it (`check.sh onchain`).
- [ ] `declare_id!`, `Anchor.toml` and `idl/freightchain_pools.json` `address` agree; the placeholder id is replaced before a real deploy (`anchor keys sync`) – which changes the pin.
