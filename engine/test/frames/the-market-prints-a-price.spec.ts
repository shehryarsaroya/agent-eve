/**
 * ★ **THE PRINT** — A13's ship gate for the market, and the §11.2 line it must not cross.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * `market/` printed 18 fills in the harness — the first in this repo's history — and there was
 * **no market or fill key anywhere in `frames/latest.json`.** So the first production fill would
 * have been invisible to every viewer, and A13 is a ship gate rather than a nicety: *no named
 * pixel signature, not ready.*
 *
 * The signature is **THE PRINT**. A claim tints a system; a WORKS marks it; a market prints a
 * price on it. And what makes a price worth drawing is not that a trade happened — that is a log
 * line — but the **gap between two places quoting the same good**, which is why anybody hauls,
 * why a hub forms and what a blockade is worth (M1's whole argument for a location-bound book).
 *
 * The second half of this file is the tier boundary, and it belongs in a test rather than in a
 * review because this is the *fourth* mechanic to reach the frame and the first whose tempting
 * field is a **manifest** rather than a stockpile. A resting ask is "X has 400 of this good,
 * here, right now"; the book is served to agents only at venues where they have a hand. So a
 * galaxy-wide depth ladder on this frame would be A9 inverted *and* the intel a raid is supposed
 * to have to scout for. A fill is a deed. Deeds go on the frame.
 * ══════════════════════════════════════════════════════════════════════════
 */

import { describe, expect, it } from 'vitest';
import { HeuristicCast } from '../../src/cast/index.js';
import { setSpeed, TICKS_PER_RECKONING } from '../../src/core/time.js';
import { Runtime } from '../../src/sim/runtime.js';
import type { GoodId, PrincipalId, SystemId } from '../../src/core/types.js';
import { minor, qty } from '../../src/core/units.js';
import {
  MAX_FRAME_MARKET_LINES,
  assertFrameBudgets,
  type MarketLine,
  type ReckoningFrame,
} from '../../src/frames/contract.js';
import { PUBLIC_FACT_KEYS } from '../../src/frames/projection.js';
import { emptyFrame } from '../../src/frames/render.js';
import {
  MarketBook,
  marketLinesFor,
  type Fill,
  type Order,
  type OrderId,
} from '../../src/market/index.js';

// ── unit fixtures ───────────────────────────────────────────────────────────

function print(over: Partial<MarketLine> = {}): MarketLine {
  return {
    venue: 'sys-05' as SystemId,
    good: 'ore' as GoodId,
    lastPrice: minor(1_240),
    lastTick: 200,
    firstTick: 200,
    prints: 3,
    volume: qty(120),
    vwap: minor(1_240),
    galaxyVwap: minor(1_240),
    venues: 1,
    premiumBps: 0,
    legend: 'ORE · 1240 · ONLY MARKET',
    ...over,
  };
}

function frameWith(lines: readonly MarketLine[]): ReckoningFrame {
  return { ...emptyFrame(0, 0, 'hash'), marketLines: lines };
}

/** The refusal text, or '' when the frame was accepted. Budgets throw; that is the contract. */
function refusal(lines: readonly MarketLine[]): string {
  try {
    assertFrameBudgets(frameWith(lines));
    return '';
  } catch (error: unknown) {
    return error instanceof Error ? error.message : String(error);
  }
}

function fill(over: Partial<Fill> = {}): Fill {
  return {
    id: 'fill:1',
    tick: 100,
    venue: 'sys-05' as SystemId,
    good: 'ore' as GoodId,
    unitPrice: minor(100),
    qty: qty(10),
    buyer: 'p:a' as Fill['buyer'],
    seller: 'p:b' as Fill['seller'],
    bid: 'ord:bid' as Fill['bid'],
    ask: 'ord:ask' as Fill['ask'],
    goodsLegs: 1,
    ...over,
  };
}

function bookOf(fills: readonly Fill[]): MarketBook {
  const book = new MarketBook();
  for (const f of fills) book.recordFill(f);
  return book;
}

// ── 1. THE SIGNATURE EXISTS AT ALL (A13) ────────────────────────────────────

describe('★ the market has a pixel signature, and it is a PRICE', () => {
  it('the frame carries a marketLines key, present even when nothing traded', () => {
    // The whole defect in one assertion: before this, `frames/latest.json` had no market key of
    // any spelling. Present-and-empty rather than absent, because to a client the two read the
    // same and "nothing traded this Reckoning" is a fact this artifact must be able to state.
    const empty = emptyFrame(0, 0, 'hash');
    expect(Object.keys(empty)).toContain('marketLines');
    expect(empty.marketLines).toEqual([]);
    // And the projection boundary admits the key, so it can be built at all.
    expect([...PUBLIC_FACT_KEYS]).toContain('marketLines');
  });

  it('makes a price COMPARABLE ACROSS PLACES — the field the signature is for', () => {
    // Same good, two venues, 200 vs 100. Galaxy VWAP is volume-weighted: 150.
    const lines = marketLinesFor(
      bookOf([
        fill({ id: 'f1', venue: 'sys-01' as SystemId, unitPrice: minor(100), qty: qty(10) }),
        fill({ id: 'f2', venue: 'sys-02' as SystemId, unitPrice: minor(200), qty: qty(10) }),
      ]),
      100,
      MAX_FRAME_MARKET_LINES,
    );
    expect(lines.length).toBe(2);
    const dear = lines.find((l) => l.venue === 'sys-02');
    const cheap = lines.find((l) => l.venue === 'sys-01');
    expect(dear?.galaxyVwap).toBe(150);
    expect(cheap?.galaxyVwap).toBe(150);
    // +33.33% and −33.33%, in integer bps. This is the number a viewer reads as "haul it there".
    expect(dear?.premiumBps).toBe(3_333);
    expect(cheap?.premiumBps).toBe(-3_333);
    expect(dear?.venues).toBe(2);
    // And the words say which way, so a stranger does not have to do the arithmetic.
    expect(dear?.legend).toContain('DEAR');
    expect(cheap?.legend).toContain('CHEAP');
  });

  it('says ONLY MARKET rather than 0 bps when there is nothing to compare (A2)', () => {
    const [only] = marketLinesFor(bookOf([fill()]), 100, MAX_FRAME_MARKET_LINES);
    expect(only?.venues).toBe(1);
    // Zero by IDENTITY, not by measurement — a sole market IS the galaxy price.
    expect(only?.premiumBps).toBe(0);
    expect(only?.vwap).toBe(only?.galaxyVwap);
    // A2: an absence must not render as a measurement. "0 bps" reads as "fairly priced".
    expect(only?.legend).toContain('ONLY MARKET');
    expect(only?.legend).not.toContain('bps');
  });

  it('distinguishes AT PARITY from ONLY MARKET — two markets that agree is a result', () => {
    const lines = marketLinesFor(
      bookOf([
        fill({ id: 'f1', venue: 'sys-01' as SystemId, unitPrice: minor(100) }),
        fill({ id: 'f2', venue: 'sys-02' as SystemId, unitPrice: minor(100) }),
      ]),
      100,
      MAX_FRAME_MARKET_LINES,
    );
    expect(lines.length).toBe(2);
    for (const l of lines) {
      expect(l.venues).toBe(2);
      expect(l.premiumBps).toBe(0);
      expect(l.legend).toContain('AT PARITY');
      expect(l.legend).not.toContain('ONLY MARKET');
    }
    expect(refusal(lines)).toBe('');
  });

  it('is volume-weighted, publishes its own span, and never shows the future', () => {
    const book = bookOf([
      fill({ id: 'f1', tick: 300, unitPrice: minor(100), qty: qty(90) }),
      fill({ id: 'f2', tick: 310, unitPrice: minor(200), qty: qty(10) }),
    ]);
    const [line] = marketLinesFor(book, 320, MAX_FRAME_MARKET_LINES);
    expect(line?.prints).toBe(2);
    expect(line?.volume).toBe(100);
    // (100*90 + 200*10) / 100 = 110. A mean would say 150, which is the manipulable number.
    expect(line?.vwap).toBe(110);
    // `lastPrice` is the most recent print, which is a different fact from the average.
    expect(line?.lastPrice).toBe(200);
    expect(line?.lastTick).toBe(310);
    // ── THE SPAN, ON THE ARTIFACT ─────────────────────────────────────────────
    //
    // There is no policy window (the measurement that removed one is in `market/observe.ts`), so
    // "2 prints" has to say over what. `firstTick..lastTick` is that, and it also gives a viewer
    // the staleness for free: `frame.tick − lastTick`.
    expect(line?.firstTick).toBe(300);

    // ★ AND A PAST FRAME MUST NEVER SHOW A LATER PRINT. Re-reading the archive at tick 305 has to
    // produce what tick 305 produced, or an immutable frame drifts every time it is fetched.
    const earlier = marketLinesFor(book, 305, MAX_FRAME_MARKET_LINES);
    expect(earlier[0]?.prints).toBe(1);
    expect(earlier[0]?.lastPrice).toBe(100);
    expect(earlier[0]?.firstTick).toBe(300);
    expect(earlier[0]?.lastTick).toBe(300);
    // Nothing at all before the first trade.
    expect(marketLinesFor(book, 299, MAX_FRAME_MARKET_LINES)).toEqual([]);
  });

  it('ranks by the GAP, so the budget drops the places with nothing to say', () => {
    const fills: Fill[] = [];
    // One outlier and many venues at the same price, so the widest premium must survive a cut.
    for (let i = 0; i < MAX_FRAME_MARKET_LINES + 6; i += 1) {
      fills.push(fill({ id: `f${String(i)}`, venue: `sys-${String(i).padStart(2, '0')}` as SystemId }));
    }
    fills.push(fill({ id: 'outlier', venue: 'sys-99' as SystemId, unitPrice: minor(5_000) }));
    const lines = marketLinesFor(bookOf(fills), 100, MAX_FRAME_MARKET_LINES);
    expect(lines.length).toBe(MAX_FRAME_MARKET_LINES);
    expect(lines[0]?.venue).toBe('sys-99');
    expect(Math.abs(lines[0]?.premiumBps ?? 0)).toBeGreaterThan(0);
    // Deterministic: the same book renders the identical frame every time.
    expect(marketLinesFor(bookOf(fills), 100, MAX_FRAME_MARKET_LINES)).toEqual(lines);
    expect(refusal(lines)).toBe('');
  });
});

// ── 2. THE BUDGETS: A PRINT MAY NOT CONTRADICT ITSELF ───────────────────────

describe('a print may not contradict its own price', () => {
  it('accepts an honest line and refuses an over-full frame', () => {
    expect(refusal([print()])).toBe('');
    const many = Array.from({ length: MAX_FRAME_MARKET_LINES + 1 }, (_, i) =>
      print({ venue: `sys-${String(i).padStart(2, '0')}` as SystemId }),
    );
    expect(refusal(many)).toContain('budget is');
  });

  it('★ refuses a premium invented over a sole market', () => {
    // MUTATION: delete the `venues < 2 → premiumBps === 0` clause. A viewer is then told a good
    // is 8% dear at the only place it has ever traded, which is a comparison nobody made.
    expect(refusal([print({ venues: 1, premiumBps: 800 })])).toContain('there is no second price');
    // …and a sole market whose two prices disagree is arithmetically impossible.
    expect(refusal([print({ venues: 1, vwap: minor(100), galaxyVwap: minor(200) })])).toContain(
      'a sole market IS the galaxy price',
    );
    // …and its legend must SAY there is nothing to compare to.
    expect(refusal([print({ venues: 1, legend: 'ORE · 1240 · AT PARITY' })])).toContain(
      'nothing to compare the price to',
    );
  });

  it('★ refuses a premium whose SIGN contradicts the two prices beside it', () => {
    // MUTATION: drop either direction clause. A sign error sends a viewer's eye — and any
    // hauling heuristic built off this frame — the wrong way down the lane.
    expect(
      refusal([print({ venues: 2, vwap: minor(200), galaxyVwap: minor(150), premiumBps: -3_333 })]),
    ).toContain('is DEARER at');
    expect(
      refusal([print({ venues: 2, vwap: minor(100), galaxyVwap: minor(150), premiumBps: 3_333 })]),
    ).toContain('is CHEAPER at');
    // But a premium that rounds to zero on prices one unit apart is ACCEPTED, deliberately: a
    // guard demanding a non-zero number there would be satisfied by fabricating a magnitude.
    expect(
      refusal([
        print({ venues: 2, vwap: minor(20_001), galaxyVwap: minor(20_000), premiumBps: 0, legend: 'ORE · 20001 · AT PARITY across 2 markets' }),
      ]),
    ).toBe('');
  });

  it('refuses a price drawn where nothing traded, and a negative one', () => {
    expect(refusal([print({ prints: 0 })])).toContain('a quote nobody ever made');
    expect(refusal([print({ firstTick: 900, lastTick: 200 })])).toContain('runs backwards');
    expect(refusal([print({ prints: 1, firstTick: 100, lastTick: 200 })])).toContain(
      'a single print happened at a single tick',
    );
    expect(refusal([print({ volume: qty(0) })])).toContain('moved 0 units');
    expect(refusal([print({ lastPrice: minor(-1) })])).toContain('negative price');
    expect(refusal([print({ galaxyVwap: minor(0), venues: 2, premiumBps: 500 })])).toContain(
      'has no denominator',
    );
  });

  it('★ refuses a MANIFEST by field name, not by review (§11.2)', () => {
    // The claim line's stockpile refusal, aimed at this layer's own temptation. A resting order
    // is a hold value and the book is venue-gated in `observe`; a galaxy-wide ladder here would
    // be both A9 inverted and free reconnaissance.
    for (const key of ['restingAsk', 'depth', 'bestBid', 'bestAsk', 'ladder', 'ownerPrincipal', 'inventory', 'escrowedQty']) {
      const leaky: MarketLine = { ...print(), [key]: 400 };
      expect(refusal([leaky]), key).toContain('reads as a resting order');
    }
  });
});

// ── 3. A9: THE SPECTATOR SEES NO FACT AN AGENT'S OWN observe WOULD NOT ──────

describe('A9 parity: a fill is a deed, a resting order is a manifest', () => {
  it('★ the projection reads FILLS ONLY — a resting order changes no line', () => {
    // MUTATION: build the line from `book.openIn(...)` or splice a best bid/ask onto it. This
    // fails, and it fails for the right reason: an order that has not traded is not a price.
    const book = bookOf([fill()]);
    const before = marketLinesFor(book, 100, MAX_FRAME_MARKET_LINES);
    // A real `Order`, not a cast-shaped stub: the point is that the projection ignores a
    // genuine resting ask, and a stub the book would not accept would prove nothing.
    const resting: Order = {
      id: 'ord:resting' as OrderId,
      principal: 'p:z' as PrincipalId,
      venue: 'sys-05' as SystemId,
      good: 'ore' as GoodId,
      side: 'ASK',
      limitPrice: minor(9_999),
      quantity: qty(400),
      filled: qty(0),
      state: 'OPEN',
      timeInForce: 'GTC',
      placedTick: 100,
      expiresTick: 999,
      clientSequence: 1,
      encumbranceId: null,
    };
    book.add(resting);
    expect(book.open().length).toBe(1);
    // The resting ask is 8x the last print and 400 units deep. Nothing on the frame moves.
    expect(marketLinesFor(book, 100, MAX_FRAME_MARKET_LINES)).toEqual(before);
  });

  it('names no principal, so the frame cannot become a scouting service', () => {
    const lines = marketLinesFor(
      bookOf([fill({ buyer: 'p:whale' as Fill['buyer'], seller: 'p:miner' as Fill['seller'] })]),
      100,
      MAX_FRAME_MARKET_LINES,
    );
    const json = JSON.stringify(lines);
    // Buyer and seller ARE public in the record (economy law 10) and every agent reads them in
    // `market.ticker`. They are left off the *price tag* anyway: a viewer needs the price, and a
    // per-place list of who bought what is the inventory map §11.2 keeps SENSED.
    expect(json).not.toContain('whale');
    expect(json).not.toContain('miner');
    expect(refusal(lines)).toBe('');
  });
});

// ── 4. IT REACHES A REAL FRAME, FROM A WORLD NOBODY STEERED ─────────────────

describe('★ a real seeded world puts a real price on a real frame', () => {
  it('renders prints from the cast\'s own trades, and the budgets accept them', () => {
    setSpeed('instant');
    // Seeds and horizon from `the-buy-side-is-funded.spec.ts`, which is where fills first
    // appeared: 6 Reckonings, 8 members, nobody funded by hand.
    let worldsThatTraded = 0;
    let framesWithAPrice = 0;
    let printedLines = 0;
    for (const seed of ['g01', 'g02', 'g03']) {
      const runtime = new Runtime({ seed });
      const cast = new HeuristicCast(runtime, { size: 8 });
      cast.seat(seed);
      for (let i = 0; i < 6 * TICKS_PER_RECKONING; i += 1) {
        const next = runtime.engine.tick + 1;
        for (const action of cast.decide(next, seed)) runtime.engine.submit(action);
        const report = runtime.runTick();
        expect(report.halted, `${seed} halted at ${String(report.tick)}`).toBe(false);
      }
      // Non-vacuity: this file is only about A13 if the world actually traded. Measured at this
      // horizon: 6, 3 and 1 fills. A sparse market is what a young economy looks like, and it is
      // exactly why there is no policy window — with trades this rare any fixed one is empty most
      // nights, and an empty panel tells a viewer the good has never traded (A2).
      if (runtime.market.fills().length === 0) continue;
      worldsThatTraded += 1;
      const head = runtime.engine.tick;
      const lines = runtime.marketLines(head);
      expect(() => assertFrameBudgets(frameWith(lines))).not.toThrow();
      framesWithAPrice += lines.length > 0 ? 1 : 0;
      printedLines += lines.length;
      for (const l of lines) {
        expect(l.prints).toBeGreaterThan(0);
        expect(l.volume).toBeGreaterThan(0);
        expect(l.vwap).toBeGreaterThan(0);
        expect(l.legend).toContain(String(l.good).toUpperCase());
        // The span, stated on the artifact and actually covering the prints it counted.
        expect(l.firstTick).toBeLessThanOrEqual(l.lastTick);
        expect(l.lastTick).toBeLessThanOrEqual(head);
      }
    }
    // Non-vacuity first, then the claim. If the worlds stop trading the finding is in the market
    // or the cast, and this must say which rather than passing quietly on an empty loop.
    expect(worldsThatTraded, 'no seeded world traded at all; there is nothing here to draw').toBe(3);
    expect(
      framesWithAPrice,
      'a world traded and its Reckoning frame carried no price; an absence reads as "never traded here" (A2)',
    ).toBe(3);
    expect(printedLines).toBeGreaterThan(0);
  }, 300_000);
});
