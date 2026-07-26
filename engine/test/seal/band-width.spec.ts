/**
 * Can a seal promise nothing and still be recorded as kept?
 *
 * A seal is the commitment half of the say-do gap: an agent states, in advance, the band its deed
 * will land in, and the Reckoning records `HONOURED` or `CONTRADICTED` against its name forever. The
 * verdict is `inBand`, which is a bare `outcome >= low && outcome <= high` — and **nothing anywhere
 * constrains the width of that band.**
 *
 * If that is exploitable it is worse than a missing feature. An agent that seals
 * `[0, MAX_SAFE_INTEGER]` earns a permanent public `HONOURED` while committing to nothing, which does
 * not merely fail to build trust — it MANUFACTURES it. A5′ says the record must never be wrong, and a
 * record that says "kept its word" about someone who promised nothing is wrong in the most damaging
 * direction available.
 */

import { describe, expect, it } from 'vitest';
import { inBand, intentFaults, MAX_BAND_WIDTH } from '../../src/seal/intent.js';
import type { SealIntent } from '../../src/seal/intent.js';

function intent(low: number, high: number): SealIntent {
  return {
    verb: 'deliver',
    target: 'v:1',
    measure: 'MINOR',
    outcomeLow: low,
    outcomeHigh: high,
  } as unknown as SealIntent;
}

/** The refusal text, or '' when the band is accepted. */
function refusal(low: number, high: number): string {
  return intentFaults(intent(low, high)).join(' ');
}

describe('the band is the promise, so its width is the commitment', () => {
  it('an everything-band is honoured by every possible outcome', () => {
    // The exploit, stated as arithmetic. If this passes, a seal can be a free permanent HONOURED.
    const everything = intent(0, Number.MAX_SAFE_INTEGER);
    for (const outcome of [0, 1, 500, 10_000, 999_999_999]) {
      expect(
        inBand(everything, outcome),
        `an outcome of ${String(outcome)} satisfies a band of [0, MAX] — the seal promised nothing`,
      ).toBe(true);
    }
  });

  it('a real band excludes real outcomes, which is what makes it a promise', () => {
    const tight = intent(9_000, 11_000);
    expect(inBand(tight, 10_000), 'the promised outcome').toBe(true);
    expect(inBand(tight, 0), 'delivering nothing must NOT satisfy it').toBe(false);
    expect(inBand(tight, 100_000), 'nor must wildly overshooting').toBe(false);
  });
});

describe('a band that cannot be missed is refused at the door', () => {
  it('refuses the everything-band, which was legal', () => {
    // The exploit, closed. `[0, MAX_SAFE_INTEGER]` was accepted and honoured by every outcome.
    expect(refusal(0, Number.MAX_SAFE_INTEGER)).toMatch(/cannot be missed is not a promise/);
    expect(refusal(1, Number.MAX_SAFE_INTEGER), 'and the floor-dodge too').toMatch(/spans/);
  });

  it('still permits a seal about a LOSS, which a floor rule would have forbidden', () => {
    // My first attempt required `outcomeLow > 0` and `intent.test.ts` refused it — correctly. A
    // promise to lose no more than 900 is a real promise, and a floor rule outlaws the whole class.
    expect(refusal(-900, 0), 'a negative band is a legitimate promise').toBe('');
    expect(refusal(-5_000, -1_000)).toBe('');
  });

  it('permits every band with a real quantity behind it, including a weak one', () => {
    // The rule refuses a band that spans the NUMBER LINE, not one that is merely unambitious. A
    // wide-but-finite band is a weak claim, and the record showing it as weak is the mechanic
    // working rather than something to forbid.
    expect(refusal(4_800, 7_200), "the engine's own reference band").toBe('');
    expect(refusal(1_000, 12_000), 'a 12x band — weak, but a real promise').toBe('');
    expect(refusal(1, MAX_BAND_WIDTH), 'right up to the limit').toBe('');
    expect(refusal(1, MAX_BAND_WIDTH + 2), 'and just past it').toMatch(/spans/);
  });

  it('keeps refusing the inverted band, whose mirror this is', () => {
    // The check that already existed. Together they close both directions: a band nothing can land
    // in is contradicted by construction, and a band everything lands in is honoured by it.
    expect(refusal(9_000, 1_000)).toMatch(/contradicted by construction/);
  });
});
