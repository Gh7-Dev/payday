// Tests for reclaim, and for what the other instructions do AFTER a reclaim.
// What these tests prove, in plain words:
//  - after the end time the organizer gets back everything left in the vault, including the money
//    promised to participants who never showed up, and the books balance: funded = paid + reclaimed
//  - before the end time, a second time, by a stranger, or to someone else's account: refused, nothing moves
//  - a programme nobody funded can still be closed
//  - after a reclaim there is no more funding, no new trainers, no new enrolments and no check-ins
use {
    anchor_lang::{
        prelude::{Clock, Pubkey},
        solana_program::{instruction::Instruction, system_program},
        AccountDeserialize, InstructionData, ToAccountMetas,
    },
    litesvm::LiteSVM,
    litesvm_token::{CreateAssociatedTokenAccount, CreateMint, MintTo},
    payday::constants::{ENROLLMENT_SEED, PROGRAMME_SEED, TRAINER_SEED, VAULT_SEED},
    payday::state::Programme,
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
};

const START_TIME: i64 = 1_800_000_000;
const START_TS: i64 = START_TIME + 3600;
const DAY_LEN: i64 = 86_400;
const DAYS: usize = 5;
const END_TS: i64 = START_TS + (DAYS as i64) * DAY_LEN;
const FUNDED: u64 = 100_000_000; // 100 tokens at 6 decimals
const PROGRAMME_ID: u64 = 1;

// ---------- helpers ----------

fn set_time(svm: &mut LiteSVM, ts: i64) {
    let mut clock = svm.get_sysvar::<Clock>();
    clock.unix_timestamp = ts;
    svm.set_sysvar(&clock);
}

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

fn create_ok(svm: &mut LiteSVM, organizer: &Keypair, mint: &Pubkey, backend: &Pubkey) -> (Pubkey, Pubkey) {
    let (programme, _) = programme_pda(&organizer.pubkey(), PROGRAMME_ID);
    let (vault, _) = vault_pda(&programme);
    let ix = Instruction::new_with_bytes(
        payday::id(),
        &payday::instruction::CreateProgramme {
            programme_id: PROGRAMME_ID,
            backend_key: *backend,
            start_ts: START_TS,
            day_len: DAY_LEN,
            days: DAYS as u8,
            max_participants: 5,
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

fn add_trainer_ix(organizer: &Pubkey, programme: &Pubkey, wallet: &Pubkey) -> Instruction {
    let (trainer, _) = trainer_pda(programme, wallet);
    Instruction::new_with_bytes(
        payday::id(),
        &payday::instruction::AddTrainer { programme_id: PROGRAMME_ID }.data(),
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

fn check_in_ix(
    trainer: &Pubkey,
    trainee: &Pubkey,
    programme: &Pubkey,
    vault: &Pubkey,
    mint: &Pubkey,
    day: u8,
) -> Instruction {
    Instruction::new_with_bytes(
        payday::id(),
        &payday::instruction::CheckIn { day }.data(),
        payday::accounts::CheckIn {
            trainer: *trainer,
            trainee: *trainee,
            programme: *programme,
            trainer_account: trainer_pda(programme, trainer).0,
            enrollment: enrollment_pda(trainee, programme).0,
            vault: *vault,
            trainee_token_account: ata(trainee, mint),
            mint: *mint,
            token_program: anchor_spl::token::ID,
        }
        .to_account_metas(None),
    )
}

// ONLY place that knows the reclaim account list.
fn reclaim_ix(organizer: &Pubkey, programme: &Pubkey, vault: &Pubkey, destination: &Pubkey, mint: &Pubkey) -> Instruction {
    Instruction::new_with_bytes(
        payday::id(),
        &payday::instruction::Reclaim {}.data(),
        payday::accounts::Reclaim {
            organizer: *organizer,
            programme: *programme,
            vault: *vault,
            organizer_token_account: *destination,
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

struct World {
    svm: LiteSVM,
    organizer: Keypair,
    backend: Keypair,
    mint: Pubkey,
    programme: Pubkey,
    vault: Pubkey,
    org_ta: Pubkey, // the organizer's token account (exists even if nothing was funded)
    trainer: Keypair, // registered trainer with SOL for fees
}

// Programme created, `fund` tokens put in the vault (0 = nothing funded), one trainer registered.
fn world(fund: u64) -> World {
    let (mut svm, organizer, mint) = setup();
    let backend = Keypair::new();
    svm.airdrop(&backend.pubkey(), 2_000_000_000).unwrap();
    let (programme, vault) = create_ok(&mut svm, &organizer, &mint, &backend.pubkey());
    let org_ta = CreateAssociatedTokenAccount::new(&mut svm, &organizer, &mint)
        .owner(&organizer.pubkey())
        .send()
        .unwrap();
    if fund > 0 {
        MintTo::new(&mut svm, &organizer, &mint, &org_ta, fund).send().unwrap();
        send(&mut svm, fund_ix(&organizer.pubkey(), &programme, &org_ta, &vault, &mint, fund), &organizer)
            .expect("fund must succeed in setup");
    }
    let trainer = Keypair::new();
    svm.airdrop(&trainer.pubkey(), 1_000_000_000).unwrap();
    send(&mut svm, add_trainer_ix(&organizer.pubkey(), &programme, &trainer.pubkey()), &organizer)
        .expect("add_trainer must succeed in setup");
    World { svm, organizer, backend, mint, programme, vault, org_ta, trainer }
}

fn schedule(per_day: u64) -> Vec<u64> {
    vec![per_day; DAYS]
}

// Enrolls a new participant (signed by the backend); returns their keypair.
fn enroll_trainee(w: &mut World, amounts: Vec<u64>) -> Keypair {
    let t = Keypair::new();
    let ix = enroll_ix(&w.backend.pubkey(), &w.programme, &t.pubkey(), &w.mint, &w.vault, amounts);
    send(&mut w.svm, ix, &w.backend).expect("enroll must succeed in setup");
    t
}

// Trainer pays the fee and signs; the participant signs too.
fn check_in_as(w: &mut World, trainee: &Keypair, day: u8) -> Result<Vec<String>, Vec<String>> {
    let ix = check_in_ix(&w.trainer.pubkey(), &trainee.pubkey(), &w.programme, &w.vault, &w.mint, day);
    send2(&mut w.svm, ix, &w.trainer, &[trainee])
}

fn reclaim_ix_std(w: &World) -> Instruction {
    reclaim_ix(&w.organizer.pubkey(), &w.programme, &w.vault, &w.org_ta, &w.mint)
}

// The organizer reclaims into their own token account.
fn reclaim_std(w: &mut World) -> Result<Vec<String>, Vec<String>> {
    let ix = reclaim_ix_std(w);
    send(&mut w.svm, ix, &w.organizer)
}

fn stranger_with_token_account(w: &mut World) -> (Keypair, Pubkey) {
    let s = Keypair::new();
    w.svm.airdrop(&s.pubkey(), 1_000_000_000).unwrap();
    let ta = CreateAssociatedTokenAccount::new(&mut w.svm, &w.organizer, &w.mint)
        .owner(&s.pubkey())
        .send()
        .unwrap();
    (s, ta)
}

// ---------- reclaim tests ----------

#[test]
fn reclaim_after_end_returns_everything_left_including_absentee_money() {
    let mut w = world(FUNDED);
    let a = enroll_trainee(&mut w, schedule(10_000_000)); // 50 promised, attends 2 days
    let _b = enroll_trainee(&mut w, schedule(10_000_000)); // 50 promised, never shows up
    set_time(&mut w.svm, day_time(0));
    check_in_as(&mut w, &a, 0).expect("day 0");
    set_time(&mut w.svm, day_time(1));
    check_in_as(&mut w, &a, 1).expect("day 1");
    assert_eq!(tok_balance(&w.svm, &w.vault), 80_000_000);
    assert_eq!(tok_balance(&w.svm, &w.org_ta), 0, "organizer put everything in the vault");

    set_time(&mut w.svm, END_TS);
    reclaim_std(&mut w).expect("reclaim at the end time must work");

    assert_eq!(tok_balance(&w.svm, &w.org_ta), 80_000_000, "organizer gets back what is left");
    assert_eq!(tok_balance(&w.svm, &w.vault), 0, "vault is empty");
    assert_eq!(tok_balance(&w.svm, &ata(&a.pubkey(), &w.mint)), 20_000_000, "attendee keeps what was paid");
    let p = read_programme(&w.svm, &w.programme);
    assert!(p.reclaimed);
    assert_eq!(p.total_reclaimed, 80_000_000);
    assert_eq!(p.committed, 0);
    assert_eq!(p.total_paid, 20_000_000);
    assert_eq!(p.total_funded, FUNDED);
    assert_eq!(p.total_paid + p.total_reclaimed, p.total_funded, "the books balance");
    // WHAT THIS PROVES: at the end time the organizer gets back everything left in the vault, including
    // the 50 tokens promised to someone who never came and the 30 for days not attended. Nothing is
    // lost: funded 100 = paid 20 + reclaimed 80.
}

#[test]
fn reclaim_before_end_rejected() {
    let mut w = world(FUNDED);
    let _a = enroll_trainee(&mut w, schedule(10_000_000));
    set_time(&mut w.svm, END_TS - 1);
    let res = reclaim_std(&mut w);
    assert_rejected(&res, &["EventNotOver"], "one second before the end");
    assert_eq!(tok_balance(&w.svm, &w.vault), FUNDED);
    assert_eq!(tok_balance(&w.svm, &w.org_ta), 0);
    let p = read_programme(&w.svm, &w.programme);
    assert!(!p.reclaimed);
    assert_eq!(p.total_reclaimed, 0);
    // WHAT THIS PROVES: the organizer cannot pull the money out while the programme is still running,
    // not even one second early.
}

#[test]
fn reclaim_twice_rejected() {
    let mut w = world(FUNDED);
    set_time(&mut w.svm, END_TS);
    reclaim_std(&mut w).expect("first reclaim");
    let res = reclaim_std(&mut w);
    assert_rejected(&res, &["ProgrammeClosed"], "second reclaim");
    assert_eq!(tok_balance(&w.svm, &w.org_ta), FUNDED, "balance unchanged by the second try");
    assert_eq!(read_programme(&w.svm, &w.programme).total_reclaimed, FUNDED);
    // WHAT THIS PROVES: a programme can be reclaimed only once, and a second try changes nothing.
}

#[test]
fn reclaim_non_organizer_rejected() {
    let mut w = world(FUNDED);
    let (s, s_ta) = stranger_with_token_account(&mut w);
    set_time(&mut w.svm, END_TS);
    let ix = reclaim_ix(&s.pubkey(), &w.programme, &w.vault, &s_ta, &w.mint);
    let res = send(&mut w.svm, ix, &s);
    assert_rejected(&res, &["Unauthorized", "ConstraintSeeds"], "stranger reclaiming");
    assert_eq!(tok_balance(&w.svm, &w.vault), FUNDED);
    assert_eq!(tok_balance(&w.svm, &s_ta), 0);
    assert!(!read_programme(&w.svm, &w.programme).reclaimed);
    // WHAT THIS PROVES: only this programme's organizer can take the money back. The FIRED line says
    // which check stopped the stranger.
}

#[test]
fn reclaim_to_someone_elses_token_account_rejected() {
    let mut w = world(FUNDED);
    let (_s, s_ta) = stranger_with_token_account(&mut w);
    set_time(&mut w.svm, END_TS);
    let ix = reclaim_ix(&w.organizer.pubkey(), &w.programme, &w.vault, &s_ta, &w.mint);
    let res = send(&mut w.svm, ix, &w.organizer);
    assert_rejected(&res, &["ConstraintTokenOwner"], "wrong destination");
    assert_eq!(tok_balance(&w.svm, &w.vault), FUNDED);
    assert_eq!(tok_balance(&w.svm, &s_ta), 0);
    assert!(!read_programme(&w.svm, &w.programme).reclaimed);
    // WHAT THIS PROVES: the money can only be sent to a token account owned by the organizer who
    // signs, so it cannot be redirected to anyone else.
}

#[test]
fn reclaim_of_an_unfunded_programme_just_closes_it() {
    let mut w = world(0);
    set_time(&mut w.svm, END_TS);
    reclaim_std(&mut w).expect("an empty programme can be closed");
    let p = read_programme(&w.svm, &w.programme);
    assert!(p.reclaimed);
    assert_eq!(p.total_reclaimed, 0);
    assert_eq!(tok_balance(&w.svm, &w.org_ta), 0);
    // WHAT THIS PROVES: an empty vault is not an error; reclaim marks the programme closed without
    // moving any tokens.
}

// ---------- what happens after a reclaim ----------

#[test]
fn fund_after_reclaim_rejected() {
    let mut w = world(FUNDED);
    set_time(&mut w.svm, END_TS);
    reclaim_std(&mut w).expect("reclaim");
    let ix = fund_ix(&w.organizer.pubkey(), &w.programme, &w.org_ta, &w.vault, &w.mint, 1_000_000);
    let res = send(&mut w.svm, ix, &w.organizer);
    assert_rejected(&res, &["ProgrammeClosed"], "fund after reclaim");
    assert_eq!(tok_balance(&w.svm, &w.vault), 0);
    assert_eq!(tok_balance(&w.svm, &w.org_ta), FUNDED);
    // WHAT THIS PROVES: once a programme is reclaimed, nobody can put money into it again.
}

#[test]
fn add_trainer_after_reclaim_rejected() {
    let mut w = world(FUNDED);
    set_time(&mut w.svm, END_TS);
    reclaim_std(&mut w).expect("reclaim");
    let wallet = Keypair::new().pubkey();
    let ix = add_trainer_ix(&w.organizer.pubkey(), &w.programme, &wallet);
    let res = send(&mut w.svm, ix, &w.organizer);
    assert_rejected(&res, &["ProgrammeClosed"], "add_trainer after reclaim");
    assert!(w.svm.get_account(&trainer_pda(&w.programme, &wallet).0).is_none());
    // WHAT THIS PROVES: no new trainer can be registered for a reclaimed programme (design report:
    // "not after reclaim").
}

#[test]
fn enroll_after_reclaim_rejected() {
    let mut w = world(FUNDED);
    set_time(&mut w.svm, END_TS);
    reclaim_std(&mut w).expect("reclaim");
    let t = Keypair::new().pubkey();
    let ix = enroll_ix(&w.backend.pubkey(), &w.programme, &t, &w.mint, &w.vault, schedule(1_000_000));
    let res = send(&mut w.svm, ix, &w.backend);
    assert_rejected(&res, &["ProgrammeClosed"], "enroll after reclaim");
    assert!(w.svm.get_account(&enrollment_pda(&t, &w.programme).0).is_none());
    assert_eq!(read_programme(&w.svm, &w.programme).enrolled, 0);
    // WHAT THIS PROVES: nobody can be enrolled in a programme that has been reclaimed.
}

#[test]
fn check_in_after_reclaim_rejected() {
    let mut w = world(FUNDED);
    let a = enroll_trainee(&mut w, schedule(10_000_000));
    set_time(&mut w.svm, END_TS);
    reclaim_std(&mut w).expect("reclaim");
    let res = check_in_as(&mut w, &a, 4);
    assert_rejected(&res, &["WrongDay"], "check-in after reclaim");
    assert_eq!(tok_balance(&w.svm, &ata(&a.pubkey(), &w.mint)), 0);
    // WHAT THIS PROVES: nobody can be paid after a reclaim. Check-in already stops at the end time and
    // reclaim only starts at the end time, so the two never overlap.
}
