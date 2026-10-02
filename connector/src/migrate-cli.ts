/**
 * `node dist/migrate.mjs` — apply connector/migrations as the connector's role, then exit.
 * Reads PG* (or EVE_MCP_DATABASE_URL) from the environment. Prints only file names.
 */

import { fileURLToPath } from 'node:url';
import { migrate } from './store/migrate.js';
import { pgDb } from './store/pg.js';

const directory = fileURLToPath(new URL('../migrations', import.meta.url));
const db = pgDb(process.env['EVE_MCP_DATABASE_URL']?.trim() || null, () => undefined);
try {
  const ran = await migrate(db, directory);
  process.stdout.write(ran.length === 0 ? 'eve_mcp: schema is current\n' : `eve_mcp: applied ${ran.join(', ')}\n`);
} catch (error) {
  const code = typeof error === 'object' && error !== null && 'code' in error ? String((error as { code: unknown }).code) : 'unknown';
  process.stderr.write(`eve_mcp: migration failed (postgres code ${code})\n`);
  process.exitCode = 1;
} finally {
  await db.end().catch(() => undefined);
}
