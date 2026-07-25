/**
 * PROP-VI5 — no jsonb ACL anywhere; the audience fan-out table is used, and
 * private-feed paging never degrades to a scan.
 *
 * The cost claim is measured, not asserted by inspection: {@link
 * LedgerMetrics.entriesExamined} counts every stream row a read touched, and the
 * decisive test is that the count is **identical** for a ledger of 500 foreign
 * events and one of 4,000. A jsonb ACL cannot do that — it has to read the rows
 * to know whether they are yours — and the failure it produces is not an error
 * but a Reckoning that takes minutes, in front of an audience.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { PrincipalId } from '../../src/core/types.js';
import { EventLedger, type FeedCursor } from '../../src/events/index.js';
import { pid, publicEvent, sensedEvent } from './helpers.js';

const READER = pid('reader');

/**
 * A ledger with `foreign` events nobody but their own parties can read, and
 * `mine` SENSED events the reader is in range for, interleaved.
 */
function buildLedger(foreign: number, mine: number): EventLedger {
  const ledger = new EventLedger();
  const stride = Math.max(1, Math.floor(foreign / Math.max(1, mine)));
  let placed = 0;
  for (let i = 0; i < foreign; i += 1) {
    const tick = i;
    ledger.append(publicEvent({ tick, kind: 'DEPART', actor: pid(`other${i % 40}`) }));
    if (i % stride === 0 && placed < mine) {
      ledger.append(
        sensedEvent({
          tick,
          inRange: [READER],
          declassifyAtTick: foreign + 10_000,
          payload: { good: 'ore', qty: i },
        }),
      );
      placed += 1;
    }
  }
  return ledger;
}

function drainAudience(
  ledger: EventLedger,
  principal: PrincipalId,
  atTick: number,
  limit: number,
): number {
  let cursor: FeedCursor | null = null;
  let count = 0;
  for (let guard = 0; guard < 1000; guard += 1) {
    const page = ledger.audiencePage({ principal, atTick, after: cursor, limit });
    count += page.views.length;
    if (page.complete || page.nextCursor === null) return count;
    cursor = page.nextCursor;
  }
  throw new Error('audience paging did not terminate');
}

describe('PROP-VI5 — the fan-out is a table, and paging it is not a scan', () => {
  it('costs the same to page one principal out of 500 events as out of 4,000', () => {
    const small = buildLedger(500, 20);
    const large = buildLedger(4000, 20);

    small.metrics.entriesExamined = 0;
    const smallPage = small.audiencePage({
      principal: READER,
      atTick: 5000,
      after: null,
      limit: 10,
    });
    const smallCost = small.metrics.entriesExamined;

    large.metrics.entriesExamined = 0;
    const largePage = large.audiencePage({
      principal: READER,
      atTick: 5000,
      after: null,
      limit: 10,
    });
    const largeCost = large.metrics.entriesExamined;

    expect(smallPage.views).toHaveLength(10);
    expect(largePage.views).toHaveLength(10);
    // The whole point: cost is the page, not the ledger.
    expect(largeCost).toBe(smallCost);
    expect(largeCost).toBeLessThanOrEqual(11);
  });

  it('a deep cursor is a seek, not a walk from the beginning', () => {
    const ledger = buildLedger(4000, 60);
    // Page to the far end of this principal's audience stream.
    let cursor: FeedCursor | null = null;
    for (let i = 0; i < 5; i += 1) {
      const page = ledger.audiencePage({ principal: READER, atTick: 5000, after: cursor, limit: 10 });
      cursor = page.nextCursor;
    }
    expect(cursor).not.toBeNull();
    ledger.metrics.entriesExamined = 0;
    const deep = ledger.audiencePage({ principal: READER, atTick: 5000, after: cursor, limit: 10 });
    expect(deep.views).toHaveLength(10);
    // 50 rows already behind the cursor were not touched to find row 51.
    expect(ledger.metrics.entriesExamined).toBeLessThanOrEqual(11);
  });

  it('delivers every audience row exactly once across pages', () => {
    const ledger = buildLedger(1000, 37);
    expect(drainAudience(ledger, READER, 5000, 7)).toBe(37);
    expect(drainAudience(ledger, READER, 5000, 1)).toBe(37);
    expect(drainAudience(ledger, READER, 5000, 500)).toBe(37);
  });

  it('materialises the fan-out as rows, one per (event, principal)', () => {
    const ledger = new EventLedger();
    const cargo = ledger.append(sensedEvent({ tick: 0, inRange: [pid('a'), pid('b')], declassifyAtTick: 99 }));
    ledger.admitAudience(cargo.event.id, pid('c'), 'INTEL', 4);
    const rows = ledger.allAudienceRows();
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.basis)).toEqual(['IN_RANGE', 'IN_RANGE', 'INTEL']);
    // Each row is dated, which is what lets a late reveal reach a live cursor.
    expect(rows.map((r) => r.admittedAtTick)).toEqual([0, 0, 4]);
    expect(ledger.audienceRowCount).toBe(3);
  });

  it('decides readership without reading the payload', () => {
    // Two records identical but for their payload read identically for every
    // principal at every tick. If an ACL ever moved into jsonb, this breaks.
    const ledger = new EventLedger();
    const plain = ledger.append(sensedEvent({ tick: 0, inRange: [pid('a')], declassifyAtTick: 50 }));
    const loaded = ledger.append(
      sensedEvent({
        tick: 0,
        inRange: [pid('a')],
        declassifyAtTick: 50,
        payload: { acl: ['b', 'c'], audience: ['d'], readers: ['e'], visibleTo: 'everyone' },
      }),
    );
    for (const principal of [pid('a'), pid('b'), pid('c'), pid('d'), pid('e')]) {
      for (const atTick of [0, 10, 49, 50, 51]) {
        const one = ledger.audiencePage({ principal, atTick, after: null, limit: 50 });
        const seen = new Set(one.views.map((v) => v.event.id as string));
        expect(seen.has(plain.event.id as string)).toBe(seen.has(loaded.event.id as string));
      }
    }
  });
});

describe('no reveal lands behind a cursor already issued', () => {
  it('delivers a second same-tick admission for an older event', () => {
    // The hazard: two intel purchases settled in the same tick, for events
    // written at different ticks. Ordered by (revealTick, eventTick) the second
    // one sorts *behind* the cursor the reader was just handed, and is never
    // delivered — a silent hole in the one artifact whose value is completeness.
    const ledger = new EventLedger();
    const older = ledger.append(sensedEvent({ tick: 1, inRange: [pid('a')], declassifyAtTick: 500 }));
    const newer = ledger.append(sensedEvent({ tick: 2, inRange: [pid('a')], declassifyAtTick: 500 }));

    expect(ledger.admitAudience(newer.event.id, READER, 'INTEL', 10)).toBe(true);
    const first = ledger.audiencePage({ principal: READER, atTick: 10, after: null, limit: 10 });
    expect(first.views.map((v) => v.event.id)).toEqual([newer.event.id]);

    expect(ledger.admitAudience(older.event.id, READER, 'INTEL', 10)).toBe(true);
    const second = ledger.audiencePage({
      principal: READER,
      atTick: 10,
      after: first.nextCursor,
      limit: 10,
    });
    expect(second.views.map((v) => v.event.id)).toEqual([older.event.id]);
  });

  it('is deterministic: the same call sequence yields the same cursors and feed', () => {
    const build = (): { ids: string[]; cursors: string[] } => {
      const ledger = new EventLedger();
      for (let tick = 0; tick < 12; tick += 1) {
        ledger.append(publicEvent({ tick }));
        const cargo = ledger.append(
          sensedEvent({ tick, inRange: [pid('a')], declassifyAtTick: tick + 6 }),
        );
        ledger.admitAudience(cargo.event.id, READER, 'INTEL', tick);
      }
      const ids: string[] = [];
      const cursors: string[] = [];
      let cursor: FeedCursor | null = null;
      for (let i = 0; i < 20; i += 1) {
        const page = ledger.agentFeed({ principal: READER, atTick: 40, after: cursor, limit: 3 });
        ids.push(...page.views.map((v) => v.event.id as string));
        if (page.nextCursor !== null) {
          cursors.push(`${page.nextCursor.revealedAtTick}:${page.nextCursor.ordinal}`);
        }
        if (page.complete || page.nextCursor === null) break;
        cursor = page.nextCursor;
      }
      return { ids, cursors };
    };
    const a = build();
    const b = build();
    expect(a).toEqual(b);
    expect(a.ids.length).toBeGreaterThan(0);
    // Every event appears exactly once in the reader's feed.
    expect(new Set(a.ids).size).toBe(a.ids.length);
  });
});

describe('PROP-VI5 — the schema half: a table, not a jsonb ACL', () => {
  const schema = readFileSync(
    new URL('../../src/db/schema.sql', import.meta.url).pathname,
    'utf8',
  );

  it('declares event_audience as a table with an index on principal', () => {
    expect(schema).toMatch(/CREATE TABLE IF NOT EXISTS event_audience/);
    expect(schema).toMatch(/principal_id\s+text\s+NOT NULL/);
    expect(schema).toMatch(/CREATE INDEX[^;]*event_audience[^;]*\(\s*principal_id/s);
  });

  it('declares exactly one jsonb column on event, and it is the payload', () => {
    const eventTable = /CREATE TABLE IF NOT EXISTS event \(([\s\S]*?)\n\)/.exec(schema);
    expect(eventTable).not.toBeNull();
    const body = eventTable?.[1] ?? '';
    const jsonbColumns = [...body.matchAll(/^\s*(\w+)\s+jsonb/gm)].map((m) => m[1]);
    expect(jsonbColumns).toEqual(['payload']);
    // And no ACL by any other name.
    expect(body).not.toMatch(/\b(acl|readers|visible_to|allow_list)\b/i);
  });
});
