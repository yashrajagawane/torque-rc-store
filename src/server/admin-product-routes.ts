import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { Router, raw, type Request, type Response } from 'express';
import { and, asc, desc, eq, gt, ilike, or, sql } from 'drizzle-orm';
import { createClient } from '@supabase/supabase-js';
import type { db } from '../db/index.ts';
import { brands, categories, inventoryReservations, products } from '../db/schema.ts';
import { requireAuth, requireOwner } from './auth.ts';
import { productInputSchema, productPublicationSchema, type ProductInput } from './product-validation.ts';

type Database = typeof db;

function sendValidationError(res: Response, error: { issues: Array<{ path: PropertyKey[]; message: string }> }) {
  res.status(400).json({
    error: 'Product validation failed.',
    details: error.issues.map((issue) => ({ field: issue.path.join('.'), message: issue.message })),
  });
}

function getProductId(value: string): number | null {
  if (!/^\d+$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export async function referencesExist(database: Database, input: ProductInput) {
  const [category, brand] = await Promise.all([
    database.select({ id: categories.id }).from(categories).where(eq(categories.id, input.categoryId)).limit(1),
    database.select({ id: brands.id }).from(brands).where(eq(brands.id, input.brandId)).limit(1),
  ]);
  return { category: category.length > 0, brand: brand.length > 0 };
}

async function validateReferences(database: Database, input: ProductInput, res: Response) {
  const references = await referencesExist(database, input);
  if (!references.category || !references.brand) {
    res.status(400).json({
      error: 'Product references are invalid.',
      ...(references.category ? {} : { categoryId: 'Select an existing category.' }),
      ...(references.brand ? {} : { brandId: 'Select an existing brand.' }),
    });
    return false;
  }
  return true;
}

export function availabilityForStock(stock: number): 'IN_STOCK' | 'OUT_OF_STOCK' {
  return stock > 0 ? 'IN_STOCK' : 'OUT_OF_STOCK';
}

export function buildNewProductValues(input: ProductInput) {
  return {
    ...input,
    currency: 'INR',
    thumbnail: input.images[0],
    availability: availabilityForStock(input.stock),
    isPublished: false,
  };
}

export function buildProductUpdateValues(input: ProductInput) {
  return {
    ...input,
    currency: 'INR',
    thumbnail: input.images[0],
    availability: availabilityForStock(input.stock),
    updatedAt: new Date(),
  };
}

function isUniqueConstraintError(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}

function reportProductError(error: unknown, res: Response) {
  if (isUniqueConstraintError(error)) {
    res.status(409).json({ error: 'A product with this slug already exists.' });
    return;
  }
  console.error('Admin product request failed.');
  res.status(500).json({ error: 'Product management is temporarily unavailable.' });
}

function imageFormat(contentType: string, bytes: Buffer): { extension: string; valid: boolean } | null {
  const formats: Record<string, { extension: string; valid: boolean }> = {
    'image/jpeg': { extension: 'jpg', valid: bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff },
    'image/png': { extension: 'png', valid: bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
    'image/webp': { extension: 'webp', valid: bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP' },
    'image/avif': { extension: 'avif', valid: bytes.length >= 12 && bytes.toString('ascii', 4, 8) === 'ftyp' && ['avif', 'avis'].includes(bytes.toString('ascii', 8, 12)) },
  };
  return formats[contentType] || null;
}

export function createAdminProductRouter(database: Database) {
  const router = Router();
  router.use(requireAuth, requireOwner);

  router.get('/options', async (_req, res) => {
    try {
      const [categoryOptions, brandOptions] = await Promise.all([
        database.select({ id: categories.id, name: categories.name }).from(categories).orderBy(asc(categories.name)),
        database.select({ id: brands.id, name: brands.name }).from(brands).orderBy(asc(brands.name)),
      ]);
      res.json({ categories: categoryOptions, brands: brandOptions });
    } catch (error) {
      reportProductError(error, res);
    }
  });

  router.get('/products', async (req, res) => {
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    if (search.length > 100) {
      res.status(400).json({ error: 'Search text must be 100 characters or fewer.' });
      return;
    }
    try {
      let query = database.select({ product: products, brandName: brands.name, categoryName: categories.name })
        .from(products)
        .leftJoin(brands, eq(products.brandId, brands.id))
        .leftJoin(categories, eq(products.categoryId, categories.id))
        .$dynamic();
      if (search) {
        const pattern = `%${search.replace(/[\\%_]/g, '\\$&')}%`;
        query = query.where(or(ilike(products.name, pattern), ilike(products.slug, pattern)));
      }
      res.json(await query.orderBy(desc(products.updatedAt)));
    } catch (error) {
      reportProductError(error, res);
    }
  });

  router.post('/products', async (req, res) => {
    const parsed = productInputSchema.safeParse(req.body);
    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }
    try {
      if (!await validateReferences(database, parsed.data, res)) return;
      const [created] = await database.insert(products).values(buildNewProductValues(parsed.data)).returning();
      res.status(201).json(created);
    } catch (error) {
      reportProductError(error, res);
    }
  });

  router.patch('/products/:id', async (req, res) => {
    const id = getProductId(req.params.id);
    if (!id) {
      res.status(400).json({ error: 'Product ID must be a positive integer.' });
      return;
    }
    const parsed = productInputSchema.safeParse(req.body);
    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }
    try {
      if (!await validateReferences(database, parsed.data, res)) return;
      const result = await database.transaction(async (transaction) => {
        const [locked] = await transaction.select({ id: products.id }).from(products)
          .where(eq(products.id, id)).for('update');
        if (!locked) return { kind: 'missing' as const };
        const [reserved] = await transaction.select({ quantity: sql<number>`COALESCE(SUM(${inventoryReservations.quantity}), 0)::int` })
          .from(inventoryReservations)
          .where(and(
            eq(inventoryReservations.productId, id),
            eq(inventoryReservations.status, 'ACTIVE'),
            gt(inventoryReservations.expiresAt, sql`clock_timestamp()`),
          ));
        if (parsed.data.stock < Number(reserved?.quantity ?? 0)) return { kind: 'reserved' as const };
        const [updated] = await transaction.update(products).set(buildProductUpdateValues(parsed.data))
          .where(eq(products.id, id)).returning();
        return updated ? { kind: 'updated' as const, product: updated } : { kind: 'missing' as const };
      });
      if (result.kind === 'missing') {
        res.status(404).json({ error: 'Product not found.' });
        return;
      }
      if (result.kind === 'reserved') {
        res.status(409).json({ error: 'Stock cannot be set below quantities reserved for active orders.' });
        return;
      }
      res.json(result.product);
    } catch (error) {
      reportProductError(error, res);
    }
  });

  router.patch('/products/:id/publication', async (req, res) => {
    const id = getProductId(req.params.id);
    if (!id) {
      res.status(400).json({ error: 'Product ID must be a positive integer.' });
      return;
    }
    const parsed = productPublicationSchema.safeParse(req.body);
    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }
    try {
      const [updated] = await database.update(products).set({
        isPublished: parsed.data.isPublished,
        updatedAt: new Date(),
      }).where(eq(products.id, id)).returning();
      if (!updated) {
        res.status(404).json({ error: 'Product not found.' });
        return;
      }
      res.json(updated);
    } catch (error) {
      reportProductError(error, res);
    }
  });

  router.post('/uploads', raw({ type: '*/*', limit: '8mb' }), async (req: Request, res: Response) => {
    const contentType = req.header('content-type')?.split(';', 1)[0].trim().toLowerCase() || '';
    const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const format = imageFormat(contentType, bytes);
    if (!format?.valid) {
      res.status(400).json({ error: 'Upload a valid JPEG, PNG, WebP, or AVIF image.' });
      return;
    }

    const url = process.env.SUPABASE_URL?.trim();
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
    const bucket = process.env.SUPABASE_STORAGE_BUCKET?.trim();
    if (!url || !serviceRoleKey || !bucket) {
      res.status(503).json({ error: 'Product image storage is not configured on the server.' });
      return;
    }

    try {
      const storageClient = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
      const storagePath = `products/${randomUUID()}.${format.extension}`;
      const { error } = await storageClient.storage.from(bucket).upload(storagePath, bytes, {
        contentType,
        cacheControl: '31536000',
        upsert: false,
      });
      if (error) {
        console.error('Product image upload failed in Supabase Storage.');
        res.status(502).json({ error: 'Image storage upload failed.' });
        return;
      }
      const { data } = storageClient.storage.from(bucket).getPublicUrl(storagePath);
      res.status(201).json({ url: data.publicUrl });
    } catch {
      res.status(503).json({ error: 'Product image storage is temporarily unavailable.' });
    }
  });

  return router;
}
