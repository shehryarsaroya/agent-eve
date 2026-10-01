/**
 * SERIALIZE-ONCE OBSERVATIONS (SPEC §15.5) — the bytes are the bytes.
 *
 * `api/fragments.ts` makes two changes to how an observation is produced: world-wide views are
 * computed once per read epoch (`Runtime.perEpoch`), and the frozen ones are serialized once and
 * spliced into each principal's envelope. Either could silently change what an agent reads — a stale
 * cached view after an enrolment, a fragment spliced into the wrong position, a payload string mistaken
 * for a token. So this file asserts the strongest property available: **for every principal, in a
 * populated world, the served bytes equal the reference build with every cache disabled** — before and
 * after a Reckoning, across submissions, and across an enrolment landing between two ticks.
 *
 * MUTATIONS EACH BLOCK IS BUILT TO KILL are named inline.
 */

import { describe, expect, it } from 'vitest';
import { buildObservation, type ObserveInput } from '../../src/api/observe.js';
import {
  FragmentCache,
  observationBody,
  referenceObservationBody,
  serializeObservation,
} from '../../src/api/fragments.js';
import { HeuristicCast } from '../../src/cast/index.js';
import { setSpeed, TICKS_PER_RECKONING } from '../../src/core/time.js';
import type { PrincipalId } from '../../src/core/types.js';
import { Runtime } from '../../src/sim/runtime.js';

const SEED = 'fragments-equivalence';

function input(runtime: Runtime, principal: PrincipalId): ObserveInput {
  return {
    runtime,
    principal,
    serverNowMs: 1_700_000_000_000,
    fresh: true,
    wakesRemaining: 9,
    stale: false,
    corrections: [],
    correctionsDropped: 0,
    actionsRemaining: 3,
  };
}

function everyone(runtime: Runtime): PrincipalId[] {
  return [...runtime.world.principalOrder];
}

/** Assert served == reference for every principal; return how many fragments the cache served. */
function assertIdentical(runtime: Runtime, cache: FragmentCache, label: string): number {
  const before = cache.served;
  for (const principal of everyone(runtime)) {
    const reference = referenceObservationBody(input(runtime, principal));
    const served = observationBody(input(runtime, principal), cache);
    if (served !== reference) {
      // Point at the first differing byte rather than dumping two 60 KB strings.
      let i = 0;
      while (i < served.length && served[i] === reference[i]) i += 1;
      throw new Error(
        `${label}: ${principal}'s served bytes differ from the reference at byte ${String(i)}:\n` +
          `  served    …${served.slice(Math.max(0, i - 80), i + 80)}\n` +
          `  reference …${reference.slice(Math.max(0, i - 80), i + 80)}`,
      );
    }
  }
  return cache.served - before;
}

describe('the served observation is byte-identical to the reference build', () => {
  setSpeed('instant');
  const runtime = new Runtime({ seed: SEED });
  const names = Array.from({ length: 36 }, (_, i) => `f${String(i + 1).padStart(3, '0')}`);
  const cast = new HeuristicCast(runtime, { size: names.length, names, wakeEvery: 3 });
  cast.seat(SEED);
  const cache = new FragmentCache();

  const run = (ticks: number): void => {
    for (let i = 0; i < ticks; i += 1) {
      for (const a of cast.decide(runtime.engine.tick + 1, SEED)) runtime.engine.submit(a);
      const report = runtime.runTick();
      if (report.halted) throw new Error(`halted at ${String(report.tick)}`);
    }
  };

  it('mid-Reckoning, with fragments actually spliced (non-vacuity)', () => {
    run(120);
    const served = assertIdentical(runtime, cache, 'tick 120');
    // MUTATION: stop registering `perEpoch` values. Nothing is a fragment, `served` is 0, and a splice
    // that never runs is a byte-identity test over the plain path. RED.
    expect(served).toBeGreaterThan(everyone(runtime).length);
  });

  it('with submissions sitting in the window between two ticks', () => {
    // A submission moves the queue and `electionsInFlight` without moving the read-epoch key, so any
    // shared view that read them would go stale here.
    for (const a of cast.decide(runtime.engine.tick + 1, SEED)) runtime.engine.submit(a);
    assertIdentical(runtime, cache, 'after submissions');
  });

  it('after an enrolment lands between two ticks', () => {
    // MUTATION: drop the enrolment terms (`principalOrder.length`, `memoEpoch`) from `perEpoch`'s key.
    // The Levy roll and the carry rows cached before the enrolment no longer contain the newcomer, and
    // the newcomer's own observation disagrees with the reference. RED — checked by hand on 2026-10-01.
    runtime.seat('p:latecomer' as PrincipalId, 'latecomer');
    assertIdentical(runtime, cache, 'after enrolment');
  });

  it('across the settlement, on the tick every agent wakes to read it', () => {
    const toSettle = TICKS_PER_RECKONING - 1 - runtime.engine.tick;
    run(toSettle + 1);
    expect(runtime.reckonings().length).toBeGreaterThan(0);
    assertIdentical(runtime, cache, 'the tick after the Reckoning');
  });

  it('serializes a shared fragment once per epoch, however many readers', () => {
    const fresh = new FragmentCache();
    const readers = everyone(runtime);
    for (const principal of readers) observationBody(input(runtime, principal), fresh);
    const once = fresh.serialized;
    expect(once).toBeGreaterThan(0);
    // A second pass in the same epoch serializes NOTHING: every fragment is the same frozen object,
    // and its text is already cached. MUTATION: rebuild a shared view per observation (bypass
    // `perEpoch`) — every pass then mints new objects and `serialized` grows. RED.
    for (const principal of readers) observationBody(input(runtime, principal), fresh);
    expect(fresh.serialized).toBe(once);
    expect(fresh.served).toBeGreaterThan(readers.length * 2);
    // And a world-wide view is ONE object across readers, which is what makes it a fragment at all.
    const [a, b] = readers;
    if (a === undefined || b === undefined) throw new Error('need two readers');
    const left = buildObservation(input(runtime, a)).header as Record<string, unknown>;
    const right = buildObservation(input(runtime, b)).header as Record<string, unknown>;
    expect(left['raid_schedule']).toBe(right['raid_schedule']);
    expect(left['live_verbs']).toBe(right['live_verbs']);
  });
});

describe('a payload that looks like a token cannot move a fragment', () => {
  it('falls back to the plain bytes when a string in the payload equals a token', () => {
    setSpeed('instant');
    const runtime = new Runtime({ seed: 'fragments-token' });
    runtime.seat('p:solo' as PrincipalId, 'solo');
    runtime.runTick();
    const observation = buildObservation(input(runtime, 'p:solo' as PrincipalId));
    // Plant the exact text of token 0 where an agent's words would go.
    const hostile = {
      ...observation,
      briefing: { ...(observation.briefing as Record<string, unknown>), prompt: '\u0000frag:0\u0000' },
    } as typeof observation;
    // MUTATION: drop the exactly-once check in `serializeObservation`. The planted string is
    // replaced by the first fragment's JSON and the bytes differ. RED.
    expect(serializeObservation(hostile, (v) => runtime.isSharedView(v), new FragmentCache())).toBe(
      JSON.stringify({ ok: true, observation: hostile }),
    );
  });
});
