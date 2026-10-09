import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { createPool } from '../src/db/index.ts';
import { brands, categories } from '../src/db/schema.ts';

const brandRows = [
  { name: 'RGT', slug: 'rgt' },
  { name: 'MJX', slug: 'mjx' },
  { name: 'FMS', slug: 'fms' },
  { name: 'JJRC', slug: 'jjrc' },
  { name: 'HB Toys', slug: 'hb-toys' },
  { name: 'MNRC', slug: 'mnrc' },
  { name: 'Rlaarlo', slug: 'rlaarlo' },
  { name: 'Heng Long', slug: 'heng-long' },
  { name: 'Jiabaile', slug: 'jiabaile' },
  { name: 'Suchiyu', slug: 'suchiyu' },
];

const categoryRows = [
  { name: 'Rock Crawlers', slug: 'crawlers' },
  { name: 'Bashers', slug: 'bashers' },
  { name: 'Drift Cars', slug: 'drift' },
  { name: 'On-road', slug: 'on-road' },
  { name: 'Construction', slug: 'construction' },
  { name: 'Marine', slug: 'marine' },
  { name: 'Spare Parts', slug: 'spare-parts' },
  { name: 'Accessories', slug: 'accessories' },
];

async function seedReferenceData() {
  const pool = createPool();
  const db = drizzle(pool);

  for (const row of brandRows) {
    const [inserted] = await db
      .insert(brands)
      .values(row)
      .onConflictDoNothing({ target: brands.slug })
      .returning({ slug: brands.slug });
    console.log(inserted ? `Inserted brand: ${row.slug}` : `Preserved existing brand: ${row.slug}`);
  }

  for (const row of categoryRows) {
    const [inserted] = await db
      .insert(categories)
      .values(row)
      .onConflictDoNothing({ target: categories.slug })
      .returning({ slug: categories.slug });
    console.log(inserted ? `Inserted category: ${row.slug}` : `Preserved existing category: ${row.slug}`);
  }

  await pool.end();
}

seedReferenceData().catch(async (error) => {
  console.error('Reference-data seed failed:', error);
  await global._postgresPool?.end();
  process.exitCode = 1;
});
