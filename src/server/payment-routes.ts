import { Router, type Request, type RequestHandler } from 'express';
import { and, eq, gt, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { db } from '../db/index.ts';
import { inventoryReservations, orderItems, orders, paymentReviewCases, razorpayWebhookEvents } from '../db/schema.ts';
import { consumeOrderReservations } from './inventory.ts';
import { type AuthenticatedRequest, requireAuth, requireOwner } from './auth.ts';
import { moneyToPaise } from './order-routes.ts';
import { getRazorpayTestConfig, verifyPaymentSignature, verifyWebhookSignature } from './razorpay.ts';

type Database = typeof db;
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

type GatewayPayment = {
  id: string;
  order_id: string | null;
  amount: number;
  currency: string;
  status: string;
  captured: boolean;
};

export type PaymentRouteDependencies = {
  env?: Record<string, string | undefined>;
  createGatewayOrder?: (input: { amount: number; currency: 'INR'; receipt: string }) => Promise<{ id: string; amount: number; currency: string; status: string }>;
  fetchGatewayPayment?: (paymentId: string) => Promise<GatewayPayment>;
  consumeReservations?: (transaction: Transaction, orderId: number) => Promise<number>;
};

export class PaymentGatewayError extends Error {
  constructor(readonly statusCode: number) { super('Razorpay request failed.'); }
}

async function razorpayRequest<T>(path: string, config: { keyId: string; keySecret: string }, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`https://api.razorpay.com/v1${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${config.keyId}:${config.keySecret}`).toString('base64')}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(12_000),
    });
  } catch {
    throw new PaymentGatewayError(0);
  }
  if (!response.ok) throw new PaymentGatewayError(response.status);
  try { return await response.json() as T; }
  catch { throw new PaymentGatewayError(0); }
}

export function createRazorpayGateway(env: Record<string, string | undefined> = process.env) {
  const config = getRazorpayTestConfig(env);
  if (!config) return null;
  return {
    config,
    createOrder(input: { amount: number; currency: 'INR'; receipt: string }) {
      return razorpayRequest<{ id: string; amount: number; currency: string; status: string }>('/orders', config, {
        ...input,
        partial_payment: false,
      });
    },
    fetchPayment(paymentId: string) {
      return razorpayRequest<GatewayPayment>(`/payments/${encodeURIComponent(paymentId)}`, config);
    },
  };
}

function parseInternalOrderId(value: string) {
  if (!/^\d{1,10}$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

const verifyPaymentSchema = z.object({
  razorpay_order_id: z.string().min(1).max(80),
  razorpay_payment_id: z.string().min(1).max(80),
  razorpay_signature: z.string().regex(/^[a-f0-9]{64}$/i),
}).strict();

function responseError(res: import('express').Response, status: number, message: string) {
  res.status(status).json({ error: message });
}

async function assertOrderReservations(transaction: Transaction, orderId: number) {
  const rows = await transaction.select({
    id: inventoryReservations.id,
    productId: inventoryReservations.productId,
    quantity: inventoryReservations.quantity,
    status: inventoryReservations.status,
  }).from(inventoryReservations)
    .where(eq(inventoryReservations.orderId, orderId))
    .orderBy(inventoryReservations.productId)
    .for('update');
  if (!rows.length || rows.some((row) => row.status !== 'ACTIVE')) return false;
  const activeIds = await transaction.select({ id: inventoryReservations.id })
    .from(inventoryReservations)
    .where(and(
      eq(inventoryReservations.orderId, orderId),
      eq(inventoryReservations.status, 'ACTIVE'),
      gt(inventoryReservations.expiresAt, sql`clock_timestamp()`),
    ));
  if (activeIds.length !== rows.length) return false;
  const items = await transaction.select({ productId: orderItems.productId, quantity: orderItems.quantity })
    .from(orderItems).where(eq(orderItems.orderId, orderId)).orderBy(orderItems.productId);
  return items.length === rows.length && rows.every((row, index) =>
    row.productId === items[index]?.productId && row.quantity === items[index]?.quantity);
}

export function capturedPaymentMatches(payment: GatewayPayment, expected: { paymentId?: string; gatewayOrderId: string; amount: number }) {
  return (!expected.paymentId || payment.id === expected.paymentId)
    && payment.order_id === expected.gatewayOrderId
    && payment.amount === expected.amount
    && payment.currency === 'INR'
    && payment.status === 'captured'
    && payment.captured === true;
}

async function addPaymentReviewCase(
  transaction: Transaction,
  order: typeof orders.$inferSelect,
  payment: GatewayPayment,
  reason: string,
) {
  await transaction.insert(paymentReviewCases).values({
    orderId: order.id,
    razorpayPaymentId: payment.id,
    razorpayOrderId: payment.order_id || order.razorpayOrderId || 'unknown',
    amountPaise: payment.amount,
    currency: payment.currency,
    reason,
  }).onConflictDoNothing({ target: paymentReviewCases.razorpayPaymentId });
}

async function settleCapturedPayment(
  transaction: Transaction,
  orderId: number,
  payment: GatewayPayment,
  source: 'checkout' | 'webhook',
  consumeReservations: (transaction: Transaction, orderId: number) => Promise<number> = consumeOrderReservations,
) {
  const [order] = await transaction.select().from(orders).where(eq(orders.id, orderId)).for('update');
  if (!order) return { status: 'ignored' as const };
  const expectedAmount = moneyToPaise(order.total);
  if (!order.razorpayOrderId || !capturedPaymentMatches(payment, {
    gatewayOrderId: order.razorpayOrderId,
    amount: expectedAmount,
  })) {
    await addPaymentReviewCase(transaction, order, payment, 'Captured payment did not match the stored Razorpay order, amount, currency, or captured state.');
    return { status: 'review_required' as const };
  }
  if (order.paymentStatus === 'PAID') {
    if (order.razorpayPaymentId === payment.id) return { status: 'paid' as const, replayed: true };
    await addPaymentReviewCase(transaction, order, payment, 'A second captured payment was received for an order already marked paid.');
    return { status: 'review_required' as const };
  }
  if (order.paymentStatus !== 'UNPAID' || order.status !== 'PENDING' || order.fulfillmentStatus === 'CANCELLED') {
    await addPaymentReviewCase(transaction, order, payment, 'Payment was captured after the internal order became ineligible for payment. Manual refund/reconciliation review is required.');
    return { status: 'review_required' as const };
  }

  try {
    // A savepoint allows a late/invalid reservation failure to be recorded for
    // owner review without committing partial reservation or stock updates.
    await transaction.transaction((savepoint) => consumeReservations(savepoint, order.id));
  } catch {
    await addPaymentReviewCase(transaction, order, payment, 'Payment was captured but its inventory reservation could not be consumed. Manual refund/reconciliation review is required.');
    return { status: 'review_required' as const };
  }

  const [updated] = await transaction.update(orders).set({
    status: 'PAID',
    paymentStatus: 'PAID',
    razorpayPaymentId: payment.id,
    updatedAt: new Date(),
  }).where(and(eq(orders.id, order.id), eq(orders.paymentStatus, 'UNPAID'))).returning({ id: orders.id });
  if (!updated) throw new Error(`Payment state changed during ${source} confirmation.`);
  return { status: 'paid' as const, replayed: false };
}

export function createPaymentRouter(
  database: Database,
  authenticate: RequestHandler = requireAuth,
  dependencies: PaymentRouteDependencies = {},
) {
  const router = Router();
  router.use(authenticate);

  router.post('/:id/razorpay-order', async (req, res) => {
    const userId = (req as AuthenticatedRequest).authUser?.id;
    if (!userId) { responseError(res, 401, 'A valid customer identity is required.'); return; }
    const orderId = parseInternalOrderId(req.params.id);
    if (!orderId) { responseError(res, 400, 'Order ID must be a positive integer.'); return; }
    const gateway = createRazorpayGateway(dependencies.env);
    if (!gateway) { responseError(res, 503, 'Razorpay Test Mode is not configured.'); return; }

    try {
      const claim = await database.transaction(async (transaction) => {
        const [order] = await transaction.select().from(orders)
          .where(and(eq(orders.id, orderId), eq(orders.customerAuthId, userId))).for('update');
        if (!order) return { kind: 'missing' as const };
        if (order.paymentStatus !== 'UNPAID' || order.status !== 'PENDING' || order.fulfillmentStatus === 'CANCELLED') return { kind: 'ineligible' as const };
        if (order.currency !== 'INR') return { kind: 'currency' as const };
        const amount = moneyToPaise(order.total);
        if (amount < 100) return { kind: 'amount' as const };
        if (!await assertOrderReservations(transaction, order.id)) return { kind: 'reservation' as const };
        if (order.razorpayOrderId && order.razorpayOrderCreationStatus === 'CREATED') {
          return { kind: 'ready' as const, orderId: order.razorpayOrderId, amount };
        }
        if (order.razorpayOrderCreationStatus === 'CREATING') return { kind: 'creating' as const };
        await transaction.update(orders).set({ razorpayOrderCreationStatus: 'CREATING', updatedAt: new Date() })
          .where(eq(orders.id, order.id));
        return { kind: 'create' as const, amount };
      });

      if (claim.kind === 'missing') { responseError(res, 404, 'Order not found.'); return; }
      if (claim.kind === 'ineligible') { responseError(res, 409, 'This order is not eligible for payment.'); return; }
      if (claim.kind === 'currency') { responseError(res, 409, 'Only INR orders can be paid through this checkout.'); return; }
      if (claim.kind === 'amount') { responseError(res, 409, 'Order amount is below the supported payment minimum.'); return; }
      if (claim.kind === 'reservation') { responseError(res, 409, 'The order reservation is expired or inconsistent. Refresh your orders before retrying.'); return; }
      if (claim.kind === 'creating') { responseError(res, 409, 'A payment-order request is unresolved. It will not be duplicated; contact support for reconciliation.'); return; }

      if (claim.kind === 'ready') {
        res.json({ keyId: gateway.config.keyId, razorpayOrderId: claim.orderId, amount: claim.amount, currency: 'INR' });
        return;
      }

      let providerOrder: { id: string; amount: number; currency: string; status: string };
      try {
        providerOrder = await (dependencies.createGatewayOrder || gateway.createOrder.bind(gateway))({
          amount: claim.amount, currency: 'INR', receipt: `rcmega-${orderId}`,
        });
      } catch (error) {
        // A transport failure can happen after Razorpay created the order. Keep
        // CREATING so retries cannot create a second provider order blindly.
        if (error instanceof PaymentGatewayError && error.statusCode >= 400 && error.statusCode < 500) {
          await database.transaction((transaction) => transaction.update(orders)
            .set({ razorpayOrderCreationStatus: 'FAILED', updatedAt: new Date() })
            .where(and(eq(orders.id, orderId), eq(orders.razorpayOrderCreationStatus, 'CREATING'))));
        }
        responseError(res, 502, 'Razorpay could not create a Test Mode payment order. Retry only after the request state is resolved.');
        return;
      }
      if (!/^order_[A-Za-z0-9]+$/.test(providerOrder.id) || providerOrder.amount !== claim.amount || providerOrder.currency !== 'INR' || providerOrder.status !== 'created') {
        responseError(res, 502, 'Razorpay returned an unexpected Test Mode order response. Contact support before retrying.');
        return;
      }

      const stored = await database.transaction(async (transaction) => {
        const [order] = await transaction.select().from(orders).where(eq(orders.id, orderId)).for('update');
        if (!order || order.razorpayOrderCreationStatus !== 'CREATING') return false;
        await transaction.update(orders).set({
          razorpayOrderId: providerOrder.id,
          razorpayOrderCreationStatus: 'CREATED',
          updatedAt: new Date(),
        }).where(eq(orders.id, orderId));
        return order.paymentStatus === 'UNPAID' && order.status === 'PENDING' && order.fulfillmentStatus !== 'CANCELLED';
      });
      if (!stored) { responseError(res, 409, 'The payment order was created but the internal order is no longer payable. Contact support for reconciliation.'); return; }
      res.json({ keyId: gateway.config.keyId, razorpayOrderId: providerOrder.id, amount: claim.amount, currency: 'INR' });
    } catch {
      responseError(res, 500, 'Payment order could not be prepared.');
    }
  });

  router.post('/:id/verify-payment', async (req, res) => {
    const userId = (req as AuthenticatedRequest).authUser?.id;
    if (!userId) { responseError(res, 401, 'A valid customer identity is required.'); return; }
    const orderId = parseInternalOrderId(req.params.id);
    if (!orderId) { responseError(res, 400, 'Order ID must be a positive integer.'); return; }
    const parsed = verifyPaymentSchema.safeParse(req.body);
    if (!parsed.success) { responseError(res, 400, 'Payment verification details are invalid.'); return; }
    const gateway = createRazorpayGateway(dependencies.env);
    if (!gateway) { responseError(res, 503, 'Razorpay Test Mode is not configured.'); return; }

    try {
      const [order] = await database.select().from(orders)
        .where(and(eq(orders.id, orderId), eq(orders.customerAuthId, userId)));
      if (!order || !order.razorpayOrderId) { responseError(res, 404, 'Payment order not found.'); return; }
      if (parsed.data.razorpay_order_id !== order.razorpayOrderId) { responseError(res, 409, 'Payment order does not match this internal order.'); return; }
      if (!verifyPaymentSignature(order.razorpayOrderId, parsed.data.razorpay_payment_id, parsed.data.razorpay_signature, gateway.config.keySecret)) {
        responseError(res, 400, 'Payment signature could not be verified.'); return;
      }
      let payment: GatewayPayment;
      try { payment = await (dependencies.fetchGatewayPayment || gateway.fetchPayment.bind(gateway))(parsed.data.razorpay_payment_id); }
      catch { responseError(res, 502, 'Razorpay payment status could not be confirmed.'); return; }
      const expectedAmount = moneyToPaise(order.total);
      if (!capturedPaymentMatches(payment, { paymentId: parsed.data.razorpay_payment_id, gatewayOrderId: order.razorpayOrderId, amount: expectedAmount })) {
        if (payment.status === 'captured' && payment.captured) {
          await database.transaction(async (transaction) => {
            const [lockedOrder] = await transaction.select().from(orders)
              .where(and(eq(orders.id, orderId), eq(orders.customerAuthId, userId))).for('update');
            if (lockedOrder) await addPaymentReviewCase(transaction, lockedOrder, payment, 'Razorpay reported a captured payment with order or amount details that do not match this internal order.');
          });
          res.status(202).json({ paymentStatus: 'UNPAID', reviewRequired: true, message: 'Razorpay reports a captured payment that needs owner review. Do not pay again; contact store support.' });
          return;
        }
        responseError(res, 409, 'Razorpay has not confirmed a captured payment matching this order.'); return;
      }
      const result = await database.transaction((transaction) => settleCapturedPayment(
        transaction, orderId, payment, 'checkout', dependencies.consumeReservations,
      ));
      if (result.status === 'review_required') {
        res.status(202).json({ paymentStatus: 'UNPAID', reviewRequired: true, message: 'Payment was captured but needs owner review. Do not pay again; contact store support.' });
        return;
      }
      if (result.status === 'ignored') { responseError(res, 404, 'Order not found.'); return; }
      res.json({ paymentStatus: 'PAID', replayed: result.replayed });
    } catch {
      responseError(res, 500, 'Payment could not be verified. If Razorpay shows a captured payment, contact store support and do not pay again.');
    }
  });

  return router;
}

const webhookEnvelopeSchema = z.object({
  event: z.string().min(1).max(100),
  payload: z.object({
    payment: z.object({ entity: z.object({
      id: z.string().min(1).max(80),
      order_id: z.string().max(80).nullable(),
      amount: z.number().int().positive(),
      currency: z.string().length(3),
      status: z.string().min(1).max(40),
      captured: z.boolean(),
    }).passthrough() }).optional(),
  }).passthrough(),
}).passthrough();

export function createRazorpayWebhookHandler(
  database: Database,
  env: Record<string, string | undefined> = process.env,
  consumeReservations: (transaction: Transaction, orderId: number) => Promise<number> = consumeOrderReservations,
): RequestHandler {
  return async (req, res) => {
    const rawBody = Buffer.isBuffer(req.body) ? req.body : null;
    const signature = req.header('X-Razorpay-Signature') || '';
    const eventId = req.header('X-Razorpay-Event-Id') || '';
    const webhookSecret = env.RAZORPAY_WEBHOOK_SECRET;
    const testModeConfigured = env.RAZORPAY_KEY_ID?.trim().startsWith('rzp_test_') === true;
    if (!rawBody || !rawBody.length || rawBody.length > 1_048_576 || !eventId || eventId.length > 160) {
      responseError(res, 400, 'Webhook request is malformed.'); return;
    }
    if (!testModeConfigured || !webhookSecret || !verifyWebhookSignature(rawBody, signature, webhookSecret)) {
      responseError(res, 400, 'Webhook signature is invalid.'); return;
    }
    let parsedJson: unknown;
    try { parsedJson = JSON.parse(rawBody.toString('utf8')); }
    catch { responseError(res, 400, 'Webhook body is not valid JSON.'); return; }
    const parsed = webhookEnvelopeSchema.safeParse(parsedJson);
    if (!parsed.success) { responseError(res, 400, 'Webhook payload is invalid.'); return; }
    const entity = parsed.data.payload.payment?.entity;
    const gatewayOrderId = entity?.order_id || null;
    const gatewayPaymentId = entity?.id || null;

    try {
      const result = await database.transaction(async (transaction) => {
        const [inserted] = await transaction.insert(razorpayWebhookEvents).values({
          eventId,
          eventType: parsed.data.event,
          gatewayOrderId,
          gatewayPaymentId,
          processingStatus: 'RECEIVED',
        }).onConflictDoNothing({ target: razorpayWebhookEvents.eventId }).returning({ id: razorpayWebhookEvents.id });
        if (!inserted) return 'duplicate' as const;
        if (!entity || !gatewayOrderId || !gatewayPaymentId || !['payment.captured', 'payment.failed'].includes(parsed.data.event)) {
          await transaction.update(razorpayWebhookEvents).set({ processingStatus: 'IGNORED', processedAt: new Date() }).where(eq(razorpayWebhookEvents.eventId, eventId));
          return 'ignored' as const;
        }
        if (parsed.data.event === 'payment.failed' || entity.status !== 'captured' || entity.captured !== true) {
          // Failed/authorized snapshots are recorded but never downgrade a captured order.
          await transaction.update(razorpayWebhookEvents).set({ processingStatus: 'PROCESSED', processedAt: new Date() }).where(eq(razorpayWebhookEvents.eventId, eventId));
          return 'recorded' as const;
        }
        const [order] = await transaction.select().from(orders).where(eq(orders.razorpayOrderId, gatewayOrderId)).for('update');
        if (!order) {
          await transaction.insert(paymentReviewCases).values({
            orderId: null,
            razorpayPaymentId: entity.id,
            razorpayOrderId: gatewayOrderId,
            amountPaise: entity.amount,
            currency: entity.currency,
            reason: 'Captured payment references an unknown Razorpay order. Manual reconciliation is required.',
          }).onConflictDoNothing({ target: paymentReviewCases.razorpayPaymentId });
          await transaction.update(razorpayWebhookEvents).set({ processingStatus: 'REVIEW_REQUIRED', processedAt: new Date() }).where(eq(razorpayWebhookEvents.eventId, eventId));
          return 'review_required' as const;
        }
        const settled = await settleCapturedPayment(transaction, order.id, entity as GatewayPayment, 'webhook', consumeReservations);
        await transaction.update(razorpayWebhookEvents).set({
          processingStatus: settled.status === 'review_required' ? 'REVIEW_REQUIRED' : 'PROCESSED',
          processedAt: new Date(),
        }).where(eq(razorpayWebhookEvents.eventId, eventId));
        return settled.status;
      });
      res.json({ received: true, result });
    } catch {
      responseError(res, 500, 'Webhook could not be processed. Razorpay may retry this event.');
    }
  };
}

export async function readPaymentReviewCases(database: Database) {
  return database.select({
    id: paymentReviewCases.id,
    orderId: paymentReviewCases.orderId,
    customerEmail: orders.customerEmail,
    orderTotal: orders.total,
    paymentId: paymentReviewCases.razorpayPaymentId,
    razorpayOrderId: paymentReviewCases.razorpayOrderId,
    amountPaise: paymentReviewCases.amountPaise,
    currency: paymentReviewCases.currency,
    reason: paymentReviewCases.reason,
    status: paymentReviewCases.status,
    createdAt: paymentReviewCases.createdAt,
  }).from(paymentReviewCases).leftJoin(orders, eq(paymentReviewCases.orderId, orders.id))
    .where(eq(paymentReviewCases.status, 'OPEN')).orderBy(paymentReviewCases.createdAt);
}

export function createAdminPaymentReviewRouter(
  database: Database,
  authenticate: RequestHandler = requireAuth,
  authorizeOwner: RequestHandler = requireOwner,
) {
  const router = Router();
  router.use(authenticate, authorizeOwner);
  router.get('/', async (_req, res) => {
    try { res.json({ cases: await readPaymentReviewCases(database) }); }
    catch { responseError(res, 500, 'Payment review cases are temporarily unavailable.'); }
  });
  return router;
}
