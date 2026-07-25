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
 */

import { describe, expect, it } from 'vitest';
import { compareIds } from '../../src/ledger/order.js';
import {
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
    ...(over.witnessed === false ? {} : { deedSet: allDeedsWitness(0, 400, deeds, [A]) }),
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
      deedSet: allDeedsWitness(0, 400, deeds, [A, B]),
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
    // says so: it covers A alone.
    const deeds = [deed({ principal: A, outcome: 50 })];
    const r = book.resolve({
      reckoningIndex: 0,
      atTick: AT_TICK,
      stateVersion: 400,
      deeds,
      deedSet: allDeedsWitness(0, 400, deeds, [A]),
    });
    expect(r.charges).toEqual([]);
    expect(r.verdicts.map((v) => v.principal)).toEqual([A]);
    expect(r.deferred.map((d) => [d.principal, d.basis])).toEqual([[B, 'UNWITNESSED_DEED_SET']]);
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

  it('a witness that contradicts itself halts, because that is the engine’s own bug', () => {
    const book = new SealBook(NO_MEASURE_OPINION);
    const held = [role('V-1')];
    book.commit({
      principal: A,
      tick: 100,
      actedOnStateVersion: 100,
      intent: intent(),
      prose: '',
      role: held[0] ?? null,
      rolesHeld: held,
    });
    const deeds = [deed({ principal: A, outcome: 50 })];
    for (const bad of [
      { ...allDeedsWitness(0, 400, deeds, [A]), deedCount: 7 },
      { ...allDeedsWitness(0, 400, deeds, [A]), reckoningIndex: 3 },
      { ...allDeedsWitness(0, 400, deeds, [A]), stateVersion: 399 },
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

  it('a deed for a principal the witness does not cover is the engine’s bug too', () => {
    const book = new SealBook(NO_MEASURE_OPINION);
    const deeds = [deed({ principal: A, outcome: 50 })];
    expect(() =>
      book.resolve({
        reckoningIndex: 0,
        atTick: AT_TICK,
        stateVersion: 400,
        deeds,
        deedSet: allDeedsWitness(0, 400, deeds, [B]),
      }),
    ).toThrow(SealHalt);
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
      deedSet: allDeedsWitness(0, 400, deeds, [A]),
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
      deedSet: allDeedsWitness(0, 400, deeds, [A]),
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
