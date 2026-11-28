import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { getDb, migrate } from '../src/db.js';

function createTestEvent(db: any, overrides: Record<string, any> = {}) {
  const eventId = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  const data = {
    id: eventId,
    name: 'Test Event',
    organizer_wallet: 'organizer-wallet-123',
    start_date: now,
    end_date: now + 86400,
    start_ts: now,
    day_len_seconds: 86400,
    days: 1,
    max_participants: 50,
    decimals: 6,
    token_mint: null,
    status: 'draft',
    created_at: now,
    ...overrides,
  };

  db.prepare(
    `INSERT INTO events (id, name, organizer_wallet, start_date, end_date, start_ts, day_len_seconds, days, max_participants, decimals, token_mint, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    data.id,
    data.name,
    data.organizer_wallet,
    data.start_date,
    data.end_date,
    data.start_ts,
    data.day_len_seconds,
    data.days,
    data.max_participants,
    data.decimals,
    data.token_mint,
    data.status,
    data.created_at
  );

  return data;
}

describe('database & schema', () => {
  it('migrate twice is fine', () => {
    const db = getDb(':memory:');
    migrate(db);
    assert.doesNotThrow(() => {
      migrate(db);
    });

    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
      )
      .all() as { name: string }[];
    const names = tables.map((t) => t.name);
    assert.deepEqual(names, [
      'claim_links',
      'events',
      'participants',
      'pending_checkins',
      'sessions',
      'trainers',
    ]);
  });

  it('duplicate phone in one event rejected', () => {
    const db = getDb(':memory:');
    migrate(db);

    const event = createTestEvent(db);
    const now = event.created_at;

    const participant1Id = crypto.randomUUID();
    const phone = '+254712345678';
    const amounts = JSON.stringify(['10.5']);

    db.prepare(
      `INSERT INTO participants (id, event_id, name, email, phone_e164, amounts, claim_state, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(participant1Id, event.id, 'Alice', 'alice@test.com', phone, amounts, 'unclaimed', now);

    const participant2Id = crypto.randomUUID();
    assert.throws(
      () => {
        db.prepare(
          `INSERT INTO participants (id, event_id, name, email, phone_e164, amounts, claim_state, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(participant2Id, event.id, 'Bob', 'bob@test.com', phone, amounts, 'unclaimed', now);
      },
      /UNIQUE constraint failed/
    );
  });

  it('bad claim_state rejected', () => {
    const db = getDb(':memory:');
    migrate(db);

    const event = createTestEvent(db);
    const now = event.created_at;

    const participantId = crypto.randomUUID();
    const amounts = JSON.stringify(['5.0']);

    assert.throws(
      () => {
        db.prepare(
          `INSERT INTO participants (id, event_id, name, email, phone_e164, amounts, claim_state, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(participantId, event.id, 'Charlie', 'charlie@test.com', '+254799999999', amounts, 'invalid_state', now);
      },
      /CHECK constraint failed/
    );
  });

  it('foreign key enforced', () => {
    const db = getDb(':memory:');
    migrate(db);

    const nonExistentEventId = crypto.randomUUID();
    const participantId = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);
    const amounts = JSON.stringify(['1.0']);

    assert.throws(
      () => {
        db.prepare(
          `INSERT INTO participants (id, event_id, name, email, phone_e164, amounts, claim_state, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(participantId, nonExistentEventId, 'Dave', 'dave@test.com', '+254788888888', amounts, 'unclaimed', now);
      },
      /FOREIGN KEY constraint failed/
    );
  });

  it('event without organizer_wallet rejected', () => {
    const db = getDb(':memory:');
    migrate(db);

    const eventId = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);

    assert.throws(() => {
      db.prepare(
        `INSERT INTO events (id, name, organizer_wallet, start_date, end_date, start_ts, day_len_seconds, days, max_participants, decimals, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(eventId, 'No Wallet Event', null, now, now + 86400, now, 86400, 1, 10, 6, 'draft', now);
    }, /NOT NULL constraint failed/);
  });

  it('bad status rejected', () => {
    const db = getDb(':memory:');
    migrate(db);

    assert.throws(() => {
      createTestEvent(db, { status: 'invalid_status' });
    }, /CHECK constraint failed/);
  });

  it('trainer with no username accepted', () => {
    const db = getDb(':memory:');
    migrate(db);

    const event = createTestEvent(db);
    const trainerId = crypto.randomUUID();
    const now = event.created_at;

    assert.doesNotThrow(() => {
      db.prepare(
        `INSERT INTO trainers (id, event_id, name, username, phone_e164, state, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(trainerId, event.id, 'Trainer One', null, '+254700000001', 'invited', now);
    });
  });

  it('two username-less trainers in one event accepted', () => {
    const db = getDb(':memory:');
    migrate(db);

    const event = createTestEvent(db);
    const now = event.created_at;

    db.prepare(
      `INSERT INTO trainers (id, event_id, name, username, phone_e164, state, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(crypto.randomUUID(), event.id, 'Trainer One', null, '+254700000001', 'invited', now);

    assert.doesNotThrow(() => {
      db.prepare(
        `INSERT INTO trainers (id, event_id, name, username, phone_e164, state, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(crypto.randomUUID(), event.id, 'Trainer Two', null, '+254700000002', 'invited', now);
    });
  });

  it('duplicate username in one event rejected', () => {
    const db = getDb(':memory:');
    migrate(db);

    const event = createTestEvent(db);
    const now = event.created_at;

    db.prepare(
      `INSERT INTO trainers (id, event_id, name, username, phone_e164, state, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(crypto.randomUUID(), event.id, 'Trainer A', 'trainer_alpha', '+254700000001', 'invited', now);

    assert.throws(() => {
      db.prepare(
        `INSERT INTO trainers (id, event_id, name, username, phone_e164, state, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(crypto.randomUUID(), event.id, 'Trainer B', 'trainer_alpha', '+254700000002', 'invited', now);
    }, /UNIQUE constraint failed/);
  });
});
