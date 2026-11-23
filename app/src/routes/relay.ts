import { Hono } from 'hono';
import type { DatabaseSync } from 'node:sqlite';
import { randomInt } from 'node:crypto';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import type { ChainInterface } from '../chain/interface.js';
import { parseTransaction } from '../tx.js';

export interface RelayOptions {
  programId?: string;
  now?: () => number; // unix seconds
  ttlSeconds?: number;
  maxPending?: number;
}

const MAX_TX_BYTES = 1232;
const ID_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const ID_RE = /^[A-HJ-KM-NP-Z2-9]{8}$/;
const B64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

function newId(): string {
  let s = '';
  for (let i = 0; i < 8; i++) s += ID_ALPHABET[randomInt(ID_ALPHABET.length)];
  return s;
}

export function makeRelayRoutes(db: DatabaseSync, chain: ChainInterface, opts: RelayOptions = {}) {
  const router = new Hono();
  const now = opts.now ?? (() => Math.floor(Date.now() / 1000));
  const ttl = opts.ttlSeconds ?? Number(process.env.RELAY_TTL_SECONDS ?? 60);
  const maxPending = opts.maxPending ?? Number(process.env.RELAY_MAX_PENDING ?? 200);

  // Holds a trainer's half-signed check-in. No signing key is held here: the trainer pays the fee.
  router.post('/', async (c) => {
    const programId = opts.programId ?? process.env.PROGRAM_ID;
    if (!programId) return c.json({ error: 'relay_not_configured' }, 503);
    const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body.eventId !== 'string' || typeof body.tx !== 'string') return c.json({ error: 'bad_request' }, 400);
    const txB64 = body.tx;
    if (txB64.length === 0 || txB64.length > 4000 || !B64_RE.test(txB64)) return c.json({ error: 'bad_tx' }, 400);
    const bytes = new Uint8Array(Buffer.from(txB64, 'base64'));
    if (bytes.length > MAX_TX_BYTES) return c.json({ error: 'too_large' }, 413);

    let parsed;
    try { parsed = parseTransaction(bytes); } catch { return c.json({ error: 'bad_tx' }, 400); }
    if (!parsed.programIds.includes(programId)) return c.json({ error: 'wrong_program' }, 400);

    // Slot 0 is the fee payer (the trainer): it must be filled and verify over the message.
    const sig0 = parsed.signatures[0];
    if (sig0.every((b) => b === 0)) return c.json({ error: 'bad_signature' }, 400);
    const signer = parsed.accountKeys[0];
    let okSig = false;
    try { okSig = nacl.sign.detached.verify(parsed.messageBytes, sig0, bs58.decode(signer)); } catch { okSig = false; }
    if (!okSig) return c.json({ error: 'bad_signature' }, 400);

    // Stricter than the design (program ID and size only): the signer must be a registered trainer.
    let registered = false;
    try { registered = await chain.isTrainerRegistered(signer); } catch { registered = false; }
    if (!registered) return c.json({ error: 'trainer_not_registered' }, 403);

    const ev = db.prepare('SELECT id FROM events WHERE id = ?').get(body.eventId);
    if (!ev) return c.json({ error: 'unknown_event' }, 404);

    const t = now();
    db.prepare('DELETE FROM pending_checkins WHERE expires_at <= ?').run(t);
    const n = (db.prepare('SELECT COUNT(*) AS n FROM pending_checkins').get() as { n: number }).n;
    if (Number(n) >= maxPending) return c.json({ error: 'busy' }, 429);

    for (let attempt = 0; attempt < 5; attempt++) {
      const id = newId();
      try {
        db.prepare('INSERT INTO pending_checkins (id, event_id, half_signed_tx, expires_at, created_at) VALUES (?, ?, ?, ?, ?)')
          .run(id, body.eventId, txB64, t + ttl, t);
        return c.json({ id, expiresAt: t + ttl }, 201);
      } catch (e) {
        if (!String((e as Error)?.message).includes('UNIQUE')) throw e;
      }
    }
    return c.json({ error: 'busy' }, 503);
  });

  router.get('/:id', (c) => {
    const id = c.req.param('id');
    if (!ID_RE.test(id)) return c.json({ error: 'not_found' }, 404);
    const row = db.prepare('SELECT half_signed_tx, expires_at FROM pending_checkins WHERE id = ?').get(id) as
      | { half_signed_tx: string; expires_at: number } | undefined;
    if (!row) return c.json({ error: 'not_found' }, 404);
    const t = now();
    if (Number(row.expires_at) <= t) {
      db.prepare('DELETE FROM pending_checkins WHERE id = ?').run(id);
      return c.json({ error: 'expired' }, 410);
    }
    return c.json({ tx: row.half_signed_tx, expiresAt: Number(row.expires_at), secondsLeft: Number(row.expires_at) - t }, 200);
  });

  return router;
}
