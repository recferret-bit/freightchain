pub const CONFIG_SEED: &[u8] = b"config";
pub const AUTHORITY_SEED: &[u8] = b"authority";
pub const HONK_MINT_SEED: &[u8] = b"honk-mint";
pub const VAULT_SEED: &[u8] = b"vault";
pub const POOL_SEED: &[u8] = b"pool";
pub const LP_MINT_SEED: &[u8] = b"lp-mint";
pub const LP_LOCKER_SEED: &[u8] = b"lp-locker";
pub const LOCKER_SEED: &[u8] = b"locker";
pub const PART_SEED: &[u8] = b"part";
pub const RIDE_MINT_SEED: &[u8] = b"ride-mint";
pub const EMISSION_SEED: &[u8] = b"emission";
pub const AIRDROP_SEED: &[u8] = b"airdrop";
pub const REFERRAL_SEED: &[u8] = b"referral";
pub const REFERRAL_MINT_SEED: &[u8] = b"referral-mint";
pub const TREASURY_SEED: &[u8] = b"treasury";
pub const TEAM_SEED: &[u8] = b"team";
pub const WALLET_DAY_SEED: &[u8] = b"wallet-day";
pub const WALLET_MONTH_SEED: &[u8] = b"wallet-month";
pub const WALLET_AIRDROP_SEED: &[u8] = b"wallet-airdrop";

pub const DECIMALS: u8 = 6;
pub const UNIT: u64 = 1_000_000;
/// On-chain name and ticker. A rename edits these two and the matching server and client constants.
pub const TOKEN_NAME: &[u8] = b"TEN4";
pub const TOKEN_SYMBOL: &[u8] = b"TEN4";

pub const MAX_SUPPLY: u64 = 100_000_000 * UNIT;
/// Liquidity deposited in the pool. Not ride emission.
pub const LIQUIDITY: u64 = 15_000_000 * UNIT;
/// Proof-of-haul budget. Pre-minted into the emission vault. Mint authority is then none.
pub const EMISSION_CAP: u64 = 55_000_000 * UNIT;
pub const AIRDROP: u64 = 8_000_000 * UNIT;
pub const REFERRAL: u64 = 4_000_000 * UNIT;
pub const TREASURY: u64 = 10_000_000 * UNIT;
/// Team allocation (8M, always enabled): 12-month cliff + 24-month linear vest.
pub const TEAM: u64 = 8_000_000 * UNIT;
/// First era. Each later era is half, and the finish reward halves with it.
pub const ERA_SIZE: u64 = EMISSION_CAP / 2;
/// First referral era (2M -> 1M -> 500k -> ...).
pub const REFERRAL_ERA_SIZE: u64 = REFERRAL / 2;
pub const REFERRAL_TAIL_ERA: u32 = 8;

pub const ORDINARY_PART: u64 = 65 * UNIT;
pub const GOLD_PART: u64 = 260 * UNIT;
/// Opening deposit, in lamports. The documented target is 50 SOL, not a dollar price.
pub const OPENING_LAMPORTS: u64 = 50_000_000_000;
/// 0.25%. Inside the 0.25–1% band. The launch pool is a Raydium CPMM at a fee in that band.
pub const FEE_BPS: u64 = 25;
pub const FEE_DENOM: u64 = 10_000;

/// Era 1 global cap. Later eras shift this right so an era still lasts about a year.
pub const DAILY_GLOBAL_ERA1: u64 = 75_000 * UNIT;
pub const DAILY_WALLET: u64 = 2_000 * UNIT;
pub const REFERRAL_MONTHLY_GLOBAL: u64 = 60_000 * UNIT;
pub const REFERRAL_SOFT_START_GLOBAL: u64 = 30_000 * UNIT;
pub const REFERRAL_SOFT_START_MONTHS: i64 = 3;
pub const REFERRAL_MONTHLY_WALLET: u64 = 1_000 * UNIT;
pub const AIRDROP_WALLET_CAP: u64 = 2_000 * UNIT;
pub const DAY_SECS: i64 = 86_400;
/// 30-day month, so a vest length is exact on chain.
pub const MONTH_SECS: i64 = 30 * DAY_SECS;
pub const AIRDROP_WINDOW_DAYS: i64 = 90;
pub const AIRDROP_WINDOW_SECS: i64 = AIRDROP_WINDOW_DAYS * DAY_SECS;
pub const MAX_MERKLE_PROOF: usize = 20;
pub const TREASURY_VEST_MONTHS: u8 = 36;
pub const TEAM_CLIFF_MONTHS: u8 = 12;
pub const TEAM_LINEAR_MONTHS: u8 = 24;

pub const BAND_20: u8 = 1;
pub const BAND_50: u8 = 2;
pub const BAND_100: u8 = 4;

pub fn pad8(bytes: &[u8]) -> [u8; 8] {
    let mut out = [0u8; 8];
    let n = bytes.len().min(out.len());
    out[..n].copy_from_slice(&bytes[..n]);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn supply_and_opening_deposit() {
        assert_eq!(OPENING_LAMPORTS, 50 * 1_000_000_000);
        assert_eq!(DECIMALS, 6);
        assert_eq!(UNIT, 1_000_000);
        assert_eq!(TOKEN_SYMBOL, b"TEN4");
        assert_eq!(TOKEN_NAME, b"TEN4");
        assert_eq!(AIRDROP, 8_000_000 * UNIT);
        assert_eq!(REFERRAL, 4_000_000 * UNIT);
        assert_eq!(TEAM, 8_000_000 * UNIT);
        assert_eq!(TEAM_CLIFF_MONTHS, 12);
        assert_eq!(TEAM_LINEAR_MONTHS, 24);
        assert_eq!(
            LIQUIDITY + EMISSION_CAP + AIRDROP + REFERRAL + TREASURY + TEAM,
            MAX_SUPPLY
        );
        assert_eq!(ERA_SIZE, 27_500_000 * UNIT);
        assert_eq!(REFERRAL_ERA_SIZE, 2_000_000 * UNIT);
        assert_eq!(FEE_BPS, 25);
        assert_eq!(DAILY_GLOBAL_ERA1, 75_000 * UNIT);
        assert_eq!(DAILY_WALLET, 2_000 * UNIT);
        assert_eq!(REFERRAL_MONTHLY_GLOBAL, 60_000 * UNIT);
        assert_eq!(REFERRAL_SOFT_START_GLOBAL, 30_000 * UNIT);
        assert_eq!(REFERRAL_MONTHLY_WALLET, 1_000 * UNIT);
        assert_eq!(AIRDROP_WALLET_CAP, 2_000 * UNIT);
        assert_eq!(ORDINARY_PART, 65 * UNIT);
        assert_eq!(GOLD_PART, 260 * UNIT);
    }
}
