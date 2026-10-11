import express from 'express';
import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { db } from '../db/index.ts';
import { brands, categories } from '../db/schema.ts';
import { requireAuth, requireOwner } from './auth.ts';

type Database = typeof db;
const idSchema = z.string().regex(/^\d+$/).transform(Number).refine((id) => Number.isSafeInteger(id) && id > 0);
const catalogSchema = z.object({
  name: z.string().trim().min(1).max(100),
  slug: z.string().trim().min(1).max(120).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  description: z.string().trim().max(2000).nullable().optional(),
  image: z.string().trim().max(2048).nullable().optional(),
}).strict();

function errorResponse(error: unknown, res: express.Response, message: string) {
  if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505') {
    res.status(409).json({ error: 'That slug is already in use.' });
    return;
  }
  console.error(message);
  res.status(503).json({ error: 'Catalog management is temporarily unavailable.' });
}

export function createAdminCatalogRouter(database: Database) {
  const router = express.Router();
  router.use(requireAuth, requireOwner);

  router.get('/categories', async (_req, res) => {
    try { res.json(await database.select().from(categories).orderBy(asc(categories.name))); }
    catch (error) { errorResponse(error, res, 'Admin category query failed.'); }
  });
  router.post('/categories', async (req, res) => {
    const parsed = catalogSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: 'Category details are invalid.' }); return; }
    try { const [created] = await database.insert(categories).values(parsed.data).returning(); res.status(201).json(created); }
    catch (error) { errorResponse(error, res, 'Admin category creation failed.'); }
  });
  router.patch('/categories/:id', async (req, res) => {
    const id = idSchema.safeParse(req.params.id); const parsed = catalogSchema.safeParse(req.body);
    if (!id.success || !parsed.success) { res.status(400).json({ error: 'Category details are invalid.' }); return; }
    try { const [updated] = await database.update(categories).set(parsed.data).where(eq(categories.id, id.data)).returning(); if (!updated) { res.status(404).json({ error: 'Category not found.' }); return; } res.json(updated); }
    catch (error) { errorResponse(error, res, 'Admin category update failed.'); }
  });

  router.get('/brands', async (_req, res) => {
    try { res.json(await database.select().from(brands).orderBy(asc(brands.name))); }
    catch (error) { errorResponse(error, res, 'Admin brand query failed.'); }
  });
  router.post('/brands', async (req, res) => {
    const parsed = catalogSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: 'Brand details are invalid.' }); return; }
    try { const { image, ...brand } = parsed.data; const [created] = await database.insert(brands).values({ ...brand, logo: image }).returning(); res.status(201).json(created); }
    catch (error) { errorResponse(error, res, 'Admin brand creation failed.'); }
  });
  router.patch('/brands/:id', async (req, res) => {
    const id = idSchema.safeParse(req.params.id); const parsed = catalogSchema.safeParse(req.body);
    if (!id.success || !parsed.success) { res.status(400).json({ error: 'Brand details are invalid.' }); return; }
    try { const { image, ...brand } = parsed.data; const [updated] = await database.update(brands).set({ ...brand, logo: image }).where(eq(brands.id, id.data)).returning(); if (!updated) { res.status(404).json({ error: 'Brand not found.' }); return; } res.json(updated); }
    catch (error) { errorResponse(error, res, 'Admin brand update failed.'); }
  });
  return router;
}
