import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { DatabaseSync } from 'node:sqlite';
import type { ChainInterface } from './chain/interface.js';
import { MockChain } from './chain/mock.js';
import { makeAuthRoutes } from './routes/auth.js';
import { makeOrganizerRoutes } from './routes/organizer.js';
import { makeClaimRoutes } from './routes/claim.js';
import { makeTrainerRoutes } from './routes/trainer.js';
import { makeRelayRoutes } from './routes/relay.js';
import type { RelayOptions } from './routes/relay.js';
import { Limiter } from './limiter.js';
import { getDb, migrate } from './db.js';
import idl from './chain/payday.idl.json' with { type: 'json' };

const MOCK_BACKEND_KEY = '11111111111111111111111111111111';

export function createApp(
  db: DatabaseSync,
  chain: ChainInterface = new MockChain(),
  guard: Limiter = new Limiter(),
  relayOpts: RelayOptions = {},
) {
  const app = new Hono<{ Variables: { wallet: string; db: DatabaseSync } }>();

  const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? 'http://localhost:5173')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  app.use(
    '*',
    cors({
      origin: (origin) => {
        if (!origin) return null;
        return allowedOrigins.includes(origin) ? origin : null;
      },
      credentials: true,
    }),
  );

  app.get('/health', (c) => {
    return c.json({ status: 'ok' }, 200);
  });

  app.get('/config', (c) => {
    const isReal = (chain as any)?.backendKeypair !== undefined || (chain as any)?.constructor?.name === 'RealChain';
    const programId = process.env.PROGRAM_ID ?? (idl as { address?: string }).address ?? '';
    let backendKey: string | null = null;

    if (isReal) {
      const realChain = chain as any;
      backendKey = realChain.backendKeypair?.publicKey ? realChain.backendKeypair.publicKey.toBase58() : null;
    } else {
      backendKey = MOCK_BACKEND_KEY;
    }

    return c.json(
      {
        chain: isReal ? 'real' : 'mock',
        cluster: 'devnet',
        programId,
        backendKey,
      },
      200,
    );
  });

  app.route('/auth', makeAuthRoutes(db));
  // Must stay BEFORE the organizer router: its use('*') middleware would otherwise 401 trainees/trainers.
  app.route('/claim', makeClaimRoutes(db, chain, guard));
  app.route('/trainer', makeTrainerRoutes(db, chain, guard));
  app.route('/relay', makeRelayRoutes(db, chain, relayOpts));
  app.route('/', makeOrganizerRoutes(db, chain));

  return app;
}

const defaultDb = getDb(process.env.DATABASE_PATH ?? ':memory:');
migrate(defaultDb);
export const app = createApp(defaultDb);
