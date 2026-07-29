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
 *
 * ── ★ AND ONE STEP OF THAT WAS MISSING, WHICH COST TWO WORLD HALTS ───────────
 *
 * *"Written in one step"* was true of the manifest and the lot **state**, and false of the thing
 * that says **which hand** a travelling lot is in. Without it the in-transit lots of one principal
 * form an anonymous pool keyed `(account, good, destination)`, and `landArrivedCargo` had to *guess*
 * an arriving hand's share by walking that pool in lot-id order until a running total was covered.
 * Lot ids do not partition by hand and the walk lands **whole lots**, so it overshot — and two
 * ordinary hauls on consecutive ticks halted the shard on the very invariant above. A second,
 * cheaper halt sat next to it: two hauls in **one** tick out of the same parent lot derived the same
 * split-lot id, and `splitLot`'s throw escaped this function into `VALIDATE+LOCK`.
 *
 * `Lot.carrier` (`RULES_VERSION` 25) is the field `hands.ts` had already named as the clean fix, and
 * the reproduction is `test/world/a-convoy-carries-its-own-cargo.spec.ts`. Read {@link HaulPort}'s
 * `carriedBy` before touching the landing sweep.
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
  /**
   * Split `qty` off a lot into a new lot in the same account. Returns the new lot's id.
   *
   * `seq` is a **per-tick** ordinal, not a per-action one: two hauls submitted in the same tick
   * out of the same parent lot derived the same id from `(tick, parentLot, indexWithinThisHaul)`
   * and the second one threw `duplicate lot id` out of the verb, halting the tick. See
   * {@link haul} for the whole sequence.
   */
  readonly split: (args: {
    readonly lotId: string;
    readonly qty: Qty;
    /** The hand this haul is for. Part of the derived lot id, which is what makes it unique. */
    readonly hand: HandId;
    /** Ordinal within this haul. One hand hauls at most once per tick, so this closes the id. */
    readonly seq: number;
  }) => string;
  /**
   * Send a lot into transit toward `to`, **in the named hand**. No value moves, so no postings.
   *
   * The carrier is part of this call rather than a second one, because `Lot.carrier`'s contract is
   * that it is non-null exactly while the lot is `IN_TRANSIT`.
   */
  readonly depart: (lotId: string, to: SystemId, carrier: HandId) => void;
  /** Land a lot at the place it was sent to, clearing its carrier. The inverse of {@link depart}. */
  readonly land: (lotId: string) => void;
  /**
   * Lots this hand is carrying of `good`, canonical order.
   *
   * ── WHY THIS IS KEYED ON THE HAND AND NOT ON THE DESTINATION ────────────────
   *
   * It used to be `inTransitTo(principal, to, good)` — an **anonymous pool** — and every caller
   * that wanted one hand's cargo walked that pool in id order until the hand's manifest total was
   * covered. That is a guess, and it is wrong two ways: lot ids do not partition by hand (a split
   * lot is named after its *event*, so one haul's lots interleave with another's), and the walk
   * lands **whole lots**, so it overshoots. Two hauls on consecutive ticks therefore landed more
   * units than the arriving hand carried, cleared only that hand's manifest, and stopped the world
   * on INV-W7. `test/world/a-convoy-carries-its-own-cargo.spec.ts` is that halt, pinned.
   */
  readonly carriedBy: (hand: HandId, good: GoodId) => readonly HaulableLot[];
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
 *
 * ── AND WHY THE LOT PLAN IS BUILT BEFORE ANYTHING IS WRITTEN ─────────────────
 *
 * `port.split` reaches `Ledger.splitLot`, which **throws** — on a pledged lot (INV-4), on a
 * non-positive or whole-lot split (INV-3), and on a duplicate derived id. A throw out of a verb
 * handler is not a refusal: verbs run inside `VALIDATE+LOCK`, so it aborts the tick and PAUSES the
 * world. Two ordinary hauls submitted in one tick out of the same parent lot did exactly that
 * (`duplicate lot id lot:haul.split:<tick>:<parent>:0`), which made a world halt reachable by any
 * enrolled agent in its first minute — the starter allotment is one lot and a principal has three
 * hands.
 *
 * So the draw is planned first, as arithmetic over the lot list, and the plan states which lots
 * travel whole and which need a split. Then the manifest and the departures are written. If a split
 * still refuses, the whole haul refuses with a sentence and **nothing has moved** — which is the
 * promise the check order above already makes, extended over the one step that could break it.
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

  // ── THE PLAN. STILL NOTHING MUTATED. ────────────────────────────────────────
  //
  // A whole lot travels as itself; a partial one is split so the remainder stays put. The Levy's
  // 45,000-unit teleport was exactly this case handled by moving the whole lot and relocating the
  // remainder back afterwards, which cannot work across ticks.
  const plan: { readonly lotId: string; readonly portion: number; readonly whole: boolean }[] = [];
  let left = req.qty;
  for (const lot of lots) {
    if (left <= 0) break;
    const portion = Math.min(left, lot.qty);
    if (portion <= 0) continue;
    plan.push({ lotId: lot.id, portion, whole: portion === lot.qty });
    left -= portion;
  }
  if (left > 0) {
    // Unreachable given the `have < req.qty` check above, and refused rather than asserted because
    // the alternative in a verb handler is a throw, and a throw here halts the world.
    return reject(
      'A2',
      `the lots standing at ${from} could not cover ${String(req.qty)} ${req.good} ` +
        `(${String(req.qty - left)} of ${String(req.qty)} planned). Nothing was moved.`,
    );
  }

  // ── THE SPLITS, WHICH ARE THE ONLY STEP THAT CAN REFUSE, AND THEY GO FIRST ──
  //
  // A split moves **no value** (`Ledger.splitLot`: both halves stay in the same account with the
  // same good and the same state), so a partly-done split run leaves the world entirely consistent
  // — more lots, the same units, standing where they stood, and INV-7's mirror untouched. That is
  // what makes it safe to do them before the manifest is written and to refuse mid-run without an
  // unwind. Doing them *after* the load would need one, and an unwind that has to re-merge two lots
  // is a second thing to get wrong.
  const travelling: string[] = [];
  for (const [i, step] of plan.entries()) {
    if (step.whole) {
      travelling.push(step.lotId);
      continue;
    }
    try {
      travelling.push(port.split({ lotId: step.lotId, qty: qty(step.portion), hand: hand.id, seq: i }));
    } catch (error: unknown) {
      // A refusal, never a throw. Verbs run inside `VALIDATE+LOCK`, so a throw out of this function
      // aborts the tick and PAUSES the world — the agent-reachable halt §15.4 calls the top
      // engineering risk, and the exact way two same-tick hauls used to stop a healthy world.
      return reject(
        'INV-3',
        `hand ${hand.id} could not take ${String(step.portion)} ${req.good} off lot ${step.lotId} ` +
          `(${error instanceof Error ? error.message : String(error)}). No goods left ${from}.`,
      );
    }
  }

  // ── NOTHING ABOVE MOVED ANY GOODS. FROM HERE ON IT DOES, IN ONE ORDER. ──────
  const carried = loadCargo(hand, req.good, qty(req.qty), tick);
  if (!carried.ok) return carried;

  for (const lotIdent of travelling) port.depart(lotIdent, req.to, hand.id);
  const touched = travelling.length;

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
      // ── EVERY LOT THIS HAND CARRIES, AND ONLY THOSE ─────────────────────────
      //
      // No running total and no early break. This used to draw from an anonymous
      // `(principal, destination, good)` pool until `want` was covered, which landed **whole
      // lots** past the mark: the excess was another hand's cargo, landed early, with its
      // manifest left standing — the INV-W7 halt two consecutive hauls produced. Landing the
      // carried set is exact by construction, so the sum below is a check rather than a hope.
      let landed = 0;
      for (const lot of port.carriedBy(hand.id, good)) {
        port.land(lot.id);
        landed += lot.qty;
      }
      unloadCargo(hand, good, want);
      out.push({
        hand: hand.id,
        principal: hand.principal,
        at: hand.location,
        good,
        // What the LEDGER actually landed, never what the manifest claimed. If the two ever
        // disagree the mirror below halts the tick, and this row is what the record shows —
        // never the larger of the two (A5′).
        qty: qty(landed),
      });
    }
  }
  return out;
}

/** One in-transit lot, as INV-W7 needs to read it. */
export interface TransitLot {
  readonly id: string;
  readonly good: GoodId;
  readonly qty: number;
  /** `null` is itself a violation: an in-transit lot nobody is carrying. */
  readonly carrier: HandId | null;
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
 *
 * ── THE GLOBAL SUM WAS NOT ENOUGH, AND THE SECOND HALF IS WHY ─────────────────
 *
 * The world-wide total per good held while **the lots were on the wrong hands**: a landing that
 * drew from an anonymous `(principal, destination, good)` pool could land hand A's units against
 * hand B's manifest and stay balanced for a tick, then diverge on the next. So the check is now
 * **per carrier as well as per good**, and it also refuses an in-transit lot with no carrier at all.
 * The global sum is kept rather than replaced: it is the one that catches a lot destroyed in transit
 * by a sink that never heard of a hand, which no per-hand comparison can see.
 */
export function checkCargoMirror(args: {
  readonly state: WorldState;
  readonly inTransit: readonly TransitLot[];
  readonly tick: number;
}): readonly { readonly id: string; readonly severity: 'HALT'; readonly message: string }[] {
  // Nested rather than a `hand`+separator+`good` string key, deliberately: a composite key needs a
  // separator, `test/core/vocabulary-repo.test.ts` refuses a literal NUL anywhere in `src/` (and it
  // caught this exact line), and any printable separator can appear inside an id. Two levels of
  // `Map` need no separator at all.
  const manifest = new Map<GoodId, number>();
  const byHand = new Map<HandId, Map<GoodId, number>>();
  for (const hand of handsInOrder(args.state)) {
    for (const [good, amount] of hand.cargo) {
      manifest.set(good, (manifest.get(good) ?? 0) + amount);
      const row = byHand.get(hand.id) ?? new Map<GoodId, number>();
      row.set(good, (row.get(good) ?? 0) + amount);
      byHand.set(hand.id, row);
    }
  }
  const inTransitByGood = new Map<GoodId, number>();
  const inTransitByHand = new Map<HandId, Map<GoodId, number>>();
  const out: { readonly id: string; readonly severity: 'HALT'; readonly message: string }[] = [];
  const orphans: string[] = [];
  for (const lot of args.inTransit) {
    inTransitByGood.set(lot.good, (inTransitByGood.get(lot.good) ?? 0) + lot.qty);
    if (lot.carrier === null) {
      orphans.push(`${lot.id} (${String(lot.qty)} ${lot.good})`);
      continue;
    }
    const row = inTransitByHand.get(lot.carrier) ?? new Map<GoodId, number>();
    row.set(lot.good, (row.get(lot.good) ?? 0) + lot.qty);
    inTransitByHand.set(lot.carrier, row);
  }

  // ── HALF ONE: the world-wide total per good. ────────────────────────────────
  const goods = new Set<GoodId>([...manifest.keys(), ...inTransitByGood.keys()]);
  for (const good of [...goods].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) {
    const onHands = manifest.get(good) ?? 0;
    const inLots = inTransitByGood.get(good) ?? 0;
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

  // ── HALF TWO: the same equality, per hand. ──────────────────────────────────
  if (orphans.length > 0) {
    out.push({
      id: 'INV-W7',
      severity: 'HALT',
      message:
        `${String(orphans.length)} lot(s) are IN_TRANSIT with no carrier at tick ${String(args.tick)}: ` +
        `${orphans.slice(0, 4).join(', ')}. A lot in transit is in a hand or it is nowhere; a sink that ` +
        'moved one without clearing its carrier has re-created the anonymous pool INV-W7 exists to end.',
    });
  }
  const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
  for (const handId of [...new Set([...byHand.keys(), ...inTransitByHand.keys()])].sort(cmp)) {
    const declared = byHand.get(handId) ?? new Map<GoodId, number>();
    const carried = inTransitByHand.get(handId) ?? new Map<GoodId, number>();
    for (const good of [...new Set([...declared.keys(), ...carried.keys()])].sort(cmp)) {
      const onHand = declared.get(good) ?? 0;
      const inLots = carried.get(good) ?? 0;
      if (onHand === inLots) continue;
      out.push({
        id: 'INV-W7',
        severity: 'HALT',
        message:
          `hand ${handId} declares ${String(onHand)} ${good} in its manifest but carries ` +
          `${String(inLots)} in the lot table at tick ${String(args.tick)}. The manifest is per hand, ` +
          'so the ledger must be too — a landing that draws from a shared pool is the defect this ' +
          'half found.',
      });
    }
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
