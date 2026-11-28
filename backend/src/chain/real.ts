import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
  Message,
} from '@solana/web3.js';
import { BorshAccountsCoder } from '@anchor-lang/core';
import bs58 from 'bs58';
import { ChainError, type ChainInterface, type ProgrammeAccount } from './interface.js';
import idl from './payday.idl.json' with { type: 'json' };

export interface RealChainOptions {
  connection?: Connection;
  rpcUrl?: string;
  feePayerSecretKey?: string;
  backendKeySecretKey?: string;
  programId?: string;
  programmeAddress?: string;
}

export class RealChain implements ChainInterface {
  readonly connection: Connection;
  readonly feePayerKeypair: Keypair;
  readonly backendKeypair?: Keypair;
  readonly programId: PublicKey;
  readonly programmeAddress: PublicKey;
  private readonly coder: BorshAccountsCoder;

  constructor(options: RealChainOptions = {}) {
    const rpcUrl = options.rpcUrl ?? process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com';
    this.connection = options.connection ?? new Connection(rpcUrl, 'confirmed');

    const feePayerSecret = options.feePayerSecretKey ?? process.env.FEE_PAYER_SECRET_KEY;
    if (!feePayerSecret) {
      throw new Error('FEE_PAYER_SECRET_KEY is required for RealChain');
    }
    this.feePayerKeypair = Keypair.fromSecretKey(bs58.decode(feePayerSecret));

    const backendSecret = options.backendKeySecretKey ?? process.env.BACKEND_KEY_SECRET_KEY ?? process.env.BACKEND_SECRET_KEY;
    if (backendSecret) {
      this.backendKeypair = Keypair.fromSecretKey(bs58.decode(backendSecret));
    }

    const progId = options.programId ?? process.env.PROGRAM_ID ?? (idl as { address?: string }).address;
    if (!progId) {
      throw new Error('PROGRAM_ID is required for RealChain');
    }
    this.programId = new PublicKey(progId);

    const progAddr = options.programmeAddress ?? process.env.PROGRAMME_ADDRESS;
    if (!progAddr) {
      throw new Error('PROGRAMME_ADDRESS is required for RealChain');
    }
    this.programmeAddress = new PublicKey(progAddr);

    this.coder = new BorshAccountsCoder(idl as any);
  }

  async getRentExempt(bytes: number): Promise<bigint> {
    const lamports = await this.connection.getMinimumBalanceForRentExemption(bytes);
    return BigInt(lamports);
  }

  async getFeePerSignature(): Promise<bigint> {
    const dummyRecipient = Keypair.generate().publicKey;
    const ix = SystemProgram.transfer({
      fromPubkey: this.feePayerKeypair.publicKey,
      toPubkey: dummyRecipient,
      lamports: 1,
    });
    const { blockhash } = await this.connection.getLatestBlockhash('finalized');
    const message = new Message({
      header: {
        numRequiredSignatures: 1,
        numReadonlySignedAccounts: 0,
        numReadonlyUnsignedAccounts: 0,
      },
      accountKeys: [this.feePayerKeypair.publicKey.toBase58(), dummyRecipient.toBase58(), SystemProgram.programId.toBase58()],
      recentBlockhash: blockhash,
      instructions: [
        {
          programIdIndex: 2,
          accounts: [0, 1],
          data: bs58.encode(ix.data),
        },
      ],
    });

    const feeResponse = await this.connection.getFeeForMessage(message);
    const fee = feeResponse.value;
    if (fee === null || fee === undefined) {
      throw new Error('Could not calculate fee for message');
    }
    const sigCount = message.header.numRequiredSignatures || 1;
    return BigInt(Math.floor(fee / sigCount));
  }

  async topUp(wallet: string, lamports: bigint = 10_000_000n): Promise<void> {
    const toPubkey = new PublicKey(wallet);
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: this.feePayerKeypair.publicKey,
        toPubkey,
        lamports: Number(lamports),
      }),
    );
    await sendAndConfirmTransaction(this.connection, tx, [this.feePayerKeypair]);
  }

  async getProgramme(): Promise<ProgrammeAccount | null> {
    const acc = await this.connection.getAccountInfo(this.programmeAddress);
    if (!acc) {
      return null;
    }
    const decoded: any = this.coder.decode('Programme', acc.data as Buffer);

    const getVal = (snake: string, camel: string) => decoded[snake] ?? decoded[camel];
    const organizer = getVal('organizer', 'organizer');
    const backendKey = getVal('backend_key', 'backendKey');
    const mint = getVal('mint', 'mint');
    const programmeId = getVal('programme_id', 'programmeId');
    const startTs = getVal('start_ts', 'startTs');
    const dayLen = getVal('day_len', 'dayLen');
    const days = getVal('days', 'days');
    const maxParticipants = getVal('max_participants', 'maxParticipants');
    const enrolled = getVal('enrolled', 'enrolled');
    const totalFunded = getVal('total_funded', 'totalFunded');
    const totalPaid = getVal('total_paid', 'totalPaid');
    const totalReclaimed = getVal('total_reclaimed', 'totalReclaimed');
    const committed = getVal('committed', 'committed');
    const bump = getVal('bump', 'bump');
    const vaultBump = getVal('vault_bump', 'vaultBump');
    const reclaimed = getVal('reclaimed', 'reclaimed');

    return {
      organizer: organizer?.toBase58 ? organizer.toBase58() : organizer?.toString() ?? '',
      backendKey: backendKey?.toBase58 ? backendKey.toBase58() : backendKey?.toString() ?? '',
      mint: mint?.toBase58 ? mint.toBase58() : mint?.toString() ?? '',
      programmeId: BigInt(programmeId?.toString() ?? '0').toString(),
      startTs: BigInt(startTs?.toString() ?? '0'),
      dayLen: BigInt(dayLen?.toString() ?? '0'),
      days: Number(days ?? 0),
      maxParticipants: Number(maxParticipants ?? 0),
      enrolled: Number(enrolled ?? 0),
      totalFunded: BigInt(totalFunded?.toString() ?? '0'),
      totalPaid: BigInt(totalPaid?.toString() ?? '0'),
      totalReclaimed: BigInt(totalReclaimed?.toString() ?? '0'),
      committed: BigInt(committed?.toString() ?? '0'),
      bump: Number(bump ?? 0),
      vaultBump: Number(vaultBump ?? 0),
      reclaimed: Boolean(reclaimed),
    };
  }

  async getVaultBalance(): Promise<bigint> {
    const [vaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('vault'), this.programmeAddress.toBuffer()],
      this.programId,
    );
    const balance = await this.connection.getTokenAccountBalance(vaultPda);
    return BigInt(balance.value.amount);
  }

  async isTrainerRegistered(wallet: string): Promise<boolean> {
    let trainerPubkey: PublicKey;
    try {
      trainerPubkey = new PublicKey(wallet);
      if (!PublicKey.isOnCurve(trainerPubkey.toBuffer())) {
        return false;
      }
    } catch {
      return false;
    }

    const [trainerPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('trainer'), this.programmeAddress.toBuffer(), trainerPubkey.toBuffer()],
      this.programId,
    );

    const acc = await this.connection.getAccountInfo(trainerPda);
    if (!acc) {
      return false;
    }

    if (!acc.owner.equals(this.programId)) {
      return false;
    }

    const trainerAccountDef = (idl as any).accounts?.find((a: any) => a.name === 'Trainer');
    const expectedDisc = trainerAccountDef?.discriminator;
    if (!expectedDisc || !Array.isArray(expectedDisc) || expectedDisc.length !== 8) {
      throw new Error('Trainer discriminator not found in IDL');
    }

    if (acc.data.length < 8) {
      return false;
    }

    const discBuffer = Buffer.from(expectedDisc);
    if (!acc.data.subarray(0, 8).equals(discBuffer)) {
      return false;
    }

    let decoded: any;
    try {
      decoded = this.coder.decode('Trainer', acc.data as Buffer);
    } catch {
      return false;
    }

    const trainerVal = decoded.trainer?.toBase58 ? decoded.trainer.toBase58() : decoded.trainer?.toString();
    const programmeVal = decoded.programme?.toBase58 ? decoded.programme.toBase58() : decoded.programme?.toString();

    if (trainerVal !== wallet) {
      return false;
    }

    if (programmeVal !== this.programmeAddress.toBase58()) {
      return false;
    }

    return true;
  }

  buildEnrollTransaction(trainee: PublicKey, amounts: bigint[], mint: PublicKey): Transaction {
    if (!this.backendKeypair) {
      throw new ChainError('BackendKeyMissing', 'Backend keypair is required to build enroll transaction');
    }

    if (!amounts || amounts.length === 0) {
      throw new ChainError('BadAmount', 'Amounts array cannot be empty');
    }

    const U64_MAX = 18446744073709551615n;
    for (const amt of amounts) {
      if (amt < 0n || amt > U64_MAX) {
        throw new ChainError('BadAmount', `Invalid amount: ${amt}`);
      }
    }

    const enrollDef = (idl as any).instructions?.find((i: any) => i.name === 'enroll');
    if (!enrollDef || !Array.isArray(enrollDef.discriminator) || enrollDef.discriminator.length !== 8) {
      throw new Error('enroll discriminator not found in IDL');
    }

    const disc = Buffer.from(enrollDef.discriminator);
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32LE(amounts.length, 0);

    const amtBufs = amounts.map((amt) => {
      const b = Buffer.alloc(8);
      b.writeBigUInt64LE(amt, 0);
      return b;
    });

    const data = Buffer.concat([disc, lenBuf, ...amtBufs]);

    const TOKEN_PROGRAM = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
    const ATA_PROGRAM = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');

    const [enrollmentPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('enrollment'), trainee.toBuffer(), this.programmeAddress.toBuffer()],
      this.programId,
    );

    const [traineeTokenAccount] = PublicKey.findProgramAddressSync(
      [trainee.toBuffer(), TOKEN_PROGRAM.toBuffer(), mint.toBuffer()],
      ATA_PROGRAM,
    );

    const [vaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('vault'), this.programmeAddress.toBuffer()],
      this.programId,
    );

    const keys = [
      { pubkey: this.backendKeypair.publicKey, isSigner: true, isWritable: true },
      { pubkey: this.programmeAddress, isSigner: false, isWritable: true },
      { pubkey: trainee, isSigner: false, isWritable: false },
      { pubkey: enrollmentPda, isSigner: false, isWritable: true },
      { pubkey: traineeTokenAccount, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: vaultPda, isSigner: false, isWritable: false },
      { pubkey: ATA_PROGRAM, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ];

    const ix = new TransactionInstruction({
      programId: this.programId,
      keys,
      data,
    });

    const tx = new Transaction().add(ix);
    tx.feePayer = this.backendKeypair.publicKey;
    return tx;
  }

  async enroll(trainee: string, amounts: bigint[]): Promise<void> {
    // 1. Invalid trainee string -> throw ChainError('BadWallet').
    let traineePubkey: PublicKey;
    try {
      traineePubkey = new PublicKey(trainee);
      if (!PublicKey.isOnCurve(traineePubkey.toBuffer())) {
        throw new Error();
      }
    } catch {
      throw new ChainError('BadWallet', 'Invalid trainee wallet address');
    }

    // 2. programme = await this.getProgramme(). null -> ChainError('ProgrammeMissing').
    // If !this.backendKeypair -> ChainError('BackendKeyMissing').
    // If this.backendKeypair.publicKey.toBase58() !== programme.backendKey -> ChainError('InvalidBackend').
    const programme = await this.getProgramme();
    if (!programme) {
      throw new ChainError('ProgrammeMissing', 'Programme account not found');
    }

    if (!this.backendKeypair) {
      throw new ChainError('BackendKeyMissing', 'Backend keypair is required to enroll');
    }

    if (this.backendKeypair.publicKey.toBase58() !== programme.backendKey) {
      throw new ChainError('InvalidBackend', 'Backend key does not match programme backendKey');
    }

    // 3. tx = this.buildEnrollTransaction(new PublicKey(trainee), amounts, new PublicKey(programme.mint)).
    const tx = this.buildEnrollTransaction(traineePubkey, amounts, new PublicKey(programme.mint));

    // 4. Underfunded guard:
    // balance = await connection.getBalance(backend pubkey).
    // needed = getRentExempt(89 + 8 * programme.days) + getRentExempt(165) + getFeePerSignature().
    // If balance < needed -> ChainError('BackendUnderfunded').
    const balance = BigInt(await this.connection.getBalance(this.backendKeypair.publicKey));
    const enrollmentRent = await this.getRentExempt(89 + 8 * programme.days);
    const ataRent = await this.getRentExempt(165);
    const fee = await this.getFeePerSignature();
    const needed = enrollmentRent + ataRent + fee;

    if (balance < needed) {
      throw new ChainError('BackendUnderfunded', `Backend balance ${balance} is below needed ${needed}`);
    }

    // Helper to map errors from text / objects to ChainError
    const mapToChainError = (err: any): ChainError => {
      let code: number | null = null;

      // Check confirmation err object: { InstructionError: [i, { Custom: n }] }
      if (err && typeof err === 'object') {
        const instructionError = err.InstructionError ?? (err.err && err.err.InstructionError);
        if (Array.isArray(instructionError) && instructionError.length >= 2) {
          const detail = instructionError[1];
          if (detail && typeof detail === 'object' && typeof detail.Custom === 'number') {
            code = detail.Custom;
          }
        }
      }

      // Check strings in message, logs, transactionMessage
      if (code === null) {
        const textToSearch = [
          err?.message,
          typeof err === 'string' ? err : '',
          Array.isArray(err?.logs) ? err.logs.join(' ') : '',
          err?.transactionMessage,
        ].filter(Boolean).join(' ');

        const match = textToSearch.match(/custom program error:\s*0x([0-9a-fA-F]+)/i);
        if (match) {
          code = parseInt(match[1], 16);
        } else {
          // Also check for decimal custom error in logs/message if present
          const customMatch = textToSearch.match(/Custom:\s*(\d+)/i) ?? textToSearch.match(/custom error\s*(\d+)/i);
          if (customMatch) {
            code = parseInt(customMatch[1], 10);
          }
        }
      }

      if (code !== null) {
        const idlErr = (idl as any).errors?.find((e: any) => e.code === code);
        if (idlErr) {
          return new ChainError(idlErr.name, idlErr.msg);
        }
      }

      const msg = err?.message || (typeof err === 'string' ? err : 'Unknown RPC error');
      return new ChainError('RpcError', msg);
    };

    // 5. Set tx.recentBlockhash and lastValidBlockHeight from connection.getLatestBlockhash('confirmed'),
    // sign with this.backendKeypair only, send with connection.sendRawTransaction(tx.serialize()) (preflight ON),
    // then confirm with connection.confirmTransaction({signature, blockhash, lastValidBlockHeight}, 'confirmed').
    let sendOrConfirmError: any = null;

    try {
      const latest = await this.connection.getLatestBlockhash('confirmed');
      tx.recentBlockhash = latest.blockhash;
      tx.lastValidBlockHeight = latest.lastValidBlockHeight;
      tx.sign(this.backendKeypair);

      const raw = tx.serialize();
      const sig = await this.connection.sendRawTransaction(raw, { skipPreflight: false });
      const confirmation = await this.connection.confirmTransaction(
        {
          signature: sig,
          blockhash: latest.blockhash,
          lastValidBlockHeight: latest.lastValidBlockHeight,
        },
        'confirmed',
      );

      if (confirmation?.value?.err) {
        sendOrConfirmError = confirmation.value.err;
      }
    } catch (err: any) {
      sendOrConfirmError = err;
    }

    if (!sendOrConfirmError) {
      return;
    }

    // 6. Retry-safety: if sending or confirming THROWS for any reason (timeout, RPC error),
    // call await this.isEnrolled(trainee) once. If true, return normally (the transaction landed).
    // If false, continue to step 7 with the original error.
    try {
      const landed = await this.isEnrolled(trainee);
      if (landed) {
        return;
      }
    } catch {
      // ignore check failure and continue to throw mapped error
    }

    // 7. Error mapping
    throw mapToChainError(sendOrConfirmError);
  }

  async isEnrolled(wallet: string): Promise<boolean> {
    let traineePubkey: PublicKey;
    try {
      traineePubkey = new PublicKey(wallet);
      if (!PublicKey.isOnCurve(traineePubkey.toBuffer())) {
        return false;
      }
    } catch {
      return false;
    }

    const [enrollmentPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('enrollment'), traineePubkey.toBuffer(), this.programmeAddress.toBuffer()],
      this.programId,
    );

    const acc = await this.connection.getAccountInfo(enrollmentPda);
    if (!acc) {
      return false;
    }

    if (!acc.owner.equals(this.programId)) {
      return false;
    }

    const enrollmentAccountDef = (idl as any).accounts?.find((a: any) => a.name === 'Enrollment');
    const expectedDisc = enrollmentAccountDef?.discriminator;
    if (!expectedDisc || !Array.isArray(expectedDisc) || expectedDisc.length !== 8) {
      throw new Error('Enrollment discriminator not found in IDL');
    }

    if (acc.data.length < 8) {
      return false;
    }

    const discBuffer = Buffer.from(expectedDisc);
    if (!acc.data.subarray(0, 8).equals(discBuffer)) {
      return false;
    }

    let decoded: any;
    try {
      decoded = this.coder.decode('Enrollment', acc.data as Buffer);
    } catch {
      return false;
    }

    const traineeVal = decoded.trainee?.toBase58 ? decoded.trainee.toBase58() : decoded.trainee?.toString();
    if (traineeVal !== wallet) {
      return false;
    }

    return true;
  }
}
