import {
  resolveSupabaseStagingSettings,
  type StagingIdentityProbeSettings,
} from '../src/db/supabase-staging-guard.ts';
import {
  loadVerifiedSupabaseStagingSslOptions,
  SupabaseStagingCaConfigurationError,
  type VerifiedPostgresSslOptions,
} from '../src/db/supabase-staging-tls.ts';

export type StagingIdentityProbe = {
  database: string;
  sessionUser: string;
  currentUser: string;
  currentSchema: string;
  searchPath: string;
  serverPort: number;
  transactionReadOnly: boolean;
  isSuperuser: boolean;
  bypassesRls: boolean;
};

export type StagingIdentityProbeRuntime = {
  inspectIdentity: () => Promise<StagingIdentityProbe>;
  close: () => Promise<void>;
};

export type StagingIdentityProbeDependencies = {
  open: (settings: StagingIdentityProbeSettings) => Promise<StagingIdentityProbeRuntime>;
};

export type ProbeFailurePhase = 'connection' | 'identity-query' | 'identity-validation' | 'connection-close';
export type ProbeFailureCategory = 'DNS_OR_NETWORK_FAILURE' | 'TLS_FAILURE' | 'AUTHENTICATION_FAILED'
  | 'DATABASE_CONNECTION_REJECTED' | 'IDENTITY_QUERY_FAILED' | 'IDENTITY_MISMATCH'
  | 'READ_ONLY_TRANSACTION_REQUIRED' | 'CONNECTION_CLOSE_FAILED' | 'UNKNOWN_PROBE_FAILURE';

export class ReadOnlyTransactionRequiredError extends Error {
  cleanupFailed = false;

  constructor() {
    super('The PostgreSQL connection did not confirm a read-only transaction.');
    this.name = 'ReadOnlyTransactionRequiredError';
  }
}

const networkCodes = new Set([
  'ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH', 'ECONNRESET', 'EPIPE',
]);
const tlsCodes = new Set([
  'CERT_HAS_EXPIRED', 'CERT_NOT_YET_VALID', 'CERT_REVOKED', 'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN', 'UNABLE_TO_GET_ISSUER_CERT', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'ERR_TLS_CERT_ALTNAME_INVALID', 'ERR_TLS_HANDSHAKE_TIMEOUT',
  'ERR_SSL_WRONG_VERSION_NUMBER', 'ERR_SSL_SSLV3_ALERT_HANDSHAKE_FAILURE',
  'ERR_SSL_TLSV1_ALERT_UNKNOWN_CA', 'ERR_SSL_TLSV1_ALERT_PROTOCOL_VERSION',
]);
const sqlStateClasses = new Set([
  '00', '01', '02', '03', '08', '09', '0A', '0B', '0F', '0L', '0P', '0Z', '10', '20', '21', '22', '23',
  '24', '25', '26', '27', '28', '2B', '2D', '2F', '34', '38', '39', '3B', '3D', '3F', '40', '42', '44',
  '53', '54', '55', '57', '58', 'F0', 'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'P0', 'XX',
]);

function safeIdentifier(value: string): string {
  return /^[A-Za-z_][A-Za-z0-9_.$-]{0,62}$/.test(value) ? value : '[unrecognized]';
}

function safeFingerprint(value: string): string {
  return /^[a-z0-9.-]+:\d{1,5}\/[A-Za-z0-9_$-]{1,63}\/[A-Za-z0-9_.$-]{1,63}$/.test(value)
    ? value
    : '[validated target]';
}

function errorCode(error: unknown): string | undefined {
  try {
    if (!error || typeof error !== 'object' || !('code' in error)) return undefined;
    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' ? code : undefined;
  } catch {
    return undefined;
  }
}

function validatedSqlState(code: string | undefined): string | undefined {
  return code && /^[0-9A-Z]{5}$/.test(code) && sqlStateClasses.has(code.slice(0, 2)) ? code : undefined;
}

function validatedNodeCode(code: string | undefined): string | undefined {
  if (!code) return undefined;
  if (networkCodes.has(code) || tlsCodes.has(code)) return code;
  return undefined;
}

export function formatProbeFailure(phase: ProbeFailurePhase, error: unknown): string {
  const code = errorCode(error);
  const sqlState = validatedSqlState(code);
  let category: ProbeFailureCategory;
  let safeCode: string | undefined;

  if (phase === 'connection-close') {
    category = 'CONNECTION_CLOSE_FAILED';
    safeCode = validatedNodeCode(code);
  } else if (phase === 'identity-validation') {
    category = 'IDENTITY_MISMATCH';
  } else if (networkCodes.has(code ?? '')) {
    category = 'DNS_OR_NETWORK_FAILURE';
    safeCode = code;
  } else if (tlsCodes.has(code ?? '') || /^(?:ERR_TLS_|ERR_SSL_)/.test(code ?? '')) {
    category = 'TLS_FAILURE';
    safeCode = tlsCodes.has(code ?? '') ? code : undefined;
  } else if (sqlState?.startsWith('28')) {
    category = 'AUTHENTICATION_FAILED';
    safeCode = sqlState;
  } else if (sqlState?.startsWith('08') || sqlState === '53300' || sqlState === '57P03') {
    category = 'DATABASE_CONNECTION_REJECTED';
    safeCode = sqlState;
  } else if (phase === 'identity-query') {
    category = 'IDENTITY_QUERY_FAILED';
    safeCode = sqlState;
  } else if (phase === 'connection' && sqlState) {
    category = 'DATABASE_CONNECTION_REJECTED';
    safeCode = sqlState;
  } else {
    category = 'UNKNOWN_PROBE_FAILURE';
  }

  const codeLabel = safeCode
    ? (validatedSqlState(safeCode) ? ` sqlstate=${safeCode}` : ` system_code=${safeCode}`)
    : '';
  return `[SUPABASE_STAGING_PROBE_${category}] phase=${phase}${codeLabel}; sensitive error details were withheld.`;
}

export type ProbeIdentityChecks = {
  databaseMatches: boolean;
  sessionUserPresent: boolean;
  currentUserPresent: boolean;
  schemaMatches: boolean;
  searchPathMatches: boolean;
  internalPortCheckValid: boolean;
  transactionReadOnly: boolean;
  roleAttributesValid: boolean;
};

/** Mirrors the existing probe identity predicates without exposing returned identities. */
export function inspectProbeIdentityChecks(
  identity: StagingIdentityProbe,
  settings: StagingIdentityProbeSettings,
): ProbeIdentityChecks {
  const normalizedPath = typeof identity.searchPath === 'string'
    ? identity.searchPath.replaceAll('"', '').split(',').map((part) => part.trim()).join(',')
    : '';
  return {
    databaseMatches: identity.database === settings.database,
    sessionUserPresent: typeof identity.sessionUser === 'string' && identity.sessionUser.length > 0,
    currentUserPresent: typeof identity.currentUser === 'string' && identity.currentUser.length > 0,
    schemaMatches: identity.currentSchema === 'public',
    searchPathMatches: normalizedPath === 'public',
    internalPortCheckValid: Number.isInteger(identity.serverPort) && identity.serverPort >= 1 && identity.serverPort <= 65535,
    transactionReadOnly: identity.transactionReadOnly === true,
    roleAttributesValid: typeof identity.isSuperuser === 'boolean' && typeof identity.bypassesRls === 'boolean',
  };
}

function identityChecksPass(checks: ProbeIdentityChecks): boolean {
  return Object.values(checks).every(Boolean);
}

function formatIdentityMismatch(checks: ProbeIdentityChecks): string {
  return '[SUPABASE_STAGING_PROBE_IDENTITY_MISMATCH] phase=identity-validation'
    + ` database_matches=${checks.databaseMatches}`
    + ` session_user_present=${checks.sessionUserPresent}`
    + ` current_user_present=${checks.currentUserPresent}`
    + ' effective_user_matches_if_configured=not_configured'
    + ` schema_matches=${checks.schemaMatches}`
    + ` search_path_matches=${checks.searchPathMatches}`
    + ` internal_port_check_valid=${checks.internalPortCheckValid}`
    + ` transaction_read_only=${checks.transactionReadOnly}`
    + ` role_attributes_valid=${checks.roleAttributesValid}; sensitive identity details were withheld.`;
}

/** Runs only a read-only identity probe. The dependency surface has no migration or write methods. */
export async function runSupabaseStagingIdentityProbe(
  args: string[],
  env: Record<string, string | undefined>,
  dependencies: StagingIdentityProbeDependencies,
  report: (line: string) => void = () => undefined,
): Promise<number> {
  let settings: StagingIdentityProbeSettings;
  try {
    settings = resolveSupabaseStagingSettings('probe', args, env);
  } catch {
    report('[SUPABASE_STAGING_PROBE_CONFIGURATION_INVALID] Explicit staging target, no-production mode, and probe confirmations are invalid or incomplete; no connection was attempted.');
    return 2;
  }

  let runtime: StagingIdentityProbeRuntime;
  try {
    runtime = await dependencies.open(settings);
  } catch (error) {
    if (error instanceof SupabaseStagingCaConfigurationError) {
      report('[SUPABASE_STAGING_PROBE_CONFIGURATION_INVALID] phase=tls-configuration; the configured staging CA file is unavailable or invalid; no connection was attempted.');
      return 2;
    }
    if (error instanceof ReadOnlyTransactionRequiredError) {
      report('[SUPABASE_STAGING_PROBE_READ_ONLY_TRANSACTION_REQUIRED] phase=read-only-transaction; PostgreSQL did not confirm a read-only transaction; identity inspection was not run.');
      if (error.cleanupFailed) report(formatProbeFailure('connection-close', undefined));
      return 1;
    }
    report(formatProbeFailure('connection', error));
    const cleanupFailed = error && typeof error === 'object'
      && 'cleanupFailed' in error && (error as { cleanupFailed?: unknown }).cleanupFailed === true;
    if (cleanupFailed) report(formatProbeFailure('connection-close', undefined));
    return 1;
  }

  let exitCode = 1;
  try {
    let identity: StagingIdentityProbe;
    try {
      identity = await runtime.inspectIdentity();
    } catch (error) {
      report(formatProbeFailure('identity-query', error));
      return 1;
    }
    const identityChecks = inspectProbeIdentityChecks(identity, settings);
    if (!identityChecksPass(identityChecks)) {
      report(formatIdentityMismatch(identityChecks));
      return 1;
    }
    report(`PASS connected target: fingerprint=${safeFingerprint(settings.fingerprint)}; database=${safeIdentifier(identity.database)}; configured_login=${safeIdentifier(settings.user)}; session_user=${safeIdentifier(identity.sessionUser)}; current_user=${safeIdentifier(identity.currentUser)}; current_schema=${safeIdentifier(identity.currentSchema)}; search_path=${identity.searchPath === 'public' ? 'public' : '[unrecognized]'}; server_port=${identity.serverPort}; transaction_read_only=${identity.transactionReadOnly}.`);
    report(`Effective role attributes: superuser=${identity.isSuperuser}; bypasses_rls=${identity.bypassesRls}.`);
    report('The configured staging endpoint, database, public schema, and read-only session were verified. Role values are observations for the subsequent guarded preflight; this probe did not inspect application data or alter the database.');
    exitCode = 0;
  } finally {
    try {
      await runtime.close();
    } catch (error) {
      report(formatProbeFailure('connection-close', error));
      exitCode = 1;
    }
  }
  return exitCode;
}

type ProbeClient = {
  query: <T>(sql: string) => Promise<{ rows: T[] }>;
  release: (error?: Error | boolean) => void;
};
type ProbePool = {
  connect: () => Promise<ProbeClient>;
  end: () => Promise<void>;
};
type ProbePoolOptions = {
  host: string; port: number; database: string; user: string; password: string; ssl: false | VerifiedPostgresSslOptions;
  max: number; connectionTimeoutMillis: number; statement_timeout: number; options: string; application_name: string;
};
export type ProbePoolFactory = (options: ProbePoolOptions) => ProbePool | Promise<ProbePool>;

async function createPostgresPool(options: ProbePoolOptions): Promise<ProbePool> {
  const { Pool } = await import('pg');
  return new Pool(options) as unknown as ProbePool;
}

export async function openReadOnlyStagingIdentityProbe(
  settings: StagingIdentityProbeSettings,
  poolFactory: ProbePoolFactory = createPostgresPool,
  sslOptionsLoader: (caFilePath: string | undefined) => Promise<VerifiedPostgresSslOptions> = loadVerifiedSupabaseStagingSslOptions,
): Promise<StagingIdentityProbeRuntime> {
  const ssl = settings.ssl
    ? await sslOptionsLoader(settings.caFilePath)
    : false;
  const pool = await poolFactory({
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
    application_name: 'flyrc-supabase-staging-identity-probe',
  });
  let client: ProbeClient;
  try {
    client = await pool.connect();
  } catch (error) {
    let cleanupFailed = false;
    try {
      await pool.end();
    } catch {
      cleanupFailed = true;
    }
    const wrapped = new Error('PostgreSQL connection could not be established.') as Error & { originalError?: unknown; cleanupFailed?: boolean };
    wrapped.originalError = error;
    wrapped.cleanupFailed = cleanupFailed;
    // Expose only the original driver's code to the sanitized classifier, never its message.
    const originalCode = errorCode(error);
    if (originalCode) Object.defineProperty(wrapped, 'code', { value: originalCode });
    throw wrapped;
  }

  let transactionAttempted = false;
  let readOnlyVerified = false;
  try {
    transactionAttempted = true;
    await client.query('BEGIN READ ONLY');
    const status = await client.query<{ transaction_read_only: unknown }>(
      "SELECT current_setting('transaction_read_only') AS transaction_read_only",
    );
    const value = status.rows[0]?.transaction_read_only;
    readOnlyVerified = value === true || value === 'on' || value === 'true';
    if (!readOnlyVerified) throw new ReadOnlyTransactionRequiredError();
  } catch {
    const failure = new ReadOnlyTransactionRequiredError();
    let rollbackFailed = false;
    if (transactionAttempted) {
      try {
        await client.query('ROLLBACK');
      } catch {
        rollbackFailed = true;
      }
    }
    try {
      client.release(rollbackFailed || !readOnlyVerified);
    } catch {
      rollbackFailed = true;
    }
    try {
      await pool.end();
    } catch {
      rollbackFailed = true;
    }
    failure.cleanupFailed = rollbackFailed;
    throw failure;
  }

  const inspectIdentity = async (): Promise<StagingIdentityProbe> => {
    if (!readOnlyVerified) throw new ReadOnlyTransactionRequiredError();
    const result = await client.query<{
      database: string;
      session_user: string;
      current_user: string;
      current_schema: string;
      search_path: string;
      server_port: number;
      transaction_read_only: boolean;
      is_superuser: boolean;
      bypasses_rls: boolean;
    }>(`SELECT current_database() AS database,
               session_user AS session_user,
               current_user AS current_user,
               current_schema() AS current_schema,
               current_setting('search_path') AS search_path,
               inet_server_port() AS server_port,
               current_setting('transaction_read_only')::boolean AS transaction_read_only,
               role.rolsuper AS is_superuser,
               role.rolbypassrls AS bypasses_rls
        FROM pg_roles AS role
        WHERE role.rolname = current_user`);
    const row = result.rows[0];
    if (!row) throw new Error('Identity role was not visible in the PostgreSQL catalog.');
    return {
      database: row.database,
      sessionUser: row.session_user,
      currentUser: row.current_user,
      currentSchema: row.current_schema,
      searchPath: row.search_path,
      serverPort: Number(row.server_port),
      transactionReadOnly: row.transaction_read_only,
      isSuperuser: row.is_superuser,
      bypassesRls: row.bypasses_rls,
    };
  };
  let released = false;
  let closed = false;
  return {
    inspectIdentity,
    close: async () => {
      if (closed) return;
      closed = true;
      let releaseError: unknown;
      if (!released) {
        released = true;
        try {
          await client.query('ROLLBACK');
        } catch (error) {
          releaseError = error;
        }
        try {
          client.release(Boolean(releaseError));
        } catch (error) {
          releaseError ??= error;
        }
      }
      try {
        await pool.end();
      } catch (error) {
        releaseError ??= error;
      }
      if (releaseError) {
        throw releaseError;
      }
    },
  };
}

export async function runIdentityProbeCli(args = process.argv.slice(2), env = process.env): Promise<number> {
  return runSupabaseStagingIdentityProbe(args, env, { open: openReadOnlyStagingIdentityProbe }, console.log);
}
