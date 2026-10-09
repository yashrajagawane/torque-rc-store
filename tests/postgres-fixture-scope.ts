export type PostgresFixtureScope = {
  productIds: number[];
  productSlugs: string[];
  orderIds: number[];
  orderCustomerAuthIds: string[];
  cartUserIds: string[];
  paymentIds: string[];
  eventIds: string[];
};

export function createPostgresFixtureScope(): PostgresFixtureScope {
  return {
    productIds: [], productSlugs: [], orderIds: [], orderCustomerAuthIds: [],
    cartUserIds: [], paymentIds: [], eventIds: [],
  };
}

/** Runs cleanup on success or failure and preserves the scenario's original error. */
export async function withPostgresFixtureCleanup<T>(
  work: () => Promise<T>,
  cleanup: () => Promise<void>,
  reportCleanupFailure: (message: string) => void = (message) => console.error(message),
): Promise<T> {
  let result: T;
  try {
    result = await work();
  } catch (originalError) {
    try { await cleanup(); }
    catch { reportCleanupFailure('PostgreSQL integration fixture cleanup failed after a scenario failure.'); }
    throw originalError;
  }
  try { await cleanup(); }
  catch { throw new Error('PostgreSQL integration fixture cleanup failed.'); }
  return result;
}
