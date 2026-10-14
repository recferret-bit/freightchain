use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Pool {
    /// Lamports paid in, not including the account's rent.
    pub sol_reserve: u64,
    pub honk_reserve: u64,
    /// `release_lp` is refused until this timestamp.
    pub unlock_at: i64,
    pub bump: u8,
}

/// One soulbound part per buyer, slot, and item. A second buy hits the same PDA.
#[account]
#[derive(InitSpace)]
pub struct Part {
    pub buyer: Pubkey,
    pub slot: [u8; 16],
    pub item: [u8; 16],
    pub gold: bool,
    pub nft_mint: Pubkey,
    pub bump: u8,
}
