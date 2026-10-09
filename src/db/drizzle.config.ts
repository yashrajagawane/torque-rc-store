import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';
import { resolveDatabaseSettings } from './config.ts';

const settings = resolveDatabaseSettings('migrations');
const dbCredentials = settings.url
  ? { url: settings.url, ssl: settings.ssl }
  : {
      host: settings.host!,
      port: settings.port!,
      database: settings.database!,
      user: settings.user!,
      password: settings.password!,
      ssl: settings.ssl,
    };

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials,
  verbose: true,
});
