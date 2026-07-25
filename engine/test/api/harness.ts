/**
 * The HTTP test harness: a real listening server, real signatures, an injected clock.
 *
 * Deliberately **not** a mocked request object. Three of the properties under test
 * here only exist at the socket:
 *
 *   - scar #11's HTML stack page is rendered by `finalhandler` on a real response,
 *   - a malformed body has to actually arrive as bytes for the parser to refuse it,
 *   - `CF-Connecting-IP` is a header a mock would let us forget to send.
 *
 * A mocked harness would have passed on all three while production failed.
 *
 * The clock is injected and advanced by hand (DET-7: `Date.now` is banned), which is
 * also why the rate-limit and signature-freshness tests are instant rather than sleepy.
 */

import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { fixedClock, setSpeed, type Clock } from '../../src/core/time.js';
import { buildSignedRequest, generateKeypair, type AgentKeypair } from '../../src/identity/index.js';
import { wallSeconds } from '../../src/identity/index.js';
import { createApp, API_BASE_PATH, type ApiContext } from '../../src/api/index.js';
import { RateLimiter, type Allowance } from '../../src/api/index.js';
import { SeatBook } from '../../src/api/index.js';
import { Runtime } from '../../src/sim/runtime.js';

export interface AdvanceableClock extends Clock {
  advance(ms: number): void;
}

export interface Harness {
  readonly runtime: Runtime;
  readonly context: ApiContext;
  readonly clock: AdvanceableClock;
  readonly origin: string;
  readonly authority: string;
  close(): Promise<void>;
}

export interface HarnessOptions {
  readonly seed?: string;
  readonly seats?: number;
  readonly trustEdge?: boolean;
  /** Effectively unlimited by default: a limiter is tested on purpose, not by accident. */
  readonly limits?: Readonly<Record<string, Allowance>>;
  readonly startTick?: number;
}

/** Wide allowances, so only the tests that mean to hit the limiter hit it. */
export const LOOSE_LIMITS: Readonly<Record<string, Allowance>> = Object.freeze({
  enroll: { burst: 100_000, windowSeconds: 60 },
  observe: { burst: 100_000, windowSeconds: 60 },
  act: { burst: 100_000, windowSeconds: 60 },
  discrepancy: { burst: 100_000, windowSeconds: 60 },
  health: { burst: 100_000, windowSeconds: 60 },
});

export async function harness(options: HarnessOptions = {}): Promise<Harness> {
  setSpeed('instant');
  const clock = fixedClock(1_700_000_000_000) as AdvanceableClock;
  const runtime = new Runtime({
    seed: options.seed ?? 'api-fixture',
    ...(options.startTick === undefined ? {} : { startTick: options.startTick }),
  });
  const { app, context } = createApp({
    runtime,
    clock,
    trustEdge: options.trustEdge ?? false,
    seats: new SeatBook(options.seats ?? 64),
    limiter: new RateLimiter(options.limits ?? LOOSE_LIMITS),
  });

  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const address = server.address() as AddressInfo;
  const authority = `127.0.0.1:${String(address.port)}`;

  return {
    runtime,
    context,
    clock,
    authority,
    origin: `http://${authority}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}

// ── The agent side ──────────────────────────────────────────────────────────

let nonceCounter = 0;

/** A fresh nonce. Monotone rather than random: `Rng` is for the world, not for tests. */
export function nonce(label = 'n'): string {
  nonceCounter += 1;
  return `${label}-${String(nonceCounter).padStart(12, '0')}`;
}

export interface Agent {
  readonly handle: string;
  readonly keypair: AgentKeypair;
  principalId: string;
}

export function agent(handle: string): Agent {
  return { handle, keypair: generateKeypair(), principalId: '' };
}

/** The base64url public key `agent.md` §2 asks an agent to send. */
export function publicKeyOf(a: Agent): string {
  return a.keypair.record.publicKeyJwk.x;
}

export interface Reply {
  readonly status: number;
  readonly text: string;
  readonly json: Record<string, unknown>;
  readonly contentType: string;
}

async function reply(res: Response): Promise<Reply> {
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed === 'object' && parsed !== null) json = parsed as Record<string, unknown>;
  } catch {
    // Left empty on purpose: a non-JSON body is exactly what scar #11 is about, and
    // the test asserts on `text` in that case.
  }
  return { status: res.status, text, json, contentType: res.headers.get('content-type') ?? '' };
}

/** An unsigned request. For enrolment, malformed-input fuzzing, and health. */
export async function raw(
  h: Harness,
  method: string,
  path: string,
  body?: string | Uint8Array,
  headers: Readonly<Record<string, string>> = {},
): Promise<Reply> {
  const init: RequestInit = { method, headers: { ...headers } };
  if (body !== undefined) init.body = body;
  return reply(await fetch(`${h.origin}${path}`, init));
}

export interface SignedOptions {
  /** Skew the `created` stamp, in wall-clock seconds. For the freshness tests. */
  readonly createdOffsetSeconds?: number;
  readonly nonceValue?: string;
  readonly headerOverrides?: Readonly<Record<string, string>>;
  /** Drop a signature header entirely, to test the structural refusals. */
  readonly drop?: readonly string[];
  readonly components?: readonly string[];
  readonly extraHeaders?: Readonly<Record<string, string>>;
}

/**
 * A signed request, built the one sanctioned way.
 *
 * `buildSignedRequest` digests before signing, which is the ordering hazard the
 * helper exists for: a client that signs first produces a well-formed request that
 * is always refused, and its author's natural next move is to remove the digest.
 */
export async function signed(
  h: Harness,
  a: Agent,
  method: string,
  path: string,
  bodyObject?: unknown,
  options: SignedOptions = {},
): Promise<Reply> {
  const { text, headers } = buildSigned(h, a, method, path, bodyObject, options);
  return raw(h, method, path, text ?? undefined, headers);
}

/**
 * Build a signed request without sending it, so a test can tamper with exactly one
 * header and change exactly one thing.
 *
 * Returned rather than rebuilt inside each test: a test that re-derives the headers
 * changes the nonce as well as the field under test, and then it is asserting on a
 * refusal it did not mean to provoke.
 */
export function buildSigned(
  h: Harness,
  a: Agent,
  method: string,
  path: string,
  bodyObject?: unknown,
  options: SignedOptions = {},
): { readonly text: string | null; readonly headers: Record<string, string> } {
  const bodyText = bodyObject === undefined ? null : JSON.stringify(bodyObject);
  const bytes = bodyText === null ? null : new TextEncoder().encode(bodyText);
  const created = wallSeconds(
    Math.floor(h.clock.nowMs() / 1000) + (options.createdOffsetSeconds ?? 0),
  );
  const built = buildSignedRequest({
    method,
    scheme: 'http',
    authority: h.authority,
    requestTarget: path,
    body: bytes,
    keypair: a.keypair,
    created,
    nonce: options.nonceValue ?? nonce(),
  });
  const headers: Record<string, string> = {
    ...built.headers,
    ...(options.extraHeaders ?? {}),
    ...(options.headerOverrides ?? {}),
  };
  for (const drop of options.drop ?? []) delete headers[drop];
  if (bodyText !== null) headers['content-type'] = 'application/json';
  return { text: bodyText, headers };
}

export const PATHS = {
  enroll: `${API_BASE_PATH}/enroll`,
  observe: `${API_BASE_PATH}/observe`,
  act: `${API_BASE_PATH}/act`,
  health: `${API_BASE_PATH}/health`,
  discrepancy: `${API_BASE_PATH}/discrepancy`,
  agentMd: `${API_BASE_PATH}/agent.md`,
} as const;

/** Enrol an agent and record the principal id it was given. */
export async function enrol(h: Harness, a: Agent): Promise<Reply> {
  const res = await raw(h, 'POST', PATHS.enroll, JSON.stringify({ handle: a.handle, publicKey: publicKeyOf(a) }), {
    'content-type': 'application/json',
  });
  const id = res.json['principalId'];
  if (typeof id === 'string') a.principalId = id;
  return res;
}

/** Advance the world by N ticks. The API never advances it; the sim does. */
export function tick(h: Harness, n = 1): void {
  for (let i = 0; i < n; i += 1) h.runtime.runTick();
}
