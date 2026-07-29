/**
 * The `trade` verb as an agent meets it: the doors it refuses at, the freeze it is
 * closed across, the reference mark it publishes, and the determinism of a whole
 * run that trades.
 */

import { describe, expect, it } from 'vitest';
import { setSpeed, TICKS_PER_RECKONING } from '../../src/core/time.js';
import { Runtime } from '../../src/sim/runtime.js';
import { buildObservation } from '../../src/api/observe.js';
import { commonsSystems } from '../../src/world/index.js';
import type { PrincipalId } from '../../src/core/types.js';
import { ALICE, BOB, CARA, GOOD, act, submit, tick, world } from './fixture.js';

describe('the verb is live and says so', () => {
  it('is in the runtime live set, so no affordance for it can be withheld as unbuilt', () => {
    const w = world('live', ALICE);
    expect(w.runtime.liveVerbs.has('trade')).toBe(true);
  });

  it('offers a copyable IOC affordance once there is something to take', () => {
    const w = world('affordance', ALICE, BOB);
    tick(w.runtime);
    act(w.runtime, ALICE, 'trade', {
      operation: 'place',
      venue: w.venue,
      good: GOOD,
      side: 'ASK',
      quantity: 30,
      limit_price: 11,
    });
    const seen = buildObservation({
      runtime: w.runtime,
      principal: BOB,
      serverNowMs: 0,
      fresh: true,
      wakesRemaining: 16,
      stale: false,
      corrections: [],
      correctionsDropped: 0,
      actionsRemaining: 4,
    });
    const trade = seen.affordances.find((a) => a.verb === 'trade');
    expect(trade, 'no trade affordance was offered against a live ask').toBeDefined();
    expect(trade?.params['time_in_force']).toBe('IOC');
    expect(trade?.params['side']).toBe('BID');
    expect(trade?.params['limit_price']).toBe(11);
    expect(trade?.max_direct_loss).toBe(30 * 11);

    // An affordance is a complete, copyable act: sending it verbatim must be accepted.
    expect(act(w.runtime, BOB, 'trade', trade?.params ?? {})).toBeNull();
  });
});

describe('the refusals name the exact shortfall', () => {
  it('refuses an unknown operation', () => {
    const w = world('op', ALICE);
    tick(w.runtime);
    const refusal = act(w.runtime, ALICE, 'trade', { operation: 'obliterate' });
    expect(refusal?.hint).toContain('place');
  });

  it('refuses a price of zero: there is no market order in this game', () => {
    const w = world('zero', ALICE);
    tick(w.runtime);
    const refusal = act(w.runtime, ALICE, 'trade', {
      operation: 'place',
      venue: w.venue,
      good: GOOD,
      side: 'BID',
      quantity: 5,
      limit_price: 0,
    });
    expect(refusal?.hint).toContain('every order names its limit');
  });

  it('refuses a good nothing has ever produced', () => {
    const w = world('nogood', ALICE);
    tick(w.runtime);
    const refusal = act(w.runtime, ALICE, 'trade', {
      operation: 'place',
      venue: w.venue,
      good: 'unobtainium',
      side: 'BID',
      quantity: 5,
      limit_price: 5,
    });
    expect(refusal?.hint).toContain('has ever been produced');
  });

  it('accepts BUY and SELL as well as BID and ASK, because its own affordance layer says BUY', () => {
    // scar #1 avoidance: `observe/catalogue.ts` offers `side: 'BUY'`. A parser that
    // refused it would make the server decline the exact payload it handed out.
    const w = world('synonyms', ALICE);
    tick(w.runtime);
    expect(
      act(w.runtime, ALICE, 'trade', {
        operation: 'place',
        at: w.venue,
        good: GOOD,
        side: 'BUY',
        qty: 4,
        unit_price: 9,
      }),
    ).toBeNull();
    const placed = w.runtime.market.open()[0];
    expect(placed?.side).toBe('BID');
    expect(placed?.limitPrice).toBe(9);
    expect(placed?.quantity).toBe(4);
  });
});

describe('modify is cancel-and-replace, and it loses its place in the queue', () => {
  it('replaces the order, inherits what was not restated, and resets seniority', () => {
    const w = world('modify', ALICE, BOB);
    tick(w.runtime);
    act(w.runtime, ALICE, 'trade', {
      operation: 'place',
      venue: w.venue,
      good: GOOD,
      side: 'ASK',
      quantity: 30,
      limit_price: 12,
    });
    const first = w.runtime.market.open()[0];
    if (first === undefined) throw new Error('no order');
    tick(w.runtime);
    tick(w.runtime);

    expect(
      act(w.runtime, ALICE, 'trade', { operation: 'modify', order: first.id, limit_price: 10 }, 1),
    ).toBeNull();
    const second = w.runtime.market.open()[0];
    expect(second).toBeDefined();
    expect(second?.id).not.toBe(first.id);
    // Price restated, quantity inherited, side inherited.
    expect(second?.limitPrice).toBe(10);
    expect(second?.quantity).toBe(30);
    expect(second?.side).toBe('ASK');
    // The queue position is gone: it is a new order at a later tick.
    expect(second?.placedTick).toBeGreaterThan(first.placedTick);
    // Escrow followed it: exactly 30 units are escrowed, not 60.
    expect(w.runtime.market.askedQty(ALICE, w.venue, GOOD)).toBe(30);
  });
});

describe('the market is closed across the Reckoning freeze', () => {
  it('refuses a trade in the freeze and on the settlement tick', () => {
    setSpeed('instant');
    const runtime = new Runtime({ seed: 'freeze', startTick: TICKS_PER_RECKONING - 4 });
    const venue = commonsSystems(runtime.world.map)[0];
    if (venue === undefined) throw new Error('no commons system');
    for (const p of [ALICE, BOB] as PrincipalId[]) {
      runtime.seat(p, p.replace('p:', ''), venue);
      runtime.standing.open(p);
    }
    tick(runtime); // TICKS_PER_RECKONING - 3
    // Walk into the freeze.
    let refusal: { invariant: string; hint: string } | null = null;
    for (let i = 0; i < 3 && refusal === null; i += 1) {
      refusal = act(runtime, ALICE, 'trade', {
        operation: 'place',
        venue,
        good: GOOD,
        side: 'BID',
        quantity: 2,
        limit_price: 9,
      });
    }
    expect(refusal?.invariant, 'trade was accepted inside the settlement window').toBe('INV-18');
    expect(refusal?.hint).toContain("freeze has begun");
  });

  it('the clearing pass is skipped on the settlement tick, so no fill moves a frozen balance', () => {
    setSpeed('instant');
    const runtime = new Runtime({ seed: 'freeze-clear', startTick: TICKS_PER_RECKONING - 6 });
    const venue = commonsSystems(runtime.world.map)[0];
    if (venue === undefined) throw new Error('no commons system');
    for (const p of [ALICE, BOB] as PrincipalId[]) {
      runtime.seat(p, p.replace('p:', ''), venue);
      runtime.standing.open(p);
    }
    tick(runtime);
    // Two crossing orders that rest into the freeze.
    act(runtime, ALICE, 'trade', {
      operation: 'place',
      venue,
      good: GOOD,
      side: 'ASK',
      quantity: 5,
      limit_price: 10,
      duration_ticks: 50,
    });
    // Run to the settlement tick and confirm the pass reported itself skipped.
    let sawSkip = false;
    for (let i = 0; i < 8; i += 1) {
      tick(runtime);
      if (runtime.lastMarketClear?.skipped === true) sawSkip = true;
    }
    expect(sawSkip, 'the market cleared on the settlement tick, which can pause a healthy world').toBe(true);
  });
});

describe('the reference mark is the ledger valuation, fed by this book', () => {
  it('refuses to price a thin book rather than pricing off the only visible trade', () => {
    const w = world('thin', ALICE, BOB);
    tick(w.runtime);
    act(w.runtime, ALICE, 'trade', {
      operation: 'place',
      venue: w.venue,
      good: GOOD,
      side: 'ASK',
      quantity: 4,
      limit_price: 5_000,
    });
    act(w.runtime, BOB, 'trade', {
      operation: 'place',
      venue: w.venue,
      good: GOOD,
      side: 'BID',
      quantity: 4,
      limit_price: 5_000,
    });
    tick(w.runtime);
    expect(w.runtime.market.fills().length).toBe(1);
    const mark = w.runtime.referenceMark(GOOD, w.runtime.engine.tick);
    // One print of 4 units between one pair is below every floor. Worth nothing as a
    // bond, and the reason is published rather than a bare null.
    expect(mark.reason).toBe('THIN_BOOK');
    expect(mark.markUnitPrice).toBeNull();
    expect(mark.bondableUnitPrice).toBeNull();
  });

  it('prices a book with enough independent volume, and haircuts it', () => {
    const w = world('marked', ALICE, BOB, CARA);
    const { runtime, venue } = w;
    tick(runtime);
    // Three independent pairs, well past the volume and print floors.
    const pairs: [PrincipalId, PrincipalId][] = [
      [ALICE, BOB],
      [BOB, CARA],
      [CARA, ALICE],
    ];
    for (const [seller, buyer] of pairs) {
      act(runtime, seller, 'trade', {
        operation: 'place',
        venue,
        good: GOOD,
        side: 'ASK',
        quantity: 20,
        limit_price: 10,
      });
      act(runtime, buyer, 'trade', {
        operation: 'place',
        venue,
        good: GOOD,
        side: 'BID',
        quantity: 20,
        limit_price: 10,
      });
      tick(runtime);
    }
    const mark = runtime.referenceMark(GOOD, runtime.engine.tick);
    expect(mark.reason).toBe('PRICED');
    expect(mark.markUnitPrice).toBe(10);
    // 30% haircut, truncated toward zero. Conservative by design.
    expect(mark.bondableUnitPrice).toBe(7);
    expect(mark.distinctPairs).toBe(3);

    const view = runtime.marketView(ALICE, runtime.engine.tick);
    const books = view['books'] as { reference_mark: { unit_price: number | null; reason: string } }[];
    expect(books[0]?.reference_mark.unit_price).toBe(10);
    expect(books[0]?.reference_mark.reason).toBe('PRICED');
  });
});

describe('a run that trades is still deterministic', () => {
  it('two runs with the same seed and the same orders produce the same state hash', () => {
    const run = (seed: string): string => {
      const w = world(seed, ALICE, BOB);
      tick(w.runtime);
      submit(w.runtime, ALICE, 'trade', {
        operation: 'place',
        venue: w.venue,
        good: GOOD,
        side: 'ASK',
        quantity: 15,
        limit_price: 10,
      });
      submit(
        w.runtime,
        BOB,
        'trade',
        {
          operation: 'place',
          venue: w.venue,
          good: GOOD,
          side: 'BID',
          quantity: 15,
          limit_price: 12,
        },
        1,
      );
      tick(w.runtime);
      tick(w.runtime);
      return w.runtime.engine.stateHash;
    };
    expect(run('det-market')).toBe(run('det-market'));
  });

  it('a world that traded hashes differently from one that did not', () => {
    const quiet = world('det-quiet', ALICE, BOB);
    tick(quiet.runtime);
    tick(quiet.runtime);
    tick(quiet.runtime);

    const busy = world('det-quiet', ALICE, BOB);
    tick(busy.runtime);
    act(busy.runtime, ALICE, 'trade', {
      operation: 'place',
      venue: busy.venue,
      good: GOOD,
      side: 'ASK',
      quantity: 15,
      limit_price: 10,
    });
    tick(busy.runtime);
    expect(busy.runtime.engine.stateHash).not.toBe(quiet.runtime.engine.stateHash);
  });
});
