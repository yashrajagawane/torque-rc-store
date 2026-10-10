import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveDatabaseSettings } from '../src/db/config.ts';

const base = {
  DATABASE_URL: 'postgresql://user:password@example.supabase.co:6543/postgres',
  DATABASE_SSL: 'true',
};

describe('runtime database TLS configuration', () => {
  it('keeps remote SSL verification enabled when no custom CA is configured', () => {
    assert.deepEqual(resolveDatabaseSettings('runtime', base).ssl, true);
  });

  it('rejects a CA certificate when SSL is explicitly disabled', () => {
    assert.throws(
      () => resolveDatabaseSettings('runtime', { ...base, DATABASE_SSL: 'false', DATABASE_CA_CERT: 'pem' }),
      /DATABASE_CA_CERT requires DATABASE_SSL=true or auto/,
    );
  });

  it('rejects malformed custom CA material without echoing it', () => {
    const secret = '-----BEGIN CERTIFICATE-----super-secret-----END CERTIFICATE-----';
    assert.throws(
      () => resolveDatabaseSettings('runtime', { ...base, DATABASE_CA_CERT: secret }),
      (error: unknown) => error instanceof Error
        && error.message === 'DATABASE_CA_CERT must contain a valid PEM CA certificate bundle.'
        && !error.message.includes('super-secret'),
    );
  });
});
