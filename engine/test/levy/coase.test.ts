/**
 * **PROP-LV3 — the Coase collapse, attempted against the non-escrowable share.**
 *
 * > *"The non-escrowable share cannot be satisfied by purchase — only by a hand physically
 * > present. Attempt the Coase collapse (three principals running a delivery service) and
 * > assert the non-escrowable share still forces presence."* — TESTING.md §4.6
 *
 * ══════════════════════════════════════════════════════════════════════════
 * WHY THIS IS THE TEST THAT DECIDES WHETHER THE LEVY IS A MECHANIC OR A TAX.
 *
 * §5.2: *"a fully purchasable Levy Coase-collapses exactly as predation would: three
 * principals with hands near the delivery place would run a delivery service at a small
 * premium, everyone would buy it, zero trust would be risked, zero standing would accrue,
 * and `LEVY SHORT` would sit flat every night — the meter that exists to rise when the
 * population turtles."*
 *
 * So this file **builds the delivery service** and runs it at full tilt against a
 * principal that never moves a hand, through the real verb, in a real Runtime. The service
 * is allowed to succeed at everything it legitimately can: what must remain true at the end
 * is that the turtle is still short by exactly its non-escrowable share, its tribute line
 * is still red, and no amount of purchased carriage moved that number by one unit.
 * ══════════════════════════════════════════════════════════════════════════
 */

import { describe, expect, it } from 'vitest';
import { minor } from '../../src/core/units.js';
import { LEVY_NON_ESCROWABLE_BPS, creditFor, nonEscrowableOf, owingOf } from '../../src/levy/index.js';
import { act, levyWorld, runTo, tick, walkToPlace } from './fixture.js';

describe('the two buckets (payment.ts)', () => {
  it('rounds the non-escrowable share UP, so it is never rounded away', () => {
    expect(nonEscrowableOf(minor(0))).toBe(0);
    // 30% of 1 is 0.3 — rounded down it would be zero, and a newcomer at the nominal rate
    // would never have to show up at all. §13's minute-60 checklist has "one Levy paid" in
    // it, and paying is how a first-hour agent learns presence is the scarce thing.
    expect(nonEscrowableOf(minor(1))).toBe(1);
    expect(nonEscrowableOf(minor(10_000))).toBe((10_000 * LEVY_NON_ESCROWABLE_BPS) / 10_000);
    // Never more than the whole assessment.
    expect(nonEscrowableOf(minor(3))).toBeLessThanOrEqual(3);
  });

  it('lets another principal fill only the escrowable bucket, at any amount', () => {
    const assessment = minor(1_000);
    const nonEscrowable = nonEscrowableOf(assessment);
    const escrowable = assessment - nonEscrowable;

    // The service delivers the entire assessment on the turtle's behalf. It is credited
    // for the purchasable part and not one unit more.
    const bought = owingOf(assessment, { paidOwn: minor(0), paidOther: minor(assessment) });
    expect(bought.escrowableFilled).toBe(escrowable);
    expect(bought.nonEscrowableFilled).toBe(0);
    expect(bought.presenceOwed).toBe(nonEscrowable);
    expect(bought.owed).toBe(nonEscrowable);

    // And offering ten times the assessment changes nothing: the credit is capped at what
    // is actually purchasable, so the goods are refused at the door rather than confiscated.
    expect(creditFor(bought, minor(assessment * 10), false)).toBe(0);
  });

  it('fills presence FIRST out of the payer\'s own hand, so `paid` falls monotonically', () => {
    const assessment = minor(1_000);
    const nonEscrowable = nonEscrowableOf(assessment);
    const part = owingOf(assessment, { paidOwn: minor(nonEscrowable), paidOther: minor(0) });
    expect(part.presenceOwed).toBe(0);
    expect(part.purchasableOwed).toBe(assessment - nonEscrowable);
    // Filling the escrowable part first would leave a principal that paid most of its
    // assessment by hand still short on presence, with no way to tell from `paid`.
    expect(part.paid).toBe(nonEscrowable);
  });

  it('is exact: presence + purchasable is always what is left, for 500 random splits', () => {
    let seed = 7;
    const next = (bound: number): number => {
      seed = (seed * 48_271) % 2_147_483_647;
      return seed % bound;
    };
    for (let n = 0; n < 500; n += 1) {
      const assessment = minor(next(50_000));
      const own = minor(next(60_000));
      const other = minor(next(60_000));
      const out = owingOf(assessment, { paidOwn: own, paidOther: other });
      expect(out.owed).toBe(out.presenceOwed + out.purchasableOwed);
      expect(out.paid + out.owed).toBe(assessment);
      expect(out.nonEscrowableFilled).toBeLessThanOrEqual(out.nonEscrowable);
      expect(out.escrowableFilled).toBeLessThanOrEqual(out.escrowable);
      // The whole rule, as one assertion: nothing anybody else delivered ever reaches the
      // non-escrowable bucket.
      expect(out.nonEscrowableFilled).toBeLessThanOrEqual(own);
    }
  });
});

describe('PROP-LV3 — the delivery service, built and run against a turtle', () => {
  it('the service can clear the purchasable part and CANNOT clear presence', () => {
    // Four principals: a turtle that never moves, and three running the delivery service.
    const world = levyWorld('coase', 4);
    const [turtle, s1, s2, s3] = world.principals;
    if (turtle === undefined || s1 === undefined || s2 === undefined || s3 === undefined) {
      throw new Error('fixture');
    }
    const runtime = world.runtime;
    tick(runtime);

    const before = runtime.levyBlockFor(turtle, runtime.engine.tick);
    expect(before).not.toBeNull();
    const assessment = before?.my_assessment ?? 0;
    const nonEscrowable = before?.non_escrowable ?? 0;
    expect(assessment).toBeGreaterThan(0);
    expect(nonEscrowable).toBeGreaterThan(0);

    // The service moves its hands to the named place. This is the "three principals with
    // hands near the delivery place" §5.2 describes, and it is allowed to work.
    for (const server of [s1, s2, s3]) walkToPlace(runtime, server);

    // Now it delivers for the turtle, repeatedly, at whatever premium it likes. The premium
    // is outside the engine — what the engine decides is how much of the tribute it clears.
    for (const server of [s1, s2, s3]) {
      for (let n = 0; n < 3; n += 1) {
        act(runtime, server, 'deliver', { on_behalf_of: turtle, amount: assessment });
      }
    }

    const after = runtime.levyBlockFor(turtle, runtime.engine.tick);
    expect(after).not.toBeNull();
    // ── THE ASSERTION THE MECHANIC LIVES OR DIES ON ─────────────────────────
    // The purchasable part is gone. The presence part is untouched, to the unit.
    expect(after?.paid).toBe(assessment - nonEscrowable);
    expect(after?.shortfall_if_unpaid).toBe(nonEscrowable);

    // And the refusal says why, in a sentence naming the rule rather than an error code.
    const refusal = act(runtime, s1, 'deliver', { on_behalf_of: turtle, amount: assessment });
    expect(refusal?.hint).toContain('non-escrowable');
    expect(refusal?.hint).toContain('its own hand');

    // The turtle's own hand then clears it — the same goods, the same place, the only
    // difference being whose hand carried them. That difference is the entire mechanic.
    walkToPlace(runtime, turtle);
    act(runtime, turtle, 'deliver', {});
    const paid = runtime.levyBlockFor(turtle, runtime.engine.tick);
    expect(paid?.shortfall_if_unpaid).toBe(0);
    expect(paid?.paid).toBe(assessment);
  });

  it('LEVY SHORT does not sit flat when everyone buys the service — the meter still rises', () => {
    // The failure §5.2 predicts for a fully purchasable Levy, measured rather than argued:
    // run a whole Reckoning in which the service pays for everybody and nobody moves their
    // own hand, and assert the headline meter is *not* zero at settlement.
    const world = levyWorld('coase-flat', 4);
    const [a, b, c, server] = world.principals;
    if (a === undefined || b === undefined || c === undefined || server === undefined) throw new Error('fixture');
    const runtime = world.runtime;
    tick(runtime);
    walkToPlace(runtime, server);

    for (const payer of [a, b, c]) {
      const owed = runtime.levyBlockFor(payer, runtime.engine.tick)?.my_assessment ?? 0;
      act(runtime, server, 'deliver', { on_behalf_of: payer, amount: owed });
    }
    runTo(runtime, 287);

    const short = runtime.levySettlement?.levyShort ?? 0;
    expect(short).toBeGreaterThan(0);
    // Decomposable to whose line is red, which is what makes the meter legible (§5.2).
    const rows = runtime.levySettlement?.shortfalls ?? [];
    const bought = rows.filter((s) => [a, b, c].includes(s.principal));
    expect(bought).toHaveLength(3);
    for (const row of bought) {
      // Every unit still owed by a principal that BOUGHT its delivery is a presence unit:
      // purchase cleared everything it could reach and stopped exactly at the share that
      // needs a hand.
      expect(row.paidOther).toBeGreaterThan(0);
      expect(row.paidOwn).toBe(0);
      expect(row.presenceOwed).toBe(row.owed);
      expect(row.owed).toBeGreaterThan(0);
    }
    // The service's own tribute is untouched, which is the other half of why the meter
    // rises: somebody running everyone else's errands still has its own line to draw.
    const servers = rows.filter((s) => s.principal === server);
    expect(servers[0]?.paidOwn).toBe(0);
    expect(servers[0]?.owed).toBeGreaterThan(0);
  });

  it('BITES: crediting a third-party delivery to the whole assessment collapses it', () => {
    // The mutation, simulated rather than shipped: `creditFor(..., byOwnHand = true)` for a
    // delivery that was not by the payer's own hand. That single boolean is the Coase
    // collapse, and this is what it would look like — the turtle fully paid, presence
    // bought, `LEVY SHORT` flat.
    const assessment = minor(1_000);
    const owing = owingOf(assessment, { paidOwn: minor(0), paidOther: minor(0) });
    const asOwn = creditFor(owing, minor(assessment), true);
    const asService = creditFor(owing, minor(assessment), false);
    expect(asOwn).toBe(assessment);
    expect(asService).toBe(assessment - nonEscrowableOf(assessment));
    expect(asService).toBeLessThan(asOwn);
    const collapsed = owingOf(assessment, { paidOwn: minor(asOwn), paidOther: minor(0) });
    expect(collapsed.owed).toBe(0);
  });
});
