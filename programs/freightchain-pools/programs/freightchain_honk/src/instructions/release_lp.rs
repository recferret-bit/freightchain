use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{self, Mint, Token, TokenAccount},
};

use crate::{constants::*, error::HonkError, state::Pool};

#[derive(Accounts)]
pub struct ReleaseLp<'info> {
    #[account(mut)]
    pub recipient: Signer<'info>,
    #[account(seeds = [POOL_SEED], bump = pool.bump)]
    pub pool: Account<'info, Pool>,
    #[account(seeds = [LP_MINT_SEED], bump)]
    pub lp_mint: Account<'info, Mint>,
    #[account(mut, seeds = [LP_LOCKER_SEED], bump, token::mint = lp_mint, token::authority = locker)]
    pub lp_locker: Account<'info, TokenAccount>,
    /// CHECK: PDA that owns the locked LP. Signs the transfer only once `unlock_at` has passed.
    #[account(seeds = [LOCKER_SEED], bump)]
    pub locker: UncheckedAccount<'info>,
    #[account(
        init_if_needed,
        payer = recipient,
        associated_token::mint = lp_mint,
        associated_token::authority = recipient,
    )]
    pub recipient_lp: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handle_release_lp(ctx: Context<ReleaseLp>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    // `>= unlock_at`. LiteSVM warps the Clock sysvar; a live validator is not asked to wait a year.
    require!(now >= ctx.accounts.pool.unlock_at, HonkError::TooEarly);
    let amount = ctx.accounts.lp_locker.amount;
    if amount == 0 {
        return Ok(());
    }
    let bump = [ctx.bumps.locker];
    let seeds: &[&[u8]] = &[LOCKER_SEED, &bump];
    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            token::Transfer {
                from: ctx.accounts.lp_locker.to_account_info(),
                to: ctx.accounts.recipient_lp.to_account_info(),
                authority: ctx.accounts.locker.to_account_info(),
            },
            &[seeds],
        ),
        amount,
    )
}
