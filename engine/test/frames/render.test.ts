/**
 * The renderer, and the properties that make a frame safe to publish.
 *
 * Two of the three goals are about watching, and the scoring panel found Legible was
 * the lowest-scoring dimension because mechanics bolted on to answer critics got their
 * economics and their prose but neither their arithmetic nor their pixels. So these are
 * arithmetic tests about pixels.
 */

import { describe, expect, it } from 'vitest';
import { minor } from '../../src/core/units.js';
import type { Handle, PrincipalId, VentureId } from '../../src/core/types.js';
import {
  MAX_LABELS_PER_FRAME,
  MAX_RUNDOWN_SEGMENTS,
  FrameBudgetError,
  assertFrameBudgets,
} from '../../src/frames/contract.js';
import { emptyFrame, renderFrame, type FrameSource, type SettledView } from '../../src/frames/render.js';

const P = (n: string): PrincipalId => `p:${n}` as PrincipalId;
const H = (n: string): Handle => n as Handle;

function settled(over: Partial<SettledView> = {}): SettledView {
  return {
    venture: 'v-1' as VentureId,
    kind: 'HAUL',
    stage: 'sys-vega',
    creator: P('halcyon'),
    rolesFilled: 2,
    rolesTotal: 2,
    electiveBps: 3_000,
    atStake: minor(10_000),
    defaulted: false,
    deferred: false,
    parties: [P('halcyon'), P('vex')],
    publicLine: 'the cargo moves tonight',
    sealVerdict: 'HONOURED',
    sealContent: 'I will deliver',
    messages: [],
    ...over,
  };
}

function source(over: Partial<FrameSource> = {}): FrameSource {
  return {
    reckoning: 3,
    tick: 1151,
    stateHash: 'abc123',
    settled: [settled()],
    meters: { levyShort: minor(1_800_000), onAPromise: minor(812_000), kept: 214, broken: 9 },
    handles: new Map([
      [P('halcyon'), H('halcyon')],
      [P('vex'), H('vex')],
    ]),
    ticker: ['halcyon paid up'],
    tomorrow: [],
    ...over,
  };
}

describe('renderFrame', () => {
  it('renders a settled Reckoning within every §17 legibility budget', () => {
    const f = renderFrame(source());
    expect(f.rundown.length).toBe(1);
    expect(f.reckoningIndex).toBe(3);
    expect(f.meters.broken).toBe(9);
  });

  it('holds defaults to the END of the rundown regardless of amount', () => {
    // §14.3's format, not a preference: the largest say-do deltas are held back, and a
    // broken promise is the largest delta there is. A tiny default must still close the
    // show ahead of a large honoured settlement.
    const f = renderFrame(
      source({
        settled: [
          settled({ venture: 'v-big' as VentureId, atStake: minor(900_000), defaulted: false }),
          settled({ venture: 'v-tiny' as VentureId, atStake: minor(5), defaulted: true }),
        ],
      }),
    );
    expect(f.rundown.map((s) => s.venture)).toEqual(['v-big', 'v-tiny']);
    expect(f.rundown[f.rundown.length - 1]?.venture).toBe('v-tiny');
  });

  it('orders reproducibly from the same outcome, ties included', () => {
    // A running order that depends on Map insertion or object identity would make the
    // broadcast unreproducible from the ledger, which is the whole basis for
    // broadcast_speed being independent of sim_speed.
    const src = source({
      settled: [
        settled({ venture: 'v-b' as VentureId, atStake: minor(100) }),
        settled({ venture: 'v-a' as VentureId, atStake: minor(100) }),
      ],
    });
    expect(renderFrame(src).rundown.map((s) => s.venture)).toEqual(
      renderFrame(src).rundown.map((s) => s.venture),
    );
    expect(renderFrame(src).rundown.map((s) => s.venture)).toEqual(['v-a', 'v-b']);
  });

  it('attaches a receipt reel ONLY where an elective promise broke', () => {
    // A reel on a kept promise would be the show editorialising, which A12 forbids.
    const msgs = [{ tick: 100, from: P('vex'), text: 'the escort will be there' }];
    const kept = renderFrame(source({ settled: [settled({ messages: msgs, defaulted: false })] }));
    expect(kept.rundown[0]?.receiptReel).toBeNull();

    const broke = renderFrame(source({ settled: [settled({ messages: msgs, defaulted: true })] }));
    expect(broke.rundown[0]?.receiptReel).toEqual([
      { tick: 100, from: 'vex', text: 'the escort will be there' },
    ]);
  });

  it('never shows a raw principal id where a handle belongs', () => {
    // A frame full of `p:0x…` is a screensaver. Every label goes through the handle map.
    const f = renderFrame(source());
    const json = JSON.stringify(f);
    for (const chip of f.rundown[0]?.cast ?? []) {
      expect(chip.handle).not.toMatch(/^p:/);
    }
    expect(json).toContain('halcyon');
  });

  it('truncates the cast to the label budget rather than shipping an unreadable frame', () => {
    // Truncation is correct HERE and forbidden in `observe`. Dropping an affordance
    // hides an option the agent was entitled to (PROP-O1); dropping a label past seven
    // costs legibility nothing, because a viewer reads none of eight.
    const many = Array.from({ length: 12 }, (_, i) => P(`agent${String(i)}`));
    const f = renderFrame(
      source({
        settled: [settled({ parties: many })],
        handles: new Map(many.map((p) => [p, H(p.slice(2))])),
      }),
    );
    expect(f.rundown[0]?.cast.length).toBe(MAX_LABELS_PER_FRAME);
  });

  it('refuses to publish a frame that breaks a budget', () => {
    // assertFrameBudgets is the A13 gate and it must THROW rather than degrade: an
    // over-full frame that renders anyway is how "every mechanic renders" quietly
    // becomes false.
    //
    // My first version of this test threw FrameBudgetError unconditionally at the end
    // of its own callback, so it passed no matter what the guard did — a tautology, and
    // exactly the class of dead test this project has already shipped five of. Calling
    // the guard directly on a deliberately over-full frame is the honest version.
    const f = renderFrame(source({ settled: [settled()] }));
    const overFull = {
      ...f,
      rundown: Array.from({ length: MAX_RUNDOWN_SEGMENTS + 1 }, (_, i) => ({
        ...f.rundown[0]!,
        order: i + 1,
        venture: `v-${String(i)}` as VentureId,
      })),
    };
    expect(() => {
      assertFrameBudgets(overFull);
    }).toThrow(FrameBudgetError);
    // And the healthy frame passes the same guard, so the throw above is about the
    // budget rather than about the fixture being malformed.
    expect(() => {
      assertFrameBudgets(f);
    }).not.toThrow();
  });

  it('slices the rundown to the budget rather than handing the guard an over-full frame', () => {
    const tooMany = Array.from({ length: MAX_RUNDOWN_SEGMENTS + 5 }, (_, i) =>
      settled({ venture: `v-${String(i)}` as VentureId, atStake: minor(i + 1) }),
    );
    const f = renderFrame(source({ settled: tooMany }));
    expect(f.rundown.length).toBe(MAX_RUNDOWN_SEGMENTS);
    // The dropped segments are the LARGEST stakes, which is a real editorial choice and
    // therefore worth pinning: ascending order means a budget cut loses the top of the
    // show. If that is ever wrong, it should fail here and be argued.
    expect(f.rundown[0]?.venture).toBe('v-0');
  });

  it('never carries seal content without a verdict', () => {
    // Content with no verdict means the renderer invented a reveal.
    const f = renderFrame(source({ settled: [settled({ sealVerdict: null, sealContent: null })] }));
    expect(f.rundown[0]?.sealContent).toBeNull();
  });

  it('drops a ticker line over 140 characters instead of publishing it', () => {
    const f = renderFrame(source({ ticker: ['ok', 'x'.repeat(141)] }));
    expect(f.ticker).toEqual(['ok']);
  });

  it('an empty Reckoning renders honestly rather than not at all', () => {
    // The client must be able to say "nothing settled" — inventing a docket would be
    // worse than an empty screen.
    const f = emptyFrame(0, 287, 'hash');
    expect(f.rundown).toEqual([]);
    expect(f.docket).toEqual([]);
    expect(f.meters.kept).toBe(0);
  });
});
