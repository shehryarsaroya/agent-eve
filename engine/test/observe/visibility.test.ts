/**
 * PROP-VI2 / AGT-X8 — cargo is `SENSED`, and it must not be derivable **by any exposed
 * field or combination**.
 *
 * > "Assert a principal with no hand in range and no purchased intel cannot derive cargo
 * > contents *by any exposed field or combination* — including through market depth,
 * > venture EV bands, or Exposure. Derivable-by-inference is the interesting failure
 * > here, and it needs its own probe (`AGT-X8`)."
 *
 * ## The differential test is the whole test
 *
 * A per-field assertion can only cover the fields that exist today. So the central test
 * here is **differential**: build two worlds identical except for an unsensed hand's
 * cargo, and assert the observation for an unrelated principal is **byte-identical**.
 * That covers every field, every combination of fields, and every field somebody adds
 * later — which is exactly what "derivable by combination" requires and what a per-field
 * test cannot give.
 *
 * With a positive control, because a differential test with no control is a test that
 * passes when the builder returns a constant.
 */

import { describe, expect, it } from 'vitest';
import { qty } from '../../src/core/units.js';
import type { GoodId } from '../../src/core/types.js';
import {
  buildObservation,
  observationHash,
  sensesNothing,
  sensingFaults,
  sensingFromWorld,
  canSense,
  exposureBandOf,
  EXPOSURE_BAND_FLOORS,
} from '../../src/observe/index.js';
import { loadCargo } from '../../src/world/index.js';
import {
  ALICE,
  BRAM,
  bookRow,
  fixture,
  handOf,
  makeHaul,
  ownHandIds,
  sourcesFor,
} from './fixture.js';

const ORE = 'ore' as GoodId;

/** A world where BRAM's first hand carries `amount` of ore, seated with everyone else. */
function worldWithCargo(amount: number): ReturnType<typeof fixture> {
  const f = fixture();
  makeHaul(f, { creator: ALICE });
  if (amount > 0) {
    const hand = handOf(f, BRAM, 1);
    const result = loadCargo(hand, ORE, qty(amount), 0);
    if (!result.ok) throw new Error(`${result.invariant}: ${result.hint}`);
  }
  return f;
}

describe('PROP-VI2 — an unsensing principal’s observation does not move with cargo', () => {
  it('is byte-identical across two worlds differing only in an unsensed hold', () => {
    // The differential assertion. Every field, every combination, and every field added
    // later — because it compares the whole canonical payload, not a list of names.
    const empty = worldWithCargo(0);
    const laden = worldWithCargo(900);

    const a = buildObservation(sourcesFor(empty, { sensing: sensesNothing() }), ALICE).observation;
    const b = buildObservation(sourcesFor(laden, { sensing: sensesNothing() }), ALICE).observation;
    expect(observationHash(b)).toBe(observationHash(a));
  });

  it('holds with a market, a Levy and grants in play — the inference channels §12.1 names', () => {
    const empty = worldWithCargo(0);
    const laden = worldWithCargo(4_000);
    const options = (f: ReturnType<typeof fixture>): Parameters<typeof buildObservation>[0] =>
      sourcesFor(f, {
        sensing: sensesNothing(),
        market: [bookRow(f.stage, 'ore'), bookRow(f.stage, 'ice')],
      });
    const a = buildObservation(options(empty), ALICE).observation;
    const b = buildObservation(options(laden), ALICE).observation;
    expect(observationHash(b)).toBe(observationHash(a));
    // Named explicitly, so a future reader can see which channels were checked.
    expect(a.obligations.exposure).toEqual(b.obligations.exposure);
    expect(a.ventures.board).toEqual(b.ventures.board);
    expect(a.market).toEqual(b.market);
    expect(a.briefing).toEqual(b.briefing);
  });

  it('positive control: the payload IS sensitive to cargo the reader owns', () => {
    // Without this, the differential test above would pass against a builder that
    // returned a constant.
    const empty = worldWithCargo(0);
    const laden = worldWithCargo(900);
    const a = buildObservation(sourcesFor(empty), BRAM).observation;
    const b = buildObservation(sourcesFor(laden), BRAM).observation;
    expect(observationHash(b)).not.toBe(observationHash(a));
    expect(b.hands[0]?.cargo).toEqual([['ore', 900]]);
    expect(a.hands[0]?.cargo).toEqual([]);
  });

  it('another principal’s cargo has no field in the payload at all', () => {
    // Not a filter — an absence. `hands[]` is your own hands (§12.1), so there is no
    // code path that could regress into showing somebody else's manifest.
    const laden = worldWithCargo(7_777);
    const built = buildObservation(sourcesFor(laden), ALICE).observation;
    const serialised = JSON.stringify(built);
    expect(serialised).not.toContain('7777');
    for (const hand of built.hands) expect(hand.id.startsWith(ALICE)).toBe(true);
  });
});

describe('PROP-VI2 — the market book is gated on presence and is aggregate', () => {
  it('is withheld for a system the principal has nobody standing in', () => {
    const f = fixture();
    const elsewhere = [...f.world.map.systemOrder].find((s) => s !== f.stage);
    expect(elsewhere).toBeDefined();
    if (elsewhere === undefined) return;
    const built = buildObservation(sourcesFor(f, { market: [bookRow(elsewhere, 'ore')] }), ALICE);
    expect(built.observation.market.books).toEqual([]);
    expect(built.observation.header.withheld.some((r) => r.ground === 'UNSENSED')).toBe(true);
  });

  it('is shown where a present hand stands', () => {
    const f = fixture();
    const built = buildObservation(sourcesFor(f, { market: [bookRow(f.stage, 'ore')] }), ALICE);
    expect(built.observation.market.books.length).toBe(1);
    expect(built.observation.market.at).toContain(f.stage);
  });

  it('a book row names no principal and no order — a manifest is not a price feed', () => {
    const f = fixture();
    const built = buildObservation(sourcesFor(f, { market: [bookRow(f.stage, 'ore')] }), ALICE);
    const row = built.observation.market.books[0];
    expect(row).toBeDefined();
    if (row === undefined) return;
    expect(Object.keys(row).sort((a, b) => (a < b ? -1 : 1))).toEqual([
      'best_ask',
      'best_bid',
      'depth',
      'good',
      'system',
    ]);
  });
});

describe('PROP-VI2 / AGT-X8 — affordance existence is itself a SENSED fact', () => {
  it('no affordance names a hand the principal cannot sense', () => {
    const f = fixture();
    makeHaul(f, { creator: ALICE });
    const built = buildObservation(sourcesFor(f), ALICE).observation;
    expect(
      sensingFaults(built, ALICE, sensingFromWorld(f.world, 1), ownHandIds(f, ALICE)),
    ).toEqual([]);
  });

  it('catches a fabricated affordance naming a stranger’s hand', () => {
    // The independent check on the generator. A future generator that forgets the rule
    // fails here rather than publishing "you could demand from p-bram:h1".
    const f = fixture();
    const built = buildObservation(sourcesFor(f), ALICE).observation;
    const mutant = {
      ...built,
      affordances: [
        {
          verb: 'demand' as const,
          params: { hand: `${BRAM}:h1`, at: f.stage },
          cost: 1,
          max_direct_loss: 0 as never,
          max_contingent_liability: 0 as never,
          what_it_forecloses: ['nothing'],
          expires_tick: built.header.tick + 1,
          quote_id: 'q1:deadbeef',
        },
      ],
    };
    const faults = sensingFaults(mutant, ALICE, sensesNothing(), ownHandIds(f, ALICE));
    expect(faults.join(' ')).toContain('PROP-VI2');
  });

  it('exempts the principal’s own hands — sensing your own body is not sensing', () => {
    const f = fixture();
    const built = buildObservation(sourcesFor(f), ALICE).observation;
    // Every `move` and `scan` names one of ALICE's own hands.
    expect(built.affordances.some((a) => typeof a.params['hand'] === 'string')).toBe(true);
    expect(sensingFaults(built, ALICE, sensesNothing(), ownHandIds(f, ALICE))).toEqual([]);
  });
});

describe('sensing is presence, and presence is the world’s own predicate', () => {
  it('an arriving hand senses nothing on its arrival tick', () => {
    // Falls out of using `isPresent`: a hand that arrives at T is PRESENT at T+1
    // (`world/hands.ts:ARRIVAL_IS_PRESENT_SAME_TICK`). Sensing inherits that decision
    // rather than restating it, so if the arrival rule ever changes, sensing changes
    // with it and this test says so.
    //
    // Isolated on a system where only this hand stands, so the answer is about it.
    const f = fixture();
    const elsewhere = [...f.world.map.systemOrder].find((s) => s !== f.stage);
    expect(elsewhere).toBeDefined();
    if (elsewhere === undefined) return;
    const hand = handOf(f, ALICE, 1);
    hand.location = elsewhere;
    hand.presentSinceTick = 6;

    expect(sensingFromWorld(f.world, 5).hasHandInRange(ALICE, elsewhere)).toBe(false);
    expect(sensingFromWorld(f.world, 6).hasHandInRange(ALICE, elsewhere)).toBe(true);

    // And a hand on a lane senses nothing at all: it is between places.
    hand.state = 'IN_TRANSIT';
    expect(sensingFromWorld(f.world, 6).hasHandInRange(ALICE, elsewhere)).toBe(false);
  });

  it('a purchased fact is keyed to its buyer, so one agent cannot read another’s intel', () => {
    const f = fixture();
    const sensing = sensingFromWorld(f.world, 1, new Set([`${ALICE}::${BRAM}:h1`]));
    expect(sensing.hasIntel(ALICE, `${BRAM}:h1`)).toBe(true);
    expect(sensing.hasIntel(BRAM, `${BRAM}:h1`)).toBe(false);
  });

  it('canSense is presence OR intel, and nothing else', () => {
    const f = fixture();
    const blind = sensesNothing();
    expect(canSense(blind, ALICE, f.stage, 'anything')).toBe(false);
    const withIntel = sensingFromWorld(f.world, 1, new Set([`${ALICE}::secret`]));
    expect(canSense(withIntel, ALICE, f.stage, 'secret')).toBe(true);
  });
});

describe('the EXPOSURE band is a band, and it is coarse on purpose', () => {
  it('quantises to published powers of ten', () => {
    expect(exposureBandOf(0).band).toBe(0);
    expect(exposureBandOf(999).band).toBe(0);
    expect(exposureBandOf(1_000).band).toBe(1);
    expect(exposureBandOf(9_999).band).toBe(1);
    expect(exposureBandOf(10_000).band).toBe(2);
    expect(exposureBandOf(500_000_000).ceiling).toBeNull();
    expect(EXPOSURE_BAND_FLOORS[0]).toBe(0);
  });

  it('cannot resolve a single hold: a large change inside a band moves nothing', () => {
    const before = exposureBandOf(1_000);
    const after = exposureBandOf(9_990);
    expect(after).toEqual(before);
  });

  it('publishes its own bounds, so the band is comparable rather than opaque', () => {
    const band = exposureBandOf(50_000);
    expect(band.floor).toBe(10_000);
    expect(band.ceiling).toBe(100_000);
  });
});
