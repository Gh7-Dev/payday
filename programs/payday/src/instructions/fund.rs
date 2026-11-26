use anchor_lang::prelude::*;
use anchor_spl::{
    token::{Token, TokenAccount,Mint},
};
use anchor_spl::token::{transfer_checked, TransferChecked};
use crate::state::Programme;
use crate::constants::{PROGRAMME_SEED,VAULT_SEED};
use crate::error::PayDayError;


#[derive(Accounts)]
#[instruction(programme_id: u64)]
pub struct Fund<'info>{
    pub organizer :Signer<'info>,
    #[account(mut,
        has_one = organizer@ PayDayError::Unauthorized,
        seeds = [PROGRAMME_SEED,organizer.key().as_ref(),programme_id.to_le_bytes().as_ref()],
        bump = programme.bump,
    )]
    pub programme: Account<'info, Programme>,
    #[account(mut,
        token::authority = organizer,
        token::mint = mint
    )]
    pub organizer_token_account:Account<'info, TokenAccount>,
    #[account(
        mut,
        seeds = [VAULT_SEED ,programme.key().as_ref()],
        bump = programme.vault_bump,
        token::mint = mint,
        token::authority = programme
    )]
    pub vault: Account<'info, TokenAccount>,
    #[account(address = programme.mint)]
    pub mint:Account<'info, Mint>,
    pub token_program :Program<'info, Token>
}



pub fn handler (ctx: Context<Fund>, programme_id: u64, amount:u64) -> Result<()>{
    require!(amount > 0, PayDayError::ZeroAmount);
    require!(ctx.accounts.programme.reclaimed == false, PayDayError::ProgrammeClosed);
    let cpi_accounts = TransferChecked {
        from: ctx.accounts.organizer_token_account.to_account_info(),
        to: ctx.accounts.vault.to_account_info(),
        mint: ctx.accounts.mint.to_account_info(),
        authority: ctx.accounts.organizer.to_account_info()
    } ;
    let cpi_context = CpiContext::new(ctx.accounts.token_program.key(), cpi_accounts);

    transfer_checked(
        cpi_context,
        amount,
        ctx.accounts.mint.decimals
    )?;
    let new_total = ctx.accounts.programme.total_funded.checked_add(amount)
        .ok_or(PayDayError::MathOverflow)?;
    ctx.accounts.programme.total_funded = new_total;
    Ok(())

}