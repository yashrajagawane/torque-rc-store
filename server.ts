import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { db } from './src/db/index.ts';
import { products, brands, categories, users } from './src/db/schema.ts';
import { eq, and, gte, lte, or, sql, desc, asc } from 'drizzle-orm';
import { AuthenticatedRequest, isOwnerEmail, requireAuth, requireOwner } from './src/server/auth.ts';
import { createAdminProductRouter } from './src/server/admin-product-routes.ts';
import { createCartRouter } from './src/server/cart-routes.ts';
import { createAdminOrderRouter, createOrderRouter } from './src/server/order-routes.ts';
import { createAdminPaymentReviewRouter, createPaymentRouter, createRazorpayWebhookHandler } from './src/server/payment-routes.ts';
import { availableAvailabilitySql, availableStockSql } from './src/server/inventory.ts';
import { createAdminContactInquiryRouter, createPublicContactRouter } from './src/server/contact-routes.ts';
import { createHealthRouter } from './src/server/health-routes.ts';
import { createReservationCleanupHandler } from './src/server/reservation-cron-route.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;

app.use(createHealthRouter(async () => {
  await db.transaction(async (transaction) => {
    await transaction.execute(sql`SET LOCAL statement_timeout = '3s'`);
    await transaction.execute(sql`SELECT 1`);
  });
}));
app.post('/api/internal/reservations/expire', createReservationCleanupHandler({
  database: db,
  getSecret: () => process.env.CRON_SECRET,
}));

// Razorpay signs the exact request bytes; register this route before JSON parsing.
app.post('/api/payments/razorpay/webhook', express.raw({ type: 'application/json', limit: '1mb' }), createRazorpayWebhookHandler(db));
app.use(express.json());

// API Routes
app.get('/api/account/me', requireAuth, (req, res) => {
  const user = (req as AuthenticatedRequest).authUser!;
  const displayName = user.user_metadata?.display_name;
  res.json({
    id: user.id,
    email: user.email,
    emailVerified: Boolean(user.email_confirmed_at),
    displayName: typeof displayName === 'string' ? displayName : null,
    owner: isOwnerEmail(user.email, user.email_confirmed_at, process.env.ADMIN_EMAILS || ''),
  });
});

app.get('/api/owner/test', requireAuth, requireOwner, (_req, res) => {
  res.json({ access: 'owner' });
});

app.use('/api/admin', createAdminProductRouter(db));
app.use('/api/admin/orders', createAdminOrderRouter(db));
app.use('/api/admin/payment-review-cases', createAdminPaymentReviewRouter(db));
app.use('/api/admin/contact-inquiries', createAdminContactInquiryRouter(db));
app.use('/api/cart', createCartRouter(db));
app.use('/api/orders', createOrderRouter(db));
app.use('/api/orders', createPaymentRouter(db));
app.use('/api/contact-inquiries', createPublicContactRouter(db));

app.get('/api/products', async (req, res) => {
  try {
    const { brand, category, scale, minPrice, maxPrice, sort, search, featured, newArrival } = req.query;

    let query = db.select({
      id: products.id,
      slug: products.slug,
      name: products.name,
      price: products.price,
      compareAtPrice: products.compareAtPrice,
      thumbnail: products.thumbnail,
      scale: products.scale,
      terrain: products.terrain,
      stock: availableStockSql(),
      availability: availableAvailabilitySql(),
      brandName: brands.name,
      categoryName: categories.name,
    })
    .from(products)
    .leftJoin(brands, eq(products.brandId, brands.id))
    .leftJoin(categories, eq(products.categoryId, categories.id))
    .$dynamic();

    const conditions = [eq(products.isPublished, true)];

    if (brand) conditions.push(eq(brands.slug, brand as string));
    if (category) conditions.push(eq(categories.slug, category as string));
    if (scale) conditions.push(eq(products.scale, scale as string));
    if (minPrice) conditions.push(gte(products.price, minPrice as string));
    if (maxPrice) conditions.push(lte(products.price, maxPrice as string));
    if (featured === 'true') conditions.push(eq(products.featured, true));
    if (newArrival === 'true') conditions.push(eq(products.newArrival, true));
    if (search) {
      const searchCondition = or(
        sql`LOWER(${products.name}) LIKE LOWER(${'%' + search + '%'})`,
        sql`LOWER(${products.description}) LIKE LOWER(${'%' + search + '%'})`
      );
      if (searchCondition) conditions.push(searchCondition);
    }

    let finalQuery = conditions.length > 0 ? query.where(and(...conditions)) : query;

    // Sorting
    if (sort === 'price-low-high') {
      finalQuery = finalQuery.orderBy(asc(products.price));
    } else if (sort === 'price-high-low') {
      finalQuery = finalQuery.orderBy(desc(products.price));
    } else if (sort === 'newest') {
      finalQuery = finalQuery.orderBy(desc(products.createdAt));
    } else {
      finalQuery = finalQuery.orderBy(desc(products.createdAt));
    }

    const results = await finalQuery;
    res.json(results);
  } catch {
    console.error('Product catalogue query failed.');
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.get('/api/products/:slug', async (req, res) => {
  try {
    const { slug } = req.params;
    const result = await db.select({
      product: products,
      availableStock: availableStockSql(),
      availableAvailability: availableAvailabilitySql(),
      brandName: brands.name,
      categoryName: categories.name,
    })
    .from(products)
    .leftJoin(brands, eq(products.brandId, brands.id))
    .leftJoin(categories, eq(products.categoryId, categories.id))
    .where(and(eq(products.slug, slug), eq(products.isPublished, true)))
    .limit(1);

    if (result.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }

    const [{ availableStock, availableAvailability, ...productResult }] = result;
    res.json({
      ...productResult,
      product: { ...productResult.product, stock: availableStock, availability: availableAvailability },
    });
  } catch {
    console.error('Product detail query failed.');
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.get('/api/categories', async (req, res) => {
  try {
    const results = await db.select().from(categories);
    res.json(results);
  } catch (error) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.get('/api/brands', async (req, res) => {
  try {
    const results = await db.select().from(brands);
    res.json(results);
  } catch (error) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'API route not found.' });
});

// Serve Vite frontend
if (process.env.NODE_ENV === 'production') {
  // Vercel serves /public assets at its CDN edge. Standalone Node continues to
  // serve Vite's dist directory directly.
  if (process.env.VERCEL !== '1') app.use(express.static(path.join(__dirname, 'dist')));
  app.get('*', (req, res) => {
    const indexPath = process.env.VERCEL === '1'
      ? path.join(__dirname, 'public', 'index.html')
      : path.join(__dirname, 'dist', 'index.html');
    res.sendFile(indexPath);
  });
} else {
  // In development, the Vite dev server handles frontend requests
  const { createServer: createViteServer } = await import('vite');
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: 'custom',
  });
  // Adapt Vite's Connect server to Express's middleware overload explicitly.
  // Passing the Connect server directly is rejected by newer TypeScript/
  // @types/express combinations even though both are compatible at runtime.
  app.use((req, res, next) => vite.middlewares(
    // Express's request/response objects are Node HTTP objects at runtime.
    // The assertion is limited to this Connect/Express type boundary because
    // Vite and Express may resolve different @types/node versions.
    req as unknown as IncomingMessage,
    res as unknown as ServerResponse,
    next,
  ));
  app.get('*', async (req, res, next) => {
    const url = req.originalUrl;
    try {
      let template = await (await import('fs')).readFileSync(path.resolve(__dirname, 'index.html'), 'utf-8');
      template = await vite.transformIndexHtml(url, template);
      res.status(200).set({ 'Content-Type': 'text/html' }).end(template);
    } catch (e) {
      vite.ssrFixStacktrace(e as Error);
      next(e);
    }
  });
}

app.use((error: unknown, req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (res.headersSent) return next(error);
  const type = typeof error === 'object' && error !== null && 'type' in error ? error.type : undefined;
  if (type === 'entity.too.large') {
    res.status(413).json({ error: req.path === '/api/payments/razorpay/webhook' ? 'Webhook request exceeds the 1 MiB limit.' : 'Image uploads must be 4 MiB or smaller.' });
    return;
  }
  if (type === 'entity.parse.failed') {
    res.status(400).json({ error: 'Request body is not valid JSON.' });
    return;
  }
  res.status(500).json({ error: 'Request could not be processed.' });
});

export default app;

// Vercel invokes the exported Express application as a Function. Local and
// standalone production continue to own their HTTP listener.
if (process.env.VERCEL !== '1') {
  app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
  });
}
