import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { createHash } from 'node:crypto';
import { getDb, migrate } from '../src/db.js';
import { MockChain } from '../src/chain/mock.js';
import { createApp } from '../src/index.js';

function signMessage(message: string, secretKey: Uint8Array): string {
  const msgBytes = new TextEncoder().encode(message);
  const sig = nacl.sign.detached(msgBytes, secretKey);
  return bs58.encode(sig);
}

async function loginOrganizer(app: ReturnType<typeof createApp>, kp: nacl.SignKeyPair) {
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
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ wallet, signature }),
  });
  const cookieHeader = verifyRes.headers.get('set-cookie') ?? '';
  const token = cookieHeader.split(';')[0].replace('session=', '');
  return { wallet, cookie: `session=${token}` };
}

import { DatabaseSync as CsDB } from 'node:sqlite';
import { readFileSync as csRead } from 'node:fs';

const csNow = () => BigInt(Math.floor(Date.now() / 1000));

function csProg(startOffset: bigint, over: Record<string, unknown> = {}) {
  return {
    organizer: 'O', backendKey: 'B', mint: 'M', programmeId: '1',
    startTs: csNow() + startOffset, dayLen: 3600n, days: 3, maxParticipants: 5,
    enrolled: 1, totalFunded: 3000000n, totalPaid: 0n, totalReclaimed: 0n,
    committed: 300000n, bump: 1, vaultBump: 1, reclaimed: false, ...over,
  };
}

function csStub(programme: any, vault: bigint, boom = false) {
  return {
    async getProgramme() { if (boom) throw new Error('rpc boom secret-detail'); return programme; },
    async getVaultBalance() { if (boom) throw new Error('rpc boom secret-detail'); return vault; },
  } as any;
}

async function csEnv(chain: any) {
  const db = new CsDB(':memory:');
  if (true) db.exec(csRead(new URL('../src/schema.sql', import.meta.url), 'utf8'));
  const app = createApp(db, chain);
  const org = await loginOrganizer(app, nacl.sign.keyPair());
  db.prepare(
    `INSERT INTO events (id,name,organizer_wallet,start_date,end_date,start_ts,day_len_seconds,days,max_participants,decimals,created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
  ).run('ev1', 'T', org.wallet, 0, 0, 0, 3600, 3, 5, 6, 0);
  return { db, app, org };
}

async function csGet(env: any, cookie?: string) {
  const res = await env.app.request('/events/ev1/chain-status', cookie ? { headers: { cookie } } : {});
  return { status: res.status, body: await res.json().catch(() => null) as any };
}

test('chain-status: no session gives 401', async () => {
  const env = await csEnv(csStub(null, 0n));
  assert.equal((await csGet(env)).status, 401);
});

test('chain-status: not_created when the programme does not exist', async () => {
  const env = await csEnv(csStub(null, 0n));
  const r = await csGet(env, env.org.cookie);
  assert.equal(r.status, 200);
  assert.equal(r.body.phase, 'not_created');
  assert.equal(r.body.programme, null);
  assert.equal(r.body.reclaimable, false);
});

test('chain-status: not_started before the start time', async () => {
  const env = await csEnv(csStub(csProg(10000n), 3000000n));
  const r = await csGet(env, env.org.cookie);
  assert.equal(r.body.phase, 'not_started');
  assert.equal(r.body.currentDay, null);
});

test('chain-status: running day 0, bigints are strings', async () => {
  const env = await csEnv(csStub(csProg(-100n), 3000000n));
  const r = await csGet(env, env.org.cookie);
  assert.equal(r.body.phase, 'running');
  assert.equal(r.body.currentDay, 0);
  assert.equal(r.body.vaultBalance, '3000000');
  assert.equal(r.body.programme.totalFunded, '3000000');
  assert.equal(r.body.reclaimable, false);
});

test('chain-status: running day 1', async () => {
  const env = await csEnv(csStub(csProg(-3700n), 3000000n));
  const r = await csGet(env, env.org.cookie);
  assert.equal(r.body.phase, 'running');
  assert.equal(r.body.currentDay, 1);
});

test('chain-status: running on the last day (day 2)', async () => {
  const env = await csEnv(csStub(csProg(-7300n), 3000000n));
  const r = await csGet(env, env.org.cookie);
  assert.equal(r.body.phase, 'running');
  assert.equal(r.body.currentDay, 2);
});

test('chain-status: ended with funds is reclaimable', async () => {
  const env = await csEnv(csStub(csProg(-10900n), 500n));
  const r = await csGet(env, env.org.cookie);
  assert.equal(r.body.phase, 'ended');
  assert.equal(r.body.currentDay, null);
  assert.equal(r.body.reclaimable, true);
});

test('chain-status: ended with an empty vault is not reclaimable', async () => {
  const env = await csEnv(csStub(csProg(-10900n), 0n));
  const r = await csGet(env, env.org.cookie);
  assert.equal(r.body.phase, 'ended');
  assert.equal(r.body.reclaimable, false);
});

test('chain-status: reclaimed phase', async () => {
  const env = await csEnv(csStub(csProg(-10900n, { reclaimed: true }), 0n));
  const r = await csGet(env, env.org.cookie);
  assert.equal(r.body.phase, 'reclaimed');
  assert.equal(r.body.reclaimable, false);
});

test('chain-status: another organizer gets 404', async () => {
  const env = await csEnv(csStub(csProg(-100n), 3000000n));
  const other = await loginOrganizer(env.app, nacl.sign.keyPair());
  const r = await csGet(env, other.cookie);
  assert.equal(r.status, 404);
});

test('chain-status: chain failure gives 502 and leaks nothing', async () => {
  const env = await csEnv(csStub(null, 0n, true));
  const res = await env.app.request('/events/ev1/chain-status', { headers: { cookie: env.org.cookie } });
  const text = await res.text();
  assert.equal(res.status, 502);
  assert.ok(text.includes('chain_unavailable'));
  assert.ok(!text.includes('secret-detail'));
});
