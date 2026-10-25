use anchor_lang::prelude::*;

use crate::{
    constants::*,
    error::PoolError,
    events::{PoolCancelled, PoolExpired},
    state::{Config, Pool},
};

#[derive(Accounts)]
#[instruction(pool_id: u32)]
pub struct FailPool<'info> {
    /// Anyone: a permissionless crank.
    pub caller: Signer<'info>,
    #[account(mut, seeds = [POOL_SEED, &pool_id.to_le_bytes()], bump = pool.bump)]
    pub pool: Account<'info, Pool>,
}

/// ABI tombstone: low sales never release operator-funded escrow. Cancellation and unpaid expiry are the refund exits.
pub fn handle_fail_pool(ctx: Context<FailPool>, pool_id: u32) -> Result<()> {
    let _ = (ctx, pool_id);
    err!(PoolError::NotFailable)
}

#[derive(Accounts)]
#[instruction(pool_id: u32)]
pub struct CancelPool<'info> {
    pub authority: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = authority @ PoolError::Unauthorized)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [POOL_SEED, &pool_id.to_le_bytes()], bump = pool.bump)]
    pub pool: Account<'info, Pool>,
}

pub fn handle_cancel_pool(ctx: Context<CancelPool>, pool_id: u32) -> Result<()> {
    let pool = &mut ctx.accounts.pool;
    require!(pool.status == STATUS_ACTIVE, PoolError::PoolNotActive);
    require!(pool.prizes_paid == 0, PoolError::PrizesAlreadyPaid);
    pool.status = STATUS_REFUNDING;
    emit!(PoolCancelled { pool_id, tickets_sold: pool.tickets_sold });
    Ok(())
}

#[derive(Accounts)]
#[instruction(pool_id: u32)]
pub struct ExpirePool<'info> {
    /// Anyone: the exit when the admin never settles.
    pub caller: Signer<'info>,
    #[account(mut, seeds = [POOL_SEED, &pool_id.to_le_bytes()], bump = pool.bump)]
    pub pool: Account<'info, Pool>,
}

/// Active, `now >= payout_at + SETTLE_GRACE_SECS`, no prize paid -> Refunding (every ticket back in full).
pub fn handle_expire_pool(ctx: Context<ExpirePool>, pool_id: u32) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let pool = &mut ctx.accounts.pool;
    require!(pool.status == STATUS_ACTIVE, PoolError::PoolNotActive);
    let grace_end = pool.payout_at.checked_add(SETTLE_GRACE_SECS).ok_or(PoolError::MathOverflow)?;
    require!(now >= grace_end, PoolError::TooEarly);
    require!(pool.prizes_paid == 0, PoolError::PrizesAlreadyPaid);
    pool.status = STATUS_REFUNDING;
    emit!(PoolExpired { pool_id, tickets_sold: pool.tickets_sold });
    Ok(())
}
