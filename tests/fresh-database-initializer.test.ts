import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';
import { getTableConfig } from 'drizzle-orm/pg-core';
import * as schema from '../src/db/schema.ts';
import { assertFreshDatabaseIdentity, freshDatabaseFingerprint, resolveFreshDatabaseSettings } from '../src/db/fresh-database-guard.ts';
import { FreshInitializationError, runFreshDatabaseInitialization, validateFreshBaselineHistory } from '../scripts/initialize-fresh-database.ts';

const baseEnv = {
  FRESH_DATABASE_ENABLED: 'true',
  FRESH_DATABASE_CONFIRMATION: 'I_CONFIRM_EMPTY_NONPRODUCTION_DATABASE',
  FRESH_DATABASE_URL: 'postgresql://fresh_user:fresh_password@127.0.0.1:55432/rcmega_fresh',
  FRESH_DATABASE_EXPECTED_FINGERPRINT: 'localhost:55432/rcmega_fresh',
  FRESH_DATABASE_SSL: 'false',
};

describe('fresh database initialization safety', () => {
  it('rejects absent, duplicate, malformed, or unknown arguments before opening a database', async () => {
    const invalidInputs = [
      { args: [], env: baseEnv },
      { args: ['--confirm-empty-database', '--confirm-empty-database'], env: baseEnv },
      { args: ['--confirm-empty-database', '--force'], env: baseEnv },
      { args: ['--wrong'], env: baseEnv },
      { args: ['--confirm-empty-database'], env: { ...baseEnv, FRESH_DATABASE_ENABLED: undefined } },
      { args: ['--confirm-empty-database'], env: { ...baseEnv, FRESH_DATABASE_CONFIRMATION: undefined } },
      { args: ['--confirm-empty-database'], env: { ...baseEnv, FRESH_DATABASE_URL: 'not-a-url' } },
    ];
    for (const { args, env } of invalidInputs) {
      let opened = false;
      const result = await runFreshDatabaseInitialization(args, env, async () => {
        opened = true;
        throw new Error('must not open');
      });
      assert.equal(result, 2);
      assert.equal(opened, false);
    }
  });

  it('requires both explicit opt-ins and an exact target fingerprint', () => {
    assert.throws(() => resolveFreshDatabaseSettings(['--confirm-empty-database'], { ...baseEnv, FRESH_DATABASE_ENABLED: undefined }), /FRESH_DATABASE_ENABLED/);
    assert.throws(() => resolveFreshDatabaseSettings(['--confirm-empty-database'], { ...baseEnv, FRESH_DATABASE_CONFIRMATION: undefined }), /confirmation/);
    assert.throws(() => resolveFreshDatabaseSettings(['--confirm-empty-database'], { ...baseEnv, FRESH_DATABASE_EXPECTED_FINGERPRINT: 'localhost:55432/other' }), /fingerprint/);
  });

  it('accepts Docker host-to-container port mapping and direct port mapping while checking database and user', () => {
    const dockerTarget = resolveFreshDatabaseSettings(['--confirm-empty-database'], {
      ...baseEnv,
      FRESH_DATABASE_URL: 'postgresql://fresh_user:fresh_password@127.0.0.1:55433/rcmega_fresh',
      FRESH_DATABASE_EXPECTED_FINGERPRINT: 'localhost:55433/rcmega_fresh',
    });
    assert.equal(dockerTarget.port, 55433);
    assert.doesNotThrow(() => assertFreshDatabaseIdentity({
      database: 'rcmega_fresh',
      user: 'fresh_user',
      serverPort: 5432,
    }, dockerTarget));

    const directTarget = resolveFreshDatabaseSettings(['--confirm-empty-database'], {
      ...baseEnv,
      FRESH_DATABASE_URL: 'postgresql://fresh_user:fresh_password@127.0.0.1:5432/rcmega_fresh',
      FRESH_DATABASE_EXPECTED_FINGERPRINT: 'localhost:5432/rcmega_fresh',
    });
    assert.equal(directTarget.port, 5432);
    assert.doesNotThrow(() => assertFreshDatabaseIdentity({
      database: 'rcmega_fresh',
      user: 'fresh_user',
      serverPort: 5432,
    }, directTarget));
  });

  it('fails closed for an unexpected database or user and malformed expected identity configuration', () => {
    assert.throws(() => assertFreshDatabaseIdentity({ database: 'other_db', user: 'fresh_user' }, {
      database: 'rcmega_fresh', user: 'fresh_user',
    }), /does not match/);
    assert.throws(() => assertFreshDatabaseIdentity({ database: 'rcmega_fresh', user: 'other_user' }, {
      database: 'rcmega_fresh', user: 'fresh_user',
    }), /does not match/);
    assert.throws(() => resolveFreshDatabaseSettings(['--confirm-empty-database'], {
      ...baseEnv,
      FRESH_DATABASE_URL: 'postgresql://:fresh_password@127.0.0.1:55432/rcmega_fresh',
    }), /explicit credentials/);
    assert.throws(() => resolveFreshDatabaseSettings(['--confirm-empty-database'], {
      ...baseEnv,
      FRESH_DATABASE_EXPECTED_FINGERPRINT: 'not-a-normalized-fingerprint',
    }), /fingerprint/);
  });

  it('rejects collisions with application, migration, and discrete SQL targets', () => {
    for (const env of [
      { ...baseEnv, DATABASE_URL: 'postgres://app:other@localhost:55432/rcmega_fresh' },
      { ...baseEnv, MIGRATION_DATABASE_URL: 'postgresql://migrate:other@localhost:55432/rcmega_fresh' },
      { ...baseEnv, SQL_HOST: '127.0.0.1', SQL_PORT: '55432', SQL_DB_NAME: 'rcmega_fresh', SQL_USER: 'app', SQL_PASSWORD: 'secret' },
    ]) {
      assert.throws(() => resolveFreshDatabaseSettings(['--confirm-empty-database'], env), /must differ/);
    }
    assert.throws(() => resolveFreshDatabaseSettings(['--confirm-empty-database'], { ...baseEnv, SQL_HOST: 'localhost' }), /cannot be safely compared/);
  });

  it('rejects remote targets without explicit remote opt-in and matching fingerprint', () => {
    const remote = {
      ...baseEnv,
      FRESH_DATABASE_URL: 'postgresql://fresh_user:fresh_password@db.example.test:5432/rcmega_fresh',
      FRESH_DATABASE_EXPECTED_FINGERPRINT: 'db.example.test:5432/rcmega_fresh',
    };
    assert.throws(() => resolveFreshDatabaseSettings(['--confirm-empty-database'], remote), /disabled by default/);
    assert.throws(() => resolveFreshDatabaseSettings(['--confirm-empty-database'], { ...remote, ALLOW_REMOTE_FRESH_DATABASE: 'true', FRESH_DATABASE_EXPECTED_FINGERPRINT: 'wrong' }), /fingerprint/);
    assert.equal(resolveFreshDatabaseSettings(['--confirm-empty-database'], { ...remote, ALLOW_REMOTE_FRESH_DATABASE: 'true' }).host, 'db.example.test');
  });

  it('uses the injected initializer after validation and always closes it', async () => {
    const events: string[] = [];
    const result = await runFreshDatabaseInitialization(['--confirm-empty-database'], baseEnv, async (settings) => {
      events.push(`open:${settings.database}`);
      return {
        verifyIdentity: async () => { events.push('identity'); },
        verifyEmptyTarget: async () => { events.push('verify'); },
        applyBaseline: async () => { events.push('apply'); },
        close: async () => { events.push('close'); },
      };
    });
    assert.equal(result, 0);
    assert.deepEqual(events, ['open:rcmega_fresh', 'identity', 'verify', 'apply', 'close']);
  });

  it('reports every initialization stage with sanitized diagnostics and closes opened runtimes', async () => {
    const cases = [
      { stage: 'BASELINE_HISTORY_INVALID', location: 'open' },
      { stage: 'CONNECTION_SETUP_FAILED', location: 'open', code: '08006', classText: 'connection exception' },
      { stage: 'DATABASE_IDENTITY_FAILED', location: 'identity' },
      { stage: 'DATABASE_EMPTY_CHECK_FAILED', location: 'empty' },
      { stage: 'DATABASE_NOT_EMPTY', location: 'notEmpty' },
      { stage: 'BASELINE_MIGRATION_FAILED', location: 'baseline', code: '42601', classText: 'SQL syntax or access rule error' },
      { stage: 'CLEANUP_FAILED', location: 'close' },
    ] as const;

    for (const testCase of cases) {
      const messages: string[] = [];
      let closed = false;
      let emptyChecked = false;
      let baselineApplied = false;
      const sqlState = 'code' in testCase ? testCase.code : undefined;
      const classText = 'classText' in testCase ? testCase.classText : undefined;
      const injected = Object.assign(new Error('postgresql://private-user:private-password@private-host/private-db?token=top-secret'), {
        ...(sqlState ? { code: sqlState } : {}),
      });
      const result = await runFreshDatabaseInitialization(['--confirm-empty-database'], baseEnv, async () => {
        if (testCase.location === 'open') throw testCase.stage === 'BASELINE_HISTORY_INVALID'
          ? new FreshInitializationError('BASELINE_HISTORY_INVALID', { cause: injected })
          : injected;
        return {
          verifyIdentity: async () => {
            if (testCase.location === 'identity') throw new FreshInitializationError('DATABASE_IDENTITY_FAILED', { cause: injected });
          },
          verifyEmptyTarget: async () => {
            emptyChecked = true;
            if (testCase.location === 'empty') throw new FreshInitializationError('DATABASE_EMPTY_CHECK_FAILED', { cause: injected });
            if (testCase.location === 'notEmpty') throw new FreshInitializationError('DATABASE_NOT_EMPTY', { cause: injected });
          },
          applyBaseline: async () => {
            baselineApplied = true;
            if (testCase.location === 'baseline') throw new FreshInitializationError('BASELINE_MIGRATION_FAILED', { cause: injected });
          },
          close: async () => {
            closed = true;
            if (testCase.location === 'close') throw injected;
          },
        };
      }, (message) => messages.push(message));

      assert.equal(result, 1, testCase.stage);
      assert.ok(messages.some((message) => message.includes(`[${testCase.stage}]`)), testCase.stage);
      if (sqlState) {
        assert.ok(messages.some((message) => message.includes(`SQLSTATE ${sqlState}`)), testCase.stage);
        assert.ok(classText && messages.some((message) => message.includes(classText)), testCase.stage);
      }
      assert.ok(messages.every((message) => !/private-user|private-password|private-host|private-db|top-secret|postgres(?:ql)?:\/\//i.test(message)));
      if (testCase.location !== 'open') assert.equal(closed, true, testCase.stage);
      if (testCase.location === 'identity') {
        assert.equal(emptyChecked, false);
        assert.equal(baselineApplied, false);
      }
    }
  });

  it('reports configuration failures without opening a runtime or including environment values', async () => {
    const messages: string[] = [];
    let opened = false;
    const result = await runFreshDatabaseInitialization(['--confirm-empty-database'], {
      ...baseEnv,
      FRESH_DATABASE_URL: 'postgresql://sensitive-user:sensitive-password@host/sensitive-db',
      FRESH_DATABASE_EXPECTED_FINGERPRINT: 'wrong',
    }, async () => {
      opened = true;
      throw new Error('must not open');
    }, (message) => messages.push(message));
    assert.equal(result, 2);
    assert.equal(opened, false);
    assert.ok(messages.some((message) => message.includes('[CONFIGURATION_INVALID]')));
    assert.ok(messages.every((message) => !/sensitive-user|sensitive-password|sensitive-db|postgres(?:ql)?:\/\//i.test(message)));
  });

  it('classifies malformed or incompatible baseline journals without accessing a database', () => {
    assert.throws(() => validateFreshBaselineHistory('{malformed', '{}'), (error: unknown) =>
      error instanceof FreshInitializationError && error.stage === 'BASELINE_HISTORY_INVALID');
    assert.throws(() => validateFreshBaselineHistory(
      JSON.stringify({ entries: [{ tag: 'wrong', when: 2 }] }),
      JSON.stringify({ entries: [{ when: 1 }] }),
    ), (error: unknown) => error instanceof FreshInitializationError && error.stage === 'BASELINE_HISTORY_INVALID');
  });

  it('matches baseline table and column declarations to all 13 Drizzle tables', async () => {
    const sql = await readFile(new URL('../drizzle/fresh/0000_application-baseline.sql', import.meta.url), 'utf8');
    const snapshot = JSON.parse(await readFile(new URL('../drizzle/fresh/meta/0000_snapshot.json', import.meta.url), 'utf8')) as {
      tables: Record<string, { columns: Record<string, { type: string; notNull: boolean; primaryKey: boolean; default?: unknown }> }>;
    };
    const tables = [
      schema.users, schema.categories, schema.brands, schema.products, schema.orders,
      schema.orderItems, schema.wishlist, schema.reviews, schema.cartItems,
      schema.cartMergeOperations, schema.inventoryReservations,
      schema.razorpayWebhookEvents, schema.paymentReviewCases,
    ];
    assert.equal(tables.length, 13);
    for (const table of tables) {
      const config = getTableConfig(table);
      const escapedName = config.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const tableMatch = sql.match(new RegExp(`CREATE TABLE \\"${escapedName}\\" \\(([\\s\\S]*?)\\n\\);`, 'i'));
      assert.ok(tableMatch, `baseline includes table ${config.name}`);
      const columnNames = [...tableMatch[1].matchAll(/^\s+"([^"]+)"\s+/gm)].map((match) => match[1]);
      assert.deepEqual(columnNames, config.columns.map((column) => column.name), `${config.name} columns match Drizzle`);
      const snapshotColumns = snapshot.tables[`public.${config.name}`]?.columns;
      assert.ok(snapshotColumns, `snapshot includes ${config.name}`);
      for (const column of config.columns) {
        const snapColumn = snapshotColumns[column.name];
        assert.ok(snapColumn, `snapshot includes ${config.name}.${column.name}`);
        assert.equal(snapColumn.type, column.getSQLType(), `${config.name}.${column.name} SQL type`);
        assert.equal(snapColumn.notNull, column.notNull, `${config.name}.${column.name} nullability`);
        assert.equal(snapColumn.primaryKey, column.primary, `${config.name}.${column.name} primary key`);
        const sequenceDefault = ['serial', 'bigserial', 'smallserial'].includes(column.getSQLType());
        assert.equal('default' in snapColumn, column.hasDefault && !sequenceDefault, `${config.name}.${column.name} default presence`);
        if (column.isUnique) assert.ok(sql.includes(`"${column.uniqueName}"`), `baseline includes unique constraint for ${config.name}.${column.name}`);
      }
      for (const index of config.indexes) assert.ok(sql.includes(`"${index.config.name}"`), `baseline includes ${index.config.name}`);
      for (const foreignKey of config.foreignKeys) assert.ok(sql.includes(`"${foreignKey.getName()}"`), `baseline includes ${foreignKey.getName()}`);
      for (const check of config.checks) assert.ok(sql.includes(`"${check.name}"`), `baseline includes ${check.name}`);
      for (const unique of config.uniqueConstraints) assert.ok(sql.includes(`"${unique.getName()}"`), `baseline includes ${unique.getName()}`);
    }
    assert.doesNotMatch(sql, /\b(INSERT\s+INTO|DROP\s+TABLE|TRUNCATE)\b/i);
    assert.doesNotMatch(sql, /postgres(?:ql)?:\/\/|password\s*=/i);
  });

  it('places the fresh-baseline timestamp after every immutable legacy migration', async () => {
    const freshJournal = JSON.parse(await readFile(new URL('../drizzle/fresh/meta/_journal.json', import.meta.url), 'utf8')) as { entries: Array<{ when: number }> };
    const legacyJournal = JSON.parse(await readFile(new URL('../drizzle/meta/_journal.json', import.meta.url), 'utf8')) as { entries: Array<{ when: number }> };
    assert.equal(freshJournal.entries.length, 1);
    assert.ok(freshJournal.entries[0]!.when > Math.max(...legacyJournal.entries.map((entry) => entry.when)));
    const forwardEntries = legacyJournal.entries.slice(6);
    assert.ok(forwardEntries.every((entry) => entry.when > freshJournal.entries[0]!.when), 'future main-line migrations must be newer than the fresh baseline');
    assert.equal(freshDatabaseFingerprint({ host: '127.0.0.1', port: 55432, database: 'rcmega_fresh' }), 'localhost:55432/rcmega_fresh');
  });
});
