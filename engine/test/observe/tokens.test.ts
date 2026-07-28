/**
 * PROP-O2 and the token-budget property.
 *
 * > "Observation token count ≤ cap for random states (~3k normal, ~6.5k
 * > pre-Reckoning)." — TESTING.md, PROP-O2
 *
 * Two halves, and both are needed:
 *
 * - **The dynamic half.** Random worlds, random ticks, random budgets: the payload the
 *   builder actually produces is inside the cap.
 * - **The static half.** The floor rung's worst case is *proved* to fit, from the
 *   declared caps and the per-item bounds. Without it the dynamic half only says "the
 *   worlds we happened to generate were small enough", and the day a real world is
 *   bigger the ladder has nowhere left to go.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { canonicalize } from '../../src/core/canonical.js';
import type { GoodId } from '../../src/core/types.js';
import { minor, qty } from '../../src/core/units.js';
import { MAX_CARGO_GOODS, handsOf, loadCargo } from '../../src/world/index.js';
import {
  CHARS_PER_TOKEN,
  COMMITMENT_TOKEN_CAP,
  FLOOR_CAPS,
  LIST_CAPS,
  MAX_FORECLOSE_ENTRIES,
  MAX_LINE_CHARS,
  MAX_PHRASE_CHARS,
  NORMAL_TOKEN_CAP,
  RUNGS,
  asCanonical,
  budgetFaults,
  buildObservation,
  divCeil,
  estimateTokens,
  floorWorstCaseChars,
  isPreReckoning,
  line,
  phrase,
  tokenCapFor,
} from '../../src/observe/index.js';
import {
  FREEZE_FIRST_PHASE,
  TICKS_PER_RECKONING,
  WINDOW_FIRST_PHASE,
} from '../../src/core/time.js';
import {
  ALICE,
  BRAM,
  CASS,
  DOV,
  ESK,
  bookRow,
  fill,
  fixture,
  goLive,
  grantFrom,
  levyOwing,
  makeHaul,
  makeTopYield,
  sourcesFor,
  vid,
} from './fixture.js';

describe('the estimator is integer, monotone and platform-stable', () => {
  it('divCeil never returns a float and rounds up', () => {
    expect(divCeil(8, 4)).toBe(2);
    expect(divCeil(9, 4)).toBe(3);
    expect(divCeil(0, 4)).toBe(0);
    fc.assert(
      fc.property(fc.nat({ max: 1_000_000 }), (n) => {
        const q = divCeil(n, CHARS_PER_TOKEN);
        expect(Number.isInteger(q)).toBe(true);
        expect(q * CHARS_PER_TOKEN).toBeGreaterThanOrEqual(n);
        expect((q - 1) * CHARS_PER_TOKEN).toBeLessThan(n === 0 ? 1 : n);
      }),
      { numRuns: 100 },
    );
    expect(() => divCeil(1, 0)).toThrow();
  });

  it('grows with the payload, so narrowing always helps', () => {
    const small = estimateTokens({ a: 1 });
    const large = estimateTokens({ a: 1, b: 'x'.repeat(400) });
    expect(large).toBeGreaterThan(small);
  });

  it('measures through the canonicaliser, so an unmeasurable payload is a failure', () => {
    // Measuring via canonicalize means a float or a Map in the payload throws here
    // rather than producing a plausible number.
    expect(() => estimateTokens({ x: 0.5 })).toThrow(/float/);
  });
});

describe('the caps are the §17 numbers', () => {
  it('is 3k normal and 6.5k pre-Reckoning', () => {
    expect(NORMAL_TOKEN_CAP).toBe(3_000);
    expect(COMMITMENT_TOKEN_CAP).toBe(6_500);
  });

  it('switches on the commitment window and the freeze, not on a guess', () => {
    expect(tokenCapFor(0)).toBe(NORMAL_TOKEN_CAP);
    expect(isPreReckoning(0)).toBe(false);
    // The two bands `isPreReckoning` is named for, each addressed by the constant that
    // declares where it starts. This used to reach for `TICKS_PER_RECKONING - 1` and call
    // it the freeze; that phase is the SETTLEMENT tick, and it was only ever in the freeze
    // because `core/time.ts` had both predicates true there (SPEC §5.1 puts the freeze at
    // "the last tick *before* settlement").
    expect(isPreReckoning(FREEZE_FIRST_PHASE)).toBe(true);
    expect(tokenCapFor(FREEZE_FIRST_PHASE)).toBe(COMMITMENT_TOKEN_CAP);
    expect(isPreReckoning(WINDOW_FIRST_PHASE)).toBe(true);
    expect(tokenCapFor(WINDOW_FIRST_PHASE)).toBe(COMMITMENT_TOKEN_CAP);
    // The last tick of the window, i.e. the whole band and not just its ends.
    expect(tokenCapFor(FREEZE_FIRST_PHASE - 1)).toBe(COMMITMENT_TOKEN_CAP);
    // And the switch is AT the window's declared first phase, not near it: the tick before
    // it is still on the small cap. Without this the cap could widen early by any number of
    // ticks and every assertion above would still pass.
    expect(isPreReckoning(WINDOW_FIRST_PHASE - 1)).toBe(false);
    expect(tokenCapFor(WINDOW_FIRST_PHASE - 1)).toBe(NORMAL_TOKEN_CAP);
  });
});

describe('PROP-O2 — the static half: the floor rung is proved to fit', () => {
  it('the floor rung’s worst case is inside the normal cap, by arithmetic', () => {
    // The whole reason the narrowing loop can terminate without slicing.
    expect(floorWorstCaseChars()).toBeLessThanOrEqual(NORMAL_TOKEN_CAP * CHARS_PER_TOKEN);
  });

  it('every floor cap is at or below its rung-0 cap', () => {
    for (const key of Object.keys(LIST_CAPS) as (keyof typeof LIST_CAPS)[]) {
      expect(FLOOR_CAPS[key], key).toBeLessThanOrEqual(LIST_CAPS[key]);
    }
  });

  it('the ladder ends at the floor, so there is always a last resort', () => {
    const last = RUNGS[RUNGS.length - 1];
    expect(last?.caps.affordances).toBe(FLOOR_CAPS.affordances);
  });

  it('the MAXIMAL LEGAL world’s items never exceed the per-item bounds the proof rests on', () => {
    // The proof above multiplies FLOOR_CAPS by per-item character bounds. Those bounds
    // are measured, so they can go stale the moment a field is added to any of these
    // shapes — and the proof would then be arithmetic about numbers that no longer
    // describe the payload.
    //
    // ── WHY THIS IS BUILT AGAINST THE LARGEST LEGAL WORLD ──────────────────────
    //
    // The first version of this test measured a *comfortable* world: empty cargo, one
    // grant, five-figure amounts. It passed while `hand: 200` and `affordance: 300` were
    // both wrong — a world using nothing but the engine's own declared caps (three hands
    // each loaded to `MAX_CARGO_GOODS`, sixteen grants, nine-figure amounts) produces a
    // 397-character hand line and a 317-character affordance. The proof's guard was
    // therefore measuring a payload no adversary would send, which is the same failure
    // as no guard at all: `buildObservation` returned `fits: false` at the last rung on a
    // legal world, and the ladder had nowhere left to go.
    const f = fixture();
    const haul = makeHaul(f, { creator: ALICE });
    goLive(f, haul, [BRAM, CASS], minor(12_000));
    const forming = makeHaul(f, {
      id: vid('v-measure'),
      creator: DOV,
      windowClosesTick: 200,
      resolvesAtTick: 250,
    });
    fill(f, forming, 0, ESK, 1);
    // Every hand loaded to the world's own cargo cap, through the real world API.
    const goods = [
      'refined_alloy',
      'volatile_ice',
      'raw_ore',
      'ceramic_plate',
      'reactor_core',
      'hull_frame',
      'nutrient_paste',
      'shield_matrix',
    ] as GoodId[];
    for (const hand of handsOf(f.world, ALICE)) {
      for (const good of goods) {
        expect(loadCargo(hand, good, qty(999_999_999), 1).ok, `loading ${good}`).toBe(true);
      }
      expect(hand.cargo.size).toBe(MAX_CARGO_GOODS);
    }

    const built = buildObservation(
      sourcesFor(f, {
        tick: 190,
        levy: levyOwing(f, 900_000_000),
        market: [bookRow(f.stage, 'refined_alloy')],
        // Both grant lists at their rung-0 cap, with the widest limits a grant can carry.
        grants: [
          ...Array.from({ length: LIST_CAPS.granted }, (_, i) =>
            grantFrom({
              id: `grant-treasury-outbound-${String(i)}`,
              grantor: ALICE,
              delegate: BRAM,
              maxDirectLoss: 900_000_000,
              maxContingentLiability: 900_000_000,
            }),
          ),
          ...Array.from({ length: LIST_CAPS.held }, (_, i) =>
            grantFrom({
              id: `grant-treasury-inbound-${String(i)}`,
              grantor: CASS,
              delegate: ALICE,
              maxDirectLoss: 900_000_000,
              maxContingentLiability: 900_000_000,
            }),
          ),
        ],
        talks: [{ venture: haul.id, counterparty: BRAM, unread: 999, last_tick: 180 }],
        ballots: [{ id: 'b-1', kind: 'LEVY', closes_tick: 287, voted: false, target: null }],
      }),
      ALICE,
    ).observation;

    const size = (v: unknown): number => canonicalize(v as never).length;
    const check = (label: string, items: readonly unknown[], bound: number): void => {
      expect(items.length, `${label} produced nothing, so the bound is untested`).toBeGreaterThan(0);
      for (const item of items) {
        expect(size(item), `${label} item exceeds its declared ${String(bound)}-char bound`).toBeLessThanOrEqual(
          bound,
        );
      }
    };

    check('affordance', built.affordances, 350);
    check('mine', built.ventures.mine, 320);
    // 380, not 290: `BoardSlot.terms_hash` is a full 64-character hash and it is what makes
    // a board slot closeable inside one wake (Gate 3 measured `0/0` without it). The literal
    // is deliberately duplicated from `WORST_ITEM_CHARS` so that widening a shape has to be
    // stated in two places, one of which is a test that re-measures it.
    check('board', built.ventures.board, 380);
    check('talk', built.ventures.talks, 100);
    check('counterparty', built.counterparties, 310);
    check('market', built.market.books, 200);
    check('grant', [...built.grants.granted, ...built.grants.held], 300);
    check('whatResolves', built.header.next_reckoning.what_resolves, 40);
    // 69, not 70: one character was moved from this bound to `doNothing`'s so that
    // `DoNothingOutcome.unit` fits inside `floorWorstCaseChars()`. The arithmetic is at
    // `WORST_ITEM_CHARS.withheldRow`; the measured maximum on this maximal world is 61.
    check('withheldRow', built.header.withheld, 69);
    // 124, not 110: `DoNothingOutcome.unit` publishes the denomination of `amount`, which carried
    // **five different units** under one name. The literal is duplicated from `WORST_ITEM_CHARS` on
    // purpose (see `board` above), and the +14 is paid for one line up rather than by narrowing the
    // list — see both notes in `tokens.ts`. Measured maximum on this maximal world: 124 exactly.
    check('doNothing', built.briefing.if_you_do_nothing.outcomes, 124);
    check('hand', built.hands, 440);
    // A loaded hand is the whole reason the bound moved, so the measurement is only
    // valid if the payload actually carries the cargo.
    expect(built.hands[0]?.cargo.length).toBe(MAX_CARGO_GOODS);
    // The fixed block: header base + holding + obligations + briefing prose. `withheld`
    // and `what_resolves` are both priced per item above, so both come out here.
    const fixed =
      size({
        ...built.header,
        withheld: [],
        next_reckoning: { ...built.header.next_reckoning, what_resolves: [] },
      }) +
      size(built.holding) +
      size(built.obligations) +
      size({ ...built.briefing, if_you_do_nothing: { ...built.briefing.if_you_do_nothing, outcomes: [] } });
    // 1,310, not 1,300: `obligations.levy` gained the two EXPOSURE high-water-mark fields at
    // `RULES_VERSION` 17. The literal is duplicated from `WORST_ITEM_CHARS.fixed` on purpose (see
    // `board` above) so that widening the fixed block has to be stated in two places, one of which
    // re-measures it. Measured maximum on this maximal world: **1,304**, so 6 of headroom — and the
    // floor proof itself is down to 14 characters of slack, which `WORST_ITEM_CHARS.fixed` records.
    expect(fixed, 'the fixed block exceeds its declared 1310-char bound').toBeLessThanOrEqual(1_310);
  });

  it('the floor rung applies its declared cap to EVERY list it declares one for', () => {
    // The bug this catches: `FLOOR_CAPS` declared caps for four lists that the builder
    // read from `LIST_CAPS` instead, so `floorWorstCaseChars()` was a proof about numbers
    // nothing applied. Either a list is narrowed at the floor and the proof may use the
    // smaller number, or it is not and the proof must pay the full one — and this is the
    // assertion that keeps the table honest either way.
    const narrowed = new Set(['affordances', 'mine', 'board', 'talks', 'counterparties', 'market', 'granted', 'held']);
    for (const key of Object.keys(LIST_CAPS) as (keyof typeof LIST_CAPS)[]) {
      if (narrowed.has(key)) continue;
      expect(
        FLOOR_CAPS[key],
        `FLOOR_CAPS.${key} is smaller than LIST_CAPS.${key}, but nothing applies it — ` +
          'floorWorstCaseChars() would then under-count the floor rung',
      ).toBe(LIST_CAPS[key]);
    }
  });

  it('the floor rung fits a world built only from the engine’s own declared caps', () => {
    // The end-to-end version of the proof, and the case that actually failed: three
    // hands at MAX_CARGO_GOODS, both grant lists at their cap, twelve do-nothing
    // outcomes, forty ventures. Every number here is one the engine itself permits.
    const f = fixture();
    for (let i = 0; i < 12; i += 1) {
      makeHaul(f, {
        id: vid(`v-live-${String(i).padStart(2, '0')}`),
        creator: ALICE,
        windowClosesTick: 200,
        resolvesAtTick: 250,
      });
    }
    for (let i = 0; i < 40; i += 1) {
      makeHaul(f, {
        id: vid(`v-forming-${String(i).padStart(2, '0')}`),
        creator: DOV,
        windowClosesTick: 200,
        resolvesAtTick: 250,
      });
    }
    const goods = [
      'refined_alloy',
      'volatile_ice',
      'raw_ore',
      'ceramic_plate',
      'reactor_core',
      'hull_frame',
      'nutrient_paste',
      'shield_matrix',
    ] as GoodId[];
    for (const hand of handsOf(f.world, ALICE)) {
      for (const good of goods) loadCargo(hand, good, qty(999_999_999), 1);
    }
    const built = buildObservation(
      sourcesFor(f, {
        tick: 5,
        levy: levyOwing(f, 900_000_000),
        market: [bookRow(f.stage, 'refined_alloy'), bookRow(f.stage, 'volatile_ice')],
        grants: [
          ...Array.from({ length: LIST_CAPS.granted }, (_, i) =>
            grantFrom({
              id: `grant-treasury-outbound-${String(i)}`,
              grantor: ALICE,
              delegate: BRAM,
              maxDirectLoss: 900_000_000,
              maxContingentLiability: 900_000_000,
            }),
          ),
          ...Array.from({ length: LIST_CAPS.held }, (_, i) =>
            grantFrom({
              id: `grant-treasury-inbound-${String(i)}`,
              grantor: CASS,
              delegate: ALICE,
              maxDirectLoss: 900_000_000,
              maxContingentLiability: 900_000_000,
            }),
          ),
        ],
        talks: Array.from({ length: 20 }, (_, i) => ({
          venture: vid(`v-forming-${String(i).padStart(2, '0')}`),
          counterparty: ESK,
          unread: 1,
          last_tick: 1,
        })),
      }),
      ALICE,
    );
    expect(built.fits, `overflowed at rung ${String(built.rung)}: ${String(built.tokens)}/${String(built.cap)}`).toBe(
      true,
    );
    expect(budgetFaults(built.observation)).toEqual([]);
    // And the narrowing was counted, not sliced: grants is the list the floor gives up.
    expect(built.accounting).toEqual([]);
    expect(
      built.observation.header.withheld.some((r) => r.field === 'grants' && r.ground === 'PAGED'),
    ).toBe(true);
  });

  it('clips prose to its declared bound rather than letting one field run away', () => {
    expect(phrase('x'.repeat(500)).length).toBe(MAX_PHRASE_CHARS);
    expect(line('y'.repeat(1_000)).length).toBe(MAX_LINE_CHARS);
    expect(phrase('short')).toBe('short');
  });
});

describe('PROP-O2 — the dynamic half: random states stay inside the cap', () => {
  it('a busy world at every tick of a Reckoning', () => {
    const f = fixture();
    const haul = makeHaul(f, { creator: ALICE, windowClosesTick: 280, resolvesAtTick: 287 });
    fill(f, haul, 0, BRAM, 1);
    const other = makeHaul(f, {
      id: vid('v-2'),
      creator: DOV,
      windowClosesTick: 280,
      resolvesAtTick: 287,
    });
    fill(f, other, 0, ESK, 1);
    makeTopYield(f, 'BUILD', vid('v-3'), CASS, 4_000);

    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: TICKS_PER_RECKONING - 1 }),
        fc.constantFrom(ALICE, BRAM, CASS, DOV, ESK),
        fc.integer({ min: 0, max: 4 }),
        (tick, principal, actions) => {
          const built = buildObservation(
            sourcesFor(f, {
              tick,
              actionsRemaining: actions,
              levy: levyOwing(f),
              market: [bookRow(f.stage, 'ore'), bookRow(f.stage, 'ice'), bookRow(f.stage, 'alloy')],
              grants: [grantFrom({ delegate: BRAM }), grantFrom({ id: 'g-2', delegate: CASS })],
              talks: [{ venture: haul.id, counterparty: BRAM, unread: 3, last_tick: tick }],
              ballots: [{ id: 'b-1', kind: 'LEVY', closes_tick: 287, voted: false, target: null }],
            }),
            principal,
          );
          expect(built.tokens).toBeLessThanOrEqual(built.cap);
          expect(built.fits).toBe(true);
          expect(budgetFaults(built.observation)).toEqual([]);
        },
      ),
      { numRuns: 120 },
    );
  });

  it('a normal wake is comfortably inside the smaller cap', () => {
    const f = fixture();
    const haul = makeHaul(f);
    goLive(f, haul, [BRAM, CASS], minor(12_000));
    const built = buildObservation(sourcesFor(f, { tick: 10 }), ALICE);
    expect(built.rung).toBe(0);
    expect(built.tokens).toBeLessThanOrEqual(NORMAL_TOKEN_CAP);
  });

  it('narrows rather than overflows when a world is genuinely large', () => {
    // Thirty ventures, three markets, two grants: more than the payload can carry.
    // What must happen is a rung, not a slice, and the omissions must be counted.
    const f = fixture();
    for (let i = 0; i < 30; i += 1) {
      makeHaul(f, {
        id: vid(`v-many-${String(i).padStart(2, '0')}`),
        creator: ALICE,
        windowClosesTick: 200,
        resolvesAtTick: 250,
      });
    }
    const built = buildObservation(
      sourcesFor(f, {
        tick: 5,
        market: [bookRow(f.stage, 'ore'), bookRow(f.stage, 'ice'), bookRow(f.stage, 'alloy')],
        grants: [grantFrom({ delegate: BRAM }), grantFrom({ id: 'g-2', delegate: CASS })],
      }),
      ALICE,
    );
    expect(built.fits).toBe(true);
    expect(built.rung).toBeGreaterThan(0);
    // Everything the rungs removed is accounted, exactly.
    expect(built.accounting).toEqual([]);
    expect(built.observation.header.withheld.some((r) => r.ground === 'PAGED')).toBe(true);
  });

  it('the payload’s own characters bound its tokens — the estimate is the payload', () => {
    const f = fixture();
    const built = buildObservation(sourcesFor(f), ALICE);
    const chars = canonicalize(asCanonical(built.observation)).length;
    expect(built.tokens).toBe(divCeil(chars, CHARS_PER_TOKEN));
  });
});

describe('INV-26 — every list in the payload is inside its declared cap', () => {
  it('holds for a deliberately oversized world', () => {
    const f = fixture();
    for (let i = 0; i < 20; i += 1) {
      makeHaul(f, {
        id: vid(`v-cap-${String(i).padStart(2, '0')}`),
        creator: ALICE,
        windowClosesTick: 200,
        resolvesAtTick: 250,
      });
    }
    const built = buildObservation(
      sourcesFor(f, {
        market: [bookRow(f.stage, 'a'), bookRow(f.stage, 'b'), bookRow(f.stage, 'c'), bookRow(f.stage, 'd')],
        talks: Array.from({ length: 20 }, (_, i) => ({
          venture: vid(`v-cap-${String(i).padStart(2, '0')}`),
          counterparty: BRAM,
          unread: 1,
          last_tick: 1,
        })),
      }),
      ALICE,
    ).observation;
    expect(built.affordances.length).toBeLessThanOrEqual(LIST_CAPS.affordances);
    expect(built.ventures.mine.length).toBeLessThanOrEqual(LIST_CAPS.mine);
    expect(built.ventures.board.length).toBeLessThanOrEqual(LIST_CAPS.board);
    expect(built.ventures.talks.length).toBeLessThanOrEqual(LIST_CAPS.talks);
    expect(built.counterparties.length).toBeLessThanOrEqual(LIST_CAPS.counterparties);
    expect(built.market.books.length).toBeLessThanOrEqual(LIST_CAPS.market);
    expect(built.header.withheld.length).toBeLessThanOrEqual(LIST_CAPS.withheldRows);
    expect(built.hands.length).toBeLessThanOrEqual(LIST_CAPS.hands);
    for (const affordance of built.affordances) {
      expect(affordance.what_it_forecloses.length).toBeLessThanOrEqual(MAX_FORECLOSE_ENTRIES);
    }
  });
});
