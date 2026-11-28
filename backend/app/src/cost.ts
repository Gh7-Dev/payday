import { ChainInterface } from './chain/interface.js';
import { AppConfig } from './config.js';

// Account size constants from design
export const PROGRAMME_BYTES = 168;
export const TRAINER_BYTES = 73;
export const VAULT_BYTES = 165; // token account
export function enrollmentBytes(days: number): number {
  return 89 + 8 * days;
}

// Signatures per transaction type
export const SIGNATURES_CREATE_PROGRAMME = 1n; // organizer
export const SIGNATURES_FUND = 1n; // organizer
export const SIGNATURES_ADD_TRAINER = 1n; // organizer
export const SIGNATURES_ENROLL = 1n; // backend key
export const SIGNATURES_CHECK_IN = 2n; // trainer + trainee
export const SIGNATURES_RECLAIM = 1n; // organizer

export interface EstimateCostInput {
  days: number;
  participants: number;
  trainers: number;
  stipendTotal: bigint;
  decimals: number;
  config?: AppConfig;
}

export interface RentCostBreakdown {
  programme: bigint;
  vault: bigint;
  perTrainer: bigint;
  totalTrainers: bigint;
  enrollment: bigint; // per participant
  tokenAccount: bigint; // per participant (165 bytes)
  perParticipant: bigint; // enrollment + tokenAccount
  totalParticipants: bigint;
  totalRent: bigint;
}

export interface FeeCostBreakdown {
  feePerSignature: bigint;
  createProgramme: bigint;
  fund: bigint;
  addTrainers: bigint;
  enrollments: bigint;
  reclaim: bigint;
  organizerBackendFees: bigint;
  checkInsUpperLimit: bigint; // participants * days * 2 * feePerSignature (trainer pays)
  totalFees: bigint;
}

export interface CombinedEstimate {
  totalUsd: number;
  label: string;
}

export interface CostEstimateResult {
  stipends: {
    baseUnits: bigint;
    display: string;
  };
  rent: RentCostBreakdown;
  fees: FeeCostBreakdown;
  trainerTopupsLamports: bigint;
  combined: CombinedEstimate | null;
}

function formatBaseUnitsToDisplay(amount: bigint, decimals: number): string {
  if (decimals === 0) {
    return amount.toString();
  }
  const s = amount.toString().padStart(decimals + 1, '0');
  const whole = s.slice(0, s.length - decimals);
  const frac = s.slice(s.length - decimals).replace(/0+$/, '');
  return frac.length > 0 ? `${whole}.${frac}` : whole;
}

export async function estimateCost(
  input: EstimateCostInput,
  chain: ChainInterface
): Promise<CostEstimateResult> {
  const { days, participants, trainers, stipendTotal, decimals, config } = input;

  // 1. Rent calculations via ChainInterface
  const programmeRent = await chain.getRentExempt(PROGRAMME_BYTES);
  const vaultRent = await chain.getRentExempt(VAULT_BYTES);
  const perTrainerRent = await chain.getRentExempt(TRAINER_BYTES);
  const totalTrainersRent = perTrainerRent * BigInt(trainers);

  const enrollRent = await chain.getRentExempt(enrollmentBytes(days));
  const tokenAccountRent = await chain.getRentExempt(VAULT_BYTES); // token account is 165 bytes
  const perParticipantRent = enrollRent + tokenAccountRent;
  const totalParticipantsRent = perParticipantRent * BigInt(participants);

  const totalRent = programmeRent + vaultRent + totalTrainersRent + totalParticipantsRent;

  // 2. Fee calculations via ChainInterface
  const feePerSignature = await chain.getFeePerSignature();
  const createProgrammeFee = SIGNATURES_CREATE_PROGRAMME * feePerSignature;
  const fundFee = SIGNATURES_FUND * feePerSignature;
  const addTrainersFee = BigInt(trainers) * SIGNATURES_ADD_TRAINER * feePerSignature;
  const enrollmentsFee = BigInt(participants) * SIGNATURES_ENROLL * feePerSignature;
  const reclaimFee = SIGNATURES_RECLAIM * feePerSignature;

  const organizerBackendFees =
    createProgrammeFee + fundFee + addTrainersFee + enrollmentsFee + reclaimFee;

  // Check-ins upper bound: participants * days * 2 signatures (trainer pays)
  const checkInsUpperLimit =
    BigInt(participants) * BigInt(days) * SIGNATURES_CHECK_IN * feePerSignature;

  const totalFees = organizerBackendFees + checkInsUpperLimit;

  // 3. Trainer top-ups line item
  const topupPerTrainer = config?.trainerTopupLamports ?? 10_000_000n;
  let trainerTopupsLamports = topupPerTrainer * BigInt(trainers);
  if (config?.topupTotalCapLamports && trainerTopupsLamports > config.topupTotalCapLamports) {
    trainerTopupsLamports = config.topupTotalCapLamports;
  }

  // 4. Combined estimate if both rates set
  let combined: CombinedEstimate | null = null;
  if (config?.solUsd !== undefined && config?.tokenUsd !== undefined) {
    const totalLamports = totalRent + totalFees + trainerTopupsLamports;
    const solAmount = Number(totalLamports) / 1e9;
    const solCostUsd = solAmount * config.solUsd;

    const tokenAmount = Number(stipendTotal) / Math.pow(10, decimals);
    const tokenCostUsd = tokenAmount * config.tokenUsd;

    const totalUsd = Math.round((solCostUsd + tokenCostUsd) * 100) / 100;
    combined = {
      totalUsd,
      label: 'ESTIMATE using configured rates',
    };
  }

  return {
    stipends: {
      baseUnits: stipendTotal,
      display: formatBaseUnitsToDisplay(stipendTotal, decimals),
    },
    rent: {
      programme: programmeRent,
      vault: vaultRent,
      perTrainer: perTrainerRent,
      totalTrainers: totalTrainersRent,
      enrollment: enrollRent,
      tokenAccount: tokenAccountRent,
      perParticipant: perParticipantRent,
      totalParticipants: totalParticipantsRent,
      totalRent,
    },
    fees: {
      feePerSignature,
      createProgramme: createProgrammeFee,
      fund: fundFee,
      addTrainers: addTrainersFee,
      enrollments: enrollmentsFee,
      reclaim: reclaimFee,
      organizerBackendFees,
      checkInsUpperLimit,
      totalFees,
    },
    trainerTopupsLamports,
    combined,
  };
}
