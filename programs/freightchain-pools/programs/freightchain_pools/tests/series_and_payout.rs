//! The tier schedule (`set_series` / `open_next_pool`), the payout key (`set_payout_authority`) and the review window (`payout_at`).
mod common;

use common::*;
use freightchain_pools::{error::PoolError, events::*, MAX_POOL_SECS, MAX_SALE_SECS, MIN_SALE_SECS, SETTLE_GRACE_SECS};
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
    assert_err!(e.set_series(with(|p| p.prize_bps = 7001)), PoolError::BpsSum);
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
    assert_eq!((p.prize_bps, p.seed_bps, p.fee_bps), (7000, 2000, 1000));
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

#[test]
fn nobody_pays_a_prize_before_the_review_window_ends() {
    let mut e = Env::new();
    let (id, payout) = sold_pool(&mut e);
    let p = e.pool(id);
    let w = funded(&mut e.svm, SOL);
    let a = e.authority_kp();
    e.record_verified_attestation(id, &a, &w.pubkey(), 100).unwrap();
    // the play deadline is over, the review window is not: neither the payout key nor the admin may pay or close
    e.warp(p.play_deadline);
    assert_err!(e.pay_prize(id, &payout, &w.pubkey(), PRICE, 1), PoolError::TooEarly);
    assert_err!(e.pay_prize(id, &a, &w.pubkey(), PRICE, 1), PoolError::TooEarly);
    assert_err!(e.close_pool(id, &a), PoolError::TooEarly);
    e.warp(p.payout_at - 1);
    assert_err!(e.pay_prize(id, &payout, &w.pubkey(), PRICE, 1), PoolError::TooEarly);
    assert_err!(e.close_pool(id, &payout), PoolError::TooEarly);

    e.warp(p.payout_at);
    let before = e.bal(&w.pubkey());
    e.pay_prize(id, &payout, &w.pubkey(), PRICE, 1).unwrap();
    e.pay_prize(id, &a, &w.pubkey(), PRICE, 2).unwrap();
    assert_eq!(e.bal(&w.pubkey()) - before, 2 * PRICE);
    // still capped at the prize share (70 % of 4 tickets = 2.8 tickets' worth; 2 paid)
    assert_err!(e.pay_prize(id, &payout, &w.pubkey(), PRICE, 3), PoolError::PrizeExceedsShare);
    // the payout key settles the pool (money only to the declared treasuries)
    e.close_pool(id, &payout).unwrap();
    assert_eq!(e.pool(id).status, 3);
    assert_eq!(e.vault(id), 0);
}

#[test]
fn the_payout_key_can_do_nothing_else() {
    let mut e = Env::new();
    let (id, payout) = sold_pool(&mut e);
    e.svm.airdrop(&payout.pubkey(), 10 * SOL).unwrap();
    let (f, s) = (e.fee_t.pubkey(), e.seed_t.pubkey());
    assert_err!(e.set_series_as(&payout, daily_series(START), f, s), PoolError::Unauthorized);
    assert_err!(e.set_config(&payout, Some(true), None, None), PoolError::Unauthorized);
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
    // a cleared payout key pays nothing
    let a = e.authority_kp();
    e.set_payout_authority(&a, None).unwrap();
    e.warp(e.pool(id).payout_at);
    let w = funded(&mut e.svm, SOL);
    e.record_verified_attestation(id, &a, &w.pubkey(), 100).unwrap();
    assert_err!(e.pay_prize(id, &payout, &w.pubkey(), PRICE, 1), PoolError::Unauthorized);
    assert_err!(e.close_pool(id, &payout), PoolError::Unauthorized);
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

/// The whole day: a pool opens on its slot, sells for 24 h (reaching its minimum), stops selling, rides count 2 h more, 48 h of review,
/// then the payout key pays and closes; meanwhile the next day's pool has opened and – short of its minimum – failed into refunds.
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
    e.warp(e.pool(next).prep_deadline);
    e.fail(next).unwrap();
    e.refund(next, &b.pubkey(), &b.pubkey()).unwrap();
    assert_eq!(e.pool(next).status, 2);

    e.warp(p.payout_at);
    let w = funded(&mut e.svm, SOL);
    let a = e.authority_kp();
    e.record_verified_attestation(id, &a, &w.pubkey(), 100).unwrap();
    e.pay_prize(id, &payout, &w.pubkey(), PRICE, 1).unwrap();
    e.close_pool(id, &payout).unwrap();
    assert_eq!((e.pool(id).status, e.vault(id)), (3, 0));
    // the opener of pool `id` got its vault rent minimum back at close
    assert_eq!(e.series(1).unwrap().pools_opened, 2);
}
