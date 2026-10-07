pub const CONFIG_SEED: &[u8] = b"config";
pub const POOL_SEED: &[u8] = b"pool";
pub const VAULT_SEED: &[u8] = b"vault";
pub const TICKET_SEED: &[u8] = b"ticket";

pub const BPS_DENOM: u64 = 10_000;

// Pool.status
pub const STATUS_OPEN: u8 = 0;
pub const STATUS_ACTIVE: u8 = 1;
pub const STATUS_REFUNDING: u8 = 2;
pub const STATUS_SETTLED: u8 = 3;
/// Terminal state of a pool that was refunded and then closed (vault swept to 0).
pub const STATUS_CANCELLED: u8 = 4;
