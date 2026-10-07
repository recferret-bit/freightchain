use anchor_lang::prelude::*;

use crate::{
    constants::*,
    error::PoolError,
    events::{PoolCancelled, PoolFailed},
    state::Pool,
};

#[derive(Accounts)]
#[instruction(pool_id: u32)]
pub struct FailPool<'info> {
    /// Anyone: a permissionless crank.
    pub caller: Signer<'info>,
    #[account(mut, seeds = [POOL_SEED, &pool_id.to_le_bytes()], bump = pool.bump)]
    pub pool: Account<'info, Pool>,
}

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
    #[account(
        mut,
        seeds = [POOL_SEED, &pool_id.to_le_bytes()],
        bump = pool.bump,
        has_one = authority @ PoolError::Unauthorized
    )]
    pub pool: Account<'info, Pool>,
}

pub fn handle_cancel_pool(ctx: Context<CancelPool>, pool_id: u32) -> Result<()> {
    let pool = &mut ctx.accounts.pool;
    require!(pool.status == STATUS_OPEN, PoolError::PoolNotOpen);
    pool.status = STATUS_REFUNDING;
    emit!(PoolCancelled { pool_id, tickets_sold: pool.tickets_sold });
    Ok(())
}
