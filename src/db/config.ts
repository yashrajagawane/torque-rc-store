import 'dotenv/config';
import { env as processEnv } from 'node:process';

export type DatabaseMode = 'runtime' | 'migrations';

export interface DatabaseSettings {
  url?: string;
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
  ssl: boolean;
}

function isLocalHost(host: string): boolean {
  const normalized = host.toLowerCase().replace(/^\[|\]$/g, '');
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1';
}

function resolveSsl(host: string, env: Record<string, string | undefined>): boolean {
  const setting = (env.DATABASE_SSL || 'auto').toLowerCase();
  if (setting === 'true') return true;
  if (setting === 'false') return false;
  if (setting === 'auto') return !isLocalHost(host);
  throw new Error('DATABASE_SSL must be one of: auto, true, false.');
}

/**
 * Resolve the same database variables for the application and Drizzle Kit.
 * DATABASE_URL is preferred; the SQL_* variables remain supported for local
 * development and existing deployments. Migrations may use a separate,
 * more-privileged MIGRATION_DATABASE_URL or legacy SQL_ADMIN credentials.
 */
export function resolveDatabaseSettings(
  mode: DatabaseMode = 'runtime',
  env: Record<string, string | undefined> = processEnv,
): DatabaseSettings {
  const url = mode === 'migrations'
    ? env.MIGRATION_DATABASE_URL || env.DATABASE_URL
    : env.DATABASE_URL;

  let host = env.SQL_HOST;
  let port = env.SQL_PORT ? Number(env.SQL_PORT) : 5432;
  let database = env.SQL_DB_NAME;
  let user = env.SQL_USER;
  let password = env.SQL_PASSWORD;

  if (mode === 'migrations' && !url) {
    user = env.SQL_ADMIN_USER || user;
    password = env.SQL_ADMIN_PASSWORD || password;
    if (Boolean(env.SQL_ADMIN_USER) !== Boolean(env.SQL_ADMIN_PASSWORD)) {
      throw new Error('Set both SQL_ADMIN_USER and SQL_ADMIN_PASSWORD, or neither.');
    }
  }

  if (url) {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error(`${mode === 'migrations' && env.MIGRATION_DATABASE_URL ? 'MIGRATION_DATABASE_URL' : 'DATABASE_URL'} is not a valid PostgreSQL connection URL.`);
    }
    if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
      throw new Error('Database connection URL must use postgres:// or postgresql://.');
    }
    host = parsed.hostname;
    port = parsed.port ? Number(parsed.port) : 5432;
    // Keep one authoritative SSL policy. node-postgres lets SSL query
    // parameters replace the explicit `ssl` option, so remove them here.
    for (const parameter of ['sslmode', 'sslcert', 'sslkey', 'sslrootcert']) {
      parsed.searchParams.delete(parameter);
    }
    return { url: parsed.toString(), ssl: resolveSsl(host, env) };
  }

  if (!host || !database || !user || !password) {
    const selectedUser = mode === 'migrations' && (env.SQL_ADMIN_USER || env.SQL_ADMIN_PASSWORD)
      ? 'SQL_ADMIN_USER and SQL_ADMIN_PASSWORD'
      : 'SQL_USER and SQL_PASSWORD';
    throw new Error(
      `Database configuration is incomplete. Set DATABASE_URL, or set SQL_HOST, SQL_DB_NAME, ${selectedUser}.`,
    );
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('SQL_PORT must be an integer between 1 and 65535.');
  }

  return { host, port, database, user, password, ssl: resolveSsl(host, env) };
}
