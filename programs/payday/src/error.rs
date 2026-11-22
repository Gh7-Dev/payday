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


}
