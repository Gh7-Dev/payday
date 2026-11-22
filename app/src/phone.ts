/**
 * Normalizes a Kenya phone number into E.164 format: +254XXXXXXXXX (9 digits after +254).
 * Handles:
 * - 07XXXXXXXX -> +2547XXXXXXXX
 * - 01XXXXXXXX -> +2541XXXXXXXX
 * - +2547XXXXXXXX / +2541XXXXXXXX -> +254XXXXXXXXX
 * - 2547XXXXXXXX / 2541XXXXXXXX -> +254XXXXXXXXX
 * Returns null if invalid.
 */
export function normalizeKenyaPhone(phone: string): string | null {
  if (!phone || typeof phone !== 'string') {
    return null;
  }

  const clean = phone.trim().replace(/[\s\-_()]/g, '');

  // 07XXXXXXXX or 01XXXXXXXX (10 digits total)
  if (/^0[71]\d{8}$/.test(clean)) {
    return '+254' + clean.slice(1);
  }

  // +254[71]XXXXXXXX (13 chars total)
  if (/^\+254[71]\d{8}$/.test(clean)) {
    return clean;
  }

  // 254[71]XXXXXXXX (12 digits total)
  if (/^254[71]\d{8}$/.test(clean)) {
    return '+' + clean;
  }

  return null;
}
