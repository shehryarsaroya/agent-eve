/**
 * The FRONT — §10.1's fourth sink, and CAT1 + CAT2 of `PASS-ECONOMY-RISK` §8.2.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ## What was here before this file, and what was not
 *
 * §10.1 names four sinks and calls the fourth *"a scheduled front [that] destroys located goods at
 * the Reckoning"*. Three of the four were built. The fourth was **anticipated in five places and
 * implemented in none** — which is this project's signature defect one level *below* the usual one,
 * because there was not even a mechanism to be unreachable:
 *
 *   - `tick/phases.ts` has a `HAZARD` phase whose note reads *"hazards roll against what is still
 *     standing"*, and `tick/loop.ts` runs nothing in it but a handler nobody registered;
 *   - `sim/runtime.ts` carried `hazards?: boolean` defaulting to **false**, with the comment
 *     *"Phase 0 has no hazard content yet"* — ⚑ and that flag was **assigned and never read**, so
 *     `--hazards off` did not suppress anything and three docblocks went on citing it as evidence
 *     the phase was empty for a Reckoning after it stopped being. A14 is why the FRONT ignores it:
 *     a scheduled catastrophe that a switch can turn off is not undodgeable. The dead field is gone
 *     and the option now says so;
 *   - `ledger/accounts.ts` says of `GOODS_SINK.LOSS`: *"raids, **fronts** and `CARGO_LOST` all
 *     charge it"*;
 *   - `ledger/cargoLost.ts` names the cause as *"the raid, **the front**, the interception"*;
 *   - and §3's combat table **reserved the word**: *"`front` is spent by §10.1's scheduled weather
 *     front, so the mechanic that wanted it is not built."*
 *
 * Five citations, one word held in reserve, and nothing that could destroy a single unit of goods
 * on a schedule. That is why §15.4's false-default audit has never had a hazard to run with, why
 * four of six `ResolutionKind` values are unreachable in production, and why the risk market had
 * nothing to insure.
 *
 * ## The model — hazard × exposure × vulnerability, bounded (CAT1)
 *
 * CAT1 asks for *"a bounded hazard–exposure–vulnerability–financial model"* and CAT10 **CUTS**
 * independent per-asset dice: *"diversification becomes automatic, regional exposure is
 * meaningless, and reinsurance almost never faces stress."* So one draw decides everything:
 *
 *   1. **One seeded draw per front** picks a centre, a SWATH radius, and a centre INTENSITY.
 *   2. **Intensity falls with lane distance** from the centre, so a SWATH has a shape.
 *   3. **Vulnerability is the tier's**, published in `params.ts`, so geography prices itself.
 *   4. **Every lot at a struck system loses the same bps.** One event, one `event_family_id`, many
 *      principals — which *is* the correlated claim. Nothing is rolled per lot.
 *
 * ## Provable fairness (CAT2, A11)
 *
 * A11: *"`hash(seed(T))` is published **before** actions for T are accepted, and the seed is
 * revealed at resolution."* The engine already does this for the whole tick (`tick/seed.ts`,
 * checked in `COMMIT` under DET-6), and a front draws from that stream by label — so the front's
 * realisation is committed by the same mechanism that commits every other draw, and CAT2's
 * *"cryptographic commitment … locks the hidden epoch realization before risk is written"* is
 * satisfied without a second commitment scheme to get wrong.
 *
 * **But the CONE must not be the SWATH.** {@link coneOf} is derived from a *different* sub-stream
 * label than {@link swathOf}, so knowing the published odds tells an agent nothing about the
 * outcome beyond the odds themselves. A cone computed from the swath would be an oracle any agent
 * could invert, and CAT11 is a CUT for exactly that reason.
 * ══════════════════════════════════════════════════════════════════════════════
 */

import { Rng } from '../core/rng.js';
import { TICKS_PER_RECKONING, reckoningIndex } from '../core/time.js';
import type { EventId, GoodId, SystemId } from '../core/types.js';
import { BPS_ONE, bps, qty, type Bps, type Qty } from '../core/units.js';
import { compareIds } from '../ledger/order.js';
import type { Lot } from '../ledger/lots.js';
import type { LotId } from '../ledger/lots.js';
import { tierOf, type WorldMap } from '../world/map.js';
import {
  CONE_SYSTEMS,
  FRONT_CONE_RECKONINGS,
  FRONT_EVERY_RECKONINGS,
  FRONT_LANDFALL_PHASE,
  frontSparesFor,
  INTENSITY_FALLOFF_BPS,
  INTENSITY_MAX_BPS,
  INTENSITY_MIN_BPS,
  SWATH_SYSTEMS_MAX,
  SWATH_SYSTEMS_MIN,
  VULNERABILITY_BY_TIER,
} from './params.js';

export type FrontId = string & { readonly __brand: 'FrontId' };

/**
 * A FRONT's four states.
 *
 * `FORECAST → IMMINENT → STRUCK → PASSED`, and the split between the first two is the market: new
 * COVER is accepted in `FORECAST` and refused in `IMMINENT` (CAT12). `STRUCK` is the one tick on
 * which goods die and INDEMNITIES open; `PASSED` is after the settlement that paid them.
 */
export type FrontState = 'FORECAST' | 'IMMINENT' | 'STRUCK' | 'PASSED';

/** One system the CONE names, with the odds the server publishes for it. */
export interface ConeCell {
  readonly system: SystemId;
  /** Landfall odds in bps. Widens then narrows as landfall approaches — {@link coneOf}. */
  readonly oddsBps: Bps;
}

/** One system the FRONT struck. */
export interface SwathCell {
  readonly system: SystemId;
  /** Share of located goods destroyed, in bps, after tier vulnerability. Integer. */
  readonly intensityBps: Bps;
}

export interface FrontRecord {
  readonly id: FrontId;
  state: FrontState;
  /** Tick the CONE was published. */
  readonly announcedTick: number;
  /** Tick the FRONT strikes. Fixed at announcement and never moved (A14). */
  readonly landfallTick: number;
  /** The centre of the CONE. Public from announcement: the cone is information, not a secret. */
  readonly eye: SystemId;
  /**
   * ★ **The SWATH is computed at announcement and withheld until landfall.**
   *
   * Not "computed at landfall": a value derived later cannot be *committed* earlier, and CAT2 wants
   * the realisation locked before risk is written. It is drawn here from the announcement tick's
   * seed and simply not published, which is what `SEALED` means everywhere else in this engine.
   */
  readonly swath: readonly SwathCell[];
  readonly cone: readonly ConeCell[];
  /** Set on the tick the goods die, so a re-run of HAZARD cannot strike twice. */
  struckAtTick: number | null;
  /** The event that destroyed the goods. INV-17's attributable cause for every INDEMNITY. */
  causeEventId: EventId | null;
}

export class FrontError extends Error {}

/** Content-derived, never a counter (DET-3, DET-5). */
export function frontId(reckoning: number, eye: SystemId): FrontId {
  return `front:r${String(reckoning)}:${eye}` as FrontId;
}

/** Which RECKONING gets a front. Scheduled, published, undodgeable (A14). */
export function isFrontReckoning(reckoning: number): boolean {
  return reckoning > 0 && reckoning % FRONT_EVERY_RECKONINGS === 0;
}

/** The tick a front announced for `reckoning` strikes. */
export function landfallTickOf(reckoning: number): number {
  return reckoning * TICKS_PER_RECKONING + FRONT_LANDFALL_PHASE;
}

/** The tick a front for `reckoning` is announced. */
export function announceTickOf(reckoning: number): number {
  return landfallTickOf(reckoning) - FRONT_CONE_RECKONINGS * TICKS_PER_RECKONING;
}

/** The RECKONING whose front is announced on `tick`, or `null`. */
export function frontReckoningAnnouncedAt(tick: number): number | null {
  for (let r = reckoningIndex(tick); r <= reckoningIndex(tick) + FRONT_CONE_RECKONINGS + 1; r += 1) {
    if (isFrontReckoning(r) && announceTickOf(r) === tick) return r;
  }
  return null;
}

// ── Lane distance, without pulling the router in ────────────────────────────

/**
 * Lane hops from `eye`, up to `maxHops`. Breadth-first over `systemOrder`.
 *
 * Deliberately **not** `world/map.ts:route`, which weights lanes by transit ticks. A storm does not
 * travel a trade route; it spreads over adjacency. Using the tick-weighted router would make a
 * front's shape depend on gate transit times — *"the most load-bearing number in the design"* (§17)
 * — and silently couple the peril model to a movement tuning knob.
 */
export function hopsFrom(map: WorldMap, eye: SystemId, maxHops: number): ReadonlyMap<SystemId, number> {
  const out = new Map<SystemId, number>([[eye, 0]]);
  let frontier: SystemId[] = [eye];
  for (let hop = 1; hop <= maxHops; hop += 1) {
    const next: SystemId[] = [];
    for (const id of [...frontier].sort(compareIds)) {
      const system = map.systems.get(id);
      if (system === undefined) continue;
      for (const neighbour of [...system.lanes].sort(compareIds)) {
        if (out.has(neighbour)) continue;
        out.set(neighbour, hop);
        next.push(neighbour);
      }
    }
    frontier = next;
    if (frontier.length === 0) break;
  }
  return out;
}

// ── The draw ────────────────────────────────────────────────────────────────

/**
 * Announce a FRONT: pick the eye, draw the SWATH, publish the CONE.
 *
 * `rng` is the HAZARD phase's own sub-stream. Every draw here goes through a further
 * `derive(label)` so that adding one draw to the cone cannot shift the swath, which is the failure
 * `tick/seed.ts` describes: *"adding one `rng.int()` inside `HAZARD` would shift every downstream
 * outcome."*
 */
export function announceFront(map: WorldMap, rng: Rng, reckoning: number, tick: number): FrontRecord {
  if (!isFrontReckoning(reckoning)) {
    throw new FrontError(`reckoning ${String(reckoning)} is not a front reckoning`);
  }
  const eyeStream = rng.derive(`risk:front:eye:${String(reckoning)}`);
  const eye = map.systemOrder[eyeStream.int(map.systemOrder.length)];
  if (eye === undefined) throw new FrontError('the map has no systems');

  const id = frontId(reckoning, eye);
  return {
    id,
    state: 'FORECAST',
    announcedTick: tick,
    landfallTick: landfallTickOf(reckoning),
    eye,
    swath: swathOf(map, rng, id, eye),
    cone: coneOf(map, rng, id, eye),
    struckAtTick: null,
    causeEventId: null,
  };
}

/**
 * ★ **TRUNCATE BY DISTANCE, NEVER BY ID — AND THE FORECAST USED TO BE ANTI-CORRELATED WITH THE LOSS.**
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * Both {@link swathOf} and {@link coneOf} draw more candidate systems than they publish and have to
 * drop the surplus. Both used to do it with `if (cells.length >= N) break;` **while iterating a
 * `compareIds`-sorted list** — so a SWATH was not *"the systems nearest the eye"* but
 * *"the N alphabetically-lowest system ids within N hops of the eye"*, and the CONE was the same
 * sentence with a different N. The eye of the storm was in its own swath **128 times in 500 draws**.
 *
 * Measured on one driven world (`front:r3:sys-17`): the CONE published `sys-17` at **9,209 bps** and
 * `sys-18` at 6,837, and the SWATH struck `sys-01 · sys-02 · sys-04 · sys-05 · sys-06`. Four of the
 * five struck systems appear **nowhere in the published cone**; the fifth appears at 1,868 bps, the
 * *lowest* odds on the board. The forecast was not merely noisy, it was inverted — and `view.ts`'s
 * `pickTarget` recommends the highest-odds cone cell, so `publish_offer {COVER}`'s suggested
 * parameters steered an underwriter's capital at ground the storm would not touch.
 *
 * Nothing could catch it. Every cell was individually well-formed, the odds were monotone in hop, the
 * cone and the swath still came off different sub-streams (CAT11's oracle is still CUT), and A2's
 * *"genuine uncertainty stays uncertain and sourced"* was satisfied by a number that was sourced and
 * uncertain and about the wrong system.
 *
 * So the order of the two operations is the fix: **rank, then truncate.**
 *
 *   - the SWATH ranks `(hop asc, intensity desc, id)` — nearest first, and within one ring the most
 *     vulnerable tier first. The eye is hop 0, so **the eye is now always in its own swath**, which is
 *     the one thing a storm model may not get wrong;
 *   - the CONE ranks `(hop asc, id)` — nearest first, which is the order its own odds are already in.
 *
 * `id` survives as the final tiebreak in both, because a truncation has to be deterministic and a lot
 * id is the only total order this engine trusts (DET-3).
 *
 * **What stays uncertain, and it is the interesting half.** `span` and `centre` are still drawn, so an
 * agent reading the cone knows the eye will be struck and knows *nothing* about **how far the swath
 * reaches (2–5 rings) or how hard it hits (3,000–9,000 bps at the centre)**. That is what a hurricane
 * cone actually communicates, and it is why this is a repair rather than a relaxation: the odds now
 * describe distance, and distance is the part of the model that was never random.
 * ══════════════════════════════════════════════════════════════════════════════
 */
function rankedByDistance(
  hops: ReadonlyMap<SystemId, number>,
  weight: (system: SystemId, hop: number) => number,
): readonly { readonly system: SystemId; readonly hop: number; readonly weight: number }[] {
  return [...hops.entries()]
    .map(([system, hop]) => ({ system, hop, weight: weight(system, hop) }))
    .sort((a, b) => a.hop - b.hop || b.weight - a.weight || compareIds(a.system, b.system));
}

/**
 * The SWATH — what the front will actually take.
 *
 * Its own sub-stream label, distinct from the cone's, so the published odds are not invertible.
 * Truncated by **distance from the eye**, not by system id — see {@link rankedByDistance}.
 */
export function swathOf(map: WorldMap, rng: Rng, id: FrontId, eye: SystemId): readonly SwathCell[] {
  const stream = rng.derive(`risk:front:swath:${id}`);
  const span = stream.range(SWATH_SYSTEMS_MIN, SWATH_SYSTEMS_MAX);
  const centre = stream.range(INTENSITY_MIN_BPS, INTENSITY_MAX_BPS);
  // `span` is both the radius and the cell count, and with distance-first ranking that is coherent:
  // the swath is the `span` systems nearest the eye, which can never reach past `span` hops.
  const hops = hopsFrom(map, eye, span);

  const intensityAt = (system: SystemId, hop: number): number => {
    // Integer falloff, applied `hop` times. No `Math.pow`, no float: the result is hashed.
    let raw = centre;
    for (let i = 0; i < hop; i += 1) raw = Math.trunc((raw * INTENSITY_FALLOFF_BPS) / BPS_ONE);
    const vulnerability = VULNERABILITY_BY_TIER[tierOf(map, system)];
    return Math.trunc((raw * vulnerability) / BPS_ONE);
  };

  const cells: SwathCell[] = [];
  for (const cell of rankedByDistance(hops, intensityAt)) {
    if (cells.length >= span) break;
    if (cell.weight <= 0) continue;
    cells.push({ system: cell.system, intensityBps: bps(cell.weight) });
  }
  return Object.freeze(cells);
}

/**
 * The odds one CONE cell is published at, before the reader's own sharpening.
 *
 * Base falls {@link CONE_ODDS_PER_HOP_BPS} per hop and a bounded jitter is added. **The jitter really
 * is symmetric now**, which the previous docblock asserted and the arithmetic did not deliver: the old
 * expression was `max(100, min(BPS_ONE, base + jitter))` over a base that reached `BPS_ONE` at hop 0
 * and `500` at hop 4, so the clamp ate the whole upper half of the draw at the eye and the whole lower
 * half at the rim. A jitter clipped on one side is a bias, and it biased *toward publishing certainty
 * about the eye* — the one cell that needs no help.
 *
 * The base is therefore clamped into `[100 + jitter, CONE_ODDS_MAX_BPS - jitter]` **before** the draw
 * is added, so every cell gets the full ±{@link CONE_JITTER_BPS} and none of it is thrown away.
 *
 * ★ **And no cell is ever published at `BPS_ONE`.** A CONE is a *prediction*; 10,000 bps means
 * certainty; a prediction that can be wrong and prints certainty is A2's *"never hand it a solved
 * game"* failing in the direction that also libels the forecast. {@link coneAt} still reaches
 * `BPS_ONE` as landfall arrives — that is the reader's own sharpening toward a fact, and it is
 * published arithmetic an agent can reproduce.
 */
function coneOddsAt(hop: number, jitter: number): number {
  const base = Math.max(
    100 + CONE_JITTER_BPS,
    Math.min(CONE_ODDS_MAX_BPS - CONE_JITTER_BPS, BPS_ONE - hop * CONE_ODDS_PER_HOP_BPS),
  );
  return Math.max(100, Math.min(CONE_ODDS_MAX_BPS, base + jitter));
}

/**
 * How fast published odds fall per lane hop.
 *
 * ★ **Strictly greater than `2 × CONE_JITTER_BPS`, and that is load-bearing rather than tidy.** It
 * makes the published ranking by odds *identical* to the ranking by distance, so `view.ts:pickTarget`
 * — which recommends the highest-odds cell — can never recommend a farther system than a nearer one,
 * and therefore always lands on the eye, which is always struck. The suggestion an agent copies
 * verbatim is then aimed at ground that will actually burn.
 */
export const CONE_ODDS_PER_HOP_BPS = 2_500;
export const CONE_JITTER_BPS = 800;
/** The most a CONE may claim. Below `BPS_ONE`: see {@link coneOddsAt} on why a forecast may not print certainty. */
export const CONE_ODDS_MAX_BPS = BPS_ONE - 100;

/**
 * The CONE — the odds the server publishes, on its own sub-stream.
 *
 * Widening-then-narrowing confidence is §10.1's own phrasing, and here it is a function of the
 * *reader's* tick rather than of stored state: {@link coneAt} sharpens the same published cells as
 * landfall approaches. That keeps the record immutable (A5) while letting the picture tighten,
 * which is what CAT2's spectator line asks for.
 *
 * Truncated by **distance from the eye**, not by system id — see {@link rankedByDistance}.
 */
export function coneOf(map: WorldMap, rng: Rng, id: FrontId, eye: SystemId): readonly ConeCell[] {
  const stream = rng.derive(`risk:front:cone:${id}`);
  const hops = hopsFrom(map, eye, 3);
  const cells: ConeCell[] = [];
  // Ranked nearest-first with no secondary weight: the odds are already a function of the hop, so
  // ranking on anything else would sort the cone by a quantity it does not publish.
  for (const cell of rankedByDistance(hops, () => 0)) {
    if (cells.length >= CONE_SYSTEMS) break;
    cells.push({ system: cell.system, oddsBps: bps(coneOddsAt(cell.hop, stream.range(-CONE_JITTER_BPS, CONE_JITTER_BPS))) });
  }
  return Object.freeze(cells);
}

/**
 * The CONE as an agent reads it now — sharper the closer landfall is.
 *
 * A2: *"genuine uncertainty stays uncertain **and sourced**"*. The sharpening is published
 * arithmetic (`ticksOut` is on the observation), never a hidden model, so an agent can reproduce it
 * and disagree about what it means.
 */
export function coneAt(front: FrontRecord, tick: number): readonly ConeCell[] {
  const ticksOut = Math.max(0, front.landfallTick - tick);
  const span = Math.max(1, FRONT_CONE_RECKONINGS * TICKS_PER_RECKONING);
  // Confidence in bps: 0 at announcement, BPS_ONE at landfall.
  const confidence = Math.min(BPS_ONE, Math.trunc(((span - ticksOut) * BPS_ONE) / span));
  const struck = new Set(front.swath.map((c) => c.system));
  return Object.freeze(
    front.cone.map((cell) => {
      // Pull each published cell toward its truth in proportion to confidence. At confidence 0 the
      // agent sees the announcement; at BPS_ONE it sees the swath, which is the tick it is struck.
      const truth = struck.has(cell.system) ? BPS_ONE : 0;
      const moved = cell.oddsBps + Math.trunc(((truth - cell.oddsBps) * confidence) / BPS_ONE);
      return { system: cell.system, oddsBps: bps(Math.max(0, Math.min(BPS_ONE, moved))) };
    }),
  );
}

/** The front's state as the clock decides it. Never stored ahead of the tick that earns it. */
export function stateAt(front: FrontRecord, tick: number, coverFreezeTicks: number): FrontState {
  if (front.struckAtTick !== null && tick > front.struckAtTick) return 'PASSED';
  if (tick >= front.landfallTick) return 'STRUCK';
  if (tick >= front.landfallTick - coverFreezeTicks) return 'IMMINENT';
  return 'FORECAST';
}

// ── The destroy set ─────────────────────────────────────────────────────────

/** One lot, and how much of it the FRONT takes. */
export interface FrontLoss {
  readonly lotId: LotId;
  readonly system: SystemId;
  readonly good: GoodId;
  readonly qty: Qty;
}

/**
 * What the FRONT takes, from the lots that are standing in its SWATH.
 *
 * Four rules, and each one is a decision rather than an implementation detail:
 *
 *   1. **`IN_TRANSIT` lots are spared.** *"A ship at sea is visible; its manifest is not"* — and a
 *      lot in transit is between systems, so it is at no struck system. Sparing it is also the
 *      **only** interesting evasion in the mechanic: a CONE published two Reckonings out is a
 *      reason to `haul`, which is exactly the demand side §10.1 wants.
 *   2. **Pledged lots die.** PROP-L3, verbatim from `cargoLost.ts`: *"an encumbrance is a claim on
 *      a thing, not a shield over it"*. If a lien stopped a front, every agent would pledge
 *      everything and the sink would die.
 *   3. **{@link frontSparesFor} per (account, good) survives**, so a front can never leave a
 *      principal unable to pay an obligation that is only payable in goods. **Per good, and that word
 *      is the whole fix** — one flat 20,000 derived for `ration` used to floor `ore`, `alloy` and
 *      `fuel` too, and made the front a `ration`-only sink. See the constant.
 *   4. **Escrow accounts are spared.** Escrow is A7's already-committed half. Taking it would make
 *      an escrowed promise short through no act of its payer, which is §15.4's false default
 *      arriving from the hazard rather than from a raid. The *goods* in a venture's escrow are
 *      settled by `CARGO_LOST`, which is a different branch with a different rule, and running both
 *      over one lot would pay twice.
 *
 * Deterministic in lot id order and in nothing else.
 */
export function destroySet(front: FrontRecord, lots: readonly Lot[]): readonly FrontLoss[] {
  const struck = new Map(front.swath.map((c) => [c.system, c.intensityBps]));
  if (struck.size === 0) return Object.freeze([]);

  // Spare a floor per (account, good), charged once, in canonical lot order so the same lots
  // survive on replay.
  const spared = new Map<string, number>();
  const ordered = [...lots].sort((a, b) => compareIds(a.id, b.id));
  const out: FrontLoss[] = [];
  for (const lot of ordered) {
    if (lot.state === 'IN_TRANSIT') continue;
    if (!lot.account.startsWith('stores:')) continue;
    const intensity = struck.get(lot.location);
    if (intensity === undefined || intensity <= 0) continue;

    // ★ The floor is a function of the GOOD. One number for four goods made this a ration-only sink.
    const key = `${lot.account}::${lot.good}`;
    const floor = frontSparesFor(lot.good);
    const alreadySpared = spared.get(key) ?? 0;
    const spareNow = Math.min(lot.qty, Math.max(0, floor - alreadySpared));
    spared.set(key, alreadySpared + spareNow);
    const exposed = lot.qty - spareNow;
    if (exposed <= 0) continue;

    const taken = Math.trunc((exposed * intensity) / BPS_ONE);
    if (taken <= 0) continue;
    out.push({ lotId: lot.id, system: lot.location, good: lot.good, qty: qty(taken) });
  }
  return Object.freeze(out);
}

/** True on the tick the front's goods die. */
export function isLandfallTick(front: FrontRecord, tick: number): boolean {
  return tick === front.landfallTick && front.struckAtTick === null;
}

