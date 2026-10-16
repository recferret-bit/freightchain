use anchor_lang::{
    prelude::*,
    system_program::{transfer, Transfer},
};
use anchor_spl::token::{self, spl_token, Mint, Token, TokenAccount};

use crate::{
    constants::*,
    error::HonkError,
    events::HonkInitialized,
    math::lp_tokens,
    state::{Config, Pool},
};

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(init, payer = payer, space = 8 + Config::INIT_SPACE, seeds = [CONFIG_SEED], bump)]
    pub config: Account<'info, Config>,
    #[account(
        init,
        payer = payer,
        seeds = [HONK_MINT_SEED],
        bump,
        mint::decimals = DECIMALS,
        mint::authority = authority,
    )]
    pub honk_mint: Account<'info, Mint>,
    /// CHECK: PDA. Signs the genesis mints, then the mint authority is set to none. It keeps signing vault transfers.
    #[account(seeds = [AUTHORITY_SEED], bump)]
    pub authority: UncheckedAccount<'info>,
    #[account(
        init,
        payer = payer,
        seeds = [VAULT_SEED],
        bump,
        token::mint = honk_mint,
        token::authority = pool,
    )]
    pub vault: Account<'info, TokenAccount>,
    #[account(init, payer = payer, space = 8 + Pool::INIT_SPACE, seeds = [POOL_SEED], bump)]
    pub pool: Account<'info, Pool>,
    #[account(
        init,
        payer = payer,
        seeds = [LP_MINT_SEED],
        bump,
        mint::decimals = DECIMALS,
        mint::authority = authority,
    )]
    pub lp_mint: Account<'info, Mint>,
    #[account(
        init,
        payer = payer,
        seeds = [LP_LOCKER_SEED],
        bump,
        token::mint = lp_mint,
        token::authority = locker,
    )]
    pub lp_locker: Account<'info, TokenAccount>,
    /// CHECK: Signs the LP burn in this instruction. Nothing later can move LP.
    #[account(seeds = [LOCKER_SEED], bump)]
    pub locker: UncheckedAccount<'info>,
    #[account(
        init,
        payer = payer,
        seeds = [EMISSION_SEED],
        bump,
        token::mint = honk_mint,
        token::authority = authority,
    )]
    pub emission_vault: Account<'info, TokenAccount>,
    #[account(
        init,
        payer = payer,
        seeds = [AIRDROP_SEED],
        bump,
        token::mint = honk_mint,
        token::authority = authority,
    )]
    pub airdrop_vault: Account<'info, TokenAccount>,
    #[account(
        init,
        payer = payer,
        seeds = [TREASURY_SEED],
        bump,
        token::mint = honk_mint,
        token::authority = authority,
    )]
    pub treasury_vault: Account<'info, TokenAccount>,
    #[account(
        init,
        payer = payer,
        seeds = [TEAM_SEED],
        bump,
        token::mint = honk_mint,
        token::authority = authority,
    )]
    pub team_vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn handle_initialize(
    ctx: Context<Initialize>,
    sol_in: u64,
    emitter: Pubkey,
    treasury: Pubkey,
    team_recipient: Pubkey,
    team_enabled: bool,
    team_linear_months: u8,
) -> Result<()> {
    require!(sol_in == OPENING_LAMPORTS, HonkError::ZeroAmount);
    require!(emitter != Pubkey::default(), HonkError::BadAuthority);
    require!(treasury != Pubkey::default(), HonkError::BadAuthority);
    if team_enabled {
        require!(team_recipient != Pubkey::default(), HonkError::BadAuthority);
        require!(team_linear_months == 24 || team_linear_months == 36, HonkError::BadVest);
    } else {
        require!(team_recipient == Pubkey::default(), HonkError::BadAuthority);
        require!(team_linear_months == 0, HonkError::BadVest);
    }
    let lp = lp_tokens(sol_in)?;
    let auth_bump = ctx.bumps.authority;
    let honk_mint = ctx.accounts.honk_mint.to_account_info();
    mint_to_signed(&ctx, honk_mint.clone(), ctx.accounts.vault.to_account_info(), LIQUIDITY, auth_bump)?;
    mint_to_signed(&ctx, honk_mint.clone(), ctx.accounts.emission_vault.to_account_info(), EMISSION_CAP, auth_bump)?;
    mint_to_signed(&ctx, honk_mint.clone(), ctx.accounts.airdrop_vault.to_account_info(), AIRDROP, auth_bump)?;
    mint_to_signed(&ctx, honk_mint.clone(), ctx.accounts.treasury_vault.to_account_info(), TREASURY, auth_bump)?;
    if team_enabled {
        mint_to_signed(&ctx, honk_mint.clone(), ctx.accounts.team_vault.to_account_info(), TEAM, auth_bump)?;
    }
    let lp_mint = ctx.accounts.lp_mint.to_account_info();
    mint_to_signed(&ctx, lp_mint.clone(), ctx.accounts.lp_locker.to_account_info(), lp, auth_bump)?;
    burn_lp(&ctx, lp)?;
    revoke_mint(&ctx, lp_mint, auth_bump)?;
    revoke_mint(&ctx, honk_mint, auth_bump)?;
    transfer(
        CpiContext::new(
            ctx.accounts.system_program.key(),
            Transfer {
                from: ctx.accounts.payer.to_account_info(),
                to: ctx.accounts.pool.to_account_info(),
            },
        ),
        sol_in,
    )?;

    let now = Clock::get()?.unix_timestamp;
    let pool = &mut ctx.accounts.pool;
    pool.sol_reserve = sol_in;
    pool.honk_reserve = LIQUIDITY;
    pool.bump = ctx.bumps.pool;
    let config = &mut ctx.accounts.config;
    config.bump = ctx.bumps.config;
    config.emitter = emitter;
    config.treasury = treasury;
    config.team_recipient = team_recipient;
    config.team_enabled = team_enabled;
    config.team_linear_months = team_linear_months;
    config.emitted = 0;
    config.day_index = now.div_euclid(DAY_SECS);
    config.day_emitted = 0;
    config.treasury_claimed = 0;
    config.team_claimed = 0;
    config.opened_at = now;
    config.name = pad8(TOKEN_NAME);
    config.symbol = pad8(TOKEN_SYMBOL);
    let supply = LIQUIDITY + EMISSION_CAP + AIRDROP + TREASURY + if team_enabled { TEAM } else { 0 };
    emit!(HonkInitialized {
        supply,
        sol_in,
        lp_burned: lp,
        team_enabled,
        name: config.name,
        symbol: config.symbol,
    });
    Ok(())
}

fn mint_to_signed<'info>(
    ctx: &Context<Initialize<'info>>,
    mint: AccountInfo<'info>,
    to: AccountInfo<'info>,
    amount: u64,
    auth_bump: u8,
) -> Result<()> {
    let bump = [auth_bump];
    let seeds: &[&[u8]] = &[AUTHORITY_SEED, &bump];
    token::mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            token::MintTo {
                mint,
                to,
                authority: ctx.accounts.authority.to_account_info(),
            },
            &[seeds],
        ),
        amount,
    )
}

fn burn_lp(ctx: &Context<Initialize>, amount: u64) -> Result<()> {
    let bump = [ctx.bumps.locker];
    let seeds: &[&[u8]] = &[LOCKER_SEED, &bump];
    token::burn(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            token::Burn {
                mint: ctx.accounts.lp_mint.to_account_info(),
                from: ctx.accounts.lp_locker.to_account_info(),
                authority: ctx.accounts.locker.to_account_info(),
            },
            &[seeds],
        ),
        amount,
    )
}

fn revoke_mint<'info>(
    ctx: &Context<Initialize<'info>>,
    mint: AccountInfo<'info>,
    auth_bump: u8,
) -> Result<()> {
    let bump = [auth_bump];
    let seeds: &[&[u8]] = &[AUTHORITY_SEED, &bump];
    token::set_authority(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            token::SetAuthority {
                current_authority: ctx.accounts.authority.to_account_info(),
                account_or_mint: mint,
            },
            &[seeds],
        ),
        spl_token::instruction::AuthorityType::MintTokens,
        None,
    )
}
