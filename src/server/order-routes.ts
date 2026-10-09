import 'dotenv/config';
import { createHash } from 'node:crypto';
import { Router, type Request, type RequestHandler, type Response } from 'express';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import type { db } from '../db/index.ts';
import { cartItems, inventoryReservations, orderItems, orders, products } from '../db/schema.ts';
import { isProductCartable } from './cart-routes.ts';
import { requireAuth, requireOwner, type AuthenticatedRequest } from './auth.ts';
import { activeReservationTotals, availableAvailabilitySql, availableStockSql, expireInventoryReservations, releaseOrderReservations, remainingStock, reservationExpirySql } from './inventory.ts';

type Database = typeof db;
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

export const shippingAddressSchema = z.object({
  fullName: z.string().trim().min(2).max(100),
  phone: z.string().trim().regex(/^\+?[0-9][0-9\s()-]{6,18}$/, 'Enter a valid contact phone number.'),
  addressLine1: z.string().trim().min(3).max(200),
  addressLine2: z.string().trim().max(200).optional().default(''),
  city: z.string().trim().min(2).max(100),
  state: z.string().trim().min(2).max(100),
  postalCode: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9\s-]{1,14}$/, 'Enter a valid postal code.'),
  country: z.literal('India').default('India'),
}).strict();

export const checkoutSchema = z.object({
  items: z.array(z.object({ productId: z.number().int().positive(), quantity: z.number().int().positive().max(100_000) }).strict()).min(1).max(100),
  shippingAddress: shippingAddressSchema,
}).strict().refine(({ items }) => new Set(items.map((item) => item.productId)).size === items.length, {
  path: ['items'], message: 'A product may appear only once in checkout.',
});

export const orderIdempotencyKeySchema = z.string().uuid();
export type ShippingAddress = z.infer<typeof shippingAddressSchema>;
export type CheckoutInput = z.infer<typeof checkoutSchema>;

export class OrderRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'OrderRequestError';
  }
}

export function checkoutPayloadHash(input: CheckoutInput) {
  const canonical = {
    items: [...input.items].sort((a, b) => a.productId - b.productId),
    shippingAddress: input.shippingAddress,
  };
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

export function moneyToPaise(value: string | number | null | undefined): number {
  const normalized = String(value ?? '');
  if (!/^\d{1,8}(?:\.\d{1,2})?$/.test(normalized)) throw new OrderRequestError('A product has an invalid INR price.', 409);
  const [rupees, fraction = ''] = normalized.split('.');
  const paise = Number(rupees) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(paise)) throw new OrderRequestError('Order amount exceeds the supported limit.', 409);
  return paise;
}

export function formatPaise(value: number) {
  return `${Math.floor(value / 100)}.${String(value % 100).padStart(2, '0')}`;
}

export function configuredShippingPaise(env: Record<string, string | undefined> = process.env) {
  const configured = env.SHIPPING_FLAT_RATE_INR?.trim();
  if (!configured) return 0;
  return moneyToPaise(configured);
}

export type FulfillmentStatus = 'UNFULFILLED' | 'PROCESSING' | 'SHIPPED' | 'DELIVERED' | 'CANCELLED';
export const fulfillmentStatuses: FulfillmentStatus[] = ['UNFULFILLED', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED'];

export function canTransitionFulfillment(current: string | null, paymentStatus: string | null, next: FulfillmentStatus) {
  if (next === 'CANCELLED') return current === 'UNFULFILLED' || current === 'PROCESSING';
  if (paymentStatus !== 'PAID') return false;
  const allowed: Record<string, FulfillmentStatus[]> = {
    UNFULFILLED: ['PROCESSING'],
    PROCESSING: ['SHIPPED'],
    SHIPPED: ['DELIVERED'],
  };
  return (allowed[current || ''] || []).includes(next);
}

function customerId(req: Request) {
  const id = (req as AuthenticatedRequest).authUser?.id;
  return id && z.string().uuid().safeParse(id).success ? id : null;
}

function requestKey(req: Request) {
  const header = req.header('Idempotency-Key');
  const parsed = orderIdempotencyKeySchema.safeParse(header);
  return parsed.success ? parsed.data : null;
}

function sendValidationError(res: Response, error: z.ZodError) {
  res.status(400).json({ error: 'Checkout details are invalid.', details: error.issues.map((issue) => ({ field: issue.path.join('.'), message: issue.message })) });
}

function bundleOrder(order: typeof orders.$inferSelect, items: Array<typeof orderItems.$inferSelect>) {
  return { ...order, items };
}

async function orderItemsFor(transaction: Transaction, orderId: number) {
  return transaction.select().from(orderItems).where(eq(orderItems.orderId, orderId)).orderBy(asc(orderItems.id));
}

async function readOrders(database: Database, filter?: ReturnType<typeof eq>) {
  const query = database.select().from(orders).$dynamic();
  const rows = await (filter ? query.where(filter) : query).orderBy(desc(orders.createdAt));
  if (!rows.length) return [];
  const items = await database.select().from(orderItems).where(inArray(orderItems.orderId, rows.map((row) => row.id))).orderBy(asc(orderItems.id));
  const grouped = new Map<number, typeof items>();
  for (const item of items) {
    if (item.orderId === null) continue;
    grouped.set(item.orderId, [...(grouped.get(item.orderId) || []), item]);
  }
  return rows.map((row) => bundleOrder(row, grouped.get(row.id) || []));
}

async function createCheckoutOrder(
  transaction: Transaction,
  authId: string,
  email: string | null,
  idempotencyKey: string,
  payloadHash: string,
  input: CheckoutInput,
  shippingPaise: number,
) {
  // Claim the scoped key first. A concurrent retry waits on the unique index and
  // either sees this committed order or proceeds after its transaction rolls back.
  const [claimed] = await transaction.insert(orders).values({
    customerAuthId: authId,
    customerEmail: email,
    idempotencyKey,
    requestHash: payloadHash,
    subtotal: '0.00',
    shippingAmount: '0.00',
    currency: 'INR',
    total: '0.00',
    status: 'PENDING',
    paymentStatus: 'UNPAID',
    fulfillmentStatus: 'UNFULFILLED',
    shippingAddress: input.shippingAddress,
  }).onConflictDoNothing({ target: [orders.customerAuthId, orders.idempotencyKey] }).returning({ id: orders.id });

  if (!claimed) {
    const [existing] = await transaction.select().from(orders)
      .where(and(eq(orders.customerAuthId, authId), eq(orders.idempotencyKey, idempotencyKey))).for('update');
    if (!existing) throw new OrderRequestError('This checkout request is being processed. Retry with the same request key.', 409);
    if (existing.requestHash !== payloadHash) throw new OrderRequestError('This checkout key was already used for different checkout details.', 409);
    return { order: bundleOrder(existing, await orderItemsFor(transaction, existing.id)), replayed: true };
  }

  const cart = await transaction.select({ productId: cartItems.productId, quantity: cartItems.quantity })
    .from(cartItems).where(eq(cartItems.userId, authId)).orderBy(asc(cartItems.productId)).for('update');
  const submitted = [...input.items].sort((a, b) => a.productId - b.productId);
  if (cart.length !== submitted.length || cart.some((row, index) => row.productId !== submitted[index]?.productId || row.quantity !== submitted[index]?.quantity)) {
    throw new OrderRequestError('Your saved cart changed. Refresh checkout and try again.', 409);
  }

  const productIds = submitted.map((item) => item.productId);
  const currentProducts = await transaction.select({
    id: products.id,
    name: products.name,
    slug: products.slug,
    price: products.price,
    currency: products.currency,
    stock: products.stock,
    availability: products.availability,
    isPublished: products.isPublished,
  }).from(products).where(inArray(products.id, productIds)).orderBy(asc(products.id)).for('update');
  if (currentProducts.length !== submitted.length) throw new OrderRequestError('A checkout product is no longer available.', 409);
  // This is a separate READ COMMITTED statement after row locks are acquired:
  // concurrent checkouts for the same product see the preceding committed reservation.
  const reservedTotals = await activeReservationTotals(transaction, productIds);

  let subtotalPaise = 0;
  const lineItems = submitted.map((entry) => {
    const product = currentProducts.find((candidate) => candidate.id === entry.productId);
    const availableStock = product ? remainingStock(product.stock, reservedTotals.get(product.id) ?? 0) : 0;
    if (!product || !isProductCartable({ ...product, stock: availableStock }, entry.quantity)) {
      throw new OrderRequestError('A product is unpublished, unavailable, or has insufficient stock. Refresh your cart.', 409);
    }
    if (product.currency !== 'INR') throw new OrderRequestError('Checkout currently supports products with an explicitly configured INR currency only.', 409);
    const unitPaise = moneyToPaise(product.price);
    subtotalPaise += unitPaise * entry.quantity;
    if (!Number.isSafeInteger(subtotalPaise)) throw new OrderRequestError('Order amount exceeds the supported limit.', 409);
    return { productId: product.id, productName: product.name, productSlug: product.slug, quantity: entry.quantity, price: formatPaise(unitPaise) };
  });
  const totalPaise = subtotalPaise + shippingPaise;
  if (!Number.isSafeInteger(totalPaise) || totalPaise > 9_999_999_999) throw new OrderRequestError('Order amount exceeds the supported limit.', 409);

  const [order] = await transaction.update(orders).set({
    subtotal: formatPaise(subtotalPaise),
    shippingAmount: formatPaise(shippingPaise),
    total: formatPaise(totalPaise),
    updatedAt: new Date(),
  }).where(eq(orders.id, claimed.id)).returning();
  const insertedItems = await transaction.insert(orderItems).values(lineItems.map((line) => ({ orderId: order.id, ...line }))).returning();
  const expiresAt = reservationExpirySql();
  await transaction.insert(inventoryReservations).values(lineItems.map((line) => ({
    orderId: order.id,
    productId: line.productId,
    quantity: line.quantity,
    status: 'ACTIVE',
    expiresAt,
    updatedAt: new Date(),
  })));
  // Only the exact cart snapshot checked above is consumed, inside the same transaction.
  await transaction.delete(cartItems).where(eq(cartItems.userId, authId));
  return { order: bundleOrder(order, insertedItems), replayed: false };
}

export function createOrderRouter(database: Database, authenticate: RequestHandler = requireAuth) {
  const router = Router();
  router.use(authenticate);

  router.get('/checkout-preview', async (req, res) => {
    const userId = customerId(req);
    if (!userId) { res.status(401).json({ error: 'A valid customer identity is required.' }); return; }
    try {
      const items = await database.select({
        productId: cartItems.productId, quantity: cartItems.quantity, slug: products.slug, name: products.name,
        price: products.price, currency: products.currency, thumbnail: products.thumbnail, stock: availableStockSql(),
        availability: availableAvailabilitySql(), isPublished: products.isPublished,
      }).from(cartItems).innerJoin(products, eq(cartItems.productId, products.id))
        .where(eq(cartItems.userId, userId)).orderBy(asc(products.name));
      const subtotalPaise = items.reduce((total, item) => total + moneyToPaise(item.price) * item.quantity, 0);
      const shippingPaise = configuredShippingPaise();
      res.json({ items, subtotal: formatPaise(subtotalPaise), shipping: formatPaise(shippingPaise), total: formatPaise(subtotalPaise + shippingPaise), currency: 'INR' });
    } catch (error) {
      if (error instanceof OrderRequestError) { res.status(error.status).json({ error: error.message }); return; }
      res.status(500).json({ error: 'Checkout preview is temporarily unavailable.' });
    }
  });

  router.get('/mine', async (req, res) => {
    const userId = customerId(req);
    if (!userId) { res.status(401).json({ error: 'A valid customer identity is required.' }); return; }
    try { res.json({ orders: await readOrders(database, eq(orders.customerAuthId, userId)) }); }
    catch { res.status(500).json({ error: 'Order history is temporarily unavailable.' }); }
  });

  router.post('/', async (req, res) => {
    const userId = customerId(req);
    if (!userId) { res.status(401).json({ error: 'A valid customer identity is required.' }); return; }
    const key = requestKey(req);
    if (!key) { res.status(400).json({ error: 'A valid UUID Idempotency-Key header is required.' }); return; }
    const parsed = checkoutSchema.safeParse(req.body);
    if (!parsed.success) { sendValidationError(res, parsed.error); return; }
    let shippingPaise: number;
    try { shippingPaise = configuredShippingPaise(); }
    catch { res.status(500).json({ error: 'Checkout shipping configuration is invalid.' }); return; }
    const authEmail = (req as AuthenticatedRequest).authUser?.email || null;
    try {
      const result = await database.transaction((transaction) => createCheckoutOrder(
        transaction, userId, authEmail, key, checkoutPayloadHash(parsed.data), parsed.data, shippingPaise,
      ));
      res.status(result.replayed ? 200 : 201).json(result);
    } catch (error) {
      if (error instanceof OrderRequestError) { res.status(error.status).json({ error: error.message }); return; }
      res.status(500).json({ error: 'Order could not be created. Retry with the same idempotency key.' });
    }
  });
  return router;
}

export function createAdminOrderRouter(database: Database, authenticate: RequestHandler = requireAuth, authorizeOwner: RequestHandler = requireOwner) {
  const router = Router();
  router.use(authenticate, authorizeOwner);
  router.get('/', async (_req, res) => {
    try { res.json({ orders: await readOrders(database) }); }
    catch { res.status(500).json({ error: 'Order management is temporarily unavailable.' }); }
  });

  // Safe owner-triggered cleanup; production deployments may invoke this from a
  // scheduler. Expired reservations are excluded from stock immediately by time.
  router.post('/reservations/expire', async (_req, res) => {
    try {
      const expired = await database.transaction((transaction) => expireInventoryReservations(transaction));
      res.json({ expired });
    } catch {
      res.status(500).json({ error: 'Expired inventory reservations could not be released.' });
    }
  });

  router.patch('/:id/fulfillment', async (req, res) => {
    const orderId = /^\d+$/.test(req.params.id) ? Number(req.params.id) : 0;
    const parsed = z.object({ status: z.enum(['PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED']) }).strict().safeParse(req.body);
    if (!Number.isSafeInteger(orderId) || orderId < 1) { res.status(400).json({ error: 'Order ID must be a positive integer.' }); return; }
    if (!parsed.success) { sendValidationError(res, parsed.error); return; }
    try {
      const result = await database.transaction(async (transaction) => {
        const [order] = await transaction.select().from(orders).where(eq(orders.id, orderId)).for('update');
        if (!order) throw new OrderRequestError('Order not found.', 404);
        if (order.fulfillmentStatus === 'CANCELLED' && parsed.data.status === 'CANCELLED') {
          // Releasing only ACTIVE rows makes repeat cancellation safe.
          await releaseOrderReservations(transaction, orderId);
          return { order, items: await orderItemsFor(transaction, orderId) };
        }
        if (!canTransitionFulfillment(order.fulfillmentStatus, order.paymentStatus, parsed.data.status)) {
          throw new OrderRequestError('That fulfillment status transition is not allowed for this payment state.', 409);
        }
        const [updated] = await transaction.update(orders).set({ fulfillmentStatus: parsed.data.status, updatedAt: new Date() })
          .where(and(eq(orders.id, orderId), eq(orders.fulfillmentStatus, order.fulfillmentStatus || 'UNFULFILLED'), eq(orders.paymentStatus, order.paymentStatus || 'UNPAID'))).returning();
        if (!updated) throw new OrderRequestError('The order changed while this update was being saved. Refresh and try again.', 409);
        if (parsed.data.status === 'CANCELLED') await releaseOrderReservations(transaction, orderId);
        return { order: updated, items: await orderItemsFor(transaction, orderId) };
      });
      res.json({ order: bundleOrder(result.order, result.items) });
    } catch (error) {
      if (error instanceof OrderRequestError) { res.status(error.status).json({ error: error.message }); return; }
      res.status(500).json({ error: 'Order status could not be updated.' });
    }
  });
  return router;
}
