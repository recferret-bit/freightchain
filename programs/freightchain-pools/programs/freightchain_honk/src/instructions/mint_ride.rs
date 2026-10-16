use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{self, Mint, Token, TokenAccount},
};

use crate::{constants::*, error::HonkError, state::{Config, RideMint}};

#[derive(Accounts)]
#[instruction(ride_id: [u8; 16])]
pub struct MintRide<'info> {
    #[account(mut)]
    pub emitter: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = emitter)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [HONK_MINT_SEED], bump)]
    pub honk_mint: Account<'info, Mint>,
    /// CHECK: mint authority PDA. Signs the ride mint. Not the pool vault.
    #[account(seeds = [AUTHORITY_SEED], bump)]
    pub authority: UncheckedAccount<'info>,
    /// CHECK: the rider who receives the HONK.
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
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

pub fn handle_mint_ride(ctx: Context<MintRide>, _ride_id: [u8; 16], amount: u64) -> Result<()> {
    require!(amount > 0, HonkError::ZeroAmount);
    let next = ctx.accounts.config.emitted.checked_add(amount).ok_or(HonkError::EmissionCap)?;
    require!(next <= EMISSION_CAP, HonkError::EmissionCap);
    let bump = [ctx.bumps.authority];
    let seeds: &[&[u8]] = &[AUTHORITY_SEED, &bump];
    token::mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            token::MintTo {
                mint: ctx.accounts.honk_mint.to_account_info(),
                to: ctx.accounts.rider_honk.to_account_info(),
                authority: ctx.accounts.authority.to_account_info(),
            },
            &[seeds],
        ),
        amount,
    )?;
    ctx.accounts.config.emitted = next;
    ctx.accounts.ride_mint.amount = amount;
    ctx.accounts.ride_mint.bump = ctx.bumps.ride_mint;
    Ok(())
}
