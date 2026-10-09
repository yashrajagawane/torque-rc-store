import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { describe, it } from 'node:test';
import express from 'express';
import { createHealthRouter } from '../src/server/health-routes.ts';
import { createReservationCleanupHandler } from '../src/server/reservation-cron-route.ts';

async function withServer(app: express.Express, run: (baseUrl: string) => Promise<void>) {
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

describe('health and scheduled cleanup routes', () => {
  it('exposes a non-sensitive liveness response without checking the database', async () => {
    let databaseChecks = 0;
    const app = express().use(createHealthRouter(async () => { databaseChecks += 1; }));
    await withServer(app, async (url) => {
      const response = await fetch(`${url}/api/health`);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { status: 'ok' });
      assert.equal(databaseChecks, 0);
    });
  });

  it('reports readiness only after a bounded database check succeeds', async () => {
    const app = express().use(createHealthRouter(async () => undefined));
    await withServer(app, async (url) => {
      const response = await fetch(`${url}/api/ready`);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { status: 'ready' });
    });
  });

  it('returns a generic unavailable response for database readiness failures', async () => {
    const app = express().use(createHealthRouter(async () => { throw new Error('postgres://user:password@host/db'); }));
    await withServer(app, async (url) => {
      const response = await fetch(`${url}/api/ready`);
      assert.equal(response.status, 503);
      const body = await response.text();
      assert.doesNotMatch(body, /user|password|host|postgres/);
    });
  });

  it('rejects scheduled cleanup without a configured secret or valid bearer token', async () => {
    let transactions = 0;
    const app = express().post('/expire', createReservationCleanupHandler({
      database: { transaction: async () => { transactions += 1; return 0; } } as never,
      getSecret: () => undefined,
      expire: async () => 0,
    }));
    await withServer(app, async (url) => {
      const missingSecret = await fetch(`${url}/expire`, { method: 'POST' });
      assert.equal(missingSecret.status, 503);
      const badToken = await fetch(`${url}/expire`, { method: 'POST', headers: { Authorization: `Bearer ${'x'.repeat(40)}` } });
      assert.equal(badToken.status, 503);
      assert.equal(transactions, 0);
    });
  });

  it('runs the existing cleanup transaction with a valid secret and returns only aggregate counts', async () => {
    const secret = 'test-only-cron-secret-'.padEnd(40, 'x');
    let cleanupCalls = 0;
    let timeoutConfigured = false;
    const app = express().post('/expire', createReservationCleanupHandler({
      database: {
        transaction: async (callback: (transaction: unknown) => Promise<number>) => callback({
          execute: async () => { timeoutConfigured = true; return undefined; },
        }),
      } as never,
      getSecret: () => secret,
      expire: async () => { cleanupCalls += 1; return 7; },
    }));
    await withServer(app, async (url) => {
      const response = await fetch(`${url}/expire`, { method: 'POST', headers: { Authorization: `Bearer ${secret}` } });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { success: true, expiredReservations: 7 });
      assert.equal(cleanupCalls, 1);
      assert.equal(timeoutConfigured, true);
    });
  });

  it('does not return database error details from scheduled cleanup failures', async () => {
    const secret = 'test-only-cron-secret-'.padEnd(40, 'x');
    const app = express().post('/expire', createReservationCleanupHandler({
      database: { transaction: async () => { throw new Error('postgres://user:password@host/db'); } } as never,
      getSecret: () => secret,
      expire: async () => 0,
    }));
    await withServer(app, async (url) => {
      const response = await fetch(`${url}/expire`, { method: 'POST', headers: { Authorization: `Bearer ${secret}` } });
      assert.equal(response.status, 503);
      const body = await response.text();
      assert.doesNotMatch(body, /user|password|host|postgres/);
    });
  });
});
