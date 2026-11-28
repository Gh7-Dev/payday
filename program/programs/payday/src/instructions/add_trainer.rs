use anchor_lang::prelude::*;
use crate::{error::PayDayError, state::{Programme, Trainer}, constants::{PROGRAMME_SEED, TRAINER_SEED}};

#[derive(Accounts)]
#[instruction(programme_id: u64)]
pub struct AddTrainer<'info> {
    #[account(mut)]
    pub organizer: Signer<'info>,
    #[account(
        mut,
        has_one=organizer@PayDayError::Unauthorized,
        seeds = [PROGRAMME_SEED, organizer.key().as_ref(),programme_id.to_le_bytes().as_ref()],
        bump
    )]
    pub programme: Account<'info, Programme>,

    /// CHECK: Only the public key is used to identify the trainer.
    /// The trainer does not need to sign during registration.
    pub trainer_wallet: UncheckedAccount<'info>,
    #[account(init,
        payer = organizer,
        space = 8 + Trainer::INIT_SPACE,
        seeds = [TRAINER_SEED, programme.key().as_ref(), trainer_wallet.key().as_ref()],
        bump 
    )]
    pub trainer: Account<'info, Trainer>,
    pub system_program: Program<'info, System>
}

pub fn handler(ctx: Context<AddTrainer> )->Result<()>{
    require!(ctx.accounts.programme.reclaimed == false, PayDayError::ProgrammeClosed);
    let trainer = &mut ctx.accounts.trainer;
    trainer.trainer = ctx.accounts.trainer_wallet.key();
    trainer.programme =ctx.accounts.programme.key();
    trainer.bump = ctx.bumps.trainer;
    Ok(())
}
