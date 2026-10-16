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
    }
}
