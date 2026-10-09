import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

// Generation-only configuration for the reviewed fresh-database baseline.
// Keep the baseline immutable after adoption; routine changes belong in the
// main migration history. Applying it is handled by the guarded initializer.
export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle/fresh',
  dialect: 'postgresql',
  migrations: {
    schema: 'drizzle',
    table: '__drizzle_migrations',
  },
});
