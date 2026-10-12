#[macro_use]
mod common;

use common::*;
use freightchain_pools::{
    constants::*,
    error::PoolError,
    events::{PledgeCreated, PledgeRefunded, PledgeSettled},
};
use litesvm::types::TransactionMetadata;
use solana_keypair::Keypair;
use anchor_lang::prelude::Pubkey;
use solana_signer::Signer;

/// What a successful settle_pledge moved: the pledge account is closed, so its whole balance (cap + rent) leaves it.
struct Settled {
    r: TransactionMetadata,
    /// driver's balance gain
    earned: u64,
    /// sponsor's balance gain (refund + the pledge account's rent)
    back: u64,
    /// the pledge account's rent (its balance before settle minus the cap)
    rent: u64,
}

/// settle_pledge by a third-party caller, with the zero-stranded check: driver + sponsor gains == the pledge's balance, which ends at 0.
fn settle_measured(e: &mut Env, id: u32, ride_id: [u8; 32], caller: &Keypair, driver: &Pubkey, sponsor: &Pubkey, max: u64) -> Settled {
    let pda = pledge_pda(&ride_id, sponsor);
    let before = e.bal(&pda);
    let (d0, s0) = (e.bal(driver), e.bal(sponsor));
    let r = e.settle_pledge(id, ride_id, caller, driver, sponsor).unwrap();
    assert!(e.pledge(&ride_id, sponsor).is_none(), "settle closes the pledge account");
    assert_eq!(e.bal(&pda), 0);
    let (earned, back) = (e.bal(driver) - d0, e.bal(sponsor) - s0);
    assert_eq!(earned + back, before, "zero stranded lamports");
    Settled { r, earned, back, rent: before - max }
}

/// Anchor's AccountNotInitialized: the pledge account is gone (settled or refunded).
fn assert_closed_err(res: Res) {
    let e = res.expect_err("expected the closed pledge to be refused");
    assert!(format!("{:?}", e.err).contains("Custom(3012)"), "expected AccountNotInitialized, got {:?} | {:?}", e.err, e.meta.logs);
}

fn active_pool(e: &mut Env) -> u32 {
    let id = e.create_pool(default_params().with_open());
    let b = funded(&mut e.svm, 20 * SOL);
    e.buy(id, &b, 5).unwrap();
    assert_eq!(e.pool(id).status, STATUS_ACTIVE);
    id
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
fn create_pledge_happy_path() {
    let mut e = Env::new();
    let id = active_pool(&mut e);
    let driver = funded(&mut e.svm, SOL);
    let sponsor = funded(&mut e.svm, 5 * SOL);
    let ride_id = [42u8; 32];
    let target_km = 100u32;
    let rate = 10_000u64;
    let max = rate * (target_km as u64); // 1_000_000

    let s0 = e.bal(&sponsor.pubkey());
    let r = e
        .create_pledge(id, ride_id, &driver.pubkey(), &sponsor, max, rate, target_km)
        .unwrap();

    let pda = pledge_pda(&ride_id, &sponsor.pubkey());
    let p = e.pledge(&ride_id, &sponsor.pubkey()).expect("pledge account exists");
    assert_eq!(p.ride_id, ride_id);
    assert_eq!(p.sponsor, sponsor.pubkey());
    assert_eq!(p.driver, driver.pubkey());
    assert_eq!(p.pool, pool_pda(id));
    assert_eq!(p.max_lamports, max);
    assert_eq!(p.lamports_per_km, rate);
    assert_eq!(p.target_km, target_km);
    assert!(!p.settled);
    assert_eq!(p.earned_lamports, 0);
    assert_eq!(p.refunded_lamports, 0);

    // Sponsor paid max_lamports + rent for pledge account
    let s_after = e.bal(&sponsor.pubkey());
    assert!(s0 - s_after >= max);
    assert!(e.bal(&pda) >= max);

    let evs = events::<PledgeCreated>(&r.logs);
    assert_eq!(evs.len(), 1);
    assert_eq!(evs[0].ride_id, ride_id);
    assert_eq!(evs[0].sponsor, sponsor.pubkey());
    assert_eq!(evs[0].driver, driver.pubkey());
    assert_eq!(evs[0].max_lamports, max);
    assert_eq!(evs[0].lamports_per_km, rate);
    assert_eq!(evs[0].target_km, target_km);
}

#[test]
fn create_pledge_invalid_params() {
    let mut e = Env::new();
    let id = active_pool(&mut e);
    let driver = funded(&mut e.svm, SOL);
    let sponsor = funded(&mut e.svm, 5 * SOL);
    let ride_id = [43u8; 32];

    // max_lamports == 0
    assert_err!(
        e.create_pledge(id, ride_id, &driver.pubkey(), &sponsor, 0, 10_000, 100),
        PoolError::InvalidParams
    );

    // lamports_per_km == 0
    assert_err!(
        e.create_pledge(id, ride_id, &driver.pubkey(), &sponsor, 1_000_000, 0, 100),
        PoolError::InvalidParams
    );

    // target_km == 0
    assert_err!(
        e.create_pledge(id, ride_id, &driver.pubkey(), &sponsor, 1_000_000, 10_000, 0),
        PoolError::InvalidParams
    );

    // max_lamports != rate * target_km
    assert_err!(
        e.create_pledge(id, ride_id, &driver.pubkey(), &sponsor, 999_999, 10_000, 100),
        PoolError::InvalidParams
    );
    assert_err!(
        e.create_pledge(id, ride_id, &driver.pubkey(), &sponsor, 1_000_001, 10_000, 100),
        PoolError::InvalidParams
    );

    // sponsor == driver
    assert_err!(
        e.create_pledge(id, ride_id, &sponsor.pubkey(), &sponsor, 1_000_000, 10_000, 100),
        PoolError::InvalidParams
    );
}

#[test]
fn create_pledge_refused_after_play_deadline() {
    let mut e = Env::new();
    let id = active_pool(&mut e);
    let driver = funded(&mut e.svm, SOL);
    let sponsor = funded(&mut e.svm, 5 * SOL);
    e.warp(PLAY - 1);
    e.create_pledge(id, [44u8; 32], &driver.pubkey(), &sponsor, 1_000, 10, 100).unwrap();
    e.warp(PLAY);
    assert_err!(e.create_pledge(id, [45u8; 32], &driver.pubkey(), &sponsor, 1_000, 10, 100), PoolError::TooLate);
}

#[test]
fn settle_pledge_full_completion() {
    let mut e = Env::new();
    let id = active_pool(&mut e);
    let driver = funded(&mut e.svm, SOL);
    let sponsor = funded(&mut e.svm, 5 * SOL);
    let auth = e.authority_kp();
    let ride_id = [1u8; 32];
    let max = 1_000_000u64;

    e.create_pledge(id, ride_id, &driver.pubkey(), &sponsor, max, 10_000, 100).unwrap();
    e.record_verified_attestation(id, &auth, &driver.pubkey(), 100).unwrap();

    let cranker = funded(&mut e.svm, SOL);
    let s = settle_measured(&mut e, id, ride_id, &cranker, &driver.pubkey(), &sponsor.pubkey(), max);
    // 100% to the driver; the sponsor only gets the account's rent back
    assert_eq!(s.earned, max);
    assert_eq!(s.back, s.rent);
    assert!(s.rent > 0);

    let evs = events::<PledgeSettled>(&s.r.logs);
    assert_eq!(evs.len(), 1);
    assert_eq!(evs[0].earned_lamports, max);
    assert_eq!(evs[0].refunded_lamports, 0);
    assert_eq!(evs[0].verified_km, 100);
}

#[test]
fn settle_pledge_partial_completion() {
    let mut e = Env::new();
    let id = active_pool(&mut e);
    let driver = funded(&mut e.svm, SOL);
    let sponsor = funded(&mut e.svm, 5 * SOL);
    let auth = e.authority_kp();
    let ride_id = [2u8; 32];
    let max = 1_000_000u64;

    e.create_pledge(id, ride_id, &driver.pubkey(), &sponsor, max, 10_000, 100).unwrap();
    // 45 km of 100
    e.record_verified_attestation(id, &auth, &driver.pubkey(), 45).unwrap();

    let caller = e.authority_kp();
    let s = settle_measured(&mut e, id, ride_id, &caller, &driver.pubkey(), &sponsor.pubkey(), max);
    assert_eq!(s.earned, 450_000);
    assert_eq!(s.back, 550_000 + s.rent);

    let evs = events::<PledgeSettled>(&s.r.logs);
    assert_eq!(evs[0].earned_lamports, 450_000);
    assert_eq!(evs[0].refunded_lamports, 550_000);
}

#[test]
fn settle_pledge_zero_completion() {
    let mut e = Env::new();
    let id = active_pool(&mut e);
    let driver = funded(&mut e.svm, SOL);
    let sponsor = funded(&mut e.svm, 5 * SOL);
    let ride_id = [3u8; 32];
    let max = 1_000_000u64;

    e.create_pledge(id, ride_id, &driver.pubkey(), &sponsor, max, 10_000, 100).unwrap();
    // written directly: verified_km = 0, status = VERIFIED
    e.set_attestation(id, &driver.pubkey(), 0, ATTESTATION_STATUS_VERIFIED);

    let caller = e.authority_kp();
    let s = settle_measured(&mut e, id, ride_id, &caller, &driver.pubkey(), &sponsor.pubkey(), max);
    assert_eq!(s.earned, 0);
    assert_eq!(s.back, max + s.rent);
    let evs = events::<PledgeSettled>(&s.r.logs);
    assert_eq!(evs[0].earned_lamports, 0);
    assert_eq!(evs[0].refunded_lamports, max);
}

#[test]
fn settle_pledge_surplus_completion_capped() {
    let mut e = Env::new();
    let id = active_pool(&mut e);
    let driver = funded(&mut e.svm, SOL);
    let sponsor = funded(&mut e.svm, 5 * SOL);
    let auth = e.authority_kp();
    let ride_id = [4u8; 32];
    let max = 1_000_000u64;

    e.create_pledge(id, ride_id, &driver.pubkey(), &sponsor, max, 10_000, 100).unwrap();
    // 250 km driven, more than target_km
    e.record_verified_attestation(id, &auth, &driver.pubkey(), 250).unwrap();

    let caller = e.authority_kp();
    let s = settle_measured(&mut e, id, ride_id, &caller, &driver.pubkey(), &sponsor.pubkey(), max);
    // capped at target_km: 100% earned
    assert_eq!(s.earned, max);
    assert_eq!(s.back, s.rent);
    let evs = events::<PledgeSettled>(&s.r.logs);
    assert_eq!(evs[0].verified_km, 250);
    assert_eq!(evs[0].earned_lamports, max);
}

#[test]
fn settle_pledge_odd_rounding_zero_stranded_lamports() {
    let mut e = Env::new();
    let id = active_pool(&mut e);
    let driver = funded(&mut e.svm, SOL);
    let sponsor = funded(&mut e.svm, 5 * SOL);
    let auth = e.authority_kp();
    let ride_id = [5u8; 32];
    // indivisible: 3 km target @ 333 lamports/km = 999
    let max = 999u64;

    e.create_pledge(id, ride_id, &driver.pubkey(), &sponsor, max, 333, 3).unwrap();
    e.record_verified_attestation(id, &auth, &driver.pubkey(), 1).unwrap();

    let caller = e.authority_kp();
    let s = settle_measured(&mut e, id, ride_id, &caller, &driver.pubkey(), &sponsor.pubkey(), max);
    // 999 * 1 / 3 = 333 earned, 666 back
    assert_eq!(s.earned, 333);
    assert_eq!(s.back, 666 + s.rent);
}

#[test]
fn settle_pledge_flagged_driver_yields_full_refund() {
    let mut e = Env::new();
    let id = active_pool(&mut e);
    let driver = funded(&mut e.svm, SOL);
    let sponsor = funded(&mut e.svm, 5 * SOL);
    let auth = e.authority_kp();
    let ride_id = [6u8; 32];
    let max = 1_000_000u64;

    e.create_pledge(id, ride_id, &driver.pubkey(), &sponsor, max, 10_000, 100).unwrap();
    // driver flagged (cheated or disqualified)
    e.record_attestation(id, &auth, &driver.pubkey(), [9u8; 32], 100, ATTESTATION_STATUS_FLAGGED).unwrap();

    let caller = e.authority_kp();
    let s = settle_measured(&mut e, id, ride_id, &caller, &driver.pubkey(), &sponsor.pubkey(), max);
    assert_eq!(s.earned, 0);
    assert_eq!(s.back, max + s.rent);
    let evs = events::<PledgeSettled>(&s.r.logs);
    assert_eq!(evs[0].earned_lamports, 0);
    assert_eq!(evs[0].refunded_lamports, max);
    assert_eq!(evs[0].verified_km, 0);
}

#[test]
fn settle_pledge_unverified_attestation_rejected() {
    let mut e = Env::new();
    let id = active_pool(&mut e);
    let driver = funded(&mut e.svm, SOL);
    let sponsor = funded(&mut e.svm, 5 * SOL);
    let auth = e.authority_kp();
    let ride_id = [7u8; 32];

    e.create_pledge(id, ride_id, &driver.pubkey(), &sponsor, 1_000_000, 10_000, 100).unwrap();
    e.record_attestation(id, &auth, &driver.pubkey(), [0u8; 32], 100, ATTESTATION_STATUS_UNVERIFIED).unwrap();

    let caller = e.authority_kp();
    assert_err!(
        e.settle_pledge(id, ride_id, &caller, &driver.pubkey(), &sponsor.pubkey()),
        PoolError::UnverifiedAttestation
    );
    assert!(e.pledge(&ride_id, &sponsor.pubkey()).is_some());
}

#[test]
fn settle_pledge_double_settlement_rejected() {
    let mut e = Env::new();
    let id = active_pool(&mut e);
    let driver = funded(&mut e.svm, SOL);
    let sponsor = funded(&mut e.svm, 5 * SOL);
    let auth = e.authority_kp();
    let ride_id = [8u8; 32];

    e.create_pledge(id, ride_id, &driver.pubkey(), &sponsor, 1_000_000, 10_000, 100).unwrap();
    e.record_verified_attestation(id, &auth, &driver.pubkey(), 100).unwrap();

    let caller = e.authority_kp();
    e.settle_pledge(id, ride_id, &caller, &driver.pubkey(), &sponsor.pubkey()).unwrap();
    // the account is closed: a second settle finds nothing
    e.svm.expire_blockhash();
    assert_closed_err(e.settle_pledge(id, ride_id, &caller, &driver.pubkey(), &sponsor.pubkey()));
}

#[test]
fn settle_pledge_account_mismatches() {
    let mut e = Env::new();
    let id = active_pool(&mut e);
    let driver = funded(&mut e.svm, SOL);
    let stranger = funded(&mut e.svm, SOL);
    let sponsor = funded(&mut e.svm, 5 * SOL);
    let auth = e.authority_kp();
    let ride_id = [9u8; 32];

    e.create_pledge(id, ride_id, &driver.pubkey(), &sponsor, 1_000_000, 10_000, 100).unwrap();
    e.record_verified_attestation(id, &auth, &driver.pubkey(), 100).unwrap();

    let caller = e.authority_kp();
    // wrong driver / wrong sponsor / wrong ride_id
    assert!(e.settle_pledge(id, ride_id, &caller, &stranger.pubkey(), &sponsor.pubkey()).is_err());
    assert!(e.settle_pledge(id, ride_id, &caller, &driver.pubkey(), &stranger.pubkey()).is_err());
    assert!(e.settle_pledge(id, [99u8; 32], &caller, &driver.pubkey(), &sponsor.pubkey()).is_err());
    assert!(e.pledge(&ride_id, &sponsor.pubkey()).is_some());
}

#[test]
fn settle_pledge_multi_sponsors_on_same_ride() {
    let mut e = Env::new();
    let id = active_pool(&mut e);
    let driver = funded(&mut e.svm, SOL);
    let sponsor_a = funded(&mut e.svm, 5 * SOL);
    let sponsor_b = funded(&mut e.svm, 5 * SOL);
    let auth = e.authority_kp();
    let ride_id = [10u8; 32];

    // A: 10,000 lamports/km -> 1,000,000; B: 5,000 lamports/km -> 500,000
    e.create_pledge(id, ride_id, &driver.pubkey(), &sponsor_a, 1_000_000, 10_000, 100).unwrap();
    e.create_pledge(id, ride_id, &driver.pubkey(), &sponsor_b, 500_000, 5_000, 100).unwrap();
    // 60 km
    e.record_verified_attestation(id, &auth, &driver.pubkey(), 60).unwrap();

    let caller = funded(&mut e.svm, SOL);
    let a = settle_measured(&mut e, id, ride_id, &caller, &driver.pubkey(), &sponsor_a.pubkey(), 1_000_000);
    let b = settle_measured(&mut e, id, ride_id, &caller, &driver.pubkey(), &sponsor_b.pubkey(), 500_000);
    assert_eq!(a.earned + b.earned, 900_000);
    assert_eq!(a.back, 400_000 + a.rent);
    assert_eq!(b.back, 200_000 + b.rent);
}

#[test]
fn settle_pledge_driver_below_rent_minimum_refunds_the_sponsor() {
    let mut e = Env::new();
    let id = active_pool(&mut e);
    // a driver account that does not exist (0 lamports): 1 000 lamports would leave it under the rent minimum
    let driver = Pubkey::new_unique();
    let sponsor = funded(&mut e.svm, 5 * SOL);
    let auth = e.authority_kp();
    let ride_id = [11u8; 32];
    let max = 1_000u64;

    e.create_pledge(id, ride_id, &driver, &sponsor, max, 10, 100).unwrap();
    e.record_verified_attestation(id, &auth, &driver, 100).unwrap();

    let caller = e.authority_kp();
    let s = settle_measured(&mut e, id, ride_id, &caller, &driver, &sponsor.pubkey(), max);
    assert_eq!(s.earned, 0);
    assert_eq!(e.bal(&driver), 0);
    assert_eq!(s.back, max + s.rent);
    let evs = events::<PledgeSettled>(&s.r.logs);
    assert_eq!(evs[0].earned_lamports, 0);
    assert_eq!(evs[0].refunded_lamports, max);
    assert_eq!(evs[0].verified_km, 100);
}

#[test]
fn settle_pledge_fuzz_zero_stranded_lamports() {
    let mut e = Env::new();
    let id = active_pool(&mut e);
    let auth = e.authority_kp();
    let mut rng = Rng(123456789);

    for i in 0..25u8 {
        let driver = funded(&mut e.svm, SOL);
        let sponsor = funded(&mut e.svm, 10 * SOL);
        let ride_id = [i + 50; 32];

        let target_km = rng.range(1, 500) as u32;
        let rate = rng.range(100, 50_000);
        let max_lamports = rate * (target_km as u64);
        let verified_km = rng.range(0, 600) as u32;

        e.create_pledge(id, ride_id, &driver.pubkey(), &sponsor, max_lamports, rate, target_km).unwrap();
        if verified_km > 0 {
            e.record_verified_attestation(id, &auth, &driver.pubkey(), verified_km).unwrap();
        } else {
            e.set_attestation(id, &driver.pubkey(), 0, ATTESTATION_STATUS_VERIFIED);
        }

        let caller = e.authority_kp();
        let s = settle_measured(&mut e, id, ride_id, &caller, &driver.pubkey(), &sponsor.pubkey(), max_lamports);
        let ev = &events::<PledgeSettled>(&s.r.logs)[0];
        assert_eq!(ev.earned_lamports + ev.refunded_lamports, max_lamports, "conservation, fuzz run {}", i);
        assert_eq!(s.earned, ev.earned_lamports, "driver delta, fuzz run {}", i);
        assert_eq!(s.back, ev.refunded_lamports + s.rent, "sponsor delta, fuzz run {}", i);
    }
}

#[test]
fn challenge_exact_integer_math_primes_and_odds() {
    let mut e = Env::new();
    let id = active_pool(&mut e);
    let auth = e.authority_kp();

    // (target_km, rate, verified_km): primes, odds, 0 km, surplus km
    let cases: Vec<(u32, u64, u32, &'static str)> = vec![
        (1, 1, 0, "1km unit zero"),
        (1, 1, 1, "1km unit exact"),
        (1, 1, 5, "1km unit surplus"),
        (3, 7, 0, "prime target 3 rate 7, zero km"),
        (3, 7, 1, "prime target 3 rate 7, 1 km (truncation check)"),
        (3, 7, 2, "prime target 3 rate 7, 2 km"),
        (3, 7, 3, "prime target 3 rate 7, exact target 3 km"),
        (3, 7, 10, "prime target 3 rate 7, surplus 10 km"),
        (97, 1009, 0, "prime target 97 rate 1009, zero km"),
        (97, 1009, 1, "prime target 97 rate 1009, 1 km"),
        (97, 1009, 37, "prime target 97 rate 1009, 37 km (prime/prime)"),
        (97, 1009, 48, "prime target 97 rate 1009, 48 km (near half)"),
        (97, 1009, 96, "prime target 97 rate 1009, 96 km (target - 1)"),
        (97, 1009, 97, "prime target 97 rate 1009, exact 97 km"),
        (97, 1009, 500, "prime target 97 rate 1009, massive surplus 500 km"),
        (7, 13, 5, "7km target rate 13, 5 km"),
        (11, 23, 7, "11km target rate 23, 7 km"),
        (13, 29, 1, "13km target rate 29, 1 km"),
        (13, 29, 12, "13km target rate 29, 12 km"),
        (997, 9973, 0, "large prime target 997, 0 km"),
        (997, 9973, 1, "large prime target 997, 1 km"),
        (997, 9973, 499, "large prime target 997, 499 km"),
        (997, 9973, 996, "large prime target 997, 996 km"),
        (997, 9973, 997, "large prime target 997, exact 997 km"),
        (997, 9973, 2000, "large prime target 997, surplus 2000 km"),
    ];

    for (idx, (target_km, rate, verified_km, label)) in cases.into_iter().enumerate() {
        let driver = funded(&mut e.svm, SOL);
        let sponsor = funded(&mut e.svm, 20 * SOL);
        let mut ride_id = [0u8; 32];
        ride_id[0] = 0xAA;
        ride_id[1] = idx as u8;
        let max_lamports = rate * (target_km as u64);

        e.create_pledge(id, ride_id, &driver.pubkey(), &sponsor, max_lamports, rate, target_km)
            .unwrap_or_else(|_| panic!("{}: create_pledge failed", label));
        if verified_km > 0 {
            e.record_verified_attestation(id, &auth, &driver.pubkey(), verified_km)
                .unwrap_or_else(|_| panic!("{}: record_verified_attestation failed", label));
        } else {
            e.set_attestation(id, &driver.pubkey(), 0, ATTESTATION_STATUS_VERIFIED);
        }

        let cranker = funded(&mut e.svm, SOL);
        let s = settle_measured(&mut e, id, ride_id, &cranker, &driver.pubkey(), &sponsor.pubkey(), max_lamports);

        let expected_earned = ((max_lamports as u128 * verified_km.min(target_km) as u128) / target_km as u128) as u64;
        let expected_refund = max_lamports - expected_earned;
        assert_eq!(s.earned, expected_earned, "{}: driver balance delta mismatch", label);
        assert_eq!(s.back, expected_refund + s.rent, "{}: sponsor balance delta mismatch", label);

        let evs = events::<PledgeSettled>(&s.r.logs);
        assert_eq!(evs.len(), 1, "{}: expected exactly 1 PledgeSettled event", label);
        assert_eq!(evs[0].earned_lamports, expected_earned, "{}: event earned mismatch", label);
        assert_eq!(evs[0].refunded_lamports, expected_refund, "{}: event refund mismatch", label);
    }
}

#[test]
fn challenge_double_settlement_adversarial_callers() {
    let mut e = Env::new();
    let id = active_pool(&mut e);
    let driver = funded(&mut e.svm, SOL);
    let sponsor = funded(&mut e.svm, 5 * SOL);
    let auth = e.authority_kp();
    let ride_id = [0xDD; 32];
    let max = 1_000_000u64;

    e.create_pledge(id, ride_id, &driver.pubkey(), &sponsor, max, 10_000, 100).unwrap();
    e.record_verified_attestation(id, &auth, &driver.pubkey(), 50).unwrap();

    let cranker1 = funded(&mut e.svm, SOL);
    let cranker2 = funded(&mut e.svm, SOL);
    let s = settle_measured(&mut e, id, ride_id, &cranker1, &driver.pubkey(), &sponsor.pubkey(), max);
    assert_eq!(s.earned, 500_000);
    let (d1, s1) = (e.bal(&driver.pubkey()), e.bal(&sponsor.pubkey()));

    // every later settle or refund finds the account gone, whoever sends it; only the fee moves
    e.svm.expire_blockhash();
    assert_closed_err(e.settle_pledge(id, ride_id, &cranker1, &driver.pubkey(), &sponsor.pubkey()));
    assert_closed_err(e.settle_pledge(id, ride_id, &cranker2, &driver.pubkey(), &sponsor.pubkey()));
    assert_closed_err(e.refund_pledge(id, ride_id, &cranker2, &driver.pubkey(), &sponsor.pubkey()));
    assert_eq!(e.bal(&driver.pubkey()), d1);
    assert_eq!(e.bal(&sponsor.pubkey()), s1);

    assert_closed_err(e.settle_pledge(id, ride_id, &driver, &driver.pubkey(), &sponsor.pubkey()));
    assert_eq!(e.bal(&driver.pubkey()), d1 - 5000, "driver only paid the fee");
    assert_closed_err(e.settle_pledge(id, ride_id, &sponsor, &driver.pubkey(), &sponsor.pubkey()));
    assert_eq!(e.bal(&sponsor.pubkey()), s1 - 5000, "sponsor only paid the fee");
    assert_eq!(e.bal(&pledge_pda(&ride_id, &sponsor.pubkey())), 0);
}

#[test]
fn challenge_flagged_driver_scenarios() {
    let mut e = Env::new();
    let id = active_pool(&mut e);
    let auth = e.authority_kp();

    // a FLAGGED driver earns nothing whatever distance the attestation names
    for (idx, verified_km) in [0u32, 25, 100, 500].into_iter().enumerate() {
        let driver = funded(&mut e.svm, SOL);
        let sponsor = funded(&mut e.svm, 5 * SOL);
        let mut ride_id = [0xFA; 32];
        ride_id[0] = idx as u8;
        let max = 1_000_000u64;

        e.create_pledge(id, ride_id, &driver.pubkey(), &sponsor, max, 10_000, 100).unwrap();
        e.record_attestation(id, &auth, &driver.pubkey(), [0xCC; 32], verified_km, ATTESTATION_STATUS_FLAGGED).unwrap();

        let cranker = funded(&mut e.svm, SOL);
        let s = settle_measured(&mut e, id, ride_id, &cranker, &driver.pubkey(), &sponsor.pubkey(), max);
        assert_eq!(s.earned, 0, "flagged with {} km: driver received funds", verified_km);
        assert_eq!(s.back, max + s.rent, "flagged with {} km: sponsor not fully refunded", verified_km);

        let evs = events::<PledgeSettled>(&s.r.logs);
        assert_eq!(evs.len(), 1);
        assert_eq!(evs[0].earned_lamports, 0);
        assert_eq!(evs[0].refunded_lamports, max);
        assert_eq!(evs[0].verified_km, 0);
    }
}

#[test]
fn challenge_oracle_property_stress_matrix() {
    let mut e = Env::new();
    let id = active_pool(&mut e);
    let auth = e.authority_kp();
    let mut rng = Rng(987654321);

    for iter in 0..50u8 {
        let driver = funded(&mut e.svm, SOL);
        let sponsor = funded(&mut e.svm, 20 * SOL);
        let mut ride_id = [0xEE; 32];
        ride_id[0] = iter;

        let target_km = rng.range(1, 1000) as u32;
        let rate = rng.range(1, 50_000);
        let max_lamports = rate * (target_km as u64);
        // a mix of 0, partial, full and surplus distances
        let verified_km = match iter % 5 {
            0 => 0u32,
            1 => target_km,
            2 => target_km + rng.range(1, 500) as u32,
            3 => target_km * 3,
            _ => rng.range(0, target_km as u64) as u32,
        };

        e.create_pledge(id, ride_id, &driver.pubkey(), &sponsor, max_lamports, rate, target_km).unwrap();
        if verified_km > 0 {
            e.record_verified_attestation(id, &auth, &driver.pubkey(), verified_km).unwrap();
        } else {
            e.set_attestation(id, &driver.pubkey(), 0, ATTESTATION_STATUS_VERIFIED);
        }

        let cranker = funded(&mut e.svm, SOL);
        let s = settle_measured(&mut e, id, ride_id, &cranker, &driver.pubkey(), &sponsor.pubkey(), max_lamports);

        let oracle_earned = ((max_lamports as u128 * verified_km.min(target_km) as u128) / target_km as u128) as u64;
        let oracle_refund = max_lamports - oracle_earned;
        assert_eq!(s.earned, oracle_earned);
        assert_eq!(s.back, oracle_refund + s.rent);

        let evs = events::<PledgeSettled>(&s.r.logs);
        assert_eq!(evs[0].earned_lamports, oracle_earned);
        assert_eq!(evs[0].refunded_lamports, oracle_refund);
        assert_eq!(evs[0].verified_km, verified_km);
    }
}

// ---- refund_pledge ------------------------------------------------------------

/// An OPEN pool (one ticket, min 2) with a pledge on `driver` by `sponsor`.
fn open_pool_with_pledge(e: &mut Env, ride_id: [u8; 32], max: u64) -> (u32, Keypair, Keypair, Keypair) {
    let id = e.create_pool(default_params().with_open());
    let buyer = funded(&mut e.svm, 20 * SOL);
    e.buy(id, &buyer, 1).unwrap();
    assert_eq!(e.pool(id).status, STATUS_OPEN);
    let driver = funded(&mut e.svm, SOL);
    let sponsor = funded(&mut e.svm, 5 * SOL);
    e.create_pledge(id, ride_id, &driver.pubkey(), &sponsor, max, max / 100, 100).unwrap();
    (id, buyer, driver, sponsor)
}

/// refund_pledge by a third party: the sponsor gets the cap + the account's rent, the account is gone, the event says so.
fn assert_refunded(e: &mut Env, id: u32, ride_id: [u8; 32], driver: &Pubkey, sponsor: &Pubkey, max: u64) {
    let pda = pledge_pda(&ride_id, sponsor);
    let (before, s0) = (e.bal(&pda), e.bal(sponsor));
    assert!(before > max);
    let caller = funded(&mut e.svm, SOL);
    let r = e.refund_pledge(id, ride_id, &caller, driver, sponsor).unwrap();
    assert_eq!(e.bal(sponsor), s0 + before, "sponsor gets the cap + rent");
    assert_eq!(e.bal(&pda), 0);
    assert!(e.pledge(&ride_id, sponsor).is_none());
    let evs = events::<PledgeRefunded>(&r.logs);
    assert_eq!(evs.len(), 1);
    assert_eq!(evs[0].ride_id, ride_id);
    assert_eq!(evs[0].sponsor, *sponsor);
    assert_eq!(evs[0].driver, *driver);
    assert_eq!(evs[0].pool, pool_pda(id));
    assert_eq!(evs[0].refunded_lamports, max);
}

#[test]
fn refund_pledge_refused_while_the_pool_runs() {
    let mut e = Env::new();
    let ride_id = [0x60; 32];
    let (id, buyer, driver, sponsor) = open_pool_with_pledge(&mut e, ride_id, 1_000_000);
    let caller = funded(&mut e.svm, SOL);
    // OPEN
    assert_err!(e.refund_pledge(id, ride_id, &caller, &driver.pubkey(), &sponsor.pubkey()), PoolError::PledgeNotRefundable);
    // ACTIVE, before and right up to the end of the settle grace
    e.buy(id, &buyer, 1).unwrap();
    assert_eq!(e.pool(id).status, STATUS_ACTIVE);
    e.svm.expire_blockhash();
    assert_err!(e.refund_pledge(id, ride_id, &caller, &driver.pubkey(), &sponsor.pubkey()), PoolError::PledgeNotRefundable);
    e.warp(PAYOUT + SETTLE_GRACE_SECS - 1);
    assert_err!(e.refund_pledge(id, ride_id, &caller, &driver.pubkey(), &sponsor.pubkey()), PoolError::PledgeNotRefundable);
    assert!(e.pledge(&ride_id, &sponsor.pubkey()).is_some());
}

#[test]
fn refund_pledge_after_fail_pool() {
    let mut e = Env::new();
    let ride_id = [0x61; 32];
    let (id, _, driver, sponsor) = open_pool_with_pledge(&mut e, ride_id, 1_000_000);
    e.warp(PREP);
    e.fail(id).unwrap();
    assert_eq!(e.pool(id).status, STATUS_REFUNDING);
    assert_refunded(&mut e, id, ride_id, &driver.pubkey(), &sponsor.pubkey(), 1_000_000);
}

#[test]
fn refund_pledge_after_cancel_pool_refunding_and_cancelled() {
    let mut e = Env::new();
    let auth = e.authority_kp();
    // REFUNDING right after cancel_pool
    let ride_a = [0x62; 32];
    let (id, _, driver, sponsor) = open_pool_with_pledge(&mut e, ride_a, 1_000_000);
    e.cancel(id, &auth).unwrap();
    assert_eq!(e.pool(id).status, STATUS_REFUNDING);
    assert_refunded(&mut e, id, ride_a, &driver.pubkey(), &sponsor.pubkey(), 1_000_000);

    // CANCELLED: refunded and closed, then the pledge
    let ride_b = [0x63; 32];
    let (id, buyer, driver, sponsor) = open_pool_with_pledge(&mut e, ride_b, 2_000_000);
    e.cancel(id, &auth).unwrap();
    e.refund(id, &buyer.pubkey(), &buyer.pubkey()).unwrap();
    let anyone = funded(&mut e.svm, SOL);
    e.close_pool(id, &anyone).unwrap();
    assert_eq!(e.pool(id).status, STATUS_CANCELLED);
    assert_refunded(&mut e, id, ride_b, &driver.pubkey(), &sponsor.pubkey(), 2_000_000);
}

#[test]
fn refund_pledge_settled_pool_without_attestation() {
    let mut e = Env::new();
    let id = active_pool(&mut e);
    let driver = funded(&mut e.svm, SOL);
    let sponsor = funded(&mut e.svm, 5 * SOL);
    let ride_id = [0x64; 32];
    e.create_pledge(id, ride_id, &driver.pubkey(), &sponsor, 1_000_000, 10_000, 100).unwrap();
    // the driver never finished: no attestation; the admin closes the pool after the review window
    e.warp(PAYOUT);
    let auth = e.authority_kp();
    e.close_pool(id, &auth).unwrap();
    assert_eq!(e.pool(id).status, STATUS_SETTLED);
    assert_refunded(&mut e, id, ride_id, &driver.pubkey(), &sponsor.pubkey(), 1_000_000);
}

#[test]
fn refund_pledge_active_pool_past_the_grace_without_attestation() {
    let mut e = Env::new();
    let id = active_pool(&mut e);
    let driver = funded(&mut e.svm, SOL);
    let sponsor = funded(&mut e.svm, 5 * SOL);
    let ride_id = [0x65; 32];
    e.create_pledge(id, ride_id, &driver.pubkey(), &sponsor, 1_000_000, 10_000, 100).unwrap();
    // the operator is gone: nobody settles or closes the pool
    e.warp(PAYOUT + SETTLE_GRACE_SECS);
    assert_eq!(e.pool(id).status, STATUS_ACTIVE);
    assert_refunded(&mut e, id, ride_id, &driver.pubkey(), &sponsor.pubkey(), 1_000_000);
}

#[test]
fn refund_pledge_refused_when_a_decided_attestation_exists() {
    for status in [ATTESTATION_STATUS_VERIFIED, ATTESTATION_STATUS_FLAGGED] {
        let mut e = Env::new();
        let id = active_pool(&mut e);
        let driver = funded(&mut e.svm, SOL);
        let sponsor = funded(&mut e.svm, 5 * SOL);
        let auth = e.authority_kp();
        let ride_id = [0x66; 32];
        e.create_pledge(id, ride_id, &driver.pubkey(), &sponsor, 1_000_000, 10_000, 100).unwrap();
        e.record_attestation(id, &auth, &driver.pubkey(), [3u8; 32], 40, status).unwrap();
        e.warp(PAYOUT);
        e.close_pool(id, &auth).unwrap();

        let caller = funded(&mut e.svm, SOL);
        assert_err!(e.refund_pledge(id, ride_id, &caller, &driver.pubkey(), &sponsor.pubkey()), PoolError::AttestationExists);
        // settle is the way out, also on a settled pool; then refund finds the account gone
        let s = settle_measured(&mut e, id, ride_id, &caller, &driver.pubkey(), &sponsor.pubkey(), 1_000_000);
        let earned = if status == ATTESTATION_STATUS_VERIFIED { 400_000 } else { 0 };
        assert_eq!(s.earned, earned);
        e.svm.expire_blockhash();
        assert_closed_err(e.refund_pledge(id, ride_id, &caller, &driver.pubkey(), &sponsor.pubkey()));
    }
}

#[test]
fn refund_pledge_allowed_with_an_unverified_attestation() {
    let mut e = Env::new();
    let id = active_pool(&mut e);
    let driver = funded(&mut e.svm, SOL);
    let sponsor = funded(&mut e.svm, 5 * SOL);
    let auth = e.authority_kp();
    let ride_id = [0x67; 32];
    e.create_pledge(id, ride_id, &driver.pubkey(), &sponsor, 1_000_000, 10_000, 100).unwrap();
    e.record_attestation(id, &auth, &driver.pubkey(), [0u8; 32], 0, ATTESTATION_STATUS_UNVERIFIED).unwrap();
    e.warp(PAYOUT);
    e.close_pool(id, &auth).unwrap();
    // settle refuses an UNVERIFIED attestation, so refund must not
    assert_refunded(&mut e, id, ride_id, &driver.pubkey(), &sponsor.pubkey(), 1_000_000);
    // and a refunded pledge cannot be settled
    let caller = funded(&mut e.svm, SOL);
    assert_closed_err(e.settle_pledge(id, ride_id, &caller, &driver.pubkey(), &sponsor.pubkey()));
}
