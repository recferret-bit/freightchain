use anchor_lang::prelude::*;

use anchor_lang::prelude::ProgramData;

use crate::{constants::*, error::PoolError, program::FreightchainPools, state::Config, vault::rent_min};

/// Only the program's upgrade authority can create the Config (else the first caller after a deploy would own it).
/// It names the admin (`authority` argument, e.g. a Phantom wallet) in the same transaction.
#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub upgrade_authority: Signer<'info>,
    #[account(constraint = program.programdata_address()? == Some(program_data.key()) @ PoolError::AccountMismatch)]
    pub program: Program<'info, FreightchainPools>,
    #[account(constraint = program_data.upgrade_authority_address == Some(upgrade_authority.key()) @ PoolError::Unauthorized)]
    pub program_data: Account<'info, ProgramData>,
    #[account(
        init,
        payer = upgrade_authority,
        space = 8 + Config::INIT_SPACE,
        seeds = [CONFIG_SEED],
        bump
    )]
    pub config: Account<'info, Config>,
    /// CHECK: only its lamports are read (must already be rent-exempt)
    pub platform_treasury_account: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handle_initialize(ctx: Context<Initialize>, authority: Pubkey, platform_treasury: Pubkey, platform_fee_bps: u16) -> Result<()> {
    require!(authority != Pubkey::default(), PoolError::InvalidParams);
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
    c.authority = authority;
    c.platform_treasury = platform_treasury;
    c.platform_fee_bps = platform_fee_bps;
    c.pool_count = 0;
    c.paused = false;
    c.bump = ctx.bumps.config;
    c.pending_authority = None;
    c.payout_authority = None;
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

#[derive(Accounts)]
pub struct ProposeAuthority<'info> {
    pub authority: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = authority @ PoolError::Unauthorized)]
    pub config: Account<'info, Config>,
}

/// Step 1 of the handover (current authority). Proposing again replaces the pending key.
pub fn handle_propose_authority(ctx: Context<ProposeAuthority>, new_authority: Pubkey) -> Result<()> {
    require!(new_authority != Pubkey::default(), PoolError::InvalidParams);
    ctx.accounts.config.pending_authority = Some(new_authority);
    emit!(crate::events::AuthorityProposed {
        authority: ctx.accounts.authority.key(),
        pending_authority: new_authority,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct AcceptAuthority<'info> {
    pub new_authority: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
}

/// Step 2 (the pending key signs): it becomes `authority`, pending is cleared.
pub fn handle_accept_authority(ctx: Context<AcceptAuthority>) -> Result<()> {
    let c = &mut ctx.accounts.config;
    let pending = c.pending_authority.ok_or(PoolError::NoPendingAuthority)?;
    require_keys_eq!(pending, ctx.accounts.new_authority.key(), PoolError::Unauthorized);
    let old = c.authority;
    c.authority = pending;
    c.pending_authority = None;
    emit!(crate::events::AuthorityChanged { old_authority: old, new_authority: pending });
    Ok(())
}

#[derive(Accounts)]
pub struct SetPayoutAuthority<'info> {
    pub authority: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = authority @ PoolError::Unauthorized)]
    pub config: Account<'info, Config>,
}

/// Admin: name (or clear, `None`) the payout key – the one key besides the admin that may `pay_prize` and `close_pool`, and only once a
/// pool's review window is over. It can open, cancel or configure nothing.
pub fn handle_set_payout_authority(ctx: Context<SetPayoutAuthority>, payout_authority: Option<Pubkey>) -> Result<()> {
    require!(payout_authority != Some(Pubkey::default()), PoolError::InvalidParams);
    ctx.accounts.config.payout_authority = payout_authority;
    emit!(crate::events::PayoutAuthoritySet { authority: ctx.accounts.authority.key(), payout_authority });
    Ok(())
}
