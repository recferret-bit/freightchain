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
    assert_err!(e.pay_prize(id, &auth, &w.pubkey(), 1, 1), PoolError::PoolNotActive);

    let mut e = Env::new();
    let (id, _) = active_pool(&mut e, 2, 5);
    let auth = e.authority_kp();
    e.warp(PLAY);
    let fresh = Keypair::new(); // empty account: a payout below rent_min would be rejected by the runtime
    assert_err!(e.pay_prize(id, &auth, &fresh.pubkey(), e.rent_min() - 1, 1), PoolError::BelowRentMin);
    e.pay_prize(id, &auth, &fresh.pubkey(), e.rent_min(), 1).unwrap();
    // an already funded wallet may get less than the minimum
    let funded_w = funded(&mut e.svm, SOL);
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
