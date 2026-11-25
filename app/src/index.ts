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
