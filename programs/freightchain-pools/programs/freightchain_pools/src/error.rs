use anchor_lang::prelude::*;

#[error_code]
pub enum PoolError {
    #[msg("The program is paused")]
    Paused,
    #[msg("Signer is not the authority")]
    Unauthorized,
    #[msg("Invalid pool parameters")]
    InvalidParams,
    #[msg("Prize, seed and fee shares must sum to 10000 bps")]
    BpsSum,
    #[msg("Ticket price is below the rent-exempt minimum")]
    PriceBelowRentMin,
    #[msg("A treasury account is not rent-exempt yet")]
    TreasuryNotRentExempt,
    #[msg("Pool is not open for tickets")]
    PoolNotOpen,
    #[msg("Not enough tickets left in the pool")]
    SoldOut,
    #[msg("Per-wallet ticket limit reached")]
    WalletCap,
    #[msg("Too late for this action")]
    TooLate,
    #[msg("Too early for this action")]
    TooEarly,
    #[msg("Pool cannot be failed (not Open, deadline not passed, or minimum reached)")]
    NotFailable,
    #[msg("Pool is not refunding")]
    NotRefunding,
    #[msg("Ticket was already refunded")]
    AlreadyRefunded,
    #[msg("Pool is not active")]
    PoolNotActive,
    #[msg("Pool is not settled")]
    NotSettled,
    #[msg("Prize payments would exceed the pool's prize share")]
    PrizeExceedsShare,
    #[msg("Transfer would leave an account below the rent-exempt minimum")]
    BelowRentMin,
    #[msg("Refunds are still pending")]
    RefundsPending,
    #[msg("Account does not match the recorded one")]
    AccountMismatch,
    #[msg("Arithmetic overflow")]
    MathOverflow,
    #[msg("Prizes were already paid from this pool")]
    PrizesAlreadyPaid,
    #[msg("No authority handover is pending")]
    NoPendingAuthority,
    #[msg("No prize was paid: an unsettled pool must be expired and refunded, not closed")]
    MustExpire,
    #[msg("This pool series is switched off")]
    SeriesDisabled,
    #[msg("Driver attestation is not verified")]
    UnverifiedAttestation,
    #[msg("Attestation account does not match pool or driver")]
    AttestationMismatch,
    #[msg("Attestation status is invalid")]
    InvalidAttestationStatus,
    #[msg("Attestation has zero verified distance")]
    ZeroVerifiedKm,
    #[msg("Pledge has already been settled")]
    AlreadySettled,
    #[msg("The pledge cannot be refunded yet: its pool is still running")]
    PledgeNotRefundable,
    #[msg("The driver has an attestation for this pool: settle the pledge instead")]
    AttestationExists,
}
