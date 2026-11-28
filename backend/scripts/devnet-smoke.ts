import fs from 'node:fs';
import os from 'node:os';
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import bs58 from 'bs58';
import idl from '../src/chain/payday.idl.json' with { type: 'json' };
import { RealChain } from '../src/chain/real.js';
import { ChainError } from '../src/chain/interface.js';

async function main() {
  if (process.env.DEVNET !== '1' || !process.env.MINT) {
    console.error('DEVNET must be 1 and MINT must be provided');
    process.exit(1);
  }

  const mintPubkey = new PublicKey(process.env.MINT);
  const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
  const connection = new Connection(rpcUrl, 'confirmed');

  const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
  const ATA_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
  const programId = new PublicKey((idl as any).address);

  let failedSteps = 0;

  function printFail(stepNum: number, err: any) {
    failedSteps++;
    const code = err?.code ?? err?.name ?? 'UnknownError';
    const msg = err?.message ?? String(err);
    console.log(`STEP ${stepNum} FAIL ${code}: ${msg}`);
    if (err?.logs && Array.isArray(err.logs)) {
      const lastLogs = err.logs.slice(-5);
      console.log('--- Last 5 logs ---');
      lastLogs.forEach((l: string) => console.log(l));
      console.log('-------------------');
    }
  }

  // -------------------------------------------------------------
  // STEP 1: Organizer keypair & backend keypair transfer
  // -------------------------------------------------------------
  let organizerKeypair: Keypair | null = null;
  let backendKeypair: Keypair | null = null;

  try {
    const orgPath = process.env.ORGANIZER_KEYPAIR || (os.homedir() + '/.config/solana/id.json');
    const orgRaw = JSON.parse(fs.readFileSync(orgPath, 'utf8'));
    organizerKeypair = Keypair.fromSecretKey(Uint8Array.from(orgRaw));

    backendKeypair = Keypair.generate();
    fs.writeFileSync('/tmp/payday-smoke-backend.json', JSON.stringify(Array.from(backendKeypair.secretKey)));

    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: organizerKeypair.publicKey,
        toPubkey: backendKeypair.publicKey,
        lamports: 0.3 * LAMPORTS_PER_SOL,
      }),
    );
    const sig = await sendAndConfirmTransaction(connection, tx, [organizerKeypair]);
    console.log(`STEP 1 OK (transfer tx: ${sig})`);
  } catch (err: any) {
    printFail(1, err);
  }

  // -------------------------------------------------------------
  // STEP 2: create_programme on devnet
  // -------------------------------------------------------------
  let programmePda: PublicKey | null = null;
  let programmeIdU64 = BigInt(Date.now());

  try {
    if (!organizerKeypair || !backendKeypair) throw new Error('Missing keypairs from step 1');

    const pidBuf = Buffer.alloc(8);
    pidBuf.writeBigUInt64LE(programmeIdU64, 0);

    const [progPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('programme'), organizerKeypair.publicKey.toBuffer(), pidBuf],
      programId,
    );
    programmePda = progPda;

    const [vaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('vault'), programmePda.toBuffer()],
      programId,
    );

    const cpDef = (idl as any).instructions.find((x: any) => x.name === 'create_programme');
    const disc = Buffer.from(cpDef.discriminator);

    const startTs = BigInt(Math.floor(Date.now() / 1000) + 300);
    const dayLen = 3600n;
    const days = 3;
    const maxParticipants = 5;

    const startTsBuf = Buffer.alloc(8);
    startTsBuf.writeBigInt64LE(startTs, 0);

    const dayLenBuf = Buffer.alloc(8);
    dayLenBuf.writeBigInt64LE(dayLen, 0);

    const daysBuf = Buffer.alloc(1);
    daysBuf.writeUInt8(days, 0);

    const maxPartBuf = Buffer.alloc(2);
    maxPartBuf.writeUInt16LE(maxParticipants, 0);

    const data = Buffer.concat([
      disc,
      pidBuf,
      backendKeypair.publicKey.toBuffer(),
      startTsBuf,
      dayLenBuf,
      daysBuf,
      maxPartBuf,
    ]);

    const keys = [
      { pubkey: organizerKeypair.publicKey, isSigner: true, isWritable: true },
      { pubkey: programmePda, isSigner: false, isWritable: true },
      { pubkey: vaultPda, isSigner: false, isWritable: true },
      { pubkey: mintPubkey, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ];

    const ix = new TransactionInstruction({ programId, keys, data });
    const tx = new Transaction().add(ix);
    const sig = await sendAndConfirmTransaction(connection, tx, [organizerKeypair]);
    console.log(`STEP 2 OK (programme: ${programmePda.toBase58()}, tx: ${sig})`);
  } catch (err: any) {
    printFail(2, err);
  }

  // -------------------------------------------------------------
  // STEP 3: fund programme with 3000000
  // -------------------------------------------------------------
  try {
    if (!organizerKeypair || !programmePda) throw new Error('Missing organizer or programme PDA');

    const [vaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('vault'), programmePda.toBuffer()],
      programId,
    );

    const [organizerAta] = PublicKey.findProgramAddressSync(
      [organizerKeypair.publicKey.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mintPubkey.toBuffer()],
      ATA_PROGRAM_ID,
    );

    const fundDef = (idl as any).instructions.find((x: any) => x.name === 'fund');
    const disc = Buffer.from(fundDef.discriminator);

    const pidBuf = Buffer.alloc(8);
    pidBuf.writeBigUInt64LE(programmeIdU64, 0);

    const amountBuf = Buffer.alloc(8);
    amountBuf.writeBigUInt64LE(3000000n, 0);

    const data = Buffer.concat([disc, pidBuf, amountBuf]);

    const keys = [
      { pubkey: organizerKeypair.publicKey, isSigner: true, isWritable: false },
      { pubkey: programmePda, isSigner: false, isWritable: true },
      { pubkey: organizerAta, isSigner: false, isWritable: true },
      { pubkey: vaultPda, isSigner: false, isWritable: true },
      { pubkey: mintPubkey, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ];

    const ix = new TransactionInstruction({ programId, keys, data });
    const tx = new Transaction().add(ix);
    const sig = await sendAndConfirmTransaction(connection, tx, [organizerKeypair]);
    console.log(`STEP 3 OK (funded 3000000, tx: ${sig})`);
  } catch (err: any) {
    printFail(3, err);
  }

  // -------------------------------------------------------------
  // STEP 4: Build RealChain and check backendKey & vault balance
  // -------------------------------------------------------------
  let chain: RealChain | null = null;
  try {
    if (!backendKeypair || !programmePda) throw new Error('Missing backend keypair or programme PDA');

    const b58Secret = bs58.encode(backendKeypair.secretKey);
    chain = new RealChain({
      connection,
      feePayerSecretKey: b58Secret,
      backendKeySecretKey: b58Secret,
      programId: programId.toBase58(),
      programmeAddress: programmePda.toBase58(),
    });

    const prog = await chain.getProgramme();
    if (!prog) throw new Error('getProgramme returned null');
    if (prog.backendKey !== backendKeypair.publicKey.toBase58()) {
      throw new Error(`backendKey mismatch: got ${prog.backendKey}, expected ${backendKeypair.publicKey.toBase58()}`);
    }

    const vBal = await chain.getVaultBalance();
    if (vBal !== 3000000n) {
      throw new Error(`Vault balance mismatch: got ${vBal}, expected 3000000n`);
    }

    console.log('STEP 4 OK');
  } catch (err: any) {
    printFail(4, err);
  }

  // -------------------------------------------------------------
  // STEP 5: Fresh TRAINEE keypair enroll
  // -------------------------------------------------------------
  let trainee1 = Keypair.generate();
  try {
    if (!chain) throw new Error('Chain not initialized');

    const enrolledBefore = await chain.isEnrolled(trainee1.publicKey.toBase58());
    if (enrolledBefore) throw new Error('Expected isEnrolled to be false initially');

    await chain.enroll(trainee1.publicKey.toBase58(), [100000n, 100000n, 100000n]);

    const enrolledAfter = await chain.isEnrolled(trainee1.publicKey.toBase58());
    if (!enrolledAfter) throw new Error('Expected isEnrolled to be true after enroll');

    const prog = await chain.getProgramme();
    if (!prog) throw new Error('Programme missing after enroll');
    if (prog.enrolled !== 1) throw new Error(`Expected enrolled === 1, got ${prog.enrolled}`);
    if (prog.committed !== 300000n) throw new Error(`Expected committed === 300000n, got ${prog.committed}`);

    console.log('STEP 5 OK');
  } catch (err: any) {
    printFail(5, err);
  }

  // -------------------------------------------------------------
  // STEP 6: Call chain.enroll again for same trainee: must reject
  // -------------------------------------------------------------
  try {
    if (!chain) throw new Error('Chain not initialized');
    let rejected = false;
    try {
      await chain.enroll(trainee1.publicKey.toBase58(), [100000n, 100000n, 100000n]);
    } catch (err: any) {
      rejected = true;
      const code = err instanceof ChainError ? err.code : err.message;
      console.log(`STEP 6 OK (rejection code: ${code})`);
    }
    if (!rejected) throw new Error('Duplicate enroll did not reject');
  } catch (err: any) {
    printFail(6, err);
  }

  // -------------------------------------------------------------
  // STEP 7: Second fresh trainee, amounts [1n] (wrong length)
  // -------------------------------------------------------------
  const trainee2 = Keypair.generate();
  try {
    if (!chain) throw new Error('Chain not initialized');
    let rejected = false;
    try {
      await chain.enroll(trainee2.publicKey.toBase58(), [1n]);
    } catch (err: any) {
      rejected = true;
      const code = err instanceof ChainError ? err.code : err.message;
      console.log(`STEP 7 OK (rejection code: ${code})`);
    }
    if (!rejected) throw new Error('Wrong schedule length enroll did not reject');
  } catch (err: any) {
    printFail(7, err);
  }

  // -------------------------------------------------------------
  // STEP 8: Third fresh trainee, amounts [900000000n, 1n, 1n]
  // -------------------------------------------------------------
  const trainee3 = Keypair.generate();
  try {
    if (!chain) throw new Error('Chain not initialized');
    let rejected = false;
    try {
      await chain.enroll(trainee3.publicKey.toBase58(), [900000000n, 1n, 1n]);
    } catch (err: any) {
      rejected = true;
      const code = err instanceof ChainError ? err.code : err.message;
      console.log(`STEP 8 OK (rejection code: ${code})`);
    }
    if (!rejected) throw new Error('Over-budget enroll did not reject');
  } catch (err: any) {
    printFail(8, err);
  }

  // -------------------------------------------------------------
  // STEP 9: isTrainerRegistered(fresh wallet) -> false
  // -------------------------------------------------------------
  try {
    if (!chain) throw new Error('Chain not initialized');
    const freshWallet = Keypair.generate().publicKey.toBase58();
    const isReg = await chain.isTrainerRegistered(freshWallet);
    if (isReg) throw new Error('Expected isTrainerRegistered to return false');
    console.log('STEP 9 OK');
  } catch (err: any) {
    printFail(9, err);
  }

  // -------------------------------------------------------------
  // Final summary line
  // -------------------------------------------------------------
  if (failedSteps === 0) {
    console.log('SMOKE: PASS');
  } else {
    console.log(`SMOKE: FAIL (${failedSteps} steps failed)`);
  }
}

main().catch((err) => {
  console.error('Fatal smoke error:', err);
  console.log('SMOKE: FAIL (fatal exception)');
});
