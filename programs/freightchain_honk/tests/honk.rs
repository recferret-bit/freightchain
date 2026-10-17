#[macro_use]
mod common;

use {
    anchor_lang::solana_program::{
        instruction::AccountMeta, instruction::Instruction, system_program,
    },
    anchor_spl::{associated_token, token},
    common::*,
    anchor_lang::prelude::Pubkey,
    freightchain_honk::{
        airdrop_leaf, error::HonkError, events::HonkInitialized, isqrt, merkle_root_from, pad8,
        AIRDROP, AIRDROP_WALLET_CAP, AIRDROP_WINDOW_SECS, EMISSION_CAP, LIQUIDITY, MAX_SUPPLY,
        MONTH_SECS, REFERRAL, REFERRAL_ERA_SIZE, TEAM, TOKEN_SYMBOL, TREASURY, UNIT,
    },
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
fn genesis_supply_is_preminted_and_the_mint_authority_is_none() {
    let e = Env::new();
    let mint = e.mint(&honk_mint_pda());
    assert_eq!(mint.supply, MAX_SUPPLY);
    assert_eq!(mint.decimals, 6);
    assert!(mint.mint_authority.is_none());
    assert!(mint.freeze_authority.is_none());
    let lp = e.mint(&lp_mint_pda());
    assert!(lp.mint_authority.is_none());
    assert!(lp.freeze_authority.is_none());
    assert_eq!(lp.supply, 0);
    assert_eq!(e.amount(&vault_pda()), LIQUIDITY);
    assert_eq!(e.amount(&emission_pda()), EMISSION_CAP);
    assert_eq!(e.amount(&airdrop_pda()), AIRDROP);
    assert_eq!(e.amount(&referral_pda()), REFERRAL);
    assert_eq!(e.amount(&treasury_pda()), TREASURY);
    assert_eq!(e.amount(&team_pda()), TEAM);
    assert_eq!(e.amount(&lp_locker_pda()), 0);
    assert_eq!(e.config().symbol, pad8(TOKEN_SYMBOL));
    assert_eq!(e.config().name, pad8(b"TEN4"));
}

#[test]
fn pool_sol_reserve_is_the_sol_in() {
    let e = Env::new();
    assert_eq!(e.pool().sol_reserve, OPENING);
    let data_len = e.svm.get_account(&pool_pda()).unwrap().data.len();
    let rent = e.svm.minimum_balance_for_rent_exemption(data_len);
    assert_eq!(e.bal(&pool_pda()), rent + OPENING);
}

#[test]
fn lp_is_burned_at_initialize_and_stays_burned() {
    let mut e = Env::new();
    let n = (LIQUIDITY as u128) * (OPENING as u128);
    let root = isqrt(n);
    assert!(root * root <= n && (root + 1) * (root + 1) > n);
    assert!(root > 0);
    assert_eq!(e.mint(&lp_mint_pda()).supply, 0);
    assert_eq!(e.amount(&lp_locker_pda()), 0);
    let honk = e.pool().honk_reserve;
    let sol = e.pool().sol_reserve;
    e.warp(e.now() + 10 * 365 * 86_400);
    assert_eq!(e.pool().honk_reserve, honk);
    assert_eq!(e.pool().sol_reserve, sol);
    assert_eq!(e.amount(&vault_pda()), LIQUIDITY);
}

#[test]
fn initialize_emits_supply_sol_and_lp() {
    let mut e = Env::bare();
    let meta = unwrap_tx(e.initialize(OPENING));
    let ev = events::<HonkInitialized>(&meta.logs);
    assert_eq!(ev.len(), 1);
    assert_eq!(ev[0].supply, MAX_SUPPLY);
    assert_eq!(ev[0].sol_in, OPENING);
    assert!(ev[0].lp_burned > 0);
    assert!(ev[0].team_enabled);
    assert_eq!(&ev[0].symbol[..4], TOKEN_SYMBOL);
}

#[test]
fn a_second_initialize_fails() {
    let mut e = Env::new();
    assert!(e.initialize(OPENING).is_err());
}

#[test]
fn initialize_zero_sol_is_zero_amount() {
    let mut e = Env::bare();
    assert_err!(e.initialize(0), HonkError::ZeroAmount);
}

#[test]
fn initialize_refuses_anything_but_the_opening_deposit() {
    for sol_in in [1, SOL, 10 * SOL, OPENING - 1, OPENING + 1] {
        let mut e = Env::bare();
        assert_err!(e.initialize(sol_in), HonkError::ZeroAmount);
    }
}

#[test]
fn initialize_requires_the_upgrade_authority() {
    let mut e = Env::bare();
    let other = Keypair::new();
    set_upgrade_authority(&mut e.svm, &other.pubkey());
    assert_err!(e.initialize(OPENING), HonkError::BadAuthority);
}

#[test]
fn swap_of_one_sol_pays_the_constant_product_and_the_vault_falls() {
    let mut e = Env::new();
    let honk_reserve = e.pool().honk_reserve;
    let sol_reserve = e.pool().sol_reserve;
    let vault_before = e.amount(&vault_pda());
    let sol_in = SOL;
    let net = (sol_in as u128) * 9_975 / 10_000;
    let expected = (honk_reserve as u128) * net / ((sol_reserve as u128) + net);
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
    let net = (sol_in as u128) * 9_975 / 10_000;
    let expected = (honk_reserve as u128) * net / ((sol_reserve as u128) + net);
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
fn a_verified_ride_pays_the_schedule_from_the_emission_vault() {
    let mut e = Env::new();
    let rider = Keypair::new();
    let vault = e.amount(&vault_pda());
    let emission = e.amount(&emission_pda());
    let supply = e.mint(&honk_mint_pda()).supply;
    let ride = [7u8; 16];
    unwrap_tx(e.mint_ride(ride, 1, 0b111, &rider.pubkey()));
    assert_eq!(e.amount(&vault_pda()), vault);
    assert_eq!(e.mint(&honk_mint_pda()).supply, supply);
    assert_eq!(e.amount(&emission_pda()), emission - 100 * UNIT);
    assert_eq!(e.amount(&ata(&rider.pubkey(), &honk_mint_pda())), 100 * UNIT);
    assert_eq!(e.config().emitted, 100 * UNIT);
    assert!(e.mint_ride(ride, 1, 0b111, &rider.pubkey()).is_err());
    assert_err!(e.mint_ride([8u8; 16], 9, 0b111, &rider.pubkey()), HonkError::BadTier);
    unwrap_tx(e.mint_ride([9u8; 16], 8, 0b111, &rider.pubkey()));
    assert_eq!(e.amount(&ata(&rider.pubkey(), &honk_mint_pda())), 1_300 * UNIT);
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
fn selling_the_honk_back_keeps_the_fee_in_the_pool() {
    let mut e = Env::new();
    unwrap_tx(e.swap(SOL, 0));
    let user = ata(&e.payer.pubkey(), &honk_mint_pda());
    let honk = e.amount(&user);
    let supply = e.mint(&honk_mint_pda()).supply;
    let honk_reserve = e.pool().honk_reserve;
    let sol_reserve = e.pool().sol_reserve;
    let rent = e.bal(&pool_pda()) - sol_reserve;
    let net = (honk as u128) * 9_975 / 10_000;
    let expected = (sol_reserve as u128) * net / ((honk_reserve as u128) + net);
    assert_err!(e.sell(honk, expected as u64 + 1), HonkError::Slippage);
    assert_eq!(e.pool().honk_reserve, honk_reserve);
    unwrap_tx(e.sell(honk, expected as u64));
    assert_eq!(e.amount(&user), 0);
    assert_eq!(e.pool().honk_reserve, honk_reserve + honk);
    assert_eq!(e.amount(&vault_pda()), e.pool().honk_reserve);
    assert_eq!(e.pool().sol_reserve, sol_reserve - expected as u64);
    assert!(e.pool().sol_reserve > OPENING);
    assert_eq!(e.bal(&pool_pda()), rent + e.pool().sol_reserve);
    assert_eq!(e.mint(&honk_mint_pda()).supply, supply);
}

#[test]
fn initialize_requires_team_enabled_and_twenty_four_month_linear_vest() {
    let mut e = Env::bare();
    let payer = e.payer.pubkey();
    assert_err!(
        e.initialize_opts(OPENING, payer, payer, Pubkey::default(), false, 0),
        HonkError::TeamDisabled
    );
    assert_err!(
        e.initialize_opts(OPENING, payer, payer, payer, true, 36),
        HonkError::BadVest
    );
    assert_err!(
        e.initialize_opts(OPENING, payer, payer, Pubkey::default(), true, 24),
        HonkError::BadAuthority
    );
}

#[test]
fn a_wallet_stops_at_two_thousand_a_day() {
    let mut e = Env::new();
    let a = Keypair::new().pubkey();
    let b = Keypair::new().pubkey();
    unwrap_tx(e.mint_ride([1u8; 16], 8, 0b111, &a));
    assert_eq!(e.amount(&ata(&a, &honk_mint_pda())), 1_200 * UNIT);
    unwrap_tx(e.mint_ride([2u8; 16], 8, 0b111, &a));
    assert_eq!(e.amount(&ata(&a, &honk_mint_pda())), 2_000 * UNIT);
    assert_err!(e.mint_ride([3u8; 16], 8, 0b111, &a), HonkError::WalletCap);
    unwrap_tx(e.mint_ride([4u8; 16], 8, 0b111, &b));
    assert_eq!(e.amount(&ata(&b, &honk_mint_pda())), 1_200 * UNIT);
}

#[test]
fn a_day_that_is_not_today_is_rejected() {
    let mut e = Env::new();
    let rider = Keypair::new().pubkey();
    let payer = e.payer();
    let day = day_index(e.now()) + 1;
    assert_err!(
        e.mint_ride_signed([5u8; 16], 1, 0b111, &rider, &payer, day),
        HonkError::BadDay
    );
}

#[test]
fn a_stranger_cannot_mint_a_ride() {
    let mut e = Env::new();
    let stranger = funded(&mut e.svm, SOL);
    let rider = Keypair::new().pubkey();
    let day = day_index(e.now());
    assert!(e.mint_ride_signed([6u8; 16], 1, 0b111, &rider, &stranger, day).is_err());
}

#[test]
fn treasury_pays_nothing_at_open_and_half_after_eighteen_months() {
    let mut e = Env::new();
    let treasury = e.config().treasury;
    assert_err!(e.claim_treasury(), HonkError::TooEarly);
    e.warp(e.config().opened_at + 18 * MONTH_SECS);
    unwrap_tx(e.claim_treasury());
    assert_eq!(e.amount(&ata(&treasury, &honk_mint_pda())), TREASURY / 2);
    assert_eq!(e.amount(&treasury_pda()), TREASURY / 2);
    e.warp(e.config().opened_at + 36 * MONTH_SECS);
    unwrap_tx(e.claim_treasury());
    assert_eq!(e.amount(&ata(&treasury, &honk_mint_pda())), TREASURY);
    assert_eq!(e.amount(&treasury_pda()), 0);
}

#[test]
fn the_team_cannot_claim_before_the_cliff() {
    let mut e = Env::new();
    let team = e.config().team_recipient;
    assert_err!(e.claim_team(), HonkError::TooEarly);
    e.warp(e.config().opened_at + 12 * MONTH_SECS - 1);
    assert_err!(e.claim_team(), HonkError::TooEarly);
    e.warp(e.config().opened_at + 12 * MONTH_SECS + 12 * MONTH_SECS);
    unwrap_tx(e.claim_team());
    assert_eq!(e.amount(&ata(&team, &honk_mint_pda())), TEAM / 2);
    assert_eq!(e.amount(&team_pda()), TEAM / 2);
    e.warp(e.config().opened_at + 12 * MONTH_SECS + 24 * MONTH_SECS);
    unwrap_tx(e.claim_team());
    assert_eq!(e.amount(&ata(&team, &honk_mint_pda())), TEAM);
    assert_eq!(e.amount(&team_pda()), 0);
}

#[test]
fn pay_referral_pays_from_referral_vault_and_enforces_monthly_caps() {
    let mut e = Env::new();
    let referrer = Keypair::new().pubkey();
    let ref_vault_before = e.amount(&referral_pda());
    let reward_m1 = [11u8; 16];
    let reward_m2 = [12u8; 16];
    unwrap_tx(e.pay_referral(reward_m1, 100 * UNIT, &referrer));
    assert_eq!(e.amount(&ata(&referrer, &honk_mint_pda())), 100 * UNIT);
    assert_eq!(e.amount(&referral_pda()), ref_vault_before - 100 * UNIT);
    assert!(e.pay_referral(reward_m1, 100 * UNIT, &referrer).is_err());

    unwrap_tx(e.pay_referral(reward_m2, 950 * UNIT, &referrer));
    assert_eq!(e.amount(&ata(&referrer, &honk_mint_pda())), 1_000 * UNIT);
    assert_err!(
        e.pay_referral([13u8; 16], 50 * UNIT, &referrer),
        HonkError::WalletCap
    );

    let payer = e.payer();
    assert_err!(
        e.pay_referral_signed([14u8; 16], 50 * UNIT, &referrer, &payer, 1),
        HonkError::BadMonth
    );

    e.warp(e.config().opened_at + MONTH_SECS);
    unwrap_tx(e.pay_referral([15u8; 16], 100 * UNIT, &referrer));
    assert_eq!(e.amount(&ata(&referrer, &honk_mint_pda())), 1_100 * UNIT);
}

#[test]
fn burn_referral_tail_requires_era_eight_and_burns_remaining_vault() {
    let mut e = Env::new();
    assert_err!(e.burn_referral_tail(), HonkError::TooEarly);

    let mut cfg = e.config();
    cfg.referral_emitted = REFERRAL - (REFERRAL_ERA_SIZE >> 7);
    let mut acc = e.svm.get_account(&config_pda()).unwrap();
    let mut data = Vec::with_capacity(acc.data.len());
    data.extend_from_slice(&acc.data[..8]);
    anchor_lang::AnchorSerialize::serialize(&cfg, &mut data).unwrap();
    acc.data = data;
    e.svm.set_account(config_pda(), acc).unwrap();

    let supply_before = e.mint(&honk_mint_pda()).supply;
    let vault_before = e.amount(&referral_pda());
    unwrap_tx(e.burn_referral_tail());
    assert_eq!(e.amount(&referral_pda()), 0);
    assert_eq!(e.mint(&honk_mint_pda()).supply, supply_before - vault_before);
    assert_eq!(e.config().referral_emitted, REFERRAL);
}

#[test]
fn merkle_airdrop_claims_receipt_enforces_wallet_cap_and_burns_unclaimed_after_90_days() {
    let mut e = Env::new();
    let w1 = Keypair::new().pubkey();
    let w2 = Keypair::new().pubkey();
    let a1 = 1_500 * UNIT;
    let a2 = 500 * UNIT;
    let l1 = airdrop_leaf(1, &w1, a1);
    let l2 = airdrop_leaf(1, &w2, a2);
    let root = merkle_root_from(l1, &[l2]);
    let allocation = 2_000_000 * UNIT;

    unwrap_tx(e.set_airdrop_root(1, root, allocation));
    assert_err!(e.burn_unclaimed(1), HonkError::TooEarly);
    assert_err!(
        e.claim_airdrop(1, &w1, a1, vec![[9u8; 32]]),
        HonkError::BadMerkleProof
    );

    let airdrop_before = e.amount(&airdrop_pda());
    unwrap_tx(e.claim_airdrop(1, &w1, a1, vec![l2]));
    assert_eq!(e.amount(&ata(&w1, &honk_mint_pda())), a1);
    assert_eq!(e.amount(&airdrop_pda()), airdrop_before - a1);
    assert!(e.claim_airdrop(1, &w1, a1, vec![l2]).is_err());

    let l1_c2 = airdrop_leaf(2, &w1, 600 * UNIT);
    let root_c2 = merkle_root_from(l1_c2, &[]);
    unwrap_tx(e.set_airdrop_root(2, root_c2, 1_000_000 * UNIT));
    assert_err!(
        e.claim_airdrop(2, &w1, 600 * UNIT, vec![]),
        HonkError::WalletCap
    );
    assert_eq!(AIRDROP_WALLET_CAP, 2_000 * UNIT);

    let supply_before = e.mint(&honk_mint_pda()).supply;
    e.warp(e.now() + AIRDROP_WINDOW_SECS);
    assert_err!(
        e.claim_airdrop(1, &w2, a2, vec![l1]),
        HonkError::AirdropClosed
    );
    unwrap_tx(e.burn_unclaimed(1));
    let unclaimed = allocation - a1;
    assert_eq!(e.mint(&honk_mint_pda()).supply, supply_before - unclaimed);
}
