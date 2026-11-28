// Tests for enroll.
// What these tests prove, in plain words:
//  - enroll records the promised daily amounts, sets that money aside (committed) and
//    counts the participant, WITHOUT moving any tokens
//  - the participant's token account is created for them, and they never sign or hold SOL
//  - the vault can never be promised more than it holds (including across participants)
//  - only the backend key can enroll; capacity, schedule length and end time are enforced
//  - the same participant cannot be enrolled twice, and payment can only go to their own token account
// Not covered yet: "enroll after reclaim is rejected" (needs the reclaim instruction).
use {
    anchor_lang::{
        prelude::Pubkey,
        solana_program::{instruction::Instruction, system_program},
        AccountDeserialize, InstructionData, ToAccountMetas,
    },
    litesvm::LiteSVM,
    litesvm_token::{CreateAssociatedTokenAccount, CreateMint, MintTo},
    payday::constants::{ENROLLMENT_SEED, PROGRAMME_SEED, VAULT_SEED},
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
const PROGRAMME_ID: u64 = 1;

// ---------- helpers ----------

fn set_time(svm: &mut LiteSVM, ts: i64) {
    let mut clock = svm.get_sysvar::<anchor_lang::prelude::Clock>();
    clock.unix_timestamp = ts;
    svm.set_sysvar(&clock);
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

fn enrollment_pda(trainee: &Pubkey, programme: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[ENROLLMENT_SEED, trainee.as_ref(), programme.as_ref()],
        &payday::id(),
    )
}

// The associated token account address of a wallet for a mint (standard derivation).
fn ata(wallet: &Pubkey, mint: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(
        &[wallet.as_ref(), anchor_spl::token::ID.as_ref(), mint.as_ref()],
        &anchor_spl::associated_token::ID,
    )
    .0
}

fn send(svm: &mut LiteSVM, ix: Instruction, fee_payer: &Keypair) -> Result<Vec<String>, Vec<String>> {
    svm.expire_blockhash();
    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&fee_payer.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[fee_payer]).unwrap();
    match svm.send_transaction(tx) {
        Ok(meta) => Ok(meta.logs),
        Err(failed) => Err(failed.meta.logs),
    }
}

fn has(logs: &[String], needle: &str) -> bool {
    logs.iter().any(|l| l.contains(needle))
}

// Passes if the send failed AND one of the named Anchor errors appears in the logs.
// Prints which one fired, so you can say exactly which check stopped the call.
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

fn create_ok(svm: &mut LiteSVM, organizer: &Keypair, mint: &Pubkey, backend: &Pubkey, max: u16) -> (Pubkey, Pubkey) {
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

// ONLY place that knows the enroll account list and arguments.
fn enroll_ix(
    backend: &Pubkey,
    programme: &Pubkey,
    trainee: &Pubkey,
    mint: &Pubkey,
    vault: &Pubkey,
    trainee_ta: &Pubkey,
    amounts: Vec<u64>,
) -> Instruction {
    let (enrollment, _) = enrollment_pda(trainee, programme);
    Instruction::new_with_bytes(
        payday::id(),
        &payday::instruction::Enroll { amounts }.data(),
        payday::accounts::Enroll {
            backend: *backend,
            programme: *programme,
            trainee: *trainee,
            enrollment,
            trainee_token_account: *trainee_ta,
            mint: *mint,
            vault: *vault,
            associated_token_program: anchor_spl::associated_token::ID,
            token_program: anchor_spl::token::ID,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    )
}

// SPL token account layout: mint 0..32, owner 32..64, amount 64..72.
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
}

// Programme created with a known backend key; vault funded with `fund` tokens (0 = unfunded).
fn world(fund: u64, max_participants: u16) -> World {
    let (mut svm, organizer, mint) = setup();
    let backend = Keypair::new();
    svm.airdrop(&backend.pubkey(), 2_000_000_000).unwrap();
    let (programme, vault) = create_ok(&mut svm, &organizer, &mint, &backend.pubkey(), max_participants);
    if fund > 0 {
        let org_ta = CreateAssociatedTokenAccount::new(&mut svm, &organizer, &mint)
            .owner(&organizer.pubkey())
            .send()
            .unwrap();
        MintTo::new(&mut svm, &organizer, &mint, &org_ta, fund).send().unwrap();
        let ix = fund_ix(&organizer.pubkey(), &programme, &org_ta, &vault, &mint, fund);
        send(&mut svm, ix, &organizer).expect("fund must succeed in setup");
    }
    World { svm, organizer, backend, mint, programme, vault }
}

// Enrolls `trainee` signed by the real backend key.
fn enroll(w: &mut World, trainee: &Pubkey, amounts: Vec<u64>) -> Result<Vec<String>, Vec<String>> {
    let ix = enroll_ix(&w.backend.pubkey(), &w.programme, trainee, &w.mint, &w.vault, &ata(trainee, &w.mint), amounts);
    send(&mut w.svm, ix, &w.backend)
}

fn schedule(per_day: u64) -> Vec<u64> {
    vec![per_day; DAYS]
}

fn assert_no_enrollment(w: &World, trainee: &Pubkey) {
    let (pda, _) = enrollment_pda(trainee, &w.programme);
    assert!(w.svm.get_account(&pda).is_none(), "no Enrollment account may exist");
}

// ---------- tests ----------

#[test]
fn enroll_success_never_funded_trainee() {
    let mut w = world(FUNDED, 2);
    let trainee = Keypair::new().pubkey(); // never airdropped, never signs
    assert!(w.svm.get_account(&trainee).is_none());
    let amounts = vec![10_000_000, 20_000_000, 10_000_000, 5_000_000, 5_000_000]; // sum 50 tokens
    enroll(&mut w, &trainee, amounts.clone()).expect("enroll must succeed");

    let (pda, bump) = enrollment_pda(&trainee, &w.programme);
    let acc = w.svm.get_account(&pda).unwrap();
    assert_eq!(acc.owner, payday::id());
    assert_eq!(acc.data.len(), 89 + 8 * DAYS, "size is 89 + 8 per day");
    let e = read_enrollment(&w.svm, &pda);
    assert_eq!(e.programme, w.programme);
    assert_eq!(e.trainee, trainee);
    assert_eq!(e.attendance_mask, 0);
    assert_eq!(e.paid_total, 0);
    assert_eq!(e.amounts, amounts);
    assert_eq!(e.bump, bump);

    let p = read_programme(&w.svm, &w.programme);
    assert_eq!(p.enrolled, 1);
    assert_eq!(p.committed, 50_000_000);
    assert_eq!(p.total_funded, FUNDED);

    let ta = ata(&trainee, &w.mint);
    let ta_acc = w.svm.get_account(&ta).expect("trainee token account must be created");
    assert_eq!(ta_acc.owner, anchor_spl::token::ID);
    assert_eq!(&ta_acc.data[0..32], w.mint.as_ref());
    assert_eq!(&ta_acc.data[32..64], trainee.as_ref());
    assert_eq!(tok_balance(&w.svm, &ta), 0);
    assert_eq!(tok_balance(&w.svm, &w.vault), FUNDED, "enroll moves no tokens");
    assert!(w.svm.get_account(&trainee).is_none(), "trainee wallet untouched");
    // WHAT THIS PROVES: enrolling stores the participant's per-day amounts, sets that money
    // aside (committed) and counts them, without moving tokens. It creates their token account,
    // and the participant never signs or needs SOL, because the backend pays the rent.
}

#[test]
fn enroll_keeps_existing_token_account() {
    let mut w = world(FUNDED, 2);
    let trainee = Keypair::new().pubkey();
    let ta = CreateAssociatedTokenAccount::new(&mut w.svm, &w.organizer, &w.mint)
        .owner(&trainee)
        .send()
        .unwrap();
    MintTo::new(&mut w.svm, &w.organizer, &w.mint, &ta, 777).send().unwrap();
    assert_eq!(ta, ata(&trainee, &w.mint));
    enroll(&mut w, &trainee, schedule(1_000_000)).expect("enroll must succeed");
    assert_eq!(tok_balance(&w.svm, &ta), 777, "existing balance untouched");
    let (pda, _) = enrollment_pda(&trainee, &w.programme);
    assert_eq!(read_enrollment(&w.svm, &pda).trainee, trainee);
    // WHAT THIS PROVES: a participant who already has a token account (for example from another
    // programme) can still be enrolled; their account and balance are left alone.
}

#[test]
fn enroll_wrong_schedule_length_rejected() {
    let mut w = world(FUNDED, 2);
    let trainee = Keypair::new().pubkey();
    for bad_len in [DAYS - 1, DAYS + 1] {
        let res = enroll(&mut w, &trainee, vec![1_000_000; bad_len]);
        assert_rejected(&res, &["WrongScheduleLength"], "wrong schedule length");
    }
    assert_no_enrollment(&w, &trainee);
    assert!(w.svm.get_account(&ata(&trainee, &w.mint)).is_none(), "no token account may be left behind");
    let p = read_programme(&w.svm, &w.programme);
    assert_eq!((p.enrolled, p.committed), (0, 0));
    // WHAT THIS PROVES: the number of amounts must equal the number of days; a failed call
    // leaves nothing behind (no Enrollment, no token account, no change to the programme).
}

#[test]
fn enroll_unfunded_vault_rejected() {
    let mut w = world(0, 2);
    let trainee = Keypair::new().pubkey();
    let res = enroll(&mut w, &trainee, schedule(1_000_000));
    assert_rejected(&res, &["InsufficientFunding"], "unfunded vault");
    assert_no_enrollment(&w, &trainee);
    assert_eq!(read_programme(&w.svm, &w.programme).committed, 0);
    // WHAT THIS PROVES: you cannot promise money the vault does not hold.
}

#[test]
fn enroll_over_commit_rejected_across_participants() {
    let mut w = world(FUNDED, 2);
    let a = Keypair::new().pubkey();
    let b = Keypair::new().pubkey();
    enroll(&mut w, &a, schedule(10_000_000)).expect("first (50 tokens) must succeed");
    let res = enroll(&mut w, &b, schedule(12_000_000)); // 60 more would make 110 > 100
    assert_rejected(&res, &["InsufficientFunding"], "over-commit");
    assert_no_enrollment(&w, &b);
    let p = read_programme(&w.svm, &w.programme);
    assert_eq!((p.enrolled, p.committed), (1, 50_000_000));
    // WHAT THIS PROVES: promises add up across participants. The second participant is refused
    // because their amounts plus what is already committed exceed the vault balance.
}

#[test]
fn enroll_exactly_fills_vault_ok() {
    let mut w = world(FUNDED, 2);
    let a = Keypair::new().pubkey();
    let b = Keypair::new().pubkey();
    enroll(&mut w, &a, schedule(10_000_000)).expect("first must succeed");
    enroll(&mut w, &b, schedule(10_000_000)).expect("second must succeed: total equals the vault exactly");
    let p = read_programme(&w.svm, &w.programme);
    assert_eq!((p.enrolled, p.committed), (2, FUNDED));
    assert_eq!(tok_balance(&w.svm, &w.vault), FUNDED);
    // WHAT THIS PROVES: the limit is "committed may equal the vault balance, never exceed it".
}

#[test]
fn enroll_programme_full_rejected() {
    let mut w = world(FUNDED, 2);
    let a = Keypair::new().pubkey();
    let b = Keypair::new().pubkey();
    let c = Keypair::new().pubkey();
    enroll(&mut w, &a, schedule(1_000_000)).expect("1st must succeed");
    enroll(&mut w, &b, schedule(1_000_000)).expect("2nd must succeed");
    let res = enroll(&mut w, &c, schedule(1_000_000));
    assert_rejected(&res, &["ProgrammeFull"], "programme full");
    assert_no_enrollment(&w, &c);
    assert_eq!(read_programme(&w.svm, &w.programme).enrolled, 2);
    // WHAT THIS PROVES: the capacity set at creation is enforced; participant 3 of 2 is refused.
}

#[test]
fn enroll_wrong_signer_rejected() {
    let mut w = world(FUNDED, 2);
    let trainee = Keypair::new().pubkey();

    // A stranger signs as backend.
    let stranger = Keypair::new();
    w.svm.airdrop(&stranger.pubkey(), 2_000_000_000).unwrap();
    let ix = enroll_ix(&stranger.pubkey(), &w.programme, &trainee, &w.mint, &w.vault, &ata(&trainee, &w.mint), schedule(1_000_000));
    let res = send(&mut w.svm, ix, &stranger);
    assert_rejected(&res, &["InvalidBackend"], "stranger as backend");

    // Even the organizer cannot enroll: only the backend key can.
    let ix = enroll_ix(&w.organizer.pubkey(), &w.programme, &trainee, &w.mint, &w.vault, &ata(&trainee, &w.mint), schedule(1_000_000));
    let res = send(&mut w.svm, ix, &w.organizer);
    assert_rejected(&res, &["InvalidBackend"], "organizer as backend");

    assert_no_enrollment(&w, &trainee);
    assert_eq!(read_programme(&w.svm, &w.programme).enrolled, 0);
    // WHAT THIS PROVES: only the backend key stored in the Programme may enroll people.
    // Strangers and, by design, the organizer are refused.
}

#[test]
fn enroll_duplicate_rejected() {
    let mut w = world(FUNDED, 2);
    let trainee = Keypair::new().pubkey();
    enroll(&mut w, &trainee, schedule(10_000_000)).expect("first must succeed");
    let res = enroll(&mut w, &trainee, schedule(10_000_000));
    match &res {
        Ok(_) => panic!("duplicate enrollment must fail"),
        Err(logs) => assert!(has(logs, "already in use"), "expected 'already in use'. Logs:\n{}", logs.join("\n")),
    }
    println!("FIRED duplicate: account already in use");
    let p = read_programme(&w.svm, &w.programme);
    assert_eq!((p.enrolled, p.committed), (1, 50_000_000), "nothing double counted");
    // WHAT THIS PROVES: a participant cannot be enrolled twice in one programme, because their
    // Enrollment address already exists, so their promised money is never counted twice.
}

#[test]
fn enroll_after_end_rejected() {
    let mut w = world(FUNDED, 2);
    let a = Keypair::new().pubkey();
    let b = Keypair::new().pubkey();
    set_time(&mut w.svm, END_TS - 1);
    enroll(&mut w, &a, schedule(1_000_000)).expect("one second before the end must succeed");
    set_time(&mut w.svm, END_TS);
    let res = enroll(&mut w, &b, schedule(1_000_000));
    assert_rejected(&res, &["ProgrammeClosed"], "after end");
    assert_no_enrollment(&w, &b);
    assert_eq!(read_programme(&w.svm, &w.programme).enrolled, 1);
    // WHAT THIS PROVES: enrolling is allowed until the programme's end time and refused from
    // that moment on.
}

#[test]
fn enroll_wrong_token_account_rejected() {
    let mut w = world(FUNDED, 2);
    let stranger = Keypair::new().pubkey();
    let s_ta = CreateAssociatedTokenAccount::new(&mut w.svm, &w.organizer, &w.mint)
        .owner(&stranger)
        .send()
        .unwrap();
    MintTo::new(&mut w.svm, &w.organizer, &w.mint, &s_ta, 500_000).send().unwrap();

    let trainee = Keypair::new().pubkey();
    // The stranger's token account is passed where the trainee's own one must be.
    let ix = enroll_ix(&w.backend.pubkey(), &w.programme, &trainee, &w.mint, &w.vault, &s_ta, schedule(1_000_000));
    let res = send(&mut w.svm, ix, &w.backend);
    match &res {
        Ok(_) => panic!("a token account that is not the trainee's must be rejected"),
        Err(logs) => {
            let line = logs.iter().find(|l| l.contains("Error")).cloned().unwrap_or_default();
            println!("FIRED wrong token account: {line}");
        }
    }
    assert_no_enrollment(&w, &trainee);
    assert_eq!(tok_balance(&w.svm, &s_ta), 500_000);
    assert_eq!(read_programme(&w.svm, &w.programme).committed, 0);
    // WHAT THIS PROVES: the participant's token account must be the one that belongs to them
    // for this mint, so later payments cannot be pointed at someone else's account.
}
