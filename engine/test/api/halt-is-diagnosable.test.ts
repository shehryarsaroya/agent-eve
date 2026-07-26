/**
 * A HALTED WORLD MUST SAY WHAT BROKE.
 *
 * Found by living it. A probe agent's world went `PAUSED` at tick 1281 — four Reckonings and
 * twenty-one principals in — and there was no way to learn why:
 *
 *   - the tick loop had `if (!report.halted) { persist }` and **no `else`**, so the halt was
 *     never logged. The entire server log was its six boot lines.
 *   - `/health` reported `PAUSED` and told the operator to *"replay the failed tick from its
 *     triple"* without naming the invariant, the tick, or the hash.
 *
 * Halting is correct: on assertion failure the tick aborts and nothing is published. Being unable
 * to say what fired is not, and it matters more here than in most systems — A5′ says the record
 * must never be wrong, so telling a real violation from a false one quickly is the whole job.
 *
 * A first suspicion was that the probe halted it with malformed input (its last two actions were a
 * `move` to a nonexistent system and an `elect` with fields missing, both of which returned
 * `accepted` at the wire). `malformed-cannot-halt.test.ts` refutes that across fourteen shapes.
 * The real cause was never recoverable, because of the silence this file is about.
 */

import { describe, expect, it } from 'vitest';
import { buildHealth, DECIDING_FLOOR_BPS, type HaltRecord } from '../../src/api/health.js';
import { SeatBook } from '../../src/api/seats.js';
import { setSpeed } from '../../src/core/time.js';
import { Runtime } from '../../src/sim/runtime.js';

/** Halt the way the engine really does: a HALT-severity violation through the controller. */
function pausedWorld(seed: string): Runtime {
  setSpeed('instant');
  const rt = new Runtime({ seed });
  rt.runTick();
  const tick = rt.engine.tick;
  rt.engine.controller.haltTick({
    tick,
    violations: [
      {
        id: 'INV-7',
        message: 'postings for tick did not sum to zero: currency off by 42',
        tick,
        severity: 'HALT',
      },
    ],
    checked: [],
    skipped: [],
  }, {
    // The input triple the halt is frozen against — the controller refuses to halt without it,
    // which is the point: a halt you cannot replay is not a diagnosis.
    tick,
    snapshot: rt.engine.snapshot().stateHash,
    actionLog: [],
    seed,
  });
  return rt;
}

const RECORD: HaltRecord = {
  tick: 1_281,
  stateHash: 'c47dccae476a0a13702e36b0c851b286cda897a5669ab251ad64f2502721b8c8',
  violations: [
    { id: 'INV-7', message: 'postings for tick did not sum to zero: currency off by 42' },
  ],
};

describe('a PAUSED world names the invariant that stopped it', () => {
  it('carries the id, the message, the tick and the hash into failures[]', () => {
    const rt = pausedWorld('halt-named');
    const report = buildHealth(rt, new SeatBook(), { halt: () => RECORD });
    expect(report.status).toBe('unhealthy');
    const failures = report.failures.join(' ');

    expect(failures, 'still says what it always said').toContain('PAUSED');
    expect(failures).toContain('signed resume');
    // The four things an operator needs and did not have.
    expect(failures, 'the invariant must be named').toContain('INV-7');
    expect(failures, 'and its message carried, not just its id').toContain('off by 42');
    expect(failures, 'the tick, so the triple can be found').toContain('1281');
    expect(failures, 'and the hash, so the replay can be checked against it').toContain(
      'c47dccae476a0a13',
    );
  });

  it('degrades to the old sentence when nothing captured the halt, rather than throwing', () => {
    // A store-less run, an older server, or a halt that happened before the capture existed. The
    // endpoint must still answer — a health check that 500s on a paused world is strictly worse
    // than one that is merely vague.
    // Written as two explicit calls rather than a loop over `[undefined, () => null]`:
    // `exactOptionalPropertyTypes` makes "absent" and "present but undefined" different types,
    // and the loop only typechecked by blurring them.
    const rt = pausedWorld('halt-unnamed');
    const noProbe = buildHealth(rt, new SeatBook(), {});
    expect(noProbe.status).toBe('unhealthy');
    expect(noProbe.failures.join(' ')).toContain('PAUSED');

    const nullProbe = buildHealth(rt, new SeatBook(), { halt: () => null });
    expect(nullProbe.status).toBe('unhealthy');
    expect(nullProbe.failures.join(' ')).toContain('PAUSED');
  });

  it('says nothing about violations while the world is RUNNING', () => {
    // The probe is read only on the PAUSED branch. A stale record leaking into a healthy report
    // would be an alarm about a halt that already ended.
    setSpeed('instant');
    const rt = new Runtime({ seed: 'halt-running' });
    rt.runTick();
    const report = buildHealth(rt, new SeatBook(), { halt: () => RECORD });
    expect(report.world).toBe('RUNNING');
    expect(report.failures.join(' ')).not.toContain('INV-7');
  });
});

describe('the deciding-share floor no longer marks a working world unhealthy', () => {
  /**
   * `health.ts`'s own comment had already worked this out — *"twelve members waking sixteen times
   * a Reckoning cannot out-count a heuristic cast that acts every tick"* — and added the
   * fallback-rate check as the real scar #14b detector. But the structural check was left wired
   * up, so `/health` served **503 continuously** for a condition the code documents as expected.
   * A permanently red check is one nobody reads, which is the same comment's other warning: scar
   * #14b winning twice, "by making the detector cry wolf until somebody silences it".
   *
   * Silenced narrowly: the condition is now a collapse to zero, which is what
   * `DECIDING_FLOOR_BPS`'s doc comment always claimed it was for.
   */
  it('a low but nonzero deciding share is reported, not failed', () => {
    setSpeed('instant');
    const rt = new Runtime({ seed: 'share-low' });
    for (let i = 0; i < 40; i += 1) rt.runTick();
    const report = buildHealth(rt, new SeatBook(), { halt: () => null });
    // The number is still published — the point is that it no longer decides liveness.
    expect(report.decisions.floor_bps).toBe(DECIDING_FLOOR_BPS);
    expect(typeof report.decisions.deciding_share_bps).toBe('number');
    expect(
      report.failures.filter((f) => f.includes('bps of decisions came from')),
      'a share below the floor must no longer be a failure on its own',
    ).toEqual([]);
  });
});
