use anchor_lang::{
    prelude::*,
    system_program::{transfer, Transfer},
};

use crate::{
    constants::*,
    error::PoolError,
    events::{PoolActivated, TicketBought},
    state::{Config, Pool, Ticket},
};

#[derive(Accounts)]
#[instruction(pool_id: u32, qty: u16, order_id: [u8; 16])]
pub struct BuyTicket<'info> {
    /// Pays the ticket price. May be the same key as `fee_payer`.
    #[account(mut, dup)]
    pub buyer: Signer<'info>,
    /// Pays the transaction fee and the Ticket rent (recorded as `rent_payer`). The sponsor when gasless.
    #[account(mut, dup)]
    pub fee_payer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [POOL_SEED, &pool_id.to_le_bytes()], bump = pool.bump)]
    pub pool: Account<'info, Pool>,
    /// CHECK: the escrow, a zero-data system account at the vault PDA
    #[account(mut, seeds = [VAULT_SEED, &pool_id.to_le_bytes()], bump = pool.vault_bump)]
    pub vault: UncheckedAccount<'info>,
    #[account(
        init_if_needed,
        payer = fee_payer,
        space = 8 + Ticket::INIT_SPACE,
        seeds = [TICKET_SEED, pool.key().as_ref(), buyer.key().as_ref()],
        bump
    )]
    pub ticket: Account<'info, Ticket>,
    pub system_program: Program<'info, System>,
}

pub fn handle_buy_ticket(ctx: Context<BuyTicket>, pool_id: u32, qty: u16, order_id: [u8; 16]) -> Result<()> {
    require!(!ctx.accounts.config.paused, PoolError::Paused);
    require!(qty > 0, PoolError::InvalidParams);
    let now = Clock::get()?.unix_timestamp;
    let pool = &mut ctx.accounts.pool;
    require!(
        pool.status == STATUS_OPEN || pool.status == STATUS_ACTIVE,
        PoolError::PoolNotOpen
    );
    require!(now < pool.play_deadline, PoolError::TooLate);
    // An Open pool past its prep deadline is below the minimum by construction: it can only fail now.
    require!(pool.status != STATUS_OPEN || now < pool.prep_deadline, PoolError::TooLate);

    let sold = pool.tickets_sold.checked_add(qty as u32).ok_or(PoolError::MathOverflow)?;
    require!(pool.max_tickets == 0 || sold <= pool.max_tickets, PoolError::SoldOut);

    let t = &mut ctx.accounts.ticket;
    let first = t.buyer == Pubkey::default();
    if first {
        t.buyer = ctx.accounts.buyer.key();
        t.rent_payer = ctx.accounts.fee_payer.key();
        t.pool_id = pool_id;
        t.qty = 0;
        t.lamports = 0;
        t.bump = ctx.bumps.ticket;
        pool.buyers = pool.buyers.checked_add(1).ok_or(PoolError::MathOverflow)?;
    }
    let new_qty = t.qty.checked_add(qty).ok_or(PoolError::WalletCap)?;
    require!(new_qty <= pool.max_per_wallet, PoolError::WalletCap);

    let cost = u64::try_from((pool.price_lamports as u128) * (qty as u128)).map_err(|_| PoolError::MathOverflow)?;
    t.qty = new_qty;
    t.lamports = t.lamports.checked_add(cost).ok_or(PoolError::MathOverflow)?;
    pool.tickets_sold = sold;

    transfer(
        CpiContext::new(
            ctx.accounts.system_program.key(),
            Transfer { from: ctx.accounts.buyer.to_account_info(), to: ctx.accounts.vault.to_account_info() },
        ),
        cost,
    )?;

    let activated = pool.status == STATUS_OPEN && sold >= pool.min_tickets;
    if activated {
        pool.status = STATUS_ACTIVE;
    }
    emit!(TicketBought {
        pool_id,
        buyer: ctx.accounts.buyer.key(),
        qty,
        lamports: cost,
        order_id,
        tickets_sold: sold,
        activated,
    });
    if activated {
        emit!(PoolActivated { pool_id, tickets_sold: sold, at: now });
    }
    Ok(())
}
