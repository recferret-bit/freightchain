use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{self, Mint, Token, TokenAccount},
};

use crate::{
    constants::*,
    error::HonkError,
    events::Vested,
    schedule::vested,
    state::Config,
};

#[derive(Accounts)]
pub struct ClaimTreasury<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(seeds = [HONK_MINT_SEED], bump)]
    pub honk_mint: Account<'info, Mint>,
    /// CHECK: Owns the treasury vault.
    #[account(seeds = [AUTHORITY_SEED], bump)]
    pub authority: UncheckedAccount<'info>,
    #[account(mut, seeds = [TREASURY_SEED], bump, token::mint = honk_mint, token::authority = authority)]
    pub treasury_vault: Account<'info, TokenAccount>,
    /// CHECK: Pays only `config.treasury`. There is no instruction that changes it.
    #[account(address = config.treasury)]
    pub treasury: UncheckedAccount<'info>,
    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = honk_mint,
        associated_token::authority = treasury,
    )]
    pub treasury_honk: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handle_claim_treasury(ctx: Context<ClaimTreasury>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let unlocked = vested(TREASURY, ctx.accounts.config.opened_at, now, 0, TREASURY_VEST_MONTHS)?;
    let amount = unlocked.saturating_sub(ctx.accounts.config.treasury_claimed);
    require!(amount > 0, HonkError::TooEarly);
    pay(&ctx.accounts.token_program, &ctx.accounts.authority, ctx.bumps.authority, &ctx.accounts.treasury_vault, &ctx.accounts.treasury_honk, amount)?;
    ctx.accounts.config.treasury_claimed = ctx
        .accounts
        .config
        .treasury_claimed
        .checked_add(amount)
        .ok_or(HonkError::ZeroOut)?;
    emit!(Vested { to: ctx.accounts.treasury.key(), amount, team: false });
    Ok(())
}

#[derive(Accounts)]
pub struct ClaimTeam<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(seeds = [HONK_MINT_SEED], bump)]
    pub honk_mint: Account<'info, Mint>,
    /// CHECK: Owns the team vault.
    #[account(seeds = [AUTHORITY_SEED], bump)]
    pub authority: UncheckedAccount<'info>,
    #[account(mut, seeds = [TEAM_SEED], bump, token::mint = honk_mint, token::authority = authority)]
    pub team_vault: Account<'info, TokenAccount>,
    /// CHECK: Pays only `config.team_recipient`. There is no cancel and no change of recipient.
    #[account(address = config.team_recipient)]
    pub team_recipient: UncheckedAccount<'info>,
    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = honk_mint,
        associated_token::authority = team_recipient,
    )]
    pub team_honk: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handle_claim_team(ctx: Context<ClaimTeam>) -> Result<()> {
    require!(ctx.accounts.config.team_enabled, HonkError::TeamDisabled);
    let now = Clock::get()?.unix_timestamp;
    let unlocked = vested(
        TEAM,
        ctx.accounts.config.opened_at,
        now,
        TEAM_CLIFF_MONTHS,
        ctx.accounts.config.team_linear_months,
    )?;
    let amount = unlocked.saturating_sub(ctx.accounts.config.team_claimed);
    require!(amount > 0, HonkError::TooEarly);
    pay(&ctx.accounts.token_program, &ctx.accounts.authority, ctx.bumps.authority, &ctx.accounts.team_vault, &ctx.accounts.team_honk, amount)?;
    ctx.accounts.config.team_claimed = ctx
        .accounts
        .config
        .team_claimed
        .checked_add(amount)
        .ok_or(HonkError::ZeroOut)?;
    emit!(Vested { to: ctx.accounts.team_recipient.key(), amount, team: true });
    Ok(())
}

fn pay<'info>(
    token_program: &Program<'info, Token>,
    authority: &UncheckedAccount<'info>,
    auth_bump: u8,
    from: &Account<'info, TokenAccount>,
    to: &Account<'info, TokenAccount>,
    amount: u64,
) -> Result<()> {
    let bump = [auth_bump];
    let seeds: &[&[u8]] = &[AUTHORITY_SEED, &bump];
    token::transfer(
        CpiContext::new_with_signer(
            token_program.key(),
            token::Transfer {
                from: from.to_account_info(),
                to: to.to_account_info(),
                authority: authority.to_account_info(),
            },
            &[seeds],
        ),
        amount,
    )
}
