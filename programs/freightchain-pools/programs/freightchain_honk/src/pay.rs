use anchor_lang::prelude::*;

use crate::error::HonkError;

/// Move lamports off a program account. A system transfer cannot debit an account that holds data.
/// What remains has to cover rent, so a swap cannot spend the account's rent.
pub fn pay_sol<'a>(from: &AccountInfo<'a>, to: &AccountInfo<'a>, amount: u64) -> Result<()> {
    let rent = Rent::get()?.minimum_balance(from.data_len());
    let left = from.lamports().checked_sub(amount).ok_or(HonkError::ZeroOut)?;
    require!(left >= rent, HonkError::ZeroOut);
    **from.try_borrow_mut_lamports()? = left;
    **to.try_borrow_mut_lamports()? = to
        .lamports()
        .checked_add(amount)
        .ok_or(HonkError::ZeroOut)?;
    Ok(())
}
