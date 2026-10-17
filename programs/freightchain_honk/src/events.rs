use anchor_lang::prelude::*;

#[event]
pub struct HonkInitialized {
    pub supply: u64,
    pub sol_in: u64,
    pub lp_burned: u64,
    pub team_enabled: bool,
    pub name: [u8; 8],
    pub symbol: [u8; 8],
}

#[event]
pub struct Swapped {
    pub user: Pubkey,
    pub sol_in: u64,
    pub honk_out: u64,
}

#[event]
pub struct Sold {
    pub user: Pubkey,
    pub honk_in: u64,
    pub sol_out: u64,
}

#[event]
pub struct Burned {
    pub user: Pubkey,
    pub amount: u64,
}

#[event]
pub struct PartBought {
    pub user: Pubkey,
    pub gold: bool,
    pub nft_mint: Pubkey,
}

#[event]
pub struct RidePaid {
    pub rider: Pubkey,
    pub amount: u64,
    pub era: u8,
}

#[event]
pub struct Vested {
    pub to: Pubkey,
    pub amount: u64,
    pub team: bool,
}
