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
