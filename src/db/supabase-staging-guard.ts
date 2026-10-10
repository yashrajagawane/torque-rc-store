import { isIP } from 'node:net';
import { isAbsolute } from 'node:path';

const confirmation = 'I_CONFIRM_NEW_SUPABASE_STAGING_SCHEMA';
const migrationConfirmation = 'I_CONFIRM_SUPABASE_STAGING_MIGRATION';
const noProductionConfirmation = 'I_CONFIRM_NO_PRODUCTION_SUPABASE_PROJECT';

export type StagingDatabaseSettings = {
  host: string;
  port: number;
  database: string;
  user: string;
  effectiveUser: string;
  runtimeUser: string;
  password: string;
  caFilePath?: string;
  projectRef: string;
  connectionMode: 'direct' | 'shared-pooler';
  schema: 'public';
  ssl: boolean;
  fingerprint: string;
  /** Required for guarded Supabase CLI targets; local injected tests may explicitly model its absence. */
  automaticRlsRequired: boolean;
};
export type StagingIdentityProbeSettings = Omit<StagingDatabaseSettings, 'effectiveUser' | 'runtimeUser'>;

export type StagingCatalogState = {
  identity: { database: string; loginUser: string; user: string; currentSchema: string; searchPath: string; serverPort: number; transactionReadOnly?: boolean };
  schemas: { public: boolean; auth: boolean; storage: boolean; drizzle: boolean; supabaseMigrations: boolean };
  publicObjects: Array<{ name: string; kind: string; extensionOwned: boolean }>;
  drizzleObjects: Array<{ name: string; kind: string; extensionOwned: boolean }>;
  supabaseAutomaticRlsFunctions: Array<{
    schema: string; name: string; argumentCount: number; identityArguments: string; owner: string;
    language: string; returnType: string; securityDefiner: boolean; strict: boolean; volatility: string;
    configuration: string[] | null; sourceLength: number; sourceMd5: string;
  }>;
  eventTriggers: Array<{
    name: string; owner: string; enabled: string; event: string; tags: string[] | null;
    handlerSchema: string; handlerName: string; handlerArgumentCount: number;
  }>;
  drizzleSchemaExists: boolean;
  drizzleRelations: string[];
  migrationHistory: Array<{ hash: string; createdAt: number }>;
  supabaseMigrationSchemaExists: boolean;
  supabaseMigrationRecords: number;
  supabaseMigrationEntries?: string[];
  dataApiRoles: string[];
  dataApiRoleAudit?: Array<{
    role: string; superuser: boolean; bypassRls: boolean; inheritsRuntimeOwner: boolean;
    publicUsage: boolean; publicCreate: boolean; authUsage: boolean; authCreate: boolean;
    storageUsage: boolean; storageCreate: boolean; drizzleUsage: boolean; drizzleCreate: boolean;
    applicationTablePrivileges: string[]; applicationSequencePrivileges: string[];
  }>;
  applicationTables: string[];
  applicationColumns: Record<string, Array<{ name: string; type: string; notNull: boolean; hasDefault: boolean }>>;
  applicationIndexes: string[];
  applicationConstraints: string[];
  applicationColumnDefaults: Record<string, Record<string, string | null>>;
  applicationRlsTables: string[];
  applicationPolicies: string[];
  contactInquiryStatusConstraint?: string;
  contactInquiryCreatedAtIndex?: string;
};

export type MigrationJournalEntry = { tag: string; when: number; hash: string };
export type ExpectedStagingColumn = { name: string; type: string; notNull: boolean; hasDefault: boolean };

const expectedAutomaticRlsFunction = {
  schema: 'public', name: 'rls_auto_enable', argumentCount: 0, identityArguments: '', owner: 'postgres',
  language: 'plpgsql', returnType: 'event_trigger', securityDefiner: true, strict: false, volatility: 'v',
  configuration: ['search_path=pg_catalog'], sourceLength: 1055, sourceMd5: 'c44fb229ea8a6b0afd04a0a33261c16c',
} as const;
const expectedAutomaticRlsEventTrigger = {
  name: 'ensure_rls', owner: 'postgres', enabled: 'O', event: 'ddl_command_end',
  tags: ['CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO'],
  handlerSchema: 'public', handlerName: 'rls_auto_enable', handlerArgumentCount: 0,
} as const;

function exactAutomaticRlsConfiguration(state: StagingCatalogState): boolean {
  if (state.supabaseAutomaticRlsFunctions.length !== 1 || state.eventTriggers.length !== 1) return false;
  const fn = state.supabaseAutomaticRlsFunctions[0]!;
  const trigger = state.eventTriggers[0]!;
  const config = fn.configuration ? [...fn.configuration].sort() : null;
  const tags = trigger.tags ? [...trigger.tags].sort() : null;
  return fn.schema === expectedAutomaticRlsFunction.schema
    && fn.name === expectedAutomaticRlsFunction.name
    && fn.argumentCount === expectedAutomaticRlsFunction.argumentCount
    && fn.identityArguments === expectedAutomaticRlsFunction.identityArguments
    && fn.owner === expectedAutomaticRlsFunction.owner
    && fn.language === expectedAutomaticRlsFunction.language
    && fn.returnType === expectedAutomaticRlsFunction.returnType
    && fn.securityDefiner === expectedAutomaticRlsFunction.securityDefiner
    && fn.strict === expectedAutomaticRlsFunction.strict
    && fn.volatility === expectedAutomaticRlsFunction.volatility
    && JSON.stringify(config) === JSON.stringify([...expectedAutomaticRlsFunction.configuration].sort())
    && fn.sourceLength === expectedAutomaticRlsFunction.sourceLength
    && fn.sourceMd5 === expectedAutomaticRlsFunction.sourceMd5
    && trigger.name === expectedAutomaticRlsEventTrigger.name
    && trigger.owner === expectedAutomaticRlsEventTrigger.owner
    && trigger.enabled === expectedAutomaticRlsEventTrigger.enabled
    && trigger.event === expectedAutomaticRlsEventTrigger.event
    && JSON.stringify(tags) === JSON.stringify([...expectedAutomaticRlsEventTrigger.tags].sort())
    && trigger.handlerSchema === expectedAutomaticRlsEventTrigger.handlerSchema
    && trigger.handlerName === expectedAutomaticRlsEventTrigger.handlerName
    && trigger.handlerArgumentCount === expectedAutomaticRlsEventTrigger.handlerArgumentCount;
}

/** Requires the exact Supabase-created automatic-RLS function and its enabled event trigger. */
export function assertSupabaseAutomaticRlsConfiguration(state: StagingCatalogState, required = true): void {
  if (!required && state.supabaseAutomaticRlsFunctions.length === 0 && state.eventTriggers.length === 0) return;
  if (!exactAutomaticRlsConfiguration(state)) {
    throw new Error('Supabase automatic-RLS function or event-trigger metadata is unexpected; manual review is required.');
  }
}

export function assertSupabaseAutomaticRlsUnchanged(before: StagingCatalogState, after: StagingCatalogState, required = true): void {
  assertSupabaseAutomaticRlsConfiguration(before, required);
  assertSupabaseAutomaticRlsConfiguration(after, required);
  const canonical = (state: StagingCatalogState) => JSON.stringify({
    functions: state.supabaseAutomaticRlsFunctions.map((fn) => ({ ...fn, configuration: fn.configuration ? [...fn.configuration].sort() : null }))
      .sort((a, b) => `${a.schema}.${a.name}.${a.identityArguments}`.localeCompare(`${b.schema}.${b.name}.${b.identityArguments}`)),
    triggers: state.eventTriggers.map((trigger) => ({ ...trigger, tags: trigger.tags ? [...trigger.tags].sort() : null }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  });
  if (canonical(before) !== canonical(after)) {
    throw new Error('Supabase automatic-RLS function or event trigger changed during the operation.');
  }
}

export function isApprovedSupabaseAutomaticRlsRoutine(
  state: StagingCatalogState,
  object: StagingCatalogState['publicObjects'][number],
): boolean {
  return object.kind === 'routine' && object.name === expectedAutomaticRlsFunction.name
    && !object.extensionOwned && exactAutomaticRlsConfiguration(state);
}

export function normalizeStagingSqlType(type: string): string {
  return type.toLowerCase().replace(/\s*,\s*/g, ',').replace(/\s+/g, ' ').trim();
}

function expectedPostgresType(type: string): string {
  if (type === 'serial') return 'integer';
  if (type === 'bigserial') return 'bigint';
  if (type === 'timestamp') return 'timestamp without time zone';
  return type;
}

export function normalizeStagingHost(host: string): string {
  const normalized = host.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!normalized || (normalized.includes(':') ? isIP(normalized) !== 6 : !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*$/.test(normalized))) {
    throw new Error('Invalid staging database host.');
  }
  return normalized;
}

function validProjectRef(value: string | undefined): value is string {
  return Boolean(value && /^[a-z0-9]{20}$/.test(value));
}

function parsePort(value: string | undefined): number {
  if (!value || !/^\d+$/.test(value)) throw new Error('Invalid staging database port.');
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid staging database port.');
  return port;
}

function targetFingerprint(target: Pick<StagingDatabaseSettings, 'host' | 'port' | 'database' | 'user'>) {
  return `${target.host}:${target.port}/${target.database}/${target.user}`;
}

function parseConfiguredUrl(value: string, credentialsRequired: boolean) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Configured PostgreSQL target cannot be safely compared.');
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || url.hash) {
    throw new Error('Configured PostgreSQL target cannot be safely compared.');
  }
  for (const [key, parameter] of url.searchParams) {
    if (key !== 'sslmode' || parameter !== 'require') throw new Error('Staging database URL has unsupported connection options.');
  }
  const user = decodeURIComponent(url.username);
  const password = decodeURIComponent(url.password);
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!database || (credentialsRequired && (!user.trim() || !password.trim()))) {
    throw new Error('Staging database URL must include an explicit database, username, and password.');
  }
  return {
    host: normalizeStagingHost(url.hostname),
    port: parsePort(url.port || '5432'),
    database,
    user,
    password,
  };
}

function configuredSqlTarget(env: Record<string, string | undefined>) {
  const keys = ['SQL_HOST', 'SQL_PORT', 'SQL_DB_NAME', 'SQL_USER', 'SQL_PASSWORD', 'SQL_ADMIN_USER', 'SQL_ADMIN_PASSWORD'];
  if (!keys.some((key) => env[key]?.trim())) return undefined;
  if (!env.SQL_HOST?.trim() || !env.SQL_DB_NAME?.trim()) throw new Error('Configured application database target cannot be safely compared.');
  if (Boolean(env.SQL_ADMIN_USER?.trim()) !== Boolean(env.SQL_ADMIN_PASSWORD?.trim())) {
    throw new Error('Configured migration database target cannot be safely compared.');
  }
  return {
    host: normalizeStagingHost(env.SQL_HOST.trim()),
    port: parsePort(env.SQL_PORT?.trim() || '5432'),
    database: env.SQL_DB_NAME.trim(),
  };
}

export function resolveSupabaseStagingSettings(
  mode: 'probe',
  args: string[],
  env: Record<string, string | undefined>,
): StagingIdentityProbeSettings;
export function resolveSupabaseStagingSettings(
  mode: 'initialize' | 'migrate' | 'check',
  args: string[],
  env: Record<string, string | undefined>,
): StagingDatabaseSettings;
export function resolveSupabaseStagingSettings(
  mode: 'initialize' | 'migrate' | 'check' | 'probe',
  args: string[],
  env: Record<string, string | undefined>,
): StagingDatabaseSettings | StagingIdentityProbeSettings {
  const expectedArg = mode === 'initialize' ? '--confirm-staging-initialize'
    : mode === 'migrate' ? '--confirm-staging-migrate'
      : mode === 'check' ? '--confirm-staging-preflight' : '--confirm-staging-identity-probe';
  const expectedConfirmation = mode === 'initialize' ? confirmation
    : mode === 'migrate' ? migrationConfirmation
      : mode === 'check' ? 'I_CONFIRM_READ_ONLY_SUPABASE_STAGING_PREFLIGHT' : 'I_CONFIRM_READ_ONLY_SUPABASE_STAGING_IDENTITY_PROBE';
  const confirmationEnv = mode === 'initialize' ? 'SUPABASE_STAGING_INITIALIZATION_CONFIRMATION'
    : mode === 'migrate' ? 'SUPABASE_STAGING_MIGRATION_CONFIRMATION'
      : mode === 'check' ? 'SUPABASE_STAGING_PREFLIGHT_CONFIRMATION' : 'SUPABASE_STAGING_PROBE_CONFIRMATION';
  if (args.length !== 1 || args[0] !== expectedArg) throw new Error(`Pass ${expectedArg} exactly once and no other arguments.`);
  if (env.SUPABASE_STAGING_ENABLED !== 'true') throw new Error('SUPABASE_STAGING_ENABLED must equal true.');
  if (env[confirmationEnv] !== expectedConfirmation) throw new Error(`Explicit ${mode} confirmation is required.`);
  const noProductionSetting = env.SUPABASE_NO_PRODUCTION_PROJECT;
  const noProductionConfirmationSetting = env.SUPABASE_NO_PRODUCTION_PROJECT_CONFIRMATION;
  const noProductionMode = noProductionSetting === 'true';
  if (noProductionSetting !== undefined && noProductionSetting !== '' && !noProductionMode) {
    throw new Error('SUPABASE_NO_PRODUCTION_PROJECT must be unset or exactly true.');
  }
  if (noProductionMode) {
    const productionRef = env.SUPABASE_PRODUCTION_PROJECT_REF;
    if (productionRef !== undefined && productionRef !== '') {
      throw new Error('SUPABASE_PRODUCTION_PROJECT_REF must be unset when no-production mode is enabled.');
    }
    if (noProductionConfirmationSetting !== noProductionConfirmation) {
      throw new Error('Explicit no-production-project confirmation is required.');
    }
  } else {
    if (noProductionConfirmationSetting !== undefined && noProductionConfirmationSetting !== '') {
      throw new Error('No-production confirmation cannot be used unless no-production mode is enabled.');
    }
    if (!validProjectRef(env.SUPABASE_PRODUCTION_PROJECT_REF)) {
      throw new Error('A valid Production project reference is required unless explicit no-production mode is enabled.');
    }
    if (env.SUPABASE_STAGING_PROJECT_REF === env.SUPABASE_PRODUCTION_PROJECT_REF) {
      throw new Error('Staging and Production project references must be different.');
    }
  }
  if (!validProjectRef(env.SUPABASE_STAGING_PROJECT_REF)) {
    throw new Error('A valid staging project reference is required.');
  }
  if (mode === 'probe' && !noProductionMode) {
    throw new Error('The identity probe requires explicit no-production-project mode.');
  }
  if (env.SUPABASE_STAGING_SCHEMA !== 'public') throw new Error('SUPABASE_STAGING_SCHEMA must equal public.');

  const url = env.SUPABASE_STAGING_DATABASE_URL?.trim();
  if (!url) throw new Error('SUPABASE_STAGING_DATABASE_URL must be explicitly configured.');
  const parsed = parseConfiguredUrl(url, true);
  const expectedHost = normalizeStagingHost(env.SUPABASE_STAGING_DATABASE_HOST?.trim() || '');
  const expectedPort = parsePort(env.SUPABASE_STAGING_DATABASE_PORT?.trim());
  const expectedDatabase = env.SUPABASE_STAGING_DATABASE_NAME?.trim();
  const expectedUser = env.SUPABASE_STAGING_DATABASE_USER?.trim();
  const caFilePath = env.SUPABASE_STAGING_DATABASE_CA_FILE?.trim();
  const effectiveUser = env.SUPABASE_STAGING_DATABASE_EFFECTIVE_USER?.trim();
  const runtimeUser = env.SUPABASE_STAGING_RUNTIME_DATABASE_USER?.trim();
  if (!expectedDatabase || !expectedUser) throw new Error('Expected staging database name and login user are required.');
  if (!caFilePath || !isAbsolute(caFilePath)) {
    throw new Error('SUPABASE_STAGING_DATABASE_CA_FILE must name an absolute path to the official staging database CA certificate.');
  }
  if (mode !== 'probe') {
    if (!effectiveUser || !runtimeUser) throw new Error('Expected effective and runtime database users are required.');
    if (runtimeUser !== effectiveUser) throw new Error('The staging runtime database role must equal the migration owner role unless separately reviewed.');
  }
  if (parsed.host !== expectedHost || parsed.port !== expectedPort || parsed.database !== expectedDatabase || parsed.user !== expectedUser) {
    throw new Error('Staging connection target does not match its independent expected identity.');
  }

  const projectRef = env.SUPABASE_STAGING_PROJECT_REF;
  const directHost = `db.${projectRef}.supabase.co`;
  const direct = parsed.host === directHost;
  const sharedPooler = parsed.host.endsWith('.pooler.supabase.com');
  if (direct && !parsed.user) throw new Error('Direct staging endpoint username is missing.');
  if (sharedPooler && !parsed.user.endsWith(`.${projectRef}`)) {
    throw new Error('Shared pooler username does not identify the expected staging project.');
  }
  if (!direct && !sharedPooler) throw new Error('Staging endpoint is not a recognized Supabase direct or shared-pooler host.');

  const fingerprint = targetFingerprint({ ...parsed, host: parsed.host });
  if (env.SUPABASE_STAGING_TARGET_FINGERPRINT?.trim() !== fingerprint) {
    throw new Error('Staging target fingerprint does not match the explicitly expected target.');
  }

  const configuredTargets: Array<{ host: string; port: number; database: string }> = [];
  for (const key of ['DATABASE_URL', 'MIGRATION_DATABASE_URL', 'FRESH_DATABASE_URL']) {
    const configuredUrl = env[key]?.trim();
    if (configuredUrl) configuredTargets.push(parseConfiguredUrl(configuredUrl, false));
  }
  const discrete = configuredSqlTarget(env);
  if (discrete) configuredTargets.push(discrete);
  if (configuredTargets.some((target) => target.host === parsed.host && target.port === parsed.port && target.database === parsed.database)) {
    throw new Error('Staging target must not match a runtime, generic migration, or fresh-initializer database target.');
  }

  const commonSettings: StagingIdentityProbeSettings = {
    ...parsed,
    projectRef,
    connectionMode: direct ? 'direct' : 'shared-pooler',
    schema: 'public',
    ssl: true,
    caFilePath,
    fingerprint,
    automaticRlsRequired: true,
  };
  if (mode === 'probe') return commonSettings;
  return { ...commonSettings, effectiveUser: effectiveUser!, runtimeUser: runtimeUser! };
}

export function assertStagingDataApiRoles(roles: string[]): void {
  if (!roles.includes('anon') || !roles.includes('authenticated')) {
    throw new Error('Expected Supabase Data API roles are missing.');
  }
}

export function assertStagingIdentity(
  actual: StagingCatalogState['identity'],
  expected: StagingDatabaseSettings,
): void {
  if (
    actual.database !== expected.database
    || actual.user !== expected.effectiveUser
    || !actual.loginUser
    || (expected.connectionMode === 'direct' && actual.loginUser !== expected.user)
    || (expected.connectionMode === 'shared-pooler' && actual.loginUser !== expected.user && actual.loginUser !== expected.effectiveUser)
    || actual.currentSchema !== 'public'
    || actual.searchPath.replaceAll('"', '').split(',').map((part) => part.trim()).join(',') !== 'public'
  ) {
    throw new Error('Connected staging database identity or public search path does not match the expected target.');
  }
  // A pooler URL port and PostgreSQL's internal server port are different concepts.
  // Project identity is checked through the independently configured endpoint and user, not inet_server_port().
  void actual.serverPort;
}

export function assertStagingRequiredSchemas(schemas: StagingCatalogState['schemas']): void {
  if (!schemas.public || !schemas.auth || !schemas.storage) {
    throw new Error('Expected public, auth, and storage schemas are not all present.');
  }
}

export function assertStagingDataApiPrivileges(state: Pick<StagingCatalogState, 'dataApiRoleAudit'>): void {
  if (state.dataApiRoleAudit?.length !== 2
    || state.dataApiRoleAudit.some((role) => role.superuser || role.bypassRls || role.inheritsRuntimeOwner
      || role.publicCreate || role.drizzleCreate || role.applicationTablePrivileges.length > 0
      || role.authCreate || role.storageCreate || role.applicationSequencePrivileges.length > 0)) {
    throw new Error('Data API role privileges are not safely isolated from the application owner and business tables.');
  }
}

export function assertStagingInitializationState(state: StagingCatalogState, applicationObjectNames: string[] = [], automaticRlsRequired = true): void {
  assertSupabaseAutomaticRlsConfiguration(state, automaticRlsRequired);
  if (state.identity.currentSchema !== 'public' || state.identity.searchPath.replaceAll('"', '').split(',').map((part) => part.trim()).join(',') !== 'public') {
    throw new Error('The application schema or search path is ambiguous.');
  }
  const unexpectedPublic = state.publicObjects.filter((object) => !object.extensionOwned && !isApprovedSupabaseAutomaticRlsRoutine(state, object));
  if (unexpectedPublic.length) throw new Error('The public schema contains non-extension objects; manual review is required.');
  if (state.publicObjects.some((object) => applicationObjectNames.includes(object.name))) {
    throw new Error('A public object conflicts with an application baseline object.');
  }
  if (state.drizzleSchemaExists || state.drizzleRelations.length || state.migrationHistory.length) {
    throw new Error('Drizzle migration schema/history already exists; manual review is required.');
  }
  if (state.supabaseMigrationSchemaExists || state.supabaseMigrationRecords !== 0) {
    throw new Error('Supabase CLI migration history exists; reconcile migration systems before initialization.');
  }
}

export function assertStagingBaselineState(state: StagingCatalogState, expected: {
  baseline: MigrationJournalEntry;
  baselineApplicationTables: string[];
  baselineColumns: Record<string, ExpectedStagingColumn[]>;
  baselineIndexes: string[];
  baselineConstraints: string[];
  automaticRlsRequired?: boolean;
}): void {
  assertSupabaseAutomaticRlsConfiguration(state, expected.automaticRlsRequired ?? true);
  if (state.identity.currentSchema !== 'public' || state.identity.searchPath.replaceAll('"', '').split(',').map((part) => part.trim()).join(',') !== 'public') {
    throw new Error('The application schema or search path is ambiguous.');
  }
  if (state.supabaseMigrationSchemaExists || state.supabaseMigrationRecords !== 0) {
    throw new Error('Supabase CLI migration history exists; reconcile migration systems before continuing.');
  }
  const rows = state.migrationHistory;
  if (rows.length !== 1 || rows[0]?.createdAt !== expected.baseline.when || rows[0]?.hash !== expected.baseline.hash) {
    throw new Error('Drizzle history does not match the approved baseline marker. Manual review is required.');
  }
  const tableSet = new Set(state.applicationTables);
  if (!expected.baselineApplicationTables.every((table) => tableSet.has(table)) || tableSet.has('contact_inquiries')) {
    throw new Error('Application tables do not match the approved baseline schema.');
  }
  for (const [table, columns] of Object.entries(expected.baselineColumns)) {
    const actual = new Map((state.applicationColumns[table] ?? []).map((column) => [column.name, column]));
    if (!columns.every((column) => {
      const actualColumn = actual.get(column.name);
      if (!actualColumn) return false;
      return normalizeStagingSqlType(actualColumn.type) === normalizeStagingSqlType(expectedPostgresType(column.type))
        && actualColumn.notNull === column.notNull
        && actualColumn.hasDefault === column.hasDefault;
    })) throw new Error('Application columns do not match the approved baseline schema.');
  }
  if (!expected.baselineIndexes.every((name) => state.applicationIndexes.includes(name))) {
    throw new Error('Application indexes do not match the approved baseline schema.');
  }
  if (!expected.baselineConstraints.every((name) => state.applicationConstraints.includes(name))) {
    throw new Error('Application constraints do not match the approved baseline schema.');
  }
}

export function assertStagingMigrationHistory(
  rows: Array<{ hash: string; createdAt: number }>,
  baseline: MigrationJournalEntry,
  forward: MigrationJournalEntry[],
  allowPendingForward: boolean,
): void {
  if (!rows.length || rows[0]?.createdAt !== baseline.when || rows[0]?.hash !== baseline.hash) {
    throw new Error('Drizzle migration history is missing or has an invalid baseline marker.');
  }
  const expectedApplied = allowPendingForward ? forward.slice(0, Math.max(0, rows.length - 1)) : forward;
  if (allowPendingForward && rows.length - 1 > forward.length) throw new Error('Drizzle migration history contains unexpected records.');
  if (!allowPendingForward && rows.length !== forward.length + 1) throw new Error('Drizzle migration history is incomplete.');
  for (let index = 0; index < expectedApplied.length; index += 1) {
    const migration = expectedApplied[index]!;
    const row = rows[index + 1];
    if (!row || row.createdAt !== migration.when || row.hash !== migration.hash) {
      throw new Error('Drizzle migration history is inconsistent or out of order.');
    }
  }
}
