use anchor_lang::prelude::*;

use crate::{
    constants::*,
    error::PoolError,
    events::{PoolClosed, PrizePaid},
    state::{bps_of, split, Config, Pool},
    vault::{pay_from_vault, raw_from_vault, rent_min},
};

#[derive(Accounts)]
#[instruction(pool_id: u32)]
pub struct PayPrize<'info> {
    /// `config.authority` or `config.payout_authority`
    pub authority: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [POOL_SEED, &pool_id.to_le_bytes()], bump = pool.bump)]
    pub pool: Account<'info, Pool>,
    /// CHECK: the escrow, a zero-data system account at the vault PDA
    #[account(mut, seeds = [VAULT_SEED, &pool_id.to_le_bytes()], bump = pool.vault_bump)]
    pub vault: UncheckedAccount<'info>,
    /// CHECK: the winner; must end rent-exempt (checked in the handler)
    #[account(mut, constraint = to.key() != vault.key() @ PoolError::AccountMismatch)]
    pub to: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handle_pay_prize(mut ctx: Context<PayPrize>, pool_id: u32, lamports: u64, rank: u8) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let a = &mut ctx.accounts;
    require!(a.config.may_settle(&a.authority.key()), PoolError::Unauthorized);
    require!(a.pool.status == STATUS_ACTIVE, PoolError::PoolNotActive);
    // nobody pays before the review window is over – not even the admin: the window is what lets anyone check the winners first
    require!(now >= a.pool.payout_at, PoolError::TooEarly);
    require!(lamports > 0, PoolError::InvalidParams);
    let paid = a.pool.prizes_paid.checked_add(lamports).ok_or(PoolError::MathOverflow)?;
    require!(paid <= a.pool.prize_share()?, PoolError::PrizeExceedsShare);
    // the winner's wallet must end rent-exempt (a transfer into a near-empty account below the minimum fails)
    require!(
        a.to.lamports().checked_add(lamports).ok_or(PoolError::MathOverflow)? >= rent_min()?,
        PoolError::BelowRentMin
    );
    pay_from_vault(
        &a.vault.to_account_info(),
        &a.to.to_account_info(),
        &a.system_program.to_account_info(),
        pool_id,
        a.pool.vault_bump,
        lamports,
    )?;
    a.pool.prizes_paid = paid;
    emit!(PrizePaid { pool_id, to: a.to.key(), lamports, rank, prizes_paid_total: paid });
    Ok(())
}

#[derive(Accounts)]
#[instruction(pool_id: u32)]
pub struct ClosePool<'info> {
    /// `config.authority` / `config.payout_authority` from `payout_at`; anyone after the settle grace; anyone for a fully refunded pool.
    pub caller: Signer<'info>,
    /// CHECK: the pool's creator (`pool.authority`); receives the vault's rent-exempt minimum back (it funded it)
    #[account(mut, address = pool.authority @ PoolError::AccountMismatch)]
    pub pool_authority: UncheckedAccount<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [POOL_SEED, &pool_id.to_le_bytes()], bump = pool.bump)]
    pub pool: Account<'info, Pool>,
    /// CHECK: the escrow, a zero-data system account at the vault PDA
    #[account(mut, seeds = [VAULT_SEED, &pool_id.to_le_bytes()], bump = pool.vault_bump)]
    pub vault: UncheckedAccount<'info>,
    /// CHECK: the declared treasury
    #[account(mut, address = pool.seed_treasury @ PoolError::AccountMismatch)]
    pub seed_treasury: UncheckedAccount<'info>,
    /// CHECK: the declared treasury
    #[account(mut, address = pool.fee_treasury @ PoolError::AccountMismatch)]
    pub fee_treasury: UncheckedAccount<'info>,
    /// CHECK: config.platform_treasury
    #[account(mut, address = config.platform_treasury @ PoolError::AccountMismatch)]
    pub platform_treasury: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

/// Ends with the vault at exactly 0. Active pools split `tickets + sponsored`; refunded pools sweep what is left.
pub fn handle_close_pool(mut ctx: Context<ClosePool>, pool_id: u32) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let a = &mut ctx.accounts;
    let min = rent_min()?;
    let cancelled = match a.pool.status {
        STATUS_ACTIVE => {
            require!(now >= a.pool.payout_at, PoolError::TooEarly);
            let grace_end = a.pool.payout_at.checked_add(SETTLE_GRACE_SECS).ok_or(PoolError::MathOverflow)?;
            // The admin or the payout key settles any time after the review window. Anyone else only after the grace, and
            // only if prizes were paid: with prizes_paid == 0 the whole prize share would be swept to the
            // (operator-controlled) seed treasury as "unclaimed", so that pool must go expire_pool -> refunds.
            if !a.config.may_settle(&a.caller.key()) {
                require!(now >= grace_end, PoolError::Unauthorized);
                require!(a.pool.prizes_paid > 0, PoolError::MustExpire);
            }
            false
        }
        STATUS_REFUNDING => {
            // permissionless; every buyer must have been refunded first
            require!(a.pool.refunded == a.pool.tickets_lamports()?, PoolError::RefundsPending);
            true
        }
        _ => return err!(PoolError::PoolNotActive),
    };

    let vault_total = a.vault.lamports();
    let distributable = vault_total.checked_sub(min).ok_or(PoolError::BelowRentMin)?;
    let (fee_out, platform_out, unclaimed) = if cancelled {
        (0, 0, 0)
    } else {
        let (prize, _seed, fee) = split(a.pool.pot()?, a.pool.prize_bps, a.pool.seed_bps)?;
        let platform = bps_of(fee, a.config.platform_fee_bps)?;
        (fee - platform, platform, prize.checked_sub(a.pool.prizes_paid).ok_or(PoolError::MathOverflow)?)
    };
    // Everything that is not fee, platform cut or the rent minimum goes to the seed treasury:
    // its share, the unclaimed prize, and any stray lamports someone sent straight to the vault.
    let seed_out = distributable
        .checked_sub(fee_out)
        .and_then(|v| v.checked_sub(platform_out))
        .ok_or(PoolError::BelowRentMin)?;

    let vault = a.vault.to_account_info();
    let sys = a.system_program.to_account_info();
    let vb = a.pool.vault_bump;
    raw_from_vault(&vault, &a.fee_treasury.to_account_info(), &sys, pool_id, vb, fee_out)?;
    raw_from_vault(&vault, &a.platform_treasury.to_account_info(), &sys, pool_id, vb, platform_out)?;
    raw_from_vault(&vault, &a.seed_treasury.to_account_info(), &sys, pool_id, vb, seed_out)?;
    raw_from_vault(&vault, &a.pool_authority.to_account_info(), &sys, pool_id, vb, min)?;
    require!(a.vault.lamports() == 0, PoolError::BelowRentMin);

    a.pool.status = if cancelled { STATUS_CANCELLED } else { STATUS_SETTLED };
    emit!(PoolClosed {
        pool_id,
        prize_paid: a.pool.prizes_paid,
        seed: seed_out,
        fee: fee_out,
        platform_fee: platform_out,
        unclaimed,
        rent_returned: min,
        cancelled,
    });
    Ok(())
}
