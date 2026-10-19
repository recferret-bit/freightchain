use anchor_lang::prelude::*;

#[error_code]
pub enum HonkError {
    #[msg("Amount is zero")]
    ZeroAmount,
    #[msg("Output is zero")]
    ZeroOut,
    #[msg("Too early")]
    TooEarly,
    #[msg("This part was already bought")]
    AlreadyBought,
    #[msg("Slippage")]
    Slippage,
    #[msg("Not for sale")]
    NotForSale,
    #[msg("Emission cap")]
    EmissionCap,
    #[msg("Daily cap")]
    DailyCap,
    #[msg("Wallet daily cap")]
    WalletCap,
    #[msg("Bad tier or bands")]
    BadTier,
    #[msg("Bad authority")]
    BadAuthority,
    #[msg("Bad vest")]
    BadVest,
    #[msg("Team allocation is off")]
    TeamDisabled,
    #[msg("Day index does not match the clock")]
    BadDay,
    #[msg("Month index does not match the clock")]
    BadMonth,
    #[msg("Bad merkle root or proof")]
    BadMerkleProof,
    #[msg("Airdrop claim window is closed")]
    AirdropClosed,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codes_stay_put() {
        assert_eq!(u32::from(HonkError::ZeroAmount), 6000);
        assert_eq!(u32::from(HonkError::ZeroOut), 6001);
        assert_eq!(u32::from(HonkError::TooEarly), 6002);
        assert_eq!(u32::from(HonkError::AlreadyBought), 6003);
        assert_eq!(u32::from(HonkError::Slippage), 6004);
        assert_eq!(u32::from(HonkError::NotForSale), 6005);
        assert_eq!(u32::from(HonkError::EmissionCap), 6006);
        assert_eq!(u32::from(HonkError::DailyCap), 6007);
        assert_eq!(u32::from(HonkError::WalletCap), 6008);
        assert_eq!(u32::from(HonkError::BadTier), 6009);
        assert_eq!(u32::from(HonkError::BadAuthority), 6010);
        assert_eq!(u32::from(HonkError::BadVest), 6011);
        assert_eq!(u32::from(HonkError::TeamDisabled), 6012);
        assert_eq!(u32::from(HonkError::BadDay), 6013);
        assert_eq!(u32::from(HonkError::BadMonth), 6014);
        assert_eq!(u32::from(HonkError::BadMerkleProof), 6015);
        assert_eq!(u32::from(HonkError::AirdropClosed), 6016);
    }
}
