pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;
pub use state::*;

declare_id!("G9aiEGjhe5ya51k6mujpbzd1LkwadKMq9uPhEr97qXaM");

#[program]
pub mod payday {
    use super::*;

    pub fn create_programme(ctx: Context<CreateProgramme>,programme_id: u64, backend_key: Pubkey, start_ts: i64, day_len: i64, days: u8, max_participants: u16) -> Result<()>{
        create_programme::handler(ctx, programme_id, backend_key, start_ts, day_len, days, max_participants)
    }
    pub fn fund (ctx:Context<Fund>, programme_id : u64 ,amount: u64) -> Result<()> {
        fund::handler(ctx,programme_id, amount)
    }

    pub fn add_trainer(ctx:Context<AddTrainer>, programme_id : u64) -> Result<()> {
        add_trainer::handler(ctx)
    }

    pub fn enroll(ctx:Context<Enroll>, amounts: Vec<u64>) -> Result<()> {
        enroll::handler(ctx, amounts)
    }

    pub fn check_in(ctx: Context<CheckIn>, day: u8) -> Result<()> {
        check_in::handler(ctx, day)
    }

    pub fn reclaim(ctx: Context<Reclaim>) -> Result<()> {
        reclaim::handler(ctx)
    }

    /*pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        crate::instructions::initialize::handle_initialize(ctx)
    }

    pub fn increment(ctx: Context<Increment>) -> Result<()> {
        crate::instructions::increment::handle_increment(ctx)
    }*/
}
