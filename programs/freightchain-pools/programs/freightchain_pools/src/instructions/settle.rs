use anchor_lang::prelude::*;

use crate::{
    constants::*,
    error::PoolError,
    events::{PoolClosed, PrizePaid, WinnersCommitted, WinnersVetoed},
    state::{bps_of, merkle_root_from, split, winner_leaf, Config, Pool},
    vault::{pay_from_vault, raw_from_vault, rent_min},
};

#[derive(Accounts)]
#[instruction(pool_id: u32)]
pub struct CommitWinners<'info> {
    /// `config.authority` or `config.payout_authority`
    pub authority: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [POOL_SEED, &pool_id.to_le_bytes()], bump = pool.bump)]
    pub pool: Account<'info, Pool>,
}

/// v4 (audit H5-B): the payout key (or the admin) writes the pool's winners once its rides are over – a Merkle root over (rank, wallet, lamports),
/// public for the whole review lock before any of them can be paid (`pay_from`); a wrong root is vetoed by the cold admin in that time. `count = 0`:
/// no winner (the pool then closes with its prize share unclaimed).
pub fn handle_commit_winners(mut ctx: Context<CommitWinners>, pool_id: u32, root: [u8; 32], total: u64, count: u8) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let a = &mut ctx.accounts;
    require!(a.config.may_settle(&a.authority.key()), PoolError::Unauthorized);
    crate::state::require_migrated(&a.config)?;
    require!(!a.config.paused_before_grace(&a.pool, now)?, PoolError::Paused);
    require!(a.pool.status == STATUS_ACTIVE, PoolError::PoolNotActive);
    require!(now >= a.pool.play_deadline, PoolError::TooEarly);
    require!(!a.pool.has_winners(), PoolError::WinnersCommitted);
    require!(count <= MAX_WINNERS, PoolError::TooManyWinners);
    require!(total <= a.pool.prize_share()?, PoolError::PrizeExceedsShare);
    if count == 0 {
        require!(total == 0 && root == [0u8; 32], PoolError::InvalidParams);
    } else {
        require!(total > 0 && root != [0u8; 32], PoolError::InvalidParams);
    }
    let pay_from = a.config.pay_from(&a.pool, now)?;
    // rule f: after the grace anyone may close the pool and sweep what is unpaid – a root whose lock ends that late could never be paid in time
    require!(pay_from <= a.pool.grace_end()?.checked_sub(COMMIT_GRACE_MARGIN_SECS).ok_or(PoolError::MathOverflow)?, PoolError::CommitTooLate);
    let p = &mut a.pool;
    p.winners_root = root;
    p.winners_total = total;
    p.winners_count = count;
    p.committed_at = now;
    p.pay_from = pay_from;
    p.paid_mask = 0;
    emit!(WinnersCommitted { pool_id, root, total, count, committed_at: now, pay_from, by: a.authority.key() });
    Ok(())
}

#[derive(Accounts)]
#[instruction(pool_id: u32)]
pub struct VetoWinners<'info> {
    /// the cold admin only – never the payout key
    pub authority: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = authority @ PoolError::Unauthorized)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [POOL_SEED, &pool_id.to_le_bytes()], bump = pool.bump)]
    pub pool: Account<'info, Pool>,
}

/// v4: the admin strikes a committed root before any of it is paid (a verdict changed in review, or the payout key was stolen); the payout key
/// commits again and the lock starts over. Works while paused.
pub fn handle_veto_winners(ctx: Context<VetoWinners>, pool_id: u32) -> Result<()> {
    let p = &mut ctx.accounts.pool;
    require!(p.status == STATUS_ACTIVE, PoolError::PoolNotActive);
    require!(p.has_winners(), PoolError::WinnersNotCommitted);
    require!(p.paid_mask == 0, PoolError::WinnersPartlyPaid);
    let root = p.winners_root;
    p.winners_root = [0; 32];
    p.winners_total = 0;
    p.winners_count = 0;
    p.committed_at = 0;
    p.pay_from = 0;
    emit!(WinnersVetoed { pool_id, root });
    Ok(())
}

#[derive(Accounts)]
#[instruction(pool_id: u32)]
pub struct PayPrize<'info> {
    /// anyone – the committed root decides who gets what
    pub caller: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [POOL_SEED, &pool_id.to_le_bytes()], bump = pool.bump)]
    pub pool: Account<'info, Pool>,
    /// CHECK: the escrow, a zero-data system account at the vault PDA
    #[account(mut, seeds = [VAULT_SEED, &pool_id.to_le_bytes()], bump = pool.vault_bump)]
    pub vault: UncheckedAccount<'info>,
    /// CHECK: the winner – its key is in the proven leaf; must end rent-exempt (checked in the handler)
    #[account(mut, constraint = to.key() != vault.key() @ PoolError::AccountMismatch)]
    pub to: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

/// v4 (audit H5-B / M6): permissionless – pays rank `rank` exactly what the committed root says, to the wallet it names, once, and not before the
/// root's lock (`pool.pay_from`) is over.
pub fn handle_pay_prize(mut ctx: Context<PayPrize>, pool_id: u32, rank: u8, lamports: u64, proof: Vec<[u8; 32]>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let a = &mut ctx.accounts;
    require!(a.pool.status == STATUS_ACTIVE, PoolError::PoolNotActive);
    require!(a.pool.has_winners(), PoolError::WinnersNotCommitted);
    require!(!a.config.paused_before_grace(&a.pool, now)?, PoolError::Paused);
    require!(now >= a.pool.pay_from, PoolError::TooEarly);
    require!(lamports > 0 && rank < a.pool.winners_count, PoolError::InvalidParams);
    let bit = 1u64 << rank;
    require!(a.pool.paid_mask & bit == 0, PoolError::RankAlreadyPaid);
    let leaf = winner_leaf(pool_id, rank, &a.to.key(), lamports);
    let root = merkle_root_from(leaf, rank as u32, a.pool.winners_count as u32, &proof).ok_or(PoolError::InvalidProof)?;
    require!(root == a.pool.winners_root, PoolError::InvalidProof);

    let paid = a.pool.prizes_paid.checked_add(lamports).ok_or(PoolError::MathOverflow)?;
    require!(paid <= a.pool.winners_total && paid <= a.pool.prize_share()?, PoolError::PrizeExceedsShare);
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
    a.pool.paid_mask |= bit;
    emit!(PrizePaid { pool_id, to: a.to.key(), lamports, rank, prizes_paid_total: paid });
    Ok(())
}

#[derive(Accounts)]
#[instruction(pool_id: u32)]
pub struct ClosePool<'info> {
    /// `config.authority` / `config.payout_authority` once every committed rank is paid; anyone after the settle grace; anyone for a fully refunded pool.
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
            let grace_end = a.pool.grace_end()?;
            if now < grace_end {
                // v4 (H5-B): before the grace only the admin / payout key, and only once the committed root is out of its lock and fully paid –
                // the payout key can no longer close a pool to sweep its winners' prizes into the seed treasury.
                require!(a.config.may_settle(&a.caller.key()), PoolError::Unauthorized);
                require!(!a.config.paused, PoolError::Paused);
                require!(a.pool.has_winners(), PoolError::WinnersNotCommitted);
                require!(now >= a.pool.pay_from, PoolError::TooEarly);
                require!(a.pool.all_winners_paid(), PoolError::PrizesUnpaid);
            } else {
                // After the grace anyone – but only if prizes were paid: with prizes_paid == 0 the whole prize share would be swept to the
                // (operator-controlled) seed treasury as "unclaimed", so that pool must go expire_pool -> refunds.
                require!(a.pool.prizes_paid > 0, PoolError::MustExpire);
            }
            false
        }
        STATUS_REFUNDING => {
            // permissionless; every buyer and every sponsor (v4, M8) must have been refunded first
            require!(a.pool.refunded == a.pool.tickets_lamports()?, PoolError::RefundsPending);
            require!(a.pool.sponsor_refunded == a.pool.sponsored, PoolError::SponsorRefundsPending);
            true
        }
        _ => return err!(PoolError::PoolNotActive),
    };

    let vault_total = a.vault.lamports();
    let distributable = vault_total.checked_sub(min).ok_or(PoolError::BelowRentMin)?;
    let (fee_out, platform_out, unclaimed) = if cancelled {
        (0, 0, 0)
    } else {
        // v5: the split is on counted tickets + sponsorship. Excess ticket lamports stay in the vault and fall into seed_out (the next pool).
        let (prize, _seed, fee) = split(a.pool.counted_pot()?, a.pool.prize_bps, a.pool.seed_bps)?;
        let platform = bps_of(fee, a.pool.platform_fee_bps)?;   // v4 (L8): the cut the pool opened with
        (fee - platform, platform, prize.checked_sub(a.pool.prizes_paid).ok_or(PoolError::MathOverflow)?)
    };
    let ticket_excess = if cancelled { 0 } else { a.pool.ticket_excess()? };
    // Everything that is not fee, platform cut or the rent minimum goes to the seed treasury:
    // its share, the unclaimed prize and referral, and any stray lamports someone sent straight to the vault.
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
        ticket_excess,
    });
    Ok(())
}
