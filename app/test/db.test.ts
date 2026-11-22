import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { getDb, migrate } from '../src/db.js';

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

    const eventId = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);
    db.prepare(
      `INSERT INTO events (id, name, start_date, end_date, days, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(eventId, 'Test Event', now, now + 86400, 1, now);

    const participant1Id = crypto.randomUUID();
    const phone = '+254712345678';
    const amounts = JSON.stringify(['10.5']);

    db.prepare(
      `INSERT INTO participants (id, event_id, name, email, phone_e164, amounts, claim_state, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(participant1Id, eventId, 'Alice', 'alice@test.com', phone, amounts, 'unclaimed', now);

    const participant2Id = crypto.randomUUID();
    assert.throws(
      () => {
        db.prepare(
          `INSERT INTO participants (id, event_id, name, email, phone_e164, amounts, claim_state, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(participant2Id, eventId, 'Bob', 'bob@test.com', phone, amounts, 'unclaimed', now);
      },
      /UNIQUE constraint failed/
    );
  });

  it('bad claim_state rejected', () => {
    const db = getDb(':memory:');
    migrate(db);

    const eventId = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);
    db.prepare(
      `INSERT INTO events (id, name, start_date, end_date, days, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(eventId, 'Event 2', now, now + 86400, 1, now);

    const participantId = crypto.randomUUID();
    const amounts = JSON.stringify(['5.0']);

    assert.throws(
      () => {
        db.prepare(
          `INSERT INTO participants (id, event_id, name, email, phone_e164, amounts, claim_state, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(participantId, eventId, 'Charlie', 'charlie@test.com', '+254799999999', amounts, 'invalid_state', now);
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
});
