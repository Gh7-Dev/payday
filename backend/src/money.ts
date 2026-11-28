const U64_MAX = 18446744073709551615n;

/**
 * Parses a decimal string representation of an amount into bigint base units.
 * Rejects blank, negative, exponent ('e'/'E'), commas, too many decimals, or exceeding u64 max.
 */
export function parseDecimalToBigInt(amountStr: string, decimals: number): bigint {
  const trimmed = amountStr.trim();
  if (trimmed === '') {
    throw new Error('Blank amount');
  }

  // Reject exponent, commas, negative signs
  if (/[eE,]/.test(trimmed)) {
    throw new Error('Invalid format (exponents or commas not allowed)');
  }

  if (trimmed.startsWith('-')) {
    throw new Error('Negative amount not allowed');
  }

  // Must match optional + followed by digits, optionally .digits
  if (!/^\+?\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error('Invalid decimal number format');
  }

  const clean = trimmed.startsWith('+') ? trimmed.slice(1) : trimmed;
  const parts = clean.split('.');
  const wholePart = parts[0];
  const fracPart = parts[1] || '';

  if (fracPart.length > decimals) {
    throw new Error(`Too many decimal places (max ${decimals})`);
  }

  const paddedFrac = fracPart.padEnd(decimals, '0');
  const combinedStr = wholePart + paddedFrac;
  const val = BigInt(combinedStr);

  if (val > U64_MAX) {
    throw new Error('Amount exceeds u64 maximum (18446744073709551615)');
  }

  return val;
}
