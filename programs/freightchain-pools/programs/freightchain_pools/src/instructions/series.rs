use anchor_lang::prelude::*;

use crate::{
    constants::*,
    error::PoolError,
    events::SeriesSet,
    instructions::create_pool::{check_money_rules, check_treasuries, check_windows, init_pool, PoolRules},
    state::{Config, Pool, Series},
};

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct SeriesParams {
    pub tier: u8,
    pub enabled: bool,
    pub price_lamports: u64,
    pub min_tickets: u32,
    /// 0 = unlimited
    pub max_tickets: u32,
    pub max_per_wallet: u16,
    /// sale window AND cadence: the next pool opens when this one stops selling
    pub sale_secs: i64,
    /// rides still count this long after the sale ends
    pub play_secs: i64,
    /// review window after the play deadline, before any prize
    pub verify_secs: i64,
    pub prize_bps: u16,
    pub seed_bps: u16,
    pub fee_bps: u16,
    /// the first sale slot starts here; 0 = keep the series' current `next_open_at` (refused for a new series)
    pub start_at: i64,
}

#[derive(Accounts)]
#[instruction(params: SeriesParams)]
pub struct SetSeries<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = authority @ PoolError::Unauthorized)]
    pub config: Account<'info, Config>,
    #[account(
        init_if_needed,
        payer = authority,
        space = 8 + Series::INIT_SPACE,
        seeds = [SERIES_SEED, &[params.tier]],
        bump
    )]
    pub series: Account<'info, Series>,
    /// CHECK: only its lamports are read (must already be rent-exempt); recorded as the series' fee treasury
    pub fee_treasury: UncheckedAccount<'info>,
    /// CHECK: only its lamports are read (must already be rent-exempt); recorded as the series' seed treasury
    pub seed_treasury: UncheckedAccount<'info>,
    /// CHECK: must equal config.platform_treasury and be rent-exempt
    #[account(address = config.platform_treasury @ PoolError::AccountMismatch)]
    pub platform_treasury: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

/// Admin: write (or rewrite) the schedule of a tier. Pools already opened keep their own rules; the next one takes these.
pub fn handle_set_series(ctx: Context<SetSeries>, p: SeriesParams) -> Result<()> {
    let a = &ctx.accounts;
    check_money_rules(p.price_lamports, p.min_tickets, p.max_tickets, p.max_per_wallet, [p.prize_bps, p.seed_bps, p.fee_bps])?;
    require!((MIN_SALE_SECS..=MAX_SALE_SECS).contains(&p.sale_secs), PoolError::InvalidParams);
    require!(p.play_secs >= 0 && p.verify_secs >= 0, PoolError::InvalidParams);
    // the floors are checked here, not at every open: raising one later does not stop a running series
    check_windows(&a.config, p.play_secs, p.verify_secs)?;
    let span = p.sale_secs.checked_add(p.play_secs).and_then(|v| v.checked_add(p.verify_secs)).ok_or(PoolError::MathOverflow)?;
    require!(span <= MAX_POOL_SECS, PoolError::InvalidParams);
    check_treasuries([&a.fee_treasury.to_account_info(), &a.seed_treasury.to_account_info(), &a.platform_treasury.to_account_info()])?;
    let fresh = a.series.sale_secs == 0; // an init_if_needed account starts zeroed; a live series always has sale_secs >= MIN_SALE_SECS
    require!(p.start_at > 0 || !fresh, PoolError::InvalidParams);
    if p.start_at > 0 {
        // a start further out than a year would park the schedule (nothing to do with funds, but certainly a typo)
        let now = Clock::get()?.unix_timestamp;
        require!(p.start_at - now <= MAX_POOL_SECS, PoolError::InvalidParams);
    }

    let fee_treasury = a.fee_treasury.key();
    let seed_treasury = a.seed_treasury.key();
    let s = &mut ctx.accounts.series;
    if fresh {
        s.tier = p.tier;
        s.pools_opened = 0;
        s.last_pool_id = None;
        s.bump = ctx.bumps.series;
    }
    s.enabled = p.enabled;
    s.price_lamports = p.price_lamports;
    s.min_tickets = p.min_tickets;
    s.max_tickets = p.max_tickets;
    s.max_per_wallet = p.max_per_wallet;
    s.sale_secs = p.sale_secs;
    s.play_secs = p.play_secs;
    s.verify_secs = p.verify_secs;
    s.prize_bps = p.prize_bps;
    s.seed_bps = p.seed_bps;
    s.fee_bps = p.fee_bps;
    s.fee_treasury = fee_treasury;
    s.seed_treasury = seed_treasury;
    if p.start_at > 0 {
        s.next_open_at = p.start_at;
    }
    emit!(SeriesSet {
        tier: s.tier,
        enabled: s.enabled,
        price_lamports: s.price_lamports,
        min_tickets: s.min_tickets,
        max_tickets: s.max_tickets,
        max_per_wallet: s.max_per_wallet,
        sale_secs: s.sale_secs,
        play_secs: s.play_secs,
        verify_secs: s.verify_secs,
        prize_bps: s.prize_bps,
        seed_bps: s.seed_bps,
        fee_bps: s.fee_bps,
        fee_treasury,
        seed_treasury,
        next_open_at: s.next_open_at,
    });
    Ok(())
}

#[derive(Accounts)]
#[instruction(tier: u8)]
pub struct OpenNextPool<'info> {
    /// Anyone (the server's crank in practice): pays the Pool account rent and the vault rent minimum, which comes back at close.
    #[account(mut)]
    pub caller: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [SERIES_SEED, &[tier]], bump = series.bump)]
    pub series: Account<'info, Series>,
    #[account(
        init,
        payer = caller,
        space = 8 + Pool::INIT_SPACE,
        seeds = [POOL_SEED, &config.pool_count.to_le_bytes()],
        bump
    )]
    pub pool: Account<'info, Pool>,
    /// CHECK: zero-data system account at the vault PDA; funded here with the rent-exempt minimum
    #[account(mut, seeds = [VAULT_SEED, &config.pool_count.to_le_bytes()], bump)]
    pub vault: UncheckedAccount<'info>,
    /// CHECK: the series' fee treasury (must still be rent-exempt)
    #[account(address = series.fee_treasury @ PoolError::AccountMismatch)]
    pub fee_treasury: UncheckedAccount<'info>,
    /// CHECK: the series' seed treasury (must still be rent-exempt)
    #[account(address = series.seed_treasury @ PoolError::AccountMismatch)]
    pub seed_treasury: UncheckedAccount<'info>,
    /// CHECK: config.platform_treasury
    #[account(address = config.platform_treasury @ PoolError::AccountMismatch)]
    pub platform_treasury: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

/// Permissionless: once the series' slot has come, open the pool of the CURRENT slot from the series' rules. Slots sit on a fixed grid
/// (`next_open_at + k * sale_secs`), so a late caller never shifts the schedule – a slot nobody opened in time is skipped, and the pool of
/// the current slot just sells for what is left of it. One pool per slot: `next_open_at` moves to this pool's sale end.
pub fn handle_open_next_pool(ctx: Context<OpenNextPool>, tier: u8) -> Result<()> {
    let a = &ctx.accounts;
    require!(!a.config.paused, PoolError::Paused);
    require!(a.series.enabled, PoolError::SeriesDisabled);
    let now = Clock::get()?.unix_timestamp;
    let s = &a.series;
    require!(now >= s.next_open_at, PoolError::TooEarly);
    let missed = (now - s.next_open_at) / s.sale_secs;
    let slot = s.next_open_at.checked_add(missed.checked_mul(s.sale_secs).ok_or(PoolError::MathOverflow)?).ok_or(PoolError::MathOverflow)?;
    let sale_end = slot.checked_add(s.sale_secs).ok_or(PoolError::MathOverflow)?;
    let play = sale_end.checked_add(s.play_secs).ok_or(PoolError::MathOverflow)?;
    let payout = play.checked_add(s.verify_secs).ok_or(PoolError::MathOverflow)?;
    // the rent minimum can change between set_series and now: the money rules are checked again
    check_money_rules(s.price_lamports, s.min_tickets, s.max_tickets, s.max_per_wallet, [s.prize_bps, s.seed_bps, s.fee_bps])?;
    check_treasuries([&a.fee_treasury.to_account_info(), &a.seed_treasury.to_account_info(), &a.platform_treasury.to_account_info()])?;

    let rules = PoolRules {
        tier,
        price_lamports: s.price_lamports,
        min_tickets: s.min_tickets,
        max_tickets: s.max_tickets,
        max_per_wallet: s.max_per_wallet,
        prep_deadline: sale_end,
        play_deadline: play,
        payout_at: payout,
        prize_bps: s.prize_bps,
        seed_bps: s.seed_bps,
        fee_bps: s.fee_bps,
        fee_treasury: s.fee_treasury,
        seed_treasury: s.seed_treasury,
    };
    let creator = a.caller.to_account_info();
    let (pool_bump, vault_bump) = (ctx.bumps.pool, ctx.bumps.vault);
    let a = ctx.accounts;
    let pool_id = init_pool(&mut a.config, &mut a.pool, &a.vault.to_account_info(), &creator, &a.system_program, rules, now, pool_bump, vault_bump, true)?;
    let s = &mut a.series;
    s.next_open_at = sale_end;
    s.pools_opened = s.pools_opened.checked_add(1).ok_or(PoolError::MathOverflow)?;
    s.last_pool_id = Some(pool_id);
    Ok(())
}
