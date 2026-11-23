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

describe('organizer routes', () => {
  test('no session gives 401', async () => {
    const db = getDb(':memory:');
    migrate(db);
    const app = createApp(db);

    const res = await app.request('/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Test Event',
        startDate: '2026-12-01',
        endDate: '2026-12-05',
        decimals: 6,
        maxParticipants: 10,
      }),
    });
    assert.equal(res.status, 401);
  });

  test("another wallet's event gives 404", async () => {
    const db = getDb(':memory:');
    migrate(db);
    const app = createApp(db);

    const kp1 = nacl.sign.keyPair();
    const kp2 = nacl.sign.keyPair();

    const org1 = await loginOrganizer(app, kp1);
    const org2 = await loginOrganizer(app, kp2);

    // org1 creates event
    const createRes = await app.request('/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: org1.cookie },
      body: JSON.stringify({
        name: 'Event 1',
        startDate: '2026-12-01',
        endDate: '2026-12-05',
        decimals: 6,
        maxParticipants: 10,
      }),
    });
    assert.equal(createRes.status, 201);
    const event = await createRes.json() as { id: string };

    // org2 attempts to get or modify org1's event -> 404
    const getRes = await app.request(`/events/${event.id}`, {
      headers: { cookie: org2.cookie },
    });
    assert.equal(getRes.status, 404);

    const addTrainerRes = await app.request(`/events/${event.id}/trainers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: org2.cookie },
      body: JSON.stringify({ name: 'Trainer A', phone: '0712345678' }),
    });
    assert.equal(addTrainerRes.status, 404);
  });

  test('trainer addable after creation', async () => {
    const db = getDb(':memory:');
    migrate(db);
    const app = createApp(db);
    const kp = nacl.sign.keyPair();
    const org = await loginOrganizer(app, kp);

    const createRes = await app.request('/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: org.cookie },
      body: JSON.stringify({
        name: 'Event with trainers',
        startDate: '2026-12-01',
        endDate: '2026-12-05',
        decimals: 6,
        maxParticipants: 10,
      }),
    });
    const event = await createRes.json() as { id: string };

    const trainerRes = await app.request(`/events/${event.id}/trainers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: org.cookie },
      body: JSON.stringify({ name: 'Alice Trainer', phone: '0712345678' }),
    });
    assert.equal(trainerRes.status, 201);
    const trainer = await trainerRes.json() as { id: string; phone: string; state: string };
    assert.equal(trainer.phone, '+254712345678');
    assert.equal(trainer.state, 'invited');

    // Duplicate phone gives 409
    const dupRes = await app.request(`/events/${event.id}/trainers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: org.cookie },
      body: JSON.stringify({ name: 'Alice Dup', phone: '+254712345678' }),
    });
    assert.equal(dupRes.status, 409);

    // Event details shows trainer counts
    const statusRes = await app.request(`/events/${event.id}`, {
      headers: { cookie: org.cookie },
    });
    assert.equal(statusRes.status, 200);
    const statusBody = await statusRes.json() as { trainers: { invited: number } };
    assert.equal(statusBody.trainers.invited, 1);
  });

  test('trainee link refused before funded and allowed after mock fund', async () => {
    const db = getDb(':memory:');
    migrate(db);
    const mockChain = new MockChain();
    const app = createApp(db, mockChain);
    const kp = nacl.sign.keyPair();
    const org = await loginOrganizer(app, kp);

    // Create 5-day event
    const createRes = await app.request('/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: org.cookie },
      body: JSON.stringify({
        name: 'Funding Test Event',
        startDate: '2026-12-01',
        endDate: '2026-12-05',
        decimals: 6,
        maxParticipants: 10,
      }),
    });
    const event = await createRes.json() as { id: string };

    // Upload CSV with 1 participant: 10.000000 per day for 5 days = 50.000000 = 50_000_000 base units
    const csvContent = 'name,email,phone,day1,day2,day3,day4,day5\nJohn Doe,john@example.com,0712345678,10,10,10,10,10';
    const csvRes = await app.request(`/events/${event.id}/participants/csv`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/csv', cookie: org.cookie },
      body: csvContent,
    });
    assert.equal(csvRes.status, 200);

    // Trainer link is always allowed even before chain programme / funding
    const trainerLinkRes = await app.request(`/events/${event.id}/links`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: org.cookie },
      body: JSON.stringify({ type: 'trainer' }),
    });
    assert.equal(trainerLinkRes.status, 201);
    const trainerLinkData = await trainerLinkRes.json() as { code: string };
    assert.ok(trainerLinkData.code);

    // Trainee link refused because programme does not exist
    const traineeBeforeProgRes = await app.request(`/events/${event.id}/links`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: org.cookie },
      body: JSON.stringify({ type: 'trainee' }),
    });
    assert.equal(traineeBeforeProgRes.status, 409);

    // Create programme on mock chain, but vault balance is 0 < 50_000_000
    mockChain.createProgramme({
      organizer: org.wallet,
      backendKey: 'backend-key',
      mint: 'test-mint',
      programmeId: 'prog-1',
      startTs: 1000n,
      dayLen: 86400n,
      days: 5,
      maxParticipants: 10,
    });

    // Trainee link refused because vault is underfunded
    const traineeUnderfundedRes = await app.request(`/events/${event.id}/links`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: org.cookie },
      body: JSON.stringify({ type: 'trainee' }),
    });
    assert.equal(traineeUnderfundedRes.status, 409);

    // Fund the mock chain vault with 50_000_000
    mockChain.fund(50_000_000n);

    // Trainee link now allowed!
    const traineeFundedRes = await app.request(`/events/${event.id}/links`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: org.cookie },
      body: JSON.stringify({ type: 'trainee' }),
    });
    assert.equal(traineeFundedRes.status, 201);
    const traineeLinkData = await traineeFundedRes.json() as { code: string; type: string };
    assert.equal(traineeLinkData.type, 'trainee');
    assert.ok(traineeLinkData.code);

    // Event status should now be 'funded'
    const evStatusRes = await app.request(`/events/${event.id}`, {
      headers: { cookie: org.cookie },
    });
    const evBody = await evStatusRes.json() as { event: { status: string } };
    assert.equal(evBody.event.status, 'funded');
  });

  test('CSV re-upload refused once a participant is claimed', async () => {
    const db = getDb(':memory:');
    migrate(db);
    const app = createApp(db);
    const kp = nacl.sign.keyPair();
    const org = await loginOrganizer(app, kp);

    const createRes = await app.request('/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: org.cookie },
      body: JSON.stringify({
        name: 'CSV Claim Test',
        startDate: '2026-12-01',
        endDate: '2026-12-05',
        decimals: 6,
        maxParticipants: 10,
      }),
    });
    const event = await createRes.json() as { id: string };

    const csvContent = 'name,email,phone,day1,day2,day3,day4,day5\nJohn Doe,john@example.com,0712345678,10,10,10,10,10';
    const csvRes1 = await app.request(`/events/${event.id}/participants/csv`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/csv', cookie: org.cookie },
      body: csvContent,
    });
    assert.equal(csvRes1.status, 200);

    // Mark participant as pending / claimed
    db.prepare(`UPDATE participants SET claim_state = 'pending' WHERE event_id = ?`).run(event.id);

    // Re-uploading CSV should now be refused with 409
    const csvRes2 = await app.request(`/events/${event.id}/participants/csv`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/csv', cookie: org.cookie },
      body: csvContent,
    });
    assert.equal(csvRes2.status, 409);
  });

  test('link code is not stored in plain', async () => {
    const db = getDb(':memory:');
    migrate(db);
    const app = createApp(db);
    const kp = nacl.sign.keyPair();
    const org = await loginOrganizer(app, kp);

    const createRes = await app.request('/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: org.cookie },
      body: JSON.stringify({
        name: 'Link Hash Test',
        startDate: '2026-12-01',
        endDate: '2026-12-05',
        decimals: 6,
        maxParticipants: 10,
      }),
    });
    const event = await createRes.json() as { id: string };

    const linkRes = await app.request(`/events/${event.id}/links`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: org.cookie },
      body: JSON.stringify({ type: 'trainer' }),
    });
    assert.equal(linkRes.status, 201);
    const { code } = await linkRes.json() as { code: string };

    // Query DB claim_links table
    const row = db.prepare(`SELECT code FROM claim_links WHERE event_id = ?`).get(event.id) as { code: string };
    assert.notEqual(row.code, code, 'Database must not store plain link code');
    const expectedHash = createHash('sha256').update(code).digest('hex');
    assert.equal(row.code, expectedHash, 'Database stores SHA-256 of the link code');
  });
});
