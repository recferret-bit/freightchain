use anchor_lang::{
    prelude::*,
    system_program::{transfer, Transfer},
};

use crate::{
    constants::*,
    error::PoolError,
    events::{PledgeCreated, PledgeRefunded, PledgeSettled},
    state::{Config, Pledge, Pool, RideAttestation},
    vault::rent_min,
};

#[derive(Accounts)]
#[instruction(ride_id: [u8; 32])]
pub struct CreatePledge<'info> {
    #[account(mut)]
    pub sponsor: Signer<'info>,

    /// CHECK: Target driver wallet that will receive rewards upon settlement
    pub driver: UncheckedAccount<'info>,

    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,

    #[account(mut, seeds = [POOL_SEED, &pool.pool_id.to_le_bytes()], bump = pool.bump)]
    pub pool: Account<'info, Pool>,

    #[account(
        init,
        payer = sponsor,
        space = 8 + Pledge::INIT_SPACE,
        seeds = [PLEDGE_SEED, &ride_id, sponsor.key().as_ref()],
        bump
    )]
    pub pledge: Account<'info, Pledge>,

    pub system_program: Program<'info, System>,
}

pub fn handle_create_pledge(
    ctx: Context<CreatePledge>,
    ride_id: [u8; 32],
    driver: Pubkey,
    max_lamports: u64,
    lamports_per_km: u64,
    target_km: u32,
) -> Result<()> {
    require!(!ctx.accounts.config.paused, PoolError::Paused);
    let pool = &ctx.accounts.pool;
    require!(
        pool.status == STATUS_OPEN || pool.status == STATUS_ACTIVE,
        PoolError::PoolNotOpen
    );
    // a pledge is for driving still to come: none once the pool's rides stop counting
    require!(Clock::get()?.unix_timestamp < pool.play_deadline, PoolError::TooLate);
    require!(ctx.accounts.driver.key() == driver, PoolError::AccountMismatch);
    require!(ctx.accounts.sponsor.key() != driver, PoolError::InvalidParams);
    require!(target_km > 0, PoolError::InvalidParams);
    require!(max_lamports > 0, PoolError::InvalidParams);
    require!(lamports_per_km > 0, PoolError::InvalidParams);

    // Invariant check: max_lamports must equal the target distance rate
    let expected_lamports = (lamports_per_km as u128)
        .checked_mul(target_km as u128)
        .ok_or(PoolError::MathOverflow)?;
    require!(
        max_lamports == u64::try_from(expected_lamports).map_err(|_| PoolError::MathOverflow)?,
        PoolError::InvalidParams
    );

    // Transfer escrowed lamports from sponsor into the pledge PDA
    transfer(
        CpiContext::new(
            ctx.accounts.system_program.key(),
            Transfer {
                from: ctx.accounts.sponsor.to_account_info(),
                to: ctx.accounts.pledge.to_account_info(),
            },
        ),
        max_lamports,
    )?;

    let pool = &mut ctx.accounts.pool;
    pool.open_pledges = pool.open_pledges.checked_add(1).ok_or(PoolError::MathOverflow)?;
    let pool_key = pool.key();
    let clock = Clock::get()?;
    let pledge = &mut ctx.accounts.pledge;
    pledge.ride_id = ride_id;
    pledge.sponsor = ctx.accounts.sponsor.key();
    pledge.driver = driver;
    pledge.pool = pool_key;
    pledge.max_lamports = max_lamports;
    pledge.lamports_per_km = lamports_per_km;
    pledge.target_km = target_km;
    pledge.settled = false;
    pledge.earned_lamports = 0;
    pledge.refunded_lamports = 0;
    pledge.created_at = clock.unix_timestamp;
    pledge.bump = ctx.bumps.pledge;

    emit!(PledgeCreated {
        ride_id,
        sponsor: pledge.sponsor,
        driver,
        pool: pledge.pool,
        max_lamports,
        lamports_per_km,
        target_km,
        created_at: pledge.created_at,
    });

    Ok(())
}

#[derive(Accounts)]
#[instruction(ride_id: [u8; 32])]
pub struct SettlePledge<'info> {
    /// Settlement is permissionless: anyone can crank it once the driver's attestation exists
    pub caller: Signer<'info>,

    /// CHECK: Driver wallet receiving earned lamports
    #[account(mut, address = pledge.driver @ PoolError::AccountMismatch)]
    pub driver: UncheckedAccount<'info>,

    /// CHECK: Sponsor wallet: receives the unearned part and the pledge account's rent (the account is closed)
    #[account(mut, address = pledge.sponsor @ PoolError::AccountMismatch)]
    pub sponsor: UncheckedAccount<'info>,

    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,

    #[account(mut, seeds = [POOL_SEED, &pool.pool_id.to_le_bytes()], bump = pool.bump)]
    pub pool: Account<'info, Pool>,

    /// v4 (H4): THIS ride's attestation – not the driver's best ride in the pool
    #[account(
        mut,
        seeds = [RIDE_ATTESTATION_SEED, pool.key().as_ref(), &ride_id],
        bump = ride_attestation.bump,
        constraint = ride_attestation.pool == pool.key() @ PoolError::AccountMismatch,
        constraint = ride_attestation.driver == driver.key() @ PoolError::AttestationMismatch,
    )]
    pub ride_attestation: Account<'info, RideAttestation>,

    #[account(
        mut,
        close = sponsor,
        seeds = [PLEDGE_SEED, &ride_id, sponsor.key().as_ref()],
        bump = pledge.bump,
        has_one = sponsor @ PoolError::AccountMismatch,
        has_one = driver @ PoolError::AccountMismatch,
        has_one = pool @ PoolError::AccountMismatch,
    )]
    pub pledge: Account<'info, Pledge>,

    pub system_program: Program<'info, System>,
}

/// Pays the driver `max * min(verified_km, target_km) / target_km` and closes the pledge: the rest of the cap and the
/// account's rent go back to the sponsor. A FLAGGED attestation earns nothing (full refund). v4: the attestation is the pledged RIDE's (H4), and it
/// pays only from its `settle_from` – after the pool's payout time and the review lock (L5); the attestation is final from here on.
pub fn handle_settle_pledge(ctx: Context<SettlePledge>, ride_id: [u8; 32]) -> Result<()> {
    require!(!ctx.accounts.pledge.settled, PoolError::AlreadySettled);
    require!(ctx.accounts.pledge.ride_id == ride_id, PoolError::AccountMismatch);
    let now = Clock::get()?.unix_timestamp;
    require!(!ctx.accounts.config.paused_before_grace(&ctx.accounts.pool, now)?, PoolError::Paused);
    let grace_over = now >= ctx.accounts.pool.grace_end()?;

    let attestation = &ctx.accounts.ride_attestation;
    require!(now >= attestation.settle_from && now >= ctx.accounts.pool.payout_at, PoolError::TooEarly);
    require!(
        attestation.status == ATTESTATION_STATUS_VERIFIED || attestation.status == ATTESTATION_STATUS_FLAGGED,
        PoolError::UnverifiedAttestation
    );

    let total_lamports = ctx.accounts.pledge.max_lamports;
    let target_km = ctx.accounts.pledge.target_km;
    let driver_info = ctx.accounts.driver.to_account_info();

    let (mut earned, verified_km) = if attestation.status == ATTESTATION_STATUS_FLAGGED {
        (0u64, 0u32)
    } else {
        let v_km = attestation.verified_km;
        let e = ((total_lamports as u128)
            .checked_mul(v_km.min(target_km) as u128)
            .ok_or(PoolError::MathOverflow)?
            / (target_km as u128)) as u64;
        (e, v_km)
    };
    // A driver account that would stay below the rent minimum cannot take lamports (the runtime refuses it). v4 (L6): until the grace the
    // settle waits (the driver can top the wallet up); only after it does the sponsor get it all back – nobody can zero a small earning on purpose.
    if earned > 0 && driver_info.lamports().checked_add(earned).ok_or(PoolError::MathOverflow)? < rent_min()? {
        require!(grace_over, PoolError::DriverBelowRentMin);
        earned = 0;
    }
    let refund = total_lamports.checked_sub(earned).ok_or(PoolError::MathOverflow)?;

    if earned > 0 {
        let pledge_info = ctx.accounts.pledge.to_account_info();
        **pledge_info.try_borrow_mut_lamports()? = pledge_info
            .lamports()
            .checked_sub(earned)
            .ok_or(PoolError::MathOverflow)?;
        **driver_info.try_borrow_mut_lamports()? = driver_info
            .lamports()
            .checked_add(earned)
            .ok_or(PoolError::MathOverflow)?;
    }

    let r = &mut ctx.accounts.ride_attestation;
    r.settled_pledges = r.settled_pledges.checked_add(1).ok_or(PoolError::MathOverflow)?;
    let pool = &mut ctx.accounts.pool;
    pool.open_pledges = pool.open_pledges.saturating_sub(1);
    let pledge = &mut ctx.accounts.pledge;
    pledge.settled = true;
    pledge.earned_lamports = earned;
    pledge.refunded_lamports = refund;

    emit!(PledgeSettled {
        ride_id,
        sponsor: pledge.sponsor,
        driver: pledge.driver,
        pool: pledge.pool,
        verified_km,
        target_km,
        earned_lamports: earned,
        refunded_lamports: refund,
    });
    // `close = sponsor` then moves the refund + the rent to the sponsor and zeroes the account
    Ok(())
}

#[derive(Accounts)]
#[instruction(ride_id: [u8; 32])]
pub struct RefundPledge<'info> {
    /// Permissionless, like settle
    pub caller: Signer<'info>,

    /// CHECK: Sponsor wallet: receives the whole cap and the pledge account's rent
    #[account(mut, address = pledge.sponsor @ PoolError::AccountMismatch)]
    pub sponsor: UncheckedAccount<'info>,

    #[account(mut, seeds = [POOL_SEED, &pool.pool_id.to_le_bytes()], bump = pool.bump)]
    pub pool: Account<'info, Pool>,

    /// CHECK: the pledged ride's attestation PDA; it must not hold a decided (verified / flagged) attestation
    #[account(seeds = [RIDE_ATTESTATION_SEED, pool.key().as_ref(), &ride_id], bump)]
    pub ride_attestation: UncheckedAccount<'info>,

    #[account(
        mut,
        close = sponsor,
        seeds = [PLEDGE_SEED, &ride_id, sponsor.key().as_ref()],
        bump = pledge.bump,
        has_one = sponsor @ PoolError::AccountMismatch,
        has_one = pool @ PoolError::AccountMismatch,
    )]
    pub pledge: Account<'info, Pledge>,
}

/// The way out for a pledge nobody can settle: the pool failed / was cancelled, or it is over (settled, or active past its
/// settle grace) and the pledged ride has no decided attestation – it never finished, or was never judged. Everything goes back to the sponsor.
/// Permissionless and never paused.
pub fn handle_refund_pledge(ctx: Context<RefundPledge>, ride_id: [u8; 32]) -> Result<()> {
    require!(!ctx.accounts.pledge.settled, PoolError::AlreadySettled);
    require!(ctx.accounts.pledge.ride_id == ride_id, PoolError::AccountMismatch);

    let pool = &ctx.accounts.pool;
    let now = Clock::get()?.unix_timestamp;
    let over = match pool.status {
        STATUS_REFUNDING | STATUS_CANCELLED | STATUS_SETTLED => true,
        STATUS_ACTIVE => now >= pool.grace_end()?,
        _ => false,
    };
    require!(over, PoolError::PledgeNotRefundable);

    let att = ctx.accounts.ride_attestation.to_account_info();
    if att.owner == &crate::ID && !att.data_is_empty() {
        let data = att.try_borrow_data()?;
        let a = RideAttestation::try_deserialize(&mut &data[..])?;
        // a decided attestation blocks the refund only when it is about THIS pledge's driver: a pledge naming another driver than the one who drove
        // the ride can never settle (AttestationMismatch) – without this it could never be refunded either, and its open count would keep every
        // attestation of the pool from closing (a 1-lamport grief)
        require!(a.driver != ctx.accounts.pledge.driver || a.status == ATTESTATION_STATUS_UNVERIFIED, PoolError::AttestationExists);
    }

    let pool = &mut ctx.accounts.pool;
    pool.open_pledges = pool.open_pledges.saturating_sub(1);
    let pledge = &mut ctx.accounts.pledge;
    let refunded = pledge.max_lamports;
    pledge.settled = true;
    pledge.refunded_lamports = refunded;

    emit!(PledgeRefunded {
        ride_id,
        sponsor: pledge.sponsor,
        driver: pledge.driver,
        pool: pledge.pool,
        refunded_lamports: refunded,
    });
    Ok(())
}
