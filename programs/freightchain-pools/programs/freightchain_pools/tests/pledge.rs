#[macro_use]
mod common;

use common::*;
use freightchain_pools::{
    constants::*,
    error::PoolError,
    events::{PledgeCreated, PledgeSettled},
};
use solana_signer::Signer;

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
fn settle_pledge_full_completion() {
    let mut e = Env::new();
    let id = active_pool(&mut e);
    let driver = funded(&mut e.svm, SOL);
    let sponsor = funded(&mut e.svm, 5 * SOL);
    let auth = e.authority_kp();
    let ride_id = [1u8; 32];
    let target_km = 100u32;
    let rate = 10_000u64;
    let max = 1_000_000u64;

    e.create_pledge(id, ride_id, &driver.pubkey(), &sponsor, max, rate, target_km)
        .unwrap();

    // Attestation with verified_km == target_km
    e.record_verified_attestation(id, &auth, &driver.pubkey(), 100)
        .unwrap();

    let d0 = e.bal(&driver.pubkey());
    let s0 = e.bal(&sponsor.pubkey());
    let cranker = funded(&mut e.svm, SOL);

    let r = e
        .settle_pledge(id, ride_id, &cranker, &driver.pubkey(), &sponsor.pubkey())
        .unwrap();

    // 100% to driver, 0% refund to sponsor
    assert_eq!(e.bal(&driver.pubkey()), d0 + max);
    assert_eq!(e.bal(&sponsor.pubkey()), s0);

    let p = e.pledge(&ride_id, &sponsor.pubkey()).unwrap();
    assert!(p.settled);
    assert_eq!(p.earned_lamports, max);
    assert_eq!(p.refunded_lamports, 0);

    let evs = events::<PledgeSettled>(&r.logs);
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
    let target_km = 100u32;
    let rate = 10_000u64;
    let max = 1_000_000u64;

    e.create_pledge(id, ride_id, &driver.pubkey(), &sponsor, max, rate, target_km)
        .unwrap();

    // Attestation with 45 km completed out of 100
    e.record_verified_attestation(id, &auth, &driver.pubkey(), 45)
        .unwrap();

    let d0 = e.bal(&driver.pubkey());
    let s0 = e.bal(&sponsor.pubkey());
    let caller = e.authority_kp();

    let r = e
        .settle_pledge(id, ride_id, &caller, &driver.pubkey(), &sponsor.pubkey())
        .unwrap();

    let expected_earned = 450_000u64;
    let expected_refund = 550_000u64;
    assert_eq!(expected_earned + expected_refund, max);

    assert_eq!(e.bal(&driver.pubkey()), d0 + expected_earned);
    assert_eq!(e.bal(&sponsor.pubkey()), s0 + expected_refund);

    let p = e.pledge(&ride_id, &sponsor.pubkey()).unwrap();
    assert!(p.settled);
    assert_eq!(p.earned_lamports, expected_earned);
    assert_eq!(p.refunded_lamports, expected_refund);

    let evs = events::<PledgeSettled>(&r.logs);
    assert_eq!(evs[0].earned_lamports, expected_earned);
    assert_eq!(evs[0].refunded_lamports, expected_refund);
}

#[test]
fn settle_pledge_zero_completion() {
    let mut e = Env::new();
    let id = active_pool(&mut e);
    let driver = funded(&mut e.svm, SOL);
    let sponsor = funded(&mut e.svm, 5 * SOL);
    let ride_id = [3u8; 32];
    let target_km = 100u32;
    let rate = 10_000u64;
    let max = 1_000_000u64;

    e.create_pledge(id, ride_id, &driver.pubkey(), &sponsor, max, rate, target_km)
        .unwrap();

    // Attestation directly written with verified_km = 0, status = VERIFIED
    e.set_attestation(id, &driver.pubkey(), 0, ATTESTATION_STATUS_VERIFIED);

    let d0 = e.bal(&driver.pubkey());
    let s0 = e.bal(&sponsor.pubkey());
    let caller = e.authority_kp();

    e.settle_pledge(id, ride_id, &caller, &driver.pubkey(), &sponsor.pubkey())
        .unwrap();

    assert_eq!(e.bal(&driver.pubkey()), d0);
    assert_eq!(e.bal(&sponsor.pubkey()), s0 + max);

    let p = e.pledge(&ride_id, &sponsor.pubkey()).unwrap();
    assert!(p.settled);
    assert_eq!(p.earned_lamports, 0);
    assert_eq!(p.refunded_lamports, max);
}

#[test]
fn settle_pledge_surplus_completion_capped() {
    let mut e = Env::new();
    let id = active_pool(&mut e);
    let driver = funded(&mut e.svm, SOL);
    let sponsor = funded(&mut e.svm, 5 * SOL);
    let auth = e.authority_kp();
    let ride_id = [4u8; 32];
    let target_km = 100u32;
    let rate = 10_000u64;
    let max = 1_000_000u64;

    e.create_pledge(id, ride_id, &driver.pubkey(), &sponsor, max, rate, target_km)
        .unwrap();

    // Driver completed 250 km (more than target_km)
    e.record_verified_attestation(id, &auth, &driver.pubkey(), 250)
        .unwrap();

    let d0 = e.bal(&driver.pubkey());
    let s0 = e.bal(&sponsor.pubkey());
    let caller = e.authority_kp();

    e.settle_pledge(id, ride_id, &caller, &driver.pubkey(), &sponsor.pubkey())
        .unwrap();

    // Capped at target_km, so 100% earned, 0% refund
    assert_eq!(e.bal(&driver.pubkey()), d0 + max);
    assert_eq!(e.bal(&sponsor.pubkey()), s0);

    let p = e.pledge(&ride_id, &sponsor.pubkey()).unwrap();
    assert_eq!(p.earned_lamports, max);
    assert_eq!(p.refunded_lamports, 0);
}

#[test]
fn settle_pledge_odd_rounding_zero_stranded_lamports() {
    let mut e = Env::new();
    let id = active_pool(&mut e);
    let driver = funded(&mut e.svm, SOL);
    let sponsor = funded(&mut e.svm, 5 * SOL);
    let auth = e.authority_kp();
    let ride_id = [5u8; 32];

    // Indivisible test: 3 km target @ 333 lamports/km = 999 max lamports
    let target_km = 3u32;
    let rate = 333u64;
    let max = 999u64;

    e.create_pledge(id, ride_id, &driver.pubkey(), &sponsor, max, rate, target_km)
        .unwrap();

    // 1 km completed
    e.record_verified_attestation(id, &auth, &driver.pubkey(), 1)
        .unwrap();

    let d0 = e.bal(&driver.pubkey());
    let s0 = e.bal(&sponsor.pubkey());
    let caller = e.authority_kp();

    e.settle_pledge(id, ride_id, &caller, &driver.pubkey(), &sponsor.pubkey())
        .unwrap();

    // 999 * 1 / 3 = 333 earned, 999 - 333 = 666 refund
    let expected_earned = 333u64;
    let expected_refund = 666u64;
    assert_eq!(expected_earned + expected_refund, max);

    assert_eq!(e.bal(&driver.pubkey()), d0 + expected_earned);
    assert_eq!(e.bal(&sponsor.pubkey()), s0 + expected_refund);

    let p = e.pledge(&ride_id, &sponsor.pubkey()).unwrap();
    assert_eq!(p.earned_lamports + p.refunded_lamports, max);
}

#[test]
fn settle_pledge_flagged_driver_yields_full_refund() {
    let mut e = Env::new();
    let id = active_pool(&mut e);
    let driver = funded(&mut e.svm, SOL);
    let sponsor = funded(&mut e.svm, 5 * SOL);
    let auth = e.authority_kp();
    let ride_id = [6u8; 32];
    let target_km = 100u32;
    let rate = 10_000u64;
    let max = 1_000_000u64;

    e.create_pledge(id, ride_id, &driver.pubkey(), &sponsor, max, rate, target_km)
        .unwrap();

    // Attestation flagged (driver cheated or disqualified)
    e.record_attestation(
        id,
        &auth,
        &driver.pubkey(),
        [9u8; 32],
        100,
        ATTESTATION_STATUS_FLAGGED,
    )
    .unwrap();

    let d0 = e.bal(&driver.pubkey());
    let s0 = e.bal(&sponsor.pubkey());
    let caller = e.authority_kp();

    e.settle_pledge(id, ride_id, &caller, &driver.pubkey(), &sponsor.pubkey())
        .unwrap();

    // 0 to driver, 100% refund to sponsor
    assert_eq!(e.bal(&driver.pubkey()), d0);
    assert_eq!(e.bal(&sponsor.pubkey()), s0 + max);

    let p = e.pledge(&ride_id, &sponsor.pubkey()).unwrap();
    assert!(p.settled);
    assert_eq!(p.earned_lamports, 0);
    assert_eq!(p.refunded_lamports, max);
}

#[test]
fn settle_pledge_unverified_attestation_rejected() {
    let mut e = Env::new();
    let id = active_pool(&mut e);
    let driver = funded(&mut e.svm, SOL);
    let sponsor = funded(&mut e.svm, 5 * SOL);
    let auth = e.authority_kp();
    let ride_id = [7u8; 32];
    let target_km = 100u32;
    let rate = 10_000u64;
    let max = 1_000_000u64;

    e.create_pledge(id, ride_id, &driver.pubkey(), &sponsor, max, rate, target_km)
        .unwrap();

    // Attestation recorded as unverified
    e.record_attestation(
        id,
        &auth,
        &driver.pubkey(),
        [0u8; 32],
        100,
        ATTESTATION_STATUS_UNVERIFIED,
    )
    .unwrap();

    let caller = e.authority_kp();
    assert_err!(
        e.settle_pledge(id, ride_id, &caller, &driver.pubkey(), &sponsor.pubkey()),
        PoolError::UnverifiedAttestation
    );
}

#[test]
fn settle_pledge_double_settlement_rejected() {
    let mut e = Env::new();
    let id = active_pool(&mut e);
    let driver = funded(&mut e.svm, SOL);
    let sponsor = funded(&mut e.svm, 5 * SOL);
    let auth = e.authority_kp();
    let ride_id = [8u8; 32];
    let target_km = 100u32;
    let rate = 10_000u64;
    let max = 1_000_000u64;

    e.create_pledge(id, ride_id, &driver.pubkey(), &sponsor, max, rate, target_km)
        .unwrap();
    e.record_verified_attestation(id, &auth, &driver.pubkey(), 100)
        .unwrap();

    let caller = e.authority_kp();
    e.settle_pledge(id, ride_id, &caller, &driver.pubkey(), &sponsor.pubkey())
        .unwrap();

    // Second call rejected
    assert_err!(
        e.settle_pledge(id, ride_id, &caller, &driver.pubkey(), &sponsor.pubkey()),
        PoolError::AlreadySettled
    );
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
    let target_km = 100u32;
    let rate = 10_000u64;
    let max = 1_000_000u64;

    e.create_pledge(id, ride_id, &driver.pubkey(), &sponsor, max, rate, target_km)
        .unwrap();
    e.record_verified_attestation(id, &auth, &driver.pubkey(), 100)
        .unwrap();

    let caller = e.authority_kp();

    // Wrong driver passed
    assert!(
        e.settle_pledge(id, ride_id, &caller, &stranger.pubkey(), &sponsor.pubkey())
            .is_err()
    );

    // Wrong sponsor passed
    assert!(
        e.settle_pledge(id, ride_id, &caller, &driver.pubkey(), &stranger.pubkey())
            .is_err()
    );

    // Wrong ride_id passed
    assert!(
        e.settle_pledge(id, [99u8; 32], &caller, &driver.pubkey(), &sponsor.pubkey())
            .is_err()
    );
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
    let target_km = 100u32;

    // Sponsor A: 10,000 lamports/km -> 1,000,000 total
    let max_a = 1_000_000u64;
    e.create_pledge(id, ride_id, &driver.pubkey(), &sponsor_a, max_a, 10_000, target_km)
        .unwrap();

    // Sponsor B: 5,000 lamports/km -> 500,000 total
    let max_b = 500_000u64;
    e.create_pledge(id, ride_id, &driver.pubkey(), &sponsor_b, max_b, 5_000, target_km)
        .unwrap();

    // Driver completes 60 km
    e.record_verified_attestation(id, &auth, &driver.pubkey(), 60)
        .unwrap();

    let d0 = e.bal(&driver.pubkey());
    let sa0 = e.bal(&sponsor_a.pubkey());
    let sb0 = e.bal(&sponsor_b.pubkey());
    let caller = funded(&mut e.svm, SOL);

    // Settle A: 600_000 earned, 400_000 refund
    e.settle_pledge(id, ride_id, &caller, &driver.pubkey(), &sponsor_a.pubkey())
        .unwrap();
    // Settle B: 300_000 earned, 200_000 refund
    e.settle_pledge(id, ride_id, &caller, &driver.pubkey(), &sponsor_b.pubkey())
        .unwrap();

    assert_eq!(e.bal(&driver.pubkey()), d0 + 900_000);
    assert_eq!(e.bal(&sponsor_a.pubkey()), sa0 + 400_000);
    assert_eq!(e.bal(&sponsor_b.pubkey()), sb0 + 200_000);

    let pa = e.pledge(&ride_id, &sponsor_a.pubkey()).unwrap();
    let pb = e.pledge(&ride_id, &sponsor_b.pubkey()).unwrap();
    assert_eq!(pa.earned_lamports + pa.refunded_lamports, max_a);
    assert_eq!(pb.earned_lamports + pb.refunded_lamports, max_b);
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

        e.create_pledge(id, ride_id, &driver.pubkey(), &sponsor, max_lamports, rate, target_km)
            .unwrap();

        if verified_km > 0 {
            e.record_verified_attestation(id, &auth, &driver.pubkey(), verified_km)
                .unwrap();
        } else {
            e.set_attestation(id, &driver.pubkey(), 0, ATTESTATION_STATUS_VERIFIED);
        }

        let pda = pledge_pda(&ride_id, &sponsor.pubkey());
        let pda_bal_before = e.bal(&pda);

        let caller = e.authority_kp();
        e.settle_pledge(id, ride_id, &caller, &driver.pubkey(), &sponsor.pubkey())
            .unwrap();

        let p = e.pledge(&ride_id, &sponsor.pubkey()).unwrap();
        assert!(p.settled);
        assert_eq!(
            p.earned_lamports + p.refunded_lamports,
            max_lamports,
            "zero stranded lamports invariant violated in fuzz run {}",
            i
        );

        // Rent exemption remains intact in PDA
        let pda_bal_after = e.bal(&pda);
        assert_eq!(pda_bal_before - pda_bal_after, max_lamports);
    }
}

#[test]
fn challenge_exact_integer_math_primes_and_odds() {
    let mut e = Env::new();
    let id = active_pool(&mut e);
    let auth = e.authority_kp();

    // Matrix of (target_km, rate, verified_km) covering primes, odds, 0 km, and surplus km
    let cases: Vec<(u32, u64, u32, &'static str)> = vec![
        // Smallest unit
        (1, 1, 0, "1km unit zero"),
        (1, 1, 1, "1km unit exact"),
        (1, 1, 5, "1km unit surplus"),
        // Small primes
        (3, 7, 0, "prime target 3 rate 7, zero km"),
        (3, 7, 1, "prime target 3 rate 7, 1 km (truncation check)"),
        (3, 7, 2, "prime target 3 rate 7, 2 km"),
        (3, 7, 3, "prime target 3 rate 7, exact target 3 km"),
        (3, 7, 10, "prime target 3 rate 7, surplus 10 km"),
        // Medium primes
        (97, 1009, 0, "prime target 97 rate 1009, zero km"),
        (97, 1009, 1, "prime target 97 rate 1009, 1 km"),
        (97, 1009, 37, "prime target 97 rate 1009, 37 km (prime/prime)"),
        (97, 1009, 48, "prime target 97 rate 1009, 48 km (near half)"),
        (97, 1009, 96, "prime target 97 rate 1009, 96 km (target - 1)"),
        (97, 1009, 97, "prime target 97 rate 1009, exact 97 km"),
        (97, 1009, 500, "prime target 97 rate 1009, massive surplus 500 km"),
        // Indivisibles / Oddities
        (7, 13, 5, "7km target rate 13, 5 km"),
        (11, 23, 7, "11km target rate 23, 7 km"),
        (13, 29, 1, "13km target rate 29, 1 km"),
        (13, 29, 12, "13km target rate 29, 12 km"),
        // Large primes
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
            .expect(&format!("{}: create_pledge failed", label));

        if verified_km > 0 {
            e.record_verified_attestation(id, &auth, &driver.pubkey(), verified_km)
                .expect(&format!("{}: record_verified_attestation failed", label));
        } else {
            e.set_attestation(id, &driver.pubkey(), 0, ATTESTATION_STATUS_VERIFIED);
        }

        let pda = pledge_pda(&ride_id, &sponsor.pubkey());
        let pda_bal_before = e.bal(&pda);
        let driver_bal_before = e.bal(&driver.pubkey());
        let sponsor_bal_before = e.bal(&sponsor.pubkey());

        let cranker = funded(&mut e.svm, SOL);
        let r = e
            .settle_pledge(id, ride_id, &cranker, &driver.pubkey(), &sponsor.pubkey())
            .expect(&format!("{}: settle_pledge failed", label));

        let effective_km = verified_km.min(target_km);
        let expected_earned = ((max_lamports as u128 * effective_km as u128) / target_km as u128) as u64;
        let expected_refund = max_lamports - expected_earned;

        // Mathematical invariant: earned + refund == max_lamports
        assert_eq!(
            expected_earned + expected_refund,
            max_lamports,
            "{}: oracle conservation failure",
            label
        );

        // On-chain state invariant
        let p = e.pledge(&ride_id, &sponsor.pubkey()).expect("pledge exists");
        assert!(p.settled, "{}: pledge not marked settled", label);
        assert_eq!(p.earned_lamports, expected_earned, "{}: earned mismatch", label);
        assert_eq!(p.refunded_lamports, expected_refund, "{}: refund mismatch", label);
        assert_eq!(
            p.earned_lamports + p.refunded_lamports,
            max_lamports,
            "{}: on-chain conservation failure",
            label
        );

        // Balance transfer invariants
        let driver_bal_after = e.bal(&driver.pubkey());
        let sponsor_bal_after = e.bal(&sponsor.pubkey());
        let pda_bal_after = e.bal(&pda);

        assert_eq!(
            driver_bal_after - driver_bal_before,
            expected_earned,
            "{}: driver balance delta mismatch",
            label
        );
        assert_eq!(
            sponsor_bal_after - sponsor_bal_before,
            expected_refund,
            "{}: sponsor balance delta mismatch",
            label
        );
        assert_eq!(
            pda_bal_before - pda_bal_after,
            max_lamports,
            "{}: pledge PDA balance drained incorrectly",
            label
        );

        // Event emission invariants
        let evs = events::<PledgeSettled>(&r.logs);
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
    let target_km = 100u32;
    let rate = 10_000u64;
    let max = 1_000_000u64;

    e.create_pledge(id, ride_id, &driver.pubkey(), &sponsor, max, rate, target_km)
        .unwrap();
    e.record_verified_attestation(id, &auth, &driver.pubkey(), 50)
        .unwrap();

    let cranker1 = funded(&mut e.svm, SOL);
    let cranker2 = funded(&mut e.svm, SOL);
    let pda = pledge_pda(&ride_id, &sponsor.pubkey());

    // 1st call: Successful settlement
    let r1 = e.settle_pledge(id, ride_id, &cranker1, &driver.pubkey(), &sponsor.pubkey());
    assert!(r1.is_ok(), "First settlement must succeed");

    let p1 = e.pledge(&ride_id, &sponsor.pubkey()).unwrap();
    assert!(p1.settled);
    let d_bal1 = e.bal(&driver.pubkey());
    let s_bal1 = e.bal(&sponsor.pubkey());
    let p_bal1 = e.bal(&pda);

    // 2nd call by original cranker: Must fail with AlreadySettled
    assert_err!(
        e.settle_pledge(id, ride_id, &cranker1, &driver.pubkey(), &sponsor.pubkey()),
        PoolError::AlreadySettled
    );

    // 3rd call by a different cranker: Must fail with AlreadySettled
    assert_err!(
        e.settle_pledge(id, ride_id, &cranker2, &driver.pubkey(), &sponsor.pubkey()),
        PoolError::AlreadySettled
    );

    // After third-party cranker calls, driver, sponsor, and pledge balances must be exactly identical
    assert_eq!(e.bal(&driver.pubkey()), d_bal1, "Driver balance mutated on cranker double settle!");
    assert_eq!(e.bal(&sponsor.pubkey()), s_bal1, "Sponsor balance mutated on cranker double settle!");
    assert_eq!(e.bal(&pda), p_bal1, "Pledge PDA balance mutated on cranker double settle!");

    // 4th call by driver themselves: Must fail with AlreadySettled
    let d_before = e.bal(&driver.pubkey());
    assert_err!(
        e.settle_pledge(id, ride_id, &driver, &driver.pubkey(), &sponsor.pubkey()),
        PoolError::AlreadySettled
    );
    // Driver paid 5000 tx fee, received 0 lamports from pledge
    assert_eq!(e.bal(&driver.pubkey()), d_before - 5000, "Driver gained funds on failed double settle!");
    assert_eq!(e.bal(&pda), p_bal1, "Pledge PDA lost funds on driver double settle!");

    // 5th call by sponsor themselves: Must fail with AlreadySettled
    let s_before = e.bal(&sponsor.pubkey());
    assert_err!(
        e.settle_pledge(id, ride_id, &sponsor, &driver.pubkey(), &sponsor.pubkey()),
        PoolError::AlreadySettled
    );
    // Sponsor paid 5000 tx fee, received 0 lamports from pledge
    assert_eq!(e.bal(&sponsor.pubkey()), s_before - 5000, "Sponsor gained funds on failed double settle!");
    assert_eq!(e.bal(&pda), p_bal1, "Pledge PDA lost funds on sponsor double settle!");

    let p2 = e.pledge(&ride_id, &sponsor.pubkey()).unwrap();
    assert_eq!(p2.earned_lamports, p1.earned_lamports);
    assert_eq!(p2.refunded_lamports, p1.refunded_lamports);
}

#[test]
fn challenge_flagged_driver_scenarios() {
    let mut e = Env::new();
    let id = active_pool(&mut e);
    let auth = e.authority_kp();

    // Test cases with various claimed distances for a FLAGGED driver
    let cases = vec![
        (0u32, "flagged with 0 km"),
        (25u32, "flagged with 25% km"),
        (100u32, "flagged with 100% full target km"),
        (500u32, "flagged with 500% surplus km"),
    ];

    for (idx, (verified_km, label)) in cases.into_iter().enumerate() {
        let driver = funded(&mut e.svm, SOL);
        let sponsor = funded(&mut e.svm, 5 * SOL);
        let mut ride_id = [0xFA; 32];
        ride_id[0] = idx as u8;
        let target_km = 100u32;
        let rate = 10_000u64;
        let max = 1_000_000u64;

        e.create_pledge(id, ride_id, &driver.pubkey(), &sponsor, max, rate, target_km)
            .unwrap();

        // Authority records attestation as FLAGGED
        e.record_attestation(
            id,
            &auth,
            &driver.pubkey(),
            [0xCC; 32],
            verified_km,
            ATTESTATION_STATUS_FLAGGED,
        )
        .unwrap();

        let d0 = e.bal(&driver.pubkey());
        let s0 = e.bal(&sponsor.pubkey());
        let cranker = funded(&mut e.svm, SOL);

        let r = e
            .settle_pledge(id, ride_id, &cranker, &driver.pubkey(), &sponsor.pubkey())
            .expect(&format!("{}: settlement should succeed", label));

        // Driver must receive 0, sponsor must receive full 100%
        assert_eq!(e.bal(&driver.pubkey()), d0, "{}: Driver received non-zero funds!", label);
        assert_eq!(e.bal(&sponsor.pubkey()), s0 + max, "{}: Sponsor did not receive 100% refund!", label);

        let p = e.pledge(&ride_id, &sponsor.pubkey()).unwrap();
        assert!(p.settled);
        assert_eq!(p.earned_lamports, 0, "{}: p.earned_lamports != 0", label);
        assert_eq!(p.refunded_lamports, max, "{}: p.refunded_lamports != max", label);
        assert_eq!(p.earned_lamports + p.refunded_lamports, max);

        let evs = events::<PledgeSettled>(&r.logs);
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

    // 50 diverse iterations with pseudorandom prime-dense distribution
    for iter in 0..50u8 {
        let driver = funded(&mut e.svm, SOL);
        let sponsor = funded(&mut e.svm, 20 * SOL);
        let mut ride_id = [0xEE; 32];
        ride_id[0] = iter;

        let target_km = rng.range(1, 1000) as u32;
        let rate = rng.range(1, 50_000);
        let max_lamports = rate * (target_km as u64);

        // Mix of 0, partial, full, and massive surplus verified_km
        let verified_km = match iter % 5 {
            0 => 0u32, // zero km
            1 => target_km, // exact target km
            2 => target_km + rng.range(1, 500) as u32, // surplus km
            3 => target_km * 3, // 3x surplus km
            _ => rng.range(0, target_km as u64) as u32, // fractional partial km
        };

        e.create_pledge(id, ride_id, &driver.pubkey(), &sponsor, max_lamports, rate, target_km)
            .unwrap();

        if verified_km > 0 {
            e.record_verified_attestation(id, &auth, &driver.pubkey(), verified_km)
                .unwrap();
        } else {
            e.set_attestation(id, &driver.pubkey(), 0, ATTESTATION_STATUS_VERIFIED);
        }

        let pda = pledge_pda(&ride_id, &sponsor.pubkey());
        let pda_bal_before = e.bal(&pda);
        let d_bal_before = e.bal(&driver.pubkey());
        let s_bal_before = e.bal(&sponsor.pubkey());

        let cranker = funded(&mut e.svm, SOL);
        let r = e
            .settle_pledge(id, ride_id, &cranker, &driver.pubkey(), &sponsor.pubkey())
            .unwrap();

        // Mathematical Oracle
        let effective_km = verified_km.min(target_km);
        let oracle_earned = ((max_lamports as u128 * effective_km as u128) / target_km as u128) as u64;
        let oracle_refund = max_lamports - oracle_earned;

        // Invariant 1: Exact integer conservation in oracle
        assert_eq!(oracle_earned + oracle_refund, max_lamports);

        // Invariant 2: On-chain account state matches oracle
        let p = e.pledge(&ride_id, &sponsor.pubkey()).unwrap();
        assert!(p.settled);
        assert_eq!(p.earned_lamports, oracle_earned);
        assert_eq!(p.refunded_lamports, oracle_refund);
        assert_eq!(p.earned_lamports + p.refunded_lamports, max_lamports);

        // Invariant 3: Balance transfers match oracle
        assert_eq!(e.bal(&driver.pubkey()) - d_bal_before, oracle_earned);
        assert_eq!(e.bal(&sponsor.pubkey()) - s_bal_before, oracle_refund);
        assert_eq!(pda_bal_before - e.bal(&pda), max_lamports);

        // Invariant 4: Event matches oracle
        let evs = events::<PledgeSettled>(&r.logs);
        assert_eq!(evs[0].earned_lamports, oracle_earned);
        assert_eq!(evs[0].refunded_lamports, oracle_refund);
        assert_eq!(evs[0].verified_km, verified_km);
    }
}

