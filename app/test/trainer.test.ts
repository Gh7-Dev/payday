import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { getDb, migrate } from '../src/db.js';
import { MockChain } from '../src/chain/mock.js';
import { createApp } from '../src/index.js';
import { ChainError } from '../src/chain/interface.js';

const TRAINER_CODE = 'trainerlinkcode123';
const BLOB = 'ZXhhbXBsZWtleWJsb2I='; // valid base64

function newWallet(): string {
  return bs58.encode(nacl.sign.keyPair().publicKey);
}

function fill(db: any, table: string, row: Record<string, unknown>) {
  const cols = Object.keys(row);
  const id = (row.id as string) ?? randomUUID();
  const now = Math.floor(Date.now() / 1000);
  const rec: Record<string, unknown> = { id, created_at: now, ...row };
  const allCols = Object.keys(rec);
  const sql = `INSERT INTO ${table} (${allCols.join(',')}) VALUES (${allCols.map(() => '?').join(',')})`;
  db.prepare(sql).run(...allCols.map((c) => rec[c]));
  return id;
}

function world() {
  const db = getDb(':memory:');
  migrate(db);
  const chain = new MockChain();
  const eventId = fill(db, 'events', {
    name: 'Trainer Event',
    organizer_wallet: newWallet(),
    start_date: 0,
    end_date: 0,
    start_ts: 1000,
    day_len_seconds: 86400,
    days: 5,
    max_participants: 10,
    decimals: 6,
    status: 'funded',
  });

  fill(db, 'claim_links', {
    event_id: eventId,
    link_type: 'trainer',
    code: createHash('sha256').update(TRAINER_CODE).digest('hex'),
  });

  const t1 = fill(db, 'trainers', {
    event_id: eventId,
    name: 'Alice Trainer',
    phone_e164: '+254712345678',
    state: 'invited',
  });

  const t2 = fill(db, 'trainers', {
    event_id: eventId,
    name: 'Bob Trainer',
    phone_e164: '+254722345678',
    state: 'invited',
  });

  const app = createApp(db, chain);
  return { db, chain, app, eventId, t1, t2 };
}

async function signup(app: ReturnType<typeof createApp>, over: Record<string, unknown> = {}, ip = '10.0.0.1') {
  const res = await app.request('/trainer/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify({
      linkCode: TRAINER_CODE,
      username: 'alice_trainer',
      phone: '0712345678',
      password: 'strongpassword123',
      wallet: newWallet(),
      encryptedKeyBlob: BLOB,
      ...over,
    }),
  });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as any };
}

describe('trainer signup flow', () => {
  const origN = process.env.SCRYPT_N;

  beforeEach(() => {
    process.env.SCRYPT_N = '1024';
  });

  afterEach(() => {
    if (origN !== undefined) {
      process.env.SCRYPT_N = origN;
    } else {
      delete process.env.SCRYPT_N;
    }
  });

  test('happy path ends funded and mock wallet balance equals top-up', async () => {
    const w = world();
    const wallet = newWallet();
    const res = await signup(w.app, { wallet });
    assert.equal(res.status, 200);
    assert.equal(res.json.state, 'funded');

    // check mock wallet balance (default top-up: 10_000_000n = 0.01 SOL)
    assert.equal(w.chain.getWalletBalance(wallet), 10_000_000n);

    // check DB row
    const row = w.db.prepare('SELECT state, username, wallet_address, topped_up_at, topped_up_lamports, password_hash FROM trainers WHERE id = ?').get(w.t1) as any;
    assert.equal(row.state, 'funded');
    assert.equal(row.username, 'alice_trainer');
    assert.equal(row.wallet_address, wallet);
    assert.ok(row.topped_up_at > 0);
    assert.equal(row.topped_up_lamports, '10000000');
    assert.ok(String(row.password_hash).startsWith('scrypt$') && !String(row.password_hash).includes('strongpassword123'));
  });

  test('phone not on list gives 404', async () => {
    const w = world();
    const res = await signup(w.app, { phone: '0799999999' });
    assert.equal(res.status, 404);
  });

  test('wrong link gives 404', async () => {
    const w = world();
    const res = await signup(w.app, { linkCode: 'wronglinkcode' });
    assert.equal(res.status, 404);
  });

  test('second wallet on a signed_up row gives 409', async () => {
    const w = world();
    // Stub topUp to fail so trainer transitions to signed_up
    const origTopUp = w.chain.topUp.bind(w.chain);
    w.chain.topUp = async () => {
      throw new ChainError('TopUpFailed', 'topup failed');
    };

    const wallet1 = newWallet();
    const res1 = await signup(w.app, { wallet: wallet1 });
    assert.equal(res1.status, 502);

    const row = w.db.prepare('SELECT state FROM trainers WHERE id = ?').get(w.t1) as any;
    assert.equal(row.state, 'signed_up');

    // Attempt signup with second wallet on same signed_up trainer
    const wallet2 = newWallet();
    const res2 = await signup(w.app, { wallet: wallet2 });
    assert.equal(res2.status, 409);
  });

  test('duplicate username in one event gives 409', async () => {
    const w = world();
    // t1 signs up with username 'alice_trainer'
    const res1 = await signup(w.app, { username: 'alice_trainer' });
    assert.equal(res1.status, 200);

    // t2 tries to sign up with duplicate username 'alice_trainer' in the same event
    const res2 = await signup(w.app, { phone: '0722345678', username: 'alice_trainer' });
    assert.equal(res2.status, 409);
  });

  test('top-up failure leaves signed_up and retry succeeds', async () => {
    const w = world();
    let shouldFail = true;
    const origTopUp = w.chain.topUp.bind(w.chain);
    w.chain.topUp = async (wallet, lamports) => {
      if (shouldFail) {
        throw new ChainError('RpcError', 'rpc timeout');
      }
      return origTopUp(wallet, lamports);
    };

    const wallet = newWallet();
    const res1 = await signup(w.app, { wallet });
    assert.equal(res1.status, 502);
    assert.equal(res1.json.error, 'RpcError');

    const rowAfterFail = w.db.prepare('SELECT state, topped_up_at FROM trainers WHERE id = ?').get(w.t1) as any;
    assert.equal(rowAfterFail.state, 'signed_up');
    assert.equal(rowAfterFail.topped_up_at, null);

    // Unblock topUp and retry with same wallet and password
    shouldFail = false;
    const res2 = await signup(w.app, { wallet });
    assert.equal(res2.status, 200);
    assert.equal(res2.json.state, 'funded');
    assert.equal(w.chain.getWalletBalance(wallet), 10_000_000n);
  });

  test('total cap reached gives 409 and no top-up', async () => {
    const origCap = process.env.TOPUP_TOTAL_CAP_LAMPORTS;
    try {
      // Set cap to 15_000_000n (less than 2 x 10_000_000n)
      process.env.TOPUP_TOTAL_CAP_LAMPORTS = '15000000';
      const w = world();

      // First trainer tops up 10_000_000n (within 15_000_000 cap)
      const res1 = await signup(w.app, { phone: '0712345678', username: 'trainer_one' });
      assert.equal(res1.status, 200);

      // Second trainer tries to top up 10_000_000n (10m + 10m = 20m > 15m cap)
      const wallet2 = newWallet();
      const res2 = await signup(w.app, { phone: '0722345678', username: 'trainer_two', wallet: wallet2 });
      assert.equal(res2.status, 409);
      assert.equal(res2.json.error, 'topup_cap');
      assert.equal(w.chain.getWalletBalance(wallet2), 0n);

      const row2 = w.db.prepare('SELECT state, topped_up_at FROM trainers WHERE id = ?').get(w.t2) as any;
      assert.equal(row2.state, 'signed_up');
      assert.equal(row2.topped_up_at, null);
    } finally {
      if (origCap !== undefined) {
        process.env.TOPUP_TOTAL_CAP_LAMPORTS = origCap;
      } else {
        delete process.env.TOPUP_TOTAL_CAP_LAMPORTS;
      }
    }
  });

  test('a funded trainer never gets a second top-up', async () => {
    const w = world();
    const wallet = newWallet();
    const res1 = await signup(w.app, { wallet });
    assert.equal(res1.status, 200);
    assert.equal(res1.json.state, 'funded');
    assert.equal(w.chain.getWalletBalance(wallet), 10_000_000n);

    // Call again
    let topUpCalls = 0;
    const origTopUp = w.chain.topUp.bind(w.chain);
    w.chain.topUp = async (...args) => {
      topUpCalls++;
      return origTopUp(...args);
    };

    const res2 = await signup(w.app, { wallet });
    assert.equal(res2.status, 200);
    assert.equal(res2.json.state, 'funded');
    assert.equal(topUpCalls, 0);
    assert.equal(w.chain.getWalletBalance(wallet), 10_000_000n);
  });

  test('5 failures from one IP give 429', async () => {
    const w = world();
    for (let i = 1; i <= 5; i++) {
      const res = await signup(w.app, { phone: `07110000${i}0` }, '5.5.5.5');
      assert.equal(res.status, 404);
    }
    const locked = await signup(w.app, {}, '5.5.5.5');
    assert.equal(locked.status, 429);
  });

  test('short password or bad username gives 400', async () => {
    const w = world();
    // Short password (< 8 chars)
    const res1 = await signup(w.app, { password: 'short' });
    assert.equal(res1.status, 400);

    // Bad username (uppercase or invalid characters or length < 3)
    const res2 = await signup(w.app, { username: 'ALICE' });
    assert.equal(res2.status, 400);

    const res3 = await signup(w.app, { username: 'al' });
    assert.equal(res3.status, 400);

    const res4 = await signup(w.app, { username: 'alice-bad-hyphen' });
    assert.equal(res4.status, 400);
  });

  test('two concurrent signups with a cap that fits only one: exactly one is topped up and the other gets 409 topup_cap', async () => {
    const origCap = process.env.TOPUP_TOTAL_CAP_LAMPORTS;
    try {
      process.env.TOPUP_TOTAL_CAP_LAMPORTS = '10000000'; // Only fits 1 trainer
      const w = world();

      const wallet1 = newWallet();
      const wallet2 = newWallet();

      const [res1, res2] = await Promise.all([
        signup(w.app, { phone: '0712345678', username: 'trainer_one', wallet: wallet1 }, '1.1.1.1'),
        signup(w.app, { phone: '0722345678', username: 'trainer_two', wallet: wallet2 }, '1.1.1.2'),
      ]);

      const statuses = [res1.status, res2.status].sort();
      assert.deepEqual(statuses, [200, 409]);

      const capRes = res1.status === 409 ? res1 : res2;
      assert.equal(capRes.json.error, 'topup_cap');

      const okRes = res1.status === 200 ? res1 : res2;
      assert.equal(okRes.json.state, 'funded');

      const b1 = w.chain.getWalletBalance(wallet1);
      const b2 = w.chain.getWalletBalance(wallet2);
      assert.ok((b1 === 10_000_000n && b2 === 0n) || (b1 === 0n && b2 === 10_000_000n));
    } finally {
      if (origCap !== undefined) {
        process.env.TOPUP_TOTAL_CAP_LAMPORTS = origCap;
      } else {
        delete process.env.TOPUP_TOTAL_CAP_LAMPORTS;
      }
    }
  });

  test('a failed topUp releases the reservation so the retry succeeds and a second trainer can still use the cap', async () => {
    const origCap = process.env.TOPUP_TOTAL_CAP_LAMPORTS;
    try {
      // Cap fits 2 trainers: 20_000_000n
      process.env.TOPUP_TOTAL_CAP_LAMPORTS = '20000000';
      const w = world();

      let shouldFail = true;
      const origTopUp = w.chain.topUp.bind(w.chain);
      w.chain.topUp = async (wallet, lamports) => {
        if (shouldFail) {
          throw new ChainError('RpcError', 'timeout');
        }
        return origTopUp(wallet, lamports);
      };

      const wallet1 = newWallet();
      const res1 = await signup(w.app, { phone: '0712345678', username: 'trainer_one', wallet: wallet1 }, '1.1.1.1');
      assert.equal(res1.status, 502);

      // Verify reservation was released in DB
      const row1 = w.db.prepare('SELECT state, topped_up_at, topped_up_lamports FROM trainers WHERE id = ?').get(w.t1) as any;
      assert.equal(row1.state, 'signed_up');
      assert.equal(row1.topped_up_at, null);
      assert.equal(row1.topped_up_lamports, null);

      // Stop chain failure
      shouldFail = false;

      // Retry signup for trainer 1
      const res1Retry = await signup(w.app, { phone: '0712345678', username: 'trainer_one', wallet: wallet1 }, '1.1.1.1');
      assert.equal(res1Retry.status, 200);
      assert.equal(res1Retry.json.state, 'funded');

      // Now trainer 2 can still use the cap
      const wallet2 = newWallet();
      const res2 = await signup(w.app, { phone: '0722345678', username: 'trainer_two', wallet: wallet2 }, '1.1.1.2');
      assert.equal(res2.status, 200);
      assert.equal(res2.json.state, 'funded');

      assert.equal(w.chain.getWalletBalance(wallet1), 10_000_000n);
      assert.equal(w.chain.getWalletBalance(wallet2), 10_000_000n);
    } finally {
      if (origCap !== undefined) {
        process.env.TOPUP_TOTAL_CAP_LAMPORTS = origCap;
      } else {
        delete process.env.TOPUP_TOTAL_CAP_LAMPORTS;
      }
    }
  });

  test('unlock ok / wrong password 401 / invited 409', async () => {
    const w = world();
    const wallet = newWallet();

    // 1. Trainer 2 is in 'invited' state -> unlock gives 409 (invalid_state)
    const resInvited = await w.app.request('/trainer/unlock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        linkCode: TRAINER_CODE,
        username: 'nonexistent_or_invited',
        password: 'password123',
      }),
    });
    // For invited trainer with username
    w.db.prepare("UPDATE trainers SET username = 'invited_user' WHERE id = ?").run(w.t2);
    const resInvited2 = await w.app.request('/trainer/unlock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        linkCode: TRAINER_CODE,
        username: 'invited_user',
        password: 'password123',
      }),
    });
    assert.equal(resInvited2.status, 409);
    const jsonInvited = await resInvited2.json();
    assert.equal(jsonInvited.error, 'invalid_state');

    // 2. Sign up trainer 1 so they are funded
    const signupRes = await signup(w.app, {
      phone: '0712345678',
      username: 'alice_trainer',
      password: 'mypassword123',
      wallet,
      encryptedKeyBlob: BLOB,
    });
    assert.equal(signupRes.status, 200);

    // 3. Unlock with wrong password -> 401
    const resWrong = await w.app.request('/trainer/unlock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        linkCode: TRAINER_CODE,
        username: 'alice_trainer',
        password: 'wrongpassword123',
      }),
    });
    assert.equal(resWrong.status, 401);
    const jsonWrong = await resWrong.json();
    assert.equal(jsonWrong.error, 'wrong_password');

    // 4. Unlock with correct password -> 200 { wallet, encryptedKeyBlob, state }
    const resOk = await w.app.request('/trainer/unlock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        linkCode: TRAINER_CODE,
        username: 'alice_trainer',
        password: 'mypassword123',
      }),
    });
    assert.equal(resOk.status, 200);
    const jsonOk = await resOk.json();
    assert.equal(jsonOk.wallet, wallet);
    assert.equal(jsonOk.encryptedKeyBlob, BLOB);
    assert.equal(jsonOk.state, 'funded');
  });

  test('sync marks a trainer registered only after mock.addTrainer(wallet); sync for another wallet\'s event 404; no session on sync 401', async () => {
    const w = world();
    const organizerWallet = (w.db.prepare('SELECT organizer_wallet FROM events WHERE id = ?').get(w.eventId) as any).organizer_wallet;

    // Helper to create valid session token for organizerWallet
    const sessionToken = 'test-session-' + randomUUID();
    const tokenHash = createHash('sha256').update(sessionToken).digest('hex');
    const now = Math.floor(Date.now() / 1000);
    w.db.prepare('INSERT INTO sessions (id, wallet_address, nonce, expires_at, created_at) VALUES (?, ?, ?, ?, ?)').run(
      tokenHash,
      organizerWallet,
      '',
      now + 3600,
      now
    );

    // Another organizer wallet session
    const otherWallet = newWallet();
    const otherToken = 'other-session-' + randomUUID();
    const otherTokenHash = createHash('sha256').update(otherToken).digest('hex');
    w.db.prepare('INSERT INTO sessions (id, wallet_address, nonce, expires_at, created_at) VALUES (?, ?, ?, ?, ?)').run(
      otherTokenHash,
      otherWallet,
      '',
      now + 3600,
      now
    );

    // Initialize mock chain programme so addTrainer works
    w.chain.createProgramme({
      organizer: organizerWallet,
      backendKey: newWallet(),
      mint: newWallet(),
      programmeId: 'prog123',
      startTs: 1000n,
      dayLen: 86400n,
      days: 5,
      maxParticipants: 10,
    });

    // Sign up trainer 1 -> funded
    const wallet1 = newWallet();
    const s1 = await signup(w.app, { phone: '0712345678', username: 'trainer_one', wallet: wallet1 });
    assert.equal(s1.status, 200);
    assert.equal(s1.json.state, 'funded');

    // 1. No session on sync -> 401
    const resNoAuth = await w.app.request(`/events/${w.eventId}/trainers/sync`, {
      method: 'POST',
    });
    assert.equal(resNoAuth.status, 401);

    // 2. Sync for another wallet's event -> 404
    const resOther = await w.app.request(`/events/${w.eventId}/trainers/sync`, {
      method: 'POST',
      headers: { Cookie: `session=${otherToken}` },
    });
    assert.equal(resOther.status, 404);

    // 3. Sync before addTrainer -> trainer is pending, not registered
    const resSyncBefore = await w.app.request(`/events/${w.eventId}/trainers/sync`, {
      method: 'POST',
      headers: { Cookie: `session=${sessionToken}` },
    });
    assert.equal(resSyncBefore.status, 200);
    const jsonSyncBefore = await resSyncBefore.json();
    assert.deepEqual(jsonSyncBefore.registered, []);
    assert.deepEqual(jsonSyncBefore.pending, ['Alice Trainer']);

    let row = w.db.prepare('SELECT state FROM trainers WHERE id = ?').get(w.t1) as any;
    assert.equal(row.state, 'funded');

    // 4. Add trainer on chain and sync again -> now registered
    w.chain.addTrainer(wallet1);

    const resSyncAfter = await w.app.request(`/events/${w.eventId}/trainers/sync`, {
      method: 'POST',
      headers: { Cookie: `session=${sessionToken}` },
    });
    assert.equal(resSyncAfter.status, 200);
    const jsonSyncAfter = await resSyncAfter.json();
    assert.deepEqual(jsonSyncAfter.registered, ['Alice Trainer']);
    assert.deepEqual(jsonSyncAfter.pending, []);

    row = w.db.prepare('SELECT state FROM trainers WHERE id = ?').get(w.t1) as any;
    assert.equal(row.state, 'registered');

    // Sync once more: now trainer state is registered (not funded), so not re-returned in sync
    const resSyncAgain = await w.app.request(`/events/${w.eventId}/trainers/sync`, {
      method: 'POST',
      headers: { Cookie: `session=${sessionToken}` },
    });
    assert.equal(resSyncAgain.status, 200);
    const jsonSyncAgain = await resSyncAgain.json();
    assert.deepEqual(jsonSyncAgain.registered, []);
    assert.deepEqual(jsonSyncAgain.pending, []);
  });
});
