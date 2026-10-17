use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub bump: u8,
    /// The only key that may call `mint_ride`. Intended to be a Squads multisig.
    pub emitter: Pubkey,
    /// Treasury vest pays only this key. Intended to be a Squads multisig.
    pub treasury: Pubkey,
    /// Team vest pays only this key. Default pubkey when the team allocation is off.
    pub team_recipient: Pubkey,
    pub team_enabled: bool,
    /// 24 or 36 after the 12-month cliff. 0 when the team allocation is off.
    pub team_linear_months: u8,
    /// Ride TEN4 paid out of the emission vault. Never includes the other buckets.
    pub emitted: u64,
    pub day_index: i64,
    pub day_emitted: u64,
    pub treasury_claimed: u64,
    pub team_claimed: u64,
    pub opened_at: i64,
    /// UTF-8, zero padded. Copied from `TOKEN_NAME` / `TOKEN_SYMBOL` at initialize.
    pub name: [u8; 8],
    pub symbol: [u8; 8],
}

#[account]
#[derive(InitSpace)]
pub struct Pool {
    /// Lamports paid in, not including the account's rent.
    pub sol_reserve: u64,
    pub honk_reserve: u64,
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

/// One verified ride. The same ride id cannot pay twice.
#[account]
#[derive(InitSpace)]
pub struct RideMint {
    pub amount: u64,
    pub tier: u8,
    pub bands: u8,
    pub era: u8,
    pub bump: u8,
}

/// TEN4 paid to one rider on one unix day.
#[account]
#[derive(InitSpace)]
pub struct WalletDay {
    pub amount: u64,
    pub bump: u8,
}
