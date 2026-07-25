/**
 * The tick loop's fixture. `two_principals_one_good`-shaped and deliberately
 * content-free.
 *
 * `TESTING.md` §16: "Fixtures as named worlds, not ad-hoc setup ... Every scenario
 * test names its fixture, so a fixture change fails loudly everywhere instead of
 * quietly somewhere."
 *
 * DET-2's whole point is that it "runs *before any content exists*", so nothing
 * here needs a ledger, a venture or a market. What it does need is actions that
 * genuinely move state — a run where every action is refused would pass DET-2
 * trivially, which is the worst kind of green.
 */

import { Rng } from '../../src/core/rng.js';
import type { DecisionSource, HandId, PrincipalId, SystemId } from '../../src/core/types.js';
import {
  commonsSystems,
  createWorld,
  enroll,
  handsOf,
  launchMap,
  tierOf,
  type WorldMap,
  type WorldState,
} from '../../src/world/index.js';
import { Engine, type EngineOptions, type SubmittedAction, type VerbHandler } from '../../src/tick/index.js';

export const FIXTURE_SEED = 'tick-fixture-1';

export interface FixtureOptions {
  readonly seed?: string;
  readonly principals?: number;
  readonly verbs?: Readonly<Record<string, VerbHandler>>;
  readonly extra?: Omit<EngineOptions, 'world' | 'seed'>;
}

export interface Fixture {
  readonly engine: Engine;
  readonly world: WorldState;
  readonly map: WorldMap;
  readonly principals: readonly PrincipalId[];
}

/** Seat `principals` in the Commons, in a deterministic order. */
export function seatWorld(count: number): { world: WorldState; principals: PrincipalId[] } {
  const map = launchMap();
  const world = createWorld(map);
  const seats = commonsSystems(map);
  const principals: PrincipalId[] = [];
  for (let i = 0; i < count; i += 1) {
    // Padded ids so byte order and numeric order agree — otherwise `p-10` sorts
    // before `p-2` and every expectation in a test reads as a bug in the engine.
    const principal = `p-${String(i + 1).padStart(3, '0')}` as PrincipalId;
    const seat = seats[i % seats.length];
    if (seat === undefined) throw new Error('the launch map has no Commons system to seat into');
    enroll(world, principal, `holding-${String(i + 1)}`, 0, seat);
    principals.push(principal);
  }
  return { world, principals };
}

export function fixture(options: FixtureOptions = {}): Fixture {
  const { world, principals } = seatWorld(options.principals ?? 4);
  const engine = new Engine({
    ...(options.extra ?? {}),
    world,
    seed: options.seed ?? FIXTURE_SEED,
    ...(options.verbs === undefined ? {} : { verbs: options.verbs }),
  });
  return { engine, world, map: world.map, principals };
}

/**
 * A legal one-gate move for a principal's first hand, staying inside the Commons.
 *
 * Commons-bound hands may only move between COMMONS systems (A15), so a
 * destination outside would be refused — and a fixture whose actions are all
 * refused proves nothing about determinism.
 */
export function commonsMove(
  world: WorldState,
  principal: PrincipalId,
  handIndex = 0,
): { readonly hand: HandId; readonly to: SystemId } | null {
  const hand = handsOf(world, principal)[handIndex];
  if (hand === undefined) return null;
  const system = world.map.systems.get(hand.location);
  if (system === undefined) return null;
  for (const lane of system.lanes) {
    if (tierOf(world.map, lane) === 'COMMONS') return { hand: hand.id, to: lane };
  }
  return null;
}

export interface SubmissionSpec {
  readonly principal: PrincipalId;
  readonly verb: string;
  readonly params?: Record<string, unknown>;
  readonly clientSequence?: number;
  readonly decisionSource?: DecisionSource;
}

let arrivalCounter = 0;

/** A submission with a distinct arrival stamp, so permutations are visible. */
export function submission(spec: SubmissionSpec): SubmittedAction {
  arrivalCounter += 1;
  return {
    principal: spec.principal,
    verb: spec.verb,
    params: spec.params ?? {},
    clientSequence: spec.clientSequence ?? 0,
    // Monotone but meaningless: nothing in the engine reads it, which is the claim
    // DET-2 exists to prove.
    arrivalMs: arrivalCounter,
    decisionSource: spec.decisionSource ?? 'LIVE',
  };
}

/** One move per principal, all legal, all mutating. The DET-2 action set. */
export function moveEveryone(world: WorldState, principals: readonly PrincipalId[]): SubmittedAction[] {
  const out: SubmittedAction[] = [];
  for (const principal of principals) {
    const move = commonsMove(world, principal);
    if (move === null) continue;
    out.push(submission({ principal, verb: 'move', params: { hand: move.hand, to: move.to } }));
  }
  return out;
}

/** A seeded permutation. Deterministic, so a failing permutation is reproducible. */
export function permute<T>(items: readonly T[], seed: string): T[] {
  return Rng.fromSeed(seed).shuffle([...items]);
}

/**
 * The verb a counting stub is registered under.
 *
 * It must be a verb `src/world/commons.ts` classifies, because `classifyAction`
 * treats an **unknown verb as HOSTILE** and the Commons floor then refuses it for
 * naming no target. That is correct fail-closed behaviour, and it produced a real
 * false green in the first draft of these tests: every stub action was silently
 * refused while the assertions about hashes still passed. `scan` is PEACEFUL and
 * MATERIAL, which is exactly the shape a budget test needs.
 */
export const PROBE_VERB = 'scan';

/** A handler that always accepts. For tests about ordering rather than semantics. */
export const OK_VERB: VerbHandler = () => ({ ok: true, value: null });

/** The probe verb, registered to always accept. */
export function probeVerbs(): Readonly<Record<string, VerbHandler>> {
  return { [PROBE_VERB]: OK_VERB };
}

/**
 * A verb that counts its invocations and nothing else.
 *
 * Used by the A3 test: a standing intent has to be shown *running*, and a real verb
 * would drag in whether the world happened to permit it that tick. Counting is the
 * narrowest possible observable.
 */
export function countingVerb(): {
  readonly verb: VerbHandler;
  readonly calls: () => number;
  readonly byPrincipal: () => ReadonlyMap<PrincipalId, number>;
} {
  let calls = 0;
  const per = new Map<PrincipalId, number>();
  return {
    verb: (_ctx, request) => {
      calls += 1;
      per.set(request.principal, (per.get(request.principal) ?? 0) + 1);
      return { ok: true, value: null };
    },
    calls: () => calls,
    byPrincipal: () => per,
  };
}
