/**
 * SECOND-PASS adversarial re-verification of the seal fixes.
 *
 * Written against the *fixed* module, on the assumption that the fix report
 * overstates itself. Same two patterns as `verify.probe.test.ts`:
 *
 * - **`it.fails('DEFECT(seal/…): …')`** — the body asserts the behaviour that would
 *   be correct, so the suite stays green while the defect stands and flips to an
 *   unexpected pass the moment it is closed.
 * - **plain `it`** — either a confirmation that a claimed fix genuinely holds, or a
 *   *witness* recording behaviour that follows from the design rather than from a
 *   defect in it.
 *
 * What this pass confirms: the P0 halt is genuinely gone on both routes, and the
 * mutation suite behind it bites (eight separate one-line reversions each turn
 * `witness.regression.test.ts` red). What it did **not** confirm is the report's claim
 * that the completeness witness makes every field "checked, not trusted".
 *
 * **THIRD PASS.** Both `it.fails` blocks below are now plain `it` and green, because
 * the two defects they recorded are closed:
 *
 * - the witness's count is per principal and comes from the deed **producer**, and
 *   `allDeedsWitness` no longer receives the deed array at all, so the tautology is
 *   not constructible through it;
 * - a deed from a principal the witness never tallied is ignored rather than thrown
 *   on, because a role-less principal owes no seal and must not be able to stop the
 *   settlement tick by hauling.
 *
 * The WITNESS blocks further down are unchanged and still stand: they record
 * consequences of the design (the unvouched-unit escape, the pin asymmetry) rather
 * than defects in this module, and each names what would close it.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ALL_DEEDS_CLAIM,
  SealBook,
  SealHalt,
  allDeedsWitness,
  sealWorldIndex,
  type Deed,
  type SealCommit,
  type SealWorldIndex,
} from '../../src/seal/index.js';
import { deed, eid, intent, pid, role, settlement } from './helpers.js';

const A = pid('P-A');
const B = pid('P-B');
const AT = settlement(0);

/** What a fully wired tick loop supplies: real ids and a real verb→measure answer. */
const WIRED: SealWorldIndex = sealWorldIndex(['SYS-VEGA', 'SYS-LYRA'], (v) =>
  v === 'haul' ? 'QTY' : null,
);

/** What a *partly* wired tick loop supplies — no verb→measure table exists yet. */
const NO_UNIT_TABLE: SealWorldIndex = sealWorldIndex(['SYS-VEGA'], () => null);

function seal(book: SealBook, p: string, over: Partial<SealCommit> = {}): void {
  const held = [role(`V-${p}`)];
  const r = book.commit({
    principal: pid(p),
    tick: 100,
    actedOnStateVersion: 100,
    intent: intent(),
    prose: '',
    role: held[0] ?? null,
    rolesHeld: held,
    ...over,
  });
  if (!r.ok) throw new Error(`commit refused: ${r.hint}`);
}

// ── P0: is any agent-supplied field still able to stop the settlement tick? ───

describe('REVERIFY P0 — the agent-triggerable halt', () => {
  it('CONFIRMED FIXED: wrong unit plus the act sealed does not throw', () => {
    const book = new SealBook(NO_UNIT_TABLE);
    seal(book, 'P-A', { intent: intent({ measure: 'MINOR' }) });
    const deeds = [deed({ principal: A })];
    expect(() =>
      book.resolve({
        reckoningIndex: 0,
        atTick: AT,
        stateVersion: 400,
        deeds,
        deedSet: allDeedsWitness(0, 400, [[A, 1]]),
      }),
    ).not.toThrow();
  });

  it('CONFIRMED FIXED: a MAX_SAFE_INTEGER pin does not throw and is still judged', () => {
    const book = new SealBook(WIRED);
    seal(book, 'P-A', { actedOnStateVersion: Number.MAX_SAFE_INTEGER });
    const deeds = [deed({ principal: A })];
    const r = book.resolve({
      reckoningIndex: 0,
      atTick: AT,
      stateVersion: 400,
      deeds,
      deedSet: allDeedsWitness(0, 400, [[A, 1]]),
    });
    expect(r.verdicts[0]?.verdict).toBe('HONOURED');
  });

  /**
   * DEFECT — a **new** route to the same outage, added by the first fix. **Now
   * fixed**, and the assertions below were flipped to hold the fix.
   *
   * `resolve` halted on a deed whose principal the completeness witness did not cover
   * (`book.ts`'s "the witness and the deeds disagree about whose Reckoning this is").
   * But a principal only owes a seal for the **roles it holds** —
   * `unsealedRoles`/`sealComplianceRejection` ask nothing of a principal with no role
   * — while the witness's principal set is the set the resolver is judging seals for.
   * So a principal that hauls and holds no role produced a deed nobody witnessed, and
   * the whole Reckoning halted with every other principal's seals inside it: AGT-X9's
   * blast radius, reached from an ordinary act.
   *
   * It could not produce a false mark either way — a seal of an untallied principal
   * already defers, and a seal with a cited deed needs no witness at all — so the halt
   * bought nothing and cost the settlement tick. By the module's own rule (*a halt is
   * for our bug, never for their input*) the extra deed is now ignored, and A's seal is
   * judged exactly as it would have been without it.
   */
  it('a principal who acts but never seals does NOT halt the Reckoning', () => {
    const book = new SealBook(WIRED);
    seal(book, 'P-A'); // only A holds a role, so only A owes a seal
    const deeds = [deed({ principal: A }), deed({ principal: B, eventId: eid('ev:150:1') })];
    const r = book.resolve({
      reckoningIndex: 0,
      atTick: AT,
      stateVersion: 400,
      deeds,
      // The tally covers the principals whose seals are being judged.
      deedSet: allDeedsWitness(0, 400, [[A, 1]]),
    });
    expect(r.verdicts.map((v) => [v.principal, v.verdict])).toEqual([[A, 'HONOURED']]);
    expect(r.deferred).toEqual([]);
    expect(r.deedSetFaults).toEqual([]);
  });

  it('the surviving halts are engine-side: a deed valued ahead of settlement', () => {
    const book = new SealBook(WIRED);
    seal(book, 'P-A');
    const deeds = [deed({ principal: A, valuedAtStateVersion: 401 })];
    expect(() =>
      book.resolve({
        reckoningIndex: 0,
        atTick: AT,
        stateVersion: 400,
        deeds,
        deedSet: allDeedsWitness(0, 400, [[A, 1]]),
      }),
    ).toThrow(SealHalt);
  });
});

// ── P1 route 1: does the completeness witness witness anything? ──────────────

describe('REVERIFY P1 — the completeness witness under its own documented usage', () => {
  /**
   * DEFECT — the §15.4 false-mark route survived the first fix, and survived it under
   * the fix's own recommended construction. **Now fixed**, and these assertions hold
   * the fix.
   *
   * The old `allDeedsWitness` derived a single total `deedCount` **from the same array
   * it accompanied**, so `resolve`'s `witness.deedCount !== input.deeds.length` clause
   * was a tautology for every caller that used the exported helper — and the fix's own
   * cross-module instruction was to use exactly that helper. Under that instruction a
   * query that dropped a row still published a permanent public CONTRADICTED plus a
   * standing charge against the principal it dropped, with no invariant firing: the
   * original P1, verbatim. A count derived from the thing it is meant to witness is
   * not a witness.
   *
   * The witness now carries a **per-principal** count that the helper cannot compute,
   * because the helper never receives the deeds. Below, the producer wrote one deed
   * each for A and B, one row arrived, and the disagreement lands on B — which defers
   * with no mark and no charge, and says so in `deedSetFaults`.
   */
  it('a dropped deed row does NOT mark the principal it dropped', () => {
    const book = new SealBook(WIRED);
    seal(book, 'P-A');
    seal(book, 'P-B');
    // Both hauled 50, in band. The deed query lost B's row.
    const gathered = [deed({ principal: A })];
    const r = book.resolve({
      reckoningIndex: 0,
      atTick: AT,
      stateVersion: 400,
      deeds: gathered,
      // The documented construction: the producer's own tally, zero-deed principals
      // included — and not a number this call site could read off `gathered`.
      deedSet: allDeedsWitness(0, 400, [
        [A, 1],
        [B, 1],
      ]),
    });
    expect(r.charges).toEqual([]);
    expect(r.verdicts.map((v) => v.principal)).toEqual([A]);
    expect(r.deferred.map((d) => [d.principal, d.basis])).toEqual([[B, 'UNWITNESSED_DEED_SET']]);
    expect(r.deedSetFaults.length).toBe(1);
  });

  /**
   * COVERAGE GAP, closed here. `book.ts`'s `witness.claim !== ALL_DEEDS_CLAIM` check
   * exists so a caller "cannot supply the witness by accident, or by spreading an
   * unrelated object" — and nothing tested it: replacing that condition with `false`
   * left all 161 seal tests green, so the anti-accident guard could be deleted or
   * inverted silently. It is the only one of the witness's five clauses that was
   * unpinned.
   */
  it('a witness with no claim of completeness halts, and that clause is now pinned', () => {
    const book = new SealBook(WIRED);
    seal(book, 'P-A');
    const deeds = [deed({ principal: A })];
    expect(() =>
      book.resolve({
        reckoningIndex: 0,
        atTick: AT,
        stateVersion: 400,
        deeds,
        deedSet: {
          ...allDeedsWitness(0, 400, [[A, 1]]),
          // What an unrelated object spread into the slot looks like.
          claim: 'THESE_ARE_SOME_DEEDS' as typeof ALL_DEEDS_CLAIM,
        },
      }),
    ).toThrow(SealHalt);
  });

  it('the narrow case the witness always closed: B absent from the tally defers', () => {
    const book = new SealBook(WIRED);
    seal(book, 'P-A');
    seal(book, 'P-B');
    const gathered = [deed({ principal: A })];
    const r = book.resolve({
      reckoningIndex: 0,
      atTick: AT,
      stateVersion: 400,
      deeds: gathered,
      deedSet: allDeedsWitness(0, 400, [[A, 1]]),
    });
    expect(r.charges).toEqual([]);
    expect(r.deferred.map((d) => d.principal)).toEqual([B]);
  });
});

// ── P1 route 2: the target ───────────────────────────────────────────────────

describe('REVERIFY P1 — target validation', () => {
  it('CONFIRMED FIXED: a case slip is refused at commit with the world attached', () => {
    const book = new SealBook(WIRED);
    const r = book.commit({
      principal: A,
      tick: 100,
      actedOnStateVersion: 100,
      intent: intent({ target: 'sys-vega' }),
      prose: '',
      role: role('V-1'),
      rolesHeld: [role('V-1')],
    });
    expect(r.ok).toBe(false);
  });

  /**
   * WITNESS, not a defect in this module — but the fix's guarantee rests on it and
   * nothing enforces it. The door canonicalises the target the *agent* wrote against
   * the id list a caller handed `sealWorldIndex`. A deed's target is written by the
   * deed producer. If those two spellings ever come from different sources, every
   * honest seal is CONTRADICTED from absence with **both** witnesses satisfied and no
   * invariant firing — the original finding, relocated to a cross-module contract.
   */
  it('the world index and the deed producer must share one spelling, or every seal is marked', () => {
    const book = new SealBook(WIRED);
    seal(book, 'P-A', { intent: intent({ target: 'SYS-VEGA' }) });
    const deeds: Deed[] = [deed({ principal: A, target: 'sys-vega' })];
    const r = book.resolve({
      reckoningIndex: 0,
      atTick: AT,
      stateVersion: 400,
      deeds,
      deedSet: allDeedsWitness(0, 400, [[A, 1]]),
    });
    expect(r.verdicts[0]?.verdict).toBe('CONTRADICTED');
    expect(r.charges.length).toBe(1);
  });
});

// ── did the fix hand agents a way out of a mark they earned? ─────────────────

describe('REVERIFY — deferral as an escape from an earned mark', () => {
  /**
   * WITNESS. The fix report calls this residual "a weightless seal … a game-balance
   * gap". It is sharper than that: `unjudgeable` outranks `CONTRADICTED` in `judge`,
   * so a seal in a unit no caller can vouch for is not merely weightless — it is an
   * **escape from a contradiction the agent has already earned**. Below, the agent
   * promises 40–60, hauls 5, and the record shows nothing at all: no verdict, no
   * charge, no event, and no invariant. A5 says loss is real, public and priceable.
   *
   * Closed only when some caller can answer `measureOfVerb` for every verb, which is
   * the one thing the fix explicitly did not build.
   */
  it('a seal in an unvouched unit escapes the contradiction it earned', () => {
    const book = new SealBook(NO_UNIT_TABLE);
    seal(book, 'P-A', { intent: intent({ measure: 'MINOR', outcomeLow: 40, outcomeHigh: 60 }) });
    const deeds = [deed({ principal: A, outcome: 5 })];
    const r = book.resolve({
      reckoningIndex: 0,
      atTick: AT,
      stateVersion: 400,
      deeds,
      deedSet: allDeedsWitness(0, 400, [[A, 1]]),
    });
    expect(r.verdicts).toEqual([]);
    expect(r.charges).toEqual([]);
    expect(r.deferred.map((d) => d.basis)).toEqual(['MEASURE_DISAGREEMENT']);
  });

  /**
   * WITNESS. The same escape through the *pin*, and this one survives a fully wired
   * world: the door only refuses a pin **ahead** of the world, so a pin at the
   * current version is legal, and any deed the engine valued at an earlier version is
   * `STALE_MEASUREMENT` → no mark. Whether an agent can steer this depends entirely
   * on when the deed producer stamps `valuedAtStateVersion` (a haul valued at
   * dispatch rather than arrival makes it steerable: dispatch, then seal).
   */
  it('a legal pin at the current version defers a broken seal', () => {
    const book = new SealBook(WIRED);
    seal(book, 'P-A', { stateVersion: 300, actedOnStateVersion: 300 });
    const deeds = [deed({ principal: A, outcome: 5, valuedAtStateVersion: 150 })];
    const r = book.resolve({
      reckoningIndex: 0,
      atTick: AT,
      stateVersion: 400,
      deeds,
      deedSet: allDeedsWitness(0, 400, [[A, 1]]),
    });
    expect(r.charges).toEqual([]);
    expect(r.deferred.map((d) => d.basis)).toEqual(['STALE_MEASUREMENT']);
  });

  /**
   * WITNESS. "An impossible pin buys the agent nothing" is not quite true: it buys
   * **immunity from rule 4**. `pinnedVersion` zeroes an impossible pin, so a deed
   * measured against any state at all can honour the seal — while the honest agent
   * that pinned truthfully has the same deed deferred. Lying about what you saw is
   * weakly dominant over telling the truth, which inverts the incentive the pin
   * exists to create (scar #6).
   */
  it('an impossible pin buys immunity from rule 4, where an honest pin defers', () => {
    const ancient = [deed({ principal: A, outcome: 50, valuedAtStateVersion: 0 })];
    const witness = allDeedsWitness(0, 400, [[A, 1]]);

    const liar = new SealBook(NO_UNIT_TABLE);
    seal(liar, 'P-A', { actedOnStateVersion: Number.MAX_SAFE_INTEGER });
    const lied = liar.resolve({
      reckoningIndex: 0,
      atTick: AT,
      stateVersion: 400,
      deeds: ancient,
      deedSet: witness,
    });
    expect(lied.verdicts[0]?.verdict).toBe('HONOURED');

    const honest = new SealBook(NO_UNIT_TABLE);
    seal(honest, 'P-A', { actedOnStateVersion: 100 });
    const told = honest.resolve({
      reckoningIndex: 0,
      atTick: AT,
      stateVersion: 400,
      deeds: ancient,
      deedSet: witness,
    });
    expect(told.verdicts).toEqual([]);
    expect(told.deferred.map((d) => d.basis)).toEqual(['STALE_MEASUREMENT']);
  });
});

// ── §3 / HARD RULE 4: one word per concept ───────────────────────────────────

describe('REVERIFY — the vocabulary of the third disposition', () => {
  /**
   * DEFECT — `SealDisposition` reuses `DEFERRED`, and it means the **opposite** of
   * what the same word already means on `VentureState`.
   *
   * - `VentureState.DEFERRED` is explicitly *not terminal* (`src/venture/venture.ts`
   *   "`DEFERRED` is not terminal (§15.3)"): the obligation is carried to the next
   *   Reckoning, counted in `deferrals`, and settled again.
   * - `SealDisposition.DEFERRED` is terminal and never re-judged — `verdict.ts`:
   *   "the *decision* is abandoned, never retried".
   *
   * SPEC §15.3, which `verdict.ts` cites as its authority, says an unresolved
   * obligation "**DEFERS** to the next Reckoning" — i.e. the canon meaning is the
   * venture one. So the fix report's justification ("DEFERRED already names this
   * exact concept on VentureState, so it is one word for one concept") is inverted:
   * it is one word for two concepts, which is what HARD RULE 4 and SPEC §3 forbid,
   * on the module whose subject is a permanent public mark. `vocabulary-repo.test.ts`
   * cannot see it because `DEFER` is §3 prose rather than a Term-column row.
   *
   * Not agent-reachable today — PROP-D2 keeps `disposition` off every projection —
   * so it was a rules-surface defect waiting for its first reader, which is exactly
   * how scar #1 shipped. FIXED by renaming the seal side to `UNMARKED`.
   */
  it('FIXED: SealDisposition shares no member with VentureState', () => {
    // Renamed to UNMARKED. The venture keeps DEFERRED because §15.3 uses that word;
    // an unmarked seal was never deferral in the first place — it is terminal, judged
    // exactly once, and closed with no mark (INV-20).
    const members = (src: string, name: string): string[] => {
      const decl = new RegExp(`export type ${name} =([^;]+);`).exec(src)?.[1] ?? '';
      return [...decl.matchAll(/'([A-Z_]+)'/g)].map((m) => m[1] ?? '');
    };
    const dispositions = members(
      readFileSync(new URL('../../src/seal/verdict.ts', import.meta.url), 'utf8'),
      'SealDisposition',
    );
    const ventureStates = members(
      readFileSync(new URL('../../src/core/types.ts', import.meta.url), 'utf8'),
      'VentureState',
    );
    expect(dispositions.length).toBe(3);
    expect(ventureStates.length).toBe(6);
    expect(dispositions.filter((d) => ventureStates.includes(d))).toEqual([]);
  });
});
