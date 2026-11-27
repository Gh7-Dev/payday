
use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{Mint, Token, TokenAccount},
};

use crate::{
    constants::{ENROLLMENT_SEED, PROGRAMME_SEED, VAULT_SEED},
    error::PayDayError,
    state::{Enrollment, Programme},
};

#[derive(Accounts)]
#[instruction(amounts: Vec<u64>)]
pub struct Enroll<'info> {
    // Backend signs and pays rent for the new accounts.
    #[account(mut)]
    pub backend: Signer<'info>,

    #[account(
        mut,
        constraint = programme.backend_key == backend.key()
            @ PayDayError::InvalidBackend,
        seeds = [
            PROGRAMME_SEED,
            programme.organizer.as_ref(),
            programme.programme_id.to_le_bytes().as_ref()
        ],
        bump = programme.bump
    )]
    pub programme: Account<'info, Programme>,

    /// CHECK: Only the public key is used to identify the trainee.
    /// The trainee does not need to sign enrollment.
    pub trainee: UncheckedAccount<'info>,

    #[account(
        init,
        payer = backend,
        space = 89 + amounts.len() * 8,
        seeds = [
            ENROLLMENT_SEED,
            trainee.key().as_ref(),
            programme.key().as_ref()
        ],
        bump
    )]
    pub enrollment: Account<'info, Enrollment>,

    #[account(
        init_if_needed,
        payer = backend,
        associated_token::mint = mint,
        associated_token::authority = trainee
    )]
    pub trainee_token_account: Account<'info, TokenAccount>,

    #[account(address = programme.mint)]
    pub mint: Account<'info, Mint>,

    #[account(

        seeds = [VAULT_SEED, programme.key().as_ref()],
        bump = programme.vault_bump,
        token::mint = mint,
        token::authority = programme
    )]
    pub vault: Account<'info, TokenAccount>,

    pub associated_token_program: Program<'info, AssociatedToken>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<Enroll>, amounts: Vec<u64>,) -> Result<()> {
    let programme = &mut ctx.accounts.programme;

    // 1. Check programme status.
    require!(
        !programme.reclaimed,
        PayDayError::ProgrammeClosed
    );

    let now = Clock::get()?.unix_timestamp;

    let duration = i64::from(programme.days)
        .checked_mul(programme.day_len)
        .ok_or(PayDayError::MathOverflow)?;

    let end_ts = programme.start_ts
        .checked_add(duration)
        .ok_or(PayDayError::MathOverflow)?;

    require!(
        now < end_ts,
        PayDayError::ProgrammeEnded
    );

    // 2. Check participant capacity.
    require!(
        programme.enrolled < programme.max_participants,
        PayDayError::ProgrammeFull
    );

    // 3. Validate payment schedule length.
    require!(
        amounts.len() == usize::from(programme.days),
        PayDayError::WrongScheduleLength
    );

    // 4. Calculate total promised payment.
    let total = amounts.iter().try_fold(
        0u64,
        |sum, amount| {
            sum.checked_add(*amount)
                .ok_or(PayDayError::MathOverflow)
        }
    )?;

    // 5. Ensure vault can cover existing and new commitments.
    let required = programme.committed
        .checked_add(total)
        .ok_or(PayDayError::MathOverflow)?;

    require!(
        ctx.accounts.vault.amount >= required,
        PayDayError::InsufficientFunding
    );

    // 6. Initialize Enrollment.
    let enrollment = &mut ctx.accounts.enrollment;

    enrollment.programme = programme.key();
    enrollment.trainee = ctx.accounts.trainee.key();
    enrollment.attendance_mask = 0;
    enrollment.paid_total = 0;
    enrollment.amounts = amounts;
    enrollment.bump = ctx.bumps.enrollment;

    // 7. Update Programme accounting.
    programme.committed = required;

    programme.enrolled = programme.enrolled
        .checked_add(1)
        .ok_or(PayDayError::MathOverflow)?;

    Ok(())
}
