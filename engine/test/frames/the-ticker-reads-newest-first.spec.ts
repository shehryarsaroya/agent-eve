/**
 * ★ **THE TICKER READ OLDEST-FIRST EVERYWHERE** — so every reader that took a few lines took the oldest.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * The world keeps the ticker in a 32-line FIFO (`runtime.ts:raidTicker`, a `Ring`), oldest first, and
 * both frames published it in that order. Every consumer read the head: the client's map strip
 * (`slice(0, 6)`), the RECORD panel's numbering, and the MCP bridge's `eve_map` — *"the latest ticker
 * lines"* — with `take(frame.ticker, 12)`. The lines carry no tick, so the order is the only recency
 * a reader has, and the raid that just landed was the line nobody could see.
 *
 * One order now, `frames/contract.ts:publishedTicker`: NEWEST FIRST on both frames.
 * ══════════════════════════════════════════════════════════════════════════
 */

import { describe, expect, it } from 'vitest';
import { minor } from '../../src/core/units.js';
import { MAX_RAID_TICKER_LINES, Runtime } from '../../src/sim/runtime.js';
import { HeuristicCast } from '../../src/cast/index.js';
import { TICKS_PER_RECKONING, setSpeed } from '../../src/core/time.js';
import { publishedTicker } from '../../src/frames/contract.js';
import { renderFrame } from '../../src/frames/render.js';
import { renderLiveFrame } from '../../src/frames/live.js';

describe('★ both frames publish the ticker newest first', () => {
  it('★ the nightly and the live renderer put the LAST line produced at the head', () => {
    // MUTATION: drop `.reverse()` from `publishedTicker` — both frames lead with 'oldest'. RED.
    const produced = ['oldest', 'middle', 'newest'];
    const nightly = renderFrame({
      reckoning: 1,
      tick: 575,
      stateHash: 'h',
      settled: [],
      meters: { levyShort: minor(0), onAPromise: minor(0), keptRecent: 0, brokenRecent: 0 },
      handles: new Map(),
      ticker: produced,
      tomorrow: [],
    });
    expect(nightly.ticker).toEqual(['newest', 'middle', 'oldest']);
    const live = renderLiveFrame({ tick: 5, stateHash: 'h', lastReckoning: null, ventures: [], ticker: produced });
    expect(live.ticker).toEqual(['newest', 'middle', 'oldest']);
  });

  it('still drops a line over 140 characters rather than publishing it, in either order', () => {
    expect(publishedTicker(['a', 'x'.repeat(141), 'b'])).toEqual(['b', 'a']);
    // The input is never mutated — it is the world's own ring.
    const ring = ['1', '2'];
    publishedTicker(ring);
    expect(ring).toEqual(['1', '2']);
  });

  it('★ in a driven world every NEW line lands at the head, including after the ring is full', () => {
    setSpeed('instant');
    const seed = 'ticker-newest-first';
    const rt = new Runtime({ seed });
    const cast = new HeuristicCast(rt, { size: 12 });
    cast.seat(seed);
    let previous: readonly string[] = [];
    let arrivals = 0;
    let arrivalsWhileFull = 0;
    let settlementsCompared = 0;
    let firstFullAt: number | null = null;
    // Five Reckonings, because the 32-line ring fills somewhere in the fifth on this seed (measured), and
    // the full ring is the case the head-takers got most wrong: its oldest line was about to be dropped.
    for (let i = 0; i < 5 * TICKS_PER_RECKONING; i += 1) {
      for (const a of cast.decide(rt.engine.tick + 1, seed)) rt.engine.submit(a);
      const report = rt.runTick();
      if (report.halted) throw new Error(`halted at ${String(report.tick)}`);
      const ticker = rt.liveFrame().ticker;
      if (firstFullAt === null && ticker.length === MAX_RAID_TICKER_LINES) firstFullAt = report.tick;
      // Lines new on this tick: the ring only ever appends, so they are a run at the newest end.
      const fresh = ticker.filter((line) => !previous.includes(line));
      if (fresh.length > 0 && fresh.length < ticker.length) {
        arrivals += 1;
        if (previous.length === MAX_RAID_TICKER_LINES) arrivalsWhileFull += 1;
        expect(
          ticker.slice(0, fresh.length),
          `tick ${String(report.tick)}: the new line(s) must lead the ticker, not trail it`,
        ).toEqual(fresh);
      }
      // And the nightly frame, built at the same tick from the same ring, agrees line for line.
      if (report.clock.isSettlementTick) {
        const nightly = rt.reckoningFrame();
        if (nightly !== null) {
          settlementsCompared += 1;
          expect(nightly.ticker).toEqual(ticker);
        }
      }
      previous = ticker;
    }
    // NON-VACUITY: lines must actually have arrived, and some of them into a full ring, which is the case
    // where an oldest-first head is not merely stale but has already been pushed out of the strip.
    expect(arrivals, 'no ticker line ever arrived — nothing was tested').toBeGreaterThan(0);
    expect(arrivalsWhileFull, 'the ring never filled, so the wrap case went unexercised').toBeGreaterThan(0);
    expect(settlementsCompared).toBeGreaterThan(0);
    console.log('ticker lines arrived on', arrivals, 'ticks;', arrivalsWhileFull, 'into a full ring; first full at tick', firstFullAt);
  }, 120_000);
});
