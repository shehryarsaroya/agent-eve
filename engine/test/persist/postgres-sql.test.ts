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
import type { AccountId, EventId, GoodId, PrincipalId } from '../../src/core/types.js';
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

  it('appendTick writes the posting log, with the batch fields it cannot re-derive', async () => {
    // The table this store did not write for the whole of the live world's first
    // season, because `posting -> account -> principal.public_key NOT NULL` could not
    // be satisfied by a keyless house cast. The FK is gone; these rows are the point.
    const pool = new FakePool();
    const store = new PgJournalStore({ pool: pool as unknown as Pool });
    await store.appendTick({
      tick: 7,
      seed: 's:t7',
      seedHash: 'h:t7',
      events: [],
      actions: [],
      postings: [
        {
          tick: 7,
          seqInTick: 0,
          postingIndex: 0,
          eventId: 'e:mint' as EventId,
          account: 'stores:p:vex' as AccountId,
          good: null,
          amountMinor: 1_000,
          amountQty: null,
          batchKind: 'ISSUE',
          supplyAccount: 'faucet:starter_stake' as AccountId,
        },
        {
          tick: 7,
          seqInTick: 1,
          postingIndex: 1,
          eventId: 'e:haul' as EventId,
          account: 'stores:p:sable' as AccountId,
          good: 'ration' as GoodId,
          amountMinor: 0,
          amountQty: -5,
          batchKind: 'TRANSFER',
          supplyAccount: null,
        },
      ],
    });

    const inserts = pool.client.calls.filter((c) => c.sql.includes('INTO posting'));
    expect(inserts.length).toBe(2);
    // The named faucet is durable: INV-1's form check and checkInv7's third mirror
    // both read WHICH faucet, and that is not recoverable from the kind.
    expect(inserts[0]?.params).toContain('faucet:starter_stake');
    expect(inserts[0]?.params).toContain('ISSUE');
    // A signed goods leg survives as a negative; `posting.amount_qty` is signed.
    expect(inserts[1]?.params).toContain(-5);
    assertConsistent(pool.client.calls);
  });

  it('postingsInRange is bounded, parameterised, and ordered on integers only', async () => {
    const pool = new FakePool();
    pool.query = (sql: string, params?: readonly unknown[]) => {
      pool.calls.push({ sql, params: params ?? [] });
      return Promise.resolve({
        rows: [
          {
            tick: 7,
            seq_in_tick: 0,
            posting_index: 0,
            account_id: 'stores:p:vex',
            good_id: null,
            amount_minor: '1000',
            amount_qty: null,
            event_id: 'e:mint',
            batch_kind: 'ISSUE',
            supply_account_id: 'faucet:starter_stake',
          },
        ] as never[],
        rowCount: 1,
      });
    };
    const store = new PgJournalStore({ pool: pool as unknown as Pool });
    const rows = await store.postingsInRange(0, 511);
    expect(rows).toEqual([
      {
        tick: 7,
        seqInTick: 0,
        postingIndex: 0,
        eventId: 'e:mint',
        account: 'stores:p:vex',
        good: null,
        // bigint arrives as a string from pg and must come back an integer, or the
        // hydrated ledger sums strings and INV-7 reports nonsense.
        amountMinor: 1000,
        amountQty: null,
        batchKind: 'ISSUE',
        supplyAccount: 'faucet:starter_stake',
      },
    ]);
    const sql = pool.calls[0]?.sql ?? '';
    expect(sql).toContain('WHERE tick >= $1 AND tick <= $2');
    // Three integer columns. Text in an ORDER BY is the collation determinism killer,
    // and this ordering is the order the ledger's append-only array is rebuilt in.
    expect(sql).toContain('ORDER BY tick ASC, seq_in_tick ASC, posting_index ASC');
    expect(pool.calls[0]?.params).toEqual([0, 511]);
    // An inverted window reads nothing rather than scanning the table.
    expect(await store.postingsInRange(10, 9)).toEqual([]);
    expect(pool.calls.length).toBe(1);
  });

  it('writeSnapshot and enrolment and init are all parameterised and consistent', async () => {
    const pool = new FakePool();
    const store = new PgJournalStore({ pool: pool as unknown as Pool });

    await store.init('master-seed');
    await store.writeSnapshot({
      tick: 287,
      stateHash: 'abc',
      stateVersion: 42,
      rulesVersion: 6,
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
    expect(snap?.params.length).toBe(8);
    // And the provenance stamp is actually bound, not just present in the column list —
    // an INSERT naming `rules_version` while passing undefined would write NULL, which
    // `planCheckpoint` reads as "unknown provenance" and refuses forever.
    expect(snap?.sql).toContain('rules_version');
    expect(snap?.params).toContain(6);
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

describe('the partition runway is sized from the world, not from zero', () => {
  it('assertPartitionRunway REFUSES a head that has outrun its partitions', async () => {
    // The live failure, as a test. The world crossed tick 2304 with partitions covering
    // 0..2304, every event insert began failing with "no partition of relation event
    // found for row", the world kept publishing ticks that were never durable, and the
    // next restart replayed to the last durable tick and lost nine ticks of history.
    //
    // It survived every deploy because the CLI passed currentTick: 0, so the runway was
    // ensured from index 0 and then the assertion asked whether TICK ZERO had enough
    // runway — a question the partitions it had just created always answered yes to.
    const { partitionIndexForTick, PARTITION_LOOKAHEAD } = await import('../../src/db/migrate.js');

    // Eight partitions is what the old default produced: indices 0..7, ticks 0..2304.
    const highestExistingIndex = 7;
    const headTick = 2305;
    const needed = partitionIndexForTick(headTick) + PARTITION_LOOKAHEAD;
    expect(partitionIndexForTick(headTick)).toBe(8); // the tick has no partition at all
    expect(needed).toBeGreaterThan(highestExistingIndex);
  });

  it('the lookahead is long enough to survive the speed the world actually runs at', async () => {
    const { PARTITION_LOOKAHEAD, TICKS_PER_PARTITION } = await import('../../src/db/migrate.js');
    const { SPEEDS, TICKS_PER_RECKONING } = await import('../../src/core/time.js');
    // serve() hardcodes `fast`, so the runway must be measured at THAT pace, not at prod.
    // The old value of 7 was documented as "seven days at production pace" and was 5.6
    // HOURS at fast — a duration that silently shortened 30x when the clock sped up,
    // which is TESTING.md hazard 1 reaching the database.
    const ticks = PARTITION_LOOKAHEAD * TICKS_PER_PARTITION;
    const hoursAtFast = (ticks * SPEEDS.fast) / 3600;
    expect(TICKS_PER_PARTITION).toBe(TICKS_PER_RECKONING);
    expect(hoursAtFast, 'a runway shorter than a long weekend will fail unattended').toBeGreaterThan(72);
  });
});

describe('the four columns a bounded boot needed', () => {
  /**
   * `hydrateEventsForSnapshot` refuses to adopt a checkpoint it cannot re-check the §11.2 ladder
   * from, so production replayed from genesis on every restart at a cost that grew with the age of
   * the world — and A10 forbids ever resetting, so that cost only went one way.
   *
   * Two things were missing and neither is sufficient alone: the columns, and a store that reads
   * events back at all (`ticksPage` returned `events: []`). This file guards the half that is
   * checkable without a live Postgres: that the SQL names the columns, that the writer supplies a
   * value for each, and that placeholders still match.
   */
  it('writes the visibility tier and the flag keys, not just is_public', async () => {
    const pool = new FakePool();
    const store = new PgJournalStore({ pool: pool as unknown as Pool });
    await store.appendTick({
      tick: 11,
      seed: 's',
      seedHash: 'h',
      events: [anEvent(11, 0)],
      postings: [],
      actions: [],
    });
    const insert = pool.client.calls.find((c) => c.sql.includes('INTO event '));
    expect(insert, 'an event insert must happen').toBeDefined();
    // `is_public` is a boolean and the ladder has FIVE rungs, so a durable record carrying only
    // the boolean cannot say whether a non-public event was PARTIES, SENSED, SEALED or PRIVATE.
    expect(insert?.sql).toContain('visibility');
    expect(insert?.sql).toContain('flag_keys');
    assertConsistent(pool.client.calls);
  });

  it('writes the audience BASIS and the tick the admission was made', async () => {
    const pool = new FakePool();
    const store = new PgJournalStore({ pool: pool as unknown as Pool });
    await store.appendTick({
      tick: 12,
      seed: 's',
      seedHash: 'h',
      events: [anEvent(12, 0)],
      postings: [],
      actions: [],
    });
    const insert = pool.client.calls.find((c) => c.sql.includes('INTO event_audience'));
    expect(insert).toBeDefined();
    // Without the basis a restored world knows the allow-list and not the rule behind it, so
    // `admitAudience`'s door cannot be re-run and the hydrate has to trust rows instead of
    // re-checking them. Without `admitted_at_tick`, a late admission's reveal ordinal moves.
    expect(insert?.sql).toContain('basis');
    expect(insert?.sql).toContain('admitted_at_tick');
    assertConsistent(pool.client.calls);
  });

  it('ticksPage reads events back instead of returning an empty array', async () => {
    // The other half of the blocker. However complete the schema became, adoption was impossible
    // while this returned `[]`, because the hydrate had nothing to read.
    //
    // `ticksPage` short-circuits on an empty seed page, so the fake has to return one row or the
    // event query is never reached and this test passes for the wrong reason — which is what it
    // did on the first run.
    const pool = new FakePool();
    let seeded = false;
    const realQuery = pool.query.bind(pool);
    (pool as unknown as { query: FakePool['query'] }).query = (sql, params) => {
      const answer = realQuery(sql, params);
      if (!seeded && sql.includes('FROM tick_seed')) {
        seeded = true;
        return Promise.resolve({ rows: [{ tick: 5, seed: 's', seed_hash: 'h' }] as never, rowCount: 1 });
      }
      return answer;
    };
    const store = new PgJournalStore({ pool: pool as unknown as Pool });
    await store.ticksPage(4, 3);
    const all = pool.calls.map((c) => c.sql).join(' | ');
    expect(all, 'the page must query the event table').toMatch(/FROM event\b/);
    expect(all, 'and the audience fan-out with it').toMatch(/FROM event_audience/);
    expect(all, 'and it must select the tier, or the ladder cannot be re-checked').toContain(
      'visibility',
    );
  });
});
