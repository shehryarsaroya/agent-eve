/**
 * `Ledger.hydrateAppendOnly` — putting the posting log back, and refusing to guess.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **WHY THIS METHOD EXISTS, AND WHAT IT IS NOT.**
 *
 * `restoreTo` refuses to GROW the append-only halves, and two earlier passes read
 * that as the blocker to a bounded boot. It is not: it is an abort-path inverse, and
 * inside one process a capture can only describe a prefix of a log the ledger already
 * holds, so growth there really does mean a corrupt triple. The cross-process problem
 * is that a fresh process has an almost-empty log and a snapshot from tick 575, and
 * the honest answer is to put the missing rows back from the durable record — not to
 * teach the rollback path to invent them.
 *
 * So the property under test is: **after a hydrate, `restoreTo` is SATISFIED, not
 * relaxed.** The last test in this file asserts the refusal still bites.
 *
 * The second property is that a hydrate never repairs. `checkInv7` recomputes every
 * balance by summing the whole posting log on every tick, so a log short or long by
 * one row is a world that boots and dies a tick later with no cause attached. Every
 * mismatch here is therefore a refusal at boot, where it can still name the reason.
 * ══════════════════════════════════════════════════════════════════════════
 */

import { describe, expect, it } from 'vitest';
import { minor, qty } from '../../src/core/units.js';
import type { AccountId, Posting } from '../../src/core/types.js';
import {
  CURRENCY_FAUCET,
  Ledger,
  checkInv7,
  ledgerStateTable,
  openStores,
  type AppliedBatch,
  type LedgerRestore,
} from '../../src/ledger/index.js';
import { qtyDelta } from '../../src/ledger/delta.js';
import { ALICE, A_STORES, BOB, B_STORES, ev, fundedWorld, ORE } from './fixture.js';

/** A live world's whole append-only log, exactly as the ledger holds it. */
function logOf(l: Ledger): { batches: readonly AppliedBatch[]; postings: number } {
  return { batches: l.allBatches().map((b) => ({ ...b })), postings: l.allPostings().length };
}

/** A fresh ledger with the same accounts, and nothing in its log. */
function bareLedger(): Ledger {
  const l = new Ledger();
  openStores(l, ALICE);
  openStores(l, BOB);
  return l;
}

describe('Ledger.hydrateAppendOnly', () => {
  it('rebuilds the log so a capture from a live ledger restores into a fresh one', () => {
    const live = fundedWorld().ledger;
    const captured = ledgerStateTable(
      () => live,
      () => {
        throw new Error('unused');
      },
    ).capture();

    const fresh = bareLedger();
    const log = logOf(live);
    fresh.hydrateAppendOnly(log.batches, {
      postingCount: log.postings,
      batchCount: log.batches.length,
    });

    // The whole point: `restoreTo` is now satisfied rather than relaxed. It still
    // refuses to grow — the lengths simply already match.
    let restored: LedgerRestore | null = null;
    ledgerStateTable(
      () => fresh,
      (r) => {
        restored = r;
        fresh.restoreTo(r);
      },
    ).restore?.(captured);

    expect(restored).not.toBeNull();
    expect(fresh.allPostings().length).toBe(live.allPostings().length);
    expect(fresh.allBatches().length).toBe(live.allBatches().length);
    expect(fresh.balance(A_STORES)).toBe(live.balance(A_STORES));
    // And the mirror INV-7 recomputes from the whole log agrees, which is the check
    // that kills a hydrate that is short by one row.
    expect(checkInv7(fresh, 1)).toEqual([]);
    expect(fresh.stateHash()).toBe(live.stateHash());
  });

  it('MUTATION PROOF: a log short by one posting is refused, and would fail INV-7 if it were not', () => {
    const live = fundedWorld().ledger;
    const log = logOf(live);
    const short = log.batches.slice(0, -1);
    const shortPostings = short.reduce((n, b) => n + b.postings.length, 0);

    // The refusal, with the counts named.
    expect(() =>
      bareLedger().hydrateAppendOnly(short, {
        postingCount: log.postings,
        batchCount: log.batches.length,
      }),
    ).toThrow(/the record yields .* but the snapshot was taken over/);

    // And the proof that the refusal is not decorative: hydrate the short log under
    // its OWN counts (so the length check passes), restore the live balances over it,
    // and INV-7 bites exactly as the boot-then-die path would.
    const dying = bareLedger();
    dying.hydrateAppendOnly(short, {
      postingCount: shortPostings,
      batchCount: short.length,
    });
    dying.restoreTo({
      accounts: live.allAccounts().map((a) => ({ ...a, movedQty: new Map(a.movedQty) })),
      lots: live.allLots().map((l) => ({ ...l })),
      // Empty is fine here: INV-7's mirrors read balances, lots and the supply legs,
      // never the lock table, so the locks are not what this proof turns on.
      encumbrances: { rows: [], exposure: [], perEvent: [] },
      postingCount: shortPostings,
      batchCount: short.length,
    });
    expect(checkInv7(dying, 1).length).toBeGreaterThan(0);
  });

  it('MUTATION PROOF: a log long by one posting is refused too', () => {
    const live = fundedWorld().ledger;
    const log = logOf(live);
    expect(() =>
      bareLedger().hydrateAppendOnly(log.batches, {
        postingCount: log.postings - 1,
        batchCount: log.batches.length,
      }),
    ).toThrow(/the record yields/);
  });

  it('refuses a second hydrate, so a running world cannot have its history replaced', () => {
    const l = bareLedger();
    l.hydrateAppendOnly([], { postingCount: 0, batchCount: 0 });
    expect(() => l.hydrateAppendOnly([], { postingCount: 0, batchCount: 0 })).toThrow(
      /already been hydrated/,
    );
  });

  it('refuses a malformed batch rather than storing one INV-1 would halt on next tick', () => {
    const posting = (account: AccountId, amountMinor: number): Posting => ({
      eventId: ev('e'),
      account,
      good: null,
      amountMinor: minor(amountMinor),
      amountQty: null,
    });

    const cases: readonly (readonly [string, AppliedBatch, RegExp])[] = [
      [
        'no postings',
        { eventId: ev('e'), tick: 0, kind: 'TRANSFER', postings: [], supply: null },
        /no postings/,
      ],
      [
        'TRANSFER carrying a supply leg',
        {
          eventId: ev('e'),
          tick: 0,
          kind: 'TRANSFER',
          postings: [posting(A_STORES, 5)],
          supply: { direction: 'ISSUE', account: CURRENCY_FAUCET.STARTER_STAKE },
        },
        /supply leg/,
      ],
      [
        'ISSUE with no supply leg',
        {
          eventId: ev('e'),
          tick: 0,
          kind: 'ISSUE',
          postings: [posting(A_STORES, 5)],
          supply: null,
        },
        /supply leg/,
      ],
      [
        'a posting whose event is not its batch’s',
        {
          eventId: ev('other'),
          tick: 0,
          kind: 'TRANSFER',
          postings: [posting(A_STORES, 5), posting(B_STORES, -5)],
          supply: null,
        },
        /carries event/,
      ],
      [
        'a posting that is neither a currency nor a goods leg',
        {
          eventId: ev('e'),
          tick: 0,
          kind: 'TRANSFER',
          postings: [
            {
              eventId: ev('e'),
              account: A_STORES,
              good: ORE,
              amountMinor: minor(7),
              amountQty: qtyDelta(1),
            },
          ],
          supply: null,
        },
        /neither a currency leg nor a goods leg/,
      ],
    ];

    for (const [name, batch, pattern] of cases) {
      expect(() =>
        bareLedger().hydrateAppendOnly([batch], {
          postingCount: batch.postings.length,
          batchCount: 1,
        }),
        name,
      ).toThrow(pattern);
    }
  });

  it('refuses a log whose ticks go backwards; append order is the record’s order', () => {
    const p = (t: number): AppliedBatch => ({
      eventId: ev(`e:${String(t)}`),
      tick: t,
      kind: 'TRANSFER',
      postings: [
        {
          eventId: ev(`e:${String(t)}`),
          account: A_STORES,
          good: null,
          amountMinor: minor(5),
          amountQty: null,
        },
        {
          eventId: ev(`e:${String(t)}`),
          account: B_STORES,
          good: null,
          amountMinor: minor(-5),
          amountQty: null,
        },
      ],
      supply: null,
    });
    expect(() =>
      bareLedger().hydrateAppendOnly([p(5), p(2)], { postingCount: 4, batchCount: 2 }),
    ).toThrow(/append-only in time/);
  });

  it('restoreTo STILL refuses to grow the append-only halves — the refusal was not weakened', () => {
    const l = bareLedger();
    l.issueCurrency({
      eventId: ev('one'),
      tick: 0,
      faucet: CURRENCY_FAUCET.STARTER_STAKE,
      to: A_STORES,
      amount: minor(1_000),
    });
    expect(() =>
      l.restoreTo({
        accounts: [],
        lots: [],
        encumbrances: { rows: [], exposure: [], perEvent: [] },
        // One more posting than the ledger holds: a snapshot from a future it never
        // reached. This is the case the hydrate does NOT cover and must not.
        postingCount: l.allPostings().length + 1,
        batchCount: l.allBatches().length,
      }),
    ).toThrow(/restore would grow an append-only table/);
  });

  it('a hydrated goods posting keeps its sign; qty() would refuse the outbound leg', () => {
    const live = fundedWorld().ledger;
    live.transferGoods({
      eventId: ev('haul'),
      tick: 1,
      lotId: live.lotsInAccount(A_STORES)[0]?.id ?? ('x' as never),
      to: B_STORES,
      qty: qty(10),
    });
    const log = logOf(live);
    const fresh = bareLedger();
    fresh.hydrateAppendOnly(log.batches, {
      postingCount: log.postings,
      batchCount: log.batches.length,
    });
    const negatives = fresh
      .allPostings()
      .filter((p) => p.amountQty !== null && p.amountQty < 0);
    expect(negatives.length).toBeGreaterThan(0);
  });
});
