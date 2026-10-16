use anchor_lang::prelude::*;

use crate::{constants::GENESIS, error::HonkError};

/// Floor of the square root. The first guess is a power of two above the root, so `x + n/x` stays in u128.
pub fn isqrt(n: u128) -> u128 {
    if n < 2 {
        return n;
    }
    let mut x = 1u128 << ((127 - n.leading_zeros()) / 2 + 1);
    loop {
        let y = (x + n / x) >> 1;
        if y >= x {
            return x;
        }
        x = y;
    }
}

pub fn lp_tokens(sol_in: u64) -> Result<u64> {
    let product = (GENESIS as u128)
        .checked_mul(sol_in as u128)
        .ok_or(HonkError::ZeroOut)?;
    let lp = u64::try_from(isqrt(product)).map_err(|_| HonkError::ZeroOut)?;
    require!(lp > 0, HonkError::ZeroOut);
    Ok(lp)
}

/// Constant product, zero fee, output rounded down so the pool keeps the dust.
/// `honk_reserve * sol_in / (sol_reserve + sol_in)`.
pub fn honk_out(honk_reserve: u64, sol_reserve: u64, sol_in: u64) -> Result<u64> {
    require!(sol_in > 0, HonkError::ZeroAmount);
    let denom = (sol_reserve as u128)
        .checked_add(sol_in as u128)
        .ok_or(HonkError::ZeroOut)?;
    let out = (honk_reserve as u128)
        .checked_mul(sol_in as u128)
        .ok_or(HonkError::ZeroOut)?
        .checked_div(denom)
        .ok_or(HonkError::ZeroOut)?;
    let out = u64::try_from(out).map_err(|_| HonkError::ZeroOut)?;
    require!(out > 0, HonkError::ZeroOut);
    Ok(out)
}

/// The other direction of `honk_out`: `sol_reserve * honk_in / (honk_reserve + honk_in)`.
pub fn sol_out(honk_reserve: u64, sol_reserve: u64, honk_in: u64) -> Result<u64> {
    require!(honk_in > 0, HonkError::ZeroAmount);
    let denom = (honk_reserve as u128)
        .checked_add(honk_in as u128)
        .ok_or(HonkError::ZeroOut)?;
    let out = (sol_reserve as u128)
        .checked_mul(honk_in as u128)
        .ok_or(HonkError::ZeroOut)?
        .checked_div(denom)
        .ok_or(HonkError::ZeroOut)?;
    let out = u64::try_from(out).map_err(|_| HonkError::ZeroOut)?;
    require!(out > 0, HonkError::ZeroOut);
    Ok(out)
}

/// Pro-rata share of one reserve. Rounded down. `lp_in == supply` returns the whole reserve.
pub fn take_share(reserve: u64, lp_in: u64, supply: u64) -> Result<u64> {
    require!(lp_in > 0, HonkError::ZeroAmount);
    require!(supply > 0 && lp_in <= supply, HonkError::ZeroOut);
    let out = (reserve as u128)
        .checked_mul(lp_in as u128)
        .ok_or(HonkError::ZeroOut)?
        / (supply as u128);
    u64::try_from(out).map_err(|_| HonkError::ZeroOut.into())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn is_floor(n: u128, r: u128) -> bool {
        let square_fits = match r.checked_mul(r) {
            Some(sq) => sq <= n,
            None => false,
        };
        let next_exceeds = match r.checked_add(1).and_then(|x| x.checked_mul(x)) {
            Some(sq) => sq > n,
            None => true,
        };
        square_fits && next_exceeds
    }

    #[test]
    fn isqrt_is_the_floor() {
        for n in [0u128, 1, 2, 3, 4, 10, 99, 100, 101] {
            assert!(is_floor(n, isqrt(n)), "n={n}");
        }
        let genesis = (GENESIS as u128) * 10_000_000_000;
        assert!(is_floor(genesis, isqrt(genesis)));
        assert!(is_floor(u128::MAX, isqrt(u128::MAX)));
    }
}
