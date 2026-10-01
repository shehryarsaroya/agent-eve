/**
 * Follow by email, assembled from the environment — the only place its settings are read.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **OFF BY DEFAULT, AND OFF LOUDLY.** Sending needs BOTH `RESEND_API_KEY` (the provider) and
 * `COMPACT_FOLLOW_SECRET` (the unsubscribe-token key). With either missing the feature is off:
 * `POST /api/follow` answers `503 FOLLOW_DISABLED` naming the missing variable, the worker
 * sends nothing, and the process says so once at boot. Nothing crashes and nothing guesses.
 *
 * The confirm and unsubscribe links keep working with sending OFF, because they need only the
 * store. An operator who switches mail off must not strand anyone who wants out.
 *
 * Every variable is read here and nowhere else in the feature, and the key only as a
 * PRESENCE test (`mailKeyPresent`) — its value is read by `mailer.ts`, at each send, and by
 * nothing else in this codebase.
 * ══════════════════════════════════════════════════════════════════════════
 */

import type { Clock } from '../../core/time.js';
import {
  FOLLOW_LIMITS,
  FOLLOW_MAX_PER_EMAIL_DEFAULT,
  MAIL_DAILY_CEILING_DEFAULT,
  MAIL_SEND_INTERVAL_MS,
  RateLimiter,
} from '../limits.js';
import { domainOfFrom, IDENTITY_LABEL_DOMAINS } from './email.js';
import { describeMailFailure, mailKeyPresent, pacedMailer, realSleep, resendMailer, type Mailer } from './mailer.js';
import { PgFollowStore } from './postgres.js';
import { FollowService, utcDay } from './service.js';
import { InMemoryFollowStore, type FollowStore } from './store.js';
import { MIN_SECRET_LENGTH } from './tokens.js';
import { RecapWorker } from './worker.js';

/** The variables, by NAME. Listed in `docs/background/INFRA.md`; values never appear anywhere. */
export const FOLLOW_ENV = {
  key: 'RESEND_API_KEY',
  secret: 'COMPACT_FOLLOW_SECRET',
  from: 'COMPACT_MAIL_FROM',
  publicUrl: 'COMPACT_PUBLIC_URL',
  dailyCeiling: 'COMPACT_MAIL_DAILY_LIMIT',
  maxPerEmail: 'COMPACT_FOLLOW_MAX_PER_EMAIL',
} as const;

export const DEFAULT_MAIL_FROM = 'Agent Eve <updates@agenteve.io>';
export const DEFAULT_PUBLIC_URL = 'https://agenteve.io';

export interface FollowConfig {
  /** True when a confirmation can be sent: a key, a secret, and frames to recap. */
  readonly sending: boolean;
  /** Why not, naming the variable an operator must set. Null when sending. */
  readonly offReason: string | null;
  readonly from: string;
  readonly publicUrl: string;
  readonly dailyCeiling: number;
  readonly maxActivePerEmail: number;
  /** The unsubscribe-token key, when configured. Held in memory only; never logged. */
  readonly secret: string | null;
  /** Problems with the settings that were present, each one sentence. Printed at boot. */
  readonly warnings: readonly string[];
}

/**
 * Read the settings. Total: a malformed number is reported and the default used, because a
 * typo in a ceiling must not silently become "unlimited" and must not stop the world either.
 */
export function followConfigFromEnv(
  env: Readonly<Record<string, string | undefined>>,
  framesDir: string | null,
): FollowConfig {
  const warnings: string[] = [];
  const from = (env[FOLLOW_ENV.from] ?? '').trim() || DEFAULT_MAIL_FROM;
  if (domainOfFrom(from) === null) {
    warnings.push(`${FOLLOW_ENV.from} has no @domain; it should look like "${DEFAULT_MAIL_FROM}".`);
  }
  const rawUrl = (env[FOLLOW_ENV.publicUrl] ?? '').trim() || DEFAULT_PUBLIC_URL;
  const publicUrl = originOf(rawUrl);
  if (publicUrl === null) {
    warnings.push(
      `${FOLLOW_ENV.publicUrl} must be an https:// origin with no path (http:// only for localhost); using ${DEFAULT_PUBLIC_URL}.`,
    );
  }
  const dailyCeiling = positiveInt(env[FOLLOW_ENV.dailyCeiling], MAIL_DAILY_CEILING_DEFAULT, FOLLOW_ENV.dailyCeiling, warnings);
  const maxActivePerEmail = positiveInt(env[FOLLOW_ENV.maxPerEmail], FOLLOW_MAX_PER_EMAIL_DEFAULT, FOLLOW_ENV.maxPerEmail, warnings);

  const secretRaw = (env[FOLLOW_ENV.secret] ?? '').trim();
  const secret = secretRaw.length >= MIN_SECRET_LENGTH ? secretRaw : null;
  if (secretRaw.length > 0 && secret === null) {
    warnings.push(`${FOLLOW_ENV.secret} is shorter than ${String(MIN_SECRET_LENGTH)} characters and was ignored.`);
  }

  const offReason = !mailKeyPresent(env)
    ? `${FOLLOW_ENV.key} is not set, so this world sends no mail.`
    : secret === null
      ? `${FOLLOW_ENV.secret} is not set (${String(MIN_SECRET_LENGTH)}+ random characters), so no unsubscribe link could be signed.`
      : framesDir === null
        ? 'this world publishes no frames (COMPACT_FRAMES_DIR is unset), so there is nothing to recap.'
        : null;

  return {
    sending: offReason === null,
    offReason,
    from,
    publicUrl: publicUrl ?? DEFAULT_PUBLIC_URL,
    dailyCeiling,
    maxActivePerEmail,
    secret,
    warnings,
  };
}

/**
 * The origin every emailed link is built on, or null. An https origin with no path, query or
 * fragment — the links append their own path — and plain http only for a local world.
 */
function originOf(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) return null;
  if ((url.pathname !== '/' && url.pathname !== '') || url.search !== '' || url.hash !== '') return null;
  if (url.username !== '' || url.password !== '') return null;
  return url.origin;
}

function positiveInt(raw: string | undefined, fallback: number, name: string, warnings: string[]): number {
  if (raw === undefined || raw.trim().length === 0) return fallback;
  const n = Number(raw.trim());
  if (!Number.isSafeInteger(n) || n < 1) {
    warnings.push(`${name}='${raw.slice(0, 32)}' is not a positive integer; using ${String(fallback)}.`);
    return fallback;
  }
  return n;
}

/** Everything `serve()` holds for this feature. */
export interface FollowSetup {
  readonly config: FollowConfig;
  readonly service: FollowService;
  readonly recaps: RecapWorker;
  health(): FollowHealth;
  close(): Promise<void>;
}

/** What `/health` says about mail. Informational: a mail outage never makes the WORLD unhealthy. */
export interface FollowHealth {
  readonly sending: boolean;
  readonly off_reason: string | null;
  readonly store: 'postgres' | 'memory';
  readonly confirmations_sent: number;
  readonly confirmations_failed: number;
  readonly recaps_sent: number;
  readonly recaps_failed: number;
  readonly last_recap_reckoning: number | null;
  readonly last_recap_run: string | null;
  /** Redacted: no address, no token, no key. */
  readonly last_error: string | null;
}

export interface CreateFollowOptions {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly clock: Clock;
  readonly framesDir: string | null;
  /** A store to use as-is (tests). Otherwise built from `database`. */
  readonly store?: FollowStore;
  /** Where the world's durable journal lives. Null: in-memory, with a warning. */
  readonly database?: { readonly connectionString: string | null } | null;
  /** A mailer to use instead of Resend (tests). Still wrapped in the pacer. */
  readonly mailer?: Mailer;
  readonly principalExists?: (handle: string) => boolean;
  readonly log?: (line: string) => void;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly schedule?: (run: () => void, ms: number) => { cancel(): void };
}

export function createFollow(options: CreateFollowOptions): FollowSetup {
  const log = options.log ?? ((line: string) => process.stderr.write(`${line}\n`));
  const config = followConfigFromEnv(options.env, options.framesDir);
  for (const w of config.warnings) log(`compact: follow by email — ${w}`);

  const store =
    options.store ??
    (options.database === null || options.database === undefined
      ? new InMemoryFollowStore()
      : new PgFollowStore(
          options.database.connectionString === null ? {} : { connectionString: options.database.connectionString },
        ));
  if (options.store === undefined && store.kind === 'memory') {
    log(
      'compact: follow by email — WARNING: no database is configured, so follows are kept in memory ' +
        'and are LOST at the next restart.',
    );
  }

  const nowMs = (): number => options.clock.nowMs();
  const inner = options.mailer ?? resendMailer({ from: config.from });
  // ONE pacer for the process: confirmations and recaps share the provider's rate.
  const mailer: Mailer | null = config.sending
    ? pacedMailer(inner, { intervalMs: MAIL_SEND_INTERVAL_MS, nowMs, sleep: options.sleep ?? realSleep })
    : null;

  const service = new FollowService({
    store,
    mailer,
    offReason: config.offReason,
    secret: config.secret,
    clock: options.clock,
    publicUrl: config.publicUrl,
    dailyCeiling: config.dailyCeiling,
    maxActivePerEmail: config.maxActivePerEmail,
    limiter: new RateLimiter(FOLLOW_LIMITS),
    refusedDomains: refusedDomainsFor(config),
    log,
  });
  const recaps = new RecapWorker({
    store,
    mailer,
    secret: config.secret,
    framesDir: options.framesDir,
    publicUrl: config.publicUrl,
    clock: options.clock,
    dailyCeiling: config.dailyCeiling,
    log,
    ...(options.principalExists === undefined ? {} : { principalExists: options.principalExists }),
    ...(options.schedule === undefined ? {} : { schedule: options.schedule }),
  });

  log(
    config.sending
      ? `compact: follow by email is ON — from ${config.from}, links at ${config.publicUrl}, ` +
          `${String(config.dailyCeiling)} emails a day at most, ${store.kind} store`
      : `compact: follow by email is OFF — ${config.offReason ?? ''} Confirm and unsubscribe links still work.`,
  );
  // A database whose migration has not run has no follow tables, and every follow request would
  // then be a 500. Said once, at boot, in the sentence an operator needs — never a crash.
  if (store.kind === 'postgres') {
    store
      .mailReserved(utcDay(options.clock.nowMs()))
      .catch((error: unknown) => {
        log(
          `compact: follow by email — WARNING: the follow tables are not readable (${describeMailFailure(error)}). ` +
            'Run the migration (migrate.js, schema migration 2) before relying on it.',
        );
      });
  }

  return {
    config,
    service,
    recaps,
    health: (): FollowHealth => {
      const s = service.counts();
      const w = recaps.health();
      return {
        sending: service.sending,
        off_reason: service.offReason,
        store: store.kind,
        confirmations_sent: s.confirmationsSent,
        confirmations_failed: s.confirmationsFailed,
        recaps_sent: w.sent,
        recaps_failed: w.failed,
        last_recap_reckoning: w.lastReckoning,
        last_recap_run: w.lastEnd,
        last_error: w.lastError ?? s.lastError,
      };
    },
    close: async (): Promise<void> => {
      await recaps.close();
      await service.close();
      await store.close();
    },
  };
}

/** Refuse domains this world's own sending address is on, plus the identity-label domains. */
export function refusedDomainsFor(config: FollowConfig): readonly string[] {
  const out = [...IDENTITY_LABEL_DOMAINS];
  const d = domainOfFrom(config.from);
  if (d !== null && !out.includes(d)) out.push(d);
  return out;
}
