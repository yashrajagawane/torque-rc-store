import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createServer } from 'node:http';
import express, { type Request, type RequestHandler } from 'express';
import { cartOwnerId, cartReplacementSchema, createCartRouter, hashMergePayload, isProductCartable, mergeCartQuantity, productQuantitySchema, unmergedGuestQuantity } from '../src/server/cart-routes.ts';
import { cartItems, cartMergeOperations, inventoryReservations, products } from '../src/db/schema.ts';

const customerA = '11111111-1111-4111-8111-111111111111';
const customerB = '22222222-2222-4222-8222-222222222222';

describe('customer cart validation and ownership', () => {
  it('derives cart ownership from verified auth identity and ignores body-supplied user IDs', () => {
    const request = {
      authUser: { id: customerA },
      body: { userId: customerB, productId: 12, quantity: 1 },
    } as unknown as Request;
    assert.equal(cartOwnerId(request), customerA);
    assert.notEqual(cartOwnerId(request), customerB);
    assert.equal(cartOwnerId({ body: { userId: customerB } } as unknown as Request), null);
  });

  it('accepts only positive integer quantities and rejects duplicate product rows', () => {
    assert.equal(productQuantitySchema.safeParse({ productId: 1, quantity: 1 }).success, true);
    for (const quantity of [0, -1, 1.2, '2', Number.NaN]) {
      assert.equal(productQuantitySchema.safeParse({ productId: 1, quantity }).success, false);
    }
    assert.equal(cartReplacementSchema.safeParse({ items: [
      { productId: 1, quantity: 1 }, { productId: 1, quantity: 2 },
    ] }).success, false);
  });

  it('blocks unpublished, out-of-stock and over-stock products', () => {
    const available = { isPublished: true, availability: 'IN_STOCK', stock: 3 };
    assert.equal(isProductCartable(available, 3), true);
    assert.equal(isProductCartable(available, 4), false);
    assert.equal(isProductCartable({ ...available, availability: 'OUT_OF_STOCK' }, 1), false);
    assert.equal(isProductCartable({ ...available, isPublished: false }, 1), false);
    assert.equal(isProductCartable({ ...available, stock: null }, 1), false);
    assert.equal(isProductCartable({ ...available, availability: null }, 1), false);
    assert.equal(isProductCartable({ isPublished: true, stock: 3 } as { isPublished: boolean; availability: string | null; stock: number | null }, 1), false);
    assert.equal(isProductCartable({ ...available, availability: 'LOW_STOCK' }, 1), false);
    assert.equal(isProductCartable({ ...available, availability: 'UNKNOWN' }, 1), false);
    assert.equal(isProductCartable(available, 4), false, 'quantity cannot exceed stock');
    assert.equal(isProductCartable({ ...available, stock: 0 }, 1), false);
  });

  it('merges guest quantities without exceeding current stock', () => {
    assert.equal(mergeCartQuantity(1, 2, 5), 3);
    assert.equal(mergeCartQuantity(4, 3, 5), 5);
    assert.equal(mergeCartQuantity(0, 2, 0), 0);
    assert.equal(unmergedGuestQuantity(1, 2, 5), 0);
    assert.equal(unmergedGuestQuantity(4, 3, 5), 2);
    assert.equal(unmergedGuestQuantity(0, 2, 0), 2);
  });

  it('adds and removes cart items in the authenticated customer scope', async () => {
    let selectCall = 0;
    let inserted: Record<string, unknown> | null = null;
    let deletedFilter: unknown;
    const fakeDatabase = {
      transaction: async (callback: (transaction: unknown) => Promise<unknown>) => callback({
        select: () => {
          let table: unknown;
          const query: any = {
            from(value: unknown) { table = value; return this; }, where() { return this; }, groupBy() { return this; },
            for: async () => {
              if (table === products) {
                selectCall += 1;
                return selectCall % 2 === 1 ? [{ id: 9, stock: 5, availability: 'IN_STOCK', isPublished: true }] : [];
              }
              return [];
            },
            then(resolve: (rows: any[]) => unknown) { return Promise.resolve([]).then(resolve); },
          };
          return query;
        },
        insert: () => ({ values: (values: Record<string, unknown>) => {
          inserted = values;
          return { onConflictDoUpdate: async () => [] };
        } }),
      }),
      select: () => {
        const query = {
          from: () => query,
          innerJoin: () => query,
          leftJoin: () => query,
          where: () => query,
          orderBy: async () => [],
        };
        return query;
      },
      delete: () => ({ where: async (filter: unknown) => { deletedFilter = filter; } }),
    } as unknown as Parameters<typeof createCartRouter>[0];
    const testAuth: RequestHandler = (req, _res, next) => {
      (req as Request & { authUser: { id: string } }).authUser = { id: customerA };
      next();
    };
    const app = express();
    app.use(express.json());
    app.use('/api/cart', createCartRouter(fakeDatabase, testAuth));
    const server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    try {
      const added = await fetch(`http://127.0.0.1:${address.port}/api/cart/items`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId: 9, quantity: 2, userId: customerB }),
      });
      assert.equal(added.status, 400, 'client-supplied user IDs are rejected');
      const response = await fetch(`http://127.0.0.1:${address.port}/api/cart/items`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId: 9, quantity: 2 }),
      });
      assert.equal(response.status, 200);
      assert.equal((inserted as Record<string, unknown> | null)?.userId, customerA);
      assert.equal((inserted as Record<string, unknown> | null)?.quantity, 2);

      const removed = await fetch(`http://127.0.0.1:${address.port}/api/cart/items/9`, { method: 'DELETE' });
      assert.equal(removed.status, 200);
      assert.ok(deletedFilter, 'delete is constrained by the authenticated customer and product');
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it('replays the same merge safely and rejects reusing its key for another payload', async () => {
    const operationStore = new Map<string, { id: number; payloadHash: string; rejected: Array<{ productId: number; unmergedQuantity: number; reason: string }> }>();
    const cartStore = new Map<string, number>();
    const operationId = `${customerA}:33333333-3333-4333-8333-333333333333`;
    const product = { id: 9, stock: 5, availability: 'IN_STOCK', isPublished: true };
    let nextOperationId = 1;
    const fakeDatabase = {
      transaction: async (callback: (transaction: unknown) => Promise<unknown>) => callback({
        insert: (table: unknown) => ({ values: (values: Record<string, unknown>) => ({
          onConflictDoNothing: () => ({ returning: async () => {
            if (table === cartMergeOperations) {
              if (operationStore.has(operationId)) return [];
              operationStore.set(operationId, { id: nextOperationId++, payloadHash: String(values.payloadHash), rejected: [] });
              return [{ id: nextOperationId - 1 }];
            }
            return [];
          } }),
          onConflictDoUpdate: async ({ set }: { set: { quantity: number } }) => {
            cartStore.set(`${values.userId}:${values.productId}`, set.quantity);
            return [];
          },
        }) }),
        select: () => {
          let selectedTable: unknown;
          const query = {
            from: (table: unknown) => { selectedTable = table; return query; },
            where: () => query,
            groupBy: () => query,
            for: async () => {
              if (selectedTable === products) return [product];
              if (selectedTable === cartMergeOperations) {
                const operation = operationStore.get(operationId);
                return operation ? [{ payloadHash: operation.payloadHash, rejected: operation.rejected }] : [];
              }
              if (selectedTable === cartItems) {
                const quantity = cartStore.get(`${customerA}:9`);
                return quantity ? [{ quantity }] : [];
              }
              return [];
            },
            then: (resolve: (rows: any[]) => unknown) => Promise.resolve(selectedTable === inventoryReservations ? [] : []).then(resolve),
          };
          return query;
        },
        update: (table: unknown) => ({ set: (values: { rejected: Array<{ productId: number; unmergedQuantity: number; reason: string }> }) => ({
          where: async () => {
            if (table === cartMergeOperations) {
              const operation = operationStore.get(operationId);
              if (operation) operation.rejected = values.rejected;
            }
          },
        }) }),
      }),
      select: () => {
        const query = {
          from: () => query,
          innerJoin: () => query,
          leftJoin: () => query,
          where: () => query,
          orderBy: async () => {
            const quantity = cartStore.get(`${customerA}:9`);
            return quantity ? [{
              productId: 9, quantity, slug: 'test', name: 'Test Product', price: '10.00', currency: 'INR',
              thumbnail: 'image.png', stock: 5, availability: 'IN_STOCK', isPublished: true, brandName: null,
            }] : [];
          },
        };
        return query;
      },
    } as unknown as Parameters<typeof createCartRouter>[0];
    const testAuth: RequestHandler = (req, _res, next) => {
      (req as Request & { authUser: { id: string } }).authUser = { id: customerA };
      next();
    };
    const app = express();
    app.use(express.json());
    app.use('/api/cart', createCartRouter(fakeDatabase, testAuth));
    const server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const key = '33333333-3333-4333-8333-333333333333';
    const sendMerge = (quantity: number) => fetch(`http://127.0.0.1:${address.port}/api/cart/merge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
      body: JSON.stringify({ items: [{ productId: 9, quantity }] }),
    });
    try {
      const first = await sendMerge(2);
      assert.equal(first.status, 200);
      assert.equal((await first.json()).replayed, false);
      assert.equal(cartStore.get(`${customerA}:9`), 2);

      const retry = await sendMerge(2);
      assert.equal(retry.status, 200);
      assert.equal((await retry.json()).replayed, true);
      assert.equal(cartStore.get(`${customerA}:9`), 2, 'retry does not add the guest quantity twice');

      const changedPayload = await sendMerge(3);
      assert.equal(changedPayload.status, 409);
      assert.equal(cartStore.get(`${customerA}:9`), 2, 'payload mismatch does not alter cart quantities');
      assert.equal(hashMergePayload([{ productId: 9, quantity: 2 }]), hashMergePayload([{ productId: 9, quantity: 2 }]));
      assert.notEqual(hashMergePayload([{ productId: 9, quantity: 2 }]), hashMergePayload([{ productId: 9, quantity: 3 }]));
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});
