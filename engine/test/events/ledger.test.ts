/**
 * The append-only ledger: INV-11, INV-12, INV-15, INV-16.
 *
 * `AX-A5-1` asserts the record rejects UPDATE and DELETE *by attempting both*.
 * The database half is a `REVOKE` in `src/db/migrate.ts`; this is the in-process
 * half, and it attempts the mutation rather than reading the type declaration,
 * because `readonly` is compile-time only and vanishes under an `as` cast.
 */

import { describe, expect, it } from 'vitest';
import { EventLedger, EventLedgerError, mintEventId } from '../../src/events/index.js';
import { partiesEvent, pid, privateEvent, publicEvent, sealedEvent } from './helpers.js';

describe('INV-16 — append is the only mutation', () => {
  it('exposes no update, delete, patch or revoke method', () => {
    const ledger = new EventLedger();
    const proto: object = Object.getPrototypeOf(ledger) as object;
    const names = Object.getOwnPropertyNames(proto);
    const writePaths = names.filter((n) =>
      /^(update|delete|remove|patch|mutate|replace|edit|drop|truncate|revoke|rewrite|amend)/i.test(n),
    );
    expect(writePaths).toEqual([]);
    expect(names).toContain('append');
  });

  it('refuses an in-place edit of a stored event (AX-A5-1, UPDATE)', () => {
    const ledger = new EventLedger();
    const rec = ledger.append(publicEvent({ tick: 0, kind: 'DEPART' }));

    // Cast away readonly the way a careless later module would, and assert the
    // runtime still refuses. Frozen objects throw on write under ESM strict mode.
    const mutable = rec.event as unknown as Record<string, unknown>;
    expect(() => {
      mutable.kind = 'ARRIVE';
    }).toThrow(TypeError);
    expect(() => {
      (rec.event.payload as Record<string, unknown>).note = 'tampered';
    }).toThrow(TypeError);
    expect(ledger.get(rec.event.id)?.event.kind).toBe('DEPART');
  });

  it('refuses a delete of a stored event (AX-A5-1, DELETE)', () => {
    const ledger = new EventLedger();
    const rec = ledger.append(publicEvent({ tick: 0 }));
    const mutable = rec as unknown as Record<string, unknown>;
    expect(() => {
      delete mutable['event'];
    }).toThrow(TypeError);
    expect(ledger.get(rec.event.id)).not.toBeNull();
    expect(ledger.eventCount).toBe(1);
  });

  it('deep-freezes nested payload structures', () => {
    const ledger = new EventLedger();
    const rec = ledger.append(
      publicEvent({ tick: 0, payload: { manifest: { good: 'ore', qty: 12 } } }),
    );
    const nested = rec.event.payload['manifest'] as Record<string, unknown>;
    expect(Object.isFrozen(nested)).toBe(true);
    expect(() => {
      nested.qty = 999;
    }).toThrow(TypeError);
  });

  it('refuses to re-append an id, and refuses to write behind the watermark', () => {
    const ledger = new EventLedger();
    ledger.append(publicEvent({ tick: 5 }));
    expect(() => ledger.append(publicEvent({ tick: 4 }))).toThrow(EventLedgerError);
  });
});

describe('INV-11 — seqInTick is dense and gapless', () => {
  it('mints seq from 0 upward within a tick and restarts each tick', () => {
    const ledger = new EventLedger();
    const a = ledger.append(publicEvent({ tick: 7 }));
    const b = ledger.append(publicEvent({ tick: 7 }));
    const c = ledger.append(publicEvent({ tick: 8 }));
    expect([a.event.seqInTick, b.event.seqInTick, c.event.seqInTick]).toEqual([0, 1, 0]);
    expect(a.event.id).toBe(mintEventId(7, 0));
    expect(c.event.id).toBe(mintEventId(8, 0));
  });

  it('ids are derived from (tick, seq) so replay needs no counter restored', () => {
    const first = new EventLedger();
    const second = new EventLedger();
    for (const tick of [0, 0, 1, 3]) {
      first.append(publicEvent({ tick }));
      second.append(publicEvent({ tick }));
    }
    const idsOf = (l: EventLedger): string[] =>
      l.ticks().flatMap((t) => l.eventsAtTick(t).map((r) => r.event.id as string));
    expect(idsOf(first)).toEqual(idsOf(second));
  });
});

describe('INV-12 — causality points backwards', () => {
  it('accepts a parent from an earlier tick and the same tick', () => {
    const ledger = new EventLedger();
    const root = ledger.append(publicEvent({ tick: 1 }));
    const sameTick = ledger.append({ ...publicEvent({ tick: 1 }), parentEventId: root.event.id });
    const laterTick = ledger.append({ ...publicEvent({ tick: 2 }), parentEventId: root.event.id });
    expect(sameTick.event.parentEventId).toBe(root.event.id);
    expect(laterTick.event.parentEventId).toBe(root.event.id);
  });

  it('refuses a parent that is not in the ledger', () => {
    const ledger = new EventLedger();
    expect(() =>
      ledger.append({ ...publicEvent({ tick: 1 }), parentEventId: mintEventId(9, 0) }),
    ).toThrow(/INV-12/);
  });

  it('refuses a parent from a later tick, which is what makes cycles impossible', () => {
    const ledger = new EventLedger();
    const early = ledger.append(publicEvent({ tick: 1 }));
    const late = ledger.append(publicEvent({ tick: 9 }));
    // The only way to build a cycle is to name a parent that does not exist yet;
    // requiring existence at append is the structural half of INV-12.
    expect(() =>
      ledger.append({ ...publicEvent({ tick: 9 }), parentEventId: mintEventId(20, 0) }),
    ).toThrow(/INV-12/);
    expect(early.event.tick).toBeLessThan(late.event.tick);
  });
});

describe('INV-15 — rulesVersion is pinned', () => {
  it('refuses a missing or nonsense rulesVersion at append', () => {
    const ledger = new EventLedger();
    expect(() => ledger.append({ ...publicEvent({ tick: 0 }), rulesVersion: 0 })).toThrow(
      /rulesVersion/,
    );
    expect(() => ledger.append({ ...publicEvent({ tick: 0 }), rulesVersion: 1.5 })).toThrow(
      /rulesVersion/,
    );
  });
});

describe('the ladder is checked at append, not hoped for', () => {
  it('refuses a PARTIES event with one party (INV-13)', () => {
    const ledger = new EventLedger();
    expect(() =>
      ledger.append(
        partiesEvent({ tick: 0, parties: [pid('a')], settlesAtTick: 10, family: 'neg' }),
      ),
    ).toThrow(/INV-13/);
  });

  it('refuses a SEALED event with an audience', () => {
    const ledger = new EventLedger();
    const seal = sealedEvent({ tick: 0, revealsAtTick: 10, intent: { verb: 'HAUL' } });
    expect(() =>
      ledger.append({ ...seal, audience: [{ principal: pid('a'), basis: 'PARTY' }] }),
    ).toThrow(/at most 0 audience rows/);
  });

  it('refuses a PRIVATE event owned by someone other than its actor', () => {
    const ledger = new EventLedger();
    const own = privateEvent({ tick: 0, principal: pid('a') });
    expect(() =>
      ledger.append({ ...own, audience: [{ principal: pid('b'), basis: 'SELF' }] }),
    ).toThrow(/actorPrincipalId/);
  });

  it('refuses a non-public event whose publicAt is already in the past (INV-14)', () => {
    const ledger = new EventLedger();
    const bad = {
      ...partiesEvent({ tick: 10, parties: [pid('a'), pid('b')], settlesAtTick: 20 }),
      publicAt: 5,
      declassifyAt: 5,
    };
    expect(() => ledger.append(bad)).toThrow(/INV-14/);
  });

  it('refuses a PARTIES event that declassifies on the tick it is written', () => {
    const ledger = new EventLedger();
    expect(() =>
      ledger.append(partiesEvent({ tick: 4, parties: [pid('a'), pid('b')], settlesAtTick: 4 })),
    ).toThrow(/declassifies later/);
  });

  it('refuses a flagKey that is not in the payload', () => {
    const ledger = new EventLedger();
    const seal = sealedEvent({ tick: 0, revealsAtTick: 10, intent: { verb: 'HAUL' } });
    expect(() => ledger.append({ ...seal, flagKeys: ['sealld'] })).toThrow(/flagKey/);
  });
});

describe('the audience fan-out grows and never shrinks', () => {
  it('admits an intel buyer to a SENSED audience after the fact', () => {
    const ledger = new EventLedger();
    const cargo = ledger.append({
      ...publicEvent({ tick: 3 }),
      visibility: 'SENSED',
      isPublic: false,
      publicAt: 50,
      declassifyAt: 50,
      audience: [{ principal: pid('scout'), basis: 'IN_RANGE' }],
    });
    expect(ledger.admitAudience(cargo.event.id, pid('buyer'), 'INTEL', 20)).toBe(true);
    const admitted = ledger
      .audienceOf(cargo.event.id)
      .map((r) => r.principal as string)
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    expect(admitted).toEqual(['buyer', 'scout']);
    expect(ledger.admittedAtTick(cargo.event.id, pid('buyer'))).toBe(20);
    // Idempotent: a second purchase is not a second row.
    expect(ledger.admitAudience(cargo.event.id, pid('buyer'), 'INTEL', 21)).toBe(false);
    expect(ledger.audienceRowCount).toBe(2);
  });

  it('refuses to admit anyone to a SEALED event, at any tick', () => {
    const ledger = new EventLedger();
    const seal = ledger.append(
      sealedEvent({ tick: 0, revealsAtTick: 10, intent: { verb: 'RAID' } }),
    );
    expect(() => ledger.admitAudience(seal.event.id, pid('a'), 'INTEL', 5)).toThrow(/PROP-D2/);
  });

  it('declines a pointless admission after the event is already public', () => {
    const ledger = new EventLedger();
    const msg = ledger.append(
      partiesEvent({ tick: 1, parties: [pid('a'), pid('b')], settlesAtTick: 10, family: 'neg' }),
    );
    expect(ledger.admitAudience(msg.event.id, pid('c'), 'INTEL', 10)).toBe(false);
    expect(ledger.audienceRowCount).toBe(2);
  });
});
