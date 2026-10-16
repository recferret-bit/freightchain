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
        // Omitted freeze authority is none. A coin holder cannot be frozen.
    )]
    pub honk_mint: Account<'info, Mint>,
    /// CHECK: PDA signer. HONK mint authority stays here so a verified ride can mint under the cap. Freeze authority is left unset on the fungible mint and the LP mint. Part NFTs set it, and there is no thaw.
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
    /// CHECK: PDA that owns the locked LP. It signs a transfer only in `release_lp`, and only after `unlock_at`.
    #[account(seeds = [LOCKER_SEED], bump)]
    pub locker: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn handle_initialize(ctx: Context<Initialize>, sol_in: u64) -> Result<()> {
    // The opening deposit is fixed. Any other lamport count, including zero, is the same error.
    require!(sol_in == OPENING_LAMPORTS, HonkError::ZeroAmount);
    let lp = lp_tokens(sol_in)?;
    let auth_bump = ctx.bumps.authority;
    let honk_mint = ctx.accounts.honk_mint.to_account_info();
    let vault = ctx.accounts.vault.to_account_info();
    let lp_mint = ctx.accounts.lp_mint.to_account_info();
    let lp_locker = ctx.accounts.lp_locker.to_account_info();
    mint_to_signed(&ctx, honk_mint, vault, GENESIS, auth_bump)?;
    // The HONK mint authority stays the program so a verified ride can mint later. The LP mint is closed.
    mint_to_signed(&ctx, lp_mint.clone(), lp_locker, lp, auth_bump)?;
    revoke_mint(&ctx, lp_mint, auth_bump)?;
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
    pool.honk_reserve = GENESIS;
    pool.unlock_at = now.checked_add(LOCK_SECS).ok_or(HonkError::ZeroOut)?;
    pool.bump = ctx.bumps.pool;
    let config = &mut ctx.accounts.config;
    config.bump = ctx.bumps.config;
    config.emitter = ctx.accounts.payer.key();
    config.emitted = 0;
    emit!(HonkInitialized {
        supply: GENESIS,
        sol_in,
        lp
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
