use anchor_lang::prelude::*;
use anchor_spl::token::{transfer_checked, Mint, Token, TokenAccount, TransferChecked};

use crate::{
    constants::{ENROLLMENT_SEED, PROGRAMME_SEED, TRAINER_SEED, VAULT_SEED},
    error::PayDayError,
    state::{Enrollment, Programme, Trainer},
};

#[derive(Accounts)]
pub struct CheckIn<'info> {
    // The trainer signs, and their wallet pays the transaction fee.
    pub trainer: Signer<'info>,

    // The participant signs to confirm they were present. They need no SOL.
    pub trainee: Signer<'info>,

    // Rules and accounting. Mutable because total_paid and committed change.
    #[account(
        mut,
        seeds = [
            PROGRAMME_SEED,
            programme.organizer.as_ref(),
            programme.programme_id.to_le_bytes().as_ref()
        ],
        bump = programme.bump
    )]
    pub programme: Account<'info, Programme>,

    // Proof that the organizer registered this trainer for THIS programme.
    #[account(
        seeds = [
            TRAINER_SEED,
            programme.key().as_ref(),
            trainer.key().as_ref()
        ],
        bump = trainer_account.bump
    )]
    pub trainer_account: Account<'info, Trainer>,

    // The participant's promised amounts and attendance bits.
    #[account(
        mut,
        seeds = [
            ENROLLMENT_SEED,
            trainee.key().as_ref(),
            programme.key().as_ref()
        ],
        bump = enrollment.bump
    )]
    pub enrollment: Account<'info, Enrollment>,

    // The vault the money leaves from; its authority is the programme PDA.
    #[account(
        mut,
        seeds = [VAULT_SEED, programme.key().as_ref()],
        bump = programme.vault_bump,
        token::mint = mint,
        token::authority = programme
    )]
    pub vault: Account<'info, TokenAccount>,

    // Where the money goes: the participant's own token account for this mint.
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = trainee
    )]
    pub trainee_token_account: Account<'info, TokenAccount>,

    #[account(address = programme.mint)]
    pub mint: Account<'info, Mint>,

    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<CheckIn>, day: u8) -> Result<()> {
    // 1. The trainer and the participant must be two different wallets.
    require!(
        ctx.accounts.trainer.key() != ctx.accounts.trainee.key(),
        PayDayError::TrainerIsTrainee
    );

    let now = Clock::get()?.unix_timestamp;
    let programme = &mut ctx.accounts.programme;

    // 2. The programme must have started.
    require!(now >= programme.start_ts, PayDayError::NotStarted);

    // 3. The day must be inside the programme and equal to the current day by the clock.
    require!(day < programme.days, PayDayError::WrongDay);
    let elapsed = now
        .checked_sub(programme.start_ts)
        .ok_or(PayDayError::MathOverflow)?;
    let current_day = elapsed
        .checked_div(programme.day_len)
        .ok_or(PayDayError::MathOverflow)?;
    require!(i64::from(day) == current_day, PayDayError::WrongDay);

    // 4. Each day has one bit in attendance_mask; it must not be set yet.
    let bit = 1u32 << day;
    let enrollment = &mut ctx.accounts.enrollment;
    require!(
        (enrollment.attendance_mask & bit) == 0,
        PayDayError::AlreadyCheckedIn
    );

    // 5. The amount comes from the enrollment (promised earlier), never from the caller.
    let amount = enrollment
        .amounts
        .get(usize::from(day))
        .copied()
        .ok_or(PayDayError::WrongScheduleLength)?;

    // 6. Update the accounting BEFORE moving any money.
    enrollment.attendance_mask |= bit;
    enrollment.paid_total = enrollment
        .paid_total
        .checked_add(amount)
        .ok_or(PayDayError::MathOverflow)?;
    programme.total_paid = programme
        .total_paid
        .checked_add(amount)
        .ok_or(PayDayError::MathOverflow)?;
    programme.committed = programme
        .committed
        .checked_sub(amount)
        .ok_or(PayDayError::MathOverflow)?;

    // Copy the values the programme's signing seeds need.
    let organizer = programme.organizer;
    let programme_id = programme.programme_id.to_le_bytes();
    let bump = [programme.bump];

    // 7. Pay: the programme PDA signs for the vault. A zero amount only marks attendance.
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
            to: ctx.accounts.trainee_token_account.to_account_info(),
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
