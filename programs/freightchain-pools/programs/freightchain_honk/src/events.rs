use anchor_lang::prelude::*;

#[event]
pub struct HonkInitialized {
    pub supply: u64,
    pub sol_in: u64,
    pub lp: u64,
}

#[event]
pub struct Swapped {
    pub user: Pubkey,
    pub sol_in: u64,
    pub honk_out: u64,
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
