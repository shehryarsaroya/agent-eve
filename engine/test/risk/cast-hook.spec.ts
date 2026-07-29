/**
 * ★ THE CAST HOOK, as a named list of calls — and the reason it is a list rather than a branch.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * `src/cast/heuristic.ts` is owned by another agent this round, so this file does what
 * `test/campaign/reachable.spec.ts` did in the same position: **it proves the exact call sequence a
 * cast branch would make, so writing the branch is a transcription rather than a design.**
 *
 * That matters because of the fourteenth instance of this project's defining defect: `join` had a
 * handler, an affordance, a party row, a stake asymmetry, a force term, two constants and a paragraph
 * in `agent.md`, and **nothing in `src/` ever called it**. A mechanic nothing selects is
 * indistinguishable from one that does not exist. So the sequence below runs, end to end, against a
 * real `Runtime` — and every call in it is copied verbatim into the report.
 *
 * ## THE SEQUENCE — six calls, three principals
 *
 * ```
 *  # who        when                          call
 *  1 a payer    a FRONT is in FORECAST        publish_offer {kind:"COVER", system, good, limit, premium, elective_bps}
 *  2 a payee    it holds `good` at `system`   sign          {cover, terms_hash}
 *  3 a reinsurer  step 1's cover is BOUND     publish_offer {kind:"COVER", over: <cover>, limit, premium, elective_bps}
 *  4 the payer  step 3's cession is OFFERED   sign          {cover: <cession>, terms_hash}
 *  5 the payer  the FRONT has STRUCK          elect         {cover, election:"IN_FULL"}
 *  6 the reinsurer  same                      elect         {cover: <cession>, election:"IN_FULL"}  — or silence
 * ```
 *
 * ## THE FOUR GATES a branch has to satisfy, in the order they bite
 *
 * Named because the coalition wave's lesson was that *"it was not one missing branch — it was four
 * gates that could not be satisfied, and each was invisible from the one above it."*
 *
 *   1. **A live FRONT in `FORECAST`.** `risk.fronts[]` with `coverOpen: true`. Announced every third
 *      RECKONING, two Reckonings ahead, and shut 48 ticks before landfall.
 *   2. **`freeCash > 0` for the payer, and for the payee too.** Both sides are priced in earned
 *      capital, not in the starter stake (A15, D7). **This is the gate a production cast is most
 *      likely to fail**, and `scripts/risk-probe.ts` measures how often.
 *   3. **The payee is HOLDING the named good at the named system**, and no other live COVER stands
 *      over that `(system, good)` (RSK1, CAT6).
 *   4. **For step 6 to matter, the cession's ESCROWED half must be smaller than the primary's
 *      ELECTIVE half.** Otherwise the certain money makes the primary whole and there is no decision
 *      to propagate — see `propagates.spec.ts`, which got this wrong once and says so.
 * ══════════════════════════════════════════════════════════════════════════════
 */

import { describe, expect, it } from 'vitest';
import { LEVY_GOOD } from '../../src/levy/index.js';
import { COVER_ELECTIVE_BPS_CEILING, riskSubjects } from '../../src/risk/index.js';
import {
  FIRST_ANNOUNCE_TICK,
  FIRST_LANDFALL_TICK,
  act,
  fund,
  riskWorld,
  runTo,
  stockAt,
  tick,
} from './fixture.js';

describe('the cast hook — six calls, run rather than described', () => {
  it('drives the whole chain through the real verb table and leaves a settled cohort', () => {
    const world = riskWorld('cast-hook', 7, 'MARCHES');
    const { runtime, principals } = world;
    const [payee, payer, reinsurer, bankA, bankB, bankC] = principals;
    if (
      payee === undefined ||
      payer === undefined ||
      reinsurer === undefined ||
      bankA === undefined ||
      bankB === undefined ||
      bankC === undefined
    ) {
      throw new Error('the fixture seats seven principals');
    }

    // ── GATE 2, satisfied the way a real principal satisfies it: money it received. ──
    fund(runtime, bankA, payer, 200_000);
    fund(runtime, bankB, reinsurer, 200_000);
    fund(runtime, bankC, payee, 200_000);

    // ── GATE 1 ────────────────────────────────────────────────────────────────
    runTo(runtime, FIRST_ANNOUNCE_TICK);
    const front = runtime.risk.allFronts()[0];
    expect(front, 'GATE 1: a FRONT is in FORECAST').toBeDefined();
    if (front === undefined) throw new Error('unreachable');
    const cell = [...front.swath].sort((a, b) => b.intensityBps - a.intensityBps)[0];
    if (cell === undefined) throw new Error('unreachable');

    // ── GATE 3 ────────────────────────────────────────────────────────────────
    stockAt(runtime, payee, cell.system, 400_000, LEVY_GOOD);

    // ── CALL 1 ────────────────────────────────────────────────────────────────
    const c1 = act(runtime, payer, 'publish_offer', {
      kind: 'COVER',
      system: cell.system,
      good: LEVY_GOOD,
      limit: 60_000,
      premium: 1_000,
      elective_bps: COVER_ELECTIVE_BPS_CEILING,
    });
    expect(c1, `call 1 refused: ${c1?.hint ?? ''}`).toBeNull();
    const cover = runtime.risk.coversBy(payer)[0];
    if (cover === undefined) throw new Error('unreachable');

    // ── CALL 2 ────────────────────────────────────────────────────────────────
    const c2 = act(runtime, payee, 'sign', { cover: cover.id, terms_hash: cover.termsHash ?? '' });
    expect(c2, `call 2 refused: ${c2?.hint ?? ''}`).toBeNull();

    // ── CALL 3 — GATE 4: a PARTIAL cession, a sixth of the primary's limit. ────
    const c3 = act(runtime, reinsurer, 'publish_offer', {
      kind: 'COVER',
      over: cover.id,
      limit: 10_000,
      premium: 800,
      elective_bps: COVER_ELECTIVE_BPS_CEILING,
    });
    expect(c3, `call 3 refused: ${c3?.hint ?? ''}`).toBeNull();
    const cession = runtime.risk.coversBy(reinsurer)[0];
    if (cession === undefined) throw new Error('unreachable');

    // ── CALL 4 ────────────────────────────────────────────────────────────────
    const c4 = act(runtime, payer, 'sign', { cover: cession.id, terms_hash: cession.termsHash ?? '' });
    expect(c4, `call 4 refused: ${c4?.hint ?? ''}`).toBeNull();

    const before = riskSubjects(runtime.risk);
    expect(before.boundCovers, 'two layers bound').toBe(2);
    expect(before.cessions, 'one of them a cession').toBe(1);

    // ── The FRONT lands. Nobody chose this. ───────────────────────────────────
    runTo(runtime, FIRST_LANDFALL_TICK);
    tick(runtime);
    expect(runtime.risk.allIndemnities().length, 'a cohort of two opened off one event').toBe(2);

    // ── CALL 5 ────────────────────────────────────────────────────────────────
    const c5 = act(runtime, payer, 'elect', { cover: cover.id, election: 'IN_FULL' });
    expect(c5, `call 5 refused: ${c5?.hint ?? ''}`).toBeNull();

    // ── CALL 6 ────────────────────────────────────────────────────────────────
    const c6 = act(runtime, reinsurer, 'elect', { cover: cession.id, election: 'IN_FULL' });
    expect(c6, `call 6 refused: ${c6?.hint ?? ''}`).toBeNull();

    // ── The Reckoning settles it. ─────────────────────────────────────────────
    runTo(runtime, 3 * 288 + 287);
    const after = runtime.risk.allIndemnities();
    for (const ind of after) {
      // MUTATION: delete the `riskCohortNow` call from the OBLIGE handler. Every row stays `OPEN`,
      // the world stays green, and every promise in it is silently discharged by nothing — which is
      // `haul.landed`'s bug in the settlement path.
      expect(
        ind.state,
        `indemnity ${ind.id} is still ${ind.state}; the cohort must reach a terminal state`,
      ).not.toBe('OPEN');
    }
    expect(
      after.filter((i) => i.state === 'PAID').length,
      'both payers elected IN_FULL and both had the money, so both promises were kept',
    ).toBe(2);
    // RSK7's record moved for both, which is the instrument that makes the mechanism countable.
    expect(runtime.risk.record(payer).honoured, 'the payer’s record names the kept promise').toBe(1);
    expect(runtime.risk.record(reinsurer).honoured).toBe(1);
    expect(runtime.risk.isUnseasoned(payer), 'and it is no longer UNSEASONED').toBe(false);
  });
});
