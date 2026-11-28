export interface AppConfig {
  demoStartTs?: bigint;
  demoDayLen?: bigint;
  trainerTopupLamports: bigint;
  topupTotalCapLamports: bigint;
  solUsd?: number;
  tokenUsd?: number;
}

/**
 * Loads configuration from process.env (or a provided env dict).
 * Enforces that if DEMO_START_TS is set, it must be in the future relative to now.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env, nowSec: number = Math.floor(Date.now() / 1000)): AppConfig {
  let demoStartTs: bigint | undefined;
  if (env.DEMO_START_TS) {
    const parsed = BigInt(env.DEMO_START_TS);
    if (parsed <= BigInt(nowSec)) {
      throw new Error('DEMO_START_TS must be in the future');
    }
    demoStartTs = parsed;
  }

  let demoDayLen: bigint | undefined;
  if (env.DEMO_DAY_LEN) {
    demoDayLen = BigInt(env.DEMO_DAY_LEN);
  }

  const trainerTopupLamports = env.TRAINER_TOPUP_LAMPORTS
    ? BigInt(env.TRAINER_TOPUP_LAMPORTS)
    : 10_000_000n; // default 0.01 SOL

  const topupTotalCapLamports = env.TOPUP_TOTAL_CAP_LAMPORTS
    ? BigInt(env.TOPUP_TOTAL_CAP_LAMPORTS)
    : 100_000_000n; // default 0.1 SOL

  let solUsd: number | undefined;
  if (env.SOL_USD !== undefined && env.SOL_USD !== '') {
    const parsed = Number(env.SOL_USD);
    if (!isNaN(parsed) && parsed > 0) {
      solUsd = parsed;
    }
  }

  let tokenUsd: number | undefined;
  if (env.TOKEN_USD !== undefined && env.TOKEN_USD !== '') {
    const parsed = Number(env.TOKEN_USD);
    if (!isNaN(parsed) && parsed > 0) {
      tokenUsd = parsed;
    }
  }

  return {
    demoStartTs,
    demoDayLen,
    trainerTopupLamports,
    topupTotalCapLamports,
    solUsd,
    tokenUsd,
  };
}

/**
 * Returns Unix timestamp in seconds for 00:00:00 on the given YYYY-MM-DD in Kenya time (UTC+3).
 * Kenya midnight (00:00:00 UTC+3) corresponds to 21:00:00 UTC of the previous calendar day.
 * 21:00:00 UTC is 21 * 3600 = 75600 seconds into the UTC day (timestamp % 86400 === 75600).
 */
export function kenyaMidnightUnix(dateStr: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    throw new Error('Invalid date format. Expected YYYY-MM-DD');
  }

  const [yearStr, monthStr, dayStr] = dateStr.split('-');
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  const day = parseInt(dayStr, 10);

  if (month < 1 || month > 12 || day < 1 || day > 31) {
    throw new Error('Invalid date values');
  }

  // Construct UTC timestamp corresponding to date at 00:00:00 +03:00
  // e.g. Date.UTC(year, month - 1, day, 0, 0, 0) is UTC midnight.
  // In UTC+3, 00:00:00 local is 3 hours earlier in UTC: - 3 * 3600 seconds.
  const utcMidnightMs = Date.UTC(year, month - 1, day, 0, 0, 0);
  const d = new Date(utcMidnightMs);
  if (
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() !== month - 1 ||
    d.getUTCDate() !== day
  ) {
    throw new Error('Invalid calendar date');
  }

  const utcSeconds = Math.floor(utcMidnightMs / 1000);
  const kenyaMidnightSec = utcSeconds - 3 * 3600;
  return kenyaMidnightSec;
}
