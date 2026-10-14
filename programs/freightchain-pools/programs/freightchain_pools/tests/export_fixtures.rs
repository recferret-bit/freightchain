//! Real transactions for the server's decoder / encoder specs: one LiteSVM run of every pool instruction (create, seal_road, sponsored + self-paid
//! buys with activation, sponsor, a failed buy, commit_winners, veto_winners, pay_prize with a proof, close_pool, close_ticket, close_sponsor_receipt,
//! fail_pool + refund, refund_sponsor, the refunded close, cancel, expire, ride attestations + pledges, the floors, the authority handover), plus
//! winners roots and proofs for 1 / 2 / 3 / 20 winners (`winners`), written as JSON: per transaction the exact instructions (data + account metas, built by Anchor's own `InstructionData` /
//! `ToAccountMetas`), the logs, compute units and the events decoded by the program's own types; plus raw account bytes with their decoded fields.
//! The server's specs (test/unit/infrastructure/solana/*.spec.ts) decode those logs / accounts and rebuild those instructions, so TS and Rust must agree byte for byte.
//!
//! Always runs the scenario (asserting every step); WRITES only when asked (keys are random per run):
//!   FC_FIXTURES_OUT=$PWD/../../server/test/fixtures/chain cargo test --test export_fixtures      (from programs/freightchain-pools)
#[macro_use]
mod common;

use anchor_lang::{
    prelude::Pubkey,
    solana_program::instruction::Instruction,
    AccountDeserialize, AnchorDeserialize, Discriminator,
};
use base64::Engine;
use common::*;
use freightchain_pools::{accounts, events::*, instruction, Attestation, Config, CreatePoolParams, Pledge, Pool, RideAttestation, Series, SponsorReceipt, Ticket};
use serde_json::{json, Value};
use solana_keypair::Keypair;
use solana_signer::Signer;

const ORDER_A: [u8; 16] = [0x0b, 0x5e, 0xc9, 0xe3, 0x1f, 0x2a, 0x4c, 0x3d, 0x8e, 0x4f, 0x5a, 0x6b, 0x7c, 0x8d, 0x9e, 0x0f];
const ORDER_B: [u8; 16] = [0x7d, 0x1c, 0x00, 0x42, 0xa1, 0xb2, 0x4c, 0xd3, 0x9e, 0xf4, 0x05, 0x16, 0x27, 0x38, 0x49, 0x5a];

fn b64(b: &[u8]) -> String {
    base64::engine::general_purpose::STANDARD.encode(b)
}
fn s(v: u64) -> Value {
    json!(v.to_string())
}

/// The events of one transaction, decoded with the program's own types, in log order (every `Program data:` line).
fn decoded_events(logs: &[String]) -> Vec<Value> {
    macro_rules! try_ev {
        ($d:expr, $T:ty, $f:expr) => {
            if $d[..8] == *<$T>::DISCRIMINATOR {
                let e = <$T>::deserialize(&mut &$d[8..]).unwrap();
                return $f(e);
            }
        };
    }
    program_data(logs)
        .into_iter()
        .map(|d| -> Value {
            try_ev!(d, PoolCreated, |e: PoolCreated| json!({"kind": "PoolCreated", "poolId": e.pool_id, "pool": e.pool.to_string(), "vault": e.vault.to_string(),
                "authority": e.authority.to_string(), "tier": e.tier, "priceLamports": s(e.price_lamports), "minTickets": e.min_tickets, "maxTickets": e.max_tickets,
                "maxPerWallet": e.max_per_wallet, "prepDeadline": e.prep_deadline, "playDeadline": e.play_deadline, "payoutAt": e.payout_at, "prizeBps": e.prize_bps, "seedBps": e.seed_bps,
                "feeBps": e.fee_bps, "feeTreasury": e.fee_treasury.to_string(), "seedTreasury": e.seed_treasury.to_string(), "fromSeries": e.from_series, "seedCommitment": b64(&e.seed_commitment), "seedSlot": s(e.seed_slot), "seedSlotHash": b64(&e.seed_slot_hash)}));
            try_ev!(d, SeriesSet, |e: SeriesSet| json!({"kind": "SeriesSet", "tier": e.tier, "enabled": e.enabled, "priceLamports": s(e.price_lamports),
                "minTickets": e.min_tickets, "maxTickets": e.max_tickets, "maxPerWallet": e.max_per_wallet, "saleSecs": e.sale_secs, "playSecs": e.play_secs,
                "verifySecs": e.verify_secs, "prizeBps": e.prize_bps, "seedBps": e.seed_bps, "feeBps": e.fee_bps, "feeTreasury": e.fee_treasury.to_string(),
                "seedTreasury": e.seed_treasury.to_string(), "nextOpenAt": e.next_open_at}));
            try_ev!(d, PayoutAuthoritySet, |e: PayoutAuthoritySet| json!({"kind": "PayoutAuthoritySet", "authority": e.authority.to_string(),
                "payoutAuthority": e.payout_authority.map(|k| k.to_string())}));
            try_ev!(d, TicketBought, |e: TicketBought| json!({"kind": "TicketBought", "poolId": e.pool_id, "buyer": e.buyer.to_string(), "qty": e.qty,
                "lamports": s(e.lamports), "orderId": b64(&e.order_id), "ticketsSold": e.tickets_sold, "activated": e.activated}));
            try_ev!(d, PoolActivated, |e: PoolActivated| json!({"kind": "PoolActivated", "poolId": e.pool_id, "ticketsSold": e.tickets_sold, "at": e.at}));
            try_ev!(d, Sponsored, |e: Sponsored| json!({"kind": "Sponsored", "poolId": e.pool_id, "sponsor": e.sponsor.to_string(), "lamports": s(e.lamports), "sponsoredTotal": s(e.sponsored_total)}));
            try_ev!(d, PoolFailed, |e: PoolFailed| json!({"kind": "PoolFailed", "poolId": e.pool_id, "ticketsSold": e.tickets_sold}));
            try_ev!(d, PoolCancelled, |e: PoolCancelled| json!({"kind": "PoolCancelled", "poolId": e.pool_id, "ticketsSold": e.tickets_sold}));
            try_ev!(d, PoolExpired, |e: PoolExpired| json!({"kind": "PoolExpired", "poolId": e.pool_id, "ticketsSold": e.tickets_sold}));
            try_ev!(d, AuthorityProposed, |e: AuthorityProposed| json!({"kind": "AuthorityProposed", "authority": e.authority.to_string(), "pendingAuthority": e.pending_authority.to_string()}));
            try_ev!(d, AuthorityChanged, |e: AuthorityChanged| json!({"kind": "AuthorityChanged", "oldAuthority": e.old_authority.to_string(), "newAuthority": e.new_authority.to_string()}));
            try_ev!(d, Refunded, |e: Refunded| json!({"kind": "Refunded", "poolId": e.pool_id, "buyer": e.buyer.to_string(), "rentPayer": e.rent_payer.to_string(),
                "qty": e.qty, "lamports": s(e.lamports), "refundedTotal": s(e.refunded_total)}));
            try_ev!(d, PrizePaid, |e: PrizePaid| json!({"kind": "PrizePaid", "poolId": e.pool_id, "to": e.to.to_string(), "lamports": s(e.lamports), "rank": e.rank,
                "prizesPaidTotal": s(e.prizes_paid_total)}));
            try_ev!(d, PoolClosed, |e: PoolClosed| json!({"kind": "PoolClosed", "poolId": e.pool_id, "prizePaid": s(e.prize_paid), "seed": s(e.seed), "fee": s(e.fee),
                "platformFee": s(e.platform_fee), "unclaimed": s(e.unclaimed), "rentReturned": s(e.rent_returned), "cancelled": e.cancelled}));
            try_ev!(d, AttestationRecorded, |e: AttestationRecorded| json!({"kind": "AttestationRecorded", "poolId": e.pool_id, "pool": e.pool.to_string(), "driver": e.driver.to_string(), "telemetryRoot": b64(&e.telemetry_root), "verifiedKm": e.verified_km, "status": e.status, "recordedAt": e.recorded_at}));
            try_ev!(d, PledgeCreated, |e: PledgeCreated| json!({"kind": "PledgeCreated", "rideId": b64(&e.ride_id), "sponsor": e.sponsor.to_string(), "driver": e.driver.to_string(), "pool": e.pool.to_string(), "maxLamports": s(e.max_lamports), "lamportsPerKm": s(e.lamports_per_km), "targetKm": e.target_km, "createdAt": e.created_at}));
            try_ev!(d, PledgeSettled, |e: PledgeSettled| json!({"kind": "PledgeSettled", "rideId": b64(&e.ride_id), "sponsor": e.sponsor.to_string(), "driver": e.driver.to_string(), "pool": e.pool.to_string(), "verifiedKm": e.verified_km, "targetKm": e.target_km, "earnedLamports": s(e.earned_lamports), "refundedLamports": s(e.refunded_lamports)}));
            try_ev!(d, PledgeRefunded, |e: PledgeRefunded| json!({"kind": "PledgeRefunded", "rideId": b64(&e.ride_id), "sponsor": e.sponsor.to_string(), "driver": e.driver.to_string(), "pool": e.pool.to_string(), "refundedLamports": s(e.refunded_lamports)}));
            try_ev!(d, ConfigMigrated, |e: ConfigMigrated| json!({"kind": "ConfigMigrated", "minReviewSecs": e.min_review_secs, "minFinishSecs": e.min_finish_secs}));
            try_ev!(d, FloorsSet, |e: FloorsSet| json!({"kind": "FloorsSet", "minReviewSecs": e.min_review_secs, "minFinishSecs": e.min_finish_secs}));
            try_ev!(d, RoadSealed, |e: RoadSealed| json!({"kind": "RoadSealed", "poolId": e.pool_id, "seedSlot": s(e.seed_slot), "seedSlotHash": b64(&e.seed_slot_hash), "seedCommitment": b64(&e.seed_commitment)}));
            try_ev!(d, SealRearmed, |e: SealRearmed| json!({"kind": "SealRearmed", "poolId": e.pool_id, "sealSlot": s(e.seal_slot)}));
            try_ev!(d, WinnersCommitted, |e: WinnersCommitted| json!({"kind": "WinnersCommitted", "poolId": e.pool_id, "root": b64(&e.root), "total": s(e.total), "count": e.count, "committedAt": e.committed_at, "payFrom": e.pay_from, "by": e.by.to_string()}));
            try_ev!(d, WinnersVetoed, |e: WinnersVetoed| json!({"kind": "WinnersVetoed", "poolId": e.pool_id, "root": b64(&e.root)}));
            try_ev!(d, RideAttestationRecorded, |e: RideAttestationRecorded| json!({"kind": "RideAttestationRecorded", "poolId": e.pool_id, "pool": e.pool.to_string(), "rideId": b64(&e.ride_id), "driver": e.driver.to_string(), "telemetryRoot": b64(&e.telemetry_root), "verifiedKm": e.verified_km, "status": e.status, "recordedAt": e.recorded_at, "settleFrom": e.settle_from}));
            try_ev!(d, SponsorRefunded, |e: SponsorRefunded| json!({"kind": "SponsorRefunded", "poolId": e.pool_id, "sponsor": e.sponsor.to_string(), "lamports": s(e.lamports), "sponsorRefundedTotal": s(e.sponsor_refunded_total)}));
            try_ev!(d, AttestationClosed, |e: AttestationClosed| json!({"kind": "AttestationClosed", "account": e.account.to_string(), "rentTo": e.rent_to.to_string(), "lamports": s(e.lamports)}));
            panic!("unknown event discriminator {:?}", &d[..8]);
        })
        .collect()
}

fn ix_json(i: &Instruction, name: &str, args: Value) -> Value {
    json!({
        "name": name,
        "programId": i.program_id.to_string(),
        "accounts": i.accounts.iter().map(|m| json!({"pubkey": m.pubkey.to_string(), "isSigner": m.is_signer, "isWritable": m.is_writable})).collect::<Vec<_>>(),
        "data": b64(&i.data),
        "args": args,
    })
}

struct Rec {
    txs: Vec<Value>,
    accounts: Vec<Value>,
}

impl Rec {
    /// Send, assert the expected outcome, and record the transaction.
    fn send(&mut self, e: &mut Env, name: &str, ixs: Vec<(Instruction, &str, Value)>, payer: &Keypair, extra: &[&Keypair], ok: bool) -> Res {
        let raw: Vec<Instruction> = ixs.iter().map(|(i, _, _)| i.clone()).collect();
        let res = e.send(&raw, payer, extra);
        let (meta, err) = match &res {
            Ok(m) => (m.clone(), Value::Null),
            Err(f) => (f.meta.clone(), json!(format!("{:?}", f.err))),
        };
        assert_eq!(res.is_ok(), ok, "{name}: {:?}", meta.logs);
        let slot = e.svm.get_sysvar::<anchor_lang::prelude::Clock>().slot;
        self.txs.push(json!({
            "name": name,
            "signature": meta.signature.to_string(),
            "slot": slot,
            "feePayer": payer.pubkey().to_string(),
            "computeUnits": meta.compute_units_consumed,
            "err": err,
            "instructions": ixs.iter().map(|(i, n, a)| ix_json(i, n, a.clone())).collect::<Vec<_>>(),
            "logs": meta.logs,
            "events": if ok { decoded_events(&meta.logs) } else { vec![] },
        }));
        res
    }

    fn account(&mut self, e: &Env, name: &str, key: &Pubkey) {
        let a = e.svm.get_account(key).expect(name);
        let decoded = if a.data.len() >= 8 && a.data[..8] == *Pool::DISCRIMINATOR {
            let p = Pool::try_deserialize(&mut &a.data[..]).unwrap();
            json!({"type": "Pool", "poolId": p.pool_id, "authority": p.authority.to_string(), "tier": p.tier, "priceLamports": s(p.price_lamports),
                "minTickets": p.min_tickets, "maxTickets": p.max_tickets, "maxPerWallet": p.max_per_wallet, "prepDeadline": p.prep_deadline, "playDeadline": p.play_deadline,
                "payoutAt": p.payout_at, "prizeBps": p.prize_bps, "seedBps": p.seed_bps, "feeBps": p.fee_bps, "feeTreasury": p.fee_treasury.to_string(), "seedTreasury": p.seed_treasury.to_string(),
                "status": p.status, "ticketsSold": p.tickets_sold, "buyers": p.buyers, "sponsored": s(p.sponsored), "prizesPaid": s(p.prizes_paid),
                "refunded": s(p.refunded), "createdAt": p.created_at, "bump": p.bump, "vaultBump": p.vault_bump,
                "seedCommitment": b64(&p.seed_commitment), "seedSlot": s(p.seed_slot), "seedSlotHash": b64(&p.seed_slot_hash),
                "sealSlot": s(p.seal_slot), "platformFeeBps": p.platform_fee_bps, "winnersRoot": b64(&p.winners_root), "winnersTotal": s(p.winners_total),
                "winnersCount": p.winners_count, "committedAt": p.committed_at, "payFrom": p.pay_from, "paidMask": s(p.paid_mask),
                "sponsorRefunded": s(p.sponsor_refunded), "openPledges": p.open_pledges})
        } else if a.data.len() >= 8 && a.data[..8] == *Ticket::DISCRIMINATOR {
            let t = Ticket::try_deserialize(&mut &a.data[..]).unwrap();
            json!({"type": "Ticket", "buyer": t.buyer.to_string(), "rentPayer": t.rent_payer.to_string(), "poolId": t.pool_id, "qty": t.qty, "lamports": s(t.lamports), "bump": t.bump})
        } else if a.data.len() >= 8 && a.data[..8] == *Attestation::DISCRIMINATOR {
            let x = Attestation::try_deserialize(&mut &a.data[..]).unwrap();
            json!({"type": "Attestation", "pool": x.pool.to_string(), "driver": x.driver.to_string(), "telemetryRoot": b64(&x.telemetry_root),
                "verifiedKm": x.verified_km, "status": x.status, "recordedAt": x.recorded_at, "bump": x.bump})
        } else if a.data.len() >= 8 && a.data[..8] == *RideAttestation::DISCRIMINATOR {
            let x = RideAttestation::try_deserialize(&mut &a.data[..]).unwrap();
            json!({"type": "RideAttestation", "pool": x.pool.to_string(), "rideId": b64(&x.ride_id), "driver": x.driver.to_string(), "telemetryRoot": b64(&x.telemetry_root),
                "verifiedKm": x.verified_km, "status": x.status, "recordedAt": x.recorded_at, "settleFrom": x.settle_from, "settledPledges": x.settled_pledges,
                "rentPayer": x.rent_payer.to_string(), "bump": x.bump})
        } else if a.data.len() >= 8 && a.data[..8] == *SponsorReceipt::DISCRIMINATOR {
            let x = SponsorReceipt::try_deserialize(&mut &a.data[..]).unwrap();
            json!({"type": "SponsorReceipt", "pool": x.pool.to_string(), "sponsor": x.sponsor.to_string(), "lamports": s(x.lamports), "bump": x.bump})
        } else if a.data.len() >= 8 && a.data[..8] == *Pledge::DISCRIMINATOR {
            let x = Pledge::try_deserialize(&mut &a.data[..]).unwrap();
            json!({"type": "Pledge", "rideId": b64(&x.ride_id), "sponsor": x.sponsor.to_string(), "driver": x.driver.to_string(), "pool": x.pool.to_string(),
                "maxLamports": s(x.max_lamports), "lamportsPerKm": s(x.lamports_per_km), "targetKm": x.target_km, "settled": x.settled,
                "earnedLamports": s(x.earned_lamports), "refundedLamports": s(x.refunded_lamports), "createdAt": x.created_at, "bump": x.bump})
        } else if a.data.len() >= 8 && a.data[..8] == *Series::DISCRIMINATOR {
            let x = Series::try_deserialize(&mut &a.data[..]).unwrap();
            json!({"type": "Series", "tier": x.tier, "enabled": x.enabled, "priceLamports": s(x.price_lamports), "minTickets": x.min_tickets, "maxTickets": x.max_tickets,
                "maxPerWallet": x.max_per_wallet, "saleSecs": x.sale_secs, "playSecs": x.play_secs, "verifySecs": x.verify_secs, "prizeBps": x.prize_bps,
                "seedBps": x.seed_bps, "feeBps": x.fee_bps, "feeTreasury": x.fee_treasury.to_string(), "seedTreasury": x.seed_treasury.to_string(),
                "nextOpenAt": x.next_open_at, "poolsOpened": x.pools_opened, "lastPoolId": x.last_pool_id, "bump": x.bump})
        } else {
            let c = Config::try_deserialize(&mut &a.data[..]).unwrap();
            json!({"type": "Config", "authority": c.authority.to_string(), "platformTreasury": c.platform_treasury.to_string(), "platformFeeBps": c.platform_fee_bps,
                "poolCount": c.pool_count, "paused": c.paused, "bump": c.bump, "pendingAuthority": c.pending_authority.map(|k| k.to_string()),
                "payoutAuthority": c.payout_authority.map(|k| k.to_string()), "minReviewSecs": c.min_review_secs, "minFinishSecs": c.min_finish_secs})
        };
        self.accounts.push(json!({"name": name, "address": key.to_string(), "owner": a.owner.to_string(), "lamports": s(a.lamports), "data": b64(&a.data), "decoded": decoded}));
    }
}

fn buy(e: &Env, id: u32, buyer: &Pubkey, fee_payer: &Pubkey, qty: u16, order: [u8; 16]) -> (Instruction, &'static str, Value) {
    (e.buy_ix_order(id, buyer, fee_payer, qty, order), "buy_ticket", json!({"poolId": id, "qty": qty, "orderId": b64(&order), "buyer": buyer.to_string(), "feePayer": fee_payer.to_string()}))
}
fn close_pool_ix(e: &Env, id: u32, caller: &Pubkey) -> (Instruction, &'static str, Value) {
    let p = e.pool(id);
    let i = ix(
        instruction::ClosePool { pool_id: id },
        accounts::ClosePool {
            caller: *caller,
            pool_authority: p.authority,
            config: config_pda(),
            pool: pool_pda(id),
            vault: vault_pda(id),
            seed_treasury: p.seed_treasury,
            fee_treasury: p.fee_treasury,
            platform_treasury: e.plat_t.pubkey(),
            system_program: anchor_lang::solana_program::system_program::ID,
        },
    );
    (i, "close_pool", json!({"poolId": id, "caller": caller.to_string()}))
}
fn pay_prize_ix(e: &Env, id: u32, caller: &Pubkey, w: &Winners, rank: u8) -> (Instruction, &'static str, Value) {
    let (to, lamports) = w.list[rank as usize];
    let proof = w.proofs[rank as usize].clone();
    let args = json!({"poolId": id, "caller": caller.to_string(), "to": to.to_string(), "lamports": s(lamports), "rank": rank, "proof": proof.iter().map(|p| b64(p)).collect::<Vec<_>>()});
    (e.pay_prize_ix(id, caller, rank, &to, lamports, proof), "pay_prize", args)
}
fn commit_ix(id: u32, authority: &Pubkey, w: &Winners) -> (Instruction, &'static str, Value) {
    let count = w.list.len() as u8;
    let i = ix(
        instruction::CommitWinners { pool_id: id, root: w.root, total: w.total, count },
        accounts::CommitWinners { authority: *authority, config: config_pda(), pool: pool_pda(id) },
    );
    (i, "commit_winners", json!({"poolId": id, "authority": authority.to_string(), "root": b64(&w.root), "total": s(w.total), "count": count}))
}
fn seal(e: &mut Env, rec: &mut Rec, id: u32, payer: &Keypair) {
    let target = e.pool(id).seal_slot;
    e.set_slot(target + 3);
    let h = [0x40u8 + id as u8; 32];
    e.set_slot_hashes(&[(target + 2, [0x7e; 32]), (target, h), (target - 1, [0x01; 32])]);
    let i = (e.seal_road_ix(id, &payer.pubkey()), "seal_road", json!({"poolId": id}));
    rec.send(e, &format!("seal_road {id}"), vec![i], payer, &[], true).unwrap();
}
fn create(e: &mut Env, rec: &mut Rec, p: CreatePoolParams) -> u32 {
    let id = e.next_pool;
    let args = json!({"tier": p.tier, "priceLamports": s(p.price_lamports), "minTickets": p.min_tickets, "maxTickets": p.max_tickets, "maxPerWallet": p.max_per_wallet,
        "prepDeadline": p.prep_deadline, "playDeadline": p.play_deadline, "payoutAt": p.payout_at, "prizeBps": p.prize_bps, "seedBps": p.seed_bps, "feeBps": p.fee_bps});
    let i = e.create_pool_ix(p, e.fee_t.pubkey(), e.seed_t.pubkey());
    let (a, c) = (e.authority_kp(), clone_kp(&e.cranker));
    rec.send(e, &format!("create_pool {id}"), vec![(i, "create_pool", args)], &c, &[&a], true).unwrap();
    e.next_pool += 1;
    id
}

#[test]
fn export_pool_program_fixtures() {
    let mut e = Env::with_platform_fee(250);
    let mut rec = Rec { txs: vec![], accounts: vec![] };
    let auth = e.authority_kp();
    let cranker = clone_kp(&e.cranker);
    let key = |n: u8| Keypair::new_from_array([n; 32]);
    let (a, b, c, d, gas, brand, winner, next_admin) = (key(1), key(2), key(3), key(4), key(5), key(6), key(7), key(8));
    for k in [&a, &b, &c, &d, &gas, &brand, &winner, &next_admin] {
        e.svm.airdrop(&k.pubkey(), 10 * SOL).unwrap();
    }

    // ---- the floors (FloorsSet), and the migration's instruction bytes (refused: this Config is already v4)
    let i = ix(
        instruction::SetConfig { paused: None, platform_treasury: None, platform_fee_bps: None, min_review_secs: Some(0), min_finish_secs: Some(0) },
        accounts::SetConfig { authority: auth.pubkey(), config: config_pda(), new_platform_treasury: e.plat_t.pubkey() },
    );
    rec.send(&mut e, "set_config floors", vec![(i, "set_config", json!({"minReviewSecs": 0, "minFinishSecs": 0}))], &cranker, &[&auth], true).unwrap();
    let i = ix(instruction::MigrateConfigV4 {}, accounts::MigrateConfigV4 { authority: auth.pubkey(), config: config_pda(), system_program: anchor_lang::solana_program::system_program::ID });
    rec.send(&mut e, "migrate_config_v4 on a v4 Config (fails)", vec![(i, "migrate_config_v4", json!({}))], &cranker, &[&auth], false).unwrap_err();

    // ---- pool 0: the happy path, with a gas sponsor, activation, a brand sponsorship, a refused buy, a vetoed root, a prize and the split
    e.set_slot(1_000);
    let p0 = create(&mut e, &mut rec, default_params());
    seal(&mut e, &mut rec, p0, &cranker);
    let i = buy(&e, p0, &a.pubkey(), &gas.pubkey(), 2, ORDER_A);
    rec.send(&mut e, "buy_ticket sponsored (A x2, gas pays fee + rent)", vec![i], &gas, &[&a], true).unwrap();
    let i = buy(&e, p0, &b.pubkey(), &b.pubkey(), 1, ORDER_B);
    rec.send(&mut e, "buy_ticket self-paid (B x1) activates", vec![i], &b, &[], true).unwrap();
    let i = (e.sponsor_ix(p0, &brand.pubkey(), 50_000_000), "sponsor", json!({"poolId": p0, "sponsor": brand.pubkey().to_string(), "lamports": s(50_000_000)}));
    rec.send(&mut e, "sponsor", vec![i], &brand, &[], true).unwrap();
    let i = buy(&e, p0, &c.pubkey(), &c.pubkey(), 8, [9u8; 16]);
    rec.send(&mut e, "buy_ticket sold out (fails)", vec![i], &c, &[], false).unwrap_err();
    rec.account(&e, "config", &config_pda());
    rec.account(&e, "pool 0 active", &pool_pda(p0));
    rec.account(&e, "ticket pool 0 A", &ticket_pda(p0, &a.pubkey()));
    rec.account(&e, "sponsor receipt pool 0 brand", &receipt_pda(p0, &brand.pubkey()));
    e.warp(PLAY);
    let wrong = winners_of(p0, &[(a.pubkey(), 100_000_000)]);
    rec.send(&mut e, "commit_winners (a wrong root)", vec![commit_ix(p0, &auth.pubkey(), &wrong)], &cranker, &[&auth], true).unwrap();
    let i = ix(instruction::VetoWinners { pool_id: p0 }, accounts::VetoWinners { authority: auth.pubkey(), config: config_pda(), pool: pool_pda(p0) });
    rec.send(&mut e, "veto_winners", vec![(i, "veto_winners", json!({"poolId": p0}))], &cranker, &[&auth], true).unwrap();
    let w0 = winners_of(p0, &[(winner.pubkey(), 100_000_000), (b.pubkey(), 20_000_000)]);
    rec.send(&mut e, "commit_winners", vec![commit_ix(p0, &auth.pubkey(), &w0)], &cranker, &[&auth], true).unwrap();
    rec.account(&e, "pool 0 committed", &pool_pda(p0));
    for r in 0..2 {
        let i = pay_prize_ix(&e, p0, &d.pubkey(), &w0, r);
        rec.send(&mut e, &format!("pay_prize rank {r} (anyone)"), vec![i], &d, &[], true).unwrap();
    }
    let i = pay_prize_ix(&e, p0, &d.pubkey(), &w0, 0);
    rec.send(&mut e, "pay_prize rank 0 again (fails)", vec![i], &d, &[], false).unwrap_err();
    let i = close_pool_ix(&e, p0, &auth.pubkey());
    rec.send(&mut e, "close_pool settled", vec![i], &cranker, &[&auth], true).unwrap();
    rec.account(&e, "pool 0 settled", &pool_pda(p0));
    let i = ix(
        instruction::CloseSponsorReceipt { pool_id: p0 },
        accounts::CloseSponsorReceipt { caller: cranker.pubkey(), pool: pool_pda(p0), receipt: receipt_pda(p0, &brand.pubkey()), sponsor: brand.pubkey() },
    );
    rec.send(&mut e, "close_sponsor_receipt", vec![(i, "close_sponsor_receipt", json!({"poolId": p0, "sponsor": brand.pubkey().to_string()}))], &cranker, &[], true).unwrap();
    let i = ix(
        instruction::CloseTicket { pool_id: p0 },
        accounts::CloseTicket { caller: cranker.pubkey(), pool: pool_pda(p0), ticket: ticket_pda(p0, &a.pubkey()), rent_payer: gas.pubkey() },
    );
    rec.send(&mut e, "close_ticket", vec![(i, "close_ticket", json!({"poolId": p0}))], &cranker, &[], true).unwrap();

    // ---- pool 1: fails short of the minimum; fail_pool + refund in ONE transaction (what buildRefundTransaction makes), then the refunded close
    let lp = later(&e, default_params());
    let p1 = create(&mut e, &mut rec, lp);
    let i = buy(&e, p1, &c.pubkey(), &c.pubkey(), 1, [3u8; 16]);
    rec.send(&mut e, "buy_ticket into pool 1", vec![i], &c, &[], true).unwrap();
    rec.account(&e, "ticket pool 1 C", &ticket_pda(p1, &c.pubkey()));
    let i = (e.sponsor_ix(p1, &brand.pubkey(), 30_000_000), "sponsor", json!({"poolId": p1, "sponsor": brand.pubkey().to_string(), "lamports": s(30_000_000)}));
    rec.send(&mut e, "sponsor pool 1", vec![i], &brand, &[], true).unwrap();
    e.warp(e.pool(p1).prep_deadline);
    let fail = (e.fail_ix(p1, &d.pubkey()), "fail_pool", json!({"poolId": p1, "caller": d.pubkey().to_string()}));
    let refund = (e.refund_ix(p1, &d.pubkey(), &c.pubkey(), &c.pubkey()), "refund", json!({"poolId": p1, "caller": d.pubkey().to_string(), "buyer": c.pubkey().to_string(), "rentPayer": c.pubkey().to_string()}));
    rec.send(&mut e, "fail_pool + refund", vec![fail, refund], &gas, &[&d], true).unwrap();
    rec.account(&e, "pool 1 refunding", &pool_pda(p1));
    let i = ix(
        instruction::RefundSponsor { pool_id: p1 },
        accounts::RefundSponsor {
            caller: d.pubkey(),
            pool: pool_pda(p1),
            vault: vault_pda(p1),
            receipt: receipt_pda(p1, &brand.pubkey()),
            sponsor: brand.pubkey(),
            system_program: anchor_lang::solana_program::system_program::ID,
        },
    );
    rec.send(&mut e, "refund_sponsor", vec![(i, "refund_sponsor", json!({"poolId": p1, "sponsor": brand.pubkey().to_string()}))], &d, &[], true).unwrap();
    let i = close_pool_ix(&e, p1, &d.pubkey());
    rec.send(&mut e, "close_pool cancelled (refunded pool, anyone)", vec![i], &d, &[], true).unwrap();

    // ---- pool 2: nobody sealed in time (the target left the SlotHashes window: re-armed), then cancelled by the admin while open
    let lp = later(&e, default_params());
    let p2 = create(&mut e, &mut rec, lp);
    let target = e.pool(p2).seal_slot;
    e.set_slot(target + 900);
    e.set_slot_hashes(&[(target + 899, [0x31; 32]), (target + 388, [0x32; 32])]);
    let i = (e.seal_road_ix(p2, &cranker.pubkey()), "seal_road", json!({"poolId": p2}));
    rec.send(&mut e, "seal_road re-armed", vec![i], &cranker, &[], true).unwrap();
    let i = ix(instruction::CancelPool { pool_id: p2 }, accounts::CancelPool { authority: auth.pubkey(), config: config_pda(), pool: pool_pda(p2) });
    rec.send(&mut e, "cancel_pool", vec![(i, "cancel_pool", json!({"poolId": p2}))], &cranker, &[&auth], true).unwrap();

    // ---- pool 3: active, never settled, expired after the grace by anyone
    let mut p = later(&e, default_params());
    p.min_tickets = 1;
    let p3 = create(&mut e, &mut rec, p);
    let i = buy(&e, p3, &d.pubkey(), &d.pubkey(), 1, [4u8; 16]);
    rec.send(&mut e, "buy_ticket into pool 3 activates", vec![i], &d, &[], true).unwrap();
    e.warp(e.pool(p3).payout_at + freightchain_pools::SETTLE_GRACE_SECS);
    let i = ix(instruction::ExpirePool { pool_id: p3 }, accounts::ExpirePool { caller: d.pubkey(), pool: pool_pda(p3) });
    rec.send(&mut e, "expire_pool", vec![(i, "expire_pool", json!({"poolId": p3}))], &d, &[], true).unwrap();

    // ---- pool 4: the daily series – the admin names the payout key and writes the 1 h schedule, anyone opens the slot's pool,
    //      it activates, and after the review window the PAYOUT key (not the admin) pays a prize and closes it
    let payout = key(9);
    e.svm.airdrop(&payout.pubkey(), 10 * SOL).unwrap();
    let i = ix(
        instruction::SetPayoutAuthority { payout_authority: Some(payout.pubkey()) },
        accounts::SetPayoutAuthority { authority: auth.pubkey(), config: config_pda() },
    );
    rec.send(&mut e, "set_payout_authority", vec![(i, "set_payout_authority", json!({"payoutAuthority": payout.pubkey().to_string()}))], &cranker, &[&auth], true).unwrap();
    let start = e.now() + 60;
    let sp = daily_series(start);
    let sargs = json!({"tier": sp.tier, "enabled": sp.enabled, "priceLamports": s(sp.price_lamports), "minTickets": sp.min_tickets, "maxTickets": sp.max_tickets,
        "maxPerWallet": sp.max_per_wallet, "saleSecs": sp.sale_secs, "playSecs": sp.play_secs, "verifySecs": sp.verify_secs, "prizeBps": sp.prize_bps,
        "seedBps": sp.seed_bps, "feeBps": sp.fee_bps, "startAt": sp.start_at});
    let i = ix(
        instruction::SetSeries { params: sp.clone() },
        accounts::SetSeries {
            authority: auth.pubkey(),
            config: config_pda(),
            series: series_pda(1),
            fee_treasury: e.fee_t.pubkey(),
            seed_treasury: e.seed_t.pubkey(),
            platform_treasury: e.plat_t.pubkey(),
            system_program: anchor_lang::solana_program::system_program::ID,
        },
    );
    rec.send(&mut e, "set_series", vec![(i, "set_series", sargs)], &cranker, &[&auth], true).unwrap();
    rec.account(&e, "series 1", &series_pda(1));
    let early = e.open_next_pool_ix(1, &cranker.pubkey(), e.fee_t.pubkey(), e.seed_t.pubkey());
    rec.send(&mut e, "open_next_pool too early (fails)", vec![(early, "open_next_pool", json!({"tier": 1, "seedCommitment": b64(&[1u8; 32])}))], &cranker, &[], false).unwrap_err();
    e.warp(start);
    let p4 = e.config().pool_count;
    let i = e.open_next_pool_ix(1, &cranker.pubkey(), e.fee_t.pubkey(), e.seed_t.pubkey());
    rec.send(&mut e, "open_next_pool", vec![(i, "open_next_pool", json!({"tier": 1, "seedCommitment": b64(&[1u8; 32]), "caller": cranker.pubkey().to_string()}))], &cranker, &[], true).unwrap();
    e.next_pool = p4 + 1;
    rec.account(&e, "pool 4 open (series)", &pool_pda(p4));
    let i = buy(&e, p4, &a.pubkey(), &a.pubkey(), 3, [5u8; 16]);
    rec.send(&mut e, "buy_ticket into pool 4 activates", vec![i], &a, &[], true).unwrap();
    //      v3 pledges while rides count: the brand pledges per km on the winner's ride and on C's (C never finishes)
    let (ride_w, ride_c) = ([0x51u8; 32], [0x52u8; 32]);
    for (ride_id, driver, name) in [(ride_w, winner.pubkey(), "create_pledge (winner)"), (ride_c, c.pubkey(), "create_pledge (C)")] {
        let i = ix(
            instruction::CreatePledge { ride_id, driver, max_lamports: 1_000_000, lamports_per_km: 10_000, target_km: 100 },
            accounts::CreatePledge {
                sponsor: brand.pubkey(),
                driver,
                config: config_pda(),
                pool: pool_pda(p4),
                pledge: pledge_pda(&ride_id, &brand.pubkey()),
                system_program: anchor_lang::solana_program::system_program::ID,
            },
        );
        let args = json!({"rideId": b64(&ride_id), "driver": driver.to_string(), "maxLamports": s(1_000_000), "lamportsPerKm": s(10_000), "targetKm": 100});
        rec.send(&mut e, name, vec![(i, "create_pledge", args)], &brand, &[], true).unwrap();
    }
    rec.account(&e, "pledge on the winner's ride", &pledge_pda(&ride_w, &brand.pubkey()));
    //      at the play deadline the payout key records the winner's RIDE attestation (60 km) and commits the winners; nobody pays before the lock
    e.warp(e.pool(p4).play_deadline);
    seal(&mut e, &mut rec, p4, &cranker);
    let i = ix(
        instruction::RecordRideAttestation { pool_id: p4, ride_id: ride_w, driver: winner.pubkey(), telemetry_root: [7u8; 32], verified_km: 60, status: freightchain_pools::ATTESTATION_STATUS_VERIFIED },
        accounts::RecordRideAttestation {
            authority: payout.pubkey(),
            config: config_pda(),
            pool: pool_pda(p4),
            ride_attestation: ride_attestation_pda(p4, &ride_w),
            system_program: anchor_lang::solana_program::system_program::ID,
        },
    );
    let args = json!({"poolId": p4, "rideId": b64(&ride_w), "driver": winner.pubkey().to_string(), "telemetryRoot": b64(&[7u8; 32]), "verifiedKm": 60, "status": 1});
    rec.send(&mut e, "record_ride_attestation by the payout key", vec![(i, "record_ride_attestation", args)], &cranker, &[&payout], true).unwrap();
    rec.account(&e, "ride attestation pool 4 winner", &ride_attestation_pda(p4, &ride_w));
    let w4 = winners_of(p4, &[(winner.pubkey(), PRICE)]);
    rec.send(&mut e, "commit_winners by the payout key", vec![commit_ix(p4, &payout.pubkey(), &w4)], &cranker, &[&payout], true).unwrap();
    let i = pay_prize_ix(&e, p4, &cranker.pubkey(), &w4, 0);
    rec.send(&mut e, "pay_prize inside the lock (fails)", vec![i], &cranker, &[], false).unwrap_err();
    e.warp(e.pool(p4).pay_from);
    let i = pay_prize_ix(&e, p4, &cranker.pubkey(), &w4, 0);
    rec.send(&mut e, "pay_prize after the lock (anyone)", vec![i], &cranker, &[], true).unwrap();
    let i = close_pool_ix(&e, p4, &payout.pubkey());
    rec.send(&mut e, "close_pool by the payout key", vec![i], &cranker, &[&payout], true).unwrap();
    //      after the close: anyone settles the winner's pledge (60 of 100 km) and refunds C's (its ride has no attestation); then the attestation's rent goes back
    let i = ix(
        instruction::SettlePledge { ride_id: ride_w },
        accounts::SettlePledge {
            caller: cranker.pubkey(),
            driver: winner.pubkey(),
            sponsor: brand.pubkey(),
            config: config_pda(),
            pool: pool_pda(p4),
            ride_attestation: ride_attestation_pda(p4, &ride_w),
            pledge: pledge_pda(&ride_w, &brand.pubkey()),
            system_program: anchor_lang::solana_program::system_program::ID,
        },
    );
    rec.send(&mut e, "settle_pledge", vec![(i, "settle_pledge", json!({"rideId": b64(&ride_w)}))], &cranker, &[], true).unwrap();
    let i = ix(
        instruction::RefundPledge { ride_id: ride_c },
        accounts::RefundPledge {
            caller: cranker.pubkey(),
            sponsor: brand.pubkey(),
            pool: pool_pda(p4),
            ride_attestation: ride_attestation_pda(p4, &ride_c),
            pledge: pledge_pda(&ride_c, &brand.pubkey()),
        },
    );
    rec.send(&mut e, "refund_pledge", vec![(i, "refund_pledge", json!({"rideId": b64(&ride_c)}))], &cranker, &[], true).unwrap();
    rec.account(&e, "pool 4 settled", &pool_pda(p4));
    let i = ix(
        instruction::CloseRideAttestation { pool_id: p4, ride_id: ride_w },
        accounts::CloseRideAttestation { caller: cranker.pubkey(), pool: pool_pda(p4), ride_attestation: ride_attestation_pda(p4, &ride_w), rent_payer: payout.pubkey() },
    );
    rec.send(&mut e, "close_ride_attestation", vec![(i, "close_ride_attestation", json!({"poolId": p4, "rideId": b64(&ride_w)}))], &cranker, &[], true).unwrap();
    rec.account(&e, "config with payout key", &config_pda());

    // ---- the authority handover (program events that are NOT pool events)
    let i = ix(instruction::ProposeAuthority { new_authority: next_admin.pubkey() }, accounts::ProposeAuthority { authority: auth.pubkey(), config: config_pda() });
    rec.send(&mut e, "propose_authority", vec![(i, "propose_authority", json!({}))], &cranker, &[&auth], true).unwrap();
    let i = ix(instruction::AcceptAuthority {}, accounts::AcceptAuthority { new_authority: next_admin.pubkey(), config: config_pda() });
    rec.send(&mut e, "accept_authority", vec![(i, "accept_authority", json!({}))], &cranker, &[&next_admin], true).unwrap();

    let kinds: Vec<String> = rec.txs.iter().flat_map(|t| t["events"].as_array().unwrap().iter().map(|e| e["kind"].as_str().unwrap().to_string())).collect();
    for k in ["PoolCreated", "TicketBought", "PoolActivated", "Sponsored", "PoolFailed", "PoolCancelled", "PoolExpired", "Refunded", "PrizePaid", "PoolClosed", "AuthorityProposed",
        "AuthorityChanged", "SeriesSet", "PayoutAuthoritySet", "PledgeCreated", "PledgeSettled", "PledgeRefunded", "FloorsSet", "RoadSealed", "SealRearmed", "WinnersCommitted",
        "WinnersVetoed", "RideAttestationRecorded", "SponsorRefunded", "AttestationClosed"] {
        assert!(kinds.iter().any(|x| x == k), "no {k} recorded");
    }
    let out = json!({
        "programId": pid().to_string(),
        "rentMin": s(e.rent_min()),
        "configAddress": config_pda().to_string(),
        "keys": {"authority": auth.pubkey().to_string(), "cranker": cranker.pubkey().to_string(), "a": a.pubkey().to_string(), "b": b.pubkey().to_string(),
            "c": c.pubkey().to_string(), "d": d.pubkey().to_string(), "gas": gas.pubkey().to_string(), "brand": brand.pubkey().to_string(), "winner": winner.pubkey().to_string(),
            "nextAdmin": next_admin.pubkey().to_string(), "payout": payout.pubkey().to_string(), "feeTreasury": e.fee_t.pubkey().to_string(), "seedTreasury": e.seed_t.pubkey().to_string(), "platformTreasury": e.plat_t.pubkey().to_string()},
        "transactions": rec.txs,
        "accounts": rec.accounts,
        "winners": winner_vectors(),
    });
    if let Ok(dir) = std::env::var("FC_FIXTURES_OUT") {
        let path = std::path::Path::new(&dir).join("pool-program.json");
        std::fs::write(&path, serde_json::to_string_pretty(&out).unwrap() + "\n").unwrap();
        println!("wrote {}", path.display());
    }
}

/// Roots and proofs the server must reproduce byte for byte (server/src/domain/economy/winners-merkle.ts): 1, 2, 3 and 20 winners of pool 7.
fn winner_vectors() -> Vec<Value> {
    [1usize, 2, 3, 20]
        .iter()
        .map(|&n| {
            let list: Vec<(Pubkey, u64)> = (0..n).map(|i| (Pubkey::new_from_array([0x80 + i as u8; 32]), 1_000_000 * (n - i) as u64 + 7)).collect();
            let w = winners_of(7, &list);
            for (r, p) in w.proofs.iter().enumerate() {
                let leaf = freightchain_pools::state::winner_leaf(7, r as u8, &list[r].0, list[r].1);
                assert_eq!(freightchain_pools::state::merkle_root_from(leaf, r as u32, n as u32, p), Some(w.root), "{n} winners, rank {r}");
            }
            json!({"poolId": 7, "list": list.iter().map(|(k, l)| json!({"wallet": k.to_string(), "lamports": s(*l)})).collect::<Vec<_>>(),
                "root": b64(&w.root), "total": s(w.total), "proofs": w.proofs.iter().map(|p| p.iter().map(|x| b64(x)).collect::<Vec<_>>()).collect::<Vec<_>>()})
        })
        .collect()
}
