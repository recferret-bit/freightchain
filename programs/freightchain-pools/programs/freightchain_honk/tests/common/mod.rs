#![allow(dead_code)]
//! LiteSVM harness. The program `.so` is the v0 build in `target/deploy`.

use {
    anchor_lang::{
        prelude::{pubkey, Clock, Pubkey},
        solana_program::{instruction::Instruction, system_program},
        AccountDeserialize, AnchorDeserialize, Discriminator, Event, InstructionData,
        ToAccountMetas,
    },
    anchor_spl::{
        associated_token::{self, get_associated_token_address},
        token::{self, Mint, TokenAccount},
    },
    base64::Engine,
    freightchain_honk::{accounts, instruction},
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
pub const UNIT: u64 = freightchain_honk::UNIT;
pub const GENESIS: u64 = freightchain_honk::GENESIS;

pub fn code(e: freightchain_honk::error::HonkError) -> u32 {
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

pub fn pid() -> Pubkey {
    freightchain_honk::id()
}
pub fn config_pda() -> Pubkey {
    Pubkey::find_program_address(&[b"config"], &pid()).0
}
pub fn authority_pda() -> Pubkey {
    Pubkey::find_program_address(&[b"authority"], &pid()).0
}
pub fn honk_mint_pda() -> Pubkey {
    Pubkey::find_program_address(&[b"honk-mint"], &pid()).0
}
pub fn vault_pda() -> Pubkey {
    Pubkey::find_program_address(&[b"vault"], &pid()).0
}
pub fn pool_pda() -> Pubkey {
    Pubkey::find_program_address(&[b"pool"], &pid()).0
}
pub fn lp_mint_pda() -> Pubkey {
    Pubkey::find_program_address(&[b"lp-mint"], &pid()).0
}
pub fn lp_locker_pda() -> Pubkey {
    Pubkey::find_program_address(&[b"lp-locker"], &pid()).0
}
pub fn locker_pda() -> Pubkey {
    Pubkey::find_program_address(&[b"locker"], &pid()).0
}
pub fn ride_mint_pda(ride_id: &[u8; 16]) -> Pubkey {
    Pubkey::find_program_address(&[b"ride-mint", ride_id.as_ref()], &pid()).0
}
pub fn part_pda(buyer: &Pubkey, slot: &[u8; 16], item: &[u8; 16]) -> Pubkey {
    Pubkey::find_program_address(
        &[b"part", buyer.as_ref(), slot.as_ref(), item.as_ref()],
        &pid(),
    )
    .0
}
pub fn ata(owner: &Pubkey, mint: &Pubkey) -> Pubkey {
    get_associated_token_address(owner, mint)
}

pub fn ix<D: InstructionData, A: ToAccountMetas>(data: D, accts: A) -> Instruction {
    Instruction::new_with_bytes(pid(), &data.data(), accts.to_account_metas(None))
}

pub fn funded(svm: &mut LiteSVM, lamports: u64) -> Keypair {
    let k = Keypair::new();
    svm.airdrop(&k.pubkey(), lamports).unwrap();
    k
}

pub fn clone_kp(k: &Keypair) -> Keypair {
    Keypair::try_from(&k.to_bytes()[..]).unwrap()
}

pub fn unwrap_tx(res: Res) -> TransactionMetadata {
    match res {
        Ok(m) => m,
        Err(e) => panic!("tx failed: {:?}\nlogs:\n{}", e.err, e.meta.logs.join("\n")),
    }
}

/// Transaction-wide CU. Initialize opens several token accounts.
fn cu_limit() -> Instruction {
    let mut data = vec![2u8];
    data.extend_from_slice(&1_400_000u32.to_le_bytes());
    Instruction::new_with_bytes(
        pubkey!("ComputeBudget111111111111111111111111111111"),
        &data,
        vec![],
    )
}

pub struct Env {
    pub svm: LiteSVM,
    pub payer: Keypair,
}

impl Env {
    pub fn bare() -> Env {
        let mut svm = LiteSVM::new();
        let bytes = include_bytes!(concat!(
            env!("CARGO_TARGET_TMPDIR"),
            "/../deploy/freightchain_honk.so"
        ));
        assert!(
            bytes.len() > 0x34 && bytes[0x30..0x34] == [0, 0, 0, 0],
            "target/deploy/freightchain_honk.so is not SBPF v0: LiteSVM 0.10 cannot load v3. Run `anchor build --arch v0`"
        );
        svm.add_program(pid(), bytes).unwrap();
        let mut c = svm.get_sysvar::<Clock>();
        c.unix_timestamp = T0;
        svm.set_sysvar(&c);
        let payer = funded(&mut svm, 1_000 * SOL);
        Env { svm, payer }
    }

    pub fn new() -> Env {
        let mut e = Env::bare();
        unwrap_tx(e.initialize(10 * SOL));
        e
    }

    pub fn payer(&self) -> Keypair {
        clone_kp(&self.payer)
    }

    pub fn send(&mut self, ixs: &[Instruction], payer: &Keypair, extra: &[&Keypair]) -> Res {
        self.svm.expire_blockhash();
        let bh = self.svm.latest_blockhash();
        let mut all = vec![cu_limit()];
        all.extend_from_slice(ixs);
        let msg = Message::new_with_blockhash(&all, Some(&payer.pubkey()), &bh);
        let mut signers: Vec<&dyn Signer> = vec![payer];
        for k in extra {
            if k.pubkey() != payer.pubkey() && !signers.iter().any(|s| s.pubkey() == k.pubkey()) {
                signers.push(*k);
            }
        }
        let tx =
            VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &signers[..]).unwrap();
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
    pub fn pool(&self) -> freightchain_honk::Pool {
        let a = self.svm.get_account(&pool_pda()).expect("pool");
        freightchain_honk::Pool::try_deserialize(&mut &a.data[..]).unwrap()
    }
    pub fn mint(&self, k: &Pubkey) -> Mint {
        let a = self.svm.get_account(k).expect("mint");
        Mint::try_deserialize(&mut &a.data[..]).unwrap()
    }
    pub fn token(&self, k: &Pubkey) -> TokenAccount {
        let a = self.svm.get_account(k).expect("token");
        TokenAccount::try_deserialize(&mut &a.data[..]).unwrap()
    }
    pub fn amount(&self, k: &Pubkey) -> u64 {
        self.token(k).amount
    }

    pub fn initialize(&mut self, sol_in: u64) -> Res {
        let payer = self.payer();
        let i = ix(
            instruction::Initialize { sol_in },
            accounts::Initialize {
                payer: payer.pubkey(),
                config: config_pda(),
                honk_mint: honk_mint_pda(),
                authority: authority_pda(),
                vault: vault_pda(),
                pool: pool_pda(),
                lp_mint: lp_mint_pda(),
                lp_locker: lp_locker_pda(),
                locker: locker_pda(),
                token_program: token::ID,
                system_program: system_program::ID,
            },
        );
        self.send(&[i], &payer, &[])
    }

    pub fn swap(&mut self, sol_in: u64, min_out: u64) -> Res {
        let user = self.payer();
        let i = ix(
            instruction::SwapSolForHonk { sol_in, min_out },
            accounts::SwapSolForHonk {
                user: user.pubkey(),
                pool: pool_pda(),
                honk_mint: honk_mint_pda(),
                vault: vault_pda(),
                user_honk: ata(&user.pubkey(), &honk_mint_pda()),
                token_program: token::ID,
                system_program: system_program::ID,
                associated_token_program: associated_token::ID,
            },
        );
        self.send(&[i], &user, &[])
    }

    pub fn sell(&mut self, honk_in: u64, min_sol_out: u64) -> Res {
        let user = self.payer();
        let i = ix(
            instruction::SwapHonkForSol {
                honk_in,
                min_sol_out,
            },
            accounts::SwapHonkForSol {
                user: user.pubkey(),
                pool: pool_pda(),
                honk_mint: honk_mint_pda(),
                vault: vault_pda(),
                user_honk: ata(&user.pubkey(), &honk_mint_pda()),
                token_program: token::ID,
            },
        );
        self.send(&[i], &user, &[])
    }

    pub fn withdraw(&mut self, lp_in: u64, min_honk: u64, min_sol: u64) -> Res {
        let user = self.payer();
        let i = ix(
            instruction::WithdrawLp {
                lp_in,
                min_honk,
                min_sol,
            },
            accounts::WithdrawLp {
                user: user.pubkey(),
                pool: pool_pda(),
                honk_mint: honk_mint_pda(),
                vault: vault_pda(),
                user_honk: ata(&user.pubkey(), &honk_mint_pda()),
                lp_mint: lp_mint_pda(),
                user_lp: ata(&user.pubkey(), &lp_mint_pda()),
                token_program: token::ID,
                system_program: system_program::ID,
                associated_token_program: associated_token::ID,
            },
        );
        self.send(&[i], &user, &[])
    }

    pub fn mint_ride(&mut self, ride_id: [u8; 16], amount: u64, rider: &Pubkey) -> Res {
        let emitter = self.payer();
        let i = ix(
            instruction::MintRide { ride_id, amount },
            accounts::MintRide {
                emitter: emitter.pubkey(),
                config: config_pda(),
                honk_mint: honk_mint_pda(),
                authority: authority_pda(),
                rider: *rider,
                rider_honk: ata(rider, &honk_mint_pda()),
                ride_mint: ride_mint_pda(&ride_id),
                token_program: token::ID,
                system_program: system_program::ID,
                associated_token_program: associated_token::ID,
            },
        );
        self.send(&[i], &emitter, &[])
    }

    pub fn burn(&mut self, amount: u64) -> Res {
        let user = self.payer();
        let i = ix(
            instruction::Burn { amount },
            accounts::Burn {
                user: user.pubkey(),
                honk_mint: honk_mint_pda(),
                user_honk: ata(&user.pubkey(), &honk_mint_pda()),
                token_program: token::ID,
            },
        );
        self.send(&[i], &user, &[])
    }

    /// Returns the new NFT mint. A fresh keypair each call, so a repeat buy fails in the program, not on the mint account.
    pub fn try_buy(&mut self, slot: [u8; 16], item: [u8; 16]) -> (Pubkey, Res) {
        let buyer = self.payer();
        let nft = Keypair::new();
        let nft_mint = nft.pubkey();
        let i = ix(
            instruction::BuyPart { slot, item },
            accounts::BuyPart {
                buyer: buyer.pubkey(),
                honk_mint: honk_mint_pda(),
                buyer_honk: ata(&buyer.pubkey(), &honk_mint_pda()),
                authority: authority_pda(),
                nft_mint,
                nft_ata: ata(&buyer.pubkey(), &nft_mint),
                part: part_pda(&buyer.pubkey(), &slot, &item),
                token_program: token::ID,
                system_program: system_program::ID,
                associated_token_program: associated_token::ID,
            },
        );
        let res = self.send(&[i], &buyer, &[&nft]);
        (nft_mint, res)
    }

    pub fn part(
        &self,
        buyer: &Pubkey,
        slot: &[u8; 16],
        item: &[u8; 16],
    ) -> freightchain_honk::Part {
        let a = self
            .svm
            .get_account(&part_pda(buyer, slot, item))
            .expect("part");
        freightchain_honk::Part::try_deserialize(&mut &a.data[..]).unwrap()
    }

    pub fn release_lp(&mut self) -> Res {
        let recipient = self.payer();
        let i = ix(
            instruction::ReleaseLp {},
            accounts::ReleaseLp {
                recipient: recipient.pubkey(),
                pool: pool_pda(),
                lp_mint: lp_mint_pda(),
                lp_locker: lp_locker_pda(),
                locker: locker_pda(),
                recipient_lp: ata(&recipient.pubkey(), &lp_mint_pda()),
                token_program: token::ID,
                associated_token_program: associated_token::ID,
                system_program: system_program::ID,
            },
        );
        self.send(&[i], &recipient, &[])
    }
}

pub fn program_data(logs: &[String]) -> Vec<Vec<u8>> {
    logs.iter()
        .filter_map(|l| l.strip_prefix("Program data: "))
        .map(|b| {
            base64::engine::general_purpose::STANDARD
                .decode(b.trim())
                .unwrap()
        })
        .collect()
}

pub fn events<E: Event + AnchorDeserialize + Discriminator>(logs: &[String]) -> Vec<E> {
    program_data(logs)
        .into_iter()
        .filter(|d| d.len() >= 8 && d[..8] == *E::DISCRIMINATOR)
        .map(|d| E::deserialize(&mut &d[8..]).unwrap())
        .collect()
}
