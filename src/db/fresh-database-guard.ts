import { isIP } from 'node:net';

const confirmation = 'I_CONFIRM_EMPTY_NONPRODUCTION_DATABASE';

export type FreshDatabaseTarget = { host: string; port: number; database: string };
export type FreshDatabaseSettings = FreshDatabaseTarget & {
  user: string;
  password: string;
  ssl: boolean;
};

export function assertFreshDatabaseIdentity(
  actual: { database: unknown; user: unknown; serverPort?: unknown },
  expected: Pick<FreshDatabaseSettings, 'database' | 'user'>,
): void {
  if (actual.database !== expected.database || actual.user !== expected.user) {
    throw new Error('Connected database identity does not match the explicitly configured database and user.');
  }
}

function normalizedHost(input: string) {
  const host = input.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  const validDns = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*$/;
  if (!host || (host.includes(':') ? isIP(host) !== 6 : !validDns.test(host))) {
    throw new Error('Fresh database host cannot be safely verified.');
  }
  return ['localhost', '127.0.0.1', '::1'].includes(host) ? 'localhost' : host;
}

function portNumber(input: string | undefined) {
  if (!input) return 5432;
  if (!/^\d+$/.test(input)) throw new Error('Fresh database port is invalid.');
  const port = Number(input);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Fresh database port is invalid.');
  return port;
}

function parseUrl(value: string, requireCredentials: boolean): FreshDatabaseSettings {
  try {
    const url = new URL(value);
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || url.hash) throw new Error();
    if (url.searchParams.size > 0) throw new Error();
    const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
    const user = decodeURIComponent(url.username);
    const password = decodeURIComponent(url.password);
    if (!database || (requireCredentials && (!user.trim() || !password.trim()))) throw new Error();
    return {
      host: normalizedHost(url.hostname),
      port: portNumber(url.port || undefined),
      database,
      user,
      password,
      ssl: false,
    };
  } catch {
    throw new Error('FRESH_DATABASE_URL must be a verifiable PostgreSQL URL with explicit credentials.');
  }
}

function fingerprint(target: FreshDatabaseTarget) {
  const host = target.host.includes(':') ? `[${target.host}]` : target.host;
  return `${host}:${target.port}/${target.database}`;
}

function sameTarget(left: FreshDatabaseTarget, right: FreshDatabaseTarget) {
  return left.host === right.host && left.port === right.port && left.database === right.database;
}

function configuredDiscreteTarget(env: Record<string, string | undefined>): FreshDatabaseTarget | null {
  const keys = ['SQL_HOST', 'SQL_PORT', 'SQL_DB_NAME'];
  const any = keys.some((key) => Boolean(env[key]?.trim()));
  const anyCredential = ['SQL_USER', 'SQL_PASSWORD', 'SQL_ADMIN_USER', 'SQL_ADMIN_PASSWORD'].some((key) => Boolean(env[key]?.trim()));
  if (!any && !anyCredential) return null;
  if (!env.SQL_HOST?.trim() || !env.SQL_DB_NAME?.trim()) throw new Error('Configured SQL target cannot be safely compared.');
  if (Boolean(env.SQL_ADMIN_USER?.trim()) !== Boolean(env.SQL_ADMIN_PASSWORD?.trim())) throw new Error('Configured migration credentials cannot be safely compared.');
  return {
    host: normalizedHost(env.SQL_HOST.trim()),
    port: portNumber(env.SQL_PORT?.trim()),
    database: env.SQL_DB_NAME.trim(),
  };
}

export function resolveFreshDatabaseSettings(
  args: string[],
  env: Record<string, string | undefined>,
): FreshDatabaseSettings {
  if (args.length !== 1 || args[0] !== '--confirm-empty-database') {
    throw new Error('Pass --confirm-empty-database exactly once and no other arguments.');
  }
  if (env.FRESH_DATABASE_ENABLED !== 'true') throw new Error('Set FRESH_DATABASE_ENABLED=true to enable initialization.');
  if (env.FRESH_DATABASE_CONFIRMATION !== confirmation) throw new Error('Explicit fresh-database confirmation is required.');

  const rawUrl = env.FRESH_DATABASE_URL?.trim();
  if (!rawUrl) throw new Error('FRESH_DATABASE_URL must be explicitly configured.');
  const settings = parseUrl(rawUrl, true);
  const expected = env.FRESH_DATABASE_EXPECTED_FINGERPRINT?.trim();
  if (!expected || expected !== fingerprint(settings)) throw new Error('Fresh database target fingerprint does not match.');

  const configured: FreshDatabaseTarget[] = [];
  for (const key of ['DATABASE_URL', 'MIGRATION_DATABASE_URL']) {
    const url = env[key]?.trim();
    if (url) configured.push(parseUrl(url, false));
  }
  const discrete = configuredDiscreteTarget(env);
  if (discrete) configured.push(discrete);
  if (configured.some((target) => sameTarget(target, settings))) {
    throw new Error('Fresh database must differ from all configured application and migration database targets.');
  }

  if (settings.host !== 'localhost') {
    if (env.ALLOW_REMOTE_FRESH_DATABASE !== 'true') throw new Error('Remote fresh-database initialization is disabled by default.');
    if (env.FRESH_DATABASE_EXPECTED_FINGERPRINT?.trim() !== fingerprint(settings)) throw new Error('Remote fresh database fingerprint does not match.');
  }

  const sslSetting = (env.FRESH_DATABASE_SSL || 'auto').toLowerCase();
  if (!['auto', 'true', 'false'].includes(sslSetting)) throw new Error('FRESH_DATABASE_SSL must be auto, true, or false.');
  settings.ssl = sslSetting === 'true' || (sslSetting === 'auto' && settings.host !== 'localhost');
  return settings;
}

export function freshDatabaseFingerprint(target: FreshDatabaseTarget) {
  return fingerprint({ ...target, host: normalizedHost(target.host) });
}
