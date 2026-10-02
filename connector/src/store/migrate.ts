/**
 * Apply `connector/migrations/*.sql` in order, each once, each in its own transaction.
 *
 * Run as the connector's role (`eve_mcp_app`). The schema itself is created by provisioning
 * (`CREATE SCHEMA eve_mcp AUTHORIZATION eve_mcp_app`, as the database owner), because this role
 * deliberately has no CREATE privilege on the engine's database; when the schema already exists
 * this never asks for one.
 */

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Db } from './store.js';

const NAME = /^\d{3}_[a-z0-9_]+\.sql$/;

export async function migrate(db: Db, directory: string): Promise<string[]> {
  const { rows: schemas } = await db.query("SELECT 1 FROM pg_namespace WHERE nspname = 'eve_mcp'");
  if (schemas.length === 0) await db.exec('CREATE SCHEMA eve_mcp');
  await db.exec(
    'CREATE TABLE IF NOT EXISTS eve_mcp.schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
  );
  const { rows } = await db.query<{ version: string }>('SELECT version FROM eve_mcp.schema_migrations');
  const applied = new Set(rows.map((r) => r.version));
  const files = (await readdir(directory)).filter((f) => NAME.test(f)).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const ran: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await readFile(join(directory, file), 'utf8');
    try {
      // The name is checked against NAME above, so it is safe to inline.
      await db.exec(`BEGIN;\n${sql}\nINSERT INTO eve_mcp.schema_migrations (version) VALUES ('${file}');\nCOMMIT;`);
    } catch (error) {
      await db.exec('ROLLBACK').catch(() => undefined);
      throw error;
    }
    ran.push(file);
  }
  return ran;
}
