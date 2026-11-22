import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseDecimalToBigInt } from '../src/money.js';

describe('money: parseDecimalToBigInt', () => {
  it('converts valid decimal strings to bigint base units', () => {
    assert.equal(parseDecimalToBigInt('10.5', 6), 10500000n);
    assert.equal(parseDecimalToBigInt('0', 6), 0n);
    assert.equal(parseDecimalToBigInt('0.0', 6), 0n);
    assert.equal(parseDecimalToBigInt('100', 2), 10000n);
    assert.equal(parseDecimalToBigInt('0.000001', 6), 1n);
    assert.equal(parseDecimalToBigInt('18446744073709551615', 0), 18446744073709551615n);
  });

  it('rejects blank, negative, exponent, commas, too many decimals, above u64 max', () => {
    assert.throws(() => parseDecimalToBigInt('', 6), /Blank amount/);
    assert.throws(() => parseDecimalToBigInt('   ', 6), /Blank amount/);
    assert.throws(() => parseDecimalToBigInt('-5', 6), /Negative amount not allowed/);
    assert.throws(() => parseDecimalToBigInt('1e6', 6), /Invalid format/);
    assert.throws(() => parseDecimalToBigInt('1,000', 6), /Invalid format/);
    assert.throws(() => parseDecimalToBigInt('1.1234567', 6), /Too many decimal places/);
    assert.throws(() => parseDecimalToBigInt('18446744073709551616', 0), /Amount exceeds u64 maximum/);
  });
});
