/**
 * The Postgres journal store — the durable half in production.
 *
 * Thin by design: it writes the rows the schema (`src/db/schema.sql`) already
 * defines, with **parameterised queries only** — every identifier is a literal in
 * this file and every value is a bound parameter, so nothing an agent ever produced
 * reaches a query string. Money is `bigint` minor units, everything else is
 * integer/text/jsonb, exactly as the schema declares.
 *
 * ── WHAT IT WRITES, AND WHAT IT DELIBERATELY DOES NOT ───────────────────────
 *
 * Boot-critical and public-record tables, all with no foreign key into `principal`:
 *
 *   - `journal_meta`  — the master seed, write-once (boot refuses a mismatch);
 *   - `tick_seed`     — `(seed, seed_hash)` per tick, so the commit/reveal discipline
 *                        is re-verifiable from durable data alone;
 *   - `snapshot`      — the Reckoning checkpoints boot uses as tripwires;
 *   - `action_log`    — replay's second term (submitted actions only);
 *   - `event` + `event_audience` — the append-only public record (§15.1's product);
 *   - `journal_enrollment` — external identities, so boot can re-seat them.
 *
 * **`posting` and `account` are NOT written here, and that is a reported gap, not an
 * oversight.** The `posting` table foreign-keys `account`, which foreign-keys
 * `principal`, whose `public_key` is `NOT NULL (octet_length = 32)`. The house cast
 * is seated keyless (`Runtime.seat`, no keypair — the enrol-takeover guard depends on
 * it), so cast-owned accounts cannot satisfy `account → principal`, and cast-caused
 * postings therefore cannot be inserted as the schema stands. Value is not lost:
 * balances live in the snapshot's ledger capture and every posting is re-derived by
 * replay. But the *authoritative posting log* (§15.1) will not be queryable from
 * Postgres until either `principal.public_key` is made nullable for house principals
 * or `posting` drops its `account` FK — both schema changes in files under review.
 * Reported upward. `ticksSince` returns postings as empty for the same reason.
 *
 * `ticksSince` returns the **replay-essential** fields (`tick`, `seed`, `seedHash`,
 * `actions`); it does not re-hydrate `events` (its only consumer is boot, which reads
 * none of them, and the event feed is served from the `event` table directly).
 */

import { Pool, type PoolClient } from 'pg';
import type { DecisionSource, PrincipalId } from '../core/types.js';
import type { LoggedAction } from '../tick/index.js';
import type {
  EnrollmentRecord,
  JournalStore,
  PersistedEvent,
  SnapshotRecord,
  TickRecord,
} from './store.js';

const MASTER_SEED_KEY = 'master_seed';

export interface PgJournalStoreOptions {
  /** libpq connection string, or undefined to use `PG*` environment variables. */
  readonly connectionString?: string;
  /** An existing pool to share, mainly for tests. Takes precedence over the string. */
  readonly pool?: Pool;
  /**
   * Wall-clock milliseconds for the `created_ms` audit column, injected because
   * `Date.now` is banned outside `core/time.ts` (DET-7). Defaults to a constant 0 so
   * a store built without a clock is deterministic rather than reaching for one.
   */
  readonly nowMs?: () => number;
}

export class PgJournalStore implements JournalStore {
  private readonly pool: Pool;
  private readonly ownsPool: boolean;
  private readonly nowMs: () => number;

  constructor(options: PgJournalStoreOptions = {}) {
    if (options.pool !== undefined) {
      this.pool = options.pool;
      this.ownsPool = false;
    } else {
      this.pool = new Pool(
        options.connectionString === undefined ? {} : { connectionString: options.connectionString },
      );
      this.ownsPool = true;
    }
    this.nowMs = options.nowMs ?? ((): number => 0);
  }

  async init(masterSeed: string): Promise<void> {
    if (masterSeed.length === 0) throw new Error('a run needs a non-empty master seed');
    await this.pool.query(
      `INSERT INTO journal_meta (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING`,
      [MASTER_SEED_KEY, masterSeed],
    );
  }

  async masterSeed(): Promise<string | null> {
    const { rows } = await this.pool.query<{ value: string }>(
      `SELECT value FROM journal_meta WHERE key = $1`,
      [MASTER_SEED_KEY],
    );
    return rows[0]?.value ?? null;
  }

  async appendTick(record: TickRecord): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO tick_seed (tick, seed, seed_hash) VALUES ($1, $2, $3)
           ON CONFLICT (tick) DO NOTHING`,
        [record.tick, record.seed, record.seedHash],
      );
      await this.insertEvents(client, record.events);
      await this.insertActions(client, record.tick, record.actions);
      await client.query('COMMIT');
    } catch (error: unknown) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private async insertEvents(client: PoolClient, events: readonly PersistedEvent[]): Promise<void> {
    for (const { event, audience } of events) {
      await client.query(
        `INSERT INTO event (
           id, tick, seq_in_tick, kind, rules_version, actor_principal_id,
           on_behalf_of_principal_id, grant_id, event_family_id, parent_event_id,
           is_public, public_at, declassify_at, provenance_class,
           acted_on_state_version, decision_source, payload
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
         ON CONFLICT (tick, seq_in_tick) DO NOTHING`,
        [
          event.id,
          event.tick,
          event.seqInTick,
          event.kind,
          event.rulesVersion,
          event.actorPrincipalId,
          event.onBehalfOfPrincipalId,
          event.grantId,
          event.eventFamilyId,
          event.parentEventId,
          event.isPublic,
          event.publicAt,
          event.declassifyAt,
          event.provenanceClass,
          event.actedOnStateVersion,
          event.decisionSource,
          event.payload,
        ],
      );
      for (const row of audience) {
        await client.query(
          `INSERT INTO event_audience (tick, seq_in_tick, principal_id) VALUES ($1,$2,$3)
             ON CONFLICT (tick, seq_in_tick, principal_id) DO NOTHING`,
          [event.tick, event.seqInTick, row.principal],
        );
      }
    }
  }

  private async insertActions(
    client: PoolClient,
    tick: number,
    actions: readonly LoggedAction[],
  ): Promise<void> {
    for (const a of actions) {
      await client.query(
        `INSERT INTO action_log (
           tick, resolution_order, principal_id, client_sequence, arrival_ms, priority,
           verb, params, idempotency_key, expected_state_version, accepted,
           reject_reason, decision_source
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         ON CONFLICT (tick, resolution_order) DO NOTHING`,
        [
          tick,
          a.resolutionOrdinal,
          a.principal,
          a.clientSequence,
          // Submitted actions always carry an arrival; the extractor filtered out the
          // engine-derived intent runs that would have been null here.
          a.arrivalMs ?? 0,
          a.priority,
          a.verb,
          a.params,
          a.idempotencyKey,
          a.actedOnStateVersion,
          a.outcome === 'APPLIED',
          a.outcome === 'APPLIED' ? null : (a.rejection?.invariant ?? 'REFUSED'),
          a.decisionSource,
        ],
      );
    }
  }

  async writeSnapshot(record: SnapshotRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO snapshot (tick, state_hash, seed, seed_hash, state_version, body, created_ms)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (tick) DO NOTHING`,
      [
        record.tick,
        record.stateHash,
        // The tick's revealed seed pair, carried on the record from the report — not
        // re-derived here, so the seed format has one home (`SeedBook`).
        record.seed,
        record.seedHash,
        record.stateVersion,
        JSON.stringify(record.tables),
        this.nowMs(),
      ],
    );
  }

  async latestSnapshot(): Promise<SnapshotRecord | null> {
    const { rows } = await this.pool.query<SnapshotRow>(
      `SELECT tick, state_hash, seed, seed_hash, state_version, body FROM snapshot ORDER BY tick DESC LIMIT 1`,
    );
    const row = rows[0];
    return row === undefined ? null : this.rowToSnapshot(row);
  }

  async snapshots(): Promise<readonly SnapshotRecord[]> {
    const { rows } = await this.pool.query<SnapshotRow>(
      `SELECT tick, state_hash, seed, seed_hash, state_version, body FROM snapshot ORDER BY tick ASC`,
    );
    return rows.map((r) => this.rowToSnapshot(r));
  }

  private rowToSnapshot(row: SnapshotRow): SnapshotRecord {
    const tables: unknown = typeof row.body === 'string' ? (JSON.parse(row.body) as unknown) : row.body;
    return {
      tick: row.tick,
      stateHash: row.state_hash,
      stateVersion: Number(row.state_version),
      tables: tables as SnapshotRecord['tables'],
      seed: row.seed,
      seedHash: row.seed_hash,
    };
  }

  async ticksSince(tick: number): Promise<readonly TickRecord[]> {
    const seeds = await this.pool.query<{ tick: number; seed: string; seed_hash: string }>(
      `SELECT tick, seed, seed_hash FROM tick_seed WHERE tick > $1 ORDER BY tick ASC`,
      [tick],
    );
    const actions = await this.pool.query<ActionRow>(
      `SELECT tick, resolution_order, principal_id, client_sequence, arrival_ms, priority,
              verb, params, idempotency_key, expected_state_version, accepted,
              reject_reason, decision_source
         FROM action_log WHERE tick > $1 ORDER BY tick ASC, resolution_order ASC`,
      [tick],
    );
    const byTick = new Map<number, LoggedAction[]>();
    for (const r of actions.rows) {
      const bucket = byTick.get(r.tick) ?? [];
      bucket.push(this.rowToAction(r));
      byTick.set(r.tick, bucket);
    }
    return seeds.rows.map((s) => ({
      tick: s.tick,
      seed: s.seed,
      seedHash: s.seed_hash,
      events: [],
      postings: [],
      actions: byTick.get(s.tick) ?? [],
    }));
  }

  private rowToAction(r: ActionRow): LoggedAction {
    const resolution = Number(r.resolution_order);
    return {
      tick: r.tick,
      principal: r.principal_id as PrincipalId,
      verb: r.verb,
      params: (typeof r.params === 'string' ? JSON.parse(r.params) : r.params) as LoggedAction['params'],
      clientSequence: Number(r.client_sequence),
      priority: Number(r.priority),
      decisionSource: (r.decision_source ?? 'LIVE') as DecisionSource,
      idempotencyKey: r.idempotency_key,
      actedOnStateVersion: r.expected_state_version === null ? null : Number(r.expected_state_version),
      arrivalMs: r.arrival_ms === null ? null : Number(r.arrival_ms),
      // Persisted rows are submitted actions, so a real ordinal reconstructs the
      // "this arrived" fact replay needs (it is only used to skip intent runs).
      arrivalOrdinal: resolution,
      resolutionOrdinal: resolution,
      outcome: r.accepted ? 'APPLIED' : 'REFUSED',
      rejection: r.accepted ? null : { ok: false, invariant: r.reject_reason ?? 'REFUSED', hint: '' },
    };
  }

  async headTick(): Promise<number> {
    const { rows } = await this.pool.query<{ max: number | null }>(
      `SELECT max(tick) AS max FROM tick_seed`,
    );
    const max = rows[0]?.max;
    return max === null || max === undefined ? -1 : Number(max);
  }

  async recordEnrollment(record: EnrollmentRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO journal_enrollment (principal, handle, public_key, enrolled_at_tick, owner_email)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (principal) DO NOTHING`,
      [record.principal, record.handle, record.publicKey, record.enrolledAtTick, record.ownerEmail],
    );
  }

  async enrollments(): Promise<readonly EnrollmentRecord[]> {
    const { rows } = await this.pool.query<EnrollmentRow>(
      `SELECT principal, handle, public_key, enrolled_at_tick, owner_email
         FROM journal_enrollment ORDER BY enrolled_at_tick ASC, seq ASC`,
    );
    return rows.map((r) => ({
      principal: r.principal as PrincipalId,
      handle: r.handle,
      publicKey: r.public_key,
      enrolledAtTick: Number(r.enrolled_at_tick),
      ownerEmail: r.owner_email,
    }));
  }

  async close(): Promise<void> {
    if (this.ownsPool) await this.pool.end();
  }
}

interface SnapshotRow {
  readonly tick: number;
  readonly state_hash: string;
  readonly seed: string;
  readonly seed_hash: string;
  readonly state_version: string | number;
  readonly body: unknown;
}

interface ActionRow {
  readonly tick: number;
  readonly resolution_order: string | number;
  readonly principal_id: string;
  readonly client_sequence: string | number;
  readonly arrival_ms: string | number | null;
  readonly priority: string | number;
  readonly verb: string;
  readonly params: unknown;
  readonly idempotency_key: string | null;
  readonly expected_state_version: string | number | null;
  readonly accepted: boolean;
  readonly reject_reason: string | null;
  readonly decision_source: string | null;
}

interface EnrollmentRow {
  readonly principal: string;
  readonly handle: string;
  readonly public_key: string;
  readonly enrolled_at_tick: string | number;
  readonly owner_email: string | null;
}
