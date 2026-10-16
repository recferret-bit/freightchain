use anchor_lang::prelude::*;

use crate::{
    constants::*,
    error::HonkError,
};

/// Era of `emitted` ride TEN4. Era 0 is the first 27.5M. Each later era is half the previous one.
pub fn era_index(emitted: u64) -> u32 {
    if emitted >= EMISSION_CAP {
        return 63;
    }
    let mut start = 0u64;
    let mut size = ERA_SIZE;
    let mut era = 0u32;
    while size > 0 {
        let end = start.saturating_add(size);
        if emitted < end {
            return era;
        }
        start = end;
        size /= 2;
        era = era.saturating_add(1);
        if era >= 63 {
            return 63;
        }
    }
    era
}

/// TEN4 still inside the current era. Once the era size floors to zero, the rest of the cap is that era.
pub fn era_remaining(emitted: u64) -> u64 {
    if emitted >= EMISSION_CAP {
        return 0;
    }
    let mut start = 0u64;
    let mut size = ERA_SIZE;
    let mut era = 0u32;
    while size > 0 {
        let end = start.saturating_add(size);
        if emitted < end {
            return end - emitted;
        }
        start = end;
        size /= 2;
        era = era.saturating_add(1);
        if era >= 63 {
            break;
        }
    }
    EMISSION_CAP.saturating_sub(emitted)
}

pub fn global_daily_cap(era: u32) -> u64 {
    if era >= 63 {
        return 0;
    }
    DAILY_GLOBAL_ERA1 >> era
}

pub fn finish_units(tier: u8, era: u32) -> Result<u64> {
    let base = match tier {
        1 => 100 * UNIT,
        4 => 500 * UNIT,
        8 => 1_200 * UNIT,
        _ => return Err(HonkError::BadTier.into()),
    };
    Ok(if era >= 63 { 0 } else { base >> era })
}

/// `bands` is bit 0 = 20%, bit 1 = 50%, bit 2 = 100%. Shares are 15 / 25 / 60 of that era's finish.
pub fn quote_units(tier: u8, bands: u8, era: u32) -> Result<u64> {
    if bands == 0 || bands & !0b111 != 0 {
        return Err(HonkError::BadTier.into());
    }
    let full = finish_units(tier, era)?;
    let mut bps = 0u64;
    if bands & BAND_20 != 0 {
        bps += 1_500;
    }
    if bands & BAND_50 != 0 {
        bps += 2_500;
    }
    if bands & BAND_100 != 0 {
        bps += 6_000;
    }
    Ok(full.saturating_mul(bps) / 10_000)
}

/// The most this ride can pay. A zero room is the error of the room that closed it.
pub fn take_room(quote: u64, emitted: u64, day_emitted: u64, wallet_emitted: u64) -> Result<u64> {
    let era = era_index(emitted);
    let room_cap = EMISSION_CAP.saturating_sub(emitted);
    let room_era = era_remaining(emitted);
    let room_day = global_daily_cap(era).saturating_sub(day_emitted);
    let room_wallet = DAILY_WALLET.saturating_sub(wallet_emitted);
    if quote == 0 {
        return Err(HonkError::ZeroAmount.into());
    }
    if room_cap == 0 || room_era == 0 {
        return Err(HonkError::EmissionCap.into());
    }
    if room_day == 0 {
        return Err(HonkError::DailyCap.into());
    }
    if room_wallet == 0 {
        return Err(HonkError::WalletCap.into());
    }
    Ok(quote.min(room_cap).min(room_era).min(room_day).min(room_wallet))
}

/// Linear vest. `cliff_months` of nothing, then `linear_months` of even unlock. A 30-day month.
pub fn vested(total: u64, opened_at: i64, now: i64, cliff_months: u8, linear_months: u8) -> Result<u64> {
    if linear_months == 0 || total == 0 {
        return Ok(0);
    }
    let cliff = (cliff_months as i64)
        .checked_mul(MONTH_SECS)
        .ok_or(HonkError::ZeroOut)?;
    let cliff_end = opened_at.checked_add(cliff).ok_or(HonkError::ZeroOut)?;
    if now < cliff_end {
        return Ok(0);
    }
    let span = (linear_months as i64)
        .checked_mul(MONTH_SECS)
        .ok_or(HonkError::ZeroOut)?;
    let end = cliff_end.checked_add(span).ok_or(HonkError::ZeroOut)?;
    if now >= end {
        return Ok(total);
    }
    let elapsed = (now - cliff_end) as u128;
    let out = (total as u128)
        .checked_mul(elapsed)
        .ok_or(HonkError::ZeroOut)?
        / (span as u128);
    u64::try_from(out).map_err(|_| HonkError::ZeroOut.into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn eras_halve_the_finish() {
        assert_eq!(era_index(0), 0);
        assert_eq!(era_index(ERA_SIZE - 1), 0);
        assert_eq!(era_index(ERA_SIZE), 1);
        assert_eq!(era_index(ERA_SIZE + ERA_SIZE / 2), 2);
        assert_eq!(quote_units(1, BAND_20 | BAND_50 | BAND_100, 0).unwrap(), 100 * UNIT);
        assert_eq!(quote_units(4, 0b111, 0).unwrap(), 500 * UNIT);
        assert_eq!(quote_units(8, 0b111, 0).unwrap(), 1_200 * UNIT);
        assert_eq!(quote_units(8, 0b111, 1).unwrap(), 600 * UNIT);
        assert_eq!(quote_units(1, BAND_20, 0).unwrap(), 15 * UNIT);
        assert_eq!(quote_units(1, BAND_20 | BAND_50, 0).unwrap(), 40 * UNIT);
        assert_eq!(quote_units(8, BAND_20, 0).unwrap(), 180 * UNIT);
        assert_eq!(quote_units(8, BAND_20 | BAND_50, 0).unwrap(), 480 * UNIT);
        assert!(quote_units(2, 0b111, 0).is_err());
        assert!(quote_units(1, 0, 0).is_err());
        assert!(quote_units(1, 0b1000, 0).is_err());
    }

    #[test]
    fn daily_cap_halves_with_the_era_and_the_wallet_cap_does_not() {
        assert_eq!(global_daily_cap(0), DAILY_GLOBAL_ERA1);
        assert_eq!(global_daily_cap(1), DAILY_GLOBAL_ERA1 / 2);
        let quote = 1_200 * UNIT;
        assert_eq!(take_room(quote, 0, 0, 0).unwrap(), quote);
        assert_eq!(take_room(quote, 0, 0, DAILY_WALLET - 800 * UNIT).unwrap(), 800 * UNIT);
        assert!(take_room(quote, 0, DAILY_GLOBAL_ERA1, 0).is_err());
        assert!(take_room(quote, EMISSION_CAP, 0, 0).is_err());
    }

    #[test]
    fn treasury_is_linear_and_the_team_waits_out_the_cliff() {
        let opened = 1_000_000i64;
        assert_eq!(vested(TREASURY, opened, opened, 0, 36).unwrap(), 0);
        let half = opened + 18 * MONTH_SECS;
        assert_eq!(vested(TREASURY, opened, half, 0, 36).unwrap(), TREASURY / 2);
        assert_eq!(vested(TREASURY, opened, opened + 36 * MONTH_SECS, 0, 36).unwrap(), TREASURY);
        let cliff = opened + 12 * MONTH_SECS;
        assert_eq!(vested(TEAM, opened, cliff - 1, 12, 36).unwrap(), 0);
        assert_eq!(vested(TEAM, opened, cliff + 18 * MONTH_SECS, 12, 36).unwrap(), TEAM / 2);
        assert_eq!(vested(TEAM, opened, cliff + 36 * MONTH_SECS, 12, 36).unwrap(), TEAM);
        assert_eq!(vested(TEAM, opened, cliff + 12 * MONTH_SECS, 12, 24).unwrap(), TEAM / 2);
    }
}
