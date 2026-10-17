pub mod catalog;
pub mod constants;
pub mod error;
pub mod events;
pub mod instructions;
pub mod math;
pub mod pay;
pub mod schedule;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use error::*;
pub use instructions::*;
pub use math::isqrt;
pub use schedule::{era_index, finish_units, global_daily_cap, quote_units, vested};
pub use state::*;

declare_id!("GctCYSHbCnHN8sE1LjUL9cmSpFd5mcVdfaumRcaVWZZx");

#[program]
pub mod freightchain_honk {
    use super::*;

    pub fn initialize(
        ctx: Context<Initialize>,
        sol_in: u64,
        emitter: Pubkey,
        treasury: Pubkey,
        team_recipient: Pubkey,
        team_enabled: bool,
        team_linear_months: u8,
    ) -> Result<()> {
        instructions::initialize::handle_initialize(
            ctx,
            sol_in,
            emitter,
            treasury,
            team_recipient,
            team_enabled,
            team_linear_months,
        )
    }

    pub fn swap_sol_for_honk(
        ctx: Context<SwapSolForHonk>,
        sol_in: u64,
        min_out: u64,
    ) -> Result<()> {
        instructions::swap::handle_swap_sol_for_honk(ctx, sol_in, min_out)
    }

    pub fn swap_honk_for_sol(
        ctx: Context<SwapHonkForSol>,
        honk_in: u64,
        min_sol_out: u64,
    ) -> Result<()> {
        instructions::swap::handle_swap_honk_for_sol(ctx, honk_in, min_sol_out)
    }

    pub fn burn(ctx: Context<Burn>, amount: u64) -> Result<()> {
        instructions::burn::handle_burn(ctx, amount)
    }

    pub fn mint_ride(
        ctx: Context<MintRide>,
        ride_id: [u8; 16],
        tier: u8,
        bands: u8,
        day_index: i64,
    ) -> Result<()> {
        instructions::mint_ride::handle_mint_ride(ctx, ride_id, tier, bands, day_index)
    }

    pub fn buy_part(ctx: Context<BuyPart>, slot: [u8; 16], item: [u8; 16]) -> Result<()> {
        instructions::buy_part::handle_buy_part(ctx, slot, item)
    }

    pub fn claim_treasury(ctx: Context<ClaimTreasury>) -> Result<()> {
        instructions::claim::handle_claim_treasury(ctx)
    }

    pub fn claim_team(ctx: Context<ClaimTeam>) -> Result<()> {
        instructions::claim::handle_claim_team(ctx)
    }
}
