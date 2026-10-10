import assert from 'node:assert/strict';
import { parse as parsePgConnectionString } from 'pg-connection-string';
import { resolve } from 'node:path';
import { checkServerIdentity } from 'node:tls';
import { describe, it } from 'node:test';
import { resolveSupabaseStagingSettings } from '../src/db/supabase-staging-guard.ts';
import {
  formatProbeFailure,
  inspectProbeIdentityChecks,
  openReadOnlyStagingIdentityProbe,
  runSupabaseStagingIdentityProbe,
  type StagingIdentityProbe,
} from '../scripts/supabase-staging-probe.ts';
import {
  loadVerifiedSupabaseStagingSslOptions,
  SupabaseStagingCaConfigurationError,
} from '../src/db/supabase-staging-tls.ts';

const projectRef = 'vgxttbzmgnpvggilxjne';
const baseEnv: Record<string, string | undefined> = {
  SUPABASE_STAGING_ENABLED: 'true',
  SUPABASE_NO_PRODUCTION_PROJECT: 'true',
  SUPABASE_NO_PRODUCTION_PROJECT_CONFIRMATION: 'I_CONFIRM_NO_PRODUCTION_SUPABASE_PROJECT',
  SUPABASE_STAGING_PROJECT_REF: projectRef,
  SUPABASE_STAGING_DATABASE_URL: `postgresql://postgres.${projectRef}:not-a-real-password@aws-0-ap-south-1.pooler.supabase.com:6543/postgres?sslmode=require`,
  SUPABASE_STAGING_DATABASE_HOST: 'aws-0-ap-south-1.pooler.supabase.com',
  SUPABASE_STAGING_DATABASE_PORT: '6543',
  SUPABASE_STAGING_DATABASE_NAME: 'postgres',
  SUPABASE_STAGING_DATABASE_USER: `postgres.${projectRef}`,
  SUPABASE_STAGING_DATABASE_CA_FILE: resolve('test-fixtures', 'supabase-staging-root-ca.pem'),
  SUPABASE_STAGING_SCHEMA: 'public',
  SUPABASE_STAGING_TARGET_FINGERPRINT: `aws-0-ap-south-1.pooler.supabase.com:6543/postgres/postgres.${projectRef}`,
  SUPABASE_STAGING_PROBE_CONFIRMATION: 'I_CONFIRM_READ_ONLY_SUPABASE_STAGING_IDENTITY_PROBE',
};
const probeArgs = ['--confirm-staging-identity-probe'];
const validIdentity: StagingIdentityProbe = {
  database: 'postgres',
  sessionUser: `postgres.${projectRef}`,
  currentUser: 'postgres',
  currentSchema: 'public',
  searchPath: 'public',
  serverPort: 5432,
  transactionReadOnly: true,
  isSuperuser: true,
  bypassesRls: true,
};

describe('Supabase staging connection identity probe', () => {
  it('resolves the explicitly fingerprinted no-production pooler without effective-role inputs', () => {
    const settings = resolveSupabaseStagingSettings('probe', probeArgs, baseEnv);
    assert.equal(settings.projectRef, projectRef);
    assert.equal(settings.host, 'aws-0-ap-south-1.pooler.supabase.com');
    assert.equal(settings.port, 6543);
    assert.equal(settings.database, 'postgres');
    assert.equal(settings.user, `postgres.${projectRef}`);
    assert.equal(settings.ssl, true);
    assert.equal('effectiveUser' in settings, false);
    assert.equal('runtimeUser' in settings, false);
  });

  it('rejects wrong targets, collisions, and missing confirmations before connecting', async () => {
    const invalid: Array<Record<string, string | undefined>> = [
      { ...baseEnv, SUPABASE_STAGING_DATABASE_HOST: 'wrong.pooler.supabase.com' },
      { ...baseEnv, SUPABASE_STAGING_TARGET_FINGERPRINT: 'wrong-fingerprint' },
      { ...baseEnv, SUPABASE_STAGING_PROJECT_REF: 'abcdefghijklmnopqrst' },
      { ...baseEnv, SUPABASE_PRODUCTION_PROJECT_REF: ' ' },
      { ...baseEnv, SUPABASE_NO_PRODUCTION_PROJECT_CONFIRMATION: undefined },
      { ...baseEnv, SUPABASE_STAGING_PROBE_CONFIRMATION: undefined },
      { ...baseEnv, SUPABASE_STAGING_DATABASE_URL: undefined, DATABASE_URL: 'postgresql://app:secret@prod.example.com:5432/postgres' },
      { ...baseEnv, DATABASE_URL: baseEnv.SUPABASE_STAGING_DATABASE_URL },
    ];
    let opened = false;
    for (const env of invalid) {
      const messages: string[] = [];
      const code = await runSupabaseStagingIdentityProbe(probeArgs, env, {
        open: async () => { opened = true; throw new Error('must not connect'); },
      }, (message) => messages.push(message));
      assert.equal(code, 2);
      assert.ok(messages.some((message) => message.includes('SUPABASE_STAGING_PROBE_CONFIGURATION_INVALID')));
    }
    assert.equal(opened, false);
  });

  it('requires an absolute staging CA file path as part of the explicit configuration', async () => {
    for (const caPath of [undefined, 'relative-ca.pem']) {
      let opened = false;
      const messages: string[] = [];
      const code = await runSupabaseStagingIdentityProbe(probeArgs, {
        ...baseEnv,
        SUPABASE_STAGING_DATABASE_CA_FILE: caPath,
      }, { open: async () => { opened = true; throw new Error('must not connect'); } }, (line) => messages.push(line));
      assert.equal(code, 2);
      assert.equal(opened, false);
      assert.ok(messages.some((line) => line.includes('CONFIGURATION_INVALID')));
    }
  });

  it('builds strict TLS options from a validated CA bundle and retains hostname verification', async () => {
    const options = await loadVerifiedSupabaseStagingSslOptions(resolve('test-ca.pem'), {
      readFile: async (path, encoding) => {
        assert.equal(path, resolve('test-ca.pem'));
        assert.equal(encoding, 'utf8');
        return 'mock official CA bundle';
      },
      validateCertificate: (pem) => assert.equal(pem, 'mock official CA bundle'),
    });
    assert.equal(options.ca, 'mock official CA bundle');
    assert.equal(options.rejectUnauthorized, true);
    assert.equal(options.checkServerIdentity, checkServerIdentity);
    assert.equal(checkServerIdentity('aws-0-ap-south-1.pooler.supabase.com', {
      subject: {},
      subjectaltname: 'DNS:*.pooler.supabase.com',
    } as Parameters<typeof checkServerIdentity>[1]), undefined);
    assert.ok(checkServerIdentity('unexpected.example.test', {
      subject: {},
      subjectaltname: 'DNS:*.pooler.supabase.com',
    } as Parameters<typeof checkServerIdentity>[1]) instanceof Error);
  });

  it('keeps pg URL SSL parsing away from the explicit staging TLS configuration', () => {
    const parsed = parsePgConnectionString(baseEnv.SUPABASE_STAGING_DATABASE_URL!);
    assert.deepEqual(parsed.ssl, {});
    const settings = resolveSupabaseStagingSettings('probe', probeArgs, baseEnv);
    assert.equal(settings.ssl, true);
    assert.equal(settings.host, 'aws-0-ap-south-1.pooler.supabase.com');
  });

  it('rejects an absent CA file with a sanitized configuration error before creating a pool', async () => {
    await assert.rejects(
      loadVerifiedSupabaseStagingSslOptions(resolve('missing-staging-ca-secret-path.pem')),
      SupabaseStagingCaConfigurationError,
    );
    let poolCreated = false;
    const settings = resolveSupabaseStagingSettings('probe', probeArgs, baseEnv);
    await assert.rejects(openReadOnlyStagingIdentityProbe(settings, () => {
      poolCreated = true;
      throw new Error('must not create a pool');
    }), SupabaseStagingCaConfigurationError);
    assert.equal(poolCreated, false);
  });

  it('rejects malformed CA material without exposing its contents or path', async () => {
    const messages: string[] = [];
    await assert.rejects(
      loadVerifiedSupabaseStagingSslOptions(resolve('private-staging-ca.pem'), {
        readFile: async () => 'password=do-not-print; postgresql://secret@example.test',
        validateCertificate: () => { throw new Error('raw certificate parse failure'); },
      }).catch((error: unknown) => {
        messages.push(error instanceof Error ? error.message : String(error));
        throw error;
      }),
      SupabaseStagingCaConfigurationError,
    );
    assert.deepEqual(messages, ['A readable, valid official Supabase staging database CA certificate file is required.']);
    assert.ok(messages.every((message) => !message.includes('do-not-print') && !message.includes('example.test')));
  });

  it('reports sanitized identity and role flags, closes on success, and exposes no migration operation', async () => {
    let closed = false;
    const messages: string[] = [];
    const code = await runSupabaseStagingIdentityProbe(probeArgs, baseEnv, {
      open: async (settings) => {
        assert.equal(settings.host, baseEnv.SUPABASE_STAGING_DATABASE_HOST);
        assert.equal(settings.port, 6543);
        assert.equal(settings.ssl, true);
        const readOnlyRuntime = {
          inspectIdentity: async () => validIdentity,
          close: async () => { closed = true; },
        };
        assert.equal('applyBaseline' in readOnlyRuntime, false);
        assert.equal('applyForwardMigrations' in readOnlyRuntime, false);
        return readOnlyRuntime;
      },
    }, (message) => messages.push(message));
    assert.equal(code, 0);
    assert.equal(closed, true);
    assert.ok(messages.some((message) => message.includes('session_user=postgres.vgxttbzmgnpvggilxjne')));
    assert.ok(messages.some((message) => message.includes('current_user=postgres')));
    assert.ok(messages.some((message) => message.includes('server_port=5432')));
    assert.ok(messages.some((message) => message.includes('superuser=true; bypasses_rls=true')));
    assert.ok(messages.every((message) => !message.includes('not-a-real-password') && !message.includes('postgresql://')));
  });

  it('closes the runtime when identity inspection fails and never prints raw errors', async () => {
    let closed = false;
    const messages: string[] = [];
    const code = await runSupabaseStagingIdentityProbe(probeArgs, baseEnv, {
      open: async () => ({
        inspectIdentity: async () => { throw new Error('postgresql://secret-password@private-host'); },
        close: async () => { closed = true; },
      }),
    }, (message) => messages.push(message));
    assert.equal(code, 1);
    assert.equal(closed, true);
    assert.ok(messages.some((message) => message.includes('SUPABASE_STAGING_PROBE_IDENTITY_QUERY_FAILED')));
    assert.ok(messages.every((message) => !message.includes('secret-password') && !message.includes('private-host')));
  });

  it('classifies recognized errors and emits only allowlisted Node codes or validated SQLSTATE values', () => {
    const failure = (phase: 'connection' | 'identity-query' | 'identity-validation' | 'connection-close', code: string) => {
      const error = new Error('password=hunter2 postgresql://user:secret@private-host') as Error & { code: string };
      error.code = code;
      return formatProbeFailure(phase, error);
    };
    assert.match(failure('connection', 'ENOTFOUND'), /DNS_OR_NETWORK_FAILURE.*system_code=ENOTFOUND/);
    assert.match(failure('connection', 'ERR_TLS_CERT_ALTNAME_INVALID'), /TLS_FAILURE.*system_code=ERR_TLS_CERT_ALTNAME_INVALID/);
    assert.match(failure('connection', '28P01'), /AUTHENTICATION_FAILED.*sqlstate=28P01/);
    assert.match(failure('connection', '53300'), /DATABASE_CONNECTION_REJECTED.*sqlstate=53300/);
    assert.match(failure('identity-query', '42501'), /IDENTITY_QUERY_FAILED.*sqlstate=42501/);
    assert.match(failure('identity-validation', 'secret'), /IDENTITY_MISMATCH/);
    assert.match(failure('connection-close', 'ECONNRESET'), /CONNECTION_CLOSE_FAILED.*system_code=ECONNRESET/);
    const unknown = failure('connection', 'url=postgresql://host/path');
    assert.match(unknown, /UNKNOWN_PROBE_FAILURE/);
    const malformedState = failure('identity-query', '28P01 password=hunter2');
    assert.match(malformedState, /IDENTITY_QUERY_FAILED/);
    assert.ok(!malformedState.includes('sqlstate='));
    for (const message of [
      failure('connection', 'ENOTFOUND'), failure('connection', 'ERR_TLS_CERT_ALTNAME_INVALID'),
      failure('connection', '28P01'), failure('connection', '53300'), failure('identity-query', '42501'),
      failure('identity-validation', 'secret'), failure('connection-close', 'ECONNRESET'), unknown, malformedState,
    ]) {
      assert.ok(!/hunter2|postgresql:\/\/|private-host|secret@/.test(message));
    }
  });

  it('closes the pool when connection establishment fails and reports a sanitized connection category', async () => {
    let ended = false;
    const messages: string[] = [];
    const code = await runSupabaseStagingIdentityProbe(probeArgs, baseEnv, {
      open: (settings) => openReadOnlyStagingIdentityProbe(settings, () => ({
        connect: async () => { throw Object.assign(new Error('password=hidden'), { code: 'EAI_AGAIN' }); },
        end: async () => { ended = true; },
      }), async () => ({ ca: 'test CA', rejectUnauthorized: true, checkServerIdentity })),
    }, (message) => messages.push(message));
    assert.equal(code, 1);
    assert.equal(ended, true);
    assert.ok(messages.some((message) => message.includes('SUPABASE_STAGING_PROBE_DNS_OR_NETWORK_FAILURE')));
    assert.ok(messages.every((message) => !message.includes('hidden')));
  });

  it('starts and verifies a read-only transaction before identity SQL, then rolls back on query failure', async () => {
    const queries: string[] = [];
    let released = false;
    let ended = false;
    const messages: string[] = [];
    const code = await runSupabaseStagingIdentityProbe(probeArgs, baseEnv, {
      open: (settings) => openReadOnlyStagingIdentityProbe(settings, (options) => {
        assert.equal(typeof options.ssl, 'object');
        if (options.ssl !== false) {
          assert.equal(options.ssl.rejectUnauthorized, true);
          assert.equal(options.ssl.checkServerIdentity, checkServerIdentity);
        }
        assert.ok(!('connectionString' in options));
        assert.equal(options.host, baseEnv.SUPABASE_STAGING_DATABASE_HOST);
        assert.equal(options.port, 6543);
        assert.equal(options.options, '-c search_path=public');
        return {
          connect: async () => ({
            query: async <T>(sql: string) => {
              queries.push(sql);
              if (sql === 'BEGIN READ ONLY' || sql === 'ROLLBACK') return { rows: [] as T[] };
              if (sql === "SELECT current_setting('transaction_read_only') AS transaction_read_only") {
                return { rows: [{ transaction_read_only: 'on' } as T] };
              }
              throw Object.assign(new Error('secret query detail'), { code: '42501' });
            },
            release: () => { released = true; },
          }),
          end: async () => { ended = true; },
        };
      }, async () => ({ ca: 'test CA', rejectUnauthorized: true, checkServerIdentity })),
    }, (message) => messages.push(message));
    assert.equal(code, 1);
    assert.deepEqual(queries.map((sql) => sql === 'BEGIN READ ONLY' || sql === 'ROLLBACK' ? sql : sql === "SELECT current_setting('transaction_read_only') AS transaction_read_only" ? 'READ_ONLY_STATUS' : 'IDENTITY'), [
      'BEGIN READ ONLY', 'READ_ONLY_STATUS', 'IDENTITY', 'ROLLBACK',
    ]);
    assert.equal(released, true);
    assert.equal(ended, true);
    assert.ok(messages.some((message) => message.includes('IDENTITY_QUERY_FAILED') && message.includes('sqlstate=42501')));
    assert.ok(messages.every((message) => !message.includes('secret query detail')));
  });

  it('uses one bounded client for the read-only check and identity query, then rolls back', async () => {
    const settings = resolveSupabaseStagingSettings('probe', probeArgs, baseEnv);
    const queries: string[] = [];
    let released = false;
    let ended = false;
    const runtime = await openReadOnlyStagingIdentityProbe(settings, (options) => {
      assert.equal(options.max, 1);
      assert.equal(options.connectionTimeoutMillis, 5000);
      assert.equal(options.statement_timeout, 8000);
      assert.equal(typeof options.ssl, 'object');
      if (options.ssl !== false) {
        assert.equal(options.ssl.rejectUnauthorized, true);
        assert.equal(options.ssl.checkServerIdentity, checkServerIdentity);
      }
      return {
        connect: async () => ({
          query: async <T>(sql: string) => {
            queries.push(sql);
            if (sql === 'BEGIN READ ONLY') return { rows: [] };
            if (sql === "SELECT current_setting('transaction_read_only') AS transaction_read_only") {
              return { rows: [{ transaction_read_only: true }] } as { rows: T[] };
            }
            if (sql === 'ROLLBACK') return { rows: [] };
            return { rows: [{
              database: 'postgres', session_user: `postgres.${projectRef}`, current_user: 'postgres',
              current_schema: 'public', search_path: 'public', server_port: 5432,
              transaction_read_only: true, is_superuser: true, bypasses_rls: true,
            } as T] };
          },
          release: () => { released = true; },
        }),
        end: async () => { ended = true; },
      };
    }, async () => ({ ca: 'test CA', rejectUnauthorized: true, checkServerIdentity }));
    assert.deepEqual(await runtime.inspectIdentity(), validIdentity);
    await runtime.close();
    assert.equal(queries[0], 'BEGIN READ ONLY');
    assert.equal(queries[1], "SELECT current_setting('transaction_read_only') AS transaction_read_only");
    assert.match(queries[2]!, /current_database\(\).*session_user.*current_user/s);
    assert.match(queries[2]!, /rolsuper.*rolbypassrls/s);
    assert.equal(queries[3], 'ROLLBACK');
    assert.ok(queries.every((sql) => sql === 'BEGIN READ ONLY' || sql === 'ROLLBACK' || /^SELECT\b/i.test(sql)));
    assert.ok(queries.every((sql) => !/\b(?:INSERT|UPDATE|DELETE|ALTER|DROP|CREATE|GRANT|REVOKE)\b/i.test(sql)));
    assert.ok(queries.every((sql) => !/products|orders|contact_inquiries/i.test(sql)));
    assert.equal(released, true);
    assert.equal(ended, true);
  });

  it('fails closed before identity inspection when the read-only flag is false or unavailable', async () => {
    for (const statusRows of [[{ transaction_read_only: false }], []]) {
      const queries: string[] = [];
      let released = false;
      let ended = false;
      const messages: string[] = [];
      const code = await runSupabaseStagingIdentityProbe(probeArgs, baseEnv, {
        open: (settings) => openReadOnlyStagingIdentityProbe(settings, () => ({
          connect: async () => ({
            query: async <T>(sql: string) => {
              queries.push(sql);
              if (sql === 'BEGIN READ ONLY' || sql === 'ROLLBACK') return { rows: [] as T[] };
              if (sql === "SELECT current_setting('transaction_read_only') AS transaction_read_only") return { rows: statusRows as T[] };
              assert.fail('identity query must not run before read-only verification');
            },
            release: (error?: Error | boolean) => { released = true; assert.equal(error, true); },
          }),
          end: async () => { ended = true; },
        }), async () => ({ ca: 'test CA', rejectUnauthorized: true, checkServerIdentity })),
      }, (line) => messages.push(line));
      assert.equal(code, 1);
      assert.deepEqual(queries, ['BEGIN READ ONLY', "SELECT current_setting('transaction_read_only') AS transaction_read_only", 'ROLLBACK']);
      assert.equal(released, true);
      assert.equal(ended, true);
      assert.ok(messages.some((line) => line.includes('READ_ONLY_TRANSACTION_REQUIRED')));
      assert.ok(messages.every((line) => !line.includes('secret') && !line.includes('postgresql://')));
    }
  });

  it('returns failure if closing the read-only probe connection fails', async () => {
    const messages: string[] = [];
    const code = await runSupabaseStagingIdentityProbe(probeArgs, baseEnv, {
      open: async () => ({ inspectIdentity: async () => validIdentity, close: async () => { throw new Error('secret'); } }),
    }, (message) => messages.push(message));
    assert.equal(code, 1);
    assert.ok(messages.some((message) => message.includes('SUPABASE_STAGING_PROBE_CONNECTION_CLOSE_FAILED')));
    assert.ok(messages.every((message) => !message.includes('secret')));
  });

  it('rejects a returned identity that does not match the configured database and public read-only session', async () => {
    for (const changed of [
      { ...validIdentity, database: 'other_database' },
      { ...validIdentity, currentSchema: 'private' },
      { ...validIdentity, searchPath: 'public, private' },
      { ...validIdentity, transactionReadOnly: false },
      { ...validIdentity, serverPort: 0 },
    ]) {
      const messages: string[] = [];
      const code = await runSupabaseStagingIdentityProbe(probeArgs, baseEnv, {
        open: async () => ({ inspectIdentity: async () => changed, close: async () => undefined }),
      }, (message) => messages.push(message));
      assert.equal(code, 1);
      assert.ok(messages.some((message) => message.includes('SUPABASE_STAGING_PROBE_IDENTITY_MISMATCH')));
    }
  });

  it('rolls back the verified transaction and releases its client after an identity mismatch', async () => {
    const queries: string[] = [];
    let released = false;
    let ended = false;
    const messages: string[] = [];
    const code = await runSupabaseStagingIdentityProbe(probeArgs, baseEnv, {
      open: (settings) => openReadOnlyStagingIdentityProbe(settings, () => ({
        connect: async () => ({
          query: async <T>(sql: string) => {
            queries.push(sql);
            if (sql === 'BEGIN READ ONLY' || sql === 'ROLLBACK') return { rows: [] as T[] };
            if (sql === "SELECT current_setting('transaction_read_only') AS transaction_read_only") {
              return { rows: [{ transaction_read_only: 'on' } as T] };
            }
            return { rows: [{
              database: 'wrong', session_user: 'role', current_user: 'role', current_schema: 'public',
              search_path: 'public', server_port: 5432, transaction_read_only: true,
              is_superuser: false, bypasses_rls: false,
            } as T] };
          },
          release: () => { released = true; },
        }),
        end: async () => { ended = true; },
      }), async () => ({ ca: 'test CA', rejectUnauthorized: true, checkServerIdentity })),
    }, (line) => messages.push(line));
    assert.equal(code, 1);
    assert.deepEqual(queries.map((sql) => sql === 'BEGIN READ ONLY' || sql === 'ROLLBACK' ? sql : sql === "SELECT current_setting('transaction_read_only') AS transaction_read_only" ? 'READ_ONLY_STATUS' : 'IDENTITY'), [
      'BEGIN READ ONLY', 'READ_ONLY_STATUS', 'IDENTITY', 'ROLLBACK',
    ]);
    assert.equal(released, true);
    assert.equal(ended, true);
    assert.ok(messages.some((line) => line.includes('IDENTITY_MISMATCH')));
  });

  it('reports only the failing identity predicates without printing observed identities', async () => {
    const settings = resolveSupabaseStagingSettings('probe', probeArgs, baseEnv);
    const changed = {
      ...validIdentity,
      database: 'unexpected_database',
      sessionUser: 'private_role_name',
      currentUser: 'private_effective_role',
      currentSchema: 'private_schema',
      searchPath: 'public, private_schema',
      serverPort: 0,
      transactionReadOnly: false,
    };
    const checks = inspectProbeIdentityChecks(changed, settings);
    assert.equal(checks.databaseMatches, false);
    assert.equal(checks.sessionUserPresent, true);
    assert.equal(checks.currentUserPresent, true);
    assert.equal(checks.schemaMatches, false);
    assert.equal(checks.searchPathMatches, false);
    assert.equal(checks.internalPortCheckValid, false);
    assert.equal(checks.transactionReadOnly, false);

    const messages: string[] = [];
    const code = await runSupabaseStagingIdentityProbe(probeArgs, baseEnv, {
      open: async () => ({ inspectIdentity: async () => changed, close: async () => undefined }),
    }, (line) => messages.push(line));
    assert.equal(code, 1);
    const diagnostic = messages.find((line) => line.includes('IDENTITY_MISMATCH'))!;
    assert.match(diagnostic, /database_matches=false/);
    assert.match(diagnostic, /session_user_present=true/);
    assert.match(diagnostic, /current_user_present=true/);
    assert.match(diagnostic, /effective_user_matches_if_configured=not_configured/);
    assert.match(diagnostic, /schema_matches=false/);
    assert.match(diagnostic, /search_path_matches=false/);
    assert.match(diagnostic, /internal_port_check_valid=false/);
    assert.match(diagnostic, /transaction_read_only=false/);
    assert.ok(!/unexpected_database|private_role_name|private_effective_role|private_schema/.test(diagnostic));
  });

  it('does not compare the pooler host port with the valid PostgreSQL internal port', async () => {
    const messages: string[] = [];
    const code = await runSupabaseStagingIdentityProbe(probeArgs, baseEnv, {
      open: async () => ({
        inspectIdentity: async () => ({ ...validIdentity, serverPort: 6543 }),
        close: async () => undefined,
      }),
    }, (line) => messages.push(line));
    assert.equal(code, 0);
    assert.ok(messages.some((line) => line.includes('PASS connected target')));
  });

  it('reports both a network failure and cleanup failure when an unopened pool cannot close', async () => {
    const messages: string[] = [];
    const code = await runSupabaseStagingIdentityProbe(probeArgs, baseEnv, {
      open: (settings) => openReadOnlyStagingIdentityProbe(settings, () => ({
        connect: async () => { throw Object.assign(new Error('private password detail'), { code: 'ETIMEDOUT' }); },
        end: async () => { throw new Error('database URL hidden'); },
      }), async () => ({ ca: 'test CA', rejectUnauthorized: true, checkServerIdentity })),
    }, (message) => messages.push(message));
    assert.equal(code, 1);
    assert.ok(messages.some((message) => message.includes('DNS_OR_NETWORK_FAILURE')));
    assert.ok(messages.some((message) => message.includes('CONNECTION_CLOSE_FAILED')));
    assert.ok(messages.every((message) => !message.includes('private password') && !message.includes('database URL')));
  });
});
