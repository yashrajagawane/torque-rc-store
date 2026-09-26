import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { db } from './src/db/index.ts';
import { products, brands, categories, users } from './src/db/schema.ts';
import { eq, and, gte, lte, or, sql, desc, asc } from 'drizzle-orm';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

// API Routes
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
      availability: products.availability,
      brandName: brands.name,
      categoryName: categories.name,
    })
    .from(products)
    .leftJoin(brands, eq(products.brandId, brands.id))
    .leftJoin(categories, eq(products.categoryId, categories.id));

    const conditions = [];

    if (brand) conditions.push(eq(brands.slug, brand as string));
    if (category) conditions.push(eq(categories.slug, category as string));
    if (scale) conditions.push(eq(products.scale, scale as string));
    if (minPrice) conditions.push(gte(products.price, minPrice as string));
    if (maxPrice) conditions.push(lte(products.price, maxPrice as string));
    if (featured === 'true') conditions.push(eq(products.featured, true));
    if (newArrival === 'true') conditions.push(eq(products.newArrival, true));
    if (search) {
      conditions.push(or(
        sql`LOWER(${products.name}) LIKE LOWER(${'%' + search + '%'})`,
        sql`LOWER(${products.description}) LIKE LOWER(${'%' + search + '%'})`
      ));
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
  } catch (error) {
    console.error('Error fetching products:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.get('/api/products/:slug', async (req, res) => {
  try {
    const { slug } = req.params;
    const result = await db.select({
      product: products,
      brandName: brands.name,
      categoryName: categories.name,
    })
    .from(products)
    .leftJoin(brands, eq(products.brandId, brands.id))
    .leftJoin(categories, eq(products.categoryId, categories.id))
    .where(eq(products.slug, slug))
    .limit(1);

    if (result.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }

    res.json(result[0]);
  } catch (error) {
    console.error('Error fetching product details:', error);
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

// Serve Vite frontend
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, 'dist')));
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
  });
} else {
  // In development, the Vite dev server handles frontend requests
  const { createServer: createViteServer } = await import('vite');
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: 'custom',
  });
  app.use(vite.middlewares);
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

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
