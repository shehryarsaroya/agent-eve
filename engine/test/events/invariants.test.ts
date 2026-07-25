/**
 * The `ASSERT` phase over the record: INV-11 … INV-16.
 *
 * Every detector is tested **firing**, not only passing. A detector that has
 * never been seen to fire is a comment: three of these properties are
 * structural under the ledger's append path, so the only way to prove the
 * assertion works is to hand it a record the append path would have refused.
 */

import { describe, expect, it } from 'vitest';
import type { EventId, GameEvent, InvariantViolation } from '../../src/core/types.js';
import {
  EventLedger,
  appendOnlySurfaceViolations,
  assertEventInvariants,
  causalityViolations,
  fanOutViolations,
  mintEventId,
  recordIntegrityViolations,
  seqDensityViolations,
  type AudienceRow,
  type RecordSource,
  type EventRecord,
} from '../../src/events/index.js';
import { partiesEvent, pid, privateEvent, publicEvent, sealedEvent, sensedEvent } from './helpers.js';

const A = pid('anvil');
const B = pid('bellows');

function ids(violations: readonly InvariantViolation[]): string[] {
  return violations.map((v) => v.id);
}

/** A hand-built record. Invalid on purpose: the append path would refuse it. */
function craft(over: Partial<GameEvent> & { readonly tick: number; readonly seqInTick: number }): EventRecord {
  const event: GameEvent = {
    id: mintEventId(over.tick, over.seqInTick),
    kind: 'CRAFTED',
    rulesVersion: 1,
    actorPrincipalId: A,
    onBehalfOfPrincipalId: null,
    grantId: null,
    eventFamilyId: 'fam',
    parentEventId: null,
    isPublic: true,
    publicAt: over.tick,
    declassifyAt: over.tick,
    provenanceClass: 'FACT',
    actedOnStateVersion: null,
    decisionSource: 'LIVE',
    payload: {},
    ...over,
  };
  return Object.freeze({
    event: Object.freeze({ ...event, payload: Object.freeze(event.payload) }),
    visibility: 'PUBLIC' as const,
    flagKeys: [],
  });
}

function sourceOf(records: readonly EventRecord[], audience: readonly AudienceRow[] = []): RecordSource {
  const byId = new Map<EventId, EventRecord>(records.map((r) => [r.event.id, r]));
  return {
    get: (id) => byId.get(id) ?? null,
    audienceOf: (id) => audience.filter((row) => row.eventId === id),
  };
}

describe('a healthy ledger asserts clean', () => {
  it('passes TICK and FULL scope across a run of every tier', () => {
    const ledger = new EventLedger();
    for (let tick = 0; tick < 30; tick += 1) {
      const root = ledger.append(publicEvent({ tick }));
      ledger.append({ ...publicEvent({ tick }), parentEventId: root.event.id });
      if (tick % 3 === 0) {
        ledger.append(partiesEvent({ tick, parties: [A, B], settlesAtTick: tick + 20, family: 'neg' }));
      }
      if (tick % 4 === 0) {
        ledger.append(sensedEvent({ tick, inRange: [A], declassifyAtTick: tick + 50 }));
      }
      if (tick % 7 === 0) {
        ledger.append(sealedEvent({ tick, revealsAtTick: tick + 30, intent: { verb: 'HAUL' } }));
      }
      if (tick % 5 === 0) {
        ledger.append(privateEvent({ tick, principal: A, payload: { plan: 'wait' } }));
      }
      expect(assertEventInvariants(ledger, { tick, scope: 'TICK' })).toEqual([]);
    }
    expect(assertEventInvariants(ledger, { tick: 29, scope: 'FULL' })).toEqual([]);
  });

  it('passes after a widened SENSED audience — the one legal mutation (INV-14)', () => {
    const ledger = new EventLedger();
    const cargo = ledger.append(sensedEvent({ tick: 1, inRange: [A], declassifyAtTick: 288 }));
    expect(assertEventInvariants(ledger, { tick: 1, scope: 'TICK' })).toEqual([]);
    ledger.admitAudience(cargo.event.id, B, 'INTEL', 40);
    expect(assertEventInvariants(ledger, { tick: 40, scope: 'TICK' })).toEqual([]);
    expect(assertEventInvariants(ledger, { tick: 40, scope: 'FULL' })).toEqual([]);
  });
});

describe('INV-11 — the density detector fires', () => {
  it('catches a gap', () => {
    const records = [craft({ tick: 3, seqInTick: 0 }), craft({ tick: 3, seqInTick: 2 })];
    expect(ids(seqDensityViolations(records, 3))).toEqual(['INV-11']);
    expect(seqDensityViolations(records, 3)[0]?.message).toContain('no seqInTick 1');
  });

  it('catches a duplicate seq', () => {
    const one = craft({ tick: 3, seqInTick: 0 });
    expect(ids(seqDensityViolations([one, one], 3))).toContain('INV-11');
  });

  it('accepts a dense run and an empty tick', () => {
    const records = [0, 1, 2, 3].map((seqInTick) => craft({ tick: 9, seqInTick }));
    expect(seqDensityViolations(records, 9)).toEqual([]);
    expect(seqDensityViolations([], 9)).toEqual([]);
  });
});

describe('INV-12 — the causality detector fires', () => {
  it('catches a parent from a later tick', () => {
    const parent = craft({ tick: 9, seqInTick: 0 });
    const child = craft({ tick: 2, seqInTick: 0, parentEventId: parent.event.id });
    const violations = causalityViolations([child], sourceOf([parent, child]), 2);
    expect(ids(violations)).toContain('INV-12');
    expect(violations[0]?.message).toContain('a cause cannot arrive after its effect');
  });

  it('catches a parent later in the same tick', () => {
    const parent = craft({ tick: 5, seqInTick: 4 });
    const child = craft({ tick: 5, seqInTick: 1, parentEventId: parent.event.id });
    expect(ids(causalityViolations([child], sourceOf([parent, child]), 5))).toContain('INV-12');
  });

  it('catches a missing parent', () => {
    const child = craft({ tick: 5, seqInTick: 0, parentEventId: mintEventId(4, 0) });
    expect(ids(causalityViolations([child], sourceOf([child]), 5))).toContain('INV-12');
  });

  it('catches a cycle', () => {
    // Two rows naming each other. The append path cannot build this — a parent
    // must already exist — which is exactly why the detector needs its own test.
    const left = craft({ tick: 1, seqInTick: 0, parentEventId: mintEventId(1, 1) });
    const right = craft({ tick: 1, seqInTick: 1, parentEventId: mintEventId(1, 0) });
    const violations = causalityViolations([left, right], sourceOf([left, right]), 1);
    expect(violations.some((v) => v.message.includes('cycle'))).toBe(true);
  });

  it('accepts a long honest chain', () => {
    const chain: EventRecord[] = [craft({ tick: 0, seqInTick: 0 })];
    for (let i = 1; i < 40; i += 1) {
      chain.push(craft({ tick: i, seqInTick: 0, parentEventId: mintEventId(i - 1, 0) }));
    }
    expect(causalityViolations(chain, sourceOf(chain), 39)).toEqual([]);
  });
});

describe('INV-13 — the fan-out detector fires', () => {
  function row(eventId: EventId, principal: string, admittedAtTick: number): AudienceRow {
    return {
      eventId,
      eventTick: 0,
      eventSeqInTick: 0,
      principal: pid(principal),
      basis: 'PARTY',
      admittedAtTick,
    };
  }

  it('catches a PARTIES event with one row', () => {
    const rec: EventRecord = { ...craft({ tick: 0, seqInTick: 0 }), visibility: 'PARTIES' };
    const violations = fanOutViolations([rec], sourceOf([rec], [row(rec.event.id, 'a', 0)]), 0);
    expect(ids(violations)).toEqual(['INV-13']);
    expect(violations[0]?.message).toContain('needs >=2');
  });

  it('catches a SENSED event with none', () => {
    const rec: EventRecord = { ...craft({ tick: 0, seqInTick: 0 }), visibility: 'SENSED' };
    expect(ids(fanOutViolations([rec], sourceOf([rec]), 0))).toEqual(['INV-13']);
  });

  it('catches an audience row on a SEALED event', () => {
    const rec: EventRecord = { ...craft({ tick: 0, seqInTick: 0 }), visibility: 'SEALED' };
    const violations = fanOutViolations([rec], sourceOf([rec], [row(rec.event.id, 'a', 0)]), 0);
    expect(violations[0]?.message).toContain('allows <=0');
  });

  it('catches a row dated before its event', () => {
    const rec: EventRecord = { ...craft({ tick: 10, seqInTick: 0 }), visibility: 'SENSED' };
    const violations = fanOutViolations([rec], sourceOf([rec], [row(rec.event.id, 'a', 4)]), 10);
    expect(violations[0]?.message).toContain('before the event');
  });
});

describe('INV-15 and INV-16 — the row-integrity detectors fire', () => {
  it('catches a rulesVersion that was never pinned', () => {
    const rec = craft({ tick: 0, seqInTick: 0, rulesVersion: 0 });
    expect(ids(recordIntegrityViolations([rec], 0))).toContain('INV-15');
  });

  it('catches an unfrozen row', () => {
    const frozen = craft({ tick: 0, seqInTick: 0 });
    const thawed: EventRecord = { event: { ...frozen.event, payload: {} }, visibility: 'PUBLIC', flagKeys: [] };
    expect(ids(recordIntegrityViolations([thawed], 0))).toContain('INV-16');
  });

  it('catches a write path grown onto the ledger', () => {
    class Tampered extends EventLedger {
      // Exactly the method that must never exist. INV-16 is reflective because
      // the failure it guards against is a future method, not a bad call site.
      updateEvent(): void {
        throw new Error('unreachable');
      }
    }
    const violations = appendOnlySurfaceViolations(new Tampered(), 0);
    expect(ids(violations)).toContain('INV-16');
    expect(violations[0]?.message).toContain('updateEvent');
    // And the untampered ledger is clean.
    expect(appendOnlySurfaceViolations(new EventLedger(), 0)).toEqual([]);
  });
});
