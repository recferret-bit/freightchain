//! v4 settlement: `commit_winners` (a Merkle root over rank, wallet, lamports), the permissionless `pay_prize` against it, `veto_winners`, and
//! `close_pool` / `close_ticket` (audit H5-B / M6).
#[macro_use]
mod common;

use anchor_lang::prelude::Pubkey;
use common::*;
use freightchain_pools::{
    error::PoolError,
    events::{PoolClosed, PrizePaid, WinnersCommitted, WinnersVetoed},
    COMMIT_GRACE_MARGIN_SECS, MAX_WINNERS, SETTLE_GRACE_SECS,
};
use solana_keypair::Keypair;
use solana_signer::Signer;

/// Active pool: `n` buyers x `qty` tickets. Returns (id, buyers).
fn active_pool(e: &mut Env, n: usize, qty: u16) -> (u32, Vec<Keypair>) {
    active_pool_with(e, n, qty, default_params().with_open())
}

fn active_pool_with(e: &mut Env, n: usize, qty: u16, p: freightchain_pools::CreatePoolParams) -> (u32, Vec<Keypair>) {
    let id = e.create_pool(p);
    let mut v = vec![];
    for _ in 0..n {
        let b = funded(&mut e.svm, 20 * SOL);
        e.buy(id, &b, qty).unwrap();
        v.push(b);
    }
    assert_eq!(e.pool(id).status, 1);
    (id, v)
}

/// a review window of REVIEW after the play deadline: the lock is real (with no window and floor 0 a root pays the moment it is committed)
const REVIEW: i64 = 2 * DAY;

trait Open {
    fn with_open(self) -> Self;
    fn reviewed(self) -> Self;
}
impl Open for freightchain_pools::CreatePoolParams {
    fn with_open(mut self) -> Self {
        self.max_tickets = 0;
        self.max_per_wallet = 100;
        self.min_tickets = 2;
        self
    }
    fn reviewed(mut self) -> Self {
        self.payout_at = self.play_deadline + REVIEW;
        self
    }
}

trait Share {
    fn prize_share_for_test(&self) -> u64;
}
impl Share for freightchain_pools::Pool {
    fn prize_share_for_test(&self) -> u64 {
        self.prize_share().unwrap()
    }
}

fn payout_key(e: &mut Env) -> Keypair {
    let payout = funded(&mut e.svm, 10 * SOL);
    let a = e.authority_kp();
    e.set_payout_authority(&a, Some(payout.pubkey())).unwrap();
    payout
}

fn wallets(e: &mut Env, n: usize) -> Vec<Pubkey> {
    (0..n).map(|_| funded(&mut e.svm, SOL).pubkey()).collect()
}

// ---- commit_winners ------------------------------------------------------------------------------------

#[test]
fn commit_winners_is_the_settlers_and_not_before_the_play_deadline() {
    let mut e = Env::new();
    let (id, _) = active_pool(&mut e, 2, 5); // 10 tickets, pot 1 SOL, prize share 0.6 SOL
    let (id2, _) = active_pool(&mut e, 2, 5);
    let payout = payout_key(&mut e);
    let w = wallets(&mut e, 2);
    let list = [(w[0], 300_000_000), (w[1], 100_000_000)];
    let stranger = funded(&mut e.svm, SOL);
    e.warp(PLAY - 1);
    assert_err!(e.commit_winners(id, &payout, &list), PoolError::TooEarly);
    e.warp(PLAY);
    // a stranger (or a winner) cannot write the winners
    assert_err!(e.commit_winners(id, &stranger, &list), PoolError::Unauthorized);
    let r = e.commit_winners(id, &payout, &list).unwrap();
    let p = e.pool(id);
    let wn = e.winners[&id].clone();
    assert_eq!((p.winners_root, p.winners_total, p.winners_count, p.committed_at, p.pay_from, p.paid_mask), (wn.root, 400_000_000, 2, PLAY, PLAY, 0));
    let ev = events::<WinnersCommitted>(&r.logs);
    assert_eq!((ev[0].pool_id, ev[0].root, ev[0].total, ev[0].count, ev[0].pay_from, ev[0].by), (id, wn.root, 400_000_000, 2, PLAY, payout.pubkey()));
    // the admin may commit too (another pool)
    let a = e.authority_kp();
    e.commit_winners(id2, &a, &list).unwrap();
}

#[test]
fn commit_winners_is_written_once() {
    let mut e = Env::new();
    let (id, _) = active_pool(&mut e, 2, 5);
    let a = e.authority_kp();
    let w = wallets(&mut e, 2);
    e.warp(PLAY);
    e.commit_winners(id, &a, &[(w[0], 1_000_000)]).unwrap();
    // neither another root nor the same one again – a wrong root goes through the admin's veto
    assert_err!(e.commit_winners(id, &a, &[(w[1], 2_000_000)]), PoolError::WinnersCommitted);
    assert_err!(e.commit_winners(id, &a, &[(w[0], 1_000_000)]), PoolError::WinnersCommitted);
    assert_err!(e.commit_winners(id, &a, &[]), PoolError::WinnersCommitted);
}

#[test]
fn commit_winners_checks_the_total_the_count_and_an_empty_root() {
    let mut e = Env::new();
    let (id, _) = active_pool(&mut e, 2, 5);
    let a = e.authority_kp();
    let share = e.pool(id).prize_share_for_test();
    let w = wallets(&mut e, 2);
    e.warp(PLAY);
    assert_err!(e.commit_winners(id, &a, &[(w[0], share - 1), (w[1], 2)]), PoolError::PrizeExceedsShare);
    assert_err!(e.commit_root(id, &a, [1; 32], share + 1, 1), PoolError::PrizeExceedsShare);
    assert_err!(e.commit_root(id, &a, [1; 32], 1, MAX_WINNERS + 1), PoolError::TooManyWinners);
    // count 0 = no winner: the root and the total must be empty; a real count needs both
    assert_err!(e.commit_root(id, &a, [1; 32], 0, 0), PoolError::InvalidParams);
    assert_err!(e.commit_root(id, &a, [0; 32], 5, 0), PoolError::InvalidParams);
    assert_err!(e.commit_root(id, &a, [0; 32], 5, 1), PoolError::InvalidParams);
    assert_err!(e.commit_root(id, &a, [1; 32], 0, 1), PoolError::InvalidParams);
    assert!(!e.pool(id).has_winners());
    // 64 ranks fit the paid mask, the whole share is allowed
    let list: Vec<(Pubkey, u64)> = (0..MAX_WINNERS).map(|i| (Pubkey::new_from_array([i + 1; 32]), if i == 0 { share - 63 * e.rent_min() } else { e.rent_min() })).collect();
    e.commit_winners(id, &a, &list).unwrap();
    assert_eq!((e.pool(id).winners_count, e.pool(id).winners_total), (MAX_WINNERS, share));
    e.pay_rank(id, MAX_WINNERS - 1).unwrap();
    assert_eq!(e.pool(id).paid_mask, 1u64 << 63);
}

/// rule f: after the grace anyone may close and sweep what is unpaid, so a root whose lock ends within a day of it is refused.
#[test]
fn commit_winners_refused_when_its_lock_ends_too_close_to_the_grace() {
    let mut e = Env::new();
    let (id, _) = active_pool_with(&mut e, 2, 5, default_params().with_open().reviewed());
    let a = e.authority_kp();
    let w = wallets(&mut e, 1);
    let p = e.pool(id);
    let last = p.payout_at + SETTLE_GRACE_SECS - COMMIT_GRACE_MARGIN_SECS - REVIEW; // its lock (= the review window) ends exactly at the limit
    e.warp(last + 1);
    assert_err!(e.commit_winners(id, &a, &[(w[0], PRICE)]), PoolError::CommitTooLate);
    assert_err!(e.commit_winners(id, &a, &[]), PoolError::CommitTooLate);
    e.warp(last);
    e.commit_winners(id, &a, &[(w[0], PRICE)]).unwrap();
    assert_eq!(e.pool(id).pay_from, p.payout_at + SETTLE_GRACE_SECS - COMMIT_GRACE_MARGIN_SECS);
    // a raised review floor no longer moves this limit for a running pool (red-team v4 S2): the lock is the pool's own snapshot
    let lp = later(&e, default_params().with_open()).reviewed();
    let (id2, _) = active_pool_with(&mut e, 2, 5, lp);
    e.set_floors(&a, Some(3 * DAY), None).unwrap();
    let p2 = e.pool(id2);
    e.warp(p2.payout_at + SETTLE_GRACE_SECS - COMMIT_GRACE_MARGIN_SECS - REVIEW);
    e.commit_winners(id2, &a, &[(w[0], PRICE)]).unwrap();
}

// ---- pay_prize ------------------------------------------------------------------------------------------

/// Product split 6500/2000/1000/500: commit and pay may use prize + referral, and one lamport over that is refused. Close sweeps the unpaid part of that sum.
#[test]
fn referral_share_raises_the_payout_cap_and_the_unclaimed_sweep() {
    let params = freightchain_pools::CreatePoolParams {
        price_lamports: 100_000_000,
        prize_bps: 6500,
        seed_bps: 2000,
        fee_bps: 1000,
        referral_bps: 500,
        ..default_params().with_open()
    };
    let mut e = Env::new();
    let (id, _) = active_pool_with(&mut e, 1, 4, params.clone());
    let prize = 260_000_000u64;
    let cap = prize + 20_000_000;
    assert_eq!((e.pool(id).prize_share().unwrap(), e.pool(id).referral_share().unwrap(), e.pool(id).payout_cap().unwrap()), (prize, 20_000_000, cap));
    let a = e.authority_kp();
    let w = wallets(&mut e, 1);
    e.warp(PLAY);
    assert_err!(e.commit_winners(id, &a, &[(w[0], cap + 1)]), PoolError::PrizeExceedsShare);
    e.commit_and_pay(id, &a, &[(w[0], prize)]);
    let ev = &events::<PoolClosed>(&e.close_pool(id, &a).unwrap().logs)[0];
    assert_eq!((ev.unclaimed, ev.prize_paid), (20_000_000, prize));

    let params2 = later(&e, params);
    let (id2, _) = active_pool_with(&mut e, 1, 4, params2);
    let w2 = wallets(&mut e, 1);
    e.warp(e.pool(id2).play_deadline);
    e.commit_and_pay(id2, &a, &[(w2[0], cap)]);
    let ev2 = &events::<PoolClosed>(&e.close_pool(id2, &a).unwrap().logs)[0];
    assert_eq!((ev2.unclaimed, ev2.prize_paid), (0, cap));
}

/// The old v3 cap test: the committed total and the prize share both bound what is paid – even when the root's leaves add up to more than the
/// total it was committed with. Referral 0, so the cap is still the prize share.
#[test]
fn pay_prize_bounded_by_the_committed_total_and_the_prize_share() {
    let mut e = Env::new();
    let (id, _) = active_pool(&mut e, 2, 5);
    let (id2, _) = active_pool(&mut e, 2, 5);
    let sp = funded(&mut e.svm, 10 * SOL);
    let i = e.sponsor_ix(id, &sp.pubkey(), 200_000_001);
    e.send(&[i], &sp, &[]).unwrap();
    // pot = 10 * 0.1 SOL + 200_000_001 = 1_200_000_001 ; prize 60% = 720_000_000 (floor of 720_000_000.6)
    let share = 720_000_000u64;
    assert_eq!(e.pool(id).prize_share_for_test(), share);
    let a = e.authority_kp();
    let w = wallets(&mut e, 3);
    e.warp(PLAY);
    // the leaves claim share - 10, 11 and 1, the committed total is the share: ranks 0 and 2 pay, rank 1 would cross the total
    let wn = winners_of(id, &[(w[0], share - 10), (w[1], 11), (w[2], 1)]);
    e.commit_root(id, &a, wn.root, share, 3).unwrap();
    e.pay_raw(id, 0, &w[0], share - 10, wn.proofs[0].clone()).unwrap();
    assert_err!(e.pay_raw(id, 1, &w[1], 11, wn.proofs[1].clone()), PoolError::PrizeExceedsShare);
    e.pay_raw(id, 2, &w[2], 1, wn.proofs[2].clone()).unwrap();
    assert_eq!(e.pool(id).prizes_paid, share - 9);

    // a lying total below the leaves: the total wins
    let wn = winners_of(id2, &[(w[0], 300), (w[1], 300)]);
    e.commit_root(id2, &a, wn.root, 400, 2).unwrap();
    e.pay_raw(id2, 0, &w[0], 300, wn.proofs[0].clone()).unwrap();
    assert_err!(e.pay_raw(id2, 1, &w[1], 300, wn.proofs[1].clone()), PoolError::PrizeExceedsShare);
    assert_eq!(e.pool(id2).prizes_paid, 300);
}

#[test]
fn pay_prize_needs_an_active_pool_a_committed_root_and_a_rent_exempt_receiver() {
    let mut e = Env::new();
    let id = e.create_pool(default_params()); // Open
    let a = e.authority_kp();
    e.warp(PLAY);
    let w = funded(&mut e.svm, SOL);
    assert_err!(e.commit_winners(id, &a, &[(w.pubkey(), PRICE)]), PoolError::PoolNotActive);
    assert_err!(e.pay_raw(id, 0, &w.pubkey(), 1, vec![]), PoolError::PoolNotActive);

    let mut e = Env::new();
    let (id, _) = active_pool(&mut e, 2, 5);
    let (id2, _) = active_pool(&mut e, 2, 5);
    let a = e.authority_kp();
    e.warp(PLAY);
    let w = funded(&mut e.svm, SOL);
    assert_err!(e.pay_raw(id, 0, &w.pubkey(), 1, vec![]), PoolError::WinnersNotCommitted);
    // an empty account: a prize below the rent minimum can never land – that rank is stuck until the admin vetoes the root
    let fresh = Keypair::new();
    let min = e.rent_min();
    e.commit_winners(id, &a, &[(fresh.pubkey(), min - 1), (w.pubkey(), 10)]).unwrap();
    assert_err!(e.pay_rank(id, 0), PoolError::BelowRentMin);
    // an already funded wallet may get less than the minimum
    e.pay_rank(id, 1).unwrap();
    assert_err!(e.close_pool(id, &a), PoolError::PrizesUnpaid);
    // rank 1 is paid: the root is final, the stuck rank waits for the grace (rule f)
    assert_err!(e.veto_winners(id, &a), PoolError::WinnersPartlyPaid);

    e.commit_winners(id2, &a, &[(fresh.pubkey(), min - 1)]).unwrap();
    assert_err!(e.pay_rank(id2, 0), PoolError::BelowRentMin);
    e.veto_winners(id2, &a).unwrap();
    e.commit_winners(id2, &a, &[(fresh.pubkey(), min)]).unwrap();
    e.pay_rank(id2, 0).unwrap();
    assert_eq!(e.bal(&fresh.pubkey()), min);
    e.close_pool(id2, &a).unwrap();
}

/// M6: the root binds rank, wallet and amount – nothing else proves against it. Also: zero lamports, a rank past the count, another pool's proof.
#[test]
fn pay_prize_pays_only_the_committed_leaf() {
    let mut e = Env::new();
    let (id, _) = active_pool(&mut e, 2, 5);
    let (id2, _) = active_pool(&mut e, 2, 5);
    let a = e.authority_kp();
    let w = wallets(&mut e, 3);
    let list = [(w[0], 3_000_000), (w[1], 2_000_000), (w[2], 1_000_000)];
    e.warp(PLAY);
    e.commit_winners(id, &a, &list).unwrap();
    e.commit_winners(id2, &a, &list).unwrap(); // the same list in another pool – its leaves carry its own pool id
    let wn = e.winners[&id].clone();
    let other = funded(&mut e.svm, SOL).pubkey();
    // wrong wallet, wrong amount (less or more), wrong rank, another rank's proof, no proof, an extra proof element
    assert_err!(e.pay_raw(id, 0, &other, 3_000_000, wn.proofs[0].clone()), PoolError::InvalidProof);
    assert_err!(e.pay_raw(id, 0, &w[0], 2_999_999, wn.proofs[0].clone()), PoolError::InvalidProof);
    assert_err!(e.pay_raw(id, 0, &w[0], 3_000_001, wn.proofs[0].clone()), PoolError::InvalidProof);
    assert_err!(e.pay_raw(id, 1, &w[0], 3_000_000, wn.proofs[0].clone()), PoolError::InvalidProof);
    assert_err!(e.pay_raw(id, 0, &w[0], 3_000_000, wn.proofs[1].clone()), PoolError::InvalidProof);
    assert_err!(e.pay_raw(id, 0, &w[0], 3_000_000, vec![]), PoolError::InvalidProof);
    let mut longer = wn.proofs[0].clone();
    longer.push([7; 32]);
    assert_err!(e.pay_raw(id, 0, &w[0], 3_000_000, longer), PoolError::InvalidProof);
    // a leaf of pool id2 (same rank, wallet, amount) does not prove against pool id
    let wn2 = e.winners[&id2].clone();
    assert_err!(e.pay_raw(id, 0, &w[0], 3_000_000, wn2.proofs[0].clone()), PoolError::InvalidProof);
    assert_err!(e.pay_raw(id, 0, &w[0], 0, wn.proofs[0].clone()), PoolError::InvalidParams);
    assert_err!(e.pay_raw(id, 3, &w[0], 3_000_000, wn.proofs[0].clone()), PoolError::InvalidParams);
    // the vault cannot be named as the winner
    assert_err!(e.pay_raw(id, 0, &vault_pda(id), 3_000_000, wn.proofs[0].clone()), PoolError::AccountMismatch);
    assert_eq!((e.pool(id).prizes_paid, e.pool(id).paid_mask), (0, 0));
    for r in 0..3 {
        e.pay_rank(id, r).unwrap();
    }
    assert_eq!((e.pool(id).prizes_paid, e.pool(id).paid_mask), (6_000_000, 0b111));
}

/// M6 regression: the v3 test paid one wallet at rank 1 and again at rank 2 as expected behaviour; now a rank pays once, and a wallet only what its
/// leaf says.
#[test]
fn the_same_rank_is_never_paid_twice() {
    let mut e = Env::new();
    let (id, _) = active_pool(&mut e, 2, 5);
    let a = e.authority_kp();
    let w = wallets(&mut e, 2);
    e.warp(PLAY);
    e.commit_winners(id, &a, &[(w[0], PRICE), (w[1], PRICE / 2)]).unwrap();
    let w0 = e.bal(&w[0]);
    e.pay_rank(id, 0).unwrap();
    assert_err!(e.pay_rank(id, 0), PoolError::RankAlreadyPaid);
    // the same wallet under another rank: rank 1 is w[1]'s
    let wn = e.winners[&id].clone();
    assert_err!(e.pay_raw(id, 1, &w[0], PRICE, wn.proofs[1].clone()), PoolError::InvalidProof);
    assert_err!(e.pay_raw(id, 1, &w[0], PRICE / 2, wn.proofs[1].clone()), PoolError::InvalidProof);
    assert_eq!(e.bal(&w[0]) - w0, PRICE);
    e.pay_rank(id, 1).unwrap();
    assert_err!(e.pay_rank(id, 1), PoolError::RankAlreadyPaid);
    assert_eq!(e.pool(id).prizes_paid, PRICE + PRICE / 2);
}

/// pay_prize is permissionless: whoever sends it pays only the fee; the prize goes to the leaf's wallet.
#[test]
fn a_stranger_pays_a_rank_and_the_money_goes_only_to_the_leafs_wallet() {
    let mut e = Env::new();
    let (id, _) = active_pool(&mut e, 2, 5);
    let a = e.authority_kp();
    let winner = funded(&mut e.svm, SOL).pubkey();
    e.warp(PLAY);
    e.commit_winners(id, &a, &[(winner, 250_000_000)]).unwrap();
    let stranger = funded(&mut e.svm, SOL);
    let wn = e.winners[&id].clone();
    let (s0, w0, v0) = (e.bal(&stranger.pubkey()), e.bal(&winner), e.vault(id));
    // the stranger names itself as the receiver: refused
    let i = e.pay_prize_ix(id, &stranger.pubkey(), 0, &stranger.pubkey(), 250_000_000, wn.proofs[0].clone());
    assert_err!(e.send(&[i], &stranger, &[]), PoolError::InvalidProof);
    let i = e.pay_prize_ix(id, &stranger.pubkey(), 0, &winner, 250_000_000, wn.proofs[0].clone());
    let r = e.send(&[i], &stranger, &[]).unwrap();
    assert_eq!(e.bal(&winner) - w0, 250_000_000);
    assert_eq!(v0 - e.vault(id), 250_000_000);
    assert!(e.bal(&stranger.pubkey()) < s0, "the sender only paid fees");
    let ev = events::<PrizePaid>(&r.logs);
    assert_eq!((ev[0].pool_id, ev[0].to, ev[0].lamports, ev[0].rank, ev[0].prizes_paid_total), (id, winner, 250_000_000, 0, 250_000_000));
}

/// Every wrong (rank, wallet, amount) of a 5-winner tree is refused with every proof; only the 5 committed leaves pay.
#[test]
fn adversarial_pay_prize_matrix() {
    let mut e = Env::new();
    let (id, _) = active_pool(&mut e, 2, 5);
    let a = e.authority_kp();
    let w = wallets(&mut e, 5);
    let list: Vec<(Pubkey, u64)> = (0..5).map(|i| (w[i], 10_000_000 * (5 - i as u64))).collect();
    e.warp(PLAY);
    e.commit_winners(id, &a, &list).unwrap();
    let wn = e.winners[&id].clone();
    for rank in 0..5u8 {
        for (wi, wallet) in w.iter().enumerate() {
            for (li, (_, lamports)) in list.iter().enumerate() {
                for (pi, proof) in wn.proofs.iter().enumerate() {
                    if rank as usize == wi && wi == li && li == pi {
                        continue;
                    }
                    let r = e.pay_raw(id, rank, wallet, *lamports, proof.clone());
                    // a leaf may coincide with another proof's sibling path only if the tree is broken: every such call must fail
                    assert!(r.is_err(), "rank {rank} wallet {wi} amount {li} proof {pi} paid");
                }
            }
        }
    }
    assert_eq!(e.pool(id).paid_mask, 0);
    for r in 0..5 {
        e.pay_rank(id, r).unwrap();
    }
    assert_eq!(e.pool(id).prizes_paid, list.iter().map(|l| l.1).sum::<u64>());
}

// ---- veto_winners ----------------------------------------------------------------------------------------

#[test]
fn only_the_admin_vetoes_and_only_before_a_rank_is_paid() {
    let mut e = Env::new();
    let (id, _) = active_pool_with(&mut e, 2, 5, default_params().with_open().reviewed());
    let payout = payout_key(&mut e);
    let a = e.authority_kp();
    let stranger = funded(&mut e.svm, SOL);
    let w = wallets(&mut e, 2);
    let p = e.pool(id);
    e.warp(PLAY);
    assert_err!(e.veto_winners(id, &a), PoolError::WinnersNotCommitted);
    e.commit_winners(id, &payout, &[(w[0], PRICE)]).unwrap();
    assert_eq!(e.pool(id).pay_from, p.payout_at);
    // the payout key cannot undo its own (possibly stolen) commit, nor can a stranger
    assert_err!(e.veto_winners(id, &payout), PoolError::Unauthorized);
    assert_err!(e.veto_winners(id, &stranger), PoolError::Unauthorized);
    // the admin strikes it a day into the lock
    e.warp(PLAY + DAY);
    let root = e.pool(id).winners_root;
    let r = e.veto_winners(id, &a).unwrap();
    let ev = events::<WinnersVetoed>(&r.logs);
    assert_eq!((ev[0].pool_id, ev[0].root), (id, root));
    let q = e.pool(id);
    assert_eq!((q.winners_root, q.winners_total, q.winners_count, q.committed_at, q.pay_from), ([0; 32], 0, 0, 0, 0));
    // a re-commit starts a full lock from now: past payout_at
    e.commit_winners(id, &payout, &[(w[1], PRICE)]).unwrap();
    assert_eq!(e.pool(id).pay_from, PLAY + DAY + REVIEW);
    e.warp(p.payout_at);
    assert_err!(e.pay_rank(id, 0), PoolError::TooEarly);
    e.warp(PLAY + DAY + REVIEW);
    e.pay_rank(id, 0).unwrap();
    // paid: the root is final
    assert_err!(e.veto_winners(id, &a), PoolError::WinnersPartlyPaid);
    assert_err!(e.commit_winners(id, &a, &[(w[0], PRICE)]), PoolError::WinnersCommitted);
}

// ---- close_pool ----------------------------------------------------------------------------------------

/// Independent re-computation of the split (u128, floors, remainder to fee).
fn expected(total: u64, prize_bps: u64, seed_bps: u64, platform_bps: u64) -> (u64, u64, u64, u64) {
    let prize = (total as u128 * prize_bps as u128 / 10_000) as u64;
    let seed = (total as u128 * seed_bps as u128 / 10_000) as u64;
    let fee = total - prize - seed;
    let plat = (fee as u128 * platform_bps as u128 / 10_000) as u64;
    (prize, seed, fee - plat, plat)
}

/// Also the v4 form of audit s1-gpt `probe_money_is_conserved_across_random_lifecycles` (settle path): random winners paid through a root,
/// every output of the close re-computed, nothing created or lost.
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
        // a random part of the prize share, over 1..4 random ranks (or no winner at all)
        let mut list = vec![];
        if prize > 3 * e.rent_min() {
            let mut left = rng.range(e.rent_min(), prize / 2);
            for _ in 0..rng.range(1, 4) {
                if left == 0 {
                    break;
                }
                let amt = rng.range(1, left);
                list.push((funded(&mut e.svm, SOL).pubkey(), amt));
                left -= amt;
            }
        }
        let w0: Vec<u64> = list.iter().map(|w| e.bal(&w.0)).collect();
        e.commit_and_pay(id, &auth, &list);
        let paid: u64 = list.iter().map(|w| w.1).sum();
        for (i, (w, l)) in list.iter().enumerate() {
            assert_eq!(e.bal(w) - w0[i], *l, "round {round}: rank {i}");
        }
        let unclaimed = prize - paid;

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
    let (id, _) = active_pool_with(&mut e, 2, 3, default_params().with_open().reviewed());
    let auth = e.authority_kp();
    let stranger = funded(&mut e.svm, SOL);
    let w = wallets(&mut e, 2);
    let p = e.pool(id);
    assert_err!(e.close_pool(id, &auth), PoolError::TooEarly);
    e.warp(PLAY);
    e.commit_winners(id, &auth, &[(w[0], PRICE / 2), (w[1], PRICE / 4)]).unwrap();
    e.warp(p.payout_at);
    assert_err!(e.close_pool(id, &stranger), PoolError::Unauthorized);
    assert_err!(e.close_pool(id, &auth), PoolError::PrizesUnpaid);
    e.pay_rank(id, 1).unwrap();
    assert_err!(e.close_pool(id, &auth), PoolError::PrizesUnpaid);
    e.pay_rank(id, 0).unwrap();
    e.close_pool(id, &auth).unwrap();
    // already settled
    assert_err!(e.close_pool(id, &auth), PoolError::PoolNotActive);
    assert_err!(e.pay_rank(id, 0), PoolError::PoolNotActive);
    // an Open pool cannot be closed
    let id2 = e.create_pool(later(&e, default_params()));
    assert_err!(e.close_pool(id2, &auth), PoolError::PoolNotActive);
    // past payout_at with no root: the admin must commit first (a root of no winner at least)
    let lp = later(&e, default_params().with_open());
    let (id3, _) = active_pool_with(&mut e, 2, 3, lp);
    e.warp(e.pool(id3).payout_at);
    assert_err!(e.close_pool(id3, &auth), PoolError::WinnersNotCommitted);
}

/// The lock binds the close too: a root committed late is not closed (nor paid) before its own pay_from, even after payout_at.
#[test]
fn close_pool_waits_for_the_roots_lock() {
    let mut e = Env::new();
    let (id, _) = active_pool_with(&mut e, 2, 3, default_params().with_open().reviewed());
    let auth = e.authority_kp();
    let p = e.pool(id);
    e.warp(p.payout_at + HOUR);
    e.commit_winners(id, &auth, &[]).unwrap();
    assert_eq!(e.pool(id).pay_from, p.payout_at + HOUR + REVIEW);
    e.warp(p.payout_at + HOUR + REVIEW - 1);
    assert_err!(e.close_pool(id, &auth), PoolError::TooEarly);
    e.warp(p.payout_at + HOUR + REVIEW);
    e.close_pool(id, &auth).unwrap();
}

/// H5 sweep: in v3 the payout key could close a pool before paying anyone, sweeping the prize share into the seed treasury as "unclaimed".
/// Now a close needs every committed rank paid; the payout key can only commit a root, which is public for the lock and vetoable.
#[test]
fn the_payout_key_cannot_close_a_pool_with_unpaid_ranks() {
    let mut e = Env::new();
    let (id, _) = active_pool_with(&mut e, 2, 5, default_params().with_open().reviewed());
    let payout = payout_key(&mut e);
    let w = wallets(&mut e, 3);
    let p = e.pool(id);
    e.warp(PLAY);
    e.commit_winners(id, &payout, &[(w[0], 300_000_000), (w[1], 200_000_000), (w[2], 100_000_000)]).unwrap();
    assert_err!(e.close_pool(id, &payout), PoolError::TooEarly);
    e.warp(p.payout_at);
    let s0 = e.bal(&e.seed_t.pubkey());
    assert_err!(e.close_pool(id, &payout), PoolError::PrizesUnpaid);
    e.pay_rank(id, 0).unwrap();
    e.pay_rank(id, 2).unwrap();
    assert_err!(e.close_pool(id, &payout), PoolError::PrizesUnpaid);
    assert_eq!(e.bal(&e.seed_t.pubkey()), s0);
    e.pay_rank(id, 1).unwrap();
    e.close_pool(id, &payout).unwrap();
    assert_eq!(e.pool(id).prizes_paid, 600_000_000);
}

/// count = 0: the pool had no winner; once the lock is over the pool closes with its whole prize share unclaimed (to the seed treasury).
#[test]
fn a_root_of_no_winner_lets_the_pool_close_after_the_lock() {
    let mut e = Env::new();
    let (id, _) = active_pool_with(&mut e, 2, 5, default_params().with_open().reviewed()); // pot 1 SOL: prize 0.6, seed 0.25, fee 0.15
    let payout = payout_key(&mut e);
    let p = e.pool(id);
    e.warp(PLAY);
    e.commit_winners(id, &payout, &[]).unwrap();
    let q = e.pool(id);
    assert_eq!((q.winners_count, q.winners_total, q.pay_from), (0, 0, p.payout_at));
    assert!(q.has_winners() && q.all_winners_paid());
    assert_err!(e.pay_raw(id, 0, &payout.pubkey(), 1, vec![]), PoolError::TooEarly);
    e.warp(p.payout_at - 1);
    assert_err!(e.close_pool(id, &payout), PoolError::TooEarly);
    e.warp(p.payout_at);
    assert_err!(e.pay_raw(id, 0, &payout.pubkey(), 1, vec![]), PoolError::InvalidParams);
    let s0 = e.bal(&e.seed_t.pubkey());
    e.close_pool(id, &payout).unwrap();
    assert_eq!(e.bal(&e.seed_t.pubkey()) - s0, 250_000_000 + 600_000_000);
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
    let w = funded(&mut e.svm, SOL).pubkey();
    e.warp(PLAY);
    e.commit_and_pay(id, &auth, &[(w, 100_000_000)]);
    let s0 = e.bal(&e.seed_t.pubkey());
    e.close_pool(id, &auth).unwrap();
    assert_eq!(e.bal(&e.seed_t.pubkey()) - s0, 250_000_000 + 500_000_000 + 12_345);
    assert_eq!(e.vault(id), 0);
}

fn solana_system_transfer(from: &Pubkey, to: &Pubkey, lamports: u64) -> anchor_lang::solana_program::instruction::Instruction {
    anchor_lang::solana_program::system_instruction::transfer(from, to, lamports)
}

/// L8: the cut at close is the platform fee the pool opened with, not the one set later.
#[test]
fn the_platform_cut_is_the_pools_snapshot() {
    let mut e = Env::with_platform_fee(1000);
    let (id, _) = active_pool(&mut e, 2, 5); // pot 1 SOL: fee 0.15 SOL
    let a = e.authority_kp();
    assert_eq!(e.pool(id).platform_fee_bps, 1000);
    e.set_config(&a, None, None, Some(5000)).unwrap();
    let (id2, _) = active_pool(&mut e, 2, 5);
    assert_eq!(e.pool(id2).platform_fee_bps, 5000);
    e.warp(PLAY);
    e.commit_winners(id, &a, &[]).unwrap();
    e.commit_winners(id2, &a, &[]).unwrap();
    let (p0, f0) = (e.bal(&e.plat_t.pubkey()), e.bal(&e.fee_t.pubkey()));
    let r = e.close_pool(id, &a).unwrap();
    assert_eq!((e.bal(&e.plat_t.pubkey()) - p0, e.bal(&e.fee_t.pubkey()) - f0), (15_000_000, 135_000_000));
    assert_eq!(events::<PoolClosed>(&r.logs)[0].platform_fee, 15_000_000);
    // a cut lowered after the sale does not shrink it either
    e.set_config(&a, None, None, Some(0)).unwrap();
    let (p0, f0) = (e.bal(&e.plat_t.pubkey()), e.bal(&e.fee_t.pubkey()));
    e.close_pool(id2, &a).unwrap();
    assert_eq!((e.bal(&e.plat_t.pubkey()) - p0, e.bal(&e.fee_t.pubkey()) - f0), (75_000_000, 75_000_000));
}

// ---- pause ------------------------------------------------------------------------------------------------

/// `paused` is the admin's incident switch: before the settle grace it stops commit, pay and close; after the grace no admin is needed, so the
/// pause cannot freeze a pool – anyone pays the committed ranks and closes. The veto still works while paused.
#[test]
fn pause_stops_commit_pay_and_close_only_before_the_grace() {
    let mut e = Env::new();
    let (id, _) = active_pool_with(&mut e, 2, 5, default_params().with_open().reviewed());
    let (id2, _) = active_pool_with(&mut e, 2, 5, default_params().with_open().reviewed());
    let (id3, _) = active_pool_with(&mut e, 2, 5, default_params().with_open().reviewed()); // left uncommitted
    let payout = payout_key(&mut e);
    let a = e.authority_kp();
    let w = wallets(&mut e, 2);
    let p = e.pool(id);
    e.warp(PLAY);
    e.commit_winners(id, &payout, &[(w[0], PRICE), (w[1], PRICE)]).unwrap();
    e.commit_winners(id2, &payout, &[(w[0], PRICE)]).unwrap();
    e.warp(p.payout_at);
    e.pay_rank(id, 0).unwrap();
    e.set_config(&a, Some(true), None, None).unwrap();
    // a stranger is still Unauthorized first; the settlers meet the pause
    let stranger = funded(&mut e.svm, SOL);
    assert_err!(e.commit_winners(id3, &stranger, &[]), PoolError::Unauthorized);
    assert_err!(e.commit_winners(id3, &payout, &[]), PoolError::Paused);
    assert_err!(e.pay_rank(id, 1), PoolError::Paused);
    assert_err!(e.close_pool(id, &payout), PoolError::Paused);
    assert_err!(e.close_pool(id, &a), PoolError::Paused);
    // the veto is the admin's tool in an incident: allowed while paused
    e.veto_winners(id2, &a).unwrap();
    e.warp(p.payout_at + SETTLE_GRACE_SECS - 1);
    assert_err!(e.pay_rank(id, 1), PoolError::Paused);
    // after the grace: a commit is too late anyway, pay and close are anyone's
    e.warp(p.payout_at + SETTLE_GRACE_SECS);
    assert!(e.config().paused);
    assert_err!(e.commit_winners(id2, &payout, &[(w[0], PRICE)]), PoolError::CommitTooLate);
    let w1 = e.bal(&w[1]);
    e.pay_rank(id, 1).unwrap();
    assert_eq!(e.bal(&w[1]) - w1, PRICE);
    e.close_pool(id, &stranger).unwrap();
    assert_eq!((e.pool(id).status, e.vault(id)), (3, 0));
    // the vetoed pool paid nothing: it is expired into refunds, not swept
    assert_err!(e.close_pool(id2, &stranger), PoolError::MustExpire);
    e.expire(id2, &stranger).unwrap();
}

/// After the grace anyone may close a pool that paid something – the unpaid ranks of its root are swept as unclaimed (rule f).
#[test]
fn after_the_grace_anyone_closes_a_partly_paid_pool() {
    let mut e = Env::new();
    let (id, _) = active_pool(&mut e, 2, 5);
    let a = e.authority_kp();
    let w = wallets(&mut e, 2);
    e.warp(PLAY);
    e.commit_winners(id, &a, &[(w[0], PRICE), (w[1], PRICE)]).unwrap();
    e.pay_rank(id, 0).unwrap();
    let stranger = funded(&mut e.svm, SOL);
    e.warp(PAYOUT + SETTLE_GRACE_SECS - 1);
    assert_err!(e.close_pool(id, &stranger), PoolError::Unauthorized);
    e.warp(PAYOUT + SETTLE_GRACE_SECS);
    let s0 = e.bal(&e.seed_t.pubkey());
    let r = e.close_pool(id, &stranger).unwrap();
    assert_eq!(events::<PoolClosed>(&r.logs)[0].unclaimed, 600_000_000 - PRICE);
    assert_eq!(e.bal(&e.seed_t.pubkey()) - s0, 250_000_000 + 600_000_000 - PRICE);
}

// ---- tickets and maths ------------------------------------------------------------------------------------

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
    e.commit_winners(id, &auth, &[]).unwrap();
    assert_err!(e.close_ticket(id, &b1.pubkey(), &sponsor.pubkey()), PoolError::NotSettled);
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
    let w = wallets(&mut e, 2);
    let (price, vault) = (e.pool(id).price_lamports, e.vault(id));
    // price × tickets_sold past u64: the prize cap of commit_winners
    forge(&mut e, &|p| p.price_lamports = u64::MAX / 2 + 1);
    assert_err!(e.commit_winners(id, &auth, &[(w[0], 1_000_000), (w[1], 1_000_000)]), PoolError::MathOverflow);
    forge(&mut e, &|p| p.price_lamports = price);
    e.commit_winners(id, &auth, &[(w[0], 1_000_000), (w[1], 1_000_000)]).unwrap();
    e.pay_rank(id, 0).unwrap();
    // ... of pay_prize, and the split of close_pool (rank 1 marked paid so the close reaches the split)
    forge(&mut e, &|p| p.price_lamports = u64::MAX / 2 + 1);
    assert_err!(e.pay_rank(id, 1), PoolError::MathOverflow);
    forge(&mut e, &|p| p.paid_mask = 0b11);
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
    // nothing moved past rank 0, the pool is still live
    assert_eq!((e.vault(id), e.pool(id).status, e.pool(id).prizes_paid), (vault - 1_000_000, 1, 1_000_000));
}

/// red-team v4 S2: the review lock is the pool's own (Pool.min_review_secs, snapshotted at creation) – a later change of the floor does not reach a running pool.
#[test]
fn the_review_lock_is_snapshotted_when_the_pool_opens() {
    let mut e = Env::new();
    let id = e.create_pool(default_params());   // floors 0
    let auth = e.authority_kp();
    e.set_floors(&auth, Some(14 * DAY), None).unwrap();
    assert_eq!(e.pool(id).min_review_secs, 0);
    let b = funded(&mut e.svm, 10 * SOL);
    e.buy(id, &b, 3).unwrap();
    e.warp(PLAY);
    let w = funded(&mut e.svm, SOL).pubkey();
    e.commit_winners(id, &auth, &[(w, PRICE)]).unwrap();   // with the live floor this would be CommitTooLate (a 14-day lock)
    assert_eq!(e.pool(id).pay_from, PLAY);
    let mut p = later(&e, default_params());
    p.payout_at = p.play_deadline + 14 * DAY;
    let id2 = e.create_pool(p);
    assert_eq!(e.pool(id2).min_review_secs, 14 * DAY);
}
