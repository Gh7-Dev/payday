import { serve } from '@hono/node-server';
import { createApp } from './index.js';
import { getDb, migrate } from './db.js';
import { MockChain } from './chain/mock.js';
import { RealChain } from './chain/real.js';
import type { ChainInterface } from './chain/interface.js';

const port = Number(process.env.PORT ?? 8787);
const dbPath = process.env.DATABASE_PATH ?? './payday.db';
const chainMode = process.env.CHAIN ?? 'mock';

let chain: ChainInterface;
if (chainMode === 'real') {
  chain = new RealChain();
} else {
  chain = new MockChain();
}

const db = getDb(dbPath);
migrate(db);

const app = createApp(db, chain);

console.log(`Server starting on port ${port}, db path: ${dbPath}, chain mode: ${chainMode}`);

serve({
  fetch: app.fetch,
  port,
});
