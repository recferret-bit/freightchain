#[macro_use]
mod common;

use common::*;
use freightchain_pools::{
    error::PoolError,
    events::{PoolActivated, PoolCreated, RoadSealed, SealRearmed, TicketBought},
    CreatePoolParams, MAX_POOL_SECS, SEAL_DELAY_SLOTS,
};
use solana_keypair::Keypair;
use solana_signer::Signer;

fn p(f: impl FnOnce(&mut CreatePoolParams)) -> CreatePoolParams {
    let mut x = default_params();
    f(&mut x);
    x
}

#[test]
fn create_pool_ok_funds_vault_and_emits() {
    let mut e = Env::new();
    let r = e.try_create_pool(default_params()).unwrap();
    let ev = events::<PoolCreated>(&r.logs);
    assert_eq!(ev.len(), 1);
    assert_eq!(ev[0].pool_id, 0);
    assert_eq!(ev[0].price_lamports, PRICE);
    assert_eq!(ev[0].fee_treasury, e.fee_t.pubkey());
    assert_eq!(e.config().pool_count, 1);
    let pool = e.pool(0);
    assert_eq!((pool.status, pool.tickets_sold, pool.min_tickets), (0, 0, 3));
    assert_eq!(pool.authority, e.authority.pubkey());
    // vault pre-funded with exactly the rent-exempt minimum
    assert_eq!(e.vault(0), e.rent_min());
    // a second pool gets id 1
    assert_eq!(e.create_pool(default_params()), 1);
}

#[test]
fn create_pool_validation() {
    let mut e = Env::new();
    assert_err!(e.try_create_pool(p(|x| x.prize_bps = 6001)), PoolError::BpsSum);
    assert_err!(e.try_create_pool(p(|x| x.fee_bps = 1499)), PoolError::BpsSum);
    assert_err!(e.try_create_pool(p(|x| x.prep_deadline = T0)), PoolError::InvalidParams);
    assert_err!(e.try_create_pool(p(|x| x.play_deadline = PREP - 1)), PoolError::InvalidParams);
    // the review window cannot end before the rides do
    assert_err!(e.try_create_pool(p(|x| x.payout_at = PLAY - 1)), PoolError::InvalidParams);
    assert_err!(e.try_create_pool(p(|x| x.min_tickets = 0)), PoolError::InvalidParams);
    assert_err!(e.try_create_pool(p(|x| x.price_lamports = 0)), PoolError::InvalidParams);
    assert_err!(e.try_create_pool(p(|x| x.price_lamports = 1_000)), PoolError::PriceBelowRentMin);
    assert_err!(e.try_create_pool(p(|x| x.max_tickets = 2)), PoolError::InvalidParams);
    assert_err!(e.try_create_pool(p(|x| x.max_per_wallet = 0)), PoolError::InvalidParams);
    // a payout time beyond MAX_POOL_SECS would lock an Active pool's tickets that long
    assert_err!(e.try_create_pool(p(|x| x.payout_at = T0 + MAX_POOL_SECS + 1)), PoolError::InvalidParams);
    // nothing was created
    assert_eq!(e.config().pool_count, 0);
    // play_deadline == prep_deadline == payout_at is allowed, unlimited tickets (0) is allowed
    e.create_pool(p(|x| {
        x.play_deadline = PREP;
        x.payout_at = PREP;
        x.max_tickets = 0;
    }));
    // exactly MAX_POOL_SECS out is allowed
    e.create_pool(p(|x| x.payout_at = T0 + MAX_POOL_SECS));
}

#[test]
fn create_pool_authority_only() {
    let mut e = Env::new();
    let stranger = funded(&mut e.svm, 10 * SOL);
    let i = e.create_pool_ix(default_params(), e.fee_t.pubkey(), e.seed_t.pubkey());
    // swap the authority account for the stranger (who signs)
    let mut i = i;
    i.accounts[0].pubkey = stranger.pubkey();
    let c = clone_kp(&e.cranker);
    assert_err!(e.send(&[i], &c, &[&stranger]), PoolError::Unauthorized);
}

#[test]
fn create_pool_refuses_unfunded_treasury() {
    let mut e = Env::new();
    let nobody = Keypair::new(); // never airdropped: 0 lamports
    let c = clone_kp(&e.cranker);
    let a = e.authority_kp();
    let i = e.create_pool_ix(default_params(), nobody.pubkey(), e.seed_t.pubkey());
    assert_err!(e.send(&[i], &c, &[&a]), PoolError::TreasuryNotRentExempt);
    let i = e.create_pool_ix(default_params(), e.fee_t.pubkey(), nobody.pubkey());
    assert_err!(e.send(&[i], &c, &[&a]), PoolError::TreasuryNotRentExempt);
    // below the minimum but not empty is refused as well
    e.svm.airdrop(&nobody.pubkey(), 1_000).unwrap();
    let i = e.create_pool_ix(default_params(), nobody.pubkey(), e.seed_t.pubkey());
    assert_err!(e.send(&[i], &c, &[&a]), PoolError::TreasuryNotRentExempt);
    // top it up to the minimum: accepted
    e.svm.airdrop(&nobody.pubkey(), e.rent_min()).unwrap();
    let i = e.create_pool_ix(default_params(), nobody.pubkey(), e.seed_t.pubkey());
    e.send(&[i], &c, &[&a]).unwrap();
}

#[test]
fn buy_to_exactly_min_activates() {
    let mut e = Env::new();
    let id = e.create_pool(default_params()); // min 3
    let a = funded(&mut e.svm, 10 * SOL);
    let b = funded(&mut e.svm, 10 * SOL);
    let vault0 = e.vault(id);

    let r = e.buy(id, &a, 2).unwrap();
    let bought = events::<TicketBought>(&r.logs);
    assert_eq!(bought.len(), 1);
    let t = &bought[0];
    assert_eq!((t.pool_id, t.buyer, t.qty, t.lamports), (id, a.pubkey(), 2, 2 * PRICE));
    assert_eq!((t.order_id, t.tickets_sold, t.activated), ([7u8; 16], 2, false));
    assert!(events::<PoolActivated>(&r.logs).is_empty());
    assert_eq!(e.pool(id).status, 0, "still Open at min-1");

    let r = e.buy(id, &b, 1).unwrap();
    let act = events::<PoolActivated>(&r.logs);
    assert_eq!(act.len(), 1);
    assert_eq!((act[0].pool_id, act[0].tickets_sold, act[0].at), (id, 3, T0));
    assert!(events::<TicketBought>(&r.logs)[0].activated);
    let pool = e.pool(id);
    assert_eq!((pool.status, pool.tickets_sold, pool.buyers), (1, 3, 2));
    assert_eq!(e.vault(id), vault0 + 3 * PRICE);

    // buying more after activation does not emit PoolActivated again
    let r = e.buy(id, &b, 1).unwrap();
    assert!(events::<PoolActivated>(&r.logs).is_empty());
    assert_eq!(e.ticket(id, &b.pubkey()).unwrap().qty, 2);
}

#[test]
fn sponsored_buy_credits_buyer_and_records_rent_payer() {
    let mut e = Env::new();
    let id = e.create_pool(default_params());
    let buyer = funded(&mut e.svm, 5 * SOL);
    let sponsor = funded(&mut e.svm, SOL);
    let (b0, s0) = (e.bal(&buyer.pubkey()), e.bal(&sponsor.pubkey()));
    e.buy_sponsored(id, &buyer, &sponsor, 1).unwrap();
    let t = e.ticket(id, &buyer.pubkey()).unwrap();
    assert_eq!(t.buyer, buyer.pubkey());
    assert_eq!(t.rent_payer, sponsor.pubkey());
    let rent = e.bal(&common::ticket_pda(id, &buyer.pubkey()));
    // the buyer paid the price and nothing else; the sponsor paid the ticket rent (+ fee)
    assert_eq!(b0 - e.bal(&buyer.pubkey()), PRICE);
    assert!(s0 - e.bal(&sponsor.pubkey()) >= rent);
    // a second buy by the same buyer keeps the original rent payer
    let other = funded(&mut e.svm, SOL);
    e.buy_sponsored(id, &buyer, &other, 1).unwrap();
    assert_eq!(e.ticket(id, &buyer.pubkey()).unwrap().rent_payer, sponsor.pubkey());
    assert_eq!(e.ticket(id, &buyer.pubkey()).unwrap().qty, 2);
}

#[test]
fn wallet_cap() {
    let mut e = Env::new();
    let id = e.create_pool(default_params()); // cap 4
    let a = funded(&mut e.svm, 10 * SOL);
    e.buy(id, &a, 3).unwrap();
    assert_err!(e.buy(id, &a, 2), PoolError::WalletCap);
    e.buy(id, &a, 1).unwrap();
    assert_err!(e.buy(id, &a, 1), PoolError::WalletCap);
    assert_eq!(e.ticket(id, &a.pubkey()).unwrap().qty, 4);
    // a single oversized order on a fresh wallet fails too
    let b = funded(&mut e.svm, 10 * SOL);
    assert_err!(e.buy(id, &b, 5), PoolError::WalletCap);
    assert!(e.ticket(id, &b.pubkey()).is_none());
}

#[test]
fn sold_out() {
    let mut e = Env::new();
    let id = e.create_pool(p(|x| {
        x.max_tickets = 5;
        x.max_per_wallet = 10;
    }));
    let a = funded(&mut e.svm, 10 * SOL);
    let b = funded(&mut e.svm, 10 * SOL);
    e.buy(id, &a, 3).unwrap();
    assert_err!(e.buy(id, &b, 3), PoolError::SoldOut);
    e.buy(id, &b, 2).unwrap();
    assert_eq!(e.pool(id).tickets_sold, 5);
    let c = funded(&mut e.svm, 10 * SOL);
    assert_err!(e.buy(id, &c, 1), PoolError::SoldOut);
}

#[test]
fn buy_deadlines() {
    let mut e = Env::new();
    let id = e.create_pool(default_params()); // min 3
    let a = funded(&mut e.svm, 10 * SOL);
    let b = funded(&mut e.svm, 10 * SOL);
    e.buy(id, &a, 1).unwrap();
    // an Open pool is closed to buyers from its prep deadline on (it can only fail now)
    e.warp(PREP);
    assert_err!(e.buy(id, &b, 1), PoolError::TooLate);

    // the sale window closes for an Active pool too: it sells until prep_deadline, never during the rest of the play window
    let id2 = e.create_pool(p(|x| {
        x.prep_deadline = PREP + 100_000;
        x.play_deadline = PLAY + 100_000;
        x.payout_at = PLAY + 100_000;
    }));
    e.buy(id2, &a, 3).unwrap();
    assert_eq!(e.pool(id2).status, 1);
    e.warp(PREP + 99_999);
    e.buy(id2, &b, 1).unwrap();
    e.warp(PREP + 100_000);
    assert_err!(e.buy(id2, &b, 1), PoolError::TooLate);
    assert_eq!(e.pool(id2).tickets_sold, 4);
}

#[test]
fn buy_wrong_state_and_zero_qty() {
    let mut e = Env::new();
    let id = e.create_pool(default_params());
    let a = funded(&mut e.svm, 10 * SOL);
    assert_err!(e.buy(id, &a, 0), PoolError::InvalidParams);
    let auth = e.authority_kp();
    e.cancel(id, &auth).unwrap();
    assert_err!(e.buy(id, &a, 1), PoolError::PoolNotOpen);
}

#[test]
fn a_new_pool_has_no_road_yet_only_a_target_slot_a_few_slots_ahead() {
    let mut e = Env::new();
    e.set_slot(500);
    let id = e.next_pool;
    let i = e.create_pool_ix(default_params(), e.fee_t.pubkey(), e.seed_t.pubkey());
    let (a, c) = (e.authority_kp(), clone_kp(&e.cranker));
    let r = e.send(&[i], &c, &[&a]).unwrap();
    e.next_pool += 1;
    let pool = e.pool(id);
    // pentest L4: the opener could pick the moment it opens – so the road is not taken from that moment's slot hash
    assert_eq!((pool.seed_commitment, pool.seed_slot, pool.seal_slot), ([0u8; 32], 0, 500 + SEAL_DELAY_SLOTS));
    let ev = events::<PoolCreated>(&r.logs);
    assert_eq!((ev[0].seed_commitment, ev[0].seed_slot), ([0u8; 32], 500 + SEAL_DELAY_SLOTS), "the event names the target slot");
}

#[test]
fn seal_road_takes_the_first_slot_at_or_after_the_target_whenever_it_is_called() {
    let mut e = Env::new();
    e.set_slot(500);
    let id = e.create_pool(default_params());
    let target = e.pool(id).seal_slot;
    assert_err!(e.seal_road(id), PoolError::TooEarly);   // the target slot is not even past
    // the target slot itself was skipped (no block): the first one after it counts; the caller's moment does not
    let (h1, h2, h3) = ([11u8; 32], [22u8; 32], [33u8; 32]);
    e.set_slot(target + 40);
    e.set_slot_hashes(&[(target + 39, h3), (target + 2, h2), (target + 1, h1), (target - 1, [1; 32])]);
    let r = e.seal_road(id).unwrap();
    let pool = e.pool(id);
    let want = solana_sha256_hasher::hashv(&[&id.to_le_bytes(), &h1, &(target + 1).to_le_bytes()]).to_bytes();
    assert_eq!((pool.seed_slot, pool.seed_slot_hash, pool.seed_commitment, pool.seal_slot), (target + 1, h1, want, 0));
    let ev = events::<RoadSealed>(&r.logs);
    assert_eq!((ev[0].pool_id, ev[0].seed_commitment), (id, want));
    assert_err!(e.seal_road(id), PoolError::RoadAlreadySealed);
}

#[test]
fn a_target_that_left_the_slot_hashes_window_is_re_armed_never_guessed() {
    let mut e = Env::new();
    e.set_slot(500);
    let id = e.create_pool(default_params());
    let target = e.pool(id).seal_slot;
    // nobody sealed for a while: the oldest entry kept is already past the target – which hash was first after it is unknown
    e.set_slot(target + 900);
    e.set_slot_hashes(&[(target + 899, [5; 32]), (target + 400, [6; 32])]);
    let r = e.seal_road(id).unwrap();
    assert_eq!(e.pool(id).seal_slot, target + 900 + SEAL_DELAY_SLOTS);
    assert_eq!(e.pool(id).seed_commitment, [0u8; 32]);
    assert_eq!(events::<SealRearmed>(&r.logs)[0].seal_slot, target + 900 + SEAL_DELAY_SLOTS);
}

#[test]
fn a_forged_slot_hashes_account_is_refused() {
    let mut e = Env::new();
    e.set_slot(500);
    let id = e.create_pool(default_params());
    let fake = funded(&mut e.svm, SOL);
    e.set_slot(600);
    let c = clone_kp(&e.cranker);
    let mut i = e.seal_road_ix(id, &c.pubkey());
    i.accounts[2].pubkey = fake.pubkey(); // a caller that would like to pick the road
    assert_err!(e.send(&[i], &c, &[]), PoolError::AccountMismatch);
}

#[test]
fn the_platform_cut_is_snapshotted_when_the_pool_opens() {
    let mut e = Env::with_platform_fee(500);
    let id = e.create_pool(default_params());
    let auth = e.authority_kp();
    e.set_config(&auth, None, None, Some(2_000)).unwrap();
    assert_eq!(e.pool(id).platform_fee_bps, 500, "pentest L8: the buyers saw 5 %; a later change does not reach this pool");
}

/// red-team v4 S3: the target slot (and the ones after it) were skipped – nothing at or after it is in SlotHashes YET: wait, never re-arm (re-arming here would
/// let a caller re-roll the road by timing).
#[test]
fn a_skipped_target_still_inside_the_window_waits_instead_of_re_arming() {
    let mut e = Env::new();
    e.set_slot(500);
    let id = e.create_pool(default_params());
    let target = e.pool(id).seal_slot;
    e.set_slot(target + 5);
    e.set_slot_hashes(&[(target - 1, [3; 32]), (target - 2, [4; 32])]);
    assert_err!(e.seal_road(id), PoolError::TooEarly);
    assert_eq!(e.pool(id).seal_slot, target, "not re-armed");
}
