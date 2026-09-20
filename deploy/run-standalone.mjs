import { serve } from '../engine/dist/api/server.js';

for (const key of ['PGHOST', 'PGDATABASE', 'PGUSER', 'PGPASSWORD', 'COMPACT_FRAMES_DIR', 'COMPACT_SEED']) {
  if (!process.env[key]) throw new Error(`${key} is required for the persistent standalone world.`);
}
const started = await serve({
  port: Number(process.env.COMPACT_PORT || 8801),
  host: '127.0.0.1',
  seed: process.env.COMPACT_SEED,
  trustEdge: true,
  castSize: Number(process.env.COMPACT_CAST || 12),
  framesDir: process.env.COMPACT_FRAMES_DIR,
});
let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  await started.close();
  process.exit(0);
}
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
