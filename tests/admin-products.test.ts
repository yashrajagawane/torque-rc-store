import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { describe, it } from 'node:test';
import { isProductImageWithinUploadLimit, MAX_PRODUCT_IMAGE_BYTES } from '../src/lib/product-upload.ts';
import express from 'express';
import { availabilityForStock, buildNewProductValues, buildProductUpdateValues, createAdminProductRouter, referencesExist } from '../src/server/admin-product-routes.ts';
import { productInputSchema, productPublicationSchema } from '../src/server/product-validation.ts';

const validProduct = {
  name: 'Trail Runner RC',
  slug: 'trail-runner-rc',
  description: 'A ready-to-run trail vehicle.',
  price: '12500.00',
  compareAtPrice: '14999.00',
  categoryId: 1,
  brandId: 1,
  images: ['https://storage.example.test/products/trail-runner.jpg'],
  stock: 8,
  scale: '1:10',
  terrain: 'Trail',
  driveType: '4WD',
  batteryType: '2S LiPo',
  skillLevel: 'Beginner',
  featured: false,
  newArrival: true,
};

describe('admin product validation and publication', () => {
  it('keeps image uploads below the Vercel Function request-body limit', () => {
    assert.equal(MAX_PRODUCT_IMAGE_BYTES, 4 * 1024 * 1024);
    assert.equal(isProductImageWithinUploadLimit(1), true);
    assert.equal(isProductImageWithinUploadLimit(MAX_PRODUCT_IMAGE_BYTES), true);
    assert.equal(isProductImageWithinUploadLimit(MAX_PRODUCT_IMAGE_BYTES + 1), false);
    assert.equal(isProductImageWithinUploadLimit(0), false);
  });
  it('accepts valid product data and rejects invalid price, slug, and reference IDs', () => {
    assert.equal(productInputSchema.safeParse(validProduct).success, true);
    assert.equal(productInputSchema.safeParse({ ...validProduct, slug: 'Bad Slug' }).success, false);
    assert.equal(productInputSchema.safeParse({ ...validProduct, price: '-1' }).success, false);
    assert.equal(productInputSchema.safeParse({ ...validProduct, categoryId: 0 }).success, false);
    assert.equal(productInputSchema.safeParse({ ...validProduct, brandId: -5 }).success, false);
  });

  it('checks category and brand references against database query results', async () => {
    const fakeDatabase = {
      select: () => ({
        from: () => ({
          where: () => ({ limit: async () => [] }),
        }),
      }),
    } as unknown as Parameters<typeof referencesExist>[0];
    const result = await referencesExist(fakeDatabase, productInputSchema.parse(validProduct));
    assert.deepEqual(result, { category: false, brand: false });
  });

  it('does not accept publication status in create or edit data and creates drafts by default', () => {
    assert.equal(productInputSchema.safeParse({ ...validProduct, isPublished: true }).success, false);
    const parsed = productInputSchema.parse(validProduct);
    assert.equal(buildNewProductValues(parsed).isPublished, false);
    assert.equal(productPublicationSchema.parse({ isPublished: true }).isPublished, true);
    assert.equal(productPublicationSchema.parse({ isPublished: false }).isPublished, false);
    assert.equal(productPublicationSchema.safeParse({ isPublished: 'true' }).success, false);
  });

  it('derives availability from stock on create and update, and rejects invalid stock', () => {
    const positiveStock = productInputSchema.parse({ ...validProduct, stock: 3 });
    const zeroStock = productInputSchema.parse({ ...validProduct, stock: 0 });

    assert.equal(buildNewProductValues(positiveStock).availability, 'IN_STOCK');
    assert.equal(buildNewProductValues(zeroStock).availability, 'OUT_OF_STOCK');
    // Update payloads always derive availability from the submitted stock, so changing either
    // direction cannot preserve a stale availability value from the prior database row.
    assert.equal(buildProductUpdateValues(zeroStock).availability, 'OUT_OF_STOCK');
    assert.equal(buildProductUpdateValues(positiveStock).availability, 'IN_STOCK');
    assert.equal(availabilityForStock(0), 'OUT_OF_STOCK');
    assert.equal(availabilityForStock(1), 'IN_STOCK');
    assert.equal(productInputSchema.safeParse({ ...validProduct, stock: -1 }).success, false);
    assert.equal(productInputSchema.safeParse({ ...validProduct, stock: 1.5 }).success, false);
    assert.equal(productInputSchema.safeParse({ ...validProduct, stock: 'not-a-number' }).success, false);
  });

  it('backfills current rows as published and defaults future inserts to drafts', () => {
    const migration = readFileSync(new URL('../drizzle/0000_products-publication-status.sql', import.meta.url), 'utf8');
    assert.match(migration, /ADD COLUMN "is_published" boolean DEFAULT true NOT NULL/i);
    assert.match(migration, /ALTER COLUMN "is_published" SET DEFAULT false/i);
  });

  it('rejects an unauthenticated product write before database access', async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/admin', createAdminProductRouter({} as Parameters<typeof createAdminProductRouter>[0]));
    const server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/api/admin/products`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validProduct),
      });
      assert.equal(response.status, 401);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});
