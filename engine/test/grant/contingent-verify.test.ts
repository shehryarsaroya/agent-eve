/**
 * **ADVERSARIAL VERIFICATION of the `max_contingent_liability` gate** (A6, A7, §8.1 #2).
 *
 * Written from the outside, against the engine's public surface, without reading the
 * fix's own test file for its numbers. Everything here is derived from the world the
 * runtime actually builds — never from a constant copied out of the change.
 *
 * The four questions, in order:
 *   1. is the `max_direct_loss: 0` + un-escrowable attack REFUSED, and does contingent
 *      headroom actually FALL per create (or is the accrual cosmetic and the gate
 *      defeated by repetition)?
 *   2. does an ordinary delegate acting inside both LIMITS still get to work (A5′, the
 *      over-firing direction)?
 *   3. is the number gated the number owed — recomputed independently, on escrowable
 *      AND un-escrowable kinds?
 *   4. is any amount counted as BOTH direct and contingent?
 *
 * Plus the net: INV-22's journal-vs-cache agreement across a capture/restore round trip
 * and across a tick abort, now that the contingent half of it is non-zero for the first
 * time.
 */

import { describe, expect, it } from 'vitest';
import { FREEZE_TICKS, TICKS_PER_RECKONING, setSpeed } from '../../src/core/time.js';
import type { EventId, GrantId, PrincipalId, SystemId, VentureId } from '../../src/core/types.js';
import { minor } from '../../src/core/units.js';
import { checkInv22 } from '../../src/invariants/authority.js';
import { grantsStateTable, GrantBook } from '../../src/grant/index.js';
import { storesAccount } from '../../src/ledger/index.js';
import {
  VENTURE_KINDS,
  allRoleIndices,
  electiveTotal,
  escrowRequired,
  isEscrowable,
  kindSpec,
  pinnedValue,
  type VentureRecord,
} from '../../src/venture/index.js';
import { slotClaimAt } from '../../src/observe/forecast.js';
import { commonsSystems } from '../../src/world/index.js';
import { Runtime, type PendingCorrection } from '../../src/sim/runtime.js';

const SETTLE_TICK = TICKS_PER_RECKONING - 1;
const FREEZE_TICK = SETTLE_TICK - FREEZE_TICKS;

/**
 * The kinds a delegate can actually create here. `RAID` and `SIEGE` are HOSTILE
 * (`world/commons.ts:HOSTILE_VENTURE_KINDS`) and a delegated create names the grantor,
 * whose hands stand in the Commons — so A8 refuses them at the door and they can never
 * reach the grant gate from this fixture. `BUILD` is the un-escrowable, top-yield,
 * 100%-elective kind that IS reachable, which is all the attack needs.
 */
const REACHABLE = VENTURE_KINDS.filter((k) => k !== 'RAID' && k !== 'SIEGE');

interface World {
  readonly runtime: Runtime;
  readonly grantor: PrincipalId;
  readonly delegate: PrincipalId;
  readonly fillers: readonly PrincipalId[];
  readonly stage: SystemId;
}

/** A grantor, a delegate, and four unrelated principals — enough to fill a top-yield kind. */
function world(seed: string): World {
  setSpeed('instant');
  const runtime = new Runtime({ seed });
  const stage = commonsSystems(runtime.world.map)[0];
  if (stage === undefined) throw new Error('the launch map has no Commons system');
  const grantor = 'p:vg' as PrincipalId;
  const delegate = 'p:vd' as PrincipalId;
  const fillers = ['p:vf1', 'p:vf2', 'p:vf3', 'p:vf4'] as PrincipalId[];
  for (const [i, p] of [grantor, delegate, ...fillers].entries()) {
    runtime.seat(p, `h${String(i)}`, stage);
    runtime.standing.open(p);
  }
  return { runtime, grantor, delegate, fillers, stage };
}

function submit(
  runtime: Runtime,
  principal: PrincipalId,
  verb: string,
  params: Readonly<Record<string, unknown>>,
  sequence = 0,
): void {
  const outcome = runtime.engine.submit({
    principal,
    verb,
    params,
    clientSequence: sequence,
    arrivalMs: sequence,
    decisionSource: 'LIVE',
  });
  if (!outcome.ok) throw new Error(`submit ${verb}: ${outcome.invariant} ${outcome.hint}`);
}

function runTick(runtime: Runtime): void {
  const report = runtime.runTick();
  if (report.halted) {
    throw new Error(
      `halted at tick ${String(report.tick)}: ${report.violations.map((v) => `${v.id} ${v.message}`).join(' | ')}`,
    );
  }
}

function act(
  runtime: Runtime,
  principal: PrincipalId,
  verb: string,
  params: Readonly<Record<string, unknown>>,
): PendingCorrection | null {
  submit(runtime, principal, verb, params);
  runTick(runtime);
  return runtime.takeCorrections(principal)[0] ?? null;
}

function issueGrant(w: World, direct: number, contingent: number): GrantId {
  expect(
    act(w.runtime, w.grantor, 'grant', {
      delegate: w.delegate,
      template: 'treasury-hand',
      max_direct_loss: direct,
      max_contingent_liability: contingent,
      expires_tick: SETTLE_TICK + 20,
    }),
  ).toBeNull();
  const id = w.runtime.grants.forGrantor(w.grantor)[0]?.id;
  if (id === undefined) throw new Error('the grant did not land');
  return id;
}

function delegatedCreate(
  w: World,
  params: Readonly<Record<string, unknown>>,
): PendingCorrection | null {
  return act(w.runtime, w.delegate, 'create', {
    on_behalf_of: w.grantor,
    stage: w.stage,
    ...params,
  });
}

/** Σ over every role of `role.terms.elective`, recomputed here rather than imported. */
function sigmaRoleElective(v: VentureRecord): number {
  let total = 0;
  for (const role of v.roles) total += role.terms.elective;
  return total;
}

/**
 * The engine's OWN exact worst case for the elective half, summed over the roles:
 * `slotClaimAt(role, 'p90').electiveDue`. This is the function `Runtime.electiveCeilingOf`
 * uses and the one the `elect` affordance publishes as `max_direct_loss`, and its own
 * docstring says why the pinned `role.terms.elective` may not be used for it.
 */
function p90ElectiveCeiling(v: VentureRecord): number {
  let total = 0;
  for (const i of allRoleIndices(v)) total += slotClaimAt(v, i, 'p90').electiveDue;
  return total;
}

// ── 1. THE ATTACK ────────────────────────────────────────────────────────────

describe('1. the max_direct_loss:0 + un-escrowable attack', () => {
  it('is refused for every top-yield kind at the kind’s own default value', () => {
    for (const kind of REACHABLE.filter((k) => !isEscrowable(k))) {
      const w = world(`atk-${kind}`);
      issueGrant(w, 0, 0);
      const before = w.runtime.ledger.freeBalance(storesAccount(w.grantor));
      const refusal = delegatedCreate(w, { kind, value: kindSpec(kind).baseYieldMinor });
      expect(refusal?.invariant, `${kind} was not refused`).toBe('INV-22');
      expect(refusal?.hint).toContain('contingent headroom');
      expect(w.runtime.ventures.forPrincipal(w.grantor)).toHaveLength(0);
      expect(w.runtime.ledger.freeBalance(storesAccount(w.grantor))).toBe(before);
      expect(w.runtime.grants.allSpends()).toHaveLength(0);
    }
  });

  it('contingent headroom really FALLS per create, and the (N+1)th is refused', () => {
    // The repetition test. A cosmetic accrual — a counter that never moves, or one reset
    // per act — is defeated by doing it again, so the budget is walked all the way down
    // and the step is checked against the venture that actually landed each time.
    const w = world('atk-repeat');
    const id = issueGrant(w, 0, 200_000);
    const seen: number[] = [];
    for (let n = 0; n < 5; n += 1) {
      expect(delegatedCreate(w, { kind: 'BUILD', value: 40_000 }), `create ${String(n)}`).toBeNull();
      seen.push(w.runtime.grants.headroom(id).contingent);
    }
    // Five 40 000 draws against 200 000: strictly decreasing, exactly 40 000 apart, zero at the end.
    expect(seen).toEqual([160_000, 120_000, 80_000, 40_000, 0]);
    expect(w.runtime.grants.get(id)?.spentContingent).toBe(200_000);
    expect(w.runtime.grants.allSpends()).toHaveLength(5);

    // The sixth has nowhere to go.
    const refusal = delegatedCreate(w, { kind: 'BUILD', value: 40_000 });
    expect(refusal?.invariant).toBe('INV-22');
    expect(refusal?.hint).toContain('contingent headroom of 0');
    expect(w.runtime.ventures.forPrincipal(w.grantor)).toHaveLength(5);

    // And the journal INV-22 recomputes from agrees with the row cache it just walked.
    expect(checkInv22(w.runtime.grants.all(), w.runtime.grants.allSpends(), w.runtime.engine.tick)).toEqual([]);
  });
});

// ── 2. NO FALSE REFUSALS (A5′, the other direction) ──────────────────────────

describe('2. an ordinary delegate inside both LIMITS still works', () => {
  it('creates every escrowable kind at its default value under a grant that covers both halves', () => {
    const w = world('ok-all');
    const id = issueGrant(w, 5_000_000, 5_000_000);
    let escrow = 0;
    let elective = 0;
    for (const kind of REACHABLE.filter(isEscrowable)) {
      expect(delegatedCreate(w, { kind, value: kindSpec(kind).baseYieldMinor }), kind).toBeNull();
      const v = w.runtime.ventures.forPrincipal(w.grantor).at(-1);
      if (v === undefined) throw new Error(`${kind} did not land`);
      escrow += escrowRequired(v);
      elective += sigmaRoleElective(v);
    }
    const row = w.runtime.grants.get(id);
    expect(row?.spentDirect).toBe(escrow);
    expect(row?.spentContingent).toBe(elective);
  });

  it('admits a create that lands EXACTLY on the contingent limit (the boundary is not off by one)', () => {
    const w = world('ok-exact');
    const probe = world('ok-exact-probe');
    // Learn the exact elective figure from a wide-open world, then grant precisely that.
    issueGrant(probe, 5_000_000, 5_000_000);
    expect(delegatedCreate(probe, { kind: 'HAUL', value: 12_000 })).toBeNull();
    const pv = probe.runtime.ventures.forPrincipal(probe.grantor)[0];
    if (pv === undefined) throw new Error('probe venture missing');
    const need = { direct: escrowRequired(pv), contingent: sigmaRoleElective(pv) };

    const id = issueGrant(w, need.direct, need.contingent);
    expect(delegatedCreate(w, { kind: 'HAUL', value: 12_000 })).toBeNull();
    expect(w.runtime.grants.headroom(id)).toEqual({ direct: 0, contingent: 0 });
    // One unit less on either limit and the same act is refused — so the boundary is the
    // limit itself, not the limit plus slack.
    for (const short of [
      { direct: need.direct - 1, contingent: need.contingent, expect: 'direct headroom' },
      { direct: need.direct, contingent: need.contingent - 1, expect: 'contingent headroom' },
    ]) {
      const tight = world(`ok-short-${short.expect}`);
      issueGrant(tight, short.direct, short.contingent);
      const refusal = delegatedCreate(tight, { kind: 'HAUL', value: 12_000 });
      expect(refusal?.invariant).toBe('INV-22');
      expect(refusal?.hint).toContain(short.expect);
    }
  });

  it('never charges the grant for a venture the grantor created itself', () => {
    const w = world('ok-self');
    const id = issueGrant(w, 5_000_000, 5_000_000);
    expect(act(w.runtime, w.grantor, 'create', { kind: 'HAUL', value: 12_000, stage: w.stage })).toBeNull();
    expect(w.runtime.grants.get(id)?.spentDirect).toBe(0);
    expect(w.runtime.grants.get(id)?.spentContingent).toBe(0);
    expect(w.runtime.grants.allSpends()).toHaveLength(0);
  });
});

// ── 3. IS THE NUMBER RIGHT? ──────────────────────────────────────────────────

describe('3. the charged elective total, recomputed independently', () => {
  it('equals Σ role.terms.elective on every kind at several values, and partitions the pinned value', () => {
    for (const kind of REACHABLE) {
      for (const value of [1, 4_000, kindSpec(kind).baseYieldMinor, 250_000]) {
        const w = world(`num-${kind}-${String(value)}`);
        const id = issueGrant(w, 5_000_000, 5_000_000);
        const refusal = delegatedCreate(w, { kind, value });
        expect(refusal, `${kind}@${String(value)}: ${refusal?.hint ?? ''}`).toBeNull();
        const v = w.runtime.ventures.forPrincipal(w.grantor)[0];
        if (v === undefined) throw new Error(`${kind}@${String(value)} did not land`);
        const sigma = sigmaRoleElective(v);
        expect(electiveTotal(v)).toBe(sigma);
        expect(w.runtime.grants.get(id)?.spentContingent, `${kind}@${String(value)}`).toBe(sigma);
        expect(w.runtime.grants.get(id)?.spentDirect).toBe(escrowRequired(v));
        // The two halves partition the pinned value: neither can absorb the other.
        expect(escrowRequired(v) + sigma).toBe(pinnedValue(v));
        // Un-escrowable kinds put ALL of it in the contingent half.
        if (!isEscrowable(kind)) expect(escrowRequired(v)).toBe(0);
      }
    }
  });
});

// ── 4. DOUBLE COUNTING ───────────────────────────────────────────────────────

describe('4. nothing is counted twice', () => {
  it('the ledger moves the escrow only, and the journal line splits it the same way', () => {
    const w = world('dbl');
    const id = issueGrant(w, 5_000_000, 5_000_000);
    const before = w.runtime.ledger.freeBalance(storesAccount(w.grantor));
    expect(delegatedCreate(w, { kind: 'HAUL', value: 12_000 })).toBeNull();
    const v = w.runtime.ventures.forPrincipal(w.grantor)[0];
    if (v === undefined) throw new Error('no venture');
    const escrow = escrowRequired(v);
    const elective = sigmaRoleElective(v);
    expect(escrow).toBeGreaterThan(0);
    expect(elective).toBeGreaterThan(0);
    expect(escrow).not.toBe(elective);

    // Currency moved: exactly the escrow. The contingent half is a promise; if it moved
    // value it would not be contingent.
    expect(w.runtime.ledger.freeBalance(storesAccount(w.grantor))).toBe(before - escrow);
    const spend = w.runtime.grants.allSpends()[0];
    expect(spend?.direct).toBe(escrow);
    expect(spend?.contingent).toBe(elective);
    // Neither counter absorbed the other's amount, and neither took the sum.
    expect(w.runtime.grants.get(id)?.spentDirect).not.toBe(escrow + elective);
    expect(w.runtime.grants.get(id)?.spentContingent).not.toBe(escrow + elective);
  });
});

// ── 5. INV-22 SURVIVES CAPTURE/RESTORE AND AN ABORT ──────────────────────────

describe('5. INV-22 after the new accruals', () => {
  it('round-trips through the grant state table with the contingent half intact', () => {
    const w = world('rt');
    const id = issueGrant(w, 5_000_000, 5_000_000);
    expect(delegatedCreate(w, { kind: 'HAUL', value: 12_000 })).toBeNull();
    expect(delegatedCreate(w, { kind: 'BUILD', value: 40_000 })).toBeNull();
    const live = w.runtime.grants.get(id);
    expect(live?.spentContingent).toBeGreaterThan(0);

    let restored: GrantBook | null = null;
    const table = grantsStateTable(
      () => w.runtime.grants,
      (book) => {
        restored = book;
      },
    );
    const captured = table.capture();
    // `StateTable.restore` is optional in the interface, and a table without one is a
    // hole in the abort path (`rollbackGaps`). The grant table must have it.
    if (table.restore === undefined) throw new Error('the grant table has no restore — the abort path has a gap');
    table.restore(captured);
    if (restored === null) throw new Error('restore never ran');
    const book: GrantBook = restored;
    expect(book.get(id)?.spentContingent).toBe(live?.spentContingent);
    expect(book.get(id)?.spentDirect).toBe(live?.spentDirect);
    expect(book.allSpends()).toHaveLength(2);
    // The whole point: the restored world still satisfies the invariant, from the
    // journal rather than from the cache it was handed.
    expect(checkInv22(book.all(), book.allSpends(), w.runtime.engine.tick)).toEqual([]);
    // And capture is stable across the round trip (this is what enters `state_hash`).
    expect(
      grantsStateTable(
        () => book,
        () => undefined,
      ).capture(),
    ).toEqual(captured);
  });

  it('an aborted tick rolls the contingent counter back, and INV-22 agrees afterwards', () => {
    const w = world('abort');
    const id = issueGrant(w, 5_000_000, 5_000_000);
    expect(delegatedCreate(w, { kind: 'HAUL', value: 12_000 })).toBeNull();
    const good = {
      direct: w.runtime.grants.get(id)?.spentDirect,
      contingent: w.runtime.grants.get(id)?.spentContingent,
      spends: w.runtime.grants.allSpends().length,
    };
    expect(good.contingent).toBeGreaterThan(0);

    // Force a contingent overrun that no verb can reach, exactly as the existing INV-22
    // liveness test does for the direct half. The tick must abort and put the book back.
    w.runtime.grants.recordSpend({
      grant: id,
      delegate: w.delegate,
      tick: w.runtime.engine.tick,
      eventId: 'ev:contingent-overrun' as EventId,
      direct: minor(0),
      contingent: minor(6_000_000),
    });
    const report = w.runtime.runTick();
    expect(report.halted).toBe(true);
    expect(report.violations.map((v) => v.id)).toContain('INV-22');
    expect(report.rollback).not.toBeNull();
    // Rolled back to the pre-tick capture: the forced overrun is gone and so is its line.
    expect(w.runtime.grants.get(id)?.spentContingent).toBe(good.contingent);
    expect(w.runtime.grants.get(id)?.spentDirect).toBe(good.direct);
    expect(w.runtime.grants.allSpends()).toHaveLength(good.spends);
    expect(checkInv22(w.runtime.grants.all(), w.runtime.grants.allSpends(), w.runtime.engine.tick)).toEqual([]);
  });
});

// ── 6. A13: the attack cannot render as UNUSED ───────────────────────────────

describe('6. the authority line reads both limits', () => {
  it('renders DRAWN with the contingent amount when only the contingent half moved', () => {
    const w = world('render');
    issueGrant(w, 0, 400_000);
    expect(delegatedCreate(w, { kind: 'BUILD', value: 60_000 })).toBeNull();
    while (w.runtime.engine.tick <= SETTLE_TICK) runTick(w.runtime);
    const line = w.runtime.reckoningFrame()?.authorityLines.find((l) => l.grantor === w.grantor);
    if (line === undefined) throw new Error('no authority line');
    expect(line.spent).toBe(0);
    expect(line.spentContingent).toBe(60_000);
    expect(line.grantedContingent).toBe(400_000);
    expect(line.state).toBe('DRAWN');
    expect(FREEZE_TICK).toBeLessThan(SETTLE_TICK);
  });
});

// ── 7. THE NUMBER THE GATE CHARGES vs THE NUMBER THE RECKONING ASKS FOR ──────

describe('7. KNOWN GAP — what the grant is charged vs what the Reckoning actually asks for', () => {
  /**
   * Documented gap, proven end to end. `Σ role.terms.elective` is the PINNED figure and
   * is scaled by the `value` the *delegate* chooses; the amount the settlement actually
   * asks the creator for is `claim - min(claim, escrowed)` where the claim is a share of
   * proceeds, and proceeds come from the KIND's `baseYieldMinor`, which no parameter of
   * `create` touches. So the two numbers are independent, and the delegate controls the
   * one the gate charges.
   *
   * This test pins the CURRENT behaviour and the size of the gap. It is expected to go
   * red the day the gate is charged against `slotClaimAt(..., 'p90').electiveDue` — the
   * engine's own exact worst case, which `Runtime.electiveCeilingOf` already uses and
   * whose docstring says why the pinned figure may not stand in for it.
   */
  it('GAP: a BUILD priced at 1 charges 4 of contingent headroom against a 44 000 p90 obligation', () => {
    const w = world('gap');
    const id = issueGrant(w, 0, 10);
    expect(delegatedCreate(w, { kind: 'BUILD', value: 1 })).toBeNull();
    const v = w.runtime.ventures.forPrincipal(w.grantor)[0];
    if (v === undefined) throw new Error('no venture');

    expect(sigmaRoleElective(v)).toBe(4);
    expect(w.runtime.grants.get(id)?.spentContingent).toBe(4);
    expect(w.runtime.grants.headroom(id).contingent).toBe(6);
    // The engine's own exact worst case for the same venture, from the same roles.
    expect(p90ElectiveCeiling(v)).toBe(44_000);
    expect(p90ElectiveCeiling(v)).toBeGreaterThan(sigmaRoleElective(v) * 1_000);
  });

  it('GAP: the Reckoning then writes a DECLINED default thousands of times the whole grant', () => {
    const w = world('gap-e2e');
    const id = issueGrant(w, 0, 10);
    expect(delegatedCreate(w, { kind: 'BUILD', value: 1 })).toBeNull();
    const v = w.runtime.ventures.forPrincipal(w.grantor)[0];
    if (v === undefined) throw new Error('no venture');
    const ventureId: VentureId = v.id;

    const idleOf = (p: PrincipalId): string => {
      const hand = [...w.runtime.world.hands.values()].find((h) => h.principal === p && h.state === 'IDLE');
      if (hand === undefined) throw new Error(`${p} has no idle hand`);
      return hand.id;
    };
    for (const [i, filler] of w.fillers.entries()) {
      submit(w.runtime, filler, 'fill_role', { venture: ventureId, role: i, hand: idleOf(filler) }, i);
    }
    runTick(w.runtime);
    const hash = w.runtime.ventures.require(ventureId).termsHash;
    if (hash === null) throw new Error('no terms_hash');
    for (const [i, p] of [w.grantor, ...w.fillers].entries()) {
      submit(w.runtime, p, 'sign', { venture: ventureId, terms_hash: hash }, i);
    }
    runTick(w.runtime);
    runTick(w.runtime);
    expect(w.runtime.ventures.require(ventureId).state).toBe('LIVE');

    // Nobody elects anything. Silence is a decline (PROP-V4).
    while (w.runtime.engine.tick <= SETTLE_TICK) runTick(w.runtime);
    const settlement = w.runtime.lastReckoning?.settlements.find((s) => s.venture === ventureId);
    if (settlement === undefined) throw new Error('the venture never settled');
    expect(settlement.terminalState).toBe('DEFAULTED');
    const defaulted = settlement.defaults.reduce((n, d) => n + d.amount, 0);
    for (const d of settlement.defaults) {
      expect(d.payer).toBe(w.grantor);
      expect(d.cause).toBe('DECLINED');
    }
    // The grant said the delegate could commit at most 10 of contingent liability, and
    // recorded 4 of it drawn. The permanent public default it produced is four orders of
    // magnitude larger.
    expect(w.runtime.grants.get(id)?.maxContingentLiability).toBe(10);
    expect(w.runtime.grants.get(id)?.spentContingent).toBe(4);
    expect(defaulted).toBeGreaterThan(30_000);
  }, 30_000);
});
