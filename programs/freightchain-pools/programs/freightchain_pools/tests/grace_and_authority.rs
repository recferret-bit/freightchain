#[macro_use]
mod common;

use anchor_lang::solana_program::system_program;
use common::*;
use freightchain_pools::{
    accounts,
    error::PoolError,
    events::{AuthorityChanged, PayoutAuthoritySet, PoolClosed, PoolExpired},
    instruction, CreatePoolParams, SETTLE_GRACE_SECS,
};
use solana_keypair::Keypair;
use solana_signer::Signer;

const GRACE_END: i64 = PLAY + SETTLE_GRACE_SECS;

fn open_params() -> CreatePoolParams {
    CreatePoolParams { min_tickets: 2, max_tickets: 0, max_per_wallet: 100, ..default_params() }
}

/// Active pool with two buyers (2 + 3 tickets). Not sponsored: a refund test can close once the tickets are back.
fn active(e: &mut Env) -> (u32, Vec<Keypair>) {
    let id = e.create_pool(open_params());
    let a = funded(&mut e.svm, 20 * SOL);
    let b = funded(&mut e.svm, 20 * SOL);
    e.buy(id, &a, 2).unwrap();
    e.buy(id, &b, 3).unwrap();
    assert_eq!(e.pool(id).status, 1);
    (id, vec![a, b])
}

/// `active`, then enough sponsorship that the tickets count toward the prize share. Call before the sale ends.
fn covered(e: &mut Env) -> (u32, Vec<Keypair>) {
    let (id, buyers) = active(e);
    e.cover_player_share(id);
    (id, buyers)
}

// ---- 1. sponsorship follows the buy rules ------------------------------------------------------

#[test]
fn sponsor_rejected_from_prep_deadline_open_or_active() {
    let mut e = Env::new();
    let open = e.create_pool(default_params()); // min 3, stays Open
    let (act, _) = active(&mut e);
    let sp = funded(&mut e.svm, 10 * SOL);
    e.warp(PREP - 1);
    let i = e.sponsor_ix(open, &sp.pubkey(), 10);
    e.send(&[i], &sp, &[]).unwrap();
    e.warp(PREP);
    let i = e.sponsor_ix(open, &sp.pubkey(), 10);
    assert_err!(e.send(&[i], &sp, &[]), PoolError::TooLate);
    assert_eq!(e.pool(open).sponsored, 10);
    assert_eq!(e.receipt(open, &sp.pubkey()).unwrap().lamports, 10);
    // Active: the sale window closed at prep_deadline for it too
    let i = e.sponsor_ix(act, &sp.pubkey(), 10);
    assert_err!(e.send(&[i], &sp, &[]), PoolError::TooLate);
    e.warp(PLAY - 1);
    let i = e.sponsor_ix(act, &sp.pubkey(), 10);
    assert_err!(e.send(&[i], &sp, &[]), PoolError::TooLate);
    assert_eq!(e.pool(act).sponsored, 0);
    assert!(e.receipt(act, &sp.pubkey()).is_none());
}

// ---- 2. no admin needed after the grace -------------------------------------------------------------

#[test]
fn expire_before_and_after_grace_then_full_refunds_and_permissionless_close() {
    let mut e = Env::new();
    let (id, buyers) = active(&mut e);
    let stranger = funded(&mut e.svm, SOL);
    e.warp(PLAY);
    assert_err!(e.expire(id, &stranger), PoolError::TooEarly);
    e.warp(GRACE_END - 1);
    assert_err!(e.expire(id, &stranger), PoolError::TooEarly);
    e.warp(GRACE_END);
    let r = e.expire(id, &stranger).unwrap();
    let ev = events::<PoolExpired>(&r.logs);
    assert_eq!((ev[0].pool_id, ev[0].tickets_sold), (id, 5));
    assert_eq!(e.pool(id).status, 2);
    assert_err!(e.expire(id, &stranger), PoolError::PoolNotActive);
    // a Refunding pool can no longer get winners or pay a prize
    let auth = e.authority_kp();
    assert_err!(e.commit_winners(id, &auth, &[(stranger.pubkey(), 1_000_000)]), PoolError::PoolNotActive);
    assert_err!(e.pay_raw(id, 0, &stranger.pubkey(), 1_000_000, vec![]), PoolError::PoolNotActive);

    // every ticket back in full; the ticket rent to the rent payer (the buyers themselves here)
    for (b, q) in buyers.iter().zip([2u64, 3]) {
        let b0 = e.bal(&b.pubkey());
        let rent = e.bal(&ticket_pda(id, &b.pubkey()));
        e.refund(id, &b.pubkey(), &b.pubkey()).unwrap();
        assert_eq!(e.bal(&b.pubkey()), b0 + q * PRICE + rent);
    }
    assert_eq!(e.vault(id), e.rent_min());

    // anyone closes the refunded pool; the rent minimum goes to the creator, not the caller
    let (a0, s0) = (e.bal(&auth.pubkey()), e.bal(&stranger.pubkey()));
    let r = e.close_pool(id, &stranger).unwrap();
    assert!(events::<PoolClosed>(&r.logs)[0].cancelled);
    assert_eq!(e.vault(id), 0);
    assert_eq!(e.bal(&auth.pubkey()), a0 + e.rent_min());
    assert_eq!(e.bal(&stranger.pubkey()), s0);
    assert_eq!(e.pool(id).status, 4);
}

#[test]
fn expire_refused_when_prizes_were_paid_or_pool_not_active() {
    let mut e = Env::new();
    let (id, _) = covered(&mut e);
    let auth = e.authority_kp();
    let w = funded(&mut e.svm, SOL);
    e.warp(PLAY);
    e.commit_and_pay(id, &auth, &[(w.pubkey(), 1_000_000)]);
    e.warp(GRACE_END);
    let stranger = funded(&mut e.svm, SOL);
    assert_err!(e.expire(id, &stranger), PoolError::PrizesAlreadyPaid);
    // the exit for this pool is the permissionless close (split to the declared treasuries)
    e.close_pool(id, &stranger).unwrap();
    assert_eq!(e.vault(id), 0);

    let mut e = Env::new();
    let open = e.create_pool(default_params());
    e.warp(GRACE_END);
    let stranger = funded(&mut e.svm, SOL);
    assert_err!(e.expire(open, &stranger), PoolError::PoolNotActive);
}

#[test]
fn permissionless_close_only_after_grace_and_money_to_declared_treasuries() {
    let mut e = Env::new();
    let (id, _) = covered(&mut e);
    let (unpaid, _) = covered(&mut e);
    let stranger = funded(&mut e.svm, SOL);
    let auth = e.authority_kp();
    e.warp(PLAY);
    // the winners are committed and paid in time (a commit at the grace end is CommitTooLate) – part of the prize share
    let w = funded(&mut e.svm, SOL);
    e.commit_and_pay(id, &auth, &[(w.pubkey(), 100_000_000)]);
    assert_err!(e.close_pool(id, &stranger), PoolError::Unauthorized);
    e.warp(GRACE_END - 1);
    assert_err!(e.close_pool(id, &stranger), PoolError::Unauthorized);

    // the rent receiver must be the pool's creator
    e.warp(GRACE_END);
    let p = e.pool(id);
    let bad = ix(
        instruction::ClosePool { pool_id: id },
        accounts::ClosePool {
            caller: stranger.pubkey(),
            pool_authority: stranger.pubkey(),
            config: config_pda(),
            pool: pool_pda(id),
            vault: vault_pda(id),
            seed_treasury: p.seed_treasury,
            fee_treasury: p.fee_treasury,
            platform_treasury: e.plat_t.pubkey(),
            system_program: system_program::ID,
        },
    );
    assert_err!(e.send(&[bad], &stranger, &[]), PoolError::AccountMismatch);

    // no prize paid: a permissionless close would sweep the prize share to the seed treasury -> refused
    assert_err!(e.close_pool(unpaid, &stranger), PoolError::MustExpire);
    // and it is too late to commit winners now (rule f)
    assert_err!(e.commit_winners(unpaid, &auth, &[(w.pubkey(), 1)]), PoolError::CommitTooLate);

    // a prize was paid: the declared split may be closed by anyone
    let (s0, f0, a0, x0) =
        (e.bal(&e.seed_t.pubkey()), e.bal(&e.fee_t.pubkey()), e.bal(&auth.pubkey()), e.bal(&stranger.pubkey()));
    let vault_before = e.vault(id);
    e.close_pool(id, &stranger).unwrap();
    let (ds, df, da) = (e.bal(&e.seed_t.pubkey()) - s0, e.bal(&e.fee_t.pubkey()) - f0, e.bal(&auth.pubkey()) - a0);
    let pool = e.pool(id);
    let (prize, seed, fee) = freightchain_pools::split(pool.counted_pot().unwrap(), pool.prize_bps, pool.seed_bps).unwrap();
    assert_eq!(ds, seed + prize - 100_000_000, "seed share + unclaimed prize");
    assert_eq!(df, fee);
    assert_eq!(da, e.rent_min());
    assert_eq!(ds + df + da + (e.bal(&e.plat_t.pubkey()) - e.plat_t_start), vault_before, "outputs sum to the vault");
    assert_eq!(e.bal(&stranger.pubkey()), x0, "the caller gets nothing");
    assert_eq!((e.vault(id), e.pool(id).status), (0, 3));
}

#[test]
fn unpaid_pool_after_grace_must_expire_then_refunds_end_to_end() {
    let mut e = Env::new();
    let (id, buyers) = active(&mut e);
    let stranger = funded(&mut e.svm, SOL);
    e.warp(GRACE_END);
    let (seed0, v0) = (e.bal(&e.seed_t.pubkey()), e.vault(id));
    assert_err!(e.close_pool(id, &stranger), PoolError::MustExpire);
    assert_eq!((e.bal(&e.seed_t.pubkey()), e.vault(id)), (seed0, v0), "nothing moved");
    e.expire(id, &stranger).unwrap();
    for (b, q) in buyers.iter().zip([2u64, 3]) {
        let b0 = e.bal(&b.pubkey());
        let rent = e.bal(&ticket_pda(id, &b.pubkey()));
        e.refund(id, &b.pubkey(), &b.pubkey()).unwrap();
        assert_eq!(e.bal(&b.pubkey()), b0 + q * PRICE + rent, "full price back");
    }
    let auth = e.authority_kp();
    let a0 = e.bal(&auth.pubkey());
    e.close_pool(id, &stranger).unwrap();
    assert_eq!(e.bal(&e.seed_t.pubkey()), seed0, "the seed treasury got nothing");
    assert_eq!(e.bal(&auth.pubkey()), a0 + e.rent_min());
    assert_eq!((e.vault(id), e.pool(id).status), (0, 4));
}

#[test]
fn authority_closes_a_no_winner_pool_only_through_an_empty_root_before_the_grace() {
    // v4 (H5-B): before the grace the close needs a committed root – `count = 0` is "no winner" (the prize share goes to the seed treasury)
    let mut e = Env::new();
    let (id, _) = covered(&mut e);
    let auth = e.authority_kp();
    e.warp(PLAY);
    assert_err!(e.close_pool(id, &auth), PoolError::WinnersNotCommitted);
    e.commit_winners(id, &auth, &[]).unwrap();
    let (prize, seed, _) = freightchain_pools::split(e.pool(id).counted_pot().unwrap(), e.pool(id).prize_bps, e.pool(id).seed_bps).unwrap();
    let s0 = e.bal(&e.seed_t.pubkey());
    e.close_pool(id, &auth).unwrap();
    assert_eq!(e.bal(&e.seed_t.pubkey()) - s0, seed + prize);
    assert_eq!((e.vault(id), e.pool(id).status), (0, 3));

    // after the grace nothing was paid: not even the authority may sweep the prize share – the pool expires and refunds
    let mut e = Env::new();
    let (id, _) = active(&mut e);
    let auth = e.authority_kp();
    e.warp(PLAY);
    e.commit_winners(id, &auth, &[]).unwrap();
    e.warp(GRACE_END + 1);
    assert_err!(e.close_pool(id, &auth), PoolError::MustExpire);
    e.expire(id, &auth).unwrap();
    assert_eq!(e.pool(id).status, 2);
}

#[test]
fn permissionless_close_of_fully_refunded_pool() {
    let mut e = Env::new();
    let id = e.create_pool(default_params());
    let b = funded(&mut e.svm, 10 * SOL);
    e.buy(id, &b, 1).unwrap();
    e.warp(PREP);
    e.fail(id).unwrap();
    let stranger = funded(&mut e.svm, SOL);
    assert_err!(e.close_pool(id, &stranger), PoolError::RefundsPending);
    e.refund(id, &b.pubkey(), &b.pubkey()).unwrap();
    e.close_pool(id, &stranger).unwrap();
    assert_eq!((e.vault(id), e.pool(id).status), (0, 4));
}

// ---- 3. pause: only before the grace (audit H5 d) ---------------------------------------------------

/// audit s1-claude poc_01b (pause stops prize payments from a compromised payout key) and H5 d (after the grace no admin can freeze a pool).
#[test]
fn pause_stops_settlement_before_the_grace_and_never_after() {
    let mut e = Env::new();
    let auth = e.authority_kp();
    let payout = funded(&mut e.svm, 10 * SOL);
    e.set_payout_authority(&auth, Some(payout.pubkey())).unwrap();
    let (paid, _) = covered(&mut e); // winners paid before the pause
    let (stolen, _) = covered(&mut e); // a root the (stolen) payout key committed, unpaid
    let (unpaid, buyers) = active(&mut e); // nobody ever settled it – no cover sponsor to refund
    let (late, _) = covered(&mut e); // committed, paid only after the grace
    let thief = funded(&mut e.svm, SOL);
    let w = funded(&mut e.svm, SOL);
    let stranger = funded(&mut e.svm, SOL);
    let sp = funded(&mut e.svm, 10 * SOL);
    let i = e.sponsor_ix(unpaid, &sp.pubkey(), 1_000_000);
    e.send(&[i], &sp, &[]).unwrap();

    e.warp(PLAY);
    e.commit_and_pay(paid, &payout, &[(w.pubkey(), 1_000_000)]);
    let share = e.pool(stolen).prize_share().unwrap();
    e.commit_winners(stolen, &payout, &[(thief.pubkey(), share)]).unwrap();
    e.commit_winners(late, &payout, &[(w.pubkey(), 2_000_000)]).unwrap();
    e.set_config(&auth, Some(true), None, None).unwrap();

    // before the grace the pause holds: no prize (poc_01b), no commit, no close by the admin / payout key
    assert_err!(e.pay_rank(stolen, 0), PoolError::Paused);
    assert_err!(e.pay_rank(late, 0), PoolError::Paused);
    assert_err!(e.commit_winners(unpaid, &payout, &[(w.pubkey(), 1)]), PoolError::Paused);
    assert_err!(e.close_pool(paid, &auth), PoolError::Paused);
    assert_err!(e.close_pool(paid, &payout), PoolError::Paused);
    // expire_pool has no pause gate: before the grace it is simply too early
    assert_err!(e.expire(unpaid, &stranger), PoolError::TooEarly);
    // the admin strikes the stolen root while paused
    e.veto_winners(stolen, &auth).unwrap();
    assert!(!e.pool(stolen).has_winners());
    assert_eq!(e.bal(&thief.pubkey()), SOL, "the thief got nothing");

    // after the grace the pause no longer binds: still paused, everything settles without an admin
    e.warp(GRACE_END);
    assert!(e.config().paused);
    let w0 = e.bal(&w.pubkey());
    e.pay_rank(late, 0).unwrap();
    assert_eq!(e.bal(&w.pubkey()), w0 + 2_000_000);
    e.close_pool(paid, &stranger).unwrap();
    e.close_pool(late, &stranger).unwrap();
    assert_eq!((e.pool(paid).status, e.pool(late).status), (3, 3));
    e.expire(unpaid, &stranger).unwrap();
    e.expire(stolen, &stranger).unwrap();
    for b in &buyers {
        e.refund(unpaid, &b.pubkey(), &b.pubkey()).unwrap();
    }
    let s0 = e.bal(&sp.pubkey());
    e.refund_sponsor(unpaid, &sp.pubkey()).unwrap();
    assert!(e.bal(&sp.pubkey()) >= s0 + 1_000_000);
    e.close_pool(unpaid, &stranger).unwrap();
    assert_eq!((e.vault(unpaid), e.pool(unpaid).status), (0, 4));
}

// ---- 4. authority handover ------------------------------------------------------------------------

#[test]
fn propose_and_accept_authority() {
    let mut e = Env::new();
    let old = e.authority_kp();
    let new = funded(&mut e.svm, 10 * SOL);
    let wrong = funded(&mut e.svm, SOL);
    assert_err!(e.accept_authority(&new), PoolError::NoPendingAuthority);
    assert_err!(e.propose_authority(&wrong, new.pubkey()), PoolError::Unauthorized);
    e.propose_authority(&old, new.pubkey()).unwrap();
    assert_eq!(e.config().pending_authority, Some(new.pubkey()));
    assert_eq!(e.config().authority, old.pubkey(), "nothing changes until accepted");
    assert_err!(e.accept_authority(&wrong), PoolError::Unauthorized);
    let r = e.accept_authority(&new).unwrap();
    let ev = events::<AuthorityChanged>(&r.logs);
    assert_eq!((ev[0].old_authority, ev[0].new_authority), (old.pubkey(), new.pubkey()));
    assert!(events::<PayoutAuthoritySet>(&r.logs).is_empty(), "no payout key was set: nothing to clear");
    let c = e.config();
    assert_eq!((c.authority, c.pending_authority), (new.pubkey(), None));
    assert_err!(e.accept_authority(&new), PoolError::NoPendingAuthority);
    // config rights moved too
    assert_err!(e.set_config(&old, Some(true), None, None), PoolError::Unauthorized);
    e.set_config(&new, Some(false), None, None).unwrap();
    assert_err!(e.propose_authority(&old, old.pubkey()), PoolError::Unauthorized);
}

/// audit L8: a payout key the OLD admin named must not keep committing winners under the new one; the new admin names its own.
#[test]
fn accept_authority_clears_the_payout_key_and_the_new_admin_names_its_own() {
    let mut e = Env::new();
    let old = e.authority_kp();
    let old_payout = funded(&mut e.svm, 10 * SOL);
    e.set_payout_authority(&old, Some(old_payout.pubkey())).unwrap();
    let (id, _) = covered(&mut e);
    let new = funded(&mut e.svm, 10 * SOL);
    e.propose_authority(&old, new.pubkey()).unwrap();
    assert_eq!(e.config().payout_authority, Some(old_payout.pubkey()), "kept until the handover completes");
    let r = e.accept_authority(&new).unwrap();
    let ev = events::<PayoutAuthoritySet>(&r.logs);
    assert_eq!(ev.len(), 1);
    assert_eq!((ev[0].authority, ev[0].payout_authority), (new.pubkey(), None));
    assert_eq!(e.config().payout_authority, None);

    e.warp(PLAY);
    let w = funded(&mut e.svm, SOL);
    assert_err!(e.commit_winners(id, &old_payout, &[(w.pubkey(), 1_000_000)]), PoolError::Unauthorized);
    assert_err!(e.commit_winners(id, &old, &[(w.pubkey(), 1_000_000)]), PoolError::Unauthorized);
    // only the new admin names a payout key
    let new_payout = funded(&mut e.svm, 10 * SOL);
    assert_err!(e.set_payout_authority(&old, Some(old_payout.pubkey())), PoolError::Unauthorized);
    let r = e.set_payout_authority(&new, Some(new_payout.pubkey())).unwrap();
    assert_eq!(events::<PayoutAuthoritySet>(&r.logs)[0].payout_authority, Some(new_payout.pubkey()));
    e.commit_and_pay(id, &new_payout, &[(w.pubkey(), 1_000_000)]);
    e.close_pool(id, &new_payout).unwrap();
    assert_eq!(e.pool(id).status, 3);
}

#[test]
fn rotated_authority_takes_over_existing_pools() {
    let mut e = Env::new();
    let old = e.authority_kp();
    let cancel_me = e.create_pool(default_params());
    let (id, _) = covered(&mut e);
    let new = funded(&mut e.svm, 10 * SOL);
    e.propose_authority(&old, new.pubkey()).unwrap();
    e.accept_authority(&new).unwrap();

    assert_err!(e.cancel(cancel_me, &old), PoolError::Unauthorized);
    e.cancel(cancel_me, &new).unwrap();

    let w = funded(&mut e.svm, SOL);
    e.warp(PLAY);
    assert_err!(e.commit_winners(id, &old, &[(w.pubkey(), 1_000_000)]), PoolError::Unauthorized);
    e.commit_and_pay(id, &new, &[(w.pubkey(), 1_000_000)]);
    assert_err!(e.close_pool(id, &old), PoolError::Unauthorized);
    // pool.authority stays the creator record: the old key still gets the vault rent minimum back
    let (o0, n0) = (e.bal(&old.pubkey()), e.bal(&new.pubkey()));
    e.close_pool(id, &new).unwrap();
    assert_eq!(e.bal(&old.pubkey()), o0 + e.rent_min());
    assert_eq!(e.bal(&new.pubkey()), n0);
    assert_eq!(e.pool(id).authority, old.pubkey());

    // new pools are created by the new key
    e.authority = clone_kp(&new);
    e.warp(T0);
    let id2 = e.create_pool(default_params());
    assert_eq!(e.pool(id2).authority, new.pubkey());
}
