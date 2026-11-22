export class ChainError extends Error {
  readonly code: string;

  constructor(code: string, message?: string) {
    super(message || code);
    this.name = 'ChainError';
    this.code = code;
  }
}

export interface ProgrammeAccount {
  organizer: string;
  backendKey: string;
  mint: string;
  programmeId: string;
  startTs: bigint;
  dayLen: bigint;
  days: number;
  maxParticipants: number;
  enrolled: number;
  totalFunded: bigint;
  totalPaid: bigint;
  totalReclaimed: bigint;
  committed: bigint;
  bump: number;
  vaultBump: number;
  reclaimed: boolean;
}

export interface ChainInterface {
  getRentExempt(bytes: number): Promise<bigint>;
  getFeePerSignature(): Promise<bigint>;
  getProgramme(): Promise<ProgrammeAccount | null>;
  getVaultBalance(): Promise<bigint>;
  isTrainerRegistered(wallet: string): Promise<boolean>;
  enroll(trainee: string, amounts: bigint[]): Promise<void>;
  topUp(wallet: string, lamports?: bigint): Promise<void>;
}
