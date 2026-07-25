/**
 * PROP-V6 — role concurrency.
 *
 * > Role concurrency: roles must be live in the same window; one principal fills at
 * > most one role; >=4 roles on top-yield kinds. **Assert a solo principal *cannot*
 * > satisfy a top-yield kind at any capital level.**
 *
 * §7.2 records why this is the property the design lives or dies on: the v2.0 draft's
 * presence budget did not bind, because 3 hands x 24 h is ~72 hand-hours a day against
 * ~6 for a serialised three-role haul. "An agent could simply dig in the morning,
 * escort its own load at noon, and deliver in the evening — twelve solo ventures a
 * day, no counterparty ever needed."
 */

import { describe, expect, it } from 'vitest';
import { bps, minor } from '../../src/core/units.js';
import type { PrincipalId } from '../../src/core/types.js';
import {
  BookError,
  MIN_ROLES_TOP_YIELD,
  VENTURE_KINDS,
  assertSoloCannotSatisfyTopYield,
  checkVentureStructure,
  createVenture,
  fillRole,
  isTopYield,
  kindSpec,
  minRoles,
  principalsRequired,
  soloIsImpossible,
  windowsOverlap,
  fullyElectiveShare,
} from '../../src/venture/index.js';
import { checkInv9, handsOf } from '../../src/world/index.js';
import {
  ALICE,
  BRAM,
  CASS,
  DOV,
  ESK,
  RULES_VERSION,
  fill,
  fixture,
  handOf,
  makeHaul,
  share,
  vid,
  wage,
  type Fixture,
} from './fixture.js';

describe('PROP-V6 clause 3 — >=4 roles on top-yield kinds', () => {
  it('gives every top-yield kind at least four roles', () => {
    for (const kind of VENTURE_KINDS) {
      if (!isTopYield(kind)) continue;
      expect(kindSpec(kind).roles.length, kind).toBeGreaterThanOrEqual(MIN_ROLES_TOP_YIELD);
      expect(minRoles(kind), kind).toBe(MIN_ROLES_TOP_YIELD);
    }
  });

  it('states the requirement in principals, which is the number that binds', () => {
    for (const kind of VENTURE_KINDS) {
      // One role per principal, so the role count *is* the principal count.
      expect(principalsRequired(kind), kind).toBe(minRoles(kind));
      expect(soloIsImpossible(kind), kind).toBe(true);
    }
  });

  it('asserts a solo principal cannot satisfy a top-yield kind — with no capital argument', () => {
    // The function takes no balance. That is the whole point: the requirement is a
    // role count plus one-role-per-principal, and neither reads capital, so "at any
    // capital level" is not a claim about a large number.
    expect(() => {
      assertSoloCannotSatisfyTopYield();
    }).not.toThrow();
  });

  it('a solo principal with unbounded capital and three hands still cannot fill a SIEGE', () => {
    // The empirical version of the same claim, constructed the way an optimiser would:
    // maximum capital, every hand it is allowed to have, and every fill attempted.
    const f = fixture(minor(1_000_000_000));
    const spec = kindSpec('SIEGE');
    const created = createVenture({
      id: vid('v-siege'),
      kind: 'SIEGE',
      creator: ALICE,
      stage: f.stage,
      terms: spec.roles.map(() => fullyElectiveShare(bps(1_000), minor(20_000))),
      windowOpensTick: 0,
      windowClosesTick: 100,
      resolvesAtTick: 200,
      valuation: f.valuation,
      rulesVersion: RULES_VERSION,
      preference: [],
      visibility: 'PUBLIC',
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const venture = f.book.add(created.value);

    // Alice has exactly three hands and the kind has four roles. She fills one.
    fill(f, venture, 0, ALICE, 1, 1);

    // Every further attempt with every remaining hand is refused — and refused on the
    // *principal* rule, not on hand supply. That distinction matters: if the rule were
    // about hands, three of the four roles would be hers and only one counterparty
    // would be needed, and §7.2's arithmetic would not bind.
    const hands = handsOf(f.world, ALICE);
    expect(hands).toHaveLength(3);
    for (const roleIndex of [1, 2, 3]) {
      for (const hand of hands) {
        const result = fillRole(venture, roleIndex, hand, 1);
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.invariant).toBe('PROP-V6');
      }
    }

    // Four distinct principals do satisfy it.
    for (const [i, principal] of [BRAM, CASS, DOV].entries()) {
      fill(f, venture, i + 1, principal, 1, 1);
    }
    expect(venture.roles.every((r) => r.filledByPrincipal !== null)).toBe(true);
    expect(new Set(venture.roles.map((r) => r.filledByPrincipal)).size).toBe(4);
  });
});

describe('PROP-V6 clause 2 — one principal fills at most one role in a venture', () => {
  it('refuses a second role to the same principal, with a different hand', () => {
    const f = fixture();
    const haul = makeHaul(f);
    fill(f, haul, 0, ALICE, 1, 1);
    const secondHand = handOf(f, ALICE, 2);
    const result = fillRole(haul, 1, secondHand, 1);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.invariant).toBe('PROP-V6');
      expect(result.hint).toContain('capital');
    }
  });

  it('is asserted as well as enforced, so a bypass halts the tick', () => {
    const f = fixture();
    const haul = makeHaul(f);
    fill(f, haul, 0, ALICE, 1, 1);
    expect(checkVentureStructure(f.book, 1)).toEqual([]);

    // Write the row the way a careless migration or a direct SQL patch would.
    const role = haul.roles[1];
    if (role === undefined) throw new Error('fixture');
    role.filledByPrincipal = ALICE;
    role.filledByHandId = handOf(f, ALICE, 2).id;

    const faults = checkVentureStructure(f.book, 1);
    expect(faults.map((v) => v.id)).toContain('PROP-V6');
    expect(faults.every((v) => v.severity === 'HALT')).toBe(true);
  });
});

describe('PROP-V6 clause 1 — roles are live in the same window', () => {
  it('has one window per venture, so roles cannot be serialised inside one', () => {
    // Structural: there is nowhere to put a second window. The assertion is that the
    // record exposes exactly one pair of window ticks, shared by every role.
    const f = fixture();
    const haul = makeHaul(f, { windowOpensTick: 10, windowClosesTick: 20 });
    expect(haul.windowOpensTick).toBe(10);
    expect(haul.windowClosesTick).toBe(20);
    for (const role of haul.roles) {
      expect(Object.keys(role)).not.toContain('windowOpensTick');
    }
  });

  it('refuses a fill outside the window', () => {
    const f = fixture();
    const haul = makeHaul(f, { windowOpensTick: 10, windowClosesTick: 20 });
    for (const tick of [9, 21, 100]) {
      const result = fillRole(haul, 0, handOf(f, ALICE), tick);
      expect(result.ok, `tick ${tick}`).toBe(false);
      if (!result.ok) expect(result.invariant).toBe('PROP-V6');
    }
    expect(fillRole(haul, 0, handOf(f, ALICE), 10).ok).toBe(true);
  });

  it('refuses a window that closes before it opens, and a resolution before the close', () => {
    const f = fixture();
    const bad = createVenture({
      id: vid('v-bad-window'),
      kind: 'HAUL',
      creator: ALICE,
      stage: f.stage,
      terms: [wage(1_000, 1_000), share(bps(3_000), 500, 700)],
      windowOpensTick: 50,
      windowClosesTick: 10,
      resolvesAtTick: 200,
      valuation: f.valuation,
      rulesVersion: RULES_VERSION,
      preference: [],
      visibility: 'PUBLIC',
    });
    expect(bad.ok).toBe(false);

    const early = createVenture({
      id: vid('v-early-resolve'),
      kind: 'HAUL',
      creator: ALICE,
      stage: f.stage,
      terms: [wage(1_000, 1_000), share(bps(3_000), 500, 700)],
      windowOpensTick: 0,
      windowClosesTick: 100,
      resolvesAtTick: 50,
      valuation: f.valuation,
      rulesVersion: RULES_VERSION,
      preference: [],
      visibility: 'PUBLIC',
    });
    expect(early.ok).toBe(false);
  });

  it('overlap is inclusive at the boundary — one shared tick is an overlap', () => {
    expect(windowsOverlap({ windowOpensTick: 0, windowClosesTick: 10 }, { windowOpensTick: 10, windowClosesTick: 20 })).toBe(true);
    expect(windowsOverlap({ windowOpensTick: 0, windowClosesTick: 9 }, { windowOpensTick: 10, windowClosesTick: 20 })).toBe(false);
  });
});

describe('INV-9 — the partial unique index on filled_by_hand_id', () => {
  it('refuses a hand a second live role, across ventures', () => {
    const f = fixture();
    const a = makeHaul(f, { id: vid('v-a') });
    const b = makeHaul(f, { id: vid('v-b'), creator: BRAM });
    fill(f, a, 0, ALICE, 1, 1);

    // The venture would accept it — a different venture, a different principal slot.
    // The *index* is what refuses, which is why the check lives in the book.
    const hand = handOf(f, ALICE, 1);
    expect(fillRole(b, 1, hand, 1).ok).toBe(true);
    expect(() => {
      f.book.indexFill(b.id, 1, hand.id);
    }).toThrow(BookError);
  });

  it('is partial: a resolved venture keeps its row but frees the hand', () => {
    const f = fixture();
    const a = makeHaul(f, { id: vid('v-a') });
    fill(f, a, 0, ALICE, 1, 1);
    const handId = handOf(f, ALICE, 1).id;
    expect(f.book.commitmentOf(handId)).not.toBeNull();

    const freed = f.book.resolve(a.id, 'SETTLED', 5);
    expect(freed).toContain(handId);
    expect(f.book.commitmentOf(handId)).toBeNull();
    // The historical fact survives — the record is append-only and "who carried that
    // cargo" is permanent.
    expect(a.roles[0]?.filledByHandId).toBe(handId);

    // And the hand is free to fill again.
    const b = makeHaul(f, { id: vid('v-b'), creator: BRAM });
    expect(fillRole(b, 1, handOf(f, ALICE, 1), 1).ok).toBe(true);
    expect(() => {
      f.book.indexFill(b.id, 1, handId);
    }).not.toThrow();
  });

  it('detects index drift in both directions', () => {
    const f = fixture();
    const a = makeHaul(f, { id: vid('v-a') });
    fill(f, a, 0, ALICE, 1, 1);
    expect(f.book.checkVentureInvariants(1)).toEqual([]);

    // A row written without the index — the careless-migration case TESTING.md names.
    const role = a.roles[1];
    if (role === undefined) throw new Error('fixture');
    role.filledByHandId = handOf(f, BRAM, 1).id;
    role.filledByPrincipal = BRAM;
    const drifted = f.book.indexFaults(1);
    expect(drifted.some((v) => v.message.includes('absent from the index'))).toBe(true);

    // And the reverse: an index entry with no row behind it silently forbids a legal
    // fill, which reads to an agent as the world refusing something legal.
    const g = fixture();
    const c = makeHaul(g, { id: vid('v-c') });
    fill(g, c, 0, ALICE, 1, 1);
    expect(g.book.indexFaults(1)).toEqual([]);
    // Clear the row without telling the index — the other direction of the same
    // careless migration.
    const cleared = c.roles[0];
    if (cleared === undefined) throw new Error('fixture');
    cleared.filledByHandId = null;
    cleared.filledByPrincipal = null;
    const stale = g.book.indexFaults(1);
    expect(stale.some((v) => v.message.includes('stale entry'))).toBe(true);
    expect(stale.every((v) => v.severity === 'HALT')).toBe(true);
  });

  it('feeds checkInv9 counts that agree with the world', () => {
    const f = fixture();
    const a = makeHaul(f, { id: vid('v-a') });
    fill(f, a, 0, ALICE, 1, 1);
    fill(f, a, 1, BRAM, 1, 1);

    const fills = f.book.roleFills();
    expect(fills.get(handOf(f, ALICE, 1).id)).toBe(1);
    expect(fills.get(handOf(f, BRAM, 1).id)).toBe(1);
    // The world's own INV-9, using this module's counts. A hand in a role must be
    // COMMITTED or IN_TRANSIT, and a COMMITTED hand must be in a role.
    expect(checkInv9(f.world, 1, fills)).toEqual([]);
  });

  it('flags a hand committed to two overlapping windows even if the index is clean', () => {
    // A replayed snapshot could carry both rows. The window claim and the count claim
    // have different failure modes, so both are asserted.
    const f: Fixture = fixture();
    const a = makeHaul(f, { id: vid('v-a'), windowOpensTick: 0, windowClosesTick: 50 });
    const b = makeHaul(f, { id: vid('v-b'), creator: BRAM, windowOpensTick: 40, windowClosesTick: 90 });
    fill(f, a, 0, ALICE, 1, 1);
    a.state = 'LIVE';
    b.state = 'LIVE';
    const role = b.roles[1];
    if (role === undefined) throw new Error('fixture');
    role.filledByHandId = handOf(f, ALICE, 1).id;
    role.filledByPrincipal = ALICE;

    const faults = f.book.overlapFaults(1);
    expect(faults).toHaveLength(1);
    expect(faults[0]?.id).toBe('PROP-V6');
    expect(faults[0]?.message).toContain('overlap');
  });
});

describe('the fill preconditions the world owns', () => {
  it('refuses a hand that is not present yet', () => {
    const f = fixture();
    const haul = makeHaul(f);
    const hand = handOf(f, ESK, 1);
    hand.presentSinceTick = 9;
    const result = fillRole(haul, 0, hand, 1);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.invariant).toBe('INV-9');
  });

  it('refuses a recovering hand, because a lost hand must leave its role', () => {
    const f = fixture();
    const haul = makeHaul(f);
    const hand = handOf(f, DOV, 1);
    hand.state = 'RECOVERING';
    hand.freeAtTick = 30;
    const result = fillRole(haul, 0, hand, 1);
    expect(result.ok).toBe(false);
  });

  it('refuses a role that is already filled', () => {
    const f = fixture();
    const haul = makeHaul(f);
    fill(f, haul, 0, ALICE, 1, 1);
    const result = fillRole(haul, 0, handOf(f, CASS, 1), 1);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.invariant).toBe('INV-9');
  });
});

describe('the arithmetic of presence, restated', () => {
  it('an agent cannot serialise a day of solo ventures through one hand', () => {
    // §7.2's failing scenario, run: one principal, one hand, many ventures whose
    // windows overlap. The second fill is refused by the index, so the twelve-solo-
    // ventures-a-day strategy is arithmetically unavailable rather than discouraged.
    const f = fixture();
    const hand = handOf(f, ALICE, 1);
    const ventures = [0, 1, 2, 3].map((i) =>
      makeHaul(f, {
        id: vid(`v-serial-${i}`),
        creator: [ALICE, BRAM, CASS, DOV][i] as PrincipalId,
        windowOpensTick: i * 5,
        windowClosesTick: i * 5 + 40,
      }),
    );
    let accepted = 0;
    for (const venture of ventures) {
      const roleIndex = venture.creator === ALICE ? 1 : 0;
      const result = fillRole(venture, roleIndex, hand, 20);
      if (!result.ok) continue;
      try {
        f.book.indexFill(venture.id, roleIndex, hand.id);
        accepted += 1;
      } catch {
        // The index refused: the hand is already committed.
      }
    }
    expect(accepted).toBe(1);
  });
});
