use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub bump: u8,
    /// The only key that may call `mint_ride`.
    pub emitter: Pubkey,
    /// Ride HONK minted so far. Never includes the genesis in the vault.
    pub emitted: u64,
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

/// One verified ride's on-chain mint. The same ride id cannot mint twice.
#[account]
#[derive(InitSpace)]
pub struct RideMint {
    pub amount: u64,
    pub bump: u8,
}
