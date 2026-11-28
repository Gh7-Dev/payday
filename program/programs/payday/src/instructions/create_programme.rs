use anchor_lang::prelude::*;
use anchor_spl::token::{TokenAccount,Mint,Token};
use crate::state::Programme;
use crate::constants::PROGRAMME_SEED;
use crate::constants::VAULT_SEED;
use crate::error::PayDayError;

#[derive(Accounts)]
#[instruction(programme_id: u64)]
pub struct CreateProgramme<'info>{
    #[account(mut)]
    pub organizer: Signer<'info>,

    #[account(init,
        payer = organizer,
        space = 8+ Programme::INIT_SPACE,
        seeds= [PROGRAMME_SEED,organizer.key().as_ref(),programme_id.to_le_bytes().as_ref()],
        bump)]
    pub programme: Account<'info, Programme>,
    
    #[account(init,
        payer = organizer,
        token::mint = mint,
        token::authority=programme,
        seeds = [VAULT_SEED ,programme.key().as_ref()],
        bump)]
    pub vault : Account<'info, TokenAccount>,

    pub mint : Account<'info, Mint>,    

    pub token_program: Program<'info, Token>,
    
    pub system_program: Program<'info, System>,
}


pub fn handler(ctx: Context<CreateProgramme>,programme_id: u64, backend_key: Pubkey, start_ts: i64, day_len: i64, days: u8, max_participants: u16) -> Result<()>{
    require!(start_ts >= Clock::get()?.unix_timestamp, PayDayError::StartInPast);
    require!(days > 0 && days <=31, PayDayError::InvalidDays);
    require!(max_participants > 0, PayDayError::InvalidCapacity);
    require!(day_len >= 60, PayDayError::InvalidDayLength);

   let programme =  &mut ctx.accounts.programme;
   programme.organizer =  ctx.accounts.organizer.key();
   programme.backend_key = backend_key;
   programme.mint = ctx.accounts.mint.key();
   programme.programme_id = programme_id;
   programme.start_ts = start_ts;
   programme.day_len = day_len;
   programme.days = days;
   programme.max_participants = max_participants;
   programme.enrolled = 0;
   programme.total_funded =0;
   programme.total_paid = 0;
   programme.total_reclaimed =0;
   programme.committed = 0;
   programme.bump = ctx.bumps.programme;
   programme.vault_bump = ctx.bumps.vault;
   programme.reclaimed = false;
    Ok(())

}