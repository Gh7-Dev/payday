import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { Hono } from 'hono';
import { getDb, migrate } from '../src/db.js';
import { makeAuthRoutes } from '../src/routes/auth.js';
import { createNonce, buildNonceMessage } from '../src/session.js';

function makeApp() {
  const db = getDb(':memory:');
  migrate(db);
  const app = new Hono();
  app.route('/auth', makeAuthRoutes(db));
  return { app, db };
}

function signMessage(message: string, secretKey: Uint8Array): string {
  const msgBytes = new TextEncoder().encode(message);
  const sig = nacl.sign.detached(msgBytes, secretKey);
  return bs58.encode(sig);
}

describe('auth routes', () => {
  test('nonce round trip: nonce then verify sets cookie and /me returns wallet', async () => {
    const { app } = makeApp();
    const kp = nacl.sign.keyPair();
    const wallet = bs58.encode(kp.publicKey);

    // 1. Get nonce
    const nonceRes = await app.request('/auth/nonce', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallet }),
    });
    assert.equal(nonceRes.status, 200);
    const { nonce, message, expiresAt } = await nonceRes.json() as {
      nonce: string; message: string; expiresAt: number;
    };
    assert.ok(nonce);
    assert.ok(message.includes('PayDay login'));
    assert.ok(message.includes(wallet));
    assert.ok(message.includes(nonce));
    assert.ok(expiresAt > Math.floor(Date.now() / 1000));

    // 2. Sign and verify
    const signature = signMessage(message, kp.secretKey);
    const verifyRes = await app.request('/auth/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', host: 'localhost:3000' },
      body: JSON.stringify({ wallet, signature }),
    });
    assert.equal(verifyRes.status, 200);
    const verifyBody = await verifyRes.json() as { ok: boolean; wallet: string };
    assert.equal(verifyBody.ok, true);
    assert.equal(verifyBody.wallet, wallet);

    // Check cookie set
    const setCookie = verifyRes.headers.get('set-cookie') ?? '';
    assert.ok(setCookie.includes('session='), 'cookie set');

    // 3. Use cookie for /me
    const token = setCookie.split(';')[0].replace('session=', '');
    const meRes = await app.request('/auth/me', {
      headers: { cookie: `session=${token}` },
    });
    assert.equal(meRes.status, 200);
    const meBody = await meRes.json() as { wallet: string };
    assert.equal(meBody.wallet, wallet);
  });

  test('bad signature rejected', async () => {
    const { app } = makeApp();
    const kp = nacl.sign.keyPair();
    const wallet = bs58.encode(kp.publicKey);

    const nonceRes = await app.request('/auth/nonce', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallet }),
    });
    const { message } = await nonceRes.json() as { message: string };

    // Sign with garbage bytes
    const badSig = bs58.encode(new Uint8Array(64).fill(0));
    const verifyRes = await app.request('/auth/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallet, signature: badSig }),
    });
    assert.equal(verifyRes.status, 401);
    void message;
  });

  test('signature by another wallet rejected', async () => {
    const { app } = makeApp();
    const kp1 = nacl.sign.keyPair();
    const kp2 = nacl.sign.keyPair();
    const wallet1 = bs58.encode(kp1.publicKey);

    const nonceRes = await app.request('/auth/nonce', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallet: wallet1 }),
    });
    const { message } = await nonceRes.json() as { message: string };

    // Sign the message for wallet1 with kp2's secret key
    const signature = signMessage(message, kp2.secretKey);
    const verifyRes = await app.request('/auth/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallet: wallet1, signature }),
    });
    assert.equal(verifyRes.status, 401);
  });

  test('nonce replay rejected', async () => {
    const { app } = makeApp();
    const kp = nacl.sign.keyPair();
    const wallet = bs58.encode(kp.publicKey);

    const nonceRes = await app.request('/auth/nonce', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallet }),
    });
    const { message } = await nonceRes.json() as { message: string };
    const signature = signMessage(message, kp.secretKey);

    // First verify — should succeed
    const v1 = await app.request('/auth/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallet, signature }),
    });
    assert.equal(v1.status, 200);

    // Second verify with same nonce — should fail (nonce deleted)
    const v2 = await app.request('/auth/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallet, signature }),
    });
    assert.equal(v2.status, 401);
  });

  test('expired nonce rejected', async () => {
    const { app, db } = makeApp();
    const kp = nacl.sign.keyPair();
    const wallet = bs58.encode(kp.publicKey);

    const nonceRes = await app.request('/auth/nonce', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallet }),
    });
    const { nonce, expiresAt } = await nonceRes.json() as { nonce: string; expiresAt: number };

    // Build the message with the real expiresAt so signature is correct
    const message = buildNonceMessage(wallet, nonce, expiresAt);
    const signature = signMessage(message, kp.secretKey);

    // Expire the nonce row
    db.prepare(`UPDATE sessions SET expires_at = 1 WHERE wallet_address = ? AND nonce != ''`).run(wallet);

    const verifyRes = await app.request('/auth/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallet, signature }),
    });
    assert.equal(verifyRes.status, 401);
  });

  test('cookie is httpOnly', async () => {
    const { app } = makeApp();
    const kp = nacl.sign.keyPair();
    const wallet = bs58.encode(kp.publicKey);

    const nonceRes = await app.request('/auth/nonce', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallet }),
    });
    const { message } = await nonceRes.json() as { message: string };
    const signature = signMessage(message, kp.secretKey);

    const verifyRes = await app.request('/auth/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', host: 'localhost:3000' },
      body: JSON.stringify({ wallet, signature }),
    });
    const setCookie = verifyRes.headers.get('set-cookie') ?? '';
    assert.ok(setCookie.toLowerCase().includes('httponly'), 'HttpOnly flag present');
  });

  test('Secure present by default and disabled only when COOKIE_SECURE=false', async () => {
    const origEnv = process.env.COOKIE_SECURE;
    try {
      delete process.env.COOKIE_SECURE;
      const { app } = makeApp();
      const kp = nacl.sign.keyPair();
      const wallet = bs58.encode(kp.publicKey);

      const nonceRes = await app.request('/auth/nonce', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet }),
      });
      const { message } = await nonceRes.json() as { message: string };
      const signature = signMessage(message, kp.secretKey);

      // Default: Secure present even on localhost
      const verifyRes1 = await app.request('/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', host: 'localhost:3000' },
        body: JSON.stringify({ wallet, signature }),
      });
      const cookie1 = verifyRes1.headers.get('set-cookie') ?? '';
      assert.ok(cookie1.includes('Secure'), 'Secure flag should be present by default');

      // COOKIE_SECURE='false': Secure omitted
      process.env.COOKIE_SECURE = 'false';
      const nonceRes2 = await app.request('/auth/nonce', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet }),
      });
      const { message: message2 } = await nonceRes2.json() as { message: string };
      const signature2 = signMessage(message2, kp.secretKey);

      const verifyRes2 = await app.request('/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet, signature: signature2 }),
      });
      const cookie2 = verifyRes2.headers.get('set-cookie') ?? '';
      assert.ok(!cookie2.includes('Secure'), 'Secure flag should be absent when COOKIE_SECURE=false');
    } finally {
      if (origEnv !== undefined) {
        process.env.COOKIE_SECURE = origEnv;
      } else {
        delete process.env.COOKIE_SECURE;
      }
    }
  });

  test('failed verify then correct verify works', async () => {
    const { app } = makeApp();
    const kp = nacl.sign.keyPair();
    const wallet = bs58.encode(kp.publicKey);

    const nonceRes = await app.request('/auth/nonce', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallet }),
    });
    const { message } = await nonceRes.json() as { message: string };

    // 1. Attempt verify with bad signature - should fail with 401
    const badSig = bs58.encode(new Uint8Array(64).fill(1));
    const badVerifyRes = await app.request('/auth/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallet, signature: badSig }),
    });
    assert.equal(badVerifyRes.status, 401);

    // 2. Attempt verify with correct signature - should succeed (nonce not consumed by bad verify)
    const validSignature = signMessage(message, kp.secretKey);
    const goodVerifyRes = await app.request('/auth/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallet, signature: validSignature }),
    });
    assert.equal(goodVerifyRes.status, 200);
    const body = await goodVerifyRes.json() as { ok: boolean };
    assert.equal(body.ok, true);
  });

  test('6 nonce calls leave 5 rows', async () => {
    const { app, db } = makeApp();
    const kp = nacl.sign.keyPair();
    const wallet = bs58.encode(kp.publicKey);

    for (let i = 0; i < 6; i++) {
      const res = await app.request('/auth/nonce', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet }),
      });
      assert.equal(res.status, 200);
    }

    const rows = db.prepare(
      `SELECT count(*) as cnt FROM sessions WHERE wallet_address = ? AND nonce != ''`
    ).get(wallet) as { cnt: number };

    assert.equal(rows.cnt, 5);
  });

  test('/auth/me without cookie gives 401', async () => {
    const { app } = makeApp();
    const res = await app.request('/auth/me');
    assert.equal(res.status, 401);
  });

  test('expired session gives 401', async () => {
    const { app, db } = makeApp();
    const kp = nacl.sign.keyPair();
    const wallet = bs58.encode(kp.publicKey);

    const nonceRes = await app.request('/auth/nonce', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallet }),
    });
    const { message } = await nonceRes.json() as { message: string };
    const signature = signMessage(message, kp.secretKey);

    const verifyRes = await app.request('/auth/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', host: 'localhost:3000' },
      body: JSON.stringify({ wallet, signature }),
    });
    const setCookie = verifyRes.headers.get('set-cookie') ?? '';
    const token = setCookie.split(';')[0].replace('session=', '');

    // Expire the session
    db.prepare(`UPDATE sessions SET expires_at = 1 WHERE nonce = ''`).run();

    const meRes = await app.request('/auth/me', {
      headers: { cookie: `session=${token}` },
    });
    assert.equal(meRes.status, 401);
  });
});
