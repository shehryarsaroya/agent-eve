/**
 * A deterministic presence soak: the driver behind SPEC §16 step 3's assertion —
 * "1,000 ticks, every hand in exactly one legal state, replay identical".
 *
 * It is a *fixture*, not a game: no ventures, no ledger, no market. It moves
 * hands, commits and releases them, loads and loses cargo, and asserts the world
 * invariants at the close of every tick. Everything it does comes out of a seeded
 * `Rng`, and it keeps its own shadow accounting so the exposed conservation term
 * (`cargoHeldByHands`) can be checked against a supply total that never changes.
 *
 * Why the shadow accounting is here rather than in the ledger's tests: the ledger
 * cannot see a hand. If `loseHand` quietly dropped cargo, INV-2 would fail in a
 * module that has no way to find the cause. Catching it on this side of the seam
 * is the difference between a five-minute fix and a day.
 */

import { Rng } from '../../src/core/rng.js';
import type { GoodId, HandId, InvariantViolation, PrincipalId, SystemId } from '../../src/core/types.js';
import { qty, type Qty } from '../../src/core/units.js';
import {
  cargoHeldByHands,
  checkWorldInvariants,
  commitHand,
  createWorld,
  enroll,
  handsInOrder,
  holdingOf,
  isPresent,
  launchMap,
  loadCargo,
  loseHand,
  moveHand,
  releaseHand,
  resolveMovement,
  systemOf,
  unloadCargo,
  worldHash,
  type HandRecord,
  type WorldState,
} from '../../src/world/index.js';

export const ORE = 'ORE' as GoodId;
export const FUEL = 'FUEL' as GoodId;
export const GOODS: readonly GoodId[] = [ORE, FUEL];

/** Total supply, minted once at tick 0 and never issued or retired again. */
const SUPPLY_PER_GOOD = 1_000;

export interface SoakOptions {
  readonly seed: string;
  readonly ticks: number;
  readonly principals: number;
}

export interface SoakResult {
  /** `state_hash` after each tick. DET-1/DET-3 compare these across runs. */
  readonly hashes: readonly string[];
  readonly violations: readonly InvariantViolation[];
  readonly statesSeen: ReadonlySet<string>;
  readonly counts: {
    moves: number;
    arrivals: number;
    losses: number;
    recoveries: number;
    commits: number;
    releases: number;
    commonsBoundRejections: number;
    otherRejections: number;
  };
  readonly finalState: WorldState;
}

export function runSoak(options: SoakOptions): SoakResult {
  const map = launchMap();
  const state = createWorld(map);
  const violations: InvariantViolation[] = [];
  const hashes: string[] = [];
  const statesSeen = new Set<string>();
  const counts = {
    moves: 0,
    arrivals: 0,
    losses: 0,
    recoveries: 0,
    commits: 0,
    releases: 0,
    commonsBoundRejections: 0,
    otherRejections: 0,
  };

  // Role fills live here, standing in for `venture_role.filled_by_hand_id`. The
  // world never stores them; it is handed them (§6.2).
  const fills = new Map<HandId, number>();

  // Shadow supply: goods sitting at systems, on hands, or destroyed. The three
  // must always add to SUPPLY_PER_GOOD.
  const stores = new Map<GoodId, Qty>();
  const lostSink = new Map<GoodId, Qty>();
  for (const good of GOODS) {
    stores.set(good, qty(SUPPLY_PER_GOOD));
    lostSink.set(good, qty(0));
  }

  // Seat principals across every tier, deterministically, so both halves of the
  // safe zone get exercised: Commons-bound hands that cannot leave, and hands
  // outside that can roam.
  const seatRng = Rng.fromSeed(`${options.seed}:seats`);
  for (let i = 0; i < options.principals; i += 1) {
    const principal = `p-${String(i + 1).padStart(3, '0')}` as PrincipalId;
    const seat = seatRng.pick(map.systemOrder);
    enroll(state, principal, `holding-${String(i + 1)}`, 0, seat);
  }

  for (let tick = 1; tick <= options.ticks; tick += 1) {
    // ── MOVE, before anything that resolves (SPEC §15.2) ────────────────────
    const outcome = resolveMovement(state, tick, (id) => (fills.get(id) ?? 0) > 0);
    counts.arrivals += outcome.arrivals.length;
    counts.recoveries += outcome.recoveries.length;

    // ── "actions" — one deterministic stream per tick, so inserting a consumer
    // in one tick cannot shift the draws of another.
    const rng = Rng.fromSeed(`${options.seed}:tick:${String(tick)}`);
    for (const hand of handsInOrder(state)) {
      const roll = rng.int(100);
      if (roll < 30) {
        tryMove(state, hand, tick, rng, counts);
      } else if (roll < 40) {
        tryCargo(state, hand, tick, rng, stores);
      } else if (roll < 45) {
        tryCommit(hand, fills, counts);
      } else if (roll < 50) {
        tryRelease(hand, fills, counts);
      } else if (roll < 52) {
        tryLose(state, hand, tick, rng, fills, lostSink, counts);
      }
    }

    // ── ASSERT ─────────────────────────────────────────────────────────────
    violations.push(...checkWorldInvariants(state, tick, fills));
    violations.push(...checkSupply(state, stores, lostSink, tick));
    for (const hand of state.hands.values()) statesSeen.add(hand.state);

    hashes.push(worldHash(state));
  }

  return { hashes, violations, statesSeen, counts, finalState: state };
}

function tryMove(
  state: WorldState,
  hand: HandRecord,
  tick: number,
  rng: Rng,
  counts: SoakResult['counts'],
): void {
  if (hand.state === 'IN_TRANSIT' || hand.state === 'RECOVERING') return;
  const lanes = systemOf(state.map, hand.location).lanes;
  if (lanes.length === 0) return;
  const destination: SystemId = rng.pick(lanes);
  const result = moveHand(state, hand.id, destination, tick);
  if (result.ok) {
    counts.moves += 1;
    return;
  }
  if (result.invariant === 'A15') counts.commonsBoundRejections += 1;
  else counts.otherRejections += 1;
}

function tryCargo(
  state: WorldState,
  hand: HandRecord,
  tick: number,
  rng: Rng,
  stores: Map<GoodId, Qty>,
): void {
  const good = rng.pick(GOODS);
  const held = hand.cargo.get(good) ?? 0;
  if (held > 0 && rng.chance(1, 2)) {
    const amount = qty(rng.range(1, held));
    const result = unloadCargo(hand, good, amount);
    if (result.ok) stores.set(good, qty((stores.get(good) ?? 0) + amount));
    return;
  }
  const available = stores.get(good) ?? 0;
  if (available <= 0) return;
  const amount = qty(rng.range(1, Math.min(5, available)));
  const result = loadCargo(hand, good, amount, tick);
  if (result.ok) stores.set(good, qty(available - amount));
}

function tryCommit(
  hand: HandRecord,
  fills: Map<HandId, number>,
  counts: SoakResult['counts'],
): void {
  if ((fills.get(hand.id) ?? 0) > 0) return;
  const result = commitHand(hand);
  if (!result.ok) return;
  fills.set(hand.id, 1);
  counts.commits += 1;
}

function tryRelease(
  hand: HandRecord,
  fills: Map<HandId, number>,
  counts: SoakResult['counts'],
): void {
  if ((fills.get(hand.id) ?? 0) === 0) return;
  fills.delete(hand.id);
  releaseHand(hand);
  counts.releases += 1;
}

function tryLose(
  state: WorldState,
  hand: HandRecord,
  tick: number,
  rng: Rng,
  fills: Map<HandId, number>,
  lostSink: Map<GoodId, Qty>,
  counts: SoakResult['counts'],
): void {
  if (hand.state === 'RECOVERING') return;
  // A lost hand must be released from its role, or INV-9's role check halts the
  // tick. In the game that release is a venture failure with a receipt; here it
  // is just the release, because the point is that the world never keeps a
  // recovering hand committed.
  fills.delete(hand.id);
  const home = holdingOf(state, hand.principal).system;
  const loss = loseHand(hand, tick, rng, home);
  for (const [good, amount] of loss.lostCargo) {
    lostSink.set(good, qty((lostSink.get(good) ?? 0) + amount));
  }
  counts.losses += 1;
}

/**
 * The INV-2-shaped check on this module's exposed term: goods at systems, plus
 * goods held by hands, plus goods destroyed, equals what was minted. A hand that
 * ate its cargo shows up here immediately.
 */
function checkSupply(
  state: WorldState,
  stores: ReadonlyMap<GoodId, Qty>,
  lostSink: ReadonlyMap<GoodId, Qty>,
  tick: number,
): InvariantViolation[] {
  const held = cargoHeldByHands(state.hands.values());
  const out: InvariantViolation[] = [];
  for (const good of GOODS) {
    const total = (stores.get(good) ?? 0) + (held.get(good) ?? 0) + (lostSink.get(good) ?? 0);
    if (total !== SUPPLY_PER_GOOD) {
      out.push({
        id: 'INV-2',
        message: `supply of ${good} is ${total}, minted ${SUPPLY_PER_GOOD}`,
        tick,
        severity: 'HALT',
      });
    }
  }
  return out;
}

/** Every hand is in exactly one of the four legal states — no other value exists. */
export function everyHandInOneLegalState(state: WorldState, legal: readonly string[]): boolean {
  for (const hand of handsInOrder(state)) {
    const matches = legal.filter((s) => s === hand.state);
    if (matches.length !== 1) return false;
  }
  return true;
}

/** Hands that are settled and able to act. Used to assert the soak did something. */
export function presentCount(state: WorldState, tick: number): number {
  return handsInOrder(state).filter((hand) => isPresent(hand, tick)).length;
}
