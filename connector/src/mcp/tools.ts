/**
 * The tools: the stdio bridge's ten (`mcp/server.mjs`), same names and semantics, plus
 * `eve_signing_log` and `eve_wake_status`, which only make sense when the server holds the key.
 *
 * What changes from the bridge is WHO SIGNS: the bridge signs with a key file on the player's
 * machine; here the account's key lives encrypted in Postgres and this service signs with it, for
 * that account only, and logs every signature. The agent's public record says so: the engine records
 * the key as hosted at enrolment (the gateway header verified) and publishes `signer: hosted` on every
 * row that carries the principal's record — the frames' `standings` and `directoryLines`, its own
 * `header.standing`, and `eve_dossier` here (README §11).
 *
 * Every tool states a title and all four hints. Hosts treat a missing `readOnlyHint` as a write,
 * Claude's directory rejects a tool without a title and hints, and OpenAI wants destructive
 * `true` for anything irreversible or public — which `eve_act` and `eve_enroll` are: the record
 * they write is public and permanent (A5).
 */

import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { TICKS_PER_RECKONING, WAKES_PER_RECKONING } from '../../../engine/src/core/time.js';
import { dossierFor, summarizeLive, summarizeRundown } from './spectator.js';
import type { McpPrincipal } from '../auth/tokens.js';
import type { Config, LimitName } from '../config.js';
import { generateAgentKey, privateJwk } from '../crypto/keys.js';
import { agentKeyAad, type KeyVault } from '../crypto/vault.js';
import type { EngineReply, EngineTransport } from '../engine/client.js';
import type { FramesSource } from '../frames.js';
import type { KeyedMutex, RateLimiter } from '../limits.js';
import { describeError, type Logger } from '../log.js';
import type { HostedPrincipal, OutcomeSummary, SigningLogEntry, Store, WakeSnapshot } from '../store/store.js';
import { boundReply } from './untrusted.js';

export interface Hints {
  readonly readOnlyHint: boolean;
  readonly destructiveHint: boolean;
  readonly idempotentHint: boolean;
  readonly openWorldHint: boolean;
}

const READ: Hints = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

export interface ToolDeps {
  readonly config: Config;
  readonly store: Store;
  readonly engine: EngineTransport;
  readonly frames: FramesSource;
  readonly vault: KeyVault;
  readonly limiter: RateLimiter;
  readonly mutex: KeyedMutex;
  readonly logger: Logger;
  readonly secrets: () => readonly string[];
  /** Milliseconds since the epoch. */
  readonly now: () => number;
  readonly cache: TtlCache;
}

export interface CallContext {
  readonly auth: McpPrincipal | null;
  /** Rate-limit key for anonymous calls: the caller's address as nginx saw it. */
  readonly callerKey: string;
}

export interface ToolResultValue {
  readonly value: Record<string, unknown>;
  readonly isError: boolean;
}

export interface ToolDefinition {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly input: z.ZodType<Record<string, unknown>>;
  readonly hints: Hints;
  /** True when the tool acts for, or reads about, the signed-in account. */
  readonly needsAccount: boolean;
  run(args: Record<string, unknown>, ctx: CallContext): Promise<ToolResultValue>;
}

/**
 * A tiny time-boxed cache for the two engine reads every caller shares: /health and agent.md.
 * Without it every chat user's status check would land in the engine's one loopback rate bucket.
 * A load that throws is never kept; `keep` decides which answers are (a booting engine's 503 is a
 * true health answer for three seconds, and no answer at all for ten minutes of rules).
 */
export class TtlCache {
  readonly #entries = new Map<string, { readonly until: number; readonly value: Promise<EngineReply> }>();
  constructor(private readonly now: () => number) {}

  get(key: string, ttlMs: number, load: () => Promise<EngineReply>, keep: (reply: EngineReply) => boolean = () => true): Promise<EngineReply> {
    const hit = this.#entries.get(key);
    if (hit !== undefined && hit.until > this.now()) return hit.value;
    const value = load();
    const entry = { until: this.now() + ttlMs, value };
    this.#entries.set(key, entry);
    const forget = (): void => {
      if (this.#entries.get(key) === entry) this.#entries.delete(key);
    };
    value.then((reply) => (keep(reply) ? undefined : forget()), forget);
    return value;
  }
}

const RULES_TTL_MS = 600_000;
const HEALTH_TTL_MS = 3_000;
export const rulesFrom = (cache: TtlCache, engine: EngineTransport): Promise<EngineReply> =>
  cache.get('agent.md', RULES_TTL_MS, () => engine.call({ method: 'GET', path: '/api/agent.md' }), (reply) => reply.httpStatus === 200);
export const healthFrom = (cache: TtlCache, engine: EngineTransport): Promise<EngineReply> =>
  cache.get('health', HEALTH_TTL_MS, () => engine.call({ method: 'GET', path: '/api/health' }));

class Refusal extends Error {
  constructor(message: string, readonly extra: Record<string, unknown> = {}) {
    super(message);
  }
}

const HANDLE = z.string().min(1).max(32).regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/);
const NO_ARGS = z.object({});
const ACTION = z.looseObject({
  verb: z.string().min(1).max(64),
  params: z.record(z.string(), z.unknown()),
  quote_id: z.string().max(256).optional(),
  clientSequence: z.number().int().nonnegative().max(2_000_000_000).optional(),
});
const ACT_INPUT = z.object({
  actions: z.array(ACTION).min(1).max(8),
  idempotencyKey: z.string().min(1).max(128).regex(/^[A-Za-z0-9_:.-]+$/).optional(),
  expectedStateVersion: z.number().int().nonnegative().optional(),
});

const NOT_YET = {
  available: false,
  reason: 'No Reckoning has settled yet in this world, so there is no rundown or standing to show. The live clock is in eve_status.',
};

const SIGNER_NOTE =
  "signer: hosted — Agent Eve's server holds this agent's key and signs each request you make through a connected app. The agent's public record discloses this and that it is played from chat.";

function replyValue(reply: EngineReply): ToolResultValue {
  return { value: { httpStatus: reply.httpStatus, ...reply.body }, isError: reply.httpStatus >= 400 };
}

function refusal(message: string, extra: Record<string, unknown> = {}): ToolResultValue {
  return { value: { error: message, ...extra }, isError: true };
}

/** Canonical JSON (sorted keys), so the same arguments always hash the same. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function snapshotOf(body: Record<string, unknown>, nowMs: number): WakeSnapshot | null {
  const observation = body['observation'];
  if (typeof observation !== 'object' || observation === null) return null;
  const header = (observation as Record<string, unknown>)['header'];
  if (typeof header !== 'object' || header === null) return null;
  const h = header as Record<string, unknown>;
  if (typeof h['tick'] !== 'number') return null;
  return {
    tick: h['tick'],
    reckoning: Math.floor(Math.max(0, h['tick']) / TICKS_PER_RECKONING),
    wakesRemaining: typeof h['wakes_remaining'] === 'number' ? h['wakes_remaining'] : null,
    nextDecisionAt: typeof h['next_decision_at'] === 'number' ? h['next_decision_at'] : null,
    observedAt: new Date(nowMs).toISOString(),
  };
}

/** `observation.header.standing.principal`: the principal the engine says signed this request. */
function observedPrincipal(body: Record<string, unknown>): string | null {
  const observation = body['observation'] as { header?: { standing?: { principal?: unknown } } } | undefined;
  const value = observation?.header?.standing?.principal;
  return typeof value === 'string' && /^p:[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(value) ? value : null;
}

function outcomeSummary(body: Record<string, unknown>): OutcomeSummary | null {
  const outcome = body['outcome'];
  if (typeof outcome !== 'object' || outcome === null) return null;
  const o = outcome as Record<string, unknown>;
  const rows = (list: unknown): Record<string, unknown>[] => (Array.isArray(list) ? list.filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null) : []);
  const num = (v: unknown): number | null => (typeof v === 'number' ? v : null);
  const str = (v: unknown): string | null => (typeof v === 'string' ? v.slice(0, 64) : null);
  return {
    accepted: rows(o['accepted']).slice(0, 8).map((a) => ({ clientSequence: num(a['clientSequence']), verb: str(a['verb']) ?? '?', resolvesInTick: num(a['resolvesInTick']) })),
    corrected: rows(o['corrections']).slice(0, 8).map((c) => ({ clientSequence: num(c['clientSequence']), verb: str(c['verb']), invariant: str(c['invariant']) })),
  };
}

function rulesSection(text: string, section: string): string | null {
  const lines = text.split('\n');
  const start = lines.findIndex((line) => line.startsWith(`## ${section}.`));
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^## /.test(lines[i] as string)) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join('\n').trimEnd();
}

export function createTools(deps: ToolDeps): ToolDefinition[] {
  const { config, store, engine, frames, vault, limiter, mutex, logger } = deps;
  const nowSeconds = (): number => deps.now() / 1000;

  function limit(name: LimitName, key: string): void {
    const verdict = limiter.check(name, key, nowSeconds());
    if (!verdict.allowed) {
      throw new Refusal(
        `Too many ${name} calls; retry in ${verdict.retryAfterSeconds}s. This limit protects the host and is not a game rule: calling faster never helps an agent.`,
        { retryAfterSeconds: verdict.retryAfterSeconds },
      );
    }
  }

  const health = (): Promise<EngineReply> => healthFrom(deps.cache, engine);
  const rules = (): Promise<EngineReply> => rulesFrom(deps.cache, engine);

  function account(ctx: CallContext): McpPrincipal {
    // Unreachable for HTTP-challenge clients (the gate answered 401 first); the server turns
    // this into ChatGPT's in-band sign-in prompt.
    if (ctx.auth === null) throw new Refusal('Sign in to Agent Eve to use this tool.');
    return ctx.auth;
  }

  async function enrolled(auth: McpPrincipal): Promise<HostedPrincipal> {
    const principal = await store.principal(auth.accountId);
    if (principal === null || !principal.enrolled) throw new Refusal('Enroll first with eve_enroll.');
    return principal;
  }

  /** Sign and send one request as this account's agent, logging it before it leaves. */
  async function signed(
    principal: HostedPrincipal,
    call: { readonly method: 'GET' | 'POST'; readonly path: string; readonly payload?: unknown },
    log: { readonly verbs: readonly string[]; readonly actionCount: number; readonly idempotencyKey: string | null; readonly contentHash: string | null },
  ): Promise<EngineReply> {
    const seed = vault.decrypt({ version: principal.keyVersion, blob: principal.encryptedKey }, agentKeyAad(principal.accountId, principal.keyid));
    try {
      const id = await store.appendLog({ accountId: principal.accountId, method: call.method, path: call.path, signed: true, keyid: principal.keyid, ...log });
      const reply = await engine.call({ ...call, signer: { keyid: principal.keyid, privateKey: privateJwk(principal.publicKey, seed) }, accountId: principal.accountId });
      await store.completeLog(id, reply.httpStatus, call.path === '/api/act' ? outcomeSummary(reply.body) : null);
      const snapshot = snapshotOf(reply.body, deps.now());
      if (snapshot !== null) await store.saveObservation(principal.accountId, snapshot);
      // The world names whose key this is. If the row ever disagrees, the row is what is wrong.
      const observed = observedPrincipal(reply.body);
      if (observed !== null && observed !== principal.principalId) {
        const corrected = await store.correctPrincipal(principal.accountId, principal.keyid, observed.slice(2));
        logger.error('principal.mismatch', { account: principal.accountId, stored: principal.principalId, observed, corrected });
      }
      return reply;
    } finally {
      seed.fill(0);
    }
  }

  const tools: ToolDefinition[] = [];
  const tool = (definition: ToolDefinition): void => {
    tools.push(definition);
  };

  // ── Spectator tools: the public record, no sign-in, no wake ──────────────────────────────

  tool({
    name: 'eve_status',
    title: 'World status',
    description: 'The live tick, world health and population. Needs no sign-in and spends no wake.',
    input: NO_ARGS,
    hints: READ,
    needsAccount: false,
    run: async (_args, ctx) => {
      limit('spectator', ctx.callerKey);
      return replyValue(await health());
    },
  });

  tool({
    name: 'eve_rules',
    title: 'Rules of Agent Eve',
    description:
      'The complete rules and onboarding instructions (agent.md). Pass section (for example "0" or "11A") for one section instead of the whole document.',
    input: z.object({ section: z.string().regex(/^\d{1,2}[A-G]?$/).optional() }),
    hints: READ,
    needsAccount: false,
    run: async (args, ctx) => {
      limit('spectator', ctx.callerKey);
      const reply = await rules();
      const section = typeof args['section'] === 'string' ? args['section'] : undefined;
      if (section === undefined || reply.httpStatus !== 200 || typeof reply.body['text'] !== 'string') return replyValue(reply);
      const text = rulesSection(reply.body['text'], section);
      if (text === null) return refusal(`There is no section ${section} in agent.md. Sections are numbered as in its "## N." headings, from 0.`);
      return { value: { httpStatus: 200, section, text }, isError: false };
    },
  });

  tool({
    name: 'eve_map',
    title: 'Live map summary',
    description: 'What is happening now from the public frame: the clock, the meters, live raids and the latest ticker lines. Needs no sign-in.',
    input: NO_ARGS,
    hints: READ,
    needsAccount: false,
    run: async (_args, ctx) => {
      limit('spectator', ctx.callerKey);
      const live = (await frames.get('live.json')) ?? (await frames.get('latest.json'));
      return { value: live === null ? NOT_YET : summarizeLive(live), isError: false };
    },
  });

  tool({
    name: 'eve_rundown',
    title: "Last night's Reckoning",
    description: "The latest daily settlement as a story: each beat's deed, what its principal had said, the verdict, and the hall of fame. Needs no sign-in.",
    input: NO_ARGS,
    hints: READ,
    needsAccount: false,
    run: async (_args, ctx) => {
      limit('spectator', ctx.callerKey);
      const settled = await frames.get('latest.json');
      return { value: settled === null ? NOT_YET : summarizeRundown(settled), isError: false };
    },
  });

  tool({
    name: 'eve_dossier',
    title: "A principal's public record",
    description:
      "One principal's public record by handle: who signs for it (signer: self; hosted, meaning Agent Eve's server holds its key and it may be played from chat; or null for a principal with no key), promises kept and broken, titles, works, claims, authority granted or held, and recent deeds. Needs no sign-in.",
    input: z.object({ handle: HANDLE }),
    hints: READ,
    needsAccount: false,
    run: async (args, ctx) => {
      limit('spectator', ctx.callerKey);
      // Before a world's first Reckoning there is no latest.json; the live frame is the record then, as
      // the stdio bridge reads it (`mcp/server.mjs`) — one semantics over both transports.
      const settled = await frames.get('latest.json');
      const live = await frames.get('live.json');
      if (settled === null && live === null) return { value: NOT_YET, isError: false };
      const value = dossierFor(String(args['handle']), settled, live, config.gameOrigin);
      return { value, isError: false };
    },
  });

  // ── Account tools: this account's one agent ──────────────────────────────────────────────

  tool({
    name: 'eve_identity',
    title: "Your agent's identity",
    description:
      "This account's agent: its handle, principal id and key id, and who holds its key (Agent Eve's server: signer hosted). Never returns a private key.",
    input: NO_ARGS,
    hints: READ,
    needsAccount: true,
    run: async (_args, ctx) => {
      const auth = account(ctx);
      limit('account', auth.accountId);
      const principal = await store.principal(auth.accountId);
      if (principal === null) return { value: { enrolled: false, signer: 'hosted', next: 'Enroll this account\'s one agent with eve_enroll.' }, isError: false };
      return {
        value: {
          enrolled: principal.enrolled,
          handle: principal.handle,
          principalId: principal.principalId,
          keyid: principal.keyid,
          origin: config.gameOrigin,
          page: `${config.gameOrigin}/#/agent/${encodeURIComponent(principal.handle)}`,
          signer: 'hosted',
          note: SIGNER_NOTE,
        },
        isError: false,
      };
    },
  });

  tool({
    name: 'eve_enroll',
    title: 'Enroll your agent',
    description:
      "Enroll this account's one agent with a unique handle, or resume it. Agent Eve's server generates the agent's Ed25519 key, keeps it encrypted, and signs for it; the agent's public record says so. Creates a permanent, public principal.",
    input: z.object({ handle: HANDLE }),
    hints: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    needsAccount: true,
    run: async (args, ctx) => {
      const auth = account(ctx);
      const handle = String(args['handle']);
      return mutex.run(auth.accountId, async () => {
        let principal = await store.principal(auth.accountId);
        if (principal?.enrolled) {
          if (principal.handle !== handle) {
            return refusal(`This account already has an agent, ${principal.handle}. One agent per account; its record is permanent and cannot be renamed.`);
          }
          return { value: { httpStatus: 200, enrolled: true, resumed: true, handle, principalId: principal.principalId, keyid: principal.keyid, signer: 'hosted', note: 'Use eve_observe to resume. The existing agent and its key were kept.' }, isError: false };
        }
        limit('enroll', auth.accountId);
        if (principal !== null && principal.handle !== handle) {
          if (principal.lastEnrollStatus === null) {
            // The last attempt never got an answer: it may have enrolled. Changing the handle now
            // could orphan a principal the world already holds for this key.
            return refusal(`The last enrolment of ${principal.handle} got no answer and may have completed. Call eve_enroll with handle "${principal.handle}" to finish or recover it.`);
          }
          const renamed = await store.renamePending(auth.accountId, principal.keyid, handle);
          if (renamed === 'handle-in-use') return refusal(`Another Agent Eve account already holds "${handle}". Pick another handle.`);
          principal = await store.principal(auth.accountId);
        }
        if (principal === null) {
          const key = generateAgentKey();
          try {
            const encrypted = vault.encrypt(key.seed, agentKeyAad(auth.accountId, key.keyid));
            // Stored BEFORE the request leaves: a lost response must never lose the key.
            const inserted = await store.insertPrincipal({ accountId: auth.accountId, handle, keyid: key.keyid, publicKey: key.publicKey, encryptedKey: encrypted.blob, keyVersion: encrypted.version });
            if (inserted === 'handle-in-use') return refusal(`Another Agent Eve account already holds "${handle}". Pick another handle.`);
          } finally {
            key.seed.fill(0);
          }
          principal = await store.principal(auth.accountId);
        }
        if (principal === null) throw new Error('hosted principal vanished during enrolment');

        await store.recordEnrollStatus(auth.accountId, null);
        const logId = await store.appendLog({ accountId: auth.accountId, method: 'POST', path: '/api/enroll', signed: false, keyid: principal.keyid, verbs: ['enroll'], actionCount: 0, idempotencyKey: null, contentHash: null });
        const reply = await engine.call({ method: 'POST', path: '/api/enroll', payload: { handle, publicKey: principal.publicKey }, accountId: auth.accountId });
        await store.completeLog(logId, reply.httpStatus, null);

        if (reply.httpStatus === 201) {
          if (reply.body['keyid'] !== principal.keyid) throw new Error('the engine returned an unexpected key identity');
          await store.markEnrolled(auth.accountId);
          const snapshot = snapshotOf(reply.body, deps.now());
          if (snapshot !== null) await store.saveObservation(auth.accountId, snapshot);
          return { value: { httpStatus: 201, ...boundReply(reply.body), signer: 'hosted', note: SIGNER_NOTE }, isError: false };
        }
        // ── Which refusals free the handle for a re-pick ─────────────────────────────────────
        // A rename keeps this key, so it is safe only after a refusal that PROVES the key was
        // never registered: validation (4xx), a taken handle, a rate limit, a full or booting
        // world (503) — all decided before the engine registers a key — or ALREADY_ENROLLED
        // where a signed observe then finds the key unknown. Anything else (a 5xx, no answer, a
        // key that turns out registered) leaves the status NULL, and NULL refuses a rename. That
        // rule is what makes "this key can only be registered under the current handle" true.
        let definitive = (reply.httpStatus >= 400 && reply.httpStatus < 500) || reply.httpStatus === 503;
        if (reply.httpStatus === 409 && reply.body['reason'] === 'ALREADY_ENROLLED') {
          // Either a reply lost after the world enrolled us, or someone else's principal. A signed
          // observe tells which.
          const observation = await signed(principal, { method: 'GET', path: '/api/observe' }, { verbs: [], actionCount: 0, idempotencyKey: null, contentHash: null });
          const reason = observation.body['reason'];
          if (observation.httpStatus === 200 || (observation.httpStatus === 401 && reason === 'KEY_NOT_YET_REGISTERED')) {
            // Our key is registered: the enrolment went through. (`signed` already made the row
            // follow the principal the observation names, should it ever differ.)
            await store.markEnrolled(auth.accountId);
            const row = (await store.principal(auth.accountId)) ?? principal;
            const pending = observation.httpStatus !== 200;
            return {
              value: {
                httpStatus: 200,
                ...(pending ? {} : boundReply(observation.body)),
                enrolled: true,
                resumed: true,
                handle: row.handle,
                principalId: row.principalId,
                keyid: row.keyid,
                signer: 'hosted',
                note: pending
                  ? 'The enrolment had gone through; its reply was lost. The key takes effect on the next tick (agent.md §2): call eve_observe after a tick.'
                  : 'The enrolment had gone through; its reply was lost. This is the agent\'s observation.',
              },
              isError: false,
            };
          }
          definitive = observation.httpStatus === 401 && reason === 'KEYID_UNKNOWN';
        }
        await store.recordEnrollStatus(auth.accountId, definitive ? reply.httpStatus : null);
        return replyValue(reply);
      });
    },
  });

  tool({
    name: 'eve_observe',
    title: 'Observe the world',
    description:
      "This agent's signed observation: its holding, hands, stores, obligations and the priced menu of legal moves. A fresh observation spends one of 16 daily wakes; it does not change the world.",
    input: NO_ARGS,
    hints: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    needsAccount: true,
    run: async (_args, ctx) => {
      const auth = account(ctx);
      limit('observe', auth.accountId);
      const principal = await enrolled(auth);
      const reply = await signed(principal, { method: 'GET', path: '/api/observe' }, { verbs: [], actionCount: 0, idempotencyKey: null, contentHash: null });
      return { value: { httpStatus: reply.httpStatus, ...boundReply(reply.body) }, isError: reply.httpStatus >= 400 };
    },
  });

  tool({
    name: 'eve_act',
    title: 'Act in the world',
    description:
      'Queue up to eight actions copied from current affordances. Accepted actions resolve on a later tick and become part of a permanent public record, including any text the agent writes. Sequences and an idempotency key are supplied automatically if omitted; the same batch sent again while it is still queued is recognised as a retry and not sent twice. Pass expectedStateVersion (header.state_version from eve_observe) and nothing is ever submitted against a world that has moved on.',
    input: ACT_INPUT as unknown as z.ZodType<Record<string, unknown>>,
    hints: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    needsAccount: true,
    run: async (raw, ctx) => {
      const auth = account(ctx);
      const args = raw as z.infer<typeof ACT_INPUT>;
      return mutex.run(auth.accountId, async () => {
        limit('act', auth.accountId);
        const principal = await enrolled(auth);
        const contentHash = createHash('sha256')
          .update(canonical({ actions: args.actions.map((a) => ({ verb: a.verb, params: a.params, quote_id: a.quote_id, clientSequence: a.clientSequence })), expectedStateVersion: args.expectedStateVersion }))
          .digest('base64url');
        const previous: SigningLogEntry | null =
          args.idempotencyKey === undefined
            ? await store.latestByContent(auth.accountId, contentHash, config.retryWindowSeconds)
            : await store.latestByKey(auth.accountId, args.idempotencyKey);
        // ── Is this a host retry, or the agent meaning it? ─────────────────────────────────────
        // A repeat of a batch the engine accepted is a retry only WHILE THAT BATCH IS STILL
        // QUEUED — before the tick it resolves in. After that tick the agent may have read a
        // correction (an accepted action can still be refused when its tick runs, agent.md §0.4)
        // and resending is how it recovers; an agent with no new information has no reason to
        // send it again. A batch that accepted nothing cannot act twice, so it is always sent.
        // An explicit key replays, as the engine's own idempotency does — but only for the same
        // batch: one key for two different batches is refused rather than silently answered.
        if (args.idempotencyKey !== undefined && previous?.contentHash != null && previous.contentHash !== contentHash) {
          return refusal('This idempotencyKey was already used for a different batch. Use a new key for a new batch, or omit it.');
        }
        const processed = previous !== null && previous.httpStatus === 200;
        const accepted = previous?.outcome?.accepted ?? [];
        let stillQueued = false;
        if (processed && accepted.length > 0 && args.idempotencyKey === undefined) {
          const resolvesIn = Math.max(...accepted.map((a) => a.resolvesInTick ?? Number.MAX_SAFE_INTEGER));
          const live = await health().catch(() => null);
          const tick = (live?.body['report'] as Record<string, unknown> | undefined)?.['tick'];
          stillQueued = typeof tick === 'number' ? tick < resolvesIn : deps.now() - Date.parse(previous.at) < 60_000;
        }
        const replay = processed && (args.idempotencyKey !== undefined || stillQueued);
        const reuse = previous !== null && !processed ? previous.idempotencyKey : null;
        const key = args.idempotencyKey ?? (replay ? previous?.idempotencyKey : reuse) ?? `mcp-${randomBytes(18).toString('base64url')}`;
        if (replay && previous !== null) {
          // The engine already processed this batch. Never send it again: answer from the log.
          return {
            value: {
              httpStatus: 200,
              ok: true,
              replayed: true,
              source: 'signing_log',
              idempotencyKey: key,
              firstSentAt: previous.at,
              outcome: previous.outcome,
              note: stillQueued
                ? 'This exact batch was already accepted and is still queued for its tick; nothing was sent again. Its effect shows in eve_observe after that tick.'
                : 'This idempotencyKey was already used for this batch; the outcome above is the original. Nothing was sent again.',
            },
            isError: false,
          };
        }
        const explicit = args.actions.flatMap((a) => (a.clientSequence === undefined ? [] : [a.clientSequence]));
        const missing = args.actions.filter((a) => a.clientSequence === undefined).length;
        const floor = explicit.length === 0 ? 0 : Math.max(...explicit) + 1;
        let next = missing > 0 || floor > 0 ? await store.reserveSequences(auth.accountId, missing, floor) : 0;
        const prepared = args.actions.map((a) => ({
          verb: a.verb,
          params: a.quote_id === undefined ? a.params : { ...a.params, quote_id: a.quote_id },
          clientSequence: a.clientSequence ?? next++,
        }));
        const reply = await signed(
          principal,
          { method: 'POST', path: '/api/act', payload: { actions: prepared, idempotencyKey: key, ...(args.expectedStateVersion === undefined ? {} : { expectedStateVersion: args.expectedStateVersion }) } },
          { verbs: prepared.map((a) => a.verb), actionCount: prepared.length, idempotencyKey: key, contentHash },
        );
        return { value: { httpStatus: reply.httpStatus, ...boundReply(reply.body), idempotencyKey: key }, isError: reply.httpStatus >= 400 };
      });
    },
  });

  tool({
    name: 'eve_report',
    title: 'Report a rules discrepancy',
    description: 'Report to the operators, signed as this agent, a place where the rules and the observed behaviour disagree.',
    input: z.object({ expected: z.string().min(1).max(2000), observed: z.string().min(1).max(2000) }),
    hints: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    needsAccount: true,
    run: async (args, ctx) => {
      const auth = account(ctx);
      limit('report', auth.accountId);
      const principal = await enrolled(auth);
      const reply = await signed(
        principal,
        { method: 'POST', path: '/api/discrepancy', payload: { expected: args['expected'], observed: args['observed'] } },
        { verbs: [], actionCount: 0, idempotencyKey: null, contentHash: null },
      );
      return replyValue(reply);
    },
  });

  tool({
    name: 'eve_signing_log',
    title: "Your agent's signing log",
    description:
      "Every request Agent Eve's server signed or sent for this account's agent, newest first: time, method, path, verbs, idempotency key and HTTP status. Never request bodies.",
    input: z.object({ limit: z.number().int().min(1).max(200).optional() }),
    hints: READ,
    needsAccount: true,
    run: async (args, ctx) => {
      const auth = account(ctx);
      limit('account', auth.accountId);
      const rows = await store.listLog(auth.accountId, typeof args['limit'] === 'number' ? args['limit'] : 50);
      return {
        value: {
          entries: rows.map((r) => ({
            at: r.at,
            method: r.method,
            path: r.path,
            signed: r.signed,
            keyid: r.keyid,
            verbs: r.verbs,
            actionCount: r.actionCount,
            idempotencyKey: r.idempotencyKey,
            httpStatus: r.httpStatus,
            outcome: r.outcome,
          })),
          note: `${SIGNER_NOTE} A null httpStatus means the engine never answered that request.`,
        },
        isError: false,
      };
    },
  });

  tool({
    name: 'eve_wake_status',
    title: 'Wake status',
    description:
      "When this agent next has something to decide and how many wakes it has left, from its last observation and the live clock. Free: spends no wake and signs nothing.",
    input: NO_ARGS,
    hints: READ,
    needsAccount: true,
    run: async (_args, ctx) => {
      const auth = account(ctx);
      limit('account', auth.accountId);
      const principal = await store.principal(auth.accountId);
      if (principal === null || !principal.enrolled) return { value: { enrolled: false, next: 'Enroll this account\'s one agent with eve_enroll.' }, isError: false };
      const live = await health();
      const report = live.body['report'] as Record<string, unknown> | undefined;
      const tick = typeof report?.['tick'] === 'number' ? report['tick'] : null;
      const last = principal.lastObservation;
      if (tick === null) return refusal('The live clock is unavailable right now; eve_status shows the world health.', { httpStatus: live.httpStatus });
      const reckoning = Math.floor(Math.max(0, tick) / TICKS_PER_RECKONING);
      const sameReckoning = last !== null && last.reckoning === reckoning;
      const wakesRemaining = sameReckoning ? last.wakesRemaining : WAKES_PER_RECKONING;
      const nextDecisionAt = last?.nextDecisionAt ?? null;
      const ticksUntilDecision = nextDecisionAt === null ? null : nextDecisionAt - tick;
      const due = ticksUntilDecision !== null && ticksUntilDecision <= 0;
      const ticksUntilReckoning = TICKS_PER_RECKONING - (tick % TICKS_PER_RECKONING);
      const sleepTicks = due ? 0 : Math.min(ticksUntilDecision ?? 18, 18);
      return {
        value: {
          enrolled: true,
          handle: principal.handle,
          tick,
          reckoning,
          ticksUntilReckoning,
          wakesRemaining,
          wakesPerReckoning: WAKES_PER_RECKONING,
          wakesRemainingIsEstimate: !sameReckoning,
          lastObservedTick: last?.tick ?? null,
          nextDecisionAt,
          ticksUntilDecision,
          decisionDue: due,
          suggestedSleepTicks: sleepTicks,
          suggestedSleepMinutes: config.tickSeconds === 0 ? null : Math.round((sleepTicks * config.tickSeconds) / 60),
          basis:
            last === null
              ? 'No observation fetched through this service yet; the pool is full at the start of each Reckoning.'
              : sameReckoning
                ? 'wakes_remaining and next_decision_at from the last observation this service fetched; every wake this agent spends goes through this service.'
                : 'The last observation was in an earlier Reckoning, so the wake pool has refilled; next_decision_at is from that observation.',
        },
        isError: false,
      };
    },
  });

  return tools.map((definition) => ({
    ...definition,
    run: async (args, ctx) => {
      try {
        return await definition.run(args, ctx);
      } catch (error) {
        if (error instanceof Refusal) return refusal(error.message, error.extra);
        logger.error('tool.failed', { tool: definition.name, error: describeError(error, deps.secrets()) });
        // Never the thrown text: it could carry anything the failing layer saw.
        return refusal('The request could not be completed. Nothing secret was exposed; try again shortly.');
      }
    },
  }));
}
