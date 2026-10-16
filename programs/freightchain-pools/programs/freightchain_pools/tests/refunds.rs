#[macro_use]
mod common;

use common::*;
use freightchain_pools::{
    error::PoolError,
    events::{PoolCancelled, PoolClosed, PoolFailed, Refunded, SponsorRefunded, Sponsored},
};
use solana_keypair::Keypair;
use solana_signer::Signer;

/// Pool with min 3 and 2 buyers (1 + 1 tickets), each paid for by its own sponsor key. Still Open.
fn failing_pool(e: &mut Env) -> (u32, Vec<(Keypair, Keypair)>) {
    let id = e.create_pool(default_params());
    let mut v = vec![];
    for _ in 0..2 {
        let buyer = funded(&mut e.svm, 5 * SOL);
        let sponsor = funded(&mut e.svm, SOL);
        e.buy_sponsored(id, &buyer, &sponsor, 1).unwrap();
        v.push((buyer, sponsor));
    }
    (id, v)
}

#[test]
fn fail_pool_conditions() {
    let mut e = Env::new();
    let (id, _) = failing_pool(&mut e);
    // before the deadline
    assert_err!(e.fail(id), PoolError::NotFailable);
    e.warp(PREP - 1);
    assert_err!(e.fail(id), PoolError::NotFailable);
    // after the deadline, below min: anyone can crank
    e.warp(PREP);
    let r = e.fail(id).unwrap();
    let ev = events::<PoolFailed>(&r.logs);
    assert_eq!((ev[0].pool_id, ev[0].tickets_sold), (id, 2));
    assert_eq!(e.pool(id).status, 2);
    // not twice
    assert_err!(e.fail(id), PoolError::NotFailable);

    // an Active pool (min reached) can never be failed, even past the deadline
    let id2 = e.create_pool(default_params().with(|x| {
        x.prep_deadline = PREP + 10;
        x.play_deadline = PLAY + 10;
        x.payout_at = PLAY + 10;
    }));
    let a = funded(&mut e.svm, 10 * SOL);
    e.buy(id2, &a, 3).unwrap();
    e.warp(PLAY + 100);
    assert_err!(e.fail(id2), PoolError::NotFailable);
}

trait With {
    fn with(self, f: impl FnOnce(&mut Self)) -> Self;
}
impl With for freightchain_pools::CreatePoolParams {
    fn with(mut self, f: impl FnOnce(&mut Self)) -> Self {
        f(&mut self);
        self
    }
}

#[test]
fn refund_returns_price_to_buyer_and_rent_to_rent_payer() {
    let mut e = Env::new();
    let (id, buyers) = failing_pool(&mut e);
    let vault_before = e.vault(id);
    assert_eq!(vault_before, e.rent_min() + 2 * PRICE);
    e.warp(PREP);
    e.fail(id).unwrap();

    for (buyer, sponsor) in &buyers {
        let rent = e.bal(&ticket_pda(id, &buyer.pubkey()));
        assert!(rent > 0);
        let (b0, s0) = (e.bal(&buyer.pubkey()), e.bal(&sponsor.pubkey()));
        // a third party (the cranker) pays the fee, so the deltas are exact
        let r = e.refund(id, &buyer.pubkey(), &sponsor.pubkey()).unwrap();
        assert_eq!(e.bal(&buyer.pubkey()), b0 + PRICE, "buyer gets the exact price and no rent");
        assert_eq!(e.bal(&sponsor.pubkey()), s0 + rent, "rent goes to the rent payer");
        assert!(e.ticket(id, &buyer.pubkey()).is_none());
        let ev = events::<Refunded>(&r.logs);
        assert_eq!(ev.len(), 1);
        assert_eq!(
            (ev[0].pool_id, ev[0].buyer, ev[0].rent_payer, ev[0].qty, ev[0].lamports),
            (id, buyer.pubkey(), sponsor.pubkey(), 1, PRICE)
        );
    }
    let pool = e.pool(id);
    assert_eq!(pool.refunded, 2 * PRICE);
    // all refunded: the vault holds exactly its rent minimum, which close_pool hands back to the authority
    assert_eq!(e.vault(id), e.rent_min());
}

#[test]
fn refund_to_wrong_accounts_is_rejected() {
    let mut e = Env::new();
    let (id, buyers) = failing_pool(&mut e);
    e.warp(PREP);
    e.fail(id).unwrap();
    let (b, s) = (&buyers[0].0, &buyers[0].1);
    let thief = Keypair::new();
    // price to someone else: the Ticket PDA is derived from the buyer account, so it does not even exist
    assert!(e.refund(id, &thief.pubkey(), &s.pubkey()).is_err());
    // rent to someone else
    assert_err!(e.refund(id, &b.pubkey(), &thief.pubkey()), PoolError::AccountMismatch);
    e.refund(id, &b.pubkey(), &s.pubkey()).unwrap();
}

#[test]
fn refund_requires_refunding_state() {
    let mut e = Env::new();
    let (id, buyers) = failing_pool(&mut e);
    let (b, s) = (&buyers[0].0, &buyers[0].1);
    assert_err!(e.refund(id, &b.pubkey(), &s.pubkey()), PoolError::NotRefunding); // Open
    let a = funded(&mut e.svm, 10 * SOL);
    e.buy(id, &a, 1).unwrap(); // reaches min -> Active
    assert_err!(e.refund(id, &b.pubkey(), &s.pubkey()), PoolError::NotRefunding);
}

#[test]
fn refund_twice_is_rejected_and_pays_nothing() {
    let mut e = Env::new();
    let (id, buyers) = failing_pool(&mut e);
    e.warp(PREP);
    e.fail(id).unwrap();
    let (b, s) = (&buyers[0].0, &buyers[0].1);
    e.refund(id, &b.pubkey(), &s.pubkey()).unwrap();
    let (v, bb, ss) = (e.vault(id), e.bal(&b.pubkey()), e.bal(&s.pubkey()));
    assert_err!(e.refund(id, &b.pubkey(), &s.pubkey()), PoolError::AlreadyRefunded);
    assert_eq!((e.vault(id), e.bal(&b.pubkey()), e.bal(&s.pubkey())), (v, bb, ss));
    assert_eq!(e.pool(id).refunded, PRICE);
}

#[test]
fn batch_of_eight_refunds_and_resent_batch() {
    let mut e = Env::new();
    let id = e.create_pool(default_params().with(|x| {
        x.min_tickets = 20;
        x.max_tickets = 0;
    }));
    let sponsor = funded(&mut e.svm, 10 * SOL);
    let mut buyers = vec![];
    for _ in 0..8 {
        let b = funded(&mut e.svm, 5 * SOL);
        e.buy_sponsored(id, &b, &sponsor, 2).unwrap();
        buyers.push(b);
    }
    e.warp(PREP);
    e.fail(id).unwrap();
    let before: Vec<u64> = buyers.iter().map(|b| e.bal(&b.pubkey())).collect();
    let s0 = e.bal(&sponsor.pubkey());
    let rent_total: u64 = buyers.iter().map(|b| e.bal(&ticket_pda(id, &b.pubkey()))).sum();

    let c = clone_kp(&e.cranker);
    let ixs: Vec<_> = buyers.iter().map(|b| e.refund_ix(id, &c.pubkey(), &b.pubkey(), &sponsor.pubkey())).collect();
    let r = e.send(&ixs, &c, &[]).expect("8 refunds fit one transaction");
    assert_eq!(events::<Refunded>(&r.logs).len(), 8);
    for (i, b) in buyers.iter().enumerate() {
        assert_eq!(e.bal(&b.pubkey()), before[i] + 2 * PRICE);
        assert!(e.ticket(id, &b.pubkey()).is_none());
    }
    assert_eq!(e.bal(&sponsor.pubkey()), s0 + rent_total);
    assert_eq!(e.vault(id), e.rent_min());
    assert_eq!(e.pool(id).refunded, 16 * PRICE);

    // the re-sent batch fails as a whole (AlreadyRefunded) and moves nothing
    let snapshot = (e.vault(id), e.bal(&sponsor.pubkey()), e.pool(id).refunded);
    assert_err!(e.send(&ixs, &c, &[]), PoolError::AlreadyRefunded);
    assert_eq!((e.vault(id), e.bal(&sponsor.pubkey()), e.pool(id).refunded), snapshot);
}

#[test]
fn resent_batch_after_partial_progress_is_rebuilt_from_remaining() {
    // one buyer was refunded by another cranker: the stale batch fails atomically, the rebuilt one lands
    let mut e = Env::new();
    let (id, buyers) = failing_pool(&mut e);
    e.warp(PREP);
    e.fail(id).unwrap();
    let c = clone_kp(&e.cranker);
    let all: Vec<_> = buyers.iter().map(|(b, s)| e.refund_ix(id, &c.pubkey(), &b.pubkey(), &s.pubkey())).collect();
    e.refund(id, &buyers[0].0.pubkey(), &buyers[0].1.pubkey()).unwrap();
    assert_err!(e.send(&all, &c, &[]), PoolError::AlreadyRefunded);
    assert!(e.ticket(id, &buyers[1].0.pubkey()).is_some(), "second buyer untouched");
    e.send(&all[1..], &c, &[]).unwrap();
    assert_eq!(e.pool(id).refunded, 2 * PRICE);
}

/// audit s1-claude poc_05 (M8): the sponsorship of a failed pool goes back to its sponsor, not to the seed treasury.
#[test]
fn close_pool_after_refunds_returns_sponsorship_and_sweeps_rent() {
    let mut e = Env::new();
    let (id, buyers) = failing_pool(&mut e);
    let sp = funded(&mut e.svm, 10 * SOL);
    let r = {
        let i = e.sponsor_ix(id, &sp.pubkey(), 777_777);
        e.send(&[i], &sp, &[]).unwrap()
    };
    let ev = events::<Sponsored>(&r.logs);
    assert_eq!((ev[0].lamports, ev[0].sponsored_total), (777_777, 777_777));
    e.warp(PREP);
    e.fail(id).unwrap();
    let auth = e.authority_kp();
    // refunds still pending
    assert_err!(e.close_pool(id, &auth), PoolError::RefundsPending);
    e.refund(id, &buyers[0].0.pubkey(), &buyers[0].1.pubkey()).unwrap();
    assert_err!(e.close_pool(id, &auth), PoolError::RefundsPending);
    e.refund(id, &buyers[1].0.pubkey(), &buyers[1].1.pubkey()).unwrap();
    assert_eq!(e.vault(id), e.rent_min() + 777_777);
    // every ticket is back, the sponsorship is not
    assert_err!(e.close_pool(id, &auth), PoolError::SponsorRefundsPending);
    let (s0, rent) = (e.bal(&sp.pubkey()), e.bal(&receipt_pda(id, &sp.pubkey())));
    e.refund_sponsor(id, &sp.pubkey()).unwrap();
    assert_eq!(e.bal(&sp.pubkey()), s0 + 777_777 + rent, "sponsorship + receipt rent back");

    let (seed0, auth0) = (e.bal(&e.seed_t.pubkey()), e.bal(&auth.pubkey()));
    let r = e.close_pool(id, &auth).unwrap();
    assert_eq!(e.vault(id), 0, "vault ends empty");
    assert_eq!(e.bal(&e.seed_t.pubkey()), seed0, "the seed treasury gets nothing of a failed pool");
    assert_eq!(e.bal(&auth.pubkey()), auth0 + e.rent_min(), "vault rent returned to the authority");
    assert_eq!(e.pool(id).status, 4);
    let ev = events::<PoolClosed>(&r.logs);
    assert!(ev[0].cancelled);
    assert_eq!((ev[0].seed, ev[0].fee, ev[0].rent_returned), (0, 0, e.rent_min()));
}

/// audit s1-claude poc_05 (M8): two sponsors (one sponsoring twice = one receipt with the sum); a stranger cranks every refund.
#[test]
fn failed_pool_refunds_every_sponsor_before_it_closes() {
    let mut e = Env::new();
    let (id, buyers) = failing_pool(&mut e);
    let a = funded(&mut e.svm, 10 * SOL);
    let b = funded(&mut e.svm, 10 * SOL);
    for (s, l) in [(&a, 2 * SOL), (&b, 300_000_000), (&a, 5)] {
        let i = e.sponsor_ix(id, &s.pubkey(), l);
        e.send(&[i], s, &[]).unwrap();
    }
    let ra = e.receipt(id, &a.pubkey()).unwrap();
    assert_eq!((ra.pool, ra.sponsor, ra.lamports), (pool_pda(id), a.pubkey(), 2 * SOL + 5));
    assert_eq!(e.receipt(id, &b.pubkey()).unwrap().lamports, 300_000_000);
    assert_eq!(e.pool(id).sponsored, 2 * SOL + 5 + 300_000_000);
    // not before the pool fails
    assert_err!(e.refund_sponsor(id, &a.pubkey()), PoolError::NotRefunding);
    e.warp(PREP);
    e.fail(id).unwrap();
    let stranger = funded(&mut e.svm, SOL);

    // the sponsors first: the ticket money stays for the buyers
    let rent = e.bal(&receipt_pda(id, &a.pubkey()));
    let (a0, b0, v0) = (e.bal(&a.pubkey()), e.bal(&b.pubkey()), e.vault(id));
    let r = e.refund_sponsor(id, &a.pubkey()).unwrap();
    let ev = events::<SponsorRefunded>(&r.logs);
    assert_eq!((ev[0].pool_id, ev[0].sponsor, ev[0].lamports, ev[0].sponsor_refunded_total), (id, a.pubkey(), 2 * SOL + 5, 2 * SOL + 5));
    assert_eq!(e.bal(&a.pubkey()), a0 + 2 * SOL + 5 + rent);
    assert!(e.receipt(id, &a.pubkey()).is_none(), "the receipt is closed");
    // a second refund finds no receipt and moves nothing
    assert!(e.refund_sponsor(id, &a.pubkey()).is_err());
    assert_eq!(e.bal(&a.pubkey()), a0 + 2 * SOL + 5 + rent);
    assert_eq!(e.vault(id), v0 - 2 * SOL - 5);
    for (buyer, payer) in &buyers {
        e.refund(id, &buyer.pubkey(), &payer.pubkey()).unwrap();
    }
    assert_err!(e.close_pool(id, &stranger), PoolError::SponsorRefundsPending);
    e.refund_sponsor(id, &b.pubkey()).unwrap();
    assert_eq!(e.bal(&b.pubkey()), b0 + 300_000_000 + rent);
    let p = e.pool(id);
    assert_eq!((p.sponsor_refunded, p.refunded), (p.sponsored, 2 * PRICE));
    assert_eq!(e.vault(id), e.rent_min());
    let seed0 = e.bal(&e.seed_t.pubkey());
    e.close_pool(id, &stranger).unwrap();
    assert_eq!((e.vault(id), e.pool(id).status, e.bal(&e.seed_t.pubkey())), (0, 4, seed0));
}

/// The receipt is bound to its sponsor: the money cannot be redirected, and an admin-cancelled pool refunds sponsors too.
#[test]
fn refund_sponsor_pays_only_the_receipts_sponsor() {
    let mut e = Env::new();
    let id = e.create_pool(default_params());
    let sp = funded(&mut e.svm, 10 * SOL);
    let i = e.sponsor_ix(id, &sp.pubkey(), SOL);
    e.send(&[i], &sp, &[]).unwrap();
    let auth = e.authority_kp();
    e.cancel(id, &auth).unwrap();
    let thief = funded(&mut e.svm, SOL);
    let c = clone_kp(&e.cranker);
    // the sponsor's receipt presented with the thief as the payee: the receipt PDA does not match
    let bad = ix(
        freightchain_pools::instruction::RefundSponsor { pool_id: id },
        freightchain_pools::accounts::RefundSponsor {
            caller: c.pubkey(),
            pool: pool_pda(id),
            vault: vault_pda(id),
            receipt: receipt_pda(id, &sp.pubkey()),
            sponsor: thief.pubkey(),
            system_program: anchor_lang::solana_program::system_program::ID,
        },
    );
    let v0 = e.vault(id);
    assert!(e.send(&[bad], &c, &[]).is_err());
    // the thief has no receipt of its own
    assert!(e.refund_sponsor(id, &thief.pubkey()).is_err());
    assert_eq!((e.vault(id), e.bal(&thief.pubkey())), (v0, SOL));
    let s0 = e.bal(&sp.pubkey());
    e.refund_sponsor(id, &sp.pubkey()).unwrap();
    assert!(e.bal(&sp.pubkey()) > s0 + SOL);
    assert_eq!(e.vault(id), e.rent_min());
}

#[test]
fn refund_sponsor_only_from_a_refunding_pool() {
    let mut e = Env::new();
    let id = e.create_pool(default_params().with(|x| x.max_tickets = 0));
    let sp = funded(&mut e.svm, 10 * SOL);
    let i = e.sponsor_ix(id, &sp.pubkey(), SOL);
    e.send(&[i], &sp, &[]).unwrap();
    assert_err!(e.refund_sponsor(id, &sp.pubkey()), PoolError::NotRefunding); // Open
    let a = funded(&mut e.svm, 10 * SOL);
    e.buy(id, &a, 3).unwrap();
    assert_err!(e.refund_sponsor(id, &sp.pubkey()), PoolError::NotRefunding); // Active
    e.warp(PLAY);
    let auth = e.authority_kp();
    e.commit_winners(id, &auth, &[(a.pubkey(), 10_000_000)]).unwrap();
    e.pay_rank(id, 0).unwrap();
    assert_err!(e.refund_sponsor(id, &sp.pubkey()), PoolError::NotRefunding);
    // the receipt of a pool that paid out stays until Settled
    assert_err!(e.close_sponsor_receipt(id, &sp.pubkey()), PoolError::NotSettled);
    e.close_pool(id, &auth).unwrap();
    assert_err!(e.refund_sponsor(id, &sp.pubkey()), PoolError::NotRefunding); // Settled: the sponsorship was in the split
}

#[test]
fn close_sponsor_receipt_only_after_settled_returns_the_rent() {
    let mut e = Env::new();
    let id = e.create_pool(default_params().with(|x| x.max_tickets = 0));
    let sp = funded(&mut e.svm, 10 * SOL);
    let i = e.sponsor_ix(id, &sp.pubkey(), SOL);
    e.send(&[i], &sp, &[]).unwrap();
    assert_err!(e.close_sponsor_receipt(id, &sp.pubkey()), PoolError::NotSettled); // Open
    let a = funded(&mut e.svm, 10 * SOL);
    e.buy(id, &a, 3).unwrap();
    assert_err!(e.close_sponsor_receipt(id, &sp.pubkey()), PoolError::NotSettled); // Active
    e.warp(PLAY);
    let auth = e.authority_kp();
    e.commit_winners(id, &auth, &[]).unwrap();
    e.close_pool(id, &auth).unwrap();
    assert_eq!(e.pool(id).status, 3);
    let (s0, rent) = (e.bal(&sp.pubkey()), e.bal(&receipt_pda(id, &sp.pubkey())));
    assert!(rent > 0);
    e.close_sponsor_receipt(id, &sp.pubkey()).unwrap();
    assert_eq!(e.bal(&sp.pubkey()), s0 + rent, "only the rent: the sponsorship was in the split");
    assert!(e.receipt(id, &sp.pubkey()).is_none());
    assert!(e.close_sponsor_receipt(id, &sp.pubkey()).is_err(), "closed once");

    // a Refunding / Cancelled pool's receipt goes through refund_sponsor, never close_sponsor_receipt
    let id2 = e.create_pool(later(&e, default_params()));
    let i = e.sponsor_ix(id2, &sp.pubkey(), SOL);
    e.send(&[i], &sp, &[]).unwrap();
    e.cancel(id2, &auth).unwrap();
    assert_err!(e.close_sponsor_receipt(id2, &sp.pubkey()), PoolError::NotSettled);
}

/// audit s1-claude poc_05b (M8): an ABSENT operator's expired pool gives the sponsorship back too.
#[test]
fn expired_pool_returns_the_sponsorship() {
    let mut e = Env::new();
    let id = e.create_pool(default_params().with(|x| {
        x.min_tickets = 2;
        x.max_tickets = 0;
    }));
    let sponsor = funded(&mut e.svm, 10 * SOL);
    let i = e.sponsor_ix(id, &sponsor.pubkey(), 2 * SOL);
    e.send(&[i], &sponsor, &[]).unwrap();
    let buyer = funded(&mut e.svm, SOL);
    e.buy(id, &buyer, 2).unwrap();
    assert_eq!(e.pool(id).status, 1);
    // the operator never settles: the escape hatch
    e.warp(PAYOUT + freightchain_pools::SETTLE_GRACE_SECS);
    let anyone = funded(&mut e.svm, SOL);
    e.expire(id, &anyone).unwrap();
    e.refund(id, &buyer.pubkey(), &buyer.pubkey()).unwrap();
    assert_err!(e.close_pool(id, &anyone), PoolError::SponsorRefundsPending);
    let (s0, seed0) = (e.bal(&sponsor.pubkey()), e.bal(&e.seed_t.pubkey()));
    e.refund_sponsor(id, &sponsor.pubkey()).unwrap();
    e.close_pool(id, &anyone).unwrap();
    assert!(e.bal(&sponsor.pubkey()) - s0 >= 2 * SOL, "the sponsor got the 2 SOL back");
    assert_eq!(e.bal(&e.seed_t.pubkey()), seed0, "the seed treasury got nothing");
    assert_eq!((e.vault(id), e.pool(id).status), (0, 4));
}

#[test]
fn cancel_pool_authority_only_open_only_then_refunds() {
    let mut e = Env::new();
    let (id, buyers) = failing_pool(&mut e);
    let stranger = funded(&mut e.svm, SOL);
    assert_err!(e.cancel(id, &stranger), PoolError::Unauthorized);
    let auth = e.authority_kp();
    let r = e.cancel(id, &auth).unwrap();
    assert_eq!(events::<PoolCancelled>(&r.logs)[0].tickets_sold, 2);
    assert_eq!(e.pool(id).status, 2);
    assert_err!(e.cancel(id, &auth), PoolError::PoolNotOpen);
    // refunds work before any deadline for a cancelled pool
    e.refund(id, &buyers[0].0.pubkey(), &buyers[0].1.pubkey()).unwrap();

    // an Active pool cannot be cancelled
    let id2 = e.create_pool(default_params());
    let a = funded(&mut e.svm, 10 * SOL);
    e.buy(id2, &a, 3).unwrap();
    assert_err!(e.cancel(id2, &auth), PoolError::PoolNotOpen);
}

#[test]
fn sponsor_counted_and_state_checked() {
    let mut e = Env::new();
    let id = e.create_pool(default_params());
    let sp = funded(&mut e.svm, 10 * SOL);
    let v0 = e.vault(id);
    let i = e.sponsor_ix(id, &sp.pubkey(), SOL);
    e.send(&[i], &sp, &[]).unwrap();
    let i = e.sponsor_ix(id, &sp.pubkey(), 5);
    e.send(&[i], &sp, &[]).unwrap();
    assert_eq!(e.pool(id).sponsored, SOL + 5);
    assert_eq!(e.receipt(id, &sp.pubkey()).unwrap().lamports, SOL + 5, "one receipt per sponsor and pool");
    assert_eq!(e.vault(id), v0 + SOL + 5);
    assert_eq!(e.pool(id).tickets_sold, 0, "sponsorship is not a ticket");
    let i = e.sponsor_ix(id, &sp.pubkey(), 0);
    assert_err!(e.send(&[i], &sp, &[]), PoolError::InvalidParams);
    // not into a refunding pool
    let auth = e.authority_kp();
    e.cancel(id, &auth).unwrap();
    let i = e.sponsor_ix(id, &sp.pubkey(), 1);
    assert_err!(e.send(&[i], &sp, &[]), PoolError::PoolNotOpen);
    // not after the play deadline
    let id2 = e.create_pool(default_params());
    e.warp(PLAY);
    let i = e.sponsor_ix(id2, &sp.pubkey(), 1);
    assert_err!(e.send(&[i], &sp, &[]), PoolError::TooLate);
}

/// red-team v4 S1: a 1-lamport sponsorship from a wallet emptied since – the receipt's own rent reaches the sponsor in the same instruction, so the refund (and the
/// pool's close) must not stall on the sponsor's balance.
#[test]
fn refund_sponsor_counts_the_receipts_rent_toward_the_sponsors_minimum() {
    let mut e = Env::new();
    let (id, buyers) = failing_pool(&mut e);
    let sponsor = funded(&mut e.svm, SOL);
    let i = e.sponsor_ix(id, &sponsor.pubkey(), 1);
    e.send(&[i], &sponsor, &[]).unwrap();
    let mut acc = e.svm.get_account(&sponsor.pubkey()).unwrap();
    acc.lamports = 0;
    e.svm.set_account(sponsor.pubkey(), acc).unwrap();
    e.warp(PREP);
    e.fail(id).unwrap();
    for (b, rp) in &buyers {
        e.refund(id, &b.pubkey(), &rp.pubkey()).unwrap();
    }
    let receipt_rent = e.bal(&receipt_pda(id, &sponsor.pubkey()));
    e.refund_sponsor(id, &sponsor.pubkey()).unwrap();
    assert_eq!(e.bal(&sponsor.pubkey()), 1 + receipt_rent);
    let auth = e.authority_kp();
    e.close_pool(id, &auth).unwrap();
}

/// red-team v4 M1: a Settled v3 pool no longer deserializes as a v4 Pool – its buyers' Ticket rent must still come back (close_ticket reads the pool's status raw).
#[test]
fn tickets_of_a_settled_v3_pool_still_close_after_the_upgrade() {
    let mut e = Env::new();
    let id = e.create_pool(default_params());
    let (buyers, mut payers) = (vec![funded(&mut e.svm, 10 * SOL), funded(&mut e.svm, 10 * SOL), funded(&mut e.svm, 10 * SOL)], vec![]);
    for b in &buyers {
        e.buy(id, b, 1).unwrap();
        payers.push(b.pubkey());
    }
    e.warp(PLAY);
    let auth = e.authority_kp();
    e.commit_and_pay(id, &auth, &[]);
    e.close_pool(id, &auth).unwrap();
    // cut the account back to the v3 layout (the v4 fields are appended after `seed_slot_hash`)
    let v4_extra = 8 + 2 + 32 + 8 + 1 + 8 + 8 + 8 + 8 + 4 + 8;
    let mut acc = e.svm.get_account(&pool_pda(id)).unwrap();
    let v3_len = acc.data.len() - v4_extra;
    acc.data.truncate(v3_len);
    e.svm.set_account(pool_pda(id), acc).unwrap();
    assert!(e.svm.get_account(&pool_pda(id)).unwrap().data.len() == v3_len);
    let rent = e.bal(&ticket_pda(id, &buyers[0].pubkey()));
    let before = e.bal(&payers[0]);
    e.close_ticket(id, &buyers[0].pubkey(), &payers[0]).unwrap();
    assert_eq!(e.bal(&payers[0]), before + rent);
}
