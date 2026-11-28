import { Hono } from 'hono';
import type { DatabaseSync } from 'node:sqlite';
import type { ChainInterface, ProgrammeAccount } from '../chain/interface.js';
import { requireOrganizer } from '../session.js';

function serialize(p: ProgrammeAccount) {
  return Object.fromEntries(
    Object.entries(p).map(([k, v]) => [k, typeof v === 'bigint' ? v.toString() : v]),
  );
}

export function makeChainStatusRoutes(
  db: DatabaseSync,
  chain: ChainInterface,
  now: () => number = () => Math.floor(Date.now() / 1000),
) {
  const router = new Hono<{ Variables: { wallet: string; db: DatabaseSync } }>();
  const PATH = '/events/:id/chain-status';

  router.use(PATH, async (c, next) => {
    c.set('db', db);
    await next();
  });
  router.use(PATH, requireOrganizer);

  router.get(PATH, async (c) => {
    const wallet = c.get('wallet');
    const eventId = String(c.req.param('id') ?? '');
    const event = db
      .prepare(`SELECT id FROM events WHERE id = ? AND organizer_wallet = ?`)
      .get(eventId, wallet);
    if (!event) return c.json({ error: 'not_found' }, 404);

    let programme: ProgrammeAccount | null;
    let vault: bigint | null = null;
    try {
      programme = await chain.getProgramme();
      if (programme) vault = await chain.getVaultBalance();
    } catch {
      return c.json({ error: 'chain_unavailable' }, 502);
    }

    if (!programme || vault === null) {
      return c.json({
        phase: 'not_created', programme: null, vaultBalance: null,
        currentDay: null, endTs: null, reclaimable: false,
      }, 200);
    }

    const nowB = BigInt(now());
    const endTs = programme.startTs + BigInt(programme.days) * programme.dayLen;
    let phase: 'not_started' | 'running' | 'ended' | 'reclaimed';
    let currentDay: number | null = null;
    if (programme.reclaimed) phase = 'reclaimed';
    else if (nowB < programme.startTs) phase = 'not_started';
    else if (nowB >= endTs) phase = 'ended';
    else {
      phase = 'running';
      currentDay = Number((nowB - programme.startTs) / programme.dayLen);
    }

    return c.json({
      phase,
      programme: serialize(programme),
      vaultBalance: vault.toString(),
      currentDay,
      endTs: endTs.toString(),
      reclaimable: phase === 'ended' && vault > 0n,
    }, 200);
  });

  return router;
}
