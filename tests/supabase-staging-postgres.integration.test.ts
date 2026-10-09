import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Pool } from 'pg';
import {
  loadStagingRunnerDependencies,
  openPostgresRuntime,
  runSupabaseStagingOperations,
} from '../scripts/supabase-staging-runner.ts';
import type { StagingDatabaseSettings } from '../src/db/supabase-staging-guard.ts';

const enabled = process.env.RUN_SUPABASE_STAGING_PG_TESTS === 'true';
if (process.env.RUN_SUPABASE_STAGING_PG_TESTS && !enabled) {
  throw new Error('RUN_SUPABASE_STAGING_PG_TESTS must be exactly true when supplied.');
}

function localTargetFromEnvironment(): StagingDatabaseSettings {
  if (process.env.SUPABASE_STAGING_PG_TEST_CONFIRMATION !== 'I_CONFIRM_LOCAL_DISPOSABLE_POSTGRES') {
    throw new Error('Explicit local disposable PostgreSQL confirmation is required.');
  }
  const raw = process.env.SUPABASE_STAGING_PG_TEST_DATABASE_URL;
  if (!raw) throw new Error('Explicit local PostgreSQL test URL is required.');
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error('Local PostgreSQL test URL is invalid.'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.hostname !== '127.0.0.1'
    || url.port !== '55434' || decodeURIComponent(url.pathname.slice(1)) !== 'rcmega_staging_runner_test'
    || decodeURIComponent(url.username) !== 'rcmega_staging_runner'
    || !decodeURIComponent(url.password) || [...url.searchParams].length !== 0) {
    throw new Error('Local PostgreSQL test target must be the explicitly named loopback database on port 55434.');
  }

  const target = { host: url.hostname, port: Number(url.port), database: decodeURIComponent(url.pathname.slice(1)) };
  for (const key of ['DATABASE_URL', 'MIGRATION_DATABASE_URL', 'FRESH_DATABASE_URL']) {
    const configured = process.env[key]?.trim();
    if (!configured) continue;
    let parsed: URL;
    try { parsed = new URL(configured); } catch { throw new Error('A configured application database target cannot be safely compared.'); }
    if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || !parsed.hostname) {
      throw new Error('A configured application database target cannot be safely compared.');
    }
    if (parsed.hostname.toLowerCase() === target.host && Number(parsed.port || 5432) === target.port
      && decodeURIComponent(parsed.pathname.slice(1)) === target.database) {
      throw new Error('Local test target collides with an application or migration database target.');
    }
  }
  const sqlTargetKeys = ['SQL_HOST', 'SQL_PORT', 'SQL_DB_NAME', 'SQL_USER', 'SQL_PASSWORD', 'SQL_ADMIN_USER', 'SQL_ADMIN_PASSWORD'];
  if (sqlTargetKeys.some((key) => process.env[key]?.trim())) {
    if (!process.env.SQL_HOST || !process.env.SQL_DB_NAME) throw new Error('Discrete SQL target cannot be safely compared.');
    if (process.env.SQL_HOST.toLowerCase() === target.host
      && Number(process.env.SQL_PORT || 5432) === target.port && process.env.SQL_DB_NAME === target.database) {
      throw new Error('Local test target collides with a discrete application database target.');
    }
  }

  return {
    host: target.host,
    port: target.port,
    database: target.database,
    user: decodeURIComponent(url.username),
    effectiveUser: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    projectRef: 'localtest000000000000',
    schema: 'public',
    ssl: false,
    fingerprint: `${target.host}:${target.port}/${target.database}/${decodeURIComponent(url.username)}`,
  };
}

if (!enabled) {
  describe('Supabase staging runner PostgreSQL integration', () => {
    it.skip('requires explicit opt-in, confirmation, and the dedicated loopback target', () => {});
  });
} else {
  // Invalid explicit opt-in fails during test setup, before a Pool is constructed.
  const settings = localTargetFromEnvironment();
  describe('Supabase staging runner PostgreSQL integration', () => {
    it('executes catalog preflight, baseline, migration 0006, and fail-closed cases against real PostgreSQL', async () => {
      const pool = new Pool({
        host: settings.host, port: settings.port, database: settings.database, user: settings.user,
        password: settings.password, ssl: false, max: 1, connectionTimeoutMillis: 4000,
      });
      const failures: string[] = [];
      const run = async (mode: 'initialize' | 'migrate') => runSupabaseStagingOperations(
        mode,
        settings,
        await loadStagingRunnerDependencies((guardSettings) => openPostgresRuntime({ ...guardSettings, ssl: false })),
        (message) => failures.push(message),
      );
      const inspect = async () => {
        const identity = await pool.query<{ database: string; user: string; schema: string; server_port: number }>(
          `SELECT current_database() AS database, current_user AS user, current_schema() AS schema, inet_server_port() AS server_port`,
        );
        return identity.rows[0]!;
      };
      const dropTableIfCreated = async (schema: string, table: string) => {
        await pool.query(`DROP TABLE IF EXISTS "${schema}"."${table}"`);
      };

      try {
        const identity = await inspect();
        assert.equal(identity.database, 'rcmega_staging_runner_test');
        assert.equal(identity.user, 'rcmega_staging_runner');
        assert.equal(identity.schema, 'public');
        assert.equal(Number(identity.server_port), 5432, 'container PostgreSQL port is checked independently of host port 55434');

        const initial = await pool.query<{ schema_name: string }>(`SELECT schema_name FROM information_schema.schemata WHERE schema_name IN ('auth','storage','drizzle','supabase_migrations')`);
        assert.deepEqual(initial.rows.map((row) => row.schema_name).sort(), []);
        await pool.query('CREATE SCHEMA auth');
        await pool.query('CREATE TABLE auth.staging_sentinel (marker text NOT NULL)');
        await pool.query("INSERT INTO auth.staging_sentinel VALUES ('auth-preserved')");
        await pool.query('CREATE SCHEMA storage');
        await pool.query('CREATE TABLE storage.staging_sentinel (marker text NOT NULL)');
        await pool.query("INSERT INTO storage.staging_sentinel VALUES ('storage-preserved')");

        // Each failure fixture is created and removed by this suite in its own disposable database.
        await pool.query('CREATE TABLE public.unexpected_staging_relation (id integer)');
        assert.equal(await run('initialize'), 1);
        await dropTableIfCreated('public', 'unexpected_staging_relation');
        assert.deepEqual(failures.at(-1)?.match(/\[SUPABASE_STAGING_([A-Z_]+)\]/)?.[1], 'PREFLIGHT_FAILED');

        await pool.query('CREATE TABLE public.products (id integer)');
        assert.equal(await run('initialize'), 1);
        await dropTableIfCreated('public', 'products');
        assert.equal(failures.at(-1)?.match(/\[SUPABASE_STAGING_([A-Z_]+)\]/)?.[1], 'PREFLIGHT_FAILED');

        await pool.query('CREATE SCHEMA drizzle');
        await pool.query('CREATE TABLE drizzle.staging_conflict (id integer)');
        assert.equal(await run('initialize'), 1);
        await dropTableIfCreated('drizzle', 'staging_conflict');
        await pool.query('DROP SCHEMA drizzle');
        assert.equal(failures.at(-1)?.match(/\[SUPABASE_STAGING_([A-Z_]+)\]/)?.[1], 'PREFLIGHT_FAILED');

        await pool.query('CREATE SCHEMA supabase_migrations');
        await pool.query('CREATE TABLE supabase_migrations.schema_migrations (version text)');
        assert.equal(await run('initialize'), 1);
        await dropTableIfCreated('supabase_migrations', 'schema_migrations');
        await pool.query('DROP SCHEMA supabase_migrations');
        assert.equal(failures.at(-1)?.match(/\[SUPABASE_STAGING_([A-Z_]+)\]/)?.[1], 'PREFLIGHT_FAILED');

        const baseline = await loadStagingRunnerDependencies((guardSettings) => openPostgresRuntime({ ...guardSettings, ssl: false }));
        const initializeResult = await run('initialize');
        if (initializeResult !== 0) {
          const diagnosticRuntime = await openPostgresRuntime({ ...settings, ssl: false });
          try {
            const state = await diagnosticRuntime.inspect();
            const columnMismatches = Object.entries(baseline.expectedBaselineColumns).flatMap(([table, expected]) => {
              const actual = new Map((state.applicationColumns[table] ?? []).map((column) => [column.name, column]));
              return expected.flatMap((column) => {
                const got = actual.get(column.name);
                const expectedType = column.type === 'serial' ? 'integer'
                  : column.type === 'bigserial' ? 'bigint'
                    : column.type === 'timestamp' ? 'timestamp without time zone'
                      : column.type.replace(/\s*,\s*/g, ',');
                return !got || got.type.replace(/\s*,\s*/g, ',') !== expectedType || got.notNull !== column.notNull || got.hasDefault !== column.hasDefault
                  ? [`${table}.${column.name}:${got?.type ?? 'missing'}`] : [];
              });
            });
            const missingIndexes = baseline.expectedBaselineIndexes.filter((name) => !state.applicationIndexes.includes(name));
            const actualConstraints = new Set(state.applicationConstraints);
            const missingConstraints = baseline.expectedBaselineConstraints.filter((name) => !actualConstraints.has(name));
            const extraConstraints = [...actualConstraints].filter((name) => !baseline.expectedBaselineConstraints.includes(name));
            const permitted = new Set([
              ...baseline.expectedBaselineTables,
              ...baseline.expectedBaselineTables.map((table) => `${table}_id_seq`),
              ...baseline.expectedBaselineTables.map((table) => `${table}_pkey`),
              ...baseline.expectedBaselineIndexes,
              ...baseline.expectedBaselineConstraints,
            ]);
            const unexpectedPublic = state.publicObjects.filter((object) => !object.extensionOwned && (object.kind !== 'relation' || !permitted.has(object.name))).map((object) => object.name);
            throw new Error(`baseline verification failed; category=${failures.at(-1)}; tables=${state.applicationTables.length}; columnMismatches=${columnMismatches.join(',')}; missingIndexes=${missingIndexes.join(',')}; missingConstraints=${missingConstraints.join(',')}; extraConstraints=${extraConstraints.join(',')}; historyRows=${state.migrationHistory.length}; drizzleSchema=${state.drizzleSchemaExists}; drizzleRelations=${state.drizzleRelations.join(',')}; appRls=${state.applicationRlsTables.join(',')}; appPolicies=${state.applicationPolicies.join(',')}; unexpectedPublic=${unexpectedPublic.join(',')}`);
          } finally {
            await diagnosticRuntime.close();
          }
        }
        assert.equal(initializeResult, 0, failures.at(-1));
        const afterBaseline = await pool.query<{ count: string; baseline_count: string; contact_exists: boolean }>(`
          SELECT (SELECT count(*) FROM pg_tables WHERE schemaname = 'public')::text AS count,
                 (SELECT count(*) FROM drizzle.__drizzle_migrations WHERE created_at = $1)::text AS baseline_count,
                 to_regclass('public.contact_inquiries') IS NOT NULL AS contact_exists
        `, [baseline.baseline.when]);
        assert.equal(Number(afterBaseline.rows[0]?.count), baseline.expectedBaselineTables.length);
        assert.equal(Number(afterBaseline.rows[0]?.baseline_count), 1);
        assert.equal(afterBaseline.rows[0]?.contact_exists, false);

        assert.equal(await run('migrate'), 0, failures.at(-1));
        const history = await pool.query<{ created_at: string; hash: string }>(
          'SELECT created_at::text AS created_at, hash FROM drizzle.__drizzle_migrations ORDER BY created_at, id',
        );
        assert.equal(history.rows.length, 2, 'baseline and 0006 are the only applied migration records');
        assert.equal(Number(history.rows[0]?.created_at), baseline.baseline.when);
        assert.equal(Number(history.rows[1]?.created_at), baseline.forward[0]?.when);
        assert.equal(baseline.forward[0]?.tag, '0006_contact-inquiries');
        assert.equal(baseline.forward.filter((entry) => entry.tag === '0006_contact-inquiries').length, 1);
        assert.equal(history.rows.filter((row) => Number(row.created_at) === baseline.forward[0]?.when).length, 1);

        const inquirySchema = await pool.query<{ column_name: string; data_type: string; is_nullable: string; column_default: string | null }>(`
          SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'contact_inquiries' ORDER BY ordinal_position
        `);
        assert.deepEqual(inquirySchema.rows.map((row) => row.column_name), ['id','name','email','phone','inquiry_type','model','message','status','created_at']);
        assert.equal(inquirySchema.rows.find((row) => row.column_name === 'status')?.column_default?.includes('NEW'), true);
        assert.equal(inquirySchema.rows.find((row) => row.column_name === 'created_at')?.column_default?.toLowerCase().includes('now()'), true);
        assert.equal(inquirySchema.rows.find((row) => row.column_name === 'message')?.is_nullable, 'NO');
        const inquiryObjects = await pool.query<{ indexname: string; indexdef: string }>(
          `SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'contact_inquiries'`,
        );
        assert.equal(inquiryObjects.rows.some((row) => row.indexname === 'contact_inquiries_created_at_idx'), true);
        const statusConstraint = await pool.query<{ definition: string }>(`
          SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
          WHERE conrelid = 'public.contact_inquiries'::regclass AND conname = 'contact_inquiries_status_valid'
        `);
        assert.match(statusConstraint.rows[0]?.definition ?? '', /NEW.*REVIEWED.*CLOSED/);

        const sentinels = await pool.query<{ schema_name: string; marker: string }>(`
          SELECT 'auth' AS schema_name, marker FROM auth.staging_sentinel
          UNION ALL SELECT 'storage' AS schema_name, marker FROM storage.staging_sentinel ORDER BY schema_name
        `);
        assert.deepEqual(sentinels.rows, [
          { schema_name: 'auth', marker: 'auth-preserved' },
          { schema_name: 'storage', marker: 'storage-preserved' },
        ]);
        const forwardOrdering = await Promise.all(baseline.forward.map(async (entry, index) => ({
          when: entry.when,
          next: baseline.forward[index + 1]?.when,
        })));
        assert.ok(forwardOrdering.every((entry) => entry.when > baseline.baseline.when && (!entry.next || entry.next > entry.when)));
      } finally {
        await pool.end();
      }
    });
  });
}
