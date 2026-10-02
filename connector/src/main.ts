/**
 * agenteve-mcp: the remote MCP server at https://mcp.agenteve.io/mcp.
 *
 * Runs as its own systemd unit (`deploy/agenteve-mcp.service`) on the engine's host, on loopback
 * behind nginx and Cloudflare. Talks to the engine on loopback, to Postgres (schema eve_mcp) and,
 * for token verification keys only, to the Supabase project's JWKS.
 */

import { createServer } from 'node:http';
import { getRequestListener } from '@hono/node-server';
import { remoteKeys } from './auth/tokens.js';
import { ConfigError, loadConfig, secretValues } from './config.js';
import { createLogger, describeError } from './log.js';
import { createService } from './service.js';
import { pgDb } from './store/pg.js';

let config;
try {
  config = loadConfig();
} catch (error) {
  // ConfigError messages name variables, never values.
  process.stderr.write(`agenteve-mcp: ${error instanceof ConfigError ? error.message : 'invalid configuration'}\n`);
  process.exit(2);
}

const extraSecrets = [process.env['PGPASSWORD'] ?? '', process.env['EVE_MCP_DATABASE_URL'] ?? ''].filter((s) => s.length >= 8);
const secrets = [...secretValues(config), ...extraSecrets];
const logger = createLogger(undefined, () => secrets);
const db = pgDb(config.databaseUrl, (error) => logger.warn('db.idle_client_error', { error: describeError(error, secrets) }));
const service = createService({ config, db, keys: remoteKeys(config.jwksUrl), logger, extraSecrets });

const listener = getRequestListener(
  (request, env) => service.handle(request, { address: 'incoming' in env ? env.incoming.socket.remoteAddress : undefined }),
  { overrideGlobalObjects: false },
);
const server = createServer(listener);
server.requestTimeout = 120_000;
server.headersTimeout = 30_000;
server.keepAliveTimeout = 65_000;

server.listen(config.port, config.host, () => {
  logger.info('listening', { host: config.host, port: config.port, resource: config.resource, issuer: config.issuer, engine: config.engineUrl });
});

let closing = false;
async function shutdown(): Promise<void> {
  if (closing) return;
  closing = true;
  logger.info('shutting_down');
  server.close();
  await db.end().catch(() => undefined);
  process.exit(0);
}
process.once('SIGTERM', () => void shutdown());
process.once('SIGINT', () => void shutdown());
process.on('unhandledRejection', (error) => logger.error('unhandled_rejection', { error: describeError(error, secrets) }));
