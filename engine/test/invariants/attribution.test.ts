/**
 * The INV-17 plumbing — the door, not just the detector.
 *
 * A check that runs after the fact can only tell you the record is already wrong, and
 * the record is permanent. So {@link DefaultRegister.attribute} is the only way an
 * accusation gets recorded and it refuses everything that would make one
 * unjustifiable. These tests are that door being tried.
 */

import { describe, expect, it } from 'vitest';
import type { EventId } from '../../src/core/types.js';
import {
  AttributionError,
  DEFAULT_CAUSE_KINDS,
  DEFAULT_EVENT_KINDS,
  DefaultRegister,
  checkInv17,
  isDefaultEventKind,
  touchedObjects,
} from '../../src/invariants/index.js';
import { VENTURE_EVENT_KINDS } from '../../src/venture/events.js';
import { ALICE, BOB, HAUL, fixture, publicEvent } from './fixture.js';

function row(overrides: Partial<Parameters<DefaultRegister['attribute']>[0]> = {}) {
  return {
    defaultEventId: 'ev:1:1' as EventId,
    promisor: ALICE,
    obligation: HAUL,
    cause: 'LOSS' as const,
    causeEventId: 'ev:1:0' as EventId,
    tick: 1,
    reckoningIndex: 0,
    ...overrides,
  };
}

describe('the register is the door', () => {
  it('accepts a well-formed attribution', () => {
    const register = new DefaultRegister();
    register.attribute(row());
    expect(register.size).toBe(1);
    expect(register.has('ev:1:1' as EventId)).toBe(true);
    expect(register.of('ev:1:1' as EventId)?.cause).toBe('LOSS');
  });

  it('refuses an accusation with no cause event', () => {
    const register = new DefaultRegister();
    expect(() => {
      register.attribute(row({ causeEventId: '' as EventId }));
    }).toThrow(AttributionError);
    expect(() => {
      register.attribute(row({ causeEventId: '' as EventId }));
    }).toThrow(/accusing an innocent agent/);
  });

  it('refuses an accusation that cites itself', () => {
    const register = new DefaultRegister();
    expect(() => {
      register.attribute(row({ causeEventId: 'ev:1:1' as EventId }));
    }).toThrow(/cites itself/);
  });

  it('refuses a second, different cause for the same accusation', () => {
    const register = new DefaultRegister();
    register.attribute(row());
    // Two causes means the engine does not know which is true, which is
    // indistinguishable from having neither.
    expect(() => {
      register.attribute(row({ causeEventId: 'ev:1:2' as EventId }));
    }).toThrow(/already attributed/);
  });

  it('refuses a cause outside the three TESTING.md §3 names', () => {
    const register = new DefaultRegister();
    expect(() => {
      register.attribute(row({ cause: 'VIBES' as never }));
    }).toThrow(/not one of the three causes/);
    expect([...DEFAULT_CAUSE_KINDS]).toEqual(['LOSS', 'MISSED_DELIVERY', 'ELAPSED_WINDOW']);
  });

  it('refuses an accusation that names nobody', () => {
    const register = new DefaultRegister();
    expect(() => {
      register.attribute(row({ promisor: '' as never }));
    }).toThrow(/must name the principal/);
  });

  it('the attribution it stores is frozen', () => {
    const register = new DefaultRegister();
    register.attribute(row());
    const stored = register.of('ev:1:1' as EventId);
    expect(stored).toBeDefined();
    if (stored === undefined) return;
    expect(Object.isFrozen(stored)).toBe(true);
  });

  it('reports in a deterministic order and can be queried per principal', () => {
    const register = new DefaultRegister();
    register.attribute(row({ defaultEventId: 'ev:2:0' as EventId, promisor: BOB }));
    register.attribute(row());
    expect(register.all().map((r) => r.defaultEventId)).toEqual(['ev:1:1', 'ev:2:0']);
    expect(register.against(ALICE)).toHaveLength(1);
    expect(register.against(BOB)).toHaveLength(1);
  });
});

describe('what counts as an accusation', () => {
  it('recognises the registered kinds', () => {
    for (const kind of DEFAULT_EVENT_KINDS) expect(isDefaultEventKind(kind)).toBe(true);
  });

  it('recognises an unregistered name that still reads as one', () => {
    expect(isDefaultEventKind('SOME_NEW_DEFAULT')).toBe(true);
    expect(isDefaultEventKind('DEFAULT_RECORDED')).toBe(true);
    expect(isDefaultEventKind('OFFICE_DEFAULTS')).toBe(true);
  });

  it('does NOT treat a deferral as an accusation', () => {
    // SPEC §15.3: an obligation unresolved at the cascade round limit DEFERS and
    // never defaults. A pattern that matched the DEF prefix would turn every
    // legitimate deferral into a halt — a false halt in the mechanism that exists to
    // prevent a false default.
    expect(isDefaultEventKind('OBLIGATION_DEFERRED')).toBe(false);
    expect(isDefaultEventKind('VENTURE_DEFERRED')).toBe(false);
    expect(isDefaultEventKind('DEFERRAL')).toBe(false);
  });

  it('does not fire on ordinary kinds', () => {
    for (const kind of ['VENTURE_SETTLED', 'CARGO_LOST', 'RAID_STRUCK', 'STORES_FUNDED']) {
      expect(isDefaultEventKind(kind)).toBe(false);
    }
  });

  it('recognises the kind the venture module actually publishes — the only real producer', () => {
    // The regression this pins. `src/venture/events.ts` names its kinds
    // `venture.default` / `venture.deferred`; this file's net was an uppercase word
    // boundary on `_DEFAULT`, so `isDefaultEventKind('venture.default')` was **false**
    // and INV-17 — the top-severity check in the codebase — walked straight past every
    // real accusation the engine produces. Both tables are imported here so the two
    // conventions can never drift apart in silence again.
    expect(isDefaultEventKind(VENTURE_EVENT_KINDS.defaulted)).toBe(true);
    // And the clause that must survive the widening: a deferral is not a breach.
    expect(isDefaultEventKind(VENTURE_EVENT_KINDS.deferred)).toBe(false);
    for (const kind of [
      VENTURE_EVENT_KINDS.formed,
      VENTURE_EVENT_KINDS.filled,
      VENTURE_EVENT_KINDS.settled,
      VENTURE_EVENT_KINDS.loss,
      VENTURE_EVENT_KINDS.deferred,
    ]) {
      expect(isDefaultEventKind(kind), `${kind} is not an accusation`).toBe(false);
    }
  });

  it('every kind either side of the two naming conventions agrees', () => {
    // A dot-separated name is now recognised in either case, because the engine runs
    // both conventions at once (`SEAL_RESOLVED` in seal, `venture.formed` in venture).
    expect(isDefaultEventKind('grant.default')).toBe(true);
    expect(isDefaultEventKind('LEVY_DEFAULTED')).toBe(true);
    expect(isDefaultEventKind('office.deferred')).toBe(false);
  });
});

describe('the forward walk, on the clauses only the record can answer', () => {
  it('fires when the cited cause is not in the ledger at all', () => {
    const f = fixture();
    const defaulted = publicEvent(f.events, { tick: 1, kind: 'VENTURE_DEFAULTED', actor: ALICE });
    const register = new DefaultRegister();
    register.attribute(
      row({ defaultEventId: defaulted, causeEventId: 'ev:never-published' as EventId }),
    );
    const violations = checkInv17(f.events, register, 1, { scope: 'FULL' });
    expect(violations.some((v) => v.message.includes('which is not in the ledger'))).toBe(true);
  });

  it('fires when the cause arrives after the effect it is supposed to explain', () => {
    // The clause that stops "whatever event happened to be nearby" from being
    // evidence. A raid three Reckonings later cannot have broken last week's promise.
    const f = fixture();
    const defaulted = publicEvent(f.events, { tick: 1, kind: 'VENTURE_DEFAULTED', actor: ALICE });
    const later = publicEvent(f.events, { tick: 5, kind: 'RAID_STRUCK', actor: BOB });
    const register = new DefaultRegister();
    register.attribute(row({ defaultEventId: defaulted, causeEventId: later }));
    const violations = checkInv17(f.events, register, 5, { scope: 'FULL' });
    expect(
      violations.some((v) => v.message.includes('a cause cannot arrive after its effect')),
    ).toBe(true);
  });
});

describe('the check walks both directions', () => {
  it('fires on an attribution whose default event was never published', () => {
    const f = fixture();
    const register = new DefaultRegister();
    register.attribute(row({ defaultEventId: 'ev:99:0' as EventId }));
    const violations = checkInv17(f.events, register, 1, { scope: 'FULL' });
    expect(violations.map((v) => v.id)).toContain('INV-17');
    expect(violations[0]?.message).toContain('not in the ledger');
  });

  it('fires on an attribution that explains an event which is not a default', () => {
    const f = fixture();
    const cause = publicEvent(f.events, { tick: 1, kind: 'RAID_STRUCK', actor: BOB });
    const settled = publicEvent(f.events, {
      tick: 1,
      kind: 'VENTURE_SETTLED',
      actor: ALICE,
      parent: cause,
    });
    const register = new DefaultRegister();
    register.attribute(row({ defaultEventId: settled, causeEventId: cause }));
    const violations = checkInv17(f.events, register, 1, { scope: 'FULL' });
    expect(violations.some((v) => v.message.includes('which is not a default'))).toBe(true);
  });

  it('fires when the accusation names a different principal than the event', () => {
    const f = fixture();
    const cause = publicEvent(f.events, { tick: 1, kind: 'RAID_STRUCK', actor: BOB });
    const defaulted = publicEvent(f.events, {
      tick: 1,
      kind: 'VENTURE_DEFAULTED',
      actor: ALICE,
      parent: cause,
    });
    const register = new DefaultRegister();
    register.attribute(row({ defaultEventId: defaulted, causeEventId: cause, promisor: BOB }));
    const violations = checkInv17(f.events, register, 1, { scope: 'FULL' });
    expect(violations.some((v) => v.message.includes('is recorded against'))).toBe(true);
  });

  it('scopes to one tick when asked, so the production pass is not O(history)', () => {
    const f = fixture();
    publicEvent(f.events, { tick: 1, kind: 'VENTURE_DEFAULTED', actor: ALICE });
    const register = new DefaultRegister();
    // The unattributed default is at tick 1; a pass scoped to tick 2 does not see it.
    expect(checkInv17(f.events, register, 2, { scope: { tick: 2 } })).toEqual([]);
    expect(checkInv17(f.events, register, 1, { scope: { tick: 1 } }).length).toBeGreaterThan(0);
  });
});

describe('the settlement-set object scan', () => {
  it('collects the id columns and every string in the payload', () => {
    const f = fixture();
    const id = publicEvent(f.events, {
      tick: 1,
      kind: 'RAID_STRUCK',
      actor: BOB,
      payload: { target: 'stores:alice', nested: { venture: HAUL, amounts: [1, 2] }, list: ['x'] },
    });
    const rec = f.events.get(id);
    expect(rec).not.toBeNull();
    if (rec === null) return;
    const touched = touchedObjects(rec.event);
    expect(touched.has(BOB)).toBe(true);
    expect(touched.has('stores:alice')).toBe(true);
    expect(touched.has(HAUL)).toBe(true);
    expect(touched.has('x')).toBe(true);
    // Integers are not object references.
    expect(touched.has('1')).toBe(false);
  });

  it('refuses a payload it cannot see the bottom of, rather than missing a reference', () => {
    // A false positive costs an operator a conversation; a false negative costs a
    // principal its name. So the scan fails loudly rather than silently shallow.
    let deep: Record<string, unknown> = { leaf: 'stores:alice' };
    for (let i = 0; i < 12; i += 1) deep = { down: deep };
    const event = {
      id: 'ev:1:0' as EventId,
      tick: 1,
      seqInTick: 0,
      kind: 'DEEP',
      rulesVersion: 1,
      actorPrincipalId: null,
      onBehalfOfPrincipalId: null,
      grantId: null,
      eventFamilyId: 'DEEP',
      parentEventId: null,
      isPublic: true,
      publicAt: 1,
      declassifyAt: 1,
      provenanceClass: 'FACT' as const,
      actedOnStateVersion: 1,
      decisionSource: null,
      payload: deep as Readonly<Record<string, unknown>>,
    };
    expect(() => touchedObjects(event)).toThrow(/cannot see the bottom/);
  });
});
