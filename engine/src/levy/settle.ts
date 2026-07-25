/**
 * Settlement: what happens to a Levy that went unpaid, and — much more importantly —
 * **what does not.**
 *
 * ══════════════════════════════════════════════════════════════════════════
 * §5.2's second and third protections, and they are exhaustive:
 *
 *   - **NEVER identity, NEVER the holding, NEVER standing.**
 *   - **Chronic non-payment demotes Commons capacity, AND THAT IS ALL.**
 *
 * So this module reaches for exactly one thing: **located goods**, the same thing the
 * Levy is payable in, swept from the least-exposed first (§5.2's published default).
 * There is no call into the holding table, no call into the standing book, and no way
 * to reach either from here — `SweepPort` cannot express them. PROP-LV4 asserts the
 * negative, and the reason it can assert it cheaply is that the negative is structural.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * ## The non-escrowable share cannot be swept, and that is the meter working
 *
 * A sweep is not carriage. If the escrowable part can be taken from a turtle's stores
 * but the non-escrowable part cannot, then a principal that never moves a hand stays
 * permanently short by that share however rich it is — and `LEVY SHORT` keeps a floor
 * under it that only presence can lift. §14.2 wants "a world fact nobody can lower
 * alone, which *rises when the population turtles*"; this is the clause that makes that
 * literally true rather than hopeful.
 *
 * ## A5′ is the first-order risk in this file
 *
 * *"A Levy that records an unpaid assessment against a principal that delivered is
 * exactly that shape."* So the shortfall row carries its own arithmetic — assessment,
 * paidOwn, paidOther, swept — and {@link checkLevyAttribution} recomputes the answer
 * from the journal by a second road and halts on any disagreement. A shortfall with no
 * reproducible cause is the game accusing an innocent agent, which INV-17 treats as
 * top-severity for defaults and which is no less true here.
 */

import type { ConstellationId, InvariantViolation, PrincipalId, SystemId } from '../core/types.js';
import { minor, qty, type Minor, type Qty } from '../core/units.js';
import { compareIds } from '../ledger/order.js';
import { halt } from '../invariants/registry.js';
import type { DocketRow, Inv24Inputs, LevyAssessment } from '../invariants/crowd.js';
import { isNewcomer } from './assessment.js';
import type { Book, ShortfallRow } from './book.js';
import { LEVY_NOMINAL_MINOR } from './params.js';
import { owingOf } from './payment.js';

/**
 * The one thing settlement may reach for. Deliberately the narrowest port in the module.
 *
 * It can read a stock of the levy good and consume some of it. It cannot see a holding,
 * a standing row, a hand or an identity — so §5.2's "never identity, never the holding,
 * never standing" is a property of the *type*, not of anybody remembering.
 */
export interface SweepPort {
  /** Units of the levy good in this principal's STORES that are unpledged and available. */
  availableOf(principal: PrincipalId): Qty;
  /**
   * Consume up to `want` units into civic custody. Returns what it actually took.
   *
   * Never throws: a sweep is a Reckoning-time act and a throw here would abort a tick
   * that had already settled every venture. A port that cannot take anything returns 0,
   * the shortfall stands, and `LEVY SHORT` says so.
   */
  consume(args: {
    readonly principal: PrincipalId;
    readonly want: Qty;
    readonly place: SystemId;
    readonly tick: number;
    readonly reckoning: number;
  }): Qty;
}

/** EXPOSURE per principal, for the sweep order. Read once, at settlement. */
export type ExposureRead = (principal: PrincipalId) => Minor;

export interface LevySettlement {
  readonly reckoning: number;
  readonly tick: number;
  readonly shortfalls: readonly ShortfallRow[];
  /** Ascending EXPOSURE — §5.2's "swept from the least-exposed first". Never a newcomer. */
  readonly sweepQueue: readonly PrincipalId[];
  readonly sweptQty: Qty;
  /** Principals whose Commons capacity fell this Reckoning. The only cost of chronic default. */
  readonly demoted: readonly PrincipalId[];
  /** `LEVY SHORT`, after the sweep. The headline meter (§14.2). */
  readonly levyShort: Minor;
  /** Assessments that were discharged in full. The other half of the headline. */
  readonly paidInFull: number;
  readonly assessed: number;
}

/**
 * Settle every constellation's Levy for one Reckoning.
 *
 * Idempotent by refusal: a second call for the same Reckoning returns the recorded
 * result rather than sweeping twice. Running a Reckoning twice would take a second lot
 * of goods for one debt, which is the settlement-side twin of paying an elective part
 * twice (INV-20's shape).
 */
export function settleLevy(args: {
  readonly book: Book;
  readonly reckoning: number;
  readonly tick: number;
  readonly exposureOf: ExposureRead;
  readonly sweep: SweepPort;
}): LevySettlement {
  const { book, reckoning, tick } = args;
  if (book.isSettled(reckoning)) {
    return summarise(book, reckoning, tick, [], [], qty(0), []);
  }

  const plans = book.plansIn(reckoning);
  // Ordered by (EXPOSURE, principal_id) across the whole Reckoning rather than per
  // constellation, so the queue a viewer reads is one list. Constellations do not
  // interleave in practice — a plan's lines are its own roll — but the sort has to be
  // total or two runs of one seed could disagree (DET-1).
  const queue: { readonly principal: PrincipalId; readonly plan: (typeof plans)[number] }[] = [];
  const floored = new Set<PrincipalId>();

  for (const plan of plans) {
    for (const line of [...plan.lines].sort((a, b) => compareIds(a.principal, b.principal))) {
      if (line.newcomerFloored) floored.add(line.principal);
      queue.push({ principal: line.principal, plan });
    }
  }

  const sweepQueue = queue
    .filter((entry) => {
      if (floored.has(entry.principal)) return false;
      return book.owingOf(reckoning, entry.principal).purchasableOwed > 0;
    })
    .sort(
      (a, b) =>
        args.exposureOf(a.principal) - args.exposureOf(b.principal) ||
        compareIds(a.principal, b.principal),
    )
    .map((entry) => entry.principal);

  const inQueue = new Set<PrincipalId>(sweepQueue);
  let sweptTotal = 0;

  for (const principal of sweepQueue) {
    const entry = queue.find((q) => q.principal === principal);
    if (entry === undefined) continue;
    const owing = book.owingOf(reckoning, principal);
    // Only the purchasable bucket. Presence is not seizable — see this file's header.
    const want = qty(Math.min(owing.purchasableOwed, Math.max(0, args.sweep.availableOf(principal))));
    if (want <= 0) continue;
    const returned = args.sweep.consume({
      principal,
      want,
      place: entry.plan.deliverableTo,
      tick,
      reckoning,
    });
    if (returned <= 0) continue;
    // Clamp to `want`. The sweep asks for exactly the purchasable shortfall, but the
    // consume callback is external and its return is TRUSTED — an implementation that
    // returns more than asked would record a seizure larger than the debt, which is
    // taking goods an agent did not owe (A5′-adjacent). Found by a codex arithmetic
    // pass injecting a consume that over-returns; the record must never overstate what
    // was taken against a principal.
    const taken = qty(Math.min(want, returned));
    book.recordSweep(reckoning, principal, taken);
    sweptTotal += taken;
  }

  const rows: ShortfallRow[] = [];
  const demoted: PrincipalId[] = [];

  for (const entry of queue) {
    const payment = book.paymentOf(reckoning, entry.principal);
    const owing = book.owingOf(reckoning, entry.principal);
    // The sweep took goods against the purchasable bucket, so what is still owed is the
    // presence part plus whatever the sweep could not cover.
    const purchasableAfterSweep = minor(Math.max(0, owing.purchasableOwed - payment.swept));
    const owed = minor(owing.presenceOwed + purchasableAfterSweep);
    const row: ShortfallRow = {
      reckoning,
      principal: entry.principal,
      constellation: entry.plan.constellation,
      assessment: owing.assessment,
      paidOwn: minor(payment.paidOwn),
      paidOther: minor(payment.paidOther),
      sweptQty: payment.swept,
      presenceOwed: owing.presenceOwed,
      purchasableOwed: purchasableAfterSweep,
      owed,
      inSweepQueue: inQueue.has(entry.principal),
    };
    book.recordShortfall(row);
    rows.push(row);

    if (owed > 0) {
      if (book.strike(entry.principal, reckoning)) demoted.push(entry.principal);
    } else {
      book.clearStrikes(entry.principal);
    }
  }

  book.markSettled(reckoning);
  return summarise(book, reckoning, tick, rows, sweepQueue, qty(sweptTotal), demoted);
}

function summarise(
  book: Book,
  reckoning: number,
  tick: number,
  rows: readonly ShortfallRow[],
  sweepQueue: readonly PrincipalId[],
  sweptQty: Qty,
  demoted: readonly PrincipalId[],
): LevySettlement {
  const recorded = rows.length > 0 ? rows : book.shortfallsIn(reckoning);
  return {
    reckoning,
    tick,
    shortfalls: recorded,
    sweepQueue,
    sweptQty,
    demoted,
    levyShort: book.shortFor(reckoning),
    paidInFull: recorded.filter((r) => r.owed === 0).length,
    assessed: recorded.length,
  };
}

// ── INV-24 / INV-25 inputs ───────────────────────────────────────────────────

/**
 * INV-24's inputs for one Reckoning, built from the book.
 *
 * `seizureQueue` is the sweep queue as `checkInv24` names it. The invariant halts if a
 * floored principal appears in it, so passing the real queue rather than an empty array
 * is the whole point: an empty array would make that clause vacuous and the guard would
 * report a clean bill of health for the exact failure it exists to catch.
 */
export function inv24InputsFor(book: Book, reckoning: number): Inv24Inputs | null {
  const plans = book.plansIn(reckoning);
  if (plans.length === 0) return null;

  const totals = new Map<ConstellationId, Minor>();
  const assessments: LevyAssessment[] = [];
  const floorEligible = new Set<PrincipalId>();
  const seizureQueue: PrincipalId[] = [];

  for (const plan of plans) {
    totals.set(plan.constellation, plan.total);
    for (const line of [...plan.lines].sort((a, b) => compareIds(a.principal, b.principal))) {
      assessments.push({
        principal: line.principal,
        constellation: plan.constellation,
        amount: line.amount,
        newcomerFloored: line.newcomerFloored,
      });
      // INDEPENDENT re-derivation, not `line.newcomerFloored`. Building floorEligible
      // from the flag the assessment set would make INV-24's "floored the wrong
      // principal" clauses a tautology — the seal book shipped that exact bug and a
      // verifier caught it recurring here. isNewcomer runs the §5.2 rule against the
      // raw tenure and capital the line carries, so the check catches an assessment
      // that floored someone it should not have, or failed to floor someone it should.
      if (isNewcomer({ tenureTicks: line.tenureTicks, freeStores: line.freeStores })) {
        floorEligible.add(line.principal);
      }
      const row = book.shortfallOf(reckoning, line.principal);
      if (row !== null && row.inSweepQueue) seizureQueue.push(line.principal);
    }
  }

  return {
    totals,
    assessments,
    floorEligible,
    nominalRate: LEVY_NOMINAL_MINOR,
    seizureQueue: seizureQueue.sort(compareIds),
  };
}

/**
 * INV-25's docket rows for one Reckoning — **the anti-quiet invariant's whole answer.**
 *
 * §5.2 exists because "an agent that forms no ventures and stays in the Commons is never
 * on the docket, never penalised, never even visible as a problem". One row per
 * assessment is what makes that impossible: every principal in the constellation is
 * assessed, so every principal is on the docket, whatever it did or did not do.
 *
 * Rows are one-principal-per-row on purpose. A single row naming everybody would satisfy
 * the invariant identically and tell a viewer nothing, and INV-25's own note is that it
 * is "the one most likely to quietly stop being true as features are added" — a per-
 * principal row fails loudly the moment a principal stops being assessed.
 */
export function docketRowsFor(book: Book, reckoning: number): readonly DocketRow[] {
  const rows: DocketRow[] = [];
  for (const plan of book.plansIn(reckoning)) {
    for (const line of [...plan.lines].sort((a, b) => compareIds(a.principal, b.principal))) {
      rows.push({ reckoningIndex: reckoning, kind: 'levy.assessed', principals: [line.principal] });
    }
    if (plan.spared !== null) {
      rows.push({ reckoningIndex: reckoning, kind: 'levy.spared', principals: [plan.spared] });
    }
  }
  for (const row of book.shortfallsIn(reckoning)) {
    if (row.owed <= 0) continue;
    rows.push({ reckoningIndex: reckoning, kind: 'levy.short', principals: [row.principal] });
  }
  return rows;
}

// ── the A5′ guard ────────────────────────────────────────────────────────────

/**
 * **Every recorded shortfall must be reproducible from the payment journal.**
 *
 * This is INV-17's argument applied to the Levy: *"a default with no attributable cause
 * is a top-severity halt, because it is the game accusing an innocent agent."* A
 * shortfall is an accusation — it drives a sweep, a strike and eventually a demotion —
 * so it gets the same treatment.
 *
 * Three clauses, and the middle one is the bug this file was written expecting to
 * contain:
 *
 *   1. **A row's arithmetic reproduces.** Recompute `owed` from the journal and compare.
 *   2. **A principal that delivered in full is never recorded short.** Computed from the
 *      journal, not from the row, so a row that lied cannot vouch for itself.
 *   3. **A newcomer is never in the sweep queue** (§5.2, and INV-24's own clause).
 *
 * Returns violations; never throws. The tick loop's ASSERT decides what a violation
 * costs, and by the time this runs the alternative to halting is publishing a lie.
 */
export function checkLevyAttribution(book: Book, reckoning: number, tick: number): readonly InvariantViolation[] {
  const out: InvariantViolation[] = [];
  const plans = book.plansIn(reckoning);
  if (plans.length === 0) return out;

  const flooredAt = new Map<PrincipalId, boolean>();
  for (const plan of plans) {
    for (const line of plan.lines) flooredAt.set(line.principal, line.newcomerFloored);
  }

  for (const row of book.shortfallsIn(reckoning)) {
    const payment = book.paymentOf(reckoning, row.principal);
    const journal = owingOf(book.assessmentOf(reckoning, row.principal), {
      paidOwn: payment.paidOwn,
      paidOther: payment.paidOther,
    });
    const expected = journal.presenceOwed + Math.max(0, journal.purchasableOwed - payment.swept);

    if (row.owed !== expected) {
      out.push(
        halt(
          'A5-PRIME',
          tick,
          `the Levy recorded ${row.principal} short by ${String(row.owed)} at Reckoning ` +
            `${String(reckoning)}, but its own journal (assessed ${String(journal.assessment)}, delivered ` +
            `${String(payment.paidOwn)} by hand and ${String(payment.paidOther)} by service, swept ` +
            `${String(payment.swept)}) reproduces ${String(expected)}. A shortfall that cannot be ` +
            'reproduced is a permanent public accusation against a principal that may have paid',
        ),
      );
    }
    if (row.owed > 0 && journal.owed === 0 && payment.swept === 0) {
      out.push(
        halt(
          'A5-PRIME',
          tick,
          `${row.principal} delivered its whole Reckoning ${String(reckoning)} assessment of ` +
            `${String(journal.assessment)} and is still recorded short by ${String(row.owed)}`,
        ),
      );
    }
    if (row.inSweepQueue && flooredAt.get(row.principal) === true) {
      out.push(
        halt(
          'A5-PRIME',
          tick,
          `${row.principal} is inside the newcomer floor and was put in the Levy sweep queue at Reckoning ` +
            `${String(reckoning)}; SPEC §5.2 says never`,
        ),
      );
    }
    if (row.assessment !== journal.assessment) {
      out.push(
        halt(
          'A5-PRIME',
          tick,
          `${row.principal}'s shortfall row cites an assessment of ${String(row.assessment)} but the plan ` +
            `assessed ${String(journal.assessment)}`,
        ),
      );
    }
  }
  return out;
}
