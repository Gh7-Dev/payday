// Tests for create_programme (+ the mint setup test).
// What the tests prove, in plain words:
//  - create works: Programme and vault exist, with the right data, owners and bumps
//  - each bad input is rejected with the RIGHT error and creates nothing
//  - the organizer must sign; the programme address must match its seeds
//  - a non-mint account cannot be used as the mint
//  - the same programme cannot be created twice
//  - LiteSVM's clock can be read and set (open test 2 in the design report)
use {
    anchor_lang::{
        prelude::{Clock, Pubkey},
        solana_program::{instruction::Instruction, system_program},
        AccountDeserialize, InstructionData, ToAccountMetas,
    },
    litesvm::LiteSVM,
    litesvm_token::CreateMint,
    payday::constants::{PROGRAMME_SEED, VAULT_SEED},
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
};

const START_TIME: i64 = 1_800_000_000; // a realistic Unix time (Jan 2027)

// ---------- helpers ----------

fn set_time(svm: &mut LiteSVM, ts: i64) {
    let mut clock = svm.get_sysvar::<Clock>();
    clock.unix_timestamp = ts;
    svm.set_sysvar(&clock);
}

fn now(svm: &LiteSVM) -> i64 {
    svm.get_sysvar::<Clock>().unix_timestamp
}

// Fresh chain: program loaded, funded payer, a 6-decimal mint, clock at START_TIME.
fn setup() -> (LiteSVM, Keypair, Pubkey) {
    let mut svm = LiteSVM::new();
    let bytes = include_bytes!(concat!(
        env!("CARGO_TARGET_TMPDIR"),
        "/../deploy/payday.so"
    ));
    svm.add_program(payday::id(), bytes).unwrap();
    let payer = Keypair::new();
    svm.airdrop(&payer.pubkey(), 10_000_000_000).unwrap();
    let mint = CreateMint::new(&mut svm, &payer)
        .decimals(6)
        .send()
        .unwrap();
    set_time(&mut svm, START_TIME);
    (svm, payer, mint)
}

#[derive(Clone)]
struct Args {
    programme_id: u64,
    backend_key: Pubkey,
    start_ts: i64,
    day_len: i64,
    days: u8,
    max_participants: u16,
}

fn valid_args(svm: &LiteSVM) -> Args {
    Args {
        programme_id: 1,
        backend_key: Keypair::new().pubkey(),
        start_ts: now(svm) + 3600,
        day_len: 86_400,
        days: 5,
        max_participants: 30,
    }
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

fn create_ix(
    organizer: &Pubkey,
    mint: &Pubkey,
    programme: &Pubkey,
    vault: &Pubkey,
    a: &Args,
) -> Instruction {
    Instruction::new_with_bytes(
        payday::id(),
        &payday::instruction::CreateProgramme {
            programme_id: a.programme_id,
            backend_key: a.backend_key,
            start_ts: a.start_ts,
            day_len: a.day_len,
            days: a.days,
            max_participants: a.max_participants,
        }
        .data(),
        payday::accounts::CreateProgramme {
            organizer: *organizer,
            programme: *programme,
            vault: *vault,
            mint: *mint,
            token_program: anchor_spl::token::ID,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    )
}

// Sends one instruction signed by `fee_payer`. Ok(logs) or Err(logs).
// A new blockhash each time, so two identical sends are not "already processed".
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

// Creates a programme that must succeed; returns (programme, vault).
fn create_ok(svm: &mut LiteSVM, organizer: &Keypair, mint: &Pubkey, a: &Args) -> (Pubkey, Pubkey) {
    let (programme, _) = programme_pda(&organizer.pubkey(), a.programme_id);
    let (vault, _) = vault_pda(&programme);
    let ix = create_ix(&organizer.pubkey(), mint, &programme, &vault, a);
    let res = send(svm, ix, organizer);
    assert!(res.is_ok(), "create should succeed, logs: {:?}", res.err());
    (programme, vault)
}

// Changes one thing in valid args and expects a specific Anchor error.
fn assert_rejected(change: impl FnOnce(&mut Args, i64), error_name: &str) {
    let (mut svm, payer, mint) = setup();
    let t = now(&svm);
    let mut a = valid_args(&svm);
    change(&mut a, t);
    let (programme, _) = programme_pda(&payer.pubkey(), a.programme_id);
    let (vault, _) = vault_pda(&programme);
    let ix = create_ix(&payer.pubkey(), &mint, &programme, &vault, &a);
    let logs = send(&mut svm, ix, &payer).expect_err("transaction should have failed");
    assert!(
        has(&logs, &format!("Error Code: {error_name}")),
        "expected {error_name}, logs: {:?}",
        logs
    );
    assert!(
        svm.get_account(&programme).is_none(),
        "a rejected create must not leave a programme behind"
    );
}

// ---------- tests ----------

#[test]
fn test_mint() {
    let (svm, _payer, mint) = setup();
    match svm.get_account(&mint) {
        Some(account) => assert_eq!(account.owner, anchor_spl::token::ID),
        None => panic!("Mint not found"),
    }
}

#[test]
fn clock_can_be_set() {
    let (mut svm, _payer, _mint) = setup();
    assert_eq!(now(&svm), START_TIME);
    set_time(&mut svm, 1_900_000_000);
    assert_eq!(now(&svm), 1_900_000_000);
}

#[test]
fn create_programme_succeeds() {
    let (mut svm, payer, mint) = setup();
    let a = valid_args(&svm);
    let (programme, vault) = create_ok(&mut svm, &payer, &mint, &a);

    let acc = svm.get_account(&programme).expect("programme account missing");
    assert_eq!(acc.owner, payday::id());
    assert_eq!(acc.data.len(), 168); // 8 discriminator + 160 data
    let mut data: &[u8] = &acc.data;
    let p = payday::state::Programme::try_deserialize(&mut data).unwrap();

    assert_eq!(p.organizer, payer.pubkey());
    assert_eq!(p.backend_key, a.backend_key);
    assert_eq!(p.mint, mint);
    assert_eq!(p.programme_id, a.programme_id);
    assert_eq!(p.start_ts, a.start_ts);
    assert_eq!(p.day_len, a.day_len);
    assert_eq!(p.days, a.days);
    assert_eq!(p.max_participants, a.max_participants);
    assert_eq!(p.enrolled, 0);
    assert_eq!(p.total_funded, 0);
    assert_eq!(p.total_paid, 0);
    assert_eq!(p.total_reclaimed, 0);
    assert_eq!(p.committed, 0);
    assert!(!p.reclaimed);
    assert_eq!(p.bump, programme_pda(&payer.pubkey(), a.programme_id).1);
    assert_eq!(p.vault_bump, vault_pda(&programme).1);

    let v = svm.get_account(&vault).expect("vault account missing");
    assert_eq!(v.owner, anchor_spl::token::ID);
    let mut vdata: &[u8] = &v.data;
    let tok = anchor_spl::token::TokenAccount::try_deserialize(&mut vdata).unwrap();
    assert_eq!(tok.mint, mint);
    assert_eq!(tok.owner, programme);
    assert_eq!(tok.amount, 0);
}

#[test]
fn start_exactly_now_is_accepted() {
    // The handler uses start_ts >= now, so "now" is allowed.
    let (mut svm, payer, mint) = setup();
    let mut a = valid_args(&svm);
    a.start_ts = now(&svm);
    create_ok(&mut svm, &payer, &mint, &a);
}

#[test]
fn boundary_values_are_accepted() {
    let (mut svm, payer, mint) = setup();
    let cases = [(1u8, 60i64, 1u16), (31u8, 86_400i64, u16::MAX)];
    for (i, (days, day_len, cap)) in cases.into_iter().enumerate() {
        let mut a = valid_args(&svm);
        a.programme_id = 100 + i as u64;
        a.days = days;
        a.day_len = day_len;
        a.max_participants = cap;
        create_ok(&mut svm, &payer, &mint, &a);
    }
}

#[test]
fn creating_the_same_programme_twice_fails() {
    let (mut svm, payer, mint) = setup();
    let a = valid_args(&svm);
    let (programme, vault) = create_ok(&mut svm, &payer, &mint, &a);
    let ix = create_ix(&payer.pubkey(), &mint, &programme, &vault, &a);
    let logs = send(&mut svm, ix, &payer).expect_err("second create must fail");
    assert!(has(&logs, "already in use"), "unexpected logs: {:?}", logs);
}

#[test]
fn organizer_must_sign() {
    let (mut svm, organizer, mint) = setup();
    let attacker = Keypair::new();
    svm.airdrop(&attacker.pubkey(), 1_000_000_000).unwrap();
    let a = valid_args(&svm);
    let (programme, _) = programme_pda(&organizer.pubkey(), a.programme_id);
    let (vault, _) = vault_pda(&programme);
    let mut ix = create_ix(&organizer.pubkey(), &mint, &programme, &vault, &a);
    for m in ix.accounts.iter_mut() {
        if m.pubkey == organizer.pubkey() {
            m.is_signer = false; // organizer named but not signing
        }
    }
    let logs = send(&mut svm, ix, &attacker).expect_err("must fail without the organizer's signature");
    assert!(has(&logs, "AccountNotSigner"), "unexpected logs: {:?}", logs);
    assert!(svm.get_account(&programme).is_none());
}

#[test]
fn programme_address_must_match_its_seeds() {
    let (mut svm, payer, mint) = setup();
    let a = valid_args(&svm);
    let wrong_programme = Keypair::new().pubkey();
    let (vault, _) = vault_pda(&wrong_programme);
    let ix = create_ix(&payer.pubkey(), &mint, &wrong_programme, &vault, &a);
    let logs = send(&mut svm, ix, &payer).expect_err("a wrong programme address must fail");
    assert!(has(&logs, "ConstraintSeeds"), "unexpected logs: {:?}", logs);
}

#[test]
fn mint_must_be_a_real_token_mint() {
    let (mut svm, payer, _mint) = setup();
    let a = valid_args(&svm);
    let (programme, _) = programme_pda(&payer.pubkey(), a.programme_id);
    let (vault, _) = vault_pda(&programme);
    let not_a_mint = payer.pubkey(); // a plain system account
    let ix = create_ix(&payer.pubkey(), &not_a_mint, &programme, &vault, &a);
    let logs = send(&mut svm, ix, &payer).expect_err("a non-mint must fail");
    assert!(has(&logs, "AccountOwnedByWrongProgram"), "unexpected logs: {:?}", logs);
}

#[test]
fn rejects_zero_days() {
    assert_rejected(|a, _| a.days = 0, "InvalidDays");
}

#[test]
fn rejects_more_than_31_days() {
    assert_rejected(|a, _| a.days = 32, "InvalidDays");
}

#[test]
fn rejects_day_length_under_60_seconds() {
    assert_rejected(|a, _| a.day_len = 59, "InvalidDayLength");
}

#[test]
fn rejects_start_in_the_past() {
    assert_rejected(|a, t| a.start_ts = t - 1, "StartInPast");
}

#[test]
fn rejects_zero_capacity() {
    assert_rejected(|a, _| a.max_participants = 0, "InvalidCapacity");
}
