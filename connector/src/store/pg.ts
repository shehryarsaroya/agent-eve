/** node-pg behind the `Db` interface. Connection settings come from PG* variables or one URL. */

import pg from 'pg';
import type { Db } from './store.js';

export interface PgDb extends Db {
  end(): Promise<void>;
}

export function pgDb(connectionString: string | null, onError: (error: Error) => void): PgDb {
  const pool = new pg.Pool({
    ...(connectionString === null ? {} : { connectionString }),
    max: 8,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    application_name: 'agenteve-mcp',
  });
  // An idle client dying must not crash the process; the next query reconnects.
  pool.on('error', onError);
  return {
    query: async <T,>(sql: string, params?: readonly unknown[]) => {
      const result = await pool.query(sql, params === undefined ? undefined : [...params]);
      return { rows: result.rows as T[] };
    },
    exec: async (sql: string) => {
      await pool.query(sql);
    },
    end: () => pool.end(),
  };
}
