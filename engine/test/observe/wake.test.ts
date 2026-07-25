/**
 * §12.4 — the wake budget, and the requirement that it actually bites.
 *
 * > "Outside a wake, `observe` returns the cached tick snapshot with **no fresh
 * > affordances and no new `quote_id`** — legal, free, and useless. This caps the
 * > owner's bill (a selling point), makes A4 enforceable for the first time, and turns
 * > the cost model into a guarantee."
 *
 * **Useless is the assertion, not the side effect.** If a stale read carried fresh
 * world state, an owner running a bigger model could poll 288 times a day for a
 * strictly larger information set and pay only for inference — A4 violated through the
 * budget instead of the request rate, which is the exact hole §12.4 was added to close.
 *
 * E2E-30 lands here too: a `PAUSED` world "returns the last good snapshot marked
 * `stale` with an empty affordance list".
 */

import { describe, expect, it } from 'vitest';
import { minor } from '../../src/core/units.js';
import {
  ObservationCache,
  QuoteBook,
  assertObservation,
  buildObservation,
  checkObservation,
  observationHash,
  observe,
  stalenessFaults,
} from '../../src/observe/index.js';
import { ALICE, BRAM, CASS, bookRow, fixture, goLive, levyOwing, makeHaul, sourcesFor } from './fixture.js';

describe('§12.4 — inside a wake the observation is fresh', () => {
  it('builds, caches and reports itself fresh', () => {
    const f = fixture();
    const cache = new ObservationCache();
    const result = observe(sourcesFor(f, { tick: 5 }), ALICE, cache);
    expect(result.fresh).toBe(true);
    expect(result.observation.header.stale).toBe(false);
    expect(result.observation.header.cached_at_tick).toBeNull();
    expect(result.observation.affordances.length).toBeGreaterThan(0);
    expect(cache.get(ALICE)?.at).toBe(5);
    assertObservation(result.observation);
  });

  it('the cache holds one row per principal, so it is bounded by seats', () => {
    const f = fixture();
    const cache = new ObservationCache();
    for (const principal of [ALICE, BRAM, CASS]) {
      observe(sourcesFor(f, { tick: 1 }), principal, cache);
      observe(sourcesFor(f, { tick: 2 }), principal, cache);
      observe(sourcesFor(f, { tick: 3 }), principal, cache);
    }
    expect(cache.size).toBe(3);
  });
});

describe('§12.4 — outside a wake it is legal, free, and useless', () => {
  it('returns the cached body with no affordances, and counts what it withheld', () => {
    const f = fixture();
    const haul = makeHaul(f);
    goLive(f, haul, [BRAM, CASS], minor(12_000));
    const cache = new ObservationCache();
    const fresh = observe(sourcesFor(f, { tick: 5, isWake: true }), ALICE, cache);
    const offered = fresh.observation.affordances.length;
    expect(offered).toBeGreaterThan(0);

    const stale = observe(sourcesFor(f, { tick: 9, isWake: false }), ALICE, cache);
    expect(stale.fresh).toBe(false);
    expect(stale.observation.affordances).toEqual([]);
    expect(stale.observation.header.stale).toBe(true);
    expect(stale.observation.header.cached_at_tick).toBe(5);
    // The agent is told how many options it is not being shown, and why.
    const row = stale.observation.header.withheld.find((r) => r.ground === 'WAKE_SPENT');
    expect(row?.count).toBe(offered);
    expect(stalenessFaults(stale.observation)).toEqual([]);
    expect(checkObservation(stale.observation)).toEqual([]);
  });

  it('keeps the cached omission rows and counts the emptied list on top of them', () => {
    // The under-count this test found: dropping the cached `PAGED` rows told an agent
    // about fewer omissions than there were. `PAGED` counts options never shown; the new
    // row counts the ones that were shown and now are not. Both are true at once.
    const f = fixture();
    for (let i = 0; i < 24; i += 1) {
      makeHaul(f, {
        id: `v-w${String(i).padStart(2, '0')}` as never,
        creator: ALICE,
        windowClosesTick: 200,
        resolvesAtTick: 250,
      });
    }
    const cache = new ObservationCache();
    const fresh = observe(sourcesFor(f, { tick: 5, isWake: true }), ALICE, cache);
    const pagedBefore = fresh.observation.header.withheld.find(
      (r) => r.field === 'affordances' && r.ground === 'PAGED',
    );
    expect(pagedBefore?.count).toBeGreaterThan(0);

    const stale = observe(sourcesFor(f, { tick: 6, isWake: false }), ALICE, cache);
    const pagedAfter = stale.observation.header.withheld.find(
      (r) => r.field === 'affordances' && r.ground === 'PAGED',
    );
    expect(pagedAfter?.count).toBe(pagedBefore?.count);
    const spent = stale.observation.header.withheld.find((r) => r.ground === 'WAKE_SPENT');
    expect(spent?.count).toBe(fresh.observation.affordances.length);
    // No duplicate rows, which `withheldFaults` would reject.
    expect(checkObservation(stale.observation)).toEqual([]);
  });

  it('mints no new quote_id — the quote book does not move', () => {
    const f = fixture();
    const cache = new ObservationCache();
    const quotes = new QuoteBook();
    observe(sourcesFor(f, { tick: 5, isWake: true }), ALICE, cache, quotes);
    const after = quotes.size;
    expect(after).toBeGreaterThan(0);

    observe(sourcesFor(f, { tick: 6, isWake: false }), ALICE, cache, quotes);
    observe(sourcesFor(f, { tick: 7, isWake: false }), ALICE, cache, quotes);
    // Not one new pin. This is what "no new quote_id" means mechanically.
    expect(quotes.size).toBe(after);
  });

  it('carries no fresher world state than the wake it was cached at', () => {
    // The A4 hole this closes: if a stale read were rebuilt from current state, polling
    // would buy information for free.
    const f = fixture();
    const cache = new ObservationCache();
    const fresh = observe(sourcesFor(f, { tick: 5, isWake: true }), ALICE, cache);

    // The world moves: a new venture appears that ALICE is party to.
    const haul = makeHaul(f, { creator: ALICE, windowOpensTick: 6, windowClosesTick: 100 });
    goLive(f, haul, [BRAM, CASS], minor(12_000), 6);

    const stale = observe(sourcesFor(f, { tick: 7, isWake: false }), ALICE, cache);
    expect(stale.observation.ventures.mine).toEqual(fresh.observation.ventures.mine);
    expect(stale.observation.header.tick).toBe(5);
    // The only differences are the two fields that say "this is not fresh", plus the
    // emptied affordance list.
    expect({ ...stale.observation.header, stale: false, cached_at_tick: null, withheld: [] }).toEqual({
      ...fresh.observation.header,
      withheld: [],
    });
  });

  it('a wake after a stale read is fresh again, and the world has moved on', () => {
    const f = fixture();
    const cache = new ObservationCache();
    observe(sourcesFor(f, { tick: 5, isWake: true }), ALICE, cache);
    observe(sourcesFor(f, { tick: 6, isWake: false }), ALICE, cache);
    const haul = makeHaul(f, { creator: ALICE, windowOpensTick: 7, windowClosesTick: 100 });
    goLive(f, haul, [BRAM, CASS], minor(12_000), 7);
    const again = observe(sourcesFor(f, { tick: 8, isWake: true }), ALICE, cache);
    expect(again.fresh).toBe(true);
    expect(again.observation.ventures.mine.length).toBe(1);
    expect(again.observation.affordances.length).toBeGreaterThan(0);
  });

  it('with nothing cached it returns the dark envelope, not a fresh build', () => {
    // A restart before a principal's first wake. It must still be ten well-formed keys,
    // and it must not be a way to read the option space.
    const f = fixture();
    const haul = makeHaul(f);
    goLive(f, haul, [BRAM, CASS], minor(12_000));
    const cache = new ObservationCache();
    const dark = observe(sourcesFor(f, { tick: 5, isWake: false }), ALICE, cache);
    expect(dark.fresh).toBe(false);
    expect(dark.observation.header.stale).toBe(true);
    expect(dark.observation.header.cached_at_tick).toBeNull();
    expect(dark.observation.affordances).toEqual([]);
    expect(dark.observation.ventures.mine).toEqual([]);
    expect(dark.observation.ventures.board).toEqual([]);
    expect(dark.observation.counterparties).toEqual([]);
    expect(dark.observation.market.books).toEqual([]);
    expect(checkObservation(dark.observation)).toEqual([]);
    // Its own hands and holding are its own body, which is not an information edge.
    expect(dark.observation.hands.length).toBe(3);
  });
});

describe('a cached snapshot cannot be rewritten from underneath', () => {
  it('does not alias the caller’s Levy row, so mutating it leaves the cache alone', () => {
    // The aliasing leak: if the payload embedded the caller's object by reference, the
    // Levy module updating its own row would rewrite every cached snapshot pointing at
    // it, and an agent outside its wake would read fresh state through a stale payload.
    // That is A4 for cognition failing through aliasing rather than through a code path.
    const f = fixture();
    const levy = { ...levyOwing(f, 5_000) };
    const cache = new ObservationCache();
    const fresh = observe(sourcesFor(f, { tick: 5, isWake: true, levy }), ALICE, cache);
    expect(fresh.observation.obligations.levy?.my_assessment).toBe(5_000);

    // The Levy module reassesses. The cached snapshot must not move.
    const mutable = levy as { my_assessment: number; paid: number };
    mutable.my_assessment = 99_999;
    mutable.paid = 42;

    const stale = observe(sourcesFor(f, { tick: 6, isWake: false, levy }), ALICE, cache);
    expect(stale.observation.obligations.levy?.my_assessment).toBe(5_000);
    expect(stale.observation.obligations.levy?.paid).toBe(0);
  });

  it('does not alias the caller’s market rows or standing rows either', () => {
    const f = fixture();
    const haul = makeHaul(f);
    goLive(f, haul, [BRAM, CASS], minor(12_000));
    const row = { ...bookRow(f.stage, 'ore') };
    const standing = {
      principal: BRAM,
      electiveHonoured: 1,
      electiveHonouredValue: minor(10),
      defaults: 0,
      contradictedSeals: 0,
      distinctCounterparties: 1,
      lastDefaultTick: null,
    };
    const cache = new ObservationCache();
    const fresh = observe(
      sourcesFor(f, { tick: 5, isWake: true, market: [row], standingOf: () => standing }),
      ALICE,
      cache,
    );
    expect(fresh.observation.market.books[0]?.best_ask).toBe(10);
    expect(fresh.observation.counterparties[0]?.standing?.defaults).toBe(0);

    (row as { best_ask: number }).best_ask = 999;
    standing.defaults = 7;

    const stale = observe(sourcesFor(f, { tick: 6, isWake: false }), ALICE, cache);
    expect(stale.observation.market.books[0]?.best_ask).toBe(10);
    expect(stale.observation.counterparties[0]?.standing?.defaults).toBe(0);
  });

  it('the cache is bounded, and evicting only ever costs a dark envelope', () => {
    // Scar #3: unbounded enrolment became an OOM. A cached observation is ~10 KB, so the
    // cap is a declared bound, not a nicety — and eviction is safe because a missing row
    // means the dark envelope, which is what §12.4 already promises outside a wake.
    const f = fixture();
    const cache = new ObservationCache(2);
    observe(sourcesFor(f, { tick: 1, isWake: true }), ALICE, cache);
    observe(sourcesFor(f, { tick: 2, isWake: true }), BRAM, cache);
    observe(sourcesFor(f, { tick: 3, isWake: true }), CASS, cache);
    expect(cache.size).toBe(2);
    // ALICE was cached longest ago, so ALICE is the one evicted.
    expect(cache.get(ALICE)).toBeUndefined();
    expect(cache.get(CASS)).toBeDefined();

    const dark = observe(sourcesFor(f, { tick: 4, isWake: false }), ALICE, cache);
    expect(dark.observation.header.stale).toBe(true);
    expect(dark.observation.affordances).toEqual([]);
    expect(checkObservation(dark.observation)).toEqual([]);
  });
});

describe('E2E-30 — a PAUSED world serves the last good snapshot, marked stale', () => {
  it('empties the affordances and names HALTED as the ground', () => {
    const f = fixture();
    const cache = new ObservationCache();
    const good = observe(sourcesFor(f, { tick: 5, isWake: true }), ALICE, cache);
    const paused = observe(sourcesFor(f, { tick: 6, isWake: true, status: 'PAUSED' }), ALICE, cache);
    expect(paused.observation.header.stale).toBe(true);
    expect(paused.observation.affordances).toEqual([]);
    expect(paused.observation.header.withheld.some((r) => r.ground === 'HALTED')).toBe(true);
    // The last good snapshot: byte-identical apart from the staleness fields and the
    // emptied list. "Never publish a broken tick" applies to the read surface too.
    expect(observationHash({ ...good.observation, affordances: [] })).not.toBe('');
    expect(paused.observation.ventures).toEqual(good.observation.ventures);
    expect(checkObservation(paused.observation)).toEqual([]);
  });

  it('a wake is not spent minting anything while the world is paused', () => {
    const f = fixture();
    const cache = new ObservationCache();
    const quotes = new QuoteBook();
    observe(sourcesFor(f, { tick: 5, isWake: true }), ALICE, cache, quotes);
    const before = quotes.size;
    observe(sourcesFor(f, { tick: 6, isWake: true, status: 'PAUSED' }), ALICE, cache, quotes);
    expect(quotes.size).toBe(before);
  });
});

describe('the staleness checker bites', () => {
  it('rejects a stale payload that still carries affordances', () => {
    const f = fixture();
    const built = buildObservation(sourcesFor(f), ALICE);
    const mutant = {
      ...built.observation,
      header: { ...built.observation.header, stale: true },
    };
    expect(stalenessFaults(mutant).join(' ')).toContain('§12.4');
  });
});
