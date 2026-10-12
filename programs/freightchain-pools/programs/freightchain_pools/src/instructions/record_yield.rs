use anchor_lang::{
    prelude::*,
    system_program::{transfer, Transfer},
};

use crate::{
    constants::*,
    error::PoolError,
    events::YieldRecorded,
    state::{Config, Pool},
};

#[derive(Accounts)]
#[instruction(pool_id: u32)]
pub struct RecordYield<'info> {
    /// Config authority or payout authority (checked via config.may_settle)
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [POOL_SEED, &pool_id.to_le_bytes()], bump = pool.bump)]
    pub pool: Account<'info, Pool>,
    /// CHECK: the pool's vault PDA
    #[account(mut, seeds = [VAULT_SEED, &pool_id.to_le_bytes()], bump = pool.vault_bump)]
    pub vault: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handle_record_yield(
    mut ctx: Context<RecordYield>,
    pool_id: u32,
    staked_lamports: u64,
    yield_earned: u64,
) -> Result<()> {
    let a = &mut ctx.accounts;
    require!(!a.config.paused, PoolError::Paused);
    require!(a.config.may_settle(&a.authority.key()), PoolError::Unauthorized);
    require!(
        a.pool.status == STATUS_OPEN || a.pool.status == STATUS_ACTIVE,
        PoolError::PoolNotActive
    );

    // If incremental yield is reported, transfer the backing lamports into the vault
    if yield_earned > 0 {
        transfer(
            CpiContext::new(
                a.system_program.key(),
                Transfer {
                    from: a.authority.to_account_info(),
                    to: a.vault.to_account_info(),
                },
            ),
            yield_earned,
        )?;
        a.pool.yield_earned = a
            .pool
            .yield_earned
            .checked_add(yield_earned)
            .ok_or(PoolError::MathOverflow)?;
    }

    a.pool.staked_lamports = staked_lamports;

    emit!(YieldRecorded {
        pool_id,
        staked_lamports,
        yield_earned,
        yield_earned_total: a.pool.yield_earned,
    });

    Ok(())
}
