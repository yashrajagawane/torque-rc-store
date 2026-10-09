import { timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';
import { sql } from 'drizzle-orm';
import type { db } from '../db/index.ts';
import { expireInventoryReservations } from './inventory.ts';

type Database = typeof db;

function validBearerToken(header: string | undefined, secret: string | undefined) {
  if (!secret || secret.length < 32 || !header?.startsWith('Bearer ')) return false;
  const supplied = Buffer.from(header.slice(7));
  const expected = Buffer.from(secret);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export function createReservationCleanupHandler(options: {
  database: Pick<Database, 'transaction'>;
  getSecret: () => string | undefined;
  expire?: typeof expireInventoryReservations;
}): RequestHandler {
  return async (req, res) => {
    if (!validBearerToken(req.header('authorization'), options.getSecret())) {
      res.status(options.getSecret() ? 401 : 503).json({ error: 'Scheduled cleanup is unavailable or unauthorized.' });
      return;
    }
    try {
      const expiredReservations = await options.database.transaction(async (transaction) => {
        // Keep a scheduled invocation bounded even if the database is busy.
        await transaction.execute(sql`SET LOCAL statement_timeout = '8s'`);
        return (options.expire ?? expireInventoryReservations)(transaction);
      });
      res.status(200).json({ success: true, expiredReservations });
    } catch {
      res.status(503).json({ error: 'Scheduled cleanup could not be completed.' });
    }
  };
}
