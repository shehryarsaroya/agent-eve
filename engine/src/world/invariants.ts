/**
 * The presence invariants: INV-8, INV-9, INV-10 (`TESTING.md` §3).
 *
 * These run in the ASSERT phase of **every tick, in production, forever** — not
 * only in CI. At 300 principals x 3 hands that is 900 rows, so there is no reason
 * to sample, and on failure the tick aborts and the world halts rather than
 * publishing (SPEC §15.2). A broken presence table is not a cosmetic problem: a
 * hand in two places is a hand in two ventures, which is a settlement paying twice.
 *
 * INV-9 is asserted here *even though* the database's partial unique index on
 * `venture_role.filled_by_hand_id` also enforces it, because — quoting
 * `TESTING.md` — "the index is the thing most likely to be dropped by a careless
 * migration".
 */

import type { HandId, InvariantViolation } from '../core/types.js';
import { expectedArrivalTick, HANDS_PER_PRINCIPAL, inTransitEta, type HandRecord } from './hands.js';
import { laneBetween } from './map.js';
import { handsInOrder, type WorldState } from './state.js';

/**
 * Which hands are filled into a venture role, and how many times each appears.
 *
 * Passed in rather than read, because `venture_role.filled_by_hand_id` is the
 * single home of commitment and this module must not become a second one (§6.2,
 * scar #5). The **counts** matter, not just membership: "at most one role" is a
 * multiplicity claim, and a set would silently satisfy it.
 */
export type RoleFills = ReadonlyMap<HandId, number>;

export const NO_ROLE_FILLS: RoleFills = new Map<HandId, number>();

function violation(
  id: string,
  tick: number,
  message: string,
  severity: 'HALT' | 'WARN' = 'HALT',
): InvariantViolation {
  return { id, message, tick, severity };
}

/**
 * INV-8 — every principal has exactly 3 hands, and hands are never destroyed.
 *
 * "Never destroyed" cannot be observed from one snapshot, so it is enforced
 * structurally instead: the count is exactly `HANDS_PER_PRINCIPAL` for every
 * enrolled principal at every tick, so a deletion shows up as a missing row on
 * the very next assert. A lost hand is `RECOVERING` with a `freeAtTick` — loss is
 * time, never capacity.
 */
export function checkInv8(state: WorldState, tick: number): InvariantViolation[] {
  const out: InvariantViolation[] = [];

  for (const principal of state.principalOrder) {
    const ids = state.handsByPrincipal.get(principal) ?? [];
    if (ids.length !== HANDS_PER_PRINCIPAL) {
      out.push(
        violation(
          'INV-8',
          tick,
          `principal ${principal} has ${ids.length} hands, not ${HANDS_PER_PRINCIPAL}`,
        ),
      );
    }
    for (const id of ids) {
      if (!state.hands.has(id)) {
        out.push(violation('INV-8', tick, `hand ${id} of ${principal} no longer exists`));
      }
    }
    if (!state.holdingByPrincipal.has(principal)) {
      out.push(violation('INV-8', tick, `principal ${principal} has no holding to recover hands at`));
    }
  }

  for (const hand of state.hands.values()) {
    const ids = state.handsByPrincipal.get(hand.principal);
    if (ids === undefined || !ids.includes(hand.id)) {
      out.push(
        violation('INV-8', tick, `hand ${hand.id} is not listed under its principal ${hand.principal}`),
      );
    }
    if (hand.state === 'RECOVERING' && hand.freeAtTick === null) {
      out.push(
        violation(
          'INV-8',
          tick,
          `hand ${hand.id} is RECOVERING with no freeAtTick, so its loss is capacity rather than time`,
        ),
      );
    }
  }

  return out;
}

/**
 * INV-9 — every hand is in exactly one state, and appears in at most one role.
 *
 * "Exactly one state" is not free just because `state` is a single column: a hand
 * marked IDLE while carrying a destination and an ETA is in two states in every
 * way that matters. So the fields that only make sense in one state are checked
 * against it.
 *
 * The role half:
 *   - a hand may appear in **at most one** `filled_by_hand_id`;
 *   - a hand in a role is `COMMITTED` (stationed) or `IN_TRANSIT` (travelling for
 *     it — an escort's whole job), never `IDLE` and never `RECOVERING`, because a
 *     lost hand must be released from its role rather than silently kept;
 *   - a `COMMITTED` hand is in a role, or the flag has no referent.
 */
export function checkInv9(
  state: WorldState,
  tick: number,
  fills: RoleFills = NO_ROLE_FILLS,
): InvariantViolation[] {
  const out: InvariantViolation[] = [];

  for (const hand of handsInOrder(state)) {
    out.push(...checkHandStateFields(hand, tick));

    const count = fills.get(hand.id) ?? 0;
    if (count > 1) {
      out.push(
        violation(
          'INV-9',
          tick,
          `hand ${hand.id} fills ${count} venture roles; a hand is one unit of simultaneous presence`,
        ),
      );
    }
    if (count === 1 && hand.state !== 'COMMITTED' && hand.state !== 'IN_TRANSIT') {
      out.push(
        violation(
          'INV-9',
          tick,
          `hand ${hand.id} fills a venture role but is ${hand.state}; release it from the role or commit it`,
        ),
      );
    }
    if (count === 0 && hand.state === 'COMMITTED') {
      out.push(
        violation('INV-9', tick, `hand ${hand.id} is COMMITTED but fills no venture role`),
      );
    }
  }

  for (const [handId, count] of fills) {
    if (!state.hands.has(handId)) {
      out.push(
        violation('INV-9', tick, `venture role is filled by ${handId}, which is not a hand (${count}x)`),
      );
    }
  }

  return out;
}

function checkHandStateFields(hand: HandRecord, tick: number): InvariantViolation[] {
  const out: InvariantViolation[] = [];
  const settled = (): void => {
    if (hand.destination !== null) {
      out.push(
        violation('INV-9', tick, `hand ${hand.id} is ${hand.state} but has destination ${hand.destination}`),
      );
    }
    if (hand.freeAtTick !== null) {
      out.push(
        violation(
          'INV-9',
          tick,
          `hand ${hand.id} is ${hand.state} but has freeAtTick ${String(hand.freeAtTick)}`,
        ),
      );
    }
    if (hand.departedAtTick !== null) {
      out.push(
        violation(
          'INV-9',
          tick,
          `hand ${hand.id} is ${hand.state} but has departedAtTick ${String(hand.departedAtTick)}`,
        ),
      );
    }
  };

  switch (hand.state) {
    case 'IDLE':
    case 'COMMITTED':
      settled();
      break;
    case 'IN_TRANSIT':
      if (hand.destination === null) {
        out.push(violation('INV-9', tick, `hand ${hand.id} is IN_TRANSIT with no destination`));
      } else if (hand.destination === hand.location) {
        out.push(
          violation('INV-9', tick, `hand ${hand.id} is IN_TRANSIT to where it already is (${hand.location})`),
        );
      }
      if (hand.freeAtTick === null) {
        out.push(violation('INV-9', tick, `hand ${hand.id} is IN_TRANSIT with no arrival tick`));
      }
      if (hand.departedAtTick === null) {
        out.push(violation('INV-9', tick, `hand ${hand.id} is IN_TRANSIT with no departure tick`));
      }
      break;
    case 'RECOVERING':
      if (hand.destination !== null) {
        out.push(
          violation('INV-9', tick, `hand ${hand.id} is RECOVERING but has destination ${hand.destination}`),
        );
      }
      if (hand.freeAtTick === null) {
        out.push(violation('INV-9', tick, `hand ${hand.id} is RECOVERING with no freeAtTick`));
      }
      if (hand.departedAtTick !== null) {
        out.push(
          violation(
            'INV-9',
            tick,
            `hand ${hand.id} is RECOVERING but still carries departedAtTick ${String(hand.departedAtTick)}`,
          ),
        );
      }
      break;
  }
  return out;
}

/**
 * INV-10 — a hand's `in_transit_eta` agrees with its origin, its destination and
 * the gate transit table.
 *
 * Three separate claims, all needed:
 *   1. the lane it is flying exists (a hand cannot be between unconnected systems);
 *   2. `freeAtTick === departedAtTick + lane.transitTicks` — the published ETA is
 *      the table's answer, not a number someone computed once and then adjusted;
 *   3. the ETA has not already passed, because MOVE runs before every resolution
 *      phase, so an unresolved arrival at assert time means MOVE was skipped or ran
 *      in the wrong order — the exact "every published ETA is a tick optimistic"
 *      failure SPEC §15.2 warns about, caught the tick it appears.
 */
export function checkInv10(state: WorldState, tick: number): InvariantViolation[] {
  const out: InvariantViolation[] = [];

  for (const hand of handsInOrder(state)) {
    // Field consistency for settled and recovering hands belongs to INV-9 — a
    // RECOVERING hand legitimately carries a freeAtTick, so "has a free tick but
    // is not travelling" is not a claim this invariant can make.
    if (hand.state !== 'IN_TRANSIT') continue;

    const destination = hand.destination;
    if (destination === null || hand.departedAtTick === null) {
      // Reported by INV-9; nothing consistent to check here.
      continue;
    }
    const lane = laneBetween(state.map, hand.location, destination);
    if (lane === null) {
      out.push(
        violation(
          'INV-10',
          tick,
          `hand ${hand.id} is in transit ${hand.location} -> ${destination} but no lane joins them`,
        ),
      );
      continue;
    }
    // Compare the *published* field against the *table's* answer. Checking the
    // stored field against itself would be tautological, and the thing that must
    // be true is that what an agent reads is what the gate table says.
    const published = inTransitEta(hand);
    const expected = expectedArrivalTick(state.map, hand);
    if (published !== expected) {
      out.push(
        violation(
          'INV-10',
          tick,
          `hand ${hand.id} publishes in_transit_eta ${String(published)} but the gate table says ` +
            `${String(hand.departedAtTick)} + ${lane.transitTicks} = ${String(expected)}`,
        ),
      );
    }
    if (published !== null && published <= tick) {
      out.push(
        violation(
          'INV-10',
          tick,
          `hand ${hand.id} should have arrived at tick ${String(published)} but is still in transit ` +
            `at tick ${tick}; MOVE must run before every resolution phase`,
        ),
      );
    }
  }

  return out;
}

/**
 * All presence invariants. Returns violations rather than throwing: the tick loop
 * owns the halt, because halting is a world-level decision with defined semantics
 * (PAUSED, last good snapshot, queued submissions) and a module that throws from
 * inside a phase would bypass all of it.
 */
export function checkWorldInvariants(
  state: WorldState,
  tick: number,
  fills: RoleFills = NO_ROLE_FILLS,
): InvariantViolation[] {
  return [...checkInv8(state, tick), ...checkInv9(state, tick, fills), ...checkInv10(state, tick)];
}
