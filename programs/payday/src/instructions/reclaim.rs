use anchor_lang::prelude::*;
use anchor_spl::token::{transfer_checked, Mint, Token, TokenAccount, TransferChecked};

use crate::{
    constants::{PROGRAMME_SEED, VAULT_SEED},
    error::PayDayError,
    state::Programme,
};

#[derive(Accounts)]
pub struct Reclaim<'info> {
    // Only the organizer can take the leftovers back.
    pub organizer: Signer<'info>,

    #[account(
        mut,
        has_one = organizer @ PayDayError::Unauthorized,
        seeds = [
            PROGRAMME_SEED,
            organizer.key().as_ref(),
            programme.programme_id.to_le_bytes().as_ref()
        ],
        bump = programme.bump
    )]
    pub programme: Account<'info, Programme>,

    // The vault the money leaves from; its authority is the programme PDA.
    #[account(
        mut,
        seeds = [VAULT_SEED, programme.key().as_ref()],
        bump = programme.vault_bump,
        token::mint = mint,
        token::authority = programme
    )]
    pub vault: Account<'info, TokenAccount>,

    // Where the money goes: the organizer's own token account for this mint.
    #[account(
        mut,
        token::mint = mint,
        token::authority = organizer
    )]
    pub organizer_token_account: Account<'info, TokenAccount>,

    #[account(address = programme.mint)]
    pub mint: Account<'info, Mint>,

    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<Reclaim>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let programme = &mut ctx.accounts.programme;

    // 1. A programme can be reclaimed only once.
    require!(!programme.reclaimed, PayDayError::ProgrammeClosed);

    // 2. Only at or after the end time: end_ts = start_ts + days x day_len.
    let duration = i64::from(programme.days)
        .checked_mul(programme.day_len)
        .ok_or(PayDayError::MathOverflow)?;
    let end_ts = programme
        .start_ts
        .checked_add(duration)
        .ok_or(PayDayError::MathOverflow)?;
    require!(now >= end_ts, PayDayError::EventNotOver);

    // 3. Everything left in the vault goes back, including money promised to people who never came.
    let amount = ctx.accounts.vault.amount;

    // 4. Update the accounting BEFORE moving any money.
    programme.reclaimed = true;
    programme.total_reclaimed = programme
        .total_reclaimed
        .checked_add(amount)
        .ok_or(PayDayError::MathOverflow)?;
    programme.committed = 0;

    // Copy the values the programme's signing seeds need.
    let organizer = programme.organizer;
    let programme_id = programme.programme_id.to_le_bytes();
    let bump = [programme.bump];

    // 5. Pay: the programme PDA signs for the vault. An empty vault just closes the programme.
    if amount > 0 {
        let seeds: &[&[u8]] = &[
            PROGRAMME_SEED,
            organizer.as_ref(),
            programme_id.as_ref(),
            bump.as_ref(),
        ];
        let signer_seeds: &[&[&[u8]]] = &[seeds];

        let cpi_accounts = TransferChecked {
            from: ctx.accounts.vault.to_account_info(),
            to: ctx.accounts.organizer_token_account.to_account_info(),
            mint: ctx.accounts.mint.to_account_info(),
            authority: ctx.accounts.programme.to_account_info(),
        };
        let cpi_context = CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            cpi_accounts,
            signer_seeds,
        );
        transfer_checked(cpi_context, amount, ctx.accounts.mint.decimals)?;
    }

    Ok(())
}
