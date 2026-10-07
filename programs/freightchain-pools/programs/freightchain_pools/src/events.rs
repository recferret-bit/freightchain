use anchor_lang::prelude::*;

#[event]
pub struct PoolCreated {
    pub pool_id: u32,
    pub pool: Pubkey,
    pub vault: Pubkey,
    pub authority: Pubkey,
    pub tier: u8,
    pub price_lamports: u64,
    pub min_tickets: u32,
    pub max_tickets: u32,
    pub max_per_wallet: u16,
    pub prep_deadline: i64,
    pub play_deadline: i64,
    pub prize_bps: u16,
    pub seed_bps: u16,
    pub fee_bps: u16,
    pub fee_treasury: Pubkey,
    pub seed_treasury: Pubkey,
}

#[event]
pub struct TicketBought {
    pub pool_id: u32,
    pub buyer: Pubkey,
    pub qty: u16,
    pub lamports: u64,
    pub order_id: [u8; 16],
    pub tickets_sold: u32,
    pub activated: bool,
}

#[event]
pub struct PoolActivated {
    pub pool_id: u32,
    pub tickets_sold: u32,
    pub at: i64,
}

#[event]
pub struct Sponsored {
    pub pool_id: u32,
    pub sponsor: Pubkey,
    pub lamports: u64,
    pub sponsored_total: u64,
}

#[event]
pub struct PoolFailed {
    pub pool_id: u32,
    pub tickets_sold: u32,
}

#[event]
pub struct PoolCancelled {
    pub pool_id: u32,
    pub tickets_sold: u32,
}

#[event]
pub struct Refunded {
    pub pool_id: u32,
    pub buyer: Pubkey,
    pub rent_payer: Pubkey,
    pub qty: u16,
    pub lamports: u64,
    pub refunded_total: u64,
}

#[event]
pub struct PrizePaid {
    pub pool_id: u32,
    pub to: Pubkey,
    pub lamports: u64,
    pub rank: u8,
    pub prizes_paid_total: u64,
}

#[event]
pub struct PoolClosed {
    pub pool_id: u32,
    /// prizes paid out over the pool's life
    pub prize_paid: u64,
    /// everything that went to seed_treasury (seed share + unclaimed prize [+ donations / sponsorship of a failed pool])
    pub seed: u64,
    /// fee share that went to fee_treasury (after the platform cut)
    pub fee: u64,
    pub platform_fee: u64,
    pub unclaimed: u64,
    /// vault rent minimum returned to the authority
    pub rent_returned: u64,
    pub cancelled: bool,
}
