use anchor_lang::prelude::*;

pub const CONFIG_SEED: &[u8] = b"config";
pub const POOL_SEED: &[u8] = b"pool";
pub const VAULT_SEED: &[u8] = b"vault";
pub const TICKET_SEED: &[u8] = b"ticket";
pub const SERIES_SEED: &[u8] = b"series";
pub const ATTESTATION_SEED: &[u8] = b"attestation";
pub const PLEDGE_SEED: &[u8] = b"pledge";
/// v4 (audit H4): a pledge settles on ITS ride's attestation, not on the driver's best ride in the pool
pub const RIDE_ATTESTATION_SEED: &[u8] = b"ride_attestation";
/// v4 (audit M8): what one sponsor put into one pool – refunded if the pool fails
pub const SPONSOR_RECEIPT_SEED: &[u8] = b"sponsor_receipt";

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

/// v4 defaults of the two Config floors (`migrate_config_v4` / `initialize`; the cold admin may change them with `set_config` – localnet runs
/// minute-long pools on a real validator clock, so the floors cannot be constants):
/// the review window every pool keeps after its play deadline, and the time between a winners root's commit and its first prize (audit H5).
pub const DEFAULT_MIN_REVIEW_SECS: i64 = 3_600;
/// the play window after the sale: no sale and no new ride after the sale end, so the shifts on the road need this long to finish (the last call).
pub const DEFAULT_MIN_FINISH_SECS: i64 = 10_800;

/// v5 defaults of the pool rules (`initialize` / `set_pool_rules`). The plan's weekly contest is 85% prizes / 5% carry / 10% final.
/// `fee_bps` is that 10% leg: it is paid to `fee_treasury` (minus the snapshotted platform cut). Point `fee_treasury` at the final
/// accumulator and set `platform_fee_bps` to 0 if the 10% must not be skimmed. Board shares 25/30/45 stay off chain.
pub const DEFAULT_PRIZE_BPS: u16 = 8_500;
pub const DEFAULT_SEED_BPS: u16 = 500;
pub const DEFAULT_FEE_BPS: u16 = 1_000;
/// Plan figure: player-derived money is at most 47.4% of any pool. The program refuses a setting of 5_000 or more.
pub const DEFAULT_MAX_PLAYER_SHARE_BPS: u16 = 4_740;
/// Highest `max_player_share_bps` the program will store. 5_000 and above are rejected.
pub const MAX_PLAYER_SHARE_BPS: u16 = 4_999;

/// A pool's winners root covers at most this many ranks (`Pool.paid_mask` is a u64).
pub const MAX_WINNERS: u8 = 64;
/// The leaf of a winners root: SHA-256(0x00 || WINNER_LEAF_TAG || pool_id LE u32 || rank u8 || wallet || lamports LE u64); nodes SHA-256(0x01 || l || r).
pub const WINNER_LEAF_TAG: &[u8] = b"fc-winner";
/// `commit_winners` is refused when its lock would end later than this before the settle grace (rule f: after the grace anyone may close the pool and
/// sweep the unpaid prizes, so a commit that cannot be paid out in time is a trap).
pub const COMMIT_GRACE_MARGIN_SECS: i64 = 86_400;

/// v4 (audit L4): a new pool's road is sealed from the hash of a slot this many slots after the one it opened in – nobody, not the opener, can pick it.
pub const SEAL_DELAY_SLOTS: u64 = 8;
/// The SlotHashes sysvar keeps the newest 512 entries: a target that has left it can no longer be read and is re-armed.
pub const SLOT_HASHES_WINDOW: u64 = 512;
