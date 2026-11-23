import { Hono } from 'hono';
import type { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import type { ChainInterface } from '../chain/interface.js';
import { hashSecret, verifySecret, HashBusyError } from '../scrypt.js';
import type { Limiter } from '../limiter.js';
import { decodeBase58Pubkey } from '../session.js';
import { normalizeKenyaPhone } from '../phone.js';

const PIN_RE = /^\d{6}$/;
const B64_RE = /^[A-Za-z0-9+/_-]+={0,2}$/;

interface ParticipantRow {
  id: string;
  claim_state: 'unclaimed' | 'pending' | 'enrolled';
  wallet_address: string | null;
  pin_hash: string | null;
  amounts: string;
}

// Behind a reverse proxy x-forwarded-for is set by the proxy. A direct caller can spoof it,
// which only weakens the per-IP limit; the per-phone limit still holds.
function clientIp(c: any): string {
  const xff = c.req.header('x-forwarded-for');
  if (xff) return String(xff).split(',')[0].trim();
  return c.req.header('x-real-ip') ?? 'unknown';
}

function linkHashes(code: string): string[] {
  const h = createHash('sha256').update(code).digest();
  return [h.toString('hex'), h.toString('base64'), h.toString('base64url')];
}

function parseAmounts(json: string): bigint[] | null {
  try {
    const arr = JSON.parse(json);
    if (!Array.isArray(arr) || arr.length === 0) return null;
    return arr.map((x) => BigInt(x));
  } catch {
    return null;
  }
}

export function makeClaimRoutes(db: DatabaseSync, chain: ChainInterface, guard: Limiter) {
  const router = new Hono();

  router.post('/', async (c) => {
    const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== 'object') return c.json({ error: 'bad_request' }, 400);
    const { linkCode, phone, pin, wallet, encryptedKeyBlob } = body;
    if (
      typeof linkCode !== 'string' || typeof phone !== 'string' || typeof pin !== 'string' ||
      typeof wallet !== 'string' || typeof encryptedKeyBlob !== 'string'
    ) {
      return c.json({ error: 'bad_request' }, 400);
    }

    const ip = clientIp(c);
    let norm: string | null = null;
    try { norm = normalizeKenyaPhone(phone) ?? null; } catch { norm = null; }
    const key = norm ?? 'invalid';
    if (guard.check(ip, key) === true) return c.json({ error: 'too_many_attempts' }, 429);

    const link = db
      .prepare(`SELECT event_id FROM claim_links WHERE link_type = 'trainee' AND code IN (?, ?, ?)`)
      .get(...linkHashes(linkCode)) as { event_id: string } | undefined;
    if (!link) { guard.fail(ip, key); return c.json({ error: 'unknown_link' }, 404); }

    const event = db.prepare(`SELECT status FROM events WHERE id = ?`).get(link.event_id) as { status: string } | undefined;
    let programmeOk = false;
    try { programmeOk = !!(await chain.getProgramme()); } catch { programmeOk = false; }
    if (!event || event.status !== 'funded' || !programmeOk) return c.json({ error: 'not_funded' }, 409);

    if (!norm) { guard.fail(ip, key); return c.json({ error: 'not_on_list' }, 404); }
    const row = db
      .prepare(`SELECT id, claim_state, wallet_address, pin_hash, amounts FROM participants WHERE event_id = ? AND phone_e164 = ?`)
      .get(link.event_id, norm) as ParticipantRow | undefined;
    if (!row) { guard.fail(ip, key); return c.json({ error: 'not_on_list' }, 404); }

    if (!PIN_RE.test(pin)) return c.json({ error: 'bad_pin_format' }, 400);
    const pk = decodeBase58Pubkey(wallet);
    if (!pk || pk.length !== 32) return c.json({ error: 'bad_wallet' }, 400);
    if (encryptedKeyBlob.length === 0 || encryptedKeyBlob.length > 2048 || !B64_RE.test(encryptedKeyBlob)) {
      return c.json({ error: 'bad_blob' }, 400);
    }

    if (row.claim_state === 'unclaimed') {
      let pinHash: string;
      try {
        pinHash = await hashSecret(pin);
      } catch (e) {
        if (e instanceof HashBusyError) return c.json({ error: 'busy' }, 503);
        throw e;
      }
      try {
        const r = db
          .prepare(`UPDATE participants SET claim_state = 'pending', wallet_address = ?, encrypted_key_blob = ?, pin_hash = ? WHERE id = ? AND claim_state = 'unclaimed'`)
          .run(wallet, encryptedKeyBlob, pinHash, row.id);
        if (Number(r.changes) === 0) return c.json({ error: 'already_claimed' }, 409);
      } catch (e) {
        if (String((e as Error)?.message).includes('UNIQUE')) return c.json({ error: 'wallet_in_use' }, 409);
        throw e;
      }
    } else {
      if (row.wallet_address !== wallet) return c.json({ error: 'already_claimed' }, 409);
      let ok = false;
      try {
        ok = row.pin_hash ? await verifySecret(pin, row.pin_hash) : false;
      } catch (e) {
        if (e instanceof HashBusyError) return c.json({ error: 'busy' }, 503);
        throw e;
      }
      if (!ok) { guard.fail(ip, key); return c.json({ error: 'wrong_pin' }, 401); }
      if (row.claim_state === 'enrolled') { guard.success(ip, key); return c.json({ state: 'enrolled' }, 200); }
    }

    const amounts = parseAmounts(row.amounts);
    if (!amounts) return c.json({ error: 'bad_amounts' }, 500);
    try {
      if (!(await chain.isEnrolled(wallet))) await chain.enroll(wallet, amounts);
    } catch (e) {
      const code = (e as { code?: unknown })?.code;
      if (typeof code === 'string') return c.json({ error: code }, 502);
      throw e;
    }
    db.prepare(`UPDATE participants SET claim_state = 'enrolled', claimed_at = ? WHERE id = ?`)
      .run(Math.floor(Date.now() / 1000), row.id);
    guard.success(ip, key);
    return c.json({ state: 'enrolled' }, 200);
  });

  return router;
}
