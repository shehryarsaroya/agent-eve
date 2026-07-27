/**
 * A13: a mechanic with no named pixel signature is not ready, however good it is.
 *
 * WORKS's signature is the **mark on a worked system**, and the number that makes it worth
 * drawing is `occupants` — a system with four WORKS on it is visibly a contested seam, which is
 * the picture the whole mechanic exists to produce. Ordered by crowding rather than by total
 * extracted, because a sort by total would rank the oldest WORKS top forever and turn the map
 * into a leaderboard of tenure.
 *
 * The second half of this file is the §11.2 boundary, and it is here rather than in a review
 * because this is the second mechanic whose tempting field is a stockpile. The Charge's rejected
 * "fuel gauge" published Reckonings-of-cover — a public recipe over a private stock — and an
 * outside critic had to catch it. `assertFrameBudgets` now refuses that shape outright.
 */

import { describe, expect, it } from 'vitest';
import type { PrincipalId, SystemId } from '../../src/core/types.js';
import {
  assertFrameBudgets,
  MAX_FRAME_WORKS_LINES,
  type ReckoningFrame,
  type WorksLine,
} from '../../src/frames/contract.js';
import { emptyFrame } from '../../src/frames/render.js';

function mark(over: Partial<WorksLine> = {}): WorksLine {
  return {
    works: 'works:sys-05:10:p:a',
    system: 'sys-05' as SystemId,
    holder: 'p:a' as PrincipalId,
    yieldPerTick: 110,
    occupants: 1,
    sharePerTick: 110,
    legend: 'EXTRACTING',
    extracted: 4_400,
    rentBps: 0,
    rentPerTick: 0,
    rentPaid: 0,
    fuelPerTick: 0,
    fuelExtracted: 0,
    ...over,
  };
}

function frameWith(lines: readonly WorksLine[]): ReckoningFrame {
  return { ...emptyFrame(0, 0, 'hash'), worksLines: lines };
}

/**
 * `assertFrameBudgets` REFUSES by throwing, which is the contract that matters: a frame that
 * breaks its own legibility rules is not drawn at all, rather than drawn with a warning
 * somewhere. So the helper returns the refusal text, and an empty string means it was accepted.
 */
function refusal(lines: readonly WorksLine[]): string {
  try {
    assertFrameBudgets(frameWith(lines));
    return '';
  } catch (error: unknown) {
    return error instanceof Error ? error.message : String(error);
  }
}

describe('the mark renders, and it reads as crowding', () => {
  it('accepts a coherent mark', () => {
    expect(refusal([mark()]), 'a coherent mark is drawn').toBe('');
  });

  it('accepts a spinning-up mark that quotes no share', () => {
    expect(refusal([mark({ legend: 'SPINNING UP 6 ticks', sharePerTick: 0 })])).toBe('');
  });
});

describe('a mark may not contradict its own numbers', () => {
  it('refuses EXTRACTING with a dead share', () => {
    expect(refusal([mark({ sharePerTick: 0 })])).toMatch(/legend and the number disagree/);
  });

  it('refuses a spinning-up mark quoting a live share', () => {
    expect(refusal([mark({ legend: 'SPINNING UP 3 ticks', sharePerTick: 55 })])).toMatch(
      /not online extracts nothing/,
    );
  });

  it('refuses a share larger than the whole place yields', () => {
    expect(refusal([mark({ sharePerTick: 200 })])).toMatch(/can never exceed the whole/);
  });

  it('refuses a mark on a system with no occupants', () => {
    expect(refusal([mark({ occupants: 0 })])).toMatch(/occupants/);
  });

  it('keeps the legend a legend, not a heatmap', () => {
    const many = Array.from({ length: MAX_FRAME_WORKS_LINES + 4 }, (_, i) =>
      mark({ works: `works:sys-05:${String(i)}:p:a` }),
    );
    expect(refusal(many)).toMatch(/budget is/);
  });
});

describe('the rejected fuel gauge is refused by SHAPE, not by review', () => {
  /**
   * `extracted` — what the world has already HANDED OVER — is admissible: it is a sum of
   * completed public acts, one event per tick. What the holder still HAS is `SENSED`, and the
   * two differ by everything it has spent. Any field naming a stock, a reserve or a coverage
   * figure is a private stockpile wearing a public formula, and it cannot reach a screen.
   */
  it.each(['coverRemaining', 'reserveQty', 'stockHere', 'gaugeBps', 'heldQty'])(
    'refuses a line carrying %s',
    (key) => {
      const smuggled: WorksLine = { ...mark(), [key]: 9_000 };
      expect(refusal([smuggled]), `${key} must be refused`).toMatch(/stockpile|fuel gauge/);
    },
  );

  it('still admits extracted, which is the handover total', () => {
    expect(refusal([mark({ extracted: 1_000_000 })])).toBe('');
  });
});
