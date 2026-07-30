/**
 * SOV-1 … SOV-7 — what must be true about sovereignty at every tick close, forever.
 *
 * These are **not** new entries in `invariants/registry.ts`, for the reason
 * `market/invariants.ts` and `predation/invariants.ts` both give: that register is
 * TESTING.md §3's twenty-six, cross-checked against the document, and quietly growing it
 * would make "the 26 invariants" a number nobody can trust. So sovereignty's clauses carry
 * their own prefix and are supplied through the tick loop's `assertions` hook, which merges
 * them into the same ASSERT pass and halts the tick on the same terms.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **THE THREE THAT CARRY THE AXIOMS.**
 *
 * `SOV-1` is **A8**: no claim exists in the Commons. Nothing in the Commons can be fought
 * over, so a claim there would be a tint on the one part of the map that is not a prize —
 * and the `build` gate already refuses it. This checks the *result* anyway, because a floor
 * held up by one caller behaving well is not a floor.
 *
 * `SOV-3` is **§5.2's protections extended, and the reason it is stated as a negative.** A
 * lapse takes the claim and one claim's bond. It must never take identity, the holding, the
 * hands or standing. `SlashPort` cannot express any of those, so this clause checks the one
 * thing the type cannot: that nothing was slashed beyond what the rules permit.
 *
 * `SOV-4` is **arithmetic, not intention**: Σ assessment lines === the plan total, exactly.
 * An allocation one unit over the total puts a claim into arrears for a debt the rule never
 * created, which is the A5′ shape wearing arithmetic.
 * ══════════════════════════════════════════════════════════════════════════
 */

import { phaseOfReckoning, reckoningIndex } from '../core/time.js';
import type { InvariantViolation, SystemId, ZoneTier } from '../core/types.js';
import type { Minor } from '../core/units.js';
import { halt } from '../invariants/registry.js';
import { compareIds } from '../ledger/order.js';
import type { Book } from './book.js';
import { isTerminal } from './book.js';
import { inVulnerabilityWindow } from './cycle.js';
import {
  CHARGE_MISSES_TO_CONTEST,
  CHARGE_MISSES_TO_LAPSE,
  MAX_CLAIMS,
  SOVEREIGNTY_RETAINED_RECKONINGS,
  VULNERABILITY_WINDOW,
} from './params.js';

export interface SovereigntyInvariantInputs {
  readonly book: Book;
  readonly tick: number;
  readonly tierOf: (system: SystemId) => ZoneTier;
  /**
   * Where a principal's holding stands, or `null` if it has none.
   *
   * SOV-2's second road. Supplied by the runtime because only it can read the world, and
   * `null` skips the clause for that claim rather than halting a fixture with no world.
   */
  readonly holdingSystemOf: (principal: string) => SystemId | null;
  /** What one claim's bond may be slashed for. SOV-3's ceiling. */
  readonly bondCeiling: Minor;
}

/** Every sovereignty clause, in id order. The one call the ASSERT hook makes. */
export function checkSovereigntyInvariants(
  input: SovereigntyInvariantInputs,
): readonly InvariantViolation[] {
  return [
    ...checkSov1(input),
    ...checkSov2(input),
    ...checkSov3(input),
    ...checkSov4(input),
    ...checkSov5(input),
    ...checkSov6(input),
    ...checkSov7(input),
  ];
}

/** SOV-1 (A8) — no live claim stands on a COMMONS system. */
export function checkSov1(input: SovereigntyInvariantInputs): readonly InvariantViolation[] {
  const out: InvariantViolation[] = [];
  for (const claim of input.book.liveClaims()) {
    if (input.tierOf(claim.system) !== 'COMMONS') continue;
    out.push(
      halt(
        'A8',
        input.tick,
        `${claim.claimant} holds a live claim on ${claim.system}, which is a COMMONS system. A8 makes hostile ` +
          'action there INVALID rather than punished, so there is nothing a claim there could mean and nothing ' +
          'it could be contested by — a permanent safe floor is not a prize',
      ),
    );
  }
  return out;
}

/**
 * SOV-2 — a live claim's claimant has its holding standing on the claimed system.
 *
 * A claim is anchored by a body (`claim.ts`), and `graduate` is the only thing that moves a
 * holding. So a claim whose claimant is somewhere else means either that a takeover credited
 * the wrong principal or that a holding moved out from under a claim — and the first of those
 * is a permanent public assertion that somebody holds territory it does not.
 */
export function checkSov2(input: SovereigntyInvariantInputs): readonly InvariantViolation[] {
  const out: InvariantViolation[] = [];
  for (const claim of input.book.liveClaims()) {
    const where = input.holdingSystemOf(claim.claimant);
    if (where === null || where === claim.system) continue;
    out.push(
      halt(
        'INV-8',
        input.tick,
        `${claim.claimant} holds the live claim on ${claim.system} while its holding stands at ${where}. A claim ` +
          'is anchored by a body; a claim with no body behind it is territory nobody is standing on',
      ),
    );
  }
  return out;
}

/** SOV-3 — nothing was slashed except on a lapse, and never beyond one claim's bond. */
export function checkSov3(input: SovereigntyInvariantInputs): readonly InvariantViolation[] {
  const out: InvariantViolation[] = [];
  for (const reckoning of recentReckonings(input)) {
    for (const row of input.book.shortfallsIn(reckoning)) {
      if (row.slashed <= 0) continue;
      if (row.state !== 'LAPSED') {
        out.push(
          halt(
            'A5-PRIME',
            input.tick,
            `${String(row.slashed)} of ${row.claimant}'s bond is recorded slashed on ${row.system} at Reckoning ` +
              `${String(reckoning)} while the claim is ${row.state}. Only a LAPSE slashes; arrears cost nothing ` +
              'but publicity',
          ),
        );
      }
      if (row.slashed > input.bondCeiling) {
        out.push(
          halt(
            'A5-PRIME',
            input.tick,
            `${String(row.slashed)} was slashed against ${row.claimant} on ${row.system}, above the ` +
              `${String(input.bondCeiling)} one claim's bond puts at risk. One lapse must not cascade into a ` +
              "claimant's other claims",
          ),
        );
      }
    }
  }
  return out;
}

/** SOV-4 — Σ assessment lines === the plan total, exactly, for every plan in the book. */
export function checkSov4(input: SovereigntyInvariantInputs): readonly InvariantViolation[] {
  const out: InvariantViolation[] = [];
  for (const reckoning of recentReckonings(input)) {
    for (const plan of input.book.plansIn(reckoning)) {
      const summed = plan.lines.reduce<number>((acc, line) => acc + line.amount, 0);
      if (summed === plan.total) continue;
      out.push(
        halt(
          'INV-24',
          input.tick,
          `${plan.constellation}'s Charge plan for Reckoning ${String(plan.reckoning)} allocates ` +
            `${String(summed)} against a rule-fixed total of ${String(plan.total)}. A line above its share is a ` +
            'debt the rule never created, and the claim that bears it goes into arrears for it',
        ),
      );
    }
  }
  return out;
}

/**
 * SOV-5 — a spared claim is never assessed above the nominal share.
 *
 * Recomputed from the plan's own `spared` column against its `amount`, which is the check
 * INV-24 makes for the Levy's newcomer floor. The relief is the group's decision and it has
 * to be worth something, or the vote is theatre.
 */
export function checkSov5(input: SovereigntyInvariantInputs): readonly InvariantViolation[] {
  const out: InvariantViolation[] = [];
  for (const reckoning of recentReckonings(input)) {
    for (const plan of input.book.plansIn(reckoning)) {
      for (const line of plan.lines) {
        if (!line.spared) continue;
        if (line.amount <= line.ruleQty) continue;
        out.push(
          halt(
            'INV-24',
            input.tick,
            `${plan.constellation} voted to spare ${line.claimant} and its claim on ${line.system} is assessed ` +
              `${String(line.amount)}, above the ${String(line.ruleQty)} the rule alone would have charged. ` +
              'Relief that costs more than no relief is the ballot lying to the group that cast it',
          ),
        );
      }
    }
  }
  return out;
}

/**
 * SOV-6 — a settled Reckoning's claims all carry a verdict, and no claim carries two.
 *
 * INV-20's shape for sovereignty: every claim assessed in a Reckoning that has settled holds
 * exactly one shortfall row, so a claim cannot be silently skipped (its arrears would never
 * advance, which is a claim that can never lapse) or struck twice (which lapses it early).
 */
export function checkSov6(input: SovereigntyInvariantInputs): readonly InvariantViolation[] {
  const out: InvariantViolation[] = [];
  for (const reckoning of recentReckonings(input)) {
    if (!input.book.isSettled(reckoning)) continue;
    for (const plan of input.book.plansIn(reckoning)) {
      for (const line of [...plan.lines].sort((a, b) => compareIds(a.system, b.system))) {
        const claim = input.book.at(line.system);
        // A claim that ended mid-cycle is deliberately unjudged — `settleCharge` skips it
        // and says why. Recognised here rather than reported, or this clause would halt the
        // world on every cession.
        if (claim === null) continue;
        if (isTerminal(claim.state) && (claim.endedAtReckoning ?? reckoning) < reckoning) continue;
        if (input.book.shortfallOf(reckoning, line.system) !== null) continue;
        if (claim.state === 'CEDED') continue;
        out.push(
          halt(
            'INV-20',
            input.tick,
            `${line.system} was assessed ${String(line.amount)} at Reckoning ${String(reckoning)}, that ` +
              'Reckoning has settled, and no verdict was recorded against it. A claim with no verdict never ' +
              'advances its arrears and can never lapse — the mechanic silently stops',
          ),
        );
      }
    }
  }
  return out;
}

/**
 * SOV-7 — the declared bounds hold, and the window is where it says it is.
 *
 * The book's cap is INV-26/scar #3. The window clause is A14 as an assertion: a claim
 * recorded contestable outside the published phases would mean the clock a defender read was
 * not the clock the engine ran.
 */
export function checkSov7(input: SovereigntyInvariantInputs): readonly InvariantViolation[] {
  const out: InvariantViolation[] = [];
  const claims = input.book.claimsInOrder();
  if (claims.length > MAX_CLAIMS) {
    out.push(
      halt(
        'INV-26',
        input.tick,
        `the claim book holds ${String(claims.length)} rows against a declared cap of ${String(MAX_CLAIMS)}`,
      ),
    );
  }
  const phase = phaseOfReckoning(input.tick);
  const openByClock = inVulnerabilityWindow(input.tick);
  const openByRange = phase >= VULNERABILITY_WINDOW.firstPhase && phase <= VULNERABILITY_WINDOW.lastPhase;
  if (openByClock !== openByRange) {
    out.push(
      halt(
        'A14',
        input.tick,
        `the vulnerability window reads ${openByClock ? 'open' : 'shut'} at phase ${String(phase)} while the ` +
          `published range is ${String(VULNERABILITY_WINDOW.firstPhase)}–${String(VULNERABILITY_WINDOW.lastPhase)}. ` +
          'A published clock that disagrees with the engine is the clock a defender planned around being wrong',
      ),
    );
  }
  for (const claim of input.book.liveClaims()) {
    if (claim.state !== 'CONTESTED') continue;
    if (input.book.missesAt(claim.system) >= CHARGE_MISSES_TO_CONTEST) continue;
    out.push(
      halt(
        'A5-PRIME',
        input.tick,
        `${claim.system} is marked CONTESTED with ${String(input.book.missesAt(claim.system))} consecutive ` +
          `miss(es). CONTESTED means the record has published two misses, and it is what opens the window that ` +
          `can take ${claim.claimant}'s territory — a claim marked contestable on fewer is the world inviting a ` +
          'takeover the rules did not permit',
      ),
    );
  }
  if (CHARGE_MISSES_TO_LAPSE < 3) {
    out.push(
      halt(
        'A14',
        input.tick,
        `${String(CHARGE_MISSES_TO_LAPSE)} misses to lapse leaves no CONTESTED middle; the collapse arc becomes ` +
          'the correlated death spiral the economic critic rejected',
      ),
    );
  }
  return out;
}

/**
 * The Reckonings the book still holds rows for.
 *
 * Derived from the book rather than from a window arithmetic, so pruning and checking cannot
 * disagree: a clause that walked a fixed window would silently stop covering anything once
 * the retention window changed.
 */
function recentReckonings(input: SovereigntyInvariantInputs): readonly number[] {
  const seen = new Set<number>();
  for (const claim of input.book.claimsInOrder()) {
    if (claim.endedAtReckoning !== null) seen.add(claim.endedAtReckoning);
  }
  const reckoning = reckoningIndex(input.tick);
  for (let r = Math.max(0, reckoning - SOVEREIGNTY_RETAINED_RECKONINGS); r <= reckoning; r++) {
    seen.add(r);
  }
  return [...seen].sort((a, b) => a - b);
}
