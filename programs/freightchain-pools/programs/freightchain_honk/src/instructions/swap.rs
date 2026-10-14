use anchor_lang::{
    prelude::*,
    system_program::{transfer, Transfer},
};
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{self, Mint, Token, TokenAccount},
};

use crate::{constants::*, error::HonkError, events::Swapped, math::honk_out, state::Pool};

#[derive(Accounts)]
pub struct SwapSolForHonk<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(mut, seeds = [POOL_SEED], bump = pool.bump)]
    pub pool: Account<'info, Pool>,
    #[account(seeds = [HONK_MINT_SEED], bump)]
    pub honk_mint: Account<'info, Mint>,
    #[account(mut, seeds = [VAULT_SEED], bump, token::mint = honk_mint, token::authority = pool)]
    pub vault: Account<'info, TokenAccount>,
    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = honk_mint,
        associated_token::authority = user,
    )]
    pub user_honk: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

pub fn handle_swap_sol_for_honk(
    ctx: Context<SwapSolForHonk>,
    sol_in: u64,
    min_out: u64,
) -> Result<()> {
    let out = honk_out(
        ctx.accounts.pool.honk_reserve,
        ctx.accounts.pool.sol_reserve,
        sol_in,
    )?;
    // `min_out == 0` accepts any positive out. The check is before either transfer.
    require!(out >= min_out, HonkError::Slippage);
    transfer(
        CpiContext::new(
            ctx.accounts.system_program.key(),
            Transfer {
                from: ctx.accounts.user.to_account_info(),
                to: ctx.accounts.pool.to_account_info(),
            },
        ),
        sol_in,
    )?;
    let bump = [ctx.accounts.pool.bump];
    let seeds: &[&[u8]] = &[POOL_SEED, &bump];
    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            token::Transfer {
                from: ctx.accounts.vault.to_account_info(),
                to: ctx.accounts.user_honk.to_account_info(),
                authority: ctx.accounts.pool.to_account_info(),
            },
            &[seeds],
        ),
        out,
    )?;
    let pool = &mut ctx.accounts.pool;
    pool.sol_reserve = pool
        .sol_reserve
        .checked_add(sol_in)
        .ok_or(HonkError::ZeroOut)?;
    pool.honk_reserve = pool
        .honk_reserve
        .checked_sub(out)
        .ok_or(HonkError::ZeroOut)?;
    emit!(Swapped {
        user: ctx.accounts.user.key(),
        sol_in,
        honk_out: out
    });
    Ok(())
}
