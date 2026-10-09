import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { describe, it } from 'node:test';
import express from 'express';
import { contactInquiries } from '../src/db/schema.ts';
import { createRequireAuth, createRequireOwner } from '../src/server/auth.ts';
import { contactInquirySchema, createAdminContactInquiryRouter, createContactRateLimiter, createPublicContactRouter } from '../src/server/contact-routes.ts';

const validInquiry = {
  name: 'Avery RC',
  email: 'avery@example.test',
  phone: '+91 98765 43210',
  inquiryType: 'Technical Advice',
  model: 'Trail Runner',
  message: 'Could you recommend a suitable battery for this model?',
};

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

function mockOwnerMiddleware() {
  const authenticate = createRequireAuth(async (token) => token === 'owner-token'
    ? { id: 'owner-id', email: 'owner@example.test', email_confirmed_at: 'confirmed', user_metadata: {} }
    : token === 'customer-token'
      ? { id: 'customer-id', email: 'customer@example.test', email_confirmed_at: 'confirmed', user_metadata: {} }
      : null);
  return { authenticate, authorize: createRequireOwner(() => 'owner@example.test') };
}

describe('contact inquiry workflow', () => {
  it('validates and bounds public inquiry fields', () => {
    assert.equal(contactInquirySchema.safeParse(validInquiry).success, true);
    assert.equal(contactInquirySchema.safeParse({ ...validInquiry, email: 'not-email' }).success, false);
    assert.equal(contactInquirySchema.safeParse({ ...validInquiry, name: 'x' }).success, false);
    assert.equal(contactInquirySchema.safeParse({ ...validInquiry, inquiryType: 'Other' }).success, false);
    assert.equal(contactInquirySchema.safeParse({ ...validInquiry, message: 'short' }).success, false);
    assert.equal(contactInquirySchema.safeParse({ ...validInquiry, message: 'x'.repeat(5001) }).success, false);
    assert.equal(contactInquirySchema.safeParse({ ...validInquiry, unexpected: 'value' }).success, false);
  });

  it('returns success only after the inquiry has been persisted', async () => {
    const savedAt = new Date('2026-10-09T12:00:00Z');
    let persisted: Record<string, unknown> | undefined;
    const database = {
      insert(table: unknown) {
        assert.equal(table, contactInquiries);
        return { values(values: Record<string, unknown>) {
          persisted = values;
          return { returning: async () => [{ id: 42, createdAt: savedAt }] };
        } };
      },
    } as unknown as Parameters<typeof createPublicContactRouter>[0];
    const app = express();
    app.use(express.json());
    app.use('/api/contact-inquiries', createPublicContactRouter(database));

    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/contact-inquiries`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(validInquiry),
      });
      assert.equal(response.status, 201);
      assert.deepEqual(await response.json(), {
        id: 42,
        createdAt: savedAt.toISOString(),
        message: 'Your inquiry was received and saved for store review. No email was sent automatically.',
      });
      assert.deepEqual(persisted, { ...validInquiry, phone: validInquiry.phone });
    });
  });

  it('returns validation errors without touching the database', async () => {
    let inserts = 0;
    const database = { insert() { inserts += 1; throw new Error('must not run'); } } as unknown as Parameters<typeof createPublicContactRouter>[0];
    const app = express();
    app.use(express.json());
    app.use('/api/contact-inquiries', createPublicContactRouter(database));
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/contact-inquiries`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...validInquiry, message: '' }),
      });
      assert.equal(response.status, 400);
      assert.equal(inserts, 0);
    });
  });

  it('returns a safe service error when persistence fails', async () => {
    const database = { insert: () => ({ values: () => ({ returning: async () => { throw new Error('postgres://secret-user:secret-password@private-host/private-db'); } }) }) } as unknown as Parameters<typeof createPublicContactRouter>[0];
    const originalError = console.error;
    console.error = () => undefined;
    const app = express();
    app.use(express.json());
    app.use('/api/contact-inquiries', createPublicContactRouter(database));
    try {
      await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/contact-inquiries`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(validInquiry),
        });
        assert.equal(response.status, 503);
        const body = await response.text();
        assert.match(body, /could not be saved/);
        assert.doesNotMatch(body, /secret-user|secret-password|private-host|private-db/);
      });
    } finally {
      console.error = originalError;
    }
  });

  it('protects the inbox from unauthenticated customers and allows only the owner', async () => {
    let reads = 0;
    const database = {
      select: () => ({ from: (table: unknown) => {
        assert.equal(table, contactInquiries);
        return { orderBy: () => ({ limit: async () => { reads += 1; return [{ id: 1, ...validInquiry, status: 'NEW', createdAt: new Date() }]; } }) };
      } }),
    } as unknown as Parameters<typeof createAdminContactInquiryRouter>[0];
    const { authenticate, authorize } = mockOwnerMiddleware();
    const app = express();
    app.use('/api/admin/contact-inquiries', createAdminContactInquiryRouter(database, authenticate, authorize));

    await withServer(app, async (baseUrl) => {
      const missing = await fetch(`${baseUrl}/api/admin/contact-inquiries`);
      assert.equal(missing.status, 401);
      const customer = await fetch(`${baseUrl}/api/admin/contact-inquiries`, { headers: { Authorization: 'Bearer customer-token' } });
      assert.equal(customer.status, 403);
      assert.equal(reads, 0);
      const owner = await fetch(`${baseUrl}/api/admin/contact-inquiries`, { headers: { Authorization: 'Bearer owner-token' } });
      assert.equal(owner.status, 200);
      assert.equal((await owner.json() as { inquiries: unknown[] }).inquiries.length, 1);
      assert.equal(reads, 1);
    });
  });

  it('limits repeated submissions from the same client without a database dependency', async () => {
    const limiter = createContactRateLimiter({ limit: 1, windowMs: 60_000, now: () => 1_000 });
    let inserts = 0;
    const database = { insert: () => ({ values: () => ({ returning: async () => { inserts += 1; return [{ id: inserts, createdAt: new Date() }]; } }) }) } as unknown as Parameters<typeof createPublicContactRouter>[0];
    const app = express();
    app.use(express.json());
    app.use('/api/contact-inquiries', createPublicContactRouter(database, limiter));
    await withServer(app, async (baseUrl) => {
      const submit = () => fetch(`${baseUrl}/api/contact-inquiries`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(validInquiry),
      });
      assert.equal((await submit()).status, 201);
      assert.equal((await submit()).status, 429);
      assert.equal(inserts, 1);
    });
  });

  it('keeps the fresh baseline at the legacy schema and applies inquiries only in forward migration 0006', async () => {
    const migration = await readFile(new URL('../drizzle/0006_contact-inquiries.sql', import.meta.url), 'utf8');
    const baseline = await readFile(new URL('../drizzle/fresh/0000_application-baseline.sql', import.meta.url), 'utf8');
    const testBootstrap = await readFile(new URL('./fixtures/postgres-integration-bootstrap.sql', import.meta.url), 'utf8');
    const freshJournal = JSON.parse(await readFile(new URL('../drizzle/fresh/meta/_journal.json', import.meta.url), 'utf8')) as { entries: Array<{ when: number }> };
    const journal = JSON.parse(await readFile(new URL('../drizzle/meta/_journal.json', import.meta.url), 'utf8')) as { entries: Array<{ tag: string; when: number }> };
    assert.match(migration, /CREATE TABLE "contact_inquiries"/i);
    assert.match(migration, /contact_inquiries_created_at_idx/i);
    assert.match(migration, /contact_inquiries_status_valid/i);
    assert.doesNotMatch(baseline, /CREATE TABLE "contact_inquiries"/i);
    assert.match(testBootstrap, /CREATE TABLE "contact_inquiries"/i);
    assert.match(testBootstrap, /contact_inquiries_created_at_idx/i);
    assert.equal(freshJournal.entries.length, 1);
    assert.equal(journal.entries[6]?.tag, '0006_contact-inquiries');
    assert.ok(journal.entries[6]!.when > freshJournal.entries[0]!.when);
  });
});
