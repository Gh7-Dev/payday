import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeKenyaPhone } from '../src/phone.js';

describe('phone: normalizeKenyaPhone', () => {
  it('normalizes 07.., 01.., +254.., 254.. to +254XXXXXXXXX', () => {
    assert.equal(normalizeKenyaPhone('0712345678'), '+254712345678');
    assert.equal(normalizeKenyaPhone('0112345678'), '+254112345678');
    assert.equal(normalizeKenyaPhone('+254712345678'), '+254712345678');
    assert.equal(normalizeKenyaPhone('+254112345678'), '+254112345678');
    assert.equal(normalizeKenyaPhone('254712345678'), '+254712345678');
    assert.equal(normalizeKenyaPhone('254112345678'), '+254112345678');
    assert.equal(normalizeKenyaPhone(' 0712-345 678 '), '+254712345678');
  });

  it('rejects non-Kenyan and malformed numbers', () => {
    assert.equal(normalizeKenyaPhone('0201234567'), null);
    assert.equal(normalizeKenyaPhone('+1234567890'), null);
    assert.equal(normalizeKenyaPhone('071234567'), null); // too short
    assert.equal(normalizeKenyaPhone('07123456789'), null); // too long
    assert.equal(normalizeKenyaPhone('abcdefg'), null);
    assert.equal(normalizeKenyaPhone(''), null);
  });
});
