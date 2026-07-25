/**
 * **A5′ — a Levy that records an unpaid assessment against a principal that delivered.**
 *
 * > *"A fabricated default libels a real agent permanently and is worse than a crash. EIGHT
 * > bugs of that shape have shipped here. A Levy that records an unpaid assessment against
 * > a principal that delivered is exactly that shape. Assume you will write one and test
 * > for it deliberately."*
 *
 * ══════════════════════════════════════════════════════════════════════════
 * A shortfall is an **accusation**. It drives a sweep, a strike, and eventually a public
 * demotion, and it is published as a `levy.short` row that never comes back. So it is held
 * to INV-17's standard for defaults: *"every default event carries an attributable cause …
 * a default with no attributable cause is a top-severity halt, because it is the game
 * accusing an innocent agent."*
 *
 * `checkLevyAttribution` recomputes every recorded shortfall from the payment journal by a
 * second road and halts on any disagreement. This file proves it **bites**, three ways —
 * because a guard that cannot be shown to fire is indistinguishable from no guard, and six
 * guards in this project have passed while testing nothing.
 * ══════════════════════════════════════════════════════════════════════════
 */

import { describe, expect, it } from 'vitest';
import type { ConstellationId, PrincipalId, SystemId } from '../../src/core/types.js';
import { minor, qty } from '../../src/core/units.js';
import {
  Book,
  allocate,
  checkLevyAttribution,
  nonEscrowableOf,
  settleLevy,
} from '../../src/levy/index.js';
import { act, levyWorld, runTo, tick, walkToPlace } from './fixture.js';
import { subject } from './fixture.js';

const C = 'c:one' as ConstellationId;
const PLACE = 's:place' as SystemId;

function bookWithOne(principal: string): Book {
  const book = new Book();
  const out = allocate({
    constellation: C,
    subjects: [subject(principal)],
    rule: 'EVEN',
    spared: null,
    byDefault: true,
  });
  book.assess({
    reckoning: 0,
    constellation: C,
    total: out.total,
    rule: 'EVEN',
    spared: null,
    byDefault: true,
    deliverableTo: PLACE,
    lines: out.lines,
    assessedAtTick: 0,
  });
  book.enrolled(principal as PrincipalId, 0);
  return book;
}

describe('A5-PRIME — a principal that delivered is never recorded short', () => {
  it('records zero owed, no strike and no sweep for a payer that discharged in full', () => {
    const world = levyWorld('a5-paid', 2);
    const payer = world.principals[0];
    if (payer === undefined) throw new Error('fixture');
    const runtime = world.runtime;
    tick(runtime);
    const owed = runtime.levyBlockFor(payer, runtime.engine.tick)?.my_assessment ?? 0;
    walkToPlace(runtime, payer);
    act(runtime, payer, 'deliver', {});
    expect(runtime.levyBlockFor(payer, runtime.engine.tick)?.shortfall_if_unpaid).toBe(0);

    runTo(runtime, 287);
    const row = runtime.levySettlement?.shortfalls.find((r) => r.principal === payer);
    expect(row?.owed).toBe(0);
    expect(row?.paidOwn).toBe(owed);
    expect(row?.sweptQty).toBe(0);
    expect(row?.inSweepQueue).toBe(false);
    // No accusation published against it, which is the thing that would be permanent.
    const accusations = runtime.events
      .ticks()
      .flatMap((t) => runtime.events.eventsAtTick(t))
      .map((r) => r.event)
      .filter((e) => e.kind === 'levy.short' && e.onBehalfOfPrincipalId === payer);
    expect(accusations).toEqual([]);
    // Chronic strikes reset, so a paid Reckoning can never contribute to a demotion.
    expect(runtime.levy.chronicOf(payer).strikes).toBe(0);
    expect(runtime.levy.chronicOf(payer).demotions).toBe(0);
    expect(runtime.engine.status).toBe('RUNNING');
  });

  it('publishes the arithmetic WITH the accusation, so a reader can reproduce it', () => {
    const world = levyWorld('a5-short', 2);
    const victim = world.principals[1];
    if (victim === undefined) throw new Error('fixture');
    const runtime = world.runtime;
    runTo(runtime, 287);
    const published = runtime.events
      .ticks()
      .flatMap((t) => runtime.events.eventsAtTick(t))
      .map((r) => r.event)
      .filter((e) => e.kind === 'levy.short' && e.onBehalfOfPrincipalId === victim);
    expect(published).toHaveLength(1);
    const payload = published[0]?.payload ?? {};
    // INV-17's rule for defaults, applied here: the cause travels with the accusation.
    for (const key of [
      'assessmentMinor',
      'paidOwnMinor',
      'paidOtherMinor',
      'sweptQty',
      'presenceOwedMinor',
      'purchasableOwedMinor',
      'owedMinor',
    ]) {
      expect(payload, `missing ${key}`).toHaveProperty(key);
    }
    const assessment = Number(payload['assessmentMinor']);
    const owedMinor = Number(payload['owedMinor']);
    expect(owedMinor).toBe(assessment);
    expect(Number(payload['presenceOwedMinor'])).toBe(nonEscrowableOf(minor(assessment)));
  });

  it('the guard is clean on a healthy settlement', () => {
    const book = bookWithOne('p:a');
    settleLevy({
      book,
      reckoning: 0,
      tick: 287,
      exposureOf: () => minor(0),
      sweep: { availableOf: () => qty(0), consume: () => qty(0) },
    });
    expect(checkLevyAttribution(book, 0, 287)).toEqual([]);
  });

  it('BITES 1: a shortfall inflated after the fact is caught', () => {
    // The mutation: the recorded row says more is owed than the journal supports. This is
    // the libel shape — an accusation nobody can reproduce.
    const book = bookWithOne('p:a');
    const p = 'p:a' as PrincipalId;
    book.credit(0, p, book.assessmentOf(0, p), true);
    book.recordShortfall({
      reckoning: 0,
      principal: p,
      constellation: C,
      assessment: book.assessmentOf(0, p),
      paidOwn: book.assessmentOf(0, p),
      paidOther: minor(0),
      sweptQty: qty(0),
      presenceOwed: minor(0),
      purchasableOwed: minor(0),
      owed: minor(999),
      inSweepQueue: false,
    });
    const violations = checkLevyAttribution(book, 0, 287);
    expect(violations.length).toBeGreaterThanOrEqual(1);
    expect(violations[0]?.id).toBe('A5-PRIME');
    expect(violations[0]?.severity).toBe('HALT');
    expect(violations.map((v) => v.message).join(' ')).toContain('delivered its whole Reckoning');
  });

  it('BITES 2: a row citing an assessment the plan never made is caught', () => {
    const book = bookWithOne('p:a');
    const p = 'p:a' as PrincipalId;
    book.recordShortfall({
      reckoning: 0,
      principal: p,
      constellation: C,
      // The plan says 20 000; the row claims 40 000. A payer that delivered its real
      // assessment would be recorded half-short forever.
      assessment: minor(book.assessmentOf(0, p) * 2),
      paidOwn: minor(0),
      paidOther: minor(0),
      sweptQty: qty(0),
      presenceOwed: minor(0),
      purchasableOwed: minor(0),
      owed: minor(book.assessmentOf(0, p) * 2),
      inSweepQueue: false,
    });
    const violations = checkLevyAttribution(book, 0, 287);
    expect(violations.map((v) => v.message).join(' ')).toContain('cites an assessment of');
  });

  it('BITES 3: a newcomer in the sweep queue is caught, by two independent checkers', () => {
    const book = new Book();
    const newcomerLine = {
      principal: 'p:new' as PrincipalId,
      amount: minor(500),
      newcomerFloored: true,
      spared: false,
      weight: 0,
    };
    book.assess({
      reckoning: 0,
      constellation: C,
      total: minor(500),
      rule: 'EVEN',
      spared: null,
      byDefault: true,
      deliverableTo: PLACE,
      lines: [newcomerLine],
      assessedAtTick: 0,
    });
    book.recordShortfall({
      reckoning: 0,
      principal: newcomerLine.principal,
      constellation: C,
      assessment: minor(500),
      paidOwn: minor(0),
      paidOther: minor(0),
      sweptQty: qty(0),
      presenceOwed: minor(150),
      purchasableOwed: minor(350),
      owed: minor(500),
      // The mutation: §5.2 says a newcomer is NEVER in the seizure queue.
      inSweepQueue: true,
    });
    const violations = checkLevyAttribution(book, 0, 287);
    expect(violations.map((v) => v.message).join(' ')).toContain('SPEC §5.2 says never');
  });

  it('a delivery that could not move goods credits NOTHING, so no payment is invented', () => {
    // The other direction of the same lie: recording a payment that did not happen. The
    // handler moves the goods first and credits only what moved, so a payer with an empty
    // hold is refused rather than credited.
    const world = levyWorld('a5-empty', 2);
    const payer = world.principals[0];
    if (payer === undefined) throw new Error('fixture');
    const runtime = world.runtime;
    tick(runtime);
    walkToPlace(runtime, payer);
    // Drain the stock through the legitimate door: deliver everything owed, then try again.
    act(runtime, payer, 'deliver', {});
    const refusal = act(runtime, payer, 'deliver', {});
    expect(refusal?.hint).toContain('already discharged in full');
    const owing = runtime.levy.owingOf(0, payer);
    expect(owing.paid).toBe(owing.assessment);
    expect(owing.owed).toBe(0);
  });
});
