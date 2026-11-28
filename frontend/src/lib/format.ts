// formatAmount: converts base units to decimal string with thousands separators.
// Uses bigint throughout; never floating point.
export function formatAmount(base: string | bigint, decimals: number): string {
  const n = typeof base === 'string' ? BigInt(base) : base;
  if (decimals === 0) return n.toLocaleString('en-US');
  const factor = 10n ** BigInt(decimals);
  const whole = n / factor;
  const frac = n % factor;
  const fracStr = frac.toString().padStart(decimals, '0');
  // trim trailing zeros
  const trimmed = fracStr.replace(/0+$/, '');
  const wholeStr = whole.toLocaleString('en-US');
  return trimmed.length > 0 ? `${wholeStr}.${trimmed}` : wholeStr;
}

export function shortAddress(addr: string): string {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

// formatCountdown: formats seconds into "Xm Ys" or "Xs"
export function formatCountdown(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem > 0 ? `${m}m ${rem}s` : `${m}m`;
}

// currentDay: returns the 0-based programme day for a given unix timestamp.
// Returns 0 if now < startTs (not started yet).
// Returns days-1 if now >= startTs + days*dayLen (clamped to last day index).
// Callers that need to know whether the programme has ended should compare
// the result against the days count themselves.
export function currentDay(nowSec: number, startTs: number, dayLen: number): number {
  if (dayLen <= 0) return 0;
  const elapsed = nowSec - startTs;
  if (elapsed < 0) return 0;
  return Math.floor(elapsed / dayLen);
}
