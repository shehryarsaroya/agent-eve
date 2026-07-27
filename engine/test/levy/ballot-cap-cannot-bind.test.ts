/**
 * A CAP THAT BOUND BELOW THE POPULATION IT WAS CAPPING.
 *
 * `MAX_LEVY_BALLOTS` was a flat 512. The ballot book keys one row per principal per Reckoning and
 * keeps `LEVY_RETAINED_RECKONINGS` (3) of them, so it bound at 512/3 ≈ **171 concurrently-voting
 * principals** — well below the 300 the world seats. Past that point the first 171 to vote filled the
 * book and `castBallot` refused everyone else.
 *
 * That is a denial of the Levy ballot decided by **arrival order**, which is A4's *"never let
 * requests-per-second be power"* arriving through the cap table rather than through a verb. And
 * enrolment is free, so reaching it costs nothing.
 *
 * The fix is a derivation, not a bigger number: `MAX_PRINCIPALS × (LEVY_RETAINED_RECKONINGS + 1)`.
 * `MAX_PRINCIPALS` moved to `core/time.ts` so the seat policy in `api/seats.ts` and the domain caps
 * in `levy/params.ts` read the same figure — they may not import each other, which is exactly how
 * they drifted apart in the first place.
 *
 * The extra Reckoning is not padding. A seat recycles only after four Reckonings of silence, longer
 * than the three retained here, so within one retention window a recycled seat's new occupant can
 * cast a ballot while the previous occupant's row is still held.
 *
 * ── WHY THIS IS RAISED WHERE `MAX_LEVY_ASSESSMENTS` WAS REMOVED ───────────────
 * The assessment cap was deleted from two paths after it produced an exploit (enrolment 513 seated
 * with no tenure row, reading as tenure 0 forever) and a halt (a cap on plan lines is a cap on the
 * roll). This one refuses through `vVote` as an agent-visible hint and strands nothing — so raising
 * it is right where removing that one was. `levy/params.ts` states the distinction; this file asserts
 * the arithmetic.
 */

import { describe, expect, it } from 'vitest';
import { MAX_PRINCIPALS } from '../../src/core/time.js';
import { LEVY_RETAINED_RECKONINGS, MAX_LEVY_BALLOTS } from '../../src/levy/params.js';
import { DEFAULT_SEATS } from '../../src/api/seats.js';

describe('the ballot cap cannot bind below the population the world admits', () => {
  it('binds strictly above MAX_PRINCIPALS, not below it', () => {
    // The arithmetic that was wrong: how many principals can hold a ballot before the book is full.
    const bindsAt = Math.floor(MAX_LEVY_BALLOTS / LEVY_RETAINED_RECKONINGS);
    expect(
      bindsAt,
      `the ballot book fills at ${String(bindsAt)} voting principals and the world seats ` +
        `${String(MAX_PRINCIPALS)}. Past that the first ${String(bindsAt)} to vote fill it and every ` +
        'other principal is refused — a denial of the Levy ballot decided by arrival order (A4).',
    ).toBeGreaterThan(MAX_PRINCIPALS);
  });

  it('is derived from the population, so raising the seat count cannot re-break it', () => {
    // The point of the fix. A flat number needs someone to remember; a derivation does not.
    expect(MAX_LEVY_BALLOTS).toBe(MAX_PRINCIPALS * (LEVY_RETAINED_RECKONINGS + 1));
  });

  it('and the seat policy reads the same population figure', () => {
    // They could not import each other, which is how a flat 512 and a flat 300 drifted apart. One
    // home now: `core/time.ts`.
    expect(DEFAULT_SEATS).toBe(MAX_PRINCIPALS);
  });

  it('covers the seat-recycle overlap the retention window allows', () => {
    // A seat recycles after four Reckonings of silence; three are retained here. So a recycled seat's
    // new occupant can vote while the old occupant's row is still held, and the headroom must be at
    // least one Reckoning's worth of principals. Asserted so the "+ 1" cannot be trimmed as padding.
    const legitimateMax = MAX_PRINCIPALS * LEVY_RETAINED_RECKONINGS;
    expect(MAX_LEVY_BALLOTS - legitimateMax).toBeGreaterThanOrEqual(MAX_PRINCIPALS);
  });

  it('still bounds growth, because an uncapped book is scar #3', () => {
    // The cap must remain a cap. Removing it entirely was the wrong lesson to draw from
    // `MAX_LEVY_ASSESSMENTS`, whose problem was that it STRANDED a Reckoning, not that it existed.
    expect(Number.isSafeInteger(MAX_LEVY_BALLOTS)).toBe(true);
    expect(MAX_LEVY_BALLOTS).toBeGreaterThan(0);
    expect(MAX_LEVY_BALLOTS).toBeLessThan(1_000_000);
  });
});
