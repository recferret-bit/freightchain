#![allow(dead_code)]
//! LiteSVM harness shared by the test files.

use {
    anchor_lang::{
        prelude::{Clock, Pubkey},
        solana_program::{instruction::Instruction, system_program},
        AccountDeserialize, AnchorDeserialize, Discriminator, Event, InstructionData, ToAccountMetas,
    },
    base64::Engine,
    freightchain_pools::{accounts, instruction, Config, CreatePoolParams, Pool, Ticket},
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

pub struct Env {
    pub svm: LiteSVM,
    pub authority: Keypair,
    pub cranker: Keypair,
    pub seed_t: Keypair,
    pub fee_t: Keypair,
    pub plat_t: Keypair,
    pub next_pool: u32,
    pub platform_fee_bps: u16,
}

pub fn pid() -> Pubkey {
    freightchain_pools::id()
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
        prize_bps: 6000,
        seed_bps: 2500,
        fee_bps: 1500,
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
        let cranker = funded(&mut svm, 100 * SOL);
        let seed_t = funded(&mut svm, SOL);
        let fee_t = funded(&mut svm, SOL);
        let plat_t = funded(&mut svm, SOL);
        let mut e = Env { svm, authority, cranker, seed_t, fee_t, plat_t, next_pool: 0, platform_fee_bps };
        let i = ix(
            instruction::Initialize { platform_treasury: e.plat_t.pubkey(), platform_fee_bps },
            accounts::Initialize {
                authority: e.authority.pubkey(),
                config: config_pda(),
                platform_treasury_account: e.plat_t.pubkey(),
                system_program: system_program::ID,
            },
        );
        let (a, cr) = (clone_kp(&e.authority), clone_kp(&e.cranker));
        e.send(&[i], &cr, &[&a]).unwrap();
        e
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
            accounts::CancelPool { authority: who.pubkey(), pool: pool_pda(id) },
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

    pub fn pay_prize(&mut self, id: u32, who: &Keypair, to: &Pubkey, lamports: u64, rank: u8) -> Res {
        let c = clone_kp(&self.cranker);
        let i = ix(
            instruction::PayPrize { pool_id: id, lamports, rank },
            accounts::PayPrize {
                authority: who.pubkey(),
                pool: pool_pda(id),
                vault: vault_pda(id),
                to: *to,
                system_program: system_program::ID,
            },
        );
        self.send(&[i], &c, &[who])
    }

    pub fn close_pool(&mut self, id: u32, who: &Keypair) -> Res {
        let c = clone_kp(&self.cranker);
        let p = self.pool(id);
        let i = ix(
            instruction::ClosePool { pool_id: id },
            accounts::ClosePool {
                authority: who.pubkey(),
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

    pub fn set_config(&mut self, who: &Keypair, paused: Option<bool>, treasury: Option<Pubkey>, bps: Option<u16>) -> Res {
        let c = clone_kp(&self.cranker);
        let new_t = treasury.unwrap_or(self.plat_t.pubkey());
        let i = ix(
            instruction::SetConfig { paused, platform_treasury: treasury, platform_fee_bps: bps },
            accounts::SetConfig { authority: who.pubkey(), config: config_pda(), new_platform_treasury: new_t },
        );
        self.send(&[i], &c, &[who])
    }

    pub fn authority_kp(&self) -> Keypair {
        clone_kp(&self.authority)
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
    p
}
