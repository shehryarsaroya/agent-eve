/**
 * The follow store: the in-memory semantics every test leans on, and the Postgres store's
 * SQL — checked without a database, the way `test/persist/postgres-sql.test.ts` checks the
 * journal's: a recording pool, every placeholder matched to an argument, and no value ever
 * spliced into a query string.
 */

import { describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { InMemoryFollowStore, PgFollowStore, type FollowStore, type NewFollow } from '../../src/api/follow/index.js';

function newRow(over: Partial<NewFollow> = {}): NewFollow {
  return {
    id: 'id-a',
    handle: 'vale',
    email: 'you@example.com',
    confirmTokenHash: 'c'.repeat(64),
    unsubscribeTokenHash: 'u'.repeat(64),
    nowMs: 1_000,
    ...over,
  };
}

describe('InMemoryFollowStore — the state machine', () => {
  it('one row per (handle, email); a second insert is refused, not duplicated', async () => {
    const s = new InMemoryFollowStore();
    expect(await s.insertPending(newRow())).toBe(true);
    expect(await s.insertPending(newRow({ id: 'id-b' }))).toBe(false);
    expect(s.all()).toHaveLength(1);
    expect(await s.insertPending(newRow({ id: 'id-c', handle: 'orison' }))).toBe(true);
  });

  it('PENDING → ACTIVE once; a second activation is a no-op (the double click)', async () => {
    const s = new InMemoryFollowStore();
    await s.insertPending(newRow());
    expect(await s.activate('id-a', 2_000, 4)).toBe(true);
    expect(await s.activate('id-a', 3_000, 9)).toBe(false);
    const row = await s.find('vale', 'you@example.com');
    expect(row?.status).toBe('ACTIVE');
    expect(row?.confirmedMs).toBe(2_000);
    expect(row?.lastSentReckoning).toBe(4);
  });

  it('unsubscribe is idempotent and renewPending brings an unsubscribed follow back to PENDING', async () => {
    const s = new InMemoryFollowStore();
    await s.insertPending(newRow());
    await s.activate('id-a', 2_000, null);
    expect(await s.unsubscribe('id-a', 3_000)).toBe(true);
    expect(await s.unsubscribe('id-a', 4_000)).toBe(false);
    await s.renewPending('id-a', 'd'.repeat(64), 5_000);
    const row = await s.find('vale', 'you@example.com');
    expect(row?.status).toBe('PENDING');
    expect(row?.confirmTokenHash).toBe('d'.repeat(64));
    expect(row?.confirmSentMs).toBe(5_000);
  });

  it('renewPending never demotes an ACTIVE follow', async () => {
    const s = new InMemoryFollowStore();
    await s.insertPending(newRow());
    await s.activate('id-a', 2_000, null);
    await s.renewPending('id-a', 'e'.repeat(64), 3_000);
    expect((await s.find('vale', 'you@example.com'))?.status).toBe('ACTIVE');
  });

  it('dueForRecap pages ACTIVE rows not yet sent tonight, in id order, and a mark is set once per night', async () => {
    const s = new InMemoryFollowStore();
    for (const id of ['c', 'a', 'b']) {
      await s.insertPending(newRow({ id, email: `${id}@example.com`, unsubscribeTokenHash: id.repeat(64) }));
      await s.activate(id, 1, null);
    }
    await s.insertPending(newRow({ id: 'p', email: 'pending@example.com', unsubscribeTokenHash: 'p'.repeat(64) }));
    expect((await s.dueForRecap(5, null, 10)).map((r) => r.id)).toEqual(['a', 'b', 'c']);
    expect((await s.dueForRecap(5, 'a', 1)).map((r) => r.id)).toEqual(['b']);
    expect(await s.markRecapSent('b', 5, 9)).toBe(true);
    expect(await s.markRecapSent('b', 5, 10)).toBe(false);
    expect((await s.dueForRecap(5, null, 10)).map((r) => r.id)).toEqual(['a', 'c']);
    expect((await s.dueForRecap(6, null, 10)).map((r) => r.id)).toEqual(['a', 'b', 'c']);
    // A re-seeded world restarts its count: a mark ABOVE tonight is owed tonight, not silence.
    expect((await s.dueForRecap(2, null, 10)).map((r) => r.id)).toEqual(['a', 'b', 'c']);
    expect(await s.markRecapSent('b', 2, 11)).toBe(true);
    expect((await s.dueForRecap(2, null, 10)).map((r) => r.id)).toEqual(['a', 'c']);
  });

  it('reserveMail is a hard ceiling per day, and a zero ceiling takes nothing', async () => {
    const s = new InMemoryFollowStore();
    expect(await s.reserveMail('2026-10-01', 2)).toBe(true);
    expect(await s.reserveMail('2026-10-01', 2)).toBe(true);
    expect(await s.reserveMail('2026-10-01', 2)).toBe(false);
    expect(await s.mailReserved('2026-10-01')).toBe(2);
    expect(await s.reserveMail('2026-10-02', 2)).toBe(true);
    expect(await s.reserveMail('2026-10-03', 0)).toBe(false);
    expect(await s.mailReserved('2026-10-03')).toBe(0);
  });

  it('pruneExpiredPending deletes stale PENDING rows — address and all — and nothing else', async () => {
    const s = new InMemoryFollowStore();
    await s.insertPending(newRow({ id: 'old', nowMs: 100 }));
    await s.insertPending(newRow({ id: 'new', email: 'b@example.com', unsubscribeTokenHash: 'v'.repeat(64), nowMs: 900 }));
    await s.insertPending(newRow({ id: 'act', email: 'c@example.com', unsubscribeTokenHash: 'w'.repeat(64), nowMs: 100 }));
    await s.activate('act', 150, null);
    expect(await s.pruneExpiredPending(500)).toBe(1);
    expect(s.all().map((r) => r.id).sort((a, b) => (a < b ? -1 : 1))).toEqual(['act', 'new']);
  });
});

// ── The Postgres store, against a recording pool ───────────────────────────

interface Call {
  readonly sql: string;
  readonly params: readonly unknown[];
}

class FakePool {
  readonly calls: Call[] = [];
  /** Rows the next query returns. */
  next: { rows: unknown[]; rowCount: number } = { rows: [], rowCount: 0 };
  query(sql: string, params?: readonly unknown[]): Promise<{ rows: unknown[]; rowCount: number }> {
    this.calls.push({ sql, params: params ?? [] });
    const out = this.next;
    this.next = { rows: [], rowCount: 0 };
    return Promise.resolve(out);
  }
  end(): Promise<void> {
    return Promise.resolve();
  }
}

function maxPlaceholder(sql: string): number {
  let max = 0;
  for (const m of sql.matchAll(/\$(\d+)/g)) max = Math.max(max, Number(m[1]));
  return max;
}

async function exerciseEveryMethod(store: FollowStore): Promise<void> {
  await store.find('vale', 'x@example.com');
  await store.byConfirmHash('h');
  await store.byUnsubscribeHash('h');
  await store.insertPending(newRow());
  await store.renewPending('id', 'h', 1);
  await store.clearConfirmSent('id');
  await store.activate('id', 1, 3);
  await store.unsubscribe('id', 1);
  await store.countActive('x@example.com');
  await store.dueForRecap(3, null, 50);
  await store.dueForRecap(3, 'after', 50);
  await store.markRecapSent('id', 3, 1);
  await store.setUnsubscribeHash('id', 'h');
  await store.reserveMail('2026-10-01', 10);
  await store.mailReserved('2026-10-01');
  await store.pruneExpiredPending(1);
}

describe('PgFollowStore builds consistent, parameterised SQL', () => {
  it('every statement binds exactly as many parameters as it has placeholders', async () => {
    const pool = new FakePool();
    await exerciseEveryMethod(new PgFollowStore({ pool: pool as unknown as Pool }));
    expect(pool.calls.length).toBeGreaterThanOrEqual(16);
    for (const call of pool.calls) {
      expect(call.params.length, call.sql.slice(0, 70)).toBe(maxPlaceholder(call.sql));
    }
  });

  it('no value a stranger supplies ever appears in a query string', async () => {
    const pool = new FakePool();
    const store = new PgFollowStore({ pool: pool as unknown as Pool });
    const hostile = "x'); DROP TABLE follow_subscription; --@example.com";
    await store.find("vale'--", hostile);
    await store.countActive(hostile);
    for (const call of pool.calls) {
      expect(call.sql).not.toContain('DROP TABLE');
      expect(call.sql).not.toContain("vale'--");
      expect(call.params).toContain(call === pool.calls[0] ? "vale'--" : hostile);
    }
  });

  it('touches only the two follow tables — never the record', async () => {
    const pool = new FakePool();
    await exerciseEveryMethod(new PgFollowStore({ pool: pool as unknown as Pool }));
    const record = /\b(event|event_audience|posting|action_log|snapshot|journal_\w+|tick_seed|principal|account)\b/;
    for (const call of pool.calls) {
      expect(call.sql).toMatch(/follow_subscription|follow_mail_day/);
      expect(call.sql.replace(/follow_subscription|follow_mail_day/g, '')).not.toMatch(record);
    }
  });

  it('pages in byte order with an explicit C collation, as §15.5 asks of every text ORDER BY', async () => {
    const pool = new FakePool();
    await new PgFollowStore({ pool: pool as unknown as Pool }).dueForRecap(1, 'a', 5);
    const sql = pool.calls[0]?.sql ?? '';
    expect(sql).toMatch(/ORDER BY id COLLATE "C"/);
    expect(sql).toMatch(/status = 'ACTIVE'/);
    expect(sql).toMatch(/last_sent_reckoning IS DISTINCT FROM \$1/);
  });

  it('the mail ceiling is one atomic statement, and a zero ceiling issues none', async () => {
    const pool = new FakePool();
    const store = new PgFollowStore({ pool: pool as unknown as Pool });
    pool.next = { rows: [{ sent: 1 }], rowCount: 1 };
    expect(await store.reserveMail('2026-10-01', 5)).toBe(true);
    expect(pool.calls[0]?.sql).toMatch(/ON CONFLICT \(day\) DO UPDATE SET sent = d\.sent \+ 1 WHERE d\.sent < \$2/);
    // The conditional update matched nothing: the ceiling is reached.
    expect(await store.reserveMail('2026-10-01', 5)).toBe(false);
    const before = pool.calls.length;
    expect(await store.reserveMail('2026-10-01', 0)).toBe(false);
    expect(pool.calls.length).toBe(before);
  });

  it('reads bigint milliseconds back as numbers', async () => {
    const pool = new FakePool();
    const store = new PgFollowStore({ pool: pool as unknown as Pool });
    pool.next = {
      rows: [
        {
          id: 'i',
          handle: 'vale',
          email: 'x@example.com',
          status: 'ACTIVE',
          confirm_token_hash: null,
          unsubscribe_token_hash: 'u',
          created_ms: '1700000000000',
          confirm_sent_ms: '1700000000001',
          confirmed_ms: null,
          unsubscribed_ms: null,
          last_sent_reckoning: 3,
          last_sent_ms: '1700000000002',
        },
      ],
      rowCount: 1,
    };
    const row = await store.find('vale', 'x@example.com');
    expect(row?.createdMs).toBe(1_700_000_000_000);
    expect(row?.confirmSentMs).toBe(1_700_000_000_001);
    expect(row?.lastSentMs).toBe(1_700_000_000_002);
    expect(row?.confirmedMs).toBeNull();
  });
});
