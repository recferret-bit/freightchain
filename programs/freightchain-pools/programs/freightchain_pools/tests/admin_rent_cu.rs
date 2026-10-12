#[macro_use]
mod common;

use anchor_lang::{prelude::Pubkey, Discriminator, Event};
use common::*;
use freightchain_pools::{
    error::PoolError,
    events::*,
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
    assert_eq!(e.config().authority, admin);
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
    // refunds are never blocked by the pause
    e.warp(PREP);
    e.fail(id).unwrap();
    e.refund(id, &a.pubkey(), &a.pubkey()).unwrap();
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
fn rent_rule_vault_never_left_between_zero_and_rent_min() {
    let mut e = Env::new();
    let id = e.create_pool(default_params().tap(|x| {
        x.min_tickets = 2;
        x.max_tickets = 0;
        x.max_per_wallet = 100;
    }));
    let a = funded(&mut e.svm, 20 * SOL);
    e.buy(id, &a, 10).unwrap(); // pot 1 SOL, prize share 0.6 SOL, Active
    let auth = e.authority_kp();
    e.warp(PLAY);
    let w = funded(&mut e.svm, SOL);
    let min = e.rent_min();

    // Tamper: the vault holds only rent_min + 5_000_000 (as if funds had gone elsewhere).
    let mut acct = e.svm.get_account(&vault_pda(id)).unwrap();
    acct.lamports = min + 5_000_000;
    e.svm.set_account(vault_pda(id), acct).unwrap();
    e.record_verified_attestation(id, &auth, &w.pubkey(), 100).unwrap();

    // taking all but 1000 lamports would leave the vault strictly between 0 and rent_min -> rejected
    assert_err!(e.pay_prize(id, &auth, &w.pubkey(), 5_000_000 + min - 1_000, 1), PoolError::BelowRentMin);
    // (a payout that empties the vault to exactly 0 is allowed by the rent rule; the full sweep is close_pool)
    // more than the vault holds -> rejected too
    assert_err!(e.pay_prize(id, &auth, &w.pubkey(), 5_000_000 + min + 1, 1), PoolError::BelowRentMin);
    // leaving exactly rent_min is fine
    let w0 = e.bal(&w.pubkey());
    e.pay_prize(id, &auth, &w.pubkey(), 5_000_000, 1).unwrap();
    assert_eq!(e.vault(id), min);
    assert_eq!(e.bal(&w.pubkey()), w0 + 5_000_000);
    // nothing more can be taken without dipping below rent_min
    assert_err!(e.pay_prize(id, &auth, &w.pubkey(), 1, 2), PoolError::BelowRentMin);
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

    let mut e2 = Env::new();
    let id2 = e2.create_pool(default_params().tap(|x| {
        x.min_tickets = 2;
        x.max_tickets = 0;
        x.max_per_wallet = 100;
    }));
    let c = funded(&mut e2.svm, 20 * SOL);
    e2.buy(id2, &c, 10).unwrap();
    e2.warp(PLAY);
    let auth = e2.authority_kp();
    let w = funded(&mut e2.svm, SOL);
    e2.record_verified_attestation(id2, &auth, &w.pubkey(), 100).unwrap();
    let pay = e2.pay_prize(id2, &auth, &w.pubkey(), 1_000_000, 1).unwrap().compute_units_consumed;
    let close = e2.close_pool(id2, &auth).unwrap().compute_units_consumed;

    println!("CU buy_ticket(first, Ticket init)={first} buy_ticket(repeat)={again} buy_ticket(sponsored first)={gasless} refund={refund} pay_prize={pay} close_pool={close}");
    assert!(first < 40_000 && again < 40_000 && gasless < 40_000, "buy within ~35k plan, got {first}/{again}/{gasless}");
    assert!(refund < 30_000, "refund {refund}");
    assert!(pay < 25_000, "pay_prize {pay}");
    assert!(close < 60_000, "close_pool {close}");
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
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../target/idl/freightchain_pools.json");
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
