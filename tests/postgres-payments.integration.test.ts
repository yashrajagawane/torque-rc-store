import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { after, before, describe, it } from 'node:test';
import express, { type Request, type RequestHandler } from 'express';
import { eq, inArray, or } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from '../src/db/schema.ts';
import { cartItems, contactInquiries, inventoryReservations, orderItems, orders, paymentReviewCases, products, razorpayWebhookEvents } from '../src/db/schema.ts';
import { createPaymentRouter, createRazorpayWebhookHandler } from '../src/server/payment-routes.ts';
import { createOrderRouter } from '../src/server/order-routes.ts';
import { createAdminContactInquiryRouter, createPublicContactRouter } from '../src/server/contact-routes.ts';
import { createRequireOwner } from '../src/server/auth.ts';
import { createPaymentSignature, createWebhookSignature } from '../src/server/razorpay.ts';
import { initializePostgresIntegrationPool, resolvePostgresIntegrationOptIn } from './postgres-integration-guard.ts';
import { createPostgresFixtureScope, withPostgresFixtureCleanup, type PostgresFixtureScope } from './postgres-fixture-scope.ts';

// The guard executes before a Pool is constructed. There is intentionally no
// DATABASE_URL fallback and no import of the app's eager-pool db module.
const testSettings = resolvePostgresIntegrationOptIn(process.env);
const testCredentials = {
  RAZORPAY_KEY_ID: 'rzp_test_integration_mock',
  RAZORPAY_KEY_SECRET: 'integration-only-mock-secret',
  RAZORPAY_WEBHOOK_SECRET: 'integration-only-mock-webhook-secret',
};

const users: string[] = [randomUUID(), randomUUID()];
const testPaymentId = () => `pay_${randomUUID().replaceAll('-', '')}`;
const testGatewayOrderId = () => `order_${randomUUID().replaceAll('-', '')}`;
const testEventId = () => `evt_${randomUUID().replaceAll('-', '')}`;

describe('PostgreSQL payment and inventory integration', () => {
  if (!testSettings) {
    it.skip('requires RUN_POSTGRES_INTEGRATION_TESTS=true and a confirmed TEST_DATABASE_URL', () => {});
    return;
  }

  let pool: Pool | undefined;
  let database: ReturnType<typeof drizzle<typeof schema>>;

  before(async () => {
    pool = initializePostgresIntegrationPool(process.env, (options) => new Pool(options));
    try {
      const result = await pool.query<{ ready: boolean }>(`
        SELECT to_regclass('public.products') IS NOT NULL
          AND to_regclass('public.orders') IS NOT NULL
          AND to_regclass('public.order_items') IS NOT NULL
          AND to_regclass('public.inventory_reservations') IS NOT NULL
          AND to_regclass('public.cart_items') IS NOT NULL
          AND to_regclass('public.razorpay_webhook_events') IS NOT NULL
          AND to_regclass('public.payment_review_cases') IS NOT NULL
          AND to_regclass('public.contact_inquiries') IS NOT NULL AS ready
      `);
      if (!result.rows[0]?.ready) throw new Error('The confirmed test database is missing required reviewed schema tables; no schema changes were applied.');
      database = drizzle(pool, { schema });
    } catch (error) {
      const failedPool = pool;
      pool = undefined;
      await failedPool.end();
      throw error;
    }
  });

  after(async () => {
    const activePool = pool;
    pool = undefined;
    if (activePool) await activePool.end();
  });

  async function createProduct(scope: PostgresFixtureScope, stock: number) {
    const slug = `pg-integration-${randomUUID()}`;
    scope.productSlugs.push(slug);
    const [product] = await database.insert(products).values({
      slug,
      name: 'PostgreSQL Integration Test Product',
      description: 'Disposable integration-test fixture.',
      price: '125.50',
      currency: 'INR',
      images: [],
      thumbnail: 'integration-test-placeholder',
      stock,
      availability: 'IN_STOCK',
      isPublished: true,
    }).returning({ id: products.id });
    scope.productIds.push(product.id);
    return product.id;
  }

  async function createCart(scope: PostgresFixtureScope, userId: string, productId: number, quantity = 1) {
    if (!scope.cartUserIds.includes(userId)) scope.cartUserIds.push(userId);
    await database.insert(cartItems).values({ userId, productId, quantity });
  }

  async function createOrderFixture(scope: PostgresFixtureScope, options: { stock?: number; reserved?: number; expiresAt?: Date; paymentStatus?: string } = {}) {
    const productId = await createProduct(scope, options.stock ?? 1);
    const gatewayOrderId = testGatewayOrderId();
    const customerAuthId = randomUUID();
    scope.orderCustomerAuthIds.push(customerAuthId);
    users.push(customerAuthId);
    const [order] = await database.insert(orders).values({
      customerAuthId, customerEmail: 'postgres-test@example.invalid',
      subtotal: '125.50', shippingAmount: '0.00', currency: 'INR', total: '125.50',
      status: options.paymentStatus === 'PAID' ? 'PAID' : 'PENDING',
      paymentStatus: options.paymentStatus ?? 'UNPAID', fulfillmentStatus: 'UNFULFILLED',
      razorpayOrderId: gatewayOrderId, razorpayOrderCreationStatus: 'CREATED',
      shippingAddress: { fullName: 'Integration Test', phone: '+919999999999', addressLine1: '1 Test Lane', city: 'Test City', state: 'Test State', postalCode: '123456', country: 'India' },
    }).returning({ id: orders.id });
    scope.orderIds.push(order.id);
    await database.insert(orderItems).values({ orderId: order.id, productId, productName: 'PostgreSQL Integration Test Product', productSlug: `test-${productId}`, quantity: options.reserved ?? 1, price: '125.50' });
    await database.insert(inventoryReservations).values({
      orderId: order.id, productId, quantity: options.reserved ?? 1, status: 'ACTIVE',
      expiresAt: options.expiresAt ?? new Date(Date.now() + 120_000),
    });
    return { orderId: order.id, productId, gatewayOrderId, customerAuthId };
  }

  async function cleanupFixture(scope: PostgresFixtureScope) {
    if (scope.contactEmails.length) await database.delete(contactInquiries).where(inArray(contactInquiries.email, scope.contactEmails));
    if (scope.eventIds.length) await database.delete(razorpayWebhookEvents).where(inArray(razorpayWebhookEvents.eventId, scope.eventIds));
    const orderFilters = [];
    if (scope.orderIds.length) orderFilters.push(inArray(orders.id, scope.orderIds));
    if (scope.orderCustomerAuthIds.length) orderFilters.push(inArray(orders.customerAuthId, scope.orderCustomerAuthIds));
    const foundOrders = orderFilters.length
      ? await database.select({ id: orders.id }).from(orders).where(or(...orderFilters))
      : [];
    const orderIds = [...new Set([...scope.orderIds, ...foundOrders.map((row) => row.id)])];
    const reviewFilters = [];
    if (orderIds.length) reviewFilters.push(inArray(paymentReviewCases.orderId, orderIds));
    if (scope.paymentIds.length) reviewFilters.push(inArray(paymentReviewCases.razorpayPaymentId, scope.paymentIds));
    if (reviewFilters.length) await database.delete(paymentReviewCases).where(or(...reviewFilters));
    if (orderIds.length) {
      await database.delete(inventoryReservations).where(inArray(inventoryReservations.orderId, orderIds));
      await database.delete(orderItems).where(inArray(orderItems.orderId, orderIds));
      await database.delete(orders).where(inArray(orders.id, orderIds));
    }
    if (scope.cartUserIds.length) await database.delete(cartItems).where(inArray(cartItems.userId, scope.cartUserIds));
    const productFilters = [];
    if (scope.productIds.length) productFilters.push(inArray(products.id, scope.productIds));
    if (scope.productSlugs.length) productFilters.push(inArray(products.slug, scope.productSlugs));
    if (productFilters.length) await database.delete(products).where(or(...productFilters));
  }

  async function withFixture<T>(work: (scope: PostgresFixtureScope) => Promise<T>) {
    const scope = createPostgresFixtureScope();
    return withPostgresFixtureCleanup(() => work(scope), () => cleanupFixture(scope));
  }

  const authByHeader: RequestHandler = (req, res, next) => {
    const id = req.header('X-Integration-Customer');
    if (!id || !users.includes(id)) { res.status(401).end(); return; }
    (req as Request & { authUser: { id: string; email: string } }).authUser = { id, email: 'postgres-test@example.invalid' };
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

  function checkoutApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/orders', createOrderRouter(database, authByHeader));
    return app;
  }

  function contactApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/contact-inquiries', createPublicContactRouter(database));
    const ownerAuth: RequestHandler = (req, res, next) => {
      if (req.header('X-Integration-Owner') !== 'owner') { res.status(401).end(); return; }
      (req as Request & { authUser: { id: string; email: string; email_confirmed_at: string; user_metadata: Record<string, unknown> } }).authUser = {
        id: 'integration-owner', email: 'owner@example.invalid', email_confirmed_at: 'verified', user_metadata: {},
      };
      next();
    };
    app.use('/api/admin/contact-inquiries', createAdminContactInquiryRouter(
      database, ownerAuth, createRequireOwner(() => 'owner@example.invalid'),
    ));
    return app;
  }

  function paymentApp(
    payment: { id: string; order_id: string; amount: number; currency: string; status: string; captured: boolean },
    observeRawWebhookBody?: (body: Buffer) => void,
  ) {
    const app = express();
    // Match production server.ts: preserve the signed raw webhook bytes before
    // installing the JSON parser used by the customer payment routes.
    app.post('/api/payments/razorpay/webhook', express.raw({ type: 'application/json', limit: '1mb' }), (req, res, next) => {
      if (!Buffer.isBuffer(req.body)) { res.status(400).end(); return; }
      observeRawWebhookBody?.(req.body);
      next();
    }, createRazorpayWebhookHandler(database, testCredentials));
    app.use(express.json());
    app.use('/api/orders', createPaymentRouter(database, authByHeader, {
      env: testCredentials,
      fetchGatewayPayment: async () => payment,
    }));
    return app;
  }

  function checkoutBody(productId: number) {
    return { items: [{ productId, quantity: 1 }], shippingAddress: { fullName: 'Integration Test', phone: '+919999999999', addressLine1: '1 Test Lane', city: 'Test City', state: 'Test State', postalCode: '123456', country: 'India' } };
  }

  async function verifyPayment(url: string, customerAuthId: string, orderId: number, gatewayOrderId: string, paymentId: string) {
    return fetch(`${url}/api/orders/${orderId}/verify-payment`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Integration-Customer': customerAuthId },
      body: JSON.stringify({ razorpay_order_id: gatewayOrderId, razorpay_payment_id: paymentId, razorpay_signature: createPaymentSignature(gatewayOrderId, paymentId, testCredentials.RAZORPAY_KEY_SECRET) }),
    });
  }

  async function sendCapturedWebhook(url: string, gatewayOrderId: string, paymentId: string, eventId: string) {
    const body = Buffer.from(JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: {
      id: paymentId, order_id: gatewayOrderId, amount: 12550, currency: 'INR', status: 'captured', captured: true,
    } } } }));
    return fetch(`${url}/api/payments/razorpay/webhook`, {
      method: 'POST', headers: {
        'Content-Type': 'application/json', 'X-Razorpay-Event-Id': eventId,
        'X-Razorpay-Signature': createWebhookSignature(body, testCredentials.RAZORPAY_WEBHOOK_SECRET),
      }, body,
    });
  }

  it('serializes two checkouts competing for the final unit and preserves both cart outcomes', async () => {
    await withFixture(async (scope) => {
      const productId = await createProduct(scope, 1);
      const [userA, userB] = users;
      scope.orderCustomerAuthIds.push(userA!, userB!);
      await createCart(scope, userA!, productId);
      await createCart(scope, userB!, productId);
      const app = checkoutApp();
      await withServer(app, async (url) => {
        const submit = (userId: string) => fetch(`${url}/api/orders`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Integration-Customer': userId, 'Idempotency-Key': randomUUID() },
          body: JSON.stringify(checkoutBody(productId)),
        });
        const results = await Promise.all([submit(userA!), submit(userB!)]);
        assert.deepEqual(results.map((response) => response.status).sort(), [201, 409]);
      });
      const [product] = await database.select({ stock: products.stock }).from(products).where(eq(products.id, productId));
      const reservations = await database.select().from(inventoryReservations).where(eq(inventoryReservations.productId, productId));
      const customerOrders = await database.select().from(orders).where(inArray(orders.customerAuthId, [userA!, userB!]));
      const remainingCarts = await database.select().from(cartItems).where(inArray(cartItems.userId, [userA!, userB!]));
      assert.equal(product?.stock, 1, 'checkout reserves but does not deduct physical stock');
      assert.equal(reservations.length, 1);
      assert.equal(reservations[0]?.quantity, 1);
      assert.equal(customerOrders.length, 1);
      assert.equal(remainingCarts.length, 1, 'the losing customer retains their cart');
      scope.orderIds.push(...customerOrders.map((order) => order.id));
    });
  });

  it('persists contact inquiries in PostgreSQL and exposes them only through the owner inbox', async () => {
    await withFixture(async (scope) => {
      const email = `contact-${randomUUID()}@example.invalid`;
      scope.contactEmails.push(email);
      const inquiry = {
        name: 'Integration Customer', email, phone: '', inquiryType: 'Technical Advice',
        model: 'Test crawler', message: 'Which battery connector does this model use?',
      };
      await withServer(contactApp(), async (url) => {
        const submitted = await fetch(`${url}/api/contact-inquiries`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(inquiry),
        });
        assert.equal(submitted.status, 201);
        assert.match((await submitted.json() as { message: string }).message, /received and saved/);
        const unauthorized = await fetch(`${url}/api/admin/contact-inquiries`);
        assert.equal(unauthorized.status, 401);
        const owner = await fetch(`${url}/api/admin/contact-inquiries`, { headers: { 'X-Integration-Owner': 'owner' } });
        assert.equal(owner.status, 200);
        const result = await owner.json() as { inquiries: Array<{ email: string; message: string }> };
        assert.ok(result.inquiries.some((row) => row.email === email && row.message === inquiry.message));
      });
      const savedRows = await database.select().from(contactInquiries).where(eq(contactInquiries.email, email));
      assert.equal(savedRows.length, 1);
      assert.equal(savedRows[0]?.status, 'NEW');
    });
  });

  it('settles simultaneous Checkout verification and captured webhook once, then deduplicates the webhook event', async () => {
    await withFixture(async (scope) => {
      const paymentId = testPaymentId();
      const eventId = testEventId();
      scope.paymentIds.push(paymentId);
      scope.eventIds.push(eventId);
      const fixture = await createOrderFixture(scope);
      const payment = { id: paymentId, order_id: fixture.gatewayOrderId, amount: 12550, currency: 'INR', status: 'captured', captured: true };
      const rawWebhookBodies: Buffer[] = [];
      await withServer(paymentApp(payment, (body) => rawWebhookBodies.push(Buffer.from(body))), async (url) => {
        const responses = await Promise.all([
          verifyPayment(url, fixture.customerAuthId, fixture.orderId, fixture.gatewayOrderId, paymentId),
          sendCapturedWebhook(url, fixture.gatewayOrderId, paymentId, eventId),
        ]);
        assert.deepEqual(responses.map((response) => response.status).sort(), [200, 200]);
        assert.equal(rawWebhookBodies.length, 1, 'webhook route must receive the request before JSON parsing');
        assert.ok(Buffer.isBuffer(rawWebhookBodies[0]), 'webhook middleware must preserve exact raw request bytes');
        assert.match(rawWebhookBodies[0]!.toString('utf8'), /"event":"payment\.captured"/);
        assert.equal((await responses[1]!.json() as { result: string }).result, 'paid', 'the captured webhook must reach settlement logic');
        const retry = await sendCapturedWebhook(url, fixture.gatewayOrderId, paymentId, eventId);
        assert.equal(retry.status, 200);
        assert.equal((await retry.json() as { result: string }).result, 'duplicate');
        const verificationRetries = await Promise.all([
          verifyPayment(url, fixture.customerAuthId, fixture.orderId, fixture.gatewayOrderId, paymentId),
          verifyPayment(url, fixture.customerAuthId, fixture.orderId, fixture.gatewayOrderId, paymentId),
        ]);
        assert.deepEqual(verificationRetries.map((response) => response.status), [200, 200]);
        const duplicateWebhooks = await Promise.all([
          sendCapturedWebhook(url, fixture.gatewayOrderId, paymentId, eventId),
          sendCapturedWebhook(url, fixture.gatewayOrderId, paymentId, eventId),
        ]);
        assert.deepEqual(duplicateWebhooks.map((response) => response.status), [200, 200]);
      });
      const [order] = await database.select().from(orders).where(eq(orders.id, fixture.orderId));
      const [product] = await database.select().from(products).where(eq(products.id, fixture.productId));
      const [reservation] = await database.select().from(inventoryReservations).where(eq(inventoryReservations.orderId, fixture.orderId));
      const events = await database.select().from(razorpayWebhookEvents).where(eq(razorpayWebhookEvents.eventId, eventId));
      const cases = await database.select().from(paymentReviewCases).where(eq(paymentReviewCases.orderId, fixture.orderId));
      assert.equal(order?.paymentStatus, 'PAID');
      assert.equal(order?.razorpayPaymentId, paymentId);
      assert.equal(product?.stock, 0, 'stock is consumed exactly once');
      assert.equal(reservation?.status, 'CONSUMED');
      assert.equal(events.length, 1);
      assert.equal(cases.length, 0);
    });
  });

  it('rolls back reservation and order settlement when stock consumption fails, recording a review case', async () => {
    await withFixture(async (scope) => {
      const paymentId = testPaymentId();
      scope.paymentIds.push(paymentId);
      const fixture = await createOrderFixture(scope, { stock: 0 });
      const payment = { id: paymentId, order_id: fixture.gatewayOrderId, amount: 12550, currency: 'INR', status: 'captured', captured: true };
      await withServer(paymentApp(payment), async (url) => {
        const response = await verifyPayment(url, fixture.customerAuthId, fixture.orderId, fixture.gatewayOrderId, paymentId);
        assert.equal(response.status, 202);
      });
      const [order] = await database.select().from(orders).where(eq(orders.id, fixture.orderId));
      const [product] = await database.select().from(products).where(eq(products.id, fixture.productId));
      const [reservation] = await database.select().from(inventoryReservations).where(eq(inventoryReservations.orderId, fixture.orderId));
      const cases = await database.select().from(paymentReviewCases).where(eq(paymentReviewCases.orderId, fixture.orderId));
      assert.equal(order?.paymentStatus, 'UNPAID');
      assert.equal(product?.stock, 0);
      assert.equal(reservation?.status, 'ACTIVE', 'savepoint rollback preserves reservation state');
      assert.equal(cases.length, 1);
      assert.equal(cases[0]?.razorpayPaymentId, paymentId);
    });
  });

  it('rejects captured payments after reservation expiry and leaves the order unpaid for review', async () => {
    await withFixture(async (scope) => {
      const paymentId = testPaymentId();
      scope.paymentIds.push(paymentId);
      const fixture = await createOrderFixture(scope, { expiresAt: new Date(Date.now() - 60_000) });
      const payment = { id: paymentId, order_id: fixture.gatewayOrderId, amount: 12550, currency: 'INR', status: 'captured', captured: true };
      await withServer(paymentApp(payment), async (url) => {
        const response = await verifyPayment(url, fixture.customerAuthId, fixture.orderId, fixture.gatewayOrderId, paymentId);
        assert.equal(response.status, 202);
      });
      const [order] = await database.select().from(orders).where(eq(orders.id, fixture.orderId));
      const [reservation] = await database.select().from(inventoryReservations).where(eq(inventoryReservations.orderId, fixture.orderId));
      const [product] = await database.select().from(products).where(eq(products.id, fixture.productId));
      const cases = await database.select().from(paymentReviewCases).where(eq(paymentReviewCases.orderId, fixture.orderId));
      assert.equal(order?.paymentStatus, 'UNPAID');
      assert.equal(reservation?.status, 'ACTIVE', 'expired rows remain time-expired and excluded from stock; this flow does not silently consume them');
      assert.equal(product?.stock, 1);
      assert.equal(cases.length, 1);
    });
  });
});
