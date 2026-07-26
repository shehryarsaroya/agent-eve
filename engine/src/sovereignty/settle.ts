/**
 * Settlement: the arrears ladder, the lapse, and — much more importantly — **the A5′ guard
 * that stops either of them being recorded against a claimant that paid.**
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **THE COLLAPSE ARC, NOT THE DEATH SPIRAL.** The economic critic rejected draft 1's
 * two-misses-then-lapse outright:
 *
 * > Suppose six claims behind one choke each require 10,000 goods daily and post a 500,000
 * > bond. Holding one choke for two Reckonings makes all six lapse and removes 3,000,000 in
 * > bonds plus anchors and productive access. Attacker cost is approximately fixed; defender
 * > loss scales with every downstream claim. … Automatic deletion after two correlated misses
 * > produces a solved targeting algorithm.
 *
 * Four things in this file are that critique answered, and each is load-bearing:
 *
 *   1. **Partial payment counts.** `owed` is a subtraction, so 3,000 delivered against a
 *      4,000 Charge is 1,000 short — not "unpaid". The arrears is public either way, but the
 *      claimant is not billed twice for what it already handed over.
 *   2. **Three misses, with a CONTESTED middle** that opens a *published* window rather than
 *      deleting the claim.
 *   3. **A bounded cure.** The next Charge is `tier + surcharge`, never accumulated back
 *      arrears (`charge.ts:chargeOf`), so a blockaded claim can always be rescued by one
 *      convoy that gets through.
 *   4. **A lapse slashes ONE claim's bond**, not everything a claimant posted
 *      (`bond.ts:bondAtRiskFor`), so the first lapse does not cascade into the rest.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * ## A5′ is the first-order risk in this file, and it is worse here than in the Levy
 *
 * A Levy shortfall costs Commons capacity. A Charge shortfall costs **territory and posted
 * capital**, and the accusation is permanent. So {@link checkChargeAttribution} recomputes
 * every recorded shortfall from the delivery journal by a second road and halts on any
 * disagreement, exactly as `checkLevyAttribution` does, plus two clauses the Levy does not
 * need: a claim that was never assessed must never be recorded short, and a lapse must
 * never be recorded against a claim whose miss count does not reach the published threshold.
 */

import type { InvariantViolation, PrincipalId, SystemId } from '../core/types.js';
import { minor, qty, type Minor, type Qty } from '../core/units.js';
import { halt } from '../invariants/registry.js';
import { compareIds } from '../ledger/order.js';
import type { Book, ChargeShortfallRow, ClaimState } from './book.js';
import { CHARGE_MISSES_TO_LAPSE } from './params.js';

/**
 * The one thing a lapse may reach for: **posted bond, and the anchor that stands with it.**
 *
 * Deliberately the narrowest port in the module, for `SweepPort`'s reason: it can slash a
 * bond and it cannot see a holding, a hand, a standing row or an identity. So "a lapse takes
 * the claim and the bond and nothing else" is a property of the *type* rather than of
 * anybody remembering — and SOV-3 asserts the negative cheaply because the negative is
 * structural.
 *
 * §5.2's protections are not weakened by sovereignty: a claimant that loses every claim it
 * has still holds its identity, its standing, its hands and its Commons floor. What it loses
 * is the territory it chose to project force into, which is the thing it was told the bond
 * was for.
 */
export interface SlashPort {
  /**
   * Slash up to `want` from this principal's bond, and return what actually moved.
   *
   * Never throws: settlement runs at the tick every venture has already resolved on, and a
   * throw here would abort a Reckoning after the audience arrived. A port that cannot take
   * anything returns 0, and the shortfall row records `slashed: 0` — which is the honest
   * record of a bond that was not there.
   */
  slash(args: {
    readonly principal: PrincipalId;
    readonly system: SystemId;
    readonly want: Minor;
    readonly tick: number;
    readonly reckoning: number;
  }): Minor;
}

export interface ChargeSettlement {
  readonly reckoning: number;
  readonly tick: number;
  readonly shortfalls: readonly ChargeShortfallRow[];
  /** Claims that lapsed tonight. The obituary set. */
  readonly lapsed: readonly { readonly system: SystemId; readonly claimant: PrincipalId; readonly slashed: Minor }[];
  /** Claims that entered or stayed in arrears without lapsing. */
  readonly strained: readonly SystemId[];
  readonly contested: readonly SystemId[];
  /** `CHARGE SHORT` after settlement: Σ owed. The headline meter's sovereignty half. */
  readonly chargeShort: Qty;
  readonly paidInFull: number;
  readonly assessed: number;
}

/**
 * Settle every claimed constellation's Charge for one Reckoning.
 *
 * Idempotent by refusal: a second call for the same Reckoning returns the recorded result
 * rather than striking twice. Running a Reckoning twice would advance every arrears counter
 * a second time and lapse claims that had missed once — which is the settlement-side twin of
 * paying an elective part twice (INV-20's shape) with territory attached.
 */
export function settleCharge(args: {
  readonly book: Book;
  readonly reckoning: number;
  readonly tick: number;
  readonly slash: SlashPort;
  /** The bond one claim puts at risk, for the claimant that holds it. From `bond.ts`. */
  readonly bondAtRiskOf: (principal: PrincipalId) => Minor;
}): ChargeSettlement {
  const { book, reckoning, tick } = args;
  if (book.isSettled(reckoning)) {
    return summarise(book, reckoning, tick, [], [], [], []);
  }

  const rows: ChargeShortfallRow[] = [];
  const lapsed: { system: SystemId; claimant: PrincipalId; slashed: Minor }[] = [];
  const strained: SystemId[] = [];
  const contested: SystemId[] = [];

  // Ordered by system across the whole Reckoning, so the queue a viewer reads is one list
  // and two runs of one seed cannot disagree (DET-1).
  const lines = book
    .plansIn(reckoning)
    .flatMap((plan) => plan.lines.map((line) => ({ plan, line })))
    .sort((a, b) => compareIds(a.line.system, b.line.system));

  for (const { line } of lines) {
    // ── RESOLVED BY SYSTEM, BECAUSE THE DUTY IS TERRITORIAL ──────────────────
    //
    // Two wrong versions came before this one and both were A5′ failures, in opposite
    // directions. Keeping them both named, because the pair is the actual lesson.
    //
    // **V1 billed by system and read `owed` by claim id.** Measured through the front door:
    // `abandon` a CONTESTED claim at phase 40 and `build` a fresh one on the same system at
    // phase 42 — three ordinary offered acts — and the new claim's own observation read
    // `owed: 0 · legend: PAID · if_you_do_nothing: STAYS_SUPPLIED`, because the assessment
    // line was keyed on the *ended* claim's id. Settlement then billed the system anyway and
    // recorded the new claim LAPSED with its bond slashed. The worst outcome the mechanic
    // has, published against a claimant that had been shown the best.
    //
    // **V2 fixed that by settling against `byId(line.claim)` and skipping ended claims.** It
    // cured the lie and opened an exploit: abandon at two misses, retake the same system,
    // and the line is skipped, so no miss is recorded and the collapse arc stalls at two
    // forever. Territory could be held indefinitely without ever paying the Charge, for a
    // bond round-trip — which defeats "territory that must be MAINTAINED", and contradicts
    // the sentence `claim.ts` publishes to the taker in the same breath: *"a transfer never
    // resets that count."*
    //
    // So the duty is **territorial**, which is what the rules surface already promised and
    // what `missesAt`, `liveAt` and `claims` were always keyed on. The line is settled
    // against **whoever holds the system at settlement**, and the accusation names that
    // holder — never the departed one, which was V1's real sin. A retaker is not ambushed:
    // `build` refuses to hand over an arrears-carrying system without stating its state and
    // its miss count first, so inheriting the arc is a priced, published choice.
    const claim = book.liveAt(line.system);
    // Nobody holds it. The assessment is not anybody's obligation, so no shortfall is
    // recorded and no bond is slashed — but the system's misses persist in `delinquency`,
    // so abandoning does not launder the arc. The next taker inherits what it is shown.
    if (claim === null || claim.state === 'LAPSED' || claim.state === 'CEDED') continue;

    const owing = book.owingOf(reckoning, line.system);
    const paidInFull = owing.owed <= 0;

    let misses: number;
    let state: ClaimState;
    let slashed: Minor = minor(0);

    if (paidInFull) {
      book.clearMisses(line.system);
      misses = 0;
      state = 'SUPPLIED';
    } else {
      misses = book.miss(line.system, reckoning);
      if (misses >= CHARGE_MISSES_TO_LAPSE) {
        state = 'LAPSED';
        slashed = args.slash.slash({
          principal: claim.claimant,
          system: line.system,
          want: args.bondAtRiskOf(claim.claimant),
          tick,
          reckoning,
        });
        book.end(line.system, 'LAPSED', reckoning, null);
        book.recordLapse(line.system);
        lapsed.push({ system: line.system, claimant: claim.claimant, slashed });
      } else if (misses >= 2) {
        state = 'CONTESTED';
        book.setState(line.system, state);
        contested.push(line.system);
      } else {
        state = 'STRAINED';
        book.setState(line.system, state);
        strained.push(line.system);
      }
    }

    if (paidInFull) book.setState(line.system, 'SUPPLIED');

    const row: ChargeShortfallRow = {
      reckoning,
      // The claim that was short, which after a retake is not the claim that was assessed.
      // A5′: the record names who actually failed to supply the place.
      claim: claim.id,
      system: line.system,
      claimant: claim.claimant,
      assessment: owing.assessment,
      paid: owing.paid,
      owed: owing.owed,
      misses,
      state,
      slashed,
    };
    book.recordShortfall(row);
    rows.push(row);
  }

  book.markSettled(reckoning);
  return summarise(book, reckoning, tick, rows, lapsed, strained, contested);
}

function summarise(
  book: Book,
  reckoning: number,
  tick: number,
  rows: readonly ChargeShortfallRow[],
  lapsed: readonly { readonly system: SystemId; readonly claimant: PrincipalId; readonly slashed: Minor }[],
  strained: readonly SystemId[],
  contested: readonly SystemId[],
): ChargeSettlement {
  const recorded = rows.length > 0 ? rows : book.shortfallsIn(reckoning);
  return {
    reckoning,
    tick,
    shortfalls: recorded,
    lapsed,
    strained,
    contested,
    chargeShort: book.shortFor(reckoning),
    paidInFull: recorded.filter((r) => r.owed === 0).length,
    assessed: recorded.length,
  };
}

// ── the A5′ guard ────────────────────────────────────────────────────────────

/**
 * **Every recorded Charge shortfall must be reproducible from the delivery journal.**
 *
 * INV-17's argument — *"a default with no attributable cause is a top-severity halt, because
 * it is the game accusing an innocent agent"* — applied to a mechanic that takes territory
 * and slashable capital. Five clauses, and each one is a failure this module could have
 * shipped:
 *
 *   1. **A row's arithmetic reproduces.** `assessment − paid` recomputed from the journal.
 *   2. **A claim that delivered in full is never recorded short**, computed from the
 *      journal rather than from the row, so a row that lied cannot vouch for itself.
 *   3. **A claim that was never assessed is never recorded short.** The one A5′ clause the
 *      Levy does not need: the Levy assesses everybody, so an unassessed shortfall is
 *      unreachable there. Here a claim taken mid-cycle holds no line, and billing it would
 *      be charging a claimant for a Reckoning it was not told about.
 *   4. **A lapse requires the published number of misses.** A `LAPSED` row at two misses is
 *      the world taking territory the rules did not say it could.
 *   5. **Nothing was slashed beyond the bond at risk**, and nothing was slashed at all
 *      without a lapse.
 *
 * Returns violations; never throws. The tick loop's ASSERT decides what a violation costs,
 * and by the time this runs the alternative to halting is publishing a lie.
 */
export function checkChargeAttribution(
  book: Book,
  reckoning: number,
  tick: number,
  bondCeiling: Minor,
): readonly InvariantViolation[] {
  const out: InvariantViolation[] = [];
  const rows = book.shortfallsIn(reckoning);
  if (rows.length === 0) return out;

  for (const row of rows) {
    const payment = book.paymentOf(reckoning, row.system);
    const assessed = book.assessmentOf(reckoning, row.system);
    const paid = Math.min(assessed, payment.paid);
    const expected = Math.max(0, assessed - paid);

    if (row.owed !== expected) {
      out.push(
        halt(
          'A5-PRIME',
          tick,
          `the Charge recorded ${row.system} short by ${String(row.owed)} at Reckoning ${String(reckoning)}, ` +
            `but its own journal (assessed ${String(assessed)}, delivered ${String(payment.paid)} over ` +
            `${String(payment.deliveries)} deliveries) reproduces ${String(expected)}. A Charge shortfall drives ` +
            'an arrears, a vulnerability window and eventually a slashed bond, so a figure that cannot be ' +
            'reproduced is a permanent public accusation against a claimant that may have supplied its claim',
        ),
      );
    }
    if (row.owed > 0 && expected === 0) {
      out.push(
        halt(
          'A5-PRIME',
          tick,
          `${row.claimant} delivered the whole Reckoning ${String(reckoning)} Charge of ${String(assessed)} on ` +
            `${row.system} and is still recorded short by ${String(row.owed)}`,
        ),
      );
    }
    if (assessed <= 0 && row.owed > 0) {
      out.push(
        halt(
          'A5-PRIME',
          tick,
          `${row.system} is recorded short by ${String(row.owed)} at Reckoning ${String(reckoning)} and holds no ` +
            'assessment line at all. A claimant that was never shown what it owed must never be recorded in ' +
            'arrears for not paying it',
        ),
      );
    }
    if (row.state === 'LAPSED' && row.misses < CHARGE_MISSES_TO_LAPSE) {
      out.push(
        halt(
          'A5-PRIME',
          tick,
          `the claim on ${row.system} is recorded LAPSED at ${String(row.misses)} consecutive miss(es); the ` +
            `published threshold is ${String(CHARGE_MISSES_TO_LAPSE)}. Taking territory earlier than the rules ` +
            'say is a permanent public fact the rules made unavailable',
        ),
      );
    }
    if (row.slashed > 0 && row.state !== 'LAPSED') {
      out.push(
        halt(
          'A5-PRIME',
          tick,
          `${String(row.slashed)} of ${row.claimant}'s bond was slashed on ${row.system} at Reckoning ` +
            `${String(reckoning)} while the claim is recorded ${row.state}; only a LAPSE slashes`,
        ),
      );
    }
    if (row.slashed > bondCeiling) {
      out.push(
        halt(
          'A5-PRIME',
          tick,
          `${String(row.slashed)} was slashed against ${row.claimant} on ${row.system}, which is more than the ` +
            `${String(bondCeiling)} one claim's bond puts at risk. The record must never overstate what was ` +
            'taken from a principal',
        ),
      );
    }
  }
  return out;
}

/**
 * Docket rows for one Reckoning — sovereignty's contribution to the anti-quiet invariant.
 *
 * One row per assessed claim, and one per lapse, for `docketRowsFor`'s reason: a single row
 * naming everybody would satisfy the invariant identically and tell a viewer nothing, while a
 * per-claim row fails loudly the moment a claim stops being assessed.
 *
 * Typed loosely (`kind`/`principals`) rather than importing `DocketRow`, because the caller
 * is `invariants/crowd.ts`'s consumer and this module must not depend on the invariant that
 * consumes it.
 */
export function chargeDocketRowsFor(
  book: Book,
  reckoning: number,
): readonly { readonly reckoningIndex: number; readonly kind: string; readonly principals: readonly PrincipalId[] }[] {
  const out: { reckoningIndex: number; kind: string; principals: readonly PrincipalId[] }[] = [];
  for (const plan of book.plansIn(reckoning)) {
    for (const line of [...plan.lines].sort((a, b) => compareIds(a.system, b.system))) {
      out.push({ reckoningIndex: reckoning, kind: 'charge.assessed', principals: [line.claimant] });
    }
  }
  for (const row of book.shortfallsIn(reckoning)) {
    if (row.owed <= 0) continue;
    out.push({
      reckoningIndex: reckoning,
      kind: row.state === 'LAPSED' ? 'claim.lapsed' : 'charge.arrears',
      principals: [row.claimant],
    });
  }
  return out;
}

/** `CHARGE SHORT` as the headline reads it right now: Σ owed over live assessed claims. */
export function chargeShortNow(book: Book, reckoning: number): {
  readonly total: Qty;
  readonly red: readonly SystemId[];
} {
  let total = 0;
  const red: SystemId[] = [];
  for (const plan of book.plansIn(reckoning)) {
    for (const line of plan.lines) {
      const claim = book.liveAt(line.system);
      if (claim === null) continue;
      const owed = book.owingOf(reckoning, line.system).owed;
      if (owed <= 0) continue;
      total += owed;
      red.push(line.system);
    }
  }
  return { total: qty(total), red: red.sort(compareIds) };
}
