use anchor_lang::prelude::*;

#[error_code]
pub enum PayDayError {
    // ---- create_programme ----
    #[msg("The number of days must be between 1 and 31.")]
    InvalidDays,

    #[msg("The day length must be at least 60 seconds.")]
    InvalidDayLength,

    #[msg("The programme start time cannot be in the past.")]
    StartInPast,

    #[msg("The maximum number of participants must be at least 1.")]
    InvalidCapacity,

    // ---- who is allowed to act ----
    #[msg("Only the organizer of this programme can perform this action.")]
    Unauthorized,

    #[msg("Only the backend key stored in this programme can enroll participants.")]
    InvalidBackend,

    // ---- arithmetic ----
    #[msg("An arithmetic overflow or underflow was prevented.")]
    MathOverflow,

    // ---- programme state ----
    #[msg("The programme is closed: its end time has passed or its remaining funds were already reclaimed.")]
    ProgrammeClosed,

    #[msg("The programme has reached its maximum number of participants.")]
    ProgrammeFull,

    // ---- fund / enroll ----
    #[msg("The amount must be greater than zero.")]
    ZeroAmount,

    #[msg("The number of daily amounts must equal the number of programme days.")]
    WrongScheduleLength,

    #[msg("The vault does not hold enough tokens to cover all promised payments.")]
    InsufficientFunding,

    // ---- check_in ----
    #[msg("A trainer cannot check themselves in: trainer and participant must be different wallets.")]
    TrainerIsTrainee,

    #[msg("The programme has not started yet.")]
    NotStarted,

    #[msg("The day given does not match the current programme day, or is outside the programme.")]
    WrongDay,

    #[msg("This participant has already been checked in and paid for this day.")]
    AlreadyCheckedIn,

    // ---- reclaim ----
    #[msg("Remaining funds can only be reclaimed after the programme's end time.")]
    EventNotOver,
}
