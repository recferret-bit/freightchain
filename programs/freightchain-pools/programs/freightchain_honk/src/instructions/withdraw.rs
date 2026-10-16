use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{self, Mint, Token, TokenAccount},
};

use crate::{
    constants::*, error::HonkError, events::Redeemed, math::take_share, pay::pay_sol, state::Pool,
};

#[derive(Accounts)]
pub struct WithdrawLp<'info> {
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
    #[account(mut, seeds = [LP_MINT_SEED], bump)]
    pub lp_mint: Account<'info, Mint>,
    #[account(mut, token::mint = lp_mint, token::authority = user)]
    pub user_lp: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

/// Burn LP for that share of both reserves. The locker holds the supply until `release_lp`, so this cannot run early.
pub fn handle_withdraw_lp(
    ctx: Context<WithdrawLp>,
    lp_in: u64,
    min_honk: u64,
    min_sol: u64,
) -> Result<()> {
    let supply = ctx.accounts.lp_mint.supply;
    let honk_out = take_share(ctx.accounts.pool.honk_reserve, lp_in, supply)?;
    let sol_out = take_share(ctx.accounts.pool.sol_reserve, lp_in, supply)?;
    require!(honk_out > 0 || sol_out > 0, HonkError::ZeroOut);
    require!(honk_out >= min_honk && sol_out >= min_sol, HonkError::Slippage);
    token::burn(
        CpiContext::new(
            ctx.accounts.token_program.key(),
            token::Burn {
                mint: ctx.accounts.lp_mint.to_account_info(),
                from: ctx.accounts.user_lp.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
            },
        ),
        lp_in,
    )?;
    if honk_out > 0 {
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
            honk_out,
        )?;
    }
    if sol_out > 0 {
        pay_sol(
            &ctx.accounts.pool.to_account_info(),
            &ctx.accounts.user.to_account_info(),
            sol_out,
        )?;
    }
    let pool = &mut ctx.accounts.pool;
    pool.honk_reserve = pool
        .honk_reserve
        .checked_sub(honk_out)
        .ok_or(HonkError::ZeroOut)?;
    pool.sol_reserve = pool
        .sol_reserve
        .checked_sub(sol_out)
        .ok_or(HonkError::ZeroOut)?;
    emit!(Redeemed {
        user: ctx.accounts.user.key(),
        lp_in,
        honk_out,
        sol_out
    });
    Ok(())
}
