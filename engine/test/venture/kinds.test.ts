/**
 * The kind table, and the three properties derived from it.
 *
 * The reason this file exists separately from the property suites: `minRoles`,
 * `isEscrowable` and `isTopYield` are all derived from one number, so the table
 * itself is the rules surface. A wrong number here makes PROP-V5 and PROP-V6 pass
 * while the game they describe no longer exists.
 */

import { describe, expect, it } from 'vitest';
import { BPS_ONE, minor } from '../../src/core/units.js';
import type { VentureKind } from '../../src/core/types.js';
import {
  MAX_ROLES_PER_VENTURE,
  MIN_ROLES,
  MIN_ROLES_TOP_YIELD,
  TOP_YIELD_THRESHOLD_MINOR,
  VENTURE_KINDS,
  assertKindTable,
  electiveFloor,
  isEscrowable,
  isTopYield,
  kindSpec,
  minRoles,
  principalsRequired,
  topYieldKinds,
  KindError,
} from '../../src/venture/index.js';

describe('the venture kind table', () => {
  it('is internally consistent, in both directions', () => {
    expect(() => {
      assertKindTable();
    }).not.toThrow();
  });

  it('covers exactly the eight kinds in the §17 budget', () => {
    // PROP-O3 counts the union; this asserts the table has an entry per member, so a
    // ninth kind cannot be added to `core/types.ts` without a spec here.
    expect(VENTURE_KINDS).toHaveLength(8);
    for (const kind of VENTURE_KINDS) {
      expect(kindSpec(kind).kind).toBe(kind);
    }
  });

  it('refuses an unknown kind rather than returning an inherited property', () => {
    // `VENTURE_KINDS` is an object literal, so a bare index would hand back
    // Object.prototype's `constructor` — a function, neither undefined nor a spec.
    // Same class of hole as `declaredClass` in world/commons.ts.
    for (const attack of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      expect(() => kindSpec(attack as VentureKind)).toThrow(KindError);
    }
  });

  it('marginal outputs sum to 10000 bps per kind, so a full fill yields the base', () => {
    for (const kind of VENTURE_KINDS) {
      const total = kindSpec(kind).roles.reduce<number>((a, r) => a + r.marginalOutputBps, 0);
      expect(total, kind).toBe(BPS_ONE);
    }
  });

  it('derives top-yield, minRoles and escrowability from one number', () => {
    for (const kind of VENTURE_KINDS) {
      const top = kindSpec(kind).baseYieldMinor >= TOP_YIELD_THRESHOLD_MINOR;
      expect(isTopYield(kind), kind).toBe(top);
      expect(minRoles(kind), kind).toBe(top ? MIN_ROLES_TOP_YIELD : MIN_ROLES);
      // PROP-V5: the highest-yield kinds are legally un-escrowable.
      expect(isEscrowable(kind), kind).toBe(!top);
    }
  });

  it('has a non-empty, non-total top-yield set', () => {
    // Both degenerate thresholds are silent failures: none deletes §7.5's
    // un-escrowable prize, all forces four principals on the newcomer loop.
    const tops = topYieldKinds();
    expect(tops.length).toBeGreaterThan(0);
    expect(tops.length).toBeLessThan(VENTURE_KINDS.length);
    expect([...tops]).toEqual(['BUILD', 'SIEGE']);
  });

  it('keeps predation and the newcomer loop reachable by a small party', () => {
    // §9: an agent-initiated raid is a small party plus joiners. §13: DIG is the
    // newcomer loop. Forcing four principals on either deletes a shipped mechanic.
    expect(principalsRequired('RAID')).toBe(MIN_ROLES);
    expect(principalsRequired('DIG')).toBe(MIN_ROLES);
  });

  it('bounds every role array (INV-26, scar #3)', () => {
    for (const kind of VENTURE_KINDS) {
      expect(kindSpec(kind).roles.length).toBeLessThanOrEqual(MAX_ROLES_PER_VENTURE);
    }
  });
});

describe('f(kind) — the elective floor (§7.5)', () => {
  it('rises with venture value', () => {
    const small = electiveFloor('HAUL', minor(1_000));
    const large = electiveFloor('HAUL', minor(1_000_000));
    expect(large).toBeGreaterThan(small);
  });

  it('rounds up, so the floor is never one minor unit slack', () => {
    // HAUL's proportional term is 2500 bps. 25% of 401 is 100.25, and a floor of 100
    // would let a role sit a quarter of a unit under the rule on every venture
    // forever — how a margin requirement quietly stops binding.
    expect(electiveFloor('HAUL', minor(401))).toBe(101);
  });

  it('has an absolute term, so a tiny venture still risks something', () => {
    // 25% of 40 is 10, below HAUL's absolute floor of 100 — so the whole 40 is
    // elective. Proportional-only would let a small venture risk nothing.
    expect(electiveFloor('HAUL', minor(40))).toBe(40);
  });

  it('is the whole consideration on an un-escrowable kind', () => {
    for (const kind of topYieldKinds()) {
      expect(electiveFloor(kind, minor(50_000)), kind).toBe(50_000);
    }
  });

  it('never exceeds the consideration, so a small venture is possible rather than illegal', () => {
    for (const kind of VENTURE_KINDS) {
      for (const value of [1, 7, 99, 100, 5_000, 1_000_000]) {
        expect(electiveFloor(kind, minor(value)), `${kind} @ ${value}`).toBeLessThanOrEqual(value);
      }
    }
  });

  it('is zero for a role priced at nothing', () => {
    expect(electiveFloor('HAUL', minor(0))).toBe(0);
  });
});
