process.env.SCRYPT_N = process.env.SCRYPT_N ?? '1024';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { getDb, migrate } from '../src/db.js';
import { MockChain } from '../src/chain/mock.js';
import { createApp } from '../src/index.js';

const CODE = 'link-code-abc';
const BLOB = Buffer.from('ciphertext-bytes').toString('base64');
const newWallet = () => bs58.encode(nacl.sign.keyPair().publicKey);

function fill(db: DatabaseSync, table: string, over: Record<string, unknown>): string {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string; type: string; notnull: number; dflt_value: unknown; pk: number }>;
  const row: Record<string, unknown> = {};
  for (const c of cols) {
    if (c.name in over) { row[c.name] = over[c.name]; continue; }
    if (c.pk) { row[c.name] = randomUUID(); continue; }
    if (c.notnull && c.dflt_value === null) row[c.name] = /INT/i.test(c.type) ? 1 : `x_${randomUUID().slice(0, 8)}`;
  }
  const names = Object.keys(row);
  db.prepare(`INSERT INTO ${table} (${names.join(',')}) VALUES (${names.map(() => '?').join(',')})`).run(...(names.map((n) => row[n]) as any[]));
  return String(row['id']);
}

function world(opts: { fund?: boolean; status?: string } = {}) {
  const db = getDb(':memory:');
  migrate(db);
  const chain = new MockChain();
  chain.createProgramme({
    organizer: 'org', backendKey: 'bk', mint: 'mint', programmeId: '1',
    startTs: BigInt(Math.floor(Date.now() / 1000) + 3600), dayLen: 86400n, days: 2, maxParticipants: 10,
  });
  if (opts.fund !== false) chain.fund(1_000_000n);
  const eventId = fill(db, 'events', { status: opts.status ?? 'funded', days: 2, max_participants: 10 });
  fill(db, 'claim_links', { event_id: eventId, link_type: 'trainee', code: createHash('sha256').update(CODE).digest('hex') });
  const p1 = fill(db, 'participants', { event_id: eventId, phone_e164: '+254712345678', amounts: JSON.stringify(['100', '200']), claim_state: 'unclaimed' });
  const p2 = fill(db, 'participants', { event_id: eventId, phone_e164: '+254722345678', amounts: JSON.stringify(['100', '200']), claim_state: 'unclaimed' });
  const app = createApp(db, chain);
  return { db, chain, app, eventId, p1, p2 };
}

async function claim(app: ReturnType<typeof createApp>, over: Record<string, unknown> = {}, ip = '10.0.0.1') {
  const res = await app.request('/claim', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify({ linkCode: CODE, phone: '0712345678', pin: '123456', wallet: newWallet(), encryptedKeyBlob: BLOB, ...over }),
  });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as any };
}

describe('claim flow', () => {
  test('happy path: enrolled, hashed PIN, no session cookie needed', async () => {
    const w = world();
    const wallet = newWallet();
    const r = await claim(w.app, { wallet });
    assert.equal(r.status, 200);
    assert.equal(r.json.state, 'enrolled');
    assert.equal(await w.chain.isEnrolled(wallet), true);
    const row = w.db.prepare('SELECT claim_state, wallet_address, pin_hash FROM participants WHERE id = ?').get(w.p1) as any;
    assert.equal(row.claim_state, 'enrolled');
    assert.equal(row.wallet_address, wallet);
    assert.ok(String(row.pin_hash).startsWith('scrypt$') && !String(row.pin_hash).includes('123456'));
  });

  test('phone not on the list gives 404', async () => {
    const w = world();
    assert.equal((await claim(w.app, { phone: '0799999999' })).status, 404);
  });

  test('before funded gives 409', async () => {
    const w = world({ status: 'draft' });
    assert.equal((await claim(w.app)).status, 409);
  });

  test('unknown link gives 404', async () => {
    const w = world();
    assert.equal((await claim(w.app, { linkCode: 'nope' })).status, 404);
  });

  test('enroll failure leaves pending; retry succeeds; second wallet rejected', async () => {
    const w = world({ fund: false });
    const wallet = newWallet();
    const r1 = await claim(w.app, { wallet });
    assert.equal(r1.status, 502);
    assert.equal((w.db.prepare('SELECT claim_state FROM participants WHERE id = ?').get(w.p1) as any).claim_state, 'pending');
    assert.equal((await claim(w.app, { wallet: newWallet() })).status, 409);
    w.chain.fund(1_000_000n);
    const r2 = await claim(w.app, { wallet });
    assert.equal(r2.status, 200);
    assert.equal((w.db.prepare('SELECT claim_state FROM participants WHERE id = ?').get(w.p1) as any).claim_state, 'enrolled');
  });

  test('two concurrent claims on one row: exactly one wins', async () => {
    const w = world();
    const [a, b] = await Promise.all([claim(w.app, { wallet: newWallet() }), claim(w.app, { wallet: newWallet() })]);
    const statuses = [a.status, b.status].sort();
    assert.deepEqual(statuses, [200, 409]);
  });

  test('same wallet on two rows gives 409', async () => {
    const w = world();
    const wallet = newWallet();
    assert.equal((await claim(w.app, { wallet })).status, 200);
    assert.equal((await claim(w.app, { wallet, phone: '0722345678' })).status, 409);
  });

  test('pending row already enrolled on chain skips a second enroll', async () => {
    const w = world();
    const wallet = newWallet();
    await w.chain.enroll(wallet, [100n, 200n]);
    let calls = 0;
    const orig = w.chain.enroll.bind(w.chain);
    (w.chain as any).enroll = async (...args: any[]) => { calls++; return (orig as any)(...args); };
    const r = await claim(w.app, { wallet });
    assert.equal(r.status, 200);
    assert.equal(calls, 0);
  });

  test('wrong PIN on retry gives 401 and is counted: 5 wrong then 429', async () => {
    const w = world({ fund: false });
    const wallet = newWallet();
    assert.equal((await claim(w.app, { wallet }, '7.7.7.7')).status, 502);
    for (let i = 0; i < 5; i++) assert.equal((await claim(w.app, { wallet, pin: '000000' }, '8.8.8.8')).status, 401);
    assert.equal((await claim(w.app, { wallet }, '8.8.8.8')).status, 429);
  });

  test('5 failures from one IP give 429 even for a valid phone', async () => {
    const w = world();
    for (let i = 1; i <= 5; i++) assert.equal((await claim(w.app, { phone: `07110000${i}0` }, '9.9.9.9')).status, 404);
    assert.equal((await claim(w.app, {}, '9.9.9.9')).status, 429);
  });

  test('bad PIN format or wallet gives 400', async () => {
    const w = world();
    assert.equal((await claim(w.app, { pin: '12345' })).status, 400);
    assert.equal((await claim(w.app, { wallet: 'not-a-wallet!!' })).status, 400);
  });

  test('unlock after a claim returns the same wallet and blob', async () => {
    const w = world();
    const wallet = newWallet();
    const cr = await claim(w.app, { wallet });
    assert.equal(cr.status, 200);

    const res = await w.app.request('/claim/unlock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ linkCode: CODE, phone: '0712345678', pin: '123456' }),
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as any;
    assert.equal(body.wallet, wallet);
    assert.equal(body.encryptedKeyBlob, BLOB);
  });

  test('unlock with wrong PIN gives 401', async () => {
    const w = world();
    const wallet = newWallet();
    await claim(w.app, { wallet });

    const res = await w.app.request('/claim/unlock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ linkCode: CODE, phone: '0712345678', pin: '000000' }),
    });
    assert.equal(res.status, 401);
  });

  test('unlock before enrolled (pending) gives 409', async () => {
    const w = world({ fund: false });
    const wallet = newWallet();
    const cr = await claim(w.app, { wallet });
    assert.equal(cr.status, 502);

    const res = await w.app.request('/claim/unlock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ linkCode: CODE, phone: '0712345678', pin: '123456' }),
    });
    assert.equal(res.status, 409);
  });

  test('unlock with phone not on the list gives 404', async () => {
    const w = world();
    const res = await w.app.request('/claim/unlock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ linkCode: CODE, phone: '0799999999', pin: '123456' }),
    });
    assert.equal(res.status, 404);
  });

  test('5 wrong PINs from one IP then 429', async () => {
    const w = world();
    const wallet = newWallet();
    await claim(w.app, { wallet });

    for (let i = 0; i < 5; i++) {
      const res = await w.app.request('/claim/unlock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '4.4.4.4' },
        body: JSON.stringify({ linkCode: CODE, phone: '0712345678', pin: '000000' }),
      });
      assert.equal(res.status, 401);
    }

    const locked = await w.app.request('/claim/unlock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '4.4.4.4' },
      body: JSON.stringify({ linkCode: CODE, phone: '0712345678', pin: '123456' }),
    });
    assert.equal(locked.status, 429);
  });

  test("participant 2's phone with participant 1's PIN gives 401 and never returns participant 1's data", async () => {
    const w = world();
    const w1 = newWallet();
    const w2 = newWallet();
    const b1 = 'blob1blob1==';
    const b2 = 'blob2blob2==';

    // Claim p1 with PIN 111111
    const cr1 = await claim(w.app, { phone: '0712345678', pin: '111111', wallet: w1, encryptedKeyBlob: b1 });
    assert.equal(cr1.status, 200);

    // Claim p2 with PIN 222222
    const cr2 = await claim(w.app, { phone: '0722345678', pin: '222222', wallet: w2, encryptedKeyBlob: b2 });
    assert.equal(cr2.status, 200);

    // Unlock p2 using p1's PIN (111111)
    const res = await w.app.request('/claim/unlock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ linkCode: CODE, phone: '0722345678', pin: '111111' }),
    });
    assert.equal(res.status, 401);
    const body = (await res.json()) as any;
    assert.notEqual(body.wallet, w1);
    assert.notEqual(body.encryptedKeyBlob, b1);
  });
});
