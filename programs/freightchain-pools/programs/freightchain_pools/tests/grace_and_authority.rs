#[macro_use]
mod common;

use anchor_lang::solana_program::system_program;
use common::*;
use freightchain_pools::{
    accounts,
    error::PoolError,
    events::{AuthorityChanged, PoolClosed, PoolExpired},
    instruction, CreatePoolParams, SETTLE_GRACE_SECS,
};
use solana_keypair::Keypair;
use solana_signer::Signer;

const GRACE_END: i64 = PLAY + SETTLE_GRACE_SECS;

fn open_params() -> CreatePoolParams {
    CreatePoolParams { min_tickets: 2, max_tickets: 0, max_per_wallet: 100, ..default_params() }
}

/// Active pool with two buyers (2 + 3 tickets).
fn active(e: &mut Env) -> (u32, Vec<Keypair>) {
    let id = e.create_pool(open_params());
    let a = funded(&mut e.svm, 20 * SOL);
    let b = funded(&mut e.svm, 20 * SOL);
    e.buy(id, &a, 2).unwrap();
    e.buy(id, &b, 3).unwrap();
    assert_eq!(e.pool(id).status, 1);
    (id, vec![a, b])
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
    // Active: the sale window closed at prep_deadline for it too
    let i = e.sponsor_ix(act, &sp.pubkey(), 10);
    assert_err!(e.send(&[i], &sp, &[]), PoolError::TooLate);
    e.warp(PLAY - 1);
    let i = e.sponsor_ix(act, &sp.pubkey(), 10);
    assert_err!(e.send(&[i], &sp, &[]), PoolError::TooLate);
    assert_eq!(e.pool(act).sponsored, 0);
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
    // an Active pool can no longer be paid out or closed with the split
    let auth = e.authority_kp();
    assert_err!(e.pay_prize(id, &auth, &stranger.pubkey(), 1_000_000, 1), PoolError::PoolNotActive);

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
    let (id, _) = active(&mut e);
    let auth = e.authority_kp();
    let w = funded(&mut e.svm, SOL);
    e.warp(PLAY);
    e.pay_prize(id, &auth, &w.pubkey(), 1_000_000, 1).unwrap();
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
    let (id, _) = active(&mut e); // pot 0.5 SOL: prize 0.3, seed 0.125, fee 0.075
    let stranger = funded(&mut e.svm, SOL);
    let auth = e.authority_kp();
    e.warp(PLAY);
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
    assert_err!(e.close_pool(id, &stranger), PoolError::MustExpire);

    // the authority pays part of the prize share; now the declared split may be closed by anyone
    let w = funded(&mut e.svm, SOL);
    e.pay_prize(id, &auth, &w.pubkey(), 100_000_000, 1).unwrap();
    let (s0, f0, a0, x0) =
        (e.bal(&e.seed_t.pubkey()), e.bal(&e.fee_t.pubkey()), e.bal(&auth.pubkey()), e.bal(&stranger.pubkey()));
    let vault_before = e.vault(id);
    e.close_pool(id, &stranger).unwrap();
    let (ds, df, da) = (e.bal(&e.seed_t.pubkey()) - s0, e.bal(&e.fee_t.pubkey()) - f0, e.bal(&auth.pubkey()) - a0);
    assert_eq!(ds, 125_000_000 + 200_000_000, "seed share + unclaimed prize");
    assert_eq!(df, 75_000_000);
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
fn authority_can_close_unpaid_pool_any_time_after_play_deadline() {
    for at in [PLAY, GRACE_END + 1] {
        let mut e = Env::new();
        let (id, _) = active(&mut e);
        let auth = e.authority_kp();
        e.warp(at);
        let s0 = e.bal(&e.seed_t.pubkey());
        e.close_pool(id, &auth).unwrap();
        assert_eq!(e.bal(&e.seed_t.pubkey()) - s0, 125_000_000 + 300_000_000);
        assert_eq!((e.vault(id), e.pool(id).status), (0, 3));
    }
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

// ---- 3. authority handover ------------------------------------------------------------------------

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
    let c = e.config();
    assert_eq!((c.authority, c.pending_authority), (new.pubkey(), None));
    assert_err!(e.accept_authority(&new), PoolError::NoPendingAuthority);
    // config rights moved too
    assert_err!(e.set_config(&old, Some(true), None, None), PoolError::Unauthorized);
    e.set_config(&new, Some(false), None, None).unwrap();
    assert_err!(e.propose_authority(&old, old.pubkey()), PoolError::Unauthorized);
}

#[test]
fn rotated_authority_takes_over_existing_pools() {
    let mut e = Env::new();
    let old = e.authority_kp();
    let cancel_me = e.create_pool(default_params());
    let (id, _) = active(&mut e);
    let new = funded(&mut e.svm, 10 * SOL);
    e.propose_authority(&old, new.pubkey()).unwrap();
    e.accept_authority(&new).unwrap();

    assert_err!(e.cancel(cancel_me, &old), PoolError::Unauthorized);
    e.cancel(cancel_me, &new).unwrap();

    let w = funded(&mut e.svm, SOL);
    e.warp(PLAY);
    assert_err!(e.pay_prize(id, &old, &w.pubkey(), 1_000_000, 1), PoolError::Unauthorized);
    e.pay_prize(id, &new, &w.pubkey(), 1_000_000, 1).unwrap();
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
