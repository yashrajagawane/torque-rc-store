import express, { type RequestHandler } from 'express';
import { z } from 'zod';
import { desc } from 'drizzle-orm';
import type { db } from '../db/index.ts';
import { contactInquiries } from '../db/schema.ts';
import { requireAuth, requireOwner } from './auth.ts';

export const contactInquirySchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().email().max(254),
  phone: z.string().trim().max(32).optional().default(''),
  inquiryType: z.enum([
    'Technical Advice',
    'Order Tracking',
    'Brushless Upgrade',
    'Warranty / Parts',
    'Wholesale',
  ]),
  model: z.string().trim().max(120).optional().default(''),
  message: z.string().trim().min(10).max(5000),
}).strict();

type RateLimitOptions = { limit?: number; windowMs?: number; now?: () => number };

export function createContactRateLimiter(options: RateLimitOptions = {}): RequestHandler {
  const limit = options.limit ?? 5;
  const windowMs = options.windowMs ?? 10 * 60_000;
  const now = options.now ?? Date.now;
  const clients = new Map<string, { count: number; resetAt: number }>();

  return (req, res, next) => {
    const currentTime = now();
    for (const [key, value] of clients) {
      if (value.resetAt <= currentTime) clients.delete(key);
    }
    const key = req.ip || req.socket.remoteAddress || 'unknown';
    let entry = clients.get(key);
    if (!entry && clients.size >= 10_000) {
      res.status(429).json({ error: 'Too many inquiries. Please try again later.' });
      return;
    }
    if (!entry) {
      entry = { count: 0, resetAt: currentTime + windowMs };
      clients.set(key, entry);
    }
    if (entry.count >= limit) {
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil((entry.resetAt - currentTime) / 1000))));
      res.status(429).json({ error: 'Too many inquiries. Please try again later.' });
      return;
    }
    entry.count += 1;
    next();
  };
}

export function createPublicContactRouter(database: typeof db, rateLimit = createContactRateLimiter()) {
  const router = express.Router();
  router.post('/', rateLimit, async (req, res) => {
    const parsed = contactInquirySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Check the inquiry fields and try again.' });
      return;
    }

    try {
      const input = parsed.data;
      const [saved] = await database.insert(contactInquiries).values({
        name: input.name,
        email: input.email,
        phone: input.phone || null,
        inquiryType: input.inquiryType,
        model: input.model || null,
        message: input.message,
      }).returning({ id: contactInquiries.id, createdAt: contactInquiries.createdAt });
      if (!saved) throw new Error('Inquiry insert returned no row.');
      res.status(201).json({
        id: saved.id,
        createdAt: saved.createdAt,
        message: 'Your inquiry was received and saved for store review. No email was sent automatically.',
      });
    } catch {
      // Do not log message bodies, contact details, or driver errors that may contain connection data.
      console.error('Contact inquiry persistence failed.');
      res.status(503).json({ error: 'Your inquiry could not be saved. Please try again later.' });
    }
  });
  return router;
}

export function createAdminContactInquiryRouter(
  database: typeof db,
  authenticate: RequestHandler = requireAuth,
  authorizeOwner: RequestHandler = requireOwner,
) {
  const router = express.Router();
  router.use(authenticate, authorizeOwner);
  router.get('/', async (_req, res) => {
    try {
      const inquiries = await database.select().from(contactInquiries)
        .orderBy(desc(contactInquiries.createdAt))
        .limit(100);
      res.json({ inquiries });
    } catch {
      console.error('Contact inquiry inbox query failed.');
      res.status(503).json({ error: 'The inquiry inbox is temporarily unavailable.' });
    }
  });
  return router;
}
