
use anchor_lang::prelude::*;

#[error_code]
pub enum PayDayError {
    #[msg("Enter a valid number of days")]
    InvalidDays,

    #[msg("Enter a day length between 1 and 31")]
    InvalidDayLength,

    #[msg("The programme cannot start in the past")]
    StartInPast,

    #[msg("Enter at least one participant")]
    InvalidCapacity,

    #[msg("You are not authorized to perform this operation")]
    Unauthorized,

    #[msg("Only the authorized backend can enroll trainees")]
    InvalidBackend,

    #[msg("The transaction would cause an arithmetic overflow")]
    MathOverflow,

    #[msg("The programme is already closed")]
    ProgrammeClosed,

    #[msg("The programme has ended and cannot accept new enrollments")]
    ProgrammeEnded,

    #[msg("The programme has reached its maximum participant capacity")]
    ProgrammeFull,

    #[msg("The funding amount cannot be zero")]
    ZeroAmount,

    #[msg("The payment schedule length must match the programme duration")]
    WrongScheduleLength,

    #[msg("The programme vault has insufficient funds for this commitment")]
    InsufficientFunding,
}
