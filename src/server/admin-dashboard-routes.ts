import express from 'express';
import { and, count, eq, gte, lte, sql, sum } from 'drizzle-orm';
import type { db } from '../db/index.ts';
import { contactInquiries, inventoryReservations, orders, paymentReviewCases, products } from '../db/schema.ts';
import { requireAuth, requireOwner } from './auth.ts';

type Database = typeof db;

function indiaDayStart() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: 'numeric', day: 'numeric',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return new Date(Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day), 0, 0, 0) - (5.5 * 60 * 60 * 1000));
}

export function createAdminDashboardRouter(database: Database) {
  const router = express.Router();
  router.use(requireAuth, requireOwner);

  router.get('/summary', async (_req, res) => {
    try {
      const dayStart = indiaDayStart();
      const [todayOrders, todayRevenue, pendingPayments, awaitingShipment, lowStock, drafts, inquiries, reviewCases] = await Promise.all([
        database.select({ value: count() }).from(orders).where(gte(orders.createdAt, dayStart)),
        database.select({ value: sum(orders.total) }).from(orders).where(and(gte(orders.createdAt, dayStart), eq(orders.paymentStatus, 'PAID'))),
        database.select({ value: count() }).from(orders).where(and(eq(orders.paymentStatus, 'UNPAID'), sql`${orders.fulfillmentStatus} <> 'CANCELLED'`)),
        database.select({ value: count() }).from(orders).where(and(eq(orders.paymentStatus, 'PAID'), eq(orders.fulfillmentStatus, 'UNFULFILLED'))),
        database.select({ value: count() }).from(products).where(and(eq(products.isPublished, true), eq(products.isArchived, false), sql`${products.stock} <= ${products.lowStockThreshold}`)),
        database.select({ value: count() }).from(products).where(and(eq(products.isPublished, false), eq(products.isArchived, false))),
        database.select({ value: count() }).from(contactInquiries).where(eq(contactInquiries.status, 'NEW')),
        database.select({ value: count() }).from(paymentReviewCases).where(eq(paymentReviewCases.status, 'OPEN')),
      ]);

      res.json({
        todayOrders: Number(todayOrders[0]?.value ?? 0),
        todayRevenue: String(todayRevenue[0]?.value ?? '0.00'),
        pendingPayments: Number(pendingPayments[0]?.value ?? 0),
        awaitingShipment: Number(awaitingShipment[0]?.value ?? 0),
        lowStockProducts: Number(lowStock[0]?.value ?? 0),
        draftProducts: Number(drafts[0]?.value ?? 0),
        newInquiries: Number(inquiries[0]?.value ?? 0),
        paymentReviewCases: Number(reviewCases[0]?.value ?? 0),
        lowStockThreshold: 5,
        timezone: 'Asia/Kolkata',
      });
    } catch {
      console.error('Admin dashboard summary query failed.');
      res.status(503).json({ error: 'The owner dashboard is temporarily unavailable.' });
    }
  });

  router.get('/inventory', async (_req, res) => {
    try {
      const rows = await database.select({
        product: products,
        reserved: sql<number>`COALESCE(SUM(CASE WHEN ${inventoryReservations.status} = 'ACTIVE' AND ${inventoryReservations.expiresAt} > clock_timestamp() THEN ${inventoryReservations.quantity} ELSE 0 END), 0)::int`,
      }).from(products)
        .leftJoin(inventoryReservations, eq(inventoryReservations.productId, products.id))
        .groupBy(products.id)
        .orderBy(products.stock);
      res.json({
        products: rows.map(({ product, reserved }) => ({
          ...product,
          reservedStock: Number(reserved ?? 0),
          availableStock: Math.max(0, Number(product.stock ?? 0) - Number(reserved ?? 0)),
          lowStock: Number(product.stock ?? 0) <= Number(product.lowStockThreshold ?? 5),
        })),
        lowStockThreshold: 5,
      });
    } catch {
      console.error('Admin inventory query failed.');
      res.status(503).json({ error: 'Inventory is temporarily unavailable.' });
    }
  });

  return router;
}
