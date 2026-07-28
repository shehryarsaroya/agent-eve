/**
 * `haul` — the verb that makes geography cost something.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **THIS IS A CANON VERB THAT HAS BEEN WAITING FOR ITS OWN BUILD STEP.**
 *
 * `api/verbs.ts` lists `haul` among SPEC §12.2's forty and files it under
 * `VERB_ARRIVES_AT` as *"step 11 (markets and the production graph)"*. This is that step, so
 * nothing is added to the §17 budget: `audit:budgets` counted `haul` as one of the 40 before
 * this file existed and counts it as one of the 40 after. What changes is that an agent told
 * *"its mechanic lands at step 11"* now gets the mechanic.
 *
 * ── WHY IT IS THE BOTTLENECK AND NOT A CONVENIENCE ───────────────────────────
 *
 * `market/book.ts` has always been right about this: *"a global book or teleporting fulfillment
 * would erase most of the galaxy... Goods settle exactly where the trade happened, so a fill at
 * Halcyon Reach puts the cargo at Halcyon Reach and **somebody still has to move it**."* Nothing
 * moved it. Measured over four seeded worlds at six Reckonings: **0 orders placed, 0 fills
 * printed, ever.** Two of the three reasons were a missing cast branch; the third was this — a
 * good bought at one venue could never be used at another, so a book that cleared would have
 * been a book that stranded cargo.
 *
 * `works/params.ts` states the consequence for the third good out loud and treats it as a
 * feature: *"There is also no verb that moves goods between systems — `haul` is declared
 * not-live... so fuel cannot merely be cheaper at the Frontier. Outside it, fuel does not
 * exist."* That is a much stronger asymmetry than a price gradient, and it is also why the
 * economy had no prices: an asymmetry nothing can arbitrage produces no number.
 *
 * ── THE MACHINERY WAS ALREADY HERE, WHICH IS THIS PROJECT'S SIGNATURE STORY ──
 *
 * Almost none of this file is new capability. It is a caller for five things that were built,
 * captured, restored, tested and used by nothing:
 *
 *   1. `hands.ts:loadCargo` / `unloadCargo` — exported, `MAX_CARGO_GOODS` declared, twelve tests,
 *      **no caller in `src/` outside their own module**;
 *   2. `HandRecord.cargo` — captured by `world/state.ts:cargoCanonical`, restored by
 *      `tick/snapshot.ts`, and empty in every world this repo has ever run;
 *   3. `Arrival.cargo` — carried out of `resolveMovement` with the comment *"movement on public
 *      lanes is PUBLIC (§11.2); the manifest is only SENSED"*, and read by nobody;
 *   4. `lots.ts:LotState.IN_TRANSIT` — *"the third bucket in INV-2"*, with the conservation term
 *      already summing it, and never once set;
 *   5. `loseHand`'s `lostCargo`, whose own doc says *"Goods that must be retired to a loss sink by
 *      the ledger. Never dropped"* — and whose caller in `runtime.ts` says *"Nothing in this build
 *      loads a hand (there is no `haul` verb yet), so this is unreachable today."*
 *
 * Five slots, cut to size, waiting. The one thing genuinely missing was a way to move *part* of a
 * lot, and `Ledger.splitLot` is that — built from the defect report `consumeLevyGood` already
 * carried.
 *
 * ── THE MIRROR PROBLEM, AND HOW IT IS RESOLVED RATHER THAN INHERITED ─────────
 *
 * `cargoHeldByHands` carries a ⚠ CONTRACT GAP: `lots.ts` declares the lot table *"the only home of
 * a goods quantity"* while `core/types.ts` puts `cargo` on the hand, and **adding** the two
 * double-counts every carried good — scar #5 exactly, one quantity with two homes and a loss
 * handler that destroys twice the real value.
 *
 * This module keeps the lot table authoritative and treats `hand.cargo` as the **manifest**: what
 * the viewer draws and what a raid would sense. The two are written in one step and never read as a
 * sum. `checkCargoMirror` (INV-W7) asserts the equality the gap's own text sanctions — *"the only
 * sanctioned use of this function against the ledger is equality"* — so the mirror is now checked
 * every tick instead of being trusted, and INV-2's in-transit bucket has a subject for the first
 * time.
 * ══════════════════════════════════════════════════════════════════════════
 */

import type { GoodId, HandId, PrincipalId, SystemId } from '../core/types.js';
import { qty, type Qty } from '../core/units.js';
import { cargoOf, isPresent, loadCargo, MAX_CARGO_GOODS, unloadCargo, type HandRecord } from './hands.js';
import { laneKey, type WorldMap } from './map.js';
import { commonsBoundRejection } from './movement.js';
import { accept, reject, type WorldResult } from './result.js';
import { handById, handsInOrder, type WorldState } from './state.js';

/**
 * The largest quantity of one good one haul may carry. *(calibrate)*
 *
 * A hand is *"one unit of simultaneous physical presence"* (§3), not a warehouse, and an unbounded
 * quantity here would let a single action relocate a principal's entire stores — which deletes the
 * reason a hub, a blockade or an inventory decision exists. `ALLOY_ANCHOR_QTY` is 500 and
 * `GRADUATION_UPKEEP_QTY` is 5,000, so this carries either in one trip and a Reckoning's rations in
 * four.
 *
 * **It is a cap on the ACTION, not on the hand**, so it cannot strand goods: what does not fit is
 * still standing where the agent left it, and a second `haul` carries the rest.
 */
export const MAX_HAUL_QTY = 20_000;

/** An unpledged parcel standing where the hand is. Mirrors `RefinableLot` on purpose. */
export interface HaulableLot {
  readonly id: string;
  readonly qty: number;
}

/**
 * Everything `haul` touches. Narrow on purpose — the signature enumerates the operation's reach, so
 * a reviewer can see it moves lots and a hand and nothing else. `works/refine.ts` is the pattern and
 * says why at length.
 */
export interface HaulPort {
  /** Unpledged, `AVAILABLE` lots of `good` this principal holds AT `system`, canonical order. */
  readonly lotsOf: (principal: PrincipalId, system: SystemId, good: GoodId) => readonly HaulableLot[];
  /** Split `qty` off a lot into a new lot in the same account. Returns the new lot's id. */
  readonly split: (args: { readonly lotId: string; readonly qty: Qty; readonly index: number }) => string;
  /** Send a lot into transit toward `to`. No value moves, so there are no postings. */
  readonly depart: (lotId: string, to: SystemId) => void;
  /** Land a lot at the place it was sent to. The inverse of {@link depart}. */
  readonly land: (lotId: string) => void;
  /** Lots of this principal that are in transit toward `to`, carrying `good`. Canonical order. */
  readonly inTransitTo: (
    principal: PrincipalId,
    to: SystemId,
    good: GoodId,
  ) => readonly HaulableLot[];
}

export interface HaulRequest {
  readonly hand: HandId | null;
  readonly to: SystemId | null;
  readonly good: GoodId | null;
  readonly qty: number | null;
}

export interface HaulPlan {
  readonly hand: HandId;
  readonly from: SystemId;
  readonly to: SystemId;
  readonly good: GoodId;
  readonly qty: Qty;
  readonly arrivesAtTick: number;
  readonly lots: number;
}

/**
 * The `haul` verb: load one good onto one hand and send it one lane.
 *
 * ── THE ORDER OF THE CHECKS IS THE DESIGN ────────────────────────────────────
 *
 *   1. **Shape** — every param, named in the refusal, because a market-shaped verb with a vague
 *      refusal costs the most attempts (`market/place.ts` says so and is right).
 *   2. **The hand** — yours, and able to travel.
 *   3. **The Commons-bound rule** — reused from `movement.ts`, never restated. A second copy of
 *      A15's outbound half is a second thing to forget.
 *   4. **The lane** — one gate at a time, exactly as `move`. A haul that pathfound would publish an
 *      ETA no single lane guarantees.
 *   5. **The goods** — enough unpledged, `AVAILABLE` units *standing where the hand is*.
 *   6. **Nothing has moved until here.** Every refusal above leaves the world exactly as it was.
 *
 * ── AND WHY THE LOAD HAPPENS BEFORE THE DEPARTURE ────────────────────────────
 *
 * `loadCargo` refuses a hand that is not `isPresent`, and `beginTransit` makes it `IN_TRANSIT` —
 * which is not present. So the manifest is written first and the hand leaves second. Getting this
 * backwards produces a hand in transit carrying nothing while its lots are in transit anyway, which
 * is the mirror broken on the first haul ever attempted.
 */
export function haul(
  port: HaulPort,
  state: WorldState,
  principal: PrincipalId,
  req: HaulRequest,
  tick: number,
): WorldResult<HaulPlan> {
  if (req.hand === null || req.to === null || req.good === null || req.qty === null) {
    return reject(
      'A2',
      'haul needs a hand, a destination, a good and a quantity: ' +
        '{"hand": "<hand id>", "to": "<adjacent system>", "good": "<good>", "qty": <units>}. ' +
        'Goods are LOCATED (§10.2) and this is the only verb that moves them between systems.',
    );
  }
  if (req.qty <= 0) {
    return reject('A2', `haul moves a positive quantity, got ${String(req.qty)}.`);
  }
  if (req.qty > MAX_HAUL_QTY) {
    return reject(
      'INV-26',
      `one haul carries at most ${String(MAX_HAUL_QTY)} units of one good and you asked for ` +
        `${String(req.qty)}. A hand is one unit of presence, not a warehouse — the rest stays where ` +
        'it is standing and a second haul carries it.',
    );
  }

  let hand: HandRecord;
  try {
    hand = handById(state, req.hand);
  } catch {
    return reject('A2', `there is no hand ${req.hand}.`);
  }
  if (hand.principal !== principal) {
    return reject('A2', `hand ${req.hand} is not yours; it belongs to ${hand.principal}.`);
  }
  if (!isPresent(hand, tick)) {
    return reject(
      'INV-9',
      `hand ${hand.id} is ${hand.state.toLowerCase()} and cannot be loaded until it is present at ` +
        `tick ${String(hand.presentSinceTick)}. Load a hand that is standing still.`,
    );
  }

  const bound = commonsBoundRejection(state, hand, req.to);
  if (bound !== null) return bound;

  const from = hand.location;
  if (req.to === from) {
    return reject('INV-10', `hand ${hand.id} is already at ${req.to}; a haul crosses one lane.`);
  }
  const lane = state.map.lanes.get(laneKey(from, req.to));
  if (lane === undefined) {
    return reject(
      'INV-10',
      `no lane from ${from} to ${req.to}; haul one gate at a time along a route, exactly as \`move\` does.`,
    );
  }

  if (cargoOf(hand, req.good) === 0 && hand.cargo.size >= MAX_CARGO_GOODS) {
    return reject(
      'INV-26',
      `hand ${hand.id} already carries ${String(MAX_CARGO_GOODS)} kinds of goods, the declared cap.`,
    );
  }

  const lots = port.lotsOf(principal, from, req.good);
  const have = lots.reduce((n, l) => n + l.qty, 0);
  if (have < req.qty) {
    return reject(
      'A2',
      `you hold ${String(have)} unpledged ${req.good} standing at ${from} and asked to haul ` +
        `${String(req.qty)}. Goods are located where they were made or bought: a fill at one venue ` +
        'leaves the cargo at that venue, and pledged lots cannot be sent away.',
    );
  }

  // ── NOTHING ABOVE MUTATED. FROM HERE ON IT DOES, IN ONE ORDER. ──────────────
  const carried = loadCargo(hand, req.good, qty(req.qty), tick);
  if (!carried.ok) return carried;

  let left = req.qty;
  let index = 0;
  let touched = 0;
  for (const lot of lots) {
    if (left <= 0) break;
    const portion = Math.min(left, lot.qty);
    if (portion <= 0) continue;
    // A whole lot travels as itself; a partial one is split so the remainder stays put. The Levy's
    // 45,000-unit teleport was exactly this case handled by moving the whole lot and relocating the
    // remainder back afterwards, which cannot work across ticks.
    const travelling = portion === lot.qty ? lot.id : port.split({ lotId: lot.id, qty: qty(portion), index });
    index += 1;
    port.depart(travelling, req.to);
    left -= portion;
    touched += 1;
  }

  hand.state = 'IN_TRANSIT';
  hand.destination = req.to;
  hand.departedAtTick = tick;
  hand.freeAtTick = tick + lane.transitTicks;

  return accept({
    hand: hand.id,
    from,
    to: req.to,
    good: req.good,
    qty: qty(req.qty),
    arrivesAtTick: hand.freeAtTick,
    lots: touched,
  });
}

/** One cargo that finished its journey and is now standing at the destination. */
export interface Landing {
  readonly hand: HandId;
  readonly principal: PrincipalId;
  readonly at: SystemId;
  readonly good: GoodId;
  readonly qty: Qty;
}

/**
 * Land the cargo of every hand that has finished travelling. Runs in the MOVE phase.
 *
 * ── WHY IT SWEEPS HANDS RATHER THAN READING THE ARRIVAL LIST ──────────────────
 *
 * `resolveMovement` returns `Arrival[]` with the manifest on it, but that list is local to the tick
 * loop and a phase handler cannot see it. Sweeping is also **idempotent and self-healing**, which
 * the list is not: a hand that somehow settled without its cargo being landed is landed by the next
 * tick instead of stranding goods in transit forever, and stranded goods are invisible to INV-1
 * (supply conservation cannot see a location) — the precise blind spot that let the Levy's teleport
 * survive.
 *
 * ── AND WHY IT RUNS AFTER `resolveMovement` AND BEFORE EVERYTHING ELSE ───────
 *
 * §15.2 puts MOVE before MARKETS *"so a hand that arrived this tick can trade where it arrived"*.
 * Cargo has to obey the same promise or the published ETA is a tick optimistic for goods and exact
 * for hands — two different answers to "when does my convoy get there", which is scar #1's shape on
 * the most quantitative surface in the game.
 */
export function landArrivedCargo(port: HaulPort, state: WorldState): readonly Landing[] {
  const out: Landing[] = [];
  // Canonical (principal_id, ordinal) order, never Map insertion order (DET-2).
  for (const hand of handsInOrder(state)) {
    if (hand.state === 'IN_TRANSIT') continue;
    if (hand.cargo.size === 0) continue;
    // Sorted so two goods on one hand land in a fixed order: `land` writes no value, but the lot ids
    // it touches reach the capture and an unstable order would hash differently for the same world.
    const goods = [...hand.cargo.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    for (const good of goods) {
      const want = cargoOf(hand, good);
      if (want <= 0) continue;
      let left: number = want;
      for (const lot of port.inTransitTo(hand.principal, hand.location, good)) {
        if (left <= 0) break;
        port.land(lot.id);
        left -= lot.qty;
      }
      unloadCargo(hand, good, want);
      out.push({ hand: hand.id, principal: hand.principal, at: hand.location, good, qty: want });
    }
  }
  return out;
}

/**
 * **INV-W7 — the mirror the CONTRACT GAP asked for, checked instead of trusted.**
 *
 * `Σ hand.cargo` per good must equal `Σ in-transit lots` per good. The two are written together by
 * {@link haul} and cleared together by {@link landArrivedCargo}, so any divergence means one of
 * three things, and all three are silent without this:
 *
 *   - a hand was routed and its lots were not retired (supply stops balancing with no event to
 *     point at — `runtime.ts` predicted this failure in a comment before it was reachable);
 *   - a lot was landed without its manifest being cleared (the viewer draws a convoy carrying goods
 *     that are standing at a system);
 *   - a lot was destroyed in transit by a sink that did not know about the manifest.
 *
 * HALT rather than WARN. A quantity with two homes that disagree is scar #5, and scar #5 destroyed
 * exactly twice the real value while every individual component read correctly.
 */
export function checkCargoMirror(args: {
  readonly state: WorldState;
  readonly inTransitByGood: ReadonlyMap<GoodId, Qty>;
  readonly tick: number;
}): readonly { readonly id: string; readonly severity: 'HALT'; readonly message: string }[] {
  const manifest = new Map<GoodId, number>();
  for (const hand of handsInOrder(args.state)) {
    for (const [good, amount] of hand.cargo) {
      manifest.set(good, (manifest.get(good) ?? 0) + amount);
    }
  }
  const goods = new Set<GoodId>([...manifest.keys(), ...args.inTransitByGood.keys()]);
  const out: { readonly id: string; readonly severity: 'HALT'; readonly message: string }[] = [];
  for (const good of [...goods].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) {
    const onHands = manifest.get(good) ?? 0;
    const inLots = args.inTransitByGood.get(good) ?? 0;
    if (onHands === inLots) continue;
    out.push({
      id: 'INV-W7',
      severity: 'HALT',
      message:
        `${good}: hands carry ${String(onHands)} but the lot table holds ${String(inLots)} in transit ` +
        `at tick ${String(args.tick)}. The manifest and the ledger are the same quantity with two ` +
        'homes and they disagree, which is scar #5.',
    });
  }
  return out;
}

/** What a haul would cost and carry, before it is submitted. The affordance reads this. */
export interface HaulQuote {
  readonly hand: HandId;
  readonly from: SystemId;
  readonly good: GoodId;
  /** Unpledged units standing where the hand is. The ceiling on this trip. */
  readonly availableHere: Qty;
  /** `min(availableHere, MAX_HAUL_QTY)`. What one action can actually take. */
  readonly carryable: Qty;
  /** Lane-adjacent systems this hand may take it to, canonical order. */
  readonly open: readonly SystemId[];
}

/** Every haul this principal could submit for one good right now, canonical order. */
export function haulQuotes(
  port: HaulPort,
  state: WorldState,
  principal: PrincipalId,
  good: GoodId,
  tick: number,
  neighbours: (system: SystemId) => readonly SystemId[],
): readonly HaulQuote[] {
  const out: HaulQuote[] = [];
  for (const hand of handsInOrder(state)) {
    if (hand.principal !== principal) continue;
    if (!isPresent(hand, tick)) continue;
    const here = port.lotsOf(principal, hand.location, good).reduce((n, l) => n + l.qty, 0);
    if (here <= 0) continue;
    const open = neighbours(hand.location).filter(
      (to) => commonsBoundRejection(state, hand, to) === null,
    );
    if (open.length === 0) continue;
    out.push({
      hand: hand.id,
      from: hand.location,
      good,
      availableHere: qty(here),
      carryable: qty(Math.min(here, MAX_HAUL_QTY)),
      open,
    });
  }
  return out;
}

/** Lane-adjacent systems, canonical order. The map has no neighbour index of its own. */
export function neighboursOf(map: WorldMap, system: SystemId): readonly SystemId[] {
  const out: SystemId[] = [];
  for (const lane of map.lanes.values()) {
    if (lane.a === system) out.push(lane.b);
    else if (lane.b === system) out.push(lane.a);
  }
  return out.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}
