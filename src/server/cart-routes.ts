import 'dotenv/config';
import { createHash } from 'node:crypto';
import { Router, type Request, type RequestHandler, type Response } from 'express';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { db } from '../db/index.ts';
import { brands, cartItems, cartMergeOperations, products } from '../db/schema.ts';
import { requireAuth, type AuthenticatedRequest } from './auth.ts';
import { activeReservationTotals, availableAvailabilitySql, availableStockSql, remainingStock } from './inventory.ts';

type Database = typeof db;
export const productQuantitySchema = z.object({
  productId: z.number().int().positive(),
  quantity: z.number().int().positive().max(1_000_000),
}).strict();
export const cartReplacementSchema = z.object({ items: z.array(productQuantitySchema).max(100) }).strict()
  .refine(({ items }) => new Set(items.map((item) => item.productId)).size === items.length, {
    path: ['items'], message: 'A product may appear only once in the cart.',
  });
export const mergeRequestKeySchema = z.string().uuid();

export function cartOwnerId(req: Request): string | null {
  const user = (req as AuthenticatedRequest).authUser;
  return user && z.string().uuid().safeParse(user.id).success ? user.id : null;
}

function sendInvalid(res: Response, error: z.ZodError) {
  res.status(400).json({ error: 'Cart request is invalid.', details: error.issues.map((issue) => ({
    field: issue.path.join('.'), message: issue.message,
  })) });
}

function sendServiceError(res: Response) {
  res.status(500).json({ error: 'Cart could not be updated. Please try again.' });
}

export function isProductCartable(product: { isPublished: boolean; availability: string | null; stock: number | null }, quantity: number) {
  return product.isPublished && product.availability === 'IN_STOCK' &&
    Number.isInteger(product.stock) && (product.stock ?? 0) > 0 && (product.stock ?? 0) >= quantity;
}

export function mergeCartQuantity(existing: number, guest: number, stock: number) {
  return Math.min(stock, existing + guest);
}

export function unmergedGuestQuantity(existing: number, guest: number, stock: number) {
  const merged = mergeCartQuantity(existing, guest, stock);
  return Math.max(0, guest - Math.max(0, merged - existing));
}

export function hashMergePayload(items: Array<{ productId: number; quantity: number }>) {
  const canonical = [...items].sort((a, b) => a.productId - b.productId);
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

function parseProductId(value: string) {
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

async function readCart(database: Database, userId: string) {
  const rows = await database.select({
    productId: cartItems.productId,
    quantity: cartItems.quantity,
    slug: products.slug,
    name: products.name,
    price: products.price,
    currency: products.currency,
    thumbnail: products.thumbnail,
    stock: availableStockSql(),
    availability: availableAvailabilitySql(),
    isPublished: products.isPublished,
    brandName: brands.name,
  }).from(cartItems)
    .innerJoin(products, eq(cartItems.productId, products.id))
    .leftJoin(brands, eq(products.brandId, brands.id))
    .where(eq(cartItems.userId, userId))
    .orderBy(asc(products.name));
  return rows.map((row) => ({ ...row, id: row.productId }));
}

async function lockedProduct(transaction: Parameters<Parameters<Database['transaction']>[0]>[0], productId: number) {
  const [product] = await transaction.select({
    id: products.id,
    stock: products.stock,
    availability: products.availability,
    isPublished: products.isPublished,
  }).from(products).where(eq(products.id, productId)).for('update');
  if (!product) return undefined;
  const reserved = await activeReservationTotals(transaction, [productId]);
  return { ...product, stock: remainingStock(product.stock, reserved.get(productId) ?? 0) };
}

async function rejectUnavailableProduct(transaction: Parameters<Parameters<Database['transaction']>[0]>[0], productId: number, quantity: number) {
  const product = await lockedProduct(transaction, productId);
  if (!product || !isProductCartable(product, quantity)) {
    const error = new Error('Product is unpublished, unavailable, or has insufficient stock.');
    Object.assign(error, { status: 409 });
    throw error;
  }
  return product;
}

function sendCartOperationError(error: unknown, res: Response) {
  if (typeof error === 'object' && error !== null && 'status' in error) {
    const status = (error as { status?: unknown }).status;
    if (status === 409 || status === 404) {
      const message = error instanceof Error ? error.message : 'Cart item could not be updated.';
      res.status(status).json({ error: message });
      return;
    }
  }
  sendServiceError(res);
}

export function createCartRouter(database: Database, authenticate: RequestHandler = requireAuth) {
  const router = Router();
  router.use(authenticate);

  router.get('/', async (req, res) => {
    const userId = cartOwnerId(req);
    if (!userId) { res.status(401).json({ error: 'A valid customer identity is required.' }); return; }
    try { res.json({ items: await readCart(database, userId) }); }
    catch { sendServiceError(res); }
  });

  router.post('/items', async (req, res) => {
    const userId = cartOwnerId(req);
    if (!userId) { res.status(401).json({ error: 'A valid customer identity is required.' }); return; }
    const parsed = productQuantitySchema.safeParse(req.body);
    if (!parsed.success) { sendInvalid(res, parsed.error); return; }
    try {
      await database.transaction(async (transaction) => {
        const product = await rejectUnavailableProduct(transaction, parsed.data.productId, parsed.data.quantity);
        const [existing] = await transaction.select({ quantity: cartItems.quantity }).from(cartItems)
          .where(and(eq(cartItems.userId, userId), eq(cartItems.productId, product.id))).for('update');
        const quantity = (existing?.quantity ?? 0) + parsed.data.quantity;
        if (quantity > (product.stock ?? 0)) throw Object.assign(new Error('Requested quantity exceeds available stock.'), { status: 409 });
        await transaction.insert(cartItems).values({ userId, productId: product.id, quantity, updatedAt: new Date() })
          .onConflictDoUpdate({ target: [cartItems.userId, cartItems.productId], set: { quantity, updatedAt: new Date() } });
      });
      res.status(200).json({ items: await readCart(database, userId) });
    } catch (error) { sendCartOperationError(error, res); }
  });

  router.put('/items/:productId', async (req, res) => {
    const userId = cartOwnerId(req);
    if (!userId) { res.status(401).json({ error: 'A valid customer identity is required.' }); return; }
    const productId = parseProductId(req.params.productId);
    if (!productId) { res.status(400).json({ error: 'Product ID must be a positive integer.' }); return; }
    const parsed = z.object({ quantity: z.number().int().positive().max(1_000_000) }).strict().safeParse(req.body);
    if (!parsed.success) { sendInvalid(res, parsed.error); return; }
    try {
      await database.transaction(async (transaction) => {
        await rejectUnavailableProduct(transaction, productId, parsed.data.quantity);
        const [updated] = await transaction.update(cartItems).set({ quantity: parsed.data.quantity, updatedAt: new Date() })
          .where(and(eq(cartItems.userId, userId), eq(cartItems.productId, productId))).returning({ id: cartItems.id });
        if (!updated) throw Object.assign(new Error('Cart item was not found.'), { status: 404 });
      });
      res.json({ items: await readCart(database, userId) });
    } catch (error) { sendCartOperationError(error, res); }
  });

  router.delete('/items/:productId', async (req, res) => {
    const userId = cartOwnerId(req);
    if (!userId) { res.status(401).json({ error: 'A valid customer identity is required.' }); return; }
    const productId = parseProductId(req.params.productId);
    if (!productId) { res.status(400).json({ error: 'Product ID must be a positive integer.' }); return; }
    try {
      await database.delete(cartItems).where(and(eq(cartItems.userId, userId), eq(cartItems.productId, productId)));
      res.json({ items: await readCart(database, userId) });
    } catch { sendServiceError(res); }
  });

  router.delete('/', async (req, res) => {
    const userId = cartOwnerId(req);
    if (!userId) { res.status(401).json({ error: 'A valid customer identity is required.' }); return; }
    try {
      await database.delete(cartItems).where(eq(cartItems.userId, userId));
      res.json({ items: [] });
    } catch { sendServiceError(res); }
  });

  // The browser uses this after sign-in to merge its guest cart with the saved cart.
  router.post('/merge', async (req, res) => {
    const userId = cartOwnerId(req);
    if (!userId) { res.status(401).json({ error: 'A valid customer identity is required.' }); return; }
    const parsed = cartReplacementSchema.safeParse(req.body);
    if (!parsed.success) { sendInvalid(res, parsed.error); return; }
    const keyParsed = mergeRequestKeySchema.safeParse(req.header('Idempotency-Key'));
    if (!keyParsed.success) {
      res.status(400).json({ error: 'A valid UUID Idempotency-Key header is required for cart merging.' });
      return;
    }
    const requestKey = keyParsed.data;
    const payloadHash = hashMergePayload(parsed.data.items);
    const rejected: Array<{ productId: number; unmergedQuantity: number; reason: string }> = [];
    let replayed = false;
    try {
      await database.transaction(async (transaction) => {
        const [claim] = await transaction.insert(cartMergeOperations).values({
          userId,
          requestKey,
          payloadHash,
          rejected: [],
        }).onConflictDoNothing({ target: [cartMergeOperations.userId, cartMergeOperations.requestKey] })
          .returning({ id: cartMergeOperations.id });
        if (!claim) {
          const [previous] = await transaction.select({ payloadHash: cartMergeOperations.payloadHash, rejected: cartMergeOperations.rejected })
            .from(cartMergeOperations)
            .where(and(eq(cartMergeOperations.userId, userId), eq(cartMergeOperations.requestKey, requestKey)))
            .for('update');
          if (!previous) throw new Error('Unable to resolve cart merge idempotency record.');
          if (previous.payloadHash !== payloadHash) {
            const error = new Error('This Idempotency-Key was already used with a different cart payload.');
            Object.assign(error, { status: 409 });
            throw error;
          }
          rejected.push(...previous.rejected);
          replayed = true;
          return;
        }

        for (const item of [...parsed.data.items].sort((a, b) => a.productId - b.productId)) {
          const product = await lockedProduct(transaction, item.productId);
          if (!product || !isProductCartable(product, 1)) {
            rejected.push({ productId: item.productId, unmergedQuantity: item.quantity, reason: 'Product is unavailable.' });
            continue;
          }
          const [existing] = await transaction.select({ quantity: cartItems.quantity }).from(cartItems)
            .where(and(eq(cartItems.userId, userId), eq(cartItems.productId, item.productId))).for('update');
          const stock = product.stock ?? 0;
          const existingQuantity = existing?.quantity ?? 0;
          const quantity = mergeCartQuantity(existingQuantity, item.quantity, stock);
          const unmergedQuantity = unmergedGuestQuantity(existingQuantity, item.quantity, stock);
          if (unmergedQuantity > 0) {
            rejected.push({ productId: item.productId, unmergedQuantity, reason: `Quantity was limited to available stock (${stock}).` });
          }
          await transaction.insert(cartItems).values({ userId, productId: item.productId, quantity, updatedAt: new Date() })
            .onConflictDoUpdate({ target: [cartItems.userId, cartItems.productId], set: { quantity, updatedAt: new Date() } });
        }
        await transaction.update(cartMergeOperations).set({ rejected })
          .where(and(eq(cartMergeOperations.userId, userId), eq(cartMergeOperations.requestKey, requestKey)));
      });
      res.json({ items: await readCart(database, userId), rejected, replayed });
    } catch (error) { sendCartOperationError(error, res); }
  });

  // Replace is used to persist existing synchronous Zustand actions. It is all-or-nothing.
  router.put('/', async (req, res) => {
    const userId = cartOwnerId(req);
    if (!userId) { res.status(401).json({ error: 'A valid customer identity is required.' }); return; }
    const parsed = cartReplacementSchema.safeParse(req.body);
    if (!parsed.success) { sendInvalid(res, parsed.error); return; }
    try {
      await database.transaction(async (transaction) => {
        const checked = [];
        for (const item of [...parsed.data.items].sort((a, b) => a.productId - b.productId)) {
          const product = await rejectUnavailableProduct(transaction, item.productId, item.quantity);
          checked.push({ productId: item.productId, quantity: item.quantity, stock: product.stock ?? 0 });
        }
        await transaction.delete(cartItems).where(eq(cartItems.userId, userId));
        if (checked.length) {
          await transaction.insert(cartItems).values(checked.map(({ productId, quantity }) => ({ userId, productId, quantity, updatedAt: new Date() })));
        }
      });
      res.json({ items: await readCart(database, userId) });
    } catch (error) { sendCartOperationError(error, res); }
  });

  return router;
}
