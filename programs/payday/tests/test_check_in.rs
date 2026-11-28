// Tests for check_in.
// What these tests prove, in plain words:
//  - OPEN TEST 1: a participant who never held any SOL can sign and be paid (the trainer pays the fee)
//  - a check-in moves exactly the promised amount for that day, once, and updates the accounting
//  - both the trainer and the participant must sign
//  - only a trainer registered for THIS programme counts, and never for themselves
//  - the day must match the clock; before the start and after the end nothing is paid
//  - nobody can redirect the payment to another enrollment or another token account
// Not covered yet: check-in after reclaim (it cannot happen: reclaim needs the end time to have passed).
use {
    anchor_lang::{
        prelude::{Clock, Pubkey},
        solana_program::{instruction::Instruction, system_program},
        AccountDeserialize, InstructionData, ToAccountMetas,
    },
    litesvm::LiteSVM,
    litesvm_token::{CreateAssociatedTokenAccount, CreateMint, MintTo},
    payday::constants::{ENROLLMENT_SEED, PROGRAMME_SEED, TRAINER_SEED, VAULT_SEED},
    payday::state::{Enrollment, Programme},
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
};

const START_TIME: i64 = 1_800_000_000; // chain clock at setup
const START_TS: i64 = START_TIME + 3600; // programme start
const DAY_LEN: i64 = 86_400;
const DAYS: usize = 5;
const END_TS: i64 = START_TS + (DAYS as i64) * DAY_LEN;
const FUNDED: u64 = 100_000_000; // 100 tokens at 6 decimals
const TOTAL: u64 = 50_000_000; // 5 days x 10 tokens
const PROGRAMME_ID: u64 = 1;

// ---------- helpers ----------

fn set_time(svm: &mut LiteSVM, ts: i64) {
    let mut clock = svm.get_sysvar::<Clock>();
    clock.unix_timestamp = ts;
    svm.set_sysvar(&clock);
}

// A moment inside day `day` (0-based) of the programme.
fn day_time(day: i64) -> i64 {
    START_TS + day * DAY_LEN + 10
}

fn setup() -> (LiteSVM, Keypair, Pubkey) {
    let mut svm = LiteSVM::new();
    let bytes = include_bytes!(concat!(
        env!("CARGO_TARGET_TMPDIR"),
        "/../deploy/payday.so"
    ));
    svm.add_program(payday::id(), bytes).unwrap();
    let payer = Keypair::new();
    svm.airdrop(&payer.pubkey(), 10_000_000_000).unwrap();
    let mint = CreateMint::new(&mut svm, &payer).decimals(6).send().unwrap();
    set_time(&mut svm, START_TIME);
    (svm, payer, mint)
}

fn programme_pda(organizer: &Pubkey, id: u64) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[PROGRAMME_SEED, organizer.as_ref(), &id.to_le_bytes()],
        &payday::id(),
    )
}

fn vault_pda(programme: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[VAULT_SEED, programme.as_ref()], &payday::id())
}

fn trainer_pda(programme: &Pubkey, wallet: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[TRAINER_SEED, programme.as_ref(), wallet.as_ref()],
        &payday::id(),
    )
}

fn enrollment_pda(trainee: &Pubkey, programme: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[ENROLLMENT_SEED, trainee.as_ref(), programme.as_ref()],
        &payday::id(),
    )
}

fn ata(wallet: &Pubkey, mint: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(
        &[wallet.as_ref(), anchor_spl::token::ID.as_ref(), mint.as_ref()],
        &anchor_spl::associated_token::ID,
    )
    .0
}

// Sends one instruction. `fee_payer` signs first; `others` are extra signers (0 or 1).
fn send2(
    svm: &mut LiteSVM,
    ix: Instruction,
    fee_payer: &Keypair,
    others: &[&Keypair],
) -> Result<Vec<String>, Vec<String>> {
    svm.expire_blockhash();
    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&fee_payer.pubkey()), &blockhash);
    let tx = match others.len() {
        0 => VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[fee_payer]).unwrap(),
        1 => VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[fee_payer, others[0]]).unwrap(),
        _ => panic!("send2 supports at most one extra signer"),
    };
    match svm.send_transaction(tx) {
        Ok(meta) => Ok(meta.logs),
        Err(failed) => Err(failed.meta.logs),
    }
}

fn send(svm: &mut LiteSVM, ix: Instruction, fee_payer: &Keypair) -> Result<Vec<String>, Vec<String>> {
    send2(svm, ix, fee_payer, &[])
}

fn has(logs: &[String], needle: &str) -> bool {
    logs.iter().any(|l| l.contains(needle))
}

// Passes if the send failed AND one of the named Anchor errors appears in the logs.
fn assert_rejected(res: &Result<Vec<String>, Vec<String>>, names: &[&str], label: &str) {
    let logs = match res {
        Ok(_) => panic!("{label}: expected a rejection but the call succeeded"),
        Err(l) => l,
    };
    for n in names {
        if has(logs, &format!("Error Code: {n}")) {
            println!("FIRED {label}: {n}");
            return;
        }
    }
    panic!("{label}: rejected, but not by any of {names:?}. Logs:\n{}", logs.join("\n"));
}

fn create_ok(svm: &mut LiteSVM, organizer: &Keypair, mint: &Pubkey, backend: &Pubkey, id: u64, max: u16) -> (Pubkey, Pubkey) {
    let (programme, _) = programme_pda(&organizer.pubkey(), id);
    let (vault, _) = vault_pda(&programme);
    let ix = Instruction::new_with_bytes(
        payday::id(),
        &payday::instruction::CreateProgramme {
            programme_id: id,
            backend_key: *backend,
            start_ts: START_TS,
            day_len: DAY_LEN,
            days: DAYS as u8,
            max_participants: max,
        }
        .data(),
        payday::accounts::CreateProgramme {
            organizer: organizer.pubkey(),
            programme,
            vault,
            mint: *mint,
            token_program: anchor_spl::token::ID,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    send(svm, ix, organizer).expect("create_programme must succeed in setup");
    (programme, vault)
}

fn fund_ix(organizer: &Pubkey, programme: &Pubkey, org_ta: &Pubkey, vault: &Pubkey, mint: &Pubkey, amount: u64) -> Instruction {
    Instruction::new_with_bytes(
        payday::id(),
        &payday::instruction::Fund { programme_id: PROGRAMME_ID, amount }.data(),
        payday::accounts::Fund {
            organizer: *organizer,
            programme: *programme,
            organizer_token_account: *org_ta,
            vault: *vault,
            mint: *mint,
            token_program: anchor_spl::token::ID,
        }
        .to_account_metas(None),
    )
}

fn add_trainer_ix(organizer: &Pubkey, programme: &Pubkey, wallet: &Pubkey, programme_id: u64) -> Instruction {
    let (trainer, _) = trainer_pda(programme, wallet);
    Instruction::new_with_bytes(
        payday::id(),
        &payday::instruction::AddTrainer { programme_id }.data(),
        payday::accounts::AddTrainer {
            organizer: *organizer,
            programme: *programme,
            trainer_wallet: *wallet,
            trainer,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    )
}

fn enroll_ix(backend: &Pubkey, programme: &Pubkey, trainee: &Pubkey, mint: &Pubkey, vault: &Pubkey, amounts: Vec<u64>) -> Instruction {
    let (enrollment, _) = enrollment_pda(trainee, programme);
    Instruction::new_with_bytes(
        payday::id(),
        &payday::instruction::Enroll { amounts }.data(),
        payday::accounts::Enroll {
            backend: *backend,
            programme: *programme,
            trainee: *trainee,
            enrollment,
            trainee_token_account: ata(trainee, mint),
            mint: *mint,
            vault: *vault,
            associated_token_program: anchor_spl::associated_token::ID,
            token_program: anchor_spl::token::ID,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    )
}

// ONLY place that knows the check_in account list and arguments.
fn check_in_ix(
    trainer: &Pubkey,
    trainee: &Pubkey,
    programme: &Pubkey,
    vault: &Pubkey,
    mint: &Pubkey,
    trainer_account: &Pubkey,
    enrollment: &Pubkey,
    trainee_ta: &Pubkey,
    day: u8,
) -> Instruction {
    Instruction::new_with_bytes(
        payday::id(),
        &payday::instruction::CheckIn { day }.data(),
        payday::accounts::CheckIn {
            trainer: *trainer,
            trainee: *trainee,
            programme: *programme,
            trainer_account: *trainer_account,
            enrollment: *enrollment,
            vault: *vault,
            trainee_token_account: *trainee_ta,
            mint: *mint,
            token_program: anchor_spl::token::ID,
        }
        .to_account_metas(None),
    )
}

fn tok_balance(svm: &LiteSVM, ta: &Pubkey) -> u64 {
    let acc = svm.get_account(ta).expect("token account must exist");
    u64::from_le_bytes(acc.data[64..72].try_into().unwrap())
}

fn read_programme(svm: &LiteSVM, programme: &Pubkey) -> Programme {
    let acc = svm.get_account(programme).expect("programme must exist");
    let mut data: &[u8] = &acc.data;
    Programme::try_deserialize(&mut data).unwrap()
}

fn read_enrollment(svm: &LiteSVM, pda: &Pubkey) -> Enrollment {
    let acc = svm.get_account(pda).expect("enrollment must exist");
    let mut data: &[u8] = &acc.data;
    Enrollment::try_deserialize(&mut data).unwrap()
}

struct World {
    svm: LiteSVM,
    organizer: Keypair,
    backend: Keypair,
    mint: Pubkey,
    programme: Pubkey,
    vault: Pubkey,
    trainer: Keypair, // registered trainer, has SOL for fees
    trainee: Keypair, // enrolled participant, NEVER funded with SOL
}

fn schedule(per_day: u64) -> Vec<u64> {
    vec![per_day; DAYS]
}

// Programme created and funded with FUNDED, one trainer registered, one trainee enrolled.
fn world(amounts: Vec<u64>) -> World {
    let (mut svm, organizer, mint) = setup();
    let backend = Keypair::new();
    svm.airdrop(&backend.pubkey(), 2_000_000_000).unwrap();
    let (programme, vault) = create_ok(&mut svm, &organizer, &mint, &backend.pubkey(), PROGRAMME_ID, 5);

    let org_ta = CreateAssociatedTokenAccount::new(&mut svm, &organizer, &mint)
        .owner(&organizer.pubkey())
        .send()
        .unwrap();
    MintTo::new(&mut svm, &organizer, &mint, &org_ta, FUNDED).send().unwrap();
    send(&mut svm, fund_ix(&organizer.pubkey(), &programme, &org_ta, &vault, &mint, FUNDED), &organizer)
        .expect("fund must succeed in setup");

    let trainer = Keypair::new();
    svm.airdrop(&trainer.pubkey(), 1_000_000_000).unwrap();
    send(&mut svm, add_trainer_ix(&organizer.pubkey(), &programme, &trainer.pubkey(), PROGRAMME_ID), &organizer)
        .expect("add_trainer must succeed in setup");

    let trainee = Keypair::new();
    send(&mut svm, enroll_ix(&backend.pubkey(), &programme, &trainee.pubkey(), &mint, &vault, amounts), &backend)
        .expect("enroll must succeed in setup");

    World { svm, organizer, backend, mint, programme, vault, trainer, trainee }
}

// Enrolls one more participant (signed by the backend); returns their wallet.
fn enroll_other(w: &mut World, amounts: Vec<u64>) -> Pubkey {
    let other = Keypair::new().pubkey();
    let ix = enroll_ix(&w.backend.pubkey(), &w.programme, &other, &w.mint, &w.vault, amounts);
    send(&mut w.svm, ix, &w.backend).expect("second enroll must succeed");
    other
}

// The normal check-in instruction for the world's trainer and trainee.
fn standard_ix(w: &World, day: u8) -> Instruction {
    check_in_ix(
        &w.trainer.pubkey(),
        &w.trainee.pubkey(),
        &w.programme,
        &w.vault,
        &w.mint,
        &trainer_pda(&w.programme, &w.trainer.pubkey()).0,
        &enrollment_pda(&w.trainee.pubkey(), &w.programme).0,
        &ata(&w.trainee.pubkey(), &w.mint),
        day,
    )
}

// Trainer pays the fee and signs; trainee signs too.
fn go(w: &mut World, day: u8) -> Result<Vec<String>, Vec<String>> {
    let ix = standard_ix(w, day);
    send2(&mut w.svm, ix, &w.trainer, &[&w.trainee])
}

fn trainee_balance(w: &World) -> u64 {
    tok_balance(&w.svm, &ata(&w.trainee.pubkey(), &w.mint))
}

fn enrollment_of(w: &World) -> Enrollment {
    read_enrollment(&w.svm, &enrollment_pda(&w.trainee.pubkey(), &w.programme).0)
}

fn assert_nothing_paid(w: &World, total_promised: u64) {
    assert_eq!(trainee_balance(w), 0, "trainee must not be paid");
    assert_eq!(tok_balance(&w.svm, &w.vault), FUNDED, "vault must be unchanged");
    let e = enrollment_of(w);
    assert_eq!(e.attendance_mask, 0, "no attendance bit may be set");
    assert_eq!(e.paid_total, 0);
    let p = read_programme(&w.svm, &w.programme);
    assert_eq!(p.total_paid, 0);
    assert_eq!(p.committed, total_promised);
}

// ---------- tests ----------

#[test]
fn check_in_pays_a_never_funded_participant_open_test_1() {
    let mut w = world(schedule(10_000_000));
    let trainee_wallet = w.trainee.pubkey();
    assert_eq!(w.svm.get_balance(&trainee_wallet).unwrap_or(0), 0, "trainee starts with no SOL");
    let before = w.svm.get_balance(&w.trainer.pubkey()).unwrap();

    set_time(&mut w.svm, day_time(0));
    go(&mut w, 0).expect("check_in must succeed for a never-funded participant");

    assert_eq!(trainee_balance(&w), 10_000_000, "trainee receives day 0 amount");
    assert_eq!(tok_balance(&w.svm, &w.vault), FUNDED - 10_000_000);
    let e = enrollment_of(&w);
    assert_eq!(e.attendance_mask, 0b1);
    assert_eq!(e.paid_total, 10_000_000);
    let p = read_programme(&w.svm, &w.programme);
    assert_eq!(p.total_paid, 10_000_000);
    assert_eq!(p.committed, TOTAL - 10_000_000);
    assert_eq!(p.total_funded, FUNDED);
    assert_eq!(w.svm.get_balance(&trainee_wallet).unwrap_or(0), 0, "trainee still holds no SOL");
    let after = w.svm.get_balance(&w.trainer.pubkey()).unwrap();
    assert!(after <= before);
    println!("trainer fee paid: {} lamports", before - after);
    // WHAT THIS PROVES (OPEN TEST 1): a participant with no SOL and no wallet history can sign a
    // check-in and be paid, because the trainer's wallet pays the fee. The vault loses exactly the
    // day's amount, the participant gains it, one attendance bit is set, and the totals add up.
}

#[test]
fn check_in_two_days_and_absentee_money_stays_committed() {
    let mut w = world(schedule(10_000_000));
    set_time(&mut w.svm, day_time(0));
    go(&mut w, 0).expect("day 0");
    set_time(&mut w.svm, day_time(1));
    go(&mut w, 1).expect("day 1");

    assert_eq!(trainee_balance(&w), 20_000_000);
    assert_eq!(enrollment_of(&w).attendance_mask, 0b11);
    assert_eq!(enrollment_of(&w).paid_total, 20_000_000);
    let p = read_programme(&w.svm, &w.programme);
    assert_eq!(p.total_paid, 20_000_000);
    assert_eq!(p.committed, 30_000_000, "money for days not attended stays committed");
    assert_eq!(tok_balance(&w.svm, &w.vault), FUNDED - 20_000_000);
    // WHAT THIS PROVES: each attended day pays once and sets its own bit. The money promised for days
    // not attended stays in the vault and stays "committed" until reclaim returns it.
}

#[test]
fn check_in_same_day_twice_rejected() {
    let mut w = world(schedule(10_000_000));
    set_time(&mut w.svm, day_time(0));
    go(&mut w, 0).expect("first check-in");
    let res = go(&mut w, 0);
    assert_rejected(&res, &["AlreadyCheckedIn"], "same day twice");
    assert_eq!(trainee_balance(&w), 10_000_000, "paid only once");
    assert_eq!(tok_balance(&w.svm, &w.vault), FUNDED - 10_000_000);
    assert_eq!(enrollment_of(&w).paid_total, 10_000_000);
    // WHAT THIS PROVES: a day can be paid only once. The attendance bit blocks a second payment.
}

#[test]
fn check_in_wrong_day_rejected() {
    let mut w = world(schedule(10_000_000));
    set_time(&mut w.svm, day_time(0));
    for bad in [1u8, 5u8, 255u8] {
        let res = go(&mut w, bad);
        assert_rejected(&res, &["WrongDay"], &format!("day {bad} during day 0"));
    }
    set_time(&mut w.svm, day_time(1));
    let res = go(&mut w, 0);
    assert_rejected(&res, &["WrongDay"], "past day 0 during day 1");
    assert_nothing_paid(&w, TOTAL);
    // WHAT THIS PROVES: you can only be checked in for the day the clock says it is. Future days,
    // past days and days outside the programme (even a huge number) are refused and nothing moves.
}

#[test]
fn check_in_before_start_rejected() {
    let mut w = world(schedule(10_000_000));
    let res = go(&mut w, 0); // the clock is still at setup time, before the start
    assert_rejected(&res, &["NotStarted"], "at setup time");
    set_time(&mut w.svm, START_TS - 1);
    let res = go(&mut w, 0);
    assert_rejected(&res, &["NotStarted"], "one second before start");
    assert_nothing_paid(&w, TOTAL);
    // WHAT THIS PROVES: nobody can be paid before the programme starts, not even one second early.
}

#[test]
fn check_in_last_second_ok_then_after_end_rejected() {
    let mut w = world(schedule(10_000_000));
    set_time(&mut w.svm, END_TS - 1);
    go(&mut w, 4).expect("the last second of the last day must work");
    assert_eq!(trainee_balance(&w), 10_000_000);
    set_time(&mut w.svm, END_TS);
    let res = go(&mut w, 4);
    assert_rejected(&res, &["WrongDay"], "day 4 after the end");
    let res = go(&mut w, 5);
    assert_rejected(&res, &["WrongDay"], "day 5 after the end");
    assert_eq!(trainee_balance(&w), 10_000_000, "nothing more is paid");
    // WHAT THIS PROVES: check-in works up to the very last second of the programme and is refused from
    // the end time on, so check-in and reclaim can never overlap.
}

#[test]
fn check_in_zero_amount_day_marks_attendance_only() {
    let mut w = world(vec![10_000_000, 0, 10_000_000, 10_000_000, 10_000_000]);
    set_time(&mut w.svm, day_time(1));
    go(&mut w, 1).expect("a zero-amount day must still succeed");
    assert_eq!(trainee_balance(&w), 0);
    assert_eq!(tok_balance(&w.svm, &w.vault), FUNDED);
    let e = enrollment_of(&w);
    assert_eq!(e.attendance_mask, 0b10);
    assert_eq!(e.paid_total, 0);
    let p = read_programme(&w.svm, &w.programme);
    assert_eq!((p.total_paid, p.committed), (0, 40_000_000));
    let res = go(&mut w, 1);
    assert_rejected(&res, &["AlreadyCheckedIn"], "zero-amount day twice");
    // WHAT THIS PROVES: a day promised at 0 tokens records attendance without any transfer, and that
    // day also cannot be checked in twice.
}

#[test]
fn check_in_needs_both_signatures() {
    let mut w = world(schedule(10_000_000));
    set_time(&mut w.svm, day_time(0));

    // The participant does not sign.
    let mut ix = standard_ix(&w, 0);
    for m in ix.accounts.iter_mut() {
        if m.pubkey == w.trainee.pubkey() {
            m.is_signer = false;
        }
    }
    let res = send2(&mut w.svm, ix, &w.trainer, &[]);
    assert_rejected(&res, &["AccountNotSigner"], "trainee not signing");

    // The trainer does not sign (the backend pays the fee instead).
    let mut ix = standard_ix(&w, 0);
    for m in ix.accounts.iter_mut() {
        if m.pubkey == w.trainer.pubkey() {
            m.is_signer = false;
        }
    }
    let res = send2(&mut w.svm, ix, &w.backend, &[&w.trainee]);
    assert_rejected(&res, &["AccountNotSigner"], "trainer not signing");

    assert_nothing_paid(&w, TOTAL);
    // WHAT THIS PROVES: payment needs two signatures. Without the participant nobody can claim they
    // were there; without the trainer the participant could pay themselves.
}

#[test]
fn check_in_trainer_cannot_check_in_themselves() {
    let mut w = world(schedule(10_000_000));
    let k = Keypair::new();
    w.svm.airdrop(&k.pubkey(), 1_000_000_000).unwrap();
    send(&mut w.svm, add_trainer_ix(&w.organizer.pubkey(), &w.programme, &k.pubkey(), PROGRAMME_ID), &w.organizer)
        .expect("register k as trainer");
    send(&mut w.svm, enroll_ix(&w.backend.pubkey(), &w.programme, &k.pubkey(), &w.mint, &w.vault, schedule(10_000_000)), &w.backend)
        .expect("enroll k as participant");
    set_time(&mut w.svm, day_time(0));
    let ix = check_in_ix(
        &k.pubkey(),
        &k.pubkey(),
        &w.programme,
        &w.vault,
        &w.mint,
        &trainer_pda(&w.programme, &k.pubkey()).0,
        &enrollment_pda(&k.pubkey(), &w.programme).0,
        &ata(&k.pubkey(), &w.mint),
        0,
    );
    let res = send2(&mut w.svm, ix, &k, &[]);
    assert_rejected(&res, &["TrainerIsTrainee"], "self check-in");
    assert_eq!(tok_balance(&w.svm, &ata(&k.pubkey(), &w.mint)), 0, "k was not paid");
    // WHAT THIS PROVES: even a wallet that is both a registered trainer and an enrolled participant
    // cannot sign both roles to pay itself.
}

#[test]
fn check_in_unregistered_trainer_rejected() {
    let mut w = world(schedule(10_000_000));
    let stranger = Keypair::new();
    w.svm.airdrop(&stranger.pubkey(), 1_000_000_000).unwrap();
    set_time(&mut w.svm, day_time(0));
    let ix = check_in_ix(
        &stranger.pubkey(),
        &w.trainee.pubkey(),
        &w.programme,
        &w.vault,
        &w.mint,
        &trainer_pda(&w.programme, &stranger.pubkey()).0,
        &enrollment_pda(&w.trainee.pubkey(), &w.programme).0,
        &ata(&w.trainee.pubkey(), &w.mint),
        0,
    );
    let res = send2(&mut w.svm, ix, &stranger, &[&w.trainee]);
    assert_rejected(&res, &["AccountNotInitialized", "ConstraintSeeds"], "unregistered trainer");
    assert_nothing_paid(&w, TOTAL);
    // WHAT THIS PROVES: a wallet the organizer never registered as a trainer cannot check anyone in.
}

#[test]
fn check_in_trainer_of_another_programme_rejected() {
    let mut w = world(schedule(10_000_000));
    let stranger = Keypair::new();
    w.svm.airdrop(&stranger.pubkey(), 1_000_000_000).unwrap();
    let (p2, _v2) = create_ok(&mut w.svm, &w.organizer, &w.mint, &w.backend.pubkey(), 2, 5);
    send(&mut w.svm, add_trainer_ix(&w.organizer.pubkey(), &p2, &stranger.pubkey(), 2), &w.organizer)
        .expect("register stranger in programme 2");
    set_time(&mut w.svm, day_time(0));
    // Programme 1 is used, but the Trainer record of programme 2 is passed in.
    let ix = check_in_ix(
        &stranger.pubkey(),
        &w.trainee.pubkey(),
        &w.programme,
        &w.vault,
        &w.mint,
        &trainer_pda(&p2, &stranger.pubkey()).0,
        &enrollment_pda(&w.trainee.pubkey(), &w.programme).0,
        &ata(&w.trainee.pubkey(), &w.mint),
        0,
    );
    let res = send2(&mut w.svm, ix, &stranger, &[&w.trainee]);
    assert_rejected(&res, &["ConstraintSeeds"], "trainer of another programme");
    assert_nothing_paid(&w, TOTAL);
    // WHAT THIS PROVES: being a trainer in one programme gives no power in another: the Trainer
    // record must belong to the programme being used.
}

#[test]
fn check_in_unenrolled_participant_rejected() {
    let mut w = world(schedule(10_000_000));
    let other = Keypair::new(); // never enrolled
    set_time(&mut w.svm, day_time(0));
    let ix = check_in_ix(
        &w.trainer.pubkey(),
        &other.pubkey(),
        &w.programme,
        &w.vault,
        &w.mint,
        &trainer_pda(&w.programme, &w.trainer.pubkey()).0,
        &enrollment_pda(&other.pubkey(), &w.programme).0,
        &ata(&other.pubkey(), &w.mint),
        0,
    );
    let res = send2(&mut w.svm, ix, &w.trainer, &[&other]);
    assert_rejected(&res, &["AccountNotInitialized"], "not enrolled");
    assert_nothing_paid(&w, TOTAL);
    // WHAT THIS PROVES: only participants the backend enrolled can be paid; there is no Enrollment
    // record for anyone else.
}

#[test]
fn check_in_cannot_use_someone_elses_enrollment() {
    let mut w = world(schedule(10_000_000));
    let b = enroll_other(&mut w, schedule(8_000_000));
    set_time(&mut w.svm, day_time(0));
    // Participant A signs but B's Enrollment is passed in.
    let ix = check_in_ix(
        &w.trainer.pubkey(),
        &w.trainee.pubkey(),
        &w.programme,
        &w.vault,
        &w.mint,
        &trainer_pda(&w.programme, &w.trainer.pubkey()).0,
        &enrollment_pda(&b, &w.programme).0,
        &ata(&w.trainee.pubkey(), &w.mint),
        0,
    );
    let res = send2(&mut w.svm, ix, &w.trainer, &[&w.trainee]);
    assert_rejected(&res, &["ConstraintSeeds"], "someone else's enrollment");
    assert_eq!(tok_balance(&w.svm, &ata(&b, &w.mint)), 0);
    assert_nothing_paid(&w, TOTAL + 40_000_000);
    // WHAT THIS PROVES: a participant cannot use another person's Enrollment (with its larger
    // amounts): the Enrollment address is derived from the participant who signs.
}

#[test]
fn check_in_cannot_redirect_payment() {
    let mut w = world(schedule(10_000_000));
    let b = enroll_other(&mut w, schedule(10_000_000));
    set_time(&mut w.svm, day_time(0));
    // Right enrollment, but another person's token account as the destination.
    let ix = check_in_ix(
        &w.trainer.pubkey(),
        &w.trainee.pubkey(),
        &w.programme,
        &w.vault,
        &w.mint,
        &trainer_pda(&w.programme, &w.trainer.pubkey()).0,
        &enrollment_pda(&w.trainee.pubkey(), &w.programme).0,
        &ata(&b, &w.mint),
        0,
    );
    let res = send2(&mut w.svm, ix, &w.trainer, &[&w.trainee]);
    assert_rejected(&res, &["ConstraintTokenOwner", "ConstraintAssociated"], "redirected payment");
    assert_eq!(tok_balance(&w.svm, &ata(&b, &w.mint)), 0, "b received nothing");
    assert_eq!(trainee_balance(&w), 0);
    assert_eq!(tok_balance(&w.svm, &w.vault), FUNDED);
    // WHAT THIS PROVES: the payment can only go to the participant's own token account for this mint,
    // so nobody can point the money somewhere else.
}
