import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import type { PoolClient } from 'pg';
import {
  assertStagingIdentity,
  assertStagingDataApiRoles,
  assertStagingDataApiPrivileges,
  assertStagingDefaultAclInventory,
  assertStagingInitializationState,
  assertStagingMigrationHistory,
  assertStagingRequiredSchemas,
  assertSupabaseAutomaticRlsConfiguration,
  assertSupabaseAutomaticRlsUnchanged,
  supabaseAutomaticRlsDiagnostics,
  normalizeStagingSqlType,
  resolveSupabaseStagingSettings,
  type StagingCatalogState,
  type StagingDatabaseSettings,
} from '../src/db/supabase-staging-guard.ts';
import {
  attachDataApiRoleAudit,
  loadStagingRunnerDependencies,
  runSupabaseStagingPreflight,
  runSupabaseStagingCommand,
  runSupabaseStagingDefaultPrivilegePreparation,
  runSupabaseStagingDefaultPrivilegeDiagnostic,
  beginVerifiedReadOnlyTransaction,
  openVerifiedReadOnlySession,
  StagingReadOnlyTransactionError,
  type StagingRunnerDependencies,
} from '../scripts/supabase-staging-runner.ts';

const stagingRef = 'abcdefghijklmnopqrst';
const productionRef = 'zyxwvutsrqponmlkjihg';
const approvedAutoRlsFunction = {
  schema: 'public', name: 'rls_auto_enable', argumentCount: 0, identityArguments: '', owner: 'postgres',
  language: 'plpgsql', returnType: 'event_trigger', securityDefiner: true, strict: false, volatility: 'v',
  configuration: ['search_path=pg_catalog'], sourceLength: 1055, sourceMd5: 'c44fb229ea8a6b0afd04a0a33261c16c', objectId: '18201',
};
const approvedAutoRlsTrigger = {
  name: 'ensure_rls', owner: 'postgres', enabled: 'O', event: 'ddl_command_end',
  tags: ['CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO'],
  triggerHandlerObjectId: '18201', handlerSchema: 'public', handlerName: 'rls_auto_enable', handlerArgumentCount: 0,
  handlerIdentityArguments: '', handlerOwner: 'postgres', handlerLanguage: 'plpgsql', handlerReturnType: 'event_trigger',
  handlerSecurityDefiner: true, handlerStrict: false, handlerVolatility: 'v', handlerConfiguration: ['search_path=pg_catalog'],
  handlerReturnsSet: false, handlerSourceLength: 1055, handlerSourceMd5: 'c44fb229ea8a6b0afd04a0a33261c16c', handlerObjectId: '18201',
};
const platformHandler = {
  handlerArgumentCount: 0, handlerIdentityArguments: '', handlerOwner: 'supabase_admin', handlerLanguage: 'plpgsql',
  handlerReturnType: 'event_trigger', handlerSecurityDefiner: false, handlerStrict: false, handlerVolatility: 'v',
  handlerConfiguration: ['search_path=""'], handlerReturnsSet: false,
};
const approvedPlatformTriggers = [
  { name: 'issue_graphql_placeholder', owner: 'supabase_admin', enabled: 'O', event: 'sql_drop', tags: ['DROP EXTENSION'], handlerSchema: 'extensions', handlerName: 'set_graphql_placeholder', ...platformHandler, handlerSourceLength: 1573, handlerSourceMd5: 'a2bc2d00b2cc2f5e8d2d6b8d73e2c360', handlerObjectId: '90001', triggerHandlerObjectId: '90001' },
  { name: 'issue_pg_cron_access', owner: 'supabase_admin', enabled: 'O', event: 'ddl_command_end', tags: ['CREATE EXTENSION'], handlerSchema: 'extensions', handlerName: 'grant_pg_cron_access', ...platformHandler, handlerSourceLength: 1194, handlerSourceMd5: '3a3917aad6ddd66182bf45b7490c3029', handlerObjectId: '90002', triggerHandlerObjectId: '90002' },
  { name: 'issue_pg_graphql_access', owner: 'supabase_admin', enabled: 'O', event: 'ddl_command_end', tags: ['CREATE EXTENSION'], handlerSchema: 'extensions', handlerName: 'grant_pg_graphql_access', ...platformHandler, handlerSourceLength: 1357, handlerSourceMd5: 'dd3f3e2bb94cff45ef24b9cecb6af1c8', handlerObjectId: '90003', triggerHandlerObjectId: '90003' },
  { name: 'issue_pg_net_access', owner: 'supabase_admin', enabled: 'O', event: 'ddl_command_end', tags: ['CREATE EXTENSION'], handlerSchema: 'extensions', handlerName: 'grant_pg_net_access', ...platformHandler, handlerSourceLength: 1999, handlerSourceMd5: '2ee4e6920eeba3068bcfa838105352e2', handlerObjectId: '90004', triggerHandlerObjectId: '90004' },
  { name: 'pgrst_ddl_watch', owner: 'supabase_admin', enabled: 'O', event: 'ddl_command_end', tags: null, handlerSchema: 'extensions', handlerName: 'pgrst_ddl_watch', ...platformHandler, handlerSourceLength: 729, handlerSourceMd5: '7f27b8118fea5c88b0164331292859e3', handlerObjectId: '90005', triggerHandlerObjectId: '90005' },
  { name: 'pgrst_drop_watch', owner: 'supabase_admin', enabled: 'O', event: 'sql_drop', tags: null, handlerSchema: 'extensions', handlerName: 'pgrst_drop_watch', ...platformHandler, handlerSourceLength: 412, handlerSourceMd5: 'bc09cc3003d66f91844af4cb05e203b7', handlerObjectId: '90006', triggerHandlerObjectId: '90006' },
];
function supabaseAdminDefaults() {
  return ['anon', 'authenticated'].flatMap((grantee) => [
    ...['DELETE', 'INSERT', 'MAINTAIN', 'REFERENCES', 'SELECT', 'TRIGGER', 'TRUNCATE', 'UPDATE']
      .map((privilege) => ({ owner: 'supabase_admin', schema: 'public', objectType: 'table' as const, grantee, privilege })),
    ...['SELECT', 'UPDATE', 'USAGE']
      .map((privilege) => ({ owner: 'supabase_admin', schema: 'public', objectType: 'sequence' as const, grantee, privilege })),
  ]);
}
function applicationOwnerDefaults(owner = 'postgres') {
  return ['anon', 'authenticated'].flatMap((grantee) => [
    ...['DELETE', 'INSERT', 'MAINTAIN', 'REFERENCES', 'SELECT', 'TRIGGER', 'TRUNCATE', 'UPDATE']
      .map((privilege) => ({ owner, schema: 'public', objectType: 'table' as const, grantee, privilege })),
    ...['SELECT', 'UPDATE', 'USAGE']
      .map((privilege) => ({ owner, schema: 'public', objectType: 'sequence' as const, grantee, privilege })),
  ]);
}
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
  SUPABASE_STAGING_DEFAULT_PRIVILEGE_CONFIRMATION: 'I_CONFIRM_STAGING_DEFAULT_PRIVILEGE_HARDENING',
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
    eventTriggers: [approvedAutoRlsTrigger, ...approvedPlatformTriggers],
    drizzleSchemaExists: true,
    drizzleRelations: ['__drizzle_migrations', '__drizzle_migrations_id_seq'],
    migrationHistory: [{ hash: deps.baseline.hash, createdAt: deps.baseline.when }],
    supabaseMigrationSchemaExists: false,
    supabaseMigrationRecords: 0,
    dataApiRoles: ['anon', 'authenticated'],
    dataApiRoleAudit: ['anon', 'authenticated'].map((role) => ({ role, superuser: false, bypassRls: false, inheritsRuntimeOwner: false, memberOfRuntimeOwner: false, publicUsage: true, publicCreate: false, authUsage: false, authCreate: false, storageUsage: false, storageCreate: false, drizzleUsage: false, drizzleCreate: false, applicationTablePrivileges: [], applicationColumnPrivileges: [], applicationSequencePrivileges: [], directApplicationTableAcl: [], directApplicationColumnAcl: [], directApplicationSequenceAcl: [], globalDefaultTablePrivileges: [], globalDefaultSequencePrivileges: [], schemaDefaultTablePrivileges: [], schemaDefaultSequencePrivileges: [] })),
    defaultAclInventory: supabaseAdminDefaults(),
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
    dataApiRoleAudit: ['anon', 'authenticated'].map((role) => ({ role, superuser: false, bypassRls: false, inheritsRuntimeOwner: false, memberOfRuntimeOwner: false, publicUsage: true, publicCreate: false, authUsage: false, authCreate: false, storageUsage: false, storageCreate: false, drizzleUsage: false, drizzleCreate: false, applicationTablePrivileges: [], applicationColumnPrivileges: [], applicationSequencePrivileges: [], directApplicationTableAcl: [], directApplicationColumnAcl: [], directApplicationSequenceAcl: [], globalDefaultTablePrivileges: [], globalDefaultSequencePrivileges: [], schemaDefaultTablePrivileges: [], schemaDefaultSequencePrivileges: [] })),
  };
}

function preparationHarness(options: { afterAcl?: ReturnType<typeof applicationOwnerDefaults>; applicationTables?: string[]; publicObjects?: Array<{ name: string; kind: string; extensionOwned: boolean }>; existingHistory?: boolean; readOnly?: boolean } = {}) {
  const calls: string[] = [];
  let aclReads = 0;
  let closeCount = 0;
  const client = {
    async query<Row = unknown>(sql: string): Promise<{ rows: Row[] }> {
      calls.push(sql.trim());
      if (sql === 'BEGIN' || sql === 'BEGIN READ ONLY' || sql === 'COMMIT' || sql === 'ROLLBACK' || sql.startsWith('ALTER DEFAULT PRIVILEGES')) return { rows: [] as Row[] };
      if (sql.includes('current_database() AS database')) return { rows: [{
        database: 'postgres', loginUser: 'postgres', user: 'postgres', currentSchema: 'public', searchPath: 'public',
        serverPort: 5432, transactionReadOnly: options.readOnly ?? false,
      }] as Row[] };
      if (sql.includes('to_regclass(\'drizzle.__drizzle_migrations\')')) return { rows: [{
        public: true, auth: true, storage: true, drizzle: options.existingHistory ?? false, supabaseMigrations: false,
        drizzleHistory: options.existingHistory ?? false, supabaseHistory: false, applicationTables: options.applicationTables ?? [],
      }] as Row[] };
      if (sql.includes('pg_opfamily')) return { rows: (options.publicObjects ?? [{ name: 'rls_auto_enable', kind: 'routine', extensionOwned: false }]) as Row[] };
      if (sql.includes('FROM pg_proc p JOIN pg_namespace')) return { rows: [approvedAutoRlsFunction] as Row[] };
      if (sql.includes('FROM pg_event_trigger e JOIN pg_proc')) return { rows: [approvedAutoRlsTrigger, ...approvedPlatformTriggers] as Row[] };
      if (sql.includes("FROM pg_roles r WHERE r.rolname IN ('anon','authenticated')")) return { rows: ['anon', 'authenticated'].map((role) => ({
        role, superuser: false, bypassRls: false, inheritsOwner: false, memberOfOwner: false,
        publicCreate: false, authCreate: false, storageCreate: false,
      })) as Row[] };
      if (sql.includes('FROM pg_default_acl d CROSS JOIN LATERAL aclexplode(d.defaclacl)')) {
        aclReads += 1;
        const rows = aclReads === 1
          ? [...applicationOwnerDefaults(), ...supabaseAdminDefaults()]
          : [...(options.afterAcl ?? []), ...supabaseAdminDefaults()];
        return { rows: rows as Row[] };
      }
      throw new Error('Unexpected SQL in injected preparation test.');
    },
    release() { calls.push('RELEASE'); },
  } as unknown as PoolClient;
  const env = {
    ...noProductionEnv,
    SUPABASE_STAGING_DEFAULT_PRIVILEGE_CONFIRMATION: 'I_CONFIRM_STAGING_DEFAULT_PRIVILEGE_HARDENING',
  };
  const depsForRun = {
    open: async (settings: StagingDatabaseSettings) => {
      assert.equal(settings.runtimeUser, 'postgres');
      assert.equal(settings.effectiveUser, 'postgres');
      assert.equal(settings.schema, 'public');
      assert.equal(settings.fingerprint, `db.${stagingRef}.supabase.co:5432/postgres/postgres`);
      return { client, close: async () => { closeCount += 1; } };
    },
    applicationTableNames: ['products', 'orders'],
  };
  return { calls, env, depsForRun, get aclReads() { return aclReads; }, get closeCount() { return closeCount; } };
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
      supabaseAutomaticRlsFunctions: [approvedAutoRlsFunction], eventTriggers: [approvedAutoRlsTrigger, ...approvedPlatformTriggers],
      publicObjects: [{ name: 'rls_auto_enable', kind: 'routine', extensionOwned: false }], drizzleObjects: [], drizzleSchemaExists: false, drizzleRelations: [], migrationHistory: [],
      supabaseMigrationSchemaExists: false, supabaseMigrationRecords: 0, dataApiRoles: ['anon', 'authenticated'],
      dataApiRoleAudit: ['anon', 'authenticated'].map((role) => ({ role, superuser: false, bypassRls: false, inheritsRuntimeOwner: false, memberOfRuntimeOwner: false, publicUsage: true, publicCreate: false, authUsage: false, authCreate: false, storageUsage: false, storageCreate: false, drizzleUsage: false, drizzleCreate: false, applicationTablePrivileges: [], applicationColumnPrivileges: [], applicationSequencePrivileges: [], directApplicationTableAcl: [], directApplicationColumnAcl: [], directApplicationSequenceAcl: [], globalDefaultTablePrivileges: [], globalDefaultSequencePrivileges: [], schemaDefaultTablePrivileges: [], schemaDefaultSequencePrivileges: [] })),
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
      supabaseAutomaticRlsFunctions: [approvedAutoRlsFunction], eventTriggers: [approvedAutoRlsTrigger, ...approvedPlatformTriggers],
      publicObjects: [{ name: 'extension_table', kind: 'relation', extensionOwned: true }],
      drizzleObjects: [],
      drizzleSchemaExists: false, drizzleRelations: [], migrationHistory: [],
      supabaseMigrationSchemaExists: false, supabaseMigrationRecords: 0, dataApiRoles: ['anon', 'authenticated'],
      dataApiRoleAudit: ['anon', 'authenticated'].map((role) => ({ role, superuser: false, bypassRls: false, inheritsRuntimeOwner: false, memberOfRuntimeOwner: false, publicUsage: true, publicCreate: false, authUsage: false, authCreate: false, storageUsage: false, storageCreate: false, drizzleUsage: false, drizzleCreate: false, applicationTablePrivileges: [], applicationColumnPrivileges: [], applicationSequencePrivileges: [], directApplicationTableAcl: [], directApplicationColumnAcl: [], directApplicationSequenceAcl: [], globalDefaultTablePrivileges: [], globalDefaultSequencePrivileges: [], schemaDefaultTablePrivileges: [], schemaDefaultSequencePrivileges: [] })),
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
      supabaseAutomaticRlsFunctions: [approvedAutoRlsFunction], eventTriggers: [approvedAutoRlsTrigger, ...approvedPlatformTriggers],
      drizzleSchemaExists: false, drizzleRelations: [], migrationHistory: [],
      supabaseMigrationSchemaExists: false, supabaseMigrationRecords: 0, dataApiRoles: ['anon', 'authenticated'],
      dataApiRoleAudit: ['anon', 'authenticated'].map((role) => ({ role, superuser: false, bypassRls: false, inheritsRuntimeOwner: false, memberOfRuntimeOwner: false, publicUsage: true, publicCreate: false, authUsage: false, authCreate: false, storageUsage: false, storageCreate: false, drizzleUsage: false, drizzleCreate: false, applicationTablePrivileges: [], applicationColumnPrivileges: [], applicationSequencePrivileges: [], directApplicationTableAcl: [], directApplicationColumnAcl: [], directApplicationSequenceAcl: [], globalDefaultTablePrivileges: [], globalDefaultSequencePrivileges: [], schemaDefaultTablePrivileges: [], schemaDefaultSequencePrivileges: [] })),
      applicationTables: [], applicationColumns: {}, applicationIndexes: [], applicationConstraints: [], applicationColumnDefaults: {}, applicationRlsTables: [], applicationPolicies: [],
    };
    assert.doesNotThrow(() => assertStagingInitializationState(accepted));
    assert.doesNotThrow(() => assertSupabaseAutomaticRlsConfiguration(accepted));
    assert.doesNotThrow(() => assertSupabaseAutomaticRlsUnchanged(accepted, structuredClone(accepted)));
    assert.ok(Object.values(supabaseAutomaticRlsDiagnostics(accepted)).every(Boolean));

    // pg returns catalog text[] values as JavaScript arrays; order does not matter.
    const shuffledTags = { ...accepted, eventTriggers: accepted.eventTriggers.map((trigger) => trigger.name === 'ensure_rls'
      ? { ...trigger, tags: ['SELECT INTO', 'CREATE TABLE', 'CREATE TABLE AS'] } : trigger) };
    assert.doesNotThrow(() => assertSupabaseAutomaticRlsConfiguration(shuffledTags));
    assert.ok(Object.values(supabaseAutomaticRlsDiagnostics(shuffledTags)).every(Boolean));
    assert.throws(() => assertSupabaseAutomaticRlsConfiguration({ ...accepted, eventTriggers: accepted.eventTriggers.map((trigger) => trigger.name === 'pgrst_ddl_watch' ? { ...trigger, tags: [] } : trigger) }));
    assert.doesNotThrow(() => assertSupabaseAutomaticRlsConfiguration({ ...accepted, eventTriggers: accepted.eventTriggers.map((trigger) => trigger.name === 'pgrst_ddl_watch' ? { ...trigger, tags: null } : trigger) }));

    // Each platform trigger is an exact per-project snapshot, including handler metadata and OID linkage.
    for (const expected of approvedPlatformTriggers) {
      const mutations = [
        { owner: 'unexpected_owner' }, { enabled: 'D' }, { event: expected.event === 'sql_drop' ? 'ddl_command_end' : 'sql_drop' },
        { tags: [] }, { handlerName: 'unexpected_handler' }, { handlerSchema: 'public' },
        { handlerArgumentCount: 1 }, { handlerIdentityArguments: 'value text' }, { handlerReturnType: 'trigger' },
        { handlerOwner: 'unexpected_owner' }, { handlerLanguage: 'sql' },
        { handlerSecurityDefiner: true }, { handlerStrict: true }, { handlerVolatility: 's' },
        { handlerConfiguration: ['search_path=public'] }, { handlerReturnsSet: true },
        { handlerSourceLength: expected.handlerSourceLength + 1 },
        { handlerSourceMd5: '0'.repeat(32) }, { triggerHandlerObjectId: 'different-oid' },
      ];
      for (const mutation of mutations) {
        const mutated = { ...accepted, eventTriggers: accepted.eventTriggers.map((trigger) => trigger.name === expected.name ? { ...trigger, ...mutation } : trigger) };
        assert.throws(() => assertSupabaseAutomaticRlsConfiguration(mutated), `${expected.name} should reject ${Object.keys(mutation)[0]}`);
      }
      assert.throws(() => assertSupabaseAutomaticRlsConfiguration({ ...accepted, eventTriggers: accepted.eventTriggers.filter((trigger) => trigger.name !== expected.name) }), `${expected.name} missing`);
      assert.throws(() => assertSupabaseAutomaticRlsConfiguration({ ...accepted, eventTriggers: [...accepted.eventTriggers, expected] }), `${expected.name} duplicated`);
    }
    assert.throws(() => assertSupabaseAutomaticRlsConfiguration({ ...accepted, eventTriggers: [...accepted.eventTriggers, { ...approvedAutoRlsTrigger, name: 'unexpected_eighth_trigger' }] }));

    // Diagnose the intended trigger even when an extra event trigger makes the target unsafe.
    const extraTriggerState = { ...accepted, eventTriggers: [...accepted.eventTriggers, { ...approvedAutoRlsTrigger, name: 'unrelated_trigger', handlerName: 'other_handler' }] };
    const extraTriggerChecks = supabaseAutomaticRlsDiagnostics(extraTriggerState);
    assert.equal(extraTriggerChecks.trigger_name_matches, true);
    assert.equal(extraTriggerChecks.trigger_handler_matches, true);
    assert.equal(extraTriggerChecks.only_expected_event_trigger_present, false);
    assert.throws(() => assertSupabaseAutomaticRlsConfiguration(extraTriggerState));

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
      { ...accepted, eventTriggers: [...accepted.eventTriggers, { ...approvedAutoRlsTrigger, name: 'second_trigger' }] },
      { ...accepted, publicObjects: [...accepted.publicObjects, { name: 'custom_function', kind: 'routine', extensionOwned: false }] },
      { ...accepted, publicObjects: [...accepted.publicObjects, { name: 'unexpected_table', kind: 'relation', extensionOwned: false }] },
    ];
    for (const rejected of badStates.slice(0, -2)) {
      assert.throws(() => assertStagingInitializationState(rejected));
      assert.ok(Object.values(supabaseAutomaticRlsDiagnostics(rejected)).some((value) => !value));
    }
    for (const rejected of badStates.slice(-2)) assert.throws(() => assertStagingInitializationState(rejected));
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
      dataApiRoleAudit: ['anon', 'authenticated'].map((role) => ({ role, superuser: false, bypassRls: false, inheritsRuntimeOwner: false, memberOfRuntimeOwner: false, publicUsage: true, publicCreate: false, authUsage: false, authCreate: false, storageUsage: false, storageCreate: false, drizzleUsage: false, drizzleCreate: false, applicationTablePrivileges: [], applicationColumnPrivileges: [], applicationSequencePrivileges: [], directApplicationTableAcl: [], directApplicationColumnAcl: [], directApplicationSequenceAcl: [], globalDefaultTablePrivileges: [], globalDefaultSequencePrivileges: [], schemaDefaultTablePrivileges: [], schemaDefaultSequencePrivileges: [] })),
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

  it('requires both Supabase Data API roles and preserves the returned catalog audit rows', async () => {
    assert.doesNotThrow(() => assertStagingDataApiRoles(['anon', 'authenticated']));
    assert.throws(() => assertStagingDataApiRoles(['anon']));
    const safeRoles = ['anon', 'authenticated'].map((role) => ({
      role, superuser: false, bypassRls: false, inheritsRuntimeOwner: false, memberOfRuntimeOwner: false, publicUsage: true, publicCreate: false,
      authUsage: false, authCreate: false, storageUsage: false, storageCreate: false,
      drizzleUsage: false, drizzleCreate: false, applicationTablePrivileges: [], applicationColumnPrivileges: [], applicationSequencePrivileges: [], directApplicationTableAcl: [], directApplicationColumnAcl: [], directApplicationSequenceAcl: [], globalDefaultTablePrivileges: [], globalDefaultSequencePrivileges: [], schemaDefaultTablePrivileges: [], schemaDefaultSequencePrivileges: [],
    }));
    const deps = await loadStagingRunnerDependencies(async () => { throw new Error('unused'); });
    const { dataApiRoleAudit: _priorAudit, ...snapshotWithoutAudit } = emptyPreflightState(deps);
    const mappedSnapshot = attachDataApiRoleAudit(snapshotWithoutAudit, safeRoles);
    assert.deepEqual(mappedSnapshot.dataApiRoleAudit, safeRoles);
    assert.doesNotThrow(() => assertStagingDataApiPrivileges(mappedSnapshot));
    assert.doesNotThrow(() => assertStagingDataApiPrivileges({ dataApiRoleAudit: safeRoles }));
    // Ordinary schema USAGE is informational; access to application objects is assessed separately.
    assert.doesNotThrow(() => assertStagingDataApiPrivileges({ dataApiRoleAudit: safeRoles.map((role) => ({
      ...role, publicUsage: true, authUsage: true, storageUsage: true,
    })) }));
    assert.throws(() => assertStagingDataApiPrivileges({ dataApiRoleAudit: safeRoles.map((role) => ({ ...role, memberOfRuntimeOwner: true })) }));
    assert.throws(() => assertStagingDataApiPrivileges({ dataApiRoleAudit: [safeRoles[0]!, safeRoles[0]!] }));
    assert.throws(() => assertStagingDataApiPrivileges({ dataApiRoleAudit: [safeRoles[0]!] }));
    assert.throws(() => assertStagingDataApiPrivileges({ dataApiRoleAudit: [safeRoles[0]!, { ...safeRoles[1]!, role: 'service_role' }] }));
    assert.throws(() => assertStagingDataApiPrivileges({ dataApiRoleAudit: [safeRoles[0]!, { ...safeRoles[1]!, publicCreate: undefined as unknown as boolean }] }));
    assert.throws(() => assertStagingDataApiPrivileges({ dataApiRoleAudit: [safeRoles[0]!, { ...safeRoles[1]!, applicationTablePrivileges: undefined as unknown as string[] }] }));
    assert.doesNotThrow(() => assertStagingDataApiPrivileges({ dataApiRoleAudit: safeRoles.map((role) => ({
      ...role, applicationTablePrivileges: [], applicationColumnPrivileges: [], applicationSequencePrivileges: [],
    })) }));
    for (const changed of [
      { ...safeRoles[0]!, inheritsRuntimeOwner: true },
      { ...safeRoles[0]!, memberOfRuntimeOwner: true },
      { ...safeRoles[0]!, applicationColumnPrivileges: ['orders:SELECT'] },
      { ...safeRoles[0]!, globalDefaultTablePrivileges: ['PUBLIC:SELECT'] },
      { ...safeRoles[0]!, globalDefaultSequencePrivileges: ['anon:USAGE'] },
      { ...safeRoles[0]!, schemaDefaultTablePrivileges: ['inherited_role:SELECT'] },
      { ...safeRoles[0]!, schemaDefaultSequencePrivileges: ['PUBLIC:USAGE'] },
      { ...safeRoles[0]!, publicCreate: true },
      { ...safeRoles[0]!, drizzleCreate: true },
      { ...safeRoles[0]!, superuser: true },
      { ...safeRoles[0]!, bypassRls: true },
      { ...safeRoles[0]!, applicationTablePrivileges: ['orders:SELECT'] },
      { ...safeRoles[0]!, applicationSequencePrivileges: ['orders_id_seq:USAGE'] },
      { ...safeRoles[0]!, directApplicationTableAcl: ['products:PUBLIC:SELECT'] },
      { ...safeRoles[0]!, directApplicationColumnAcl: ['orders.id:authenticated:SELECT'] },
      { ...safeRoles[0]!, directApplicationSequenceAcl: ['orders_id_seq:PUBLIC:USAGE'] },
      { ...safeRoles[0]!, authCreate: true },
      { ...safeRoles[0]!, storageCreate: true },
      { ...safeRoles[0]!, schemaDefaultTablePrivileges: ['authenticated:SELECT'] },
      { ...safeRoles[0]!, schemaDefaultSequencePrivileges: ['anon:USAGE'] },
    ]) assert.throws(() => assertStagingDataApiPrivileges({ dataApiRoleAudit: [changed, safeRoles[1]] }));
    assert.throws(() => assertStagingRequiredSchemas({ public: true, auth: false, storage: true, drizzle: false, supabaseMigrations: false }));
    assert.throws(() => resolveSupabaseStagingSettings('migrate', ['--confirm-staging-migrate'], {
      ...baseEnv,
      SUPABASE_STAGING_RUNTIME_DATABASE_USER: 'different_runtime_role',
    }));
  });

  it('requires a confirmed read-only transaction before catalog or identity reads', async () => {
    const statements: string[] = [];
    const client = {
      query: async (sql: string) => { statements.push(sql); return { rows: [{ transaction_read_only: 'on' }] }; },
      release: () => undefined,
    };
    await beginVerifiedReadOnlyTransaction(client);
    await client.query('SELECT current_database()');
    assert.deepEqual(statements, ['BEGIN READ ONLY', "SELECT current_setting('transaction_read_only') AS transaction_read_only", 'SELECT current_database()']);

    for (const rows of [[], [{ transaction_read_only: false }]]) {
      const rejectedStatements: string[] = [];
      await assert.rejects(beginVerifiedReadOnlyTransaction({
        query: async (sql: string) => { rejectedStatements.push(sql); return { rows }; },
        release: () => undefined,
      }), StagingReadOnlyTransactionError);
      assert.deepEqual(rejectedStatements, ['BEGIN READ ONLY', "SELECT current_setting('transaction_read_only') AS transaction_read_only"]);
    }
  });

  it('keeps catalog queries on the checked-out read-only client and rolls back/releases on every outcome', async () => {
    for (const scenario of ['success', 'identity-mismatch', 'query-failure'] as const) {
      const calls: string[] = [];
      let released = false;
      let ended = false;
      const client = {
        query: async (sql: string) => {
          calls.push(sql);
          if (sql.startsWith('SELECT current_setting')) return { rows: [{ transaction_read_only: 'on' }] };
          if (scenario === 'query-failure' && sql === 'SELECT identity') throw new Error('private error');
          return { rows: [] };
        },
        release: () => { released = true; },
      };
      const session = await openVerifiedReadOnlySession({
        connect: async () => client,
        end: async () => { ended = true; },
      });
      try {
        if (scenario === 'query-failure') await assert.rejects(session.client.query('SELECT identity'));
        else if (scenario === 'identity-mismatch') {
          await assert.rejects(async () => {
            await session.client.query('SELECT identity');
            throw new Error('identity mismatch');
          });
        } else await session.client.query('SELECT identity');
      } finally {
        await session.close();
      }
      assert.deepEqual(calls, ['BEGIN READ ONLY', "SELECT current_setting('transaction_read_only') AS transaction_read_only", 'SELECT identity', 'ROLLBACK']);
      assert.equal(released, true);
      assert.equal(ended, true);
    }

    const failedSetupCalls: string[] = [];
    let failedSetupReleased = false;
    let failedSetupPoolClosed = false;
    await assert.rejects(openVerifiedReadOnlySession({
      connect: async () => ({
        query: async (sql: string) => {
          failedSetupCalls.push(sql);
          return { rows: sql === 'BEGIN READ ONLY' ? [] : [{ transaction_read_only: false }] };
        },
        release: () => { failedSetupReleased = true; },
      }),
      end: async () => { failedSetupPoolClosed = true; },
    }), StagingReadOnlyTransactionError);
    assert.deepEqual(failedSetupCalls, ['BEGIN READ ONLY', "SELECT current_setting('transaction_read_only') AS transaction_read_only", 'ROLLBACK']);
    assert.equal(failedSetupReleased, true);
    assert.equal(failedSetupPoolClosed, true);
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

  it('stops before catalog inspection when the read-only transaction cannot be verified', async () => {
    const deps = await loadStagingRunnerDependencies(async () => { throw new Error('unused'); });
    const lines: string[] = [];
    const code = await runSupabaseStagingPreflight(['--confirm-staging-preflight'], baseEnv, {
      ...deps,
      open: async () => {
        throw new StagingReadOnlyTransactionError();
      },
    }, (line) => lines.push(line));
    assert.equal(code, 1);
    assert.ok(lines.some((line) => line.includes('READ_ONLY_TRANSACTION_REQUIRED')));
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
    assert.deepEqual(current.eventTriggers, [approvedAutoRlsTrigger, ...approvedPlatformTriggers]);
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
    assert.deepEqual(current.eventTriggers, [approvedAutoRlsTrigger, ...approvedPlatformTriggers]);
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

  it('preparation removes only application-owner public anon/auth defaults in one transaction and verifies before commit', async () => {
    const harness = preparationHarness();
    const messages: string[] = [];
    const code = await runSupabaseStagingDefaultPrivilegePreparation(
      ['--confirm-staging-default-privilege-hardening'], harness.env, harness.depsForRun, (message) => messages.push(message),
    );
    assert.equal(code, 0);
    assert.equal(harness.aclReads, 2);
    assert.equal(harness.closeCount, 1);
    assert.equal(harness.calls[0], 'BEGIN');
    const commitIndex = harness.calls.indexOf('COMMIT');
    const aclSql = harness.calls.filter((call) => call.includes('FROM pg_default_acl d CROSS JOIN LATERAL aclexplode(d.defaclacl)'));
    assert.equal(aclSql.length, 2);
    assert.ok(harness.calls.indexOf(aclSql[1]!) < commitIndex);
    const alters = harness.calls.filter((call) => call.startsWith('ALTER DEFAULT PRIVILEGES'));
    assert.equal(alters.length, 4);
    assert.ok(alters.every((sql) => sql.includes('FOR ROLE CURRENT_USER IN SCHEMA public') && !sql.includes('supabase_admin')));
    assert.deepEqual(alters, [
      'ALTER DEFAULT PRIVILEGES FOR ROLE CURRENT_USER IN SCHEMA public REVOKE ALL ON TABLES FROM anon',
      'ALTER DEFAULT PRIVILEGES FOR ROLE CURRENT_USER IN SCHEMA public REVOKE ALL ON TABLES FROM authenticated',
      'ALTER DEFAULT PRIVILEGES FOR ROLE CURRENT_USER IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon',
      'ALTER DEFAULT PRIVILEGES FOR ROLE CURRENT_USER IN SCHEMA public REVOKE ALL ON SEQUENCES FROM authenticated',
    ]);
    assert.ok(harness.calls.includes('ROLLBACK') === false);
    assert.ok(messages.some((message) => message.includes('relevant_grants_before=22') && message.includes('relevant_grants_after=0')));
    assert.ok(messages.every((message) => !/secret-password|postgresql:\/\//i.test(message)));
  });

  it('requires both explicit preparation and no-production confirmations before connecting', async () => {
    for (const invalid of [
      { ...noProductionEnv, SUPABASE_STAGING_DEFAULT_PRIVILEGE_CONFIRMATION: undefined },
      { ...noProductionEnv, SUPABASE_NO_PRODUCTION_PROJECT_CONFIRMATION: undefined },
      { ...noProductionEnv, SUPABASE_STAGING_TARGET_FINGERPRINT: 'wrong' },
      { ...noProductionEnv, SUPABASE_PRODUCTION_PROJECT_REF: productionRef },
      { ...noProductionEnv, DATABASE_URL: noProductionEnv.SUPABASE_STAGING_DATABASE_URL },
      { ...noProductionEnv, SUPABASE_STAGING_DATABASE_EFFECTIVE_USER: 'supabase_admin', SUPABASE_STAGING_RUNTIME_DATABASE_USER: 'supabase_admin' },
    ]) {
      let opened = false;
      const code = await runSupabaseStagingDefaultPrivilegePreparation(
        ['--confirm-staging-default-privilege-hardening'], invalid,
        { ...preparationHarness().depsForRun, open: async () => { opened = true; throw new Error('must not connect'); } },
        () => undefined,
      );
      assert.equal(code, 2);
      assert.equal(opened, false);
    }
  });

  it('fails closed before privilege changes when application tables, history, or unexpected objects exist', async () => {
    for (const options of [
      { applicationTables: ['products'] },
      { existingHistory: true },
      { publicObjects: [{ name: 'unexpected', kind: 'relation', extensionOwned: false }] },
    ]) {
      const harness = preparationHarness(options);
      const code = await runSupabaseStagingDefaultPrivilegePreparation(
        ['--confirm-staging-default-privilege-hardening'], harness.env, harness.depsForRun, () => undefined,
      );
      assert.equal(code, 1);
      assert.equal(harness.calls.some((call) => call.startsWith('ALTER DEFAULT PRIVILEGES')), false);
      assert.ok(harness.calls.includes('ROLLBACK'));
      assert.equal(harness.closeCount, 1);
    }
  });

  it('allows only known platform defaults and the narrowly scoped application-owner defaults during preparation', () => {
    assert.doesNotThrow(() => assertStagingDefaultAclInventory(supabaseAdminDefaults(), 'postgres'));
    assert.doesNotThrow(() => assertStagingDefaultAclInventory([...supabaseAdminDefaults(), ...applicationOwnerDefaults()], 'postgres', true));
    assert.throws(() => assertStagingDefaultAclInventory([...supabaseAdminDefaults(), ...applicationOwnerDefaults()], 'postgres'));
    assert.throws(() => assertStagingDefaultAclInventory([...supabaseAdminDefaults(), ...applicationOwnerDefaults('other_owner')], 'postgres', true));
    assert.throws(() => assertStagingDefaultAclInventory([...supabaseAdminDefaults(), { ...applicationOwnerDefaults()[0]!, schema: '<global>' }], 'postgres', true));
    assert.throws(() => assertStagingDefaultAclInventory([...supabaseAdminDefaults(), { ...applicationOwnerDefaults()[0]!, objectType: 'unknown' as 'table' }], 'postgres', true));
    assert.throws(() => assertStagingDefaultAclInventory([...supabaseAdminDefaults(), applicationOwnerDefaults()[0]!, applicationOwnerDefaults()[0]!], 'postgres', true));
  });

  it('rolls back when postconditions retain an application-owner default and preserves platform defaults', async () => {
    const harness = preparationHarness({ afterAcl: applicationOwnerDefaults().slice(0, 1) });
    const messages: string[] = [];
    const code = await runSupabaseStagingDefaultPrivilegePreparation(
      ['--confirm-staging-default-privilege-hardening'], harness.env, harness.depsForRun, (message) => messages.push(message),
    );
    assert.equal(code, 1);
    assert.ok(harness.calls.includes('ROLLBACK'));
    assert.equal(harness.calls.includes('COMMIT'), false);
    assert.equal(harness.closeCount, 1);
    assert.ok(messages.every((message) => !/secret-password|postgresql:\/\//i.test(message)));
  });

  it('returns failure on connection cleanup errors without exposing raw details', async () => {
    const harness = preparationHarness();
    const messages: string[] = [];
    const code = await runSupabaseStagingDefaultPrivilegePreparation(
      ['--confirm-staging-default-privilege-hardening'], harness.env,
      { ...harness.depsForRun, open: async (settings) => {
        const opened = await harness.depsForRun.open(settings);
        return { client: opened.client, close: async () => { throw new Error('postgresql://secret-password'); } };
      } },
      (message) => messages.push(message),
    );
    assert.equal(code, 1);
    assert.ok(messages.some((message) => message.includes('CONNECTION_CLOSE_FAILED')));
    assert.ok(messages.every((message) => !/secret-password|postgresql:\/\//i.test(message)));
  });

  it('keeps the read-only preflight ineligible while application-owner defaults remain unsafe', async () => {
    const deps = await loadStagingRunnerDependencies(async () => { throw new Error('unused'); });
    const current = { ...emptyPreflightState(deps), defaultAclInventory: [...applicationOwnerDefaults(), ...supabaseAdminDefaults()] };
    const code = await runSupabaseStagingPreflight(['--confirm-staging-preflight'], noProductionEnv, {
      ...deps, open: async () => ({ inspect: async () => current, close: async () => undefined }),
    }, () => undefined);
    assert.equal(code, 1);
  });

  it('diagnoses each preparation checkpoint in a read-only transaction without permission-changing SQL', async () => {
    const harness = preparationHarness({ readOnly: true });
    const lines: string[] = [];
    const code = await runSupabaseStagingDefaultPrivilegeDiagnostic(
      ['--confirm-staging-default-privilege-diagnostic'],
      { ...harness.env, SUPABASE_STAGING_DEFAULT_PRIVILEGE_DIAGNOSTIC_CONFIRMATION: 'I_CONFIRM_READ_ONLY_STAGING_DEFAULT_PRIVILEGE_DIAGNOSTIC' },
      harness.depsForRun,
      (line) => lines.push(line),
    );
    assert.equal(code, 0);
    assert.ok(lines.some((line) => line.includes('PASS schema-state validation')));
    assert.ok(lines.some((line) => line.includes('PASS migration-history eligibility')));
    assert.ok(lines.some((line) => line.includes('PASS public-object inventory validation')));
    assert.ok(lines.some((line) => line.includes('PASS API-role validation')));
    assert.ok(lines.some((line) => line.includes('PASS default-ACL inventory validation')));
    assert.ok(harness.calls.includes('BEGIN READ ONLY'));
    assert.ok(harness.calls.includes('ROLLBACK'));
    assert.equal(harness.calls.some((call) => /^(ALTER|CREATE|DROP|GRANT|REVOKE)\b/i.test(call)), false);
  });

  it('reports an individual public-object checkpoint failure while continuing read-only inspection', async () => {
    const harness = preparationHarness({ readOnly: true, publicObjects: [{ name: 'unexpected', kind: 'relation', extensionOwned: false }] });
    const lines: string[] = [];
    const code = await runSupabaseStagingDefaultPrivilegeDiagnostic(
      ['--confirm-staging-default-privilege-diagnostic'],
      { ...harness.env, SUPABASE_STAGING_DEFAULT_PRIVILEGE_DIAGNOSTIC_CONFIRMATION: 'I_CONFIRM_READ_ONLY_STAGING_DEFAULT_PRIVILEGE_DIAGNOSTIC' },
      harness.depsForRun, (line) => lines.push(line),
    );
    assert.equal(code, 1);
    assert.ok(lines.some((line) => line.includes('FAIL public-object inventory validation')));
    assert.ok(lines.some((line) => line.includes('PASS API-role validation')));
    assert.equal(harness.calls.some((call) => /^(ALTER|CREATE|DROP|GRANT|REVOKE)\b/i.test(call)), false);
  });

  it('fails the diagnostic before catalog checkpoints when read-only status is false', async () => {
    const harness = preparationHarness({ readOnly: false });
    const lines: string[] = [];
    const code = await runSupabaseStagingDefaultPrivilegeDiagnostic(
      ['--confirm-staging-default-privilege-diagnostic'],
      { ...harness.env, SUPABASE_STAGING_DEFAULT_PRIVILEGE_DIAGNOSTIC_CONFIRMATION: 'I_CONFIRM_READ_ONLY_STAGING_DEFAULT_PRIVILEGE_DIAGNOSTIC' },
      harness.depsForRun,
      (line) => lines.push(line),
    );
    assert.equal(code, 1);
    assert.ok(lines.some((line) => line.includes('READ_ONLY_TRANSACTION_REQUIRED')));
    assert.equal(harness.calls.some((call) => call.includes('pg_default_acl')), false);
  });
});
