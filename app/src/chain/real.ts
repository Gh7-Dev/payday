import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
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
    throw new ChainError('NotImplementedYet', 'isTrainerRegistered not implemented yet');
  }

  async enroll(trainee: string, amounts: bigint[]): Promise<void> {
    throw new ChainError('NotImplementedYet', 'enroll not implemented yet');
  }

  async isEnrolled(wallet: string): Promise<boolean> {
    throw new ChainError('NotImplementedYet', 'isEnrolled not implemented yet');
  }
}
