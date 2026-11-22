import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateCsv, expandCycle } from '../src/csv.js';

describe('csv: validateCsv and expandCycle', () => {
  it('expands cycle correctly for days > K (e.g. 10 days pattern)', () => {
    const pattern = [10n, 20n, 30n, 40n, 50n, 60n, 70n];
    const expanded = expandCycle(pattern, 10);
    assert.equal(expanded.length, 10);
    assert.deepEqual(expanded, [10n, 20n, 30n, 40n, 50n, 60n, 70n, 10n, 20n, 30n]);
  });

  it('validates correct CSV and allows explicit 0', () => {
    const csv = `name,email,phone,day1,day2,day3
Alice,alice@example.com,0712345678,10.5,0,5
Bob,bob@example.com,+254722334455,0.0,20,15.25`;

    const res = validateCsv(csv, { days: 3, decimals: 2, maxParticipants: 10 });
    assert.equal(res.ok, true);
    if (res.ok) {
      assert.equal(res.rows.length, 2);
      assert.equal(res.rows[0].phone, '+254712345678');
      assert.deepEqual(res.rows[0].amounts, [1050n, 0n, 500n]);
      assert.deepEqual(res.rows[1].amounts, [0n, 2000n, 1525n]);
      assert.deepEqual(res.perDayTotals, [1050n, 2000n, 2025n]);
      assert.equal(res.grandTotal, 5075n);
    }
  });

  it('handles BOM, CRLF, and quoted comma', () => {
    const csv = `\uFEFFname,email,phone,day1,day2\r\n"Doe, Jane",jane@example.com,254711223344,5,10\r\n`;
    const res = validateCsv(csv, { days: 2, decimals: 0, maxParticipants: 5 });
    assert.equal(res.ok, true);
    if (res.ok) {
      assert.equal(res.rows[0].name, 'Doe, Jane');
      assert.deepEqual(res.rows[0].amounts, [5n, 10n]);
    }
  });

  it('reports blank cell error and bad amount', () => {
    const csv = `name,email,phone,day1\nAlice,alice@example.com,0712345678,\nBob,,0722334455,-5`;
    const res = validateCsv(csv, { days: 1, decimals: 2, maxParticipants: 10 });
    assert.equal(res.ok, false);
    if (!res.ok) {
      const codes = res.errors.map((e) => e.code);
      assert.ok(codes.includes('blank_cell'));
      assert.ok(codes.includes('bad_amount'));
    }
  });

  it('detects duplicate phone or email', () => {
    const csv = `name,email,phone,day1
Alice,test@example.com,0712345678,10
Bob,test@example.com,0722334455,10
Charlie,charlie@example.com,+254712345678,10`;

    const res = validateCsv(csv, { days: 1, decimals: 2, maxParticipants: 10 });
    assert.equal(res.ok, false);
    if (!res.ok) {
      const codes = res.errors.map((e) => e.code);
      assert.ok(codes.includes('duplicate_email'));
      assert.ok(codes.includes('duplicate_phone'));
    }
  });

  it('detects wrong column count or bad header', () => {
    const badHeader = `name,email,phone,role,day1\nAlice,a@b.com,0712345678,trainer,10`;
    const res1 = validateCsv(badHeader, { days: 1, decimals: 2, maxParticipants: 10 });
    assert.equal(res1.ok, false);
    if (!res1.ok) {
      assert.equal(res1.errors[0].code, 'bad_columns');
    }

    const badRowCol = `name,email,phone,day1\nAlice,a@b.com,0712345678,10,extra`;
    const res2 = validateCsv(badRowCol, { days: 1, decimals: 2, maxParticipants: 10 });
    assert.equal(res2.ok, false);
    if (!res2.ok) {
      assert.equal(res2.errors[0].code, 'bad_columns');
    }
  });

  it('detects too_many_rows and no_rows', () => {
    const emptyCsv = `   \n\n`;
    const resEmpty = validateCsv(emptyCsv, { days: 1, decimals: 2, maxParticipants: 10 });
    assert.equal(resEmpty.ok, false);
    if (!resEmpty.ok) {
      assert.equal(resEmpty.errors[0].code, 'no_rows');
    }

    const headerOnly = `name,email,phone,day1\n`;
    const resHeaderOnly = validateCsv(headerOnly, { days: 1, decimals: 2, maxParticipants: 10 });
    assert.equal(resHeaderOnly.ok, false);
    if (!resHeaderOnly.ok) {
      assert.equal(resHeaderOnly.errors[0].code, 'no_rows');
    }

    const tooMany = `name,email,phone,day1
Alice,a@b.com,0712345678,10
Bob,b@b.com,0722334455,10`;
    const resTooMany = validateCsv(tooMany, { days: 1, decimals: 2, maxParticipants: 1 });
    assert.equal(resTooMany.ok, false);
    if (!resTooMany.ok) {
      assert.equal(resTooMany.errors[0].code, 'too_many_rows');
    }
  });
});
