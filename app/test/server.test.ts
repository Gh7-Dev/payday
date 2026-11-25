import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/index.js';
import { getDb, migrate } from '../src/db.js';

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
