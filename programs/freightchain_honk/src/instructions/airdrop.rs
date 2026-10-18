use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{self, Mint, Token, TokenAccount},
};
use solana_sha256_hasher::hashv;

use crate::{
    constants::*,
    error::HonkError,
    events::{AirdropClaimed, AirdropRootSet, AirdropUnclaimedBurned},
    state::{AirdropCampaign, AirdropReceipt, Config, WalletAirdrop},
};

pub fn airdrop_leaf(campaign: u8, wallet: &Pubkey, amount: u64) -> [u8; 32] {
    hashv(&[
        b"fc:airdrop:v1",
        &[campaign],
        wallet.as_ref(),
        &amount.to_le_bytes(),
    ])
    .to_bytes()
}

pub fn merkle_root_from(mut node: [u8; 32], proof: &[[u8; 32]]) -> [u8; 32] {
    for p in proof {
        let (a, b) = if node <= *p { (&node, p) } else { (p, &node) };
        node = hashv(&[&[1u8], a.as_ref(), b.as_ref()]).to_bytes();
    }
    node
}

#[derive(Accounts)]
#[instruction(campaign: u8, root: [u8; 32], allocation: u64)]
pub struct SetAirdropRoot<'info> {
    #[account(mut)]
    pub emitter: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = emitter @ HonkError::BadAuthority)]
    pub config: Account<'info, Config>,
    #[account(
        init,
        payer = emitter,
        space = 8 + AirdropCampaign::INIT_SPACE,
        seeds = [AIRDROP_SEED, &[campaign]],
        bump,
    )]
    pub airdrop_campaign: Account<'info, AirdropCampaign>,
    pub system_program: Program<'info, System>,
}

pub fn handle_set_airdrop_root(
    ctx: Context<SetAirdropRoot>,
    campaign: u8,
    root: [u8; 32],
    allocation: u64,
) -> Result<()> {
    require!(allocation > 0, HonkError::ZeroAmount);
    require!(root != [0u8; 32], HonkError::BadMerkleProof);
    let next_allocated = ctx
        .accounts
        .config
        .airdrop_allocated
        .checked_add(allocation)
        .ok_or(HonkError::EmissionCap)?;
    require!(next_allocated <= AIRDROP, HonkError::EmissionCap);
    ctx.accounts.config.airdrop_allocated = next_allocated;

    let now = Clock::get()?.unix_timestamp;
    let ends_at = now.checked_add(AIRDROP_WINDOW_SECS).ok_or(HonkError::ZeroOut)?;
    let camp = &mut ctx.accounts.airdrop_campaign;
    camp.campaign = campaign;
    camp.root = root;
    camp.allocation = allocation;
    camp.claimed = 0;
    camp.opened_at = now;
    camp.ends_at = ends_at;
    camp.burned = false;
    camp.bump = ctx.bumps.airdrop_campaign;
    emit!(AirdropRootSet {
        campaign,
        root,
        allocation,
        ends_at,
    });
    Ok(())
}

#[derive(Accounts)]
#[instruction(campaign: u8, amount: u64)]
pub struct ClaimAirdrop<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(mut, seeds = [AIRDROP_SEED, &[campaign]], bump = airdrop_campaign.bump)]
    pub airdrop_campaign: Box<Account<'info, AirdropCampaign>>,
    #[account(seeds = [HONK_MINT_SEED], bump)]
    pub honk_mint: Box<Account<'info, Mint>>,
    /// CHECK: Owns the airdrop vault.
    #[account(seeds = [AUTHORITY_SEED], bump)]
    pub authority: UncheckedAccount<'info>,
    #[account(mut, seeds = [AIRDROP_SEED], bump, token::mint = honk_mint, token::authority = authority)]
    pub airdrop_vault: Box<Account<'info, TokenAccount>>,
    /// CHECK: Bound to the Merkle leaf `(campaign, wallet, amount)`.
    pub wallet: UncheckedAccount<'info>,
    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = honk_mint,
        associated_token::authority = wallet,
    )]
    pub wallet_honk: Box<Account<'info, TokenAccount>>,
    #[account(
        init,
        payer = payer,
        space = 8 + AirdropReceipt::INIT_SPACE,
        seeds = [AIRDROP_SEED, &[campaign], wallet.key().as_ref()],
        bump,
    )]
    pub receipt: Box<Account<'info, AirdropReceipt>>,
    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + WalletAirdrop::INIT_SPACE,
        seeds = [WALLET_AIRDROP_SEED, wallet.key().as_ref()],
        bump,
    )]
    pub wallet_airdrop: Box<Account<'info, WalletAirdrop>>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handle_claim_airdrop(
    ctx: Context<ClaimAirdrop>,
    campaign: u8,
    amount: u64,
    proof: Vec<[u8; 32]>,
) -> Result<()> {
    require!(amount > 0, HonkError::ZeroAmount);
    require!(proof.len() <= MAX_MERKLE_PROOF, HonkError::BadMerkleProof);
    let now = Clock::get()?.unix_timestamp;
    require!(
        now < ctx.accounts.airdrop_campaign.ends_at && !ctx.accounts.airdrop_campaign.burned,
        HonkError::AirdropClosed
    );

    let wallet_total = ctx
        .accounts
        .wallet_airdrop
        .amount
        .checked_add(amount)
        .ok_or(HonkError::WalletCap)?;
    require!(wallet_total <= AIRDROP_WALLET_CAP, HonkError::WalletCap);

    let campaign_total = ctx
        .accounts
        .airdrop_campaign
        .claimed
        .checked_add(amount)
        .ok_or(HonkError::EmissionCap)?;
    require!(
        campaign_total <= ctx.accounts.airdrop_campaign.allocation,
        HonkError::EmissionCap
    );

    let leaf = airdrop_leaf(campaign, &ctx.accounts.wallet.key(), amount);
    require!(
        merkle_root_from(leaf, &proof) == ctx.accounts.airdrop_campaign.root,
        HonkError::BadMerkleProof
    );

    let bump = [ctx.bumps.authority];
    let seeds: &[&[u8]] = &[AUTHORITY_SEED, &bump];
    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            token::Transfer {
                from: ctx.accounts.airdrop_vault.to_account_info(),
                to: ctx.accounts.wallet_honk.to_account_info(),
                authority: ctx.accounts.authority.to_account_info(),
            },
            &[seeds],
        ),
        amount,
    )?;

    ctx.accounts.airdrop_campaign.claimed = campaign_total;
    ctx.accounts.config.airdrop_claimed = ctx
        .accounts
        .config
        .airdrop_claimed
        .checked_add(amount)
        .ok_or(HonkError::EmissionCap)?;
    ctx.accounts.wallet_airdrop.amount = wallet_total;
    ctx.accounts.wallet_airdrop.bump = ctx.bumps.wallet_airdrop;

    let receipt = &mut ctx.accounts.receipt;
    receipt.campaign = campaign;
    receipt.wallet = ctx.accounts.wallet.key();
    receipt.amount = amount;
    receipt.claimed_at = now;
    receipt.bump = ctx.bumps.receipt;

    emit!(AirdropClaimed {
        campaign,
        wallet: ctx.accounts.wallet.key(),
        amount,
    });
    Ok(())
}

#[derive(Accounts)]
#[instruction(campaign: u8)]
pub struct BurnUnclaimed<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [AIRDROP_SEED, &[campaign]], bump = airdrop_campaign.bump)]
    pub airdrop_campaign: Account<'info, AirdropCampaign>,
    #[account(mut, seeds = [HONK_MINT_SEED], bump)]
    pub honk_mint: Account<'info, Mint>,
    /// CHECK: Owns the airdrop vault.
    #[account(seeds = [AUTHORITY_SEED], bump)]
    pub authority: UncheckedAccount<'info>,
    #[account(mut, seeds = [AIRDROP_SEED], bump, token::mint = honk_mint, token::authority = authority)]
    pub airdrop_vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

pub fn handle_burn_unclaimed(ctx: Context<BurnUnclaimed>, campaign: u8) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    require!(
        now >= ctx.accounts.airdrop_campaign.ends_at,
        HonkError::TooEarly
    );
    require!(!ctx.accounts.airdrop_campaign.burned, HonkError::ZeroAmount);
    let unclaimed = ctx
        .accounts
        .airdrop_campaign
        .allocation
        .saturating_sub(ctx.accounts.airdrop_campaign.claimed);
    require!(unclaimed > 0, HonkError::ZeroAmount);
    ctx.accounts.airdrop_campaign.burned = true;

    let bump = [ctx.bumps.authority];
    let seeds: &[&[u8]] = &[AUTHORITY_SEED, &bump];
    token::burn(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            token::Burn {
                mint: ctx.accounts.honk_mint.to_account_info(),
                from: ctx.accounts.airdrop_vault.to_account_info(),
                authority: ctx.accounts.authority.to_account_info(),
            },
            &[seeds],
        ),
        unclaimed,
    )?;

    emit!(AirdropUnclaimedBurned {
        campaign,
        amount: unclaimed,
    });
    Ok(())
}
