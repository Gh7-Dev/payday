import { parse } from 'csv-parse/sync';
import { normalizeKenyaPhone } from './phone.js';
import { parseDecimalToBigInt } from './money.js';

export interface CsvRow {
  name: string;
  email: string;
  phone: string;
  amounts: bigint[];
}

export interface CsvError {
  line: number;
  column?: string;
  code: string;
  message: string;
}

export type ValidateCsvResult =
  | {
      ok: true;
      rows: CsvRow[];
      perDayTotals: bigint[];
      grandTotal: bigint;
    }
  | {
      ok: false;
      errors: CsvError[];
    };

export interface ValidateCsvOptions {
  days: number;
  decimals: number;
  maxParticipants: number;
}

/**
 * Expands a 7-day (or K-day) pattern across `days` total (up to 31 days).
 */
export function expandCycle(amounts: bigint[], days: number): bigint[] {
  if (amounts.length === 0 || days <= 0) {
    return [];
  }
  const result: bigint[] = [];
  for (let i = 0; i < days; i++) {
    result.push(amounts[i % amounts.length]);
  }
  return result;
}

export function validateCsv(
  text: string,
  options: ValidateCsvOptions
): ValidateCsvResult {
  const { days, decimals, maxParticipants } = options;
  const errors: CsvError[] = [];

  function addError(err: CsvError) {
    if (errors.length < 20) {
      errors.push(err);
    }
  }

  // Handle BOM or empty input
  const cleanText = text.replace(/^\uFEFF/, '');
  if (!cleanText.trim()) {
    return {
      ok: false,
      errors: [{ line: 1, code: 'no_rows', message: 'CSV is empty' }],
    };
  }

  let rawRecords: string[][];
  try {
    rawRecords = parse(cleanText, {
      skip_empty_lines: true,
      relax_column_count_less: true,
      relax_column_count_more: true,
    });
  } catch (err: any) {
    return {
      ok: false,
      errors: [
        {
          line: 1,
          code: 'bad_csv',
          message: err.message || 'Malformed CSV',
        },
      ],
    };
  }

  if (rawRecords.length === 0) {
    return {
      ok: false,
      errors: [{ line: 1, code: 'no_rows', message: 'CSV has no data rows' }],
    };
  }

  // Determine expected K days: K = min(days, 7)
  const K = Math.min(days, 7);
  const expectedHeaders = ['name', 'email', 'phone'];
  for (let i = 1; i <= K; i++) {
    expectedHeaders.push(`day${i}`);
  }

  const headerRow = rawRecords[0];
  const normalizedHeaders = headerRow.map((h) => h.trim().toLowerCase());

  // Check header match
  const headersMatch =
    normalizedHeaders.length === expectedHeaders.length &&
    expectedHeaders.every((h, idx) => normalizedHeaders[idx] === h);

  if (!headersMatch) {
    addError({
      line: 1,
      code: 'bad_columns',
      message: `Expected header "${expectedHeaders.join(',')}", got "${headerRow.join(',')}"`,
    });
    return { ok: false, errors };
  }

  const dataRows = rawRecords.slice(1);
  if (dataRows.length === 0) {
    addError({
      line: 1,
      code: 'no_rows',
      message: 'CSV has no participant rows',
    });
    return { ok: false, errors };
  }

  if (dataRows.length > maxParticipants) {
    addError({
      line: 1,
      code: 'too_many_rows',
      message: `Row count ${dataRows.length} exceeds maximum allowed participants of ${maxParticipants}`,
    });
  }

  const seenPhones = new Map<string, number>();
  const seenEmails = new Map<string, number>();
  const parsedRows: CsvRow[] = [];

  for (let r = 0; r < dataRows.length; r++) {
    const row = dataRows[r];
    const lineNumber = r + 2; // header is line 1

    if (row.length !== expectedHeaders.length) {
      addError({
        line: lineNumber,
        code: 'bad_columns',
        message: `Expected ${expectedHeaders.length} columns, found ${row.length}`,
      });
      if (errors.length >= 20) break;
      continue;
    }

    const name = row[0].trim();
    const email = row[1].trim();
    const phoneRaw = row[2].trim();

    if (!name) {
      addError({
        line: lineNumber,
        column: 'name',
        code: 'blank_cell',
        message: 'Name cannot be blank',
      });
    }

    if (!email) {
      addError({
        line: lineNumber,
        column: 'email',
        code: 'blank_cell',
        message: 'Email cannot be blank',
      });
    } else {
      const lowerEmail = email.toLowerCase();
      if (seenEmails.has(lowerEmail)) {
        addError({
          line: lineNumber,
          column: 'email',
          code: 'duplicate_email',
          message: `Duplicate email: ${email}`,
        });
      } else {
        seenEmails.set(lowerEmail, lineNumber);
      }
    }

    let normalizedPhone: string | null = null;
    if (!phoneRaw) {
      addError({
        line: lineNumber,
        column: 'phone',
        code: 'blank_cell',
        message: 'Phone cannot be blank',
      });
    } else {
      normalizedPhone = normalizeKenyaPhone(phoneRaw);
      if (!normalizedPhone) {
        addError({
          line: lineNumber,
          column: 'phone',
          code: 'bad_phone',
          message: `Invalid Kenya phone number: ${phoneRaw}`,
        });
      } else {
        if (seenPhones.has(normalizedPhone)) {
          addError({
            line: lineNumber,
            column: 'phone',
            code: 'duplicate_phone',
            message: `Duplicate phone number: ${phoneRaw}`,
          });
        } else {
          seenPhones.set(normalizedPhone, lineNumber);
        }
      }
    }

    const rowBaseAmounts: bigint[] = [];
    for (let k = 0; k < K; k++) {
      const colName = `day${k + 1}`;
      const cell = row[3 + k].trim();
      if (cell === '') {
        addError({
          line: lineNumber,
          column: colName,
          code: 'blank_cell',
          message: `Amount for ${colName} cannot be blank`,
        });
      } else {
        try {
          const amountBigInt = parseDecimalToBigInt(cell, decimals);
          rowBaseAmounts.push(amountBigInt);
        } catch (err: any) {
          addError({
            line: lineNumber,
            column: colName,
            code: 'bad_amount',
            message: err.message || `Invalid amount "${cell}" for ${colName}`,
          });
        }
      }
    }

    if (errors.length >= 20) {
      break;
    }

    if (errors.length === 0 && normalizedPhone) {
      const fullCycleAmounts = expandCycle(rowBaseAmounts, days);
      parsedRows.push({
        name,
        email,
        phone: normalizedPhone,
        amounts: fullCycleAmounts,
      });
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const perDayTotals = new Array(days).fill(0n);
  let grandTotal = 0n;

  for (const pr of parsedRows) {
    for (let d = 0; d < days; d++) {
      perDayTotals[d] += pr.amounts[d];
      grandTotal += pr.amounts[d];
    }
  }

  return {
    ok: true,
    rows: parsedRows,
    perDayTotals,
    grandTotal,
  };
}
