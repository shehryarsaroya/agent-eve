/**
 * THE TRIBUTE LINE — §5.2 calls it *"the highest-leverage single edit available"* and
 * A13 makes it non-optional: no named pixel signature, not ready.
 *
 * > A line from each assessed principal's holding to the delivery place, thickness
 * > proportional to the amount owed: **dashed** while no hand is assigned, **solid**
 * > while a hand is en route, **red at the freeze if unpaid**, and a shortfall seizure
 * > renders as that line **reversing**. — §5.2
 *
 * What it buys, and each clause is a reason a line exists rather than a stat:
 *
 *   - **Every principal on the map every day.** The Commons turtle has a line too, and
 *     it is the thickest one under the published default.
 *   - **Turtling made visible rather than merely taxed.**
 *   - **Continuous off-peak motion from a source that cannot go quiet** — hands walking
 *     to a delivery place on a Tuesday afternoon.
 *   - **`LEVY SHORT` decomposable**, so a stranger can see *whose* line is red.
 *   - **A forming cartel visible on screen**: if a handful of hands are drawing everyone
 *     else's tribute lines, the convergence *is* the cartel (AGT-X4's pass criterion is
 *     not that the cartel fails, but that it is visible while it succeeds).
 *
 * ══════════════════════════════════════════════════════════════════════════
 * `TributeLine` and `TributeLineState` are **defined in `frames/contract.ts` and are not
 * redefined here.** This module populates them. A second definition would be two shapes
 * for one thing on screen, and the client already draws the first one.
 * ══════════════════════════════════════════════════════════════════════════
 */

import { inFreeze, isSettlementTick } from '../core/time.js';
import type { PrincipalId } from '../core/types.js';
import { minor } from '../core/units.js';
import type { TributeLine, TributeLineState } from '../frames/contract.js';
import { compareIds } from '../ledger/order.js';
import { holdingOf, type WorldState } from '../world/state.js';
import type { Book } from './book.js';
import { MAX_TRIBUTE_LINES } from './params.js';
import { carriageUnderway } from './payment.js';

/**
 * One principal's line state.
 *
 * Order matters and is §5.2's order read backwards, most-final first: a seizure has
 * happened, or the freeze has passed with the tribute unpaid, or a hand is dealing with
 * it, or nothing is. A line that had been swept must not render as merely `RED`, because
 * the reversal is the only frame in which the sweep is visible at all.
 */
export function tributeStateFor(args: {
  readonly book: Book;
  readonly world: WorldState;
  readonly reckoning: number;
  readonly tick: number;
  readonly principal: PrincipalId;
}): TributeLineState {
  const { book, reckoning, principal } = args;
  const plan = book.lineFor(reckoning, principal)?.plan ?? null;
  if (plan === null) return 'DASHED';

  const payment = book.paymentOf(reckoning, principal);
  if (payment.swept > 0) return 'REVERSING';

  const owing = book.owingOf(reckoning, principal);
  if (owing.owed > 0 && (inFreeze(args.tick) || isSettlementTick(args.tick))) return 'RED';
  if (owing.owed > 0 && book.isSettled(reckoning)) return 'RED';

  if (carriageUnderway(args.world, principal, plan.deliverableTo, args.tick)) return 'SOLID';
  return 'DASHED';
}

/**
 * Every assessed principal's tribute line for one Reckoning.
 *
 * A paid-in-full line is **kept, at zero thickness**, rather than dropped. §5.2 wants
 * "every principal on the map every day", and a line that vanished on payment would make
 * the screen quietest exactly when the most had been paid — which is the opposite of
 * legible. Thickness is proportional to the amount *owed*, so a discharged tribute is a
 * hairline and a turtle's is a rope.
 */
export function tributeLinesFor(args: {
  readonly book: Book;
  readonly world: WorldState;
  readonly reckoning: number;
  readonly tick: number;
}): readonly TributeLine[] {
  const lines: TributeLine[] = [];
  for (const plan of args.book.plansIn(args.reckoning)) {
    for (const line of [...plan.lines].sort((a, b) => compareIds(a.principal, b.principal))) {
      if (args.world.holdingByPrincipal.get(line.principal) === undefined) continue;
      const owing = args.book.owingOf(args.reckoning, line.principal);
      lines.push({
        principal: line.principal,
        from: holdingOf(args.world, line.principal).id,
        to: plan.deliverableTo,
        owed: minor(owing.owed),
        state: tributeStateFor({
          book: args.book,
          world: args.world,
          reckoning: args.reckoning,
          tick: args.tick,
          principal: line.principal,
        }),
      });
    }
  }
  // Sorted by amount owed, descending, so a truncated frame drops hairlines rather than
  // ropes. The cap is a declared bound (INV-26, scar #3) and not a legibility budget:
  // unnamed density is what §14.1 asks for beyond seven labels, and a line is not a label.
  return lines
    .sort((a, b) => b.owed - a.owed || compareIds(a.principal, b.principal))
    .slice(0, MAX_TRIBUTE_LINES);
}

/**
 * `LEVY SHORT` as the headline meter reads it, decomposed to whose line is red.
 *
 * The total is Σ owed over the assessed, not the settled shortfall rows, so it is live
 * all cycle rather than only after settlement — which is what makes the headline
 * `LEVY SHORT 1.8M · RECKONING 02:14` a countdown rather than a result.
 */
export function levyShortNow(book: Book, reckoning: number): {
  readonly total: ReturnType<typeof minor>;
  readonly red: readonly PrincipalId[];
} {
  let total = 0;
  const red: PrincipalId[] = [];
  for (const plan of book.plansIn(reckoning)) {
    for (const line of plan.lines) {
      const owed = book.owingOf(reckoning, line.principal).owed;
      if (owed <= 0) continue;
      total += owed;
      red.push(line.principal);
    }
  }
  return { total: minor(total), red: red.sort(compareIds) };
}
