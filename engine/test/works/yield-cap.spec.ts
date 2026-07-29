/**
 * The one property this module lives or dies by: **world output is bounded by the map, not by
 * the population.**
 *
 * If that fails, WORKS is a worse D7 — D7 leaked a one-time grant, this would leak a perpetual
 * flow, and the leak scales with a resource (identities) that A15 says is free and must stay
 * free. So the cap is tested before the module is wired into anything.
 */

import { describe, expect, it } from 'vitest';
import type { PrincipalId, SystemId } from '../../src/core/types.js';
import { Book } from '../../src/works/book.js';
import { YIELD_PER_TICK, WORKS_SPINUP_TICKS } from '../../src/works/params.js';

const SYS = 'sys-01' as SystemId;
function p(n: number): PrincipalId {
  return `p:puppet-${String(n)}` as PrincipalId;
}

/** Raise `n` WORKS at one system, all online. */
function crowd(n: number): Book {
  // All raised on the SAME tick, so spin-up does not stagger who is online — the crowding
  // property is about how many share a place, not about when they arrived.
  const book = new Book();
  for (let i = 0; i < n; i += 1) book.raise({ system: SYS, holder: p(i), tick: 0 });
  return book;
}

function totalAt(book: Book, tick: number): number {
  let total = 0;
  for (const amount of book.sharesAt(SYS, 'COMMONS', tick).values()) total += amount;
  return total;
}

describe('a system yields what its tier allows, however many are working it (A15)', () => {
  it('one occupant takes the whole tier yield', () => {
    const book = crowd(1);
    expect(totalAt(book, WORKS_SPINUP_TICKS + 1)).toBe(YIELD_PER_TICK.COMMONS);
  });

  it('ten occupants take exactly the same total, so ten identities extract what one does', () => {
    // THE A15 ASSERTION. Ten free identities, ten structures, one place: the world gives up
    // the same amount. A puppet farm's only achievement is diluting its own shares.
    const online = WORKS_SPINUP_TICKS + 20;
    for (const n of [1, 2, 3, 5, 10, 37]) {
      expect(totalAt(crowd(n), online), `${String(n)} WORKS must not raise the tier yield`).toBe(
        YIELD_PER_TICK.COMMONS,
      );
    }
  });

  it('splits to the unit with no rounding gain and no rounding loss', () => {
    // 80 across 3 is 26.67, so a naive split loses 2 and a generous one mints 1. Largest
    // remainder must land exactly, because the error is per system per tick — at 288 ticks a
    // Reckoning it is not a rounding difference, it is an income stream.
    const book = crowd(3);
    const shares = [...book.sharesAt(SYS, 'COMMONS', WORKS_SPINUP_TICKS + 1).values()];
    expect(shares.length).toBe(3);
    expect(shares.reduce((a, b) => a + b, 0)).toBe(YIELD_PER_TICK.COMMONS);
    // Fair to within one unit, and the remainder goes by canonical order, not insertion.
    expect(Math.max(...shares) - Math.min(...shares)).toBeLessThanOrEqual(1);
  });

  it('the tier gradient is the risk/reward argument, and it points outward', () => {
    // `graduate` sells the frontier as worth its danger. If the Commons paid as well, the
    // rational move would be to never leave — the quiet equilibrium A8 is monitored for.
    expect(YIELD_PER_TICK.MARCHES).toBeGreaterThan(YIELD_PER_TICK.COMMONS);
    expect(YIELD_PER_TICK.FRONTIER).toBeGreaterThan(YIELD_PER_TICK.MARCHES);
  });
});

describe('spin-up is a commitment, not a purchase', () => {
  it('a WORKS extracts nothing before it comes online', () => {
    const book = new Book();
    const w = book.raise({ system: SYS, holder: p(0), tick: 100 });
    expect(w.onlineAtTick).toBe(100 + WORKS_SPINUP_TICKS);
    expect(totalAt(book, 100), 'the tick it was raised').toBe(0);
    expect(totalAt(book, 100 + WORKS_SPINUP_TICKS - 1), 'one tick early').toBe(0);
    expect(totalAt(book, 100 + WORKS_SPINUP_TICKS), 'the tick it comes online').toBe(
      YIELD_PER_TICK.COMMONS,
    );
  });

  it('a WORKS still spinning up does not dilute the ones that are working', () => {
    // Otherwise raising a structure you never finish is a way to suppress a rival's output —
    // a denial of income for the price of one build, aimed at a specific neighbour.
    const book = new Book();
    book.raise({ system: SYS, holder: p(0), tick: 0 });
    const online = WORKS_SPINUP_TICKS + 1;
    expect(totalAt(book, online)).toBe(YIELD_PER_TICK.COMMONS);
    book.raise({ system: SYS, holder: p(1), tick: online });
    expect(
      book.sharesAt(SYS, 'COMMONS', online).size,
      'the newcomer is not yet a claimant on the yield',
    ).toBe(1);
    expect(totalAt(book, online), 'so the incumbent keeps the whole share').toBe(
      YIELD_PER_TICK.COMMONS,
    );
  });
});

describe('a razed WORKS stops extracting and stays in the record (A5)', () => {
  it('drops out of the split but not out of the book', () => {
    const book = crowd(2);
    const online = WORKS_SPINUP_TICKS + 10;
    expect(book.sharesAt(SYS, 'COMMONS', online).size).toBe(2);
    const first = book.liveAt(SYS)[0];
    // `raze` takes the Reckoning and the razer now: THE RUIN is labelled with both, and INV-W7
    // halts a world carrying a razed row without them.
    book.raze({ id: first?.id ?? ('x' as never), tick: online, reckoning: 0, by: null });
    expect(book.sharesAt(SYS, 'COMMONS', online).size, 'no longer extracting').toBe(1);
    expect(totalAt(book, online), 'and the survivor takes the whole yield').toBe(
      YIELD_PER_TICK.COMMONS,
    );
    expect(book.size, 'the row is still there — the record is append-only and A5 has no opt-out').toBe(2);
  });
});

describe('the book survives a snapshot round-trip', () => {
  it('restores every field the share split and the invariants read', () => {
    const book = crowd(3);
    book.credit(book.liveAt(SYS)[0]?.id ?? ('x' as never), 123 as never);
    const captured = book.capture();
    const fresh = new Book();
    fresh.restore(captured);
    expect(fresh.size).toBe(book.size);
    expect([...fresh.sharesAt(SYS, 'COMMONS', WORKS_SPINUP_TICKS + 5).values()]).toEqual(
      [...book.sharesAt(SYS, 'COMMONS', WORKS_SPINUP_TICKS + 5).values()],
    );
    expect(fresh.liveAt(SYS)[0]?.extracted, 'the extraction counter is not lost').toBe(123);
  });
});
