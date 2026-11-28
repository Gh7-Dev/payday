import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { app } from '../src/index.js';

describe('health route', () => {
  it('health route -> 200', async () => {
    const res = await app.request('/health');
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.deepEqual(data, { status: 'ok' });
  });
});
