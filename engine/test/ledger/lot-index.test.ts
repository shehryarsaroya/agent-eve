/**
 * `lotsInAccount` IS AN INDEX NOW, AND IT MUST RETURN EXACTLY WHAT THE SCAN RETURNED.
 *
 * It was `allLots().filter(l => l.account === account)`, and `allLots()` **sorts every lot in the
 * galaxy** on every call. `clearMarkets` reaches it through `escrowedGoods` once per ask principal
 * per book, so at a few hundred books and ten thousand lots that is on the order of 10^8 comparator
 * calls per tick — seconds, in a design whose §15 budget is single-digit milliseconds. Unlike the
 * other scaling findings in D14 §6 this one is **not history-dependent**: it bites at today's volumes.
 *
 * The change is safe for one specific reason: **a lot's `account` is never reassigned in place.** A
 * move is a delete plus an open, so there are exactly three sites to maintain — `restore`, the
 * `opens` loop, and the zero-qty delete — and nothing outside `ledger.ts` touches `this.lots`.
 * `allLots()` and the state table are untouched, so `state_hash` cannot move.
 *
 * ── WHY THIS IS A DIFFERENTIAL TEST ──────────────────────────────────────────
 * The claim "a global id sort filtered to one account is the same sequence as that account's ids
 * sorted" is obviously true and is exactly the kind of sentence that turns out to have an exception.
 * So rather than assert a property I reasoned my way to, every case below recomputes the OLD answer
 * from `allLots()` and demands the new one equal it, element for element. If the index ever drifts —
 * a fourth mutation site, a missed rebuild — this fails with the two lists side by side.
 *
 * ── ONE THING THIS FILE CANNOT SEE, MEASURED BY MUTATION ─────────────────────
 * Deleting `unindexLot`'s call site leaves every test here GREEN. That is not a gap in the
 * assertions, it is what the reader does: `lotsInAccount` looks each id up in `lots` and skips the
 * ones that are gone, so a stale entry is filtered out at read time and the ANSWER stays correct.
 *
 * The delete-side maintenance therefore bounds **growth**, not correctness — without it
 * `lotsByAccount` accumulates an id for every lot ever created, which is scar #3 with an index in
 * front of it. The property is unasserted because the map is private and exposing a size accessor to
 * a test is a worse trade than saying so here. Skipping the `restore` rebuild DOES fail, by name, and
 * that is the correctness half.
 */

import { describe, expect, it } from 'vitest';
import { HeuristicCast } from '../../src/cast/index.js';
import { setSpeed } from '../../src/core/time.js';
import { Runtime } from '../../src/sim/runtime.js';
import { ledgerStateTable } from '../../src/ledger/stateTable.js';
import type { AccountId } from '../../src/core/types.js';
import type { Lot } from '../../src/ledger/lots.js';

/** The implementation this replaced, kept here as the oracle. */
function byScan(all: readonly Lot[], account: AccountId): readonly Lot[] {
  return all.filter((l) => l.account === account);
}

function ids(lots: readonly Lot[]): readonly string[] {
  return lots.map((l) => String(l.id));
}

/** A world with real lots in real accounts: enrolment grants, extraction, deliveries, raids. */
function world(seed: string, ticks: number): Runtime {
  setSpeed('instant');
  const rt = new Runtime({ seed });
  const cast = new HeuristicCast(rt, { size: 8 });
  cast.seat(seed);
  for (let i = 0; i < ticks; i += 1) {
    for (const a of cast.decide(rt.engine.tick + 1, seed)) rt.engine.submit(a);
    const r = rt.runTick();
    if (r.halted) throw new Error(`halted at ${String(r.tick)}`);
  }
  return rt;
}

describe('the index answers exactly what the scan answered', () => {
  it('agrees for every account that holds a lot, in the same order', () => {
    const rt = world('lot-index', 320);
    const all = rt.ledger.allLots();
    // Non-vacuity: a world with no lots would make every comparison trivially equal.
    expect(all.length, 'the world must actually hold lots').toBeGreaterThan(0);

    const accounts = new Set<AccountId>(all.map((l) => l.account));
    expect(accounts.size, 'and they must be spread over several accounts').toBeGreaterThan(1);

    let compared = 0;
    for (const account of accounts) {
      compared += 1;
      expect(
        ids(rt.ledger.lotsInAccount(account)),
        `the index disagrees with the scan for ${String(account)} — a mutation site is unmaintained`,
      ).toEqual(ids(byScan(all, account)));
    }
    expect(compared).toBe(accounts.size);
  });

  it('agrees for an account that holds nothing, without inventing a row', () => {
    const rt = world('lot-index-empty', 40);
    const nobody = 'stores:p:does-not-exist' as AccountId;
    expect(rt.ledger.lotsInAccount(nobody)).toEqual([]);
    expect(ids(rt.ledger.lotsInAccount(nobody))).toEqual(ids(byScan(rt.ledger.allLots(), nobody)));
  });

  it('agrees tick by tick, so a drift is caught at the tick it starts', () => {
    // The single-snapshot version above would pass on an index that was wrong for 300 ticks and
    // right at the end. This walks the whole run.
    setSpeed('instant');
    const seed = 'lot-index-walk';
    const rt = new Runtime({ seed });
    const cast = new HeuristicCast(rt, { size: 6 });
    cast.seat(seed);
    let checks = 0;
    for (let i = 0; i < 200; i += 1) {
      for (const a of cast.decide(rt.engine.tick + 1, seed)) rt.engine.submit(a);
      expect(rt.runTick().halted).toBe(false);
      if (i % 10 !== 0) continue;
      const all = rt.ledger.allLots();
      for (const account of new Set<AccountId>(all.map((l) => l.account))) {
        checks += 1;
        expect(
          ids(rt.ledger.lotsInAccount(account)),
          `index drifted at tick ${String(rt.engine.tick)} for ${String(account)}`,
        ).toEqual(ids(byScan(all, account)));
      }
    }
    expect(checks, 'the walk must have compared something').toBeGreaterThan(20);
  });

  it('survives a restore, because the index is derived and must be rebuilt', () => {
    // `restore` clears and repopulates `lots`, so it must rebuild the index too. If it did not, an
    // adopted or rolled-back world would answer `lotsInAccount` from a stale map — and a wrong lot
    // set is a wrong escrow, which is a wrong settlement.
    const rt = world('lot-index-restore', 200);
    const all = rt.ledger.allLots();
    const accounts = [...new Set<AccountId>(all.map((l) => l.account))];
    expect(accounts.length).toBeGreaterThan(1);
    const before = new Map(accounts.map((a) => [a, ids(rt.ledger.lotsInAccount(a))]));

    // Round-trip through the LEDGER STATE TABLE, which is the path a rollback and an adopted boot
    // both take — `restoreTo` alone is not the whole story and the table is what the tick loop uses.
    const table = ledgerStateTable(
      () => rt.ledger,
      (restore) => {
        rt.ledger.restoreTo(restore);
      },
    );
    const captured = table.capture();
    if (table.restore === undefined) throw new Error('the ledger table must be restorable');
    table.restore(captured);

    for (const account of accounts) {
      expect(
        ids(rt.ledger.lotsInAccount(account)),
        `after restore the index disagrees for ${String(account)} — it was not rebuilt`,
      ).toEqual(before.get(account));
      // And against the scan, so this cannot pass by two broken paths agreeing.
      expect(ids(rt.ledger.lotsInAccount(account))).toEqual(
        ids(byScan(rt.ledger.allLots(), account)),
      );
    }
  });
});
