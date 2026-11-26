use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct Programme {
    pub organizer : Pubkey,
    pub backend_key : Pubkey,
    pub mint : Pubkey,
    pub programme_id : u64,
    pub start_ts : i64,
    pub day_len : i64,
    pub days : u8,
    pub max_participants : u16,
    pub enrolled :u16,
    pub total_funded : u64,
    pub total_paid : u64,
    pub total_reclaimed : u64,
    pub committed : u64,
    pub bump : u8,
    pub vault_bump : u8,
    pub reclaimed : bool,
}

#[account]
#[derive(InitSpace)]
pub struct Trainer {
    pub programme : Pubkey,
    pub trainer : Pubkey,
    pub bump : u8,
}