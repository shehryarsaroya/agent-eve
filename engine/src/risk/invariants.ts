/**
 * The risk market's invariants — INV-R1 … INV-R7.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ## Every one of these has a subject that can occur, and that is checked
 *
 * This project's signature defect at the invariant depth is *"a check whose subject cannot
 * happen"* — INV-22 was green over an empty journal for the project's whole life, and INV-23 was
 * the same before it. So each checker below states what its subject is, and
 * `test/risk/invariants.spec.ts` opens every block by asserting the subject occurs in a driven
 * world before it asserts anything about the guard. A green INV-R over an empty book would be the
 * fifteenth instance of this bug, arriving in the module written *knowing about it*.
 *
 * ## The two that exist for A5′ rather than for correctness
 *
 * **INV-R3** (conserved interest) and **INV-R5** (attributable cause) are not arithmetic hygiene.
 * They are the false-default problem, and they fail in the direction that libels a real agent:
 *
 *   - two COVERS over one holding make Σ indemnity exceed the loss, so one payer is unavoidably
 *     short **with every individual settlement arithmetically correct** — a false default that
 *     §15.4's five defences cannot see, because there is no race and no stale read;
 *   - a default with no cause event is *"the game accusing an innocent agent"* (INV-17's own words),
 *     and it is top-severity for the same reason.
 *
 * Both are therefore halts and not faults.
 * ══════════════════════════════════════════════════════════════════════════════
 */

import type { PrincipalId } from '../core/types.js';
import type { Ledger } from '../ledger/ledger.js';
import { compareIds } from '../ledger/order.js';
import { RiskBook } from './book.js';
import { escrowedOutstanding, isLiveCover, type CoverRecord } from './cover.js';
import type { RiskDefault } from './indemnity.js';
import {
  COVER_ELECTIVE_BPS_CEILING,
  COVER_ELECTIVE_BPS_FLOOR,
  COVER_MAX_DEPTH,
} from './params.js';

export class RiskHalt extends Error {}

/** One failed check, in the shape the engine's other invariant modules use. */
export interface RiskViolation {
  readonly invariant: string;
  readonly detail: string;
}

/**
 * **INV-R1 — every open INDEMNITY has its COVER.**
 *
 * *Subject:* an open INDEMNITY. The bug it catches is a retention window or a restore that dropped a
 * live cover row: the INDEMNITY would then quietly owe nothing, the payee would be paid nothing, and
 * **nothing would fail**. That is `Book.prune`'s failure mode exactly — *"in the direction that
 * hides"* — and it is why `RiskBook.requireCover` throws instead of returning `undefined`.
 */
export function checkInvR1(book: RiskBook): readonly RiskViolation[] {
  const out: RiskViolation[] = [];
  for (const ind of book.allIndemnities()) {
    if (ind.state !== 'OPEN' && ind.state !== 'DUE' && ind.state !== 'DEFERRED') continue;
    if (book.cover(ind.cover) === undefined) {
      out.push({
        invariant: 'INV-R1',
        detail:
          `indemnity ${ind.id} is ${ind.state} and its cover ${ind.cover} is not in the book. A ` +
          'promise the engine cannot price is a promise it must not silently discharge.',
      });
    }
  }
  return out;
}

/**
 * **INV-R2 — the INDEMNITY arithmetic.**
 *
 * *Subject:* every INDEMNITY. `covered === escrowedDue + electiveDue`, `covered ≤ grossLoss`, and
 * neither half paid past its due. §7.4's property tests, and CAT6's conservation clause: a payout
 * larger than the loss makes being struck profitable and turns this layer into a currency faucet,
 * of which §10.2 permits exactly two.
 */
export function checkInvR2(book: RiskBook): readonly RiskViolation[] {
  const out: RiskViolation[] = [];
  for (const ind of book.allIndemnities()) {
    if (ind.escrowedDue + ind.electiveDue !== ind.covered) {
      out.push({
        invariant: 'INV-R2',
        detail: `indemnity ${ind.id} splits ${String(ind.escrowedDue)}+${String(ind.electiveDue)} against covered ${String(ind.covered)}`,
      });
    }
    if (ind.covered > ind.grossLoss) {
      out.push({
        invariant: 'INV-R2',
        detail: `indemnity ${ind.id} covers ${String(ind.covered)} against a loss of ${String(ind.grossLoss)} (CAT6)`,
      });
    }
    if (ind.escrowedPaid > ind.escrowedDue || ind.electivePaid > ind.electiveDue) {
      out.push({
        invariant: 'INV-R2',
        detail: `indemnity ${ind.id} paid past its due`,
      });
    }
  }
  return out;
}

/**
 * **INV-R3 — one interest, one COVER. ★ A5′.**
 *
 * *Subject:* every live COVER over goods. See the module header for why this is a false-default guard
 * and not a fairness rule. `bindCover` refuses the second one; this is the second road, and it is
 * needed because a restore could rebuild a book that violates it without any bind having run.
 */
export function checkInvR3(book: RiskBook): readonly RiskViolation[] {
  const out: RiskViolation[] = [];
  const seen = new Map<string, string>();
  for (const cover of book.allCovers()) {
    if (!isLiveCover(cover.state)) continue;
    if (cover.over.kind !== 'GOODS' || cover.payee === null) continue;
    const key = RiskBook.interestKey(cover.payee, cover.over.system, cover.over.good);
    const first = seen.get(key);
    if (first !== undefined) {
      out.push({
        invariant: 'INV-R3',
        detail:
          `covers ${first} and ${cover.id} both stand over ${key}. Σ indemnity would exceed the loss, ` +
          'one payer would be short through nobody\'s fault, and the record would call it a default.',
      });
      continue;
    }
    seen.set(key, cover.id);
  }
  return out;
}

/**
 * **INV-R4 — bounded chains, no cycles.**
 *
 * *Subject:* every COVER written over another COVER. RE6's cap and RE11's CUT. A cycle in a
 * settlement graph is an unbounded cascade, and §15.2 is explicit that cascades run *"in fixed
 * rounds, never a loop to convergence, or adversarial circular obligations make the tick
 * unbounded."*
 */
export function checkInvR4(book: RiskBook): readonly RiskViolation[] {
  const out: RiskViolation[] = [];
  for (const cover of book.allCovers()) {
    if (cover.depth > COVER_MAX_DEPTH) {
      out.push({
        invariant: 'INV-R4',
        detail: `cover ${cover.id} is at layer ${String(cover.depth)} against a cap of ${String(COVER_MAX_DEPTH)}`,
      });
    }
    if (cover.over.kind !== 'COVER') continue;
    let chain: readonly CoverRecord[];
    try {
      chain = book.chainUnder(cover.id);
    } catch (error) {
      out.push({
        invariant: 'INV-R4',
        detail: `cover ${cover.id} chain does not terminate: ${String(error)}`,
      });
      continue;
    }
    const payers = new Set<PrincipalId>();
    for (const link of chain) {
      if (payers.has(link.payer)) {
        out.push({
          invariant: 'INV-R4',
          detail:
            `${link.payer} appears twice in the chain under ${cover.id}, so the same risk is ceded ` +
            'back to a house already holding it — false diversification (RE6).',
        });
        break;
      }
      payers.add(link.payer);
    }
  }
  return out;
}

/**
 * **INV-R5 — every default is attributable. ★ A5′, top severity.**
 *
 * *Subject:* every {@link RiskDefault} a settlement produced. §15.4's Mode B: *"every logged default
 * must be attributable — each one carries the event ID of the loss or the missed delivery that caused
 * it, and a default with no attributable cause is top-severity, because it is the game accusing an
 * innocent agent."*
 *
 * Checked against the batch rather than the book, because a default is an *event*, and by the time it
 * is a row the accusation has already been made.
 */
export function checkInvR5(defaults: readonly RiskDefault[]): readonly RiskViolation[] {
  const out: RiskViolation[] = [];
  for (const d of defaults) {
    if (d.causeEventId.length === 0) {
      out.push({
        invariant: 'INV-R5',
        detail:
          `default on ${d.indemnity} by ${d.payer} carries no cause event. A default the engine ` +
          'cannot attribute is the game accusing an innocent agent, permanently.',
      });
    }
    if (d.amount <= 0) {
      out.push({
        invariant: 'INV-R5',
        detail: `default on ${d.indemnity} is for ${String(d.amount)}; a default of nothing is not a default`,
      });
    }
    if (d.payer === d.payee) {
      out.push({
        invariant: 'INV-R5',
        detail:
          `default on ${d.indemnity} names ${d.payer} as both payer and payee. Self-dealing can never ` +
          'be a broken promise (scar #9).',
      });
    }
  }
  return out;
}

/**
 * **INV-R6 — the certain half is actually there.**
 *
 * *Subject:* every live COVER. A7 promises that the escrowed half *"executes automatically"*, and the
 * only thing that makes that true is money sitting in the escrow account. An escrow short of its
 * outstanding escrowed half is A7 as a claim rather than a fact, and it is the condition under which
 * `settleIndemnity` would produce an escrowed shortfall — which is structurally a recorded loss, so
 * **nothing downstream would fail**. Hence a halt here rather than a discovery there.
 */
export function checkInvR6(ledger: Ledger, book: RiskBook): readonly RiskViolation[] {
  const out: RiskViolation[] = [];
  for (const cover of book.allCovers()) {
    if (!isLiveCover(cover.state)) continue;
    const owed = escrowedOutstanding(cover);
    if (owed <= 0) continue;
    const account = ledger.account(cover.escrow);
    const held = account === undefined ? 0 : ledger.freeBalance(cover.escrow);
    if (held < owed) {
      out.push({
        invariant: 'INV-R6',
        detail:
          `cover ${cover.id} owes ${String(owed)} escrowed and its escrow holds ${String(held)}. A7's ` +
          'certain half is only certain while the money is in the account.',
      });
    }
  }
  return out;
}

/**
 * **INV-R7 — A7's band held.**
 *
 * *Subject:* every COVER. `elective_bps` inside `[floor, ceiling]`, and `escrowed + elective === limit`
 * exactly. §7.5's floor is *"what makes the elective part exist at all"*, and a cover that drifted to
 * zero elective would be a fee wearing a promise's name — the failure `lockFillStake` had one
 * mechanic over, where *"`elective` sat one minor unit under `f(kind)` on every venture forever"*.
 */
export function checkInvR7(book: RiskBook): readonly RiskViolation[] {
  const out: RiskViolation[] = [];
  for (const cover of book.allCovers()) {
    if (cover.electiveBps < COVER_ELECTIVE_BPS_FLOOR || cover.electiveBps > COVER_ELECTIVE_BPS_CEILING) {
      out.push({
        invariant: 'INV-R7',
        detail:
          `cover ${cover.id} is at ${String(cover.electiveBps)} bps elective, outside ` +
          `[${String(COVER_ELECTIVE_BPS_FLOOR)}, ${String(COVER_ELECTIVE_BPS_CEILING)}]`,
      });
    }
    if (cover.escrowed + cover.elective !== cover.limit) {
      out.push({
        invariant: 'INV-R7',
        detail:
          `cover ${cover.id} halves are ${String(cover.escrowed)}+${String(cover.elective)} against a ` +
          `limit of ${String(cover.limit)}; every minor unit of a promise is in one half or the other`,
      });
    }
  }
  return out;
}

/** All seven, in order, deterministically. */
export function checkRiskInvariants(
  ledger: Ledger,
  book: RiskBook,
  defaults: readonly RiskDefault[] = [],
): readonly RiskViolation[] {
  return Object.freeze(
    [
      ...checkInvR1(book),
      ...checkInvR2(book),
      ...checkInvR3(book),
      ...checkInvR4(book),
      ...checkInvR5(defaults),
      ...checkInvR6(ledger, book),
      ...checkInvR7(book),
    ].sort((a, b) => compareIds(a.invariant, b.invariant) || compareIds(a.detail, b.detail)),
  );
}

/** Halt on any violation. §15.2: *"abort the tick and halt. Never publish a broken tick."* */
export function assertRiskInvariants(
  ledger: Ledger,
  book: RiskBook,
  defaults: readonly RiskDefault[] = [],
): void {
  const faults = checkRiskInvariants(ledger, book, defaults);
  if (faults.length === 0) return;
  throw new RiskHalt(faults.map((f) => `${f.invariant}: ${f.detail}`).join(' · '));
}

/**
 * The non-vacuity report an instrument prints, so *"green"* can be distinguished from *"empty"*.
 *
 * This exists because of the corollary this repo learned twice: an invariant is only as strong as the
 * occurrence of its subject, and nothing could tell INV-22's silence from INV-22's success. Every
 * count here is the denominator of one checker above.
 */
export interface RiskSubjects {
  readonly fronts: number;
  readonly struckFronts: number;
  readonly covers: number;
  readonly liveCovers: number;
  readonly boundCovers: number;
  readonly cessions: number;
  readonly indemnities: number;
  readonly openIndemnities: number;
  readonly deepestChain: number;
}

export function riskSubjects(book: RiskBook): RiskSubjects {
  const covers = book.allCovers();
  const inds = book.allIndemnities();
  return {
    fronts: book.allFronts().length,
    struckFronts: book.allFronts().filter((f) => f.struckAtTick !== null).length,
    covers: covers.length,
    liveCovers: covers.filter((c) => isLiveCover(c.state)).length,
    boundCovers: covers.filter((c) => c.payee !== null).length,
    cessions: covers.filter((c) => c.over.kind === 'COVER').length,
    indemnities: inds.length,
    openIndemnities: inds.filter((i) => i.state === 'OPEN' || i.state === 'DUE').length,
    deepestChain: covers.reduce((max, c) => Math.max(max, c.depth), 0),
  };
}
