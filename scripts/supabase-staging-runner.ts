import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getTableConfig } from 'drizzle-orm/pg-core';
import * as schema from '../src/db/schema.ts';
import {
  assertStagingBaselineState,
  assertStagingIdentity,
  assertStagingInitializationState,
  assertStagingMigrationHistory,
  normalizeStagingSqlType,
  resolveSupabaseStagingSettings,
  type MigrationJournalEntry,
  type ExpectedStagingColumn,
  type StagingCatalogState,
  type StagingDatabaseSettings,
} from '../src/db/supabase-staging-guard.ts';

export type StagingMode = 'initialize' | 'migrate';

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

const declaredApplicationTables = [
  schema.brands, schema.cartItems, schema.cartMergeOperations, schema.categories, schema.inventoryReservations,
  schema.orderItems, schema.orders, schema.paymentReviewCases, schema.products, schema.razorpayWebhookEvents,
  schema.reviews, schema.users, schema.wishlist, schema.contactInquiries,
];
const declaredApplicationTableNames = declaredApplicationTables.map((table) => getTableConfig(table).name);

function diagnostic(mode: StagingMode, stage: string) {
  return `[SUPABASE_STAGING_${stage}] ${mode === 'initialize' ? 'Staging baseline initialization' : 'Staging migration'} ${stage.toLowerCase().replaceAll('_', ' ')}; no credentials or database details are included.`;
}

function assertSchemaState(state: StagingCatalogState, expected: Pick<StagingRunnerDependencies,
  'expectedBaselineTables' | 'expectedBaselineColumns' | 'expectedBaselineIndexes' | 'expectedBaselineConstraints'
> & { contactExpected: boolean; current?: Pick<StagingRunnerDependencies, 'expectedCurrentTables' | 'expectedCurrentColumns' | 'expectedCurrentIndexes' | 'expectedCurrentConstraints'> }) {
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
  if (state.publicObjects.some((object) => !object.extensionOwned && (object.kind !== 'relation' || !permittedObjects.has(object.name)))) {
    throw new Error('public schema contains unexpected objects');
  }
  if (state.applicationRlsTables.length || state.applicationPolicies.length) {
    throw new Error('application RLS or policies differ from the reviewed baseline and require manual review');
  }
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
    if (dependencies.forward.some((entry, index) => entry.when <= dependencies.baseline.when || (index > 0 && entry.when <= dependencies.forward[index - 1]!.when))) throw new Error('invalid migration ordering');
  } catch {
    report(diagnostic(mode, 'CONFIGURATION_INVALID'));
    return 2;
  }

  return runSupabaseStagingOperations(mode, settings, dependencies, report);
}

/**
 * Runs already-resolved database operations. Production CLIs call this only
 * through runSupabaseStagingCommand, which validates all target safeguards
 * first. Local integration tests may inject an explicitly verified loopback
 * target without making that path reachable from either staging CLI.
 */
export async function runSupabaseStagingOperations(
  mode: StagingMode,
  settings: StagingDatabaseSettings,
  dependencies: StagingRunnerDependencies,
  report: (line: string) => void = () => undefined,
): Promise<number> {
  if (!dependencies.baseline.hash || dependencies.baseline.tag !== '0000_application-baseline'
    || dependencies.forward[0]?.tag !== '0006_contact-inquiries'
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
    stage = 'PREFLIGHT_FAILED';
    if (mode === 'initialize') {
      assertStagingInitializationState(before, [
        ...dependencies.expectedBaselineTables,
        ...dependencies.expectedBaselineTables.map((table) => `${table}_id_seq`),
        ...dependencies.expectedBaselineTables.map((table) => `${table}_pkey`),
        ...dependencies.expectedBaselineIndexes,
        ...dependencies.expectedBaselineConstraints,
      ]);
      stage = 'BASELINE_FAILED';
      await runtime.applyBaseline();
      stage = 'BASELINE_VERIFY_FAILED';
      const after = await runtime.inspect();
      assertStagingIdentity(after.identity, settings);
      assertStagingBaselineState(after, {
        baseline: dependencies.baseline,
        baselineApplicationTables: dependencies.expectedBaselineTables,
        baselineColumns: dependencies.expectedBaselineColumns,
        baselineIndexes: dependencies.expectedBaselineIndexes,
        baselineConstraints: dependencies.expectedBaselineConstraints,
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
      });
    } else {
      if (before.supabaseMigrationSchemaExists || before.supabaseMigrationRecords !== 0) {
        throw new Error('Supabase CLI migration history exists; reconcile migration systems before continuing.');
      }
      assertStagingMigrationHistory(before.migrationHistory, dependencies.baseline, dependencies.forward, true);
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

export async function openPostgresRuntime(settings: StagingDatabaseSettings): Promise<StagingRuntime> {
  const [{ Pool }, { drizzle }] = await Promise.all([
    import('pg'),
    import('drizzle-orm/node-postgres'),
  ]);
  const pool = new Pool({
    host: settings.host,
    port: settings.port,
    database: settings.database,
    user: settings.user,
    password: settings.password,
    ssl: settings.ssl,
    max: 1,
    connectionTimeoutMillis: 5000,
    statement_timeout: 8000,
    options: '-c search_path=public',
    application_name: 'flyrc-supabase-staging-schema-task',
  });
  try {
    await pool.query('SELECT 1');
  } catch (error) {
    await pool.end().catch(() => undefined);
    throw error;
  }

  const inspect = async (): Promise<StagingCatalogState> => {
    const identityResult = await pool.query<{
      database: string; user: string; current_schema: string; search_path: string; server_port: number;
    }>(`SELECT current_database() AS database, current_user AS user, current_schema() AS current_schema,
               current_setting('search_path') AS search_path, inet_server_port() AS server_port`);
    const identityRow = identityResult.rows[0];
    if (!identityRow) throw new Error('identity check failed');

    const publicObjectResult = await pool.query<{ name: string; kind: string; extensionOwned: boolean }>(`
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
      WHERE n.nspname = 'public' AND t.typrelid = 0 AND t.typtype IN ('c','d','e','r','m')
      UNION ALL
      SELECT o.oprname AS name, 'operator' AS kind,
        EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_operator'::regclass AND d.objid = o.oid AND d.deptype = 'e') AS "extensionOwned"
      FROM pg_operator o JOIN pg_namespace n ON n.oid = o.oprnamespace WHERE n.nspname = 'public'
      UNION ALL
      SELECT o.opcname AS name, 'operator_class' AS kind,
        EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_opclass'::regclass AND d.objid = o.oid AND d.deptype = 'e') AS "extensionOwned"
      FROM pg_opclass o JOIN pg_namespace n ON n.oid = o.opcnamespace WHERE n.nspname = 'public'
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
    `);
    const drizzleSchema = await pool.query<{ exists: boolean }>(`SELECT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname = 'drizzle') AS exists`);
    const drizzleRelations = await pool.query<{ relname: string }>(`
      SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'drizzle' AND c.relkind IN ('r','p','v','m','S','f') ORDER BY c.relname
    `);
    const historyExists = await pool.query<{ exists: boolean }>(`SELECT to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS exists`);
    let migrationHistory: StagingCatalogState['migrationHistory'] = [];
    if (historyExists.rows[0]?.exists) {
      const rows = await pool.query<{ hash: string; created_at: string }>(`SELECT hash, created_at::text AS created_at FROM drizzle.__drizzle_migrations ORDER BY created_at, id`);
      migrationHistory = rows.rows.map((row) => ({ hash: row.hash, createdAt: Number(row.created_at) }));
    }
    const supabaseSchema = await pool.query<{ exists: boolean }>(`SELECT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname = 'supabase_migrations') AS exists`);
    let supabaseMigrationRecords = 0;
    if (supabaseSchema.rows[0]?.exists) {
      const tableExists = await pool.query<{ exists: boolean }>(`SELECT to_regclass('supabase_migrations.schema_migrations') IS NOT NULL AS exists`);
      if (tableExists.rows[0]?.exists) {
        const count = await pool.query<{ count: string }>(`SELECT count(*)::text AS count FROM supabase_migrations.schema_migrations`);
        supabaseMigrationRecords = Number(count.rows[0]?.count ?? '0');
      }
    }
    const tableRows = await pool.query<{ tablename: string }>(`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename
    `);
    const rlsRows = await pool.query<{ tablename: string }>(`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND rowsecurity
        AND tablename = ANY($1::text[]) ORDER BY tablename
    `, [declaredApplicationTableNames]);
    const policyRows = await pool.query<{ policyname: string }>(`
      SELECT policyname FROM pg_policies WHERE schemaname = 'public'
        AND tablename = ANY($1::text[])
    `, [declaredApplicationTableNames]);
    const columnRows = await pool.query<{ table_name: string; column_name: string; sql_type: string; not_null: boolean; has_default: boolean; default_expression: string | null }>(`
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
    const indexRows = await pool.query<{ indexname: string }>(`SELECT indexname FROM pg_indexes WHERE schemaname = 'public'`);
    const constraintRows = await pool.query<{ conname: string }>(`
      SELECT con.conname FROM pg_constraint con JOIN pg_class rel ON rel.oid = con.conrelid
      JOIN pg_namespace n ON n.oid = rel.relnamespace WHERE n.nspname = 'public' AND rel.relname = ANY($1::text[])
    `, [declaredApplicationTableNames]);
    const contactCheck = await pool.query<{ definition: string }>(`
      SELECT pg_get_constraintdef(con.oid) AS definition FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid JOIN pg_namespace n ON n.oid = rel.relnamespace
      WHERE n.nspname = 'public' AND rel.relname = 'contact_inquiries' AND con.conname = 'contact_inquiries_status_valid'
    `);
    const contactIndex = await pool.query<{ indexdef: string }>(`
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
    return {
      identity: {
        database: identityRow.database,
        user: identityRow.user,
        currentSchema: identityRow.current_schema,
        searchPath: identityRow.search_path,
        serverPort: Number(identityRow.server_port),
      },
      publicObjects: publicObjectResult.rows,
      drizzleSchemaExists: Boolean(drizzleSchema.rows[0]?.exists),
      drizzleRelations: drizzleRelations.rows.map((row) => row.relname),
      migrationHistory,
      supabaseMigrationSchemaExists: Boolean(supabaseSchema.rows[0]?.exists),
      supabaseMigrationRecords,
      applicationTables: tableRows.rows.map((row) => row.tablename),
      applicationColumns: columns,
      applicationIndexes: indexRows.rows.map((row) => row.indexname),
      applicationConstraints: constraintRows.rows.map((row) => row.conname),
      applicationColumnDefaults: defaults,
      applicationRlsTables: rlsRows.rows.map((row) => row.tablename),
      applicationPolicies: policyRows.rows.map((row) => row.policyname),
      contactInquiryStatusConstraint: contactCheck.rows[0]?.definition,
      contactInquiryCreatedAtIndex: contactIndex.rows[0]?.indexdef,
    };
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
    close: async () => { await pool.end(); },
  };
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
