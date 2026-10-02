/**
 * THE GRAND VENTURE's rules, as pure functions of facts the caller has already gathered (SPEC §7.6).
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **WHY IT IS A PARAMETER ON `create` AND NOT A NINTH KIND OR A NEW VERB.**
 *
 * §17's budgets are spent — verbs 40 of 40, venture kinds 8 of 8 — and neither needed spending. A
 * grand venture **is a venture**: one joint act, one lifecycle, one settlement path, one thing in
 * `agent.md`, one thing to render (§7's own words for why the venture replaced three objects). So it
 * is `create {kind:"BUILD", grand:true}`, and everything the venture machinery already guarantees —
 * the countersignature, the `terms_hash`, the echo of `your_take_at_p50`, the hard freeze, the
 * waterfall, A5′'s attribution, the delegated create that binds its grantor — applies to it without
 * a line of it being re-implemented here. What this module adds is the five rules that make one
 * venture a season's exam question:
 *
 *   1. **Where** — the stage is the Frontier system farthest from the Commons ({@link grandStageFor}).
 *   2. **When** — formed only inside the FINALE, so it settles at the FINALE ({@link grandWindowOf}).
 *   3. **What it pays** — a published yield instead of the kind's (`GRAND_BASE_YIELD_MINOR`).
 *   4. **What it costs to contest** — a stake from *earned* capital on every role, and presence at the
 *      stage ({@link grandFillRejection}); the same figure of earned capital to be its creator.
 *   5. **Who carries it** — of every live candidate, the one whose roles staked the most
 *      ({@link chooseGrandWinner}); the rest deliver nothing and owe nothing.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Nothing here reads the world, the clock or the RNG. The runtime gathers facts and asks; the
 * affordance layer asks the same functions with the same facts, so the menu cannot offer what the
 * verb refuses (AGT-S2).
 */

import type { SystemId, VentureId, VentureKind } from '../core/types.js';
import type { Minor } from '../core/units.js';
import type { GrandMarker } from '../venture/venture.js';
import { cmpStr, tierOf, type WorldMap } from '../world/map.js';
import { reject, type Rejection } from '../world/result.js';
import { finaleTickOf, seasonFirstTick, seasonOf } from './clock.js';
import { GRAND_BASE_YIELD_MINOR, GRAND_KIND, GRAND_ROLE_STAKE_MINOR, SEASON_RECKONINGS } from './params.js';
import { TICKS_PER_RECKONING } from '../core/time.js';

// ── WHERE ────────────────────────────────────────────────────────────────────

/**
 * Hops from the nearest COMMONS system to every system **of the launch map**, by breadth-first search
 * over lanes.
 *
 * Hops rather than ticks on purpose — the same choice `SWAY_PER_HOP` makes: a stage must not move
 * when a gate's `transit_ticks` is recalibrated, and "how far from civic law" is a fact about the
 * graph, not about the speed of travel.
 *
 * ── ★ AND THE LAUNCH MAP'S GRAPH, NOT THE GROWN ONE (Season 1 merge) ─────────────────────────────
 *
 * The region grows (`world/growth.ts`): a qualified population opens a constellation with two COMMONS
 * systems of its own, hung off a MARCHES anchor by one STRAIT. Counted here, those new COMMONS are new
 * sources for this search, and if one ever sat closer to a Frontier system than the launch Commons do,
 * the farthest set — and with it the season's published stage — would move at a Reckoning in the middle
 * of a season, after every agent had walked toward the stage `header.season.grand` announced from the
 * season's first tick. SSN-1 re-derives every grand venture's stage from the map each tick, so it would
 * also halt the world on a stage nobody moved.
 *
 * Measured, it does not happen with today's generator — 12 seeds × 8 openings × 4 seasons, the stage
 * never moved, because an anchor sits on the core side of every bridge and a grown COMMONS is at least
 * two hops behind it. That is a property of the generator, not a rule anybody wrote down, so the stage is
 * made a function of the season alone by construction: growth never extends the FRONTIER and a grown
 * constellation hangs off the map by one bridge, so skipping its systems gives exactly the launch map's
 * distances for every launch system. `test/season/the-stage-stays-where-it-was-announced.spec.ts` pins it.
 */
export function hopsFromCommons(map: WorldMap): ReadonlyMap<SystemId, number> {
  const grown = new Set<SystemId>(map.grown.flatMap((g) => g.systems));
  const dist = new Map<SystemId, number>();
  const queue: SystemId[] = [];
  for (const id of map.systemOrder) {
    if (grown.has(id)) continue;
    if (tierOf(map, id) === 'COMMONS') {
      dist.set(id, 0);
      queue.push(id);
    }
  }
  for (let head = 0; head < queue.length; head++) {
    const at = queue[head];
    if (at === undefined) break;
    const here = dist.get(at) ?? 0;
    const lanes = [...(map.systems.get(at)?.lanes ?? [])].sort(cmpStr);
    for (const next of lanes) {
      if (dist.has(next) || grown.has(next)) continue;
      dist.set(next, here + 1);
      queue.push(next);
    }
  }
  return dist;
}

/**
 * **The grand venture's stage for `season`**: the FRONTIER system farthest from the Commons.
 *
 * §7.6's *"sited in the least-lawful space"*, as a published rule rather than an authored choice
 * (A12: a target-selection rule is physics; an outcome is never authored). The Frontier is where law
 * is agent-set; the farthest of it from civic custody is the least lawful place on the map, the one
 * every crew must cross the most open ground to reach.
 *
 * When several systems tie for farthest, the season **rotates** through them in canonical id order —
 * `PASS-TERRITORY-POLITICS` §16.1 #7's *"rotating frontier theaters"*, so the next season's prize is
 * somewhere else and an incumbent cannot fortify one system for every finale. On the launch map four
 * Frontier systems sit eight hops out (`sys-23`, `sys-27`, `sys-28`, `sys-30`), so the stage moves
 * every season and returns every fourth.
 *
 * `null` only on a map with no Frontier at all, which the launch map is not; the runtime refuses to
 * construct a world where that is true, so an agent never reads a grand venture with nowhere to be.
 */
export function grandStageFor(map: WorldMap, season: number): SystemId | null {
  const dist = hopsFromCommons(map);
  let farthest = -1;
  const ties: SystemId[] = [];
  for (const id of map.systemOrder) {
    if (tierOf(map, id) !== 'FRONTIER') continue;
    const d = dist.get(id);
    if (d === undefined) continue;
    if (d > farthest) {
      farthest = d;
      ties.length = 0;
      ties.push(id);
    } else if (d === farthest) {
      ties.push(id);
    }
  }
  if (ties.length === 0) return null;
  ties.sort(cmpStr);
  const index = (Math.max(1, season) - 1) % ties.length;
  return ties[index] ?? null;
}

// ── WHEN ─────────────────────────────────────────────────────────────────────

/** When a grand candidate may be formed, and when it settles. Ticks, all of them. */
export interface GrandWindow {
  readonly season: number;
  /** The FINALE's first tick: the first tick a grand `create` is accepted. */
  readonly opens_tick: number;
  /** The LAST tick a grand `create` is accepted — the latest one whose venture still settles at the FINALE. */
  readonly closes_tick: number;
  /** The FINALE's settlement tick. Every grand candidate resolves here. */
  readonly finale_tick: number;
}

/**
 * The grand formation window for `season`.
 *
 * Opens at the FINALE's first tick; closes `slackTicks` before its settlement, where `slackTicks` is
 * the runtime's formation window plus its delivery lead — the exact arithmetic `create` uses to pick
 * a venture's settlement (`nextSettlementAtOrAfter(opens + FORMATION_WINDOW_TICKS +
 * DELIVERY_LEAD_TICKS)`). Taken as an argument rather than imported so this module does not depend
 * on the runtime; `Runtime` asserts at construction that a create on `closes_tick` resolves on
 * `finale_tick` and one on the tick after does not, so the two cannot drift.
 */
export function grandWindowOf(season: number, slackTicks: number): GrandWindow {
  const finale = finaleTickOf(season);
  const opens = seasonFirstTick(season) + (SEASON_RECKONINGS - 1) * TICKS_PER_RECKONING;
  return { season, opens_tick: opens, closes_tick: finale - slackTicks, finale_tick: finale };
}

export function inGrandWindow(tick: number, window: GrandWindow): boolean {
  return tick >= window.opens_tick && tick <= window.closes_tick;
}

// ── THE MARKER A GRAND VENTURE CARRIES ───────────────────────────────────────

/**
 * The marker a season's grand venture is formed with: its season and the yield it is divided
 * against. The type lives in `venture/venture.ts` so the dependency runs one way.
 */
export function grandMarkerFor(season: number): GrandMarker {
  return { season, baseYieldMinor: GRAND_BASE_YIELD_MINOR };
}

// ── WHAT IT COSTS — THE CREATE GATE ──────────────────────────────────────────

export interface GrandCreateFacts {
  readonly tick: number;
  readonly kind: VentureKind;
  /** The stage the create names (or defaulted to). */
  readonly stage: SystemId;
  readonly expectedStage: SystemId | null;
  readonly window: GrandWindow;
  /** The CREATOR's earned capital — the principal whose name it is in, not the acting delegate's. */
  readonly creatorFreeCash: Minor;
  /** A live grand candidate the creator is already party to (creator or role-holder), or null. */
  readonly creatorPartyTo: VentureId | null;
  /** True when the create sent a `value` or a proportion: the grand venture's terms are not negotiable. */
  readonly sentTerms: boolean;
}

/**
 * Why a `create {"grand": true}` is refused, or null when it may proceed to the ordinary checks.
 *
 * Ordered so the first refusal an agent reads is the one it can act on soonest: the clock first
 * (nothing else matters outside the FINALE), then the place, then the shape, then the price.
 */
export function grandCreateRejection(facts: GrandCreateFacts): Rejection | null {
  const w = facts.window;
  if (facts.tick < w.opens_tick) {
    return reject(
      'A14',
      `the grand venture is formed only during the FINALE: Season ${String(w.season)}'s opens at tick ` +
        `${String(w.opens_tick)} and it is tick ${String(facts.tick)}. Nothing was created. Its stage and ` +
        'yield are already published in header.season.grand, so the time to move hands there is now.',
    );
  }
  if (facts.tick > w.closes_tick) {
    return reject(
      'A14',
      `the last tick a grand candidate can be formed this season was ${String(w.closes_tick)} — a venture ` +
        `formed later would settle after the FINALE at tick ${String(w.finale_tick)}, in the next ` +
        'season, and the grand venture settles at its own season\'s FINALE or not at all. Nothing was created.',
    );
  }
  if (facts.expectedStage === null) {
    return reject('A2', 'this world has no Frontier, so it has no grand venture to form. Nothing was created.');
  }
  if (facts.stage !== facts.expectedStage) {
    return reject(
      'A2',
      `the grand venture is staged at ${facts.expectedStage} this season — the Frontier system farthest from ` +
        `the Commons — and you named ${facts.stage}. Nothing was created. Send it with "stage": ` +
        `"${facts.expectedStage}".`,
    );
  }
  if (facts.kind !== GRAND_KIND) {
    return reject(
      'PROP-V6',
      `the grand venture is a ${GRAND_KIND} — four roles, one principal each, every share elective — and you ` +
        `asked for ${facts.kind}. Nothing was created. Send "kind": "${GRAND_KIND}" with "grand": true.`,
    );
  }
  if (facts.sentTerms) {
    return reject(
      'PROP-V5',
      'the grand venture\'s terms are published, not negotiated: its value is its yield, ' +
        `${String(GRAND_BASE_YIELD_MINOR)}, and ${GRAND_KIND} is legally un-escrowable, so every share is ` +
        'elective. Send create without value or elective_bps. Nothing was created.',
    );
  }
  if (facts.creatorPartyTo !== null) {
    return reject(
      'A15',
      `the creator is already party to grand candidate ${facts.creatorPartyTo}, and a principal may be party ` +
        'to one candidate at a time — otherwise one identity could stand in every crew and carry the yield ' +
        'whichever won. Nothing was created.',
    );
  }
  if (facts.creatorFreeCash < GRAND_ROLE_STAKE_MINOR) {
    return reject(
      'A15',
      `the creator of a grand candidate must hold at least ${String(GRAND_ROLE_STAKE_MINOR)} of EARNED cash ` +
        `(market.transferable_minor) and holds ${String(facts.creatorFreeCash)}. The yield lands with the ` +
        'creator and every share is a promise, so a creator with nothing earned would be a fresh identity ' +
        'that could carry the yield and default on its whole crew for free (A15). Nothing was created.',
    );
  }
  return null;
}

// ── WHAT IT COSTS — THE FILL GATE ────────────────────────────────────────────

export interface GrandFillFacts {
  readonly stage: SystemId;
  /** Where the hand is right now, or null while it is between systems. */
  readonly handAt: SystemId | null;
  /** The stake the fill names. */
  readonly stake: Minor;
  /** The filler's earned capital. */
  readonly freeCash: Minor;
  /** A live grand candidate (other than this one) the filler is party to, or null. */
  readonly partyTo: VentureId | null;
}

/**
 * Why a `fill_role` on a grand candidate is refused, or null.
 *
 * ── ★ PRESENCE IS ENFORCED HERE, AND ONLY HERE, AND THAT IS DELIBERATE ──────────
 *
 * `vFillRole` does not check that the hand stands at the stage for an ordinary venture, and its own
 * comment says why: the heuristic cast's slot picker filters by tier, and turning the check on
 * everywhere silenced the world. The grand venture is the one venture whose whole meaning is a place
 * — §7.6's *"sited in the least-lawful space"* — so its roles are presence or nothing, and the cast's
 * grand branch and the grand affordance both choose a hand **at the stage**, so the menu and the
 * verb agree (AGT-S2).
 */
export function grandFillRejection(facts: GrandFillFacts): Rejection | null {
  if (facts.handAt !== facts.stage) {
    return reject(
      'INV-9',
      `a grand venture's role is filled by a hand STANDING at its stage, ${facts.stage}; this hand is ` +
        `${facts.handAt === null ? 'between systems' : `at ${facts.handAt}`}. Move it there first — the grand ` +
        'venture is sited in the Frontier so that reaching it is part of the price.',
    );
  }
  if (facts.partyTo !== null) {
    return reject(
      'A15',
      `you are already party to grand candidate ${facts.partyTo}; a principal may be party to one candidate ` +
        'at a time, or one identity could stand in every crew and carry the yield whichever won.',
    );
  }
  if (facts.stake < GRAND_ROLE_STAKE_MINOR) {
    return reject(
      'A15',
      `a grand role stakes at least ${String(GRAND_ROLE_STAKE_MINOR)} and you named ${String(facts.stake)}. ` +
        'Send "stake": N with N at least that. The stake is what decides which crew carries the yield, and it ' +
        'is forfeit to the rest of the crew if you withdraw (§7.3).',
    );
  }
  if (facts.stake > facts.freeCash) {
    return reject(
      'A15',
      `a grand role's stake must come out of EARNED cash (market.transferable_minor), and you hold ` +
        `${String(facts.freeCash)} of it against a stake of ${String(facts.stake)}. Your starter endowment ` +
        'cannot stake for you here: a gate a fresh identity could pay would be a gate priced in identities, ' +
        'which A15 calls no price at all.',
    );
  }
  return null;
}

// ── WHO CARRIES IT ───────────────────────────────────────────────────────────

/** One candidate at the delivery tick, as the verdict reads it. */
export interface GrandTally {
  readonly venture: VentureId;
  /** Σ of the stakes its roles locked. */
  readonly staked: Minor;
  /** True when it went LIVE — every role filled, every party signed. Only a live candidate delivers. */
  readonly live: boolean;
}

/**
 * **The verdict**: of every LIVE candidate, the one whose roles staked the most carries the yield.
 *
 * Decided once, at the delivery tick every candidate shares, from facts that were all fixed before
 * it — so no candidate is advantaged by acting later in the tick, or by asking more often (A4). Ties
 * go to the lowest venture id, which is a hash of the formation tick and the creator rather than an
 * arrival order.
 *
 * ── WHY STAKE, AND WHAT IT COSTS THE DESIGN ─────────────────────────────────
 *
 * Stake is the one figure A15 can defend: it is earned capital, per role, locked and forfeitable, so
 * one operator behind four keys pays exactly what four strangers pay. The cost is visible and is
 * written down rather than hidden — **a richer crew outbids a poorer one** — and that is the
 * anti-calcification dial SPEC §18 open decision 3 still names, reported upward with the numbers.
 */
export function chooseGrandWinner(candidates: readonly GrandTally[]): VentureId | null {
  let best: GrandTally | null = null;
  for (const c of [...candidates].sort((a, b) => cmpStr(a.venture, b.venture))) {
    if (!c.live) continue;
    if (best === null || c.staked > best.staked) best = c;
  }
  return best?.venture ?? null;
}

/** The season a tick's grand window belongs to. Re-exported so callers need one import. */
export function grandSeasonAt(tick: number): number {
  return seasonOf(tick);
}
