/**
 * Shared fixtures for the follow-by-email suite.
 *
 * **No test here touches the network or a real key.** Mail goes to {@link RecordingMailer},
 * or — in the integration spec — to a local HTTP server that speaks Resend's request shape.
 * The clock is injected and advanced by hand (DET-7), so cooldowns and expiries are instant.
 */

import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { fixedClock, setSpeed, type Clock } from '../../src/core/time.js';
import type { PrincipalId } from '../../src/core/types.js';
import type { ReckoningFrame, StandingRow } from '../../src/frames/contract.js';
import { createApp, type ApiContext } from '../../src/api/server.js';
import { SeatBook } from '../../src/api/seats.js';
import { RateLimiter, type Allowance } from '../../src/api/limits.js';
import {
  FollowService,
  InMemoryFollowStore,
  type Mailer,
  type MailReceipt,
  type OutboundMail,
} from '../../src/api/follow/index.js';
import { Runtime } from '../../src/sim/runtime.js';

export interface AdvanceableClock extends Clock {
  advance(ms: number): void;
}

export function clockAt(ms = Date.UTC(2026, 9, 1, 12, 0, 0)): AdvanceableClock {
  return fixedClock(ms) as AdvanceableClock;
}

/** A secret long enough to be accepted. Assembled, so it is not a contiguous literal. */
export const TEST_SECRET = ['follow', 'test', 'secret', 'not', 'a', 'real', 'one', '0123456789'].join('-');

/**
 * A mailer that records every send and can be told to fail.
 *
 * `fail` is consulted per call; return an Error to throw it, or null to succeed.
 */
export class RecordingMailer implements Mailer {
  readonly sent: OutboundMail[] = [];
  readonly attempts: OutboundMail[] = [];
  fail: (mail: OutboundMail, n: number) => Error | null = () => null;

  send(mail: OutboundMail): Promise<MailReceipt> {
    this.attempts.push(mail);
    const error = this.fail(mail, this.attempts.length);
    if (error !== null) return Promise.reject(error);
    this.sent.push(mail);
    return Promise.resolve({ id: `mail-${String(this.sent.length)}` });
  }

  to(address: string): OutboundMail[] {
    return this.sent.filter((m) => m.to === address);
  }
}

/** Pull the one link of a given kind out of a mail's plain text. */
export function linkIn(mail: OutboundMail | undefined, kind: 'confirm' | 'unsubscribe'): string {
  if (mail === undefined) throw new Error(`no mail to read a ${kind} link from`);
  const m = new RegExp(`https?://[^\\s]+/api/follow/${kind}\\?token=[A-Za-z0-9_-]+`).exec(mail.text);
  if (m === null) throw new Error(`no ${kind} link in: ${mail.text}`);
  return m[0];
}

export function tokenOf(link: string): string {
  return new URL(link).searchParams.get('token') ?? '';
}

/** Wide allowances, so only the tests that mean to hit a bucket hit one. */
export const LOOSE_FOLLOW_LIMITS: Readonly<Record<string, Allowance>> = Object.freeze({
  'follow-ip': { burst: 100_000, windowSeconds: 60 },
  'follow-link': { burst: 100_000, windowSeconds: 60 },
  'follow-email': { burst: 100_000, windowSeconds: 60 },
  'follow-handle': { burst: 100_000, windowSeconds: 60 },
});

export interface FollowHarness {
  readonly runtime: Runtime;
  readonly context: ApiContext;
  readonly clock: AdvanceableClock;
  readonly origin: string;
  readonly store: InMemoryFollowStore;
  readonly mailer: RecordingMailer;
  readonly service: FollowService;
  post(path: string, body: unknown, headers?: Readonly<Record<string, string>>): Promise<Reply>;
  get(path: string, headers?: Readonly<Record<string, string>>): Promise<Reply>;
  request(method: string, path: string, body?: string, headers?: Readonly<Record<string, string>>): Promise<Reply>;
  close(): Promise<void>;
}

export interface Reply {
  readonly status: number;
  readonly text: string;
  readonly json: Record<string, unknown>;
  readonly headers: Headers;
}

export interface FollowHarnessOptions {
  readonly handles?: readonly string[];
  readonly limits?: Readonly<Record<string, Allowance>>;
  readonly dailyCeiling?: number;
  readonly maxActivePerEmail?: number;
  /** False: build the service with no mailer, as a world with mail switched off. */
  readonly sending?: boolean;
  /** False: mount no follow service at all. */
  readonly withService?: boolean;
  readonly trustEdge?: boolean;
  readonly startTick?: number;
}

export async function followHarness(options: FollowHarnessOptions = {}): Promise<FollowHarness> {
  setSpeed('instant');
  const clock = clockAt();
  const runtime = new Runtime({
    seed: 'follow-fixture',
    ...(options.startTick === undefined ? {} : { startTick: options.startTick }),
  });
  for (const h of options.handles ?? ['vale', 'orison', 'red-ash-9']) runtime.seat(`p:${h}` as PrincipalId, h);
  const store = new InMemoryFollowStore();
  const mailer = new RecordingMailer();
  const sending = options.sending ?? true;
  const service = new FollowService({
    store,
    mailer: sending ? mailer : null,
    offReason: sending ? null : 'RESEND_API_KEY is not set, so this world sends no mail.',
    secret: TEST_SECRET,
    clock,
    publicUrl: 'https://agenteve.io',
    dailyCeiling: options.dailyCeiling ?? 2_000,
    maxActivePerEmail: options.maxActivePerEmail ?? 10,
    limiter: new RateLimiter(options.limits ?? LOOSE_FOLLOW_LIMITS),
    log: () => undefined,
  });
  const { app, context } = createApp({
    runtime,
    clock,
    trustEdge: options.trustEdge ?? false,
    seats: new SeatBook(64),
    follow: options.withService === false ? null : service,
  });
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const origin = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;

  async function request(
    method: string,
    path: string,
    body?: string,
    headers: Readonly<Record<string, string>> = {},
  ): Promise<Reply> {
    const res = await fetch(`${origin}${path}`, { method, headers: { ...headers }, ...(body === undefined ? {} : { body }) });
    const text = await res.text();
    let json: Record<string, unknown> = {};
    try {
      const parsed: unknown = JSON.parse(text);
      if (typeof parsed === 'object' && parsed !== null) json = parsed as Record<string, unknown>;
    } catch {
      // HTML pages are not JSON; tests read `text` for those.
    }
    return { status: res.status, text, json, headers: res.headers };
  }

  return {
    runtime,
    context,
    clock,
    origin,
    store,
    mailer,
    service,
    post: (path, body, headers = {}) =>
      request('POST', path, typeof body === 'string' ? body : JSON.stringify(body), {
        'content-type': 'application/json',
        ...headers,
      }),
    get: (path, headers = {}) => request('GET', path, undefined, headers),
    request,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}

/** A path relative to the server, from an absolute emailed link. */
export function pathOf(link: string): string {
  const u = new URL(link);
  return `${u.pathname}${u.search}`;
}

// ── Synthetic frames ────────────────────────────────────────────────────────

export function standing(handle: string, over: Partial<StandingRow> = {}): StandingRow {
  return {
    principal: `p:${handle}` as PrincipalId,
    handle,
    electiveHonoured: 0,
    electiveHonouredValue: 0 as StandingRow['electiveHonouredValue'],
    defaults: 0,
    contradictedSeals: 0,
    distinctCounterparties: 0,
    lastDefaultTick: null,
    signer: null,
    ...over,
  };
}

/**
 * A minimal, well-typed frame. Every list empty unless overridden — the recap must read an
 * absent line set as "nothing happened", and these frames are how that is pinned.
 */
export function frame(reckoningIndex: number, over: Partial<ReckoningFrame> = {}): ReckoningFrame {
  const base = {
    reckoningIndex,
    tick: reckoningIndex * 288 + 287,
    stateHash: 'f'.repeat(64),
    meters: { levyShort: 0, onAPromise: 0, kept: 0, broken: 0, unrefined: 0 },
    docket: [],
    rundown: [],
    tributeLines: [],
    authorityLines: [],
    raidLines: [],
    battleLines: [],
    claimLines: [],
    saps: [],
    worksLines: [],
    marketLines: [],
    standings: [],
    places: [],
    ruins: [],
    hallOfFame: [],
    syndicateLines: [],
    frontBands: [],
    coverArcs: [],
    coverChains: [],
    map: [],
    swayLines: [],
    // THE RISE (RULES_VERSION 41): `null` on a map that has never grown, as every engine frame is.
    growth: null,
    convoyLines: [],
    compactLinks: [],
    glyphs: [],
    ticker: [],
    nextDocket: [],
    // ★ 41: the contact lines are required keys, and `publishFrame`'s budget assert walks them.
    directoryLines: [],
    parleyLines: [],
  };
  return { ...base, ...over } as unknown as ReckoningFrame;
}
