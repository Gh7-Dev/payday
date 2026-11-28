import { Hono } from 'hono';
import type { DatabaseSync } from 'node:sqlite';
import {
  createNonce,
  verifyAndCreateSession,
  requireOrganizer,
  decodeBase58Pubkey,
} from '../session.js';

export function makeAuthRoutes(db: DatabaseSync) {
  const router = new Hono<{ Variables: { wallet: string; db: DatabaseSync } }>();

  // Inject db into context for all routes
  router.use('*', async (c, next) => {
    c.set('db', db);
    await next();
  });

  // POST /nonce — request a login nonce
  router.post('/nonce', async (c) => {
    let body: { wallet?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'invalid_json' }, 400);
    }

    const wallet = body.wallet;
    if (typeof wallet !== 'string' || !wallet) {
      return c.json({ error: 'wallet_required' }, 400);
    }

    // Validate it's a valid base58 Solana pubkey (32 bytes)
    if (!decodeBase58Pubkey(wallet)) {
      return c.json({ error: 'invalid_wallet' }, 400);
    }

    const result = createNonce(db, wallet);
    return c.json(result, 200);
  });

  // POST /verify — verify signature and create session
  router.post('/verify', async (c) => {
    let body: { wallet?: unknown; signature?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'invalid_json' }, 400);
    }

    const wallet = body.wallet;
    const signature = body.signature;

    if (typeof wallet !== 'string' || !wallet) {
      return c.json({ error: 'wallet_required' }, 400);
    }
    if (typeof signature !== 'string' || !signature) {
      return c.json({ error: 'signature_required' }, 400);
    }

    const token = verifyAndCreateSession(db, wallet, signature);
    if (!token) {
      return c.json({ error: 'invalid_signature' }, 401);
    }

    // Secure cookie flag comes from env COOKIE_SECURE (secure by default; only 'false' turns it off)
    const isSecure = process.env.COOKIE_SECURE !== 'false';
    const secure = isSecure ? '; Secure' : '';

    const maxAge = 43200;
    c.header(
      'Set-Cookie',
      `session=${token}; HttpOnly; SameSite=Lax${secure}; Max-Age=${maxAge}; Path=/`
    );
    return c.json({ ok: true, wallet }, 200);
  });

  // GET /me — return the authenticated wallet
  router.get('/me', requireOrganizer, (c) => {
    return c.json({ wallet: c.get('wallet') }, 200);
  });

  return router;
}
