/**
 * ★ HOSTED KEYS — which keys Agent Eve's own server signs with, so every principal's SIGNER can be
 * published (SPEC §3, `identity/signer.ts`).
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **OUTSIDE THE WORLD, ON PURPOSE.** Season 1 is live, and anything hashed or captured is a rules
 * change that would force a declared divergence. So the fact lives where the follow-by-email tables
 * live — its own durable table (`hosted_key`, migration 3 in `db/schema.sql`), its own small pool, never
 * read by boot's replay, never in a snapshot, never in `state_hash` — and the runtime never sees it. The
 * frames and the observation read it beside the world through {@link HostedSigners.lookup}, the way
 * `modelBadges` is read. `test/api/signer-is-not-in-the-world.spec.ts` proves the hash streams match
 * with every principal hosted and with none.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * **How a key becomes hosted.** Only through a request whose gateway header verified (`api/gateway.ts`):
 * the enrolment that registered the key, or any later request the key signed. Nobody but Agent Eve's
 * connector can produce a verified gateway header, and the connector signs only with keys it generated
 * and holds, so a verified request signed by K proves the server holds K. Recording it again on later
 * requests costs nothing (a set lookup) and heals the one gap the asynchronous write leaves: a hosted
 * row lost to a crash before it was durable is written back by that principal's next chat request.
 *
 * **Append-only by grant** (`db/migrate.ts`), like the record's own tables: a key the server held stays
 * a key the server held, so nothing ever UPDATEs or DELETEs a row — and the process that writes the
 * disclosure must not be able to quietly take it back. A new season truncates it with the world, as an
 * owner (`deploy/new-season-standalone.sh`, WORLD_TABLES).
 *
 * **Durable by retry, never by blocking the route.** {@link HostedSigners.markHosted} updates the set at
 * once — the enrol response already says `signer: hosted` — and queues the row; {@link flush} writes the
 * queue in order, single-flight, keeping a failed row at the head to retry (on the next mark, on every
 * tick, and on a clean shutdown). Sustained failure is reported, never swallowed: `/health`'s `signers`
 * block counts what is not yet durable and fails the check after three straight failed writes.
 */

import { Pool } from 'pg';
import type { PrincipalId } from '../core/types.js';
import { signerAt, type KeyHistory, type Signer, type SignerLookup } from '../identity/signer.js';

/** One key the server signs with. */
export interface HostedKeyRecord {
  readonly keyid: string;
  readonly principal: PrincipalId;
  /** The tick the engine first recorded it. For an enrolment, the key's own first tick. Audit only. */
  readonly recordedAtTick: number;
  /** Wall-clock milliseconds, from the injected clock. Audit only. */
  readonly recordedMs: number;
}

export interface HostedKeyStore {
  readonly kind: 'memory' | 'postgres';
  /** Every recorded key. Read once at boot, before the replay republishes a frame. */
  hostedKeys(): Promise<readonly HostedKeyRecord[]>;
  /** Record one. Idempotent on `keyid`: a second write of the same key changes nothing. */
  recordHostedKey(row: HostedKeyRecord): Promise<void>;
  close(): Promise<void>;
}

/** The test and local-world store. Same semantics as Postgres, including first-write-wins. */
export class InMemoryHostedKeyStore implements HostedKeyStore {
  readonly kind = 'memory' as const;
  private readonly rows = new Map<string, HostedKeyRecord>();

  hostedKeys(): Promise<readonly HostedKeyRecord[]> {
    return Promise.resolve([...this.rows.values()]);
  }

  recordHostedKey(row: HostedKeyRecord): Promise<void> {
    if (!this.rows.has(row.keyid)) this.rows.set(row.keyid, row);
    return Promise.resolve();
  }

  close(): Promise<void> {
    return Promise.resolve();
  }
}

export interface PgHostedKeyStoreOptions {
  /** libpq connection string, or undefined to use the `PG*` environment variables. */
  readonly connectionString?: string;
  /** An existing pool, for tests. Takes precedence over the string and is not closed by us. */
  readonly pool?: Pool;
}

/** Connections this store may hold. One write per enrolment through the connector; it must stay out of the way. */
export const HOSTED_KEY_POOL_SIZE = 2;

/**
 * The Postgres store. Written the way `persist/postgres.ts` and `follow/postgres.ts` are: every
 * identifier is a literal here and every value a bound parameter. Its own small pool, so a slow
 * disclosure write can never queue in front of a tick's durable write.
 */
export class PgHostedKeyStore implements HostedKeyStore {
  readonly kind = 'postgres' as const;
  private readonly pool: Pool;
  private readonly ownsPool: boolean;

  constructor(options: PgHostedKeyStoreOptions = {}) {
    if (options.pool !== undefined) {
      this.pool = options.pool;
      this.ownsPool = false;
    } else {
      this.pool = new Pool({
        ...(options.connectionString === undefined ? {} : { connectionString: options.connectionString }),
        max: HOSTED_KEY_POOL_SIZE,
      });
      this.ownsPool = true;
    }
  }

  async hostedKeys(): Promise<readonly HostedKeyRecord[]> {
    const { rows } = await this.pool.query<HostedKeyRow>(
      `SELECT keyid, principal, recorded_at_tick, recorded_ms FROM hosted_key ORDER BY keyid COLLATE "C"`,
    );
    return rows.map((r) => ({
      keyid: r.keyid,
      principal: r.principal as PrincipalId,
      recordedAtTick: Number(r.recorded_at_tick),
      recordedMs: Number(r.recorded_ms),
    }));
  }

  async recordHostedKey(row: HostedKeyRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO hosted_key (keyid, principal, recorded_at_tick, recorded_ms)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (keyid) DO NOTHING`,
      [row.keyid, row.principal, row.recordedAtTick, row.recordedMs],
    );
  }

  async close(): Promise<void> {
    if (this.ownsPool) await this.pool.end();
  }
}

interface HostedKeyRow {
  readonly keyid: string;
  readonly principal: string;
  readonly recorded_at_tick: string | number;
  readonly recorded_ms: string | number;
}

/** Consecutive failed writes before `/health` reports the disclosure as not durable. (calibrate) */
export const HOSTED_FAILURE_ALARM = 3;

/** What `/health` reports. Counts and a DB error string — never a key, an account or a secret. */
export interface HostedSignersHealth {
  /** Keys recorded as hosted, durable or not. */
  readonly hosted: number;
  /** Recorded in memory and not yet written. Normally 0. */
  readonly undurable: number;
  readonly consecutive_failures: number;
  readonly last_error: string | null;
  /** Whether this engine verifies gateway headers at all: `COMPACT_GATEWAY_SECRET` decoded to 32 bytes. */
  readonly gateway: 'configured' | 'unset' | 'malformed';
}

/**
 * The set of hosted keys, the queue that makes it durable, and the one question projections ask.
 *
 * Holds the keyring by its read-only {@link KeyHistory} face: the signer of a principal at a tick is the
 * key live at that tick (`identity/signer.ts`), and only the key directory knows which that is.
 */
export class HostedSigners {
  private readonly keyids = new Set<string>();
  private readonly pending: HostedKeyRecord[] = [];
  /** The drain that is running, shared by every caller until it settles. Single-flight by construction. */
  private inflight: Promise<number> | null = null;
  private closed = false;
  private consecutiveFailures = 0;
  private lastError: string | null = null;

  /** The projections' read, bound so it can be handed to a frame builder as a plain function. */
  readonly lookup: SignerLookup = (principal, atTick) => this.signerAt(principal, atTick);

  constructor(
    private readonly keys: KeyHistory,
    private readonly store: HostedKeyStore = new InMemoryHostedKeyStore(),
    private readonly gateway: HostedSignersHealth['gateway'] = 'unset',
  ) {}

  /** Read every recorded key. Boot calls this BEFORE the replay, so republished frames say `hosted` too. */
  async load(): Promise<number> {
    const rows = await this.store.hostedKeys();
    for (const row of rows) this.keyids.add(row.keyid);
    return rows.length;
  }

  /** Is this key one the server signs with? */
  isHosted(keyid: string): boolean {
    return this.keyids.has(keyid);
  }

  /** The signer of `principal` at `atTick`. See `identity/signer.ts`. */
  signerAt(principal: PrincipalId, atTick: number): Signer | null {
    return signerAt(this.keys, this.keyids, principal, Math.max(0, atTick));
  }

  /**
   * Record a key as hosted. Synchronous and total: the set changes now, the row is queued, and a flush
   * is started. A key already known costs one set lookup and writes nothing.
   */
  markHosted(row: HostedKeyRecord): void {
    if (this.keyids.has(row.keyid)) return;
    this.keyids.add(row.keyid);
    this.pending.push(row);
    void this.flush();
  }

  /**
   * Write the queue in order until it is empty or a write fails. Never throws — a failure leaves the row
   * at the head for the next call, exactly as `persist/journal.ts` leaves a tick.
   *
   * **Single-flight by sharing the promise, never by spinning.** A call made while a drain is running gets
   * that drain's promise, so a caller that must wait for it (`close`) awaits the real write. The obvious
   * alternative — `while (flushing) await Promise.resolve()` — re-queues microtasks forever while the write
   * it waits for needs a macrotask (a socket read), and never lets the event loop deliver it.
   */
  flush(): Promise<number> {
    if (this.closed) return Promise.resolve(0);
    if (this.inflight !== null) return this.inflight;
    const run = this.drain().finally(() => {
      this.inflight = null;
    });
    this.inflight = run;
    return run;
  }

  private async drain(): Promise<number> {
    let written = 0;
    while (this.pending.length > 0) {
      const row = this.pending[0];
      if (row === undefined) break;
      try {
        await this.store.recordHostedKey(row);
      } catch (error: unknown) {
        this.consecutiveFailures += 1;
        this.lastError = error instanceof Error ? error.message : String(error);
        return written;
      }
      this.pending.shift();
      this.consecutiveFailures = 0;
      this.lastError = null;
      written += 1;
    }
    return written;
  }

  /** Best-effort drain for a clean shutdown, then close the store. A dead store leaves a logged backlog. */
  async close(): Promise<number> {
    for (let attempt = 0; attempt < 8 && this.pending.length > 0; attempt += 1) {
      const before = this.pending.length;
      // Awaits a drain already running, or starts one: either way, the real write.
      await this.flush();
      if (this.pending.length === before) break;
    }
    // A drain that began after the loop's last look is let finish before the store closes under it.
    if (this.inflight !== null) await this.inflight;
    const left = this.pending.length;
    this.closed = true;
    await this.store.close();
    return left;
  }

  health(): HostedSignersHealth {
    return {
      hosted: this.keyids.size,
      undurable: this.pending.length,
      consecutive_failures: this.consecutiveFailures,
      last_error: this.lastError,
      gateway: this.gateway,
    };
  }

  /** True once writes have failed often enough that an operator must look. */
  get alarming(): boolean {
    return this.pending.length > 0 && this.consecutiveFailures >= HOSTED_FAILURE_ALARM;
  }
}
