/**
 * AGT-R5 — THE UNREACHABLE-PRIMITIVE SWEEP, as a standing check instead of a probe brief.
 *
 * `TESTING.md` §7.4 calls this "the highest-yield brief in this document", and it earned that in one
 * session. Playing the game found FOUR mechanics that were fully built in the engine and could not
 * be reached through the API:
 *
 *   - `grant` — the A6 CORE LOOP — had no affordance at all. The live frame published
 *     `authorityLines: 0` as a direct result: a core loop that had never once run through the front
 *     door, while the cast prompt told players "the safest plan is built from entries in
 *     affordances[]".
 *   - `deliver` and `vote` against the LEVY. The Charge got affordances when sovereignty landed and
 *     the Levy never did, so A14's "cannot be dodged into quiet" was being dodged by ignorance.
 *   - §7.3's `preference` order — stored on the record, honoured by `allocation.ts` as the FIRST
 *     tiebreak — never read from `create`'s params.
 *   - `form`, the syndicate subsystem's own entry point, found by the first run of this sweep.
 *
 * **The defect is created by shipping, not by neglect.** Every one of those was written by someone
 * who finished the engine work and did not close the loop to the menu. No invariant can see it: the
 * mechanic is correct, tested, and rendered. Only a reachability check notices.
 *
 * ── WHAT THIS TEST CAN AND CANNOT SEE ────────────────────────────────────────
 * It drives a real world with the heuristic cast and records every verb that appears in any
 * affordance across the run. A verb that never appears is either genuinely unreachable or needs a
 * world state this run does not produce — so the exceptions below each carry a REASON, and where the
 * reason is "needs state X" it names the test that covers it instead. An exception without a reason
 * is not allowed to exist, which is the point: the list is the review surface.
 *
 * It cannot prove a verb is reachable in EVERY state it should be. It proves the much weaker and
 * still valuable thing: no live verb is invisible everywhere.
 */

import { describe, expect, it } from 'vitest';
import { buildObservation } from '../../src/api/observe.js';
import { HeuristicCast } from '../../src/cast/index.js';
import { setSpeed } from '../../src/core/time.js';
import { Runtime } from '../../src/sim/runtime.js';

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Verbs no affordance offers in this sweep, each with why. **Adding an entry here is a decision to
 * be reviewed, not a way to make the test pass.**
 *
 * Two kinds of reason are legitimate:
 *   - REACHABLE ELSEWHERE — the verb needs a world state the heuristic run does not reach, and a
 *     named test proves it is offered when that state exists.
 *   - RESPONSE-ONLY — the verb answers something another principal started, so it is offered only
 *     while that thing is pending, and the pending state is rare in a short run.
 *
 * "We have not got round to it" is NOT a legitimate reason. A third legitimate kind, HONEST GAP,
 * exists for when that is nonetheless the truth — the list held exactly one and now holds none.
 */
const UNOFFERED: Readonly<Record<string, string>> = Object.freeze({
  abandon:
    'RESPONSE-ONLY — needs a claim you hold and want to drop; offered from the sovereignty block ' +
    'when one is STRAINED. Covered by test/sovereignty/anchored-and-territorial.spec.ts.',
  admit:
    'RESPONSE-ONLY — needs a pending application to your syndicate. Covered by ' +
    'test/syndicate/form-through-the-front-door.spec.ts.',
  apply:
    'RESPONSE-ONLY — needs a syndicate you are not in whose charter admits applications. The ' +
    'heuristic cast never forms one, so this run never produces the state.',
  approve: 'RESPONSE-ONLY — needs an open proposal in a syndicate you sit in.',
  deny: 'RESPONSE-ONLY — needs a pending application to refuse.',
  revoke:
    'RESPONSE-ONLY — needs a live grant you issued. `grant` itself is now offered (first office at ' +
    'tick 290 in test/api/legal-but-unoffered.test.ts), so this state is reachable once a cast acts ' +
    'on it.',
  trade: 'REACHABLE ELSEWHERE — needs a resting order on the local book. Covered by test/market/verb.test.ts.',
  withdraw: 'RESPONSE-ONLY — needs a syndicate membership to give notice on.',
  // `set_delivery_intent` USED TO LIVE HERE as the one HONEST GAP, and its removal is this list
  // working as designed: it is offered now, and the rot test above failed by name the moment the
  // affordance landed — before I had thought to come and delete the entry. That is the whole reason
  // the check runs in both directions. See test/api/offline-path-is-expressible.test.ts.
});

describe('AGT-R5 — every live verb is offered somewhere, or declared with a reason', () => {
  it('sweeps a real world and reconciles the offered set against the live set', () => {
    setSpeed('instant');
    const seed = 'agt-r5';
    const rt = new Runtime({ seed });
    const cast = new HeuristicCast(rt, { size: 8 });
    cast.seat(seed);

    const offered = new Set<string>();
    for (let i = 0; i < 900; i += 1) {
      const target = rt.engine.tick + 1;
      for (const a of cast.decide(target, seed)) rt.engine.submit(a);
      const r = rt.runTick();
      expect(r.halted, `halted at ${String(r.tick)}`).toBe(false);
      if (i % 5 !== 0) continue;
      for (const m of cast.roster) {
        const o = buildObservation({
          runtime: rt,
          principal: m.principal,
          serverNowMs: 0,
          fresh: true,
          wakesRemaining: 9,
          stale: false,
          corrections: [],
          actionsRemaining: 4,
        });
        for (const a of o.affordances) offered.add(a.verb);
      }
    }

    const live = [...rt.liveVerbs].sort(cmp);
    // Non-vacuity: a sweep that observed almost nothing would pass by accident.
    expect(live.length, 'the engine must have live verbs').toBeGreaterThan(20);
    expect(offered.size, 'the sweep must have seen a real menu').toBeGreaterThan(12);

    const never = live.filter((v) => !offered.has(v)).sort(cmp);
    const undeclared = never.filter((v) => UNOFFERED[v] === undefined);
    expect(
      undeclared,
      `these live verbs are offered by NO affordance and are not declared in UNOFFERED: ` +
        `${undeclared.join(', ')}. This is the defect that hid the A6 core loop: a mechanic that ` +
        `works, is tested, renders, and cannot be reached from the menu an agent is told to plan ` +
        `from. Offer it, or add it to UNOFFERED with a reason that is not "not got round to it".`,
    ).toEqual([]);
  }, 120_000);

  it('and every declared exception is still unoffered, so the list cannot rot', () => {
    // The other direction. Without this, a verb that BECOMES offered keeps its exception forever and
    // the list slowly stops describing reality — the same drift `verbs.test.ts` caught when seven
    // live verbs still claimed to be waiting on a build step.
    setSpeed('instant');
    const seed = 'agt-r5-rot';
    const rt = new Runtime({ seed });
    const cast = new HeuristicCast(rt, { size: 8 });
    cast.seat(seed);
    const offered = new Set<string>();
    for (let i = 0; i < 900; i += 1) {
      const target = rt.engine.tick + 1;
      for (const a of cast.decide(target, seed)) rt.engine.submit(a);
      expect(rt.runTick().halted).toBe(false);
      if (i % 5 !== 0) continue;
      for (const m of cast.roster) {
        const o = buildObservation({
          runtime: rt,
          principal: m.principal,
          serverNowMs: 0,
          fresh: true,
          wakesRemaining: 9,
          stale: false,
          corrections: [],
          actionsRemaining: 4,
        });
        for (const a of o.affordances) offered.add(a.verb);
      }
    }
    const stale = Object.keys(UNOFFERED).filter((v) => offered.has(v)).sort(cmp);
    expect(
      stale,
      `these verbs ARE offered now but are still listed as unoffered: ${stale.join(', ')}. ` +
        'Remove their entries — an exception list that no longer matches the engine is a rules ' +
        'surface disagreeing with it.',
    ).toEqual([]);
  }, 120_000);

  it('every declared exception carries a real reason, not a placeholder', () => {
    for (const [verb, reason] of Object.entries(UNOFFERED)) {
      expect(reason.length, `${verb}'s reason is too short to be one`).toBeGreaterThan(40);
      expect(
        reason,
        `${verb}'s reason must classify itself: RESPONSE-ONLY, REACHABLE ELSEWHERE, or HONEST GAP`,
      ).toMatch(/RESPONSE-ONLY|REACHABLE ELSEWHERE|HONEST GAP/);
    }
  });
});
