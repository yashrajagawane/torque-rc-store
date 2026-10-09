import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { runReservationCleanup } from '../scripts/reservation-cleanup-runner.ts';

const enabledEnvironment = { RESERVATION_CLEANUP_ENABLED: 'true' };

function mockedDependencies(options: { cleanupError?: Error; poolCloseError?: Error } = {}) {
  const state = { databaseLoaded: 0, cleanupModuleLoaded: 0, poolCreated: 0, cleanupCalled: 0, poolClosed: 0 };
  const database = {
    db: {
      async transaction(callback: (transaction: unknown) => Promise<number>) {
        return callback({ mocked: true });
      },
    },
    createPool() {
      state.poolCreated += 1;
      return {
        async end() {
          state.poolClosed += 1;
          if (options.poolCloseError) throw options.poolCloseError;
        },
      };
    },
  };
  const cleanupFunction = {
    async expireInventoryReservations(transaction: unknown) {
      assert.deepEqual(transaction, { mocked: true });
      state.cleanupCalled += 1;
      if (options.cleanupError) throw options.cleanupError;
      return 3;
    },
  };
  const loadDatabase = async () => {
    state.databaseLoaded += 1;
    return database;
  };
  const loadCleanupFunction = async () => {
    state.cleanupModuleLoaded += 1;
    return cleanupFunction;
  };
  return { state, loadDatabase, loadCleanupFunction };
}

describe('reservation cleanup execution gate', () => {
  it('does not load database dependencies when the confirmation flag is missing', async () => {
    const { state, loadDatabase, loadCleanupFunction } = mockedDependencies();
    const result = await runReservationCleanup({ args: [], env: enabledEnvironment, loadDatabase, loadCleanupFunction });
    assert.equal(result.exitCode, 2);
    assert.match(result.message, /not started/);
    assert.deepEqual(state, { databaseLoaded: 0, cleanupModuleLoaded: 0, poolCreated: 0, cleanupCalled: 0, poolClosed: 0 });
  });

  it('rejects duplicate, malformed, and unknown arguments before database initialization', async () => {
    const invalidArguments = [
      ['--confirm-cleanup', '--confirm-cleanup'],
      ['--confirm-cleanup=1'],
      ['--confirm-cleanup', '--unknown'],
      ['--unknown'],
      ['--confirm-cleanup', 'extra'],
    ];
    for (const args of invalidArguments) {
      const { state, loadDatabase, loadCleanupFunction } = mockedDependencies();
      const result = await runReservationCleanup({ args, env: enabledEnvironment, loadDatabase, loadCleanupFunction });
      assert.equal(result.exitCode, 2, `arguments ${args.join(' ')} must be rejected`);
      assert.match(result.message, /pass only .* exactly once/i);
      assert.equal(state.databaseLoaded, 0);
      assert.equal(state.cleanupModuleLoaded, 0);
      assert.equal(state.cleanupCalled, 0);
    }
  });

  it('does not load database dependencies when the environment opt-in is missing', async () => {
    const { state, loadDatabase, loadCleanupFunction } = mockedDependencies();
    const result = await runReservationCleanup({ args: ['--confirm-cleanup'], env: { NODE_ENV: 'development' }, loadDatabase, loadCleanupFunction });
    assert.equal(result.exitCode, 2);
    assert.match(result.message, /RESERVATION_CLEANUP_ENABLED=true/);
    assert.deepEqual(state, { databaseLoaded: 0, cleanupModuleLoaded: 0, poolCreated: 0, cleanupCalled: 0, poolClosed: 0 });
  });

  it('rejects invalid environment opt-in values before database initialization', async () => {
    for (const value of ['TRUE', '1', 'true ', ' false', 'false', undefined]) {
      const { state, loadDatabase, loadCleanupFunction } = mockedDependencies();
      const result = await runReservationCleanup({
        args: ['--confirm-cleanup'],
        env: { RESERVATION_CLEANUP_ENABLED: value },
        loadDatabase,
        loadCleanupFunction,
      });
      assert.equal(result.exitCode, 2, `value ${String(value)} must be rejected`);
      assert.equal(state.databaseLoaded, 0);
      assert.equal(state.cleanupCalled, 0);
    }
  });

  it('runs shared cleanup only when both explicit safeguards are valid and closes the pool', async () => {
    const { state, loadDatabase, loadCleanupFunction } = mockedDependencies();
    const result = await runReservationCleanup({
      args: ['--confirm-cleanup'], env: enabledEnvironment, loadDatabase, loadCleanupFunction,
    });
    assert.equal(result.exitCode, 0);
    assert.match(result.message, /Expired reservations: 3/);
    assert.deepEqual(state, { databaseLoaded: 1, cleanupModuleLoaded: 1, poolCreated: 1, cleanupCalled: 1, poolClosed: 1 });
  });

  it('returns a failure code and closes the pool when cleanup fails', async () => {
    const { state, loadDatabase, loadCleanupFunction } = mockedDependencies({
      cleanupError: new Error('postgresql://db-user:secret@private-host/store'),
    });
    const result = await runReservationCleanup({
      args: ['--confirm-cleanup'], env: enabledEnvironment, loadDatabase, loadCleanupFunction,
    });
    assert.equal(result.exitCode, 1);
    assert.match(result.message, /cleanup failed/i);
    assert.doesNotMatch(result.message, /postgresql|db-user|secret|private-host/i);
    assert.deepEqual(state, { databaseLoaded: 1, cleanupModuleLoaded: 1, poolCreated: 1, cleanupCalled: 1, poolClosed: 1 });
  });

  it('returns a failure code and generic message when closing the pool fails', async () => {
    const { state, loadDatabase, loadCleanupFunction } = mockedDependencies({
      poolCloseError: new Error('postgresql://db-user:secret@private-host/store'),
    });
    const result = await runReservationCleanup({
      args: ['--confirm-cleanup'], env: enabledEnvironment, loadDatabase, loadCleanupFunction,
    });
    assert.equal(result.exitCode, 1);
    assert.match(result.message, /cleanup failed/i);
    assert.doesNotMatch(result.message, /postgresql|db-user|secret|private-host/i);
    assert.equal(state.cleanupCalled, 1);
    assert.equal(state.poolClosed, 1);
  });
});
