/** Real Postgres SQL in-process (PGlite), migrated exactly as production is. */

import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { migrate } from '../../src/store/migrate.js';
import type { Db } from '../../src/store/store.js';

export const MIGRATIONS = fileURLToPath(new URL('../../migrations', import.meta.url));

export interface TestDb extends Db {
  readonly pglite: PGlite;
  close(): Promise<void>;
}

export async function testDb(): Promise<TestDb> {
  const pglite = await PGlite.create();
  const db: TestDb = {
    pglite,
    query: async <T,>(sql: string, params?: readonly unknown[]) => {
      const result = await pglite.query<T>(sql, params === undefined ? undefined : [...params]);
      return { rows: result.rows };
    },
    exec: async (sql: string) => {
      await pglite.exec(sql);
    },
    close: () => pglite.close(),
  };
  await migrate(db, MIGRATIONS);
  return db;
}
