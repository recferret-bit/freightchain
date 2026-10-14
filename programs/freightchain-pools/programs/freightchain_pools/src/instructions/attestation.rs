use anchor_lang::prelude::*;

use crate::{
    constants::*,
    error::PoolError,
    events::{AttestationClosed, RideAttestationRecorded},
    state::{Attestation, Config, Pool, RideAttestation},
};

#[derive(Accounts)]
#[instruction(pool_id: u32, ride_id: [u8; 32])]
pub struct RecordRideAttestation<'info> {
    /// `config.authority` or `config.payout_authority`; pays the account's rent (back at `close_ride_attestation`)
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(seeds = [POOL_SEED, &pool_id.to_le_bytes()], bump = pool.bump)]
    pub pool: Account<'info, Pool>,
    #[account(
        init_if_needed,
        payer = authority,
        space = 8 + RideAttestation::INIT_SPACE,
        seeds = [RIDE_ATTESTATION_SEED, pool.key().as_ref(), &ride_id],
        bump
    )]
    pub ride_attestation: Account<'info, RideAttestation>,
    pub system_program: Program<'info, System>,
}

/// v4 (pentest H4): the server's verdict on ONE ride, for the pledges on it – VERIFIED with its whole km and its recording's Merkle root, FLAGGED (the
/// sponsors get everything back) or UNVERIFIED (undecided). It may be rewritten (a verdict changed in review) until a pledge was settled on it; a
/// pledge settles on it only from `settle_from`, so every record is public for the review lock first.
pub fn handle_record_ride_attestation(
    mut ctx: Context<RecordRideAttestation>,
    pool_id: u32,
    ride_id: [u8; 32],
    driver: Pubkey,
    telemetry_root: [u8; 32],
    verified_km: u32,
    status: u8,
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let a = &mut ctx.accounts;
    require!(a.config.may_settle(&a.authority.key()), PoolError::Unauthorized);
    require!(!a.config.paused_before_grace(&a.pool, now)?, PoolError::Paused);
    require!(a.pool.status == STATUS_ACTIVE, PoolError::PoolNotActive);
    require!(
        status == ATTESTATION_STATUS_VERIFIED || status == ATTESTATION_STATUS_UNVERIFIED || status == ATTESTATION_STATUS_FLAGGED,
        PoolError::InvalidAttestationStatus
    );
    if status == ATTESTATION_STATUS_VERIFIED {
        require!(telemetry_root != [0u8; 32], PoolError::InvalidParams);
        require!(verified_km > 0, PoolError::ZeroVerifiedKm);
    }
    let settle_from = a.config.pay_from(&a.pool, now)?;
    let r = &mut a.ride_attestation;
    let fresh = r.recorded_at == 0;
    if !fresh {
        require!(r.settled_pledges == 0, PoolError::AttestationFinal);
        require_keys_eq!(r.driver, driver, PoolError::AttestationMismatch);   // a ride's driver never changes
    } else {
        r.pool = a.pool.key();
        r.ride_id = ride_id;
        r.driver = driver;
        r.settled_pledges = 0;
        r.rent_payer = a.authority.key();
        r.bump = ctx.bumps.ride_attestation;
    }
    r.telemetry_root = telemetry_root;
    r.verified_km = verified_km;
    r.status = status;
    r.recorded_at = now;
    r.settle_from = settle_from;
    emit!(RideAttestationRecorded {
        pool_id,
        pool: a.pool.key(),
        ride_id,
        driver,
        telemetry_root,
        verified_km,
        status,
        recorded_at: now,
        settle_from,
    });
    Ok(())
}

#[derive(Accounts)]
#[instruction(pool_id: u32, ride_id: [u8; 32])]
pub struct CloseRideAttestation<'info> {
    pub caller: Signer<'info>,
    #[account(seeds = [POOL_SEED, &pool_id.to_le_bytes()], bump = pool.bump)]
    pub pool: Account<'info, Pool>,
    #[account(
        mut,
        close = rent_payer,
        seeds = [RIDE_ATTESTATION_SEED, pool.key().as_ref(), &ride_id],
        bump = ride_attestation.bump,
        has_one = rent_payer @ PoolError::AccountMismatch,
    )]
    pub ride_attestation: Account<'info, RideAttestation>,
    /// CHECK: whoever paid the rent – it goes back there
    #[account(mut)]
    pub rent_payer: UncheckedAccount<'info>,
}

/// v4 (pentest L7): permissionless – a finished pool (settled / cancelled) with no open pledge left gives its ride attestations' rent back.
pub fn handle_close_ride_attestation(ctx: Context<CloseRideAttestation>, _pool_id: u32, _ride_id: [u8; 32]) -> Result<()> {
    let p = &ctx.accounts.pool;
    require!(p.status == STATUS_SETTLED || p.status == STATUS_CANCELLED, PoolError::NotSettled);
    require!(p.open_pledges == 0, PoolError::PledgesOpen);
    emit!(AttestationClosed {
        account: ctx.accounts.ride_attestation.key(),
        rent_to: ctx.accounts.rent_payer.key(),
        lamports: ctx.accounts.ride_attestation.to_account_info().lamports(),
    });
    Ok(())
}

/// The byte offset of `Pool.status` – the same in v3 and v4 (every field before it is fixed-size): a v3 pool no longer deserializes as a v4 `Pool`.
const POOL_STATUS_OFFSET: usize = 8 + 4 + 32 + 1 + 8 + 4 + 4 + 2 + 8 + 8 + 8 + 2 + 2 + 2 + 32 + 32;

#[derive(Accounts)]
#[instruction(pool_id: u32, driver: Pubkey)]
pub struct CloseAttestation<'info> {
    pub caller: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    /// CHECK: a v3 pool (owner, discriminator and the status byte are checked in the handler)
    #[account(seeds = [POOL_SEED, &pool_id.to_le_bytes()], bump)]
    pub pool: UncheckedAccount<'info>,
    #[account(
        mut,
        close = rent_to,
        seeds = [ATTESTATION_SEED, pool.key().as_ref(), driver.as_ref()],
        bump = attestation.bump,
    )]
    pub attestation: Account<'info, Attestation>,
    /// CHECK: the payout key (it paid every v3 attestation's rent), the admin when none is named
    #[account(mut, address = config.payout_authority.unwrap_or(config.authority) @ PoolError::AccountMismatch)]
    pub rent_to: UncheckedAccount<'info>,
}

/// v4 (pentest L7): permissionless – a v3 per-driver attestation of a finished pool gives its rent back (v4 pays prizes from the winners root and
/// pledges from ride attestations; v3 pledges were all resolved before the upgrade).
pub fn handle_close_attestation(ctx: Context<CloseAttestation>, _pool_id: u32, _driver: Pubkey) -> Result<()> {
    let info = ctx.accounts.pool.to_account_info();
    require_keys_eq!(*info.owner, crate::ID, PoolError::AccountMismatch);
    let data = info.try_borrow_data()?;
    require!(data.len() > POOL_STATUS_OFFSET && data[..8] == *Pool::DISCRIMINATOR, PoolError::AccountMismatch);
    let status = data[POOL_STATUS_OFFSET];
    require!(status == STATUS_SETTLED || status == STATUS_CANCELLED, PoolError::NotSettled);
    emit!(AttestationClosed {
        account: ctx.accounts.attestation.key(),
        rent_to: ctx.accounts.rent_to.key(),
        lamports: ctx.accounts.attestation.to_account_info().lamports(),
    });
    Ok(())
}
