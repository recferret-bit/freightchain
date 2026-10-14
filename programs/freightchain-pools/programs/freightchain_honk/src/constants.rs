pub const CONFIG_SEED: &[u8] = b"config";
pub const AUTHORITY_SEED: &[u8] = b"authority";
pub const HONK_MINT_SEED: &[u8] = b"honk-mint";
pub const VAULT_SEED: &[u8] = b"vault";
pub const POOL_SEED: &[u8] = b"pool";
pub const LP_MINT_SEED: &[u8] = b"lp-mint";
pub const LP_LOCKER_SEED: &[u8] = b"lp-locker";
pub const LOCKER_SEED: &[u8] = b"locker";
pub const PART_SEED: &[u8] = b"part";

pub const DECIMALS: u8 = 6;
pub const UNIT: u64 = 1_000_000;
/// The only HONK ever minted. Supply can only fall after this.
pub const GENESIS: u64 = 2_000_000 * UNIT;
pub const ORDINARY_PART: u64 = 65 * UNIT;
pub const GOLD_PART: u64 = 260 * UNIT;
/// LP stays in the locker until this many seconds after `initialize`.
pub const LOCK_SECS: i64 = 365 * 86_400;
/// Opening deposit, in lamports. Not a dollar price. `initialize` accepts this and nothing else.
pub const OPENING_LAMPORTS: u64 = 10_000_000_000;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn opening_deposit_is_ten_sol() {
        assert_eq!(OPENING_LAMPORTS, 10 * 1_000_000_000);
        assert_eq!(DECIMALS, 6);
        assert_eq!(UNIT, 1_000_000);
        assert_eq!(GENESIS, 2_000_000 * UNIT);
        assert_eq!(ORDINARY_PART, 65 * UNIT);
        assert_eq!(GOLD_PART, 260 * UNIT);
    }
}
