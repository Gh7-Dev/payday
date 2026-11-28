import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { getDb, migrate } from '../src/db.js';
import { MockChain } from '../src/chain/mock.js';
import { createApp } from '../src/index.js';

const PROGRAM = nacl.sign.keyPair().publicKey;
const PROGRAM_B58 = bs58.encode(PROGRAM);

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

function compact(n: number): number[] {
  return n < 128 ? [n] : [(n & 0x7f) | 0x80, n >> 7];
}
const cat = (...parts: ArrayLike<number>[]) => Uint8Array.from(parts.flatMap((p) => Array.from(p)));

function buildTx(opts: { trainer: nacl.SignKeyPair; programId?: Uint8Array; dataLen?: number }) {
  const trainee = nacl.sign.keyPair().publicKey;
  const programId = opts.programId ?? PROGRAM;
  const data = new Uint8Array(opts.dataLen ?? 9).fill(7);
  const message = cat(
    [2, 0, 1], compact(3), opts.trainer.publicKey, trainee, programId,
    new Uint8Array(32).fill(5), compact(1), [2], compact(2), [0, 1], compact(data.length), data,
  );
  const sig0 = nacl.sign.detached(message, opts.trainer.secretKey);
  return cat(compact(2), sig0, new Uint8Array(64), message);
}
const b64 = (u: Uint8Array) => Buffer.from(u).toString('base64');

function world(extra: { now?: () => number; maxPending?: number } = {}) {
  const db = getDb(':memory:');
  migrate(db);
  const chain = new MockChain();
  chain.createProgramme({
    organizer: 'org', backendKey: 'bk', mint: 'mint', programmeId: '1',
    startTs: BigInt(Math.floor(Date.now() / 1000) + 3600), dayLen: 86400n, days: 2, maxParticipants: 10,
  });
  const trainer = nacl.sign.keyPair();
  chain.addTrainer(bs58.encode(trainer.publicKey));
  const eventId = fill(db, 'events', { status: 'funded' });
  const app = createApp(db, chain, undefined, { programId: PROGRAM_B58, ttlSeconds: 60, ...extra });
  return { db, chain, app, trainer, eventId };
}

async function post(app: ReturnType<typeof createApp>, body: unknown) {
  const res = await app.request('/relay', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as any };
}
const get = async (app: ReturnType<typeof createApp>, id: string) => {
  const res = await app.request(`/relay/${id}`);
  return { status: res.status, json: (await res.json().catch(() => ({}))) as any };
};

describe('check-in relay', () => {
  test('valid half-signed tx is stored and fetched, no session needed', async () => {
    const w = world();
    const tx = b64(buildTx({ trainer: w.trainer }));
    const r = await post(w.app, { eventId: w.eventId, tx });
    assert.equal(r.status, 201);
    assert.match(r.json.id, /^[A-HJ-KM-NP-Z2-9]{8}$/);
    const g = await get(w.app, r.json.id);
    assert.equal(g.status, 200);
    assert.equal(g.json.tx, tx);
  });

  test('wrong program ID rejected', async () => {
    const w = world();
    const tx = b64(buildTx({ trainer: w.trainer, programId: nacl.sign.keyPair().publicKey }));
    assert.equal((await post(w.app, { eventId: w.eventId, tx })).status, 400);
  });

  test('oversize rejected with 413', async () => {
    const w = world();
    const tx = b64(buildTx({ trainer: w.trainer, dataLen: 1300 }));
    assert.equal((await post(w.app, { eventId: w.eventId, tx })).status, 413);
  });

  test('non-base64 and truncated rejected', async () => {
    const w = world();
    assert.equal((await post(w.app, { eventId: w.eventId, tx: 'not base64!!' })).status, 400);
    const cut = buildTx({ trainer: w.trainer }).slice(0, 100);
    assert.equal((await post(w.app, { eventId: w.eventId, tx: b64(cut) })).status, 400);
  });

  test('tampered message fails the signature check', async () => {
    const w = world();
    const raw = buildTx({ trainer: w.trainer });
    raw[raw.length - 1] ^= 1;
    assert.equal((await post(w.app, { eventId: w.eventId, tx: b64(raw) })).status, 400);
  });

  test('unsigned slot 0 rejected', async () => {
    const w = world();
    const raw = buildTx({ trainer: w.trainer });
    raw.fill(0, 1, 65);
    assert.equal((await post(w.app, { eventId: w.eventId, tx: b64(raw) })).status, 400);
  });

  test('unregistered trainer rejected with 403', async () => {
    const w = world();
    const tx = b64(buildTx({ trainer: nacl.sign.keyPair() }));
    assert.equal((await post(w.app, { eventId: w.eventId, tx })).status, 403);
  });

  test('unknown event gives 404', async () => {
    const w = world();
    const tx = b64(buildTx({ trainer: w.trainer }));
    assert.equal((await post(w.app, { eventId: 'nope', tx })).status, 404);
  });

  test('TTL 60 s: fetch ok at 59, gone (410) at 61 and row deleted', async () => {
    let t = 1_000_000;
    const w = world({ now: () => t });
    const r = await post(w.app, { eventId: w.eventId, tx: b64(buildTx({ trainer: w.trainer })) });
    assert.equal(r.status, 201);
    t += 59;
    assert.equal((await get(w.app, r.json.id)).status, 200);
    t += 2;
    assert.equal((await get(w.app, r.json.id)).status, 410);
    assert.equal((w.db.prepare('SELECT COUNT(*) AS n FROM pending_checkins').get() as any).n, 0);
  });

  test('pending cap gives 429', async () => {
    const w = world({ maxPending: 2 });
    const tx = () => b64(buildTx({ trainer: w.trainer }));
    assert.equal((await post(w.app, { eventId: w.eventId, tx: tx() })).status, 201);
    assert.equal((await post(w.app, { eventId: w.eventId, tx: tx() })).status, 201);
    assert.equal((await post(w.app, { eventId: w.eventId, tx: tx() })).status, 429);
  });

  test('unknown or malformed id gives 404', async () => {
    const w = world();
    assert.equal((await get(w.app, 'ABCDEFGH')).status, 404);
    assert.equal((await get(w.app, 'short')).status, 404);
  });

  test('relay not configured gives 503', async () => {
    const db = getDb(':memory:');
    migrate(db);
    const saved = process.env.PROGRAM_ID;
    delete process.env.PROGRAM_ID;
    const app = createApp(db, new MockChain());
    const res = await app.request('/relay', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    if (saved !== undefined) process.env.PROGRAM_ID = saved;
    assert.equal(res.status, 503);
  });
});
