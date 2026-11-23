import { Hono } from 'hono';
import type { DatabaseSync } from 'node:sqlite';
import type { ChainInterface } from './chain/interface.js';
import { MockChain } from './chain/mock.js';
import { makeAuthRoutes } from './routes/auth.js';
import { makeOrganizerRoutes } from './routes/organizer.js';
import { getDb, migrate } from './db.js';

export function createApp(db: DatabaseSync, chain: ChainInterface = new MockChain()) {
  const app = new Hono<{ Variables: { wallet: string; db: DatabaseSync } }>();

  app.get('/health', (c) => {
    return c.json({ status: 'ok' }, 200);
  });

  app.route('/auth', makeAuthRoutes(db));
  app.route('/', makeOrganizerRoutes(db, chain));

  return app;
}

const defaultDb = getDb(process.env.DATABASE_PATH ?? ':memory:');
migrate(defaultDb);
export const app = createApp(defaultDb);
