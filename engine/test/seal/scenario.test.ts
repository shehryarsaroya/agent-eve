/**
 * The two scenario tests for this module.
 *
 * **E2E-15** — *a seal from a previous Reckoning is not re-evaluated in this one.*
 * `TESTING.md` §6, and the named regression for scar #7: High Water's `lastSay`
 * persisted across tides, so one promise was re-judged at every subsequent court
 * and ground an honest agent's reputation down for a single utterance. The
 * assertion here is therefore not only "the verdict is unchanged" but *"the count
 * does not move again, however many courts sit afterwards"*.
 *
 * **The seal branch pair** — a seal honoured, and a seal contradicted costing
 * standing, end to end: commit, deed, resolve, charge, standing, both invariants,
 * and both events read back through the real ledger filters.
 *
 * *Naming note.* This pair was assigned as `E2E-8`. In `TESTING.md` §6 `E2E-8` is
 * the Levy's quorum-failure scenario, which belongs to another module — so these
 * are named for what they assert rather than for that id, and the collision is
 * reported rather than silently resolved. Two tests with one id is a
 * one-word-two-concepts bug in the test suite (§3).
 */

import { describe, expect, it } from 'vitest';
import { compareIds } from '../../src/ledger/order.js';
import { TICKS_PER_RECKONING } from '../../src/core/time.js';
import type { Standing } from '../../src/core/types.js';
import { EventLedger } from '../../src/events/index.js';
import {
  SEAL_STANDING_SCHEDULE,
  SealBook,
  SealHalt,
  agentSealDisclosure,
  applySealStandingCharges,
  allDeedsWitness,
  checkInv20,
  checkInv21,
  sealCommitEvent,
  sealProjectionLeaks,
  sealVerdictEvent,
  sealWorldIndex,
  type Deed,
} from '../../src/seal/index.js';
import { deed, eid, intent, pid, role, settlement, zeroStanding } from './helpers.js';

const A = pid('P-VEX');
const OBSERVER = pid('P-HALCYON');

/**
 * The world this scenario happens in, attached to every book below.
 *
 * A book with no world cannot tell a target that names nothing from an act the agent
 * chose not to perform, and refuses to mark either — so a scenario about a *witnessed*
 * contradiction has to say what the world contains. That is the point of the fix, not
 * a concession to it: the two agent-supplied fields a verdict reads are checked at the
 * door, and this is the door.
 */
const WORLD = sealWorldIndex(['SYS-VEGA'], (verb) => (verb === 'haul' ? 'QTY' : null));

function newBook(): SealBook {
  return new SealBook(WORLD);
}

/** Seal in Reckoning `r`, do a deed of `outcome`, resolve at its settlement. */
function reckoning(
  book: SealBook,
  r: number,
  outcome: number | null,
  extraDeeds: readonly Deed[] = [],
): ReturnType<SealBook['resolve']> {
  const sealTick = r * TICKS_PER_RECKONING + 10;
  const held = [role(`V-${String(r)}`)];
  const accepted = book.commit({
    principal: A,
    tick: sealTick,
    stateVersion: sealTick,
    actedOnStateVersion: sealTick,
    intent: intent(),
    prose: 'The convoy holds. I will deliver between forty and sixty.',
    role: held[0] ?? null,
    rolesHeld: held,
  });
  if (!accepted.ok) throw new Error(accepted.hint);

  const deeds: Deed[] =
    outcome === null
      ? []
      : [
          deed({
            principal: A,
            tick: sealTick + 40,
            outcome,
            valuedAtStateVersion: sealTick + 40,
            eventId: eid(`ev:${String(sealTick + 40)}:0`),
          }),
        ];
  const all = [...deeds, ...extraDeeds];
  return book.resolve({
    reckoningIndex: r,
    atTick: settlement(r),
    stateVersion: settlement(r),
    deeds: all,
    // The completeness witness. `outcome === null` is an *abstention*, and the only
    // thing that separates an abstention from a query that missed A's deeds is this
    // claim — without it the seal would defer rather than being marked (§15.4).
    deedSet: allDeedsWitness(r, settlement(r), all, [A]),
  });
}

describe('a seal honoured', () => {
  it('costs nothing, moves no standing, and publishes only the flag', () => {
    const book = newBook();
    const resolution = reckoning(book, 0, 50);

    expect(resolution.verdicts.length).toBe(1);
    expect(resolution.verdicts[0]?.verdict).toBe('HONOURED');
    expect(resolution.charges).toEqual([]);

    const before = zeroStanding(A);
    const after = applySealStandingCharges(before, resolution.charges);
    expect(after).toEqual(before);
    // Nothing moved, so INV-21 holds even with no cause authorised at all.
    expect(checkInv21(before, after, [], settlement(0))).toEqual([]);
    expect(checkInv20(book, settlement(0))).toEqual([]);

    const rec = book.auditRecord(resolution.verdicts[0]!.sealId)!;
    const ledger = new EventLedger();
    const commit = ledger.append(sealCommitEvent(rec, 1));
    ledger.append(sealVerdictEvent(rec, 1, commit.event.id));

    // The whole world reads the flag at the Reckoning, and nothing more.
    const page = ledger.agentFeed({
      principal: OBSERVER,
      atTick: settlement(0),
      after: null,
      limit: 10,
    });
    const kinds = page.views.map((v) => v.event.kind).sort(compareIds);
    expect(kinds).toEqual(['SEAL_COMMITTED', 'SEAL_RESOLVED']);
    for (const view of page.views) {
      expect(sealProjectionLeaks(view.event.payload, rec)).toEqual([]);
    }
    const verdictView = page.views.find((v) => v.event.kind === 'SEAL_RESOLVED');
    expect(verdictView?.event.payload['verdict']).toBe('HONOURED');
  });
});

describe('a seal contradicted', () => {
  it('costs standing on the published schedule, with the record intact', () => {
    const book = newBook();
    const resolution = reckoning(book, 0, 5);

    expect(resolution.verdicts[0]?.verdict).toBe('CONTRADICTED');
    expect(resolution.charges.length).toBe(1);

    const before = zeroStanding(A);
    const after = applySealStandingCharges(before, resolution.charges);
    expect(after.contradictedSeals).toBe(SEAL_STANDING_SCHEDULE.contradictedSealStep);
    expect(checkInv21(before, after, ['CONTRADICTED_SEAL'], settlement(0), resolution.charges)).toEqual(
      [],
    );
    expect(checkInv20(book, settlement(0))).toEqual([]);

    // The permanent mark has an attributable cause on the audit record — the same
    // discipline INV-17 imposes on a default, applied to the other permanent mark.
    const rec = book.auditRecord(resolution.verdicts[0]!.sealId)!;
    expect(rec.citedDeedEventId).toBe('ev:50:0');
    expect(rec.basis).toBe('OUT_OF_BAND');

    // ...and none of it reaches an agent.
    const disclosure = agentSealDisclosure(rec);
    expect(disclosure.verdict).toBe('CONTRADICTED');
    expect(Object.keys(disclosure).length).toBe(4);
    expect(sealProjectionLeaks(disclosure, rec)).toEqual([]);
  });

  it('a sealed intention that simply never happened is contradicted too', () => {
    const book = newBook();
    const resolution = reckoning(book, 0, null);
    expect(resolution.verdicts[0]?.verdict).toBe('CONTRADICTED');
    const rec = book.auditRecord(resolution.verdicts[0]!.sealId)!;
    expect(rec.basis).toBe('NO_ATTRIBUTABLE_DEED');
    expect(rec.citedDeedEventId).toBeNull();
  });
});

describe('E2E-15 — a seal from a previous Reckoning is not re-evaluated', () => {
  it('one utterance is judged once, however many courts sit afterwards (scar #7)', () => {
    const book = newBook();
    let standing: Standing = zeroStanding(A);

    // Reckoning 0: contradicted. One step.
    const r0 = reckoning(book, 0, 5);
    standing = applySealStandingCharges(standing, r0.charges);
    expect(standing.contradictedSeals).toBe(1);

    const firstId = r0.verdicts[0]!.sealId;
    const afterR0 = book.auditRecord(firstId)!;

    // Reckoning 1: honoured — and Reckoning 0's deed is deliberately handed to the
    // resolver again, exactly as a naive "all deeds so far" query would.
    const r1 = reckoning(book, 1, 50, [
      deed({ principal: A, tick: 50, outcome: 5, valuedAtStateVersion: 50, eventId: eid('ev:50:0') }),
    ]);
    standing = applySealStandingCharges(standing, r1.charges);

    expect(r1.verdicts.map((v) => v.sealId)).not.toContain(firstId);
    expect(r1.charges).toEqual([]);
    expect(standing.contradictedSeals).toBe(1);

    // The old record is byte-identical: same verdict, same tick, still one evaluation.
    const stillAfterR1 = book.auditRecord(firstId)!;
    expect(stillAfterR1).toEqual(afterR0);
    expect(stillAfterR1.evaluations).toBe(1);
    expect(stillAfterR1.verdictAtTick).toBe(settlement(0));

    // Four more courts sit. The count does not move again.
    for (let r = 2; r <= 5; r += 1) {
      const later = book.resolve({
        reckoningIndex: r,
        atTick: settlement(r),
        stateVersion: settlement(r),
        deeds: [
          deed({ principal: A, tick: 50, outcome: 5, valuedAtStateVersion: 50, eventId: eid('ev:50:0') }),
        ],
      });
      expect(later.verdicts, `Reckoning ${r}`).toEqual([]);
      standing = applySealStandingCharges(standing, later.charges);
      expect(standing.contradictedSeals, `Reckoning ${r}`).toBe(1);
      expect(checkInv20(book, settlement(r))).toEqual([]);
    }

    expect(book.auditRecord(firstId)!.evaluations).toBe(1);
  });

  it('re-resolving an old Reckoning at a later court halts rather than re-judging', () => {
    const book = newBook();
    reckoning(book, 0, 5);
    // Both shapes of the mistake: the same court twice, and an old court reopened.
    expect(() =>
      book.resolve({ reckoningIndex: 0, atTick: settlement(0), stateVersion: 400, deeds: [] }),
    ).toThrow(SealHalt);
    expect(() =>
      book.resolve({ reckoningIndex: 0, atTick: settlement(1), stateVersion: 900, deeds: [] }),
    ).toThrow(SealHalt);
    expect(book.auditRecords()[0]?.evaluations).toBe(1);
  });

  it('a seal made in this Reckoning is untouched by the previous one’s resolution', () => {
    // The mirror case: resolving Reckoning 0 must not reach forward either.
    const book = newBook();
    const held = [role('V-1')];
    const later = book.commit({
      principal: A,
      tick: TICKS_PER_RECKONING + 5,
      actedOnStateVersion: TICKS_PER_RECKONING + 5,
      intent: intent(),
      prose: '',
      role: held[0] ?? null,
      rolesHeld: held,
    });
    expect(later.ok).toBe(true);

    book.resolve({
      reckoningIndex: 0,
      atTick: settlement(0),
      stateVersion: 400,
      deeds: [deed({ principal: A, outcome: 50 })],
    });
    if (later.ok) {
      const rec = book.auditRecord(later.value.sealId)!;
      expect(rec.verdict).toBeNull();
      expect(rec.evaluations).toBe(0);
    }
    expect(checkInv20(book, settlement(0))).toEqual([]);
  });
});

describe('the three layers, in order', () => {
  it('claim → seal → deed, with the gap provable against a timestamp', () => {
    // §11.1: "what it told everyone -> what it privately committed to -> what it
    // did." The public line is a lie; the seal is the pre-commitment; the deed is
    // ground truth. Nothing infers anything from the words.
    const book = newBook();
    const held = [role('V-1')];
    const claimTick = 20;
    const sealTick = 40;
    const deedTick = 90;

    const accepted = book.commit({
      principal: A,
      tick: sealTick,
      actedOnStateVersion: sealTick,
      intent: intent({ verb: 'haul', target: 'SYS-VEGA', measure: 'QTY', outcomeLow: 40, outcomeHigh: 60 }),
      prose: 'Forty to sixty, as promised.',
      role: held[0] ?? null,
      rolesHeld: held,
    });
    expect(accepted.ok).toBe(true);

    const resolution = book.resolve({
      reckoningIndex: 0,
      atTick: settlement(0),
      stateVersion: settlement(0),
      deeds: [
        deed({
          principal: A,
          tick: deedTick,
          outcome: 0,
          valuedAtStateVersion: deedTick,
          eventId: eid('ev:90:0'),
        }),
      ],
    });

    expect(claimTick).toBeLessThan(sealTick);
    expect(sealTick).toBeLessThan(deedTick);
    expect(resolution.verdicts[0]?.verdict).toBe('CONTRADICTED');

    const rec = book.auditRecord(resolution.verdicts[0]!.sealId)!;
    // The contradiction is between two typed records with two timestamps, and the
    // 140-character public line is displayed beside them, never read by the judge.
    expect(rec.sealedAtTick).toBe(sealTick);
    expect(rec.citedDeedEventId).toBe('ev:90:0');
  });
});
