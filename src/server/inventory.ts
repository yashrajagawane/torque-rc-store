import { and, eq, gt, inArray, lte, sql, type SQLWrapper } from 'drizzle-orm';
import type { db } from '../db/index.ts';
import { inventoryReservations, orderItems, orders, products } from '../db/schema.ts';

type Database = typeof db;
export type InventoryTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];

export const DEFAULT_RESERVATION_TTL_MINUTES = 20;

export function reservationExpiry(now = new Date(), ttlMinutes = DEFAULT_RESERVATION_TTL_MINUTES) {
  return new Date(now.getTime() + ttlMinutes * 60_000);
}

export function reservationExpirySql() {
  return sql<Date>`clock_timestamp() + (${DEFAULT_RESERVATION_TTL_MINUTES} * INTERVAL '1 minute')`;
}

export function remainingStock(physicalStock: number | null, reservedQuantity: number) {
  return Math.max(0, (physicalStock ?? 0) - reservedQuantity);
}

export function availableStockSql(productId: SQLWrapper = products.id, physicalStock: SQLWrapper = products.stock) {
  return sql<number>`GREATEST(COALESCE(${physicalStock}, 0) - COALESCE((
    SELECT SUM(${inventoryReservations.quantity})
    FROM ${inventoryReservations}
    WHERE ${inventoryReservations.productId} = ${productId}
      AND ${inventoryReservations.status} = 'ACTIVE'
      AND ${inventoryReservations.expiresAt} > clock_timestamp()
  ), 0), 0)::int`;
}

export function availableAvailabilitySql() {
  const available = availableStockSql();
  return sql<string>`CASE WHEN ${products.availability} = 'IN_STOCK' AND ${available} <= 0
    THEN 'OUT_OF_STOCK' ELSE ${products.availability} END`;
}

export async function activeReservationTotals(transaction: InventoryTransaction, productIds: number[], now?: Date) {
  if (!productIds.length) return new Map<number, number>();
  const rows = await transaction.select({
    productId: inventoryReservations.productId,
    quantity: sql<number>`COALESCE(SUM(${inventoryReservations.quantity}), 0)::int`,
  }).from(inventoryReservations)
    .where(and(
      inArray(inventoryReservations.productId, productIds),
      eq(inventoryReservations.status, 'ACTIVE'),
      gt(inventoryReservations.expiresAt, now ?? sql`clock_timestamp()`),
    ))
    .groupBy(inventoryReservations.productId);
  return new Map(rows.map((row) => [row.productId, Number(row.quantity)]));
}

export async function releaseOrderReservations(transaction: InventoryTransaction, orderId: number) {
  const rows = await transaction.select({ id: inventoryReservations.id })
    .from(inventoryReservations)
    .where(and(eq(inventoryReservations.orderId, orderId), eq(inventoryReservations.status, 'ACTIVE')))
    .orderBy(inventoryReservations.productId)
    .for('update');
  if (!rows.length) return [];
  // Expiration is re-evaluated by PostgreSQL after the reservation locks have
  // been acquired. Expired quantities become EXPIRED even during cancellation.
  return transaction.update(inventoryReservations).set({
    status: sql`CASE WHEN ${inventoryReservations.expiresAt} <= clock_timestamp() THEN 'EXPIRED' ELSE 'RELEASED' END`,
    updatedAt: sql`clock_timestamp()`,
  })
    .where(and(
      inArray(inventoryReservations.id, rows.map(({ id }) => id)),
      eq(inventoryReservations.status, 'ACTIVE'),
    ))
    .returning({ id: inventoryReservations.id, quantity: inventoryReservations.quantity });
}

/**
 * Expiry makes stock available by time predicate immediately; this routine also
 * records terminal state and closes unpaid orders. Call inside a transaction.
 */
export async function expireInventoryReservations(transaction: InventoryTransaction, now?: Date) {
  const cutoff = now ?? sql`clock_timestamp()`;
  const updatedAt = now ?? sql`clock_timestamp()`;
  // Match cancellation/payment lock order: order rows first, then reservation rows.
  const candidates = await transaction.select({ orderId: inventoryReservations.orderId })
    .from(inventoryReservations)
    .where(and(eq(inventoryReservations.status, 'ACTIVE'), lte(inventoryReservations.expiresAt, cutoff)));
  const orderIds = [...new Set(candidates.map(({ orderId }) => orderId))].sort((a, b) => a - b);
  if (!orderIds.length) return 0;
  await transaction.select({ id: orders.id }).from(orders).where(inArray(orders.id, orderIds))
    .orderBy(orders.id).for('update');
  // Lock candidate reservations after order locks, then re-evaluate expiry in
  // the UPDATE using wall-clock time so lock waits cannot freeze the decision.
  await transaction.select({ id: inventoryReservations.id })
    .from(inventoryReservations)
    .where(and(inArray(inventoryReservations.orderId, orderIds), eq(inventoryReservations.status, 'ACTIVE')))
    .orderBy(inventoryReservations.orderId, inventoryReservations.productId)
    .for('update');
  const expired = await transaction.update(inventoryReservations).set({ status: 'EXPIRED', updatedAt })
    .where(and(eq(inventoryReservations.status, 'ACTIVE'), lte(inventoryReservations.expiresAt, cutoff)))
    .returning({ orderId: inventoryReservations.orderId });
  const expiredOrderIds = [...new Set(expired.map(({ orderId }) => orderId))];
  if (expiredOrderIds.length) {
    await transaction.update(orders).set({ fulfillmentStatus: 'CANCELLED', updatedAt })
      .where(and(inArray(orders.id, expiredOrderIds), eq(orders.paymentStatus, 'UNPAID'), eq(orders.fulfillmentStatus, 'UNFULFILLED')));
  }
  return expired.length;
}

/**
 * Payment confirmation code must call this in the same transaction that records
 * verified payment. It converts reservations into physical stock deductions and
 * is safe to retry: only ACTIVE, unexpired rows can be consumed.
 * The caller must record PAID only after this succeeds in that same transaction.
 */
export async function consumeOrderReservations(transaction: InventoryTransaction, orderId: number, now?: Date) {
  const cutoff = now ?? sql`clock_timestamp()`;
  const updatedAt = now ?? sql`clock_timestamp()`;
  const [order] = await transaction.select({
    id: orders.id,
    paymentStatus: orders.paymentStatus,
    fulfillmentStatus: orders.fulfillmentStatus,
  }).from(orders).where(eq(orders.id, orderId)).for('update');
  if (!order || order.paymentStatus !== 'UNPAID' || order.fulfillmentStatus === 'CANCELLED') {
    throw new Error('Only an unpaid, uncancelled order can consume inventory reservations.');
  }
  const rows = await transaction.select({
    id: inventoryReservations.id,
    productId: inventoryReservations.productId,
    quantity: inventoryReservations.quantity,
    status: inventoryReservations.status,
    expiresAt: inventoryReservations.expiresAt,
  }).from(inventoryReservations)
    .where(eq(inventoryReservations.orderId, orderId))
    .orderBy(inventoryReservations.productId)
    .for('update');
  if (!rows.length || rows.some((row) => row.status !== 'ACTIVE' || (now && new Date(row.expiresAt) <= now))) {
    throw new Error('The complete order reservation is not active and cannot be consumed.');
  }
  const purchasedItems = await transaction.select({ productId: orderItems.productId, quantity: orderItems.quantity })
    .from(orderItems).where(eq(orderItems.orderId, orderId)).orderBy(orderItems.productId);
  if (purchasedItems.length !== rows.length || purchasedItems.some((item, index) =>
    item.productId !== rows[index]?.productId || item.quantity !== rows[index]?.quantity)) {
    throw new Error('The order reservation does not match its purchased items.');
  }

  const productIds = [...new Set(rows.map(({ productId }) => productId))].sort((a, b) => a - b);
  const lockedProducts = await transaction.select({ id: products.id, stock: products.stock })
    .from(products).where(inArray(products.id, productIds)).orderBy(products.id).for('update');
  if (lockedProducts.length !== productIds.length) throw new Error('Reserved product inventory could not be locked.');

  // This conditional state transition is the final expiry check. It runs only
  // after order, reservation and product locks have been obtained.
  const consumed = await transaction.update(inventoryReservations).set({ status: 'CONSUMED', updatedAt })
    .where(and(
      inArray(inventoryReservations.id, rows.map(({ id }) => id)),
      eq(inventoryReservations.status, 'ACTIVE'),
      gt(inventoryReservations.expiresAt, cutoff),
    ))
    .returning({ id: inventoryReservations.id });
  if (consumed.length !== rows.length) throw new Error('The complete order reservation expired before it could be consumed.');

  for (const row of rows) {
    const [updated] = await transaction.update(products)
      .set({ stock: sql`${products.stock} - ${row.quantity}`, updatedAt })
      .where(and(eq(products.id, row.productId), sql`${products.stock} >= ${row.quantity}`))
      .returning({ id: products.id });
    if (!updated) throw new Error('Reserved inventory could not be consumed safely.');
  }
  return rows.length;
}
