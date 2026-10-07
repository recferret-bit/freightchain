pub mod constants;
pub mod error;
pub mod events;
pub mod instructions;
pub mod state;
pub mod vault;

use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;
pub use state::*;

declare_id!("B79YYUKFd3QC3HdRkSX1W3C6sGBDFEkgFGQcMShiFSKa");

#[program]
pub mod freightchain_pools {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, platform_treasury: Pubkey, platform_fee_bps: u16) -> Result<()> {
        instructions::admin::handle_initialize(ctx, platform_treasury, platform_fee_bps)
    }

    pub fn set_config(
        ctx: Context<SetConfig>,
        paused: Option<bool>,
        platform_treasury: Option<Pubkey>,
        platform_fee_bps: Option<u16>,
    ) -> Result<()> {
        instructions::admin::handle_set_config(ctx, paused, platform_treasury, platform_fee_bps)
    }

    pub fn propose_authority(ctx: Context<ProposeAuthority>, new_authority: Pubkey) -> Result<()> {
        instructions::admin::handle_propose_authority(ctx, new_authority)
    }

    pub fn accept_authority(ctx: Context<AcceptAuthority>) -> Result<()> {
        instructions::admin::handle_accept_authority(ctx)
    }

    pub fn create_pool(ctx: Context<CreatePool>, params: CreatePoolParams) -> Result<()> {
        instructions::create_pool::handle_create_pool(ctx, params)
    }

    pub fn buy_ticket(ctx: Context<BuyTicket>, pool_id: u32, qty: u16, order_id: [u8; 16]) -> Result<()> {
        instructions::buy_ticket::handle_buy_ticket(ctx, pool_id, qty, order_id)
    }

    pub fn sponsor(ctx: Context<Sponsor>, pool_id: u32, lamports: u64) -> Result<()> {
        instructions::sponsor::handle_sponsor(ctx, pool_id, lamports)
    }

    pub fn fail_pool(ctx: Context<FailPool>, pool_id: u32) -> Result<()> {
        instructions::lifecycle::handle_fail_pool(ctx, pool_id)
    }

    pub fn cancel_pool(ctx: Context<CancelPool>, pool_id: u32) -> Result<()> {
        instructions::lifecycle::handle_cancel_pool(ctx, pool_id)
    }

    pub fn expire_pool(ctx: Context<ExpirePool>, pool_id: u32) -> Result<()> {
        instructions::lifecycle::handle_expire_pool(ctx, pool_id)
    }

    pub fn refund(ctx: Context<Refund>, pool_id: u32) -> Result<()> {
        instructions::refund::handle_refund(ctx, pool_id)
    }

    pub fn close_ticket(ctx: Context<CloseTicket>, pool_id: u32) -> Result<()> {
        instructions::refund::handle_close_ticket(ctx, pool_id)
    }

    pub fn pay_prize(ctx: Context<PayPrize>, pool_id: u32, lamports: u64, rank: u8) -> Result<()> {
        instructions::settle::handle_pay_prize(ctx, pool_id, lamports, rank)
    }

    pub fn close_pool(ctx: Context<ClosePool>, pool_id: u32) -> Result<()> {
        instructions::settle::handle_close_pool(ctx, pool_id)
    }
}
