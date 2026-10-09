import { isIP } from 'node:net';

const confirmationPhrase = 'I_CONFIRM_DISPOSABLE_TEST_DATABASE';

export type PostgresTarget = { host: string; port: number; databaseName: string };
export type PostgresIntegrationSettings = PostgresTarget & {
  connectionString: string;
  user: string;
  password: string;
  ssl: boolean;
};
export type PostgresIntegrationPoolOptions = Pick<PostgresIntegrationSettings, 'host' | 'port' | 'user' | 'password' | 'ssl'> & {
  database: string;
  application_name: string;
  max: number;
  connectionTimeoutMillis: number;
};

function normalizeHost(value: string) {
  const host = value.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  const validDns = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*$/;
  if (!host || (host.includes(':') ? isIP(host) !== 6 : !validDns.test(host))) {
    throw new Error('A configured PostgreSQL host cannot be safely compared.');
  }
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return 'localhost';
  return host;
}

function targetFingerprint(target: PostgresTarget) {
  const host = target.host.includes(':') ? `[${target.host}]` : target.host;
  return `${host}:${target.port}/${target.databaseName}`;
}

function parsePort(value: string | undefined, fallback = 5432): number {
  if (value === undefined || value.trim() === '') return fallback;
  if (!/^\d+$/.test(value.trim())) throw new Error('A configured PostgreSQL target has an invalid port.');
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('A configured PostgreSQL target has an invalid port.');
  return port;
}

function parsePostgresUrl(value: string, requireCredentials = false): PostgresTarget & { user?: string; password?: string } {
  try {
    const parsed = new URL(value);
    if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || !parsed.hostname) throw new Error();
    const targetOverrides = new Set(['host', 'hostaddr', 'port', 'database', 'dbname', 'service', 'servicefile']);
    if (parsed.hash || [...parsed.searchParams.keys()].some((key) => targetOverrides.has(key.toLowerCase()))) throw new Error();
    let databaseName: string;
    try { databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, '')); }
    catch { throw new Error(); }
    const host = normalizeHost(parsed.hostname);
    const port = parsePort(parsed.port || undefined);
    if (!host || !databaseName) throw new Error();
    let user: string | undefined;
    let password: string | undefined;
    try {
      user = decodeURIComponent(parsed.username);
      password = decodeURIComponent(parsed.password);
    } catch { throw new Error(); }
    if (requireCredentials && (!user?.trim() || !password?.trim())) throw new Error();
    return { host, port, databaseName, ...(user ? { user } : {}), ...(password ? { password } : {}) };
  } catch {
    throw new Error('A configured PostgreSQL URL cannot be safely compared.');
  }
}

function sameTarget(left: PostgresTarget, right: PostgresTarget) {
  return left.host === right.host && left.port === right.port && left.databaseName === right.databaseName;
}

function parseDiscreteTarget(env: Record<string, string | undefined>): PostgresTarget | null {
  const targetKeys = ['SQL_HOST', 'SQL_PORT', 'SQL_DB_NAME'];
  const credentialKeys = ['SQL_USER', 'SQL_PASSWORD', 'SQL_ADMIN_USER', 'SQL_ADMIN_PASSWORD'];
  const hasTargetSetting = targetKeys.some((key) => Boolean(env[key]?.trim()));
  const hasCredentialSetting = credentialKeys.some((key) => Boolean(env[key]?.trim()));
  if (!hasTargetSetting && !hasCredentialSetting) return null;

  const hostValue = env.SQL_HOST?.trim();
  const databaseName = env.SQL_DB_NAME?.trim();
  if (!hostValue || !databaseName) throw new Error('Configured discrete PostgreSQL settings cannot be safely compared.');
  if (Boolean(env.SQL_ADMIN_USER?.trim()) !== Boolean(env.SQL_ADMIN_PASSWORD?.trim())) {
    throw new Error('Configured migration credentials cannot be safely compared.');
  }
  const host = normalizeHost(hostValue);
  if (!host) throw new Error('Configured discrete PostgreSQL settings cannot be safely compared.');
  return { host, port: parsePort(env.SQL_PORT), databaseName };
}

function isLoopback(host: string) {
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

/**
 * Validate every configured app/migration target before constructing a Pool.
 * Credential and SSL query parameters are intentionally excluded from target
 * equality: different credentials can still reach the same database.
 */
export function resolvePostgresIntegrationSettings(
  env: Record<string, string | undefined>,
): PostgresIntegrationSettings {
  if (env.RUN_POSTGRES_INTEGRATION_TESTS !== 'true') {
    throw new Error('Set RUN_POSTGRES_INTEGRATION_TESTS=true to opt in to PostgreSQL integration tests.');
  }
  if (env.POSTGRES_TEST_DATABASE_CONFIRMATION !== confirmationPhrase) {
    throw new Error('Explicit disposable-test-database confirmation is required.');
  }
  const rawUrl = env.TEST_DATABASE_URL?.trim();
  if (!rawUrl) throw new Error('TEST_DATABASE_URL must be explicitly configured.');

  const testTarget = parsePostgresUrl(rawUrl, true);
  if (!/(^|[_-])test([_-]|$)/i.test(testTarget.databaseName)) {
    throw new Error('The test database name must clearly identify a test database.');
  }

  const configuredTargets: PostgresTarget[] = [];
  for (const key of ['DATABASE_URL', 'MIGRATION_DATABASE_URL']) {
    const value = env[key]?.trim();
    if (value) configuredTargets.push(parsePostgresUrl(value));
  }
  const discreteTarget = parseDiscreteTarget(env);
  if (discreteTarget) configuredTargets.push(discreteTarget);
  if (configuredTargets.some((target) => sameTarget(testTarget, target))) {
    throw new Error('The test database must differ from every configured application and migration database target.');
  }

  if (!isLoopback(testTarget.host)) {
    if (env.ALLOW_REMOTE_TEST_DATABASE !== 'true') {
      throw new Error('Remote test databases are disabled by default.');
    }
    const expectedFingerprint = env.TEST_DATABASE_EXPECTED_FINGERPRINT?.trim();
    if (!expectedFingerprint || expectedFingerprint !== targetFingerprint(testTarget)) {
      throw new Error('Remote test database fingerprint confirmation does not match the configured target.');
    }
  }

  const sslSetting = (env.TEST_DATABASE_SSL || 'auto').toLowerCase();
  if (!['auto', 'true', 'false'].includes(sslSetting)) {
    throw new Error('TEST_DATABASE_SSL must be auto, true, or false.');
  }
  const ssl = sslSetting === 'true' || (sslSetting === 'auto' && !isLoopback(testTarget.host));
  return {
    host: testTarget.host,
    port: testTarget.port,
    databaseName: testTarget.databaseName,
    connectionString: rawUrl,
    user: testTarget.user!,
    password: testTarget.password!,
    ssl,
  };
}

/** Validate first, then pass explicit credentials to an injected pool factory. */
export function initializePostgresIntegrationPool<T>(
  env: Record<string, string | undefined>,
  createPool: (options: PostgresIntegrationPoolOptions) => T,
): T {
  const settings = resolvePostgresIntegrationSettings(env);
  return createPool({
    host: settings.host,
    port: settings.port,
    database: settings.databaseName,
    user: settings.user,
    password: settings.password,
    ssl: settings.ssl,
    application_name: 'rcmega-postgres-integration-tests',
    max: 8,
    connectionTimeoutMillis: 5_000,
  });
}

/** A non-secret fingerprint suitable for independently confirming a remote target. */
export function postgresTargetFingerprint(target: PostgresTarget) {
  return targetFingerprint({ ...target, host: normalizeHost(target.host) });
}

