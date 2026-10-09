import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';
import { createServer } from 'node:http';
import express, { type Request, type RequestHandler } from 'express';
import { PgDialect } from 'drizzle-orm/pg-core';
import { createAdminOrderRouter, createOrderRouter, canTransitionFulfillment, checkoutPayloadHash, checkoutSchema, formatPaise, moneyToPaise } from '../src/server/order-routes.ts';
import { cartItems, inventoryReservations, orderItems, orders, products } from '../src/db/schema.ts';
import { activeReservationTotals, consumeOrderReservations, expireInventoryReservations, releaseOrderReservations, remainingStock, reservationExpiry } from '../src/server/inventory.ts';

const customerA = '11111111-1111-4111-8111-111111111111';
const customerB = '22222222-2222-4222-8222-222222222222';
const key = '33333333-3333-4333-8333-333333333333';
const address = { fullName: 'Test Customer', phone: '+91 98765 43210', addressLine1: '12 RC Street', addressLine2: '', city: 'Pune', state: 'Maharashtra', postalCode: '411001', country: 'India' as const };
const input = { items: [{ productId: 5, quantity: 2 }], shippingAddress: address };

function fakeDatabase(options: { stock?: number; currency?: string | null; products?: any[]; cart?: any[]; failOrderItems?: boolean } = {}) {
  const state: { orders: any[]; orderItems: any[]; reservations: any[]; cart: any[]; nextOrderId: number; nextItemId: number; transactions: number } = {
    orders: [], orderItems: [], reservations: [], cart: options.cart || [{ userId: customerA, productId: 5, quantity: 2 }], nextOrderId: 1, nextItemId: 1, transactions: 0,
  };
  const product = { id: 5, name: 'RC Truck', slug: 'rc-truck', price: '125.50', currency: Object.prototype.hasOwnProperty.call(options, 'currency') ? options.currency : 'INR', stock: options.stock ?? 4, availability: 'IN_STOCK', isPublished: true };
  const productRows = options.products || [product];
  let transactionTail = Promise.resolve();

  const database: any = {
    transaction: async (callback: (tx: any) => Promise<unknown>) => {
      const previous = transactionTail;
      let release!: () => void;
      transactionTail = new Promise<void>((resolve) => { release = resolve; });
      await previous;
      state.transactions += 1;
      const snapshot = structuredClone(state);
      const tx: any = {
        insert(table: unknown) {
          return { values(values: any) {
            return {
              onConflictDoNothing() { return this; },
              async returning() {
                if (table === orders) {
                  const existing = state.orders.find((row) => row.customerAuthId === values.customerAuthId && row.idempotencyKey === values.idempotencyKey);
                  if (existing) return [];
                  const row = { ...values, id: state.nextOrderId++, createdAt: new Date(), updatedAt: new Date() };
                  state.orders.push(row);
                  return [{ id: row.id }];
                }
                if (table === orderItems) {
                  if (options.failOrderItems) throw new Error('simulated item write failure');
                  const valuesArray = Array.isArray(values) ? values : [values];
                  const rows = valuesArray.map((value) => ({ ...value, id: state.nextItemId++ }));
                  state.orderItems.push(...rows);
                  return rows;
                }
                if (table === inventoryReservations) {
                  const valuesArray = Array.isArray(values) ? values : [values];
                  state.reservations.push(...valuesArray.map((value) => ({
                    ...value,
                    expiresAt: value.expiresAt instanceof Date ? value.expiresAt : new Date(Date.now() + 20 * 60_000),
                  })));
                  return valuesArray;
                }
                return [];
              },
              then(resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) {
                try {
                  if (table === inventoryReservations) {
                    const valuesArray = Array.isArray(values) ? values : [values];
                    state.reservations.push(...valuesArray.map((value) => ({
                      ...value,
                      expiresAt: value.expiresAt instanceof Date ? value.expiresAt : new Date(Date.now() + 20 * 60_000),
                    })));
                  }
                  return Promise.resolve(undefined).then(resolve, reject);
                } catch (error) { return Promise.reject(error).then(resolve, reject); }
              },
            };
          } };
        },
        select() {
          const query: any = {
            table: null,
            filterParameters: [] as unknown[],
            from(table: unknown) { this.table = table; return this; },
            where(condition: any) { this.filterParameters = new PgDialect().sqlToQuery(condition).params; return this; },
            orderBy() { return this; },
            groupBy() { return this; },
            rows() {
              if (this.table === cartItems) return state.cart.filter((row) => this.filterParameters.includes(row.userId)).sort((a, b) => a.productId - b.productId);
              if (this.table === products) return productRows.filter((row) => this.filterParameters.length === 0 || this.filterParameters.includes(row.id));
              if (this.table === inventoryReservations) {
                const totals = new Map<number, number>();
                for (const reservation of state.reservations) {
                  if (reservation.status === 'ACTIVE' && new Date(reservation.expiresAt) > new Date()) {
                    totals.set(reservation.productId, (totals.get(reservation.productId) || 0) + reservation.quantity);
                  }
                }
                return [...totals].filter(([productId]) => this.filterParameters.includes(productId)).map(([productId, quantity]) => ({ productId, quantity }));
              }
              if (this.table === orders) return state.orders.filter((row) => this.filterParameters.length === 0 || (this.filterParameters.includes(row.customerAuthId) && this.filterParameters.includes(row.idempotencyKey)) || this.filterParameters.includes(row.id));
              if (this.table === orderItems) return state.orderItems;
              return [];
            },
            for() { return Promise.resolve(this.rows()); },
            limit(count: number) { return Promise.resolve(this.rows().slice(0, count)); },
            then(resolve: (value: any) => unknown, reject: (error: unknown) => unknown) { return Promise.resolve(this.rows()).then(resolve, reject); },
          };
          return query;
        },
        update(table: unknown) {
          return { set(values: any) { return { where: (condition: any) => ({ returning: async () => {
            if (table !== orders) return [];
            const parameters = new PgDialect().sqlToQuery(condition).params;
            const row = state.orders.find((candidate) => parameters.includes(candidate.id));
            if (!row) return [];
            Object.assign(row, values);
            return [row];
          } }) }; } };
        },
        delete(table: unknown) {
          return { where: async (condition: any) => { if (table === cartItems) {
            const parameters = new PgDialect().sqlToQuery(condition).params;
            state.cart = state.cart.filter((row) => !parameters.includes(row.userId));
          } } };
        },
      };
      try { return await callback(tx); }
      catch (error) {
        Object.assign(state, snapshot);
        throw error;
      } finally { release(); }
    },
    select() { throw new Error('Outside-transaction select was not expected in this test.'); },
  };
  return { database, state, product };
}

const authenticated: RequestHandler = (req, _res, next) => {
  (req as Request & { authUser: { id: string; email: string } }).authUser = { id: customerA, email: 'customer@example.test' };
  next();
};

async function withServer(app: express.Express, run: (baseUrl: string) => Promise<void>) {
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addressInfo = server.address();
  assert.ok(addressInfo && typeof addressInfo === 'object');
  try { await run(`http://127.0.0.1:${addressInfo.port}`); }
  finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
}

describe('checkout and order management', () => {
  it('validates delivery details, positive quantities, and canonical request hashes', () => {
    assert.equal(checkoutSchema.safeParse(input).success, true);
    assert.equal(checkoutSchema.safeParse({ ...input, items: [{ productId: 5, quantity: 0 }] }).success, false);
    assert.equal(checkoutSchema.safeParse({ ...input, items: [{ productId: 5, quantity: 1, price: '0.01' }] }).success, false, 'browser prices are not accepted');
    assert.equal(checkoutSchema.safeParse({ ...input, shippingAddress: { ...address, phone: 'bad' } }).success, false);
    assert.equal(moneyToPaise('125.50'), 12550);
    assert.equal(formatPaise(26100), '261.00');
    assert.equal(checkoutPayloadHash(input), checkoutPayloadHash({ ...input, items: [...input.items] }));
  });

  it('only permits paid orders to enter fulfillment and enforces ordered transitions', () => {
    assert.equal(canTransitionFulfillment('UNFULFILLED', 'UNPAID', 'PROCESSING'), false);
    assert.equal(canTransitionFulfillment('UNFULFILLED', 'PAID', 'PROCESSING'), true);
    assert.equal(canTransitionFulfillment('PROCESSING', 'PAID', 'DELIVERED'), false);
    assert.equal(canTransitionFulfillment('PROCESSING', 'PAID', 'SHIPPED'), true);
    assert.equal(canTransitionFulfillment('SHIPPED', 'PAID', 'CANCELLED'), false);
    assert.equal(canTransitionFulfillment('UNFULFILLED', 'UNPAID', 'CANCELLED'), true);
    assert.equal(canTransitionFulfillment('DELIVERED', 'PAID', 'CANCELLED'), false);
  });

  it('creates a server-priced pending order, snapshots lines, and replays idempotently', async () => {
    const { database, state, product } = fakeDatabase();
    const app = express(); app.use(express.json()); app.use('/api/orders', createOrderRouter(database, authenticated));
    await withServer(app, async (baseUrl) => {
      const send = () => fetch(`${baseUrl}/api/orders`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key }, body: JSON.stringify(input) });
      const first = await send();
      assert.equal(first.status, 201);
      const firstBody = await first.json();
      assert.equal(firstBody.order.total, '251.00');
      assert.equal(firstBody.order.paymentStatus, 'UNPAID');
      assert.equal(firstBody.order.fulfillmentStatus, 'UNFULFILLED');
      assert.equal(firstBody.order.items[0].price, product.price);
      assert.equal(firstBody.order.items[0].productName, product.name);
      assert.equal(state.orders[0].customerAuthId, customerA);
      assert.equal(state.cart.length, 0, 'the matched cart snapshot is consumed atomically');
      assert.equal(product.stock, 4, 'pending orders do not decrement physical inventory');
      assert.equal(state.reservations.length, 1);
      assert.equal(state.reservations[0].quantity, 2);
      assert.equal(state.reservations[0].status, 'ACTIVE');

      const replay = await send();
      assert.equal(replay.status, 200);
      assert.equal((await replay.json()).replayed, true);
      assert.equal(state.orders.length, 1);
      assert.equal(state.orderItems.length, 1);
      assert.equal(state.reservations.length, 1, 'retry does not create a duplicate reservation');

      const changed = await fetch(`${baseUrl}/api/orders`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key }, body: JSON.stringify({ ...input, shippingAddress: { ...address, city: 'Mumbai' } }) });
      assert.equal(changed.status, 409);
      assert.equal(state.orders.length, 1);
    });
  });

  it('serializes competing customer checkouts so only one can reserve the final unit', async () => {
    const { database, state } = fakeDatabase({
      stock: 1,
      cart: [
        { userId: customerA, productId: 5, quantity: 1 },
        { userId: customerB, productId: 5, quantity: 1 },
      ],
    });
    const authFromHeader: RequestHandler = (req, _res, next) => {
      const id = req.header('x-customer-id') === customerB ? customerB : customerA;
      (req as Request & { authUser: { id: string; email: string } }).authUser = { id, email: 'customer@example.test' };
      next();
    };
    const app = express(); app.use(express.json()); app.use('/api/orders', createOrderRouter(database, authFromHeader));
    const keyB = '44444444-4444-4444-8444-444444444444';
    await withServer(app, async (baseUrl) => {
      const submit = (id: string, operationKey: string) => fetch(`${baseUrl}/api/orders`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': operationKey, 'x-customer-id': id },
        body: JSON.stringify({ ...input, items: [{ productId: 5, quantity: 1 }] }),
      });
      const responses = await Promise.all([submit(customerA, key), submit(customerB, keyB)]);
      assert.deepEqual(responses.map(({ status }) => status).sort(), [201, 409]);
      assert.equal(state.orders.length, 1);
      assert.equal(state.reservations.reduce((total, reservation) => total + reservation.quantity, 0), 1);
      assert.equal(state.cart.length, 1, 'the losing customer retains their cart');
    });
  });

  it('calculates available inventory without changing physical stock', () => {
    assert.equal(remainingStock(5, 2), 3);
    assert.equal(remainingStock(5, 5), 0);
    assert.equal(remainingStock(null, 0), 0);
    const now = new Date('2026-10-09T12:00:00.000Z');
    assert.equal(reservationExpiry(now).toISOString(), '2026-10-09T12:20:00.000Z');
  });

  it('releases an active reservation idempotently', async () => {
    const rows = [{ id: 1, orderId: 7, productId: 5, quantity: 2, status: 'ACTIVE', expiresAt: new Date(Date.now() + 60_000) }];
    const tx: any = {
      select() {
        const query: any = { from() { return this; }, where() { return this; }, orderBy() { return this; },
          for: async () => rows.filter((row) => row.orderId === 7 && row.status === 'ACTIVE').map(({ id }) => ({ id })) };
        return query;
      },
      update(table: unknown) {
        return { set(values: any) { return { where: () => ({ returning: async () => {
          if (table !== inventoryReservations) return [];
          const released = rows.filter((row) => row.orderId === 7 && row.status === 'ACTIVE');
          const statement = new PgDialect().sqlToQuery(values.status).sql;
          assert.match(statement, /clock_timestamp\(\)/);
          for (const row of released) row.status = row.expiresAt <= new Date() ? 'EXPIRED' : 'RELEASED';
          return released.map(({ id, quantity }) => ({ id, quantity }));
        } }) }; } };
      },
    };
    assert.equal((await releaseOrderReservations(tx, 7)).length, 1);
    assert.equal((await releaseOrderReservations(tx, 7)).length, 0);
    assert.equal(rows[0].status, 'RELEASED');
    assert.equal(rows[0].quantity, 2, 'release never restores physical product stock');
  });

  it('rechecks consumption with database wall time after order, reservation, and product locks', async () => {
    const startedAt = new Date('2026-10-09T12:00:00.000Z');
    const expiresAt = new Date('2026-10-09T12:00:01.000Z');
    let wallTime = startedAt;
    let physicalStock = 1;
    const events: string[] = [];
    const reservation = { id: 1, orderId: 7, productId: 5, quantity: 1, status: 'ACTIVE', expiresAt };
    const tx: any = {
      select() {
        const query: any = { table: null, from(table: unknown) { this.table = table; return this; }, where() { return this; }, orderBy() { return this; },
          for: async function (this: any) {
            if (this.table === orders) { events.push('lock:order'); return [{ id: 7, paymentStatus: 'UNPAID', fulfillmentStatus: 'UNFULFILLED' }]; }
            if (this.table === inventoryReservations) { events.push('lock:reservation'); return [{ ...reservation }]; }
            if (this.table === products) { events.push('lock:product'); wallTime = new Date(expiresAt.getTime() + 1); return [{ id: 5, stock: physicalStock }]; }
            return [];
          },
          then(resolve: (rows: any[]) => unknown) { return Promise.resolve(this.table === orderItems ? [{ productId: 5, quantity: 1 }] : []).then(resolve); },
        };
        return query;
      },
      update(table: unknown) {
        return {
          set(_values: any) {
            return {
              where(condition: any) {
                return {
                  returning: async () => {
                    if (table === inventoryReservations) {
                      events.push('consume:conditional');
                      const sqlText = new PgDialect().sqlToQuery(condition).sql;
                      assert.match(sqlText, /clock_timestamp\(\)/, 'the final condition uses wall-clock time');
                      if (reservation.status !== 'ACTIVE' || wallTime >= expiresAt) return [];
                      reservation.status = 'CONSUMED';
                      return [{ id: reservation.id }];
                    }
                    if (table === products) {
                      physicalStock -= 1;
                      return [{ id: 5 }];
                    }
                    return [];
                  },
                };
              },
            };
          },
        };
      },
    };
    await assert.rejects(consumeOrderReservations(tx, 7), /expired before it could be consumed/);
    assert.deepEqual(events, ['lock:order', 'lock:reservation', 'lock:product', 'consume:conditional']);
    assert.equal(physicalStock, 1, 'an expired reservation does not decrement inventory');
    assert.equal(reservation.status, 'ACTIVE', 'transaction caller must roll back after helper rejection');
  });

  it('refuses released or mismatched reservations before decrementing physical stock', async () => {
    const reservation = { id: 1, orderId: 7, productId: 5, quantity: 1, status: 'RELEASED', expiresAt: new Date(Date.now() + 60_000) };
    const tx: any = {
      select() {
        const query: any = { table: null, from(table: unknown) { this.table = table; return this; }, where() { return this; }, orderBy() { return this; },
          for: async function (this: any) { return this.table === orders ? [{ id: 7, paymentStatus: 'UNPAID', fulfillmentStatus: 'UNFULFILLED' }] : this.table === inventoryReservations ? [reservation] : []; },
          then(resolve: (rows: any[]) => unknown) { return Promise.resolve([{ productId: 5, quantity: 1 }]).then(resolve); } };
        return query;
      },
    };
    await assert.rejects(consumeOrderReservations(tx, 7), /complete order reservation is not active/);
    reservation.status = 'ACTIVE';
    const mismatchedTx = Object.create(tx);
    mismatchedTx.select = () => {
      const query: any = { table: null, from(table: unknown) { this.table = table; return this; }, where() { return this; }, orderBy() { return this; },
        for: async function (this: any) { return this.table === orders ? [{ id: 7, paymentStatus: 'UNPAID', fulfillmentStatus: 'UNFULFILLED' }] : this.table === inventoryReservations ? [reservation] : []; },
        then(resolve: (rows: any[]) => unknown) { return Promise.resolve([{ productId: 5, quantity: 9 }]).then(resolve); } };
      return query;
    };
    await assert.rejects(consumeOrderReservations(mismatchedTx, 7), /does not match its purchased items/);
  });

  it('counts only unexpired active reservations when calculating sellable stock', async () => {
    const now = new Date('2026-10-09T12:00:00.000Z');
    const reservations = [
      { productId: 5, quantity: 2, status: 'ACTIVE', expiresAt: new Date('2026-10-09T12:10:00.000Z') },
      { productId: 5, quantity: 9, status: 'ACTIVE', expiresAt: new Date('2026-10-09T11:59:00.000Z') },
      { productId: 5, quantity: 4, status: 'RELEASED', expiresAt: new Date('2026-10-09T12:10:00.000Z') },
      { productId: 6, quantity: 3, status: 'ACTIVE', expiresAt: new Date('2026-10-09T12:10:00.000Z') },
    ];
    const tx: any = { select() {
      const query: any = { from() { return this; }, where(condition: any) { this.params = new PgDialect().sqlToQuery(condition).params; return this; }, groupBy() { return this; },
        then(resolve: (rows: any[]) => unknown) {
          const totals = new Map<number, number>();
          for (const row of reservations) if (this.params.includes(row.productId) && this.params.includes('ACTIVE') && row.status === 'ACTIVE' && row.expiresAt > now) totals.set(row.productId, (totals.get(row.productId) || 0) + row.quantity);
          return Promise.resolve([...totals].map(([productId, quantity]) => ({ productId, quantity }))).then(resolve);
        } };
      return query;
    } };
    const totals = await activeReservationTotals(tx, [5, 6], now);
    assert.equal(remainingStock(5, totals.get(5) || 0), 3);
    assert.equal(remainingStock(3, totals.get(6) || 0), 0);
  });

  it('expires unpaid reservations and closes the order without changing physical stock', async () => {
    const now = new Date('2026-10-09T12:00:00.000Z');
    const reservations = [
      { orderId: 7, productId: 5, quantity: 1, status: 'ACTIVE', expiresAt: new Date('2026-10-09T11:59:00.000Z') },
      { orderId: 8, productId: 5, quantity: 1, status: 'ACTIVE', expiresAt: new Date('2026-10-09T12:10:00.000Z') },
    ];
    const orderRows = [
      { id: 7, paymentStatus: 'UNPAID', fulfillmentStatus: 'UNFULFILLED' },
      { id: 8, paymentStatus: 'UNPAID', fulfillmentStatus: 'UNFULFILLED' },
    ];
    const tx: any = {
      select() {
        const query: any = { table: null, from(table: unknown) { this.table = table; return this; }, where() { return this; }, orderBy() { return this; },
          for() { return Promise.resolve(this.table === orders ? orderRows : reservations.filter((row) => row.status === 'ACTIVE' && row.expiresAt <= now).map(({ orderId }) => ({ id: orderId, orderId }))); },
          then(resolve: (rows: any[]) => unknown) { return this.for().then(resolve); } };
        return query;
      },
      update(table: unknown) {
        return { set(values: any) { return { where: () => ({
          returning: async () => {
            if (table !== inventoryReservations) return [];
            const changed = reservations.filter((row) => row.status === 'ACTIVE' && row.expiresAt <= now);
            for (const row of changed) Object.assign(row, values);
            return changed.map(({ orderId }) => ({ orderId }));
          },
          then: async (resolve: (value: unknown) => unknown) => {
            if (table === orders) Object.assign(orderRows[0], values);
            return resolve(undefined);
          },
        }) }; } };
      },
    };
    assert.equal(await expireInventoryReservations(tx, now), 1);
    assert.equal(reservations[0].status, 'EXPIRED');
    assert.equal(reservations[1].status, 'ACTIVE');
    assert.equal(orderRows[0].fulfillmentStatus, 'CANCELLED');
    assert.equal(reservations[0].quantity, 1, 'expiration does not restock already-physical stock');
  });

  it('makes concurrent cleanup runs idempotent after they observe the same expired candidate', async () => {
    const now = new Date('2026-10-09T12:00:00.000Z');
    const reservations = [{ id: 1, orderId: 7, productId: 5, quantity: 1, status: 'ACTIVE', expiresAt: new Date('2026-10-09T11:59:00.000Z') }];
    const orderRows = [{ id: 7, paymentStatus: 'UNPAID', fulfillmentStatus: 'UNFULFILLED' }];
    let candidateReads = 0;
    let releaseCandidates!: () => void;
    const bothCandidatesRead = new Promise<void>((resolve) => { releaseCandidates = resolve; });
    let transactionTail = Promise.resolve();
    const runCleanup = async () => {
      let releaseOrderLock: (() => void) | undefined;
      const tx: any = {
        select() {
          const query: any = { table: null, from(table: unknown) { this.table = table; return this; }, where() { return this; }, orderBy() { return this; },
            for: async function (this: any) {
              if (this.table === orders) {
                const previous = transactionTail;
                transactionTail = new Promise<void>((resolve) => { releaseOrderLock = resolve; });
                await previous;
                return orderRows;
              }
              return reservations.filter((row) => row.status === 'ACTIVE');
            },
            then: async function (this: any, resolve: (rows: any[]) => unknown) {
              const snapshot = reservations.filter((row) => row.status === 'ACTIVE' && row.expiresAt <= now).map(({ orderId }) => ({ orderId }));
              candidateReads += 1;
              if (candidateReads === 2) releaseCandidates();
              await bothCandidatesRead;
              return resolve(snapshot);
            } };
          return query;
        },
        update(table: unknown) {
          return { set(values: any) { return { where: () => ({
            returning: async () => {
              if (table !== inventoryReservations) return [];
              const changed = reservations.filter((row) => row.status === 'ACTIVE' && row.expiresAt <= now);
              for (const row of changed) Object.assign(row, values);
              return changed.map(({ orderId }) => ({ orderId }));
            },
            then: async (resolve: (value: unknown) => unknown) => {
              if (table === orders && orderRows[0].paymentStatus === 'UNPAID' && orderRows[0].fulfillmentStatus === 'UNFULFILLED') Object.assign(orderRows[0], values);
              return resolve(undefined);
            },
          }) }; } };
        },
      };
      try { return await expireInventoryReservations(tx, now); }
      finally { releaseOrderLock?.(); }
    };
    const counts = await Promise.all([runCleanup(), runCleanup()]);
    assert.deepEqual(counts.sort(), [0, 1]);
    assert.equal(reservations[0].status, 'EXPIRED');
    assert.equal(orderRows[0].fulfillmentStatus, 'CANCELLED');
  });

  it('keeps the reservation migration additive for existing unpaid orders', async () => {
    const migration = await readFile(new URL('../drizzle/0004_inventory-reservations.sql', import.meta.url), 'utf8');
    assert.match(migration, /CREATE TABLE "inventory_reservations"/);
    assert.match(migration, /REFERENCES "public"\."orders"\("id"\)/);
    assert.match(migration, /REFERENCES "public"\."products"\("id"\)/);
    assert.doesNotMatch(migration, /UPDATE\s+"orders"|UPDATE\s+"products"|DELETE\s+FROM\s+"orders"|DELETE\s+FROM\s+"products"/i);
  });

  it('accepts checkout only when every product explicitly has INR currency', async () => {
    const invalidCurrencyProducts = [
      { label: 'null currency', currency: null },
      { label: 'missing currency', currency: undefined },
      { label: 'unsupported currency', currency: 'USD' },
    ];
    for (const { label, currency } of invalidCurrencyProducts) {
      const { database, state } = fakeDatabase({ currency: currency as string | null });
      const app = express(); app.use(express.json()); app.use('/api/orders', createOrderRouter(database, authenticated));
      await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/orders`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key }, body: JSON.stringify(input) });
        assert.equal(response.status, 409, label);
        assert.match((await response.json()).error, /explicitly configured INR currency/);
        assert.equal(state.orders.length, 0, `${label}: no order or successful idempotency record`);
        assert.equal(state.orderItems.length, 0, `${label}: no order items`);
        assert.equal(state.cart.length, 1, `${label}: customer cart is preserved`);
      });
    }
  });

  it('rejects a mixed cart if any product lacks the explicitly supported currency', async () => {
    const { database, state } = fakeDatabase({
      cart: [{ userId: customerA, productId: 5, quantity: 2 }, { userId: customerA, productId: 6, quantity: 1 }],
      products: [
        { id: 5, name: 'RC Truck', slug: 'rc-truck', price: '125.50', currency: 'INR', stock: 4, availability: 'IN_STOCK', isPublished: true },
        { id: 6, name: 'RC Plane', slug: 'rc-plane', price: '200.00', currency: null, stock: 3, availability: 'IN_STOCK', isPublished: true },
      ],
    });
    const mixedInput = { ...input, items: [{ productId: 5, quantity: 2 }, { productId: 6, quantity: 1 }] };
    const app = express(); app.use(express.json()); app.use('/api/orders', createOrderRouter(database, authenticated));
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/orders`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key }, body: JSON.stringify(mixedInput) });
      assert.equal(response.status, 409);
      assert.match((await response.json()).error, /explicitly configured INR currency/);
      assert.equal(state.orders.length, 0, 'invalid mixed cart rolls back the idempotency claim');
      assert.equal(state.orderItems.length, 0);
      assert.equal(state.cart.length, 2, 'all cart quantities remain available');
    });
  });

  it('rejects stock changes and rolls back the idempotency claim and cart writes', async () => {
    const { database, state } = fakeDatabase({ stock: 1 });
    const app = express(); app.use(express.json()); app.use('/api/orders', createOrderRouter(database, authenticated));
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/orders`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key }, body: JSON.stringify(input) });
      assert.equal(response.status, 409);
      assert.equal(state.orders.length, 0, 'failed validation rolls back the claimed key');
      assert.equal(state.cart.length, 1, 'failed order keeps the customer cart');
    });
  });

  it('rolls back the order and cart if writing order items fails', async () => {
    const { database, state } = fakeDatabase({ failOrderItems: true });
    const app = express(); app.use(express.json()); app.use('/api/orders', createOrderRouter(database, authenticated));
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/orders`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key }, body: JSON.stringify(input) });
      assert.equal(response.status, 500);
      assert.equal(state.orders.length, 0);
      assert.equal(state.orderItems.length, 0);
      assert.equal(state.cart.length, 1);
    });
  });

  it('rejects unauthenticated checkout and owner order access before database access', async () => {
    const { database, state } = fakeDatabase();
    const rejectAuth: RequestHandler = (_req, res) => { res.status(401).json({ error: 'Authentication required.' }); };
    const ownerDenied: RequestHandler = (_req, res) => { res.status(403).json({ error: 'Owner access required.' }); };
    const app = express(); app.use(express.json());
    app.use('/api/orders', createOrderRouter(database, rejectAuth));
    app.use('/api/admin/orders', createAdminOrderRouter(database, authenticated, ownerDenied));
    await withServer(app, async (baseUrl) => {
      const checkout = await fetch(`${baseUrl}/api/orders`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key }, body: JSON.stringify(input) });
      assert.equal(checkout.status, 401);
      const ownerList = await fetch(`${baseUrl}/api/admin/orders`);
      assert.equal(ownerList.status, 403);
      assert.equal(state.transactions, 0);
      assert.equal(state.orders.length, 0);
    });
  });

  it('filters customer order history by the verified Supabase UUID', async () => {
    const rows = [
      { id: 1, customerAuthId: customerA, total: '100.00', createdAt: new Date() },
      { id: 2, customerAuthId: customerB, total: '200.00', createdAt: new Date() },
    ];
    let whereParameters: unknown[] = [];
    const database: any = {
      select() {
        const query: any = {
          table: null,
          filterParameters: [],
          $dynamic() { return this; },
          from(table: unknown) { this.table = table; return this; },
          where(condition: any) { this.filterParameters = new PgDialect().sqlToQuery(condition).params; if (this.table === orders) whereParameters = this.filterParameters; return this; },
          orderBy() { return this; },
          then(resolve: (value: any) => unknown, reject: (error: unknown) => unknown) {
            const selected = this.table === orders ? rows.filter((row) => this.filterParameters.includes(row.customerAuthId)) : [];
            return Promise.resolve(selected).then(resolve, reject);
          },
        };
        return query;
      },
    };
    const authB: RequestHandler = (req, _res, next) => {
      (req as Request & { authUser: { id: string } }).authUser = { id: customerB };
      next();
    };
    const app = express(); app.use('/api/orders', createOrderRouter(database, authB));
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/orders/mine`);
      const responseText = await response.text();
      assert.equal(response.status, 200, responseText);
      const payload = JSON.parse(responseText);
      assert.deepEqual(payload.orders.map((row: { id: number }) => row.id), [2]);
      assert.ok(whereParameters.includes(customerB));
      assert.equal(whereParameters.includes(customerA), false);
    });
  });
});
