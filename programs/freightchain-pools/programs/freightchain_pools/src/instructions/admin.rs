use anchor_lang::prelude::*;

use crate::{constants::*, error::PoolError, state::Config, vault::rent_min};

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        init,
        payer = authority,
        space = 8 + Config::INIT_SPACE,
        seeds = [CONFIG_SEED],
        bump
    )]
    pub config: Account<'info, Config>,
    /// CHECK: only its lamports are read (must already be rent-exempt)
    pub platform_treasury_account: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handle_initialize(ctx: Context<Initialize>, platform_treasury: Pubkey, platform_fee_bps: u16) -> Result<()> {
    require!(platform_fee_bps <= BPS_DENOM as u16, PoolError::InvalidParams);
    require_keys_eq!(
        ctx.accounts.platform_treasury_account.key(),
        platform_treasury,
        PoolError::AccountMismatch
    );
    require!(
        ctx.accounts.platform_treasury_account.lamports() >= rent_min()?,
        PoolError::TreasuryNotRentExempt
    );
    let c = &mut ctx.accounts.config;
    c.authority = ctx.accounts.authority.key();
    c.platform_treasury = platform_treasury;
    c.platform_fee_bps = platform_fee_bps;
    c.pool_count = 0;
    c.paused = false;
    c.bump = ctx.bumps.config;
    Ok(())
}

#[derive(Accounts)]
pub struct SetConfig<'info> {
    pub authority: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = authority @ PoolError::Unauthorized)]
    pub config: Account<'info, Config>,
    /// CHECK: required (rent-exempt) only when `platform_treasury` is being changed; pass any account otherwise
    pub new_platform_treasury: UncheckedAccount<'info>,
}

pub fn handle_set_config(
    ctx: Context<SetConfig>,
    paused: Option<bool>,
    platform_treasury: Option<Pubkey>,
    platform_fee_bps: Option<u16>,
) -> Result<()> {
    let c = &mut ctx.accounts.config;
    if let Some(p) = paused {
        c.paused = p;
    }
    if let Some(t) = platform_treasury {
        require_keys_eq!(ctx.accounts.new_platform_treasury.key(), t, PoolError::AccountMismatch);
        require!(
            ctx.accounts.new_platform_treasury.lamports() >= rent_min()?,
            PoolError::TreasuryNotRentExempt
        );
        c.platform_treasury = t;
    }
    if let Some(b) = platform_fee_bps {
        require!(b <= BPS_DENOM as u16, PoolError::InvalidParams);
        c.platform_fee_bps = b;
    }
    Ok(())
}
