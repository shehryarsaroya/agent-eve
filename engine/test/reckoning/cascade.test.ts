/**
 * `E2E-13` — the cascade defers, never defaults, and cannot be looped as a
 * denial-of-settlement.
 *
 * > `E2E-13` Circular obligations exceed the cascade round limit → the obligation
 * > **DEFERS** to the next Reckoning and no breach is recorded. Then assert a rival cannot
 * > construct a deferral loop as a denial-of-settlement. — TESTING.md §6
 *
 * > `AGT-X9` **Denial of settlement.** "Prevent someone else's venture from settling."
 * > Target: `E2E-13`, cascade abuse. — TESTING.md §11
 *
 * `test/venture/slice.test.ts` asserts the settlement half of this: which venture defers,
 * that it records no breach, that the bound terminates. What only the driver can show is
 * the half AGT-X9 actually asks about — **the Reckoning still commits**. A deferral that
 * halted the tick, or that left a hand pinned, or that stopped the other three ventures
 * settling, would be a denial of settlement no matter how carefully the venture module
 * refused to write a default.
 */

import { describe, expect, it } from 'vitest';
import { bps, minor } from '../../src/core/units.js';
import { CURRENCY_FAUCET, storesAccount } from '../../src/ledger/index.js';
import {
  CASCADE_ROUND_LIMIT,
  MAX_DEFERRALS,
  VENTURE_EVENT_KINDS,
  computeClaims,
  type Election,
} from '../../src/venture/index.js';
import {
  ALICE,
  BRAM,
  CASS,
  DOV,
  ESK,
  FREEZE_TICK,
  SETTLE_TICK,
  ev,
  fixture,
  freeze,
  goLive,
  makeHaul,
  planFor,
  run,
  share,
  vid,
  wage,
  type Fix,
} from './fixture.js';
import type { ObligationPlan } from '../../src/reckoning/index.js';

const ESCROWED = 100;
const ELECTIVE = 5_000;

/**
 * A four-venture payment chain whose dependency order is the **reverse** of `venture_id`
 * order, so within-round propagation cannot help it.
 *
 *   `v-a`'s creator is paid by `v-b` · `v-b`'s by `v-c` · `v-c`'s by `v-d` · `v-d`'s
 *   creator is the only one that starts with money.
 *
 * Round 1 can only settle `v-d`; round 2 settles `v-c`; round 3 settles `v-b` — and `v-a`
 * is still unpaid when the round limit stops the loop **with progress still being made**.
 * That is §15.3's truncation, and the state in which a default would be the engine's fault.
 */
function chain(f: Fix, firstDeferrals = 0): readonly ObligationPlan[] {
  f.ledger.issueCurrency({
    eventId: ev('fund::chain-head'),
    tick: 0,
    faucet: CURRENCY_FAUCET.STARTER_STAKE,
    to: storesAccount(DOV),
    amount: minor(ELECTIVE),
  });

  const links = [
    ['v-a', ALICE, ESK, BRAM],
    ['v-b', BRAM, ALICE, CASS],
    ['v-c', CASS, BRAM, DOV],
    ['v-d', DOV, CASS, ESK],
  ] as const;

  const plans: ObligationPlan[] = [];
  for (const [id, creator, carrier, escort] of links) {
    const haul = makeHaul(f, {
      id: vid(id),
      creator,
      carrier: wage(ESCROWED, ELECTIVE),
      // Escrowed 0 on the escort, so the escrow requirement is exactly ESCROWED.
      escort: share(bps(3_000), 0, 500),
    });
    goLive(f, haul, [carrier, escort], minor(0));
    const elections = new Map<number, Election>();
    for (const r of computeClaims(haul, minor(0)).roles) {
      if (r.electiveDue > 0) elections.set(r.roleIndex, r.electiveDue);
    }
    plans.push(planFor(haul, { proceeds: minor(0), elections }));
  }
  const head = f.book.require(vid('v-a'));
  head.deferrals = firstDeferrals;
  return plans;
}

describe('E2E-13 — the truncated cascade defers', () => {
  it('defers the unresolved link, records no breach, and STILL COMMITS', () => {
    const f = fixture(minor(ESCROWED));
    const outcome = run(f, freeze(f, chain(f)));

    // The clause AGT-X9 is really about: a deferral is not an outage. A rival that can
    // make the Reckoning halt has stopped everybody's settlement, whatever the venture
    // module wrote.
    expect(outcome.transaction.committed).toBe(true);
    expect(outcome.report?.violations).toEqual([]);
    expect(f.controller.status).toBe('RUNNING');
    expect(f.controller.publishedTick).toBe(SETTLE_TICK);

    expect(outcome.roundsUsed).toBeLessThanOrEqual(CASCADE_ROUND_LIMIT);
    expect(outcome.truncated).toBe(true);
    const deferred = outcome.settlements.filter((s) => s.terminalState === 'DEFERRED');
    expect(deferred.map((s) => s.venture)).toEqual(['v-a']);
    // §15.3: "it never defaults." Not in the settlement, not in the register, not in
    // standing.
    expect(outcome.defaults).toEqual([]);
    expect(f.register.size).toBe(0);
    expect(f.standing.row(ALICE).defaults).toBe(0);
  });

  it('publishes a deferral row that the feed cannot mistake for a default', () => {
    const f = fixture(minor(ESCROWED));
    const outcome = run(f, freeze(f, chain(f)));
    const receipt = outcome.receipts.find((r) => r.venture === 'v-a');
    const row = f.events.get(receipt?.settledEventId ?? ('' as never));

    expect(row?.event.kind).toBe(VENTURE_EVENT_KINDS.deferred);
    expect(row?.event.kind).not.toBe(VENTURE_EVENT_KINDS.defaulted);
    expect(receipt?.defaults).toEqual([]);
    // The kind is what a feed filters on, so this is the distinction that has to hold in
    // the record rather than in a payload nuance.
    const kinds = f.events
      .eventsAtTick(SETTLE_TICK)
      .map((r) => r.event.kind)
      .filter((k) => k === VENTURE_EVENT_KINDS.defaulted);
    expect(kinds).toEqual([]);
  });

  it('the other three links settle: a deferral is not contagious', () => {
    const f = fixture(minor(ESCROWED));
    const outcome = run(f, freeze(f, chain(f)));
    expect(
      outcome.settlements.filter((s) => s.terminalState === 'SETTLED').map((s) => s.venture),
    ).toEqual(['v-b', 'v-c', 'v-d']);
  });

  it('frees the deferred venture s hands, so a loop cannot pin a competitor s presence', () => {
    const f = fixture(minor(ESCROWED));
    run(f, freeze(f, chain(f)));
    const head = f.book.require(vid('v-a'));
    expect(head.state).toBe('DEFERRED');
    for (const role of head.roles) {
      if (role.filledByHandId === null) continue;
      expect(f.book.commitmentOf(role.filledByHandId)).toBeNull();
      // And the hand is free to be filled again, which is what makes the release real.
      expect(f.world.hands.get(role.filledByHandId)?.state).toBe('IDLE');
    }
  });

  it('the deferral carries over in the obligation book while the lock does not', () => {
    const f = fixture(minor(ESCROWED));
    run(f, freeze(f, chain(f)));
    // §15.3: the obligation returns next Reckoning, so it stays live; the encumbrance is
    // released, or a loop becomes a way to freeze a competitor's capital.
    expect(f.obligations.isLive(vid('v-a'))).toBe(true);
    expect(f.obligations.isLive(vid('v-d'))).toBe(false);
    for (const enc of f.ledger.encumbrances.open()) {
      expect(enc.obligationRef).not.toBe('v-a');
    }
  });

  it('at the deferral bound the value is an unattributed loss, never a default', () => {
    const f = fixture(minor(ESCROWED));
    const outcome = run(f, freeze(f, chain(f, MAX_DEFERRALS)));

    expect(outcome.transaction.committed).toBe(true);
    // No third deferral: the bound is what stops a rival constructing a deferral loop as
    // a denial-of-settlement.
    expect(outcome.settlements.some((s) => s.terminalState === 'DEFERRED')).toBe(false);
    expect(outcome.unattributed).toBeGreaterThan(0);
    // A5': the engine knows the value is unpaid and knows it cannot say why, so it
    // publishes a loss and leaves reputation alone.
    expect(outcome.defaults).toEqual([]);
    expect(f.standing.row(ALICE).defaults).toBe(0);

    const receipt = outcome.receipts.find((r) => r.venture === 'v-a');
    expect(receipt?.lossEventIds.length).toBeGreaterThan(0);
    const loss = f.events.get(receipt?.lossEventIds[0] ?? ('' as never));
    expect(loss?.event.payload['isDefault']).toBe(false);
    expect(loss?.event.payload['atDeferralBound']).toBe(true);
  });

  it('the freeze refuses a partial settlement set', () => {
    // A due obligation left out of the set would settle next Reckoning at the earliest,
    // with no receipt and no explanation — the mirror of the bug `checkUnjudgedSeals`
    // exists for. Refused at the freeze, where it is a caller bug and not yet a lie.
    const f = fixture(minor(ESCROWED));
    const plans = chain(f);
    const head = plans[0];
    if (head === undefined) throw new Error('fixture');
    // Derived from the fixture's own freeze tick, never written as a number. The tick in
    // the sentence is where `freezeReckoning` was *called* — the freeze, `FREEZE_TICKS`
    // before settlement — and this assertion read `287` while the freeze and the
    // settlement were the same tick, which is precisely how a hardcoded phase survives a
    // rename of the thing it is naming.
    expect(() => freeze(f, [head])).toThrow(
      new RegExp(`is due at tick ${String(FREEZE_TICK)} with no resolution plan`),
    );
  });

  it('a payer that is simply broke defaults rather than deferring', () => {
    // The distinction that closes the grief loop. With one venture in the batch the head
    // makes no progress in round 2, so the loop exits on "nothing moved" — and a shortfall
    // with no new money possible is the payer's own and is attributable.
    const f = fixture(minor(ESCROWED));
    const haul = makeHaul(f, {
      id: vid('v-a'),
      creator: ALICE,
      carrier: wage(ESCROWED, ELECTIVE),
      escort: share(bps(3_000), 0, 500),
    });
    goLive(f, haul, [ESK, BRAM], minor(0));
    const elections = new Map<number, Election>();
    for (const r of computeClaims(haul, minor(0)).roles) {
      if (r.electiveDue > 0) elections.set(r.roleIndex, r.electiveDue);
    }
    const outcome = run(f, freeze(f, [planFor(haul, { proceeds: minor(0), elections })]));

    expect(outcome.transaction.committed).toBe(true);
    expect(outcome.truncated).toBe(false);
    expect(outcome.settlements[0]?.terminalState).toBe('DEFAULTED');
    expect(outcome.defaults).toHaveLength(1);
    expect(outcome.defaults[0]?.cause).toBe('ELAPSED_WINDOW');
    expect(f.events.get(outcome.defaults[0]?.defaultEventId ?? ('' as never))?.event.parentEventId).toBe(
      outcome.defaults[0]?.causeEventId,
    );
  });
});
