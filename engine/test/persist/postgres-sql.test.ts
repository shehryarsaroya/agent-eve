/**
 * The Postgres store's query construction, without a live database.
 *
 * The pg impl cannot run in CI (no Postgres), so its one real risk — a hand-written
 * INSERT whose placeholders and parameters disagree, or a value spliced into the SQL
 * text — is checked here against a fake pool that records every call. This does not
 * prove the rows land in the right tables (only a live DB can), but it proves each
 * statement is parameterised and internally consistent, which is where a thin writer
 * actually breaks.
 */

import { describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { PgJournalStore } from '../../src/persist/index.js';
import type { PersistedEvent, TickRecord } from '../../src/persist/index.js';
import type { EventId, PrincipalId } from '../../src/core/types.js';
import type { LoggedAction } from '../../src/tick/index.js';

interface Call {
  readonly sql: string;
  readonly params: readonly unknown[];
}

class FakeClient {
  readonly calls: Call[] = [];
  query(sql: string, params?: readonly unknown[]): Promise<{ rows: never[]; rowCount: number }> {
    this.calls.push({ sql, params: params ?? [] });
    return Promise.resolve({ rows: [], rowCount: 0 });
  }
  release(): void {
    /* no-op */
  }
}

class FakePool {
  readonly calls: Call[] = [];
  readonly client = new FakeClient();
  query(sql: string, params?: readonly unknown[]): Promise<{ rows: never[]; rowCount: number }> {
    this.calls.push({ sql, params: params ?? [] });
    return Promise.resolve({ rows: [], rowCount: 0 });
  }
  connect(): Promise<FakeClient> {
    return Promise.resolve(this.client);
  }
  end(): Promise<void> {
    return Promise.resolve();
  }
}

/** The highest `$N` placeholder in a statement. */
function maxPlaceholder(sql: string): number {
  let max = 0;
  for (const m of sql.matchAll(/\$(\d+)/g)) max = Math.max(max, Number(m[1]));
  return max;
}

/** Every parameterised statement's placeholders match its argument count exactly. */
function assertConsistent(calls: readonly Call[]): void {
  for (const call of calls) {
    const n = maxPlaceholder(call.sql);
    if (n === 0) continue; // BEGIN / COMMIT / ROLLBACK carry no parameters
    expect(call.params.length, `placeholders vs params for: ${call.sql.slice(0, 60)}`).toBe(n);
  }
}

function anEvent(tick: number, seq: number): PersistedEvent {
  return {
    event: {
      id: `e:${String(tick)}:${String(seq)}` as EventId,
      tick,
      seqInTick: seq,
      kind: 'venture.delivered',
      rulesVersion: 1,
      actorPrincipalId: 'p:vale' as PrincipalId,
      onBehalfOfPrincipalId: null,
      grantId: null,
      eventFamilyId: 'v:1',
      parentEventId: null,
      isPublic: true,
      publicAt: tick,
      declassifyAt: tick,
      provenanceClass: 'FACT',
      actedOnStateVersion: 3,
      decisionSource: 'HEURISTIC',
      payload: { note: 'x' },
    },
    visibility: 'PUBLIC',
    flagKeys: [],
    audience: [{ principal: 'p:orison' as PrincipalId, basis: 'PARTY', admittedAtTick: tick }],
  };
}

function anAction(tick: number, resolution: number): LoggedAction {
  return {
    tick,
    principal: 'p:vale' as PrincipalId,
    verb: 'create',
    params: { kind: 'HAUL' },
    clientSequence: 1,
    priority: 0,
    decisionSource: 'LIVE',
    idempotencyKey: null,
    actedOnStateVersion: 3,
    arrivalMs: 1234,
    arrivalOrdinal: resolution,
    resolutionOrdinal: resolution,
    outcome: 'APPLIED',
    rejection: null,
  };
}

describe('PgJournalStore builds consistent parameterised SQL', () => {
  it('appendTick wraps a tick in a transaction with matched placeholders', async () => {
    const pool = new FakePool();
    const store = new PgJournalStore({ pool: pool as unknown as Pool });
    const record: TickRecord = {
      tick: 7,
      seed: 's:t7',
      seedHash: 'h:t7',
      events: [anEvent(7, 0), anEvent(7, 1)],
      postings: [],
      actions: [anAction(7, 0)],
    };
    await store.appendTick(record);

    const sqls = pool.client.calls.map((c) => c.sql.trim().split(/\s+/).slice(0, 2).join(' '));
    expect(sqls[0]).toBe('BEGIN');
    expect(sqls[sqls.length - 1]).toBe('COMMIT');
    // tick_seed once, two events, two audience rows, one action.
    expect(pool.client.calls.filter((c) => c.sql.includes('INTO tick_seed')).length).toBe(1);
    expect(pool.client.calls.filter((c) => c.sql.includes('INTO event ')).length).toBe(2);
    expect(pool.client.calls.filter((c) => c.sql.includes('INTO event_audience')).length).toBe(2);
    expect(pool.client.calls.filter((c) => c.sql.includes('INTO action_log')).length).toBe(1);
    assertConsistent(pool.client.calls);
  });

  it('writeSnapshot and enrolment and init are all parameterised and consistent', async () => {
    const pool = new FakePool();
    const store = new PgJournalStore({ pool: pool as unknown as Pool });

    await store.init('master-seed');
    await store.writeSnapshot({
      tick: 287,
      stateHash: 'abc',
      stateVersion: 42,
      tables: [['world', { x: 1 }]],
      seed: 's:t287',
      seedHash: 'h:t287',
    });
    await store.recordEnrollment({
      principal: 'p:newcomer' as PrincipalId,
      handle: 'newcomer',
      publicKey: 'k',
      enrolledAtTick: 100,
      ownerEmail: null,
    });

    assertConsistent(pool.calls);
    // The snapshot body is passed as a bound parameter (jsonb), never spliced in.
    const snap = pool.calls.find((c) => c.sql.includes('INTO snapshot'));
    expect(snap).toBeDefined();
    expect(snap?.params.length).toBe(7);
    // init upserts write-once and never overwrites.
    expect(pool.calls.some((c) => c.sql.includes('journal_meta') && c.sql.includes('DO NOTHING'))).toBe(true);
  });

  it('rolls back a transaction when an insert throws', async () => {
    const pool = new FakePool();
    // Make the event insert fail; the tick must ROLLBACK rather than half-commit.
    let failed = false;
    pool.client.query = (sql: string, params?: readonly unknown[]) => {
      pool.client.calls.push({ sql, params: params ?? [] });
      if (sql.includes('INTO event ') && !failed) {
        failed = true;
        return Promise.reject(new Error('boom'));
      }
      return Promise.resolve({ rows: [] as never[], rowCount: 0 });
    };
    const store = new PgJournalStore({ pool: pool as unknown as Pool });
    await expect(
      store.appendTick({ tick: 1, seed: 's', seedHash: 'h', events: [anEvent(1, 0)], postings: [], actions: [] }),
    ).rejects.toThrow(/boom/);
    expect(pool.client.calls.some((c) => c.sql.trim().startsWith('ROLLBACK'))).toBe(true);
  });
});

describe('the bounded-boot reads ask Postgres for bounded things', () => {
  it('ticksPage LIMITs the seed page and bounds the action read to it', async () => {
    const pool = new FakePool();
    // Two seed rows come back, so the action query must be bounded by the LAST of
    // them (28) rather than by arithmetic on the cursor.
    pool.query = (sql: string, params?: readonly unknown[]) => {
      pool.calls.push({ sql, params: params ?? [] });
      if (sql.includes('FROM tick_seed')) {
        return Promise.resolve({
          rows: [
            { tick: 21, seed: 'a', seed_hash: 'ha' },
            { tick: 28, seed: 'b', seed_hash: 'hb' },
          ] as never[],
          rowCount: 2,
        });
      }
      return Promise.resolve({ rows: [] as never[], rowCount: 0 });
    };
    const store = new PgJournalStore({ pool: pool as unknown as Pool });
    const page = await store.ticksPage(20, 2);

    expect(page.map((t) => t.tick)).toEqual([21, 28]);
    const seedQuery = pool.calls.find((c) => c.sql.includes('FROM tick_seed'));
    expect(seedQuery?.sql).toContain('LIMIT $2');
    expect(seedQuery?.params).toEqual([20, 2]);

    // The upper bound is the page's last tick, not `cursor + limit`: `tick_seed` is
    // only gapless while nothing ever failed to flush, and boot must not skip a tick
    // because its arithmetic assumed density.
    const actionQuery = pool.calls.find((c) => c.sql.includes('FROM action_log'));
    expect(actionQuery?.params).toEqual([20, 28]);
    assertConsistent(pool.calls);
  });

  it('ticksPage short-circuits when the log is exhausted, and refuses a bad limit', async () => {
    const pool = new FakePool();
    const store = new PgJournalStore({ pool: pool as unknown as Pool });
    const page = await store.ticksPage(99, 64);
    expect(page).toEqual([]);
    // No action query at all: an empty seed page means there is nothing to join to.
    expect(pool.calls.some((c) => c.sql.includes('FROM action_log'))).toBe(false);
    await expect(store.ticksPage(0, 0)).rejects.toThrow(/positive integer limit/);
  });

  it('snapshotHashes reads two columns, never the bodies', async () => {
    const pool = new FakePool();
    pool.query = (sql: string, params?: readonly unknown[]) => {
      pool.calls.push({ sql, params: params ?? [] });
      return Promise.resolve({ rows: [{ tick: 287, state_hash: 'h287' }] as never[], rowCount: 1 });
    };
    const store = new PgJournalStore({ pool: pool as unknown as Pool });
    expect(await store.snapshotHashes()).toEqual([{ tick: 287, stateHash: 'h287' }]);
    const q = pool.calls[0]?.sql ?? '';
    expect(q).toContain('SELECT tick, state_hash FROM snapshot');
    // The bound: a season of full captures is what this query exists NOT to fetch.
    expect(q).not.toContain('body');
  });

  it('the divergence annotation is INSERT-only and fully parameterised', async () => {
    const pool = new FakePool();
    const store = new PgJournalStore({ pool: pool as unknown as Pool });
    await store.recordRulesVersion(1);
    await store.recordDivergence({
      tick: 12_400,
      kind: 'APPLIED_REFUSED',
      fromRulesVersion: 1,
      toRulesVersion: 2,
      // A NUL byte would abort the whole INSERT; it must be scrubbed on the way in.
      detail: `p:vale create \u0000 refused`,
      expectedHash: null,
      actualHash: null,
      toleratedAfter: 3,
      acceptedAtMs: 1_700_000_000_000,
    });

    const rules = pool.calls.find((c) => c.sql.includes('journal_meta'));
    expect(rules?.sql).toContain('DO NOTHING'); // write-once, like the seed
    expect(rules?.params).toEqual(['rules_version', '1']);

    const div = pool.calls.find((c) => c.sql.includes('journal_divergence'));
    expect(div).toBeDefined();
    expect(div?.sql).toContain('INSERT INTO journal_divergence');
    // The door annotates; it never rewrites.
    expect(div?.sql).not.toMatch(/UPDATE|DELETE|ON CONFLICT/);
    expect(div?.params[4]).toBe('p:vale create   refused');
    expect(String(div?.params[4])).not.toContain('\u0000');
    assertConsistent(pool.calls);
  });
});
