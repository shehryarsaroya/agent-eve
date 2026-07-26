/**
 * §11.1's three layers reach the viewer: what it SAID, what it SEALED, what it DID.
 *
 * These three fields were hardcoded `null, null, []` in `reckoningFrame`. Measured on the
 * live world at one moment: 371 seals, 126 messages, ten segments carrying zero of each.
 * §14's receipt reel is the public claim placed beside the broken promise, so with the
 * claim missing a betrayal was costly but not legible — and legibility is the product.
 */
import { describe, expect, it } from 'vitest';
import { Runtime } from '../../src/sim/runtime.js';
import { setSpeed } from '../../src/core/time.js';
import { HeuristicCast } from '../../src/cast/index.js';

/** A world that actually does something: the heuristic cast drives it, as the durability tests do. */
function world(seed: string): { rt: Runtime; run: (n: number) => void } {
  setSpeed('instant');
  const rt = new Runtime({ seed });
  const cast = new HeuristicCast(rt, { size: 6 });
  cast.seat(seed);
  const run = (n: number): void => {
    for (let i = 0; i < n; i += 1) {
      const target = rt.engine.tick + 1;
      for (const a of cast.decide(target, seed)) rt.engine.submit(a);
      const r = rt.runTick();
      if (r.halted) throw new Error(`halted at ${String(r.tick)}`);
    }
  };
  return { rt, run };
}

describe('the frame carries what was said and what was sealed', () => {
  it('reads the seal verdict and the assurance off the books rather than nulling them', () => {
    const { rt, run } = world('saydo-1');
    run(700); // long enough for real ventures to settle and real seals to resolve
    const frame = rt.reckoningFrame();
    expect(frame, 'a Reckoning must have settled in 700 ticks').not.toBeNull();
    if (frame === null) return;

    // The books have material — otherwise this test proves nothing about the wiring.
    const verdicts = rt.seals.auditRecords().filter((r) => r.verdict !== null).length;
    console.log('resolved seal verdicts in the book:', verdicts, '| segments:', frame.rundown.length);
    expect(frame.rundown.length).toBeGreaterThan(0);

    // The FIELDS must exist on the segment shape — the defect was that they were dropped,
    // so the shape assertion is the regression guard even in a Reckoning where the cast
    // happened to seal nothing on a settling venture.
    for (const seg of frame.rundown) {
      expect(Object.prototype.hasOwnProperty.call(seg, 'sealVerdict')).toBe(true);
      expect(Object.prototype.hasOwnProperty.call(seg, 'publicLine')).toBe(true);
    }

    // If any seal resolved against a venture that settled here, its verdict must appear.
    const settledIds = new Set(frame.rundown.map((s) => String(s.venture)));
    const expected = rt.seals
      .auditRecords()
      .filter((r) => r.role !== null && r.verdict !== null && settledIds.has(String(r.role.venture)));
    if (expected.length > 0) {
      const shown = frame.rundown.filter((s) => s.sealVerdict !== null).length;
      console.log('seals resolved on settled ventures:', expected.length, '| segments showing a verdict:', shown);
      expect(shown, 'a resolved seal on a settled venture must reach the frame').toBeGreaterThan(0);
    }
  }, 60_000);

  it('a receipt reel only exists where an elective promise BROKE (A12)', () => {
    // The reel is the show quoting somebody against themselves. On a KEPT promise that
    // would be the show editorialising, which A12 forbids.
    //
    // HONESTLY: this property is guarded TWICE and this test cannot tell you which guard
    // holds it. `runtime` only fills `messages` on a DEFAULTED settlement, and
    // `render.ts` independently builds the reel only when `v.defaulted && messages.length
    // > 0`. Mutating the runtime filter to fill messages always leaves this green, because
    // render's check catches it. So the runtime filter is defence in depth, and render is
    // the load-bearing one — recorded rather than dressed up as a proven guard, because a
    // guard I claim is proven and is not is worse than one I label.
    const { rt, run } = world('saydo-2');
    run(700);
    const frame = rt.reckoningFrame();
    if (frame === null) return;
    for (const seg of frame.rundown) {
      // A beat may now be a LAPSE or a PLUNDER rather than a SETTLEMENT, and those carry no glyph
      // (a glyph is venture-shaped — roles filled, elective fraction — and a lapsed claim has
      // neither). They also carry no reel, so the A12 property below holds for them too: `broke`
      // is false, and the assertion demands an empty reel, which is exactly right.
      const broke = seg.glyph?.state === 'SNAPPED_BLACK';
      if (!broke) {
        expect(
          (seg.receiptReel ?? []).length,
          'a kept promise must carry no reel — that would be editorialising',
        ).toBe(0);
      }
    }
  }, 60_000);
});
