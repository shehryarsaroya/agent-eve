/**
 * PROP-D3 and INV-21.
 *
 * - `PROP-D3` A contradicted seal costs standing **on the published schedule**.
 *   "Published" is what is under test: the schedule is versioned, machine-readable
 *   and stated in the sentence `agent.md` carries, because "mandatory, free *and*
 *   weightless would predict trivially-true seals and boring reveals" (§11.1).
 * - `INV-21` Standing changed only via an elective-honoured settlement, a default,
 *   a contradicted seal, or scheduled decay — **never as a side effect of anything
 *   else**.
 *
 * Note what is *not* here: any positive standing for honouring a seal. §6.4 —
 * standing accrues only to the elective part honoured. That asymmetry is what makes
 * a hedged pair of seals (adjacent bands, one guaranteed HONOURED) strictly
 * dominated, so there is no duplicate-seal rule to be farmed.
 */

import { describe, expect, it } from 'vitest';
import { compareIds } from '../../src/ledger/order.js';
import type { SealId } from '../../src/core/types.js';
import {
  SEAL_STANDING_SCHEDULE,
  SEAL_STANDING_STATEMENT,
  SealBook,
  STANDING_VECTORS,
  VECTORS_BY_CAUSE,
  applySealStandingCharges,
  chargeForContradiction,
  checkInv21,
  type StandingCause,
} from '../../src/seal/index.js';
import { deed, intent, pid, role, settlement, zeroStanding } from './helpers.js';

const A = pid('P-A');
const B = pid('P-B');

function sealAndResolve(outcome: number): ReturnType<SealBook['resolve']> {
  const book = new SealBook();
  const held = [role('V-1')];
  const accepted = book.commit({
    principal: A,
    tick: 100,
    actedOnStateVersion: 100,
    intent: intent(),
    prose: 'as agreed',
    role: held[0] ?? null,
    rolesHeld: held,
  });
  if (!accepted.ok) throw new Error(accepted.hint);
  return book.resolve({
    reckoningIndex: 0,
    atTick: settlement(0),
    stateVersion: 400,
    deeds: [deed({ principal: A, outcome })],
  });
}

describe('PROP-D3 — the published schedule', () => {
  it('is versioned and machine-readable, so an agent can price its own seal (A2)', () => {
    expect(SEAL_STANDING_SCHEDULE.version).toBe(1);
    expect(SEAL_STANDING_SCHEDULE.contradictedSealStep).toBe(1);
  });

  it('is stated in the sentence agent.md carries verbatim (scar #1)', () => {
    // The LLM-facing text is part of the rules surface. If this sentence and the
    // engine disagree, no unit test catches it — which is exactly what happened.
    expect(SEAL_STANDING_STATEMENT).toContain('CONTRADICTED');
    expect(SEAL_STANDING_STATEMENT).toContain('never again');
    expect(SEAL_STANDING_STATEMENT).toContain('nothing else');
  });

  it('a contradicted seal raises exactly one charge, priced at the schedule', () => {
    const resolution = sealAndResolve(5);
    expect(resolution.verdicts[0]?.verdict).toBe('CONTRADICTED');
    expect(resolution.charges.length).toBe(1);
    const charge = resolution.charges[0]!;
    expect(charge.cause).toBe('CONTRADICTED_SEAL');
    expect(charge.principal).toBe(A);
    expect(charge.contradictedSealsDelta).toBe(SEAL_STANDING_SCHEDULE.contradictedSealStep);
    expect(charge.scheduleVersion).toBe(SEAL_STANDING_SCHEDULE.version);
    expect(charge.reckoningIndex).toBe(0);
  });

  it('an honoured seal raises no charge, and earns nothing either', () => {
    const resolution = sealAndResolve(50);
    expect(resolution.verdicts[0]?.verdict).toBe('HONOURED');
    expect(resolution.charges).toEqual([]);
  });

  it('the charge carries no seal content — standing is PUBLIC', () => {
    // A charge that named the cited deed would narrow the sealed verb and target
    // to that deed's, on a fixed lag. That is PROP-D2 by another route.
    const charge = sealAndResolve(5).charges[0]!;
    expect(Object.keys(charge).sort(compareIds)).toEqual([
      'cause',
      'contradictedSealsDelta',
      'principal',
      'reckoningIndex',
      'scheduleVersion',
      'sealId',
    ]);
    expect(JSON.stringify(charge)).not.toContain('SYS-VEGA');
  });

  it('N contradictions move the vector by N steps, exactly', () => {
    const charges = [1, 2, 3].map((i) =>
      chargeForContradiction(A, `seal:P-A:0:000${String(i)}` as SealId, 0),
    );
    const before = zeroStanding(A);
    const after = applySealStandingCharges(before, charges);
    expect(after.contradictedSeals).toBe(3 * SEAL_STANDING_SCHEDULE.contradictedSealStep);
    expect(checkInv21(before, after, ['CONTRADICTED_SEAL'], 287, charges)).toEqual([]);
  });

  it('refuses to apply another principal’s charge (scar #14a)', () => {
    const charge = chargeForContradiction(B, 'seal:P-B:0:0000' as SealId, 0);
    expect(() => applySealStandingCharges(zeroStanding(A), [charge])).toThrow(/P-B/);
  });
});

describe('INV-21 — standing moves only by a named cause', () => {
  it('names exactly the four causes, and a contradicted seal owns exactly one vector', () => {
    const causes = Object.keys(VECTORS_BY_CAUSE).sort(compareIds);
    expect(causes).toEqual(['CONTRADICTED_SEAL', 'DECAY', 'DEFAULT', 'ELECTIVE_HONOURED']);
    expect([...VECTORS_BY_CAUSE.CONTRADICTED_SEAL]).toEqual(['contradictedSeals']);
  });

  it('a contradicted-seal charge moves nothing else', () => {
    const before = zeroStanding(A);
    const charges = sealAndResolve(5).charges;
    const after = applySealStandingCharges(before, charges);
    for (const vector of STANDING_VECTORS) {
      if (vector === 'contradictedSeals') continue;
      expect(after[vector], vector).toBe(before[vector]);
    }
    expect(checkInv21(before, after, ['CONTRADICTED_SEAL'], 287, charges)).toEqual([]);
  });

  it('with no cause offered, any movement is a violation', () => {
    const before = zeroStanding(A);
    const after = { ...before, contradictedSeals: 1 };
    const v = checkInv21(before, after, [], 287);
    expect(v.length).toBe(1);
    expect(v[0]?.id).toBe('INV-21');
    expect(v[0]?.message).toContain('no authorising cause');
  });

  it('catches a side effect: a default counted under a seal’s authority', () => {
    const before = zeroStanding(A);
    const after = { ...before, contradictedSeals: 1, defaults: 1 };
    const v = checkInv21(before, after, ['CONTRADICTED_SEAL'], 287);
    expect(v.length).toBe(1);
    expect(v[0]?.message).toContain('defaults moved');
  });

  it('catches the wrong magnitude — the schedule is arithmetic, not a vibe', () => {
    const before = zeroStanding(A);
    const charges = [chargeForContradiction(A, 'seal:P-A:0:0000' as SealId, 0)];
    const after = { ...before, contradictedSeals: 2 };
    const v = checkInv21(before, after, ['CONTRADICTED_SEAL'], 287, charges);
    expect(v.length).toBe(1);
    expect(v[0]?.message).toContain('must move by 1');
  });

  it('catches a charge priced at a stale schedule version', () => {
    const before = zeroStanding(A);
    const charge = { ...chargeForContradiction(A, 'seal:P-A:0:0000' as SealId, 0), scheduleVersion: 0 };
    const after = { ...before, contradictedSeals: 1 };
    const v = checkInv21(before, after, ['CONTRADICTED_SEAL'], 287, [charge]);
    expect(v.map((x) => x.message).join(' ')).toContain('schedule version 0');
  });

  it('catches a standing row that changed principal', () => {
    const v = checkInv21(zeroStanding(A), zeroStanding(B), ['DECAY'], 287);
    expect(v.length).toBe(1);
    expect(v[0]?.message).toContain('changed principal');
  });

  it('permits decay to move any vector, and only decay may lower a mark', () => {
    const before = { ...zeroStanding(A), contradictedSeals: 4, electiveHonoured: 9 };
    const after = { ...before, contradictedSeals: 2, electiveHonoured: 4 };
    expect(checkInv21(before, after, ['DECAY'], 287)).toEqual([]);

    // Under a seal's authority: `electiveHonoured` is not its vector at all, and
    // `contradictedSeals` is — but a contradicted seal costs standing and never
    // credits it, so the fall is a violation too. Two complaints, one each.
    const v = checkInv21(before, after, ['CONTRADICTED_SEAL'], 287);
    expect(v.length).toBe(2);
    expect(v.map((x) => x.message).join(' ')).toContain('no authorising cause');
    expect(v.map((x) => x.message).join(' ')).toContain('only scheduled decay lowers');
  });

  it('a mark cannot be quietly forgiven under any cause but decay', () => {
    const before = { ...zeroStanding(A), defaults: 2, lastDefaultTick: 100 };
    expect(
      checkInv21(before, { ...before, defaults: 1 }, ['DEFAULT'], 287).map((x) => x.id),
    ).toEqual(['INV-21']);
    // Erasing the stamp is the same failure with a null instead of a smaller number.
    expect(
      checkInv21(before, { ...before, lastDefaultTick: null }, ['DEFAULT'], 287).length,
    ).toBe(1);
    // Forward is fine: a new default stamps a later tick.
    expect(
      checkInv21(before, { ...before, defaults: 3, lastDefaultTick: 287 }, ['DEFAULT'], 287),
    ).toEqual([]);
  });

  it('permits a real settlement and a real default under their own causes', () => {
    const before = zeroStanding(A);
    const honoured = { ...before, electiveHonoured: 1, distinctCounterparties: 1 };
    expect(checkInv21(before, honoured, ['ELECTIVE_HONOURED'], 287)).toEqual([]);
    const defaulted = { ...before, defaults: 1, lastDefaultTick: 287 };
    expect(checkInv21(before, defaulted, ['DEFAULT'], 287)).toEqual([]);
    // ...and not under each other's.
    expect(checkInv21(before, honoured, ['DEFAULT'], 287).length).toBe(2);
  });

  it('every INV-21 cause is one of the four the invariant names', () => {
    const declared: readonly StandingCause[] = [
      'ELECTIVE_HONOURED',
      'DEFAULT',
      'CONTRADICTED_SEAL',
      'DECAY',
    ];
    expect(Object.keys(VECTORS_BY_CAUSE).sort(compareIds)).toEqual([...declared].sort(compareIds));
  });
});
