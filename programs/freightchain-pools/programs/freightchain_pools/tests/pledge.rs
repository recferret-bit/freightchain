#[macro_use]
mod common;

use common::*;
use freightchain_pools::{
    accounts,
    constants::*,
    error::PoolError,
    events::{PledgeCreated, PledgeRefunded, PledgeSettled},
    instruction, CreatePoolParams, RideAttestation,
};
use litesvm::types::TransactionMetadata;
use solana_keypair::Keypair;
use anchor_lang::{prelude::Pubkey, solana_program::system_program, AccountDeserialize, Discriminator};
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

/// settle_pledge by a third-party caller as soon as the ride's attestation allows (`settle_from`), with the zero-stranded check: driver + sponsor
/// gains == the pledge's balance, which ends at 0; the pool's open pledges drop by one and the attestation counts the settle (it is final now).
fn settle_measured(e: &mut Env, id: u32, ride_id: [u8; 32], caller: &Keypair, driver: &Pubkey, sponsor: &Pubkey, max: u64) -> Settled {
    let from = e.ride_attestation(id, &ride_id).expect("ride attestation").settle_from;
    if e.now() < from {
        e.warp(from);
    }
    let pda = pledge_pda(&ride_id, sponsor);
    let before = e.bal(&pda);
    let (d0, s0) = (e.bal(driver), e.bal(sponsor));
    let (open0, n0) = (e.pool(id).open_pledges, e.ride_attestation(id, &ride_id).unwrap().settled_pledges);
    let r = e.settle_pledge(id, ride_id, caller, driver, sponsor).unwrap();
    assert!(e.pledge(&ride_id, sponsor).is_none(), "settle closes the pledge account");
    assert_eq!(e.bal(&pda), 0);
    let (earned, back) = (e.bal(driver) - d0, e.bal(sponsor) - s0);
    assert_eq!(earned + back, before, "zero stranded lamports");
    assert_eq!(e.pool(id).open_pledges, open0 - 1, "settle closes one open pledge");
    assert_eq!(e.ride_attestation(id, &ride_id).unwrap().settled_pledges, n0 + 1);
    Settled { r, earned, back, rent: before - max }
}

/// Anchor's AccountNotInitialized: the pledge account is gone (settled or refunded) – or the ride has no attestation.
fn assert_closed_err(res: Res) {
    let e = res.expect_err("expected the missing account to be refused");
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
impl Open for CreatePoolParams {
    fn with_open(mut self) -> Self {
        self.max_tickets = 0;
        self.max_per_wallet = 100;
        self.min_tickets = 2;
        self
    }
}

/// the admin names a funded payout key (the server's PAYOUT_SECRET)
fn payout_key(e: &mut Env) -> Keypair {
    let payout = funded(&mut e.svm, 10 * SOL);
    let a = e.authority_kp();
    e.set_payout_authority(&a, Some(payout.pubkey())).unwrap();
    payout
}

/// the server's rideIdToBytes: a ride uuid's 16 bytes, zero-padded to 32
fn ride(uuid: u128) -> [u8; 32] {
    let mut r = [0u8; 32];
    r[..16].copy_from_slice(&uuid.to_be_bytes());
    r
}

/// An Active pool closed the v4 way before its grace: an empty winners root (no prize), its lock waited out, close_pool by the admin → Settled.
fn settle_pool(e: &mut Env, id: u32) {
    let payout_at = e.pool(id).payout_at;
    if e.now() < payout_at {
        e.warp(payout_at);
    }
    let auth = e.authority_kp();
    e.commit_and_pay(id, &auth, &[]);
    e.close_pool(id, &auth).unwrap();
    assert_eq!(e.pool(id).status, STATUS_SETTLED);
}

/// A RideAttestation written straight into its account – what the program itself refuses to write (VERIFIED with 0 km, another driver): the
/// settle maths must still hold on it. Settles from the pool's payout time.
fn set_ride_attestation(e: &mut Env, id: u32, ride_id: [u8; 32], driver: &Pubkey, verified_km: u32, status: u8) {
    let pda = ride_attestation_pda(id, &ride_id);
    let a = RideAttestation {
        pool: pool_pda(id),
        ride_id,
        driver: *driver,
        telemetry_root: [1u8; 32],
        verified_km,
        status,
        recorded_at: e.now(),
        settle_from: e.pool(id).payout_at.max(e.now()),
        settled_pledges: 0,
        rent_payer: e.authority.pubkey(),
        bump: Pubkey::find_program_address(&[b"ride_attestation", pool_pda(id).as_ref(), &ride_id], &pid()).1,
    };
    let mut data = RideAttestation::DISCRIMINATOR.to_vec();
    anchor_lang::AnchorSerialize::serialize(&a, &mut data).unwrap();
    let need = e.svm.minimum_balance_for_rent_exemption(data.len());
    e.svm.airdrop(&pda, need).unwrap();
    let mut acc = e.svm.get_account(&pda).unwrap();
    acc.data = data;
    acc.owner = pid();
    e.svm.set_account(pda, acc).unwrap();
}

/// settle_pledge with every account given by hand – to present one ride's attestation for another ride's pledge
fn settle_ix(id: u32, ride_id: [u8; 32], caller: &Pubkey, driver: &Pubkey, sponsor: &Pubkey, attestation: Pubkey, pledge: Pubkey) -> anchor_lang::solana_program::instruction::Instruction {
    ix(
        instruction::SettlePledge { ride_id },
        accounts::SettlePledge {
            caller: *caller,
            driver: *driver,
            sponsor: *sponsor,
            config: config_pda(),
            pool: pool_pda(id),
            ride_attestation: attestation,
            pledge,
            system_program: system_program::ID,
        },
    )
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
    assert_eq!(e.pool(id).open_pledges, 1, "v4 (L7): the pool counts its open pledges");

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
    assert_eq!(e.pool(id).open_pledges, 0);
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
    e.record_verified_ride(id, &auth, ride_id, &driver.pubkey(), 100).unwrap();

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
    e.record_verified_ride(id, &auth, ride_id, &driver.pubkey(), 45).unwrap();

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
    // written directly: verified_km = 0, status = VERIFIED (record_ride_attestation refuses it – ZeroVerifiedKm)
    set_ride_attestation(&mut e, id, ride_id, &driver.pubkey(), 0, ATTESTATION_STATUS_VERIFIED);

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
    e.record_verified_ride(id, &auth, ride_id, &driver.pubkey(), 250).unwrap();

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
    e.record_verified_ride(id, &auth, ride_id, &driver.pubkey(), 1).unwrap();

    let caller = e.authority_kp();
    let s = settle_measured(&mut e, id, ride_id, &caller, &driver.pubkey(), &sponsor.pubkey(), max);
    // 999 * 1 / 3 = 333 earned, 666 back
    assert_eq!(s.earned, 333);
    assert_eq!(s.back, 666 + s.rent);
}

#[test]
fn settle_pledge_flagged_ride_yields_full_refund() {
    let mut e = Env::new();
    let id = active_pool(&mut e);
    let driver = funded(&mut e.svm, SOL);
    let sponsor = funded(&mut e.svm, 5 * SOL);
    let auth = e.authority_kp();
    let ride_id = [6u8; 32];
    let max = 1_000_000u64;

    e.create_pledge(id, ride_id, &driver.pubkey(), &sponsor, max, 10_000, 100).unwrap();
    // the ride was flagged (cheated or disqualified)
    e.record_ride_attestation(id, &auth, ride_id, &driver.pubkey(), [9u8; 32], 100, ATTESTATION_STATUS_FLAGGED).unwrap();

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
    e.record_ride_attestation(id, &auth, ride_id, &driver.pubkey(), [0u8; 32], 100, ATTESTATION_STATUS_UNVERIFIED).unwrap();

    e.warp(PAYOUT);
    let caller = e.authority_kp();
    assert_err!(
        e.settle_pledge(id, ride_id, &caller, &driver.pubkey(), &sponsor.pubkey()),
        PoolError::UnverifiedAttestation
    );
    assert!(e.pledge(&ride_id, &sponsor.pubkey()).is_some());
    assert_eq!(e.pool(id).open_pledges, 1);
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
    e.record_verified_ride(id, &auth, ride_id, &driver.pubkey(), 100).unwrap();

    e.warp(PAYOUT);
    let caller = e.authority_kp();
    e.settle_pledge(id, ride_id, &caller, &driver.pubkey(), &sponsor.pubkey()).unwrap();
    // the account is closed: a second settle finds nothing, and the counter is not decremented twice
    e.svm.expire_blockhash();
    assert_closed_err(e.settle_pledge(id, ride_id, &caller, &driver.pubkey(), &sponsor.pubkey()));
    assert_eq!(e.pool(id).open_pledges, 0);
    assert_eq!(e.ride_attestation(id, &ride_id).unwrap().settled_pledges, 1);
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
    e.record_verified_ride(id, &auth, ride_id, &driver.pubkey(), 100).unwrap();

    e.warp(PAYOUT);
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
    assert_eq!(e.pool(id).open_pledges, 2);
    // 60 km
    e.record_verified_ride(id, &auth, ride_id, &driver.pubkey(), 60).unwrap();

    let caller = funded(&mut e.svm, SOL);
    let a = settle_measured(&mut e, id, ride_id, &caller, &driver.pubkey(), &sponsor_a.pubkey(), 1_000_000);
    // the attestation is final after the first settle – the second sponsor still settles on it
    let b = settle_measured(&mut e, id, ride_id, &caller, &driver.pubkey(), &sponsor_b.pubkey(), 500_000);
    assert_eq!(a.earned + b.earned, 900_000);
    assert_eq!(a.back, 400_000 + a.rent);
    assert_eq!(b.back, 200_000 + b.rent);
    assert_eq!(e.ride_attestation(id, &ride_id).unwrap().settled_pledges, 2);
    assert_eq!(e.pool(id).open_pledges, 0);
}

#[test]
fn settle_pledge_fuzz_zero_stranded_lamports() {
    let mut e = Env::new();
    let id = active_pool(&mut e);
    let auth = e.authority_kp();
    let mut rng = Rng(123456789);

    // every pledge is made while rides count, every one settles after the payout time: two passes
    let mut runs = vec![];
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
            e.record_verified_ride(id, &auth, ride_id, &driver.pubkey(), verified_km).unwrap();
        } else {
            set_ride_attestation(&mut e, id, ride_id, &driver.pubkey(), 0, ATTESTATION_STATUS_VERIFIED);
        }
        runs.push((driver, sponsor, ride_id, max_lamports));
    }
    assert_eq!(e.pool(id).open_pledges, 25);
    for (i, (driver, sponsor, ride_id, max_lamports)) in runs.into_iter().enumerate() {
        let caller = e.authority_kp();
        let s = settle_measured(&mut e, id, ride_id, &caller, &driver.pubkey(), &sponsor.pubkey(), max_lamports);
        let ev = &events::<PledgeSettled>(&s.r.logs)[0];
        assert_eq!(ev.earned_lamports + ev.refunded_lamports, max_lamports, "conservation, fuzz run {}", i);
        assert_eq!(s.earned, ev.earned_lamports, "driver delta, fuzz run {}", i);
        assert_eq!(s.back, ev.refunded_lamports + s.rent, "sponsor delta, fuzz run {}", i);
    }
    assert_eq!(e.pool(id).open_pledges, 0);
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

    let mut runs = vec![];
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
            e.record_verified_ride(id, &auth, ride_id, &driver.pubkey(), verified_km)
                .unwrap_or_else(|_| panic!("{}: record_verified_ride failed", label));
        } else {
            set_ride_attestation(&mut e, id, ride_id, &driver.pubkey(), 0, ATTESTATION_STATUS_VERIFIED);
        }
        runs.push((driver, sponsor, ride_id, max_lamports, target_km, verified_km, label));
    }

    for (driver, sponsor, ride_id, max_lamports, target_km, verified_km, label) in runs {
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
    e.record_verified_ride(id, &auth, ride_id, &driver.pubkey(), 50).unwrap();

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
    assert_eq!(e.pool(id).open_pledges, 0);
}

#[test]
fn challenge_flagged_ride_scenarios() {
    let mut e = Env::new();
    let id = active_pool(&mut e);
    let auth = e.authority_kp();

    // a FLAGGED ride earns nothing whatever distance the attestation names
    let mut runs = vec![];
    for (idx, verified_km) in [0u32, 25, 100, 500].into_iter().enumerate() {
        let driver = funded(&mut e.svm, SOL);
        let sponsor = funded(&mut e.svm, 5 * SOL);
        let mut ride_id = [0xFA; 32];
        ride_id[0] = idx as u8;
        e.create_pledge(id, ride_id, &driver.pubkey(), &sponsor, 1_000_000, 10_000, 100).unwrap();
        e.record_ride_attestation(id, &auth, ride_id, &driver.pubkey(), [0xCC; 32], verified_km, ATTESTATION_STATUS_FLAGGED).unwrap();
        runs.push((driver, sponsor, ride_id, verified_km));
    }

    for (driver, sponsor, ride_id, verified_km) in runs {
        let max = 1_000_000u64;
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

    let mut runs = vec![];
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
            e.record_verified_ride(id, &auth, ride_id, &driver.pubkey(), verified_km).unwrap();
        } else {
            set_ride_attestation(&mut e, id, ride_id, &driver.pubkey(), 0, ATTESTATION_STATUS_VERIFIED);
        }
        runs.push((driver, sponsor, ride_id, max_lamports, target_km, verified_km));
    }

    for (driver, sponsor, ride_id, max_lamports, target_km, verified_km) in runs {
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

// ---- H4: a pledge settles on ITS ride's attestation ---------------------------------------------------------------------------------------------

/// PoC s1-claude-02 (poc_02) / S1-GPT-01 (s1gpt_01): a driver with two tickets finishes ride A (verified), lets spectators pledge on ride B and
/// abandons it at 0 km. v3 paid ride B's pledge in full from the per-driver attestation (= ride A). v4: ride B has no attestation, so its pledge
/// cannot settle – not even with ride A's attestation presented by hand – and goes back to the sponsor once the pool is over.
#[test]
fn h4_a_pledge_on_an_unfinished_ride_is_not_paid_from_the_drivers_other_ride() {
    let mut e = Env::new();
    let payout = payout_key(&mut e);
    let id = e.create_pool(default_params().with_open());
    let driver = funded(&mut e.svm, 10 * SOL);
    e.buy(id, &driver, 2).unwrap(); // a ticket for ride A and one for ride B
    let (ride_a, ride_b) = (ride(0x0a0a_0000_0000_4000_8000_0000_0000_000a), ride(0x0b0b_0000_0000_4000_8000_0000_0000_000b));
    let (sponsor_a, sponsor_b) = (funded(&mut e.svm, 5 * SOL), funded(&mut e.svm, 5 * SOL));
    let (rate, target) = (10_000_000u64, 25u32); // 0.01 SOL per km, up to 25 km
    let cap = rate * target as u64;
    e.warp(PREP + 60);
    e.create_pledge(id, ride_a, &driver.pubkey(), &sponsor_a, cap, rate, target).unwrap();
    e.create_pledge(id, ride_b, &driver.pubkey(), &sponsor_b, cap, rate, target).unwrap();
    // ride A: driven to the line and verified; ride B abandoned – the server attests nothing for it
    e.warp(PLAY);
    e.record_ride_attestation(id, &payout, ride_a, &driver.pubkey(), [0xA1; 32], 25, ATTESTATION_STATUS_VERIFIED).unwrap();
    assert!(e.ride_attestation(id, &ride_b).is_none());

    let anyone = funded(&mut e.svm, SOL);
    let d0 = e.bal(&driver.pubkey());
    // ride B's own attestation does not exist
    assert_closed_err(e.settle_pledge(id, ride_b, &anyone, &driver.pubkey(), &sponsor_b.pubkey()));
    // ride A's attestation presented for ride B's pledge: the attestation PDA is seeded with the pledge's ride id
    let i = settle_ix(id, ride_b, &anyone.pubkey(), &driver.pubkey(), &sponsor_b.pubkey(), ride_attestation_pda(id, &ride_a), pledge_pda(&ride_b, &sponsor_b.pubkey()));
    assert!(e.send(&[i], &anyone, &[]).is_err(), "ride A's attestation settled ride B's pledge");
    // ... and ride B's pledge presented under ride A's id: the pledge PDA is seeded with the ride id too
    let i = settle_ix(id, ride_a, &anyone.pubkey(), &driver.pubkey(), &sponsor_b.pubkey(), ride_attestation_pda(id, &ride_a), pledge_pda(&ride_b, &sponsor_b.pubkey()));
    assert!(e.send(&[i], &anyone, &[]).is_err(), "ride B's pledge settled under ride A's id");
    assert_eq!(e.bal(&driver.pubkey()), d0, "nothing paid for ride B");
    assert!(e.pledge(&ride_b, &sponsor_b.pubkey()).is_some());

    // ride A's own pledge pays ride A's km
    let s = settle_measured(&mut e, id, ride_a, &anyone, &driver.pubkey(), &sponsor_a.pubkey(), cap);
    assert_eq!(s.earned, cap);

    // pool over: ride B's pledge goes back to its sponsor, whole
    settle_pool(&mut e, id);
    let d1 = e.bal(&driver.pubkey());
    assert_refunded(&mut e, id, ride_b, &driver.pubkey(), &sponsor_b.pubkey(), cap);
    assert_eq!(e.bal(&driver.pubkey()), d1);
    assert_eq!(e.pool(id).open_pledges, 0);
}

/// H4: two rides of one driver in one pool – each pledge pays its own ride's km, not the better ride's.
#[test]
fn h4_two_rides_of_one_driver_each_pledge_pays_its_own_km() {
    let mut e = Env::new();
    let payout = payout_key(&mut e);
    let id = active_pool(&mut e);
    let driver = funded(&mut e.svm, SOL);
    let (sponsor_a, sponsor_b) = (funded(&mut e.svm, 5 * SOL), funded(&mut e.svm, 5 * SOL));
    let (ride_a, ride_b) = (ride(0xA), ride(0xB));
    e.create_pledge(id, ride_a, &driver.pubkey(), &sponsor_a, 1_000_000, 10_000, 100).unwrap();
    e.create_pledge(id, ride_b, &driver.pubkey(), &sponsor_b, 1_000_000, 10_000, 100).unwrap();
    e.warp(PLAY);
    e.record_verified_ride(id, &payout, ride_a, &driver.pubkey(), 120).unwrap();
    e.record_verified_ride(id, &payout, ride_b, &driver.pubkey(), 3).unwrap(); // crashed early
    let caller = funded(&mut e.svm, SOL);
    let b = settle_measured(&mut e, id, ride_b, &caller, &driver.pubkey(), &sponsor_b.pubkey(), 1_000_000);
    let a = settle_measured(&mut e, id, ride_a, &caller, &driver.pubkey(), &sponsor_a.pubkey(), 1_000_000);
    assert_eq!(b.earned, 30_000, "ride B pays 3 km of 100");
    assert_eq!(b.back, 970_000 + b.rent);
    assert_eq!(a.earned, 1_000_000);
}

/// H4 / S1-GPT-02's second half: a verdict changed in review rewrites the ride's attestation – before any settle the new verdict decides, and
/// the rewrite restarts the review lock.
#[test]
fn h4_a_rewrite_before_any_settle_changes_the_outcome_and_restarts_the_lock() {
    let mut e = Env::new();
    let payout = payout_key(&mut e);
    let id = active_pool(&mut e);
    let driver = funded(&mut e.svm, SOL);
    let sponsor = funded(&mut e.svm, 5 * SOL);
    let r = ride(0x77);
    e.create_pledge(id, r, &driver.pubkey(), &sponsor, 1_000_000, 10_000, 100).unwrap();
    e.record_ride_attestation(id, &payout, r, &driver.pubkey(), [7; 32], 100, ATTESTATION_STATUS_VERIFIED).unwrap();
    let first = e.ride_attestation(id, &r).unwrap();
    assert_eq!((first.status, first.verified_km, first.settled_pledges), (ATTESTATION_STATUS_VERIFIED, 100, 0));
    assert_eq!(first.settle_from, PAYOUT);
    assert_eq!(first.rent_payer, payout.pubkey());

    // the review flags the ride
    e.warp(PAYOUT + 10);
    e.record_ride_attestation(id, &payout, r, &driver.pubkey(), [8; 32], 100, ATTESTATION_STATUS_FLAGGED).unwrap();
    let flagged = e.ride_attestation(id, &r).unwrap();
    assert_eq!((flagged.status, flagged.telemetry_root, flagged.recorded_at), (ATTESTATION_STATUS_FLAGGED, [8; 32], PAYOUT + 10));
    assert_eq!(flagged.settle_from, PAYOUT + 10, "every write re-stamps settle_from");
    assert_eq!(flagged.rent_payer, payout.pubkey(), "a rewrite keeps the rent payer");

    let caller = funded(&mut e.svm, SOL);
    let s = settle_measured(&mut e, id, r, &caller, &driver.pubkey(), &sponsor.pubkey(), 1_000_000);
    assert_eq!(s.earned, 0);
    assert_eq!(s.back, 1_000_000 + s.rent);
}

/// H4: once a pledge was settled on a ride attestation it is final – a later rewrite (either way) is refused, so every sponsor of that ride
/// settles on the same verdict.
#[test]
fn h4_a_settled_on_attestation_is_final() {
    let mut e = Env::new();
    let payout = payout_key(&mut e);
    let id = active_pool(&mut e);
    let driver = funded(&mut e.svm, SOL);
    let (sponsor_a, sponsor_b) = (funded(&mut e.svm, 5 * SOL), funded(&mut e.svm, 5 * SOL));
    let r = ride(0x78);
    e.create_pledge(id, r, &driver.pubkey(), &sponsor_a, 1_000_000, 10_000, 100).unwrap();
    e.create_pledge(id, r, &driver.pubkey(), &sponsor_b, 1_000_000, 10_000, 100).unwrap();
    e.record_verified_ride(id, &payout, r, &driver.pubkey(), 60).unwrap();
    let caller = funded(&mut e.svm, SOL);
    let a = settle_measured(&mut e, id, r, &caller, &driver.pubkey(), &sponsor_a.pubkey(), 1_000_000);
    assert_eq!(a.earned, 600_000);

    assert_err!(
        e.record_ride_attestation(id, &payout, r, &driver.pubkey(), [9; 32], 60, ATTESTATION_STATUS_FLAGGED),
        PoolError::AttestationFinal
    );
    let auth = e.authority_kp();
    assert_err!(e.record_verified_ride(id, &auth, r, &driver.pubkey(), 100), PoolError::AttestationFinal);
    let att = e.ride_attestation(id, &r).unwrap();
    assert_eq!((att.status, att.verified_km, att.settled_pledges), (ATTESTATION_STATUS_VERIFIED, 60, 1));

    let b = settle_measured(&mut e, id, r, &caller, &driver.pubkey(), &sponsor_b.pubkey(), 1_000_000);
    assert_eq!(b.earned, 600_000, "the second sponsor settles on the same verdict");
}

/// H4: a ride's driver never changes – a rewrite naming another driver is refused, and a (forged) attestation naming another driver than the
/// pledge's does not pay; nor does presenting the attestation's driver instead of the pledge's.
#[test]
fn h4_a_rides_driver_is_fixed_and_must_match_the_pledge() {
    let mut e = Env::new();
    let payout = payout_key(&mut e);
    let id = active_pool(&mut e);
    let (driver, other) = (funded(&mut e.svm, SOL), funded(&mut e.svm, SOL));
    let sponsor = funded(&mut e.svm, 5 * SOL);
    let (r, forged) = (ride(0x79), ride(0x7A));
    e.create_pledge(id, r, &driver.pubkey(), &sponsor, 1_000_000, 10_000, 100).unwrap();
    e.create_pledge(id, forged, &driver.pubkey(), &sponsor, 1_000_000, 10_000, 100).unwrap();
    e.record_verified_ride(id, &payout, r, &driver.pubkey(), 50).unwrap();
    assert_err!(e.record_verified_ride(id, &payout, r, &other.pubkey(), 50), PoolError::AttestationMismatch);

    // the program never writes it; a forged account must still not pay
    set_ride_attestation(&mut e, id, forged, &other.pubkey(), 50, ATTESTATION_STATUS_VERIFIED);
    e.warp(PAYOUT);
    let caller = funded(&mut e.svm, SOL);
    assert_err!(e.settle_pledge(id, forged, &caller, &driver.pubkey(), &sponsor.pubkey()), PoolError::AttestationMismatch);
    assert_err!(e.settle_pledge(id, forged, &caller, &other.pubkey(), &sponsor.pubkey()), PoolError::AccountMismatch);
    assert!(e.pledge(&forged, &sponsor.pubkey()).is_some());
    let s = settle_measured(&mut e, id, r, &caller, &driver.pubkey(), &sponsor.pubkey(), 1_000_000);
    assert_eq!(s.earned, 500_000);
}

#[test]
fn record_ride_attestation_guards() {
    let mut e = Env::new();
    let payout = payout_key(&mut e);
    let auth = e.authority_kp();
    let driver = funded(&mut e.svm, SOL);
    // OPEN pool: nothing to attest yet
    let open = e.create_pool(default_params().with_open());
    assert_err!(e.record_verified_ride(open, &auth, ride(1), &driver.pubkey(), 5), PoolError::PoolNotActive);

    let id = active_pool(&mut e);
    let rando = funded(&mut e.svm, SOL);
    assert_err!(e.record_verified_ride(id, &rando, ride(1), &driver.pubkey(), 5), PoolError::Unauthorized);
    assert_err!(e.record_ride_attestation(id, &auth, ride(1), &driver.pubkey(), [1; 32], 5, 3), PoolError::InvalidAttestationStatus);
    assert_err!(e.record_ride_attestation(id, &auth, ride(1), &driver.pubkey(), [0; 32], 5, ATTESTATION_STATUS_VERIFIED), PoolError::InvalidParams);
    assert_err!(e.record_ride_attestation(id, &auth, ride(1), &driver.pubkey(), [1; 32], 0, ATTESTATION_STATUS_VERIFIED), PoolError::ZeroVerifiedKm);
    // UNVERIFIED / FLAGGED need no root or km
    e.record_ride_attestation(id, &payout, ride(1), &driver.pubkey(), [0; 32], 0, ATTESTATION_STATUS_UNVERIFIED).unwrap();
    e.record_ride_attestation(id, &auth, ride(2), &driver.pubkey(), [0; 32], 0, ATTESTATION_STATUS_FLAGGED).unwrap();
    assert_eq!(e.ride_attestation(id, &ride(1)).unwrap().rent_payer, payout.pubkey());
    assert_eq!(e.ride_attestation(id, &ride(2)).unwrap().rent_payer, auth.pubkey());

    // a settled pool takes no new verdicts
    settle_pool(&mut e, id);
    assert_err!(e.record_verified_ride(id, &payout, ride(3), &driver.pubkey(), 5), PoolError::PoolNotActive);
}

// ---- L5: no settle before the payout time and the review lock ---------------------------------------------------------------------------------

/// a pool on the production floors (Env::with_floors): play − prep = min_finish_secs, payout − play = min_review_secs (both boundary-exact)
fn floors_params() -> CreatePoolParams {
    let prep = T0 + 1_000;
    let play = prep + DEFAULT_MIN_FINISH_SECS;
    CreatePoolParams { prep_deadline: prep, play_deadline: play, payout_at: play + DEFAULT_MIN_REVIEW_SECS, ..default_params().with_open() }
}

/// PoC s1-claude-04 (poc_04): a pledge created and settled mid-play by the driver himself. v4: settle waits for the payout time and for the
/// review lock after the attestation's last write (`settle_from` = max(payout_at, recorded_at + max(payout − play, min_review_secs))).
#[test]
fn l5_settle_waits_for_the_payout_time_and_the_review_lock_on_the_floors() {
    let mut e = Env::with_floors();
    assert_eq!(e.config().min_review_secs, DEFAULT_MIN_REVIEW_SECS);
    let payout = payout_key(&mut e);
    let p = floors_params();
    let (play, payout_at) = (p.play_deadline, p.payout_at);
    let id = e.create_pool(p);
    let b = funded(&mut e.svm, 20 * SOL);
    e.buy(id, &b, 5).unwrap();
    let driver = funded(&mut e.svm, SOL);
    let sponsor = funded(&mut e.svm, 10 * SOL);
    let (early, at_play, late) = (ride(0x51), ride(0x52), ride(0x53));
    e.warp(T0 + 1_010); // the play window
    for r in [early, at_play, late] {
        e.create_pledge(id, r, &driver.pubkey(), &sponsor, 1_000_000, 10_000, 100).unwrap();
    }

    // poc_04: an attestation that exists mid-play; the driver cranks the settle at once
    e.record_verified_ride(id, &payout, early, &driver.pubkey(), 100).unwrap();
    assert_eq!(e.ride_attestation(id, &early).unwrap().settle_from, payout_at, "an early record settles from payout_at");
    assert_err!(e.settle_pledge(id, early, &driver, &driver.pubkey(), &sponsor.pubkey()), PoolError::TooEarly);

    // recorded at the play deadline: the lock (3600) ends exactly at payout_at
    e.warp(play);
    e.record_verified_ride(id, &payout, at_play, &driver.pubkey(), 100).unwrap();
    assert_eq!(e.ride_attestation(id, &at_play).unwrap().settle_from, payout_at);

    // recorded 100 s before payout_at: the lock runs past it
    e.warp(payout_at - 100);
    e.record_verified_ride(id, &payout, late, &driver.pubkey(), 100).unwrap();
    let late_from = payout_at - 100 + DEFAULT_MIN_REVIEW_SECS;
    assert_eq!(e.ride_attestation(id, &late).unwrap().settle_from, late_from);

    let caller = funded(&mut e.svm, SOL);
    e.warp(payout_at - 1);
    for r in [early, at_play, late] {
        assert_err!(e.settle_pledge(id, r, &caller, &driver.pubkey(), &sponsor.pubkey()), PoolError::TooEarly);
    }
    e.warp(payout_at);
    e.settle_pledge(id, early, &caller, &driver.pubkey(), &sponsor.pubkey()).unwrap();
    e.settle_pledge(id, at_play, &caller, &driver.pubkey(), &sponsor.pubkey()).unwrap();
    assert_err!(e.settle_pledge(id, late, &caller, &driver.pubkey(), &sponsor.pubkey()), PoolError::TooEarly);
    e.warp(late_from - 1);
    assert_err!(e.settle_pledge(id, late, &caller, &driver.pubkey(), &sponsor.pubkey()), PoolError::TooEarly);
    e.warp(late_from);
    let s = settle_measured(&mut e, id, late, &caller, &driver.pubkey(), &sponsor.pubkey(), 1_000_000);
    assert_eq!(s.earned, 1_000_000);
    assert_eq!(e.pool(id).open_pledges, 0);
}

/// L5: a rewrite after the payout time restarts the lock – a verdict changed late is public for the whole lock before it pays.
#[test]
fn l5_a_rewrite_restarts_the_review_lock() {
    let mut e = Env::with_floors();
    let payout = payout_key(&mut e);
    let p = floors_params();
    let payout_at = p.payout_at;
    let id = e.create_pool(p);
    let b = funded(&mut e.svm, 20 * SOL);
    e.buy(id, &b, 5).unwrap();
    let driver = funded(&mut e.svm, SOL);
    let sponsor = funded(&mut e.svm, 10 * SOL);
    let r = ride(0x54);
    e.create_pledge(id, r, &driver.pubkey(), &sponsor, 1_000_000, 10_000, 100).unwrap();
    e.record_verified_ride(id, &payout, r, &driver.pubkey(), 100).unwrap();
    // nobody settled at payout_at; the verdict is lowered 100 s later
    e.warp(payout_at + 100);
    e.record_verified_ride(id, &payout, r, &driver.pubkey(), 40).unwrap();
    let from = payout_at + 100 + DEFAULT_MIN_REVIEW_SECS;
    assert_eq!(e.ride_attestation(id, &r).unwrap().settle_from, from);
    let caller = funded(&mut e.svm, SOL);
    e.warp(from - 1);
    assert_err!(e.settle_pledge(id, r, &caller, &driver.pubkey(), &sponsor.pubkey()), PoolError::TooEarly);
    let s = settle_measured(&mut e, id, r, &caller, &driver.pubkey(), &sponsor.pubkey(), 1_000_000);
    assert_eq!(s.earned, 400_000);
}

/// PoC S1-GPT-02 (s1gpt_02): a VERIFIED attestation lands while rides still count and the driver settles at once; the review then flags the ride
/// – too late in v3. v4: the settle waits for the pool's own review window (the lock is the longer of it and the floor), so the FLAGGED rewrite
/// decides and the sponsor gets everything back.
#[test]
fn l5_settle_waits_for_the_pools_review_window_so_a_flag_in_review_wins() {
    const REVIEW: i64 = 2 * DAY;
    let mut e = Env::new(); // floors 0: the pool's own window is the lock
    let payout = payout_key(&mut e);
    let id = e.create_pool(CreatePoolParams { payout_at: PLAY + REVIEW, ..default_params().with_open() });
    let driver = funded(&mut e.svm, 10 * SOL);
    e.buy(id, &driver, 1).unwrap();
    let other = funded(&mut e.svm, 10 * SOL);
    e.buy(id, &other, 2).unwrap();
    let sponsor = funded(&mut e.svm, 5 * SOL);
    let r = ride(0x1111);
    e.warp(PREP + 60);
    e.create_pledge(id, r, &driver.pubkey(), &sponsor, 250_000_000, 10_000_000, 25).unwrap();

    e.warp(PLAY - 60);
    e.record_ride_attestation(id, &payout, r, &driver.pubkey(), [7u8; 32], 25, ATTESTATION_STATUS_VERIFIED).unwrap();
    assert_eq!(e.ride_attestation(id, &r).unwrap().settle_from, PLAY + REVIEW);
    assert_err!(e.settle_pledge(id, r, &driver, &driver.pubkey(), &sponsor.pubkey()), PoolError::TooEarly);

    // the review flags the ride a day later: the lock restarts (a full review window from the rewrite)
    e.warp(PLAY + DAY);
    e.record_ride_attestation(id, &payout, r, &driver.pubkey(), [7u8; 32], 25, ATTESTATION_STATUS_FLAGGED).unwrap();
    assert_eq!(e.ride_attestation(id, &r).unwrap().settle_from, PLAY + DAY + REVIEW);
    e.warp(PLAY + REVIEW);
    assert_err!(e.settle_pledge(id, r, &driver, &driver.pubkey(), &sponsor.pubkey()), PoolError::TooEarly);

    let caller = funded(&mut e.svm, SOL);
    let s = settle_measured(&mut e, id, r, &caller, &driver.pubkey(), &sponsor.pubkey(), 250_000_000);
    assert_eq!(s.earned, 0);
    assert_eq!(s.back, 250_000_000 + s.rent);
}

// ---- L6: a driver wallet below the rent minimum ------------------------------------------------------------------------------------------------

/// L6: the sponsor (or anyone) could zero a small earning by settling while the driver's wallet is empty. v4: refused until the settle grace (the
/// driver can top the wallet up); after it, the sponsor gets everything.
#[test]
fn l6_driver_below_the_rent_minimum_waits_until_the_grace_then_refunds_the_sponsor() {
    let mut e = Env::new();
    let id = active_pool(&mut e);
    // a driver account that does not exist (0 lamports): 1 000 lamports would leave it under the rent minimum
    let driver = Pubkey::new_unique();
    let sponsor = funded(&mut e.svm, 5 * SOL);
    let auth = e.authority_kp();
    let ride_id = [11u8; 32];
    let max = 1_000u64;

    e.create_pledge(id, ride_id, &driver, &sponsor, max, 10, 100).unwrap();
    e.record_verified_ride(id, &auth, ride_id, &driver, 100).unwrap();

    let caller = e.authority_kp();
    for t in [PAYOUT, PAYOUT + SETTLE_GRACE_SECS - 1] {
        e.warp(t);
        assert_err!(e.settle_pledge(id, ride_id, &caller, &driver, &sponsor.pubkey()), PoolError::DriverBelowRentMin);
    }
    assert!(e.pledge(&ride_id, &sponsor.pubkey()).is_some());
    assert_eq!(e.pool(id).open_pledges, 1);
    assert_eq!(e.ride_attestation(id, &ride_id).unwrap().settled_pledges, 0, "a refused settle leaves the attestation rewritable");

    e.warp(PAYOUT + SETTLE_GRACE_SECS);
    let s = settle_measured(&mut e, id, ride_id, &caller, &driver, &sponsor.pubkey(), max);
    assert_eq!(s.earned, 0);
    assert_eq!(e.bal(&driver), 0);
    assert_eq!(s.back, max + s.rent);
    let evs = events::<PledgeSettled>(&s.r.logs);
    assert_eq!(evs[0].earned_lamports, 0);
    assert_eq!(evs[0].refunded_lamports, max);
    assert_eq!(evs[0].verified_km, 100);
}

/// L6: before the grace the driver tops the wallet up and is paid in full.
#[test]
fn l6_driver_below_the_rent_minimum_is_paid_once_the_wallet_is_topped_up() {
    let mut e = Env::new();
    let id = active_pool(&mut e);
    let driver = Pubkey::new_unique();
    let sponsor = funded(&mut e.svm, 5 * SOL);
    let auth = e.authority_kp();
    let ride_id = [12u8; 32];
    e.create_pledge(id, ride_id, &driver, &sponsor, 1_000, 10, 100).unwrap();
    e.record_verified_ride(id, &auth, ride_id, &driver, 100).unwrap();
    e.warp(PAYOUT);
    let caller = e.authority_kp();
    assert_err!(e.settle_pledge(id, ride_id, &caller, &driver, &sponsor.pubkey()), PoolError::DriverBelowRentMin);
    let min = e.rent_min();
    e.svm.airdrop(&driver, min).unwrap();
    let s = settle_measured(&mut e, id, ride_id, &caller, &driver, &sponsor.pubkey(), 1_000);
    assert_eq!(s.earned, 1_000);
    assert_eq!(e.bal(&driver), min + 1_000);
}

// ---- pause, the open-pledge counter ------------------------------------------------------------------------------------------------------------

/// `paused` stops new pledges, new verdicts and settles – but only before the settle grace (afterwards no admin can freeze the money); a
/// refund is never paused.
#[test]
fn pause_blocks_settle_only_before_the_grace_and_never_blocks_a_refund() {
    let mut e = Env::new();
    let auth = e.authority_kp();
    let id = active_pool(&mut e);
    let driver = funded(&mut e.svm, SOL);
    let sponsor = funded(&mut e.svm, 5 * SOL);
    let r = ride(0x90);
    e.create_pledge(id, r, &driver.pubkey(), &sponsor, 1_000_000, 10_000, 100).unwrap();
    e.record_verified_ride(id, &auth, r, &driver.pubkey(), 50).unwrap();
    // a second pool that will fail, with its own pledge
    let failing_ride = ride(0x91);
    let (failing, _, f_driver, f_sponsor) = open_pool_with_pledge(&mut e, failing_ride, 1_000_000);

    e.set_config(&auth, Some(true), None, None).unwrap();
    assert_err!(e.create_pledge(id, ride(0x92), &driver.pubkey(), &sponsor, 1_000, 10, 100), PoolError::Paused);
    assert_err!(e.record_verified_ride(id, &auth, ride(0x92), &driver.pubkey(), 5), PoolError::Paused);

    // refund_pledge is never paused
    e.warp(PREP);
    e.fail(failing).unwrap();
    assert_refunded(&mut e, failing, failing_ride, &f_driver.pubkey(), &f_sponsor.pubkey(), 1_000_000);

    let caller = funded(&mut e.svm, SOL);
    for t in [PAYOUT, PAYOUT + SETTLE_GRACE_SECS - 1] {
        e.warp(t);
        assert_err!(e.settle_pledge(id, r, &caller, &driver.pubkey(), &sponsor.pubkey()), PoolError::Paused);
    }
    e.warp(PAYOUT + SETTLE_GRACE_SECS);
    assert!(e.config().paused);
    let s = settle_measured(&mut e, id, r, &caller, &driver.pubkey(), &sponsor.pubkey(), 1_000_000);
    assert_eq!(s.earned, 500_000);
    assert_eq!(e.pool(id).status, STATUS_ACTIVE);
}

/// L7's counter: +1 per pledge (also on an OPEN pool), −1 per settle and per refund – never twice for one pledge.
#[test]
fn open_pledges_counts_create_settle_and_refund() {
    let mut e = Env::new();
    let auth = e.authority_kp();
    let id = e.create_pool(default_params().with_open());
    let buyer = funded(&mut e.svm, 20 * SOL);
    e.buy(id, &buyer, 1).unwrap();
    assert_eq!(e.pool(id).status, STATUS_OPEN);
    let driver = funded(&mut e.svm, SOL);
    let sponsor = funded(&mut e.svm, 5 * SOL);
    let (r1, r2, r3) = (ride(0xC1), ride(0xC2), ride(0xC3));
    e.create_pledge(id, r1, &driver.pubkey(), &sponsor, 1_000_000, 10_000, 100).unwrap();
    assert_eq!(e.pool(id).open_pledges, 1);
    e.buy(id, &buyer, 1).unwrap();
    assert_eq!(e.pool(id).status, STATUS_ACTIVE);
    e.create_pledge(id, r2, &driver.pubkey(), &sponsor, 1_000_000, 10_000, 100).unwrap();
    e.create_pledge(id, r3, &driver.pubkey(), &sponsor, 1_000_000, 10_000, 100).unwrap();
    assert_eq!(e.pool(id).open_pledges, 3);

    e.record_verified_ride(id, &auth, r1, &driver.pubkey(), 10).unwrap();
    let caller = funded(&mut e.svm, SOL);
    settle_measured(&mut e, id, r1, &caller, &driver.pubkey(), &sponsor.pubkey(), 1_000_000);
    assert_eq!(e.pool(id).open_pledges, 2);
    settle_pool(&mut e, id);
    assert_refunded(&mut e, id, r2, &driver.pubkey(), &sponsor.pubkey(), 1_000_000);
    assert_eq!(e.pool(id).open_pledges, 1);
    assert_refunded(&mut e, id, r3, &driver.pubkey(), &sponsor.pubkey(), 1_000_000);
    assert_eq!(e.pool(id).open_pledges, 0);
    e.svm.expire_blockhash();
    assert_closed_err(e.refund_pledge(id, r3, &caller, &driver.pubkey(), &sponsor.pubkey()));
    assert_eq!(e.pool(id).open_pledges, 0);
}

// ---- L7: attestation rent comes back ------------------------------------------------------------------------------------------------------------

/// L7: a ride attestation closes (permissionless) only when its pool is over and no pledge of the pool is open; the rent goes to whoever paid it.
#[test]
fn l7_close_ride_attestation_after_the_pool_is_settled_and_no_pledge_is_open() {
    let mut e = Env::new();
    let payout = payout_key(&mut e);
    let id = active_pool(&mut e);
    let driver = funded(&mut e.svm, SOL);
    let sponsor = funded(&mut e.svm, 5 * SOL);
    let (attested, unfinished) = (ride(0xD1), ride(0xD2));
    e.create_pledge(id, attested, &driver.pubkey(), &sponsor, 1_000_000, 10_000, 100).unwrap();
    e.create_pledge(id, unfinished, &driver.pubkey(), &sponsor, 1_000_000, 10_000, 100).unwrap();
    let p0 = e.bal(&payout.pubkey());
    e.record_verified_ride(id, &payout, attested, &driver.pubkey(), 30).unwrap();
    let pda = ride_attestation_pda(id, &attested);
    let rent = e.bal(&pda);
    assert_eq!(e.bal(&payout.pubkey()), p0 - rent, "the payout key paid the rent (the cranker the fee)");

    // Active: refused
    assert_err!(e.close_ride_attestation(id, attested, &payout.pubkey()), PoolError::NotSettled);
    let caller = funded(&mut e.svm, SOL);
    settle_measured(&mut e, id, attested, &caller, &driver.pubkey(), &sponsor.pubkey(), 1_000_000);
    assert_err!(e.close_ride_attestation(id, attested, &payout.pubkey()), PoolError::NotSettled);
    // Settled, a pledge still open: refused
    settle_pool(&mut e, id);
    assert_err!(e.close_ride_attestation(id, attested, &payout.pubkey()), PoolError::PledgesOpen);
    assert_refunded(&mut e, id, unfinished, &driver.pubkey(), &sponsor.pubkey(), 1_000_000);
    assert_eq!(e.pool(id).open_pledges, 0);
    // the rent goes to its payer, nobody else
    let auth = e.authority_kp();
    assert_err!(e.close_ride_attestation(id, attested, &auth.pubkey()), PoolError::AccountMismatch);
    let p1 = e.bal(&payout.pubkey());
    e.close_ride_attestation(id, attested, &payout.pubkey()).unwrap();
    assert_eq!(e.bal(&payout.pubkey()), p1 + rent);
    assert_eq!(e.bal(&pda), 0);
    assert!(e.ride_attestation(id, &attested).is_none());
}

/// L7: the same on a Cancelled pool – one that nobody settled, expired after the grace, refunded and closed.
#[test]
fn l7_close_ride_attestation_of_an_expired_and_cancelled_pool() {
    let mut e = Env::new();
    let auth = e.authority_kp();
    let id = e.create_pool(default_params().with_open());
    let buyer = funded(&mut e.svm, 20 * SOL);
    e.buy(id, &buyer, 5).unwrap();
    let driver = funded(&mut e.svm, SOL);
    let sponsor = funded(&mut e.svm, 5 * SOL);
    let r = ride(0xD3);
    e.create_pledge(id, r, &driver.pubkey(), &sponsor, 1_000_000, 10_000, 100).unwrap();
    e.record_ride_attestation(id, &auth, r, &driver.pubkey(), [0; 32], 0, ATTESTATION_STATUS_UNVERIFIED).unwrap();
    e.warp(PAYOUT + SETTLE_GRACE_SECS);
    let anyone = funded(&mut e.svm, SOL);
    e.expire(id, &anyone).unwrap();
    e.refund(id, &buyer.pubkey(), &buyer.pubkey()).unwrap();
    e.close_pool(id, &anyone).unwrap();
    assert_eq!(e.pool(id).status, STATUS_CANCELLED);
    assert_err!(e.close_ride_attestation(id, r, &auth.pubkey()), PoolError::PledgesOpen);
    // an UNVERIFIED verdict does not block the refund
    assert_refunded(&mut e, id, r, &driver.pubkey(), &sponsor.pubkey(), 1_000_000);
    let (a0, rent) = (e.bal(&auth.pubkey()), e.bal(&ride_attestation_pda(id, &r)));
    e.close_ride_attestation(id, r, &auth.pubkey()).unwrap();
    assert_eq!(e.bal(&auth.pubkey()), a0 + rent);
}

/// L7: a v3 per-driver Attestation left over from before the upgrade closes once its pool is terminal; the rent goes to the payout key (it paid
/// every v3 attestation) or, with none named, the admin.
#[test]
fn l7_close_legacy_attestation_only_of_a_terminal_pool() {
    let mut e = Env::new();
    let auth = e.authority_kp();
    let id = active_pool(&mut e);
    let (d1, d2) = (funded(&mut e.svm, SOL), funded(&mut e.svm, SOL));
    e.set_legacy_attestation(id, &d1.pubkey(), 40, ATTESTATION_STATUS_VERIFIED);
    e.set_legacy_attestation(id, &d2.pubkey(), 0, ATTESTATION_STATUS_FLAGGED);
    assert!(e.attestation(id, &d1.pubkey()).is_some());

    assert_err!(e.close_attestation(id, &d1.pubkey(), &auth.pubkey()), PoolError::NotSettled);
    settle_pool(&mut e, id);

    // no payout key named: the admin
    let a0 = e.bal(&auth.pubkey());
    let rent = e.bal(&attestation_pda(id, &d1.pubkey()));
    let stranger = funded(&mut e.svm, SOL);
    assert_err!(e.close_attestation(id, &d1.pubkey(), &stranger.pubkey()), PoolError::AccountMismatch);
    e.close_attestation(id, &d1.pubkey(), &auth.pubkey()).unwrap();
    assert_eq!(e.bal(&auth.pubkey()), a0 + rent);
    assert!(e.attestation(id, &d1.pubkey()).is_none());

    // a payout key named: it, not the admin
    let payout = payout_key(&mut e);
    assert_err!(e.close_attestation(id, &d2.pubkey(), &auth.pubkey()), PoolError::AccountMismatch);
    let (p0, rent) = (e.bal(&payout.pubkey()), e.bal(&attestation_pda(id, &d2.pubkey())));
    e.close_attestation(id, &d2.pubkey(), &payout.pubkey()).unwrap();
    assert_eq!(e.bal(&payout.pubkey()), p0 + rent);
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

/// refund_pledge by a third party: the sponsor gets the cap + the account's rent, the account is gone, the event says so, the pool counts one
/// open pledge less.
fn assert_refunded(e: &mut Env, id: u32, ride_id: [u8; 32], driver: &Pubkey, sponsor: &Pubkey, max: u64) {
    let pda = pledge_pda(&ride_id, sponsor);
    let (before, s0, open0) = (e.bal(&pda), e.bal(sponsor), e.pool(id).open_pledges);
    assert!(before > max);
    let caller = funded(&mut e.svm, SOL);
    let r = e.refund_pledge(id, ride_id, &caller, driver, sponsor).unwrap();
    assert_eq!(e.bal(sponsor), s0 + before, "sponsor gets the cap + rent");
    assert_eq!(e.bal(&pda), 0);
    assert!(e.pledge(&ride_id, sponsor).is_none());
    assert_eq!(e.pool(id).open_pledges, open0 - 1);
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
    // the driver never finished: no attestation; the admin settles the pool after the review window
    settle_pool(&mut e, id);
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
        e.record_ride_attestation(id, &auth, ride_id, &driver.pubkey(), [3u8; 32], 40, status).unwrap();
        settle_pool(&mut e, id);

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

/// H4: the decided attestation that blocks a refund must be THIS ride's – another ride of the same driver (verified) does not block it.
#[test]
fn refund_pledge_not_blocked_by_another_rides_attestation() {
    let mut e = Env::new();
    let auth = e.authority_kp();
    let id = active_pool(&mut e);
    let driver = funded(&mut e.svm, SOL);
    let sponsor = funded(&mut e.svm, 5 * SOL);
    let (good, pledged) = (ride(0xE1), ride(0xE2));
    e.create_pledge(id, pledged, &driver.pubkey(), &sponsor, 1_000_000, 10_000, 100).unwrap();
    e.record_verified_ride(id, &auth, good, &driver.pubkey(), 120).unwrap();
    settle_pool(&mut e, id);
    assert_refunded(&mut e, id, pledged, &driver.pubkey(), &sponsor.pubkey(), 1_000_000);
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
    e.record_ride_attestation(id, &auth, ride_id, &driver.pubkey(), [0u8; 32], 0, ATTESTATION_STATUS_UNVERIFIED).unwrap();
    settle_pool(&mut e, id);
    // settle refuses an UNVERIFIED attestation, so refund must not
    assert_refunded(&mut e, id, ride_id, &driver.pubkey(), &sponsor.pubkey(), 1_000_000);
    // and a refunded pledge cannot be settled
    let caller = funded(&mut e.svm, SOL);
    assert_closed_err(e.settle_pledge(id, ride_id, &caller, &driver.pubkey(), &sponsor.pubkey()));
}

/// S1-GPT probe_refund_then_late_attestation_cannot_pay_twice: an Active pool past its grace with no attestation – the sponsor refunds; a verdict
/// written afterwards (the pool is still Active, so it may be) finds the pledge gone: nothing moves twice.
#[test]
fn refund_then_a_late_attestation_cannot_pay_twice() {
    let mut e = Env::new();
    let payout = payout_key(&mut e);
    let id = active_pool(&mut e);
    let driver = funded(&mut e.svm, 10 * SOL);
    let sponsor = funded(&mut e.svm, 5 * SOL);
    let r = ride(0x2222);
    e.create_pledge(id, r, &driver.pubkey(), &sponsor, 250_000_000, 10_000_000, 25).unwrap();
    let caller = funded(&mut e.svm, SOL);
    e.warp(PAYOUT + SETTLE_GRACE_SECS);
    let (d0, s0) = (e.bal(&driver.pubkey()), e.bal(&sponsor.pubkey()));
    let pledge_balance = e.bal(&pledge_pda(&r, &sponsor.pubkey()));
    e.refund_pledge(id, r, &caller, &driver.pubkey(), &sponsor.pubkey()).unwrap();
    // red-team v4 M2: no record whose lock would end past the grace margin – the refund cannot be front-run or a pledge locked again
    assert_err!(e.record_verified_ride(id, &payout, r, &driver.pubkey(), 25), PoolError::CommitTooLate);
    assert!(e.settle_pledge(id, r, &caller, &driver.pubkey(), &sponsor.pubkey()).is_err());
    assert!(e.refund_pledge(id, r, &caller, &driver.pubkey(), &sponsor.pubkey()).is_err());
    assert_eq!(e.bal(&driver.pubkey()), d0);
    assert_eq!(e.bal(&sponsor.pubkey()), s0 + pledge_balance);
    assert_eq!(e.pool(id).open_pledges, 0);
}

/// red-team v4 M2: after the grace a stolen payout key could record VERIFIED for a pledged ride (blocking the sponsor's refund) and keep re-recording to push
/// `settle_from` forward – a record whose lock ends later than the grace minus the margin is refused, so after the grace the sponsor refunds without anyone's key.
#[test]
fn a_record_whose_lock_ends_too_close_to_the_grace_is_refused() {
    let mut e = Env::new();
    let payout = payout_key(&mut e);
    let id = active_pool(&mut e);
    let driver = funded(&mut e.svm, 10 * SOL);
    let sponsor = funded(&mut e.svm, 5 * SOL);
    let r = ride(0x3333);
    e.create_pledge(id, r, &driver.pubkey(), &sponsor, 250_000_000, 10_000_000, 25).unwrap();
    let last = e.pool(id).grace_end().unwrap() - COMMIT_GRACE_MARGIN_SECS;   // floors 0, no review window: settle_from = now
    e.warp(last);
    e.record_verified_ride(id, &payout, r, &driver.pubkey(), 1).unwrap();   // the last moment it may
    e.warp(last + 1);
    assert_err!(e.record_ride_attestation(id, &payout, r, &driver.pubkey(), [0; 32], 0, ATTESTATION_STATUS_FLAGGED), PoolError::CommitTooLate);
    assert_eq!(e.ride_attestation(id, &r).unwrap().settle_from, last, "the lock was not pushed");
    e.warp(e.pool(id).grace_end().unwrap());
    let caller = funded(&mut e.svm, SOL);
    e.settle_pledge(id, r, &caller, &driver.pubkey(), &sponsor.pubkey()).unwrap();
}

/// S1-GPT probe_pledges_cannot_be_settled_or_refunded_across_pools / s1-claude safe_pledge_…_wrong_pool: one ride id attested in pool B does not
/// settle or block a pledge of pool A (has_one pool + the attestation PDA is seeded with the pool).
#[test]
fn pledges_cannot_be_settled_or_refunded_across_pools() {
    let mut e = Env::new();
    let payout = payout_key(&mut e);
    let a = active_pool(&mut e);
    let b = active_pool(&mut e);
    let driver = funded(&mut e.svm, 10 * SOL);
    let sponsor = funded(&mut e.svm, 5 * SOL);
    let r = ride(0x3333);
    e.create_pledge(a, r, &driver.pubkey(), &sponsor, 250_000_000, 10_000_000, 25).unwrap();
    e.warp(PLAY);
    e.record_verified_ride(b, &payout, r, &driver.pubkey(), 25).unwrap();
    let caller = funded(&mut e.svm, SOL);
    // pool B presented for pool A's pledge
    assert_err!(e.settle_pledge(b, r, &caller, &driver.pubkey(), &sponsor.pubkey()), PoolError::AccountMismatch);
    // pool A with pool B's attestation of the same ride id
    let i = settle_ix(a, r, &caller.pubkey(), &driver.pubkey(), &sponsor.pubkey(), ride_attestation_pda(b, &r), pledge_pda(&r, &sponsor.pubkey()));
    assert!(e.send(&[i], &caller, &[]).is_err());
    // pool A settled without attesting the ride: refund is the way out; pool B's verified attestation does not block it, and cannot be swapped in
    settle_pool(&mut e, a);
    assert_err!(e.refund_pledge(b, r, &caller, &driver.pubkey(), &sponsor.pubkey()), PoolError::AccountMismatch);
    assert_refunded(&mut e, a, r, &driver.pubkey(), &sponsor.pubkey(), 250_000_000);
}

/// SUSPECTED PROGRAM BUG (refund_pledge, instructions/pledge.rs handle_refund_pledge): a pledge names its driver freely; if the ride's attestation
/// names another driver, settle is refused (AttestationMismatch) AND refund is refused (AttestationExists – the check ignores the driver), so the
/// cap is locked for good once the pool is closed (no rewrite on a non-Active pool), `open_pledges` never reaches 0 and every ride attestation of
/// the pool keeps its rent (L7). Anyone can do it to any pool with a 1-lamport pledge on a public ride id. Expected: refund allowed when
/// `attestation.driver != pledge.driver`.
#[test]
fn refund_pledge_of_a_pledge_naming_another_driver_than_its_rides_attestation() {
    let mut e = Env::new();
    let payout = payout_key(&mut e);
    let id = active_pool(&mut e);
    let (driver, griefer_pick) = (funded(&mut e.svm, SOL), funded(&mut e.svm, SOL));
    let (honest, griefer) = (funded(&mut e.svm, 5 * SOL), funded(&mut e.svm, 5 * SOL));
    let r = ride(0x4444);
    e.create_pledge(id, r, &driver.pubkey(), &honest, 1_000_000, 10_000, 100).unwrap();
    e.create_pledge(id, r, &griefer_pick.pubkey(), &griefer, 1, 1, 1).unwrap();
    e.record_verified_ride(id, &payout, r, &driver.pubkey(), 50).unwrap();
    let caller = funded(&mut e.svm, SOL);
    settle_measured(&mut e, id, r, &caller, &driver.pubkey(), &honest.pubkey(), 1_000_000);
    assert_err!(e.settle_pledge(id, r, &caller, &griefer_pick.pubkey(), &griefer.pubkey()), PoolError::AttestationMismatch);
    settle_pool(&mut e, id);
    e.refund_pledge(id, r, &caller, &griefer_pick.pubkey(), &griefer.pubkey()).expect("the mismatched pledge must have a way out");
    assert_eq!(e.pool(id).open_pledges, 0);
    e.close_ride_attestation(id, r, &payout.pubkey()).unwrap();
}

// ── defensive checks only a forged account (or a bad argument) reaches – the coverage gate wants every error code asserted somewhere

#[test]
fn settle_pledge_refuses_an_account_marked_settled() {
    // settle and refund close the account, so `settled` is never true on a live one; a forged flag must not pay twice
    let mut e = Env::new();
    let id = active_pool(&mut e);
    let (driver, sponsor) = (funded(&mut e.svm, SOL), funded(&mut e.svm, 5 * SOL));
    let ride_id = [0x7a; 32];
    e.create_pledge(id, ride_id, &driver.pubkey(), &sponsor, 1_000_000, 10_000, 100).unwrap();
    set_ride_attestation(&mut e, id, ride_id, &driver.pubkey(), 50, ATTESTATION_STATUS_VERIFIED);
    let pda = pledge_pda(&ride_id, &sponsor.pubkey());
    let mut acc = e.svm.get_account(&pda).unwrap();
    let mut p = freightchain_pools::Pledge::try_deserialize(&mut &acc.data[..]).unwrap();
    p.settled = true;
    let mut data = freightchain_pools::Pledge::DISCRIMINATOR.to_vec();
    anchor_lang::AnchorSerialize::serialize(&p, &mut data).unwrap();
    acc.data = data;
    e.svm.set_account(pda, acc).unwrap();
    e.warp(PAYOUT);
    let caller = funded(&mut e.svm, SOL);
    assert_err!(e.settle_pledge(id, ride_id, &caller, &driver.pubkey(), &sponsor.pubkey()), PoolError::AlreadySettled);
    assert_err!(e.refund_pledge(id, ride_id, &caller, &driver.pubkey(), &sponsor.pubkey()), PoolError::AlreadySettled);
}
