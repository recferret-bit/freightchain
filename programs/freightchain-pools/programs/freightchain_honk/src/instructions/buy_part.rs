use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{self, spl_token, Mint, Token, TokenAccount},
};

use crate::{
    catalog::{self, part_price},
    constants::*,
    error::HonkError,
    events::PartBought,
    state::Part,
};

#[derive(Accounts)]
#[instruction(slot: [u8; 16], item: [u8; 16])]
pub struct BuyPart<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,
    #[account(mut, seeds = [HONK_MINT_SEED], bump)]
    pub honk_mint: Account<'info, Mint>,
    #[account(mut, associated_token::mint = honk_mint, associated_token::authority = buyer)]
    pub buyer_honk: Account<'info, TokenAccount>,
    /// CHECK: freeze authority of the part NFT. Signs the one-token mint and the freeze. There is no thaw.
    #[account(seeds = [AUTHORITY_SEED], bump)]
    pub authority: UncheckedAccount<'info>,
    #[account(
        init,
        payer = buyer,
        mint::decimals = 0,
        mint::authority = authority,
        mint::freeze_authority = authority,
    )]
    pub nft_mint: Account<'info, Mint>,
    #[account(
        init_if_needed,
        payer = buyer,
        associated_token::mint = nft_mint,
        associated_token::authority = buyer,
    )]
    pub nft_ata: Account<'info, TokenAccount>,
    #[account(
        init_if_needed,
        payer = buyer,
        space = 8 + Part::INIT_SPACE,
        seeds = [PART_SEED, buyer.key().as_ref(), slot.as_ref(), item.as_ref()],
        bump,
    )]
    pub part: Account<'info, Part>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

pub fn handle_buy_part(ctx: Context<BuyPart>, slot: [u8; 16], item: [u8; 16]) -> Result<()> {
    // Checked before the burn: a second buy of this PDA must be AlreadyBought, not a token error.
    require!(
        ctx.accounts.part.buyer == Pubkey::default(),
        HonkError::AlreadyBought
    );
    // The catalog sets the price. A bool from the buyer cannot.
    let price = part_price(&slot, &item)?;
    let gold = catalog::is_gold(price);
    let bump = [ctx.bumps.authority];
    let seeds: &[&[u8]] = &[AUTHORITY_SEED, &bump];
    token::burn(
        CpiContext::new(
            ctx.accounts.token_program.key(),
            token::Burn {
                mint: ctx.accounts.honk_mint.to_account_info(),
                from: ctx.accounts.buyer_honk.to_account_info(),
                authority: ctx.accounts.buyer.to_account_info(),
            },
        ),
        price,
    )?;
    token::mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            token::MintTo {
                mint: ctx.accounts.nft_mint.to_account_info(),
                to: ctx.accounts.nft_ata.to_account_info(),
                authority: ctx.accounts.authority.to_account_info(),
            },
            &[seeds],
        ),
        1,
    )?;
    token::set_authority(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            token::SetAuthority {
                current_authority: ctx.accounts.authority.to_account_info(),
                account_or_mint: ctx.accounts.nft_mint.to_account_info(),
            },
            &[seeds],
        ),
        spl_token::instruction::AuthorityType::MintTokens,
        None,
    )?;
    token::freeze_account(CpiContext::new_with_signer(
        ctx.accounts.token_program.key(),
        token::FreezeAccount {
            account: ctx.accounts.nft_ata.to_account_info(),
            mint: ctx.accounts.nft_mint.to_account_info(),
            authority: ctx.accounts.authority.to_account_info(),
        },
        &[seeds],
    ))?;

    let buyer = ctx.accounts.buyer.key();
    let nft_mint = ctx.accounts.nft_mint.key();
    let part = &mut ctx.accounts.part;
    part.buyer = buyer;
    part.slot = slot;
    part.item = item;
    part.gold = gold;
    part.nft_mint = nft_mint;
    part.bump = ctx.bumps.part;
    emit!(PartBought {
        user: buyer,
        gold,
        nft_mint
    });
    Ok(())
}
