pub mod catalog;
pub mod constants;
pub mod error;
pub mod events;
pub mod instructions;
pub mod math;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use error::*;
pub use instructions::*;
pub use math::isqrt;
pub use state::*;

declare_id!("GctCYSHbCnHN8sE1LjUL9cmSpFd5mcVdfaumRcaVWZZx");

#[program]
pub mod freightchain_honk {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, sol_in: u64) -> Result<()> {
        instructions::initialize::handle_initialize(ctx, sol_in)
    }

    pub fn swap_sol_for_honk(
        ctx: Context<SwapSolForHonk>,
        sol_in: u64,
        min_out: u64,
    ) -> Result<()> {
        instructions::swap::handle_swap_sol_for_honk(ctx, sol_in, min_out)
    }

    pub fn burn(ctx: Context<Burn>, amount: u64) -> Result<()> {
        instructions::burn::handle_burn(ctx, amount)
    }

    pub fn buy_part(ctx: Context<BuyPart>, slot: [u8; 16], item: [u8; 16]) -> Result<()> {
        instructions::buy_part::handle_buy_part(ctx, slot, item)
    }

    pub fn release_lp(ctx: Context<ReleaseLp>) -> Result<()> {
        instructions::release_lp::handle_release_lp(ctx)
    }
}
