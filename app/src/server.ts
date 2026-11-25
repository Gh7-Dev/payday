import { serve } from '@hono/node-server';
import { createApp } from './index.js';
import { getDb, migrate } from './db.js';
import { MockChain } from './chain/mock.js';

const port = Number(process.env.PORT ?? 8787);
const dbPath = process.env.DATABASE_PATH ?? './payday.db';
const chainMode = process.env.CHAIN ?? 'mock';

if (chainMode === 'real') {
  throw new Error('real chain not implemented yet');
}

const chain = new MockChain();
const db = getDb(dbPath);
migrate(db);

const app = createApp(db, chain);

console.log(`Server starting on port ${port}, db path: ${dbPath}, chain mode: ${chainMode}`);

serve({
  fetch: app.fetch,
  port,
});
