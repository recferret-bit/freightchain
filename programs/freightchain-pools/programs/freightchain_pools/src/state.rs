use anchor_lang::prelude::*;

use crate::{constants::*, error::PoolError};

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub authority: Pubkey,
    pub platform_treasury: Pubkey,
    /// Share of the FEE share (not of the pool) that goes to `platform_treasury` at close.
    pub platform_fee_bps: u16,
    pub pool_count: u32,
    pub paused: bool,
    pub bump: u8,
    /// Two-step authority handover: set by `propose_authority`, consumed by `accept_authority`.
    pub pending_authority: Option<Pubkey>,
    /// Commits a pool's winners root, records ride attestations and closes a pool once its prizes are paid (the server's payout key) – nothing
    /// else; a root it commits is public for the whole review lock and the cold admin can veto it. None = only `authority`.
    pub payout_authority: Option<Pubkey>,
    /// v4: the review window every new pool keeps after its play deadline, and the lock between a winners root's commit (or a ride attestation)
    /// and the first payment on it (DEFAULT_MIN_REVIEW_SECS; set by the cold admin only).
    pub min_review_secs: i64,
    /// v4: the play window every new pool keeps after its sale (no sale, no new ride after it – the shifts on the road finish) (DEFAULT_MIN_FINISH_SECS).
    pub min_finish_secs: i64,
}

/// One schedule per tier, written by the admin (`set_series`): every pool `open_next_pool` creates takes these rules. Pools tile time:
/// the next one opens when this one stops selling (`next_open_at`), so a 24 h sale window = one pool a day.
#[account]
#[derive(InitSpace)]
pub struct Series {
    pub tier: u8,
    pub enabled: bool,
    pub price_lamports: u64,
    pub min_tickets: u32,
    /// 0 = unlimited
    pub max_tickets: u32,
    pub max_per_wallet: u16,
    /// sale window = cadence (seconds)
    pub sale_secs: i64,
    /// after the sale ends, rides of the pool still count this long
    pub play_secs: i64,
    /// after the play deadline: the review window before any prize is paid
    pub verify_secs: i64,
    pub prize_bps: u16,
    pub seed_bps: u16,
    pub fee_bps: u16,
    pub fee_treasury: Pubkey,
    pub seed_treasury: Pubkey,
    /// the start of the next sale slot; `open_next_pool` is refused before it
    pub next_open_at: i64,
    pub pools_opened: u32,
    pub last_pool_id: Option<u32>,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Pool {
    pub pool_id: u32,
    /// Creator record (receives the vault rent minimum at close). Admin rights come from `Config.authority`.
    pub authority: Pubkey,
    pub tier: u8,
    pub price_lamports: u64,
    pub min_tickets: u32,
    /// 0 = unlimited
    pub max_tickets: u32,
    pub max_per_wallet: u16,
    pub prep_deadline: i64,
    pub play_deadline: i64,
    /// end of the review window: no prize is paid and the pool is not closed before it
    pub payout_at: i64,
    pub prize_bps: u16,
    pub seed_bps: u16,
    pub fee_bps: u16,
    pub fee_treasury: Pubkey,
    pub seed_treasury: Pubkey,
    pub status: u8,
    pub tickets_sold: u32,
    pub buyers: u32,
    pub sponsored: u64,
    pub prizes_paid: u64,
    pub refunded: u64,
    pub created_at: i64,
    pub bump: u8,
    pub vault_bump: u8,
    /// v3: SHA256(pool_id LE u32 || blockhash || slot LE u64) of a recent block, fixed when the pool opens; the pool's road seed is
    /// derived from it, so the operator could not have picked the road after seeing it. All zero for a `create_pool` pool given none.
    pub seed_commitment: [u8; 32],
    /// the SlotHashes entry the commitment was made from (create_pool.rs seed_commitment_of)
    pub seed_slot: u64,
    pub seed_slot_hash: [u8; 32],
    /// v4 (L4): the slot whose hash seals the road (`seal_road`); 0 once sealed – until then `seed_commitment` is all zero and no ride is served
    pub seal_slot: u64,
    /// v4 (L8): `Config.platform_fee_bps` when the pool opened – the cut at close is the one the buyers were shown
    pub platform_fee_bps: u16,
    /// v4 (H5-B): the committed winners – a Merkle root over (rank, wallet, lamports), the sum, the count, when, and the first moment it pays
    pub winners_root: [u8; 32],
    pub winners_total: u64,
    pub winners_count: u8,
    pub committed_at: i64,
    pub pay_from: i64,
    /// bit r = rank r paid
    pub paid_mask: u64,
    /// v4 (M8): sponsorship refunded to sponsors after a failure
    pub sponsor_refunded: u64,
    /// v4 (L7): pledges on this pool not yet settled or refunded – attestations close only at 0
    pub open_pledges: u32,
}

#[account]
#[derive(InitSpace)]
pub struct Ticket {
    pub buyer: Pubkey,
    pub rent_payer: Pubkey,
    pub pool_id: u32,
    pub qty: u16,
    pub lamports: u64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Attestation {
    pub pool: Pubkey,
    pub driver: Pubkey,
    pub telemetry_root: [u8; 32],
    pub verified_km: u32,
    pub status: u8,
    pub recorded_at: i64,
    pub bump: u8,
}

/// v4 (pentest H4): the server's verdict on ONE ride, written by the payout key – a pledge on that ride settles on it (`verified_km`), and only from
/// `settle_from` (the review lock: every RideAttestationRecorded is public that long first). Final once a pledge was settled on it.
#[account]
#[derive(InitSpace)]
pub struct RideAttestation {
    pub pool: Pubkey,
    pub ride_id: [u8; 32],
    pub driver: Pubkey,
    pub telemetry_root: [u8; 32],
    pub verified_km: u32,
    pub status: u8,
    pub recorded_at: i64,
    pub settle_from: i64,
    pub settled_pledges: u32,
    pub rent_payer: Pubkey,
    pub bump: u8,
}

/// v4 (pentest M8): what `sponsor` put into a pool – `refund_sponsor` pays it back if the pool fails.
#[account]
#[derive(InitSpace)]
pub struct SponsorReceipt {
    pub pool: Pubkey,
    pub sponsor: Pubkey,
    pub lamports: u64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Pledge {
    pub ride_id: [u8; 32],
    pub sponsor: Pubkey,
    pub driver: Pubkey,
    pub pool: Pubkey,
    pub max_lamports: u64,
    pub lamports_per_km: u64,
    pub target_km: u32,
    pub settled: bool,
    pub earned_lamports: u64,
    pub refunded_lamports: u64,
    pub created_at: i64,
    pub bump: u8,
}

/// floor(amount * bps / 10000), u128 inside.
pub fn bps_of(amount: u64, bps: u16) -> Result<u64> {
    let v = (amount as u128)
        .checked_mul(bps as u128)
        .ok_or(PoolError::MathOverflow)?
        / BPS_DENOM as u128;
    u64::try_from(v).map_err(|_| PoolError::MathOverflow.into())
}

/// (prize, seed, fee): prize and seed are floored shares of `total`, the fee takes the remainder.
pub fn split(total: u64, prize_bps: u16, seed_bps: u16) -> Result<(u64, u64, u64)> {
    let prize = bps_of(total, prize_bps)?;
    let seed = bps_of(total, seed_bps)?;
    let fee = total
        .checked_sub(prize)
        .and_then(|v| v.checked_sub(seed))
        .ok_or(PoolError::MathOverflow)?;
    Ok((prize, seed, fee))
}

/// v4: a v3 Config with a key unset still DEcodes (borsh reads the floors from its zero padding as 0) – so every step that relies on a floor refuses
/// it until `migrate_config_v4` has run, instead of working without the floors.
pub fn require_migrated(config: &Account<Config>) -> Result<()> {
    require!(config.to_account_info().data_len() >= 8 + Config::INIT_SPACE, PoolError::ConfigNotMigrated);
    Ok(())
}

impl Config {
    /// The keys that may commit winners, record ride attestations and close an Active pool: the admin and, when set, the payout key.
    pub fn may_settle(&self, key: &Pubkey) -> bool {
        *key == self.authority || self.payout_authority.as_ref() == Some(key)
    }

    /// `paused` stops a pool's settlement steps only before its settle grace ends: afterwards no admin is needed, so no admin can freeze it (pentest H5 d).
    pub fn paused_before_grace(&self, pool: &Pool, now: i64) -> Result<bool> {
        Ok(self.paused && now < pool.grace_end()?)
    }

    /// When a root committed (or a ride attestation recorded) at `at` first pays: never before `payout_at`, and never before the review lock.
    pub fn pay_from(&self, pool: &Pool, at: i64) -> Result<i64> {
        let window = pool.payout_at.checked_sub(pool.play_deadline).ok_or(PoolError::MathOverflow)?;
        let lock = window.max(self.min_review_secs);
        Ok(at.checked_add(lock).ok_or(PoolError::MathOverflow)?.max(pool.payout_at))
    }
}

impl Pool {
    /// Total ticket money ever paid in (price is immutable, so it is derivable).
    pub fn tickets_lamports(&self) -> Result<u64> {
        let v = (self.price_lamports as u128)
            .checked_mul(self.tickets_sold as u128)
            .ok_or(PoolError::MathOverflow)?;
        u64::try_from(v).map_err(|_| PoolError::MathOverflow.into())
    }

    /// Money the split is computed on: tickets + sponsorship.
    pub fn pot(&self) -> Result<u64> {
        self.tickets_lamports()?
            .checked_add(self.sponsored)
            .ok_or_else(|| PoolError::MathOverflow.into())
    }

    pub fn prize_share(&self) -> Result<u64> {
        Ok(split(self.pot()?, self.prize_bps, self.seed_bps)?.0)
    }

    /// After this anyone may close (prizes paid) or expire (none paid) an Active pool.
    pub fn grace_end(&self) -> Result<i64> {
        self.payout_at.checked_add(SETTLE_GRACE_SECS).ok_or_else(|| PoolError::MathOverflow.into())
    }

    pub fn has_winners(&self) -> bool {
        self.committed_at > 0
    }

    /// every committed rank paid
    pub fn all_winners_paid(&self) -> bool {
        let n = self.winners_count as u32;
        let full = if n >= 64 { u64::MAX } else { (1u64 << n) - 1 };
        self.paid_mask & full == full
    }
}

/// The leaf of a winners root (WINNER_LEAF_TAG, constants.rs) – the server builds the same (server/src/domain/economy/winners-merkle.ts).
pub fn winner_leaf(pool_id: u32, rank: u8, wallet: &Pubkey, lamports: u64) -> [u8; 32] {
    solana_sha256_hasher::hashv(&[&[0x00], WINNER_LEAF_TAG, &pool_id.to_le_bytes(), &[rank], wallet.as_ref(), &lamports.to_le_bytes()]).to_bytes()
}

/// Recomputes the root from leaf `index` of a `count`-leaf tree (RFC 6962 node tag 0x01; an odd last node is promoted, not duplicated – the
/// server's telemetry-merkle.ts shape), consuming `proof` bottom-up. True only when every proof element was used.
pub fn merkle_root_from(leaf: [u8; 32], index: u32, count: u32, proof: &[[u8; 32]]) -> Option<[u8; 32]> {
    if count == 0 || index >= count {
        return None;
    }
    let (mut node, mut idx, mut width, mut used) = (leaf, index, count, 0usize);
    while width > 1 {
        let promoted = idx == width - 1 && width % 2 == 1;
        if !promoted {
            let sib = proof.get(used)?;
            used += 1;
            node = if idx % 2 == 0 {
                solana_sha256_hasher::hashv(&[&[0x01], &node, sib]).to_bytes()
            } else {
                solana_sha256_hasher::hashv(&[&[0x01], sib, &node]).to_bytes()
            };
        }
        idx /= 2;
        width = width.div_ceil(2);
    }
    if used == proof.len() { Some(node) } else { None }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn split_is_exact() {
        let mut x: u64 = 0x9E3779B97F4A7C15;
        for _ in 0..1000 {
            x ^= x << 13;
            x ^= x >> 7;
            x ^= x << 17;
            let total = x % 10_000_000_000_000;
            let (p, s, f) = split(total, 6000, 2500).unwrap();
            assert_eq!(p + s + f, total);
            assert!(f <= total / 10_000 * 1500 + 2 * 10_000);
        }
    }

    fn tree(leaves: &[[u8; 32]]) -> Vec<Vec<[u8; 32]>> {
        let mut levels = vec![leaves.to_vec()];
        while levels.last().unwrap().len() > 1 {
            let l = levels.last().unwrap();
            let next = l.chunks(2).map(|c| if c.len() == 2 { solana_sha256_hasher::hashv(&[&[0x01], &c[0], &c[1]]).to_bytes() } else { c[0] }).collect();
            levels.push(next);
        }
        levels
    }

    #[test]
    fn every_leaf_proves_its_root_for_every_tree_size() {
        for n in 1..=21u32 {
            let leaves: Vec<[u8; 32]> = (0..n).map(|i| winner_leaf(7, i as u8, &Pubkey::new_from_array([i as u8 + 1; 32]), 1_000 + i as u64)).collect();
            let levels = tree(&leaves);
            let root = levels.last().unwrap()[0];
            for i in 0..n {
                let mut proof = vec![];
                let mut idx = i as usize;
                for l in &levels[..levels.len() - 1] {
                    let sib = idx ^ 1;
                    if sib < l.len() { proof.push(l[sib]); }
                    idx /= 2;
                }
                assert_eq!(merkle_root_from(leaves[i as usize], i, n, &proof), Some(root), "n {n} i {i}");
                assert_ne!(merkle_root_from(leaves[i as usize], (i + 1) % n.max(2), n.max(2), &proof), Some(root));
                let mut longer = proof.clone(); longer.push([9; 32]);
                assert_eq!(merkle_root_from(leaves[i as usize], i, n, &longer), None, "an unused proof element is refused");
            }
        }
    }

    #[test]
    fn bps_no_overflow_on_max() {
        assert_eq!(bps_of(u64::MAX, 10_000).unwrap(), u64::MAX);
    }
}
