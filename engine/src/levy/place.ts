/**
 * The named place. §5.2: the Levy is payable *"only in located goods physically
 * delivered to a named place"*, so somewhere has to be that place, and which
 * somewhere is a rules surface rather than an implementation detail.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **THE DELIVERY PLACE MUST BE REACHABLE BY EVERY PRINCIPAL ASSESSED THERE.**
 *
 * A Commons-bound principal may only move between Commons systems (A15, §4.1), and
 * constellation 0 of the launch map is *mixed* — its first four systems are COMMONS
 * and the rest are MARCHES. A delivery place chosen by bare canonical order would
 * therefore land in the Marches for a constellation full of Commons-bound
 * newcomers, and every one of them would be permanently, unavoidably short: an
 * obligation the rules make impossible to discharge, recorded against a real agent
 * every night. That is the A5′ shape with the engine's own geography as the cause.
 *
 * So the rule is: **the lowest-id COMMONS system in the constellation if it has one,
 * otherwise its lowest-id system.** Deterministic, published, and reachable from
 * every seat the constellation offers.
 * ══════════════════════════════════════════════════════════════════════════
 */

import type { ConstellationId, PrincipalId, SystemId } from '../core/types.js';
import { cmpStr, tierOf, type WorldMap } from '../world/index.js';
import { holdingOf, type WorldState } from '../world/state.js';

/** The sentence `agent.md` would carry if it named the rule. Stated once, here. */
export const DELIVERY_PLACE_STATEMENT =
  'The Levy is delivered to one named place per constellation: its lowest-id Commons system, or its ' +
  'lowest-id system if it has no Commons. Every principal seated in the constellation can reach it.';

/**
 * The delivery place for a constellation, or `null` if the constellation is unknown.
 *
 * `null` rather than a throw: this is read from the observation layer and from the
 * frame renderer, and neither may be brought down by a principal whose holding sits
 * somewhere the map does not admit (AGT-X9 — nothing agent-reachable halts the world).
 */
export function deliveryPlaceOf(map: WorldMap, constellation: ConstellationId): SystemId | null {
  const rows = map.constellations.get(constellation);
  if (rows === undefined) return null;
  const systems = [...rows.systems].sort(cmpStr);
  for (const system of systems) {
    if (tierOf(map, system) === 'COMMONS') return system;
  }
  return systems[0] ?? null;
}

/** Which constellation a principal belongs to: the one its HOLDING stands in. */
export function constellationOf(state: WorldState, principal: PrincipalId): ConstellationId | null {
  const holding = state.holdingByPrincipal.get(principal) === undefined ? null : holdingOf(state, principal);
  if (holding === null) return null;
  return state.map.systems.get(holding.system)?.constellation ?? null;
}

/**
 * Every principal on the roll, grouped by constellation, in canonical order.
 *
 * Built from `principalOrder` rather than from the holdings map, because
 * `principalOrder` is enrolment order and is the roll INV-25 is checked against — two
 * roads to "who is enrolled" would be two answers to "who must be on the docket".
 */
export function rollByConstellation(
  state: WorldState,
): ReadonlyMap<ConstellationId, readonly PrincipalId[]> {
  const out = new Map<ConstellationId, PrincipalId[]>();
  for (const principal of [...state.principalOrder].sort(cmpStr)) {
    const constellation = constellationOf(state, principal);
    if (constellation === null) continue;
    const list = out.get(constellation) ?? [];
    list.push(principal);
    out.set(constellation, list);
  }
  return out;
}
