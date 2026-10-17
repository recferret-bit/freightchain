use anchor_lang::{
    prelude::*,
    system_program::{transfer, Transfer},
};

use crate::{
    constants::*,
    error::PoolError,
    events::{SponsorRefunded, Sponsored},
    state::{Config, Pool, SponsorReceipt},
    vault::{pay_from_vault, rent_min},
};

#[derive(Accounts)]
#[instruction(pool_id: u32, lamports: u64)]
pub struct Sponsor<'info> {
    #[account(mut)]
    pub sponsor: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [POOL_SEED, &pool_id.to_le_bytes()], bump = pool.bump)]
    pub pool: Account<'info, Pool>,
    /// CHECK: the escrow, a zero-data system account at the vault PDA
    #[account(mut, seeds = [VAULT_SEED, &pool_id.to_le_bytes()], bump = pool.vault_bump)]
    pub vault: UncheckedAccount<'info>,
    /// v4 (M8): what this sponsor put into this pool – it comes back if the pool fails
    #[account(
        init_if_needed,
        payer = sponsor,
        space = 8 + SponsorReceipt::INIT_SPACE,
        seeds = [SPONSOR_RECEIPT_SEED, pool.key().as_ref(), sponsor.key().as_ref()],
        bump
    )]
    pub receipt: Account<'info, SponsorReceipt>,
    pub system_program: Program<'info, System>,
}

pub fn handle_sponsor(ctx: Context<Sponsor>, pool_id: u32, lamports: u64) -> Result<()> {
    require!(!ctx.accounts.config.paused, PoolError::Paused);
    require!(lamports > 0, PoolError::InvalidParams);
    let now = Clock::get()?.unix_timestamp;
    let pool = &mut ctx.accounts.pool;
    require!(
        pool.status == STATUS_OPEN || pool.status == STATUS_ACTIVE,
        PoolError::PoolNotOpen
    );
    // like buy_ticket: money comes in only while the pool sells (an Active pool's prize is known before the rides end)
    require!(now < pool.prep_deadline, PoolError::TooLate);
    pool.sponsored = pool.sponsored.checked_add(lamports).ok_or(PoolError::MathOverflow)?;
    transfer(
        CpiContext::new(
            ctx.accounts.system_program.key(),
            Transfer { from: ctx.accounts.sponsor.to_account_info(), to: ctx.accounts.vault.to_account_info() },
        ),
        lamports,
    )?;
    let r = &mut ctx.accounts.receipt;
    if r.lamports == 0 {
        r.pool = ctx.accounts.pool.key();
        r.sponsor = ctx.accounts.sponsor.key();
        r.bump = ctx.bumps.receipt;
    }
    r.lamports = r.lamports.checked_add(lamports).ok_or(PoolError::MathOverflow)?;
    let pool = &ctx.accounts.pool;
    emit!(Sponsored {
        pool_id,
        sponsor: ctx.accounts.sponsor.key(),
        lamports,
        sponsored_total: pool.sponsored,
    });
    Ok(())
}

#[derive(Accounts)]
#[instruction(pool_id: u32)]
pub struct RefundSponsor<'info> {
    /// anyone (the server's crank in practice)
    pub caller: Signer<'info>,
    #[account(mut, seeds = [POOL_SEED, &pool_id.to_le_bytes()], bump = pool.bump)]
    pub pool: Account<'info, Pool>,
    /// CHECK: the escrow, a zero-data system account at the vault PDA
    #[account(mut, seeds = [VAULT_SEED, &pool_id.to_le_bytes()], bump = pool.vault_bump)]
    pub vault: UncheckedAccount<'info>,
    #[account(
        mut,
        close = sponsor,
        seeds = [SPONSOR_RECEIPT_SEED, pool.key().as_ref(), sponsor.key().as_ref()],
        bump = receipt.bump,
        has_one = sponsor @ PoolError::AccountMismatch,
    )]
    pub receipt: Account<'info, SponsorReceipt>,
    /// CHECK: the sponsor the receipt names – gets the sponsorship and the receipt's rent
    #[account(mut)]
    pub sponsor: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

/// v4 (audit M8): permissionless – a failed / cancelled / expired pool (Refunding) gives each sponsor its sponsorship back, like a ticket refund;
/// the pool closes only once every sponsor is refunded.
pub fn handle_refund_sponsor(mut ctx: Context<RefundSponsor>, pool_id: u32) -> Result<()> {
    let a = &mut ctx.accounts;
    require!(a.pool.status == STATUS_REFUNDING, PoolError::NotRefunding);
    let lamports = a.receipt.lamports;
    // the receipt's own rent reaches the sponsor in this instruction too (`close = sponsor`): a tiny sponsorship to an emptied wallet must not stall the close
    let ends_with = a.sponsor.lamports().checked_add(lamports).and_then(|v| v.checked_add(a.receipt.to_account_info().lamports())).ok_or(PoolError::MathOverflow)?;
    require!(ends_with >= rent_min()?, PoolError::BelowRentMin);
    pay_from_vault(&a.vault.to_account_info(), &a.sponsor.to_account_info(), &a.system_program.to_account_info(), pool_id, a.pool.vault_bump, lamports)?;
    a.pool.sponsor_refunded = a.pool.sponsor_refunded.checked_add(lamports).ok_or(PoolError::MathOverflow)?;
    emit!(SponsorRefunded { pool_id, sponsor: a.sponsor.key(), lamports, sponsor_refunded_total: a.pool.sponsor_refunded });
    Ok(())
}

#[derive(Accounts)]
#[instruction(pool_id: u32)]
pub struct CloseSponsorReceipt<'info> {
    pub caller: Signer<'info>,
    #[account(seeds = [POOL_SEED, &pool_id.to_le_bytes()], bump = pool.bump)]
    pub pool: Account<'info, Pool>,
    #[account(
        mut,
        close = sponsor,
        seeds = [SPONSOR_RECEIPT_SEED, pool.key().as_ref(), sponsor.key().as_ref()],
        bump = receipt.bump,
        has_one = sponsor @ PoolError::AccountMismatch,
    )]
    pub receipt: Account<'info, SponsorReceipt>,
    /// CHECK: the sponsor the receipt names – gets the receipt's rent
    #[account(mut)]
    pub sponsor: UncheckedAccount<'info>,
}

/// v4: permissionless – the receipt of a pool that paid out (Settled: the sponsorship was in the split) gives its rent back.
pub fn handle_close_sponsor_receipt(ctx: Context<CloseSponsorReceipt>, _pool_id: u32) -> Result<()> {
    require!(ctx.accounts.pool.status == STATUS_SETTLED, PoolError::NotSettled);
    Ok(())
}
