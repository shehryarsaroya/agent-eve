/**
 * ★ ONE OBLIGATION, ONE NUMBER — `creatorElective` against the charge `elect` makes.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * `ventures.mine[].my_elective_owed` and `elect`'s `max_direct_loss` describe the same
 * money from the same seat, so the only way they stay one number is for them to be one
 * expression. {@link electiveChargeOfRole} is that expression; `Runtime.electiveCeilingOf`
 * computes it too, and this file is what keeps the two from drifting.
 *
 * **The deferral branch is the whole reason this file exists rather than an API test.**
 * The first draft of `creatorElective` summed the bare {@link electiveCeilingOfRole} and
 * forgot `role.settledElectiveMinor` — the row §15.3's second pass pays against. On a
 * venture that has never deferred that field is 0, so **every assertion in
 * `the-record-remembers-a-live-player.spec.ts` passed**, and the row would have over-quoted
 * the affordance beside it only on the rarer branch. That is this project's defining defect
 * shape (a capability whose failure mode cannot occur in the case anybody tests), so the
 * subtraction gets a test that reaches it directly.
 * ══════════════════════════════════════════════════════════════════════════
 */

import { describe, expect, it } from 'vitest';
import { bps, minor } from '../../src/core/units.js';
import {
  IN_FULL,
  creatorElective,
  electiveCeilingOfRole,
  electiveChargeOfRole,
  maxElectiveLiability,
  recordPaid,
  roleAt,
  type Election,
} from '../../src/venture/index.js';
import { ALICE, BRAM, CASS, fill, fixture, goLive, makeHaul, share, wage } from './fixture.js';

/** Proceeds high enough that both roles carry a real elective part. */
const PROCEEDS = minor(40_000);

function liveHaul(): ReturnType<typeof makeHaul> {
  const f = fixture();
  const haul = makeHaul(f, {
    creator: ALICE,
    carrier: wage(1_000, 1_000),
    escort: share(bps(3_000), 500, 700),
  });
  goLive(f, haul, [BRAM, CASS], PROCEEDS);
  return haul;
}

/** No election stated for anybody. */
const nothing = (): Election | undefined => undefined;

describe('what the creator owes is the charge, not the pinned price', () => {
  it('sums the charge over roles somebody ELSE holds, and only those', () => {
    const haul = liveHaul();
    const expected =
      electiveChargeOfRole(haul, 0) + electiveChargeOfRole(haul, 1);
    expect(expected, 'the fixture actually has an elective half to owe').toBeGreaterThan(0);

    const owed = creatorElective(haul, ALICE, nothing);
    expect(owed.owed).toBe(expected);
    expect(owed.unelected, 'nothing is elected, so the whole charge rides on a promise').toBe(expected);

    // A role-holder owes nothing: the elective half is the CREATOR's promise (§5.1).
    expect(creatorElective(haul, BRAM, nothing)).toEqual({ owed: 0, unelected: 0, ceiling: 0 });
    expect(creatorElective(haul, CASS, nothing)).toEqual({ owed: 0, unelected: 0, ceiling: 0 });
  });

  it('is NOT the pinned `terms.elective`, and the gap is the whole point', () => {
    const haul = liveHaul();
    const pinned = haul.roles.reduce((n, r) => n + r.terms.elective, 0);
    const charged = creatorElective(haul, ALICE, nothing).owed;
    // `electiveCeilingOfRole`'s own docstring: the pinned figure is the PRICE, the ceiling is
    // the BOUND, and "the whole defect was one standing in for the other". If these ever come
    // out equal the fixture has stopped exercising a share role and the test is vacuous.
    expect(charged).not.toBe(pinned);
    expect(charged, 'a share role that over-performs owes MORE than the pinned figure').toBeGreaterThan(pinned);
  });

  it('a role the creator fills itself is never owed (scar #9)', () => {
    const f = fixture();
    const haul = makeHaul(f, { creator: ALICE, carrier: wage(1_000, 1_000), escort: share(bps(3_000), 500, 700) });
    // ALICE takes its own CARRIER slot; BRAM takes the ESCORT.
    goLive(f, haul, [ALICE, BRAM], PROCEEDS);

    const owed = creatorElective(haul, ALICE, nothing);
    expect(
      owed.owed,
      'paying yourself is booked as paid in full and can never be a breach, so quoting it would publish a ' +
        'liability the engine will never charge',
    ).toBe(electiveChargeOfRole(haul, 1));
    expect(owed.owed).toBeLessThan(
      electiveChargeOfRole(haul, 0) + electiveChargeOfRole(haul, 1),
    );
  });

  it('IN_FULL empties `unelected` and leaves `owed` alone', () => {
    const haul = liveHaul();
    const all = creatorElective(haul, ALICE, () => IN_FULL);
    expect(all.owed, 'electing does not change what can be asked for').toBe(
      creatorElective(haul, ALICE, nothing).owed,
    );
    expect(all.unelected, 'IN_FULL covers whatever the due turns out to be').toBe(0);
  });

  it('an exact amount nets against the charge, and short is still short', () => {
    const haul = liveHaul();
    const full = creatorElective(haul, ALICE, nothing).owed;
    // One minor unit on every role — the play-test's token-election shape.
    const token = creatorElective(haul, ALICE, () => minor(1));
    expect(token.owed).toBe(full);
    expect(token.unelected, 'a unit is not a payment').toBe(full - 2);
  });

  // ── ★ THE DEFERRAL BRANCH ───────────────────────────────────────────────────
  it('subtracts what a previous pass already paid, so the row cannot over-quote `elect`', () => {
    const haul = liveHaul();
    const before = creatorElective(haul, ALICE, nothing).owed;
    const ceilings = electiveCeilingOfRole(haul, 0) + electiveCeilingOfRole(haul, 1);
    expect(before, 'nothing settled yet, so charge and ceiling agree').toBe(ceilings);

    // What §15.3's first pass does to the row: `payElectiveParts` -> `recordPaid`.
    const paid = minor(300);
    recordPaid(roleAt(haul, 1), minor(0), paid);
    expect(roleAt(haul, 1).settledElectiveMinor, 'the fixture actually moved the row').toBe(paid);

    const after = creatorElective(haul, ALICE, nothing);
    expect(
      after.owed,
      'a deferred venture can only be asked for the remainder; quoting the bare ceiling would name a charge ' +
        'the engine will never make',
    ).toBe(before - paid);
    expect(
      after.owed,
      'and it must still equal `Runtime.electiveCeilingOf`, which is the same expression and is what ' +
        '`elect`’s own max_direct_loss publishes',
    ).toBe(electiveChargeOfRole(haul, 0) + electiveChargeOfRole(haul, 1));
    expect(after.unelected).toBe(after.owed);
  });

  // ── ★ THE WORST CASE, WHICH IS WHAT `sign` PUBLISHES ────────────────────────
  it('counts every OPEN role in the ceiling, because an open role can still go to a stranger', () => {
    const f = fixture();
    const haul = makeHaul(f, { creator: ALICE, carrier: wage(1_000, 1_000), escort: share(bps(3_000), 500, 700) });
    // Nothing filled: the state a creator countersigns its own venture in, and the state whose
    // `max_contingent_liability` used to be published as 0.
    const atSigning = creatorElective(haul, ALICE, nothing);
    expect(atSigning.owed, 'nobody is owed anything yet').toBe(0);
    expect(atSigning.unelected, 'and nothing can be unelected while nothing is owed').toBe(0);
    expect(
      atSigning.ceiling,
      'but the whole elective half is contingent, which is exactly what the contingent column means',
    ).toBeGreaterThan(0);
    // `maxElectiveLiability` is the create-time gate's bound over the same fully-open venture.
    // Pinned equal so the figure `sign` shows and the figure a delegated `create` is charged
    // cannot drift apart.
    expect(atSigning.ceiling).toBe(maxElectiveLiability(haul));
  });

  it('the ceiling never drops below what is already owed', () => {
    const haul = liveHaul();
    const both = creatorElective(haul, ALICE, nothing);
    expect(both.ceiling, 'fully filled by others: ceiling and owed converge').toBe(both.owed);

    const f = fixture();
    const half = makeHaul(f, { creator: ALICE, carrier: wage(1_000, 1_000), escort: share(bps(3_000), 500, 700) });
    fill(f, half, 0, BRAM);
    const partial = creatorElective(half, ALICE, nothing);
    expect(partial.owed, 'one role held').toBe(electiveChargeOfRole(half, 0));
    expect(partial.ceiling, 'plus the one still open').toBeGreaterThan(partial.owed);
  });

  it('never goes negative, however much a previous pass paid', () => {
    const haul = liveHaul();
    // More than the ceiling. `assertDeferralConsistent` halts on this at settlement, but a
    // published figure must not go negative on the way there: a negative liability reads as
    // credit, and A2 says the arithmetic an agent is shown is exact.
    recordPaid(roleAt(haul, 0), minor(0), minor(1_000_000));
    expect(electiveChargeOfRole(haul, 0)).toBe(0);
    expect(creatorElective(haul, ALICE, nothing).owed).toBe(electiveChargeOfRole(haul, 1));
  });
});
