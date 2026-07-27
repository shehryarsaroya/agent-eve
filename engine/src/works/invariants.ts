/**
 * WORKS invariants: the yield cap made enforceable rather than merely intended.
 *
 * The whole A15 argument for this module is *"total world output is a property of the map, so
 * enrolling changes nothing"*. That is a claim about arithmetic in `Book.sharesAt`, and a
 * claim about arithmetic that nothing checks is a comment. These are the checks.
 */

import { phaseOfReckoning, reckoningIndex } from '../core/time.js';
import type { InvariantViolation, SystemId } from '../core/types.js';
import { BPS_ONE } from '../core/units.js';
import { halt } from '../invariants/registry.js';
import { tierOf, type WorldMap } from '../world/map.js';
import type { Book } from './book.js';
import { FUEL_YIELD_PER_TICK, WORKS_PER_PRINCIPAL_PER_SYSTEM, YIELD_PER_TICK } from './params.js';

export interface WorksInvariantInputs {
  readonly book: Book;
  readonly map: WorldMap;
  readonly tick: number;
  /**
   * The highest rent rate any live claim carries, in bps. Bounds INV-W5.
   *
   * Injected rather than read from `CLAIM_RENT_BPS`, because a claim raised before a tuning pass
   * keeps its own pinned rate (`ClaimRecord.rentBps`) and an invariant that assumed today's
   * constant would halt a world over a rate the rules themselves guaranteed. Absent means "no
   * claim book here", and the bound degrades to the whole yield rather than vanishing.
   */
  readonly rentCeilingBps?: number;
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

/**
 * INV-W4 — a WORKS never pays more rent than the place ever handed it.
 *
 * The cheapest possible check on the one arithmetic that could mint goods. `rent.ts` splits a
 * gross share into `rent + net` and returns both from one function precisely so the sum cannot
 * drift; this asserts the consequence over the whole history rather than over one call, which is
 * what catches a rent posted twice, a rent computed from the wrong quantity, or a counter
 * credited on a path where the ledger posting failed.
 *
 * Walks the WHOLE book, razed rows included: a razed WORKS's history is still a public claim
 * about how much of a resident's output a landlord took, and A5 has no opt-out.
 */
export function checkRentWithinGross(input: WorksInvariantInputs): readonly InvariantViolation[] {
  const out: InvariantViolation[] = [];
  for (const works of input.book.everInOrder()) {
    if (works.rentPaid < 0) {
      out.push(halt('INV-W4', input.tick, `${works.id} records negative rent (${String(works.rentPaid)})`));
    }
    if (works.rentPaid > works.extracted) {
      out.push(
        halt(
          'INV-W4',
          input.tick,
          `${works.id} has paid ${String(works.rentPaid)} in rent out of ${String(works.extracted)} ever ` +
            'extracted. Rent is a SPLIT of what a place hands over, so a rent above the gross is goods ' +
            'minted out of arithmetic — the A15 hole the yield cap exists to close, arriving through the ' +
            'landlord instead of through the tenant',
        ),
      );
    }
  }
  return out;
}

/**
 * INV-W5 — a claim's take this Reckoning is bounded by the MAP, never by its tenants.
 *
 * The A15 sentence made executable for the rent half. `params.ts` argues that world output is a
 * property of the map so that enrolling changes nothing; the rent is a claim on that output, so
 * the same has to be true of it or a landlord could be paid per tenant. The bound is the
 * strongest one that cannot false-halt: the tier yield, times every tick of this Reckoning that
 * could have run, times the highest rate any live claim carries.
 *
 * This is the check that catches double collection — two rent postings for one share sum to
 * `2 × bps` of the yield and trip it, where INV-W4 alone would not.
 */
export function checkRentBoundedByMap(input: WorksInvariantInputs): readonly InvariantViolation[] {
  const out: InvariantViolation[] = [];
  const reckoning = reckoningIndex(input.tick);
  // Every tick of this Reckoning up to and including the current one. An upper bound on purpose:
  // a world that began mid-Reckoning has run fewer, and an invariant must never accuse a world of
  // arithmetic it did not do.
  const ticksSoFar = phaseOfReckoning(input.tick) + 1;
  const ceiling = input.rentCeilingBps ?? BPS_ONE;
  for (const system of input.book.workedSystems()) {
    const taken = input.book.rentTakenAt(system, reckoning);
    if (taken <= 0) continue;
    const tier = tierOf(input.map, system);
    const cap = Math.trunc((YIELD_PER_TICK[tier] * ticksSoFar * ceiling) / BPS_ONE);
    if (taken > cap) {
      out.push(
        halt(
          'INV-W5',
          input.tick,
          `the claim on ${system} (${tier}) has taken ${String(taken)} in rent this Reckoning against a ` +
            `ceiling of ${String(cap)} — ${String(YIELD_PER_TICK[tier])} a tick over ${String(ticksSoFar)} ` +
            `ticks at ${String(ceiling)} bps. A rent above what the place can yield is paid per TENANT ` +
            'rather than per place, which makes territorial income scale with the number of identities (A15)',
        ),
      );
    }
  }
  return out;
}

/**
 * INV-W6 — the third good exists **only** where the map says it does.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **THE GEOGRAPHIC SCARCITY, MADE EXECUTABLE.** `FUEL_YIELD_PER_TICK` is zero at COMMONS and
 * MARCHES, and those zeroes are the entire comparative advantage `D23` says the economy is missing:
 * *"no comparative advantage exists anywhere in the world — every agent needs the same good and can
 * make it at the same rate."* A single fuel unit appearing at a Commons system would make fuel
 * producible by every newcomer for free, the asymmetry would price at nothing, and the failure
 * would be silent — a book that stopped clearing, which is indistinguishable from the world we
 * already had.
 *
 * Cheap, and checked against the CUMULATIVE counter rather than this tick's split, so it catches a
 * unit that leaked at any point in the world's history rather than only one leaking right now.
 * ══════════════════════════════════════════════════════════════════════════
 */
export function checkFuelIsFrontierOnly(input: WorksInvariantInputs): readonly InvariantViolation[] {
  const out: InvariantViolation[] = [];
  for (const works of input.book.everInOrder()) {
    if (works.fuelExtracted <= 0) continue;
    const tier = tierOf(input.map, works.system);
    if (FUEL_YIELD_PER_TICK[tier] <= 0) {
      out.push(
        halt(
          'INV-W6',
          input.tick,
          `${works.id} has been handed ${String(works.fuelExtracted)} of fuel at ${works.system}, a ${tier} ` +
            'system, which the map yields none at. Fuel existing outside the Frontier makes it producible ' +
            'anywhere, which deletes the only comparative advantage in the economy — and it would do it ' +
            'silently, as a book that quietly stops clearing',
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
    ...checkRentWithinGross(input),
    ...checkRentBoundedByMap(input),
    ...checkFuelIsFrontierOnly(input),
  ];
}

export type { SystemId };
