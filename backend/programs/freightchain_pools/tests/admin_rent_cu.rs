#[macro_use]
mod common;

use anchor_lang::{prelude::Pubkey, AnchorSerialize, Discriminator, Event, Space};
use common::*;
use freightchain_pools::{
    constants::{DEFAULT_MIN_FINISH_SECS, DEFAULT_MIN_REVIEW_SECS, MAX_POOL_SECS},
    error::PoolError,
    events::*,
    Config,
};
use solana_keypair::Keypair;
use solana_signer::Signer;

#[test]
fn initialize_only_by_the_upgrade_authority() {
    let mut e = Env::uninitialized(0);
    let stranger = funded(&mut e.svm, 10 * SOL);
    let admin = Keypair::new().pubkey();
    // anyone else: refused (the first-come front-run after a deploy)
    let s = clone_kp(&stranger);
    assert_err!(e.initialize(&s, stranger.pubkey()), PoolError::Unauthorized);
    // the upgrade authority must name a real admin
    let up = clone_kp(&e.authority);
    assert_err!(e.initialize(&up, Default::default()), PoolError::InvalidParams);
    // the upgrade authority names another wallet (e.g. Phantom) as the admin in one transaction
    e.initialize(&up, admin).unwrap();
    let c = e.config();
    assert_eq!((c.authority, c.payout_authority, c.pending_authority), (admin, None, None));
    assert_eq!((c.min_review_secs, c.min_finish_secs), (DEFAULT_MIN_REVIEW_SECS, DEFAULT_MIN_FINISH_SECS), "v4 floors at their defaults");
    // a second initialize cannot replace it (the Config PDA exists)
    assert!(e.initialize(&up, up.pubkey()).is_err());
    assert_eq!(e.config().authority, admin);
}

#[test]
fn initialize_refuses_a_program_without_upgrade_authority() {
    let mut e = Env::uninitialized(0);
    // an immutable program (no upgrade authority) cannot be initialized by anyone
    let addr = programdata_pda();
    let mut acc = e.svm.get_account(&addr).unwrap();
    acc.data[12..45].fill(0);
    e.svm.set_account(addr, acc).unwrap();
    let up = clone_kp(&e.authority);
    assert_err!(e.initialize(&up, up.pubkey()), PoolError::Unauthorized);
}

#[test]
fn pause_blocks_buys_and_pool_creation_not_refunds() {
    let mut e = Env::new();
    let id = e.create_pool(default_params());
    let a = funded(&mut e.svm, 10 * SOL);
    let b = funded(&mut e.svm, 10 * SOL);
    e.buy(id, &a, 1).unwrap();
    let stranger = funded(&mut e.svm, SOL);
    assert_err!(e.set_config(&stranger, Some(true), None, None), PoolError::Unauthorized);
    let auth = e.authority_kp();
    e.set_config(&auth, Some(true), None, None).unwrap();
    assert!(e.config().paused);
    assert_err!(e.buy(id, &b, 1), PoolError::Paused);
    assert_err!(e.try_create_pool(default_params()), PoolError::Paused);
    let sp = funded(&mut e.svm, SOL);
    let i = e.sponsor_ix(id, &sp.pubkey(), 10);
    assert_err!(e.send(&[i], &sp, &[]), PoolError::Paused);
    // refunds (tickets and sponsorship) and the refunded pool's close are never blocked by the pause
    e.set_config(&auth, Some(false), None, None).unwrap();
    let i = e.sponsor_ix(id, &sp.pubkey(), 1_000_000);
    e.send(&[i], &sp, &[]).unwrap();
    e.set_config(&auth, Some(true), None, None).unwrap();
    e.warp(PREP);
    e.fail(id).unwrap();
    e.refund(id, &a.pubkey(), &a.pubkey()).unwrap();
    e.refund_sponsor(id, &sp.pubkey()).unwrap();
    e.close_pool(id, &stranger).unwrap();
    assert_eq!(e.pool(id).status, 4);
    // unpause
    e.set_config(&auth, Some(false), None, None).unwrap();
    let id2 = e.create_pool(common::later(&e, default_params()));
    e.buy(id2, &b, 1).unwrap();
}

#[test]
fn set_config_treasury_and_fee_validation() {
    let mut e = Env::new();
    let auth = e.authority_kp();
    assert_err!(e.set_config(&auth, None, None, Some(10_001)), PoolError::InvalidParams);
    e.set_config(&auth, None, None, Some(2500)).unwrap();
    assert_eq!(e.config().platform_fee_bps, 2500);
    let unfunded = Keypair::new();
    assert_err!(e.set_config(&auth, None, Some(unfunded.pubkey()), None), PoolError::TreasuryNotRentExempt);
    let ok = funded(&mut e.svm, SOL);
    e.set_config(&auth, None, Some(ok.pubkey()), None).unwrap();
    assert_eq!(e.config().platform_treasury, ok.pubkey());
}

#[test]
fn set_config_floors_in_range_and_only_by_the_authority() {
    let mut e = Env::with_floors();
    let auth = e.authority_kp();
    // the production floors refuse the short test pool: 4 000 s play window < min_finish_secs, no review < min_review_secs
    assert_err!(e.try_create_pool(default_params()), PoolError::WindowTooShort);
    let stranger = funded(&mut e.svm, SOL);
    assert_err!(e.set_floors(&stranger, Some(0), Some(0)), PoolError::Unauthorized);
    for bad in [-1, MAX_POOL_SECS + 1, i64::MIN, i64::MAX] {
        assert_err!(e.set_floors(&auth, Some(bad), None), PoolError::InvalidParams);
        assert_err!(e.set_floors(&auth, None, Some(bad)), PoolError::InvalidParams);
        // one bad floor refuses the whole call
        assert_err!(e.set_floors(&auth, Some(60), Some(bad)), PoolError::InvalidParams);
    }
    let c = e.config();
    assert_eq!((c.min_review_secs, c.min_finish_secs), (DEFAULT_MIN_REVIEW_SECS, DEFAULT_MIN_FINISH_SECS), "nothing changed");

    // one floor at a time; the event carries both
    let r = e.set_floors(&auth, Some(MAX_POOL_SECS), None).unwrap();
    let ev = events::<FloorsSet>(&r.logs);
    assert_eq!((ev[0].min_review_secs, ev[0].min_finish_secs), (MAX_POOL_SECS, DEFAULT_MIN_FINISH_SECS));
    let r = e.set_floors(&auth, None, Some(4_000)).unwrap();
    assert_eq!(events::<FloorsSet>(&r.logs)[0].min_finish_secs, 4_000);
    let r = e.set_floors(&auth, Some(0), None).unwrap();
    assert_eq!(events::<FloorsSet>(&r.logs)[0].min_review_secs, 0);
    let c = e.config();
    assert_eq!((c.min_review_secs, c.min_finish_secs), (0, 4_000));
    // no floor in the call: no FloorsSet
    let r = e.set_config(&auth, Some(false), None, None).unwrap();
    assert!(events::<FloorsSet>(&r.logs).is_empty());
    // the floors bind new pools at the boundary
    e.try_create_pool(default_params()).unwrap();
    e.set_floors(&auth, Some(1), Some(4_001)).unwrap();
    let mut p = later(&e, default_params());
    assert_err!(e.try_create_pool(p.clone()), PoolError::WindowTooShort);
    p.prep_deadline -= 1;
    assert_err!(e.try_create_pool(p.clone()), PoolError::WindowTooShort); // finish ok, review 0 < 1
    p.payout_at += 1;
    e.try_create_pool(p).unwrap();
}

// ---- migrate_config_v4 ----------------------------------------------------------------------------

const V3_SPACE: usize = 8 + 138;

/// The v3 Config as its own borsh layout (no floors), padded to the v3 account size: what devnet holds before the upgrade.
fn v3_config_bytes(authority: Pubkey, treasury: Pubkey, fee_bps: u16, pool_count: u32, paused: bool, pending: Option<Pubkey>, payout: Option<Pubkey>) -> Vec<u8> {
    let bump = Pubkey::find_program_address(&[b"config"], &pid()).1;
    let mut d = Config::DISCRIMINATOR.to_vec();
    authority.serialize(&mut d).unwrap();
    treasury.serialize(&mut d).unwrap();
    fee_bps.serialize(&mut d).unwrap();
    pool_count.serialize(&mut d).unwrap();
    paused.serialize(&mut d).unwrap();
    bump.serialize(&mut d).unwrap();
    pending.serialize(&mut d).unwrap();
    payout.serialize(&mut d).unwrap();
    assert!(d.len() <= V3_SPACE);
    d.resize(V3_SPACE, 0);
    d
}

fn write_v3_config(e: &mut Env, data: Vec<u8>) {
    let lamports = e.svm.minimum_balance_for_rent_exemption(data.len());
    e.svm.airdrop(&config_pda(), lamports).unwrap();
    let mut acc = e.svm.get_account(&config_pda()).unwrap();
    acc.data = data;
    acc.owner = pid();
    e.svm.set_account(config_pda(), acc).unwrap();
}

#[test]
fn migrate_config_v4_grows_a_v3_config_and_keeps_every_field() {
    for (pending, payout, paused) in [(None, None, false), (Some(Keypair::new()), Some(Keypair::new().pubkey()), true)] {
        let mut e = Env::uninitialized(0);
        let admin = e.authority_kp();
        let treasury = e.plat_t.pubkey();
        let pending_key = pending.as_ref().map(|k| k.pubkey());
        write_v3_config(&mut e, v3_config_bytes(admin.pubkey(), treasury, 1234, 7, paused, pending_key, payout));
        let old_rent = e.bal(&config_pda());
        let new_len = 8 + Config::INIT_SPACE;
        assert!(new_len > V3_SPACE);
        let new_rent = e.svm.minimum_balance_for_rent_exemption(new_len);

        // a full v3 account (both keys set) does not load as v4; one with an unset key DOES – its zero padding reads as floors 0 – so only
        // migrate_config_v4 is relied on here
        if payout.is_some() {
            assert!(e.set_floors(&admin, Some(0), Some(0)).is_err());
        }
        // only the config's authority
        let stranger = funded(&mut e.svm, 10 * SOL);
        assert_err!(e.migrate_config(&stranger), PoolError::Unauthorized);

        let a0 = e.bal(&admin.pubkey());
        let r = e.migrate_config(&admin).unwrap();
        let ev = events::<ConfigMigrated>(&r.logs);
        assert_eq!((ev[0].min_review_secs, ev[0].min_finish_secs), (DEFAULT_MIN_REVIEW_SECS, DEFAULT_MIN_FINISH_SECS));
        let acc = e.svm.get_account(&config_pda()).unwrap();
        assert_eq!((acc.data.len(), acc.lamports, acc.owner), (new_len, new_rent, pid()), "resized and rent-exempt");
        assert_eq!(e.bal(&admin.pubkey()), a0 - (new_rent - old_rent), "the admin paid exactly the top-up (the cranker the fee)");
        let c = e.config();
        assert_eq!((c.authority, c.platform_treasury, c.platform_fee_bps, c.pool_count, c.paused), (admin.pubkey(), treasury, 1234, 7, paused));
        assert_eq!(c.bump, Pubkey::find_program_address(&[b"config"], &pid()).1);
        assert_eq!((c.pending_authority, c.payout_authority), (pending_key, payout));
        assert_eq!((c.min_review_secs, c.min_finish_secs), (DEFAULT_MIN_REVIEW_SECS, DEFAULT_MIN_FINISH_SECS));

        // once only
        assert_err!(e.migrate_config(&admin), PoolError::AlreadyMigrated);
        assert_err!(e.migrate_config(&stranger), PoolError::AlreadyMigrated);

        // the migrated Config works: set_config, the pool counter carries on, a pending handover completes
        e.set_config_full(&admin, Some(false), None, None, Some(0), Some(0)).unwrap();
        e.next_pool = 7;
        let id = e.create_pool(default_params());
        assert_eq!((id, e.config().pool_count), (7, 8));
        assert_eq!(e.pool(id).platform_fee_bps, 1234);
        if let Some(k) = pending {
            e.svm.airdrop(&k.pubkey(), SOL).unwrap();
            e.accept_authority(&k).unwrap();
            let c = e.config();
            assert_eq!((c.authority, c.payout_authority), (k.pubkey(), None));
        }
    }
}

#[test]
fn an_unmigrated_v3_config_is_refused_wherever_a_floor_matters() {
    // devnet's v3 Config has an unset key, so it DEcodes under v4 with both floors read as 0 – every step that relies on a floor refuses it until migrated
    let mut e = Env::uninitialized(0);
    let admin = e.authority_kp();
    let treasury = e.plat_t.pubkey();
    write_v3_config(&mut e, v3_config_bytes(admin.pubkey(), treasury, 0, 0, false, None, Some(Keypair::new().pubkey())));
    assert_err!(e.try_create_pool(default_params()), PoolError::ConfigNotMigrated);
    assert_err!(e.set_series(daily_series(e.now() + 60)), PoolError::ConfigNotMigrated);
    assert_err!(e.set_floors(&admin, Some(0), Some(0)), PoolError::ConfigNotMigrated);
    e.set_config(&admin, Some(false), None, None).unwrap();   // the pause and the treasury stay usable (the switch-off before / during the upgrade)
    e.migrate_config(&admin).unwrap();
    e.set_floors(&admin, Some(0), Some(0)).unwrap();
    e.create_pool(default_params());
}

#[test]
fn migrate_config_v4_refuses_a_v4_config() {
    let mut e = Env::new();
    let auth = e.authority_kp();
    let before = e.svm.get_account(&config_pda()).unwrap();
    assert_err!(e.migrate_config(&auth), PoolError::AlreadyMigrated);
    assert_eq!(e.svm.get_account(&config_pda()).unwrap().data, before.data);
}

#[test]
fn rent_rule_vault_never_left_between_zero_and_rent_min() {
    let mut e = Env::new();
    let id = e.create_pool(default_params().tap(|x| {
        x.min_tickets = 2;
        x.max_tickets = 0;
        x.max_per_wallet = 100;
    }));
    let a = funded(&mut e.svm, 20 * SOL);
    e.buy(id, &a, 10).unwrap();
    e.cover_player_share(id); // the commit below needs a prize share; the sale is still open
    let auth = e.authority_kp();
    e.warp(PLAY);
    let w = funded(&mut e.svm, SOL);
    let min = e.rent_min();

    // Tamper: the vault holds only rent_min + 5_000_000 (as if funds had gone elsewhere).
    let mut acct = e.svm.get_account(&vault_pda(id)).unwrap();
    acct.lamports = min + 5_000_000;
    e.svm.set_account(vault_pda(id), acct).unwrap();
    // each rank's amount is bound by the root: one rank per probe
    let (w2, w3, w4) = (funded(&mut e.svm, SOL), funded(&mut e.svm, SOL), funded(&mut e.svm, SOL));
    e.commit_winners(id, &auth, &[(w.pubkey(), 5_000_000 + min - 1_000), (w2.pubkey(), 5_000_000 + min + 1), (w3.pubkey(), 5_000_000), (w4.pubkey(), 1)])
        .unwrap();

    // taking all but 1000 lamports would leave the vault strictly between 0 and rent_min -> rejected
    assert_err!(e.pay_rank(id, 0), PoolError::BelowRentMin);
    // (a payout that empties the vault to exactly 0 is allowed by the rent rule; the full sweep is close_pool)
    // more than the vault holds -> rejected too
    assert_err!(e.pay_rank(id, 1), PoolError::BelowRentMin);
    // leaving exactly rent_min is fine
    let w0 = e.bal(&w3.pubkey());
    e.pay_rank(id, 2).unwrap();
    assert_eq!(e.vault(id), min);
    assert_eq!(e.bal(&w3.pubkey()), w0 + 5_000_000);
    // nothing more can be taken without dipping below rent_min
    assert_err!(e.pay_rank(id, 3), PoolError::BelowRentMin);
}

#[test]
fn compute_units_are_in_budget() {
    let mut e = Env::new();
    let id = e.create_pool(default_params().tap(|x| {
        x.min_tickets = 40;
        x.max_tickets = 0;
        x.max_per_wallet = 100;
    }));
    // ticket rent is paid by the fee payer; measure a first buy (Ticket init) and a repeat buy
    let a = funded(&mut e.svm, 20 * SOL);
    let first = e.buy(id, &a, 1).unwrap().compute_units_consumed;
    let again = e.buy(id, &a, 1).unwrap().compute_units_consumed;
    let sp = funded(&mut e.svm, SOL);
    let b = funded(&mut e.svm, 20 * SOL);
    let gasless = e.buy_sponsored(id, &b, &sp, 1).unwrap().compute_units_consumed;
    e.warp(PREP);
    e.fail(id).unwrap();
    let refund = e.refund(id, &a.pubkey(), &a.pubkey()).unwrap().compute_units_consumed;

    let refund_sponsor = {
        let mut e3 = Env::new();
        let id3 = e3.create_pool(default_params());
        let sp = funded(&mut e3.svm, 10 * SOL);
        let i = e3.sponsor_ix(id3, &sp.pubkey(), SOL);
        let sponsor = e3.send(&[i], &sp, &[]).unwrap().compute_units_consumed;
        println!("CU sponsor(first, receipt init)={sponsor}");
        assert!(sponsor < 40_000, "sponsor {sponsor}");
        e3.warp(PREP);
        e3.fail(id3).unwrap();
        e3.refund_sponsor(id3, &sp.pubkey()).unwrap().compute_units_consumed
    };

    // v4: pay_prize proves its leaf against a committed root – 20 winners, rank 0 carries the longest proof (5 nodes)
    let mut e2 = Env::new();
    let id2 = e2.create_pool(default_params().tap(|x| {
        x.min_tickets = 2;
        x.max_tickets = 0;
        x.max_per_wallet = 100;
    }));
    let c = funded(&mut e2.svm, 20 * SOL);
    e2.buy(id2, &c, 10).unwrap();
    e2.cover_player_share(id2);
    e2.warp(PLAY);
    let auth = e2.authority_kp();
    let list: Vec<(Pubkey, u64)> = (0..20).map(|_| (funded(&mut e2.svm, SOL).pubkey(), 1_000_000)).collect();
    let commit = e2.commit_winners(id2, &auth, &list).unwrap().compute_units_consumed;
    let w = e2.winners[&id2].clone();
    assert_eq!(w.proofs.iter().map(|p| p.len()).max(), Some(5));
    let mut pays = vec![];
    for r in 0..20u8 {
        pays.push(e2.pay_rank(id2, r).unwrap().compute_units_consumed);
    }
    let pay = *pays.iter().max().unwrap();
    let close = e2.close_pool(id2, &auth).unwrap().compute_units_consumed;

    println!(
        "CU buy_ticket(first, Ticket init)={first} buy_ticket(repeat)={again} buy_ticket(sponsored first)={gasless} refund={refund} refund_sponsor={refund_sponsor} \
         commit_winners={commit} pay_prize(20-winner root, max)={pay} pay_prize(all)={pays:?} close_pool={close}"
    );
    assert!(first < 40_000 && again < 40_000 && gasless < 40_000, "buy within ~35k plan, got {first}/{again}/{gasless}");
    assert!(refund < 30_000, "refund {refund}");
    assert!(refund_sponsor < 30_000, "refund_sponsor {refund_sponsor}");
    assert!(commit < 20_000, "commit_winners {commit}");
    assert!(pay < 22_000, "pay_prize {pay} CU must fit the server's CU_LIMITS.pay_prize (22 000)");
    assert!(close < 60_000, "close_pool {close}");
}

#[test]
fn pay_prize_cu_for_the_largest_root() {
    // MAX_WINNERS = 64 ranks: the deepest proof is 6 nodes
    let mut e = Env::new();
    let id = e.create_pool(default_params().tap(|x| {
        x.min_tickets = 2;
        x.max_tickets = 0;
        x.max_per_wallet = 100;
    }));
    let c = funded(&mut e.svm, 20 * SOL);
    e.buy(id, &c, 10).unwrap();
    e.cover_player_share(id);
    e.warp(PLAY);
    let auth = e.authority_kp();
    let list: Vec<(Pubkey, u64)> = (0..64).map(|i| (funded(&mut e.svm, SOL).pubkey(), 1_000_000 + i)).collect();
    e.commit_winners(id, &auth, &list).unwrap();
    assert_eq!(e.winners[&id].proofs[0].len(), 6);
    let pay = e.pay_rank(id, 0).unwrap().compute_units_consumed;
    let last = e.pay_rank(id, 63).unwrap().compute_units_consumed;
    println!("CU pay_prize(64-winner root) rank 0={pay} rank 63={last}");
    assert!(pay < 22_000 && last < 22_000, "pay_prize {pay}/{last} CU must fit the server's CU_LIMITS.pay_prize (22 000)");
}

trait Tap: Sized {
    fn tap(self, f: impl FnOnce(&mut Self)) -> Self;
}
impl Tap for freightchain_pools::CreatePoolParams {
    fn tap(mut self, f: impl FnOnce(&mut Self)) -> Self {
        f(&mut self);
        self
    }
}

// ---- events ---------------------------------------------------------------------------------

fn idl_discriminator(name: &str) -> Vec<u8> {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../target/idl/freightchain_pools.json");
    let idl: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(path).expect("run `anchor build` first")).unwrap();
    let ev = idl["events"].as_array().unwrap().iter().find(|e| e["name"] == name).unwrap_or_else(|| panic!("event {name} not in IDL"));
    ev["discriminator"].as_array().unwrap().iter().map(|b| b.as_u64().unwrap() as u8).collect()
}

fn check<E: Event + Discriminator>(name: &str) {
    assert_eq!(idl_discriminator(name), E::DISCRIMINATOR, "{name}");
}

#[test]
fn event_discriminators_match_the_idl() {
    check::<PoolCreated>("PoolCreated");
    check::<TicketBought>("TicketBought");
    check::<PoolActivated>("PoolActivated");
    check::<Sponsored>("Sponsored");
    check::<PoolFailed>("PoolFailed");
    check::<PoolCancelled>("PoolCancelled");
    check::<Refunded>("Refunded");
    check::<PrizePaid>("PrizePaid");
    check::<PoolClosed>("PoolClosed");
    check::<PoolExpired>("PoolExpired");
    check::<AuthorityProposed>("AuthorityProposed");
    check::<AuthorityChanged>("AuthorityChanged");
}

#[test]
fn events_decode_from_raw_logs_using_idl_discriminators() {
    // the reference decode path for the server: "Program data: <base64>" -> 8-byte IDL discriminator -> borsh
    let mut e = Env::new();
    let id = e.create_pool(default_params().tap(|x| x.min_tickets = 1));
    let a = funded(&mut e.svm, 10 * SOL);
    let r = e.buy(id, &a, 2).unwrap();
    let raw = program_data(&r.logs);
    assert_eq!(raw.len(), 2, "TicketBought + PoolActivated");
    let bought_disc = idl_discriminator("TicketBought");
    let act_disc = idl_discriminator("PoolActivated");
    let tb = raw.iter().find(|d| d[..8] == bought_disc[..]).expect("TicketBought log");
    // borsh layout: pool_id u32 | buyer [32] | qty u16 | lamports u64 | order_id [16] | tickets_sold u32 | activated bool
    let b = &tb[8..];
    assert_eq!(u32::from_le_bytes(b[0..4].try_into().unwrap()), id);
    assert_eq!(&b[4..36], a.pubkey().as_ref());
    assert_eq!(u16::from_le_bytes(b[36..38].try_into().unwrap()), 2);
    assert_eq!(u64::from_le_bytes(b[38..46].try_into().unwrap()), 2 * PRICE);
    assert_eq!(&b[46..62], &[7u8; 16]);
    assert_eq!(u32::from_le_bytes(b[62..66].try_into().unwrap()), 2);
    assert_eq!(b[66], 1);
    assert_eq!(b.len(), 67);
    let pa = raw.iter().find(|d| d[..8] == act_disc[..]).expect("PoolActivated log");
    assert_eq!(pa.len(), 8 + 4 + 4 + 8);
    assert_eq!(i64::from_le_bytes(pa[16..24].try_into().unwrap()), T0);

    // Refunded decodes the same way after a failed pool
    let mut e = Env::new();
    let id = e.create_pool(default_params());
    let buyer = funded(&mut e.svm, 10 * SOL);
    let sp = funded(&mut e.svm, SOL);
    e.buy_sponsored(id, &buyer, &sp, 1).unwrap();
    e.warp(PREP);
    e.fail(id).unwrap();
    let r = e.refund(id, &buyer.pubkey(), &sp.pubkey()).unwrap();
    let raw = program_data(&r.logs);
    let rd = idl_discriminator("Refunded");
    let rf = raw.iter().find(|d| d[..8] == rd[..]).expect("Refunded log");
    let b = &rf[8..];
    // pool_id u32 | buyer | rent_payer | qty u16 | lamports u64 | refunded_total u64
    assert_eq!(&b[4..36], buyer.pubkey().as_ref());
    assert_eq!(&b[36..68], sp.pubkey().as_ref());
    assert_eq!(u64::from_le_bytes(b[70..78].try_into().unwrap()), PRICE);
    assert_eq!(u64::from_le_bytes(b[78..86].try_into().unwrap()), PRICE);
}

#[test]
fn an_unlucky_buyers_ticket_bump_search_fits_the_server_limits() {
    // buy_ticket (init_if_needed) and refund find the Ticket PDA with find_program_address: every bump tried costs 1 500 CU and how many it takes is fixed
    // per wallet and pool. The server's limits (CU_LIMITS in server/src/infrastructure/solana/program-chain.adapter.ts: buy 60 000, refund 45 000) must cover
    // a wallet that needs >= 10 extra tries (1 wallet in 1 024) – the devnet rehearsal hit "exceeded CUs meter" with the old 30 000 / 18 000.
    let mut e = Env::new();
    let id = e.create_pool(default_params().tap(|x| {
        x.min_tickets = 40;
        x.max_tickets = 0;
        x.max_per_wallet = 100;
    }));
    let unlucky = (0..500_000)
        .map(|_| Keypair::new())
        .find(|k| Pubkey::find_program_address(&[b"ticket", pool_pda(id).as_ref(), k.pubkey().as_ref()], &pid()).1 <= 245)
        .expect("a buyer whose Ticket PDA needs >= 10 extra bump tries");
    e.svm.airdrop(&unlucky.pubkey(), 20 * SOL).unwrap();
    let buy = e.buy(id, &unlucky, 1).unwrap().compute_units_consumed;
    e.warp(PREP);
    e.fail(id).unwrap();
    let refund = e.refund(id, &unlucky.pubkey(), &unlucky.pubkey()).unwrap().compute_units_consumed;
    println!("unlucky buyer (>= 10 extra bump tries): buy_ticket {buy} CU, refund {refund} CU");
    assert!(buy < 60_000, "buy_ticket {buy} CU must fit the server's 60 000 limit");
    assert!(refund < 45_000, "refund {refund} CU must fit the server's 45 000 limit");
    assert!(refund > 18_000, "the old 18 000 refund limit would have refused this wallet ({refund} CU)");
}
