/**
 * The three verified defects, as regressions. **Written before the fix**, each one
 * red against the module as it stood.
 *
 * All three are one root cause: *the module treated a disagreeing or unwitnessed
 * input as either an impossibility (halt the world) or a certainty (publish a
 * permanent public mark).* Both readings are wrong. An input the engine cannot
 * account for is **data**, and the only answer A5′ permits is to make no mark —
 * §15.3's rule that an unresolved obligation DEFERS and never defaults, applied to
 * the other permanent mark this design can make.
 *
 * - **AGT-X9 / E2E-13, the P0.** `judge` threw `SealHalt` when a deed named the
 *   sealed verb and target but disagreed about `measure`, or carried
 *   `valuedAtStateVersion < seal.actedOnStateVersion`. `verdict.ts` stated the
 *   precondition it relied on — that `measure` is engine-assigned and never
 *   agent-supplied — and only the deed half held: `intent.measure` is agent-supplied
 *   at `commit`. One free seal in the wrong unit plus the act it named halted the
 *   settlement tick, and took every other principal's seals down with it.
 * - **A5′ on the seal mark, route 1.** `resolve` judged every seal against whatever
 *   `deeds` array the caller passed, with no completeness witness, so "the agent
 *   abstained" and "the caller's query missed this principal" were the same input.
 * - **A5′ on the seal mark, route 2.** `target` was validated for length only and
 *   compared with `===`, so `sys-vega` versus `SYS-VEGA` was a guaranteed permanent
 *   public mark on an agent that did exactly what it meant.
 *
 * ## The second pass, and why route 1 needed fixing twice
 *
 * The first fix for route 1 added a completeness witness whose `deedCount` was a
 * single total — and shipped a helper that filled it in with `deeds.length`. So
 * `resolve`'s comparison was a tautology for every caller following the documented
 * instructions, and a re-verifier reproduced the original false mark verbatim. *A
 * count derived from the thing it is meant to witness is not a witness.*
 *
 * The count is now **per principal**, comes from whatever wrote the deed rows, and
 * `allDeedsWitness` no longer receives the deeds at all — so the tautology is not
 * constructible through the exported helper, and `tsc` refuses the old call shape.
 * The same pass removed the halt the first fix had added on a deed from an untallied
 * principal: a principal owes a seal only for the roles it holds, so an agent that
 * hauls while holding none could stop the settlement tick for everyone (AGT-X9 again,
 * by a new road). Both are regressions here, and both are mutation-verified.
 */

import { describe, expect, it } from 'vitest';
import { compareIds } from '../../src/ledger/order.js';
import {
  ALL_DEEDS_CLAIM,
  SEAL_DISCLOSURE_KEYS,
  SealBook,
  SealDisclosureError,
  SealHalt,
  agentSealDisclosure,
  allDeedsWitness,
  checkInv20,
  judge,
  sealProjectionLeaks,
  sealVerdictEvent,
  sealWorldIndex,
  type Deed,
  type SealMeasure,
  type SealWorldIndex,
  type VerdictInputs,
} from '../../src/seal/index.js';
import { deed, eid, intent, pid, role, settlement } from './helpers.js';

const A = pid('P-A');
const B = pid('P-B');
/** A third principal, so a tally's order is distinguishable from its reverse. */
const C = pid('P-C');
const AT_TICK = settlement(0);

/** The world the vertical slice actually has: two systems and one hauling verb. */
function world(ids: readonly string[] = ['sys-vega', 'sys-lyra']): SealWorldIndex {
  return sealWorldIndex(ids, (verb) => (verb === 'haul' ? 'QTY' : null));
}

/**
 * A world that knows the fixture's target but has **no opinion** about units.
 *
 * `measureOfVerb` returning null is the honest answer from a caller that cannot say,
 * and it is what makes the measure-disagreement path below reachable at all: with an
 * opinion, the seal is refused at the door, which is the better fix and is tested
 * separately. This is the floor under it.
 */
const NO_MEASURE_OPINION = sealWorldIndex(['SYS-VEGA'], () => null);

function inputs(over: Partial<VerdictInputs> = {}): VerdictInputs {
  return {
    principal: A,
    reckoningIndex: 0,
    sealedAtTick: 100,
    actedOnStateVersion: 100,
    intent: intent(),
    deedSetWitnessed: true,
    targetWitnessed: true,
    ...over,
  };
}

/** Seal once, then resolve — everything the book needs supplied by the caller. */
function run(over: {
  measure?: SealMeasure;
  target?: string;
  version?: number;
  deeds?: readonly Deed[];
  witnessed?: boolean;
  /**
   * How many deeds the *producer* says A wrote this Reckoning.
   *
   * Defaults to the fixture's own array length, which is legitimate **here and only
   * here**: a fixture is both producer and query, so deriving it states "the two
   * agree", which is the healthy case. A production caller must never do this — see
   * `DeedTally` — and the fixtures that model a query bug state the number.
   */
  recorded?: number;
  /** `null` puts the book in the degraded, no-world-attached mode on purpose. */
  world?: SealWorldIndex | null;
}): ReturnType<SealBook['resolve']> {
  const book = new SealBook(over.world === undefined ? NO_MEASURE_OPINION : over.world);
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
    atTick: AT_TICK,
    stateVersion: 400,
    deeds,
    ...(over.witnessed === false
      ? {}
      : { deedSet: allDeedsWitness(0, 400, [[A, over.recorded ?? deeds.length]]) }),
  });
}

// ── The P0 ───────────────────────────────────────────────────────────────────

describe('AGT-X9 — no agent-reachable input may halt the world', () => {
  it('a measure disagreement DEFERS instead of halting or libelling', () => {
    const j = judge(inputs(), [deed({ measure: 'MINOR', outcome: 50 })], AT_TICK);
    expect(j.disposition).toBe('UNMARKED');
    expect(j.verdict).toBeNull();
    expect(j.basis).toBe('MEASURE_DISAGREEMENT');
    // The deed is still cited, so the audit can point at what could not be judged.
    expect(j.citedDeedEventId).toBe('ev:150:0');
  });

  it('a measurement older than the seal’s pin DEFERS instead of halting', () => {
    const j = judge(
      inputs({ actedOnStateVersion: 100 }),
      [deed({ valuedAtStateVersion: 99 })],
      AT_TICK,
    );
    expect(j.disposition).toBe('UNMARKED');
    expect(j.verdict).toBeNull();
    expect(j.basis).toBe('STALE_MEASUREMENT');
  });

  it('an agent that seals its own verb in the wrong unit cannot stop the Reckoning', () => {
    // The attack: one free seal citing a role held, then exactly the act sealed.
    expect(() => run({ measure: 'MINOR' })).not.toThrow();
    const r = run({ measure: 'MINOR' });
    expect(r.verdicts).toEqual([]);
    expect(r.charges).toEqual([]);
    expect(r.deferred.length).toBe(1);
    expect(r.deferred[0]?.basis).toBe('MEASURE_DISAGREEMENT');
  });

  it('a seal pinned at an unreachable state version cannot stop the Reckoning', () => {
    expect(() => run({ version: Number.MAX_SAFE_INTEGER })).not.toThrow();
  });

  it('and an impossible pin buys the agent nothing — the seal is judged anyway', () => {
    // If an impossible pin DEFERRED, every seal could be made weightless for free,
    // which deletes the reveal the design's only guaranteed clip generator needs.
    const r = run({ version: Number.MAX_SAFE_INTEGER });
    expect(r.verdicts[0]?.verdict).toBe('HONOURED');
    expect(r.deferred).toEqual([]);
  });

  it('one principal’s malformed seal no longer takes the whole Reckoning down', () => {
    // The blast radius the probe recorded: `resolve` threw out of its loop, so every
    // other principal's seal went unjudged with it.
    const book = new SealBook(NO_MEASURE_OPINION);
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
      expect(ok.ok, JSON.stringify(ok)).toBe(true);
    }
    const deeds = [deed({ principal: A, outcome: 50 }), deed({ principal: B, outcome: 50 })];
    const r = book.resolve({
      reckoningIndex: 0,
      atTick: AT_TICK,
      stateVersion: 400,
      deeds,
      deedSet: allDeedsWitness(0, 400, [
        [A, 1],
        [B, 1],
      ]),
    });
    // B's perfectly good seal is published.
    expect(r.verdicts.map((v) => [v.principal, v.verdict])).toEqual([[B, 'HONOURED']]);
    expect(r.deferred.map((d) => d.principal)).toEqual([A]);
  });

  it('the commit door refuses the wrong unit outright when the world can say (A5′)', () => {
    // The root cause: nothing tied a seal's `measure` to the verb. The measure of a
    // deed is a fact about how the engine records that verb, so the book *asks* —
    // it does not keep a second copy of the answer (scar #1).
    const book = new SealBook(world());
    const held = [role('V-1')];
    const refused = book.commit({
      principal: A,
      tick: 100,
      actedOnStateVersion: 100,
      intent: intent({ measure: 'BPS', target: 'sys-vega' }),
      prose: '',
      role: held[0] ?? null,
      rolesHeld: held,
    });
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.hint).toContain('QTY');
      expect(refused.hint).toContain('BPS');
    }
    expect(book.size).toBe(0);
  });

  it('a caller bug still halts — a halt is for our bug, never for their input', () => {
    // The distinction the fix turns on. A foreign deed and a malformed deed are the
    // engine's own defects; they must never become an agent's public mark.
    expect(() => judge(inputs(), [deed({ principal: B, outcome: 50 })], AT_TICK)).toThrow(SealHalt);
    expect(() => judge(inputs(), [deed({ outcome: 1.5 })], AT_TICK)).toThrow(SealHalt);
  });
});

// ── A5′, route 1: the completeness witness ───────────────────────────────────

describe('A5′ — an unwitnessed deed set may not publish a mark', () => {
  it('an incomplete deed set does not mark the principal it missed', () => {
    const book = new SealBook(NO_MEASURE_OPINION);
    for (const p of [A, B]) {
      const held = [role(`V-${p}`)];
      expect(
        book.commit({
          principal: p,
          tick: 100,
          actedOnStateVersion: 100,
          intent: intent(),
          prose: '',
          role: held[0] ?? null,
          rolesHeld: held,
        }).ok,
      ).toBe(true);
    }
    // Both principals hauled 50. Only A's deed reached the resolver, and the witness
    // says so: it tallies A alone.
    const deeds = [deed({ principal: A, outcome: 50 })];
    const r = book.resolve({
      reckoningIndex: 0,
      atTick: AT_TICK,
      stateVersion: 400,
      deeds,
      deedSet: allDeedsWitness(0, 400, [[A, 1]]),
    });
    expect(r.charges).toEqual([]);
    expect(r.verdicts.map((v) => v.principal)).toEqual([A]);
    expect(r.deferred.map((d) => [d.principal, d.basis])).toEqual([[B, 'UNWITNESSED_DEED_SET']]);
  });

  /**
   * **The first fix did not fix this.** The re-verifier reproduced the original
   * defect verbatim, under the fix's own documented construction: the witness carried
   * one total `deedCount` and the exported helper filled it in from `deeds.length`, so
   * the resolver's comparison was a tautology. A query that lost B's row still marked
   * B — a §15.4 false mark on an innocent agent, which is the worst thing this engine
   * can do.
   *
   * The difference now is that the count is **per principal and independently
   * sourced**: the producer wrote one deed for B, one row arrived for A and none for
   * B, so the tally and the rows disagree about B and B's seal defers.
   */
  it('a tally that lost a row defers the principal it dropped, and never marks it', () => {
    const book = new SealBook(NO_MEASURE_OPINION);
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
      expect(ok.ok, JSON.stringify(ok)).toBe(true);
    }
    // Both hauled 50, in band, and the producer counted both. The query lost B's row.
    const gathered = [deed({ principal: A, outcome: 50 })];
    const r = book.resolve({
      reckoningIndex: 0,
      atTick: AT_TICK,
      stateVersion: 400,
      deeds: gathered,
      deedSet: allDeedsWitness(0, 400, [
        [A, 1],
        [B, 1],
      ]),
    });
    expect(r.charges).toEqual([]);
    expect(r.verdicts.map((v) => [v.principal, v.verdict])).toEqual([[A, 'HONOURED']]);
    expect(r.deferred.map((d) => [d.principal, d.basis])).toEqual([[B, 'UNWITNESSED_DEED_SET']]);
    // And it is loud: the operator is told which principal did not add up.
    expect(r.deedSetFaults.length).toBe(1);
    expect(r.deedSetFaults[0]).toContain(B);
    expect(r.deedSetFaults[0]).toContain('lost a row');
  });

  it('the helper cannot be handed the deeds, so the count cannot be derived from them', () => {
    // The structural half of the fix, and the reason the defect could not simply be
    // re-tested away: `allDeedsWitness` has no access to the array its count is
    // checked against. The pairs come from the producer. `tsc` rejects the old
    // four-argument call, which is what turned 25 silent tautologies into 25 errors.
    // Three entries, not two, and in an order that is neither sorted nor reversed:
    // with a two-element fixture `[[B,2],[A,0]]` a `.reverse()` in place of the sort
    // produces the identical array, so the assertion below passed on a mutant that had
    // no comparator at all. DET-1 wants the order pinned, not merely disturbed.
    const witness = allDeedsWitness(0, 400, [
      [B, 2],
      [C, 7],
      [A, 0],
    ]);
    expect(witness.tallies.map((t) => [t.principal, t.deedCount])).toEqual([
      [A, 0],
      [B, 2],
      [C, 7],
    ]);
    expect(Object.keys(witness).sort(compareIds)).toEqual([
      'claim',
      'reckoningIndex',
      'stateVersion',
      'tallies',
    ]);
  });

  it('no witness at all is not a claim of abstention either', () => {
    const r = run({ deeds: [], witnessed: false });
    expect(r.charges).toEqual([]);
    expect(r.verdicts).toEqual([]);
    expect(r.deferred[0]?.basis).toBe('UNWITNESSED_DEED_SET');
  });

  it('a witnessed abstention IS still contradicted — the fix must not delete the mark', () => {
    // The over-correction to guard against: if an absent deed could never be a
    // contradiction, a seal would cost nothing and the reveal would be dead.
    const r = run({ deeds: [] });
    expect(r.verdicts[0]?.verdict).toBe('CONTRADICTED');
    expect(r.charges.length).toBe(1);
    expect(r.deferred).toEqual([]);
  });

  /**
   * The three clauses that still halt, and the reason they may: each is the witness
   * disagreeing with **settlement itself**, which no agent input can reach. The
   * `claim` clause is here rather than only in the probe file because it is the
   * anti-accident guard — it is what stops an unrelated object spread into the slot
   * from being read as a claim of completeness — and it went one whole pass with no
   * test that bit it.
   */
  it('a witness that disagrees with settlement halts, because that is the engine’s own bug', () => {
    const book = new SealBook(NO_MEASURE_OPINION);
    const held = [role('V-1')];
    // Asserted, not discarded: this block used to throw the commit result away, so a
    // rejected fixture seal would have left the whole test passing on an empty book.
    const ok = book.commit({
      principal: A,
      tick: 100,
      actedOnStateVersion: 100,
      intent: intent(),
      prose: '',
      role: held[0] ?? null,
      rolesHeld: held,
    });
    expect(ok.ok, JSON.stringify(ok)).toBe(true);
    expect(book.size).toBe(1);

    const deeds = [deed({ principal: A, outcome: 50 })];
    const good = allDeedsWitness(0, 400, [[A, 1]]);
    for (const bad of [
      { ...good, reckoningIndex: 3 },
      { ...good, stateVersion: 399 },
      { ...good, claim: 'THESE_ARE_SOME_DEEDS' as typeof ALL_DEEDS_CLAIM },
    ]) {
      expect(() =>
        book.resolve({
          reckoningIndex: 0,
          atTick: AT_TICK,
          stateVersion: 400,
          deeds,
          deedSet: bad,
        }),
      ).toThrow(SealHalt);
    }
  });

  /**
   * The halt the first fix added, and the second one removed. `resolve` threw on a
   * deed whose principal the witness did not cover — but a principal owes a seal only
   * for the **roles it holds** (`unsealedRoles` asks nothing of a role-less
   * principal), so an agent that hauls while holding no role produced a legitimate
   * deed that stopped the settlement tick for everyone. AGT-X9's blast radius, reached
   * by an ordinary act.
   */
  it('a deed from a principal the witness never tallied is ignored, not a halt', () => {
    const book = new SealBook(NO_MEASURE_OPINION);
    const held = [role('V-1')];
    const ok = book.commit({
      principal: A,
      tick: 100,
      actedOnStateVersion: 100,
      intent: intent(),
      prose: '',
      role: held[0] ?? null,
      rolesHeld: held,
    });
    expect(ok.ok, JSON.stringify(ok)).toBe(true);

    // B holds no role, owes no seal, and hauls anyway.
    const deeds = [
      deed({ principal: A, outcome: 50 }),
      deed({ principal: B, outcome: 50, eventId: eid('ev:150:1') }),
    ];
    const r = book.resolve({
      reckoningIndex: 0,
      atTick: AT_TICK,
      stateVersion: 400,
      deeds,
      deedSet: allDeedsWitness(0, 400, [[A, 1]]),
    });
    // A's seal is judged normally; B's untallied deed changes nothing and breaks
    // nothing. It is not a fault either — the witness never claimed to cover B.
    expect(r.verdicts.map((v) => [v.principal, v.verdict])).toEqual([[A, 'HONOURED']]);
    expect(r.deferred).toEqual([]);
    expect(r.deedSetFaults).toEqual([]);
  });

  /** Seal for A in a fresh book, then resolve against `deeds` with `tally`. */
  function withTally(
    tally: readonly (readonly [typeof A, number])[],
    deeds: readonly Deed[],
  ): ReturnType<SealBook['resolve']> {
    const book = new SealBook(NO_MEASURE_OPINION);
    const held = [role('V-1')];
    const ok = book.commit({
      principal: A,
      tick: 100,
      actedOnStateVersion: 100,
      intent: intent(),
      prose: '',
      role: held[0] ?? null,
      rolesHeld: held,
    });
    expect(ok.ok, JSON.stringify(ok)).toBe(true);
    return book.resolve({
      reckoningIndex: 0,
      atTick: AT_TICK,
      stateVersion: 400,
      deeds,
      deedSet: allDeedsWitness(0, 400, tally),
    });
  }

  it('a tally that answers twice with two numbers defers rather than halting', () => {
    const r = withTally(
      [
        [A, 1],
        [A, 4],
      ],
      [],
    );
    expect(r.verdicts).toEqual([]);
    expect(r.charges).toEqual([]);
    expect(r.deferred.map((d) => d.basis)).toEqual(['UNWITNESSED_DEED_SET']);
    expect(r.deedSetFaults[0]).toContain('more than once');
  });

  it('but two answers that agree are merely untidy, and the abstention is still marked', () => {
    // Deferring over a repeated row would cost the reveal for nothing. Two answers is
    // no answer; the same answer twice is an answer.
    const r = withTally(
      [
        [A, 0],
        [A, 0],
      ],
      [],
    );
    expect(r.verdicts.map((v) => v.verdict)).toEqual(['CONTRADICTED']);
    expect(r.deedSetFaults).toEqual([]);
  });

  it('a tally that is not a count at all defers rather than halting', () => {
    for (const bogus of [-1, 1.5, Number.NaN]) {
      const r = withTally([[A, bogus]], []);
      expect(r.verdicts, `tally ${bogus}`).toEqual([]);
      expect(r.charges, `tally ${bogus}`).toEqual([]);
      expect(r.deferred.map((d) => d.basis), `tally ${bogus}`).toEqual(['UNWITNESSED_DEED_SET']);
      expect(r.deedSetFaults[0], `tally ${bogus}`).toContain('not a deed count');
    }
  });

  it('a fault names the principal and the counts, and never the sealed intention (PROP-D2)', () => {
    // `deedSetFaults` is a new operator-facing surface on a module whose whole subject
    // is content nobody may see. "Whose seal could not be judged" is already a second
    // fact about a sealed intention; the fields of that intention would be far worse.
    const r = withTally([[A, 3]], []);
    expect(r.deedSetFaults.length).toBe(1);
    const line = r.deedSetFaults[0] ?? '';
    const sealed = intent();
    for (const secret of [
      sealed.verb,
      sealed.target,
      String(sealed.outcomeLow),
      String(sealed.outcomeHigh),
      sealed.measure,
    ]) {
      expect(line, `leaked ${secret}`).not.toContain(secret);
    }
    expect(line).toContain(A);
  });

  it('and none of it can suppress a verdict a cited deed already proves', () => {
    // The over-correction to guard against, restated for the tally: a witness fault
    // withholds only marks that rest on an ABSENCE. A deed the resolver can point at
    // needs no witness — otherwise a query bug would start deleting kept promises,
    // which is A5's "loss is real, public, priceable" failing in the flattering
    // direction.
    const honoured = withTally([[A, 9]], [deed({ principal: A, outcome: 50 })]);
    expect(honoured.verdicts.map((v) => v.verdict)).toEqual(['HONOURED']);
    expect(honoured.deedSetFaults.length).toBe(1);

    const contradicted = withTally([[A, 9]], [deed({ principal: A, outcome: 5 })]);
    expect(contradicted.verdicts.map((v) => v.verdict)).toEqual(['CONTRADICTED']);
    expect(contradicted.charges.length).toBe(1);
  });
});

// ── A5′, route 2: the target ─────────────────────────────────────────────────

describe('A5′ — a formatting slip fails at sealing, not at judgement', () => {
  it('the world’s own spelling is demanded at commit, so `===` at judgement is exact', () => {
    const book = new SealBook(world());
    const held = [role('V-1')];
    const refused = book.commit({
      principal: A,
      tick: 100,
      actedOnStateVersion: 100,
      intent: intent({ target: 'SYS-VEGA' }),
      prose: '',
      role: held[0] ?? null,
      rolesHeld: held,
    });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.hint).toContain('sys-vega');
    expect(book.size).toBe(0);

    // The same seal, spelled the way the world spells it, is accepted.
    expect(
      book.commit({
        principal: A,
        tick: 100,
        actedOnStateVersion: 100,
        intent: intent({ target: 'sys-vega' }),
        prose: '',
        role: held[0] ?? null,
        rolesHeld: held,
      }).ok,
    ).toBe(true);
  });

  it('a target that names nothing is refused at sealing, recoverably and in private', () => {
    const book = new SealBook(world());
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
    if (!refused.ok) expect(refused.hint).toContain('no-such-place');
  });

  it('an ambiguous fold is never resolved for the agent — two ids, exact match only', () => {
    // Case-folding a target would be a rewrite, and a rewrite that collides is a
    // seal about one entity honoured by a deed about another. So the fold is only
    // ever a *hint*, and it is withheld when two real ids fold together.
    const index = sealWorldIndex(['p-a', 'P-A'], () => 'QTY');
    expect(index.canonicalTarget('p-a')).toBe('p-a');
    expect(index.canonicalTarget('P-A')).toBe('P-A');
    expect(index.canonicalTarget('P-a')).toBeNull();
  });

  it('with no world attached the slip cannot become a mark either', () => {
    // The degraded mode: a book that cannot witness a target must not infer
    // abstention from the absence of a deed naming it.
    const r = run({ target: 'sys-vega', world: null });
    expect(r.charges).toEqual([]);
    expect(r.verdicts).toEqual([]);
    expect(r.deferred[0]?.basis).toBe('UNWITNESSED_TARGET');
  });

  it('and with the world attached the honest seal is simply honoured', () => {
    const book = new SealBook(world());
    const held = [role('V-1')];
    const ok = book.commit({
      principal: A,
      tick: 100,
      actedOnStateVersion: 100,
      intent: intent({ target: 'sys-vega' }),
      prose: '',
      role: held[0] ?? null,
      rolesHeld: held,
    });
    expect(ok.ok).toBe(true);
    const deeds = [deed({ principal: A, outcome: 50, target: 'sys-vega' })];
    const r = book.resolve({
      reckoningIndex: 0,
      atTick: AT_TICK,
      stateVersion: 400,
      deeds,
      deedSet: allDeedsWitness(0, 400, [[A, 1]]),
    });
    expect(r.verdicts[0]?.verdict).toBe('HONOURED');
  });

  it('a pin ahead of the world is refused at the door when the caller supplies the version', () => {
    const book = new SealBook(world());
    const held = [role('V-1')];
    const refused = book.commit({
      principal: A,
      tick: 100,
      stateVersion: 100,
      actedOnStateVersion: 101,
      intent: intent({ target: 'sys-vega' }),
      prose: '',
      role: held[0] ?? null,
      rolesHeld: held,
    });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.invariant).toBe('INV-19');
  });
});

// ── The deferral itself is a first-class, once-only outcome ──────────────────

describe('a DEFERRED seal is judged exactly once and closes with no mark', () => {
  it('carries no verdict, no charge, and no second evaluation (scar #7)', () => {
    const book = new SealBook(NO_MEASURE_OPINION);
    const held = [role('V-1')];
    const accepted = book.commit({
      principal: A,
      tick: 100,
      actedOnStateVersion: 100,
      intent: intent({ measure: 'MINOR' }),
      prose: '',
      role: held[0] ?? null,
      rolesHeld: held,
    });
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) return;
    const deeds = [deed({ principal: A, outcome: 50, eventId: eid('ev:150:0') })];
    book.resolve({
      reckoningIndex: 0,
      atTick: AT_TICK,
      stateVersion: 400,
      deeds,
      deedSet: allDeedsWitness(0, 400, [[A, 1]]),
    });
    const rec = book.auditRecord(accepted.value.sealId);
    expect(rec?.disposition).toBe('UNMARKED');
    expect(rec?.verdict).toBeNull();
    expect(rec?.evaluations).toBe(1);
    // Not re-judged at any later court: the Reckoning is closed.
    expect(book.isResolved(0)).toBe(true);
    expect(() =>
      book.resolve({ reckoningIndex: 0, atTick: AT_TICK, stateVersion: 400, deeds: [] }),
    ).toThrow(SealHalt);
  });

  it('never reaches an agent, and publishes no event of its own (PROP-D2)', () => {
    // "Your seal could not be judged" is a second fact about a sealed intention, and
    // the prohibition has no exceptions. A deferred seal must look, to every reader,
    // exactly like a seal whose Reckoning has not come.
    const book = new SealBook();
    const held = [role('V-1')];
    const accepted = book.commit({
      principal: A,
      tick: 100,
      actedOnStateVersion: 100,
      intent: intent(),
      prose: 'Forty to sixty, as promised.',
      role: held[0] ?? null,
      rolesHeld: held,
    });
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) return;
    book.resolve({ reckoningIndex: 0, atTick: AT_TICK, stateVersion: 400, deeds: [] });
    const rec = book.auditRecord(accepted.value.sealId);
    if (rec === null) throw new Error('no record');

    expect(rec.disposition).toBe('UNMARKED');
    const disclosure = agentSealDisclosure(rec);
    expect(Object.keys(disclosure).sort(compareIds)).toEqual(
      [...SEAL_DISCLOSURE_KEYS].sort(compareIds),
    );
    expect(disclosure.verdict).toBeNull();
    expect(JSON.stringify(disclosure)).not.toContain('UNMARKED');
    expect(sealProjectionLeaks(disclosure, rec)).toEqual([]);
    // The scan half: a projection that carried the field would be flagged.
    expect(sealProjectionLeaks({ disposition: rec.disposition }, rec).length).toBeGreaterThan(0);
    // And there is no flag to publish, so the event builder refuses rather than
    // inventing one.
    expect(() => sealVerdictEvent(rec, 1, null)).toThrow(SealDisclosureError);
  });

  it('satisfies INV-20 — one evaluation, and the verdict clause exempts only DEFERRED', () => {
    // The reading stated in `src/seal/invariants.ts`: "exactly one verdict" cannot mean
    // "publish a mark you have just established you cannot justify" (A5′, §15.4), so it
    // is read as exactly one *evaluation*. The exemption is positive and narrow —
    // `test/seal/book.test.ts`'s mutation suite still fires on a resolved, verdict-less
    // seal with no disposition, which is what a mis-migrated row looks like.
    const book = new SealBook();
    const held = [role('V-1')];
    const accepted = book.commit({
      principal: A,
      tick: 100,
      actedOnStateVersion: 100,
      intent: intent(),
      prose: '',
      role: held[0] ?? null,
      rolesHeld: held,
    });
    expect(accepted.ok).toBe(true);
    const r = book.resolve({ reckoningIndex: 0, atTick: AT_TICK, stateVersion: 400, deeds: [] });
    expect(r.deferred.length).toBe(1);
    expect(checkInv20(book, AT_TICK)).toEqual([]);
    for (const rec of book.auditRecords()) {
      expect(rec.evaluations).toBe(1);
      expect(rec.verdict).toBeNull();
      expect(rec.verdictAtTick).toBeNull();
    }
  });
});
