// Tests for fund.
// What these tests prove, in plain words:
//  - fund moves tokens from the organizer into the vault and records the total
//  - funding twice adds up (this is also the top-up path)
//  - zero amount, too-large amount, wrong signer, wrong accounts and a wrong
//    programme_id are all rejected, and no money moves in any of those cases
// Not covered yet: "fund after reclaim is rejected" (needs the reclaim instruction).
use {
    anchor_lang::{
        prelude::{Clock, Pubkey},
        solana_program::{instruction::Instruction, system_program},
        AccountDeserialize, InstructionData, ToAccountMetas,
    },
    litesvm::LiteSVM,
    litesvm_token::{CreateAssociatedTokenAccount, CreateMint, MintTo},
    payday::constants::{PROGRAMME_SEED, VAULT_SEED},
    payday::state::Programme,
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
};

const START_TIME: i64 = 1_800_000_000;
const PROGRAMME_ID: u64 = 1;
const ORG_TOKENS: u64 = 1_000_000_000; // 1000 tokens at 6 decimals

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

fn create_ok(svm: &mut LiteSVM, organizer: &Keypair, mint: &Pubkey) -> (Pubkey, Pubkey) {
    let (programme, _) = programme_pda(&organizer.pubkey(), PROGRAMME_ID);
    let (vault, _) = vault_pda(&programme);
    let ix = Instruction::new_with_bytes(
        payday::id(),
        &payday::instruction::CreateProgramme {
            programme_id: PROGRAMME_ID,
            backend_key: Keypair::new().pubkey(),
            start_ts: now(svm) + 3600,
            day_len: 86_400,
            days: 5,
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
    (programme, vault)
}

fn fund_ix(
    organizer: &Pubkey,
    programme: &Pubkey,
    org_ta: &Pubkey,
    vault: &Pubkey,
    mint: &Pubkey,
    programme_id: u64,
    amount: u64,
) -> Instruction {
    Instruction::new_with_bytes(
        payday::id(),
        &payday::instruction::Fund { programme_id, amount }.data(),
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

// SPL token account layout: the u64 amount sits at bytes 64..72.
fn tok_balance(svm: &LiteSVM, ta: &Pubkey) -> u64 {
    let acc = svm.get_account(ta).expect("token account must exist");
    u64::from_le_bytes(acc.data[64..72].try_into().unwrap())
}

fn total_funded(svm: &LiteSVM, programme: &Pubkey) -> u64 {
    let acc = svm.get_account(programme).expect("programme must exist");
    let mut data: &[u8] = &acc.data;
    Programme::try_deserialize(&mut data).unwrap().total_funded
}

struct World {
    svm: LiteSVM,
    organizer: Keypair,
    mint: Pubkey,
    programme: Pubkey,
    vault: Pubkey,
    org_ta: Pubkey,
}

// Programme created, organizer holds ORG_TOKENS, vault is empty.
fn world() -> World {
    let (mut svm, organizer, mint) = setup();
    let (programme, vault) = create_ok(&mut svm, &organizer, &mint);
    let org_ta = CreateAssociatedTokenAccount::new(&mut svm, &organizer, &mint)
        .owner(&organizer.pubkey())
        .send()
        .unwrap();
    MintTo::new(&mut svm, &organizer, &mint, &org_ta, ORG_TOKENS)
        .send()
        .unwrap();
    World { svm, organizer, mint, programme, vault, org_ta }
}

// A second person with SOL and some tokens, to play the attacker.
fn stranger(w: &mut World) -> (Keypair, Pubkey) {
    let s = Keypair::new();
    w.svm.airdrop(&s.pubkey(), 1_000_000_000).unwrap();
    let ta = CreateAssociatedTokenAccount::new(&mut w.svm, &w.organizer, &w.mint)
        .owner(&s.pubkey())
        .send()
        .unwrap();
    MintTo::new(&mut w.svm, &w.organizer, &w.mint, &ta, 500_000)
        .send()
        .unwrap();
    (s, ta)
}

fn assert_nothing_moved(w: &World) {
    assert_eq!(tok_balance(&w.svm, &w.vault), 0, "vault must still be empty");
    assert_eq!(tok_balance(&w.svm, &w.org_ta), ORG_TOKENS, "organizer balance must be unchanged");
    assert_eq!(total_funded(&w.svm, &w.programme), 0, "total_funded must still be 0");
}

// ---------- tests ----------

#[test]
fn fund_success() {
    let mut w = world();
    let amount = 400_000_000;
    let ix = fund_ix(&w.organizer.pubkey(), &w.programme, &w.org_ta, &w.vault, &w.mint, PROGRAMME_ID, amount);
    send(&mut w.svm, ix, &w.organizer).expect("fund must succeed");
    assert_eq!(tok_balance(&w.svm, &w.vault), amount);
    assert_eq!(tok_balance(&w.svm, &w.org_ta), ORG_TOKENS - amount);
    assert_eq!(total_funded(&w.svm, &w.programme), amount);
    // WHAT THIS PROVES: a normal fund call moves exactly `amount` tokens from the
    // organizer to the vault, and the Programme records the same number.
}

#[test]
fn fund_twice_adds_up() {
    let mut w = world();
    for amount in [100_000_000u64, 250_000_000u64] {
        let ix = fund_ix(&w.organizer.pubkey(), &w.programme, &w.org_ta, &w.vault, &w.mint, PROGRAMME_ID, amount);
        send(&mut w.svm, ix, &w.organizer).expect("fund must succeed");
    }
    assert_eq!(tok_balance(&w.svm, &w.vault), 350_000_000);
    assert_eq!(total_funded(&w.svm, &w.programme), 350_000_000);
    // WHAT THIS PROVES: funding can be repeated (the top-up path), and total_funded
    // keeps a running sum that matches the vault balance.
}

#[test]
fn fund_zero_rejected() {
    let mut w = world();
    let ix = fund_ix(&w.organizer.pubkey(), &w.programme, &w.org_ta, &w.vault, &w.mint, PROGRAMME_ID, 0);
    let res = send(&mut w.svm, ix, &w.organizer);
    assert_rejected(&res, &["ZeroAmount"], "zero amount");
    assert_nothing_moved(&w);
    // WHAT THIS PROVES: a zero amount is refused with ZeroAmount and nothing changes.
}

#[test]
fn fund_more_than_balance_fails() {
    let mut w = world();
    let ix = fund_ix(&w.organizer.pubkey(), &w.programme, &w.org_ta, &w.vault, &w.mint, PROGRAMME_ID, ORG_TOKENS + 1);
    let res = send(&mut w.svm, ix, &w.organizer);
    assert!(res.is_err(), "funding more than the organizer holds must fail");
    assert_nothing_moved(&w);
    // WHAT THIS PROVES: you cannot put more into the vault than you own; the token
    // program refuses, and neither the vault nor total_funded changes.
}

#[test]
fn fund_non_organizer_rejected() {
    let mut w = world();
    let (s, s_ta) = stranger(&mut w);
    let ix = fund_ix(&s.pubkey(), &w.programme, &s_ta, &w.vault, &w.mint, PROGRAMME_ID, 100_000);
    let res = send(&mut w.svm, ix, &s);
    // Either check can stop it first: has_one (Unauthorized) or the seeds check.
    assert_rejected(&res, &["Unauthorized", "ConstraintSeeds"], "non-organizer");
    assert_nothing_moved(&w);
    assert_eq!(tok_balance(&w.svm, &s_ta), 500_000, "stranger's tokens untouched");
    // WHAT THIS PROVES: someone who is not this programme's organizer cannot fund it,
    // even with their own valid tokens. The printed FIRED line says which check caught it.
}

#[test]
fn fund_from_someone_elses_token_account_rejected() {
    let mut w = world();
    let (_s, s_ta) = stranger(&mut w);
    let ix = fund_ix(&w.organizer.pubkey(), &w.programme, &s_ta, &w.vault, &w.mint, PROGRAMME_ID, 100_000);
    let res = send(&mut w.svm, ix, &w.organizer);
    assert_rejected(&res, &["ConstraintTokenOwner"], "foreign source account");
    assert_nothing_moved(&w);
    // WHAT THIS PROVES: the source token account must be owned by the organizer who
    // signs, so nobody can name another person's token account as the source.
}

#[test]
fn fund_wrong_mint_token_account_rejected() {
    let mut w = world();
    let other_mint = CreateMint::new(&mut w.svm, &w.organizer).decimals(6).send().unwrap();
    let other_ta = CreateAssociatedTokenAccount::new(&mut w.svm, &w.organizer, &other_mint)
        .owner(&w.organizer.pubkey())
        .send()
        .unwrap();
    MintTo::new(&mut w.svm, &w.organizer, &other_mint, &other_ta, 1_000_000)
        .send()
        .unwrap();
    let ix = fund_ix(&w.organizer.pubkey(), &w.programme, &other_ta, &w.vault, &w.mint, PROGRAMME_ID, 100_000);
    let res = send(&mut w.svm, ix, &w.organizer);
    assert_rejected(&res, &["ConstraintTokenMint"], "wrong mint");
    assert_nothing_moved(&w);
    assert_eq!(tok_balance(&w.svm, &other_ta), 1_000_000);
    // WHAT THIS PROVES: tokens of a different mint cannot be funded into this
    // programme's vault; the source must hold the programme's mint.
}

#[test]
fn fund_wrong_vault_rejected() {
    let mut w = world();
    let (_s, s_ta) = stranger(&mut w);
    // Pass the stranger's token account where the vault should be.
    let ix = fund_ix(&w.organizer.pubkey(), &w.programme, &w.org_ta, &s_ta, &w.mint, PROGRAMME_ID, 100_000);
    let res = send(&mut w.svm, ix, &w.organizer);
    assert_rejected(&res, &["ConstraintSeeds", "ConstraintTokenOwner"], "wrong vault");
    assert_nothing_moved(&w);
    assert_eq!(tok_balance(&w.svm, &s_ta), 500_000, "stranger's account got nothing");
    // WHAT THIS PROVES: money can only go into this programme's own vault, not into
    // any other token account someone puts in the vault slot.
}

#[test]
fn fund_wrong_programme_id_rejected() {
    let mut w = world();
    let ix = fund_ix(&w.organizer.pubkey(), &w.programme, &w.org_ta, &w.vault, &w.mint, PROGRAMME_ID + 1, 100_000);
    let res = send(&mut w.svm, ix, &w.organizer);
    assert_rejected(&res, &["ConstraintSeeds"], "wrong programme_id");
    assert_nothing_moved(&w);
    // WHAT THIS PROVES: the programme_id argument must match the programme's address
    // seeds, so you cannot point fund at a programme under a different id.
}
