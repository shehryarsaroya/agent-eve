/**
 * `state_hash` must attest to MONEY, and the abort path must restore it.
 *
 * A verifier found the sim registered exactly one state table (`venture`), so the
 * ledger was in neither. Two consequences, each contradicting a claim the project
 * makes about itself:
 *
 *   1. **The hash could not see the money.** Two runs with identical world, intent
 *      and venture state but divergent BALANCES hashed the same. DET-1 ("same seed,
 *      identical state_hash") held while saying nothing about the one quantity the
 *      whole game is about. That is a permanent public record of value whose
 *      attestation excluded value.
 *   2. **A halt left the ledger dirty.** SPEC §15.2's operator story — replay the
 *      failed tick from the immutable triple and it "produces the world every observer
 *      was promised" — was false for the table settlement mutates most.
 *
 * These tests are written to FAIL if the ledger is ever unregistered again, which is a
 * single line in `src/sim/runtime.ts`.
 */

import { describe, expect, it } from 'vitest';
import { Runtime } from '../../src/sim/runtime.js';
import { minor } from '../../src/core/units.js';
import { compareIds } from '../../src/ledger/index.js';
import type { AccountId, EventId, PrincipalId } from '../../src/core/types.js';

function runTo(seed: string, ticks: number): Runtime {
  const rt = new Runtime({ seed });
  // Seat a few principals so there is money to move. Handles are deterministic so the
  // two runs a comparison needs are genuinely identical apart from the mutation.
  for (const n of ['vale', 'orison', 'halcyon', 'vex']) {
    rt.seat(`p:${n}` as PrincipalId, n);
  }
  for (let i = 0; i < ticks; i++) rt.runTick();
  return rt;
}

/** Two STORES accounts holding value, so a transfer between them is a real move. */
function twoFundedStores(rt: Runtime): readonly [AccountId, AccountId] {
  const funded = rt.ledger
    .allAccounts()
    .filter((a) => a.kind === 'STORES' && a.balanceMinor > 1_000)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const a = funded[0];
  const b = funded[1];
  if (a === undefined || b === undefined) {
    throw new Error(`fixture needs two funded STORES accounts, found ${String(funded.length)}`);
  }
  return [a.id, b.id];
}

describe('state_hash covers money', () => {
  it('the ledger is a registered state table at all', () => {
    // The whole defect was an absence, so the presence is asserted directly rather
    // than only through its consequences.
    const rt = runTo('money-registered', 5);
    const names = rt.engine.stateTables.map((t) => t.name).sort(compareIds);
    expect(names).toContain('ledger');
    expect(names).toContain('venture');
  });

  it('a balance change with NOTHING else changed moves the hash', () => {
    // The measurement that proves the point. Same seed, same tick count, so world,
    // intent and venture state are byte-identical between the two runs; the only
    // difference is that one of them moved money.
    const clean = runTo('money-hash', 40);
    const dirty = runTo('money-hash', 40);

    const cleanHash = clean.runTick().stateHash;

    const [from, to] = twoFundedStores(dirty);
    dirty.ledger.transferCurrency({
      from,
      to,
      amount: minor(1_000),
      eventId: 'probe:money-hash' as EventId,
      tick: 40,
    });
    const dirtyHash = dirty.runTick().stateHash;

    expect(cleanHash).not.toBe('');
    expect(dirtyHash).not.toBe(cleanHash);
  });

  it('the same run twice still hashes identically, so the table did not add nondeterminism', () => {
    // A capture that iterated a Map in insertion order would pass the test above and
    // silently break DET-1. Account and lot rows are sorted by id for exactly this
    // reason, and this is the assertion that holds them to it.
    const a = runTo('money-det', 60).runTick().stateHash;
    const b = runTo('money-det', 60).runTick().stateHash;
    expect(a).toBe(b);
  });

  it('capture/restore round-trips balances exactly', () => {
    const rt = runTo('money-roundtrip', 50);
    const table = rt.engine.stateTables.find((t) => t.name === 'ledger');
    if (table === undefined) throw new Error('the ledger table is not registered');
    if (table.restore === undefined) {
      throw new Error('the ledger table has no restore, so it cannot be rollback-complete');
    }

    const before = table.capture();
    const balancesBefore = rt.ledger
      .allAccounts()
      .map((a) => `${a.id}::${String(a.balanceMinor)}`)
      .sort(compareIds);

    const [from, to] = twoFundedStores(rt);
    rt.ledger.transferCurrency({
      from,
      to,
      amount: minor(777),
      eventId: 'probe:roundtrip' as EventId,
      tick: 50,
    });
    const balancesAfter = rt.ledger
      .allAccounts()
      .map((a) => `${a.id}::${String(a.balanceMinor)}`)
      .sort(compareIds);
    // The move was real, or the round-trip below proves nothing.
    expect(balancesAfter).not.toEqual(balancesBefore);

    table.restore(before);
    const balancesRestored = rt.ledger
      .allAccounts()
      .map((a) => `${a.id}::${String(a.balanceMinor)}`)
      .sort(compareIds);
    expect(balancesRestored).toEqual(balancesBefore);
  });

  it('refuses a snapshot that would GROW an append-only table', () => {
    // Truncation is an exact inverse only downwards. A restore that had to add a
    // posting would mean the snapshot came from a future this ledger never reached —
    // a corrupted triple, not a rollback — and silently accepting it would fabricate
    // history in the one table that is supposed to be immutable.
    const rt = runTo('money-grow', 20);
    expect(() =>
      rt.ledger.restoreTo({
        accounts: [],
        lots: [],
        encumbrances: { rows: [], exposure: [], perEvent: [] },
        endowments: [],
        postingCount: rt.ledger.allPostings().length + 1,
        batchCount: rt.ledger.allBatches().length,
      }),
    ).toThrow(/would grow an append-only table/);
  });
});
