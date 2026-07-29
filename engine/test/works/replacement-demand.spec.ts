/**
 * ★ **DOES THE WORLD REBUILD?** — the question razing exists to answer, measured rather than assumed.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **THE ECONOMIC POINT IS THE DELIVERABLE, NOT THE MECHANIC.** In EVE every module is manufactured
 * from ore another player mined and loss is permanent, so **destruction creates demand** — that is the
 * engine under the whole economy. This build had half of it: goods are produced, hulls are built, hulls
 * die permanently, and nothing destroyed a WORKS. So production capacity only ever went up and the
 * economy had no reason to keep running once everybody had built.
 *
 * `works/raze.ts` supplies the destruction. **This file asks whether anything replaces it** — because
 * if nothing is ever rebuilt, the loop is not closed and the change has added a loss and no economy.
 * That answer is worth more than a shipped mechanic, so it is measured on a real world with a real
 * cast rather than argued.
 *
 * ── AND THE REBUILD HALF WAS ALREADY WIRED, WHICH IS WHY THIS IS CHEAP ───────
 *
 * Three cast branches gate on `WorksBook.ofPrincipal`, which **filters `razed`**:
 *
 *   1. `worksFor` — *"one per member"*, so a member holding none builds one. **The rebuild.**
 *   2. `stakeFor` — a member with no WORKS reserves the door's published price out of its free
 *      balance before staking on a venture. **Currency held back to rebuild with.**
 *   3. `graduateFor` — *"a WORKS cannot follow a body"*, so losing one frees a member to cross a tier.
 *
 * All three were unreachable for the project's whole life, because `ofPrincipal` and "has ever held
 * one" were the same answer while nothing could raze. This is the mirror image of the defect: not a
 * capability that is never exercised, but a **response** that could never be triggered.
 * ══════════════════════════════════════════════════════════════════════════
 */

import { describe, expect, it } from 'vitest';
import type { PrincipalId } from '../../src/core/types.js';
import { reckoningIndex } from '../../src/core/time.js';
import { WORKS_BUILD_QTY, WORKS_COST_MINOR, WORKS_GOODS_IN_CURRENCY_MINOR } from '../../src/works/params.js';
import { agedWorld } from './aged.js';

const MINUTES = 60_000;

/** Age a world past the endowment window, then find a member holding exactly one live WORKS. */
function worldWithAWorks(seed: string, reckonings: number) {
  const world = agedWorld({ seed, reckonings });
  const holder = world.roster.find((m) => world.runtime.works.ofPrincipal(m.principal).length === 1);
  return { world, holder };
}

describe('★ replacement demand: a razed WORKS is rebuilt, and the rebuild is priced in GOODS', () => {
  it('is not vacuous: an aged world really does have production standing in it', () => {
    // The precondition for everything below, asserted first. A world with no WORKS would make every
    // rebuild assertion pass by having nothing to lose — the vacuity that made INV-22 green for the
    // project's whole life.
    const { world, holder } = worldWithAWorks('rebuild-vac', 5);
    expect(holder, 'the cast must have raised a WORKS at all').toBeDefined();
    expect(world.runtime.works.liveInOrder().length).toBeGreaterThan(0);
    expect(world.runtime.works.ruinsInOrder().length, 'and nothing is razed until we raze it').toBe(0);
  }, 4 * MINUTES);

  it('★ REBUILDS: the member that lost its WORKS raises another, out of production', () => {
    // ══════════════════════════════════════════════════════════════════════════
    // **THE MEASUREMENT THE WHOLE CHANGE IS FOR.** Age a world five Reckonings — past the
    // four-Reckoning endowment window, so the enrolment allotment is no longer paying for anything —
    // raze one member's WORKS through the engine's own method, and run on.
    //
    // If this member never builds again, razing has destroyed capacity the world cannot replace and
    // the loop is open. The assertion is on `everInOrder` growing for THIS holder, not on the world's
    // total, because a different member's first WORKS is not a replacement.
    // ══════════════════════════════════════════════════════════════════════════
    const { world, holder } = worldWithAWorks('rebuild-a', 5);
    expect(holder).toBeDefined();
    if (holder === undefined) return;
    const who: PrincipalId = holder.principal;
    const runtime = world.runtime;

    const before = runtime.works.ofPrincipal(who);
    expect(before.length).toBe(1);
    const lost = before[0];
    if (lost === undefined) return;

    runtime.works.raze({
      id: lost.id,
      tick: runtime.engine.tick,
      reckoning: reckoningIndex(runtime.engine.tick),
      by: null,
    });
    expect(runtime.works.ofPrincipal(who).length, 'it holds none now').toBe(0);
    expect(runtime.works.everHeldBy(who), 'but it has held one — the A15 gate').toBe(true);

    world.resume({ reckonings: 4 });

    const after = runtime.works.ofPrincipal(who);
    const ruins = runtime.works.ruinsInOrder().filter((w) => w.holder === who);
    expect(ruins.length, 'the razing is on the permanent record').toBe(1);
    expect(
      after.length,
      'REPLACEMENT DEMAND. If this is 0, razing has taken production out of the world that nothing ' +
        'replaces — the loop is NOT closed and the mechanic has added a loss and no economy. Report ' +
        'it plainly rather than tuning until it passes.',
    ).toBeGreaterThan(0);
    // And it is genuinely a NEW structure, not the razed row reappearing.
    expect(after[0]?.id).not.toBe(lost.id);
    expect(after[0]?.raisedAtTick).toBeGreaterThan(lost.razedAtTick ?? 0);
  }, 6 * MINUTES);

  it('★ THE A15 DOOR STAYS SHUT on the engine\'s own razing path', () => {
    // ══════════════════════════════════════════════════════════════════════════
    // **THE TRAP `WorksBook.everHeldBy` WAS WRITTEN FOR, SPRUNG ON THE REAL PATH.**
    //
    // `WORKS_GOODS_IN_CURRENCY_MINOR` lets a principal's FIRST WORKS pay its goods half in 25,000 of
    // retired currency, because the enrolment allotment runs out and the ladder was otherwise
    // unenterable. Its author gated it on `everHeldBy` — which counts razed rows — and wrote down
    // exactly what the shorter predicate would cost: *"reopens this door once per razing at 25,000 a
    // turn: an A15 hole arriving with a feature that has nothing to do with it."*
    //
    // `test/works/the-window-closes.spec.ts` asserts this against a row razed through the book. This
    // asserts it after a razing on a **real aged world**, which is the road an agent actually travels,
    // and against the QUOTE an agent is actually shown.
    // ══════════════════════════════════════════════════════════════════════════
    const { world, holder } = worldWithAWorks('rebuild-door', 5);
    expect(holder).toBeDefined();
    if (holder === undefined) return;
    const runtime = world.runtime;
    const who = holder.principal;
    const row = runtime.works.ofPrincipal(who)[0];
    if (row === undefined) return;
    const seat = row.system;

    runtime.works.raze({ id: row.id, tick: runtime.engine.tick, reckoning: 0, by: null });

    const quote = runtime.worksQuote(who, seat);
    expect(
      quote.firstWorks,
      'a razed WORKS must NOT restore the bootstrap. If this is `true`, the door is farmable at one ' +
        `razing per ${String(WORKS_GOODS_IN_CURRENCY_MINOR)} — and razing would be PROFITABLE for ` +
        'anyone holding currency, which inverts the loss A5 exists to make real.',
    ).toBe(false);
    expect(quote.goodsInCurrencyMinor, 'no currency substitute is quoted').toBe(0);
    expect(quote.payingGoodsInCurrency).toBe(false);
    expect(
      quote.totalMinor,
      'so the rebuild costs the currency half and the goods half IN GOODS — which is the demand',
    ).toBe(WORKS_COST_MINOR);
    expect(quote.costQty, 'and the goods are the real price').toBe(WORKS_BUILD_QTY);
  }, 4 * MINUTES);

  it('a razing frees the per-system slot, so the rebuild may stand where the old one did', () => {
    // `atCapacity` reads `liveAt`, which filters `razed`. If a ruin kept the slot the loss would be
    // permanent at that place and the member would have to emigrate to rebuild — which is a different
    // and much worse mechanic than the one this ships.
    const { world, holder } = worldWithAWorks('rebuild-slot', 5);
    if (holder === undefined) return;
    const runtime = world.runtime;
    const row = runtime.works.ofPrincipal(holder.principal)[0];
    if (row === undefined) return;

    expect(runtime.works.atCapacity(holder.principal, row.system)).toBe(true);
    runtime.works.raze({ id: row.id, tick: runtime.engine.tick, reckoning: 0, by: null });
    expect(runtime.works.atCapacity(holder.principal, row.system), 'the slot is free again').toBe(false);
    expect(
      runtime.worksQuote(holder.principal, row.system).alreadyHeld,
      'and the quote agrees, which is the surface an agent reads',
    ).toBe(false);
  }, 4 * MINUTES);

  it('the world does not HALT on a razing, at any invariant', () => {
    // The cheapest thing that could go wrong and the most expensive if it did: `checkWorks` runs every
    // tick, INV-W5's subject set changed for this feature, and INV-W7 is brand new. A razing that
    // halted a world would take the whole shard down on a scheduled event nobody chose.
    const { world, holder } = worldWithAWorks('rebuild-halt', 5);
    if (holder === undefined) return;
    const runtime = world.runtime;
    const row = runtime.works.ofPrincipal(holder.principal)[0];
    if (row === undefined) return;
    runtime.works.raze({
      id: row.id,
      tick: runtime.engine.tick,
      reckoning: reckoningIndex(runtime.engine.tick),
      by: null,
    });
    world.resume({ reckonings: 2 });
    // `engine.status` is the whole assertion: `checkWorks` runs every tick and a HALT stops the
    // world, so a world still RUNNING four Reckonings past a razing has satisfied INV-W1 through
    // INV-W7 on every one of those ticks — including the two this change touched.
    expect(runtime.engine.status, 'a razed world keeps running').toBe('RUNNING');
  }, 6 * MINUTES);
});
