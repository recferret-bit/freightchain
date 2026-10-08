use anchor_lang::{
    prelude::*,
    system_program::{transfer, Transfer},
};

use crate::{
    constants::*,
    error::PoolError,
    events::PoolCreated,
    state::{Config, Pool},
    vault::rent_min,
};

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct CreatePoolParams {
    pub tier: u8,
    pub price_lamports: u64,
    pub min_tickets: u32,
    /// 0 = unlimited
    pub max_tickets: u32,
    pub max_per_wallet: u16,
    pub prep_deadline: i64,
    pub play_deadline: i64,
    pub prize_bps: u16,
    pub seed_bps: u16,
    pub fee_bps: u16,
}

#[derive(Accounts)]
pub struct CreatePool<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = authority @ PoolError::Unauthorized)]
    pub config: Account<'info, Config>,
    #[account(
        init,
        payer = authority,
        space = 8 + Pool::INIT_SPACE,
        seeds = [POOL_SEED, &config.pool_count.to_le_bytes()],
        bump
    )]
    pub pool: Account<'info, Pool>,
    /// CHECK: zero-data system account at the vault PDA; funded here with the rent-exempt minimum
    #[account(mut, seeds = [VAULT_SEED, &config.pool_count.to_le_bytes()], bump)]
    pub vault: UncheckedAccount<'info>,
    /// CHECK: only its lamports are read (must already be rent-exempt)
    pub fee_treasury: UncheckedAccount<'info>,
    /// CHECK: only its lamports are read (must already be rent-exempt)
    pub seed_treasury: UncheckedAccount<'info>,
    /// CHECK: must equal config.platform_treasury and be rent-exempt
    #[account(address = config.platform_treasury @ PoolError::AccountMismatch)]
    pub platform_treasury: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handle_create_pool(ctx: Context<CreatePool>, p: CreatePoolParams) -> Result<()> {
    let a = &ctx.accounts;
    require!(!a.config.paused, PoolError::Paused);
    let now = Clock::get()?.unix_timestamp;
    let min = rent_min()?;

    require!(p.price_lamports > 0 && p.min_tickets >= 1, PoolError::InvalidParams);
    // refunds must be able to land in an empty wallet: a price below the minimum would brick them
    require!(p.price_lamports >= min, PoolError::PriceBelowRentMin);
    require!(p.max_tickets == 0 || p.max_tickets >= p.min_tickets, PoolError::InvalidParams);
    require!(p.max_per_wallet >= 1, PoolError::InvalidParams);
    require!(p.prep_deadline > now && p.play_deadline >= p.prep_deadline, PoolError::InvalidParams);
    require!(p.play_deadline - now <= MAX_POOL_SECS, PoolError::InvalidParams);
    let sum = p.prize_bps as u32 + p.seed_bps as u32 + p.fee_bps as u32;
    require!(sum == BPS_DENOM as u32, PoolError::BpsSum);
    for t in [&a.fee_treasury, &a.seed_treasury, &a.platform_treasury] {
        require!(t.lamports() >= min, PoolError::TreasuryNotRentExempt);
    }

    transfer(
        CpiContext::new(
            a.system_program.key(),
            Transfer { from: a.authority.to_account_info(), to: a.vault.to_account_info() },
        ),
        min,
    )?;

    let pool_id = ctx.accounts.config.pool_count;
    ctx.accounts.config.pool_count = pool_id.checked_add(1).ok_or(PoolError::MathOverflow)?;

    let pool_key = ctx.accounts.pool.key();
    let vault_key = ctx.accounts.vault.key();
    let authority = ctx.accounts.authority.key();
    let fee_treasury = ctx.accounts.fee_treasury.key();
    let seed_treasury = ctx.accounts.seed_treasury.key();
    let pool = &mut ctx.accounts.pool;
    pool.pool_id = pool_id;
    pool.authority = authority;
    pool.tier = p.tier;
    pool.price_lamports = p.price_lamports;
    pool.min_tickets = p.min_tickets;
    pool.max_tickets = p.max_tickets;
    pool.max_per_wallet = p.max_per_wallet;
    pool.prep_deadline = p.prep_deadline;
    pool.play_deadline = p.play_deadline;
    pool.prize_bps = p.prize_bps;
    pool.seed_bps = p.seed_bps;
    pool.fee_bps = p.fee_bps;
    pool.fee_treasury = fee_treasury;
    pool.seed_treasury = seed_treasury;
    pool.status = STATUS_OPEN;
    pool.tickets_sold = 0;
    pool.buyers = 0;
    pool.sponsored = 0;
    pool.prizes_paid = 0;
    pool.refunded = 0;
    pool.created_at = now;
    pool.bump = ctx.bumps.pool;
    pool.vault_bump = ctx.bumps.vault;

    emit!(PoolCreated {
        pool_id,
        pool: pool_key,
        vault: vault_key,
        authority,
        tier: p.tier,
        price_lamports: p.price_lamports,
        min_tickets: p.min_tickets,
        max_tickets: p.max_tickets,
        max_per_wallet: p.max_per_wallet,
        prep_deadline: p.prep_deadline,
        play_deadline: p.play_deadline,
        prize_bps: p.prize_bps,
        seed_bps: p.seed_bps,
        fee_bps: p.fee_bps,
        fee_treasury,
        seed_treasury,
    });
    Ok(())
}
