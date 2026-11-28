import { ChainError, ChainInterface, ProgrammeAccount } from './interface.js';

export interface MockChainOptions {
  rentCalculator?: (bytes: number) => bigint;
  feePerSignature?: bigint;
  defaultTopUpLamports?: bigint;
}

export interface CreateProgrammeParams {
  organizer: string;
  backendKey: string;
  mint: string;
  programmeId: string;
  startTs: bigint;
  dayLen: bigint;
  days: number;
  maxParticipants: number;
  bump?: number;
  vaultBump?: number;
}

export interface EnrollmentState {
  trainee: string;
  amounts: bigint[];
  attendanceMask: number;
  paidTotal: bigint;
}

export class MockChain implements ChainInterface {
  private rentCalculator: (bytes: number) => bigint;
  private feePerSignature: bigint;
  private defaultTopUpLamports: bigint;

  private programme: ProgrammeAccount | null = null;
  private vaultBalance: bigint = 0n;
  private trainers: Set<string> = new Set();
  private enrollments: Map<string, EnrollmentState> = new Map();
  private walletBalances: Map<string, bigint> = new Map();

  constructor(options?: MockChainOptions) {
    this.rentCalculator = options?.rentCalculator ?? ((bytes: number) => BigInt(bytes + 128) * 5080n);
    this.feePerSignature = options?.feePerSignature ?? 5000n;
    this.defaultTopUpLamports = options?.defaultTopUpLamports ?? 10_000_000n;
  }

  // --- ChainInterface Implementation ---

  async getRentExempt(bytes: number): Promise<bigint> {
    return this.rentCalculator(bytes);
  }

  async getFeePerSignature(): Promise<bigint> {
    return this.feePerSignature;
  }

  async getProgramme(): Promise<ProgrammeAccount | null> {
    return this.programme ? { ...this.programme } : null;
  }

  async getVaultBalance(): Promise<bigint> {
    return this.vaultBalance;
  }

  async isTrainerRegistered(wallet: string): Promise<boolean> {
    return this.trainers.has(wallet);
  }

  async enroll(trainee: string, amounts: bigint[]): Promise<void> {
    if (!this.programme) {
      throw new ChainError('Unauthorized', 'Programme not initialized');
    }

    if (this.programme.reclaimed) {
      throw new ChainError('ProgrammeClosed', 'Programme has been reclaimed');
    }

    if (this.programme.enrolled >= this.programme.maxParticipants) {
      throw new ChainError('ProgrammeFull', 'Max participants reached');
    }

    if (amounts.length !== this.programme.days) {
      throw new ChainError('WrongScheduleLength', 'Amounts length does not match programme days');
    }

    if (this.enrollments.has(trainee)) {
      throw new ChainError('Unauthorized', 'Duplicate trainee enrollment');
    }

    let sum = 0n;
    for (const a of amounts) {
      sum += a;
    }

    if (this.vaultBalance < this.programme.committed + sum) {
      throw new ChainError('InsufficientFunding', 'Vault balance is insufficient for committed amounts');
    }

    this.enrollments.set(trainee, {
      trainee,
      amounts: [...amounts],
      attendanceMask: 0,
      paidTotal: 0n,
    });

    this.programme.committed += sum;
    this.programme.enrolled += 1;
  }

  async topUp(wallet: string, lamports?: bigint): Promise<void> {
    const amount = lamports ?? this.defaultTopUpLamports;
    const current = this.walletBalances.get(wallet) ?? 0n;
    this.walletBalances.set(wallet, current + amount);
  }

  // --- Test Helpers (Not on ChainInterface) ---

  createProgramme(params: CreateProgrammeParams): void {
    if (params.days < 1 || params.days > 31) {
      throw new ChainError('InvalidDays', 'Days must be 1 to 31');
    }
    if (params.dayLen < 60n) {
      throw new ChainError('InvalidDayLength', 'Day length must be at least 60 seconds');
    }
    if (params.maxParticipants < 1) {
      throw new ChainError('InvalidCapacity', 'Capacity must be at least 1');
    }

    this.programme = {
      organizer: params.organizer,
      backendKey: params.backendKey,
      mint: params.mint,
      programmeId: params.programmeId,
      startTs: params.startTs,
      dayLen: params.dayLen,
      days: params.days,
      maxParticipants: params.maxParticipants,
      enrolled: 0,
      totalFunded: 0n,
      totalPaid: 0n,
      totalReclaimed: 0n,
      committed: 0n,
      bump: params.bump ?? 255,
      vaultBump: params.vaultBump ?? 255,
      reclaimed: false,
    };
  }

  fund(amount: bigint): void {
    if (!this.programme) {
      throw new ChainError('Unauthorized', 'Programme not initialized');
    }
    if (this.programme.reclaimed) {
      throw new ChainError('ProgrammeClosed', 'Programme already reclaimed');
    }
    if (amount <= 0n) {
      throw new ChainError('ZeroAmount', 'Fund amount must be positive');
    }

    this.vaultBalance += amount;
    this.programme.totalFunded += amount;
  }

  addTrainer(wallet: string): void {
    if (!this.programme) {
      throw new ChainError('Unauthorized', 'Programme not initialized');
    }
    if (this.programme.reclaimed) {
      throw new ChainError('ProgrammeClosed', 'Programme already reclaimed');
    }
    if (this.trainers.has(wallet)) {
      throw new ChainError('Unauthorized', 'Trainer already registered');
    }

    this.trainers.add(wallet);
  }

  markReclaimed(): void {
    if (!this.programme) {
      throw new ChainError('Unauthorized', 'Programme not initialized');
    }
    this.programme.reclaimed = true;
    this.programme.totalReclaimed = this.vaultBalance;
    this.vaultBalance = 0n;
    this.programme.committed = 0n;
  }

  async isEnrolled(wallet: string): Promise<boolean> {
    return this.enrollments.has(wallet);
  }

  getWalletBalance(wallet: string): bigint {
    return this.walletBalances.get(wallet) ?? 0n;
  }
}
