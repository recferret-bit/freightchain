use anchor_lang::{
    prelude::*,
    system_program::{transfer, Transfer},
};

use crate::{
    constants::*,
    error::PoolError,
    events::{PledgeCreated, PledgeRefunded, PledgeSettled},
    state::{Attestation, Config, Pool, Pledge},
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

    #[account(seeds = [POOL_SEED, &pool.pool_id.to_le_bytes()], bump = pool.bump)]
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

    let clock = Clock::get()?;
    let pledge = &mut ctx.accounts.pledge;
    pledge.ride_id = ride_id;
    pledge.sponsor = ctx.accounts.sponsor.key();
    pledge.driver = driver;
    pledge.pool = pool.key();
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

    #[account(seeds = [POOL_SEED, &pool.pool_id.to_le_bytes()], bump = pool.bump)]
    pub pool: Account<'info, Pool>,

    #[account(
        seeds = [ATTESTATION_SEED, pool.key().as_ref(), driver.key().as_ref()],
        bump = attestation.bump,
        constraint = attestation.pool == pool.key() @ PoolError::AccountMismatch,
        constraint = attestation.driver == driver.key() @ PoolError::AccountMismatch,
    )]
    pub attestation: Account<'info, Attestation>,

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
/// account's rent go back to the sponsor. A FLAGGED attestation earns nothing (full refund). The attestation is per pool
/// and driver (the driver's best verified ride in the pool), so a pledge settles on that ride.
pub fn handle_settle_pledge(ctx: Context<SettlePledge>, ride_id: [u8; 32]) -> Result<()> {
    require!(!ctx.accounts.pledge.settled, PoolError::AlreadySettled);
    require!(ctx.accounts.pledge.ride_id == ride_id, PoolError::AccountMismatch);

    let attestation = &ctx.accounts.attestation;
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
    // A driver account that would stay below the rent minimum cannot take lamports (the runtime refuses it); rather than
    // lock the pledge forever, the sponsor gets it all back.
    if earned > 0 && driver_info.lamports().checked_add(earned).ok_or(PoolError::MathOverflow)? < rent_min()? {
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

    #[account(seeds = [POOL_SEED, &pool.pool_id.to_le_bytes()], bump = pool.bump)]
    pub pool: Account<'info, Pool>,

    /// CHECK: the driver's attestation PDA for this pool; it must not hold a decided (verified / flagged) attestation
    #[account(seeds = [ATTESTATION_SEED, pool.key().as_ref(), pledge.driver.as_ref()], bump)]
    pub attestation: UncheckedAccount<'info>,

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
/// settle grace) and the driver has no decided attestation – no finished, judged ride. Everything goes back to the sponsor.
pub fn handle_refund_pledge(ctx: Context<RefundPledge>, ride_id: [u8; 32]) -> Result<()> {
    require!(!ctx.accounts.pledge.settled, PoolError::AlreadySettled);
    require!(ctx.accounts.pledge.ride_id == ride_id, PoolError::AccountMismatch);

    let pool = &ctx.accounts.pool;
    let now = Clock::get()?.unix_timestamp;
    let over = match pool.status {
        STATUS_REFUNDING | STATUS_CANCELLED | STATUS_SETTLED => true,
        STATUS_ACTIVE => now >= pool.payout_at.checked_add(SETTLE_GRACE_SECS).ok_or(PoolError::MathOverflow)?,
        _ => false,
    };
    require!(over, PoolError::PledgeNotRefundable);

    let att = ctx.accounts.attestation.to_account_info();
    if att.owner == &crate::ID && !att.data_is_empty() {
        let data = att.try_borrow_data()?;
        let a = Attestation::try_deserialize(&mut &data[..])?;
        require!(a.status == ATTESTATION_STATUS_UNVERIFIED, PoolError::AttestationExists);
    }

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
