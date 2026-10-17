use anchor_lang::{
    prelude::*,
    system_program::{transfer, Transfer},
};

use crate::{
    constants::*,
    error::PoolError,
    events::PoolCreated,
    state::{Config, Pool},
    vault::rent_min,
};

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct CreatePoolParams {
    pub tier: u8,
    pub price_lamports: u64,
    pub min_tickets: u32,
    /// 0 = unlimited
    pub max_tickets: u32,
    pub max_per_wallet: u16,
    /// end of the sale window: no ticket is sold from here on; under the minimum the pool can only fail (refunds)
    pub prep_deadline: i64,
    /// rides count until here
    pub play_deadline: i64,
    /// end of the review window: prizes and the close only from here on
    pub payout_at: i64,
    pub prize_bps: u16,
    pub seed_bps: u16,
    pub fee_bps: u16,
}

#[derive(Accounts)]
pub struct CreatePool<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = authority @ PoolError::Unauthorized)]
    pub config: Account<'info, Config>,
    #[account(
        init,
        payer = authority,
        space = 8 + Pool::INIT_SPACE,
        seeds = [POOL_SEED, &config.pool_count.to_le_bytes()],
        bump
    )]
    pub pool: Account<'info, Pool>,
    /// CHECK: zero-data system account at the vault PDA; funded here with the rent-exempt minimum
    #[account(mut, seeds = [VAULT_SEED, &config.pool_count.to_le_bytes()], bump)]
    pub vault: UncheckedAccount<'info>,
    /// CHECK: only its lamports are read (must already be rent-exempt)
    pub fee_treasury: UncheckedAccount<'info>,
    /// CHECK: only its lamports are read (must already be rent-exempt)
    pub seed_treasury: UncheckedAccount<'info>,
    /// CHECK: must equal config.platform_treasury and be rent-exempt
    #[account(address = config.platform_treasury @ PoolError::AccountMismatch)]
    pub platform_treasury: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

/// The money rules every pool keeps, whoever creates it (`create_pool`, `set_series`).
pub fn check_money_rules(price_lamports: u64, min_tickets: u32, max_tickets: u32, max_per_wallet: u16, bps: [u16; 3]) -> Result<()> {
    require!(price_lamports > 0 && min_tickets >= 1, PoolError::InvalidParams);
    // refunds must be able to land in an empty wallet: a price below the minimum would brick them
    require!(price_lamports >= rent_min()?, PoolError::PriceBelowRentMin);
    require!(max_tickets == 0 || max_tickets >= min_tickets, PoolError::InvalidParams);
    require!(max_per_wallet >= 1, PoolError::InvalidParams);
    require!(bps.iter().map(|b| *b as u32).sum::<u32>() == BPS_DENOM as u32, PoolError::BpsSum);
    Ok(())
}

/// v4: the windows every new pool keeps (Config floors): `finish` after the sale (the last call: no sale, no new ride – the shifts on the road
/// finish), `review` after the play deadline (audit H5).
pub fn check_windows(config: &Account<Config>, finish: i64, review: i64) -> Result<()> {
    crate::state::require_migrated(config)?;
    require!(finish >= config.min_finish_secs && review >= config.min_review_secs, PoolError::WindowTooShort);
    Ok(())
}

/// The three treasuries must already hold the rent-exempt minimum (a close into an empty account below it would fail).
pub fn check_treasuries(treasuries: [&AccountInfo; 3]) -> Result<()> {
    let min = rent_min()?;
    for t in treasuries {
        require!(t.lamports() >= min, PoolError::TreasuryNotRentExempt);
    }
    Ok(())
}

pub fn handle_create_pool(ctx: Context<CreatePool>, p: CreatePoolParams) -> Result<()> {
    let a = &ctx.accounts;
    require!(!a.config.paused, PoolError::Paused);
    let now = Clock::get()?.unix_timestamp;
    check_money_rules(p.price_lamports, p.min_tickets, p.max_tickets, p.max_per_wallet, [p.prize_bps, p.seed_bps, p.fee_bps])?;
    require!(
        p.prep_deadline > now && p.play_deadline >= p.prep_deadline && p.payout_at >= p.play_deadline,
        PoolError::InvalidParams
    );
    require!(p.payout_at - now <= MAX_POOL_SECS, PoolError::InvalidParams);
    check_windows(&a.config, p.play_deadline - p.prep_deadline, p.payout_at - p.play_deadline)?;
    check_treasuries([&a.fee_treasury.to_account_info(), &a.seed_treasury.to_account_info(), &a.platform_treasury.to_account_info()])?;

    let creator = a.authority.to_account_info();
    let rules = PoolRules {
        tier: p.tier,
        price_lamports: p.price_lamports,
        min_tickets: p.min_tickets,
        max_tickets: p.max_tickets,
        max_per_wallet: p.max_per_wallet,
        prep_deadline: p.prep_deadline,
        play_deadline: p.play_deadline,
        payout_at: p.payout_at,
        prize_bps: p.prize_bps,
        seed_bps: p.seed_bps,
        fee_bps: p.fee_bps,
        fee_treasury: a.fee_treasury.key(),
        seed_treasury: a.seed_treasury.key(),
    };
    let (pool_bump, vault_bump) = (ctx.bumps.pool, ctx.bumps.vault);
    let a = ctx.accounts;
    init_pool(&mut a.config, &mut a.pool, &a.vault.to_account_info(), &creator, &a.system_program, rules, now, pool_bump, vault_bump, false)?;
    Ok(())
}

/// Everything a new pool is made of (the schedule already resolved to timestamps).
pub struct PoolRules {
    pub tier: u8,
    pub price_lamports: u64,
    pub min_tickets: u32,
    pub max_tickets: u32,
    pub max_per_wallet: u16,
    pub prep_deadline: i64,
    pub play_deadline: i64,
    pub payout_at: i64,
    pub prize_bps: u16,
    pub seed_bps: u16,
    pub fee_bps: u16,
    pub fee_treasury: Pubkey,
    pub seed_treasury: Pubkey,
}

/// The road seed's commitment: SHA-256(pool_id LE u32 || hash || slot LE u64) of one SlotHashes entry (`seal_road`, road.rs) – the server derives the
/// pool's road from it (server/src/domain/road/provable-seed.ts).
pub fn seed_commitment(pool_id: u32, slot: u64, hash: &[u8; 32]) -> [u8; 32] {
    solana_sha256_hasher::hashv(&[&pool_id.to_le_bytes(), hash, &slot.to_le_bytes()]).to_bytes()
}

/// Funds the vault with the rent minimum from `creator` (it gets it back at close, as `pool.authority`), takes the next pool id and writes the pool.
#[allow(clippy::too_many_arguments)]
pub fn init_pool<'info>(
    config: &mut Account<'info, Config>,
    pool: &mut Account<'info, Pool>,
    vault: &AccountInfo<'info>,
    creator: &AccountInfo<'info>,
    system_program: &Program<'info, System>,
    r: PoolRules,
    now: i64,
    pool_bump: u8,
    vault_bump: u8,
    from_series: bool,
) -> Result<u32> {
    transfer(
        CpiContext::new(system_program.key(), Transfer { from: creator.clone(), to: vault.clone() }),
        rent_min()?,
    )?;
    let pool_id = config.pool_count;
    // v4 (audit L4): the road is NOT taken from the newest slot hash now – the opener could pick that moment and grind the road; it is sealed
    // from a slot a few slots ahead, which nobody can know yet (`seal_road`). Until then no ride is served.
    let seal_slot = Clock::get()?.slot.checked_add(SEAL_DELAY_SLOTS).ok_or(PoolError::MathOverflow)?;
    config.pool_count = pool_id.checked_add(1).ok_or(PoolError::MathOverflow)?;

    pool.pool_id = pool_id;
    pool.authority = creator.key();
    pool.tier = r.tier;
    pool.price_lamports = r.price_lamports;
    pool.min_tickets = r.min_tickets;
    pool.max_tickets = r.max_tickets;
    pool.max_per_wallet = r.max_per_wallet;
    pool.prep_deadline = r.prep_deadline;
    pool.play_deadline = r.play_deadline;
    pool.payout_at = r.payout_at;
    pool.prize_bps = r.prize_bps;
    pool.seed_bps = r.seed_bps;
    pool.fee_bps = r.fee_bps;
    pool.fee_treasury = r.fee_treasury;
    pool.seed_treasury = r.seed_treasury;
    pool.status = STATUS_OPEN;
    pool.tickets_sold = 0;
    pool.buyers = 0;
    pool.sponsored = 0;
    pool.prizes_paid = 0;
    pool.refunded = 0;
    pool.created_at = now;
    pool.bump = pool_bump;
    pool.vault_bump = vault_bump;
    pool.seed_commitment = [0; 32];
    pool.seed_slot = 0;
    pool.seed_slot_hash = [0; 32];
    pool.seal_slot = seal_slot;
    pool.platform_fee_bps = config.platform_fee_bps;
    pool.winners_root = [0; 32];
    pool.winners_total = 0;
    pool.winners_count = 0;
    pool.committed_at = 0;
    pool.pay_from = 0;
    pool.paid_mask = 0;
    pool.sponsor_refunded = 0;
    pool.open_pledges = 0;
    pool.min_review_secs = config.min_review_secs;

    emit!(PoolCreated {
        pool_id,
        pool: pool.key(),
        vault: vault.key(),
        authority: creator.key(),
        tier: r.tier,
        price_lamports: r.price_lamports,
        min_tickets: r.min_tickets,
        max_tickets: r.max_tickets,
        max_per_wallet: r.max_per_wallet,
        prep_deadline: r.prep_deadline,
        play_deadline: r.play_deadline,
        payout_at: r.payout_at,
        prize_bps: r.prize_bps,
        seed_bps: r.seed_bps,
        fee_bps: r.fee_bps,
        fee_treasury: r.fee_treasury,
        seed_treasury: r.seed_treasury,
        from_series,
        // v4: nothing sealed yet – `seed_slot` is the TARGET slot, the commitment follows in RoadSealed
        seed_commitment: [0; 32],
        seed_slot: seal_slot,
        seed_slot_hash: [0; 32],
    });
    Ok(pool_id)
}
