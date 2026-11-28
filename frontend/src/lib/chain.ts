import {
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';
import { Buffer } from 'buffer';
import idl from '../idl/payday.idl.json';

export const PROGRAM_ID = new PublicKey((idl as { address: string }).address);
export const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
export const ATA_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');

// ── discriminators from IDL ──────────────────────────────────────────────────
function disc(name: string): Buffer {
  const instr = (idl as { instructions: { name: string; discriminator: number[] }[] })
    .instructions.find(x => x.name === name);
  if (!instr) throw new Error(`no discriminator for ${name}`);
  return Buffer.from(instr.discriminator);
}

// ── little-endian helpers ────────────────────────────────────────────────────
function u64(n: bigint): Buffer { const b = Buffer.alloc(8); b.writeBigUInt64LE(n); return b; }
function i64(n: bigint): Buffer { const b = Buffer.alloc(8); b.writeBigInt64LE(n); return b; }

// ── PDAs ─────────────────────────────────────────────────────────────────────
export function programmePda(organizer: PublicKey, programmeId: bigint): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('programme'), organizer.toBuffer(), u64(programmeId)],
    PROGRAM_ID,
  )[0];
}

export function vaultPda(programme: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('vault'), programme.toBuffer()],
    PROGRAM_ID,
  )[0];
}

export function trainerPda(programme: PublicKey, trainer: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('trainer'), programme.toBuffer(), trainer.toBuffer()],
    PROGRAM_ID,
  )[0];
}

// enrollment: trainee FIRST (matches API doc section 7 and devnet-checkin.ts)
export function enrollmentPda(trainee: PublicKey, programme: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('enrollment'), trainee.toBuffer(), programme.toBuffer()],
    PROGRAM_ID,
  )[0];
}

export function ataOf(owner: PublicKey, mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ATA_PROGRAM_ID,
  )[0];
}

// ── instruction builders ─────────────────────────────────────────────────────

// API doc section 7: create_programme
// organizer (S,W), programme (W), vault (W), mint, token program, system program
export function buildCreateProgramme(
  organizer: PublicKey,
  programmeId: bigint,
  backendKey: PublicKey,
  startTs: bigint,
  dayLen: bigint,
  days: number,
  maxParticipants: number,
  mint: PublicKey,
): Transaction {
  const programme = programmePda(organizer, programmeId);
  const vault = vaultPda(programme);
  const maxP = Buffer.alloc(2); maxP.writeUInt16LE(maxParticipants);
  const data = Buffer.concat([
    disc('create_programme'), u64(programmeId), backendKey.toBuffer(),
    i64(startTs), i64(dayLen), Buffer.from([days]), maxP,
  ]);
  const keys = [
    { pubkey: organizer, isSigner: true, isWritable: true },
    { pubkey: programme, isSigner: false, isWritable: true },
    { pubkey: vault, isSigner: false, isWritable: true },
    { pubkey: mint, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];
  const tx = new Transaction().add(new TransactionInstruction({ programId: PROGRAM_ID, keys, data }));
  tx.feePayer = organizer;
  return tx;
}

// API doc section 7: fund
// organizer (S), programme (W), organizer token account (W), vault (W), mint, token program
export function buildFund(
  organizer: PublicKey,
  programmeId: bigint,
  amount: bigint,
  mint: PublicKey,
): Transaction {
  const programme = programmePda(organizer, programmeId);
  const vault = vaultPda(programme);
  const orgAta = ataOf(organizer, mint);
  const data = Buffer.concat([disc('fund'), u64(programmeId), u64(amount)]);
  const keys = [
    { pubkey: organizer, isSigner: true, isWritable: false },
    { pubkey: programme, isSigner: false, isWritable: true },
    { pubkey: orgAta, isSigner: false, isWritable: true },
    { pubkey: vault, isSigner: false, isWritable: true },
    { pubkey: mint, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  ];
  const tx = new Transaction().add(new TransactionInstruction({ programId: PROGRAM_ID, keys, data }));
  tx.feePayer = organizer;
  return tx;
}

// API doc section 7: add_trainer
// organizer (S,W), programme (W), trainer wallet, trainer PDA (W), system program
export function buildAddTrainer(
  organizer: PublicKey,
  programmeId: bigint,
  trainerWallet: PublicKey,
): Transaction {
  const programme = programmePda(organizer, programmeId);
  const trainerAcc = trainerPda(programme, trainerWallet);
  const data = Buffer.concat([disc('add_trainer'), u64(programmeId)]);
  const keys = [
    { pubkey: organizer, isSigner: true, isWritable: true },
    { pubkey: programme, isSigner: false, isWritable: true },
    { pubkey: trainerWallet, isSigner: false, isWritable: false },
    { pubkey: trainerAcc, isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];
  const tx = new Transaction().add(new TransactionInstruction({ programId: PROGRAM_ID, keys, data }));
  tx.feePayer = organizer;
  return tx;
}

// API doc section 7: reclaim
// organizer (S), programme (W), vault (W), organizer token account (W), mint, token program
export function buildReclaim(
  organizer: PublicKey,
  programme: PublicKey,
  mint: PublicKey,
): Transaction {
  const vault = vaultPda(programme);
  const orgAta = ataOf(organizer, mint);
  const data = disc('reclaim');
  const keys = [
    { pubkey: organizer, isSigner: true, isWritable: false },
    { pubkey: programme, isSigner: false, isWritable: true },
    { pubkey: vault, isSigner: false, isWritable: true },
    { pubkey: orgAta, isSigner: false, isWritable: true },
    { pubkey: mint, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  ];
  const tx = new Transaction().add(new TransactionInstruction({ programId: PROGRAM_ID, keys, data }));
  tx.feePayer = organizer;
  return tx;
}

// API doc section 7: check_in
// trainer (S), trainee (S), programme (W), trainer PDA, enrollment PDA (W),
// vault (W), trainee token account (W), mint, token program
// trainer is fee payer and FIRST signer
export function buildCheckIn(
  trainer: PublicKey,
  trainee: PublicKey,
  programme: PublicKey,
  mint: PublicKey,
  day: number,
): Transaction {
  const trainerAcc = trainerPda(programme, trainer);
  const enr = enrollmentPda(trainee, programme);
  const vault = vaultPda(programme);
  const traineeAta = ataOf(trainee, mint);
  const data = Buffer.concat([disc('check_in'), Buffer.from([day])]);
  const keys = [
    { pubkey: trainer, isSigner: true, isWritable: false },
    { pubkey: trainee, isSigner: true, isWritable: false },
    { pubkey: programme, isSigner: false, isWritable: true },
    { pubkey: trainerAcc, isSigner: false, isWritable: false },
    { pubkey: enr, isSigner: false, isWritable: true },
    { pubkey: vault, isSigner: false, isWritable: true },
    { pubkey: traineeAta, isSigner: false, isWritable: true },
    { pubkey: mint, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  ];
  const tx = new Transaction().add(new TransactionInstruction({ programId: PROGRAM_ID, keys, data }));
  tx.feePayer = trainer;
  return tx;
}

// ── serialise / verify ───────────────────────────────────────────────────────

export function serialisePartial(tx: Transaction): string {
  return tx.serialize({ requireAllSignatures: false }).toString('base64');
}

const CHECK_IN_DISC = disc('check_in');

export function verifyRelayedTx(
  base64: string,
  opts: { programId: string; expectedDay: number; traineePubkey: string; programme: string; mint: string },
): { ok: true } | { ok: false; reason: string } {
  let tx: Transaction;
  try {
    tx = Transaction.from(Buffer.from(base64, 'base64'));
  } catch {
    return { ok: false, reason: 'cannot decode transaction' };
  }

  if (tx.instructions.length !== 1) {
    return { ok: false, reason: `expected 1 instruction, got ${tx.instructions.length}` };
  }

  const instr = tx.instructions[0];

  if (instr.programId.toBase58() !== opts.programId) {
    return { ok: false, reason: 'wrong program id' };
  }

  const data = instr.data;
  if (data.length < 9) {
    return { ok: false, reason: 'instruction data too short' };
  }

  for (let i = 0; i < 8; i++) {
    if (data[i] !== CHECK_IN_DISC[i]) {
      return { ok: false, reason: 'not a check_in instruction' };
    }
  }

  if (data[8] !== opts.expectedDay) {
    return { ok: false, reason: `wrong day: got ${data[8]}, expected ${opts.expectedDay}` };
  }

  const keys = instr.keys;
  if (keys.length !== 9) {
    return { ok: false, reason: `expected 9 accounts, got ${keys.length}` };
  }
  if (!keys[0].isSigner) {
    return { ok: false, reason: 'keys[0] (trainer) must be a signer' };
  }
  if (!keys[1].isSigner) {
    return { ok: false, reason: 'keys[1] (trainee) must be a signer' };
  }
  if (keys[1].pubkey.toBase58() !== opts.traineePubkey) {
    return { ok: false, reason: 'keys[1] trainee pubkey mismatch' };
  }
  if (keys[2].pubkey.toBase58() !== opts.programme) {
    return { ok: false, reason: 'keys[2] programme mismatch' };
  }

  const trainerKey = keys[0].pubkey;
  const traineeKey = keys[1].pubkey;
  const programmePubkey = new PublicKey(opts.programme);
  const mintPubkey = new PublicKey(opts.mint);

  const expectedTrainerPda = trainerPda(programmePubkey, trainerKey).toBase58();
  if (keys[3].pubkey.toBase58() !== expectedTrainerPda) {
    return { ok: false, reason: 'keys[3] trainer PDA mismatch' };
  }
  const expectedEnrollment = enrollmentPda(traineeKey, programmePubkey).toBase58();
  if (keys[4].pubkey.toBase58() !== expectedEnrollment) {
    return { ok: false, reason: 'keys[4] enrollment PDA mismatch' };
  }
  const expectedVault = vaultPda(programmePubkey).toBase58();
  if (keys[5].pubkey.toBase58() !== expectedVault) {
    return { ok: false, reason: 'keys[5] vault PDA mismatch' };
  }
  const expectedAta = ataOf(traineeKey, mintPubkey).toBase58();
  if (keys[6].pubkey.toBase58() !== expectedAta) {
    return { ok: false, reason: 'keys[6] trainee token account mismatch' };
  }
  if (keys[7].pubkey.toBase58() !== opts.mint) {
    return { ok: false, reason: 'keys[7] mint mismatch' };
  }
  if (keys[8].pubkey.toBase58() !== TOKEN_PROGRAM_ID.toBase58()) {
    return { ok: false, reason: 'keys[8] must be token program' };
  }

  return { ok: true };
}
