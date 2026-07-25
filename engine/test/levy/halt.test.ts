/**
 * NOTHING THE LEVY DOES MAY STOP THE WORLD — the four ways it did.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * AGT-X9: no agent-reachable path halts the world. The Levy's assessment is the one
 * mechanic every principal is on every night, so it is also the one whose failure mode
 * is *everybody at once*: `docketRowsFor` returning nothing makes INV-25 — the anti-quiet
 * invariant — fire once per principal, and a re-run fails identically, so the world is
 * not merely paused but unrecoverable.
 *
 * Each case below was a live halt or a silent lie found by adversarial verification, with
 * the fix named. They are regression tests, not exploratory ones: every `expect` here was
 * red before the commit that added this file.
 * ══════════════════════════════════════════════════════════════════════════
 */

import { describe, expect, it } from 'vitest';
import { TICKS_PER_RECKONING, setSpeed } from '../../src/core/time.js';
import type { PrincipalId } from '../../src/core/types.js';
import { commonsFloorRejection } from '../../src/world/commons.js';
import {
  LEVY_NEWCOMER_CAPITAL_MINOR,
  LEVY_NOMINAL_MINOR,
  MAX_LEVY_ASSESSMENTS,
} from '../../src/levy/index.js';
import { Runtime, STARTER_STAKE } from '../../src/sim/runtime.js';
import { restoreSnapshot } from '../../src/tick/snapshot.js';
import { commonsSystems } from '../../src/world/index.js';
import { levyWorld, runTo, tick } from './fixture.js';

describe('the roll is lifetime enrolments, and no cap may be smaller than it', () => {
  /**
   * `Book.assess` refused a plan of more than `MAX_LEVY_ASSESSMENTS` lines. A plan holds
   * one line per principal on the roll, and the roll is **every principal ever enrolled**
   * — `api/seats.ts` recycles the 300 concurrent *seats* while identity and the holding
   * are never deleted (A10). So the cap was a cliff on a monotonically growing set, and
   * `POST /enroll` is free and unauthenticated by design (A15).
   *
   * Past the cliff: `assessCycle` propagated, `assessLevyNow` caught and filed a fault,
   * nothing at all was assessed, and INV-25 halted once per principal — 513 violations,
   * permanently, because the re-run fails the same way.
   */
  it(`publishes a clean tick with ${String(MAX_LEVY_ASSESSMENTS + 1)} lifetime enrolments`, () => {
    setSpeed('instant');
    const runtime = new Runtime({ seed: 'levy-cap' });
    const stage = commonsSystems(runtime.world.map)[0];
    if (stage === undefined) throw new Error('the launch map has no Commons system');
    for (let i = 0; i <= MAX_LEVY_ASSESSMENTS; i += 1) {
      const handle = `x${String(i).padStart(4, '0')}`;
      runtime.seat(`p:${handle}` as PrincipalId, handle, stage);
    }
    expect(runtime.world.principalOrder.length).toBe(MAX_LEVY_ASSESSMENTS + 1);

    const report = runtime.runTick();
    expect(report.violations.filter((v) => v.severity === 'HALT')).toEqual([]);
    expect(report.halted).toBe(false);
    // And the assessment really covers all of them, rather than covering none quietly.
    expect(runtime.levy.plansIn(0).flatMap((p) => p.lines).length).toBe(MAX_LEVY_ASSESSMENTS + 1);
  });

  /**
   * The same cap on the tenure register was the *permanent newcomer* exploit rebuilt.
   * `Runtime.seat` catches the refusal, so the principal was seated with no tenure row,
   * and `tenureTicksOf` returns 0 for an unknown principal on purpose — the safe direction
   * for a genuine newcomer. Two safe choices made one permanent: enrolment 513 and every
   * one after it read as tenure 0 and was assessed the nominal 500 rather than the 20 000
   * duty, for the rest of the season.
   */
  it('registers the tenure of every principal, however many have enrolled', () => {
    setSpeed('instant');
    const runtime = new Runtime({ seed: 'levy-tenure-cap' });
    const stage = commonsSystems(runtime.world.map)[0];
    if (stage === undefined) throw new Error('the launch map has no Commons system');
    for (let i = 0; i <= MAX_LEVY_ASSESSMENTS + 1; i += 1) {
      const handle = `y${String(i).padStart(4, '0')}`;
      runtime.seat(`p:${handle}` as PrincipalId, handle, stage);
    }
    const last = `p:y${String(MAX_LEVY_ASSESSMENTS + 1).padStart(4, '0')}` as PrincipalId;
    expect(runtime.levy.seatedAtOf(last)).not.toBeNull();
    // The load-bearing consequence: it stops being a newcomer like everybody else.
    expect(runtime.levy.tenureTicksOf(last, 100_000)).toBeGreaterThan(TICKS_PER_RECKONING * 2);
  });
});

describe('a mid-cycle enroller is always on tonight&apos;s docket', () => {
  /**
   * `assessCycle` skips a constellation with an empty roll, so a constellation nobody was
   * seated in at phase 0 holds no plan. `admitLateToLevy` then returned silently, and
   * `levyAssessedReckoning` stopped `assessCycle` from ever being asked again that cycle —
   * so the arrival held no assessment, appeared on no docket row, and INV-25 halted on the
   * arrival of a legitimate newcomer through the world's own free front door.
   *
   * Driven through `seat(principal, handle)` with **no `seatAt`**, which is verbatim what
   * `POST /enroll` calls.
   */
  it('does not halt when its constellation held nobody at phase 0', () => {
    setSpeed('instant');
    const runtime = new Runtime({ seed: 'levy-late-con' });
    const map = runtime.world.map;
    const commons = commonsSystems(map)[0];
    if (commons === undefined) throw new Error('the launch map has no Commons system');
    const commonsCon = map.systems.get(commons)?.constellation;
    const elsewhere = [...map.systems.keys()].find(
      (s) => map.systems.get(s)?.constellation !== commonsCon,
    );
    if (elsewhere === undefined) throw new Error('the launch map has one constellation');

    // The only principal in the world is outside the Commons constellation, so phase 0
    // assesses that constellation and skips the Commons one.
    runtime.seat('p:marcher' as PrincipalId, 'marcher', elsewhere);
    tick(runtime);
    expect(runtime.levy.plansIn(0).map((p) => p.constellation)).not.toContain(commonsCon);

    // Now an agent enrols. `POST /enroll` always seats in the Commons.
    runtime.seat('p:arrival' as PrincipalId, 'arrival');
    const report = runtime.runTick();
    expect(report.violations.filter((v) => v.severity === 'HALT')).toEqual([]);
    expect(report.halted).toBe(false);
    // The plan is minted late rather than never, and the arrival is on the floor.
    const line = runtime.levy.lineFor(0, 'p:arrival' as PrincipalId);
    expect(line).not.toBeNull();
    expect(line?.line.newcomerFloored).toBe(true);
  });
});

describe('what a resumed tick asks about the Levy is inside the rollback', () => {
  /**
   * ══════════════════════════════════════════════════════════════════════════
   * **THE DEFECT THIS PINS HALF OF, AND THE HALF IT CANNOT.**
   *
   * `settleLevyNow` and `assessLevyNow` guarded on plain fields on `Runtime`
   * (`levySettledReckoning`, `levyAssessedReckoning`). `abort()` restores every *state
   * table* — `levyStateTable` is one — so a halted tick's `markSettled` and its minted
   * plan go back; a plain field does not. `resume()` then re-runs **the same tick**
   * (`loop.ts:resolve(inputs.tick, pending.window, pending.before)`), the stale field
   * returns early, and:
   *
   *   - the settlement side voids the whole Reckoning **in silence** — no shortfall rows,
   *     no sweep, no strikes, `LEVY SHORT` 0 instead of what was owed, tick published
   *     clean;
   *   - the assessment side mints nothing, `docketRowsFor` returns `[]`, and INV-25 halts
   *     once per principal for the rest of the cycle — a world made unrecoverable by its
   *     own recovery path.
   *
   * Both guards now read the book, which is inside `state_hash` and inside the rollback,
   * so they can only say what the world they belong to says. That also deletes two second
   * homes for facts `Book` already owned (scar #5).
   *
   * **This test does not exercise the guard.** `resume()` needs a signed resume order and
   * a retained halted tick, and `SubmissionQueue.openFor` refuses to reopen a tick it has
   * passed, so no test here can re-run one tick twice — an earlier attempt appeared to
   * pass only because the *abort's own* restore put the plan back. What is pinned below is
   * the property the fix depends on: the flags the guards now read really do travel with
   * the rollback. The guard itself belongs to TESTING.md's E2E-31 (signed resume), which
   * is where it should be asserted end to end.
   * ══════════════════════════════════════════════════════════════════════════
   */
  it('carries `settled` and the minted plans through a snapshot restore', () => {
    const { runtime } = levyWorld('levy-rollback', 3, 0);
    runTo(runtime, TICKS_PER_RECKONING * 3 - 2);
    const reckoning = Math.floor(runtime.engine.tick / TICKS_PER_RECKONING);
    const before = runtime.engine.snapshot();

    tick(runtime); // the settlement tick
    expect(runtime.levy.isSettled(reckoning)).toBe(true);
    expect(runtime.levy.shortfallsIn(reckoning).length).toBeGreaterThan(0);
    expect(runtime.levy.shortFor(reckoning)).toBeGreaterThan(0);

    // Exactly what `abort()` does on a HALT: put the state tables back.
    restoreSnapshot(runtime.engine.stateTables, before);

    // The three things a resumed tick has to be told the truth about. If any of them
    // stayed behind, a re-run would either skip the settlement or double it.
    expect(runtime.levy.isSettled(reckoning)).toBe(false);
    expect(runtime.levy.shortfallsIn(reckoning).length).toBe(0);
    expect(runtime.levy.plansIn(reckoning).length).toBeGreaterThan(0);

  });

  /**
   * The other direction, and the half a dropped `settled` field would hide: a snapshot
   * taken *after* a settlement has to come back settled, or a restore would settle the
   * same Reckoning twice — one debt, two lots of goods taken (INV-20's shape).
   */
  it('carries `settled` forward out of a snapshot taken after the settlement', () => {
    const { runtime } = levyWorld('levy-rollback-fwd', 3, 0);
    runTo(runtime, TICKS_PER_RECKONING * 3);
    const reckoning = 2;
    expect(runtime.levy.isSettled(reckoning)).toBe(true);
    const rows = runtime.levy.shortfallsIn(reckoning).length;
    expect(rows).toBeGreaterThan(0);

    const after = runtime.engine.snapshot();
    restoreSnapshot(runtime.engine.stateTables, after);
    expect(runtime.levy.isSettled(reckoning)).toBe(true);
    expect(runtime.levy.shortfallsIn(reckoning).length).toBe(rows);
  });

  it('carries an assessment minted this tick out again', () => {
    const { runtime } = levyWorld('levy-rollback-assess', 3, 0);
    runTo(runtime, TICKS_PER_RECKONING - 1);
    const before = runtime.engine.snapshot();
    tick(runtime);
    expect(runtime.levy.plansIn(1).length).toBeGreaterThan(0);
    restoreSnapshot(runtime.engine.stateTables, before);
    expect(runtime.levy.plansIn(1).length).toBe(0);
  });
});

describe('a mis-cased ballot is refused, and told why', () => {
  /**
   * `classifyAction` folds case to **find** hostility and demands an exact spelling to
   * **grant** safety — both halves deliberate and pinned by E2E-21, because a typo must
   * never buy Commons protection. Correct, and unchanged.
   *
   * What was wrong was the sentence. `{"ballot": "levy"}` was refused with *"'vote' is a
   * hostile act and must name the hand, holding, principal or system it is aimed at"* — a
   * description of a **seizure**, handed to an agent casting the Levy's peaceful
   * allocation ballot, with no mention of spelling. `Runtime.vVote` upper-cases the same
   * field before reading it, so from outside the two layers disagree about one word: scar
   * #1's shape in agent-facing text (hard rule 4), and the refusal loop AGT-S3 is about.
   *
   * The classification is asserted here too, so a future "fix" that folds the peaceful
   * side to make the hint unnecessary fails this test rather than quietly widening what
   * the Commons protects.
   */
  it('still classifies a mis-cased LEVY ballot as hostile', () => {
    const { runtime } = levyWorld('levy-case', 2, 0);
    for (const ballot of ['levy', 'Levy', 'lEvY']) {
      expect(commonsFloorRejection(runtime.world, 'vote', { ballot, rule: 'EVEN' })).not.toBeNull();
    }
    expect(commonsFloorRejection(runtime.world, 'vote', { ballot: 'LEVY', rule: 'EVEN' })).toBeNull();
  });

  it('names the spelling in the refusal, and does not name it for a real seizure', () => {
    const { runtime } = levyWorld('levy-case-hint', 2, 0);
    const mis = commonsFloorRejection(runtime.world, 'vote', { ballot: 'levy', rule: 'EVEN' });
    expect(mis?.hint).toContain('spelled in capitals');
    expect(mis?.hint).toContain('"LEVY"');
    // A seizure ballot is hostile on its merits, whatever its casing, and must not be
    // told it merely mis-typed something.
    for (const ballot of ['SEIZURE', 'seizure', 'not-a-ballot']) {
      const rejection = commonsFloorRejection(runtime.world, 'vote', { ballot });
      expect(rejection).not.toBeNull();
      expect(rejection?.hint).not.toContain('spelled in capitals');
    }
  });

  /** And the accepted spelling really does reach the handler and cast a ballot. */
  it('accepts the exact spelling end to end', () => {
    const { runtime, principals } = levyWorld('levy-case-e2e', 2, 0);
    const voter = principals[0];
    if (voter === undefined) throw new Error('no voter');
    const outcome = runtime.engine.submit({
      principal: voter,
      verb: 'vote',
      params: { ballot: 'LEVY', rule: 'EVEN' },
      clientSequence: 0,
      arrivalMs: 0,
      decisionSource: 'LIVE',
    });
    expect(outcome.ok).toBe(true);
    tick(runtime);
    expect(runtime.levy.hasVoted(1, voter)).toBe(true);
  });
});

describe('the newcomer floor still catches a newcomer', () => {
  /**
   * The floor needs **both** halves — tenure *and* capital — and `params.ts` argues why:
   * read as "either", it is a switch any veteran flips by spending down before the
   * assessment. The consequence nobody wrote down is that the floor only protects a fresh
   * arrival while `STARTER_STAKE` stays *below* `LEVY_NEWCOMER_CAPITAL_MINOR`, and those
   * two live in different files with no relation between them.
   *
   * Raise the stake past the capital threshold and every newcomer is assessed the full
   * duty on its first night — §13's minute-60 checklist expects one Levy paid inside the
   * first hour, and A15's "a newcomer is assessed at a nominal rate" stops being true —
   * with nothing failing. So the ordering is pinned.
   */
  it('a principal seated with the starter stake is inside the capital half', () => {
    expect(STARTER_STAKE).toBeLessThan(LEVY_NEWCOMER_CAPITAL_MINOR);
  });

  it('and a freshly seated principal really is floored, end to end', () => {
    const { runtime, principals } = levyWorld('levy-floor', 2, 0);
    tick(runtime);
    for (const p of principals) {
      const line = runtime.levy.lineFor(0, p);
      expect(line?.line.newcomerFloored).toBe(true);
      expect(line?.line.amount).toBe(LEVY_NOMINAL_MINOR);
    }
  });
});

describe('INV-24 cannot witness the newcomer floor it is handed', () => {
  /**
   * NOT A REGRESSION — a **standing limitation, pinned so it cannot be mistaken for
   * cover.** `inv24InputsFor` builds `floorEligible` from each line's own
   * `newcomerFloored` flag, and `checkInv24` then compares the two. They are the same
   * field, so `eligible <=> newcomerFloored` always, and the two clauses that exist to
   * catch a protection that failed to apply are unreachable:
   *
   *   - "inside the newcomer floor but its assessment does not record the floor"
   *   - "not inside the newcomer floor but its assessment claims the floor"
   *
   * What INV-24 still checks is real: the exact sum, no double assessment, no negative
   * line, a floored line never assessed above nominal, and a floored line never in the
   * sweep queue. What it does **not** check is whether the floor was applied to the
   * principals the published test says are inside it — that is covered only by
   * `assessment.test.ts` against `allocate`, and by nothing at all at runtime.
   *
   * Closing it needs `floorEligible` recomputed from `LevySubject` facts by a second road
   * (`isNewcomer(subjectOf(p))`), which means the runtime handing the invariant the
   * subjects as well as the lines.
   */
  it('is blind to a genuine newcomer assessed the full duty', async () => {
    const { checkInv24 } = await import('../../src/invariants/crowd.js');
    const { isNewcomer, LEVY_DUTY_PER_PRINCIPAL, LEVY_NOMINAL_MINOR } = await import(
      '../../src/levy/index.js'
    );
    const { minor } = await import('../../src/core/units.js');
    const { newcomer } = await import('./fixture.js');

    const nc = newcomer('p:new');
    expect(isNewcomer(nc)).toBe(true);

    // Built exactly as `inv24InputsFor` builds it, with the floor never applied.
    const lines = [
      { principal: 'p:new' as PrincipalId, amount: LEVY_DUTY_PER_PRINCIPAL, newcomerFloored: false },
      { principal: 'p:vet' as PrincipalId, amount: LEVY_DUTY_PER_PRINCIPAL, newcomerFloored: false },
    ];
    const floorEligible = new Set<PrincipalId>();
    for (const l of lines) if (l.newcomerFloored) floorEligible.add(l.principal);

    const violations = checkInv24(
      {
        totals: new Map([['con-1' as never, minor(LEVY_DUTY_PER_PRINCIPAL * 2)]]),
        assessments: lines.map((l) => ({ ...l, constellation: 'con-1' as never })),
        floorEligible,
        nominalRate: LEVY_NOMINAL_MINOR,
        seizureQueue: [],
      },
      1,
    );
    // If this ever goes non-empty, the second road landed and this test should be
    // rewritten as the regression it becomes.
    expect(violations).toEqual([]);
  });
});
