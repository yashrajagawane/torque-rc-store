import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import express, { type Request, type RequestHandler } from 'express';
import { describe, it } from 'node:test';
import { PgDialect } from 'drizzle-orm/pg-core';
import { orders, inventoryReservations, orderItems, paymentReviewCases, razorpayWebhookEvents } from '../src/db/schema.ts';
import { createPaymentRouter, createRazorpayWebhookHandler, capturedPaymentMatches } from '../src/server/payment-routes.ts';
import { createPaymentSignature, createWebhookSignature, getRazorpayTestConfig, verifyPaymentSignature, verifyWebhookSignature } from '../src/server/razorpay.ts';

const customerId = '11111111-1111-4111-8111-111111111111';
const ownerId = '22222222-2222-4222-8222-222222222222';
const configEnv = { RAZORPAY_KEY_ID: 'rzp_test_public', RAZORPAY_KEY_SECRET: 'test-secret', RAZORPAY_WEBHOOK_SECRET: 'webhook-secret' };

const authAs = (id: string): RequestHandler => (req, _res, next) => {
  (req as Request & { authUser: { id: string; email: string } }).authUser = { id, email: `${id}@example.test` };
  next();
};

async function withServer(app: express.Express, run: (url: string) => Promise<void>) {
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  try { await run(`http://127.0.0.1:${address.port}`); }
  finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
}

function makePaymentDatabase(options: { customer?: string; gatewayOrderId?: string; fulfillmentStatus?: string } = {}) {
  const state = {
    order: {
      id: 12, customerAuthId: options.customer || customerId, total: '125.50', currency: 'INR',
      status: 'PENDING', paymentStatus: 'UNPAID', fulfillmentStatus: options.fulfillmentStatus || 'UNFULFILLED',
      razorpayOrderId: options.gatewayOrderId || null as string | null, razorpayPaymentId: null as string | null,
      razorpayOrderCreationStatus: 'NOT_STARTED',
    },
    reservations: [{ id: 1, orderId: 12, productId: 5, quantity: 2, status: 'ACTIVE', expiresAt: new Date(Date.now() + 60_000) }],
    items: [{ productId: 5, quantity: 2 }],
    reviewCases: [] as any[],
    simulatedStock: 10,
    transactions: 0,
  };
  const rowsFor = (table: unknown, parameters: unknown[] = []) => {
    if (table === orders) {
      const identityFilters = parameters.filter((parameter) => typeof parameter === 'string' && /^[0-9a-f-]{36}$/i.test(parameter));
      return parameters.length === 0 || (parameters.includes(state.order.id) && (!identityFilters.length || identityFilters.includes(state.order.customerAuthId))) || (state.order.razorpayOrderId !== null && parameters.includes(state.order.razorpayOrderId)) ? [state.order] : [];
    }
    if (table === inventoryReservations) {
      if (parameters.includes('ACTIVE')) return state.reservations.filter((row) => row.status === 'ACTIVE' && row.expiresAt > new Date());
      return state.reservations;
    }
    return table === orderItems ? state.items : [];
  };
  const tx: any = {
    select() {
      const query: any = {
        table: null as unknown,
        parameters: [] as unknown[],
        from(table: unknown) { this.table = table; return this; },
        where(condition: any) { this.parameters = new PgDialect().sqlToQuery(condition).params; return this; }, orderBy() { return this; },
        for: async function(this: any) { return rowsFor(this.table, this.parameters); },
        then: function(this: any, resolve: (value: any) => unknown, reject: (error: unknown) => unknown) { return Promise.resolve(rowsFor(this.table, this.parameters)).then(resolve, reject); },
      };
      return query;
    },
    update(table: unknown) {
      return {
        set(values: any) {
          const apply = () => { if (table === orders) Object.assign(state.order, values); };
          return { where: () => ({
            async returning() { apply(); return [{ id: state.order.id }]; },
            then(resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) { try { apply(); return Promise.resolve([]).then(resolve, reject); } catch (error) { return Promise.reject(error).then(resolve, reject); } },
          }) };
        },
      };
    },
    insert(table: unknown) {
      return { values(values: any) {
        const query: any = {
          onConflictDoNothing() { return this; },
          async returning() {
            if (table !== razorpayWebhookEvents) return [];
            return [{ id: 1 }];
          },
          then(resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) {
            if (table === paymentReviewCases) state.reviewCases.push(values);
            return Promise.resolve(undefined).then(resolve, reject);
          },
        };
        return query;
      } };
    },
    async transaction(callback: (savepoint: any) => Promise<unknown>) {
      const snapshot = { order: { ...state.order }, simulatedStock: state.simulatedStock };
      try { return await callback(tx); }
      catch (error) {
        Object.assign(state.order, snapshot.order);
        state.simulatedStock = snapshot.simulatedStock;
        throw error;
      }
    },
  };
  const database: any = {
    select: tx.select,
    transaction: async (callback: (transaction: any) => Promise<unknown>) => { state.transactions += 1; return callback(tx); },
  };
  return { database, state };
}

describe('Razorpay Test Mode payment security', () => {
  it('requires a Test Mode key and all server-side credentials', () => {
    assert.deepEqual(getRazorpayTestConfig(configEnv), {
      keyId: 'rzp_test_public', keySecret: 'test-secret', webhookSecret: 'webhook-secret',
    });
    assert.equal(getRazorpayTestConfig({ ...configEnv, RAZORPAY_KEY_ID: 'rzp_live_public' }), null);
    assert.equal(getRazorpayTestConfig({ ...configEnv, RAZORPAY_KEY_SECRET: undefined }), null);
    assert.equal(getRazorpayTestConfig({ ...configEnv, RAZORPAY_WEBHOOK_SECRET: undefined }), null);
  });

  it('verifies payment signatures against the supplied server-side order and payment IDs', () => {
    const signature = createPaymentSignature('order_test123', 'pay_test456', 'test-secret');
    assert.equal(verifyPaymentSignature('order_test123', 'pay_test456', signature, 'test-secret'), true);
    assert.equal(verifyPaymentSignature('order_other', 'pay_test456', signature, 'test-secret'), false);
    assert.equal(verifyPaymentSignature('order_test123', 'pay_other', signature, 'test-secret'), false);
    assert.equal(verifyPaymentSignature('order_test123', 'pay_test456', 'not-a-signature', 'test-secret'), false);
  });

  it('accepts only captured INR payments with the exact provider order, payment ID and amount', () => {
    const payment = { id: 'pay_1', order_id: 'order_1', amount: 12550, currency: 'INR', status: 'captured', captured: true };
    assert.equal(capturedPaymentMatches(payment, { paymentId: 'pay_1', gatewayOrderId: 'order_1', amount: 12550 }), true);
    assert.equal(capturedPaymentMatches({ ...payment, amount: 12549 }, { gatewayOrderId: 'order_1', amount: 12550 }), false);
    assert.equal(capturedPaymentMatches({ ...payment, currency: 'USD' }, { gatewayOrderId: 'order_1', amount: 12550 }), false);
    assert.equal(capturedPaymentMatches({ ...payment, status: 'authorized', captured: false }, { gatewayOrderId: 'order_1', amount: 12550 }), false);
    assert.equal(capturedPaymentMatches({ ...payment, order_id: 'order_2' }, { gatewayOrderId: 'order_1', amount: 12550 }), false);
  });

  it('does not initialize payment/database operations for an unauthenticated customer', async () => {
    let calls = 0;
    const app = express(); app.use('/api/orders', createPaymentRouter({} as any, (_req, res) => { res.status(401).end(); }, { env: configEnv, createGatewayOrder: async () => { calls += 1; throw new Error(); } }));
    await withServer(app, async (url) => {
      const response = await fetch(`${url}/api/orders/12/razorpay-order`, { method: 'POST' });
      assert.equal(response.status, 401);
      assert.equal(calls, 0);
    });
  });

  it('rejects cross-customer payment-order requests without creating a provider order', async () => {
    const { database } = makePaymentDatabase({ customer: ownerId });
    let providerCalls = 0;
    const app = express(); app.use('/api/orders', createPaymentRouter(database, authAs(customerId), {
      env: configEnv, createGatewayOrder: async () => { providerCalls += 1; return { id: 'order_new', amount: 12550, currency: 'INR', status: 'created' }; },
    }));
    await withServer(app, async (url) => {
      const response = await fetch(`${url}/api/orders/12/razorpay-order`, { method: 'POST' });
      assert.equal(response.status, 404);
      assert.equal(providerCalls, 0);
    });
  });

  it('rejects cross-customer payment verification without querying Razorpay', async () => {
    const { database } = makePaymentDatabase({ customer: ownerId, gatewayOrderId: 'order_test123' });
    let providerCalls = 0;
    const app = express(); app.use(express.json()); app.use('/api/orders', createPaymentRouter(database, authAs(customerId), {
      env: configEnv, fetchGatewayPayment: async () => { providerCalls += 1; throw new Error('should not be called'); },
    }));
    await withServer(app, async (url) => {
      const response = await fetch(`${url}/api/orders/12/verify-payment`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ razorpay_order_id: 'order_test123', razorpay_payment_id: 'pay_1', razorpay_signature: '0'.repeat(64) }),
      });
      assert.equal(response.status, 404);
      assert.equal(providerCalls, 0);
    });
  });

  it('rejects invalid signatures and mismatched provider order IDs before status confirmation', async () => {
    for (const orderId of ['order_test123', 'order_wrong']) {
      const { database } = makePaymentDatabase({ gatewayOrderId: 'order_test123' });
      let providerCalls = 0;
      const app = express(); app.use(express.json()); app.use('/api/orders', createPaymentRouter(database, authAs(customerId), {
        env: configEnv,
        fetchGatewayPayment: async () => { providerCalls += 1; return { id: 'pay_1', order_id: 'order_test123', amount: 12550, currency: 'INR', status: 'captured', captured: true }; },
      }));
      await withServer(app, async (url) => {
        const response = await fetch(`${url}/api/orders/12/verify-payment`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ razorpay_order_id: orderId, razorpay_payment_id: 'pay_1', razorpay_signature: '0'.repeat(64) }),
        });
        assert.ok([400, 409].includes(response.status));
        assert.equal(providerCalls, 0);
      });
    }
  });

  it('marks an order paid only after signature and fetched captured-payment verification, idempotently', async () => {
    const { database, state } = makePaymentDatabase({ gatewayOrderId: 'order_test123' });
    let consumeCalls = 0;
    const payment = { id: 'pay_1', order_id: 'order_test123', amount: 12550, currency: 'INR', status: 'captured', captured: true };
    const app = express(); app.use(express.json()); app.use('/api/orders', createPaymentRouter(database, authAs(customerId), {
      env: configEnv,
      fetchGatewayPayment: async () => payment,
      consumeReservations: async () => { consumeCalls += 1; return 1; },
    }));
    const callback = { razorpay_order_id: 'order_test123', razorpay_payment_id: 'pay_1', razorpay_signature: createPaymentSignature('order_test123', 'pay_1', 'test-secret') };
    await withServer(app, async (url) => {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const response = await fetch(`${url}/api/orders/12/verify-payment`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(callback),
        });
        assert.equal(response.status, 200);
        assert.equal((await response.json() as any).paymentStatus, 'PAID');
      }
    });
    assert.equal(consumeCalls, 1);
    assert.equal(state.order.paymentStatus, 'PAID');
    assert.equal(state.order.razorpayPaymentId, 'pay_1');
  });

  it('records captured payments for cancelled orders for manual review without marking them paid', async () => {
    const { database, state } = makePaymentDatabase({ gatewayOrderId: 'order_test123', fulfillmentStatus: 'CANCELLED' });
    let consumeCalls = 0;
    const payment = { id: 'pay_late', order_id: 'order_test123', amount: 12550, currency: 'INR', status: 'captured', captured: true };
    const app = express(); app.use(express.json()); app.use('/api/orders', createPaymentRouter(database, authAs(customerId), {
      env: configEnv, fetchGatewayPayment: async () => payment,
      consumeReservations: async () => { consumeCalls += 1; return 1; },
    }));
    const callback = { razorpay_order_id: 'order_test123', razorpay_payment_id: 'pay_late', razorpay_signature: createPaymentSignature('order_test123', 'pay_late', 'test-secret') };
    await withServer(app, async (url) => {
      const response = await fetch(`${url}/api/orders/12/verify-payment`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(callback),
      });
      assert.equal(response.status, 202);
      assert.equal((await response.json() as any).reviewRequired, true);
    });
    assert.equal(state.order.paymentStatus, 'UNPAID');
    assert.equal(state.reviewCases.length, 1);
    assert.match(state.reviewCases[0].reason, /ineligible/);
    assert.equal(consumeCalls, 0);
  });

  it('rolls back mocked inventory consumption when the savepoint helper fails, then records review', async () => {
    const { database, state } = makePaymentDatabase({ gatewayOrderId: 'order_test123' });
    state.simulatedStock = 10;
    const payment = { id: 'pay_stock', order_id: 'order_test123', amount: 12550, currency: 'INR', status: 'captured', captured: true };
    const app = express(); app.use(express.json()); app.use('/api/orders', createPaymentRouter(database, authAs(customerId), {
      env: configEnv, fetchGatewayPayment: async () => payment,
      consumeReservations: async () => { state.simulatedStock -= 2; throw new Error('reservation expired'); },
    }));
    const callback = { razorpay_order_id: 'order_test123', razorpay_payment_id: 'pay_stock', razorpay_signature: createPaymentSignature('order_test123', 'pay_stock', 'test-secret') };
    await withServer(app, async (url) => {
      const response = await fetch(`${url}/api/orders/12/verify-payment`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(callback),
      });
      assert.equal(response.status, 202);
    });
    assert.equal(state.simulatedStock, 10, 'the mock savepoint restores partial inventory work');
    assert.equal(state.order.paymentStatus, 'UNPAID');
    assert.equal(state.reviewCases.length, 1);
  });

  it('reuses the same stored provider order on retry', async () => {
    const { database, state } = makePaymentDatabase();
    let providerCalls = 0;
    const app = express(); app.use('/api/orders', createPaymentRouter(database, authAs(customerId), {
      env: configEnv,
      createGatewayOrder: async ({ amount }) => { providerCalls += 1; return { id: 'order_test123', amount, currency: 'INR', status: 'created' }; },
    }));
    await withServer(app, async (url) => {
      const first = await fetch(`${url}/api/orders/12/razorpay-order`, { method: 'POST' });
      const second = await fetch(`${url}/api/orders/12/razorpay-order`, { method: 'POST' });
      const firstBody = await first.json();
      assert.equal(first.status, 200, JSON.stringify(firstBody));
      assert.equal(second.status, 200);
      assert.equal((firstBody as any).razorpayOrderId, 'order_test123');
      assert.equal((await second.json() as any).razorpayOrderId, 'order_test123');
    });
    assert.equal(providerCalls, 1);
    assert.equal(state.order.razorpayOrderCreationStatus, 'CREATED');
  });

  it('rejects an invalid webhook signature before database access', async () => {
    let transactions = 0;
    const app = express(); app.post('/webhook', express.raw({ type: 'application/json' }), createRazorpayWebhookHandler({ transaction: async () => { transactions += 1; } } as any, configEnv));
    const body = Buffer.from('{"event":"payment.failed","payload":{"payment":{"entity":{"id":"pay_1","order_id":"order_1","amount":12550,"currency":"INR","status":"failed","captured":false}}}}');
    await withServer(app, async (url) => {
      const response = await fetch(`${url}/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Razorpay-Event-Id': 'evt_1', 'X-Razorpay-Signature': '0'.repeat(64) }, body });
      assert.equal(response.status, 400);
    });
    assert.equal(transactions, 0);
  });

  it('rejects malformed signed webhook JSON before database access', async () => {
    let transactions = 0;
    const app = express(); app.post('/webhook', express.raw({ type: 'application/json' }), createRazorpayWebhookHandler({ transaction: async () => { transactions += 1; } } as any, configEnv));
    const body = Buffer.from('{invalid');
    await withServer(app, async (url) => {
      const response = await fetch(`${url}/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Razorpay-Event-Id': 'evt_2', 'X-Razorpay-Signature': createWebhookSignature(body, 'webhook-secret') }, body });
      assert.equal(response.status, 400);
    });
    assert.equal(transactions, 0);
  });

  it('deduplicates signed webhook event IDs and records failed events without changing order state', async () => {
    const events = new Map<string, any>();
    const state = { orderUpdates: 0 };
    const database: any = {
      async transaction(callback: (tx: any) => Promise<unknown>) {
        const tx = {
          insert(table: unknown) {
            return { values(values: any) {
              const query: any = {
                onConflictDoNothing() { return this; },
                async returning() {
                  if (table !== razorpayWebhookEvents || events.has(values.eventId)) return [];
                  events.set(values.eventId, { id: events.size + 1, ...values });
                  return [{ id: events.size }];
                },
              };
              return query;
            } };
          },
          update(table: unknown) {
            return {
              set(values: any) {
                return { where: async () => {
                  if (table === razorpayWebhookEvents) for (const event of events.values()) Object.assign(event, values);
                  else state.orderUpdates += 1;
                } };
              },
            };
          },
        };
        return callback(tx);
      },
    };
    const app = express(); app.post('/webhook', express.raw({ type: 'application/json' }), createRazorpayWebhookHandler(database, configEnv));
    const body = Buffer.from(JSON.stringify({ event: 'payment.failed', payload: { payment: { entity: { id: 'pay_1', order_id: 'order_1', amount: 12550, currency: 'INR', status: 'failed', captured: false } } } }));
    const headers = { 'Content-Type': 'application/json', 'X-Razorpay-Event-Id': 'evt_duplicate', 'X-Razorpay-Signature': createWebhookSignature(body, 'webhook-secret') };
    await withServer(app, async (url) => {
      const first = await fetch(`${url}/webhook`, { method: 'POST', headers, body });
      const duplicate = await fetch(`${url}/webhook`, { method: 'POST', headers, body });
      assert.equal(first.status, 200);
      assert.equal(duplicate.status, 200);
      assert.equal((await duplicate.json() as any).result, 'duplicate');
    });
    assert.equal(events.size, 1);
    assert.equal(state.orderUpdates, 0, 'failed/out-of-order events never downgrade or update paid order state');
    assert.equal([...events.values()][0].processingStatus, 'PROCESSED');
  });
});
