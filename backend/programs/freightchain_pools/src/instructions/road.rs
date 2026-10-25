use anchor_lang::prelude::*;

use crate::{
    constants::*,
    error::PoolError,
    events::{RoadSealed, SealRearmed},
    instructions::create_pool::seed_commitment,
    state::Pool,
};

#[derive(Accounts)]
#[instruction(pool_id: u32)]
pub struct SealRoad<'info> {
    /// anyone (the server's crank in practice)
    pub caller: Signer<'info>,
    #[account(mut, seeds = [POOL_SEED, &pool_id.to_le_bytes()], bump = pool.bump)]
    pub pool: Account<'info, Pool>,
    /// CHECK: the SlotHashes sysvar
    #[account(address = SLOT_HASHES_ID @ PoolError::AccountMismatch)]
    pub slot_hashes: UncheckedAccount<'info>,
}

/// Permissionless (audit L4): fix the pool's road seed from the hash of the FIRST slot at or after `pool.seal_slot` – a slot after the pool opened, so
/// neither the opener nor the caller chose it, and the caller's timing changes nothing (the same entry whenever it is called). If that entry has left
/// the SlotHashes window (nobody sealed for ~3 minutes), the target is re-armed a few slots ahead.
pub fn handle_seal_road(ctx: Context<SealRoad>, pool_id: u32) -> Result<()> {
    let pool = &mut ctx.accounts.pool;
    require!(pool.seal_slot != 0, PoolError::RoadAlreadySealed);
    require!(pool.status == STATUS_OPEN || pool.status == STATUS_ACTIVE, PoolError::PoolNotActive);
    let clock = Clock::get()?;
    require!(clock.unix_timestamp <= pool.last_start_at, PoolError::TooLate);
    let now_slot = clock.slot;
    require!(now_slot > pool.seal_slot, PoolError::TooEarly);

    let data = ctx.accounts.slot_hashes.try_borrow_data()?;
    // layout: u64 entry count, then (u64 slot, [u8; 32] hash) newest first
    require!(data.len() >= 8, PoolError::InvalidParams);
    let n = (u64::from_le_bytes(data[..8].try_into().map_err(|_| PoolError::InvalidParams)?) as usize).min((data.len() - 8) / 40);
    let entry = |i: usize| -> (u64, &[u8]) {
        let o = 8 + i * 40;
        (u64::from_le_bytes(data[o..o + 8].try_into().unwrap_or([0; 8])), &data[o + 8..o + 40])
    };
    let oldest = if n > 0 { entry(n - 1).0 } else { u64::MAX };
    let mut found: Option<(u64, [u8; 32])> = None;
    if oldest <= pool.seal_slot {
        // newest first: the last entry still >= the target is the first slot at or after it
        for i in 0..n {
            let (slot, hash) = entry(i);
            if slot < pool.seal_slot {
                break;
            }
            let mut h = [0u8; 32];
            h.copy_from_slice(hash);
            found = Some((slot, h));
        }
    }
    match found {
        Some((slot, hash)) => {
            pool.seed_slot = slot;
            pool.seed_slot_hash = hash;
            pool.seed_commitment = seed_commitment(pool_id, slot, &hash);
            pool.seal_slot = 0;
            emit!(RoadSealed { pool_id, seed_slot: slot, seed_slot_hash: hash, seed_commitment: pool.seed_commitment });
        }
        // no entry at or after the target yet (it and the slots after it were skipped): wait – re-arm only when it has left the window (red-team v4 S3)
        None if oldest <= pool.seal_slot => return err!(PoolError::TooEarly),
        None => {
            pool.seal_slot = now_slot.checked_add(SEAL_DELAY_SLOTS).ok_or(PoolError::MathOverflow)?;
            emit!(SealRearmed { pool_id, seal_slot: pool.seal_slot });
        }
    }
    Ok(())
}
