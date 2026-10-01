/**
 * The Postgres follow store.
 *
 * Thin, and written the way `src/persist/postgres.ts` is: every identifier is a literal in
 * this file and every value is a bound parameter, so nothing a stranger typed — an address, a
 * handle, a token — ever reaches a query string. `test/follow/store.test.ts` checks every
 * statement's placeholders against its arguments with a recording pool, which is where a
 * hand-written store actually breaks.
 *
 * Its own small pool, deliberately, rather than the journal's. A slow mail table must never
 * queue in front of a tick's durable write, and the journal's pool is private to
 * `PgJournalStore` for exactly that kind of reason.
 */

import { Pool } from 'pg';
import type { FollowRow, FollowStatus, FollowStore, NewFollow } from './store.js';

export interface PgFollowStoreOptions {
  /** libpq connection string, or undefined to use the `PG*` environment variables. */
  readonly connectionString?: string;
  /** An existing pool, for tests. Takes precedence over the string and is not closed by us. */
  readonly pool?: Pool;
}

/** Connections this store may hold. The mail path is low-volume and must stay out of the way. */
export const FOLLOW_POOL_SIZE = 2;

const COLUMNS =
  'id, handle, email, status, confirm_token_hash, unsubscribe_token_hash, created_ms, ' +
  'confirm_sent_ms, confirmed_ms, unsubscribed_ms, last_sent_reckoning, last_sent_ms';

export class PgFollowStore implements FollowStore {
  readonly kind = 'postgres' as const;
  private readonly pool: Pool;
  private readonly ownsPool: boolean;

  constructor(options: PgFollowStoreOptions = {}) {
    if (options.pool !== undefined) {
      this.pool = options.pool;
      this.ownsPool = false;
    } else {
      this.pool = new Pool({
        ...(options.connectionString === undefined ? {} : { connectionString: options.connectionString }),
        max: FOLLOW_POOL_SIZE,
      });
      this.ownsPool = true;
    }
  }

  async find(handle: string, email: string): Promise<FollowRow | null> {
    const { rows } = await this.pool.query<FollowDbRow>(
      `SELECT ${COLUMNS} FROM follow_subscription WHERE handle = $1 AND email = $2`,
      [handle, email],
    );
    return rows[0] === undefined ? null : toRow(rows[0]);
  }

  async byConfirmHash(hash: string): Promise<FollowRow | null> {
    const { rows } = await this.pool.query<FollowDbRow>(
      `SELECT ${COLUMNS} FROM follow_subscription WHERE confirm_token_hash = $1`,
      [hash],
    );
    return rows[0] === undefined ? null : toRow(rows[0]);
  }

  async byUnsubscribeHash(hash: string): Promise<FollowRow | null> {
    const { rows } = await this.pool.query<FollowDbRow>(
      `SELECT ${COLUMNS} FROM follow_subscription WHERE unsubscribe_token_hash = $1`,
      [hash],
    );
    return rows[0] === undefined ? null : toRow(rows[0]);
  }

  async insertPending(row: NewFollow): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `INSERT INTO follow_subscription (
         id, handle, email, status, confirm_token_hash, unsubscribe_token_hash,
         created_ms, confirm_sent_ms
       ) VALUES ($1, $2, $3, 'PENDING', $4, $5, $6, $6)
       ON CONFLICT (handle, email) DO NOTHING`,
      [row.id, row.handle, row.email, row.confirmTokenHash, row.unsubscribeTokenHash, row.nowMs],
    );
    return (rowCount ?? 0) > 0;
  }

  async renewPending(id: string, confirmTokenHash: string, nowMs: number): Promise<void> {
    await this.pool.query(
      `UPDATE follow_subscription
          SET status = 'PENDING', confirm_token_hash = $2, confirm_sent_ms = $3
        WHERE id = $1 AND status <> 'ACTIVE'`,
      [id, confirmTokenHash, nowMs],
    );
  }

  async clearConfirmSent(id: string): Promise<void> {
    await this.pool.query(`UPDATE follow_subscription SET confirm_sent_ms = NULL WHERE id = $1`, [id]);
  }

  async activate(id: string, nowMs: number, startAfterReckoning: number | null): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `UPDATE follow_subscription
          SET status = 'ACTIVE', confirmed_ms = $2, last_sent_reckoning = $3
        WHERE id = $1 AND status = 'PENDING'`,
      [id, nowMs, startAfterReckoning],
    );
    return (rowCount ?? 0) > 0;
  }

  async unsubscribe(id: string, nowMs: number): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `UPDATE follow_subscription
          SET status = 'UNSUBSCRIBED', unsubscribed_ms = $2
        WHERE id = $1 AND status <> 'UNSUBSCRIBED'`,
      [id, nowMs],
    );
    return (rowCount ?? 0) > 0;
  }

  async countActive(email: string): Promise<number> {
    const { rows } = await this.pool.query<{ n: string | number }>(
      `SELECT count(*) AS n FROM follow_subscription WHERE email = $1 AND status = 'ACTIVE'`,
      [email],
    );
    return Number(rows[0]?.n ?? 0);
  }

  async dueForRecap(reckoning: number, afterId: string | null, limit: number): Promise<readonly FollowRow[]> {
    // `COLLATE "C"` on the ordering key, as SPEC §15.5 asks of every ORDER BY on text: the
    // page cursor compares ids byte by byte, and a locale collation would let a page skip one.
    // `IS DISTINCT FROM`, not `<`: a mark above tonight's Reckoning is a re-seeded world, and
    // that follower is owed tonight (see `FollowRow.lastSentReckoning`).
    const { rows } = await this.pool.query<FollowDbRow>(
      `SELECT ${COLUMNS} FROM follow_subscription
        WHERE status = 'ACTIVE'
          AND last_sent_reckoning IS DISTINCT FROM $1
          AND ($2::text IS NULL OR id COLLATE "C" > $2::text COLLATE "C")
        ORDER BY id COLLATE "C"
        LIMIT $3`,
      [reckoning, afterId, limit],
    );
    return rows.map(toRow);
  }

  async markRecapSent(id: string, reckoning: number, nowMs: number): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `UPDATE follow_subscription
          SET last_sent_reckoning = $2, last_sent_ms = $3
        WHERE id = $1 AND status = 'ACTIVE'
          AND last_sent_reckoning IS DISTINCT FROM $2`,
      [id, reckoning, nowMs],
    );
    return (rowCount ?? 0) > 0;
  }

  async setUnsubscribeHash(id: string, hash: string): Promise<void> {
    await this.pool.query(`UPDATE follow_subscription SET unsubscribe_token_hash = $2 WHERE id = $1`, [id, hash]);
  }

  async reserveMail(day: string, limit: number): Promise<boolean> {
    // A fresh day's INSERT takes its first slot unconditionally, so a zero limit is decided
    // here rather than by recording a send that never happened.
    if (limit <= 0) return false;
    // One statement, so two senders can never both take the last slot: the conditional
    // DO UPDATE either increments under the limit and returns the row, or returns nothing.
    const { rows } = await this.pool.query<{ sent: number }>(
      `INSERT INTO follow_mail_day AS d (day, sent) VALUES ($1, 1)
       ON CONFLICT (day) DO UPDATE SET sent = d.sent + 1 WHERE d.sent < $2
       RETURNING d.sent`,
      [day, limit],
    );
    return rows.length > 0;
  }

  async mailReserved(day: string): Promise<number> {
    const { rows } = await this.pool.query<{ sent: number }>(`SELECT sent FROM follow_mail_day WHERE day = $1`, [
      day,
    ]);
    return Number(rows[0]?.sent ?? 0);
  }

  async pruneExpiredPending(beforeMs: number): Promise<number> {
    const { rowCount } = await this.pool.query(
      `DELETE FROM follow_subscription
        WHERE status = 'PENDING' AND COALESCE(confirm_sent_ms, created_ms) < $1`,
      [beforeMs],
    );
    return rowCount ?? 0;
  }

  async close(): Promise<void> {
    if (this.ownsPool) await this.pool.end();
  }
}

interface FollowDbRow {
  readonly id: string;
  readonly handle: string;
  readonly email: string;
  readonly status: string;
  readonly confirm_token_hash: string | null;
  readonly unsubscribe_token_hash: string;
  readonly created_ms: string | number;
  readonly confirm_sent_ms: string | number | null;
  readonly confirmed_ms: string | number | null;
  readonly unsubscribed_ms: string | number | null;
  readonly last_sent_reckoning: number | null;
  readonly last_sent_ms: string | number | null;
}

/** `bigint` comes back from `pg` as a string; every millisecond column is read through this. */
function ms(value: string | number | null): number | null {
  return value === null ? null : Number(value);
}

function toRow(r: FollowDbRow): FollowRow {
  return {
    id: r.id,
    handle: r.handle,
    email: r.email,
    status: r.status as FollowStatus,
    confirmTokenHash: r.confirm_token_hash,
    unsubscribeTokenHash: r.unsubscribe_token_hash,
    createdMs: Number(r.created_ms),
    confirmSentMs: ms(r.confirm_sent_ms),
    confirmedMs: ms(r.confirmed_ms),
    unsubscribedMs: ms(r.unsubscribed_ms),
    lastSentReckoning: r.last_sent_reckoning === null ? null : Number(r.last_sent_reckoning),
    lastSentMs: ms(r.last_sent_ms),
  };
}
