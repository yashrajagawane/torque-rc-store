export const RESERVATION_CLEANUP_CONFIRMATION_FLAG = '--confirm-cleanup';

type CleanupPool = { end: () => Promise<void> };
type CleanupDatabase = {
  transaction: (callback: (transaction: any) => Promise<any>) => Promise<any>;
};

type CleanupDatabaseModule = {
  db: CleanupDatabase;
  createPool: () => CleanupPool;
};

type CleanupFunctionModule = {
  expireInventoryReservations: (transaction: any) => Promise<number>;
};

type CleanupOptions = {
  args: string[];
  env: Record<string, string | undefined>;
  loadDatabase?: () => Promise<CleanupDatabaseModule>;
  loadCleanupFunction?: () => Promise<CleanupFunctionModule>;
};

async function loadDatabaseModule(): Promise<CleanupDatabaseModule> {
  return import('../src/db/index.ts');
}

async function loadCleanupFunctionModule(): Promise<CleanupFunctionModule> {
  return import('../src/server/inventory.ts');
}

/** Validate both explicit opt-ins before importing anything that initializes the database. */
export async function runReservationCleanup({
  args,
  env,
  loadDatabase = loadDatabaseModule,
  loadCleanupFunction = loadCleanupFunctionModule,
}: CleanupOptions) {
  if (args.length !== 1 || args[0] !== RESERVATION_CLEANUP_CONFIRMATION_FLAG) {
    return {
      exitCode: 2,
      message: `Cleanup not started. Pass only ${RESERVATION_CLEANUP_CONFIRMATION_FLAG} exactly once to confirm this database operation.`,
    };
  }
  if (env.RESERVATION_CLEANUP_ENABLED !== 'true') {
    return { exitCode: 2, message: 'Cleanup not started. Set RESERVATION_CLEANUP_ENABLED=true explicitly in the server environment.' };
  }

  let pool: CleanupPool | undefined;
  let expiredCount: number | undefined;
  let failed = false;

  try {
    const database = await loadDatabase();
    pool = database.createPool();
    const { expireInventoryReservations } = await loadCleanupFunction();
    expiredCount = await database.db.transaction((transaction) => expireInventoryReservations(transaction));
  } catch {
    // Do not print driver errors: they may contain host, username, or connection details.
    failed = true;
  } finally {
    if (pool) {
      try {
        await pool.end();
      } catch {
        failed = true;
      }
    }
  }

  if (failed) {
    return { exitCode: 1, message: 'Inventory reservation cleanup failed. Check server-side database configuration and scheduler logs.' };
  }
  return { exitCode: 0, message: `Inventory reservation cleanup completed. Expired reservations: ${expiredCount}.` };
}
