/**
 * PROP-O3 and PROP-O4 — the payload's shape and the honesty guarantee.
 *
 * These are counting tests on purpose. §17: "Enforced by a test that counts them, not
 * by good intentions."
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  AFFORDANCE_KEYS,
  OBSERVE_KEYS,
  VERBS,
  actionCostOf,
  affordanceFaults,
  assertObservation,
  buildObservation,
  checkObservation,
  isVerb,
  observationHash,
  verbsOffered,
} from '../../src/observe/index.js';
import { VERB_CLASS } from '../../src/world/index.js';
import { costOf } from '../../src/tick/index.js';
import {
  ALICE,
  BRAM,
  CASS,
  bookRow,
  fixture,
  goLive,
  grantFrom,
  levyOwing,
  makeHaul,
  sourcesFor,
} from './fixture.js';
import { minor } from '../../src/core/units.js';

describe('PROP-O3 — exactly ten top-level keys, in order', () => {
  it('names them in §12.1’s order and no others', () => {
    expect(OBSERVE_KEYS).toEqual([
      'header',
      'hands',
      'holding',
      'obligations',
      'ventures',
      'counterparties',
      'grants',
      'market',
      'affordances',
      'briefing',
    ]);
    expect(OBSERVE_KEYS.length).toBe(10);
  });

  it('a built observation has exactly those keys, in that order', () => {
    const f = fixture();
    const built = buildObservation(sourcesFor(f), ALICE);
    expect(Object.keys(built.observation)).toEqual([...OBSERVE_KEYS]);
    assertObservation(built.observation);
  });

  it('a fully loaded observation still has ten keys — the budget is at its ceiling', () => {
    const f = fixture();
    const haul = makeHaul(f);
    goLive(f, haul, [BRAM, CASS], minor(12_000));
    const sources = sourcesFor(f, {
      levy: levyOwing(f),
      market: [bookRow(f.stage, 'ore'), bookRow(f.stage, 'ice')],
      grants: [grantFrom({ delegate: BRAM })],
      grantTemplates: [
        {
          template: 'treasury.spend',
          max_direct_loss: minor(9_000),
          max_contingent_liability: minor(3_000),
          expires_tick: 400,
        },
      ],
      ballots: [{ id: 'b-1', kind: 'LEVY', closes_tick: 200, voted: false, target: null }],
      talks: [{ venture: haul.id, counterparty: BRAM, unread: 2, last_tick: 1 }],
    });
    const built = buildObservation(sources, ALICE);
    expect(Object.keys(built.observation).length).toBe(10);
    expect(checkObservation(built.observation)).toEqual([]);
  });

  it('detects an eleventh key rather than tolerating it', () => {
    const f = fixture();
    const built = buildObservation(sourcesFor(f), ALICE);
    const mutant = { ...built.observation, extra: 1 } as unknown as typeof built.observation;
    expect(checkObservation(mutant).join(' ')).toContain('PROP-O3');
  });
});

describe('PROP-O3 — the verb budget, cross-checked against the world module', () => {
  it('is 39 verbs, under §17’s cap of 40', () => {
    expect(VERBS.length).toBe(39);
    expect(VERBS.length).toBeLessThanOrEqual(40);
    expect(new Set(VERBS).size).toBe(VERBS.length);
  });

  it('is exactly the set world/commons.ts classifies — not a subset either way', () => {
    // Two lists of the same 39 words is the drift scar #1 is made of, so this asserts
    // equality in both directions rather than containment in one.
    const classified = Object.keys(VERB_CLASS).sort((a, b) => (a < b ? -1 : 1));
    const offered = [...VERBS].sort((a, b) => (a < b ? -1 : 1));
    expect(offered).toEqual(classified);
  });

  it('classifies every published verb as a verb', () => {
    for (const verb of VERBS) expect(isVerb(verb)).toBe(true);
    expect(isVerb('betray')).toBe(false);
  });
});

describe('PROP-O4 — every affordance carries its full cost', () => {
  it('publishes all eight fields on every affordance of a loaded observation', () => {
    const f = fixture();
    const haul = makeHaul(f);
    goLive(f, haul, [BRAM, CASS], minor(12_000));
    const built = buildObservation(
      sourcesFor(f, { levy: levyOwing(f), market: [bookRow(f.stage, 'ore')] }),
      ALICE,
    );
    expect(built.observation.affordances.length).toBeGreaterThan(3);
    for (const affordance of built.observation.affordances) {
      for (const key of AFFORDANCE_KEYS) {
        expect(
          Object.prototype.hasOwnProperty.call(affordance, key),
          `${affordance.verb} is missing ${key}`,
        ).toBe(true);
      }
      expect(Number.isSafeInteger(affordance.max_direct_loss)).toBe(true);
      expect(affordance.max_direct_loss).toBeGreaterThanOrEqual(0);
      expect(Number.isSafeInteger(affordance.max_contingent_liability)).toBe(true);
      expect(affordance.max_contingent_liability).toBeGreaterThanOrEqual(0);
      expect(affordance.quote_id.length).toBeGreaterThan(0);
      expect(affordance.expires_tick).toBeGreaterThanOrEqual(built.observation.header.tick);
      expect(affordance.what_it_forecloses.length).toBeGreaterThan(0);
    }
  });

  it('a missing field is a hard failure, not a default', () => {
    const f = fixture();
    const built = buildObservation(sourcesFor(f), ALICE);
    const [first] = built.observation.affordances;
    expect(first).toBeDefined();
    if (first === undefined) return;
    for (const key of AFFORDANCE_KEYS) {
      const mutant = { ...first } as unknown as Record<string, unknown>;
      delete mutant[key];
      const faults = affordanceFaults(mutant as never, built.observation.header.tick);
      expect(faults.join(' '), `deleting ${key} was tolerated`).toContain('PROP-O4');
    }
  });

  it('quotes the cost the engine actually charges, free verbs included', () => {
    const f = fixture();
    const haul = makeHaul(f);
    goLive(f, haul, [BRAM, CASS], minor(12_000));
    const built = buildObservation(sourcesFor(f), ALICE);
    for (const affordance of built.observation.affordances) {
      if (affordance.verb === 'seal') continue; // §17's own allowance; see below.
      expect(affordance.cost, affordance.verb).toBe(costOf(affordance.verb) === 'FREE' ? 0 : 1);
    }
    expect(built.observation.affordances.some((a) => a.verb === 'message' && a.cost === 0)).toBe(true);
  });

  it('the seal allowance is the only exception, and only for seals', () => {
    // §17 gives one free seal per role held and src/tick/budget.ts deliberately does
    // not know about it. The exception is therefore narrow and asserted, not implied.
    expect(actionCostOf('seal', true)).toBe(0);
    expect(actionCostOf('seal', false)).toBe(1);
    expect(actionCostOf('move', true)).toBe(1);
    expect(affordanceFaults({ ...stubAffordance('move'), cost: 0 }, 1, true).join(' ')).toContain(
      'free allowance',
    );
  });

  it('an affordance that expires before this tick is refused', () => {
    const faults = affordanceFaults({ ...stubAffordance('move'), expires_tick: 0 }, 5);
    expect(faults.join(' ')).toContain('already died');
  });
});

describe('the payload is a stable, hashable artifact', () => {
  it('hashes identically for the same sources — DET-1 on the read surface', () => {
    const f = fixture();
    const sources = sourcesFor(f);
    expect(observationHash(buildObservation(sources, ALICE).observation)).toBe(
      observationHash(buildObservation(sources, ALICE).observation),
    );
  });

  it('canonicalises for random action budgets and wake counts', () => {
    const f = fixture();
    const haul = makeHaul(f);
    goLive(f, haul, [BRAM, CASS], minor(12_000));
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 4 }),
        fc.integer({ min: 0, max: 16 }),
        fc.integer({ min: 1, max: 280 }),
        (actions, wakes, tick) => {
          const built = buildObservation(
            sourcesFor(f, { actionsRemaining: actions, wakesRemaining: wakes, tick }),
            ALICE,
          );
          expect(checkObservation(built.observation)).toEqual([]);
        },
      ),
      { numRuns: 40 },
    );
  });

  it('offers only verbs whose engine exists, and says which those are', () => {
    // Most of the 39 verbs have no state table yet. That is documented in
    // catalogue.ts and asserted here so the day one ships, this list moves with it.
    const f = fixture();
    const haul = makeHaul(f);
    goLive(f, haul, [BRAM, CASS], minor(12_000));
    const offered = verbsOffered(
      buildObservation(
        sourcesFor(f, {
          levy: levyOwing(f),
          market: [bookRow(f.stage, 'ore')],
          grants: [grantFrom({ delegate: BRAM })],
          ballots: [{ id: 'b-1', kind: 'LEVY', closes_tick: 200, voted: false, target: null }],
        }),
        ALICE,
      ).observation,
    );
    for (const verb of offered) expect(isVerb(verb)).toBe(true);
    expect(offered).not.toContain('extract');
    expect(offered).not.toContain('post_bond');
    expect(offered).toContain('create');
    expect(offered).toContain('move');
  });
});

/** A minimal well-formed affordance, for the mutation tests. */
function stubAffordance(verb: 'move'): Parameters<typeof affordanceFaults>[0] {
  return {
    verb,
    params: {},
    cost: 1,
    max_direct_loss: minor(0),
    max_contingent_liability: minor(0),
    what_it_forecloses: ['nothing'],
    expires_tick: 10,
    quote_id: 'q1:abc',
  };
}
