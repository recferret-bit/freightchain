use anchor_lang::prelude::*;

use crate::{
    constants::*,
    error::PoolError,
    events::{PoolCancelled, PoolExpired, PoolFailed},
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

/// Low-sales fail stays in this .so. The server crank skips it when `min_tickets` is 0 (operator-funded). Only `cancel_pool` and `expire_pool` refund those.
pub fn handle_fail_pool(ctx: Context<FailPool>, pool_id: u32) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let pool = &mut ctx.accounts.pool;
    require!(
        pool.status == STATUS_OPEN && now >= pool.prep_deadline && pool.tickets_sold < pool.min_tickets,
        PoolError::NotFailable
    );
    pool.status = STATUS_REFUNDING;
    emit!(PoolFailed { pool_id, tickets_sold: pool.tickets_sold });
    Ok(())
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
    require!(pool.status == STATUS_OPEN, PoolError::PoolNotOpen);
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
