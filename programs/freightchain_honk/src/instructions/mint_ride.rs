use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{self, Mint, Token, TokenAccount},
};

use crate::{
    constants::*,
    error::HonkError,
    events::RidePaid,
    schedule::{era_index, quote_units, take_room},
    state::{Config, RideMint, WalletDay},
};

#[derive(Accounts)]
#[instruction(ride_id: [u8; 16], tier: u8, bands: u8, day_index: i64)]
pub struct MintRide<'info> {
    #[account(mut)]
    pub emitter: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = emitter)]
    pub config: Account<'info, Config>,
    #[account(seeds = [HONK_MINT_SEED], bump)]
    pub honk_mint: Account<'info, Mint>,
    /// CHECK: Owns the emission vault. The mint authority is already none.
    #[account(seeds = [AUTHORITY_SEED], bump)]
    pub authority: UncheckedAccount<'info>,
    #[account(mut, seeds = [EMISSION_SEED], bump, token::mint = honk_mint, token::authority = authority)]
    pub emission_vault: Account<'info, TokenAccount>,
    /// CHECK: The rider who receives the TEN4.
    pub rider: UncheckedAccount<'info>,
    #[account(
        init_if_needed,
        payer = emitter,
        associated_token::mint = honk_mint,
        associated_token::authority = rider,
    )]
    pub rider_honk: Account<'info, TokenAccount>,
    #[account(
        init,
        payer = emitter,
        space = 8 + RideMint::INIT_SPACE,
        seeds = [RIDE_MINT_SEED, ride_id.as_ref()],
        bump,
    )]
    pub ride_mint: Account<'info, RideMint>,
    #[account(
        init_if_needed,
        payer = emitter,
        space = 8 + WalletDay::INIT_SPACE,
        seeds = [WALLET_DAY_SEED, rider.key().as_ref(), &day_index.to_le_bytes()],
        bump,
    )]
    pub wallet_day: Account<'info, WalletDay>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

pub fn handle_mint_ride(
    ctx: Context<MintRide>,
    _ride_id: [u8; 16],
    tier: u8,
    bands: u8,
    day_index: i64,
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    require!(now.div_euclid(DAY_SECS) == day_index, HonkError::BadDay);
    let config = &mut ctx.accounts.config;
    if config.day_index != day_index {
        config.day_index = day_index;
        config.day_emitted = 0;
    }
    let era = era_index(config.emitted);
    let quote = quote_units(tier, bands, era)?;
    let amount = take_room(quote, config.emitted, config.day_emitted, ctx.accounts.wallet_day.amount)?;
    let bump = [ctx.bumps.authority];
    let seeds: &[&[u8]] = &[AUTHORITY_SEED, &bump];
    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            token::Transfer {
                from: ctx.accounts.emission_vault.to_account_info(),
                to: ctx.accounts.rider_honk.to_account_info(),
                authority: ctx.accounts.authority.to_account_info(),
            },
            &[seeds],
        ),
        amount,
    )?;
    config.emitted = config.emitted.checked_add(amount).ok_or(HonkError::EmissionCap)?;
    config.day_emitted = config.day_emitted.checked_add(amount).ok_or(HonkError::DailyCap)?;
    ctx.accounts.wallet_day.amount = ctx
        .accounts
        .wallet_day
        .amount
        .checked_add(amount)
        .ok_or(HonkError::WalletCap)?;
    ctx.accounts.wallet_day.bump = ctx.bumps.wallet_day;
    let ride = &mut ctx.accounts.ride_mint;
    ride.amount = amount;
    ride.tier = tier;
    ride.bands = bands;
    ride.era = u8::try_from(era).unwrap_or(u8::MAX);
    ride.bump = ctx.bumps.ride_mint;
    emit!(RidePaid {
        rider: ctx.accounts.rider.key(),
        amount,
        era: ride.era,
    });
    Ok(())
}
