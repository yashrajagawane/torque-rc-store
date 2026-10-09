import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  assertStagingIdentity,
  assertStagingDataApiRoles,
  assertStagingInitializationState,
  assertStagingMigrationHistory,
  normalizeStagingSqlType,
  resolveSupabaseStagingSettings,
  type StagingCatalogState,
} from '../src/db/supabase-staging-guard.ts';
import {
  loadStagingRunnerDependencies,
  runSupabaseStagingCommand,
  type StagingRunnerDependencies,
} from '../scripts/supabase-staging-runner.ts';

const stagingRef = 'abcdefghijklmnopqrst';
const productionRef = 'zyxwvutsrqponmlkjihg';
const baseEnv: Record<string, string | undefined> = {
  SUPABASE_STAGING_ENABLED: 'true',
  SUPABASE_STAGING_PROJECT_REF: stagingRef,
  SUPABASE_PRODUCTION_PROJECT_REF: productionRef,
  SUPABASE_STAGING_DATABASE_URL: `postgresql://postgres:secret-password@db.${stagingRef}.supabase.co:5432/postgres?sslmode=require`,
  SUPABASE_STAGING_DATABASE_HOST: `db.${stagingRef}.supabase.co`,
  SUPABASE_STAGING_DATABASE_PORT: '5432',
  SUPABASE_STAGING_DATABASE_NAME: 'postgres',
  SUPABASE_STAGING_DATABASE_USER: 'postgres',
  SUPABASE_STAGING_DATABASE_EFFECTIVE_USER: 'postgres',
  SUPABASE_STAGING_RUNTIME_DATABASE_USER: 'postgres',
  SUPABASE_STAGING_SCHEMA: 'public',
  SUPABASE_STAGING_TARGET_FINGERPRINT: `db.${stagingRef}.supabase.co:5432/postgres/postgres`,
  SUPABASE_STAGING_INITIALIZATION_CONFIRMATION: 'I_CONFIRM_NEW_SUPABASE_STAGING_SCHEMA',
  SUPABASE_STAGING_MIGRATION_CONFIRMATION: 'I_CONFIRM_SUPABASE_STAGING_MIGRATION',
};

function state(deps: StagingRunnerDependencies, contact = false, securityApplied = false): StagingCatalogState {
  const tables = contact ? deps.expectedCurrentTables : deps.expectedBaselineTables;
  const columns = contact ? deps.expectedCurrentColumns : deps.expectedBaselineColumns;
  const indexes = contact ? deps.expectedCurrentIndexes : deps.expectedBaselineIndexes;
  const constraints = contact ? deps.expectedCurrentConstraints : deps.expectedBaselineConstraints;
  return {
    identity: { database: 'postgres', user: 'postgres', currentSchema: 'public', searchPath: 'public', serverPort: 5432 },
    publicObjects: [...tables, ...tables.map((table) => `${table}_id_seq`)].map((name) => ({ name, kind: 'relation', extensionOwned: false })),
    drizzleSchemaExists: true,
    drizzleRelations: ['__drizzle_migrations', '__drizzle_migrations_id_seq'],
    migrationHistory: [{ hash: deps.baseline.hash, createdAt: deps.baseline.when }],
    supabaseMigrationSchemaExists: false,
    supabaseMigrationRecords: 0,
    dataApiRoles: ['anon', 'authenticated'],
    applicationTables: tables,
    applicationColumns: Object.fromEntries(Object.entries(columns).map(([table, values]) => [table, values.map((column) => ({
      ...column,
      type: column.type === 'serial' ? 'integer' : column.type === 'bigserial' ? 'bigint' : column.type === 'timestamp' ? 'timestamp without time zone' : column.type,
    }))])),
    applicationIndexes: indexes,
    applicationConstraints: constraints,
    applicationColumnDefaults: contact ? { contact_inquiries: { status: "'NEW'::text", created_at: 'now()' } } : {},
    applicationRlsTables: securityApplied ? tables : [],
    applicationPolicies: [],
    contactInquiryStatusConstraint: contact ? "CHECK ((status = ANY (ARRAY['NEW'::text, 'REVIEWED'::text, 'CLOSED'::text])))" : undefined,
    contactInquiryCreatedAtIndex: contact ? 'CREATE INDEX contact_inquiries_created_at_idx ON public.contact_inquiries USING btree (created_at)' : undefined,
  };
}

describe('Supabase staging initialization guard', () => {
  it('accepts direct Supabase connections with explicit identity and TLS', () => {
    const settings = resolveSupabaseStagingSettings('initialize', ['--confirm-staging-initialize'], baseEnv);
    assert.equal(settings.projectRef, stagingRef);
    assert.equal(settings.schema, 'public');
    assert.equal(settings.ssl, true);
    assert.equal(settings.host, `db.${stagingRef}.supabase.co`);
    assert.equal(settings.port, 5432);
  });

  it('accepts the shared pooler only when its supplied username carries the staging reference', () => {
    const env = {
      ...baseEnv,
      SUPABASE_STAGING_DATABASE_URL: `postgresql://postgres.${stagingRef}:secret-password@aws-1-ap-south-1.pooler.supabase.com:6543/postgres?sslmode=require`,
      SUPABASE_STAGING_DATABASE_HOST: 'aws-1-ap-south-1.pooler.supabase.com',
      SUPABASE_STAGING_DATABASE_PORT: '6543',
      SUPABASE_STAGING_DATABASE_USER: `postgres.${stagingRef}`,
      SUPABASE_STAGING_DATABASE_EFFECTIVE_USER: 'postgres',
      SUPABASE_STAGING_TARGET_FINGERPRINT: `aws-1-ap-south-1.pooler.supabase.com:6543/postgres/postgres.${stagingRef}`,
    };
    const settings = resolveSupabaseStagingSettings('migrate', ['--confirm-staging-migrate'], env);
    assert.equal(settings.port, 6543);
    assert.equal(settings.user, `postgres.${stagingRef}`);
    assertStagingIdentity({ database: 'postgres', user: settings.effectiveUser, currentSchema: 'public', searchPath: 'public', serverPort: 5432 }, settings);
  });

  it('rejects production project references, wrong project-bearing endpoints, and wrong expected identity', () => {
    const cases = [
      { ...baseEnv, SUPABASE_PRODUCTION_PROJECT_REF: stagingRef },
      { ...baseEnv, SUPABASE_STAGING_DATABASE_URL: `postgresql://postgres:pw@db.${productionRef}.supabase.co:5432/postgres`, SUPABASE_STAGING_DATABASE_HOST: `db.${productionRef}.supabase.co`, SUPABASE_STAGING_TARGET_FINGERPRINT: `db.${productionRef}.supabase.co:5432/postgres/postgres` },
      { ...baseEnv, SUPABASE_STAGING_PROJECT_REF: undefined },
      { ...baseEnv, SUPABASE_STAGING_DATABASE_HOST: 'mismatch.supabase.co' },
      { ...baseEnv, SUPABASE_STAGING_DATABASE_PORT: '6543' },
      { ...baseEnv, SUPABASE_STAGING_DATABASE_NAME: 'wrongdb' },
      { ...baseEnv, SUPABASE_STAGING_DATABASE_USER: 'wronguser' },
      { ...baseEnv, SUPABASE_STAGING_SCHEMA: 'private' },
      { ...baseEnv, SUPABASE_STAGING_TARGET_FINGERPRINT: 'wrong' },
      { ...baseEnv, SUPABASE_STAGING_INITIALIZATION_CONFIRMATION: 'wrong' },
    ];
    for (const env of cases) assert.throws(() => resolveSupabaseStagingSettings('initialize', ['--confirm-staging-initialize'], env));
    assert.throws(() => resolveSupabaseStagingSettings('initialize', [], baseEnv));
    assert.throws(() => resolveSupabaseStagingSettings('initialize', ['--confirm-staging-initialize', '--confirm-staging-initialize'], baseEnv));
  });

  it('rejects malformed URLs, generic application target collisions, and malformed configured targets', () => {
    assert.throws(() => resolveSupabaseStagingSettings('initialize', ['--confirm-staging-initialize'], { ...baseEnv, SUPABASE_STAGING_DATABASE_URL: 'invalid' }));
    assert.throws(() => resolveSupabaseStagingSettings('initialize', ['--confirm-staging-initialize'], {
      ...baseEnv,
      DATABASE_URL: baseEnv.SUPABASE_STAGING_DATABASE_URL,
    }));
    assert.throws(() => resolveSupabaseStagingSettings('initialize', ['--confirm-staging-initialize'], {
      ...baseEnv,
      SQL_HOST: 'partial-config-only',
    }));
  });

  it('rejects public objects, existing Drizzle history, and Supabase CLI migration state', () => {
    const empty: StagingCatalogState = {
      identity: { database: 'postgres', user: 'postgres', currentSchema: 'public', searchPath: 'public', serverPort: 5432 },
      publicObjects: [], drizzleSchemaExists: false, drizzleRelations: [], migrationHistory: [],
      supabaseMigrationSchemaExists: false, supabaseMigrationRecords: 0, dataApiRoles: ['anon', 'authenticated'],
      applicationTables: [], applicationColumns: {}, applicationIndexes: [], applicationConstraints: [], applicationColumnDefaults: {}, applicationRlsTables: [], applicationPolicies: [],
    };
    assert.doesNotThrow(() => assertStagingInitializationState(empty));
    assert.throws(() => assertStagingInitializationState({ ...empty, publicObjects: [{ name: 'products', kind: 'relation', extensionOwned: false }] }));
    assert.throws(() => assertStagingInitializationState({ ...empty, publicObjects: [{ name: 'products', kind: 'relation', extensionOwned: true }] }, ['products']));
    assert.throws(() => assertStagingInitializationState({ ...empty, drizzleSchemaExists: true }));
    assert.throws(() => assertStagingInitializationState({ ...empty, supabaseMigrationSchemaExists: true }));
    assert.throws(() => assertStagingInitializationState({ ...empty, supabaseMigrationRecords: 1 }));
    assert.throws(() => assertStagingInitializationState({ ...empty, identity: { ...empty.identity, searchPath: '"$user", public' } }));
    const expected = resolveSupabaseStagingSettings('initialize', ['--confirm-staging-initialize'], baseEnv);
    assert.throws(() => assertStagingIdentity({ database: 'postgres', user: 'unexpected-role', currentSchema: 'public', searchPath: 'public', serverPort: 5432 }, expected));
  });

  it('accepts extension-owned public objects but rejects user-created objects', () => {
    const empty: StagingCatalogState = {
      identity: { database: 'postgres', user: 'postgres', currentSchema: 'public', searchPath: 'public', serverPort: 5432 },
      publicObjects: [{ name: 'extension_table', kind: 'relation', extensionOwned: true }],
      drizzleSchemaExists: false, drizzleRelations: [], migrationHistory: [],
      supabaseMigrationSchemaExists: false, supabaseMigrationRecords: 0, dataApiRoles: ['anon', 'authenticated'],
      applicationTables: [], applicationColumns: {}, applicationIndexes: [], applicationConstraints: [], applicationColumnDefaults: {}, applicationRlsTables: [], applicationPolicies: [],
    };
    assert.doesNotThrow(() => assertStagingInitializationState(empty));
    assert.throws(() => assertStagingInitializationState({ ...empty, publicObjects: [{ name: 'custom_function', kind: 'routine', extensionOwned: false }] }));
  });

  it('validates a baseline marker and a contiguous forward migration prefix without using server port as URL port', async () => {
    const deps = await loadStagingRunnerDependencies(async () => { throw new Error('unused'); });
    assert.equal(deps.forward[0]?.tag, '0006_contact-inquiries');
    assert.equal(deps.forward[1]?.tag, '0007_application-table-rls-api-hardening');
    assertStagingMigrationHistory([{ hash: deps.baseline.hash, createdAt: deps.baseline.when }], deps.baseline, deps.forward, true);
    assert.throws(() => assertStagingMigrationHistory([{ hash: 'wrong', createdAt: deps.baseline.when }], deps.baseline, deps.forward, true));
    const ordered = [
      { hash: deps.baseline.hash, createdAt: deps.baseline.when },
      ...deps.forward.map((entry) => ({ hash: entry.hash, createdAt: entry.when })),
    ];
    assert.doesNotThrow(() => assertStagingMigrationHistory(ordered, deps.baseline, deps.forward, false));
    assert.throws(() => assertStagingMigrationHistory([...ordered, ordered.at(-1)!], deps.baseline, deps.forward, false));
  });

  it('normalizes PostgreSQL type formatting and includes column unique and primary-key constraints', async () => {
    assert.equal(normalizeStagingSqlType('numeric(10, 2)'), 'numeric(10,2)');
    assert.equal(normalizeStagingSqlType('timestamp without time zone'), 'timestamp without time zone');
    const deps = await loadStagingRunnerDependencies(async () => { throw new Error('unused'); });
    assert.ok(deps.expectedBaselineConstraints.includes('users_uid_unique'));
    assert.ok(deps.expectedBaselineConstraints.includes('users_pkey'));
    assert.ok(deps.expectedBaselineConstraints.includes('products_pkey'));
  });

  it('requires both Supabase Data API roles and requires a shared runtime/migration role', () => {
    assert.doesNotThrow(() => assertStagingDataApiRoles(['anon', 'authenticated']));
    assert.throws(() => assertStagingDataApiRoles(['anon']));
    assert.throws(() => resolveSupabaseStagingSettings('migrate', ['--confirm-staging-migrate'], {
      ...baseEnv,
      SUPABASE_STAGING_RUNTIME_DATABASE_USER: 'different_runtime_role',
    }));
  });

  it('runs the baseline only after valid guard and schema preflight, then verifies the marker', async () => {
    const deps = await loadStagingRunnerDependencies(async () => { throw new Error('unused'); });
    let current: StagingCatalogState = {
      ...state(deps),
      publicObjects: [], drizzleSchemaExists: false, drizzleRelations: [], migrationHistory: [],
      applicationTables: [], applicationColumns: {}, applicationIndexes: [], applicationConstraints: [],
    };
    let baselineCalls = 0;
    let migrationCalls = 0;
    const code = await runSupabaseStagingCommand('initialize', ['--confirm-staging-initialize'], baseEnv, {
      ...deps,
      open: async (settings) => {
        assert.equal(settings.schema, 'public');
        return {
          inspect: async () => current,
          applyBaseline: async () => {
            baselineCalls += 1;
            current = state(deps);
          },
          applyForwardMigrations: async () => { migrationCalls += 1; },
          close: async () => undefined,
        };
      },
    });
    assert.equal(code, 0);
    assert.equal(baselineCalls, 1);
    assert.equal(migrationCalls, 0);
  });

  it('runs forward migrations on the verified baseline target and verifies 0006 exactly once', async () => {
    const deps = await loadStagingRunnerDependencies(async () => { throw new Error('unused'); });
    let current = state(deps);
    let migrations = 0;
    const code = await runSupabaseStagingCommand('migrate', ['--confirm-staging-migrate'], baseEnv, {
      ...deps,
      open: async (settings) => {
        assert.equal(settings.host, `db.${stagingRef}.supabase.co`);
        return {
          inspect: async () => current,
          applyBaseline: async () => assert.fail('baseline must not run in migration command'),
          applyForwardMigrations: async () => {
            migrations += 1;
            current = state(deps, true, true);
            current.migrationHistory = [
              { hash: deps.baseline.hash, createdAt: deps.baseline.when },
              ...deps.forward.map((entry) => ({ hash: entry.hash, createdAt: entry.when })),
            ];
          },
          close: async () => undefined,
        };
      },
    });
    assert.equal(code, 0);
    assert.equal(migrations, 1);
    assert.equal(current.migrationHistory.filter((entry) => entry.createdAt === deps.forward[0]?.when).length, 1);
  });

  it('fails invalid explicit opt-in before opening a connection and emits sanitized diagnostics', async () => {
    const deps = await loadStagingRunnerDependencies(async () => { throw new Error('must not connect'); });
    let opened = false;
    const messages: string[] = [];
    const code = await runSupabaseStagingCommand('initialize', ['--confirm-staging-initialize'], {
      ...baseEnv,
      SUPABASE_STAGING_ENABLED: undefined,
    }, {
      ...deps,
      open: async () => { opened = true; throw new Error('must not connect'); },
    }, (message) => messages.push(message));
    assert.equal(code, 2);
    assert.equal(opened, false);
    assert.ok(messages.some((message) => message.includes('CONFIGURATION_INVALID')));
    assert.ok(messages.every((message) => !/secret-password|postgresql:\/\//i.test(message)));
  });
});
