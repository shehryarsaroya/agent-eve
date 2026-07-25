/**
 * Adversarial probes written by the verifier, not the builder.
 *
 * Each one is an attempt to break a claim the module makes about itself. The
 * ones that pass are recorded because a claim nobody tried to break is a claim
 * nobody has checked; the ones that fail are the findings.
 */

import { describe, expect, it } from 'vitest';
import {
  EventLedger,
  SEAL_FLAG_KEYS,
  assertEventInvariants,
  spectatorView,
  agentView,
  type FeedCursor,
} from '../../src/events/index.js';
import { partiesEvent, pid, publicEvent, sealedEvent, sensedEvent } from './helpers.js';

const A = pid('anvil');
const B = pid('bellows');
const C = pid('cinder');

describe('PROBE — the cursor hole, with a cursor that is actually non-null', () => {
  /**
   * `visibility.test.ts`'s "reaches a non-party feed at settlement" passes
   * `early.nextCursor`, which is **null** because that page delivered nothing —
   * so it never exercises the hazard it names. Here C genuinely holds a cursor
   * issued from reveal tick 20 before the tick-10 messages declassify at 40.
   */
  it('a non-party holding a live cursor still receives a tick-10 message at settlement', () => {
    const ledger = new EventLedger();
    ledger.append(partiesEvent({ tick: 10, kind: 'MESSAGE', family: 'neg', parties: [A, B], settlesAtTick: 40, payload: { line: 'you have my word' } }));
    // Public traffic C does read, so its cursor is real.
    for (let tick = 11; tick <= 20; tick += 1) ledger.append(publicEvent({ tick }));

    const early = ledger.agentFeed({ principal: C, atTick: 20, after: null, limit: 50 });
    expect(early.views).toHaveLength(10);
    expect(early.nextCursor).not.toBeNull();
    expect(early.nextCursor?.revealedAtTick).toBe(20);

    const late = ledger.agentFeed({ principal: C, atTick: 40, after: early.nextCursor, limit: 50 });
    expect(late.views.map((v) => v.event.payload['line'])).toEqual(['you have my word']);
  });

  it('a same-tick append after a read at that tick is still delivered', () => {
    const ledger = new EventLedger();
    ledger.append(publicEvent({ tick: 7, payload: { n: 1 } }));
    const first = ledger.spectatorFeed({ atTick: 7, after: null, limit: 50 });
    expect(first.views).toHaveLength(1);
    ledger.append(publicEvent({ tick: 7, payload: { n: 2 } }));
    const second = ledger.spectatorFeed({ atTick: 7, after: first.nextCursor, limit: 50 });
    expect(second.views.map((v) => v.event.payload['n'])).toEqual([2]);
  });

  it('a late intel admission reaches a reader whose cursor is already past the event tick', () => {
    const ledger = new EventLedger();
    const cargo = ledger.append(sensedEvent({ tick: 1, inRange: [A], declassifyAtTick: 500, payload: { good: 'ore' } }));
    for (let tick = 2; tick <= 30; tick += 1) ledger.append(publicEvent({ tick }));
    const before = ledger.agentFeed({ principal: C, atTick: 30, after: null, limit: 100 });
    expect(before.nextCursor?.revealedAtTick).toBe(30);
    ledger.admitAudience(cargo.event.id, C, 'INTEL', 31);
    const after = ledger.agentFeed({ principal: C, atTick: 31, after: before.nextCursor, limit: 100 });
    expect(after.views.map((v) => v.event.id)).toEqual([cargo.event.id]);
  });

  it('a party paging one at a time never receives a message twice', () => {
    const ledger = new EventLedger();
    for (let i = 0; i < 4; i += 1) {
      ledger.append(partiesEvent({ tick: 10 + i, kind: 'MESSAGE', family: 'neg', parties: [A, B], settlesAtTick: 40, payload: { i } }));
    }
    const seen: unknown[] = [];
    let cursor: FeedCursor | null = null;
    for (const atTick of [10, 11, 12, 13, 40, 41, 288]) {
      for (let guard = 0; guard < 20; guard += 1) {
        const page = ledger.agentFeed({ principal: A, atTick, after: cursor, limit: 1 });
        seen.push(...page.views.map((v) => v.event.id));
        if (page.nextCursor !== null) cursor = page.nextCursor;
        if (page.complete || page.views.length === 0) break;
      }
    }
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen).toHaveLength(4);
  });
});

describe('PROP-D2 — the flag allow-list is the ladder\'s, not the caller\'s', () => {
  /**
   * FOUND AND FIXED. `flagKeys` was an unrestricted caller-supplied allow-list:
   * the only check was that each key *existed* in the payload. Naming the intent
   * key published seal content to every agent and every viewer at the seal's own
   * Reckoning, through the ordinary append path, with no cast and no invariant
   * firing — the one prohibition this module calls absolute, left to caller
   * discipline in a module whose stated method is "checked at append, not hoped
   * for". `SEAL_FLAG_KEYS` now decides, and the append is refused.
   */
  it('refuses a SEALED event whose flagKeys name the intent', () => {
    const ledger = new EventLedger();
    const seal = sealedEvent({ tick: 260, revealsAtTick: 288, intent: { verb: 'RAID', target: 'gate-2' }, actor: A });
    expect(() => ledger.append({ ...seal, flagKeys: ['sealId', 'reckoningIndex', 'intent'] })).toThrow(
      /PROP-D2/,
    );
    expect(ledger.eventCount).toBe(0);
  });

  it('still admits the flag itself, and publishes only that', () => {
    const ledger = new EventLedger();
    const rec = ledger.append(
      sealedEvent({ tick: 260, revealsAtTick: 288, intent: { verb: 'RAID', target: 'gate-2' }, actor: A }),
    );
    expect(spectatorView(rec, 288)?.event.payload['intent']).toBeUndefined();
    expect(agentView(rec, C, 288, ledger)?.event.payload['intent']).toBeUndefined();
    const cmp = (x: string, y: string): number => (x < y ? -1 : x > y ? 1 : 0);
    expect(Object.keys(spectatorView(rec, 288)?.event.payload ?? {}).sort(cmp)).toEqual([
      'reckoningIndex',
      'sealId',
    ]);
  });

  it('every allowed flag key is a scalar, so no allowed key can carry a nested intent', () => {
    for (const key of SEAL_FLAG_KEYS) {
      expect(typeof key).toBe('string');
    }
    expect([...SEAL_FLAG_KEYS].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0))).toEqual([
      'reckoningIndex',
      'sealId',
    ]);
  });
});

describe('PROBE — feed cursors are not reconstructible', () => {
  /**
   * FINDING. `ordinal` is a per-instance write counter, not derived from the
   * record. Two ledgers holding the same logical facts, built by two legal
   * orders, mint different ordinals — so a cursor issued by one silently skips
   * events in the other. `event_audience` has no admission date and no
   * admission sequence, so the counter cannot be restored from the database
   * either: a cursor does not survive a restart or a snapshot resume (DET-5).
   */
  // Recorded with `it.fails`, following the house pattern in
  // test/core/vocabulary.test.ts: the defect is executable and the suite stays
  // honest about it, rather than red forever or silently forgotten.
  it.fails('DEFECT(events/ledger): a cursor replayed against a rebuilt ledger loses one event and re-delivers another', () => {
    // Two intel purchases settled in the same tick. The engine records neither
    // the admission tick nor an admission order in `event_audience`, so a
    // rebuild cannot know which came first — and the ordinal is minted from
    // write order alone.
    const build = (swap: boolean): { ledger: EventLedger; ore: string; ice: string } => {
      const ledger = new EventLedger();
      const ore = ledger.append(sensedEvent({ tick: 0, inRange: [B], declassifyAtTick: 500, payload: { good: 'ore' } }));
      const ice = ledger.append(sensedEvent({ tick: 0, inRange: [B], declassifyAtTick: 500, payload: { good: 'ice' } }));
      const order = swap ? [ice, ore] : [ore, ice];
      for (const rec of order) ledger.admitAudience(rec.event.id, A, 'INTEL', 3);
      return { ledger, ore: String(ore.event.id), ice: String(ice.event.id) };
    };
    const live = build(false);
    const rebuilt = build(true);

    const page = live.ledger.audiencePage({ principal: A, atTick: 3, after: null, limit: 1 });
    expect(page.views.map((v) => v.event.id as string)).toEqual([live.ore]);
    const cursor = page.nextCursor;

    // Same cursor, same logical facts, rebuilt ledger. `ice` is skipped forever
    // and `ore` is delivered a second time.
    const next = rebuilt.ledger.audiencePage({ principal: A, atTick: 3, after: cursor, limit: 10 });
    expect(next.views.map((v) => v.event.id as string)).toEqual([rebuilt.ice]);
  });
});

describe('PROBE — transcript is the one read with no cap', () => {
  /**
   * FINDING. `spectatorFeed`, `agentFeed` and `audiencePage` all go through
   * `requirePageLimit`, which even refuses a page of zero. `transcript` — the
   * receipt reel's query, and therefore a serialized agent- and viewer-facing
   * structure — takes no limit and no cursor and materialises the whole cohort.
   * INV-26 caps every array in every serialized structure, and scar #3 is
   * unbounded arrays becoming an OOM/disk DoS; a negotiation family is
   * caller-extensible, so its length is an agent's choice, not the engine's.
   */
  it.fails('DEFECT(events/ledger): transcript returns an unbounded cohort with no page cap', () => {
    const ledger = new EventLedger();
    const MESSAGES = 600;
    for (let i = 0; i < MESSAGES; i += 1) {
      ledger.append(
        partiesEvent({ tick: i, kind: 'MESSAGE', family: 'flood', parties: [A, B], settlesAtTick: MESSAGES + 1, payload: { i } }),
      );
    }
    const whole = ledger.transcript('flood', MESSAGES + 1, { kind: 'VIEWER' });
    // There is no cap to assert against, so assert the cap that INV-26 requires.
    expect(whole.length).toBeLessThanOrEqual(200);
  });
});

describe('PROBE — is_public is a birth flag, so the schema index cannot serve the public feed', () => {
  /**
   * FINDING (schema contract). A declassified PARTIES/SENSED event is readable
   * by everyone but still has `is_public = false` — the row is frozen and is
   * never updated, by design. `event_public_idx ... WHERE is_public` therefore
   * indexes only a subset of the public feed, and the query that reproduces
   * this module's spectator feed cannot use it.
   */
  it('a declassified PARTIES event is public to everyone while isPublic stays false', () => {
    const ledger = new EventLedger();
    const rec = ledger.append(partiesEvent({ tick: 10, parties: [A, B], settlesAtTick: 40, family: 'neg' }));
    expect(spectatorView(rec, 40)?.redaction).toBe('FULL');
    expect(rec.event.isPublic).toBe(false);
    // Read literally, INV-14 clause 3 ("public_at is never in the past while
    // is_public is false") is false for this row at every tick after 40.
    expect(rec.event.publicAt).toBe(40);
    const feed = ledger.spectatorFeed({ atTick: 41, after: null, limit: 10 });
    expect(feed.views.map((v) => v.event.id)).toContain(rec.event.id);
  });
});

describe('PROBE — invariant coverage holes', () => {
  it('INV-14 never records a descriptor for PUBLIC or SEALED, so it never compares them', () => {
    const ledger = new EventLedger();
    const pub = ledger.append(publicEvent({ tick: 0 }));
    const seal = ledger.append(sealedEvent({ tick: 0, revealsAtTick: 10, intent: { verb: 'RAID' } }));
    const sensed = ledger.append(sensedEvent({ tick: 0, inRange: [A], declassifyAtTick: 99 }));
    // The assert pass is what advances the snapshot.
    expect(ledger.previousDescriptor(pub.event.id)).toBeNull();
    expect(assertEventInvariants(ledger, { tick: 0, scope: 'TICK' })).toEqual([]);
    expect(ledger.previousDescriptor(sensed.event.id)).not.toBeNull();
    expect(ledger.previousDescriptor(pub.event.id)).toBeNull();
    expect(ledger.previousDescriptor(seal.event.id)).toBeNull();
  });

  it('admitAudience accepts a tick beyond the current tick and freezes the ledger against further appends', () => {
    const ledger = new EventLedger();
    const cargo = ledger.append(sensedEvent({ tick: 5, inRange: [A], declassifyAtTick: 500 }));
    // A caller bug, or a scheduled admission, at tick 100 while the loop is at 5.
    expect(ledger.admitAudience(cargo.event.id, B, 'INTEL', 100)).toBe(true);
    expect(ledger.lastTick).toBe(100);
    // Every tick from 6 to 99 can now never be written.
    expect(() => ledger.append(publicEvent({ tick: 6 }))).toThrow(/watermark/);
  });
});
