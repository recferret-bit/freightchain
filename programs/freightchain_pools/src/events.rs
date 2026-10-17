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
    pub payout_at: i64,
    pub prize_bps: u16,
    pub seed_bps: u16,
    pub fee_bps: u16,
    pub fee_treasury: Pubkey,
    pub seed_treasury: Pubkey,
    /// true = opened by `open_next_pool` from the tier's series, false = `create_pool` by the admin
    pub from_series: bool,
    pub seed_commitment: [u8; 32],
    pub seed_slot: u64,
    pub seed_slot_hash: [u8; 32],
    /// v5 snapshot
    pub paid_tickets_enabled: bool,
    pub max_player_share_bps: u16,
}

#[event]
pub struct SeriesSet {
    pub tier: u8,
    pub enabled: bool,
    pub price_lamports: u64,
    pub min_tickets: u32,
    pub max_tickets: u32,
    pub max_per_wallet: u16,
    pub sale_secs: i64,
    pub play_secs: i64,
    pub verify_secs: i64,
    pub prize_bps: u16,
    pub seed_bps: u16,
    pub fee_bps: u16,
    pub fee_treasury: Pubkey,
    pub seed_treasury: Pubkey,
    pub next_open_at: i64,
}

#[event]
pub struct PayoutAuthoritySet {
    pub authority: Pubkey,
    pub payout_authority: Option<Pubkey>,
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
pub struct PoolExpired {
    pub pool_id: u32,
    pub tickets_sold: u32,
}

#[event]
pub struct AuthorityProposed {
    pub authority: Pubkey,
    pub pending_authority: Pubkey,
}

#[event]
pub struct AuthorityChanged {
    pub old_authority: Pubkey,
    pub new_authority: Pubkey,
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
    /// everything that went to seed_treasury (carry share + unclaimed prize + ticket excess + stray lamports)
    pub seed: u64,
    /// fee share that went to fee_treasury (after the platform cut)
    pub fee: u64,
    pub platform_fee: u64,
    pub unclaimed: u64,
    /// vault rent minimum returned to the authority
    pub rent_returned: u64,
    pub cancelled: bool,
    /// v5: ticket lamports excluded from the prize base and carried inside `seed` (0 when the pool was cancelled)
    pub ticket_excess: u64,
}

/// v5: the admin changed the rules that the NEXT pool will snapshot.
#[event]
pub struct PoolRulesSet {
    pub paid_tickets_enabled: bool,
    pub prize_bps: u16,
    pub seed_bps: u16,
    pub fee_bps: u16,
    pub max_player_share_bps: u16,
    /// 0 = no extra cap
    pub max_tickets: u32,
}

#[event]
pub struct AttestationRecorded {
    pub pool_id: u32,
    pub pool: Pubkey,
    pub driver: Pubkey,
    pub telemetry_root: [u8; 32],
    pub verified_km: u32,
    pub status: u8,
    pub recorded_at: i64,
}

#[event]
pub struct PledgeCreated {
    pub ride_id: [u8; 32],
    pub sponsor: Pubkey,
    pub driver: Pubkey,
    pub pool: Pubkey,
    pub max_lamports: u64,
    pub lamports_per_km: u64,
    pub target_km: u32,
    pub created_at: i64,
}

#[event]
pub struct PledgeSettled {
    pub ride_id: [u8; 32],
    pub sponsor: Pubkey,
    pub driver: Pubkey,
    pub pool: Pubkey,
    pub verified_km: u32,
    pub target_km: u32,
    pub earned_lamports: u64,
    pub refunded_lamports: u64,
}

#[event]
pub struct PledgeRefunded {
    pub ride_id: [u8; 32],
    pub sponsor: Pubkey,
    pub driver: Pubkey,
    pub pool: Pubkey,
    pub refunded_lamports: u64,
}

// ── v4 ──

#[event]
pub struct ConfigMigrated {
    pub min_review_secs: i64,
    pub min_finish_secs: i64,
}

#[event]
pub struct FloorsSet {
    pub min_review_secs: i64,
    pub min_finish_secs: i64,
}

/// v4 (L4): the pool's road seed, fixed from the hash of `seed_slot` – a slot after the pool opened, so nobody could pick it
#[event]
pub struct RoadSealed {
    pub pool_id: u32,
    pub seed_slot: u64,
    pub seed_slot_hash: [u8; 32],
    pub seed_commitment: [u8; 32],
}

/// the target slot had left the SlotHashes window before anyone sealed: a new target
#[event]
pub struct SealRearmed {
    pub pool_id: u32,
    pub seal_slot: u64,
}

/// v4 (H5-B): the pool's winners, public for the whole review lock before any of them is paid
#[event]
pub struct WinnersCommitted {
    pub pool_id: u32,
    pub root: [u8; 32],
    pub total: u64,
    pub count: u8,
    pub committed_at: i64,
    pub pay_from: i64,
    pub by: Pubkey,
}

#[event]
pub struct WinnersVetoed {
    pub pool_id: u32,
    pub root: [u8; 32],
}

/// v4 (H4): the server's verdict on one ride, for the pledges on it
#[event]
pub struct RideAttestationRecorded {
    pub pool_id: u32,
    pub pool: Pubkey,
    pub ride_id: [u8; 32],
    pub driver: Pubkey,
    pub telemetry_root: [u8; 32],
    pub verified_km: u32,
    pub status: u8,
    pub recorded_at: i64,
    pub settle_from: i64,
}

/// v4 (M8)
#[event]
pub struct SponsorRefunded {
    pub pool_id: u32,
    pub sponsor: Pubkey,
    pub lamports: u64,
    pub sponsor_refunded_total: u64,
}

/// v4 (L7): an attestation of a finished pool closed, its rent back to whoever paid it
#[event]
pub struct AttestationClosed {
    pub account: Pubkey,
    pub rent_to: Pubkey,
    pub lamports: u64,
}
