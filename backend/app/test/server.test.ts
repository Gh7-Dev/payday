import test from 'node:test';
import assert from 'node:assert/strict';
import bs58 from 'bs58';
import { Keypair } from '@solana/web3.js';
import { createApp } from '../src/index.js';
import { getDb, migrate } from '../src/db.js';
import idl from '../src/chain/payday.idl.json' with { type: 'json' };

test('server CORS and health preflight / request tests', async () => {
  const db = getDb(':memory:');
  migrate(db);
  const app = createApp(db);

  // 1. GET /health still returns 200 and { status: 'ok' }
  const healthRes = await app.request('/health');
  assert.equal(healthRes.status, 200);
  const healthBody = await healthRes.json();
  assert.deepEqual(healthBody, { status: 'ok' });

  // 2. Preflight OPTIONS from allowed origin returns Access-Control-Allow-Origin equal to origin and credentials true
  const allowedOrigin = 'http://localhost:5173';
  const preflightRes = await app.request('/health', {
    method: 'OPTIONS',
    headers: {
      Origin: allowedOrigin,
      'Access-Control-Request-Method': 'GET',
    },
  });
  assert.equal(preflightRes.headers.get('access-control-allow-origin'), allowedOrigin);
  assert.equal(preflightRes.headers.get('access-control-allow-credentials'), 'true');

  // 3. Preflight OPTIONS from disallowed origin gets no Access-Control-Allow-Origin header
  const disallowedOrigin = 'http://evil.com';
  const disallowedPreflightRes = await app.request('/health', {
    method: 'OPTIONS',
    headers: {
      Origin: disallowedOrigin,
      'Access-Control-Request-Method': 'GET',
    },
  });
  assert.equal(disallowedPreflightRes.headers.get('access-control-allow-origin'), null);
});

test('GET /config returns 200 with expected shape for mock chain', async () => {
  const db = getDb(':memory:');
  migrate(db);
  const app = createApp(db);

  const res = await app.request('/config');
  assert.equal(res.status, 200);
  const body = await res.json();

  assert.equal(body.chain, 'mock');
  assert.equal(body.cluster, 'devnet');
  assert.equal(body.programId, (idl as any).address);
  assert.ok(typeof body.backendKey === 'string');
});

test('GET /config backendKey is 32 bytes when base58-decoded', async () => {
  const db = getDb(':memory:');
  migrate(db);
  const app = createApp(db);

  const res = await app.request('/config');
  assert.equal(res.status, 200);
  const body = await res.json();

  const decoded = bs58.decode(body.backendKey);
  assert.equal(decoded.length, 32);
});

test('GET /config with RealChain test double carrying known keypair returns public key and no secret string', async () => {
  const db = getDb(':memory:');
  migrate(db);

  const backendKeypair = Keypair.generate();
  const secretKeyStr = bs58.encode(backendKeypair.secretKey);
  const realChainDouble: any = {
    backendKeypair,
  };

  const app = createApp(db, realChainDouble);

  const res = await app.request('/config');
  assert.equal(res.status, 200);

  const rawText = await res.text();
  assert.ok(!rawText.includes(secretKeyStr), 'Response must not contain backend secret key string');

  const body = JSON.parse(rawText);
  assert.equal(body.chain, 'real');
  assert.equal(body.cluster, 'devnet');
  assert.equal(body.programId, (idl as any).address);
  assert.equal(body.backendKey, backendKeypair.publicKey.toBase58());
});

test('GET /config requires no session cookie or auth header', async () => {
  const db = getDb(':memory:');
  migrate(db);
  const app = createApp(db);

  // Request completely without any headers or cookies
  const res = await app.request('/config', {
    method: 'GET',
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.programId);
});
