import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from './pg-schema.js';

const { Pool } = pg;

let pool: pg.Pool | null = null;
let _db: NodePgDatabase<typeof schema> | null = null;

function getPool(): pg.Pool {
  if (!pool) {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error('DATABASE_URL environment variable is required');
    }
    pool = new Pool({
      connectionString: databaseUrl,
      max: 20,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
    pool.on('error', (err) => {
      console.error('[db] Unexpected pool error:', err.message);
    });
  }
  return pool;
}

export const db = new Proxy({} as NodePgDatabase<typeof schema>, {
  get(_target, prop) {
    if (!_db) {
      _db = drizzle(getPool(), { schema });
    }
    return (_db as any)[prop];
  },
});

export async function closeDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    _db = null;
  }
}

export { getPool as pool };
