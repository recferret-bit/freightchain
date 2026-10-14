use anchor_lang::prelude::*;

use anchor_lang::prelude::ProgramData;

use crate::{constants::*, error::PoolError, program::FreightchainPools, state::Config, vault::rent_min};

use anchor_lang::system_program::{transfer, Transfer};

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
    c.min_review_secs = DEFAULT_MIN_REVIEW_SECS;
    c.min_finish_secs = DEFAULT_MIN_FINISH_SECS;
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
    min_review_secs: Option<i64>,
    min_finish_secs: Option<i64>,
) -> Result<()> {
    if min_review_secs.is_some() || min_finish_secs.is_some() {
        crate::state::require_migrated(&ctx.accounts.config)?;
    }
    let c = &mut ctx.accounts.config;
    if min_review_secs.is_some() || min_finish_secs.is_some() {
        // the floors only bind NEW pools / series (set_series, create_pool); a pool already open keeps its windows and its review lock (Pool.min_review_secs)
        for v in [min_review_secs, min_finish_secs].into_iter().flatten() {
            require!((0..=MAX_POOL_SECS).contains(&v), PoolError::InvalidParams);
        }
        c.min_review_secs = min_review_secs.unwrap_or(c.min_review_secs);
        c.min_finish_secs = min_finish_secs.unwrap_or(c.min_finish_secs);
        emit!(crate::events::FloorsSet { min_review_secs: c.min_review_secs, min_finish_secs: c.min_finish_secs });
    }
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

/// Step 2 (the pending key signs): it becomes `authority`, pending is cleared – and so is the payout key (pentest L8: a key the OLD admin named must
/// not keep committing winners under the new one; the new admin names its own).
pub fn handle_accept_authority(ctx: Context<AcceptAuthority>) -> Result<()> {
    let c = &mut ctx.accounts.config;
    let pending = c.pending_authority.ok_or(PoolError::NoPendingAuthority)?;
    require_keys_eq!(pending, ctx.accounts.new_authority.key(), PoolError::Unauthorized);
    let old = c.authority;
    c.authority = pending;
    c.pending_authority = None;
    let had_payout = c.payout_authority.take().is_some();
    emit!(crate::events::AuthorityChanged { old_authority: old, new_authority: pending });
    if had_payout {
        emit!(crate::events::PayoutAuthoritySet { authority: pending, payout_authority: None });
    }
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

/// The v3 Config layout (no floors) – read once by `migrate_config_v4`.
#[derive(AnchorDeserialize)]
struct ConfigV3 {
    authority: Pubkey,
    platform_treasury: Pubkey,
    platform_fee_bps: u16,
    pool_count: u32,
    paused: bool,
    bump: u8,
    pending_authority: Option<Pubkey>,
    payout_authority: Option<Pubkey>,
}

#[derive(Accounts)]
pub struct MigrateConfigV4<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    /// CHECK: the v3 Config – too short for `Account<Config>`; owner, discriminator and authority are checked in the handler
    #[account(mut, seeds = [CONFIG_SEED], bump)]
    pub config: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

/// Once, right after the v4 upgrade: grow the v3 Config to the v4 layout (the two floors at their defaults). The admin signs and pays the extra rent.
pub fn handle_migrate_config_v4(ctx: Context<MigrateConfigV4>) -> Result<()> {
    let info = ctx.accounts.config.to_account_info();
    require_keys_eq!(*info.owner, crate::ID, PoolError::AccountMismatch);
    let new_len = 8 + Config::INIT_SPACE;
    require!(info.data_len() < new_len, PoolError::AlreadyMigrated);
    let old = {
        let data = info.try_borrow_data()?;
        require!(data.len() >= 8 && data[..8] == *Config::DISCRIMINATOR, PoolError::AccountMismatch);
        ConfigV3::deserialize(&mut &data[8..])?
    };
    require_keys_eq!(old.authority, ctx.accounts.authority.key(), PoolError::Unauthorized);
    let need = Rent::get()?.minimum_balance(new_len).saturating_sub(info.lamports());
    if need > 0 {
        transfer(
            CpiContext::new(ctx.accounts.system_program.key(), Transfer { from: ctx.accounts.authority.to_account_info(), to: info.clone() }),
            need,
        )?;
    }
    info.resize(new_len)?;
    let c = Config {
        authority: old.authority,
        platform_treasury: old.platform_treasury,
        platform_fee_bps: old.platform_fee_bps,
        pool_count: old.pool_count,
        paused: old.paused,
        bump: old.bump,
        pending_authority: old.pending_authority,
        payout_authority: old.payout_authority,
        min_review_secs: DEFAULT_MIN_REVIEW_SECS,
        min_finish_secs: DEFAULT_MIN_FINISH_SECS,
    };
    let mut data = info.try_borrow_mut_data()?;
    data.fill(0);
    let mut w: &mut [u8] = &mut data[..];
    c.try_serialize(&mut w)?;
    emit!(crate::events::ConfigMigrated { min_review_secs: c.min_review_secs, min_finish_secs: c.min_finish_secs });
    Ok(())
}
