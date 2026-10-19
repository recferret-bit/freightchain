use anchor_lang::{
    prelude::*,
    system_program::{transfer, Transfer},
};

use crate::{constants::VAULT_SEED, error::PoolError};

pub fn rent_min() -> Result<u64> {
    Ok(Rent::get()?.minimum_balance(0))
}

/// Move lamports out of the vault (system account signed for by its PDA seeds).
/// The vault must keep >= rent_min or end at exactly 0 (the runtime rejects anything in between).
pub fn pay_from_vault<'info>(
    vault: &AccountInfo<'info>,
    to: &AccountInfo<'info>,
    system_program: &AccountInfo<'info>,
    pool_id: u32,
    vault_bump: u8,
    amount: u64,
) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }
    let left = vault
        .lamports()
        .checked_sub(amount)
        .ok_or(PoolError::BelowRentMin)?;
    require!(left == 0 || left >= rent_min()?, PoolError::BelowRentMin);
    raw_from_vault(vault, to, system_program, pool_id, vault_bump, amount)
}

/// Same transfer without the rent check: for a multi-leg sweep whose caller proves the vault ends at 0
/// (the runtime only checks rent state when the instruction ends, not between CPIs).
pub fn raw_from_vault<'info>(
    vault: &AccountInfo<'info>,
    to: &AccountInfo<'info>,
    system_program: &AccountInfo<'info>,
    pool_id: u32,
    vault_bump: u8,
    amount: u64,
) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }
    let id = pool_id.to_le_bytes();
    let seeds: &[&[u8]] = &[VAULT_SEED, &id, &[vault_bump]];
    transfer(
        CpiContext::new_with_signer(
            system_program.key(),
            Transfer { from: vault.clone(), to: to.clone() },
            &[seeds],
        ),
        amount,
    )
}
