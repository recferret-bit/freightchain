use anchor_lang::{
    prelude::*,
    system_program::{transfer, Transfer},
};

use crate::{
    constants::*,
    error::PoolError,
    events::Sponsored,
    state::{Config, Pool},
};

#[derive(Accounts)]
#[instruction(pool_id: u32, lamports: u64)]
pub struct Sponsor<'info> {
    #[account(mut)]
    pub sponsor: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [POOL_SEED, &pool_id.to_le_bytes()], bump = pool.bump)]
    pub pool: Account<'info, Pool>,
    /// CHECK: the escrow, a zero-data system account at the vault PDA
    #[account(mut, seeds = [VAULT_SEED, &pool_id.to_le_bytes()], bump = pool.vault_bump)]
    pub vault: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handle_sponsor(ctx: Context<Sponsor>, pool_id: u32, lamports: u64) -> Result<()> {
    require!(!ctx.accounts.config.paused, PoolError::Paused);
    require!(lamports > 0, PoolError::InvalidParams);
    let now = Clock::get()?.unix_timestamp;
    let pool = &mut ctx.accounts.pool;
    require!(
        pool.status == STATUS_OPEN || pool.status == STATUS_ACTIVE,
        PoolError::PoolNotOpen
    );
    require!(now < pool.play_deadline, PoolError::TooLate);
    // like buy_ticket: an Open pool past its prep deadline can only fail, so it takes no money
    require!(pool.status != STATUS_OPEN || now < pool.prep_deadline, PoolError::TooLate);
    pool.sponsored = pool.sponsored.checked_add(lamports).ok_or(PoolError::MathOverflow)?;
    transfer(
        CpiContext::new(
            ctx.accounts.system_program.key(),
            Transfer { from: ctx.accounts.sponsor.to_account_info(), to: ctx.accounts.vault.to_account_info() },
        ),
        lamports,
    )?;
    emit!(Sponsored {
        pool_id,
        sponsor: ctx.accounts.sponsor.key(),
        lamports,
        sponsored_total: pool.sponsored,
    });
    Ok(())
}
