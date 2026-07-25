/**
 * Adversarial verification probes for the seal module. Written by the verifier,
 * not the builder.
 *
 * Two kinds of test here, following the house pattern in
 * `test/events/verify.probe.test.ts`:
 *
 * - **`it.fails('DEFECT(seal): …')`** — the body asserts the *correct* behaviour,
 *   so the suite stays green while the defect stands and flips to an unexpected
 *   pass the moment it is fixed. Never red forever, never silently forgotten.
 * - **plain `it`** — a *witness*: it records what the module actually does for an
 *   input the builder's suite never constructs, where the behaviour is a
 *   consequence of the design rather than a defect in it.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TICKS_PER_RECKONING } from '../../src/core/time.js';
// `SealHalt` is deliberately **not** imported here any more: after the fix there is
// no agent-reachable path to one, so a probe file whose whole subject is agent input
// has nothing to assert about it. The two remaining halt paths are engine faults and
// are held by `verdict.test.ts` and `witness.regression.test.ts`.
import {
  SealBook,
  allDeedsWitness,
  intentFaults,
  intentWorldFaults,
  sealWorldIndex,
  type Deed,
  type SealWorldIndex,
} from '../../src/seal/index.js';
import { deed, intent, pid, role, settlement } from './helpers.js';

const A = pid('P-A');
const B = pid('P-B');
const AGENT_MD = readFileSync(new URL('../../agent.md', import.meta.url), 'utf8');

/**
 * The world the fixture's seals are aimed at.
 *
 * `measureOfVerb` is deliberately silent here so the *resolver's* behaviour stays
 * reachable: with an opinion the wrong unit never gets past `commit`, which is the
 * primary fix and is asserted separately below. The probes want the floor under it.
 */
const WORLD = sealWorldIndex(['SYS-VEGA'], () => null);

/** A world with an opinion about units, which is what a wired tick loop supplies. */
const OPINIONATED: SealWorldIndex = sealWorldIndex(['SYS-VEGA'], (verb) =>
  verb === 'haul' ? 'QTY' : null,
);

/** Seal, then resolve, with everything the book needs supplied by the caller. */
function run(
  over: {
    measure?: 'MINOR' | 'QTY' | 'BPS';
    target?: string;
    version?: number;
    deeds?: readonly Deed[];
    /** `null` is the degraded, no-world-attached book on purpose. */
    world?: SealWorldIndex | null;
  } = {},
): ReturnType<SealBook['resolve']> {
  const book = new SealBook(over.world === undefined ? WORLD : over.world);
  const held = [role('V-1')];
  const accepted = book.commit({
    principal: A,
    tick: 100,
    actedOnStateVersion: over.version ?? 100,
    intent: intent({ measure: over.measure ?? 'QTY', target: over.target ?? 'SYS-VEGA' }),
    prose: '',
    role: held[0] ?? null,
    rolesHeld: held,
  });
  if (!accepted.ok) throw new Error(`commit refused: ${accepted.hint}`);
  const deeds = over.deeds ?? [deed({ principal: A, outcome: 50 })];
  return book.resolve({
    reckoningIndex: 0,
    atTick: settlement(0),
    stateVersion: 400,
    deeds,
    deedSet: allDeedsWitness(0, 400, [[A, deeds.length]]),
  });
}

describe('PROBE — an agent can halt the Reckoning with a free seal', () => {
  /**
   * FINDING, and now **FIXED** — the assertions below were flipped from recording
   * the defect to holding the fix, which is what an `it.fails` is for.
   *
   * `verdict.ts`'s header stated the precondition its A5' halt depended on: "a
   * deed's `measure` is assigned by the engine from the verb that produced it and
   * is never agent-supplied. If it ever became agent-supplied, this halt would be a
   * denial-of-settlement lever." The deed side held. **The seal side did not**:
   * `intent.measure` is agent-supplied at `commit`, and nothing anywhere mapped a
   * verb to the unit it produces, so `intentFaults` accepted `haul` in `BPS` with
   * zero faults.
   *
   * An agent therefore filed one free seal (a role it holds costs no action),
   * performed exactly the act it sealed, and `judge` threw `SealHalt` — because a
   * matching verb+target with a different `measure` was "unjudgeable" and
   * unjudgeable outranks contradiction. SPEC §15.2 aborts the tick and pauses the
   * world. One free action, repeatable every Reckoning, stopped the game, and it
   * took every other principal's seals down with it.
   *
   * `actedOnStateVersion` was the same lever by a second route: `commit` validated
   * only "non-negative safe integer", so a seal pinned at `MAX_SAFE_INTEGER` made
   * every deed that could ever honour it unjudgeable.
   *
   * The fix is in two layers, and both are asserted here. The door: the book *asks*
   * the world what unit a verb is recorded in and refuses a seal that disagrees
   * (`intentWorldFaults`), and refuses a pin ahead of the world's current version.
   * The floor: where the caller cannot answer, the seal is `DEFERRED` — no mark, no
   * charge, no outage — because *a halt is for our bug, never for their input*.
   */
  it('the shape check still does not own the unit — the world does, and it refuses', () => {
    // Unchanged and correct: `intentFaults` is a property of the intent alone, and a
    // verb→measure table inside this module would be a second home for a fact the
    // engine's deed writer owns (scar #1). What changed is that the fact is now
    // *asked for*, and a caller that can answer closes the lever at the door.
    expect(intentFaults(intent({ verb: 'haul', measure: 'MINOR' }))).toEqual([]);
    expect(intentFaults(intent({ verb: 'haul', measure: 'BPS' }))).toEqual([]);

    expect(intentWorldFaults(intent({ verb: 'haul', measure: 'QTY' }), OPINIONATED)).toEqual([]);
    expect(intentWorldFaults(intent({ verb: 'haul', measure: 'BPS' }), OPINIONATED).length).toBe(1);
  });

  it('an agent that seals its own verb in the wrong unit and then performs it cannot halt the world', () => {
    expect(() =>
      run({ measure: 'MINOR', deeds: [deed({ principal: A, outcome: 50 })] }),
    ).not.toThrow();
    const r = run({ measure: 'MINOR', deeds: [deed({ principal: A, outcome: 50 })] });
    expect(r.deferred.map((d) => d.basis)).toEqual(['MEASURE_DISAGREEMENT']);
    expect(r.charges).toEqual([]);
  });

  it('a seal pinned at an unreachable actedOnStateVersion cannot halt the world', () => {
    expect(() =>
      run({ version: Number.MAX_SAFE_INTEGER, deeds: [deed({ principal: A, outcome: 50 })] }),
    ).not.toThrow();
    // And it buys nothing: an impossible pin is disregarded, not honoured as a filter.
    expect(
      run({ version: Number.MAX_SAFE_INTEGER, deeds: [deed({ principal: A, outcome: 50 })] })
        .verdicts[0]?.verdict,
    ).toBe('HONOURED');
  });

  it('and the blast radius is now the one bad seal, not the whole Reckoning', () => {
    // The witness that recorded the defect, inverted. `resolve` still fails closed as
    // a batch (DET-10) — for *engine* faults. One agent's unaccountable field is no
    // longer one of them, so it no longer becomes every agent's outage.
    const book = new SealBook(WORLD);
    for (const [p, measure] of [
      [A, 'MINOR'],
      [B, 'QTY'],
    ] as const) {
      const held = [role(`V-${p}`)];
      const ok = book.commit({
        principal: p,
        tick: 100,
        actedOnStateVersion: 100,
        intent: intent({ measure }),
        prose: '',
        role: held[0] ?? null,
        rolesHeld: held,
      });
      expect(ok.ok).toBe(true);
    }
    const deeds = [deed({ principal: A, outcome: 50 }), deed({ principal: B, outcome: 50 })];
    const r = book.resolve({
      reckoningIndex: 0,
      atTick: settlement(0),
      stateVersion: 400,
      deeds,
      deedSet: allDeedsWitness(0, 400, [
        [A, 1],
        [B, 1],
      ]),
    });
    // B's perfectly good seal is published; A's is closed with no mark.
    expect(r.verdicts.map((v) => v.principal)).toEqual([B]);
    expect(r.deferred.map((d) => d.principal)).toEqual([A]);
  });
});

describe('PROBE — a target the engine never spells the same way is a silent permanent mark', () => {
  /**
   * FINDING, and now **FIXED**. The asymmetry was the point: a *unit* disagreement
   * halted the tick to avoid libelling an honest agent — `verdict.ts` argued that at
   * length — while a *target-string* disagreement, the same class of engine-vs-agent
   * mismatch and the one an LLM is far likelier to make, published the permanent mark
   * instead. `namesTheSameAct` compares with `===` and `target` was validated for
   * length only, so `sys-vega` versus `SYS-VEGA` was a guaranteed CONTRADICTED plus a
   * standing charge for an agent that did exactly what it meant.
   *
   * Both halves now answer to one rule: **the mismatch fails at sealing, where it is
   * recoverable and private, never at judgement, where it is permanent and public**
   * (scar #8). `===` at judgement is left exactly as it was — it is *correct* once the
   * seal is known to carry the world's own spelling, and loosening it would be a
   * fabricated HONOURED on any pair of ids that differ only by case.
   */
  it('a case difference in `target` is refused at commit, not marked at settlement', () => {
    // The shape check still has nothing to say — the world does.
    expect(intentFaults(intent({ target: 'sys-vega' }))).toEqual([]);

    const book = new SealBook(WORLD);
    const held = [role('V-1')];
    const refused = book.commit({
      principal: A,
      tick: 100,
      actedOnStateVersion: 100,
      intent: intent({ target: 'sys-vega' }),
      prose: '',
      role: held[0] ?? null,
      rolesHeld: held,
    });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.hint).toContain('SYS-VEGA');
    expect(book.size).toBe(0);
  });

  it('so is a target that names nothing in the world at all', () => {
    const book = new SealBook(WORLD);
    const held = [role('V-1')];
    const refused = book.commit({
      principal: A,
      tick: 100,
      actedOnStateVersion: 100,
      intent: intent({ target: 'no-such-place' }),
      prose: '',
      role: held[0] ?? null,
      rolesHeld: held,
    });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.hint).toContain('names nothing');
  });

  it('and a book with no world attached refuses to make the mark at all', () => {
    // The floor under the door: a book that cannot witness a target cannot tell a
    // misspelling from an abstention, so it publishes neither.
    const r = run({
      target: 'sys-vega',
      world: null,
      deeds: [deed({ principal: A, outcome: 50 })],
    });
    expect(r.verdicts).toEqual([]);
    expect(r.charges).toEqual([]);
    expect(r.deferred.map((d) => d.basis)).toEqual(['UNWITNESSED_TARGET']);
  });
});

describe('PROBE — a caller that under-supplies deeds fabricates contradictions', () => {
  /**
   * FINDING. `resolve` judges every seal in the Reckoning against whatever deeds
   * it was handed, and there is no completeness witness — no deed-set version, no
   * count, no "these are all of this Reckoning's deeds" claim. So "the agent
   * abstained" and "the caller's query missed this principal" are the *same input*,
   * and the second produces a permanent public CONTRADICTED plus a standing charge
   * with no invariant firing anywhere. That is §15.4's false-default shape applied
   * to the other permanent mark this design can make, and it is the one A5' failure
   * mode the module does not defend against — while spending a whole halt path on
   * the unit mismatch, which is strictly less likely.
   */
  it('resolve refuses to mark a principal an incomplete deed set never covered', () => {
    const book = new SealBook(WORLD);
    for (const p of [A, B]) {
      const held = [role(`V-${p}`)];
      const ok = book.commit({
        principal: p,
        tick: 100,
        actedOnStateVersion: 100,
        intent: intent(),
        prose: '',
        role: held[0] ?? null,
        rolesHeld: held,
      });
      expect(ok.ok).toBe(true);
    }
    // Both principals hauled 50. Only A's deed reached the resolver, and the witness
    // says which principals it is complete for. B is no longer marked or charged.
    const deeds = [deed({ principal: A, outcome: 50 })];
    const r = book.resolve({
      reckoningIndex: 0,
      atTick: settlement(0),
      stateVersion: 400,
      deeds,
      deedSet: allDeedsWitness(0, 400, [[A, 1]]),
    });
    expect(r.charges).toEqual([]);
    expect(r.deferred.map((d) => [d.principal, d.basis])).toEqual([[B, 'UNWITNESSED_DEED_SET']]);
  });

  it('a deed that lands one tick past the Reckoning boundary is a contradiction', () => {
    // A witness, not a defect: §11.1 scopes a seal to `(prev_reckoning,
    // this_reckoning]` on purpose. Recorded because it is the contradiction an
    // honest agent cannot avoid — a haul dispatched inside the window that arrives
    // just outside it reads exactly like a broken promise, and `agent.md` does not
    // warn about it. The deed set is witnessed, so the mark is the engine's real
    // answer and not an artifact of a query that missed something.
    const book = new SealBook(WORLD);
    const held = [role('V-1')];
    const ok = book.commit({
      principal: A,
      tick: TICKS_PER_RECKONING - 3,
      actedOnStateVersion: 100,
      intent: intent(),
      prose: '',
      role: held[0] ?? null,
      rolesHeld: held,
    });
    expect(ok.ok).toBe(true);
    const deeds = [
      deed({
        principal: A,
        tick: TICKS_PER_RECKONING + 1,
        outcome: 50,
        valuedAtStateVersion: TICKS_PER_RECKONING + 1,
      }),
    ];
    const r = book.resolve({
      reckoningIndex: 0,
      atTick: settlement(0),
      stateVersion: TICKS_PER_RECKONING + 10,
      deeds,
      // A wrote **no** deed inside Reckoning 0 — the haul landed a tick past the
      // boundary — and the tally says so, which is what makes this a witnessed
      // abstention rather than a query that lost the row.
      deedSet: allDeedsWitness(0, TICKS_PER_RECKONING + 10, [[A, 0]]),
    });
    expect(r.verdicts[0]?.verdict).toBe('CONTRADICTED');
  });
});

describe('PROBE — the agent.md seal section, pinned (scar #1)', () => {
  /**
   * Two outright contradictions were found in `agent.md` and fixed by the
   * verifier; these pins stop them coming back.
   *
   * 1. line 302 said "Before a deadline you **may** `seal`" while SPEC §11.1 says
   *    "Seals are **mandatory** and free" and `SealBook.sealComplianceRejection`
   *    refuses the act without one.
   * 2. line 306 said "Viewers see the content." — unqualified — while §11.2 gives
   *    viewers "the flag on the night and the content in the season documentary",
   *    and `agent.md`'s own tier table twenty lines above says "sealed | nobody |
   *    in the season replay". A player believing content leaks nightly will
   *    perform for the seal or monitor a cartel with it, which is AGT-X4.
   */
  it('does not tell the player viewers see seal content on the night', () => {
    expect(AGENT_MD).not.toContain('Viewers see the content.');
    expect(AGENT_MD).toContain('Viewers see the flag on the night and the content only in the season replay');
  });

  it('states that sealing is required and that one seal per role held is free', () => {
    expect(AGENT_MD).toContain('Sealing is required for every role you hold');
    expect(AGENT_MD).toContain('One seal per role you hold is free');
    expect(AGENT_MD).toContain('before the freeze');
  });

  it('states the magnitude of the mark and the timestamp rule (A2, A5-prime)', () => {
    // An agent must be able to price a seal before making it, and must know that a
    // deed at or before the seal does not honour it — otherwise the engine's
    // rule 3 marks it for something it did.
    expect(AGENT_MD).toContain('adds 1 to your public contradicted-seals count');
    expect(AGENT_MD).toContain('judged only against deeds that happen **after** you seal it');
  });
});
