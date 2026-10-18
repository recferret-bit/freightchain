//! The money maths pinned in ONE table shared with the server: `server/test/fixtures/chain/vault-split-cases.json`.
//! The server's `domain/economy/vault-split.ts` spec reads the same file, so the two suites cannot drift apart.
//! Each row is checked twice here: against the program's own functions (`Pool::pot`, `split`, `bps_of`), and – where the amounts are
//! reachable – end to end through LiteSVM (create, buy, sponsor, commit_winners + pay_prize, stray lamports, close_pool), comparing the `PoolClosed`
//! event. v4: the platform cut is the pool's own `platform_fee_bps` (snapshotted at creation, L8), and a refunded pool gives its sponsorship back (M8).
#[macro_use]
mod common;

use anchor_lang::prelude::Pubkey;
use common::*;
use freightchain_pools::{
    events::PoolClosed,
    state::{bps_of, split},
    CreatePoolParams, Pool,
};
use serde_json::Value;
use solana_signer::Signer;

const TABLE: &str = include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/../../server/test/fixtures/chain/vault-split-cases.json"));

fn rows() -> Vec<Value> {
    let v: Value = serde_json::from_str(TABLE).unwrap();
    v["cases"].as_array().unwrap().clone()
}
fn u(v: &Value, k: &str) -> u64 {
    v[k].as_str().unwrap_or_else(|| panic!("{k} must be a string")).parse().unwrap()
}
fn n(v: &Value, k: &str) -> u64 {
    v[k].as_u64().unwrap()
}
/// Absent = the historical test ceiling (4_999). There is no "no cap" on a v5 pool; a row may set a lower `maxPlayerShareBps`.
fn opt_n(v: &Value, k: &str) -> Option<u64> {
    v.get(k).and_then(|x| x.as_u64())
}

fn pool_of(r: &Value) -> Pool {
    Pool {
        pool_id: 0,
        authority: Pubkey::default(),
        tier: 1,
        price_lamports: u(r, "price"),
        min_tickets: 1,
        max_tickets: 0,
        max_per_wallet: 1,
        prep_deadline: 0,
        play_deadline: 0,
        payout_at: 0,
        prize_bps: n(r, "prizeBps") as u16,
        seed_bps: n(r, "seedBps") as u16,
        fee_bps: n(r, "feeBps") as u16,
        fee_treasury: Pubkey::default(),
        seed_treasury: Pubkey::default(),
        status: 1,
        tickets_sold: n(r, "sold") as u32,
        buyers: 0,
        sponsored: u(r, "sponsored"),
        prizes_paid: u(r, "prizesPaid"),
        refunded: 0,
        created_at: 0,
        bump: 0,
        vault_bump: 0,
        seed_commitment: [0u8; 32],
        seed_slot: 0,
        seed_slot_hash: [0u8; 32],
        seal_slot: 0,
        platform_fee_bps: n(r, "platformFeeBps") as u16,
        winners_root: [0u8; 32],
        winners_total: 0,
        winners_count: 0,
        committed_at: 0,
        pay_from: 0,
        paid_mask: 0,
        sponsor_refunded: 0,
        open_pledges: 0,
        min_review_secs: 0,
        paid_tickets_enabled: true,
        max_player_share_bps: opt_n(r, "maxPlayerShareBps").unwrap_or(4_999) as u16,
    }
}

#[test]
fn shared_table_matches_the_program_functions() {
    let rows = rows();
    assert!(rows.len() >= 12);
    for r in &rows {
        let name = r["name"].as_str().unwrap();
        let p = pool_of(r);
        if r.get("error").is_some() {
            assert!(p.pot().is_err(), "{name}: expected MathOverflow");
            continue;
        }
        let pot = p.pot().unwrap();
        assert_eq!(pot, u(r, "pot"), "{name}: pot");
        let counted = p.counted_pot().unwrap();
        assert_eq!(counted, u(r, "countedPot"), "{name}: counted pot");
        assert_eq!(p.ticket_excess().unwrap(), u(r, "ticketExcess"), "{name}: ticket excess");
        let (prize, seed, fee) = split(counted, p.prize_bps, p.seed_bps).unwrap();
        assert_eq!((prize, seed, fee), (u(r, "prize"), u(r, "seed"), u(r, "fee")), "{name}: split");
        assert_eq!(p.prize_share().unwrap(), prize, "{name}: prize leg");
        let platform = bps_of(fee, p.platform_fee_bps).unwrap();
        assert_eq!(platform, u(r, "platform"), "{name}: platform cut");
        let Some(c) = r["close"].as_object() else { continue };
        // close_pool: everything but fee, platform cut and the rent minimum goes to the seed treasury (excess included)
        let c = Value::Object(c.clone());
        let rent = u(&c, "rentReturned");
        let distributable = u(&c, "vault") - rent;
        let cancelled = r["cancelled"].as_bool().unwrap();
        let (fee_out, plat_out, unclaimed, excess) = if cancelled { (0, 0, 0, 0) } else { (fee - platform, platform, prize - p.prizes_paid, p.ticket_excess().unwrap()) };
        assert_eq!((fee_out, plat_out, unclaimed, excess), (u(&c, "fee"), u(&c, "platformFee"), u(&c, "unclaimed"), u(&c, "ticketExcess")), "{name}: close legs");
        assert_eq!(distributable - fee_out - plat_out, u(&c, "seed"), "{name}: seed leg");
    }
}

/// The rows a real pool can reach (something sold, the vault fits u64): run them through the program and compare `PoolClosed`.
#[test]
fn shared_table_matches_close_pool_on_chain() {
    let mut ran = 0;
    for r in rows() {
        let name = r["name"].as_str().unwrap().to_string();
        let Some(c) = r["close"].as_object().map(|c| Value::Object(c.clone())) else { continue };
        let sold = n(&r, "sold") as u16;
        if sold == 0 {
            continue; // an Open pool cannot be closed
        }
        let cancelled = r["cancelled"].as_bool().unwrap();
        let mut e = Env::new();
        assert_eq!(e.rent_min(), u(&c, "rentReturned"), "{name}: rent minimum");
        let auth = e.authority_kp();
        let plat_bps = n(&r, "platformFeeBps") as u16;
        e.set_config(&auth, None, None, Some(plat_bps)).unwrap();
        let player = opt_n(&r, "maxPlayerShareBps").unwrap_or(4_999) as u16;
        e.set_pool_rules(&auth, true, n(&r, "prizeBps") as u16, n(&r, "seedBps") as u16, n(&r, "feeBps") as u16, player, 0).unwrap();
        let price = u(&r, "price");
        let params = CreatePoolParams {
            tier: 1,
            price_lamports: price,
            min_tickets: if cancelled { sold as u32 + 1 } else { sold as u32 },
            max_tickets: 0,
            max_per_wallet: sold,
            prep_deadline: PREP,
            play_deadline: PLAY,
            payout_at: PAYOUT,
        };
        let id = e.create_pool(params);
        // L8: the cut is fixed when the pool opens – changing the config afterwards does not move this pool's close
        e.set_config(&auth, None, None, Some(10_000 - plat_bps)).unwrap();
        assert_eq!(e.pool(id).platform_fee_bps, plat_bps, "{name}: snapshot");
        let buyer = funded(&mut e.svm, price * sold as u64 + 10 * SOL);
        e.buy(id, &buyer, sold).unwrap();
        let sponsored = u(&r, "sponsored");
        let sp = funded(&mut e.svm, sponsored + SOL);
        if sponsored > 0 {
            let i = e.sponsor_ix(id, &sp.pubkey(), sponsored);
            e.send(&[i], &sp, &[]).unwrap();
        }
        let (want_vault, want_seed) = (u(&c, "vault"), u(&c, "seed"));
        if cancelled {
            e.warp(PREP);
            e.fail(id).unwrap();
            e.refund(id, &buyer.pubkey(), &buyer.pubkey()).unwrap();
            if sponsored > 0 {
                // v4 (M8): the sponsor is refunded before the close (the table's close row is the vault after that)
                e.refund_sponsor(id, &sp.pubkey()).unwrap();
            }
        } else {
            e.warp(PLAY);
            let paid = u(&r, "prizesPaid");
            // the close before the grace needs a committed root: one winner, or none
            if paid > 0 {
                let winner = funded(&mut e.svm, SOL);
                e.commit_and_pay(id, &auth, &[(winner.pubkey(), paid)]);
            } else {
                e.commit_winners(id, &auth, &[]).unwrap();
            }
        }
        let stray = u(&r, "stray");
        if stray > 0 {
            let donor = funded(&mut e.svm, SOL);
            let i = anchor_lang::solana_program::system_instruction::transfer(&donor.pubkey(), &vault_pda(id), stray);
            e.send(&[i], &donor, &[]).unwrap();
        }
        assert_eq!(e.vault(id), want_vault, "{name}: vault before close");
        let res = e.close_pool(id, &auth).unwrap();
        let ev = &events::<PoolClosed>(&res.logs)[0];
        assert_eq!(
            (ev.seed, ev.fee, ev.platform_fee, ev.unclaimed, ev.rent_returned, ev.cancelled, ev.ticket_excess),
            (want_seed, u(&c, "fee"), u(&c, "platformFee"), u(&c, "unclaimed"), u(&c, "rentReturned"), cancelled, u(&c, "ticketExcess")),
            "{name}: PoolClosed"
        );
        assert_eq!(e.vault(id), 0, "{name}: vault ends at 0");
        ran += 1;
    }
    assert!(ran >= 7, "only {ran} rows ran on chain");
}

/// audit L8: the platform cut at close is the one the buyers were shown when the pool opened, not whatever the config says at close.
#[test]
fn platform_cut_is_the_one_the_pool_opened_with() {
    let mut e = Env::with_platform_fee(1_000);
    let auth = e.authority_kp();
    let id = e.create_pool(CreatePoolParams { min_tickets: 2, max_tickets: 0, ..default_params() });
    assert_eq!(e.pool(id).platform_fee_bps, 1_000);
    let b = funded(&mut e.svm, 10 * SOL);
    e.buy(id, &b, 4).unwrap();
    e.cover_player_share(id); // a ticket-only pot has a zero fee, so the snapshot would not be visible
    // the admin raises the cut to 90 % after the sale
    e.set_config(&auth, None, None, Some(9_000)).unwrap();
    let later_pool = e.create_pool(later(&e, default_params()));
    assert_eq!(e.pool(later_pool).platform_fee_bps, 9_000, "only new pools take the new cut");
    e.warp(PLAY);
    e.commit_winners(id, &auth, &[]).unwrap();
    let fee = {
        let p = e.pool(id);
        split(p.counted_pot().unwrap(), p.prize_bps, p.seed_bps).unwrap().2
    };
    let (p0, f0) = (e.bal(&e.plat_t.pubkey()), e.bal(&e.fee_t.pubkey()));
    let ev = &events::<PoolClosed>(&e.close_pool(id, &auth).unwrap().logs)[0];
    assert_eq!((ev.platform_fee, ev.fee), (bps_of(fee, 1_000).unwrap(), fee - bps_of(fee, 1_000).unwrap()));
    assert_eq!((e.bal(&e.plat_t.pubkey()) - p0, e.bal(&e.fee_t.pubkey()) - f0), (bps_of(fee, 1_000).unwrap(), fee - bps_of(fee, 1_000).unwrap()));
}
