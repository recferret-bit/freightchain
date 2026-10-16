#[macro_use]
mod common;

use {
    anchor_lang::solana_program::{
        instruction::AccountMeta, instruction::Instruction, system_program,
    },
    anchor_spl::{associated_token, token},
    common::*,
    freightchain_honk::{error::HonkError, events::HonkInitialized, isqrt, EMISSION_CAP, LOCK_SECS, UNIT},
    solana_keypair::Keypair,
    solana_signer::Signer,
};

fn label(name: &str) -> [u8; 16] {
    let mut out = [0u8; 16];
    out[..name.len()].copy_from_slice(name.as_bytes());
    out
}

fn with_honk() -> Env {
    let mut e = Env::new();
    unwrap_tx(e.swap(SOL, 0));
    e
}

#[test]
fn genesis_supply_and_vault_and_mint_authority_stays() {
    let e = Env::new();
    let mint = e.mint(&honk_mint_pda());
    assert_eq!(mint.supply, 2_000_000 * 1_000_000);
    assert_eq!(mint.supply, GENESIS);
    assert_eq!(mint.decimals, 6);
    assert_eq!(mint.mint_authority.unwrap(), authority_pda());
    assert!(mint.freeze_authority.is_none());
    assert!(e.mint(&lp_mint_pda()).freeze_authority.is_none());
    assert_eq!(e.amount(&vault_pda()), GENESIS);
}

#[test]
fn pool_sol_reserve_is_the_sol_in() {
    let e = Env::new();
    assert_eq!(e.pool().sol_reserve, 10 * SOL);
    let data_len = e.svm.get_account(&pool_pda()).unwrap().data.len();
    let rent = e.svm.minimum_balance_for_rent_exemption(data_len);
    assert_eq!(e.bal(&pool_pda()), rent + 10 * SOL);
}

#[test]
fn lp_locker_holds_the_whole_supply() {
    let e = Env::new();
    let lp = e.mint(&lp_mint_pda());
    assert!(lp.mint_authority.is_none());
    let n = (GENESIS as u128) * (10 * SOL as u128);
    let root = isqrt(n);
    assert!(root * root <= n && (root + 1) * (root + 1) > n);
    assert_eq!(lp.supply, root as u64);
    assert_eq!(e.amount(&lp_locker_pda()), lp.supply);
}

#[test]
fn initialize_emits_supply_sol_and_lp() {
    let mut e = Env::bare();
    let meta = unwrap_tx(e.initialize(10 * SOL));
    let ev = events::<HonkInitialized>(&meta.logs);
    assert_eq!(ev.len(), 1);
    assert_eq!(ev[0].supply, GENESIS);
    assert_eq!(ev[0].sol_in, 10 * SOL);
    assert_eq!(ev[0].lp, e.mint(&lp_mint_pda()).supply);
}

#[test]
fn a_second_initialize_fails() {
    let mut e = Env::new();
    assert!(e.initialize(10 * SOL).is_err());
}

#[test]
fn initialize_zero_sol_is_zero_amount() {
    let mut e = Env::bare();
    assert_err!(e.initialize(0), HonkError::ZeroAmount);
}

#[test]
fn initialize_refuses_anything_but_the_opening_deposit() {
    for sol_in in [1, SOL, 9 * SOL, 10 * SOL + 1] {
        let mut e = Env::bare();
        assert_err!(e.initialize(sol_in), HonkError::ZeroAmount);
    }
}

#[test]
fn swap_of_one_sol_pays_the_constant_product_and_the_vault_falls() {
    let mut e = Env::new();
    let honk_reserve = e.pool().honk_reserve;
    let sol_reserve = e.pool().sol_reserve;
    let vault_before = e.amount(&vault_pda());
    let sol_in = SOL;
    let expected =
        (honk_reserve as u128) * (sol_in as u128) / ((sol_reserve as u128) + (sol_in as u128));
    unwrap_tx(e.swap(sol_in, expected as u64));
    let user = e.payer.pubkey();
    assert_eq!(e.amount(&ata(&user, &honk_mint_pda())), expected as u64);
    assert_eq!(vault_before - e.amount(&vault_pda()), expected as u64);
    assert_eq!(e.pool().sol_reserve, sol_reserve + sol_in);
    assert_eq!(e.pool().honk_reserve, honk_reserve - expected as u64);
    assert_eq!(e.amount(&vault_pda()), e.pool().honk_reserve);
}

#[test]
fn swap_zero_sol_is_zero_amount() {
    let mut e = Env::new();
    assert_err!(e.swap(0, 0), HonkError::ZeroAmount);
}

#[test]
fn swap_min_out_zero_takes_any_positive_out() {
    let mut e = Env::new();
    unwrap_tx(e.swap(SOL, 0));
    assert!(e.amount(&ata(&e.payer.pubkey(), &honk_mint_pda())) > 0);
}

#[test]
fn swap_under_min_out_is_slippage_and_the_pool_stays() {
    let mut e = Env::new();
    let honk_reserve = e.pool().honk_reserve;
    let sol_reserve = e.pool().sol_reserve;
    let vault = e.amount(&vault_pda());
    let sol_in = SOL;
    let expected =
        (honk_reserve as u128) * (sol_in as u128) / ((sol_reserve as u128) + (sol_in as u128));
    assert_err!(e.swap(sol_in, expected as u64 + 1), HonkError::Slippage);
    assert_eq!(e.pool().honk_reserve, honk_reserve);
    assert_eq!(e.pool().sol_reserve, sol_reserve);
    assert_eq!(e.amount(&vault_pda()), vault);
    assert!(e
        .svm
        .get_account(&ata(&e.payer.pubkey(), &honk_mint_pda()))
        .is_none());
}

#[test]
fn burn_drops_user_and_supply_not_the_vault() {
    let mut e = with_honk();
    let user = ata(&e.payer.pubkey(), &honk_mint_pda());
    let before_user = e.amount(&user);
    let before_supply = e.mint(&honk_mint_pda()).supply;
    let before_vault = e.amount(&vault_pda());
    unwrap_tx(e.burn(100 * UNIT));
    assert_eq!(e.amount(&user), before_user - 100 * UNIT);
    assert_eq!(e.mint(&honk_mint_pda()).supply, before_supply - 100 * UNIT);
    assert_eq!(e.amount(&vault_pda()), before_vault);
}

#[test]
fn burn_of_zero_fails() {
    let mut e = with_honk();
    assert_err!(e.burn(0), HonkError::ZeroAmount);
}

#[test]
fn buy_part_ordinary_burns_65() {
    let mut e = with_honk();
    let user = ata(&e.payer.pubkey(), &honk_mint_pda());
    let before_user = e.amount(&user);
    let before_supply = e.mint(&honk_mint_pda()).supply;
    let before_vault = e.amount(&vault_pda());
    let slot = label("wheel");
    let item = label("crimson");
    let (nft, res) = e.try_buy(slot, item);
    unwrap_tx(res);
    assert_eq!(before_user - e.amount(&user), 65 * UNIT);
    assert_eq!(before_supply - e.mint(&honk_mint_pda()).supply, 65 * UNIT);
    assert_eq!(e.amount(&vault_pda()), before_vault);
    assert!(!e.part(&e.payer.pubkey(), &slot, &item).gold);
    assert_part_nft(&e, &nft);
}

#[test]
fn buy_part_gold_burns_260() {
    let mut e = with_honk();
    let user = ata(&e.payer.pubkey(), &honk_mint_pda());
    let before_user = e.amount(&user);
    let before_supply = e.mint(&honk_mint_pda()).supply;
    let slot = label("wheel");
    let item = label("gold");
    let (nft, res) = e.try_buy(slot, item);
    unwrap_tx(res);
    assert_eq!(before_user - e.amount(&user), 260 * UNIT);
    assert_eq!(before_supply - e.mint(&honk_mint_pda()).supply, 260 * UNIT);
    assert!(e.part(&e.payer.pubkey(), &slot, &item).gold);
    assert_part_nft(&e, &nft);
}

#[test]
fn a_verified_ride_mints_to_the_rider_and_not_the_vault() {
    let mut e = Env::new();
    let rider = Keypair::new();
    let vault = e.amount(&vault_pda());
    let supply = e.mint(&honk_mint_pda()).supply;
    let ride = [7u8; 16];
    unwrap_tx(e.mint_ride(ride, 100 * UNIT, &rider.pubkey()));
    assert_eq!(e.amount(&vault_pda()), vault);
    assert_eq!(e.mint(&honk_mint_pda()).supply, supply + 100 * UNIT);
    assert_eq!(e.amount(&ata(&rider.pubkey(), &honk_mint_pda())), 100 * UNIT);
    assert!(e.mint_ride(ride, 100 * UNIT, &rider.pubkey()).is_err());
    assert_err!(e.mint_ride([8u8; 16], EMISSION_CAP, &rider.pubkey()), HonkError::EmissionCap);
}

fn assert_part_nft(e: &Env, nft: &anchor_lang::prelude::Pubkey) {
    let mint = e.mint(nft);
    assert_eq!(mint.decimals, 0);
    assert_eq!(mint.supply, 1);
    assert!(mint.mint_authority.is_none());
    let ata = e.token(&ata(&e.payer.pubkey(), nft));
    assert!(ata.is_frozen());
    assert_eq!(ata.amount, 1);
}

#[test]
fn a_transfer_of_the_part_nft_fails() {
    let mut e = with_honk();
    let (nft, res) = e.try_buy(label("wheel"), label("crimson"));
    unwrap_tx(res);
    let buyer = e.payer();
    let dest_owner = Keypair::new();
    let src = ata(&buyer.pubkey(), &nft);
    let dst = ata(&dest_owner.pubkey(), &nft);
    let create = Instruction::new_with_bytes(
        associated_token::ID,
        &[],
        vec![
            AccountMeta::new(buyer.pubkey(), true),
            AccountMeta::new(dst, false),
            AccountMeta::new_readonly(dest_owner.pubkey(), false),
            AccountMeta::new_readonly(nft, false),
            AccountMeta::new_readonly(system_program::ID, false),
            AccountMeta::new_readonly(token::ID, false),
        ],
    );
    unwrap_tx(e.send(&[create], &buyer, &[]));
    let mut data = vec![3u8];
    data.extend_from_slice(&1u64.to_le_bytes());
    let transfer = Instruction::new_with_bytes(
        token::ID,
        &data,
        vec![
            AccountMeta::new(src, false),
            AccountMeta::new(dst, false),
            AccountMeta::new_readonly(buyer.pubkey(), true),
        ],
    );
    assert!(e.send(&[transfer], &buyer, &[]).is_err());
    assert!(e.token(&src).is_frozen());
    assert_eq!(e.amount(&src), 1);
}

#[test]
fn buying_the_same_part_again_is_already_bought() {
    let mut e = with_honk();
    unwrap_tx(e.try_buy(label("wheel"), label("crimson")).1);
    let (_, again) = e.try_buy(label("wheel"), label("crimson"));
    assert_err!(again, HonkError::AlreadyBought);
}

#[test]
fn a_default_or_unknown_part_is_not_for_sale() {
    let mut e = with_honk();
    let before = e.mint(&honk_mint_pda()).supply;
    for (slot, item) in [
        ("wheel", "classic"),
        ("truck_color", "red"),
        ("truck_color", "gold"),
        ("gearbox", "stick"),
        ("dice", "white"),
        ("needle", "orange"),
        ("ornament", "spear"),
        ("dash", "stock"),
        ("indicator", "amber"),
        ("phone", "black"),
        ("wheel", "nope"),
    ] {
        let (_, res) = e.try_buy(label(slot), label(item));
        assert_err!(res, HonkError::NotForSale);
    }
    let (_, junk) = e.try_buy([1; 16], [2; 16]);
    assert_err!(junk, HonkError::NotForSale);
    assert_eq!(e.mint(&honk_mint_pda()).supply, before);
}

#[test]
fn new_cab_slots_use_the_catalog_price() {
    let mut e = with_honk();
    let user = ata(&e.payer.pubkey(), &honk_mint_pda());
    let before = e.amount(&user);
    let ball = label("ball");
    let ornament = label("ornament");
    unwrap_tx(e.try_buy(ornament, ball).1);
    let phone = label("phone");
    let gold = label("gold");
    unwrap_tx(e.try_buy(phone, gold).1);
    assert_eq!(before - e.amount(&user), 65 * UNIT + 260 * UNIT);
    assert!(!e.part(&e.payer.pubkey(), &ornament, &ball).gold);
    assert!(e.part(&e.payer.pubkey(), &phone, &gold).gold);
}

#[test]
fn release_lp_is_too_early() {
    let mut e = Env::new();
    let locked = e.amount(&lp_locker_pda());
    assert!(e.pool().unlock_at > e.now());
    assert_eq!(e.pool().unlock_at, T0 + LOCK_SECS);
    assert_err!(e.release_lp(), HonkError::TooEarly);
    assert_eq!(e.amount(&lp_locker_pda()), locked);
}

#[test]
fn selling_the_honk_back_pays_sol_and_refills_the_vault() {
    let mut e = Env::new();
    unwrap_tx(e.swap(SOL, 0));
    let user = ata(&e.payer.pubkey(), &honk_mint_pda());
    let honk = e.amount(&user);
    let supply = e.mint(&honk_mint_pda()).supply;
    let honk_reserve = e.pool().honk_reserve;
    let sol_reserve = e.pool().sol_reserve;
    let rent = e.bal(&pool_pda()) - sol_reserve;
    let expected = (sol_reserve as u128) * (honk as u128) / (honk_reserve as u128 + honk as u128);
    assert_err!(e.sell(honk, expected as u64 + 1), HonkError::Slippage);
    assert_eq!(e.pool().honk_reserve, honk_reserve);
    unwrap_tx(e.sell(honk, expected as u64));
    assert_eq!(e.amount(&user), 0);
    assert_eq!(e.pool().honk_reserve, GENESIS);
    assert_eq!(e.amount(&vault_pda()), GENESIS);
    assert_eq!(e.pool().sol_reserve, sol_reserve - expected as u64);
    assert_eq!(e.bal(&pool_pda()), rent + e.pool().sol_reserve);
    assert_eq!(e.mint(&honk_mint_pda()).supply, supply);
}

#[test]
fn redeeming_the_lp_returns_both_reserves_and_leaves_the_rent() {
    let mut e = Env::new();
    assert!(e.withdraw(1, 0, 0).is_err());
    let supply = e.mint(&lp_mint_pda()).supply;
    let rent = e.bal(&pool_pda()) - e.pool().sol_reserve;
    e.warp(e.pool().unlock_at);
    unwrap_tx(e.release_lp());
    let half = supply / 2;
    let honk_half = (GENESIS as u128) * (half as u128) / (supply as u128);
    let sol_half = (10 * SOL as u128) * (half as u128) / (supply as u128);
    unwrap_tx(e.withdraw(half, honk_half as u64, sol_half as u64));
    let rest = e.amount(&ata(&e.payer.pubkey(), &lp_mint_pda()));
    unwrap_tx(e.withdraw(rest, 0, 0));
    assert_eq!(e.pool().honk_reserve, 0);
    assert_eq!(e.pool().sol_reserve, 0);
    assert_eq!(e.amount(&vault_pda()), 0);
    assert_eq!(e.amount(&ata(&e.payer.pubkey(), &honk_mint_pda())), GENESIS);
    assert_eq!(e.bal(&pool_pda()), rent);
    assert_eq!(e.mint(&lp_mint_pda()).supply, 0);
    assert_eq!(e.amount(&ata(&e.payer.pubkey(), &lp_mint_pda())), 0);
}

#[test]
fn release_lp_at_unlock_moves_the_locker_to_the_recipient() {
    let mut e = Env::new();
    let locked = e.amount(&lp_locker_pda());
    assert!(locked > 0);
    let at = e.pool().unlock_at;
    e.warp(at);
    assert_eq!(e.now(), at);
    let recipient = ata(&e.payer.pubkey(), &lp_mint_pda());
    unwrap_tx(e.release_lp());
    assert_eq!(e.amount(&recipient), locked);
    assert_eq!(e.amount(&lp_locker_pda()), 0);
}
