// scripts/check-lib.ts  –  run with: npx tsx scripts/check-lib.ts
import { Buffer } from 'buffer';
(globalThis as unknown as Record<string, unknown>).Buffer = Buffer;

// Polyfill WebCrypto for Node (Node 18+ has it on globalThis already, but be safe)
import { webcrypto } from 'node:crypto';
if (!globalThis.crypto) (globalThis as unknown as Record<string, unknown>).crypto = webcrypto;

import { formatAmount, currentDay } from '../src/lib/format.js';
import { explain } from '../src/lib/errors.js';
import { encryptKey, decryptKey, createWallet } from '../src/lib/keys.js';
import {
  buildCheckIn, verifyRelayedTx, serialisePartial,
  PROGRAM_ID,
} from '../src/lib/chain.js';
import { PublicKey, Keypair } from '@solana/web3.js';

let pass = 0, fail = 0;
function check(label: string, ok: boolean, detail = '') {
  if (ok) { console.log(`${label}: OK`); pass++; }
  else { console.log(`${label}: FAIL${detail ? ' – ' + detail : ''}`); fail++; }
}

// ── format ───────────────────────────────────────────────────────────────────
check('format: zero decimals', formatAmount('1000000', 0) === '1,000,000');
check('format: 6 decimals', formatAmount('1000000', 6) === '1');
check('format: 6 decimals fractional', formatAmount('1500000', 6) === '1.5');
check('format: bigint input', formatAmount(123456789n, 2) === '1,234,567.89');
check('format: zero value', formatAmount('0', 6) === '0');

// ── currentDay ───────────────────────────────────────────────────────────────
check('currentDay: before start returns 0', currentDay(1000, 2000, 86400) === 0);
check('currentDay: at start returns 0', currentDay(2000, 2000, 86400) === 0);
check('currentDay: day 1', currentDay(2000 + 86400, 2000, 86400) === 1);
check('currentDay: day 2', currentDay(2000 + 86400 * 2 + 1, 2000, 86400) === 2);

// ── errors: every program error 6000..6016 ───────────────────────────────────
const programErrors = [
  'InvalidDays', 'InvalidDayLength', 'StartInPast', 'InvalidCapacity',
  'Unauthorized', 'InvalidBackend', 'MathOverflow', 'ProgrammeClosed',
  'ProgrammeFull', 'ZeroAmount', 'WrongScheduleLength', 'InsufficientFunding',
  'TrainerIsTrainee', 'NotStarted', 'WrongDay', 'AlreadyCheckedIn', 'EventNotOver',
];
const generic = explain('__unknown_xyz__');
for (const code of programErrors) {
  const msg = explain(code);
  check(`errors: ${code}`, msg !== generic && msg.length > 0, msg);
}
check('errors: AccountNotInitialized', explain('AccountNotInitialized') !== generic);
check('errors: unknown code gets generic', generic.length > 0);

// ── keys: encrypt/decrypt round trip ─────────────────────────────────────────
const kp = createWallet();
check('keys: createWallet returns 64-byte secret', kp.secretKey.length === 64);

const blob = await encryptKey(kp.secretKey, '123456');
check('keys: blob is string', typeof blob === 'string');
check('keys: blob <= 2048 chars', blob.length <= 2048, `length=${blob.length}`);

const recovered = await decryptKey(blob, '123456');
check('keys: round trip matches', recovered.every((b, i) => b === kp.secretKey[i]));

let wrongPinThrew = false;
try { await decryptKey(blob, 'wrong'); }
catch (e) { wrongPinThrew = (e as Error).message === 'wrong_pin'; }
check('keys: wrong PIN throws wrong_pin', wrongPinThrew);

// ── chain: buildCheckIn produces 9 accounts, first two are signers ────────────
const trainer = Keypair.generate();
const trainee = Keypair.generate();
const mint = Keypair.generate().publicKey;
// Use a dummy programme address (any valid pubkey)
const programme = Keypair.generate().publicKey;

const tx = buildCheckIn(trainer.publicKey, trainee.publicKey, programme, mint, 0);
const instr = tx.instructions[0];
check('chain: buildCheckIn has 9 accounts', instr.keys.length === 9);
check('chain: first account is signer (trainer)', instr.keys[0].isSigner === true);
check('chain: second account is signer (trainee)', instr.keys[1].isSigner === true);
check('chain: feePayer is trainer', tx.feePayer?.toBase58() === trainer.publicKey.toBase58());

// ── verifyRelayedTx ──────────────────────────────────────────────────────────
import { ataOf, vaultPda, trainerPda, enrollmentPda } from '../src/lib/chain.js';

tx.recentBlockhash = PublicKey.default.toBase58();
tx.sign(trainer);
const b64 = serialisePartial(tx);

const verifyOpts = {
  programId: PROGRAM_ID.toBase58(),
  expectedDay: 0,
  traineePubkey: trainee.publicKey.toBase58(),
  programme: programme.toBase58(),
  mint: mint.toBase58(),
};

const good = verifyRelayedTx(b64, verifyOpts);
check('chain: verifyRelayedTx accepts correct tx', good.ok === true,
  good.ok ? '' : (good as { ok: false; reason: string }).reason);

const wrongDay = verifyRelayedTx(b64, { ...verifyOpts, expectedDay: 1 });
check('chain: verifyRelayedTx rejects wrong day', wrongDay.ok === false);

// wrong destination token account: build a tx with a different mint so ataOf differs
const otherMint = Keypair.generate().publicKey;
const txWrongAta = buildCheckIn(trainer.publicKey, trainee.publicKey, programme, otherMint, 0);
txWrongAta.recentBlockhash = PublicKey.default.toBase58();
txWrongAta.sign(trainer);
const b64WrongAta = serialisePartial(txWrongAta);
const wrongAta = verifyRelayedTx(b64WrongAta, verifyOpts); // opts still has original mint
check('chain: verifyRelayedTx rejects wrong token account', wrongAta.ok === false);

// wrong mint: tx has correct ata for original mint, but opts says a different mint
const wrongMintResult = verifyRelayedTx(b64, { ...verifyOpts, mint: otherMint.toBase58() });
check('chain: verifyRelayedTx rejects wrong mint', wrongMintResult.ok === false);

// wrong programme: opts says a different programme pubkey
const otherProgramme = Keypair.generate().publicKey;
const wrongProg = verifyRelayedTx(b64, { ...verifyOpts, programme: otherProgramme.toBase58() });
check('chain: verifyRelayedTx rejects wrong programme', wrongProg.ok === false);

// ── summary ───────────────────────────────────────────────────────────────────
console.log(`\nSUMMARY: pass=${pass} fail=${fail}`);
process.exit(fail > 0 ? 1 : 0);
