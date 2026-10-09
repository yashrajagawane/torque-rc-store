import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertFreshDatabaseIdentity, resolveFreshDatabaseSettings, type FreshDatabaseSettings } from '../src/db/fresh-database-guard.ts';

export type FreshInitializationStage =
  | 'CONFIGURATION_INVALID'
  | 'BASELINE_HISTORY_INVALID'
  | 'CONNECTION_SETUP_FAILED'
  | 'DATABASE_IDENTITY_FAILED'
  | 'DATABASE_EMPTY_CHECK_FAILED'
  | 'DATABASE_NOT_EMPTY'
  | 'BASELINE_MIGRATION_FAILED'
  | 'CLEANUP_FAILED';

export class FreshInitializationError extends Error {
  readonly code?: string;

  constructor(readonly stage: FreshInitializationStage, options?: { cause?: unknown }) {
    super(stage, options);
    this.name = 'FreshInitializationError';
    this.code = postgresSqlState(options?.cause);
  }
}

type FreshDatabaseRuntime = {
  verifyIdentity: () => Promise<void>;
  verifyEmptyTarget: () => Promise<void>;
  applyBaseline: () => Promise<void>;
  close: () => Promise<void>;
};

export type FreshDatabaseRuntimeForTests = FreshDatabaseRuntime;

const diagnosticText: Record<FreshInitializationStage, string> = {
  CONFIGURATION_INVALID: 'Fresh database configuration validation failed.',
  BASELINE_HISTORY_INVALID: 'Fresh baseline migration history validation failed.',
  CONNECTION_SETUP_FAILED: 'Fresh database connection setup failed.',
  DATABASE_IDENTITY_FAILED: 'Connected database identity verification failed.',
  DATABASE_EMPTY_CHECK_FAILED: 'Fresh database emptiness verification failed.',
  DATABASE_NOT_EMPTY: 'Fresh database contains existing schema objects and was not initialized.',
  BASELINE_MIGRATION_FAILED: 'Fresh schema baseline or migration-history setup failed.',
  CLEANUP_FAILED: 'Fresh database connection cleanup failed.',
};

const sqlStateClassText: Record<string, string> = {
  '08': 'connection exception',
  '28': 'authentication exception',
  '3D': 'invalid catalog name',
  '40': 'transaction rollback',
  '42': 'SQL syntax or access rule error',
  '53': 'insufficient resources',
  '55': 'object not in prerequisite state',
  '57': 'operator intervention',
  '58': 'system error',
};

function postgresSqlState(error: unknown): string | undefined {
  if (!error || typeof error !== 'object' || !('code' in error)) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code) ? code : undefined;
}

function reportFailure(report: (message: string) => void, stage: FreshInitializationStage, error?: unknown) {
  const code = postgresSqlState(error);
  const className = code ? sqlStateClassText[code.slice(0, 2)] : undefined;
  const sqlStateNote = code ? ` SQLSTATE ${code}${className ? ` (${className})` : ''}.` : '';
  report(`[${stage}] ${diagnosticText[stage]}${sqlStateNote}`);
}

function stageOf(error: unknown, fallback: FreshInitializationStage): FreshInitializationStage {
  return error instanceof FreshInitializationError ? error.stage : fallback;
}

export async function runFreshDatabaseInitialization(
  args: string[],
  env: Record<string, string | undefined>,
  openRuntime: (settings: FreshDatabaseSettings) => Promise<FreshDatabaseRuntime>,
  report: (message: string) => void = () => undefined,
): Promise<number> {
  let settings: FreshDatabaseSettings;
  try {
    settings = resolveFreshDatabaseSettings(args, env);
  } catch {
    reportFailure(report, 'CONFIGURATION_INVALID');
    return 2;
  }

  let runtime: FreshDatabaseRuntime | undefined;
  let exitCode = 0;
  let activeStage: FreshInitializationStage = 'CONNECTION_SETUP_FAILED';
  try {
    runtime = await openRuntime(settings);
    activeStage = 'DATABASE_IDENTITY_FAILED';
    await runtime.verifyIdentity();
    activeStage = 'DATABASE_EMPTY_CHECK_FAILED';
    await runtime.verifyEmptyTarget();
    activeStage = 'BASELINE_MIGRATION_FAILED';
    await runtime.applyBaseline();
    report('Fresh application schema initialized successfully.');
  } catch (error) {
    reportFailure(report, stageOf(error, activeStage), error);
    exitCode = 1;
  } finally {
    if (runtime) {
      try {
        await runtime.close();
      } catch (error) {
        reportFailure(report, 'CLEANUP_FAILED', error);
        exitCode = 1;
      }
    }
  }
  return exitCode;
}

export function validateFreshBaselineHistory(freshJournalText: string, legacyJournalText: string): void {
  try {
    const freshJournal = JSON.parse(freshJournalText) as { entries?: Array<{ tag?: string; when?: number }> };
    const legacyJournal = JSON.parse(legacyJournalText) as { entries?: Array<{ tag?: string; when?: number }> };
    const baseline = freshJournal.entries?.[0];
    const legacyEntries = legacyJournal.entries ?? [];
    const representedTags = [
      '0000_products-publication-status',
      '0001_customer-cart',
      '0002_cart-merge-idempotency',
      '0003_checkout-orders',
      '0004_inventory-reservations',
      '0005_razorpay-test-payments',
    ];
    const representedEntries = legacyEntries.slice(0, representedTags.length);
    const forwardEntries = legacyEntries.slice(representedTags.length);
    if (
      freshJournal.entries?.length !== 1
      || baseline?.tag !== '0000_application-baseline'
      || typeof baseline.when !== 'number'
      || !Number.isSafeInteger(baseline.when)
      || representedEntries.length !== representedTags.length
      || representedEntries.some((entry, index) => entry.tag !== representedTags[index] || !Number.isSafeInteger(entry.when))
      || representedEntries.some((entry, index) => index > 0 && entry.when! <= representedEntries[index - 1]!.when!)
      || baseline.when <= representedEntries.at(-1)!.when!
      || forwardEntries.length === 0
      || forwardEntries.some((entry) => typeof entry.tag !== 'string' || !Number.isSafeInteger(entry.when) || entry.when! <= baseline.when!)
      || forwardEntries.some((entry, index) => index > 0 && entry.when! <= forwardEntries[index - 1]!.when!)
      || forwardEntries[0]?.tag !== '0006_contact-inquiries'
    ) {
      throw new Error('invalid journal');
    }
  } catch {
    throw new FreshInitializationError('BASELINE_HISTORY_INVALID');
  }
}

async function openPostgresRuntime(settings: FreshDatabaseSettings): Promise<FreshDatabaseRuntime> {
  const [freshJournalText, legacyJournalText] = await Promise.all([
    readFile('./drizzle/fresh/meta/_journal.json', 'utf8'),
    readFile('./drizzle/meta/_journal.json', 'utf8'),
  ]).catch(() => { throw new FreshInitializationError('BASELINE_HISTORY_INVALID'); });
  validateFreshBaselineHistory(freshJournalText, legacyJournalText);

  let Pool: (typeof import('pg'))['Pool'];
  let drizzle: (typeof import('drizzle-orm/node-postgres'))['drizzle'];
  let migrate: (typeof import('drizzle-orm/node-postgres/migrator'))['migrate'];
  try {
    [{ Pool }, { drizzle }, { migrate }] = await Promise.all([
      import('pg'),
      import('drizzle-orm/node-postgres'),
      import('drizzle-orm/node-postgres/migrator'),
    ]);
  } catch {
    throw new FreshInitializationError('CONNECTION_SETUP_FAILED');
  }

  let pool: InstanceType<typeof Pool>;
  try {
    pool = new Pool({
      host: settings.host,
      port: settings.port,
      database: settings.database,
      user: settings.user,
      password: settings.password,
      ssl: settings.ssl,
      application_name: 'rcmega-fresh-database-initializer',
      max: 1,
      connectionTimeoutMillis: 5_000,
    });
  } catch {
    throw new FreshInitializationError('CONNECTION_SETUP_FAILED');
  }
  const db = drizzle(pool);

  return {
    verifyIdentity: async () => {
      let identity;
      try {
        identity = await pool.query<{ current_database: string; current_user: string }>(
          'SELECT current_database(), current_user',
        );
      } catch (error) {
        throw new FreshInitializationError('CONNECTION_SETUP_FAILED', { cause: error });
      }
      const row = identity.rows[0];
      try {
        if (!row) throw new Error('identity unavailable');
        assertFreshDatabaseIdentity({ database: row.current_database, user: row.current_user }, settings);
      } catch {
        throw new FreshInitializationError('DATABASE_IDENTITY_FAILED');
      }
    },
    verifyEmptyTarget: async () => {
      let objects;
      try {
        objects = await pool.query<{ object_count: string }>(`
          SELECT count(*)::text AS object_count
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
            AND n.nspname NOT LIKE 'pg_toast%'
            AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
        `);
      } catch (error) {
        throw new FreshInitializationError('DATABASE_EMPTY_CHECK_FAILED', { cause: error });
      }
      if (Number(objects.rows[0]?.object_count ?? -1) !== 0) {
        throw new FreshInitializationError('DATABASE_NOT_EMPTY');
      }
    },
    applyBaseline: async () => {
      try {
        await migrate(drizzle(pool), {
          migrationsFolder: './drizzle/fresh',
          migrationsSchema: 'drizzle',
          migrationsTable: '__drizzle_migrations',
        });
      } catch (error) {
        throw new FreshInitializationError('BASELINE_MIGRATION_FAILED', { cause: error });
      }
    },
    close: async () => { await pool.end(); },
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const code = await runFreshDatabaseInitialization(process.argv.slice(2), process.env, openPostgresRuntime, (message) => {
    console.log(message);
  });
  process.exitCode = code;
}
