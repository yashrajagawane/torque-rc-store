import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PoolClient } from 'pg';
import { getTableConfig } from 'drizzle-orm/pg-core';
import * as schema from '../src/db/schema.ts';
import {
  assertStagingBaselineState,
  assertStagingDataApiRoles,
  assertStagingDataApiPrivileges,
  assertStagingDefaultAclInventory,
  assertStagingIdentity,
  assertStagingRequiredSchemas,
  assertStagingInitializationState,
  assertStagingMigrationHistory,
  assertSupabaseAutomaticRlsConfiguration,
  assertSupabaseAutomaticRlsUnchanged,
  isApprovedSupabaseAutomaticRlsRoutine,
  supabaseAutomaticRlsDiagnostics,
  normalizeStagingSqlType,
  resolveSupabaseStagingSettings,
  type MigrationJournalEntry,
  type ExpectedStagingColumn,
  type StagingCatalogState,
  type StagingDatabaseSettings,
} from '../src/db/supabase-staging-guard.ts';
import { loadVerifiedSupabaseStagingSslOptions } from '../src/db/supabase-staging-tls.ts';

export type StagingMode = 'initialize' | 'migrate';
type DiagnosticMode = StagingMode | 'preflight' | 'default-privilege-preparation' | 'default-privilege-diagnostic';

export type StagingRuntime = {
  inspect: () => Promise<StagingCatalogState>;
  applyBaseline: () => Promise<void>;
  applyForwardMigrations: () => Promise<void>;
  close: () => Promise<void>;
};

export type StagingRunnerDependencies = {
  open: (settings: StagingDatabaseSettings) => Promise<StagingRuntime>;
  baseline: MigrationJournalEntry;
  forward: MigrationJournalEntry[];
  expectedBaselineTables: string[];
  expectedBaselineColumns: Record<string, ExpectedStagingColumn[]>;
  expectedBaselineIndexes: string[];
  expectedBaselineConstraints: string[];
  expectedCurrentTables: string[];
  expectedCurrentColumns: Record<string, ExpectedStagingColumn[]>;
  expectedCurrentIndexes: string[];
  expectedCurrentConstraints: string[];
};

export type StagingPreflightRuntime = Pick<StagingRuntime, 'inspect' | 'close'>;
export type StagingPreflightDependencies = Omit<StagingRunnerDependencies, 'open'> & {
  open: (settings: StagingDatabaseSettings) => Promise<StagingPreflightRuntime>;
};

export type DefaultPrivilegePreparationDependencies = {
  open: (settings: StagingDatabaseSettings) => Promise<{ client: PoolClient; close: () => Promise<void> }>;
  applicationTableNames: string[];
};

/** Preserve rows returned by the catalog audit when assembling a staging snapshot. */
export function attachDataApiRoleAudit<T extends Omit<StagingCatalogState, 'dataApiRoleAudit'>>(
  state: T,
  rows: NonNullable<StagingCatalogState['dataApiRoleAudit']>,
): T & Pick<StagingCatalogState, 'dataApiRoleAudit'> {
  return { ...state, dataApiRoleAudit: rows };
}

export class StagingReadOnlyTransactionError extends Error {
  readonly category = 'READ_ONLY_TRANSACTION_REQUIRED';
  constructor() { super('PostgreSQL did not confirm an explicit read-only transaction.'); }
}

type ReadOnlyClient = {
  query: (sql: string) => Promise<{ rows: Array<{ transaction_read_only?: unknown }> }>;
  release: (discard?: boolean) => void;
};

/** Starts and verifies READ ONLY on one checked-out connection; it never accepts arbitrary SQL. */
export async function beginVerifiedReadOnlyTransaction(client: ReadOnlyClient): Promise<void> {
  await client.query('BEGIN READ ONLY');
  const result = await client.query("SELECT current_setting('transaction_read_only') AS transaction_read_only");
  const status = result.rows[0]?.transaction_read_only;
  if (!(status === true || (typeof status === 'string' && ['on', 'true'].includes(status.toLowerCase())))) {
    throw new StagingReadOnlyTransactionError();
  }
}

export async function openVerifiedReadOnlySession<Client extends ReadOnlyClient>(pool: {
  connect: () => Promise<Client>;
  end: () => Promise<void>;
}): Promise<{ client: Client; close: () => Promise<void> }> {
  let client: Client | undefined;
  try {
    client = await pool.connect();
    await beginVerifiedReadOnlyTransaction(client);
  } catch (error) {
    if (client) {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release(true);
    }
    await pool.end().catch(() => undefined);
    throw error;
  }
  let closed = false;
  return {
    client,
    close: async () => {
      if (closed) return;
      closed = true;
      let closeError: unknown;
      try { await client!.query('ROLLBACK'); } catch (error) { closeError = error; }
      client!.release(closeError !== undefined);
      try { await pool.end(); } catch (error) { closeError ??= error; }
      if (closeError) throw closeError;
    },
  };
}

const declaredApplicationTables = [
  schema.brands, schema.cartItems, schema.cartMergeOperations, schema.categories, schema.inventoryReservations,
  schema.orderItems, schema.orders, schema.paymentReviewCases, schema.products, schema.razorpayWebhookEvents,
  schema.reviews, schema.users, schema.wishlist, schema.contactInquiries,
];
const declaredApplicationTableNames = declaredApplicationTables.map((table) => getTableConfig(table).name);

async function createStagingPool(settings: StagingDatabaseSettings) {
  const { Pool } = await import('pg');
  const ssl = settings.ssl
    ? await loadVerifiedSupabaseStagingSslOptions(settings.caFilePath)
    : false;
  return new Pool({
    host: settings.host,
    port: settings.port,
    database: settings.database,
    user: settings.user,
    password: settings.password,
    ssl,
    max: 1,
    connectionTimeoutMillis: 5000,
    statement_timeout: 8000,
    options: '-c search_path=public',
    application_name: 'flyrc-supabase-staging-schema-task',
  });
}

const automaticRlsCatalogSql = `
  SELECT n.nspname AS schema, p.proname AS name, p.oid::text AS "objectId", p.pronargs::integer AS "argumentCount",
         pg_get_function_identity_arguments(p.oid) AS "identityArguments",
         pg_get_userbyid(p.proowner) AS owner, l.lanname AS language,
         pg_get_function_result(p.oid) AS "returnType", p.prosecdef AS "securityDefiner",
         p.proisstrict AS strict, p.provolatile AS volatility, p.proconfig AS configuration,
         length(p.prosrc)::integer AS "sourceLength", md5(p.prosrc) AS "sourceMd5"
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace JOIN pg_language l ON l.oid = p.prolang
  WHERE n.nspname = 'public' AND p.proname = 'rls_auto_enable'
`;

const eventTriggerCatalogSql = `
  SELECT e.evtname AS name, pg_get_userbyid(e.evtowner) AS owner, e.evtenabled AS enabled,
         e.evtevent AS event, e.evttags AS tags, e.evtfoid::text AS "triggerHandlerObjectId",
         hn.nspname AS "handlerSchema", hp.proname AS "handlerName", hp.pronargs::integer AS "handlerArgumentCount",
         pg_get_function_identity_arguments(hp.oid) AS "handlerIdentityArguments",
         pg_get_userbyid(hp.proowner) AS "handlerOwner", hl.lanname AS "handlerLanguage",
         pg_get_function_result(hp.oid) AS "handlerReturnType", hp.prosecdef AS "handlerSecurityDefiner",
         hp.proisstrict AS "handlerStrict", hp.provolatile AS "handlerVolatility", hp.proconfig AS "handlerConfiguration",
         hp.proretset AS "handlerReturnsSet", length(hp.prosrc)::integer AS "handlerSourceLength",
         md5(hp.prosrc) AS "handlerSourceMd5", hp.oid::text AS "handlerObjectId"
  FROM pg_event_trigger e JOIN pg_proc hp ON hp.oid = e.evtfoid
  JOIN pg_namespace hn ON hn.oid = hp.pronamespace JOIN pg_language hl ON hl.oid = hp.prolang
  ORDER BY e.evtname
`;

const defaultAclInventorySql = `
  SELECT pg_get_userbyid(d.defaclrole) AS owner, COALESCE(ns.nspname, '<global>') AS schema,
         CASE d.defaclobjtype WHEN 'r' THEN 'table' WHEN 'S' THEN 'sequence' END AS "objectType",
         CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE grantee.rolname END AS grantee,
         acl.privilege_type AS privilege
  FROM pg_default_acl d CROSS JOIN LATERAL aclexplode(d.defaclacl) acl
  LEFT JOIN pg_namespace ns ON ns.oid = d.defaclnamespace
  LEFT JOIN pg_roles grantee ON grantee.oid = acl.grantee
  WHERE d.defaclobjtype IN ('r', 'S') AND (d.defaclnamespace = 0 OR ns.nspname = 'public')
    AND acl.grantee <> d.defaclrole
  ORDER BY owner, schema, "objectType", grantee, privilege
`;

const publicObjectInventorySql = `
  SELECT c.relname AS name, 'relation' AS kind,
    EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e') AS "extensionOwned"
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v','m','S','f','i','I')
  UNION ALL
  SELECT p.proname, 'routine',
    EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'
  UNION ALL
  SELECT t.typname, 'type',
    EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_type'::regclass AND d.objid = t.oid AND d.deptype = 'e')
  FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
  WHERE n.nspname = 'public' AND t.typtype <> 'p' AND NOT (t.typelem <> 0 AND t.typcategory = 'A')
  UNION ALL
  SELECT o.oprname, 'operator', EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_operator'::regclass AND d.objid = o.oid AND d.deptype = 'e')
  FROM pg_operator o JOIN pg_namespace n ON n.oid = o.oprnamespace WHERE n.nspname = 'public'
  UNION ALL
  SELECT o.opcname, 'operator_class', EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_opclass'::regclass AND d.objid = o.oid AND d.deptype = 'e')
  FROM pg_opclass o JOIN pg_namespace n ON n.oid = o.opcnamespace WHERE n.nspname = 'public'
  UNION ALL
  SELECT o.opfname, 'operator_family', EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_opfamily'::regclass AND d.objid = o.oid AND d.deptype = 'e')
  FROM pg_opfamily o JOIN pg_namespace n ON n.oid = o.opfnamespace WHERE n.nspname = 'public'
  UNION ALL
  SELECT c.collname, 'collation', EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_collation'::regclass AND d.objid = c.oid AND d.deptype = 'e')
  FROM pg_collation c JOIN pg_namespace n ON n.oid = c.collnamespace WHERE n.nspname = 'public'
  UNION ALL
  SELECT c.conname, 'conversion', EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_conversion'::regclass AND d.objid = c.oid AND d.deptype = 'e')
  FROM pg_conversion c JOIN pg_namespace n ON n.oid = c.connamespace WHERE n.nspname = 'public'
  UNION ALL
  SELECT c.cfgname, 'text_search_config', EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_ts_config'::regclass AND d.objid = c.oid AND d.deptype = 'e')
  FROM pg_ts_config c JOIN pg_namespace n ON n.oid = c.cfgnamespace WHERE n.nspname = 'public'
  UNION ALL
  SELECT d.dictname, 'text_search_dictionary', EXISTS (SELECT 1 FROM pg_depend dep WHERE dep.classid = 'pg_ts_dict'::regclass AND dep.objid = d.oid AND dep.deptype = 'e')
  FROM pg_ts_dict d JOIN pg_namespace n ON n.oid = d.dictnamespace WHERE n.nspname = 'public'
  UNION ALL
  SELECT p.prsname, 'text_search_parser', EXISTS (SELECT 1 FROM pg_depend dep WHERE dep.classid = 'pg_ts_parser'::regclass AND dep.objid = p.oid AND dep.deptype = 'e')
  FROM pg_ts_parser p JOIN pg_namespace n ON n.oid = p.prsnamespace WHERE n.nspname = 'public'
  UNION ALL
  SELECT t.tmplname, 'text_search_template', EXISTS (SELECT 1 FROM pg_depend dep WHERE dep.classid = 'pg_ts_template'::regclass AND dep.objid = t.oid AND dep.deptype = 'e')
  FROM pg_ts_template t JOIN pg_namespace n ON n.oid = t.tmplnamespace WHERE n.nspname = 'public'
  UNION ALL
  SELECT s.stxname, 'statistics', EXISTS (SELECT 1 FROM pg_depend dep WHERE dep.classid = 'pg_statistic_ext'::regclass AND dep.objid = s.oid AND dep.deptype = 'e')
  FROM pg_statistic_ext s JOIN pg_namespace n ON n.oid = s.stxnamespace WHERE n.nspname = 'public'
`;

function diagnostic(mode: DiagnosticMode, stage: string) {
  const subject = mode === 'initialize' ? 'Staging baseline initialization'
    : mode === 'migrate' ? 'Staging migration'
      : mode === 'default-privilege-preparation' ? 'Staging default-privilege preparation'
        : mode === 'default-privilege-diagnostic' ? 'Read-only default-privilege diagnostic' : 'Read-only staging preflight';
  return `[SUPABASE_STAGING_${stage}] ${subject} ${stage.toLowerCase().replaceAll('_', ' ')}; no credentials or database details are included.`;
}

function assertSchemaState(state: StagingCatalogState, expected: Pick<StagingRunnerDependencies,
  'expectedBaselineTables' | 'expectedBaselineColumns' | 'expectedBaselineIndexes' | 'expectedBaselineConstraints'
> & { contactExpected: boolean; rlsExpected: boolean; current?: Pick<StagingRunnerDependencies, 'expectedCurrentTables' | 'expectedCurrentColumns' | 'expectedCurrentIndexes' | 'expectedCurrentConstraints'> }) {
  const tables = expected.contactExpected ? expected.current!.expectedCurrentTables : expected.expectedBaselineTables;
  const columns = expected.contactExpected ? expected.current!.expectedCurrentColumns : expected.expectedBaselineColumns;
  const indexes = expected.contactExpected ? expected.current!.expectedCurrentIndexes : expected.expectedBaselineIndexes;
  const constraints = expected.contactExpected ? expected.current!.expectedCurrentConstraints : expected.expectedBaselineConstraints;
  const actualTables = new Set(state.applicationTables);
  if (tables.some((table) => !actualTables.has(table))) throw new Error('schema tables mismatch');
  if (actualTables.has('contact_inquiries') !== expected.contactExpected) throw new Error('contact table mismatch');
  const permittedObjects = new Set([
    ...tables,
    ...tables.map((table) => `${table}_id_seq`),
    ...tables.map((table) => `${table}_pkey`),
    ...indexes,
    ...constraints,
  ]);
  if (state.publicObjects.some((object) => !object.extensionOwned
    && !isApprovedSupabaseAutomaticRlsRoutine(state, object)
    && (object.kind !== 'relation' || !permittedObjects.has(object.name)))) {
    throw new Error('public schema contains unexpected objects');
  }
  const actualRls = new Set(state.applicationRlsTables);
  if (actualRls.size !== (expected.rlsExpected ? tables.length : 0)
    || (expected.rlsExpected && tables.some((table) => !actualRls.has(table)))
    || state.applicationPolicies.length) throw new Error('application RLS or policies differ from the expected migration state');
  for (const [table, required] of Object.entries(columns)) {
    const actual = new Map((state.applicationColumns[table] ?? []).map((column) => [column.name, column]));
    if (actual.size !== required.length || required.some((column) => {
      const actualColumn = actual.get(column.name);
      const expectedType = column.type === 'serial' ? 'integer'
        : column.type === 'bigserial' ? 'bigint'
          : column.type === 'timestamp' ? 'timestamp without time zone'
            : column.type;
      return !actualColumn || normalizeStagingSqlType(actualColumn.type) !== normalizeStagingSqlType(expectedType)
        || actualColumn.notNull !== column.notNull
        || actualColumn.hasDefault !== column.hasDefault;
    })) throw new Error('schema columns mismatch');
  }
  if (indexes.some((name) => !state.applicationIndexes.includes(name))) throw new Error('schema indexes mismatch');
  const actualConstraints = new Set(state.applicationConstraints);
  if (actualConstraints.size !== constraints.length || constraints.some((name) => !actualConstraints.has(name))) throw new Error('schema constraints mismatch');
  if (expected.contactExpected) {
    const statusDefault = state.applicationColumnDefaults.contact_inquiries?.status?.toUpperCase() ?? '';
    const createdAtDefault = state.applicationColumnDefaults.contact_inquiries?.created_at?.toLowerCase() ?? '';
    const checkDefinition = state.contactInquiryStatusConstraint?.toUpperCase() ?? '';
    const indexDefinition = state.contactInquiryCreatedAtIndex?.toLowerCase().replaceAll('"', '').replaceAll(' ', '') ?? '';
    if (!statusDefault.includes('NEW') || !createdAtDefault.includes('now()')
      || !['NEW', 'REVIEWED', 'CLOSED'].every((value) => checkDefinition.includes(value))
      || !indexDefinition.includes('usingbtree(created_at)')) {
      throw new Error('contact inquiry defaults, status constraint, or index definition mismatch');
    }
  }
}

export async function runSupabaseStagingCommand(
  mode: StagingMode,
  args: string[],
  env: Record<string, string | undefined>,
  dependencies: StagingRunnerDependencies,
  report: (line: string) => void = () => undefined,
): Promise<number> {
  let settings: StagingDatabaseSettings;
  try {
    settings = resolveSupabaseStagingSettings(mode, args, env);
    if (!dependencies.baseline.hash || dependencies.baseline.tag !== '0000_application-baseline') throw new Error('invalid baseline journal');
    if (dependencies.forward[0]?.tag !== '0006_contact-inquiries') throw new Error('invalid forward journal');
    if (dependencies.forward[1]?.tag !== '0007_application-table-rls-api-hardening') throw new Error('invalid application-table hardening migration');
    if (dependencies.forward.some((entry, index) => entry.when <= dependencies.baseline.when || (index > 0 && entry.when <= dependencies.forward[index - 1]!.when))) throw new Error('invalid migration ordering');
  } catch {
    report(diagnostic(mode, 'CONFIGURATION_INVALID'));
    return 2;
  }

  return runSupabaseStagingOperations(mode, settings, dependencies, report);
}

/** Read-only preflight: this dependency surface intentionally exposes no migration methods. */
export async function runSupabaseStagingPreflight(
  args: string[],
  env: Record<string, string | undefined>,
  dependencies: StagingPreflightDependencies,
  report: (line: string) => void = () => undefined,
): Promise<number> {
  const requiredSettings = [
    'SUPABASE_STAGING_ENABLED', 'SUPABASE_STAGING_PROJECT_REF',
    'SUPABASE_STAGING_DATABASE_URL', 'SUPABASE_STAGING_DATABASE_HOST', 'SUPABASE_STAGING_DATABASE_PORT',
    'SUPABASE_STAGING_DATABASE_NAME', 'SUPABASE_STAGING_DATABASE_USER', 'SUPABASE_STAGING_DATABASE_EFFECTIVE_USER',
    'SUPABASE_STAGING_RUNTIME_DATABASE_USER', 'SUPABASE_STAGING_SCHEMA', 'SUPABASE_STAGING_TARGET_FINGERPRINT',
    'SUPABASE_STAGING_PREFLIGHT_CONFIRMATION',
  ];
  const missingSettings = requiredSettings.filter((name) => !env[name]?.trim());
  if (missingSettings.length) {
    report(`FAIL missing required local configuration names: ${missingSettings.join(', ')}. No database connection was attempted.`);
    return 2;
  }
  let settings: StagingDatabaseSettings;
  try {
    settings = resolveSupabaseStagingSettings('check', args, env);
    if (dependencies.baseline.tag !== '0000_application-baseline'
      || dependencies.forward[0]?.tag !== '0006_contact-inquiries'
      || dependencies.forward[1]?.tag !== '0007_application-table-rls-api-hardening'
      || dependencies.forward.some((entry, index) => entry.when <= dependencies.baseline.when
        || (index > 0 && entry.when <= dependencies.forward[index - 1]!.when))) throw new Error('invalid migration journal');
  } catch {
    report(diagnostic('preflight', 'CONFIGURATION_INVALID'));
    return 2;
  }

  let runtime: StagingPreflightRuntime | undefined;
  let failures = 0;
  let result = 1;
  const check = (name: string, fn: () => void) => {
    try {
      fn();
      report(`PASS ${name}`);
    } catch {
      failures += 1;
      report(`FAIL ${name}; manual review required.`);
    }
  };
  try {
    report('PASS explicit staging configuration and target fingerprint validated.');
    try {
      runtime = await dependencies.open(settings);
    } catch (error) {
      if (error instanceof StagingReadOnlyTransactionError) {
        report(diagnostic('preflight', error.category));
        return 1;
      }
      throw error;
    }
    const state = await runtime.inspect();
    let identityValid = true;
    try {
      assertStagingIdentity(state.identity, settings);
    } catch {
      identityValid = false;
      failures += 1;
      report('FAIL connected database identity, login/effective role, public schema, or search path mismatch; catalog details withheld.');
    }
    if (!identityValid) return 1;
    report('PASS connected database identity: configured endpoint login, observed session role, expected effective role, database, schema, search path, and internal server port verified.');

    const safeName = (value: string) => /^[A-Za-z_][A-Za-z0-9_$]{0,62}$/.test(value) ? value : '[nonstandard-name]';
    const safeDigest = (value: string) => /^[a-f0-9]{32}$/i.test(value) ? value : '[invalid-digest]';
    report(`Target: fingerprint=${settings.fingerprint}; endpoint=${settings.connectionMode}; configured_login=${safeName(settings.user)}; session_user=${safeName(state.identity.loginUser)}; current_user=${safeName(state.identity.user)}; database=${safeName(state.identity.database)}; current_schema=${safeName(state.identity.currentSchema)}; search_path=${safeName(state.identity.searchPath)}; server_port=${state.identity.serverPort}; transaction_read_only=${state.identity.transactionReadOnly === true}.`);
    report(`Schemas: public=${state.schemas.public ? 'present' : 'absent'}, auth=${state.schemas.auth ? 'present' : 'absent'}, storage=${state.schemas.storage ? 'present' : 'absent'}, drizzle=${state.schemas.drizzle ? 'present' : 'absent'}, supabase_migrations=${state.schemas.supabaseMigrations ? 'present' : 'absent'}.`);
    report(`Public objects: ${state.publicObjects.length ? state.publicObjects.map((object) => `${safeName(object.kind)}:${safeName(object.name)}${object.extensionOwned ? '[extension]' : ''}`).join(', ') : 'none'}.`);
    report(`Drizzle objects: ${state.drizzleObjects.length ? state.drizzleObjects.map((object) => `${safeName(object.kind)}:${safeName(object.name)}`).join(', ') : 'none'}.`);
    const automatic = state.supabaseAutomaticRlsFunctions.length === 1 ? state.supabaseAutomaticRlsFunctions[0] : undefined;
    const eventTrigger = state.eventTriggers.find((trigger) => trigger.name === 'ensure_rls');
    const autoRlsChecks = supabaseAutomaticRlsDiagnostics(state);
    report(`Automatic RLS property checks: ${Object.entries(autoRlsChecks).map(([name, valid]) => `${name}=${valid}`).join(', ')}.`);
    report(`Automatic RLS observed safe metadata: function=${automatic ? `${safeName(automatic.schema)}.${safeName(automatic.name)} owner=${safeName(automatic.owner)} language=${safeName(automatic.language)} result=${safeName(automatic.returnType)} security_definer=${automatic.securityDefiner} strict=${automatic.strict} volatility=${safeName(automatic.volatility)} source_length=${automatic.sourceLength} source_md5=${safeDigest(automatic.sourceMd5)}` : 'absent'}; event_trigger=${eventTrigger ? `${safeName(eventTrigger.name)} owner=${safeName(eventTrigger.owner)} enabled=${safeName(eventTrigger.enabled)} event=${safeName(eventTrigger.event)} tags_match=${autoRlsChecks.trigger_event_tag_set_matches} handler_match=${autoRlsChecks.trigger_handler_matches}` : 'absent'}; event_trigger_count=${state.eventTriggers.length}.`);
    report(`Event-trigger allowlist checks (sanitized booleans): ${JSON.stringify(autoRlsChecks)}.`);
    report(`API roles: ${state.dataApiRoles.map(safeName).join(', ') || 'none'}.`);
    report(`API role existence: anon=${state.dataApiRoles.includes('anon')}; authenticated=${state.dataApiRoles.includes('authenticated')}.`);
    report(`API role audit completeness: expected_exactly_once=${state.dataApiRoleAudit?.length === 2
      && state.dataApiRoleAudit.filter((role) => role.role === 'anon').length === 1
      && state.dataApiRoleAudit.filter((role) => role.role === 'authenticated').length === 1}.`);
    for (const role of state.dataApiRoleAudit ?? []) {
      const noEffectiveAppTableGrants = role.applicationTablePrivileges.length === 0;
      const noEffectiveAppColumnGrants = role.applicationColumnPrivileges.length === 0;
      const noEffectiveAppSequenceGrants = role.applicationSequencePrivileges.length === 0;
      const noCurrentAppAcl = role.directApplicationTableAcl.length === 0
        && role.directApplicationColumnAcl.length === 0 && role.directApplicationSequenceAcl.length === 0;
      const noGlobalDefaults = role.globalDefaultTablePrivileges.length === 0 && role.globalDefaultSequencePrivileges.length === 0;
      const noSchemaDefaults = role.schemaDefaultTablePrivileges.length === 0 && role.schemaDefaultSequencePrivileges.length === 0;
      const roleIsolation = !role.inheritsRuntimeOwner && !role.memberOfRuntimeOwner && !role.superuser && !role.bypassRls
        && !role.publicCreate && !role.drizzleCreate && !role.authCreate && !role.storageCreate
        && noEffectiveAppTableGrants && noEffectiveAppColumnGrants && noEffectiveAppSequenceGrants
        && noCurrentAppAcl && noGlobalDefaults && noSchemaDefaults;
      report(`API role ${safeName(role.role)}: isolation_predicate=${roleIsolation}; inherits_runtime_owner=${role.inheritsRuntimeOwner}; owner_membership_path=${role.memberOfRuntimeOwner}; superuser=${role.superuser}; bypass_rls=${role.bypassRls}; public_usage=${role.publicUsage}(informational); public_create_absent=${!role.publicCreate}; auth_usage=${role.authUsage}(informational); auth_create_absent=${!role.authCreate}; storage_usage=${role.storageUsage}(informational); storage_create_absent=${!role.storageCreate}; drizzle_usage=${role.drizzleUsage}(informational); drizzle_create_absent=${!role.drizzleCreate}; effective_app_table_privileges_absent=${noEffectiveAppTableGrants}(count=${role.applicationTablePrivileges.length}); effective_app_column_privileges_absent=${noEffectiveAppColumnGrants}(count=${role.applicationColumnPrivileges.length}); effective_app_sequence_privileges_absent=${noEffectiveAppSequenceGrants}(count=${role.applicationSequencePrivileges.length}); current_public_anon_authenticated_acl_absent=${noCurrentAppAcl}(table=${role.directApplicationTableAcl.length},column=${role.directApplicationColumnAcl.length},sequence=${role.directApplicationSequenceAcl.length}); global_default_table_and_sequence_privileges_absent=${noGlobalDefaults}(table=${role.globalDefaultTablePrivileges.length},sequence=${role.globalDefaultSequencePrivileges.length}); public_default_table_and_sequence_privileges_absent=${noSchemaDefaults}(table=${role.schemaDefaultTablePrivileges.length},sequence=${role.schemaDefaultSequencePrivileges.length}).`);
    }
    report(`Privilege audit context: roles=${state.dataApiRoleAudit?.length ?? 0}; configured_runtime_role_equals_expected_migration_role=true; no_application_tables=${state.applicationTables.length === 0}; ordinary_schema_usage_is_informational=true; no_existing_application_grants=${(state.dataApiRoleAudit ?? []).every((role) => role.applicationTablePrivileges.length === 0 && role.applicationColumnPrivileges.length === 0 && role.applicationSequencePrivileges.length === 0)}.`);
    const defaultCounts = new Map<string, number>();
    for (const row of state.defaultAclInventory ?? []) {
      const key = `${row.owner}/${row.schema}/${row.objectType}`;
      defaultCounts.set(key, (defaultCounts.get(key) ?? 0) + 1);
    }
    report(`Default ACL inventory (owner/scope/object: count): ${[...defaultCounts.entries()].map(([key, count]) => `${safeName(key.split('/')[0] ?? '')}/${key.split('/')[1] === '<global>' ? 'global' : safeName(key.split('/')[1] ?? '')}/${safeName(key.split('/')[2] ?? '')}=${count}`).join(', ') || 'none'}. Migration owner checked=${safeName(settings.runtimeUser)}.`);
    report(`Application tables: ${state.applicationTables.map(safeName).join(', ') || 'none'} (count=${state.applicationTables.length}); RLS tables=${state.applicationRlsTables.map(safeName).join(', ') || 'none'}; policies=${state.applicationPolicies.map(safeName).join(', ') || 'none'}.`);
    report(`Drizzle history: ${state.migrationHistory.length ? state.migrationHistory.map((row) => `${row.createdAt}:${safeName(row.hash)}`).join(', ') : 'absent'}.`);
    report(`Supabase CLI migration history: schema=${state.supabaseMigrationSchemaExists ? 'present' : 'absent'}, records=${state.supabaseMigrationRecords}${state.supabaseMigrationEntries?.length ? `, entries=${state.supabaseMigrationEntries.map(safeName).join(',')}` : ''}.`);

    check('required Supabase schemas', () => assertStagingRequiredSchemas(state.schemas));
    check('database transaction is explicitly read-only', () => { if (state.identity.transactionReadOnly !== true) throw new Error('read-only transaction setting absent'); });
    check('exact automatic-RLS function and event trigger', () => assertSupabaseAutomaticRlsConfiguration(state));
    check('required Data API roles', () => assertStagingDataApiRoles(state.dataApiRoles));
    check('Data API privilege isolation from runtime/migration owner and application tables', () => assertStagingDataApiPrivileges(state));
    check('default ACL owner scope and Supabase-managed snapshot', () => assertStagingDefaultAclInventory(state.defaultAclInventory, settings.runtimeUser));
    check('baseline initialization preflight and migration-history eligibility', () => assertStagingInitializationState(state, [
      ...dependencies.expectedBaselineTables,
      ...dependencies.expectedBaselineTables.map((table) => `${table}_id_seq`),
      ...dependencies.expectedBaselineTables.map((table) => `${table}_pkey`),
      ...dependencies.expectedBaselineIndexes,
      ...dependencies.expectedBaselineConstraints,
    ]));
    report(failures === 0
      ? 'ELIGIBLE for guarded baseline initialization only. This read-only command applied no schema changes or migrations.'
      : 'NOT ELIGIBLE for baseline initialization; no database changes were made. Investigate the failed checks manually.');
    result = failures === 0 ? 0 : 1;
  } catch {
    report(diagnostic('preflight', runtime ? 'CATALOG_CHECK_FAILED' : 'CONNECTION_FAILED'));
    result = 1;
  } finally {
    if (runtime) {
      try {
        await runtime.close();
      } catch {
        report(diagnostic('preflight', 'CONNECTION_CLOSE_FAILED'));
        failures += 1;
        result = 1;
      }
    }
  }
  return result;
}

/**
 * Runs already-resolved database operations. Production CLIs call this only
 * through runSupabaseStagingCommand, which validates all target safeguards
 * first. Local integration tests may inject an explicitly verified loopback
 * target without making that path reachable from either staging CLI.
 */
export async function runSupabaseStagingDefaultPrivilegePreparation(
  args: string[],
  env: Record<string, string | undefined>,
  dependencies: DefaultPrivilegePreparationDependencies,
  report: (line: string) => void = () => undefined,
): Promise<number> {
  let settings: StagingDatabaseSettings;
  try {
    settings = resolveSupabaseStagingSettings('prepare-default-privileges', args, env);
    if (settings.runtimeUser === 'supabase_admin') throw new Error('The Supabase platform owner is not an application migration owner.');
  } catch {
    report(diagnostic('default-privilege-preparation', 'CONFIGURATION_INVALID'));
    return 2;
  }

  let connection: Awaited<ReturnType<DefaultPrivilegePreparationDependencies['open']>> | undefined;
  let transactionStarted = false;
  let committed = false;
  let stage = 'CONNECTION_FAILED';
  let beforeApplicationCount = 0;
  let afterApplicationCount = 0;
  let exitCode = 1;
  try {
    connection = await dependencies.open(settings);
    const client = connection.client;
    await client.query('BEGIN');
    transactionStarted = true;
    stage = 'IDENTITY_FAILED';
    const identityResult = await client.query<{
      database: string; loginUser: string; user: string; currentSchema: string; searchPath: string; serverPort: number; transactionReadOnly: boolean;
    }>(`SELECT current_database() AS database, session_user AS "loginUser", current_user AS user,
               current_schema() AS "currentSchema", current_setting('search_path') AS "searchPath",
               inet_server_port() AS "serverPort", current_setting('transaction_read_only')::boolean AS "transactionReadOnly"`);
    const identity = identityResult.rows[0];
    if (!identity || identity.transactionReadOnly !== false) throw new Error('writable transaction identity is unavailable');
    assertStagingIdentity({ ...identity, serverPort: Number(identity.serverPort) }, settings);
    if (identity.user !== settings.runtimeUser || identity.currentSchema !== 'public'
      || identity.searchPath.replaceAll('"', '').split(',').map((part) => part.trim()).join(',') !== 'public') {
      throw new Error('application owner or schema identity mismatch');
    }

    stage = 'TARGET_STATE_FAILED';
    const schemas = await client.query<{ public: boolean; auth: boolean; storage: boolean; drizzle: boolean; supabaseMigrations: boolean;
      drizzleHistory: boolean; supabaseHistory: boolean; applicationTables: string[] }>(`
      SELECT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='public') AS public,
             EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='auth') AS auth,
             EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='storage') AS storage,
             EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='drizzle') AS drizzle,
             EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='supabase_migrations') AS "supabaseMigrations",
             to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS "drizzleHistory",
             to_regclass('supabase_migrations.schema_migrations') IS NOT NULL AS "supabaseHistory",
             ARRAY(
               SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
               WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','S','f') AND c.relname=ANY($1::text[])
               ORDER BY c.relname
             ) AS "applicationTables"
    `, [dependencies.applicationTableNames]);
    const schemaState = schemas.rows[0];
    if (!schemaState) throw new Error('schema state unavailable');
    assertStagingRequiredSchemas({ public: schemaState.public, auth: schemaState.auth, storage: schemaState.storage,
      drizzle: schemaState.drizzle, supabaseMigrations: schemaState.supabaseMigrations });
    if (schemaState.drizzle || schemaState.drizzleHistory || schemaState.supabaseMigrations || schemaState.supabaseHistory
      || schemaState.applicationTables.length) throw new Error('existing application objects or migration history');

    const publicObjects = await client.query<{ name: string; kind: string; extensionOwned: boolean }>(publicObjectInventorySql);
    const unexpectedPublicObjects = publicObjects.rows.filter((object) => !object.extensionOwned
      && !(object.kind === 'routine' && object.name === 'rls_auto_enable'));
    if (unexpectedPublicObjects.length) throw new Error('unexpected public objects require manual review');

    stage = 'EVENT_TRIGGER_FAILED';
    const functionResult = await client.query<StagingCatalogState['supabaseAutomaticRlsFunctions'][number]>(automaticRlsCatalogSql);
    const triggerResult = await client.query<StagingCatalogState['eventTriggers'][number]>(eventTriggerCatalogSql);
    assertSupabaseAutomaticRlsConfiguration({ supabaseAutomaticRlsFunctions: functionResult.rows, eventTriggers: triggerResult.rows }, settings.automaticRlsRequired);

    stage = 'ROLE_AUDIT_FAILED';
    const roleResult = await client.query<{ role: string; superuser: boolean; bypassRls: boolean; inheritsOwner: boolean;
      memberOfOwner: boolean; publicCreate: boolean; authCreate: boolean; storageCreate: boolean }>(`
      SELECT r.rolname AS role, r.rolsuper AS superuser, r.rolbypassrls AS "bypassRls",
             pg_has_role(r.rolname, current_user, 'USAGE') AS "inheritsOwner",
             pg_has_role(r.rolname, current_user, 'MEMBER') AS "memberOfOwner",
             has_schema_privilege(r.rolname, 'public', 'CREATE') AS "publicCreate",
             has_schema_privilege(r.rolname, 'auth', 'CREATE') AS "authCreate",
             has_schema_privilege(r.rolname, 'storage', 'CREATE') AS "storageCreate"
      FROM pg_roles r WHERE r.rolname IN ('anon','authenticated') ORDER BY r.rolname
    `);
    const roleRows = roleResult.rows;
    assertStagingDataApiRoles(roleRows.map((role) => role.role));
    if (roleRows.length !== 2 || roleRows.some((role) => [role.superuser, role.bypassRls, role.inheritsOwner, role.memberOfOwner,
      role.publicCreate, role.authCreate, role.storageCreate].some((value) => typeof value !== 'boolean')
      || role.superuser || role.bypassRls || role.inheritsOwner
      || role.memberOfOwner || role.publicCreate || role.authCreate || role.storageCreate)) {
      throw new Error('Data API roles have unsafe effective or schema privileges');
    }

    stage = 'DEFAULT_ACL_PRECHECK_FAILED';
    const beforeAclResult = await client.query<NonNullable<StagingCatalogState['defaultAclInventory']>[number]>(defaultAclInventorySql);
    const beforeAcl = beforeAclResult.rows;
    assertStagingDefaultAclInventory(beforeAcl, settings.runtimeUser, true);
    beforeApplicationCount = beforeAcl.filter((row) => row.owner === settings.runtimeUser).length;

    stage = 'DEFAULT_ACL_REVOKE_FAILED';
    await client.query('ALTER DEFAULT PRIVILEGES FOR ROLE CURRENT_USER IN SCHEMA public REVOKE ALL ON TABLES FROM anon');
    await client.query('ALTER DEFAULT PRIVILEGES FOR ROLE CURRENT_USER IN SCHEMA public REVOKE ALL ON TABLES FROM authenticated');
    await client.query('ALTER DEFAULT PRIVILEGES FOR ROLE CURRENT_USER IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon');
    await client.query('ALTER DEFAULT PRIVILEGES FOR ROLE CURRENT_USER IN SCHEMA public REVOKE ALL ON SEQUENCES FROM authenticated');

    stage = 'DEFAULT_ACL_POSTCHECK_FAILED';
    const afterAclResult = await client.query<NonNullable<StagingCatalogState['defaultAclInventory']>[number]>(defaultAclInventorySql);
    const afterAcl = afterAclResult.rows;
    assertStagingDefaultAclInventory(afterAcl, settings.runtimeUser, false);
    const platformBefore = beforeAcl.filter((row) => row.owner === 'supabase_admin').map((row) => JSON.stringify(row)).sort();
    const platformAfter = afterAcl.filter((row) => row.owner === 'supabase_admin').map((row) => JSON.stringify(row)).sort();
    if (JSON.stringify(platformBefore) !== JSON.stringify(platformAfter)) throw new Error('platform default ACL state changed');
    afterApplicationCount = afterAcl.filter((row) => row.owner === settings.runtimeUser).length;
    if (afterApplicationCount !== 0) throw new Error('application owner defaults remain');

    stage = 'COMMIT_FAILED';
    await client.query('COMMIT');
    committed = true;
    transactionStarted = false;
    report(`PASS staging application-owner defaults hardened; owner=${settings.runtimeUser}; schema=public; relevant_grants_before=${beforeApplicationCount}; relevant_grants_after=${afterApplicationCount}; supabase_admin_defaults_unchanged=${platformBefore.length === platformAfter.length}.`);
    exitCode = 0;
  } catch {
    if (transactionStarted && connection) await connection.client.query('ROLLBACK').catch(() => undefined);
    transactionStarted = false;
    report(diagnostic('default-privilege-preparation', stage));
    exitCode = 1;
  } finally {
    if (connection) {
      try {
        await connection.close();
      } catch {
        report(diagnostic('default-privilege-preparation', 'CONNECTION_CLOSE_FAILED'));
        if (committed) report('WARNING transaction committed but connection cleanup reported a failure.');
        exitCode = 1;
      }
    }
  }
  return exitCode;
}

/**
 * Read-only checkpoint diagnostic for the preparation preconditions. This path
 * deliberately has no mutation methods and uses BEGIN READ ONLY on one client.
 */
export async function runSupabaseStagingDefaultPrivilegeDiagnostic(
  args: string[],
  env: Record<string, string | undefined>,
  dependencies: DefaultPrivilegePreparationDependencies,
  report: (line: string) => void = () => undefined,
): Promise<number> {
  let settings: StagingDatabaseSettings;
  try {
    settings = resolveSupabaseStagingSettings('check-default-privileges', args, env);
    if (settings.runtimeUser === 'supabase_admin') throw new Error('platform owner is not an application owner');
  } catch {
    report(diagnostic('default-privilege-diagnostic', 'CONFIGURATION_INVALID'));
    return 2;
  }
  let connection: Awaited<ReturnType<DefaultPrivilegePreparationDependencies['open']>> | undefined;
  let failed = false;
  let stage = 'CONNECTION_FAILED';
  const checkpoint = async (name: string, operation: () => Promise<void>) => {
    try { await operation(); report(`PASS ${name}`); }
    catch { failed = true; report(`FAIL ${name}; manual review required.`); }
  };
  try {
    connection = await dependencies.open(settings);
    const client = connection.client;
    stage = 'READ_ONLY_TRANSACTION_REQUIRED';
    await client.query('BEGIN READ ONLY');
    const identityResult = await client.query<{ database: string; loginUser: string; user: string; currentSchema: string; searchPath: string; serverPort: number; transactionReadOnly: boolean }>(`SELECT current_database() AS database, session_user AS "loginUser", current_user AS user, current_schema() AS "currentSchema", current_setting('search_path') AS "searchPath", inet_server_port() AS "serverPort", current_setting('transaction_read_only')::boolean AS "transactionReadOnly"`);
    const identity = identityResult.rows[0];
    if (!identity || identity.transactionReadOnly !== true) throw new Error('read-only transaction was not confirmed');
    stage = 'SCHEMA_STATE_FAILED';
    await checkpoint('schema-state validation', async () => {
      assertStagingIdentity({ ...identity, serverPort: Number(identity.serverPort) }, settings);
      if (identity.user !== settings.runtimeUser || identity.currentSchema !== 'public' || identity.searchPath.replaceAll('"', '').split(',').map((part) => part.trim()).join(',') !== 'public') throw new Error('identity mismatch');
      const result = await client.query<{ public: boolean; auth: boolean; storage: boolean; drizzle: boolean; supabaseMigrations: boolean; drizzleHistory: boolean; supabaseHistory: boolean; applicationTables: string[] }>(`SELECT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='public') AS public, EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='auth') AS auth, EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='storage') AS storage, EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='drizzle') AS drizzle, EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='supabase_migrations') AS "supabaseMigrations", to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS "drizzleHistory", to_regclass('supabase_migrations.schema_migrations') IS NOT NULL AS "supabaseHistory", ARRAY(SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','S','f') AND c.relname=ANY($1::text[])) AS "applicationTables"`, [dependencies.applicationTableNames]);
      const state = result.rows[0];
      if (!state) throw new Error('schema state unavailable');
      assertStagingRequiredSchemas({ public: state.public, auth: state.auth, storage: state.storage, drizzle: state.drizzle, supabaseMigrations: state.supabaseMigrations });
      if (state.drizzle || state.drizzleHistory || state.supabaseMigrations || state.supabaseHistory || state.applicationTables.length) throw new Error('existing application objects or migration history');
    });
    stage = 'MIGRATION_HISTORY_FAILED';
    await checkpoint('migration-history eligibility', async () => {
      const result = await client.query<{ drizzle: boolean; supabase: boolean }>(`SELECT to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS drizzle, to_regclass('supabase_migrations.schema_migrations') IS NOT NULL AS supabase`);
      if (result.rows[0]?.drizzle || result.rows[0]?.supabase) throw new Error('migration history exists');
    });
    stage = 'PUBLIC_OBJECT_INVENTORY_FAILED';
    await checkpoint('public-object inventory validation', async () => {
      const result = await client.query<{ name: string; kind: string; extensionOwned: boolean }>(publicObjectInventorySql);
      if (result.rows.some((object) => !object.extensionOwned && !(object.kind === 'routine' && object.name === 'rls_auto_enable'))) throw new Error('unexpected public object');
    });
    stage = 'API_ROLE_VALIDATION_FAILED';
    await checkpoint('API-role validation', async () => {
      const result = await client.query<{ role: string; superuser: boolean; bypassRls: boolean; inheritsOwner: boolean; memberOfOwner: boolean; publicCreate: boolean; authCreate: boolean; storageCreate: boolean }>(`SELECT r.rolname AS role, r.rolsuper AS "superuser", r.rolbypassrls AS "bypassRls", pg_has_role(r.rolname, current_user, 'USAGE') AS "inheritsOwner", pg_has_role(r.rolname, current_user, 'MEMBER') AS "memberOfOwner", has_schema_privilege(r.rolname, 'public', 'CREATE') AS "publicCreate", has_schema_privilege(r.rolname, 'auth', 'CREATE') AS "authCreate", has_schema_privilege(r.rolname, 'storage', 'CREATE') AS "storageCreate" FROM pg_roles r WHERE r.rolname IN ('anon','authenticated') ORDER BY r.rolname`);
      assertStagingDataApiRoles(result.rows.map((row) => row.role));
      if (result.rows.length !== 2 || result.rows.some((row) => row.superuser || row.bypassRls || row.inheritsOwner || row.memberOfOwner || row.publicCreate || row.authCreate || row.storageCreate)) throw new Error('API roles are unsafe');
    });
    stage = 'DEFAULT_ACL_INVENTORY_FAILED';
    await checkpoint('default-ACL inventory validation', async () => {
      const result = await client.query<NonNullable<StagingCatalogState['defaultAclInventory']>[number]>(defaultAclInventorySql);
      assertStagingDefaultAclInventory(result.rows, settings.runtimeUser, true);
    });
  } catch {
    failed = true;
    report(diagnostic('default-privilege-diagnostic', stage));
  } finally {
    if (connection) {
      try { await connection.client.query('ROLLBACK'); } catch { failed = true; }
      try { await connection.close(); } catch { failed = true; report(diagnostic('default-privilege-diagnostic', 'CONNECTION_CLOSE_FAILED')); }
    }
  }
  return failed ? 1 : 0;
}

export async function runSupabaseStagingOperations(
  mode: StagingMode,
  settings: StagingDatabaseSettings,
  dependencies: StagingRunnerDependencies,
  report: (line: string) => void = () => undefined,
): Promise<number> {
  if (!dependencies.baseline.hash || dependencies.baseline.tag !== '0000_application-baseline'
    || dependencies.forward[0]?.tag !== '0006_contact-inquiries'
    || dependencies.forward[1]?.tag !== '0007_application-table-rls-api-hardening'
    || dependencies.forward.some((entry, index) => entry.when <= dependencies.baseline.when || (index > 0 && entry.when <= dependencies.forward[index - 1]!.when))) {
    report(diagnostic(mode, 'CONFIGURATION_INVALID'));
    return 2;
  }
  let runtime: StagingRuntime | undefined;
  let exitCode = 0;
  let stage = 'CONNECTION_FAILED';
  try {
    runtime = await dependencies.open(settings);
    stage = 'IDENTITY_FAILED';
    const before = await runtime.inspect();
    assertStagingIdentity(before.identity, settings);
    assertSupabaseAutomaticRlsConfiguration(before, settings.automaticRlsRequired);
    stage = 'DATA_API_ROLES_FAILED';
    assertStagingDataApiRoles(before.dataApiRoles);
    assertStagingRequiredSchemas(before.schemas);
    assertStagingDataApiPrivileges(before);
    stage = 'PREFLIGHT_FAILED';
    if (mode === 'initialize') {
      assertStagingInitializationState(before, [
        ...dependencies.expectedBaselineTables,
        ...dependencies.expectedBaselineTables.map((table) => `${table}_id_seq`),
        ...dependencies.expectedBaselineTables.map((table) => `${table}_pkey`),
        ...dependencies.expectedBaselineIndexes,
        ...dependencies.expectedBaselineConstraints,
      ], settings.automaticRlsRequired);
      stage = 'BASELINE_FAILED';
      await runtime.applyBaseline();
      stage = 'BASELINE_VERIFY_FAILED';
      const after = await runtime.inspect();
      assertStagingIdentity(after.identity, settings);
      assertSupabaseAutomaticRlsUnchanged(before, after, settings.automaticRlsRequired);
      assertStagingBaselineState(after, {
        baseline: dependencies.baseline,
        baselineApplicationTables: dependencies.expectedBaselineTables,
        baselineColumns: dependencies.expectedBaselineColumns,
        baselineIndexes: dependencies.expectedBaselineIndexes,
        baselineConstraints: dependencies.expectedBaselineConstraints,
        automaticRlsRequired: settings.automaticRlsRequired,
      });
      if (!after.drizzleSchemaExists || after.drizzleRelations.length !== 2
        || !after.drizzleRelations.includes('__drizzle_migrations')
        || !after.drizzleRelations.includes('__drizzle_migrations_id_seq')) {
        throw new Error('baseline migration metadata objects mismatch');
      }
      assertSchemaState(after, {
        expectedBaselineTables: dependencies.expectedBaselineTables,
        expectedBaselineColumns: dependencies.expectedBaselineColumns,
        expectedBaselineIndexes: dependencies.expectedBaselineIndexes,
        expectedBaselineConstraints: dependencies.expectedBaselineConstraints,
        contactExpected: false,
        rlsExpected: settings.automaticRlsRequired,
      });
    } else {
      if (before.supabaseMigrationSchemaExists || before.supabaseMigrationRecords !== 0) {
        throw new Error('Supabase CLI migration history exists; reconcile migration systems before continuing.');
      }
      assertStagingMigrationHistory(before.migrationHistory, dependencies.baseline, dependencies.forward, true);
      assertSupabaseAutomaticRlsConfiguration(before, settings.automaticRlsRequired);
      if (!before.drizzleSchemaExists || before.drizzleRelations.length !== 2
        || !before.drizzleRelations.includes('__drizzle_migrations')
        || !before.drizzleRelations.includes('__drizzle_migrations_id_seq')) {
        throw new Error('migration metadata objects mismatch');
      }
      const appliedForwardCount = before.migrationHistory.length - 1;
      assertSchemaState(before, {
        expectedBaselineTables: dependencies.expectedBaselineTables,
        expectedBaselineColumns: dependencies.expectedBaselineColumns,
        expectedBaselineIndexes: dependencies.expectedBaselineIndexes,
        expectedBaselineConstraints: dependencies.expectedBaselineConstraints,
        contactExpected: appliedForwardCount > 0,
        rlsExpected: settings.automaticRlsRequired || appliedForwardCount >= 2,
        current: {
          expectedCurrentTables: dependencies.expectedCurrentTables,
          expectedCurrentColumns: dependencies.expectedCurrentColumns,
          expectedCurrentIndexes: dependencies.expectedCurrentIndexes,
          expectedCurrentConstraints: dependencies.expectedCurrentConstraints,
        },
      });
      stage = 'FORWARD_MIGRATION_FAILED';
      await runtime.applyForwardMigrations();
      stage = 'FORWARD_VERIFY_FAILED';
      const after = await runtime.inspect();
      assertStagingIdentity(after.identity, settings);
      assertSupabaseAutomaticRlsUnchanged(before, after, settings.automaticRlsRequired);
      if (after.supabaseMigrationSchemaExists || after.supabaseMigrationRecords !== 0) {
        throw new Error('Supabase CLI migration history appeared during migration.');
      }
      assertStagingMigrationHistory(after.migrationHistory, dependencies.baseline, dependencies.forward, false);
      if (!after.drizzleSchemaExists || after.drizzleRelations.length !== 2
        || !after.drizzleRelations.includes('__drizzle_migrations')
        || !after.drizzleRelations.includes('__drizzle_migrations_id_seq')) {
        throw new Error('migration metadata objects mismatch');
      }
      assertSchemaState(after, {
        expectedBaselineTables: dependencies.expectedBaselineTables,
        expectedBaselineColumns: dependencies.expectedBaselineColumns,
        expectedBaselineIndexes: dependencies.expectedBaselineIndexes,
        expectedBaselineConstraints: dependencies.expectedBaselineConstraints,
        contactExpected: true,
        rlsExpected: settings.automaticRlsRequired || dependencies.forward.length >= 2,
        current: {
          expectedCurrentTables: dependencies.expectedCurrentTables,
          expectedCurrentColumns: dependencies.expectedCurrentColumns,
          expectedCurrentIndexes: dependencies.expectedCurrentIndexes,
          expectedCurrentConstraints: dependencies.expectedCurrentConstraints,
        },
      });
    }
    report(mode === 'initialize'
      ? 'Supabase staging baseline initialized and verified.'
      : 'Supabase staging forward migrations applied and verified.');
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' && /^[0-9A-Z]{5}$/.test(error.code)
      ? ` SQLSTATE ${error.code}.`
      : '';
    report(`${diagnostic(mode, stage)}${code}`);
    exitCode = 1;
  } finally {
    if (runtime) {
      try {
        await runtime.close();
      } catch {
        report(diagnostic(mode, 'CLEANUP_FAILED'));
        exitCode = 1;
      }
    }
  }
  return exitCode;
}

async function readJournal(path: string) {
  return JSON.parse(await readFile(path, 'utf8')) as { entries: Array<{ tag: string; when: number }> };
}

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function schemaExpectations(tables: unknown[]) {
  const tableConfigs = tables.map((table) => getTableConfig(table as Parameters<typeof getTableConfig>[0]));
  const columns: Record<string, ExpectedStagingColumn[]> = {};
  const indexes: string[] = [];
  const constraints: string[] = [];
  for (const config of tableConfigs) {
    columns[config.name] = config.columns.map((column) => ({
      name: column.name,
      type: column.getSQLType(),
      notNull: column.notNull,
      hasDefault: column.hasDefault,
    }));
    indexes.push(...config.indexes.map((index) => index.config.name).filter((name): name is string => Boolean(name)));
    constraints.push(...config.foreignKeys.map((fk) => fk.getName()));
    constraints.push(...config.checks.map((check) => check.name));
    constraints.push(...config.uniqueConstraints.map((unique) => unique.getName()).filter((name): name is string => Boolean(name)));
    constraints.push(...config.columns
      .filter((column) => column.isUnique)
      .map((column) => column.uniqueName)
      .filter((name): name is string => Boolean(name)));
    constraints.push(...config.columns.filter((column) => column.primary).map(() => `${config.name}_pkey`));
    constraints.push(...config.primaryKeys.map((pk) => pk.getName()).filter((name): name is string => Boolean(name)));
  }
  return {
    tables: tableConfigs.map((table) => table.name),
    columns,
    indexes: [...new Set(indexes)],
    constraints: [...new Set(constraints)],
  };
}

export async function loadStagingRunnerDependencies(
  open: StagingRunnerDependencies['open'],
  root = process.cwd(),
): Promise<StagingRunnerDependencies> {
  const freshJournal = await readJournal(resolve(root, 'drizzle/fresh/meta/_journal.json'));
  const normalJournal = await readJournal(resolve(root, 'drizzle/meta/_journal.json'));
  const freshJournalText = await readFile(resolve(root, 'drizzle/fresh/meta/_journal.json'), 'utf8');
  const normalJournalText = await readFile(resolve(root, 'drizzle/meta/_journal.json'), 'utf8');
  const { validateFreshBaselineHistory } = await import('./initialize-fresh-database.ts');
  validateFreshBaselineHistory(freshJournalText, normalJournalText);
  const baselineEntry = freshJournal.entries[0];
  if (!baselineEntry || freshJournal.entries.length !== 1) throw new Error('Fresh baseline journal is not the expected single entry.');
  const baselineSql = await readFile(resolve(root, `drizzle/fresh/${baselineEntry.tag}.sql`), 'utf8');
  const main = await Promise.all(normalJournal.entries.map(async (entry) => ({
    ...entry,
    hash: sha256(await readFile(resolve(root, `drizzle/${entry.tag}.sql`), 'utf8')),
  })));
  const baseline = { ...baselineEntry, hash: sha256(baselineSql) };
  const forward = main.filter((entry) => entry.when > baseline.when);
  const baselineTables = [
    schema.brands, schema.cartItems, schema.cartMergeOperations, schema.categories, schema.inventoryReservations,
    schema.orderItems, schema.orders, schema.paymentReviewCases, schema.products, schema.razorpayWebhookEvents,
    schema.reviews, schema.users, schema.wishlist,
  ];
  const baselineExpected = schemaExpectations(baselineTables);
  const currentExpected = schemaExpectations([
    ...baselineTables,
    schema.contactInquiries,
  ]);
  return {
    open,
    baseline,
    forward,
    expectedBaselineTables: baselineExpected.tables,
    expectedBaselineColumns: baselineExpected.columns,
    expectedBaselineIndexes: baselineExpected.indexes,
    expectedBaselineConstraints: baselineExpected.constraints,
    expectedCurrentTables: currentExpected.tables,
    expectedCurrentColumns: currentExpected.columns,
    expectedCurrentIndexes: currentExpected.indexes,
    expectedCurrentConstraints: currentExpected.constraints,
  };
}

export async function openPostgresRuntime(settings: StagingDatabaseSettings, readOnly = false): Promise<StagingRuntime> {
  const [{ drizzle }, pool] = await Promise.all([import('drizzle-orm/node-postgres'), createStagingPool(settings)]);
  let inspectionClient: PoolClient | undefined;
  let readOnlySession: Awaited<ReturnType<typeof openVerifiedReadOnlySession<PoolClient>>> | undefined;
  try {
    if (readOnly) {
      readOnlySession = await openVerifiedReadOnlySession(pool);
      inspectionClient = readOnlySession.client;
    } else await pool.query('SELECT 1');
  } catch (error) {
    if (!readOnly) await pool.end().catch(() => undefined);
    throw error;
  }
  const catalogConnection = inspectionClient ?? pool;

  const inspect = async (): Promise<StagingCatalogState> => {
    const identityResult = await catalogConnection.query<{
      database: string; login_user: string; user: string; current_schema: string; search_path: string; server_port: number; transaction_read_only: boolean;
    }>(`SELECT current_database() AS database, session_user AS login_user, current_user AS user, current_schema() AS current_schema,
               current_setting('search_path') AS search_path, inet_server_port() AS server_port,
               current_setting('transaction_read_only')::boolean AS transaction_read_only`);
    const identityRow = identityResult.rows[0];
    if (!identityRow) throw new Error('identity check failed');

    const objectInventoryQuery = `
      SELECT c.relname AS name, 'relation' AS kind,
        EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e') AS "extensionOwned"
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v','m','S','f','i','I')
      UNION ALL
      SELECT p.proname AS name, 'routine' AS kind,
        EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e') AS "extensionOwned"
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
      UNION ALL
      SELECT t.typname AS name, 'type' AS kind,
        EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_type'::regclass AND d.objid = t.oid AND d.deptype = 'e') AS "extensionOwned"
      FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = 'public' AND t.typtype <> 'p'
        AND NOT (t.typelem <> 0 AND t.typcategory = 'A')
      UNION ALL
      SELECT o.oprname AS name, 'operator' AS kind,
        EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_operator'::regclass AND d.objid = o.oid AND d.deptype = 'e') AS "extensionOwned"
      FROM pg_operator o JOIN pg_namespace n ON n.oid = o.oprnamespace WHERE n.nspname = 'public'
      UNION ALL
      SELECT o.opcname AS name, 'operator_class' AS kind,
        EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_opclass'::regclass AND d.objid = o.oid AND d.deptype = 'e') AS "extensionOwned"
      FROM pg_opclass o JOIN pg_namespace n ON n.oid = o.opcnamespace WHERE n.nspname = 'public'
      UNION ALL
      SELECT o.opfname AS name, 'operator_family' AS kind,
        EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_opfamily'::regclass AND d.objid = o.oid AND d.deptype = 'e') AS "extensionOwned"
      FROM pg_opfamily o JOIN pg_namespace n ON n.oid = o.opfnamespace WHERE n.nspname = 'public'
      UNION ALL
      SELECT c.collname AS name, 'collation' AS kind,
        EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_collation'::regclass AND d.objid = c.oid AND d.deptype = 'e') AS "extensionOwned"
      FROM pg_collation c JOIN pg_namespace n ON n.oid = c.collnamespace WHERE n.nspname = 'public'
      UNION ALL
      SELECT c.conname AS name, 'conversion' AS kind,
        EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_conversion'::regclass AND d.objid = c.oid AND d.deptype = 'e') AS "extensionOwned"
      FROM pg_conversion c JOIN pg_namespace n ON n.oid = c.connamespace WHERE n.nspname = 'public'
      UNION ALL
      SELECT c.cfgname AS name, 'text_search_config' AS kind,
        EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_ts_config'::regclass AND d.objid = c.oid AND d.deptype = 'e') AS "extensionOwned"
      FROM pg_ts_config c JOIN pg_namespace n ON n.oid = c.cfgnamespace WHERE n.nspname = 'public'
      UNION ALL
      SELECT d.dictname AS name, 'text_search_dictionary' AS kind,
        EXISTS (SELECT 1 FROM pg_depend dep WHERE dep.classid = 'pg_ts_dict'::regclass AND dep.objid = d.oid AND dep.deptype = 'e') AS "extensionOwned"
      FROM pg_ts_dict d JOIN pg_namespace n ON n.oid = d.dictnamespace WHERE n.nspname = 'public'
      UNION ALL
      SELECT p.prsname AS name, 'text_search_parser' AS kind,
        EXISTS (SELECT 1 FROM pg_depend dep WHERE dep.classid = 'pg_ts_parser'::regclass AND dep.objid = p.oid AND dep.deptype = 'e') AS "extensionOwned"
      FROM pg_ts_parser p JOIN pg_namespace n ON n.oid = p.prsnamespace WHERE n.nspname = 'public'
      UNION ALL
      SELECT t.tmplname AS name, 'text_search_template' AS kind,
        EXISTS (SELECT 1 FROM pg_depend dep WHERE dep.classid = 'pg_ts_template'::regclass AND dep.objid = t.oid AND dep.deptype = 'e') AS "extensionOwned"
      FROM pg_ts_template t JOIN pg_namespace n ON n.oid = t.tmplnamespace WHERE n.nspname = 'public'
      UNION ALL
      SELECT s.stxname AS name, 'statistics' AS kind,
        EXISTS (SELECT 1 FROM pg_depend dep WHERE dep.classid = 'pg_statistic_ext'::regclass AND dep.objid = s.oid AND dep.deptype = 'e') AS "extensionOwned"
      FROM pg_statistic_ext s JOIN pg_namespace n ON n.oid = s.stxnamespace WHERE n.nspname = 'public'
    `;
    const publicObjectResult = await catalogConnection.query<{ name: string; kind: string; extensionOwned: boolean }>(objectInventoryQuery);
    const drizzleObjectResult = await catalogConnection.query<{ name: string; kind: string; extensionOwned: boolean }>(
      objectInventoryQuery.replaceAll("n.nspname = 'public'", "n.nspname = 'drizzle'"),
    );
    const automaticRlsFunctionResult = await catalogConnection.query<StagingCatalogState['supabaseAutomaticRlsFunctions'][number]>(automaticRlsCatalogSql);
    const eventTriggerResult = await catalogConnection.query<StagingCatalogState['eventTriggers'][number]>(eventTriggerCatalogSql);
    const drizzleSchema = await catalogConnection.query<{ exists: boolean }>(`SELECT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname = 'drizzle') AS exists`);
    const schemaRows = await catalogConnection.query<{ schema_name: string }>(`
      SELECT nspname AS schema_name FROM pg_namespace
      WHERE nspname = ANY($1::text[]) ORDER BY nspname
    `, [['public', 'auth', 'storage', 'drizzle', 'supabase_migrations']]);
    const drizzleRelations = await catalogConnection.query<{ relname: string }>(`
      SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'drizzle' AND c.relkind IN ('r','p','v','m','S','f') ORDER BY c.relname
    `);
    const historyExists = await catalogConnection.query<{ exists: boolean }>(`SELECT to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS exists`);
    let migrationHistory: StagingCatalogState['migrationHistory'] = [];
    if (historyExists.rows[0]?.exists) {
      const rows = await catalogConnection.query<{ hash: string; created_at: string }>(`SELECT hash, created_at::text AS created_at FROM drizzle.__drizzle_migrations ORDER BY created_at, id`);
      migrationHistory = rows.rows.map((row) => ({ hash: row.hash, createdAt: Number(row.created_at) }));
    }
    const supabaseSchema = await catalogConnection.query<{ exists: boolean }>(`SELECT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname = 'supabase_migrations') AS exists`);
    const dataApiRoles = await catalogConnection.query<{ rolname: string }>(`SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated') ORDER BY rolname`);
    const dataApiRoleAudit = await catalogConnection.query<NonNullable<StagingCatalogState['dataApiRoleAudit']>[number]>(`
      SELECT r.rolname AS role, r.rolsuper AS superuser, r.rolbypassrls AS "bypassRls",
             pg_has_role(r.rolname, $1, 'USAGE') AS "inheritsRuntimeOwner",
             pg_has_role(r.rolname, $1, 'MEMBER') AS "memberOfRuntimeOwner",
             has_schema_privilege(r.rolname, 'public', 'USAGE') AS "publicUsage",
             has_schema_privilege(r.rolname, 'public', 'CREATE') AS "publicCreate",
             CASE WHEN EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'auth') THEN has_schema_privilege(r.rolname, 'auth', 'USAGE') ELSE false END AS "authUsage",
             CASE WHEN EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'auth') THEN has_schema_privilege(r.rolname, 'auth', 'CREATE') ELSE false END AS "authCreate",
             CASE WHEN EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'storage') THEN has_schema_privilege(r.rolname, 'storage', 'USAGE') ELSE false END AS "storageUsage",
             CASE WHEN EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'storage') THEN has_schema_privilege(r.rolname, 'storage', 'CREATE') ELSE false END AS "storageCreate",
             CASE WHEN EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'drizzle')
               THEN has_schema_privilege(r.rolname, 'drizzle', 'USAGE') ELSE false END AS "drizzleUsage",
             CASE WHEN EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'drizzle')
               THEN has_schema_privilege(r.rolname, 'drizzle', 'CREATE') ELSE false END AS "drizzleCreate",
             ARRAY(
               SELECT format('%s:%s', app.table_name, privilege.privilege)
               FROM unnest($2::text[]) AS app(table_name)
               CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']::text[]) AS privilege(privilege)
               WHERE to_regclass(format('public.%I', app.table_name)) IS NOT NULL
                 AND has_table_privilege(r.rolname, format('public.%I', app.table_name), privilege.privilege)
               ORDER BY app.table_name, privilege.privilege
             ) AS "applicationTablePrivileges",
             ARRAY(
               SELECT format('%s:%s', app.table_name, privilege.privilege)
               FROM unnest($2::text[]) AS app(table_name)
               CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','REFERENCES']::text[]) AS privilege(privilege)
               WHERE to_regclass(format('public.%I', app.table_name)) IS NOT NULL
                 AND has_any_column_privilege(r.rolname, format('public.%I', app.table_name), privilege.privilege)
               ORDER BY app.table_name, privilege.privilege
             ) AS "applicationColumnPrivileges",
             ARRAY(
               SELECT format('%s:%s', seq.relname, privilege.privilege)
               FROM pg_class seq
               JOIN pg_namespace seqns ON seqns.oid = seq.relnamespace AND seqns.nspname = 'public'
               JOIN pg_depend dep ON dep.classid = 'pg_class'::regclass AND dep.objid = seq.oid
                 AND dep.refclassid = 'pg_class'::regclass AND dep.deptype IN ('a','i')
               JOIN pg_class app ON app.oid = dep.refobjid AND app.relname = ANY($2::text[])
               CROSS JOIN unnest(ARRAY['USAGE','SELECT','UPDATE']::text[]) AS privilege(privilege)
               WHERE seq.relkind = 'S' AND has_sequence_privilege(r.oid, seq.oid, privilege.privilege)
               ORDER BY seq.relname, privilege.privilege
             ) AS "applicationSequencePrivileges",
             ARRAY(
               SELECT format('%s:%s:%s', c.relname, CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE grantee.rolname END, acl.privilege_type)
               FROM unnest($2::text[]) AS app(table_name)
               JOIN pg_class c ON c.relname = app.table_name AND c.relkind IN ('r','p')
               JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
               CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) acl
               LEFT JOIN pg_roles grantee ON grantee.oid = acl.grantee
               WHERE acl.grantee = 0 OR acl.grantee = r.oid
               ORDER BY c.relname, CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE grantee.rolname END, acl.privilege_type
             ) AS "directApplicationTableAcl",
             ARRAY(
               SELECT format('%s.%s:%s:%s', c.relname, a.attname, CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE grantee.rolname END, acl.privilege_type)
               FROM unnest($2::text[]) AS app(table_name)
               JOIN pg_class c ON c.relname = app.table_name AND c.relkind IN ('r','p')
               JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
               JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped AND a.attacl IS NOT NULL
               CROSS JOIN LATERAL aclexplode(a.attacl) acl
               LEFT JOIN pg_roles grantee ON grantee.oid = acl.grantee
               WHERE acl.grantee = 0 OR acl.grantee = r.oid
               ORDER BY c.relname, a.attname, CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE grantee.rolname END, acl.privilege_type
             ) AS "directApplicationColumnAcl",
             ARRAY(
               SELECT format('%s:%s:%s', seq.relname, CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE grantee.rolname END, acl.privilege_type)
               FROM pg_class seq
               JOIN pg_depend dep ON dep.classid = 'pg_class'::regclass AND dep.objid = seq.oid
                 AND dep.refclassid = 'pg_class'::regclass AND dep.deptype IN ('a','i')
               JOIN pg_class app ON app.oid = dep.refobjid AND app.relname = ANY($2::text[])
               JOIN pg_namespace n ON n.oid = seq.relnamespace AND n.nspname = 'public'
               CROSS JOIN LATERAL aclexplode(COALESCE(seq.relacl, acldefault('S', seq.relowner))) acl
               LEFT JOIN pg_roles grantee ON grantee.oid = acl.grantee
               WHERE seq.relkind = 'S' AND (acl.grantee = 0 OR acl.grantee = r.oid)
               ORDER BY seq.relname, CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE grantee.rolname END, acl.privilege_type
             ) AS "directApplicationSequenceAcl",
             ARRAY(
               SELECT format('%s:%s', CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE grantee.rolname END, a.privilege_type)
               FROM pg_default_acl d CROSS JOIN LATERAL aclexplode(d.defaclacl) a
               LEFT JOIN pg_roles grantee ON grantee.oid = a.grantee
               WHERE d.defaclrole = (SELECT oid FROM pg_roles WHERE rolname = $1)
                 AND d.defaclnamespace = 0 AND d.defaclobjtype = 'r'
                 AND (CASE WHEN a.grantee = 0 THEN true ELSE pg_has_role(r.oid, a.grantee, 'USAGE') END)
               ORDER BY 1
             ) AS "globalDefaultTablePrivileges",
             ARRAY(
               SELECT format('%s:%s', CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE grantee.rolname END, a.privilege_type)
               FROM pg_default_acl d CROSS JOIN LATERAL aclexplode(d.defaclacl) a
               LEFT JOIN pg_roles grantee ON grantee.oid = a.grantee
               WHERE d.defaclnamespace = 0 AND d.defaclrole = (SELECT oid FROM pg_roles WHERE rolname = $1)
                 AND d.defaclobjtype = 'S' AND (CASE WHEN a.grantee = 0 THEN true ELSE pg_has_role(r.oid, a.grantee, 'USAGE') END)
               ORDER BY 1
             ) AS "globalDefaultSequencePrivileges",
             ARRAY(
               SELECT format('%s:%s', CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE grantee.rolname END, a.privilege_type)
               FROM pg_default_acl d CROSS JOIN LATERAL aclexplode(d.defaclacl) a
               LEFT JOIN pg_roles grantee ON grantee.oid = a.grantee
               WHERE d.defaclnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
                 AND d.defaclrole = (SELECT oid FROM pg_roles WHERE rolname = $1)
                 AND d.defaclobjtype = 'r' AND (CASE WHEN a.grantee = 0 THEN true ELSE pg_has_role(r.oid, a.grantee, 'USAGE') END)
               ORDER BY 1
             ) AS "schemaDefaultTablePrivileges",
             ARRAY(
               SELECT format('%s:%s', CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE grantee.rolname END, a.privilege_type)
               FROM pg_default_acl d CROSS JOIN LATERAL aclexplode(d.defaclacl) a
               LEFT JOIN pg_roles grantee ON grantee.oid = a.grantee
               WHERE d.defaclnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
                 AND d.defaclrole = (SELECT oid FROM pg_roles WHERE rolname = $1)
                 AND d.defaclobjtype = 'S' AND (CASE WHEN a.grantee = 0 THEN true ELSE pg_has_role(r.oid, a.grantee, 'USAGE') END)
               ORDER BY 1
             ) AS "schemaDefaultSequencePrivileges"
      FROM pg_roles r WHERE r.rolname IN ('anon', 'authenticated') ORDER BY r.rolname
    `, [settings.runtimeUser, declaredApplicationTableNames]);
    const defaultAclInventory = await catalogConnection.query<NonNullable<StagingCatalogState['defaultAclInventory']>[number]>(defaultAclInventorySql);
    let supabaseMigrationRecords = 0;
    let supabaseMigrationEntries: string[] = [];
    if (supabaseSchema.rows[0]?.exists) {
      const tableExists = await catalogConnection.query<{ exists: boolean }>(`SELECT to_regclass('supabase_migrations.schema_migrations') IS NOT NULL AS exists`);
      if (tableExists.rows[0]?.exists) {
        const count = await catalogConnection.query<{ count: string }>(`SELECT count(*)::text AS count FROM supabase_migrations.schema_migrations`);
        supabaseMigrationRecords = Number(count.rows[0]?.count ?? '0');
        const entries = await catalogConnection.query<{ entry: string }>(`
          SELECT COALESCE(to_jsonb(m)->>'version', to_jsonb(m)->>'name', to_jsonb(m)->>'id', '<unidentified>') AS entry
          FROM supabase_migrations.schema_migrations m ORDER BY 1
        `);
        supabaseMigrationEntries = entries.rows.map((row) => row.entry);
      }
    }
    const tableRows = await catalogConnection.query<{ tablename: string }>(`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename
    `);
    const rlsRows = await catalogConnection.query<{ tablename: string }>(`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND rowsecurity
        AND tablename = ANY($1::text[]) ORDER BY tablename
    `, [declaredApplicationTableNames]);
    const policyRows = await catalogConnection.query<{ policyname: string }>(`
      SELECT policyname FROM pg_policies WHERE schemaname = 'public'
        AND tablename = ANY($1::text[])
    `, [declaredApplicationTableNames]);
    const columnRows = await catalogConnection.query<{ table_name: string; column_name: string; sql_type: string; not_null: boolean; has_default: boolean; default_expression: string | null }>(`
      SELECT c.table_name, c.column_name, format_type(a.atttypid, a.atttypmod) AS sql_type,
             a.attnotnull AS not_null, (d.adbin IS NOT NULL) AS has_default,
             pg_get_expr(d.adbin, d.adrelid) AS default_expression
      FROM information_schema.columns c
      JOIN pg_namespace n ON n.nspname = c.table_schema
      JOIN pg_class t ON t.relnamespace = n.oid AND t.relname = c.table_name
      JOIN pg_attribute a ON a.attrelid = t.oid AND a.attname = c.column_name AND a.attnum > 0 AND NOT a.attisdropped
      LEFT JOIN pg_attrdef d ON d.adrelid = t.oid AND d.adnum = a.attnum
      WHERE c.table_schema = 'public' ORDER BY c.table_name, c.ordinal_position
    `);
    const indexRows = await catalogConnection.query<{ indexname: string }>(`SELECT indexname FROM pg_indexes WHERE schemaname = 'public'`);
    const constraintRows = await catalogConnection.query<{ conname: string }>(`
      SELECT con.conname FROM pg_constraint con JOIN pg_class rel ON rel.oid = con.conrelid
      JOIN pg_namespace n ON n.oid = rel.relnamespace WHERE n.nspname = 'public' AND rel.relname = ANY($1::text[])
    `, [declaredApplicationTableNames]);
    const contactCheck = await catalogConnection.query<{ definition: string }>(`
      SELECT pg_get_constraintdef(con.oid) AS definition FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid JOIN pg_namespace n ON n.oid = rel.relnamespace
      WHERE n.nspname = 'public' AND rel.relname = 'contact_inquiries' AND con.conname = 'contact_inquiries_status_valid'
    `);
    const contactIndex = await catalogConnection.query<{ indexdef: string }>(`
      SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'contact_inquiries'
        AND indexname = 'contact_inquiries_created_at_idx'
    `);
    const columns: StagingCatalogState['applicationColumns'] = {};
    const defaults: StagingCatalogState['applicationColumnDefaults'] = {};
    for (const row of columnRows.rows) {
      (columns[row.table_name] ??= []).push({
        name: row.column_name,
        type: row.sql_type,
        notNull: row.not_null,
        hasDefault: row.has_default,
      });
      (defaults[row.table_name] ??= {})[row.column_name] = row.default_expression;
    }
    return attachDataApiRoleAudit({
      identity: {
        database: identityRow.database,
        loginUser: identityRow.login_user,
        user: identityRow.user,
        currentSchema: identityRow.current_schema,
        searchPath: identityRow.search_path,
        serverPort: Number(identityRow.server_port),
        transactionReadOnly: identityRow.transaction_read_only,
      },
      schemas: {
        public: schemaRows.rows.some((row) => row.schema_name === 'public'),
        auth: schemaRows.rows.some((row) => row.schema_name === 'auth'),
        storage: schemaRows.rows.some((row) => row.schema_name === 'storage'),
        drizzle: schemaRows.rows.some((row) => row.schema_name === 'drizzle'),
        supabaseMigrations: schemaRows.rows.some((row) => row.schema_name === 'supabase_migrations'),
      },
      publicObjects: publicObjectResult.rows,
      drizzleObjects: drizzleObjectResult.rows,
      supabaseAutomaticRlsFunctions: automaticRlsFunctionResult.rows,
      eventTriggers: eventTriggerResult.rows,
      drizzleSchemaExists: Boolean(drizzleSchema.rows[0]?.exists),
      drizzleRelations: drizzleRelations.rows.map((row) => row.relname),
      migrationHistory,
      supabaseMigrationSchemaExists: Boolean(supabaseSchema.rows[0]?.exists),
      supabaseMigrationRecords,
      supabaseMigrationEntries,
      dataApiRoles: dataApiRoles.rows.map((row) => row.rolname),
      defaultAclInventory: defaultAclInventory.rows,
      applicationTables: tableRows.rows.map((row) => row.tablename),
      applicationColumns: columns,
      applicationIndexes: indexRows.rows.map((row) => row.indexname),
      applicationConstraints: constraintRows.rows.map((row) => row.conname),
      applicationColumnDefaults: defaults,
      applicationRlsTables: rlsRows.rows.map((row) => row.tablename),
      applicationPolicies: policyRows.rows.map((row) => row.policyname),
      contactInquiryStatusConstraint: contactCheck.rows[0]?.definition,
      contactInquiryCreatedAtIndex: contactIndex.rows[0]?.indexdef,
    }, dataApiRoleAudit.rows);
  };

  return {
    inspect,
    applyBaseline: async () => {
      const { migrate } = await import('drizzle-orm/node-postgres/migrator');
      await migrate(drizzle(pool), {
        migrationsFolder: resolve(process.cwd(), 'drizzle/fresh'),
        migrationsSchema: 'drizzle',
        migrationsTable: '__drizzle_migrations',
      });
    },
    applyForwardMigrations: async () => {
      const { migrate } = await import('drizzle-orm/node-postgres/migrator');
      await migrate(drizzle(pool), {
        migrationsFolder: resolve(process.cwd(), 'drizzle'),
        migrationsSchema: 'drizzle',
        migrationsTable: '__drizzle_migrations',
      });
    },
    close: async () => {
      if (readOnlySession) return readOnlySession.close();
      let closeError: unknown;
      try { await pool.end(); } catch (error) { closeError ??= error; }
      if (closeError) throw closeError;
    },
  };
}

export async function openPostgresReadOnlyRuntime(settings: StagingDatabaseSettings): Promise<StagingPreflightRuntime> {
  const runtime = await openPostgresRuntime(settings, true);
  return { inspect: runtime.inspect, close: runtime.close };
}

export async function openPostgresDefaultPrivilegeConnection(settings: StagingDatabaseSettings) {
  const pool = await createStagingPool(settings);
  let client: PoolClient | undefined;
  try {
    client = await pool.connect();
  } catch (error) {
    await pool.end().catch(() => undefined);
    throw error;
  }
  let closed = false;
  return {
    client,
    close: async () => {
      if (closed) return;
      closed = true;
      let closeError: unknown;
      try { client!.release(); } catch (error) { closeError = error; }
      try { await pool.end(); } catch (error) { closeError ??= error; }
      if (closeError) throw closeError;
    },
  };
}

export async function runDefaultPrivilegePreparationCli(args = process.argv.slice(2), env = process.env) {
  return runSupabaseStagingDefaultPrivilegePreparation(args, env, {
    open: openPostgresDefaultPrivilegeConnection,
    applicationTableNames: declaredApplicationTableNames,
  }, console.log);
}

export async function runPreflightCli(args = process.argv.slice(2), env = process.env) {
  try {
    const dependencies = await loadStagingRunnerDependencies(openPostgresRuntime);
    return await runSupabaseStagingPreflight(args, env, {
      ...dependencies,
      open: openPostgresReadOnlyRuntime,
    }, console.log);
  } catch {
    console.log(diagnostic('preflight', 'STATIC_CONFIGURATION_INVALID'));
    return 2;
  }
}

export async function runCli(mode: StagingMode, args = process.argv.slice(2), env = process.env) {
  try {
    const dependencies = await loadStagingRunnerDependencies(openPostgresRuntime);
    return await runSupabaseStagingCommand(mode, args, env, dependencies, console.log);
  } catch {
    console.log(diagnostic(mode, 'STATIC_CONFIGURATION_INVALID'));
    return 2;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const mode: StagingMode = process.argv[1].includes('migrate-supabase-staging') ? 'migrate' : 'initialize';
  process.exitCode = await runCli(mode);
}
