/**
 * **The exit from the Commons** — SPEC §4.1's *"the graduation ground"*, §6.3's
 * priced holding, and the one choice a newcomer makes that cannot be taken back.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **THE EXIT WAS BUILT AND NEVER EXPOSED, AND THAT MADE A8 THE ENTIRE WORLD.**
 *
 * A live playtest found it from the outside. Eight probes enrolled and played the
 * running world; the predation probe reported *"I could not get raided, could not
 * resist, and could never have seen a raid coming, because in this build no raid can
 * arrive at anyone."* Three facts held it shut and each was individually correct:
 *
 *   1. enrolment always seats through `safestSeat(map, commonsSystems(map), …)`, so
 *      **every** principal starts Commons-tier;
 *   2. `commonsBoundRejection` refuses any hand movement out while the holding is
 *      Commons-tier (A15, and it is the right rule);
 *   3. `relocateHolding` existed in `holding.ts` with **no caller**, and there was no
 *      other verb that could put a holding anywhere else.
 *
 * So the Marches and the Frontier were decorative, predation could never reach a
 * player, and the world had no risk/reward choice in it anywhere. This module is the
 * missing third fact: the verb that moves a body out, at a price.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * ## Four rules, and each closes a way this could have gone wrong
 *
 * **1. Outward only.** A destination inside the Commons is refused, always. That is
 * what makes the choice a *choice*: A8 is a permanent floor for whoever is standing on
 * it, not a place to duck back into when a raid spawns. There is no return verb in this
 * build and the refusal says so in those words, so no agent learns it by being surprised.
 *
 * **2. One lane at a time — and the Commons is one place.** A body is not a teleport:
 * §4.2's whole topology argument is that *"the Frontier is two constellation hops from the
 * Commons and the Marches are unavoidably in between"*, and a `graduate` that accepted any
 * system on the map would delete that geography in one action. So outside the Commons the
 * destination must be **adjacent** to where the holding stands.
 *
 * *Leaving* the Commons is measured from the zone, not from the node, and that is not a
 * convenience — bare adjacency put a cage in the launch map. `sys-03` is an interior
 * COMMONS system with **no outward lane at all**, and `safestSeat` assigns seats by
 * crowding, so roughly one newcomer in four would have been seated somewhere with
 * `graduation.open: []` and no exit in the game. That is the defect this module exists to
 * close, reintroduced one layer down and *intermittently*, which is worse. A civic lease
 * is with the zone (§4.1 gives the Commons one guarantee and `assertMapStructure` requires
 * its systems to be connected to each other), so a Commons holding may leave by any of the
 * zone's own gates. The anti-teleport rule still bites everywhere it matters, and the
 * bound is the safe zone's own diameter, inside which nothing can be lost.
 *
 * It is also what keeps the first crossing free of a side effect nobody asked for:
 * `assertMapStructure` forbids a lane leaving a COMMONS system for another constellation,
 * so every gate out of the Commons lands in the Commons' own constellation and a first
 * graduation can never move a principal's Levy docket out from under it mid-cycle.
 *
 * **3. It is priced in produced goods and capital, never in identities** (A15). §6.3:
 * *"A Marches or Frontier holding **pays upkeep in currency plus manufactured goods** —
 * this is the anti-Sybil price of projecting force (A15) and the economy's primary
 * sink."* Both halves are charged here, at the moment of relocation, into the two sinks
 * `ledger/accounts.ts` already names for exactly this (`sink:upkeep` is literally
 * "holding upkeep"; `sink:consumption` is documented as *"a hand's consumable per
 * venture, **and a holding's upkeep good**"*). What is **not** charged yet is the
 * recurring half, and {@link GRADUATION_STATEMENT} says so out loud rather than letting
 * an agent discover the arrears mechanic by being billed for it.
 *
 * **4. Nothing here can reach into the Commons.** This module moves one holding and
 * charges its owner. It has no target but the actor, so it cannot be aimed, and the
 * inbound floor (`commons.ts`) and the outbound bind (`movement.ts`) are both untouched
 * — a Commons holding is exactly as unraidable after this landed as before it.
 *
 * ## Why the price is not a competence gate
 *
 * ## Why `RULES_VERSION` does not move for this
 *
 * It bumps when a **past** tick's computation changes, and none does. A new verb only
 * changes what a *future* action can do: no journalled action log contains `graduate`,
 * the classification table is consulted only for verbs that were submitted, the
 * observation layer is a read, and `worldCanonical` already hashed `holding.system` — a
 * field nothing could previously move. Verified rather than argued: `sim --seed rulesv
 * --ticks 200 --cast heuristic --principals 8` prints a byte-identical per-tick
 * `state_hash` stream before and after this change (md5 `2dc5fbe8…` both ways). So the
 * live world boots clean and **does not** need the divergence door. Bumping anyway would
 * force an operator to wave that door through for a non-divergence, which is exactly how
 * a door that exists to be read stops being read.
 *
 * §6.4's tier table gates the Marches on `VOUCHED`, and `PASS-PROGRESSION-NEWCOMER`
 * settles the tension: *"Competence-based graduation — Decision: **CUT TIME GATES** …
 * Readiness certificates unlock subsidized leases, matching, and standard insurance —
 * **not movement itself**."* So readiness is priced as help, and the crossing is priced
 * in goods. `post_bond` and the bond tiers land at §16 step 9; until then the gate is
 * the one §6.3 names, which is the one A15 requires anyway.
 */

import type { SystemId } from '../core/types.js';
import { minor, qty, type Minor, type Qty } from '../core/units.js';
import { cmpStr, tierOf, type WorldMap } from './map.js';
import { relocateHolding, type HoldingRecord } from './holding.js';
import { reject, type Rejection } from './result.js';

/**
 * The currency retired to `sink:upkeep` when a holding lands outside the Commons.
 *
 * A fifth of the §12.5 starter stake (250,000), so a newcomer can afford exactly one
 * crossing out of its endowment and still hold four fifths of it to play with. It is
 * **retired, not transferred**: a price paid into a sink cannot be farmed by a sock
 * puppet paying it to its operator, which is the difference between an A15 gate and an
 * A15 loophole.
 */
export const GRADUATION_UPKEEP_MINOR: Minor = minor(50_000);

/**
 * Units of the upkeep good destroyed at the same moment, into `sink:consumption`.
 *
 * A tenth of `LEVY_STARTER_ALLOTMENT` (50,000). Deliberately *not* free and deliberately
 * *not* ruinous: the point of a goods price is that it cannot be minted by enrolling
 * again (A15), not that it hurts. The good itself is named by the runtime — this module
 * is the world layer and does not know what the economy produces.
 */
export const GRADUATION_UPKEEP_QTY: Qty = qty(5_000);

/**
 * **A RULES SURFACE** (hard rule 4). This is the sentence an agent reads in
 * `agent.md` §11, in the affordance that offers the crossing, and in the refusal that
 * declines it — and `graduationRejection` below is what actually happens. `agent.md`
 * carries it verbatim and `test/rules-surface/agent-md.test.ts` pins the two together,
 * because scar #1 is the engine and the agent-facing text disagreeing about one word
 * and it survived a full build and three critic passes.
 */
export const GRADUATION_STATEMENT =
  'You start in the Commons and nothing can hurt you there: hostile action against you is INVALID, not ' +
  'punished, and it never expires. You may stay forever. `graduate` moves your holding one lane outward, to ' +
  'an adjacent MARCHES or FRONTIER system, and it is the only way out. It costs ' +
  `${String(GRADUATION_UPKEEP_MINOR)} in currency plus ${String(GRADUATION_UPKEEP_QTY)} units of the upkeep ` +
  'good, charged the moment it lands. From that moment your hands are no longer Commons-bound, everything ' +
  'you hold travels with your body and can be raided where it stands, and world raids can name you. ' +
  'IT IS ONE-WAY: `graduate` never accepts a COMMONS destination and this build has no verb that moves a ' +
  'holding back in. Recurring upkeep is NOT charged yet — §6.3 makes a Marches or Frontier holding pay it ' +
  'continuously, and that arrives with the Charge (§16 sovereignty); today you pay once, at the crossing.';

/**
 * Systems a holding could graduate to right now: outside the Commons, one gate away.
 *
 * From a Commons seat "one gate away" means **any gate the Commons has**, for the reason
 * in this module's header — bare adjacency leaves `sys-03` with no exit and turns the
 * floor into a cage for one seat in four. From anywhere else it means adjacent, full stop.
 *
 * Canonical order, so the affordance list, the refusal's suggestion and any test read
 * the same sequence — an agent that copies the first one offered must get the same
 * system on a replay (DET-2).
 */
export function graduationDestinations(
  map: WorldMap,
  holding: HoldingRecord,
): readonly SystemId[] {
  const here = map.systems.get(holding.system);
  if (here === undefined) return [];
  const outward = (system: SystemId): readonly SystemId[] =>
    [...(map.systems.get(system)?.lanes ?? [])].filter(
      (id) => map.systems.get(id) !== undefined && tierOf(map, id) !== 'COMMONS',
    );
  if (tierOf(map, holding.system) !== 'COMMONS') return [...outward(holding.system)].sort(cmpStr);

  // The zone's gates, not this node's. Restricted to the holding's own constellation so
  // that a second Commons constellation could never make this a cross-region jump.
  const gates = new Set<SystemId>();
  for (const system of map.systemOrder) {
    if (tierOf(map, system) !== 'COMMONS') continue;
    if (map.systems.get(system)?.constellation !== here.constellation) continue;
    for (const id of outward(system)) gates.add(id);
  }
  return [...gates].sort(cmpStr);
}

/**
 * The world's half of the gate: may this holding cross to `destination` at all?
 *
 * Price and affordability are **not** here on purpose. The world knows about bodies and
 * lanes; the economy knows what a principal can pay, and putting the anti-Sybil charge
 * in two places is how one of them silently stops being enforced. The runtime composes
 * the two and this function is the half a fixture can drive with no ledger at all.
 */
export function graduationRejection(
  map: WorldMap,
  holding: HoldingRecord,
  destination: SystemId,
): Rejection | null {
  if (holding.state === 'FALLEN') {
    return reject(
      'INV-8',
      `your holding ${holding.id} fell at Reckoning ${String(holding.fellAtReckoning)}. A ruin does not ` +
        'travel; it has to be rebuilt where it stands before it can be moved again.',
    );
  }
  if (map.systems.get(destination) === undefined) {
    return reject(
      'A2',
      `there is no system ${destination}. You can graduate to any of these, and to nothing else right now: ` +
        `${describeDestinations(map, holding)}.`,
    );
  }
  if (tierOf(map, destination) === 'COMMONS') {
    return reject(
      'A8',
      `${destination} is a COMMONS system, and \`graduate\` only ever moves outward. Leaving the Commons is ` +
        'ONE-WAY: it is how you give up the permanent safe floor in exchange for a place raids and rivals ' +
        'can reach, and there is no verb in this build that moves a holding back in. If you want to stay ' +
        'safe, do nothing — the Commons never expires. Outward from here: ' +
        `${describeDestinations(map, holding)}.`,
    );
  }
  if (destination === holding.system) {
    return reject(
      'A2',
      `your holding already stands at ${destination}. \`graduate\` moves it one lane; it is not a way to ` +
        'pay upkeep in place.',
    );
  }
  if (!graduationDestinations(map, holding).includes(destination)) {
    const inside = tierOf(map, holding.system) === 'COMMONS';
    return reject(
      'A2',
      `${destination} is not one gate away, and a holding moves one lane at a time — your body is not a ` +
        'convoy and it does not teleport. The Frontier is reached through the Marches, one crossing at a ' +
        'time. ' +
        (inside
          ? 'The Commons is one place and you may leave it by any of its own gates, which are: '
          : `From ${holding.system} you can reach: `) +
        `${describeDestinations(map, holding)}.`,
    );
  }
  return null;
}

/**
 * Move the body. Returns the rejection, or `null` having relocated the holding.
 *
 * Deliberately thin, and deliberately the only caller of {@link relocateHolding} outside
 * a fixture: one road in means the gate above cannot be bypassed by a future caller that
 * "just needs to move a holding".
 */
export function graduateHolding(
  map: WorldMap,
  holding: HoldingRecord,
  destination: SystemId,
): Rejection | null {
  const fault = graduationRejection(map, holding, destination);
  if (fault !== null) return fault;
  return relocateHolding(map, holding, destination);
}

/** The open crossings as one readable clause, for a refusal that has to teach. */
function describeDestinations(map: WorldMap, holding: HoldingRecord): string {
  const open = graduationDestinations(map, holding);
  if (open.length === 0) {
    return `nowhere — no lane out of ${holding.system} leaves the Commons`;
  }
  return open.map((id) => `${id} (${tierOf(map, id)})`).join(' · ');
}
