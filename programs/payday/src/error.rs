use anchor_lang::prelude::*;

#[error_code]
pub enum PayDayError {
    #[msg("Enter a valid day")]
    InvalidDays,
    #[msg("Enter a day length between 1 to 31")]
    InvalidDayLength,    
    #[msg("Event cannot start in the past")]
    StartInPast,
    #[msg("Enter at least 1 participant")]
    InvalidCapacity,
    #[msg("Not Authorized to transact!" )]
    Unauthorized,
    #[msg("The transaction would cause an overflow in the account")]
    MathOverflow,
    #[msg("The Event is already closed")]
    ProgrammeClosed,
    #[msg("You cannot fund a zero amount")]
    ZeroAmount,


}
