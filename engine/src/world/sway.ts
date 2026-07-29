/**
 * SWAY — capacity-limited projection: the half of `PASS-TERRITORY-POLITICS` §16.12 #1 that makes
 * the map **political** rather than merely spatial.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **THE ONE SENTENCE.** Your SWAY at a system is how many of your HANDS may be counted as force
 * there when you are **not defending your own ground**: {@link SWAY_AT_SEAT} at each place you
 * hold, one less per lane out, and {@link SWAY_STRAIT_TOLL} less for every STRAIT on the way that
 * you do not hold. At zero you cannot take an offensive side there at all.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * ── WHY IT HAD TO EXIST ──────────────────────────────────────────────────────
 *
 * §16.12 ranks *"a fixed, resource-distinct graph with chokepoints and capacity-limited
 * projection"* **first** of five, above stewardship sovereignty and above campaigns, both of which
 * shipped first. The reason is in the entry's own second clause: it is what *"creates local power,
 * supply lines, borders, markets, and a real place for smaller groups to exist."* Before this,
 * force had **unlimited reach** — a principal with three hands could walk them anywhere on a
 * thirty-system map and count for exactly as much at the far rim as at its own door. So there was
 * no such thing as a frontier, no reason to hold a gate, and no position from which a small holder
 * was better off than a large one.
 *
 * §16.13 names the failure it prevents by name: *"Costless blues and low-friction bloc-wide
 * projection … producing a blue donut/fait accompli"*, with the replacement — *"constrain shared
 * capacity by distance"*.
 *
 * ── ★ OFFENCE IS PROJECTED; DEFENCE IS PRESENT ───────────────────────────────
 *
 * The asymmetry is the design, not an omission, and it is stated here because two callers depend
 * on it and neither may re-decide it:
 *
 *   - A **raid's target**, and a **campaign's defender**, are never gated and never capped. Their
 *     own hands at their own place count in full, forever. §16.1 MUST-3's whole argument for
 *     chokepoints is that they *"let a smaller defender exploit interior lines"* — a chokepoint
 *     that weakened the defender would be the mechanic inverted.
 *   - Everyone **else** is projecting: a `demand`'s initiator, a raid's RAIDER joiner, a
 *     campaign's attacker and its roster. Those are capped, and at zero refused.
 *
 * Read the other way: this never deletes force from somebody standing on what it owns, and it
 * never makes a defence weaker than it was before the mechanic existed. That is also what keeps
 * the balance gate honest — every effect points at *less* predation, never at more.
 *
 * ── WHAT IT DELIBERATELY DOES NOT TOUCH: TRAVEL ──────────────────────────────
 *
 * **`move` does not read this module and must never read it.** A haul, a Levy delivery, a
 * tribute run and a march are all `move`, and the two measured hazards in this area are a member's
 * goods and hands ending up in different systems (325 of 576 observations) and `levyMove` once
 * refusing a member's *only legal route to its own tribute*. Gating travel on reach would make
 * both worse and would break §5.2's obligation to be payable at all.
 *
 * It is also the right mechanic. EVE's chokepoints do not stop a hauler; they stop a **fleet**.
 * §16.1 MUST-3 keeps base gates *"indestructible graph edges"* and puts the friction on force, and
 * §16.1 NICE-8's version of this idea is explicit that *"civilian hauling is cheap near home; mass
 * military transit consumes sharply more capacity with distance"*.
 *
 * ── A4: THIS CANNOT BE OUT-TYPED ─────────────────────────────────────────────
 *
 * Sway is a pure function of `(the fixed graph, the systems you hold)`. It reads no clock, no
 * request, no hand position and no queue, so there is no rate at which it improves and nothing a
 * faster agent can do that a slower one cannot. It also cannot react within a tick: a seat gained
 * this tick is a holding or a claim written by a phase, and the reading is taken from frozen
 * snapshot state like every other force term.
 *
 * ── A8: INERT IN THE COMMONS, AT BOTH ENDS ───────────────────────────────────
 *
 * **The target end.** A COMMONS system reads {@link SWAY_AT_SEAT} for everybody, always. Not
 * because sway is meaningful there — hostile action in the Commons is *invalid*, refused by
 * `commons.ts` and halted on by `PRD-1` — but because a full reading is the only value that can
 * never be the thing that refuses a Commons act. Sway must add no refusal the floor did not
 * already make, or an agent would be told "your force does not reach" about a place where the real
 * answer is "nothing hostile happens here at all", and would then go and buy the wrong thing.
 *
 * **The actor end.** A principal whose only holding is in the Commons has **no seat outside it**,
 * so its sway is 0 at every non-Commons system — which is exactly right, since its hands are
 * Commons-bound and can never stand at one. Callers must still report that as `COMMONS_BOUND` and
 * never as beyond-sway, because the two carry different corrections: buy a holding, versus buy
 * ground nearer. `withheld.ts` already draws that distinction for `move`, and this reuses it.
 *
 * ── WHY HOPS AND NOT TICKS ───────────────────────────────────────────────────
 *
 * Same reason `strait.ts` gives: what is being measured is **topology**, and a border that moved
 * when a gate's `transitTicks` was recalibrated would redraw the political map out of a travel-time
 * tweak. Hops are also what the agent already reads — `RaidView.march.hops` has published a hop
 * count since `RULES_VERSION` 24 — so this adds no second unit of distance (§3).
 */

import type { PrincipalId, SystemId } from '../core/types.js';
import { HANDS_PER_PRINCIPAL } from './hands.js';
import { cmpStr, laneKey, systemOf, type WorldMap } from './map.js';
import { straitsAt, straitsOf } from './strait.js';

/**
 * Sway at a place you hold — and it is {@link HANDS_PER_PRINCIPAL} **by import, not by
 * coincidence**.
 *
 * A principal has exactly three hands, so "three" here means *all of them*: at your own holding
 * or your own claim, nothing is withheld. If the two numbers were declared independently they
 * would drift, and the day they did, sway would silently start capping a principal at home — the
 * one place the whole design promises it never does.
 */
export const SWAY_AT_SEAT = HANDS_PER_PRINCIPAL;

/** Hands lost per lane travelled from the nearest place you hold. */
export const SWAY_PER_HOP = 1;

/**
 * Extra hands lost for crossing a STRAIT you hold neither end of.
 *
 * Two, against a `SWAY_AT_SEAT` of three, is chosen so a STRAIT is a **wall rather than a
 * speed bump**: the first lane out costs 1, so a strait on it leaves 0 and the projection stops
 * dead. Holding either end waives it entirely, so the difference between having ground on a gate
 * and not having it is the difference between reaching past it and not reaching past it at all.
 *
 * Measured on the launch map, reach in systems a single-seat principal can project into, out of
 * 26 non-Commons systems — with the waiver, then with the waiver suppressed:
 *
 * | seat | straits at the seat | reach | reach without the waiver |
 * |---|---|---|---|
 * | `sys-25` Ironhold | **3** | **12** | 3 |
 * | `sys-20` Ashen Ford | 2 | 8 | 2 |
 * | `sys-26` Jetsam | 2 | 6 | 1 |
 * | `sys-05` Orison | 1 | 4 | 3 |
 *
 * Ironhold is the launch map's keystone and nobody authored it: it is an end of three straits, so
 * holding it **quadruples** what its holder can strike and losing it cuts that holder back to its
 * own doorstep. That is §16.12 #1's *"holding one is worth doing and losing one hurts"* as
 * arithmetic rather than as an intention.
 */
export const SWAY_STRAIT_TOLL = 2;

/**
 * The places a principal projects **from**: its HOLDING's system when that is outside the Commons,
 * plus every system it holds a CLAIM on.
 *
 * A record rather than two arguments so that a caller cannot supply one and forget the other —
 * the claim half is what makes conquest extend reach, and a caller that passed only the holding
 * would produce a quietly smaller sway with no error anywhere.
 *
 * Deliberately **not** hands. Where a hand is standing is `SENSED` (§11.2 — *"a ship at sea is
 * visible; its manifest is not"*), and a sway derived from it could not be published on a frame or
 * in a counterparty's observation without leaking hand disposition. A holding and a claim are both
 * `PUBLIC`, so every reading here is a fact any stranger may already compute — which is what lets
 * A9's parity hold by construction (`frames/projection.ts`).
 */
export interface SwaySeats {
  readonly principal: PrincipalId;
  /** The systems this principal holds. Empty is legal and means sway 0 everywhere abroad. */
  readonly systems: readonly SystemId[];
}

/**
 * Hands this principal may project at `at`. `0..SWAY_AT_SEAT`.
 *
 * Integer throughout: this figure reaches a hashed force reading and DET-7 bans floats from
 * anything hashed. It is also why the decay is subtractive rather than a basis-point fraction —
 * `FORCE_PER_HAND` is 1, so a percentage of one hand floors to zero and the mechanic would delete
 * the coalition layer instead of shaping it.
 */
export function swayAt(map: WorldMap, seats: SwaySeats, at: SystemId): number {
  // A8's inert reading. Asserted through `systemOf` first so an unknown system is a thrown error
  // rather than a silent zero, which would read as "your force does not reach a place that does
  // not exist" — a refusal an agent could never act on.
  if (systemOf(map, at).tier === 'COMMONS') return SWAY_AT_SEAT;
  const cost = costsFrom(map, seats);
  const spent = cost.get(at);
  if (spent === undefined) return 0;
  return Math.max(0, SWAY_AT_SEAT - spent);
}

/**
 * Every non-Commons system this principal has any sway at, with the figure. Sorted by system id.
 *
 * The **short** list on purpose: only systems at 1 or more appear. On the launch map that is
 * typically 3–8 of 26 for a single-seat principal, which is what makes it publishable in an
 * observation without a paging rung. A full 26-row table would be mostly zeros, and a zero is
 * exactly the row an agent does not need — `swayAt` answers a specific question for free.
 */
export function swayReach(map: WorldMap, seats: SwaySeats): ReadonlyMap<SystemId, number> {
  const cost = costsFrom(map, seats);
  const out = new Map<SystemId, number>();
  for (const id of map.systemOrder) {
    if (systemOf(map, id).tier === 'COMMONS') continue;
    const spent = cost.get(id);
    if (spent === undefined) continue;
    const sway = SWAY_AT_SEAT - spent;
    if (sway >= 1) out.set(id, sway);
  }
  return out;
}

/**
 * Cheapest sway cost from any seat to every system, by Dijkstra over integer lane costs.
 *
 * A linear scan for the minimum, matching `map.route` — thirty systems, and a heap would buy
 * nothing while costing a deterministic tie-break that would have to be written anyway. Ties are
 * broken by system id (DET-2), which matters because two equal-cost predecessors would otherwise
 * settle in `Map` insertion order.
 */
function costsFrom(
  map: WorldMap,
  seats: SwaySeats,
  /**
   * Stop settling once the cheapest unsettled node costs this much — everything past it is out of
   * reach and cannot come back into reach by going further.
   *
   * ══════════════════════════════════════════════════════════════════════════
   * **A DEFAULT OF `SWAY_AT_SEAT` IS RIGHT FOR EVERY READING AND WRONG FOR THE EXPLANATION**, and
   * that difference was a false sentence about a real agent before this parameter existed.
   *
   * `swayAt` and `swayReach` only ever ask about systems at cost `< SWAY_AT_SEAT`, so the capped
   * walk is exact for them. {@link swayShortfall} asks *how far short did I fall*, and under the cap
   * a system four lanes out is never relaxed at all — so it answered `undefined`, which
   * {@link swayNote} reads as *"you hold no ground outside the COMMONS"*. For a principal that holds
   * two claims and is simply far away, that is a **rules surface stating something false about its
   * own position**, which is scar #1's exact shape. So the explanation walks uncapped.
   * ══════════════════════════════════════════════════════════════════════════
   */
  limit: number = SWAY_AT_SEAT,
): ReadonlyMap<SystemId, number> {
  const held = new Set<SystemId>();
  for (const id of [...seats.systems].sort(cmpStr)) {
    // A Commons seat projects nothing: A15's outbound half makes its hands Commons-bound, so a
    // seat there is not a base for anything. Filtered here rather than at the call sites so no
    // caller can forget it and hand a nursery-seated principal reach into the Marches.
    if (systemOf(map, id).tier === 'COMMONS') continue;
    held.add(id);
  }

  const cost = new Map<SystemId, number>();
  for (const id of held) cost.set(id, 0);
  if (cost.size === 0) return cost;

  const straits = straitsOf(map);
  const done = new Set<SystemId>();
  for (;;) {
    let best: SystemId | null = null;
    let bestCost = Number.MAX_SAFE_INTEGER;
    for (const id of map.systemOrder) {
      if (done.has(id)) continue;
      const c = cost.get(id);
      if (c === undefined) continue;
      if (c < bestCost) {
        best = id;
        bestCost = c;
      }
    }
    if (best === null) break;
    if (bestCost >= limit) break;
    done.add(best);
    const system = map.systems.get(best);
    if (system === undefined) continue;
    for (const neighbour of system.lanes) {
      if (done.has(neighbour)) continue;
      const key = laneKey(best, neighbour);
      let step = SWAY_PER_HOP;
      const strait = straits.get(key);
      if (strait !== undefined && !held.has(strait.a) && !held.has(strait.b)) {
        step += SWAY_STRAIT_TOLL;
      }
      const candidate = bestCost + step;
      const existing = cost.get(neighbour);
      if (existing === undefined || candidate < existing) cost.set(neighbour, candidate);
    }
  }
  return cost;
}

/**
 * The STRAITS this principal holds an end of — the ones whose toll it does not pay.
 *
 * Published because it is the actionable half: a principal shown only its reach learns *that* it
 * is fenced in, and a principal shown which straits it holds learns *which ground to take next*.
 */
export function straitsHeld(map: WorldMap, seats: SwaySeats): readonly SystemId[] {
  const out = new Set<SystemId>();
  for (const id of [...seats.systems].sort(cmpStr)) {
    if (systemOf(map, id).tier === 'COMMONS') continue;
    if (straitsAt(map, id).length > 0) out.add(id);
  }
  return [...out].sort(cmpStr);
}

// ── The rules surface ───────────────────────────────────────────────────────

/**
 * The rule, as one sentence, for the agent about to spend a hand on it.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **THIS STRING IS A RULES SURFACE** (hard rule 4). `test/world/the-map-has-borders.spec.ts` pins
 * every number in it to the constant it came from. An agent that believes sway limits *travel*
 * will refuse to haul; one that believes it limits its own *defence* will pay for ground it did
 * not need; one that does not know a strait's toll is waived by holding it will never take a gate.
 * ══════════════════════════════════════════════════════════════════════════
 */
export const SWAY_STATEMENT =
  `SWAY is how many of your ${String(SWAY_AT_SEAT)} hands count as FORCE at a place you are not ` +
  `defending. It is ${String(SWAY_AT_SEAT)} at every system you hold — your HOLDING, and every ` +
  `CLAIM — then ${String(SWAY_PER_HOP)} less per lane out, and ${String(SWAY_STRAIT_TOLL)} less ` +
  'again for each STRAIT on the way whose ends you hold neither of. At 0 you cannot open a demand ' +
  'there, join a raid as RAIDER, or take a campaign side. It NEVER limits travel: move, haul and ' +
  'deliver do not read it. It NEVER limits defending your own ground: as a raid TARGET or the ' +
  'holder of a claim under campaign, all your hands count wherever they stand. So offence is ' +
  'projected and must be supplied from ground you hold; defence is present. Take ground nearer, ' +
  'or take a STRAIT, to reach further.';

/**
 * The sentence a refusal and an affordance both use. One home, so the number an agent is shown
 * before it commits and the number that refuses it cannot disagree (scar #1).
 */
export function swayNote(sway: number, at: SystemId, nearest: number | null): string {
  if (sway > 0) {
    return (
      `your SWAY at ${at} is ${String(sway)} of ${String(SWAY_AT_SEAT)}: ${String(sway)} of your ` +
      'hands can be counted as force there.'
    );
  }
  // `null` means **no non-Commons ground at all**, never "too far to measure" — `swayShortfall`
  // walks uncapped precisely so those two cannot be confused here. Telling a principal that holds
  // two claims it holds nothing would be a rules surface lying about its own position.
  const distance =
    nearest === null
      ? 'you hold no ground outside the COMMONS at all, so you project nowhere'
      : `the cheapest route from ground you hold costs ${String(nearest)} of SWAY and you have ` +
        `${String(SWAY_AT_SEAT)} to spend, so you are ${String(nearest - SWAY_AT_SEAT + 1)} short`;
  return (
    `your SWAY at ${at} is 0, so no hand of yours counts as force there however many you march in — ` +
    `${distance}. A STRAIT you do not hold costs ${String(SWAY_STRAIT_TOLL)} on top of the lane. ` +
    'Take a CLAIM nearer, or one end of the STRAIT in the way, and the reading changes. Nothing ' +
    'here stops you moving, hauling or delivering.'
  );
}

/**
 * How much sway-cost the cheapest route to `at` actually consumed, or `null` when nothing reaches.
 *
 * Only for {@link swayNote}'s "how far short am I" clause. Kept separate from {@link swayAt} so the
 * hot path returns one integer and the explanation pays for itself only when it is needed.
 */
export function swayShortfall(map: WorldMap, seats: SwaySeats, at: SystemId): number | null {
  if (systemOf(map, at).tier === 'COMMONS') return 0;
  // Uncapped, so the answer is the real distance rather than "beyond the cap" — see the `limit`
  // parameter's docblock for the false sentence the capped walk produced.
  const spent = costsFrom(map, seats, Number.MAX_SAFE_INTEGER).get(at);
  return spent ?? null;
}
