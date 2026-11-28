// Tests for add_trainer.
// What these tests prove, in plain words:
//  - the organizer can register a trainer wallet; the Trainer account has the right data
//  - any number of trainers can be registered (no cap)
//  - the same trainer cannot be registered twice
//  - only this programme's organizer can register trainers
//  - registration works after the event has started
//  - the trainer wallet does not sign, does not need SOL, and the organizer pays the rent
// Not covered yet: "reclaimed programme rejected" (needs the reclaim instruction).
use {
    anchor_lang::{
        prelude::{Clock, Pubkey},
        solana_program::{instruction::Instruction, system_program},
        AccountDeserialize, InstructionData, ToAccountMetas,
    },
    litesvm::LiteSVM,
    litesvm_token::CreateMint,
    payday::constants::{PROGRAMME_SEED, TRAINER_SEED, VAULT_SEED},
    payday::state::Trainer,
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
};

const START_TIME: i64 = 1_800_000_000;
const PROGRAMME_ID: u64 = 1;
const DAY_LEN: i64 = 86_400;
const DAYS: i64 = 5;
const TRAINER_ACCOUNT_BYTES: usize = 73;

// ---------- helpers ----------

fn set_time(svm: &mut LiteSVM, ts: i64) {
    let mut clock = svm.get_sysvar::<Clock>();
    clock.unix_timestamp = ts;
    svm.set_sysvar(&clock);
}

fn now(svm: &LiteSVM) -> i64 {
    svm.get_sysvar::<Clock>().unix_timestamp
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

fn create_ok(svm: &mut LiteSVM, organizer: &Keypair, mint: &Pubkey) -> Pubkey {
    let (programme, _) = programme_pda(&organizer.pubkey(), PROGRAMME_ID);
    let (vault, _) = vault_pda(&programme);
    let ix = Instruction::new_with_bytes(
        payday::id(),
        &payday::instruction::CreateProgramme {
            programme_id: PROGRAMME_ID,
            backend_key: Keypair::new().pubkey(),
            start_ts: now(svm) + 3600,
            day_len: DAY_LEN,
            days: DAYS as u8,
            max_participants: 30,
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
    programme
}

// Builds the add_trainer instruction. ONLY place that knows the argument list.
// If you remove the unused `trainer_key` argument from lib.rs, delete that one field here.
fn add_ix(
    organizer: &Pubkey,
    programme: &Pubkey,
    trainer_wallet: &Pubkey,
    programme_id: u64,
) -> Instruction {
    let (trainer, _) = trainer_pda(programme, trainer_wallet);
    Instruction::new_with_bytes(
        payday::id(),
        &payday::instruction::AddTrainer {
            programme_id,
        }
        .data(),
        payday::accounts::AddTrainer {
            organizer: *organizer,
            programme: *programme,
            trainer_wallet: *trainer_wallet,
            trainer,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    )
}

fn read_trainer(svm: &LiteSVM, pda: &Pubkey) -> Trainer {
    let acc = svm.get_account(pda).expect("trainer account must exist");
    let mut data: &[u8] = &acc.data;
    Trainer::try_deserialize(&mut data).unwrap()
}

struct World {
    svm: LiteSVM,
    organizer: Keypair,
    programme: Pubkey,
}

// A programme exists; no trainers yet.
fn world() -> World {
    let (mut svm, organizer, mint) = setup();
    let programme = create_ok(&mut svm, &organizer, &mint);
    World { svm, organizer, programme }
}

// ---------- tests ----------

#[test]
fn add_trainer_success() {
    let mut w = world();
    let wallet = Keypair::new().pubkey();
    let ix = add_ix(&w.organizer.pubkey(), &w.programme, &wallet, PROGRAMME_ID);
    send(&mut w.svm, ix, &w.organizer).expect("add_trainer must succeed");

    let (pda, bump) = trainer_pda(&w.programme, &wallet);
    let acc = w.svm.get_account(&pda).expect("trainer account must exist");
    assert_eq!(acc.owner, payday::id(), "account must be owned by the program");
    assert_eq!(acc.data.len(), TRAINER_ACCOUNT_BYTES, "size must be 73 bytes");
    let t = read_trainer(&w.svm, &pda);
    assert_eq!(t.programme, w.programme);
    assert_eq!(t.trainer, wallet);
    assert_eq!(t.bump, bump);
    // WHAT THIS PROVES: registering creates one 73-byte Trainer account, owned by the
    // program, that records this programme, this trainer wallet and its address bump.
}

#[test]
fn add_trainer_many_trainers_no_cap() {
    let mut w = world();
    let mut pdas = Vec::new();
    for _ in 0..3 {
        let wallet = Keypair::new().pubkey();
        let ix = add_ix(&w.organizer.pubkey(), &w.programme, &wallet, PROGRAMME_ID);
        send(&mut w.svm, ix, &w.organizer).expect("each registration must succeed");
        let (pda, _) = trainer_pda(&w.programme, &wallet);
        assert_eq!(read_trainer(&w.svm, &pda).trainer, wallet);
        pdas.push(pda);
    }
    assert!(pdas[0] != pdas[1] && pdas[1] != pdas[2] && pdas[0] != pdas[2]);
    // WHAT THIS PROVES: several different trainers can be registered for one programme,
    // each with its own Trainer account. The program stores no trainer count, so there is no cap.
}

#[test]
fn add_trainer_duplicate_rejected() {
    let mut w = world();
    let wallet = Keypair::new().pubkey();
    let ix = add_ix(&w.organizer.pubkey(), &w.programme, &wallet, PROGRAMME_ID);
    send(&mut w.svm, ix, &w.organizer).expect("first registration must succeed");

    let ix2 = add_ix(&w.organizer.pubkey(), &w.programme, &wallet, PROGRAMME_ID);
    let res = send(&mut w.svm, ix2, &w.organizer);
    match &res {
        Ok(_) => panic!("duplicate registration must fail"),
        Err(logs) => assert!(
            has(logs, "already in use"),
            "expected 'already in use'. Logs:\n{}",
            logs.join("\n")
        ),
    }
    println!("FIRED duplicate: account already in use");
    let (pda, _) = trainer_pda(&w.programme, &wallet);
    assert_eq!(read_trainer(&w.svm, &pda).trainer, wallet, "first registration untouched");
    // WHAT THIS PROVES: registering the same wallet twice fails because that Trainer
    // address already exists, so no duplicate check is needed in the program code.
}

#[test]
fn add_trainer_non_organizer_rejected() {
    let mut w = world();
    let stranger = Keypair::new();
    w.svm.airdrop(&stranger.pubkey(), 1_000_000_000).unwrap();
    let wallet = Keypair::new().pubkey();
    // The stranger signs as "organizer" and points at the REAL organizer's programme.
    let ix = add_ix(&stranger.pubkey(), &w.programme, &wallet, PROGRAMME_ID);
    let res = send(&mut w.svm, ix, &stranger);
    assert_rejected(&res, &["Unauthorized", "ConstraintSeeds"], "non-organizer");
    let (pda, _) = trainer_pda(&w.programme, &wallet);
    assert!(w.svm.get_account(&pda).is_none(), "no Trainer account may be created");
    // WHAT THIS PROVES: someone who is not this programme's organizer cannot register a
    // trainer, and nothing is created. The FIRED line says which check stopped them.
}

#[test]
fn add_trainer_wrong_programme_id_rejected() {
    let mut w = world();
    let wallet = Keypair::new().pubkey();
    let ix = add_ix(&w.organizer.pubkey(), &w.programme, &wallet, PROGRAMME_ID + 1);
    let res = send(&mut w.svm, ix, &w.organizer);
    assert_rejected(&res, &["ConstraintSeeds"], "wrong programme_id");
    let (pda, _) = trainer_pda(&w.programme, &wallet);
    assert!(w.svm.get_account(&pda).is_none(), "no Trainer account may be created");
    // WHAT THIS PROVES: the programme_id argument must match the programme's address seeds,
    // so a trainer cannot be registered against a programme id that does not match.
}

#[test]
fn add_trainer_allowed_after_event_started() {
    let mut w = world();
    let start_ts = START_TIME + 3600; // what create_ok used
    set_time(&mut w.svm, start_ts + DAY_LEN * 2); // day 3 of 5
    assert!(now(&w.svm) > start_ts);
    let wallet = Keypair::new().pubkey();
    let ix = add_ix(&w.organizer.pubkey(), &w.programme, &wallet, PROGRAMME_ID);
    send(&mut w.svm, ix, &w.organizer).expect("registration must work mid-event");
    let (pda, _) = trainer_pda(&w.programme, &wallet);
    assert_eq!(read_trainer(&w.svm, &pda).trainer, wallet);
    // WHAT THIS PROVES: a trainer can be added while the event is already running,
    // as the design requires.
}

#[test]
fn add_trainer_wallet_needs_no_signature_no_sol_and_organizer_pays_rent() {
    let mut w = world();
    let wallet = Keypair::new().pubkey(); // never airdropped, never signs
    assert!(w.svm.get_account(&wallet).is_none(), "wallet starts with no account at all");

    let before = w.svm.get_balance(&w.organizer.pubkey()).unwrap();
    let ix = add_ix(&w.organizer.pubkey(), &w.programme, &wallet, PROGRAMME_ID);
    send(&mut w.svm, ix, &w.organizer).expect("registration must succeed");
    let after = w.svm.get_balance(&w.organizer.pubkey()).unwrap();

    let rent = w.svm.minimum_balance_for_rent_exemption(TRAINER_ACCOUNT_BYTES);
    assert!(before - after >= rent, "organizer must pay at least the Trainer rent");
    assert!(w.svm.get_account(&wallet).is_none(), "trainer wallet is still untouched");
    // WHAT THIS PROVES: the trainer never has to sign or hold SOL to be registered; the
    // organizer alone pays the rent for the Trainer account (plus the transaction fee).
}
