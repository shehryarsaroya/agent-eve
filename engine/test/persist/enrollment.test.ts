/**
 * Externally-enrolled identities survive a restart.
 *
 * The house cast is re-seated deterministically from the seed, but an agent that
 * enrolled over HTTP is not in the seed — it is only in the journal. This proves the
 * enrolment is persisted and re-applied at the right tick, so the booted world holds
 * the newcomer AND reproduces the exact `state_hash` a Reckoning snapshot captured
 * with it present (A10: identity never resets, now true at the substrate).
 */

import { describe, expect, it } from 'vitest';
import { Runtime } from '../../src/sim/runtime.js';
import { HeuristicCast } from '../../src/cast/index.js';
import { InMemoryJournalStore, Journal, bootFromStore } from '../../src/persist/index.js';
import type { PrincipalId } from '../../src/core/types.js';

const SEED = 'enroll-durability';
const NEWCOMER = 'p:newcomer' as PrincipalId;

function seatedRuntime(seed: string): Runtime {
  const runtime = new Runtime({ seed });
  new HeuristicCast(runtime, { size: 5 }).seat(seed);
  return runtime;
}

describe('external enrolment survives a restart', () => {
  it('re-seats the newcomer and reproduces the head hash with it present', async () => {
    const runtime = new Runtime({ seed: SEED });
    const cast = new HeuristicCast(runtime, { size: 5 });
    cast.seat(SEED);
    const store = new InMemoryJournalStore();
    const journal = new Journal(store);
    await bootFromStore(runtime, store, { seed: SEED }); // GENESIS

    const runAndRecord = (n: number): void => {
      for (let i = 0; i < n; i += 1) {
        const target = runtime.engine.tick + 1;
        for (const a of cast.decide(target, SEED)) runtime.engine.submit(a);
        journal.record(runtime, runtime.runTick());
      }
    };

    // Warm up, then a stranger enrols over "HTTP" (here: the same runtime.seat the
    // enroll route calls) — recorded to the journal exactly as serve() will.
    runAndRecord(50);
    const enrollTick = runtime.engine.tick + 1;
    runtime.seat(NEWCOMER, 'newcomer');
    journal.recordEnrollment({
      principal: NEWCOMER,
      handle: 'newcomer',
      publicKey: 'QUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUE',
      enrolledAtTick: enrollTick,
      ownerEmail: null,
    });
    expect(runtime.world.holdingByPrincipal.has(NEWCOMER)).toBe(true);

    // Run past the first Reckoning (settlement at 287) so a snapshot captures the
    // newcomer, then flush everything.
    runAndRecord(300 - enrollTick);
    await journal.drain();
    const headTick = runtime.engine.tick;
    const headHash = runtime.engine.stateHash;
    expect(headTick).toBeGreaterThan(287);

    // Restart: a fresh runtime with only the cast seated, then boot from the journal.
    const booted = seatedRuntime(SEED);
    expect(booted.world.holdingByPrincipal.has(NEWCOMER)).toBe(false); // not from the seed
    const result = await bootFromStore(booted, store, { seed: SEED });

    expect(result.enrollmentsApplied).toBe(1);
    expect(result.tripwiresChecked).toBeGreaterThanOrEqual(1); // the 287 snapshot verified
    expect(booted.world.holdingByPrincipal.has(NEWCOMER)).toBe(true); // re-seated from the journal
    expect(booted.engine.tick).toBe(headTick);
    expect(booted.engine.stateHash).toBe(headHash); // the enrolment is inside the reproduced hash
  }, 120_000);
});
