import { Hono } from 'hono';
import { makeAuthRoutes } from './routes/auth.js';
import { getDb, migrate } from './db.js';

const db = getDb(process.env.DATABASE_PATH ?? ':memory:');
migrate(db);

export const app = new Hono<{ Variables: { wallet: string } }>();

app.get('/health', (c) => {
  return c.json({ status: 'ok' }, 200);
});

app.route('/auth', makeAuthRoutes(db));
