import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  hashSecret,
  verifySecret,
  HashBusyError,
  hashLimiter,
  setCustomScryptRunner,
} from '../src/scrypt.js';
import { Limiter } from '../src/limiter.js';

describe('scrypt and limiter', () => {
  const origN = process.env.SCRYPT_N;

  beforeEach(() => {
    // Fast N for unit tests
    process.env.SCRYPT_N = '1024';
  });

  afterEach(() => {
    if (origN !== undefined) {
      process.env.SCRYPT_N = origN;
    } else {
      delete process.env.SCRYPT_N;
    }
    setCustomScryptRunner(null);
  });

  test('hash then verify true and wrong secret false', async () => {
    const secret = 'my-secret-pin-123456';
    const hash = await hashSecret(secret);
    assert.ok(hash.startsWith('scrypt$1024$8$1$'));

    const ok = await verifySecret(secret, hash);
    assert.equal(ok, true);

    const wrong = await verifySecret('wrong-secret', hash);
    assert.equal(wrong, false);
  });

  test('same secret gives different hashes', async () => {
    const secret = 'identical-secret';
    const hash1 = await hashSecret(secret);
    const hash2 = await hashSecret(secret);

    assert.notEqual(hash1, hash2);
    assert.equal(await verifySecret(secret, hash1), true);
    assert.equal(await verifySecret(secret, hash2), true);
  });

  test('malformed stored string returns false', async () => {
    const malformedCases = [
      '',
      'invalid',
      'scrypt$abc',
      'scrypt$1024$8$1$badbase64!!!$badbase64!!!',
      'bcrypt$1024$8$1$salt$hash',
      'scrypt$0$8$1$c2FsdA==$aGFzaA==',
      'scrypt$1024$8$1$$',
    ];

    for (const bad of malformedCases) {
      const res = await verifySecret('secret', bad);
      assert.equal(res, false, `Expected false for "${bad}"`);
    }
  });

  test('never more than 2 concurrent (stub the slow part)', async () => {
    hashLimiter.updateConfig(2, 5000);
    let currentConcurrent = 0;
    let maxSeenConcurrent = 0;

    setCustomScryptRunner(async () => {
      currentConcurrent++;
      if (currentConcurrent > maxSeenConcurrent) {
        maxSeenConcurrent = currentConcurrent;
      }
      await new Promise((r) => setTimeout(r, 50));
      currentConcurrent--;
      return Buffer.alloc(32);
    });

    const tasks = [
      hashSecret('p1'),
      hashSecret('p2'),
      hashSecret('p3'),
      hashSecret('p4'),
    ];

    await Promise.all(tasks);
    assert.ok(maxSeenConcurrent <= 2, `maxSeenConcurrent was ${maxSeenConcurrent}, expected <= 2`);
  });

  test('a queued call past the wait limit throws HashBusyError', async () => {
    // Concurrency 1, waitMs 50ms
    hashLimiter.updateConfig(1, 50);

    let blockerResolve: (() => void) | null = null;
    setCustomScryptRunner(() => {
      return new Promise<Buffer>((resolve) => {
        blockerResolve = () => resolve(Buffer.alloc(32));
      });
    });

    // Start 1st call (fills the 1 slot)
    const p1 = hashSecret('p1');

    // Start 2nd call (queued, will timeout after 50ms)
    await assert.rejects(
      async () => {
        await hashSecret('p2');
      },
      (err: unknown) => {
        assert.ok(err instanceof HashBusyError);
        return true;
      }
    );

    // Unblock the first call
    if (blockerResolve) {
      (blockerResolve as () => void)();
    }
    await p1;

    // Reset limiter config
    hashLimiter.updateConfig(2, 10000);
  });

  test('5 failures block that IP even for another phone', () => {
    const limiter = new Limiter();
    const ip = '192.168.1.100';

    assert.equal(limiter.check(ip, '0711111111'), false);

    for (let i = 0; i < 5; i++) {
      limiter.fail(ip, '0711111111');
    }

    // IP is locked, so checking even another phone should be blocked
    assert.equal(limiter.check(ip, '0722222222'), true);
  });

  test('5 failures block that phone from another IP', () => {
    const limiter = new Limiter();
    const phone = '+254712345678';

    assert.equal(limiter.check('10.0.0.1', phone), false);

    for (let i = 0; i < 5; i++) {
      limiter.fail('10.0.0.1', phone);
    }

    // Phone is locked, so checking from a different IP should be blocked
    assert.equal(limiter.check('10.0.0.2', phone), true);
  });

  test('success clears the counters', () => {
    const limiter = new Limiter();
    const ip = '1.2.3.4';
    const phone = '0700000000';

    // 4 failures (not locked yet)
    for (let i = 0; i < 4; i++) {
      limiter.fail(ip, phone);
    }
    assert.equal(limiter.check(ip, phone), false);

    // Success clears both
    limiter.success(ip, phone);

    // 4 more failures - still shouldn't lock because counters were reset
    for (let i = 0; i < 4; i++) {
      limiter.fail(ip, phone);
    }
    assert.equal(limiter.check(ip, phone), false);
  });

  test('the lock expires with the injected clock', () => {
    let fakeTime = 1000;
    const lockMs = 60000; // 1 minute
    const limiter = new Limiter({
      maxFails: 5,
      lockMs,
      clock: () => fakeTime,
    });

    const ip = '127.0.0.1';
    const phone = '0733333333';

    for (let i = 0; i < 5; i++) {
      limiter.fail(ip, phone);
    }

    assert.equal(limiter.check(ip, phone), true);

    // Advance time within lock window
    fakeTime += 30000;
    assert.equal(limiter.check(ip, phone), true);

    // Advance time past lock window
    fakeTime += 30001;
    assert.equal(limiter.check(ip, phone), false);
  });
});
