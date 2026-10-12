#[macro_use]
mod common;

use common::*;
use freightchain_pools::{
    error::PoolError,
    events::{PoolClosed, PrizePaid},
};
use solana_keypair::Keypair;
use solana_signer::Signer;

/// Active pool: `n` buyers x `qty` tickets. Returns (id, buyers).
fn active_pool(e: &mut Env, n: usize, qty: u16) -> (u32, Vec<Keypair>) {
    let id = e.create_pool(default_params().with_open());
    let mut v = vec![];
    for _ in 0..n {
        let b = funded(&mut e.svm, 20 * SOL);
        e.buy(id, &b, qty).unwrap();
        v.push(b);
    }
    assert_eq!(e.pool(id).status, 1);
    (id, v)
}

trait Open {
    fn with_open(self) -> Self;
}
impl Open for freightchain_pools::CreatePoolParams {
    fn with_open(mut self) -> Self {
        self.max_tickets = 0;
        self.max_per_wallet = 100;
        self.min_tickets = 2;
        self
    }
}

#[test]
fn pay_prize_authority_only_and_not_before_play_deadline() {
    let mut e = Env::new();
    let (id, _) = active_pool(&mut e, 2, 5); // 10 tickets, pot 1 SOL, prize share 0.6 SOL
    let winner = funded(&mut e.svm, SOL);
    let auth = e.authority_kp();
    e.record_verified_attestation(id, &auth, &winner.pubkey(), 100).unwrap();
    // before play_deadline
    e.warp(PLAY - 1);
    assert_err!(e.pay_prize(id, &auth, &winner.pubkey(), 1_000_000, 1), PoolError::TooEarly);
    e.warp(PLAY);
    // not the authority
    let stranger = funded(&mut e.svm, SOL);
    assert_err!(e.pay_prize(id, &stranger, &winner.pubkey(), 1_000_000, 1), PoolError::Unauthorized);
    // the authority, on time
    let w0 = e.bal(&winner.pubkey());
    let r = e.pay_prize(id, &auth, &winner.pubkey(), 1_000_000, 1).unwrap();
    assert_eq!(e.bal(&winner.pubkey()), w0 + 1_000_000);
    let ev = events::<PrizePaid>(&r.logs);
    assert_eq!((ev[0].pool_id, ev[0].to, ev[0].lamports, ev[0].rank), (id, winner.pubkey(), 1_000_000, 1));
    assert_eq!(e.pool(id).prizes_paid, 1_000_000);
    assert_err!(e.pay_prize(id, &auth, &winner.pubkey(), 0, 1), PoolError::InvalidParams);
}

#[test]
fn pay_prize_bounded_by_prize_share() {
    let mut e = Env::new();
    let (id, _) = active_pool(&mut e, 2, 5);
    let sp = funded(&mut e.svm, 10 * SOL);
    let i = e.sponsor_ix(id, &sp.pubkey(), 200_000_001);
    e.send(&[i], &sp, &[]).unwrap();
    // pot = 10 * 0.1 SOL + 200_000_001 = 1_200_000_001 ; prize 60% = 720_000_000 (floor of 720_000_000.6)
    let share = 720_000_000u64;
    assert_eq!(e.pool(id).prize_share_for_test(), share);
    let winner = funded(&mut e.svm, SOL);
    let auth = e.authority_kp();
    e.record_verified_attestation(id, &auth, &winner.pubkey(), 100).unwrap();
    e.warp(PLAY);
    assert_err!(e.pay_prize(id, &auth, &winner.pubkey(), share + 1, 1), PoolError::PrizeExceedsShare);
    e.pay_prize(id, &auth, &winner.pubkey(), share - 10, 1).unwrap();
    assert_err!(e.pay_prize(id, &auth, &winner.pubkey(), 11, 2), PoolError::PrizeExceedsShare);
    e.pay_prize(id, &auth, &winner.pubkey(), 10, 2).unwrap();
    assert_err!(e.pay_prize(id, &auth, &winner.pubkey(), 1, 3), PoolError::PrizeExceedsShare);
    assert_eq!(e.pool(id).prizes_paid, share);
}

trait Share {
    fn prize_share_for_test(&self) -> u64;
}
impl Share for freightchain_pools::Pool {
    fn prize_share_for_test(&self) -> u64 {
        self.prize_share().unwrap()
    }
}

#[test]
fn pay_prize_needs_active_pool_and_rent_exempt_receiver() {
    let mut e = Env::new();
    let id = e.create_pool(default_params()); // Open
    let auth = e.authority_kp();
    e.warp(PLAY);
    let w = funded(&mut e.svm, SOL);
    e.set_attestation(id, &w.pubkey(), 100, freightchain_pools::constants::ATTESTATION_STATUS_VERIFIED);
    assert_err!(e.pay_prize(id, &auth, &w.pubkey(), 1, 1), PoolError::PoolNotActive);

    let mut e = Env::new();
    let (id, _) = active_pool(&mut e, 2, 5);
    let auth = e.authority_kp();
    e.warp(PLAY);
    let fresh = Keypair::new(); // empty account: a payout below rent_min would be rejected by the runtime
    e.record_verified_attestation(id, &auth, &fresh.pubkey(), 100).unwrap();
    assert_err!(e.pay_prize(id, &auth, &fresh.pubkey(), e.rent_min() - 1, 1), PoolError::BelowRentMin);
    e.pay_prize(id, &auth, &fresh.pubkey(), e.rent_min(), 1).unwrap();
    // an already funded wallet may get less than the minimum
    let funded_w = funded(&mut e.svm, SOL);
    e.record_verified_attestation(id, &auth, &funded_w.pubkey(), 100).unwrap();
    e.pay_prize(id, &auth, &funded_w.pubkey(), 10, 2).unwrap();
}

/// Independent re-computation of the split (u128, floors, remainder to fee).
fn expected(total: u64, prize_bps: u64, seed_bps: u64, platform_bps: u64) -> (u64, u64, u64, u64) {
    let prize = (total as u128 * prize_bps as u128 / 10_000) as u64;
    let seed = (total as u128 * seed_bps as u128 / 10_000) as u64;
    let fee = total - prize - seed;
    let plat = (fee as u128 * platform_bps as u128 / 10_000) as u64;
    (prize, seed, fee - plat, plat)
}

#[test]
fn close_pool_splits_exactly_for_random_amounts() {
    let splits = [(6000u16, 2500u16, 1500u16), (5000, 3000, 2000), (7000, 0, 3000), (3333, 3333, 3334), (10_000, 0, 0)];
    let platform = [0u16, 1000, 2500];
    let mut rng = Rng(0xC0FFEE_1234_5678);
    for round in 0..6 {
        let (pb, sb, fb) = splits[round % splits.len()];
        let plat_bps = platform[round % platform.len()];
        let mut e = Env::with_platform_fee(plat_bps);
        let price = rng.range(1_000_000, 9_999_999);
        let id = e.create_pool(freightchain_pools::CreatePoolParams {
            price_lamports: price,
            prize_bps: pb,
            seed_bps: sb,
            fee_bps: fb,
            ..default_params().with_open()
        });
        let mut tickets = 0u64;
        for _ in 0..3 {
            let b = funded(&mut e.svm, 100 * SOL);
            let q = rng.range(1, 20) as u16;
            e.buy(id, &b, q).unwrap();
            tickets += q as u64;
        }
        let sponsored = if round % 2 == 0 { rng.range(1, 3 * SOL) } else { 0 };
        if sponsored > 0 {
            let sp = funded(&mut e.svm, 10 * SOL);
            let i = e.sponsor_ix(id, &sp.pubkey(), sponsored);
            e.send(&[i], &sp, &[]).unwrap();
        }
        let pot = tickets * price + sponsored;
        let (prize, seed, fee_out, plat) = expected(pot, pb as u64, sb as u64, plat_bps as u64);
        assert_eq!(e.pool(id).prize_share_for_test(), prize);
        assert_eq!(e.vault(id), e.rent_min() + pot);

        let auth = e.authority_kp();
        e.warp(PLAY);
        // pay a random part of the prize share out first
        let paid = if prize > 3 * e.rent_min() { rng.range(e.rent_min(), prize / 2) } else { 0 };
        if paid > 0 {
            let w = funded(&mut e.svm, SOL);
            e.record_verified_attestation(id, &auth, &w.pubkey(), 100).unwrap();
            e.pay_prize(id, &auth, &w.pubkey(), paid, 1).unwrap();
        }
        let unclaimed = prize - paid;

        // closing before the deadline / by a stranger is refused (checked in other tests); here: the split
        let (s0, f0, p0, a0) = (
            e.bal(&e.seed_t.pubkey()),
            e.bal(&e.fee_t.pubkey()),
            e.bal(&e.plat_t.pubkey()),
            e.bal(&auth.pubkey()),
        );
        let vault_before = e.vault(id);
        let r = e.close_pool(id, &auth).unwrap();
        let (ds, df, dp, da) = (
            e.bal(&e.seed_t.pubkey()) - s0,
            e.bal(&e.fee_t.pubkey()) - f0,
            e.bal(&e.plat_t.pubkey()) - p0,
            e.bal(&auth.pubkey()) - a0,
        );
        assert_eq!(ds, seed + unclaimed, "round {round}: seed treasury gets seed share + unclaimed prize");
        assert_eq!(df, fee_out, "round {round}: fee treasury");
        assert_eq!(dp, plat, "round {round}: platform cut");
        assert_eq!(da, e.rent_min(), "round {round}: vault rent back to the authority");
        assert_eq!(ds + df + dp + da, vault_before, "round {round}: outputs sum to the vault balance");
        assert_eq!(e.vault(id), 0, "round {round}: vault ends empty");
        assert_eq!(e.pool(id).status, 3);
        // pool-level conservation: prizes + seed + fees + platform = everything paid in
        assert_eq!(paid + (ds - unclaimed) + unclaimed + df + dp, pot);
        let ev = events::<PoolClosed>(&r.logs);
        assert_eq!(
            (ev[0].prize_paid, ev[0].seed, ev[0].fee, ev[0].platform_fee, ev[0].unclaimed),
            (paid, seed + unclaimed, fee_out, plat, unclaimed)
        );
        assert!(!ev[0].cancelled);
    }
}

#[test]
fn close_pool_guards() {
    let mut e = Env::new();
    let (id, _) = active_pool(&mut e, 2, 3);
    let auth = e.authority_kp();
    let stranger = funded(&mut e.svm, SOL);
    assert_err!(e.close_pool(id, &auth), PoolError::TooEarly);
    e.warp(PLAY);
    assert_err!(e.close_pool(id, &stranger), PoolError::Unauthorized);
    e.close_pool(id, &auth).unwrap();
    // already settled
    assert_err!(e.close_pool(id, &auth), PoolError::PoolNotActive);
    // an Open pool cannot be closed
    let id2 = e.create_pool(later(&e, default_params()));
    assert_err!(e.close_pool(id2, &auth), PoolError::PoolNotActive);
}

#[test]
fn close_pool_unclaimed_prize_and_stray_lamports_go_to_seed() {
    let mut e = Env::new();
    let (id, _) = active_pool(&mut e, 2, 5); // pot 1 SOL: prize 0.6, seed 0.25, fee 0.15
    // someone sends lamports straight to the vault
    let vault = vault_pda(id);
    let donor = funded(&mut e.svm, SOL);
    let i = solana_system_transfer(&donor.pubkey(), &vault, 12_345);
    e.send(&[i], &donor, &[]).unwrap();
    let auth = e.authority_kp();
    e.warp(PLAY);
    let s0 = e.bal(&e.seed_t.pubkey());
    e.close_pool(id, &auth).unwrap(); // no prize paid at all
    assert_eq!(e.bal(&e.seed_t.pubkey()) - s0, 250_000_000 + 600_000_000 + 12_345);
    assert_eq!(e.vault(id), 0);
}

fn solana_system_transfer(from: &anchor_lang::prelude::Pubkey, to: &anchor_lang::prelude::Pubkey, lamports: u64) -> anchor_lang::solana_program::instruction::Instruction {
    anchor_lang::solana_program::system_instruction::transfer(from, to, lamports)
}

#[test]
fn close_ticket_returns_rent_to_rent_payer() {
    let mut e = Env::new();
    let id = e.create_pool(default_params().with_open());
    let sponsor = funded(&mut e.svm, 5 * SOL);
    let b1 = funded(&mut e.svm, 20 * SOL);
    let b2 = funded(&mut e.svm, 20 * SOL);
    e.buy_sponsored(id, &b1, &sponsor, 1).unwrap(); // rent paid by the sponsor
    e.buy(id, &b2, 1).unwrap(); // rent paid by the buyer
    let auth = e.authority_kp();
    // not before the pool is settled
    assert_err!(e.close_ticket(id, &b1.pubkey(), &sponsor.pubkey()), PoolError::NotSettled);
    e.warp(PLAY);
    e.close_pool(id, &auth).unwrap();

    let r1 = e.bal(&ticket_pda(id, &b1.pubkey()));
    let r2 = e.bal(&ticket_pda(id, &b2.pubkey()));
    let (s0, b20) = (e.bal(&sponsor.pubkey()), e.bal(&b2.pubkey()));
    // the wrong rent receiver is refused
    assert_err!(e.close_ticket(id, &b1.pubkey(), &b1.pubkey()), PoolError::AccountMismatch);
    e.close_ticket(id, &b1.pubkey(), &sponsor.pubkey()).unwrap();
    e.close_ticket(id, &b2.pubkey(), &b2.pubkey()).unwrap();
    assert_eq!(e.bal(&sponsor.pubkey()), s0 + r1);
    assert_eq!(e.bal(&b2.pubkey()), b20 + r2);
    assert!(e.ticket(id, &b1.pubkey()).is_none() && e.ticket(id, &b2.pubkey()).is_none());
}

/// MathOverflow: the checked maths answers instead of wrapping. No instruction can write such a pool (the vault would have to hold more than a u64 of
/// lamports; play_deadline is capped at now + MAX_POOL_SECS), so the Pool account is forged in place – the guard is what is under test.
#[test]
fn checked_maths_refuse_overflow_instead_of_wrapping() {
    let mut e = Env::new();
    let (id, _) = active_pool(&mut e, 2, 1); // 2 tickets
    let auth = e.authority_kp();
    let forge = |e: &mut Env, f: &dyn Fn(&mut freightchain_pools::Pool)| {
        let mut acct = e.svm.get_account(&pool_pda(id)).unwrap();
        let mut p = e.pool(id);
        f(&mut p);
        let mut data = Vec::new();
        anchor_lang::AccountSerialize::try_serialize(&p, &mut data).unwrap();
        acct.data[..data.len()].copy_from_slice(&data);
        e.svm.set_account(pool_pda(id), acct).unwrap();
    };
    e.warp(PLAY);
    let w = funded(&mut e.svm, SOL);
    e.record_verified_attestation(id, &auth, &w.pubkey(), 100).unwrap();
    let (price, vault) = (e.pool(id).price_lamports, e.vault(id));
    // price × tickets_sold past u64: the prize cap of pay_prize and the split of close_pool
    forge(&mut e, &|p| p.price_lamports = u64::MAX / 2 + 1);
    assert_err!(e.pay_prize(id, &auth, &w.pubkey(), 1_000_000, 1), PoolError::MathOverflow);
    assert_err!(e.close_pool(id, &auth), PoolError::MathOverflow);
    // tickets + sponsored past u64
    forge(&mut e, &|p| {
        p.price_lamports = price;
        p.sponsored = u64::MAX;
    });
    assert_err!(e.close_pool(id, &auth), PoolError::MathOverflow);
    // payout_at + SETTLE_GRACE_SECS past i64 (the grace is computed before the caller is checked)
    forge(&mut e, &|p| {
        p.sponsored = 0;
        p.play_deadline = i64::MAX - 10;
        p.payout_at = i64::MAX - 10;
    });
    e.warp(i64::MAX - 5);
    let stranger = funded(&mut e.svm, SOL);
    assert_err!(e.close_pool(id, &stranger), PoolError::MathOverflow);
    // nothing moved, the pool is still live
    assert_eq!((e.vault(id), e.pool(id).status, e.pool(id).prizes_paid), (vault, 1, 0));
}

#[test]
fn pay_prize_strictly_requires_verified_attestation() {
    let mut e = Env::new();
    let (id, _) = active_pool(&mut e, 2, 5); // 10 tickets, pot 1 SOL
    let (id2, _) = active_pool(&mut e, 2, 5); // second pool for cross-pool tests
    let winner = funded(&mut e.svm, SOL);
    let other_driver = funded(&mut e.svm, SOL);
    let auth = e.authority_kp();
    e.warp(PLAY);

    // 0. Missing attestation PDA: winner has no attestation account initialized on-chain
    assert!(
        e.pay_prize(id, &auth, &winner.pubkey(), 100_000, 1).is_err(),
        "pay_prize must fail when attestation account does not exist"
    );
    // Passing an arbitrary existing account (e.g. config PDA) as attestation fails
    assert!(
        e.pay_prize_with_attestation(id, &auth, &winner.pubkey(), config_pda(), 100_000, 1).is_err(),
        "pay_prize must fail when arbitrary account is passed as attestation"
    );

    // 1. Unverified attestation (status = 0)
    e.record_attestation(
        id,
        &auth,
        &winner.pubkey(),
        [1u8; 32],
        100,
        freightchain_pools::constants::ATTESTATION_STATUS_UNVERIFIED,
    )
    .unwrap();
    assert_err!(
        e.pay_prize(id, &auth, &winner.pubkey(), 100_000, 1),
        PoolError::UnverifiedAttestation
    );

    // 2. Flagged attestation (status = 2)
    e.record_attestation(
        id,
        &auth,
        &winner.pubkey(),
        [1u8; 32],
        100,
        freightchain_pools::constants::ATTESTATION_STATUS_FLAGGED,
    )
    .unwrap();
    assert_err!(
        e.pay_prize(id, &auth, &winner.pubkey(), 100_000, 1),
        PoolError::UnverifiedAttestation
    );

    // 3. Status = VERIFIED (1), but verified_km = 0: rejected by record_attestation
    assert_err!(
        e.record_attestation(
            id,
            &auth,
            &winner.pubkey(),
            [1u8; 32],
            0,
            freightchain_pools::constants::ATTESTATION_STATUS_VERIFIED,
        ),
        PoolError::ZeroVerifiedKm
    );
    // Defense-in-depth: pay_prize also rejects attestation with verified_km == 0
    e.set_attestation(
        id,
        &winner.pubkey(),
        0,
        freightchain_pools::constants::ATTESTATION_STATUS_VERIFIED,
    );
    assert_err!(
        e.pay_prize(id, &auth, &winner.pubkey(), 100_000, 1),
        PoolError::ZeroVerifiedKm
    );

    // 4. Attestation mismatch: attestation is for other_driver, but pay_prize called for winner
    e.record_verified_attestation(id, &auth, &other_driver.pubkey(), 100).unwrap();
    let other_att = attestation_pda(id, &other_driver.pubkey());
    assert!(
        e.pay_prize_with_attestation(id, &auth, &winner.pubkey(), other_att, 100_000, 1)
            .is_err()
    );

    // Cross-pool attestation reuse rejected: attestation for winner in id2 passed to pay_prize in id
    e.record_verified_attestation(id2, &auth, &winner.pubkey(), 100).unwrap();
    let id2_att = attestation_pda(id2, &winner.pubkey());
    assert!(
        e.pay_prize_with_attestation(id, &auth, &winner.pubkey(), id2_att, 100_000, 1)
            .is_err(),
        "attestation for a different pool must be rejected"
    );

    // Invalid status (e.g. status 255) rejected
    e.set_attestation(id, &winner.pubkey(), 100, 255);
    assert_err!(
        e.pay_prize(id, &auth, &winner.pubkey(), 100_000, 1),
        PoolError::UnverifiedAttestation
    );

    // 5. Valid verified attestation: status == VERIFIED, verified_km > 0
    e.record_verified_attestation(id, &auth, &winner.pubkey(), 100).unwrap();
    let w0 = e.bal(&winner.pubkey());
    let r = e.pay_prize(id, &auth, &winner.pubkey(), 100_000, 1).unwrap();
    assert_eq!(e.bal(&winner.pubkey()), w0 + 100_000);
    let ev = events::<PrizePaid>(&r.logs);
    assert_eq!(ev[0].lamports, 100_000);
    assert_eq!(e.pool(id).prizes_paid, 100_000);
}

#[test]
fn adversarial_pay_prize_deep_stress_matrix() {
    let mut e = Env::new();
    let (id, _) = active_pool(&mut e, 2, 5); // 10 tickets, pot 1 SOL
    let (id_other, _) = active_pool(&mut e, 2, 5); // second pool
    let auth = e.authority_kp();
    let driver_a = funded(&mut e.svm, SOL);
    let driver_b = funded(&mut e.svm, SOL);
    let driver_c = funded(&mut e.svm, SOL);

    e.warp(PLAY);

    // =========================================================================
    // Vector 1: Missing Attestation PDA Attacks
    // =========================================================================
    // 1.1: Driver A has never had an attestation recorded
    assert!(
        e.pay_prize(id, &auth, &driver_a.pubkey(), 50_000, 1).is_err(),
        "Must fail when attestation account does not exist"
    );
    // 1.2: Supplying config PDA as attestation
    assert!(
        e.pay_prize_with_attestation(id, &auth, &driver_a.pubkey(), config_pda(), 50_000, 1).is_err(),
        "Must fail when config PDA is supplied as attestation"
    );
    // 1.3: Supplying pool PDA as attestation
    assert!(
        e.pay_prize_with_attestation(id, &auth, &driver_a.pubkey(), pool_pda(id), 50_000, 1).is_err(),
        "Must fail when pool PDA is supplied as attestation"
    );
    // 1.4: Supplying vault PDA as attestation
    assert!(
        e.pay_prize_with_attestation(id, &auth, &driver_a.pubkey(), vault_pda(id), 50_000, 1).is_err(),
        "Must fail when vault PDA is supplied as attestation"
    );
    // 1.5: Supplying system program as attestation
    assert!(
        e.pay_prize_with_attestation(id, &auth, &driver_a.pubkey(), anchor_lang::solana_program::system_program::ID, 50_000, 1).is_err(),
        "Must fail when system program is supplied as attestation"
    );

    // =========================================================================
    // Vector 2: Unverified Attestation (status == 0)
    // =========================================================================
    // 2.1: Attestation recorded with status = UNVERIFIED (0)
    e.record_attestation(
        id,
        &auth,
        &driver_a.pubkey(),
        [0xAA; 32],
        120,
        freightchain_pools::constants::ATTESTATION_STATUS_UNVERIFIED,
    ).unwrap();
    assert_err!(
        e.pay_prize(id, &auth, &driver_a.pubkey(), 50_000, 1),
        PoolError::UnverifiedAttestation
    );

    // =========================================================================
    // Vector 3: Flagged Attestation (status == 2)
    // =========================================================================
    // 3.1: Attestation recorded with status = FLAGGED (2)
    e.record_attestation(
        id,
        &auth,
        &driver_b.pubkey(),
        [0xBB; 32],
        250,
        freightchain_pools::constants::ATTESTATION_STATUS_FLAGGED,
    ).unwrap();
    assert_err!(
        e.pay_prize(id, &auth, &driver_b.pubkey(), 50_000, 1),
        PoolError::UnverifiedAttestation
    );

    // =========================================================================
    // Vector 4: Driver Mismatch Attacks
    // =========================================================================
    // Driver C gets a legitimate VERIFIED attestation with 300 km
    e.record_verified_attestation(id, &auth, &driver_c.pubkey(), 300).unwrap();
    let att_c = attestation_pda(id, &driver_c.pubkey());

    // 4.1: Authority attempts to pay Driver A (who is unverified) using Driver C's attestation
    assert!(
        e.pay_prize_with_attestation(id, &auth, &driver_a.pubkey(), att_c, 50_000, 1).is_err(),
        "Must reject payout to Driver A using Driver C's attestation PDA"
    );

    // 4.2: Authority attempts to pay Driver B (who is flagged) using Driver C's attestation
    assert!(
        e.pay_prize_with_attestation(id, &auth, &driver_b.pubkey(), att_c, 50_000, 1).is_err(),
        "Must reject payout to Driver B using Driver C's attestation PDA"
    );

    // 4.3: Cross-pool replay attack: Driver C has verified attestation in id_other, attempt to pay in id
    e.record_verified_attestation(id_other, &auth, &driver_c.pubkey(), 300).unwrap();
    let att_c_other = attestation_pda(id_other, &driver_c.pubkey());
    assert!(
        e.pay_prize_with_attestation(id, &auth, &driver_c.pubkey(), att_c_other, 50_000, 1).is_err(),
        "Must reject replay of attestation from a different pool"
    );

    // =========================================================================
    // Vector 5: Zero Verified Km Attacks
    // =========================================================================
    let driver_d = funded(&mut e.svm, SOL);
    // 5.1: Attempting to record verified attestation with 0 km is refused
    assert_err!(
        e.record_attestation(
            id,
            &auth,
            &driver_d.pubkey(),
            [0xDD; 32],
            0,
            freightchain_pools::constants::ATTESTATION_STATUS_VERIFIED,
        ),
        PoolError::ZeroVerifiedKm
    );
    // 5.2: State-injection attack: forcibly set attestation state to verified with 0 km
    e.set_attestation(
        id,
        &driver_d.pubkey(),
        0,
        freightchain_pools::constants::ATTESTATION_STATUS_VERIFIED,
    );
    assert_err!(
        e.pay_prize(id, &auth, &driver_d.pubkey(), 50_000, 1),
        PoolError::ZeroVerifiedKm
    );

    // =========================================================================
    // Vector 6: Legitimate Payout Verification
    // =========================================================================
    let bal_c_before = e.bal(&driver_c.pubkey());
    let r = e.pay_prize(id, &auth, &driver_c.pubkey(), 50_000, 1).unwrap();
    assert_eq!(e.bal(&driver_c.pubkey()), bal_c_before + 50_000);
    assert_eq!(e.pool(id).prizes_paid, 50_000);
    let ev = events::<PrizePaid>(&r.logs);
    assert_eq!(ev[0].to, driver_c.pubkey());
    assert_eq!(ev[0].lamports, 50_000);
    assert_eq!(ev[0].rank, 1);
}


