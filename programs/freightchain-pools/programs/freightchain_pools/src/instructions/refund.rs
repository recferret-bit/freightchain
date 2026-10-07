use anchor_lang::prelude::*;

use crate::{
    constants::*,
    error::PoolError,
    events::Refunded,
    state::{Pool, Ticket},
    vault::pay_from_vault,
};

#[derive(Accounts)]
#[instruction(pool_id: u32)]
pub struct Refund<'info> {
    /// Anyone can crank refunds (the fee payer of the transaction).
    pub caller: Signer<'info>,
    #[account(mut, seeds = [POOL_SEED, &pool_id.to_le_bytes()], bump = pool.bump)]
    pub pool: Account<'info, Pool>,
    /// CHECK: the escrow, a zero-data system account at the vault PDA
    #[account(mut, seeds = [VAULT_SEED, &pool_id.to_le_bytes()], bump = pool.vault_bump)]
    pub vault: UncheckedAccount<'info>,
    /// CHECK: the Ticket PDA. Unchecked on purpose: an already refunded ticket is a closed account and
    /// must give the readable `AlreadyRefunded`, not an Anchor deserialization error.
    #[account(mut, seeds = [TICKET_SEED, pool.key().as_ref(), buyer.key().as_ref()], bump)]
    pub ticket: UncheckedAccount<'info>,
    /// CHECK: receives the ticket price; must be the ticket's `buyer` (checked in the handler through the PDA seeds)
    #[account(mut)]
    pub buyer: UncheckedAccount<'info>,
    /// CHECK: receives the Ticket rent; must equal `ticket.rent_payer` (checked in the handler)
    #[account(mut)]
    pub rent_payer: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handle_refund(ctx: Context<Refund>, pool_id: u32) -> Result<()> {
    let a = &ctx.accounts;
    require!(a.pool.status == STATUS_REFUNDING, PoolError::NotRefunding);
    let ticket_info = a.ticket.to_account_info();
    require!(
        ticket_info.owner == &crate::ID && !ticket_info.data_is_empty(),
        PoolError::AlreadyRefunded
    );
    let ticket = {
        let data = ticket_info.try_borrow_data()?;
        Ticket::try_deserialize(&mut &data[..])?
    };
    require_keys_eq!(ticket.buyer, a.buyer.key(), PoolError::AccountMismatch);
    require_keys_eq!(ticket.rent_payer, a.rent_payer.key(), PoolError::AccountMismatch);
    let lamports = ticket.lamports;
    let qty = ticket.qty;

    pay_from_vault(
        &a.vault.to_account_info(),
        &a.buyer.to_account_info(),
        &a.system_program.to_account_info(),
        pool_id,
        a.pool.vault_bump,
        lamports,
    )?;
    let refunded_total = a.pool.refunded.checked_add(lamports).ok_or(PoolError::MathOverflow)?;
    // closing the account IS the refunded state (and the idempotency)
    let dest = a.rent_payer.to_account_info();
    dest.add_lamports(ticket_info.lamports())?;
    **ticket_info.lamports.borrow_mut() = 0;
    ticket_info.assign(&anchor_lang::system_program::ID);
    ticket_info.resize(0)?;
    emit!(Refunded {
        pool_id,
        buyer: a.buyer.key(),
        rent_payer: a.rent_payer.key(),
        qty,
        lamports,
        refunded_total,
    });
    ctx.accounts.pool.refunded = refunded_total;
    Ok(())
}

#[derive(Accounts)]
#[instruction(pool_id: u32)]
pub struct CloseTicket<'info> {
    /// Anyone.
    pub caller: Signer<'info>,
    #[account(seeds = [POOL_SEED, &pool_id.to_le_bytes()], bump = pool.bump)]
    pub pool: Account<'info, Pool>,
    #[account(
        mut,
        seeds = [TICKET_SEED, pool.key().as_ref(), ticket.buyer.as_ref()],
        bump = ticket.bump,
        has_one = rent_payer @ PoolError::AccountMismatch,
        close = rent_payer
    )]
    pub ticket: Account<'info, Ticket>,
    /// CHECK: receives the rent, equal to `ticket.rent_payer`
    #[account(mut)]
    pub rent_payer: UncheckedAccount<'info>,
}

pub fn handle_close_ticket(ctx: Context<CloseTicket>, _pool_id: u32) -> Result<()> {
    require!(ctx.accounts.pool.status == STATUS_SETTLED, PoolError::NotSettled);
    Ok(())
}
