/**
 * PROP-O7 — an illegal action is not an error.
 *
 * > "Illegal actions return the violated invariant, the changed fields, the nearest
 * > legal affordance, and a fresh observation — never an error, never a bare rejection."
 *
 * `agent.md` §7 promises the same four things in the same order, and adds the clause
 * that makes it a rules surface: *"Never a stack trace, never a bare rejection.
 * Correction goes to you privately — it never appears in the public feed."*
 *
 * The last clause is scar #10, and it is asserted structurally: this module appends
 * nothing anywhere, so there is no event ledger to check — which is the point.
 */

import { describe, expect, it } from 'vitest';
import { minor } from '../../src/core/units.js';
import {
  OBSERVE_KEYS,
  buildObservation,
  changedKeys,
  correctionFaults,
  correctionFor,
  nearestLegal,
} from '../../src/observe/index.js';
import { commonsFloorRejection, moveHand, reject } from '../../src/world/index.js';
import { fillRole } from '../../src/venture/index.js';
import { ALICE, BRAM, CASS, fixture, goLive, handOf, makeHaul, sourcesFor } from './fixture.js';

describe('PROP-O7 — the four fields, from a real refusal', () => {
  it('carries the invariant, the hint, the nearest legal act and a fresh observation', () => {
    const f = fixture();
    makeHaul(f, { creator: ALICE });
    const observation = buildObservation(sourcesFor(f), ALICE).observation;

    // A real refusal from the world module, not a hand-written one: a RAID aimed into
    // the Commons is invalid under A8.
    const rejection = commonsFloorRejection(f.world, 'create', { kind: 'RAID', principal: ALICE });
    expect(rejection).not.toBeNull();
    if (rejection === null) return;

    const correction = correctionFor({
      principal: ALICE,
      rejection,
      verb: 'create',
      observation,
      actedOn: observation,
    });

    expect(correction.ok).toBe(false);
    expect(correction.invariant).toBe('A8');
    expect(correction.hint.length).toBeGreaterThan(20);
    expect(correction.nearest).not.toBeNull();
    // The nearest legal `create` — a peaceful kind, since the hostile ones are invalid.
    expect(correction.nearest?.verb).toBe('create');
    expect(Object.keys(correction.observation)).toEqual([...OBSERVE_KEYS]);
    expect(correctionFaults(correction)).toEqual([]);
  });

  it('carries a real refusal from the venture module too', () => {
    const f = fixture();
    const haul = makeHaul(f, { creator: ALICE, windowOpensTick: 0, windowClosesTick: 2 });
    const result = fillRole(haul, 0, handOf(f, BRAM, 1), 50);
    expect(result.ok).toBe(false);
    if (result.ok) return;

    const observation = buildObservation(sourcesFor(f, { tick: 50 }), BRAM).observation;
    const correction = correctionFor({
      principal: BRAM,
      rejection: result,
      verb: 'fill_role',
      observation,
      actedOn: null,
    });
    expect(correction.invariant).toBe('PROP-V6');
    expect(correction.hint).toContain('window');
    expect(correctionFaults(correction)).toEqual([]);
  });

  it('never a stack trace — the checker catches one if it ever leaks in', () => {
    const f = fixture();
    const observation = buildObservation(sourcesFor(f), ALICE).observation;
    const correction = correctionFor({
      principal: ALICE,
      rejection: reject('INV-9', 'Error: boom\n    at Module.foo (/src/x.ts:1:1)'),
      verb: 'move',
      observation,
      actedOn: null,
    });
    expect(correctionFaults(correction).join(' ')).toContain('stack trace');
  });

  it('a refusal with options available always names one — no dead ends', () => {
    const f = fixture();
    const observation = buildObservation(sourcesFor(f), ALICE).observation;
    expect(observation.affordances.length).toBeGreaterThan(0);
    const correction = correctionFor({
      principal: ALICE,
      rejection: reject('A4', 'no actions left'),
      // A verb the catalogue never publishes, so `nearest` has to fall back.
      verb: 'audit',
      observation,
      actedOn: null,
    });
    expect(correction.nearest).not.toBeNull();
    expect(correctionFaults(correction)).toEqual([]);
  });

  it('the hint is capped like every other prose field', () => {
    const f = fixture();
    const observation = buildObservation(sourcesFor(f), ALICE).observation;
    const correction = correctionFor({
      principal: ALICE,
      rejection: reject('INV-9', 'x'.repeat(2_000)),
      verb: 'move',
      observation,
      actedOn: null,
    });
    expect(correction.hint.length).toBe(240);
  });
});

describe('PROP-O7 — "what changed" is a fact, not a guess', () => {
  it('reports nothing changed when nothing changed', () => {
    const f = fixture();
    const observation = buildObservation(sourcesFor(f), ALICE).observation;
    expect(changedKeys(observation, observation)).toEqual([]);
  });

  it('reports every key when the agent’s snapshot is gone', () => {
    const f = fixture();
    const observation = buildObservation(sourcesFor(f), ALICE).observation;
    expect(changedKeys(null, observation)).toEqual([...OBSERVE_KEYS]);
  });

  it('names the keys a real world change touched', () => {
    const f = fixture();
    const before = buildObservation(sourcesFor(f, { tick: 1 }), ALICE).observation;

    // A real move: one hand leaves. Header (the clock), hands (the body), affordances
    // (what is left to do) and the briefing all move; the holding does not.
    const hand = handOf(f, ALICE, 1);
    const destination = [...f.world.map.systems.get(hand.location)?.lanes ?? []][0];
    expect(destination).toBeDefined();
    if (destination === undefined) return;
    const moved = moveHand(f.world, hand.id, destination, 1);
    expect(moved.ok).toBe(true);

    const after = buildObservation(sourcesFor(f, { tick: 2 }), ALICE).observation;
    const changed = changedKeys(before, after);
    expect(changed).toContain('hands');
    expect(changed).toContain('header');
    expect(changed).toContain('affordances');
    expect(changed).not.toContain('holding');
  });

  it('compares canonically, so property order is not a change', () => {
    const f = fixture();
    const observation = buildObservation(sourcesFor(f), ALICE).observation;
    // Same logical payload, different insertion order inside a nested object.
    const reordered = {
      ...observation,
      obligations: {
        exposure: observation.obligations.exposure,
        levy: observation.obligations.levy,
      },
    };
    expect(changedKeys(observation, reordered)).toEqual([]);
  });

  it('a venture appearing shows up as a change to ventures and counterparties', () => {
    const f = fixture();
    const before = buildObservation(sourcesFor(f, { tick: 1 }), ALICE).observation;
    const haul = makeHaul(f, { creator: ALICE, windowOpensTick: 1, windowClosesTick: 100 });
    goLive(f, haul, [BRAM, CASS], minor(12_000), 1);
    const after = buildObservation(sourcesFor(f, { tick: 1 }), ALICE).observation;
    const changed = changedKeys(before, after);
    expect(changed).toContain('ventures');
    expect(changed).toContain('counterparties');
  });
});

describe('nearestLegal picks the same verb first, and never invents a target', () => {
  it('prefers the same verb, richest first', () => {
    const f = fixture();
    const observation = buildObservation(sourcesFor(f), ALICE).observation;
    const creates = observation.affordances.filter((a) => a.verb === 'create');
    expect(creates.length).toBeGreaterThan(1);
    expect(nearestLegal(observation.affordances, 'create')?.verb).toBe('create');
  });

  it('falls back to the first affordance when the verb is unavailable', () => {
    const f = fixture();
    const observation = buildObservation(sourcesFor(f), ALICE).observation;
    expect(nearestLegal(observation.affordances, 'siege')).toBe(observation.affordances[0]);
  });

  it('returns null rather than fabricating when there is nothing legal', () => {
    expect(nearestLegal([], 'move')).toBeNull();
  });
});
