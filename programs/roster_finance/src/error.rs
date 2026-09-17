use anchor_lang::prelude::*;

#[error_code]
pub enum RosterError {
    #[msg("fee bps out of range")]
    FeeOutOfRange,
    #[msg("arithmetic overflow")]
    Overflow,
    #[msg("unauthorized")]
    Unauthorized,
    #[msg("quote mint must be the protocol quote mint")]
    WrongQuoteMint,
    #[msg("mint has fewer than six decimals")]
    TooFewDecimals,
    #[msg("market is not listed")]
    NotListed,
    #[msg("market or protocol is paused")]
    Paused,
    #[msg("expiry is not on the market grid")]
    ExpiryOffGrid,
    #[msg("strike is not on the market grid")]
    StrikeOffGrid,
    #[msg("live series cap reached for this market")]
    SeriesCapReached,
    #[msg("side and vault mints do not agree")]
    WrongVaultMint,
    #[msg("series has expired")]
    Expired,
    #[msg("series has not expired")]
    NotExpired,
    #[msg("series is halted by an issuer pause or freeze")]
    Halted,
    #[msg("size is outside the market limits")]
    SizeOutOfRange,
    #[msg("writer has no slot in this series")]
    NoWriterSlot,
    #[msg("no free writer slot in this series")]
    WriterSlotsFull,
    #[msg("writer cap reached")]
    WriterCapReached,
    #[msg("not enough free collateral")]
    InsufficientFreeCollateral,
    #[msg("ask is worse than every resident ask and the list is full")]
    AskRejected,
    #[msg("ask not found")]
    AskNotFound,
    #[msg("nothing could be filled at or below the limit")]
    QuoteMoved,
    #[msg("referrer is not a registered integrator")]
    IntegratorNotRegistered,
    #[msg("holder does not hold enough position tokens")]
    InsufficientPosition,
    #[msg("writer already settled")]
    AlreadySettled,
    #[msg("vaults are not empty")]
    VaultsNotEmpty,
    #[msg("not every writer has settled")]
    WritersUnsettled,
    #[msg("grace period has not elapsed")]
    GraceNotElapsed,
    #[msg("rent receiver must be the rent payer")]
    WrongRentReceiver,
    #[msg("account does not match the series")]
    WrongAccount,
    #[msg("wrong token program for this mint")]
    WrongTokenProgram,
    #[msg("price update is stale, unverified, or for the wrong feed")]
    BadPriceUpdate,
    #[msg("position is not in the money by more than the keeper fee")]
    NotInTheMoney,
    #[msg("auto-exercise is not enabled for this holder")]
    AutoExerciseDisabled,
    #[msg("outside the auto-exercise window")]
    OutsideWindow,
}
