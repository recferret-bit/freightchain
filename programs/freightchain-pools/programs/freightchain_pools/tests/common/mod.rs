#![allow(dead_code)]
//! LiteSVM harness shared by the test files.

use {
    anchor_lang::{
        prelude::{Clock, Pubkey},
        solana_program::{bpf_loader_upgradeable, instruction::Instruction, system_program},
        AccountDeserialize, AnchorDeserialize, Discriminator, Event, InstructionData, ToAccountMetas,
    },
    base64::Engine,
    freightchain_pools::{
        accounts, constants::SLOT_HASHES_ID, instruction, state::winner_leaf, Attestation, Config, CreatePoolParams, Pledge, Pool, RideAttestation, Series,
        SeriesParams, SponsorReceipt, Ticket,
    },
    std::collections::HashMap,
    litesvm::{
        types::{FailedTransactionMetadata, TransactionMetadata},
        LiteSVM,
    },
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
};

pub type Res = Result<TransactionMetadata, FailedTransactionMetadata>;

pub const T0: i64 = 1_000_000;
pub const SOL: u64 = 1_000_000_000;
pub const PRICE: u64 = 100_000_000; // 0.1 SOL
pub const PREP: i64 = T0 + 1_000;
pub const PLAY: i64 = T0 + 5_000;
/// default pools have no review window (payout_at = play_deadline); the series tests use a real one
pub const PAYOUT: i64 = PLAY;

/// Anchor error number of a PoolError variant (6000 + index).
pub fn code(e: freightchain_pools::error::PoolError) -> u32 {
    e.into()
}

#[macro_export]
macro_rules! assert_err {
    ($res:expr, $err:expr) => {{
        match $res {
            Ok(_) => panic!("expected error {:?}, but the transaction succeeded", $err),
            Err(e) => {
                let want = format!("Custom({})", common::code($err));
                let got = format!("{:?}", e.err);
                assert!(
                    got.contains(&want),
                    "expected {:?} ({}), got {} | logs: {:?}",
                    $err,
                    want,
                    got,
                    e.meta.logs
                );
            }
        }
    }};
}

/// A pool's winners as the server commits them: the list, its root and one proof per rank (the program's tree shape: RFC 6962 tags, an odd node promoted).
#[derive(Clone)]
pub struct Winners {
    pub list: Vec<(Pubkey, u64)>,
    pub root: [u8; 32],
    pub total: u64,
    pub proofs: Vec<Vec<[u8; 32]>>,
}

pub fn winners_of(pool_id: u32, list: &[(Pubkey, u64)]) -> Winners {
    let total = list.iter().map(|w| w.1).sum();
    if list.is_empty() {
        return Winners { list: vec![], root: [0; 32], total: 0, proofs: vec![] };
    }
    let leaves: Vec<[u8; 32]> = list.iter().enumerate().map(|(i, (w, l))| winner_leaf(pool_id, i as u8, w, *l)).collect();
    let mut levels = vec![leaves];
    while levels.last().unwrap().len() > 1 {
        let l = levels.last().unwrap();
        let next = l.chunks(2).map(|c| if c.len() == 2 { solana_sha256_hasher::hashv(&[&[0x01], &c[0], &c[1]]).to_bytes() } else { c[0] }).collect();
        levels.push(next);
    }
    let proofs = (0..list.len())
        .map(|i| {
            let (mut idx, mut proof) = (i, vec![]);
            for l in &levels[..levels.len() - 1] {
                if (idx ^ 1) < l.len() {
                    proof.push(l[idx ^ 1]);
                }
                idx /= 2;
            }
            proof
        })
        .collect();
    Winners { list: list.to_vec(), root: levels.last().unwrap()[0], total, proofs }
}

pub struct Env {
    pub svm: LiteSVM,
    pub authority: Keypair,
    pub cranker: Keypair,
    pub seed_t: Keypair,
    pub fee_t: Keypair,
    pub plat_t: Keypair,
    pub next_pool: u32,
    pub platform_fee_bps: u16,
    pub plat_t_start: u64,
    /// the winners each pool committed (for pay_rank)
    pub winners: HashMap<u32, Winners>,
}

pub fn pid() -> Pubkey {
    freightchain_pools::id()
}
/// The program's ProgramData account (upgradeable loader), where the upgrade authority lives.
pub fn programdata_pda() -> Pubkey {
    Pubkey::find_program_address(&[pid().as_ref()], &bpf_loader_upgradeable::ID).0
}

/// LiteSVM loads the program with no upgrade authority; write one into the ProgramData metadata
/// (bincode: u32 tag 3, u64 slot, Option<Pubkey> = 1 tag byte + 32 bytes, at offset 12).
pub fn set_upgrade_authority(svm: &mut LiteSVM, who: &Pubkey) {
    let addr = programdata_pda();
    let mut acc = svm.get_account(&addr).expect("ProgramData");
    assert_eq!(acc.data[0..4], [3, 0, 0, 0], "not a ProgramData account");
    acc.data[12] = 1;
    acc.data[13..45].copy_from_slice(who.as_ref());
    svm.set_account(addr, acc).unwrap();
}

pub fn config_pda() -> Pubkey {
    Pubkey::find_program_address(&[b"config"], &pid()).0
}
pub fn pool_pda(id: u32) -> Pubkey {
    Pubkey::find_program_address(&[b"pool", &id.to_le_bytes()], &pid()).0
}
pub fn vault_pda(id: u32) -> Pubkey {
    Pubkey::find_program_address(&[b"vault", &id.to_le_bytes()], &pid()).0
}
pub fn series_pda(tier: u8) -> Pubkey {
    Pubkey::find_program_address(&[b"series", &[tier]], &pid()).0
}
pub fn attestation_pda(pool_id: u32, driver: &Pubkey) -> Pubkey {
    let pool = pool_pda(pool_id);
    Pubkey::find_program_address(&[b"attestation", pool.as_ref(), driver.as_ref()], &pid()).0
}
pub fn ride_attestation_pda(pool_id: u32, ride_id: &[u8; 32]) -> Pubkey {
    Pubkey::find_program_address(&[b"ride_attestation", pool_pda(pool_id).as_ref(), ride_id], &pid()).0
}
pub fn receipt_pda(pool_id: u32, sponsor: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[b"sponsor_receipt", pool_pda(pool_id).as_ref(), sponsor.as_ref()], &pid()).0
}
pub fn pledge_pda(ride_id: &[u8; 32], sponsor: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[b"pledge", ride_id, sponsor.as_ref()], &pid()).0
}
pub const HOUR: i64 = 3_600;
pub const DAY: i64 = 86_400;

/// The production 1 h schedule: a 24 h sale window (= one pool a day), rides count 2 h past it, a 48 h review window.
pub fn daily_series(start_at: i64) -> SeriesParams {
    SeriesParams {
        tier: 1,
        enabled: true,
        price_lamports: PRICE,
        min_tickets: 3,
        max_tickets: 0,
        max_per_wallet: 4,
        sale_secs: DAY,
        play_secs: 2 * HOUR,
        verify_secs: 2 * DAY,
        prize_bps: 7000,
        seed_bps: 2000,
        fee_bps: 1000,
        referral_bps: 0,
        start_at,
    }
}

pub fn ticket_pda(id: u32, buyer: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[b"ticket", pool_pda(id).as_ref(), buyer.as_ref()], &pid()).0
}

pub fn ix<D: InstructionData, A: ToAccountMetas>(data: D, accts: A) -> Instruction {
    Instruction::new_with_bytes(pid(), &data.data(), accts.to_account_metas(None))
}

pub fn default_params() -> CreatePoolParams {
    CreatePoolParams {
        tier: 1,
        price_lamports: PRICE,
        min_tickets: 3,
        max_tickets: 10,
        max_per_wallet: 4,
        prep_deadline: PREP,
        play_deadline: PLAY,
        payout_at: PAYOUT,
        prize_bps: 6000,
        seed_bps: 2500,
        fee_bps: 1500,
        referral_bps: 0,
    }
}

pub fn funded(svm: &mut LiteSVM, lamports: u64) -> Keypair {
    let k = Keypair::new();
    svm.airdrop(&k.pubkey(), lamports).unwrap();
    k
}

impl Env {
    /// Program loaded, clock at T0, `initialize` done (platform fee 0).
    pub fn new() -> Env {
        Env::with_platform_fee(0)
    }

    pub fn with_platform_fee(platform_fee_bps: u16) -> Env {
        let mut e = Env::uninitialized(platform_fee_bps);
        let upgrader = clone_kp(&e.authority);
        let admin = e.authority.pubkey();
        e.initialize(&upgrader, admin).unwrap();
        // most tests use short windows (no review: payout_at = play_deadline); the floors have their own tests (Env::with_floors)
        e.set_floors(&upgrader, Some(0), Some(0)).unwrap();
        e
    }

    /// initialized with the production floors (DEFAULT_MIN_REVIEW_SECS / DEFAULT_MIN_FINISH_SECS)
    pub fn with_floors() -> Env {
        let mut e = Env::uninitialized(0);
        let upgrader = clone_kp(&e.authority);
        let admin = e.authority.pubkey();
        e.initialize(&upgrader, admin).unwrap();
        e
    }

    /// Program loaded with `authority` as its upgrade authority (written into ProgramData), clock at T0, no Config yet.
    pub fn uninitialized(platform_fee_bps: u16) -> Env {
        let mut svm = LiteSVM::new();
        let bytes = include_bytes!(concat!(env!("CARGO_TARGET_TMPDIR"), "/../deploy/freightchain_pools.so"));
        assert!(
            bytes.len() > 0x34 && bytes[0x30..0x34] == [0, 0, 0, 0],
            "target/deploy/freightchain_pools.so is not SBPF v0: LiteSVM 0.10 cannot load v3. Run `anchor build --arch v0`"
        );
        svm.add_program(pid(), bytes).unwrap();
        let mut c = svm.get_sysvar::<Clock>();
        c.unix_timestamp = T0;
        svm.set_sysvar(&c);
        let authority = funded(&mut svm, 1_000 * SOL);
        set_upgrade_authority(&mut svm, &authority.pubkey());
        let cranker = funded(&mut svm, 100 * SOL);
        let seed_t = funded(&mut svm, SOL);
        let fee_t = funded(&mut svm, SOL);
        let plat_t = funded(&mut svm, SOL);
        Env { svm, authority, cranker, seed_t, fee_t, plat_t, next_pool: 0, platform_fee_bps, plat_t_start: SOL, winners: HashMap::new() }
    }

    /// `initialize` signed by `upgrader` (must be the program's upgrade authority), naming `admin` as `config.authority`.
    pub fn initialize(&mut self, upgrader: &Keypair, admin: Pubkey) -> Res {
        let i = ix(
            instruction::Initialize { authority: admin, platform_treasury: self.plat_t.pubkey(), platform_fee_bps: self.platform_fee_bps },
            accounts::Initialize {
                upgrade_authority: upgrader.pubkey(),
                program: pid(),
                program_data: programdata_pda(),
                config: config_pda(),
                platform_treasury_account: self.plat_t.pubkey(),
                system_program: system_program::ID,
            },
        );
        let cr = clone_kp(&self.cranker);
        self.send(&[i], &cr, &[upgrader])
    }

    pub fn send(&mut self, ixs: &[Instruction], payer: &Keypair, extra: &[&Keypair]) -> Res {
        self.svm.expire_blockhash();
        let bh = self.svm.latest_blockhash();
        let msg = Message::new_with_blockhash(ixs, Some(&payer.pubkey()), &bh);
        let mut signers: Vec<&dyn Signer> = vec![payer];
        for k in extra {
            if k.pubkey() != payer.pubkey() && !signers.iter().any(|s| s.pubkey() == k.pubkey()) {
                signers.push(*k);
            }
        }
        let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &signers[..]).unwrap();
        self.svm.send_transaction(tx)
    }

    pub fn now(&self) -> i64 {
        self.svm.get_sysvar::<Clock>().unix_timestamp
    }
    pub fn warp(&mut self, ts: i64) {
        let mut c = self.svm.get_sysvar::<Clock>();
        c.unix_timestamp = ts;
        self.svm.set_sysvar(&c);
    }
    pub fn bal(&self, k: &Pubkey) -> u64 {
        self.svm.get_balance(k).unwrap_or(0)
    }
    pub fn rent_min(&self) -> u64 {
        self.svm.minimum_balance_for_rent_exemption(0)
    }

    pub fn pool(&self, id: u32) -> Pool {
        let a = self.svm.get_account(&pool_pda(id)).expect("pool account");
        Pool::try_deserialize(&mut &a.data[..]).unwrap()
    }
    pub fn config(&self) -> Config {
        let a = self.svm.get_account(&config_pda()).expect("config account");
        Config::try_deserialize(&mut &a.data[..]).unwrap()
    }
    pub fn ticket(&self, id: u32, buyer: &Pubkey) -> Option<Ticket> {
        let a = self.svm.get_account(&ticket_pda(id, buyer))?;
        if a.data.is_empty() {
            return None;
        }
        Some(Ticket::try_deserialize(&mut &a.data[..]).unwrap())
    }
    pub fn vault(&self, id: u32) -> u64 {
        self.bal(&vault_pda(id))
    }

    // ---- instruction builders -------------------------------------------------

    pub fn create_pool_ix(&self, p: CreatePoolParams, fee_t: Pubkey, seed_t: Pubkey) -> Instruction {
        let id = self.next_pool;
        ix(
            instruction::CreatePool { params: p },
            accounts::CreatePool {
                authority: self.authority.pubkey(),
                config: config_pda(),
                pool: pool_pda(id),
                vault: vault_pda(id),
                fee_treasury: fee_t,
                seed_treasury: seed_t,
                platform_treasury: self.plat_t.pubkey(),
                system_program: system_program::ID,
            },
        )
    }

    pub fn try_create_pool(&mut self, p: CreatePoolParams) -> Res {
        let i = self.create_pool_ix(p, self.fee_t.pubkey(), self.seed_t.pubkey());
        let (a, c) = (clone_kp(&self.authority), clone_kp(&self.cranker));
        let r = self.send(&[i], &c, &[&a]);
        if r.is_ok() {
            self.next_pool += 1;
        }
        r
    }

    pub fn create_pool(&mut self, p: CreatePoolParams) -> u32 {
        let id = self.next_pool;
        self.try_create_pool(p).unwrap();
        id
    }

    pub fn buy_ix(&self, id: u32, buyer: &Pubkey, fee_payer: &Pubkey, qty: u16) -> Instruction {
        self.buy_ix_order(id, buyer, fee_payer, qty, [7u8; 16])
    }

    pub fn buy_ix_order(&self, id: u32, buyer: &Pubkey, fee_payer: &Pubkey, qty: u16, order_id: [u8; 16]) -> Instruction {
        ix(
            instruction::BuyTicket { pool_id: id, qty, order_id },
            accounts::BuyTicket {
                buyer: *buyer,
                fee_payer: *fee_payer,
                config: config_pda(),
                pool: pool_pda(id),
                vault: vault_pda(id),
                ticket: ticket_pda(id, buyer),
                system_program: system_program::ID,
            },
        )
    }

    /// Self-paid buy (buyer is also the fee payer).
    pub fn buy(&mut self, id: u32, buyer: &Keypair, qty: u16) -> Res {
        let i = self.buy_ix(id, &buyer.pubkey(), &buyer.pubkey(), qty);
        self.send(&[i], buyer, &[])
    }

    /// Gasless-style buy: `sponsor` pays fee + ticket rent, `buyer` signs for the price.
    pub fn buy_sponsored(&mut self, id: u32, buyer: &Keypair, sponsor: &Keypair, qty: u16) -> Res {
        let i = self.buy_ix(id, &buyer.pubkey(), &sponsor.pubkey(), qty);
        self.send(&[i], sponsor, &[buyer])
    }

    pub fn sponsor_ix(&self, id: u32, sponsor: &Pubkey, lamports: u64) -> Instruction {
        ix(
            instruction::Sponsor { pool_id: id, lamports },
            accounts::Sponsor {
                sponsor: *sponsor,
                config: config_pda(),
                pool: pool_pda(id),
                vault: vault_pda(id),
                receipt: receipt_pda(id, sponsor),
                system_program: system_program::ID,
            },
        )
    }

    pub fn fail_ix(&self, id: u32, caller: &Pubkey) -> Instruction {
        ix(instruction::FailPool { pool_id: id }, accounts::FailPool { caller: *caller, pool: pool_pda(id) })
    }

    pub fn fail(&mut self, id: u32) -> Res {
        let c = clone_kp(&self.cranker);
        let i = self.fail_ix(id, &c.pubkey());
        self.send(&[i], &c, &[])
    }

    pub fn cancel(&mut self, id: u32, who: &Keypair) -> Res {
        let i = ix(
            instruction::CancelPool { pool_id: id },
            accounts::CancelPool { authority: who.pubkey(), config: config_pda(), pool: pool_pda(id) },
        );
        let c = clone_kp(&self.cranker);
        self.send(&[i], &c, &[who])
    }

    pub fn refund_ix(&self, id: u32, caller: &Pubkey, buyer: &Pubkey, rent_payer: &Pubkey) -> Instruction {
        ix(
            instruction::Refund { pool_id: id },
            accounts::Refund {
                caller: *caller,
                pool: pool_pda(id),
                vault: vault_pda(id),
                ticket: ticket_pda(id, buyer),
                buyer: *buyer,
                rent_payer: *rent_payer,
                system_program: system_program::ID,
            },
        )
    }

    pub fn refund(&mut self, id: u32, buyer: &Pubkey, rent_payer: &Pubkey) -> Res {
        let c = clone_kp(&self.cranker);
        let i = self.refund_ix(id, &c.pubkey(), buyer, rent_payer);
        self.send(&[i], &c, &[])
    }

    pub fn close_ticket(&mut self, id: u32, buyer: &Pubkey, rent_payer: &Pubkey) -> Res {
        let c = clone_kp(&self.cranker);
        let i = ix(
            instruction::CloseTicket { pool_id: id },
            accounts::CloseTicket {
                caller: c.pubkey(),
                pool: pool_pda(id),
                ticket: ticket_pda(id, buyer),
                rent_payer: *rent_payer,
            },
        );
        self.send(&[i], &c, &[])
    }

    /// `commit_winners` of `list` (rank = index) signed by `who`; the proofs are kept for `pay_rank`.
    pub fn commit_winners(&mut self, id: u32, who: &Keypair, list: &[(Pubkey, u64)]) -> Res {
        let w = winners_of(id, list);
        let r = self.commit_root(id, who, w.root, w.total, list.len() as u8);
        if r.is_ok() {
            self.winners.insert(id, w);
        }
        r
    }

    pub fn commit_root(&mut self, id: u32, who: &Keypair, root: [u8; 32], total: u64, count: u8) -> Res {
        let c = clone_kp(&self.cranker);
        let i = ix(
            instruction::CommitWinners { pool_id: id, root, total, count },
            accounts::CommitWinners { authority: who.pubkey(), config: config_pda(), pool: pool_pda(id) },
        );
        self.send(&[i], &c, &[who])
    }

    pub fn veto_winners(&mut self, id: u32, who: &Keypair) -> Res {
        let c = clone_kp(&self.cranker);
        let i = ix(instruction::VetoWinners { pool_id: id }, accounts::VetoWinners { authority: who.pubkey(), config: config_pda(), pool: pool_pda(id) });
        let r = self.send(&[i], &c, &[who]);
        if r.is_ok() {
            self.winners.remove(&id);
        }
        r
    }

    pub fn pay_prize_ix(&self, id: u32, caller: &Pubkey, rank: u8, to: &Pubkey, lamports: u64, proof: Vec<[u8; 32]>) -> Instruction {
        ix(
            instruction::PayPrize { pool_id: id, rank, lamports, proof },
            accounts::PayPrize { caller: *caller, config: config_pda(), pool: pool_pda(id), vault: vault_pda(id), to: *to, system_program: system_program::ID },
        )
    }

    /// pays rank `rank` of the committed winners (anyone may – the cranker sends it)
    pub fn pay_rank(&mut self, id: u32, rank: u8) -> Res {
        let w = self.winners.get(&id).expect("winners committed").clone();
        let (to, lamports) = w.list[rank as usize];
        self.pay_raw(id, rank, &to, lamports, w.proofs[rank as usize].clone())
    }

    pub fn pay_raw(&mut self, id: u32, rank: u8, to: &Pubkey, lamports: u64, proof: Vec<[u8; 32]>) -> Res {
        let c = clone_kp(&self.cranker);
        let i = self.pay_prize_ix(id, &c.pubkey(), rank, to, lamports, proof);
        self.send(&[i], &c, &[])
    }

    /// commit `list`, wait out the lock (`pool.pay_from`), pay every rank
    pub fn commit_and_pay(&mut self, id: u32, who: &Keypair, list: &[(Pubkey, u64)]) {
        self.commit_winners(id, who, list).unwrap();
        let from = self.pool(id).pay_from;
        if self.now() < from {
            self.warp(from);
        }
        for r in 0..list.len() as u8 {
            self.pay_rank(id, r).unwrap();
        }
    }

    pub fn close_pool(&mut self, id: u32, who: &Keypair) -> Res {
        let c = clone_kp(&self.cranker);
        let p = self.pool(id);
        let i = ix(
            instruction::ClosePool { pool_id: id },
            accounts::ClosePool {
                caller: who.pubkey(),
                pool_authority: p.authority,
                config: config_pda(),
                pool: pool_pda(id),
                vault: vault_pda(id),
                seed_treasury: p.seed_treasury,
                fee_treasury: p.fee_treasury,
                platform_treasury: self.plat_t.pubkey(),
                system_program: system_program::ID,
            },
        );
        self.send(&[i], &c, &[who])
    }

    pub fn expire(&mut self, id: u32, who: &Keypair) -> Res {
        let c = clone_kp(&self.cranker);
        let i = ix(instruction::ExpirePool { pool_id: id }, accounts::ExpirePool { caller: who.pubkey(), pool: pool_pda(id) });
        self.send(&[i], &c, &[who])
    }

    pub fn propose_authority(&mut self, who: &Keypair, new_authority: Pubkey) -> Res {
        let c = clone_kp(&self.cranker);
        let i = ix(
            instruction::ProposeAuthority { new_authority },
            accounts::ProposeAuthority { authority: who.pubkey(), config: config_pda() },
        );
        self.send(&[i], &c, &[who])
    }

    pub fn accept_authority(&mut self, who: &Keypair) -> Res {
        let c = clone_kp(&self.cranker);
        let i = ix(
            instruction::AcceptAuthority {},
            accounts::AcceptAuthority { new_authority: who.pubkey(), config: config_pda() },
        );
        self.send(&[i], &c, &[who])
    }

    pub fn set_config(&mut self, who: &Keypair, paused: Option<bool>, treasury: Option<Pubkey>, bps: Option<u16>) -> Res {
        self.set_config_full(who, paused, treasury, bps, None, None)
    }

    pub fn set_floors(&mut self, who: &Keypair, min_review_secs: Option<i64>, min_finish_secs: Option<i64>) -> Res {
        self.set_config_full(who, None, None, None, min_review_secs, min_finish_secs)
    }

    pub fn set_config_full(
        &mut self,
        who: &Keypair,
        paused: Option<bool>,
        treasury: Option<Pubkey>,
        bps: Option<u16>,
        min_review_secs: Option<i64>,
        min_finish_secs: Option<i64>,
    ) -> Res {
        let c = clone_kp(&self.cranker);
        let new_t = treasury.unwrap_or(self.plat_t.pubkey());
        let i = ix(
            instruction::SetConfig { paused, platform_treasury: treasury, platform_fee_bps: bps, min_review_secs, min_finish_secs },
            accounts::SetConfig { authority: who.pubkey(), config: config_pda(), new_platform_treasury: new_t },
        );
        self.send(&[i], &c, &[who])
    }

    pub fn series(&self, tier: u8) -> Option<Series> {
        let a = self.svm.get_account(&series_pda(tier))?;
        Some(Series::try_deserialize(&mut &a.data[..]).unwrap())
    }

    pub fn set_series_as(&mut self, who: &Keypair, p: SeriesParams, fee_t: Pubkey, seed_t: Pubkey) -> Res {
        let c = clone_kp(&self.cranker);
        let i = ix(
            instruction::SetSeries { params: p.clone() },
            accounts::SetSeries {
                authority: who.pubkey(),
                config: config_pda(),
                series: series_pda(p.tier),
                fee_treasury: fee_t,
                seed_treasury: seed_t,
                platform_treasury: self.plat_t.pubkey(),
                system_program: system_program::ID,
            },
        );
        self.send(&[i], &c, &[who])
    }

    pub fn set_series(&mut self, p: SeriesParams) -> Res {
        let (a, f, s) = (self.authority_kp(), self.fee_t.pubkey(), self.seed_t.pubkey());
        self.set_series_as(&a, p, f, s)
    }

    pub fn open_next_pool_ix(&self, tier: u8, caller: &Pubkey, fee_t: Pubkey, seed_t: Pubkey) -> Instruction {
        let id = self.config().pool_count;
        ix(
            instruction::OpenNextPool { tier },
            accounts::OpenNextPool {
                caller: *caller,
                config: config_pda(),
                series: series_pda(tier),
                pool: pool_pda(id),
                vault: vault_pda(id),
                fee_treasury: fee_t,
                seed_treasury: seed_t,
                platform_treasury: self.plat_t.pubkey(),
                system_program: system_program::ID,
            },
        )
    }

    /// `caller` opens the tier's next pool (it pays the rents). Returns the pool id on success.
    pub fn open_next_pool(&mut self, tier: u8, caller: &Keypair) -> Result<u32, FailedTransactionMetadata> {
        let s = self.series(tier).expect("series");
        let id = self.config().pool_count;
        let i = self.open_next_pool_ix(tier, &caller.pubkey(), s.fee_treasury, s.seed_treasury);
        self.send(&[i], caller, &[])?;
        self.next_pool = id + 1;
        Ok(id)
    }

    pub fn set_payout_authority(&mut self, who: &Keypair, payout: Option<Pubkey>) -> Res {
        let c = clone_kp(&self.cranker);
        let i = ix(
            instruction::SetPayoutAuthority { payout_authority: payout },
            accounts::SetPayoutAuthority { authority: who.pubkey(), config: config_pda() },
        );
        self.send(&[i], &c, &[who])
    }

    pub fn authority_kp(&self) -> Keypair {
        clone_kp(&self.authority)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn record_ride_attestation(
        &mut self,
        id: u32,
        who: &Keypair,
        ride_id: [u8; 32],
        driver: &Pubkey,
        telemetry_root: [u8; 32],
        verified_km: u32,
        status: u8,
    ) -> Res {
        let c = clone_kp(&self.cranker);
        let i = ix(
            instruction::RecordRideAttestation { pool_id: id, ride_id, driver: *driver, telemetry_root, verified_km, status },
            accounts::RecordRideAttestation {
                authority: who.pubkey(),
                config: config_pda(),
                pool: pool_pda(id),
                ride_attestation: ride_attestation_pda(id, &ride_id),
                system_program: system_program::ID,
            },
        );
        self.send(&[i], &c, &[who])
    }

    pub fn record_verified_ride(&mut self, id: u32, who: &Keypair, ride_id: [u8; 32], driver: &Pubkey, km: u32) -> Res {
        self.record_ride_attestation(id, who, ride_id, driver, [1u8; 32], km, freightchain_pools::constants::ATTESTATION_STATUS_VERIFIED)
    }

    pub fn create_pledge(
        &mut self,
        pool_id: u32,
        ride_id: [u8; 32],
        driver: &Pubkey,
        sponsor: &Keypair,
        max_lamports: u64,
        lamports_per_km: u64,
        target_km: u32,
    ) -> Res {
        let i = ix(
            instruction::CreatePledge {
                ride_id,
                driver: *driver,
                max_lamports,
                lamports_per_km,
                target_km,
            },
            accounts::CreatePledge {
                sponsor: sponsor.pubkey(),
                driver: *driver,
                config: config_pda(),
                pool: pool_pda(pool_id),
                pledge: pledge_pda(&ride_id, &sponsor.pubkey()),
                system_program: system_program::ID,
            },
        );
        self.send(&[i], sponsor, &[])
    }

    pub fn settle_pledge(
        &mut self,
        pool_id: u32,
        ride_id: [u8; 32],
        caller: &Keypair,
        driver: &Pubkey,
        sponsor: &Pubkey,
    ) -> Res {
        let i = ix(
            instruction::SettlePledge { ride_id },
            accounts::SettlePledge {
                caller: caller.pubkey(),
                driver: *driver,
                sponsor: *sponsor,
                config: config_pda(),
                pool: pool_pda(pool_id),
                ride_attestation: ride_attestation_pda(pool_id, &ride_id),
                pledge: pledge_pda(&ride_id, sponsor),
                system_program: system_program::ID,
            },
        );
        self.send(&[i], caller, &[])
    }

    pub fn refund_pledge(
        &mut self,
        pool_id: u32,
        ride_id: [u8; 32],
        caller: &Keypair,
        _driver: &Pubkey,
        sponsor: &Pubkey,
    ) -> Res {
        let i = ix(
            instruction::RefundPledge { ride_id },
            accounts::RefundPledge {
                caller: caller.pubkey(),
                sponsor: *sponsor,
                pool: pool_pda(pool_id),
                ride_attestation: ride_attestation_pda(pool_id, &ride_id),
                pledge: pledge_pda(&ride_id, sponsor),
            },
        );
        self.send(&[i], caller, &[])
    }

    pub fn attestation(&self, pool_id: u32, driver: &Pubkey) -> Option<Attestation> {
        let a = self.svm.get_account(&attestation_pda(pool_id, driver))?;
        if a.data.is_empty() {
            return None;
        }
        Some(Attestation::try_deserialize(&mut &a.data[..]).unwrap())
    }

    pub fn pledge(&self, ride_id: &[u8; 32], sponsor: &Pubkey) -> Option<Pledge> {
        let a = self.svm.get_account(&pledge_pda(ride_id, sponsor))?;
        if a.data.is_empty() {
            return None;
        }
        Some(Pledge::try_deserialize(&mut &a.data[..]).unwrap())
    }

    pub fn ride_attestation(&self, pool_id: u32, ride_id: &[u8; 32]) -> Option<RideAttestation> {
        let a = self.svm.get_account(&ride_attestation_pda(pool_id, ride_id))?;
        if a.data.is_empty() {
            return None;
        }
        Some(RideAttestation::try_deserialize(&mut &a.data[..]).unwrap())
    }

    pub fn receipt(&self, pool_id: u32, sponsor: &Pubkey) -> Option<SponsorReceipt> {
        let a = self.svm.get_account(&receipt_pda(pool_id, sponsor))?;
        if a.data.is_empty() {
            return None;
        }
        Some(SponsorReceipt::try_deserialize(&mut &a.data[..]).unwrap())
    }

    /// a v3 per-driver Attestation written straight into the account (v4 cannot record one any more) – for `close_attestation`
    pub fn set_legacy_attestation(&mut self, pool_id: u32, driver: &Pubkey, verified_km: u32, status: u8) {
        let pda = attestation_pda(pool_id, driver);
        self.svm.airdrop(&pda, 10_000_000).unwrap();
        let mut acc = self.svm.get_account(&pda).unwrap();
        let mut data = Attestation::DISCRIMINATOR.to_vec();
        let att = Attestation {
            pool: pool_pda(pool_id),
            driver: *driver,
            telemetry_root: [1u8; 32],
            verified_km,
            status,
            recorded_at: T0,
            bump: Pubkey::find_program_address(&[b"attestation", pool_pda(pool_id).as_ref(), driver.as_ref()], &pid()).1,
        };
        anchor_lang::AnchorSerialize::serialize(&att, &mut data).unwrap();
        acc.data = data;
        acc.owner = pid();
        self.svm.set_account(pda, acc).unwrap();
    }

    pub fn close_attestation(&mut self, pool_id: u32, driver: &Pubkey, rent_to: &Pubkey) -> Res {
        let c = clone_kp(&self.cranker);
        let i = ix(
            instruction::CloseAttestation { pool_id, driver: *driver },
            accounts::CloseAttestation { caller: c.pubkey(), config: config_pda(), pool: pool_pda(pool_id), attestation: attestation_pda(pool_id, driver), rent_to: *rent_to },
        );
        self.send(&[i], &c, &[])
    }

    pub fn close_ride_attestation(&mut self, pool_id: u32, ride_id: [u8; 32], rent_payer: &Pubkey) -> Res {
        let c = clone_kp(&self.cranker);
        let i = ix(
            instruction::CloseRideAttestation { pool_id, ride_id },
            accounts::CloseRideAttestation {
                caller: c.pubkey(),
                pool: pool_pda(pool_id),
                ride_attestation: ride_attestation_pda(pool_id, &ride_id),
                rent_payer: *rent_payer,
            },
        );
        self.send(&[i], &c, &[])
    }

    pub fn refund_sponsor(&mut self, pool_id: u32, sponsor: &Pubkey) -> Res {
        let c = clone_kp(&self.cranker);
        let i = ix(
            instruction::RefundSponsor { pool_id },
            accounts::RefundSponsor {
                caller: c.pubkey(),
                pool: pool_pda(pool_id),
                vault: vault_pda(pool_id),
                receipt: receipt_pda(pool_id, sponsor),
                sponsor: *sponsor,
                system_program: system_program::ID,
            },
        );
        self.send(&[i], &c, &[])
    }

    pub fn close_sponsor_receipt(&mut self, pool_id: u32, sponsor: &Pubkey) -> Res {
        let c = clone_kp(&self.cranker);
        let i = ix(
            instruction::CloseSponsorReceipt { pool_id },
            accounts::CloseSponsorReceipt { caller: c.pubkey(), pool: pool_pda(pool_id), receipt: receipt_pda(pool_id, sponsor), sponsor: *sponsor },
        );
        self.send(&[i], &c, &[])
    }

    /// the clock's slot (unix time unchanged)
    pub fn set_slot(&mut self, slot: u64) {
        let mut c = self.svm.get_sysvar::<Clock>();
        c.slot = slot;
        self.svm.set_sysvar(&c);
    }

    /// the SlotHashes sysvar's entries, newest first, written raw (u64 count, then (u64 slot, [u8; 32] hash))
    pub fn set_slot_hashes(&mut self, entries: &[(u64, [u8; 32])]) {
        let mut data = (entries.len() as u64).to_le_bytes().to_vec();
        for (slot, hash) in entries {
            data.extend_from_slice(&slot.to_le_bytes());
            data.extend_from_slice(hash);
        }
        let mut acc = self.svm.get_account(&SLOT_HASHES_ID).unwrap_or_default();
        acc.data = data;
        acc.owner = Pubkey::from_str_const("Sysvar1111111111111111111111111111111111111");
        acc.lamports = acc.lamports.max(1_000_000_000);
        self.svm.set_account(SLOT_HASHES_ID, acc).unwrap();
    }

    pub fn seal_road_ix(&self, id: u32, caller: &Pubkey) -> Instruction {
        ix(instruction::SealRoad { pool_id: id }, accounts::SealRoad { caller: *caller, pool: pool_pda(id), slot_hashes: SLOT_HASHES_ID })
    }

    pub fn seal_road(&mut self, id: u32) -> Res {
        let c = clone_kp(&self.cranker);
        let i = self.seal_road_ix(id, &c.pubkey());
        self.send(&[i], &c, &[])
    }

    pub fn migrate_config(&mut self, who: &Keypair) -> Res {
        let c = clone_kp(&self.cranker);
        let i = ix(instruction::MigrateConfigV4 {}, accounts::MigrateConfigV4 { authority: who.pubkey(), config: config_pda(), system_program: system_program::ID });
        self.send(&[i], &c, &[who])
    }
}

pub fn clone_kp(k: &Keypair) -> Keypair {
    Keypair::try_from(&k.to_bytes()[..]).unwrap()
}

// ---- events -----------------------------------------------------------------

/// All `Program data:` lines of a transaction as raw bytes (discriminator + borsh).
pub fn program_data(logs: &[String]) -> Vec<Vec<u8>> {
    logs.iter()
        .filter_map(|l| l.strip_prefix("Program data: "))
        .map(|b| base64::engine::general_purpose::STANDARD.decode(b.trim()).unwrap())
        .collect()
}

/// Decode every event of type `E` found in the logs (matched by the 8-byte discriminator).
pub fn events<E: Event + AnchorDeserialize + Discriminator>(logs: &[String]) -> Vec<E> {
    program_data(logs)
        .into_iter()
        .filter(|d| d.len() >= 8 && d[..8] == *E::DISCRIMINATOR)
        .map(|d| E::deserialize(&mut &d[8..]).unwrap())
        .collect()
}

pub struct Rng(pub u64);
impl Rng {
    pub fn next(&mut self) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0
    }
    pub fn range(&mut self, lo: u64, hi_incl: u64) -> u64 {
        lo + self.next() % (hi_incl - lo + 1)
    }
}

/// Shift a pool's deadlines to be relative to the current (possibly warped) clock.
pub fn later(e: &Env, mut p: CreatePoolParams) -> CreatePoolParams {
    let now = e.now();
    p.prep_deadline = now + 1_000;
    p.play_deadline = now + 5_000;
    p.payout_at = now + 5_000;
    p
}
