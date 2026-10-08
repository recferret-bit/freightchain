pub const CONFIG_SEED: &[u8] = b"config";
pub const POOL_SEED: &[u8] = b"pool";
pub const VAULT_SEED: &[u8] = b"vault";
pub const TICKET_SEED: &[u8] = b"ticket";

pub const BPS_DENOM: u64 = 10_000;

/// After `play_deadline + SETTLE_GRACE_SECS` an Active pool no longer needs the admin:
/// anyone may `close_pool` it, or `expire_pool` it (if no prize was paid) so every ticket is refunded.
pub const SETTLE_GRACE_SECS: i64 = 14 * 86_400;

/// `create_pool` refuses a `play_deadline` further out than this: a far-future deadline would lock an Active pool's
/// tickets (no payout, close or expiry before it) for that long.
pub const MAX_POOL_SECS: i64 = 365 * 86_400;

// Pool.status
pub const STATUS_OPEN: u8 = 0;
pub const STATUS_ACTIVE: u8 = 1;
pub const STATUS_REFUNDING: u8 = 2;
pub const STATUS_SETTLED: u8 = 3;
/// Terminal state of a pool that was refunded and then closed (vault swept to 0).
pub const STATUS_CANCELLED: u8 = 4;
