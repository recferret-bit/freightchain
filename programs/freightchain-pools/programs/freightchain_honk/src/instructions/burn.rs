use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount};

use crate::{constants::*, error::HonkError, events::Burned};

#[derive(Accounts)]
pub struct Burn<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(mut, seeds = [HONK_MINT_SEED], bump)]
    pub honk_mint: Account<'info, Mint>,
    #[account(mut, token::mint = honk_mint, token::authority = user)]
    pub user_honk: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

pub fn handle_burn(ctx: Context<Burn>, amount: u64) -> Result<()> {
    require!(amount > 0, HonkError::ZeroAmount);
    token::burn(
        CpiContext::new(
            ctx.accounts.token_program.key(),
            token::Burn {
                mint: ctx.accounts.honk_mint.to_account_info(),
                from: ctx.accounts.user_honk.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
            },
        ),
        amount,
    )?;
    emit!(Burned {
        user: ctx.accounts.user.key(),
        amount
    });
    Ok(())
}
