/**
 * Where follows live: a PRIVATE table, deletable, and outside the record.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **NOTHING IN HERE IS PART OF THE WORLD**, and the separation is structural:
 *
 *   - It is not the journal. `JournalStore` (`src/persist/`) is append-only by grant and
 *     replayed at boot; this store is neither, and no module under `src/persist/`,
 *     `src/sim/`, `src/tick/` or `src/frames/` imports it.
 *   - It is not in a snapshot and not in `state_hash`. The runtime never holds a handle to
 *     it, so it cannot be captured — `test/follow/the-record-is-untouched.spec.ts` replays
 *     the same world with and without followers and compares every tick's hash.
 *   - It is not `journal_enrollment.owner_email`. That column is enrolment data an agent
 *     supplies about itself, inside the record's own boot inputs. A follower is anyone, about
 *     anyone, and owns nothing (SPEC §13B: an OWNER reads, never moves — a follower does
 *     not even have to be one).
 *
 * A5 makes the world's record permanent and public. An email address is the opposite kind
 * of fact: private, revocable, and deletable on request. Putting it anywhere the record lives
 * would make it permanent too, which is why this is its own table with its own store.
 * ══════════════════════════════════════════════════════════════════════════
 */

/** The three states a follow can be in. Upper case because they are stored values. */
export type FollowStatus = 'PENDING' | 'ACTIVE' | 'UNSUBSCRIBED';

export const FOLLOW_STATUSES: readonly FollowStatus[] = Object.freeze(['PENDING', 'ACTIVE', 'UNSUBSCRIBED']);

export interface FollowRow {
  /** Random, never sequential. Also the HMAC input for this follow's unsubscribe token. */
  readonly id: string;
  readonly handle: string;
  /** Normalised by `normaliseEmail`. Never logged, never in a frame, never in the record. */
  readonly email: string;
  readonly status: FollowStatus;
  /** sha-256 of the latest confirm token. Kept after confirming, so a second click is idempotent. */
  readonly confirmTokenHash: string | null;
  /** sha-256 of the HMAC unsubscribe token. See `tokens.ts`. */
  readonly unsubscribeTokenHash: string;
  readonly createdMs: number;
  /** When the latest confirmation was handed to the provider; null if that send failed. */
  readonly confirmSentMs: number | null;
  readonly confirmedMs: number | null;
  readonly unsubscribedMs: number | null;
  /**
   * The Reckoning whose recap this follower was last sent — the exactly-once mark. A follower is
   * owed tonight's recap exactly when this is not tonight's Reckoning.
   *
   * A confirmation sets it to the Reckoning that had already settled, so the first recap is for
   * the NEXT one rather than a day-old one arriving at a random moment. A mark ABOVE tonight's
   * Reckoning means the world was re-seeded and its count restarted — follows outlive a season,
   * and the house cast keeps its names — so it is owed tonight's recap, not weeks of silence
   * until the new world's count catches up with the old one.
   */
  readonly lastSentReckoning: number | null;
  readonly lastSentMs: number | null;
}

export interface NewFollow {
  readonly id: string;
  readonly handle: string;
  readonly email: string;
  readonly confirmTokenHash: string;
  readonly unsubscribeTokenHash: string;
  readonly nowMs: number;
}

export interface FollowStore {
  /** Which backend this is, for `/health`. */
  readonly kind: 'postgres' | 'memory';
  find(handle: string, email: string): Promise<FollowRow | null>;
  byConfirmHash(hash: string): Promise<FollowRow | null>;
  byUnsubscribeHash(hash: string): Promise<FollowRow | null>;
  /** A new PENDING row with `confirmSentMs = nowMs`. False if `(handle, email)` already exists. */
  insertPending(row: NewFollow): Promise<boolean>;
  /** Back to PENDING (from PENDING or UNSUBSCRIBED) under a fresh confirm token. */
  renewPending(id: string, confirmTokenHash: string, nowMs: number): Promise<void>;
  /** The provider refused the confirmation: the cooldown must not hold the next request back. */
  clearConfirmSent(id: string): Promise<void>;
  /** PENDING → ACTIVE. False if it was not PENDING, which makes a double click harmless. */
  activate(id: string, nowMs: number, startAfterReckoning: number | null): Promise<boolean>;
  /** → UNSUBSCRIBED. False if it already was. */
  unsubscribe(id: string, nowMs: number): Promise<boolean>;
  countActive(email: string): Promise<number>;
  /** ACTIVE follows whose mark is not `reckoning`, by id, after `afterId`. Bounded by `limit`. */
  dueForRecap(reckoning: number, afterId: string | null, limit: number): Promise<readonly FollowRow[]>;
  /** Set the exactly-once mark. False if it was already `reckoning`, or the row left ACTIVE. */
  markRecapSent(id: string, reckoning: number, nowMs: number): Promise<boolean>;
  setUnsubscribeHash(id: string, hash: string): Promise<void>;
  /**
   * Take one slot of `day`'s mail allowance if fewer than `limit` are taken. Atomic, and
   * DURABLE in the Postgres store: a restart must not hand out a fresh day's ceiling.
   */
  reserveMail(day: string, limit: number): Promise<boolean>;
  mailReserved(day: string): Promise<number>;
  /** Delete PENDING follows whose last confirmation is older than `beforeMs`. Data, minimised. */
  pruneExpiredPending(beforeMs: number): Promise<number>;
  close(): Promise<void>;
}

/** Byte order, never locale order (DET-4), so both stores page in the same sequence. */
export function compareFollowIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * The store for a world with no database, and for every test.
 *
 * Ephemeral by definition, and `serve()` says so out loud when it falls back to it: a follow
 * that vanishes at the next restart is a follow somebody will wonder about.
 */
export class InMemoryFollowStore implements FollowStore {
  readonly kind = 'memory' as const;
  private readonly rows = new Map<string, FollowRow>();
  private readonly mailDays = new Map<string, number>();

  /** Every row, for tests. A copy: nothing outside may mutate the store. */
  all(): readonly FollowRow[] {
    return [...this.rows.values()].sort((a, b) => compareFollowIds(a.id, b.id));
  }

  find(handle: string, email: string): Promise<FollowRow | null> {
    for (const row of this.rows.values()) {
      if (row.handle === handle && row.email === email) return Promise.resolve(row);
    }
    return Promise.resolve(null);
  }

  byConfirmHash(hash: string): Promise<FollowRow | null> {
    for (const row of this.rows.values()) if (row.confirmTokenHash === hash) return Promise.resolve(row);
    return Promise.resolve(null);
  }

  byUnsubscribeHash(hash: string): Promise<FollowRow | null> {
    for (const row of this.rows.values()) if (row.unsubscribeTokenHash === hash) return Promise.resolve(row);
    return Promise.resolve(null);
  }

  insertPending(row: NewFollow): Promise<boolean> {
    for (const existing of this.rows.values()) {
      if (existing.handle === row.handle && existing.email === row.email) return Promise.resolve(false);
    }
    this.rows.set(row.id, {
      id: row.id,
      handle: row.handle,
      email: row.email,
      status: 'PENDING',
      confirmTokenHash: row.confirmTokenHash,
      unsubscribeTokenHash: row.unsubscribeTokenHash,
      createdMs: row.nowMs,
      confirmSentMs: row.nowMs,
      confirmedMs: null,
      unsubscribedMs: null,
      lastSentReckoning: null,
      lastSentMs: null,
    });
    return Promise.resolve(true);
  }

  renewPending(id: string, confirmTokenHash: string, nowMs: number): Promise<void> {
    this.patch(id, (r) => (r.status === 'ACTIVE' ? r : { ...r, status: 'PENDING', confirmTokenHash, confirmSentMs: nowMs }));
    return Promise.resolve();
  }

  clearConfirmSent(id: string): Promise<void> {
    this.patch(id, (r) => ({ ...r, confirmSentMs: null }));
    return Promise.resolve();
  }

  activate(id: string, nowMs: number, startAfterReckoning: number | null): Promise<boolean> {
    const row = this.rows.get(id);
    if (row === undefined || row.status !== 'PENDING') return Promise.resolve(false);
    this.rows.set(id, {
      ...row,
      status: 'ACTIVE',
      confirmedMs: nowMs,
      lastSentReckoning: startAfterReckoning,
    });
    return Promise.resolve(true);
  }

  unsubscribe(id: string, nowMs: number): Promise<boolean> {
    const row = this.rows.get(id);
    if (row === undefined || row.status === 'UNSUBSCRIBED') return Promise.resolve(false);
    this.rows.set(id, { ...row, status: 'UNSUBSCRIBED', unsubscribedMs: nowMs });
    return Promise.resolve(true);
  }

  countActive(email: string): Promise<number> {
    let n = 0;
    for (const row of this.rows.values()) if (row.email === email && row.status === 'ACTIVE') n += 1;
    return Promise.resolve(n);
  }

  dueForRecap(reckoning: number, afterId: string | null, limit: number): Promise<readonly FollowRow[]> {
    const due = [...this.rows.values()]
      .filter(
        (r) =>
          r.status === 'ACTIVE' &&
          r.lastSentReckoning !== reckoning &&
          (afterId === null || compareFollowIds(r.id, afterId) > 0),
      )
      .sort((a, b) => compareFollowIds(a.id, b.id))
      .slice(0, Math.max(0, limit));
    return Promise.resolve(due);
  }

  markRecapSent(id: string, reckoning: number, nowMs: number): Promise<boolean> {
    const row = this.rows.get(id);
    if (row === undefined || row.status !== 'ACTIVE' || row.lastSentReckoning === reckoning) {
      return Promise.resolve(false);
    }
    this.rows.set(id, { ...row, lastSentReckoning: reckoning, lastSentMs: nowMs });
    return Promise.resolve(true);
  }

  setUnsubscribeHash(id: string, hash: string): Promise<void> {
    this.patch(id, (r) => ({ ...r, unsubscribeTokenHash: hash }));
    return Promise.resolve();
  }

  reserveMail(day: string, limit: number): Promise<boolean> {
    const taken = this.mailDays.get(day) ?? 0;
    if (taken >= limit) return Promise.resolve(false);
    this.mailDays.set(day, taken + 1);
    return Promise.resolve(true);
  }

  mailReserved(day: string): Promise<number> {
    return Promise.resolve(this.mailDays.get(day) ?? 0);
  }

  pruneExpiredPending(beforeMs: number): Promise<number> {
    let n = 0;
    for (const [id, row] of [...this.rows]) {
      if (row.status === 'PENDING' && (row.confirmSentMs ?? row.createdMs) < beforeMs) {
        this.rows.delete(id);
        n += 1;
      }
    }
    return Promise.resolve(n);
  }

  close(): Promise<void> {
    return Promise.resolve();
  }

  private patch(id: string, change: (row: FollowRow) => FollowRow): void {
    const row = this.rows.get(id);
    if (row !== undefined) this.rows.set(id, change(row));
  }
}
