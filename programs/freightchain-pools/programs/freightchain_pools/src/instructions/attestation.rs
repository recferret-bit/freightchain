use anchor_lang::prelude::*;

use crate::{
    constants::*,
    error::PoolError,
    events::AttestationRecorded,
    state::{Attestation, Config, Pool},
};

#[derive(Accounts)]
#[instruction(pool_id: u32, driver: Pubkey)]
pub struct RecordAttestation<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,

    #[account(
        seeds = [POOL_SEED, &pool_id.to_le_bytes()],
        bump = pool.bump
    )]
    pub pool: Account<'info, Pool>,

    /// CHECK: Driver wallet matching the driver parameter
    #[account(address = driver @ PoolError::AccountMismatch)]
    pub driver_account: UncheckedAccount<'info>,

    #[account(
        init_if_needed,
        payer = authority,
        space = 8 + Attestation::INIT_SPACE,
        seeds = [ATTESTATION_SEED, pool.key().as_ref(), driver.as_ref()],
        bump
    )]
    pub attestation: Account<'info, Attestation>,

    pub system_program: Program<'info, System>,
}

pub fn handle_record_attestation(
    mut ctx: Context<RecordAttestation>,
    pool_id: u32,
    driver: Pubkey,
    telemetry_root: [u8; 32],
    verified_km: u32,
    status: u8,
) -> Result<()> {
    let a = &mut ctx.accounts;
    require!(!a.config.paused, PoolError::Paused);
    require!(a.config.may_settle(&a.authority.key()), PoolError::Unauthorized);
    require!(a.pool.status == STATUS_ACTIVE, PoolError::PoolNotActive);
    require!(
        status == ATTESTATION_STATUS_VERIFIED
            || status == ATTESTATION_STATUS_UNVERIFIED
            || status == ATTESTATION_STATUS_FLAGGED,
        PoolError::InvalidAttestationStatus
    );
    if status == ATTESTATION_STATUS_VERIFIED {
        require!(telemetry_root != [0u8; 32], PoolError::InvalidParams);
        require!(verified_km > 0, PoolError::ZeroVerifiedKm);
    }

    let now = Clock::get()?.unix_timestamp;
    let attestation = &mut a.attestation;
    attestation.pool = a.pool.key();
    attestation.driver = driver;
    attestation.telemetry_root = telemetry_root;
    attestation.verified_km = verified_km;
    attestation.status = status;
    attestation.recorded_at = now;
    attestation.bump = ctx.bumps.attestation;

    emit!(AttestationRecorded {
        pool_id,
        pool: a.pool.key(),
        driver,
        telemetry_root,
        verified_km,
        status,
        recorded_at: now,
    });

    Ok(())
}
