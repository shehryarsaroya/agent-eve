/**
 * Configuration, from the environment, validated once at boot.
 *
 * Every secret here is read from `/etc/agenteve-mcp/env` (mode 0600) by systemd and never
 * appears in an error: a refusal names the variable, never its value.
 */

export interface RateAllowance {
  readonly burst: number;
  readonly windowSeconds: number;
}

export interface Config {
  /** Loopback port nginx proxies to. */
  readonly port: number;
  readonly host: string;
  /** `https://mcp.agenteve.io` — the origin hosts are told about. */
  readonly publicOrigin: string;
  /** RFC 9728 resource identifier and expected token audience: `${publicOrigin}/mcp`. */
  readonly resource: string;
  /** The public game site, for links to an agent's page. */
  readonly gameOrigin: string;
  /** The engine on loopback: `http://127.0.0.1:8801`. */
  readonly engineUrl: string;
  /**
   * The `Host` header sent to the engine, and therefore the `@authority` signed (RFC 9421).
   * Defaults to the engine URL's own host.
   */
  readonly engineAuthority: string;
  /** Sent as `CF-Connecting-IP`; the engine refuses requests without it when it trusts the edge. */
  readonly engineClientIp: string;
  readonly engineTimeoutMs: number;
  readonly engineMaxConcurrent: number;
  /** Seconds per tick at the engine's speed, for the wall-clock estimates in `eve_wake_status`. */
  readonly tickSeconds: number;
  /** Public frames: a directory (tests) or a URL ending in `/` (production: nginx on loopback). */
  readonly framesDir: string | null;
  readonly framesUrl: string | null;
  /** Supabase Auth is the authorization server. */
  readonly supabaseUrl: string;
  readonly issuer: string;
  readonly jwksUrl: string;
  /** Audiences accepted on MCP access tokens. */
  readonly tokenAudiences: readonly string[];
  /** Scopes advertised in protected resource metadata and challenges. */
  readonly scopes: readonly string[];
  /** Master keys that encrypt agent keys, by version. The highest version encrypts new keys. */
  readonly masterKeys: ReadonlyMap<number, Buffer>;
  /**
   * The HMAC key for the gateway header (`EVE_GATEWAY_SECRET`) — the same value as the engine's
   * `COMPACT_GATEWAY_SECRET`, which verifies it. Null sends no header: the engine then meters every
   * hosted player as one address and records none of them as hosted.
   */
  readonly gatewaySecret: Buffer | null;
  /** Hosts whose initialize `clientInfo.name` matches get ChatGPT's in-band sign-in prompt. */
  readonly inbandAuthClients: RegExp;
  /** Browser origins allowed to call `/mcp`. Requests with no Origin are always allowed. */
  readonly allowedOrigins: readonly string[];
  /** Trust `X-Real-IP` from a loopback peer (nginx) as the caller's address. */
  readonly trustProxy: boolean;
  /** Seconds an identical act batch from one account is treated as a retry. */
  readonly retryWindowSeconds: number;
  readonly limits: Readonly<Record<LimitName, RateAllowance>>;
  /** Postgres connection: node-pg reads PG* variables when this is null. */
  readonly databaseUrl: string | null;
  readonly policyUrl: string | null;
  readonly termsUrl: string | null;
  readonly docsUrl: string | null;
}

export type LimitName = 'spectator' | 'account' | 'observe' | 'act' | 'enroll' | 'report';

export const DEFAULT_LIMITS: Readonly<Record<LimitName, RateAllowance>> = {
  /** Anonymous reads, per caller address. Chat hosts share egress addresses, so this is loose. */
  spectator: { burst: 240, windowSeconds: 60 },
  /** Free account reads: identity, wake status, signing log. */
  account: { burst: 60, windowSeconds: 60 },
  /** Wakes are the real budget (16 a Reckoning); this only protects the host. */
  observe: { burst: 30, windowSeconds: 60 },
  act: { burst: 30, windowSeconds: 60 },
  enroll: { burst: 5, windowSeconds: 3600 },
  report: { burst: 6, windowSeconds: 60 },
};

export class ConfigError extends Error {}

const ORIGIN = /^https?:\/\/[A-Za-z0-9.-]+(?::\d{1,5})?$/;

function origin(env: NodeJS.ProcessEnv, name: string, fallback?: string): string {
  const raw = (env[name] ?? fallback ?? '').trim().replace(/\/+$/, '');
  if (!ORIGIN.test(raw)) throw new ConfigError(`${name} must be an origin such as https://example.com (scheme, host, optional port).`);
  return raw;
}

function int(env: NodeJS.ProcessEnv, name: string, fallback: number, min: number, max: number): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) throw new ConfigError(`${name} must be an integer from ${min} to ${max}.`);
  return value;
}

function list(env: NodeJS.ProcessEnv, name: string, fallback: readonly string[]): readonly string[] {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  return raw.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
}

/** `32 bytes`, given as base64, base64url or 64 hex characters. */
export function decodeKey(value: string, name: string): Buffer {
  const text = value.trim();
  const bytes = /^[0-9a-fA-F]{64}$/.test(text) ? Buffer.from(text, 'hex') : Buffer.from(text, 'base64');
  if (bytes.length !== 32) throw new ConfigError(`${name} must decode to exactly 32 bytes.`);
  return bytes;
}

/** `EVE_MCP_MASTER_KEYS=1:<key>,2:<key>` — versioned so a master key can be rotated. */
export function parseMasterKeys(raw: string | undefined): ReadonlyMap<number, Buffer> {
  if (raw === undefined || raw.trim() === '') throw new ConfigError('EVE_MCP_MASTER_KEYS is required (version:key pairs, e.g. 1:<32 bytes base64>).');
  const keys = new Map<number, Buffer>();
  for (const part of raw.split(',')) {
    const at = part.indexOf(':');
    const version = Number(part.slice(0, at));
    if (at < 1 || !Number.isInteger(version) || version < 1 || version > 32767) {
      throw new ConfigError('EVE_MCP_MASTER_KEYS entries must look like <version>:<key> with a positive integer version.');
    }
    if (keys.has(version)) throw new ConfigError('EVE_MCP_MASTER_KEYS repeats a version.');
    keys.set(version, decodeKey(part.slice(at + 1), `EVE_MCP_MASTER_KEYS version ${version}`));
  }
  return keys;
}

function limitsFrom(env: NodeJS.ProcessEnv): Record<LimitName, RateAllowance> {
  const out = { ...DEFAULT_LIMITS } as Record<LimitName, RateAllowance>;
  for (const name of Object.keys(DEFAULT_LIMITS) as LimitName[]) {
    const key = `EVE_MCP_LIMIT_${name.toUpperCase()}`;
    const raw = env[key];
    if (raw === undefined || raw.trim() === '') continue;
    const match = /^(\d+)\/(\d+)$/.exec(raw.trim());
    if (!match) throw new ConfigError(`${key} must look like <burst>/<windowSeconds>, e.g. 30/60.`);
    out[name] = { burst: Number(match[1]), windowSeconds: Number(match[2]) };
  }
  return out;
}

function optionalUrl(env: NodeJS.ProcessEnv, name: string): string | null {
  const raw = env[name]?.trim();
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ConfigError(`${name} must be an absolute URL.`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new ConfigError(`${name} must be http(s).`);
  return url.href;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const publicOrigin = origin(env, 'EVE_MCP_PUBLIC_ORIGIN', 'https://mcp.agenteve.io');
  const engineUrl = origin(env, 'EVE_ENGINE_URL', 'http://127.0.0.1:8801');
  const supabaseUrl = origin(env, 'SUPABASE_URL');
  const issuer = (env['SUPABASE_ISSUER']?.trim() || `${supabaseUrl}/auth/v1`).replace(/\/+$/, '');
  const resource = `${publicOrigin}/mcp`;
  const framesDir = env['EVE_FRAMES_DIR']?.trim() || null;
  const framesUrl = optionalUrl(env, 'EVE_FRAMES_URL');
  if (framesDir === null && framesUrl === null) throw new ConfigError('Set EVE_FRAMES_DIR or EVE_FRAMES_URL so the spectator tools can read the public frames.');
  if (framesUrl !== null && !framesUrl.endsWith('/')) throw new ConfigError('EVE_FRAMES_URL must end with a slash.');
  // The engine's own /frames/ route serves latest.json and the archive but NOT live.json (nginx
  // serves that off disk), so frames read through the engine's port would silently lose the live
  // clock: eve_map falls back to the settled frame, eve_dossier's live lines go stale.
  if (framesUrl !== null && new URL(framesUrl).origin === new URL(engineUrl).origin) {
    throw new ConfigError(
      "EVE_FRAMES_URL must not point at the engine: its /frames/ route does not serve live.json. Use nginx's frames listener (http://127.0.0.1:8826/frames/), the public site, or EVE_FRAMES_DIR.",
    );
  }
  const gatewayRaw = env['EVE_GATEWAY_SECRET'];
  const pattern = env['EVE_MCP_INBAND_AUTH_CLIENTS']?.trim() || 'openai|chatgpt';
  let inbandAuthClients: RegExp;
  try {
    inbandAuthClients = new RegExp(pattern, 'i');
  } catch {
    throw new ConfigError('EVE_MCP_INBAND_AUTH_CLIENTS must be a valid regular expression.');
  }
  return {
    port: int(env, 'EVE_MCP_PORT', 8825, 1, 65535),
    host: env['EVE_MCP_HOST']?.trim() || '127.0.0.1',
    publicOrigin,
    resource,
    gameOrigin: origin(env, 'EVE_GAME_ORIGIN', 'https://agenteve.io'),
    engineUrl,
    engineAuthority: env['EVE_ENGINE_AUTHORITY']?.trim() || new URL(engineUrl).host,
    engineClientIp: env['EVE_ENGINE_CLIENT_IP']?.trim() || '127.0.0.1',
    engineTimeoutMs: int(env, 'EVE_ENGINE_TIMEOUT_MS', 20_000, 1_000, 120_000),
    engineMaxConcurrent: int(env, 'EVE_ENGINE_MAX_CONCURRENT', 32, 1, 1024),
    tickSeconds: int(env, 'EVE_ENGINE_TICK_SECONDS', 300, 0, 86_400),
    framesDir,
    framesUrl,
    supabaseUrl,
    issuer,
    jwksUrl: optionalUrl(env, 'SUPABASE_JWKS_URL') ?? `${issuer}/.well-known/jwks.json`,
    tokenAudiences: list(env, 'EVE_MCP_TOKEN_AUDIENCES', [resource]),
    scopes: list(env, 'EVE_MCP_SCOPES', ['email']),
    masterKeys: parseMasterKeys(env['EVE_MCP_MASTER_KEYS']),
    gatewaySecret: gatewayRaw === undefined || gatewayRaw.trim() === '' ? null : decodeKey(gatewayRaw, 'EVE_GATEWAY_SECRET'),
    inbandAuthClients,
    allowedOrigins: list(env, 'EVE_MCP_ALLOWED_ORIGINS', ['https://claude.ai', 'https://chatgpt.com', 'https://chat.openai.com', publicOrigin]),
    trustProxy: (env['EVE_MCP_TRUST_PROXY'] ?? '1') !== '0',
    retryWindowSeconds: int(env, 'EVE_MCP_RETRY_WINDOW_SECONDS', 600, 0, 86_400),
    limits: limitsFrom(env),
    databaseUrl: env['EVE_MCP_DATABASE_URL']?.trim() || null,
    policyUrl: optionalUrl(env, 'EVE_MCP_POLICY_URL'),
    termsUrl: optionalUrl(env, 'EVE_MCP_TERMS_URL'),
    docsUrl: optionalUrl(env, 'EVE_MCP_DOCS_URL'),
  };
}

/** Every secret value in the config, so the logger can refuse to print any of them. */
export function secretValues(config: Config): string[] {
  const out: string[] = [];
  for (const key of config.masterKeys.values()) out.push(key.toString('base64'), key.toString('base64url'), key.toString('hex'));
  if (config.gatewaySecret) out.push(config.gatewaySecret.toString('base64'), config.gatewaySecret.toString('base64url'), config.gatewaySecret.toString('hex'));
  return out;
}
