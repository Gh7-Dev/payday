import { Hono } from 'hono';
import type { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import type { ChainInterface } from '../chain/interface.js';
import { hashSecret, verifySecret, HashBusyError } from '../scrypt.js';
import type { Limiter } from '../limiter.js';
import { decodeBase58Pubkey } from '../session.js';
import { normalizeKenyaPhone } from '../phone.js';
import { loadConfig } from '../config.js';

const USERNAME_RE = /^[a-z0-9_]{3,32}$/;
const B64_RE = /^[A-Za-z0-9+/_-]+={0,2}$/;

interface TrainerRow {
  id: string;
  event_id: string;
  name: string;
  username: string | null;
  phone_e164: string;
  wallet_address: string | null;
  encrypted_key_blob: string | null;
  password_hash: string | null;
  state: 'invited' | 'signed_up' | 'funded' | 'registered';
  topped_up_at: number | null;
  topped_up_lamports: string | null;
}

function clientIp(c: any): string {
  const xff = c.req.header('x-forwarded-for');
  if (xff) return String(xff).split(',')[0].trim();
  return c.req.header('x-real-ip') ?? 'unknown';
}

function linkHashes(code: string): string[] {
  const h = createHash('sha256').update(code).digest();
  return [h.toString('hex'), h.toString('base64'), h.toString('base64url')];
}

export function makeTrainerRoutes(db: DatabaseSync, chain: ChainInterface, guard: Limiter) {
  const router = new Hono();

  router.post('/signup', async (c) => {
    const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== 'object') return c.json({ error: 'bad_request' }, 400);

    const { linkCode, username, phone, password, wallet, encryptedKeyBlob } = body;
    if (
      typeof linkCode !== 'string' ||
      typeof username !== 'string' ||
      typeof phone !== 'string' ||
      typeof password !== 'string' ||
      typeof wallet !== 'string' ||
      typeof encryptedKeyBlob !== 'string'
    ) {
      return c.json({ error: 'bad_request' }, 400);
    }

    const ip = clientIp(c);
    let norm: string | null = null;
    try { norm = normalizeKenyaPhone(phone) ?? null; } catch { norm = null; }
    const key = norm ?? 'invalid';

    // 1. guard.check else 429
    if (guard.check(ip, key) === true) return c.json({ error: 'too_many_attempts' }, 429);

    // 2. find the link where link_type='trainer' by SHA-256 of linkCode, else guard.fail and 404
    const link = db
      .prepare(`SELECT event_id FROM claim_links WHERE link_type = 'trainer' AND code IN (?, ?, ?)`)
      .get(...linkHashes(linkCode)) as { event_id: string } | undefined;
    if (!link) {
      guard.fail(ip, key);
      return c.json({ error: 'unknown_link' }, 404);
    }

    // 3. username /^[a-z0-9_]{3,32}$/ and password at least 8 characters, else 400
    if (!USERNAME_RE.test(username) || password.length < 8) {
      return c.json({ error: 'bad_credentials_format' }, 400);
    }

    // Validate wallet and blob
    const pk = decodeBase58Pubkey(wallet);
    if (!pk || pk.length !== 32) return c.json({ error: 'bad_wallet' }, 400);
    if (encryptedKeyBlob.length === 0 || encryptedKeyBlob.length > 2048 || !B64_RE.test(encryptedKeyBlob)) {
      return c.json({ error: 'bad_blob' }, 400);
    }

    // 4. find the trainer by event and normalised phone, else guard.fail and 404
    if (!norm) {
      guard.fail(ip, key);
      return c.json({ error: 'not_on_list' }, 404);
    }

    const row = db
      .prepare(
        `SELECT id, event_id, name, username, phone_e164, wallet_address, encrypted_key_blob, password_hash, state, topped_up_at, topped_up_lamports FROM trainers WHERE event_id = ? AND phone_e164 = ?`
      )
      .get(link.event_id, norm) as TrainerRow | undefined;
    if (!row) {
      guard.fail(ip, key);
      return c.json({ error: 'not_on_list' }, 404);
    }

    // State machine on trainers.state
    if (row.state === 'invited') {
      let passwordHash: string;
      try {
        passwordHash = await hashSecret(password);
      } catch (e) {
        if (e instanceof HashBusyError) return c.json({ error: 'busy' }, 503);
        throw e;
      }

      try {
        const r = db
          .prepare(
            `UPDATE trainers SET state = 'signed_up', username = ?, wallet_address = ?, encrypted_key_blob = ?, password_hash = ? WHERE id = ? AND state = 'invited'`
          )
          .run(username, wallet, encryptedKeyBlob, passwordHash, row.id);
        if (Number(r.changes) === 0) return c.json({ error: 'already_signed_up' }, 409);
      } catch (e) {
        if (String((e as Error)?.message).includes('UNIQUE')) {
          return c.json({ error: 'duplicate_entry' }, 409);
        }
        throw e;
      }
    } else if (row.state === 'signed_up') {
      if (row.wallet_address !== wallet) return c.json({ error: 'already_signed_up' }, 409);
      let ok = false;
      try {
        ok = row.password_hash ? await verifySecret(password, row.password_hash) : false;
      } catch (e) {
        if (e instanceof HashBusyError) return c.json({ error: 'busy' }, 503);
        throw e;
      }
      if (!ok) {
        guard.fail(ip, key);
        return c.json({ error: 'wrong_password' }, 401);
      }
      // Top-up retry follows below
    } else if (row.state === 'funded' || row.state === 'registered') {
      if (row.wallet_address !== wallet) return c.json({ error: 'already_signed_up' }, 409);
      let ok = false;
      try {
        ok = row.password_hash ? await verifySecret(password, row.password_hash) : false;
      } catch (e) {
        if (e instanceof HashBusyError) return c.json({ error: 'busy' }, 503);
        throw e;
      }
      if (!ok) {
        guard.fail(ip, key);
        return c.json({ error: 'wrong_password' }, 401);
      }
      guard.success(ip, key);
      return c.json({ state: row.state }, 200);
    } else {
      return c.json({ error: 'invalid_state' }, 409);
    }

    // Top-up: only if topped_up_at is NULL
    // Check fresh trainer state
    const currentTrainer = db
      .prepare(`SELECT state, topped_up_at FROM trainers WHERE id = ?`)
      .get(row.id) as { state: string; topped_up_at: number | null };

    if (currentTrainer.topped_up_at !== null) {
      guard.success(ip, key);
      return c.json({ state: currentTrainer.state }, 200);
    }

    const cfg = loadConfig();
    const topupAmount = cfg.trainerTopupLamports;
    const totalCap = cfg.topupTotalCapLamports;

    // Sum of topped_up_lamports over the event's trainers
    const sumRow = db
      .prepare(`SELECT topped_up_lamports FROM trainers WHERE event_id = ? AND topped_up_lamports IS NOT NULL`)
      .all(link.event_id) as Array<{ topped_up_lamports: string }>;

    let eventTotalToppedUp = 0n;
    for (const r of sumRow) {
      if (r.topped_up_lamports) {
        try {
          eventTotalToppedUp += BigInt(r.topped_up_lamports);
        } catch {
          // ignore
        }
      }
    }

    if (eventTotalToppedUp + topupAmount > totalCap) {
      // stay signed_up and return 409 { error: 'topup_cap' }
      return c.json({ error: 'topup_cap' }, 409);
    }

    try {
      await chain.topUp(wallet, topupAmount);
    } catch (e) {
      const code = (e as { code?: unknown })?.code;
      if (typeof code === 'string') return c.json({ error: code }, 502);
      throw e;
    }

    const now = Math.floor(Date.now() / 1000);
    db.prepare(
      `UPDATE trainers SET state = 'funded', topped_up_at = ?, topped_up_lamports = ? WHERE id = ?`
    ).run(now, topupAmount.toString(), row.id);

    guard.success(ip, key);
    return c.json({ state: 'funded' }, 200);
  });

  return router;
}
