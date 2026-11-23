import { createHash, randomBytes } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import type { Context, Next } from 'hono';

const NONCE_TTL = 300;      // 5 minutes in seconds
const SESSION_TTL = 43200;  // 12 hours in seconds

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

function sha256hex(data: string): string {
  return createHash('sha256').update(data).digest('hex');
}

export function decodeBase58Pubkey(wallet: string): Uint8Array | null {
  try {
    const bytes = bs58.decode(wallet);
    if (bytes.length !== 32) return null;
    return bytes;
  } catch {
    return null;
  }
}

export function buildNonceMessage(wallet: string, nonce: string, expiresAt: number): string {
  const expiry = new Date(expiresAt * 1000).toISOString();
  return `PayDay login\nWallet: ${wallet}\nNonce: ${nonce}\nExpires: ${expiry}`;
}

export interface NonceResult {
  nonce: string;
  message: string;
  expiresAt: number;
}

export function createNonce(db: DatabaseSync, wallet: string): NonceResult {
  const nonce = randomBytes(16).toString('hex');
  const now = nowSec();
  const expiresAt = now + NONCE_TTL;
  const id = sha256hex(`nonce:${wallet}:${nonce}:${now}`);
  const message = buildNonceMessage(wallet, nonce, expiresAt);

  // 1) Delete expired nonce rows for this wallet
  db.prepare(`DELETE FROM sessions WHERE wallet_address = ? AND nonce != '' AND expires_at <= ?`).run(wallet, now);

  // 2) Keep at most 5 live ones (if currently >= 5 live rows, delete the oldest so that adding 1 leaves at most 5)
  // Retrieve all currently active nonce rows for this wallet ordered oldest to newest (created_at ASC)
  const activeRows = db.prepare(
    `SELECT id FROM sessions WHERE wallet_address = ? AND nonce != '' AND expires_at > ? ORDER BY created_at ASC`
  ).all(wallet, now) as Array<{ id: string }>;

  if (activeRows.length >= 5) {
    const toDeleteCount = activeRows.length - 4; // leave 4 so after insert we have 5
    for (let i = 0; i < toDeleteCount; i++) {
      db.prepare(`DELETE FROM sessions WHERE id = ?`).run(activeRows[i].id);
    }
  }

  // Insert the new nonce
  db.prepare(
    `INSERT INTO sessions (id, wallet_address, nonce, expires_at, created_at) VALUES (?, ?, ?, ?, ?)`
  ).run(id, wallet, nonce, expiresAt, now);

  return { nonce, message, expiresAt };
}

export function verifyAndCreateSession(
  db: DatabaseSync,
  wallet: string,
  signatureBase58: string
): string | null {
  const pubkeyBytes = decodeBase58Pubkey(wallet);
  if (!pubkeyBytes) return null;

  const now = nowSec();

  let sigBytes: Uint8Array;
  try {
    sigBytes = bs58.decode(signatureBase58);
  } catch {
    return null;
  }

  // Check all unexpired nonce rows for this wallet to find a matching valid signature
  const rows = db.prepare(
    `SELECT id, nonce, expires_at FROM sessions WHERE wallet_address = ? AND nonce != '' AND expires_at > ? ORDER BY created_at DESC`
  ).all(wallet, now) as Array<{ id: string; nonce: string; expires_at: number }>;

  if (rows.length === 0) return null;

  let matchedRow: { id: string; nonce: string; expires_at: number } | null = null;
  for (const row of rows) {
    const message = buildNonceMessage(wallet, row.nonce, row.expires_at);
    const msgBytes = new TextEncoder().encode(message);
    if (nacl.sign.detached.verify(msgBytes, sigBytes, pubkeyBytes)) {
      matchedRow = row;
      break;
    }
  }

  if (!matchedRow) return null;

  // Nonce is consumed ONLY after successful verify: delete the matched nonce row
  db.prepare(`DELETE FROM sessions WHERE id = ?`).run(matchedRow.id);

  // Create session token
  const tokenHex = randomBytes(32).toString('hex');
  const tokenHash = sha256hex(tokenHex);
  const expiresAt = now + SESSION_TTL;

  db.prepare(
    `INSERT INTO sessions (id, wallet_address, nonce, expires_at, created_at) VALUES (?, ?, '', ?, ?)`
  ).run(tokenHash, wallet, expiresAt, now);

  return tokenHex;
}

export function getSessionWallet(db: DatabaseSync, tokenHex: string): string | null {
  const tokenHash = sha256hex(tokenHex);
  const now = nowSec();
  const row = db.prepare(
    `SELECT wallet_address FROM sessions WHERE id = ? AND nonce = '' AND expires_at > ?`
  ).get(tokenHash, now) as { wallet_address: string } | undefined;
  return row?.wallet_address ?? null;
}

export function requireOrganizer(c: Context, next: Next): Promise<Response | void> {
  const db: DatabaseSync = c.get('db');
  const cookie = getCookieValue(c.req.raw.headers.get('cookie') ?? '', 'session');
  if (!cookie) return Promise.resolve(c.json({ error: 'unauthorized' }, 401));

  const wallet = getSessionWallet(db, cookie);
  if (!wallet) return Promise.resolve(c.json({ error: 'unauthorized' }, 401));

  c.set('wallet', wallet);
  return next();
}

function getCookieValue(cookieHeader: string, name: string): string | null {
  for (const part of cookieHeader.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k.trim() === name) return rest.join('=').trim();
  }
  return null;
}
