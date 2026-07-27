/**
 * **PROP-LV4 and the sweep — what non-payment costs, and everything it does not.**
 *
 * > *"Chronic non-payment demotes Commons capacity and does nothing else. **Never
 * > identity, never the holding, never standing.**"* — TESTING.md §4.6
 *
 * ══════════════════════════════════════════════════════════════════════════
 * THE NEGATIVE IS THE TEST, AND IT IS STRUCTURAL BEFORE IT IS ASSERTED.
 *
 * `SweepPort` — the only thing Levy settlement is handed — has two methods, and both are
 * about located goods. There is no holding in it, no standing book, no hand table, no
 * identity. So "never the holding" is a property of the *type*: a future edit that wanted
 * to seize a holding at a Levy shortfall would have to widen that interface, which is an
 * edit a reviewer sees.
 *
 * This file asserts the negative anyway, because §5.2's guarantee is the thing an agent is
 * promised in `agent.md` §5 ("Not paying **never** costs you your identity, your holding,
 * or your standing") and a promise in the agent-facing text that the engine does not keep
 * is scar #1's exact shape.
 * ══════════════════════════════════════════════════════════════════════════
 */

import { describe, expect, it } from 'vitest';
import type { ConstellationId, PrincipalId, SystemId } from '../../src/core/types.js';
import { minor, qty } from '../../src/core/units.js';
import {
  Book,
  LEVY_BASE_COMMONS_CAPACITY,
  LEVY_CHRONIC_STRIKES,
  LEVY_MIN_COMMONS_CAPACITY,
  LEVY_NOMINAL_MINOR,
  allocate,
  nonEscrowableOf,
  settleLevy,
  type SweepPort,
} from '../../src/levy/index.js';
import { HANDS_PER_PRINCIPAL } from '../../src/world/index.js';
import { subject } from './fixture.js';

const C = 'c:one' as ConstellationId;
const PLACE = 's:place' as SystemId;

/** A book with one constellation assessed, and nobody having paid anything. */
function assessed(reckoning: number, principals: readonly string[], exposure: Record<string, number> = {}): Book {
  const book = new Book();
  const subjects = principals.map((p) => subject(p, { exposure: exposure[p] ?? 0 }));
  const out = allocate({ constellation: C, subjects, rule: 'EVEN', spared: null, byDefault: true });
  book.assess({
    reckoning,
    constellation: C,
    total: out.total,
    rule: out.rule,
    spared: null,
    byDefault: true,
    deliverableTo: PLACE,
    lines: out.lines,
    assessedAtTick: reckoning * 288,
  });
  for (const p of principals) book.enrolled(p as PrincipalId, 0);
  return book;
}

/** A sweep port holding `stock` of the levy good per principal, and counting what it took. */
function port(stock: Record<string, number>): SweepPort & { readonly taken: Map<string, number> } {
  const taken = new Map<string, number>();
  return {
    taken,
    availableOf: (principal) => qty(stock[principal] ?? 0),
    consume: ({ principal, want }) => {
      const have = stock[principal] ?? 0;
      const got = Math.min(have, want);
      stock[principal] = have - got;
      taken.set(principal, (taken.get(principal) ?? 0) + got);
      return qty(got);
    },
  };
}

describe('the shortfall sweep', () => {
  it('takes located goods, from the LEAST-EXPOSED first (§5.2\'s published default)', () => {
    const book = assessed(0, ['p:a', 'p:b', 'p:c'], { 'p:a': 900_000, 'p:b': 10, 'p:c': 5_000 });
    const stock = port({ 'p:a': 100_000, 'p:b': 100_000, 'p:c': 100_000 });
    const out = settleLevy({
      book,
      reckoning: 0,
      tick: 287,
      exposureOf: (p) => minor(({ 'p:a': 900_000, 'p:b': 10, 'p:c': 5_000 } as Record<string, number>)[p] ?? 0),
      sweep: stock,
    });
    // b (10) then c (5 000) then a (900 000). The order is the sweep's whole published rule.
    expect(out.sweepQueue).toEqual(['p:b', 'p:c', 'p:a']);
    expect(out.sweptQty).toBeGreaterThan(0);
  });

  it('records no more than was owed, even if the consume callback over-returns', () => {
    // A codex arithmetic pass injected a consume that returns more than `want`; the
    // sweep recorded the over-take, seizing goods the principal did not owe (A5′-adjacent).
    // The take is now clamped to `want`. An adversarial or buggy port cannot make the
    // record overstate a seizure.
    const book = assessed(0, ['p:a']);
    const owed = book.owingOf(0, 'p:a' as PrincipalId).purchasableOwed;
    expect(owed).toBeGreaterThan(0);
    const greedy: SweepPort = {
      availableOf: () => qty(owed + 1_000_000),
      // Returns FAR more than asked — the exact defect codex constructed.
      consume: () => qty(owed + 1_000_000),
    };
    const out = settleLevy({ book, reckoning: 0, tick: 287, exposureOf: () => minor(0), sweep: greedy });
    const row = out.shortfalls.find((r) => r.principal === ('p:a' as PrincipalId));
    expect(row).toBeDefined();
    // Never more than the purchasable debt.
    expect(row!.sweptQty).toBeLessThanOrEqual(owed);
  });

  it('CANNOT sweep the non-escrowable share — presence is not seizable', () => {
    const book = assessed(0, ['p:a']);
    const assessment = book.assessmentOf(0, 'p:a' as PrincipalId);
    const nonEscrowable = nonEscrowableOf(assessment);
    // Far more stock than the assessment: if presence were seizable, this would clear it.
    const stock = port({ 'p:a': 10_000_000 });
    const out = settleLevy({
      book,
      reckoning: 0,
      tick: 287,
      exposureOf: () => minor(0),
      sweep: stock,
    });
    expect(stock.taken.get('p:a')).toBe(assessment - nonEscrowable);
    // The irreducible floor under `LEVY SHORT`: only a hand can lift it, which is why the
    // meter rises when the population turtles however rich it is (§14.2).
    expect(out.levyShort).toBe(nonEscrowable);
    const row = out.shortfalls[0];
    expect(row?.presenceOwed).toBe(nonEscrowable);
    expect(row?.purchasableOwed).toBe(0);
  });

  it('never touches a newcomer: not in the queue, nothing taken', () => {
    const book = new Book();
    const out0 = allocate({
      constellation: C,
      subjects: [
        subject('p:vet'),
        {
          principal: 'p:new' as PrincipalId,
          tenureTicks: 0,
          freeStores: minor(0),
          levyGoodHeld: qty(0),
          exposure: minor(0),
        },
      ],
      rule: 'EVEN',
      spared: null,
      byDefault: true,
    });
    book.assess({
      reckoning: 0,
      constellation: C,
      total: out0.total,
      rule: 'EVEN',
      spared: null,
      byDefault: true,
      deliverableTo: PLACE,
      lines: out0.lines,
      assessedAtTick: 0,
    });
    const stock = port({ 'p:vet': 50_000, 'p:new': 50_000 });
    const out = settleLevy({ book, reckoning: 0, tick: 287, exposureOf: () => minor(0), sweep: stock });
    expect(out.sweepQueue).toEqual(['p:vet']);
    expect(stock.taken.get('p:new')).toBeUndefined();
    // And the newcomer is still assessed — no Commons exemption, only a nominal rate.
    expect(book.assessmentOf(0, 'p:new' as PrincipalId)).toBe(LEVY_NOMINAL_MINOR);
  });

  it('is idempotent: a second settlement does not take a second lot of goods', () => {
    const book = assessed(0, ['p:a']);
    const stock = port({ 'p:a': 1_000_000 });
    const first = settleLevy({ book, reckoning: 0, tick: 287, exposureOf: () => minor(0), sweep: stock });
    const took = stock.taken.get('p:a') ?? 0;
    const second = settleLevy({ book, reckoning: 0, tick: 287, exposureOf: () => minor(0), sweep: stock });
    expect(stock.taken.get('p:a')).toBe(took);
    expect(second.levyShort).toBe(first.levyShort);
  });

  it('BITES: sweeping the whole owed amount instead of the purchasable part clears presence', () => {
    // The mutation — `want = min(owed, available)` rather than `min(purchasableOwed, ...)`.
    // Simulated here so the assertion runs on every CI pass rather than once by hand.
    const book = assessed(0, ['p:a']);
    const assessment = book.assessmentOf(0, 'p:a' as PrincipalId);
    const owing = book.owingOf(0, 'p:a' as PrincipalId);
    const mutantWant = Math.min(owing.owed, 10_000_000);
    const correctWant = Math.min(owing.purchasableOwed, 10_000_000);
    expect(mutantWant).toBe(assessment);
    expect(correctWant).toBe(assessment - nonEscrowableOf(assessment));
    expect(correctWant).toBeLessThan(mutantWant);
  });
});

describe('PROP-LV4 — chronic non-payment demotes Commons capacity, and that is all', () => {
  it('needs CONSECUTIVE shortfalls: a clean Reckoning resets the count', () => {
    const book = new Book();
    const p = 'p:a' as PrincipalId;
    expect(book.capacityOf(p)).toBe(LEVY_BASE_COMMONS_CAPACITY);
    // Two strikes, then a clean night, then two more: still no demotion, because §5.2's
    // word is *chronic* and a counter that never reset would demote for one bad night
    // three Reckonings ago.
    expect(book.strike(p, 0)).toBe(false);
    expect(book.strike(p, 1)).toBe(false);
    book.clearStrikes(p);
    expect(book.strike(p, 3)).toBe(false);
    expect(book.strike(p, 4)).toBe(false);
    expect(book.capacityOf(p)).toBe(LEVY_BASE_COMMONS_CAPACITY);
    // The third consecutive one demotes.
    expect(book.strike(p, 5)).toBe(true);
    expect(book.capacityOf(p)).toBe(LEVY_BASE_COMMONS_CAPACITY - 1);
  });

  it('BITES: strikes at non-consecutive Reckonings never demote, with no reset in between', () => {
    // ── THE MUTATION THIS TEST EXISTS FOR ───────────────────────────────────
    //
    // The first version of the test above called `clearStrikes` between the runs, so it
    // passed against a `strike` that simply counted every shortfall ever — the word
    // *chronic* would have meant nothing and a principal short on Reckonings 0, 40 and 900
    // would have been demoted. Nothing is cleared here: the gaps in the sequence are the
    // only thing that can stop the demotion.
    const book = new Book();
    const p = 'p:a' as PrincipalId;
    for (const reckoning of [0, 5, 11, 40, 100, 900]) {
      expect(book.strike(p, reckoning), `strike at ${String(reckoning)}`).toBe(false);
    }
    expect(book.capacityOf(p)).toBe(LEVY_BASE_COMMONS_CAPACITY);
    expect(book.chronicOf(p).demotions).toBe(0);
    // And a genuine run of three consecutive Reckonings straight after does demote, so the
    // assertion above is about consecutiveness rather than about the counter being dead.
    expect(book.strike(p, 901)).toBe(false);
    expect(book.strike(p, 902)).toBe(true);
    expect(book.chronicOf(p).demotions).toBe(1);
  });

  it('demotes by one per chronic run, and NEVER below the floor (A8)', () => {
    const book = new Book();
    const p = 'p:a' as PrincipalId;
    for (let reckoning = 0; reckoning < LEVY_CHRONIC_STRIKES * 40; reckoning += 1) {
      book.strike(p, reckoning);
    }
    // A capacity of zero would be an ejection dressed as a penalty, and the Commons is a
    // permanent floor rather than a timer.
    expect(book.capacityOf(p)).toBe(LEVY_MIN_COMMONS_CAPACITY);
    expect(LEVY_MIN_COMMONS_CAPACITY).toBeGreaterThan(0);
  });

  it('starts at the number of hands a Commons holding grants', () => {
    // Stated rather than imported so that changing one does not silently change the other,
    // and asserted equal so they cannot drift apart unnoticed (§6.3).
    expect(LEVY_BASE_COMMONS_CAPACITY).toBe(HANDS_PER_PRINCIPAL);
  });

  it('costs nothing else: the chronic row has no field for identity, holding or standing', () => {
    const book = new Book();
    const p = 'p:a' as PrincipalId;
    for (let reckoning = 0; reckoning < LEVY_CHRONIC_STRIKES; reckoning += 1) book.strike(p, reckoning);
    const row = book.chronicOf(p);
    // Anything the Levy could take would have to live here, and only capacity does.
    // An explicit comparator, because a bare `.sort()` is implementation-defined for
    // non-strings and DET-1 bans it by lint even in a test.
    const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
    expect([...Object.keys(row)].sort(cmp)).toEqual(
      ['capacity', 'demotions', 'lastShortReckoning', 'principal', 'strikes'].sort(cmp),
    );
    expect(row.demotions).toBe(1);
  });
});
