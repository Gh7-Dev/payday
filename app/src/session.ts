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

  // Remove any old nonce rows for this wallet to prevent accumulation
  db.prepare(`DELETE FROM sessions WHERE wallet_address = ? AND nonce != ''`).run(wallet);
  // Also clean up old nonce rows (wallet_address IS NULL) for this wallet stored in nonce field
  // We store wallet in wallet_address for nonce rows too, so we can look them up
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

  // Find the nonce row for this wallet — nonce rows have a nonce value and wallet in wallet_address
  // We identify nonce rows by the fact they're not session rows; sessions have no nonce (empty nonce)
  // Actually per schema design: nonce rows have wallet_address set and nonce set; sessions have wallet_address set and nonce=''
  const row = db.prepare(
    `SELECT id, nonce, expires_at FROM sessions WHERE wallet_address = ? AND nonce != '' AND expires_at > ? LIMIT 1`
  ).get(wallet, now) as { id: string; nonce: string; expires_at: number } | undefined;

  if (!row) return null;

  // Verify signature
  const message = buildNonceMessage(wallet, row.nonce, row.expires_at);
  const msgBytes = new TextEncoder().encode(message);

  let sigBytes: Uint8Array;
  try {
    sigBytes = bs58.decode(signatureBase58);
  } catch {
    return null;
  }

  const valid = nacl.sign.detached.verify(msgBytes, sigBytes, pubkeyBytes);
  if (!valid) return null;

  // Delete the nonce row (single-use)
  db.prepare(`DELETE FROM sessions WHERE id = ?`).run(row.id);

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
