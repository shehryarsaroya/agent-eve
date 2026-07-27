/**
 * The PRODUCE phase: the world hands over what its places yield.
 *
 * ## Why this posts EXTRACTION and not PRODUCTION
 *
 * `ledger/accounts.ts` has carried two goods faucets since commit #1. The endowment
 * posts `PRODUCTION` — the world simply making goods appear because a newcomer needs a
 * floor. This posts `EXTRACTION`, because what happens here is a *place* giving up a bounded
 * amount, and the distinction is the one the audit needs: total EXTRACTION over a window is
 * checkable against the map, while total PRODUCTION is checkable against enrolments. Merged
 * into one faucet, neither claim could be tested.
 *
 * ## Why it runs after MARKETS and why the phase order asserts it
 *
 * §15.2's *clear-before-produce*: a job may not buy at market in the same tick it produces,
 * or a principal could see this tick's clearing price and then decide what to make. The tick
 * loop already refuses to start a world whose phase order breaks that, which is why this
 * file only has to fill the slot.
 */

import type { EventId } from '../core/types.js';
import { qty, type Qty } from '../core/units.js';
import { compareIds } from '../ledger/order.js';
import { GOODS_FAUCET, storesAccount, type Ledger } from '../ledger/index.js';
import { tierOf, type WorldMap } from '../world/map.js';
import type { Book } from './book.js';
import { WORKS_YIELD_GOOD } from './params.js';

export interface ExtractionRow {
  readonly works: string;
  readonly system: string;
  readonly holder: string;
  readonly qty: Qty;
}

/**
 * Run one tick of extraction. Returns what was extracted, for the event rows and the frame.
 *
 * Deterministic by construction: systems in `compareIds` order, and within a system the
 * share map is built in canonical WORKS order. Nothing here reads the clock or the RNG.
 */
export function produce(args: {
  readonly book: Book;
  readonly ledger: Ledger;
  readonly map: WorldMap;
  readonly tick: number;
}): readonly ExtractionRow[] {
  const { book, ledger, map, tick } = args;
  const out: ExtractionRow[] = [];

  for (const system of [...book.workedSystems()].sort(compareIds)) {
    const shares = book.sharesAt(system, tierOf(map, system), tick);
    for (const [id, amount] of [...shares.entries()].sort((a, b) => compareIds(a[0], b[0]))) {
      if (amount <= 0) continue;
      const works = book.at(id);
      if (works === null) continue;
      ledger.sourceGoods({
        eventId: `works.extract:${id}:${String(tick)}` as EventId,
        tick,
        // The place gave this up, and the audit can compare the total against the map.
        faucet: GOODS_FAUCET.EXTRACTION,
        to: storesAccount(works.holder),
        // RAW. `refine` turns it into the consumable the Levy wants — §10's one build step.
        good: WORKS_YIELD_GOOD,
        qty: amount,
        // Extracted where it stands, never at the holder's seat. §10.2: everything is
        // located, and goods that appeared at a holding the hand had left would be a
        // located fact that was false — the same error D8 corrected in the Levy.
        location: system,
        origin: works.holder,
      });
      book.credit(id, amount);
      out.push({ works: id, system, holder: works.holder, qty: qty(amount) });
    }
  }
  return out;
}
