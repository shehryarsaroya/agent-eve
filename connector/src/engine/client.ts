/**
 * Calls to the engine on loopback, signed as the account's agent.
 *
 * The RFC 9421 signer is the stdio bridge's own (`mcp/client.mjs`, bundled in at build), so a
 * hosted signature and a self-held one are produced by the same code. The signature covers
 * `@method @path @authority` (+ `content-digest` with a body); `@authority` is the `Host` header
 * this client sends, which is configurable so production can sign the public host.
 *
 * Every request carries `CF-Connecting-IP` — the engine, trusting the edge, refuses a request
 * without it — and, when a gateway secret is configured, the account's gateway header.
 */

import { request as httpRequest, type IncomingHttpHeaders } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { createHash } from 'node:crypto';
// The bridge's signer. One home for "how Agent Eve signs a request".
import { signedHeaders } from '../../../mcp/client.mjs';
import type { PrivateJwk } from '../crypto/keys.js';
import { gatewayHeaders } from './gateway.js';

export const MAX_ENGINE_BODY_BYTES = 64 * 1024;
const MAX_REPLY_BYTES = 8 * 1024 * 1024;

export interface Signer {
  readonly keyid: string;
  readonly privateKey: PrivateJwk;
}

export interface EngineCall {
  readonly method: 'GET' | 'POST';
  /** Origin-form path on the engine, e.g. `/api/observe`. */
  readonly path: string;
  readonly payload?: unknown;
  readonly signer?: Signer;
  /** Adds the gateway header naming this account. */
  readonly accountId?: string;
}

export interface EngineReply {
  readonly httpStatus: number;
  /** Parsed JSON, or `{ text }` for a non-JSON body (agent.md). */
  readonly body: Record<string, unknown>;
}

export class EngineError extends Error {}

export interface EngineClientOptions {
  readonly engineUrl: string;
  readonly authority: string;
  readonly clientIp: string;
  readonly gatewaySecret: Buffer | null;
  readonly timeoutMs: number;
  readonly maxConcurrent: number;
  readonly now?: () => number;
}

export interface EngineTransport {
  call(call: EngineCall): Promise<EngineReply>;
}

export class EngineClient implements EngineTransport {
  readonly #base: URL;
  readonly #options: EngineClientOptions;
  #inFlight = 0;
  readonly #waiting: (() => void)[] = [];

  constructor(options: EngineClientOptions) {
    this.#base = new URL(options.engineUrl);
    this.#options = options;
  }

  async call(call: EngineCall): Promise<EngineReply> {
    if (!call.path.startsWith('/') || call.path.startsWith('//')) throw new EngineError('engine path must be origin-form');
    await this.#acquire();
    try {
      return await this.#send(call);
    } finally {
      this.#release();
    }
  }

  async #acquire(): Promise<void> {
    if (this.#inFlight < this.#options.maxConcurrent) {
      this.#inFlight += 1;
      return;
    }
    await new Promise<void>((resolve) => this.#waiting.push(resolve));
    this.#inFlight += 1;
  }

  #release(): void {
    this.#inFlight -= 1;
    this.#waiting.shift()?.();
  }

  #send(call: EngineCall): Promise<EngineReply> {
    const target = new URL(call.path, this.#base);
    const body = call.payload === undefined ? undefined : JSON.stringify(call.payload);
    if (body !== undefined && Buffer.byteLength(body) > MAX_ENGINE_BODY_BYTES) throw new EngineError('request body is too large for the engine');
    const headers: Record<string, string> = {
      host: this.#options.authority,
      accept: 'application/json, text/markdown;q=0.9',
      'cf-connecting-ip': this.#options.clientIp,
      'user-agent': 'agenteve-mcp/0.1',
    };
    let digest: string | null = null;
    if (call.signer !== undefined) {
      // Signed against the authority we send as Host and the exact path we request.
      const signingUrl = new URL(call.path, `http://${this.#options.authority}`);
      const signed = signedHeaders(call.signer, call.method, signingUrl, body) as unknown as Record<string, string>;
      Object.assign(headers, signed);
      digest = signed['Content-Digest'] ?? null;
    } else if (body !== undefined) {
      // Unsigned (enrolment): still send the RFC 9530 digest, so the gateway MAC binds the body.
      digest = `sha-256=:${createHash('sha256').update(body).digest('base64')}:`;
      headers['content-type'] = 'application/json';
      headers['content-digest'] = digest;
    }
    if (body !== undefined) headers['content-length'] = String(Buffer.byteLength(body));
    if (call.accountId !== undefined && this.#options.gatewaySecret !== null) {
      Object.assign(headers, gatewayHeaders(this.#options.gatewaySecret, {
        accountId: call.accountId,
        method: call.method,
        path: target.pathname + target.search,
        contentDigest: digest,
        now: (this.#options.now ?? (() => Date.now() / 1000))(),
      }));
    }
    const send = target.protocol === 'https:' ? httpsRequest : httpRequest;
    return new Promise<EngineReply>((resolve, reject) => {
      const req = send(target, { method: call.method, headers, timeout: this.#options.timeoutMs }, (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_REPLY_BYTES) {
            req.destroy(new EngineError('engine reply exceeded the size cap'));
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => resolve({ httpStatus: res.statusCode ?? 502, body: parse(Buffer.concat(chunks).toString('utf8'), res.headers) }));
        res.on('error', () => reject(new EngineError('the engine connection failed mid-reply')));
      });
      req.on('timeout', () => req.destroy(new EngineError('the engine did not answer in time')));
      req.on('error', (error) => reject(error instanceof EngineError ? error : new EngineError('the engine is unreachable')));
      if (body !== undefined) req.write(body);
      req.end();
    });
  }
}

function parse(text: string, headers: IncomingHttpHeaders): Record<string, unknown> {
  const type = String(headers['content-type'] ?? '');
  if (type.includes('json') || text.startsWith('{')) {
    try {
      const value: unknown = JSON.parse(text);
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) return value as Record<string, unknown>;
      return { value };
    } catch {
      return { text };
    }
  }
  return { text };
}
