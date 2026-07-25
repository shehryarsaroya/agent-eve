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
import { SealBook, SealHalt, intentFaults, type Deed } from '../../src/seal/index.js';
import { deed, intent, pid, role, settlement } from './helpers.js';

const A = pid('P-A');
const B = pid('P-B');
const AGENT_MD = readFileSync(new URL('../../agent.md', import.meta.url), 'utf8');

/** Seal, then resolve, with everything the book needs supplied by the caller. */
function run(
  over: {
    measure?: 'MINOR' | 'QTY' | 'BPS';
    target?: string;
    version?: number;
    deeds?: readonly Deed[];
  } = {},
): ReturnType<SealBook['resolve']> {
  const book = new SealBook();
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
  return book.resolve({
    reckoningIndex: 0,
    atTick: settlement(0),
    stateVersion: 400,
    deeds: over.deeds ?? [deed({ principal: A, outcome: 50 })],
  });
}

describe('PROBE — an agent can halt the Reckoning with a free seal', () => {
  /**
   * FINDING. `verdict.ts`'s header states the precondition its A5' halt depends
   * on: "a deed's `measure` is assigned by the engine from the verb that produced
   * it and is never agent-supplied. If it ever became agent-supplied, this halt
   * would be a denial-of-settlement lever." The deed side holds. **The seal side
   * does not**: `intent.measure` is agent-supplied at `commit`, and nothing
   * anywhere maps a verb to the unit it produces, so `intentFaults` accepts
   * `haul` in `BPS` with zero faults.
   *
   * An agent therefore files one free seal (a role it holds costs no action),
   * performs exactly the act it sealed, and `judge` throws `SealHalt` — because a
   * matching verb+target with a different `measure` is "unjudgeable" and
   * unjudgeable outranks contradiction. SPEC §15.2 aborts the tick and pauses the
   * world. One free action, repeatable every Reckoning, stops the game, and it
   * takes every other principal's seals down with it.
   *
   * `actedOnStateVersion` is the same lever by a second route: `commit` validates
   * only "non-negative safe integer", so a seal pinned at `MAX_SAFE_INTEGER` makes
   * every deed that could ever honour it unjudgeable.
   */
  it('nothing ties the seal’s `measure` to the verb, so a mismatch is committable', () => {
    expect(intentFaults(intent({ verb: 'haul', measure: 'MINOR' }))).toEqual([]);
    expect(intentFaults(intent({ verb: 'haul', measure: 'BPS' }))).toEqual([]);
  });

  it.fails(
    'DEFECT(seal/verdict): an agent that seals its own verb in the wrong unit and then performs it halts the world',
    () => {
      // The correct behaviour is either a rejection at `commit` (there is no verb ->
      // measure table to reject against) or a verdict. Not a halt an agent chose.
      expect(() => run({ measure: 'MINOR', deeds: [deed({ principal: A, outcome: 50 })] })).not.toThrow();
    },
  );

  it.fails(
    'DEFECT(seal/book): a seal pinned at an unreachable actedOnStateVersion halts the world',
    () => {
      expect(() =>
        run({ version: Number.MAX_SAFE_INTEGER, deeds: [deed({ principal: A, outcome: 50 })] }),
      ).not.toThrow();
    },
  );

  it('and the blast radius is the whole Reckoning, not the one bad seal', () => {
    // A witness rather than a `it.fails`: this is `resolve`'s documented
    // fail-closed batch semantics (DET-10). It is recorded because it is what
    // turns one agent's malformed seal into every agent's outage.
    const book = new SealBook();
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
    expect(() =>
      book.resolve({
        reckoningIndex: 0,
        atTick: settlement(0),
        stateVersion: 400,
        deeds: [deed({ principal: A, outcome: 50 }), deed({ principal: B, outcome: 50 })],
      }),
    ).toThrow(SealHalt);
    // Nothing was published, including B's perfectly good seal.
    for (const rec of book.auditRecords()) expect(rec.verdict).toBeNull();
  });
});

describe('PROBE — a target the engine never spells the same way is a silent permanent mark', () => {
  /**
   * FINDING, the asymmetry. A *unit* disagreement between agent and engine halts
   * the tick to avoid libelling an honest agent — `verdict.ts` argues that at
   * length. A *target-string* disagreement is the same class of engine-vs-agent
   * mismatch, and the one an LLM is far likelier to make, and it publishes the
   * permanent mark instead: `namesTheSameAct` compares with `===` and `target` is
   * validated for length only. Nothing checks the target names a real system, hand,
   * holding, principal or venture, and nothing normalises case, so `sys-vega`
   * versus `SYS-VEGA` is a guaranteed CONTRADICTED plus a standing charge for an
   * agent that did exactly what it meant.
   */
  it('a case difference in `target` is CONTRADICTED, not a halt and not a rejection', () => {
    expect(intentFaults(intent({ target: 'sys-vega' }))).toEqual([]);
    const r = run({ target: 'sys-vega', deeds: [deed({ principal: A, outcome: 50 })] });
    expect(r.verdicts[0]?.verdict).toBe('CONTRADICTED');
    expect(r.charges.length).toBe(1);
  });

  it('so is a target that names nothing in the world at all', () => {
    const r = run({ target: 'no-such-place', deeds: [deed({ principal: A, outcome: 50 })] });
    expect(r.verdicts[0]?.verdict).toBe('CONTRADICTED');
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
  it.fails(
    'DEFECT(seal/book): resolve accepts an incomplete deed set and marks the missing principal',
    () => {
      const book = new SealBook();
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
      // Both principals hauled 50. Only A's deed reached the resolver. The correct
      // behaviour is to refuse to judge from an unwitnessed deed set; today B is
      // marked CONTRADICTED and charged.
      const r = book.resolve({
        reckoningIndex: 0,
        atTick: settlement(0),
        stateVersion: 400,
        deeds: [deed({ principal: A, outcome: 50 })],
      });
      expect(r.charges).toEqual([]);
    },
  );

  it('a deed that lands one tick past the Reckoning boundary is a contradiction', () => {
    // A witness, not a defect: §11.1 scopes a seal to `(prev_reckoning,
    // this_reckoning]` on purpose. Recorded because it is the contradiction an
    // honest agent cannot avoid — a haul dispatched inside the window that arrives
    // just outside it reads exactly like a broken promise, and `agent.md` does not
    // warn about it.
    const book = new SealBook();
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
    const r = book.resolve({
      reckoningIndex: 0,
      atTick: settlement(0),
      stateVersion: TICKS_PER_RECKONING + 10,
      deeds: [
        deed({
          principal: A,
          tick: TICKS_PER_RECKONING + 1,
          outcome: 50,
          valuedAtStateVersion: TICKS_PER_RECKONING + 1,
        }),
      ],
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
