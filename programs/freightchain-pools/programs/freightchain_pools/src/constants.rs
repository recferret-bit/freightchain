use anchor_lang::prelude::*;

pub const CONFIG_SEED: &[u8] = b"config";
pub const POOL_SEED: &[u8] = b"pool";
pub const VAULT_SEED: &[u8] = b"vault";
pub const TICKET_SEED: &[u8] = b"ticket";
pub const SERIES_SEED: &[u8] = b"series";
pub const ATTESTATION_SEED: &[u8] = b"attestation";
pub const PLEDGE_SEED: &[u8] = b"pledge";

/// The SlotHashes sysvar (anchor-lang 1.2 does not re-export its module)
pub const SLOT_HASHES_ID: Pubkey = pubkey!("SysvarS1otHashes111111111111111111111111111");

// Attestation.status
pub const ATTESTATION_STATUS_UNVERIFIED: u8 = 0;
pub const ATTESTATION_STATUS_VERIFIED: u8 = 1;
pub const ATTESTATION_STATUS_FLAGGED: u8 = 2;

pub const BPS_DENOM: u64 = 10_000;

/// After `payout_at + SETTLE_GRACE_SECS` an Active pool no longer needs the admin or the payout key:
/// anyone may `close_pool` it (if a prize was paid), or `expire_pool` it (if none was) so every ticket is refunded.
pub const SETTLE_GRACE_SECS: i64 = 14 * 86_400;

/// `create_pool` / `set_series` refuse a `payout_at` further out than this: a far-future payout time would lock an Active pool's
/// tickets (no payout, close or expiry before it) for that long.
pub const MAX_POOL_SECS: i64 = 365 * 86_400;

/// A series' sale window is also its cadence (the next pool opens when this one stops selling): at least an hour, at most 30 days.
pub const MIN_SALE_SECS: i64 = 3_600;
pub const MAX_SALE_SECS: i64 = 30 * 86_400;

// Pool.status
pub const STATUS_OPEN: u8 = 0;
pub const STATUS_ACTIVE: u8 = 1;
pub const STATUS_REFUNDING: u8 = 2;
pub const STATUS_SETTLED: u8 = 3;
/// Terminal state of a pool that was refunded and then closed (vault swept to 0).
pub const STATUS_CANCELLED: u8 = 4;
