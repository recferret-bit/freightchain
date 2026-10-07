use anchor_lang::prelude::*;

use crate::{constants::*, error::PoolError};

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub authority: Pubkey,
    pub platform_treasury: Pubkey,
    /// Share of the FEE share (not of the pool) that goes to `platform_treasury` at close.
    pub platform_fee_bps: u16,
    pub pool_count: u32,
    pub paused: bool,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Pool {
    pub pool_id: u32,
    pub authority: Pubkey,
    pub tier: u8,
    pub price_lamports: u64,
    pub min_tickets: u32,
    /// 0 = unlimited
    pub max_tickets: u32,
    pub max_per_wallet: u16,
    pub prep_deadline: i64,
    pub play_deadline: i64,
    pub prize_bps: u16,
    pub seed_bps: u16,
    pub fee_bps: u16,
    pub fee_treasury: Pubkey,
    pub seed_treasury: Pubkey,
    pub status: u8,
    pub tickets_sold: u32,
    pub buyers: u32,
    pub sponsored: u64,
    pub prizes_paid: u64,
    pub refunded: u64,
    pub created_at: i64,
    pub bump: u8,
    pub vault_bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Ticket {
    pub buyer: Pubkey,
    pub rent_payer: Pubkey,
    pub pool_id: u32,
    pub qty: u16,
    pub lamports: u64,
    pub refunded: bool,
    pub bump: u8,
}

/// floor(amount * bps / 10000), u128 inside.
pub fn bps_of(amount: u64, bps: u16) -> Result<u64> {
    let v = (amount as u128)
        .checked_mul(bps as u128)
        .ok_or(PoolError::MathOverflow)?
        / BPS_DENOM as u128;
    u64::try_from(v).map_err(|_| PoolError::MathOverflow.into())
}

/// (prize, seed, fee): prize and seed are floored shares of `total`, the fee takes the remainder.
pub fn split(total: u64, prize_bps: u16, seed_bps: u16) -> Result<(u64, u64, u64)> {
    let prize = bps_of(total, prize_bps)?;
    let seed = bps_of(total, seed_bps)?;
    let fee = total
        .checked_sub(prize)
        .and_then(|v| v.checked_sub(seed))
        .ok_or(PoolError::MathOverflow)?;
    Ok((prize, seed, fee))
}

impl Pool {
    /// Total ticket money ever paid in (price is immutable, so it is derivable).
    pub fn tickets_lamports(&self) -> Result<u64> {
        let v = (self.price_lamports as u128)
            .checked_mul(self.tickets_sold as u128)
            .ok_or(PoolError::MathOverflow)?;
        u64::try_from(v).map_err(|_| PoolError::MathOverflow.into())
    }

    /// Money the split is computed on: tickets + sponsorship.
    pub fn pot(&self) -> Result<u64> {
        self.tickets_lamports()?
            .checked_add(self.sponsored)
            .ok_or_else(|| PoolError::MathOverflow.into())
    }

    pub fn prize_share(&self) -> Result<u64> {
        Ok(split(self.pot()?, self.prize_bps, self.seed_bps)?.0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn split_is_exact() {
        let mut x: u64 = 0x9E3779B97F4A7C15;
        for _ in 0..1000 {
            x ^= x << 13;
            x ^= x >> 7;
            x ^= x << 17;
            let total = x % 10_000_000_000_000;
            let (p, s, f) = split(total, 6000, 2500).unwrap();
            assert_eq!(p + s + f, total);
            assert!(f <= total / 10_000 * 1500 + 2 * 10_000);
        }
    }

    #[test]
    fn bps_no_overflow_on_max() {
        assert_eq!(bps_of(u64::MAX, 10_000).unwrap(), u64::MAX);
    }
}
