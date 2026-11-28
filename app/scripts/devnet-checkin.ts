import fs from 'node:fs';
import os from 'node:os';
import {
  Connection, Keypair, PublicKey, SystemProgram, Transaction,
  TransactionInstruction, sendAndConfirmTransaction, LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import bs58 from 'bs58';
import idl from '../src/chain/payday.idl.json' with { type: 'json' };
import { RealChain } from '../src/chain/real.js';

const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ATA_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const programId = new PublicKey((idl as any).address);
const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
const connection = new Connection(rpcUrl, 'confirmed');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const nowSec = () => Math.floor(Date.now() / 1000);

const errNames: Record<number, string> = {};
for (const e of (idl as any).errors || []) errNames[e.code] = e.name;

let pass = 0, fail = 0;
function verdict(label: string, ok: boolean, detail = '') {
  console.log(`${label}: ${ok ? 'OK' : 'FAIL'}${detail ? ' (' + detail + ')' : ''}`);
  ok ? pass++ : fail++;
}
function fatal(label: string, err: any): never {
  console.log(`${label}: FATAL ${err?.message ?? err}`);
  if (err?.logs) err.logs.slice(-5).forEach((l: string) => console.log('  ' + l));
  console.log(`SUMMARY: pass=${pass} fail=${fail + 1} (aborted)`);
  process.exit(1);
}

const disc = (name: string) =>
  Buffer.from((idl as any).instructions.find((x: any) => x.name === name).discriminator);
const u64 = (n: bigint) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(n); return b; };
const i64 = (n: bigint) => { const b = Buffer.alloc(8); b.writeBigInt64LE(n); return b; };
const ataOf = (owner: PublicKey, mint: PublicKey) =>
  PublicKey.findProgramAddressSync([owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()], ATA_PROGRAM_ID)[0];

function nameOf(err: any, logs: string[] = []): string {
  for (const l of logs) { const m = /Error Code: (\w+)/.exec(l); if (m) return m[1]; }
  const ie = err?.InstructionError;
  if (ie) {
    const c = ie[1];
    if (c && typeof c === 'object' && 'Custom' in c) return errNames[c.Custom] ?? 'Custom' + c.Custom;
    return typeof c === 'string' ? c : JSON.stringify(c);
  }
  return typeof err === 'string' ? err : JSON.stringify(err);
}

async function sim(mk: () => Transaction, signers: Keypair[]) {
  const r = await connection.simulateTransaction(mk(), signers);
  const logs = r.value.logs ?? [];
  return { err: r.value.err, name: r.value.err ? nameOf(r.value.err, logs) : null, logs };
}
async function expectOk(label: string, mk: () => Transaction, signers: Keypair[], detail = ''): Promise<boolean> {
  const s = await sim(mk, signers);
  if (s.err) {
    verdict(label, false, 'rejected: ' + s.name);
    s.logs.slice(-4).forEach((l) => console.log('   ' + l));
    return false;
  }
  try {
    const sig = await sendAndConfirmTransaction(connection, mk(), signers);
    verdict(label, true, (detail ? detail + ', ' : '') + 'tx ' + sig.slice(0, 12) + '...');
    return true;
  } catch (e: any) {
    verdict(label, false, 'send failed: ' + (e?.message ?? e));
    return false;
  }
}
async function expectFail(label: string, mk: () => Transaction, signers: Keypair[], expected: string | null) {
  const s = await sim(mk, signers);
  if (!s.err) return verdict(label, false, 'unexpectedly succeeded');
  const ok = expected ? s.name === expected : true;
  verdict(label, ok, 'rejected: ' + s.name + (expected && !ok ? ', expected ' + expected : ''));
}
async function tokBal(a: PublicKey): Promise<bigint> {
  try { return BigInt((await connection.getTokenAccountBalance(a)).value.amount); } catch { return 0n; }
}

async function main() {
  if (process.env.DEVNET !== '1') { console.error('DEVNET must be 1'); process.exit(1); }

  const organizer = Keypair.fromSecretKey(Uint8Array.from(
    JSON.parse(fs.readFileSync(process.env.ORGANIZER_KEYPAIR || os.homedir() + '/.config/solana/id.json', 'utf8'))));

  const AMT = 100000n, DAYS = 2, DAYLEN = 90n, FUND = 1000000n;

  // ---- preflight: SOL and mint
  const orgSol = await connection.getBalance(organizer.publicKey);
  if (orgSol < 0.15 * LAMPORTS_PER_SOL) {
    console.log(`Organizer has only ${orgSol / LAMPORTS_PER_SOL} SOL; need 0.15. Run: solana airdrop 2`);
    process.exit(1);
  }
  let mint: PublicKey;
  if (process.env.MINT) {
    mint = new PublicKey(process.env.MINT);
  } else {
    const r = await connection.getParsedTokenAccountsByOwner(organizer.publicKey, { programId: TOKEN_PROGRAM_ID });
    const cands = r.value.filter((a: any) => BigInt(a.account.data.parsed.info.tokenAmount.amount) >= FUND);
    if (cands.length !== 1) {
      console.log('Set MINT=<mint>. Organizer token accounts:');
      r.value.forEach((a: any) => console.log('  ', a.account.data.parsed.info.mint, a.account.data.parsed.info.tokenAmount.amount));
      process.exit(1);
    }
    mint = new PublicKey((cands[0] as any).account.data.parsed.info.mint);
  }
  const orgAta = ataOf(organizer.publicKey, mint);
  const orgTok = await tokBal(orgAta);
  if (orgTok < FUND) { console.log(`Organizer token balance ${orgTok} < ${FUND}`); process.exit(1); }
  console.log(`mint ${mint.toBase58()}  organizer tokens ${orgTok}  organizer SOL ${orgSol / LAMPORTS_PER_SOL}`);

  const backend = Keypair.generate();
  const trainer = Keypair.generate();
  const unreg = Keypair.generate();
  const t1 = Keypair.generate(); // never funded with SOL
  const t2 = Keypair.generate(); // small SOL control
  const t3 = Keypair.generate(); // absent
  const t4 = trainer;            // trainer's own wallet, for TrainerIsTrainee

  // ---- SOL funding (t1, t3 get none)
  try {
    const tx = new Transaction();
    const give = (to: PublicKey, sol: number) =>
      tx.add(SystemProgram.transfer({ fromPubkey: organizer.publicKey, toPubkey: to, lamports: Math.round(sol * LAMPORTS_PER_SOL) }));
    give(backend.publicKey, 0.05); give(trainer.publicKey, 0.03); give(unreg.publicKey, 0.01); give(t2.publicKey, 0.005);
    await sendAndConfirmTransaction(connection, tx, [organizer]);
    console.log('setup: SOL funded (T1 and T3 deliberately get none)');
  } catch (e) { fatal('setup SOL', e); }

  // ---- create_programme
  const pid = BigInt(Date.now());
  const pidBuf = u64(pid);
  const [programme] = PublicKey.findProgramAddressSync(
    [Buffer.from('programme'), organizer.publicKey.toBuffer(), pidBuf], programId);
  const [vault] = PublicKey.findProgramAddressSync([Buffer.from('vault'), programme.toBuffer()], programId);
  const startTs = BigInt(nowSec() + 90);
  const endTs = startTs + BigInt(DAYS) * DAYLEN;
  try {
    const maxP = Buffer.alloc(2); maxP.writeUInt16LE(5);
    const data = Buffer.concat([disc('create_programme'), pidBuf, backend.publicKey.toBuffer(),
      i64(startTs), i64(DAYLEN), Buffer.from([DAYS]), maxP]);
    const keys = [
      { pubkey: organizer.publicKey, isSigner: true, isWritable: true },
      { pubkey: programme, isSigner: false, isWritable: true },
      { pubkey: vault, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ];
    await sendAndConfirmTransaction(connection, new Transaction().add(new TransactionInstruction({ programId, keys, data })), [organizer]);
    verdict('create_programme', true, programme.toBase58());
  } catch (e) { fatal('create_programme', e); }

  // ---- fund
  try {
    const data = Buffer.concat([disc('fund'), pidBuf, u64(FUND)]);
    const keys = [
      { pubkey: organizer.publicKey, isSigner: true, isWritable: false },
      { pubkey: programme, isSigner: false, isWritable: true },
      { pubkey: orgAta, isSigner: false, isWritable: true },
      { pubkey: vault, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ];
    await sendAndConfirmTransaction(connection, new Transaction().add(new TransactionInstruction({ programId, keys, data })), [organizer]);
    const vb = await tokBal(vault);
    verdict('fund', vb === FUND, `vault ${vb}`);
  } catch (e) { fatal('fund', e); }

  // ---- add_trainer
  const [trainerAcc] = PublicKey.findProgramAddressSync(
    [Buffer.from('trainer'), programme.toBuffer(), trainer.publicKey.toBuffer()], programId);
  try {
    const data = Buffer.concat([disc('add_trainer'), pidBuf]);
    const keys = [
      { pubkey: organizer.publicKey, isSigner: true, isWritable: true },
      { pubkey: programme, isSigner: false, isWritable: true },
      { pubkey: trainer.publicKey, isSigner: false, isWritable: false },
      { pubkey: trainerAcc, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ];
    await sendAndConfirmTransaction(connection, new Transaction().add(new TransactionInstruction({ programId, keys, data })), [organizer]);
  } catch (e) { fatal('add_trainer', e); }

  const chain = new RealChain({
    connection,
    feePayerSecretKey: bs58.encode(backend.secretKey),
    backendKeySecretKey: bs58.encode(backend.secretKey),
    programId: programId.toBase58(),
    programmeAddress: programme.toBase58(),
  });
  verdict('add_trainer', await chain.isTrainerRegistered(trainer.publicKey.toBase58()), 'isTrainerRegistered');
  verdict('unregistered wallet reads as not registered', !(await chain.isTrainerRegistered(unreg.publicKey.toBase58())));

  // ---- enroll four wallets
  for (const [n, kp] of [['T1 never-funded', t1], ['T2 control', t2], ['T3 absent', t3], ['T4 trainer wallet', t4]] as const) {
    try { await chain.enroll(kp.publicKey.toBase58(), Array(DAYS).fill(AMT)); }
    catch (e) { fatal('enroll ' + n, e); }
  }
  const p0 = await chain.getProgramme();
  verdict('enroll x4', p0?.enrolled === 4 && p0?.committed === 800000n, `enrolled ${p0?.enrolled}, committed ${p0?.committed}`);

  // ---- check_in builder
  const checkInTx = (tr: Keypair, te: Keypair, day: number) => () => {
    const [trAcc] = PublicKey.findProgramAddressSync(
      [Buffer.from('trainer'), programme.toBuffer(), tr.publicKey.toBuffer()], programId);
    const [enr] = PublicKey.findProgramAddressSync(
      [Buffer.from('enrollment'), te.publicKey.toBuffer(), programme.toBuffer()], programId);
    const keys = [
      { pubkey: tr.publicKey, isSigner: true, isWritable: false },
      { pubkey: te.publicKey, isSigner: true, isWritable: false },
      { pubkey: programme, isSigner: false, isWritable: true },
      { pubkey: trAcc, isSigner: false, isWritable: false },
      { pubkey: enr, isSigner: false, isWritable: true },
      { pubkey: vault, isSigner: false, isWritable: true },
      { pubkey: ataOf(te.publicKey, mint), isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ];
    const tx = new Transaction().add(new TransactionInstruction({
      programId, keys, data: Buffer.concat([disc('check_in'), Buffer.from([day])]) }));
    tx.feePayer = tr.publicKey; // trainer pays the fee, first signer
    return tx;
  };
  const reclaimTx = () => {
    const keys = [
      { pubkey: organizer.publicKey, isSigner: true, isWritable: false },
      { pubkey: programme, isSigner: false, isWritable: true },
      { pubkey: vault, isSigner: false, isWritable: true },
      { pubkey: orgAta, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ];
    const tx = new Transaction().add(new TransactionInstruction({ programId, keys, data: disc('reclaim') }));
    tx.feePayer = organizer.publicKey;
    return tx;
  };

  // ---- before start
  if (nowSec() < Number(startTs) - 3) {
    await expectFail('check_in before start rejected', checkInTx(trainer, t1, 0), [trainer, t1], 'NotStarted');
  } else console.log('check_in before start: SKIPPED (setup took too long)');
  await expectFail('reclaim before end rejected', reclaimTx, [organizer], 'EventNotOver');

  // ---- wait for start
  console.log(`waiting for start (${Number(startTs) - nowSec()}s)...`);
  for (let i = 0; i < 60; i++) {
    if (nowSec() >= Number(startTs) + 2) {
      const s = await sim(checkInTx(trainer, t1, 0), [trainer, t1]);
      if (s.name !== 'NotStarted') break;
    }
    await sleep(2000);
  }

  // ---- real check-ins (day 0)
  const t1SolBefore = await connection.getBalance(t1.publicKey);
  const ok1 = await expectOk('check_in T1 (never-funded trainee, trainer pays fee)', checkInTx(trainer, t1, 0), [trainer, t1]);
  verdict('T1 had 0 SOL and still signed', ok1 && t1SolBefore === 0, `T1 SOL ${t1SolBefore} -> ${await connection.getBalance(t1.publicKey)}`);
  await expectOk('check_in T2 (control, funded trainee)', checkInTx(trainer, t2, 0), [trainer, t2]);

  const b1 = await tokBal(ataOf(t1.publicKey, mint)), b2 = await tokBal(ataOf(t2.publicKey, mint));
  verdict('check_in pays right amount', b1 === AMT && b2 === AMT, `T1 ${b1}, T2 ${b2}, expected ${AMT}`);
  const p1 = await chain.getProgramme();
  verdict('programme totals after check-ins', p1?.totalPaid === 2n * AMT && p1?.committed === 600000n,
    `paid ${p1?.totalPaid}, committed ${p1?.committed}`);
  verdict('vault balance after check-ins', (await tokBal(vault)) === FUND - 2n * AMT, `${await tokBal(vault)}`);

  // ---- negatives (simulated, no fees, no state change)
  await expectFail('repeat check_in same day rejected', checkInTx(trainer, t1, 0), [trainer, t1], 'AlreadyCheckedIn');
  await expectFail('wrong day rejected', checkInTx(trainer, t3, 1), [trainer, t3], 'WrongDay');
  await expectFail('unregistered trainer rejected', checkInTx(unreg, t3, 0), [unreg, t3], null);
  await expectFail('trainer == trainee rejected', checkInTx(trainer, t4, 0), [trainer], 'TrainerIsTrainee');
  const orgBefore = await tokBal(orgAta);

  // ---- wait for end, reclaim
  console.log(`waiting for end (${Number(endTs) - nowSec()}s)...`);
  for (let i = 0; i < 150; i++) {
    if (nowSec() >= Number(endTs) + 2) {
      const s = await sim(reclaimTx, [organizer]);
      if (s.name !== 'EventNotOver') break;
    }
    await sleep(2000);
  }
  await expectOk('reclaim after end', reclaimTx, [organizer]);
  const orgAfter = await tokBal(orgAta);
  const vEnd = await tokBal(vault);
  const p2 = await chain.getProgramme();
  verdict('reclaim returns the unpaid money', orgAfter - orgBefore === FUND - 2n * AMT, `organizer +${orgAfter - orgBefore}, expected +${FUND - 2n * AMT}`);
  verdict('vault empty after reclaim', vEnd === 0n, `${vEnd}`);
  verdict('programme marked reclaimed', p2?.reclaimed === true, `reclaimed=${p2?.reclaimed}, totalReclaimed=${p2?.totalReclaimed}`);
  await expectFail('second reclaim rejected', reclaimTx, [organizer], null);

  console.log(`\nprogramme: ${programme.toBase58()}`);
  console.log(`SUMMARY: pass=${pass} fail=${fail}`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => fatal('unhandled', e));
