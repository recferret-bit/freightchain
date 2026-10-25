#[macro_use]
mod common;
use common::*;
use freightchain_pools::{error::PoolError, events::PoolActivated, STATUS_ACTIVE, STATUS_SETTLED};
use solana_signer::Signer;

#[test]
fn sponsor_only_pool_settles_without_a_single_ticket() {
    let mut e = Env::new();
    let created = e.try_create_pool(default_params()).unwrap();
    let id = 0;
    assert_eq!(e.pool(id).status, STATUS_ACTIVE);
    assert_eq!(events::<PoolActivated>(&created.logs)[0].tickets_sold, 0);
    let sponsor = funded(&mut e.svm, 3 * SOL);
    let ix = e.sponsor_ix(id, &sponsor.pubkey(), SOL);
    e.send(&[ix], &sponsor, &[]).unwrap();
    e.warp(PREP);
    assert_err!(e.fail(id), PoolError::NotFailable);
    e.warp(PLAY);
    let winner = funded(&mut e.svm, SOL);
    let before = e.bal(&winner.pubkey());
    let admin = e.authority_kp();
    e.commit_and_pay(id, &admin, &[(winner.pubkey(), SOL / 10)]);
    assert_eq!(e.bal(&winner.pubkey()), before + SOL / 10);
    assert_err!(e.cancel(id, &admin), PoolError::PrizesAlreadyPaid);
    e.close_pool(id, &admin).unwrap();
    assert_eq!((e.pool(id).status, e.pool(id).tickets_sold, e.vault(id)), (STATUS_SETTLED, 0, 0));
}

#[test]
fn upcoming_pool_refuses_early_sales_then_sells_at_open() {
    let mut e = Env::new();
    let mut p = default_params();
    p.opens_at = T0 + 10;
    let id = e.create_pool(p);
    let buyer = funded(&mut e.svm, SOL);
    assert_err!(e.buy(id, &buyer, 1), PoolError::TooEarly);
    e.warp(T0 + 10);
    e.buy(id, &buyer, 1).unwrap();
    assert_eq!(e.pool(id).status, STATUS_ACTIVE);
}

#[test]
fn seal_cannot_reveal_or_rearm_after_last_start() {
    let mut e = Env::new();
    let id = e.create_pool(default_params());
    let target = e.pool(id).seal_slot;
    e.set_slot(target + 4);
    e.set_slot_hashes(&[(target + 2, [1;32]), (target, [2;32]), (target - 1, [3;32])]);
    e.warp(PLAY);
    let caller = clone_kp(&e.cranker);
    let ix = e.seal_road_ix(id, &caller.pubkey());
    assert_err!(e.send(&[ix], &caller, &[]), PoolError::TooLate);
    assert_eq!(e.pool(id).seal_slot, target);
}

#[test]
fn weekly_period_keeps_a_five_day_sale_and_a_separate_grid() {
    let mut e = Env::new();
    let mut s = daily_series(T0);
    s.sale_secs = 5 * DAY;
    s.period_secs = 7 * DAY;
    e.set_series(s).unwrap();
    let caller = funded(&mut e.svm, 20 * SOL);
    let first = e.open_next_pool(1, &caller).unwrap();
    let pool = e.pool(first);
    assert_eq!((pool.opens_at, pool.prep_deadline, pool.last_start_at), (T0, T0 + 5 * DAY, T0 + 5 * DAY + 2 * HOUR - 4500));
    assert_eq!(e.series(1).unwrap().next_open_at, T0 + 7 * DAY);
    e.warp(T0 + 5 * DAY + 1);
    assert_err!(e.open_next_pool(1, &caller), PoolError::TooEarly);
    // Missed whole periods are skipped; a late opener does not shift the cadence.
    e.warp(T0 + 15 * DAY);
    let next = e.open_next_pool(1, &caller).unwrap();
    assert_eq!(e.pool(next).opens_at, T0 + 14 * DAY);
    assert_eq!(e.series(1).unwrap().next_open_at, T0 + 21 * DAY);
}

#[test]
fn unopened_series_slot_does_not_create_an_already_closed_sale() {
    let mut e = Env::new();
    let mut s = daily_series(T0);
    s.sale_secs = 5 * DAY;
    s.period_secs = 7 * DAY;
    e.set_series(s).unwrap();
    let caller = funded(&mut e.svm, 20 * SOL);
    e.warp(T0 + 6 * DAY);
    assert_err!(e.open_next_pool(1, &caller), PoolError::TooLate);
    assert_eq!(e.config().pool_count, 0);
    e.warp(T0 + 7 * DAY);
    e.open_next_pool(1, &caller).unwrap();
    assert_eq!(e.pool(0).opens_at, T0 + 7 * DAY);
}

#[test]
fn invalid_open_start_close_order_is_refused_without_creating_accounts() {
    let mut e = Env::new();
    for (opens, last) in [(PREP, PLAY - 1), (0, PLAY - 1), (T0, PREP - 1), (T0, PLAY)] {
        let mut p = default_params();
        p.opens_at = opens;
        p.last_start_at = last;
        assert_err!(e.try_create_pool(p), PoolError::InvalidParams);
    }
    assert_eq!(e.config().pool_count, 0);
}
