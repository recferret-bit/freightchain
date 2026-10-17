use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{self, Mint, Token, TokenAccount},
};

use crate::{
    constants::*,
    error::HonkError,
    events::{ReferralPaid, ReferralTailBurned},
    schedule::{referral_era_index, referral_quote_units, take_referral_room},
    state::{Config, ReferralMint, WalletMonth},
};

#[derive(Accounts)]
#[instruction(reward_id: [u8; 16], base_amount: u64, month_index: i64)]
pub struct PayReferral<'info> {
    #[account(mut)]
    pub emitter: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = emitter @ HonkError::BadAuthority)]
    pub config: Box<Account<'info, Config>>,
    #[account(seeds = [HONK_MINT_SEED], bump)]
    pub honk_mint: Box<Account<'info, Mint>>,
    /// CHECK: Owns the referral vault.
    #[account(seeds = [AUTHORITY_SEED], bump)]
    pub authority: UncheckedAccount<'info>,
    #[account(mut, seeds = [REFERRAL_SEED], bump, token::mint = honk_mint, token::authority = authority)]
    pub referral_vault: Box<Account<'info, TokenAccount>>,
    /// CHECK: The referrer who receives the TEN4.
    pub recipient: UncheckedAccount<'info>,
    #[account(
        init_if_needed,
        payer = emitter,
        associated_token::mint = honk_mint,
        associated_token::authority = recipient,
    )]
    pub recipient_honk: Box<Account<'info, TokenAccount>>,
    #[account(
        init,
        payer = emitter,
        space = 8 + ReferralMint::INIT_SPACE,
        seeds = [REFERRAL_MINT_SEED, reward_id.as_ref()],
        bump,
    )]
    pub referral_mint: Box<Account<'info, ReferralMint>>,
    #[account(
        init_if_needed,
        payer = emitter,
        space = 8 + WalletMonth::INIT_SPACE,
        seeds = [WALLET_MONTH_SEED, recipient.key().as_ref(), &month_index.to_le_bytes()],
        bump,
    )]
    pub wallet_month: Box<Account<'info, WalletMonth>>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

pub fn handle_pay_referral(
    ctx: Context<PayReferral>,
    _reward_id: [u8; 16],
    base_amount: u64,
    month_index: i64,
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let expected_month = (now - ctx.accounts.config.opened_at).div_euclid(MONTH_SECS);
    require!(
        expected_month == month_index && month_index >= 0,
        HonkError::BadMonth
    );
    let config = &mut ctx.accounts.config;
    if config.referral_month != month_index {
        config.referral_month = month_index;
        config.referral_month_emitted = 0;
    }
    let (quote, era) = referral_quote_units(base_amount, config.referral_emitted, config.emitted)?;
    let amount = take_referral_room(
        quote,
        config.referral_emitted,
        month_index,
        config.referral_month_emitted,
        ctx.accounts.wallet_month.amount,
    )?;
    let bump = [ctx.bumps.authority];
    let seeds: &[&[u8]] = &[AUTHORITY_SEED, &bump];
    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            token::Transfer {
                from: ctx.accounts.referral_vault.to_account_info(),
                to: ctx.accounts.recipient_honk.to_account_info(),
                authority: ctx.accounts.authority.to_account_info(),
            },
            &[seeds],
        ),
        amount,
    )?;
    config.referral_emitted = config
        .referral_emitted
        .checked_add(amount)
        .ok_or(HonkError::EmissionCap)?;
    config.referral_month_emitted = config
        .referral_month_emitted
        .checked_add(amount)
        .ok_or(HonkError::DailyCap)?;
    ctx.accounts.wallet_month.amount = ctx
        .accounts
        .wallet_month
        .amount
        .checked_add(amount)
        .ok_or(HonkError::WalletCap)?;
    ctx.accounts.wallet_month.bump = ctx.bumps.wallet_month;
    let receipt = &mut ctx.accounts.referral_mint;
    receipt.recipient = ctx.accounts.recipient.key();
    receipt.amount = amount;
    receipt.era = u8::try_from(era).unwrap_or(u8::MAX);
    receipt.bump = ctx.bumps.referral_mint;
    emit!(ReferralPaid {
        recipient: ctx.accounts.recipient.key(),
        amount,
        era: receipt.era,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct BurnReferralTail<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [HONK_MINT_SEED], bump)]
    pub honk_mint: Account<'info, Mint>,
    /// CHECK: Owns the referral vault.
    #[account(seeds = [AUTHORITY_SEED], bump)]
    pub authority: UncheckedAccount<'info>,
    #[account(mut, seeds = [REFERRAL_SEED], bump, token::mint = honk_mint, token::authority = authority)]
    pub referral_vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

pub fn handle_burn_referral_tail(ctx: Context<BurnReferralTail>) -> Result<()> {
    require!(
        referral_era_index(ctx.accounts.config.referral_emitted) >= REFERRAL_TAIL_ERA,
        HonkError::TooEarly
    );
    let amount = ctx.accounts.referral_vault.amount;
    require!(amount > 0, HonkError::ZeroAmount);
    let bump = [ctx.bumps.authority];
    let seeds: &[&[u8]] = &[AUTHORITY_SEED, &bump];
    token::burn(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            token::Burn {
                mint: ctx.accounts.honk_mint.to_account_info(),
                from: ctx.accounts.referral_vault.to_account_info(),
                authority: ctx.accounts.authority.to_account_info(),
            },
            &[seeds],
        ),
        amount,
    )?;
    ctx.accounts.config.referral_emitted = REFERRAL;
    emit!(ReferralTailBurned { amount });
    Ok(())
}
