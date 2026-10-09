import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

// Generation-only configuration for the complete schema baseline.
// Applying it is handled by the guarded fresh-database initializer.
export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle/fresh',
  dialect: 'postgresql',
  migrations: {
    schema: 'drizzle',
    table: '__drizzle_migrations',
  },
});
