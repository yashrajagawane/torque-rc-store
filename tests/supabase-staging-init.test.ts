import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import {
  assertStagingIdentity,
  assertStagingDataApiRoles,
  assertStagingDataApiPrivileges,
  assertStagingInitializationState,
  assertStagingMigrationHistory,
  assertStagingRequiredSchemas,
  assertSupabaseAutomaticRlsConfiguration,
  assertSupabaseAutomaticRlsUnchanged,
  normalizeStagingSqlType,
  resolveSupabaseStagingSettings,
  type StagingCatalogState,
  type StagingDatabaseSettings,
} from '../src/db/supabase-staging-guard.ts';
import {
  loadStagingRunnerDependencies,
  runSupabaseStagingPreflight,
  runSupabaseStagingCommand,
  type StagingRunnerDependencies,
} from '../scripts/supabase-staging-runner.ts';

const stagingRef = 'abcdefghijklmnopqrst';
const productionRef = 'zyxwvutsrqponmlkjihg';
const approvedAutoRlsFunction = {
  schema: 'public', name: 'rls_auto_enable', argumentCount: 0, identityArguments: '', owner: 'postgres',
  language: 'plpgsql', returnType: 'event_trigger', securityDefiner: true, strict: false, volatility: 'v',
  configuration: ['search_path=pg_catalog'], sourceLength: 1055, sourceMd5: 'c44fb229ea8a6b0afd04a0a33261c16c',
};
const approvedAutoRlsTrigger = {
  name: 'ensure_rls', owner: 'postgres', enabled: 'O', event: 'ddl_command_end',
  tags: ['CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO'],
  handlerSchema: 'public', handlerName: 'rls_auto_enable', handlerArgumentCount: 0,
};
const baseEnv: Record<string, string | undefined> = {
  SUPABASE_STAGING_ENABLED: 'true',
  SUPABASE_STAGING_PROJECT_REF: stagingRef,
  SUPABASE_PRODUCTION_PROJECT_REF: productionRef,
  SUPABASE_STAGING_DATABASE_URL: `postgresql://postgres:secret-password@db.${stagingRef}.supabase.co:5432/postgres?sslmode=require`,
  SUPABASE_STAGING_DATABASE_HOST: `db.${stagingRef}.supabase.co`,
  SUPABASE_STAGING_DATABASE_PORT: '5432',
  SUPABASE_STAGING_DATABASE_NAME: 'postgres',
  SUPABASE_STAGING_DATABASE_USER: 'postgres',
  SUPABASE_STAGING_DATABASE_CA_FILE: resolve('test-fixtures', 'supabase-staging-root-ca.pem'),
  SUPABASE_STAGING_DATABASE_EFFECTIVE_USER: 'postgres',
  SUPABASE_STAGING_RUNTIME_DATABASE_USER: 'postgres',
  SUPABASE_STAGING_SCHEMA: 'public',
  SUPABASE_STAGING_TARGET_FINGERPRINT: `db.${stagingRef}.supabase.co:5432/postgres/postgres`,
  SUPABASE_STAGING_INITIALIZATION_CONFIRMATION: 'I_CONFIRM_NEW_SUPABASE_STAGING_SCHEMA',
  SUPABASE_STAGING_MIGRATION_CONFIRMATION: 'I_CONFIRM_SUPABASE_STAGING_MIGRATION',
  SUPABASE_STAGING_PREFLIGHT_CONFIRMATION: 'I_CONFIRM_READ_ONLY_SUPABASE_STAGING_PREFLIGHT',
};
const noProductionEnv: Record<string, string | undefined> = {
  ...baseEnv,
  SUPABASE_PRODUCTION_PROJECT_REF: '',
  SUPABASE_NO_PRODUCTION_PROJECT: 'true',
  SUPABASE_NO_PRODUCTION_PROJECT_CONFIRMATION: 'I_CONFIRM_NO_PRODUCTION_SUPABASE_PROJECT',
};

function state(deps: StagingRunnerDependencies, contact = false, securityApplied = true): StagingCatalogState {
  const tables = contact ? deps.expectedCurrentTables : deps.expectedBaselineTables;
  const columns = contact ? deps.expectedCurrentColumns : deps.expectedBaselineColumns;
  const indexes = contact ? deps.expectedCurrentIndexes : deps.expectedBaselineIndexes;
  const constraints = contact ? deps.expectedCurrentConstraints : deps.expectedBaselineConstraints;
  return {
    identity: { database: 'postgres', loginUser: 'postgres', user: 'postgres', currentSchema: 'public', searchPath: 'public', serverPort: 5432, transactionReadOnly: true },
    schemas: { public: true, auth: true, storage: true, drizzle: true, supabaseMigrations: false },
    publicObjects: [
      { name: 'rls_auto_enable', kind: 'routine', extensionOwned: false },
      ...[...tables, ...tables.map((table) => `${table}_id_seq`)].map((name) => ({ name, kind: 'relation', extensionOwned: false })),
    ],
    drizzleObjects: [],
    supabaseAutomaticRlsFunctions: [approvedAutoRlsFunction],
    eventTriggers: [approvedAutoRlsTrigger],
    drizzleSchemaExists: true,
    drizzleRelations: ['__drizzle_migrations', '__drizzle_migrations_id_seq'],
    migrationHistory: [{ hash: deps.baseline.hash, createdAt: deps.baseline.when }],
    supabaseMigrationSchemaExists: false,
    supabaseMigrationRecords: 0,
    dataApiRoles: ['anon', 'authenticated'],
    dataApiRoleAudit: ['anon', 'authenticated'].map((role) => ({ role, superuser: false, bypassRls: false, inheritsRuntimeOwner: false, publicUsage: true, publicCreate: false, authUsage: false, authCreate: false, storageUsage: false, storageCreate: false, drizzleUsage: false, drizzleCreate: false, applicationTablePrivileges: [], applicationSequencePrivileges: [] })),
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

function emptyPreflightState(deps: StagingRunnerDependencies): StagingCatalogState {
  return {
    ...state(deps),
    schemas: { public: true, auth: true, storage: true, drizzle: false, supabaseMigrations: false },
    publicObjects: [{ name: 'rls_auto_enable', kind: 'routine', extensionOwned: false }], drizzleObjects: [],
    drizzleSchemaExists: false, drizzleRelations: [], migrationHistory: [],
    supabaseMigrationSchemaExists: false, supabaseMigrationRecords: 0, supabaseMigrationEntries: [],
    applicationTables: [], applicationColumns: {}, applicationIndexes: [], applicationConstraints: [],
    applicationColumnDefaults: {}, applicationRlsTables: [], applicationPolicies: [],
    dataApiRoleAudit: ['anon', 'authenticated'].map((role) => ({ role, superuser: false, bypassRls: false, inheritsRuntimeOwner: false, publicUsage: true, publicCreate: false, authUsage: false, authCreate: false, storageUsage: false, storageCreate: false, drizzleUsage: false, drizzleCreate: false, applicationTablePrivileges: [], applicationSequencePrivileges: [] })),
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

  it('accepts explicit no-production mode only with the exact confirmation and no Production reference', () => {
    for (const mode of ['check', 'initialize', 'migrate'] as const) {
      const arg = mode === 'check' ? '--confirm-staging-preflight'
        : mode === 'initialize' ? '--confirm-staging-initialize' : '--confirm-staging-migrate';
      const settings = resolveSupabaseStagingSettings(mode, [arg], noProductionEnv);
      assert.equal(settings.projectRef, stagingRef);
    }

    const invalid = [
      { ...noProductionEnv, SUPABASE_NO_PRODUCTION_PROJECT_CONFIRMATION: undefined },
      { ...noProductionEnv, SUPABASE_NO_PRODUCTION_PROJECT_CONFIRMATION: 'wrong' },
      { ...noProductionEnv, SUPABASE_NO_PRODUCTION_PROJECT_CONFIRMATION: ' I_CONFIRM_NO_PRODUCTION_SUPABASE_PROJECT' },
      { ...noProductionEnv, SUPABASE_NO_PRODUCTION_PROJECT: 'yes' },
      { ...noProductionEnv, SUPABASE_NO_PRODUCTION_PROJECT: ' true ' },
      { ...noProductionEnv, SUPABASE_PRODUCTION_PROJECT_REF: productionRef },
      { ...noProductionEnv, SUPABASE_PRODUCTION_PROJECT_REF: stagingRef },
      { ...noProductionEnv, SUPABASE_NO_PRODUCTION_PROJECT: undefined },
      { ...noProductionEnv, SUPABASE_NO_PRODUCTION_PROJECT_CONFIRMATION: 'I_CONFIRM_NO_PRODUCTION_SUPABASE_PROJECT', SUPABASE_NO_PRODUCTION_PROJECT: undefined, SUPABASE_PRODUCTION_PROJECT_REF: '' },
    ];
    for (const env of invalid) {
      assert.throws(() => resolveSupabaseStagingSettings('check', ['--confirm-staging-preflight'], env));
    }
  });

  it('requires regular command confirmations plus the additional no-production confirmation', () => {
    assert.doesNotThrow(() => resolveSupabaseStagingSettings('initialize', ['--confirm-staging-initialize'], noProductionEnv));
    assert.doesNotThrow(() => resolveSupabaseStagingSettings('migrate', ['--confirm-staging-migrate'], noProductionEnv));
    assert.throws(() => resolveSupabaseStagingSettings('initialize', ['--confirm-staging-initialize'], {
      ...noProductionEnv, SUPABASE_STAGING_INITIALIZATION_CONFIRMATION: undefined,
    }));
    assert.throws(() => resolveSupabaseStagingSettings('migrate', ['--confirm-staging-migrate'], {
      ...noProductionEnv, SUPABASE_STAGING_MIGRATION_CONFIRMATION: undefined,
    }));
    assert.throws(() => resolveSupabaseStagingSettings('initialize', [], noProductionEnv));
    assert.throws(() => resolveSupabaseStagingSettings('migrate', ['--confirm-staging-migrate'], {
      ...noProductionEnv, SUPABASE_NO_PRODUCTION_PROJECT_CONFIRMATION: undefined,
    }));
  });

  it('rejects an equal staging and Production reference in normal mode', () => {
    assert.throws(() => resolveSupabaseStagingSettings('check', ['--confirm-staging-preflight'], {
      ...baseEnv,
      SUPABASE_PRODUCTION_PROJECT_REF: undefined,
    }));
    assert.throws(() => resolveSupabaseStagingSettings('check', ['--confirm-staging-preflight'], {
      ...baseEnv,
      SUPABASE_PRODUCTION_PROJECT_REF: stagingRef,
    }));
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
    assertStagingIdentity({ database: 'postgres', loginUser: settings.user, user: settings.effectiveUser, currentSchema: 'public', searchPath: 'public', serverPort: 5432 }, settings);
    assertStagingIdentity({ database: 'postgres', loginUser: settings.effectiveUser, user: settings.effectiveUser, currentSchema: 'public', searchPath: 'public', serverPort: 5432 }, settings);
    assert.throws(() => assertStagingIdentity({ database: 'postgres', loginUser: 'unexpected', user: settings.effectiveUser, currentSchema: 'public', searchPath: 'public', serverPort: 5432 }, settings));
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
    identity: { database: 'postgres', loginUser: 'postgres', user: 'postgres', currentSchema: 'public', searchPath: 'public', serverPort: 5432, transactionReadOnly: true },
      schemas: { public: true, auth: true, storage: true, drizzle: false, supabaseMigrations: false },
      supabaseAutomaticRlsFunctions: [approvedAutoRlsFunction], eventTriggers: [approvedAutoRlsTrigger],
      publicObjects: [{ name: 'rls_auto_enable', kind: 'routine', extensionOwned: false }], drizzleObjects: [], drizzleSchemaExists: false, drizzleRelations: [], migrationHistory: [],
      supabaseMigrationSchemaExists: false, supabaseMigrationRecords: 0, dataApiRoles: ['anon', 'authenticated'],
      dataApiRoleAudit: ['anon', 'authenticated'].map((role) => ({ role, superuser: false, bypassRls: false, inheritsRuntimeOwner: false, publicUsage: true, publicCreate: false, authUsage: false, authCreate: false, storageUsage: false, storageCreate: false, drizzleUsage: false, drizzleCreate: false, applicationTablePrivileges: [], applicationSequencePrivileges: [] })),
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
    assert.throws(() => assertStagingIdentity({ database: 'postgres', loginUser: 'postgres', user: 'unexpected-role', currentSchema: 'public', searchPath: 'public', serverPort: 5432 }, expected));
  });

  it('accepts extension-owned public objects but rejects user-created objects', () => {
    const empty: StagingCatalogState = {
      identity: { database: 'postgres', loginUser: 'postgres', user: 'postgres', currentSchema: 'public', searchPath: 'public', serverPort: 5432 },
      schemas: { public: true, auth: true, storage: true, drizzle: false, supabaseMigrations: false },
      supabaseAutomaticRlsFunctions: [approvedAutoRlsFunction], eventTriggers: [approvedAutoRlsTrigger],
      publicObjects: [{ name: 'extension_table', kind: 'relation', extensionOwned: true }],
      drizzleObjects: [],
      drizzleSchemaExists: false, drizzleRelations: [], migrationHistory: [],
      supabaseMigrationSchemaExists: false, supabaseMigrationRecords: 0, dataApiRoles: ['anon', 'authenticated'],
      dataApiRoleAudit: ['anon', 'authenticated'].map((role) => ({ role, superuser: false, bypassRls: false, inheritsRuntimeOwner: false, publicUsage: true, publicCreate: false, authUsage: false, authCreate: false, storageUsage: false, storageCreate: false, drizzleUsage: false, drizzleCreate: false, applicationTablePrivileges: [], applicationSequencePrivileges: [] })),
      applicationTables: [], applicationColumns: {}, applicationIndexes: [], applicationConstraints: [], applicationColumnDefaults: {}, applicationRlsTables: [], applicationPolicies: [],
    };
    assert.doesNotThrow(() => assertStagingInitializationState(empty));
    assert.throws(() => assertStagingInitializationState({ ...empty, publicObjects: [{ name: 'custom_function', kind: 'routine', extensionOwned: false }] }));
  });

  it('allows only the exact Supabase automatic-RLS function and associated enabled event trigger', () => {
    const accepted: StagingCatalogState = {
      identity: { database: 'postgres', loginUser: 'postgres', user: 'postgres', currentSchema: 'public', searchPath: 'public', serverPort: 5432 },
      schemas: { public: true, auth: true, storage: true, drizzle: false, supabaseMigrations: false },
      publicObjects: [{ name: 'rls_auto_enable', kind: 'routine', extensionOwned: false }],
      drizzleObjects: [],
      supabaseAutomaticRlsFunctions: [approvedAutoRlsFunction], eventTriggers: [approvedAutoRlsTrigger],
      drizzleSchemaExists: false, drizzleRelations: [], migrationHistory: [],
      supabaseMigrationSchemaExists: false, supabaseMigrationRecords: 0, dataApiRoles: ['anon', 'authenticated'],
      dataApiRoleAudit: ['anon', 'authenticated'].map((role) => ({ role, superuser: false, bypassRls: false, inheritsRuntimeOwner: false, publicUsage: true, publicCreate: false, authUsage: false, authCreate: false, storageUsage: false, storageCreate: false, drizzleUsage: false, drizzleCreate: false, applicationTablePrivileges: [], applicationSequencePrivileges: [] })),
      applicationTables: [], applicationColumns: {}, applicationIndexes: [], applicationConstraints: [], applicationColumnDefaults: {}, applicationRlsTables: [], applicationPolicies: [],
    };
    assert.doesNotThrow(() => assertStagingInitializationState(accepted));
    assert.doesNotThrow(() => assertSupabaseAutomaticRlsConfiguration(accepted));
    assert.doesNotThrow(() => assertSupabaseAutomaticRlsUnchanged(accepted, structuredClone(accepted)));

    const badStates: StagingCatalogState[] = [
      { ...accepted, supabaseAutomaticRlsFunctions: [{ ...approvedAutoRlsFunction, sourceMd5: '0'.repeat(32) }] },
      { ...accepted, supabaseAutomaticRlsFunctions: [{ ...approvedAutoRlsFunction, sourceLength: 1054 }] },
      { ...accepted, eventTriggers: [] },
      { ...accepted, eventTriggers: [{ ...approvedAutoRlsTrigger, enabled: 'D' }] },
      { ...accepted, eventTriggers: [{ ...approvedAutoRlsTrigger, tags: ['CREATE TABLE'] }] },
      { ...accepted, eventTriggers: [{ ...approvedAutoRlsTrigger, handlerName: 'other_handler' }] },
      { ...accepted, eventTriggers: [{ ...approvedAutoRlsTrigger, owner: 'other_owner' }] },
      { ...accepted, supabaseAutomaticRlsFunctions: [{ ...approvedAutoRlsFunction, securityDefiner: false }] },
      { ...accepted, supabaseAutomaticRlsFunctions: [{ ...approvedAutoRlsFunction, strict: true }] },
      { ...accepted, supabaseAutomaticRlsFunctions: [{ ...approvedAutoRlsFunction, volatility: 's' }] },
      { ...accepted, supabaseAutomaticRlsFunctions: [{ ...approvedAutoRlsFunction, configuration: ['search_path=public'] }] },
      { ...accepted, supabaseAutomaticRlsFunctions: [{ ...approvedAutoRlsFunction, owner: 'other_owner' }] },
      { ...accepted, supabaseAutomaticRlsFunctions: [{ ...approvedAutoRlsFunction, language: 'sql' }] },
      { ...accepted, supabaseAutomaticRlsFunctions: [{ ...approvedAutoRlsFunction, returnType: 'trigger' }] },
      { ...accepted, supabaseAutomaticRlsFunctions: [{ ...approvedAutoRlsFunction, argumentCount: 1 }] },
      { ...accepted, supabaseAutomaticRlsFunctions: [{ ...approvedAutoRlsFunction, identityArguments: 'value text' }] },
      { ...accepted, supabaseAutomaticRlsFunctions: [{ ...approvedAutoRlsFunction, schema: 'other_schema' }] },
      { ...accepted, supabaseAutomaticRlsFunctions: [{ ...approvedAutoRlsFunction, name: 'another_function' }] },
      { ...accepted, eventTriggers: [{ ...approvedAutoRlsTrigger, event: 'sql_drop' }] },
      { ...accepted, eventTriggers: [{ ...approvedAutoRlsTrigger, name: 'unexpected_trigger' }] },
      { ...accepted, eventTriggers: [{ ...approvedAutoRlsTrigger, handlerSchema: 'other_schema' }] },
      { ...accepted, eventTriggers: [{ ...approvedAutoRlsTrigger, handlerArgumentCount: 1 }] },
      { ...accepted, supabaseAutomaticRlsFunctions: [] },
      { ...accepted, eventTriggers: [approvedAutoRlsTrigger, { ...approvedAutoRlsTrigger, name: 'second_trigger' }] },
      { ...accepted, publicObjects: [...accepted.publicObjects, { name: 'custom_function', kind: 'routine', extensionOwned: false }] },
      { ...accepted, publicObjects: [...accepted.publicObjects, { name: 'unexpected_table', kind: 'relation', extensionOwned: false }] },
    ];
    for (const rejected of badStates) assert.throws(() => assertStagingInitializationState(rejected));
    assert.throws(() => assertSupabaseAutomaticRlsUnchanged(accepted, badStates[2]!));
  });

  it('does not allow a generic local initializer state to inherit the Supabase exception', () => {
    const genericState = {
      publicObjects: [{ name: 'rls_auto_enable', kind: 'routine', extensionOwned: false }],
    };
    // The generic initializer has its own relation-empty guard; the Supabase exception
    // is scoped to the staging guard and requires full catalog metadata.
    assert.throws(() => assertStagingInitializationState({
      identity: { database: 'postgres', loginUser: 'postgres', user: 'postgres', currentSchema: 'public', searchPath: 'public', serverPort: 5432 },
      schemas: { public: true, auth: true, storage: true, drizzle: false, supabaseMigrations: false },
      ...genericState,
      supabaseAutomaticRlsFunctions: [], eventTriggers: [], drizzleObjects: [], drizzleSchemaExists: false, drizzleRelations: [], migrationHistory: [],
      supabaseMigrationSchemaExists: false, supabaseMigrationRecords: 0, dataApiRoles: ['anon', 'authenticated'],
      dataApiRoleAudit: ['anon', 'authenticated'].map((role) => ({ role, superuser: false, bypassRls: false, inheritsRuntimeOwner: false, publicUsage: true, publicCreate: false, authUsage: false, authCreate: false, storageUsage: false, storageCreate: false, drizzleUsage: false, drizzleCreate: false, applicationTablePrivileges: [], applicationSequencePrivileges: [] })),
      applicationTables: [], applicationColumns: {}, applicationIndexes: [], applicationConstraints: [], applicationColumnDefaults: {}, applicationRlsTables: [], applicationPolicies: [],
    }));
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
    const safeRoles = ['anon', 'authenticated'].map((role) => ({
      role, superuser: false, bypassRls: false, inheritsRuntimeOwner: false, publicUsage: true, publicCreate: false,
      authUsage: false, authCreate: false, storageUsage: false, storageCreate: false,
      drizzleUsage: false, drizzleCreate: false, applicationTablePrivileges: [], applicationSequencePrivileges: [],
    }));
    assert.doesNotThrow(() => assertStagingDataApiPrivileges({ dataApiRoleAudit: safeRoles }));
    for (const changed of [
      { ...safeRoles[0]!, inheritsRuntimeOwner: true },
      { ...safeRoles[0]!, publicCreate: true },
      { ...safeRoles[0]!, drizzleCreate: true },
      { ...safeRoles[0]!, superuser: true },
      { ...safeRoles[0]!, bypassRls: true },
      { ...safeRoles[0]!, applicationTablePrivileges: ['orders:SELECT'] },
      { ...safeRoles[0]!, applicationSequencePrivileges: ['orders_id_seq:USAGE'] },
    ]) assert.throws(() => assertStagingDataApiPrivileges({ dataApiRoleAudit: [changed, safeRoles[1]] }));
    assert.throws(() => assertStagingRequiredSchemas({ public: true, auth: false, storage: true, drizzle: false, supabaseMigrations: false }));
    assert.throws(() => resolveSupabaseStagingSettings('migrate', ['--confirm-staging-migrate'], {
      ...baseEnv,
      SUPABASE_STAGING_RUNTIME_DATABASE_USER: 'different_runtime_role',
    }));
  });

  it('runs a strictly read-only preflight after target validation and closes the connection', async () => {
    const deps = await loadStagingRunnerDependencies(async () => { throw new Error('unused'); });
    const current = emptyPreflightState(deps);
    let opened = false;
    let closed = false;
    let mutationCalls = 0;
    const lines: string[] = [];
    const checkDeps = {
      ...deps,
      open: async (settings: StagingDatabaseSettings) => {
        opened = true;
        assert.equal(settings.automaticRlsRequired, true);
        return {
          inspect: async () => current,
          close: async () => { closed = true; },
          applyBaseline: async () => { mutationCalls += 1; },
          applyForwardMigrations: async () => { mutationCalls += 1; },
        };
      },
    };
    const code = await runSupabaseStagingPreflight(['--confirm-staging-preflight'], baseEnv, checkDeps, (line) => lines.push(line));
    assert.equal(code, 0);
    assert.equal(opened, true);
    assert.equal(closed, true);
    assert.equal(mutationCalls, 0);
    assert.ok(lines.some((line) => line.includes('ELIGIBLE for guarded baseline initialization')));
    assert.ok(lines.some((line) => line.includes('session_user=postgres')));
    assert.ok(lines.some((line) => line.includes('source_md5=c44fb229ea8a6b0afd04a0a33261c16c')));
  });

  it('fails read-only preflight configuration checks before opening a connection', async () => {
    const deps = await loadStagingRunnerDependencies(async () => { throw new Error('unused'); });
    let opened = false;
    const invalidEnvironments = [
      { ...baseEnv, SUPABASE_STAGING_ENABLED: undefined },
      { ...baseEnv, SUPABASE_STAGING_PROJECT_REF: productionRef },
      { ...baseEnv, SUPABASE_STAGING_TARGET_FINGERPRINT: 'mismatch' },
      { ...baseEnv, SUPABASE_STAGING_PREFLIGHT_CONFIRMATION: undefined },
      { ...baseEnv, DATABASE_URL: baseEnv.SUPABASE_STAGING_DATABASE_URL },
    ];
    for (const env of invalidEnvironments) {
      const code = await runSupabaseStagingPreflight(['--confirm-staging-preflight'], env, {
        ...deps,
        open: async () => { opened = true; throw new Error('must not connect'); },
      }, () => undefined);
      assert.equal(code, 2);
    }
    for (const env of [
      { ...noProductionEnv, SUPABASE_NO_PRODUCTION_PROJECT_CONFIRMATION: undefined },
      { ...noProductionEnv, SUPABASE_PRODUCTION_PROJECT_REF: 'fakeproductionreference' },
      { ...noProductionEnv, SUPABASE_STAGING_DATABASE_URL: undefined, DATABASE_URL: 'postgresql://app:secret@prod.example.com:5432/postgres' },
    ]) {
      const code = await runSupabaseStagingPreflight(['--confirm-staging-preflight'], env, {
        ...deps,
        open: async () => { opened = true; throw new Error('must not connect'); },
      }, () => undefined);
      assert.equal(code, 2);
    }
    assert.equal(opened, false);
  });

  it('keeps no-production preflight read-only and never calls a migrator', async () => {
    const deps = await loadStagingRunnerDependencies(async () => { throw new Error('unused'); });
    let opened = false;
    let closed = false;
    const current = emptyPreflightState(deps);
    const code = await runSupabaseStagingPreflight(['--confirm-staging-preflight'], noProductionEnv, {
      ...deps,
      open: async () => {
        opened = true;
        return {
          inspect: async () => current,
          close: async () => { closed = true; },
          applyBaseline: async () => assert.fail('preflight must not initialize'),
          applyForwardMigrations: async () => assert.fail('preflight must not migrate'),
        };
      },
    }, () => undefined);
    assert.equal(code, 0);
    assert.equal(opened, true);
    assert.equal(closed, true);
  });

  it('does not connect for no-production initialize or migrate when either confirmation is missing', async () => {
    const deps = await loadStagingRunnerDependencies(async () => { throw new Error('unused'); });
    let opened = false;
    for (const mode of ['initialize', 'migrate'] as const) {
      const arg = mode === 'initialize' ? '--confirm-staging-initialize' : '--confirm-staging-migrate';
      const commandConfirmation = mode === 'initialize'
        ? 'SUPABASE_STAGING_INITIALIZATION_CONFIRMATION'
        : 'SUPABASE_STAGING_MIGRATION_CONFIRMATION';
      for (const env of [
        { ...noProductionEnv, [commandConfirmation]: undefined },
        { ...noProductionEnv, SUPABASE_NO_PRODUCTION_PROJECT_CONFIRMATION: undefined },
      ]) {
        const code = await runSupabaseStagingCommand(mode, [arg], env, {
          ...deps,
          open: async () => { opened = true; throw new Error('must not connect'); },
        }, () => undefined);
        assert.equal(code, 2);
      }
    }
    assert.equal(opened, false);
  });

  it('reports catalog and privilege failures without mutation and closes after success or failure', async () => {
    const deps = await loadStagingRunnerDependencies(async () => { throw new Error('unused'); });
    const valid = emptyPreflightState(deps);
    const invalidStates: StagingCatalogState[] = [
      { ...valid, schemas: { ...valid.schemas, storage: false } },
      { ...valid, dataApiRoles: ['anon'] },
      { ...valid, dataApiRoleAudit: valid.dataApiRoleAudit!.map((role) => role.role === 'anon' ? { ...role, inheritsRuntimeOwner: true } : role) },
      { ...valid, dataApiRoleAudit: valid.dataApiRoleAudit!.map((role) => role.role === 'authenticated' ? { ...role, applicationTablePrivileges: ['orders:SELECT'] } : role) },
      { ...valid, publicObjects: [...valid.publicObjects, { name: 'unapproved', kind: 'routine', extensionOwned: false }] },
      { ...valid, drizzleSchemaExists: true, schemas: { ...valid.schemas, drizzle: true } },
      { ...valid, migrationHistory: [{ hash: 'unexpected', createdAt: 123 }] },
      { ...valid, supabaseMigrationSchemaExists: true, schemas: { ...valid.schemas, supabaseMigrations: true } },
      { ...valid, eventTriggers: [{ ...approvedAutoRlsTrigger, enabled: 'D' }] },
    ];
    for (const current of invalidStates) {
      let closed = false;
      let mutations = 0;
      const lines: string[] = [];
      const code = await runSupabaseStagingPreflight(['--confirm-staging-preflight'], baseEnv, {
        ...deps,
        open: async () => ({
          inspect: async () => current,
          close: async () => { closed = true; },
          applyBaseline: async () => { mutations += 1; },
          applyForwardMigrations: async () => { mutations += 1; },
        }),
      }, (line) => lines.push(line));
      assert.equal(code, 1);
      assert.equal(closed, true);
      assert.equal(mutations, 0);
      assert.ok(lines.some((line) => line.includes('NOT ELIGIBLE')));
    }
  });

  it('returns failure when a read-only preflight connection cannot be closed', async () => {
    const deps = await loadStagingRunnerDependencies(async () => { throw new Error('unused'); });
    const code = await runSupabaseStagingPreflight(['--confirm-staging-preflight'], baseEnv, {
      ...deps,
      open: async () => ({ inspect: async () => emptyPreflightState(deps), close: async () => { throw new Error('private details'); } }),
    }, () => undefined);
    assert.equal(code, 1);
  });

  it('runs the baseline only after valid guard and schema preflight, then verifies the marker', async () => {
    const deps = await loadStagingRunnerDependencies(async () => { throw new Error('unused'); });
    let current: StagingCatalogState = {
      ...state(deps),
      publicObjects: [], drizzleSchemaExists: false, drizzleRelations: [], migrationHistory: [],
      applicationTables: [], applicationColumns: {}, applicationIndexes: [], applicationConstraints: [],
      applicationRlsTables: [],
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
    assert.deepEqual(current.eventTriggers, [approvedAutoRlsTrigger]);
    assert.deepEqual(current.supabaseAutomaticRlsFunctions, [approvedAutoRlsFunction]);
  });

  it('fails verification if baseline execution changes the recognized automatic-RLS catalog state', async () => {
    const deps = await loadStagingRunnerDependencies(async () => { throw new Error('unused'); });
    let current: StagingCatalogState = {
      ...state(deps),
      publicObjects: [{ name: 'rls_auto_enable', kind: 'routine', extensionOwned: false }],
      drizzleSchemaExists: false, drizzleRelations: [], migrationHistory: [],
      applicationTables: [], applicationColumns: {}, applicationIndexes: [], applicationConstraints: [], applicationRlsTables: [],
    };
    const messages: string[] = [];
    const code = await runSupabaseStagingCommand('initialize', ['--confirm-staging-initialize'], baseEnv, {
      ...deps,
      open: async () => ({
        inspect: async () => current,
        applyBaseline: async () => { current = { ...state(deps), eventTriggers: [{ ...approvedAutoRlsTrigger, enabled: 'D' }] }; },
        applyForwardMigrations: async () => undefined,
        close: async () => undefined,
      }),
    }, (message) => messages.push(message));
    assert.equal(code, 1);
    assert.ok(messages.some((message) => message.includes('BASELINE_VERIFY_FAILED')));
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
    assert.deepEqual(current.eventTriggers, [approvedAutoRlsTrigger]);
    assert.deepEqual(current.supabaseAutomaticRlsFunctions, [approvedAutoRlsFunction]);
  });

  it('fails migration verification if the recognized function fingerprint or trigger changes', async () => {
    const deps = await loadStagingRunnerDependencies(async () => { throw new Error('unused'); });
    let current = state(deps);
    const messages: string[] = [];
    const code = await runSupabaseStagingCommand('migrate', ['--confirm-staging-migrate'], baseEnv, {
      ...deps,
      open: async () => ({
        inspect: async () => current,
        applyBaseline: async () => assert.fail('baseline must not run'),
        applyForwardMigrations: async () => {
          current = {
            ...state(deps, true, true),
            migrationHistory: [
              { hash: deps.baseline.hash, createdAt: deps.baseline.when },
              ...deps.forward.map((entry) => ({ hash: entry.hash, createdAt: entry.when })),
            ],
            supabaseAutomaticRlsFunctions: [{ ...approvedAutoRlsFunction, sourceMd5: '0'.repeat(32) }],
          };
        },
        close: async () => undefined,
      }),
    }, (message) => messages.push(message));
    assert.equal(code, 1);
    assert.ok(messages.some((message) => message.includes('FORWARD_VERIFY_FAILED')));
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
