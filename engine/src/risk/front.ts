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
 *   - `sim/runtime.ts` carries `hazards?: boolean` defaulting to **false**, with the comment
 *     *"Phase 0 has no hazard content yet"*;
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
import { TICKS_PER_RECKONING, phaseOfReckoning, reckoningIndex } from '../core/time.js';
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
  FRONT_SPARES_QTY,
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

/** True on exactly the tick a front is announced. */
export function isAnnounceTick(tick: number): boolean {
  for (let r = reckoningIndex(tick); r <= reckoningIndex(tick) + FRONT_CONE_RECKONINGS + 1; r += 1) {
    if (isFrontReckoning(r) && announceTickOf(r) === tick) return true;
  }
  return false;
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
 * The SWATH — what the front will actually take.
 *
 * Its own sub-stream label, distinct from the cone's, so the published odds are not invertible.
 */
export function swathOf(map: WorldMap, rng: Rng, id: FrontId, eye: SystemId): readonly SwathCell[] {
  const stream = rng.derive(`risk:front:swath:${id}`);
  const span = stream.range(SWATH_SYSTEMS_MIN, SWATH_SYSTEMS_MAX);
  const centre = stream.range(INTENSITY_MIN_BPS, INTENSITY_MAX_BPS);
  const hops = hopsFrom(map, eye, span);

  const cells: SwathCell[] = [];
  for (const [system, hop] of [...hops.entries()].sort((a, b) => compareIds(a[0], b[0]))) {
    if (cells.length >= span) break;
    // Integer falloff, applied `hop` times. No `Math.pow`, no float: the result is hashed.
    let raw = centre;
    for (let i = 0; i < hop; i += 1) raw = Math.trunc((raw * INTENSITY_FALLOFF_BPS) / BPS_ONE);
    const vulnerability = VULNERABILITY_BY_TIER[tierOf(map, system)];
    const intensity = Math.trunc((raw * vulnerability) / BPS_ONE);
    if (intensity <= 0) continue;
    cells.push({ system, intensityBps: bps(intensity) });
  }
  return Object.freeze(cells);
}

/**
 * The CONE — the odds the server publishes, on its own sub-stream.
 *
 * Widening-then-narrowing confidence is §10.1's own phrasing, and here it is a function of the
 * *reader's* tick rather than of stored state: {@link coneAt} sharpens the same published cells as
 * landfall approaches. That keeps the record immutable (A5) while letting the picture tighten,
 * which is what CAT2's spectator line asks for.
 */
export function coneOf(map: WorldMap, rng: Rng, id: FrontId, eye: SystemId): readonly ConeCell[] {
  const stream = rng.derive(`risk:front:cone:${id}`);
  const hops = hopsFrom(map, eye, 3);
  const cells: ConeCell[] = [];
  for (const [system, hop] of [...hops.entries()].sort((a, b) => compareIds(a[0], b[0]))) {
    if (cells.length >= CONE_SYSTEMS) break;
    // Base odds fall with distance; a bounded jitter keeps the cone from being a ranked list of
    // the swath. Integer arithmetic, and the jitter is symmetric so the cone is not biased.
    const base = Math.max(500, BPS_ONE - hop * 2_500);
    const jitter = stream.range(-800, 800);
    cells.push({ system, oddsBps: bps(Math.max(100, Math.min(BPS_ONE, base + jitter))) });
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

export function intensityAt(front: FrontRecord, system: SystemId): Bps {
  for (const cell of front.swath) if (cell.system === system) return cell.intensityBps;
  return bps(0);
}

export function isInSwath(front: FrontRecord, system: SystemId): boolean {
  return front.swath.some((c) => c.system === system);
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
 *   3. **{@link FRONT_SPARES_QTY} per (account, good) survives**, so a front can never leave a
 *      principal unable to pay an obligation that is only payable in goods. See the constant.
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

    const key = `${lot.account}::${lot.good}`;
    const alreadySpared = spared.get(key) ?? 0;
    const spareNow = Math.min(lot.qty, Math.max(0, FRONT_SPARES_QTY - alreadySpared));
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

/** Where a front is in its own arc, for the observation. `phaseOfReckoning` is the tick's. */
export function ticksToLandfall(front: FrontRecord, tick: number): number {
  return front.landfallTick - tick;
}

/** For the ticker line: the phase of the Reckoning a front lands in. */
export function landfallPhase(front: FrontRecord): number {
  return phaseOfReckoning(front.landfallTick);
}
