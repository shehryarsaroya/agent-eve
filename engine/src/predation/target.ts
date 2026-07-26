/**
 * Target selection — **a published rule, not a choice** (SPEC §9, A12).
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **NOBODY OWNS A WORLD RAID, SO NOBODY CAN BE BRIBED TO CALL ONE OFF.** §9's whole
 * argument for world-spawned predation is that cheap, ownable predation Coase-collapses
 * into a toll cartel — the raider posts an 8% passage fee, everyone pays it, the escort
 * market never opens and the map renders identically to peace. A rule with no owner
 * cannot be negotiated with. A12 permits exactly this and no more: *a target-selection
 * rule is physics; an outcome is never authored.*
 * ══════════════════════════════════════════════════════════════════════════
 *
 * ## The rule, in full
 *
 * Among principals with at least {@link RAID_MIN_TARGET_QTY} of some good standing
 * **outside the Commons**, rank by
 *
 *   1. the most goods standing outside the Commons — descending, the "most exposed"
 *      clause of §9, expressed in units rather than in the canon's `EXPOSURE`, which
 *      §3 reserves for Σ open `max_direct_loss` and which this is not;
 *   2. the fewest of that principal's own present hands at the stage — ascending, the
 *      "briefly undefended" clause;
 *   3. lowest principal id — the deterministic tiebreak (DET-2).
 *
 * Skipped entirely: anything inside the Commons (A8 — **invalid**, not punished, and
 * `PRD-1` halts the tick if one ever slips through), a principal inside its victim
 * cooldown (scar #14), and a stage a previous raid was repulsed at.
 *
 * ## The Commons is a floor here, in the one place a floor can be built
 *
 * The Commons check is on the **lot's location**, not on the principal's holding. A
 * Commons-seated principal that has hauled goods out into the Marches is raidable for
 * exactly those goods and for nothing it left at home — which is A8 read literally
 * ("safety protects your holding, your identity and your record — *not your wealth*")
 * and is why `assailableOf` filters lots rather than principals.
 */

import type { GoodId, PrincipalId, SystemId } from '../core/types.js';
import { qty, type Qty } from '../core/units.js';
import { compareIds } from '../ledger/order.js';
import { RAID_MIN_TARGET_QTY } from './params.js';
import type { Book } from './book.js';

/**
 * One reachable pile: located goods a raid could actually take.
 *
 * Supplied by the runtime as a narrow port rather than by handing this module a
 * `Ledger`, for the reason `SweepPort` exists in the Levy: a module that could reach the
 * whole ledger would eventually read something it should not, and predation reading a
 * private stockpile is the "Charge fuel gauge" mistake with worse consequences.
 */
export interface AssailablePile {
  readonly lotId: string;
  readonly good: GoodId;
  readonly qty: Qty;
  readonly location: SystemId;
}

/** What the target rule needs from the world. Everything is a read. */
export interface TargetPort {
  /** The roll, in enrolment order. The same roll INV-25 is checked against. */
  principals(): readonly PrincipalId[];
  /**
   * Unpledged, `AVAILABLE` lots this principal holds at a **non-COMMONS** system, in
   * canonical lot order. The Commons filter lives in the implementation because only
   * the runtime can see the map; `PRD-1` re-checks the answer every tick, so a port
   * that got it wrong halts rather than quietly opening the floor.
   */
  assailableOf(principal: PrincipalId): readonly AssailablePile[];
  /** This principal's own hands, present and able to act, at `system`. */
  presentHandsAt(principal: PrincipalId, system: SystemId): number;
}

/** A ranked candidate. Everything a spawn needs, and nothing the target holds privately. */
export interface RaidCandidate {
  readonly principal: PrincipalId;
  readonly stage: SystemId;
  readonly good: GoodId;
  /** What this principal had standing at `stage` in `good` when the rule ran. */
  readonly standing: Qty;
  /** Its own present hands at `stage`. The "briefly undefended" term. */
  readonly hands: number;
}

/**
 * Everything the rule would consider, ranked, best target first.
 *
 * Returned in full rather than as a single winner so the spawn can walk down the list
 * when the head is already carrying a live raid, and so a test can assert the *order*
 * rather than only the choice — the order is the published rule, and a rule you can
 * only observe one sample of is not checkable.
 */
export function rankCandidates(port: TargetPort, book: Book, tick: number): readonly RaidCandidate[] {
  const candidates: RaidCandidate[] = [];

  for (const principal of [...port.principals()].sort(compareIds)) {
    if (book.isVictimCooling(principal, tick)) continue;

    // Sum by (system, good): a raid happens at one place, against one good. Summing
    // across places would let a raid demand goods from two systems at once, which is
    // the teleport shape D8 closed for the Levy.
    const byPlace = new Map<string, { stage: SystemId; good: GoodId; standing: number }>();
    for (const pile of port.assailableOf(principal)) {
      if (pile.qty <= 0) continue;
      const key = `${pile.location}|${pile.good}`;
      const row = byPlace.get(key) ?? { stage: pile.location, good: pile.good, standing: 0 };
      row.standing += pile.qty;
      byPlace.set(key, row);
    }

    for (const row of [...byPlace.values()].sort(
      (a, b) => compareIds(a.stage, b.stage) || compareIds(a.good, b.good),
    )) {
      if (row.standing < RAID_MIN_TARGET_QTY) continue;
      if (book.isStageHeld(row.stage, tick)) continue;
      candidates.push({
        principal,
        stage: row.stage,
        good: row.good,
        standing: qty(row.standing),
        hands: port.presentHandsAt(principal, row.stage),
      });
    }
  }

  return candidates.sort(
    (a, b) =>
      b.standing - a.standing ||
      a.hands - b.hands ||
      compareIds(a.principal, b.principal) ||
      compareIds(a.stage, b.stage) ||
      compareIds(a.good, b.good),
  );
}
