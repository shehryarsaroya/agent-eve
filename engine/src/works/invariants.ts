/**
 * WORKS invariants: the yield cap made enforceable rather than merely intended.
 *
 * The whole A15 argument for this module is *"total world output is a property of the map, so
 * enrolling changes nothing"*. That is a claim about arithmetic in `Book.sharesAt`, and a
 * claim about arithmetic that nothing checks is a comment. These are the checks.
 */

import type { InvariantViolation, SystemId } from '../core/types.js';
import { halt } from '../invariants/registry.js';
import { tierOf, type WorldMap } from '../world/map.js';
import type { Book } from './book.js';
import { WORKS_PER_PRINCIPAL_PER_SYSTEM, YIELD_PER_TICK } from './params.js';

export interface WorksInvariantInputs {
  readonly book: Book;
  readonly map: WorldMap;
  readonly tick: number;
}

/**
 * INV-W1 — a system never yields more than its tier allows, this tick.
 *
 * The one that matters. If the share split can ever sum above the tier yield, goods enter the
 * world from rounding, at every worked system, every tick — and the population-independence
 * this module is built on quietly stops being true. Asserted against the *online* set, which
 * is the set `sharesAt` divides among.
 */
export function checkYieldCap(input: WorksInvariantInputs): readonly InvariantViolation[] {
  const out: InvariantViolation[] = [];
  for (const system of input.book.workedSystems()) {
    const tier = tierOf(input.map, system);
    const cap = YIELD_PER_TICK[tier];
    const shares = input.book.sharesAt(system, tier, input.tick);
    let total = 0;
    for (const amount of shares.values()) total += amount;
    if (total > cap) {
      out.push(
        halt(
          'INV-W1',
          input.tick,
          `${system} (${tier}) would yield ${String(total)} this tick against a cap of ${String(cap)}. ` +
            'A share split that sums above the tier yield mints goods out of rounding, which makes world ' +
            'output scale with the number of WORKS — and therefore with the number of identities (A15)',
        ),
      );
    }
    // Zero occupants must yield zero, not the tier amount looking for an owner.
    if (shares.size === 0 && total !== 0) {
      out.push(
        halt(
          'INV-W1',
          input.tick,
          `${system} yielded ${String(total)} with no online WORKS to receive it`,
        ),
      );
    }
  }
  return out;
}

/**
 * INV-W2 — nobody holds more WORKS at one system than the rule permits.
 *
 * The cap is per principal per system precisely because the share is per WORKS: without this,
 * a principal buys a larger slice of a fixed pool by raising structures next to itself, which
 * is the crowding mechanic pointed the wrong way.
 */
export function checkWorksPerSystem(input: WorksInvariantInputs): readonly InvariantViolation[] {
  const out: InvariantViolation[] = [];
  const seen = new Map<string, number>();
  for (const works of input.book.liveInOrder()) {
    const key = `${works.holder}@${works.system}`;
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    if (n > WORKS_PER_PRINCIPAL_PER_SYSTEM) {
      out.push(
        halt(
          'INV-W2',
          input.tick,
          `${works.holder} holds ${String(n)} live WORKS at ${works.system}, over the limit of ` +
            `${String(WORKS_PER_PRINCIPAL_PER_SYSTEM)}. The share is per WORKS, so this buys a bigger ` +
            'slice of a fixed pool',
        ),
      );
    }
  }
  return out;
}

/** INV-W3 — a WORKS extracts only from the tick it is online, never before. */
export function checkNoEarlyExtraction(input: WorksInvariantInputs): readonly InvariantViolation[] {
  const out: InvariantViolation[] = [];
  for (const works of input.book.liveInOrder()) {
    if (works.extracted > 0 && input.tick < works.onlineAtTick) {
      out.push(
        halt(
          'INV-W3',
          input.tick,
          `${works.id} has extracted ${String(works.extracted)} but does not come online until tick ` +
            `${String(works.onlineAtTick)}. Spin-up is what makes a WORKS a commitment rather than a ` +
            'purchase, and an early extraction refunds that risk',
        ),
      );
    }
  }
  return out;
}

export function checkWorks(input: WorksInvariantInputs): readonly InvariantViolation[] {
  return [
    ...checkYieldCap(input),
    ...checkWorksPerSystem(input),
    ...checkNoEarlyExtraction(input),
  ];
}

export type { SystemId };
