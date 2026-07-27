/**
 * `refine`, as a function of its inputs rather than a method on the world.
 *
 * ── WHY THIS LIVES HERE AND NOT IN `sim/runtime.ts` ──────────────────────────
 *
 * `runtime.ts` is 9,786 lines — 12% of the engine in one class, holding 26 verb handlers and 141
 * private helpers, with the handlers alone spanning ~7,200 of those lines. That is not a style
 * complaint. On 2026-07-26 **three separate mechanical edits landed in the wrong place in it and all
 * three passed `tsc`**:
 *
 *   - a mutation test hit the wrong one of two `recordSpend` calls 400 lines apart, appeared to pass,
 *     and produced a confidently wrong finding;
 *   - the `refine` affordance was spliced INSIDE the `build` affordance's
 *     `if (affordable && !alreadyHeld)`, so it was never offered to anyone holding ore — who by
 *     definition already hold a WORKS;
 *   - and an earlier brace-matching edit cut a method in half.
 *
 * A file that cannot be held in view makes "verify by reading" impossible and pushes everything onto
 * tests, which only catch what they were written to catch. Phase 2 adds more verbs, so the useful move
 * is not a heroic 7,000-line refactor at the end of a long session — it is to stop growing the monolith
 * and leave a worked example of the shape that replaces it.
 *
 * **This is that example.** The pattern is the one the codebase already uses elsewhere — `TargetPort`,
 * `PredationPort`, `RaidViewPort`, and the verb logic already living in `world/movement.ts`: a narrow
 * PORT of exactly what the operation reads and writes, so the function is testable without a world and
 * the runtime method shrinks to an adapter that gathers inputs.
 *
 * The port is deliberately narrow. Passing the whole `Runtime` would compile and would buy nothing:
 * the value here is that the signature ENUMERATES the operation's reach, so a reviewer can see it
 * touches lots, the ledger, and nothing else.
 */

import type { EventId, GoodId, PrincipalId, SystemId } from '../core/types.js';
import { qty, type Qty } from '../core/units.js';
import { reject, type WorldResult } from '../world/result.js';
import { REFINE_IN_QTY, REFINE_OUT_QTY, WORKS_GOOD, WORKS_YIELD_GOOD } from './params.js';

/** An unpledged parcel of one good standing at one place. */
export interface RefinableLot {
  readonly id: string;
  readonly qty: number;
}

/**
 * Everything `refine` touches. Nothing else is reachable from here, which is the point.
 */
export interface RefinePort {
  /** Unpledged lots of `good` this principal holds AT `system`, canonical order. */
  readonly lotsOf: (principal: PrincipalId, system: SystemId, good: GoodId) => readonly RefinableLot[];
  /** Destroy `qty` from one lot, into the CONSUMPTION sink. */
  readonly destroy: (args: { readonly eventId: EventId; readonly lotId: string; readonly qty: Qty }) => void;
  /** Create `qty` of `good` at `location`, from the PRODUCTION faucet. */
  readonly source: (args: {
    readonly eventId: EventId;
    readonly good: GoodId;
    readonly qty: Qty;
    readonly location: SystemId;
  }) => void;
}

/**
 * Turn raw {@link WORKS_YIELD_GOOD} into the good every obligation is payable in.
 *
 * §10's *"one build step"*. A WORKS extracts ore; the Levy, a sovereignty Charge and the goods half of
 * a WORKS build are each payable in rations; this is the only conversion. Located, like everything
 * else (§10.2): the output appears **where the ore stood**, never at the actor's seat — goods that
 * appeared at a holding the hand had left would be a located fact that was false, the error D8
 * corrected in the Levy.
 *
 * `wanted` is a quantity of OUTPUT, or null for "every whole batch I can". Whole batches only: a
 * partial batch would either round in the actor's favour or silently destroy the remainder, and §10.2
 * requires published rounding rather than a choice made here.
 */
export function refine(
  port: RefinePort,
  principal: PrincipalId,
  system: SystemId,
  tick: number,
  wanted: number | null,
): WorldResult<null> {
  const lots = port.lotsOf(principal, system, WORKS_YIELD_GOOD);
  const have = lots.reduce((n, l) => n + l.qty, 0);
  if (have < REFINE_IN_QTY) {
    return reject(
      'A2',
      `refine turns ${WORKS_YIELD_GOOD} into ${WORKS_GOOD}, and you have ${String(have)} unpledged ` +
        `${WORKS_YIELD_GOOD} at ${system} — the recipe needs ${String(REFINE_IN_QTY)}. A WORKS yields ` +
        `${WORKS_YIELD_GOOD} where it stands; ${WORKS_GOOD} is what the Levy, a Charge and a WORKS ` +
        `build are payable in. Encumbered lots do not count.`,
    );
  }

  const batches = wanted === null ? Math.trunc(have / REFINE_IN_QTY) : Math.trunc(wanted / REFINE_OUT_QTY);
  if (batches <= 0) {
    return reject('A2', `refine needs a positive quantity; ${String(wanted)} rounds to no whole batch.`);
  }
  const takeQty = batches * REFINE_IN_QTY;
  if (takeQty > have) {
    return reject(
      'A2',
      `${String(batches)} batch(es) would consume ${String(takeQty)} ${WORKS_YIELD_GOOD} and you have ` +
        `${String(have)} at ${system}.`,
    );
  }

  // ── DESTROY FIRST, THEN SOURCE ──────────────────────────────────────────────
  //
  // The ordering rule the delegated `create` path documents (AGT-X9). If the second half failed after
  // the first, destroy-then-fail leaves the actor poorer — safe, visible, and recoverable — where
  // source-then-fail mints goods from nothing and breaks supply conservation, which is the one thing
  // INV-1 exists to catch and the worst possible residue to leave in an append-only record.
  let taken = 0;
  for (const lot of lots) {
    if (taken >= takeQty) break;
    const portion = Math.min(takeQty - taken, lot.qty);
    if (portion <= 0) continue;
    port.destroy({
      eventId: `refine.in:${principal}:${String(tick)}:${lot.id}` as EventId,
      lotId: lot.id,
      qty: qty(portion),
    });
    taken += portion;
  }
  port.source({
    eventId: `refine.out:${principal}:${String(tick)}:${system}` as EventId,
    good: WORKS_GOOD,
    qty: qty(batches * REFINE_OUT_QTY),
    location: system,
  });
  return { ok: true, value: null };
}
