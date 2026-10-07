#[macro_use]
mod common;

use common::*;
use freightchain_pools::{
    error::PoolError,
    events::{PoolCancelled, PoolClosed, PoolFailed, Refunded, Sponsored},
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
    assert_eq!(e.ticket(id, &buyers[1].0.pubkey()).unwrap().refunded, false, "second buyer untouched");
    e.send(&all[1..], &c, &[]).unwrap();
    assert_eq!(e.pool(id).refunded, 2 * PRICE);
}

#[test]
fn close_pool_after_refunds_sweeps_sponsorship_and_rent() {
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

    let (seed0, auth0) = (e.bal(&e.seed_t.pubkey()), e.bal(&auth.pubkey()));
    let r = e.close_pool(id, &auth).unwrap();
    assert_eq!(e.vault(id), 0, "vault ends empty");
    assert_eq!(e.bal(&e.seed_t.pubkey()), seed0 + 777_777, "sponsorship of a failed pool goes to the seed treasury");
    assert_eq!(e.bal(&auth.pubkey()), auth0 + e.rent_min(), "vault rent returned to the authority");
    assert_eq!(e.pool(id).status, 4);
    let ev = events::<PoolClosed>(&r.logs);
    assert!(ev[0].cancelled);
    assert_eq!((ev[0].seed, ev[0].fee, ev[0].rent_returned), (777_777, 0, e.rent_min()));
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
