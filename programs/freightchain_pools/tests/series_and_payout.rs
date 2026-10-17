//! The tier schedule (`set_series` / `open_next_pool`), the payout key (`set_payout_authority`), the review window (`payout_at`) and the v4 lock
//! (`pay_from`), the Config floors, and the audit H5 / M6 regressions.
mod common;

use common::*;
use freightchain_pools::{accounts, error::PoolError, events::*, instruction, MAX_POOL_SECS, MAX_SALE_SECS, MIN_SALE_SECS, SETTLE_GRACE_SECS};
use solana_keypair::Keypair;
use solana_signer::Signer;

const START: i64 = T0 + HOUR;

fn with<F: FnOnce(&mut freightchain_pools::SeriesParams)>(f: F) -> freightchain_pools::SeriesParams {
    let mut p = daily_series(START);
    f(&mut p);
    p
}

// ---- set_series ------------------------------------------------------------------------------------

#[test]
fn set_series_is_the_admins_and_checks_the_rules() {
    let mut e = Env::new();
    let stranger = funded(&mut e.svm, SOL);
    let (f, s) = (e.fee_t.pubkey(), e.seed_t.pubkey());
    assert_err!(e.set_series_as(&stranger, daily_series(START), f, s), PoolError::Unauthorized);
    assert_err!(e.set_series(with(|p| p.price_lamports = 1_000)), PoolError::PriceBelowRentMin);
    assert_err!(e.set_series(with(|p| p.min_tickets = 0)), PoolError::InvalidParams);
    assert_err!(e.set_series(with(|p| p.max_tickets = 2)), PoolError::InvalidParams);
    assert_err!(e.set_series(with(|p| p.max_per_wallet = 0)), PoolError::InvalidParams);
    assert_err!(e.set_series(with(|p| p.sale_secs = MIN_SALE_SECS - 1)), PoolError::InvalidParams);
    assert_err!(e.set_series(with(|p| p.sale_secs = MAX_SALE_SECS + 1)), PoolError::InvalidParams);
    assert_err!(e.set_series(with(|p| p.play_secs = -1)), PoolError::InvalidParams);
    assert_err!(e.set_series(with(|p| p.verify_secs = -1)), PoolError::InvalidParams);
    assert_err!(e.set_series(with(|p| p.verify_secs = MAX_POOL_SECS)), PoolError::InvalidParams);
    // a new series needs a start
    assert_err!(e.set_series(with(|p| p.start_at = 0)), PoolError::InvalidParams);
    assert_err!(e.set_series(with(|p| p.start_at = T0 + MAX_POOL_SECS + 1)), PoolError::InvalidParams);
    // an unfunded treasury
    let empty = Keypair::new().pubkey();
    let a = e.authority_kp();
    assert_err!(e.set_series_as(&a, daily_series(START), empty, s), PoolError::TreasuryNotRentExempt);
    assert!(e.series(1).is_none());

    let r = e.set_series(daily_series(START)).unwrap();
    let ev = events::<SeriesSet>(&r.logs);
    assert_eq!(ev.len(), 1);
    assert_eq!((ev[0].tier, ev[0].sale_secs, ev[0].play_secs, ev[0].verify_secs, ev[0].next_open_at), (1, DAY, 2 * HOUR, 2 * DAY, START));
    let sr = e.series(1).unwrap();
    assert!(sr.enabled);
    assert_eq!((sr.next_open_at, sr.pools_opened, sr.last_pool_id), (START, 0, None));
    assert_eq!((sr.fee_treasury, sr.seed_treasury), (f, s));

    // a rewrite with start_at 0 keeps the schedule's position; the price changes for the NEXT pool only
    e.set_series(with(|p| {
        p.start_at = 0;
        p.price_lamports = 2 * PRICE;
    }))
    .unwrap();
    let sr = e.series(1).unwrap();
    assert_eq!((sr.next_open_at, sr.price_lamports), (START, 2 * PRICE));
}

// ---- open_next_pool ---------------------------------------------------------------------------------

#[test]
fn open_next_pool_opens_the_current_slot_from_the_series() {
    let mut e = Env::new();
    e.set_series(daily_series(START)).unwrap();
    let anyone = funded(&mut e.svm, 10 * SOL);
    assert_err!(e.open_next_pool(1, &anyone), PoolError::TooEarly);

    e.warp(START);
    let before = e.bal(&anyone.pubkey());
    let s = e.series(1).unwrap();
    let i = e.open_next_pool_ix(1, &anyone.pubkey(), s.fee_treasury, s.seed_treasury);
    let r = e.send(&[i], &anyone, &[]).unwrap();
    let id = e.config().pool_count - 1;
    e.next_pool = id + 1;
    let p = e.pool(id);
    assert_eq!((p.status, p.tier, p.price_lamports, p.min_tickets, p.max_tickets, p.max_per_wallet), (0, 1, PRICE, 3, 0, 4));
    assert_eq!((p.prep_deadline, p.play_deadline, p.payout_at), (START + DAY, START + DAY + 2 * HOUR, START + 3 * DAY + 2 * HOUR));
    // the pool snapshots the live Config (the test env's 6000/2500/1500), not a split stored on the series instruction
    assert_eq!((p.prize_bps, p.seed_bps, p.fee_bps, p.paid_tickets_enabled, p.max_player_share_bps), (6000, 2500, 1500, true, 4999));
    // the caller is the creator record (gets the vault rent minimum back at close) and paid both rents
    assert_eq!(p.authority, anyone.pubkey());
    assert_eq!(e.vault(id), e.rent_min());
    assert!(before - e.bal(&anyone.pubkey()) > e.rent_min());
    let ev = events::<PoolCreated>(&r.logs);
    assert_eq!(ev.len(), 1);
    assert!(ev[0].from_series);
    assert_eq!(ev[0].payout_at, p.payout_at);
    let sr = e.series(1).unwrap();
    assert_eq!((sr.next_open_at, sr.pools_opened, sr.last_pool_id), (START + DAY, 1, Some(id)));

    // one pool per slot
    assert_err!(e.open_next_pool(1, &anyone), PoolError::TooEarly);
    e.warp(START + DAY - 1);
    assert_err!(e.open_next_pool(1, &anyone), PoolError::TooEarly);
    // the next slot opens while the first pool is still in its play / review window: pools overlap
    e.warp(START + DAY);
    let id2 = e.open_next_pool(1, &anyone).unwrap();
    assert_eq!(id2, id + 1);
    assert_eq!(e.pool(id2).prep_deadline, START + 2 * DAY);
}

#[test]
fn a_late_opener_never_shifts_the_grid() {
    let mut e = Env::new();
    e.set_series(daily_series(START)).unwrap();
    let anyone = funded(&mut e.svm, 10 * SOL);
    // nobody opened the first two slots: 2.5 days in, the pool of the third slot sells for what is left of it
    e.warp(START + 2 * DAY + 12 * HOUR);
    let id = e.open_next_pool(1, &anyone).unwrap();
    let p = e.pool(id);
    assert_eq!(p.prep_deadline, START + 3 * DAY);
    assert_eq!(p.created_at, START + 2 * DAY + 12 * HOUR);
    assert_eq!(e.series(1).unwrap().next_open_at, START + 3 * DAY);
}

#[test]
fn a_series_change_applies_to_the_next_pool_only() {
    let mut e = Env::new();
    e.set_series(daily_series(START)).unwrap();
    let anyone = funded(&mut e.svm, 10 * SOL);
    e.warp(START);
    let first = e.open_next_pool(1, &anyone).unwrap();
    e.set_series(with(|p| {
        p.start_at = 0;
        p.price_lamports = 3 * PRICE;
        p.verify_secs = DAY;
    }))
    .unwrap();
    assert_eq!(e.pool(first).price_lamports, PRICE);
    e.warp(START + DAY);
    let second = e.open_next_pool(1, &anyone).unwrap();
    let p = e.pool(second);
    assert_eq!(p.price_lamports, 3 * PRICE);
    assert_eq!(p.payout_at, START + 2 * DAY + 2 * HOUR + DAY);
}

#[test]
fn open_next_pool_refused_when_disabled_paused_or_with_other_treasuries() {
    let mut e = Env::new();
    e.set_series(with(|p| p.enabled = false)).unwrap();
    let anyone = funded(&mut e.svm, 10 * SOL);
    e.warp(START);
    assert_err!(e.open_next_pool(1, &anyone), PoolError::SeriesDisabled);
    e.set_series(with(|p| p.start_at = 0)).unwrap();
    let a = e.authority_kp();
    e.set_config(&a, Some(true), None, None).unwrap();
    assert_err!(e.open_next_pool(1, &anyone), PoolError::Paused);
    e.set_config(&a, Some(false), None, None).unwrap();
    // the treasuries are the series' – a caller cannot point a pool's money elsewhere
    let mine = funded(&mut e.svm, SOL);
    let s = e.series(1).unwrap();
    let i = e.open_next_pool_ix(1, &anyone.pubkey(), mine.pubkey(), s.seed_treasury);
    assert_err!(e.send(&[i], &anyone, &[]), PoolError::AccountMismatch);
    let i = e.open_next_pool_ix(1, &anyone.pubkey(), s.fee_treasury, mine.pubkey());
    assert_err!(e.send(&[i], &anyone, &[]), PoolError::AccountMismatch);
    // a series for another tier does not exist: Anchor refuses the uninitialized account
    let i = e.open_next_pool_ix(2, &anyone.pubkey(), s.fee_treasury, s.seed_treasury);
    assert!(e.send(&[i], &anyone, &[]).is_err());
    assert_eq!(e.config().pool_count, 0);
    e.open_next_pool(1, &anyone).unwrap();
}

// ---- the payout key and the review window ---------------------------------------------------------------

/// A daily-series pool with 4 tickets sold, its key holder and the clock at the end of its sale window.
fn sold_pool(e: &mut Env) -> (u32, Keypair) {
    e.set_series(daily_series(START)).unwrap();
    let opener = funded(&mut e.svm, 10 * SOL);
    e.warp(START);
    let id = e.open_next_pool(1, &opener).unwrap();
    let b = funded(&mut e.svm, 10 * SOL);
    e.buy(id, &b, 4).unwrap();
    assert_eq!(e.pool(id).status, 1);
    e.cover_player_share(id);
    let payout = Keypair::new();
    let a = e.authority_kp();
    let r = e.set_payout_authority(&a, Some(payout.pubkey())).unwrap();
    let ev = events::<PayoutAuthoritySet>(&r.logs);
    assert_eq!(ev[0].payout_authority, Some(payout.pubkey()));
    assert_eq!(e.config().payout_authority, Some(payout.pubkey()));
    (id, payout)
}

#[test]
fn set_payout_authority_is_the_admins() {
    let mut e = Env::new();
    let stranger = funded(&mut e.svm, SOL);
    assert_err!(e.set_payout_authority(&stranger, Some(stranger.pubkey())), PoolError::Unauthorized);
    let a = e.authority_kp();
    assert_err!(e.set_payout_authority(&a, Some(anchor_lang::prelude::Pubkey::default())), PoolError::InvalidParams);
    assert_eq!(e.config().payout_authority, None);
    e.set_payout_authority(&a, Some(stranger.pubkey())).unwrap();
    e.set_payout_authority(&a, None).unwrap();
    assert_eq!(e.config().payout_authority, None);
}

/// M6 regression: the v3 version of this test paid ONE wallet at rank 1 and again at rank 2 as expected behaviour. Now the payout key commits the
/// winners at the play deadline, nobody pays before the review window ends, and each rank pays its own leaf once.
#[test]
fn nobody_pays_a_prize_before_the_review_window_ends() {
    let mut e = Env::new();
    let (id, payout) = sold_pool(&mut e);
    let p = e.pool(id);
    let (w0, w1) = (funded(&mut e.svm, SOL).pubkey(), funded(&mut e.svm, SOL).pubkey());
    let a = e.authority_kp();
    e.warp(p.play_deadline - 1);
    assert_err!(e.commit_winners(id, &payout, &[(w0, PRICE), (w1, PRICE)]), PoolError::TooEarly);
    e.warp(p.play_deadline);
    // one lamport over the snapshotted prize share (cover enlarged the pot, so 3×PRICE may now fit)
    let over = e.pool(id).prize_share().unwrap() + 1;
    assert_err!(e.commit_winners(id, &payout, &[(w0, over)]), PoolError::PrizeExceedsShare);
    e.commit_winners(id, &payout, &[(w0, PRICE), (w1, PRICE)]).unwrap();
    assert_eq!(e.pool(id).pay_from, p.payout_at);
    // the play deadline is over, the review window is not: nobody pays, neither the payout key nor the admin closes
    assert_err!(e.pay_rank(id, 0), PoolError::TooEarly);
    assert_err!(e.close_pool(id, &a), PoolError::TooEarly);
    e.warp(p.payout_at - 1);
    assert_err!(e.pay_rank(id, 0), PoolError::TooEarly);
    assert_err!(e.close_pool(id, &payout), PoolError::TooEarly);

    e.warp(p.payout_at);
    let (b0, b1) = (e.bal(&w0), e.bal(&w1));
    e.pay_rank(id, 0).unwrap();
    // the same wallet again, at its own rank or at rank 1
    assert_err!(e.pay_rank(id, 0), PoolError::RankAlreadyPaid);
    let wn = e.winners[&id].clone();
    assert_err!(e.pay_raw(id, 1, &w0, PRICE, wn.proofs[1].clone()), PoolError::InvalidProof);
    e.pay_rank(id, 1).unwrap();
    assert_eq!((e.bal(&w0) - b0, e.bal(&w1) - b1), (PRICE, PRICE));
    // the payout key settles the pool (money only to the declared treasuries)
    e.close_pool(id, &payout).unwrap();
    assert_eq!(e.pool(id).status, 3);
    assert_eq!(e.vault(id), 0);
}

/// A root committed after the play deadline still waits a whole review window from its commit – the lock is what lets anyone check it.
#[test]
fn a_late_commit_waits_a_whole_lock() {
    let mut e = Env::new();
    let (id, payout) = sold_pool(&mut e);
    let p = e.pool(id);
    let w = funded(&mut e.svm, SOL).pubkey();
    e.warp(p.payout_at + HOUR);
    let r = e.commit_winners(id, &payout, &[(w, PRICE)]).unwrap();
    let from = p.payout_at + HOUR + 2 * DAY;
    assert_eq!((e.pool(id).pay_from, events::<WinnersCommitted>(&r.logs)[0].pay_from), (from, from));
    e.warp(from - 1);
    assert_err!(e.pay_rank(id, 0), PoolError::TooEarly);
    assert_err!(e.close_pool(id, &payout), PoolError::TooEarly);
    e.warp(from);
    e.pay_rank(id, 0).unwrap();
    e.close_pool(id, &payout).unwrap();
}

#[test]
fn the_payout_key_can_do_nothing_else() {
    let mut e = Env::new();
    let (id, payout) = sold_pool(&mut e);
    e.svm.airdrop(&payout.pubkey(), 10 * SOL).unwrap();
    let (f, s) = (e.fee_t.pubkey(), e.seed_t.pubkey());
    assert_err!(e.set_series_as(&payout, daily_series(START), f, s), PoolError::Unauthorized);
    assert_err!(e.set_config(&payout, Some(true), None, None), PoolError::Unauthorized);
    assert_err!(e.set_floors(&payout, Some(0), Some(0)), PoolError::Unauthorized);
    assert_err!(e.set_payout_authority(&payout, None), PoolError::Unauthorized);
    assert_err!(e.propose_authority(&payout, payout.pubkey()), PoolError::Unauthorized);
    // cancel an open pool, create a pool by hand
    e.warp(START + DAY);
    let opener = funded(&mut e.svm, 10 * SOL);
    let open = e.open_next_pool(1, &opener).unwrap();
    assert_err!(e.cancel(open, &payout), PoolError::Unauthorized);
    let mut p = later(&e, default_params());
    p.tier = 2;
    let i = {
        let mut i = e.create_pool_ix(p, f, s);
        i.accounts[0].pubkey = payout.pubkey();
        i
    };
    assert_err!(e.send(&[i], &payout, &[]), PoolError::Unauthorized);
    // it commits, but cannot veto – not even its own root
    let w = funded(&mut e.svm, SOL).pubkey();
    e.warp(e.pool(id).play_deadline);
    e.commit_winners(id, &payout, &[(w, PRICE)]).unwrap();
    assert_err!(e.veto_winners(id, &payout), PoolError::Unauthorized);
    // a cleared payout key commits and closes nothing; paying is no privilege (anyone may), so it still can
    let a = e.authority_kp();
    e.veto_winners(id, &a).unwrap();
    e.set_payout_authority(&a, None).unwrap();
    assert_err!(e.commit_winners(id, &payout, &[(w, PRICE)]), PoolError::Unauthorized);
    e.commit_winners(id, &a, &[(w, PRICE)]).unwrap();
    e.warp(e.pool(id).pay_from);
    let wn = e.winners[&id].clone();
    let i = e.pay_prize_ix(id, &payout.pubkey(), 0, &w, PRICE, wn.proofs[0].clone());
    e.send(&[i], &payout, &[]).unwrap();
    assert_err!(e.close_pool(id, &payout), PoolError::Unauthorized);
    e.close_pool(id, &a).unwrap();
}

#[test]
fn the_settle_grace_counts_from_the_end_of_the_review_window() {
    let mut e = Env::new();
    let (id, _payout) = sold_pool(&mut e);
    let p = e.pool(id);
    let stranger = funded(&mut e.svm, SOL);
    // play deadline + the grace is not enough while the review window is longer than nothing
    e.warp(p.play_deadline + SETTLE_GRACE_SECS);
    assert_err!(e.expire(id, &stranger), PoolError::TooEarly);
    e.warp(p.payout_at + SETTLE_GRACE_SECS - 1);
    assert_err!(e.expire(id, &stranger), PoolError::TooEarly);
    assert_err!(e.close_pool(id, &stranger), PoolError::Unauthorized);
    e.warp(p.payout_at + SETTLE_GRACE_SECS);
    // nothing paid: a stranger cannot sweep it, only expire it into refunds
    assert_err!(e.close_pool(id, &stranger), PoolError::MustExpire);
    e.expire(id, &stranger).unwrap();
    assert_eq!(e.pool(id).status, 2);
}

/// The whole day: a pool opens on its slot, sells for 24 h (reaching its minimum), stops selling, rides count 2 h more, the payout key commits
/// the winners at the play deadline, 48 h of review, then anyone pays and the payout key closes; meanwhile the next day's pool has opened and –
/// short of its minimum – failed into refunds.
#[test]
fn a_day_of_the_one_hour_series() {
    let mut e = Env::new();
    let (id, payout) = sold_pool(&mut e);
    let p = e.pool(id);
    let late = funded(&mut e.svm, 10 * SOL);
    e.warp(p.prep_deadline - 1);
    e.buy(id, &late, 1).unwrap();
    e.warp(p.prep_deadline);
    assert_err!(e.buy(id, &late, 1), PoolError::TooLate);

    let opener = funded(&mut e.svm, 10 * SOL);
    let next = e.open_next_pool(1, &opener).unwrap();
    let b = funded(&mut e.svm, 10 * SOL);
    e.buy(next, &b, 1).unwrap(); // 1 of 3

    e.warp(p.play_deadline);
    let w = funded(&mut e.svm, SOL).pubkey();
    e.commit_winners(id, &payout, &[(w, PRICE)]).unwrap();

    e.warp(e.pool(next).prep_deadline);
    e.fail(next).unwrap();
    e.refund(next, &b.pubkey(), &b.pubkey()).unwrap();
    assert_eq!(e.pool(next).status, 2);

    e.warp(p.payout_at);
    let w0 = e.bal(&w);
    e.pay_rank(id, 0).unwrap();
    assert_eq!(e.bal(&w) - w0, PRICE);
    let o0 = e.bal(&p.authority);
    e.close_pool(id, &payout).unwrap();
    assert_eq!((e.pool(id).status, e.vault(id)), (3, 0));
    // the opener of pool `id` got its vault rent minimum back at close
    assert_eq!(e.bal(&p.authority) - o0, e.rent_min());
    assert_eq!(e.series(1).unwrap().pools_opened, 2);
}

// ---- the Config floors (audit H5 / H6: min_review_secs, min_finish_secs) -----------------------------------------

/// The production floors: a series or a pool keeps at least min_finish_secs (3 h) of play after its sale and min_review_secs (1 h) of review.
#[test]
fn set_series_refuses_windows_below_the_floors() {
    let mut e = Env::with_floors();
    assert_eq!((e.config().min_finish_secs, e.config().min_review_secs), (3 * HOUR, HOUR));
    // the old 1 h schedule (2 h to finish) is now too short
    assert_err!(e.set_series(daily_series(START)), PoolError::WindowTooShort);
    assert_err!(e.set_series(with(|p| p.play_secs = 3 * HOUR - 1)), PoolError::WindowTooShort);
    assert_err!(e.set_series(with(|p| {
        p.play_secs = 3 * HOUR;
        p.verify_secs = HOUR - 1;
    })), PoolError::WindowTooShort);
    assert!(e.series(1).is_none());
    // exactly the floors is enough
    e.set_series(with(|p| {
        p.play_secs = 3 * HOUR;
        p.verify_secs = HOUR;
    }))
    .unwrap();
    // a floor raised later stops a rewrite, not the running series (open_next_pool trusts it)
    let a = e.authority_kp();
    e.set_floors(&a, Some(2 * HOUR), Some(4 * HOUR)).unwrap();
    assert_err!(e.set_series(with(|p| {
        p.start_at = 0;
        p.play_secs = 3 * HOUR;
        p.verify_secs = HOUR;
    })), PoolError::WindowTooShort);
    e.warp(START);
    let opener = funded(&mut e.svm, 10 * SOL);
    let id = e.open_next_pool(1, &opener).unwrap();
    let p = e.pool(id);
    assert_eq!((p.play_deadline - p.prep_deadline, p.payout_at - p.play_deadline), (3 * HOUR, HOUR));
}

#[test]
fn create_pool_refuses_windows_below_the_floors() {
    let mut e = Env::with_floors();
    let prep = T0 + 1_000;
    let pool = |finish: i64, review: i64| freightchain_pools::CreatePoolParams {
        prep_deadline: prep,
        play_deadline: prep + finish,
        payout_at: prep + finish + review,
        ..default_params()
    };
    // the default test pool: 4000 s after the sale, no review
    assert_err!(e.try_create_pool(default_params()), PoolError::WindowTooShort);
    assert_err!(e.try_create_pool(pool(3 * HOUR - 1, HOUR)), PoolError::WindowTooShort);
    assert_err!(e.try_create_pool(pool(3 * HOUR, HOUR - 1)), PoolError::WindowTooShort);
    assert_err!(e.try_create_pool(pool(3 * HOUR, 0)), PoolError::WindowTooShort);
    let id = e.create_pool(pool(3 * HOUR, HOUR));
    assert_eq!(e.pool(id).payout_at, prep + 4 * HOUR);
    // floors at 0 (localnet) let any window through
    let a = e.authority_kp();
    e.set_floors(&a, Some(0), Some(0)).unwrap();
    e.create_pool(default_params());
}

/// pay_from = max(payout_at, committed_at + lock), lock = max(payout_at - play_deadline, min_review_secs) read at the commit.
#[test]
fn the_lock_is_the_longer_of_the_review_window_and_min_review_secs() {
    let mut e = Env::with_floors();
    let prep = T0 + 1_000;
    let play = prep + 3 * HOUR;
    let mk = |review: i64| freightchain_pools::CreatePoolParams { min_tickets: 1, prep_deadline: prep, play_deadline: play, payout_at: play + review, ..default_params() };
    let wide = e.create_pool(mk(2 * HOUR)); // window 2 h > floor 1 h
    let tight = e.create_pool(mk(HOUR)); // window = floor
    let raised = e.create_pool(mk(HOUR)); // the floor is raised to 3 h after it opened – its lock stays its own (red-team v4 S2)
    for id in [wide, tight, raised] {
        let b = funded(&mut e.svm, 10 * SOL);
        e.buy(id, &b, 1).unwrap();
        e.cover_player_share(id);
    }
    let a = e.authority_kp();
    let w = funded(&mut e.svm, SOL).pubkey();
    // window = floor, committed at the play deadline: pays at payout_at
    e.warp(play);
    e.commit_winners(tight, &a, &[(w, PRICE / 2)]).unwrap();
    assert_eq!(e.pool(tight).pay_from, play + HOUR);
    // the window dominates: a commit half an hour late pays 2 h after it (past payout_at)
    e.warp(play + HOUR / 2);
    e.commit_winners(wide, &a, &[(w, PRICE / 2)]).unwrap();
    assert_eq!(e.pool(wide).pay_from, play + HOUR / 2 + 2 * HOUR);
    // a floor raised to 3 h after the pool opened does not reach it: its lock is the snapshot it opened with (1 h)
    e.set_floors(&a, Some(3 * HOUR), None).unwrap();
    e.commit_winners(raised, &a, &[(w, PRICE / 2)]).unwrap();
    assert_eq!((e.pool(raised).min_review_secs, e.pool(raised).pay_from), (HOUR, play + HOUR / 2 + HOUR));
    e.warp(play + HOUR - 1);
    assert_err!(e.pay_rank(tight, 0), PoolError::TooEarly);
    e.warp(play + HOUR);
    e.pay_rank(tight, 0).unwrap();
    assert_err!(e.pay_rank(raised, 0), PoolError::TooEarly);
    e.warp(play + HOUR / 2 + HOUR);
    e.pay_rank(raised, 0).unwrap();
    e.warp(play + HOUR / 2 + 2 * HOUR - 1);
    assert_err!(e.pay_rank(wide, 0), PoolError::TooEarly);
    e.warp(play + HOUR / 2 + 2 * HOUR);
    e.pay_rank(wide, 0).unwrap();
}

// ---- audit regressions (2026-10, H5 / M6): the v4 form of every PoC about pay_prize, the attestation as a prize gate and the review window -------

/// a pool at the production floors (3 h to finish, the 1 h minimum review), `tickets` sold
fn floored_pool(e: &mut Env, tickets: u16) -> u32 {
    let prep = e.now() + 1_000;
    let id = e.create_pool(freightchain_pools::CreatePoolParams {
        min_tickets: 2,
        max_tickets: 0,
        max_per_wallet: 100,
        prep_deadline: prep,
        play_deadline: prep + 3 * HOUR,
        payout_at: prep + 4 * HOUR,
        ..default_params()
    });
    let b = funded(&mut e.svm, 50 * SOL);
    e.buy(id, &b, tickets).unwrap();
    e.cover_player_share(id);
    id
}

fn payout_key(e: &mut Env) -> Keypair {
    let payout = funded(&mut e.svm, 10 * SOL);
    let a = e.authority_kp();
    e.set_payout_authority(&a, Some(payout.pubkey())).unwrap();
    payout
}

// audit poc_01 (H5, s1-claude-01) and s1gpt_03 (H5): a stolen payout key alone can no longer move a prize. It can only commit a root, which is
// public for the whole lock (min_review_secs at least) before it pays – the admin vetoes it in that time; attesting and paying in one transaction
// is impossible, and the key cannot close the pool to sweep the share either.
#[test]
fn audit_h5_a_stolen_payout_key_cannot_pay_itself_before_the_admin_can_veto() {
    let mut e = Env::with_floors();
    let p0 = floored_pool(&mut e, 10);
    let p1 = floored_pool(&mut e, 10);
    let thief_key = payout_key(&mut e);
    let thief = Keypair::new().pubkey(); // no ticket, no ride, no lamports
    let payout_at = e.pool(p0).payout_at;
    e.warp(payout_at); // the worst moment: the review window is already over
    // s1gpt_03: commit and pay in ONE transaction – the pay half is TooEarly, the whole transaction reverts
    let share = e.pool(p0).prize_share().unwrap();
    let wn = winners_of(p0, &[(thief, share)]);
    let commit = ix(
        instruction::CommitWinners { pool_id: p0, root: wn.root, total: share, count: 1 },
        accounts::CommitWinners { authority: thief_key.pubkey(), config: config_pda(), pool: pool_pda(p0) },
    );
    let pay = e.pay_prize_ix(p0, &thief_key.pubkey(), 0, &thief, share, wn.proofs[0].clone());
    assert_err!(e.send(&[commit, pay], &thief_key, &[]), PoolError::TooEarly);
    assert!(!e.pool(p0).has_winners());
    // poc_01: a root naming the thief on every pool – none pays during the lock (an hour from the commit, though payout_at is past)
    for id in [p0, p1] {
        let share = e.pool(id).prize_share().unwrap();
        e.commit_winners(id, &thief_key, &[(thief, share)]).unwrap();
        assert_eq!(e.pool(id).pay_from, payout_at + HOUR);
        assert_err!(e.pay_rank(id, 0), PoolError::TooEarly);
        assert_err!(e.close_pool(id, &thief_key), PoolError::TooEarly);
    }
    // the admin sees WinnersCommitted, vetoes both and rotates the key
    let a = e.authority_kp();
    e.warp(payout_at + HOUR - 1);
    for id in [p0, p1] {
        e.veto_winners(id, &a).unwrap();
        assert_err!(e.pay_raw(id, 0, &thief, e.pool(id).prize_share().unwrap(), vec![]), PoolError::WinnersNotCommitted);
        assert_err!(e.close_pool(id, &thief_key), PoolError::WinnersNotCommitted);
    }
    e.set_payout_authority(&a, None).unwrap();
    assert_err!(e.commit_winners(p0, &thief_key, &[(thief, 1)]), PoolError::Unauthorized);
    e.warp(payout_at + 2 * HOUR);
    assert_eq!(e.bal(&thief), 0, "the thief got nothing");
    // a root of no winner is vetoable too (it would sweep the whole share to the seed treasury)
    e.commit_winners(p0, &a, &[]).unwrap();
    e.veto_winners(p0, &a).unwrap();
}

// audit poc_01b (H5, s1-claude-01): pausing the program stops prize payments (before the settle grace).
#[test]
fn audit_h5_pause_stops_prize_payments() {
    let mut e = Env::with_floors();
    let id = floored_pool(&mut e, 10);
    let payout = payout_key(&mut e);
    let thief = funded(&mut e.svm, SOL).pubkey();
    e.warp(e.pool(id).play_deadline);
    let share = e.pool(id).prize_share().unwrap();
    e.commit_winners(id, &payout, &[(thief, share)]).unwrap(); // committed before the admin noticed
    let a = e.authority_kp();
    e.set_config(&a, Some(true), None, None).unwrap();
    e.warp(e.pool(id).pay_from);
    let t0 = e.bal(&thief);
    assert_err!(e.pay_rank(id, 0), PoolError::Paused);
    assert_err!(e.close_pool(id, &payout), PoolError::Paused);
    // the veto works while paused
    e.veto_winners(id, &a).unwrap();
    assert_eq!(e.bal(&thief), t0);
}

// audit poc_03 (M6, s1-claude-03): a winner is paid once, at its rank, the amount of its leaf; a paid root is frozen (no veto, no second commit).
#[test]
fn audit_m6_the_same_winner_cannot_be_paid_twice_and_a_paid_root_is_frozen() {
    let mut e = Env::with_floors();
    let id = floored_pool(&mut e, 10);
    let payout = payout_key(&mut e);
    let winner = funded(&mut e.svm, SOL).pubkey();
    let other = funded(&mut e.svm, SOL).pubkey();
    let share = e.pool(id).prize_share().unwrap();
    e.warp(e.pool(id).play_deadline);
    e.commit_winners(id, &payout, &[(winner, share / 4), (other, share / 4)]).unwrap();
    e.warp(e.pool(id).pay_from);
    let w0 = e.bal(&winner);
    e.pay_rank(id, 0).unwrap();
    assert_err!(e.pay_rank(id, 0), PoolError::RankAlreadyPaid); // same rank again
    let wn = e.winners[&id].clone();
    assert_err!(e.pay_raw(id, 1, &winner, share / 4, wn.proofs[1].clone()), PoolError::InvalidProof); // another rank
    assert_err!(e.pay_raw(id, 2, &winner, share / 4, wn.proofs[0].clone()), PoolError::InvalidParams); // a rank past the count
    assert_eq!(e.bal(&winner) - w0, share / 4);
    let a = e.authority_kp();
    assert_err!(e.veto_winners(id, &a), PoolError::WinnersPartlyPaid);
    assert_err!(e.commit_winners(id, &payout, &[(winner, share / 2)]), PoolError::WinnersCommitted);
}

// audit safe_cross_pool_attestation_and_driver_substitution_are_refused (s1-claude control, H5): v4 form – a proof of one pool does not pay in
// another, one winner's proof does not pay another wallet, a stranger cannot commit, the whole share + 1 cannot be committed.
#[test]
fn audit_h5_cross_pool_proofs_and_wallet_substitution_are_refused() {
    let mut e = Env::with_floors();
    let p0 = floored_pool(&mut e, 10);
    let p1 = floored_pool(&mut e, 10);
    let payout = payout_key(&mut e);
    let winner = funded(&mut e.svm, SOL).pubkey();
    let other = funded(&mut e.svm, SOL).pubkey();
    let rando = funded(&mut e.svm, SOL);
    e.warp(e.pool(p0).play_deadline);
    assert_err!(e.commit_winners(p0, &rando, &[(rando.pubkey(), 1_000_000)]), PoolError::Unauthorized);
    let share = e.pool(p0).prize_share().unwrap();
    assert_err!(e.commit_root(p0, &payout, [1; 32], share + 1, 1), PoolError::PrizeExceedsShare);
    e.commit_winners(p0, &payout, &[(winner, 1_000_000)]).unwrap();
    e.commit_winners(p1, &payout, &[(other, 1_000_000)]).unwrap();
    e.warp(e.pool(p0).pay_from);
    let w0 = e.winners[&p0].clone();
    // p0's leaf + proof presented to p1
    assert_err!(e.pay_raw(p1, 0, &winner, 1_000_000, w0.proofs[0].clone()), PoolError::InvalidProof);
    // the winner's proof used to pay `other` in p0
    assert_err!(e.pay_raw(p0, 0, &other, 1_000_000, w0.proofs[0].clone()), PoolError::InvalidProof);
    e.pay_rank(p0, 0).unwrap();
    e.pay_rank(p1, 0).unwrap();
}

// audit safe_close_and_expire_guards (s1-claude control) in v4: no early close / expiry by a stranger; nothing paid = MustExpire after the grace;
// a pool that paid a prize cannot be expired; an expired pool pays no prize; a stranger's close sends the caller nothing.
#[test]
fn audit_close_and_expire_guards_hold_with_a_committed_root() {
    let mut e = Env::new();
    let mk = |e: &mut Env| {
        let id = e.create_pool(freightchain_pools::CreatePoolParams { min_tickets: 2, max_tickets: 0, max_per_wallet: 100, ..default_params() });
        let b = funded(&mut e.svm, 50 * SOL);
        e.buy(id, &b, 10).unwrap();
        e.cover_player_share(id);
        id
    };
    let id = mk(&mut e);
    let id2 = mk(&mut e);
    let payout = payout_key(&mut e);
    let stranger = funded(&mut e.svm, SOL);
    let winner = funded(&mut e.svm, SOL).pubkey();
    e.warp(PAYOUT);
    e.commit_winners(id, &payout, &[(winner, 1_000_000)]).unwrap();
    e.commit_winners(id2, &payout, &[(winner, 1_000_000)]).unwrap();
    assert_err!(e.close_pool(id, &stranger), PoolError::Unauthorized);
    assert_err!(e.expire(id, &stranger), PoolError::TooEarly);
    e.pay_rank(id2, 0).unwrap();
    e.warp(PAYOUT + SETTLE_GRACE_SECS);
    // a committed but unpaid root does not make the pool closable: nothing paid = refunds
    assert_err!(e.close_pool(id, &stranger), PoolError::MustExpire);
    assert_err!(e.expire(id2, &stranger), PoolError::PrizesAlreadyPaid);
    e.expire(id, &stranger).unwrap();
    assert_err!(e.pay_rank(id, 0), PoolError::PoolNotActive);
    let c0 = e.bal(&stranger.pubkey());
    e.close_pool(id2, &stranger).unwrap();
    assert_eq!(e.vault(id2), 0);
    assert!(e.bal(&stranger.pubkey()) <= c0);
}
