/**
 * Hands — one unit of simultaneous physical presence (SPEC §6.2).
 *
 * Three rules from §6.2 are structural here, not conventions:
 *
 * 1. **Rows, not a count.** The feed needs to say "Vale's second hand fell at
 *    Orison", so a hand has an id and an ordinal. A `handCount` integer could not
 *    be named, mourned, or drawn.
 * 2. **Never destroyed.** A lost hand goes `RECOVERING` with a `freeAtTick`
 *    (INV-8). Loss is cargo, time and position — never capacity. Presence is the
 *    one dimension that gates *all* play, so permanent loss there would cripple an
 *    unlucky agent permanently and no amount of later skill could recover it.
 * 3. **Commitment lives in exactly one place**: `venture_role.filled_by_hand_id`.
 *    There is no `hand.venture_id` here and there must never be one — two homes
 *    for one quantity is scar #5 on the keystone. `COMMITTED` says *that* a hand
 *    is engaged, never *to what*, so it duplicates no reference; the agreement
 *    between it and the role table is asserted (INV-9), not assumed.
 */

import { Rng } from '../core/rng.js';
import { HAND_RECOVERY_TICKS } from '../core/time.js';
import type {
  GoodId,
  Hand,
  HandId,
  HandState,
  PrincipalId,
  SystemId,
} from '../core/types.js';
import { qty, type Qty } from '../core/units.js';
import { cmpStr, laneKey, transitTicks, type LaneKey, type WorldMap } from './map.js';
import { accept, reject, type WorldResult } from './result.js';

/** SPEC §17. Three, and it is a keystone: it also caps per-principal concurrency. */
export const HANDS_PER_PRINCIPAL = 3;

/**
 * ══════════════════════════════════════════════════════════════════════════
 * THE ARRIVAL DECISION — `TRACKER.md` open question 5, decided here, once.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * **A hand that arrives during tick T is NOT present at its destination in tick
 * T. It is present from T+1.**
 *
 * SPEC §15.2 names this a hazard and requires it to be "chosen and stated in
 * `agent.md`", because *the resolution order is itself a rules surface*. So it is
 * one exported constant, one sentence in {@link MOVEMENT_STATEMENT}, and one
 * place a reader can check the engine against the documentation.
 *
 * Why `false`:
 *   - **ETAs stay honest.** An agent told "arrives at T" and then permitted to
 *     work at T would be relying on a within-tick ordering it cannot see. Told
 *     "arrives at T, works from T+1", the arithmetic it plans with is the
 *     arithmetic the engine runs. A2: known arithmetic is exact.
 *   - **It is symmetric with departure.** A hand is not present at its origin
 *     from the tick it departs. Presence is exactly the ticks a hand is
 *     stationary and settled, at both ends.
 *   - **It is simpler to reason about, for us and for a model.** One rule with no
 *     exceptions beats a rule plus a list of phases where arrival counts early.
 *
 * What it deliberately does **not** change: an arrived hand *occupies* its
 * destination from tick T — it renders there, and it can be raided there. See
 * {@link occupiesSystem} versus {@link isPresent}. Immunity on the arrival tick
 * would make interception impossible (chain a move every tick and no predator can
 * ever reach you), which would delete §9 and the escort market with it.
 */
export const ARRIVAL_IS_PRESENT_SAME_TICK = false;

/**
 * The exact sentence `agent.md` must state, byte for byte. Golden-filed, so the
 * documentation cannot drift from the engine — the drift *is* scar #1, where the
 * agent-facing text and the resolver disagreed about one word and the game
 * reliably produced the opposite of what players intended.
 */
export const MOVEMENT_STATEMENT =
  'A hand that arrives at tick T occupies its destination at tick T and becomes PRESENT at tick T+1. ' +
  'It cannot work, escort, garrison or fill a role until T+1, and it is not counted for strength at T. ' +
  'It can be raided at its destination from tick T.';

/** Machine-readable form of the same decision, for `agent.md` and `observe`. */
export const MOVEMENT_RULES = {
  arrivalIsPresentSameTick: ARRIVAL_IS_PRESENT_SAME_TICK,
  statement: MOVEMENT_STATEMENT,
} as const;

/**
 * The stored hand row.
 *
 * Extends core's `Hand` with three fields core does not carry. Each one exists
 * because something asserted or rendered is otherwise unprovable:
 *   - `ordinal` — the feed's name for it ("second hand").
 *   - `departedAtTick` — without it INV-10 can only bound the ETA, not verify it,
 *     and the viewer cannot draw a convoy part-way along a lane (A13).
 *   - `presentSinceTick` — the single home of the arrival decision above.
 */
export interface HandRecord extends Hand {
  readonly ordinal: number;
  departedAtTick: number | null;
  presentSinceTick: number;
}

/**
 * Hand IDs are permanent and must stay stable forever (§4.2's rule for places
 * applies to presence too — the ledger references them and the ledger is
 * append-only). Derived, not random, so a replay from a snapshot cannot invent a
 * different name for the same hand.
 */
export function handIdFor(principal: PrincipalId, ordinal: number): HandId {
  return `${principal}:h${ordinal}` as HandId;
}

export function createHands(
  principal: PrincipalId,
  home: SystemId,
  tick: number,
): HandRecord[] {
  const hands: HandRecord[] = [];
  for (let ordinal = 1; ordinal <= HANDS_PER_PRINCIPAL; ordinal += 1) {
    hands.push({
      id: handIdFor(principal, ordinal),
      principal,
      ordinal,
      state: 'IDLE',
      location: home,
      destination: null,
      freeAtTick: null,
      departedAtTick: null,
      presentSinceTick: tick,
      cargo: new Map<GoodId, Qty>(),
    });
  }
  return hands;
}

// ── Presence ────────────────────────────────────────────────────────────────

/**
 * **PRESENT**: settled at its location and able to act there this tick — work a
 * site, escort a load, garrison, satisfy a role, count for strength.
 *
 * Distinct from {@link occupiesSystem}, which is *where the body is* for
 * rendering and for being targeted. Keeping the two words apart is a §3
 * obligation: if "present" meant both, the arrival decision above would silently
 * become an immunity rule and predation would quietly die.
 */
export function isPresent(hand: HandRecord, tick: number): boolean {
  if (hand.state === 'IN_TRANSIT' || hand.state === 'RECOVERING') return false;
  return tick >= hand.presentSinceTick;
}

/** Where the body is. False while in transit — then the hand is on a lane. */
export function occupiesSystem(hand: HandRecord, system: SystemId): boolean {
  if (hand.state === 'IN_TRANSIT') return false;
  return hand.location === system;
}

export function isOnLane(hand: HandRecord): boolean {
  return hand.state === 'IN_TRANSIT';
}

/** The lane a hand is on, or null if it is not moving. */
export function laneOf(hand: HandRecord): LaneKey | null {
  if (hand.state !== 'IN_TRANSIT' || hand.destination === null) return null;
  return laneKey(hand.location, hand.destination);
}

/**
 * `hands[].in_transit_eta` from §12.1's observation, derived in exactly one
 * place. If the API layer computed this itself there would be two homes for the
 * arrival tick, and INV-10 would be asserting one of them while agents read the
 * other.
 */
export function inTransitEta(hand: HandRecord): number | null {
  return hand.state === 'IN_TRANSIT' ? hand.freeAtTick : null;
}

// ── Transitions ─────────────────────────────────────────────────────────────

/**
 * Begin transit along one lane. **One move is one lane** — §4.3 puts
 * `transit_ticks` on the gate, so a multi-hop journey is the agent walking a
 * {@link import('./map.js').route} gate by gate. Accepting a distant destination
 * and silently pathfinding would publish an ETA that no single lane guarantees
 * and would make interception unanswerable.
 *
 * A `COMMITTED` hand may travel: an escort's whole job is to move with a convoy.
 * Its state becomes `IN_TRANSIT` because the physical machine wins — the role
 * reference is untouched, and {@link resolveArrival} asks the role table what to
 * restore it to.
 */
export function beginTransit(
  map: WorldMap,
  hand: HandRecord,
  destination: SystemId,
  tick: number,
): WorldResult<HandRecord> {
  switch (hand.state) {
    case 'IN_TRANSIT':
      return reject(
        'INV-9',
        `hand ${hand.id} is already in transit to ${String(hand.destination)} and arrives at tick ${String(hand.freeAtTick)}; it cannot be redirected mid-lane`,
      );
    case 'RECOVERING':
      return reject(
        'INV-8',
        `hand ${hand.id} is recovering until tick ${String(hand.freeAtTick)}; loss costs time, so wait for it rather than replacing it`,
      );
    case 'IDLE':
    case 'COMMITTED':
      break;
  }
  if (destination === hand.location) {
    return reject('INV-10', `hand ${hand.id} is already at ${destination}`);
  }
  const lane = map.lanes.get(laneKey(hand.location, destination));
  if (lane === undefined) {
    return reject(
      'INV-10',
      `no lane from ${hand.location} to ${destination}; move one gate at a time along a route`,
    );
  }
  hand.state = 'IN_TRANSIT';
  hand.destination = destination;
  hand.departedAtTick = tick;
  hand.freeAtTick = tick + lane.transitTicks;
  return accept(hand);
}

/**
 * Complete a transit. Called only from the MOVE phase.
 *
 * `filledInRole` is asked, never stored: it is the role table's answer to "is
 * this hand still committed", which is the single home of commitment. Passing it
 * in is what lets an escort arrive still committed without this module ever
 * learning which venture it belongs to.
 */
export function resolveArrival(hand: HandRecord, tick: number, filledInRole: boolean): void {
  if (hand.state !== 'IN_TRANSIT' || hand.destination === null) {
    throw new Error(`resolveArrival called on hand ${hand.id} in state ${hand.state}`);
  }
  hand.location = hand.destination;
  hand.destination = null;
  hand.departedAtTick = null;
  hand.freeAtTick = null;
  hand.state = filledInRole ? 'COMMITTED' : 'IDLE';
  hand.presentSinceTick = ARRIVAL_IS_PRESENT_SAME_TICK ? tick : tick + 1;
}

/**
 * A hand taken in a raid. **Never destroyed** (INV-8): it goes `RECOVERING` at
 * the principal's holding for `HAND_RECOVERY_TICKS`.
 *
 * The cargo it was carrying is **returned to the caller, not deleted**. Goods on
 * a hand are one of INV-2's conservation terms, so silently dropping them would
 * make supply stop balancing with no event to point at — the ledger must retire
 * them to a named loss sink and post the receipt. This is why the signature
 * returns something instead of being void.
 */
export interface HandLoss {
  readonly handId: HandId;
  readonly principal: PrincipalId;
  readonly lostFrom: SystemId;
  readonly recoverAt: SystemId;
  readonly freeAtTick: number;
  /** Goods that must be retired to a loss sink by the ledger. Never dropped. */
  readonly lostCargo: ReadonlyMap<GoodId, Qty>;
}

export function loseHand(
  hand: HandRecord,
  tick: number,
  rng: Rng,
  recoverAt: SystemId,
): HandLoss {
  const lostCargo = hand.cargo;
  const recoveryTicks = rng.range(HAND_RECOVERY_TICKS.min, HAND_RECOVERY_TICKS.max);
  const loss: HandLoss = {
    handId: hand.id,
    principal: hand.principal,
    lostFrom: hand.location,
    recoverAt,
    freeAtTick: tick + recoveryTicks,
    lostCargo,
  };
  hand.state = 'RECOVERING';
  hand.location = recoverAt;
  hand.destination = null;
  hand.departedAtTick = null;
  hand.freeAtTick = loss.freeAtTick;
  hand.cargo = new Map<GoodId, Qty>();
  return loss;
}

/**
 * Recovery ends. Symmetric with arrival: a recovered hand is present from the
 * next tick, for the same reason (see {@link ARRIVAL_IS_PRESENT_SAME_TICK}).
 */
export function resolveRecovery(hand: HandRecord, tick: number, filledInRole: boolean): void {
  if (hand.state !== 'RECOVERING') {
    throw new Error(`resolveRecovery called on hand ${hand.id} in state ${hand.state}`);
  }
  hand.freeAtTick = null;
  hand.state = filledInRole ? 'COMMITTED' : 'IDLE';
  hand.presentSinceTick = ARRIVAL_IS_PRESENT_SAME_TICK ? tick : tick + 1;
}

/**
 * Mark a stationed hand as engaged by a role. A hand in transit stays
 * `IN_TRANSIT` (physical state wins) and a recovering hand cannot be committed at
 * all — a lost hand must be released from its role, or INV-9's role check fails
 * and the tick halts.
 */
export function commitHand(hand: HandRecord): WorldResult<HandRecord> {
  switch (hand.state) {
    case 'RECOVERING':
      return reject(
        'INV-9',
        `hand ${hand.id} is recovering until tick ${String(hand.freeAtTick)} and cannot fill a role`,
      );
    case 'IDLE':
      hand.state = 'COMMITTED';
      return accept(hand);
    case 'COMMITTED':
    case 'IN_TRANSIT':
      // Already engaged, or engaged and travelling. Both are legal fills.
      return accept(hand);
  }
}

/** Release a hand from a role. In transit or recovering, the physical state stands. */
export function releaseHand(hand: HandRecord): void {
  if (hand.state === 'COMMITTED') hand.state = 'IDLE';
}

// ── Cargo ───────────────────────────────────────────────────────────────────

/**
 * INV-26's declared cap for the cargo map: distinct goods a hand may carry.
 *
 * Phase 0 has four goods, so this is slack — and it exists anyway because scar #3
 * was an unbounded array that became an OOM and disk DoS, and cargo is serialised
 * into every observation of every hand. A cap that is never reached costs nothing;
 * an array with no declared bound costs the host.
 */
export const MAX_CARGO_GOODS = 8;

export function cargoOf(hand: HandRecord, good: GoodId): Qty {
  return hand.cargo.get(good) ?? qty(0);
}

/** Put goods on a hand. Only a settled hand can be loaded. */
export function loadCargo(hand: HandRecord, good: GoodId, amount: Qty, tick: number): WorldResult<Qty> {
  if (!isPresent(hand, tick)) {
    return reject(
      'INV-9',
      `hand ${hand.id} is ${hand.state.toLowerCase()} and cannot be loaded until it is present at tick ${String(hand.presentSinceTick)}`,
    );
  }
  if (!hand.cargo.has(good) && hand.cargo.size >= MAX_CARGO_GOODS) {
    return reject(
      'INV-26',
      `hand ${hand.id} already carries ${MAX_CARGO_GOODS} kinds of goods, the declared cap; unload one first`,
    );
  }
  const next = qty(cargoOf(hand, good) + amount);
  const cargo = new Map(hand.cargo);
  cargo.set(good, next);
  hand.cargo = cargo;
  return accept(next);
}

/** Take goods off a hand. Refuses to overdraw: a negative Qty cannot exist. */
export function unloadCargo(hand: HandRecord, good: GoodId, amount: Qty): WorldResult<Qty> {
  const held = cargoOf(hand, good);
  if (amount > held) {
    return reject(
      'INV-3',
      `hand ${hand.id} carries ${held} of ${good}, not ${amount}`,
    );
  }
  const cargo = new Map(hand.cargo);
  const next = qty(held - amount);
  if (next === 0) cargo.delete(good);
  else cargo.set(good, next);
  hand.cargo = cargo;
  return accept(next);
}

/**
 * Every good held on a hand, whether that hand is moving or standing still.
 *
 * Read the name literally and do not narrow it to `state === 'IN_TRANSIT'`: a good
 * sitting in the cargo of an idle hand is equally outside the account tree, and
 * omitting it makes supply conservation fail with no bug to find.
 * {@link cargoOnLanes} is for the viewer and answers a different question.
 *
 * ⚠ **CONTRACT GAP — read before wiring this into INV-2.** `src/ledger/lots.ts`
 * declares the lot table "the *only* home of a goods quantity" and already carries
 * a `location` and an `IN_TRANSIT` state, while `core/types.ts` puts `cargo` on the
 * hand. Both cannot be authoritative: **adding** this total to a lot total
 * double-counts every carried good, which is scar #5 exactly — one quantity, two
 * homes, and a loss handler that destroys 2x the real value.
 *
 * So the only sanctioned use of this function against the ledger is **equality**:
 * assert it matches the carried subtotal of the lot table. That is INV-7's own rule
 * — "asserted where a mirror exists for convenience: aggregate never crosses the
 * mirror".
 *
 * ── ★ THE RECONCILIATION THIS PARAGRAPH ASKED FOR HAS HAPPENED ──────────────
 *
 * The clean fix it named — *"a `carrier: HandId | null` on the lot, making
 * `hand.cargo` a derived read"* — landed at `RULES_VERSION` 25, and it landed because
 * the missing field was **an agent-reachable world halt** rather than a tidiness
 * item: `landArrivedCargo` had to guess which in-transit lots belonged to the
 * arriving hand by walking an anonymous pool in lot-id order, and two ordinary hauls
 * on consecutive ticks stopped the shard on INV-W7 (`world/haul.ts`,
 * `test/world/a-convoy-carries-its-own-cargo.spec.ts`).
 *
 * `hand.cargo` is **not** a derived read even so, and that half is deliberate: it is
 * the `SENSED` **manifest** (§11.2 — *a ship at sea is visible; its manifest is not*),
 * so it is what the viewer draws and what a raid would sense, while the lot table
 * stays authoritative for the quantity. The gap therefore stands as a *warning about
 * summing* and no longer as an open design question — `checkCargoMirror` asserts the
 * equality **per hand and per good** every tick, which is the strongest form of the
 * rule this paragraph states.
 */
export function cargoHeldByHands(hands: Iterable<HandRecord>): Map<GoodId, Qty> {
  const totals = new Map<GoodId, Qty>();
  for (const hand of hands) {
    for (const [good, amount] of hand.cargo) {
      totals.set(good, qty((totals.get(good) ?? 0) + amount));
    }
  }
  return totals;
}

/**
 * Goods physically moving on each lane right now — the convoy the map draws
 * (A13). **Not** INV-2's conservation term; see {@link cargoHeldByHands}.
 */
export function cargoOnLanes(hands: Iterable<HandRecord>): Map<LaneKey, Map<GoodId, Qty>> {
  const byLane = new Map<LaneKey, Map<GoodId, Qty>>();
  for (const hand of hands) {
    const lane = laneOf(hand);
    if (lane === null) continue;
    let totals = byLane.get(lane);
    if (totals === undefined) {
      totals = new Map<GoodId, Qty>();
      byLane.set(lane, totals);
    }
    for (const [good, amount] of hand.cargo) {
      totals.set(good, qty((totals.get(good) ?? 0) + amount));
    }
  }
  return byLane;
}

// ── Ordering and serialisation ──────────────────────────────────────────────

/**
 * The canonical order for any phase that walks every hand: `(principal_id,
 * ordinal)`. Never arrival order, never Map insertion order — SPEC §15.2 orders
 * by `(priority, principal_id, client_sequence)` for exactly this reason, and a
 * phase that iterates in a different order every run is DET-1 failing quietly.
 */
export function cmpHands(a: HandRecord, b: HandRecord): number {
  const byPrincipal = cmpStr(a.principal, b.principal);
  return byPrincipal !== 0 ? byPrincipal : a.ordinal - b.ordinal;
}

/** The legal state set, for exhaustive checks and error messages. */
export const HAND_STATES: readonly HandState[] = ['IDLE', 'IN_TRANSIT', 'COMMITTED', 'RECOVERING'];

/**
 * Expected ETA for a hand in transit, recomputed from the gate transit table.
 * INV-10 compares this against what the hand actually carries; the two agreeing
 * is the whole invariant.
 */
export function expectedArrivalTick(map: WorldMap, hand: HandRecord): number | null {
  if (hand.state !== 'IN_TRANSIT' || hand.destination === null || hand.departedAtTick === null) {
    return null;
  }
  return hand.departedAtTick + transitTicks(map, hand.location, hand.destination);
}
