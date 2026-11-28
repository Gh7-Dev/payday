import { Hono } from 'hono';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { ChainInterface } from '../chain/interface.js';
import { requireOrganizer } from '../session.js';
import { kenyaMidnightUnix, loadConfig } from '../config.js';
import { normalizeKenyaPhone } from '../phone.js';
import { validateCsv, expandCycle } from '../csv.js';

function sha256hex(str: string): string {
  return createHash('sha256').update(str).digest('hex');
}

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

export function makeOrganizerRoutes(db: DatabaseSync, chain: ChainInterface) {
  const router = new Hono<{ Variables: { wallet: string; db: DatabaseSync } }>();

  // Ensure DB is in context
  router.use('*', async (c, next) => {
    c.set('db', db);
    await next();
  });

  // All organizer routes are behind requireOrganizer
  router.use('*', requireOrganizer);

  // Helper to fetch event ensuring it belongs to current organizer wallet
  function getOrganizerEvent(eventId: string, organizerWallet: string) {
    const row = db.prepare(
      `SELECT * FROM events WHERE id = ? AND organizer_wallet = ?`
    ).get(eventId, organizerWallet) as {
      id: string;
      name: string;
      organizer_wallet: string;
      programme_id: string | null;
      programme_address: string | null;
      start_date: number;
      end_date: number;
      start_ts: number;
      day_len_seconds: number;
      days: number;
      max_participants: number;
      decimals: number;
      token_mint: string | null;
      status: string;
      created_at: number;
    } | undefined;

    return row ?? null;
  }

  // 1) POST /events
  router.post('/events', async (c) => {
    const organizerWallet = c.get('wallet');
    let body: {
      name?: unknown;
      startDate?: unknown;
      endDate?: unknown;
      dayLenSeconds?: unknown;
      decimals?: unknown;
      tokenMint?: unknown;
      maxParticipants?: unknown;
    };

    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'invalid_json' }, 400);
    }

    const { name, startDate, endDate, dayLenSeconds, decimals, tokenMint, maxParticipants } = body;

    if (typeof name !== 'string' || !name.trim()) {
      return c.json({ error: 'name_required' }, 400);
    }
    if (typeof startDate !== 'string' || typeof endDate !== 'string') {
      return c.json({ error: 'dates_required' }, 400);
    }
    if (typeof decimals !== 'number' || decimals < 0) {
      return c.json({ error: 'invalid_decimals' }, 400);
    }
    if (typeof maxParticipants !== 'number' || maxParticipants <= 0) {
      return c.json({ error: 'invalid_max_participants' }, 400);
    }

    let startTs: number;
    let startDateMidnight: number;
    let endDateMidnight: number;

    try {
      startDateMidnight = kenyaMidnightUnix(startDate);
      endDateMidnight = kenyaMidnightUnix(endDate);
    } catch {
      return c.json({ error: 'invalid_date_format' }, 400);
    }

    if (endDateMidnight < startDateMidnight) {
      return c.json({ error: 'end_date_before_start_date' }, 400);
    }

    // Days = inclusive day count, 1 to 31
    const diffDays = Math.floor((endDateMidnight - startDateMidnight) / 86400) + 1;
    if (diffDays < 1 || diffDays > 31) {
      return c.json({ error: 'days_out_of_range', message: 'Days must be between 1 and 31' }, 400);
    }
    const days = diffDays;

    // Check config for demo override
    let configStartTs: bigint | undefined;
    let configDayLen: bigint | undefined;
    try {
      const cfg = loadConfig();
      configStartTs = cfg.demoStartTs;
      configDayLen = cfg.demoDayLen;
    } catch {
      // ignore
    }

    startTs = configStartTs !== undefined ? Number(configStartTs) : startDateMidnight;
    const dayLen = configDayLen !== undefined
      ? Number(configDayLen)
      : (typeof dayLenSeconds === 'number' && dayLenSeconds > 0 ? dayLenSeconds : 86400);

    const eventId = randomUUID();
    const now = nowSec();

    db.prepare(`
      INSERT INTO events (
        id, name, organizer_wallet, programme_id, programme_address,
        start_date, end_date, start_ts, day_len_seconds, days,
        max_participants, decimals, token_mint, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?)
    `).run(
      eventId,
      name.trim(),
      organizerWallet,
      null,
      null,
      startDateMidnight,
      endDateMidnight,
      startTs,
      dayLen,
      days,
      maxParticipants,
      decimals,
      typeof tokenMint === 'string' ? tokenMint : null,
      now
    );

    const event = getOrganizerEvent(eventId, organizerWallet);
    return c.json(event, 201);
  });

  // 2) POST /events/:id/trainers
  router.post('/events/:id/trainers', async (c) => {
    const organizerWallet = c.get('wallet');
    const eventId = c.req.param('id');
    const event = getOrganizerEvent(eventId, organizerWallet);
    if (!event) {
      return c.json({ error: 'not_found' }, 404);
    }

    let body: { name?: unknown; phone?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'invalid_json' }, 400);
    }

    const { name, phone } = body;
    if (typeof name !== 'string' || !name.trim()) {
      return c.json({ error: 'name_required' }, 400);
    }
    if (typeof phone !== 'string' || !phone.trim()) {
      return c.json({ error: 'phone_required' }, 400);
    }

    const normPhone = normalizeKenyaPhone(phone);
    if (!normPhone) {
      return c.json({ error: 'invalid_phone' }, 400);
    }

    const existing = db.prepare(
      `SELECT id FROM trainers WHERE event_id = ? AND phone_e164 = ?`
    ).get(eventId, normPhone);

    if (existing) {
      return c.json({ error: 'duplicate_phone' }, 409);
    }

    const trainerId = randomUUID();
    const now = nowSec();

    db.prepare(`
      INSERT INTO trainers (
        id, event_id, name, username, phone_e164, wallet_address,
        encrypted_key_blob, password_hash, state, topped_up_at,
        topped_up_lamports, failed_attempts, created_at
      ) VALUES (?, ?, ?, NULL, ?, NULL, NULL, NULL, 'invited', NULL, NULL, 0, ?)
    `).run(trainerId, eventId, name.trim(), normPhone, now);

    return c.json({
      id: trainerId,
      eventId,
      name: name.trim(),
      phone: normPhone,
      state: 'invited',
    }, 201);
  });

  // 3) POST /events/:id/participants/csv
  router.post('/events/:id/participants/csv', async (c) => {
    const organizerWallet = c.get('wallet');
    const eventId = c.req.param('id');
    const event = getOrganizerEvent(eventId, organizerWallet);
    if (!event) {
      return c.json({ error: 'not_found' }, 404);
    }

    const csvText = await c.req.text();
    const validation = validateCsv(csvText, {
      days: event.days,
      decimals: event.decimals,
      maxParticipants: event.max_participants,
    });

    if (!validation.ok) {
      return c.json({ ok: false, errors: validation.errors }, 400);
    }

    // Refused with 409 if any participant is already claimed
    const claimedCount = db.prepare(`
      SELECT count(*) as count FROM participants WHERE event_id = ? AND claim_state != 'unclaimed'
    `).get(eventId) as { count: number };

    if (claimedCount && claimedCount.count > 0) {
      return c.json({ error: 'participants_already_claimed', message: 'Cannot re-upload CSV once claims have started' }, 409);
    }

    // Replace existing unclaimed participants in this event
    db.prepare(`DELETE FROM participants WHERE event_id = ?`).run(eventId);

    const now = nowSec();
    const insertStmt = db.prepare(`
      INSERT INTO participants (
        id, event_id, name, email, phone_e164, wallet_address,
        encrypted_key_blob, pin_hash, claim_code_hash, amounts,
        claim_state, enroll_signature, claimed_at, failed_attempts, created_at
      ) VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, ?, 'unclaimed', NULL, NULL, 0, ?)
    `);

    for (const row of validation.rows) {
      const fullAmounts = expandCycle(row.amounts, event.days);
      const amountsJson = JSON.stringify(fullAmounts.map((a) => a.toString()));
      insertStmt.run(randomUUID(), eventId, row.name, row.email, row.phone, amountsJson, now);
    }

    return c.json({
      ok: true,
      count: validation.rows.length,
      perDayTotals: validation.perDayTotals.map((t) => t.toString()),
      grandTotal: validation.grandTotal.toString(),
    }, 200);
  });

  // 4) POST /events/:id/links {type: 'trainee' | 'trainer'}
  router.post('/events/:id/links', async (c) => {
    const organizerWallet = c.get('wallet');
    const eventId = c.req.param('id');
    const event = getOrganizerEvent(eventId, organizerWallet);
    if (!event) {
      return c.json({ error: 'not_found' }, 404);
    }

    let body: { type?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'invalid_json' }, 400);
    }

    const { type } = body;
    if (type !== 'trainee' && type !== 'trainer') {
      return c.json({ error: 'invalid_type', message: "Type must be 'trainee' or 'trainer'" }, 400);
    }

    if (type === 'trainee') {
      const prog = await chain.getProgramme();
      if (!prog) {
        return c.json({ error: 'programme_not_created', message: 'Programme has not been created on chain' }, 409);
      }

      // Sum all participants' amounts
      const participants = db.prepare(
        `SELECT amounts FROM participants WHERE event_id = ?`
      ).all(eventId) as Array<{ amounts: string }>;

      let requiredTotal = 0n;
      for (const p of participants) {
        const amountsArr = JSON.parse(p.amounts) as string[];
        for (const amt of amountsArr) {
          requiredTotal += BigInt(amt);
        }
      }

      const vaultBal = await chain.getVaultBalance();
      if (vaultBal < requiredTotal) {
        return c.json({
          error: 'vault_underfunded',
          message: `Vault balance (${vaultBal}) is less than required total (${requiredTotal})`,
        }, 409);
      }

      // Set events.status = 'funded'
      db.prepare(`UPDATE events SET status = 'funded' WHERE id = ?`).run(eventId);
    }

    // Generate random link code
    const rawCode = randomBytes(16).toString('hex');
    const codeHash = sha256hex(rawCode);
    const linkId = randomUUID();
    const now = nowSec();

    db.prepare(`
      INSERT INTO claim_links (id, event_id, link_type, code, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(linkId, eventId, type, codeHash, now);

    return c.json({
      linkId,
      eventId,
      type,
      code: rawCode,
    }, 201);
  });

  // 5) GET /events/:id
  router.get('/events/:id', async (c) => {
    const organizerWallet = c.get('wallet');
    const eventId = c.req.param('id');
    const event = getOrganizerEvent(eventId, organizerWallet);
    if (!event) {
      return c.json({ error: 'not_found' }, 404);
    }

    // Counts of trainers by state
    const trainerCountsRaw = db.prepare(`
      SELECT state, count(*) as count FROM trainers WHERE event_id = ? GROUP BY state
    `).all(eventId) as Array<{ state: string; count: number }>;

    const trainersByState: Record<string, number> = {
      invited: 0,
      signed_up: 0,
      funded: 0,
      registered: 0,
    };
    for (const r of trainerCountsRaw) {
      trainersByState[r.state] = r.count;
    }

    // Counts of participants by claim_state
    const participantCountsRaw = db.prepare(`
      SELECT claim_state, count(*) as count FROM participants WHERE event_id = ? GROUP BY claim_state
    `).all(eventId) as Array<{ claim_state: string; count: number }>;

    const participantsByClaimState: Record<string, number> = {
      unclaimed: 0,
      pending: 0,
      enrolled: 0,
    };
    for (const r of participantCountsRaw) {
      participantsByClaimState[r.claim_state] = r.count;
    }

    return c.json({
      event,
      trainers: trainersByState,
      participants: participantsByClaimState,
    }, 200);
  });

  // GET /events/:id/trainers (list with wallets, for the organizer UI)
  router.get('/events/:id/trainers', async (c) => {
    const organizerWallet = c.get('wallet');
    const eventId = c.req.param('id');
    const event = getOrganizerEvent(eventId, organizerWallet);
    if (!event) {
      return c.json({ error: 'not_found' }, 404);
    }
    const rows = db.prepare(
      'SELECT id, name, phone_e164 AS phone, wallet_address AS wallet, state FROM trainers WHERE event_id = ? ORDER BY created_at'
    ).all(eventId);
    return c.json({ trainers: rows }, 200);
  });

  // 6) POST /events/:id/trainers/sync
  router.post('/events/:id/trainers/sync', async (c) => {
    const organizerWallet = c.get('wallet');
    const eventId = c.req.param('id');
    const event = getOrganizerEvent(eventId, organizerWallet);
    if (!event) {
      return c.json({ error: 'not_found' }, 404);
    }

    const trainers = db.prepare(
      `SELECT id, name, wallet_address FROM trainers WHERE event_id = ? AND state = 'funded' AND wallet_address IS NOT NULL`
    ).all(eventId) as Array<{ id: string; name: string; wallet_address: string }>;

    const registered: string[] = [];
    const pending: string[] = [];

    const updateStmt = db.prepare(`UPDATE trainers SET state = 'registered' WHERE id = ?`);

    for (const t of trainers) {
      let isReg = false;
      try {
        isReg = await chain.isTrainerRegistered(t.wallet_address);
      } catch {
        isReg = false;
      }

      if (isReg) {
        updateStmt.run(t.id);
        registered.push(t.name);
      } else {
        pending.push(t.name);
      }
    }

    return c.json({ registered, pending }, 200);
  });

  return router;
}
