import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool, type PoolConfig } from 'pg';
import * as schema from './schema.ts';
import { resolveDatabaseSettings } from './config.ts';

declare global {
  var _postgresPool: Pool | undefined;
}

export const createPool = () => {
  if (!global._postgresPool) {
    const settings = resolveDatabaseSettings('runtime');
    const poolConfig: PoolConfig = settings.url
      ? {
          connectionString: settings.url,
          ssl: settings.ssl,
          // Supabase transaction pooling is intended for serverless clients.
          // Keep a single connection per warm Vercel Function instance.
          max: process.env.VERCEL === '1' ? 1 : 10,
          connectionTimeoutMillis: process.env.VERCEL === '1' ? 5000 : 15000,
        }
      : {
          host: settings.host,
          port: settings.port,
          database: settings.database,
          user: settings.user,
          password: settings.password,
          ssl: settings.ssl,
          max: process.env.VERCEL === '1' ? 1 : 10,
          connectionTimeoutMillis: process.env.VERCEL === '1' ? 5000 : 15000,
        };
    global._postgresPool = new Pool(poolConfig);

    global._postgresPool.on('error', () => {
      console.error('Unexpected error on idle SQL pool client.');
    });
  }
  return global._postgresPool;
};

const pool = createPool();
export const db = drizzle(pool, { schema });
