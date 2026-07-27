/**
 * Shared scaffolding for the predation suite.
 *
 * Two kinds, deliberately separate — the same split the Levy suite uses:
 *
 *   - {@link raidRow} builds a `RaidRecord` by hand, for the pure arithmetic. No runtime,
 *     no ledger, no clock.
 *   - {@link raidWorld} seats principals in a real `Runtime`, which is the only way to
 *     test what actually matters: `PREDATE` running inside the real tick, the raid book
 *     inside the real `state_hash`, the real verbs, and PRD-1..6 firing in the real
 *     ASSERT phase.
 *
 * **Principals are seated OUTSIDE the Commons on purpose.** A raid can never touch a
 * Commons target (A8), so a fixture that seated everyone in the Commons would make every
 * assertion about predation pass vacuously — the world would spawn nothing and the tests
 * would be green about a mechanic that never ran. `raidWorld` therefore seats in the
 * MARCHES by default and `commonsWorld` is the explicit opposite, used to prove the floor.
 */

import { expect } from 'vitest';
import { Rng } from '../../src/core/rng.js';
import { TICKS_PER_RECKONING, setSpeed } from '../../src/core/time.js';
import type { GameEvent, GoodId, PrincipalId, SystemId } from '../../src/core/types.js';
import { minor, qty } from '../../src/core/units.js';
import { LEVY_GOOD } from '../../src/levy/index.js';
import { raidIdFor, type RaidRecord } from '../../src/predation/index.js';
import { Runtime, type PendingCorrection } from '../../src/sim/runtime.js';
import { tierOf } from '../../src/world/index.js';

export const SETTLE_TICK = TICKS_PER_RECKONING - 1;

export interface RaidWorld {
  readonly runtime: Runtime;
  readonly principals: readonly PrincipalId[];
  readonly stage: SystemId;
}

/**
 * A world with `count` principals seated at one **non-Commons** system.
 *
 * One system, so every principal's goods stand at the same stage and the target rule has
 * a real ranking to do rather than one candidate.
 */
export function raidWorld(seed: string, count = 3, tier: 'MARCHES' | 'FRONTIER' = 'MARCHES'): RaidWorld {
  setSpeed('instant');
  const runtime = new Runtime({ seed });
  const stage = runtime.seatInTier(tier, Rng.fromSeed(`${seed}:stage`));
  if (stage === undefined) throw new Error(`the launch map has no ${tier} system`);
  const principals: PrincipalId[] = [];
  for (let i = 0; i < count; i += 1) {
    const handle = `rp${String(i + 1).padStart(2, '0')}`;
    const principal = `p:${handle}` as PrincipalId;
    runtime.seat(principal, handle, stage);
    runtime.standing.open(principal);
    principals.push(principal);
  }
  return { runtime, principals, stage };
}

/** The explicit opposite: everyone in the Commons, where a raid is invalid (A8). */
export function commonsWorld(seed: string, count = 3): RaidWorld {
  setSpeed('instant');
  const runtime = new Runtime({ seed });
  const stage = runtime.seatInTier('COMMONS', Rng.fromSeed(`${seed}:stage`));
  if (stage === undefined) throw new Error('the launch map has no COMMONS system');
  const principals: PrincipalId[] = [];
  for (let i = 0; i < count; i += 1) {
    const handle = `cp${String(i + 1).padStart(2, '0')}`;
    const principal = `p:${handle}` as PrincipalId;
    runtime.seat(principal, handle, stage);
    runtime.standing.open(principal);
    principals.push(principal);
  }
  expect(tierOf(runtime.world.map, stage)).toBe('COMMONS');
  return { runtime, principals, stage };
}

/** Run one tick and fail loudly on a halt: a halted world makes every later assert a lie. */
export function tick(runtime: Runtime): void {
  const report = runtime.runTick();
  if (report.halted) {
    throw new Error(
      `halted at tick ${String(report.tick)}: ` +
        report.violations.map((v) => `${v.id} ${v.message}`).join(' | '),
    );
  }
  expect(report.violations.filter((v) => v.severity === 'HALT')).toEqual([]);
}

export function runTo(runtime: Runtime, target: number): void {
  while (runtime.engine.tick < target) tick(runtime);
}

export function submit(
  runtime: Runtime,
  principal: PrincipalId,
  verb: string,
  params: Readonly<Record<string, unknown>>,
  sequence = 0,
): void {
  const outcome = runtime.engine.submit({
    principal,
    verb,
    params,
    clientSequence: sequence,
    arrivalMs: sequence,
    decisionSource: 'LIVE',
  });
  if (!outcome.ok) throw new Error(`submit ${verb}: ${outcome.invariant} ${outcome.hint}`);
}

/** Submit one act, run the tick, and return the handler's refusal if there was one. */
export function act(
  runtime: Runtime,
  principal: PrincipalId,
  verb: string,
  params: Readonly<Record<string, unknown>>,
): PendingCorrection | null {
  submit(runtime, principal, verb, params);
  tick(runtime);
  return runtime.takeCorrections(principal)[0] ?? null;
}

/**
 * Submit one act and return **either** refusal — the door's or the handler's.
 *
 * Two doors refuse and they are not interchangeable: the Commons floor and the verb table
 * refuse at `submit`, before the tick; a handler refuses during `VALIDATE+LOCK` and its
 * sentence arrives on the correction channel. A test that watched one would pass silently
 * while the other was broken, and for predation it is the *floor* that matters most.
 */
export function attempt(
  runtime: Runtime,
  principal: PrincipalId,
  verb: string,
  params: Readonly<Record<string, unknown>>,
): { readonly invariant: string; readonly hint: string } | null {
  const outcome = runtime.engine.submit({
    principal,
    verb,
    params,
    clientSequence: 0,
    arrivalMs: 0,
    decisionSource: 'LIVE',
  });
  if (!outcome.ok) {
    tick(runtime);
    return { invariant: outcome.invariant, hint: outcome.hint };
  }
  tick(runtime);
  const correction = runtime.takeCorrections(principal)[0];
  return correction === undefined ? null : { invariant: correction.invariant, hint: correction.hint };
}

/** Every event of one kind, in tick order. The record is the only public surface. */
export function eventsOfKind(runtime: Runtime, kind: string): readonly GameEvent[] {
  const out: GameEvent[] = [];
  for (const t of runtime.events.ticks()) {
    for (const rec of runtime.events.eventsAtTick(t)) {
      if (rec.event.kind === kind) out.push(rec.event);
    }
  }
  return out;
}

/** Run until the world has spawned a raid, or fail with what it did instead. */
export function runToFirstRaid(runtime: Runtime, limit = TICKS_PER_RECKONING): RaidRecord {
  for (let n = 0; n < limit; n += 1) {
    const live = runtime.raids.live()[0];
    if (live !== undefined) return live;
    tick(runtime);
  }
  throw new Error(
    `no raid spawned in ${String(limit)} ticks; the book holds ${String(runtime.raids.size())} rows ` +
      `and the operator faults are: ${runtime.operatorFaults().slice(0, 3).join(' | ')}`,
  );
}

/** A raid row built by hand, for the arithmetic tests. Nothing here touches a ledger. */
export function raidRow(over: Partial<RaidRecord> = {}): RaidRecord {
  return {
    id: raidIdFor(48, 0),
    // A WORLD raid by default, because that is what every test written before `demand` existed
    // was about. `raidRow({ initiator: ... })` is the agent-initiated one, and the two differ in
    // six rules — the aggression count, the two world protections, the frame, the ticker and
    // PRD-7 — so a default of "somebody" would have made those tests quietly about the wrong thing.
    initiator: null,
    target: 'p:target' as PrincipalId,
    stage: 'sys-x' as SystemId,
    good: LEVY_GOOD,
    demandQty: qty(3_000),
    force: 3,
    spawnedAtTick: 48,
    resolvesAtTick: 72,
    state: 'DEMANDED',
    answer: null,
    answeredAtTick: null,
    parties: [],
    resolvedAtTick: null,
    lostQty: qty(0),
    forfeited: minor(0),
    defenderForce: 0,
    raiderForce: 0,
    ...over,
  };
}

/** The levy good, which is the only good this build produces. Named once. */
export const GOOD: GoodId = LEVY_GOOD;
