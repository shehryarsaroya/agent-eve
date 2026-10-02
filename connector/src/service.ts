/** Assembles the service from its parts. `main.ts` passes real ones; the tests pass fakes. */

import type { JWTVerifyGetKey } from 'jose';
import { TokenVerifier } from './auth/tokens.js';
import { secretValues, type Config } from './config.js';
import { KeyVault } from './crypto/vault.js';
import { EngineClient, type EngineTransport } from './engine/client.js';
import { PublicFrames, type FramesSource } from './frames.js';
import { createHandler, type HttpDeps, type Peer } from './http.js';
import { KeyedMutex, RateLimiter } from './limits.js';
import { createLogger, type Logger } from './log.js';
import { createTools, TtlCache } from './mcp/tools.js';
import { Store, type Db } from './store/store.js';

export interface ServiceParts {
  readonly config: Config;
  readonly db: Db;
  /** The Supabase project's signing keys (remote JWKS in production). */
  readonly keys: JWTVerifyGetKey;
  readonly engine?: EngineTransport;
  readonly frames?: FramesSource;
  readonly logger?: Logger;
  /** Extra secret strings the logger must never print (e.g. the database password). */
  readonly extraSecrets?: readonly string[];
  readonly now?: () => number;
}

export interface Service {
  readonly handle: (request: Request, peer?: Peer) => Promise<Response>;
  readonly deps: HttpDeps;
}

export function createService(parts: ServiceParts): Service {
  const { config } = parts;
  const known = [...secretValues(config), ...(parts.extraSecrets ?? [])];
  const secrets = (): readonly string[] => known;
  const now = parts.now ?? (() => Date.now());
  const logger = parts.logger ?? createLogger(undefined, secrets);
  const vault = new KeyVault(config.masterKeys);
  const engine =
    parts.engine ??
    new EngineClient({
      engineUrl: config.engineUrl,
      authority: config.engineAuthority,
      clientIp: config.engineClientIp,
      gatewaySecret: config.gatewaySecret,
      timeoutMs: config.engineTimeoutMs,
      maxConcurrent: config.engineMaxConcurrent,
    });
  const toolDeps = {
    config,
    store: new Store(parts.db),
    engine,
    frames: parts.frames ?? new PublicFrames({ dir: config.framesDir, url: config.framesUrl }),
    vault,
    limiter: new RateLimiter(config.limits),
    mutex: new KeyedMutex(),
    logger,
    secrets,
    now,
    cache: new TtlCache(now),
  };
  const deps: HttpDeps = {
    ...toolDeps,
    tools: createTools(toolDeps),
    tokens: new TokenVerifier({ issuer: config.issuer, audiences: config.tokenAudiences, keys: parts.keys }),
    // Derived, not configured: one fewer secret to provision, rotated with the master key.
    sessionSecret: vault.derive('session-id/v1'),
  };
  return { handle: createHandler(deps), deps };
}
