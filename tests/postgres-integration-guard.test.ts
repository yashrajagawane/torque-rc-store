import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { initializePostgresIntegrationPool, postgresTargetFingerprint, resolvePostgresIntegrationSettings } from './postgres-integration-guard.ts';
import { createPostgresFixtureScope, withPostgresFixtureCleanup } from './postgres-fixture-scope.ts';

const base = {
  RUN_POSTGRES_INTEGRATION_TESTS: 'true',
  POSTGRES_TEST_DATABASE_CONFIRMATION: 'I_CONFIRM_DISPOSABLE_TEST_DATABASE',
  TEST_DATABASE_URL: 'postgresql://test_user:test_password@localhost:5432/rcmega_test',
};

describe('PostgreSQL integration test safety gate', () => {
  it('requires explicit opt-in and never falls back to application credentials', () => {
    assert.throws(() => resolvePostgresIntegrationSettings({ ...base, RUN_POSTGRES_INTEGRATION_TESTS: undefined, DATABASE_URL: base.TEST_DATABASE_URL }), /opt in/);
    assert.throws(() => resolvePostgresIntegrationSettings({ ...base, TEST_DATABASE_URL: undefined, DATABASE_URL: base.TEST_DATABASE_URL }), /TEST_DATABASE_URL/);
  });

  it('requires disposable-database confirmation and a test-named database', () => {
    assert.throws(() => resolvePostgresIntegrationSettings({ ...base, POSTGRES_TEST_DATABASE_CONFIRMATION: undefined }), /confirmation/);
    assert.throws(() => resolvePostgresIntegrationSettings({ ...base, TEST_DATABASE_URL: 'postgresql://u:p@localhost/app' }), /test database/);
  });

  it('requires explicit non-empty URL username and password before pool initialization', () => {
    const invalidUrls = [
      'postgresql://:password@localhost:5432/rcmega_test',
      'postgresql://test_user@localhost:5432/rcmega_test',
      'postgresql://test_user:%20%20@localhost:5432/rcmega_test',
      'postgresql://test%ZZ:password@localhost:5432/rcmega_test',
      'postgresql://test_user:pass%ZZ@localhost:5432/rcmega_test',
    ];
    for (const url of invalidUrls) {
      let poolFactoryCalled = false;
      assert.throws(() => initializePostgresIntegrationPool({
        ...base, TEST_DATABASE_URL: url, PGUSER: 'inherited-user', PGPASSWORD: 'inherited-password',
      }, () => { poolFactoryCalled = true; }));
      assert.equal(poolFactoryCalled, false, 'invalid URL credentials must fail before the pool factory runs');
    }
  });

  it('uses explicit URL credentials even when PGUSER and PGPASSWORD are inherited', () => {
    const options = initializePostgresIntegrationPool({
      ...base, PGUSER: 'unrelated-inherited-user', PGPASSWORD: 'unrelated-inherited-password',
    }, (value) => value);
    assert.equal(options.user, 'test_user');
    assert.equal(options.password, 'test_password');
    assert.equal(options.database, 'rcmega_test');
    assert.equal('connectionString' in options, false);
  });

  it('validates before pool initialization when required settings are absent', () => {
    let initialized = false;
    assert.throws(() => initializePostgresIntegrationPool({
      ...base, TEST_DATABASE_URL: undefined, PGUSER: 'inherited-user', PGPASSWORD: 'inherited-password',
    }, () => { initialized = true; }));
    assert.equal(initialized, false);
  });

  it('compares the test target with discrete runtime SQL settings', () => {
    assert.throws(() => resolvePostgresIntegrationSettings({
      ...base, SQL_HOST: 'LOCALHOST.', SQL_PORT: '5432', SQL_DB_NAME: 'rcmega_test',
      SQL_USER: 'different-user', SQL_PASSWORD: 'different-password',
    }), /must differ/);
    assert.throws(() => resolvePostgresIntegrationSettings({
      ...base, TEST_DATABASE_URL: 'postgresql://u:p@127.0.0.1/rcmega_test',
      SQL_HOST: 'localhost', SQL_PORT: '5432', SQL_DB_NAME: 'rcmega_test',
    }), /must differ/, 'loopback aliases normalize to the same local target');
  });

  it('normalizes equivalent PostgreSQL URL schemes, credentials, ports, and SSL parameters', () => {
    const sameByScheme = { ...base, DATABASE_URL: 'postgres://app:other@localhost/rcmega_test' };
    assert.throws(() => resolvePostgresIntegrationSettings(sameByScheme), /must differ/);
    const sameByOptions = { ...base, DATABASE_URL: 'postgresql://another:credential@localhost:5432/rcmega_test?sslmode=require' };
    assert.throws(() => resolvePostgresIntegrationSettings(sameByOptions), /must differ/);
    const differentDatabase = { ...base, DATABASE_URL: 'postgres://app:other@localhost:5432/rcmega_app?sslmode=disable' };
    assert.equal(resolvePostgresIntegrationSettings(differentDatabase).databaseName, 'rcmega_test');
  });

  it('compares migration URL and migration credentials using the shared discrete target', () => {
    assert.throws(() => resolvePostgresIntegrationSettings({ ...base, MIGRATION_DATABASE_URL: 'postgres://migration:credential@localhost/rcmega_test' }), /must differ/);
    assert.throws(() => resolvePostgresIntegrationSettings({
      ...base, SQL_HOST: 'localhost', SQL_DB_NAME: 'rcmega_test', SQL_USER: 'runtime', SQL_PASSWORD: 'runtime-password',
      SQL_ADMIN_USER: 'migration', SQL_ADMIN_PASSWORD: 'migration-password',
    }), /must differ/);
  });

  it('fails closed on malformed or partial configured targets without revealing credentials', () => {
    const secretUrl = 'postgresql://sensitive-user:very-secret@db.example/rcmega_test';
    assert.throws(() => resolvePostgresIntegrationSettings({ ...base, DATABASE_URL: secretUrl.replace('postgresql:', 'mysql:') }), (error) => {
      assert.match((error as Error).message, /cannot be safely compared/);
      assert.equal((error as Error).message.includes('very-secret'), false);
      assert.equal((error as Error).message.includes('sensitive-user'), false);
      return true;
    });
    assert.throws(() => resolvePostgresIntegrationSettings({ ...base, SQL_HOST: 'localhost' }), /cannot be safely compared/);
    assert.throws(() => resolvePostgresIntegrationSettings({ ...base, SQL_HOST: 'localhost', SQL_DB_NAME: 'rcmega_test', SQL_PORT: 'not-a-port' }), /invalid port/);
    assert.throws(() => resolvePostgresIntegrationSettings({ ...base, SQL_HOST: 'localhost', SQL_DB_NAME: 'app', SQL_ADMIN_USER: 'admin' }), /migration credentials/);
    assert.throws(() => resolvePostgresIntegrationSettings({ ...base, DATABASE_URL: 'postgresql://user:pass@localhost/other?HOST=production.example' }), /cannot be safely compared/);
  });

  it('rejects remote targets by default and requires both opt-in and matching normalized fingerprint', () => {
    const remote = { ...base, TEST_DATABASE_URL: 'postgres://tester:password@Db.Example.COM/rcmega_test?sslmode=require' };
    assert.throws(() => resolvePostgresIntegrationSettings(remote), /disabled by default/);
    assert.throws(() => resolvePostgresIntegrationSettings({ ...remote, ALLOW_REMOTE_TEST_DATABASE: 'true' }), /fingerprint/);
    assert.throws(() => resolvePostgresIntegrationSettings({ ...remote, ALLOW_REMOTE_TEST_DATABASE: 'true', TEST_DATABASE_EXPECTED_FINGERPRINT: 'wrong' }), /fingerprint/);
    const allowed = resolvePostgresIntegrationSettings({
      ...remote, ALLOW_REMOTE_TEST_DATABASE: 'true', TEST_DATABASE_EXPECTED_FINGERPRINT: 'db.example.com:5432/rcmega_test',
    });
    assert.equal(allowed.ssl, true);
    assert.equal(postgresTargetFingerprint(allowed), 'db.example.com:5432/rcmega_test');
  });

  it('returns safe errors without echoing test URL secrets', () => {
    const secretUrl = 'postgresql://private-user:private-password@localhost/rcmega_test';
    assert.throws(() => resolvePostgresIntegrationSettings({ ...base, TEST_DATABASE_URL: secretUrl, DATABASE_URL: secretUrl }), (error) => {
      assert.equal((error as Error).message.includes('private-password'), false);
      assert.equal((error as Error).message.includes('private-user'), false);
      return true;
    });
  });

  it('cleans only IDs registered by a partially created fixture and preserves the original failure', async () => {
    const scope = createPostgresFixtureScope();
    const generatedSlug = 'pg-integration-generated-test-slug';
    const generatedOrderId = 90123;
    const unrelatedRows = ['other-product', 81234];
    const cleaned: { slugs?: string[]; orderIds?: number[] } = {};
    const reported: string[] = [];
    const original = new Error('fixture insert failed');

    await assert.rejects(withPostgresFixtureCleanup(async () => {
      scope.productSlugs.push(generatedSlug);
      scope.orderCustomerAuthIds.push('generated-test-customer-id');
      scope.orderIds.push(generatedOrderId);
      throw original;
    }, async () => {
      cleaned.slugs = [...scope.productSlugs];
      cleaned.orderIds = [...scope.orderIds];
      throw new Error('cleanup failed with a private connection URL');
    }, (message) => reported.push(message)), (error) => error === original);

    assert.deepEqual(cleaned.slugs, [generatedSlug]);
    assert.deepEqual(cleaned.orderIds, [generatedOrderId]);
    assert.deepEqual(unrelatedRows, ['other-product', 81234], 'mock cleanup has no broad-table targets');
    assert.deepEqual(reported, ['PostgreSQL integration fixture cleanup failed after a scenario failure.']);
    assert.equal(reported.join('').includes('private connection URL'), false);
  });

  it('reports cleanup failure after a successful scenario with a generic error', async () => {
    await assert.rejects(withPostgresFixtureCleanup(async () => 'done', async () => {
      throw new Error('credential-bearing error');
    }, () => {}), /fixture cleanup failed\.$/);
    await assert.rejects(withPostgresFixtureCleanup(async () => 'done', async () => {
      throw new Error('credential-bearing error');
    }, () => {}), (error) => {
      assert.equal((error as Error).message.includes('credential-bearing'), false);
      return true;
    });
  });
});
