/**
 * Holdings — your named body on the map (SPEC §6.3). Never your assets; those
 * are STORES, and the two words must never trade places (§3).
 *
 * Exactly one per principal. It can thrive, be besieged, be taken, and be rebuilt
 * — and losing it costs stores, position and standing, but **never identity and
 * never the ability to acquire another**. That last clause is why `FALLEN` is a
 * state on a row that keeps existing rather than a deletion: the ruin is a
 * permanent projection the world remembers (Phase 0 acceptance, "remembered"),
 * and the principal is still there to have a revenge arc.
 */

import type { HoldingId, PrincipalId, SystemId } from '../core/types.js';
import { cmpStr, systemOf, tierOf, type WorldMap } from './map.js';
import { reject, type Rejection } from './result.js';

/**
 * `STANDING` or `FALLEN`. There is no third state in Phase 0: siege clocks and
 * upkeep arrears belong to Phase 1 and are deliberately absent rather than
 * stubbed, because a field nobody writes is a field an agent will read.
 */
export type HoldingState = 'INTACT' | 'FALLEN';

export interface HoldingRecord {
  readonly id: HoldingId;
  readonly principal: PrincipalId;
  /** Rendered on the map. Derived from the handle at enrolment, then permanent. */
  readonly name: string;
  system: SystemId;
  state: HoldingState;
  /** Labels the permanent ruin: "fell at Reckoning 12". Null while standing. */
  fellAtReckoning: number | null;
}

export function holdingIdFor(principal: PrincipalId): HoldingId {
  return `${principal}:holding` as HoldingId;
}

export function createHolding(
  principal: PrincipalId,
  name: string,
  system: SystemId,
): HoldingRecord {
  return {
    id: holdingIdFor(principal),
    principal,
    name,
    system,
    state: 'INTACT',
    fellAtReckoning: null,
  };
}

/**
 * A Commons holding is civic-leased: it cannot be taken (§6.3). Derived from the
 * zone tier rather than stored, because a stored `civicLease` flag and the map's
 * tier could disagree, and then two rules would answer "can this be seized".
 */
export function isCivicLeased(map: WorldMap, holding: HoldingRecord): boolean {
  return tierOf(map, holding.system) === 'COMMONS';
}

/**
 * **Commons-bound** (§4.1): "A Commons holding grants Commons-bound hands only —
 * projecting force elsewhere requires a holding that pays upkeep."
 *
 * This is A15 as a mechanism rather than as an aspiration. Enrolment is free and
 * must stay free, so 50 identities buy 150 hands for the price of nothing; what
 * stops that being 150 hands of force projection is that every one of them is
 * pinned inside the safe zone until its principal pays continuous upkeep in
 * currency and manufactured goods for a holding outside it. The gate is priced in
 * produced goods, never in identities.
 */
export function isCommonsBound(map: WorldMap, holding: HoldingRecord): boolean {
  return tierOf(map, holding.system) === 'COMMONS';
}

/**
 * Move a principal's body. The world enforces only that the destination exists
 * and the holding still stands; the *price* of a Marches or Frontier holding
 * (upkeep in currency plus manufactured goods, §6.3) is the economy's to charge,
 * and pretending to charge it here would put the anti-Sybil gate in two places.
 */
export function relocateHolding(
  map: WorldMap,
  holding: HoldingRecord,
  system: SystemId,
): Rejection | null {
  if (holding.state === 'FALLEN') {
    return reject(
      'INV-8',
      `holding ${holding.id} fell at Reckoning ${String(holding.fellAtReckoning)} and must be rebuilt before it can move`,
    );
  }
  systemOf(map, system);
  holding.system = system;
  return null;
}

/** The holding falls. The row survives; the ruin is the world's memory of it. */
export function markFallen(holding: HoldingRecord, reckoningIndex: number): void {
  holding.state = 'FALLEN';
  holding.fellAtReckoning = reckoningIndex;
}

/**
 * Where a newcomer is seated (scar #14: "a fresh agent's only asset drowned on
 * turn one" — enrolment had handed out the worst seat).
 *
 * Every COMMONS system is equally safe *by construction*, because hostile action
 * there is invalid rather than merely punished (A8) — so safety cannot be the
 * discriminator and crowding is the only axis left. Least-occupied first; ties go
 * to the newest constellation growth opened, then to the lowest system ID.
 *
 * **The seat depends on the enrolment *sequence*, not just on the set.** Crowding
 * is a function of who was seated first, so the caller must process enrolments in
 * `(priority, principal_id, client_sequence)` order (SPEC §15.2) and never in
 * arrival order — otherwise two replays of the same tick seat the same principals
 * differently and every downstream hash diverges. Asserted in `state.spec.ts`.
 */
export function safestSeat(
  map: WorldMap,
  commons: readonly SystemId[],
  occupancy: ReadonlyMap<SystemId, number>,
): SystemId {
  // ★ GROWTH (`growth.ts`): the COMMONS is no longer one enclave. A grown constellation brings two
  // civic systems of its own, empty on the day it opens, and §15.6 routes newcomers *"spatially … to
  // new constellations"*. Least-occupied first is already that rule — an empty enclave is the
  // least-occupied ground there is, so it fills until it is level with the old one, which is capacity
  // in mind rather than a quota. On a tie the NEWEST constellation wins, then the lowest id; on a map
  // that has never grown every candidate ties at rank 0 and the order is exactly what it always was.
  const rankOf = new Map<SystemId, number>();
  for (const g of map.grown) for (const id of g.systems) rankOf.set(id, g.index);
  let best: SystemId | null = null;
  let bestCount = Number.MAX_SAFE_INTEGER;
  let bestRank = -1;
  for (const id of commons) {
    const count = occupancy.get(id) ?? 0;
    const rank = rankOf.get(id) ?? 0;
    const better =
      count < bestCount ||
      (count === bestCount && rank > bestRank) ||
      (count === bestCount && rank === bestRank && best !== null && cmpStr(id, best) < 0);
    if (better) {
      best = id;
      bestCount = count;
      bestRank = rank;
    }
  }
  if (best === null) {
    throw new Error('no COMMONS system to seat a newcomer in; the map has no safe floor');
  }
  return best;
}
