/**
 * **`max_contingent_liability`, gated, accrued and rendered** (SPEC §8.1 #2, A6, A7).
 *
 * A6 is the core loop and its headline promise is one sentence: *"`max_direct_loss` and
 * `max_contingent_liability` are shown before you sign."* The second half of that
 * sentence was false as built, and this file is the proof it no longer is.
 *
 * ── THE ATTACK, EXACTLY ─────────────────────────────────────────────────────
 * Every role a venture creates carries an **elective** part, and the top-yield kinds are
 * legally un-escrowable (`kinds.ts:isEscrowable`), i.e. **100% elective**. So:
 *
 *   1. G grants D authority with `max_direct_loss: 0`. The worst case G was shown: ZERO.
 *   2. D creates un-escrowable `BUILD`/`SIEGE` ventures `on_behalf_of` G. Required escrow
 *      is 0, so the old gate's `required > headroom.direct` was `0 > 0` — false — and the
 *      create PASSED at zero headroom.
 *   3. Nothing was recorded: the one `recordSpend` call site wrote `contingent: minor(0)`,
 *      so INV-22 saw a clean grant and the authority line rendered `UNUSED`.
 *   4. At the Reckoning G — which need not have woken, at 16 wakes a day — is asked for
 *      the whole elective total in its own name. Paying costs more than every number it
 *      was shown; staying silent is a decline, which is a **permanent public default**.
 *
 * The fix is the shape escrow already had: derive the elective total from the terms the
 * venture is actually created with, gate it against CONTINGENT headroom, accrue it as
 * contingent spend, and draw it.
 *
 * ── A5′, IN BOTH DIRECTIONS ─────────────────────────────────────────────────
 * A gate that over-fires is the same class of bug as one that under-fires: refusing a
 * delegate for an obligation it did not create is as wrong as letting a grantor be
 * recorded as defaulting on one it never authorised. Both directions are asserted here.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  FREEZE_TICKS,
  TICKS_PER_RECKONING,
  setSpeed,
} from '../../src/core/time.js';
import type { EventId, GrantId, PrincipalId, SystemId } from '../../src/core/types.js';
import { UnitError, minor } from '../../src/core/units.js';
import { MAX_GRANT_SPENDS } from '../../src/grant/index.js';
import { checkInv22, type GrantSpend } from '../../src/invariants/authority.js';
import { storesAccount } from '../../src/ledger/index.js';
import { electiveTotal, escrowRequired, pinnedValue } from '../../src/venture/index.js';
import { commonsSystems } from '../../src/world/index.js';
import { buildObservation } from '../../src/api/observe.js';
import { Runtime, type PendingCorrection } from '../../src/sim/runtime.js';

const SETTLE_TICK = TICKS_PER_RECKONING - 1;
const FREEZE_TICK = SETTLE_TICK - FREEZE_TICKS;

interface World {
  readonly runtime: Runtime;
  readonly grantor: PrincipalId;
  readonly delegate: PrincipalId;
  readonly stage: SystemId;
}

function world(seed: string): World {
  setSpeed('instant');
  const runtime = new Runtime({ seed });
  const stage = commonsSystems(runtime.world.map)[0];
  if (stage === undefined) throw new Error('the launch map has no Commons system');
  const grantor = 'p:grantor' as PrincipalId;
  const delegate = 'p:delegate' as PrincipalId;
  runtime.seat(grantor, 'grantor', stage);
  runtime.seat(delegate, 'delegate', stage);
  runtime.standing.open(grantor);
  runtime.standing.open(delegate);
  return { runtime, grantor, delegate, stage };
}

/** Submit one act, run the tick, return the refusal (via the correction channel) or null. */
function act(
  runtime: Runtime,
  principal: PrincipalId,
  verb: string,
  params: Readonly<Record<string, unknown>>,
): PendingCorrection | null {
  const outcome = runtime.engine.submit({
    principal,
    verb,
    params,
    clientSequence: 0,
    arrivalMs: 0,
    decisionSource: 'LIVE',
  });
  if (!outcome.ok) throw new Error(`submit ${verb} refused at the door: ${outcome.invariant} ${outcome.hint}`);
  const report = runtime.runTick();
  if (report.halted) {
    throw new Error(
      `${verb} halted the world at tick ${String(report.tick)}: ` +
        report.violations.map((v) => `${v.id} ${v.message}`).join(' | '),
    );
  }
  return runtime.takeCorrections(principal)[0] ?? null;
}

/**
 * Issue a grant with the stated LIMITS and return its id.
 *
 * `expiresTick` defaults past this Reckoning's settlement on purpose: the frame drops
 * dead-expired grants, so a shorter default would make the A13 tests below assert
 * against an empty list and pass for the wrong reason.
 */
function grant(
  w: World,
  limits: { direct: number; contingent: number; expiresTick?: number },
): GrantId {
  const refusal = act(w.runtime, w.grantor, 'grant', {
    delegate: w.delegate,
    // `steward`, not `treasury-hand`: this fixture's delegate does a delegated `create`, and since
    // `RULES_VERSION` 23 a template is an enforced FENCE rather than a label — a treasury-hand
    // carries `elect` only. The office named here now has to be one that carries the verb the
    // case exercises, which is the whole point of the change.
    template: 'steward',
    max_direct_loss: limits.direct,
    max_contingent_liability: limits.contingent,
    expires_tick: limits.expiresTick ?? SETTLE_TICK + 10,
  });
  expect(refusal).toBeNull();
  const id = w.runtime.grants.forGrantor(w.grantor)[0]?.id;
  if (id === undefined) throw new Error('grant did not land');
  return id;
}

function createOnBehalf(
  w: World,
  params: Readonly<Record<string, unknown>>,
): PendingCorrection | null {
  return act(w.runtime, w.delegate, 'create', {
    on_behalf_of: w.grantor,
    stage: w.stage,
    ...params,
  });
}

describe('the un-escrowable attack: max_direct_loss 0 buys unbounded contingent liability', () => {
  it('is REFUSED, and the refusal names the rule, both numbers and which limit (A6, §8.1 #2)', () => {
    const w = world('c-attack');
    // The grant an owner would read as "this delegate can cost me nothing".
    const id = grant(w, { direct: 0, contingent: 0 });
    const before = w.runtime.ledger.freeBalance(storesAccount(w.grantor));

    // BUILD is top-yield, therefore legally un-escrowable, therefore 100% elective.
    // Required escrow is 0, which is why `required > headroom.direct` (0 > 0) let this
    // through at zero headroom and recorded nothing.
    const refusal = createOnBehalf(w, { kind: 'BUILD', value: 40_000 });

    expect(refusal?.invariant).toBe('INV-22');
    const hint = refusal?.hint ?? '';
    // It is a rules surface: the amount required, the headroom, the limit, the reason.
    expect(hint).toContain('40000'); // the elective total that was required
    expect(hint).toContain('contingent headroom of 0');
    expect(hint).toContain('max_contingent_liability 0');
    expect(hint).toContain('legally un-escrowable');
    expect(hint).toContain('permanent public default');

    // And the world is untouched: no venture in the grantor's name, no value moved, no
    // draw recorded. The gate runs before anything mutates.
    expect(w.runtime.ventures.forPrincipal(w.grantor)).toHaveLength(0);
    expect(w.runtime.ledger.freeBalance(storesAccount(w.grantor))).toBe(before);
    expect(w.runtime.grants.get(id)?.spentContingent).toBe(0);
    expect(w.runtime.grants.get(id)?.spentDirect).toBe(0);
    expect(w.runtime.grants.allSpends()).toHaveLength(0);
  });

  it('is refused even when DIRECT headroom is enormous — the two limits are separate budgets', () => {
    // The half of the defect that survives a cautious grantor: plenty of direct headroom
    // says nothing about how much unsecured promise a delegate may make in your name.
    const w = world('c-separate');
    grant(w, { direct: 10_000_000, contingent: 100 });
    const refusal = createOnBehalf(w, { kind: 'BUILD', value: 40_000 });
    expect(refusal?.invariant).toBe('INV-22');
    expect(refusal?.hint).toContain('contingent headroom of 100');
    expect(w.runtime.ventures.forPrincipal(w.grantor)).toHaveLength(0);
  });

  it('is ALLOWED once the grantor actually authorises the liability — the gate is a bound, not a ban', () => {
    // The other direction of A5′: a delegate must not be refused for an obligation the
    // grantor did in fact authorise. A guard that only ever says no is not a guard.
    const w = world('c-allowed');
    const id = grant(w, { direct: 0, contingent: 40_000 });
    expect(createOnBehalf(w, { kind: 'BUILD', value: 40_000 })).toBeNull();

    const v = w.runtime.ventures.forPrincipal(w.grantor)[0];
    expect(v?.creator).toBe(w.grantor);
    // Exactly consumed, to the minor unit: nothing rounded, nothing left over.
    expect(w.runtime.grants.get(id)?.spentContingent).toBe(40_000);
    expect(w.runtime.grants.headroom(id).contingent).toBe(0);
  });
});

describe('the elective total is accrued as contingent spend, and the split is honest', () => {
  it('records escrow as DIRECT and the elective tail as CONTINGENT, neither counted as the other', () => {
    const w = world('c-split');
    const id = grant(w, { direct: 250_000, contingent: 250_000 });
    const before = w.runtime.ledger.freeBalance(storesAccount(w.grantor));
    expect(createOnBehalf(w, { kind: 'HAUL', value: 12_000 })).toBeNull();

    const v = w.runtime.ventures.forPrincipal(w.grantor)[0];
    if (v === undefined) throw new Error('the venture did not land');
    // Derived from the venture that actually exists, never re-guessed from kind+value.
    const escrow = escrowRequired(v);
    const elective = electiveTotal(v);
    // A HAUL is escrowable, so this is the interesting case: both halves are non-zero
    // and different, which is what makes a swap or a double-count visible.
    expect(escrow).toBeGreaterThan(0);
    expect(elective).toBeGreaterThan(0);
    expect(escrow).not.toBe(elective);
    expect(escrow + elective).toBe(pinnedValue(v));

    const row = w.runtime.grants.get(id);
    expect(row?.spentDirect).toBe(escrow);
    expect(row?.spentContingent).toBe(elective);

    // One journal line carrying both halves — INV-22's source of truth.
    const spends = w.runtime.grants.allSpends().filter((s) => s.grant === id);
    expect(spends).toHaveLength(1);
    expect(spends[0]?.direct).toBe(escrow);
    expect(spends[0]?.contingent).toBe(elective);
    expect(spends[0]?.delegate).toBe(w.delegate);

    // The ledger moved the DIRECT half only. Contingent liability is a promise, not a
    // transfer — if it moved value it would not be contingent.
    expect(w.runtime.ledger.freeBalance(storesAccount(w.grantor))).toBe(before - escrow);

    // And BOTH halves are on the permanent record. A7 requires the priced unsecured tail
    // to be displayed; a formation receipt carrying only `escrowed` would describe an
    // un-escrowable venture as one with nothing at stake, and the receipt reel (§14) is
    // read back from these rows.
    const formed = w.runtime.events
      .transcript(`venture::${v.id}`, w.runtime.engine.tick, { kind: 'VIEWER' })
      .filter((row) => row.event.kind === 'venture.formed');
    expect(formed).toHaveLength(1);
    expect(formed[0]?.event.payload['escrowed']).toBe(escrow);
    expect(formed[0]?.event.payload['elective']).toBe(elective);
  });

  it('the grantor watches BOTH headrooms fall in its own observation (A6 is visible or it is nothing)', () => {
    const w = world('c-observe');
    const id = grant(w, { direct: 250_000, contingent: 250_000 });
    expect(createOnBehalf(w, { kind: 'HAUL', value: 12_000 })).toBeNull();

    const v = w.runtime.ventures.forPrincipal(w.grantor)[0];
    if (v === undefined) throw new Error('the venture did not land');
    const observation = buildObservation({
      runtime: w.runtime,
      principal: w.grantor,
      serverNowMs: 0,
      fresh: true,
      wakesRemaining: 16,
      stale: false,
      corrections: [],
      actionsRemaining: 4,
    }) as unknown as { grants: { granted: Record<string, unknown>[] } };
    const row = observation.grants.granted[0];
    expect(row?.['id']).toBe(id);
    expect(row?.['spent_contingent']).toBe(electiveTotal(v));
    expect(row?.['headroom_contingent']).toBe(250_000 - electiveTotal(v));
    expect(row?.['spent_direct']).toBe(escrowRequired(v));
  });

  it('accrues cumulatively: two creates exhaust the contingent limit and the third is refused', () => {
    // Per-act limits are not the promise; §8.1 #2 says the LIMITS are "over the
    // composite". A budget that reset every act would be no budget at all.
    const w = world('c-cumulative');
    const id = grant(w, { direct: 0, contingent: 100_000 });
    expect(createOnBehalf(w, { kind: 'BUILD', value: 40_000 })).toBeNull();
    expect(createOnBehalf(w, { kind: 'BUILD', value: 40_000 })).toBeNull();
    expect(w.runtime.grants.get(id)?.spentContingent).toBe(80_000);

    const refusal = createOnBehalf(w, { kind: 'BUILD', value: 40_000 });
    expect(refusal?.invariant).toBe('INV-22');
    expect(refusal?.hint).toContain('contingent headroom of 20000');
    expect(refusal?.hint).toContain('already spent 80000');
    expect(w.runtime.ventures.forPrincipal(w.grantor)).toHaveLength(2);
  });

  it('INV-22 stays consistent across the accrual — the journal and the row caches agree', () => {
    // The accrual's own net. If the row cache moved and the journal did not (or the two
    // were written with different arithmetic), the world halts at tick close.
    const w = world('c-inv22');
    grant(w, { direct: 250_000, contingent: 250_000 });
    expect(createOnBehalf(w, { kind: 'HAUL', value: 12_000 })).toBeNull();
    expect(createOnBehalf(w, { kind: 'BUILD', value: 40_000 })).toBeNull();
    const report = w.runtime.runTick();
    expect(report.halted).toBe(false);
    expect(report.violations.map((v) => v.id)).not.toContain('INV-22');
  });

  it('does NOT charge a grant for a venture the grantor created itself (A5′, the other direction)', () => {
    // A delegate refused for an obligation it did not create is the mirror-image bug.
    // The grantor's own creates are its own business and must never touch the grant.
    const w = world('c-selfcreate');
    const id = grant(w, { direct: 250_000, contingent: 250_000 });
    expect(act(w.runtime, w.grantor, 'create', { kind: 'HAUL', value: 12_000, stage: w.stage })).toBeNull();
    expect(w.runtime.grants.get(id)?.spentContingent).toBe(0);
    expect(w.runtime.grants.get(id)?.spentDirect).toBe(0);
    expect(w.runtime.grants.allSpends()).toHaveLength(0);
  });
});

describe('a refusal is a refusal, never a tick abort (the recordSpend guard)', () => {
  it('a full spend journal REFUSES the create instead of halting the world after value moved', () => {
    // `recordSpend` mutates the row and then appends to a capped journal, so it throws at
    // `MAX_GRANT_SPENDS`. It used to be called AFTER the escrow transfer and OUTSIDE the
    // guarded block, so that throw aborted the tick with the grantor's stores already
    // debited — a halted world for an act that should simply have been told "no".
    const w = world('c-cap');
    const id = grant(w, { direct: 250_000, contingent: 250_000 });
    const before = w.runtime.ledger.freeBalance(storesAccount(w.grantor));

    // Fill the journal to its cap with zero-value draws: they consume no headroom, so the
    // only thing under test is the cap itself.
    for (let i = 0; i < MAX_GRANT_SPENDS; i += 1) {
      w.runtime.grants.recordSpend({
        grant: id,
        delegate: w.delegate,
        tick: w.runtime.engine.tick,
        eventId: `ev:pad:${String(i)}` as EventId,
        direct: minor(0),
        contingent: minor(0),
        verb: 'create',
      });
    }

    // `act` throws if the world halts, so reaching the assertions at all is half the test.
    const refusal = createOnBehalf(w, { kind: 'HAUL', value: 12_000 });
    expect(refusal?.invariant).toBe('INV-26');
    expect(refusal?.hint).toContain(String(MAX_GRANT_SPENDS));
    // Refused before anything moved: no venture, no debit, no extra journal line.
    expect(w.runtime.ventures.forPrincipal(w.grantor)).toHaveLength(0);
    expect(w.runtime.ledger.freeBalance(storesAccount(w.grantor))).toBe(before);
    expect(w.runtime.grants.allSpends()).toHaveLength(MAX_GRANT_SPENDS);
  });
});

describe('INV-22 recomputes with checked arithmetic (its own sums cannot drift)', () => {
  it('throws rather than agreeing on a silently-rounded total past 2^53', () => {
    // The invariant that exists because a per-row counter can be raced summed the journal
    // with a bare `+=`. Two draws whose true total leaves the safe range produce a WRONG
    // total that is itself a safe integer, so the journal-vs-cache comparison would
    // compare two different wrong numbers and could agree — a detector that reads exactly
    // like a clean bill of health, which is this project's oldest failure shape.
    //
    // `guarded()` in aggregate.ts turns a throwing check into a halt, so failing closed
    // here is the correct behaviour: the world stops rather than publishing a grant whose
    // spend nobody can compute.
    const grantRow = {
      id: 'g:overflow' as GrantId,
      grantor: 'p:g' as PrincipalId,
      delegate: 'p:d' as PrincipalId,
      template: 'treasury-hand',
      maxDirectLoss: minor(Number.MAX_SAFE_INTEGER),
      maxContingentLiability: minor(Number.MAX_SAFE_INTEGER),
      spentDirect: minor(Number.MAX_SAFE_INTEGER),
      spentContingent: minor(0),
      verbs: ['create', 'elect'],
      clearance: [],
      expiresTick: 1_000,
      revokedAtTick: null,
    };
    const spends: readonly GrantSpend[] = [
      {
        grant: grantRow.id,
        delegate: grantRow.delegate,
        tick: 1,
        eventId: 'ev:1' as EventId,
        direct: minor(Number.MAX_SAFE_INTEGER),
        contingent: minor(0),
        verb: 'create',
      },
      {
        grant: grantRow.id,
        delegate: grantRow.delegate,
        tick: 2,
        eventId: 'ev:2' as EventId,
        direct: minor(2),
        contingent: minor(0),
        verb: 'create',
      },
    ];
    expect(() => checkInv22([grantRow], spends, 3)).toThrow(UnitError);
  });

  it('is not trigger-happy: ordinary totals still recompute and agree', () => {
    const grantRow = {
      id: 'g:ok' as GrantId,
      grantor: 'p:g' as PrincipalId,
      delegate: 'p:d' as PrincipalId,
      template: 'treasury-hand',
      maxDirectLoss: minor(1_000),
      maxContingentLiability: minor(1_000),
      spentDirect: minor(300),
      spentContingent: minor(700),
      verbs: ['create', 'elect'],
      clearance: [],
      expiresTick: 1_000,
      revokedAtTick: null,
    };
    const spends: readonly GrantSpend[] = [
      {
        grant: grantRow.id,
        delegate: grantRow.delegate,
        tick: 1,
        eventId: 'ev:1' as EventId,
        direct: minor(100),
        contingent: minor(400),
        verb: 'create',
      },
      {
        grant: grantRow.id,
        delegate: grantRow.delegate,
        tick: 2,
        eventId: 'ev:2' as EventId,
        direct: minor(200),
        contingent: minor(300),
        verb: 'create',
      },
    ];
    expect(checkInv22([grantRow], spends, 3)).toEqual([]);
  });
});

describe('scar #1 — agent.md and the engine describe the same gate', () => {
  it('the doc says a delegated create draws on BOTH limits, and the engine is why that is true', () => {
    // `agent.md` is a rules surface, not a description of one. High Water shipped a game
    // whose central ritual reliably produced the opposite of what the prompt promised,
    // and it survived three critic passes because nothing compared the two. This is that
    // comparison for the gate this file adds: the document's claim, and the engine doing
    // it, in one test — so a future edit to either side that leaves them disagreeing is
    // a failure rather than a silent lie to every player.
    const doc = readFileSync(new URL('../../agent.md', import.meta.url), 'utf8').replace(/\s+/g, ' ');
    expect(doc).toContain('a delegated `create` draws on both');
    expect(doc).toContain(
      "the venture's **elective** total — every role's unsecured part added up — draws on " +
        '`max_contingent_liability`',
    );
    expect(doc).toContain(
      '**`max_contingent_liability: 0` means your delegate cannot create anything on your behalf at all**',
    );
    expect(doc).toContain('refused the moment they would pass **either** of them');

    // Now the engine, doing exactly what the paragraph above promises a player.
    const w = world('c-agentmd');
    grant(w, { direct: 1_000_000, contingent: 0 });
    // Not just the un-escrowable kinds: "anything", because every role carries an
    // elective part, which is the reason the document states it that broadly.
    for (const kind of ['HAUL', 'DIG', 'SURVEY', 'BUILD']) {
      const refusal = createOnBehalf(w, { kind, value: 4_000 });
      expect(refusal?.invariant, `${kind} should have been refused`).toBe('INV-22');
      expect(refusal?.hint).toContain('max_contingent_liability 0');
    }
    expect(w.runtime.ventures.forPrincipal(w.grantor)).toHaveLength(0);
  });
});

describe('A13 — contingent draw renders, so the attack cannot look UNUSED', () => {
  it('a grant drawn ONLY on its contingent limit renders DRAWN, with the amount on the line', () => {
    // The aggravator that made the defect invisible on screen: the authority line read
    // `spentDirect` alone, so a delegate that opened un-escrowable ventures in its
    // grantor's name — moving no escrow at all — rendered as `UNUSED`. An innocent pixel
    // signature over an unbounded liability is worse than no pixel signature (A13).
    const w = world('c-render');
    grant(w, { direct: 0, contingent: 400_000 });
    expect(createOnBehalf(w, { kind: 'BUILD', value: 40_000 })).toBeNull();

    while (w.runtime.engine.tick <= SETTLE_TICK) {
      const report = w.runtime.runTick();
      if (report.halted) {
        throw new Error(
          `halted at ${String(report.tick)}: ${report.violations.map((v) => `${v.id} ${v.message}`).join(' | ')}`,
        );
      }
    }
    const frame = w.runtime.reckoningFrame();
    const line = frame?.authorityLines.find((l) => l.grantor === w.grantor);
    if (line === undefined) throw new Error('the grant drew no authority line at all');

    expect(line.spent).toBe(0); // no escrow moved — this is why the old state read UNUSED
    expect(line.spentContingent).toBe(40_000);
    expect(line.grantedContingent).toBe(400_000);
    expect(line.state).toBe('DRAWN');
    expect(line.state).not.toBe('UNUSED');
    expect(FREEZE_TICK).toBeLessThan(SETTLE_TICK); // the clock the loop above relies on
  });

  it('a grant nobody has drawn on still renders UNUSED (the state is not stuck on)', () => {
    const w = world('c-render-unused');
    grant(w, { direct: 400_000, contingent: 400_000 });
    while (w.runtime.engine.tick <= SETTLE_TICK) {
      const report = w.runtime.runTick();
      if (report.halted) throw new Error(`halted at ${String(report.tick)}`);
    }
    const line = w.runtime.reckoningFrame()?.authorityLines.find((l) => l.grantor === w.grantor);
    expect(line?.state).toBe('UNUSED');
    expect(line?.spentContingent).toBe(0);
  });
});
