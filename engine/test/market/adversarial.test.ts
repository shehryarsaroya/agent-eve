/**
 * Adversarial verification of the book — the five claims a market has to survive,
 * proved end-to-end against the real `Runtime` rather than against the pure matcher.
 *
 * The pure-matcher suites (`determinism`, `matching`) prove the *rule*. This file
 * proves the *engine*, because between the rule and the engine sit a tick queue, a
 * ledger, an encumbrance book, a state table and a rollback — and every one of them
 * is a place the rule could be true and the game still wrong.
 *
 * Five claims, and one closed defect:
 *
 *   1. **A4 — speed buys nothing.** Every arrival permutation of one crossing set
 *      produces byte-identical fills *and* a byte-identical `state_hash`.
 *   2. **Conservation.** Sixty ticks of randomised places, cancels and fills move
 *      not one unit of currency or goods into or out of the world — checked every
 *      tick, because a leak that later cancels itself out would pass an end check.
 *   3. **Abort leaves nothing**, in a tick that places, cancels *and* fills.
 *   4. **`checkMarketInvariants` actually runs all seven clauses.** Every MKT test
 *      called its clause directly, so deleting a clause from the aggregator — the
 *      single ASSERT hook — left the whole suite green while the invariant stopped
 *      running in production. Proved by mutation: four clauses were unwired one at
 *      a time and nothing went red.
 *   5. **A refused `modify` changes nothing** (§12.2). It used to destroy the order.
 */

import { describe, expect, it } from 'vitest';
import type { PrincipalId, SystemId } from '../../src/core/types.js';
import { SETTLEMENT_PHASE, setSpeed } from '../../src/core/time.js';
import { storesAccount } from '../../src/ledger/index.js';
import { checkMarketInvariants, marketEscrowAccount } from '../../src/market/index.js';
import { Runtime } from '../../src/sim/runtime.js';
import { commonsSystems } from '../../src/world/index.js';
import { GOOD, permutations } from './fixture.js';

const CAST: readonly PrincipalId[] = ['p:v1', 'p:v2', 'p:v3', 'p:v4'] as unknown as readonly PrincipalId[];

function build(seed: string, cast: readonly PrincipalId[] = CAST): { runtime: Runtime; venue: SystemId } {
  setSpeed('instant');
  const runtime = new Runtime({ seed });
  const venue = commonsSystems(runtime.world.map)[0];
  if (venue === undefined) throw new Error('the launch map has no Commons system');
  for (const p of cast) {
    runtime.seat(p, p.replace('p:', ''), venue);
    runtime.standing.open(p);
  }
  runtime.runTick();
  return { runtime, venue };
}

function go(runtime: Runtime, who: PrincipalId, params: Record<string, unknown>, cs = 0, arrival = 0): boolean {
  return runtime.engine.submit({
    principal: who,
    verb: 'trade',
    params,
    clientSequence: cs,
    arrivalMs: arrival,
    decisionSource: 'LIVE',
  }).ok;
}

function runOk(runtime: Runtime, where: string): void {
  const report = runtime.runTick();
  if (report.halted) {
    throw new Error(`${where}: halted — ${report.violations.map((v) => `${v.id} ${v.message}`).join(' | ')}`);
  }
}

/**
 * Every unit of value in the world, by the ledger's own supply buckets.
 *
 * Not a sum over accounts: double entry makes that trivially zero, so it would pass
 * while the market minted money. `issued` and `retired` are the faucet and the sink,
 * and `free + encumbered + escrowed` is where it all currently sits.
 */
function supply(runtime: Runtime): string {
  const cash = runtime.ledger.currencySupply();
  const goods = runtime.ledger.goodsSupply().get(GOOD);
  return JSON.stringify({
    issued: cash.issued,
    retired: cash.retired,
    held: cash.free + cash.encumbered + cash.escrowed,
    gIssued: goods?.issued ?? 0,
    gRetired: goods?.retired ?? 0,
    gHeld: (goods?.available ?? 0) + (goods?.inTransit ?? 0) + (goods?.escrowed ?? 0),
  });
}

// ─────────────────────────────────────────────────────────────────────────────

describe('A4 — a faster client buys NOTHING, through the whole engine', () => {
  it('all 24 arrival permutations of one crossing set produce identical fills and one state_hash', () => {
    // Two asks at the same price from two principals and two bids that can only take
    // one each: the set has a real contest in it, so an arrival-ordered book would
    // give a different answer in a different order.
    const script: readonly { who: PrincipalId; params: Record<string, unknown> }[] = [
      { who: CAST[0] as PrincipalId, params: { side: 'ASK', quantity: 10, limit_price: 10 } },
      { who: CAST[1] as PrincipalId, params: { side: 'ASK', quantity: 10, limit_price: 10 } },
      { who: CAST[2] as PrincipalId, params: { side: 'BID', quantity: 10, limit_price: 12 } },
      { who: CAST[3] as PrincipalId, params: { side: 'BID', quantity: 5, limit_price: 11 } },
    ];

    const fingerprints = new Set<string>();
    const hashes = new Set<string>();
    let traded = 0;

    for (const order of permutations([0, 1, 2, 3])) {
      const w = build('a4-engine');
      let arrival = 0;
      for (const index of order) {
        const step = script[index];
        if (step === undefined) continue;
        // Arrival order AND wall-clock arrival both vary. Neither may be read.
        expect(go(w.runtime, step.who, { operation: 'place', venue: w.venue, good: GOOD, ...step.params }, 0, arrival)).toBe(true);
        arrival += 1;
      }
      runOk(w.runtime, 'placement tick');
      runOk(w.runtime, 'clearing tick');
      traded = w.runtime.market.fills().length;
      fingerprints.add(
        JSON.stringify(w.runtime.market.fills().map((f) => [f.id, f.buyer, f.seller, f.unitPrice, f.qty])),
      );
      hashes.add(w.runtime.engine.stateHash);
    }

    expect(traded, '24 identical no-ops would pass this test; the set must actually trade').toBeGreaterThan(0);
    expect(fingerprints.size, 'arrival order changed who got filled — requests-per-second is power').toBe(1);
    expect(hashes.size, 'arrival order changed the world hash').toBe(1);

    // And the winner is the one SENIORITY names, not merely a stable one. Reversing
    // the tie-break is deterministic too, so arrival-independence alone would not
    // notice it: at equal price and equal age, `(principal_id, client_sequence)`
    // decides, so `p:v1`'s ask trades against the better of the two bids.
    const settled = [...fingerprints][0] ?? '';
    const parsed = JSON.parse(settled) as [string, string, string, number, number][];
    expect(parsed[0]?.[2], 'the same-price tie went to the wrong ask').toBe('p:v1');
    expect(parsed[0]?.[1]).toBe('p:v3');
    expect(parsed[0]?.[3], 'the more senior ask did not set the price').toBe(10);
  });
});

describe('CONSERVATION — a double-entry world does not leak through its market', () => {
  it('60 ticks of randomised places, cancels and fills create and destroy nothing', () => {
    const cast: readonly PrincipalId[] = ['p:c1', 'p:c2', 'p:c3', 'p:c4', 'p:c5', 'p:c6'] as unknown as readonly PrincipalId[];
    const w = build('conserve', cast);
    const start = supply(w.runtime);

    // A seeded LCG, never `Math.random` (DET-7): the run is a fixture, so a failure
    // is reproducible and a green is not luck.
    let s = 20260725 >>> 0;
    const rnd = (): number => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 0x1_0000_0000;
    };

    for (let t = 0; t < 60; t += 1) {
      for (const [i, who] of cast.entries()) {
        const roll = rnd();
        if (roll < 0.65) {
          go(
            w.runtime,
            who,
            {
              operation: 'place',
              venue: w.venue,
              good: GOOD,
              side: rnd() < 0.5 ? 'BID' : 'ASK',
              quantity: 1 + Math.floor(rnd() * 40),
              limit_price: 5 + Math.floor(rnd() * 20),
              time_in_force: rnd() < 0.3 ? 'IOC' : 'GTC',
            },
            0,
            i,
          );
        }
        if (roll > 0.5) {
          const mine = w.runtime.market.openFor(who);
          const victim = mine[Math.floor(rnd() * mine.length)];
          if (victim !== undefined) {
            go(w.runtime, who, { operation: 'cancel', order: victim.id }, 1, i);
          }
        }
      }
      runOk(w.runtime, `tick ${String(t)}`);
      // Every tick, not only at the end: a leak that later cancels itself out is
      // still a tick in which the record was wrong (A5').
      expect(supply(w.runtime), `supply moved at tick ${String(t)}`).toBe(start);
    }

    expect(w.runtime.market.fills().length, 'a run with no fills proves nothing').toBeGreaterThan(10);
    expect(supply(w.runtime)).toBe(start);
  });
});

describe('ABORT — a halted tick that placed, cancelled and filled leaves nothing', () => {
  it('no order, no fill, no lock survives, and state_hash is exactly the pre-tick value', () => {
    const w = build('abort-full');
    const [A, B, C, D] = CAST as readonly [PrincipalId, PrincipalId, PrincipalId, PrincipalId];
    // A throwaway A cancels next tick, so the CLOSURE RING is non-empty before the
    // halt. Without it a restore that silently dropped `closed` would round-trip a
    // world it had lost part of — and nothing in the whole suite noticed, because
    // every rollback test began from a book that had never closed an order.
    go(w.runtime, A, { operation: 'place', venue: w.venue, good: GOOD, side: 'ASK', quantity: 3, limit_price: 900 }, 0);
    go(w.runtime, C, { operation: 'place', venue: w.venue, good: GOOD, side: 'BID', quantity: 5, limit_price: 4 }, 0);
    go(w.runtime, D, { operation: 'place', venue: w.venue, good: GOOD, side: 'BID', quantity: 5, limit_price: 3 }, 0);
    runOk(w.runtime, 'seed tick');

    // A crossing pair placed here, so it fills in the tick that halts.
    go(w.runtime, A, { operation: 'cancel', order: w.runtime.market.openFor(A)[0]?.id }, 0);
    go(w.runtime, A, { operation: 'place', venue: w.venue, good: GOOD, side: 'ASK', quantity: 20, limit_price: 10 }, 1, 1);
    go(w.runtime, B, { operation: 'place', venue: w.venue, good: GOOD, side: 'BID', quantity: 20, limit_price: 12 }, 0);
    runOk(w.runtime, 'crossing tick');
    expect(w.runtime.market.countOpen()).toBe(4);
    expect(w.runtime.market.closed().length, 'the closure ring must be non-empty for this test to bite').toBe(1);
    expect(w.runtime.market.fills().length).toBe(0);

    // The committed pre-tick reference. Taken BEFORE the corruption is planted,
    // because that is what the engine's own rollback snapshot holds.
    const tables = w.runtime.engine.stateTables;
    const hashBefore = w.runtime.engine.stateHash;
    const marketBefore = JSON.stringify(tables.find((t) => t.name === 'market')?.capture() ?? null);
    const locksBefore = w.runtime.ledger.encumbrances.open().length;
    const escrowBefore = w.runtime.ledger.goodsInAccount(marketEscrowAccount(A)).get(GOOD) ?? 0;
    const cashBefore = w.runtime.ledger.freeBalance(storesAccount(B));

    // The halting tick also CANCELS one order and PLACES another, so all three kinds
    // of market write — place, cancel, fill — are in flight when ASSERT refuses.
    go(w.runtime, C, { operation: 'cancel', order: w.runtime.market.openFor(C)[0]?.id }, 0);
    go(w.runtime, A, { operation: 'place', venue: w.venue, good: GOOD, side: 'ASK', quantity: 7, limit_price: 30 }, 1, 1);

    const victim = w.runtime.market.openFor(D)[0];
    expect(victim).toBeDefined();
    if (victim === undefined) return;
    (victim as { filled: number }).filled = victim.quantity + 5;

    const report = w.runtime.runTick();
    expect(report.halted, 'the tick did not halt, so nothing here is proved').toBe(true);
    expect(report.violations.some((v) => v.id === 'MKT-6')).toBe(true);
    expect(report.rollbackGaps, 'a table outside the rollback is the EncumbranceBook defect again').toEqual([]);
    expect(report.rollback).toBe('FULL');

    expect(w.runtime.engine.stateHash, 'state_hash did not return to its pre-tick value').toBe(hashBefore);
    expect(
      JSON.stringify(tables.find((t) => t.name === 'market')?.capture() ?? null),
      'the market table did not return to its pre-tick capture',
    ).toBe(marketBefore);
    expect(w.runtime.market.fills().length, 'a fill survived the abort').toBe(0);
    expect(w.runtime.market.openFor(A).length, 'the placed order survived the abort').toBe(1);
    expect(w.runtime.market.openFor(C).length, 'the cancel survived the abort').toBe(1);
    expect(w.runtime.market.closed().length, 'the abort lost the closure ring').toBe(1);
    expect(w.runtime.ledger.encumbrances.open().length, 'a lock survived the abort').toBe(locksBefore);
    expect(w.runtime.ledger.goodsInAccount(marketEscrowAccount(A)).get(GOOD) ?? 0).toBe(escrowBefore);
    expect(w.runtime.ledger.freeBalance(storesAccount(B))).toBe(cashBefore);
  });
});

describe('the ASSERT hook actually runs every MKT clause', () => {
  /**
   * `checkMarketInvariants` is the single hook the tick loop calls, and every MKT
   * test until now called its clause *directly*. So a clause dropped from the
   * aggregator kept its unit test green while silently stopping in production —
   * verified by mutation: MKT-1, MKT-4, MKT-5 and MKT-7 were each unwired and the
   * whole suite stayed green. A clause that runs nowhere is not an invariant.
   */
  it('a corrupt book produces every clause a direct call produces', () => {
    const w = build('aggregate');
    const [A, B] = CAST as readonly [PrincipalId, PrincipalId, ...PrincipalId[]];
    go(w.runtime, A, { operation: 'place', venue: w.venue, good: GOOD, side: 'ASK', quantity: 30, limit_price: 10 });
    go(w.runtime, B, { operation: 'place', venue: w.venue, good: GOOD, side: 'BID', quantity: 30, limit_price: 12 });
    runOk(w.runtime, 'seed');
    runOk(w.runtime, 'clear');
    expect(w.runtime.market.fills().length).toBe(1);

    const input = { book: w.runtime.market, ledger: w.runtime.ledger, tick: w.runtime.engine.tick };
    expect(checkMarketInvariants(input), 'a healthy world must be silent').toEqual([]);

    // MKT-1: escrow behind no order. Escrow a pile, then forget the order.
    go(w.runtime, A, { operation: 'place', venue: w.venue, good: GOOD, side: 'ASK', quantity: 25, limit_price: 40 }, 0);
    runOk(w.runtime, 'escrow');
    const orphan = w.runtime.market.openFor(A)[0];
    expect(orphan).toBeDefined();
    if (orphan === undefined) return;
    const orphanTick = w.runtime.engine.tick;
    w.runtime.market.close(orphan.id, 'CANCELLED', orphanTick);
    const mkt1 = checkMarketInvariants({ ...input, tick: orphanTick });
    expect(mkt1.map((v) => v.id), 'MKT-1 is not wired into checkMarketInvariants').toContain('MKT-1');

    // MKT-4 / MKT-5: a fabricated print. Goods that never moved, money that never
    // moved, and one principal on both sides — the A5' failure and the valuation
    // exploit in one row.
    const fresh = build('aggregate-fill');
    const [X, Y] = CAST as readonly [PrincipalId, PrincipalId, ...PrincipalId[]];
    go(fresh.runtime, X, { operation: 'place', venue: fresh.venue, good: GOOD, side: 'ASK', quantity: 5, limit_price: 10 });
    go(fresh.runtime, Y, { operation: 'place', venue: fresh.venue, good: GOOD, side: 'BID', quantity: 5, limit_price: 10 });
    runOk(fresh.runtime, 'seed');
    runOk(fresh.runtime, 'clear');
    const now = fresh.runtime.engine.tick;
    fresh.runtime.market.recordFill({
      id: 'mkt.fill:fabricated',
      tick: now,
      venue: fresh.venue,
      good: GOOD,
      unitPrice: 9_999 as never,
      qty: 5 as never,
      buyer: X,
      seller: X,
      bid: 'ord:0:nobody:0' as never,
      ask: 'ord:0:nobody:1' as never,
      goodsLegs: 1,
    });
    const ids = checkMarketInvariants({
      book: fresh.runtime.market,
      ledger: fresh.runtime.ledger,
      tick: now,
    }).map((v) => v.id);
    expect(ids, 'MKT-4 is not wired into checkMarketInvariants: a torn fill would reach the record').toContain('MKT-4');
    expect(ids, 'MKT-5 is not wired: a self-matched print would reach the mark').toContain('MKT-5');

    // MKT-7: two of one principal's orders resting at crossing prices. The door in
    // `place.ts` refuses this, so it is planted directly — which is exactly the
    // state the invariant exists to catch if the door ever stops working.
    const third = build('aggregate-cross');
    const Z = CAST[0] as PrincipalId;
    go(third.runtime, Z, { operation: 'place', venue: third.venue, good: GOOD, side: 'BID', quantity: 4, limit_price: 8 }, 0);
    go(third.runtime, Z, { operation: 'place', venue: third.venue, good: GOOD, side: 'ASK', quantity: 4, limit_price: 12 }, 1, 1);
    runOk(third.runtime, 'spread');
    const ask = third.runtime.market.openFor(Z).find((o) => o.side === 'ASK');
    expect(ask).toBeDefined();
    if (ask === undefined) return;
    (ask as { limitPrice: number }).limitPrice = 5;
    expect(
      checkMarketInvariants({
        book: third.runtime.market,
        ledger: third.runtime.ledger,
        tick: third.runtime.engine.tick,
      }).map((v) => v.id),
      'MKT-7 is not wired into checkMarketInvariants',
    ).toContain('MKT-7');
  });
});

describe('a REFUSED modify changes nothing (SPEC §12.2)', () => {
  /**
   * `modify` is cancel-and-replace, and the cancel used to land first. Every one of
   * these payloads therefore *destroyed a resting order and its queue position* and
   * returned `{ok:false}` — an action the engine reported as refused, which had in
   * fact taken the agent's order away. §12.2's contract is that an illegal action
   * returns the violated invariant and changes nothing; §15.4 puts a record that
   * says one thing and did another in the same class as a false default.
   */
  for (const [label, bad] of [
    ['quantity 0', { quantity: 0 }],
    ['limit_price 0', { limit_price: 0 }],
    ['duration_ticks past the cap', { duration_ticks: 9_999 }],
    ['an unaffordable reprice', { limit_price: 1_000_000 }],
  ] as const) {
    it(`refuses ${label} and leaves the resting order exactly where it was`, () => {
      const w = build(`modify-${label}`);
      const A = CAST[0] as PrincipalId;
      go(w.runtime, A, { operation: 'place', venue: w.venue, good: GOOD, side: 'BID', quantity: 5, limit_price: 10 });
      runOk(w.runtime, 'place');
      const before = w.runtime.market.openFor(A)[0];
      expect(before).toBeDefined();
      if (before === undefined) return;
      const cashBefore = w.runtime.ledger.freeBalance(storesAccount(A));
      const locksBefore = w.runtime.ledger.encumbrances.open().length;

      go(w.runtime, A, { operation: 'modify', order: before.id, ...bad }, 0);
      runOk(w.runtime, 'modify');

      const corrections = w.runtime.takeCorrections(A);
      expect(corrections.length, 'the modify was accepted, so this proves nothing').toBe(1);
      const after = w.runtime.market.openFor(A);
      expect(after.length, 'a REFUSED modify destroyed the resting order').toBe(1);
      expect(after[0]?.id, 'a REFUSED modify replaced the order with a new one').toBe(before.id);
      expect(after[0]?.placedTick, 'a REFUSED modify cost the order its seniority').toBe(before.placedTick);
      expect(after[0]?.limitPrice).toBe(before.limitPrice);
      expect(after[0]?.quantity).toBe(before.quantity);
      expect(w.runtime.ledger.freeBalance(storesAccount(A)), 'the escrow moved on a refused act').toBe(cashBefore);
      expect(w.runtime.ledger.encumbrances.open().length).toBe(locksBefore);
    });
  }

  it('still ACCEPTS a legal reprice that only the released escrow can fund', () => {
    // The pre-flight must credit what the cancel is about to hand back, or it would
    // refuse the commonest legal modify there is: repricing an order that already
    // holds most of your free cash.
    const w = build('modify-legal');
    const A = CAST[0] as PrincipalId;
    const free = w.runtime.ledger.freeBalance(storesAccount(A));
    const price = Math.floor(free / 10);
    go(w.runtime, A, { operation: 'place', venue: w.venue, good: GOOD, side: 'BID', quantity: 10, limit_price: price });
    runOk(w.runtime, 'place');
    expect(w.runtime.ledger.freeBalance(storesAccount(A))).toBe(free - price * 10);
    const first = w.runtime.market.openFor(A)[0];
    expect(first).toBeDefined();
    if (first === undefined) return;

    go(w.runtime, A, { operation: 'modify', order: first.id, limit_price: price - 1 }, 0);
    runOk(w.runtime, 'modify');
    expect(w.runtime.takeCorrections(A).length, 'a legal reprice was refused').toBe(0);
    const after = w.runtime.market.openFor(A);
    expect(after.length).toBe(1);
    expect(after[0]?.limitPrice).toBe(price - 1);
    // Cancel-and-replace: a reprice really does forfeit its place in the queue (M4).
    expect(after[0]?.id).not.toBe(first.id);
    expect(w.runtime.ledger.freeBalance(storesAccount(A))).toBe(free - (price - 1) * 10);
    expect(w.runtime.ledger.encumbrances.open().length).toBe(1);
  });

  it('still ACCEPTS an ASK reprice funded by the goods the cancel returns', () => {
    const w = build('modify-ask');
    const A = CAST[0] as PrincipalId;
    const all = w.runtime.ledger.goodsInAccount(storesAccount(A)).get(GOOD) ?? 0;
    expect(all).toBeGreaterThan(0);
    go(w.runtime, A, { operation: 'place', venue: w.venue, good: GOOD, side: 'ASK', quantity: all, limit_price: 10 });
    runOk(w.runtime, 'place');
    expect(w.runtime.ledger.goodsInAccount(storesAccount(A)).get(GOOD) ?? 0).toBe(0);
    const first = w.runtime.market.openFor(A)[0];
    expect(first).toBeDefined();
    if (first === undefined) return;

    // Same size at a new price: only the returning escrow can fund it.
    go(w.runtime, A, { operation: 'modify', order: first.id, limit_price: 14 }, 0);
    runOk(w.runtime, 'modify');
    expect(w.runtime.takeCorrections(A).length, 'a legal ASK reprice was refused').toBe(0);
    const after = w.runtime.market.openFor(A)[0];
    expect(after?.limitPrice).toBe(14);
    expect(after?.quantity).toBe(all);
    expect(w.runtime.ledger.goodsInAccount(marketEscrowAccount(A)).get(GOOD) ?? 0).toBe(all);
  });
});

describe('a resting BID survives the Reckoning (the settlement halt)', () => {
  /**
   * **The worst thing a market can do to this game, and it did it.**
   *
   * `checkInvariants` runs in TWO places: the tick loop's ASSERT, and
   * `reckoning/driver.ts`'s own stage inside the settlement transaction. The market
   * taught INV-4 what an order is by widening the obligation book — but only for the
   * first one. The driver was still handed the raw `SimpleObligationBook`, so every
   * open BID's cash lock read as "an encumbrance for a dead obligation", INV-4 fired
   * once per resting bid, and the Reckoning HALTED.
   *
   * Measured: four principals resting ordinary buy orders across one Reckoning →
   * 90 INV-4 violations and a PAUSED world at tick 287. Leaving a bid on the book
   * overnight is the most ordinary market act there is, so the halt was
   * agent-reachable (AGT-X9), it fired on the one night with an audience (A14), and
   * §15.4 puts a false halt in the same class as a false default.
   */
  it('runs a whole Reckoning with open bids and asks on the book, and does not halt', () => {
    const w = build('reckoning-book');
    // Every principal rests one BID and one ASK, at prices that never cross, so the
    // book is still full of live orders — and live locks — when the freeze reads the
    // world and the settlement pays out.
    for (const [i, who] of CAST.entries()) {
      expect(go(w.runtime, who, { operation: 'place', venue: w.venue, good: GOOD, side: 'BID', quantity: 3, limit_price: 5 + i }, 0)).toBe(true);
      expect(go(w.runtime, who, { operation: 'place', venue: w.venue, good: GOOD, side: 'ASK', quantity: 3, limit_price: 90 + i }, 1, 1)).toBe(true);
    }
    runOk(w.runtime, 'place');
    expect(w.runtime.market.open().filter((o) => o.side === 'BID').length).toBe(CAST.length);
    const locks = w.runtime.ledger.encumbrances.open().length;
    expect(locks, 'no cash lock is resting, so the settlement has nothing to trip over').toBe(CAST.length);

    // All the way through the freeze and the settlement.
    while (w.runtime.engine.tick < SETTLEMENT_PHASE + 1) {
      const report = w.runtime.runTick();
      if (report.halted) {
        throw new Error(
          `the world PAUSED at tick ${String(report.tick)} over a resting order: ` +
            report.violations
              .slice(0, 3)
              .map((v) => `${v.id} ${v.message}`)
              .join(' | '),
        );
      }
    }
    expect(w.runtime.engine.tick).toBeGreaterThan(SETTLEMENT_PHASE);
    // And the book is still there afterwards, escrow intact.
    expect(w.runtime.market.open().length).toBe(CAST.length * 2);
    expect(w.runtime.ledger.encumbrances.open().length).toBe(locks);
  });
});
