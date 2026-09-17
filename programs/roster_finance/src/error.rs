use anchor_lang::prelude::*;

#[error_code]
pub enum RosterError {
    #[msg("fee bps out of range")]
    FeeOutOfRange,
    #[msg("arithmetic overflow")]
    Overflow,
}
