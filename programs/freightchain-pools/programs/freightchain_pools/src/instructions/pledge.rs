use anchor_lang::{
    prelude::*,
    system_program::{transfer, Transfer},
};

use crate::{
    constants::*,
    error::PoolError,
    events::{PledgeCreated, PledgeSettled},
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
    /// Settlement is permissionless: anyone can crank it once attestation is available
    pub caller: Signer<'info>,

    /// CHECK: Driver wallet receiving earned lamports
    #[account(mut, address = pledge.driver @ PoolError::AccountMismatch)]
    pub driver: UncheckedAccount<'info>,

    /// CHECK: Sponsor wallet receiving unearned refund
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
        seeds = [PLEDGE_SEED, &ride_id, sponsor.key().as_ref()],
        bump = pledge.bump,
        has_one = sponsor @ PoolError::AccountMismatch,
        has_one = driver @ PoolError::AccountMismatch,
        has_one = pool @ PoolError::AccountMismatch,
    )]
    pub pledge: Account<'info, Pledge>,

    pub system_program: Program<'info, System>,
}

pub fn handle_settle_pledge(ctx: Context<SettlePledge>, ride_id: [u8; 32]) -> Result<()> {
    require!(!ctx.accounts.pledge.settled, PoolError::AlreadySettled);
    require!(ctx.accounts.pledge.ride_id == ride_id, PoolError::AccountMismatch);

    let attestation = &ctx.accounts.attestation;
    require!(
        attestation.status != ATTESTATION_STATUS_UNVERIFIED,
        PoolError::UnverifiedAttestation
    );

    let total_lamports = ctx.accounts.pledge.max_lamports;
    let target_km = ctx.accounts.pledge.target_km;
    let sponsor_key = ctx.accounts.pledge.sponsor;
    let driver_key = ctx.accounts.pledge.driver;
    let pool_key = ctx.accounts.pledge.pool;

    let (earned, refund, verified_km) = if attestation.status == ATTESTATION_STATUS_FLAGGED {
        // Driver was flagged: zero earnings, full refund to sponsor
        (0u64, total_lamports, 0u32)
    } else {
        let v_km = attestation.verified_km;
        let effective_km = v_km.min(target_km);
        let e = ((total_lamports as u128)
            .checked_mul(effective_km as u128)
            .ok_or(PoolError::MathOverflow)?
            / (target_km as u128)) as u64;
        let r = total_lamports.checked_sub(e).ok_or(PoolError::MathOverflow)?;
        (e, r, v_km)
    };

    // Assert zero stranded lamports invariant
    require!(
        earned.checked_add(refund).ok_or(PoolError::MathOverflow)? == total_lamports,
        PoolError::MathOverflow
    );

    let pledge_info = ctx.accounts.pledge.to_account_info();
    let driver_info = ctx.accounts.driver.to_account_info();
    let sponsor_info = ctx.accounts.sponsor.to_account_info();

    // Check rent-exempt minimum for driver if receiving funds
    if earned > 0 {
        require!(
            driver_info.lamports().checked_add(earned).ok_or(PoolError::MathOverflow)? >= rent_min()?,
            PoolError::BelowRentMin
        );
        **pledge_info.try_borrow_mut_lamports()? = pledge_info
            .lamports()
            .checked_sub(earned)
            .ok_or(PoolError::MathOverflow)?;
        **driver_info.try_borrow_mut_lamports()? = driver_info
            .lamports()
            .checked_add(earned)
            .ok_or(PoolError::MathOverflow)?;
    }

    if refund > 0 {
        **pledge_info.try_borrow_mut_lamports()? = pledge_info
            .lamports()
            .checked_sub(refund)
            .ok_or(PoolError::MathOverflow)?;
        **sponsor_info.try_borrow_mut_lamports()? = sponsor_info
            .lamports()
            .checked_add(refund)
            .ok_or(PoolError::MathOverflow)?;
    }

    // Ensure pledge account retains exact rent-exempt balance
    require!(pledge_info.lamports() >= rent_min()?, PoolError::BelowRentMin);

    let pledge = &mut ctx.accounts.pledge;
    pledge.settled = true;
    pledge.earned_lamports = earned;
    pledge.refunded_lamports = refund;

    emit!(PledgeSettled {
        ride_id,
        sponsor: sponsor_key,
        driver: driver_key,
        pool: pool_key,
        verified_km,
        target_km,
        earned_lamports: earned,
        refunded_lamports: refund,
    });

    Ok(())
}
