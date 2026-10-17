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

declare_id!("8No42h2QXb9opgp3pJfNXL2o77o288SsF8o7CwJGCA1p");

#[program]
pub mod freightchain_pools {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, authority: Pubkey, platform_treasury: Pubkey, platform_fee_bps: u16) -> Result<()> {
        instructions::admin::handle_initialize(ctx, authority, platform_treasury, platform_fee_bps)
    }

    pub fn set_config(
        ctx: Context<SetConfig>,
        paused: Option<bool>,
        platform_treasury: Option<Pubkey>,
        platform_fee_bps: Option<u16>,
        min_review_secs: Option<i64>,
        min_finish_secs: Option<i64>,
    ) -> Result<()> {
        instructions::admin::handle_set_config(ctx, paused, platform_treasury, platform_fee_bps, min_review_secs, min_finish_secs)
    }

    /// v4: once, right after the upgrade – the v3 Config grows to the v4 layout (the floors at their defaults)
    pub fn migrate_config_v4(ctx: Context<MigrateConfigV4>) -> Result<()> {
        instructions::admin::handle_migrate_config_v4(ctx)
    }

    pub fn propose_authority(ctx: Context<ProposeAuthority>, new_authority: Pubkey) -> Result<()> {
        instructions::admin::handle_propose_authority(ctx, new_authority)
    }

    pub fn accept_authority(ctx: Context<AcceptAuthority>) -> Result<()> {
        instructions::admin::handle_accept_authority(ctx)
    }

    pub fn set_payout_authority(ctx: Context<SetPayoutAuthority>, payout_authority: Option<Pubkey>) -> Result<()> {
        instructions::admin::handle_set_payout_authority(ctx, payout_authority)
    }

    pub fn set_series(ctx: Context<SetSeries>, params: SeriesParams) -> Result<()> {
        instructions::series::handle_set_series(ctx, params)
    }

    pub fn open_next_pool(ctx: Context<OpenNextPool>, tier: u8) -> Result<()> {
        instructions::series::handle_open_next_pool(ctx, tier)
    }

    pub fn create_pool(ctx: Context<CreatePool>, params: CreatePoolParams) -> Result<()> {
        instructions::create_pool::handle_create_pool(ctx, params)
    }

    pub fn seal_road(ctx: Context<SealRoad>, pool_id: u32) -> Result<()> {
        instructions::road::handle_seal_road(ctx, pool_id)
    }

    pub fn record_ride_attestation(
        ctx: Context<RecordRideAttestation>,
        pool_id: u32,
        ride_id: [u8; 32],
        driver: Pubkey,
        telemetry_root: [u8; 32],
        verified_km: u32,
        status: u8,
    ) -> Result<()> {
        instructions::attestation::handle_record_ride_attestation(ctx, pool_id, ride_id, driver, telemetry_root, verified_km, status)
    }

    pub fn close_ride_attestation(ctx: Context<CloseRideAttestation>, pool_id: u32, ride_id: [u8; 32]) -> Result<()> {
        instructions::attestation::handle_close_ride_attestation(ctx, pool_id, ride_id)
    }

    pub fn close_attestation(ctx: Context<CloseAttestation>, pool_id: u32, driver: Pubkey) -> Result<()> {
        instructions::attestation::handle_close_attestation(ctx, pool_id, driver)
    }

    pub fn create_pledge(
        ctx: Context<CreatePledge>,
        ride_id: [u8; 32],
        driver: Pubkey,
        max_lamports: u64,
        lamports_per_km: u64,
        target_km: u32,
    ) -> Result<()> {
        instructions::pledge::handle_create_pledge(ctx, ride_id, driver, max_lamports, lamports_per_km, target_km)
    }

    pub fn settle_pledge(ctx: Context<SettlePledge>, ride_id: [u8; 32]) -> Result<()> {
        instructions::pledge::handle_settle_pledge(ctx, ride_id)
    }

    pub fn refund_pledge(ctx: Context<RefundPledge>, ride_id: [u8; 32]) -> Result<()> {
        instructions::pledge::handle_refund_pledge(ctx, ride_id)
    }

    pub fn buy_ticket(ctx: Context<BuyTicket>, pool_id: u32, qty: u16, order_id: [u8; 16]) -> Result<()> {
        instructions::buy_ticket::handle_buy_ticket(ctx, pool_id, qty, order_id)
    }

    pub fn sponsor(ctx: Context<Sponsor>, pool_id: u32, lamports: u64) -> Result<()> {
        instructions::sponsor::handle_sponsor(ctx, pool_id, lamports)
    }

    pub fn refund_sponsor(ctx: Context<RefundSponsor>, pool_id: u32) -> Result<()> {
        instructions::sponsor::handle_refund_sponsor(ctx, pool_id)
    }

    pub fn close_sponsor_receipt(ctx: Context<CloseSponsorReceipt>, pool_id: u32) -> Result<()> {
        instructions::sponsor::handle_close_sponsor_receipt(ctx, pool_id)
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

    pub fn commit_winners(ctx: Context<CommitWinners>, pool_id: u32, root: [u8; 32], total: u64, count: u8) -> Result<()> {
        instructions::settle::handle_commit_winners(ctx, pool_id, root, total, count)
    }

    pub fn veto_winners(ctx: Context<VetoWinners>, pool_id: u32) -> Result<()> {
        instructions::settle::handle_veto_winners(ctx, pool_id)
    }

    pub fn pay_prize(ctx: Context<PayPrize>, pool_id: u32, rank: u8, lamports: u64, proof: Vec<[u8; 32]>) -> Result<()> {
        instructions::settle::handle_pay_prize(ctx, pool_id, rank, lamports, proof)
    }

    pub fn close_pool(ctx: Context<ClosePool>, pool_id: u32) -> Result<()> {
        instructions::settle::handle_close_pool(ctx, pool_id)
    }
}
